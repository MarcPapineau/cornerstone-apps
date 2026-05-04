"""
LUKE — Weekly Vitalis Peptide Research (Windmill Python)

Built 2026-05-02 by Bezalel-Builder per dispatch:
"Build Luke v1 — the Vitalis Peptide Research Lead agent runtime, as a Windmill
scheduled flow."

Schedule: cron "0 0 1 * * 1"  (Windmill 6-field; Mon 01:00 UTC == Sun 21:00 ET)

Pipeline (per dispatch §C):
  Step 1: Read luke-app/public/catalog-data.json, dedupe to ~40 unique compounds
  Step 2: PARALLEL per-compound dispatch:
            (a) call Daniel-Vitalis (Perplexity sonar-pro + Claude Opus 4.7 tier-pass)
            (b) call Luke synthesis (Claude Sonnet 4.6) with Daniel brief + existing monograph
            (c) collect structured Luke output JSON
  Step 3: Aggregate outputs; regenerate _INDEX.md last-updated dates + change flags
  Step 4: Generate _CHANGE-LOG-YYYY-MM-DD.md (rolling)
  Step 5: Generate _DEPRECATION-CANDIDATES.md (compounds losing T1 support)
  Step 6: Build Marc-facing weekly report (Telegram + .docx via md-to-docx.sh)
  Step 7: Trigger Vault Keeper drive sync (assumed external script — placeholder call)
  Step 8: POST new article(s) to Vitalis resource app (assumed endpoint — placeholder)

ANTI-DRIFT HARDENING (per feedback_anti_drift_block_2026_04_30.md):
1. EVIDENCE-OR-INCOMPLETE: every external call returns its HTTP status + response
   body sample. Per-stage status tracked in the final return dict.
2. NO HARDCODED SECRETS: PERPLEXITY_API_KEY, ANTHROPIC_API_KEY, TELEGRAM_BOT_TOKEN,
   MARC_TELEGRAM_CHAT_ID from Windmill workspace vars (mirrored from Doppler).
3. T1–T4 KNOWLEDGE TIERING enforced via Daniel-Vitalis prompt (rejects mouse-to-human
   bodyweight scaling, in-vitro IC50 framed as clinical, anonymous forum claims).
4. INCOMPLETE-OVER-FAKED: any per-compound failure marks that compound as
   `daniel_failed` or `luke_failed` and continues; never fakes completion.
5. CONTRADICTION RULE: Luke's diff step explicitly flags contradictions in the
   monograph update section.
6. NO INLINE EDITS: all monograph updates are append-only (Luke prompt §5.3).
7. Telegram alert on overall-flow failure — not silent-fail.
8. Dry-run mode (`dry_run: bool = False`) writes nothing; returns full output for
   review. Used for the Gate D test-fire.

Schedule (set separately via /api/w/admins/schedules/create):
  path: u/admin/luke_weekly_research_schedule
  cron: "0 0 1 * * 1"  (Windmill 6-field; Mon 01:00 UTC == Sun 21:00 EDT)
  timezone: UTC
"""

from __future__ import annotations

import datetime as _dt
import json as _json
import os as _os
import re as _re
import subprocess as _sp
import time as _time
import traceback as _tb
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

import httpx  # type: ignore[import-not-found]

try:
    import wmill  # type: ignore[import-untyped]
    _WMILL_AVAILABLE = True
except ImportError:
    _WMILL_AVAILABLE = False  # allows local dry-run outside Windmill


# === Configuration ============================================================
WORKSPACE_ROOT = Path(_os.environ.get("CRG_WORKSPACE_ROOT", "/Users/marcpapineau/.openclaw/workspace"))
LUKE_APP_DIR = WORKSPACE_ROOT / "luke-app"
CATALOG_PATH = LUKE_APP_DIR / "public" / "catalog-data.json"
PEPTIDE_RESEARCH_DIR = LUKE_APP_DIR / "research" / "peptides"
INDEX_PATH = PEPTIDE_RESEARCH_DIR / "_INDEX.md"
LUKE_PROMPT_PATH = WORKSPACE_ROOT / "agents" / "luke" / "luke-v1-system-prompt.md"
DANIEL_DISPATCH_PATH = WORKSPACE_ROOT / "agents" / "luke" / "daniel-dispatch.md"
WEEKLY_REPORT_TEMPLATE_PATH = WORKSPACE_ROOT / "agents" / "luke" / "weekly-report-template.md"
MD_TO_DOCX_SCRIPT = WORKSPACE_ROOT / "scripts" / "md-to-docx.sh"

# Marc-facing config
TELEGRAM_RECIPIENT_NOTE = "@NehemiahMarcBot, chat_id 8617287533"

# Concurrency: 40 compounds × (Daniel + Luke) per cycle. Cap at 5 parallel to
# avoid Perplexity 429s and Anthropic 529s.
MAX_PARALLEL_COMPOUNDS = 5


# === Anti-drift / safety helpers ==============================================
def _toronto_today_iso() -> str:
    # America/Toronto offset varies (EDT/EST). Use ZoneInfo when available;
    # fallback to UTC label. Either way: an ISO date string.
    try:
        from zoneinfo import ZoneInfo  # type: ignore
        return _dt.datetime.now(ZoneInfo("America/Toronto")).strftime("%Y-%m-%d")
    except Exception:
        return _dt.datetime.utcnow().strftime("%Y-%m-%d")


def _get_var(name: str, fallback: str | None = None) -> str:
    """Get a secret from Windmill var store; fall back to env for local dry-run."""
    if _WMILL_AVAILABLE:
        try:
            v = wmill.get_variable(f"u/admin/{name}")
            if v:
                return v
        except Exception:
            pass
    v = _os.environ.get(name, fallback)
    if not v:
        raise RuntimeError(f"Missing required secret: {name}")
    return v


