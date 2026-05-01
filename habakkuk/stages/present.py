"""
PRESENT stage — Sonnet 4.6.

Renders Marc-facing brief in `.docx` (per CRG doc-format rule). The brief
itself is markdown; conversion to .docx happens via the existing
workspace/scripts/md-to-docx.sh shell script.

Layout (top to bottom):
  1. Executive summary (3 bullets, plain English, from RANK)
  2. Run metadata (branch, head SHA, base SHA, file count, Langfuse trace,
     timestamps, model usage table)
  3. Blockers section (if any) — most-severe first, full claim+fix
  4. Majors section
  5. Minors + Nits (compact one-line-per-finding format)
  6. Per-file index — every file touched by a finding, with the finding
     IDs that landed on it
  7. Notes on set
  8. Out-of-scope decisions (from rank meta)

Sonnet's job here is to humanize the claims (the upstream agents wrote
JSON-friendly terse language). No new findings, no reordering, no
severity changes.
"""

from __future__ import annotations

import datetime as dt
import json
import os
import pathlib
import subprocess
from collections import defaultdict

from ..shared.config import (
    MD_TO_DOCX, MODEL_PRESENT, ensure_dirs,
)
from ..shared.llm import complete, langfuse_trace_url


PRESENT_SYSTEM_TEMPLATE = """{preamble}

## Your task — PRESENT stage

You are rendering the FINAL Marc-facing brief. Marc is an executive who
reads briefs in Word — he is NOT going to debug code. Your job is to
take terse JSON findings and turn them into a clean markdown brief that
will convert to .docx.

ABSOLUTE RULES:
- Do NOT add findings. Do NOT remove findings. Do NOT change severities.
- Do NOT invent file paths or line numbers.
- For each finding, render claim + suggested_fix in clean prose.
  Convert "snake_case_jargon" to "snake-case jargon" or plain English.
- Preserve the exact ordering you receive — it's already priority-sorted.

Brief structure (output exactly this layout, exactly these H2 headings):

# Habakkuk Code Review — {{branch}}

**Generated:** {{timestamp}}
**Head:** `{{head_sha}}`
**Base:** `{{base_sha}}`

## Executive summary

{{executive_summary as 3 bullets}}

## Run metadata

(table will be inserted by the renderer — leave a placeholder line that
says exactly: <!-- RUN_METADATA_TABLE -->)

## Blockers

(rendered for each Blocker finding. Format:
### {{n}}. {{file}}:{{line_start}}-{{line_end}}  ·  {{area}}  ·  conf {{confidence}}
{{prose claim}}

**Suggested fix:** {{prose suggested_fix}}

```
{{snippet, fenced}}
```
)

If no Blockers: write "No Blockers." and skip to next section.

## Majors

(same format as Blockers)

If none: write "No Majors."

## Minors

(compact format — one line per finding:
- `{{file}}:{{line_start}}` ({{area}}) — {{prose claim}})

If none: write "No Minors."

## Nits

(same compact format as Minors. If none: "No Nits.")

## Per-file index

(placeholder line — renderer inserts: <!-- PER_FILE_INDEX -->)

## Notes on the set

(render notes_on_set as a bulleted list. If empty: omit the entire H2.)

OUTPUT — markdown only. No code fences around the entire output. Begin
with the H1, end after the last H2 you generated.
"""


def _build_metadata_table(meta: dict) -> str:
    rows = [
        ("Branch", meta.get("branch", "")),
        ("Base", meta.get("base", "")),
        ("Head SHA", meta.get("head_sha", "")[:12]),
        ("Base SHA", meta.get("base_sha", "")[:12]),
        ("Files changed", str(meta.get("file_count", 0))),
        ("Total +/-", f"+{meta.get('additions',0)} / -{meta.get('deletions',0)}"),
        ("Stages run", "PLAN, COMPRESS, FAN-OUT(6), VERIFY, RANK, PRESENT"),
        ("Verified findings", str(meta.get("verified_count", 0))),
        ("Wall time", f"{meta.get('wall_time_s', 0):.1f}s"),
        ("Langfuse trace", meta.get("langfuse_trace_url", "(disabled)")),
        ("Run dir", meta.get("run_dir", "")),
        ("Habakkuk git ref", meta.get("habakkuk_git_ref", "(uncommitted)")),
    ]
    out = ["| Field | Value |", "|---|---|"]
    for k, v in rows:
        out.append(f"| {k} | {v} |")
    return "\n".join(out)


def _build_per_file_index(findings: list[dict]) -> str:
    by_file: dict[str, list[dict]] = defaultdict(list)
    for f in findings:
        by_file[f["file"]].append(f)
    if not by_file:
        return "_No files flagged._"
    out = []
    for path in sorted(by_file.keys()):
        items = by_file[path]
        sev_counts = defaultdict(int)
        for f in items:
            sev_counts[f["severity"]] += 1
        sev_str = ", ".join(
            f"{n}{s[0]}" for s, n in sev_counts.items() if n > 0
        )  # e.g. "2B, 3M"
        out.append(f"- `{path}` ({sev_str})")
        for f in items:
            out.append(
                f"    - L{f['line_start']}-{f['line_end']} ({f['area']}) — {f['claim'][:120]}"
            )
    return "\n".join(out)


