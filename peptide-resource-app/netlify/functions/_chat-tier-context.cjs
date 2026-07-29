/**
 * _chat-tier-context.cjs
 * ============================================================================
 * Shared server-side tier-matrix summary consumed by BOTH:
 *   - vitalis-chat-background.js (main conversational chat)
 *   - find-protocol.js (compound-finder endpoint)
 *
 * Purpose: keep the chat AI's recommendations CONSISTENT with the app's
 * Protocol pages. When the user asks "I want to lose weight" the chat should
 * surface the Eric-Davuly fat-loss pattern (matches /protocol/fat-loss) — NOT
 * improvise a different stack.
 *
 * ⚠️ SINGLE SOURCE OF TRUTH DISCIPLINE ⚠️
 * This file MIRRORS the data in `src/data/stacks.js`. When stacks.js changes:
 *   1. Update the corresponding tier here.
 *   2. Verify the SKU references against `luke-app/public/catalog-data.json`.
 *   3. Run `npm run build` to confirm no breakage.
 *
 * Why duplicated as .cjs: Netlify Functions are CommonJS; stacks.js is ESM.
 * Until a build-time bridge exists, this file is the discipline gate.
 *
 * REWRITTEN 2026-05-20 after Marc-approved tier matrix.
 * SUPERSEDES the inline STACK_LIBRARY_SUMMARY constant in
 * vitalis-chat-background.js (which had drifted from the app).
 * ============================================================================
 */

