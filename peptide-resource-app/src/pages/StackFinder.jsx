import { useState } from 'react';
import { Link } from 'react-router-dom';
import { STACKS } from '../data/stacks';
import { COMPOUNDS } from '../data/compounds';

const goals = [
  { id: 'fatloss', label: 'Fat Loss', emoji: '🔥', desc: 'Shed body fat, suppress appetite, improve metabolic health' },
  { id: 'healing', label: 'Healing & Recovery', emoji: '🩹', desc: 'Repair injuries, tendons, gut, and chronic pain' },
  { id: 'antiaging', label: 'Anti-Aging', emoji: '✨', desc: 'Cellular renewal, skin, collagen, and longevity' },
  { id: 'performance', label: 'Performance & Muscle', emoji: '💪', desc: 'Natural GH optimization, muscle growth, fat loss' },
  { id: 'cognitive', label: 'Cognitive & Focus', emoji: '🧠', desc: 'Sharper focus, better memory, reduce anxiety' },
  { id: 'sleep', label: 'Sleep & Recovery', emoji: '🌙', desc: 'Deep sleep quality, overnight repair, recovery' },
  { id: 'fertility', label: 'Fertility', emoji: '🌱', desc: 'Hormonal restoration, reproductive health, conception support' },
  { id: 'menopause', label: 'Menopause Support', emoji: '🌸', desc: 'Hot flashes, libido, collagen, hormonal transition' },
  { id: 'immune', label: 'Immune Restoration', emoji: '🛡️', desc: 'Chronic infections, post-viral, autoimmune, immune optimization' },
];

export default function StackFinder() {
  const [selected, setSelected] = useState([]);

  const toggleGoal = (id) => {
    setSelected(prev => prev.includes(id) ? prev.filter(g => g !== id) : [...prev, id]);
  };

  // Match stacks by: exact id match OR goals array includes any selected goal
  const matchingStacks = selected.length === 0
    ? []
    : STACKS.filter(s =>
        selected.includes(s.id) ||
        (s.goals && s.goals.some(g => selected.includes(g)))
      );

  const getCompoundByid = (id) => COMPOUNDS.find(c => c.id === id);

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '48px 20px' }}>
      {/* Header */}
      <div style={{ marginBottom: '48px' }}>
        <div className="section-eyebrow" style={{ marginBottom: '10px' }}>Stack Finder</div>
        <h1 style={{ fontSize: 'clamp(1.8rem, 4vw, 2.8rem)', fontWeight: 900, margin: '0 0 12px', color: '#fff', letterSpacing: '-0.02em' }}>
          Find Your Protocol
        </h1>
        <p style={{ margin: 0, fontSize: '1rem', color: '#64748b', lineHeight: 1.6, maxWidth: '520px' }}>
          Select one or more goals to see matching compound stacks. Each stack is designed for synergistic effect.
        </p>
      </div>

      {/* Goal selector */}
      <div style={{ marginBottom: '48px' }}>
        <h2 style={{ fontSize: '1rem', fontWeight: 600, color: '#94a3b8', marginBottom: '20px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          What are your goals? <span style={{ color: '#64748b', fontWeight: 400 }}>(select all that apply)</span>
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '14px' }}>
          {goals.map(goal => {
            const isSelected = selected.includes(goal.id);
            return (
              <button
                key={goal.id}
                onClick={() => toggleGoal(goal.id)}
                style={{
                  background: isSelected ? 'rgba(212,175,55,0.1)' : 'rgba(255,255,255,0.03)',
                  border: `1px solid ${isSelected ? 'rgba(212,175,55,0.4)' : 'rgba(255,255,255,0.06)'}`,
                  borderRadius: '14px',
                  padding: '20px',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'all 0.2s',
                  transform: isSelected ? 'translateY(-2px)' : 'none',
                  boxShadow: isSelected ? '0 4px 20px rgba(212,175,55,0.15)' : 'none',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                  <span style={{ fontSize: '1.6rem' }}>{goal.emoji}</span>
                  <span style={{ fontSize: '0.95rem', fontWeight: 700, color: isSelected ? '#d4af37' : '#fff' }}>{goal.label}</span>
                  {isSelected && <span style={{ marginLeft: 'auto', color: '#d4af37', fontSize: '1rem' }}>✓</span>}
                </div>
                <p style={{ margin: 0, fontSize: '0.8rem', color: '#64748b', lineHeight: 1.4 }}>{goal.desc}</p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Results */}
      {selected.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', border: '1px dashed rgba(255,255,255,0.08)', borderRadius: '16px', color: '#64748b' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '16px' }}>🎯</div>
          <p style={{ fontSize: '1rem', margin: 0 }}>Select your goals above to see matching stacks.</p>
        </div>
      ) : matchingStacks.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: '#64748b' }}>
          <p>No exact matches. Contact Marc for a custom protocol.</p>
        </div>
      ) : (
        <div>
          <h2 style={{ fontSize: '1rem', fontWeight: 600, color: '#94a3b8', marginBottom: '20px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Matching Stacks ({matchingStacks.length})
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            {matchingStacks.map(stack => (
              <div key={stack.id} style={{ background: 'rgba(15,32,64,0.8)', border: '1px solid rgba(212,175,55,0.2)', borderRadius: '16px', padding: '28px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px', marginBottom: '12px', flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
                      <span style={{ fontSize: '1.6rem' }}>{stack.emoji}</span>
                      <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: '#fff' }}>{stack.goal}</h3>
                    </div>
                    <p style={{ margin: 0, fontSize: '0.875rem', color: '#d4af37', fontStyle: 'italic' }}>{stack.tagline}</p>
                  </div>
                  <div style={{ padding: '6px 14px', background: 'rgba(212,175,55,0.1)', border: '1px solid rgba(212,175,55,0.2)', borderRadius: '8px', fontSize: '0.8rem', color: '#d4af37', fontWeight: 600, whiteSpace: 'nowrap' }}>
                    ⏱ {stack.duration}
                  </div>
                </div>

                <p style={{ margin: '0 0 20px', fontSize: '0.9rem', color: '#94a3b8', lineHeight: 1.6 }}>{stack.description}</p>

                {/* Compound chips */}
                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '24px' }}>
                  {stack.compounds.map(cid => {
                    const c = getCompoundByid(cid);
                    if (!c) return null;
                    return (
                      <div key={cid} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 14px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '10px' }}>
                        <span>{c.emoji}</span>
                        <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#cbd5e1' }}>{c.name}</span>
                        <span style={{ fontSize: '0.75rem', color: '#64748b' }}>{c.dose}</span>
                      </div>
                    );
                  })}
                </div>

                <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                  <Link to="/compounds" className="btn-gold" style={{ textDecoration: 'none', display: 'inline-block', padding: '10px 22px', fontSize: '0.875rem' }}>
                    View Compounds
                  </Link>
                  <Link to="/contact" className="btn-outline" style={{ textDecoration: 'none', display: 'inline-block', padding: '10px 22px', fontSize: '0.875rem' }}>
                    Book Consult for This Stack
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ marginTop: '60px' }} className="disclaimer">
        Stacks are educational suggestions only. Your actual protocol will be customized by Marc based on your health history, bloodwork, and specific goals. Do not self-prescribe.
      </div>
    </div>
  );
}
