# ROADMAP.md — Marc Papineau / CRG / Nehemiah
Last updated: April 6, 2026

## IMMEDIATE — Fix before building anything new

### Marc does (30 min total):
1. **Resend domain verify** — resend.com → Domains → Add `marcpapineau.com` → 3 DNS records in GoDaddy → fixes all email permanently
2. **EZRA Gmail re-auth** — n8n at localhost:5678 → Credentials → marc@cornerstoneregroup.ca → Reconnect Google
3. **Stripe live mode** — stripe.com → toggle from Test to Live → copy live keys to n8n KRITE workflows

### Nehemiah does (after Marc's 3 items):
4. Trigger 4 days of missed Apollos articles
5. Update all email workflows to send from verified domain
6. Set up permanent Cloudflare tunnel for Luke (auto-restart on reboot)
7. Update Ade CC across all email workflows once domain verified

---

## WEEK 1 — Foundation Solid

### RE Engine (Marc can use this for his own business)
- [ ] Confirm marcpapineau.com site has a lead capture form → feeds GHL + SOLOMON
- [ ] Test full funnel: lead submits → SOLOMON qualifies → RE drip starts → Marc gets notified
- [ ] EZRA includes RE leads in morning briefing
- [ ] Booking page tested end-to-end (marc-re-booking.netlify.app)

### CRG Revenue Launch
- [ ] Stripe live mode enabled
- [ ] crg-script-evaluation.netlify.app — clean custom domain (crg.cornerstoneregroup.ca)
- [ ] Test $5 payment → evaluation → delivery end-to-end
- [ ] Share with first 5 beta users (free or discounted)

---

## WEEK 2 — Visual Polish + Proactive AI

### Design Upgrade
- [ ] Rebuild CRG landing page in Framer (premium look — dark/gold, like B2B Rocket)
- [ ] Apply consistent design system across all CRG pages
- [ ] Add real social proof numbers once first clients submit scripts
- [ ] Video demo embed (HeyGen avatar or Loom walkthrough)

### Proactive Intelligence
- [ ] Daniel — weekly competitive intel cron (Mon 6AM)
  - Facebook Ad Library scan for RE/mortgage/insurance ads in Canada
  - Product Hunt AI tools scan
  - G2/Capterra trending in CRM/sales automation
  - Delivers briefing to Marc every Monday
- [ ] Daniel adds B2B Rocket + RD Mortgage Pro to tracking

---

## WEEK 3 — CRG Client Engine

### White-Label Package Build
- [ ] 7-day onboarding checklist (like RD Mortgage Pro)
- [ ] Pre-built content calendar template (Apollos-ready)
- [ ] Pre-built drip sequences for RE / Insurance / Mortgage verticals
- [ ] SOLOMON configured for client's ICP, not just Marc's
- [ ] Client dashboard (they see their leads, their content, their pipeline)

### Outbound Prospecting Layer (what B2B Rocket does)
- [ ] Research: which data sources available for Canadian RE leads (expired listings, FSBO, etc.)
- [ ] Build Daniel-powered prospect list builder
- [ ] Wire outbound sequence through GHL
- [ ] CASL compliance layer built in

---

## WEEK 4 — April 20 Investor Demo Ready

### Beaverly
- [ ] Ade brand assets received → Bannerbear carousel implemented
- [ ] Level 1 curriculum playable end-to-end
- [ ] Colony system functional
- [ ] Lead capture wired to GHL
- [ ] Demo-ready on any device

### CRG Pitch
- [ ] 10 beta script evaluations completed (social proof)
- [ ] Pricing page live
- [ ] Live demo script rehearsed (the $5 moment)
- [ ] Business case with Lennar/Salesforce comp ($550/seat vs CRG pricing)

---

## RESEARCH BACKLOG (pull when ready to build)

- `/workspace/research/salesforce-monday-crg-analysis.md` — full 30-day build plan inside
- B2B Rocket deep research — queue for Daniel
- RD Mortgage Pro deep research — queue for Daniel
- Framer vs Webflow comparison — for CRG page redesign
- Canadian RE data sources (expired listings, FSBO) — for outbound engine

---

## KNOWN TECHNICAL DEBT

1. Resend free tier → blocks multi-address delivery (fix: verify domain)
2. Luke app requires Mac Mini running + Cloudflare tunnel (fix: auto-restart LaunchAgent)
3. APOLLOS articles missing image visuals in email (Luma integration partially broken)
4. Peptide app functions wipe on zip deploy (fix: always use ./deploy.sh script)
5. n8n API key expires May 4, 2026 — renew before then
6. Stripe in test mode — needs live mode for CRG revenue
7. GoDaddy DNS for cornerstoneregroup.ca → Cloudflare — check if propagated

---

## APPS LIVE (all Netlify)

| App | URL | Status |
|---|---|---|
| Beaverly | beaverlyapp.ca | ✅ Live |
| CRG Script Evaluator | crg-script-evaluation.netlify.app | ✅ Live |
| CRG Script Generator | crg-script-generator.netlify.app | ✅ Live |
| CRG Growth Engine | crg-growth-engine.netlify.app | ✅ Live |
| Peptide Resource | peptide-resource-app.netlify.app | ✅ Live |
| ~~Luke Ops~~ | ~~luke-peptide-ops.netlify.app~~ | ❌ RETIRED 2026-04-21 — superseded by Vitalis POS (luke-app) |
| RE Booking | marc-re-booking.netlify.app | ✅ Live |
| Family Finance OS / VaultOS | papineau-family-finance.netlify.app | ✅ Live |
| CRG Demo Script | crg-demo-script.netlify.app | ✅ Live |
| CRG Investor Deck | vaultos-investor-deck.netlify.app | ✅ Live |
