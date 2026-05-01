"""
COMPRESS stage — pure Python, no LLM.

Lifted from Qodo PR-Agent's PR Compression Strategy
(https://qodo-merge-docs.qodo.ai/core-abilities/compression_strategy/, MIT
license — see attribution in habakkuk/README.md).

Algorithm (verbatim ports the spirit of pr-agent's pr_processing.py):

  1. Sort changed files by language frequency × token count (descending).
     Most-represented languages first; within a language, biggest changes
     first. This ensures the "expensive" files get budget allocated first
     so they aren't accidentally truncated.

  2. Build per-AREA bundles. Each fan-out area gets one bundle. We assign
     files to areas by content heuristics (e.g. anything under tests/ goes
     to tests-coverage; *.html/*.css → ux-a11y; netlify functions → api-contracts).

  3. Hard token budget per bundle: 24K tokens. If a single file's diff
     would exceed the remaining budget for its area, we truncate that file's
     diff to the head + tail with a marker, attribution preserved.

  4. Deleted files collapsed to a list (no diff content).

  5. Binary files collapsed to a list with paths + sizes.

  6. Bundles are written to <run_dir>/bundles/<area>.diff. Empty bundles
     are still written (so the fan-out stage can detect "skip this area").

EXIT CONDITIONS:
  - Every bundle is ≤ BUNDLE_TOKEN_CAP. Hard fail if not.
"""

from __future__ import annotations

import json
import pathlib
import re
from collections import defaultdict
from dataclasses import dataclass

from ..shared.config import (
    AREAS, BUNDLE_TOKEN_CAP, ensure_dirs, estimate_tokens,
)
from ..shared.diff_utils import DiffFile, list_diff_files


# ---------------------------------------------------------------------------
# Area routing — pattern matching on the file path
# ---------------------------------------------------------------------------

AREA_PATTERNS: list[tuple[str, list[re.Pattern[str]]]] = [
    ("tests-coverage", [
        re.compile(r"(^|/)tests?/"),
        re.compile(r"\.test\.[jt]sx?$"),
        re.compile(r"\.spec\.[jt]sx?$"),
        re.compile(r"smoke[-_].*\.(?:js|py|sh|mjs)$"),
        re.compile(r"^playwright\.config\."),
    ]),
    ("api-contracts", [
        re.compile(r"netlify/functions/"),
        re.compile(r"/(?:api|routes|handlers)/"),
        re.compile(r"openapi"),
        re.compile(r"\.proto$"),
        re.compile(r"package(?:-lock)?\.json$"),
    ]),
    ("data-integrity", [
        re.compile(r"/data/"),
        re.compile(r"/db/"),
        re.compile(r"\.sql$"),
        re.compile(r"local-db.*\.json$"),
        re.compile(r"migrations?/"),
        re.compile(r"schema"),
    ]),
    ("ux-a11y", [
        re.compile(r"\.html?$"),
        re.compile(r"\.css$"),
        re.compile(r"\.scss$"),
        re.compile(r"/components/"),
        re.compile(r"/pages/"),
        re.compile(r"\.jsx$"),
        re.compile(r"\.tsx$"),
    ]),
    ("perf", [
        re.compile(r"webpack"),
        re.compile(r"vite\."),
        re.compile(r"build\.(?:js|ts|sh)$"),
        re.compile(r"\.config\.(?:js|ts|json)$"),
    ]),
    ("security", [
        re.compile(r"auth", re.IGNORECASE),
        re.compile(r"login", re.IGNORECASE),
        re.compile(r"token", re.IGNORECASE),
        re.compile(r"secret", re.IGNORECASE),
        re.compile(r"crypto", re.IGNORECASE),
        re.compile(r"netlify\.toml$"),
        re.compile(r"\.env"),
    ]),
]


def assign_areas(file: DiffFile) -> set[str]:
    """A file may belong to MULTIPLE areas — that's fine. Each area's agent
    will see only the files relevant to it. The Rank stage dedupes if two
    agents flag the same line."""
    areas: set[str] = set()
    for area, patterns in AREA_PATTERNS:
        for pat in patterns:
            if pat.search(file.path):
                areas.add(area)
                break
    # Every code file gets at least one area. If patterns missed it, default
    # to the broadest reviewer: ux-a11y for FE, security for everything else,
    # so nothing slips through. Tests-coverage is added if the area is empty
    # AND the file looks like infra.
    if not areas:
        if file.language in ("html", "css", "js", "ts"):
            areas.add("ux-a11y")
        else:
            areas.add("security")  # broad-scope fallback — security agent
                                    # routinely flags non-security issues as
                                    # `notes[]`, which is fine
    return areas


# ---------------------------------------------------------------------------
# Compression
# ---------------------------------------------------------------------------

@dataclass
class Bundle:
    area: str
    file_paths: list[str]
    deleted_files: list[str]
    binary_files: list[str]
    truncated_files: list[str]
    text: str
    token_estimate: int


def _truncate_diff(diff: str, head_lines: int = 80, tail_lines: int = 40) -> str:
    """Keep first head_lines + last tail_lines, marker in between."""
    lines = diff.splitlines()
    if len(lines) <= head_lines + tail_lines:
        return diff
    return "\n".join(
        lines[:head_lines]
        + [f"... [truncated {len(lines) - head_lines - tail_lines} lines for token budget] ..."]
        + lines[-tail_lines:]
    )


