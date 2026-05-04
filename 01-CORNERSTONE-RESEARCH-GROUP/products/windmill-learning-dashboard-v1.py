"""
Windmill Script: u/admin/learning_dashboard_v1

CRG M-025 LEARNING DASHBOARD — The Moat (real-time aggregation API)

Per-client dashboard data feed: call metrics, script performance, lead-quality
scoring, ROI curve, cohort comparisons. Returns JSON consumed by the Netlify
dashboard frontend (crg-learning-dashboard.netlify.app).

This is the moat: every outcome aggregated here trains the
client-specific model so switching to a competitor costs months of learning.

Signature: main(client_id, ghl_location_id, ghl_location_token, lookback_days=90)

Returns: {
  client_id, generated_at, lookback_days,
  metrics: { calls, contacts, opportunities, won_revenue, avg_close_rate },
  scripts: { top_performing, lowest_performing, best_objection_handlers },
  cohort: { peer_p25_close_rate, peer_p50, peer_p75, your_position },
  trend: [ { date, calls, qualifications, wins, revenue } ],
  lead_quality_buckets: { hot, warm, cold, dead },
  recommendations: [ str ]
}

Called by: Netlify function (dashboard-data.js) via POST.
"""

import requests
import json
from datetime import datetime, timedelta, timezone
from collections import defaultdict
from typing import Dict, List, Any

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


# ─── CONFIG ────────────────────────────────────────────────────────────────
GHL_API_BASE = "https://services.leadconnectorhq.com"
OPENAI_KEY = _get_secret("OPENAI_API_KEY")

# Cohort baselines (industry-typical numbers used until we have ≥10 paying clients)
# These get replaced with rolling p25/p50/p75 once the cohort grows.
COHORT_DEFAULTS = {
    "real-estate":          {"p25": 0.04, "p50": 0.08, "p75": 0.14},
    "financial-advisor":    {"p25": 0.06, "p50": 0.11, "p75": 0.18},
    "mortgage":             {"p25": 0.05, "p50": 0.09, "p75": 0.16},
    "peptide":              {"p25": 0.10, "p50": 0.18, "p75": 0.30},
    "default":              {"p25": 0.05, "p50": 0.10, "p75": 0.18},
}


