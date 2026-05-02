import { getSecondaryEffects } from '../data/effects-matrix';

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

export default function CompoundCard({ compound, onClick }) {
  const cat = categoryColors[compound.category] || categoryColors.healing;
  const secondaryEffects = getSecondaryEffects(compound.id, compound.category).slice(0, 2);

  return (
    <div
      className="card"
      onClick={() => onClick(compound)}
      style={{ cursor: 'pointer', padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '1.8rem' }}>{compound.emoji}</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: '1.1rem', color: '#fff' }}>{compound.name}</div>
            <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '1px' }}>{compound.fullName}</div>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px', flexShrink: 0 }}>
          <span
            className={`confidence-${compound.confidence.toLowerCase()}`}
            style={{ fontSize: '0.72rem', color: compound.confidence === 'HIGH' ? '#4ade80' : '#facc15', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}
          >
            ● {compound.confidence}
          </span>
        </div>
      </div>

      {/* Category badge + secondary effects */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', alignItems: 'center' }}>
        <span style={{
          display: 'inline-block',
          padding: '4px 10px',
          borderRadius: '20px',
          fontSize: '0.72rem',
          fontWeight: 600,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          background: cat.bg,
          color: cat.color,
          border: `1px solid ${cat.border}`,
        }}>
          {categoryLabels[compound.category]}
        </span>
        {secondaryEffects.map(e => (
          <span key={e.filterId} style={{
            display: 'inline-block',
            padding: '3px 8px',
            borderRadius: '20px',
            fontSize: '0.65rem',
            fontWeight: 600,
            background: 'rgba(255,255,255,0.04)',
            color: '#64748b',
            border: '1px solid rgba(255,255,255,0.06)',
          }}>
            {e.emoji} {e.label.split(' ')[0]}
          </span>
        ))}
        {compound.inStock === false && (
          <span style={{display:'inline-block', padding:'3px 9px', borderRadius:'20px', fontSize:'0.65rem', fontWeight:700, background:'rgba(245,158,11,0.12)', color:'#f59e0b', border:'1px solid rgba(245,158,11,0.2)'}}>
            📦 Special Order
          </span>
        )}
      </div>

      {/* Tagline */}
      <p style={{ margin: 0, fontSize: '0.875rem', color: '#94a3b8', lineHeight: 1.5 }}>
        {compound.tagline}
      </p>

      {/* Benefits */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
        {compound.benefits.slice(0, 3).map((b, i) => (
          <span key={i} style={{
            padding: '4px 10px',
            borderRadius: '6px',
            fontSize: '0.72rem',
            fontWeight: 500,
            background: 'rgba(255,255,255,0.05)',
            color: '#cbd5e1',
            border: '1px solid rgba(255,255,255,0.06)',
          }}>{b}</span>
        ))}
      </div>

      {/* Dose */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '10px 14px',
        background: 'rgba(212,175,55,0.06)',
        borderRadius: '8px',
        border: '1px solid rgba(212,175,55,0.12)',
      }}>
        <span style={{ fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#d4af37' }}>Dose</span>
        <span style={{ fontSize: '0.875rem', color: '#fff', fontWeight: 500 }}>{compound.dose}</span>
      </div>

      {/* CTA */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 'auto' }}>
        <span style={{ fontSize: '0.8rem', color: '#64748b' }}>{compound.duration}</span>
        <span style={{ fontSize: '0.8rem', color: '#d4af37', fontWeight: 600 }}>View Details →</span>
      </div>
    </div>
  );
}
