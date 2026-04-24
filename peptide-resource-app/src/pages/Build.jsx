// ============================================================
// Build.jsx — Step 4: Build
// Cart review + compact schedule + running total
// ============================================================

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { STACKS } from '../data/stacks.js';

// Simple demo cart using sessionStorage so it persists across steps
function useCart() {
  const [items, setItems] = useState(() => {
    try {
      const raw = sessionStorage.getItem('vitalis_cart_v1');
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  });

  const addItem = (stack) => {
    const next = items.find(i => i.id === stack.id) ? items : [...items, stack];
    setItems(next);
    sessionStorage.setItem('vitalis_cart_v1', JSON.stringify(next));
  };

  const removeItem = (id) => {
    const next = items.filter(i => i.id !== id);
    setItems(next);
    sessionStorage.setItem('vitalis_cart_v1', JSON.stringify(next));
  };

  return { items, addItem, removeItem };
}

// Rough cost estimates per stack (MSRP placeholder until catalog prices wired)
const STACK_PRICES = {
  fatloss: 380,
  'metabolic-fatloss': 420,
  healing: 260,
  antiaging: 310,
  performance: 240,
  cognitive: 195,
  longevity: 295,
  immune: 180,
  sexual: 165,
  sleep: 175,
  metabolic: 220,
};

function getStackPrice(stackId) {
  return STACK_PRICES[stackId] || 220;
}

// Build a compact schedule for a stack
function buildSchedule(stack) {
  const today = new Date();
  const reconDate = new Date(today);
  reconDate.setDate(today.getDate() + 1); // arrive + 1 day
  const firstInj = new Date(reconDate);
  firstInj.setDate(reconDate.getDate() + 1);

  const fmt = (d) => d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });

  return {
    reconstitution: fmt(reconDate),
    firstInjection: fmt(firstInj),
    frequency: stack.id === 'cognitive' ? 'Nasal: 1–2x/day' : 'SubQ injection: see dosing',
    duration: stack.duration || '8–12 weeks',
  };
}

