"""
NEHEMIAH — End-of-Day Status Report (Windmill Python)

Migrated from n8n workflow TU7xW7CyPI6xIjWZ on 2026-05-01 (Phase 4 of CRG
Infrastructure Rescue v2).

Original semantics (faithful):
- Fires Mon-Fri 21:00 UTC (5PM EDT)
- Pulls latest 200 n8n executions via n8n REST API
- Builds an HTML accountability report card (Apollos / EZRA / Solomon / Daniel / Drip)
- Sends to marc@cornerstoneregroup.ca via Resend

Anti-drift hardening:
- EVIDENCE-OR-INCOMPLETE: returns Resend HTTP status + message id; never claims sent
  without those.
- NO HARDCODED SECRETS: N8N_API_KEY + RESEND_KEY pulled from Windmill workspace vars
  (which mirror Doppler).
- CONTRADICTION RULE: n8n executions URL = host.docker.internal:5678 (works inside
  the docker network). If migrated to managed Windmill, change this URL.

Idempotency (PATCH 2026-05-02 — Item 17-followup):
- Mirrors the daily-lock pattern in cornerstoneregroup-site/netlify/functions/
  nehemiah-conductor.js (which uses a /tmp/nehemiah-standup-{YYYY-MM-DD}.lock file
  to make the 8AM standup once-per-day across 15-min ticks).
- Windmill workers are ephemeral, so /tmp is unreliable. We use Windmill variables
  (wmill.set_variable / get_variable) as a persistent date-keyed lock. The
  variable maps to the same Postgres `variable` table that already holds our
  secrets — durable across worker restarts and visible in the Windmill UI.
- Lock path: u/admin/nehemiah_eod_lock_{YYYY-MM-DD-Toronto}
- Lock semantics: written AFTER a successful Resend send. Tradeoff: if Resend
  silently drops a 200 we don't retry, BUT the much worse failure mode
  (lock-before-send black-holes Marc's report on transient errors) cannot
  happen. The lock value records the Resend message id so a human auditor has
  one source of truth for delivery.
- Bug it fixes: 2026-05-01 double-send. Builder test-fire at 16:34Z + cron at
  21:00Z both delivered the same report because no idempotency check existed.

Schedule (set separately via /api/w/admins/schedules/create):
  path: u/admin/nehemiah_eod_v1
  cron: "0 21 * * 1-5"
  timezone: UTC
"""

import datetime as _dt
import json as _json
from typing import Any
from urllib import request as _ur, error as _ue

import wmill  # type: ignore[import-untyped]


AGENTS: list[dict[str, Any]] = [
    {
        "name": "Apollos", "emoji": "📜", "title": "Content Strategist",
        "mission": "Publish daily articles with visuals, weekly content plan, bi-weekly magazine",
        "workflows": {
            "oyjzWf2O3TkdmwvL": {"label": "Daily Article (Mon–Fri)", "unit": "article", "critical": True},
            "0YfxVusqCah88ZRO": {"label": "Weekly Content Plan (Sun)", "unit": "plan", "critical": False},
            "7UTJJ8waibHvZBqq": {"label": "Magazine Generator (Sat)", "unit": "magazine", "critical": False},
            "yKQEJP2EHQzpsXQX": {"label": "Weekly Magazine (Sun)", "unit": "magazine", "critical": False},
        },
    },
    {
        "name": "EZRA", "emoji": "🌅", "title": "Morning Briefing Officer",
        "mission": "Deliver daily morning briefing with calendar, weather, and priorities",
        "workflows": {
            "PE303EVaGsvUU4LZ": {"label": "Morning Briefing", "unit": "briefing", "critical": True},
        },
    },
    {
        "name": "Solomon", "emoji": "⚖️", "title": "Lead Qualifier",
        "mission": "Qualify and route every inbound lead in real time. Zero leads should slip through unqualified.",
        "workflows": {
            "1XLFdFKRzcWg2CXq": {"label": "Real-Time Lead Qualifier", "unit": "lead qualified", "critical": True},
        },
    },
    {
        "name": "Daniel", "emoji": "📊", "title": "Researcher & Intelligence Scout",
        "mission": "Deliver research digests every 6h, creator intelligence, and weekly tool scout report",
        "workflows": {
            "DKylcvpbbTK2VoOn": {"label": "Research Digest (every 6h)", "unit": "digest", "critical": True},
            "wQ0OqPRwInfwjWsQ": {"label": "Creator Intelligence", "unit": "report", "critical": False},
            "h6ZqgaLTrvGMJ5k1": {"label": "Tool Scout (Monday)", "unit": "report", "critical": False},
        },
    },
    {
        "name": "Drip System", "emoji": "💧", "title": "Automated Nurture Campaigns",
        "mission": "Keep leads warm via timed email sequences. Every trigger should execute without error.",
        "workflows": {
            "WmskxSH1L2wsvpMc": {"label": "Post-Consult Follow-Up", "unit": "email sent", "critical": False},
            "tBLhRuhfi4RO0pDS": {"label": "Insurance Nurture (10-day)", "unit": "email sent", "critical": False},
            "ve2nY060odN6CN8Z": {"label": "RE Warm Nurture (14-day)", "unit": "email sent", "critical": False},
        },
    },
]

