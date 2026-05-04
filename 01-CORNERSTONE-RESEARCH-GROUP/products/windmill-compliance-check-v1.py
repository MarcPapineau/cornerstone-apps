"""
Windmill Script: u/admin/compliance_check_v1

CRG Compliance Engine v1 — Content Checker
Two-pass compliance review: deterministic rule engine + AI nuance analysis.

Signature: main(content, industry, jurisdiction, content_type="general")

Flow:
  1. Load the jurisdiction+industry rule file (YAML) from GitHub-hosted rule library OR embedded fallback
  2. First pass — regex/keyword engine (fast, deterministic)
  3. Second pass — GPT-4o nuance review (framing, omissions, tone)
  4. Aggregate verdict: PASS | FLAG | FAIL with per-rule findings
  5. Write immutable audit log entry (timestamped, hash-keyed)
  6. Return structured JSON

Called by: Netlify function (compliance-check.js) via POST
Returns: { verdict, score, findings, suggested_rewrite, audit_log_id, content_hash }
"""

import requests
import json
import re
import hashlib
import os
import base64
from datetime import datetime, timezone
from typing import List, Dict, Any, Tuple

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


# ─── API KEYS ──────────────────────────────────────────────────────────────
OPENAI_KEY = _get_secret("OPENAI_API_KEY")
PERPLEXITY_KEY = _get_secret("PERPLEXITY_API_KEY")
# ─── CONFIG ─────────────────────────────────────────────────────────────────
AUDIT_LOG_BASE = os.environ.get(
    "CRG_AUDIT_LOG_PATH",
    "/Users/marcpapineau/.openclaw/workspace/01-CORNERSTONE-RESEARCH-GROUP/compliance-engine/audit-log"
)
RULES_BASE = os.environ.get(
    "CRG_RULES_PATH",
    "/Users/marcpapineau/.openclaw/workspace/01-CORNERSTONE-RESEARCH-GROUP/compliance-engine/rules"
)

# ─── RULE FILE ROUTING ──────────────────────────────────────────────────────
RULE_FILE_MAP = {
    ("real-estate", "ontario"):          "real-estate-ontario-reco.yaml",
    ("real-estate", "ontario-canada"):   "real-estate-ontario-reco.yaml",
    ("real-estate", "canada"):           "real-estate-ontario-reco.yaml",
    ("mortgage", "canada"):              "mortgage-canada-fsra-cfpb.yaml",
    ("mortgage", "usa"):                 "mortgage-canada-fsra-cfpb.yaml",
    ("mortgage", "ontario"):             "mortgage-canada-fsra-cfpb.yaml",
    ("mortgage", "ontario-canada"):      "mortgage-canada-fsra-cfpb.yaml",
    ("financial-advisor", "canada"):     "financial-advisor-canada-ciro.yaml",
    ("financial-advisor", "ontario"):    "financial-advisor-canada-ciro.yaml",
    ("financial-advisor", "usa"):        "financial-advisor-usa-finra.yaml",
}

SEVERITY_WEIGHT = {"HIGH": 20, "MED": 10, "LOW": 3}


# gzip+base64 bundle of the four rule files, ALREADY PARSED to JSON.
# Worker only needs base64+gzip+json (all stdlib) — no YAML parser required.
_EMBEDDED_RULES_GZB64 = (
    "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"
    "jjRoVnNICb45//H8Mr7R/KLAEA"
)



# ─── MAIN ──────────────────────────────────────────────────────────────────

