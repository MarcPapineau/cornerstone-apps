# OBADIAH the Prophet — Agent README

**Version:** v1.0.0  
**Model:** claude-sonnet-4-6  
**Owner:** Marc Papineau / CRG (internal use only)  
**Spec:** `crg-command-center/OBADIAH-V1-SPEC.md`

---

## Overview

OBADIAH synthesizes pre-fetched crypto market data snapshots into a structured JSON intelligence brief matching the `obadiah-output@1.0` schema. It runs daily at 5:55am ET via Windmill, receives the data snapshot as its first user message, and returns raw JSON that Windmill writes to `data/crypto-latest.json`.

V1 is pure reasoning — no live tool calls. The Windmill orchestrator (Builder 2, PR #20) pre-fetches all data and hands it to OBADIAH as a single snapshot payload.

---

## Anthropic Managed Agents vs Messages API (V1)

OBADIAH was successfully registered as an Anthropic Managed Agent on 2026-05-04.

| Path | Status | Notes |
|---|---|---|
| Managed Agents (agent definition) | ACTIVE | `agent_011CaiQ2gQUKhMSnp4SXT4ZR` stored in Doppler |
| Managed Agents (session invocation) | V2 DEFERRED | Requires `environment_id` — not wired in V1 |
| Messages API (runtime invocation) | V1 ACTIVE | Windmill orchestrator uses this in V1 |

**V1 runtime path:** Windmill loads the system prompt from `agents/obadiah/system-prompt.md` (or Doppler-cached), calls `client.messages.create()` with `model: claude-sonnet-4-6`, and passes the data snapshot as the user message. The Managed Agents `agent_id` is stored for V2 upgrade — when session-based invocation is wired, Windmill switches to the Managed Agents session API with no system-prompt changes required.

---

## Keys (Doppler only — never hardcoded)

| Key | Doppler ref | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | `doppler secrets get ANTHROPIC_API_KEY -p crg-site -c prd --plain` | For agent creation + inference |
| `OBADIAH_AGENT_ID` | `doppler secrets get OBADIAH_AGENT_ID -p crg-site -c prd --plain` | `agent_011CaiQ2gQUKhMSnp4SXT4ZR` (real) or `FALLBACK_MESSAGES_API_<ts>` |
| `TELEGRAM_BOT_TOKEN` | `doppler secrets get TELEGRAM_BOT_TOKEN -p crg-site -c prd --plain` | For Telegram brief delivery |
| `WINDMILL_TOKEN` | `doppler secrets get WINDMILL_TOKEN -p crg-site -c prd --plain` | For Windmill flow deployment |

Never ask Marc for a credential. Run Doppler first.

---

## How to create / refresh the agent

Run once to register the agent definition with Anthropic Managed Agents and save the `agent_id` to Doppler:

```bash
cd /Users/marcpapineau/.openclaw/workspace/crg-command-center
export ANTHROPIC_API_KEY=$(doppler secrets get ANTHROPIC_API_KEY -p crg-site -c prd --plain)
npx tsx agents/obadiah/create-agent.ts
```

**What it does:**
1. Reads `agents/obadiah/system-prompt.md`
2. Calls `client.beta.agents.create()` with model `claude-sonnet-4-6`
3. On success: saves `OBADIAH_AGENT_ID` to Doppler automatically
4. On Managed Agents unavailability: saves a `FALLBACK_MESSAGES_API_<ts>` sentinel to Doppler and documents fallback path

Re-run this only when the system prompt changes and you need to update the agent definition. The agent_id is stable across runs unless you delete and recreate.

---

## How to test-fire

Fires a mock snapshot through the agent (Messages API path) and validates the output JSON against the `obadiah-output@1.0` schema:

```bash
cd /Users/marcpapineau/.openclaw/workspace/crg-command-center
export ANTHROPIC_API_KEY=$(doppler secrets get ANTHROPIC_API_KEY -p crg-site -c prd --plain)
export OBADIAH_AGENT_ID=$(doppler secrets get OBADIAH_AGENT_ID -p crg-site -c prd --plain)
npx tsx agents/obadiah/test-fire.ts
```

**Expected output:**
```
✓ All required schema fields present
✓ Schema version: obadiah-output@1.0
=== TEST FIRE COMPLETE ===
PASS — all schema fields present, JSON valid
```

Full JSON saved to `agents/obadiah/test-fire-output.json` after each run (gitignored in production — commit for Gate D evidence only).

**Required schema fields validated:**
`schema`, `generated_at`, `market_regime`, `regime_confidence`, `regime_commentary`, `fear_greed`, `fear_greed.value`, `fear_greed.classification`, `fear_greed.trend_24h`, `top_assets`, `recommendations`, `news`, `events`, `data_freshness`

---

## Fallback path (Messages API)

If Managed Agents is not accessible on the account:

- `create-agent.ts` saves `FALLBACK_MESSAGES_API_<timestamp>` to Doppler as `OBADIAH_AGENT_ID`
- `test-fire.ts` detects the `FALLBACK_` prefix and uses direct Messages API
- The Windmill orchestrator (PR #20) already handles this — reads `OBADIAH_AGENT_ID` and routes to Messages API if it starts with `FALLBACK_`
- No system prompt changes needed — the system prompt is identical in both paths

The V1 architecture note in the spec explicitly calls this out: "OBADIAH_AGENT_ID is OPTIONAL — if Managed Agents creation fails or beta isn't accessible, fall back to Messages API and document."

---

## Rollback

If a bad system prompt update breaks inference:

1. Check git log for the last known-good commit:
   ```bash
   git log --oneline agents/obadiah/system-prompt.md
   ```
2. Restore the prior version:
   ```bash
   git checkout <prior-sha> -- agents/obadiah/system-prompt.md
   ```
3. Re-run `create-agent.ts` to push the restored system prompt to Managed Agents
4. Verify with `test-fire.ts`

If `OBADIAH_AGENT_ID` is lost from Doppler, re-running `create-agent.ts` creates a new agent and saves the new ID. All V1 Windmill invocations read the system prompt from git — the agent_id is only needed for V2 session invocation.

---

## Doctrine compliance

- **WKU framing** (Proverbs 24:3-4 — Wisdom·Knowledge·Understanding): present at top of system prompt
- **Anti-drift block** (7 rules, verbatim from BUILD-AGENT-SYSTEM-PROMPT-v2.md): present in system prompt lines 264-301
- **Knowledge tier tagging** (T1–T4): enforced in system prompt reasoning section
- **CRG Internal Focus Doctrine**: OBADIAH refuses multi-tenant output per system prompt Refusal Cases
- **Model**: `claude-sonnet-4-6` — no Haiku, no GPT-lite
- **GitHub as source of truth**: system prompt lives in git, deployed via branch + PR, never edited inline

---

## Gate D evidence (Builder 1)

| Evidence item | Status |
|---|---|
| agent_id saved to Doppler | `agent_011CaiQ2gQUKhMSnp4SXT4ZR` — CONFIRMED |
| Test-fire transcript with valid JSON | PASS (2026-05-04 23:29) — see `test-fire-output.json` |
| All required schema fields present | CONFIRMED |
| Full system prompt visible in PR | Committed in this PR — `agents/obadiah/system-prompt.md` (13,577 chars) |
| Anti-drift block | Lines 264-301 of system-prompt.md, sourced from BUILD-AGENT-SYSTEM-PROMPT-v2.md |
| WKU framing block | Lines 12-21 of system-prompt.md |