# n8n exposes its REST API on port 5678. Inside docker, the worker reaches it
# via host.docker.internal (macOS) or the container name on a shared network.
N8N_BASE = "http://host.docker.internal:5678"

# Idempotency lock — Windmill variable namespace. See module docstring.
LOCK_PATH_PREFIX = "u/admin/nehemiah_eod_lock_"


def _lock_path_for(today: str) -> str:
    """Return the Windmill variable path for today's EOD lock."""
    return f"{LOCK_PATH_PREFIX}{today}"


def _check_lock(today: str) -> dict[str, Any] | None:
    """Return the existing lock payload if today's EOD has already been sent,
    else None. A None return means the script is free to send.

    The lock is a Windmill variable. wmill.get_variable raises on missing keys,
    which we treat as "no lock present"."""
    try:
        raw = wmill.get_variable(_lock_path_for(today))
    except Exception:
        return None
    if not raw:
        return None
    try:
        return _json.loads(raw)
    except (ValueError, TypeError):
        # Variable exists but isn't JSON — treat as a present lock anyway so we
        # never double-send. Reformat as a stub payload.
        return {"raw": raw, "parse_error": True}


def _set_lock(today: str, payload: dict[str, Any]) -> bool:
    """Write today's EOD lock. Returns True on success, False on failure (logged
    but non-fatal — the send already succeeded; a failed lock just means the
    next fire on the same day MIGHT re-send. Better than no lock at all).

    wmill.set_variable signature: (path, value, is_secret=False, description=None)
    """
    try:
        wmill.set_variable(
            _lock_path_for(today),
            _json.dumps(payload),
        )
        return True
    except Exception:
        return False


def _toronto_today() -> str:
    """Return YYYY-MM-DD for current date in America/Toronto."""
    # Workers don't have ZoneInfo by default; approximate by adjusting for EDT (UTC-4) / EST (UTC-5).
    # In April-October Toronto is EDT (UTC-4). Acceptable for an EOD report fired at 21:00 UTC.
    now_utc = _dt.datetime.now(_dt.timezone.utc)
    # Heuristic: month 3 (after DST start) -> 11 (before DST end) = EDT
    month = now_utc.month
    is_edt = 3 <= month <= 10
    offset = -4 if is_edt else -5
    toronto = now_utc + _dt.timedelta(hours=offset)
    return toronto.strftime("%Y-%m-%d")


def _fetch_executions(api_key: str, limit: int = 200) -> list[dict[str, Any]]:
    url = f"{N8N_BASE}/api/v1/executions?limit={limit}&includeData=false"
    req = _ur.Request(url, headers={"X-N8N-API-KEY": api_key})
    with _ur.urlopen(req, timeout=15) as r:
        body = _json.loads(r.read().decode())
    return body.get("data") or []