def main(
    content: str,
    industry: str,
    jurisdiction: str,
    content_type: str = "general"
) -> Dict[str, Any]:
    """
    Run a compliance check against the supplied content.

    Args:
        content:       The text to review (email, SMS, ad, script, etc.)
        industry:      "real-estate" | "mortgage" | "financial-advisor"
        jurisdiction:  "ontario" | "canada" | "usa"
        content_type:  "email" | "sms" | "ad" | "social" | "script" | "general"

    Returns:
        Structured JSON report with verdict, findings, suggested rewrite, audit log id.
    """

    started_at = datetime.now(timezone.utc).isoformat()
    content_hash = hashlib.sha256(content.encode("utf-8")).hexdigest()[:16]

    # ── 1. Load rule library ─────────────────────────────────────────────
    rule_file = _resolve_rule_file(industry, jurisdiction)
    rules, meta = _load_rules(rule_file)

    if not rules:
        return _error_response(
            content_hash, started_at,
            f"No rules available for industry={industry}, jurisdiction={jurisdiction}"
        )

    # ── 2. First pass — deterministic regex/keyword scan ─────────────────
    rule_findings = _scan_rules(content, rules, content_type)

    # ── 3. Second pass — GPT-4o nuance review ────────────────────────────
    ai_findings = _ai_nuance_check(content, meta, content_type, rule_findings)

    # ── 4. Aggregate verdict ─────────────────────────────────────────────
    verdict, score = _compute_verdict(rule_findings, ai_findings)

    # ── 5. Suggested rewrite ─────────────────────────────────────────────
    suggested_rewrite = None
    if verdict in ("FLAG", "FAIL") and (rule_findings or ai_findings):
        suggested_rewrite = _generate_rewrite(content, rule_findings, ai_findings, meta)

    # ── 6. Write audit log ───────────────────────────────────────────────
    audit_log_id = _write_audit_log(
        content=content,
        content_hash=content_hash,
        started_at=started_at,
        industry=industry,
        jurisdiction=jurisdiction,
        content_type=content_type,
        rule_file=rule_file,
        rules_applied_count=len(rules),
        rule_findings=rule_findings,
        ai_findings=ai_findings,
        verdict=verdict,
        score=score,
        suggested_rewrite=suggested_rewrite,
    )

    return {
        "success": True,
        "verdict": verdict,
        "score": score,
        "content_hash": content_hash,
        "audit_log_id": audit_log_id,
        "rules_applied": len(rules),
        "industry": industry,
        "jurisdiction": jurisdiction,
        "content_type": content_type,
        "regulator": meta.get("regulator", "Unknown"),
        "rule_findings": rule_findings,
        "ai_findings": ai_findings,
        "suggested_rewrite": suggested_rewrite,
        "timestamp": started_at,
        "disclaimer": "CRG Compliance Engine provides a screening review only. "
                      "This is not legal advice. Final sign-off must come from a "
                      "licensed compliance officer in your jurisdiction.",
    }


# ─── RULE LOADING ──────────────────────────────────────────────────────────

def _resolve_rule_file(industry: str, jurisdiction: str) -> str:
    """Map industry + jurisdiction to a YAML filename (bare name, no path)."""
    key = (industry.strip().lower(), jurisdiction.strip().lower())
    filename = RULE_FILE_MAP.get(key)
    if filename:
        return filename
    # Fallback: try just industry with "ontario" then "canada" then "usa"
    for fallback_j in ("ontario", "canada", "usa"):
        filename = RULE_FILE_MAP.get((industry.strip().lower(), fallback_j))
        if filename:
            return filename
    return ""


_EMBEDDED_BUNDLE_CACHE: Dict[str, Any] = {}


def _get_embedded_bundle() -> Dict[str, Any]:
    """
    Decode the embedded gzip+base64 pre-parsed rule bundle.
    Returns {filename: {meta: {...}, rules: [...]}}.
    Only needs stdlib — no YAML dep.
    """
    global _EMBEDDED_BUNDLE_CACHE
    if _EMBEDDED_BUNDLE_CACHE:
        return _EMBEDDED_BUNDLE_CACHE
    try:
        import gzip
        raw = base64.b64decode(_EMBEDDED_RULES_GZB64)
        decompressed = gzip.decompress(raw)
        _EMBEDDED_BUNDLE_CACHE = json.loads(decompressed.decode("utf-8"))
    except Exception as e:
        print(f"[CRG] Embedded bundle decode error: {e}")
        _EMBEDDED_BUNDLE_CACHE = {}
    return _EMBEDDED_BUNDLE_CACHE


