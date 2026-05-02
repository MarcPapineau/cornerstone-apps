import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { COMPOUNDS } from '../data/compounds';
import CompareView from './CompareView';

const EXAMPLE_QUERIES = [
  'I have chronic lower back pain and a knee injury',
  'I have heart issues and want cardiovascular support',
  'I want to lose belly fat but keep my muscle',
  'I have brain fog and poor focus all day',
  'I am trying to get pregnant and having fertility issues',
  'I am going through menopause — hot flashes and low libido',
  'I have low testosterone and low energy',
  'I have poor sleep and feel tired every morning',
  'I want to slow aging and feel younger',
  'I have anxiety that affects my daily life',
  'I have type 2 diabetes or pre-diabetes',
  'I keep getting sick and my immune system feels weak',
];

// Compact compound reference sent to /find-protocol as a STRUCTURED catalog.
// The server function builds the system prompt itself (server-side, git-tracked)
// — see netlify/functions/vitalis-system-prompt.js. We no longer send a
// client-controlled systemPrompt (that was a free-LLM cost-leak vector).
const COMPOUND_CATALOG = COMPOUNDS.map(c => ({
  id:       c.id,
  name:     c.name,
  tagline:  c.tagline,
  benefits: (c.benefits || []).slice(0, 4),
}));

