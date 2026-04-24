// ============================================================
// Book.jsx — Step 5: Book
// Pre-filled consult form → /.netlify/functions/book-consult
// ============================================================

import { useState } from 'react';

function getCartItems() {
  try {
    const raw = sessionStorage.getItem('vitalis_cart_v1');
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export default function Book() {
  const cartItems = getCartItems();
  const cartSummary = cartItems.map(s => s.goal || s.id).join(', ');

  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    goals: cartSummary,
    health: '',
    timeline: '1-3 months',
    message: '',
  });
  const [submitted, setSubmitted] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const handleChange = (e) => setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSending(true);
    setError('');

    try {
      const res = await fetch('/.netlify/functions/book-consult', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          phone: form.phone,
          outcomes: form.goals ? form.goals.split(',').map(s => s.trim()) : [],
          issues: form.health,
          timeline: form.timeline,
          message: form.message,
          source: 'vitalis-waterfall-v1',
          selectedStacks: cartItems.map(s => s.id || s.goal),
        }),
      });

      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Submission failed');
      setSubmitted(true);
      sessionStorage.removeItem('vitalis_cart_v1');
    } catch (err) {
      setError('Submission failed. Email Marc directly at marc@cornerstoneregroup.ca');
    } finally {
      setSending(false);
    }
  };

  if (submitted) {
    return (
      <div style={{
        minHeight: 'calc(100vh - 64px)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#0a1628', padding: '40px 20px',
      }}>
        <div style={{ maxWidth: '500px', textAlign: 'center' }}>
          <div style={{
            width: '64px', height: '64px', borderRadius: '50%',
            background: 'rgba(212,175,55,0.1)', border: '2px solid rgba(212,175,55,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 24px', fontSize: '1.8rem',
          }}>
            ✓
          </div>
          <h2 style={{ fontSize: '1.6rem', fontWeight: 900, color: '#fff', margin: '0 0 12px', letterSpacing: '-0.02em' }}>
            Request Sent to Marc
          </h2>
          <p style={{ color: '#94a3b8', lineHeight: 1.6, margin: '0 0 24px' }}>
            Marc reviews all consult requests personally. Expect a reply within 24 hours at the email you provided.
          </p>
          <p style={{ color: '#64748b', fontSize: '0.82rem', margin: '0 0 32px', lineHeight: 1.5 }}>
            Selected protocols: <span style={{ color: '#d4af37' }}>{cartSummary || 'Custom protocol'}</span>
          </p>
          <a href="/" style={{
            display: 'inline-block', padding: '12px 28px', borderRadius: '10px',
            background: '#d4af37', color: '#0a1628', textDecoration: 'none', fontWeight: 700, fontSize: '0.9rem',
          }}>
            Back to Goals
          </a>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: 'calc(100vh - 64px)',
      background: 'radial-gradient(ellipse at 50% 0%, rgba(212,175,55,0.04) 0%, transparent 50%), #0a1628',
      padding: '0 20px 60px',
    }}>
      <div style={{ maxWidth: '680px', margin: '0 auto' }}>

        {/* Header */}
        <div style={{ padding: '40px 0 32px' }}>
          <div style={{
            display: 'inline-block', fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.14em',
            textTransform: 'uppercase', color: '#d4af37', background: 'rgba(212,175,55,0.1)',
            border: '1px solid rgba(212,175,55,0.25)', borderRadius: '20px', padding: '5px 14px', marginBottom: '16px',
          }}>
            Step 5 of 5 — Book Your Consult
          </div>
          <h1 style={{ fontSize: 'clamp(1.6rem, 4vw, 2.2rem)', fontWeight: 900, margin: '0 0 12px', color: '#fff', letterSpacing: '-0.02em' }}>
            Book with Marc
          </h1>
          <p style={{ fontSize: '0.9rem', color: '#94a3b8', margin: 0, lineHeight: 1.6 }}>
            Every protocol is finalized in a 1-on-1 consult — bloodwork reviewed, history taken, dosing locked.
            Marc reviews every request personally.
          </p>
        </div>

        {/* Selected stacks preview */}
        {cartItems.length > 0 && (
          <div style={{
            padding: '14px 20px', background: 'rgba(212,175,55,0.06)',
            border: '1px solid rgba(212,175,55,0.2)', borderRadius: '12px', marginBottom: '24px',
          }}>
            <div style={{ fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#64748b', marginBottom: '8px' }}>
              Your selected protocols
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {cartItems.map(s => (
                <span key={s.id} style={{
                  padding: '4px 12px', borderRadius: '20px', fontSize: '0.8rem', fontWeight: 600,
                  background: 'rgba(212,175,55,0.1)', border: '1px solid rgba(212,175,55,0.25)', color: '#d4af37',
                }}>
                  {s.goal || s.id}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <Field label="Full Name *" name="name" value={form.name} onChange={handleChange} required placeholder="Jane Smith" />
              <Field label="Email *" name="email" type="email" value={form.email} onChange={handleChange} required placeholder="you@example.com" />
            </div>

            <Field label="Phone (optional)" name="phone" type="tel" value={form.phone} onChange={handleChange} placeholder="+1 (555) 000-0000" />

            <Field
              label="Goals / Protocols"
              name="goals"
              value={form.goals}
              onChange={handleChange}
              placeholder="Fat Loss, Healing & Recovery..."
              hint="Pre-filled from your protocol selections. Edit freely."
            />

            <Field
              label="Health background"
              name="health"
              type="textarea"
              value={form.health}
              onChange={handleChange}
              placeholder="Relevant medical history, current medications, known sensitivities, recent bloodwork..."
            />

            <div>
              <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: '#94a3b8', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Timeline
              </label>
              <select
                name="timeline"
                value={form.timeline}
                onChange={handleChange}
                style={{
                  width: '100%', padding: '11px 14px',
                  background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '8px', color: '#f1f5f9', fontSize: '0.9rem',
                  appearance: 'none', cursor: 'pointer',
                }}
              >
                <option value="ASAP" style={{ background: '#0a1628' }}>Ready to start ASAP</option>
                <option value="1-3 months" style={{ background: '#0a1628' }}>Within 1–3 months</option>
                <option value="3-6 months" style={{ background: '#0a1628' }}>3–6 months out</option>
                <option value="researching" style={{ background: '#0a1628' }}>Still researching</option>
              </select>
            </div>

            <Field
              label="Message (optional)"
              name="message"
              type="textarea"
              value={form.message}
              onChange={handleChange}
              placeholder="Anything else Marc should know before your consult..."
            />

            {error && (
              <div style={{ padding: '12px 16px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: '8px', color: '#ef4444', fontSize: '0.85rem' }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={sending}
              style={{
                padding: '14px 32px', borderRadius: '10px',
                background: sending ? 'rgba(212,175,55,0.4)' : '#d4af37',
                color: '#0a1628', border: 'none', cursor: sending ? 'not-allowed' : 'pointer',
                fontWeight: 800, fontSize: '1rem', width: '100%',
                transition: 'all 0.15s',
              }}
            >
              {sending ? 'Sending…' : 'Submit to Marc →'}
            </button>
          </div>
        </form>

        {/* Marc details */}
        <div style={{ marginTop: '32px', padding: '20px 24px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '12px' }}>
          <div style={{ fontSize: '0.78rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#64748b', marginBottom: '12px' }}>
            About Marc
          </div>
          <p style={{ margin: '0 0 8px', fontSize: '0.85rem', color: '#94a3b8', lineHeight: 1.6 }}>
            Marc Papineau reviews all consult requests within 24 hours. He reads bloodwork, tailors dosing, and builds protocols that are specific to your biology — not generic templates.
          </p>
          <p style={{ margin: 0, fontSize: '0.82rem', color: '#64748b' }}>
            Direct: <a href="mailto:marc@cornerstoneregroup.ca" style={{ color: '#d4af37', textDecoration: 'none' }}>marc@cornerstoneregroup.ca</a>
          </p>
        </div>

        <p style={{ marginTop: '24px', fontSize: '0.72rem', color: '#475569', textAlign: 'center', lineHeight: 1.5 }}>
          Submission is a request for consultation only. No payment or commitment required.
        </p>
      </div>
    </div>
  );
}

function Field({ label, name, type = 'text', value, onChange, required, placeholder, hint }) {
  const isTextarea = type === 'textarea';
  const inputStyle = {
    width: '100%', padding: '11px 14px',
    background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px', color: '#f1f5f9', fontSize: '0.9rem',
    resize: isTextarea ? 'vertical' : undefined,
    minHeight: isTextarea ? '90px' : undefined,
    fontFamily: 'inherit',
    boxSizing: 'border-box',
    outline: 'none',
    transition: 'border-color 0.15s',
  };

  return (
    <div>
      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: '#94a3b8', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {label}
      </label>
      {hint && <p style={{ margin: '0 0 6px', fontSize: '0.75rem', color: '#475569' }}>{hint}</p>}
      {isTextarea ? (
        <textarea
          name={name} value={value} onChange={onChange}
          placeholder={placeholder} style={inputStyle}
          onFocus={e => e.target.style.borderColor = 'rgba(212,175,55,0.4)'}
          onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.1)'}
        />
      ) : (
        <input
          type={type} name={name} value={value} onChange={onChange}
          required={required} placeholder={placeholder} style={inputStyle}
          onFocus={e => e.target.style.borderColor = 'rgba(212,175,55,0.4)'}
          onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.1)'}
        />
      )}
    </div>
  );
}
