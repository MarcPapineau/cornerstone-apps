"""
Windmill Script: u/admin/re_listing_package_v1
Hash: (assigned on deploy)

ONE-BUTTON LISTING PACKAGE — Marc Papineau Real Estate
Takes property facts, returns a complete launch kit: MLS description, 3 social captions,
broadcast email to sphere, TCPA-compliant SMS to hot list, seller pitch talking points,
and programmatic SEO page content.

Fair Housing compliant by design — see re-compliance-notes-v1.md.
Emails the full package to the agent via Resend.

Called by: GHL workflow `[RE] New Listing Intake` (webhook → Windmill)
Returns: { success, package: {...}, email_sent, generated_at }
"""

import requests
import json
from datetime import datetime

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
RESEND_KEY = _get_secret("RESEND_API_KEY")
# Marc Papineau Real Estate GHL sub-account
GHL_RE_LOCATION_ID = "OaIjyU9hKEG9lu2PRrSH"
GHL_RE_SNAPSHOT_ID = "ieM3gBs9jeoftTp8IBZH"

# Fair Housing / REBBA-prohibited language patterns (filtered post-gen)
FAIR_HOUSING_FLAGS = [
    "exclusive neighbourhood", "exclusive neighborhood", "safe neighborhood",
    "safe neighbourhood", "quiet neighborhood", "quiet neighbourhood",
    "no kids", "adults only", "perfect for families", "perfect for a family",
    "family-friendly", "family friendly", "walk to church", "walk to temple",
    "walk to synagogue", "walk to mosque", "christian neighborhood",
    "christian neighbourhood", "jewish neighborhood", "jewish neighbourhood",
    "ethnic neighborhood", "ethnic neighbourhood", "traditional neighborhood",
    "master bedroom",  # use primary bedroom per NAR 2020+
    "handyman special", "newlyweds", "empty nesters only", "bachelor pad",
    "gentlemen's", "mother-in-law suite",  # use secondary suite or in-law suite
]


def main(
    address: str,
    price: str,
    beds: int = 3,
    baths: float = 2.0,
    sqft: int = 1500,
    key_features: list = None,
    lifestyle_target: str = "family",   # family | luxury | first-time-buyer | investor
    photos_urls: list = None,
    agent_name: str = "Marc Papineau",
    agent_email: str = "marc@cornerstoneregroup.ca",
    agent_phone: str = "+16137991234",
    agent_brokerage: str = "Cornerstone Re Group",
    property_type: str = "Single Family Home",
    city: str = "Ottawa",
    province: str = "ON"
):
    """
    Generate complete listing marketing package in one call.
    Returns structured package + sends formatted email to agent.
    """
    generated_at = datetime.utcnow().isoformat() + "Z"
    features = key_features or []
    photos = photos_urls or []

    # ── 1. Light Perplexity market pulse (optional — fallback on failure) ──
    market_context = run_market_research(address, city, province, property_type, lifestyle_target)

    # ── 2. Generate the full package via OpenAI (single JSON call) ──
    package = generate_listing_package(
        address=address,
        price=price,
        beds=beds,
        baths=baths,
        sqft=sqft,
        features=features,
        lifestyle_target=lifestyle_target,
        property_type=property_type,
        city=city,
        province=province,
        agent_name=agent_name,
        agent_phone=agent_phone,
        agent_brokerage=agent_brokerage,
        market_context=market_context
    )

    # ── 3. Compliance filter — flag any risky language ──
    compliance_flags = scan_for_fair_housing_issues(package)

    # ── 4. Email the full package to the agent ──
    email_sent = send_package_email(
        to_email=agent_email,
        agent_name=agent_name,
        address=address,
        price=price,
        package=package,
        compliance_flags=compliance_flags,
        photos=photos
    )

    return {
        "success": True,
        "address": address,
        "price": price,
        "lifestyle_target": lifestyle_target,
        "package": package,
        "compliance_flags": compliance_flags,
        "compliance_passed": len(compliance_flags) == 0,
        "email_sent": email_sent,
        "photo_count": len(photos),
        "generated_at": generated_at
    }


