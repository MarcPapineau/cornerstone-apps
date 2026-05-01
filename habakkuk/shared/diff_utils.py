"""
Git diff helpers.

Pure subprocess wrappers — no LLM. Used by COMPRESS (build bundles) and
VERIFY (look up snippets by file + line range from the actual repo).
"""

from __future__ import annotations

import os
import pathlib
import re
import subprocess
from collections import Counter
from dataclasses import dataclass


# ---------------------------------------------------------------------------
# Language detection (used for "sort by language frequency" in COMPRESS)
# ---------------------------------------------------------------------------

EXT_TO_LANG = {
    ".py": "python", ".js": "js", ".jsx": "js", ".ts": "ts", ".tsx": "ts",
    ".html": "html", ".css": "css", ".scss": "css",
    ".md": "markdown", ".docx": "binary",
    ".json": "json", ".yml": "yaml", ".yaml": "yaml", ".toml": "toml",
    ".sh": "shell", ".bash": "shell", ".zsh": "shell",
    ".go": "go", ".rs": "rust", ".rb": "ruby", ".java": "java",
    ".c": "c", ".cpp": "cpp", ".h": "c", ".hpp": "cpp",
    ".sql": "sql",
}


def lang_of(path: str) -> str:
    return EXT_TO_LANG.get(pathlib.Path(path).suffix.lower(), "other")


# ---------------------------------------------------------------------------
# Git ops
# ---------------------------------------------------------------------------

def run_git(args: list[str], repo: pathlib.Path) -> str:
    out = subprocess.run(
        ["git"] + args,
        cwd=str(repo),
        check=True,
        capture_output=True,
        text=True,
    )
    return out.stdout


def get_branch_sha(branch: str, repo: pathlib.Path) -> str:
    return run_git(["rev-parse", branch], repo).strip()


def get_merge_base(base: str, head: str, repo: pathlib.Path) -> str:
    return run_git(["merge-base", base, head], repo).strip()


@dataclass
class DiffFile:
    path: str
    status: str       # A / M / D / R
    additions: int
    deletions: int
    is_binary: bool
    diff_text: str    # full unified-diff hunk text for this file (empty for binary/deleted)
    language: str

    @property
    def is_deleted(self) -> bool:
        return self.status == "D"

    @property
    def total_lines(self) -> int:
        return self.additions + self.deletions


def list_diff_files(base: str, head: str, repo: pathlib.Path) -> list[DiffFile]:
    """Returns one record per changed file. Binary + deleted are flagged."""
    numstat = run_git(["diff", "--numstat", f"{base}...{head}"], repo)
    name_status = run_git(["diff", "--name-status", f"{base}...{head}"], repo)

    status_map: dict[str, str] = {}
    for line in name_status.splitlines():
        parts = line.split("\t")
        if len(parts) >= 2:
            status_map[parts[-1]] = parts[0][0]

    files: list[DiffFile] = []
    for line in numstat.splitlines():
        parts = line.split("\t")
        if len(parts) < 3:
            continue
        adds_s, dels_s, path = parts[0], parts[1], parts[2]
        is_binary = adds_s == "-" and dels_s == "-"
        adds = 0 if is_binary else int(adds_s or 0)
        dels = 0 if is_binary else int(dels_s or 0)
        status = status_map.get(path, "M")

        diff_text = ""
        if not is_binary and status != "D":
            try:
                diff_text = run_git(
                    ["diff", f"{base}...{head}", "--", path], repo
                )
            except subprocess.CalledProcessError:
                diff_text = ""

        files.append(DiffFile(
            path=path,
            status=status,
            additions=adds,
            deletions=dels,
            is_binary=is_binary,
            diff_text=diff_text,
            language=lang_of(path),
        ))
    return files


def language_frequency(files: list[DiffFile]) -> Counter[str]:
    return Counter(f.language for f in files if not f.is_binary and not f.is_deleted)


# ---------------------------------------------------------------------------
# Snippet lookup (used by VERIFY)
# ---------------------------------------------------------------------------

def read_repo_lines(repo: pathlib.Path, file: str, line_start: int, line_end: int) -> str | None:
    """Look up `file` in the repo (HEAD) and return lines [line_start..line_end]
    inclusive. Returns None if file not found or range invalid."""
    target = repo / file
    if not target.is_file():
        return None
    try:
        text = target.read_text(encoding="utf-8", errors="replace")
    except Exception:
        return None
    lines = text.splitlines()
    if line_start < 1 or line_end < line_start or line_start > len(lines):
        return None
    end = min(line_end, len(lines))
    return "\n".join(lines[line_start - 1:end])


# ---------------------------------------------------------------------------
# Diff metadata for the PLAN stage (no diff text — just paths + counts)
# ---------------------------------------------------------------------------

@dataclass
class PlanInput:
    branch: str
    base: str
    head_sha: str
    base_sha: str
    title: str
    file_count: int
    additions: int
    deletions: int
    languages: dict[str, int]
    files: list[dict]

    def to_user_prompt(self) -> str:
        """Compact text the PLAN-stage Opus 4.7 sees. ZERO diff content."""
        lines: list[str] = [
            f"Branch under review: {self.branch}",
            f"Base branch: {self.base}",
            f"Head SHA: {self.head_sha}",
            f"Base SHA: {self.base_sha}",
            f"Title: {self.title}",
            f"Files changed: {self.file_count}",
            f"Additions: {self.additions}",
            f"Deletions: {self.deletions}",
            "",
            "Languages by file count: " + ", ".join(
                f"{k}={v}" for k, v in sorted(
                    self.languages.items(), key=lambda x: -x[1]
                )
            ),
            "",
            "File index (path, status, +adds/-dels, language):",
        ]
        for f in self.files[:200]:  # cap so PLAN never overflows even on huge PRs
            lines.append(
                f"- {f['path']} [{f['status']}] +{f['additions']}/-{f['deletions']} {f['language']}"
            )
        if len(self.files) > 200:
            lines.append(f"... ({len(self.files) - 200} more files truncated)")
        return "\n".join(lines)


def build_plan_input(branch: str, base: str, repo: pathlib.Path, title: str = "") -> PlanInput:
    head_sha = get_branch_sha(branch, repo)
    base_sha = get_branch_sha(base, repo)
    files = list_diff_files(base, branch, repo)
    return PlanInput(
        branch=branch,
        base=base,
        head_sha=head_sha,
        base_sha=base_sha,
        title=title or branch,
        file_count=len(files),
        additions=sum(f.additions for f in files),
        deletions=sum(f.deletions for f in files),
        languages=dict(language_frequency(files)),
        files=[
            {
                "path": f.path,
                "status": f.status,
                "additions": f.additions,
                "deletions": f.deletions,
                "language": f.language,
                "is_binary": f.is_binary,
            }
            for f in files
        ],
    )
