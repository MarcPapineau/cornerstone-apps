# EXECUTION ORDER — FINAL LOCKED

**Status:** ACTIVE & LOCKED  
**Decision Date:** Sun Apr 12, 2026  
**Authority:** Marc Papineau  
**Effective:** This week (starting Apr 13, 2026)

---

## THE EXECUTION SEQUENCE (LOCKED)

### THIS WEEK (Apr 13-18, 2026)

**Priority 1: GitHub Formalization (Foundational)**
- Establish GitHub as single source of truth
- Formalize repository structure
- Setup version control workflows
- Lock all code + workflows in git

**Priority 2: Design Direction Agent (Real Workflow)**
- First real use: Peptide Resource App UI
- Deploy full design brief → visual system → component specs
- Validate design governance works operationally

**Priority 3: QA Validation Agent (Real Workflow)**
- First real use: Founder Command Center (completed, needs QA audit)
- Then: Peptide Resource App (after build)
- Validate QA gate works operationally

**Priority 4: Standardized Build Flow**
- Lock REQUEST → DESIGN → BUILD → QA → DEPLOY → MONITOR
- Enforce no skipping stages
- Document exceptions (if any)

### NEXT WEEK (Apr 21+, 2026)

**Priority 5: Windmill Phase 1 Migration**
- Start with APOLLOS Daily
- Migrate EZRA Morning Briefing
- Proven migration pattern → unlock other workflows
- Hold Stripe/payment workflows until pattern is proven

---

## 1. GITHUB FORMALIZATION PLAN

### Objective
Make GitHub the canonical source for all code, workflows, configuration, and documentation.

### What Gets Formalized This Week

**Three core repositories to create/formalize:**

1. **cornerstone-apps** (Frontend apps)
   - Contains: Beaverly, Family Finance OS, Luke Peptide Ops, Peptide Resource App, Founder Command Center, Iron Ministry
   - Structure:
     ```
     cornerstone-apps/
     ├── apps/
     │   ├── beaverly/
     │   ├── family-finance/
     │   ├── ~~luke-peptide-ops/~~ (RETIRED 2026-04-21 — deleted)
     │   ├── peptide-resource/
     │   ├── founder-command-center/
     │   └── iron-ministry/
     ├── shared/
     │   ├── components/
     │   ├── design-tokens/
     │   └── utils/
     ├── docs/
     │   ├── design-briefs/
     │   ├── qa-reports/
     │   └── architecture/
     └── .github/
         └── workflows/ (CI/CD)
     ```
   - What goes in: React/HTML source code, design tokens (CSS), component library, Netlify configs
   - What does NOT go in: API keys, secrets, user data (handled by GitHub secrets)

2. **windmill-workflows** (Automation & Agent Pipelines)
   - Contains: All Windmill jobs (migrated from n8n)
   - Structure:
     ```
     windmill-workflows/
     ├── jobs/
     │   ├── apollos-daily.ts
     │   ├── ezra-morning-briefing.ts
     │   ├── daniel-research.ts
     │   ├── solomon-lead-qualifier.ts
     │   └── [other jobs]/
     ├── resources/
     │   ├── stripe-webhook.ts
     │   ├── airtable-sync.ts
     │   └── [integrations]/
     ├── lib/
     │   ├── ai-api-calls.ts
     │   ├── data-transforms.ts
     │   └── [shared]/
     ├── docs/
     │   ├── migration-notes.md
     │   └── troubleshooting/
     └── .github/
         └── workflows/ (deploy, lint, test)
     ```
   - What goes in: TypeScript/Python job definitions, resource configs, library code, documentation
   - What does NOT go in: Secrets, credentials (Windmill secrets manager)

