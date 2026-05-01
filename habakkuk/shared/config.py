"""
Habakkuk shared configuration.

Single source of truth for paths, model IDs, token caps, and area names.
All stages and tests import from here.
"""

from __future__ import annotations

import os
import pathlib
from typing import Final

# ---------------------------------------------------------------------------
# Paths (Memory hand-off — every stage reads/writes from disk, never inline)
# ---------------------------------------------------------------------------

HABAKKUK_HOME: Final[pathlib.Path] = pathlib.Path(
    os.environ.get("HABAKKUK_HOME", str(pathlib.Path.home() / ".openclaw" / "habakkuk"))
)
RUNS_DIR: Final[pathlib.Path] = HABAKKUK_HOME / "runs"
RUBRICS_DIR: Final[pathlib.Path] = HABAKKUK_HOME / "rubrics"

REPO_ROOT: Final[pathlib.Path] = pathlib.Path(__file__).resolve().parents[2]
HABAKKUK_REPO: Final[pathlib.Path] = REPO_ROOT / "habakkuk"
SHARED_DIR: Final[pathlib.Path] = HABAKKUK_REPO / "shared"
RUBRICS_SOURCE_DIR: Final[pathlib.Path] = HABAKKUK_REPO / "rubrics"
SCRIPTS_DIR: Final[pathlib.Path] = REPO_ROOT / "scripts"
MD_TO_DOCX: Final[pathlib.Path] = SCRIPTS_DIR / "md-to-docx.sh"

# ---------------------------------------------------------------------------
# Models (per CRG model-selection doctrine — no Haiku, default Sonnet 4.6,
# Opus 4.7 for Plan + Rank where deeper reasoning matters)
# ---------------------------------------------------------------------------

# Live-verified model IDs (probed via SDK on 2026-05-01).
# - claude-opus-4-7 :: PLAN, RANK (deepest reasoning, smallest token footprint)
# - claude-sonnet-4-6 :: FANOUT, VERIFY, PRESENT (default workhorse)
# Override via env if Anthropic ships newer IDs.
MODEL_PLAN: Final[str] = os.environ.get("HABAKKUK_MODEL_PLAN", "claude-opus-4-7")
MODEL_FANOUT: Final[str] = os.environ.get("HABAKKUK_MODEL_FANOUT", "claude-sonnet-4-6")
MODEL_VERIFY: Final[str] = os.environ.get("HABAKKUK_MODEL_VERIFY", "claude-sonnet-4-6")
MODEL_RANK: Final[str] = os.environ.get("HABAKKUK_MODEL_RANK", "claude-opus-4-7")
MODEL_PRESENT: Final[str] = os.environ.get("HABAKKUK_MODEL_PRESENT", "claude-sonnet-4-6")

# ---------------------------------------------------------------------------
# Token budgets (HARD LIMIT — exceeding these is a build failure)
# ---------------------------------------------------------------------------

PROMPT_TOKEN_CAP: Final[int] = 32_000
BUNDLE_TOKEN_CAP: Final[int] = 24_000
PROMPT_HEADROOM: Final[int] = 8_000  # 32K - 24K reserved for system + rubric + JSON
SNIPPET_TOKEN_CAP: Final[int] = 60
SUGGESTED_FIX_CHAR_CAP: Final[int] = 200

# Rough char-per-token used for Python-side estimation when no tokenizer is
# wired. Conservative (overcounts) — anthropic's tokenizer averages ~3.5-4.
CHARS_PER_TOKEN: Final[int] = 4

# ---------------------------------------------------------------------------
# Confidence + verification thresholds
# ---------------------------------------------------------------------------

VERIFY_DROP_BELOW: Final[float] = 0.7
RANK_INCONCLUSIVE_DROP: Final[bool] = True

# ---------------------------------------------------------------------------
# Areas (the six fan-out lanes)
# ---------------------------------------------------------------------------

AREAS: Final[tuple[str, ...]] = (
    "security",
    "perf",
    "ux-a11y",
    "data-integrity",
    "api-contracts",
    "tests-coverage",
)

# CRG-area severity weighting used at Rank stage (data-integrity > security
# > UX > perf, with api-contracts riding alongside data, tests trailing perf).
AREA_WEIGHT: Final[dict[str, float]] = {
    "data-integrity": 1.00,
    "api-contracts": 0.95,
    "security": 0.90,
    "ux-a11y": 0.75,
    "perf": 0.65,
    "tests-coverage": 0.55,
}

SEVERITY_RANK: Final[dict[str, int]] = {
    "Blocker": 4,
    "Major": 3,
    "Minor": 2,
    "Nit": 1,
}


def estimate_tokens(text: str) -> int:
    """Cheap character-based token estimate. Overcounts by ~10%, which is
    what we want for a hard cap — false positives are safer than blowups."""
    return max(1, len(text) // CHARS_PER_TOKEN)


def assert_under_cap(text: str, cap: int = PROMPT_TOKEN_CAP, label: str = "prompt") -> int:
    """Hard fail if `text` would exceed `cap` tokens. Returns the estimate."""
    n = estimate_tokens(text)
    if n > cap:
        raise RuntimeError(
            f"HABAKKUK_TOKEN_CAP_EXCEEDED: {label} estimated at {n} tokens, "
            f"cap is {cap}. Compress or split before retrying."
        )
    return n


def ensure_dirs() -> None:
    """Idempotent. Called by every stage on startup."""
    RUNS_DIR.mkdir(parents=True, exist_ok=True)
    RUBRICS_DIR.mkdir(parents=True, exist_ok=True)
