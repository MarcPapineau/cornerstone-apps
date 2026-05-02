// ============================================================
// Landing.jsx — Step 1: Goals
// 10-chip goal picker. Dark CRG bg, gold accents.
// Click a chip → /protocol/:goalSlug
// ============================================================

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

const GOALS = [
  { label: 'Cognitive & Focus',    slug: 'cognitive-focus',      icon: '🧠', tagline: 'BDNF, neuroprotection, sharp thinking' },
  { label: 'Fat Loss',             slug: 'fat-loss',             icon: '🔥', tagline: 'GLP-1, metabolic optimization, body composition' },
  { label: 'Healing & Recovery',   slug: 'healing-recovery',     icon: '🩹', tagline: 'Tissue repair, gut healing, systemic recovery' },
  { label: 'Athletic Performance', slug: 'athletic-performance', icon: '💪', tagline: 'GH optimization, endurance, strength' },
  { label: 'Anti-Aging',           slug: 'anti-aging',           icon: '✨', tagline: 'Cellular renewal, collagen, longevity signaling' },
  { label: 'Immune Defense',       slug: 'immune-defense',       icon: '🛡️', tagline: 'Thymus, immunity restoration, resilience' },
  { label: 'Sexual Health',        slug: 'sexual-health',        icon: '💫', tagline: 'PT-141, libido, function, vitality' },
  { label: 'Sleep & Recovery',     slug: 'sleep-recovery',       icon: '🌙', tagline: 'Deep sleep architecture, DSIP, melatonin regulation' },
  { label: 'ADD / Neurological',   slug: 'add-neurological',     icon: '⚡', tagline: 'Dopamine, focus, neuroprotection, calm alertness' },
  { label: 'Metabolic Health',     slug: 'metabolic-health',     icon: '⚙️', tagline: 'Insulin sensitivity, mitochondria, energy metabolism' },
];