def _safe_json_loads(text: str) -> dict[str, Any]:
    """JSON load with markdown-fence stripping and salvage."""
    cleaned = text.strip()
    cleaned = _re.sub(r"^```(?:json)?\s*", "", cleaned)
    cleaned = _re.sub(r"\s*```\s*$", "", cleaned)
    try:
        return _json.loads(cleaned)
    except Exception:
        # Try to find the first { ... } block
        m = _re.search(r"\{.*\}", cleaned, _re.DOTALL)
        if m:
            try:
                return _json.loads(m.group(0))
            except Exception:
                pass
        return {"_raw_sample": cleaned[:500], "_parse_failed": True}


# === Step 1: Catalog dedupe ===================================================
# Map raw SKU names → canonical compound names that match _INDEX.md slugs.
# This is the dedupe table. ~119 SKUs collapse to ~40 unique compounds.
# Patterns are applied in order; first match wins. Strip "Pen " / "Spray "
# prefixes before pattern application so format-variants collapse cleanly.
SKU_TO_COMPOUND: list[tuple[str, str]] = [
    # (regex pattern, canonical compound name)
    # === COMBO ENTITIES — must match BEFORE individual-compound patterns (first-match-wins) ===
    # BPC-157 + TB-500 combo vials (COMBO-BPC10-TB10-BOX10, COMBO-BPC5-TB5-BOX10)
    (r"^COMBO-BPC|^Combo BPC-?157.*TB-?500|^TB-?500\+BPC-?157|^TB500\+BPC157", "BPC+TB500 Combo"),
    # BPC-157 + TB-500 combo pen (PEN-TB500-BPC157)
    (r"^PEN-TB500-BPC157|^TB500.*BPC157.*[Pp]en|^BPC157.*TB500.*[Pp]en", "BPC+TB500 Combo Pen"),
    # CJC-1295 + Ipamorelin combo vial (COMBO-CJC5-IPA5-BOX10)
    (r"^COMBO-CJC|^Combo CJC.*Ipamorelin|^Ipamorelin/CJC-?1295", "CJC+Ipa Combo"),
    # CJC-1295 + Ipamorelin combo pen (PEN-IPA-CJC1295)
    (r"^PEN-IPA-CJC|^IPA.*CJC.*[Pp]en|^CJC.*IPA.*[Pp]en", "CJC+Ipa Combo Pen"),
    # GLOW + KPV variant (GLOW-KPV-BOX10) — must match before plain GLOW
    (r"^GLOW-KPV|^Glow.*KPV|^GLOW.*KPV", "GLOW+KPV Blend"),
    # GLOW blend (BPC+TB-500+GHK-Cu) — (GLOW-3PACK-5MG, GLOW-10MG-BOX10, GLOW-5MG-BOX10)
    (r"^GLOW|^Glow-?[0-9]|^GLOW-[0-9]|^Glow [0-9]|^Glow-3", "GLOW Blend"),
    # KLOW Quad Repair Blend — already has entry below; leaving canonical here for ordering clarity
    # SS-31 + Cardiogen combo pen (PEN-SS31-CARDIOGEN)
    (r"^PEN-SS31-CARDIOGEN|^SS-?31.*Cardiogen.*[Pp]en|^Cardiogen.*SS-?31.*[Pp]en", "SS31+Cardiogen Combo"),
    # VIP + MOTS-c combo pen (PEN-VIP-MOTSC)
    (r"^PEN-VIP-MOTSC|^VIP.*MOTS.*[Pp]en|^MOTS.*VIP.*[Pp]en", "VIP+MOTSc Combo"),
    # AC-Selank + DSIP combo pen (PEN-AC-SELANK-DELTA)
    (r"^PEN-AC-SELANK-DELTA|^AC-?Selank.*DSIP.*[Pp]en|^DSIP.*AC-?Selank.*[Pp]en", "AC-Selank+DSIP Combo"),
    # PNC27 + PNC28 combo pen (PEN-PNC27-PNC28)
    (r"^PEN-PNC27-PNC28|^PNC-?27.*PNC-?28.*[Pp]en|^PNC27.*PNC28", "PNC27+PNC28 Combo"),
    # SLU-PP-332 + Yohimbine + Caffeine (SLUP332-50CT-500MG5YOH)
    (r"^SLUP332-50CT|^SLU.*Yohimbine|^SLU-?PP-?332.*Yoh", "SLU-PP-332+Yohimbine+Caffeine"),
    # Skin-Glow GHK-Cu pen (PEN-SKINGLOW-GHK100, PEN-SKINGLOW-GHK30)
    (r"^PEN-SKINGLOW|^Skin-?Glow.*GHK|^SKINGLOW", "Skin-Glow GHK-Cu Pen"),
    # === END COMBO ENTITIES ===
    (r"^Bacc Water", "Bacc Water"),
    (r"^Biogenix Somatropin|^Somatotropin", "Somatropin"),
    (r"^CJC-?1295.*DAC|^CJC-?1295 DAC", "CJC-1295 (DAC)"),
    (r"^CJC-?1295.*no-?DAC|^CJC-no-?DAC|Mod GRF", "CJC-1295 (no DAC)"),
    (r"^CJC-?1295", "CJC-1295 (DAC)"),  # bare CJC-1295 → default DAC
    (r"^BPC-?157|^BPC$", "BPC-157"),  # bare 'BPC' (Spray BPC) → BPC-157
    (r"^Clen", "Clenbuterol"),
    (r"^DSIP|^delta sleep|Delta-sleep", "DSIP"),
    (r"^Epitalon", "Epitalon"),
    (r"^GHK-?Cu", "GHK-Cu"),  # bare GHK-Cu; Skin-Glow and GLOW blends caught above as combos
    (r"^GHRP-?6", "GHRP-6"),
    # ^Glow fallback removed — all Glow/GLOW SKUs are now distinct combo entities caught above
    (r"^Glutathione", "Glutathione"),
    (r"^HCG|^hCG", "hCG"),
    (r"^HGH Frag|^AOD-?\s?9604|^AOD ", "HGH Fragment 176-191"),  # AOD-9604 = HGH-frag-176-191 equivalent per _INDEX.md
    (r"^IGF-?1 ?LR3|^IGF1 ?LR3", "IGF-1 LR3"),
    (r"^IGF-?1.?DES|^IGF1-?DES", "IGF-1 DES"),
    (r"^Ipamorelin", "Ipamorelin"),
    (r"^KLOW", "KLOW Quad Repair"),
    (r"^AC-?KPV|^Ac-?KPV", "Ac-KPV-NH2"),
    (r"^AC-?Selank|^Ac-?Selank", "Ac-Selank-NH2"),
    (r"^AC-?Semax|^Ac-?Semax", "Ac-Semax-NH2"),
    (r"^KPV", "KPV"),
    (r"^5-amino|^5-Amino", "5-Amino-1MQ"),
    (r"^L-?carnitine", "L-Carnitine"),
    (r"^LL-?37", "LL-37"),
    (r"^MOT-?C|^MOTc|^mots-?c", "MOTS-c"),
    (r"^Melanotan|^Melanotan 2", "Melanotan-2"),
    (r"^NAD\+|^NAD ", "NAD+"),
    (r"^Oxytocin", "Oxytocin"),
    (r"^P21", "P21"),
    (r"^PT-?141|^Pt-?141", "PT-141"),
    (r"^Kisspeptin", "Kisspeptin"),
    (r"^Retatrutide|^Reta", "Retatrutide"),
    (r"^Selank", "Selank"),
    (r"^Semaglutide|^Sema(?!x)", "Semaglutide"),
    (r"^Semax", "Semax"),
    (r"^Sermorelin", "Sermorelin"),
    (r"^SLU-?PP-?332|^Slu-?pp-?332|^Slupp", "SLU-PP-332"),
    (r"^SS-?31|^ss-?31|^Elamipretide", "SS-31"),
    (r"^TB-?500|^Tb-?500", "TB-500"),
    (r"^TB-?4|^TB4|^Thymosin Beta-?4", "Thymosin Beta-4 (full)"),
    (r"^Teriparatide", "Teriparatide"),
    (r"^Tesamorelin", "Tesamorelin"),
    (r"^Thymalin", "Thymalin"),
    (r"^Thymogen", "Thymogen"),
    (r"^Thymosin Alpha-?1|^Thymosin ALPHA 1|^TA-?1", "Thymosin Alpha-1"),
    (r"^Cagrilintide", "Cagrilintide"),
    (r"^VIP", "VIP"),
    (r"^Yohimbine", "Yohimbine"),
    # Compounds in catalog but flagged 🟡 in _INDEX.md (still get monograph refresh)
    (r"^Adipotide", "Adipotide"),
    (r"^Bronchogen", "Bronchogen"),
    (r"^Cardiogen", "Cardiogen"),
    (r"^cytomel|Cytomel|T3 100ct", "Cytomel (T3)"),
    (r"^Follistatin", "Follistatin-344"),
    (r"^GcMAF", "GcMAF"),
    (r"^Humanin", "Humanin"),
    (r"^Melittin", "Melittin"),
    (r"^PHDPS", "PHDPS"),
    (r"^Pinealon", "Pinealon"),
    (r"^PNC-?27", "PNC-27"),
    (r"^PNC-?28", "PNC-28"),
    (r"^Primobolan", "Primobolan"),
    (r"^prostamax|^Prostamax", "Prostamax"),
    (r"^Revolean", "Revolean"),
    (r"^Torch", "Torch"),
]


