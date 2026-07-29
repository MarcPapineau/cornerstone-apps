// ============================================================================
// STACKS — Marc Papineau's canonical Vitalis protocols (TIERED)
// ============================================================================
// ⚠️ CHAT-APP SYNC DISCIPLINE ⚠️
// The chat AI (vitalis-chat-background.js + find-protocol.js via
// vitalis-system-prompt.js) references the tier matrix from
// `netlify/functions/_chat-tier-context.cjs`. When you change any tier here,
// you MUST mirror the change in `_chat-tier-context.cjs` so the chat and
// the app render IDENTICAL recommendations. Drift between the two violates
// the Operational Truth Doctrine (the app cannot contradict itself).
// ============================================================================
// Each indication offers Light / Moderate / Advanced tiers. Pattern is
// ADDITIVE — Advanced contains everything in Moderate which contains
// everything in Light, plus the tier-specific extras. Single exception:
// GHRH receptor redundancy (Tesa vs CJC) — see Fat Loss & Performance,
// where CJC sits in Moderate and is REPLACED by Tesa in Advanced (Ipa
// carries forward as the GHS-R1a partner for both).
//
// REWRITTEN 2026-05-20 after evidence-tiered research dispatch (Daniel-style
// validation) + Marc approval. Reconciles 6 critical findings:
//   1. GHRH redundancy fixed (CJC moderate / Tesa advanced for fat loss + perf)
//   2. Cardiogen relocated from Mito Repair → Menopause (Ac-SDKP is cardiac-
//      fibrotic, NOT mito-repair)
//   3. Humanin promoted to Mito Repair Advanced (canonical mito-derived peptide)
//   4. Follistatin 344 in Performance Advanced (muscle anabolic, not Tesa)
//   5. Dihexa kept in Cognitive Advanced with explicit T4-experimental flag
//      (Operational Truth — Athira pro-drug failed Phase 2/3 ACT-AD 2023-24)
//   6. Menopause: Light gains NOT-HRT disclosure, Moderate swaps Kisspeptin →
//      PT-141 (post-meno ovaries unresponsive to LH/FSH), Advanced gains
//      Cardiogen for CV protection
//
// Vitalis SOP canonical doses preserved throughout:
//   NAD+ 250mg × 3/wk = 750mg/wk hold (Mon/Wed/Fri PM slow-push, Wk 1
//     tolerance check)
//   SS-31 5mg/day × 8 weeks twice yearly (Spring + Fall, NOT continuous)
//   MOTS-c 5mg solo weekly OR 5mg × 3/wk T/Th/Sat if stacked with SLU
//   Kisspeptin-54 300mcg M/W/F pulsatile (NEVER daily — desensitizes in 48h)
//   KLOW 10 IU SubQ M-F (= 2.5mg BPC + 2.5mg TB + 2.5mg KPV + 12.5mg GHK/wk)
//
// Schema: each entry has flat compatibility fields (compounds, tagline,
// description) that mirror the DEFAULT tier (moderate). New tier-aware
// consumers read `tiers.{light,moderate,advanced}`.
// ============================================================================

// -- pairing rules: surface combo pens when component pair appears together --
export const PAIRING_RULES = [
  {
    when: ['ss31', 'cardiogen'],
    recommendSku: 'PEN-SS31-CARDIOGEN',
    label: 'SS-31 + Cardiogen Pen',
    message: 'When SS-31 and Cardiogen appear together, ship the pre-compounded pen — single SubQ injection, dose-consistent, simpler for the client.',
  },
  {
    when: ['cjc', 'ipamorelin'],
    recommendSku: 'PEN-IPA-CJC1295',
    label: 'CJC-1295 + Ipamorelin Pen',
    message: 'CJC + Ipamorelin together = use the combined pen for clean GHRH + GHS dual-receptor action in a single injection.',
  },
  {
    when: ['vip', 'motsc'],
    recommendSku: 'PEN-VIP-MOTSC',
    label: 'VIP + MOTS-c Pen',
    message: 'VIP + MOTS-c pre-compounded pen is the operationally simpler form.',
  },
  {
    when: ['selank', 'dsip'],
    recommendSku: 'PEN-AC-SELANK-DELTA',
    label: 'AC-Selank + Delta Sleep Pen',
    message: 'AC-Selank-NH2 + DSIP pre-compounded for combined sleep-onset + deep-sleep architecture.',
  },
  {
    when: ['bpc157', 'tb500'],
    recommendSku: 'PEN-TB500-BPC157',
    label: 'BPC-157 + TB-500 Pen',
    message: 'Classic healing duo — pre-compounded pen for daily injection convenience.',
  },
  {
    when: ['bpc157', 'tb500', 'kpv', 'ghkcu'],
    recommendSku: 'KLOW-FD',
    label: 'KLOW — Quad Repair Blend',
    message: 'All 4 healing peptides in one freeze-dried vial. Standard KLOW protocol = 10 IU SubQ M-F.',
  },
];

// Helper: given a compound list, find applicable pairing rules
export function getApplicablePairings(compoundIds) {
  const set = new Set(compoundIds);
  return PAIRING_RULES.filter(rule => rule.when.every(id => set.has(id)));
}

// Helper: given a stack ID + tier name, return that tier's compounds + meta
export function getStackTier(stack, tierName = 'moderate') {
  if (!stack.tiers) return null;
  return stack.tiers[tierName] || stack.tiers.moderate || null;
}

// ============================================================================
// STACKS — 11 indications × 3 tiers each = 33 canonical protocols
// ============================================================================

