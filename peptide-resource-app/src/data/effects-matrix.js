// ============================================================
// COMPOUND EFFECTS MATRIX
// Source of truth for multi-domain compound effects
// Score: 0=none, 1=minor/secondary, 2=notable, 3=primary mechanism
//
// Domains:
//   fat_loss    — direct fat oxidation, lipolysis, appetite, visceral fat
//   performance — GH, strength, endurance, muscle, recovery
//   healing     — tissue repair, gut, anti-inflammatory, wound healing
//   antiaging   — cellular longevity, telomere, mitochondrial, skin
//   cognitive   — BDNF, focus, memory, neuroplasticity, anxiety
//   immune      — T-cell, NK, viral defense, autoimmune regulation
//   hormonal    — GH, insulin, cortisol, metabolic signaling
// ============================================================

export const EFFECTS_MATRIX = {

  // ── HEALING ──────────────────────────────────────────────
  bpc157: {
    fat_loss: 0, performance: 1, healing: 3, antiaging: 1,
    cognitive: 1, immune: 1, hormonal: 1
  },
  tb500: {
    fat_loss: 0, performance: 2, healing: 3, antiaging: 1,
    cognitive: 0, immune: 0, hormonal: 0
  },
  kpv: {
    fat_loss: 0, performance: 0, healing: 2, antiaging: 0,
    cognitive: 0, immune: 2, hormonal: 0
  },

  // ── PERFORMANCE / GH ─────────────────────────────────────
  cjc: {
    fat_loss: 2, performance: 3, healing: 1, antiaging: 2,
    cognitive: 1, immune: 0, hormonal: 3
  },
  ipamorelin: {
    fat_loss: 2, performance: 3, healing: 1, antiaging: 2,
    cognitive: 1, immune: 0, hormonal: 3
  },
  sermorelin: {
    fat_loss: 2, performance: 3, healing: 1, antiaging: 2,
    cognitive: 0, immune: 0, hormonal: 3
  },
  hexarelin: {
    fat_loss: 1, performance: 3, healing: 1, antiaging: 1,
    cognitive: 0, immune: 0, hormonal: 3
  },
  tesamorelin: {
    fat_loss: 3, performance: 2, healing: 0, antiaging: 1,
    cognitive: 0, immune: 0, hormonal: 3
  },
  slupppp332: {
    fat_loss: 2, performance: 3, healing: 0, antiaging: 2,
    cognitive: 0, immune: 0, hormonal: 1
  },

  // ── WEIGHT / METABOLIC ───────────────────────────────────
  reta: {
    fat_loss: 3, performance: 0, healing: 0, antiaging: 1,
    cognitive: 0, immune: 0, hormonal: 3
  },
  aod9604: {
    fat_loss: 3, performance: 1, healing: 0, antiaging: 0,
    cognitive: 0, immune: 0, hormonal: 1
  },
  amino1mq: {
    fat_loss: 3, performance: 1, healing: 0, antiaging: 2,
    cognitive: 0, immune: 0, hormonal: 1
  },

  // ── ANTI-AGING / LONGEVITY ───────────────────────────────
  nad: {
    fat_loss: 1, performance: 2, healing: 1, antiaging: 3,
    cognitive: 2, immune: 1, hormonal: 1
  },
  ghkcu: {
    fat_loss: 0, performance: 0, healing: 2, antiaging: 3,
    cognitive: 0, immune: 0, hormonal: 0
  },
  epithalon: {
    fat_loss: 0, performance: 0, healing: 0, antiaging: 3,
    cognitive: 1, immune: 1, hormonal: 1
  },
  motsc: {
    fat_loss: 2, performance: 2, healing: 0, antiaging: 3,
    cognitive: 0, immune: 0, hormonal: 2
  },

  // ── COGNITIVE ────────────────────────────────────────────
  semax: {
    fat_loss: 0, performance: 0, healing: 0, antiaging: 1,
    cognitive: 3, immune: 1, hormonal: 0
  },
  selank: {
    fat_loss: 0, performance: 0, healing: 0, antiaging: 0,
    cognitive: 3, immune: 1, hormonal: 0
  },
  dihexa: {
    fat_loss: 0, performance: 0, healing: 0, antiaging: 1,
    cognitive: 3, immune: 0, hormonal: 0
  },

  // ── IMMUNE ───────────────────────────────────────────────
  ta1: {
    fat_loss: 0, performance: 0, healing: 1, antiaging: 2,
    cognitive: 0, immune: 3, hormonal: 0
  },

  // ── BATCH 2 — Added March 2026 ────────────────────────────

  // Anti-Aging
  ss31: {
    fat_loss: 0, performance: 1, healing: 1, antiaging: 3,
    cognitive: 1, immune: 0, hormonal: 0
  },
  pinealon: {
    fat_loss: 0, performance: 0, healing: 0, antiaging: 3,
    cognitive: 2, immune: 0, hormonal: 1
  },
  humanin: {
    fat_loss: 0, performance: 0, healing: 1, antiaging: 3,
    cognitive: 2, immune: 0, hormonal: 1
  },
  glutathione: {
    fat_loss: 0, performance: 1, healing: 2, antiaging: 3,
    cognitive: 1, immune: 2, hormonal: 0
  },
  pnc27: {
    fat_loss: 0, performance: 0, healing: 1, antiaging: 2,
    cognitive: 0, immune: 2, hormonal: 0
  },

  // Cognitive
  dsip: {
    fat_loss: 0, performance: 0, healing: 0, antiaging: 1,
    cognitive: 3, immune: 0, hormonal: 1
  },
  p21: {
    fat_loss: 0, performance: 0, healing: 0, antiaging: 1,
    cognitive: 3, immune: 0, hormonal: 0
  },
  // Performance / GH
  ghrp6: {
    fat_loss: 1, performance: 3, healing: 1, antiaging: 1,
    cognitive: 0, immune: 0, hormonal: 3
  },
  cjcnodac: {
    fat_loss: 2, performance: 3, healing: 1, antiaging: 2,
    cognitive: 0, immune: 0, hormonal: 3
  },
  igf1lr3: {
    fat_loss: 2, performance: 3, healing: 1, antiaging: 0,
    cognitive: 0, immune: 0, hormonal: 2
  },
  igf1des: {
    fat_loss: 1, performance: 3, healing: 0, antiaging: 0,
    cognitive: 0, immune: 0, hormonal: 2
  },
  pt141: {
    fat_loss: 0, performance: 2, healing: 0, antiaging: 0,
    cognitive: 1, immune: 0, hormonal: 3
  },
  melanotan2: {
    fat_loss: 1, performance: 2, healing: 0, antiaging: 0,
    cognitive: 0, immune: 0, hormonal: 2
  },
  kisspeptin: {
    fat_loss: 0, performance: 2, healing: 0, antiaging: 1,
    cognitive: 0, immune: 0, hormonal: 3
  },
  hcg: {
    fat_loss: 0, performance: 2, healing: 0, antiaging: 0,
    cognitive: 0, immune: 0, hormonal: 3
  },
  follistatin344: {
    fat_loss: 1, performance: 3, healing: 0, antiaging: 0,
    cognitive: 0, immune: 0, hormonal: 1
  },

  // Weight / Metabolic
  hghfrag: {
    fat_loss: 3, performance: 1, healing: 0, antiaging: 0,
    cognitive: 0, immune: 0, hormonal: 1
  },
  adipotide: {
    fat_loss: 3, performance: 0, healing: 0, antiaging: 0,
    cognitive: 0, immune: 0, hormonal: 0
  },
  cagrilintide: {
    fat_loss: 3, performance: 0, healing: 0, antiaging: 0,
    cognitive: 0, immune: 0, hormonal: 2
  },

  // Healing
  cardiogen: {
    fat_loss: 0, performance: 0, healing: 3, antiaging: 2,
    cognitive: 0, immune: 0, hormonal: 0
  },
  bronchogen: {
    fat_loss: 0, performance: 0, healing: 3, antiaging: 1,
    cognitive: 0, immune: 1, hormonal: 0
  },
  teriparatide: {
    fat_loss: 0, performance: 0, healing: 3, antiaging: 1,
    cognitive: 0, immune: 0, hormonal: 1
  },
  prostamax: {
    fat_loss: 0, performance: 0, healing: 3, antiaging: 1,
    cognitive: 0, immune: 0, hormonal: 1
  },

  // Immune
  ll37: {
    fat_loss: 0, performance: 0, healing: 2, antiaging: 0,
    cognitive: 0, immune: 3, hormonal: 0
  },
  thymalin: {
    fat_loss: 0, performance: 0, healing: 1, antiaging: 2,
    cognitive: 0, immune: 3, hormonal: 0
  },
  thymogen: {
    fat_loss: 0, performance: 0, healing: 0, antiaging: 1,
    cognitive: 0, immune: 3, hormonal: 0
  },
  vip: {
    fat_loss: 0, performance: 0, healing: 2, antiaging: 0,
    cognitive: 1, immune: 3, hormonal: 0
  },
  gcmaf: {
    fat_loss: 0, performance: 0, healing: 1, antiaging: 1,
    cognitive: 0, immune: 3, hormonal: 0
  },
  melittin: {
    fat_loss: 0, performance: 0, healing: 1, antiaging: 0,
    cognitive: 0, immune: 2, hormonal: 0
  },
};

