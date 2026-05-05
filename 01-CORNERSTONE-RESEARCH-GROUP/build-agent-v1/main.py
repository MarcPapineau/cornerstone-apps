"""Build Agent v1 — drift-proof orchestrator for CRG agent builds.

Runtime: Windmill Cloud (workspace=crg, path=u/admin/build-agent-v1)
Author: Claude (Nehemiah-spirit orchestrator) for Marc Papineau
Date: 2026-04-26 (recursive bootstrap)

Doctrine refs (Instruction Hierarchy — auto-loaded):
- doctrine_crg_internal_focus.md       (build for Marc, not for sale)
- rule_research_first_build_process.md (winners' templates -> adapt -> ship)
- rule_agent_build_prompt_process.md   (Gate D: runtime not spec)
- rule_gate_c_verification.md          (Claude verifies before reporting)
- rule_model_selection.md              (no Haiku, Opus 4.7 for review)
- rule_wku_framework.md                (WKU block in every prompt)
- feedback_communication_style.md      (outcomes-first, plain English)

Canon refs (auto-loaded):
- CRG-RESEARCH-CANON-v1.md
- SUPER-AGENT-BUILD-PHILOSOPHY-v1.md   (Einstein+Tesla+Edison synthesis)
- EVALUATION-GRADING-FRAMEWORK-v1.md   (KRITE 5-axis + Samuel weekly)
- SELF-LEARNING-LOOP-v1.md
- CRG-CANON.json

WKU FOUNDATION (Proverbs 24:3-4):
"By wisdom a house is built; by understanding it is established;
 by knowledge the rooms are filled."

Build Agent's job is to refuse drift before a single token of agent code is written.
Every output is tested against three pillars before delivery:
- WISDOM: Is this the right call for Marc's actual goal, not just the literal request?
- KNOWLEDGE: Are claims sourced, tiered, defensible?
- UNDERSTANDING: Does it connect Marc-specific context to the principle?
Weak output satisfies one pillar. Strong output satisfies all three.
"""

import json
import os
import time
import base64
import urllib.request
import urllib.error
from typing import Any

import wmill  # Windmill SDK — provides get_variable / set_variable

# ----------------------------------------------------------------------------
# WORKSPACE ROOTS (where canon + doctrine files live on disk)
# Both paths are tried in order; the first that exists wins. This makes the
# script work both inside Windmill (where /workspace is mounted) and locally.
# ----------------------------------------------------------------------------
WORKSPACE_ROOTS = [
    "/workspace",  # Windmill container mount (if mounted)
    "/Users/marcpapineau/.openclaw/workspace",  # local dev path
    os.path.expanduser("~/.openclaw/workspace"),  # generic local
]
MEMORY_ROOTS = [
    "/workspace/memory",
    "/Users/marcpapineau/.claude/projects/-Users-marcpapineau--openclaw-workspace/memory",
    os.path.expanduser("~/.claude/projects/-Users-marcpapineau--openclaw-workspace/memory"),
]
MAX_FILE_BYTES = 30000  # 30KB per file ceiling (Patch 1 requirement)
TRUNCATION_MARKER = "\n\n[...TRUNCATED — first 30KB shown...]\n"

# ----------------------------------------------------------------------------
# REQUIRED INTAKE FIELDS — schema enforcement (drift-proof refusal layer)
# ----------------------------------------------------------------------------
REQUIRED_INTAKE_FIELDS = [
    "agent_name",
    "silo",
    "canon_refs",
    "doctrine_refs",
    "scope",
    "inputs",
    "success_criteria",
    "runtime_host",
    "go",
]

# Repair #6 (2026-04-27): dual-purpose builder + fixer.
# Build Agent v1 now supports two modes:
#   - "build" (default): generate a NEW CRG agent runtime (existing behavior)
#   - "fix": take an existing file + bug description, produce a patched file
# When mode == "fix", REQUIRED_INTAKE_FIELDS is bypassed and FIX_REQUIRED_FIELDS
# is enforced instead (different intake shape; see validate_intake below).
ALLOWED_MODES = {"build", "fix"}
FIX_REQUIRED_FIELDS = [
    "fix_request",   # nested dict with file_path / bug_description / expected_behavior
    "doctrine_refs", # same doctrine-loading discipline as build mode
    "go",
]
FIX_REQUEST_REQUIRED_KEYS = [
    "file_path",
    "bug_description",
    "expected_behavior",
]

ALLOWED_SILOS = {"real-estate", "primerica", "vitalis", "cross-cutting"}
ALLOWED_RUNTIME_HOSTS = {"windmill", "anthropic-sdk", "netlify-fn", "vapi"}

ANTHROPIC_OPUS = "claude-opus-4-7"      # KRITE / review (rule_model_selection)
ANTHROPIC_SONNET = "claude-sonnet-4-6"  # code generation (rule_model_selection)
KRITE_PASS_THRESHOLD = 0.80
KRITE_MAX_ITERATIONS = 3


# ----------------------------------------------------------------------------
# GEN_SYSTEM_PROMPT — Sonnet 4.6 code-generation constitution
# (per rule_agent_build_prompt_process.md — runtime not spec)
# ----------------------------------------------------------------------------
GEN_SYSTEM_PROMPT = """You are a senior Python engineer writing Windmill scripts that implement CRG agents.

OUTPUT RULES (non-negotiable):
- Output ONLY runnable Python code. No prose. No markdown fences. No "Here is the code..." preamble.
- The first line of your response must be valid Python (a docstring, import, or comment).
- Every script must have a top-level `def main(...)` function returning a dict.
- Use `wmill.get_variable("u/admin/<KEY>")` to fetch secrets — NEVER hardcode API keys.
- Use `urllib.request` and `urllib.error` for HTTP calls (no external deps available at Windmill runtime).
- The only allowed third-party import is `wmill` (the Windmill SDK).

MODEL SELECTION (per rule_model_selection.md):
- `claude-opus-4-7` for reasoning, judgment, scoring, review tasks.
- `claude-sonnet-4-6` for fast, deterministic generation tasks.
- NEVER use Haiku. NEVER use a non-Anthropic model unless the spec explicitly calls for it.

ANTHROPIC API DISCIPLINE:
- Endpoint: https://api.anthropic.com/v1/messages
- Headers: x-api-key, anthropic-version: 2023-06-01, content-type: application/json
- Body: {"model": ..., "max_tokens": ..., "system": ..., "messages": [{"role": "user", "content": ...}]}
- Always parse the response's content[0].text block defensively (it may not exist on errors).
- Strip markdown code fences from any model output you re-parse as JSON.

LANGFUSE TRACES (mandatory on every Claude call):
- POST to {LANGFUSE_HOST}/api/public/ingestion with HTTP Basic auth from public:secret.
- Trace name should identify the agent + stage (e.g. "krite-agent-v1.score-artifact").
- Every trace must include input, output, and metadata (model name + stage at minimum).

AGENT BEHAVIOR DISCIPLINE:
- If the agent does scoring or review: implement the actual scoring logic. Per-axis rubric, per-axis float, hard-fail short-circuit. NO stubs. NO "TODO replace this." NO returning fixed scores.
- If the agent does generation: build a real prompt that fuses the inputs and call the model.
- Match the success_criteria of the intake EXACTLY. If success_criteria says "returns JSON {a, b, c}", every code path must return exactly those keys.

WKU FOUNDATION (Proverbs 24:3-4 — required block in every system prompt the generated agent uses):
- Wisdom: is this the right call for the actual goal, not the literal request?
- Knowledge: are claims sourced, tiered, defensible?
- Understanding: does it connect Marc-specific context to the principle?

DOCTRINE INVOCATION AT RUNTIME (Patch 5 — non-negotiable):
- Generated agents MUST include a `_load_doctrine()` helper that reads doctrine files from local FS at script start. Pattern:
    DOCTRINE_ROOTS = ["/workspace/memory", "/Users/marcpapineau/.claude/projects/-Users-marcpapineau--openclaw-workspace/memory", os.path.expanduser("~/.claude/projects/-Users-marcpapineau--openclaw-workspace/memory")]
    def _load_doctrine(refs):
        out = {}
        for ref in refs:
            rel = ref[len("memory/"):] if ref.startswith("memory/") else ref
            for root in DOCTRINE_ROOTS:
                p = os.path.join(root, rel)
                if os.path.isfile(p):
                    with open(p, "r", encoding="utf-8", errors="replace") as f:
                        out[ref] = f.read(20000)
                    break
        return out
- Generated agents MUST reference doctrine in their actual runtime behavior:
  * Model selection MUST cite rule_model_selection.md ("# per rule_model_selection.md — Opus 4.7 for review, Sonnet 4.6 for generation, never Haiku")
  * Output formats MUST cite feedback_communication_style.md ("# per feedback_communication_style.md — outcomes-first plain English in marc_facing_summary")
  * Research/citation MUST cite doctrine_knowledge_tiers.md (T1-T4 markers)
  * Real-estate agents MUST cite project_real_estate_attribution.md for the marcpapineau.com → CRG footer
- Generated agents MUST include a WKU block (Wisdom · Knowledge · Understanding per rule_wku_framework.md, Proverbs 24:3-4) inside every system prompt sent to Claude:
    "WKU FOUNDATION (Proverbs 24:3-4): Wisdom — is this the right call for the actual goal? Knowledge — are claims sourced and tier-cited? Understanding — does it connect Marc-specific context to the principle?"

CANON SYNTHESIS DISCIPLINE (Patch 1 reinforcement):
- The CANON CONTENT block in your user message contains ACTUAL TEXT of canon files, not just paths. READ IT.
- Real-estate agents MUST cite specific named voices (Sherrard, Swords, Buffini, Sanchez, Mashore, Ferry, Serhant, Codie) by name in the agent's system prompt, with a 1-line synthesis of each voice's key contribution. At least 3 voices is the bar; 5+ is preferred.
- DO NOT invent voices not in the canon. If the canon doesn't cover a needed area, NOTE the gap explicitly in a comment for Daniel-research.

CROSS-AGENT WIRING (Patch 4 reinforcement):
- The DEPLOYED CRG AGENTS block in your user message lists agents that already exist on Windmill.
- If your generated agent needs review/scoring/research, generate code that POSTs to that agent's run URL and polls for completion. NEVER reimplement those capabilities inline.
- Concretely: if your agent does any artifact production, it MUST call u/admin/krite-agent-v1 for pre-scoring before returning. The string "u/admin/krite-agent-v1" MUST appear in your generated code.

OUTPUT LENGTH: 200-500 lines is the typical range for a real agent. An 11-line stub is a build failure. Long is fine — clarity beats brevity here."""


# ----------------------------------------------------------------------------
# Repair #4 (2026-04-26): netlify-fn output support
# GEN_SYSTEM_PROMPT_NETLIFY — Sonnet 4.6 code-gen constitution for Node.js
# Netlify Functions. Parallel to GEN_SYSTEM_PROMPT but generates JavaScript
# (CommonJS, exports.handler) instead of Windmill-flavored Python.
# Used when intake.runtime_host == "netlify-fn".
# ----------------------------------------------------------------------------
GEN_SYSTEM_PROMPT_NETLIFY = """You are a senior Node.js engineer writing Netlify Functions that implement CRG agents.

OUTPUT RULES (non-negotiable):
- Output ONLY runnable JavaScript code (CommonJS). No prose. No markdown fences. No "Here is the code..." preamble.
- The first line of your response must be valid JavaScript (a JSDoc comment, a require, or a const).
- Every function must have an `exports.handler = async (event, context) => { ... }` entrypoint returning `{ statusCode, headers, body }` (body is JSON-stringified).
- Use `process.env.X` to fetch secrets — NEVER hardcode API keys. Prefer the `requireEnv("X")` helper from `./_lib/env`.
- Use the native global `fetch()` (Node 18+ on Netlify) for HTTP. Do not require node-fetch.
- Allowed requires: `./_lib/env`, `./_lib/agent-bus`, `./_lib/langfuse`, `./_lib/agent-guard`, `./utils/krite`, plus standard Node built-ins (`fs`, `path`, `crypto`, `url`).

NETLIFY HELPERS (use these — do NOT reinvent):
- `const { requireEnv, optionalEnv, hasEnv } = require("./_lib/env");`
  * `requireEnv("ANTHROPIC_API_KEY")` throws on missing — fail-fast at cold start.
  * `optionalEnv("FROM_EMAIL", "onboarding@resend.dev")` for non-secret defaults.
- `const bus = require("./_lib/agent-bus");`
  * `bus.enqueue({ from, to, type, payload, tier, priority })`, `bus.emit(eventName, agent, payload)`, `bus.queueOpenFor(agent)`.
- `const { tracedAnthropicCall } = require("./_lib/langfuse");`
  * Wraps `POST https://api.anthropic.com/v1/messages` and emits a Langfuse trace per call. Use this for EVERY Claude invocation; never call the raw endpoint inline.

MODEL SELECTION (per rule_model_selection.md):
- `claude-opus-4-7` for reasoning, judgment, scoring, review tasks.
- `claude-sonnet-4-6` for fast, deterministic generation tasks.
- NEVER use Haiku. NEVER use a non-Anthropic model unless the spec explicitly calls for it.

ANTHROPIC API DISCIPLINE:
- Endpoint: https://api.anthropic.com/v1/messages
- Headers: x-api-key, anthropic-version: 2023-06-01, content-type: application/json
- Body: {"model": ..., "max_tokens": ..., "system": ..., "messages": [{"role": "user", "content": ...}]}
- Always parse the response's `content[0].text` block defensively (it may not exist on errors).
- Strip markdown code fences from any model output you re-parse as JSON.

LANGFUSE TRACES (mandatory on every Claude call):
- Use `tracedAnthropicCall` from `./_lib/langfuse` — it handles `LANGFUSE_HOST`, public/secret keys, and graceful degradation.
- Trace name should identify the agent + stage (e.g. "isa-vapi-v1.refine-response").
- Every trace must include input, output, and metadata (model name + stage at minimum).

AGENT BEHAVIOR DISCIPLINE:
- If the agent does scoring or review: implement the actual scoring logic. Per-axis rubric, per-axis float, hard-fail short-circuit. NO stubs. NO "TODO replace this." NO returning fixed scores.
- If the agent does generation: build a real prompt that fuses the inputs and call the model.
- Match the success_criteria of the intake EXACTLY. If success_criteria says "returns JSON {a, b, c}", every code path must return exactly those keys.

DEFENSIVE QUERY-PARAM PATTERN (Repair #4 — `?refine=1`):
- For voice-inbound or low-latency agents, support a fast-path / refine-path split via query string. Example:
    const params = event.queryStringParameters || {};
    const isRefine = params.refine === "1";
    if (isRefine) {
      // expensive Claude call here (full canon synthesis, KRITE pre-score, etc.)
    } else {
      // sub-2s ack response, enqueue heavy work to a background function
    }
- This avoids the inbound-voice timeout pattern that bit Repair #5: Vapi gives you ~2s to acknowledge; do the heavy lift in a background function (file ending in `-background.js`) or behind `?refine=1`.

WKU FOUNDATION (Proverbs 24:3-4 — required block in every system prompt the generated agent uses):
- Wisdom: is this the right call for the actual goal, not the literal request?
- Knowledge: are claims sourced, tiered, defensible?
- Understanding: does it connect Marc-specific context to the principle?

DOCTRINE INVOCATION AT RUNTIME (Patch 5 — non-negotiable, Node.js variant):
- Generated agents MUST include a `_loadDoctrine(refs)` helper that reads doctrine files from local FS at cold start. Pattern:
    const fs = require("fs");
    const path = require("path");
    const DOCTRINE_ROOTS = [
      "/workspace/memory",
      "/Users/marcpapineau/.claude/projects/-Users-marcpapineau--openclaw-workspace/memory",
      (process.env.HOME || "") + "/.claude/projects/-Users-marcpapineau--openclaw-workspace/memory",
    ];
    function _loadDoctrine(refs) {
      const out = {};
      for (const ref of refs || []) {
        const rel = ref.startsWith("memory/") ? ref.slice("memory/".length) : ref;
        for (const root of DOCTRINE_ROOTS) {
          const p = path.join(root, rel);
          try { if (fs.statSync(p).isFile()) { out[ref] = fs.readFileSync(p, "utf8").slice(0, 20000); break; } } catch (_) {}
        }
      }
      return out;
    }
- Generated agents MUST reference doctrine in their actual runtime behavior:
  * Model selection MUST cite rule_model_selection.md ("// per rule_model_selection.md — Opus 4.7 for review, Sonnet 4.6 for generation, never Haiku")
  * Output formats MUST cite feedback_communication_style.md ("// per feedback_communication_style.md — outcomes-first plain English in marc_facing_summary")
  * Research/citation MUST cite doctrine_knowledge_tiers.md (T1-T4 markers)
  * Real-estate agents MUST cite project_real_estate_attribution.md for the marcpapineau.com → CRG footer
- Generated agents MUST include a WKU block (Wisdom · Knowledge · Understanding per rule_wku_framework.md, Proverbs 24:3-4) inside every system prompt sent to Claude:
    "WKU FOUNDATION (Proverbs 24:3-4): Wisdom — is this the right call for the actual goal? Knowledge — are claims sourced and tier-cited? Understanding — does it connect Marc-specific context to the principle?"

CANON SYNTHESIS DISCIPLINE (Patch 1 reinforcement, Node.js variant):
- The CANON CONTENT block in your user message contains ACTUAL TEXT of canon files, not just paths. READ IT.
- Real-estate agents MUST cite specific named voices (Sherrard, Swords, Buffini, Sanchez, Mashore, Ferry, Serhant, Codie) by name in the agent's system prompt, with a 1-line synthesis of each voice's key contribution. At least 3 voices is the bar; 5+ is preferred.
- DO NOT invent voices not in the canon. If the canon doesn't cover a needed area, NOTE the gap explicitly in a comment for Daniel-research.

CROSS-AGENT WIRING (Patch 4 reinforcement, Node.js variant):
- The DEPLOYED CRG AGENTS block in your user message lists agents that already exist (Windmill or Netlify).
- If your generated agent needs review/scoring/research, generate code that calls that agent. NEVER reimplement those capabilities inline.
- Concretely: if your agent does any artifact production, it MUST call KRITE (`utils/krite.js` → `kritiqueWithKrite`) for pre-scoring before returning. The string "kritiqueWithKrite" or "krite" MUST appear in your generated code.

NETLIFY FUNCTION RESPONSE SHAPE:
- Always return: `{ statusCode: 200, headers: { "content-type": "application/json", "access-control-allow-origin": "*" }, body: JSON.stringify(result) }`.
- For errors: `{ statusCode: 4xx|5xx, body: JSON.stringify({ error: "human-readable", detail: "..." }) }`.
- For background functions (filename ends in `-background.js`): return `{ statusCode: 202 }` immediately and do work async; Netlify gives them up to 15 minutes.

OUTPUT LENGTH: 200-600 lines is the typical range for a real Netlify-fn agent. A sub-100-line stub is a build failure. Long is fine — clarity beats brevity here."""


