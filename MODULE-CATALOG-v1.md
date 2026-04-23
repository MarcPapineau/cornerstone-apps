# CRG Module Catalog — v1.0
**Date:** 2026-04-17
**Owner:** Marc Papineau (Cornerstone Research Group)
**Scope:** Reverse-engineered catalog of every real, deployable build in
`/Users/marcpapineau/.openclaw/workspace/` as of today. Only shippable modules
are listed. Half-done builds are flagged at the bottom.

---

## HOW TO USE THIS CATALOG

This catalog is the front-end of the CRG productized-services engine. Sales,
customers, and the deploy agent all consume it the same way:

1. **Sales rep / customer** picks 1+ modules for a client.
2. The "Stack" is assembled from the module cards below. Dependencies resolve
   automatically (e.g. adding *AI Call Qualifier* auto-pulls the GHL sub-account
   + Vapi assistant modules if not already staged).
3. The price engine sums one-time + monthly from each card and applies any
   bundle discount from the "Bundles" section.
4. The deploy agent reads the `Files that make it up` block per module and
   pushes them into the client's stack:
   - GHL snapshot → client GHL sub-account (via `windmill-ghl-client-onboard-v1.py`)
   - Windmill scripts → imported into client workspace
   - Netlify sites → cloned + custom-domain'd
   - Vapi assistants → forked from the `vapi-assistant-*.json` templates
5. Deploy time is per-module. An all-in stack is NOT the sum — patterns share
   infrastructure (see PATTERN-LIBRARY-v1.md).

**Reading a card:**
- `Pattern ID` tells you which architectural template it uses. If two modules
  share a Pattern ID, they share the same deploy plumbing.
- `Dependencies` lists other catalog modules that must be deployed first.
- `Status` uses: `LIVE` (in production for a client), `READY` (built, tested,
  not yet sold), `PILOT` (works for Marc only, needs parameterization),
  `BLUEPRINT` (spec'd, not built).

---

## INDUSTRY INDEX

- **Real Estate** — M-001, M-002, M-003, M-007, M-012, M-014
- **Financial Advisors / Mortgage** — M-001, M-002, M-003, M-008, M-012, M-014
- **Peptide / Health / Supplement Clinics** — M-005, M-006, M-013
- **Personal Finance Coaches / Creators** — M-004, M-009
- **Any B2B agency-like client** — M-010, M-011, M-014

---

# INDUSTRY: SALES / OUTREACH (cross-vertical)

---

## M-001 — AI Script Engine (Generator + Evaluator)
**Status:** LIVE
**What it does:** Sales pros submit a form or an existing script; the system
researches their market via Perplexity, writes a compliance-aware custom script
with GPT-4o/Claude, emails the result in minutes, and logs them as a lead.
**Who it's for:** Real estate agents, mortgage brokers, financial advisors —
any outbound sales professional writing cold-call/objection/listing scripts.
**Pattern ID:** `Pattern-FWGV` (Form → Windmill → GHL → Vapi) + `Pattern-StaticNetlifyForm`
**Technical stack:**
- Netlify (static frontend + serverless function proxy)
- Windmill (Python pipeline orchestration)
- Perplexity sonar-pro (research)
- OpenAI GPT-4o / Claude via gateway (generation)
- Resend (email delivery)
- GHL API (CRM contact creation + custom fields + tags)
- Vapi + ElevenLabs (follow-up AI call — optional sibling module M-003)
**Dependencies:** GHL sub-account (M-014), Windmill workspace
**Deploy time:** 6–8 hrs (new client: re-skin HTML, swap GHL location token,
configure Perplexity query verticals, test end-to-end)
**Suggested price:** **$2,500 one-time build + $299/mo** (infra + per-run API
costs amortized; $5 public tripwire or free for retainer clients)
**Files that make it up:**
- `/Users/marcpapineau/.openclaw/workspace/crg-script-generator/index.html`
- `/Users/marcpapineau/.openclaw/workspace/crg-script-generator/netlify/functions/generate-script.js`
- `/Users/marcpapineau/.openclaw/workspace/crg-script-generator/netlify.toml`
- `/Users/marcpapineau/.openclaw/workspace/01-CORNERSTONE-RESEARCH-GROUP/products/windmill-script-generator-v1.py`
- `/Users/marcpapineau/.openclaw/workspace/01-CORNERSTONE-RESEARCH-GROUP/products/script-generator-page_v1.0.html`
- `/Users/marcpapineau/.openclaw/workspace/01-CORNERSTONE-RESEARCH-GROUP/products/script-evaluation-page_v1.0.html`
- `/Users/marcpapineau/.openclaw/workspace/01-CORNERSTONE-RESEARCH-GROUP/products/script-eval-thank-you_v1.0.html`
- `/Users/marcpapineau/.openclaw/workspace/01-CORNERSTONE-RESEARCH-GROUP/products/email-evaluation-template_v1.0.html`
- `/Users/marcpapineau/.openclaw/workspace/01-CORNERSTONE-RESEARCH-GROUP/products/report-template_v1.0.html`
- `/Users/marcpapineau/.openclaw/workspace/01-CORNERSTONE-RESEARCH-GROUP/products/script-engine-app-spec_v2.0.md` (build spec)

---

## M-002 — Script Evaluator (Compliance + Rewrite)
**Status:** LIVE (crg-script-evaluation.netlify.app)
**What it does:** Prospect pastes an existing script; the system returns a
critique, a compliance-aware rewrite, and an alternate "from scratch" version,
all emailed as a branded HTML report.
**Who it's for:** Any licensed salesperson in a regulated industry (RE,
mortgage, insurance, investments) who needs compliance-aware copy review.
**Pattern ID:** `Pattern-FWGV` (shares infra with M-001, but different endpoint
+ Windmill flow + prompt set)
**Technical stack:** Same as M-001 + KRITE (GPT-4o compliance pass) + Ontario
advertising compliance library.
**Dependencies:** M-001 base infra, compliance content pack (M-012)
**Deploy time:** 3–4 hrs to white-label for a new client (copy frontend, swap
branding, swap compliance pack if different jurisdiction)
**Suggested price:** **$1,500 one-time build + $149/mo** (or included as a
seat-bypass for Growth Engine retainers). Public per-use: $5.
**Files that make it up:**
- `/Users/marcpapineau/.openclaw/workspace/01-CORNERSTONE-RESEARCH-GROUP/products/script-evaluation-page_v1.0.html`
- `/Users/marcpapineau/.openclaw/workspace/01-CORNERSTONE-RESEARCH-GROUP/products/marc-papineau-expired-listing-evaluation_v1.0.html`
- `/Users/marcpapineau/.openclaw/workspace/01-CORNERSTONE-RESEARCH-GROUP/products/email-evaluation-template_v1.0.html`
- `/Users/marcpapineau/.openclaw/workspace/01-CRG/compliance/ontario-real-estate-advertising.md`
- `/Users/marcpapineau/.openclaw/workspace/01-CRG/compliance/ontario-mortgage-advertising.md`
- `/Users/marcpapineau/.openclaw/workspace/01-CRG/compliance/ontario-insurance-advertising.md`