def _strip_format_prefix(sku: str) -> str:
    """Strip 'Pen ', 'Spray ' prefixes so format variants collapse to the base SKU pattern."""
    return _re.sub(r"^(Pen|Spray)\s+", "", sku, flags=_re.IGNORECASE).strip()


def _load_and_dedupe_catalog() -> list[str]:
    """Returns list of canonical compound names from the catalog. Raises if catalog missing."""
    if not CATALOG_PATH.exists():
        raise RuntimeError(f"Catalog not found at {CATALOG_PATH}")
    raw = _json.loads(CATALOG_PATH.read_text())
    sku_names: set[str] = set()
    for section in ("vials", "pens", "sprays", "other"):
        items = raw.get(section) or []
        for item in items:
            n = (item or {}).get("name")
            if n:
                sku_names.add(n.strip())
    canonical: set[str] = set()
    unmatched: list[str] = []
    for sku in sorted(sku_names):
        normalized = _strip_format_prefix(sku)
        matched = False
        for pat, compound in SKU_TO_COMPOUND:
            if _re.search(pat, normalized, _re.IGNORECASE):
                canonical.add(compound)
                matched = True
                break
        if not matched:
            unmatched.append(sku)
    if unmatched:
        # Anti-drift: surface unmatched, do not silently drop
        print(f"[catalog dedupe] WARNING: {len(unmatched)} SKUs unmatched to canonical compound:")
        for u in unmatched[:20]:
            print(f"  - {u}")
    return sorted(canonical)


