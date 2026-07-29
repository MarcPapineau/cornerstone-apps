# Vitalis Visual-QA & Anti-Drift Runbook

*Part of the Vitalis anti-drift enforcement sprint · 2026-06-03 · How to run, read, and maintain the drift gates. No deploy/push/commit is part of this workflow.*

This runbook covers the **mechanical drift gates** that make the eight known Vitalis regressions fail tests/build instead of shipping silently. It assumes you run everything from `luke-app/vitalis-resource-app/`.

---

## 0. The gates at a glance

| Gate | Command | What it catches | Blocking? |
|---|---|---|---|
| **Acceptance suite** (data/model layer) | `npm test` | dosing/schedule/projection/doctrine drift in `@vitalis/protocol-core` output (107 checks incl. SS*, SG*, PS*, OSP*, RD1–RD6, PD*) | **Yes — runs in `prebuild`** |
| **Catalog + dosing guard** (source layer) | `npm run check:catalog` | parallel dosing authority, `normalizedDosing`, ad-hoc schedule construction, KLOW vial-math, catalog economics/discount leaks | **Yes — runs in `prebuild`** |
| **Build** | `npm run build` | runs both gates above, then `vite build` | **Yes** |
| **Visual / DOM QA** (rendered layer) | `npm run test:visual` | `/portal/protocols` regressing vs the old Vitalis standard; thin-card regressions; empty/blank dashboards; Route-Not-Found | Yes (run in CI / before sign-off) |

**Golden rule:** `npm test` + `npm run build` passing is **required but not sufficient**. A document/dashboard change is not "done" until `npm run test:visual` is green **and** a human has eyeballed the rendered page. Never call a task complete because the code compiles or the node tests pass (`VITALIS-BUILD-PROTOCOL.md` §8/§9).

---

## 1. How to run the acceptance tests

```bash
npm test          # node test/acceptance.js — dependency-free, ~1–2s, exercises the REAL engine
```
Expected: `107/107 checks passed. All acceptance tests passed.` Any failure is a hard stop. The suite is also run automatically by `prebuild`, so `npm run build` fails if any check is red.

## 2. How to run the Vitalis visual tests

The visual harness is **separate** from the outer LUKE order app's Playwright config — it always uses an explicit `--config`, targets the Vitalis SPA on `:5173` (which proxies `/api` → `:3100`), and reuses the root-installed `@playwright/test` (no new dependency).

```bash
# First time on a machine (or after an INTENTIONAL visual change) — capture/refresh baselines:
npm run test:visual:update

# Normal run — assert DOM + diff screenshots against committed baselines:
npm run test:visual

# Inspect a failing run (diffs, traces, screenshots):
npm run test:visual:report
```
- The harness **auto-starts** the app (`npm run dev:all`) via Playwright's `webServer`; you do **not** need a server running first. If you already have `dev:all` up on `:5173`, it is reused.
- For a clean, deterministic baseline, the runner can reset demo data first: `POST /api/admin/reset-demo` (the Admin → System Health "Reset demo data" button). The rich approved client is **`demo_kristen_a`** (belongs to practitioner **`pr_morgan`** — see the ownership note in §5).

## 3. What is checked

**DOM/text assertions are the hard gate; screenshots guard layout/structure.** Both live in `tests/visual/`.

Screenshots captured (baselines committed under `tests/visual/__screenshots__/`):
- **Protocol dossier cover** (`.vdoc` header) — brand fingerprint.
- **Section 02 — Selected Protocol Schedule** (`table.vd-sched--weekly`) — the highest-risk surface (thin-card / range-as-dose drift shows here first).
- **Section 05 — Physiological Monitoring** (`.vd-signalgrid`) — the richest "depth" surface.
- **Full-page dossier** (`.vdoc`) — whole-spine / missing-section regressions.
- **One dashboard per role** (client `/portal`, practitioner `/practice`, admin `/admin`).

Key DOM assertions on `/portal/protocols` (rendered React, not legacy HTML):
- Cover: `Vitalis Research`, `Research Documents · Educational Use Only`, approved banner, `Referral physician`, `For physician review`.
- Section runheads (exact): `SECTION 01 · THE STACK & WHY` · `SECTION 02 · SELECTED PROTOCOL SCHEDULE` · `SECTION 03 · COMPOUND / BLEND REFERENCE` · `SECTION 04 · SUPPORTIVE LIFESTYLE` · `SECTION 05 · PHYSIOLOGICAL MONITORING`.
- S01: `.vd-statband` with `Weeks total` + `Schedules selected`; ≥3 compound cards (KLOW, DSIP, Selank).
- **S02 (KLOW): `KLOW 10 IU` · weekly translation `2.5mg BPC-157 · 2.5mg TB-500 · 2.5mg KPV · 10mg GHK-Cu per week` · `not per dose, not per day` · `PHASE MILESTONE` · `co-lyophilized blend` (one column, not four).**
- **S02 (selected doses): DSIP `100 mcg`, Selank `250 mcg`** — and **no broad range** (`100–300`, `250–750`) appears as a selected dose in S02 (ranges live in S03 only).
- S05: `Three distinct response patterns` · `Expected adaptation · observe` / `Meaningful drift · check in` / `Stop now · physician same day` · `Re-evaluation checkpoints` · contraindications · `Strictly for research and educational purposes.`

