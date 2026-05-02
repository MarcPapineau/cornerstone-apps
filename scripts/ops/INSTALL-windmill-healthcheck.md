# Install: Windmill Healthcheck (LaunchAgent)

> One-time setup on the Mac Mini that hosts the local Windmill stack. Runs every
> 5 minutes, inspects three watched Docker containers, repairs via
> `docker compose up -d` if unhealthy, and emails Marc on first failure
> (15-minute cooldown afterwards to avoid flapping noise).

## Files

| Path | Purpose |
| --- | --- |
| `scripts/ops/windmill-healthcheck.sh` | The probe + repair + alert script |
| `~/Library/LaunchAgents/com.crg.windmill-healthcheck.plist` | launchd job that runs the script every 5 min |
| `~/.crg-secrets/resend-master-key` | File-fallback path for the Resend API key (launchd minimal env can't see shell exports) |
| `~/Library/Logs/windmill-healthcheck.log` | Append-only structured log |
| `/tmp/windmill-healthcheck.cooldown` | Alert-suppression lockfile written after every repair |

## Prerequisites

- Docker Desktop running, with `~/windmill/docker-compose.yml` present.
- The three watched containers exist (or will be created on first `docker compose up -d`):
  - `windmill-postgres-1`
  - `windmill-worker`
  - `windmill-windmill-1`
- A valid Resend API key (Doppler `RESEND_MASTER_KEY` is the source of truth; we mirror it to disk for launchd).

## Step 1 — Write the Resend key file

The script tries `RESEND_API_KEY` env first, then falls back to a file.
launchd runs jobs in a stripped environment with no shell rc loaded, so the
env var is NOT inherited from your interactive shell. The file is what
actually feeds the alert path under launchd.

```bash
mkdir -p ~/.crg-secrets
chmod 700 ~/.crg-secrets

# Pull the key from Doppler (preferred) or paste from 1Password if Doppler isn't set up.
echo "$RESEND_API_KEY" > ~/.crg-secrets/resend-master-key
chmod 600 ~/.crg-secrets/resend-master-key
```

Verify:

```bash
test -s ~/.crg-secrets/resend-master-key \
  && echo "key file present ($(wc -c < ~/.crg-secrets/resend-master-key) bytes)" \
  || echo "FAIL: key file is empty or missing"
```

The file must be non-empty. An empty file is treated the same as a missing
file (alert silently skipped, repair still runs).

## Step 2 — Install the LaunchAgent plist

```bash
mkdir -p ~/Library/LaunchAgents
cat > ~/Library/LaunchAgents/com.crg.windmill-healthcheck.plist <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.crg.windmill-healthcheck</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-lc</string>
    <string>$HOME/.openclaw/workspace/scripts/ops/windmill-healthcheck.sh</string>
  </array>
  <key>StartInterval</key>
  <integer>300</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/tmp/windmill-healthcheck.stdout.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/windmill-healthcheck.stderr.log</string>
</dict>
</plist>
PLIST
```

Note: we deliberately do NOT set `EnvironmentVariables` with the Resend key in
the plist — the plist is world-readable for the user, which is a weaker
security posture than the `0600` file at `~/.crg-secrets/resend-master-key`.

## Step 3 — Load the LaunchAgent

```bash
launchctl unload ~/Library/LaunchAgents/com.crg.windmill-healthcheck.plist 2>/dev/null || true
launchctl load   ~/Library/LaunchAgents/com.crg.windmill-healthcheck.plist
```

## Step 4 — Verify the first run

The plist sets `RunAtLoad=true`, so it runs immediately on `launchctl load`.

```bash
sleep 6   # give it a moment to do the first probe
tail -n 30 ~/Library/Logs/windmill-healthcheck.log
```

You should see lines like:

```
2026-05-02T19:25:00Z OK: windmill-postgres-1 status=running
2026-05-02T19:25:00Z OK: windmill-worker status=running
2026-05-02T19:25:00Z OK: windmill-windmill-1 status=running
2026-05-02T19:25:00Z VERDICT: HEALTHY
```

If you see `UNHEALTHY` for the orphan `windmill` (no suffix) container, that
is the very bug PR #27 fixes — verify your `windmill-healthcheck.sh` is the
post-fix version (it uses an explicit `WATCH_CONTAINERS` allowlist, NOT a
`docker ps --filter name=windmill` substring filter).

## Step 5 — Force-test the alert path

Stop a watched container and wait one cycle (or run the script manually):

```bash
docker stop windmill-worker
~/.openclaw/workspace/scripts/ops/windmill-healthcheck.sh
```

Expected log lines:

```
... UNHEALTHY: windmill-worker status=exited
... VERDICT: UNHEALTHY (1/3 bad: windmill-worker=exited)
... REPAIR: docker compose -f /Users/marcpapineau/windmill/docker-compose.yml up -d
... REPAIR OK
... alert sent: subject=[CRG] Windmill healthcheck UNHEALTHY — repair attempted http=200
```

Then check the cooldown file is present:

```bash
test -f /tmp/windmill-healthcheck.cooldown \
  && echo "cooldown file present, mtime=$(stat -f%m /tmp/windmill-healthcheck.cooldown)" \
  || echo "FAIL: cooldown file missing — Bug 2 has regressed"
```

Run the script a second time within the cooldown window — the alert should be
suppressed (still logged, but no Resend call):

```bash
~/.openclaw/workspace/scripts/ops/windmill-healthcheck.sh
grep -E "alert (sent|suppressed|skipped)" ~/Library/Logs/windmill-healthcheck.log | tail -3
```

## Uninstall

```bash
launchctl unload ~/Library/LaunchAgents/com.crg.windmill-healthcheck.plist
rm ~/Library/LaunchAgents/com.crg.windmill-healthcheck.plist
# Optional: rm ~/.crg-secrets/resend-master-key (only if you're decommissioning Resend on this host).
```

## Troubleshooting

- **`WARN: no RESEND_API_KEY ... — alert skipped`** in the log → Step 1 didn't run
  or the file is empty. Re-run Step 1 and verify with `wc -c`.
- **Script flags the orphan `windmill` (no suffix) Exited container** → you're on the
  pre-fix script. Replace with the post-fix version (this PR).
- **No cooldown file appears after a repair** → you're on the pre-fix script. Same
  fix.
- **`REPAIR FAIL: compose file missing`** → set `WINDMILL_COMPOSE_FILE` env in the
  plist's `EnvironmentVariables` block, OR move/symlink the compose file to
  `~/windmill/docker-compose.yml`.
