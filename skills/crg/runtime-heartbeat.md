---
name: crg:runtime-heartbeat
description: The missing primitive. Watches every scheduled CRG routine for artifact staleness. Fires every 15 min via Netlify scheduled function. Sends Resend alert to marc@cornerstoneregroup.ca when a routine is missing or overdue. Updates crg-command-center/data/routines.json with red-status timestamps.
trigger: Cron every 15 min (*/15 * * * *), or manual GET /.netlify/functions/runtime-heartbeat
estimates:
  runtime: ~2 seconds per check cycle
  cost: negligible — no LLM calls
---

# Skill: crg:runtime-heartbeat

## Purpose
Doctrine without enforcement is theater. This skill is the enforcement layer for all scheduled CRG routines.

Archetype: The watchman on the wall (Ezekiel 33:6).

## Trigger
- **Auto:** Cron every 15 minutes (*/15 * * * *)
- **Manual:** GET /.netlify/functions/runtime-heartbeat

## Registry
Reads cornerstoneregroup-site/config/heartbeat-registry.json. Adding a new routine to that file is all that is required to bring it under watch.

## Seeded routines (2026-04-23)
| Routine | Check | Max age |
|---------|-------|---------|
| crg:nightly-research | directory_exists | 26h |
| ezra:morning-brief | file_exists | 24h |
| samuel:weekly-digest | json_key_not_null | 8 days |
| levite:secrets-rotation | stub PENDING | — |
| crg:drift-detector | file_exists | 168h |
| crg:samuel-digest-writer | json_key_not_null | 8 days |

## WKU Frame
- Wisdom: A system unwatched will drift. Build the watcher first.
- Knowledge: Every scheduled routine has an artifact. Staleness is ground truth.
- Understanding: Alert on the first miss, not the third.

## Files
- Function: cornerstoneregroup-site/netlify/functions/runtime-heartbeat.js
- Registry: cornerstoneregroup-site/config/heartbeat-registry.json
- Schedule: netlify.toml [functions."runtime-heartbeat"] schedule = "*/15 * * * *"

## Ratification
Ratified 2026-04-23. Part of the self-learning triumvirate.
