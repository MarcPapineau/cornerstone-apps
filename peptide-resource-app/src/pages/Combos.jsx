import { useState } from 'react';
import { COMBOS, FORMAT_CONFIG } from '../data/combos';
import { COMPOUNDS } from '../data/compounds';
import { EFFECTS_MATRIX } from '../data/effects-matrix';
import CompoundDetail from '../components/CompoundDetail';

// ── DOMAIN CONFIG for the benefit matrix table ──────────────
const TABLE_DOMAINS = [
  { key: 'healing',     label: 'Healing',     emoji: '🩹', color: '#4ade80' },
  { key: 'fat_loss',    label: 'Fat Loss',     emoji: '🔥', color: '#fb923c' },
  { key: 'performance', label: 'Performance',  emoji: '💪', color: '#60a5fa' },
  { key: 'antiaging',   label: 'Anti-Aging',   emoji: '✨', color: '#c084fc' },
  { key: 'cognitive',   label: 'Cognitive',    emoji: '🧠', color: '#facc15' },
  { key: 'immune',      label: 'Immune',       emoji: '🛡️', color: '#4ade80' },
  { key: 'hormonal',    label: 'Hormonal',     emoji: '⚡', color: '#f97316' },
];

// Single source of truth for effects data (fixes prior duplication drift)
const MATRIX_DATA = EFFECTS_MATRIX;

function ScoreDots({ score, color }) {
  if (!score) return <span style={{ color: 'rgba(255,255,255,0.06)', fontSize: '0.7rem' }}>—</span>;
  return (
    <div style={{ display: 'flex', gap: '3px', justifyContent: 'center' }}>
      {[1,2,3].map(i => (
        <div key={i} style={{
          width: '8px', height: '8px', borderRadius: '50%',
          background: i <= score ? color : 'rgba(255,255,255,0.08)',
        }} />
      ))}
    </div>
  );
}