// ── DOMAIN CONFIG ─────────────────────────────────────────
// Maps filter IDs to matrix keys + display info
export const DOMAIN_CONFIG = {
  healing:     { key: 'healing',     emoji: '🩹', label: 'Healing & Recovery',     color: '#4ade80',  threshold: 1 },
  performance: { key: 'performance', emoji: '💪', label: 'Performance & GH',       color: '#60a5fa',  threshold: 2 },
  weight:      { key: 'fat_loss',    emoji: '🔥', label: 'Fat Loss & Metabolic',   color: '#fb923c',  threshold: 2 },
  antiaging:   { key: 'antiaging',   emoji: '✨', label: 'Anti-Aging & Longevity', color: '#c084fc',  threshold: 2 },
  cognitive:   { key: 'cognitive',   emoji: '🧠', label: 'Cognitive & Focus',      color: '#facc15',  threshold: 2 },
  immune:      { key: 'immune',      emoji: '🛡️', label: 'Immune Restoration',     color: '#4ade80',  threshold: 2 },
  hormonal:    { key: 'hormonal',    emoji: '⚡', label: 'Hormonal Optimization',  color: '#f97316',  threshold: 2 },
  // Extended domain aliases — map to existing matrix keys for filtering
  sleep:       { key: 'cognitive',   emoji: '😴', label: 'Sleep & Recovery',       color: '#818cf8',  threshold: 2 },
  sexual:      { key: 'hormonal',    emoji: '💋', label: 'Sexual Health',           color: '#f472b6',  threshold: 2 },
  inflammation:{ key: 'immune',      emoji: '🔴', label: 'Inflammation',            color: '#f87171',  threshold: 2 },
  neuro:       { key: 'cognitive',   emoji: '🎯', label: 'Neurological / ADD·ADHD', color: '#a78bfa',  threshold: 2 },
};