def main(
    client_id: str,
    ghl_location_id: str = "",
    ghl_location_token: str = "",
    industry: str = "real-estate",
    lookback_days: int = 90,
    demo_mode: bool = False,
):
    """
    Aggregate dashboard data for one client.
    If demo_mode=True or GHL creds missing, returns synthetic baseline data
    suitable for prospect demos and the public dashboard URL.
    """

    generated_at = datetime.now(timezone.utc).isoformat()

    # ── Pull raw data from GHL (or synthesize for demo) ───────────────────
    if demo_mode or not ghl_location_id or not ghl_location_token:
        contacts, opportunities, calls = synthesize_demo_data(lookback_days)
        data_source = "demo"
    else:
        try:
            contacts = ghl_fetch_contacts(ghl_location_id, ghl_location_token, lookback_days)
            opportunities = ghl_fetch_opportunities(ghl_location_id, ghl_location_token, lookback_days)
            calls = ghl_fetch_call_logs(ghl_location_id, ghl_location_token, lookback_days)
            data_source = "live"
        except Exception as e:
            # Fall back gracefully — don't 500 the dashboard
            contacts, opportunities, calls = synthesize_demo_data(lookback_days)
            data_source = f"fallback (GHL error: {str(e)[:80]})"

    # ── Compute headline metrics ──────────────────────────────────────────
    total_calls = len(calls)
    total_contacts = len(contacts)
    total_opps = len(opportunities)
    won_opps = [o for o in opportunities if o.get("status") == "won"]
    won_revenue = sum(float(o.get("monetaryValue", 0) or 0) for o in won_opps)
    close_rate = (len(won_opps) / total_opps) if total_opps else 0

    # ── Script performance attribution (tags on contacts) ─────────────────
    script_perf = analyze_script_performance(contacts, opportunities)

    # ── Lead quality buckets ──────────────────────────────────────────────
    lead_buckets = bucket_leads(contacts)

    # ── Trend (last N weeks) ──────────────────────────────────────────────
    trend = compute_trend(contacts, opportunities, calls, lookback_days)

    # ── Cohort positioning ────────────────────────────────────────────────
    cohort = COHORT_DEFAULTS.get(industry, COHORT_DEFAULTS["default"])
    your_position = position_in_cohort(close_rate, cohort)

    # ── AI recommendations (cheap, single GPT-4o call) ────────────────────
    recommendations = generate_recommendations(
        close_rate=close_rate,
        cohort=cohort,
        script_perf=script_perf,
        won_revenue=won_revenue,
        total_calls=total_calls,
        industry=industry,
    )

    return {
        "client_id": client_id,
        "generated_at": generated_at,
        "lookback_days": lookback_days,
        "data_source": data_source,
        "industry": industry,
        "metrics": {
            "calls": total_calls,
            "contacts": total_contacts,
            "opportunities": total_opps,
            "wins": len(won_opps),
            "won_revenue": round(won_revenue, 2),
            "close_rate": round(close_rate, 4),
            "revenue_per_call": round(won_revenue / total_calls, 2) if total_calls else 0,
        },
        "scripts": script_perf,
        "cohort": {
            "industry": industry,
            "peer_p25_close_rate": cohort["p25"],
            "peer_p50_close_rate": cohort["p50"],
            "peer_p75_close_rate": cohort["p75"],
            "your_close_rate": round(close_rate, 4),
            "your_position": your_position,
        },
        "trend": trend,
        "lead_quality_buckets": lead_buckets,
        "recommendations": recommendations,
        "moat_message": (
            f"Your model has {lookback_days} days of learning across "
            f"{total_calls} calls and {total_contacts} contacts. "
            "Switching providers resets this to zero."
        ),
    }


# ─── DEMO DATA SYNTHESIZER ─────────────────────────────────────────────────

def synthesize_demo_data(lookback_days: int):
    """
    Returns realistic synthetic contacts/opps/calls for the public demo dashboard.
    Uses a reproducible distribution so prospects always see the same numbers.
    """
    import random
    random.seed(42)

    contacts = []
    opportunities = []
    calls = []
    sources = ["script-engine", "vapi-qualifier", "ai-bdm"]
    today = datetime.now(timezone.utc)

    for i in range(157):
        days_ago = random.randint(0, lookback_days)
        contact_date = (today - timedelta(days=days_ago)).isoformat()
        source = random.choice(sources)
        tags = [f"crg-lead-source:{source}"]
        if random.random() < 0.45:
            tags.append("ai-qualified")
        score = random.choices(["hot", "warm", "cold", "dead"], weights=[0.18, 0.28, 0.34, 0.20])[0]
        tags.append(f"score:{score}")

        contacts.append({
            "id": f"contact_{i}",
            "tags": tags,
            "dateAdded": contact_date,
            "score": score,
            "source": source,
        })

        # ~60% of contacts spawn an opportunity
        if random.random() < 0.60:
            opp_status = random.choices(["won", "lost", "open"], weights=[0.11, 0.39, 0.50])[0]
            opportunities.append({
                "id": f"opp_{i}",
                "status": opp_status,
                "monetaryValue": random.choice([12000, 18000, 25000, 35000, 8500]) if opp_status == "won" else 0,
                "contactId": f"contact_{i}",
                "dateClosed": contact_date if opp_status != "open" else None,
                "source": source,
            })

    for i in range(412):
        days_ago = random.randint(0, lookback_days)
        call_date = (today - timedelta(days=days_ago)).isoformat()
        outcome = random.choices(["connected", "voicemail", "no-answer", "booked"],
                                  weights=[0.32, 0.28, 0.30, 0.10])[0]
        calls.append({
            "id": f"call_{i}",
            "outcome": outcome,
            "duration_sec": random.randint(15, 480),
            "dateAdded": call_date,
        })

    return contacts, opportunities, calls


