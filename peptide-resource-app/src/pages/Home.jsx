import { Link } from 'react-router-dom';

const categories = [
  { id: 'healing',     emoji: '🩹', label: 'Healing & Recovery',     desc: 'BPC-157, TB-500, KPV, LL-37, Cardiogen — tendons, gut, muscle, systemic repair', count: 7, color: '#4ade80' },
  { id: 'performance', emoji: '💪', label: 'Performance & GH',       desc: 'CJC-1295, Ipamorelin, IGF-1 LR3, GHRP-6, HCG — GH optimization and anabolics', count: 14, color: '#60a5fa' },
  { id: 'weight',      emoji: '🔥', label: 'Fat Loss & Metabolic',   desc: 'Retatrutide, AOD-9604, Tesamorelin, Adipotide, 5-Amino-1MQ — multi-mechanism fat loss', count: 7, color: '#fb923c' },
  { id: 'antiaging',   emoji: '✨', label: 'Anti-Aging & Longevity', desc: 'NAD+, GHK-Cu, Epithalon, MOTS-c, SS-31, Glutathione — cellular and chromosomal renewal', count: 9, color: '#c084fc' },
  { id: 'cognitive',   emoji: '🧠', label: 'Cognitive & Focus',      desc: 'Semax, Selank, DSIP, P21, Pinealon, Dihexa — neuroplasticity, memory, sleep', count: 5, color: '#facc15' },
  { id: 'immune',      emoji: '🛡️', label: 'Immune Restoration',     desc: 'Thymosin Alpha-1, LL-37, GcMAF, VIP, Thymalin — T-cell regulation, post-viral', count: 7, color: '#4ade80' },
];

const steps = [
  { num: '01', title: 'Browse the Library', desc: 'Explore detailed profiles on 48+ research compounds — mechanisms, benefits, dosing, reconstitution, and peer-reviewed citations.', icon: '🔍' },
  { num: '02', title: 'Build Your Stack', desc: 'Use the Stack Builder to pick compounds, get a live score, spot synergies and warnings, and see your expected outcomes.', icon: '🏥' },
  { num: '03', title: 'Send It to Marc', desc: 'Submit your custom stack directly. Marc reviews it personally and follows up with a tailored protocol recommendation.', icon: '📋' },
];