export default function Landing() {
  const navigate = useNavigate();

  return (
    <div style={{
      minHeight: 'calc(100vh - 64px)',
      background: 'radial-gradient(ellipse at 50% 0%, rgba(212,175,55,0.07) 0%, transparent 60%), #0a1628',
      padding: '0 20px 60px',
    }}>

      {/* Hero */}
      <div style={{ maxWidth: '720px', margin: '0 auto', textAlign: 'center', padding: '72px 0 48px' }}>
        <div style={{
          display: 'inline-block',
          fontSize: '0.72rem',
          fontWeight: 700,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: '#d4af37',
          background: 'rgba(212,175,55,0.1)',
          border: '1px solid rgba(212,175,55,0.25)',
          borderRadius: '20px',
          padding: '5px 14px',
          marginBottom: '20px',
        }}>
          Step 1 of 5 — Choose Your Goal
        </div>

        <h1 style={{
          fontSize: 'clamp(2rem, 5vw, 3rem)',
          fontWeight: 900,
          margin: '0 0 16px',
          color: '#fff',
          letterSpacing: '-0.03em',
          lineHeight: 1.1,
        }}>
          What do you want to<br />
          <span style={{ color: '#d4af37' }}>optimize first?</span>
        </h1>

        <p style={{
          fontSize: '1rem',
          color: '#94a3b8',
          lineHeight: 1.7,
          margin: 0,
          maxWidth: '520px',
          marginLeft: 'auto',
          marginRight: 'auto',
        }}>
          Select your primary goal. We'll build a personalized peptide protocol
          matched to your biology — backed by peer-reviewed evidence.
        </p>
      </div>

      {/* Goal chips grid */}
      <div style={{
        maxWidth: '900px',
        margin: '0 auto',
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
        gap: '16px',
      }}>
        {GOALS.map(goal => (
          <GoalChip key={goal.slug} goal={goal} onSelect={() => navigate(`/protocol/${goal.slug}`)} />
        ))}
      </div>

      {/* Waterfall steps indicator */}
      <div style={{ maxWidth: '900px', margin: '48px auto 0', display: 'flex', justifyContent: 'center', gap: '8px', flexWrap: 'wrap' }}>
        {['Goals', 'Protocol', 'Personalize', 'Build', 'Book'].map((step, i) => (
          <div key={step} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '5px 12px',
              borderRadius: '20px',
              background: i === 0 ? 'rgba(212,175,55,0.15)' : 'rgba(255,255,255,0.04)',
              border: `1px solid ${i === 0 ? 'rgba(212,175,55,0.4)' : 'rgba(255,255,255,0.08)'}`,
            }}>
              <span style={{
                width: '18px', height: '18px',
                borderRadius: '50%',
                background: i === 0 ? '#d4af37' : 'rgba(255,255,255,0.1)',
                color: i === 0 ? '#0a1628' : '#64748b',
                fontSize: '0.7rem', fontWeight: 700,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>{i + 1}</span>
              <span style={{ fontSize: '0.78rem', fontWeight: 600, color: i === 0 ? '#d4af37' : '#64748b' }}>
                {step}
              </span>
            </div>
            {i < 4 && <span style={{ color: '#1e3a5f', fontSize: '1rem' }}>›</span>}
          </div>
        ))}
      </div>

      {/* Disclaimers */}
      <div style={{
        maxWidth: '900px',
        margin: '48px auto 0',
        padding: '20px 24px',
        background: 'rgba(255,255,255,0.02)',
        border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: '12px',
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <p style={{ margin: 0, fontSize: '0.75rem', color: '#475569', lineHeight: 1.5 }}>
            <span style={{ color: '#d4af37', fontWeight: 700 }}>No Medical Advice:</span> All content on this platform is for educational and research purposes only. Nothing here constitutes medical advice, diagnosis, or treatment. Consult a licensed physician before beginning any peptide protocol.
          </p>
          <p style={{ margin: 0, fontSize: '0.75rem', color: '#475569', lineHeight: 1.5 }}>
            <span style={{ color: '#d4af37', fontWeight: 700 }}>FDA Status:</span> These compounds are research peptides, not FDA-approved drugs for the indications discussed. Regulatory status varies by jurisdiction. This platform does not sell or dispense any compounds.
          </p>
          <p style={{ margin: 0, fontSize: '0.75rem', color: '#475569', lineHeight: 1.5 }}>
            <span style={{ color: '#d4af37', fontWeight: 700 }}>Evidence Tiers:</span> Studies are tagged T1 (RCT/meta-analysis), T2 (practitioner/observational), or T3 (animal/in-vitro). Not all compounds have equal human evidence. Tier tags are displayed on every protocol card.
          </p>
        </div>
      </div>
    </div>
  );
}

function GoalChip({ goal, onSelect }) {
  const [hovered, setHovered] = useState(false);

  return (
    <button
      onClick={onSelect}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '14px',
        padding: '18px 20px',
        borderRadius: '14px',
        background: hovered ? 'rgba(212,175,55,0.08)' : 'rgba(255,255,255,0.03)',
        border: `1px solid ${hovered ? 'rgba(212,175,55,0.35)' : 'rgba(255,255,255,0.07)'}`,
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'all 0.18s ease',
        transform: hovered ? 'translateY(-2px)' : 'none',
        boxShadow: hovered ? '0 8px 24px rgba(212,175,55,0.12)' : 'none',
        width: '100%',
      }}
    >
      <span style={{ fontSize: '1.8rem', flexShrink: 0, lineHeight: 1 }}>{goal.icon}</span>
      <div style={{ minWidth: 0 }}>
        <div style={{
          fontSize: '0.95rem',
          fontWeight: 700,
          color: hovered ? '#d4af37' : '#f1f5f9',
          marginBottom: '3px',
          transition: 'color 0.18s',
        }}>
          {goal.label}
        </div>
        <div style={{ fontSize: '0.78rem', color: '#64748b', lineHeight: 1.4 }}>
          {goal.tagline}
        </div>
      </div>
      <span style={{
        marginLeft: 'auto',
        flexShrink: 0,
        color: hovered ? '#d4af37' : '#2a3f5f',
        fontSize: '1.1rem',
        transition: 'all 0.18s',
        transform: hovered ? 'translateX(3px)' : 'none',
      }}>›</span>
    </button>
  );
}