## 4. How to update baselines safely

A baseline update is a **reviewed drift event**, never a reflex:
1. Run `npm run test:visual`. On a screenshot failure, open `npm run test:visual:report` and look at the **expected vs actual vs diff**.
2. Decide: is the change **intended** (a real, approved design/content update) or a **regression**?
   - **Regression** → fix the cause (or, per doctrine, STOP and report — do **not** weaken the test to make it pass).
   - **Intended** → run `npm run test:visual:update`, then **commit the new baselines in the same PR as the change that caused them**, with a one-line reason. Never update baselines in a PR whose purpose is unrelated.
3. DOM-assertion failures are almost never "update the baseline" — they mean the page no longer renders the required standard content. Treat them as content regressions.

## 5. What failures mean (mapped to the 8 documented Vitalis regressions)

| If this fails… | …it caught | Sprint case |
|---|---|---|
| S01/S02 screenshot diff; `.vd-statband`/`.vd-card` assertions | protocol page regressed to **thin cards** | 1 |
| S02 runhead/`PHASE MILESTONE`/table assertions | **Section 02 stopped matching the old schedule standard** | 2 |
| `KLOW 10 IU` / translation / `co-lyophilized blend` assertions; guard Check 7 (`12.5/50/70 mg`) | **KLOW dosing/translation drifted** | 3 |
| "no broad range in S02" assertion; acceptance PS1/SG2 | **selected dose replaced by a broad range** | 4 |
| guard Check 6 (`normalizedDosing`, parallel definer, ad-hoc schedule) | **code bypassed the canonical dosing/document engine** | 5 |
| acceptance SG6/OSP6/P1/P3 | **client portal leaked a draft / operator field** | 6 |
| smoke-test "non-empty `<main>` + no console error + no `Route not found`" | **dashboard/page silently rendered empty/light** | 7 |
| acceptance RD1–RD6 | **WHO/NIH/gov evidence doctrine drifted back into app-facing authority** | 8 |

## 6. Source-of-truth guards added this sprint (so the above can't recur)

- **`prebuild` now runs the acceptance suite** (`check-catalog-guard.cjs && test/acceptance.js`) → all 107 data-layer checks are **build-blocking**, not advisory.
- **`check-catalog-guard.cjs` Check 6** — the dosing engine is defined **only** in `packages/protocol-core/data/dosing.js`; `src/`/`server.js`/`lib/` may call it but never define a parallel authority, reference `normalizedDosing`, or build a schedule object ad-hoc.
- **`check-catalog-guard.cjs` Check 7** — forbids drifted KLOW vial-math (`12.5/17.5 mg BPC-157`, `50/70 mg GHK-Cu`, `12.5 mg GHK`) on the Vitalis surface + the canonical engine.
- **acceptance RD5 / RD6** — RD5 proves the WHO/NIH exclusion + evidence-authority refusal **actively** drop a planted source (not just that the seed is clean); RD6 proves no shipped citation is a blank/fabricated placeholder.

## 7. Who reviews failures

- **Drift gate failures** (acceptance / catalog guard / visual DOM): the engineer making the change fixes the cause or escalates; per `VITALIS-BUILD-PROTOCOL.md` §4 a repeated same-class failure becomes a `DRIFT DETECTED` memo, not a third patch.
- **Protocol-content / standard questions** (does the rendered dossier still match the Vitalis standard?): **Marc**, against the Eric PDF / `02-eric-protocol-guide.html` reference.
- A visual **baseline update** must be reviewed by whoever owns the design standard before merge.

## 8. Known punch-list (recorded, NOT fixed this sprint)

These were found during discovery; they are out of scope for the enforcement sprint and must not be silently patched:
1. **`peptide-resource-app/src/data/stacks.js:193`** still carries the stale `12.5 mg GHK` KLOW value (the corrected value is `10mg GHK-Cu`). This is a **separate, older app** — Check 7 is scoped to the Vitalis surface + `protocol-core` (where it is absent), so it does not break the Vitalis build. Reconcile `stacks.js` in a peptide-app sprint.
2. **Demo data (corrected via live verification 2026-06-03):** the canonical seed now **populates** `demo_kristen_a`'s labs (hs-CRP, Ferritin, Magnesium, Vitamin D, AST, ALT — several out-of-range), so `/portal/labs` is rich, not empty. `/portal/progress` (outcomes) may still be sparse. The smoke tests assert the `My Labs` / `My Progress` headings and tolerate either a populated or an intentional-empty state, so a future seed change in either direction won't false-fail.
3. **`?silo=supplement|meal`** deep-links resolve to the same `/portal/add-ons` page (the param is inert) — cosmetic IA gap.
4. **`AGENTS.md`** (machine-loaded standing-orders, roadmap Phase 1) is **not yet created** — recommended next, separate from this sprint.

## 9. Hard rules

- **No deploy. No push. No commit.** This workflow ends at green local gates + visual evidence.
- **Never weaken a gate to make it pass.** A red gate is a finding, not an obstacle.
- **Do not patch the product UI to satisfy a visual test** — if `/portal/protocols` fails the old-standard assertions, that is a reportable drift in the *product*, surfaced (correctly) by the gate.