export default function FindCompounds() {
  const [activeTab, setActiveTab] = useState('find'); // 'find' | 'compare'
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const runSearch = async (q) => {
    const searchQuery = (q || query).trim();
    if (!searchQuery || searchQuery.length < 5) return;

    setLoading(true);
    setResult(null);
    setError('');

    try {
      const resp = await fetch('/.netlify/functions/find-protocol', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: searchQuery, catalog: COMPOUND_CATALOG }),
      });

      const data = await resp.json();
      if (!data.ok || !data.result) throw new Error(data.error || 'No result');
      setResult({ query: searchQuery, ...data.result });
    } catch (err) {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const setExample = (text) => {
    setQuery(text);
    setTimeout(() => runSearch(text), 100);
  };

  const priorityConfig = {
    Primary:    { color: '#d4af37', emoji: '⭐', label: 'Primary' },
    Supporting: { color: '#7ac97a', emoji: '➕', label: 'Supporting' },
    Optional:   { color: '#818cf8', emoji: '💡', label: 'Optional' },
  };

  return (
    <div style={{ maxWidth: '1000px', margin: '0 auto', padding: '48px 20px' }}>

      {/* Header */}
      <div style={{ marginBottom: '32px' }}>
        <div className="section-eyebrow" style={{ marginBottom: '10px' }}>Peptide Research</div>
        <h1 style={{ fontSize: 'clamp(1.8rem, 4vw, 2.8rem)', fontWeight: 900, margin: '0 0 12px', color: '#fff', letterSpacing: '-0.02em' }}>
          🔬 Research
        </h1>
        <p style={{ margin: 0, fontSize: '1rem', color: '#64748b', lineHeight: 1.6, maxWidth: '580px' }}>
          Describe what you're dealing with — a health goal, a symptom, or something you want to improve. We'll match you to the research compounds most relevant to your situation.
        </p>
      </div>

      {/* ── Tab toggle ── */}
      <div style={{
        display: 'flex',
        gap: '4px',
        marginBottom: '36px',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
      }}>
        {[
          { id: 'find',    label: '🔍 Find Compounds' },
          { id: 'compare', label: '🔬 Compare Side-by-Side' },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: '10px 22px',
              border: 'none',
              borderBottom: activeTab === tab.id
                ? '2px solid #d4af37'
                : '2px solid transparent',
              background: activeTab === tab.id
                ? 'rgba(212,175,55,0.08)'
                : 'transparent',
              color: activeTab === tab.id ? '#d4af37' : '#64748b',
              fontSize: '0.88rem',
              fontWeight: activeTab === tab.id ? 800 : 600,
              cursor: 'pointer',
              transition: 'all 0.2s',
              borderRadius: '8px 8px 0 0',
              marginBottom: '-1px',
            }}
            onMouseEnter={e => { if (activeTab !== tab.id) e.currentTarget.style.color = '#e2e8f0'; }}
            onMouseLeave={e => { if (activeTab !== tab.id) e.currentTarget.style.color = '#64748b'; }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Compare tab ── */}
      {activeTab === 'compare' && (
        <CompareView onBack={() => setActiveTab('find')} />
      )}

      {/* ── Find tab ── */}
      {activeTab === 'find' && (
        <>
          {/* Search box */}
          <div style={{
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '16px',
            padding: '28px',
            marginBottom: '40px',
          }}>
            {/* Example chips */}
            <div style={{ marginBottom: '20px' }}>
              <div style={{ fontSize: '12px', color: '#475569', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '10px' }}>
                Try an example:
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {EXAMPLE_QUERIES.map((eq, i) => (
                  <button
                    key={i}
                    onClick={() => setExample(eq)}
                    style={{
                      padding: '6px 13px',
                      borderRadius: '16px',
                      border: '1px solid rgba(255,255,255,0.12)',
                      background: 'rgba(255,255,255,0.04)',
                      color: '#94a3b8',
                      fontSize: '12px',
                      cursor: 'pointer',
                      transition: 'all 0.15s',
                      whiteSpace: 'nowrap',
                    }}
                    onMouseEnter={e => { e.target.style.borderColor = '#d4af37'; e.target.style.color = '#d4af37'; }}
                    onMouseLeave={e => { e.target.style.borderColor = 'rgba(255,255,255,0.12)'; e.target.style.color = '#94a3b8'; }}
                  >
                    {eq}
                  </button>
                ))}
              </div>
            </div>

            {/* Input row */}
            <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end' }}>
              <textarea
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); runSearch(); } }}
                placeholder="Describe your situation... e.g. I have chronic lower back pain, I'm 52, and I want more energy"
                rows={3}
                style={{
                  flex: 1,
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.15)',
                  borderRadius: '10px',
                  color: '#e2e8f0',
                  padding: '14px 16px',
                  fontSize: '14px',
                  fontFamily: 'inherit',
                  resize: 'vertical',
                  minHeight: '70px',
                  outline: 'none',
                  transition: 'border-color 0.2s',
                }}
                onFocus={e => { e.target.style.borderColor = '#d4af37'; }}
                onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.15)'; }}
              />
              <button
                onClick={() => runSearch()}
                disabled={loading || !query.trim()}
                className="btn-gold"
                style={{
                  padding: '14px 24px',
                  fontSize: '14px',
                  fontWeight: 800,
                  flexShrink: 0,
                  opacity: loading || !query.trim() ? 0.6 : 1,
                  cursor: loading || !query.trim() ? 'not-allowed' : 'pointer',
                }}
              >
                {loading ? 'Searching...' : 'Find →'}
              </button>
            </div>

            <p style={{ margin: '12px 0 0', fontSize: '11px', color: '#334155' }}>
              ⚠️ For research purposes only. Not medical advice. Always consult a qualified healthcare professional.
            </p>
          </div>

          {/* Loading */}
          {loading && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '32px 0', color: '#64748b' }}>
              <div style={{
                width: '24px', height: '24px',
                border: '2px solid rgba(212,175,55,0.2)',
                borderTop: '2px solid #d4af37',
                borderRadius: '50%',
                animation: 'spin 0.8s linear infinite',
              }} />
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
              <span>Matching your situation to the research...</span>
            </div>
          )}

          {/* Error */}
          {error && (
            <div style={{ padding: '16px 20px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '10px', color: '#ef4444', fontSize: '14px', marginBottom: '24px' }}>
              {error}
            </div>
          )}

          {/* Results */}
          {result && !loading && (
            <div>
              {/* Query echo */}
              <div style={{
                padding: '12px 16px',
                background: 'rgba(212,175,55,0.06)',
                border: '1px solid rgba(212,175,55,0.15)',
                borderRadius: '8px',
                borderLeft: '3px solid #d4af37',
                fontSize: '13px',
                color: '#94a3b8',
                marginBottom: '24px',
              }}>
                You searched: <em style={{ color: '#e2e8f0' }}>"{result.query}"</em>
              </div>

              {/* Intro */}
              {result.intro && (
                <p style={{ fontSize: '15px', color: '#cbd5e1', lineHeight: 1.65, marginBottom: '28px' }}>
                  {result.intro}
                </p>
              )}

              {/* Compound cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px', marginBottom: '24px' }}>
                {(result.compounds || []).map((c, i) => {
                  const pCfg = priorityConfig[c.priority] || priorityConfig.Primary;
                  const compound = COMPOUNDS.find(x => x.id === c.id);
                  return (
                    <div
                      key={i}
                      onClick={() => navigate(`/compounds?id=${c.id}`)}
                      style={{
                        background: 'rgba(255,255,255,0.03)',
                        border: '1px solid rgba(255,255,255,0.08)',
                        borderRadius: '12px',
                        padding: '20px',
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                        position: 'relative',
                        overflow: 'hidden',
                      }}
                      onMouseEnter={e => {
                        e.currentTarget.style.borderColor = pCfg.color;
                        e.currentTarget.style.transform = 'translateY(-2px)';
                        e.currentTarget.style.boxShadow = '0 6px 20px rgba(0,0,0,0.4)';
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)';
                        e.currentTarget.style.transform = 'translateY(0)';
                        e.currentTarget.style.boxShadow = 'none';
                      }}
                    >
                      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '3px', background: pCfg.color }} />
                      <div style={{ fontSize: '11px', fontWeight: 800, color: pCfg.color, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>
                        {pCfg.emoji} {pCfg.label}
                      </div>
                      <div style={{ fontSize: '18px', fontWeight: 900, color: pCfg.color, marginBottom: '4px' }}>
                        {compound?.emoji || '🧬'} {c.name}
                      </div>
                      {compound && (
                        <div style={{ fontSize: '11px', color: '#475569', marginBottom: '10px' }}>{compound.tagline}</div>
                      )}
                      <div style={{ fontSize: '13px', color: '#94a3b8', lineHeight: 1.6, marginBottom: '12px' }}>{c.why}</div>
                      {c.tags && c.tags.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginBottom: '10px' }}>
                          {c.tags.map((tag, j) => (
                            <span key={j} style={{
                              fontSize: '11px',
                              padding: '3px 8px',
                              borderRadius: '10px',
                              background: `${pCfg.color}18`,
                              color: pCfg.color,
                              border: `1px solid ${pCfg.color}30`,
                            }}>{tag}</span>
                          ))}
                        </div>
                      )}
                      <div style={{ fontSize: '12px', fontWeight: 700, color: pCfg.color }}>
                        Explore {c.name} →
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Stack note */}
              {result.stackNote && (
                <div style={{
                  background: 'rgba(255,255,255,0.02)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: '10px',
                  padding: '16px 20px',
                  fontSize: '13.5px',
                  color: '#94a3b8',
                  lineHeight: 1.65,
                  marginBottom: '20px',
                }}>
                  <strong style={{ color: '#e2e8f0' }}>🔗 Stack note: </strong>{result.stackNote}
                </div>
              )}

              {/* Disclaimer */}
              <div style={{ fontSize: '12px', color: '#334155', padding: '16px', borderTop: '1px solid rgba(255,255,255,0.05)', marginTop: '8px' }}>
                ⚠️ {result.disclaimer}
              </div>
            </div>
          )}

          {/* Page disclaimer */}
          <div style={{ marginTop: '60px' }} className="disclaimer">
            Educational resource only. Not medical advice. Consult a qualified healthcare professional before beginning any peptide protocol.
          </div>
        </>
      )}

    </div>
  );
}
