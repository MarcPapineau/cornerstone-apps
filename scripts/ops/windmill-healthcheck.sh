#!/usr/bin/env bash
# windmill-healthcheck.sh — periodic health probe for the local Windmill stack.
#
# Runs under launchd (see ~/Library/LaunchAgents/com.crg.windmill-healthcheck.plist).
# Inspects an explicit allowlist of Docker containers; if any are missing or
# unhealthy, attempts a bounded repair (docker compose up -d) and (cooldown-
# permitting) sends a Resend alert. Logs to ~/Library/Logs/windmill-healthcheck.log.
#
# Bugs fixed vs. PR #26 first-run:
#   1. Filter overmatch on stale containers — replaced substring filter
#      (docker ps --filter name=windmill) with explicit WATCH_CONTAINERS
#      allowlist. The orphan `windmill` (no suffix) Exited container left
#      over from older docker-compose deployment is now ignored.
#   2. Cooldown lockfile was never written — the cooldown branch claimed to
#      write /tmp/windmill-healthcheck.cooldown but no `touch` or write ever
#      ran. Now actually written post-repair.
#   3. Alert path silent under launchd — RESEND_API_KEY does not propagate
#      through launchd's minimal env. Sourcing now reads the file at
#      ~/.crg-secrets/resend-master-key (one-time install step). If neither
#      env var nor file exists, repair still proceeds; only alert is skipped.
#
# Exit codes:
#   0 — all containers healthy OR repair attempted (success or fail logged)
#   2 — required tool missing (docker, curl)
#
# This script is `set -euo pipefail` everywhere except around optional steps
# (alert send, cooldown read) which are explicitly guarded.

set -euo pipefail

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

# Explicit allowlist — these are the three containers the docker-compose stack
# at ~/windmill/docker-compose.yml manages. Anything else (orphans from older
# deployments, ad-hoc test containers) is intentionally ignored.
WATCH_CONTAINERS=("windmill-postgres-1" "windmill-worker" "windmill-windmill-1")

# Where docker-compose lives. Repair runs `docker compose -f $COMPOSE_FILE up -d`.
COMPOSE_FILE="${WINDMILL_COMPOSE_FILE:-$HOME/windmill/docker-compose.yml}"

# Cooldown lockfile. After a repair, suppress alerts for COOLDOWN_SECS seconds
# to avoid alert-flood when a container flaps. Repair logic itself is NOT
# suppressed — only alert dispatch.
COOLDOWN_FILE="${WINDMILL_COOLDOWN_FILE:-/tmp/windmill-healthcheck.cooldown}"
COOLDOWN_SECS="${WINDMILL_COOLDOWN_SECS:-900}"  # 15 min

# Resend alert target. Both vars optional; missing keys downgrade to log-only.
RESEND_KEY_FILE="${RESEND_KEY_FILE:-$HOME/.crg-secrets/resend-master-key}"
ALERT_FROM="${WINDMILL_ALERT_FROM:-alerts@cornerstoneregroup.ca}"
ALERT_TO="${WINDMILL_ALERT_TO:-marc@cornerstoneregroup.ca}"

# Log file (created if missing). launchd's StandardOutPath/StandardErrorPath
# in the plist also captures stdout/stderr, but we always write structured
# log lines here too for grep-ability.
LOG_FILE="${WINDMILL_LOG_FILE:-$HOME/Library/Logs/windmill-healthcheck.log}"

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

mkdir -p "$(dirname "$LOG_FILE")"

log() {
  # ISO-8601 UTC timestamp prefix; tee to stdout so launchd captures it too.
  printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" | tee -a "$LOG_FILE"
}

# ---------------------------------------------------------------------------
# Tool checks
# ---------------------------------------------------------------------------

require_tool() {
  command -v "$1" >/dev/null 2>&1 || {
    log "FATAL: required tool not found: $1"
    exit 2
  }
}

require_tool docker
require_tool curl

# ---------------------------------------------------------------------------
# Container inspection
# ---------------------------------------------------------------------------

# inspect_status — returns one of: missing | running | running-unhealthy | <other-state>
# Stdout is the literal string. Never prints docker errors to the caller;
# missing containers get explicit "missing" sentinel.
#
# A container is "healthy" iff:
#   - state.status == "running" AND
#   - (no Health subobject) OR (Health.Status in {"healthy", ""})
#
# Anything else (exited, restarting, dead, paused, created, missing, or
# running-but-Health.Status==unhealthy) is unhealthy.
inspect_status() {
  local name="$1"
  local status health

  if ! status=$(docker inspect --format '{{.State.Status}}' "$name" 2>/dev/null); then
    printf 'missing'
    return 0
  fi

  if [ "$status" != "running" ]; then
    printf '%s' "$status"
    return 0
  fi

  # State.Health may not exist; --format with a missing field prints "<no value>"
  health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$name" 2>/dev/null || true)
  case "$health" in
    ""|healthy)
      printf 'running'
      ;;
    *)
      printf 'running-unhealthy'
      ;;
  esac
}

is_healthy_status() {
  [ "$1" = "running" ]
}

# ---------------------------------------------------------------------------
# Cooldown
# ---------------------------------------------------------------------------