export const STACKS = [

  // ── 1. FAT LOSS — Eric Davuly canonical lineage ────────────────────────────
  {
    id: 'fatloss',
    goal: 'Fat Loss',
    emoji: '🔥',
    defaultTier: 'moderate',
    referenceClient: 'Eric Davuly (May 2026)',
    // Legacy flat fields (mirror moderate tier for backward-compat)
    compounds: ['reta', 'motsc', 'ss31', 'ipamorelin', 'cagrilintide'],
    tagline: 'Progressive fat-loss optimization — Light → Moderate → Advanced',
    duration: '16 weeks',
    description: 'Three-tier escalation from Reta-only for first-time peptide users through the full Eric-Davuly Reta + mito + GH + amylin-satiety (Cagrilintide) stack to the advanced visceral-fat-targeted Tesamorelin layer.',
    confidence: 'T1', // Reta has T1 evidence; combination stacks T3+T4
    tiers: {
      light: {
        label: 'Light · Entry / First-Time User',
        compounds: ['reta'],
        tagline: 'Single-compound entry — lowest cost, simplest protocol',
        duration: '16 weeks',
        description: 'Retatrutide solo — the triple GIP/GLP-1/glucagon agonist anchoring fat loss. Conservative 2 mg → 4 mg titration (4 mg = practitioner sweet-spot for body-recomposition vs trial-maximum 12 mg). Best for first-time peptide users or budget-conscious clients.',
        dosing: 'Reta 2 mg SubQ Friday Wks 1–4 → 4 mg Wks 5–16 (optional 6 mg Wks 13–16 only with physician approval for plateau)',
        idealFor: 'First-time peptide users · single-injection-per-week preference · budget-conscious',
        evidenceTier: 'T1',
        keyStudies: [
          { compound: 'Retatrutide', citation: 'Jastreboff AM et al. NEJM. 2023;389:514–526. (PMID 37356317)', finding: 'Phase 2 RCT — 24.2% weight loss at 48wk; 4mg practitioner sweet-spot.' },
          { compound: 'Retatrutide', citation: 'TRIUMPH-4 Phase 3 readout 2025', finding: '28.7% weight loss at 68wk on 12mg dose.' },
        ],
      },
      moderate: {
        label: 'Moderate · Standard Fat-Loss Protocol',
        compounds: ['reta', 'motsc', 'ss31', 'ipamorelin', 'cagrilintide'],
        tagline: 'The Eric Davuly pattern — Reta + mitochondrial preservation + GH pulse + amylin satiety',
        duration: '16 weeks (SS-31 cycle Wks 1–8 only)',
        description: 'Adds four layers to the Light tier. MOTS-c preserves metabolic rate during the deficit (counters adaptive thermogenesis, the #1 cause of GLP-1 plateau). SS-31 runs an 8-week parallel cycle for mitochondrial structural support during the highest-demand front half. Ipamorelin adds a clean GH pulse for deep sleep + lipolysis + lean tissue preservation — no cortisol/prolactin elevation. Cagrilintide is the standing-default amylin/satiety arm — a long-acting amylin analogue that signals satiety through a GLP-1-separate pathway (brain amylin receptors / area postrema), pairing additively with Reta\'s incretin mechanism (the CagriSema rationale). NOTE: CJC-1295 deliberately NOT included to keep the GHRH receptor free for Tesamorelin upgrade in Advanced.',
        dosing: 'Reta 2→4 mg SubQ Friday · MOTS-c 5 mg SubQ Tuesday · SS-31 5 mg SubQ daily evening (Wks 1–8) · Ipamorelin 200 mcg SubQ daily PM · Cagrilintide titrated 0.25 → 2.4 mg SubQ Sunday',
        idealFor: 'Stubborn pounds · prior peptide experience · clients who plateaued on GLP-1 monotherapy · anyone wanting maximal appetite/satiety control',
        evidenceTier: 'T1+T3', // Reta + Cagrilintide carry T1 monotherapy evidence within a T3 combination
        keyStudies: [
          { compound: 'MOTS-c', citation: 'Reynolds JC et al. Nat Commun. 2021;12:470.', finding: 'AMPK / PGC-1α mitochondrial biogenesis — protects against age-related metabolic decline.' },
          { compound: 'SS-31', citation: 'Roshanravan B et al. PLOS One. 2021 (PMID 34292947)', finding: 'Single-dose elamipretide improved mitochondrial ATPmax in older adults.' },
          { compound: 'Cagrilintide', citation: 'Lau DCW et al. Lancet. 2021;398:2160–2172. (PMID 34798060)', finding: 'Phase 2 RCT (n=706): cagrilintide monotherapy 6.0–10.8% weight loss at 26wk; 4.5 mg beat liraglutide 3.0 mg (p=0.03). Amylin satiety via a GLP-1-separate pathway.' },
        ],
      },
      advanced: {
        label: 'Advanced · Full Visceral-Fat Stack',
        compounds: ['reta', 'motsc', 'ss31', 'ipamorelin', 'cagrilintide', 'tesamorelin'],
        compoundsSwap: { remove: ['cjc'], reason: 'GHRH receptor redundancy with Tesamorelin' }, // CJC was never added at moderate; documenting the design choice
        tagline: 'Maximum-effort stack — adds visceral-fat targeting on top of the satiety base',
        duration: '16 weeks (SS-31 cycle Wks 1–8)',
        description: 'Builds on Moderate (which already carries Cagrilintide as the standing satiety arm). Adds Tesamorelin — FDA-approved GHRH analogue with T1 evidence for visceral adipose tissue (VAT) reduction (HIV lipodystrophy trials, JAMA 2014). Works WITH Ipamorelin (GHS-R1a, different receptor — synergistic not redundant) and the Cagrilintide amylin satiety carried up from Moderate. Together: maximum hormonal hits across appetite, satiety, lipolysis, and visceral fat. For experienced peptide users or stubborn plateau-prone clients.',
        dosing: 'Reta 4 mg SubQ Friday · MOTS-c 5 mg SubQ Tuesday · SS-31 5 mg SubQ daily evening (Wks 1–8) · Ipamorelin 200 mcg SubQ daily PM · Cagrilintide titrated 0.25 → 2.4 mg SubQ Sunday · Tesamorelin 2 mg SubQ daily AM',
        idealFor: 'Advanced users · plateau-busting · clients with significant visceral fat',
        evidenceTier: 'T1+T3', // Tesa T1 for VAT, combination T3
        keyStudies: [
          { compound: 'Tesamorelin', citation: 'Stanley TL et al. JAMA. 2014. (PMC4679287)', finding: 'Tesamorelin reduced visceral adipose tissue in HIV-associated lipodystrophy patients in Phase 3 RCT.' },
          { compound: 'Cagrilintide + incretin', citation: 'Enebo LB et al. Lancet. 2021;397:1736–1748. (PMID 33894838)', finding: 'Phase 1b RCT: cagrilintide 2.4 mg + semaglutide 2.4 mg → 17.1% weight loss at wk 20 — amylin pathway adds additively to the incretin mechanism (CagriSema rationale).' },
        ],
      },
    },
  },

  // ── 2. HEALING & RECOVERY — Mike + Renee KLOW lineage ─────────────────────
  {
    id: 'healing',
    goal: 'Healing & Recovery',
    emoji: '🩹',
    defaultTier: 'moderate',
    referenceClient: 'Renee Madigan (Achilles, May 2026) · Mike (herniated disk)',
    compounds: ['bpc157', 'tb500', 'kpv', 'ghkcu'],
    tagline: 'Tissue repair, tendons, post-surgical recovery, gut healing',
    duration: '8–16 weeks',
    description: 'Three-tier escalation from BPC+TB classic duo through the KLOW 4-compound blend to the immune-amplified TA-1 + NAD+ Advanced stack for chronic or autoimmune-related tissue damage.',
    confidence: 'T3',
    tiers: {
      light: {
        label: 'Light · Classic Healing Duo',
        compounds: ['bpc157', 'tb500'],
        tagline: 'BPC + TB — local + systemic tissue repair',
        duration: '8–12 weeks',
        description: 'The classic peptide healing pair. BPC-157 targets the specific injury site (tendons, gut lining, nerve roots). TB-500 (thymosin β4 fragment) accelerates systemic repair throughout the body. Simple, well-tolerated, no reconstitution complexity beyond standard SubQ.',
        dosing: 'BPC-157 250–500 mcg/day SubQ · TB-500 2.5 mg SubQ twice weekly',
        idealFor: 'Single-site injuries · tendon strains · early post-surgical recovery · first-time peptide users',
        evidenceTier: 'T4',
      },
      moderate: {
        label: 'Moderate · KLOW Full Healing System',
        compounds: ['bpc157', 'tb500', 'kpv', 'ghkcu'],
        tagline: 'Four-compound blend — local + systemic + anti-inflammatory + collagen',
        duration: '8–16 weeks (1 KLOW vial = 4 wks)',
        description: 'KLOW — Marc\'s canonical healing protocol. Adds KPV (mast-cell stabilizer for chronic inflammation) and GHK-Cu (4,000+ tissue-remodeling genes including collagen synthesis). All four compounds in one co-lyophilized freeze-dried vial — single SubQ injection delivers proportional doses of each. 4 months recommended for systemic healing since collagen turnover is slow.',
        dosing: 'KLOW 10 IU SubQ Mon–Fri AM (= 2.5 mg BPC + 2.5 mg TB-500 + 2.5 mg KPV + 12.5 mg GHK per week)',
        idealFor: 'Multi-site or chronic injuries · post-surgical recovery · gut healing · tendons (Achilles, rotator cuff) · clients on long-term healing protocols',
        evidenceTier: 'T3+T4',
        suggestedSku: 'KLOW-FD',
        keyStudies: [
          { compound: 'BPC-157', citation: 'Krsnik J et al. J Orthop Res. 2010 (PMID 19763488)', finding: 'BPC-157 accelerated Achilles tendon healing in rat model.' },
          { compound: 'GHK-Cu', citation: 'Pickart L, Margolina A. Int J Mol Sci. 2018;19:1987.', finding: 'GHK-Cu activates 4,000+ tissue-remodeling genes including collagen synthesis.' },
        ],
      },
      advanced: {
        label: 'Advanced · KLOW + Immune-Amplified Repair',
        compounds: ['bpc157', 'tb500', 'kpv', 'ghkcu', 'ta1', 'nad'],
        tagline: 'Full repair stack — adds immune coordination + bioenergetic substrate',
        duration: '12–16 weeks',
        description: 'Builds on KLOW with TA-1 (Thymosin Alpha-1) and NAD+. TA-1 has the strongest immune-peptide evidence in the catalog (Zadaxin approved 35+ countries; 2024 sepsis meta-analysis n=1972 showed mortality benefit). It restores T-cell intelligence and NK surveillance — critical for repair phases involving chronic or autoimmune-related tissue damage. NAD+ provides the bioenergetic substrate repair cells depend on (SIRT/PARP/ETC activity). Best for chronic injuries that haven\'t responded to KLOW alone, post-surgical immunocompromised states, or autoimmune-related tissue damage.',
        dosing: 'KLOW 10 IU SubQ Mon–Fri · TA-1 1.6 mg SubQ 2×/wk · NAD+ 250 mg SubQ Mon/Wed/Fri PM (slow-push 3–5 min)',
        idealFor: 'Chronic non-responders · autoimmune tissue damage · post-surgical immunocompromised · severe trauma recovery',
        evidenceTier: 'T1+T3',
        keyStudies: [
          { compound: 'TA-1', citation: 'Thymosin Alpha-1 sepsis meta-analysis 2024 (PMC12792209)', finding: 'Mortality benefit in n=1972 sepsis patients — strongest immune-peptide evidence base.' },
        ],
      },
    },
  },

  // ── 3. ANTI-AGING ──────────────────────────────────────────────────────────
  {
    id: 'antiaging',
    goal: 'Anti-Aging',
    emoji: '✨',
    defaultTier: 'moderate',
    compounds: ['nad', 'epithalon', 'cjc', 'ipamorelin'],
    tagline: 'Multi-axis longevity — substrate + telomere + GH + collagen + mitochondria',
    duration: '12–16 weeks + ongoing maintenance',
    description: 'Layered longevity escalation. Light = the NAD+ foundation. Moderate adds telomere + GH axis restoration. Advanced adds the full multi-axis stack including SS-31 cycling and MOTS-c biogenesis.',
    confidence: 'T2',
    tiers: {
      light: {
        label: 'Light · NAD+ Foundation',
        compounds: ['nad'],
        tagline: 'The single most upstream longevity lever',
        duration: 'Ongoing (continuous use)',
        description: 'NAD+ nasal spray for continuous daily optimization. NAD+ falls ~50% between age 40 and 60 — restoring it activates SIRT pathway for DNA repair, supports PARP-mediated repair, and provides the cellular energy substrate everything else depends on. Spray bypasses first-pass metabolism, avoids SubQ slow-push flush, easier compliance for chronic use.',
        dosing: 'NAD+ nasal spray 50 mg × 2/day continuous (Vitalis 3000 mg bottle)',
        idealFor: 'First-time longevity users · 40+ baseline maintenance · highest-compliance entry',
        evidenceTier: 'T1+T2',
      },
      moderate: {
        label: 'Moderate · Multi-Axis Longevity',
        compounds: ['nad', 'epithalon', 'cjc', 'ipamorelin'],
        tagline: 'Adds telomere extension + somatopause reversal',
        duration: 'NAD+ ongoing · Epitalon 20-day cycles 1–2× yr · CJC/Ipa 12–16 wks',
        description: 'Adds two more longevity axes. Epitalon (cycled 20 days 1–2×/year) extends telomeres via telomerase activation — Khavinson group 12-yr Korkushko study showed 28% mortality reduction (T2, Russian source limited Western replication). CJC-1295 + Ipamorelin restore the pulsatile GH secretion that declines with age (somatopause) — drives collagen synthesis, body composition, deep sleep.',
        dosing: 'NAD+ spray 50 mg × 2/day · Epitalon 5–10 mg/day SubQ × 20 days, 1–2× yearly · CJC/Ipa 200 mcg each SubQ daily PM',
        idealFor: 'Established longevity protocol clients · 45+ with body comp / energy goals',
        evidenceTier: 'T2',
        suggestedSku: 'PEN-IPA-CJC1295', // pairing rule fires
      },
      advanced: {
        label: 'Advanced · Full Longevity Stack',
        compounds: ['nad', 'epithalon', 'cjc', 'ipamorelin', 'ghkcu', 'ss31', 'motsc'],
        tagline: 'Maximum longevity — adds collagen + mitochondrial structure + biogenesis',
        duration: 'Multi-axis ongoing · SS-31 8-wk cycles twice yearly',
        description: 'Builds on Moderate. GHK-Cu adds 4,000+ tissue-remodeling gene activation (collagen, elastin, skin, hair) — strongest human topical RCT evidence in the catalog. SS-31 cycles twice yearly (8 weeks Spring + Fall per canonical SOP) for mitochondrial cardiolipin stabilization. MOTS-c adds exercise-mimetic mitochondrial biogenesis. All compounds earn their place — no redundancy. This is the maximum-axis longevity protocol.',
        dosing: 'NAD+ spray 50 mg × 2/day · Epitalon cycles · CJC/Ipa 200 mcg PM · GHK-Cu 1–2 mg/day SubQ · SS-31 5 mg/day SubQ (Wks 1–8 cycle 2×/yr) · MOTS-c 5 mg/wk SubQ Tuesday',
        idealFor: 'Comprehensive longevity protocol · biological-age optimization · advanced users',
        evidenceTier: 'T1+T2+T3',
      },
    },
  },

  // ── 4. ENERGY & VITALITY (40+) — Beaulieu lineage ─────────────────────────
  {
    id: 'energy-vitality',
    goal: 'Energy & Vitality (40+)',
    emoji: '🌟',
    defaultTier: 'moderate',
    referenceClient: 'Beaulieu referral (40yo male on Reta, May 2026)',
    compounds: ['nad', 'cjc', 'ipamorelin'],
    tagline: 'Restore subjective energy + recovery — sleep + GH + mitochondrial support',
    duration: '16 weeks (4 months)',
    description: 'Same biological substrate as Anti-Aging but framed around subjective wellbeing (energy, fatigue resolution, recovery from exertion) rather than biomarker longevity. Multi-functional peptides do double duty — the differentiation is in goal-framing, not compound selection.',
    confidence: 'T2',
    tiers: {
      light: {
        label: 'Light · NAD+ Solo',
        compounds: ['nad'],
        tagline: 'Cheapest entry · fastest subjective energy lift',
        duration: 'Ongoing',
        description: 'NAD+ nasal spray alone. For "general flat energy / brain fog / 40+ vitality slump" without a more specific signal. Subjective improvements typically appear within 1–2 weeks. Compliance-friendly format for chronic use.',
        dosing: 'NAD+ nasal spray 50 mg × 2/day continuous',
        idealFor: 'First-time, single-compound trial · cellular-energy / general fatigue',
        evidenceTier: 'T1+T2',
      },
      moderate: {
        label: 'Moderate · NAD+ + Sleep/GH Layer',
        compounds: ['nad', 'cjc', 'ipamorelin'],
        tagline: 'Adds the sleep + GH-driven recovery layer',
        duration: '16 weeks',
        description: 'Adds CJC-1295 + Ipamorelin for the GH pulse that drives deep sleep and recovery. Deep sleep architecture is the single most under-recognized fix for fatigue at 40+ — improved sleep quality typically appears Wk 1–2; body composition shifts at Wk 8–12.',
        dosing: 'NAD+ spray 50 mg × 2/day · CJC/Ipa 200 mcg each SubQ daily PM (bedtime, fasted 2h)',
        idealFor: 'Sleep-driven fatigue · recovery-from-exertion deficit · 40+ energy slump',
        evidenceTier: 'T2+T3',
        suggestedSku: 'PEN-IPA-CJC1295',
      },
      advanced: {
        label: 'Advanced · Full Four-Lever Stack (Beaulieu pattern)',
        compounds: ['nad', 'cjc', 'ipamorelin', 'motsc', 'ss31'],
        tagline: 'Maximum-effort energy stack — addresses all four energy systems',
        duration: '16 weeks (SS-31 cycle Wks 1–8 only)',
        description: 'The full Beaulieu pattern. Adds MOTS-c (mitochondrial biogenesis — quantity) and SS-31 (mitochondrial structural quality, 8-wk cycle Wks 1–8). Four levers covered: bioenergetic substrate (NAD+), sleep + GH (CJC/Ipa), mito biogenesis (MOTS-c), mito structure (SS-31). For sustained fatigue not responding to Moderate, or clients who want to push every available lever.',
        dosing: 'NAD+ spray 50 mg × 2/day · CJC/Ipa 200 mcg PM · MOTS-c 5 mg/wk Tuesday · SS-31 5 mg/day evening (Wks 1–8)',
        idealFor: 'Persistent fatigue · stress recovery · "go all out" energy optimization',
        evidenceTier: 'T2+T3',
      },
    },
  },

  // ── 5. MALE FERTILITY — Fabricio lineage ──────────────────────────────────
  {
    id: 'male-fertility',
    goal: 'Male Fertility',
    emoji: '🌱',
    defaultTier: 'light',
    referenceClient: 'Fabricio (May 2026)',
    compounds: ['kisspeptin'],
    tagline: 'Pulsatile HPG-axis amplification for spermatogenesis',
    duration: '16 weeks (one full spermatogenesis cycle + measurement window)',
    description: 'Kisspeptin sits at the top of the male reproductive cascade. Unlike exogenous testosterone (which suppresses), Kisspeptin amplifies the body\'s own pulsatile signal. Pulsatile dosing is MANDATORY — continuous daily desensitizes KISS1R within 48h.',
    confidence: 'T1',
    tiers: {
      light: {
        label: 'Light · Kisspeptin-54 Pulsatile (Fabricio pattern)',
        compounds: ['kisspeptin'],
        tagline: 'Single-compound HPG-axis amplification',
        duration: '16 weeks',
        description: 'Kisspeptin-54 (KP-54, full-length, longer half-life than KP-10) at 300 mcg SubQ pulsatile Mon/Wed/Fri AM. Amplifies endogenous LH/FSH pulses → testicular testosterone + spermatogenesis. 16 weeks captures one full spermatogenesis cycle (~88 days). PULSATILE PATTERN IS MANDATORY — daily continuous desensitizes KISS1R and inverts the protocol into HPG suppression within 72h.',
        dosing: 'Kisspeptin-54 300 mcg SubQ Mon/Wed/Fri AM',
        idealFor: 'First-line male fertility · partner trying to conceive · subfertile workup with normal-baseline LH/FSH',
        evidenceTier: 'T1',
        keyStudies: [
          { compound: 'Kisspeptin-54', citation: 'Dhillo WS et al. JCEM. 2005;90:6609. (PMID 16174713)', finding: 'IV KP-54 in healthy men dose-dependently stimulated LH/FSH/testosterone.' },
          { compound: 'Kisspeptin-54', citation: 'Chan YM et al. Hum Reprod. 2015;30:1934.', finding: 'KP-54 more potent and sustained LH response than KP-10 in head-to-head trial.' },
        ],
      },
      moderate: {
        label: 'Moderate · Kisspeptin + GH/IGF Axis',
        compounds: ['kisspeptin', 'cjc', 'ipamorelin'],
        tagline: 'Adds GH-friendly anabolic environment for spermatogenesis',
        duration: '16 weeks',
        description: 'Adds CJC-1295 + Ipamorelin to support the GH/IGF-1 axis — which contributes to a healthier spermatogenic environment and improves overall metabolic + body-composition picture during the fertility workup. NAD+ available as optional adjunct for sperm mitochondrial quality (T4 evidence, useful but not core).',
        dosing: 'Kisspeptin 300 mcg SubQ M/W/F · CJC/Ipa 200 mcg each SubQ daily PM · Optional: NAD+ spray for sperm mito',
        idealFor: 'Sub-optimal SA parameters · 35+ male partner · subfertility workup with metabolic findings',
        evidenceTier: 'T1+T3',
        suggestedSku: 'PEN-IPA-CJC1295',
      },
      advanced: {
        label: 'Advanced · + HCG for Hypogonadal Cases',
        compounds: ['kisspeptin', 'cjc', 'ipamorelin', 'hcg', 'nad'],
        tagline: 'Adds direct testicular stimulation for hypogonadal subfertility',
        duration: '16 weeks',
        description: 'Builds on Moderate. HCG is the standard-of-care LH analogue for hypogonadal men — directly stimulates Leydig cell testosterone production when baseline LH/T is low. NAD+ moved from optional to core at this tier for sperm mitochondrial quality. For cases where baseline workup shows hypogonadism alongside subfertility.',
        dosing: 'Kisspeptin 300 mcg SubQ M/W/F · CJC/Ipa 200 mcg PM · HCG 500 IU SubQ 2–3×/wk · NAD+ spray 50 mg × 2/day',
        idealFor: 'Hypogonadal male subfertility · post-TRT recovery + fertility · complex cases under clinical oversight',
        evidenceTier: 'T1',
        keyStudies: [
          { compound: 'HCG', citation: 'Coviello AD et al. JCEM. 2005;90:2595.', finding: 'HCG maintains intratesticular testosterone + spermatogenesis in TRT/hypogonadal men.' },
        ],
      },
    },
  },

  // ── 6. MITOCHONDRIAL REPAIR — Tony lineage ────────────────────────────────
  {
    id: 'mitochondrial-repair',
    goal: 'Mitochondrial Repair',
    emoji: '⚡',
    defaultTier: 'moderate',
    referenceClient: 'Tony (Spring 2026)',
    compounds: ['ss31', 'nad'],
    tagline: 'Mitochondrial structural + bioenergetic repair cycle',
    duration: '8 weeks SS-31 + 13 weeks NAD+',
    description: 'Focused intervention for chronic mitochondrial dysfunction (post-illness, ME/CFS, long-COVID, post-stress recovery). Twice-yearly cadence (Spring + Fall).',
    confidence: 'T1',
    tiers: {
      light: {
        label: 'Light · NAD+ Substrate Restoration',
        compounds: ['nad'],
        tagline: 'Foundation bioenergetic substrate',
        duration: '8–13 weeks',
        description: 'NAD+ alone — the bioenergetic currency mitochondria depend on. Cyclic SubQ loading at canonical Vitalis SOP (250 mg × 3/wk = 750 mg/wk hold dose, Wk 1 tolerance check at 100 mg Day 1). OR nasal spray for continuous use.',
        dosing: 'SubQ: 250 mg SubQ Mon/Wed/Fri PM (slow-push 3–5 min) · OR nasal spray 50 mg × 2/day continuous',
        idealFor: 'Early or mild mitochondrial fatigue · post-viral recovery (entry) · single-compound trial',
        evidenceTier: 'T2',
      },
      moderate: {
        label: 'Moderate · SS-31 Cycle + NAD+ (Tony pattern)',
        compounds: ['ss31', 'nad'],
        tagline: 'Cardiolipin stabilization + bioenergetic substrate',
        duration: '8 weeks SS-31 + 13 weeks NAD+',
        description: 'Tony\'s canonical Spring/Fall pattern. SS-31 (Forzinity, FDA-approved Sept 2025 for Barth syndrome) binds cardiolipin in the inner mitochondrial membrane — stabilizes the scaffold electron transport chain complexes I–IV depend on. NAD+ runs across the cycle and extends past SS-31 to support sustained bioenergetic recovery. SS-31 cycle is twice yearly (Spring + Fall, ideally aligned with Reta off-cycles), NOT continuous.',
        dosing: 'SS-31 5 mg SubQ daily evening (Wks 1–8) · NAD+ 250 mg SubQ Mon/Wed/Fri PM (Wks 1–13)',
        idealFor: 'Chronic mitochondrial fatigue · post-viral · ME/CFS · long-COVID · stress-recovery cycles',
        evidenceTier: 'T1+T2',
        keyStudies: [
          { compound: 'SS-31', citation: 'Birk AV et al. JASN. 2013;24:1250.', finding: 'Foundational cardiolipin-binding mechanism — SS-31 stabilizes cristae under oxidative stress.' },
          { compound: 'SS-31', citation: 'Karaa A et al. Neurology. 2018;90:e1212. (MMPOWER)', finding: '40 mg/day elamipretide improved 6-min walk test in primary mitochondrial myopathy.' },
        ],
      },
      advanced: {
        label: 'Advanced · + MOTS-c Biogenesis + Humanin',
        compounds: ['ss31', 'nad', 'motsc', 'humanin'],
        tagline: 'Adds biogenesis + canonical mitochondrial-derived peptide protection',
        duration: '8 weeks SS-31 + extended MOTS-c/Humanin',
        description: 'Builds on Moderate. MOTS-c (16-amino-acid peptide encoded in mitochondrial 12S rRNA) drives mitochondrial biogenesis via AMPK → PGC-1α — increases mitochondrial QUANTITY while SS-31 protects QUALITY. Humanin is the canonical mitochondrial-derived peptide with cardiac mito protection evidence (PMID 28802666 — cardiac mito ROS protection; PMC6415743 — chronic humanin prevents age-related myocardial fibrosis in mice). All four work on different mito layers: substrate (NAD+), structure (SS-31), quantity (MOTS-c), survival signaling (Humanin). No redundancy.',
        dosing: 'SS-31 5 mg/day evening (Wks 1–8) · NAD+ 250 mg M/W/F (Wks 1–13) · MOTS-c 5 mg/wk SubQ Tuesday · Humanin 100–200 mcg SubQ daily',
        idealFor: 'Severe mitochondrial dysfunction · chronic ME/CFS · post-stress complete-mito-rebuild cycle',
        evidenceTier: 'T1+T4',
        keyStudies: [
          { compound: 'Humanin', citation: 'PMID 28802666', finding: 'Cardiac mitochondrial ROS protection by humanin.' },
          { compound: 'Humanin', citation: 'PMC6415743', finding: 'Chronic humanin prevents age-related myocardial fibrosis in mice.' },
        ],
      },
    },
  },

  // ── 7. PERFORMANCE & MUSCLE ───────────────────────────────────────────────
  {
    id: 'performance',
    goal: 'Performance & Muscle',
    emoji: '💪',
    defaultTier: 'moderate',
    compounds: ['cjc', 'ipamorelin', 'tb500'],
    tagline: 'GH pulse + systemic recovery for training-driven adaptation',
    duration: '8–12 weeks',
    description: 'Three-tier escalation from clean Ipamorelin pulse through the standard CJC/Ipa + recovery stack to the advanced IGF-1 LR3 + Follistatin myostatin-inhibition tier.',
    confidence: 'T3',
    tiers: {
      light: {
        label: 'Light · Ipamorelin Solo',
        compounds: ['ipamorelin'],
        tagline: 'The cleanest GH secretagogue',
        duration: '8–12 weeks',
        description: 'Ipamorelin alone — selective GHS-R1a agonist producing a clean GH pulse without raising cortisol or prolactin (unlike GHRP-6 or Hexarelin). Best entry into GH-axis optimization for athletes who want a single, well-tolerated compound.',
        dosing: 'Ipamorelin 200 mcg SubQ daily PM',
        idealFor: 'First-time GH-axis user · single-compound trial · sensitive to cortisol-elevating peptides',
        evidenceTier: 'T2',
      },
      moderate: {
        label: 'Moderate · CJC + Ipa + Recovery',
        compounds: ['cjc', 'ipamorelin', 'tb500'],
        tagline: 'Standard GH-pulse + connective tissue recovery',
        duration: '8–12 weeks',
        description: 'CJC-1295 (GHRH analogue) + Ipamorelin (GHS-R1a) — synergistic dual-receptor GH pulse, mimics physiological secretion pattern. TB-500 accelerates between-session recovery and supports connective tissue resilience for sustained training load.',
        dosing: 'CJC/Ipa 200 mcg each SubQ daily PM · TB-500 2.5 mg SubQ twice weekly',
        idealFor: 'Established training programs · hypertrophy + recovery focus · injury-resilience building',
        evidenceTier: 'T3',
        suggestedSku: 'PEN-IPA-CJC1295',
      },
      advanced: {
        label: 'Advanced · + IGF-1 LR3 + Follistatin 344',
        compounds: ['cjc', 'ipamorelin', 'tb500', 'igf1lr3', 'follistatin344'],
        tagline: 'Adds downstream anabolic + myostatin inhibition',
        duration: '4–6 weeks IGF cycles · 10–30 day Follistatin cycles',
        description: 'Builds on Moderate. IGF-1 LR3 bypasses the GH conversion bottleneck for direct anabolic signaling — but desensitizes receptors at 4–6 weeks, so strictly cycled. Follistatin 344 inhibits myostatin (the molecular brake on muscle growth) — true muscle-specific anabolic intervention. Tesamorelin deliberately NOT included here: its primary evidence is visceral fat reduction (HIV lipodystrophy trials), not muscle accretion — it belongs in Fat Loss Advanced.',
        dosing: 'CJC/Ipa 200 mcg PM · TB-500 2.5 mg 2×/wk · IGF-1 LR3 30–50 mcg/day SubQ × 4 wks then off · Follistatin 344 100 mcg/day × 10–30 days',
        idealFor: 'Advanced athletes · plateau-busting · muscle-specific intervention · careful cycling required',
        evidenceTier: 'T3+T4',
      },
    },
  },

  // ── 8. COGNITIVE & FOCUS ──────────────────────────────────────────────────
  {
    id: 'cognitive',
    goal: 'Cognitive & Focus',
    emoji: '🧠',
    defaultTier: 'moderate',
    compounds: ['semax', 'selank'],
    tagline: 'Sharp focus + calm — BDNF elevation without anxiety',
    duration: '2–4 week cycles with breaks',
    description: 'Light = Semax alone for BDNF. Moderate adds Selank for anxiety modulation. Advanced adds Dihexa with EXPLICIT T4-experimental flag — NAD+ for brain energy substrate.',
    confidence: 'T2',
    tiers: {
      light: {
        label: 'Light · Semax Solo',
        compounds: ['semax'],
        tagline: 'BDNF elevation via intranasal delivery',
        duration: '2–4 week cycles',
        description: 'Semax alone (intranasal). Russian-clinical-use peptide with BDNF upregulation, attention/memory improvement, and stroke recovery data. Single compound, no injection complexity.',
        dosing: 'Semax 600 mcg intranasal AM (per nostril dosing)',
        idealFor: 'Entry cognitive enhancement · students · focus-only goals',
        evidenceTier: 'T2',
      },
      moderate: {
        label: 'Moderate · Semax + Selank',
        compounds: ['semax', 'selank'],
        tagline: 'Sharp focus + calm — best-evidenced nootropic stack',
        duration: '2–4 week cycles with breaks',
        description: 'Selank added — anxiolytic via GABA-A modulation, prevents the anxiety/over-activation Semax can sometimes produce in sensitive users. Selank is approved in Russia for generalized anxiety disorder; matched benzodiazepine anxiolytic effects in double-blind trials with zero dependency risk.',
        dosing: 'Semax 600 mcg intranasal AM · Selank 300 mcg intranasal AM + PM as needed',
        idealFor: 'Focus + anxiety modulation · GAD-adjacent presentations · cognitive demand under stress',
        evidenceTier: 'T2',
      },
      advanced: {
        label: 'Advanced · + Dihexa (T4 experimental) + NAD+',
        compounds: ['semax', 'selank', 'dihexa', 'nad'],
        tagline: 'Adds experimental cognitive enhancer + brain energy substrate',
        duration: '4–8 week Dihexa cycles · NAD+ ongoing',
        description: 'Builds on Moderate. NAD+ provides brain ATP substrate (cognitive demand is energy-intensive). Dihexa is included with EXPLICIT HONESTY: Dihexa is the most potent BDNF/HGF/MET-pathway compound described in animal models — but it has ZERO published human clinical evidence (T4 preclinical only). The pro-drug fosgonimeton (Athira Pharma) failed Phase 2/3 ACT-AD readouts for Alzheimer\'s in 2023–24. Marc keeps Dihexa available for advanced users who understand the experimental tier; the UI displays a T4-experimental badge prominently. P21 (catalog alternative) has similar T4 status but better mechanistic fit for neuroplasticity.',
        dosing: 'Semax 600 mcg intranasal AM · Selank 300 mcg AM/PM · Dihexa 10–30 mg oral OR 1–3 mg SubQ daily · NAD+ spray 50 mg × 2/day',
        idealFor: 'Advanced experimental users · neuroplasticity goals · clients accepting T4-evidence experimentation',
        evidenceTier: 'T2+T4-experimental',
        experimentalCompounds: ['dihexa'], // for UI flagging
      },
    },
  },

  // ── 9. SLEEP & RECOVERY ───────────────────────────────────────────────────
  {
    id: 'sleep',
    goal: 'Sleep & Recovery',
    emoji: '🌙',
    defaultTier: 'moderate',
    compounds: ['dsip', 'selank'],
    tagline: 'Deep slow-wave sleep architecture + onset support',
    duration: '4–8 weeks',
    description: 'Most sleep problems have two layers — mental (anxiety, racing thoughts) and physiological (insufficient slow-wave depth). Tiers escalate from DSIP-alone to the full Selank + DSIP + CJC/Ipa stack that amplifies GH pulse during the deep-sleep window.',
    confidence: 'T2',
    tiers: {
      light: {
        label: 'Light · DSIP Solo',
        compounds: ['dsip'],
        tagline: 'Slow-wave sleep architecture, single compound',
        duration: '4–8 weeks',
        description: 'DSIP (Delta Sleep-Inducing Peptide) alone. Triggers slow-wave (delta) sleep where overnight GH release, memory consolidation, and cellular repair occur. Evidence is mixed (T2 with caveats) — strongest signal in chronic insomnia trials but inconsistent across all populations.',
        dosing: 'DSIP 100–250 mcg SubQ 30–60 min pre-bed',
        idealFor: 'Single-compound trial · pure physiological sleep issue · entry tier',
        evidenceTier: 'T2-caveat',
      },
      moderate: {
        label: 'Moderate · DSIP + Selank',
        compounds: ['dsip', 'selank'],
        tagline: 'Addresses both physiological + mental sleep layers',
        duration: '4–8 weeks',
        description: 'Selank added — quiets racing thoughts via GABA-A modulation, makes sleep onset faster. Together: Selank handles the mental layer (anxiety, switch-off), DSIP handles the physiological layer (deep-sleep architecture). Result: faster sleep onset + better sleep quality.',
        dosing: 'AC-Selank 300 mcg intranasal 30–60 min pre-bed · DSIP 100–250 mcg SubQ 30–60 min pre-bed',
        idealFor: 'Sleep-onset insomnia · anxiety-driven sleep disruption · most common adult sleep problem',
        evidenceTier: 'T2',
        suggestedSku: 'PEN-AC-SELANK-DELTA',
      },
      advanced: {
        label: 'Advanced · + CJC/Ipa for GH-Pulse Amplification',
        compounds: ['dsip', 'selank', 'cjc', 'ipamorelin'],
        tagline: 'Adds growth hormone pulse during slow-wave window',
        duration: '8–12 weeks',
        description: 'Builds on Moderate. CJC + Ipa pre-bed positions the GH pulse to align with the natural slow-wave GH window — amplifying the anabolic + restorative benefits of the deep sleep that DSIP is creating. Strong rationale for clients with both sleep AND recovery deficits (athletes, post-surgical, chronic stress).',
        dosing: 'AC-Selank 300 mcg intranasal · DSIP 100–250 mcg SubQ · CJC/Ipa 200 mcg each SubQ pre-bed (fasted 2h)',
        idealFor: 'Athletes + sleep issues · post-surgical recovery · chronic stress + sleep disruption',
        evidenceTier: 'T2+T3',
        suggestedSku: 'PEN-IPA-CJC1295',
      },
    },
  },

  // ── 10. IMMUNE RESTORATION ────────────────────────────────────────────────
  {
    id: 'immune',
    goal: 'Immune Restoration',
    emoji: '🛡️',
    defaultTier: 'moderate',
    compounds: ['ta1', 'bpc157'],
    tagline: 'For chronic infections, post-viral, autoimmune, immune dysregulation',
    duration: '12–16 weeks',
    description: 'Tiers escalate from TA-1 monotherapy (strongest single-compound immune evidence) through gut-immune-axis pairing to the full chronic-immune restoration stack.',
    confidence: 'T1',
    tiers: {
      light: {
        label: 'Light · Thymosin Alpha-1 Solo',
        compounds: ['ta1'],
        tagline: 'Strongest single-compound immune evidence in catalog',
        duration: '12–16 weeks',
        description: 'TA-1 alone — Zadaxin approved in 35+ countries for HBV/HCV. 2024 sepsis meta-analysis (n=1972) showed mortality benefit. Restores T-cell intelligence (CD4+/CD8+) and NK surveillance.',
        dosing: 'TA-1 1.6 mg SubQ 2×/wk',
        idealFor: 'Recurrent infections (early intervention) · post-viral entry · single-compound trial',
        evidenceTier: 'T1',
      },
      moderate: {
        label: 'Moderate · TA-1 + BPC-157 (Gut-Immune Axis)',
        compounds: ['ta1', 'bpc157'],
        tagline: 'Adds gut lining repair — primary chronic immune activation source',
        duration: '12–16 weeks',
        description: 'Adds BPC-157 to repair gut lining (leaky gut = primary driver of chronic immune activation). Gut-immune axis dysfunction is foundational to most chronic immune conditions.',
        dosing: 'TA-1 1.6 mg SubQ 2×/wk · BPC-157 250–500 mcg/day SubQ',
        idealFor: 'IBD / IBS adjacent · post-antibiotic gut + immune recovery · most chronic immune presentations',
        evidenceTier: 'T1+T4',
      },
      advanced: {
        label: 'Advanced · + NAD+ + KPV + LL-37 (Full Chronic Stack)',
        compounds: ['ta1', 'bpc157', 'nad', 'kpv', 'll37'],
        tagline: 'Full chronic-immune restoration — adaptive + innate + mitochondrial',
        duration: '12–16 weeks',
        description: 'Builds on Moderate. KPV adds mast-cell stabilization + NF-κB suppression (cytokine storm control). LL-37 adds antimicrobial cathelicidin activity (complementary to TA-1\'s adaptive immunity focus). NAD+ addresses mitochondrial dysfunction underlying every chronic immune condition. All compounds earn their place — no redundancy.',
        dosing: 'TA-1 1.6 mg SubQ 2×/wk · BPC-157 250–500 mcg/day · KPV 250 mcg/day SubQ · LL-37 100–500 mcg/day SubQ · NAD+ 250 mg SubQ M/W/F',
        idealFor: 'Chronic infections · post-viral / long-COVID · autoimmune presentations · CIRS adjacent',
        evidenceTier: 'T1+T4',
      },
    },
  },

  // ── 11. MENOPAUSE SUPPORT ─────────────────────────────────────────────────
  {
    id: 'menopause',
    goal: 'Menopause Support',
    emoji: '🌸',
    defaultTier: 'light',
    compounds: ['ghkcu', 'nad'],
    tagline: 'ADJUNCTIVE to HRT — peptides are NOT estrogen replacement',
    duration: '12–16 weeks',
    description: 'PEPTIDES ARE ADJUNCTIVE, NOT HRT REPLACEMENT. NAMS and Menopause Society recommend systemic estrogen as first-line for vasomotor symptoms. Tiers below offer escalating peptide support that complements rather than replaces appropriate hormone therapy.',
    confidence: 'T2',
    tiers: {
      light: {
        label: 'Light · Skin + Energy Foundation',
        compounds: ['ghkcu', 'nad'],
        tagline: 'GHK-Cu + NAD+ for skin/collagen + energy support',
        duration: 'Ongoing',
        description: 'GHK-Cu has the best human evidence of catalog menopause-relevant peptides — 40-women topical RCT showed 55.8% wrinkle volume reduction; activates 4,000+ tissue-remodeling genes counteracting estrogen-withdrawal collagen breakdown. NAD+ addresses menopausal fatigue and brain fog via mitochondrial support. **CRITICAL DISCLOSURE:** This protocol is ADJUNCTIVE to appropriate hormone therapy. NAMS/Menopause Society first-line is systemic estrogen for vasomotor symptoms — peptides do not replace HRT.',
        dosing: 'GHK-Cu 1–2 mg/day SubQ · NAD+ nasal spray 50 mg × 2/day continuous',
        idealFor: 'Skin/collagen concerns · menopausal fatigue · WITH appropriate hormone therapy or HRT-declined contexts under physician oversight',
        evidenceTier: 'T1+T2',
        disclosure: 'PEPTIDES ARE NOT HRT REPLACEMENT. First-line treatment for vasomotor symptoms per NAMS/Menopause Society is systemic estrogen. This protocol is adjunctive only.',
      },
      moderate: {
        label: 'Moderate · + PT-141 for Sexual Wellbeing',
        compounds: ['ghkcu', 'nad', 'pt141'],
        tagline: 'Adds melanocortin-pathway sexual function support',
        duration: '12–16 weeks · PT-141 as-needed',
        description: 'PT-141 (bremelanotide) added — FDA-approved as Vyleesi for HSDD (premenopausal labeled but mechanism is hormone-independent, applicable across menopausal transition). Activates melanocortin receptors centrally — addresses sexual desire/arousal at the CNS level, not the hormonal level. Kisspeptin deliberately NOT included at this tier — post-menopausal ovaries are largely unresponsive to LH/FSH so HPG-axis amplification has low yield.',
        dosing: 'GHK-Cu 1–2 mg/day · NAD+ spray 50 mg × 2/day · PT-141 1–2 mg SubQ as-needed',
        idealFor: 'Menopausal sexual function concerns · skin + energy + libido bundle',
        evidenceTier: 'T1+T2',
      },
      advanced: {
        label: 'Advanced · + Cardiogen for Cardiovascular Protection',
        compounds: ['ghkcu', 'nad', 'pt141', 'cardiogen'],
        tagline: 'Adds cardiac antifibrotic protection — post-menopausal CV risk',
        duration: '12–16 weeks · Cardiogen 10–30 day cycles 1–2× yearly',
        description: 'Builds on Moderate. Cardiogen (Ac-SDKP, thymosin β4 fragment) is the cardiac-tissue bioregulator with antifibrotic evidence (AHA Journal 2004, PMID 14744920). Post-menopausal cardiovascular risk rises sharply as estrogen-mediated CV protection withdraws — Cardiogen provides peptide-level cardiac tissue support during this transition. Optional: Kisspeptin available if hot-flash-NKB-pathway intervention is desired alongside HRT, but evidence is limited in post-menopause vs perimenopause.',
        dosing: 'GHK-Cu 1–2 mg/day · NAD+ spray 50 mg × 2/day · PT-141 as-needed · Cardiogen 5–10 mg/day SubQ × 10–30 days, 1–2× yearly',
        idealFor: 'Post-menopausal with CV-risk factors · comprehensive menopause peptide protocol · advanced users',
        evidenceTier: 'T2+T4',
        keyStudies: [
          { compound: 'Cardiogen', citation: 'Ac-SDKP cardiac antifibrotic, AHA Journal 2004 (PMID 14744920)', finding: 'Ac-SDKP reduces cardiac fibrosis in hypertensive models.' },
          { compound: 'PT-141', citation: 'Clayton AH et al. Womens Health. 2016;12:325.', finding: 'Bremelanotide significantly improved desire and arousal in women with HSDD (FDA-approved mechanism).' },
        ],
      },
    },
  },

];
