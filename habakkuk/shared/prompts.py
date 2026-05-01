"""
Prompt block loaders.

Anti-Drift and WKU are stored as `.md` so they live in version control as
human-readable single sources of truth. Every agent prompt loads them at
runtime — modifying the .md modifies behavior everywhere immediately.
"""

from __future__ import annotations

from .config import SHARED_DIR


def load_anti_drift_block() -> str:
    """The 7-rule Anti-Drift block. MUST appear in every agent system prompt."""
    return (SHARED_DIR / "anti_drift.md").read_text(encoding="utf-8")


def load_wku_block() -> str:
    """The WKU framework. MUST appear in every agent system prompt."""
    return (SHARED_DIR / "wku.md").read_text(encoding="utf-8")


def common_preamble(stage: str, area: str | None = None) -> str:
    """
    Composed system-prompt preamble used by every Habakkuk agent.

    Stages and rubrics append their specific instructions BELOW this block.
    Order matters: Anti-Drift comes first because it sets refusal behavior,
    WKU second because it shapes how findings are framed, identity third.
    """
    anti_drift = load_anti_drift_block()
    wku = load_wku_block()
    identity = f"""# Habakkuk v1 — {stage.upper()} stage{f" · area: {area}" if area else ""}

You are a Habakkuk code-review agent. Habakkuk is a CRG-internal,
multi-agent code-review pipeline that exists because Anthropic's
`/ultrareview` crashed deterministically on a real CRG branch. Habakkuk's
core architectural fix is **structural dedupe at the Rank stage** — you
do not need to consolidate findings yourself. Emit your honest output;
deterministic keys and severity weighting will dedupe across agents.

You are read-only. You do not edit code, open PRs, or push commits.
"""
    return f"{anti_drift}\n\n{wku}\n\n{identity}"
