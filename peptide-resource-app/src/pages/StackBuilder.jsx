import { useState, useMemo } from 'react';
import { COMPOUNDS } from '../data/compounds';
import { EFFECTS_MATRIX } from '../data/effects-matrix';

// ── DOMAINS ───────────────────────────────────────────────
const DOMAINS = [
  { key: 'healing',     label: 'Healing',     emoji: '🩹', color: '#34d399' },  // emerald
  { key: 'fat_loss',    label: 'Fat Loss',     emoji: '🔥', color: '#f97316' },  // orange
  { key: 'performance', label: 'Performance',  emoji: '💪', color: '#3b82f6' },  // blue
  { key: 'antiaging',   label: 'Anti-Aging',   emoji: '✨', color: '#a855f7' },  // violet
  { key: 'cognitive',   label: 'Cognitive',    emoji: '🧠', color: '#eab308' },  // amber
  { key: 'immune',      label: 'Immune',       emoji: '🛡️', color: '#14b8a6' },  // teal (distinct from emerald)
  { key: 'hormonal',    label: 'Hormonal',     emoji: '⚡', color: '#ec4899' },  // pink (distinct from orange)
];

// ── GOAL DEFINITIONS — weighted domains ───────────────────
// Each goal has primary/secondary/support domains with weights
// Score = weighted coverage of selected compounds across these domains
const GOALS = [
  {
    id: 'fat-loss',
    label: 'Fat Loss',
    emoji: '🔥',
    desc: 'Shed body fat, reset your metabolism',
    weights: { fat_loss: 3, hormonal: 2, performance: 1 },
    topCompounds: ['reta', 'aod9604', 'tesamorelin', 'motsc', 'amino1mq', 'cjc', 'ipamorelin'],
    insight: (score, compounds, missing) => {
      if (score >= 90) return `Your fat loss stack is dialled in. You have strong coverage across metabolic activation, hormonal signalling, and performance support. This is a complete protocol.`;
      if (score >= 70) return `Strong fat loss foundation. ${compounds[0]?.name || 'Your anchor compound'} is your metabolic driver. ${missing[0] ? `Adding ${missing[0].name} would boost ${missing[0].whyNeeded} — pushing your score to near 100%.` : 'Consider adding a GH optimizer like Ipamorelin to protect lean muscle as you lose fat.'}`;
      if (score >= 40) return `You have a start, but your stack needs more depth. Fat loss works best when you address appetite/metabolism (GLP-1), fat oxidation (AOD-9604 or SLU-PP-332), and lean muscle preservation (CJC/Ipamorelin). You're missing at least one layer.`;
      return `You need a fat loss anchor. Retatrutide is your best starting point — it's a triple-receptor agonist that addresses appetite, metabolism, and fat oxidation simultaneously. Add it first, then build around it.`;
    },
  },
  {
    id: 'healing',
    label: 'Healing & Recovery',
    emoji: '🩹',
    desc: 'Repair injuries, joints, gut, tissue',
    weights: { healing: 3, immune: 2, performance: 1 },
    topCompounds: ['bpc157', 'tb500', 'kpv', 'ghkcu', 'll37', 'ta1'],
    insight: (score, compounds, missing) => {
      if (score >= 90) return `Outstanding healing protocol. You've addressed local repair, systemic recovery, and inflammation control. This stack will heal what other approaches can't touch.`;
      if (score >= 70) return `Solid healing foundation. ${missing[0] ? `${missing[0].name} would complete your protocol by adding ${missing[0].whyNeeded}.` : 'Consider adding KPV if you have any gut issues or histamine sensitivity.'}`;
      if (score >= 40) return `Good start. The gold standard healing stack combines BPC-157 (local repair) + TB-500 (systemic healing) + KPV (inflammation control). You're missing pieces of this trio.`;
      return `Start with BPC-157 — it's the most studied healing peptide and works on tendons, gut, muscle, and nerves simultaneously. Pair it with TB-500 for full-body recovery.`;
    },
  },
  {
    id: 'performance',
    label: 'Athletic Performance',
    emoji: '⚡',
    desc: 'Strength, endurance, faster recovery',
    weights: { performance: 3, healing: 2, fat_loss: 1 },
    topCompounds: ['cjc', 'ipamorelin', 'tb500', 'motsc', 'slupppp332', 'igf1lr3'],
    insight: (score, compounds, missing) => {
      if (score >= 90) return `Elite performance stack. GH optimization + mitochondrial support + systemic recovery — this is what serious athletes use. Your training adaptations will compound faster.`;
      if (score >= 70) return `Strong performance protocol. ${missing[0] ? `${missing[0].name} would add ${missing[0].whyNeeded} to push toward 100%.` : 'You have the essentials covered.'}`;
      if (score >= 40) return `Performance starts with the GH axis. CJC-1295 + Ipamorelin is the foundation — bigger GH pulses = faster recovery, better body composition, improved sleep. Build from there.`;
      return `Add CJC-1295 DAC + Ipamorelin as your foundation. Together they produce a GH pulse 2-5x larger than either alone — the gold standard starting point for any performance protocol.`;
    },
  },
  {
    id: 'antiaging',
    label: 'Anti-Aging',
    emoji: '✨',
    desc: 'Cellular renewal, longevity, vitality',
    weights: { antiaging: 3, cognitive: 2, immune: 1 },
    topCompounds: ['nad', 'epithalon', 'ss31', 'motsc', 'ghkcu', 'glutathione'],
    insight: (score, compounds, missing) => {
      if (score >= 90) return `Comprehensive longevity protocol. You're addressing cellular energy, telomere maintenance, mitochondrial health, and tissue quality simultaneously. This is aggressive, evidence-based anti-aging.`;
      if (score >= 70) return `Strong anti-aging foundation. ${missing[0] ? `${missing[0].name} would add ${missing[0].whyNeeded}.` : 'Well rounded.'}`;
      if (score >= 40) return `Start with NAD+ — it's the foundational longevity molecule, fuelling every repair pathway in the body. Then add GHK-Cu for tissue remodelling and Epithalon for telomere support.`;
      return `NAD+ is your anti-aging foundation. It declines 50% between ages 40-60 and every longevity pathway depends on it. Start there, then build your stack around it.`;
    },
  },
  {
    id: 'cognitive',
    label: 'Cognitive & Focus',
    emoji: '🧠',
    desc: 'Mental clarity, memory, focus, ADD',
    weights: { cognitive: 3, performance: 1, immune: 1 },
    topCompounds: ['semax', 'selank', 'dsip', 'nad', 'p21', 'pinealon'],
    insight: (score, compounds, missing) => {
      if (score >= 90) return `Your cognitive stack is complete. Semax + Selank gives you sharp focus and calm simultaneously. DSIP and NAD+ ensure the overnight repair that makes it sustainable.`;
      if (score >= 70) return `Good cognitive foundation. ${missing[0] ? `${missing[0].name} would add ${missing[0].whyNeeded}.` : 'Consider adding DSIP for overnight brain repair — sleep is where cognitive gains are locked in.'}`;
      if (score >= 40) return `Semax + Selank is the classic cognitive duo — Semax sharpens focus and elevates BDNF; Selank removes the anxiety and mental noise that prevents sustained attention. Start there.`;
      return `Start with Semax — it directly elevates BDNF (the brain's growth factor), improving working memory, focus, and processing speed within 20-45 minutes of intranasal use. Pair with Selank for calm, sustained attention.`;
    },
  },
  {
    id: 'immune',
    label: 'Immune Defense',
    emoji: '🛡️',
    desc: 'Post-viral, autoimmune, inflammation',
    weights: { immune: 3, healing: 2, antiaging: 1 },
    topCompounds: ['ta1', 'kpv', 'll37', 'nad', 'vip'],
    insight: (score, compounds, missing) => {
      if (score >= 90) return `Complete immune restoration protocol. T-cell intelligence, antimicrobial defence, gut-immune axis, and cellular energy — all covered. This is what post-viral and autoimmune clients need.`;
      if (score >= 70) return `Strong immune foundation. ${missing[0] ? `${missing[0].name} would add ${missing[0].whyNeeded}.` : 'Consider adding NAD+ to fuel the immune cells that do the heavy lifting.'}`;
      if (score >= 40) return `Thymosin Alpha-1 is the anchor of any immune protocol — it restores T-cell intelligence that declines with age and illness. Add KPV to heal the gut-immune axis simultaneously.`;
      return `Start with Thymosin Alpha-1. It's the most studied immune-modulating peptide available, with clinical data in post-viral recovery, autoimmune conditions, and age-related immune decline. Nothing else comes close as an anchor.`;
    },
  },
  {
    id: 'sexual',
    label: 'Sexual Health',
    emoji: '💋',
    desc: 'Libido, hormonal balance, vitality',
    weights: { hormonal: 3, performance: 2, cognitive: 1 },
    topCompounds: ['pt141', 'kisspeptin', 'cjc', 'ipamorelin', 'nad'],
    insight: (score, compounds, missing) => {
      if (score >= 90) return `Complete sexual health and hormonal stack. PT-141 activates desire at the neurological level; Kisspeptin drives the upstream hormone cascade; GH optimization enhances everything downstream.`;
      if (score >= 70) return `Strong foundation. ${missing[0] ? `${missing[0].name} would add ${missing[0].whyNeeded}.` : 'Your hormonal coverage is solid.'}`;
      if (score >= 40) return `PT-141 is the most direct libido compound — it works on brain reward circuitry, not blood flow, so it addresses desire at the source. Pair with Kisspeptin to restore the upstream hormonal drive.`;
      return `Start with PT-141 (Bremelanotide) — FDA-approved for low desire, it activates melanocortin receptors in the brain to directly trigger sexual desire. It works where other approaches don't because it starts in the brain, not the body.`;
    },
  },
  {
    id: 'sleep',
    label: 'Sleep & Recovery',
    emoji: '😴',
    desc: 'Deep sleep, overnight repair, energy',
    weights: { cognitive: 2, healing: 2, hormonal: 2, performance: 1 },
    topCompounds: ['dsip', 'ipamorelin', 'selank', 'pinealon', 'nad'],
    insight: (score, compounds, missing) => {
      if (score >= 90) return `Your sleep protocol is dialled in. Deep sleep architecture, GH release, nervous system calm, and overnight repair — all addressed. Most clients see dramatic improvements within the first week.`;
      if (score >= 70) return `Good sleep foundation. ${missing[0] ? `${missing[0].name} would add ${missing[0].whyNeeded}.` : 'DSIP is the most direct sleep compound if you haven\'t added it yet.'}`;
      if (score >= 40) return `DSIP (Delta Sleep-Inducing Peptide) directly triggers the slow-wave sleep stages where repair and GH release happen. Pair with Selank to quiet the mental noise that prevents sleep onset.`;
      return `Start with DSIP — it's named for exactly what it does. It triggers the deep sleep stages most people spend too little time in, which is where memory consolidation, GH release, and cellular repair occur.`;
    },
  },
  {
    id: 'add',
    label: 'ADD / Neurological',
    emoji: '🎯',
    desc: 'Focus, attention, neuroplasticity',
    weights: { cognitive: 3, immune: 1, hormonal: 1 },
    topCompounds: ['semax', 'selank', 'dsip', 'nad', 'p21', 'pinealon'],
    insight: (score, compounds, missing) => {
      if (score >= 90) return `Complete ADD/neurological protocol. Semax drives BDNF for focus; Selank quiets the background noise; DSIP fixes sleep architecture; NAD+ fuels the dopaminergic system. This is how you rebuild a scattered brain.`;
      if (score >= 70) return `Strong neurological foundation. ${missing[0] ? `${missing[0].name} would add ${missing[0].whyNeeded}.` : 'Consider adding DSIP — ADD brains need quality slow-wave sleep more than most.'}`;
      if (score >= 40) return `The core ADD stack is Semax + Selank. Semax elevates BDNF and dopamine to drive focus and working memory. Selank removes the anxiety and racing thoughts that break attention. They work together — Semax drives up, Selank keeps you grounded.`;
      return `Start with Semax — it's specifically studied for focus and cognitive enhancement, elevating BDNF within 20-45 minutes of intranasal use. ADD brains often respond dramatically because Semax directly addresses the BDNF and dopamine deficits at the root of attention issues.`;
    },
  },
  {
    id: 'metabolic',
    label: 'Metabolic Health',
    emoji: '🩺',
    desc: 'Insulin resistance, pre-diabetes, energy',
    weights: { fat_loss: 2, hormonal: 3, antiaging: 2, performance: 1 },
    topCompounds: ['reta', 'motsc', 'slupppp332', 'amino1mq', 'nad', 'tesamorelin'],
    insight: (score, compounds, missing) => {
      if (score >= 90) return `Comprehensive metabolic protocol. You're addressing insulin signalling, mitochondrial function, fat cell metabolism, and cellular energy — attacking metabolic dysfunction from every angle.`;
      if (score >= 70) return `Strong metabolic foundation. ${missing[0] ? `${missing[0].name} would add ${missing[0].whyNeeded}.` : 'MOTS-c would complement your stack with direct mitochondrial metabolic activation.'}`;
      if (score >= 40) return `Retatrutide anchors metabolic protocols — it improves insulin sensitivity, reduces visceral fat, and resets metabolic signalling at the receptor level. Add MOTS-c for mitochondrial support and 5-Amino-1MQ to reactivate dormant fat cells.`;
      return `Start with Retatrutide for metabolic health — it's the most comprehensive metabolic compound available, targeting three receptor pathways simultaneously to improve insulin sensitivity, reduce visceral fat, and reset metabolic function.`;
    },
  },
];