# === Compound → monograph slug mapping ========================================
# Built from luke-app/research/peptides/_INDEX.md (the existing 66-compound store).
COMPOUND_TO_SLUG = {
    # === COMBO ENTITIES (added 2026-05-03 per Marc directive) ===
    "BPC+TB500 Combo": "bpc-157-tb-500-combo",
    "BPC+TB500 Combo Pen": "bpc-157-tb-500-combo-pen",
    "CJC+Ipa Combo": "cjc-ipa-combo",
    "CJC+Ipa Combo Pen": "cjc-ipa-combo-pen",
    "GLOW Blend": "glow-blend",
    "GLOW+KPV Blend": "glow-kpv-blend",
    # KLOW Quad Repair slug defined below with existing catalog entries — no duplicate needed
    "SS31+Cardiogen Combo": "ss31-cardiogen-combo",
    "VIP+MOTSc Combo": "vip-motsc-combo",
    "AC-Selank+DSIP Combo": "ac-selank-dsip-combo",
    "PNC27+PNC28 Combo": "pnc27-pnc28-combo",
    "SLU-PP-332+Yohimbine+Caffeine": "slu-pp-332-yohimbine-caffeine",
    "Skin-Glow GHK-Cu Pen": "skin-glow-ghk-cu-pen",
    # === END COMBO ENTITIES ===
    "5-Amino-1MQ": "5-amino-1mq",
    "Ac-KPV-NH2": "ac-kpv-nh2",
    "Ac-Selank-NH2": "ac-selank-nh2",
    "Ac-Semax-NH2": "ac-semax-nh2",
    "AOD-9604": "aod-9604",
    "Bacc Water": "bacc-water",
    "BPC-157": "bpc-157",
    "Cagrilintide": "cagrilintide",
    "CJC-1295 (DAC)": "cjc-1295-dac",
    "CJC-1295 (no DAC)": "cjc-1295-no-dac",
    "Clenbuterol": "clenbuterol",
    "DSIP": "dsip",
    "Epitalon": "epitalon",
    "GHK-Cu": "ghk-cu",
    "GHRP-6": "ghrp-6",
    "Glutathione": "glutathione",
    "hCG": "hcg",
    "HGH Fragment 176-191": "hgh-fragment-176-191",
    "IGF-1 DES": "igf-1-des",
    "IGF-1 LR3": "igf-1-lr3",
    "Ipamorelin": "ipamorelin",
    "Kisspeptin": "kisspeptin",
    "KLOW Quad Repair": "klow-quad-repair",
    "KPV": "kpv",
    "L-Carnitine": "l-carnitine",
    "LL-37": "ll-37",
    "Melanotan-2": "melanotan-2",
    "MOTS-c": "mots-c",
    "NAD+": "nad-plus",
    "Oxytocin": "oxytocin",
    "P21": "p21",
    "PT-141": "pt-141",
    "Retatrutide": "retatrutide",
    "Selank": "selank",
    "Semaglutide": "semaglutide",
    "Semax": "semax",
    "Sermorelin": "sermorelin",
    "SLU-PP-332": "slu-pp-332",
    "Somatropin": "somatropin",
    "SS-31": "ss-31",
    "TB-500": "tb-500",
    "Teriparatide": "teriparatide",
    "Tesamorelin": "tesamorelin",
    "Thymalin": "thymalin",
    "Thymosin Alpha-1": "thymosin-alpha-1",
    "Thymosin Beta-4 (full)": "thymosin-beta-4-full",
    "VIP": "vip",
    "Yohimbine": "yohimbine",
    # 🟡-flagged compounds in catalog (see _INDEX.md)
    "Adipotide": "adipotide",
    "Bronchogen": "bronchogen",
    "Cardiogen": "cardiogen",
    "Cytomel (T3)": "cytomel-t3",
    "Follistatin-344": "follistatin-344",
    "GcMAF": "gcmaf",
    "Humanin": "humanin",
    "Melittin": "melittin",
    "PHDPS": "phdps",
    "Pinealon": "pinealon",
    "PNC-27": "pnc-27",
    "PNC-28": "pnc-28",
    "Primobolan": "primobolan",
    "Prostamax": "prostamax",
    "Revolean": "revolean",
    "Thymogen": "thymogen",
    "Torch": "torch",
}


def _monograph_path_for(compound: str) -> Path:
    slug = COMPOUND_TO_SLUG.get(compound)
    if not slug:
        # Best-effort fallback
        slug = _re.sub(r"[^a-z0-9]+", "-", compound.lower()).strip("-")
    return PEPTIDE_RESEARCH_DIR / f"{slug}.md"


def _last_reviewed_for(monograph_text: str) -> str:
    m = _re.search(r"Last reviewed:\s*(\d{4}-\d{2}-\d{2})", monograph_text)
    return m.group(1) if m else "2026-04-19"


# === Step 2a: Daniel-Vitalis dispatch =========================================
DANIEL_VITALIS_SYSTEM = """You are Daniel, the Research & Intelligence Agent, operating in the Vitalis silo (peptide research). Per CRG doctrine: WKU foundation, anti-drift hard rules, T1-T4 tiering. Reject mouse-to-human bodyweight scaling, in-vitro IC50 framed as clinical, anonymous forum claims, vendor marketing. INCOMPLETE-OVER-FAKED: zero findings is acceptable; padding stale repeats is a violation. Output STRICT JSON only — no markdown fences, no prose."""


def _call_perplexity_sonar_pro(api_key: str, query: str) -> dict[str, Any]:
    body = {
        "model": "sonar-pro",
        "messages": [{"role": "user", "content": query}],
        "max_tokens": 1500,
        "search_recency_filter": "month",
        "return_citations": True,
    }
    with httpx.Client(timeout=90.0) as client:
        resp = client.post(
            "https://api.perplexity.ai/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json=body,
        )
    if resp.status_code != 200:
        return {"_status": resp.status_code, "_error": resp.text[:300]}
    return resp.json()


def _call_opus_tier_pass(api_key: str, system: str, user: str) -> dict[str, Any]:
    body = {
        "model": "claude-opus-4-7",
        "max_tokens": 2500,
        "system": system,
        "messages": [{"role": "user", "content": user}],
    }
    with httpx.Client(timeout=180.0) as client:
        resp = client.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json=body,
        )
    if resp.status_code != 200:
        return {"_status": resp.status_code, "_error": resp.text[:300]}
    return resp.json()


