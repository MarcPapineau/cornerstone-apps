"""
Finding + run-record schemas.

Pure dataclass-style typed dicts — no validation library dependency. Every
stage validates with `validate_finding()` before writing JSON to disk.
"""

from __future__ import annotations

import hashlib
import json
import pathlib
from typing import Any, Literal

Severity = Literal["Blocker", "Major", "Minor", "Nit"]


def make_finding_id(file: str, line_start: int, claim: str, area: str) -> str:
    """
    Deterministic finding ID. Two agents producing the SAME claim about the
    SAME line of the SAME file collide on this key — that's the structural
    dedupe Habakkuk relies on instead of an LLM consolidation step.
    """
    payload = f"{area}|{file}|{line_start}|{claim.strip().lower()}"
    return "f_" + hashlib.sha1(payload.encode("utf-8")).hexdigest()[:12]


def claim_hash(file: str, line_start: int, claim: str) -> str:
    """Cross-area dedupe key (without area prefix). Used at Rank stage."""
    payload = f"{file}|{line_start}|{claim.strip().lower()}"
    return hashlib.sha1(payload.encode("utf-8")).hexdigest()[:16]


REQUIRED_FINDING_KEYS = (
    "id", "severity", "area", "file", "line_start", "line_end",
    "snippet", "claim", "suggested_fix", "confidence",
)


def validate_finding(f: dict[str, Any]) -> tuple[bool, str]:
    """Returns (ok, reason). Used by Verify stage and tests."""
    for k in REQUIRED_FINDING_KEYS:
        if k not in f:
            return False, f"missing key: {k}"
    if f["severity"] not in ("Blocker", "Major", "Minor", "Nit"):
        return False, f"bad severity: {f['severity']!r}"
    if not isinstance(f["confidence"], (int, float)):
        return False, "confidence not numeric"
    if not (0.0 <= float(f["confidence"]) <= 1.0):
        return False, f"confidence out of range: {f['confidence']}"
    if not isinstance(f["line_start"], int) or not isinstance(f["line_end"], int):
        return False, "line numbers not integers"
    if f["line_end"] < f["line_start"]:
        return False, "line_end < line_start"
    if not f.get("file") or not isinstance(f["file"], str):
        return False, "file empty or non-string"
    if not f.get("claim"):
        return False, "claim empty"
    return True, "ok"


def write_findings(path: pathlib.Path, findings: list[dict[str, Any]]) -> None:
    """Atomic write — writes to .tmp then renames so partial writes never
    leak between stages."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(findings, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp.replace(path)


def read_findings(path: pathlib.Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    return json.loads(path.read_text(encoding="utf-8"))
