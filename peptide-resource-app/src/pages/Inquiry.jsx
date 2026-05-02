import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';

// NOTE: No GHL token here. All GHL calls go through /.netlify/functions/ghl-proxy
// so the Private Integration Token never reaches the browser bundle.

async function submitToGHL(form, basket) {
  const basketNote = basket.length > 0
    ? `\n\nSaved Basket (${basket.length} compounds):\n${basket.map(c => `• ${c}`).join('\n')}`
    : '';
  const note = `INQUIRY FORM LEAD\nType: ${form.inquiryType}\nMessage: ${form.message || 'None'}${basketNote}`;

  // Proxy: token stays server-side in ghl-proxy function, never in the bundle.
  const res = await fetch('/.netlify/functions/ghl-proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'inquiry-contact',
      firstName: form.name.split(' ')[0],
      lastName: form.name.split(' ').slice(1).join(' ') || '',
      email: form.email,
      phone: form.phone || undefined,
      tags: ['inquiry-form', 'cornerstone-re-health'],
      source: 'Cornerstone RE Health — Inquiry Form',
      note,
    }),
  });
  const data = await res.json();
  return data?.contactId;
}

const INQUIRY_TYPES = [
  'General Question',
  'Protocol Design',
  'Dosing Guidance',
  'Product Availability',
  'Stack Review',
  'Other',
];

export default function Inquiry() {
  const location = useLocation();
  const preloaded = location.state?.basket || [];

  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    inquiryType: INQUIRY_TYPES[0],
    message: '',
  });
  const [basket, setBasket] = useState(preloaded);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  // Load saved basket from localStorage if not passed via router state
  useEffect(() => {
    if (preloaded.length === 0) {
      try {
        const saved = localStorage.getItem('vitalis_basket');
        if (saved) setBasket(JSON.parse(saved));
      } catch {}
    }
  }, []);

  function set(k, v) { setForm(p => ({ ...p, [k]: v })); }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.name || !form.email || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      await submitToGHL(form, basket);
      setDone(true);
    } catch (err) {
      setError('Submission failed. Please try again or email directly.');
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div style={{ minHeight: '100vh', background: '#0a1628', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 20px' }}>
        <div style={{ maxWidth: '480px', textAlign: 'center' }}>
          <div style={{ fontSize: '3.5rem', marginBottom: '16px' }}>✅</div>
          <h2 style={{ color: '#fff', fontWeight: 800, marginBottom: '12px' }}>Inquiry Received</h2>
          <p style={{ color: '#94a3b8', fontSize: '0.95rem', lineHeight: 1.7, marginBottom: '28px' }}>
            Marc will review your inquiry and follow up within 24–48 hours.
          </p>
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
            <a href="/compounds" style={{ padding: '10px 20px', borderRadius: '10px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)', color: '#94a3b8', textDecoration: 'none', fontWeight: 600, fontSize: '0.875rem' }}>Browse Compounds</a>
            <a href="/stack-builder" style={{ padding: '10px 20px', borderRadius: '10px', background: 'rgba(212,175,55,0.08)', border: '1px solid rgba(212,175,55,0.25)', color: '#d4af37', textDecoration: 'none', fontWeight: 600, fontSize: '0.875rem' }}>Build a Stack</a>
          </div>
        </div>
      </div>
    );
  }

  const canSubmit = form.name.trim() && form.email.trim() && !submitting;

  return (
    <div style={{ minHeight: '100vh', background: '#0a1628', padding: '48px 20px' }}>
      <div style={{ maxWidth: '560px', margin: '0 auto' }}>

        {/* Header */}
        <div style={{ marginBottom: '32px' }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: '#d4af37', marginBottom: '8px' }}>
            Research Inquiry
          </div>
          <h1 style={{ color: '#fff', fontWeight: 800, fontSize: '1.8rem', margin: '0 0 8px' }}>
            Ask Marc Directly
          </h1>
          <p style={{ color: '#64748b', fontSize: '0.9rem', lineHeight: 1.6, margin: 0 }}>
            Questions about protocols, compounds, or your specific situation. Marc reviews every inquiry personally.
          </p>
        </div>

        {/* Pre-loaded basket preview */}
        {basket.length > 0 && (
          <div style={{ background: 'rgba(212,175,55,0.05)', border: '1px solid rgba(212,175,55,0.18)', borderRadius: '12px', padding: '14px', marginBottom: '24px' }}>
            <div style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: '#d4af37', marginBottom: '10px' }}>
              Basket Attached ({basket.length} compounds)
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {basket.map((name, i) => (
                <span key={i} style={{ padding: '3px 9px', borderRadius: '6px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', color: '#cbd5e1', fontSize: '0.75rem' }}>
                  {name}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

            {/* Name */}
            <div>
              <label style={labelStyle}>Full Name *</label>
              <input
                className="input-dark"
                type="text"
                placeholder="Your name"
                value={form.name}
                onChange={e => set('name', e.target.value)}
                required
              />
            </div>

            {/* Email */}
            <div>
              <label style={labelStyle}>Email *</label>
              <input
                className="input-dark"
                type="email"
                placeholder="your@email.com"
                value={form.email}
                onChange={e => set('email', e.target.value)}
                required
              />
            </div>

            {/* Phone */}
            <div>
              <label style={labelStyle}>Phone (optional)</label>
              <input
                className="input-dark"
                type="tel"
                placeholder="+1 (613) 000-0000"
                value={form.phone}
                onChange={e => set('phone', e.target.value)}
              />
            </div>

            {/* Inquiry type */}
            <div>
              <label style={labelStyle}>Inquiry Type</label>
              <select
                className="input-dark"
                value={form.inquiryType}
                onChange={e => set('inquiryType', e.target.value)}
                style={{ cursor: 'pointer' }}
              >
                {INQUIRY_TYPES.map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>

            {/* Message */}
            <div>
              <label style={labelStyle}>Message</label>
              <textarea
                className="input-dark"
                rows={5}
                placeholder="Describe your goals, health history, current protocol, or specific questions..."
                value={form.message}
                onChange={e => set('message', e.target.value)}
                style={{ resize: 'vertical', minHeight: '100px' }}
              />
            </div>

            {/* Error */}
            {error && (
              <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: '8px', padding: '10px 14px', color: '#f87171', fontSize: '0.82rem' }}>
                {error}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={!canSubmit}
              className="btn-gold"
              style={{
                width: '100%',
                padding: '14px',
                fontSize: '0.95rem',
                fontWeight: 700,
                opacity: canSubmit ? 1 : 0.45,
                cursor: canSubmit ? 'pointer' : 'not-allowed',
              }}
            >
              {submitting ? 'Sending…' : 'Send Inquiry to Marc →'}
            </button>

          </div>
        </form>

        <div style={{ marginTop: '40px', padding: '16px', borderTop: '1px solid rgba(255,255,255,0.05)', fontSize: '0.72rem', color: '#334155', lineHeight: 1.6 }}>
          Educational resource only. Not medical advice. All compounds for research purposes only.
        </div>
      </div>
    </div>
  );
}

const labelStyle = {
  display: 'block',
  fontSize: '0.7rem',
  fontWeight: 600,
  color: '#94a3b8',
  marginBottom: '5px',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};