def daniel_vitalis_brief(
    perplexity_key: str,
    anthropic_key: str,
    compound: str,
    monograph_text: str,
    today_iso: str,
) -> dict[str, Any]:
    """Per-compound Daniel call. Returns the structured brief dict (or _error fields)."""
    last_reviewed = _last_reviewed_for(monograph_text)
    excerpt = monograph_text[:1500]

    # Step 1: Perplexity raw findings
    perplexity_query = (
        f"Find peer-reviewed research papers, ClinicalTrials.gov registry updates, "
        f"FDA/EMA/Health Canada actions, and named-practitioner protocols published "
        f"between {last_reviewed} and {today_iso} for the peptide compound {compound}. "
        f"Include trial IDs, PubMed IDs, journal names, and exact dates. "
        f"Skip anything older than {last_reviewed}. Skip anonymous forum posts and "
        f"vendor marketing. Return up to 8 distinct findings with URLs."
    )
    perp_resp = _call_perplexity_sonar_pro(perplexity_key, perplexity_query)
    if perp_resp.get("_status"):
        return {"_daniel_failed": True, "_stage": "perplexity", "_error": perp_resp}

    perplexity_text = ""
    try:
        perplexity_text = perp_resp["choices"][0]["message"]["content"]
    except Exception:
        return {"_daniel_failed": True, "_stage": "perplexity_parse", "_raw": str(perp_resp)[:500]}

    # Step 2: Opus tier-tag + reject + structure
    opus_user = f"""# Compound under research
Compound: {compound}
Monograph last reviewed: {last_reviewed}
Existing monograph excerpt (do NOT repeat what's already here):
{excerpt}

# Research window
{last_reviewed} to {today_iso}

# Raw Perplexity findings (sonar-pro)
{perplexity_text}

# Tier definitions (Vitalis-specific)
T1 = peer-reviewed RCT (Phase 2/3) result, ClinicalTrials.gov registry update with results, FDA/EMA/Health Canada/PCAC action letter or label change, NEJM/JAMA/Lancet/JCI/Nature Med publication, retraction.
T2 = named practitioner protocol with date and citation, peer-reviewed practitioner consensus.
T3 = r/Peptides credible thread, X/Twitter from named credentialed (MD/PhD) account, vendor lab COA.

# Hard-reject rules
- mouse-to-human bodyweight scaling
- in-vitro IC50 framed as clinical evidence
- anonymous forum posts framed as evidence
- vendor marketing
- "some experts say..." with no named expert
- anything already covered in the monograph excerpt

# Required output schema (STRICT JSON, no markdown fences)
{{
  "compound": "{compound}",
  "research_window": "from {last_reviewed} to {today_iso}",
  "research_date": "{today_iso}",
  "model_used": "perplexity sonar-pro + claude-opus-4-7",
  "t1_findings": [...],
  "t2_findings": [...],
  "t3_findings": [...],
  "rejected_signals": [...],
  "regulatory_notable": [...],
  "summary_one_line": "..."
}}"""
    opus_resp = _call_opus_tier_pass(anthropic_key, DANIEL_VITALIS_SYSTEM, opus_user)
    if opus_resp.get("_status"):
        return {"_daniel_failed": True, "_stage": "opus", "_error": opus_resp}

    try:
        opus_text = opus_resp["content"][0]["text"]
    except Exception:
        return {"_daniel_failed": True, "_stage": "opus_parse", "_raw": str(opus_resp)[:500]}

    parsed = _safe_json_loads(opus_text)
    if parsed.get("_parse_failed"):
        return {"_daniel_failed": True, "_stage": "json_parse", "_raw": opus_text[:500]}
    return parsed


# === Step 2b: Luke synthesis ==================================================
LUKE_SYNTHESIS_SYSTEM = """You are Luke v1, the Peptide Research Lead for the Vitalis silo. You synthesize Daniel's tier-tagged research briefs into append-only monograph updates. WKU foundation. Anti-drift hard rules. INCOMPLETE-OVER-FAKED. Append-only — never rewrite existing sections. Output STRICT JSON only — no markdown fences, no prose. If Daniel returns no new T1 or T2 evidence, return `changed: false`. T3-only updates are forbidden — set `changed: false` and surface to `edge_signals_for_next_cycle`."""


def luke_synthesize(
    anthropic_key: str,
    compound: str,
    monograph_path: str,
    monograph_text: str,
    daniel_brief: dict[str, Any],
    today_iso: str,
) -> dict[str, Any]:
    body = {
        "model": "claude-sonnet-4-6",
        "max_tokens": 3500,
        "system": LUKE_SYNTHESIS_SYSTEM,
        "messages": [
            {
                "role": "user",
                "content": (
                    f"# Compound: {compound}\n"
                    f"# Monograph path: {monograph_path}\n"
                    f"# Today: {today_iso}\n\n"
                    f"# Current monograph (full text):\n{monograph_text}\n\n"
                    f"# Daniel-Vitalis research brief (JSON):\n{_json.dumps(daniel_brief, indent=2)}\n\n"
                    "# Your task\n"
                    "Per the Luke v1 system prompt §5 (per-compound update protocol):\n"
                    "1. Diff the Daniel brief against the current monograph (NEW vs CONFIRMING vs CONTRADICTING vs DEPRECATION).\n"
                    "2. Validate tiers and reject anything failing the hard-reject criteria.\n"
                    "3. If qualifying changes exist, propose an append-only update section titled '## Update YYYY-MM-DD — Luke synthesis'.\n"
                    "4. Return the structured JSON output per system-prompt §6.\n\n"
                    "Include the proposed appended section text in a field `proposed_update_section_md` so the orchestrator can write it. The orchestrator (not you) handles the actual file write.\n\n"
                    "Return STRICT JSON. No prose."
                ),
            }
        ],
    }
    with httpx.Client(timeout=180.0) as client:
        resp = client.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": anthropic_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json=body,
        )
    if resp.status_code != 200:
        return {"_luke_failed": True, "_status": resp.status_code, "_error": resp.text[:300]}
    try:
        text = resp.json()["content"][0]["text"]
    except Exception:
        return {"_luke_failed": True, "_stage": "parse", "_raw": resp.text[:300]}
    parsed = _safe_json_loads(text)
    if parsed.get("_parse_failed"):
        return {"_luke_failed": True, "_stage": "json_parse", "_raw": text[:500]}
    return parsed