def _build_html(today: str, day_label: str, agent_cards_html: str,
                banner_bg: str, banner_border: str, banner_msg: str,
                total_ok: int) -> str:
    return (
        f'<div style="font-family:Arial,sans-serif;max-width:720px;margin:0 auto;color:#1a1a1a">'
        f'<div style="background:linear-gradient(135deg,#0A122A,#24476C);padding:24px;border-radius:10px 10px 0 0">'
        f'<div style="display:flex;align-items:center;justify-content:space-between">'
        f'<div><div style="font-size:11px;color:#A8A9AD;letter-spacing:2px;text-transform:uppercase;margin-bottom:4px">End of Day Report</div>'
        f'<h2 style="margin:0;color:#E6E8E6;font-size:20px">🏗️ Nehemiah — Team Briefing</h2>'
        f'<div style="color:#A8A9AD;font-size:12px;margin-top:4px">{day_label}, {today}</div></div>'
        f'<div style="text-align:center"><div style="font-size:32px;font-weight:900;color:#E6E8E6">{total_ok}</div>'
        f'<div style="font-size:10px;color:#A8A9AD;text-transform:uppercase;letter-spacing:1px">Outputs Today</div></div></div></div>'
        f'<div style="background:{banner_bg};border-left:4px solid {banner_border};border-right:1px solid {banner_border};padding:14px 18px;font-size:13px">'
        f'{banner_msg}</div>'
        f'<div style="border:1px solid #e5e7eb;border-top:none;padding:20px;border-radius:0 0 10px 10px">'
        f'<div style="font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#6b7280;margin-bottom:16px">— Agent Report —</div>'
        f'{agent_cards_html}'
        f'<div style="margin-top:8px;padding-top:16px;border-top:1px solid #e5e7eb;text-align:center">'
        f'<p style="font-size:11px;color:#9ca3af;margin:0">Nehemiah — Watchman on the Wall. For the glory of Jesus Christ.<br>'
        f'<em>"So we rebuilt the wall… for the people worked with all their heart." — Nehemiah 4:6</em></p></div></div></div>'
    )


