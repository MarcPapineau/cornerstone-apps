# APPS-CANON — Single Source of Truth for All Apps

**Last updated:** 2026-04-19 (Marc-confirmed)
**Status:** LOCKED. If any session document, agent output, or code reference contradicts this file, THIS FILE WINS. Fix the contradiction; do not proceed with the wrong name.

---

## Why this file exists

Marc has too many old/deprecated apps floating around in the workspace. Sessions kept booting and pulling old names ("Jason mortgage app", "luke peptide app", "papineau finance app", random n8n workflow references) instead of the current canonical names. This file is the antidote: read it FIRST on every session boot.

---

## The canon

| Current name | Version | Status | Replaces (deprecated names — DO NOT USE) | Where it lives | Stack |
|---|---|---|---|---|---|
| **Vitalis** | v1 | active | "peptide resource app", "peptide research app", `peptide-resource-app/`, `04-PEPTIDES/app/peptide-resource-app/` | `businesses/vitalis-research/` (canonical) | TBD — Marc to confirm |
| **Vitalis POS** | v1 | active | "luke peptide app", `luke-peptide-app/` (RETIRED 2026-04-21 — archived), `luke-peptide-ops.netlify.app` (DELETED 2026-04-21), `luke-app/` (this working dir) | `luke-app/` (Express app + peptide DB) | Node/Express |
| **Garvis** | v1 | live | "CRG Command", "command dashboard", "operator console", "Founder Command Center", AND the lookalike at `cornerstoneregroup-site/command/` (different repo, deprecated) | **Repo:** `crg-command-center/` · **URL:** https://crg-command.netlify.app/ · **GitHub:** MarcPapineau/crg-command-center | Vanilla JS PWA (3-silo Stark HUD layout) + Netlify Functions + GHL APIs + Windmill |
| **NorthLend Calculator** | v1 | live | "Jason mortgage app", "Jason calculator", "mortgage calculator app for Jason" | `cornerstoneregroup-site/calculators/mortgage/` (also embedded at `/intake/jason/`) | Vanilla JS, Netlify static |
| **Vault OS** | v? | TBD | "Papineau finance app", `vaultos-pitch.html` (old pitch page), anything calling it by the old name | TBD — needs canonical path | TBD — Marc to confirm |
| **Beaverly** | v? | TBD | (no rename — same name as before) | `05-BEAVERLY/`, `beaver-protocol-app/` (need to consolidate) | TBD — Marc to confirm |

---

## Naming rules going forward

1. **Every app has a current name + a v-number.** Never refer to an app without its version when the version matters.
2. **Deprecated names are FORBIDDEN.** If you see one in old docs, fix it. Don't perpetuate.
3. **Workflow stacks are pinned per app.** When Marc says "n8n is back in the mix" — that's the symptom of a session pulling an old workflow doc. Each app's stack is listed above; if a doc references a different stack for the same app, the doc is stale.
4. **One canonical path per app.** Multiple directories with the same purpose = consolidation debt. Track in the table; resolve over time.

## AI-time vs Human-time rule (NON-NEGOTIABLE)

Every estimate, in every doc, in every Marc-facing message, has TWO numbers:
- `human_estimate` — what a consultant/agency would quote (weeks, months)
- `ai_estimate` — what we ship overnight with sub-agents (hours, minutes)

Default Marc-facing quote = `ai_estimate`. Mention `human_estimate` only for cost framing.
Typical ratio: AI is **20-50× faster** than the human quote.
"This week" = wrong. "Tonight" or "tomorrow morning" = correct.
If a task genuinely takes weeks (e.g. waiting on third-party SOC2 audit), say so explicitly with WHY.

Examples:
- "Build secrets rotation system" → human: 2 weeks. ai: 90 minutes tomorrow morning.
- "Research every peptide" → human: 6 weeks of analyst time. ai: one overnight sub-agent run.
- "Write 12 agent scorecards" → human: 1 week. ai: 2 hours tonight via parallel build agent.

---

## Agents canon (PROPOSED — Marc to approve/edit before any rename)

Marc directive: agents must be named by ROLE (Office Manager, Marketing Manager, SEO Manager, etc.), streamlined. Biblical names (Abigail, Benaiah, Krite…) are confusing for ops — what does "Apollos" even do at a glance?

**Proposal:** role title becomes the PRIMARY name. Biblical name kept as an internal alias only (for continuity in old prompts/docs). Display in dashboard = role title.

