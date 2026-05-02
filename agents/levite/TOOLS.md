# Levite (Vault Keeper) — Tool Registry

> Wisdom · Knowledge · Understanding (Proverbs 24:3-4)
> Levite guards the temple infrastructure so every other agent's auth stays alive.

---

## Tool: `sync-research-to-drive`

### Purpose
Push the local Vitalis peptide research store to Google Drive.
Implements Marc's "on the drive AND on this PC" doctrine for the master research doc.

### Script
`agents/levite/sync-research-to-drive.js`

### Call signature (Vault Keeper invocation)

```js
levite.callTool("sync-research-to-drive", {
  dryRun: false,          // set true to preview without uploading
});
```

### Windmill / CLI invocation

```bash
# Production run (via Doppler):
doppler run -- node /path/to/agents/levite/sync-research-to-drive.js

# Dry run (no uploads, no auth needed beyond token refresh):
doppler run -- node /path/to/agents/levite/sync-research-to-drive.js --dry-run

# Without Doppler (testing only — set env vars manually, never commit them):
GOOGLE_DRIVE_CLIENT_ID=xxx \
GOOGLE_DRIVE_CLIENT_SECRET=xxx \
GOOGLE_DRIVE_REFRESH_TOKEN=xxx \
GOOGLE_DRIVE_MARC_EMAIL=marc@cornerstoneregroup.ca \
node sync-research-to-drive.js
```

### Exit codes
| Code | Meaning |
|------|---------|
| 0 | Success — all files synced |
| 1 | OAuth auth failure (bad/expired refresh token) |
| 2 | Drive API error (quota, permissions, network) |
| 3 | Local filesystem read error (source dir missing) |
| 4 | Missing Doppler env vars |

### Doppler secret keys required
| Doppler Key | Description |
|-------------|-------------|
| `GOOGLE_DRIVE_CLIENT_ID` | OAuth2 client ID (Nehemiah Automation project) |
| `GOOGLE_DRIVE_CLIENT_SECRET` | OAuth2 client secret |
| `GOOGLE_DRIVE_REFRESH_TOKEN` | Long-lived refresh token (obtained via one-time OAuth flow) |
| `GOOGLE_DRIVE_MARC_EMAIL` | `marc@cornerstoneregroup.ca` — editor on bootstrapped folder |

### Behaviour
- **Source:** `~/.openclaw/workspace/luke-app/research/peptides/` (68 `.md` files, ~280 KB)
- **Target:** Google Drive → `Vitalis Research / Master / Peptides/`
- **Bootstrap (first run only):** Creates the three-level folder structure + writes `_README.md` warning not to edit in Drive
- **Idempotent:** Filename-match — existing file = PATCH, new file = POST. Never creates duplicates.
- **Push-only:** NEVER deletes Drive files. Local is authoritative.
- **Log:** Every run appends to `agents/levite/sync-log.json` (capped at 500 entries)

### Luke Windmill integration

Add as a Windmill step after the monograph-write step:

```python
# Windmill step: sync_to_drive
import subprocess, os

result = subprocess.run(
    ["doppler", "run", "--", "node",
     "/Users/marcpapineau/.openclaw/workspace/agents/levite/sync-research-to-drive.js"],
    capture_output=True, text=True
)

if result.returncode != 0:
    raise Exception(f"Drive sync failed: {result.stderr}")

return {"sync_status": "ok", "stdout": result.stdout}
```

Gate condition: `sync_to_drive.returncode == 0` before marking the EOD job complete.

### Scheduling recommendation
- **Frequency:** Once per day after the Luke nightly research run (e.g., 11:30 PM ET)
- **Trigger:** After Nehemiah EOD Windmill flow, OR as a standalone Windmill scheduled script
- **Manual re-run:** `doppler run -- node sync-research-to-drive.js` any time

---

## Tool: `rotate-secrets` (planned — spec only)

Levite's core rotation worker per the original spec (`skill_secrets_rotation.md`).
Not yet built — see RUNTIME STATUS below.

---

## RUNTIME STATUS — CRITICAL FLAG

| Component | Status |
|-----------|--------|
| `sync-research-to-drive.js` | **BUILT** — ready to run once OAuth token provisioned |
| Doppler setup | **NOT DONE** — Marc must create Doppler account + import secrets |
| OAuth refresh token | **NOT PROVISIONED** — requires one-time consent flow (see setup steps below) |
| Levite rotation worker | **SPEC ONLY** — `levite-rotation.js` Netlify function not yet built |
| Windmill step integration | **SPEC** — call signature documented above; needs Windmill step added by Bezalel-1 |

Vault Keeper (Levite) is **spec-only** at the runtime level. `sync-research-to-drive.js` is the first actual runtime artifact in this agent directory. The rotation worker, dashboard health widget, and Netlify scheduled function from the original spec remain unbuilt.

---

## One-time setup checklist (Marc must complete)

### Step 1 — Get the Google OAuth refresh token

The Nehemiah Automation project already has Drive API enabled and credentials exist (TOOLS.md).
You need a one-time consent flow to mint the refresh token:

```bash
# On Marc's machine — paste into browser:
https://accounts.google.com/o/oauth2/auth?client_id=<redacted-see-local-env-file>&redirect_uri=http://localhost:5678/rest/oauth2-credential/callback&response_type=code&scope=https://www.googleapis.com/auth/drive&access_type=offline&prompt=consent
```

After you approve, Google returns a `?code=...` in the redirect URL.
Exchange it for tokens:

```bash
curl -X POST https://oauth2.googleapis.com/token \
  -d "code=PASTE_CODE_HERE" \
  -d "client_id=<redacted-see-local-env-file>" \
  -d "client_secret=<redacted-see-local-env-file>" \
  -d "redirect_uri=http://localhost:5678/rest/oauth2-credential/callback" \
  -d "grant_type=authorization_code"
```

Copy the `refresh_token` from the response. Store in Doppler (Step 2).

### Step 2 — Store secrets in Doppler

```bash
doppler secrets set GOOGLE_DRIVE_CLIENT_ID="<redacted-see-local-env-file>" --project levite --config prd
doppler secrets set GOOGLE_DRIVE_CLIENT_SECRET="<redacted-see-local-env-file>" --project levite --config prd
doppler secrets set GOOGLE_DRIVE_REFRESH_TOKEN="PASTE_REFRESH_TOKEN_HERE" --project levite --config prd
doppler secrets set GOOGLE_DRIVE_MARC_EMAIL="marc@cornerstoneregroup.ca" --project levite --config prd
```

### Step 3 — First sync (bootstrap)

```bash
doppler run --project levite --config prd -- \
  node /Users/marcpapineau/.openclaw/workspace/agents/levite/sync-research-to-drive.js
```

On success: Drive URL will appear in the log at `agents/levite/sync-log.json`.
