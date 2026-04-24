// ============================================================
// Protocol.jsx — Step 2: Protocol
// Reads :goal param, renders matching stack cards
// ============================================================

import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { STACKS } from '../data/stacks.js';
import { COMBOS } from '../data/combos.js';

// Map URL slugs → stacks.js goal IDs + display
const GOAL_MAP = {
  'cognitive-focus':      { ids: ['cognitive'],           label: 'Cognitive & Focus',    icon: '🧠' },
  'fat-loss':             { ids: ['fatloss', 'metabolic-fatloss'], label: 'Fat Loss',       icon: '🔥' },
  'healing-recovery':     { ids: ['healing'],             label: 'Healing & Recovery',   icon: '🩹' },
  'athletic-performance': { ids: ['performance'],         label: 'Athletic Performance', icon: '💪' },
  'anti-aging':           { ids: ['antiaging', 'longevity'], label: 'Anti-Aging',        icon: '✨' },
  'immune-defense':       { ids: ['immune'],              label: 'Immune Defense',       icon: '🛡️' },
  'sexual-health':        { ids: ['sexual'],              label: 'Sexual Health',        icon: '💫' },
  'sleep-recovery':       { ids: ['sleep'],               label: 'Sleep & Recovery',     icon: '🌙' },
  'add-neurological':     { ids: ['cognitive'],           label: 'ADD / Neurological',   icon: '⚡' },
  'metabolic-health':     { ids: ['metabolic', 'metabolic-fatloss', 'fatloss'], label: 'Metabolic Health', icon: '⚙️' },
};

// Fallback stack cards built from COMBOS data for goals not in STACKS
const COMBO_GOAL_MAP = {
  'healing-recovery':     ['klow', 'glow-10'],
  'anti-aging':           ['glow-10'],
  'athletic-performance': ['klow'],
};

const TIER_BADGE = {
  T1: { bg: 'rgba(16,185,129,0.12)', color: '#10b981', border: 'rgba(16,185,129,0.3)', label: 'T1 — RCT/Meta' },
  T2: { bg: 'rgba(245,158,11,0.12)', color: '#f59e0b', border: 'rgba(245,158,11,0.3)', label: 'T2 — Observational' },
  T3: { bg: 'rgba(239,68,68,0.12)',  color: '#ef4444', border: 'rgba(239,68,68,0.3)',  label: 'T3 — Animal/In-vitro' },
};