// ── SYNERGIES ─────────────────────────────────────────────
const SYNERGIES = {
  'bpc157+tb500':   '🔥 Repair Duo — local + systemic healing',
  'cjc+ipamorelin': '⚡ GH Pulse Stack — 2-5x larger GH release',
  'semax+selank':   '🧠 Focus + Calm — the perfect nootropic pair',
  'nad+ghkcu':      '✨ Cellular Renewal — energy + structural repair',
  'kpv+ta1':        '🛡️ Immune-Gut Axis — root cause immunity',
  'epithalon+motsc':'⏳ Longevity Duo — telomere + mitochondria',
  'semax+dsip':     '😴 Focus + Deep Sleep — day sharp, night repair',
  'pt141+kisspeptin':'💋 Hormonal Stack — desire + upstream LH signal',
  'reta+aod9604':   '🔥 Metabolic Power — triple agonist + direct fat oxidation',
  'ss31+motsc':     '⚡ Mito Stack — protect + build mitochondria',
  'bpc157+kpv':     '🌿 Gut Repair — tight junctions + mast cell control',
  'cjc+tb500':      '💪 Build & Repair — GH optimization + systemic healing',
  'nad+semax':      '🧠 Brain Power — cellular energy + BDNF',
  'dsip+p21':       '🧬 Night Protocol — deep sleep + neurogenesis',
  'reta+motsc':     '🔥 Metabolic Elite — GLP-1 + mitochondrial activation',
  'ta1+kpv':        '🛡️ Immune Foundation — T-cell + gut-immune healing',
  'nad+epithalon':  '⏳ Deep Longevity — NAD+ fuels telomerase activation',
  'igf1lr3+cjc':    '💪 Anabolic Stack — GH axis + direct IGF signalling',
};
function synergyKey(a, b) { return [a,b].sort().join('+'); }
function getSynergies(ids) {
  const found = [];
  for (let i = 0; i < ids.length; i++)
    for (let j = i+1; j < ids.length; j++) {
      const k = synergyKey(ids[i], ids[j]);
      if (SYNERGIES[k]) found.push(SYNERGIES[k]);
    }
  return found;
}