def _convert_to_docx(md_path: pathlib.Path) -> pathlib.Path | None:
    """Best-effort conversion. Failures are logged but not fatal — the .md
    is the canonical artifact, the .docx is the Marc-facing wrapper."""
    if not MD_TO_DOCX.exists():
        return None
    try:
        subprocess.run(
            ["bash", str(MD_TO_DOCX), str(md_path)],
            check=True,
            capture_output=True,
            text=True,
            timeout=60,
        )
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
        return None
    docx = md_path.with_suffix(".docx")
    return docx if docx.exists() else None


def run_present(
    *,
    run_dir: pathlib.Path,
    branch: str,
    base: str,
    head_sha: str,
    base_sha: str,
    file_count: int,
    additions: int,
    deletions: int,
    wall_time_s: float,
    habakkuk_git_ref: str,
    trace_id: str | None = None,
) -> dict:
    from ..shared.prompts import common_preamble

    ensure_dirs()
    ranked_path = run_dir / "ranked.json"
    if not ranked_path.exists():
        raise FileNotFoundError(f"PRESENT stage requires {ranked_path}")
    payload = json.loads(ranked_path.read_text(encoding="utf-8"))
    findings = payload.get("findings", []) or []
    summary = payload.get("executive_summary", []) or ["(no findings to summarize)"]
    notes = payload.get("notes_on_set", []) or []

    # Bucket findings by severity for the present-stage prompt
    by_sev = defaultdict(list)
    for f in findings:
        by_sev[f.get("severity", "Nit")].append(f)

    preamble = common_preamble("present")
    system = PRESENT_SYSTEM_TEMPLATE.format(preamble=preamble)

    timestamp_iso = dt.datetime.now(dt.timezone.utc).astimezone().isoformat(timespec="seconds")

    user_payload = {
        "branch": branch,
        "timestamp": timestamp_iso,
        "head_sha": head_sha,
        "base_sha": base_sha,
        "executive_summary": summary,
        "blockers": by_sev.get("Blocker", []),
        "majors": by_sev.get("Major", []),
        "minors": by_sev.get("Minor", []),
        "nits": by_sev.get("Nit", []),
        "notes_on_set": notes,
    }
    user = json.dumps(user_payload, indent=2, ensure_ascii=False)

    if findings:
        result = complete(
            stage="present",
            model=MODEL_PRESENT,
            system=system,
            user=user,
            run_dir=run_dir,
            max_tokens=4096,
            temperature=0.1,
            trace_id=trace_id,
        )
        md = result["text"].strip()
        present_meta = {
            "model": result["model"],
            "trace_id": result["trace_id"],
            "usage": result["usage"],
            "duration_ms": result["duration_ms"],
        }
    else:
        # No findings: skip the LLM, render a minimal "all clear" brief.
        md = (
            f"# Habakkuk Code Review — {branch}\n\n"
            f"**Generated:** {timestamp_iso}\n"
            f"**Head:** `{head_sha}`\n"
            f"**Base:** `{base_sha}`\n\n"
            "## Executive summary\n\n"
            "- No verified findings.\n"
            "- The pipeline ran end-to-end without surfacing any blockers, majors, "
            "minors, or nits at confidence ≥ 0.7.\n"
            "- Re-run with a wider confidence threshold if a deeper sweep is wanted.\n\n"
            "## Run metadata\n\n<!-- RUN_METADATA_TABLE -->\n\n"
            "## Blockers\n\nNo Blockers.\n\n"
            "## Majors\n\nNo Majors.\n\n"
            "## Minors\n\nNo Minors.\n\n"
            "## Nits\n\nNo Nits.\n\n"
            "## Per-file index\n\n<!-- PER_FILE_INDEX -->\n"
        )
        present_meta = {"model": "(skipped — no findings)", "usage": {}, "duration_ms": 0}

    # ---- Inject placeholders ---------------------------------------------
    metadata_md = {
        "branch": branch, "base": base, "head_sha": head_sha, "base_sha": base_sha,
        "file_count": file_count, "additions": additions, "deletions": deletions,
        "verified_count": len(findings),
        "wall_time_s": wall_time_s,
        "langfuse_trace_url": langfuse_trace_url(trace_id) if trace_id else "(no trace)",
        "run_dir": str(run_dir),
        "habakkuk_git_ref": habakkuk_git_ref,
    }
    md = md.replace("<!-- RUN_METADATA_TABLE -->", _build_metadata_table(metadata_md))
    md = md.replace("<!-- PER_FILE_INDEX -->", _build_per_file_index(findings))

    md_path = run_dir / "brief.md"
    md_path.write_text(md, encoding="utf-8")

    docx_path = _convert_to_docx(md_path)

    meta = {
        "stage": "present",
        **present_meta,
        "md_path": str(md_path),
        "docx_path": str(docx_path) if docx_path else None,
        "findings_in_brief": len(findings),
    }
    (run_dir / "present.meta.json").write_text(
        json.dumps(meta, indent=2), encoding="utf-8"
    )
    return meta