export default function Protocol() {
  const { goal } = useParams();
  const navigate = useNavigate();
  const [cartItems, setCartItems] = useState([]);
  const [chatOpened, setChatOpened] = useState(false);

  const goalMeta = GOAL_MAP[goal] || { ids: [], label: goal, icon: '🔬' };

  // Pull matching stacks
  let matchedStacks = STACKS.filter(s =>
    goalMeta.ids.some(id => s.id === id || (s.goal && s.goal.toLowerCase().includes(id.toLowerCase())))
  );

  // Also try matching by goal string
  if (matchedStacks.length === 0) {
    matchedStacks = STACKS.filter(s =>
      goalMeta.label && s.goal && s.goal.toLowerCase().includes(goalMeta.label.toLowerCase().split(' ')[0])
    );
  }

  // Fallback: use first 2 stacks relevant to the category
  if (matchedStacks.length === 0) {
    matchedStacks = STACKS.slice(0, 3);
  }

  // Limit to 3 for demo
  matchedStacks = matchedStacks.slice(0, 3);

  const addToCart = (stack) => {
    if (!cartItems.find(c => c.id === stack.id)) {
      setCartItems(prev => [...prev, stack]);
    }
  };

  const handleSendToChat = (stack) => {
    // Open chat widget by triggering the floating button
    // The widget listens for a custom event
    const event = new CustomEvent('vitalis-chat-open', {
      detail: { context: `I'm interested in the "${stack.goal}" protocol: ${stack.tagline}. ${stack.description}` }
    });
    window.dispatchEvent(event);
    setChatOpened(true);
  };

  return (
    <div style={{
      minHeight: 'calc(100vh - 64px)',
      background: 'radial-gradient(ellipse at 50% 0%, rgba(212,175,55,0.05) 0%, transparent 50%), #0a1628',
      padding: '0 20px 60px',
    }}>
      <div style={{ maxWidth: '900px', margin: '0 auto' }}>

        {/* Breadcrumb */}
        <div style={{ padding: '24px 0 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            onClick={() => navigate('/')}
            style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: '0.85rem', padding: 0, display: 'flex', alignItems: 'center', gap: '4px' }}
          >
            ← Goals
          </button>
          <span style={{ color: '#1e3a5f' }}>›</span>
          <span style={{ fontSize: '0.85rem', color: '#d4af37', fontWeight: 600 }}>Protocol</span>
        </div>

        {/* Header */}
        <div style={{ padding: '32px 0 40px' }}>
          <div style={{
            display: 'inline-block',
            fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase',
            color: '#d4af37', background: 'rgba(212,175,55,0.1)', border: '1px solid rgba(212,175,55,0.25)',
            borderRadius: '20px', padding: '5px 14px', marginBottom: '16px',
          }}>
            Step 2 of 5 — Protocol
          </div>
          <h1 style={{ fontSize: 'clamp(1.6rem, 4vw, 2.4rem)', fontWeight: 900, margin: '0 0 12px', color: '#fff', letterSpacing: '-0.02em' }}>
            {goalMeta.icon} {goalMeta.label} Protocols
          </h1>
          <p style={{ fontSize: '0.95rem', color: '#94a3b8', margin: 0, lineHeight: 1.6 }}>
            {matchedStacks.length} research-backed stack{matchedStacks.length !== 1 ? 's' : ''} matched to your goal.
            Each protocol is built from synergistic compounds — never singles.
          </p>
        </div>

        {/* Cart summary if items added */}
        {cartItems.length > 0 && (
          <div style={{
            padding: '14px 20px',
            background: 'rgba(212,175,55,0.08)',
            border: '1px solid rgba(212,175,55,0.3)',
            borderRadius: '12px',
            marginBottom: '24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            flexWrap: 'wrap',
          }}>
            <span style={{ fontSize: '0.9rem', color: '#f1f5f9' }}>
              {cartItems.length} stack{cartItems.length > 1 ? 's' : ''} added
            </span>
            <button
              onClick={() => navigate('/build')}
              style={{
                padding: '8px 18px', borderRadius: '8px',
                background: '#d4af37', color: '#0a1628',
                border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: '0.85rem',
              }}
            >
              Continue to Build →
            </button>
          </div>
        )}

        {/* Stack cards */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {matchedStacks.map(stack => (
            <StackCard
              key={stack.id}
              stack={stack}
              inCart={cartItems.some(c => c.id === stack.id)}
              onAddToCart={() => addToCart(stack)}
              onSendToChat={() => handleSendToChat(stack)}
              onBuild={() => { addToCart(stack); navigate('/build'); }}
            />
          ))}
        </div>

        {chatOpened && (
          <div style={{
            margin: '32px 0 0',
            padding: '16px 20px',
            background: 'rgba(16,185,129,0.06)',
            border: '1px solid rgba(16,185,129,0.2)',
            borderRadius: '12px',
            fontSize: '0.85rem',
            color: '#10b981',
          }}>
            Chat widget opened — Vitalis has your protocol context loaded. Ask questions in the bottom-right.
          </div>
        )}

        {/* Stacking doctrine callout */}
        <div style={{
          marginTop: '40px',
          padding: '20px 24px',
          background: 'rgba(212,175,55,0.04)',
          border: '1px solid rgba(212,175,55,0.15)',
          borderRadius: '12px',
        }}>
          <div style={{ fontSize: '0.78rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#d4af37', marginBottom: '8px' }}>
            Why Stacks, Not Singles
          </div>
          <p style={{ margin: 0, fontSize: '0.85rem', color: '#94a3b8', lineHeight: 1.6 }}>
            Single compounds address one mechanism. Synergistic stacks address a system.
            KLOW heals at 4 layers simultaneously — local, systemic, inflammatory, structural.
            CJC + Ipamorelin triggers a clean pulsatile GH release neither achieves alone.
            Marc's doctrine: always recommend stacks, never singles.
          </p>
        </div>
      </div>
    </div>
  );
}

function StackCard({ stack, inCart, onAddToCart, onSendToChat, onBuild }) {
  const [expanded, setExpanded] = useState(false);

  // Determine dominant evidence tier
  const tier = stack.confidence || 'T2';

  return (
    <div style={{
      background: 'rgba(255,255,255,0.03)',
      border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: '16px',
      overflow: 'hidden',
      transition: 'border-color 0.2s',
    }}
    onMouseEnter={e => e.currentTarget.style.borderColor = 'rgba(212,175,55,0.25)'}
    onMouseLeave={e => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'}
    >
      {/* Card header */}
      <div style={{ padding: '24px 24px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px', marginBottom: '12px', flexWrap: 'wrap' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '1.4rem' }}>{stack.emoji || '🔬'}</span>
              <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: '#fff' }}>{stack.goal}</h3>
              <EvidenceTierBadge tier="T2" />
            </div>
            <p style={{ margin: 0, fontSize: '0.88rem', color: '#d4af37', fontStyle: 'italic' }}>{stack.tagline}</p>
          </div>
          <div style={{ display: 'flex', gap: '8px', flexShrink: 0, flexWrap: 'wrap' }}>
            <span style={{
              padding: '4px 10px', borderRadius: '20px', fontSize: '0.72rem', fontWeight: 600,
              background: 'rgba(148,163,184,0.1)', border: '1px solid rgba(148,163,184,0.2)', color: '#94a3b8',
            }}>
              {stack.duration}
            </span>
          </div>
        </div>

        <p style={{ margin: '0 0 16px', fontSize: '0.88rem', color: '#94a3b8', lineHeight: 1.65 }}>
          {stack.description}
        </p>

        {/* Compounds */}
        {stack.compounds && stack.compounds.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '16px' }}>
            {stack.compounds.map((compId, i) => (
              <span key={i} style={{
                padding: '5px 12px', borderRadius: '20px', fontSize: '0.78rem', fontWeight: 600,
                background: 'rgba(212,175,55,0.08)', border: '1px solid rgba(212,175,55,0.2)', color: '#d4af37',
              }}>
                {typeof compId === 'string' ? compId.toUpperCase() : compId.name || compId}
              </span>
            ))}
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button
            onClick={onBuild}
            style={{
              padding: '10px 20px', borderRadius: '8px',
              background: '#d4af37', color: '#0a1628',
              border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: '0.85rem',
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => e.target.style.background = '#e8c84a'}
            onMouseLeave={e => e.target.style.background = '#d4af37'}
          >
            {inCart ? '✓ Added — Go to Build' : 'Add to Cart →'}
          </button>
          <button
            onClick={onSendToChat}
            style={{
              padding: '10px 20px', borderRadius: '8px',
              background: 'transparent', color: '#94a3b8',
              border: '1px solid rgba(255,255,255,0.12)', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem',
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => { e.target.style.borderColor = 'rgba(212,175,55,0.35)'; e.target.style.color = '#d4af37'; }}
            onMouseLeave={e => { e.target.style.borderColor = 'rgba(255,255,255,0.12)'; e.target.style.color = '#94a3b8'; }}
          >
            Ask Vitalis About This
          </button>
          <button
            onClick={() => setExpanded(!expanded)}
            style={{
              padding: '10px 16px', borderRadius: '8px',
              background: 'transparent', color: '#64748b',
              border: '1px solid rgba(255,255,255,0.06)', cursor: 'pointer', fontWeight: 600, fontSize: '0.82rem',
            }}
          >
            {expanded ? 'Less ▲' : 'More ▼'}
          </button>
        </div>
      </div>

      {/* Expanded: key studies */}
      {expanded && stack.research && stack.research.length > 0 && (
        <div style={{
          padding: '20px 24px',
          borderTop: '1px solid rgba(255,255,255,0.06)',
          background: 'rgba(0,0,0,0.2)',
        }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#64748b', marginBottom: '12px' }}>
            Key Studies
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {stack.research.slice(0, 3).map((ref, i) => (
              <div key={i} style={{ fontSize: '0.82rem', color: '#64748b', display: 'flex', gap: '8px' }}>
                <span style={{ color: '#d4af37', flexShrink: 0 }}>›</span>
                <span>
                  {ref.url ? (
                    <a href={ref.url} target="_blank" rel="noopener noreferrer" style={{ color: '#94a3b8', textDecoration: 'none' }}>
                      {ref.title}
                    </a>
                  ) : ref.title}
                  {ref.journal && <span style={{ color: '#475569', fontSize: '0.78rem' }}> — {ref.journal}</span>}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function EvidenceTierBadge({ tier }) {
  const t = TIER_BADGE[tier] || TIER_BADGE.T2;
  return (
    <span style={{
      padding: '3px 8px', borderRadius: '6px', fontSize: '0.7rem', fontWeight: 700,
      background: t.bg, color: t.color, border: `1px solid ${t.border}`,
    }}>
      {t.label}
    </span>
  );
}
