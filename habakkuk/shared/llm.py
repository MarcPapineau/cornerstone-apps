"""
Anthropic SDK wrapper with Langfuse instrumentation.

Every LLM call goes through `complete()`. Token cap is asserted before the
network call. If Langfuse env vars are present, a span is created with
prompt-tokens / completion-tokens / cache-hits attached.

If Langfuse is not configured (no env vars or module not installed),
instrumentation degrades to a local JSONL telemetry log under the run
directory — Habakkuk still runs, the spec just records "langfuse-disabled"
in the run metadata. This keeps Habakkuk debuggable in offline / mac-only
contexts while preserving the trace pattern.
"""

from __future__ import annotations

import json
import os
import pathlib
import time
import uuid
from dataclasses import dataclass
from typing import Any

import anthropic

from .config import PROMPT_TOKEN_CAP, assert_under_cap

# ---------------------------------------------------------------------------
# Langfuse — optional. Falls back to local JSONL trace.
# ---------------------------------------------------------------------------

_LF_CLIENT = None
_LF_AVAILABLE = False
try:
    from langfuse import Langfuse  # type: ignore
    if os.environ.get("LANGFUSE_PUBLIC_KEY") and os.environ.get("LANGFUSE_SECRET_KEY"):
        _LF_CLIENT = Langfuse(
            public_key=os.environ["LANGFUSE_PUBLIC_KEY"],
            secret_key=os.environ["LANGFUSE_SECRET_KEY"],
            host=os.environ.get("LANGFUSE_HOST", "https://cloud.langfuse.com"),
        )
        _LF_AVAILABLE = True
except Exception:
    _LF_AVAILABLE = False


@dataclass
class LLMCall:
    stage: str
    model: str
    input_tokens: int
    output_tokens: int
    cache_read_tokens: int
    cache_write_tokens: int
    duration_ms: int
    finding_count: int | None = None


def _local_trace(run_dir: pathlib.Path, record: dict[str, Any]) -> None:
    """Append a one-line JSON record to <run_dir>/telemetry.jsonl. Always
    runs whether or not Langfuse is wired."""
    run_dir.mkdir(parents=True, exist_ok=True)
    path = run_dir / "telemetry.jsonl"
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")


def langfuse_status() -> dict[str, Any]:
    return {
        "available": _LF_AVAILABLE,
        "host": os.environ.get("LANGFUSE_HOST", "https://cloud.langfuse.com") if _LF_AVAILABLE else None,
    }


# ---------------------------------------------------------------------------
# Client
# ---------------------------------------------------------------------------

_anthropic_client: anthropic.Anthropic | None = None


def get_client() -> anthropic.Anthropic:
    global _anthropic_client
    if _anthropic_client is None:
        _anthropic_client = anthropic.Anthropic()
    return _anthropic_client


def complete(
    *,
    stage: str,
    model: str,
    system: str,
    user: str,
    run_dir: pathlib.Path,
    max_tokens: int = 8000,
    temperature: float = 0.0,
    trace_id: str | None = None,
    cache_system: bool = True,
) -> dict[str, Any]:
    """
    Hard-capped Anthropic SDK call with Langfuse + local telemetry.

    Returns a dict with `text`, `usage`, `model`, and `trace_id`.
    Raises RuntimeError if the prompt would exceed PROMPT_TOKEN_CAP.
    """
    # ---- token cap (hard-fail) ---------------------------------------------
    combined = system + "\n\n" + user
    assert_under_cap(combined, cap=PROMPT_TOKEN_CAP, label=f"{stage}/system+user")

    trace_id = trace_id or str(uuid.uuid4())

    # ---- Langfuse span (optional) ------------------------------------------
    lf_span = None
    if _LF_AVAILABLE and _LF_CLIENT is not None:
        try:
            lf_span = _LF_CLIENT.generation(
                trace_id=trace_id,
                name=f"habakkuk.{stage}",
                model=model,
                input={"system": system[:2000], "user": user[:4000]},
                metadata={"stage": stage},
            )
        except Exception:
            lf_span = None

    # ---- API call ----------------------------------------------------------
    t0 = time.time()
    client = get_client()

    system_block: list[dict[str, Any]] | str
    if cache_system:
        # Prompt caching: system is stable across fan-out calls within a run,
        # so we mark it as ephemeral cache. Big win for the 6 fan-out agents
        # which share preamble + rubric template.
        system_block = [
            {"type": "text", "text": system, "cache_control": {"type": "ephemeral"}},
        ]
    else:
        system_block = system

    msg = client.messages.create(
        model=model,
        max_tokens=max_tokens,
        temperature=temperature,
        system=system_block,
        messages=[{"role": "user", "content": user}],
    )
    duration_ms = int((time.time() - t0) * 1000)

    text = "".join(b.text for b in msg.content if getattr(b, "type", None) == "text")

    usage = {
        "input_tokens": getattr(msg.usage, "input_tokens", 0),
        "output_tokens": getattr(msg.usage, "output_tokens", 0),
        "cache_read_input_tokens": getattr(msg.usage, "cache_read_input_tokens", 0) or 0,
        "cache_creation_input_tokens": getattr(msg.usage, "cache_creation_input_tokens", 0) or 0,
    }

    # ---- close Langfuse span -----------------------------------------------
    if lf_span is not None:
        try:
            lf_span.end(
                output={"text": text[:4000]},
                usage_details=usage,
                metadata={"duration_ms": duration_ms},
            )
        except Exception:
            pass

    # ---- local telemetry (always) ------------------------------------------
    _local_trace(
        run_dir,
        {
            "stage": stage,
            "trace_id": trace_id,
            "model": model,
            "duration_ms": duration_ms,
            "usage": usage,
            "lang_fuse": _LF_AVAILABLE,
            "ts": time.time(),
        },
    )

    return {
        "text": text,
        "usage": usage,
        "model": model,
        "trace_id": trace_id,
        "duration_ms": duration_ms,
    }


def langfuse_trace_url(trace_id: str) -> str:
    if not _LF_AVAILABLE:
        return "(langfuse-disabled — see telemetry.jsonl)"
    host = os.environ.get("LANGFUSE_HOST", "https://cloud.langfuse.com")
    project = os.environ.get("LANGFUSE_PROJECT", "")
    if project:
        return f"{host}/project/{project}/traces/{trace_id}"
    return f"{host}/trace/{trace_id}"


def flush_langfuse() -> None:
    if _LF_AVAILABLE and _LF_CLIENT is not None:
        try:
            _LF_CLIENT.flush()
        except Exception:
            pass