def _build_one_bundle(
    area: str,
    files: list[DiffFile],
    cap_tokens: int,
) -> Bundle:
    """Pack files into a single bundle under cap_tokens. Sorting is by
    language frequency × size, most-represented language first."""
    lang_freq: dict[str, int] = defaultdict(int)
    for f in files:
        if not f.is_binary and not f.is_deleted:
            lang_freq[f.language] += 1

    def sort_key(f: DiffFile) -> tuple[int, int]:
        # Higher language frequency first (negative for desc), then larger
        # files first within a language.
        return (-lang_freq.get(f.language, 0), -f.total_lines)

    sortable = [f for f in files if not f.is_binary and not f.is_deleted]
    sortable.sort(key=sort_key)

    deleted = [f.path for f in files if f.is_deleted]
    binary = [f.path for f in files if f.is_binary]

    # Header gives the Sonnet fan-out agents enough context to interpret the
    # bundle without needing to read the plan separately. Plan is loaded
    # alongside in the fan-out stage anyway, but a self-describing bundle
    # makes debugging much easier.
    header_lines: list[str] = [
        f"# Habakkuk diff bundle — area: {area}",
        f"# Files included (text): {len(sortable)}",
        f"# Deleted files: {len(deleted)}",
        f"# Binary files: {len(binary)}",
        "",
    ]
    if deleted:
        header_lines.append("## Deleted files (no diff content):")
        for p in deleted[:50]:
            header_lines.append(f"- {p}")
        if len(deleted) > 50:
            header_lines.append(f"... ({len(deleted) - 50} more)")
        header_lines.append("")
    if binary:
        header_lines.append("## Binary files (no diff content):")
        for p in binary[:50]:
            header_lines.append(f"- {p}")
        if len(binary) > 50:
            header_lines.append(f"... ({len(binary) - 50} more)")
        header_lines.append("")
    header_lines.append("## Diffs follow.")
    header_lines.append("")

    header = "\n".join(header_lines)
    used_tokens = estimate_tokens(header)
    chunks: list[str] = [header]
    file_paths: list[str] = []
    truncated: list[str] = []

    for f in sortable:
        if not f.diff_text:
            continue
        chunk = f"\n### File: {f.path} (status={f.status} +{f.additions}/-{f.deletions})\n```diff\n{f.diff_text}\n```\n"
        chunk_tokens = estimate_tokens(chunk)
        remaining = cap_tokens - used_tokens

        if chunk_tokens > remaining:
            # Try truncating; if even truncated doesn't fit, skip the file.
            truncated_diff = _truncate_diff(f.diff_text)
            chunk = f"\n### File: {f.path} (status={f.status} +{f.additions}/-{f.deletions}) [TRUNCATED]\n```diff\n{truncated_diff}\n```\n"
            chunk_tokens = estimate_tokens(chunk)
            if chunk_tokens > remaining:
                # Out of budget. Stop adding files.
                break
            truncated.append(f.path)

        chunks.append(chunk)
        file_paths.append(f.path)
        used_tokens += chunk_tokens

    text = "".join(chunks)
    actual = estimate_tokens(text)
    if actual > cap_tokens:
        # Should never trigger given the logic above, but defense-in-depth.
        raise RuntimeError(
            f"HABAKKUK_BUNDLE_OVERFLOW: area={area} estimated {actual} > cap {cap_tokens}"
        )
    return Bundle(
        area=area,
        file_paths=file_paths,
        deleted_files=deleted,
        binary_files=binary,
        truncated_files=truncated,
        text=text,
        token_estimate=actual,
    )


def compress(
    *,
    files: list[DiffFile],
    run_dir: pathlib.Path,
    cap_tokens: int = BUNDLE_TOKEN_CAP,
) -> dict[str, Bundle]:
    """
    Build one bundle per AREA. Returns dict[area] -> Bundle. Writes each
    bundle as <run_dir>/bundles/<area>.diff and a manifest.json.
    """
    ensure_dirs()
    bundles_dir = run_dir / "bundles"
    bundles_dir.mkdir(parents=True, exist_ok=True)

    by_area: dict[str, list[DiffFile]] = {a: [] for a in AREAS}
    for f in files:
        for a in assign_areas(f):
            by_area[a].append(f)

    bundles: dict[str, Bundle] = {}
    manifest: dict[str, dict] = {}

    for area in AREAS:
        bundle = _build_one_bundle(area, by_area[area], cap_tokens=cap_tokens)
        bundles[area] = bundle
        out_path = bundles_dir / f"{area}.diff"
        out_path.write_text(bundle.text, encoding="utf-8")
        manifest[area] = {
            "path": str(out_path),
            "files_included": bundle.file_paths,
            "files_total": len(by_area[area]),
            "deleted": bundle.deleted_files,
            "binary": bundle.binary_files,
            "truncated": bundle.truncated_files,
            "token_estimate": bundle.token_estimate,
            "cap": cap_tokens,
        }

    (run_dir / "bundles" / "manifest.json").write_text(
        json.dumps(manifest, indent=2), encoding="utf-8"
    )
    return bundles


# ---------------------------------------------------------------------------
# CLI entry — `python -m habakkuk.stages.compress`
# ---------------------------------------------------------------------------

def cli_main() -> int:
    import argparse, sys
    p = argparse.ArgumentParser()
    p.add_argument("--repo", required=True, type=pathlib.Path)
    p.add_argument("--base", required=True)
    p.add_argument("--head", required=True)
    p.add_argument("--run-dir", required=True, type=pathlib.Path)
    args = p.parse_args()

    files = list_diff_files(args.base, args.head, args.repo)
    bundles = compress(files=files, run_dir=args.run_dir)
    for area, b in bundles.items():
        print(f"{area:18}  files={len(b.file_paths):3d}  est_tokens={b.token_estimate:6d}  truncated={len(b.truncated_files)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(cli_main())
