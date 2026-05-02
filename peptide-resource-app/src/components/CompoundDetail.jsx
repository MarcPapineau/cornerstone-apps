import { useState, useEffect } from 'react';
import { getReconNote, RECON_LEVEL_CONFIG } from '../data/reconstitution-notes';
import { getCategoryContext } from '../data/category-context';

const tabs = ['Overview', 'Dosing', 'Side Effects', 'Q&A', 'Research'];

const categoryColors = {
  healing: { bg: 'rgba(34,197,94,0.12)', color: '#4ade80', border: 'rgba(34,197,94,0.2)' },
  antiaging: { bg: 'rgba(168,85,247,0.12)', color: '#c084fc', border: 'rgba(168,85,247,0.2)' },
  performance: { bg: 'rgba(59,130,246,0.12)', color: '#60a5fa', border: 'rgba(59,130,246,0.2)' },
  weight: { bg: 'rgba(249,115,22,0.12)', color: '#fb923c', border: 'rgba(249,115,22,0.2)' },
  cognitive: { bg: 'rgba(234,179,8,0.12)', color: '#facc15', border: 'rgba(234,179,8,0.2)' },
  immune: { bg: 'rgba(34,197,94,0.12)', color: '#4ade80', border: 'rgba(34,197,94,0.2)' },
};

const categoryLabels = {
  healing: 'Healing',
  antiaging: 'Anti-Aging',
  performance: 'Performance',
  weight: 'Weight Loss',
  cognitive: 'Cognitive',
  immune: 'Immune',
};

export default function CompoundDetail({ compound, onClose, activeFilter }) {
  const [activeTab, setActiveTab] = useState('Overview');
  const cat = categoryColors[compound.category] || categoryColors.healing;
  // Show "why in this section" if viewing from a non-primary filter
  const crossCategoryContext = activeFilter && activeFilter !== 'all' && activeFilter !== compound.category
    ? getCategoryContext(compound.id, activeFilter)
    : null;

  // Close on escape
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handler);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  return (
    <div
      className="modal-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="modal-content" style={{ position: 'relative' }}>
        {/* Close button */}
        <button
          onClick={onClose}
          style={{
            position: 'absolute',
            top: '16px',
            right: '16px',
            background: 'rgba(255,255,255,0.08)',
            border: 'none',
            color: '#94a3b8',
            width: '32px',
            height: '32px',
            borderRadius: '8px',
            cursor: 'pointer',
            fontSize: '1.1rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10,
          }}
        >✕</button>

        {/* Header */}
        <div style={{ padding: '28px 28px 0' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '14px', paddingRight: '40px' }}>
            <span style={{ fontSize: '2.2rem' }}>{compound.emoji}</span>
            <div>
              <span style={{
                display: 'inline-block',
                padding: '3px 9px',
                borderRadius: '20px',
                fontSize: '0.7rem',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                background: cat.bg,
                color: cat.color,
                border: `1px solid ${cat.border}`,
                marginBottom: '6px',
              }}>{categoryLabels[compound.category]}</span>
              <h2 style={{ margin: '0 0 4px', fontSize: '1.5rem', fontWeight: 800, color: '#fff' }}>{compound.name}</h2>
              <p style={{ margin: 0, fontSize: '0.85rem', color: '#64748b' }}>{compound.fullName}</p>
            </div>
          </div>
          <p style={{ margin: '14px 0 0', fontSize: '0.95rem', color: '#d4af37', fontWeight: 500 }}>{compound.tagline}</p>

          {/* Why it appears in this filter category */}
          {crossCategoryContext && (
            <div style={{
              marginTop: '14px', padding: '12px 16px',
              background: 'rgba(212,175,55,0.07)', border: '1px solid rgba(212,175,55,0.2)', borderRadius: '10px',
            }}>
              <div style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#d4af37', marginBottom: '6px' }}>
                💡 Why it appears in this section
              </div>
              <p style={{ margin: 0, fontSize: '0.82rem', color: '#fde68a', lineHeight: 1.65 }}>{crossCategoryContext}</p>
            </div>
          )}
          {compound.inStock === false && (
            <div style={{marginTop:'10px', padding:'8px 12px', background:'rgba(245,158,11,0.08)', border:'1px solid rgba(245,158,11,0.2)', borderRadius:'8px', fontSize:'0.8rem', color:'#f59e0b', fontWeight:600}}>
              📦 Special Order — Contact Marc for availability: marc@cornerstoneregroup.ca
            </div>
          )}

          {/* Tabs */}
          <div style={{ display: 'flex', gap: '4px', marginTop: '20px', overflowX: 'auto', paddingBottom: '1px', scrollbarWidth: 'none' }}>
            {tabs.map(tab => (
              <button
                key={tab}
                className={`tab ${activeTab === tab ? 'active' : ''}`}
                onClick={() => setActiveTab(tab)}
              >{tab}</button>
            ))}
          </div>
        </div>

        <hr className="divider" style={{ margin: '0' }} />

        {/* Tab Content */}
        <div style={{ padding: '24px 28px 28px', maxHeight: '65vh', overflowY: 'auto' }}>
          {activeTab === 'Overview' && <OverviewTab compound={compound} />}
          {activeTab === 'Dosing' && <DosingTab compound={compound} />}
          {activeTab === 'Side Effects' && <SideEffectsTab compound={compound} />}
          {activeTab === 'Q&A' && <QATab compound={compound} />}
          {activeTab === 'Research' && <ResearchTab compound={compound} />}
        </div>
      </div>
    </div>
  );
}