3. **cornerstone-infrastructure** (Config & Ops)
   - Contains: Docker configs, environment templates, deployment runbooks, monitoring configs
   - Structure:
     ```
     cornerstone-infrastructure/
     ├── docker/
     │   ├── windmill-docker-compose.yml
     │   └── local-dev-setup/
     ├── configs/
     │   ├── netlify.toml (template)
     │   ├── environment-template.env
     │   └── deployment-checklist.md
     ├── runbooks/
     │   ├── emergency-rollback.md
     │   ├── windmill-migration-phase-[n].md
     │   └── production-deployment-process.md
     └── monitoring/
         ├── windmill-health-checks/
         └── error-tracking-setup/
     ```
   - What goes in: Infrastructure as code, deployment procedures, monitoring configs
   - What does NOT go in: Production credentials, live API keys

### GitHub Workflows (CI/CD) to Setup

**For cornerstone-apps:**
```yaml
# On push to main branch:
1. Lint (eslint, prettier)
2. Build (verify React builds)
3. Run tests (if present)
4. Deploy to Netlify (main → production)

# Pull requests:
1. Lint check
2. Build check
3. Require code review before merge
```

**For windmill-workflows:**
```yaml
# On push to main branch:
1. Lint (TypeScript, Python)
2. Type check (TypeScript)
3. Unit tests (if present)
4. Deploy to Windmill (via windmill CLI)

# Pull requests:
1. Lint check
2. Type check
3. Dry-run Windmill deployment
4. Require code review before merge
```

### Access & Permissions

- **Marc:** Full access (admin)
- **Build agents (Claude Code):** Read access (pull code, propose changes via PR)
- **Deployment systems:** Read + deploy access (GitHub Actions, Windmill CLI)
- **Team members (if any):** TBD based on future structure

### Success Metrics (This Week)

- ✅ Three repos created + formatted
- ✅ All current app code committed to cornerstone-apps
- ✅ Windmill repository structure ready (even if n8n still running)
- ✅ Infrastructure repo started with runbooks
- ✅ CI/CD workflows running (lint, build, deploy)
- ✅ All team members can pull code and understand structure
- ✅ Rollback path documented and tested

---

## 2. REPOSITORIES/PROJECTS FORMALIZED FIRST

### Tier 1 (Formalize This Week)

**cornerstone-apps** (Frontend foundation)
- **Why first:** 5 apps already live on Netlify (Beaverly, Family Finance, Luke, Peptide, Command Center)
- **Action:** Pull latest version of each app into GitHub, setup CI/CD to Netlify
- **Timeline:** 2-3 days
- **Risk:** Low (Netlify deploys from git anyway, just formalizing)
- **Benefit:** Immediate version control, instant rollback ability

**windmill-workflows** (Automation foundation)
- **Why concurrent with apps:** Windmill setup starts next week, but repository structure should be ready
- **Action:** Create repository structure, document what will go where, setup CI/CD template
- **Timeline:** 1-2 days
- **Risk:** Low (just structure, no migration yet)
- **Benefit:** Ready to onboard jobs as Phase 1 migration starts

### Tier 2 (Formalize By End of Week)

**cornerstone-infrastructure** (Operations foundation)
- **Why after apps/workflows:** Foundation for deployment + monitoring
- **Action:** Document current deployment processes, create runbooks, setup monitoring configs
- **Timeline:** 2-3 days
- **Risk:** Low (documentation only initially)
- **Benefit:** Clear deployment procedures, easier rollback, knowledge transfer

### Documentation Repositories (Parallel)

**cornerstone-docs** (Design briefs, QA reports, architecture decisions)
- Location: GitHub + SHARED-BRAIN.md (two sources during transition)
- What goes in:
  - Design briefs (DESIGN-BRIEF-[APP].md)
  - QA validation reports (QA-VALIDATION-REPORT-[FEATURE].md)
  - Architecture decision records (ADR-[number].md)
  - Runbooks + troubleshooting

---

## 3. DESIGN DIRECTION AGENT — FIRST REAL APPLICATION

### First App to Apply Design Governance To

**Peptide Resource App** (Current state: design brief complete, visual system in progress)

**Why Peptide first:**
- Revenue-critical (customer-facing, affects sales)
- Data-heavy UI (complex, benefits from design governance)
- Good showcase for design system (proves methodology works)
- Timeline aligned (design brief already done, build starts this week)

**Execution Plan This Week**