// ── SCORING — weighted per goal ───────────────────────────
function scoreForGoal(goal, selectedIds) {
  if (!goal || selectedIds.length === 0) return 0;
  const weights = goal.weights;
  const totalWeight = Object.values(weights).reduce((s, w) => s + w, 0);
  let earned = 0;
  Object.entries(weights).forEach(([dk, w]) => {
    const best = Math.max(0, ...selectedIds.map(id => EFFECTS_MATRIX[id]?.[dk] || 0));
    earned += (best / 3) * w;
  });
  return Math.round((earned / totalWeight) * 100);
}

// Missing compounds — what would most improve the score
function getMissing(goal, selectedIds) {
  if (!goal) return [];
  const weights = goal.weights;
  // Find weakest covered domain
  const weak = Object.entries(weights)
    .map(([dk, w]) => {
      const best = Math.max(0, ...selectedIds.map(id => EFFECTS_MATRIX[id]?.[dk] || 0));
      return { dk, w, best, gap: (3 - best) * w };
    })
    .sort((a, b) => b.gap - a.gap)
    .slice(0, 2);

  return COMPOUNDS
    .filter(c => !selectedIds.includes(c.id))
    .map(c => {
      const matrix = EFFECTS_MATRIX[c.id] || {};
      const value = weak.reduce((s, { dk, w }) => s + (matrix[dk] || 0) * w, 0);
      const topWeak = weak[0];
      const domainName = DOMAINS.find(d => d.key === topWeak?.dk)?.label || '';
      return {
        compound: c,
        value,
        name: c.name,
        whyNeeded: domainName ? `${domainName} support` : 'goal coverage',
      };
    })
    .filter(r => r.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 3);
}

// ── RADAR CHART ───────────────────────────────────────────
function RadarChart({ domainScores, selectedIds, goalDomainKeys }) {
  const size = 240;
  const cx = size / 2;
  const cy = size / 2;
  const r = 78;
  const count = DOMAINS.length;
  function angle(i) { return (Math.PI * 2 * i) / count - Math.PI / 2; }
  function pt(i, rad) { return { x: cx + rad * Math.cos(angle(i)), y: cy + rad * Math.sin(angle(i)) }; }
  const maxScore = Math.max(selectedIds.length * 3, 1);
  const scorePts = DOMAINS.map((d, i) => {
    const raw = domainScores[d.key] || 0;
    return pt(i, Math.min(raw / maxScore, 1) * r);
  });
  const scorePath = scorePts.map((p, i) => `${i===0?'M':'L'} ${p.x} ${p.y}`).join(' ') + ' Z';

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ overflow: 'visible' }}>
      {[0.25,0.5,0.75,1].map(ring => {
        const pts = DOMAINS.map((_,i) => pt(i, r*ring));
        return <path key={ring} d={pts.map((p,i)=>`${i===0?'M':'L'} ${p.x} ${p.y}`).join(' ')+' Z'} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />;
      })}
      {DOMAINS.map((_,i) => { const tip=pt(i,r); return <line key={i} x1={cx} y1={cy} x2={tip.x} y2={tip.y} stroke="rgba(255,255,255,0.07)" strokeWidth="1" />; })}
      {selectedIds.length > 0 && <path d={scorePath} fill="rgba(212,175,55,0.15)" stroke="rgba(212,175,55,0.7)" strokeWidth="1.5" strokeLinejoin="round" />}
      {selectedIds.length > 0 && scorePts.map((p,i) => {
        const score = domainScores[DOMAINS[i].key] || 0;
        return score > 0 ? <circle key={i} cx={p.x} cy={p.y} r="3" fill={DOMAINS[i].color} /> : null;
      })}
      {DOMAINS.map((d,i) => {
        const lp = pt(i, r+20);
        const isGoal = goalDomainKeys?.includes(d.key);
        return (
          <g key={i}>
            <text x={lp.x} y={lp.y-5} textAnchor="middle" dominantBaseline="middle" fontSize="11">{d.emoji}</text>
            <text x={lp.x} y={lp.y+7} textAnchor="middle" dominantBaseline="middle" fontSize="6.5"
              fontWeight={isGoal ? '800' : '500'} fill={isGoal ? '#d4af37' : '#64748b'} fontFamily="inherit">
              {d.label}
            </text>
            {isGoal && <circle cx={lp.x} cy={lp.y-14} r="2.5" fill="#d4af37" opacity="0.8" />}
          </g>
        );
      })}
    </svg>
  );
}