def _load_rules(filename: str) -> Tuple[List[Dict], Dict]:
    """
    Load rules. Priority:
      1. Embedded pre-parsed JSON bundle (deterministic, runs on any worker)
      2. Filesystem YAML fallback (dev-only convenience)

    The bundle is the source of truth — we regenerate it on every rule change.
    This avoids Windmill worker environment differences where pyyaml might not be available.
    """
    if not filename:
        return [], {}

    # Priority 1: embedded pre-parsed bundle (deterministic across all environments)
    bundle = _get_embedded_bundle()
    doc = bundle.get(filename) or {}
    if doc.get("rules"):
        return doc.get("rules", []) or [], doc.get("meta", {}) or {}

    # Priority 2: filesystem YAML (fallback for local dev)
    fs_path = os.path.join(RULES_BASE, filename)
    if os.path.exists(fs_path):
        try:
            with open(fs_path, "r", encoding="utf-8") as f:
                raw = f.read()
            parsed = _parse_yaml(raw)
            if parsed.get("rules"):
                return parsed.get("rules", []), parsed.get("meta", {})
        except Exception as e:
            print(f"[CRG] Filesystem YAML load/parse failed: {e}")

    return [], {}


def _parse_yaml(text: str) -> Dict[str, Any]:
    """
    Minimal YAML-subset parser sufficient for our rule files.
    We prefer pyyaml when installed, otherwise fall back to this parser
    (Windmill workers often have pyyaml available).
    """
    try:
        import yaml
        return yaml.safe_load(text)
    except ImportError:
        pass

    # Manual fallback — parse the rule list structure we actually ship.
    result = {"meta": {}, "rules": []}
    lines = text.split("\n")
    mode = None              # "meta" or "rules"
    current_rule = None
    current_key = None
    keyword_list_active = False
    present_list_active = False
    i = 0
    while i < len(lines):
        raw_line = lines[i]
        line = raw_line.rstrip()
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            i += 1
            continue
        indent = len(line) - len(line.lstrip(" "))

        if stripped.startswith("meta:"):
            mode = "meta"
            i += 1
            continue
        if stripped.startswith("rules:"):
            mode = "rules"
            i += 1
            continue

        if mode == "meta" and indent == 2 and ":" in stripped:
            k, v = stripped.split(":", 1)
            result["meta"][k.strip()] = v.strip().strip('"').strip("'")
            i += 1
            continue

        if mode == "rules":
            if stripped.startswith("- id:"):
                if current_rule:
                    result["rules"].append(current_rule)
                current_rule = {"patterns": {}}
                current_rule["id"] = stripped.split(":", 1)[1].strip().strip('"').strip("'")
                keyword_list_active = False
                present_list_active = False
                i += 1
                continue
            if current_rule is None:
                i += 1
                continue
            if indent == 4 and ":" in stripped and not stripped.startswith("- "):
                k, v = stripped.split(":", 1)
                k = k.strip()
                v = v.strip().strip('"').strip("'")
                keyword_list_active = False
                present_list_active = False
                if k == "patterns":
                    current_key = "patterns"
                elif v == "" or v is None:
                    current_rule[k] = ""
                else:
                    current_rule[k] = v
                i += 1
                continue
            if indent == 6 and ":" in stripped:
                k, v = stripped.split(":", 1)
                k = k.strip()
                v = v.strip().strip('"').strip("'")
                if k == "keywords":
                    current_rule.setdefault("patterns", {})["keywords"] = []
                    keyword_list_active = True
                    present_list_active = False
                elif k == "required_presence" or k == "required_presence_for_context":
                    current_rule.setdefault("patterns", {})[k] = []
                    present_list_active = k
                    keyword_list_active = False
                else:
                    current_rule.setdefault("patterns", {})[k] = v
                    keyword_list_active = False
                    present_list_active = False
                i += 1
                continue
            if indent == 8 and stripped.startswith("- "):
                item = stripped[2:].strip().strip('"').strip("'")
                if keyword_list_active:
                    current_rule["patterns"]["keywords"].append(item)
                elif present_list_active:
                    current_rule["patterns"][present_list_active].append({"raw": item})
                i += 1
                continue
            # unknown - skip
            i += 1
            continue
        i += 1

    if current_rule:
        result["rules"].append(current_rule)
    return result


# ─── PASS 1 — REGEX / KEYWORD SCAN ─────────────────────────────────────────