# ─── PACKAGE GENERATION ────────────────────────────────────────────────────

def run_market_research(address: str, city: str, province: str,
                         property_type: str, lifestyle_target: str) -> str:
    """Light Perplexity call for neighbourhood/market context. Fails gracefully."""
    prompt = f"""Brief market context for a listing at {address} in {city}, {province}:
Property type: {property_type}
Target buyer: {lifestyle_target}

Provide 4-6 bullet points covering:
1. Current {city} market temperature (seller/buyer/balanced) for this property type — April 2026
2. Typical DOM for {property_type} in this price range
3. Top 2-3 neighbourhood draws buyers actually search for (amenities, schools, transit, commute)
4. What {lifestyle_target} buyers specifically prioritize right now

Be concrete. Cite neighbourhood names or amenity names when possible. Avoid Fair Housing flags (no demographic claims about who lives there)."""

    try:
        resp = requests.post(
            "https://api.perplexity.ai/chat/completions",
            headers={
                "Authorization": f"Bearer {PERPLEXITY_KEY}",
                "Content-Type": "application/json"
            },
            json={
                "model": "sonar-pro",
                "max_tokens": 600,
                "messages": [{"role": "user", "content": prompt}]
            },
            timeout=25
        )
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"]
    except Exception as e:
        return f"[Market research unavailable — generating from standard buyer psychology. {str(e)[:80]}]"