// ── SCORE SQUARES — consistent size, distinct color per domain ──
function ScoreDots({ score, color }) {
  return (
    <div style={{ display:'flex', gap:'2px', justifyContent:'center', alignItems:'center' }}>
      {[1,2,3].map(i => (
        <div key={i} style={{
          width:'9px', height:'9px', borderRadius:'2px', flexShrink:0,
          background: i<=score ? color : 'rgba(255,255,255,0.07)',
        }} />
      ))}
    </div>
  );
}

// ── GHL SUBMIT ────────────────────────────────────────────
async function submitToGHL(contact, compounds, goalLabels, score) {
  const stackText = compounds.map(c => `${c.name} — ${c.dose}`).join('\n');
  const note = `STACK BUILDER LEAD\nGoals: ${goalLabels}\nScore: ${score}%\nStack:\n${stackText}\nNotes: ${contact.notes||'None'}`;
  try {
    const res = await fetch('https://services.leadconnectorhq.com/contacts/', {
      method:'POST', headers:{'Authorization':'Bearer REDACTED-ROTATE-VIA-LEVITE','Content-Type':'application/json','Version':'2021-07-28'},
      body: JSON.stringify({ firstName:contact.name.split(' ')[0], lastName:contact.name.split(' ').slice(1).join(' ')||'', email:contact.email, phone:contact.phone||undefined, locationId:'VKXTy0VdENN4Nh0QQXZN', tags:['stack-builder-lead','cornerstone-re-health'], source:'Cornerstone RE Health — Stack Builder' }),
    });
    const data = await res.json();
    const contactId = data?.contact?.id;
    if (contactId) await fetch(`https://services.leadconnectorhq.com/contacts/${contactId}/notes`, {
      method:'POST', headers:{'Authorization':'Bearer REDACTED-ROTATE-VIA-LEVITE','Content-Type':'application/json','Version':'2021-07-28'},
      body: JSON.stringify({ body: note }),
    });
  } catch { /* silent */ }
}

