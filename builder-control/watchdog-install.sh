#!/usr/bin/env bash
#
# watchdog-install.sh — schedule the Layer 3 watchdog on macOS via launchd.
#
#   bash builder-control/watchdog-install.sh            install + load (07:52 daily)
#   bash builder-control/watchdog-install.sh --status   is it actually loaded?
#   bash builder-control/watchdog-install.sh --run-now  fire it immediately
#   bash builder-control/watchdog-install.sh --uninstall remove the schedule
#   bash builder-control/watchdog-install.sh --show     print the plist only
#
# WHY LAUNCHD AND NOT CRON
# The first version of this script wrote a crontab line. On modern macOS that is
# the wrong tool twice over: cron is deprecated in favour of launchd, and it
# silently does nothing when the Terminal that owns it lacks Full Disk Access —
# failing exactly the way a watchdog must not fail, quietly. launchd is the
# supported user-level scheduler, survives logout/reboot via RunAtLoad, and its
# state is inspectable with `launchctl print`, so "is it scheduled?" has a real
# answer instead of an assumption.
#
# 07:52, not 08:00 — an off-minute avoids the pile-up every scheduler hits on the
# hour, and Marc reads this with coffee, not at a standup.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABEL="com.cornerstone.builder-control.watchdog"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
OUT_LOG="$ROOT/builder-control/watchdog.log"
ERR_LOG="$ROOT/builder-control/watchdog.err.log"
NODE="$(command -v node || true)"
UID_NUM="$(id -u)"
DOMAIN="gui/$UID_NUM"

if [ -z "$NODE" ]; then
  echo "FAIL: node is not on PATH. launchd runs with a minimal environment and"
  echo "      cannot find it either — refusing to install a schedule that would"
  echo "      fail silently every morning."
  exit 1
fi

read -r -d '' PLIST_BODY <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>$ROOT/builder-control/watchdog.cjs</string>
  </array>
  <key>WorkingDirectory</key><string>$ROOT</string>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>7</integer><key>Minute</key><integer>52</integer></dict>
  <key>StandardOutPath</key><string>$OUT_LOG</string>
  <key>StandardErrorPath</key><string>$ERR_LOG</string>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string></dict>
  <key>RunAtLoad</key><false/>
</dict>
</plist>
PLIST_EOF

case "${1:-}" in
  --show)
    printf '%s\n' "$PLIST_BODY"; exit 0 ;;

  --status)
    echo "label : $LABEL"
    echo "plist : $PLIST"
    [ -f "$PLIST" ] && echo "        (present)" || { echo "        MISSING — not installed"; exit 1; }
    echo
    if launchctl print "$DOMAIN/$LABEL" 2>/dev/null | sed -n '1,40p'; then
      echo
      echo "LOADED — the schedule is live in launchd."
    else
      echo "NOT LOADED — the plist exists on disk but launchd does not have it."
      echo "A plist on disk is not a schedule. Run: bash builder-control/watchdog-install.sh"
      exit 1
    fi
    exit 0 ;;

  --run-now)
    if ! launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
      echo "NOT LOADED — nothing to kick. Install first."; exit 1
    fi
    launchctl kickstart -p "$DOMAIN/$LABEL"
    echo "kickstarted $LABEL — output goes to:"
    echo "  $OUT_LOG"
    exit 0 ;;

  --uninstall)
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null && echo "unloaded from launchd" || echo "was not loaded"
    rm -f "$PLIST" && echo "removed $PLIST"
    echo "Logs kept: $OUT_LOG"
    exit 0 ;;
esac

mkdir -p "$HOME/Library/LaunchAgents"
printf '%s\n' "$PLIST_BODY" > "$PLIST"

# bootout first so re-running this is idempotent rather than an error.
launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
if ! launchctl bootstrap "$DOMAIN" "$PLIST" 2>&1; then
  echo "FAIL: launchctl bootstrap refused the plist. The watchdog is NOT scheduled."
  exit 1
fi

# Never report "installed" from the fact that the previous command exited 0 —
# verify against launchd's own view.
if launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
  echo "Watchdog scheduled and LOADED — 07:52 daily."
  echo "  plist  : $PLIST"
  echo "  stdout : $OUT_LOG"
  echo "  stderr : $ERR_LOG"
  echo
  echo "Verify independently:  launchctl print $DOMAIN/$LABEL"
  echo "Fire it now:           bash builder-control/watchdog-install.sh --run-now"
else
  echo "FAIL: bootstrap reported success but launchd does not show the job."
  exit 1
fi