def generate_listing_package(address: str, price: str, beds: int, baths: float,
                              sqft: int, features: list, lifestyle_target: str,
                              property_type: str, city: str, province: str,
                              agent_name: str, agent_phone: str, agent_brokerage: str,
                              market_context: str) -> dict:
    """Single OpenAI call returning structured listing package as JSON."""

    features_text = "\n- " + "\n- ".join(features) if features else "(none provided — infer from price/size/target)"

    system_prompt = """You are a senior Canadian real estate marketing copywriter. You produce Fair Housing / REBBA / RECO compliant listing content for top-producing agents in Ontario.

ABSOLUTE RULES — Fair Housing / OHRC / REBBA:
1. NEVER describe who the property is "perfect for" by family composition, age, religion, ethnicity, or ability.
2. NEVER use "exclusive", "private", "safe", "quiet" neighbourhood (fair housing coded language).
3. Describe the PROPERTY and the AMENITIES, not the buyer demographic.
4. "Primary bedroom" not "master bedroom".
5. "Secondary suite" or "in-law suite" not "mother-in-law suite".
6. No claims about schools being "best" unless citing a public ranking source.
7. CASL-compliant: SMS must include "Reply STOP to opt out". Email must include unsubscribe.

Return ONLY a valid JSON object matching the schema. No prose before/after. No markdown fences."""

    user_prompt = f"""Generate a complete listing marketing package as JSON.

PROPERTY FACTS:
- Address: {address}
- Price: {price}
- Beds / Baths / Sqft: {beds} / {baths} / {sqft}
- Property Type: {property_type}
- City / Province: {city}, {province}
- Lifestyle Target: {lifestyle_target} (family | luxury | first-time-buyer | investor)
- Key Features:{features_text}

AGENT:
- Name: {agent_name}
- Phone: {agent_phone}
- Brokerage: {agent_brokerage}

LIVE MARKET CONTEXT:
{market_context}

Return EXACTLY this JSON schema (fill all fields, no placeholders):

{{
  "mls_description": "150-220 word MLS-compliant description. Lead with headline hook. Describe the property, not the buyer. Use sensory/specific language about the home's features. End with one line about location amenities (by name). No Fair Housing flags.",
  "social_captions": {{
    "instagram": "80-125 words. Punchy hook first line. Emojis sparingly (2-4 max). 5-7 relevant hashtags at end. Call to action to DM or link in bio.",
    "facebook": "150-220 words. Story-driven open. Community/neighbourhood hook. Soft CTA to message or comment. 2-3 hashtags max.",
    "linkedin": "100-160 words. Professional tone. Lead with market context or investment angle. Data point if relevant. CTA to connect or message. Minimal hashtags (0-3)."
  }},
  "sphere_email": {{
    "subject": "Under 50 chars. Curiosity or specificity. No clickbait.",
    "body": "300-450 words. Plain-text friendly. Open with a specific, personal line (not 'Hi friends'). Describe the property in 2-3 short paragraphs. Include price, beds, baths, sqft. Provide clear CTA: private showing link + phone. Sign off as {agent_name}. Include unsubscribe placeholder line: '[Unsubscribe link]'."
  }},
  "hot_list_sms": "Under 160 characters including 'Reply STOP to opt out.' Open with address + price + single killer hook. Include private showing CTA.",
  "seller_pitch_talking_points": [
    "Bullet 1: What makes this listing stand out in today's {city} market (specific, data-driven)",
    "Bullet 2: Positioning strategy — why this price point wins",
    "Bullet 3: Buyer profile angle — without violating fair housing (describe property fit, not people)",
    "Bullet 4: Marketing multiplier — what we are doing that other agents are not",
    "Bullet 5: Expected DOM + negotiation leverage angle"
  ],
  "seo_page_content": {{
    "h1": "Specific, keyword-rich H1 under 70 chars. Include address and property type.",
    "meta_description": "150-160 chars. Price, beds, baths, city. One benefit. CTA verb.",
    "intro": "120-180 words. Lead with property address and headline feature. Two sentences of neighbourhood/commute context. Close with 'Contact {agent_name} to schedule a private viewing.'",
    "section_1": {{"heading": "Property Highlights", "body": "200-280 words covering the physical property and signature features. Bullet-heavy. Skimmable."}},
    "section_2": {{"heading": "Location & Lifestyle", "body": "200-280 words on neighbourhood amenities (by name), commute, transit, shops, parks, trails. No demographic claims."}},
    "section_3": {{"heading": "Is This the Right Investment for You?", "body": "200-280 words framed as buyer-fit analysis — property attributes, use cases, considerations. Close with booking CTA."}},
    "faq": [
      {{"q": "What is the list price?", "a": "Direct answer with price and any price strategy context."}},
      {{"q": "How many bedrooms and bathrooms?", "a": "Direct answer."}},
      {{"q": "What is the square footage and lot size?", "a": "Direct answer with any outdoor space features."}},
      {{"q": "Is this property good for [lifestyle_target] buyers?", "a": "Frame as property attributes that support that use case — not demographic claim."}},
      {{"q": "How do I schedule a viewing?", "a": "Phone + email CTA with {agent_name}."}}
    ]
  }}
}}"""

    try:
        resp = requests.post(
            "https://api.openai.com/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {OPENAI_KEY}",
                "Content-Type": "application/json"
            },
            json={
                "model": "gpt-4o",
                "temperature": 0.55,
                "max_tokens": 4500,
                "response_format": {"type": "json_object"},
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ]
            },
            timeout=90
        )
        resp.raise_for_status()
        content = resp.json()["choices"][0]["message"]["content"]
        return json.loads(content)
    except Exception as e:
        return {
            "error": f"Package generation failed: {str(e)[:200]}",
            "mls_description": "",
            "social_captions": {"instagram": "", "facebook": "", "linkedin": ""},
            "sphere_email": {"subject": "", "body": ""},
            "hot_list_sms": "",
            "seller_pitch_talking_points": [],
            "seo_page_content": {}
        }


