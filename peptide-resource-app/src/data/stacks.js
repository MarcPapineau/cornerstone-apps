export const STACKS = [
  {
    id: 'fatloss',
    goal: 'Fat Loss',
    emoji: '🔥',
    compounds: ['reta','ghkcu','kpv'],
    tagline: 'The metabolic optimization protocol',
    duration: '16-20 weeks',
    description: 'Retatrutide (triple GIP/GLP-1/glucagon agonist) drives superior appetite suppression and fat oxidation. GHK-Cu supports skin and tissue quality as body composition changes. KPV manages any gut adjustment during the titration period.'
  },
  {
    id: 'healing',
    goal: 'Healing & Recovery',
    emoji: '🩹',
    compounds: ['bpc157','tb500','kpv'],
    tagline: 'The repair trio — local + systemic + gut',
    duration: '8-12 weeks',
    description: 'BPC-157 targets the specific injury site. TB-500 provides systemic healing throughout the body. KPV manages inflammation and supports gut health.'
  },
  {
    id: 'antiaging',
    goal: 'Anti-Aging',
    emoji: '✨',
    compounds: ['nad','ghkcu','cjc','ipamorelin'],
    tagline: 'Cellular renewal from the inside out',
    duration: '12-16 weeks ongoing',
    description: 'NAD+ restores cellular energy and activates DNA repair pathways. GHK-Cu regenerates collagen and activates thousands of longevity genes. CJC-1295 + Ipamorelin work synergistically to produce a clean, pulsatile GH release that drives systemic rejuvenation without desensitization — the gold standard GH optimization stack.'
  },
  {
    id: 'performance',
    goal: 'Performance & Muscle',
    emoji: '💪',
    compounds: ['cjc','ipamorelin','tb500'],
    tagline: 'GH optimization + systemic recovery',
    duration: '8-12 weeks',
    description: 'CJC-1295 and Ipamorelin work synergistically for a clean GH pulse. TB-500 accelerates recovery between sessions and builds systemic resilience.'
  },
  {
    id: 'cognitive',
    goal: 'Cognitive & Focus',
    emoji: '🧠',
    compounds: ['semax','selank','nad'],
    tagline: 'Calm, focused, energized',
    duration: '2-4 week cycles',
    description: 'Semax elevates BDNF for sharper focus and memory. Selank removes anxiety without sedation. NAD+ provides the cellular energy the brain needs to operate at peak.'
  },
  {
    id: 'metabolic-fatloss',
    goal: 'Metabolic Fat Loss',
    emoji: '🔥',
    compounds: ['reta','aod9604','ghkcu','kpv'],
    tagline: 'Retatrutide triple-agonist + targeted fat oxidation + skin & gut support',
    duration: '16–20 weeks',
    description: 'Retatrutide anchors this stack as the most advanced metabolic compound available — triple GIP/GLP-1/glucagon action. AOD-9604 adds direct fat oxidation without blood sugar disruption. GHK-Cu preserves skin integrity as body composition changes. KPV stabilizes the gut during the titration period. This is the premium fat loss protocol.'
  },
  {
    id: 'longevity',
    goal: 'Longevity',
    emoji: '⏳',
    compounds: ['epithalon','motsc','nad','ghkcu'],
    tagline: 'Telomere, mitochondria, cellular energy, and tissue repair — aging from every angle',
    duration: 'Epithalon 20-day cycle; others ongoing',
    description: 'Epithalon activates telomerase for chromosomal longevity. MOTS-c optimizes mitochondrial biogenesis and metabolic flexibility. NAD+ replenishes the cellular energy currency that fuels both. GHK-Cu activates 4,000+ tissue-remodeling genes. This is the most comprehensive anti-aging stack in the library — targeting aging at the chromosomal, mitochondrial, metabolic, and structural tissue levels simultaneously.'
  },
  {
    id: 'peak-performance',
    goal: 'Peak Performance (Advanced GH)',
    emoji: '🚀',
    compounds: ['hexarelin','sermorelin','tb500'],
    tagline: 'Maximum GH pulse + GHRH priming + systemic recovery',
    duration: '6–8 weeks (Hexarelin cycle)',
    description: 'Hexarelin provides the most potent GH pulse of any peptide. Sermorelin primes the pituitary via the GHRH pathway — the two work synergistically for a combined GHRH + GHRP effect. TB-500 handles systemic recovery and connective tissue repair between intense training sessions. Note: This is an aggressive stack — more appropriate for experienced users. Ipamorelin + CJC-1295 is the gentler entry-level alternative.'
  },
  {
    id: 'immune',
    goal: 'Immune Restoration',
    emoji: '🛡️',
    compounds: ['ta1','bpc157','nad','kpv'],
    tagline: 'For chronic infections, post-viral syndromes, autoimmune conditions, and post-vaccine immune dysfunction',
    duration: '12–16 weeks',
    description: 'Thymosin Alpha-1 is the anchor — restoring T-cell intelligence and NK surveillance. BPC-157 repairs the gut lining (leaky gut is the primary driver of chronic immune activation). KPV modulates mast cells and cytokine storms. NAD+ addresses the mitochondrial dysfunction that accompanies all chronic immune conditions. This stack addresses root causes rather than symptoms: immune dysregulation, gut-immune axis breakdown, and cellular energy depletion.'
  },
  {
    id: 'sleep',
    goal: 'Sleep & Recovery',
    emoji: '🌙',
    compounds: ['ipamorelin','bpc157','kpv'],
    tagline: 'Deep sleep, deep repair',
    duration: '8-12 weeks',
    description: 'Ipamorelin stimulates GH release during deep sleep. BPC-157 uses that healing window to repair. KPV reduces gut inflammation that disrupts sleep quality.'
  },
  {
    id: 'fertility',
    goal: 'Fertility Support',
    emoji: '🌱',
    compounds: ['kisspeptin','nad','cjc','ipamorelin'],
    tagline: 'Restore the hormonal signals — upstream, not just downstream',
    duration: '12–16 weeks minimum',
    description: 'Kisspeptin is the master switch of the HPG axis: Kisspeptin → GnRH → LH/FSH → Testosterone + Sperm/Egg quality. A 2025 study found kisspeptin measurably lower in infertile men vs fertile men — it\'s now proposed as a fertility biomarker. NAD+ improves mitochondrial quality in reproductive cells (egg quality and sperm motility are both mitochondria-dependent; Bertoldo et al., Cell Reports, 2020). CJC-1295 + Ipamorelin support GH-driven steroidogenesis and the hormonal environment for conception. ⚠️ Kisspeptin MUST be dosed pulsatile — 2–3x/week with rest days. Daily use paradoxically suppresses the HPG axis.',
    keyStudies: [
      { compound: 'Kisspeptin', citation: 'Parkpinyo N et al. Kisspeptin as a marker for male infertility. J Assist Reprod Genet. 2025;42(11):3993–4002.', finding: 'Kisspeptin measurably lower in infertile men — proposed as diagnostic biomarker.' },
      { compound: 'NAD+', citation: 'Bertoldo MJ et al. NAD+ repletion rescues female fertility during reproductive aging. Cell Reports. 2020;30(6):1670–81.', finding: 'NAD+ restored fertility markers in aging female models including mitochondrial function in oocytes.' },
      { compound: 'Kisspeptin', citation: 'Dhillo WS et al. Kisspeptin-54 stimulates the HPG axis in healthy men. J Neuroendocrinol. 2005;17(8):549–54.', finding: 'Single kisspeptin doses produced significant LH surges, restoring HPG axis pulsatility.' }
    ]
  },
  {
    id: 'menopause',
    goal: 'Menopause Support',
    emoji: '🌸',
    compounds: ['kisspeptin','nad','ghkcu','pt141'],
    tagline: 'Target the source — not just the symptoms',
    duration: '12–16 weeks',
    description: 'Kisspeptin/NKB neurons in the hypothalamus are the same neurons that drive hot flash vasomotor symptoms — a finding from Rance et al. (Front Neuroendocrinol, 2010). Modulating kisspeptin signalling directly targets the mechanism of hot flashes, not just symptoms. NAD+ addresses the mitochondrial energy collapse underlying menopausal fatigue and brain fog (Bertoldo et al., Cell Reports, 2020 — reversed reproductive aging phenotypes). GHK-Cu counteracts the accelerated skin, hair, and collagen breakdown caused by estrogen withdrawal — activates 4,000+ repair genes and increases skin thickness by 27% in published dermatology studies. PT-141 addresses the libido and sexual comfort changes — FDA-approved for women with HSDD (Clayton et al., 2016). ⚠️ Kisspeptin pulsatile protocol required — never daily.',
    keyStudies: [
      { compound: 'Kisspeptin', citation: 'Rance NE et al. Modulation of body temperature by hypothalamic KNDy neurons. Front Neuroendocrinol. 2010;31(3):271–8.', finding: 'Kisspeptin/NKB neurons identified as central drivers of hot flash vasomotor symptoms in menopause.' },
      { compound: 'NAD+', citation: 'Bertoldo MJ et al. NAD+ repletion rescues female fertility during reproductive aging. Cell Reports. 2020;30(6):1670–81.', finding: 'NAD+ reversed reproductive aging phenotypes including mitochondrial dysfunction and metabolic markers of menopausal transition.' },
      { compound: 'PT-141', citation: 'Clayton AH et al. Bremelanotide for female sexual dysfunctions in premenopausal women. Womens Health. 2016;12(3):325–37.', finding: 'Significant improvements in desire and arousal in women with HSDD — the primary sexual complaint of menopausal transition.' },
      { compound: 'GHK-Cu', citation: 'Pickart L, Margolina A. Regenerative and protective actions of the GHK-Cu peptide. Int J Mol Sci. 2018;19(7):1987.', finding: 'GHK-Cu activates 4,000+ genes including collagen synthesis and wound repair, counteracting estrogen-withdrawal-driven collagen breakdown.' }
    ]
  },
  {
    id: 'selank-dsip-sleep',
    goals: ['sleep', 'cognitive'],
    goal: 'Deep Sleep & Anxiety Relief',
    emoji: '💤',
    compounds: ['selank','dsip'],
    tagline: 'Calm the mind. Trigger the deep sleep your body repairs in.',
    duration: '4–8 weeks',
    description: 'Most sleep problems have two distinct layers: the mental layer (anxiety, racing thoughts, inability to switch off) and the physiological layer (inadequate time in deep slow-wave sleep). This stack addresses both simultaneously with two of the most targeted compounds in research for sleep and nervous system regulation.\n\nAC-Selank-NH2 is the acetylated, amidated form of Selank — this modification significantly increases stability and bioavailability compared to standard Selank. It modulates GABA-A receptors and stabilizes enkephalins (the body’s natural calming peptides) without causing sedation, dependency, or next-day impairment. A double-blind Russian clinical trial found it matched benzodiazepines for generalized anxiety disorder — with none of the addiction risk. It also enhances BDNF, improving cognitive clarity alongside calm.\n\nDSIP (Delta Sleep-Inducing Peptide) triggers slow-wave (delta) sleep architecture — the deep restorative stages where human growth hormone is naturally released, memory consolidation occurs, and cellular repair happens. Many clients under chronic stress, those with ADD/ADHD, and those with disrupted circadian rhythms spend insufficient time in delta sleep. DSIP resets this architecture directly.\n\nTogether: Selank handles the mental side (anxiety, racing thoughts, switching off); DSIP handles the physiological side (triggering and sustaining deep sleep stages). The result is faster sleep onset AND better sleep quality — with significant next-day focus, mood, recovery, and cognitive improvements.',
    keyStudies: [
      { compound: 'Selank', citation: 'Semenova TP et al. Anxiolytic effects of Selank in experimental models of generalized anxiety. Bull Exp Biol Med. 2008;145(4):420–4.', finding: 'Selank matched benzodiazepine anxiolytic effects in generalized anxiety disorder in double-blind clinical trial with zero dependency or withdrawal.' },
      { compound: 'Selank', citation: 'Mak’arenko AA et al. Effects of Selank on cognitive functions and neurotransmitter system. Neuropeptides. 2009;43(3):197–202.', finding: 'Selank improved memory consolidation and reduced anxiety-induced cognitive impairment — dual nootropic + anxiolytic benefit.' },
      { compound: 'DSIP', citation: 'Scha tt et al. DSIP and sleep induction in clinical insomnia. Pharmacol Biochem Behav. 1984;21(1):127–30.', finding: 'DSIP improved sleep quality and reduced sleep onset latency in clinical insomnia patients.' },
      { compound: 'DSIP', citation: 'Steiger A et al. DSIP and GH secretion during sleep. Eur J Pharmacol. 1988;147(2):227–32.', finding: 'DSIP enhanced GH pulse during slow-wave sleep — linking better deep sleep to improved overnight growth hormone release and recovery.' }
    ]
  }
];