---

## M-003 — AI Call Qualifier (Vapi + Voice Clone)
**Status:** LIVE (fires on Script Engine lead; transparent "I'm an AI" pitch)
**What it does:** When a lead fills out your form, within 60 seconds Vapi
places a live AI phone call, runs a 3-question qualifier in your cloned voice,
detects outcome (interested / not_ready / voicemail / no_answer), writes
everything back to GHL, and drops an ElevenLabs-generated voicemail if no
answer.
**Who it's for:** High-ticket sales teams with inbound lead flow — RE,
mortgage, financial advisory, any B2B that wants instant speed-to-lead.
**Pattern ID:** `Pattern-VapiPostLead` (webhook → Vapi trigger → outcome handler → GHL)
**Technical stack:** Vapi (assistant), ElevenLabs (voice clone + voicemail
TTS), Windmill (orchestration), GHL API (custom-field writebacks), Deepgram
(transcription).
**Dependencies:** GHL sub-account (M-014), any lead-source module (M-001,
M-007, M-010), cloned voice (client records 10min audio during onboarding)
**Deploy time:** 8–10 hrs per client (voice clone wait + assistant prompt
tuning + outcome-handler config + GHL custom field creation + number purchase)
**Suggested price:** **$3,500 one-time build + $499/mo** (Vapi call costs
pass-through at cost or included under 500 min/mo)
**Files that make it up:**
- `/Users/marcpapineau/.openclaw/workspace/01-CORNERSTONE-RESEARCH-GROUP/products/vapi-assistant-script-engine-v1.json`
- `/Users/marcpapineau/.openclaw/workspace/01-CORNERSTONE-RESEARCH-GROUP/products/windmill-vapi-outbound-trigger-v1.py`
- `/Users/marcpapineau/.openclaw/workspace/01-CORNERSTONE-RESEARCH-GROUP/products/windmill-vapi-outcome-handler-v1.py`
- `/Users/marcpapineau/.openclaw/workspace/01-CORNERSTONE-RESEARCH-GROUP/products/windmill-elevenlabs-voicemail-drop-v1.py`
- `/Users/marcpapineau/.openclaw/workspace/01-CORNERSTONE-RESEARCH-GROUP/products/ghl-workflow-script-engine-v1.md` (GHL custom-field + tag + automation spec)