// ── HELPERS ───────────────────────────────────────────────

// Returns array of domain labels where score >= threshold (for "Also effective for" tags)
export function getSecondaryEffects(compoundId, primaryCategory) {
  const matrix = EFFECTS_MATRIX[compoundId];
  if (!matrix) return [];

  // Map primary category to matrix key
  const primaryKey = DOMAIN_CONFIG[primaryCategory]?.key;

  return Object.entries(DOMAIN_CONFIG)
    .filter(([filterId, cfg]) => {
      const score = matrix[cfg.key] ?? 0;
      const isPrimary = cfg.key === primaryKey;
      return !isPrimary && score >= 2;
    })
    .map(([filterId, cfg]) => ({
      filterId,
      emoji: cfg.emoji,
      label: cfg.label,
      score: matrix[cfg.key],
      color: cfg.color,
    }))
    .sort((a, b) => b.score - a.score);
}

// Returns whether a compound qualifies for a given filter
export function compoundMatchesDomain(compoundId, filterCat) {
  if (filterCat === 'all') return true;
  const matrix = EFFECTS_MATRIX[compoundId];
  if (!matrix) return false;
  const cfg = DOMAIN_CONFIG[filterCat];
  if (!cfg) return false;
  return (matrix[cfg.key] ?? 0) >= cfg.threshold;
}
