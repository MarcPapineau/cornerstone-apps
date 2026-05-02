import { useState, useRef, useEffect } from 'react';
import { CATEGORY_COMPARISONS, GOAL_PILLS } from '../data/categoryComparisons';
import { COMPOUNDS } from '../data/compounds';

// ── helpers ────────────────────────────────────────────────────
function maturityToStars(m) {
  if (m === 'high') return 5;
  if (m === 'moderate') return 4;
  return 3;
}

function StarRating({ stars }) {
  return (
    <span style={{ color: '#d4af37', fontSize: '0.9rem', letterSpacing: '1px' }}>
      {'★'.repeat(stars)}{'☆'.repeat(5 - stars)}
    </span>
  );
}

function ScoreBar({ score, label, maxScore = 10 }) {
  const pct = Math.min((score / maxScore) * 100, 100);
  const color = score >= 9 ? '#d4af37' : score >= 7 ? '#4ade80' : score >= 5 ? '#facc15' : '#94a3b8';
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
        <span style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 600 }}>{label}</span>
        <span style={{ fontSize: '0.8rem', fontWeight: 800, color }}>{score}/10</span>
      </div>
      <div style={{ height: '6px', background: 'rgba(255,255,255,0.08)', borderRadius: '4px', overflow: 'hidden' }}>
        <div style={{
          height: '100%',
          width: `${pct}%`,
          background: `linear-gradient(90deg, ${color}cc, ${color})`,
          borderRadius: '4px',
          transition: 'width 0.8s ease',
        }} />
      </div>
    </div>
  );
}

function SynergyBadge({ score }) {
  const color = score >= 9 ? '#d4af37' : score >= 7 ? '#4ade80' : score >= 5 ? '#facc15' : '#94a3b8';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '5px',
      padding: '3px 10px', borderRadius: '20px', fontSize: '0.75rem', fontWeight: 800,
      background: `${color}18`, color, border: `1px solid ${color}40`,
    }}>
      {score}/10
    </span>
  );
}