# in_cooldown — exit 0 if cooldown lockfile exists and mtime is within
# COOLDOWN_SECS of now. Cooldown only suppresses alert send; repair logic
# always proceeds.
in_cooldown() {
  [ -f "$COOLDOWN_FILE" ] || return 1

  local mtime now age
  # macOS-friendly stat; -f%m on BSD/macOS, -c%Y on GNU. Fall back to GNU
  # so this also runs in Linux test envs.
  mtime=$(stat -f%m "$COOLDOWN_FILE" 2>/dev/null || stat -c%Y "$COOLDOWN_FILE" 2>/dev/null || echo 0)
  now=$(date -u +%s)
  age=$(( now - mtime ))

  [ "$age" -lt "$COOLDOWN_SECS" ]
}

write_cooldown() {
  # Always write a fresh ISO timestamp + force mtime update.
  date -u +%Y-%m-%dT%H:%M:%SZ > "$COOLDOWN_FILE"
}

# ---------------------------------------------------------------------------
# Alerts (Resend)
# ---------------------------------------------------------------------------

resolve_resend_key() {
  # Prefer env (useful in tests + interactive runs); fall back to file
  # (launchd-friendly path; plist runs in minimal env without shell rc).
  if [ -n "${RESEND_API_KEY:-}" ]; then
    printf '%s' "$RESEND_API_KEY"
    return 0
  fi
  if [ -f "$RESEND_KEY_FILE" ]; then
    cat "$RESEND_KEY_FILE"
    return 0
  fi
  return 1
}

send_alert() {
  local subject="$1"
  local body="$2"
  local key

  if ! key=$(resolve_resend_key); then
    log "WARN: no RESEND_API_KEY env and no $RESEND_KEY_FILE file — alert skipped, repair still ran"
    return 0
  fi

  # Best-effort send; do NOT fail the script on transient Resend issues.
  # `set -e` is on but we explicitly capture and inspect the curl exit code.
  local http_code
  http_code=$(curl -sS -o /dev/null -w '%{http_code}' \
    -X POST https://api.resend.com/emails \
    -H "Authorization: Bearer ${key}" \
    -H "Content-Type: application/json" \
    -d "$(printf '{"from":"%s","to":"%s","subject":"%s","text":"%s"}' \
      "$ALERT_FROM" "$ALERT_TO" "$subject" "$body")" \
    || echo "curl-fail")

  case "$http_code" in
    2*)
      log "alert sent: subject=$subject http=$http_code"
      ;;
    *)
      log "WARN: alert send returned http=$http_code — continuing"
      ;;
  esac
}

# ---------------------------------------------------------------------------
# Repair
# ---------------------------------------------------------------------------

repair_stack() {
  log "REPAIR: docker compose -f $COMPOSE_FILE up -d"
  if [ ! -f "$COMPOSE_FILE" ]; then
    log "REPAIR FAIL: compose file missing at $COMPOSE_FILE"
    return 1
  fi
  if docker compose -f "$COMPOSE_FILE" up -d >>"$LOG_FILE" 2>&1; then
    log "REPAIR OK"
    return 0
  fi
  log "REPAIR FAIL: docker compose returned non-zero"
  return 1
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

main() {
  local unhealthy_names=()
  local unhealthy_details=()
  local name status

  for name in "${WATCH_CONTAINERS[@]}"; do
    status=$(inspect_status "$name")
    if is_healthy_status "$status"; then
      log "OK: $name status=$status"
    else
      log "UNHEALTHY: $name status=$status"
      unhealthy_names+=("$name")
      unhealthy_details+=("$name=$status")
    fi
  done

  if [ "${#unhealthy_names[@]}" -eq 0 ]; then
    log "VERDICT: HEALTHY"
    exit 0
  fi

  log "VERDICT: UNHEALTHY (${#unhealthy_names[@]}/${#WATCH_CONTAINERS[@]} bad: ${unhealthy_details[*]})"

  # Decide alert disposition BEFORE we write the new cooldown file. If a
  # cooldown lockfile is already present and within window, the alert is
  # suppressed (still log it) — this is the noise-floor for flapping
  # containers. Repair runs regardless.
  local alert_decision="send"
  if in_cooldown; then
    alert_decision="suppress"
  fi

  # Repair always runs.
  repair_stack || true

  # Always (re-)write cooldown after a repair attempt, success or failure.
  # Both outcomes warrant the same noise-floor — we don't want a failed-
  # repair loop to spam alerts every cycle either.
  write_cooldown

  if [ "$alert_decision" = "send" ]; then
    send_alert \
      "[CRG] Windmill healthcheck UNHEALTHY — repair attempted" \
      "Unhealthy: ${unhealthy_details[*]}. Repair ran. See $LOG_FILE."
  else
    log "COOLDOWN: alert suppressed (cooldown file within ${COOLDOWN_SECS}s window)"
  fi

  # Exit 0 even on unhealthy — launchd should keep retrying us on schedule,
  # not treat unhealthy as a process failure. The log + alert carry the signal.
  exit 0
}

# Allow tests/sourcing without running main.
if [ "${WINDMILL_HEALTHCHECK_NO_RUN:-0}" != "1" ]; then
  main "$@"
fi