def _scan_rules(content: str, rules: List[Dict], content_type: str) -> List[Dict]:
    """Run each rule against the content. Return list of findings."""
    findings = []
    lower_content = content.lower()

    for rule in rules:
        patterns = rule.get("patterns", {}) or {}
        ptype = patterns.get("type", "regex")
        hit = False
        matched_snippets = []

        if ptype == "regex":
            for pattern in patterns.get("keywords", []):
                try:
                    matches = list(re.finditer(pattern, content, re.IGNORECASE))
                    if matches:
                        hit = True
                        for m in matches[:3]:
                            start = max(0, m.start() - 20)
                            end = min(len(content), m.end() + 20)
                            matched_snippets.append(content[start:end].replace("\n", " "))
                except re.error:
                    # Fall back to substring match for malformed patterns
                    if pattern.lower() in lower_content:
                        hit = True
                        idx = lower_content.find(pattern.lower())
                        start = max(0, idx - 20)
                        end = min(len(content), idx + len(pattern) + 20)
                        matched_snippets.append(content[start:end].replace("\n", " "))

        elif ptype == "absence":
            # Rule fires if the required phrase is MISSING from the content
            required = patterns.get("required_presence", [])
            context_required = patterns.get("required_presence_for_context", [])

            # Plain absence check: a disclosure that must appear unconditionally
            if required:
                found_any = False
                for req in required:
                    if isinstance(req, dict):
                        pat = req.get("pattern") or req.get("raw") or ""
                    else:
                        pat = str(req)
                    if not pat:
                        continue
                    try:
                        if re.search(pat, content, re.IGNORECASE):
                            found_any = True
                            break
                    except re.error:
                        if pat.lower() in lower_content:
                            found_any = True
                            break
                if not found_any:
                    hit = True
                    matched_snippets.append("[REQUIRED DISCLOSURE MISSING]")

            # Context-conditional absence: disclosure required IF a context trigger fires
            if context_required and not hit:
                for ctx in context_required:
                    if not isinstance(ctx, dict):
                        continue
                    ctx_keywords = ctx.get("context_keywords", [])
                    req_pat = ctx.get("required_pattern", "")
                    # Check if any context keyword is present
                    ctx_hit = any(
                        (kw.lower() in lower_content) for kw in (ctx_keywords or [])
                    )
                    if ctx_hit and req_pat:
                        try:
                            if not re.search(req_pat, content, re.IGNORECASE):
                                hit = True
                                matched_snippets.append(
                                    f"[CONTEXT '{','.join(ctx_keywords[:2])}' — REQUIRED DISCLOSURE MISSING]"
                                )
                                break
                        except re.error:
                            pass

        if hit:
            findings.append({
                "rule_id": rule.get("id"),
                "rule_name": rule.get("name"),
                "severity": rule.get("severity", "MED"),
                "category": rule.get("category", "general"),
                "regulator": rule.get("regulator", ""),
                "legislation": rule.get("legislation", ""),
                "description": rule.get("description", ""),
                "example_violation": rule.get("example_violation", ""),
                "safe_rewrite_hint": rule.get("safe_rewrite_hint", ""),
                "matched_snippets": matched_snippets[:3],
                "source": "rule-engine",
                "reference_url": rule.get("reference_url", ""),
            })

    return findings


# ─── PASS 2 — AI NUANCE CHECK ──────────────────────────────────────────────