function BenefitMatrix({ combo }) {
  // Get the compound IDs from the combo
  const compoundIds = combo.compounds.map(c => c.id);

  // Get domains that have at least one score > 0
  const activeDomains = TABLE_DOMAINS.filter(d =>
    compoundIds.some(id => (MATRIX_DATA[id]?.[d.key] || 0) > 0)
  );

  if (activeDomains.length === 0) return null;

  return (
    <div style={{ overflowX: 'auto', marginTop: '20px' }}>
      <div style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#d4af37', marginBottom: '12px' }}>
        Combined Effect Matrix
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '400px' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
            <th style={{ padding: '10px 14px', textAlign: 'left', fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: '#475569', width: '140px' }}>
              Compound
            </th>
            {activeDomains.map(d => (
              <th key={d.key} style={{ padding: '10px 8px', textAlign: 'center', fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#475569', whiteSpace: 'nowrap' }}>
                {d.emoji}<br />{d.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {combo.compounds.map((c, idx) => {
            const scores = MATRIX_DATA[c.id] || {};
            return (
              <tr key={c.id} style={{
                background: idx % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent',
                borderBottom: '1px solid rgba(255,255,255,0.04)',
              }}>
                <td style={{ padding: '12px 14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '1rem' }}>{c.emoji}</span>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '0.82rem', color: '#fff' }}>{c.name}</div>
                      <div style={{ fontSize: '0.65rem', color: '#475569', marginTop: '1px' }}>{c.role}</div>
                    </div>
                  </div>
                </td>
                {activeDomains.map(d => (
                  <td key={d.key} style={{ padding: '12px 8px', textAlign: 'center' }}>
                    <ScoreDots score={scores[d.key] || 0} color={d.color} />
                  </td>
                ))}
              </tr>
            );
          })}
          {/* Totals row */}
          <tr style={{ background: 'rgba(212,175,55,0.06)', borderTop: '2px solid rgba(212,175,55,0.15)' }}>
            <td style={{ padding: '12px 14px' }}>
              <div style={{ fontSize: '0.78rem', fontWeight: 800, color: '#d4af37' }}>Combined Power</div>
            </td>
            {activeDomains.map(d => {
              const total = compoundIds.reduce((sum, id) => sum + (MATRIX_DATA[id]?.[d.key] || 0), 0);
              const max = compoundIds.length * 3;
              const pct = Math.round((total / max) * 100);
              return (
                <td key={d.key} style={{ padding: '12px 8px', textAlign: 'center' }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: 800, color: pct >= 60 ? d.color : '#64748b' }}>
                    {pct}%
                  </div>
                  <div style={{ height: '3px', background: 'rgba(255,255,255,0.08)', borderRadius: '99px', marginTop: '4px', overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: d.color, borderRadius: '99px', transition: 'width 0.4s' }} />
                  </div>
                </td>
              );
            })}
          </tr>
        </tbody>
      </table>
      <div style={{ marginTop: '8px', fontSize: '0.68rem', color: '#334155' }}>
        ●●● Primary mechanism &nbsp;·&nbsp; ●● Notable effect &nbsp;·&nbsp; ● Minor/secondary &nbsp;·&nbsp; % = combined stack strength in that domain
      </div>
    </div>
  );
}

function ComboCard({ combo }) {
  const [expanded, setExpanded] = useState(false);
  const [viewingCompound, setViewingCompound] = useState(null);
  const fmt = FORMAT_CONFIG[combo.format] || FORMAT_CONFIG.vial;

  return (
    <div style={{
      background: 'rgba(255,255,255,0.02)',
      border: '1px solid rgba(255,255,255,0.07)',
      borderRadius: '18px',
      overflow: 'hidden',
      marginBottom: '20px',
    }}>
      {/* Header — always visible */}
      <div style={{ padding: '24px 28px', borderBottom: expanded ? '1px solid rgba(255,255,255,0.06)' : 'none' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: '260px' }}>
            {/* Format + Stock badges */}
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '12px', alignItems: 'center' }}>
              <span style={{ padding: '4px 11px', borderRadius: '20px', fontSize: '0.7rem', fontWeight: 700,
                background: fmt.bg, color: fmt.color, border: `1px solid ${fmt.border}` }}>
                {fmt.icon} {fmt.label}
              </span>
              {!combo.inStock && (
                <span style={{ padding: '4px 11px', borderRadius: '20px', fontSize: '0.7rem', fontWeight: 700,
                  background: 'rgba(245,158,11,0.1)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.2)' }}>
                  📦 Special Order
                </span>
              )}
            </div>
            <h3 style={{ margin: '0 0 8px', fontSize: '1.25rem', fontWeight: 800, color: '#fff' }}>
              {combo.emoji} {combo.name}
            </h3>
            <p style={{ margin: '0 0 14px', fontSize: '0.875rem', color: '#d4af37', fontWeight: 500 }}>{combo.tagline}</p>

            {/* Compound pills */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {combo.compounds.map(c => (
                <span key={c.id} style={{
                  padding: '5px 12px', borderRadius: '8px', fontSize: '0.78rem', fontWeight: 600,
                  background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#cbd5e1',
                  cursor: 'pointer',
                }}
                onClick={(e) => { e.stopPropagation(); const fc = COMPOUNDS.find(x=>x.id===c.id); if(fc) setViewingCompound(fc); }}>
                  {c.emoji} {c.name} {c.dose !== 'per dose' ? `· ${c.dose}` : ''}
                </span>
              ))}
            </div>
          </div>

          {/* Benefits preview */}
          <div style={{ minWidth: '200px', maxWidth: '280px' }}>
            <div style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: '#64748b', marginBottom: '8px' }}>Key Benefits</div>
            {combo.benefits.slice(0, 4).map((b, i) => (
              <div key={i} style={{ display: 'flex', gap: '7px', alignItems: 'flex-start', marginBottom: '5px', fontSize: '0.8rem', color: '#94a3b8', lineHeight: 1.4 }}>
                <span style={{ color: '#4ade80', flexShrink: 0 }}>✓</span>{b}
              </div>
            ))}
          </div>
        </div>

        <button onClick={() => setExpanded(!expanded)} style={{
          marginTop: '16px', background: expanded ? 'rgba(212,175,55,0.12)' : 'rgba(255,255,255,0.04)',
          border: `1px solid ${expanded ? 'rgba(212,175,55,0.3)' : 'rgba(255,255,255,0.08)'}`,
          borderRadius: '8px', padding: '9px 18px', cursor: 'pointer', fontFamily: 'inherit',
          fontSize: '0.82rem', fontWeight: 700, color: expanded ? '#d4af37' : '#94a3b8',
          transition: 'all 0.2s',
        }}>
          {expanded ? '▲ Hide Details' : '▼ Why This Combination Works'}
        </button>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div style={{ padding: '28px', display: 'flex', flexDirection: 'column', gap: '28px' }}>

          {/* Benefit matrix table */}
          <BenefitMatrix combo={combo} />

          {/* Why together */}
          <div>
            <div style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#d4af37', marginBottom: '14px' }}>
              Why These Compounds Work Better Together
            </div>
            {combo.whyTogether.split('\n\n').map((para, i) => (
              <p key={i} style={{ margin: '0 0 14px', fontSize: '0.875rem', color: '#94a3b8', lineHeight: 1.75 }}>{para}</p>
            ))}
          </div>

          {/* Why suspension (if exists) */}
          {combo.whySuspension && (
            <div style={{ background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.15)', borderRadius: '12px', padding: '18px' }}>
              <div style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#60a5fa', marginBottom: '10px' }}>
                💡 Why Pre-Compounded vs Individual Vials?
              </div>
              <p style={{ margin: 0, fontSize: '0.83rem', color: '#93c5fd', lineHeight: 1.7 }}>{combo.whySuspension}</p>
            </div>
          )}

          {/* Two columns: Ideal For + Dosing */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
            <div>
              <div style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#d4af37', marginBottom: '10px' }}>Ideal For</div>
              {combo.idealFor.map((item, i) => (
                <div key={i} style={{ display: 'flex', gap: '8px', fontSize: '0.82rem', color: '#94a3b8', marginBottom: '6px', lineHeight: 1.4 }}>
                  <span style={{ color: '#d4af37', flexShrink: 0 }}>→</span>{item}
                </div>
              ))}
            </div>
            <div>
              <div style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#d4af37', marginBottom: '10px' }}>Protocol</div>
              <div style={{ fontSize: '0.82rem', color: '#94a3b8', lineHeight: 1.7, marginBottom: '10px' }}>{combo.dosing}</div>
              <div style={{ fontSize: '0.78rem', color: '#64748b' }}>Duration: {combo.duration}</div>
            </div>
          </div>

          {/* Research */}
          {combo.research && combo.research.length > 0 && (
            <div>
              <div style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#d4af37', marginBottom: '10px' }}>Research</div>
              {combo.research.map((r, i) => (
                <a key={i} href={r.url} target="_blank" rel="noopener noreferrer" style={{
                  display: 'flex', gap: '10px', padding: '10px 12px', marginBottom: '6px',
                  background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)',
                  borderRadius: '8px', textDecoration: 'none', transition: 'background 0.15s',
                }}>
                  <span style={{ color: '#d4af37', flexShrink: 0 }}>📄</span>
                  <div>
                    <div style={{ fontSize: '0.8rem', color: '#cbd5e1', lineHeight: 1.4 }}>{r.title}</div>
                    <div style={{ fontSize: '0.7rem', color: '#64748b', marginTop: '3px', fontStyle: 'italic' }}>{r.journal}</div>
                  </div>
                </a>
              ))}
            </div>
          )}

          {/* CTA */}
          <div style={{ background: 'rgba(212,175,55,0.06)', border: '1px solid rgba(212,175,55,0.15)', borderRadius: '12px', padding: '18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontWeight: 700, color: '#fff', fontSize: '0.95rem', marginBottom: '4px' }}>Ready to start this protocol?</div>
              <div style={{ fontSize: '0.8rem', color: '#64748b' }}>Marc will build a personalized protocol around your goals and health history.</div>
            </div>
            <a href="/contact" style={{
              padding: '11px 22px', borderRadius: '10px', background: '#d4af37', color: '#000',
              textDecoration: 'none', fontWeight: 800, fontSize: '0.875rem', whiteSpace: 'nowrap', flexShrink: 0,
            }}>
              Ask Marc About This →
            </a>
          </div>

        </div>
      )}

      {/* Compound detail modal */}
      {viewingCompound && <CompoundDetail compound={viewingCompound} onClose={() => setViewingCompound(null)} />}
    </div>
  );
}

export default function Combos() {
  const [filter, setFilter] = useState('all');
  const cats = [
    { id: 'all',        label: 'All Combos' },
    { id: 'healing',    label: '🩹 Healing' },
    { id: 'performance',label: '💪 Performance' },
    { id: 'antiaging',  label: '✨ Anti-Aging' },
    { id: 'cognitive',  label: '🧠 Cognitive' },
    { id: 'immune',     label: '🛡️ Immune' },
  ];
  const filtered = filter === 'all' ? COMBOS : COMBOS.filter(c => c.category === filter);

  return (
    <div style={{ maxWidth: '1000px', margin: '0 auto', padding: '48px 20px' }}>
      {/* Header */}
      <div style={{ marginBottom: '40px' }}>
        <div className="section-eyebrow" style={{ marginBottom: '10px' }}>Pre-Compounded Blends</div>
        <h1 style={{ fontSize: 'clamp(1.8rem, 4vw, 2.8rem)', fontWeight: 900, margin: '0 0 14px', color: '#fff', letterSpacing: '-0.02em' }}>
          Compound Combos
        </h1>
        <p style={{ margin: '0 0 14px', fontSize: '1rem', color: '#64748b', lineHeight: 1.6, maxWidth: '620px' }}>
          Marc's pre-compounded blends pair compounds that work better together than apart. Click any combo to see exactly why each compound is included, the combined benefit matrix, and the full protocol.
        </p>
        {/* Vial vs pre-compounded education */}
        <div style={{ background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.15)', borderRadius: '12px', padding: '16px 20px', maxWidth: '700px' }}>
          <div style={{ fontWeight: 700, color: '#60a5fa', fontSize: '0.875rem', marginBottom: '8px' }}>🖊️ Why Pre-Compounded Costs More — And Why It's Worth It</div>
          <div style={{ fontSize: '0.82rem', color: '#93c5fd', lineHeight: 1.7 }}>
            Pre-compounded blends are suspended in a custom carrier solution (pH-buffered, sterility-controlled, excipient-stabilized) rather than individual lyophilized powders you reconstitute at home. Benefits:
            <strong style={{ color: '#fff' }}> (1)</strong> No degradation from reconstitution errors or pH mismatch
            <strong style={{ color: '#fff' }}> (2)</strong> Uniform dosing — every draw is identical
            <strong style={{ color: '#fff' }}> (3)</strong> Compounds are stabilized together — preventing cross-degradation
            <strong style={{ color: '#fff' }}> (4)</strong> Higher bioavailability from optimized suspension chemistry.
            You pay a modest premium for a significantly more reliable and effective product.
          </div>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '32px' }}>
        {cats.map(c => (
          <button key={c.id} className={`pill ${filter === c.id ? 'active' : ''}`} onClick={() => setFilter(c.id)}>
            {c.label}
          </button>
        ))}
      </div>

      {/* Combo cards */}
      {filtered.map(combo => <ComboCard key={combo.id} combo={combo} />)}

      <div className="disclaimer" style={{ marginTop: '48px' }}>
        Educational resource only. Not medical advice. All compounds for research purposes only. Consult a qualified healthcare professional before beginning any protocol.
      </div>
    </div>
  );
}
