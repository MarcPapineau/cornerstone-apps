import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const { user, login, signup, isLoading } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState('signin');

  // Redirect if already logged in
  useEffect(() => {
    if (user && !isLoading) {
      navigate('/compounds', { replace: true });
    }
  }, [user, isLoading, navigate]);

  if (isLoading) {
    return (
      <div style={styles.loadingWrap}>
        <div style={styles.spinner} />
      </div>
    );
  }

  return (
    <div style={styles.page}>
      {/* Background decorative elements */}
      <div style={styles.bgOrb1} />
      <div style={styles.bgOrb2} />

      <div style={styles.card}>
        {/* Logo */}
        <div style={styles.logoWrap}>
          <div style={styles.logoIcon}>🏥</div>
          <div>
            <div style={styles.logoText}>
              Cornerstone RE <span style={{ color: '#d4af37' }}>Health</span>
            </div>
            <div style={styles.tagline}>Your personalized peptide research platform</div>
          </div>
        </div>

        {/* Divider */}
        <div style={styles.divider} />

        {/* Tabs */}
        <div style={styles.tabBar}>
          <button
            style={{ ...styles.tab, ...(tab === 'signin' ? styles.tabActive : {}) }}
            onClick={() => setTab('signin')}
          >
            Sign In
          </button>
          <button
            style={{ ...styles.tab, ...(tab === 'signup' ? styles.tabActive : {}) }}
            onClick={() => setTab('signup')}
          >
            Create Account
          </button>
        </div>

        {/* Content */}
        {tab === 'signin' ? (
          <SignInPanel onLogin={login} />
        ) : (
          <SignUpPanel />
        )}

        {/* Disclaimer */}
        <p style={styles.disclaimer}>
          🔒 For research clients of Marc Papineau only.<br />
          Not medical advice — educational research platform.
        </p>
      </div>
    </div>
  );
}

function SignInPanel({ onLogin }) {
  return (
    <div style={styles.panel}>
      <p style={styles.panelDesc}>
        Welcome back. Sign in to access your personalized research dashboard.
      </p>

      <div style={styles.featureList}>
        <div style={styles.feature}>
          <span style={styles.featureIcon}>🔬</span>
          <span>Full compound library & research profiles</span>
        </div>
        <div style={styles.feature}>
          <span style={styles.featureIcon}>💊</span>
          <span>Dosing guides & stack recommendations</span>
        </div>
        <div style={styles.feature}>
          <span style={styles.featureIcon}>📊</span>
          <span>Synergy matrix & safety profiles</span>
        </div>
      </div>

      <button style={styles.btnGold} onClick={onLogin}>
        <span style={{ marginRight: '8px' }}>🔑</span>
        Sign In to Your Account
      </button>
    </div>
  );
}

function SignUpPanel() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [reason, setReason] = useState('');
  const [status, setStatus] = useState('idle'); // idle | loading | success | error

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name || !email) return;
    setStatus('loading');
    try {
      const res = await fetch('/.netlify/functions/request-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, reason }),
      });
      if (res.ok) {
        setStatus('success');
      } else {
        setStatus('error');
      }
    } catch {
      setStatus('error');
    }
  };

  if (status === 'success') {
    return (
      <div style={{ textAlign: 'center', padding: '20px 0' }}>
        <div style={{ fontSize: '3rem', marginBottom: '16px' }}>✅</div>
        <p style={{ color: '#d4af37', fontSize: '1.1rem', fontWeight: 700, marginBottom: '8px' }}>Request Submitted</p>
        <p style={{ color: '#94a3b8', fontSize: '0.875rem', lineHeight: 1.6 }}>
          Marc will review your request and send you an invite link if approved. Check your email within 24 hours.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} style={styles.panel}>
      <p style={styles.panelDesc}>
        Access is by approval only. Submit your details and Marc will review your request personally.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '20px' }}>
        <input
          type="text"
          placeholder="Your full name"
          value={name}
          onChange={e => setName(e.target.value)}
          required
          style={styles.input}
        />
        <input
          type="email"
          placeholder="Your email address"
          value={email}
          onChange={e => setEmail(e.target.value)}
          required
          style={styles.input}
        />
        <textarea
          placeholder="How do you know Marc? (optional)"
          value={reason}
          onChange={e => setReason(e.target.value)}
          rows={3}
          style={{ ...styles.input, resize: 'vertical', lineHeight: 1.5 }}
        />
      </div>

      {status === 'error' && (
        <p style={{ color: '#ef4444', fontSize: '0.8rem', marginBottom: '12px', textAlign: 'center' }}>
          Something went wrong. Please try again.
        </p>
      )}

      <button type="submit" style={{ ...styles.btnGold, opacity: status === 'loading' ? 0.7 : 1 }} disabled={status === 'loading'}>
        <span style={{ marginRight: '8px' }}>{status === 'loading' ? '⏳' : '🔑'}</span>
        {status === 'loading' ? 'Sending Request...' : 'Request Access'}
      </button>

      <p style={styles.consultNote}>
        Not a client yet?{' '}
        <a href="/contact" style={{ color: '#d4af37', textDecoration: 'none', fontWeight: 600 }}>
          Book a consultation →
        </a>
      </p>
    </form>
  );
}