function OverviewTab({ compound }) {
  // Find the most relevant study for the notable finding
  const keyStudy = compound.research && compound.research.length > 0
    ? (typeof compound.research[0] === 'object' ? compound.research[0] : null)
    : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

      {/* NOTABLE FINDING — eyebrow-raising research, shown first */}
      {compound.notable && (
        <div style={{
          background: 'linear-gradient(135deg, rgba(212,175,55,0.12), rgba(212,175,55,0.06))',
          border: '1px solid rgba(212,175,55,0.35)',
          borderRadius: '14px',
          padding: '18px 20px',
          position: 'relative',
          overflow: 'hidden',
        }}>
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, height: '3px',
            background: 'linear-gradient(90deg, #d4af37, #f5c842)',
          }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
            <span style={{ fontSize: '1rem' }}>🔬</span>
            <span style={{ fontSize: '0.7rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#d4af37' }}>
              What the Research Shows
            </span>
          </div>
          <p style={{ margin: '0 0 12px', fontSize: '0.9rem', color: '#fde68a', lineHeight: 1.65, fontWeight: 500 }}>
            {compound.notable}
          </p>
          {keyStudy && keyStudy.url && (
            <a
              href={keyStudy.url}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '6px',
                fontSize: '0.75rem', fontWeight: 700, color: '#d4af37',
                textDecoration: 'none', padding: '5px 12px',
                background: 'rgba(212,175,55,0.12)', borderRadius: '6px',
                border: '1px solid rgba(212,175,55,0.25)',
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(212,175,55,0.22)'}
              onMouseLeave={e => e.currentTarget.style.background = 'rgba(212,175,55,0.12)'}
            >
              📄 View Study: {keyStudy.journal || 'Source'} ↗
            </a>
          )}
          {keyStudy && !keyStudy.url && (
            <div style={{ fontSize: '0.75rem', color: '#92835a', fontStyle: 'italic' }}>
              📄 {keyStudy.journal}
            </div>
          )}
        </div>
      )}

      <div>
        <p style={{ margin: 0, fontSize: '0.95rem', color: '#cbd5e1', lineHeight: 1.7 }}>{compound.description}</p>
      </div>

      <div style={{ background: 'rgba(212,175,55,0.06)', border: '1px solid rgba(212,175,55,0.12)', borderRadius: '12px', padding: '16px' }}>
        <div style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#d4af37', marginBottom: '8px' }}>Mechanism of Action</div>
        <p style={{ margin: 0, fontSize: '0.875rem', color: '#94a3b8', lineHeight: 1.6 }}>{compound.mechanism}</p>
      </div>

      <div>
        <div style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#d4af37', marginBottom: '12px' }}>Benefits</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '8px' }}>
          {compound.benefits.map((b, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: 'rgba(255,255,255,0.04)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.06)' }}>
              <span style={{ color: '#4ade80', fontSize: '0.8rem' }}>✓</span>
              <span style={{ fontSize: '0.85rem', color: '#cbd5e1' }}>{b}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
        {[
          { label: 'Dose', value: compound.dose },
          { label: 'Frequency', value: compound.frequency },
          { label: 'Duration', value: compound.duration },
        ].map(item => (
          <div key={item.label} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '10px', padding: '14px', textAlign: 'center' }}>
            <div style={{ fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#64748b', marginBottom: '6px' }}>{item.label}</div>
            <div style={{ fontSize: '0.875rem', fontWeight: 600, color: '#fff' }}>{item.value}</div>
          </div>
        ))}
      </div>

      {/* Clinical Use Cases — only shown when present (e.g. Thymosin Alpha-1) */}
      {compound.clinicalUseCases && compound.clinicalUseCases.length > 0 && (
        <div style={{ background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.15)', borderRadius: '12px', padding: '18px' }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#4ade80', marginBottom: '12px' }}>🛡️ Clinical Use Cases</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
            {compound.clinicalUseCases.map((useCase, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', fontSize: '0.875rem', color: '#cbd5e1', lineHeight: 1.5 }}>
                <span style={{ color: '#4ade80', flexShrink: 0, marginTop: '2px' }}>→</span>
                <span>{useCase}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ background: 'rgba(100,116,139,0.1)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '10px', padding: '12px 16px' }}>
        <span style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#64748b' }}>Storage: </span>
        <span style={{ fontSize: '0.875rem', color: '#94a3b8' }}>{compound.storage}</span>
      </div>
    </div>
  );
}

function DosingTab({ compound }) {
  const r = compound.reconstitution;
  const reconNote = getReconNote(compound.id);
  const levelCfg = reconNote ? RECON_LEVEL_CONFIG[reconNote.level] : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

      {/* Reconstitution special note — shown FIRST if exists */}
      {reconNote && levelCfg && (
        <div style={{
          background: levelCfg.bg,
          border: `1px solid ${levelCfg.border}`,
          borderRadius: '12px',
          padding: '16px 18px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
            <span style={{ fontSize: '1rem' }}>{levelCfg.icon}</span>
            <div>
              <div style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: levelCfg.color }}>{levelCfg.label}</div>
              <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#fff', marginTop: '1px' }}>{reconNote.title.replace(/^[⚠️💡🚫]\s*/,'')}</div>
            </div>
          </div>
          <p style={{ margin: '0 0 12px', fontSize: '0.82rem', color: '#cbd5e1', lineHeight: 1.65 }}>{reconNote.body}</p>
          {reconNote.steps && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {reconNote.steps.map((step, i) => (
                <div key={i} style={{ display: 'flex', gap: '8px', fontSize: '0.78rem', color: '#94a3b8', lineHeight: 1.5 }}>
                  <span style={{ color: levelCfg.color, flexShrink: 0, fontWeight: 700 }}>{i + 1}.</span>
                  <span>{step}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Vial info */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
        {[
          { label: 'Vial Size', value: r.vialSize },
          { label: 'BAC Water', value: r.bacWater },
          { label: 'Concentration', value: r.concentration },
        ].map(item => (
          <div key={item.label} style={{ background: 'rgba(212,175,55,0.06)', border: '1px solid rgba(212,175,55,0.15)', borderRadius: '10px', padding: '14px', textAlign: 'center' }}>
            <div style={{ fontSize: '0.68rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#d4af37', marginBottom: '6px' }}>{item.label}</div>
            <div style={{ fontSize: '0.9rem', fontWeight: 700, color: '#fff' }}>{item.value}</div>
          </div>
        ))}
      </div>

      {/* Reconstitution steps */}
      <div>
        <div style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#d4af37', marginBottom: '12px' }}>Reconstitution Steps</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {r.steps.map((step, i) => (
            <div key={i} style={{ display: 'flex', gap: '14px', alignItems: 'flex-start' }}>
              <span style={{
                minWidth: '26px', height: '26px', borderRadius: '50%',
                background: 'rgba(212,175,55,0.15)', color: '#d4af37',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '0.75rem', fontWeight: 700, flexShrink: 0,
              }}>{i + 1}</span>
              <span style={{ fontSize: '0.9rem', color: '#cbd5e1', lineHeight: 1.5, paddingTop: '3px' }}>{step}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Syringe table */}
      <div>
        <div style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#d4af37', marginBottom: '12px' }}>Syringe Reference</div>
        <div style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: '10px', overflow: 'hidden' }}>
          <table className="syringe-table">
            <thead>
              <tr>
                <th>Dose</th>
                <th>Syringe Units (U-100)</th>
                <th>Volume</th>
              </tr>
            </thead>
            <tbody>
              {r.syringeTable.map((row, i) => (
                <tr key={i}>
                  <td style={{ fontWeight: 600, color: '#fff' }}>{row.dose}</td>
                  <td style={{ color: '#d4af37', fontWeight: 700 }}>{row.units} units</td>
                  <td>{row.ml}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p style={{ marginTop: '10px', fontSize: '0.78rem', color: '#64748b', lineHeight: 1.5 }}>
          💡 Using a U-100 insulin syringe: 1 unit = 0.01mL. Draw to the unit mark shown above.
        </p>
      </div>

      {/* BAC Water Warning */}
      {compound.reconstitution?.canUseBacWater === false && compound.reconstitution?.bacWaterWarning && (
        <div style={{
          background: 'rgba(239,68,68,0.10)',
          border: '2px solid rgba(239,68,68,0.45)',
          borderRadius: '12px',
          padding: '16px 18px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
            <span style={{ fontSize: '1.1rem' }}>⚠️</span>
            <span style={{ fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#f87171' }}>BAC Water Warning</span>
          </div>
          <p style={{ margin: '0 0 8px', fontSize: '0.875rem', color: '#fca5a5', lineHeight: 1.65, fontWeight: 600 }}>
            {compound.reconstitution.bacWaterWarning}
          </p>
          <p style={{ margin: 0, fontSize: '0.8rem', color: '#f87171' }}>
            <strong>Use instead:</strong> {compound.reconstitution.solvent}
          </p>
        </div>
      )}

      {/* Solvent note (for non-warning cases) */}
      {compound.reconstitution?.canUseBacWater !== false && compound.reconstitution?.solventNote && (
        <div style={{ background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.15)', borderRadius: '10px', padding: '12px 16px' }}>
          <span style={{ fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#60a5fa' }}>💧 Solvent: </span>
          <span style={{ fontSize: '0.82rem', color: '#94a3b8' }}>{compound.reconstitution.solvent} — {compound.reconstitution.solventNote}</span>
        </div>
      )}

      {/* Dosing Protocols — Conservative / Moderate / Aggressive */}
      {compound.dosingProtocol && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#d4af37', marginBottom: '0px' }}>📊 Dosing Protocols</div>

          {/* 3-column tier grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
            {[['conservative', '🟢', '#4ade80', 'rgba(34,197,94,0.08)', 'rgba(34,197,94,0.2)'],
              ['moderate',     '🟡', '#facc15', 'rgba(234,179,8,0.08)', 'rgba(234,179,8,0.2)'],
              ['aggressive',   '🔴', '#f87171', 'rgba(239,68,68,0.08)', 'rgba(239,68,68,0.2)']]
              .map(([tier, icon, color, bg, border]) => {
                const t = compound.dosingProtocol[tier];
                if (!t) return null;
                return (
                  <div key={tier} style={{ background: bg, border: `1px solid ${border}`, borderRadius: '10px', padding: '14px 12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '10px' }}>
                      <span style={{ fontSize: '0.8rem' }}>{icon}</span>
                      <span style={{ fontSize: '0.68rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color }}>{tier}</span>
                    </div>
                    <div style={{ fontSize: '1rem', fontWeight: 800, color: '#fff', marginBottom: '6px' }}>{t.dose}</div>
                    <div style={{ fontSize: '0.75rem', color: '#cbd5e1', marginBottom: '4px', lineHeight: 1.4 }}>{t.frequency}</div>
                    <div style={{ fontSize: '0.68rem', color, fontWeight: 600 }}>Weekly: {t.weeklyTotal}</div>
                  </div>
                );
              })}
          </div>

          {/* Timing and injection site */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <div style={{ background: 'rgba(212,175,55,0.06)', border: '1px solid rgba(212,175,55,0.15)', borderRadius: '10px', padding: '12px 14px' }}>
              <div style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: '#d4af37', marginBottom: '6px' }}>⏰ Timing</div>
              <p style={{ margin: 0, fontSize: '0.8rem', color: '#cbd5e1', lineHeight: 1.55 }}>{compound.dosingProtocol.timing}</p>
            </div>
            <div style={{ background: 'rgba(212,175,55,0.06)', border: '1px solid rgba(212,175,55,0.15)', borderRadius: '10px', padding: '12px 14px' }}>
              <div style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: '#d4af37', marginBottom: '6px' }}>💉 Injection Site</div>
              <p style={{ margin: 0, fontSize: '0.8rem', color: '#cbd5e1', lineHeight: 1.55 }}>{compound.dosingProtocol.injectionSite}</p>
            </div>
          </div>

          {/* Disclaimer */}
          <div style={{ background: 'rgba(100,116,139,0.08)', border: '1px solid rgba(100,116,139,0.15)', borderRadius: '8px', padding: '10px 14px' }}>
            <p style={{ margin: 0, fontSize: '0.72rem', color: '#64748b', fontStyle: 'italic', lineHeight: 1.55 }}>
              ⚠️ {compound.dosingProtocol.disclaimer}
            </p>
          </div>
        </div>
      )}

      {/* Storage */}
      <div style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)', borderRadius: '10px', padding: '14px 16px' }}>
        <span style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#60a5fa' }}>❄️ Storage: </span>
        <span style={{ fontSize: '0.875rem', color: '#94a3b8' }}>{compound.storage}</span>
      </div>
    </div>
  );
}

function SideEffectsTab({ compound }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Burn warning */}
      {compound.burnWarning && (
        <div className="warning-burn">
          <div style={{ fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#f87171', marginBottom: '8px' }}>🔥 Expected Burning — Read Before Injecting</div>
          <p style={{ margin: 0, fontSize: '0.875rem', color: '#fca5a5', lineHeight: 1.6 }}>{compound.burnNote}</p>
        </div>
      )}

      {/* Flush warning */}
      {compound.flushWarning && (
        <div className="warning-flush">
          <div style={{ fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#fb923c', marginBottom: '8px' }}>🌡️ Expected Flushing — Read Before Injecting</div>
          <p style={{ margin: 0, fontSize: '0.875rem', color: '#fdba74', lineHeight: 1.6 }}>{compound.flushNote}</p>
        </div>
      )}

      {/* Compound-specific side effects */}
      <div>
        <div style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#d4af37', marginBottom: '12px' }}>Known Side Effects</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {compound.sideEffects.map((se, i) => (
            <div key={i} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', padding: '10px 14px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
              <span style={{ color: '#fbbf24', marginTop: '1px', flexShrink: 0 }}>⚠</span>
              <span style={{ fontSize: '0.875rem', color: '#cbd5e1', lineHeight: 1.5 }}>{se}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Histamine education */}
      <div style={{ background: 'rgba(168,85,247,0.08)', border: '1px solid rgba(168,85,247,0.2)', borderRadius: '12px', padding: '20px' }}>
        <div style={{ fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#c084fc', marginBottom: '12px' }}>📚 Histamine Reactions — What You Need to Know</div>
        <p style={{ margin: '0 0 12px', fontSize: '0.875rem', color: '#d8b4fe', lineHeight: 1.6 }}>
          Some clients experience histamine reactions when starting peptides. This is a sign of underlying mast cell sensitivity — not a compound defect.
        </p>
        <p style={{ margin: '0 0 12px', fontSize: '0.875rem', color: '#d8b4fe', lineHeight: 1.6 }}>
          <strong style={{ color: '#c084fc' }}>Common histamine symptoms:</strong> Skin flushing, itching, hives, nasal congestion, anxiety, or GI discomfort within minutes of injection.
        </p>
        <p style={{ margin: '0 0 12px', fontSize: '0.875rem', color: '#d8b4fe', lineHeight: 1.6 }}>
          <strong style={{ color: '#c084fc' }}>Why it happens:</strong> Peptides can trigger mast cells in those with leaky gut or dysregulated immune tone. The reaction is from your mast cells — not the compound itself.
        </p>
        <div style={{ background: 'rgba(168,85,247,0.12)', borderRadius: '8px', padding: '12px 14px' }}>
          <strong style={{ fontSize: '0.85rem', color: '#c084fc' }}>🌿 Solution: KPV</strong>
          <p style={{ margin: '6px 0 0', fontSize: '0.85rem', color: '#d8b4fe' }}>
            KPV (Lys-Pro-Val) is the primary intervention. 100–250mcg before injection stabilizes mast cells. Most clients resolve reactions within 3-7 days. Consult Marc before adjusting your protocol.
          </p>
        </div>
      </div>
    </div>
  );
}

function QATab({ compound }) {
  const [openIdx, setOpenIdx] = useState(null);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {compound.faq.map((item, i) => (
        <div key={i} style={{ border: '1px solid rgba(255,255,255,0.06)', borderRadius: '10px', overflow: 'hidden' }}>
          <button
            onClick={() => setOpenIdx(openIdx === i ? null : i)}
            style={{
              width: '100%',
              background: openIdx === i ? 'rgba(212,175,55,0.08)' : 'rgba(255,255,255,0.02)',
              border: 'none',
              padding: '14px 16px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              cursor: 'pointer',
              gap: '12px',
            }}
          >
            <span style={{ fontSize: '0.9rem', fontWeight: 600, color: '#fff', textAlign: 'left' }}>{item.q}</span>
            <span style={{ color: '#d4af37', flexShrink: 0 }}>{openIdx === i ? '▲' : '▼'}</span>
          </button>
          {openIdx === i && (
            <div style={{ padding: '12px 16px 14px', background: 'rgba(212,175,55,0.04)', borderTop: '1px solid rgba(255,255,255,0.04)' }}>
              <p style={{ margin: 0, fontSize: '0.875rem', color: '#94a3b8', lineHeight: 1.7 }}>{item.a}</p>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function ResearchTab({ compound }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <p style={{ margin: '0 0 8px', fontSize: '0.875rem', color: '#64748b', lineHeight: 1.5 }}>
        Peer-reviewed research supporting this compound's mechanisms and effects. Click any study to read the source.
      </p>
      {compound.research.map((r, i) => {
        // Support both legacy string format and new object format
        const isObj = typeof r === 'object' && r !== null;
        const title = isObj ? r.title : r;
        const journal = isObj ? r.journal : null;
        const url = isObj ? r.url : null;

        return (
          <div key={i} style={{ borderRadius: '10px', border: '1px solid rgba(255,255,255,0.06)', overflow: 'hidden' }}>
            {url ? (
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: 'flex', gap: '12px', alignItems: 'flex-start', padding: '14px 16px', background: 'rgba(255,255,255,0.03)', textDecoration: 'none', transition: 'background 0.15s' }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(212,175,55,0.06)'}
                onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
              >
                <span style={{ color: '#d4af37', flexShrink: 0, marginTop: '2px' }}>📄</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '0.875rem', color: '#cbd5e1', lineHeight: 1.5, marginBottom: journal ? '4px' : 0 }}>{title}</div>
                  {journal && <div style={{ fontSize: '0.75rem', color: '#64748b', fontStyle: 'italic' }}>{journal}</div>}
                </div>
                <span style={{ color: '#d4af37', flexShrink: 0, fontSize: '0.75rem', fontWeight: 600, marginTop: '2px' }}>↗</span>
              </a>
            ) : (
              <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start', padding: '14px 16px', background: 'rgba(255,255,255,0.03)' }}>
                <span style={{ color: '#d4af37', flexShrink: 0 }}>📄</span>
                <span style={{ fontSize: '0.875rem', color: '#cbd5e1', lineHeight: 1.5 }}>{title}</span>
              </div>
            )}
          </div>
        );
      })}
      <div style={{ marginTop: '8px', padding: '14px 16px', background: 'rgba(59,130,246,0.06)', borderRadius: '10px', border: '1px solid rgba(59,130,246,0.15)' }}>
        <p style={{ margin: 0, fontSize: '0.8rem', color: '#60a5fa', lineHeight: 1.5 }}>
          ℹ️ All citations link to PubMed, journal sources, or ClinicalTrials.gov. For educational purposes only — not medical advice. Consult Marc for a personalized protocol.
        </p>
      </div>
    </div>
  );
}
