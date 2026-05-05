import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { COMPOUNDS } from '../data/compounds';
import { COMBOS } from '../data/combos';
import { compoundMatchesDomain, getSecondaryEffects } from '../data/effects-matrix';
import CompoundCard from '../components/CompoundCard';
import CompoundDetail from '../components/CompoundDetail';

// Per Marc 2026-05-04 + memory/feedback_klow_paired_compound_doctrine.md + memory/feedback_glow_plus_kpv_is_klow.md:
// Combo entities (KLOW, GLOW, CJC+Ipa, SS31+Cardiogen, etc.) appear as their own cards in
// the compound library so search finds them. Normalize combo shape to match CompoundCard +
// CompoundDetail's expected field names (whyTogether→mechanism, dosing→dose, etc.).
// glow-kpv was removed from combos.js per the doctrine — no separate filter needed here.
const NORMALIZED_COMBOS = COMBOS.map(combo => ({
  ...combo,
  confidence: combo.confidence || 'HIGH',
  fullName: combo.fullName || (combo.compounds ? `Blend: ${combo.compounds.map(c => c.name).join(' + ')}` : combo.name),
  benefits: combo.benefits || [],
  description: combo.description || combo.tagline,
  mechanism: combo.mechanism || combo.whyTogether || 'See "Why these together" for the mechanistic rationale.',
  dose: combo.dose || combo.dosing || 'Per Vitalis SOP — dosing protocol provided on enrollment.',
  frequency: combo.frequency || 'See dosing protocol below',
  storage: combo.storage || 'Refrigerate after reconstitution. Use within 28 days. Protect from light.',
  notable: combo.notable || combo.whySuspension || null,
  sideEffects: combo.sideEffects || [],
  faq: combo.faq || [],
  research: combo.research || [],
  reconstitution: combo.reconstitution || null,
  burnWarning: combo.burnWarning || false,
  flushWarning: combo.flushWarning || false,
  isCombo: true,
}));

const ALL_ENTRIES = [...COMPOUNDS, ...NORMALIZED_COMBOS];

const filters = [
  { id: 'all',         label: 'All Compounds' },
  { id: 'healing',     label: '🩹 Healing' },
  { id: 'performance', label: '💪 Performance' },
  { id: 'weight',      label: '🔥 Fat Loss' },
  { id: 'antiaging',   label: '✨ Anti-Aging' },
  { id: 'cognitive',   label: '🧠 Cognitive' },
  { id: 'immune',      label: '🛡️ Immune' },
  { id: 'hormonal',    label: '⚡ Hormonal' },
  { id: 'sleep',       label: '😴 Sleep' },
  { id: 'sexual',      label: '💋 Sexual Health' },
  { id: 'inflammation',label: '🔴 Inflammation' },
  { id: 'neuro',       label: '🎯 Neurological / ADD' },
];

export default function CompoundLibrary() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState('all');
  const [selected, setSelected] = useState(null);

  // Pre-fill category OR open specific compound from URL params
  useEffect(() => {
    const cat = searchParams.get('category');
    if (cat) setActiveFilter(cat);

    const id = searchParams.get('id');
    if (id) {
      const compound = ALL_ENTRIES.find(c => c.id === id);
      if (compound) {
        setSelected(compound);
        // Clean the id param from URL so back-navigation works cleanly
        const newParams = new URLSearchParams(searchParams);
        newParams.delete('id');
        setSearchParams(newParams, { replace: true });
      }
    }
  }, []); // Run once on mount only

  const filtered = ALL_ENTRIES.filter(c => {
    // Use effects matrix for domain matching — compounds can appear in multiple categories
    const matchesCategory = activeFilter === 'all' || compoundMatchesDomain(c.id, activeFilter) || c.category === activeFilter;
    const q = search.toLowerCase();
    const matchesSearch = !q || c.name.toLowerCase().includes(q) || c.tagline.toLowerCase().includes(q) || c.benefits.some(b => b.toLowerCase().includes(q));
    return matchesCategory && matchesSearch;
  });

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '48px 20px' }}>
      {/* Header */}
      <div style={{ marginBottom: '40px' }}>
        <div className="section-eyebrow" style={{ marginBottom: '10px' }}>Compound Library</div>
        <h1 style={{ fontSize: 'clamp(1.8rem, 4vw, 2.8rem)', fontWeight: 900, margin: '0 0 12px', color: '#fff', letterSpacing: '-0.02em' }}>
          Research Compound Profiles
        </h1>
        <p style={{ margin: 0, fontSize: '1rem', color: '#64748b', lineHeight: 1.6, maxWidth: '560px' }}>
          Detailed educational profiles on every compound in Marc's research protocols — mechanisms, dosing, reconstitution, and side effects.
        </p>
      </div>

      {/* View Toggle */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '24px' }}>
        <span style={{ fontSize: '0.78rem', color: '#475569', fontWeight: 600 }}>View:</span>
        <span style={{ padding: '6px 14px', borderRadius: '8px', fontSize: '0.8rem', fontWeight: 700,
          background: 'rgba(212,175,55,0.12)', color: '#d4af37', border: '1px solid rgba(212,175,55,0.25)' }}>
          🃏 Cards
        </span>
        <Link to="/matrix" style={{ padding: '6px 14px', borderRadius: '8px', fontSize: '0.8rem', fontWeight: 600,
          background: 'rgba(255,255,255,0.04)', color: '#64748b', border: '1px solid rgba(255,255,255,0.08)',
          textDecoration: 'none', transition: 'all 0.15s' }}>
          📊 Compare All (Matrix)
        </Link>
      </div>

      {/* Search + Filters */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '36px' }}>
        <div style={{ position: 'relative', maxWidth: '420px' }}>
          <span style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: '#64748b', fontSize: '1rem' }}>🔍</span>
          <input
            className="input-dark"
            placeholder="Search compounds, benefits..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ paddingLeft: '40px' }}
          />
        </div>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {filters.map(f => (
            <button
              key={f.id}
              className={`pill ${activeFilter === f.id ? 'active' : ''}`}
              onClick={() => setActiveFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Results count */}
      <div style={{ marginBottom: '24px', fontSize: '0.85rem', color: '#64748b' }}>
        {filtered.length} compound{filtered.length !== 1 ? 's' : ''} found
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '80px 20px', color: '#64748b' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '16px' }}>🔬</div>
          <p style={{ fontSize: '1rem' }}>No compounds match your search. Try adjusting the filters.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '20px' }}>
          {filtered.map(compound => (
            <CompoundCard key={compound.id} compound={compound} onClick={setSelected} />
          ))}
        </div>
      )}

      {/* Detail modal */}
      {selected && (
        <CompoundDetail compound={selected} onClose={() => setSelected(null)} activeFilter={activeFilter} />
      )}

      {/* Disclaimer */}
      <div style={{ marginTop: '60px' }} className="disclaimer">
        Educational resource only. Not medical advice. Consult a qualified healthcare professional before beginning any peptide protocol.
      </div>
    </div>
  );
}
