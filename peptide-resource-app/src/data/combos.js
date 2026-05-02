// ============================================================
// MARC'S COMPOUND COMBOS
// Pre-compounded vials and pens — paired compounds with synergy rationale
// ============================================================

export const COMBOS = [

  // ── FLAGSHIP BLENDS ──────────────────────────────────────

  {
    id: 'klow',
    name: 'KLOW — Quad Repair Blend',
    shortName: 'KLOW',
    format: 'freeze-dried-vial',
    formatLabel: 'Freeze-Dried Vial',
    formatEmoji: '🧊',
    emoji: '⭐',
    tagline: 'The foundational healing stack — BPC-157 + TB-500 + KPV + GHK-Cu in one vial',
    category: 'healing',
    inStock: true,
    compounds: [
      { id: 'bpc157',  name: 'BPC-157',  dose: '10mg', emoji: '🩹', role: 'Local tissue repair anchor' },
      { id: 'tb500',   name: 'TB-500',   dose: '10mg', emoji: '🩹', role: 'Systemic healing — works throughout the whole body' },
      { id: 'kpv',     name: 'KPV',      dose: '10mg', emoji: '🌿', role: 'Mast cell stabilizer — controls inflammation + resolves histamine' },
      { id: 'ghkcu',   name: 'GHK-Cu',   dose: '50mg', emoji: '✨', role: 'Connective tissue matrix rebuilder — activates 4,000+ repair genes' },
    ],
    whyTogether: `KLOW is built on one insight: healing is a system, not a single compound. Every compound in this blend addresses a different layer of the repair process simultaneously.

BPC-157 targets the specific injury — whether that's a torn tendon, inflamed gut lining, or damaged nerve. It drives local repair through VEGFR2 and FAK-paxillin pathways, promoting angiogenesis exactly where it's needed.

TB-500 works systemically throughout the entire body. While BPC-157 repairs the site, TB-500 reduces inflammation everywhere, improves flexibility, and accelerates full-body recovery. Together they create a local + systemic healing effect neither achieves alone.

KPV (Lys-Pro-Val) is the anti-inflammatory guardian of the stack. It inhibits NF-κB, stabilizes mast cells, and repairs gut tight junctions — preventing the histamine reactions that derail other peptide protocols. It's also what makes KLOW safe to run long-term.

GHK-Cu rebuilds the structural matrix. Collagen, elastin, basement membrane — GHK-Cu activates over 4,000 genes involved in tissue remodeling. It's the compound that makes the repaired tissue better than it was before injury.

Running all four together means you're addressing repair at every level simultaneously: local, systemic, inflammatory, and structural. That's why KLOW works where single compounds don't.`,
    whySuspension: `KLOW is supplied as a freeze-dried (lyophilized) vial rather than individual vials for a specific reason: the four compounds are co-lyophilized in a stabilized matrix that preserves bioactivity of each peptide individually, prevents cross-degradation during storage, and ensures uniform dosing with every draw. Pre-compounded peptides suspended this way maintain higher bioavailability than individual vials reconstituted at home, because pH optimization, excipient selection, and sterility controls are applied to the combined formulation.`,
    benefits: [
      'Accelerated tissue repair — weeks faster than natural healing',
      'Simultaneous local + systemic healing action',
      'Reduced inflammation at site and systemically',
      'Prevents and resolves histamine reactions',
      'Collagen and connective tissue matrix rebuilding',
      'Gut lining repair and microbiome support',
      'Safe for long-term continuous use',
    ],
    idealFor: [
      'Post-surgery recovery',
      'Chronic injuries that haven\'t healed',
      'Athletes in heavy training',
      'Gut issues (IBD, leaky gut, IBS)',
      'Anyone starting a peptide protocol — foundational layer',
      'Autoimmune conditions with tissue involvement',
    ],
    dosing: 'Standard protocol: KPV 500mcg–1mg/day · BPC-157 250–500mcg/day · GHK-Cu 1mg 3–5x/week · TB-500 2–5mg 2x/week',
    duration: '8–16 weeks',
    research: [
      { title: 'BPC-157: stable gastric peptide in trials for IBD and wound healing', journal: 'Current Pharmaceutical Design, 2018', url: 'https://pubmed.ncbi.nlm.nih.gov/29173160/' },
      { title: 'Thymosin beta-4 accelerates wound healing', journal: 'Annals NY Academy of Sciences, 2012', url: 'https://pubmed.ncbi.nlm.nih.gov/22985322/' },
      { title: 'KPV attenuates inflammation in colitis', journal: 'Gut, 2009', url: 'https://pubmed.ncbi.nlm.nih.gov/19091823/' },
      { title: 'GHK-Cu activates 4,000+ human genes', journal: 'Biochemistry Research International, 2012', url: 'https://pubmed.ncbi.nlm.nih.gov/22550605/' },
    ],
  },

  {
    id: 'glow-10',
    name: 'Glow — 10mg Repair + Skin Blend',
    shortName: 'Glow 10mg',
    format: 'freeze-dried-vial',
    formatLabel: 'Freeze-Dried Vial',
    formatEmoji: '🧊',
    emoji: '✨',
    tagline: 'BPC-157 + TB-500 + GHK-Cu — healing meets skin and anti-aging in one vial',
    category: 'healing',
    inStock: true,
    compounds: [
      { id: 'bpc157', name: 'BPC-157', dose: '10mg', emoji: '🩹', role: 'Local tissue and gut repair' },
      { id: 'tb500',  name: 'TB-500',  dose: '10mg', emoji: '🩹', role: 'Systemic repair and flexibility' },
      { id: 'ghkcu',  name: 'GHK-Cu',  dose: '50mg', emoji: '✨', role: 'Collagen, skin tightening, anti-aging gene activation' },
    ],
    whyTogether: `Glow combines the core healing duo (BPC-157 + TB-500) with GHK-Cu to add a powerful anti-aging and skin quality dimension to a repair protocol.

BPC-157 and TB-500 handle healing from two directions — local and systemic. BPC-157 drives repair at the injury or problem site; TB-500 accelerates full-body recovery, reduces systemic inflammation, and improves tissue flexibility.

GHK-Cu transforms this from a repair blend into a rejuvenation blend. As the body heals, GHK-Cu simultaneously activates over 4,000 genes involved in tissue remodeling — improving collagen density, skin elasticity, hair quality, and wound healing speed. Clients using Glow typically report visible skin improvements alongside the healing benefits.

This is the KLOW blend without KPV — ideal for clients who don't have active histamine concerns or gut issues and want a slightly simpler protocol with a strong anti-aging component.`,
    whySuspension: `Co-lyophilization of BPC-157, TB-500, and GHK-Cu in a single vial preserves the copper-peptide complex that gives GHK-Cu its characteristic blue-green colour and bioactivity. The stabilized freeze-dried matrix prevents oxidative degradation of the copper complex during storage — a concern with individually reconstituted GHK-Cu.`,
    benefits: [
      'Tissue repair + skin quality improvement in one protocol',
      'Collagen and elastin synthesis activation',
      'Improved wound healing speed',
      'Hair quality and density improvement',
      'Systemic anti-inflammatory',
      'DNA repair gene activation',
    ],
    idealFor: [
      'Clients wanting healing + cosmetic improvements together',
      'Post-procedure (aesthetic treatments, surgery)',
      'Anti-aging protocols',
      'Athletes wanting recovery + skin quality',
    ],
    dosing: 'BPC-157 300mcg/day · TB-500 5mg 2x/week · GHK-Cu 1–2mg/day',
    duration: '8–16 weeks',
    research: [
      { title: 'GHK-Cu activates 4,000+ human repair genes', journal: 'Biochemistry Research International, 2012', url: 'https://pubmed.ncbi.nlm.nih.gov/22550605/' },
      { title: 'Thymosin beta-4 accelerates wound healing', journal: 'Annals NY Academy of Sciences, 2012', url: 'https://pubmed.ncbi.nlm.nih.gov/22985322/' },
    ],
  },

  {
    id: 'glow-kpv',
    name: 'Glow + KPV — Full Healing Blend',
    shortName: 'Glow + KPV',
    format: 'freeze-dried-vial',
    formatLabel: 'Freeze-Dried Vial',
    formatEmoji: '🧊',
    emoji: '✨',
    tagline: 'BPC-157 + TB-500 + GHK-Cu + KPV — the complete healing and rejuvenation stack',
    category: 'healing',
    inStock: true,
    compounds: [
      { id: 'bpc157', name: 'BPC-157', dose: '10mg', emoji: '🩹', role: 'Local tissue repair' },
      { id: 'tb500',  name: 'TB-500',  dose: '10mg', emoji: '🩹', role: 'Systemic healing' },
      { id: 'ghkcu',  name: 'GHK-Cu',  dose: '50mg', emoji: '✨', role: 'Anti-aging and collagen rebuilding' },
      { id: 'kpv',    name: 'KPV',     dose: '10mg', emoji: '🌿', role: 'Inflammation control and histamine resolution' },
    ],
    whyTogether: `This is the Glow blend with KPV added — making it the equivalent of KLOW with the same anti-aging and skin focus. KPV completes the healing system by addressing the inflammatory environment that can blunt the effects of the other three compounds.

Without KPV, histamine reactions can reduce tolerance to BPC-157 and GHK-Cu in sensitive clients. KPV resolves this by stabilizing mast cells and repairing gut integrity — the primary source of systemic histamine overactivation. Adding KPV makes this blend suitable for long-term continuous use and appropriate for clients with inflammatory conditions, gut issues, or previous peptide sensitivity.`,
    whySuspension: `Same freeze-dried co-lyophilization benefits as KLOW — all four compounds stabilized together in a single vial for maximum convenience and bioavailability.`,
    benefits: [
      'Complete healing + anti-aging + inflammation control',
      'Safe for sensitive clients and long-term use',
      'Gut healing alongside systemic repair',
      'Collagen and skin quality improvement',
      'Histamine reaction prevention',
    ],
    idealFor: [
      'Clients with gut issues alongside musculoskeletal concerns',
      'Sensitive clients who react to individual compounds',
      'Long-term maintenance protocols',
      'Post-surgical recovery with skin improvement goals',
    ],
    dosing: 'Same as KLOW protocol',
    duration: '8–16 weeks',
    research: [
      { title: 'KPV attenuates inflammation in colitis', journal: 'Gut, 2009', url: 'https://pubmed.ncbi.nlm.nih.gov/19091823/' },
    ],
  },

  // ── PRE-COMPOUNDED PENS ───────────────────────────────────

  {
    id: 'cjc-ipa-pen',
    name: 'CJC-1295 + Ipamorelin Pen',
    shortName: 'CJC/Ipa Pen',
    format: 'pen',
    formatLabel: 'Pre-Compounded Pen',
    formatEmoji: '🖊️',
    emoji: '💪',
    tagline: 'The gold standard GH stack — GHRH + GHRP in one pen for maximum pulsatile release',
    category: 'performance',
    inStock: true,
    compounds: [
      { id: 'cjc',       name: 'CJC-1295 DAC', dose: 'per dose', emoji: '💪', role: 'GHRH signal — tells pituitary to produce GH' },
      { id: 'ipamorelin', name: 'Ipamorelin',   dose: 'per dose', emoji: '💪', role: 'GHRP signal — tells pituitary to release GH now' },
    ],
    whyTogether: `CJC-1295 and Ipamorelin work on two different receptors in the pituitary gland — combining them produces a GH pulse that is significantly larger and more sustained than either compound alone.

CJC-1295 is a GHRH analogue — it binds to growth hormone-releasing hormone receptors in the pituitary and stimulates GH synthesis. Think of it as "stocking the shelves."

Ipamorelin is a GHRP (growth hormone-releasing peptide) — it mimics ghrelin and signals the pituitary to release the GH it has stored. Think of it as "opening the doors."

Together: CJC-1295 increases the GH available in the pituitary; Ipamorelin triggers its release. The combined pulse is 2–5x larger than either alone, while remaining physiological — preserving the natural feedback loop that synthetic HGH destroys.

Ipamorelin was specifically chosen over other GHRPs (GHRP-6, Hexarelin) because it produces zero cortisol spike, zero prolactin elevation, and zero desensitization — making it safe for long-term daily use. The CJC/Ipamorelin pen is the cleanest, most effective GH optimization stack available.`,
    whySuspension: `Pre-compounding CJC-1295 and Ipamorelin in a single pen using a buffered, pH-optimized carrier solution ensures both peptides remain stable together — critical since individual reconstitution in BAC water can produce pH mismatches that reduce potency. The pen format also ensures precise, consistent dosing every injection.`,
    benefits: [
      'Significantly larger GH pulse than either compound alone',
      'Natural, physiological GH release — no feedback suppression',
      'Lean muscle growth and fat reduction',
      'Deep sleep enhancement (GH peaks during slow-wave sleep)',
      'Accelerated recovery between training sessions',
      'Anti-aging effects: skin, hair, joint quality',
      'No cortisol or prolactin elevation (Ipamorelin advantage)',
    ],
    idealFor: [
      'Athletes and fitness clients',
      'Anti-aging protocols',
      'Anyone wanting GH benefits without synthetic HGH risks',
      'Clients with poor sleep or slow recovery',
      'Body recomposition goals',
    ],
    dosing: '200–300mcg Ipamorelin + 1mg CJC-1295 · Inject before bed, fasted · CJC weekly if DAC version',
    duration: '8–16 weeks, then 4 weeks off',
    research: [
      { title: 'CJC-1295 — long-acting GHRH analogue', journal: 'Journal of Clinical Endocrinology & Metabolism, 2006', url: 'https://pubmed.ncbi.nlm.nih.gov/16352683/' },
      { title: 'Ipamorelin — selective GH secretion, no ACTH/cortisol', journal: 'Growth Hormone & IGF Research, 1999', url: 'https://pubmed.ncbi.nlm.nih.gov/10373343/' },
    ],
  },

  {
    id: 'ss31-cardiogen-pen',
    name: 'SS-31 + Cardiogen Pen',
    shortName: 'SS-31/Cardiogen Pen',
    format: 'pen',
    formatLabel: 'Pre-Compounded Pen',
    formatEmoji: '🖊️',
    emoji: '❤️',
    tagline: 'Mitochondrial cardiac protection + heart tissue bioregulator — the heart health stack',
    category: 'antiaging',
    inStock: true,
    compounds: [
      { id: 'ss31',      name: 'SS-31',    dose: 'per dose', emoji: '✨', role: 'Mitochondrial membrane protector — cardioprotection at the cellular level' },
      { id: 'cardiogen', name: 'Cardiogen', dose: 'per dose', emoji: '❤️', role: 'Pineal bioregulator targeting cardiac tissue gene expression' },
    ],
    whyTogether: `SS-31 and Cardiogen address cardiac health from complementary angles — one at the mitochondrial level, one at the gene expression level.

SS-31 (Elamipretide) concentrates in the inner mitochondrial membrane and protects cardiolipin — a phospholipid critical for ATP production and mitochondrial structure. Damaged cardiolipin is a primary driver of cardiac aging and heart failure. SS-31 has shown remarkable results in clinical trials for heart failure, preserving cardiac output and reducing oxidative damage in cardiomyocytes.

Cardiogen is a tetrapeptide bioregulator (Ala-Glu-Asp-Gly) from the Khavinson Institute that specifically modulates gene expression in cardiac tissue. Bioregulators work differently from traditional peptides — they enter the cell nucleus and interact directly with DNA, activating tissue-specific repair and regeneration programs. Cardiogen targets the heart, improving cardiomyocyte function and supporting cardiac tissue integrity.

Together they operate at two different levels of the same system: SS-31 protects the energy production machinery in cardiac mitochondria; Cardiogen activates the gene programs that maintain cardiac tissue structure and function. This makes the combination uniquely comprehensive for cardiac health.`,
    whySuspension: `Both SS-31 and Cardiogen are fragile peptides that benefit significantly from co-formulation in a pH-buffered, excipient-stabilized suspension. The pen format ensures precise microdosing critical for both compounds.`,
    benefits: [
      'Cardiac mitochondrial protection and ATP optimization',
      'Cardiolipin preservation — prevents cardiac aging',
      'Cardiac tissue gene expression optimization',
      'Heart failure prevention and support',
      'Reduced cardiac oxidative stress',
      'Improved cardiomyocyte function',
    ],
    idealFor: [
      'Clients with family history of heart disease',
      'Aging clients (40+) in longevity protocols',
      'Anyone with elevated cardiovascular risk markers',
      'Post-cardiac event recovery (consult physician)',
      'Athletes with high cardiac output demands',
    ],
    dosing: 'SS-31 5–10mg 3x/week · Cardiogen per label · Take 30–60 min before MOTS-C if stacking',
    duration: '8–12 weeks, ongoing for maintenance',
    research: [
      { title: 'SS-31 (Elamipretide) improves cardiac function in heart failure — Phase 2 trial', journal: 'JACC Heart Failure, 2020', url: 'https://pubmed.ncbi.nlm.nih.gov/31926856/' },
    ],
  },

  {
    id: 'vip-motsc-pen',
    name: 'VIP + MOTS-C Pen',
    shortName: 'VIP/MOTS-C Pen',
    format: 'pen',
    formatLabel: 'Pre-Compounded Pen',
    formatEmoji: '🖊️',
    emoji: '🛡️',
    tagline: 'Post-COVID immune restoration + mitochondrial recovery — the long-haul protocol',
    category: 'immune',
    inStock: true,
    compounds: [
      { id: 'vip',   name: 'VIP',    dose: 'per dose', emoji: '🛡️', role: 'Neuro-immune regulator — post-viral immune modulation and lung repair' },
      { id: 'motsc', name: 'MOTS-C', dose: 'per dose', emoji: '✨', role: 'Mitochondrial restoration — metabolic recovery and energy' },
    ],
    whyTogether: `VIP and MOTS-C address the two primary systems disrupted in Long COVID and post-viral syndromes: immune dysregulation and mitochondrial dysfunction.

VIP (Vasoactive Intestinal Peptide) is a neuropeptide with powerful anti-inflammatory and immune-modulating properties. In post-viral conditions, VIP levels are consistently depleted — driving the neuroinflammation, immune overactivation, and lung/gut dysfunction characteristic of Long COVID. VIP receptors are found throughout the immune system, lungs, gut, and brain. Restoring VIP signaling reduces cytokine storm remnants, promotes regulatory T-cell activity, and supports tissue recovery in the organs most affected by viral damage.

MOTS-C addresses the metabolic collapse that accompanies post-viral syndrome. COVID and similar viruses preferentially damage mitochondria — reducing ATP production, increasing oxidative stress, and creating the profound fatigue that defines Long COVID. MOTS-C activates the AMPK pathway and promotes mitochondrial biogenesis, restoring the cellular energy production that post-viral syndrome depletes.

Together: VIP calms the immune system and repairs the inflamed tissues; MOTS-C restores the cellular energy needed for that repair to happen. This is why this combination is specifically offered for post-COVID clients.`,
    whySuspension: `VIP is particularly sensitive to degradation and benefits from co-formulation in a stabilized pen that prevents the oxidative breakdown that occurs rapidly when VIP is individually reconstituted.`,
    benefits: [
      'Post-COVID immune system recalibration',
      'Neuroinflammation reduction',
      'Lung tissue repair support',
      'Mitochondrial energy restoration',
      'Profound fatigue improvement',
      'Gut-immune axis restoration',
      'Regulatory T-cell support',
    ],
    idealFor: [
      'Long COVID / post-viral syndrome',
      'Chronic fatigue following illness',
      'Clients with persistent immune dysregulation',
      'Post-viral lung or gut dysfunction',
    ],
    dosing: 'Per label — VIP and MOTS-C doses calibrated in the pen formulation',
    duration: '8–16 weeks',
    research: [
      { title: 'VIP in COVID-19 and inflammatory conditions — therapeutic potential', journal: 'International Journal of Molecular Sciences, 2020', url: 'https://pubmed.ncbi.nlm.nih.gov/32545681/' },
      { title: 'MOTS-C counters age-associated insulin resistance and metabolic decline', journal: 'Nature Communications, 2021', url: 'https://pubmed.ncbi.nlm.nih.gov/33531503/' },
    ],
  },

  {
    id: 'selank-delta-pen',
    name: 'AC-Selank + Delta Sleep Pen',
    shortName: 'Selank/DSIP Pen',
    format: 'pen',
    formatLabel: 'Pre-Compounded Pen',
    formatEmoji: '🖊️',
    emoji: '😴',
    tagline: 'Calm anxiety, trigger deep sleep — the night recovery protocol',
    category: 'cognitive',
    inStock: true,
    compounds: [
      { id: 'selank', name: 'AC-Selank-NH2', dose: 'per dose', emoji: '🧠', role: 'Anxiolytic — calms the nervous system without sedation' },
      { id: 'dsip',   name: 'DSIP',         dose: 'per dose', emoji: '😴', role: 'Delta sleep-inducing — triggers slow-wave sleep architecture' },
    ],
    whyTogether: `Selank and DSIP create a two-phase sleep and recovery protocol that addresses both the anxiety that prevents sleep onset and the sleep architecture that determines recovery quality.

AC-Selank-NH2 is the acetylated, amidated form of Selank — this modification significantly increases stability and bioavailability compared to standard Selank. It works by stabilizing enkephalins, modulating GABA-A receptors without addiction risk, and reducing the anxiety and mental noise that prevent sleep onset. Unlike benzodiazepines, it causes no sedation, no next-day impairment, and no dependency.

DSIP (Delta Sleep-Inducing Peptide) triggers the slow-wave (delta) sleep stages — the deep restorative phases where human growth hormone is released, memory consolidation occurs, and cellular repair happens. Many clients, especially those under high stress or with ADD/ADHD, spend insufficient time in delta sleep. DSIP resets this architecture.

Together: Selank handles the mental side (anxiety, racing thoughts, difficulty switching off); DSIP handles the physiological side (triggering the deep sleep stages). The result is faster sleep onset AND better quality sleep — with significant next-day focus, recovery, and cognitive improvements reported by most clients.`,
    whySuspension: `The AC-NH2 modification (acetylation + amidation) of Selank in this pen formulation is specifically chosen to extend half-life and improve nasal mucosal absorption compared to standard Selank. DSIP is co-formulated in the same carrier to maximize convenience of the pre-bed protocol.`,
    benefits: [
      'Reduced anxiety and mental noise before sleep',
      'Faster sleep onset',
      'Improved slow-wave (delta) sleep percentage',
      'GH release during deep sleep',
      'Better memory consolidation overnight',
      'Improved next-day focus and cognitive clarity',
      'No dependency, no next-day sedation',
    ],
    idealFor: [
      'Clients with anxiety-driven insomnia',
      'ADD/ADHD clients with sleep disruption',
      'High-stress executives or entrepreneurs',
      'Athletes wanting optimized overnight recovery',
      'Anyone with poor sleep quality',
    ],
    dosing: 'Take 20–30 min before bed · Per pen label dosing',
    duration: '4–8 week cycles',
    research: [
      { title: 'Anxiolytic effects of Selank without sedation', journal: 'Bulletin of Experimental Biology and Medicine, 2008', url: 'https://pubmed.ncbi.nlm.nih.gov/19240826/' },
    ],
  },

  {
    id: 'bpc-tb-pen',
    name: 'BPC-157 + TB-500 Pen',
    shortName: 'BPC/TB Pen',
    format: 'pen',
    formatLabel: 'Pre-Compounded Pen',
    formatEmoji: '🖊️',
    emoji: '🩹',
    tagline: 'The classic healing duo — local + systemic repair in one convenient pen',
    category: 'healing',
    inStock: true,
    compounds: [
      { id: 'bpc157', name: 'BPC-157', dose: 'per dose', emoji: '🩹', role: 'Site-specific tissue repair — targets the injury location' },
      { id: 'tb500',  name: 'TB-500',  dose: 'per dose', emoji: '🩹', role: 'Systemic healing — works throughout the entire body simultaneously' },
    ],
    whyTogether: `BPC-157 and TB-500 are the most researched healing peptide combination in the world — and the reason they work so well together is precisely because they operate through different mechanisms at different scales.

BPC-157 (Body Protection Compound 157) works locally. It drives angiogenesis at the injury site, activates the FAK-paxillin pathway for tendon and ligament cell migration, and promotes VEGFR2-mediated tissue repair exactly where it's needed. For a knee injury, a gut lesion, or a torn muscle, BPC-157 sends repair resources directly to the problem.

TB-500 (Thymosin Beta-4) works systemically. It promotes actin polymerization throughout the entire body, reduces inflammation everywhere, activates stem cell differentiation, and improves overall tissue flexibility and resilience. It doesn't need to be injected near the injury to work — it circulates and helps the whole body rebuild.

The combination creates a repair effect that is greater than the sum of its parts: BPC-157's local precision plus TB-500's systemic reach. Clients who've tried single compounds and seen partial results consistently report significantly faster and more complete recovery on the combination.`,
    whySuspension: `The pen format maintains BPC-157 and TB-500 in a pre-stabilized carrier that prevents the pH-related degradation that can occur when these peptides are individually reconstituted. Consistent dose delivery with every injection.`,
    benefits: [
      'Fastest available healing combination for soft tissue injuries',
      'Local + systemic repair simultaneously',
      'Reduces chronic inflammation',
      'Accelerates return to training',
      'Improved flexibility and joint mobility',
      'Can address old injuries that haven\'t healed',
    ],
    idealFor: [
      'Acute injuries (sprains, tears, strains)',
      'Chronic unresolved injuries',
      'Post-surgical recovery',
      'Athletes in heavy training',
      'Joint and tendon issues',
    ],
    dosing: 'BPC-157 250–500mcg/day · TB-500 2–5mg 2x/week · Per pen label',
    duration: '6–12 weeks',
    research: [
      { title: 'BPC-157 effects on tendon healing', journal: 'Journal of Orthopaedic Research, 2010', url: 'https://pubmed.ncbi.nlm.nih.gov/19763488/' },
      { title: 'Thymosin beta-4 accelerates wound healing', journal: 'Annals NY Academy of Sciences, 2012', url: 'https://pubmed.ncbi.nlm.nih.gov/22985322/' },
    ],
  },

  {
    id: 'glow-5',
    name: 'Glow 5mg — Starter Repair Blend',
    shortName: 'Glow 5mg',
    format: 'freeze-dried-vial',
    formatLabel: 'Freeze-Dried Vial',
    formatEmoji: '🧊',
    emoji: '✨',
    tagline: 'BPC-157 5mg + TB-500 6mg + GHK-Cu 20mg — entry-level healing and skin stack',
    category: 'healing',
    inStock: true,
    compounds: [
      { id: 'bpc157', name: 'BPC-157', dose: '5mg',  emoji: '🩹', role: 'Local tissue repair' },
      { id: 'tb500',  name: 'TB-500',  dose: '6mg',  emoji: '🩹', role: 'Systemic healing' },
      { id: 'ghkcu',  name: 'GHK-Cu',  dose: '20mg', emoji: '✨', role: 'Collagen and anti-aging' },
    ],
    whyTogether: `The Glow 5mg is the entry-level version of the Glow blend — same three compounds at a lower dose point, ideal for clients starting their first healing protocol or those with lighter repair needs.

BPC-157 drives local repair at the injury or problem site. TB-500 handles systemic recovery throughout the body. GHK-Cu builds the structural collagen matrix that makes repaired tissue strong and youthful. All three together create a healing + anti-aging effect that single compounds can't match.`,
    whySuspension: `Co-lyophilized for stability — same benefits as Glow 10mg at a lower entry price point.`,
    benefits: ['Local + systemic healing', 'Collagen synthesis', 'Anti-aging gene activation', 'Entry-level protocol for new clients'],
    idealFor: ['First-time peptide users', 'Light to moderate injuries', 'Maintenance protocols', 'Budget-conscious clients'],
    dosing: 'BPC-157 250mcg/day · TB-500 2–3mg 2x/week · GHK-Cu 0.5–1mg/day',
    duration: '6–10 weeks',
    research: [
      { title: 'BPC-157 effects on tendon healing', journal: 'Journal of Orthopaedic Research, 2010', url: 'https://pubmed.ncbi.nlm.nih.gov/19763488/' },
    ],
  },

  {
    id: 'glow-3pack',
    name: 'Glow 3-Pack — Exclusive Bundle',
    shortName: 'Glow 3-Pack',
    format: 'freeze-dried-vial',
    formatLabel: 'Freeze-Dried Vial · 3-Pack',
    formatEmoji: '🧊',
    emoji: '🌟',
    tagline: 'Three Glow vials — BPC-157, TB-500, GHK-Cu — best value healing starter',
    category: 'healing',
    inStock: true,
    compounds: [
      { id: 'bpc157', name: 'BPC-157', dose: '5mg per vial', emoji: '🩹', role: 'Local tissue repair' },
      { id: 'tb500',  name: 'TB-500',  dose: '6mg per vial', emoji: '🩹', role: 'Systemic healing' },
      { id: 'ghkcu',  name: 'GHK-Cu',  dose: '20mg per vial',emoji: '✨', role: 'Collagen and anti-aging' },
    ],
    whyTogether: `The Glow 3-Pack gives you three full Glow vials at the best per-vial price — enough for a complete 8–10 week healing protocol. Same synergy as Glow 5mg but stocked for a full course.`,
    whySuspension: `Freeze-dried co-lyophilization for stability and bioavailability — each vial reconstitutes in seconds.`,
    benefits: ['Full 8–10 week protocol supply', 'Best value entry into the Glow blend', 'Local + systemic + anti-aging healing'],
    idealFor: ['First full healing protocol', 'Value-conscious clients wanting a complete course'],
    dosing: 'Same as Glow 5mg protocol',
    duration: '8–10 weeks (3 vials)',
    research: [],
  },

  {
    id: 'skin-glow-pen',
    name: 'Skin Glow Pen — GHK-Cu',
    shortName: 'Skin Glow Pen',
    format: 'pen',
    formatLabel: 'Pre-Compounded Pen',
    formatEmoji: '🖊️',
    emoji: '✨',
    tagline: 'Pure GHK-Cu in a precision pen — targeted skin tightening, collagen, and anti-aging',
    category: 'antiaging',
    inStock: true,
    compounds: [
      { id: 'ghkcu', name: 'GHK-Cu', dose: '30mg or 100mg', emoji: '✨', role: 'Copper peptide — activates 4,000+ tissue-remodeling genes' },
    ],
    whyTogether: `The Skin Glow Pen delivers pure GHK-Cu in a precision pen format — available in 30mg and 100mg concentrations. The pen format eliminates the burning-from-volume issue common with individual vials by delivering a precisely controlled, consistent dose each time.

GHK-Cu is one of the most potent anti-aging compounds available. It declines 60% between ages 20 and 60, and its depletion is directly linked to loss of skin elasticity, collagen density, and wound healing capacity. Replenishing it restores the gene activation network responsible for tissue remodeling — skin tightening, hair density, collagen synthesis, and DNA repair.`,
    whySuspension: `The pen format is particularly valuable for GHK-Cu because the copper-peptide complex requires precise pH control for stability. The pre-compounded pen suspension maintains the characteristic blue-green copper complex in an optimized carrier that maximizes bioavailability and minimizes injection burning compared to home reconstitution.`,
    benefits: ['Skin tightening and elasticity improvement', 'Collagen and elastin synthesis', 'Hair growth stimulation', '4,000+ repair gene activation', 'DNA repair and anti-aging', 'Wound healing acceleration'],
    idealFor: ['Anti-aging protocols', 'Skin quality improvement', 'Hair loss or thinning', 'Post-procedure skin repair', 'Collagen rebuilding'],
    dosing: '1–2mg/day · 3–5x per week · SubQ injection',
    duration: '8–16 weeks',
    research: [
      { title: 'GHK-Cu activates 4,000+ human genes', journal: 'Biochemistry Research International, 2012', url: 'https://pubmed.ncbi.nlm.nih.gov/22550605/' },
    ],
  },

];

// Helper: get combos by category
export function getCombosByCategory(cat) {
  if (cat === 'all') return COMBOS;
  return COMBOS.filter(c => c.category === cat);
}

// Format config
export const FORMAT_CONFIG = {
  'freeze-dried-vial': { label: 'Freeze-Dried Vial',    color: '#60a5fa', bg: 'rgba(59,130,246,0.1)',  border: 'rgba(59,130,246,0.2)',  icon: '🧊' },
  'pen':               { label: 'Pre-Compounded Pen',   color: '#c084fc', bg: 'rgba(168,85,247,0.1)',  border: 'rgba(168,85,247,0.2)',  icon: '🖊️' },
  'vial':              { label: 'Standard Vial',        color: '#94a3b8', bg: 'rgba(148,163,184,0.08)', border: 'rgba(148,163,184,0.15)', icon: '🧪' },
};