// ═══════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════
export default function StackBuilder() {
  const [selectedGoalIds, setSelectedGoalIds] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [catFilter, setCatFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [step, setStep] = useState('build'); // build | submit | done
  const [contact, setContact] = useState({ name:'', email:'', phone:'', notes:'' });
  const [submitting, setSubmitting] = useState(false);

  const selectedGoals = GOALS.filter(g => selectedGoalIds.includes(g.id));
  const selectedCompounds = COMPOUNDS.filter(c => selectedIds.includes(c.id));
  const synergies = useMemo(() => getSynergies(selectedIds), [selectedIds]);

  // Domain scores (sum across all selected compounds)
  const domainScores = useMemo(() => {
    const scores = {};
    DOMAINS.forEach(d => {
      scores[d.key] = selectedIds.reduce((sum, id) => sum + (EFFECTS_MATRIX[id]?.[d.key] || 0), 0);
    });
    return scores;
  }, [selectedIds]);

  // All goal domain keys (for highlighting)
  const goalDomainKeys = useMemo(() => {
    const keys = new Set();
    selectedGoals.forEach(g => Object.keys(g.weights).forEach(k => keys.add(k)));
    return [...keys];
  }, [selectedGoals]);

  // Combined score across all selected goals (average)
  const overallScore = useMemo(() => {
    if (selectedGoals.length === 0 || selectedIds.length === 0) return null;
    const scores = selectedGoals.map(g => scoreForGoal(g, selectedIds));
    return Math.round(scores.reduce((s, v) => s + v, 0) / scores.length);
  }, [selectedGoals, selectedIds]);

  // Per-goal scores
  const perGoalScores = useMemo(() =>
    selectedGoals.map(g => ({ goal: g, score: scoreForGoal(g, selectedIds) })),
    [selectedGoals, selectedIds]
  );

  // Missing compounds for the weakest goal
  const missing = useMemo(() => {
    const weakGoal = perGoalScores.sort((a,b) => a.score - b.score)[0]?.goal;
    return getMissing(weakGoal, selectedIds);
  }, [perGoalScores, selectedIds]);

  // Score explanation
  const scoreExplanation = useMemo(() => {
    if (overallScore === null) return null;
    const goalLabels = selectedGoals.map(g => g.label).join(' + ');
    const weakGoal = perGoalScores.sort((a,b) => a.score - b.score)[0];
    const missingSuggestion = missing[0] ? `Adding ${missing[0].name} would strengthen your ${missing[0].whyNeeded}.` : '';

    // Use the weakest goal's insight function
    const missingForInsight = missing.map(m => ({ name: m.name, whyNeeded: m.whyNeeded }));
    const primaryInsight = weakGoal?.goal.insight(weakGoal.score, selectedCompounds, missingForInsight) || '';

    if (overallScore >= 90) return { color:'#4ade80', emoji:'🏆', headline:`Outstanding — ${overallScore}% coverage`, text: primaryInsight };
    if (overallScore >= 70) return { color:'#4ade80', emoji:'✅', headline:`Strong protocol — ${overallScore}% coverage`, text: primaryInsight + (missingSuggestion ? ' ' + missingSuggestion : '') };
    if (overallScore >= 50) return { color:'#d4af37', emoji:'⚡', headline:`Good foundation — ${overallScore}% coverage`, text: primaryInsight + (missingSuggestion ? ' ' + missingSuggestion : '') };
    if (overallScore >= 25) return { color:'#fb923c', emoji:'📈', headline:`Building — ${overallScore}% coverage`, text: primaryInsight };
    return { color:'#f87171', emoji:'🔴', headline:`Just getting started — ${overallScore}% coverage`, text: primaryInsight };
  }, [overallScore, selectedGoals, perGoalScores, missing, selectedCompounds]);

  // Recommended compound IDs — top compounds for selected goals not yet in stack
  const recommendedIds = useMemo(() => {
    if (selectedGoals.length === 0) return new Set();
    const rec = new Set();
    selectedGoals.forEach(g => {
      g.topCompounds
        .filter(id => !selectedIds.includes(id) && COMPOUNDS.find(c => c.id === id))
        .slice(0, 3)
        .forEach(id => rec.add(id));
    });
    return rec;
  }, [selectedGoals, selectedIds]);

  // Filtered + sorted compound list
  const filteredCompounds = useMemo(() => {
    const base = COMPOUNDS.filter(c => {
      const matchesCat = catFilter === 'all'
        || c.category === catFilter
        || (EFFECTS_MATRIX[c.id]?.[catFilter === 'weight' ? 'fat_loss' : catFilter] || 0) >= 1;
      const q = search.toLowerCase();
      return matchesCat && (!q || c.name.toLowerCase().includes(q) || c.tagline.toLowerCase().includes(q));
    });
    return [...base].sort((a, b) => {
      const aSelected = selectedIds.includes(a.id) ? 4 : 0;
      const bSelected = selectedIds.includes(b.id) ? 4 : 0;
      const aRec = recommendedIds.has(a.id) ? 3 : 0;
      const bRec = recommendedIds.has(b.id) ? 3 : 0;
      const aConf = a.confidence === 'HIGH' ? 1 : 0;
      const bConf = b.confidence === 'HIGH' ? 1 : 0;
      return (bSelected+bRec+bConf) - (aSelected+aRec+aConf);
    });
  }, [catFilter, search, selectedIds, recommendedIds]);

  function toggleGoal(goal) {
    setSelectedGoalIds(prev =>
      prev.includes(goal.id) ? prev.filter(g => g !== goal.id) : [...prev, goal.id]
    );
    // Do NOT auto-select compounds — just flag as recommended
  }

  function toggle(id) {
    setSelectedIds(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);
  }

  async function handleSubmit() {
    if (!contact.name || !contact.email || submitting) return;
    setSubmitting(true);
    const goalLabels = selectedGoals.map(g => g.label).join(', ');
    await submitToGHL(contact, selectedCompounds, goalLabels, overallScore || 0);
    setSubmitting(false);
    setStep('done');
  }

  const CAT_FILTERS = [
    { id:'all', label:'All' }, { id:'healing', label:'🩹 Healing' },
    { id:'performance', label:'💪 Performance' }, { id:'weight', label:'🔥 Fat Loss' },
    { id:'antiaging', label:'✨ Anti-Aging' }, { id:'cognitive', label:'🧠 Cognitive' },
    { id:'immune', label:'🛡️ Immune' }, { id:'hormonal', label:'⚡ Hormonal' },
  ];

  // ── RENDER ──────────────────────────────────────────────
  return (
    <div style={{ maxWidth:'1200px', margin:'0 auto', padding:'40px 20px' }}>
      <div style={{ marginBottom:'28px' }}>
        <div className="section-eyebrow" style={{ marginBottom:'8px' }}>Stack Builder</div>
        <h1 style={{ fontSize:'clamp(1.8rem,4vw,2.6rem)', fontWeight:900, margin:'0 0 8px', color:'#fff', letterSpacing:'-0.02em' }}>Build Your Protocol</h1>
        <p style={{ margin:0, fontSize:'0.9rem', color:'#64748b' }}>Select your goals → recommended compounds rise to the top → pick your stack → see your coverage score.</p>
      </div>

      {step === 'build' && (
        <div style={{ display:'grid', gridTemplateColumns:'1fr 400px', gap:'24px', alignItems:'start' }}>

          {/* LEFT */}
          <div>
            {/* Step 1 — Goals */}
            <div style={{ marginBottom:'24px' }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'10px' }}>
                <div style={{ fontSize:'0.72rem', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:'#d4af37' }}>
                  Step 1 — What are your goals? <span style={{ color:'#64748b', fontWeight:400, textTransform:'none', letterSpacing:0, fontSize:'0.7rem' }}>Pick one or more</span>
                </div>
                {selectedGoalIds.length > 0 && (
                  <button onClick={() => { setSelectedGoalIds([]); setSelectedIds([]); }}
                    style={{ background:'none', border:'none', color:'#475569', cursor:'pointer', fontSize:'0.7rem' }}>Reset all</button>
                )}
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(150px, 1fr))', gap:'8px' }}>
                {GOALS.map(g => {
                  const isActive = selectedGoalIds.includes(g.id);
                  const gscore = selectedIds.length > 0 ? scoreForGoal(g, selectedIds) : null;
                  return (
                    <button key={g.id} onClick={() => toggleGoal(g)} style={{
                      background: isActive ? 'rgba(212,175,55,0.12)' : 'rgba(255,255,255,0.03)',
                      border: isActive ? '2px solid rgba(212,175,55,0.55)' : '1px solid rgba(255,255,255,0.07)',
                      borderRadius:'10px', padding:'12px', cursor:'pointer', textAlign:'left',
                      transition:'all 0.15s', position:'relative',
                    }}>
                      {isActive && (
                        <div style={{ position:'absolute', top:'7px', right:'7px', width:'16px', height:'16px', borderRadius:'50%', background:'#d4af37', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'0.55rem', color:'#000', fontWeight:900 }}>✓</div>
                      )}
                      {isActive && gscore !== null && (
                        <div style={{ position:'absolute', bottom:'7px', right:'7px', fontSize:'0.6rem', fontWeight:800,
                          color: gscore >= 70 ? '#4ade80' : gscore >= 40 ? '#d4af37' : '#f87171' }}>
                          {gscore}%
                        </div>
                      )}
                      <div style={{ fontSize:'1.2rem', marginBottom:'4px' }}>{g.emoji}</div>
                      <div style={{ fontWeight:700, fontSize:'0.78rem', color: isActive ? '#d4af37' : '#fff', marginBottom:'2px' }}>{g.label}</div>
                      <div style={{ fontSize:'0.62rem', color:'#64748b', lineHeight:1.4 }}>{g.desc}</div>
                    </button>
                  );
                })}
              </div>
              {selectedGoalIds.length > 0 && (
                <div style={{ marginTop:'8px', fontSize:'0.72rem', color:'#d4af37', fontWeight:600 }}>
                  ✓ {selectedGoalIds.length} goal{selectedGoalIds.length > 1 ? 's' : ''} selected — ★ recommended compounds shown at top of list below
                </div>
              )}
            </div>

            {/* Step 2 — Pick compounds */}
            <div style={{ fontSize:'0.72rem', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:'#d4af37', marginBottom:'10px' }}>
              Step 2 — Add Compounds <span style={{ color:'#64748b', fontWeight:400, textTransform:'none', letterSpacing:0, fontSize:'0.7rem' }}>★ = recommended for your goals</span>
            </div>

            <div style={{ display:'flex', gap:'8px', marginBottom:'8px' }}>
              <div style={{ position:'relative', flex:1 }}>
                <span style={{ position:'absolute', left:'10px', top:'50%', transform:'translateY(-50%)', color:'#64748b' }}>🔍</span>
                <input className="input-dark" placeholder="Search compounds..." value={search}
                  onChange={e => setSearch(e.target.value)} style={{ paddingLeft:'32px', width:'100%' }} />
              </div>
            </div>
            <div style={{ display:'flex', gap:'5px', flexWrap:'wrap', marginBottom:'10px' }}>
              {CAT_FILTERS.map(f => (
                <button key={f.id} className={`pill ${catFilter === f.id ? 'active' : ''}`} onClick={() => setCatFilter(f.id)}>{f.label}</button>
              ))}
            </div>

            {/* Legend */}
            <div style={{ display:'flex', gap:'10px', flexWrap:'wrap', alignItems:'center', padding:'8px 12px', background:'rgba(255,255,255,0.02)', border:'1px solid rgba(255,255,255,0.05)', borderRadius:'8px', marginBottom:'10px' }}>
              <span style={{ fontSize:'0.62rem', fontWeight:700, color:'#475569', textTransform:'uppercase', letterSpacing:'0.06em', marginRight:'2px' }}>Key:</span>
              {DOMAINS.map(d => (
                <div key={d.key} style={{ display:'flex', alignItems:'center', gap:'5px' }}>
                  <div style={{ display:'flex', gap:'1px' }}>
                    {[1,2,3].map(i => <div key={i} style={{ width:'6px', height:'6px', borderRadius:'1px', background: i <= 2 ? d.color : 'rgba(255,255,255,0.07)' }} />)}
                  </div>
                  <span style={{ fontSize:'0.62rem', color:'#64748b' }}>{d.emoji} {d.label}</span>
                </div>
              ))}
              <div style={{ marginLeft:'auto', display:'flex', gap:'10px' }}>
                {[{n:1,l:'Minor'},{n:2,l:'Strong'},{n:3,l:'Primary'}].map(({n,l}) => (
                  <div key={n} style={{ display:'flex', alignItems:'center', gap:'4px' }}>
                    <div style={{ display:'flex', gap:'1px' }}>{[1,2,3].map(i=><div key={i} style={{ width:'6px',height:'6px',borderRadius:'1px',background:i<=n?'#94a3b8':'rgba(255,255,255,0.07)' }}/>)}</div>
                    <span style={{ fontSize:'0.6rem', color:'#475569' }}>{l}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Compound rows */}
            <div style={{ display:'flex', flexDirection:'column', gap:'5px', maxHeight:'420px', overflowY:'auto', paddingRight:'4px' }}>
              {filteredCompounds.map(c => {
                const isSelected = selectedIds.includes(c.id);
                const isRec = recommendedIds.has(c.id);
                const matrix = EFFECTS_MATRIX[c.id] || {};
                return (
                  <button key={c.id} onClick={() => toggle(c.id)} style={{
                    display:'grid', gridTemplateColumns:'20px 26px 1fr auto', gap:'9px', alignItems:'center',
                    padding:'9px 12px', borderRadius:'10px', cursor:'pointer', textAlign:'left', width:'100%',
                    border: isSelected ? '1px solid rgba(212,175,55,0.45)' : isRec ? '1px solid rgba(139,92,246,0.4)' : '1px solid rgba(255,255,255,0.05)',
                    background: isSelected ? 'rgba(212,175,55,0.08)' : isRec ? 'rgba(139,92,246,0.06)' : 'rgba(255,255,255,0.02)',
                    transition:'all 0.15s',
                  }}>
                    <div style={{ width:'16px', height:'16px', borderRadius:'4px', flexShrink:0,
                      border: isSelected ? '2px solid #d4af37' : '2px solid rgba(255,255,255,0.12)',
                      background: isSelected ? '#d4af37' : 'transparent',
                      display:'flex', alignItems:'center', justifyContent:'center' }}>
                      {isSelected && <span style={{ color:'#000', fontSize:'0.55rem', fontWeight:900 }}>✓</span>}
                    </div>
                    <span style={{ fontSize:'1rem' }}>{c.emoji}</span>
                    <div style={{ minWidth:0 }}>
                      <div style={{ fontWeight:600, fontSize:'0.82rem', color:'#fff', display:'flex', alignItems:'center', gap:'5px', flexWrap:'wrap' }}>
                        {c.name}
                        <span style={{ fontSize:'0.58rem', color: c.confidence==='HIGH'?'#4ade80':c.confidence==='MEDIUM'?'#facc15':'#94a3b8' }}>● {c.confidence}</span>
                        {isRec && !isSelected && (
                          <span style={{ fontSize:'0.57rem', padding:'1px 5px', borderRadius:'6px', background:'rgba(139,92,246,0.2)', color:'#a78bfa', fontWeight:800 }}>★ RECOMMENDED</span>
                        )}
                      </div>
                      <div style={{ fontSize:'0.68rem', color:'#64748b', marginTop:'1px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:'260px' }}>{c.tagline}</div>
                    </div>
                    <div style={{ display:'flex', gap:'3px', flexShrink:0 }}>
                      {goalDomainKeys.length > 0
                        ? goalDomainKeys.slice(0,4).map(dk => {
                            const d = DOMAINS.find(x=>x.key===dk);
                            const s = matrix[dk]||0;
                            return d && s > 0 ? <div key={dk} style={{ width:'7px',height:'7px',borderRadius:'2px',background:s>=2?d.color:d.color+'66' }} /> : null;
                          })
                        : DOMAINS.slice(0,4).map(d => {
                            const s = matrix[d.key]||0;
                            return s>0 ? <div key={d.key} style={{ width:'7px',height:'7px',borderRadius:'2px',background:s>=2?d.color:d.color+'66' }} /> : null;
                          })
                      }
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* RIGHT — Score panel */}
          <div style={{ position:'sticky', top:'80px', display:'flex', flexDirection:'column', gap:'12px' }}>

            {/* Header */}
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
              <div style={{ fontSize:'0.82rem', fontWeight:700, color:'#fff' }}>
                Your Stack <span style={{ color:'#d4af37' }}>({selectedIds.length})</span>
              </div>
              {selectedIds.length > 0 && (
                <button onClick={() => setSelectedIds([])} style={{ background:'none', border:'none', color:'#475569', cursor:'pointer', fontSize:'0.72rem' }}>Clear</button>
              )}
            </div>

            {/* Radar */}
            <div style={{ background:'rgba(255,255,255,0.02)', border:'1px solid rgba(255,255,255,0.07)', borderRadius:'14px', padding:'12px', display:'flex', justifyContent:'center' }}>
              <RadarChart domainScores={domainScores} selectedIds={selectedIds} goalDomainKeys={goalDomainKeys} />
            </div>

            {/* Score explanation */}
            {scoreExplanation && (
              <div style={{ background:`${scoreExplanation.color}0e`, border:`1px solid ${scoreExplanation.color}30`, borderRadius:'12px', padding:'14px' }}>
                <div style={{ display:'flex', alignItems:'center', gap:'8px', marginBottom:'8px' }}>
                  <span style={{ fontSize:'1.1rem' }}>{scoreExplanation.emoji}</span>
                  <span style={{ fontSize:'0.85rem', fontWeight:800, color:scoreExplanation.color }}>{scoreExplanation.headline}</span>
                </div>
                <p style={{ margin:0, fontSize:'0.75rem', color:'#cbd5e1', lineHeight:1.65 }}>{scoreExplanation.text}</p>
              </div>
            )}

            {/* Per-goal scores */}
            {perGoalScores.length > 0 && selectedIds.length > 0 && (
              <div style={{ background:'rgba(255,255,255,0.02)', border:'1px solid rgba(255,255,255,0.06)', borderRadius:'12px', padding:'12px' }}>
                <div style={{ fontSize:'0.65rem', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em', color:'#64748b', marginBottom:'8px' }}>Coverage Per Goal</div>
                {perGoalScores.map(({ goal, score }) => (
                  <div key={goal.id} style={{ display:'flex', alignItems:'center', gap:'8px', marginBottom:'7px' }}>
                    <span style={{ fontSize:'0.85rem', width:'18px', textAlign:'center' }}>{goal.emoji}</span>
                    <span style={{ fontSize:'0.72rem', color:'#94a3b8', flex:1 }}>{goal.label}</span>
                    <div style={{ width:'80px', height:'5px', background:'rgba(255,255,255,0.06)', borderRadius:'99px', overflow:'hidden' }}>
                      <div style={{ width:`${score}%`, height:'100%', borderRadius:'99px', transition:'width 0.4s',
                        background: score>=70?'#4ade80':score>=40?'#d4af37':'#f87171' }} />
                    </div>
                    <span style={{ fontSize:'0.7rem', fontWeight:800, width:'32px', textAlign:'right',
                      color: score>=70?'#4ade80':score>=40?'#d4af37':'#f87171' }}>{score}%</span>
                  </div>
                ))}
              </div>
            )}

            {/* Matrix table */}
            {selectedIds.length > 0 && (
              <div style={{ background:'rgba(255,255,255,0.02)', border:'1px solid rgba(255,255,255,0.07)', borderRadius:'12px', overflow:'hidden' }}>
                <div style={{ display:'grid', gridTemplateColumns:`100px repeat(${DOMAINS.length},1fr)`, background:'rgba(255,255,255,0.03)', borderBottom:'1px solid rgba(255,255,255,0.06)' }}>
                  <div style={{ padding:'7px 8px', fontSize:'0.55rem', fontWeight:700, textTransform:'uppercase', color:'#475569' }}>COMPOUND</div>
                  {DOMAINS.map(d => {
                    const isGoal = goalDomainKeys.includes(d.key);
                    return (
                      <div key={d.key} style={{ padding:'6px 2px', textAlign:'center', fontSize:'0.5rem', fontWeight: isGoal?800:500, color: isGoal?'#d4af37':'#475569', lineHeight:1.3, background:isGoal?'rgba(212,175,55,0.07)':'transparent', opacity:goalDomainKeys.length>0&&!isGoal?0.4:1, transition:'opacity 0.2s' }}>
                        <span style={{ fontSize:'0.72rem', display:'block' }}>{d.emoji}</span>{d.label}
                      </div>
                    );
                  })}
                </div>
                {selectedCompounds.map((c, idx) => {
                  const matrix = EFFECTS_MATRIX[c.id] || {};
                  return (
                    <div key={c.id} style={{ display:'grid', gridTemplateColumns:`100px repeat(${DOMAINS.length},1fr)`, background:idx%2===0?'rgba(255,255,255,0.01)':'transparent', borderBottom:'1px solid rgba(255,255,255,0.04)' }}>
                      <div style={{ padding:'7px 8px', display:'flex', alignItems:'center', gap:'4px' }}>
                        <span style={{ fontSize:'0.75rem', flexShrink:0 }}>{c.emoji}</span>
                        <div style={{ fontSize:'0.62rem', fontWeight:700, color:'#fff', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{c.name}</div>
                        <button onClick={() => toggle(c.id)} style={{ background:'none', border:'none', color:'#334155', cursor:'pointer', fontSize:'0.75rem', padding:0, marginLeft:'auto', flexShrink:0 }}>×</button>
                      </div>
                      {DOMAINS.map(d => {
                        const isGoal = goalDomainKeys.includes(d.key);
                        return (
                          <div key={d.key} style={{ display:'flex', alignItems:'center', justifyContent:'center', padding:'7px 2px', background:isGoal?'rgba(212,175,55,0.04)':'transparent', opacity:goalDomainKeys.length>0&&!isGoal?0.35:1 }}>
                            <ScoreDots score={matrix[d.key]||0} color={isGoal?d.color:'#64748b'} />
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
                {/* Coverage row */}
                <div style={{ display:'grid', gridTemplateColumns:`100px repeat(${DOMAINS.length},1fr)`, background:'rgba(212,175,55,0.06)', borderTop:'2px solid rgba(212,175,55,0.15)' }}>
                  <div style={{ padding:'7px 8px', fontSize:'0.58rem', fontWeight:800, color:'#d4af37' }}>COVERAGE</div>
                  {DOMAINS.map(d => {
                    const isGoal = goalDomainKeys.includes(d.key);
                    const best = selectedIds.length>0 ? Math.max(0,...selectedIds.map(id=>EFFECTS_MATRIX[id]?.[d.key]||0)) : 0;
                    const pct = Math.round((best/3)*100);
                    return (
                      <div key={d.key} style={{ padding:'5px 2px', textAlign:'center', background:isGoal?'rgba(212,175,55,0.06)':'transparent', opacity:goalDomainKeys.length>0&&!isGoal?0.3:1 }}>
                        {isGoal && <div style={{ fontSize:'0.45rem', color:'#d4af37', fontWeight:800, marginBottom:'1px' }}>★</div>}
                        <div style={{ fontSize:'0.65rem', fontWeight:800, color:pct>=67?d.color:pct>=34?'#d4af37':pct>0?'#f87171':'#334155' }}>
                          {pct>0?`${pct}%`:'—'}
                        </div>
                        {pct>0&&<div style={{ height:'2px', background:'rgba(255,255,255,0.06)', borderRadius:'99px', margin:'2px 2px 0', overflow:'hidden' }}><div style={{ width:`${pct}%`, height:'100%', background:isGoal?d.color:'#475569', borderRadius:'99px', transition:'width 0.3s' }} /></div>}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Synergies */}
            {synergies.length > 0 && (
              <div style={{ background:'rgba(34,197,94,0.06)', border:'1px solid rgba(34,197,94,0.15)', borderRadius:'10px', padding:'11px' }}>
                <div style={{ fontSize:'0.62rem', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em', color:'#4ade80', marginBottom:'7px' }}>⚡ Synergies</div>
                {synergies.map((s,i) => <div key={i} style={{ fontSize:'0.72rem', color:'#86efac', lineHeight:1.4, marginBottom:'3px' }}>{s}</div>)}
              </div>
            )}

            {/* Recommendations */}
            {missing.length > 0 && selectedIds.length > 0 && (
              <div style={{ background:'rgba(99,102,241,0.06)', border:'1px solid rgba(99,102,241,0.18)', borderRadius:'10px', padding:'11px' }}>
                <div style={{ fontSize:'0.62rem', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em', color:'#818cf8', marginBottom:'8px' }}>🎯 Add to Boost Your Score</div>
                {missing.map(r => (
                  <div key={r.compound.id} style={{ display:'flex', alignItems:'center', gap:'8px', marginBottom:'7px' }}>
                    <span style={{ fontSize:'0.85rem' }}>{r.compound.emoji}</span>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:'0.72rem', fontWeight:700, color:'#fff' }}>{r.compound.name}</div>
                      <div style={{ fontSize:'0.62rem', color:'#64748b' }}>Adds {r.whyNeeded}</div>
                    </div>
                    <button onClick={() => toggle(r.compound.id)} style={{ padding:'4px 9px', borderRadius:'6px', fontSize:'0.68rem', fontWeight:700, background:'rgba(99,102,241,0.15)', border:'1px solid rgba(99,102,241,0.3)', color:'#818cf8', cursor:'pointer', fontFamily:'inherit', flexShrink:0 }}>+ Add</button>
                  </div>
                ))}
              </div>
            )}

            {/* Legend */}
            <div style={{ display:'flex', gap:'12px', flexWrap:'wrap', fontSize:'0.62rem', color:'#334155' }}>
              {[{d:3,l:'Primary'},{d:2,l:'Notable'},{d:1,l:'Minor'}].map(({d,l}) => (
                <div key={d} style={{ display:'flex', alignItems:'center', gap:'4px' }}>
                  <div style={{ display:'flex', gap:'2px' }}>{[1,2,3].map(i=><div key={i} style={{ width:'5px',height:'5px',borderRadius:'50%',background:i<=d?'#d4af37':'rgba(255,255,255,0.08)' }} />)}</div>
                  <span>{l}</span>
                </div>
              ))}
            </div>

            <button onClick={() => setStep('submit')} disabled={selectedIds.length===0} className="btn-gold"
              style={{ width:'100%', padding:'13px', fontSize:'0.9rem', fontWeight:700, opacity:selectedIds.length===0?0.4:1, cursor:selectedIds.length===0?'not-allowed':'pointer' }}>
              Send Stack to Marc →
            </button>
          </div>
        </div>
      )}

      {/* SUBMIT */}
      {step === 'submit' && (
        <div style={{ maxWidth:'520px' }}>
          <h2 style={{ color:'#fff', fontWeight:700, marginBottom:'6px' }}>Send Your Stack to Marc</h2>
          <p style={{ color:'#64748b', fontSize:'0.875rem', marginBottom:'24px', lineHeight:1.6 }}>Marc reviews every stack personally and follows up within 24–48 hours.</p>
          <div style={{ background:'rgba(212,175,55,0.05)', border:'1px solid rgba(212,175,55,0.15)', borderRadius:'12px', padding:'14px', marginBottom:'24px' }}>
            <div style={{ fontSize:'0.68rem', fontWeight:700, textTransform:'uppercase', color:'#d4af37', marginBottom:'8px' }}>Your Stack ({selectedIds.length} compounds)</div>
            <div style={{ display:'flex', flexWrap:'wrap', gap:'5px' }}>
              {selectedCompounds.map(c => (
                <span key={c.id} style={{ padding:'3px 8px', borderRadius:'6px', background:'rgba(255,255,255,0.05)', border:'1px solid rgba(255,255,255,0.07)', color:'#cbd5e1', fontSize:'0.72rem' }}>{c.emoji} {c.name}</span>
              ))}
            </div>
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:'12px' }}>
            {[{k:'name',l:'Full Name',r:true,p:'Your name',t:'text'},{k:'email',l:'Email',r:true,p:'your@email.com',t:'email'},{k:'phone',l:'Phone (optional)',r:false,p:'+1 (613) 000-0000',t:'tel'}].map(f=>(
              <div key={f.k}>
                <label style={{ display:'block', fontSize:'0.7rem', fontWeight:600, color:'#94a3b8', marginBottom:'5px', textTransform:'uppercase', letterSpacing:'0.05em' }}>{f.l}{f.r?' *':''}</label>
                <input className="input-dark" type={f.t} placeholder={f.p} value={contact[f.k]} onChange={e=>setContact(p=>({...p,[f.k]:e.target.value}))} />
              </div>
            ))}
            <div>
              <label style={{ display:'block', fontSize:'0.7rem', fontWeight:600, color:'#94a3b8', marginBottom:'5px', textTransform:'uppercase', letterSpacing:'0.05em' }}>Notes (optional)</label>
              <textarea className="input-dark" rows={3} placeholder="Health history, goals, budget, experience..."
                value={contact.notes} onChange={e=>setContact(p=>({...p,notes:e.target.value}))} style={{ resize:'vertical', minHeight:'72px' }} />
            </div>
            <div style={{ display:'flex', gap:'10px' }}>
              <button onClick={()=>setStep('build')} style={{ flex:1, padding:'12px', borderRadius:'10px', background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.08)', color:'#94a3b8', cursor:'pointer', fontWeight:600, fontSize:'0.875rem', fontFamily:'inherit' }}>← Edit Stack</button>
              <button onClick={handleSubmit} disabled={!contact.name||!contact.email||submitting} className="btn-gold"
                style={{ flex:2, padding:'13px', fontWeight:700, fontSize:'0.9rem', opacity:(!contact.name||!contact.email)?0.45:1, cursor:(!contact.name||!contact.email)?'not-allowed':'pointer' }}>
                {submitting?'Sending...':'Send to Marc →'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DONE */}
      {step === 'done' && (
        <div style={{ maxWidth:'480px', textAlign:'center', padding:'60px 20px' }}>
          <div style={{ fontSize:'3.5rem', marginBottom:'16px' }}>✅</div>
          <h2 style={{ color:'#fff', fontWeight:800, marginBottom:'12px' }}>Stack Received</h2>
          <p style={{ color:'#94a3b8', fontSize:'0.95rem', lineHeight:1.7, marginBottom:'28px' }}>Marc will review your stack personally and follow up within 24–48 hours with a protocol recommendation.</p>
          <div style={{ display:'flex', gap:'10px', justifyContent:'center', flexWrap:'wrap' }}>
            <a href="/compounds" style={{ padding:'10px 20px', borderRadius:'10px', background:'rgba(255,255,255,0.05)', border:'1px solid rgba(255,255,255,0.09)', color:'#94a3b8', textDecoration:'none', fontWeight:600, fontSize:'0.875rem' }}>Browse Compounds</a>
            <a href="/combos" style={{ padding:'10px 20px', borderRadius:'10px', background:'rgba(255,255,255,0.05)', border:'1px solid rgba(255,255,255,0.09)', color:'#94a3b8', textDecoration:'none', fontWeight:600, fontSize:'0.875rem' }}>View Combos</a>
          </div>
        </div>
      )}

      {step !== 'done' && (
        <div style={{ marginTop:'48px' }} className="disclaimer">
          Educational resource only. Not medical advice. All compounds for research purposes only.
        </div>
      )}
    </div>
  );
}