const styles = {
  page: {
    minHeight: '100vh',
    background: '#0a1628',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '40px 20px',
    position: 'relative',
    overflow: 'hidden',
  },
  bgOrb1: {
    position: 'absolute',
    top: '-20%',
    right: '-10%',
    width: '500px',
    height: '500px',
    borderRadius: '50%',
    background: 'radial-gradient(circle, rgba(212,175,55,0.06) 0%, transparent 70%)',
    pointerEvents: 'none',
  },
  bgOrb2: {
    position: 'absolute',
    bottom: '-20%',
    left: '-10%',
    width: '400px',
    height: '400px',
    borderRadius: '50%',
    background: 'radial-gradient(circle, rgba(59,130,246,0.08) 0%, transparent 70%)',
    pointerEvents: 'none',
  },
  card: {
    background: 'rgba(15, 28, 50, 0.95)',
    border: '1px solid rgba(212,175,55,0.2)',
    borderRadius: '20px',
    padding: '48px 40px',
    width: '100%',
    maxWidth: '460px',
    position: 'relative',
    boxShadow: '0 24px 80px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.03)',
    backdropFilter: 'blur(20px)',
  },
  logoWrap: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    marginBottom: '28px',
  },
  logoIcon: {
    fontSize: '2.5rem',
    lineHeight: 1,
    filter: 'drop-shadow(0 0 12px rgba(212,175,55,0.4))',
  },
  logoText: {
    fontSize: '1.3rem',
    fontWeight: 700,
    color: '#fff',
    letterSpacing: '-0.02em',
    lineHeight: 1.2,
  },
  tagline: {
    fontSize: '0.78rem',
    color: '#64748b',
    marginTop: '4px',
    lineHeight: 1.4,
  },
  divider: {
    height: '1px',
    background: 'linear-gradient(to right, transparent, rgba(212,175,55,0.3), transparent)',
    marginBottom: '28px',
  },
  tabBar: {
    display: 'flex',
    background: 'rgba(255,255,255,0.04)',
    borderRadius: '10px',
    padding: '4px',
    marginBottom: '28px',
    gap: '4px',
  },
  tab: {
    flex: 1,
    padding: '10px 16px',
    borderRadius: '8px',
    border: 'none',
    background: 'transparent',
    color: '#64748b',
    fontSize: '0.875rem',
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
  tabActive: {
    background: 'rgba(212,175,55,0.15)',
    color: '#d4af37',
    fontWeight: 600,
  },
  panel: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0',
  },
  panelDesc: {
    color: '#94a3b8',
    fontSize: '0.875rem',
    lineHeight: 1.6,
    marginBottom: '24px',
    margin: '0 0 24px',
  },
  featureList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    marginBottom: '28px',
  },
  feature: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    color: '#cbd5e1',
    fontSize: '0.875rem',
    padding: '10px 14px',
    background: 'rgba(255,255,255,0.03)',
    borderRadius: '8px',
    border: '1px solid rgba(255,255,255,0.05)',
  },
  featureIcon: {
    fontSize: '1.1rem',
    flexShrink: 0,
  },
  input: {
    width: '100%',
    padding: '12px 16px',
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px',
    color: '#e2e8f0',
    fontSize: '0.875rem',
    outline: 'none',
    boxSizing: 'border-box',
    fontFamily: 'inherit',
  },
  btnGold: {
    width: '100%',
    padding: '14px 24px',
    background: 'linear-gradient(135deg, #d4af37 0%, #b8941f 100%)',
    border: 'none',
    borderRadius: '10px',
    color: '#0a1628',
    fontSize: '0.95rem',
    fontWeight: 700,
    cursor: 'pointer',
    transition: 'all 0.2s',
    letterSpacing: '0.01em',
    boxShadow: '0 4px 20px rgba(212,175,55,0.3)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  consultNote: {
    textAlign: 'center',
    fontSize: '0.8rem',
    color: '#64748b',
    marginTop: '20px',
    margin: '20px 0 0',
  },
  disclaimer: {
    textAlign: 'center',
    fontSize: '0.72rem',
    color: '#475569',
    lineHeight: 1.6,
    marginTop: '28px',
    padding: '14px',
    background: 'rgba(255,255,255,0.02)',
    borderRadius: '8px',
    border: '1px solid rgba(255,255,255,0.04)',
    margin: '28px 0 0',
  },
  loadingWrap: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#0a1628',
  },
  spinner: {
    width: '40px',
    height: '40px',
    border: '3px solid rgba(212,175,55,0.2)',
    borderTop: '3px solid #d4af37',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },
};