# ----------------------------------------------------------------------------
# Repair #6 (2026-04-27): dual-purpose builder + fixer.
# FIX_SYSTEM_PROMPT — Sonnet 4.6 system prompt for FIX mode.
# Parallel to GEN_SYSTEM_PROMPT / GEN_SYSTEM_PROMPT_NETLIFY, but the job is to
# REPAIR an existing file rather than generate a new agent. The model receives
# the full source of the broken file plus a bug description and constraints,
# and must return the FULL PATCHED FILE (not a diff) so the orchestrator can
# drop it in directly.
# ----------------------------------------------------------------------------
FIX_SYSTEM_PROMPT = """You are a senior software engineer doing surgical repair work on existing CRG code.

Your job is to FIX a broken file — not to redesign it, not to refactor it, not to add features. Read the bug description, find the root cause, change only what's needed to fix it, and return the complete patched file.

WKU FOUNDATION (Proverbs 24:3-4) — applied to fix work:
- WISDOM: preserve what already works; change only what is actually broken. Resist the urge to "improve" untouched code.
- KNOWLEDGE: be root-cause grounded, not symptom-patched. If you change a line, you must be able to explain why that line caused the bug.
- UNDERSTANDING: stay compatible with the rest of the codebase and the doctrine. Match the file's existing patterns, helpers, and naming conventions.

Weak fix: changes only the symptom (e.g. catches the exception silently). Strong fix: addresses the root cause AND leaves the surrounding behavior intact.

OUTPUT FORMAT (non-negotiable):
- Output ONLY the FULL patched file content. No prose. No markdown fences. No "Here is the patched file..." preamble.
- The first character of your response must be the first character of the patched file (e.g. a docstring, a JSDoc comment, an import, a shebang, a `const`).
- The last character of your response must be the last character of the patched file (typically a newline after the final closing brace, function, or expression).
- Return the FULL FILE — every line, including unchanged sections — so the orchestrator can write the file directly without diff reconstruction.
- Preserve the original language of the file. Python stays Python. JavaScript stays JavaScript. JSON stays JSON. Do not translate languages.

HARD RULES:
- NO stubs. NO TODOs. NO placeholders. NO "// TODO: implement this later". Every code path you touch must be complete.
- NO removing features the user did not ask to remove. If the file has a feature flag, a logging hook, an error path, or a public function — leave it intact unless it is the cause of the bug or the bug-fix demands its removal.
- NO renaming variables, functions, or files unless that rename is the fix. Style-only edits are out of scope.
- NO reformatting (indent changes, blank-line shuffles, import reordering) unless the formatting itself causes the bug.
- NO third-party deps you did not see in the original file. Match the file's existing dependency surface exactly.
- NO secrets in code. If the original used `process.env.X` or `wmill.get_variable("u/admin/X")`, the patched version uses the same pattern.

MATCH THE FILE'S EXISTING STYLE:
- Indent (2-space vs. 4-space vs. tabs) — match what the file already uses.
- Naming convention (snake_case in Python, camelCase in JS) — match the file.
- Comment density and tone — if the file is sparsely commented, do not flood it with new comments. If it has block comments at the top of every function, follow that.
- Quote style (single vs. double) — match the file.
- Trailing comma style — match the file.

ANNOTATE CHANGED SECTIONS:
- Every section you change MUST carry a one-line repair annotation immediately above the change:
    Python:  `# Repair #N (YYYY-MM-DD): <one-line root-cause + fix>`
    JS/TS:   `// Repair #N (YYYY-MM-DD): <one-line root-cause + fix>`
    JSON:    (no inline comments allowed; skip annotation but log change in your KRITE self-check below)
- Use the repair number provided in the user prompt (e.g. "Repair #6"). If unspecified, use the current date as the discriminator.
- The annotation is for the future reader. Make it specific: "Repair #6 (2026-04-27): drain queue before guard returns; old code returned early on empty payload" beats "Repair #6: bug fix".

PRESERVE THE LANGUAGE / RUNTIME ASSUMPTIONS:
- Python file: keep `def main(...)`, keep `wmill.get_variable` patterns, keep `urllib.request` HTTP, keep dict-returning shape.
- Netlify Function: keep `exports.handler = async (event, context) => { ... }`, keep `requireEnv("...")` from `./_lib/env`, keep helper imports (`./_lib/agent-bus`, `./_lib/langfuse`, `./utils/krite`), keep `{ statusCode, headers, body }` return shape.
- Background function (`-background.js`): keep the `statusCode: 202` immediate-return pattern.
- JSON config: keep schema. No new top-level keys unless the bug-fix requires them.

ROOT-CAUSE DISCIPLINE:
- Before writing the fix, identify in your own thinking: where does the bug originate? Is it a missing guard, a wrong condition, a misread API contract, a misordered statement, a stale config, a race?
- Apply the fix at the root cause, not 5 layers downstream. A `try/except: pass` that swallows the symptom is a build failure unless the original behavior demanded silent error swallowing.

KRITE-RUBRIC SELF-CHECK (do this silently before returning):
1. WISDOM — Does my patch actually solve the user's stated bug? Or did I drift into a tangential cleanup?
2. KNOWLEDGE — Can I name the root cause in one sentence? If I cannot, my fix is symptom-only — try again.
3. UNDERSTANDING — Did I leave compatible interfaces? Same function names, same return shapes, same env-var reads, same imports?
4. INTEGRITY — Did I add stubs, TODOs, or placeholder values? If yes, remove them before returning.
5. ANNOTATION — Did I tag every changed section with the Repair #N comment? If no, add them.

Only after this self-check passes, emit the file.

OUTPUT LENGTH: same length as the input file (typically). Sometimes the fix shrinks the file (removing a duplicate guard); sometimes it grows by 5-30 lines (adding a missing branch). A patched file that is 90%+ identical to the original is normal and expected — that is the point of surgical repair."""


# ----------------------------------------------------------------------------
# HTTP helpers (urllib — no external deps required at Windmill runtime)
# ----------------------------------------------------------------------------
def _http_post(url: str, headers: dict, body: dict, timeout: int = 60,
               raw_response: bool = False) -> dict:
    """POST JSON body. If raw_response=True, return raw body string in '_raw'.
    Some Windmill endpoints (scripts/create) return a plain hash, not JSON."""
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            text = resp.read().decode("utf-8")
            if raw_response:
                return {"_ok": True, "_raw": text, "_status": resp.status}
            try:
                return json.loads(text)
            except json.JSONDecodeError:
                return {"_ok": True, "_raw": text, "_status": resp.status}
    except urllib.error.HTTPError as e:
        try:
            err_body = e.read().decode("utf-8")
        except Exception:
            err_body = str(e)
        return {"_error": True, "status": e.code, "body": err_body}
    except Exception as e:
        return {"_error": True, "status": 0, "body": str(e)}


# ----------------------------------------------------------------------------
# CANON + DOCTRINE FILE LOADERS (Patch 1 — content injection, not just paths)
# Sonnet was previously told the path "CRG-RESEARCH-CANON-v1.md" and never saw
# the bytes. This loader OPENS each file, truncates if huge, returns inline
# text so the generation prompt embeds actual canon content.
# ----------------------------------------------------------------------------
def _resolve_path(rel_path: str, roots: list[str]) -> str | None:
    """Try each root in order, return first existing absolute path."""
    rp = rel_path.lstrip("/")
    for root in roots:
        if not root:
            continue
        candidate = os.path.join(root, rp)
        if os.path.isfile(candidate):
            return candidate
        # also try without the workspace-prefixed sub-dir
        if rp.startswith("01-CORNERSTONE-RESEARCH-GROUP/"):
            stripped = rp[len("01-CORNERSTONE-RESEARCH-GROUP/"):]
            cand2 = os.path.join(root, "01-CORNERSTONE-RESEARCH-GROUP", stripped)
            if os.path.isfile(cand2):
                return cand2
    return None


def _read_truncated(abs_path: str) -> str:
    """Read up to MAX_FILE_BYTES, append truncation marker if larger."""
    try:
        size = os.path.getsize(abs_path)
        with open(abs_path, "r", encoding="utf-8", errors="replace") as f:
            content = f.read(MAX_FILE_BYTES)
        if size > MAX_FILE_BYTES:
            content += TRUNCATION_MARKER
        return content
    except Exception as e:
        return f"[FILE READ ERROR for {abs_path}: {e}]"


def load_canon_blocks(canon_refs: list[str], canon_content: list[dict] | None = None) -> tuple[str, list[dict]]:
    """For each canon ref path, read content, return XML-tagged block + manifest.

    REPAIR #3 (2026-04-26): canon_content is the orchestrator-provided embedded payload.
    Windmill workers run in isolated containers — they CANNOT see the dispatcher's local FS.
    The chat orchestrator pre-loads canon files and passes content in the intake.
    This function reads canon_content first; only falls back to FS resolution if absent.

    Args:
      canon_refs: list of relative paths (e.g. "01-CORNERSTONE-RESEARCH-GROUP/CRG-RESEARCH-CANON-v1.md")
      canon_content: optional list of {"ref": str, "content": str} — orchestrator-provided

    Returns:
      block_text: a single string with each canon file as
                  <canon name="filename">CONTENT</canon> blocks.
      manifest:   list of {ref, resolved_path, bytes, found, source} per file (for traces)
    """
    # Build a lookup from canon_content by ref for fast access
    embedded_lookup = {}
    if canon_content:
        for entry in canon_content:
            if isinstance(entry, dict) and entry.get("ref") and entry.get("content") is not None:
                embedded_lookup[entry["ref"]] = entry["content"]

    blocks = []
    manifest = []
    for ref in canon_refs or []:
        # 1. Try embedded content first (orchestrator-provided, works on isolated workers)
        if ref in embedded_lookup:
            content = embedded_lookup[ref]
            name = os.path.basename(ref)
            blocks.append(f'<canon name="{name}" source="{ref}">\n{content}\n</canon>')
            manifest.append({
                "ref": ref, "resolved_path": "embedded-from-intake",
                "bytes": len(content), "found": True, "source": "intake",
            })
            continue
        # 2. Fall back to FS resolution (works only when run locally)
        resolved = _resolve_path(ref, WORKSPACE_ROOTS)
        if resolved:
            content = _read_truncated(resolved)
            name = os.path.basename(resolved)
            blocks.append(f'<canon name="{name}" source="{ref}">\n{content}\n</canon>')
            manifest.append({
                "ref": ref, "resolved_path": resolved,
                "bytes": len(content), "found": True, "source": "fs",
            })
        else:
            blocks.append(f'<canon name="{ref}" found="false">[FILE NOT FOUND]</canon>')
            manifest.append({
                "ref": ref, "resolved_path": None, "bytes": 0, "found": False, "source": "missing",
            })
    return "\n\n".join(blocks), manifest


