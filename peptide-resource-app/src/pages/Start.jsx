// Start.jsx — stub landing page (placeholder until waterfall-v1 ships).
// Referenced by App.jsx but was missing; created as a minimal stub to keep
// the build green. The Vitalis Chat widget renders over the top of this.
//
// Replace with the full Step-1 goal picker when the waterfall redesign lands
// (see VITALIS-APP-AUDIT-AND-REDESIGN.md §3.2).

import { Link } from 'react-router-dom';

export default function Start() {
  return (
    <div style={{
      minHeight: 'calc(100vh - 64px)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      textAlign: 'center',
      padding: '80px 20px',
      background: 'radial-gradient(ellipse at top center, rgba(212,175,55,0.06) 0%, transparent 65%)',
      color: '#f1f5f9',
    }}>
      <div style={{ fontSize: '3rem', marginBottom: 16 }}>🏥</div>
      <h1 style={{ fontSize: '2rem', margin: '0 0 8px', color: '#fff' }}>
        Welcome to Vitalis <span style={{ color: '#d4af37' }}>Health</span>
      </h1>
      <p style={{ fontSize: '1.05rem', color: '#94a3b8', maxWidth: 600, lineHeight: 1.6, margin: '0 0 32px' }}>
        Peptide protocol research, grounded in peer-reviewed evidence.
        Tap the chat widget in the bottom-right to start a research session,
        or browse the compound library and stack tools.
      </p>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
        <Link to="/compounds" style={btn(true)}>Compound Library</Link>
        <Link to="/stacks" style={btn(false)}>Explore Stacks</Link>
        <Link to="/stack-builder" style={btn(false)}>Stack Builder</Link>
      </div>

      <p style={{ marginTop: 40, fontSize: 12, color: '#64748b', maxWidth: 520, lineHeight: 1.5 }}>
        Research purposes only. Not medical advice.
        Consult a licensed physician before initiating any peptide protocol.
      </p>
    </div>
  );
}

function btn(primary) {
  return {
    padding: '12px 20px',
    borderRadius: 8,
    background: primary ? '#d4af37' : 'transparent',
    color: primary ? '#0a1628' : '#d4af37',
    border: `1px solid ${primary ? '#d4af37' : 'rgba(212,175,55,0.3)'}`,
    fontSize: 14,
    fontWeight: 700,
    textDecoration: 'none',
  };
}