def main(date_override: str | None = None, dry_run: bool = False, force: bool = False) -> dict[str, Any]:
    """Build + send the Nehemiah EOD report.

    Args:
        date_override: YYYY-MM-DD; defaults to today in America/Toronto.
        dry_run: If True, return the rendered HTML payload without sending.
            dry_run also bypasses the idempotency lock check (test fires must
            still work even if today's real EOD already shipped).
        force: If True, bypass the idempotency lock for a real send. Reserved
            for emergency operator re-fire after a confirmed delivery failure.
            Defaults to False.
    """
    n8n_api_key = wmill.get_variable("u/admin/N8N_API_KEY")
    resend_key = wmill.get_variable("u/admin/RESEND_KEY")

    today = date_override or _toronto_today()
    # Day-of-week label from today
    day_label = _dt.datetime.strptime(today, "%Y-%m-%d").strftime("%A")
    dow = _dt.datetime.strptime(today, "%Y-%m-%d").weekday()  # 0=Mon, 6=Sun
    # Recompute to match JS getDay() convention (0=Sun, 1=Mon, ..., 6=Sat)
    day_of_week_js = (dow + 1) % 7
    is_weekday = 1 <= day_of_week_js <= 5
    is_monday = day_of_week_js == 1

    # ── Idempotency check — fail fast BEFORE n8n fetch / HTML build / Resend ──
    # dry_run skips the check (test fires must always work).
    # force=True is the explicit-override emergency path.
    if not dry_run and not force:
        existing = _check_lock(today)
        if existing is not None:
            return {
                "ok": True,           # not a failure — this is the lock doing its job
                "skipped": True,
                "date": today,
                "reason": "already_sent_today",
                "lock_payload": existing,
            }

    # Fetch executions
    try:
        raw = _fetch_executions(n8n_api_key)
    except (_ue.URLError, _ue.HTTPError, OSError) as e:
        return {
            "ok": False, "date": today, "totals": {"ok": 0, "err": 0, "missed": 0},
            "html_length": 0, "error": f"n8n_fetch_failed: {str(e)[:200]}",
        }

    today_execs = [e for e in raw if (e.get("startedAt") or "").startswith(today)]

    total_ok = total_err = total_missed = 0
    agent_cards: list[str] = []

    for agent in AGENTS:
        wf_ids = list(agent["workflows"].keys())
        agent_execs = [e for e in today_execs if e.get("workflowId") in wf_ids]
        wf_rows: list[str] = []
        agent_ok = agent_err = agent_missed = 0

        for wf_id, wf_meta in agent["workflows"].items():
            runs = [e for e in agent_execs if e.get("workflowId") == wf_id]
            ok = sum(1 for e in runs if e.get("status") == "success")
            err = sum(1 for e in runs if e.get("status") != "success")
            total = len(runs)

            is_tool_scout = wf_id == "h6ZqgaLTrvGMJ5k1"
            is_daily_apollos = wf_id == "oyjzWf2O3TkdmwvL"
            is_weekly_plan = wf_id == "0YfxVusqCah88ZRO"
            is_mag = wf_id in ("7UTJJ8waibHvZBqq", "yKQEJP2EHQzpsXQX")

            expected_to_run = True
            if is_tool_scout and not is_monday:
                expected_to_run = False
            if is_daily_apollos and not is_weekday:
                expected_to_run = False
            if is_weekly_plan and day_of_week_js != 0:
                expected_to_run = False
            if is_mag and day_of_week_js not in (6, 0):
                expected_to_run = False

            if not expected_to_run and total == 0:
                icon, txt, bg = "⏸️", "Not scheduled today", "#f9fafb"
            elif ok > 0 and err == 0:
                icon = "✅"
                txt = f"{ok} {wf_meta['unit']}{'s' if ok > 1 else ''} delivered"
                bg = "#f0fdf4"
                agent_ok += ok
            elif ok > 0 and err > 0:
                icon, txt, bg = "⚠️", f"{ok} delivered, {err} failed", "#fffbeb"
                agent_ok += ok
                agent_err += err
            elif err > 0:
                icon = "❌"
                txt = f"Failed {err} time{'s' if err > 1 else ''} — needs attention"
                bg = "#fef2f2"
                agent_err += err
            elif expected_to_run and total == 0 and wf_meta["critical"]:
                icon, txt, bg = "🚨", "MISSED — expected to run, did not", "#fef2f2"
                agent_missed += 1
            elif expected_to_run and total == 0:
                icon, txt, bg = "⚠️", "Did not run — check if expected", "#fffbeb"
            else:
                icon, txt, bg = "—", "No activity", "#f9fafb"

            wf_rows.append(
                f'<tr style="background:{bg}">'
                f'<td style="padding:7px 10px;font-size:16px">{icon}</td>'
                f'<td style="padding:7px 10px;font-size:12px;color:#374151">{wf_meta["label"]}</td>'
                f'<td style="padding:7px 10px;font-size:12px;color:#6b7280">{txt}</td></tr>'
            )

        total_ok += agent_ok
        total_err += agent_err
        total_missed += agent_missed

        if agent_missed > 0:
            agent_status, color, status_bg = "🚨 MISSED CRITICAL TASK", "#dc2626", "#fef2f2"
        elif agent_err > 0 and agent_ok == 0:
            agent_status, color, status_bg = "❌ All runs failed", "#dc2626", "#fef2f2"
        elif agent_err > 0:
            agent_status = f"⚠️ Partial — {agent_ok} delivered, {agent_err} errors"
            color, status_bg = "#d97706", "#fffbeb"
        elif agent_ok > 0:
            agent_status = f"✅ Delivered {agent_ok} output{'s' if agent_ok > 1 else ''} today"
            color, status_bg = "#16a34a", "#f0fdf4"
        else:
            agent_status, color, status_bg = "⏸️ No scheduled activity today", "#6b7280", "#f9fafb"

        agent_cards.append(
            f'<div style="border:1px solid #e5e7eb;border-radius:10px;margin-bottom:20px;overflow:hidden">'
            f'<div style="background:#0A122A;padding:14px 18px;display:flex;align-items:center;justify-content:space-between">'
            f'<div><span style="font-size:20px">{agent["emoji"]}</span>'
            f'<span style="font-size:15px;font-weight:700;color:#E6E8E6;margin-left:8px">{agent["name"]}</span>'
            f'<span style="font-size:11px;color:#A8A9AD;margin-left:8px;font-weight:400">— {agent["title"]}</span></div>'
            f'<div style="font-size:11px;font-weight:700;padding:4px 10px;border-radius:99px;background:{status_bg};color:{color}">{agent_status}</div></div>'
            f'<div style="padding:10px 18px;background:#f8fafc;border-bottom:1px solid #e5e7eb">'
            f'<span style="font-size:11px;color:#6b7280;font-style:italic">Mission: {agent["mission"]}</span></div>'
            f'<table style="width:100%;border-collapse:collapse"><tbody>{"".join(wf_rows)}</tbody></table></div>'
        )

    # Banner
    if total_missed > 0:
        banner_bg, banner_border = "#fef2f2", "#fca5a5"
        banner_msg = (
            f"🚨 <strong>{total_missed} critical task{'s' if total_missed > 1 else ''} missed today.</strong>"
            f" This is not all clear — action required."
        )
    elif total_err > 0 and total_ok == 0:
        banner_bg, banner_border = "#fef2f2", "#fca5a5"
        banner_msg = "❌ <strong>All runs today failed.</strong> Check n8n immediately."
    elif total_err > 0:
        banner_bg, banner_border = "#fffbeb", "#fde68a"
        banner_msg = (
            f"⚠️ <strong>{total_ok} outputs delivered, {total_err} errors.</strong>"
            f" Review failed workflows."
        )
    elif total_ok == 0 and is_weekday:
        banner_bg, banner_border = "#fef2f2", "#fca5a5"
        banner_msg = (
            "🚨 <strong>Zero outputs recorded on a weekday.</strong>"
            ' This is NOT "all clear" — system may be down.'
        )
    elif total_ok == 0:
        banner_bg, banner_border = "#f9fafb", "#e5e7eb"
        banner_msg = "⏸️ Weekend — no weekday workflows scheduled. System standing by."
    else:
        banner_bg, banner_border = "#f0fdf4", "#86efac"
        banner_msg = (
            f"✅ <strong>All clear. The walls hold.</strong>"
            f" {total_ok} outputs delivered today. Team is operational."
        )

    html = _build_html(today, day_label, "".join(agent_cards), banner_bg, banner_border, banner_msg, total_ok)

    if dry_run:
        return {
            "ok": True, "date": today,
            "totals": {"ok": total_ok, "err": total_err, "missed": total_missed},
            "html_length": len(html),
        }

    # Send via Resend. Cloudflare bot detection blocks Python-urllib UA, so use httpx
    # (which sends User-Agent: python-httpx/* — accepted by api.resend.com).
    import httpx  # type: ignore[import-not-found]
    subject = f"🏗️ Nehemiah EOD Report — {day_label}, {today}"
    body_obj = {
        "from": "Nehemiah <nehemiah@cornerstoneregroup.ca>",
        "to": ["marc@cornerstoneregroup.ca"],
        "reply_to": "marc@cornerstoneregroup.ca",
        "subject": subject,
        "html": html,
    }
    try:
        with httpx.Client(timeout=20.0) as client:
            resp = client.post(
                "https://api.resend.com/emails",
                headers={
                    "Authorization": f"Bearer {resend_key}",
                    "Content-Type": "application/json",
                },
                json=body_obj,
            )
        body = resp.json() if resp.content else {}
        sent_ok = 200 <= resp.status_code < 300

        # Write idempotency lock ONLY after Resend confirms delivery. Lock-after-
        # success means a transient Resend error never black-holes Marc's daily
        # report — a retry on the same day will still go through.
        lock_written = False
        if sent_ok and not force:
            lock_written = _set_lock(today, {
                "sent_at_utc": _dt.datetime.now(_dt.timezone.utc).isoformat(),
                "resend_id": body.get("id"),
                "resend_status": resp.status_code,
                "totals": {"ok": total_ok, "err": total_err, "missed": total_missed},
            })

        return {
            "ok": sent_ok,
            "date": today,
            "totals": {"ok": total_ok, "err": total_err, "missed": total_missed},
            "resend_status": resp.status_code,
            "resend_id": body.get("id"),
            "html_length": len(html),
            "lock_written": lock_written,
            "force_override": force,
            **({"error": f"resend_http_{resp.status_code}: {resp.text[:200]}"} if not sent_ok else {}),
        }
    except Exception as e:
        return {
            "ok": False, "date": today,
            "totals": {"ok": total_ok, "err": total_err, "missed": total_missed},
            "html_length": len(html),
            "error": f"resend_exception: {str(e)[:200]}",
        }