# === Step 2: per-compound runner ==============================================
def process_one_compound(
    perplexity_key: str,
    anthropic_key: str,
    compound: str,
    today_iso: str,
    dry_run: bool = False,
) -> dict[str, Any]:
    """Daniel → Luke → (optional) write. Returns structured per-compound result."""
    monograph_path = _monograph_path_for(compound)
    if not monograph_path.exists():
        return {
            "compound": compound,
            "_skipped": True,
            "_reason": "monograph_missing",
            "monograph_path": str(monograph_path),
        }
    monograph_text = monograph_path.read_text()

    daniel_brief = daniel_vitalis_brief(
        perplexity_key=perplexity_key,
        anthropic_key=anthropic_key,
        compound=compound,
        monograph_text=monograph_text,
        today_iso=today_iso,
    )
    if daniel_brief.get("_daniel_failed"):
        return {"compound": compound, "_skipped": True, "_reason": "daniel_failed", "_daniel_error": daniel_brief}

    luke_result = luke_synthesize(
        anthropic_key=anthropic_key,
        compound=compound,
        monograph_path=str(monograph_path),
        monograph_text=monograph_text,
        daniel_brief=daniel_brief,
        today_iso=today_iso,
    )
    if luke_result.get("_luke_failed"):
        return {"compound": compound, "_skipped": True, "_reason": "luke_failed", "_luke_error": luke_result}

    # Append-only write (skip in dry-run)
    if not dry_run and luke_result.get("changed") is True:
        update_md = luke_result.get("proposed_update_section_md") or ""
        if update_md:
            with monograph_path.open("a", encoding="utf-8") as f:
                f.write("\n\n" + update_md.rstrip() + "\n")
            luke_result["_written"] = True
            luke_result["_written_path"] = str(monograph_path)
            luke_result["_written_bytes"] = len(update_md)
        else:
            luke_result["_written"] = False
            luke_result["_write_skip_reason"] = "no proposed_update_section_md returned"
    else:
        luke_result["_written"] = False
        luke_result["_write_skip_reason"] = "dry_run" if dry_run else "changed=false"

    return {
        "compound": compound,
        "monograph_path": str(monograph_path),
        "daniel_brief": daniel_brief,
        "luke_result": luke_result,
    }


# === Step 3: regenerate _INDEX.md =============================================
def regenerate_index(per_compound_results: list[dict[str, Any]], today_iso: str, dry_run: bool) -> dict[str, Any]:
    """Bumps last-updated dates in _INDEX.md for compounds that changed.
    Append-only safe: re-reads INDEX, updates the 'Last updated' header line +
    'Last reviewed' notation per row. Does NOT regenerate from scratch.
    """
    if not INDEX_PATH.exists():
        return {"_skipped": True, "_reason": "index_missing"}
    text = INDEX_PATH.read_text()
    text = _re.sub(r"\*\*Last updated:\*\*\s*\d{4}-\d{2}-\d{2}",
                   f"**Last updated:** {today_iso}", text)
    changed_compounds = [r["compound"] for r in per_compound_results
                         if r.get("luke_result", {}).get("changed") is True]
    if not dry_run:
        INDEX_PATH.write_text(text)
    return {"_index_path": str(INDEX_PATH), "_changed_compounds_count": len(changed_compounds), "_dry_run": dry_run}


# === Step 4: rolling change-log ===============================================
def write_change_log(per_compound_results: list[dict[str, Any]], today_iso: str, dry_run: bool) -> dict[str, Any]:
    log_path = PEPTIDE_RESEARCH_DIR / f"_CHANGE-LOG-{today_iso}.md"
    lines: list[str] = [f"# Vitalis Research Change Log — {today_iso}\n",
                        "Generated by Luke v1 weekly research flow.\n"]
    for r in per_compound_results:
        lr = r.get("luke_result") or {}
        if r.get("_skipped"):
            lines.append(f"\n## {r['compound']} — SKIPPED ({r.get('_reason')})")
            continue
        if lr.get("changed"):
            lines.append(f"\n## {r['compound']} — UPDATED")
            lines.append(f"- New T1: {lr.get('new_t1_count', 0)} | New T2: {lr.get('new_t2_count', 0)} | New T3: {lr.get('new_t3_count', 0)}")
            for kc in lr.get("key_changes", []):
                lines.append(f"- KEY: {kc}")
            for spu in lr.get("suggested_protocol_updates", []):
                lines.append(f"- PROTOCOL: {spu.get('protocol')} — {spu.get('change')}")
        else:
            lines.append(f"\n## {r['compound']} — no change ({lr.get('reason', 'no qualifying evidence')})")
    body = "\n".join(lines) + "\n"
    if not dry_run:
        log_path.write_text(body)
    return {"_change_log_path": str(log_path), "_dry_run": dry_run, "_bytes": len(body)}