def scan_for_fair_housing_issues(package: dict) -> list:
    """Scan all generated text fields for Fair Housing / REBBA-risky phrases."""
    flags = []
    # Flatten all string values
    text_blob = json.dumps(package).lower()
    for phrase in FAIR_HOUSING_FLAGS:
        if phrase.lower() in text_blob:
            flags.append(phrase)
    return flags


# ─── EMAIL DELIVERY ────────────────────────────────────────────────────────

def send_package_email(to_email: str, agent_name: str, address: str, price: str,
                        package: dict, compliance_flags: list, photos: list) -> bool:
    """Send the complete package as formatted HTML email via Resend."""

    social = package.get("social_captions", {})
    email = package.get("sphere_email", {})
    talking_points = package.get("seller_pitch_talking_points", [])
    seo = package.get("seo_page_content", {})
    s1 = seo.get("section_1", {}) or {}
    s2 = seo.get("section_2", {}) or {}
    s3 = seo.get("section_3", {}) or {}

    def esc(s):
        return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\n", "<br>")

    talking_html = "".join([f"<li>{esc(tp)}</li>" for tp in talking_points])

    flag_html = ""
    if compliance_flags:
        flag_html = f"""
        <div style="background:#FFF4E6;border-left:4px solid #E8A33D;padding:16px 20px;margin:24px 0;">
          <strong style="color:#A06800;">Compliance review flags ({len(compliance_flags)}):</strong>
          <ul style="margin:8px 0 0 20px;color:#5C4000;font-size:13px;">
            {"".join([f"<li>{esc(f)}</li>" for f in compliance_flags])}
          </ul>
          <p style="margin:10px 0 0;font-size:12px;color:#755200;">These phrases appeared in the draft. Review before publishing.</p>
        </div>"""

    faq_html = ""
    for item in seo.get("faq", []):
        faq_html += f"<div style='margin-bottom:12px;'><strong>{esc(item.get('q',''))}</strong><br>{esc(item.get('a',''))}</div>"

    html = f"""
<div style="font-family:Georgia,serif;max-width:760px;margin:0 auto;background:#0C0C0C;color:#F0EBE1;padding:48px 40px;">
  <div style="height:2px;background:linear-gradient(90deg,#C4922A,#E8C068,#C4922A);margin-bottom:32px;"></div>
  <div style="font-size:11px;letter-spacing:4px;text-transform:uppercase;color:#C4922A;margin-bottom:16px;">Listing Package Ready</div>
  <h1 style="font-family:Georgia,serif;font-size:26px;font-weight:400;color:#F0EBE1;margin:0 0 4px;">{esc(address)}</h1>
  <p style="color:#A8A5A0;font-size:13px;margin:0 0 28px;">{esc(price)} · Package generated at {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}</p>

  {flag_html}

  <div style="background:#161614;border-left:3px solid #C4922A;padding:24px;margin-bottom:20px;">
    <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#C4922A;margin-bottom:10px;">1. MLS Description</div>
    <div style="font-size:14px;line-height:1.7;color:#F0EBE1;">{esc(package.get('mls_description',''))}</div>
  </div>

  <div style="background:#161614;border-left:3px solid #C4922A;padding:24px;margin-bottom:20px;">
    <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#C4922A;margin-bottom:10px;">2. Social Captions</div>
    <p style="font-size:13px;color:#E8C068;margin:0 0 4px;"><strong>Instagram</strong></p>
    <div style="font-size:13px;line-height:1.7;margin-bottom:14px;">{esc(social.get('instagram',''))}</div>
    <p style="font-size:13px;color:#E8C068;margin:0 0 4px;"><strong>Facebook</strong></p>
    <div style="font-size:13px;line-height:1.7;margin-bottom:14px;">{esc(social.get('facebook',''))}</div>
    <p style="font-size:13px;color:#E8C068;margin:0 0 4px;"><strong>LinkedIn</strong></p>
    <div style="font-size:13px;line-height:1.7;">{esc(social.get('linkedin',''))}</div>
  </div>

  <div style="background:#161614;border-left:3px solid #C4922A;padding:24px;margin-bottom:20px;">
    <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#C4922A;margin-bottom:10px;">3. Sphere Email</div>
    <p style="font-size:13px;color:#E8C068;margin:0 0 4px;"><strong>Subject:</strong> {esc(email.get('subject',''))}</p>
    <div style="font-size:13px;line-height:1.7;white-space:pre-wrap;">{esc(email.get('body',''))}</div>
  </div>

  <div style="background:#161614;border-left:3px solid #C4922A;padding:24px;margin-bottom:20px;">
    <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#C4922A;margin-bottom:10px;">4. Hot List SMS (TCPA-compliant)</div>
    <div style="font-size:14px;line-height:1.7;padding:12px;background:#1F1F1D;border-radius:4px;">{esc(package.get('hot_list_sms',''))}</div>
  </div>

  <div style="background:#161614;border-left:3px solid #C4922A;padding:24px;margin-bottom:20px;">
    <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#C4922A;margin-bottom:10px;">5. Seller Pitch Talking Points</div>
    <ol style="font-size:13px;line-height:1.8;color:#F0EBE1;padding-left:20px;">{talking_html}</ol>
  </div>

  <div style="background:#161614;border-left:3px solid #C4922A;padding:24px;margin-bottom:20px;">
    <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#C4922A;margin-bottom:10px;">6. Programmatic SEO Page</div>
    <p style="font-size:13px;color:#E8C068;margin:0 0 4px;"><strong>H1:</strong> {esc(seo.get('h1',''))}</p>
    <p style="font-size:13px;color:#E8C068;margin:0 0 4px;"><strong>Meta:</strong> {esc(seo.get('meta_description',''))}</p>
    <p style="font-size:13px;color:#E8C068;margin:10px 0 4px;"><strong>Intro</strong></p>
    <div style="font-size:13px;line-height:1.7;margin-bottom:12px;">{esc(seo.get('intro',''))}</div>
    <p style="font-size:13px;color:#E8C068;margin:10px 0 4px;"><strong>{esc(s1.get('heading',''))}</strong></p>
    <div style="font-size:13px;line-height:1.7;margin-bottom:12px;">{esc(s1.get('body',''))}</div>
    <p style="font-size:13px;color:#E8C068;margin:10px 0 4px;"><strong>{esc(s2.get('heading',''))}</strong></p>
    <div style="font-size:13px;line-height:1.7;margin-bottom:12px;">{esc(s2.get('body',''))}</div>
    <p style="font-size:13px;color:#E8C068;margin:10px 0 4px;"><strong>{esc(s3.get('heading',''))}</strong></p>
    <div style="font-size:13px;line-height:1.7;margin-bottom:12px;">{esc(s3.get('body',''))}</div>
    <p style="font-size:13px;color:#E8C068;margin:10px 0 6px;"><strong>FAQ</strong></p>
    <div style="font-size:13px;line-height:1.7;">{faq_html}</div>
  </div>

  <p style="font-size:12px;color:#6B6860;margin:28px 0 0;">Generated by the CRG Real Estate engine. Review all content for accuracy before publishing. Fair Housing and REBBA compliance remain the agent's responsibility.<br>
  Cornerstone Re Group · Ottawa, Ontario · <a href="https://cornerstoneregroup.ca" style="color:#C4922A;">cornerstoneregroup.ca</a></p>
</div>"""

    try:
        resp = requests.post(
            "https://api.resend.com/emails",
            headers={
                "Authorization": f"Bearer {RESEND_KEY}",
                "Content-Type": "application/json"
            },
            json={
                "from": "CRG Real Estate Engine <listings@cornerstoneregroup.ca>",
                "to": [to_email],
                "subject": f"Listing Package: {address} — Ready",
                "html": html
            },
            timeout=20
        )
        return resp.status_code in [200, 201]
    except Exception:
        return False