**Day 1 (Mon Apr 13):**
- Design Direction Agent produces: PEPTIDE-RESOURCE-APP-VISUAL-SYSTEM.md
  - Complete atom library (colors, typography, spacing, icons, shadows, radius)
  - Design tokens (YAML/JSON format)
  - All 50+ components fully specified
- Output: Comprehensive design system + tokens ready for Build Agent

**Day 2-3 (Tue-Wed Apr 14-15):**
- Design Direction Agent produces: PEPTIDE-RESOURCE-APP-UI-HANDOFF-TO-BUILD.md
  - Component checklist (what to build, priority order)
  - Test criteria (how to validate each component)
  - Design tokens as code-ready JSON
  - Accessibility checklist (WCAG AA built-in)
- Output: Build Agent has complete, unambiguous specifications

**Day 4-5 (Thu-Fri Apr 16-17):**
- Claude Code (Build Agent) starts building Peptide UI based on specs
- Tests against design specs (component-by-component)
- Commits to GitHub

**Success Criteria:**
- ✅ Design brief complete + detailed
- ✅ Visual system + tokens documented
- ✅ Build Agent receives zero-ambiguity specs
- ✅ Build can start immediately without questions
- ✅ Future apps will follow same process (methodology proven)

### Second App to Apply Design Governance To

**Vault OS** (Multi-client financial dashboard)
- Start design governance: Following week (after Peptide design complete)
- Timeline: Parallel with Peptide build

---

## 4. QA VALIDATION AGENT — FIRST REAL APPLICATION

### First Product to Apply QA Gate To

**Founder Command Center** (Already deployed, incomplete QA audit)

**Why Command Center first:**
- Already built + live (low risk to validate)
- Good test case for QA methodology
- Proves process works before applying to revenue products
- Quick feedback loop (can find/document issues)

**Execution Plan This Week**

**Day 1-2 (Mon-Tue Apr 13-14):**
- QA Agent: Full validation of Command Center
  - Critical paths testing (search, filter, card interactions, add task, checkboxes)
  - Component testing (all buttons, forms, modals)
  - Integration testing (data persistence, localStorage, etc.)
  - Accessibility audit (WCAG AA compliance)
  - Edge cases (empty states, errors, limits)
- Output: QA-VALIDATION-REPORT-FOUNDER-COMMAND-CENTER.md
- Verdict: PASS (with recommendations) or FAIL (with blocking issues)

**Day 3 (Wed Apr 15):**
- If FAIL: Document issues, prioritize fixes, retest
- If PASS: Sign off on release status + create rollback documentation

**Success Criteria:**
- ✅ Complete QA audit completed in <2 hours
- ✅ Clear PASS or FAIL verdict (binary, no ambiguity)
- ✅ All non-negotiable standards verified (accessibility, critical paths, integrations)
- ✅ QA methodology proven to work

### Second Product to Apply QA Gate To

**Peptide Resource App** (After build complete)
- Timeline: End of week (after Build Agent finishes initial UI)
- Process: Full QA validation against design specs + non-negotiable standards

---

## 5. FINAL PHASE 1 WINDMILL MIGRATION START PLAN

### Why Phase 1 Starts Next Week (Not This Week)

**This week focuses on:**
1. GitHub formalization (foundation)
2. Design governance (Peptide design system)
3. QA governance (Command Center audit)
4. Standardized build flow (enforcement)

**Windmill migration starts Week 2** because:
- Team needs to see GitHub + design + QA governance working first
- Migration pattern needs to be clear (less chaos with new systems)
- Windmill environment setup takes time (Docker, testing, CI/CD)

### Phase 1 Windmill Migration (Revised, Payment-Safe)

**Changed to priority order:**

**Migration 1: APOLLOS Daily** (Mon-Wed Apr 21-23)
- Function: Daily content generation + post to LinkedIn + Instagram
- Current: n8n workflow running 7:30 AM Mon-Fri
- Windmill job: TypeScript script using Anthropic API + Bannerbear + Buffer
- Risk: Low (isolated, no payment/data writes)
- Testing: Run parallel with n8n (Windmill runs, outputs saved, compare with n8n)
- Success: Same content quality, same schedule, no failures
- Timeline: 2-3 days
- Cutover: Friday (switch from n8n to Windmill)

