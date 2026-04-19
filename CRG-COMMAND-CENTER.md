# CRG COMMAND CENTER

> **Single source of truth** for Cornerstone Research Group state.
> Lives in `~/.openclaw/workspace/CRG-COMMAND-CENTER.md`.
> Claude refreshes this doc by querying GHL + Netlify + git directly. You read it.

**Last refreshed:** 2026-04-19 02:00 EDT (Apr 18 night — Morning Brief shipped + 4-doc architecture sprint)
**Refreshed by:** Claude (overnight build)

---

## 📰 CRG MORNING BRIEF — LIVE (Apr 19 first send confirmed)

Marc's daily 9-topic newspaper. Auto-sends at 6 AM EDT (10:00 UTC).

| Item | Detail |
|---|---|
| Status | 🟢 LIVE — first send Apr 19 01:54 EDT, Resend id `4393154b-23da-4f1f-a52e-7af4abda04fd` |
| Schedule | `0 10 * * *` UTC = 6 AM EDT / 5 AM EST (Netlify scheduled function) |
| Trigger function | `/.netlify/functions/morning-brief?send=1` (kicks background, returns 202) |
| Worker | `/.netlify/functions/morning-brief-background` (15-min runtime cap; ~73s typical) |
| Source list | `cornerstoneregroup-site/data/morning-brief-sources.json` (commit for permanent change) |
| Admin UI | https://cornerstoneregroup.netlify.app/morning-brief-admin.html (key in TOOLS.md) |
| Topics | Crypto · Geopolitics · Monetary · Finance · Cdn Politics · Real Estate · AI · Science · Faith |
| Format | Top 3 hot highlights → per-topic headline + 2-3 bullets + "why it matters to Marc" |
| Hard rule | NO fabricated headlines. Every claim cites a source URL from the harvested feed set. |

**To change a feed:** edit `data/morning-brief-sources.json`, push. Or use admin UI for ephemeral test.
**To trigger now:** `curl https://cornerstoneregroup.netlify.app/.netlify/functions/morning-brief?send=1`
**To preview without sending:** drop `?send=1` (default = dry preview returns brief JSON, no email).

---

## 🌙 OVERNIGHT BUILD (Apr 18→19) — 4 ARCHITECTURE DOCS READY FOR MARC'S MORNING REVIEW

Marc asked for 4 decision-ready specs while he slept. All are pasteable, decision-ready, no vague phrasing.

| # | Doc | Path | Decision needed |
|---|---|---|---|
| 1 | **Abigail Outcome Workflows (4 GHL workflows)** | `cornerstoneregroup-site/abigail/OUTCOME-WORKFLOWS.md` | Build all 4 in GHL UI (~30 min); resolve open questions in doc |
| 2 | **Agent Scorecard System + Judge Agent** | `01-CORNERSTONE-RESEARCH-GROUP/agents/SCORECARD-SYSTEM.md` | Approve schema; ratify 7 initial scorecards + 5 rubrics + Judge prompt; greenlight wire-up |
| 3 | **Auto-Research / Self-Improvement Loop** | `01-CORNERSTONE-RESEARCH-GROUP/agents/SELF-IMPROVEMENT-LOOP.md` | Approve weekly cadence + dashboard surface; answer 5 open questions |
| 4 | **Voice Conversational Mode — Research + Recommendation** | `cornerstoneregroup-site/abigail/VOICE-MODE-PLAN.md` | Pick path (recommendation: Vapi + Claude API); approve $85/mo budget; greenlight Day-1 cut (3h build) |

**Supporting files written this build:**
- `01-CORNERSTONE-RESEARCH-GROUP/agents/scorecards/{abigail,benaiah,krite,apollos,daniel,riley,claude-code}.json` — 7 scorecards seeded
- `01-CORNERSTONE-RESEARCH-GROUP/agents/rubrics/{voice-concierge,outbound-email,quality-gate,article-writer,claude-code}.json` — 5 rubrics
- `01-CORNERSTONE-RESEARCH-GROUP/agents/CRG-Judge/SYSTEM-PROMPT.md` — Judge agent system prompt (paste-ready)

Everything committed + pushed to git.

---

## 🎯 RIGHT NOW