const TIER_MATRIX_SUMMARY = `## CANONICAL STACK LIBRARY — LIGHT / MODERATE / ADVANCED TIERS

⚠️ When the user states a goal, recommend the stack from THIS library that matches their indication. Default to the MODERATE tier unless they explicitly request the Light entry or the Advanced "go all out" version. Each tier is ADDITIVE — Advanced contains everything in Moderate which contains everything in Light, plus the tier-specific extras (single deliberate exception flagged where it applies).

### 🔥 FAT LOSS (Eric Davuly pattern)
- **Light:** Reta solo · 16 wks · 2→4 mg titration (entry / first-time user)
- **Moderate:** + MOTS-c (5 mg wkly Tuesday) + SS-31 (5 mg/day × 8 wks Wks 1–8 only) + Ipamorelin (200 mcg PM) + Cagrilintide (titrated 0.25→2.4 mg/wk Sunday — amylin satiety; STANDING DEFAULT fat-loss adjunct)
- **Advanced:** + Tesamorelin (2 mg/day AM — visceral fat T1)
- **NOTE:** Cagrilintide is the STANDING DEFAULT amylin/satiety arm for fat loss — present from Moderate up (pairs additively with the Reta incretin base; the CagriSema rationale). T1 evidence: Lau Lancet 2021 (monotherapy 6.0–10.8% weight loss, beat liraglutide 3.0 mg); Enebo Lancet 2021 (cagrilintide + semaglutide → 17.1% at wk 20). Mechanism via brain amylin receptors / area postrema — a GLP-1-separate pathway. CJC-1295 deliberately NOT in any tier — GHRH receptor redundancy with Tesa. Ipamorelin (GHS-R1a) carries forward across all tiers; Tesa adds the GHRH layer in Advanced only.

### 🩹 HEALING & RECOVERY (Mike/Renee KLOW lineage)
- **Light:** BPC-157 + TB-500 (classic duo)
- **Moderate:** **KLOW blend** (BPC 10 + TB 10 + KPV 10 + GHK 50 in one freeze-dried vial · 10 IU SubQ M-F)
- **Advanced:** + TA-1 (1.6 mg SubQ 2×/wk) + NAD+ (250 mg M/W/F)
- **Recommended SKU for Moderate+:** KLOW-FD (single vial replaces 4 separates)

### ✨ ANTI-AGING
- **Light:** NAD+ nasal spray (50 mg × 2/day continuous)
- **Moderate:** + Epitalon (5–10 mg/day × 20 days 1–2× yr) + CJC + Ipa
- **Advanced:** + GHK-Cu (1–2 mg/day) + SS-31 (5 mg/day × 8 wks twice yearly) + MOTS-c (5 mg wkly)

### 🌟 ENERGY & VITALITY 40+ (Beaulieu pattern — multi-functional overlap with Anti-Aging is intentional)
- **Light:** NAD+ spray alone
- **Moderate:** + CJC + Ipa (sleep + GH-driven recovery)
- **Advanced:** + MOTS-c + SS-31 (Wks 1–8 cycle) · the full 4-lever Beaulieu pattern

### 🌱 MALE FERTILITY (Fabricio pattern — Kisspeptin pulsatile MANDATORY)
- **Light:** Kisspeptin-54 300 mcg SubQ M/W/F (NEVER daily — desensitizes KISS1R in 48h)
- **Moderate:** + CJC + Ipa (HPG-friendly GH support)
- **Advanced:** + HCG (500 IU SubQ 2–3×/wk for hypogonadal cases) + NAD+ (sperm mito)

### ⚡ MITOCHONDRIAL REPAIR (Tony pattern)
- **Light:** NAD+ alone (SubQ cyclic OR nasal continuous)
- **Moderate:** SS-31 5 mg/day evening Wks 1–8 + NAD+ 250 mg M/W/F (Wks 1–13)
- **Advanced:** + MOTS-c (5 mg wkly) + **Humanin** (100–200 mcg/day) — Humanin is the canonical mito-derived peptide with cardiac mito evidence (PMID 28802666)
- **NOTE:** Cardiogen is NOT in Mito Repair tiers. It's cardiac-fibrotic (Ac-SDKP), wrong mechanism for mito repair. Cardiogen lives in Menopause Advanced.

### 💪 PERFORMANCE & MUSCLE
- **Light:** Ipamorelin alone
- **Moderate:** CJC + Ipa + TB-500 2.5 mg 2×/wk
- **Advanced:** + IGF-1 LR3 (30–50 mcg/day × 4-wk cycles only) + **Follistatin 344** (myostatin inhibition)
- **NOTE:** Tesamorelin NOT in Performance tiers — Tesa's evidence is visceral fat (HIV lipodystrophy), not muscle accretion. Tesa lives in Fat Loss Advanced.

### 🧠 COGNITIVE & FOCUS
- **Light:** Semax 600 mcg intranasal AM
- **Moderate:** + Selank 300 mcg intranasal AM/PM
- **Advanced:** + **Dihexa** (T4 EXPERIMENTAL — flag this explicitly; no published human evidence; Athira Pharma fosgonimeton pro-drug failed Phase 2/3 ACT-AD 2023–24) + NAD+

### 🌙 SLEEP & RECOVERY
- **Light:** DSIP 100–250 mcg SubQ pre-bed
- **Moderate:** + AC-Selank 300 mcg intranasal pre-bed (recommend pre-compounded pen PEN-AC-SELANK-DELTA)
- **Advanced:** + CJC + Ipa pre-bed (GH pulse during slow-wave window)

### 🛡️ IMMUNE RESTORATION
- **Light:** TA-1 1.6 mg SubQ 2×/wk
- **Moderate:** + BPC-157 250–500 mcg/day (gut-immune axis)
- **Advanced:** + NAD+ + KPV 250 mcg/day + LL-37 100–500 mcg/day

### 🌸 MENOPAUSE SUPPORT
- ⚠️ **MANDATORY DISCLOSURE on every menopause recommendation:** "Peptides are ADJUNCTIVE — they are NOT HRT replacement. NAMS and Menopause Society recommend systemic estrogen as first-line for vasomotor symptoms."
- **Light:** GHK-Cu (1–2 mg/day) + NAD+ spray (skin/collagen + energy)
- **Moderate:** + PT-141 1–2 mg SubQ as-needed (HSDD libido — FDA-approved Vyleesi mechanism)
- **Advanced:** + Cardiogen (5–10 mg/day SubQ × 10–30 days 1–2× yr — post-menopausal CV protection)
- **NOTE:** Kisspeptin deliberately NOT in Menopause Moderate. Post-menopausal ovaries are largely unresponsive to LH/FSH so HPG amplification has low yield. PT-141 is the higher-value addition.

## PAIRING RULES — when these compound pairs appear in a recommendation, surface the pre-compounded combo pen for operational simplicity

| When recommendation includes... | Recommend Combo SKU | Why |
|---|---|---|
| SS-31 + Cardiogen | PEN-SS31-CARDIOGEN | Marc's rule: always offer SS-31 + Cardiogen as the combined pen — dose-consistent, single injection |
| CJC-1295 + Ipamorelin | PEN-IPA-CJC1295 | GHRH + GHS in one injection |
| VIP + MOTS-c | PEN-VIP-MOTSC | Pre-compounded for post-COVID / mito-immune work |
| AC-Selank + DSIP | PEN-AC-SELANK-DELTA | Combined sleep onset + deep architecture |
| BPC-157 + TB-500 | PEN-TB500-BPC157 OR KLOW-FD if KPV+GHK also needed | Healing duo or full quad |
| BPC + TB + KPV + GHK (all four) | KLOW-FD | The freeze-dried quad blend |

## DRIFT-PREVENTION RULES (override prior chat behavior)
1. Do NOT reference "GLOW-KPV-BOX10" SKU — it has been RETIRED as a duplicate of KLOW. Recommend KLOW-FD instead.
2. Do NOT recommend "Tesamorelin + CJC-1295" together — they are GHRH-receptor-redundant. Pick one (Tesa for fat loss, CJC for energy/anti-aging/etc).
3. Do NOT position KLOW as "the canonical hero of healing" — it's the Moderate-tier healing protocol. Light uses BPC+TB alone; Advanced adds TA-1+NAD+.
4. NAD+ canonical Vitalis SOP is 250 mg × 3/wk SubQ = 750 mg/wk hold dose (Mon/Wed/Fri PM slow-push, Wk 1 tolerance check at 100 mg Day 1). Nasal spray for continuous use is 50–100 mg × 2/day. Do NOT recommend 100 mg single SubQ dose as a hold dose.
5. SS-31 canonical SOP is 5 mg/day × 8 weeks twice yearly (Spring + Fall), NOT continuous. Forzinity FDA-approved at 40 mg/day for Barth syndrome; 5 mg/day is practitioner-consensus for healthy mitochondrial optimization.
6. MOTS-c canonical SOP: 5 mg solo weekly (e.g. Tuesday), OR 5 mg × 3/wk T/Th/Sat when stacked with SLU-PP-332 (alternate days — NEVER co-dose with SLU same day).
7. Kisspeptin-54: 300 mcg pulsatile M/W/F. NEVER daily continuous — desensitizes KISS1R within 48h.
8. Oxytocin has been REMOVED from the peptide offering. Do not recommend.
`;

module.exports = { TIER_MATRIX_SUMMARY };
