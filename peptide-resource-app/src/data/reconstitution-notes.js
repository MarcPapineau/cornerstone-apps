// ============================================================
// RECONSTITUTION SPECIAL NOTES
// Research-based formulation guidance per compound
//
// solvent options:
//   'bac'      = Bacteriostatic Water (standard — 0.9% benzyl alcohol)
//   'sterile'  = Sterile Water for Injection (single-use, no preservative)
//   'acetic'   = 0.1% Acetic Acid (dilute)
//   'saline'   = Bacteriostatic Saline (0.9% NaCl + benzyl alcohol)
//   'dmso'     = DMSO solution (topical/research only)
//
// warning levels:
//   'caution'  = BAC water works but a better option exists
//   'avoid'    = BAC water degrades or inactivates this compound
//   'info'     = Neutral info — context-specific guidance
// ============================================================

export const RECONSTITUTION_NOTES = {

  // ── STANDARD BAC WATER — No special notes ─────────────────
  // bpc157, tb500, cjc, ipamorelin, kpv, sermorelin, hexarelin,
  // aod9604, ta1, ghkcu, nad, semax, selank, reta, tesamorelin
  // → All stable in BAC water at standard pH. No warnings needed.

  // ── SPECIAL CASES ──────────────────────────────────────────

  epithalon: {
    level: 'caution',
    preferredSolvent: 'sterile',
    alternativeSolvent: 'bac',
    title: '⚠️ Prefers Sterile Water — BAC Water Usable With Caution',
    body: 'Epithalon (Epitalon) is a tetrapeptide that is stable in both bacteriostatic water and sterile water for injection. However, because Epithalon protocols involve short 10–20 day cycles (not ongoing multi-month use), sterile water for injection is preferred — the benzyl alcohol preservative in BAC water provides no practical advantage for short cycles and introduces unnecessary chemical exposure. Use sterile water, use the entire vial within 5–7 days, and keep refrigerated.',
    steps: [
      'Use Sterile Water for Injection (not bacteriostatic water) for short cycles',
      'Use within 5–7 days of reconstitution when using sterile water',
      'If using BAC water instead: use within 28 days, refrigerate',
      'Protect from light — Epithalon is particularly light-sensitive'
    ]
  },

  motsc: {
    level: 'caution',
    preferredSolvent: 'sterile',
    alternativeSolvent: 'bac',
    title: '⚠️ Handle With Care — Fragile Mitochondrial Peptide',
    body: 'MOTS-c is a mitochondrial-derived peptide with a fragile structure compared to most research peptides. BAC water is acceptable but sterile water for injection is preferred to minimize any benzyl alcohol exposure to this sensitive compound. Reconstitute gently — MOTS-c should never be shaken or vortexed. Swirl very slowly. Use within 21 days of reconstitution and keep strictly refrigerated.',
    steps: [
      'Use Sterile Water for Injection preferred; BAC water acceptable',
      'Swirl extremely gently — do not shake or vortex',
      'Use within 21 days (sterile water: use within 5 days)',
      'Keep refrigerated at all times — never leave at room temperature'
    ]
  },

  melanotan2: {
    level: 'caution',
    preferredSolvent: 'bac',
    alternativeSolvent: 'sterile',
    title: '⚠️ BAC Water Standard — Avoid Saline',
    body: 'Melanotan II is best reconstituted in bacteriostatic water. Do NOT use saline (sodium chloride solution) — the ionic environment of saline can cause aggregation of the peptide and reduce potency. BAC water is the correct and standard choice. Store in a dark environment — Melanotan II is highly light-sensitive and will degrade rapidly with UV exposure.',
    steps: [
      'Use Bacteriostatic Water — DO NOT use saline',
      'Protect from light strictly — store in dark vial or covered with foil',
      'Swirl gently — never shake',
      'Use within 28 days. Discard if solution changes colour significantly'
    ]
  },

  pt141: {
    level: 'info',
    preferredSolvent: 'bac',
    alternativeSolvent: 'sterile',
    title: '💡 BAC Water Standard — Nasal Route Note',
    body: 'PT-141 (Bremelanotide) reconstitutes cleanly in bacteriostatic water for subcutaneous injection. For intranasal administration (a common delivery method for PT-141), a sterile saline-based nasal solution is used instead — this is a different preparation from the injectable form. If using intranasally, consult Marc for the correct intranasal preparation, as BAC water with benzyl alcohol is NOT suitable for intranasal use.',
    steps: [
      'SubQ injection: use Bacteriostatic Water — standard reconstitution',
      'Intranasal use: requires different preparation (sterile saline-based) — contact Marc',
      'Do NOT use BAC water intranasally — benzyl alcohol causes mucosal irritation',
      'Use within 28 days (injectable). Refrigerate after reconstitution'
    ]
  },

  semax: {
    level: 'info',
    preferredSolvent: 'bac',
    alternativeSolvent: 'sterile',
    title: '💡 Dual Route — Different Prep for Intranasal vs Injectable',
    body: 'Semax is commonly used both via subcutaneous injection AND intranasally via nasal drops. For injection: reconstitute in bacteriostatic water — standard preparation. For intranasal use: sterile water for injection is preferred over BAC water, as benzyl alcohol (the preservative in BAC water) can cause mucosal irritation when applied to nasal tissue repeatedly. Commercial Semax nasal sprays (Russian pharmaceutical grade) use a saline-based carrier — this is the clinical standard for intranasal peptides.',
    steps: [
      'Injectable: Bacteriostatic Water — standard. Use within 28 days.',
      'Intranasal: Sterile Water for Injection preferred. Use within 5–7 days.',
      'Do NOT use BAC water intranasally — benzyl alcohol irritates nasal mucosa',
      'Intranasal dosing: 2 drops per nostril = ~100–200mcg depending on concentration'
    ]
  },

  selank: {
    level: 'info',
    preferredSolvent: 'bac',
    alternativeSolvent: 'sterile',
    title: '💡 Dual Route — Same Intranasal Consideration as Semax',
    body: 'Selank shares the same dual-route consideration as Semax. For injectable use, BAC water is standard. For intranasal administration (common with Selank for anxiety management), use sterile water for injection — not BAC water. The 0.9% benzyl alcohol in BAC water causes mucosal irritation with repeated intranasal use.',
    steps: [
      'Injectable: Bacteriostatic Water — use within 28 days',
      'Intranasal: Sterile Water for Injection — use within 5–7 days',
      'Avoid BAC water intranasally'
    ]
  },

  dihexa: {
    level: 'caution',
    preferredSolvent: 'acetic',
    alternativeSolvent: 'bac',
    title: '⚠️ May Require Dilute Acetic Acid — Solubility Dependent',
    body: 'Dihexa can be poorly soluble in plain bacteriostatic water depending on the specific formulation and batch. If you observe cloudiness or incomplete dissolution in BAC water, use 0.1% Acetic Acid (dilute acetic acid for injection) instead — this improves solubility significantly. After dissolving in acetic acid, the solution should be further diluted with sterile saline before injection to bring it to physiological pH. Dihexa is also commonly used orally or dissolved in DMSO for research applications.',
    steps: [
      'First attempt: Bacteriostatic Water — swirl gently, wait 5 minutes',
      'If cloudy or incomplete dissolution: use 0.1% Acetic Acid for injection',
      'After dissolving in acetic acid: dilute with sterile saline (1:1 minimum) before injecting',
      'Oral option: dissolve in minimal DMSO (food-grade) and consume — no injection needed',
      'Refrigerate. Use within 14 days'
    ]
  },

  ghkcu: {
    level: 'info',
    preferredSolvent: 'bac',
    title: '💡 Blue/Green Colour is Normal — Copper Complex Explanation',
    body: 'GHK-Cu is a copper-peptide complex. When reconstituted correctly, the solution will be blue to blue-green in colour — this is completely normal and expected. It is the copper bound to the peptide, NOT contamination or degradation. A colourless solution may indicate the copper complex has not formed correctly and the product may be substandard. BAC water is the correct reconstitution solution.',
    steps: [
      'Use Bacteriostatic Water — standard reconstitution',
      'Blue/green colour: NORMAL and expected — this is the copper complex',
      'Colourless solution: may indicate formulation issue — contact your supplier',
      'Inject very slowly — GHK-Cu causes a burning sensation due to the copper (not an allergy)',
      'Use within 28 days. Refrigerate.'
    ]
  },

  nad: {
    level: 'caution',
    preferredSolvent: 'sterile',
    alternativeSolvent: 'bac',
    title: '⚠️ Sterile Water Preferred — NAD+ Degrades Faster With Benzyl Alcohol',
    body: 'NAD+ (Nicotinamide Adenine Dinucleotide) is more chemically reactive than peptides and the benzyl alcohol in BAC water can accelerate oxidative degradation of NAD+ over time — reducing potency in stored solutions. For NAD+, sterile water for injection is preferred for reconstitution. Use the reconstituted solution within 14 days (shorter than typical peptides). For single-use doses, sterile water is ideal. If only BAC water is available, use within 7–10 days and keep strictly refrigerated and protected from light.',
    steps: [
      'Preferred: Sterile Water for Injection — use within 14 days',
      'Acceptable: Bacteriostatic Water — use within 7–10 days only',
      'Protect from light strictly — NAD+ degrades with UV exposure',
      'Inject VERY slowly (3–5 minutes for 250mg+) — flushing is expected and intense',
      'Keep strictly refrigerated — never leave at room temperature'
    ]
  },

  slupppp332: {
    level: 'info',
    preferredSolvent: 'dmso',
    title: '💡 Oral Compound — No Injection Reconstitution Required',
    body: 'SLU-PP-332 is typically supplied as an oral compound (capsule or powder) rather than a lyophilized injectable peptide. No reconstitution in BAC water is required. If supplied as raw powder for research, it can be dissolved in DMSO (dimethyl sulfoxide — food/pharmaceutical grade) for oral consumption, or encapsulated. Do NOT attempt to inject SLU-PP-332 in DMSO — DMSO is not suitable for injection.',
    steps: [
      'Oral use: swallow capsule or powder as supplied — no reconstitution needed',
      'Raw powder: dissolve in pharmaceutical-grade DMSO for oral use only',
      'Do NOT inject this compound',
      'Store in cool, dark place — no refrigeration required for capsules'
    ]
  },

  amino1mq: {
    level: 'info',
    preferredSolvent: 'dmso',
    title: '💡 Oral Compound — No Injection Reconstitution Required',
    body: '5-Amino-1MQ is supplied as an oral compound — capsules or powder. No injection reconstitution is required or recommended. If supplied as raw powder, it can be dissolved in a small amount of pharmaceutical-grade DMSO or ethanol for oral use. Do NOT attempt IV or SubQ injection.',
    steps: [
      'Take orally as capsule or powder — no reconstitution needed',
      'With food recommended to reduce GI discomfort',
      'Raw powder: dissolve in minimal DMSO or ethanol, then dilute in water or juice',
      'Do NOT inject'
    ]
  },

};

// Helper: get reconstitution note for a compound
export function getReconNote(compoundId) {
  return RECONSTITUTION_NOTES[compoundId] || null;
}

// Level config for display
export const RECON_LEVEL_CONFIG = {
  avoid:   { color: '#ef4444', bg: 'rgba(239,68,68,0.08)',   border: 'rgba(239,68,68,0.25)',   icon: '🚫', label: 'Do Not Use BAC Water' },
  caution: { color: '#f59e0b', bg: 'rgba(245,158,11,0.08)',  border: 'rgba(245,158,11,0.25)',  icon: '⚠️', label: 'Special Reconstitution Required' },
  info:    { color: '#60a5fa', bg: 'rgba(59,130,246,0.06)',  border: 'rgba(59,130,246,0.18)',  icon: '💡', label: 'Reconstitution Note' },
};