| Status | Item | Detail |
|---|---|---|
| 🟢 LIVE | cornerstoneregroup.netlify.app | Auto-deploy from `MarcPapineau/cornerstoneregroup-site` (main) |
| 🟢 LIVE | `/intake/jason/` | Custom cover page + 10-Q form, GHL pipeline verified |
| 🟡 DEPLOYING | `jason-intake-submit` v2 | Now emails Marc on every submit (commit c099248, pushed 23:53 EDT) |
| 🟢 CONNECTED | GHL Gmail 2-way sync | marc@cornerstoneregroup.ca — captures NEW msgs only, not historical |
| 🟢 LIVE-BOOKING | Abigail (voice concierge) | Vapi `c746c0d8...`, Matilda voice (turbo v2.5), gpt-4o brain. Wired to GHL calendar `s7lglLE0DEe1Of7SwSM2` via `abigail-calendar-tool` Netlify function — books Discovery Brief live on call |
| 🟡 PHONE NOT REASSIGNED | Vapi number 905-487-7351 | id `33085071-2793-4e5f-a311-973c92391891` — currently bound to Script Engine Qualifier; reassign to Abigail before workflow goes live |
| 🔴 NOT BUILT | GHL Workflow "Post-Intake Abigail Sequence" | Prompt ready at `cornerstoneregroup-site/abigail/GHL-WORKFLOW-PROMPT.md` — Marc pastes into GHL AI Workflow Builder |
| 🟢 BUILT | Session-resume system | `RESUME.md` at workspace root + `reference_session_resume_protocol.md` memory. Marc pastes one prompt → Claude loads all state. |
| 🟡 PENDING | Michael / Jason coordinator email | KRITE-approved v5 ready, Marc to send via Gmail Reply All |

---

## 👤 ACTIVE PROSPECTS

### Jason Anbara — Mortgage Alliance / NorthLend Financial
- **Status:** Pre-discovery. Coordinator (Michael) reached out on Marc's behalf.
- **GHL contact:** _empty (Ade test contact deleted, awaiting real Jason submission)_
- **Next move:** Marc sends KRITE v5 email to Michael with intake link → Jason fills `/intake/jason/` → triggers GHL workflow → Abigail calls → books Marc 60-min
- **Research on file:** Mortgage Automator quote (verified), Telfer trilingual citation (verified), 2025 CMA Excellence, Forty Under 40 (2024), Bruyère Foundation board

---

## 📥 INBOX & GHL STATE (live)

**GHL Sub-account:** Cornerstone Re Group · Ottawa · location `9Z3U7KnyQSbbnaKyTS2e`
**GHL contacts (3 total):**
- `ade test` — no tags — Apr 18 (manual test contact, can clean up later)
- `test broker` — tags: licensing-inquiry, mortgage-broker, high-value — Apr 18 (licensing form test)
- `sarah thompson` — tags: mybioyouth-order — Apr 18 (unrelated)