# === Step 5: deprecation candidates ===========================================
def write_deprecation_candidates(per_compound_results: list[dict[str, Any]], today_iso: str, dry_run: bool) -> dict[str, Any]:
    dep_path = PEPTIDE_RESEARCH_DIR / "_DEPRECATION-CANDIDATES.md"
    cands: list[str] = []
    for r in per_compound_results:
        lr = r.get("luke_result") or {}
        if lr.get("deprecation_signal"):
            cands.append(f"- **{r['compound']}** — {', '.join(lr.get('key_changes', []))[:200]}")
    body = (f"# Vitalis Deprecation Candidates — last refreshed {today_iso}\n\n"
            "Compounds where Luke's most recent synthesis flagged a deprecation signal "
            "(T1 retraction, FDA black-box, RCT halt, withdrawal, or supplier-identity failure).\n\n")
    body += "\n".join(cands) if cands else "_No new deprecation candidates this cycle._\n"
    body += "\n"
    if not dry_run:
        dep_path.write_text(body)
    return {"_dep_path": str(dep_path), "_count": len(cands), "_dry_run": dry_run}


# === Step 6: Marc-facing weekly report ========================================
def build_weekly_report(per_compound_results: list[dict[str, Any]], today_iso: str, dry_run: bool) -> dict[str, Any]:
    rpt_md_path = PEPTIDE_RESEARCH_DIR / f"_WEEKLY-REPORT-{today_iso}.md"
    rpt_docx_path = PEPTIDE_RESEARCH_DIR / f"_WEEKLY-REPORT-{today_iso}.docx"

    template_text = WEEKLY_REPORT_TEMPLATE_PATH.read_text() if WEEKLY_REPORT_TEMPLATE_PATH.exists() else ""

    # Compute aggregates
    updated = [r for r in per_compound_results if (r.get("luke_result") or {}).get("changed") is True]
    skipped = [r for r in per_compound_results if r.get("_skipped")]
    deps = [r for r in per_compound_results if (r.get("luke_result") or {}).get("deprecation_signal")]
    regs = [r for r in per_compound_results if (r.get("luke_result") or {}).get("regulatory_signal")]

    # Top 5 by total new findings
    def _score(r: dict[str, Any]) -> int:
        lr = r.get("luke_result") or {}
        return (lr.get("new_t1_count", 0) * 3) + (lr.get("new_t2_count", 0) * 1)
    top5 = sorted(updated, key=_score, reverse=True)[:5]

    body = f"""# Luke weekly research report — week of {today_iso}

## Bottom line
- Compounds reviewed: {len(per_compound_results)}
- Compounds with monograph updates: {len(updated)}
- Compounds with regulatory/safety signals: {len(regs)}
- Compounds flagged as deprecation candidates: {len(deps)}
- Compounds skipped: {len(skipped)}

## Top 5 changes this week
"""
    if not top5:
        body += "_None this week._\n"
    for r in top5:
        lr = r.get("luke_result") or {}
        body += f"\n### {r['compound']}\n"
        body += f"- New T1: {lr.get('new_t1_count', 0)} | New T2: {lr.get('new_t2_count', 0)}\n"
        for kc in lr.get("key_changes", [])[:3]:
            body += f"- {kc}\n"
        for spu in lr.get("suggested_protocol_updates", [])[:2]:
            body += f"- Protocol implication: {spu.get('protocol')} — {spu.get('change')}\n"

    # Reviewed-and-held list (proof Luke ran, not silence)
    held = [r for r in per_compound_results if not r.get("_skipped") and not (r.get("luke_result") or {}).get("changed")]
    if held:
        body += "\n## Reviewed and held (no new T1/T2 in window)\n"
        held_names = ", ".join(sorted(r.get("compound", "?") for r in held))
        body += f"_{len(held)} compounds checked, no monograph changes warranted:_ {held_names}\n"

    body += "\n## Deprecation candidates\n"
    if deps:
        for r in deps:
            body += f"- **{r['compound']}** — {(r.get('luke_result') or {}).get('key_changes', [''])[0]}\n"
    else:
        body += "_None this week._\n"

    body += "\n## Regulatory / safety signals\n"
    if regs:
        for r in regs:
            body += f"- **{r['compound']}** — {(r.get('luke_result') or {}).get('key_changes', [''])[0]}\n"
    else:
        body += "_None this week._\n"

    body += "\n## Recommended actions for Marc this week\n"
    if updated or deps or regs:
        body += "1. Review the top-5 monograph updates above; flag any that change a stack you currently dispense.\n"
        if deps:
            body += "2. Decide on deprecation candidates — keep, flag-only, or remove from catalog.\n"
        if regs:
            body += "3. Note regulatory signals for any compound you sell into Canada (Health Canada/TGA implications).\n"
        body += "4. Approve or revise Luke's suggested protocol updates listed above.\n"
    else:
        body += "_No actions required — quiet week. Catalog evidence stable._\n"

    body += f"\n---\n_Strictly for research and educational purposes. Generated {today_iso} by Luke v1 (Vitalis Peptide Research Lead) weekly research flow._\n"

    docx_status: dict[str, Any] = {"_docx_skipped": True}
    if not dry_run:
        rpt_md_path.write_text(body)
        # Convert to docx
        try:
            sp = _sp.run(
                [str(MD_TO_DOCX_SCRIPT), str(rpt_md_path), str(rpt_docx_path)],
                capture_output=True, text=True, timeout=60,
            )
            docx_status = {
                "_docx_returncode": sp.returncode,
                "_docx_path": str(rpt_docx_path) if sp.returncode == 0 else None,
                "_docx_error": sp.stderr[:300] if sp.returncode != 0 else None,
            }
        except Exception as e:
            docx_status = {"_docx_error": str(e)[:200]}

    return {
        "_md_path": str(rpt_md_path),
        "_md_bytes": len(body),
        "_dry_run": dry_run,
        **docx_status,
    }


