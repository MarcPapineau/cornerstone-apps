// ============================================================
// PEPTIDE COMPARISONS — ES6 export
// Cornerstone Research OPS | Ported from luke-app
// Research framing only. Not medical advice.
// ============================================================

export const peptideComparisons = [

  // ─── 1. BPC-157 vs TB-500 ────────────────────────────────
  {
    id: 'bpc157_tb500',
    peptides: ['BPC-157', 'TB-500'],
    title: 'BPC-157 vs TB-500',
    categories: ['healing', 'recovery'],
    synergy_score: 9,
    profiles: {
      'BPC-157': {
        mechanism: 'Body Protection Compound — promotes angiogenesis (new blood vessel formation) in damaged tissue and upregulates growth hormone receptors at injury sites. Strong efficacy for tendon, ligament, muscle, and gut repair.',
        best_for: ['localized injury', 'tendon repair', 'gut healing', 'ligament damage', 'neuroprotection'],
        research_maturity: 'high',
      },
      'TB-500': {
        mechanism: 'Synthetic fragment of Thymosin Beta-4. Promotes actin polymerization, accelerating cell migration to injury sites. Key driver of systemic anti-inflammatory response and stem cell differentiation.',
        best_for: ['systemic recovery', 'chronic inflammation', 'cardiac tissue', 'widespread injury', 'post-surgical systemic healing'],
        research_maturity: 'high',
      },
    },
    synergy_notes: 'BPC-157 drives vascularization and growth receptor upregulation while TB-500 drives cell migration and systemic inflammation reduction. Research frequently shows additive effect when stacked — the rationale behind the KLOW protocol.',
  },

  // ─── 2. BPC-157 vs KPV ───────────────────────────────────
  {
    id: 'bpc157_kpv',
    peptides: ['BPC-157', 'KPV'],
    title: 'BPC-157 vs KPV',
    categories: ['healing', 'gut', 'inflammation'],
    synergy_score: 8,
    profiles: {
      'BPC-157': {
        mechanism: 'Promotes gut lining repair and modulates the enteric nervous system. Research in gastric ulcer models, leaky gut, and intestinal wall damage shows strong structural repair activity.',
        best_for: ['gut lining repair', 'gastric ulcers', 'leaky gut', 'intestinal healing', 'structural repair'],
        research_maturity: 'high',
      },
      'KPV': {
        mechanism: 'Tripeptide (Lys-Pro-Val) — C-terminal fragment of alpha-MSH. Potent anti-inflammatory via NF-κB pathway inhibition with specific research in colitis and IBD models. Allows oral administration.',
        best_for: ['gut inflammation', 'IBD research', 'colitis', 'mast cell modulation', 'inflammatory flare management'],
        research_maturity: 'moderate',
      },
    },
    synergy_notes: 'KPV targets the inflammatory signaling side (calming active flares via NF-κB inhibition), while BPC-157 targets structural repair of the gut lining. Strong research rationale to stack for active inflammatory gut conditions.',
  },

  // ─── 3. Semax vs Selank ──────────────────────────────────
  {
    id: 'selank_semax',
    peptides: ['Selank', 'Semax'],
    title: 'Selank vs Semax',
    categories: ['cognitive', 'nootropic', 'anxiety'],
    synergy_score: 8,
    profiles: {
      'Selank': {
        mechanism: 'Synthetic analogue of tuftsin. Modulates GABA-A receptor activity for anxiolytic effects and enhances BDNF expression. Anti-anxiety effects without sedation or dependence.',
        best_for: ['anxiety reduction', 'stress management', 'cognitive performance under stress', 'BDNF support'],
        research_maturity: 'moderate',
      },
      'Semax': {
        mechanism: 'ACTH analogue. Strong upregulation of BDNF and NGF, supporting synaptogenesis and neural repair. More stimulating profile. Research includes cognitive enhancement, memory consolidation, neuroprotection.',
        best_for: ['cognitive enhancement', 'memory consolidation', 'focus and attention', 'neuroprotection'],
        research_maturity: 'moderate',
      },
    },
    synergy_notes: 'Often called the "Russian nootropic stack." Semax for cognitive activation and Selank for anxiety/stress dampening. Selank calms the baseline noise while Semax amplifies signal clarity.',
  },

  // ─── 4. PT-141 vs Kisspeptin ─────────────────────────────
  {
    id: 'pt141_kisspeptin',
    peptides: ['PT-141', 'Kisspeptin-10'],
    title: 'PT-141 vs Kisspeptin-10',
    categories: ['hormonal', 'sexual-health'],
    synergy_score: 7,
    profiles: {
      'PT-141': {
        mechanism: 'Melanocortin receptor agonist (MC3R, MC4R). Acts centrally on hypothalamic pathways to increase sexual desire and arousal. FDA-approved as Vyleesi for HSDD in women.',
        best_for: ['sexual desire increase', 'arousal research', 'central desire mechanism', 'both sexes'],
        research_maturity: 'high',
      },
      'Kisspeptin-10': {
        mechanism: 'Endogenous neuropeptide that regulates the HPG axis. Stimulates GnRH release, which triggers LH and subsequently testosterone production.',
        best_for: ['hormonal optimization', 'testosterone support', 'LH surge research', 'fertility research'],
        research_maturity: 'moderate',
      },
    },
    synergy_notes: 'PT-141 for event-based desire activation, Kisspeptin for ongoing hormonal axis optimization. A comprehensive sexual health protocol uses both on different timelines.',
  },

  // ─── 5. CJC-1295 + Ipamorelin vs Sermorelin ─────────────
  {
    id: 'cjc1295_ipamorelin_vs_sermorelin',
    peptides: ['CJC-1295', 'Ipamorelin', 'Sermorelin'],
    title: 'CJC-1295 + Ipamorelin vs Sermorelin',
    categories: ['hormonal', 'anti-aging', 'recovery'],
    synergy_score: 7,
    profiles: {
      'CJC-1295': {
        mechanism: 'GHRH analogue that signals the pituitary to prepare for and release growth hormone. DAC form binds to albumin for 6-8 day half-life. Stronger GH stimulation than Sermorelin.',
        best_for: ['GH stimulation', 'body recomposition', 'anti-aging', 'combined with Ipamorelin'],
        research_maturity: 'high',
      },
      'Ipamorelin': {
        mechanism: 'GHRP (ghrelin mimetic) — triggers the actual GH pulse with high selectivity and minimal cortisol or prolactin elevation. The gold standard GHRP for its clean GH release profile.',
        best_for: ['clean GH pulse', 'body composition', 'recovery', 'minimal side effects'],
        research_maturity: 'high',
      },
      'Sermorelin': {
        mechanism: '29-amino acid fragment of natural GHRH — the oldest and most researched GHRH peptide. Short half-life requires daily injection. Closely mimics the body\'s natural pulsatile GH release pattern.',
        best_for: ['conservative GH research', 'natural pulsatile release', 'first-time GH peptide use'],
        research_maturity: 'high',
      },
    },
    synergy_notes: 'CJC-1295 (GHRH analogue) + Ipamorelin (GHRP) creates a synergistic GH pulse stronger than either alone. Sermorelin and CJC-1295 should not be stacked — they target the same receptor.',
  },

  // ─── 6. Semaglutide vs Retatrutide ──────────────────────
  {
    id: 'semaglutide_retatrutide',
    peptides: ['Semaglutide', 'Retatrutide'],
    title: 'Semaglutide vs Retatrutide',
    categories: ['fat-loss', 'metabolic'],
    synergy_score: 1,
    profiles: {
      'Semaglutide': {
        mechanism: 'GLP-1 receptor agonist — stimulates insulin secretion, suppresses glucagon, slows gastric emptying. Research shows 15-20% body weight reduction. FDA-approved as Ozempic/Wegovy.',
        best_for: ['fat loss', 'appetite suppression', 'metabolic health', 'established safety profile'],
        research_maturity: 'high',
      },
      'Retatrutide': {
        mechanism: 'Triple agonist targeting GLP-1, GIP, and Glucagon receptors simultaneously. Phase 3 trials showing 24%+ body weight reduction. Not yet approved.',
        best_for: ['maximum fat loss velocity', 'improved tolerability vs single GLP-1', 'next-generation weight management'],
        research_maturity: 'moderate',
      },
    },
    synergy_notes: 'NEVER stack these — they compete for the same GLP-1 receptors. The choice is binary: Semaglutide for proven safety, or Retatrutide for maximum research efficacy.',
  },

  // ─── 7. MOTS-C vs SS-31 ─────────────────────────────────
  {
    id: 'motsc_ss31',
    peptides: ['MOTS-C', 'SS-31'],
    title: 'MOTS-C vs SS-31',
    categories: ['mitochondrial', 'energy', 'anti-aging'],
    synergy_score: 9,
    profiles: {
      'MOTS-C': {
        mechanism: 'Mitochondrial-derived peptide encoded in the mitochondrial genome. Activates AMPK (master metabolic regulator), improves insulin sensitivity, increases fatty acid oxidation.',
        best_for: ['metabolic optimization', 'insulin sensitivity', 'exercise performance', 'energy efficiency'],
        research_maturity: 'moderate',
      },
      'SS-31': {
        mechanism: 'Targets cardiolipin on the inner mitochondrial membrane to improve electron transport chain efficiency and reduce oxidative stress at the source. Strong cardiac and sarcopenia research.',
        best_for: ['mitochondrial structure repair', 'cardiac health research', 'sarcopenia', 'oxidative stress reduction'],
        research_maturity: 'moderate',
      },
    },
    synergy_notes: 'SS-31 repairs the mitochondrial structural foundation (inner membrane), while MOTS-C optimizes metabolic signaling on top of that foundation. SS-31 as primer before introducing MOTS-C is the recommended protocol sequence.',
  },

  // ─── 8. GHK-Cu vs BPC-157 ───────────────────────────────
  {
    id: 'ghkcu_bpc157',
    peptides: ['GHK-Cu', 'BPC-157'],
    title: 'GHK-Cu vs BPC-157',
    categories: ['anti-aging', 'healing', 'skin'],
    synergy_score: 8,
    profiles: {
      'GHK-Cu': {
        mechanism: 'Copper peptide naturally occurring in human plasma. Stimulates collagen, elastin, and glycosaminoglycan synthesis. Activates ~30% of human genes involved in DNA repair and antioxidant defense.',
        best_for: ['skin rejuvenation', 'wound healing', 'hair growth research', 'collagen synthesis', 'anti-aging'],
        research_maturity: 'high',
      },
      'BPC-157': {
        mechanism: 'Promotes angiogenesis and growth receptor upregulation in damaged tissue. Strong research in structural wound healing, tendon repair, and gut healing.',
        best_for: ['structural wound healing', 'tendon/ligament repair', 'gut healing', 'angiogenesis'],
        research_maturity: 'high',
      },
    },
    synergy_notes: 'GHK-Cu focuses on structural regeneration (collagen, elastin, DNA repair) at the cellular level while BPC-157 drives vascularization and systemic healing. Both are included in the KLOW FD protocol for this reason.',
  },
];

// ── Helper: find comparison by peptide names ────────────────────
export function findComparison(peptides) {
  const normalized = peptides.map(p => p.trim().toLowerCase());
  return peptideComparisons.find(c => {
    const compNorm = c.peptides.map(p => p.toLowerCase());
    return normalized.every(p => compNorm.some(cp => cp.includes(p) || p.includes(cp))) &&
           compNorm.every(cp => normalized.some(p => cp.includes(p) || p.includes(cp)));
  });
}