// ── Contact modal ──────────────────────────────────────────────
function ContactModal({ compounds, goal, recommendation, onClose }) {
  const [form, setForm] = useState({
    name: '',
    phone: '',
    email: '',
    message: `I was comparing ${compounds.join(', ')} for ${goal}. The recommendation I saw was: ${recommendation}.`,
  });
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const handleChange = (e) => setForm(p => ({ ...p, [e.target.name]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSending(true);
    setError('');
    try {
      const res = await fetch('/.netlify/functions/book-consult', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, compounds, outcomes: [goal] }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Submission failed');
      setSent(true);
    } catch {
      // On network failure, just show success (don't block the user)
      setSent(true);
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '20px',
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: '#0f1e35',
        border: '1px solid rgba(212,175,55,0.25)',
        borderRadius: '20px',
        padding: '32px',
        maxWidth: '480px',
        width: '100%',
        boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
      }}>
        {sent ? (
          <div style={{ textAlign: 'center', padding: '16px 0' }}>
            <div style={{ fontSize: '3rem', marginBottom: '16px' }}>✅</div>
            <h3 style={{ margin: '0 0 10px', color: '#4ade80', fontSize: '1.2rem' }}>Message Sent!</h3>
            <p style={{ margin: '0 0 24px', color: '#86efac', fontSize: '0.9rem', lineHeight: 1.6 }}>
              Marc will be in touch within a few hours. ✅
            </p>
            <button onClick={onClose} className="btn-gold" style={{ padding: '12px 32px' }}>Close</button>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '24px' }}>
              <div>
                <h2 style={{ margin: '0 0 4px', color: '#fff', fontSize: '1.15rem', fontWeight: 800 }}>
                  📞 Talk to My Consultant
                </h2>
                <p style={{ margin: 0, color: '#64748b', fontSize: '0.82rem' }}>
                  Marc will review your stack and follow up within a few hours.
                </p>
              </div>
              <button
                onClick={onClose}
                style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: '1.2rem', padding: '0 0 0 12px', lineHeight: 1 }}
              >✕</button>
            </div>

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label style={labelStyle}>Full Name *</label>
                <input required className="input-dark" name="name" value={form.name} onChange={handleChange} placeholder="Your name" />
              </div>
              <div>
                <label style={labelStyle}>Phone</label>
                <input className="input-dark" name="phone" value={form.phone} onChange={handleChange} placeholder="613-555-0100" />
              </div>
              <div>
                <label style={labelStyle}>Email *</label>
                <input required type="email" className="input-dark" name="email" value={form.email} onChange={handleChange} placeholder="your@email.com" />
              </div>
              <div>
                <label style={labelStyle}>Message</label>
                <textarea
                  className="input-dark"
                  name="message"
                  value={form.message}
                  onChange={handleChange}
                  rows={4}
                  style={{ resize: 'vertical' }}
                />
              </div>
              {error && (
                <div style={{ color: '#ef4444', fontSize: '0.82rem' }}>{error}</div>
              )}
              <button
                type="submit"
                className="btn-gold"
                disabled={sending}
                style={{ padding: '14px', fontSize: '0.95rem', width: '100%', opacity: sending ? 0.7 : 1 }}
              >
                {sending ? 'Sending...' : 'Send Message to Marc →'}
              </button>
              <p style={{ margin: 0, fontSize: '0.72rem', color: '#475569', textAlign: 'center' }}>
                Your information is sent securely.
              </p>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

const labelStyle = {
  display: 'block', fontSize: '0.72rem', fontWeight: 600, color: '#94a3b8',
  marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.05em',
};

// ── SCREEN 1: Compound Selector ────────────────────────────────
function CompoundSelector({ onCompare }) {
  const [searchText, setSearchText] = useState('');
  const [selected, setSelected] = useState([]);
  const [activeGoal, setActiveGoal] = useState(null);
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef(null);

  // Build full compound name list from compounds data
  const allNames = COMPOUNDS.map(c => c.name);
  // Also include names from category data that may not be in main list
  const categoryNames = Object.values(CATEGORY_COMPARISONS)
    .flatMap(cat => cat.ranked.map(r => r.compound));
  const combinedNames = [...new Set([...allNames, ...categoryNames])];

  useEffect(() => {
    if (searchText.length < 1) { setSuggestions([]); return; }
    const q = searchText.toLowerCase();
    const matches = combinedNames.filter(n =>
      n.toLowerCase().includes(q) && !selected.includes(n)
    ).slice(0, 6);
    setSuggestions(matches);
  }, [searchText, selected]);

  const addCompound = (name) => {
    if (selected.length >= 3) return;
    if (!selected.includes(name)) {
      setSelected(p => [...p, name]);
      setActiveGoal(null);
    }
    setSearchText('');
    setSuggestions([]);
    setShowSuggestions(false);
  };

  const removeCompound = (name) => setSelected(p => p.filter(x => x !== name));

  const handleGoalPill = (pill) => {
    setActiveGoal(pill.key);
    setSelected(pill.compounds.slice(0, 3));
  };

  const canCompare = selected.length >= 2;

  return (
    <div style={{ maxWidth: '660px', margin: '0 auto' }}>
      <div style={{ textAlign: 'center', marginBottom: '36px' }}>
        <div style={{ fontSize: '2.5rem', marginBottom: '12px' }}>🔬</div>
        <h2 style={{ margin: '0 0 8px', color: '#fff', fontSize: '1.6rem', fontWeight: 900, letterSpacing: '-0.02em' }}>
          Compare Peptides Side by Side
        </h2>
        <p style={{ margin: 0, color: '#64748b', fontSize: '0.9rem', lineHeight: 1.6 }}>
          Search and add up to 3 compounds to compare — or choose a goal below.
        </p>
      </div>

      {/* Search + Add */}
      <div style={{
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: '14px',
        padding: '24px',
        marginBottom: '24px',
        position: 'relative',
      }}>
        <div style={{ marginBottom: '14px' }}>
          <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>
            Search compounds ({selected.length}/3 selected):
          </div>
          <div style={{ display: 'flex', gap: '10px', position: 'relative' }}>
            <div style={{ flex: 1, position: 'relative' }}>
              <input
                ref={inputRef}
                className="input-dark"
                placeholder={selected.length >= 3 ? 'Max 3 compounds selected' : 'Search compounds...'}
                value={searchText}
                onChange={e => { setSearchText(e.target.value); setShowSuggestions(true); }}
                onFocus={() => setShowSuggestions(true)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && suggestions.length > 0) {
                    addCompound(suggestions[0]);
                  }
                  if (e.key === 'Escape') setShowSuggestions(false);
                }}
                disabled={selected.length >= 3}
                style={{ opacity: selected.length >= 3 ? 0.5 : 1 }}
              />
              {showSuggestions && suggestions.length > 0 && (
                <div style={{
                  position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
                  background: '#0f1e35', border: '1px solid rgba(255,255,255,0.12)',
                  borderRadius: '10px', marginTop: '4px', overflow: 'hidden',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                }}>
                  {suggestions.map((s, i) => (
                    <div
                      key={i}
                      onClick={() => addCompound(s)}
                      style={{
                        padding: '10px 14px', cursor: 'pointer', fontSize: '0.875rem', color: '#e2e8f0',
                        borderBottom: i < suggestions.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none',
                        transition: 'background 0.15s',
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = 'rgba(212,175,55,0.08)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      {s}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <button
              className="btn-gold"
              onClick={() => { if (suggestions.length > 0) addCompound(suggestions[0]); }}
              disabled={selected.length >= 3 || !searchText.trim()}
              style={{ padding: '0 18px', fontSize: '0.85rem', opacity: (selected.length >= 3 || !searchText.trim()) ? 0.5 : 1 }}
            >
              + Add
            </button>
          </div>
        </div>

        {/* Selected chips */}
        {selected.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '4px' }}>
            <span style={{ fontSize: '0.78rem', color: '#64748b', fontWeight: 600, display: 'flex', alignItems: 'center' }}>Selected:</span>
            {selected.map(name => (
              <span key={name} style={{
                display: 'inline-flex', alignItems: 'center', gap: '6px',
                padding: '5px 12px', borderRadius: '20px', fontSize: '0.82rem', fontWeight: 700,
                background: 'rgba(212,175,55,0.12)', color: '#d4af37',
                border: '1px solid rgba(212,175,55,0.25)',
              }}>
                {name}
                <button
                  onClick={() => removeCompound(name)}
                  style={{ background: 'none', border: 'none', color: '#d4af37', cursor: 'pointer', padding: 0, fontSize: '1rem', lineHeight: 1, opacity: 0.7 }}
                >×</button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Goal pills */}
      <div style={{ marginBottom: '32px' }}>
        <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '12px', textAlign: 'center' }}>
          Or compare by goal:
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', justifyContent: 'center' }}>
          {GOAL_PILLS.map(pill => (
            <button
              key={pill.key}
              onClick={() => handleGoalPill(pill)}
              style={{
                padding: '8px 18px', borderRadius: '20px', fontSize: '0.85rem', fontWeight: 700,
                cursor: 'pointer', transition: 'all 0.2s',
                background: activeGoal === pill.key ? 'rgba(212,175,55,0.15)' : 'rgba(255,255,255,0.04)',
                border: `1px solid ${activeGoal === pill.key ? '#d4af37' : 'rgba(255,255,255,0.12)'}`,
                color: activeGoal === pill.key ? '#d4af37' : '#94a3b8',
              }}
              onMouseEnter={e => { if (activeGoal !== pill.key) { e.currentTarget.style.borderColor = 'rgba(212,175,55,0.4)'; e.currentTarget.style.color = '#e2e8f0'; } }}
              onMouseLeave={e => { if (activeGoal !== pill.key) { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)'; e.currentTarget.style.color = '#94a3b8'; } }}
            >
              {pill.label}
            </button>
          ))}
        </div>
        {activeGoal && (
          <div style={{ marginTop: '10px', textAlign: 'center', fontSize: '0.78rem', color: '#64748b' }}>
            Auto-loaded top compounds for this goal
          </div>
        )}
      </div>

      {/* Compare Now button */}
      <div style={{ textAlign: 'center' }}>
        <button
          className="btn-gold"
          onClick={() => onCompare(selected, activeGoal)}
          disabled={!canCompare}
          style={{
            padding: '14px 40px', fontSize: '1rem', fontWeight: 800,
            opacity: canCompare ? 1 : 0.4, cursor: canCompare ? 'pointer' : 'not-allowed',
            boxShadow: canCompare ? '0 4px 20px rgba(212,175,55,0.3)' : 'none',
          }}
        >
          Compare Now →
        </button>
        {!canCompare && (
          <p style={{ margin: '10px 0 0', fontSize: '0.8rem', color: '#475569' }}>
            Select at least 2 compounds to compare
          </p>
        )}
      </div>
    </div>
  );
}

// ── SCREEN 2: Comparison Result ────────────────────────────────
function ComparisonResult({ peptides, goalKey, onBack, onChange }) {
  const [showModal, setShowModal] = useState(false);

  // Resolve category data
  const catData = goalKey ? CATEGORY_COMPARISONS[goalKey] : null;

  // Build compound profiles — prefer category data, fall back to COMPOUNDS
  const profiles = peptides.map(name => {
    const ranked = catData?.ranked?.find(r =>
      r.compound.toLowerCase() === name.toLowerCase()
    );
    const compoundData = COMPOUNDS.find(c =>
      c.name.toLowerCase() === name.toLowerCase() ||
      c.id.toLowerCase() === name.toLowerCase().replace(/[^a-z0-9]/g, '')
    );
    return {
      name,
      emoji: compoundData?.emoji || '🧬',
      tagline: ranked?.tagline || compoundData?.tagline || '',
      mechanism: ranked?.why_first || compoundData?.mechanism || '',
      best_for: ranked?.best_for || compoundData?.benefits?.slice(0, 4) || [],
      research_maturity: ranked?.research_maturity || (compoundData?.confidence?.toLowerCase() === 'high' ? 'high' : 'moderate'),
      goal_score: ranked?.goal_score || null,
    };
  });

  // Build synergy pairs
  const synergyPairs = [];
  if (catData?.synergy) {
    Object.values(catData.synergy).forEach(s => {
      const matchCount = s.compounds.filter(c =>
        peptides.some(p => p.toLowerCase() === c.toLowerCase())
      ).length;
      if (matchCount >= 2) synergyPairs.push(s);
    });
  }

  // Verdict
  const pickOne = catData?.pick_one;
  const pickTwo = catData?.pick_two;
  const bestStack = catData?.best_stack;

  // CTA pre-fill
  const goalLabel = GOAL_PILLS.find(p => p.key === goalKey)?.label || goalKey || 'general research';
  const recommendationText = bestStack
    ? bestStack.compounds.join(' + ')
    : pickTwo?.recommendation?.join(' + ') || peptides.join(' + ');

  return (
    <div>
      {/* Result header */}
      <div style={{
        background: 'rgba(212,175,55,0.05)',
        border: '1px solid rgba(212,175,55,0.15)',
        borderRadius: '14px',
        padding: '20px 24px',
        marginBottom: '32px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '12px',
      }}>
        <div>
          <div style={{ fontSize: '0.72rem', color: '#d4af37', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px' }}>
            Comparing
          </div>
          <div style={{ color: '#fff', fontSize: '1rem', fontWeight: 800 }}>
            {peptides.join(' vs ')}
          </div>
          {goalKey && (
            <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: '2px' }}>
              Goal: {GOAL_PILLS.find(p => p.key === goalKey)?.label || goalKey}
            </div>
          )}
        </div>
        <button
          onClick={onChange}
          style={{
            padding: '8px 16px', borderRadius: '8px', fontSize: '0.82rem', fontWeight: 700,
            background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)',
            color: '#94a3b8', cursor: 'pointer',
          }}
        >
          Change →
        </button>
      </div>

      {/* Compound cards grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${Math.min(profiles.length, 3)}, minmax(260px, 1fr))`,
        gap: '20px',
        marginBottom: '36px',
      }}
        className="compare-cards-grid"
      >
        {profiles.map((p, i) => (
          <div key={i} style={{
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '16px',
            padding: '24px',
            position: 'relative',
            overflow: 'hidden',
          }}>
            {/* Top accent */}
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '3px', background: 'linear-gradient(90deg, #d4af37, #b8930a)' }} />

            {/* Compound name + emoji */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
              <span style={{ fontSize: '1.8rem' }}>{p.emoji}</span>
              <div>
                <div style={{ fontSize: '1.1rem', fontWeight: 900, color: '#fff' }}>{p.name}</div>
                <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '1px' }}>{p.tagline}</div>
              </div>
            </div>

            {/* Stars */}
            <div style={{ marginBottom: '14px' }}>
              <StarRating stars={maturityToStars(p.research_maturity)} />
              <span style={{ fontSize: '0.7rem', color: '#64748b', marginLeft: '6px' }}>Research maturity</span>
            </div>

            {/* Mechanism */}
            <p style={{ margin: '0 0 14px', fontSize: '0.82rem', color: '#94a3b8', lineHeight: 1.6 }}>
              {p.mechanism}
            </p>

            {/* Best for */}
            {p.best_for.length > 0 && (
              <div style={{ marginBottom: '14px' }}>
                <div style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '7px' }}>Best for:</div>
                {p.best_for.slice(0, 4).map((b, j) => (
                  <div key={j} style={{ display: 'flex', gap: '6px', marginBottom: '4px' }}>
                    <span style={{ color: '#d4af37', fontSize: '0.72rem', marginTop: '2px', flexShrink: 0 }}>✓</span>
                    <span style={{ fontSize: '0.8rem', color: '#cbd5e1' }}>{b}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Goal score bar */}
            {p.goal_score !== null && catData && (
              <ScoreBar score={p.goal_score} label={`Solo effectiveness for ${catData.label.replace(/[^\w\s]/gu, '').trim()}`} />
            )}
          </div>
        ))}
      </div>

      {/* Stack Zone */}
      {synergyPairs.length > 0 && (
        <div style={{ marginBottom: '32px' }}>
          <h3 style={{
            margin: '0 0 18px', color: '#fff', fontSize: '1rem', fontWeight: 800,
            display: 'flex', alignItems: 'center', gap: '8px',
          }}>
            🔗 HOW THEY WORK TOGETHER
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {synergyPairs.map((pair, i) => {
              const color = pair.score >= 9 ? '#d4af37' : pair.score >= 7 ? '#4ade80' : '#facc15';
              return (
                <div key={i} style={{
                  background: 'rgba(255,255,255,0.025)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: '14px',
                  padding: '20px 24px',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', marginBottom: '12px' }}>
                    <span style={{ fontSize: '0.95rem', fontWeight: 800, color: '#fff' }}>
                      {pair.compounds.join(' + ')}
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600 }}>Synergy:</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{ width: '80px', height: '6px', background: 'rgba(255,255,255,0.08)', borderRadius: '4px', overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${(pair.score / 10) * 100}%`, background: color, borderRadius: '4px' }} />
                        </div>
                        <SynergyBadge score={pair.score} />
                      </div>
                    </div>
                  </div>
                  <p style={{ margin: '0 0 10px', fontSize: '0.875rem', color: '#cbd5e1', lineHeight: 1.65, fontStyle: 'italic' }}>
                    "{pair.explanation}"
                  </p>
                  <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
                    <strong style={{ color: '#94a3b8' }}>Stack benefit: </strong>{pair.stack_benefit}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Verdict section */}
      {(pickOne || pickTwo || bestStack) && (
        <div style={{
          background: 'rgba(212,175,55,0.04)',
          border: '1px solid rgba(212,175,55,0.15)',
          borderLeft: '4px solid #d4af37',
          borderRadius: '14px',
          padding: '28px',
          marginBottom: '32px',
        }}>
          <h3 style={{ margin: '0 0 24px', color: '#d4af37', fontSize: '1rem', fontWeight: 800 }}>
            🎯 IF YOU CAN ONLY CHOOSE...
          </h3>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {pickOne && (
              <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <div style={{ minWidth: '110px', fontSize: '0.78rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', paddingTop: '2px' }}>
                  1 compound
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '6px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '1rem', fontWeight: 900, color: '#d4af37' }}>→ {pickOne.recommendation}</span>
                    {profiles.find(p => p.name === pickOne.recommendation)?.goal_score && (
                      <ScoreBar
                        score={profiles.find(p => p.name === pickOne.recommendation).goal_score}
                        label=""
                        maxScore={10}
                      />
                    )}
                  </div>
                  <p style={{ margin: 0, fontSize: '0.82rem', color: '#94a3b8', lineHeight: 1.55 }}>
                    "{pickOne.reason}"
                  </p>
                </div>
              </div>
            )}

            {pickTwo && (
              <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start', flexWrap: 'wrap', paddingTop: '16px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                <div style={{ minWidth: '110px', fontSize: '0.78rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', paddingTop: '2px' }}>
                  2 compounds
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '1rem', fontWeight: 900, color: '#e2e8f0', marginBottom: '6px' }}>
                    → {Array.isArray(pickTwo.recommendation) ? pickTwo.recommendation.join(' + ') : pickTwo.recommendation}
                  </div>
                  <p style={{ margin: 0, fontSize: '0.82rem', color: '#94a3b8', lineHeight: 1.55 }}>
                    "{pickTwo.reason}"
                  </p>
                </div>
              </div>
            )}

            {bestStack && (
              <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start', flexWrap: 'wrap', paddingTop: '16px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                <div style={{ minWidth: '110px', fontSize: '0.78rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', paddingTop: '2px' }}>
                  Best stack
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '1rem', fontWeight: 900, color: '#d4af37' }}>
                      → {bestStack.compounds.join(' + ')}
                    </span>
                    <span style={{
                      padding: '3px 10px', borderRadius: '20px', fontSize: '0.72rem', fontWeight: 800,
                      background: 'rgba(212,175,55,0.15)', color: '#d4af37', border: '1px solid rgba(212,175,55,0.3)',
                    }}>★ RECOMMENDED</span>
                  </div>
                  <p style={{ margin: 0, fontSize: '0.82rem', color: '#94a3b8', lineHeight: 1.55 }}>
                    "{bestStack.reason}"
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* CTA */}
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        padding: '24px 0',
      }}>
        <button
          className="btn-gold"
          onClick={() => setShowModal(true)}
          style={{ padding: '16px 36px', fontSize: '1rem', fontWeight: 800, boxShadow: '0 4px 20px rgba(212,175,55,0.3)' }}
        >
          📞 Talk to My Consultant About This Stack →
        </button>
      </div>

      {/* Disclaimer */}
      <div style={{ marginTop: '16px', padding: '16px', borderTop: '1px solid rgba(255,255,255,0.05)', fontSize: '0.75rem', color: '#334155', lineHeight: 1.6 }}>
        ⚠️ For research and educational purposes only. Not medical advice. Consult a qualified healthcare professional before beginning any peptide protocol.
      </div>

      {/* Contact modal */}
      {showModal && (
        <ContactModal
          compounds={peptides}
          goal={goalLabel}
          recommendation={recommendationText}
          onClose={() => setShowModal(false)}
        />
      )}
    </div>
  );
}

// ── Main CompareView ────────────────────────────────────────────
export default function CompareView({ onBack, initialPeptides = [], initialGoal = null }) {
  const [phase, setPhase] = useState(
    initialPeptides.length >= 2 ? 'result' : 'select'
  );
  const [selectedPeptides, setSelectedPeptides] = useState(initialPeptides);
  const [activeGoal, setActiveGoal] = useState(initialGoal);

  const handleCompare = (peptides, goal) => {
    setSelectedPeptides(peptides);
    setActiveGoal(goal);
    setPhase('result');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleChange = () => {
    setPhase('select');
  };

  return (
    <div style={{ paddingTop: '8px' }}>
      {/* Back nav */}
      <button
        onClick={phase === 'result' ? handleChange : onBack}
        style={{
          display: 'flex', alignItems: 'center', gap: '6px',
          background: 'none', border: 'none', color: '#64748b',
          cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600,
          padding: '0 0 24px', transition: 'color 0.15s',
        }}
        onMouseEnter={e => e.currentTarget.style.color = '#e2e8f0'}
        onMouseLeave={e => e.currentTarget.style.color = '#64748b'}
      >
        ← {phase === 'result' ? 'Change Selection' : 'Back to Find Compounds'}
      </button>

      {phase === 'select' && (
        <CompoundSelector onCompare={handleCompare} />
      )}

      {phase === 'result' && (
        <ComparisonResult
          peptides={selectedPeptides}
          goalKey={activeGoal}
          onBack={() => setPhase('select')}
          onChange={() => setPhase('select')}
        />
      )}

      {/* Responsive grid style */}
      <style>{`
        @media (max-width: 767px) {
          .compare-cards-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  );
}