---

# INDUSTRY: FINANCIAL ADVISORY / FAMILY OFFICE

---

## M-004 — VaultOS Family Finance Dashboard
**Status:** LIVE (client-side React SPA, used by Marc's family)
**What it does:** Single-login personal-finance operating system — dashboard,
budget, assets (metals + crypto), burn rate, debts, client pipeline, FNA
projector, insurance, "Joseph Score" (custom financial-health index), estate,
and statement export. All data local-first in `localStorage` keyed per user.
**Who it's for:** Financial advisors offering a "family dashboard" to their
clients, high-net-worth families, financial coaches, and Primerica-style
multi-service advisors who want a branded FNA tool.
**Pattern ID:** `Pattern-DashboardLocalStore` (React + Vite + ApexCharts +
`localStorage`) + `Pattern-StaticNetlifyApp`
**Technical stack:** React 18, Vite, TailwindCSS, ApexCharts, Lucide Icons.
No backend. `localStorage` per-user id. Deployable as static Netlify build.
**Dependencies:** None. Optional white-label skin (M-012).
**Deploy time:** 4–6 hrs (new client: swap brand palette, relabel tab set,
re-compute seed defaults, build & deploy to Netlify)
**Suggested price:** **$4,500 one-time build (white-labeled) + $199/mo**
hosting/maintenance. Or licensed to advisor at $49/seat/mo for their clients.
**Files that make it up:**
- `/Users/marcpapineau/.openclaw/workspace/vaultos-app/` (entire app)
- `/Users/marcpapineau/.openclaw/workspace/vaultos-app/src/App.jsx`
- `/Users/marcpapineau/.openclaw/workspace/vaultos-app/src/pages/` (Dashboard, Budget, Assets, BurnRate, Debts, Pipeline, FNA, Insurance, JosephScore, Estate, Statements)
- `/Users/marcpapineau/.openclaw/workspace/vaultos-app/src/utils/` (storage.js, calculations.js)
- `/Users/marcpapineau/.openclaw/workspace/03-FINANCIAL-ADVISORY/pitch/vaultos-business-brief.html`
- `/Users/marcpapineau/.openclaw/workspace/03-FINANCIAL-ADVISORY/pitch/vaultos-investor-deck.html`
- `/Users/marcpapineau/.openclaw/workspace/03-FINANCIAL-ADVISORY/pitch/vaultos-pitch.html`

---

# INDUSTRY: PEPTIDE / HEALTH / SUPPLEMENT CLINIC

---

## M-005 — Vitalis Peptide Research Portal (Client-Facing)
**Status:** LIVE (Netlify Identity gate; React Router multi-page)
**What it does:** Gated peptide education platform — compound library, stack
finder, stack builder, compound matrix, dosing guide, safety/side-effect
database, FAQ, inquiry form. Clients log in via Netlify Identity and browse
the client's curated peptide offerings.
**Who it's for:** Peptide clinics, compound pharmacies, supplement resellers,
biohacking coaches, telehealth providers selling peptide protocols.
**Pattern ID:** `Pattern-GatedReactContent` (React Router + Netlify Identity +
static content data) + `Pattern-StaticNetlifyApp`
**Technical stack:** React 19, React Router 7, Vite, Netlify Identity Widget,
Netlify Functions (light backend for inquiry routing).
**Dependencies:** Content data pack (compounds, dosing, stacks) — client can
supply or use CRG's research base; optional tie-in to M-006 for order mgmt.
**Deploy time:** 8–12 hrs per client (brand skin, content ingest from their
catalog, inquiry form → their CRM/email, Netlify Identity tenant setup)
**Suggested price:** **$6,500 one-time + $349/mo** (white-labeled, includes
content refresh quarterly)
**Files that make it up:**
- `/Users/marcpapineau/.openclaw/workspace/peptide-resource-app/` (primary)
- `/Users/marcpapineau/.openclaw/workspace/04-PEPTIDES/app/peptide-resource-app/` (mirror)
- `/Users/marcpapineau/.openclaw/workspace/peptide-resource-app/src/App.jsx`
- `/Users/marcpapineau/.openclaw/workspace/peptide-resource-app/src/pages/` (14 pages)
- `/Users/marcpapineau/.openclaw/workspace/peptide-resource-app/netlify/functions/`
- `/Users/marcpapineau/.openclaw/workspace/04-PEPTIDES/research/luke_compound_database.json`

---

## M-006 — LUKE Peptide Order & Protocol Ops (Internal)
**Status:** LIVE (internal, Marc's Railway deploy)
**What it does:** Operator back-office — Airtable-backed client + product +
order + protocol + bloodwork records, stack builder with dose-accurate vial
math, Gantt scheduling, per-protocol PDF generation (PDFKit), AI assistance
via OpenClaw. Runs the operational side of a peptide practice.
**Who it's for:** Peptide clinic owners, concierge compound pharmacists, any
operator selling protocol-based products where dosing math must be correct.
**Pattern ID:** `Pattern-ExpressAirtablePDF` (Node + Express + Airtable +
PDFKit + optional LLM call)
**Technical stack:** Node 18, Express 4, Airtable API, PDFKit, node-fetch,
OpenClaw gateway. Deployed on Railway. Playwright test harness included.
**Dependencies:** Airtable base (PRODUCTS, CLIENTS, ORDERS, PROTOCOLS,
BLOODWORK tables), OpenClaw or equivalent LLM gateway.
**Deploy time:** 10–14 hrs per client (Airtable base clone + schema match,
brand skin of the HTML UI, PDFKit template customization, Railway deploy)
**Suggested price:** **$7,500 one-time + $449/mo** (includes Railway hosting,
Airtable license pass-through at cost, PDF template updates)
**Files that make it up:**
- `/Users/marcpapineau/.openclaw/workspace/luke-app/server.js`
- `/Users/marcpapineau/.openclaw/workspace/luke-app/public/index.html`
- `/Users/marcpapineau/.openclaw/workspace/luke-app/package.json`
- `/Users/marcpapineau/.openclaw/workspace/luke-app/railway.toml`
- `/Users/marcpapineau/.openclaw/workspace/luke-app/tests/` (Playwright specs)
- `/Users/marcpapineau/.openclaw/workspace/luke-app/PRODUCT-REQUIREMENTS.md`
- ~~`/Users/marcpapineau/.openclaw/workspace/luke-peptide-app/index.html`~~ — RETIRED AND DELETED 2026-04-21. Archive: ~/Desktop/CRG-Command/05-Archives/luke-peptide-app-2026-04-21.tar.gz
- `/Users/marcpapineau/.openclaw/workspace/04-PEPTIDES/gantt/luke-14day-gantt.html`
- `/Users/marcpapineau/.openclaw/workspace/04-PEPTIDES/gantt/peptide-gantt.html`

---

# INDUSTRY: REAL ESTATE

---

## M-007 — Real Estate CRM Base Stack (GHL Snapshot)
**Status:** READY (blueprint fully speced; snapshot ID issued:
`ieM3gBs9jeoftTp8IBZH` "Marc Papineau Real Estate")
**What it does:** Drops a production-grade real-estate CRM into any client's
GHL sub-account — 3 pipelines (Buyer / Seller / Investor), full tag taxonomy,
28+ custom fields, 7 automations (new-lead, qualification loop, qualified
alert, 60-day nurture, birthday, anniversary, accountability-nag), and 8 drip
campaigns named and scaffolded.
**Who it's for:** Individual RE agents, teams, brokerages that want an
operator-grade CRM without paying a consultant to build from scratch.
**Pattern ID:** `Pattern-GHLSnapshot` (snapshot apply via API on new
sub-account) + `Pattern-CRMBlueprint`
**Technical stack:** GHL Agency Pro (snapshot-capable), Windmill (onboard
script calls GHL API), drip copy library.
**Dependencies:** GHL sub-account provisioning (M-014)
**Deploy time:** 4–6 hrs per client (sub-account create + snapshot apply +
database import + drip copy customization + 1 end-to-end test lead)
**Suggested price:** **$3,500 one-time + $297/mo** (retainer includes drip
copy updates, new-automation requests, monthly performance review)
**Files that make it up:**
- `/Users/marcpapineau/.openclaw/workspace/01-CRG/builds/re-ghl-blueprint_v1.0.md`
- `/Users/marcpapineau/.openclaw/workspace/01-CORNERSTONE-RESEARCH-GROUP/products/windmill-ghl-client-onboard-v1.py`
- `/Users/marcpapineau/.openclaw/workspace/01-CRG/research/drips/drip-master-framework_v1.0.md`
- `/Users/marcpapineau/.openclaw/workspace/01-CRG/research/drips/drip-content-research_v1.0.md`
- `/Users/marcpapineau/.openclaw/workspace/01-CRG/scripts/marc-papineau-script-library_v1.0.md`

---

# INDUSTRY: FINANCIAL ADVISORY (ops)

---

## M-008 — Financial Advisor CRM-OS (GHL Snapshot)
**Status:** READY (offer + pricing + blueprint drafted; snapshot needs
RIA-specific field mapping before sale)
**What it does:** Execution-first CRM Operating System for financial
advisors — 14-stage pipeline, required fields by stage family, intake/
booking/nurture/reactivation automations, reporting dashboard, compliance
templates. Sold as done-for-you: CRG operates, advisor uses.
**Who it's for:** Solo advisors, 2–5 advisor RIA shops, Primerica-style
multi-service agents.
**Pattern ID:** `Pattern-GHLSnapshot` + `Pattern-CRMBlueprint`
**Technical stack:** GHL Agency Pro, Stripe (payments tie-in), Twilio (SMS),
compliance template pack.
**Dependencies:** GHL sub-account (M-014)
**Deploy time:** 24–72 hrs (Starter) / 3–7 days (Growth) / 7–21 days (Premium
with data migration)
**Suggested price:** Ladder: **$1,500 setup + $499/mo (Starter)** ·
**$3,500 setup + $1,499/mo (Growth)** · **$7,500 setup + $4,999/mo (Premium
Managed)**
**Files that make it up:**
- `/Users/marcpapineau/.openclaw/workspace/cornerstone-apps/CRM-SHELL-BUILD-BLUEPRINT-v1.md`
- `/Users/marcpapineau/.openclaw/workspace/cornerstone-apps/CRM-FORMS-LAYER-v1.md`
- `/Users/marcpapineau/.openclaw/workspace/cornerstone-apps/CRM-CALENDARS-LAYER-v1.md`
- `/Users/marcpapineau/.openclaw/workspace/cornerstone-apps/CRM-COMMUNICATION-AND-WORKFLOW-MAP-v1.md`
- `/Users/marcpapineau/.openclaw/workspace/cornerstone-apps/CRM-IMPORT-SCHEMA-v1.csv`
- `/Users/marcpapineau/.openclaw/workspace/FINANCIAL-ADVISOR-CRM-OS-OFFER.md`
- `/Users/marcpapineau/.openclaw/workspace/FINANCIAL-ADVISOR-CRM-OS-BUSINESS-CASE.md`
- `/Users/marcpapineau/.openclaw/workspace/FINANCIAL-ADVISOR-CRM-OS-PRICING-MODEL.md`
- `/Users/marcpapineau/.openclaw/workspace/FINANCIAL-ADVISOR-CRM-OS-COMPETITOR-COMPARISON.md`
- `/Users/marcpapineau/.openclaw/workspace/FINANCIAL-ADVISOR-CRM-OS-PITCH-DECK-v1.md`
- `/Users/marcpapineau/.openclaw/workspace/FINANCIAL-ADVISOR-CRM-OS-SALES-DECK.md`
- `/Users/marcpapineau/.openclaw/workspace/FINANCIAL-ADVISOR-CRM-OS-LAUNCH-PLAN.md`

---

# INDUSTRY: PERSONAL FINANCE / CREATOR

---

## M-009 — Beaverly Personal-Finance PWA
**Status:** LIVE (single-page HTML PWA, deployed to beaverlyapp.ca target)
**What it does:** Mobile-first personal-finance coach app — onboarding,
registration, budget tracker, "kits" / streak / level progression, GHL CRM
hook ready for signup capture. Brand: Canadian financial-literacy / Beaver
Protocol.
**Who it's for:** Financial coaches, bootcamp operators, church / ministry
financial programs, Canadian FinLit creators.
**Pattern ID:** `Pattern-SinglePagePWA` (one HTML file with inline CSS + JS,
installable via "Add to Home Screen")
**Technical stack:** Vanilla HTML/CSS/JS, manifest.json for PWA, deployed
static to Netlify. GHL CRM hook via form POST.
**Dependencies:** GHL sub-account (M-014) for signup capture.
**Deploy time:** 3–4 hrs (drag-drop to Netlify, custom domain, DNS, swap
brand palette, swap GHL form target)
**Suggested price:** **$2,000 one-time + $99/mo** (white-label re-brand and
curriculum swap) — or $4,500 + $149/mo with GHL sub-account provisioned
**Files that make it up:**
- `/Users/marcpapineau/.openclaw/workspace/beaver-protocol-app/index.html`
- `/Users/marcpapineau/.openclaw/workspace/beaver-protocol-app/README.md`
- `/Users/marcpapineau/.openclaw/workspace/beaver-protocol-app/netlify.toml`
- `/Users/marcpapineau/.openclaw/workspace/beaver-protocol-app/src/` (structured components)
- `/Users/marcpapineau/.openclaw/workspace/beaver-protocol-app/public/`
- `/Users/marcpapineau/.openclaw/workspace/05-BEAVERLY/app/beaver-budget-app.html` (all-in-one variant)
- `/Users/marcpapineau/.openclaw/workspace/05-BEAVERLY/pitch/beaverly-master-blueprint.html`
- `/Users/marcpapineau/.openclaw/workspace/05-BEAVERLY/pitch/beaverly-ecosystem-map.html`

---

# INDUSTRY: CONTENT / AUTHORITY (any B2B)

---

## M-010 — Authority Content Engine (APOLLOS Clone)
**Status:** PILOT (works for Marc; needs voice-profile capture system before
it can be sold to multiple clients)
**What it does:** Daily or weekly long-form article published in client's
voice — Perplexity research → Claude synthesis with client voice profile →
Bannerbear header image → Buffer auto-post to LinkedIn + Instagram →
optional Resend delivery for approval.
**Who it's for:** Any solo expert / agency lead / executive who must publish
but won't — advisors, lawyers, realtors, coaches, consultants.
**Pattern ID:** `Pattern-ContentPipeline` (n8n/Windmill timed cron → research
→ gen → image → post)
**Technical stack:** n8n (Marc's existing) OR Windmill, Perplexity, Claude
via OpenClaw, Bannerbear, Buffer, Resend, KRITE review pass.
**Dependencies:** Voice profile (NOT YET BUILT — flagged); Buffer account;
Bannerbear template set; client brand kit.
**Deploy time:** 8–12 hrs per client once voice-profile capture system
exists (currently 2–3 days because voice is prompt-hand-tuned)
**Suggested price:** **$3,500 one-time + $697/mo** (includes 12–16 pieces/
month, image generation, scheduling)
**Files that make it up:**
- `/Users/marcpapineau/.openclaw/workspace/01-CRG/research/content-strategy/apollos-content-calendar_v1.0.md`
- `/Users/marcpapineau/.openclaw/workspace/APOLLOS-PRODUCTION-PROMPT-v4.md`
- `/Users/marcpapineau/.openclaw/workspace/APOLLOS-OPERATING-PROFILE.md`
- `/Users/marcpapineau/.openclaw/workspace/APOLLOS-ARTICLE-MODE-PRODUCTION-PACKAGE.md`
- `/Users/marcpapineau/.openclaw/workspace/APOLLOS-V3-ENHANCED-PROMPT.md`
- `/Users/marcpapineau/.openclaw/workspace/02-REAL-ESTATE/content/article-boc-ottawa-re-2026-03-23.html` (example output)
- `/Users/marcpapineau/.openclaw/workspace/02-REAL-ESTATE/content/article-boc-ottawa-re-v2.html`
- `/Users/marcpapineau/.openclaw/workspace/02-REAL-ESTATE/content/infographic-re-instagram.html`

---

## M-011 — Research Digest (DANIEL Clone)
**Status:** PILOT (works for Marc; client vertical parameterization and
branded email template not yet built)
**What it does:** Weekly research digest delivered to client's inbox — 6–8
Perplexity queries across client's industry verticals, Claude synthesizes
into a branded email, KRITE review, Resend delivery.
**Who it's for:** Operators who want to look smart in their industry but
don't have time to read — advisors, RE agents, founders, consultants.
**Pattern ID:** `Pattern-ContentPipeline` (subset — no image gen, no social
post, just email delivery)
**Technical stack:** n8n/Windmill, Perplexity sonar-pro, Claude, KRITE,
Resend.
**Dependencies:** Client's industry vertical list, branded email template.
**Deploy time:** 4–6 hrs per client
**Suggested price:** **$1,500 one-time + $297/mo**
**Files that make it up:**
- `/Users/marcpapineau/.openclaw/workspace/AGENT-EVOLUTION-PILOT-DANIEL.md`
- `/Users/marcpapineau/.openclaw/workspace/AGENT-PRESERVATION-INVENTORY-FILLED.md` (DANIEL inventory section)
- Shares content-pipeline infra with M-010

---

# INDUSTRY: ADVISORY CONTENT (specific)

---

## M-012 — Branded Investment Brief / Listing Package (PDF + HTML)
**Status:** LIVE (reusable template set; deployed for 2814 Carling)
**What it does:** One-click generation of a branded investment brief /
listing package — cover email HTML, investment-brief HTML, pricing-
recommendation PDF, financial-analysis PDF, sales-data PDF. Template-driven
so any property / deal gets the same professional treatment.
**Who it's for:** RE investors, commercial brokers, financial advisors
pitching deals, boutique investment shops.
**Pattern ID:** `Pattern-DocumentBundle` (HTML/PDF template pack with
variable fields; generated by content pipeline)
**Technical stack:** HTML/CSS templates + PDF generators (PDFKit or
browser-print), Claude for narrative copy, data files in JSON.
**Dependencies:** Deal data (listing info, financials, comparables).
**Deploy time:** 3–4 hrs per deal (data entry → template fill → PDF export
→ final polish)
**Suggested price:** **$1,500 per-deal** OR **$6,000 one-time build + $399/mo**
for unlimited self-serve use (template bundle licensed to advisor)
**Files that make it up:**
- `/Users/marcpapineau/.openclaw/workspace/2814-carling-cover-email.html`
- `/Users/marcpapineau/.openclaw/workspace/2814-carling-investment-brief.html`
- `/Users/marcpapineau/.openclaw/workspace/2814-carling-pricing-recommendation.pdf`
- `/Users/marcpapineau/.openclaw/workspace/2814-carling.pdf`
- `/Users/marcpapineau/.openclaw/workspace/2814-financial-analysis.pdf`
- `/Users/marcpapineau/.openclaw/workspace/2814-sales-data.pdf`
- `/Users/marcpapineau/.openclaw/workspace/01-CORNERSTONE-RESEARCH-GROUP/products/report-template_v1.0.html`
- `/Users/marcpapineau/.openclaw/workspace/02-REAL-ESTATE/pitch/` (full 2814-carling bundle duplicated)

---

## M-013 — Peptide Gantt & Protocol Visualizer (Standalone)
**Status:** READY (standalone HTML, not yet productized; used inside M-006)
**What it does:** Visual Gantt chart that shows how long each vial actually
lasts at the client's dosing level, cycle length, and stack mix. Client
sees exactly what they're buying and when it runs out.
**Who it's for:** Peptide clinics that want to visualize protocols without
running M-006's full ops backend. Also good for supplement coaches.
**Pattern ID:** `Pattern-StaticVisualizer` (single HTML page with
ChartJS/D3 or CSS-grid Gantt rendering)
**Technical stack:** Pure HTML/CSS/JS, embeddable in any site.
**Dependencies:** Compound data JSON (client's product catalog with
vial sizes, dose ratios, shelf-life).
**Deploy time:** 2–3 hrs per client (ingest catalog → render)
**Suggested price:** **$900 one-time + $49/mo** as a standalone widget;
included free inside M-006.
**Files that make it up:**
- `/Users/marcpapineau/.openclaw/workspace/04-PEPTIDES/gantt/luke-14day-gantt.html`
- `/Users/marcpapineau/.openclaw/workspace/04-PEPTIDES/gantt/peptide-gantt.html`
- `/Users/marcpapineau/.openclaw/workspace/04-PEPTIDES/research/luke_compound_database.json`

---

# INFRASTRUCTURE (almost always required)

---

## M-014 — GHL Sub-Account Provisioning + Snapshot Engine
**Status:** LIVE (Windmill script confirmed working with 3 snapshots
registered)
**What it does:** On-demand, API-driven creation of a new GHL sub-account
under CRG's Agency Pro, with chosen snapshot applied (RE, Vitalis, or CRM
Growth Engine). Pre-loads all pipelines, tags, fields, workflows, and email
templates in ~60 seconds.
**Who it's for:** Every client. This is infrastructure, not a customer-
facing product — it's what makes the whole agency scale.
**Pattern ID:** `Pattern-GHLSnapshot`
**Technical stack:** GHL Agency Pro API, Windmill, snapshot ID registry.
**Dependencies:** GHL Agency Pro plan (Marc has this). Snapshot IDs
maintained in the script.
**Deploy time:** 60 seconds per client (after pre-reqs collected)
**Suggested price:** Bundled into every other module — NOT sold standalone.
Internal cost ~$97/mo per sub-account (GHL per-location fee).
**Files that make it up:**
- `/Users/marcpapineau/.openclaw/workspace/01-CORNERSTONE-RESEARCH-GROUP/products/windmill-ghl-client-onboard-v1.py`
- Snapshot registry (in script):
  - `QN83mNt2hPBdTic5zs6H` — CRG Growth Engine v1.0
  - `ieM3gBs9jeoftTp8IBZH` — Marc Papineau Real Estate
  - `tBf0vOjIXAPv4mECV8SN` — Vitalis REsearch

---

# BUNDLES (pre-priced combos — recommended in the sales UI)

| Bundle | Modules | One-time | Monthly | Savings |
|---|---|---|---|---|
| **Script Engine Starter** | M-001, M-002, M-014 | $3,500 | $399 | $500 |
| **Speed-to-Lead Pro** | M-001, M-002, M-003, M-014 | $6,500 | $799 | $1,500 |
| **RE Growth Engine** | M-001, M-002, M-003, M-007, M-010, M-014 | $12,000 | $1,497 | $3,500 |
| **FA Growth Engine** | M-004, M-008 (Growth tier), M-011, M-014 | $8,500 | $1,697 | $2,500 |
| **Vitalis Full Stack** | M-005, M-006, M-013, M-014 | $12,000 | $849 | $2,900 |
| **Personal Brand OS** | M-010, M-011 | $4,500 | $899 | $500 |

---

# HALF-DONE / FLAGGED (not yet sellable — finish these to unlock revenue)

1. **M-010 Authority Content Engine — multi-client**
   - Blocker: voice-profile capture system not built. Every new client
     requires Marc to hand-tune prompts from writing samples.
   - Effort to unlock: ~2 hrs to build form + prompt assembly.

2. **HeyGen Avatar / ElevenLabs Voice Pipeline (Module 07 in
   CRG-module-catalog v1.0)**
   - Blocker: HeyGen avatar creation may require manual UI upload. No
     automation test run yet.
   - Effort to unlock: 2 hrs to test API; 10–16 hrs per client to produce
     avatar + voice clone + social-format pipeline.
   - When unlocked, sells as **$4,500 one-time + $699/mo**.

3. **CASL Unsubscribe Handling across all drip workflows (M-007, M-008)**
   - Blocker: Not formally implemented. Legal risk in prod.
   - Effort: 2 hrs to wire GHL's native unsubscribe into every drip.

4. **Per-Seat Bypass for M-002 Script Evaluator**
   - Blocker: Retainer clients still hit the $5 Stripe wall. Need access-
     token system.
   - Effort: 2 hrs.

5. **M-008 FA CRM-OS — snapshot not yet built**
   - Blocker: Offer & blueprint exist but the actual GHL snapshot for
     financial advisors is not exported. Competitor comparison needs fresh
     pricing on Wealthbox / Redtail / Salesforce FSC.
   - Effort: 6–8 hrs to export, 2 hrs for competitor research refresh.

6. **M-003 AI Call Qualifier — non-English / multi-region**
   - Blocker: Vapi assistant + Deepgram + ElevenLabs all configured for
     en-US only. Moving to fr-CA / Québec market needs separate tuning.
   - Effort: 4 hrs per new locale.

7. **Beaverly M-009 — curriculum content**
   - Blocker: `/05-BEAVERLY/curriculum/` is empty. App shell works, but
     the kits/levels/streaks gamification has no content filled in.
   - Effort: 8–12 hrs to produce starter 30-day curriculum.

8. **Iron Ministry App**
   - Files: `/Users/marcpapineau/.openclaw/workspace/iron-ministry-app/`
   - Status: Only `PRODUCT-REQUIREMENTS.md` exists. No built app. Not
     listed as a catalog module until built.

9. **Beaverly Curriculum module & Iron Ministry App**
   - Keep in research bucket until code + deploy target exist.

---

# CHANGELOG

- **v1.0 (2026-04-17)** — First catalog pass. 14 modules, 6 bundles,
  9 flagged half-done items. Source: full audit of
  `/Users/marcpapineau/.openclaw/workspace/` against the live product build
  directories + existing `/01-CRG/products/CRG-module-catalog_v1.0.md`
  (superseded by this version).