export default function Home() {
  return (
    <div>
      {/* Research Disclaimer Banner */}
      <div style={{
        background: 'rgba(212,175,55,0.08)',
        borderBottom: '1px solid rgba(212,175,55,0.2)',
        padding: '14px 24px',
        textAlign: 'center',
      }}>
        <p style={{ margin: 0, fontSize: '0.8rem', color: 'rgba(255,255,255,0.6)', lineHeight: 1.6, maxWidth: '900px', display: 'inline-block' }}>
          <span style={{ color: '#d4af37', fontWeight: 700 }}>🏥 RESEARCH PURPOSES ONLY</span> — This platform is a curated educational resource presenting published scientific research on peptides and related compounds. It does not constitute medical advice, diagnosis, or treatment recommendations. All compounds referenced are intended for research purposes only and are not approved for human therapeutic use. Consult a qualified healthcare professional before beginning any protocol.
        </p>
      </div>

      {/* Hero */}
      <section style={{
        minHeight: 'calc(100vh - 64px)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: '80px 20px',
        background: 'radial-gradient(ellipse at top center, rgba(212,175,55,0.06) 0%, transparent 65%), radial-gradient(ellipse at bottom, rgba(10,22,40,1) 0%, transparent 100%)',
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* Background glow */}
        <div style={{
          position: 'absolute',
          top: '30%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: '600px',
          height: '400px',
          background: 'radial-gradient(ellipse, rgba(212,175,55,0.05) 0%, transparent 70%)',
          pointerEvents: 'none',
        }} />

        <div style={{ position: 'relative', maxWidth: '780px' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '8px 16px', background: 'rgba(212,175,55,0.1)', border: '1px solid rgba(212,175,55,0.25)', borderRadius: '100px', marginBottom: '28px' }}>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#4ade80', display: 'inline-block', animation: 'glowPulse 2s infinite' }} />
            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#d4af37', letterSpacing: '0.04em' }}>Research-Based Education Resource</span>
          </div>

          <h1 style={{ fontSize: 'clamp(2rem, 5vw, 3.5rem)', fontWeight: 900, lineHeight: 1.1, margin: '0 0 24px', letterSpacing: '-0.02em', color: '#fff' }}>
            Understand Your{' '}
            <span className="text-gold-gradient">Peptide Protocol</span>{' '}
            — Completely
          </h1>

          <p style={{ fontSize: 'clamp(1rem, 2vw, 1.2rem)', color: '#94a3b8', lineHeight: 1.7, margin: '0 0 40px', maxWidth: '600px', marginLeft: 'auto', marginRight: 'auto' }}>
            An educational resource for Marc Papineau's research clients. Detailed profiles, dosing guides, reconstitution instructions, and stack protocols — all in one place.
          </p>

          <div style={{ display: 'flex', gap: '14px', justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link to="/stack-builder" className="btn-gold" style={{ textDecoration: 'none', display: 'inline-block' }}>
              🏥 Build Your Stack →
            </Link>
            <Link to="/combos" className="btn-outline" style={{ textDecoration: 'none', display: 'inline-block' }}>
              🧪 View Combos
            </Link>
            <Link to="/compounds" className="btn-outline" style={{ textDecoration: 'none', display: 'inline-block' }}>
              Browse 48+ Compounds
            </Link>
          </div>

          {/* Stats */}
          <div style={{ display: 'flex', gap: '40px', justifyContent: 'center', marginTop: '64px', flexWrap: 'wrap' }}>
            {[
              { num: '48', label: 'Compounds' },
              { num: '11', label: 'Pre-Mixed Combos' },
              { num: '13', label: 'Goal Stacks' },
            ].map(stat => (
              <div key={stat.label} style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '2rem', fontWeight: 800, color: '#d4af37', lineHeight: 1 }}>{stat.num}</div>
                <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '4px', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 500 }}>{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Category cards */}
      <section style={{ maxWidth: '1200px', margin: '0 auto', padding: '80px 20px' }}>
        <div style={{ textAlign: 'center', marginBottom: '48px' }}>
          <div className="section-eyebrow" style={{ marginBottom: '12px' }}>Compound Categories</div>
          <h2 style={{ fontSize: 'clamp(1.5rem, 3vw, 2.2rem)', fontWeight: 800, margin: 0, color: '#fff' }}>
            Explore by Goal
          </h2>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '20px' }}>
          {categories.map(cat => (
            <Link
              key={cat.id}
              to={`/compounds?category=${cat.id}`}
              style={{ textDecoration: 'none' }}
            >
              <div className="card" style={{ padding: '28px', height: '100%' }}>
                <div style={{ fontSize: '2.5rem', marginBottom: '16px' }}>{cat.emoji}</div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                  <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: '#fff' }}>{cat.label}</h3>
                  <span style={{ fontSize: '0.75rem', color: cat.color, background: `${cat.color}20`, padding: '2px 8px', borderRadius: '20px', fontWeight: 600 }}>{cat.count}</span>
                </div>
                <p style={{ margin: 0, fontSize: '0.875rem', color: '#94a3b8', lineHeight: 1.5 }}>{cat.desc}</p>
                <div style={{ marginTop: '16px', fontSize: '0.8rem', color: '#d4af37', fontWeight: 600 }}>Explore →</div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* Stack Builder CTA */}
      <section style={{ maxWidth: '1100px', margin: '0 auto', padding: '0 20px 80px' }}>
        <div style={{
          background: 'linear-gradient(135deg, rgba(212,175,55,0.08) 0%, rgba(10,22,40,0.6) 100%)',
          border: '1px solid rgba(212,175,55,0.2)',
          borderRadius: '20px',
          padding: '48px 40px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '32px',
          flexWrap: 'wrap',
        }}>
          <div style={{ flex: 1, minWidth: '260px' }}>
            <div style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#d4af37', marginBottom: '12px' }}>New Feature</div>
            <h2 style={{ fontSize: 'clamp(1.3rem, 3vw, 1.9rem)', fontWeight: 800, color: '#fff', margin: '0 0 14px', lineHeight: 1.2 }}>
              Build Your Custom Stack<br/>
              <span style={{ color: '#d4af37' }}>Get a Score. See What's Missing.</span>
            </h2>
            <p style={{ color: '#94a3b8', fontSize: '0.9rem', lineHeight: 1.6, margin: '0 0 20px' }}>
              Pick your goal, select compounds, and get a live protocol analysis — synergies detected, warnings flagged, expected outcomes listed. Then send it directly to Marc.
            </p>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              {['Live scoring','Synergy detection','Smart suggestions','Send to Marc'].map(f => (
                <span key={f} style={{ padding: '4px 10px', borderRadius: '6px', background: 'rgba(212,175,55,0.1)', border: '1px solid rgba(212,175,55,0.2)', color: '#d4af37', fontSize: '0.75rem', fontWeight: 600 }}>✓ {f}</span>
              ))}
            </div>
          </div>
          <div style={{ flexShrink: 0 }}>
            <Link to="/stack-builder" className="btn-gold" style={{ textDecoration: 'none', display: 'inline-block', padding: '14px 28px', fontSize: '1rem', fontWeight: 700, whiteSpace: 'nowrap' }}>
              🏥 Open Stack Builder →
            </Link>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section style={{ background: 'rgba(15,32,64,0.4)', borderTop: '1px solid rgba(255,255,255,0.04)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
        <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '80px 20px' }}>
          <div style={{ textAlign: 'center', marginBottom: '56px' }}>
            <div className="section-eyebrow" style={{ marginBottom: '12px' }}>How It Works</div>
            <h2 style={{ fontSize: 'clamp(1.5rem, 3vw, 2.2rem)', fontWeight: 800, margin: 0, color: '#fff' }}>
              From Research to Protocol
            </h2>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '32px' }}>
            {steps.map(step => (
              <div key={step.num} style={{ textAlign: 'center', position: 'relative' }}>
                <div style={{ width: '64px', height: '64px', borderRadius: '16px', background: 'rgba(212,175,55,0.1)', border: '1px solid rgba(212,175,55,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px', fontSize: '1.8rem' }}>
                  {step.icon}
                </div>
                <div style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#d4af37', marginBottom: '8px' }}>Step {step.num}</div>
                <h3 style={{ margin: '0 0 12px', fontSize: '1.1rem', fontWeight: 700, color: '#fff' }}>{step.title}</h3>
                <p style={{ margin: 0, fontSize: '0.875rem', color: '#64748b', lineHeight: 1.6 }}>{step.desc}</p>
              </div>
            ))}
          </div>

          <div style={{ textAlign: 'center', marginTop: '56px', display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link to="/stack-builder" className="btn-gold" style={{ textDecoration: 'none', display: 'inline-block' }}>
              🏥 Build Your Stack
            </Link>
            <Link to="/contact" className="btn-outline" style={{ textDecoration: 'none', display: 'inline-block' }}>
              Book a Consultation
            </Link>
          </div>
        </div>
      </section>

      {/* Disclaimer */}
      <div className="disclaimer">
        <p style={{ margin: 0 }}>
          ⚠️ <strong>Educational Resource Only.</strong> This site contains information about research compounds for educational purposes. Nothing on this site constitutes medical advice. Always consult a qualified healthcare professional before beginning any supplement or peptide protocol. Marc Papineau is a peptide researcher, not a licensed physician.
        </p>
      </div>
    </div>
  );
}