# ─── GHL DATA FETCHERS ─────────────────────────────────────────────────────

def ghl_fetch_contacts(location_id: str, token: str, lookback_days: int) -> List[Dict]:
    since = (datetime.now(timezone.utc) - timedelta(days=lookback_days)).strftime("%Y-%m-%d")
    url = f"{GHL_API_BASE}/contacts/search"
    headers = {
        "Authorization": f"Bearer {token}",
        "Version": "2021-07-28",
        "Content-Type": "application/json",
    }
    body = {
        "locationId": location_id,
        "pageLimit": 100,
        "filters": [{"field": "dateAdded", "operator": "gte", "value": since}],
    }
    resp = requests.post(url, headers=headers, json=body, timeout=20)
    if resp.status_code != 200:
        raise Exception(f"GHL contacts: HTTP {resp.status_code}")
    return resp.json().get("contacts", [])


def ghl_fetch_opportunities(location_id: str, token: str, lookback_days: int) -> List[Dict]:
    since = (datetime.now(timezone.utc) - timedelta(days=lookback_days)).strftime("%Y-%m-%d")
    url = f"{GHL_API_BASE}/opportunities/search"
    headers = {
        "Authorization": f"Bearer {token}",
        "Version": "2021-07-28",
    }
    params = {"location_id": location_id, "limit": 100, "date": since}
    resp = requests.get(url, headers=headers, params=params, timeout=20)
    if resp.status_code != 200:
        raise Exception(f"GHL opportunities: HTTP {resp.status_code}")
    return resp.json().get("opportunities", [])


def ghl_fetch_call_logs(location_id: str, token: str, lookback_days: int) -> List[Dict]:
    # GHL doesn't have a clean call-log endpoint; conversations endpoint is the proxy.
    since = (datetime.now(timezone.utc) - timedelta(days=lookback_days)).strftime("%Y-%m-%d")
    url = f"{GHL_API_BASE}/conversations/search"
    headers = {
        "Authorization": f"Bearer {token}",
        "Version": "2021-04-15",
    }
    params = {"locationId": location_id, "limit": 100, "type": "phone"}
    try:
        resp = requests.get(url, headers=headers, params=params, timeout=20)
        if resp.status_code != 200:
            return []
        return resp.json().get("conversations", [])
    except Exception:
        return []


# ─── ANALYTICS ─────────────────────────────────────────────────────────────

def analyze_script_performance(contacts: List[Dict], opportunities: List[Dict]) -> Dict:
    """Group opportunities by lead source tag, compute close rate per script source."""
    source_stats = defaultdict(lambda: {"contacts": 0, "wins": 0, "revenue": 0.0})
    contact_to_source = {}

    for c in contacts:
        for tag in c.get("tags", []):
            if tag.startswith("crg-lead-source:"):
                source = tag.split(":", 1)[1]
                contact_to_source[c["id"]] = source
                source_stats[source]["contacts"] += 1
                break

    for opp in opportunities:
        cid = opp.get("contactId")
        source = contact_to_source.get(cid)
        if not source:
            continue
        if opp.get("status") == "won":
            source_stats[source]["wins"] += 1
            source_stats[source]["revenue"] += float(opp.get("monetaryValue", 0) or 0)

    out = []
    for source, s in source_stats.items():
        close = (s["wins"] / s["contacts"]) if s["contacts"] else 0
        out.append({
            "source": source,
            "contacts": s["contacts"],
            "wins": s["wins"],
            "revenue": round(s["revenue"], 2),
            "close_rate": round(close, 4),
        })
    out.sort(key=lambda x: x["close_rate"], reverse=True)

    return {
        "by_source": out,
        "top_performing": out[0]["source"] if out else None,
        "lowest_performing": out[-1]["source"] if len(out) > 1 else None,
    }