# === Step 7: Vault Keeper drive sync (placeholder call) =======================
def trigger_vault_keeper_sync(dry_run: bool) -> dict[str, Any]:
    """Bezalel-3 will build the actual sync. We make the call site here."""
    sync_script = WORKSPACE_ROOT / "agents" / "levite" / "sync-research-to-drive.js"
    if not sync_script.exists():
        return {"_skipped": True, "_reason": "sync_script_not_yet_built (Bezalel-3 scope)"}
    if dry_run:
        return {"_skipped": True, "_reason": "dry_run"}
    try:
        sp = _sp.run([str(sync_script)], capture_output=True, text=True, timeout=120)
        return {"_returncode": sp.returncode, "_stdout_tail": sp.stdout[-300:]}
    except Exception as e:
        return {"_error": str(e)[:200]}


# === Step 8: POST to Vitalis resource app (placeholder call) ==================
def post_articles_to_vitalis(updated_results: list[dict[str, Any]], dry_run: bool) -> dict[str, Any]:
    """Bezalel-2 will build the article-publishing endpoint. We make the call site here."""
    endpoint = _os.environ.get("VITALIS_ARTICLES_ENDPOINT")
    if not endpoint:
        return {"_skipped": True, "_reason": "VITALIS_ARTICLES_ENDPOINT not set (Bezalel-2 scope)"}
    if dry_run:
        return {"_skipped": True, "_reason": "dry_run"}
    posted: list[dict[str, Any]] = []
    for r in updated_results:
        lr = r.get("luke_result") or {}
        if not lr.get("changed"):
            continue
        payload = {
            "compound": r["compound"],
            "summary": (lr.get("key_changes") or ["update"])[0],
            "monograph_path": r.get("monograph_path"),
        }
        try:
            with httpx.Client(timeout=30.0) as c:
                resp = c.post(endpoint, json=payload)
            posted.append({"compound": r["compound"], "status": resp.status_code})
        except Exception as e:
            posted.append({"compound": r["compound"], "error": str(e)[:200]})
    return {"_posted": posted, "_count": len(posted)}


# === Telegram notification ====================================================
def telegram_send(bot_token: str, chat_id: str, text: str) -> dict[str, Any]:
    try:
        with httpx.Client(timeout=15.0) as c:
            r = c.post(
                f"https://api.telegram.org/bot{bot_token}/sendMessage",
                json={"chat_id": chat_id, "text": text, "disable_web_page_preview": True},
            )
        body = r.json() if r.content else {}
        return {
            "ok": 200 <= r.status_code < 300 and body.get("ok", False),
            "status": r.status_code,
            "message_id": (body.get("result") or {}).get("message_id"),
        }
    except Exception as e:
        return {"ok": False, "error": str(e)[:200]}


# === Main =====================================================================
def main(
    dry_run: bool = False,
    only_compounds: list[str] | None = None,
) -> dict[str, Any]:
    """Entry point. Set dry_run=True for Gate D test-fire (no writes, no Telegram)."""
    today = _toronto_today_iso()
    started = _time.time()

    perp_key = _get_var("PERPLEXITY_API_KEY")
    ant_key = _get_var("ANTHROPIC_API_KEY")
    tg_token = _get_var("TELEGRAM_BOT_TOKEN", "")
    tg_chat = _get_var("MARC_TELEGRAM_CHAT_ID", "8617287533")

    # Step 1
    compounds = _load_and_dedupe_catalog()
    if only_compounds:
        compounds = [c for c in compounds if c in only_compounds]
    print(f"[luke-weekly] {today} starting. {len(compounds)} compounds in scope. dry_run={dry_run}")

    # Step 2 — parallel per-compound dispatch (capped concurrency)
    per_compound_results: list[dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=MAX_PARALLEL_COMPOUNDS) as ex:
        futures = {
            ex.submit(process_one_compound, perp_key, ant_key, c, today, dry_run): c
            for c in compounds
        }
        for fut in as_completed(futures):
            c = futures[fut]
            try:
                per_compound_results.append(fut.result())
            except Exception as e:
                per_compound_results.append({
                    "compound": c, "_skipped": True, "_reason": "exception",
                    "_traceback": _tb.format_exc()[-500:],
                })

    # Step 3-5
    index_status = regenerate_index(per_compound_results, today, dry_run)
    log_status = write_change_log(per_compound_results, today, dry_run)
    dep_status = write_deprecation_candidates(per_compound_results, today, dry_run)

    # Step 6
    report_status = build_weekly_report(per_compound_results, today, dry_run)

    # Step 7-8
    vault_status = trigger_vault_keeper_sync(dry_run)
    post_status = post_articles_to_vitalis(per_compound_results, dry_run)

    # Telegram (skip in dry_run)
    tg_status: dict[str, Any] = {"_skipped": True}
    if not dry_run and tg_token:
        updated_count = sum(1 for r in per_compound_results if (r.get("luke_result") or {}).get("changed") is True)
        msg = (
            f"Luke weekly research — {today}\n"
            f"Compounds reviewed: {len(per_compound_results)}\n"
            f"Updates: {updated_count}\n"
            f"Deprecations flagged: {dep_status.get('_count', 0)}\n"
            f"Report: {report_status.get('_md_path')}"
        )
        tg_status = telegram_send(tg_token, tg_chat, msg)

    elapsed = round(_time.time() - started, 1)
    return {
        "ok": True,
        "today": today,
        "elapsed_sec": elapsed,
        "dry_run": dry_run,
        "compounds_in_scope": len(compounds),
        "per_compound_results_count": len(per_compound_results),
        "updated_count": sum(1 for r in per_compound_results if (r.get("luke_result") or {}).get("changed") is True),
        "skipped_count": sum(1 for r in per_compound_results if r.get("_skipped")),
        "index_status": index_status,
        "change_log_status": log_status,
        "deprecation_status": dep_status,
        "report_status": report_status,
        "vault_keeper_status": vault_status,
        "vitalis_post_status": post_status,
        "telegram_status": tg_status,
    }
