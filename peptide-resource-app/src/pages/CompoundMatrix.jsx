import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { COMPOUNDS } from '../data/compounds';
import { EFFECTS_MATRIX, DOMAIN_CONFIG } from '../data/effects-matrix';
import CompoundDetail from '../components/CompoundDetail';

const DOMAINS = [
  { key: 'healing',     label: 'Healing',     emoji: '🩹', color: '#4ade80',  bg: 'rgba(74,222,128,0.08)'  },
  { key: 'fat_loss',    label: 'Fat Loss',     emoji: '🔥', color: '#fb923c',  bg: 'rgba(251,146,60,0.08)'  },
  { key: 'performance', label: 'Performance',  emoji: '💪', color: '#60a5fa',  bg: 'rgba(96,165,250,0.08)'  },
  { key: 'antiaging',   label: 'Anti-Aging',   emoji: '✨', color: '#c084fc',  bg: 'rgba(192,132,252,0.08)' },
  { key: 'cognitive',   label: 'Cognitive',    emoji: '🧠', color: '#fde68a',  bg: 'rgba(253,230,138,0.08)' },
  { key: 'immune',      label: 'Immune',       emoji: '🛡️', color: '#34d399',  bg: 'rgba(52,211,153,0.08)'  },
  { key: 'hormonal',    label: 'Hormonal',     emoji: '⚡', color: '#f97316',  bg: 'rgba(249,115,22,0.08)'  },
];

// 5-segment bar — cleaner than dots, easier to read at a glance
function ScoreBar({ score, color, maxScore = 3 }) {
  // Convert 1-3 scale to 1-5 display
  const display = Math.round((score / maxScore) * 5);
  if (display === 0) return <span style={{ color: 'rgba(255,255,255,0.1)', fontSize: '0.75rem' }}>—</span>;

  return (
    <div style={{ display: 'flex', gap: '3px', alignItems: 'center', justifyContent: 'center' }}>
      {[1, 2, 3, 4, 5].map(i => (
        <div
          key={i}
          style={{
            width: '6px',
            height: i <= display ? '14px' : '8px',
            borderRadius: '3px',
            background: i <= display ? color : 'rgba(255,255,255,0.07)',
            transition: 'all 0.2s',
            flexShrink: 0,
          }}
        />
      ))}
    </div>
  );
}

// Confidence badge — clean pill style
function ConfidenceBadge({ level }) {
  const styles = {
    HIGH:   { color: '#4ade80', bg: 'rgba(74,222,128,0.1)',  border: 'rgba(74,222,128,0.25)'  },
    MEDIUM: { color: '#fbbf24', bg: 'rgba(251,191,36,0.1)',  border: 'rgba(251,191,36,0.25)'  },
    LOW:    { color: '#94a3b8', bg: 'rgba(148,163,184,0.08)', border: 'rgba(148,163,184,0.2)' },
  };
  const s = styles[level] || styles.LOW;
  return (
    <span style={{
      fontSize: '0.65rem',
      fontWeight: 700,
      letterSpacing: '0.06em',
      textTransform: 'uppercase',
      color: s.color,
      background: s.bg,
      border: `1px solid ${s.border}`,
      borderRadius: '6px',
      padding: '3px 8px',
      whiteSpace: 'nowrap',
    }}>
      {level}
    </span>
  );
}