def bucket_leads(contacts: List[Dict]) -> Dict[str, int]:
    buckets = {"hot": 0, "warm": 0, "cold": 0, "dead": 0}
    for c in contacts:
        score = c.get("score")
        if not score:
            for tag in c.get("tags", []):
                if tag.startswith("score:"):
                    score = tag.split(":", 1)[1]
                    break
        if score in buckets:
            buckets[score] += 1
        else:
            buckets["cold"] += 1
    return buckets


def compute_trend(contacts, opportunities, calls, lookback_days: int) -> List[Dict]:
    """Bucket activity by week for the trend chart."""
    today = datetime.now(timezone.utc).date()
    weeks = max(1, lookback_days // 7)
    by_week = defaultdict(lambda: {"calls": 0, "contacts": 0, "wins": 0, "revenue": 0.0})

    def parse_date(s):
        if not s:
            return None
        try:
            return datetime.fromisoformat(s.replace("Z", "+00:00")).date()
        except Exception:
            return None

    for c in contacts:
        d = parse_date(c.get("dateAdded"))
        if d:
            week_idx = (today - d).days // 7
            if 0 <= week_idx < weeks:
                by_week[week_idx]["contacts"] += 1

    for o in opportunities:
        if o.get("status") != "won":
            continue
        d = parse_date(o.get("dateClosed"))
        if d:
            week_idx = (today - d).days // 7
            if 0 <= week_idx < weeks:
                by_week[week_idx]["wins"] += 1
                by_week[week_idx]["revenue"] += float(o.get("monetaryValue", 0) or 0)

    for ca in calls:
        d = parse_date(ca.get("dateAdded"))
        if d:
            week_idx = (today - d).days // 7
            if 0 <= week_idx < weeks:
                by_week[week_idx]["calls"] += 1

    out = []
    for w in range(weeks):
        wk_start = (today - timedelta(days=(w + 1) * 7)).isoformat()
        out.append({
            "week_start": wk_start,
            "calls": by_week[w]["calls"],
            "contacts": by_week[w]["contacts"],
            "wins": by_week[w]["wins"],
            "revenue": round(by_week[w]["revenue"], 2),
        })
    out.reverse()  # oldest -> newest for chart
    return out


def position_in_cohort(your_rate: float, cohort: Dict) -> str:
    if your_rate >= cohort["p75"]:
        return "top quartile"
    if your_rate >= cohort["p50"]:
        return "above median"
    if your_rate >= cohort["p25"]:
        return "below median"
    return "bottom quartile"


def generate_recommendations(close_rate, cohort, script_perf, won_revenue, total_calls, industry) -> List[str]:
    """Cheap, deterministic recommendations. Avoids paying for an LLM call on every dashboard load."""
    recs = []

    if close_rate < cohort["p25"]:
        recs.append(
            f"Your {round(close_rate*100,1)}% close rate trails the {industry} cohort p25 "
            f"({round(cohort['p25']*100,1)}%). Run a Script Evaluator pass on your top objection."
        )
    elif close_rate < cohort["p50"]:
        recs.append(
            f"Close rate is below median for {industry}. Review your top 3 lost-deal scripts in the AI Script Engine."
        )
    else:
        recs.append(
            f"Close rate is in the {position_in_cohort(close_rate, cohort)} for {industry}. Push more calls — your funnel converts."
        )

    if total_calls < 50:
        recs.append("Call volume is low. The model needs ≥100 calls/quarter to reach predictive accuracy.")

    by_source = script_perf.get("by_source", [])
    if len(by_source) >= 2:
        top = by_source[0]
        bottom = by_source[-1]
        if top["close_rate"] >= bottom["close_rate"] * 1.5:
            recs.append(
                f"Lead source '{top['source']}' converts {round(top['close_rate']*100,1)}% vs. "
                f"'{bottom['source']}' at {round(bottom['close_rate']*100,1)}%. Reallocate budget to '{top['source']}'."
            )

    if won_revenue > 0 and total_calls > 0:
        rev_per_call = won_revenue / total_calls
        recs.append(f"You're generating ${round(rev_per_call,2)} of attributed revenue per call. Use this to justify scaling outbound minutes.")

    return recs[:5]