def _ai_nuance_check(
    content: str,
    meta: Dict,
    content_type: str,
    rule_findings: List[Dict]
) -> List[Dict]:
    """
    GPT-4o second-pass review for things regex can't catch:
      - misleading framing
      - omissions of material facts
      - implicit guarantees
      - tone issues (pressure tactics)
      - omitted risk disclosures in context
    """
    regulator = meta.get("regulator", "the applicable regulator")
    legislation = meta.get("legislation", "")
    industry = meta.get("industry", "the industry")

    already_flagged = "\n".join([
        f"- {f['rule_id']}: {f['rule_name']}" for f in rule_findings[:12]
    ]) or "(none flagged by regex)"

    system_prompt = f"""You are a senior compliance officer reviewing marketing content for {industry}.
Jurisdiction: {meta.get('jurisdiction', 'unknown')}
Governing body: {regulator}
Legislation: {legislation}

A deterministic rule engine has already scanned the content. Your job is to identify NUANCE-LEVEL issues the regex engine cannot catch:

- Misleading FRAMING (technically true but creates false impression)
- Material OMISSIONS (missing required context or risk disclosures)
- Implied GUARANTEES or promises without explicit words
- PRESSURE tactics, urgency manufacturing, scarcity claims
- CONTEXT issues (e.g., an otherwise-fine statement becomes misleading with this audience/product)

Do NOT re-flag items already caught by the rule engine. Focus on what the regex missed.

Respond with a JSON array. Each finding:
{{
  "issue": "short name (e.g., 'Implied guarantee via success language')",
  "severity": "HIGH|MED|LOW",
  "category": "misleading-framing|material-omission|implied-guarantee|pressure-tactic|context-risk|balanced-presentation",
  "excerpt": "the actual phrase from the content (verbatim)",
  "why_problematic": "1-2 sentences explaining the regulatory concern",
  "fix": "specific suggested rewrite"
}}

If the content is clean and balanced, return an empty array: []
Return ONLY the JSON array — no commentary, no markdown fences."""

    user_prompt = f"""CONTENT TYPE: {content_type}

CONTENT TO REVIEW:
---
{content}
---

ALREADY FLAGGED BY REGEX ENGINE:
{already_flagged}

Identify additional nuance-level compliance concerns a regex engine would miss. Focus on framing, omissions, and implicit claims. Return JSON array only."""

    try:
        resp = requests.post(
            "https://api.openai.com/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {OPENAI_KEY}",
                "Content-Type": "application/json"
            },
            json={
                "model": "gpt-4o",
                "temperature": 0.1,
                "max_tokens": 1800,
                "response_format": {"type": "json_object"},
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt + "\n\nWrap the array as {\"findings\": [ ... ]}"}
                ]
            },
            timeout=45
        )
        resp.raise_for_status()
        raw = resp.json()["choices"][0]["message"]["content"]
        parsed = json.loads(raw)
        ai_items = parsed.get("findings", parsed if isinstance(parsed, list) else [])
        normalized = []
        for item in ai_items:
            if not isinstance(item, dict):
                continue
            normalized.append({
                "rule_id": "AI-NUANCE",
                "rule_name": item.get("issue", "Nuance concern"),
                "severity": (item.get("severity") or "MED").upper(),
                "category": item.get("category", "nuance"),
                "regulator": regulator,
                "legislation": legislation,
                "description": item.get("why_problematic", ""),
                "example_violation": item.get("excerpt", ""),
                "safe_rewrite_hint": item.get("fix", ""),
                "matched_snippets": [item.get("excerpt", "")] if item.get("excerpt") else [],
                "source": "ai-nuance",
                "reference_url": "",
            })
        return normalized
    except Exception as e:
        print(f"[CRG] AI nuance check error: {e}")
        return [{
            "rule_id": "AI-NUANCE-ERROR",
            "rule_name": "AI nuance pass unavailable",
            "severity": "LOW",
            "category": "system",
            "description": f"AI pass could not complete: {str(e)[:140]}. Regex findings only.",
            "source": "ai-nuance",
            "matched_snippets": [],
            "safe_rewrite_hint": "",
            "example_violation": "",
            "regulator": regulator,
            "legislation": "",
            "reference_url": "",
        }]


# ─── VERDICT + REWRITE ─────────────────────────────────────────────────────

def _compute_verdict(rule_findings: List[Dict], ai_findings: List[Dict]) -> Tuple[str, int]:
    """
    Scoring:
      - HIGH finding:  subtracts 20 from 100
      - MED finding:   subtracts 10
      - LOW finding:   subtracts 3
    Verdict:
      - score >= 90  → PASS
      - score >= 60  → FLAG
      - score <  60  → FAIL
    Any HIGH severity → at minimum FLAG.
    """
    all_findings = rule_findings + [f for f in ai_findings if f.get("rule_id") != "AI-NUANCE-ERROR"]
    score = 100
    has_high = False
    for f in all_findings:
        sev = (f.get("severity") or "MED").upper()
        score -= SEVERITY_WEIGHT.get(sev, 10)
        if sev == "HIGH":
            has_high = True
    score = max(0, score)

    if score >= 90 and not has_high:
        verdict = "PASS"
    elif score >= 60:
        verdict = "FLAG"
    else:
        verdict = "FAIL"
    # Any HIGH forces FLAG at minimum
    if has_high and verdict == "PASS":
        verdict = "FLAG"
    return verdict, score