export default function CompoundMatrix() {
  const [selected, setSelected] = useState(null);
  const [sortBy, setSortBy] = useState('name');
  const [filterDomain, setFilterDomain] = useState('all');
  const [search, setSearch] = useState('');

  const sorted = [...COMPOUNDS]
    .filter(c => {
      if (search) {
        const q = search.toLowerCase();
        return c.name.toLowerCase().includes(q) || c.tagline.toLowerCase().includes(q);
      }
      if (filterDomain === 'all') return true;
      const domainCfg = DOMAINS.find(d => d.key === filterDomain);
      if (!domainCfg) return true;
      const matrix = EFFECTS_MATRIX[c.id];
      return matrix && (matrix[filterDomain] || 0) >= 2;
    })
    .sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      const matA = EFFECTS_MATRIX[a.id] || {};
      const matB = EFFECTS_MATRIX[b.id] || {};
      const domCfg = DOMAINS.find(d => d.key === sortBy);
      if (!domCfg) return 0;
      return (matB[domCfg.key] || 0) - (matA[domCfg.key] || 0);
    });

  const activeDomain = DOMAINS.find(d => d.key === filterDomain);

  return (
    <div style={{ maxWidth: '1300px', margin: '0 auto', padding: '48px 20px' }}>

      {/* ── HEADER ── */}
      <div style={{ marginBottom: '36px' }}>
        <div className="section-eyebrow" style={{ marginBottom: '10px' }}>Compound Matrix</div>
        <h1 style={{
          fontSize: 'clamp(1.8rem, 4vw, 2.6rem)',
          fontWeight: 900,
          margin: '0 0 10px',
          color: '#fff',
          letterSpacing: '-0.03em',
        }}>
          All Compounds, Side by Side
        </h1>
        <p style={{ margin: 0, fontSize: '0.9rem', color: '#475569', lineHeight: 1.6 }}>
          Bars show strength of effect — 5 segments = primary mechanism. Click any row to dive deep.
        </p>
      </div>

      {/* ── CONTROLS ── */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '24px', flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <span style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#64748b', fontSize: '0.85rem' }}>🔍</span>
          <input
            className="input-dark"
            placeholder="Search compounds..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ paddingLeft: '36px', width: '220px' }}
          />
        </div>

        {/* Filter pills */}
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', flex: 1 }}>
          <button
            className={`pill ${filterDomain === 'all' ? 'active' : ''}`}
            onClick={() => setFilterDomain('all')}
          >
            All
          </button>
          {DOMAINS.map(d => (
            <button
              key={d.key}
              onClick={() => setFilterDomain(d.key)}
              style={{
                padding: '5px 12px',
                borderRadius: '20px',
                border: `1px solid ${filterDomain === d.key ? d.color : 'rgba(255,255,255,0.1)'}`,
                background: filterDomain === d.key ? d.bg : 'transparent',
                color: filterDomain === d.key ? d.color : '#64748b',
                fontSize: '0.78rem',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.15s',
                whiteSpace: 'nowrap',
              }}
            >
              {d.emoji} {d.label}
            </button>
          ))}
        </div>

        <div style={{ fontSize: '0.75rem', color: '#334155', whiteSpace: 'nowrap', flexShrink: 0 }}>
          {sorted.length} compounds
        </div>
      </div>

      {/* ── TABLE ── */}
      <div style={{
        overflowX: 'auto',
        borderRadius: '16px',
        border: '1px solid rgba(255,255,255,0.06)',
        background: 'rgba(255,255,255,0.015)',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '840px' }}>

          {/* Header row */}
          <thead style={{ position: 'sticky', top: 0, zIndex: 10, background: '#0d1525' }}>
            <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
              <th
                onClick={() => setSortBy('name')}
                style={{
                  padding: '16px 20px',
                  textAlign: 'left',
                  fontSize: '0.68rem',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.1em',
                  color: sortBy === 'name' ? '#d4af37' : '#334155',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  width: '260px',
                }}
              >
                Compound {sortBy === 'name' ? '↓' : ''}
              </th>
              <th style={{
                padding: '16px 12px',
                fontSize: '0.68rem',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.1em',
                color: '#334155',
                textAlign: 'center',
                whiteSpace: 'nowrap',
              }}>
                Confidence
              </th>
              {DOMAINS.map(d => (
                <th
                  key={d.key}
                  onClick={() => setSortBy(d.key)}
                  style={{
                    padding: '16px 10px',
                    textAlign: 'center',
                    fontSize: '0.68rem',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    color: sortBy === d.key ? d.color : '#334155',
                    borderLeft: '1px solid rgba(255,255,255,0.04)',
                    transition: 'color 0.15s',
                  }}
                >
                  <span style={{ display: 'block', fontSize: '1rem', marginBottom: '4px' }}>{d.emoji}</span>
                  {d.label} {sortBy === d.key ? '↓' : ''}
                </th>
              ))}
            </tr>
          </thead>

          {/* Body */}
          <tbody>
            {sorted.map((compound, idx) => {
              const matrix = EFFECTS_MATRIX[compound.id] || {};
              return (
                <tr
                  key={compound.id}
                  onClick={() => setSelected(compound)}
                  style={{
                    borderBottom: '1px solid rgba(255,255,255,0.04)',
                    cursor: 'pointer',
                    transition: 'background 0.12s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(212,175,55,0.05)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  {/* Compound name */}
                  <td style={{ padding: '14px 20px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <span style={{ fontSize: '1.3rem', flexShrink: 0, lineHeight: 1 }}>{compound.emoji}</span>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: '0.875rem', color: '#f1f5f9', lineHeight: 1.2 }}>
                          {compound.name}
                        </div>
                        <div style={{
                          fontSize: '0.7rem',
                          color: '#475569',
                          marginTop: '3px',
                          maxWidth: '200px',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}>
                          {compound.tagline}
                        </div>
                      </div>
                    </div>
                  </td>

                  {/* Confidence */}
                  <td style={{ padding: '14px 12px', textAlign: 'center' }}>
                    <ConfidenceBadge level={compound.confidence} />
                  </td>

                  {/* Domain scores */}
                  {DOMAINS.map(d => {
                    const score = matrix[d.key] || 0;
                    return (
                      <td
                        key={d.key}
                        style={{
                          padding: '14px 10px',
                          textAlign: 'center',
                          borderLeft: '1px solid rgba(255,255,255,0.04)',
                        }}
                      >
                        <ScoreBar score={score} color={d.color} />
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── LEGEND ── */}
      <div style={{
        marginTop: '16px',
        display: 'flex',
        gap: '8px',
        flexWrap: 'wrap',
        alignItems: 'center',
        padding: '12px 16px',
        background: 'rgba(255,255,255,0.02)',
        borderRadius: '10px',
        border: '1px solid rgba(255,255,255,0.04)',
      }}>
        <span style={{ fontSize: '0.7rem', color: '#334155', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginRight: '4px' }}>Strength</span>
        {[
          { bars: 1, label: 'Minimal' },
          { bars: 2, label: 'Secondary' },
          { bars: 3, label: 'Notable' },
          { bars: 4, label: 'Strong' },
          { bars: 5, label: 'Primary' },
        ].map(item => (
          <div key={item.bars} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '0 8px' }}>
            <div style={{ display: 'flex', gap: '2px', alignItems: 'flex-end' }}>
              {[1,2,3,4,5].map(i => (
                <div key={i} style={{
                  width: '5px',
                  height: i <= item.bars ? '12px' : '6px',
                  borderRadius: '2px',
                  background: i <= item.bars ? '#d4af37' : 'rgba(255,255,255,0.07)',
                }} />
              ))}
            </div>
            <span style={{ fontSize: '0.7rem', color: '#475569' }}>{item.label}</span>
          </div>
        ))}
        <span style={{ fontSize: '0.7rem', color: '#334155', marginLeft: 'auto' }}>
          Click any row → full profile
        </span>
      </div>

      {/* Detail modal */}
      {selected && <CompoundDetail compound={selected} onClose={() => setSelected(null)} />}

      <div style={{ marginTop: '40px' }} className="disclaimer">
        Educational resource only. Not medical advice. Scores reflect documented research evidence.
      </div>
    </div>
  );
}
