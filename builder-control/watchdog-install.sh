#!/usr/bin/env bash
#
# watchdog-install.sh — schedule the Layer 3 watchdog.
#
# NOT run automatically. Installing a cron entry is a persistent change to
# Marc's machine, and his crontab is currently empty — he may schedule things
# through n8n or the OpenClaw scheduler instead. This makes it one command
# whenever he decides where it belongs.
#
#   bash builder-control/watchdog-install.sh          install (07:52 daily)
#   bash builder-control/watchdog-install.sh --remove uninstall
#   bash builder-control/watchdog-install.sh --show   print the line only
#
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG="$ROOT/builder-control/watchdog.log"
NODE="$(command -v node)"
TAG="# builder-control-watchdog"

# 07:52, not 08:00 — an off-minute avoids the pile-up every scheduler hits
# on the hour, and Marc reads this with coffee, not at a standup.
LINE="52 7 * * * cd $ROOT && $NODE builder-control/watchdog.cjs >> $LOG 2>&1 $TAG"

case "${1:-}" in
  --show)   echo "$LINE"; exit 0 ;;
  --remove) crontab -l 2>/dev/null | grep -v "$TAG" | crontab -; echo "watchdog schedule removed"; exit 0 ;;
esac

if crontab -l 2>/dev/null | grep -q "$TAG"; then
  echo "Watchdog already scheduled:"
  crontab -l | grep "$TAG"
  exit 0
fi

( crontab -l 2>/dev/null; echo "$LINE" ) | crontab -
echo "Watchdog scheduled — 07:52 daily, appending to:"
echo "  $LOG"
echo
echo "Note: macOS may require Terminal/cron to have Full Disk Access"
echo "for this to run unattended (System Settings > Privacy & Security)."