def load_doctrine_blocks(doctrine_refs: list[str], doctrine_content: list[dict] | None = None) -> tuple[str, list[dict]]:
    """Same shape as load_canon_blocks but resolves against MEMORY_ROOTS.

    REPAIR #3 (2026-04-26): doctrine_content is the orchestrator-provided embedded payload
    for Windmill-isolated worker environments. See load_canon_blocks for rationale.

    Doctrine refs may be 'memory/foo.md' or 'foo.md' — both resolved."""
    embedded_lookup = {}
    if doctrine_content:
        for entry in doctrine_content:
            if isinstance(entry, dict) and entry.get("ref") and entry.get("content") is not None:
                embedded_lookup[entry["ref"]] = entry["content"]

    blocks = []
    manifest = []
    for ref in doctrine_refs or []:
        # 1. Try embedded content first
        if ref in embedded_lookup:
            content = embedded_lookup[ref]
            name = os.path.basename(ref)
            blocks.append(f'<doctrine name="{name}" source="{ref}">\n{content}\n</doctrine>')
            manifest.append({
                "ref": ref, "resolved_path": "embedded-from-intake",
                "bytes": len(content), "found": True, "source": "intake",
            })
            continue
        # 2. Fall back to FS
        rel = ref
        if rel.startswith("memory/"):
            rel = rel[len("memory/"):]
        resolved = _resolve_path(rel, MEMORY_ROOTS)
        if resolved:
            content = _read_truncated(resolved)
            name = os.path.basename(resolved)
            blocks.append(f'<doctrine name="{name}" source="{ref}">\n{content}\n</doctrine>')
            manifest.append({
                "ref": ref, "resolved_path": resolved,
                "bytes": len(content), "found": True, "source": "fs",
            })
        else:
            blocks.append(f'<doctrine name="{ref}" found="false">[FILE NOT FOUND]</doctrine>')
            manifest.append({
                "ref": ref, "resolved_path": None, "bytes": 0, "found": False, "source": "missing",
            })
    return "\n\n".join(blocks), manifest


