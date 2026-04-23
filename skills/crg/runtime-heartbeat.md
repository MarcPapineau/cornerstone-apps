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
Doctrine without enforcement is theater. This skill is the enforcement layer for all scheduled CRG routines. It closes the gap where a scheduled function silently stops running and no one notices for days.

Archetype: The watchman on the wall (Ezekiel 33:6) — the watchman who does not cry out is accountable for the breach.

## Trigger
- **Auto:** Cron `*/15 * * * *` — every 15 minutes
- **Manual:** `GET /.netlify/functions/runtime-heartbeat`

## Registry
Reads `cornerstoneregroup-site/config/heartbeat-registry.json` on every invocation. Adding a new routine to that JSON file is all that is required to bring it under watch — no code changes needed.

### Check types
| type | logic |
|------|-------|
| `file_exists` | Artifact file must exist AND have mtime < max_age_hours |
| `directory_exists` | Artifact directory must exist AND have mtime < max_age_hours |
| `json_key_not_null` | JSON file must have key != null; if `week_ending` present, checks age |
| `directory_last_modified` | Equivalent to file_exists with directory resolution |
| `stub` | Always passes; marks routine as PENDING; no alert sent |

### Pattern tokens
Artifact paths support `{YYYY-MM-DD}`, `{YYYY}`, `{MM}`, `{DD}`, `{YYYY-WW}` (ISO week).

## Seeded routines (2026-04-23)

| Routine | Check | Max age |
|---------|-------|---------|
| `crg:nightly-research` | `directory_exists` on `/research/{YYYY-MM-DD}/` | 26h |
| `ezra:morning-brief` | `file_exists` on `/morning-briefs/{YYYY-MM-DD}.md` | 24h |
| `samuel:weekly-digest` | `json_key_not_null` on `samuel-digest.json.latest` | 8 days |
| `levite:secrets-rotation` | `stub` — PENDING until Doppler wired | — |
| `crg:drift-detector` | `file_exists` on `drift-digests/{YYYY-WW}.md` | 168h (1 week) |
| `crg:samuel-digest-writer` | `json_key_not_null` on `samuel-digest.json.latest` | 8 days |

## Outputs
- **Resend alert email** to `marc@cornerstoneregroup.ca` on any FAIL — subject: `[HEARTBEAT FAIL] <routine-id>`
- **routines.json** updated with `heartbeat_status`, `heartbeat_detail`, `last_heartbeat_check`
- **Function response** JSON: `{ ok, checked, failed, results[], timestamp }`

## Failure handling
- Missing RESEND_KEY: suppresses email, logs warning, continues checks, returns 200
- Missing registry: returns 500 with descriptive error
- Per-routine check error: marks that routine FAIL, sends alert, continues other checks

## Files
- Function: `cornerstoneregroup-site/netlify/functions/runtime-heartbeat.js`
- Registry: `cornerstoneregroup-site/config/heartbeat-registry.json`
- Schedule: `netlify.toml` `[functions."runtime-heartbeat"]` `schedule = "*/15 * * * *"`

## WKU Frame
- **Wisdom:** A system unwatched will drift. Build the watcher first.
- **Knowledge:** Every scheduled routine has an artifact. Artifact staleness is the ground truth.
- **Understanding:** Alert on the first miss, not the third. Recovery cost grows with silence.

## Ratification
Skill ratified 2026-04-23. Part of the self-learning triumvirate (runtime-heartbeat + samuel-digest-writer + drift-detector). Enforces Anti-Drift Doctrine Rule 4 (drift telemetry) and Rule 7 (doctrine without enforcer is a build error).