export default function Build() {
  const navigate = useNavigate();
  const { items, addItem, removeItem } = useCart();

  // If cart empty, show a few recommended stacks to add
  const recommended = STACKS.slice(0, 4).filter(s => !items.find(i => i.id === s.id));

  const total = items.reduce((sum, s) => sum + getStackPrice(s.id), 0);

  return (
    <div style={{
      minHeight: 'calc(100vh - 64px)',
      background: 'radial-gradient(ellipse at 50% 0%, rgba(212,175,55,0.04) 0%, transparent 50%), #0a1628',
      padding: '0 20px 60px',
    }}>
      <div style={{ maxWidth: '820px', margin: '0 auto' }}>

        {/* Breadcrumb */}
        <div style={{ padding: '24px 0 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button onClick={() => navigate(-1)} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: '0.85rem', padding: 0 }}>
            ← Back
          </button>
          <span style={{ color: '#1e3a5f' }}>›</span>
          <span style={{ fontSize: '0.85rem', color: '#d4af37', fontWeight: 600 }}>Build</span>
        </div>

        {/* Header */}
        <div style={{ padding: '32px 0 32px' }}>
          <div style={{
            display: 'inline-block', fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.14em',
            textTransform: 'uppercase', color: '#d4af37', background: 'rgba(212,175,55,0.1)',
            border: '1px solid rgba(212,175,55,0.25)', borderRadius: '20px', padding: '5px 14px', marginBottom: '16px',
          }}>
            Step 4 of 5 — Build Your Protocol
          </div>
          <h1 style={{ fontSize: 'clamp(1.6rem, 4vw, 2.2rem)', fontWeight: 900, margin: '0 0 10px', color: '#fff', letterSpacing: '-0.02em' }}>
            Your Protocol
          </h1>
          <p style={{ fontSize: '0.9rem', color: '#94a3b8', margin: 0, lineHeight: 1.6 }}>
            Review your stacks, see your schedule, then book a consult to confirm and order.
          </p>
        </div>

        {items.length === 0 ? (
          /* Empty cart state */
          <div>
            <div style={{
              padding: '40px 24px', textAlign: 'center',
              background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: '16px', marginBottom: '32px',
            }}>
              <div style={{ fontSize: '2.5rem', marginBottom: '12px' }}>🔬</div>
              <p style={{ color: '#64748b', margin: '0 0 20px', fontSize: '0.9rem' }}>
                No stacks added yet. Start from Goals → Protocol to build your stack.
              </p>
              <button
                onClick={() => navigate('/')}
                style={{
                  padding: '10px 24px', borderRadius: '8px', background: '#d4af37',
                  color: '#0a1628', border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: '0.88rem',
                }}
              >
                Choose Your Goal →
              </button>
            </div>

            {recommended.length > 0 && (
              <div>
                <div style={{ fontSize: '0.78rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#64748b', marginBottom: '16px' }}>
                  Popular Starts
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {recommended.map(s => (
                    <QuickAddCard key={s.id} stack={s} onAdd={() => addItem(s)} />
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          /* Cart with items */
          <div>
            {/* Stack cards */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '24px' }}>
              {items.map(stack => {
                const sched = buildSchedule(stack);
                const price = getStackPrice(stack.id);
                return (
                  <div key={stack.id} style={{
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: '14px',
                    overflow: 'hidden',
                  }}>
                    {/* Stack header */}
                    <div style={{ padding: '18px 20px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap' }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                          <span style={{ fontSize: '1.2rem' }}>{stack.emoji || '🔬'}</span>
                          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: '#fff' }}>{stack.goal}</h3>
                        </div>
                        <p style={{ margin: 0, fontSize: '0.82rem', color: '#94a3b8' }}>{stack.tagline}</p>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{ fontWeight: 700, color: '#d4af37', fontSize: '1rem' }}>
                          ${price}<span style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 400 }}>/cycle</span>
                        </span>
                        <button
                          onClick={() => removeItem(stack.id)}
                          style={{
                            background: 'transparent', border: '1px solid rgba(255,255,255,0.1)',
                            borderRadius: '6px', color: '#64748b', cursor: 'pointer', padding: '4px 10px', fontSize: '0.78rem',
                          }}
                        >
                          Remove
                        </button>
                      </div>
                    </div>

                    {/* Schedule strip */}
                    <div style={{
                      padding: '12px 20px',
                      background: 'rgba(0,0,0,0.2)',
                      borderTop: '1px solid rgba(255,255,255,0.05)',
                      display: 'flex', gap: '24px', flexWrap: 'wrap',
                    }}>
                      <ScheduleItem label="Reconstitution" value={sched.reconstitution} />
                      <ScheduleItem label="First Injection" value={sched.firstInjection} />
                      <ScheduleItem label="Frequency" value={sched.frequency} />
                      <ScheduleItem label="Duration" value={sched.duration} />
                    </div>

                    {/* Compounds */}
                    {stack.compounds && (
                      <div style={{ padding: '12px 20px', borderTop: '1px solid rgba(255,255,255,0.04)', display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                        {stack.compounds.map((c, i) => (
                          <span key={i} style={{
                            padding: '3px 10px', borderRadius: '20px', fontSize: '0.75rem', fontWeight: 600,
                            background: 'rgba(212,175,55,0.07)', border: '1px solid rgba(212,175,55,0.18)', color: '#d4af37',
                          }}>
                            {typeof c === 'string' ? c.toUpperCase() : c.name || c}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Totals bar */}
            <div style={{
              padding: '18px 24px',
              background: 'rgba(212,175,55,0.05)',
              border: '1px solid rgba(212,175,55,0.2)',
              borderRadius: '12px',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              marginBottom: '24px', flexWrap: 'wrap', gap: '12px',
            }}>
              <div>
                <div style={{ fontSize: '0.78rem', color: '#64748b', marginBottom: '2px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  Protocol Total (MSRP estimate)
                </div>
                <div style={{ fontSize: '1.8rem', fontWeight: 900, color: '#d4af37', letterSpacing: '-0.02em' }}>
                  ${total}<span style={{ fontSize: '0.9rem', color: '#94a3b8', fontWeight: 400 }}>/cycle</span>
                </div>
                <div style={{ fontSize: '0.75rem', color: '#475569', marginTop: '4px' }}>
                  Final pricing confirmed at consult. Marc may adjust based on your labs.
                </div>
              </div>
              <button
                onClick={() => navigate('/book')}
                style={{
                  padding: '14px 32px', borderRadius: '10px', background: '#d4af37', color: '#0a1628',
                  border: 'none', cursor: 'pointer', fontWeight: 800, fontSize: '0.95rem',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={e => e.target.style.background = '#e8c84a'}
                onMouseLeave={e => e.target.style.background = '#d4af37'}
              >
                Book Your Consult →
              </button>
            </div>

            {/* Add more CTA */}
            <button
              onClick={() => navigate('/')}
              style={{
                width: '100%', padding: '12px', borderRadius: '10px',
                background: 'transparent', color: '#64748b', border: '1px solid rgba(255,255,255,0.07)',
                cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600,
              }}
            >
              + Add Another Goal
            </button>
          </div>
        )}

        {/* Disclaimer */}
        <p style={{ marginTop: '40px', fontSize: '0.72rem', color: '#475569', textAlign: 'center', lineHeight: 1.5 }}>
          Prices are educational estimates only. Not an invoice. All protocols require a consult with Marc before ordering.
        </p>
      </div>
    </div>
  );
}

function ScheduleItem({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: '0.68rem', color: '#475569', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '2px' }}>{label}</div>
      <div style={{ fontSize: '0.85rem', color: '#94a3b8', fontWeight: 600 }}>{value}</div>
    </div>
  );
}

function QuickAddCard({ stack, onAdd }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '14px 18px', borderRadius: '10px',
      background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)',
      gap: '12px', flexWrap: 'wrap',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <span style={{ fontSize: '1.2rem' }}>{stack.emoji || '🔬'}</span>
        <div>
          <div style={{ fontSize: '0.9rem', fontWeight: 700, color: '#f1f5f9' }}>{stack.goal}</div>
          <div style={{ fontSize: '0.78rem', color: '#64748b' }}>{stack.tagline}</div>
        </div>
      </div>
      <button
        onClick={onAdd}
        style={{
          padding: '7px 16px', borderRadius: '8px', background: 'transparent',
          color: '#d4af37', border: '1px solid rgba(212,175,55,0.3)', cursor: 'pointer',
          fontWeight: 700, fontSize: '0.82rem',
        }}
      >
        + Add
      </button>
    </div>
  );
}
