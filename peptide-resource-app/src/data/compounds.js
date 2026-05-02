import { DOSING_PROTOCOLS, RECON_SOLVENT_DATA } from './dosingProtocols.js';

const RAW_COMPOUNDS = [
  // ============================================================
  // ORDER: Most popular / commonly researched first
  // ============================================================

  {
    id: 'bpc157',
    name: 'BPC-157',
    fullName: 'Body Protection Compound 157',
    category: 'healing',
    emoji: '🩹',
    tagline: 'The universal healer — tendons, gut, muscle, nerves',
    confidence: 'HIGH',
    benefits: ['Tendon & ligament repair','Gut healing','Muscle recovery','Anti-inflammatory','Wound healing','Neuroprotective'],
    description: 'BPC-157 is one of the most researched healing peptides. Derived from a protective protein in gastric juice, it accelerates repair across tendons, ligaments, muscle, gut tissue, and the nervous system simultaneously.',
    mechanism: 'Upregulates growth hormone receptors, promotes angiogenesis via VEGFR2, activates FAK-paxillin pathway',
    dose: '0.25–0.5mg/day',
    frequency: 'Once or twice daily',
    duration: '4–12 weeks',
    reconstitution: {
      bacWater: '2mL',
      vialSize: '5mg',
      concentration: '2,500mcg/mL',
      steps: [
        'Add 2mL BAC water to your 5mg vial',
        'Swirl gently — never shake',
        'You now have 2,500mcg per mL'
      ],
      syringeTable: [
        { dose: '250mcg', units: 10, ml: '0.10mL' },
        { dose: '500mcg', units: 20, ml: '0.20mL' }
      ]
    },
    storage: 'Refrigerate after reconstitution. Use within 28 days.',
    sideEffects: ['Nausea (rare, dose-dependent)','Mild injection site redness','Histamine reaction (uncommon — KPV resolves)'],
    burnWarning: false,
    flushWarning: false,
    notable: 'In animal studies, BPC-157 healed completely severed Achilles tendons faster than surgical repair — and reversed alcohol-induced stomach ulcers within 24 hours. It simultaneously upregulates nitric oxide pathways AND growth hormone receptors, making it one of the most multi-mechanism repair compounds in research.',
    faq: [
      { q: 'Can BPC-157 actually heal a torn tendon or ligament?', a: 'Research suggests yes — and faster than the body alone. Animal studies showed BPC-157 healed completely severed Achilles tendons faster than surgical repair, upregulating GH receptors in tendon fibroblasts and stimulating new blood vessel formation simultaneously.' },
      { q: 'I have gut issues / IBS / leaky gut. Can this help?', a: 'BPC-157 was originally derived from a protective protein in gastric juice — gut healing is what it was designed for. Studies show it heals gut mucosal lining, reduces IBD inflammation, and protects against NSAID-induced gut damage. Oral delivery works for gut-specific effects.' },
      { q: 'Can BPC-157 be taken orally?', a: 'Both work for different goals. Oral: effective for gut-specific healing. Injectable SubQ: better for systemic benefits (tendons, muscle, inflammation).' },
      { q: 'How fast will I notice results?', a: 'Acute injuries: 1–2 weeks is common. Gut healing: days for acute, 4–8 weeks for chronic. Consistency matters more than dose.' },
      { q: 'Can I stack with TB-500?', a: 'Highly recommended. BPC-157 targets local repair; TB-500 provides systemic healing throughout the whole body. Together they consistently outperform either alone.' }
    ],
    research: [
      { title: 'Stable gastric pentadecapeptide BPC 157 in trials for inflammatory bowel disease and wound healing', journal: 'Current Pharmaceutical Design, 2018', url: 'https://pubmed.ncbi.nlm.nih.gov/29173160/' },
      { title: 'BPC 157 effects on tendon healing in vitro and in vivo', journal: 'Journal of Orthopaedic Research, 2010', url: 'https://pubmed.ncbi.nlm.nih.gov/19763488/' }
    ]
  },

  {
    id: 'reta',
    name: 'Retatrutide',
    fullName: 'Retatrutide (GIP/GLP-1/Glucagon Triple Agonist)',
    category: 'weight',
    emoji: '🔥',
    tagline: 'Triple receptor agonist — the most advanced metabolic research compound available',
    confidence: 'HIGH',
    benefits: ['Significant fat mass reduction','Appetite suppression via triple receptor action','Blood sugar regulation','Improved insulin sensitivity','Lean mass preservation','Cardiovascular metabolic markers improvement'],
    description: 'Retatrutide is a next-generation triple agonist targeting GIP, GLP-1, and glucagon receptors simultaneously. Phase 2 trials demonstrated up to 24% body weight reduction over 48 weeks — surpassing all previously studied compounds in this class. It is the most advanced metabolic research compound in its category.',
    mechanism: 'Simultaneously activates GIP receptors (energy metabolism, fat storage), GLP-1 receptors (appetite, gastric emptying, insulin), and glucagon receptors (fat oxidation, energy expenditure). Triple action creates synergistic metabolic effect not seen with single or dual agonists.',
    dose: 'Start 0.5mg/week → titrate to 1–8mg/week (Phase 2 trial range)',
    frequency: 'Once weekly SubQ injection',
    duration: 'Long-term metabolic management — minimum 16 weeks to assess response',
    reconstitution: {
      bacWater: '1mL',
      vialSize: '5mg',
      concentration: '5mg/mL (5,000mcg/mL)',
      steps: ['Add 1mL BAC water to 5mg vial. Swirl gently — do not shake.','5mg per mL — draw carefully','Start at the absolute lowest dose and titrate slowly over 4-6 weeks'],
      syringeTable: [{ dose: '0.5mg', units: 10, ml: '0.10mL' },{ dose: '1mg', units: 20, ml: '0.20mL' },{ dose: '2mg', units: 40, ml: '0.40mL' },{ dose: '4mg', units: 80, ml: '0.80mL' }]
    },
    storage: 'Refrigerate immediately upon receipt. Never leave at room temperature. Use within 28 days of reconstitution. Protect from light.',
    sideEffects: ['Nausea (common first 4-8 weeks — titrate slowly to minimize)','Decreased appetite (expected — monitor food intake)','Mild fatigue during adjustment period','GI adjustment (diarrhea or constipation) — usually resolves within 4 weeks'],
    burnWarning: false,
    flushWarning: false,
    notable: 'Phase 2 trials (Nature Medicine, 2024) showed 24% body weight reduction AND 81% clearance of liver fat at the 8mg dose over 24 weeks. No other compound has demonstrated this magnitude of liver fat clearance. Participants with metabolic fatty liver disease essentially had the condition reversed.',
    faq: [
      { q: 'How does Retatrutide compare to Semaglutide or Tirzepatide?', a: 'Retatrutide is a triple agonist (GIP + GLP-1 + glucagon). Phase 2 data shows 24% body weight reduction vs ~15% for semaglutide. The glucagon receptor arm also drives thermogenesis and liver fat clearance not seen in dual or single agonists.' },
      { q: 'I heard it can clear fatty liver — is that true?', a: 'Yes. A 2024 Nature Medicine substudy showed 81% reduction in liver fat at 8mg over 24 weeks. Participants with MASLD (fatty liver disease) essentially had the condition reversed — the most significant liver fat clearance ever recorded in a compound trial.' },
      { q: 'How long until results?', a: 'Appetite changes begin week 1–2. Body composition changes appear by weeks 4–8. Significant results by month 3–4. Liver fat improvement measurable by week 12.' },
      { q: 'Should I cycle off?', a: 'Consult your physician. Abrupt discontinuation may cause appetite rebound. Taper under medical guidance.' }
    ],
    research: [
      { title: 'Retatrutide (GIP/GLP-1/glucagon triple agonist) Phase 2 trial — up to 24.2% body weight reduction at 48 weeks', journal: 'New England Journal of Medicine, 2023', url: 'https://pubmed.ncbi.nlm.nih.gov/37366315/' },
      { title: 'Efficacy and safety of retatrutide — Phase 2 randomized controlled trial', journal: 'NEJM Evidence, 2023', url: 'https://clinicaltrials.gov/study/NCT05929066' }
    ]
  },

  {
    id: 'tb500',
    name: 'TB-500',
    fullName: 'Thymosin Beta-4',
    category: 'healing',
    emoji: '🩹',
    tagline: 'Systemic repair — works throughout the entire body',
    confidence: 'HIGH',
    benefits: ['Systemic tissue repair','Reduces inflammation','Improves flexibility','Cardiac support','Hair growth','Endurance'],
    description: 'TB-500 is a synthetic version of Thymosin Beta-4, found in virtually every human cell. It provides systemic healing — working throughout the whole body rather than just the injection site.',
    mechanism: 'Promotes actin polymerization, activates stem cell differentiation, upregulates anti-inflammatory pathways',
    dose: '2–2.5mg twice weekly (loading) | 2–2.5mg/week (maintenance)',
    frequency: '2x/week (loading), then 1x/week (maintenance)',
    duration: '6–12 weeks',
    reconstitution: {
      bacWater: '2mL',
      vialSize: '5mg',
      concentration: '2,500mcg/mL',
      steps: ['Add 2mL BAC water to 5mg vial','Swirl gently','2,500mcg per mL'],
      syringeTable: [{ dose: '1mg', units: 40, ml: '0.40mL' },{ dose: '2.5mg', units: 100, ml: '1.00mL' }]
    },
    storage: 'Refrigerate after reconstitution. Use within 28 days.',
    sideEffects: ['Fatigue (first 1-2 days — normal healing response)','Mild head rush — inject slowly','Histamine flushing at high doses'],
    burnWarning: false,
    flushWarning: false,
    notable: 'TB-500 stimulates new blood vessel formation (angiogenesis) in cardiac tissue. Studies in heart attack models showed it reduced scar tissue and partially restored cardiac function — making it the only healing peptide with published evidence of heart muscle repair.',
    faq: [
      { q: 'Can TB-500 help my heart or support cardiovascular health?', a: 'Cardiac research on TB-500 is remarkable. Animal studies showed it reduced cardiac scar tissue after heart attack and partially restored contractile function. The mechanism: TB-500 stimulates angiogenesis in cardiac tissue, growing new blood vessels around damaged areas.' },
      { q: 'TB-500 vs BPC-157 — which is better?', a: 'Different tools. BPC-157 is site-specific — works best near the injury. TB-500 is systemic — travels through the bloodstream to every tissue at once. Stack them for maximum effect.' },
      { q: 'Can TB-500 help with hair loss?', a: 'Yes — published research (FASEB Journal, 2010) shows Thymosin Beta-4 activates hair follicle stem cells and promotes new follicle cycling, producing measurable hair growth in models.' },
      { q: 'How often do I inject TB-500?', a: 'Loading: 2.5mg twice weekly for 4–6 weeks. Maintenance: 2.5mg once weekly. Skipping the loading phase is the most common mistake — it produces significantly weaker results.' }
    ],
    research: [
      { title: 'Thymosin beta 4 accelerates wound healing', journal: 'Annals of the New York Academy of Sciences, 2012', url: 'https://pubmed.ncbi.nlm.nih.gov/22985322/' },
      { title: 'Thymosin beta-4 and the heart — mechanisms of repair', journal: 'Journal of Molecular and Cellular Cardiology, 2013', url: 'https://pubmed.ncbi.nlm.nih.gov/23669250/' }
    ]
  },

  {
    id: 'nad',
    name: 'NAD+',
    fullName: 'Nicotinamide Adenine Dinucleotide',
    category: 'antiaging',
    emoji: '✨',
    tagline: 'Cellular energy currency — the foundation of longevity',
    confidence: 'HIGH',
    benefits: ['Cellular energy restoration','DNA repair (Sirtuins)','Brain clarity','Mitochondrial function','Anti-aging','Addiction recovery support'],
    description: 'NAD+ is the fundamental currency of cellular energy. It declines 50% between ages 40-60. Injectable NAD+ bypasses digestive conversion for faster, more complete replenishment.',
    mechanism: 'Replenishes cellular NAD+ pool. Activates Sirtuin enzymes (SIRT1-7) for DNA repair and longevity. Activates PARP for DNA damage repair.',
    dose: '250–500mg per session (IV) | 100mg per injection (SubQ)',
    frequency: '3-5x weekly or daily (lower dose)',
    duration: 'Ongoing',
    reconstitution: {
      bacWater: '2mL',
      vialSize: '500mg',
      concentration: '250mg/mL',
      steps: [
        '⚠️ FIRST-DOSE PROTOCOL — do not skip this step',
        'Session 1–3: start at 25–50mg only. Your body needs to adapt to NAD+ flushing.',
        'Session 4–6: increase to 100mg once flushing is manageable.',
        'Established users: 250mg is the standard research dose.',
        'Add 2mL BAC water to 500mg vial — 250mg per mL.',
        'Inject EXTREMELY slowly — 3–5 full minutes for a 250mg dose. Rushing causes intense flushing and nausea.',
        'Flushing, warmth, and tingling are NORMAL — peak at 5–15 min, resolve within 45 min.'
      ],
      syringeTable: [{ dose: '50mg', units: 20, ml: '0.20mL' },{ dose: '100mg', units: 40, ml: '0.40mL' },{ dose: '250mg', units: 100, ml: '1.00mL' }]
    },
    storage: 'Refrigerate. Keep from light. Use within 14 days (more fragile than peptides).',
    sideEffects: ['FLUSHING/warmth during injection (expected — COMPLETELY NORMAL — inject slowly)','Nausea if injected too fast (slow down to 3–5 min)','Headache (drink water before and after)','Post-injection fatigue (schedule morning or early afternoon)'],
    burnWarning: false,
    flushWarning: true,
    flushNote: 'NAD+ causes significant flushing, warmth, and tingling during injection. This is EXPECTED and is a sign it is working. It peaks at 5–15 min and fully resolves within 45 min. ALWAYS inject over 3–5 full minutes. Start at 25–50mg for sessions 1–3, then build up. The flushing diminishes significantly after the first few sessions.',
    notable: "Harvard's David Sinclair found that restoring NAD+ levels in aged mice reversed vascular aging to levels indistinguishable from young mice within weeks. Humans lose approximately 50% of their NAD+ between ages 40 and 60 — a decline researchers now directly link to accelerated aging across every tissue type.",
    faq: [
      { q: 'The flushing is intense — is that normal?', a: 'Yes — completely expected. NAD+ flushing is caused by prostaglandin activation during cellular uptake. Inject VERY slowly (3–5 full minutes for 250mg). The body adapts significantly after 3–5 sessions. Start at 50–100mg for your first few sessions.' },
      { q: "I'm 50+ and my energy has crashed. Can NAD+ help?", a: 'Directly. You lose ~50% of your NAD+ between 40 and 60 — every mitochondrion in your body uses it to generate energy. Harvard research (Das et al., Cell, 2018) showed restoring NAD+ reversed vascular aging to youthful levels within weeks. Energy, cognitive clarity, and recovery are the most consistently reported benefits.' },
      { q: 'Injectable vs NMN capsules?', a: 'Injectable delivers NAD+ directly to the bloodstream — no conversion required. Oral NMN must convert through cellular pathways with variable efficiency. For acute benefits (energy, clarity), injectable is faster and more reliable.' },
      { q: 'Can NAD+ help with addiction recovery?', a: 'Yes. IV NAD+ therapy is used clinically for alcohol and opioid detox. Addiction depletes NAD+ stores significantly, contributing to neurological dysfunction and cravings. Replenishing NAD+ restores neurotransmitter balance.' }
    ],
    research: [
      { title: 'NAD+ metabolism and its roles in cellular processes during ageing', journal: 'Nature Reviews Molecular Cell Biology, 2021', url: 'https://pubmed.ncbi.nlm.nih.gov/33353981/' },
      { title: 'Declining NAD+ induces a pseudohypoxic state disrupting nuclear-mitochondrial communication', journal: 'Cell, 2013', url: 'https://pubmed.ncbi.nlm.nih.gov/24360282/' }
    ]
  },

  {
    id: 'ipamorelin',
    name: 'Ipamorelin',
    fullName: 'Ipamorelin (GHRP-5)',
    category: 'performance',
    emoji: '💪',
    tagline: 'The cleanest GH secretagogue — no cortisol, no hunger spike',
    confidence: 'HIGH',
    benefits: ['Clean GH stimulation','Muscle growth','Fat reduction','Improved sleep','Minimal side effects','Long-term use friendly'],
    description: 'Ipamorelin is the most selective GHRP available. It triggers GH release with minimal side effects — no cortisol spike, no prolactin elevation, no desensitization.',
    mechanism: 'Mimics ghrelin at GHS-R1a receptors. Selective for GH release only.',
    dose: '0.2–0.3mg per dose',
    frequency: '1-3x daily (pre-bed + morning + post-workout)',
    duration: '8–16 weeks+',
    reconstitution: {
      bacWater: '2mL',
      vialSize: '5mg',
      concentration: '2,500mcg/mL',
      steps: ['Add 2mL BAC water to 5mg vial','2,500mcg per mL','Best taken on empty stomach'],
      syringeTable: [{ dose: '200mcg', units: 8, ml: '0.08mL' },{ dose: '300mcg', units: 12, ml: '0.12mL' }]
    },
    storage: 'Refrigerate. Use within 28 days.',
    sideEffects: ['Mild water retention (less than other GHRPs)','Slight injection site irritation','Mild hunger increase'],
    burnWarning: false,
    flushWarning: false,
    notable: 'Unlike every other GHRP (GHRP-2, GHRP-6, hexarelin), Ipamorelin produces zero cortisol or prolactin elevation at any tested dose. Researchers call it the "cleanest" GHRP ever studied — selective GH stimulation with no hormonal collateral effects. Published in European Journal of Endocrinology, 1998.',
    faq: [
      { q: 'Why is Ipamorelin preferred over GHRP-6?', a: 'Ipamorelin is highly selective for GH only. GHRP-6 causes significant cortisol and prolactin spikes — hormones that actively work against most protocol goals. Ipamorelin triggers GH release with no cortisol, no prolactin, no ACTH effect at any tested dose. Cleaner, safer, and better for extended protocols.' },
      { q: 'When should I inject Ipamorelin for best results?', a: 'Inject in a fasted state — minimum 2 hours after eating, 30 min before eating again. Insulin from food directly blunts GH secretion. Pre-bed injection (after an evening fast) is optimal — it amplifies the natural GH pulse during deep sleep.' },
      { q: 'Will Ipamorelin help me lose belly fat?', a: 'GH directly stimulates lipolysis — fat breakdown — particularly visceral fat. Published GH research consistently shows abdominal fat loss as a primary effect of sustained GH elevation. Expect gradual changes over 8–12 weeks, not overnight.' },
      { q: 'Does Ipamorelin suppress natural GH production?', a: 'No — unlike synthetic HGH, Ipamorelin stimulates your pituitary to release its own GH. No suppression of endogenous production. It also specifically does not cause receptor desensitization with continued use — you can run extended protocols.' }
    ],
    research: [
      { title: 'Ipamorelin, a new growth hormone releasing peptide with selective GH secretion', journal: 'European Journal of Endocrinology, 1998', url: 'https://pubmed.ncbi.nlm.nih.gov/9849822/' },
      { title: 'Ipamorelin — no ACTH, cortisol, or prolactin response distinguishes it from other GHRPs', journal: 'Growth Hormone & IGF Research, 1999', url: 'https://pubmed.ncbi.nlm.nih.gov/10373343/' }
    ]
  },

  {
    id: 'cjc',
    name: 'CJC-1295 DAC',
    fullName: 'CJC-1295 with Drug Affinity Complex',
    category: 'performance',
    emoji: '💪',
    tagline: 'Weekly GH stimulation — natural pulsatile release',
    confidence: 'HIGH',
    benefits: ['Increased GH + IGF-1','Muscle growth','Fat loss','Sleep quality','Anti-aging','Bone density','Recovery enhancement'],
    description: 'CJC-1295 DAC is a long-acting GHRH analogue with an 8-day half-life. It stimulates the pituitary to produce growth hormone naturally — safer than exogenous HGH.',
    mechanism: 'Binds GHRH receptors in pituitary. DAC modification binds albumin, extending half-life to ~8 days.',
    dose: 'Start 0.1–0.2mg/week → build to 0.5–1mg/week based on tolerance',
    frequency: 'Once weekly (8-day half-life — doses accumulate)',
    duration: '8–12 weeks on, 4 weeks off',
    reconstitution: {
      bacWater: '2mL',
      vialSize: '2mg',
      concentration: '1mg/mL (1,000mcg/mL)',
      steps: [
        'Add 2mL BAC water to 2mg vial — 1mg per mL',
        '⚠️ START LOW — the 8-day half-life means doses accumulate week over week',
        'Week 1–2: 100–200mcg (10–20 units) to assess sensitivity',
        'Week 3–4: 300–500mcg if well tolerated',
        'Experienced: 500mcg–1mg once weekly',
        'Inject before bed on empty stomach (3+ hrs after eating)'
      ],
      syringeTable: [{ dose: '200mcg', units: 20, ml: '0.20mL' },{ dose: '500mcg', units: 50, ml: '0.50mL' },{ dose: '1mg', units: 100, ml: '1.00mL' }]
    },
    storage: 'Refrigerate. Use within 28 days.',
    sideEffects: ['Water retention (mild, first 2 weeks)','Tingling/numbness in hands (dose-dependent)','Increased sleep/fatigue (GH promotes deep sleep — often welcome)'],
    burnWarning: false,
    flushWarning: false,
    notable: "CJC-1295 DAC has an 8-day half-life — the longest of any GHRH analogue. One injection on Monday is still driving your pituitary's GH output the following Tuesday. It essentially converts your pituitary into a slow-release GH device.",
    faq: [
      { q: 'CJC-1295 DAC vs no-DAC?', a: 'DAC version: inject once weekly (8-day half-life) — convenient. No-DAC (Modified GRF 1-29): inject daily with Ipamorelin for more controlled pulsing. For most people, DAC wins on practicality.' },
      { q: 'I felt flushing and blood pressure changes at 1mg. Is that too much?', a: 'Possibly. CJC-1295 DAC doses accumulate week over week due to the 8-day half-life. Start at 100–200mcg and build up. Flushing and elevated BP are GH pulse side effects — not dangerous, but a clear signal your dose exceeds your threshold.' },
      { q: 'When is the best time to inject CJC-1295 DAC?', a: 'Before bed on an empty stomach (3+ hours after eating). GH is naturally secreted during deep sleep — this timing amplifies that natural rhythm. Fasted state maximizes the GH pulse.' },
      { q: 'How long until results?', a: 'Sleep quality: 1–2 weeks. Body composition changes: 8–12 weeks. Skin and joint benefits: ~3 months. Results build progressively.' }
    ],
    research: [
      { title: 'CJC-1295 — a long-acting growth hormone releasing factor analogue', journal: 'Journal of Clinical Endocrinology & Metabolism, 2006', url: 'https://pubmed.ncbi.nlm.nih.gov/16352683/' },
      { title: 'Growth hormone-releasing factor analogues with Drug Affinity Complex (DAC) technology', journal: 'Growth Hormone & IGF Research, 2007', url: 'https://pubmed.ncbi.nlm.nih.gov/17452128/' }
    ]
  },

  {
    id: 'ghkcu',
    name: 'GHK-Cu',
    fullName: 'Copper Peptide GHK-Cu',
    category: 'antiaging',
    emoji: '✨',
    tagline: 'Anti-aging at the cellular level — activates 4,000+ genes',
    confidence: 'HIGH',
    benefits: ['Skin tightening & collagen','Wound healing','Hair growth','DNA repair','Anti-inflammatory','Neuroprotection'],
    description: 'GHK-Cu is a naturally occurring copper peptide that declines 60% between age 20 and 60. It activates over 4,000 genes associated with tissue remodeling and wound healing.',
    mechanism: 'Activates TGF-β, VEGF, FGF pathways. Stimulates collagen/elastin synthesis. Acts as copper chaperone.',
    dose: '1–2mg/day',
    frequency: '3–5x weekly',
    duration: '8–16 weeks',
    reconstitution: {
      bacWater: '2mL',
      vialSize: '5mg',
      concentration: '2,500mcg/mL',
      steps: ['Add 2mL BAC water to 5mg vial','Note: blue/green colour is NORMAL — this is the copper complex','2,500mcg per mL'],
      syringeTable: [{ dose: '1mg', units: 40, ml: '0.40mL' },{ dose: '2mg', units: 80, ml: '0.80mL' }]
    },
    storage: 'Refrigerate. Blue/green colour is normal and expected.',
    sideEffects: ['BURNING at injection site (expected — inject very slowly)','Local redness (normal)','Histamine reaction (uncommon)'],
    burnWarning: true,
    flushWarning: false,
    burnNote: 'GHK-Cu consistently causes burning on injection. This is the copper complex interacting with tissue — NOT an allergic reaction. Inject very slowly (30-60 seconds). It diminishes with continued use.',
    notable: 'GHK-Cu activates over 4,000 human genes — researchers call it a "master reset switch" for aging tissue. At age 60, your levels are ~100x lower than at age 20. Published dermatology studies show topical GHK-Cu reduced fine wrinkles by 35% and increased skin thickness by 27%.',
    faq: [
      { q: 'Why does GHK-Cu burn on injection?', a: 'The copper-peptide complex causes burning when it contacts tissue — completely expected and NOT an allergic reaction. Inject very slowly over 30–60 seconds at room temperature. The sensation diminishes significantly after the first few uses.' },
      { q: 'Why is my solution blue/green?', a: 'Normal — that is the copper complex. A colourless GHK-Cu solution may indicate improper formulation. Blue/green is correct.' },
      { q: 'Can GHK-Cu help with hair loss?', a: 'Yes — GHK-Cu activates genes governing hair follicle cycling and collagen synthesis. It stimulates both hair growth and structural improvement of the follicle environment. Often stacked with TB-500 for enhanced hair restoration.' },
      { q: 'Can I apply GHK-Cu topically?', a: 'Yes — topical GHK-Cu has an extensive research base for skin tightening and collagen synthesis. SubQ injection provides systemic benefits; topical targets specific skin areas. Many use both simultaneously.' }
    ],
    research: [
      { title: 'GHK-Cu activates 4,000+ human genes — implications for skin aging', journal: 'Biochemistry Research International, 2012', url: 'https://pubmed.ncbi.nlm.nih.gov/22550605/' },
      { title: 'Copper peptide GHK-Cu and wound healing acceleration', journal: 'Journal of Wound Care, 2015', url: 'https://pubmed.ncbi.nlm.nih.gov/25629584/' }
    ]
  },

  {
    id: 'sermorelin',
    name: 'Sermorelin',
    fullName: 'Sermorelin (GHRH 1-29)',
    category: 'performance',
    emoji: '💪',
    tagline: 'The entry-level GH optimizer — FDA-approved GHRH analogue',
    notable: 'Sermorelin is the only GHRH analogue that was FDA-approved for clinical use in humans, giving it the strongest regulatory safety validation of any GH-stimulating peptide. Unlike synthetic HGH, it preserves the pituitary\'s natural self-limiting feedback mechanism — GH release is physiological, not supraphysiological.',
    confidence: 'HIGH',
    benefits: ['GH stimulation via pituitary','Improved body composition','Better sleep quality','Increased energy','Bone density support','Well-established safety profile'],
    description: 'Sermorelin is a synthetic analogue of the first 29 amino acids of endogenous growth hormone-releasing hormone (GHRH). It was FDA-approved and is the most clinically validated GHRH peptide. It works by stimulating the pituitary gland to produce and release its own GH — a gentler, more physiological approach than synthetic HGH.',
    mechanism: 'Binds GHRH receptors in the anterior pituitary, stimulating GH synthesis and pulsatile release. Unlike synthetic HGH, sermorelin preserves the pituitary\'s natural feedback mechanism — GH release is self-limiting and physiological.',
    dose: '0.2–0.5mg/day',
    frequency: 'Once daily, before bed',
    duration: '3–6 months (longer protocols common for anti-aging)',
    reconstitution: {
      bacWater: '2mL',
      vialSize: '3mg',
      concentration: '1,500mcg/mL',
      steps: [
        'Add 2mL BAC water to 3mg vial',
        '1,500mcg per mL',
        'Best injected 30–60 min before bed on an empty stomach'
      ],
      syringeTable: [
        { dose: '200mcg', units: 13, ml: '0.13mL' },
        { dose: '300mcg', units: 20, ml: '0.20mL' },
        { dose: '500mcg', units: 33, ml: '0.33mL' }
      ]
    },
    storage: 'Refrigerate after reconstitution. Use within 28 days. Keep from light.',
    sideEffects: ['Mild flushing at injection site (common, transient)','Headache (usually resolves after first week)','Water retention (mild, dose-dependent)','Drowsiness within 30–60 min (expected — time your injection before bed)'],
    burnWarning: false,
    flushWarning: false,
    faq: [
      { q: 'Sermorelin vs CJC-1295?', a: 'Sermorelin has the longer clinical history and gentler profile — ideal for first-time GH optimization. CJC-1295 DAC is more potent with an 8-day half-life (once weekly dosing). Many protocols start with sermorelin and transition to CJC-1295 for deeper optimization.' },
      { q: 'Does sermorelin work for older adults?', a: 'Yes — and this is where it shines. As the pituitary ages, GH output declines. Sermorelin restores that signaling without suppressing the pituitary\'s own function. Multiple clinical studies show benefits in adults 50+.' },
      { q: 'Can I stack sermorelin with Ipamorelin?', a: 'Yes — this is a classic pairing. Sermorelin provides the GHRH signal; Ipamorelin amplifies the GH pulse via a complementary ghrelin-mimetic pathway. Together they produce larger, more sustained GH release than either alone.' }
    ],
    research: [
      { title: 'Sermorelin acetate for adult growth hormone deficiency — clinical review', journal: 'Journal of Clinical Endocrinology & Metabolism, 1995', url: 'https://pubmed.ncbi.nlm.nih.gov/7714065/' },
      { title: 'Growth hormone-releasing hormone effects on sleep and GH secretion in older adults', journal: 'Journal of Clinical Endocrinology & Metabolism, 1997', url: 'https://pubmed.ncbi.nlm.nih.gov/9093712/' },
      { title: 'Sermorelin: a better approach to management of adult-onset GH insufficiency?', journal: 'Clinical Interventions in Aging, 2006', url: 'https://pubmed.ncbi.nlm.nih.gov/18046879/' }
    ]
  },

  {
    id: 'aod9604',
    name: 'AOD-9604',
    fullName: 'AOD-9604 (Anti-Obesity Drug Fragment hGH 176-191)',
    category: 'weight',
    emoji: '🔥',
    tagline: 'Fat loss without the GH side effects — targets adipose tissue directly',
    notable: "AOD-9604 is the C-terminal fragment of HGH (amino acids 176–191) — the specific sequence responsible for fat metabolism, isolated from all of HGH's other effects. Direct lipolysis signal with zero blood sugar impact, zero IGF-1 change. Developed at Monash University specifically to separate HGH's fat-burning action from its other effects.",
    confidence: 'MEDIUM',
    benefits: ['Targeted fat oxidation','No effect on blood sugar or IGF-1','Stimulates lipolysis','Inhibits lipogenesis (new fat formation)','Safe for diabetics','Preserves lean mass'],
    description: 'AOD-9604 is a modified fragment of human growth hormone (amino acids 176–191) that retains the fat-metabolizing properties of HGH without its anabolic effects or impact on blood sugar and IGF-1. It was developed specifically for fat loss without the risks associated with full HGH administration. Particularly useful for clients who cannot use full GH peptides due to blood sugar concerns.',
    mechanism: 'Mimics the way natural GH regulates fat metabolism. Stimulates lipolysis (fat breakdown) and inhibits lipogenesis (fat synthesis) via beta-3 adrenergic receptor activation. Does NOT bind IGF-1 receptors, meaning no anabolic effect, no blood sugar disruption.',
    dose: '0.3–0.6mg/day',
    frequency: 'Once daily, ideally fasted (morning)',
    duration: '8–12 weeks',
    reconstitution: {
      bacWater: '2mL',
      vialSize: '5mg',
      concentration: '2,500mcg/mL',
      steps: [
        'Add 2mL BAC water to 5mg vial',
        '2,500mcg per mL',
        'Best injected fasted — morning or 2+ hours after last meal'
      ],
      syringeTable: [
        { dose: '300mcg', units: 12, ml: '0.12mL' },
        { dose: '500mcg', units: 20, ml: '0.20mL' },
        { dose: '600mcg', units: 24, ml: '0.24mL' }
      ]
    },
    storage: 'Refrigerate after reconstitution. Use within 28 days.',
    sideEffects: ['Generally very well tolerated','Mild injection site redness (occasional)','No significant systemic side effects reported in clinical studies'],
    burnWarning: false,
    flushWarning: false,
    faq: [
      { q: 'Why choose AOD-9604 over Retatrutide or Semaglutide?', a: 'AOD-9604 is a targeted fat metabolism tool — it does not suppress appetite or alter gut motility like GLP-1 agonists. Ideal for clients who want to target stubborn fat without appetite changes, or those with blood sugar sensitivities that preclude GLP-1 use.' },
      { q: 'Can I stack AOD-9604 with GLP-1 peptides?', a: 'Yes — this is a popular combination. The GLP-1 handles appetite and systemic metabolic signaling; AOD-9604 accelerates fat oxidation directly. Stack with Semaglutide (not Retatrutide — reserve that as a standalone).' },
      { q: 'Does AOD-9604 affect blood sugar?', a: 'No — this is a key differentiator. Unlike full HGH, AOD-9604 does not affect blood glucose, insulin sensitivity, or IGF-1. It is considered safe for diabetic and pre-diabetic clients, though consultation with a physician is always recommended.' }
    ],
    research: [
      { title: 'A lipolytic fragment of human growth hormone-releasing factor — AOD9604', journal: 'Molecular and Cellular Endocrinology, 2001', url: 'https://pubmed.ncbi.nlm.nih.gov/11165029/' },
      { title: 'AOD9604: An Anti-Obesity Drug — clinical study overview', journal: 'Obesity Research & Clinical Practice, 2014', url: 'https://pubmed.ncbi.nlm.nih.gov/11700925/' }
    ]
  },

  {
    id: 'ta1',
    name: 'Thymosin Alpha-1',
    fullName: 'Thymosin Alpha-1 (Tα1)',
    category: 'immune',
    emoji: '🛡️',
    tagline: 'Immune intelligence — not stimulation. Restores what time and illness take away.',
    notable: "Thymosin Alpha-1 (sold as Zadaxin) is approved as a prescription pharmaceutical in 35+ countries for hepatitis B, hepatitis C, and as a cancer immunotherapy adjuvant — giving it more published human clinical trial data than almost any research peptide available today.",
    confidence: 'HIGH',
    benefits: [
      'T-cell activation (CD4+ / CD8+)',
      'NK cell surveillance enhancement',
      'Viral defense (EBV, HBV, HCV, HPV, HIV)',
      'Autoimmune regulation (Hashimoto\'s, RA, Lupus, MS)',
      'Post-viral immune restoration (COVID, Lyme, mold)',
      'Post-vaccine immune dysfunction support',
      'Chronic infection recovery',
      'Anti-inflammatory (hs-CRP↓, IL-8↓, TNF-α↓)',
      'Thymic decline reversal'
    ],
    description: 'Thymosin Alpha-1 is a 28-amino acid peptide naturally produced by the thymus gland. The thymus begins to shrink after age 25, progressively reducing T-cell output and immune surveillance. Tα1 restores the signaling intelligence the immune system loses over time — activating T-cells, enhancing NK cell activity, and recalibrating both innate and adaptive immunity. It does not simply "boost" the immune system — it restores regulation.',
    mechanism: 'Activates CD4+ helper T-cells and CD8+ cytotoxic T-cells. Enhances antigen presentation and immune memory formation. Stimulates NK cell surveillance. Modulates Th1/Th2 balance. Downregulates hs-CRP, IL-8, TNF-α. Acts via dendritic cell maturation and toll-like receptor modulation (TLR3, TLR7/8).',
    dose: '1.6mg SubQ, 2x/week',
    frequency: '2–3x weekly (loading), then 1–2x weekly (maintenance)',
    duration: '8–16 weeks',
    reconstitution: {
      bacWater: '1mL',
      vialSize: '1.5mg',
      concentration: '1.5mg/mL (1,500mcg/mL)',
      steps: [
        'Add 1mL BAC water to 1.5mg vial',
        'Swirl gently — do not shake',
        '1.5mg per mL — draw full 1mL for standard dose'
      ],
      syringeTable: [
        { dose: '1mg', units: 67, ml: '0.67mL' },
        { dose: '1.5mg', units: 100, ml: '1.00mL' }
      ]
    },
    storage: 'Refrigerate after reconstitution. Use within 28 days. Keep from light.',
    sideEffects: [
      'Mild injection site redness (uncommon)',
      'Temporary fatigue (first 1–2 weeks — immune activation response)',
      'Extremely well tolerated — no significant adverse effects in clinical trials'
    ],
    burnWarning: false,
    flushWarning: false,
    clinicalUseCases: [
      'Chronic viral reactivation (EBV, CMV, HBV, HCV)',
      'Post-COVID / Long COVID immune dysfunction',
      'Autoimmune: Hashimoto\'s, Rheumatoid Arthritis, Lupus, Multiple Sclerosis',
      'Mold / Lyme recovery',
      'Low lymphocytes or suppressed IgG',
      'Post-chemotherapy or post-antibiotic immune rebuild',
      'Post-vaccine immune dysfunction or adjuvant support',
      'Age-related immune decline (thymic involution after 25)'
    ],
    faq: [
      { q: 'How is Thymosin Alpha-1 different from TB-500 (Thymosin Beta-4)?', a: 'Completely different peptides. TB-500 is a tissue repair and healing peptide. Thymosin Alpha-1 is an immune modulator targeting T-cells, NK cells, and viral defense. The "thymosin" name is shared but function, mechanism, and use cases are entirely distinct.' },
      { q: 'Can Thymosin Alpha-1 help with post-vaccine immune issues?', a: 'Research shows Tα1 modulates dendritic cells and the T-cell/DC axis — central to vaccine-induced immunity. It has been studied as an immune adjuvant. For individuals experiencing post-vaccine immune dysfunction, Tα1 works to restore regulation rather than simply stimulate.' },
      { q: 'Is this a stimulant or a suppressant?', a: 'Neither — it is a regulator. It does not blindly stimulate (which could worsen autoimmune conditions) nor suppress (which would increase infection risk). It restores balance.' },
      { q: 'How quickly does Tα1 produce results?', a: 'Lab markers often shift within 2–4 weeks. Subjective improvements typically emerge at 4–8 weeks. Chronic conditions may require a full 12–16 week protocol.' }
    ],
    research: [
      { title: 'Thymosin alpha-1: pharmacology, clinical efficacy, and immunomodulatory properties', journal: 'Am J Health Syst Pharm, 2001 — Ancell CD et al.', url: 'https://pubmed.ncbi.nlm.nih.gov/11381492/' },
      { title: 'Thymosin α1 modulated the immune landscape of COVID-19 patients — single-cell RNA and TCR sequencing', journal: 'Int Immunopharmacol, 2023 — Bai H et al.', url: 'https://pubmed.ncbi.nlm.nih.gov/37769533/' },
      { title: 'Dual effect of Thymosin α1 on dendritic cells — vaccine adjuvant potential', journal: 'Expert Opin Biol Ther, 2015 — Giacomini E et al.', url: 'https://pubmed.ncbi.nlm.nih.gov/26096650/' },
      { title: 'Aging and Thymosin Alpha-1 — immunomodulatory, anti-inflammatory, antioxidant properties', journal: 'Int J Mol Sci, 2025 — Simonova MA et al.', url: 'https://pubmed.ncbi.nlm.nih.gov/41373628/' }
    ]
  },

  {
    id: 'kpv',
    name: 'KPV',
    fullName: 'Lys-Pro-Val (α-MSH Fragment)',
    category: 'healing',
    emoji: '🌿',
    tagline: 'The gut healer — resolves histamine reactions to other peptides',
    notable: "KPV is just 3 amino acids — the smallest peptide in the catalogue — yet studies show it can penetrate the gut epithelium intact and directly suppress NF-kB inflammation signalling inside intestinal cells. Oral delivery works for gut-specific effects, making it one of the only peptides with a valid oral route for its primary target organ.",
    confidence: 'HIGH',
    benefits: ['Gut lining repair','Mast cell stabilization','Resolves histamine reactions','IBD/Crohn\'s support','Systemic anti-inflammatory','Oral or injectable'],
    description: 'KPV is a tripeptide fragment of alpha-MSH with powerful anti-inflammatory and gut-healing properties. It is the primary intervention when histamine reactions occur with other peptides.',
    mechanism: 'Inhibits NF-κB pathway. Reduces IL-1β and TNF-α. Stabilizes mast cells. Restores tight junction proteins (ZO-1, occludin) to heal leaky gut.',
    dose: '0.1–0.5mg/day',
    frequency: 'Once or twice daily',
    duration: '4–12 weeks',
    reconstitution: {
      bacWater: '2mL',
      vialSize: '5mg',
      concentration: '2,500mcg/mL',
      steps: ['Add 2mL BAC water to 5mg vial','2,500mcg per mL'],
      syringeTable: [{ dose: '100mcg', units: 4, ml: '0.04mL' },{ dose: '250mcg', units: 10, ml: '0.10mL' }]
    },
    storage: 'Refrigerate. Use within 28 days. Excellent stability.',
    sideEffects: ['Minimal — extremely well tolerated','Mild injection site redness (uncommon)'],
    burnWarning: false,
    flushWarning: false,
    faq: [
      { q: 'When should I use KPV?', a: 'When experiencing histamine reactions from other peptides, or as a foundational gut healing compound. Also works orally for gut-specific inflammation.' },
      { q: 'How quickly does KPV resolve reactions?', a: '3-7 days for acute histamine reactions. 2-6 weeks for chronic gut inflammation.' }
    ],
    research: [
      { title: 'The tripeptide KPV attenuates inflammation in a murine model of colitis', journal: 'Gut, 2009', url: 'https://pubmed.ncbi.nlm.nih.gov/19091823/' },
      { title: 'Anti-inflammatory effects of alpha-MSH-derived peptides in intestinal epithelial cells', journal: 'Journal of Pharmacology and Experimental Therapeutics, 2007', url: 'https://pubmed.ncbi.nlm.nih.gov/17609423/' }
    ]
  },

  {
    id: 'semax',
    name: 'Semax',
    fullName: 'Semax (ACTH 4-10 Analogue)',
    category: 'cognitive',
    emoji: '🧠',
    tagline: 'BDNF elevation — sharper focus and memory formation',
    notable: "Semax has been used as a registered prescription drug in Russia and Ukraine for 30+ years for stroke rehabilitation — one of the most clinically tested nootropic peptides in existence. It elevates BDNF within hours of a single dose — the same protein antidepressants take 2–4 weeks to affect.",
    confidence: 'MEDIUM',
    benefits: ['Enhanced focus & clarity','Memory improvement','BDNF elevation','Anxiety reduction','Neuroprotection','Stroke recovery support'],
    description: 'Semax is a synthetic peptide based on ACTH, developed in Russia as a prescription nootropic. It elevates BDNF and NGF — the proteins responsible for neuroplasticity and brain health.',
    mechanism: 'Stimulates BDNF and NGF production. Modulates dopamine and serotonin. Enhances hippocampal neuroplasticity.',
    dose: '0.3–0.6mg per dose (intranasal)',
    frequency: '1-2x daily',
    duration: '2-4 week cycles with breaks',
    reconstitution: {
      bacWater: '2mL',
      vialSize: '5mg',
      concentration: '2,500mcg/mL',
      steps: ['Add 2mL BAC water to 5mg vial','Can also be used intranasally (2 drops per nostril)','Use within 21 days (degrades faster than most peptides)'],
      syringeTable: [{ dose: '300mcg', units: 12, ml: '0.12mL' },{ dose: '600mcg', units: 24, ml: '0.24mL' }]
    },
    storage: 'Refrigerate. Use within 21 days — degrades faster than most peptides.',
    sideEffects: ['Irritability at high doses (start low)','Vivid dreams (shift to morning dosing)','Nasal irritation (intranasal use)'],
    burnWarning: false,
    flushWarning: false,
    faq: [
      { q: 'Injectable vs intranasal Semax?', a: 'Intranasal bypasses the blood-brain barrier via the olfactory pathway — highly effective for cognitive effects. Injectable provides more systemic bioavailability.' },
      { q: 'How fast does Semax work?', a: 'Most users report noticeable effects within 20–45 minutes of intranasal administration — improved clarity, sharper focus, reduced mental fatigue.' },
      { q: 'Is Semax safe for daily use?', a: 'Research protocols typically run 2–4 week cycles with breaks. Cycle 2 weeks on, 1 week off to maintain full effectiveness.' }
    ],
    research: [
      { title: 'Semax increases BDNF and NGF expression in rat hippocampus after ischemia', journal: 'Bulletin of Experimental Biology and Medicine, 2007', url: 'https://pubmed.ncbi.nlm.nih.gov/17568492/' },
      { title: 'Neuroprotective effects of Semax in acute ischemic stroke — clinical study', journal: 'Cerebrovascular Diseases, 2001', url: 'https://pubmed.ncbi.nlm.nih.gov/11641580/' }
    ]
  },

  {
    id: 'selank',
    name: 'Selank',
    fullName: 'Selank (Tuftsin Analogue)',
    category: 'cognitive',
    emoji: '🧠',
    tagline: 'Calm focus without sedation — anxiety relief without addiction',
    notable: "A Russian double-blind clinical trial directly compared Selank to benzodiazepines for generalized anxiety disorder. Selank matched their effectiveness — with zero dependency, zero tolerance, and zero withdrawal on discontinuation. No tapering required. Registered as a prescription drug in Russia and Ukraine.",
    confidence: 'MEDIUM',
    benefits: ['Anxiety reduction (no sedation)','Stress resilience','Sleep improvement','Memory enhancement','No addiction risk','Immune modulation'],
    description: 'Selank is an anxiolytic peptide developed alongside Semax. Where Semax stimulates and sharpens, Selank calms and stabilizes. Together they produce calm, focused productivity.',
    mechanism: 'Stabilizes enkephalins. Modulates GABA-A receptors without addiction risk. Regulates immune cytokines.',
    dose: '0.25–0.5mg per dose (intranasal)',
    frequency: '1-2x daily',
    duration: '2-4 week cycles',
    reconstitution: {
      bacWater: '2mL',
      vialSize: '5mg',
      concentration: '2,500mcg/mL',
      steps: ['Add 2mL BAC water to 5mg vial','2,500mcg per mL'],
      syringeTable: [{ dose: '250mcg', units: 10, ml: '0.10mL' },{ dose: '500mcg', units: 20, ml: '0.20mL' }]
    },
    storage: 'Refrigerate. Use within 21 days.',
    sideEffects: ['Mild drowsiness (first few days)','Slight nasal irritation (intranasal)'],
    burnWarning: false,
    flushWarning: false,
    faq: [
      { q: 'Can Semax and Selank be combined?', a: 'Yes — classic stack. Semax provides stimulating focus while Selank removes anxiety. Result: calm, productive, no jitters.' },
      { q: 'Does Selank cause sedation or impair performance?', a: 'No — Selank is anxiolytic without sedation. Unlike benzodiazepines, it does not impair reaction time, coordination, or cognitive performance.' },
      { q: 'How long do Selank effects last?', a: 'Intranasal: effects lasting 4–8 hours. Twice-daily dosing maintains consistent coverage during high-stress periods.' }
    ],
    research: [
      { title: 'Anxiolytic effects of Selank peptide without sedation in animal models', journal: 'Bulletin of Experimental Biology and Medicine, 2008', url: 'https://pubmed.ncbi.nlm.nih.gov/19240826/' },
      { title: 'Selank modulates expression of genes encoding GABA-A receptor subunits', journal: 'Molecular Biology, 2012', url: 'https://pubmed.ncbi.nlm.nih.gov/23113381/' }
    ]
  },

  {
    id: 'tesamorelin',
    name: 'Tesamorelin',
    fullName: 'Tesamorelin (TH9507 — GHRH Analogue)',
    category: 'weight',
    emoji: '🔥',
    tagline: 'FDA-approved GHRH — the only peptide proven to specifically eliminate visceral belly fat',
    notable: "Tesamorelin is FDA-approved (as Egrifta) for visceral fat reduction in HIV-associated lipodystrophy — one of the few peptides with an actual approved clinical indication. Studies show it specifically reduces visceral adipose tissue surrounding organs with minimal effect on subcutaneous fat elsewhere.",
    confidence: 'HIGH',
    benefits: [
      'Visceral adipose tissue (VAT) reduction — proven in RCTs',
      'Abdominal fat elimination (stubborn deep fat)',
      'GH and IGF-1 elevation',
      'Improved insulin sensitivity',
      'Cardiovascular risk marker improvement',
      'Lean mass preservation during fat loss',
      'Liver fat reduction (NAFLD support)'
    ],
    description: 'Tesamorelin is a stabilized analogue of endogenous GHRH (growth hormone releasing hormone) — the only FDA-approved peptide specifically for visceral fat reduction. Unlike Retatrutide (appetite/metabolic) or AOD-9604 (general lipolysis), Tesamorelin works by stimulating GH release which then targets visceral adipose tissue — the deep, dangerous belly fat surrounding organs. Multiple randomized controlled trials show 15–20% visceral fat reduction over 26 weeks. Originally approved for HIV-associated lipodystrophy, it is now widely used in metabolic optimization for stubborn abdominal fat that does not respond to diet and exercise.',
    mechanism: 'Synthetic GHRH analogue with conjugated trans-3-hexenoic acid for stability. Binds pituitary GHRH receptors → stimulates GH pulse → elevates IGF-1 → activates hormone-sensitive lipase in visceral adipose tissue → selective visceral fat oxidation. Preserves lean mass. Unlike exogenous GH, preserves natural pulsatile GH rhythm and feedback mechanisms.',
    dose: '2mg/day SubQ',
    frequency: 'Once daily, before bed on empty stomach',
    duration: '26–52 weeks (clinical trial duration); 12-week minimum to assess response',
    reconstitution: {
      bacWater: '2mL',
      vialSize: '2mg',
      concentration: '1mg/mL (1,000mcg/mL)',
      steps: [
        'Add 2mL BAC water to 2mg vial',
        '1mg per mL — draw full 2mL for 2mg dose',
        'Inject SubQ in abdomen — rotate sites',
        'Best timing: before bed, fasted state'
      ],
      syringeTable: [
        { dose: '1mg', units: 100, ml: '1.00mL' },
        { dose: '2mg', units: 200, ml: '2.00mL' }
      ]
    },
    storage: 'Refrigerate. Protect from light. Use within 28 days of reconstitution.',
    sideEffects: [
      'Injection site redness/swelling (common, resolves quickly)',
      'Water retention (mild, typically first 2–4 weeks)',
      'Joint pain or stiffness (dose-dependent, reduces with time)',
      'Blood glucose elevation at high doses — monitor if diabetic',
      'Peripheral edema (uncommon at standard 2mg dose)'
    ],
    burnWarning: false,
    flushWarning: false,
    faq: [
      {
        q: 'How is Tesamorelin different from CJC-1295 or Sermorelin?',
        a: 'All three are GHRH analogues, but Tesamorelin is uniquely optimized for visceral fat. CJC-1295 (8-day half-life) and Sermorelin are general GH optimizers for muscle, recovery, and anti-aging. Tesamorelin has specific FDA approval and RCT data for visceral adipose reduction — it\'s the specialist tool when stubborn belly fat is the primary goal.'
      },
      {
        q: 'Can Tesamorelin be stacked with Retatrutide?',
        a: 'These work through different pathways (GHRH → GH → visceral fat vs GLP-1/GIP/glucagon → appetite + metabolism) and can complement each other. Retatrutide handles appetite and systemic metabolism; Tesamorelin targets the visceral fat specifically. That said, both are aggressive interventions — consult Marc before combining.'
      },
      {
        q: 'How long until I see visible belly fat reduction?',
        a: 'Lab markers (IGF-1) shift within 2–4 weeks. Visible visceral fat reduction typically appears at 8–12 weeks. Full clinical benefit (15–20% VAT reduction) at 26 weeks per FDA trial data.'
      },
      {
        q: 'Does it work on subcutaneous fat or just visceral?',
        a: 'Primarily visceral adipose tissue (VAT) — the deep fat surrounding organs. Subcutaneous fat (under the skin) is less affected. This makes Tesamorelin uniquely valuable for metabolic health improvement and reducing cardiovascular risk from visceral adiposity, even when overall weight change is modest.'
      }
    ],
    research: [
      {
        title: 'Effects of tesamorelin, a growth hormone-releasing factor, in HIV-infected patients with abdominal fat accumulation — randomized placebo-controlled trial',
        journal: 'J Acquir Immune Defic Syndr, 2010 — Falutz J et al.',
        url: 'https://pubmed.ncbi.nlm.nih.gov/20101189/'
      },
      {
        title: 'Body composition, hepatic fat, and safety outcomes of Tesamorelin in HIV-associated lipodystrophy — meta-analysis of RCTs',
        journal: 'Obes Res Clin Pract, 2026 — Badran AS et al.',
        url: 'https://pubmed.ncbi.nlm.nih.gov/41545261/'
      },
      {
        title: 'Efficacy and safety of tesamorelin in people with HIV on integrase inhibitors',
        journal: 'AIDS, 2024 — Russo SC et al.',
        url: 'https://pubmed.ncbi.nlm.nih.gov/38905488/'
      }
    ]
  },

  {
    id: 'slupppp332',
    name: 'SLU-PP-332',
    fullName: 'SLU-PP-332 (ERRα/β/γ Pan-Agonist — Exercise Mimetic)',
    category: 'performance',
    emoji: '⚡',
    tagline: 'The exercise pill — activates the aerobic exercise gene program without moving a muscle',
    notable: "SLU-PP-332 activates ERR receptors — the exact molecular cascade triggered by sustained aerobic exercise — producing measurable improvements in endurance, mitochondrial density, and fat oxidation without physical exertion. Researchers describe it as making the body respond as if it just completed a marathon at the cellular level.",
    confidence: 'MEDIUM',
    benefits: [
      'Aerobic exercise gene program activation',
      'Enhanced oxidative muscle fiber conversion (Type I/IIa)',
      'Increased VO2 max and endurance capacity',
      'Mitochondrial biogenesis',
      'Metabolic syndrome reversal',
      'Fat oxidation (exercise-mimetic)',
      'Performance enhancement without exertion'
    ],
    description: 'SLU-PP-332 (pronounced "SLUP-332") is a synthetic pan-agonist for estrogen-related receptors (ERRα, ERRβ, ERRγ) — nuclear receptors that regulate the gene programs activated by aerobic exercise. When administered, it triggers the same molecular cascade as sustained aerobic exercise in skeletal muscle: oxidative fiber conversion, mitochondrial biogenesis, and fat oxidation. Animal studies show 50% increase in run time to exhaustion, reversal of metabolic syndrome markers, and significant fat reduction. This is early-stage research — no human clinical trials yet — but the mechanism is well-characterized and the science is sound.',
    mechanism: 'Activates ERRα (highest potency), ERRβ, and ERRγ nuclear receptors simultaneously. ERRs govern the transcriptional program of aerobic exercise — PGC-1α co-activation, mitochondrial biogenesis, fatty acid oxidation gene upregulation, and oxidative (Type I/IIa) muscle fiber expression. Results: exercise-like metabolic adaptation, improved endurance, enhanced fat burning, and insulin sensitivity — without the mechanical stress of exercise.',
    dose: '10–20mg/day (oral, research use)',
    frequency: 'Once daily',
    duration: '4–12 week cycles — long-term human data not yet established',
    reconstitution: {
      bacWater: 'N/A — oral compound',
      vialSize: 'Capsule form typical (10–20mg)',
      concentration: 'Pre-measured capsules',
      steps: [
        'Oral administration — no reconstitution required',
        'Take with or without food',
        'Best taken in the morning given exercise-mimetic activation'
      ],
      syringeTable: [
        { dose: '10mg', units: 0, ml: '1 capsule' },
        { dose: '20mg', units: 0, ml: '2 capsules' }
      ]
    },
    storage: 'Store in cool, dry place away from light. No refrigeration required for capsule form.',
    sideEffects: [
      'Human safety data limited — animal studies show good tolerability',
      'Potential cardiovascular effects at high doses (monitor heart rate)',
      'Not recommended for individuals with cardiac conditions without physician oversight',
      'Long-term human safety unknown — cycle cautiously'
    ],
    burnWarning: false,
    flushWarning: false,
    faq: [
      {
        q: 'Is this really an "exercise pill"?',
        a: 'In animal models, yes — it activates the same gene programs as aerobic exercise in skeletal muscle. Mice given SLU-PP-332 showed 50% greater run-to-exhaustion capacity and reversal of diet-induced metabolic syndrome without changing their activity levels. Human data is not yet available, but the mechanism is solid and the research is progressing rapidly (5 PubMed papers, 2023–2026).'
      },
      {
        q: 'How does SLU-PP-332 differ from MOTS-c?',
        a: 'Both are exercise mimetics via different pathways. MOTS-c works through the AMPK pathway (mitochondrial peptide hormone). SLU-PP-332 works through ERR nuclear receptors (transcription factor activation). They act on complementary aspects of exercise adaptation and may stack well together for comprehensive metabolic and performance optimization.'
      },
      {
        q: 'Who should use this compound?',
        a: 'Athletes seeking aerobic performance gains alongside training. Individuals with metabolic syndrome where exercise capacity is limited. Those wanting to compound the benefits of existing training. NOT a replacement for exercise — best used alongside physical training to amplify adaptation. Given early evidence stage, best for research-minded clients who understand the risk profile.'
      }
    ],
    research: [
      {
        title: 'Synthetic ERRα/β/γ Agonist Induces an ERRα-Dependent Acute Aerobic Exercise Response and Enhances Exercise Capacity',
        journal: 'ACS Chemical Biology, 2023 — Billon C et al.',
        url: 'https://pubmed.ncbi.nlm.nih.gov/36988910/'
      },
      {
        title: 'A Synthetic ERR Agonist (SLU-PP-332) Alleviates Metabolic Syndrome',
        journal: 'Journal of Pharmacology and Experimental Therapeutics, 2024 — Billon C et al.',
        url: 'https://pubmed.ncbi.nlm.nih.gov/37739806/'
      }
    ]
  },

  {
    id: 'amino1mq',
    name: '5-Amino-1MQ',
    fullName: '5-Amino-1-Methylquinolinium (NNMT Inhibitor)',
    category: 'weight',
    emoji: '🔥',
    tagline: 'NNMT inhibitor — unlocks dormant fat cells and reverses metabolic dysfunction at the epigenetic level',
    notable: "5-Amino-1MQ inhibits NNMT — an enzyme that becomes overactive in aging fat cells, locking them in a storage-only mode that resists weight loss. Research shows NNMT inhibition reverses fat cell resistance and prevents new fat cell formation — addressing WHY fat becomes harder to lose with age at the cellular level.",
    confidence: 'MEDIUM',
    benefits: [
      'Inhibits NNMT enzyme — reverses metabolic dormancy in fat cells',
      'Activates NAD+ and SAM methylation pathways in adipose tissue',
      'Reduces fat cell size (adipocyte shrinkage)',
      'Improves metabolic rate in adipose tissue',
      'Synergistic with NAD+ supplementation',
      'Anti-obesity without appetite suppression',
      'May reverse diet-induced obesity without caloric restriction (animal models)'
    ],
    description: 'Nicotinamide N-methyltransferase (NNMT) is an enzyme that is overexpressed in obese fat tissue — it consumes SAM (the body\'s methyl donor) and reduces NAD+ availability in adipocytes, essentially putting fat cells into a dormant metabolic state that resists mobilization. 5-Amino-1MQ is a cell-permeable small molecule that inhibits NNMT — reactivating NAD+ and SAM pathways in fat cells, shrinking adipocyte size, and restoring normal metabolic function in adipose tissue. Unlike GLP-1 agonists (which suppress appetite) or AOD-9604 (which promotes lipolysis), 5-Amino-1MQ works upstream at the epigenetic metabolic programming level.',
    mechanism: 'Selective NNMT inhibitor. NNMT methylates nicotinamide → consumes SAM → depletes methyl donors + reduces NAD+ in adipocytes → metabolic dormancy. 5-Amino-1MQ blocks this: preserves SAM and NAD+ in fat cells → activates polyamine flux → increases fat cell metabolic activity → adipocyte shrinkage and reduced fat mass. Works independently of appetite or exercise pathways.',
    dose: '50–100mg/day (oral)',
    frequency: 'Once or twice daily',
    duration: '8–16 weeks',
    reconstitution: {
      bacWater: 'N/A — oral compound',
      vialSize: 'Capsule form (50mg typical)',
      concentration: 'Pre-measured capsules',
      steps: [
        'Oral — no reconstitution required',
        'Take with food to reduce GI discomfort',
        'Stack with NAD+ for synergistic NAD+ pathway effects'
      ],
      syringeTable: [
        { dose: '50mg', units: 0, ml: '1 capsule' },
        { dose: '100mg', units: 0, ml: '2 capsules' }
      ]
    },
    storage: 'Store in cool, dry place. No refrigeration required.',
    sideEffects: [
      'GI discomfort (nausea/bloating) if taken fasted — take with food',
      'Human safety data limited — animal studies show good tolerability at therapeutic doses',
      'Theoretical concern: NNMT has cancer-associated roles — avoid if active malignancy',
      'Long-term human data not established — cycle with breaks'
    ],
    burnWarning: false,
    flushWarning: false,
    faq: [
      {
        q: 'Why stack 5-Amino-1MQ with NAD+?',
        a: 'They work synergistically. NNMT depletes NAD+ in fat cells — 5-Amino-1MQ stops that depletion. Supplementing NAD+ simultaneously floods the now-unblocked pathway with substrate. The combination restores full NAD+ metabolic function in adipose tissue — greater than either compound alone.'
      },
      {
        q: 'How is this different from other fat loss compounds?',
        a: 'Every other compound in this library targets fat loss from the outside — appetite suppression (Retatrutide), lipolysis (AOD-9604), metabolic rate (SLU-PP-332). 5-Amino-1MQ works from the inside of the fat cell itself, at the epigenetic metabolic level. It reactivates dormant, diet-resistant fat cells that no longer respond to conventional interventions.'
      },
      {
        q: 'Is this useful for people who have plateaued on GLP-1 protocols?',
        a: 'Potentially yes — this is one of the most compelling use cases. When GLP-1 weight loss plateaus (which is common), it\'s often because adipocyte metabolic dormancy has set in. 5-Amino-1MQ addresses exactly that mechanism. It works through a completely orthogonal pathway, making it a strong complement to existing protocols.'
      }
    ],
    research: [
      {
        title: 'Nicotinamide N-methyltransferase knockdown protects against diet-induced obesity — Nature 2014 (foundational NNMT mechanism study)',
        journal: 'Nature, 2014 — Kraus D, Yang Q et al.',
        url: 'https://pubmed.ncbi.nlm.nih.gov/24717514/'
      },
      {
        title: 'Exploring NNMT: from metabolic pathways to therapeutic targets — comprehensive 2024 review',
        journal: 'Archives of Pharmaceutical Research, 2024 — Park J et al.',
        url: 'https://pubmed.ncbi.nlm.nih.gov/39604638/'
      }
    ]
  },

  {
    id: 'epithalon',
    name: 'Epithalon',
    fullName: 'Epithalon (Epitalon / Epithalamin)',
    category: 'antiaging',
    emoji: '✨',
    tagline: 'Telomere extension — addressing aging at the chromosomal level',
    notable: "Epithalon is the only peptide shown to directly activate telomerase in human somatic cells — published by Vladimir Khavinson after 35+ years of research. A single 10-day cycle triggers telomerase activation that outlasts the dosing period by months. Telomere maintenance is the most consistent biomarker of biological aging.",
    confidence: 'MEDIUM',
    benefits: ['Telomere elongation','Telomerase activation','Pineal gland restoration','Melatonin regulation','Anti-cancer properties (research)','Circadian rhythm normalization','Lifespan extension (animal models)'],
    description: 'Epithalon is a synthetic tetrapeptide (Ala-Glu-Asp-Gly) derived from the epithalamin naturally produced by the pineal gland. It is one of the most studied longevity peptides, with research spanning 30+ years at the St. Petersburg Institute of Bioregulation and Gerontology. Its primary mechanism — telomerase activation and telomere elongation — positions it at the frontier of anti-aging science.',
    mechanism: 'Activates telomerase enzyme, enabling elongation of telomeres (protective caps on chromosomes that shorten with age and cell division). Restores pineal gland function and melatonin production. Regulates circadian gene expression. Shows antioxidant and anti-tumor effects in animal studies.',
    dose: '5–10mg/day for 10–20 day cycles',
    frequency: 'Daily during cycle, 1–2 cycles per year',
    duration: '10–20 day cycle, then off. Repeat 1–2x/year.',
    reconstitution: {
      bacWater: '2mL',
      vialSize: '10mg',
      concentration: '5mg/mL (5,000mcg/mL)',
      steps: [
        'Add 2mL BAC water to 10mg vial',
        '5mg per mL',
        'Draw 1mL for 5mg dose, 2mL for 10mg dose'
      ],
      syringeTable: [
        { dose: '5mg', units: 100, ml: '1.00mL' },
        { dose: '10mg', units: 200, ml: '2.00mL' }
      ]
    },
    storage: 'Refrigerate after reconstitution. Use within 28 days. Particularly light-sensitive — store in dark.',
    sideEffects: ['Generally very well tolerated in human studies','Mild injection site redness (uncommon)','Transient fatigue (first few days — normal)'],
    burnWarning: false,
    flushWarning: false,
    faq: [
      { q: 'Does Epithalon actually extend lifespan?', a: 'Animal studies show lifespan extension of 25–35% in mice and rats. Human studies show telomere elongation and improved biomarkers of aging. Long-term controlled human lifespan data does not exist — this is an emerging research area, not a proven treatment.' },
      { q: 'Why cycle Epithalon instead of using it continuously?', a: 'Cyclical use mirrors how peptide hormones naturally function — pulsatile, not constant. Most protocols use 10–20 day courses 1–2x per year. Continuous use has not been studied extensively and may not be more effective.' },
      { q: 'Can Epithalon be stacked?', a: 'Yes — it pairs well with NAD+ (complementary longevity pathways), MOTS-c (mitochondrial), and GHK-Cu. This forms the basis of the Longevity Stack.' }
    ],
    research: [
      { title: 'Epithalamin and epitalon — effects on telomere length and telomerase activity in human cells', journal: 'Bulletin of Experimental Biology and Medicine, 2003', url: 'https://pubmed.ncbi.nlm.nih.gov/12806453/' },
      { title: 'Geroprotective effects of epithalamine and epitalon in aging rats', journal: 'Biogerontology, 2002', url: 'https://pubmed.ncbi.nlm.nih.gov/12006183/' },
      { title: 'Epithalon stimulates elongation of telomeres in human somatic cells', journal: 'Neuroendocrinology Letters, 2003', url: 'https://pubmed.ncbi.nlm.nih.gov/14523363/' }
    ]
  },

  {
    id: 'motsc',
    name: 'MOTS-c',
    fullName: 'MOTS-c (Mitochondrial Open Reading Frame of 12S rRNA-c)',
    category: 'antiaging',
    emoji: '✨',
    tagline: 'Mitochondrial peptide — metabolic resilience and cellular longevity from within',
    notable: "MOTS-c is encoded in mitochondrial DNA — not nuclear DNA like virtually every other peptide — making it a mitochondria-derived peptide (MDP), one of the first ever discovered. A landmark Cell Metabolism study (Lee et al., 2015) showed MOTS-c reversed obesity-related insulin resistance in animal models without any dietary changes.",
    confidence: 'MEDIUM',
    benefits: ['Mitochondrial biogenesis','Metabolic flexibility (fat + glucose)','Insulin sensitivity','Exercise performance mimicry','Anti-obesity effects','Longevity signaling (AMPK pathway)','Age-related decline prevention'],
    description: 'MOTS-c is a peptide encoded in mitochondrial DNA — discovered in 2015, making it one of the newest longevity peptides. It acts as a mitochondrial hormone that communicates with the nucleus to regulate metabolism, improve insulin sensitivity, and activate cellular stress responses. Exercise increases circulating MOTS-c; supplemental MOTS-c mimics some benefits of physical activity at the cellular level.',
    mechanism: 'Activates AMPK pathway (the metabolic master switch). Promotes mitochondrial biogenesis. Improves fatty acid oxidation and glucose uptake. Reduces reactive oxygen species. Translocates to the nucleus under metabolic stress to regulate gene expression. Mimics aspects of exercise-induced metabolic adaptation.',
    dose: '5–10mg/week (subcutaneous)',
    frequency: '2–3x weekly',
    duration: '8–12 weeks',
    reconstitution: {
      bacWater: '1mL',
      vialSize: '5mg',
      concentration: '5mg/mL',
      steps: [
        'Add 1mL BAC water to 5mg vial',
        '5mg per mL',
        'Draw 0.5–1mL per injection'
      ],
      syringeTable: [
        { dose: '2.5mg', units: 50, ml: '0.50mL' },
        { dose: '5mg', units: 100, ml: '1.00mL' }
      ]
    },
    storage: 'Refrigerate after reconstitution. Use within 28 days. Handle gently — more fragile than most peptides.',
    sideEffects: ['Mild fatigue initially (mitochondrial adaptation)','Injection site redness (occasional)','Generally very well tolerated in early research'],
    burnWarning: false,
    flushWarning: false,
    faq: [
      { q: 'Is MOTS-c like taking an exercise pill?', a: 'Partially — MOTS-c activates some of the same pathways as aerobic exercise at the mitochondrial level. Studies in mice show improved metabolic health even without exercise. It is not a replacement for exercise, but a complementary tool for metabolic optimization.' },
      { q: 'Who benefits most from MOTS-c?', a: 'Adults with metabolic syndrome, insulin resistance, or age-related metabolic decline. Also used by athletes seeking enhanced mitochondrial efficiency and recovery. Research in older adults (50+) shows particularly strong benefit.' },
      { q: 'How does MOTS-c differ from NAD+?', a: 'NAD+ replenishes the fuel for mitochondrial enzymes. MOTS-c signals the mitochondria to become more efficient and biogenically active. They work on complementary aspects of mitochondrial health and stack well together.' }
    ],
    research: [
      { title: 'MOTS-c: a mitochondrial-derived peptide regulating skeletal muscle metabolic adaptations', journal: 'Cell Metabolism, 2015', url: 'https://pubmed.ncbi.nlm.nih.gov/25738459/' },
      { title: 'MOTS-c counters age-associated insulin resistance and metabolic decline', journal: 'Nature Communications, 2021', url: 'https://pubmed.ncbi.nlm.nih.gov/33531503/' },
      { title: 'Mitochondrial-derived peptide MOTS-c reduces obesity and insulin resistance', journal: 'Cell Reports, 2019', url: 'https://pubmed.ncbi.nlm.nih.gov/31747604/' }
    ]
  },

  {
    id: 'hexarelin',
    name: 'Hexarelin',
    fullName: 'Hexarelin (Examorelin)',
    category: 'performance',
    emoji: '💪',
    tagline: 'The most potent GHRP — maximum GH release with cardiac benefits',
    notable: "Hexarelin produces the most potent GH pulse of any synthetic GHRP tested — significantly higher than GHRP-2, GHRP-6, or Ipamorelin in head-to-head studies. It also has direct cardiac protective effects, showing recovery of cardiac function after ischemia in animal models via GHS receptors expressed in cardiac tissue.",
    confidence: 'MEDIUM',
    benefits: ['Strongest GH release of all GHRPs','Muscle growth','Fat loss','Cardiac protection and repair','Collagen synthesis','Anti-aging via GH elevation'],
    description: 'Hexarelin is the most potent growth hormone-releasing peptide (GHRP) available — producing the highest GH pulse of any peptide in this class. Unlike Ipamorelin (selective and mild) or GHRP-6 (causes hunger), Hexarelin is the heavy-hitter. It also has unique cardioprotective properties independent of GH — acting directly on cardiac tissue via CD36 receptors.',
    mechanism: 'Binds GHS-R1a receptors (ghrelin receptor) with highest affinity of any GHRP. Produces large, acute GH pulse. Also binds CD36 cardiac receptors independently — providing direct cardioprotective and cardiac repair effects not seen in other GHRPs. Elevates cortisol and prolactin more than Ipamorelin (use in shorter cycles).',
    dose: '0.1–0.2mg per dose',
    frequency: '1–2x daily',
    duration: '4–8 weeks on, then off (desensitizes faster than Ipamorelin)',
    reconstitution: {
      bacWater: '2mL',
      vialSize: '5mg',
      concentration: '2,500mcg/mL',
      steps: [
        'Add 2mL BAC water to 5mg vial',
        '2,500mcg per mL',
        'Use on empty stomach — food significantly blunts GH response'
      ],
      syringeTable: [
        { dose: '100mcg', units: 4, ml: '0.04mL' },
        { dose: '200mcg', units: 8, ml: '0.08mL' }
      ]
    },
    storage: 'Refrigerate after reconstitution. Use within 28 days.',
    sideEffects: ['Cortisol elevation (more than Ipamorelin — cycle shorter)','Prolactin elevation at higher doses','Water retention','Increased hunger (less than GHRP-6, more than Ipamorelin)','Fatigue after injection (GH dump effect)'],
    burnWarning: false,
    flushWarning: false,
    faq: [
      { q: 'Hexarelin vs Ipamorelin — which should I choose?', a: 'Ipamorelin is the clean, long-term choice — selective for GH only, minimal side effects. Hexarelin is the potent short-cycle option — maximum GH release, with cortisol and prolactin elevation that makes it better for 4–6 week bursts. Use Ipamorelin for ongoing protocols; Hexarelin for aggressive short cycles.' },
      { q: 'What are the cardiac benefits of Hexarelin?', a: 'Hexarelin binds CD36 receptors on cardiac tissue independently of GH — promoting cardiac cell survival, reducing fibrosis, and improving heart function after injury. Studies in animal models of heart failure show significant cardioprotection. This makes it uniquely interesting for clients with cardiovascular concerns.' },
      { q: 'Does Hexarelin cause desensitization?', a: 'Yes — faster than Ipamorelin. Most users experience reduced GH response after 8+ weeks of continuous use. This is why cycling (4–8 weeks on, equal time off) is standard protocol.' }
    ],
    research: [
      { title: 'Hexarelin, a growth hormone-releasing peptide, protects from cardiac ischemia', journal: 'European Journal of Pharmacology, 1997', url: 'https://pubmed.ncbi.nlm.nih.gov/9342171/' },
      { title: 'Cardiac effects of hexarelin independent of GH release — CD36 receptor pathway', journal: 'Endocrinology, 2004', url: 'https://pubmed.ncbi.nlm.nih.gov/14764636/' },
      { title: 'Hexarelin and GHS: comparative potency among GHRPs', journal: 'Journal of Clinical Endocrinology & Metabolism, 1997', url: 'https://pubmed.ncbi.nlm.nih.gov/9291724/' }
    ]
  },

  {
    id: 'dihexa',
    name: 'Dihexa',
    fullName: 'Dihexa (N-hexanoic-Tyr-Ile-(6) aminohexanoic amide)',
    category: 'cognitive',
    emoji: '🧠',
    tagline: 'The most potent cognitive enhancer ever synthesized — 10 million times stronger than BDNF',
    notable: "Dihexa is estimated to be 10 million times more potent than BDNF itself for promoting synaptogenesis — the formation of new synaptic connections in the brain. A Washington State University study showed a single dose restored learning and memory in aged animal models to levels comparable to young controls.",
    confidence: 'LOW',
    benefits: ['Synaptogenesis (new synapse formation)','Memory enhancement (animal models)','HGF/MET pathway activation','Neuroprotective potential','Learning and recall (preclinical data)'],
    description: 'Dihexa is a synthetic oligopeptide developed at Washington State University targeting the hepatocyte growth factor (HGF) / MET receptor pathway to promote synaptogenesis — the formation of new neural connections. Early animal research was compelling, but the primary human-focused study has since been retracted (2025). Dihexa remains one of the most discussed experimental nootropics, but the evidence base is limited and contested. Marc includes it here for research awareness, not as a front-line recommendation. Confidence is LOW — approach with caution.',
    mechanism: 'Activates HGF/MET pathway independently of HGF. Promotes synaptogenesis — the formation of new synaptic connections between neurons. Unlike BDNF which must cross the blood-brain barrier with difficulty, Dihexa is orally active and penetrates the BBB efficiently. Shown to reverse cognitive impairment in animal models of Alzheimer\'s and aging.',
    dose: '10–30mg (oral) or 1–3mg (subcutaneous)',
    frequency: '3–5x weekly',
    duration: '4–8 week cycles with breaks',
    reconstitution: {
      bacWater: '1mL',
      vialSize: '50mg',
      concentration: '50mg/mL',
      steps: [
        'Add 1mL BAC water to 50mg vial (if injectable)',
        '50mg per mL — use very small volumes',
        'Oral: dissolve in minimal water or DMSO and consume',
        'Start at lowest effective dose — potency is extreme'
      ],
      syringeTable: [
        { dose: '1mg', units: 2, ml: '0.02mL' },
        { dose: '3mg', units: 6, ml: '0.06mL' }
      ]
    },
    storage: 'Refrigerate or freeze for long-term storage. Stable for 6+ months frozen. Use reconstituted within 28 days.',
    sideEffects: ['Limited human safety data — use with caution','Potential for overstimulation of MET pathway (which also promotes cell growth — long-term implications unknown)','Headache at higher doses (reduce dose)','Not recommended for individuals with history of cancer (MET pathway activation)'],
    burnWarning: false,
    flushWarning: false,
    faq: [
      { q: 'How is Dihexa different from Semax or Selank?', a: 'Semax and Selank work via BDNF/NGF and GABA modulation — they enhance existing neural function. Dihexa creates entirely new synaptic connections (synaptogenesis). It is a structural enhancer, not just a performance one. This makes it more powerful and also less understood.' },
      { q: 'Is Dihexa safe?', a: 'Human safety data is extremely limited. The primary published study was retracted in 2025. Animal studies showed cognitive improvements without obvious toxicity, but the evidence base is now contested. MET pathway activation is the primary long-term concern — warrants caution in anyone with cancer history. Marc includes this compound for research awareness only.' },
      { q: 'Who is the ideal candidate for Dihexa?', a: 'Given the retracted research, Marc does not currently recommend Dihexa as a front-line option. Exhaust Semax, Selank, and NAD+ first. For clients with significant cognitive decline who have maximized other protocols, it may be discussed — with full transparency about the evidence limitations.' }
    ],
    research: [
      { title: 'The procognitive and synaptogenic effects of angiotensin IV-derived peptides via the HGF/c-Met system (NOTE: retracted 2025 — cited for historical context)', journal: 'Journal of Pharmacology and Experimental Therapeutics, 2014 — Benoist CC et al. [RETRACTED]', url: 'https://pubmed.ncbi.nlm.nih.gov/25187433/' },
      { title: 'Retraction notice — Benoist CC et al., J Pharmacol Exp Ther (2014)', journal: 'Journal of Pharmacology and Experimental Therapeutics, 2025', url: 'https://pubmed.ncbi.nlm.nih.gov/40312093/' }
    ]
  },

  // ============================================================
  // BATCH 2 — Added March 2026
  // ============================================================

  {
    id: 'ss31',
    name: 'SS-31',
    fullName: 'SS-31 (Elamipretide / Bendavia)',
    category: 'antiaging',
    emoji: '⚡',
    tagline: 'Mitochondrial protector — recharging the powerhouses of your cells',
    notable: "SS-31 targets cardiolipin — the structural lipid on the inner mitochondrial membrane that collapses under oxidative stress. When cardiolipin degrades, mitochondria lose efficiency and energy production falls. Animal studies showed SS-31 restored cardiac function in chronic heart failure models. Currently in human clinical trials for heart failure and kidney disease.",
    confidence: 'MEDIUM',
    inStock: true,
    benefits: ['Mitochondrial membrane protection','ATP production enhancement','Oxidative stress reduction','Cardiac function support','Muscle endurance','Anti-inflammatory at cellular level'],
    description: 'SS-31 (Elamipretide) is a mitochondria-targeted tetrapeptide that binds to cardiolipin on the inner mitochondrial membrane. This unique targeting mechanism protects mitochondrial cristae structure, enhances electron transport chain efficiency, and reduces reactive oxygen species production. Research suggests benefits for heart failure, aging-related energy decline, and muscle dysfunction.',
    mechanism: 'Binds selectively to cardiolipin on the inner mitochondrial membrane. Stabilizes cristae morphology, enhances electron transport chain (Complex I–IV) function, reduces superoxide production. Improves mitochondrial bioenergetics without altering mitochondrial membrane potential.',
    dose: '1–4mg/day (SubQ)',
    frequency: 'Once daily SubQ injection',
    duration: '4–8 week cycles',
    reconstitution: {
      bacWater: '2mL',
      vialSize: '10mg',
      concentration: '5mg/mL',
      steps: [
        'Add 2mL BAC water to 10mg vial',
        'Swirl gently — never shake',
        '5mg per mL'
      ],
      syringeTable: [
        { dose: '5mg', units: 100, ml: '1.00mL' },
        { dose: '10mg', units: 200, ml: '2.00mL' }
      ]
    },
    storage: 'Refrigerate after reconstitution. Use within 28 days. Protect from light.',
    sideEffects: ['Mild injection site discomfort','Transient nausea (rare)','Flushing (uncommon)'],
    burnWarning: false,
    flushWarning: false,
    faq: [
      { q: 'Who benefits most from SS-31?', a: 'Individuals with mitochondrial dysfunction, chronic fatigue, cardiovascular disease, or age-related energy decline. Athletes seeking endurance improvement may also benefit.' },
      { q: 'How does SS-31 differ from CoQ10?', a: 'CoQ10 supplementation delivers antioxidant support generally. SS-31 specifically targets the inner mitochondrial membrane via cardiolipin binding, providing a more direct structural and functional mitochondrial intervention.' },
      { q: 'What does improved mitochondrial function feel like?', a: 'Most clients report improved energy levels, better exercise tolerance, and reduced fatigue — often within 2–4 weeks of consistent use.' }
    ],
    research: [
      { title: 'Elamipretide (SS-31) improves mitochondrial function and bioenergetics in skeletal muscle', journal: 'JACC: Basic to Translational Science, 2020', url: 'https://pubmed.ncbi.nlm.nih.gov/32613148/' },
      { title: 'Cardiolipin binding by SS-31 and its role in mitochondrial function', journal: 'Biochimica et Biophysica Acta, 2014', url: 'https://pubmed.ncbi.nlm.nih.gov/24792477/' }
    ]
  },

  {
    id: 'dsip',
    name: 'DSIP',
    fullName: 'Delta Sleep-Inducing Peptide',
    category: 'cognitive',
    emoji: '🌙',
    tagline: 'Deep sleep architect — resetting your body\'s most powerful recovery system',
    notable: "DSIP was first isolated from sleeping rabbit brains in 1977 — a factor in sleeping animals that could induce delta (slow-wave) sleep in awake ones. It shifts sleep architecture toward more time in the deepest repair stage where GH is secreted and memories are consolidated. No sedation, no dependency — it restores normal sleep architecture.",
    confidence: 'MEDIUM',
    inStock: true,
    benefits: ['Deep (delta wave) sleep enhancement','Stress hormone modulation','Cortisol reduction','LH/GH release stimulation','Antioxidant activity','Chronic pain relief (animal data)'],
    description: 'DSIP is a naturally occurring nonapeptide first isolated from rabbit cerebral venous blood during induced slow-wave sleep. It modulates sleep architecture, reduces ACTH and cortisol, and has demonstrated antioxidant and stress-protective properties. It is used by researchers exploring sleep quality optimization and neuroendocrine regulation.',
    mechanism: 'Modulates delta wave (slow-wave) sleep architecture via CNS receptors. Inhibits ACTH release and reduces cortisol. Stimulates pulsatile LH and GH secretion. Crosses the blood-brain barrier. Exhibits antioxidant and cytoprotective activity in neural tissue.',
    dose: '0.1–0.3mg per dose',
    frequency: '3–5x per week, injected 20–30 min before sleep',
    duration: '2–4 week cycles with breaks',
    reconstitution: {
      bacWater: '2mL',
      vialSize: '2mg',
      concentration: '1,000mcg/mL',
      steps: [
        'Add 2mL BAC water to 2mg vial',
        'Swirl gently',
        '1,000mcg per mL',
        'Inject 20–30 minutes before bedtime'
      ],
      syringeTable: [
        { dose: '100mcg', units: 10, ml: '0.10mL' },
        { dose: '200mcg', units: 20, ml: '0.20mL' },
        { dose: '300mcg', units: 30, ml: '0.30mL' }
      ]
    },
    storage: 'Refrigerate after reconstitution. Use within 28 days.',
    sideEffects: ['Drowsiness (expected — inject near bedtime)','Vivid dreams','Mild headache (rare)','Hormonal fluctuation with prolonged use'],
    burnWarning: false,
    flushWarning: false,
    faq: [
      { q: 'Is DSIP the same as a sleeping pill?', a: 'No — DSIP does not sedate in the same way as pharmaceutical sleep aids. It modulates sleep architecture, promoting more restorative slow-wave sleep rather than simply inducing unconsciousness.' },
      { q: 'Can DSIP stack with other peptides?', a: 'Yes — DSIP pairs well with Pinealon and Selank for a comprehensive sleep/recovery stack. Avoid combining with sedatives.' },
      { q: 'How quickly does it work?', a: 'Most users notice improved sleep quality within 3–5 sessions. Full benefits to sleep architecture may take 2 weeks.' }
    ],
    research: [
      { title: 'Delta sleep-inducing peptide — a review of its behavioral and neurochemical properties', journal: 'Neuroscience & Biobehavioral Reviews, 1989', url: 'https://pubmed.ncbi.nlm.nih.gov/2671833/' },
      { title: 'DSIP modulation of ACTH and cortisol', journal: 'Life Sciences, 1988', url: 'https://pubmed.ncbi.nlm.nih.gov/2899241/' }
    ]
  },

  {
    id: 'p21',
    name: 'P21',
    fullName: 'P21 Peptide (CNTF-derived nootropic fragment)',
    category: 'cognitive',
    emoji: '🧬',
    tagline: 'Neurogenesis activator — growing new brain cells in the hippocampus',
    notable: "P21 activates CNTF receptor pathways — triggering neurogenesis (growth of new neurons) in the hippocampus and cortex of adult brain tissue. Animal studies reversed cognitive deficits in Alzheimer's and traumatic brain injury models. One of very few compounds with published evidence of actual new neuron generation rather than just neuroprotection.",
    confidence: 'LOW',
    inStock: true,
    benefits: ['Hippocampal neurogenesis','BDNF upregulation','Memory and learning support','Neuroprotection','STAT3 pathway modulation','Experimental cognitive restoration'],
    description: 'P21 is a synthetic peptide derived from the ciliary neurotrophic factor (CNTF). Unlike CNTF itself, P21 is designed to stimulate hippocampal neurogenesis and BDNF production without activating the STAT3 pathway that causes unwanted systemic side effects. It represents one of the most direct experimental approaches to growing new neural tissue. Research is early-stage; confidence is LOW.',
    mechanism: 'Derived from the CNTF binding domain. Stimulates hippocampal neurogenesis via BDNF upregulation. Selectively activates pro-neurogenic pathways while bypassing STAT3 signaling (which causes CNTF side effects). Promotes survival and differentiation of new neurons in the dentate gyrus.',
    dose: '5–15mg/day (oral or SubQ)',
    frequency: 'Daily',
    duration: '30–60 day cycles',
    reconstitution: {
      bacWater: '2mL',
      vialSize: '10mg',
      concentration: '5mg/mL',
      steps: [
        'Add 2mL BAC water to 10mg vial',
        'Swirl gently — do not shake',
        '5mg per mL',
        'Note: P21 may also be taken orally — dissolve in water'
      ],
      syringeTable: [
        { dose: '5mg', units: 100, ml: '1.00mL' },
        { dose: '10mg', units: 200, ml: '2.00mL' }
      ]
    },
    storage: 'Refrigerate after reconstitution. Use within 28 days.',
    sideEffects: ['Limited human safety data','Fatigue at high doses','Headache (reduce dose)','Interactions with growth factor pathways — use caution with active malignancies'],
    burnWarning: false,
    flushWarning: false,
    faq: [
      { q: 'Is P21 the same as CNTF?', a: 'No — P21 is a small synthetic fragment derived from CNTF designed to retain the neurogenic benefits while eliminating the problematic STAT3 activation that causes systemic side effects (weight loss, cachexia) seen with full CNTF.' },
      { q: 'Can P21 actually grow new brain cells?', a: 'Animal research suggests yes — hippocampal neurogenesis has been demonstrated. However, human clinical data is essentially nonexistent. This is an experimental research compound.' },
      { q: 'How does P21 compare to Dihexa?', a: 'Both target neurogenesis but via different pathways. Dihexa works via HGF/MET; P21 works via BDNF/CNTF pathways. P21 has not experienced the retraction issues Dihexa has, but evidence for both remains limited.' }
    ],
    research: [
      { title: 'P21 peptide increases hippocampal neurogenesis and improves cognition', journal: 'Neuroscience, 2011', url: 'https://pubmed.ncbi.nlm.nih.gov/21723919/' }
    ]
  },

  {
    id: 'pinealon',
    name: 'Pinealon',
    fullName: 'Pinealon (Glu-Asp-Arg Bioregulator)',
    category: 'antiaging',
    emoji: '🌑',
    tagline: 'Pineal gland bioregulator — restoring sleep, rhythm, and longevity signaling',
    notable: "The pineal gland begins calcifying at age 17, progressively reducing melatonin output and destabilizing circadian timing. Pinealon is a peptide bioregulator targeting pineal tissue — developed by Vladimir Khavinson — shown to slow calcification and restore melatonin rhythm. Addresses the upstream cause of age-related sleep deterioration, not just the symptom.",
    confidence: 'MEDIUM',
    inStock: true,
    benefits: ['Pineal gland function support','Melatonin rhythm restoration','Circadian regulation','Neuroprotection','Anti-aging via telomere preservation','Sleep architecture optimization'],
    description: 'Pinealon is a short tripeptide bioregulator (Glu-Asp-Arg) developed by the Khavinson Institute in St. Petersburg. It targets the pineal gland — the master clock organ responsible for melatonin secretion and circadian rhythm coordination. Research shows Pinealon preserves pineal cell function, promotes melatonin synthesis, and may slow age-related gland calcification.',
    mechanism: 'Tripeptide (Glu-Asp-Arg) that penetrates cell nuclei and interacts with DNA, upregulating pineal-specific gene expression. Stimulates pinealocyte function, promoting melatonin synthesis and secretion. May inhibit pineal calcification and preserve gland mass with aging.',
    dose: '5–10mg/day',
    frequency: 'Once daily, evening preferred',
    duration: '10–30 day cycles, 2–3x per year',
    reconstitution: {
      bacWater: '2mL',
      vialSize: '10mg',
      concentration: '5mg/mL',
      steps: [
        'Add 2mL BAC water to 10mg vial',
        'Swirl gently',
        '5mg per mL'
      ],
      syringeTable: [
        { dose: '5mg', units: 100, ml: '1.00mL' },
        { dose: '10mg', units: 200, ml: '2.00mL' }
      ]
    },
    storage: 'Refrigerate after reconstitution. Use within 28 days.',
    sideEffects: ['Generally very well tolerated','Mild drowsiness (expected — take in evening)','Vivid dreams (common, typically positive)'],
    burnWarning: false,
    flushWarning: false,
    faq: [
      { q: 'Is Pinealon the same as melatonin?', a: 'No — Pinealon stimulates your own pineal gland to produce and regulate melatonin naturally, rather than supplying exogenous melatonin. This preserves the pulsatile, rhythmic release pattern that exogenous melatonin cannot replicate.' },
      { q: 'Can Pinealon reverse pineal calcification?', a: 'Early research from the Khavinson Institute suggests it may slow or partially reverse age-related calcification of the pineal gland, but definitive human clinical evidence is limited.' },
      { q: 'What is the best stack with Pinealon?', a: 'Pinealon pairs excellently with DSIP (for sleep architecture) and Epithalon (for broader longevity support). Together they form a comprehensive neuroendocrine longevity protocol.' }
    ],
    research: [
      { title: 'Peptide bioregulators of the pineal gland and their role in aging', journal: 'Advances in Gerontology, 2012', url: 'https://pubmed.ncbi.nlm.nih.gov/23289228/' }
    ]
  },

  {
    id: 'pt141',
    name: 'PT-141',
    fullName: 'PT-141 (Bremelanotide)',
    category: 'performance',
    emoji: '🔥',
    tagline: 'Central nervous system sexual arousal activator — FDA-approved mechanism',
    confidence: 'HIGH',
    inStock: true,
    benefits: ['Sexual arousal (men and women)','Libido restoration','Erectile function support','CNS-mediated desire activation','Body image and confidence','Mood elevation'],
    description: 'PT-141 (Bremelanotide) is a melanocortin receptor agonist that activates sexual arousal via the central nervous system — not through vascular mechanisms like PDE5 inhibitors. It is the first peptide approved (as Vyleesi) for hypoactive sexual desire disorder in women, and is widely researched for both male and female sexual dysfunction.',
    mechanism: 'Activates melanocortin-3 (MC3R) and melanocortin-4 (MC4R) receptors in the hypothalamus. Triggers dopaminergic and serotonergic pathways involved in sexual arousal and desire — working centrally rather than peripherally. Distinct mechanism from PDE5 inhibitors.',
    dose: '0.5–2mg per use',
    frequency: 'As needed — inject 45–60 minutes before activity',
    duration: 'As needed (not daily)',
    reconstitution: {
      bacWater: '2mL',
      vialSize: '10mg',
      concentration: '5mg/mL',
      steps: [
        'Add 2mL BAC water to 10mg vial',
        'Swirl gently',
        '5mg per mL',
        'Inject SubQ 45–60 minutes before activity'
      ],
      syringeTable: [
        { dose: '0.5mg', units: 10, ml: '0.10mL' },
        { dose: '1mg', units: 20, ml: '0.20mL' },
        { dose: '2mg', units: 40, ml: '0.40mL' }
      ]
    },
    storage: 'Refrigerate after reconstitution. Use within 28 days.',
    sideEffects: ['Nausea (most common — start low, take with food)', 'Facial flushing', 'Headache', 'Transient blood pressure changes', 'Darkening of skin/freckles with repeated use (melanocortin activation)'],
    burnWarning: false,
    flushWarning: true,
    flushNote: 'PT-141 commonly causes facial flushing and warmth, especially at doses above 1mg. This is expected and harmless. Start at 0.5mg to assess tolerance.',
    notable: 'A randomized double-blind trial (Safarinejad & Hosseini, J Urology, 2008) tested PT-141 in 342 men who had ALREADY FAILED Viagra. Result: significant improvement in erectile function in men for whom PDE5 inhibitors provided no benefit. PT-141 works where Viagra cannot — through an entirely different brain pathway.',
    faq: [
      { q: 'Can PT-141 replace Viagra? It worked for men who failed Viagra?', a: 'Fundamentally different mechanisms. Viagra increases blood flow to the genitals — you still need to be aroused for it to work. PT-141 activates MC4R receptors in the hypothalamus that generate desire and arousal from the source. A 2008 J Urology study tested PT-141 in 342 men who had failed Viagra — and showed significant improvement. It works where Viagra cannot.' },
      { q: 'Does PT-141 work for women?', a: 'Yes — PT-141 (as Vyleesi) was FDA-approved for hypoactive sexual desire disorder (HSDD) in premenopausal women. A 2016 randomized trial showed significant improvements in desire and arousal scores. For menopausal women, it directly addresses the neurological side of libido loss.' },
      { q: 'How long do the effects last?', a: 'Inject 45–60 minutes before intended effect. Effects typically last 6–12 hours. Start at 0.5mg to assess nausea tolerance — it is dose-dependent and significantly less at lower doses.' },
      { q: 'How does PT-141 differ from Viagra/Cialis?', a: 'PDE5 inhibitors (Viagra/Cialis) work on blood flow mechanics. PT-141 works in the brain — activating desire pathways. They can complement each other; PT-141 addresses desire and motivation, PDE5 inhibitors address physical mechanics.' }
    ],
    research: [
      { title: 'Bremelanotide for hypoactive sexual desire disorder — a randomized phase 3 trial', journal: 'Obstetrics & Gynecology, 2019', url: 'https://pubmed.ncbi.nlm.nih.gov/31348113/' },
      { title: 'PT-141 — a melanocortin agonist for the treatment of sexual dysfunction', journal: 'Annals of the New York Academy of Sciences, 2003', url: 'https://pubmed.ncbi.nlm.nih.gov/14681131/' }
    ]
  },

  {
    id: 'melanotan2',
    name: 'Melanotan-2',
    fullName: 'Melanotan-2 (MT-2)',
    category: 'performance',
    emoji: '☀️',
    tagline: 'Melanocortin agonist — tanning, libido, and appetite modulation',
    notable: "Melanotan-2 was originally developed by University of Arizona researchers as a sunscreen alternative — a compound that would tan skin without UV exposure to prevent skin cancer. In trials, an unexpected 10–15x increase in sexual arousal was reported — an effect so significant it led directly to the development of PT-141 as a sexual dysfunction treatment.",
    confidence: 'MEDIUM',
    inStock: true,
    benefits: ['Accelerated UV tanning','Libido enhancement','Spontaneous erections','Appetite suppression','Melanin production stimulation','Photoprotection'],
    description: 'Melanotan-2 is a cyclic analogue of alpha-melanocyte-stimulating hormone (α-MSH). It stimulates melanin production for accelerated tanning with reduced UV exposure, while also activating melanocortin receptors involved in sexual arousal and appetite. It shares receptor activity with PT-141 but has stronger tanning effects and a broader melanocortin receptor profile.',
    mechanism: 'Binds to MC1R (melanin/tanning), MC3R and MC4R (sexual arousal, appetite). Activates melanocytes to produce eumelanin. Centrally stimulates hypothalamic pathways for libido and appetite suppression via MC4R.',
    dose: '0.25–0.5mg per dose',
    frequency: 'Daily or every other day (loading), then as needed',
    duration: '4–8 week loading cycle, then maintenance',
    reconstitution: {
      bacWater: '2mL',
      vialSize: '10mg',
      concentration: '5mg/mL',
      steps: [
        'Add 2mL BAC water to 10mg vial',
        'Swirl gently',
        '5mg per mL',
        'Start with 0.25mg (5 units) to assess tolerance'
      ],
      syringeTable: [
        { dose: '0.25mg', units: 5, ml: '0.05mL' },
        { dose: '0.5mg', units: 10, ml: '0.10mL' },
        { dose: '1mg', units: 20, ml: '0.20mL' }
      ]
    },
    storage: 'Refrigerate after reconstitution. Use within 28 days. Protect from light.',
    sideEffects: ['Nausea (very common — start very low)', 'Facial flushing', 'Spontaneous erections (men)', 'Darkening of moles/freckles — monitor any skin changes', 'Yawning', 'Fatigue'],
    burnWarning: false,
    flushWarning: true,
    flushNote: 'Melanotan-2 frequently causes flushing and nausea, especially during loading. Start at 0.25mg and titrate slowly. Take the first few doses before sleep to minimize discomfort.',
    faq: [
      { q: 'How long until I see tanning?', a: 'Visible melanin increase typically begins within 1–2 weeks with UV exposure (even low-level sunlight). Without UV, MT-2 still activates melanin pathways but visible tanning requires some sun.' },
      { q: 'Is Melanotan-2 the same as PT-141?', a: 'Related but different. MT-2 is a full melanocortin agonist (MC1R, MC3R, MC4R). PT-141 is a derivative optimized for MC3R/MC4R (sexual arousal) with reduced tanning effects. MT-2 has broader activity.' },
      { q: 'Should I monitor moles?', a: 'Yes — melanocortin activation can cause existing moles and nevi to darken or change appearance. Conduct a baseline skin check and monitor monthly. Any unusual changes warrant dermatology review.' }
    ],
    research: [
      { title: 'Melanotan-II — a selective alpha-melanocyte stimulating hormone analogue', journal: 'Life Sciences, 1991', url: 'https://pubmed.ncbi.nlm.nih.gov/1875728/' },
      { title: 'Melanocortin receptor agonists and sexual function', journal: 'European Urology, 2003', url: 'https://pubmed.ncbi.nlm.nih.gov/12531467/' }
    ]
  },

  {
    id: 'kisspeptin',
    name: 'Kisspeptin-10',
    fullName: 'Kisspeptin-10 (KP-10)',
    category: 'performance',
    emoji: '💛',
    tagline: 'Master hormonal switch — activating the GnRH axis for testosterone and LH',
    confidence: 'MEDIUM',
    inStock: true,
    benefits: ['LH pulse stimulation','Testosterone production activation','GnRH axis restoration','Fertility support (men and women)','Puberty-related hormone signaling','Hypothalamic regulation'],
    description: 'Kisspeptin-10 is the active 10-amino acid C-terminal fragment of kisspeptin, the master upstream regulator of the hypothalamic-pituitary-gonadal (HPG) axis. It stimulates GnRH neurons to pulse-release GnRH, which drives LH and FSH secretion — ultimately stimulating testosterone and reproductive function. Critical for HPG axis restoration in those with hypogonadism or post-cycle suppression.',
    mechanism: 'Binds to KISS1R (kisspeptin receptor) on hypothalamic GnRH neurons. Triggers pulsatile GnRH secretion → LH and FSH release from pituitary → testosterone and estrogen production from gonads. The upstream master switch for the entire reproductive hormone cascade.',
    dose: '0.05–0.1mg per dose',
    frequency: '2–3x weekly or pulsatile (every 90 min in clinical protocols)',
    duration: '4–8 weeks',
    reconstitution: {
      bacWater: '2mL',
      vialSize: '2mg',
      concentration: '1,000mcg/mL',
      steps: [
        'Add 2mL BAC water to 2mg vial',
        'Swirl gently',
        '1,000mcg per mL'
      ],
      syringeTable: [
        { dose: '50mcg', units: 5, ml: '0.05mL' },
        { dose: '100mcg', units: 10, ml: '0.10mL' }
      ]
    },
    storage: 'Refrigerate after reconstitution. Use within 28 days.',
    sideEffects: ['Mild injection site reactions','Transient LH surge effects (mood, libido spike)','Nausea (rare)','Not recommended during active pregnancy attempts without physician oversight'],
    burnWarning: false,
    flushWarning: false,
    notable: 'A 2025 study (J Assist Reprod Genet) found kisspeptin levels measurably lower in infertile men than fertile men — proposing it as a new diagnostic biomarker for male infertility. Kisspeptin is not just a treatment target; it may be the key signal your body stopped producing.',
    faq: [
      { q: "I'm infertile. Can Kisspeptin actually help me become fertile?", a: 'Research suggests yes — specifically when infertility stems from hormonal signalling failure. Kisspeptin is the upstream master switch: Kisspeptin → GnRH → LH/FSH → testosterone + sperm. Published case studies show pulsatile kisspeptin restored LH pulsatility and endogenous testosterone in men with hypogonadism. Sperm changes take 12 weeks (one full production cycle) to assess.' },
      { q: 'Why does it need to be pulsatile — why not daily?', a: 'Critical: continuous daily kisspeptin suppresses the HPG axis — the same mechanism doctors use to crash testosterone in prostate cancer treatment. Pulsatile dosing (2–3x/week, never two days in a row) keeps receptors sensitive and preserves the natural LH pulse. Never skip rest days.' },
      { q: 'How does Kisspeptin compare to HCG for testosterone restoration?', a: 'HCG acts directly on the testes (LH analogue). Kisspeptin acts upstream — stimulating the hypothalamus to produce GnRH naturally. Kisspeptin preserves the entire axis; HCG bypasses it. For fertility, Kisspeptin is preferred because it maintains natural LH pulsatility.' },
      { q: 'Can women use Kisspeptin?', a: 'Yes — and the menopause application is particularly interesting. Kisspeptin/NKB neurons in the hypothalamus are the same neurons that drive hot flash symptoms. Studies show modulating this system may reduce vasomotor symptom frequency and severity.' }
    ],
    research: [
      { title: 'Kisspeptin as a marker for male infertility — kisspeptin measurably lower in infertile men', journal: 'Journal of Assisted Reproduction & Genetics, 2025', url: 'https://pubmed.ncbi.nlm.nih.gov/40936057/' },
      { title: 'Kisspeptin and the neuroendocrine control of GnRH secretion', journal: 'Journal of Neuroendocrinology, 2008', url: 'https://pubmed.ncbi.nlm.nih.gov/18088362/' },
      { title: 'Kisspeptin-54 induces LH secretion in healthy men', journal: 'Journal of Clinical Endocrinology & Metabolism, 2005', url: 'https://pubmed.ncbi.nlm.nih.gov/15657375/' }
    ]
  },

  {
    id: 'll37',
    name: 'LL-37',
    fullName: 'LL-37 (Cathelicidin Antimicrobial Peptide)',
    category: 'immune',
    emoji: '🛡️',
    tagline: 'The body\'s own antibiotic — broad-spectrum immune defense peptide',
    notable: "LL-37 is the only known human cathelicidin — a naturally produced antimicrobial peptide that kills bacteria, viruses, and fungi by physically disrupting their cell membranes. Unlike antibiotics that target specific bacterial enzymes (enabling resistance), LL-37 uses membrane disruption that pathogens cannot easily evolve resistance to.",
    confidence: 'MEDIUM',
    inStock: true,
    benefits: ['Broad-spectrum antimicrobial activity','Biofilm disruption','Wound healing acceleration','Inflammation modulation','Innate immune activation','Anti-tumor activity (research)'],
    description: 'LL-37 is the only known human cathelicidin — a naturally produced antimicrobial peptide that forms part of the innate immune system. It kills bacteria, viruses, and fungi by disrupting cell membranes, while also modulating inflammatory responses and promoting wound healing. Deficiency is linked to recurrent infections, psoriasis, and impaired wound healing.',
    mechanism: 'Cationic amphipathic helix structure allows insertion into and disruption of microbial cell membranes. Activates Toll-like receptor pathways, stimulates neutrophil function, and promotes angiogenesis for wound healing. Also modulates inflammatory cytokine balance (can be pro- or anti-inflammatory depending on context).',
    dose: '0.1–0.5mg per dose',
    frequency: '3–5x weekly',
    duration: '4–8 weeks for immune support protocols',
    reconstitution: {
      bacWater: '2mL',
      vialSize: '2mg',
      concentration: '1,000mcg/mL',
      steps: [
        'Add 2mL BAC water to 2mg vial',
        'Swirl gently',
        '1,000mcg per mL'
      ],
      syringeTable: [
        { dose: '100mcg', units: 10, ml: '0.10mL' },
        { dose: '250mcg', units: 25, ml: '0.25mL' },
        { dose: '500mcg', units: 50, ml: '0.50mL' }
      ]
    },
    storage: 'Refrigerate after reconstitution. Use within 28 days. LL-37 is sensitive to degradation — handle with care.',
    sideEffects: ['Injection site redness/irritation','Mild inflammatory response at injection site','Systemic inflammatory flare (rare — at high doses)'],
    burnWarning: false,
    flushWarning: false,
    faq: [
      { q: 'Can LL-37 replace antibiotics?', a: 'No — LL-37 is a research peptide exploring innate immune support. It is not a replacement for prescribed antibiotics. It may complement immune defense but should not substitute medical treatment for bacterial infections.' },
      { q: 'What conditions is LL-37 researched for?', a: 'Wound healing, recurrent infections, Lyme disease protocols, psoriasis, and innate immune insufficiency. Anti-cancer research is emerging but very preliminary.' },
      { q: 'How is LL-37 deficiency identified?', a: 'LL-37 is produced in skin, lungs, gut, and immune cells. Low levels are associated with atopic dermatitis and recurrent respiratory infections. Testing is research-level; it is not routinely measured clinically.' }
    ],
    research: [
      { title: 'LL-37 — the only human member of the cathelicidin family of antimicrobial peptides', journal: 'Biochimica et Biophysica Acta, 2006', url: 'https://pubmed.ncbi.nlm.nih.gov/16630736/' },
      { title: 'Cathelicidin LL-37 in wound healing and immune defense', journal: 'Journal of Innate Immunity, 2009', url: 'https://pubmed.ncbi.nlm.nih.gov/20375611/' }
    ]
  },

  {
    id: 'igf1lr3',
    name: 'IGF-1 LR3',
    fullName: 'IGF-1 LR3 (Long R3 Insulin-Like Growth Factor-1)',
    category: 'performance',
    emoji: '💪',
    tagline: 'Extended-action IGF-1 — maximizing anabolic signaling for muscle and recovery',
    notable: "LL-37 is the only known human cathelicidin — a naturally produced antimicrobial peptide that kills bacteria, viruses, and fungi by physically disrupting their cell membranes. Unlike antibiotics that target specific bacterial enzymes (allowing resistance to develop), LL-37 uses membrane disruption that pathogens cannot easily evolve resistance to.",
    confidence: 'MEDIUM',
    inStock: true,
    benefits: ['Muscle hypertrophy','Fat loss','Enhanced recovery','Satellite cell activation','Nitrogen retention','Hyperplasia (new muscle fiber formation)'],
    description: 'IGF-1 LR3 is a recombinant, longer-acting variant of IGF-1 with an arginine substitution at position 3 and an N-terminal 13-amino acid extension. This modification reduces binding to IGF-binding proteins, dramatically increasing its half-life (20–30 hours vs. ~12 minutes for native IGF-1). It provides sustained anabolic receptor activation for muscle growth and recovery.',
    mechanism: 'Binds IGF-1R receptors, activating PI3K/Akt/mTOR and MAPK/ERK pathways. The LR3 modification prevents binding to IGFBPs, extending bioactivity dramatically. Promotes satellite cell activation, protein synthesis, nitrogen retention, and fat cell lipolysis. Directly signals skeletal muscle growth independent of GH.',
    dose: '0.02–0.05mg/day (post-workout or upon waking)',
    frequency: 'Daily or 5x/week',
    duration: '4–6 week cycles maximum (receptor desensitization)',
    reconstitution: {
      bacWater: '1mL',
      vialSize: '1mg (1,000mcg)',
      concentration: '1,000mcg/mL',
      steps: [
        'Add 1mL BAC water to 1mg vial',
        'Swirl very gently',
        '1,000mcg per mL',
        'Use an insulin syringe for precise small-volume dosing'
      ],
      syringeTable: [
        { dose: '20mcg', units: 2, ml: '0.02mL' },
        { dose: '30mcg', units: 3, ml: '0.03mL' },
        { dose: '50mcg', units: 5, ml: '0.05mL' }
      ]
    },
    storage: 'Refrigerate immediately. Use within 14 days of reconstitution. Highly sensitive to degradation.',
    sideEffects: ['Hypoglycemia (blood sugar drop — have carbs available)', 'Joint swelling at high doses', 'Acromegalic effects with prolonged overdose', 'Potential tumor promotion (avoid with cancer history)'],
    burnWarning: false,
    flushWarning: false,
    faq: [
      { q: 'How is IGF-1 LR3 different from IGF-1 DES?', a: 'LR3 has a long half-life (20–30 hours) — one injection provides sustained systemic anabolic activity. IGF-1 DES is extremely short-acting (minutes) and highly potent locally at the injection site for hyperplasia.' },
      { q: 'When should I inject?', a: 'Post-workout is the most common timing. Some protocols use upon waking. Avoid late evening due to potential hypoglycemia during sleep.' },
      { q: 'Is IGF-1 LR3 safe for long-term use?', a: 'No — 4–6 week cycles maximum. IGF-1R desensitization occurs with prolonged stimulation. Extended use also raises concerns about promoting growth in undetected malignancies via IGF-1R.' }
    ],
    research: [
      { title: 'Long R3 IGF-I protein composition and pharmacology', journal: 'Endocrinology, 1991', url: 'https://pubmed.ncbi.nlm.nih.gov/1935785/' },
      { title: 'IGF-1 and skeletal muscle mass — mechanisms of anabolic action', journal: 'Journal of Physiology, 2004', url: 'https://pubmed.ncbi.nlm.nih.gov/14724178/' }
    ]
  },

  {
    id: 'hghfrag',
    name: 'HGH Fragment 176-191',
    fullName: 'HGH Fragment 176-191 (AOD-9604 parent compound)',
    category: 'weight',
    emoji: '🔥',
    tagline: 'Isolated fat-burning fragment of HGH — lipolysis without the growth',
    notable: "HGH Fragment 176-191 is identical to AOD-9604 — the fat-metabolizing C-terminal fragment of growth hormone. It was isolated at Monash University specifically because researchers observed that the fat-burning effects of HGH could be separated from its growth and blood sugar effects. All the lipolysis, none of the downsides.",
    confidence: 'MEDIUM',
    inStock: true,
    benefits: ['Selective fat burning (lipolysis)','No anabolic or IGF-1 effects','No insulin resistance','Targets visceral and stubborn fat','Preserves lean mass','Mild appetite reduction'],
    description: 'HGH Fragment 176-191 is the C-terminal portion of human growth hormone that contains the fat-burning domain. Unlike full HGH, it does not stimulate IGF-1 production, does not cause insulin resistance, and has no significant anabolic effect — making it a targeted lipolysis tool without the systemic risks of full GH. AOD-9604 is a stabilized, modified version.',
    mechanism: 'Isolated C-terminal fragment of HGH (amino acids 176–191) retains the lipolytic signaling of full GH. Activates β-adrenergic receptors in adipose tissue to stimulate lipolysis. Does not bind IGF-1 receptors, eliminating growth-promoting and insulin-antagonizing effects of full HGF.',
    dose: '0.25–0.5mg/day',
    frequency: 'Once daily (morning on empty stomach, or pre-workout)',
    duration: '4–12 weeks',
    reconstitution: {
      bacWater: '2mL',
      vialSize: '5mg',
      concentration: '2,500mcg/mL',
      steps: [
        'Add 2mL BAC water to 5mg vial',
        'Swirl gently',
        '2,500mcg per mL',
        'Inject on empty stomach for maximum lipolytic effect'
      ],
      syringeTable: [
        { dose: '250mcg', units: 10, ml: '0.10mL' },
        { dose: '500mcg', units: 20, ml: '0.20mL' }
      ]
    },
    storage: 'Refrigerate after reconstitution. Use within 28 days.',
    sideEffects: ['Generally very well tolerated', 'Mild injection site reactions', 'Transient blood glucose changes (mild, unlike full GH)', 'Headache (rare)'],
    burnWarning: false,
    flushWarning: false,
    faq: [
      { q: 'Is HGH Fragment the same as AOD-9604?', a: 'Closely related — AOD-9604 is a slightly modified, stabilized version of HGH Frag 176-191 with an added tyrosine at the N-terminus. Effects are very similar; AOD-9604 has slightly better stability.' },
      { q: 'Will this affect my blood sugar?', a: 'Unlike full HGH which causes significant insulin resistance, HGH Fragment 176-191 has minimal impact on insulin sensitivity. This is one of its key advantages.' },
      { q: 'Can I stack with other fat loss compounds?', a: 'Yes — stacks well with AOD-9604, Tesamorelin (for visceral fat specifically), and MOTS-C. Together they target fat loss through complementary mechanisms.' }
    ],
    research: [
      { title: 'The lipolytic effect of a human growth hormone fragment with minimal diabetogenic activity', journal: 'Journal of Molecular Endocrinology, 2000', url: 'https://pubmed.ncbi.nlm.nih.gov/11085687/' }
    ]
  },

  {
    id: 'cardiogen',
    name: 'Cardiogen',
    fullName: 'Cardiogen (Ala-Glu-Asp-Arg Cardiac Bioregulator)',
    category: 'healing',
    emoji: '❤️',
    tagline: 'Cardiac tissue bioregulator — supporting heart cell regeneration and function',
    notable: "Cardiogen is a tetrapeptide bioregulator specifically targeting cardiac tissue — developed as part of Vladimir Khavinson's peptide bioregulator series from Russian longevity research spanning 35+ years. Animal studies showed it reduces cardiac fibrosis, improves cardiomyocyte function, and extends healthy lifespan in models of accelerated aging.",
    confidence: 'MEDIUM',
    inStock: true,
    benefits: ['Cardiac muscle cell regeneration','Heart tissue bioregulation','Cardiomyocyte protein synthesis','Post-cardiac event recovery support','Cardiovascular aging protection','Khavinson bioregulator protocol'],
    description: 'Cardiogen is a short tetrapeptide bioregulator (Ala-Glu-Asp-Arg) developed by the Khavinson Institute targeting cardiac muscle tissue. It normalizes cardiomyocyte metabolism, promotes heart tissue regeneration, and is used in Eastern European longevity protocols for cardiovascular system support. It belongs to the same bioregulator family as Epithalon and Pinealon.',
    mechanism: 'Short peptide (Ala-Glu-Asp-Arg) penetrates cell nuclei and interacts with chromatin, upregulating cardiac-specific gene expression. Promotes cardiomyocyte protein synthesis, reduces oxidative stress markers in cardiac tissue, and normalizes metabolic processes in heart muscle cells.',
    dose: '5–10mg/day',
    frequency: 'Once daily',
    duration: '10–30 day cycles, 1–2x per year',
    reconstitution: {
      bacWater: '2mL',
      vialSize: '10mg',
      concentration: '5mg/mL',
      steps: [
        'Add 2mL BAC water to 10mg vial',
        'Swirl gently',
        '5mg per mL'
      ],
      syringeTable: [
        { dose: '5mg', units: 100, ml: '1.00mL' },
        { dose: '10mg', units: 200, ml: '2.00mL' }
      ]
    },
    storage: 'Refrigerate after reconstitution. Use within 28 days.',
    sideEffects: ['Generally very well tolerated based on Khavinson Institute data', 'Mild injection site reactions', 'No significant side effects reported in available literature'],
    burnWarning: false,
    flushWarning: false,
    faq: [
      { q: 'Who is Cardiogen designed for?', a: 'Individuals seeking cardiovascular longevity support, post-cardiac event recovery, or those with family history of heart disease. Best used as part of a comprehensive bioregulator protocol.' },
      { q: 'Is this the same as cardiac stem cell therapy?', a: 'No — Cardiogen is a short peptide bioregulator that upregulates native cardiac tissue gene expression. It does not involve stem cell transplantation but may support endogenous cardiomyocyte repair mechanisms.' },
      { q: 'Should this replace cardiac medications?', a: 'Absolutely not — Cardiogen is a research compound and should be used as a complementary protocol under physician guidance, never as a replacement for prescribed cardiac medications.' }
    ],
    research: [
      { title: 'Cardiogen effects on heart muscle gene expression and cardiomyocyte function', journal: 'Bulletin of Experimental Biology and Medicine, 2005', url: 'https://pubmed.ncbi.nlm.nih.gov/16025134/' }
    ]
  },

  {
    id: 'ghrp6',
    name: 'GHRP-6',
    fullName: 'GHRP-6 (Growth Hormone Releasing Peptide-6)',
    category: 'performance',
    emoji: '💪',
    tagline: 'Potent GH secretagogue — with significant appetite stimulation',
    notable: "GHRP-6 was one of the first GH-releasing peptides ever synthesized, originally developed in the 1980s, and remains the most studied synthetic GHRP in existence. It produces the strongest hunger stimulation of any GHRP — which researchers now study as a potential treatment for cachexia (wasting disease) in cancer and HIV patients.",
    confidence: 'HIGH',
    inStock: true,
    benefits: ['Strong GH pulse stimulation','Appetite stimulation (powerful)','Muscle growth and recovery','IGF-1 elevation','Cortisol modulation','Anti-inflammatory'],
    description: 'GHRP-6 is a hexapeptide growth hormone secretagogue that stimulates powerful GH pulses via ghrelin receptor activation. It is among the strongest GH-releasing peptides and is notable for its pronounced hunger stimulation — making it particularly useful for those seeking to increase caloric intake alongside GH benefits. A cornerstone of many bodybuilding and recovery protocols.',
    mechanism: 'Activates ghrelin receptors (GHSR-1a) in the hypothalamus and pituitary. Stimulates pulsatile GH release independently of GHRH. Also stimulates appetite via ghrelin pathway activation. Synergizes with GHRH analogues (CJC-1295) for amplified GH pulses.',
    dose: '0.1–0.3mg per injection',
    frequency: '2–3x daily (fasted state for max GH response)',
    duration: '4–12 weeks',
    reconstitution: {
      bacWater: '2mL',
      vialSize: '5mg',
      concentration: '2,500mcg/mL',
      steps: [
        'Add 2mL BAC water to 5mg vial',
        'Swirl gently',
        '2,500mcg per mL',
        'Inject on empty stomach for maximum GH response'
      ],
      syringeTable: [
        { dose: '100mcg', units: 4, ml: '0.04mL' },
        { dose: '200mcg', units: 8, ml: '0.08mL' },
        { dose: '300mcg', units: 12, ml: '0.12mL' }
      ]
    },
    storage: 'Refrigerate after reconstitution. Use within 28 days.',
    sideEffects: ['Intense hunger (hallmark side effect — plan food accordingly)', 'Water retention at higher doses', 'Mild cortisol increase (dose-dependent)', 'Tingling/numbness (rare)'],
    burnWarning: false,
    flushWarning: false,
    faq: [
      { q: 'How does GHRP-6 compare to Ipamorelin?', a: 'GHRP-6 stimulates stronger GH pulses but with significant appetite stimulation and mild cortisol increase. Ipamorelin is more selective — minimal appetite stimulation, no cortisol elevation. GHRP-6 is preferred when appetite increase is desired.' },
      { q: 'Should I inject on an empty stomach?', a: 'Yes — insulin suppresses GH release. Inject GHRP-6 at least 1.5–2 hours after eating, and wait 30–45 minutes before eating post-injection for maximum GH pulse.' },
      { q: 'Can GHRP-6 stack with CJC-1295?', a: 'Yes — this is one of the most potent GH-releasing stacks available. CJC-1295 (GHRH analogue) + GHRP-6 creates synergistic GH amplification significantly greater than either alone.' }
    ],
    research: [
      { title: 'Growth hormone-releasing peptides — endocrine and non-endocrine activities', journal: 'Endocrine, 2002', url: 'https://pubmed.ncbi.nlm.nih.gov/12184850/' },
      { title: 'GHRP-6 synergizes with GHRH to amplify GH secretion', journal: 'Journal of Clinical Endocrinology & Metabolism, 1994', url: 'https://pubmed.ncbi.nlm.nih.gov/8175964/' },
      { title: 'Growth hormone-releasing peptide 6 (GHRP-6) hydrogel for acute kidney injury therapy via metabolic regulation', journal: 'Journal of Nanobiotechnology, 2025', url: 'https://pubmed.ncbi.nlm.nih.gov/41327290/' }
    ]
  },

  {
    id: 'cjcnodac',
    name: 'CJC-1295 no-DAC',
    fullName: 'CJC-1295 no-DAC (MOD GRF 1-29)',
    category: 'performance',
    emoji: '💪',
    tagline: 'Short-acting GHRH analogue — mimicking natural pulsatile GH secretion',
    notable: "CJC-1295 without DAC (Modified GRF 1-29) has a 30-minute half-life — nearly identical to natural GHRH. This allows precise timing: inject immediately before sleep to time the GH pulse with natural overnight secretion. When paired with Ipamorelin, the combined GHRH + GHRP signal produces synergistic GH output greater than either alone.",
    confidence: 'HIGH',
    inStock: true,
    benefits: ['Pulsatile GH stimulation','Natural GH rhythm preservation','Synergy with GHRPs','Lean mass support','Anti-aging GH benefits','Short half-life — better mimics physiology'],
    description: 'CJC-1295 without DAC (also called MOD GRF 1-29) is a stabilized GHRH(1-29) analogue with a short half-life (~30 minutes). Unlike CJC-1295 with DAC which creates prolonged GH elevation, the no-DAC version works synergistically with GHRPs to create amplified, physiologically timed GH pulses. Preferred by those who want to maintain natural GH pulsatility rather than constant elevation.',
    mechanism: 'Binds and activates GHRH receptors in the pituitary somatotrophs. Short half-life (~30 min) means GH elevation is pulsatile and time-limited. Synergizes powerfully with GHRP-6, Ipamorelin, or Hexarelin — GHRH + GHRP together amplify GH release substantially more than either alone.',
    dose: '0.1–0.2mg per injection',
    frequency: '2–3x daily (combined with a GHRP)',
    duration: '4–12 weeks',
    reconstitution: {
      bacWater: '2mL',
      vialSize: '2mg',
      concentration: '1,000mcg/mL',
      steps: [
        'Add 2mL BAC water to 2mg vial',
        'Swirl gently',
        '1,000mcg per mL',
        'Typically combined in same syringe as GHRP of choice'
      ],
      syringeTable: [
        { dose: '100mcg', units: 10, ml: '0.10mL' },
        { dose: '200mcg', units: 20, ml: '0.20mL' }
      ]
    },
    storage: 'Refrigerate after reconstitution. Use within 28 days.',
    sideEffects: ['Water retention (dose-dependent)', 'Hunger (milder than GHRP-6)', 'Tingling/numbness', 'Mild fatigue after injection'],
    burnWarning: false,
    flushWarning: false,
    faq: [
      { q: 'CJC with DAC vs CJC no-DAC — which is better?', a: 'Depends on protocol preference. CJC with DAC (DAC = Drug Affinity Complex) has a 1–2 week half-life and provides continuous GH elevation. CJC no-DAC mimics natural pulsatility. Most researchers prefer CJC no-DAC + GHRP for more physiological GH patterns.' },
      { q: 'What GHRP pairs best with CJC no-DAC?', a: 'For GH pulse amplification: CJC no-DAC + Ipamorelin is the cleanest stack (selective, minimal sides). For maximum GH + appetite: CJC no-DAC + GHRP-6. For maximum GH overall: CJC no-DAC + Hexarelin.' },
      { q: 'Can I combine CJC no-DAC and CJC with DAC?', a: 'Not typically recommended — they work via the same receptor and combining does not significantly increase effect but complicates the protocol.' }
    ],
    research: [
      { title: 'CJC-1295 (GHRH analogue) — pharmacokinetics and GH-releasing effects', journal: 'Journal of Clinical Endocrinology & Metabolism, 2006', url: 'https://pubmed.ncbi.nlm.nih.gov/16822798/' }
    ]
  },

  {
    id: 'humanin',
    name: 'Humanin',
    fullName: 'Humanin (Mitochondrial-Derived Peptide)',
    category: 'antiaging',
    emoji: '✨',
    tagline: 'Mitochondrial survival signal — protecting neurons and cells from age-related death',
    notable: "Humanin is a mitochondria-derived peptide (MDP) discovered in 2001 in the coding region of the 16S ribosomal RNA — the opposite strand of mitochondrial DNA. It was identified while researching Alzheimer's disease, when researchers found it blocked neuronal death caused by amyloid-β. Cytoprotective effects have since been shown in cardiac, neuronal, and metabolic tissue.",
    confidence: 'MEDIUM',
    inStock: true,
    benefits: ['Neuroprotection (Alzheimer\'s model)', 'Insulin sensitivity improvement', 'Mitochondrial protection', 'Anti-apoptotic signaling', 'Cardiovascular protection', 'IGF-1 axis modulation'],
    description: 'Humanin is a 21-amino acid mitochondrial-derived peptide (MDP) encoded within the mitochondrial 16S rRNA gene. It is released under cellular stress and acts as a survival signal. Declining Humanin levels correlate with aging, Alzheimer\'s disease, and metabolic dysfunction. Research shows it protects neurons from amyloid-β toxicity, improves insulin sensitivity, and reduces inflammation.',
    mechanism: 'Binds FPRL1/FPR2 and gp130/CNTFR/WSX-1 receptors. Activates JAK2/STAT3 and PI3K/Akt survival pathways. Inhibits cytochrome c release and caspase-3 activation (anti-apoptotic). Blocks amyloid-β peptide toxicity in neurons. Modulates IGF-1 signaling and insulin sensitivity.',
    dose: '0.05–0.2mg per injection (0.5–2mg/week total)',
    frequency: '3–5x weekly',
    duration: '4–8 week cycles',
    reconstitution: {
      bacWater: '2mL',
      vialSize: '5mg',
      concentration: '2,500mcg/mL',
      steps: [
        'Add 2mL BAC water to 5mg vial',
        'Swirl gently',
        '2,500mcg per mL'
      ],
      syringeTable: [
        { dose: '2mg', units: 80, ml: '0.80mL' },
        { dose: '4mg', units: 160, ml: '1.60mL' }
      ]
    },
    storage: 'Refrigerate after reconstitution. Use within 28 days.',
    sideEffects: ['Generally well tolerated in research contexts', 'Injection site reactions', 'Limited long-term human safety data'],
    burnWarning: false,
    flushWarning: false,
    faq: [
      { q: 'What is a mitochondrial-derived peptide?', a: 'MDPs like Humanin are peptides encoded within mitochondrial DNA — historically thought to code only for components of the respiratory chain. The discovery that mitochondria produce signaling peptides was a major paradigm shift in cell biology.' },
      { q: 'Is Humanin related to MOTS-C?', a: 'Yes — both are mitochondrial-derived peptides from the 12S and 16S rRNA genes respectively. MOTS-C focuses more on metabolic regulation; Humanin focuses more on neuronal survival and apoptosis prevention.' },
      { q: 'Who is a candidate for Humanin research protocols?', a: 'Individuals with Alzheimer\'s risk factors, age-related cognitive decline, metabolic syndrome, or those building comprehensive longevity protocols alongside Epithalon, SS-31, and MOTS-C.' }
    ],
    research: [
      { title: 'Humanin — a novel neuroprotective factor against Alzheimer\'s disease', journal: 'Proceedings of the National Academy of Sciences, 2001', url: 'https://pubmed.ncbi.nlm.nih.gov/11752479/' },
      { title: 'Humanin improves insulin resistance and prevents type 2 diabetes in mice', journal: 'Cell Metabolism, 2013', url: 'https://pubmed.ncbi.nlm.nih.gov/23562079/' },
      { title: 'S14G-Humanin ameliorates ovarian dysfunction in a cyclophosphamide-induced premature ovarian insufficiency mouse model', journal: 'Molecular Human Reproduction, 2025', url: 'https://pubmed.ncbi.nlm.nih.gov/40811024/' },
      { title: 'Oligoasthenozoospermia is alleviated in a mouse model by [Gly14]-humanin-mediated attenuation of oxidative stress and ferroptosis', journal: 'Andrology, 2025', url: 'https://pubmed.ncbi.nlm.nih.gov/39435863/' }
    ]
  },

  {
    id: 'follistatin344',
    name: 'Follistatin 344',
    fullName: 'Follistatin 344 (FST-344)',
    category: 'performance',
    emoji: '💪',
    tagline: 'Myostatin inhibitor — unlocking muscle growth potential beyond normal limits',
    notable: "Follistatin 344 is a myostatin inhibitor — it blocks the protein that limits muscle growth. Without myostatin inhibition, mammals have a genetic ceiling on muscle mass. Studies in primates showed follistatin gene therapy doubled muscle mass. The peptide version produces more modest but measurable increases in lean mass by partially releasing this ceiling.",
    confidence: 'LOW',
    inStock: true,
    benefits: ['Myostatin inhibition', 'Extraordinary muscle hypertrophy potential', 'Lean mass preservation', 'Anti-catabolic', 'Activin A blockade', 'Research-grade muscle development'],
    description: 'Follistatin-344 is a glycoprotein that binds and inhibits myostatin (GDF-8) and activin A — two powerful negative regulators of muscle mass. By blocking these "muscle brakes," Follistatin-344 removes natural limits on skeletal muscle growth. Effects are dramatic in animal studies. Human research is extremely limited, and this is among the most experimental compounds in this category.',
    mechanism: 'Binds and sequesters myostatin (GDF-8) and activin A in extracellular space, preventing their binding to ActRII receptors. Myostatin is the primary endogenous inhibitor of muscle mass. Blockade results in dramatic skeletal muscle hypertrophy and hyperplasia, as demonstrated in myostatin knockout animals.',
    dose: '0.025–0.1mg/day',
    frequency: 'Once daily',
    duration: '10–30 day cycles maximum (concerns re: localized effect)',
    reconstitution: {
      bacWater: '1mL',
      vialSize: '1mg',
      concentration: '1,000mcg/mL',
      steps: [
        'Add 1mL BAC water to 1mg vial',
        'Swirl gently — extremely carefully',
        '1,000mcg per mL',
        'Use insulin syringe for precise small-volume dosing'
      ],
      syringeTable: [
        { dose: '25mcg', units: 2.5, ml: '0.025mL' },
        { dose: '50mcg', units: 5, ml: '0.05mL' },
        { dose: '100mcg', units: 10, ml: '0.10mL' }
      ]
    },
    storage: 'Refrigerate immediately. Highly sensitive protein — use within 14 days. Keep from all temperature extremes.',
    sideEffects: ['Local muscle overgrowth at injection site', 'Potential systemic effects on cardiac muscle (concern)', 'No long-term human safety data', 'Tendon adaptation lag — rapid muscle growth may exceed tendon strength'],
    burnWarning: false,
    flushWarning: false,
    faq: [
      { q: 'Are the muscle gains from Follistatin permanent?', a: 'Animal data suggests hyperplasia (new muscle fibers) is long-lasting. Hypertrophy effects may require continued use. Human data is extremely limited.' },
      { q: 'What about cardiac muscle?', a: 'This is a real concern — myostatin inhibition affects all muscle tissue including cardiac muscle. Follistatin can theoretically cause cardiac hypertrophy. This warrants cardiovascular monitoring with any use.' },
      { q: 'Why is confidence LOW?', a: 'Human clinical evidence is essentially absent. All dramatic results come from animal studies. The mechanism is sound — myostatin inhibition works — but dose, safety, and long-term effects in humans are poorly characterized.' }
    ],
    research: [
      { title: 'Follistatin-induced muscle hypertrophy — role of myostatin inhibition', journal: 'Developmental Cell, 2002', url: 'https://pubmed.ncbi.nlm.nih.gov/11970895/' }
    ]
  },

  {
    id: 'glutathione',
    name: 'Glutathione',
    fullName: 'Glutathione (L-Glutathione / GSH)',
    category: 'antiaging',
    emoji: '✨',
    tagline: 'The master antioxidant — defending every cell in your body',
    notable: "Glutathione is the master antioxidant — produced naturally by every cell, it is the primary defense against oxidative stress and the detoxification of heavy metals and environmental toxins. Injectable glutathione bypasses the digestive destruction that makes oral supplementation largely ineffective, delivering it directly to the circulation and cells that need it most.",
    confidence: 'HIGH',
    inStock: true,
    benefits: ['Master antioxidant activity', 'Detoxification (Phase II liver)', 'Immune system support', 'Skin brightening', 'Mercury and heavy metal chelation', 'Mitochondrial protection', 'Anti-inflammatory'],
    description: 'Glutathione is the body\'s primary endogenous antioxidant — a tripeptide (Glu-Cys-Gly) found in virtually every cell. It neutralizes reactive oxygen species, conjugates toxins for elimination, regenerates vitamins C and E, and supports T-cell function. Injectable glutathione bypasses poor oral bioavailability for direct cellular delivery.',
    mechanism: 'Acts as the primary intracellular reducing agent. Directly scavenges hydroxyl radicals, peroxynitrite, and hydrogen peroxide. Conjugates with reactive toxins via glutathione-S-transferase for Phase II detox. Regenerates oxidized ascorbate (Vitamin C). Maintains thiol redox balance. Supports NK cell and T-cell activity.',
    dose: '200–600mg per session',
    frequency: '2–5x weekly (IV preferred; SubQ acceptable)',
    duration: 'Ongoing — safe for long-term use',
    reconstitution: {
      bacWater: '2mL',
      vialSize: '600mg',
      concentration: '300mg/mL',
      steps: [
        'Add 2mL BAC water to 600mg vial',
        'Swirl gently until dissolved',
        '300mg per mL',
        'IV push: dilute in 20–50mL normal saline, push slowly over 5–10 min'
      ],
      syringeTable: [
        { dose: '200mg', units: 67, ml: '0.67mL' },
        { dose: '400mg', units: 133, ml: '1.33mL' },
        { dose: '600mg', units: 200, ml: '2.00mL' }
      ]
    },
    storage: 'Refrigerate after reconstitution. Use within 24–48 hours (unstable once reconstituted — oxidizes). Protect completely from light.',
    sideEffects: ['Generally very well tolerated', 'Mild nausea (rare)', 'Skin lightening with high-frequency use (mechanism: melanin inhibition)', 'Zinc depletion with prolonged use — supplement zinc'],
    burnWarning: false,
    flushWarning: false,
    faq: [
      { q: 'Why injectable rather than oral?', a: 'Oral glutathione is poorly absorbed — digestive enzymes break it down significantly. Injectable (IV or SubQ) delivers it directly into the bloodstream for immediate cellular uptake.' },
      { q: 'Does glutathione actually lighten skin?', a: 'Yes — at high doses and frequencies, glutathione inhibits tyrosinase, reducing melanin synthesis. Skin brightening is a documented effect. Effects are dose-dependent and reversible if use is discontinued.' },
      { q: 'Can I mix glutathione with NAD+?', a: 'Not in the same syringe — they can react. Separate injections are recommended. However, using both in the same session (separate syringes) is common and creates a powerful cellular energy + antioxidant protocol.' }
    ],
    research: [
      { title: 'Glutathione metabolism and its implications for health', journal: 'Journal of Nutrition, 2004', url: 'https://pubmed.ncbi.nlm.nih.gov/15113738/' },
      { title: 'The role of glutathione in aging and disease', journal: 'Free Radical Biology and Medicine, 2000', url: 'https://pubmed.ncbi.nlm.nih.gov/10719244/' }
    ]
  },

  {
    id: 'thymalin',
    name: 'Thymalin',
    fullName: 'Thymalin (Thymus Bioregulator)',
    category: 'immune',
    emoji: '🛡️',
    tagline: 'Thymus gland restorer — rebuilding the master organ of immune youth',
    notable: "Thymalin is a peptide bioregulator isolated from bovine thymus gland — part of Vladimir Khavinson's 35+ year research program showing that tissue-specific peptide bioregulators can slow aging in their target organs. Published research shows Thymalin restored immune function in elderly subjects to levels comparable to middle-aged controls.",
    confidence: 'MEDIUM',
    inStock: true,
    benefits: ['Thymus gland bioregulation', 'T-cell production restoration', 'Immune system rejuvenation', 'Anti-aging immune support', 'Thymosin family modulation', 'Longevity protocol component'],
    description: 'Thymalin is a polypeptide bioregulator extracted from calf thymus tissue, developed by the Khavinson Institute. The thymus — the master gland for T-cell education — involutes (shrinks) dramatically with age. Thymalin normalizes thymus function, restores T-cell output, and improves immune surveillance. Used in Russian longevity protocols alongside Epithalon for decades.',
    mechanism: 'Polypeptide extract (primarily dipeptide Glu-Asp active fraction) that acts as a biological signal for thymic epithelial cells. Stimulates thymocyte proliferation and differentiation, restores thymosin production, and normalizes the ratio of T-helper to T-suppressor cells. Reduces inflammatory cytokines associated with immunosenescence.',
    dose: '5–10mg/day',
    frequency: 'Once daily for a defined cycle',
    duration: '10-day injection cycles, 1–2x per year',
    reconstitution: {
      bacWater: '1mL',
      vialSize: '10mg',
      concentration: '10mg/mL',
      steps: [
        'Add 1mL BAC water to 10mg vial',
        'Swirl gently',
        '10mg per mL'
      ],
      syringeTable: [
        { dose: '5mg', units: 50, ml: '0.50mL' },
        { dose: '10mg', units: 100, ml: '1.00mL' }
      ]
    },
    storage: 'Refrigerate after reconstitution. Use within 28 days.',
    sideEffects: ['Generally well tolerated — extensive use in Russian clinical settings', 'Mild injection site reactions', 'Temporary immune activation response (flu-like — rare)'],
    burnWarning: false,
    flushWarning: false,
    faq: [
      { q: 'How does Thymalin differ from Thymosin Alpha-1?', a: 'Thymalin is a broad thymus bioregulator — it restores overall thymus function and T-cell production. Thymosin Alpha-1 (TA1) is a specific, isolated peptide that directly stimulates NK cells and T-cells. Both support immune function via different mechanisms.' },
      { q: 'What is the typical cycle?', a: 'The Khavinson Institute protocol typically involves 10-day injection courses, 1–2 times per year, often combined with Epithalon for a comprehensive longevity protocol.' },
      { q: 'Is Thymalin safe for autoimmune conditions?', a: 'Use with caution — immune modulation can potentially exacerbate autoimmune conditions. Consult with a physician before using Thymalin if you have any autoimmune diagnosis.' }
    ],
    research: [
      { title: 'Thymalin — effects on immune function and longevity in aging populations', journal: 'Annals of the New York Academy of Sciences, 2005', url: 'https://pubmed.ncbi.nlm.nih.gov/16387712/' },
      { title: 'Reparative osteogenesis in mandible in cases of filling a bone defect with hydroxyapatite-containing osteotropic material and injecting the surrounding soft tissues with thymalin: experimental and morphological study', journal: 'Wiadomosci Lekarskie, 2024', url: 'https://pubmed.ncbi.nlm.nih.gov/38431810/' },
      { title: 'Expression features of T-lymphocytes, B-lymphocytes and macrophages in the post-traumatic regenerate of the mandible rats under conditions of filling a bone defect with hydroxyapatite-containing osteotropic material and thymalin injecting the surrounding soft tissues', journal: 'Polski Merkuriusz Lekarski, 2024', url: 'https://pubmed.ncbi.nlm.nih.gov/38642352/' }
    ]
  },

  {
    id: 'thymogen',
    name: 'Thymogen',
    fullName: 'Thymogen (Glu-Trp Thymus Dipeptide)',
    category: 'immune',
    emoji: '🛡️',
    tagline: 'Thymic dipeptide — precise immune T-cell activation signal',
    notable: "Thymogen (Glu-Trp) is a dipeptide immunomodulator — two amino acids that stimulate T-lymphocyte differentiation and proliferation. Despite its simplicity (only 2 amino acids), published research shows significant immune restoration effects, with clinical use in Russia for immune deficiency states and post-chemotherapy recovery.",
    confidence: 'MEDIUM',
    inStock: true,
    benefits: ['T-cell activation', 'Thymopoietin-mimetic activity', 'Immune restoration', 'Anti-infective support', 'Intranasal delivery option', 'Khavinson bioregulator'],
    description: 'Thymogen is a synthetic dipeptide (Glu-Trp) that mimics the active site of thymopoietin — a natural thymic hormone. It stimulates T-cell differentiation and maturation, enhances immune surveillance, and is used in the treatment of immune deficiency states in Eastern European medical practice. Available as injectable or intranasal formulation.',
    mechanism: 'Dipeptide Glu-Trp mimics the active pentapeptide sequence of thymopoietin. Binds to thymopoietin receptors on immature thymocytes, stimulating their differentiation into mature T-lymphocytes. Normalizes CD4:CD8 ratio, enhances NK cell activity, and upregulates IL-2 production.',
    dose: '1mg/day (injectable) or 2–3 sprays/day (intranasal)',
    frequency: 'Daily for cycle duration',
    duration: '10–14 day cycles',
    reconstitution: {
      bacWater: '1mL',
      vialSize: '1mg',
      concentration: '1mg/mL',
      steps: [
        'Add 1mL BAC water to 1mg vial',
        'Swirl gently',
        '1mg per mL',
        'Note: Thymogen is also available as nasal spray in clinical settings'
      ],
      syringeTable: [
        { dose: '0.5mg', units: 50, ml: '0.50mL' },
        { dose: '1mg', units: 100, ml: '1.00mL' }
      ]
    },
    storage: 'Refrigerate after reconstitution. Use within 28 days.',
    sideEffects: ['Very well tolerated — extensive Eastern European clinical use', 'Mild local injection site reactions', 'Nasal formulation: mild nasal irritation'],
    burnWarning: false,
    flushWarning: false,
    faq: [
      { q: 'What is the difference between Thymalin and Thymogen?', a: 'Thymalin is a complex polypeptide extract from thymus tissue with broad bioregulating effects. Thymogen (Glu-Trp) is a precise synthetic dipeptide targeting the thymopoietin receptor specifically. Thymogen is more defined; Thymalin is broader-acting.' },
      { q: 'Can Thymogen be taken nasally?', a: 'Yes — intranasal delivery is a validated route for Thymogen used in Russian/Eastern European clinical practice. It provides good systemic bioavailability via nasal mucosa.' },
      { q: 'Who benefits most from Thymogen?', a: 'Individuals with recurrent infections, age-related immune decline, post-viral immune dysfunction, or those building comprehensive immune longevity protocols.' }
    ],
    research: [
      { title: 'Thymogen (Glu-Trp) biological activity and clinical applications', journal: 'Immunology Letters, 1991', url: 'https://pubmed.ncbi.nlm.nih.gov/1917295/' },
      { title: 'Hepatoprotective Effects of Thymogen Analogues in Hydrazine Hepatopathy in Rats', journal: 'Bulletin of Experimental Biology and Medicine, 2025', url: 'https://pubmed.ncbi.nlm.nih.gov/40442470/' }
    ]
  },

  {
    id: 'vip',
    name: 'VIP',
    fullName: 'VIP (Vasoactive Intestinal Peptide)',
    category: 'immune',
    emoji: '🛡️',
    tagline: 'Neuropeptide immune regulator — anti-inflammatory signaling for gut, lung, and brain',
    notable: "VIP (Vasoactive Intestinal Peptide) emerged as a primary research interest during the long COVID era when researchers found VIP deficiency in many post-COVID patients with persistent respiratory and neurological symptoms. It is a potent bronchodilator, neuroprotective agent, and anti-inflammatory — acting simultaneously in the lungs, gut, and brain.",
    confidence: 'MEDIUM',
    inStock: true,
    benefits: ['Potent anti-inflammatory', 'Gut barrier protection', 'Lung anti-inflammatory (CIRS protocol)', 'Neuroinflammation reduction', 'Vasodilation', 'Mast cell regulation'],
    description: 'VIP is a 28-amino acid neuropeptide with potent anti-inflammatory, vasodilatory, and immunomodulatory properties. It acts across the gut, lungs, brain, and immune system. VIP is used in Chronic Inflammatory Response Syndrome (CIRS) protocols, where it addresses neuroinflammation, regulatory T-cell dysfunction, and cytokine dysregulation. Intranasal delivery is most common for CNS effects.',
    mechanism: 'Binds VPAC1 and VPAC2 receptors on immune cells, neurons, and smooth muscle. Inhibits NF-κB, reduces pro-inflammatory cytokines (TNF-α, IL-6, IL-1β), promotes regulatory T-cell (Treg) differentiation. Causes vasodilation via nitric oxide. Crosses blood-brain barrier to reduce neuroinflammation.',
    dose: '0.05–0.2mg/day (intranasal preferred)',
    frequency: 'Once to twice daily',
    duration: '4–12 weeks (CIRS protocols often longer under physician oversight)',
    reconstitution: {
      bacWater: '2mL',
      vialSize: '5mg',
      concentration: '2,500mcg/mL',
      steps: [
        'Add 2mL BAC water to 5mg vial',
        'Swirl gently',
        '2,500mcg per mL',
        'Intranasal: dilute appropriately for nasal atomizer delivery (1:10 for lower concentration)'
      ],
      syringeTable: [
        { dose: '50mcg', units: 2, ml: '0.02mL' },
        { dose: '100mcg', units: 4, ml: '0.04mL' },
        { dose: '200mcg', units: 8, ml: '0.08mL' }
      ]
    },
    storage: 'Refrigerate after reconstitution. Use within 28 days. Sensitive to temperature — do not leave at room temperature.',
    sideEffects: ['Facial flushing (vasodilation effect)', 'Hypotension (blood pressure drop — sit or lie down after dosing)', 'Nausea (rare)', 'Nasal irritation (intranasal route)'],
    burnWarning: false,
    flushWarning: true,
    flushNote: 'VIP causes vasodilation which may produce flushing and a transient drop in blood pressure. Start at the lowest dose and take lying down. Monitor blood pressure.',
    faq: [
      { q: 'What is CIRS and why is VIP used?', a: 'Chronic Inflammatory Response Syndrome (CIRS) — often triggered by mold/mycotoxin exposure — involves dysregulated cytokine production and reduced VIP levels. VIP replacement therapy is a component of Dr. Ritchie Shoemaker\'s CIRS protocol, requiring physician-supervised diagnosis and treatment.' },
      { q: 'Can VIP help with gut issues?', a: 'Yes — VIP regulates intestinal motility, reduces gut inflammation, and protects the intestinal barrier. It is researched for IBD, IBS, and gut-brain axis dysfunction.' },
      { q: 'Is VIP available as a nasal spray?', a: 'Yes — intranasal VIP (as compounded nasal spray) is the most common delivery in CIRS protocols. The reconstituted peptide can be used with a nasal atomizer device for mucosal delivery.' }
    ],
    research: [
      { title: 'Vasoactive intestinal peptide — immune modulation and anti-inflammatory mechanisms', journal: 'Regulatory Peptides, 2005', url: 'https://pubmed.ncbi.nlm.nih.gov/15556255/' },
      { title: 'VIP treatment in inflammatory diseases — current evidence', journal: 'Current Pharmaceutical Design, 2010', url: 'https://pubmed.ncbi.nlm.nih.gov/20222849/' }
    ]
  },

  {
    id: 'bronchogen',
    name: 'Bronchogen',
    fullName: 'Bronchogen (Ala-Glu-Asp-Lys Lung Bioregulator)',
    category: 'healing',
    emoji: '🫁',
    tagline: 'Pulmonary bioregulator — restoring lung tissue gene expression',
    notable: "Bronchogen is a tetrapeptide bioregulator specifically targeting lung and bronchial tissue — developed from Russian peptide bioregulator research. Studies showed it restored bronchial epithelium function in smoking-damaged tissue and reduced markers of chronic bronchitis. Part of the same Khavinson research line that produced Epithalon and Cardiogen.",
    confidence: 'MEDIUM',
    inStock: true,
    benefits: ['Bronchial epithelial cell restoration', 'Lung tissue bioregulation', 'Post-viral lung recovery', 'Chronic respiratory support', 'Khavinson peptide bioregulator', 'Anti-fibrotic potential'],
    description: 'Bronchogen is a short tetrapeptide bioregulator (Ala-Glu-Asp-Lys) targeting bronchial and pulmonary tissue. Developed by the Khavinson Institute, it normalizes gene expression in bronchial epithelial cells, promotes lung tissue regeneration, and is used in respiratory recovery protocols. It belongs to the same bioregulator peptide family as Epithalon, Pinealon, and Cardiogen.',
    mechanism: 'Tetrapeptide (Ala-Glu-Asp-Lys) penetrates bronchial epithelial cell nuclei and interacts with DNA regulatory sequences. Upregulates genes involved in mucociliary clearance, epithelial barrier integrity, and anti-inflammatory processes. Promotes bronchial cell regeneration and normalization of secretory function.',
    dose: '5–10mg/day',
    frequency: 'Once daily',
    duration: '10–30 day cycles',
    reconstitution: {
      bacWater: '2mL',
      vialSize: '10mg',
      concentration: '5mg/mL',
      steps: [
        'Add 2mL BAC water to 10mg vial',
        'Swirl gently',
        '5mg per mL'
      ],
      syringeTable: [
        { dose: '5mg', units: 100, ml: '1.00mL' },
        { dose: '10mg', units: 200, ml: '2.00mL' }
      ]
    },
    storage: 'Refrigerate after reconstitution. Use within 28 days.',
    sideEffects: ['Generally very well tolerated', 'Mild injection site reactions', 'No significant adverse effects in available research'],
    burnWarning: false,
    flushWarning: false,
    faq: [
      { q: 'Who uses Bronchogen?', a: 'Individuals recovering from respiratory illness (including post-viral lung damage), those with chronic respiratory conditions, smokers seeking lung tissue support, or those building comprehensive bioregulator longevity protocols.' },
      { q: 'Is Bronchogen evidence-based?', a: 'Research comes primarily from the Khavinson Institute and Eastern European literature. While not widely studied in Western clinical trials, the bioregulator peptide concept has a substantial body of Russian scientific literature behind it.' },
      { q: 'Can Bronchogen help with COVID lung damage?', a: 'This is an area of research interest given post-COVID lung fibrosis concerns. Early anecdotal reports are promising but controlled clinical evidence in this specific application is not yet available.' }
    ],
    research: [
      { title: 'Peptide bioregulators of the bronchopulmonary system', journal: 'Bulletin of Experimental Biology and Medicine, 2006', url: 'https://pubmed.ncbi.nlm.nih.gov/17380233/' }
    ]
  },

  {
    id: 'adipotide',
    name: 'Adipotide',
    fullName: 'Adipotide (FTPP — Fat-Targeted Proapoptotic Peptide)',
    category: 'weight',
    emoji: '🔥',
    tagline: 'Targeted fat cell eliminator — induces apoptosis in adipose vasculature',
    notable: "Adipotide works through an entirely unique mechanism — it doesn't suppress appetite or inhibit fat metabolism. Instead, it induces apoptosis (programmed cell death) specifically in the blood vessels supplying white adipose tissue, causing fat cells to literally starve to death. Animal studies showed 11% body weight loss in 28 days with high specificity for fat tissue.",
    confidence: 'LOW',
    inStock: true,
    benefits: ['Targeted fat cell apoptosis', 'Visceral fat reduction', 'Adipose blood vessel targeting', 'Rapid fat loss in primate models', 'Metabolic improvement', 'Novel mechanism (not appetite-based)'],
    description: 'Adipotide (FTPP) is an experimental peptidomimetic compound that targets and destroys the blood vessels supplying white adipose tissue. By inducing apoptosis in adipose vasculature, it causes fat cell death through ischemia. Demonstrated striking fat loss in obese rhesus monkeys (11% body weight in 4 weeks). Human data is essentially absent — this is one of the most experimental compounds in this class.',
    mechanism: 'Bispecific peptidomimetic — one domain targets PROHIBITIN on adipose vasculature endothelium; the other domain triggers apoptosis via GRP78 (a proapoptotic pathway). Selective destruction of blood vessels in white fat tissue causes fat cell death through ischemia (loss of blood supply).',
    dose: '0.1mg/kg/day (preclinical dosing — human protocols not established)',
    frequency: 'Daily injection',
    duration: '4 weeks maximum (based on primate protocols)',
    reconstitution: {
      bacWater: '1mL',
      vialSize: '2mg',
      concentration: '2mg/mL',
      steps: [
        'Add 1mL BAC water to 2mg vial',
        'Swirl gently',
        '2mg per mL',
        'Warning: No established human dosing protocol — approach with extreme caution'
      ],
      syringeTable: [
        { dose: '0.5mg', units: 25, ml: '0.25mL' },
        { dose: '1mg', units: 50, ml: '0.50mL' }
      ]
    },
    storage: 'Refrigerate after reconstitution. Use within 28 days.',
    sideEffects: ['Kidney toxicity (nephrotoxicity — observed in primate studies)', 'Significant renal impairment at higher doses', 'No established safe human dose', 'Irreversible fat cell destruction'],
    burnWarning: false,
    flushWarning: false,
    faq: [
      { q: 'Why is confidence LOW for Adipotide?', a: 'Despite compelling primate data, Adipotide has no published human clinical trials. The nephrotoxicity observed in animal studies is a serious concern that halted development. This is purely a research compound.' },
      { q: 'Are the fat loss results permanent?', a: 'In animal models, fat cells destroyed via apoptosis do not regenerate — making results potentially durable. However, remaining fat cells can still hypertrophy with excess caloric intake.' },
      { q: 'Should I use Adipotide?', a: 'Marc would strongly caution against this without physician oversight and baseline kidney function monitoring. The mechanism is powerful but the renal risk profile is not adequately characterized for human use.' }
    ],
    research: [
      { title: 'Targeted apoptosis of adipose vasculature by a proapoptotic peptide — Adipotide', journal: 'Science Translational Medicine, 2011', url: 'https://pubmed.ncbi.nlm.nih.gov/21957243/' }
    ]
  },

  {
    id: 'cagrilintide',
    name: 'Cagrilintide',
    fullName: 'Cagrilintide (Long-Acting Amylin Analogue)',
    category: 'weight',
    emoji: '🔥',
    tagline: 'Long-acting amylin analogue — satiety and metabolic control via a new mechanism',
    notable: "Cagrilintide is an amylin analogue combined with semaglutide in the CagriSema combination trial, showing the most impressive weight loss data ever recorded in a pharmaceutical trial — up to 25% body weight reduction. As a standalone, amylin works through a completely different pathway than GLP-1 — complementary appetite suppression via the area postrema in the brainstem.",
    confidence: 'MEDIUM',
    inStock: true,
    benefits: ['Appetite suppression (amylin pathway)', 'Gastric emptying regulation', 'Glucagon suppression', 'Complementary to GLP-1 mechanisms', 'Once-weekly dosing', 'Metabolic rate support'],
    description: 'Cagrilintide is a long-acting amylin analogue developed by Novo Nordisk. Amylin (IAPP) is co-secreted with insulin from pancreatic beta cells and regulates satiety, gastric emptying, and glucagon. Cagrilintide has a half-life enabling once-weekly dosing. Phase 2/3 trials explore combining it with other GLP-1 agents for enhanced metabolic outcomes.',
    mechanism: 'Activates amylin receptors (calcitonin receptor + RAMP complexes) in the area postrema and hypothalamus. Reduces gastric emptying rate, suppresses post-meal glucagon secretion, and creates central satiety signals complementary to GLP-1. Once-weekly dosing achieved through fatty acid conjugation.',
    dose: '0.3–2.4mg/week (titration protocol)',
    frequency: 'Once weekly SubQ injection',
    duration: 'Long-term metabolic management',
    reconstitution: {
      bacWater: '1mL',
      vialSize: '5mg',
      concentration: '5mg/mL',
      steps: [
        'Add 1mL BAC water to 5mg vial',
        'Swirl gently',
        '5mg per mL',
        'Titrate slowly starting at 0.3mg/week'
      ],
      syringeTable: [
        { dose: '0.3mg', units: 6, ml: '0.06mL' },
        { dose: '1.2mg', units: 24, ml: '0.24mL' },
        { dose: '2.4mg', units: 48, ml: '0.48mL' }
      ]
    },
    storage: 'Refrigerate. Use within 28 days of reconstitution.',
    sideEffects: ['Nausea (common during titration)', 'Vomiting at high doses', 'Decreased appetite (expected)', 'Injection site reactions'],
    burnWarning: false,
    flushWarning: false,
    faq: [
      { q: 'How does Cagrilintide compare to amylin analogues like Pramlintide?', a: 'Pramlintide requires dosing with every meal. Cagrilintide\'s long-acting design enables once-weekly dosing, dramatically improving convenience and adherence.' },
      { q: 'Is Cagrilintide approved?', a: 'Not yet approved as a standalone. Cagrilintide is in late-stage development, including combination trials. It is a research compound for now.' },
      { q: 'Can Cagrilintide stack with GLP-1 compounds?', a: 'This is the active area of research — amylin + GLP-1 co-agonism addresses satiety via complementary central and peripheral pathways, showing additive effects in trials.' }
    ],
    research: [
      { title: 'Cagrilintide — a long-acting amylin analogue for obesity management', journal: 'Lancet, 2021', url: 'https://pubmed.ncbi.nlm.nih.gov/34293296/' }
    ]
  },

  {
    id: 'hcg',
    name: 'HCG',
    fullName: 'HCG (Human Chorionic Gonadotropin)',
    category: 'performance',
    emoji: '⚡',
    tagline: 'LH analogue — restoring testicular function and testosterone production',
    notable: "HCG (Human Chorionic Gonadotropin) directly mimics LH — the pituitary hormone that signals the testes to produce testosterone. This makes it unique: it stimulates endogenous testosterone production while maintaining testicular volume and function. Used clinically in male fertility treatment and as a testosterone replacement alternative for men wishing to preserve fertility.",
    confidence: 'HIGH',
    inStock: true,
    benefits: ['Testicular testosterone stimulation', 'Prevents testicular atrophy', 'Fertility support (male and female)', 'LH receptor activation', 'Post-cycle hormone restoration', 'Anabolic support'],
    description: 'HCG is a glycoprotein hormone that mimics luteinizing hormone (LH), directly stimulating the Leydig cells in the testes to produce testosterone. It is used to maintain testicular size and function during testosterone replacement therapy, to restore hormonal function post-cycle, and in fertility protocols for both men and women. It is FDA-approved for hypogonadism and fertility indications.',
    mechanism: 'Binds LH receptors (LHCGR) on testicular Leydig cells, directly stimulating testosterone synthesis and secretion. Also activates follicular cells in women (FSH-like partial activity). Prevents testicular atrophy associated with exogenous testosterone by maintaining Leydig cell stimulation.',
    dose: '250–500 IU every 2–3 days (maintenance) | 500–1000 IU 3x/week (post-cycle)',
    frequency: 'Every 2–3 days',
    duration: 'Ongoing during TRT | 3–6 weeks post-cycle',
    reconstitution: {
      bacWater: '2mL',
      vialSize: '5,000 IU',
      concentration: '2,500 IU/mL',
      steps: [
        'Add 2mL BAC water (or provided diluent) to 5,000 IU vial',
        'Swirl gently — never shake',
        '2,500 IU per mL'
      ],
      syringeTable: [
        { dose: '250 IU', units: 10, ml: '0.10mL' },
        { dose: '500 IU', units: 20, ml: '0.20mL' },
        { dose: '1000 IU', units: 40, ml: '0.40mL' }
      ]
    },
    storage: 'Refrigerate immediately after reconstitution. Use within 28–60 days. Highly sensitive to heat — never leave unrefrigerated.',
    sideEffects: ['Fluid retention (dose-dependent)', 'Gynecomastia (estrogen conversion in testes)', 'Acne at high doses', 'Headache', 'Mood changes'],
    burnWarning: false,
    flushWarning: false,
    faq: [
      { q: 'Does HCG restart natural testosterone production?', a: 'HCG stimulates Leydig cells directly (LH analogue) but does not restart the HPG axis upstream. Kisspeptin → GnRH → LH is the true upstream restart. HCG is often used during TRT to prevent atrophy, and with Kisspeptin/clomiphene post-cycle for full axis restoration.' },
      { q: 'Can women use HCG?', a: 'Yes — HCG is used in women for ovulation induction as part of fertility protocols. It triggers the LH surge needed for follicular rupture and ovulation.' },
      { q: 'Should I use an aromatase inhibitor with HCG?', a: 'Potentially — HCG causes testosterone production in the testes, and testes convert testosterone to estradiol more than peripheral tissue. Monitor estrogen levels and use an AI if needed.' }
    ],
    research: [
      { title: 'Human chorionic gonadotropin and male hypogonadism — clinical applications', journal: 'Journal of Clinical Endocrinology & Metabolism, 2005', url: 'https://pubmed.ncbi.nlm.nih.gov/15699527/' },
      { title: 'HCG monotherapy for male hypogonadism — a review', journal: 'Fertility and Sterility, 2013', url: 'https://pubmed.ncbi.nlm.nih.gov/23375633/' }
    ]
  },

  {
    id: 'igf1des',
    name: 'IGF-1 DES',
    fullName: 'IGF-1 DES (1-3) — Truncated IGF-1',
    category: 'performance',
    emoji: '💪',
    tagline: 'Ultra-potent local IGF-1 — hyperplasia at the injection site',
    notable: "IGF-1 DES is a truncated version of IGF-1 that cannot bind to IGF binding proteins in the bloodstream — giving it approximately 10x greater potency than standard IGF-1 at the tissue level. This hyperlocal potency is why it is typically injected intramuscularly near the target tissue: its direct tissue effect is intense but its systemic half-life is extremely short.",
    confidence: 'MEDIUM',
    inStock: true,
    benefits: ['Local muscle hyperplasia', 'Extremely potent (10x native IGF-1)', 'Satellite cell activation', 'Site-specific anabolic effect', 'Short acting — localized activity', 'Protein synthesis stimulation'],
    description: 'IGF-1 DES (also called Des(1-3)IGF-1) is the naturally occurring truncated variant of IGF-1 with the first three amino acids removed. This truncation eliminates binding to IGF-binding proteins, making it 10x more potent than standard IGF-1 at the receptor level. Its extremely short half-life (~minutes) concentrates all activity at the injection site — making it the primary tool for site-specific muscle hyperplasia.',
    mechanism: 'Cannot bind IGFBPs due to N-terminal truncation. Directly binds IGF-1R with 10x higher bioactivity than full IGF-1. Activates PI3K/Akt/mTOR and MAPK pathways. Extremely short half-life means activity is concentrated locally. Promotes satellite cell activation and hyperplasia specifically in injected muscle tissue.',
    dose: '0.05–0.15mg per injection (localized to target muscle)',
    frequency: '1–2x daily (always inject into the target muscle)',
    duration: '4–6 week cycles maximum',
    reconstitution: {
      bacWater: '1mL',
      vialSize: '1mg',
      concentration: '1,000mcg/mL',
      steps: [
        'Add 1mL BAC water to 1mg vial',
        'Swirl gently — fragile protein',
        '1,000mcg per mL',
        'Inject intramuscularly into the target muscle for site-specific effect'
      ],
      syringeTable: [
        { dose: '50mcg', units: 5, ml: '0.05mL' },
        { dose: '100mcg', units: 10, ml: '0.10mL' },
        { dose: '150mcg', units: 15, ml: '0.15mL' }
      ]
    },
    storage: 'Refrigerate immediately. Use within 14 days. Highly sensitive to degradation. Do not refreeze after reconstitution.',
    sideEffects: ['Hypoglycemia (blood sugar drop — have carbs ready)', 'Site-specific water retention', 'Localized inflammation (injection technique important)', 'Potential for uneven muscle development if misused'],
    burnWarning: false,
    flushWarning: false,
    faq: [
      { q: 'Why inject IGF-1 DES into the muscle rather than SubQ?', a: 'IGF-1 DES has an extremely short half-life — activity is highly localized. Intramuscular injection into the target muscle concentrates the anabolic signal exactly where you want hyperplasia.' },
      { q: 'IGF-1 DES vs IGF-1 LR3?', a: 'DES: ultra-short acting, 10x potent, site-specific, hyperplasia focus. LR3: long-acting (20–30 hrs), systemic anabolic activity, lower relative potency at receptor. Use DES for site-specific hyperplasia; LR3 for systemic anabolic support.' },
      { q: 'Can I stack IGF-1 DES with IGF-1 LR3?', a: 'Not recommended simultaneously — both target IGF-1R and may cause desensitization. Use them in separate cycles or alternate timing.' }
    ],
    research: [
      { title: 'Des(1-3)IGF-I potency and binding characteristics compared with IGF-I', journal: 'Endocrinology, 1988', url: 'https://pubmed.ncbi.nlm.nih.gov/3292259/' }
    ]
  },

  {
    id: 'pnc27',
    name: 'PNC-27',
    fullName: 'PNC-27 (p53-HDM2 binding peptide — anti-tumor)',
    category: 'antiaging',
    emoji: '🔬',
    tagline: 'Experimental tumor suppressor peptide — inducing cancer cell necrosis',
    notable: "PNC-27 is a peptide derived from p21 (a cell cycle inhibitor) that selectively inserts into cancer cell membranes — which overexpress the HDM-2 receptor — and induces membrane disruption and apoptosis in cancer cells while leaving normal cells unaffected. Preliminary published research shows it killed leukemia, breast, and pancreatic cancer cells selectively in vitro.",
    confidence: 'LOW',
    inStock: true,
    benefits: ['Selective cancer cell membrane disruption', 'p53 tumor suppressor pathway activation', 'Normal cell protection', 'Anti-tumor research compound', 'Synergistic with conventional therapies (research)', 'Membrane-disrupting mechanism'],
    description: 'PNC-27 is a p53-derived peptide that contains the MDM2-binding domain of the p53 tumor suppressor protein. Research suggests it selectively inserts into tumor cell membranes (which overexpress HDM2 at the surface) and disrupts them — causing necrosis specifically in cancer cells while leaving normal cells unaffected. Entirely experimental with limited human data.',
    mechanism: 'Contains the MDM2-binding domain of p53 (residues 12-26) fused to a penetratin cell-penetrating sequence. Binds HDM2 (overexpressed on tumor cell membranes) and inserts into the tumor cell lipid bilayer, causing membrane disruption and necrosis. Normal cells express minimal surface HDM2 and are spared.',
    dose: 'No established human dose — research protocols vary',
    frequency: 'Research protocols only',
    duration: 'Not established',
    reconstitution: {
      bacWater: '2mL',
      vialSize: '2mg',
      concentration: '1mg/mL',
      steps: [
        'Add 2mL BAC water to 2mg vial',
        'Swirl gently',
        '1mg per mL',
        'CAUTION: No established human dosing — for research purposes only'
      ],
      syringeTable: [
        { dose: 'Research dose', units: 0, ml: 'Per protocol' }
      ]
    },
    storage: 'Refrigerate after reconstitution. Use within 14 days.',
    sideEffects: ['Unknown — no established human safety data', 'Potential for off-target membrane effects at high concentrations', 'Inflammatory responses possible'],
    burnWarning: false,
    flushWarning: false,
    faq: [
      { q: 'Can PNC-27 treat cancer?', a: 'PNC-27 is an experimental research peptide. It has shown anti-tumor activity in cell cultures and animal models, but has not completed human clinical trials. It is not a cancer treatment and should not be used as such.' },
      { q: 'Why offer PNC-27 for research?', a: 'Marc includes PNC-27 in the database for research awareness only. The mechanism of selective tumor cell targeting via HDM2 is scientifically compelling. Individuals engaged in personal research protocols may request it.' },
      { q: 'Is PNC-27 the same as PNC-28?', a: 'Related but different. PNC-27 targets MDM2-binding domain of p53. PNC-28 is a similar p53-derived peptide with slightly different binding properties. Both are experimental with minimal human data.' }
    ],
    research: [
      { title: 'PNC-27 — a p53-derived peptide induces tumor cell necrosis via HDM2 binding', journal: 'Cancer Biology & Therapy, 2009', url: 'https://pubmed.ncbi.nlm.nih.gov/19684498/' }
    ]
  },

  {
    id: 'gcmaf',
    name: 'GcMAF',
    fullName: 'GcMAF (Gc Protein-Derived Macrophage Activating Factor)',
    category: 'immune',
    emoji: '🛡️',
    tagline: 'Macrophage activator — awakening the immune system\'s first responders',
    notable: "GcMAF naturally activates macrophages — the immune system's primary tumor-killing and pathogen-clearing cells. Research suggests cancer cells and some viruses secrete nagalase, which degrades GcMAF, effectively disabling macrophage surveillance. Research protocols aim to restore this immune signal that some diseases actively suppress.",
    confidence: 'LOW',
    inStock: true,
    benefits: ['Macrophage activation', 'NK cell stimulation', 'Anti-tumor immune surveillance', 'Anti-viral immune support', 'Nagalase activity reduction', 'Immune reconstitution'],
    description: 'GcMAF (Gc protein-derived macrophage activating factor) is a naturally occurring protein that activates macrophages — the key phagocytic cells of the innate immune system. The enzyme nagalase (secreted by tumors and viruses) degrades GcMAF, impairing immune surveillance. Research into GcMAF therapy aims to restore macrophage activation in immunocompromised states. Highly controversial — evidence is mixed and sourcing quality is variable.',
    mechanism: 'Gc protein (Vitamin D binding protein) undergoes enzymatic modification to GcMAF. Binds to macrophage surface receptors, activating them to become highly phagocytic and cytotoxic. Stimulates NK cell activity. Reduces nagalase activity (nagalase degrades Gc protein to prevent macrophage activation in cancer).',
    dose: '25–100ng (nanograms) per dose — extremely low quantities',
    frequency: 'Once weekly (standard immune protocol)',
    duration: 'Protocol-dependent — typically months under physician oversight',
    reconstitution: {
      bacWater: 'Special preparation — GcMAF is a protein requiring specific handling',
      vialSize: 'Variable',
      concentration: 'Variable — typically 100ng/mL',
      steps: [
        'GcMAF requires special preparation and cold chain maintenance',
        'Follow supplier-specific reconstitution instructions exactly',
        'This is a protein — handle with extreme care, avoid any agitation',
        'Quality and potency are highly source-dependent — verify supplier carefully'
      ],
      syringeTable: [
        { dose: '25ng', units: 0.25, ml: '0.25mL (from 100ng/mL solution)' },
        { dose: '100ng', units: 1, ml: '1.00mL (from 100ng/mL solution)' }
      ]
    },
    storage: 'Refrigerate at 2–8°C. Do not freeze. Extremely temperature-sensitive protein. Use promptly.',
    sideEffects: ['Flu-like immune activation response (expected)', 'Local injection site reactions', 'Quality and safety vary significantly by source — sourcing critically important'],
    burnWarning: false,
    flushWarning: false,
    faq: [
      { q: 'Is GcMAF proven to work?', a: 'Evidence is limited and controversial. Several early studies were retracted. However, the mechanistic rationale — restoring macrophage activation in states of nagalase-mediated immune suppression — is scientifically sound. Marc includes it for research awareness. Approach with significant caution.' },
      { q: 'How do I know if GcMAF is genuine?', a: 'Quality and authenticity vary enormously by source. GcMAF is a complex protein that is difficult to produce and verify. If pursuing this compound, work with a physician who can monitor nagalase levels and immune markers.' },
      { q: 'What is nagalase?', a: 'Nagalase (alpha-N-acetylgalactosaminidase) is an enzyme secreted by tumors and viruses that degrades Gc protein, blocking the production of GcMAF and thereby impairing macrophage activation. Testing nagalase levels can indicate immune suppression burden.' }
    ],
    research: [
      { title: 'Gc protein-derived macrophage activating factor — a review of its biological activities', journal: 'Anticancer Research, 2008', url: 'https://pubmed.ncbi.nlm.nih.gov/18507067/' }
    ]
  },

  {
    id: 'teriparatide',
    name: 'Teriparatide',
    fullName: 'Teriparatide (PTH 1-34, Forteo)',
    category: 'healing',
    emoji: '🦴',
    tagline: 'FDA-approved bone anabolic — stimulating new bone formation',
    notable: "GcMAF (Gc protein-derived Macrophage Activating Factor) is a naturally occurring protein that activates macrophages — the immune system's primary tumor-killing and pathogen-clearing cells. Research suggests cancer cells and some viruses secrete nagalase, which degrades GcMAF, effectively disabling macrophage surveillance. Research protocols aim to restore this suppressed immune signal.",
    confidence: 'HIGH',
    inStock: true,
    benefits: ['Bone density increase (anabolic — builds new bone)', 'Fracture risk reduction', 'Osteoporosis treatment', 'Spinal bone mass increase', 'FDA-approved indication', 'Activates osteoblasts (bone builders)'],
    description: 'Teriparatide is the synthetic 1-34 N-terminal fragment of human parathyroid hormone (PTH). Unlike bisphosphonates which prevent bone loss, Teriparatide is an anabolic bone agent — it actually builds new bone by stimulating osteoblast activity. FDA-approved (Forteo) for osteoporosis in high-fracture-risk individuals. The most evidence-backed bone building agent available.',
    mechanism: 'Activates PTH1R (PTH/PTHrP receptor) on osteoblasts, stimulating new bone matrix formation. Intermittent dosing activates osteoblasts more than osteoclasts — net anabolic effect. Increases markers of bone formation (P1NP, osteocalcin) and bone mineral density, particularly in spine and hip.',
    dose: '0.02mg/day SubQ injection',
    frequency: 'Once daily',
    duration: 'Maximum 24 months lifetime use (FDA label)',
    reconstitution: {
      bacWater: 'Pre-filled pen device (clinical form)',
      vialSize: '600mcg/2.4mL pre-filled pen',
      concentration: '250mcg/mL',
      steps: [
        'Clinical form: pre-filled injection pen — follow pen instructions',
        'Research vial form: add 2mL BAC water to vial',
        'Swirl gently — do not shake',
        '250mcg per mL in research reconstituted form'
      ],
      syringeTable: [
        { dose: '20mcg', units: 8, ml: '0.08mL' }
      ]
    },
    storage: 'Refrigerate immediately (2–8°C). Pen: use within 28 days after first use. Very temperature sensitive.',
    sideEffects: ['Hypercalcemia (elevated calcium — monitor blood calcium)', 'Nausea', 'Dizziness on standing', 'Leg cramps', 'Osteosarcoma warning (black box) — limit to 24 months total lifetime use'],
    burnWarning: false,
    flushWarning: false,
    faq: [
      { q: 'Why is Teriparatide limited to 24 months?', a: 'Teriparatide carries an FDA black box warning for osteosarcoma based on rat studies showing increased incidence with high doses. This risk has not been definitively demonstrated in humans at clinical doses, but the label restricts lifetime use to 24 months as a precaution.' },
      { q: 'Is Teriparatide better than bisphosphonates?', a: 'For severe osteoporosis with high fracture risk, Teriparatide is generally considered superior because it builds new bone (anabolic) rather than just slowing resorption. After Teriparatide treatment, transitioning to bisphosphonates preserves the gains.' },
      { q: 'Can Teriparatide help fracture healing?', a: 'Research suggests yes — Teriparatide accelerates fracture healing by stimulating osteoblast activity. Some surgeons and physicians use it off-label to accelerate union in difficult fractures.' }
    ],
    research: [
      { title: 'Effect of recombinant human PTH (1-34) on vertebral and non-vertebral fractures', journal: 'New England Journal of Medicine, 2001', url: 'https://pubmed.ncbi.nlm.nih.gov/11794152/' },
      { title: 'Teriparatide treatment of established osteoporosis — long-term efficacy', journal: 'Journal of Bone and Mineral Research, 2009', url: 'https://pubmed.ncbi.nlm.nih.gov/19016581/' }
    ]
  },

  {
    id: 'prostamax',
    name: 'Prostamax',
    fullName: 'Prostamax (Ala-Glu-Asp-Gln Prostate Bioregulator)',
    category: 'healing',
    emoji: '🔬',
    tagline: 'Prostate tissue bioregulator — supporting gland health and urinary function',
    notable: "Prostamax is a peptide bioregulator specifically targeting prostate tissue, developed from the same Khavinson research program as Epithalon and Thymalin. Published research in Russian journals showed it reduced PSA levels, improved urinary flow, and reduced prostate inflammation markers in men with benign prostatic hyperplasia over 6-month protocols.",
    confidence: 'MEDIUM',
    inStock: true,
    benefits: ['Prostate tissue bioregulation', 'Urinary flow improvement', 'BPH-related symptom support', 'Prostate cell normalization', 'Khavinson bioregulator protocol', 'Anti-inflammatory at prostate level'],
    description: 'Prostamax is a short tetrapeptide bioregulator (Ala-Glu-Asp-Gln) targeting prostate gland tissue. Developed by the Khavinson Institute, it normalizes prostate epithelial cell gene expression, promotes healthy tissue function, and has been studied for benign prostatic hyperplasia (BPH) support and age-related prostate decline. Part of the Khavinson bioregulator longevity system.',
    mechanism: 'Tetrapeptide (Ala-Glu-Asp-Gln) penetrates prostate cell nuclei and interacts with regulatory DNA sequences. Normalizes prostate-specific gene expression, reduces inflammatory mediator production in prostatic tissue, and promotes normalization of PSA expression and cell cycle regulation.',
    dose: '5–10mg/day',
    frequency: 'Once daily',
    duration: '10–30 day cycles, 1–2x per year',
    reconstitution: {
      bacWater: '2mL',
      vialSize: '10mg',
      concentration: '5mg/mL',
      steps: [
        'Add 2mL BAC water to 10mg vial',
        'Swirl gently',
        '5mg per mL'
      ],
      syringeTable: [
        { dose: '5mg', units: 100, ml: '1.00mL' },
        { dose: '10mg', units: 200, ml: '2.00mL' }
      ]
    },
    storage: 'Refrigerate after reconstitution. Use within 28 days.',
    sideEffects: ['Very well tolerated based on Khavinson Institute data', 'Mild injection site reactions', 'No significant adverse effects reported in available literature'],
    burnWarning: false,
    flushWarning: false,
    faq: [
      { q: 'Who is Prostamax designed for?', a: 'Men experiencing age-related prostate concerns, BPH (benign prostatic hyperplasia), urinary flow issues, or those building comprehensive male longevity bioregulator protocols.' },
      { q: 'Should this replace urological evaluation?', a: 'Absolutely not — any prostate symptoms should be evaluated by a urologist. Prostamax is a research peptide bioregulator and does not replace PSA monitoring, prostate exams, or medical treatment.' },
      { q: 'Is this related to Saw Palmetto or Finasteride?', a: 'No — different mechanism entirely. Saw Palmetto and Finasteride modulate 5-alpha reductase (DHT conversion). Prostamax is a nuclear-penetrating peptide bioregulator that modulates prostate tissue gene expression directly.' }
    ],
    research: [
      { title: 'Peptide bioregulators of the prostate — Khavinson Institute research', journal: 'Bulletin of Experimental Biology and Medicine, 2004', url: 'https://pubmed.ncbi.nlm.nih.gov/15199376/' }
    ]
  },

  {
    id: 'melittin',
    name: 'Melittin',
    fullName: 'Melittin (Bee Venom Primary Peptide)',
    category: 'immune',
    emoji: '🐝',
    tagline: 'Bee venom\'s active peptide — antimicrobial, anti-tumor, and anti-inflammatory',
    notable: "Melittin — the primary active component of bee venom — has shown direct cancer cell membrane disruption in published research, with selective toxicity toward cancer cells at concentrations that spare normal cells. The Mayo Clinic published findings in 2020 showing melittin destroyed triple-negative breast cancer and HER2-enriched breast cancer cells with high precision.",
    confidence: 'LOW',
    inStock: true,
    benefits: ['Anti-tumor membrane disruption', 'Antimicrobial activity', 'Anti-inflammatory (at low doses)', 'Lyme-related spirochete disruption (research)', 'Apoptosis induction in cancer cells', 'Arthritis pain modulation'],
    description: 'Melittin is the primary active component of honey bee venom — a 26-amino acid amphipathic peptide that disrupts cell membranes. At high concentrations it causes non-selective membrane lysis (toxicity). At low, targeted concentrations it shows anti-tumor, antimicrobial, and anti-inflammatory properties. Used in apitherapy research and Lyme disease protocols. Extremely potent — requires highly precise dosing.',
    mechanism: 'Amphipathic alpha-helix structure inserts into lipid bilayers and disrupts membrane integrity. At low doses: activates phospholipase A2, stimulates cortisol release, and has anti-inflammatory effects via glucocorticoid pathway. At higher concentrations: non-selective membrane lysis. Disrupts bacterial and tumor cell membranes preferentially over healthy mammalian cells (lipid composition difference).',
    dose: '0.0001–0.001mg/kg (research use only)',
    frequency: 'Highly protocol-specific — not for independent use',
    duration: 'Protocol-specific under physician supervision',
    reconstitution: {
      bacWater: 'Special preparation — melittin requires careful handling',
      vialSize: '1mg',
      concentration: '1mg/mL (research stock)',
      steps: [
        'CAUTION: Melittin is a potent membrane-disrupting peptide',
        'Handle with extreme care — avoid skin contact with concentrated solution',
        'Highly diluted formulations are used clinically (apitherapy)',
        'Not recommended for independent reconstitution — requires physician-guided protocol',
        'Standard research: 1mg vial + 1mL BAC water = 1,000mcg/mL (dilute significantly before use)'
      ],
      syringeTable: [
        { dose: 'Protocol dose', units: 0, ml: 'Per physician protocol' }
      ]
    },
    storage: 'Freeze for long-term storage. Refrigerate in use. Stable if handled correctly.',
    sideEffects: ['Anaphylaxis risk (highest of any compound in this database — test for bee venom allergy first)', 'Severe local pain and inflammation', 'Systemic toxicity at higher doses', 'Not suitable for those with bee venom allergy'],
    burnWarning: true,
    flushWarning: false,
    burnNote: 'Melittin causes significant injection site pain and burning — this is a known and expected property of the compound.',
    faq: [
      { q: 'What is apitherapy?', a: 'Apitherapy is the therapeutic use of bee products (venom, honey, propolis). Bee venom therapy (BVT) using live bee stings has been practiced traditionally for arthritis and inflammatory conditions. Purified melittin is the isolated active component of this approach.' },
      { q: 'Is Melittin safe?', a: 'Melittin is not safe for unsupervised self-administration. It has a narrow therapeutic window, anaphylaxis risk for those with bee venom allergy, and non-selective membrane toxicity at higher doses. Marc strongly recommends physician oversight for any melittin protocol.' },
      { q: 'Why is this included if it\'s so risky?', a: 'Marc includes Melittin in the database for research awareness only. The mechanism for Lyme disease spirochete disruption and selective tumor membrane disruption is scientifically interesting. It is available by special order for research clients working with physicians.' }
    ],
    research: [
      { title: 'Melittin — a venom component with potential therapeutic applications', journal: 'Toxins, 2019', url: 'https://pubmed.ncbi.nlm.nih.gov/31100878/' },
      { title: 'Bee venom melittin inhibits Lyme disease spirochetes', journal: 'bioRxiv (preprint), 2020', url: 'https://pubmed.ncbi.nlm.nih.gov/32511355/' }
    ]
  }
];

// ============================================================
// MERGE dosing protocols + solvent data into each compound
// ============================================================
export const COMPOUNDS = RAW_COMPOUNDS.map(c => {
  const proto = DOSING_PROTOCOLS[c.id];
  const solvent = RECON_SOLVENT_DATA[c.id];
  return {
    ...c,
    ...(proto || {}),
    reconstitution: {
      ...c.reconstitution,
      ...(solvent || {}),
    },
  };
});
