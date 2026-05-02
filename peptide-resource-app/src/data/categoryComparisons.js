// ============================================================
// CATEGORY COMPARISON ENGINE — ES6 export
// Cornerstone Research OPS | Ported from luke-app
// Research framing only. Not medical advice.
// ============================================================

export const CATEGORY_COMPARISONS = {

  // ── WEIGHT LOSS & METABOLIC ─────────────────────────────────
  weight: {
    label: '🔥 Fat Loss',
    intro: 'Three different mechanisms. Three different phases of fat loss. Here\'s how they rank and why stacking them works.',
    goalKey: 'weight',
    ranked: [
      {
        rank: 1,
        compound: 'Semaglutide',
        tagline: 'The gold standard for appetite suppression and metabolic reset',
        why_first: 'The most studied compound in this category. Clinical trials showed 15–20% body weight reduction — more than any other single compound. Works at the hormonal level by mimicking GLP-1, the gut hormone that signals fullness. Slows gastric emptying so you feel full on less food, reduces food cravings at the brain level, and improves insulin sensitivity simultaneously.',
        best_for: ['Significant total body weight reduction', 'Breaking a metabolic plateau', 'Controlling appetite and cravings', 'Insulin resistance and blood sugar management'],
        research_maturity: 'high',
        goal_score: 9.0,
      },
      {
        rank: 2,
        compound: 'Retatrutide',
        tagline: 'The next generation — three hormonal pathways at once',
        why_first: 'Retatrutide is the most potent compound in this category. It hits three receptors simultaneously (GLP-1, GIP, and glucagon) — triple the hormonal leverage of Semaglutide. Phase 2 trials showed up to 24% body weight reduction in some cohorts.',
        best_for: ['Maximum weight loss potential', 'Stubborn visceral fat (belly fat)', 'When Semaglutide alone wasn\'t sufficient', 'Faster results than single-receptor agonists'],
        research_maturity: 'moderate',
        goal_score: 9.5,
      },
      {
        rank: 3,
        compound: 'AOD-9604',
        tagline: 'The targeted fat-burning fragment — no growth hormone side effects',
        why_first: 'AOD-9604 is a fragment of growth hormone specifically responsible for its fat-burning effect — without the growth-promoting or blood sugar effects of full GH. Best used for body recomposition — particularly when the goal is fat loss while preserving or building lean mass.',
        best_for: ['Localized or stubborn fat breakdown', 'Body recomposition (fat loss + muscle preservation)', 'Lean individuals who want to cut without losing muscle', 'Adding to a GLP-1 protocol for enhanced fat-burning'],
        research_maturity: 'moderate',
        goal_score: 7.5,
      },
    ],
    pick_one: {
      recommendation: 'Semaglutide',
      reason: 'The most clinical data, proven 15–20% weight reduction, and addresses both appetite and metabolic function. If your primary goal is meaningful, sustained weight loss, start here.',
    },
    pick_two: {
      recommendation: ['Semaglutide', 'AOD-9604'],
      reason: 'Semaglutide handles the appetite and metabolic regulation — AOD-9604 adds direct fat burning and helps preserve lean mass. They work through completely different mechanisms so they don\'t compete; they complement.',
    },
    best_stack: {
      compounds: ['Semaglutide', 'AOD-9604'],
      label: 'Metabolic Stack',
      reason: 'GLP-1 appetite control + direct lipolysis = both sides of the energy equation addressed simultaneously.',
    },
    synergy: {
      semaglutide_aod: {
        compounds: ['Semaglutide', 'AOD-9604'],
        score: 8,
        explanation: 'Semaglutide reduces caloric intake and improves insulin sensitivity. AOD-9604 directly activates fat breakdown in adipose tissue. Together: less food going in + more fat being burned out.',
        stack_benefit: 'Enhanced fat loss beyond either alone, with better body composition (less muscle wasting than caloric restriction alone)',
      },
      semaglutide_retatrutide: {
        compounds: ['Semaglutide', 'Retatrutide'],
        score: 2,
        explanation: 'These two work through overlapping mechanisms (both hit GLP-1 receptors). Stacking them is NOT recommended — doubled GLP-1 agonism significantly increases nausea risk without proportional benefit. Choose one or the other.',
        stack_benefit: 'Not recommended — overlapping pathways',
      },
    },
  },

  // ── HEALING & RECOVERY ────────────────────────────────────────
  healing: {
    label: '🩹 Healing',
    intro: 'Three compounds that work different parts of the repair process. The full healing stack (KLOW) combines all three — here\'s why each matters and when to use one vs. all.',
    goalKey: 'healing',
    ranked: [
      {
        rank: 1,
        compound: 'BPC-157',
        tagline: 'The most versatile healing compound — systemic and localized',
        why_first: 'Body Protection Compound. Derived from gastric juice proteins. Drives new blood vessel formation (angiogenesis) into injured tissue, upregulates growth hormone receptors at injury sites, and protects the gut simultaneously. Works on tendons, ligaments, muscles, nerves, and intestinal lining.',
        best_for: ['Tendon and ligament repair', 'Post-surgical recovery', 'Chronic joint pain', 'Gut healing (leaky gut, IBD)', 'Nerve damage', 'General injury recovery'],
        research_maturity: 'high',
        goal_score: 9.0,
      },
      {
        rank: 2,
        compound: 'TB-500',
        tagline: 'Systemic anti-inflammation and cell migration at scale',
        why_first: 'Synthetic fragment of Thymosin Beta-4. Promotes cell migration to injury sites and reduces systemic inflammation. Where BPC-157 drives vascularization, TB-500 drives the anti-inflammatory response and recruits healing cells.',
        best_for: ['Systemic inflammation reduction', 'Post-surgical recovery', 'Heart muscle repair', 'Chronic inflammation', 'When injury affects multiple areas'],
        research_maturity: 'high',
        goal_score: 8.5,
      },
      {
        rank: 3,
        compound: 'KPV',
        tagline: 'The anti-inflammatory master — especially for gut and immune',
        why_first: 'KPV (Lys-Pro-Val) is a tripeptide fragment of alpha-MSH — one of the most potent anti-inflammatory signaling molecules the body produces. Inhibits the NF-κB pathway (the master inflammation switch) directly in inflamed cells. Can be taken orally because it survives stomach acid.',
        best_for: ['Inflammatory bowel disease, Crohn\'s, colitis', 'Gut inflammation', 'Immune-driven inflammation', 'Mast cell hyperactivity', 'Post-surgical inflammation'],
        research_maturity: 'moderate',
        goal_score: 8.0,
      },
    ],
    pick_one: {
      recommendation: 'BPC-157',
      reason: 'The broadest healing compound in the category. Addresses vascularization, growth hormone receptor activation, and works systemically or locally. If you have one injury or one recovery goal, BPC-157 covers the most ground.',
    },
    pick_two: {
      recommendation: ['BPC-157', 'TB-500'],
      reason: 'The classic KLOW combination. BPC-157 drives localized repair and vascularization. TB-500 handles systemic inflammation and cell migration. They work on complementary pathways and are the most studied combination in recovery research.',
    },
    best_stack: {
      compounds: ['BPC-157', 'TB-500', 'KPV'],
      label: 'KLOW Protocol',
      reason: 'Maximum healing. BPC-157 vascularizes. TB-500 migrates cells. KPV shuts down the inflammation that blocks both.',
    },
    synergy: {
      bpc_tb500: {
        compounds: ['BPC-157', 'TB-500'],
        score: 9,
        explanation: 'BPC-157 drives angiogenesis (new blood vessel formation) and upregulates GH receptors at the injury site. TB-500 drives actin polymerization and cell migration — getting healing cells to the site faster, and reducing the inflammatory environment that slows repair. One builds the highway, the other sends the trucks.',
        stack_benefit: 'The KLOW foundation — more effective than either alone for musculoskeletal recovery',
      },
      bpc_kpv: {
        compounds: ['BPC-157', 'KPV'],
        score: 8,
        explanation: 'For gut healing specifically, this is a premier combination. BPC-157 heals the intestinal wall structurally. KPV reduces the NF-κB driven inflammation that caused or perpetuates the damage. Structural repair + inflammatory control simultaneously.',
        stack_benefit: 'Optimal for inflammatory bowel, leaky gut, and post-antibiotic gut restoration',
      },
      full_klow: {
        compounds: ['BPC-157', 'TB-500', 'KPV'],
        score: 10,
        explanation: 'The complete KLOW stack. BPC-157: vascularization and GH receptor activation. TB-500: cell migration and systemic anti-inflammation. KPV: NF-κB pathway inhibition. Together they cover every phase of tissue repair from cellular signaling to structural rebuilding.',
        stack_benefit: 'Maximum healing potential — used for post-surgical recovery, serious injury, or chronic non-healing conditions',
      },
    },
  },

  // ── ANTI-AGING & LONGEVITY ─────────────────────────────────
  antiaging: {
    label: '✨ Anti-Aging',
    intro: 'Anti-aging works at three levels: cellular energy, DNA repair, and structural restoration. These three compounds each address a different layer.',
    goalKey: 'antiaging',
    ranked: [
      {
        rank: 1,
        compound: 'NAD+',
        tagline: 'Cellular energy and DNA repair — the foundation of aging intervention',
        why_first: 'NAD+ declines 50% by age 50. Required for mitochondrial energy production, DNA repair enzyme activation (sirtuins, PARP), and hundreds of metabolic reactions. No other single compound has more mechanistic links to the aging process.',
        best_for: ['Energy and cognitive clarity', 'Mitochondrial function', 'DNA repair activation', 'Metabolic health'],
        research_maturity: 'high',
        goal_score: 9.0,
      },
      {
        rank: 2,
        compound: 'Epitalon',
        tagline: 'Telomere extension and circadian reset — the aging clock compound',
        why_first: 'Epitalon activates telomerase — the enzyme that rebuilds telomere length. Telomere shortening is one of the primary hallmarks of cellular aging. Additionally, Epitalon resets circadian rhythm, improves deep sleep quality, and has shown tumor suppression effects in animal models.',
        best_for: ['Telomere preservation and lengthening', 'Sleep quality improvement', 'Circadian rhythm regulation', 'Long-term longevity protocol'],
        research_maturity: 'moderate',
        goal_score: 8.5,
      },
      {
        rank: 3,
        compound: 'GHK-Cu',
        tagline: 'Structural repair and gene expression — 4,000 genes activated',
        why_first: 'GHK-Cu activates or inhibits over 4,000 human genes — including genes for collagen synthesis, antioxidant defense, DNA repair, and anti-inflammatory pathways. Plasma GHK-Cu levels drop precipitously with age.',
        best_for: ['Skin rejuvenation and collagen synthesis', 'Wound healing', 'Hair follicle restoration', 'Gene expression reset'],
        research_maturity: 'high',
        goal_score: 8.0,
      },
    ],
    pick_one: {
      recommendation: 'NAD+',
      reason: 'Foundational. Every anti-aging mechanism requires cellular energy. Restoring NAD+ is the single highest-leverage intervention because it enables everything else — including DNA repair, sirtuin activation, and mitochondrial function.',
    },
    pick_two: {
      recommendation: ['NAD+', 'Epitalon'],
      reason: 'NAD+ restores cellular energy and DNA repair capacity. Epitalon addresses the aging clock itself (telomeres) and sleep quality. Energy restoration + clock reset = two distinct and complementary longevity mechanisms.',
    },
    best_stack: {
      compounds: ['NAD+', 'Epitalon', 'GHK-Cu'],
      label: 'Complete Anti-Aging Triad',
      reason: 'Cellular energy + telomere clock + structural gene reset. Three different mechanisms working simultaneously.',
    },
    synergy: {
      nad_epitalon: {
        compounds: ['NAD+', 'Epitalon'],
        score: 9,
        explanation: 'NAD+ restores the cellular energy required for DNA repair enzymes to function. Epitalon activates telomerase which uses that DNA repair capacity to rebuild telomere length. Without NAD+, telomerase has no fuel.',
        stack_benefit: 'Cellular energy + DNA repair direction = the most studied longevity combination',
      },
      nad_ghkcu: {
        compounds: ['NAD+', 'GHK-Cu'],
        score: 8,
        explanation: 'NAD+ addresses aging at the metabolic/energy level. GHK-Cu addresses aging at the structural/gene expression level. Together they hit both internal (metabolic) and external (structural) aging simultaneously.',
        stack_benefit: 'Internal metabolic anti-aging + external structural and genetic reset',
      },
      full_antiaging: {
        compounds: ['NAD+', 'Epitalon', 'GHK-Cu'],
        score: 10,
        explanation: 'NAD+ provides cellular energy and activates sirtuins. Epitalon resets the telomere clock and circadian rhythm. GHK-Cu restructures gene expression and rebuilds connective tissue. Three different mechanisms — cellular energy, genomic clock, and structural gene expression.',
        stack_benefit: 'Comprehensive anti-aging intervention across all three primary aging mechanisms',
      },
    },
  },

  // ── COGNITIVE & MOOD ──────────────────────────────────────────
  cognitive: {
    label: '🧠 Cognitive',
    intro: 'Three compounds that target three different aspects of brain function. Semax sharpens. Selank calms. DSIP restores.',
    goalKey: 'cognitive',
    ranked: [
      {
        rank: 1,
        compound: 'Semax',
        tagline: 'Focus, BDNF boost, and cognitive sharpness',
        why_first: 'Semax dramatically increases BDNF (brain-derived neurotrophic factor) — the protein responsible for neuronal growth and cognitive plasticity. Studies show enhanced memory consolidation, increased dopamine and serotonin turnover, and neuroprotective effects.',
        best_for: ['Mental sharpness and focus', 'Memory formation and recall', 'ADHD-adjacent cognitive support', 'Depression (dopaminergic)'],
        research_maturity: 'moderate',
        goal_score: 9.0,
      },
      {
        rank: 2,
        compound: 'Selank',
        tagline: 'Anxiety reduction and GABAergic calm — without dependency',
        why_first: 'Selank modulates the GABA system to produce anxiolytic effects comparable to benzodiazepines in clinical research, but without dependency, tolerance, or withdrawal. A double-blind trial found it as effective as standard anxiety medication.',
        best_for: ['Anxiety and stress reduction', 'GABAergic balance', 'Cognitive performance under stress', 'Sleep quality (anxiety-driven insomnia)'],
        research_maturity: 'moderate',
        goal_score: 8.5,
      },
      {
        rank: 3,
        compound: 'DSIP',
        tagline: 'Deep sleep induction and overnight neurological repair',
        why_first: 'Delta Sleep-Inducing Peptide promotes delta sleep architecture, reduces the time to reach deep sleep, and normalizes disrupted sleep patterns. Most neurological repair, memory consolidation, and GH secretion occur during delta sleep.',
        best_for: ['Insomnia and sleep onset issues', 'Deep sleep quality', 'Overnight cognitive recovery', 'Stress-related sleep disruption'],
        research_maturity: 'moderate',
        goal_score: 7.5,
      },
    ],
    pick_one: {
      recommendation: 'Semax',
      reason: 'The highest-impact compound for active cognitive performance. BDNF increase, dopamine support, memory enhancement, and neuroprotection in one compound.',
    },
    pick_two: {
      recommendation: ['Semax', 'Selank'],
      reason: 'Semax sharpens focus and elevates BDNF. Selank reduces the anxiety that impairs focus. They modulate different neurotransmitter systems (dopaminergic vs. GABAergic) and work synergistically.',
    },
    best_stack: {
      compounds: ['Semax', 'Selank', 'DSIP'],
      label: 'Full Cognitive Stack',
      reason: 'Daytime sharpness (Semax) + anxiety control (Selank) + deep recovery sleep (DSIP) = complete neurological optimization.',
    },
    synergy: {
      semax_selank: {
        compounds: ['Semax', 'Selank'],
        score: 9,
        explanation: 'Often called the "Russian nootropic stack." Semax works on dopaminergic and BDNF pathways — sharpening focus, motivation, and memory. Selank works on GABAergic pathways — reducing anxiety and cognitive interference from stress. Focus + calm = cognitive performance without the jittery edge.',
        stack_benefit: 'The most studied nootropic peptide combination — dual-pathway cognitive enhancement',
      },
      semax_dsip: {
        compounds: ['Semax', 'DSIP'],
        score: 8,
        explanation: 'Semax during waking hours enhances BDNF and memory consolidation. DSIP at night deepens slow-wave sleep — the phase where BDNF is integrated into long-term memory. Daytime learning + deep-sleep consolidation = maximized neuroplasticity.',
        stack_benefit: 'Enhanced learning during the day, deeper memory consolidation at night',
      },
    },
  },

  // ── MUSCLE & PERFORMANCE ──────────────────────────────────────
  muscle: {
    label: '💪 Performance',
    intro: 'Growth hormone stimulation through two different mechanisms — pulse vs. sustained. Here\'s the difference and when to choose each.',
    goalKey: 'muscle',
    ranked: [
      {
        rank: 1,
        compound: 'CJC-1295 DAC',
        tagline: 'Sustained GH elevation — the week-long pulse',
        why_first: 'CJC-1295 with DAC binds to albumin in the blood, extending its half-life to 6–8 days from a single injection. One injection per week maintains elevated growth hormone releasing hormone (GHRH) signaling continuously. Best for consistent body recomposition.',
        best_for: ['Consistent body recomposition', 'Weekly injection protocol', 'Long-term muscle building and fat loss', 'Recovery enhancement over time'],
        research_maturity: 'high',
        goal_score: 9.0,
      },
      {
        rank: 2,
        compound: 'Ipamorelin',
        tagline: 'The cleanest GH pulse — daily, precise, minimal side effects',
        why_first: 'Ipamorelin is a selective GHRP that produces a clean, sharp GH pulse 2–3 hours after injection. Unlike other GHRPs, it does NOT stimulate cortisol, prolactin, or appetite-increasing hormones — only GH.',
        best_for: ['Clean overnight GH pulse', 'Minimal side effects', 'Daily protocol for consistent muscle/recovery', 'Pairing with CJC-1295'],
        research_maturity: 'high',
        goal_score: 8.5,
      },
    ],
    pick_one: {
      recommendation: 'Ipamorelin',
      reason: 'The safest entry point into GH stimulation. Clean mechanism, minimal side effects, daily protocol, and well-studied.',
    },
    pick_two: {
      recommendation: ['CJC-1295 DAC', 'Ipamorelin'],
      reason: 'The gold standard combination. CJC-1295 DAC maintains baseline GHRH signaling all week. Ipamorelin generates a sharp GH pulse at night. Together they produce GH levels significantly higher than either alone.',
    },
    best_stack: {
      compounds: ['CJC-1295 DAC', 'Ipamorelin'],
      label: 'GH Optimization Stack',
      reason: 'CJC primes the pituitary all week. Ipamorelin fires the pulse nightly. Studies show 3–5× GH elevation vs either alone.',
    },
    synergy: {
      cjc_ipa: {
        compounds: ['CJC-1295 DAC', 'Ipamorelin'],
        score: 10,
        explanation: 'CJC-1295 DAC acts on GHRH receptors — it primes the pituitary gland to be ready for GH release all week. Ipamorelin acts on ghrelin receptors (a different pathway) — it pulls the trigger on GH release. One primes the pump, the other activates it. Studies show 3–5× the GH elevation of either compound alone.',
        stack_benefit: 'The most studied and effective GH stimulation stack — dramatically superior to either alone',
      },
    },
  },

  // ── SEXUAL HEALTH & HORMONAL ──────────────────────────────────
  sexual: {
    label: '❤️ Sexual Health',
    intro: 'Two compounds. Same category, very different mechanisms and use cases.',
    goalKey: 'sexual',
    ranked: [
      {
        rank: 1,
        compound: 'PT-141',
        tagline: 'Central nervous system activation — the brain-based approach',
        why_first: 'PT-141 works on melanocortin receptors in the brain — specifically the hypothalamus. Unlike PDE5 inhibitors which work on blood flow mechanics, PT-141 activates the neurological desire pathway. FDA approved for premenopausal women with hypoactive sexual desire disorder.',
        best_for: ['Desire and libido activation', 'When mechanical approaches have failed', 'Female sexual dysfunction', 'Low desire without vascular issues'],
        research_maturity: 'high',
        goal_score: 8.5,
      },
      {
        rank: 2,
        compound: 'Kisspeptin',
        tagline: 'HPG axis activation — testosterone and LH restoration at the source',
        why_first: 'Kisspeptin is the master regulator of the HPG axis — the hormonal cascade that controls testosterone, LH, and FSH production. Kisspeptin administration produces pulsatile LH release, which in turn stimulates testosterone production.',
        best_for: ['Low testosterone and LH', 'Hormonal axis restoration', 'Post-steroid cycle recovery', 'Fertility support', 'Age-related testosterone decline'],
        research_maturity: 'moderate',
        goal_score: 8.0,
      },
    ],
    pick_one: {
      recommendation: 'PT-141 or Kisspeptin — depends on goal',
      reason: 'PT-141 if the primary goal is desire and arousal (neurological). Kisspeptin if the primary goal is testosterone restoration and hormonal balance (endocrine).',
    },
    pick_two: {
      recommendation: ['Kisspeptin', 'PT-141'],
      reason: 'Kisspeptin restores the hormonal foundation. PT-141 addresses the central nervous system layer. Hormonal balance + neurological activation is the most complete approach.',
    },
    best_stack: {
      compounds: ['PT-141', 'Kisspeptin'],
      label: 'Complete Sexual Health Stack',
      reason: 'Hormonal substrate (Kisspeptin) + neural desire activation (PT-141) = comprehensive support from two independent mechanisms.',
    },
    synergy: {
      pt141_kisspeptin: {
        compounds: ['PT-141', 'Kisspeptin'],
        score: 8,
        explanation: 'Kisspeptin works at the hormonal/endocrine layer — restoring LH pulses and testosterone production over weeks. PT-141 works at the neurological layer — activating melanocortin receptors in the brain for acute desire activation. One restores the hormonal substrate, the other activates the neural pathway.',
        stack_benefit: 'Hormonal restoration + neural activation = comprehensive sexual health support from two independent mechanisms',
      },
    },
  },
};

// ── Goal pill → category key mapping ────────────────────────────
export const GOAL_PILLS = [
  { label: '🩹 Healing',       key: 'healing',   compounds: ['BPC-157', 'TB-500', 'KPV'] },
  { label: '🔥 Fat Loss',      key: 'weight',    compounds: ['Semaglutide', 'Retatrutide', 'AOD-9604'] },
  { label: '🧠 Cognitive',     key: 'cognitive', compounds: ['Semax', 'Selank', 'DSIP'] },
  { label: '✨ Anti-Aging',    key: 'antiaging', compounds: ['NAD+', 'Epitalon', 'GHK-Cu'] },
  { label: '💪 Performance',   key: 'muscle',    compounds: ['CJC-1295 DAC', 'Ipamorelin'] },
  { label: '❤️ Sexual Health', key: 'sexual',    compounds: ['PT-141', 'Kisspeptin'] },
];
