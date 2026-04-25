// ============================================================
// Protocol.jsx — Step 2: Protocol
// Reads :goal param, renders matching stack cards
// FIX PASS 2026-04-24: BUG-002 cart, BUG-004 sexual-health,
//   BUG-005 tier badge, BUG-006 KLOW copy, BUG-007 chat event,
//   BUG-008 goals[] filter
// ============================================================

import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { STACKS } from '../data/stacks.js';

// Map URL slugs → stacks.js IDs + display labels
// ids[] matched against stack.id AND stack.goals[] array
const GOAL_MAP = {
  'cognitive-focus':      { ids: ['cognitive', 'selank-dsip-sleep'], label: 'Cognitive & Focus',    icon: '🧠' },
  'fat-loss':             { ids: ['fatloss', 'metabolic-fatloss'],   label: 'Fat Loss',              icon: '🔥' },
  'healing-recovery':     { ids: ['healing'],                        label: 'Healing & Recovery',   icon: '🩹' },
  'athletic-performance': { ids: ['performance', 'peak-performance'], label: 'Athletic Performance', icon: '💪' },
  'anti-aging':           { ids: ['antiaging', 'longevity'],         label: 'Anti-Aging',           icon: '✨' },
  'immune-defense':       { ids: ['immune'],                         label: 'Immune Defense',       icon: '🛡️' },
  // FIX BUG-004: sexual-health now maps to fertility + menopause stacks that exist in stacks.js
  'sexual-health':        { ids: ['fertility', 'menopause'],         label: 'Sexual Health',        icon: '💫' },
  'sleep-recovery':       { ids: ['sleep', 'selank-dsip-sleep'],     label: 'Sleep & Recovery',     icon: '🌙' },
  // FIX BUG-008: add-neurological includes selank-dsip-sleep (has goals:['sleep','cognitive'])
  'add-neurological':     { ids: ['cognitive', 'selank-dsip-sleep'], label: 'ADD / Neurological',   icon: '⚡' },
  'metabolic-health':     { ids: ['metabolic', 'metabolic-fatloss', 'fatloss'], label: 'Metabolic Health', icon: '⚙️' },
};

