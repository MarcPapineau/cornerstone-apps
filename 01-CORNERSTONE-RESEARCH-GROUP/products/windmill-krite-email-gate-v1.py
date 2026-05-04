"""
Windmill Script: u/admin/krite_email_gate_v1

KRITE EMAIL GATE — Every CRG outbound email MUST pass through this.

Marc's mandate (verbatim): "This should have been reviewed and checked.
Is there a way you can monitor my emails and when these emails come in,
KRITE picks it up and gives feedback on the whole thing. Why do I have to do it."

FLOW:
  Agent/script wants to send email →
  Calls this gate instead of Resend directly →
  KRITE reviews the HTML + copy + structure →
  Three outcomes:
    1. PASS → email sends via Resend, logs to audit
    2. AUTO-FIX → KRITE rewrites the HTML for visual hierarchy, then sends
    3. FAIL → blocks the email, Telegram pings Marc with specific issues, stores for review

This is the quality gate. Nothing ships without it.

USAGE (drop-in replacement for Resend calls):
  from windmill import run_script
  run_script('u/admin/krite_email_gate_v1', args={
    "to": ["someone@example.com"],
    "subject": "...",
    "html_body": "<p>...",
    "source_agent": "daniel_research_final",
    "email_category": "research_digest" | "drip" | "transactional" | "marketing" | "internal"
  })
"""

# Centralised secret loader (was hardcoded; security fix 2026-05-04). Reads from
# Windmill workspace variables (u/admin/<NAME>) at runtime; falls back to env
# var of the same name for local dry-run.
import os as _crg_os
try:
    import wmill as _crg_wmill  # type: ignore[import-untyped]
    def _get_secret(name: str) -> str:
        try:
            v = _crg_wmill.get_variable(f"u/admin/{name}")
            if v:
                return v
        except Exception:
            pass
        return _crg_os.environ.get(name, "")
except ImportError:
    def _get_secret(name: str) -> str:
        return _crg_os.environ.get(name, "")


import requests
import json
import hashlib
import os
from datetime import datetime

RESEND_KEY = _get_secret("RESEND_API_KEY")
OPENAI_KEY = _get_secret("OPENAI_API_KEY")
TELEGRAM_BOT = _get_secret("TELEGRAM_BOT_TOKEN")
MARC_TELEGRAM_CHAT = "8617287533"

FROM_DEFAULT = "Cornerstone Research Group <noreply@cornerstoneregroup.ca>"
AUDIT_LOG_BASE = "/Users/marcpapineau/.openclaw/workspace/01-CORNERSTONE-RESEARCH-GROUP/email-audit-log"

KRITE_SYSTEM_PROMPT = """You are KRITE, Chief Standards Officer at Cornerstone Research Group. You are the email quality gatekeeper. Nothing ships under the CRG name without your stamp.

YOUR JOB: Review outbound emails BEFORE they send. Return a structured JSON verdict.

REVIEW CRITERIA (score each 1-10):
1. VISUAL HIERARCHY — headers, section breaks, bolded key phrases, mobile-readable spacing. Rule of thumb: if a reader can't scan-read in 10 seconds, it fails.
2. STRUCTURE — intro hook / body with sections / clear CTA. Not one wall of paragraphs.
3. BRAND VOICE — specific, research-backed, no marketing fluff, confident but not salesy.
4. COMPLIANCE — CASL-required footer (physical address, sender name, opt-out), sender identity clear.
5. ACTION CLARITY — what does the reader DO after reading? One clear CTA.

VERDICT RULES:
- Any score below 5 on any criterion → FAIL
- All scores 8+ → PASS
- Mixed (5-7) → AUTO_FIX: you must rewrite the HTML to fix structural issues while preserving the original content/meaning

OUTPUT JSON ONLY — no prose:
{
  "verdict": "PASS" | "AUTO_FIX" | "FAIL",
  "scores": {"hierarchy": n, "structure": n, "voice": n, "compliance": n, "action": n},
  "issues": ["short bullet of each problem"],
  "rewritten_html": "full rewritten HTML email if verdict is AUTO_FIX, otherwise empty string",
  "marc_feedback": "if FAIL, 2-sentence feedback for Marc explaining why it's blocked"
}

AUTO_FIX REWRITE RULES:
- Preserve the original content and intent EXACTLY — don't add new claims or lose data
- Rebuild HTML with: clear H1/H2 structure, bullet lists, bolded key phrases, 16px minimum font, 24px line-height, max-width 600px, dark/light theme-appropriate
- Add any missing compliance footer
- Keep it scan-readable in 10 seconds
- Dark theme preferred (matches CRG brand): bg #0a0a0b, text #f0ebe1, accent #c4922a, H1 36px Cormorant/Georgia, body 16px Inter/Helvetica

Return ONLY valid JSON. No markdown fences. No preamble."""