def call_anthropic(model: str, system: str, user: str, anthropic_key: str,
                   max_tokens: int = 2048) -> dict:
    """Call Anthropic Messages API. Returns the raw response dict."""
    return _http_post(
        "https://api.anthropic.com/v1/messages",
        headers={
            "x-api-key": anthropic_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
        body={
            "model": model,
            "max_tokens": max_tokens,
            "system": system,
            "messages": [{"role": "user", "content": user}],
        },
        timeout=300,  # Repair #3.1 (2026-04-26): 120s→300s. Larger canon-embedded prompts + 24K max_tokens take longer than 120s for Sonnet to complete. Lazarus #2 timed out at the read.
    )


def langfuse_trace(public_key: str, secret_key: str, host: str,
                   name: str, input_obj: Any, output_obj: Any,
                   metadata: dict | None = None) -> str:
    """Write a Langfuse ingestion event. Returns trace_id (or empty on failure)."""
    trace_id = f"build-agent-v1-{int(time.time() * 1000)}"
    auth = base64.b64encode(f"{public_key}:{secret_key}".encode()).decode()
    payload = {
        "batch": [
            {
                "id": trace_id,
                "type": "trace-create",
                "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()),
                "body": {
                    "id": trace_id,
                    "name": name,
                    "input": input_obj,
                    "output": output_obj,
                    "metadata": metadata or {},
                },
            }
        ]
    }
    result = _http_post(
        f"{host}/api/public/ingestion",
        headers={
            "Authorization": f"Basic {auth}",
            "Content-Type": "application/json",
        },
        body=payload,
        timeout=30,
    )
    if result.get("_error"):
        return ""
    return trace_id


# ----------------------------------------------------------------------------
# INTAKE VALIDATION (drift-proof refusal — Marc-style explicit failure modes)
# ----------------------------------------------------------------------------
def validate_intake(intake: Any) -> tuple[bool, list[str]]:
    """Return (is_valid, list_of_failures). Empty failures = valid.

    Repair #6 (2026-04-27): mode-aware validation. The intake's `mode` field
    selects the schema. mode == "build" (default) requires the build-mode
    fields (agent_name, silo, scope, success_criteria, runtime_host, ...).
    mode == "fix" requires only fix_request {file_path, bug_description,
    expected_behavior} + doctrine_refs + go.
    """
    failures = []
    if not isinstance(intake, dict):
        return False, ["intake must be a JSON object"]

    # Repair #6 (2026-04-27): determine mode (default to "build" for back-compat)
    mode = intake.get("mode", "build")
    if mode not in ALLOWED_MODES:
        failures.append(
            f"invalid mode '{mode}' — allowed: {sorted(ALLOWED_MODES)}"
        )
        return False, failures

    if mode == "fix":
        # Repair #6 (2026-04-27): fix-mode required fields
        for field in FIX_REQUIRED_FIELDS:
            if field not in intake:
                failures.append(f"missing required field: {field}")
            elif intake[field] in (None, "", [], {}):
                failures.append(f"empty required field: {field}")
        # Validate the nested fix_request shape
        fix_request = intake.get("fix_request")
        if isinstance(fix_request, dict):
            for key in FIX_REQUEST_REQUIRED_KEYS:
                if key not in fix_request:
                    failures.append(f"fix_request missing required key: {key}")
                elif fix_request[key] in (None, "", [], {}):
                    failures.append(f"fix_request empty required key: {key}")
        elif "fix_request" in intake:
            failures.append("fix_request must be a JSON object")
    else:
        # mode == "build" — original behavior preserved bit-for-bit
        for field in REQUIRED_INTAKE_FIELDS:
            if field not in intake:
                failures.append(f"missing required field: {field}")
            elif intake[field] in (None, "", [], {}):
                failures.append(f"empty required field: {field}")

        if intake.get("silo") and intake["silo"] not in ALLOWED_SILOS:
            failures.append(
                f"invalid silo '{intake['silo']}' — allowed: {sorted(ALLOWED_SILOS)}"
            )
        if intake.get("runtime_host") and intake["runtime_host"] not in ALLOWED_RUNTIME_HOSTS:
            failures.append(
                f"invalid runtime_host '{intake['runtime_host']}' — allowed: {sorted(ALLOWED_RUNTIME_HOSTS)}"
            )

    # `go` field check is shared between modes
    if intake.get("go") and str(intake["go"]).strip().upper() not in ("YES", "GO", "YES — BUILD NOW"):
        # Be tolerant of phrasings, but still require an explicit affirmative
        if "YES" not in str(intake.get("go", "")).upper():
            failures.append(f"go field must be affirmative (YES/GO); got '{intake['go']}'")

    return (len(failures) == 0), failures


# ----------------------------------------------------------------------------
# KRITE 5-axis review (inline within Build Agent — replaced by KRITE agent v1)
# ----------------------------------------------------------------------------
KRITE_RUBRIC = """
You are KRITE, the CRG quality gate. You score one artifact on 5 axes.
Each axis is 0.0 to 1.0. Return STRICT JSON only, no prose, no markdown.

The 5 axes (per EVALUATION-GRADING-FRAMEWORK-v1.md):
1. voice       — sounds like Marc Papineau, plain-English-outcomes-first
2. compliance  — honors Real Estate / IIROC / Health Canada / CASL / Privacy
3. research    — claims sourced, tiered (T1-T4), citation-discipline
4. tone        — register matches the audience and moment
5. wku         — Wisdom (right call) + Knowledge (sourced) + Understanding (Marc-context)

Pass threshold per axis: 0.80. Hard-fails (any one) force scores below 0.50.

OUTPUT FORMAT (strict JSON):
{
  "voice": 0.0,
  "compliance": 0.0,
  "research": 0.0,
  "tone": 0.0,
  "wku": 0.0,
  "failures": ["<short specific failure note>", ...],
  "pass": true|false
}
"""


def krite_review(artifact_text: str, artifact_kind: str, anthropic_key: str,
                 lf_pub: str, lf_sec: str, lf_host: str) -> dict:
    """Inline KRITE-pattern review. 3-iteration max is handled by the caller."""
    user_msg = (
        f"ARTIFACT KIND: {artifact_kind}\n\n"
        f"ARTIFACT TEXT (or spec) to score:\n---\n{artifact_text}\n---\n\n"
        "Score on the 5 axes. Return strict JSON only."
    )
    resp = call_anthropic(
        ANTHROPIC_OPUS, KRITE_RUBRIC, user_msg, anthropic_key, max_tokens=512
    )
    trace_id = langfuse_trace(
        lf_pub, lf_sec, lf_host,
        name="build-agent-v1.krite-inline-review",
        input_obj={"artifact_kind": artifact_kind, "preview": artifact_text[:500]},
        output_obj=resp,
        metadata={"model": ANTHROPIC_OPUS, "stage": "inline-krite"},
    )
    if resp.get("_error"):
        return {
            "voice": 0.0, "compliance": 0.0, "research": 0.0,
            "tone": 0.0, "wku": 0.0,
            "failures": [f"anthropic call failed: {resp.get('body', 'unknown')}"],
            "pass": False,
            "_trace_id": trace_id,
            "_anthropic_error": True,
        }

    # Extract the JSON from Claude's response
    text = ""
    for block in resp.get("content", []):
        if block.get("type") == "text":
            text += block.get("text", "")

    text = text.strip()
    # Strip markdown fences if present (defensive — KRITE is told strict JSON)
    if text.startswith("```"):
        text = text.split("```", 2)[1]
        if text.startswith("json"):
            text = text[4:]
        text = text.rsplit("```", 1)[0].strip()

    try:
        scores = json.loads(text)
    except json.JSONDecodeError:
        return {
            "voice": 0.0, "compliance": 0.0, "research": 0.0,
            "tone": 0.0, "wku": 0.0,
            "failures": ["KRITE returned non-JSON; review malformed", text[:200]],
            "pass": False,
            "_trace_id": trace_id,
        }

    # Compute pass: all 5 axes >= 0.80
    passed = all(
        float(scores.get(axis, 0)) >= KRITE_PASS_THRESHOLD
        for axis in ("voice", "compliance", "research", "tone", "wku")
    )
    scores["pass"] = passed
    scores["_trace_id"] = trace_id
    return scores


# ----------------------------------------------------------------------------
# PATCH 2 — DEPLOYED KRITE-AGENT-V1 INVOCATION (replaces inline KRITE for builds)
# Inline `krite_review` above is kept as fallback only when the deployed call
# errors. Deployed KRITE has the full canon-backed rubric with hard-fails.
# ----------------------------------------------------------------------------
DEPLOYED_KRITE_PATH = "u/admin/krite-agent-v1"
DEPLOYED_KRITE_RUN_URL = (
    "http://localhost:8000/api/w/admin/jobs/run/p/u/admin/krite-agent-v1"
)
DEPLOYED_KRITE_POLL_URL_TPL = (
    "http://localhost:8000/api/w/admin/jobs_u/completed/get/{job_id}"
)
DEPLOYED_KRITE_TIMEOUT_S = 90
DEPLOYED_KRITE_POLL_INTERVAL_S = 2


def _http_get(url: str, headers: dict, timeout: int = 30) -> dict:
    """GET helper paralleling _http_post."""
    req = urllib.request.Request(url, headers=headers, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            text = resp.read().decode("utf-8")
            try:
                return json.loads(text)
            except json.JSONDecodeError:
                return {"_ok": True, "_raw": text, "_status": resp.status}
    except urllib.error.HTTPError as e:
        try:
            err_body = e.read().decode("utf-8")
        except Exception:
            err_body = str(e)
        return {"_error": True, "status": e.code, "body": err_body}
    except Exception as e:
        return {"_error": True, "status": 0, "body": str(e)}


def krite_review_via_deployed_agent(
    artifact_text: str, artifact_kind: str, anthropic_key: str,
    lf_pub: str, lf_sec: str, lf_host: str,
) -> dict:
    """POST to u/admin/krite-agent-v1, poll for completion, return scores.

    On any failure (network, timeout, malformed response), the caller MUST
    fall through to the inline `krite_review` and mark the result with
    `_deployed_krite_error` so the failure is visible in traces.
    """
    wm_token = os.environ.get("WM_TOKEN", "")
    if not wm_token:
        return {
            "_error": True,
            "_deployed_krite_error": "WM_TOKEN not available — cannot call deployed KRITE",
        }

    headers = {
        "Authorization": f"Bearer {wm_token}",
        "Content-Type": "application/json",
    }
    # KRITE agent v1 expects a plain JSON body with the artifact + kind
    payload = {
        "artifact_text": artifact_text,
        "artifact_kind": artifact_kind,
    }

    # Trigger the deployed agent (returns a job id as a raw string)
    start_resp = _http_post(
        DEPLOYED_KRITE_RUN_URL, headers=headers, body=payload,
        timeout=30, raw_response=True,
    )
    if start_resp.get("_error"):
        return {
            "_error": True,
            "_deployed_krite_error": (
                f"start failed status={start_resp.get('status')} "
                f"body={str(start_resp.get('body'))[:200]}"
            ),
        }
    # Windmill returns the job uuid as a quoted string in the body
    job_id_raw = (start_resp.get("_raw") or "").strip().strip('"')
    if not job_id_raw:
        return {
            "_error": True,
            "_deployed_krite_error": (
                f"start returned no job id; raw='{str(start_resp.get('_raw'))[:200]}'"
            ),
        }

    # Poll for completion
    poll_url = DEPLOYED_KRITE_POLL_URL_TPL.format(job_id=job_id_raw)
    deadline = time.time() + DEPLOYED_KRITE_TIMEOUT_S
    last_poll = None
    while time.time() < deadline:
        last_poll = _http_get(poll_url, headers=headers, timeout=15)
        # Completed jobs return a dict with `result`. While running, the
        # endpoint 404s; treat that as "still running, sleep + retry".
        if last_poll.get("_error") and last_poll.get("status") == 404:
            time.sleep(DEPLOYED_KRITE_POLL_INTERVAL_S)
            continue
        if last_poll.get("_error"):
            # Non-404 error (auth, rate-limit, etc.) — abort polling
            return {
                "_error": True,
                "_deployed_krite_error": (
                    f"poll failed status={last_poll.get('status')} "
                    f"body={str(last_poll.get('body'))[:200]}"
                ),
                "job_id": job_id_raw,
            }
        if "result" in last_poll:
            break
        time.sleep(DEPLOYED_KRITE_POLL_INTERVAL_S)
    else:
        return {
            "_error": True,
            "_deployed_krite_error": f"poll timeout after {DEPLOYED_KRITE_TIMEOUT_S}s",
            "job_id": job_id_raw,
        }

    # Extract the structured scores from the agent's result
    result = last_poll.get("result") if last_poll else None
    if not isinstance(result, dict):
        return {
            "_error": True,
            "_deployed_krite_error": f"result not a dict; got {type(result).__name__}",
            "job_id": job_id_raw,
            "raw_result": result,
        }

    # KRITE agent v1 returns its scores at the top level OR nested under
    # `krite_scores`. Be defensive: support both shapes.
    if "voice" in result and "compliance" in result:
        scores = dict(result)
    elif isinstance(result.get("krite_scores"), dict):
        scores = dict(result["krite_scores"])
    elif isinstance(result.get("scores"), dict):
        scores = dict(result["scores"])
    else:
        return {
            "_error": True,
            "_deployed_krite_error": "deployed KRITE result missing voice/compliance keys",
            "job_id": job_id_raw,
            "raw_result_preview": json.dumps(result)[:400],
        }

    # Compute pass: all 5 axes >= 0.80 (matches inline behavior)
    passed = all(
        float(scores.get(axis, 0)) >= KRITE_PASS_THRESHOLD
        for axis in ("voice", "compliance", "research", "tone", "wku")
    )
    scores["pass"] = passed
    scores["_via_deployed_agent"] = True
    scores["_deployed_job_id"] = job_id_raw

    # Trace the deployed call
    trace_id = langfuse_trace(
        lf_pub, lf_sec, lf_host,
        name="build-agent-v1.krite-deployed-review",
        input_obj={"artifact_kind": artifact_kind, "preview": artifact_text[:500]},
        output_obj={"scores": scores, "job_id": job_id_raw},
        metadata={"agent": DEPLOYED_KRITE_PATH, "stage": "deployed-krite"},
    )
    scores["_trace_id"] = trace_id
    return scores


def krite_review_combined(
    artifact_text: str, artifact_kind: str, anthropic_key: str,
    lf_pub: str, lf_sec: str, lf_host: str,
) -> dict:
    """Inline-only KRITE per Sprint 1 (2026-05-05).

    Sprint 1 disabled the deployed-KRITE call: u/admin/krite-agent-v1 is FICTIONAL
    per 2026-05-04 theater audit (no agent_id, no bootstrap, no runtime file at
    that path). Skip the deployed call entirely; do not simulate it.

    Inline KRITE is Opus 4.7 per rule_model_selection. Future sprint may wire a
    real deployed-KRITE if Marc decides to build one (Decision A1/A3 from audit
    report Section 7).
    """
    inline = krite_review(
        artifact_text, artifact_kind, anthropic_key, lf_pub, lf_sec, lf_host,
    )
    inline["_via"] = "inline-only-sprint1"
    inline["_deployed_krite_disabled_reason"] = (
        "u/admin/krite-agent-v1 is FICTIONAL per 2026-05-04 audit; "
        "deployed call disabled in Sprint 1 to prevent fake-call attempts"
    )
    return inline


# ----------------------------------------------------------------------------
# PATCH 4 — DEPLOYED-AGENT REGISTRY (cross-agent wiring at generation time)
# Fetches u/admin/* scripts from Windmill at gen time and injects a known list
# into the gen prompt so generated agents call existing capabilities instead
# of reinventing them. Falls back to a hard-coded baseline list if the API
# call fails (e.g. no WM_TOKEN, network blip).
# ----------------------------------------------------------------------------
WINDMILL_LIST_URL = "http://localhost:8000/api/w/admin/scripts/list"
KNOWN_AGENT_DESCRIPTIONS = {
    "u/admin/krite-agent-v1": "5-axis quality review (voice / compliance / research / tone / wku); hard-fails per EVALUATION-GRADING-FRAMEWORK-v1.md",
    "u/admin/build-agent-v1": "ORCHESTRATOR — never call from a built agent",
    "u/admin/daniel-research": "Perplexity-backed research engine (T1-T4 tier-cited briefs)",
    "u/admin/apollos-content-v2": "Real-Estate magazine content engine — blog/LinkedIn/newsletter, KRITE-pre-scored",
}


def fetch_deployed_agents() -> list[str]:
    """Return list of u/admin/* paths currently deployed on Windmill.
    On any failure, returns the hard-coded known list."""
    wm_token = os.environ.get("WM_TOKEN", "")
    if not wm_token:
        return list(KNOWN_AGENT_DESCRIPTIONS.keys())
    headers = {"Authorization": f"Bearer {wm_token}"}
    resp = _http_get(WINDMILL_LIST_URL, headers=headers, timeout=15)
    # Windmill /scripts/list returns a JSON array on success, an error dict on failure.
    # Guard before calling .get() — lists don't have .get().
    if isinstance(resp, dict) and resp.get("_error"):
        return list(KNOWN_AGENT_DESCRIPTIONS.keys())
    # Windmill returns either a list of script dicts or a {scripts: [...]} envelope
    items = resp if isinstance(resp, list) else (resp.get("scripts", []) if isinstance(resp, dict) else [])
    paths = []
    for item in items if isinstance(items, list) else []:
        path = item.get("path") if isinstance(item, dict) else None
        if path and path.startswith("u/admin/"):
            paths.append(path)
    if not paths:
        return list(KNOWN_AGENT_DESCRIPTIONS.keys())
    # Make sure known agents are present even if API list is partial
    for known in KNOWN_AGENT_DESCRIPTIONS:
        if known not in paths:
            paths.append(known)
    return sorted(set(paths))


def build_agent_registry_block() -> str:
    """Return a multi-line registry string for injection into GEN prompt."""
    paths = fetch_deployed_agents()
    lines = []
    for p in paths:
        desc = KNOWN_AGENT_DESCRIPTIONS.get(p, "(deployed agent)")
        lines.append(f"- {p} — {desc}")
    lines.append("")
    lines.append(
        "When your generated agent needs review, scoring, research, or any "
        "capability another deployed agent has, generate code that POSTs to "
        "that agent's Windmill run URL "
        "(http://localhost:8000/api/w/admin/jobs/run/p/<path>) and polls "
        "http://localhost:8000/api/w/admin/jobs_u/completed/get/<job_id> "
        "for completion. Use `os.environ.get('WM_TOKEN')` for auth. "
        "Do NOT reimplement existing agent capabilities."
    )
    return "\n".join(lines)


# ----------------------------------------------------------------------------
# PATCH 3 — FUNCTIONAL TEST-FIRE GENERATOR (replaces dumb-input smoke test)
# After deploy, generate a functional test specific to the agent's
# success_criteria, fire it, and check the response for canon-signature
# markers. A stub returning JSON for any input no longer passes.
# ----------------------------------------------------------------------------
FUNCTIONAL_TEST_DESIGN_SYSTEM = """You design ONE concrete functional test for a CRG agent.

You will be given:
1. The agent's name + success_criteria.
2. A short description of the agent's scope.

Output STRICT JSON only, no prose, no markdown fences:
{
  "test_input": <a single concrete dict matching the agent's expected input shape>,
  "expected_markers": [
    <3-8 specific phrase/regex hints that MUST appear in a real (non-stub) response output. Markers should be domain-specific — e.g. for a real-estate content agent: voice names like "Sherrard" or "Buffini", or tier marker "T1", or attribution phrase "marcpapineau.com">
  ],
  "rationale": "<1-2 sentence explanation of why these markers prove the agent is doing real work, not stubbing>"
}

Rules:
- test_input MUST be valid for the agent's documented input schema.
- expected_markers MUST be specific. Generic markers like "result" or "ok" are forbidden.
- For real-estate content agents: include at least 2 voice names (Sherrard / Swords / Buffini / Sanchez / Mashore / Ferry / Serhant / Codie) as markers.
- For scoring/review agents: include axis names AND a known-bad artifact in test_input that should produce LOW scores (markers should target the LOW-score signal).
"""


def design_functional_test(
    agent_name: str, scope: str, success_criteria: str,
    inputs_block: str, anthropic_key: str,
    lf_pub: str, lf_sec: str, lf_host: str,
) -> dict:
    """Sonnet 4.6 meta-call: design a concrete test_input + expected_markers."""
    user = (
        f"AGENT NAME: {agent_name}\n\n"
        f"SCOPE:\n{scope}\n\n"
        f"INPUT SCHEMA:\n{inputs_block}\n\n"
        f"SUCCESS CRITERIA (must be matched):\n{success_criteria}\n\n"
        "Design the single best test input + the markers we'd expect in a "
        "real (non-stub) response output. Return strict JSON."
    )
    resp = call_anthropic(
        ANTHROPIC_SONNET, FUNCTIONAL_TEST_DESIGN_SYSTEM, user, anthropic_key,
        max_tokens=1024,
    )
    trace_id = langfuse_trace(
        lf_pub, lf_sec, lf_host,
        name="build-agent-v1.functional-test-design",
        input_obj={"agent_name": agent_name, "scope_preview": scope[:300]},
        output_obj={"stop_reason": resp.get("stop_reason"), "usage": resp.get("usage")},
        metadata={"stage": "test-design", "model": ANTHROPIC_SONNET},
    )
    if resp.get("_error"):
        return {
            "_error": True,
            "reason": f"test-design call failed: {resp.get('body', 'unknown')}",
            "trace_id": trace_id,
        }
    text = ""
    for block in resp.get("content", []):
        if block.get("type") == "text":
            text += block.get("text", "")
    text = text.strip()
    if text.startswith("```"):
        text = text.split("```", 2)[1]
        if text.startswith("json"):
            text = text[4:]
        text = text.rsplit("```", 1)[0].strip()
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        return {
            "_error": True,
            "reason": "test-design returned non-JSON",
            "raw_preview": text[:300],
            "trace_id": trace_id,
        }
    parsed["_trace_id"] = trace_id
    return parsed


def run_functional_test(
    agent_path: str, test_input: dict, expected_markers: list[str],
    lf_pub: str, lf_sec: str, lf_host: str,
) -> dict:
    """Fire the just-deployed agent with a designed input and verify markers
    appear in the response. Returns {ok, markers_found, markers_missing,
    response_preview, error?, job_id?}."""
    wm_token = os.environ.get("WM_TOKEN", "")
    if not wm_token:
        return {
            "ok": False,
            "error": "WM_TOKEN not available — cannot fire functional test",
            "markers_found": [], "markers_missing": list(expected_markers or []),
        }
    run_url = f"http://localhost:8000/api/w/admin/jobs/run/p/{agent_path}"
    headers = {
        "Authorization": f"Bearer {wm_token}",
        "Content-Type": "application/json",
    }
    start_resp = _http_post(
        run_url, headers=headers, body=test_input, timeout=30, raw_response=True,
    )
    if start_resp.get("_error"):
        return {
            "ok": False,
            "error": (
                f"start failed status={start_resp.get('status')} "
                f"body={str(start_resp.get('body'))[:200]}"
            ),
            "markers_found": [], "markers_missing": list(expected_markers or []),
        }
    job_id_raw = (start_resp.get("_raw") or "").strip().strip('"')
    if not job_id_raw:
        return {
            "ok": False,
            "error": f"no job id; raw='{str(start_resp.get('_raw'))[:200]}'",
            "markers_found": [], "markers_missing": list(expected_markers or []),
        }
    poll_url = f"http://localhost:8000/api/w/admin/jobs_u/completed/get/{job_id_raw}"
    deadline = time.time() + 180  # functional tests can be longer (real LLM calls)
    last_poll = None
    while time.time() < deadline:
        last_poll = _http_get(poll_url, headers=headers, timeout=15)
        if last_poll.get("_error") and last_poll.get("status") == 404:
            time.sleep(3)
            continue
        if last_poll.get("_error"):
            return {
                "ok": False,
                "error": (
                    f"poll failed status={last_poll.get('status')} "
                    f"body={str(last_poll.get('body'))[:200]}"
                ),
                "markers_found": [], "markers_missing": list(expected_markers or []),
                "job_id": job_id_raw,
            }
        if "result" in last_poll:
            break
        time.sleep(3)
    else:
        return {
            "ok": False, "error": f"poll timeout after 180s",
            "markers_found": [], "markers_missing": list(expected_markers or []),
            "job_id": job_id_raw,
        }
    result = last_poll.get("result") if last_poll else None
    response_text = json.dumps(result) if result is not None else ""
    found = []
    missing = []
    for marker in expected_markers or []:
        if not isinstance(marker, str):
            continue
        if marker.lower() in response_text.lower():
            found.append(marker)
        else:
            missing.append(marker)
    trace_id = langfuse_trace(
        lf_pub, lf_sec, lf_host,
        name="build-agent-v1.functional-test-fire",
        input_obj={"agent_path": agent_path, "test_input": test_input,
                   "expected_markers": expected_markers},
        output_obj={"markers_found": found, "markers_missing": missing,
                    "job_id": job_id_raw},
        metadata={"stage": "functional-test", "agent_path": agent_path},
    )
    return {
        "ok": len(missing) == 0,
        "markers_found": found,
        "markers_missing": missing,
        "response_preview": response_text[:1500],
        "job_id": job_id_raw,
        "trace_id": trace_id,
    }


# ----------------------------------------------------------------------------
# CANON GAP DETECTION + DANIEL (Perplexity) RESEARCH FALLBACK
# ----------------------------------------------------------------------------
def daniel_research(question: str, perplexity_key: str,
                    lf_pub: str, lf_sec: str, lf_host: str) -> dict:
    """Fire Perplexity for canon gaps. Returns research summary or error."""
    resp = _http_post(
        "https://api.perplexity.ai/chat/completions",
        headers={
            "Authorization": f"Bearer {perplexity_key}",
            "Content-Type": "application/json",
        },
        body={
            "model": "sonar-pro",
            "messages": [
                {
                    "role": "system",
                    "content": "You are Daniel, CRG's research engine. Cite every load-bearing claim with a URL. Tier facts T1 (canonical) > T2 (practitioner) > T3 (edge) > T4 (synthesis). Be concise.",
                },
                {"role": "user", "content": question},
            ],
            "max_tokens": 800,
        },
        timeout=60,
    )
    trace_id = langfuse_trace(
        lf_pub, lf_sec, lf_host,
        name="build-agent-v1.daniel-research",
        input_obj={"question": question},
        output_obj=resp,
        metadata={"engine": "perplexity-sonar-pro"},
    )
    if resp.get("_error"):
        return {"ok": False, "error": resp.get("body"), "trace_id": trace_id}
    text = ""
    try:
        text = resp["choices"][0]["message"]["content"]
    except Exception:
        pass
    return {"ok": True, "summary": text, "trace_id": trace_id}


# ----------------------------------------------------------------------------
# Repair #6 (2026-04-27): FIX-MODE HELPERS
# Build Agent v1 is now dual-purpose: it builds NEW agents (existing behavior)
# and also patches existing files (new behavior). These helpers support fix-mode:
#   - read_file_safely: open the broken file, return content or None
#   - compose_fix_user_prompt: build the user prompt for FIX_SYSTEM_PROMPT
#   - validate_patched_file: language-aware syntax check on the patched output
#   - compute_diff_preview: capped unified-diff for the marc_facing_summary
# ----------------------------------------------------------------------------
def read_file_safely(path: str) -> str | None:
    """Read a file from disk. Return its text content, or None on any error.

    Repair #6 (2026-04-27): used by fix-mode to load the broken file before
    handing it to Sonnet. Errors (missing file, permission, encoding) all
    return None so the caller can emit a clean HONEST-FAILED with a marc-action.
    """
    try:
        if not isinstance(path, str) or not path:
            return None
        if not os.path.isfile(path):
            return None
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            return f.read()
    except Exception:
        return None


def compose_fix_user_prompt(intake: dict, file_content: str,
                             doctrine_block: str = "") -> str:
    """Build the Sonnet user prompt for FIX mode.

    Repair #6 (2026-04-27): bundles bug_description, expected_behavior,
    constraints, and the full current file content into a single prompt that
    pairs with FIX_SYSTEM_PROMPT. Doctrine_block is the same XML-tagged
    doctrine content used in build mode (so fixes still honor doctrine).
    """
    fix_request = intake.get("fix_request", {}) if isinstance(intake, dict) else {}
    file_path = fix_request.get("file_path", "(unknown path)")
    bug_description = fix_request.get("bug_description", "(no description)")
    expected_behavior = fix_request.get("expected_behavior", "(none specified)")
    constraints = fix_request.get("constraints", []) or []
    file_repo = fix_request.get("file_repo", "")

    constraints_block = (
        "\n".join(f"- {c}" for c in constraints) if constraints else "(none specified)"
    )

    # File-extension hint helps Sonnet preserve the language faithfully.
    ext = os.path.splitext(file_path)[1].lower() if file_path else ""
    lang_hint = {
        ".py": "Python",
        ".js": "JavaScript (Node.js / CommonJS, Netlify Function pattern likely)",
        ".ts": "TypeScript",
        ".tsx": "TypeScript React",
        ".jsx": "JavaScript React",
        ".json": "JSON (no inline comments allowed; preserve exact key order)",
        ".html": "HTML",
        ".css": "CSS",
        ".md": "Markdown",
        ".sh": "Bash shell script",
        ".yml": "YAML",
        ".yaml": "YAML",
    }.get(ext, "the same language as the input file")

    return (
        f"Apply Repair #6 to the file below.\n\n"
        f"=== TARGET FILE PATH ===\n{file_path}\n\n"
        f"=== TARGET REPO (informational) ===\n{file_repo or '(not specified)'}\n\n"
        f"=== LANGUAGE HINT ===\n{lang_hint}\n\n"
        f"=== BUG DESCRIPTION (what is currently wrong) ===\n{bug_description}\n\n"
        f"=== EXPECTED BEHAVIOR (what should happen after the fix) ===\n{expected_behavior}\n\n"
        f"=== CONSTRAINTS (what you must preserve) ===\n{constraints_block}\n\n"
        f"=== DOCTRINE (load-bearing instructions — honor where applicable) ===\n"
        f"{doctrine_block or '(no doctrine refs supplied)'}\n\n"
        f"=== CURRENT FILE CONTENT (the broken file — patch this) ===\n"
        f"{file_content}\n"
        f"=== END OF CURRENT FILE CONTENT ===\n\n"
        f"Return ONLY the full patched file content. No prose. No markdown fences. "
        f"No \"Here is the patched file...\" preamble. The first character of your "
        f"response must be the first character of the patched file. Annotate every "
        f"changed section with `Repair #6 (2026-04-27): <one-line>` (use the comment "
        f"syntax of the file's language)."
    )


def validate_patched_file(content: str, path: str) -> dict:
    """Language-aware syntax check on a patched file.

    Repair #6 (2026-04-27): runs a fast structural validation appropriate to
    the file's language so we can hard-fail HONEST when Sonnet produced
    syntactically broken output. Returns {ok, language, failures, line_count}.
    """
    failures: list[str] = []
    line_count = content.count("\n") + 1 if content else 0
    ext = os.path.splitext(path)[1].lower() if path else ""

    if not content or not content.strip():
        return {
            "ok": False,
            "language": ext or "(unknown)",
            "line_count": 0,
            "failures": ["patched content is empty"],
        }

    # Truncation sniff — if the patched output is materially shorter than 50
    # chars and the file extension implies real code, that's a stub.
    if line_count < 5 and ext in (".py", ".js", ".ts", ".jsx", ".tsx"):
        failures.append(
            f"patched file suspiciously short: {line_count} lines for a {ext} file"
        )

    if ext == ".py":
        # Python: real syntax check via compile()
        try:
            import ast
            ast.parse(content)
        except SyntaxError as e:
            failures.append(f"Python SyntaxError: {e}")
        except Exception as e:
            failures.append(f"Python parse error: {e}")
        return {
            "ok": len(failures) == 0,
            "language": "python",
            "line_count": line_count,
            "failures": failures,
        }

    if ext in (".js", ".jsx", ".ts", ".tsx"):
        # JS/TS: rough structural check. We don't have a JS parser available
        # at Windmill runtime, so we sniff for common syntactic markers.
        # 1. Balanced braces (allowing for braces inside strings is imperfect
        #    but catches most truncations).
        open_braces = content.count("{")
        close_braces = content.count("}")
        if abs(open_braces - close_braces) > 0:
            failures.append(
                f"unbalanced braces: {{ count={open_braces}, }} count={close_braces}"
            )
        # 2. Balanced parens (sloppy — same caveat as braces).
        open_parens = content.count("(")
        close_parens = content.count(")")
        if abs(open_parens - close_parens) > 0:
            failures.append(
                f"unbalanced parens: ( count={open_parens}, ) count={close_parens}"
            )
        # 3. Look for an entrypoint or module export marker (handler / exports
        #    / module.exports / export default / function). A file with NONE
        #    of these is almost certainly truncated or a stub.
        has_entry = (
            "exports.handler" in content
            or "module.exports" in content
            or "export default" in content
            or "exports." in content
            or "export function" in content
            or "export const" in content
            or "function " in content
            or "const " in content  # at minimum, real code declares something
        )
        if not has_entry:
            failures.append(
                "no entrypoint or declaration found (handler/exports/function/const)"
            )
        # 4. Truncation sniff — last non-blank line should not look mid-statement.
        last_line = ""
        for line in reversed(content.splitlines()):
            if line.strip():
                last_line = line.rstrip()
                break
        # Suspicious endings: ends with operator, comma, open brace/paren, backslash
        # (closing brace is the normal end of a JS file)
        if last_line and last_line[-1] in (",", "+", "-", "=", "(", "[", "\\"):
            failures.append(
                f"file appears truncated mid-statement: last line ends '{last_line[-30:]}'"
            )
        return {
            "ok": len(failures) == 0,
            "language": "javascript" if ext in (".js", ".jsx") else "typescript",
            "line_count": line_count,
            "failures": failures,
        }

    if ext == ".json":
        # JSON: hard-fail on parse error
        try:
            json.loads(content)
        except json.JSONDecodeError as e:
            failures.append(f"JSON parse error: {e}")
        return {
            "ok": len(failures) == 0,
            "language": "json",
            "line_count": line_count,
            "failures": failures,
        }

    # Unknown / non-code extensions (.md, .txt, .yml, .html, .css, .sh, ...)
    # We can't syntax-check these meaningfully — just verify non-empty + no
    # obvious truncation marker.
    return {
        "ok": len(failures) == 0,
        "language": (ext.lstrip(".") or "unknown"),
        "line_count": line_count,
        "failures": failures,
    }


def compute_diff_preview(before: str, after: str, max_lines: int = 50) -> str:
    """Return a unified-diff preview capped to max_lines.

    Repair #6 (2026-04-27): used in the marc_facing_summary so the orchestrator
    (and Marc) can eyeball what Sonnet actually changed before committing.
    """
    try:
        import difflib
        diff_iter = difflib.unified_diff(
            (before or "").splitlines(keepends=False),
            (after or "").splitlines(keepends=False),
            fromfile="before",
            tofile="after",
            lineterm="",
            n=2,
        )
        lines = []
        for i, line in enumerate(diff_iter):
            if i >= max_lines:
                lines.append(f"... (diff truncated to first {max_lines} lines)")
                break
            lines.append(line)
        if not lines:
            return "(no changes detected — patched file is byte-identical to original)"
        return "\n".join(lines)
    except Exception as e:
        return f"(diff computation failed: {e})"


# ----------------------------------------------------------------------------
# MARC-FACING SUMMARY (outcomes-first per feedback_communication_style.md)
# ----------------------------------------------------------------------------
def marc_summary(build_status: str, agent_name: str, runtime_path: str,
                 krite_scores: dict, iterations: int, trace_ids: list,
                 runtime_host: str = "windmill",
                 mode: str = "build",
                 fix_context: dict | None = None) -> str:
    # Repair #4 (2026-04-26): runtime_host added so BUILT message is accurate
    # for both windmill (already deployed + test-fireable) and netlify-fn
    # (artifact ready, orchestrator commits + Netlify auto-deploys).
    # Repair #6 (2026-04-27): mode added so fix-mode produces a fix-shaped
    # summary (file_path + bug snippet + diff disposition) instead of the
    # build-shaped one. fix_context carries {file_path, bug_description}.

    # Repair #6 (2026-04-27): fix-mode summary path
    if mode == "fix":
        ctx = fix_context or {}
        file_path = ctx.get("file_path", "(unknown file)")
        bug_description = ctx.get("bug_description", "(no description)")
        bug_snippet = bug_description[:80] + ("..." if len(bug_description) > 80 else "")
        if build_status == "BUILT":
            avg = sum(
                float(krite_scores.get(a, 0))
                for a in ("voice", "compliance", "research", "tone", "wku")
            ) / 5.0
            passed = bool(krite_scores.get("pass", False))
            return (
                f"Repair #6 patch ready for {file_path}. Bug: {bug_snippet} "
                f"KRITE pass={passed}, avg {avg:.2f}/1.00 on iteration {iterations}. "
                f"Patched file content is in `patched_content`; orchestrator commits "
                f"to git after Marc reviews the diff preview. Build Agent does not "
                f"auto-write the file — that decision stays with the orchestrator."
            )
        if build_status == "REFUSED":
            failures = krite_scores.get("failures", []) if isinstance(krite_scores, dict) else []
            return (
                f"Repair #6 was refused before any patch was generated — "
                f"the fix request was missing required information. "
                f"Specifically: {'; '.join(failures[:3])}. "
                f"Re-fire with a complete fix_request {{file_path, bug_description, expected_behavior}}."
            )
        if build_status == "ESCALATED":
            return (
                f"Repair #6 for {file_path} could not pass KRITE in {iterations} iterations. "
                f"This is the designed escalation: the bug + constraints are fighting "
                f"the doctrine. You decide: accept the patch as-is, redirect, or kill."
            )
        if build_status == "HONEST-FAILED":
            reason_hint = ""
            if isinstance(krite_scores, dict) and krite_scores.get("failures"):
                reason_hint = f" Reason: {'; '.join(krite_scores['failures'][:2])}."
            return (
                f"Repair #6 for {file_path} HONEST-FAILED before producing a usable patch.{reason_hint} "
                f"See structured fields (validation, krite_scores) for detail."
            )
        return f"Repair #6 for {file_path}: status {build_status}. See structured fields for detail."

    # Original build-mode summary path — preserved bit-for-bit
    if build_status == "BUILT":
        avg = sum(
            float(krite_scores.get(a, 0))
            for a in ("voice", "compliance", "research", "tone", "wku")
        ) / 5.0
        if runtime_host == "netlify-fn":
            return (
                f"{agent_name} is BUILT. KRITE passed on iteration {iterations} "
                f"(average score {avg:.2f}/1.00). Generated JavaScript lives at "
                f"{runtime_path} (commit to cornerstoneregroup-site repo; Netlify "
                f"auto-deploys on push). Functional test deferred to Gate C against "
                f"the Netlify deploy preview after push. Promotion to LIVE requires "
                f"7 consecutive days of clean Langfuse traces — that gate is automatic."
            )
        return (
            f"{agent_name} is BUILT. KRITE passed on iteration {iterations} "
            f"(average score {avg:.2f}/1.00). Runtime lives at {runtime_path}. "
            f"You can test-fire it from the Windmill UI. Promotion to LIVE requires "
            f"7 consecutive days of clean Langfuse traces — that gate is automatic."
        )
    if build_status == "REFUSED":
        failures = krite_scores.get("failures", [])
        return (
            f"{agent_name} build was refused before any code was written — "
            f"the build request was missing required information. "
            f"Specifically: {'; '.join(failures[:3])}. "
            f"Re-fire with a complete <build_request> XML and Build Agent will proceed."
        )
    if build_status == "ESCALATED":
        return (
            f"{agent_name} could not pass KRITE in 3 iterations. "
            f"This is the designed escalation, not a crash — it means the spec or "
            f"the synthesis is fighting the doctrine, and you need to decide: "
            f"ship-as-is, redirect, or kill. Build Agent will not auto-promote."
        )
    return f"{agent_name}: status {build_status}. See structured fields for detail."


# ----------------------------------------------------------------------------
# MAIN ORCHESTRATOR
# ----------------------------------------------------------------------------
def main(intake: dict | None = None) -> dict:
    """Build Agent v1 entrypoint — invoked by Windmill with `intake` JSON arg."""

    # ---- Step 1: secret hydration --------------------------------------
    try:
        anthropic_key = wmill.get_variable("u/admin/ANTHROPIC_API_KEY")
        perplexity_key = wmill.get_variable("u/admin/PERPLEXITY_API_KEY")
        lf_host = wmill.get_variable("u/admin/LANGFUSE_HOST")
        lf_pub = wmill.get_variable("u/admin/LANGFUSE_PUBLIC_KEY")
        lf_sec = wmill.get_variable("u/admin/LANGFUSE_SECRET_KEY")
    except Exception as e:
        return {
            "build_status": "HONEST-FAILED",
            "reason": f"Windmill variable hydration failed: {e}",
            "marc_facing_summary": (
                "Build Agent could not read its own credentials from Windmill. "
                "This is a setup issue, not a build issue. Check workspace variables "
                "u/admin/ANTHROPIC_API_KEY, PERPLEXITY_API_KEY, LANGFUSE_*."
            ),
        }

    # Refuse to operate on placeholder Anthropic key
    if not anthropic_key or anthropic_key.startswith("PLACEHOLDER"):
        return {
            "build_status": "MARC-ACTION-REQUIRED",
            "reason": "ANTHROPIC_API_KEY in Windmill is a placeholder",
            "marc_facing_summary": (
                "Build Agent is wired up but cannot call Claude until you paste a real "
                "Anthropic API key into the Windmill variable u/admin/ANTHROPIC_API_KEY. "
                "Open http://localhost:8000/admin/variables, find that row, click edit, paste."
            ),
        }

    # ---- Step 2: schema validation (drift-proof refusal) --------------
    # Repair #6 (2026-04-27): mode-aware. validate_intake now branches on
    # intake["mode"] ("build" default vs. "fix"). The refusal payload below
    # carries fix-mode required fields when relevant so the orchestrator knows
    # which intake shape it owes us.
    is_valid, failures = validate_intake(intake)
    intake_mode = (intake.get("mode", "build") if isinstance(intake, dict) else "build")
    if not is_valid:
        refusal = {
            "build_status": "REFUSED",
            "reason": "intake schema validation failed",
            "mode": intake_mode,  # Repair #6 (2026-04-27)
            "missing_or_invalid": failures,
            "required_fields": (
                FIX_REQUIRED_FIELDS if intake_mode == "fix" else REQUIRED_INTAKE_FIELDS
            ),
            "fix_request_required_keys": (
                FIX_REQUEST_REQUIRED_KEYS if intake_mode == "fix" else None
            ),
            "allowed_silos": sorted(ALLOWED_SILOS),
            "allowed_runtime_hosts": sorted(ALLOWED_RUNTIME_HOSTS),
            "allowed_modes": sorted(ALLOWED_MODES),
        }
        trace_id = langfuse_trace(
            lf_pub, lf_sec, lf_host,
            name="build-agent-v1.refusal",
            input_obj={"intake": intake},
            output_obj=refusal,
            metadata={"stage": "schema-validation", "mode": intake_mode},
        )
        refusal["test_fire_trace_ids"] = [trace_id]
        # Repair #6 (2026-04-27): pick a sensible identifier for the summary.
        # build-mode uses agent_name; fix-mode uses the file path.
        if intake_mode == "fix":
            fix_req = intake.get("fix_request") if isinstance(intake, dict) else None
            ident_path = (fix_req.get("file_path", "<unspecified>")
                          if isinstance(fix_req, dict) else "<unspecified>")
            refusal["marc_facing_summary"] = marc_summary(
                "REFUSED", "<fix-request>", "",
                {"failures": failures}, 0, [trace_id],
                mode="fix",
                fix_context={"file_path": ident_path, "bug_description": ""},
            )
        else:
            refusal["marc_facing_summary"] = marc_summary(
                "REFUSED", intake.get("agent_name", "<unnamed>") if isinstance(intake, dict) else "<unnamed>",
                "", {"failures": failures}, 0, [trace_id]
            )
        return refusal

    # Repair #6 (2026-04-27): mode-aware field extraction. In fix mode, build-
    # mode fields (agent_name, silo, runtime_host, scope, success_criteria)
    # are not required and may be absent; we substitute safe defaults so the
    # rest of the function can reference them without KeyErrors.
    mode = intake_mode
    if mode == "fix":
        fix_request = intake.get("fix_request", {}) or {}
        agent_name = f"fix:{os.path.basename(fix_request.get('file_path', 'unknown'))}"
        silo = "cross-cutting"
        runtime_host = "n/a"  # fix mode does not deploy a new runtime
        scope = fix_request.get("bug_description", "")
        success_criteria = fix_request.get("expected_behavior", "")
        canon_refs = intake.get("canon_refs", []) or []
        doctrine_refs = intake.get("doctrine_refs", []) or []
    else:
        agent_name = intake["agent_name"]
        silo = intake["silo"]
        runtime_host = intake["runtime_host"]
        scope = intake["scope"]
        success_criteria = intake["success_criteria"]
        canon_refs = intake.get("canon_refs", [])
        doctrine_refs = intake.get("doctrine_refs", [])

    # ---- Step 3: KRITE inline 3-iteration loop on the SPEC ------------
    # We score the build SPEC itself (not yet generated code) so we refuse
    # bad specs before generation. This implements rule_research_first_build_process
    # phase 1 + the SUPER-AGENT-BUILD-PHILOSOPHY-v1 citation discipline check.
    spec_text = json.dumps(intake, indent=2)
    krite_iterations = []
    krite_scores = None
    final_status = "ESCALATED"

    for iteration in range(1, KRITE_MAX_ITERATIONS + 1):
        # Patch 2 — call deployed KRITE agent v1 with inline fallback
        scores = krite_review_combined(
            spec_text, f"build-spec for {agent_name}",
            anthropic_key, lf_pub, lf_sec, lf_host
        )
        krite_iterations.append({"iteration": iteration, "scores": scores})
        if scores.get("pass"):
            krite_scores = scores
            final_status = "BUILT"
            break
        if scores.get("_anthropic_error"):
            final_status = "HONEST-FAILED"
            krite_scores = scores
            break

    if krite_scores is None:
        krite_scores = krite_iterations[-1]["scores"] if krite_iterations else {}

    # ---- Step 3.5 (Repair #6, 2026-04-27): FIX-MODE BRANCH -------------
    # Build Agent v1 is dual-purpose. When intake.mode == "fix", we hand off
    # to the fix-mode pipeline:
    #   1. Read the target file from disk (HONEST-FAIL if missing).
    #   2. Compose a fix-mode user prompt with bug + expected behavior + doctrine.
    #   3. Call Sonnet 4.6 with FIX_SYSTEM_PROMPT, max_tokens=24000.
    #   4. Validate the patched file (language-aware syntax check).
    #   5. Run KRITE on the patched code (threshold 0.80, same as build mode).
    #   6. Return artifact ({patched_content, validation, krite_scores, diff_preview}).
    # The orchestrator (Marc / Claude) handles the actual file write + git commit
    # AFTER reviewing the diff_preview. Build Agent does NOT auto-write to disk.
    if mode == "fix":
        fix_request = intake.get("fix_request", {}) or {}
        file_path = fix_request.get("file_path", "")
        bug_description = fix_request.get("bug_description", "")
        # Collect any per-call traces for the fix pipeline so callers can replay them
        fix_trace_ids: list[str] = []

        # Step F1: read the target file
        file_content = read_file_safely(file_path)
        if file_content is None:
            # Honest-fail with a marc-action — Marc/orchestrator must verify path
            fix_fail = {
                "build_status": "HONEST-FAILED",
                "mode": "fix",
                "reason": f"could not read target file at {file_path}",
                "file_path": file_path,
                "marc_action": (
                    "Verify the file path exists and is readable from the Build "
                    "Agent runtime. On Windmill workers, the orchestrator must "
                    "embed the file content into the intake (Build Agent runs in "
                    "an isolated container that cannot see Marc's local FS). "
                    "Local runs use the absolute path."
                ),
            }
            fail_trace = langfuse_trace(
                lf_pub, lf_sec, lf_host,
                name="build-agent-v1.fix.read-failed",
                input_obj={"file_path": file_path},
                output_obj=fix_fail,
                metadata={"stage": "fix-read", "mode": "fix"},
            )
            fix_trace_ids.append(fail_trace)
            fix_fail["test_fire_trace_ids"] = [t for t in fix_trace_ids if t]
            fix_fail["marc_facing_summary"] = marc_summary(
                "HONEST-FAILED", "<fix>", "",
                {"failures": [fix_fail["reason"]]},
                len(krite_iterations), fix_trace_ids,
                mode="fix",
                fix_context={"file_path": file_path,
                             "bug_description": bug_description},
            )
            return fix_fail

        # Step F2: compose user prompt (with doctrine block — same as build mode)
        # Repair #3 / Repair #6 — accept embedded doctrine_content from intake too
        doctrine_content_intake = intake.get("doctrine_content") or []
        doctrine_block, fix_doctrine_manifest = load_doctrine_blocks(
            doctrine_refs, doctrine_content_intake,
        )
        fix_user_prompt = compose_fix_user_prompt(
            intake, file_content, doctrine_block=doctrine_block,
        )

        # Step F3: call Sonnet with FIX_SYSTEM_PROMPT
        gen_resp = call_anthropic(
            ANTHROPIC_SONNET, FIX_SYSTEM_PROMPT, fix_user_prompt,
            anthropic_key, max_tokens=24000,  # match build-mode budget for big files
        )
        gen_trace_id = langfuse_trace(
            lf_pub, lf_sec, lf_host,
            name="build-agent-v1.fix.code-generation",
            input_obj={"file_path": file_path, "bug_preview": bug_description[:300]},
            output_obj={
                "model": ANTHROPIC_SONNET,
                "stop_reason": gen_resp.get("stop_reason"),
                "usage": gen_resp.get("usage"),
            },
            metadata={"stage": "fix-sonnet-generation", "mode": "fix"},
        )
        fix_trace_ids.append(gen_trace_id)

        if gen_resp.get("_error"):
            fix_fail = {
                "build_status": "HONEST-FAILED",
                "mode": "fix",
                "file_path": file_path,
                "reason": f"Sonnet 4.6 fix call failed: {gen_resp.get('body', 'unknown')}",
                "code_gen_response": {
                    "model": ANTHROPIC_SONNET,
                    "_error": True,
                    "_error_body": gen_resp.get("body"),
                },
                "test_fire_trace_ids": [t for t in fix_trace_ids if t],
            }
            fix_fail["marc_facing_summary"] = marc_summary(
                "HONEST-FAILED", "<fix>", "",
                {"failures": [fix_fail["reason"]]},
                len(krite_iterations), fix_trace_ids,
                mode="fix",
                fix_context={"file_path": file_path,
                             "bug_description": bug_description},
            )
            return fix_fail

        # Step F4: extract patched file content
        generated = ""
        for block in gen_resp.get("content", []):
            if block.get("type") == "text":
                generated += block.get("text", "")
        # Defensive markdown-fence stripping (FIX_SYSTEM_PROMPT forbids fences,
        # but Sonnet has been known to slip; mirror the build-mode strip logic).
        stripped = generated.strip()
        if stripped.startswith("```"):
            stripped = stripped.split("\n", 1)[1] if "\n" in stripped else stripped[3:]
            if stripped.rstrip().endswith("```"):
                stripped = stripped.rstrip()[:-3].rstrip()
        patched_content = stripped

        # Step F5: language-aware validation
        validation = validate_patched_file(patched_content, file_path)

        # Step F6: KRITE review on the patched code (threshold 0.80, same as build).
        # Per repair spec: krite_review_combined handles deployed + inline fallback.
        fix_krite_scores = krite_review_combined(
            patched_content,
            f"fix-patch for {file_path}",
            anthropic_key, lf_pub, lf_sec, lf_host,
        )
        if fix_krite_scores.get("_trace_id"):
            fix_trace_ids.append(fix_krite_scores["_trace_id"])

        # Step F7: compute diff preview (capped 50 lines)
        diff_preview = compute_diff_preview(file_content, patched_content, max_lines=50)

        # Decide final status: BUILT iff validation OK AND KRITE pass
        krite_pass = bool(fix_krite_scores.get("pass", False))
        validation_ok = bool(validation.get("ok", False))
        if validation_ok and krite_pass:
            fix_status = "BUILT"
        else:
            fix_status = "HONEST-FAILED"

        # Final trace for the fix flow
        fix_final_trace = langfuse_trace(
            lf_pub, lf_sec, lf_host,
            name="build-agent-v1.fix.final",
            input_obj={"file_path": file_path,
                       "bug_preview": bug_description[:200]},
            output_obj={
                "build_status": fix_status,
                "validation_ok": validation_ok,
                "krite_pass": krite_pass,
                "patched_byte_count": len(patched_content),
            },
            metadata={"stage": "fix-final", "mode": "fix",
                      "file_path": file_path},
        )
        if fix_final_trace:
            fix_trace_ids.append(fix_final_trace)

        fix_response = {
            "build_status": fix_status,
            "mode": "fix",  # Repair #6 (2026-04-27)
            "file_path": file_path,
            "file_repo": fix_request.get("file_repo", ""),
            "bug_description": bug_description,
            "expected_behavior": fix_request.get("expected_behavior", ""),
            "constraints": fix_request.get("constraints", []) or [],
            # Spec-stage KRITE scores (the same 3-iteration pre-flight we run for builds)
            "spec_krite_scores": {
                k: krite_scores.get(k)
                for k in ("voice", "compliance", "research", "tone", "wku", "pass")
            } if isinstance(krite_scores, dict) else {},
            "spec_krite_iterations": len(krite_iterations),
            # The fix output
            "patched_content": patched_content,
            "patched_byte_count": len(patched_content),
            "patched_line_count": validation.get("line_count", 0),
            "validation": validation,
            "krite_scores": {
                k: fix_krite_scores.get(k)
                for k in ("voice", "compliance", "research", "tone", "wku", "pass")
            },
            "krite_via": fix_krite_scores.get("_via", "unknown"),
            "krite_deployed_error": fix_krite_scores.get("_deployed_krite_error"),
            "krite_failures": fix_krite_scores.get("failures", []),
            "diff_preview": diff_preview,
            "code_gen_response": {
                "model": ANTHROPIC_SONNET,
                "stop_reason": gen_resp.get("stop_reason"),
                "usage": gen_resp.get("usage"),
            },
            "doctrine_refs": doctrine_refs,
            "doctrine_load_manifest": fix_doctrine_manifest,
            "test_fire_trace_ids": [t for t in fix_trace_ids if t],
            "marc_facing_summary": marc_summary(
                fix_status, "<fix>", file_path,
                fix_krite_scores, len(krite_iterations),
                [t for t in fix_trace_ids if t],
                mode="fix",
                fix_context={"file_path": file_path,
                             "bug_description": bug_description},
            ),
        }
        return fix_response

    # ---- Step 4: REAL code generation via Sonnet 4.6 ------------------
    # (was previously a stub-writer; repaired 2026-04-26 per repair-dispatch)
    runtime_path = ""
    runtime_create_response = None
    code_gen_response = None
    code_gen_validation = None
    functional_test_design = None
    functional_test_result = None
    canon_manifest = []
    doctrine_manifest = []
    # Repair #4 (2026-04-26): netlify-fn output support — gate now admits both
    # windmill (Python) and netlify-fn (Node.js) runtimes. Shared canon/doctrine
    # loading + KRITE iteration; language-specific gen-prompt + validation +
    # deploy gating below.
    if final_status == "BUILT" and runtime_host in ("windmill", "netlify-fn"):
        # ---- Sprint 2 (2026-05-05): Daniel research-first phase ----
        # Per rule_research_first_build_process.md: every build MUST identify
        # industry winners (with T1/T2 citations) before code generation.
        # If research fails, return INCOMPLETE — do not proceed.
        sprint2_research_question = (
            f"What are the top 2-3 industry winners (with T1/T2-cited sources) "
            f"for an agent with this scope? Be specific, cite URLs.\n\n"
            f"Silo: {silo}\nScope: {scope}\nSuccess criteria: {success_criteria}"
        )
        sprint2_research = daniel_research(
            question=sprint2_research_question,
            perplexity_key=perplexity_key,
            lf_pub=lf_pub, lf_sec=lf_sec, lf_host=lf_host,
        )
        sprint2_research_trace_id = (sprint2_research or {}).get("trace_id")
        if not (sprint2_research and sprint2_research.get("ok")):
            err_msg = (sprint2_research or {}).get("error", "no response")
            return {
                "build_status": "INCOMPLETE",
                "reason": "Sprint 2: research-first phase failed before code generation",
                "agent_name": agent_name,
                "silo": silo,
                "research_error": str(err_msg)[:500],
                "research_trace_ids": [sprint2_research_trace_id] if sprint2_research_trace_id else [],
                "marc_facing_summary": (
                    f"{agent_name} build refused before code generation. The Daniel/Perplexity "
                    f"research-first phase failed. Per rule_research_first_build_process.md, every "
                    f"build MUST identify industry winners + their templates before code is generated."
                ),
            }

        # Build the generation prompt: scope + success criteria + canon synthesis
        # + doctrine refs as load-bearing instructions.
        # Patch 1 — load actual canon + doctrine FILE CONTENT, not just paths
        # Repair #3 (2026-04-26): also accept embedded canon/doctrine_content from intake
        # (Windmill workers can't see local FS — orchestrator pre-loads + embeds)
        canon_content_intake = intake.get("canon_content") or []
        doctrine_content_intake = intake.get("doctrine_content") or []
        canon_content_block, canon_manifest = load_canon_blocks(canon_refs, canon_content_intake)
        doctrine_content_block, doctrine_manifest = load_doctrine_blocks(doctrine_refs, doctrine_content_intake)

        # ---- Sprint 2 (2026-05-05): refuse on missing canon/doctrine refs ----
        # Per Marc directive: no [FILE NOT FOUND] flowing silently into gen prompt.
        sprint2_missing_refs = []
        for entry in canon_manifest:
            if not entry.get("found"):
                sprint2_missing_refs.append(f"canon:{entry.get('ref')}")
        for entry in doctrine_manifest:
            if not entry.get("found"):
                sprint2_missing_refs.append(f"doctrine:{entry.get('ref')}")
        if sprint2_missing_refs:
            return {
                "build_status": "INCOMPLETE",
                "reason": "Sprint 2: required canon/doctrine ref(s) not found",
                "missing_refs": sprint2_missing_refs,
                "agent_name": agent_name,
                "research_trace_ids": [sprint2_research_trace_id] if sprint2_research_trace_id else [],
                "marc_facing_summary": (
                    f"{agent_name} build refused before code generation: "
                    f"{len(sprint2_missing_refs)} required reference file(s) not found. "
                    f"Builder will not generate against half-loaded doctrine. "
                    f"Missing first 3: {', '.join(sprint2_missing_refs[:3])}"
                ),
            }

        inputs_block = intake.get("inputs", "(see scope)")

        # Patch 4 — fetch deployed-agents registry to inject into gen prompt
        agent_registry_block = build_agent_registry_block()

        # Friendly path lists (still useful for logs / intent clarity)
        canon_paths_listed = "\n".join(f"- {c}" for c in canon_refs) if canon_refs else "(none)"
        doctrine_paths_listed = "\n".join(f"- {d}" for d in doctrine_refs) if doctrine_refs else "(none)"

        # Repair #4 (2026-04-26): runtime-specific gen-system + user-prompt-tail
        # The shared canon/doctrine/scope blocks are identical; only the output-
        # requirements tail differs (Python wmill vs. Node.js exports.handler).
        if runtime_host == "windmill":
            gen_system = GEN_SYSTEM_PROMPT
            output_extension = "py"
            output_language = "Python"
            output_requirements_block = (
                f"=== OUTPUT REQUIREMENTS ===\n"
                f"- A complete, runnable Python file for Windmill (workspace=crg, path=u/admin/{agent_name}).\n"
                f"- `def main(...)` entrypoint returning a dict matching success_criteria.\n"
                f"- Real implementation — no stubs, no TODOs, no placeholders.\n"
                f"- Secrets via wmill.get_variable. HTTP via urllib.request.\n"
                f"- Langfuse trace on every model call. WKU block in every system prompt.\n"
                f"- Defensive parsing of model responses (strip fences, handle missing content).\n"
                f"- Plain-English `marc_facing_summary` field in the return dict.\n"
                f"- Synthesize specific named voices from the canon content above (e.g. Sherrard, Buffini, Serhant for real-estate; Cardone, Bet-David, Mashore for cross-cutting). Cite them by name in the agent's system prompt.\n"
                f"- If your agent needs review/scoring, call u/admin/krite-agent-v1 via Windmill API. Do NOT inline a KRITE rubric.\n"
                f"- Include a `_load_doctrine()` helper that reads doctrine files at runtime AND have your agent reference doctrine in its actual behavior (e.g. model selection cites rule_model_selection.md, output formats cite feedback_communication_style.md).\n"
                f"- Include a WKU block (Wisdom · Knowledge · Understanding per rule_wku_framework.md) in every system prompt the generated agent uses.\n\n"
                f"Output ONLY the Python code. First character of your response must start the Python file."
            )
        else:  # runtime_host == "netlify-fn"
            # Repair #4 (2026-04-26): Node.js / Netlify Functions code-gen path
            gen_system = GEN_SYSTEM_PROMPT_NETLIFY
            output_extension = "js"
            output_language = "JavaScript"
            output_requirements_block = (
                f"=== OUTPUT REQUIREMENTS ===\n"
                f"- A complete, runnable Node.js (CommonJS) file for Netlify Functions at netlify/functions/{agent_name}.js.\n"
                f"- `exports.handler = async (event, context) => {{ ... }}` entrypoint returning `{{ statusCode, headers, body }}` (body JSON-stringified).\n"
                f"- Real implementation — no stubs, no TODOs, no placeholders.\n"
                f"- Secrets via `requireEnv` from `./_lib/env`. HTTP via global `fetch()` (Node 18+ on Netlify).\n"
                f"- Langfuse trace on every Claude call (use `tracedAnthropicCall` from `./_lib/langfuse`).\n"
                f"- Defensive parsing of model responses (strip fences, handle missing content).\n"
                f"- Plain-English `marc_facing_summary` field in the response body.\n"
                f"- Synthesize specific named voices from the canon content above (e.g. Sherrard, Buffini, Serhant for real-estate; Cardone, Bet-David, Mashore for cross-cutting). Cite them by name in the agent's system prompt.\n"
                f"- If your agent needs review/scoring, call KRITE via `kritiqueWithKrite` from `./utils/krite`. Do NOT inline a KRITE rubric.\n"
                f"- Include a `_loadDoctrine(refs)` helper that reads doctrine files at runtime AND have your agent reference doctrine in its actual behavior (e.g. model selection cites rule_model_selection.md, output formats cite feedback_communication_style.md).\n"
                f"- Include a WKU block (Wisdom · Knowledge · Understanding per rule_wku_framework.md) in every system prompt the generated agent uses.\n"
                f"- For voice-inbound or low-latency agents, support `?refine=1` query-param fast/slow path split (see GEN_SYSTEM_PROMPT_NETLIFY for pattern).\n\n"
                f"Output ONLY the JavaScript code. First character of your response must start the .js file."
            )

        gen_user_prompt = (
            f"Build the runtime {output_language} script for the agent `{agent_name}`.\n\n"
            f"=== SILO ===\n{silo}\n\n"
            f"=== SCOPE (the actual job to do) ===\n{scope}\n\n"
            f"=== INPUTS the agent receives ===\n{inputs_block}\n\n"
            f"=== SUCCESS CRITERIA (must be matched EXACTLY) ===\n{success_criteria}\n\n"
            f"=== CANON REFS — FILE PATHS ===\n{canon_paths_listed}\n\n"
            f"=== CANON CONTENT (full text — synthesize voices, cite specific names) ===\n"
            f"{canon_content_block}\n\n"
            f"=== DOCTRINE REFS — FILE PATHS ===\n{doctrine_paths_listed}\n\n"
            f"=== DOCTRINE CONTENT (full text — honor every load-bearing instruction) ===\n"
            f"{doctrine_content_block}\n\n"
            f"=== DEPLOYED CRG AGENTS (call these — DO NOT reinvent) ===\n"
            f"{agent_registry_block}\n\n"
            f"{output_requirements_block}"
        )

        gen_resp = call_anthropic(
            ANTHROPIC_SONNET, gen_system, gen_user_prompt,
            anthropic_key, max_tokens=24000,  # Repair #3: bumped 8000→24000 (Sonnet was hitting max_tokens stop_reason on Lazarus, leaving incomplete code)
        )
        code_gen_response = {
            "model": ANTHROPIC_SONNET,
            "output_language": output_language,  # Repair #4 (2026-04-26): expose generated language to callers
            "output_extension": output_extension,
            "stop_reason": gen_resp.get("stop_reason"),
            "usage": gen_resp.get("usage"),
            "_error": gen_resp.get("_error"),
            "_error_body": gen_resp.get("body") if gen_resp.get("_error") else None,
        }

        # Trace the generation call
        gen_trace_id = langfuse_trace(
            lf_pub, lf_sec, lf_host,
            name="build-agent-v1.code-generation",
            input_obj={"agent_name": agent_name, "scope_preview": scope[:300]},
            output_obj={
                "model": ANTHROPIC_SONNET,
                "stop_reason": gen_resp.get("stop_reason"),
                "usage": gen_resp.get("usage"),
            },
            metadata={"stage": "sonnet-code-generation", "agent_name": agent_name},
        )

        # Hard-fail explicitly on Anthropic error — DO NOT fall back to stub
        if gen_resp.get("_error"):
            final_status = "HONEST-FAILED"
            code_gen_validation = {
                "ok": False,
                "reason": f"Sonnet 4.6 call failed: {gen_resp.get('body', 'unknown')}",
            }
        else:
            # Extract the generated Python from response.content
            generated = ""
            for block in gen_resp.get("content", []):
                if block.get("type") == "text":
                    generated += block.get("text", "")

            # Strip markdown fences if Sonnet wrapped output (defensive — system
            # prompt forbids this, but we've all seen models slip)
            stripped = generated.strip()
            if stripped.startswith("```"):
                # Remove opening fence (```python or ```)
                stripped = stripped.split("\n", 1)[1] if "\n" in stripped else stripped[3:]
                # Remove closing fence
                if stripped.rstrip().endswith("```"):
                    stripped = stripped.rstrip()[:-3].rstrip()
            generated = stripped

            # ---- Sprint 2 (2026-05-05): validate generated code for required doctrine markers ----
            # Per feedback_anti_drift_block_2026_04_30.md: 10 canonical markers byte-for-byte.
            # Per rule_wku_framework.md: WKU/Wisdom/Proverbs 24:3 framing required.
            ANTI_DRIFT_V2_MARKERS = [
                "EVIDENCE-OR-INCOMPLETE",
                "GATE F",
                "T1",
                "NO INLINE EDITS",
                "CONTRADICTION",
                "STALE-MEMORY",
                "INCOMPLETE-OVER-FAKED",
                "PLAIN-ENGLISH MARC-FACING",
                "SELF-DOUBT AS FEATURE",
                "PRECEDENCE",
            ]
            sprint2_missing_markers = [m for m in ANTI_DRIFT_V2_MARKERS if m not in generated]
            sprint2_wku_present = any(kw in generated for kw in ("WKU", "Wisdom", "Proverbs 24:3"))

            if sprint2_missing_markers or not sprint2_wku_present:
                return {
                    "build_status": "INCOMPLETE",
                    "reason": "Sprint 2: generated code missing required doctrine markers",
                    "agent_name": agent_name,
                    "missing_anti_drift_markers": sprint2_missing_markers,
                    "wku_present": sprint2_wku_present,
                    "research_trace_ids": [sprint2_research_trace_id] if sprint2_research_trace_id else [],
                    "code_gen_trace_ids": [gen_trace_id] if gen_trace_id else [],
                    "marc_facing_summary": (
                        f"{agent_name} build refused at code-gen validation: generated code "
                        f"missing {len(sprint2_missing_markers)} of 10 anti-drift v2 markers"
                        f"{' AND missing WKU framing' if not sprint2_wku_present else ''}. "
                        f"Builder enforces these per feedback_anti_drift_block_2026_04_30.md "
                        f"and rule_wku_framework.md. Sonnet must paste the canonical block verbatim."
                    ),
                }

            # ---- Sprint 3 Patch G (2026-05-05): KRITE Voice hard-fails ----
            # Block sales-theater language + fake completion language in generated code.
            # Per EVALUATION-GRADING-FRAMEWORK-v1.md Voice axis hard-fails.
            SPRINT3_SALES_THEATER_PHRASES = [
                "game-changing", "revolutionary", "unprecedented",
                "in today's fast-paced", "ever-changing landscape",
                "best-in-class", "world-class", "next-generation",
                "delve into", "dive into", "landscape of",
                "leverage synergy", "synergize",
            ]
            SPRINT3_FAKE_COMPLETION_PHRASES = [
                "successfully deployed", "successfully built",
                "successfully shipped", "successfully completed",
                "everything is working", "all systems operational",
                "production-ready and tested",
            ]
            sprint3_lower = generated.lower()
            sprint3_sales_theater = [p for p in SPRINT3_SALES_THEATER_PHRASES if p in sprint3_lower]
            sprint3_fake_completion = [p for p in SPRINT3_FAKE_COMPLETION_PHRASES if p in sprint3_lower]
            if sprint3_sales_theater or sprint3_fake_completion:
                return {
                    "build_status": "INCOMPLETE",
                    "reason": "Sprint 3: KRITE Voice hard-fail — banned phrases found in generated code",
                    "agent_name": agent_name,
                    "sales_theater_found": sprint3_sales_theater,
                    "fake_completion_found": sprint3_fake_completion,
                    "research_trace_ids": [sprint2_research_trace_id] if sprint2_research_trace_id else [],
                    "code_gen_trace_ids": [gen_trace_id] if gen_trace_id else [],
                    "marc_facing_summary": (
                        f"{agent_name} build refused at KRITE Voice gate: generated code contains "
                        f"{len(sprint3_sales_theater)} sales-theater phrase(s) "
                        f"and/or {len(sprint3_fake_completion)} fake-completion phrase(s). "
                        f"Per EVALUATION-GRADING-FRAMEWORK-v1.md Voice axis hard-fails."
                    ),
                }

            # ---- Sprint 3 Patch F (2026-05-05): agentGuard validation ----
            # Per AGENT-OPERATING-MODEL.md, every CRG agent must call
            # agentGuard(tier, name) at function entry, fail-closed.
            if "agentGuard(" not in generated:
                return {
                    "build_status": "INCOMPLETE",
                    "reason": "Sprint 3: generated code missing agentGuard(tier, name) call",
                    "agent_name": agent_name,
                    "research_trace_ids": [sprint2_research_trace_id] if sprint2_research_trace_id else [],
                    "code_gen_trace_ids": [gen_trace_id] if gen_trace_id else [],
                    "marc_facing_summary": (
                        f"{agent_name} build refused: generated code does not call "
                        f"agentGuard(tier, name) at function entry. Per "
                        f"AGENT-OPERATING-MODEL.md, every CRG agent must be wrapped "
                        f"in agentGuard for tier-aware fail-closed gating."
                    ),
                }

            # Validate the generated code (per repair-dispatch checks).
            # Repair #4 (2026-04-26): runtime-specific validation. Python checks
            # `def main(` + Anthropic refs; Node.js checks `exports.handler` +
            # absence of `def main(` + Anthropic refs.
            line_count = generated.count("\n") + 1 if generated else 0
            anthropic_mentions = (
                generated.count("api.anthropic.com")
                + generated.count("ANTHROPIC")
                + generated.count("anthropic_key")
                + generated.count("ANTHROPIC_API_KEY")
                + generated.count("claude-opus")
                + generated.count("claude-sonnet")
                + generated.count("x-api-key")
            )

            scope_lower = (scope + " " + success_criteria).lower()
            is_llm_agent = any(
                kw in scope_lower
                for kw in ("claude", "anthropic", "llm", "score", "review", "judge",
                           "generate", "synthesize", "rewrite", "krite", "voice")
            )

            validation_failures = []

            if runtime_host == "windmill":
                # Existing Python validation (untouched by Repair #4)
                has_main = "def main(" in generated
                has_handler = False  # not applicable for Python
                if not has_main:
                    validation_failures.append("missing `def main(` entrypoint")
                if line_count < 100:
                    validation_failures.append(
                        f"too short: {line_count} lines (need >=100; real agents aren't 11-line stubs)"
                    )
                if is_llm_agent and anthropic_mentions < 3:
                    validation_failures.append(
                        f"LLM-using agent has only {anthropic_mentions} anthropic refs (need >=3)"
                    )
            else:  # runtime_host == "netlify-fn"
                # Repair #4 (2026-04-26): Node.js validation
                # 1. exports.handler present
                # 2. NO `def main(` (would mean Sonnet emitted Python — wrong language)
                # 3. starts with valid JS (JSDoc comment, require, const, or import)
                # 4. line_count >= 100 (same threshold as Python)
                # 5. anthropic refs >= 3 for LLM agents (same as Python)
                has_handler = "exports.handler" in generated
                has_main = "def main(" in generated  # presence here is a FAILURE signal
                first_line = generated.lstrip().split("\n", 1)[0] if generated else ""
                # Heuristic JS-start sniff: JSDoc, line comment, require, const, let,
                # import, "use strict", or exports.
                js_first_line_ok = bool(first_line) and (
                    first_line.startswith("/**")
                    or first_line.startswith("//")
                    or first_line.startswith("/*")
                    or first_line.startswith("const ")
                    or first_line.startswith("let ")
                    or first_line.startswith("var ")
                    or first_line.startswith("require(")
                    or first_line.startswith("import ")
                    or first_line.startswith("\"use strict\"")
                    or first_line.startswith("'use strict'")
                    or first_line.startswith("exports.")
                    or first_line.startswith("module.")
                )
                if not has_handler:
                    validation_failures.append("missing `exports.handler` entrypoint")
                if has_main:
                    validation_failures.append(
                        "found `def main(` — Sonnet emitted Python instead of JavaScript"
                    )
                if not js_first_line_ok:
                    validation_failures.append(
                        f"first line does not look like valid JS: {first_line[:80]!r}"
                    )
                if line_count < 100:
                    validation_failures.append(
                        f"too short: {line_count} lines (need >=100; real agents aren't 11-line stubs)"
                    )
                if is_llm_agent and anthropic_mentions < 3:
                    validation_failures.append(
                        f"LLM-using agent has only {anthropic_mentions} anthropic refs (need >=3)"
                    )

            code_gen_validation = {
                "ok": len(validation_failures) == 0,
                "runtime_host": runtime_host,  # Repair #4 (2026-04-26)
                "output_language": output_language,
                "line_count": line_count,
                "has_main": has_main,
                "has_handler": has_handler,  # Repair #4 (2026-04-26): Node.js entrypoint check
                "anthropic_mentions": anthropic_mentions,
                "is_llm_agent": is_llm_agent,
                "failures": validation_failures,
                "trace_id": gen_trace_id,
            }

            if validation_failures:
                # Hard-fail — DO NOT silently fall back to stub
                final_status = "HONEST-FAILED"
            else:
                # Validated — deploy or hand off the real generated code
                script_content = generated

                # Repair #4 (2026-04-26): Windmill deploy is gated to windmill
                # runtime only. For netlify-fn, the orchestrator (Marc / Claude)
                # commits the generated .js to the cornerstoneregroup-site repo
                # and Netlify auto-deploys on push — there is no Build-Agent-side
                # deploy API call.
                if runtime_host == "windmill":
                    # Windmill injects WM_TOKEN as a job-scoped JWT good for self-API calls.
                    wm_token = os.environ.get("WM_TOKEN", "")
                    if wm_token:
                        create_resp = _http_post(
                            "http://localhost:8000/api/w/admin/scripts/create",
                            headers={
                                "Authorization": f"Bearer {wm_token}",
                                "Content-Type": "application/json",
                            },
                            body={
                                "path": f"u/admin/{agent_name}",
                                "summary": f"{agent_name} (built by build-agent-v1)",
                                "description": (
                                    f"Generated by build-agent-v1 via Sonnet 4.6 on "
                                    f"{time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}. "
                                    f"Silo: {silo}."
                                ),
                                "content": script_content,
                                "language": "python3",
                                "is_template": False,
                                "kind": "script",
                            },
                            timeout=30,
                        )
                        runtime_create_response = create_resp
                        if (not create_resp.get("_error")) and create_resp.get("_ok"):
                            runtime_path = (
                                f"http://localhost:8000/api/w/admin/jobs/run/p/u/admin/{agent_name}"
                            )
                    else:
                        runtime_create_response = {
                            "_error": True,
                            "body": "WM_TOKEN env var not set",
                        }
                        final_status = "HONEST-FAILED"
                else:
                    # Repair #4 (2026-04-26): netlify-fn artifact return path.
                    # No Build-Agent-side API call to Netlify — orchestrator commits
                    # the .js to the cornerstoneregroup-site repo and Netlify
                    # auto-deploys on push. We surface the artifact + the target
                    # repo path so the orchestrator knows where to commit.
                    runtime_path = f"netlify/functions/{agent_name}.js"
                    runtime_create_response = {
                        "_ok": True,
                        "note": (
                            "netlify-fn output — orchestrator commits to "
                            "cornerstoneregroup-site repo at the runtime_path; "
                            "Netlify auto-deploys on push. Build Agent does not "
                            "deploy Netlify functions directly."
                        ),
                        "target_repo": "cornerstoneregroup-site",
                        "target_path": runtime_path,
                        "generated_code": script_content,
                        "byte_count": len(script_content),
                        "line_count": line_count,
                    }

    # ---- Step 4.5: PATCH 3 — functional test-fire (real-input behavior) ----
    # After deploy, design a concrete test_input + expected_markers, fire the
    # agent for real, and verify the response contains canon-signature markers.
    # A stub returning JSON for any input no longer passes Gate C.
    #
    # Repair #4 (2026-04-26): functional test-fire is Windmill-only. For
    # netlify-fn, the orchestrator runs Gate C against the deploy preview URL
    # AFTER pushing the .js to the repo — at that moment the function isn't
    # live yet (Marc must commit + push, Netlify must build). Skipping here
    # keeps Build Agent honest: don't claim a test passed against an artifact
    # that isn't deployed yet.
    functional_test_design = None
    functional_test_result = None
    if final_status == "BUILT" and runtime_path and runtime_host == "windmill":
        functional_test_design = design_functional_test(
            agent_name, scope, success_criteria,
            intake.get("inputs", "(see scope)"),
            anthropic_key, lf_pub, lf_sec, lf_host,
        )
        if functional_test_design.get("_error"):
            # Test design failed — mark as warning, not crash, per repair-2 instruction
            functional_test_result = {
                "ok": False,
                "warning": (
                    f"FUNCTIONAL_TEST_DESIGN_FAILED: "
                    f"{functional_test_design.get('reason', 'unknown')}"
                ),
                "markers_found": [], "markers_missing": [],
            }
        else:
            test_input = functional_test_design.get("test_input", {}) or {}
            expected_markers = functional_test_design.get("expected_markers", []) or []
            functional_test_result = run_functional_test(
                f"u/admin/{agent_name}", test_input, expected_markers,
                lf_pub, lf_sec, lf_host,
            )
            if not functional_test_result.get("ok"):
                # Markers missing — flag as warning, do NOT silently revert status.
                # Per repair-2 DO-NOT: deployed-KRITE errors are warnings, but
                # functional-test failures with concrete missing markers ARE a
                # real signal — log + continue but mark FUNCTIONAL_TEST_FAILED.
                functional_test_result["warning"] = (
                    "FUNCTIONAL_TEST_FAILED: agent deployed but expected markers "
                    "missing from test response. The agent is callable but may be "
                    "stubbing canon synthesis."
                )
    elif final_status == "BUILT" and runtime_host == "netlify-fn":
        # Repair #4 (2026-04-26): explicit skip-and-explain for netlify-fn so
        # the response shape doesn't carry silent nulls. The orchestrator runs
        # Gate C (curl against the Netlify URL) AFTER commit + Netlify build.
        functional_test_result = {
            "ok": True,
            "skipped": True,
            "reason": (
                "netlify-fn runtime: functional test deferred to orchestrator "
                "Gate C against Netlify deploy preview after commit + push. "
                "Build Agent does not test pre-deploy artifacts."
            ),
            "markers_found": [], "markers_missing": [],
        }

    # ---- Sprint 3 Patches D + E + H (2026-05-05): source-write + registry + Habakkuk ----
    # Per Marc directive: no Windmill-only / runtime-only output. If any Sprint 3
    # gate fails, downgrade final_status to INCOMPLETE — no fake completion.
    import subprocess
    sprint3_source_path = None
    sprint3_registry_updated = None
    sprint3_habakkuk_status = "not_run"
    sprint3_habakkuk_verdict = None
    sprint3_failures = []

    if final_status == "BUILT":
        # Patch D: write generated source to disk (so orchestrator can git commit)
        sprint3_repo_roots = [
            "/workspace/cornerstoneregroup-site",
            "/Users/marcpapineau/.openclaw/workspace/cornerstoneregroup-site",
            os.path.expanduser("~/.openclaw/workspace/cornerstoneregroup-site"),
        ]
        if runtime_host == "netlify-fn":
            sprint3_target_subpath = f"netlify/functions/{agent_name}.js"
        elif runtime_host == "windmill":
            sprint3_target_subpath = f"01-CORNERSTONE-RESEARCH-GROUP/agents/windmill/{agent_name}/main.py"
        else:
            sprint3_target_subpath = None

        try:
            generated_str = generated  # type: ignore[name-defined]
        except NameError:
            generated_str = None

        if sprint3_target_subpath and generated_str:
            for root in sprint3_repo_roots:
                cand = os.path.join(root, sprint3_target_subpath)
                try:
                    os.makedirs(os.path.dirname(cand), exist_ok=True)
                    with open(cand, "w") as fh:
                        fh.write(generated_str)
                    sprint3_source_path = cand
                    break
                except (OSError, PermissionError):
                    continue
            if not sprint3_source_path:
                sprint3_failures.append("Patch D: could not write source — no writable shared FS")
                final_status = "INCOMPLETE"

        # Patch E: update agents-registry.json (only if source written)
        if sprint3_source_path:
            for root in sprint3_repo_roots:
                rpath = os.path.join(root, "data", "agents-registry.json")
                if os.path.exists(rpath):
                    try:
                        with open(rpath) as fh:
                            registry = json.load(fh)
                        agents_list = registry.get("agents", []) if isinstance(registry, dict) else (registry if isinstance(registry, list) else [])
                        new_entry = {
                            "name": agent_name,
                            "silo": silo,
                            "runtime_host": runtime_host,
                            "runtime_id": f"{runtime_host}:{agent_name}",
                            "source_path": sprint3_source_path,
                            "trace_id": (final_trace_id if 'final_trace_id' in dir() else None),
                            "build_status": "BUILT",
                            "built_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                            "memory_status": "not_yet_bootstrapped",
                        }
                        existing_idx = None
                        for i, a in enumerate(agents_list):
                            if isinstance(a, dict) and a.get("name") == agent_name:
                                existing_idx = i
                                break
                        if existing_idx is not None:
                            agents_list[existing_idx] = new_entry
                        else:
                            agents_list.append(new_entry)
                        if isinstance(registry, dict):
                            registry["agents"] = agents_list
                        else:
                            registry = agents_list
                        with open(rpath, "w") as fh:
                            json.dump(registry, fh, indent=2)
                        sprint3_registry_updated = rpath
                        break
                    except Exception as e:
                        sprint3_failures.append(f"Patch E: registry update at {rpath} failed: {e}")
                        continue
            if not sprint3_registry_updated:
                sprint3_failures.append("Patch E: agents-registry.json not found at any candidate path")
                final_status = "INCOMPLETE"

        # Patch H: run Habakkuk pattern checks
        habakkuk_paths = [
            os.path.join(r, "scripts", "qa", "habakkuk-pre-build.sh") for r in sprint3_repo_roots
        ]
        habakkuk_found = next((p for p in habakkuk_paths if os.path.exists(p)), None)
        if not habakkuk_found:
            sprint3_habakkuk_status = "unavailable"
            sprint3_failures.append("Patch H: habakkuk-pre-build.sh not accessible from runtime container")
            final_status = "INCOMPLETE"
        else:
            try:
                proc = subprocess.run(
                    ["bash", habakkuk_found, "--json"],
                    capture_output=True, timeout=60, text=True,
                )
                sprint3_habakkuk_status = f"ran (exit={proc.returncode})"
                sprint3_habakkuk_verdict = (proc.stdout or "")[:1500]
                # Exit codes: 0=pass, 1=reject, 2=inconclusive (fail-closed), 3=environmental
                if proc.returncode != 0:
                    sprint3_failures.append(f"Patch H: Habakkuk exit={proc.returncode}")
                    final_status = "INCOMPLETE"
            except subprocess.TimeoutExpired:
                sprint3_habakkuk_status = "timeout"
                sprint3_failures.append("Patch H: Habakkuk timed out")
                final_status = "INCOMPLETE"
            except Exception as e:
                sprint3_habakkuk_status = f"error: {e}"
                sprint3_failures.append(f"Patch H: Habakkuk error: {e}")
                final_status = "INCOMPLETE"

    # ---- Step 5: emit final trace + return Marc-facing summary --------
    final_trace_id = langfuse_trace(
        lf_pub, lf_sec, lf_host,
        name="build-agent-v1.final",
        input_obj={"agent_name": agent_name, "silo": silo, "iterations": len(krite_iterations)},
        output_obj={"build_status": final_status, "krite_scores": krite_scores, "runtime_path": runtime_path},
        metadata={"agent_name": agent_name, "silo": silo},
    )

    trace_ids = [final_trace_id] + [
        s.get("scores", {}).get("_trace_id", "")
        for s in krite_iterations
    ]
    trace_ids = [t for t in trace_ids if t]

    # Resolve canon/doctrine manifests for traces (set during gen-prompt build)
    try:
        canon_manifest_out = canon_manifest  # type: ignore[name-defined]
    except NameError:
        canon_manifest_out = []
    try:
        doctrine_manifest_out = doctrine_manifest  # type: ignore[name-defined]
    except NameError:
        doctrine_manifest_out = []

    return {
        "build_status": final_status,
        "agent_name": agent_name,
        "silo": silo,
        "runtime_host": runtime_host,
        "runtime_path": runtime_path,
        "krite_scores": {
            k: krite_scores.get(k) for k in ("voice", "compliance", "research", "tone", "wku", "pass")
        },
        "krite_iterations": len(krite_iterations),
        "krite_failures": krite_scores.get("failures", []),
        "krite_via": krite_scores.get("_via", "unknown"),
        "krite_deployed_error": krite_scores.get("_deployed_krite_error"),
        "test_fire_trace_ids": trace_ids,
        "canon_refs": canon_refs,
        "doctrine_refs": doctrine_refs,
        "canon_load_manifest": canon_manifest_out,
        "doctrine_load_manifest": doctrine_manifest_out,
        "runtime_create_response": runtime_create_response,
        "code_gen_response": code_gen_response,
        "code_gen_validation": code_gen_validation,
        "functional_test_design": functional_test_design,
        "functional_test_result": functional_test_result,
        # Sprint 3 (2026-05-05): source-write + registry + Habakkuk fields
        "sprint3_source_path": sprint3_source_path if 'sprint3_source_path' in dir() else None,
        "sprint3_registry_updated": sprint3_registry_updated if 'sprint3_registry_updated' in dir() else None,
        "sprint3_habakkuk_status": sprint3_habakkuk_status if 'sprint3_habakkuk_status' in dir() else "skipped",
        "sprint3_habakkuk_verdict": sprint3_habakkuk_verdict if 'sprint3_habakkuk_verdict' in dir() else None,
        "sprint3_failures": sprint3_failures if 'sprint3_failures' in dir() else [],
        "marc_facing_summary": marc_summary(
            final_status, agent_name, runtime_path,
            krite_scores, len(krite_iterations), trace_ids,
            runtime_host=runtime_host,  # Repair #4 (2026-04-26): runtime-aware summary
        ),
    }