// Per-stack synergy narrative — goal-specific, not KLOW-specific (FIX BUG-006)
const STACK_SYNERGY = {
  'cognitive-focus':
    'Semax elevates BDNF while Selank quiets anxiety — together they create a focused, calm mind state neither achieves alone. NAD+ provides the cellular fuel the brain needs to sustain peak performance.',
  'fat-loss':
    'Retatrutide attacks fat via three simultaneous hormonal pathways. AOD-9604 adds direct lipolysis. GHK-Cu preserves skin integrity as body composition shifts. Single compounds address one mechanism; this stack addresses the whole system.',
  'healing-recovery':
    'BPC-157 targets the exact injury site. TB-500 circulates systemically to address everything else. KPV manages inflammation and gut health throughout. Local + systemic + inflammatory — three simultaneous repair axes.',
  'athletic-performance':
    'CJC-1295 and Ipamorelin trigger a clean, pulsatile GH release that neither achieves alone — the gold standard GH optimization approach. TB-500 handles systemic connective tissue recovery between sessions.',
  'anti-aging':
    'NAD+ restores cellular energy and DNA repair. GHK-Cu activates 4,000+ longevity genes. CJC + Ipamorelin drive the GH axis. Epithalon extends telomeres. Aging happens at every level simultaneously — so should your protocol.',
  'immune-defense':
    'Thymosin Alpha-1 restores T-cell intelligence. BPC-157 heals the gut lining (the root of chronic immune activation). KPV manages cytokine storms. NAD+ addresses mitochondrial dysfunction underlying every chronic immune condition.',
  'sexual-health':
    'Kisspeptin works upstream at the HPG axis — addressing root hormonal signalling rather than symptoms. NAD+ improves mitochondrial quality in reproductive cells. Stacking compounds that each address a different layer of hormonal health produces results no single compound can match.',
  'sleep-recovery':
    'Ipamorelin stimulates GH release during deep sleep. BPC-157 uses that healing window to repair tissue. Selank quiets the mind to get you into deep sleep in the first place. The stack addresses both the mental and physiological layers of sleep dysfunction.',
  'add-neurological':
    'Semax elevates BDNF for sharper focus and working memory. Selank stabilizes GABA and enkephalins — calming without sedation. DSIP resets deep sleep architecture where much of the cognitive recovery in ADD/ADHD occurs. Three mechanisms, one protocol.',
  'metabolic-health':
    'Metabolic dysfunction is multi-layered: insulin resistance, fat oxidation inefficiency, gut inflammation, and mitochondrial decline. A single GLP-1 agonist addresses one layer. This stack addresses all four simultaneously.',
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

  // FIX BUG-008: filter checks id match AND goals[] array
  let matchedStacks = STACKS.filter(s =>
    goalMeta.ids.some(id =>
      s.id === id ||
      (Array.isArray(s.goals) && s.goals.some(g => g.toLowerCase().includes(id.toLowerCase())))
    )
  );

  // Deduplicate (a stack can appear in multiple id slots)
  const seenIds = new Set();
  matchedStacks = matchedStacks.filter(s => {
    if (seenIds.has(s.id)) return false;
    seenIds.add(s.id);
    return true;
  });

  // Secondary fallback by goal label keyword
  if (matchedStacks.length === 0) {
    const keyword = goalMeta.label.toLowerCase().split(' ')[0];
    matchedStacks = STACKS.filter(s =>
      (s.goal && s.goal.toLowerCase().includes(keyword)) ||
      (Array.isArray(s.goals) && s.goals.some(g => g.toLowerCase().includes(keyword)))
    );
  }

  // No random fallback — show authoring state instead of wrong stacks (FIX BUG-004 root cause)
  const showAuthoringFallback = matchedStacks.length === 0;

  // Limit to 3 for demo
  matchedStacks = matchedStacks.slice(0, 3);

  // FIX BUG-002: write to sessionStorage so Build.jsx reads the same cart
  const addToCart = (stack) => {
    if (!cartItems.find(c => c.id === stack.id)) {
      const next = [...cartItems, stack];
      setCartItems(next);
      try { sessionStorage.setItem('vitalis_cart_v1', JSON.stringify(next)); } catch {}
    }
  };

  // FIX BUG-007: dispatch event VitalisChat.jsx now listens for
  const handleSendToChat = (stack) => {
    const event = new CustomEvent('vitalis-chat-open', {
      detail: {
        stack,
        goal: goalMeta.label,
        context: `Tell me more about the "${stack.goal}" protocol — which components address ${goalMeta.label}? ${stack.tagline}`,
      }
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

        {/* Authoring fallback — shown instead of wrong stacks */}
        {showAuthoringFallback && (
          <div style={{
            padding: '32px 24px', textAlign: 'center',
            background: 'rgba(212,175,55,0.04)', border: '1px solid rgba(212,175,55,0.15)',
            borderRadius: '16px', marginBottom: '24px',
          }}>
            <div style={{ fontSize: '2rem', marginBottom: '12px' }}>🔬</div>
            <h3 style={{ color: '#fff', margin: '0 0 8px', fontSize: '1.1rem', fontWeight: 700 }}>
              Protocol in Development
            </h3>
            <p style={{ color: '#94a3b8', margin: '0 0 20px', fontSize: '0.9rem', lineHeight: 1.6 }}>
              We're authoring a dedicated {goalMeta.label} protocol. Chat with Vitalis below for personalized guidance while we finalize this stack.
            </p>
            <button
              onClick={() => {
                const ev = new CustomEvent('vitalis-chat-open', {
                  detail: { goal: goalMeta.label, context: `I'm looking for a ${goalMeta.label} protocol. What do you recommend?` }
                });
                window.dispatchEvent(ev);
              }}
              style={{
                padding: '10px 24px', borderRadius: '8px', background: '#d4af37',
                color: '#0a1628', border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: '0.88rem',
              }}
            >
              Ask Vitalis for {goalMeta.label} Guidance →
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

        {/* FIX BUG-006: goal-specific synergy copy, no KLOW hardcode */}
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
            {STACK_SYNERGY[goal] || 'Single compounds address one mechanism. Synergistic stacks address a system — multiple pathways firing simultaneously produce results no individual compound can achieve alone.'}
          </p>
        </div>
      </div>
    </div>
  );
}

function StackCard({ stack, inCart, onAddToCart, onSendToChat, onBuild }) {
  const [expanded, setExpanded] = useState(false);

  // FIX BUG-005: use stack.confidence field; default T2 only if not set
  const tier = stack.confidence || 'T2';

  // Key studies come from stack.keyStudies or stack.research
  const studies = stack.keyStudies || stack.research || [];

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
              {/* FIX BUG-005: use computed tier variable, not hardcoded "T2" */}
              <EvidenceTierBadge tier={tier} />
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
      {expanded && studies.length > 0 && (
        <div style={{
          padding: '20px 24px',
          borderTop: '1px solid rgba(255,255,255,0.06)',
          background: 'rgba(0,0,0,0.2)',
        }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#64748b', marginBottom: '12px' }}>
            Key Studies
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {studies.slice(0, 3).map((ref, i) => (
              <div key={i} style={{ fontSize: '0.82rem', color: '#64748b', display: 'flex', gap: '8px' }}>
                <span style={{ color: '#d4af37', flexShrink: 0 }}>›</span>
                <span>
                  {ref.url ? (
                    <a href={ref.url} target="_blank" rel="noopener noreferrer" style={{ color: '#94a3b8', textDecoration: 'none' }}>
                      {ref.title || ref.citation}
                    </a>
                  ) : (ref.title || ref.citation)}
                  {ref.journal && <span style={{ color: '#475569', fontSize: '0.78rem' }}> — {ref.journal}</span>}
                  {ref.finding && <span style={{ color: '#475569', fontSize: '0.78rem', display: 'block', marginTop: '2px' }}>{ref.finding}</span>}
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
