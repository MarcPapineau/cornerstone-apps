---
name: crg:samuel-digest-writer
description: Fixes the broken inner loop. Reads Langfuse traces for the past 7 days, aggregates per-agent metrics, writes crg-command-center/data/samuel-digest.json. Zero-trace is valid — every agent gets flagged INACTIVE rather than silently null.
trigger: Monday 06:30 UTC cron, or POST /.netlify/functions/samuel-digest
estimates:
  runtime: ~5–10 seconds
  cost: negligible — no LLM calls
---

# Skill: crg:samuel-digest-writer

## Purpose
The original Samuel never writes a machine-readable digest. Garvis Samuel tile reads samuel-digest.json.latest which has been null since launch. This skill fixes that.

## Trigger
- Auto: Monday 06:30 UTC (30 min after samuel-background.js)
- Manual: POST /.netlify/functions/samuel-digest
- Verification: GET /.netlify/functions/samuel-digest

## Inputs
- Langfuse Cloud API (7-day window)
- data/scorecards.json agent list

## Output schema (samuel-digest.json)
```json
{
  "latest": {
    "week_ending": "YYYY-MM-DD",
    "generated_at": "ISO",
    "langfuse_traces_found": 0,
    "agents": [{ "agent_id": "...", "status": "INACTIVE — no traces this week", ... }]
  }
}
```

## Zero-trace behavior
Zero traces → all agents marked INACTIVE. latest still non-null. Satisfies heartbeat check. Valid initial state.

## Files
- Function: cornerstoneregroup-site/netlify/functions/samuel-digest.js
- Output: crg-command-center/data/samuel-digest.json

## WKU Frame
- Wisdom: You cannot improve what you cannot measure.
- Knowledge: Langfuse is authoritative. Never hallucinate metrics.
- Understanding: INACTIVE is honest. A null digest is not.

## Ratification
Ratified 2026-04-23. Part of the self-learning triumvirate.