def main(
    to: list,
    subject: str,
    html_body: str,
    source_agent: str = "unknown",
    email_category: str = "internal",
    from_email: str = "",
    reply_to: str = "marc@cornerstoneregroup.ca",
    cc: list = None,
    skip_gate: bool = False,  # emergency bypass — logged loudly
    notify_marc_on_fail: bool = True
):
    """Gate + send. Returns verdict + resend_status."""

    from_email = from_email or FROM_DEFAULT
    cc = cc or []
    content_hash = hashlib.sha256((subject + html_body).encode()).hexdigest()[:16]
    started_at = datetime.utcnow().isoformat() + "Z"

    if skip_gate:
        # Bypass — still log loudly
        log_audit({
            "verdict": "BYPASSED",
            "timestamp": started_at,
            "source_agent": source_agent,
            "subject": subject,
            "content_hash": content_hash
        })
        result = send_via_resend(from_email, to, cc, reply_to, subject, html_body)
        notify_bypass(source_agent, subject)
        return {"verdict": "BYPASSED", "sent": result["ok"], "resend_id": result.get("id")}

    # ── KRITE REVIEW ───────────────────────────────────────────────────────
    verdict = krite_review(subject, html_body, source_agent, email_category)

    final_html = html_body
    if verdict.get("verdict") == "AUTO_FIX" and verdict.get("rewritten_html"):
        final_html = verdict["rewritten_html"]

    # ── ACTION BY VERDICT ──────────────────────────────────────────────────
    if verdict.get("verdict") == "FAIL":
        # BLOCK: do not send. Notify Marc.
        log_audit({
            "verdict": "FAIL",
            "timestamp": started_at,
            "source_agent": source_agent,
            "category": email_category,
            "to": to,
            "subject": subject,
            "content_hash": content_hash,
            "issues": verdict.get("issues", []),
            "scores": verdict.get("scores", {}),
            "original_html": html_body
        })
        if notify_marc_on_fail:
            notify_marc_blocked(source_agent, subject, verdict)
        return {
            "verdict": "FAIL",
            "sent": False,
            "reason": "KRITE blocked send — formatting/structure/compliance issue",
            "issues": verdict.get("issues", []),
            "marc_feedback": verdict.get("marc_feedback", ""),
            "stored_for_review": True
        }

    # PASS or AUTO_FIX → send
    result = send_via_resend(from_email, to, cc, reply_to, subject, final_html)
    log_audit({
        "verdict": verdict.get("verdict"),
        "timestamp": started_at,
        "source_agent": source_agent,
        "category": email_category,
        "to": to,
        "subject": subject,
        "content_hash": content_hash,
        "scores": verdict.get("scores", {}),
        "issues": verdict.get("issues", []),
        "auto_fixed": verdict.get("verdict") == "AUTO_FIX",
        "sent_success": result["ok"],
        "resend_id": result.get("id", "")
    })

    return {
        "verdict": verdict.get("verdict"),
        "sent": result["ok"],
        "resend_id": result.get("id"),
        "auto_fixed": verdict.get("verdict") == "AUTO_FIX",
        "scores": verdict.get("scores"),
        "issues_found": verdict.get("issues", [])
    }


# ─── KRITE REVIEW ───────────────────────────────────────────────────────────