| Role title (proposed primary) | Biblical alias (legacy) | What it does | Status | Stack |
|---|---|---|---|---|
| Vault Keeper | Levite | Owns every secret/token/credential. Refreshes OAuth, syncs Doppler→Netlify, alerts on drift. Marc never touches keys. | spec (build 2026-04-20) | Doppler + Netlify scheduled function |
| Voice Concierge | Abigail | Inbound + first-touch outbound calls (Vapi + ElevenLabs Sarah) | live | Vapi |
| Outbound Email Manager | Benaiah | KRITE-gated outbound email sends | spec | TBD |
| Quality Gate | Krite | 4-axis review (voice/compliance/research/tone) before any send | spec | Anthropic API |
| Content Writer | Apollos | Articulate teacher / blog + article drafts | active | Anthropic API |
| Research Lead | Daniel | Deep research via Perplexity sonar-pro | active | Perplexity |
| Bookkeeper | Joseph | Tax + bookkeeping (Xero/QBO sync) | spec | TBD |
| Strategy & Pricing Lead | Solomon | Strategy frameworks + pricing logic | spec | Anthropic API |
| Peptide Research Lead | Luke | Vitalis peptide research + protocols | active | Anthropic API |
| Automation Engineer | Nehemiah | Workflow builder (n8n / Make / Netlify functions) | spec | n8n |
| Daily Brief Editor | Ezra | 6am ET morning brief (already shipping) | live | Netlify scheduled function |
| QA Lead | Judge | Regression detection across agent runs | spec | Anthropic API |
| Office Manager | Martha | Calendar/inbox triage, meeting prep, follow-up tracking, weekly personal-life review | spec (build 2026-04-20) | Anthropic API + Google Calendar + Gmail MCP + GHL + Garvis |
| Marketing Manager | Lydia | Cross-silo campaign strategy, brand consistency, channel mix, A/B test design; directs Apollos + Asaph | spec (build 2026-04-20) | Anthropic API + GHL + GA4/Search Console + Garvis |
| SEO Manager | Asaph | Keyword research within Lydia's themes, on-page audit, content briefs to Apollos, weekly SERP tracking | spec (build 2026-04-20) | Anthropic API + Perplexity + Search Console + Garvis blogs |

**Specs:** see `01-CORNERSTONE-RESEARCH-GROUP/agents/scorecards/{office-manager,marketing-manager,seo-manager}.md` (markdown contracts) and matching `{martha,lydia,asaph}.json` (runtime score records). Spec-structure standard at `scorecards/SCORECARD-SPEC-STRUCTURE.md`.

**Open naming question (Marc to resolve):** SEO Manager alias = Asaph (chief musician, discoverability metaphor) chosen specifically to avoid collision with Ezra (Daily Brief Editor, live). Confirm Asaph or override.

**Naming rules for agents:**
1. Role title = how the agent is referred to in dashboards, status reports, briefings, Marc-facing UI.
2. Biblical alias = internal continuity only (old prompt files, scorecards in `01-CORNERSTONE-RESEARCH-GROUP/agents/scorecards/`). Kept until next clean refactor.
3. New agents get a role title FIRST. Biblical alias optional.
4. NEVER refer to an agent by biblical name in user-facing copy after Marc approves the rename.

**To execute the rename (do AFTER Marc approves the table above):**
- Update `cornerstoneregroup-site/netlify/functions/command-agents.js` to return both fields (`role_title`, `alias`) or just `role_title`
- Update Garvis dashboard Agents tab to display role title (alias as small caption)
- Sweep `01-CORNERSTONE-RESEARCH-GROUP/agents/` docs to add role title at the top of each scorecard
- Add the 3 missing roles (Office Manager, Marketing Manager, SEO Manager) as new agents OR clarify they're handled by an existing one

---

## Open questions for Marc (resolve next session)

1. **Garvis ambiguity.** The /command/ dashboard is now called Garvis. But Funbox has a card also called "Garvis" — the JARVIS-style voice avatar idea. Same name, two things. Pick one:
   - Option 1: Rename the Funbox card to "Garvis Voice" (the dashboard's voice mode is a feature of Garvis-the-dashboard).
   - Option 2: Pick a new name for the voice avatar (e.g. "JARVIS-mode", "Iron Voice"), keep dashboard = Garvis.
2. **Vitalis POS canonical path.** `luke-peptide-app/` retired and deleted 2026-04-21. `luke-app/` is the live Express app. Rename to `vitalis-pos/` still pending Marc confirmation.
3. **Vault OS path + stack.** Where does it live? What's it built on?
4. **Vitalis stack.** Same q.
5. **Beaverly v-number** + which directory is canonical.
6. **Agents rename.** Approve the role-title table above? Any role titles to change? Which of the 3 missing roles (Office Manager, Marketing Manager, SEO Manager) to spec next?

---

## Deprecation hit list (delete or archive next pass)

These directories/files are dead per the canon. Don't reference them. Slate for removal in a cleanup pass:

- `peptide-resource-app/` → Vitalis killed it
- `04-PEPTIDES/app/peptide-resource-app/` → same
- `luke-peptide-app/` → RETIRED AND DELETED 2026-04-21. Archive: ~/Desktop/CRG-Command/05-Archives/luke-peptide-app-2026-04-21.tar.gz. Netlify site luke-peptide-ops (71ec51c1) deleted same date.
- `vaultos-pitch.html` (old pitch page) → keep only if Vault OS still uses the pitch deck; otherwise delete
- `beaver-protocol-app/` → consolidate into Beaverly canonical path
- Any n8n workflow doc referencing the above app names → outdated
- "Jason mortgage app" mentions in any spec/email/script → search & replace with "NorthLend Calculator"
- `cornerstoneregroup-site/command/` → **NOT Garvis.** This is a separate dashboard built in the wrong repo on Apr 18-19. Garvis lives at `crg-command-center/` deployed to crg-command.netlify.app. Either delete `/command/` from the cornerstoneregroup-site repo OR redirect cornerstoneregroup.netlify.app/command/ → crg-command.netlify.app. Do not edit `/command/` thinking you're working on Garvis.

---

## How to use this file

**Every session boot:**
1. Read this file BEFORE acting on any app-related task.
2. If the user's request mentions an app, confirm the current name from the table.
3. If you find a contradiction in another doc, FIX THAT DOC, don't propagate the bad name.
4. If a name isn't in this table at all, ask Marc — don't guess.

**When adding/renaming an app:** edit this table immediately, in the same commit as the rename. The canon is only useful if it stays current.