def _generate_rewrite(content: str, rule_findings: List[Dict], ai_findings: List[Dict], meta: Dict) -> str:
    """Ask GPT-4o to produce a compliant rewrite honoring every flagged finding."""
    if not (rule_findings or ai_findings):
        return None

    fix_block = []
    for f in (rule_findings + ai_findings)[:15]:
        fix_block.append(
            f"- [{f.get('severity')}] {f.get('rule_name')}: {f.get('safe_rewrite_hint') or f.get('description','')}"
        )
    fix_str = "\n".join(fix_block)

    system_prompt = (
        f"You rewrite marketing content to be compliant with {meta.get('regulator','the regulator')}. "
        "Keep the author's voice and offer — only change what's necessary. Preserve length where possible. "
        "Add required disclosures in a natural way (inline or footer, as appropriate for the medium). "
        "Return ONLY the rewritten content — no commentary, no markdown fences, no labels."
    )

    user_prompt = f"""Original content:
---
{content}
---

Required fixes (honor every one):
{fix_str}

Rewrite the content to resolve all issues. Keep tone professional and natural."""

    try:
        resp = requests.post(
            "https://api.openai.com/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {OPENAI_KEY}",
                "Content-Type": "application/json"
            },
            json={
                "model": "gpt-4o",
                "temperature": 0.3,
                "max_tokens": 1600,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ]
            },
            timeout=45
        )
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"].strip()
    except Exception as e:
        return f"[Rewrite unavailable — error: {str(e)[:140]}]"


# ─── AUDIT LOG ─────────────────────────────────────────────────────────────

def _write_audit_log(
    content: str,
    content_hash: str,
    started_at: str,
    industry: str,
    jurisdiction: str,
    content_type: str,
    rule_file: str,
    rules_applied_count: int,
    rule_findings: List[Dict],
    ai_findings: List[Dict],
    verdict: str,
    score: int,
    suggested_rewrite: str,
) -> str:
    """Write immutable audit log entry. v1 uses the filesystem; v2 target is S3/R2."""
    day = started_at[:10]  # YYYY-MM-DD
    log_id = f"{day.replace('-','')}-{content_hash}-{int(datetime.now().timestamp())}"
    audit_dir = os.path.join(AUDIT_LOG_BASE, day)

    # Try the configured dir first; fall back to /tmp/crg-audit-log on any worker.
    try:
        os.makedirs(audit_dir, exist_ok=True)
    except Exception:
        audit_dir = os.path.join("/tmp", "crg-audit-log", day)
        try:
            os.makedirs(audit_dir, exist_ok=True)
        except Exception as e:
            print(f"[CRG] Could not create audit dir: {e}")
            return "audit-log-unavailable"

    entry = {
        "audit_log_id": log_id,
        "schema_version": 1,
        "timestamp": started_at,
        "immutable": True,
        "content_hash_sha256_16": content_hash,
        "content_length": len(content),
        "industry": industry,
        "jurisdiction": jurisdiction,
        "content_type": content_type,
        "rule_file": os.path.basename(rule_file) if rule_file else "",
        "rules_applied_count": rules_applied_count,
        "verdict": verdict,
        "score": score,
        "rule_findings_count": len(rule_findings),
        "ai_findings_count": len([f for f in ai_findings if f.get("rule_id") != "AI-NUANCE-ERROR"]),
        "high_severity_count": sum(1 for f in (rule_findings + ai_findings) if f.get("severity") == "HIGH"),
        "med_severity_count": sum(1 for f in (rule_findings + ai_findings) if f.get("severity") == "MED"),
        "low_severity_count": sum(1 for f in (rule_findings + ai_findings) if f.get("severity") == "LOW"),
        "findings": rule_findings + ai_findings,
        "suggested_rewrite_provided": suggested_rewrite is not None,
        "suggested_rewrite": suggested_rewrite,
        "content_snapshot": content,
        "engine_version": "1.0.0",
    }

    filepath = os.path.join(audit_dir, f"{log_id}.json")
    try:
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(entry, f, indent=2, ensure_ascii=False)
        # v2 TODO: also push to S3/R2 immutable bucket. For now, filesystem only.
        return log_id
    except Exception as e:
        print(f"[CRG] Audit log write error: {e}")
        return "audit-log-write-failed"


# ─── ERROR RESPONSE ────────────────────────────────────────────────────────

def _error_response(content_hash: str, started_at: str, message: str) -> Dict[str, Any]:
    return {
        "success": False,
        "verdict": "ERROR",
        "score": 0,
        "content_hash": content_hash,
        "timestamp": started_at,
        "error": message,
        "rule_findings": [],
        "ai_findings": [],
        "rules_applied": 0,
    }