**Migration 2: EZRA Morning Briefing** (Thu-Fri Apr 23-24)
- Function: Daily market briefing generation
- Current: n8n workflow running 7 AM daily
- Windmill job: TypeScript script using Perplexity API + email
- Risk: Low (isolated, just emails)
- Testing: Run parallel with n8n (compare outputs)
- Success: Same briefing quality, emails send on time
- Timeline: 1-2 days
- Cutover: Saturday (switch from n8n to Windmill)

**HOLD Stripe Payment Workflow** (Until pattern proven)
- Current: n8n webhook → Stripe → Airtable order creation
- Risk: High (revenue-critical, payment processing)
- Wait: Until APOLLOS + EZRA running stable in Windmill for 1 week
- Then: Migrate Stripe → CONFIRMED safe pattern → test thoroughly before cutover

### Phase 1 Success Criteria

- ✅ APOLLOS Daily running in Windmill, no failures, same output quality
- ✅ EZRA Morning Briefing running in Windmill, same schedule, same content
- ✅ Both workflows running stable for 1 week before proceeding to Phase 2
- ✅ Team confidence in Windmill migration pattern established
- ✅ n8n still running both as backup (parallel operation)
- ✅ When confident, cutover n8n → Windmill fully

### Phase 1 Timeline

- **Monday Apr 21:** Windmill environment setup + APOLLOS Daily migration start
- **Wednesday Apr 23:** APOLLOS Daily running in Windmill, EZRA migration start
- **Friday Apr 25:** EZRA running in Windmill
- **Saturday Apr 26 - Friday May 2:** Both stable, monitoring, Phase 1 complete
- **Following Monday:** Assess Phase 2 readiness (DANIEL Research, SOLOMON Lead Qualifier)

---

## SUMMARY: THIS WEEK'S EXECUTION (LOCKED)

### Mon Apr 13 - Fri Apr 17

| Day | Priority 1 | Priority 2 | Priority 3 | Priority 4 |
|---|---|---|---|---|
| **Mon** | GitHub: cornerstone-apps structure | Design: Peptide visual system | QA: Command Center audit | Build flow: Document standards |
| **Tue** | GitHub: cornerstone-workflows structure | Design: Peptide tokens (JSON/YAML) | QA: Command Center audit complete | Build flow: Team training |
| **Wed** | GitHub: cornerstone-infrastructure structure | Design: Peptide handoff to Build | QA: Report + verdict | Build flow: Enforce no shortcuts |
| **Thu** | GitHub: CI/CD setup + first deployments | Design: Complete (Peptide) | QA: Second product start (Peptide if built) | Standardized: Lock sequence |
| **Fri** | GitHub: All code committed + rollback tested | Design: Second app starts (Vault) | QA: Reports submitted + archived | Execution: All week locked |

### Success Metrics (This Week)

✅ GitHub formalized (3 repos, CI/CD working, code deployed)  
✅ Design Direction Agent applied to Peptide (visual system + tokens + handoff)  
✅ QA Validation Agent applied to Command Center (audit complete, verdict clear)  
✅ Standardized build flow enforced (no requests bypass design → build → QA)  
✅ Team trained on new governance + workflow  
✅ Windmill preparation begins (environment setup, Phase 1 plan locked)  

---

## NEXT WEEK (Starting Apr 21)

- ✅ Windmill Phase 1 migration: APOLLOS Daily + EZRA Morning Briefing
- ✅ Continue design governance: Vault OS design brief + visual system
- ✅ Continue QA governance: Peptide Resource App full validation
- ✅ Build: Peptide UI (based on design specs from this week)

---

**EXECUTION ORDER IS LOCKED & READY**

GitHub → Design → QA → Windmill (in that order, with Phase 1 Windmill safeguards for payments).

This week: Foundations. Next week: Operations at scale.