def krite_review(subject: str, html_body: str, source_agent: str, category: str) -> dict:
    """Call GPT-4o with KRITE system prompt. Returns verdict JSON."""
    user_prompt = f"""Review this outbound CRG email.

Source agent: {source_agent}
Category: {category}

SUBJECT: {subject}

HTML BODY:
{html_body[:6000]}

Return JSON verdict per the rules. If AUTO_FIX, provide complete rewritten_html."""

    try:
        resp = requests.post(
            "https://api.openai.com/v1/chat/completions",
            headers={"Authorization": f"Bearer {OPENAI_KEY}", "Content-Type": "application/json"},
            json={
                "model": "gpt-4o",
                "temperature": 0.2,
                "response_format": {"type": "json_object"},
                "max_tokens": 4000,
                "messages": [
                    {"role": "system", "content": KRITE_SYSTEM_PROMPT},
                    {"role": "user", "content": user_prompt}
                ]
            },
            timeout=60
        )
        raw = resp.json()["choices"][0]["message"]["content"]
        return json.loads(raw)
    except Exception as e:
        # If KRITE fails to respond, err on side of caution — FAIL
        return {
            "verdict": "FAIL",
            "issues": [f"KRITE review error: {str(e)[:200]}"],
            "marc_feedback": "KRITE couldn't review this email. Review manually or retry.",
            "scores": {},
            "rewritten_html": ""
        }


# ─── RESEND SEND ────────────────────────────────────────────────────────────

def send_via_resend(from_email: str, to: list, cc: list, reply_to: str, subject: str, html: str) -> dict:
    try:
        payload = {
            "from": from_email,
            "to": to if isinstance(to, list) else [to],
            "subject": subject,
            "html": html
        }
        if cc:
            payload["cc"] = cc if isinstance(cc, list) else [cc]
        if reply_to:
            payload["reply_to"] = [reply_to] if isinstance(reply_to, str) else reply_to

        resp = requests.post(
            "https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {RESEND_KEY}", "Content-Type": "application/json"},
            json=payload,
            timeout=15
        )
        if resp.status_code in [200, 201]:
            return {"ok": True, "id": resp.json().get("id", "")}
        return {"ok": False, "error": f"HTTP {resp.status_code}: {resp.text[:200]}"}
    except Exception as e:
        return {"ok": False, "error": str(e)[:200]}


# ─── AUDIT LOG + NOTIFICATIONS ──────────────────────────────────────────────

def log_audit(entry: dict):
    """Write audit log entry. One file per email."""
    try:
        date_dir = os.path.join(AUDIT_LOG_BASE, datetime.utcnow().strftime("%Y-%m-%d"))
        os.makedirs(date_dir, exist_ok=True)
        log_id = entry.get("content_hash", hashlib.sha256(str(entry).encode()).hexdigest()[:12])
        path = os.path.join(date_dir, f"{entry.get('verdict', 'UNKNOWN')}_{log_id}.json")
        with open(path, "w") as f:
            json.dump(entry, f, indent=2)
    except Exception:
        # Fallback to /tmp
        try:
            with open(f"/tmp/email-audit-{entry.get('content_hash','unk')}.json", "w") as f:
                json.dump(entry, f, indent=2)
        except Exception:
            pass


def notify_marc_blocked(source_agent: str, subject: str, verdict: dict):
    issues = "\n".join([f"• {i}" for i in verdict.get("issues", [])[:5]])
    msg = f"""🚫 *EMAIL BLOCKED BY KRITE*

*From agent:* `{source_agent}`
*Subject:* {subject[:80]}

*KRITE's issues:*
{issues}

*Feedback:* {verdict.get('marc_feedback', 'No feedback provided')}

_Stored in audit log for your review. Email was NOT sent._"""
    try:
        requests.post(
            f"https://api.telegram.org/bot{TELEGRAM_BOT}/sendMessage",
            data={"chat_id": MARC_TELEGRAM_CHAT, "parse_mode": "Markdown", "text": msg},
            timeout=8
        )
    except Exception:
        pass


def notify_bypass(source_agent: str, subject: str):
    msg = f"⚠️ *EMAIL GATE BYPASSED*\n\nAgent `{source_agent}` sent email with `skip_gate=True`\nSubject: {subject[:80]}\n\n_This should be rare. Investigate if unexpected._"
    try:
        requests.post(
            f"https://api.telegram.org/bot{TELEGRAM_BOT}/sendMessage",
            data={"chat_id": MARC_TELEGRAM_CHAT, "parse_mode": "Markdown", "text": msg},
            timeout=8
        )
    except Exception:
        pass
