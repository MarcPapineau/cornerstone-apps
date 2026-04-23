---
name: crg:drift-detector
description: Rule 4 enforcer, Langfuse-powered. Runs every Sunday 08:00 ET. Detects 3 drift classes in the past 7 days of Langfuse traces. Writes drift-digests/YYYY-WW.md + Resend alert + updates routines.json.
trigger: Sunday 08:00 ET (0 8 * * 0 UTC), or GET /.netlify/functions/drift-detector
estimates:
  runtime: ~10–15 seconds
  cost: negligible — no LLM calls
---

# Skill: crg:drift-detector

## Purpose
Doctrine without detectors is theater. This skill is the Rule 4 / Rule 7 enforcer — it reads actual execution traces (not just declared intent) and flags where agents talked about doctrine but never enacted it.

Archetype: Samuel the prophet (1 Samuel 15:22) — "to obey is better than sacrifice."

## Trigger
- **Auto:** Sunday 08:00 UTC (`0 8 * * 0`) — weekly report before Marc's Sunday review
- **Manual:** `GET /.netlify/functions/drift-detector`
- **Manual (no email):** `GET /.netlify/functions/drift-detector?send=0`

## Drift Classes

### Class 1: Doctrine-Mention Without Execution
Agent output mentions a doctrine keyword (WKU, Rule 4, skill name, etc.) but the trace has zero tool_calls. The agent talked about doctrine — it did not enact it.

**Keywords monitored:** WKU, Rule 1-7, canonical-spec, KRITE, crg:* skills, anti-drift, subagent routing terms.

### Class 2: Tool-Call Failure Clusters
The same tool_name fails > 3 times in the week across all traces. Agent stuck in retry/failure loop. Severity HIGH if ≥ 7 failures.

### Class 3: Prompt Regression
Agent's Langfuse trace score dropped > 15 points vs the baseline in scorecards.json. Signals a prompt change broke something. Severity HIGH if drop > 30 points.

## Outputs
- **Digest:** `cornerstoneregroup-site/drift-digests/YYYY-WW.md`
- **Email:** Resend to `marc@cornerstoneregroup.ca`, subject `[Drift Detector] Week YYYY-WW — STATUS`
- **routines.json:** `last_fired` + `status: "active"` updated

## Zero-trace behavior
Zero Langfuse traces → all 3 classes return 0 findings, status CLEAN. Digest still writes. Valid initial state when Langfuse just wired.

## Files
- Function: `cornerstoneregroup-site/netlify/functions/drift-detector.js`
- Digest dir: `cornerstoneregroup-site/drift-digests/`
- Schedule: `netlify.toml` `[functions."drift-detector"]` `schedule = "0 8 * * 0"`

## WKU Frame
- Wisdom: Drift is invisible until it's catastrophic. Detect it weekly while it's cheap to fix.
- Knowledge: Langfuse traces are the authoritative record of what agents actually did, not what they said they'd do.
- Understanding: A Class 1 finding is more dangerous than a Class 3 — it means the agent believes it's following doctrine while doing nothing.

## Ratification
Ratified 2026-04-23. Part of the self-learning triumvirate. Enforces Anti-Drift Doctrine Rule 4 (drift telemetry via Langfuse) and Rule 7 (doctrine without enforcer is a build error).