**GHL Conversations:** 0 (Gmail sync only captures new threads going forward; historical Michael thread won't appear until next reply lands)

---

## 📋 QUEUE (next up, in order)

> **Source of truth:** `cornerstoneregroup-site/data/queue.json`
> Both Marc's `/command/` dashboard AND Claude (in any chat session) read/write this same file.
> Edits via dashboard hit `command-queue.js` Netlify function → in-memory + (when `GITHUB_TOKEN` env set) commits to repo.
> Edits via Claude chat → direct file edit + commit. Either path keeps the queue identical.
> The list below is regenerated from `data/queue.json` on each manual refresh.

1. **Marc → ship Michael email** (Gmail Reply All + BCC `9Z3U7KnyQSbbnaKyTS2e@email.usercontent.site` for GHL sync)
2. **Marc → build GHL Workflow "Post-Intake Abigail Sequence"** (spec ready, walks through in GHL UI in ~15 min)
3. **Claude → verify intake email notification fires** (test submit after deploy completes)
4. **Marc → answer: what is Ade Papineau's role at CRG?** (defines voice for Ade@ outbound emails)
5. **Claude → build Abigail full spec doc** (voice = ElevenLabs Sarah `EXAVITQu4vr4xnSDxMaL`, script, probe library, Q11 closer, handoff rules)
6. **Claude → revoke old GHL token** (`pit-f36f03f4-...` — after new token verified live)
7. **Claude → /command/ web dashboard** ✅ BUILT — see /command/ section below
8. **Claude → trilingual module on mortgage-brokers page**
9. **Claude → branded mortgage calculator app for Jason**
10. **Claude → spec CRG-Mortgage-Broker-v1 GHL snapshot**
11. **Claude → spec CRG-Internal-Demo-v1 GHL snapshot**
12. **Claude → Database Reactivation Campaign module spec + question library**
13. **Claude → real estate content overhaul (Stark aesthetic)**

---

## 🖥 /command/ OPERATOR CONSOLE (built Apr 18 overnight)

**URL:** https://cornerstoneregroup.netlify.app/command/
**Password:** `Stark-88184e2b-2026` (also in `TOOLS.md`)
**Bearer (functions):** `0f8270770cc9c86cd3d6fe5c954ff6dc50a4527a59fb1254d1344b9120ec879d`

**Install on iPhone:**
1. Open `https://cornerstoneregroup.netlify.app/command/` in Safari (must be Safari, not Chrome iOS)
2. Tap the Share button (square with up-arrow)
3. Scroll down → tap **"Add to Home Screen"**
4. Name it "Command" → Add
5. Open from home screen — runs full-screen, no browser chrome

**Sections:**
- **Pipeline** — live GHL contacts, conversations, workflows, tags (60s cache)
- **Queue** — bidirectional with `data/queue.json`. Add/remove tasks; Claude sees the same list.
- **Calls** — last 20 Vapi calls with status + duration + Vapi dashboard link
- **Agents** — roster + scorecards (scorecards section pending until `agents/scorecards/*.json` files exist)
- **Voice button (top-right)** — stub modal pointing to `VOICE-PLAN.md`

**Netlify env vars REQUIRED before deploy works:**
- `COMMAND_PASSWORD=Stark-88184e2b-2026`
- `COMMAND_AUTH_TOKEN=0f8270770cc9c86cd3d6fe5c954ff6dc50a4527a59fb1254d1344b9120ec879d`
- `VAPI_API_KEY=37cde1f7-a419-46c5-be4d-b81cb1c88fc7`
- (existing) `GHL_TOKEN=pit-41557ed2-...`
- (optional) `GITHUB_TOKEN=<fine-grained PAT>` — durable queue writes back to repo

**Push notifications:** wired in `sw.js` but inactive. See `VOICE-PLAN.md` for activation steps.

---

## 🏠 REAL ESTATE ENGINE — Apr 18 NIGHT BUILD

> Overnight Apr 18→19 sprint. Marc asleep. World-class real estate content engine + site direction shipped to workspace; nothing pushed live. Marc reviews in the morning.

**Lives in:** `02-REAL-ESTATE/`

| Deliverable | Path |
|---|---|
| Audit (existing artifacts graded) | `02-REAL-ESTATE/AUDIT-2026-04-18.md` |
| Brand & design system (CRG-aligned tokens) | `02-REAL-ESTATE/BRAND-SYSTEM.md` |
| Content batch (5 LI + 5 IG + 3 blog) | `02-REAL-ESTATE/content/batch-2026-04-19/` |
| IG visual mockup (renderable HTML) | `02-REAL-ESTATE/content/batch-2026-04-19/instagram-01-visual.html` |
| Site rebrand plan (marcpapineau.com) | `02-REAL-ESTATE/SITE-REBRAND-PLAN.md` |
| GHL social workflow specs (LI + IG drips) | `02-REAL-ESTATE/GHL-SOCIAL-WORKFLOWS.md` |

**What ships in the batch:** 13 pieces, all dark CRG-aesthetic, all Ottawa-specific, all carrying the mandatory CRG attribution footer per the memory rule. Sources cited inline (Bank of Canada, OREB, CMHC, Statistics Canada, Government of Canada FHSA/HBP, Ontario LTT). Topics: BoC rate-pause read, Glebe deep dive, FHSA first-time buyer math, 122-124 Cobourg listing showcase, overpricing tax doctrine.

**Decisions Marc owes the system tomorrow:**
1. **marcpapineau.com hosting platform identity** — blocks site rebrand path (A: theme overrides on hosted SaaS, vs C: full custom Netlify rebuild). I checked GitHub — no `marcpapineau-*` repo exists.
2. **Approve / red-line the 13 batch pieces** before they go to GHL drip.
3. **OAuth Marc's LinkedIn + Instagram into GHL Social Planner** (one-time, ~10 min in GHL UI).
4. **Airtable vs. GHL Custom Object** as content-calendar source-of-truth.
5. **2814 Carling case study** — vendor permission to publicize as redacted portfolio piece?

**No production changes pushed.** All assets stage in workspace. Old real estate articles (`02-REAL-ESTATE/content/article-boc-ottawa-re-*.html` and `infographic-re-instagram.html`) graded C+/B/B- — recommend archiving v1, re-skinning v2 + infographic to CRG palette.

---

## ✅ DONE LOG (this session — Apr 18)

- ✅ Added Social Media AI as 4th silo on homepage (Beta Q3 badge)
- ✅ Built `/social-media/` stub page with reservation form
- ✅ Wired GitHub auto-deploy (Netlify ↔ MarcPapineau/cornerstoneregroup-site)
- ✅ Built `/intake/jason/` custom cover page (10-Q form + research-first pitch)
- ✅ Verified GHL pipeline end-to-end via Ade's QA submission (form → contact → note → tags ✓)
- ✅ Deleted Ade test contact (Jason slot reset for real submission)
- ✅ Saved Abigail Q11 doctrine to memory (vision/future-perfect call closer)
- ✅ Patched `jason-intake-submit.js` to email Marc on every submission
- ✅ Set `GHL_TOKEN` env var in Netlify (new token `pit-41557ed2-...`)
- ✅ Pushed commit `c099248` → triggered Netlify auto-deploy

---

## 🔧 INFRASTRUCTURE

### Sites
- **cornerstoneregroup.netlify.app** — main marketing site, auto-deploys from `main`
- **Repo:** https://github.com/MarcPapineau/cornerstoneregroup-site (private)
- **Netlify project ID:** 55e858a8-9d59-46a3-b698-a71f2def63be

### Netlify functions
- `benaiah-send.js` — outbound email with KRITE quality gate
- `jason-intake-submit.js` — GHL contact + note + email notification (v2)
- `licensing-submit.js` — licensing form
- `abigail-call-trigger.js` — GHL webhook → Vapi outbound Abigail call
- `abigail-calendar-tool.js` — Vapi server-side tool (get_available_slots + book_appointment on GHL Discovery Brief calendar)

### Netlify env vars (verified set, values masked)
- `ANTHROPIC_API_KEY` ✓
- `BENAIAH_FROM_EMAIL` ✓
- `RESEND_KEY` ✓
- `GHL_TOKEN` ✓ (set Apr 18 23:51 EDT — pit-41557ed2-...)

### GHL
- **Sub-account:** Cornerstone Re Group, Ottawa (`9Z3U7KnyQSbbnaKyTS2e`)
- **Active token:** `pit-41557ed2-c669-42ed-8d32-e7cccf6ae04f` (Private Integration)
- **Old token to revoke:** `pit-f36f03f4-24db-4186-9b64-2cb7735fca36`
- **Auto BCC sync:** `9Z3U7KnyQSbbnaKyTS2e@email.usercontent.site`
- **Gmail 2-way sync:** marc@cornerstoneregroup.ca (connected, captures forward only)
- **Vapi number for Abigail:** _Marc to confirm — exists but not wired into intake workflow yet_

### KRITE quality gate
- `benaiah-send` runs every outbound through KRITE 4-axis scoring (voice, compliance, research-first, tone)
- Threshold: voice_score ≥ 75 to pass
- Mortgage Automator quote + Telfer trilingual fact verified, safe to cite

---

## 👥 PEOPLE

- **Marc Papineau** — founder, sole operator, marc@cornerstoneregroup.ca
- **Ade Papineau** — Marc's wife. Two roles: (1) QA tester, feedback prefixed `[ADE QA]:`. (2) Real person behind `Ade@cornerstoneregroup.ca` outbound persona — **role at CRG TBD, blocking Ade@ email build**
- **Alex** — fictional assistant persona for outbound emails on Marc's behalf
- **Abigail** — AI voice concierge (ElevenLabs Sarah voice). Inbound + first-touch outbound. Biblical Abigail = wise diplomat (1 Sam 25)
- **BENAIAH** — outbound email AI (mighty warrior frame)
- **KRITE** — quality gate AI (judge frame)
- **APOLLOS** — articulate teacher AI

---

## 📜 DOCTRINE (key rules to remember)

1. **Q11 — Abigail's closing question:** Always ends every call with the vision/future-perfect prompt. See `~/.claude/projects/.../memory/project_abigail_call_doctrine.md` for exact wording.
2. **Research-first:** Every outbound references something specific to the prospect (verified fact, recent achievement, public quote). KRITE blocks generic pitches.
3. **No claims without source:** Quotes get verified before use. If no public source, don't cite.
4. **Two-step sales flow:** Aisha-equivalent (now Abigail) intake call → Marc 60-min discovery brief one week later. Marc's calendar protected.
5. **Compliance > ergonomics:** CASL, CRTC, privacy — non-negotiable. KRITE checks before any send.

---

## 🔄 RECOVERY PROMPT (paste into new session)

> Read `~/.openclaw/workspace/CRG-COMMAND-CENTER.md` and the auto-memory at `~/.claude/projects/-Users-marcpapineau--openclaw-workspace/memory/MEMORY.md`. Then summarize: what's live, what's in flight, what's blocked, what's next. Don't start building until I confirm the priority. If the doc's "Last refreshed" timestamp is more than 24h old, re-query GHL via `curl https://services.leadconnectorhq.com/contacts/?locationId=9Z3U7KnyQSbbnaKyTS2e -H "Authorization: Bearer $GHL_TOKEN" -H "Version: 2021-07-28"` and refresh the doc before responding.

---

## 🛠 HOW TO REFRESH THIS DOC

Claude refreshes this doc directly. Manual triggers Marc can use:
- "refresh command center"
- "what's the state of CRG right now?"
- "pull GHL contacts and update the dashboard"

Claude should refresh automatically:
- At the start of every new session
- After any GHL action (contact created, deleted, tagged)
- After any Netlify deploy
- After any commit

---

*End of Command Center. Refreshed by Claude. Don't edit by hand — ask Claude to update.*
