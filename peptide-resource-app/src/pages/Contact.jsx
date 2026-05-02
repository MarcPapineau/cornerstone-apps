import { useState } from 'react';

export default function Contact() {
  const [form, setForm] = useState({ name: '', email: '', phone: '', compounds: [], outcomes: [], issues: '', timeline: '', message: '' });
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
          compounds: form.compounds,
          outcomes: form.outcomes,
          issues: form.issues,
          timeline: form.timeline,
          message: form.message,
        }),
      });

      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Submission failed');
      setSubmitted(true);
    } catch (err) {
      setError('Something went wrong. Please email Marc directly at marc@cornerstoneregroup.ca');
    } finally {
      setSending(false);
    }
  };

  return (
    <div style={{ maxWidth: '900px', margin: '0 auto', padding: '48px 20px' }}>
      {/* Header */}
      <div style={{ marginBottom: '56px', textAlign: 'center' }}>
        <div className="section-eyebrow" style={{ marginBottom: '10px' }}>Get Started</div>
        <h1 style={{ fontSize: 'clamp(1.8rem, 4vw, 2.8rem)', fontWeight: 900, margin: '0 0 16px', color: '#fff', letterSpacing: '-0.02em' }}>
          Ready to Build Your Protocol?
        </h1>
        <p style={{ margin: '0 auto', fontSize: '1rem', color: '#64748b', lineHeight: 1.7, maxWidth: '560px' }}>
          Book a consultation with Marc Papineau. Every protocol is personalized — based on your bloodwork, health history, and specific goals.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '48px', alignItems: 'start' }}>
        {/* Contact info */}
        <div>
          <div style={{ marginBottom: '32px' }}>
            <h2 style={{ fontSize: '1.15rem', fontWeight: 700, color: '#fff', margin: '0 0 20px' }}>About Marc</h2>
            <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-start', marginBottom: '16px' }}>
              <div style={{ width: '64px', height: '64px', borderRadius: '16px', background: 'rgba(212,175,55,0.1)', border: '1px solid rgba(212,175,55,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.8rem', flexShrink: 0 }}>
                🏥
              </div>
              <div>
                <div style={{ fontWeight: 700, color: '#fff', fontSize: '1rem' }}>Marc Papineau</div>
                <div style={{ color: '#64748b', fontSize: '0.875rem', marginTop: '2px' }}>Peptide Researcher & Protocol Designer</div>
                <div style={{ color: '#64748b', fontSize: '0.8rem', marginTop: '4px' }}>Ottawa, Ontario</div>
              </div>
            </div>
            <p style={{ margin: 0, fontSize: '0.875rem', color: '#94a3b8', lineHeight: 1.7 }}>
              Marc works with clients to design research-backed peptide protocols tailored to their unique goals — whether that's healing, longevity, performance, or metabolic health.
            </p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <a href="mailto:marc@cornerstoneregroup.ca" style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 16px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '12px', textDecoration: 'none', color: 'inherit', transition: 'all 0.2s' }}>
              <span style={{ fontSize: '1.2rem' }}>📧</span>
              <div>
                <div style={{ fontSize: '0.72rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Email</div>
                <div style={{ fontSize: '0.875rem', color: '#cbd5e1' }}>marc@cornerstoneregroup.ca</div>
              </div>
            </a>

            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 16px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '12px' }}>
              <span style={{ fontSize: '1.2rem' }}>🕐</span>
              <div>
                <div style={{ fontSize: '0.72rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Response Time</div>
                <div style={{ fontSize: '0.875rem', color: '#cbd5e1' }}>Usually within 24 hours</div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 16px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '12px' }}>
              <span style={{ fontSize: '1.2rem' }}>📍</span>
              <div>
                <div style={{ fontSize: '0.72rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Location</div>
                <div style={{ fontSize: '0.875rem', color: '#cbd5e1' }}>Ottawa, Ontario — Virtual Consultations Available</div>
              </div>
            </div>
          </div>

          {/* What to expect */}
          <div style={{ marginTop: '32px', padding: '20px', background: 'rgba(212,175,55,0.06)', border: '1px solid rgba(212,175,55,0.15)', borderRadius: '14px' }}>
            <h3 style={{ margin: '0 0 14px', fontSize: '0.9rem', fontWeight: 700, color: '#d4af37' }}>What a Consultation Includes</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {[
                'Review of your health history and goals',
                'Bloodwork recommendations (if needed)',
                'Custom compound selection for your stack',
                'Exact dosing and timing protocols',
                'Reconstitution and injection guidance',
                'Ongoing support and protocol adjustments',
              ].map((item, i) => (
                <div key={i} style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                  <span style={{ color: '#d4af37', fontSize: '0.8rem', marginTop: '2px' }}>✓</span>
                  <span style={{ fontSize: '0.82rem', color: '#94a3b8' }}>{item}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Contact form */}
        <div>
          {submitted ? (
            <div style={{ textAlign: 'center', padding: '48px 24px', background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: '16px' }}>
              <div style={{ fontSize: '3rem', marginBottom: '16px' }}>✅</div>
              <h3 style={{ margin: '0 0 12px', color: '#4ade80', fontSize: '1.2rem' }}>Request Received!</h3>
              <p style={{ margin: 0, color: '#86efac', fontSize: '0.9rem', lineHeight: 1.6 }}>Marc has been notified and will be in touch within 24 hours to discuss your protocol.</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <h2 style={{ margin: '0 0 4px', fontSize: '1.1rem', fontWeight: 700, color: '#fff' }}>Book Your Consultation</h2>
              <p style={{ margin: '0 0 8px', fontSize: '0.82rem', color: '#64748b' }}>Answer a few quick questions so Marc can come prepared. He'll get back to you within 24 hours.</p>

              <div>
                <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: '#94a3b8', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Full Name *</label>
                <input required className="input-dark" name="name" value={form.name} onChange={handleChange} placeholder="Your name" />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: '#94a3b8', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Email *</label>
                <input required type="email" className="input-dark" name="email" value={form.email} onChange={handleChange} placeholder="your@email.com" />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: '#94a3b8', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Phone (Optional)</label>
                <input className="input-dark" name="phone" value={form.phone} onChange={handleChange} placeholder="613-555-0100" />
              </div>

              {/* Q1 — Peptides of interest */}
              <div>
                <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: '#94a3b8', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Which peptides interest you most? <span style={{ color: '#475569', fontWeight: 400, textTransform: 'none' }}>(select all that apply)</span>
                </label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {['BPC-157','TB-500','CJC-1295 / Ipamorelin','NAD+','Retatrutide / Semaglutide','GHK-Cu','PT-141','Kisspeptin','Semax / Selank','Epitalon','MOTS-c','SS-31','Not sure yet'].map(opt => {
                    const selected = form.compounds.includes(opt);
                    return (
                      <button key={opt} type="button"
                        onClick={() => setForm(prev => ({
                          ...prev,
                          compounds: selected ? prev.compounds.filter(c => c !== opt) : [...prev.compounds, opt]
                        }))}
                        style={{
                          padding: '7px 13px', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s',
                          border: `1px solid ${selected ? '#d4af37' : 'rgba(255,255,255,0.12)'}`,
                          background: selected ? 'rgba(212,175,55,0.12)' : 'rgba(255,255,255,0.03)',
                          color: selected ? '#d4af37' : '#94a3b8',
                        }}
                      >{opt}</button>
                    );
                  })}
                </div>
              </div>

              {/* Q2 — Outcomes */}
              <div>
                <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: '#94a3b8', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  What outcomes are you looking for? <span style={{ color: '#475569', fontWeight: 400, textTransform: 'none' }}>(select all that apply)</span>
                </label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {['Fat Loss','Muscle & Performance','Healing & Recovery','Anti-Aging & Longevity','Better Sleep','Cognitive Focus','Hormonal Balance','Fertility','Menopause Support','Libido & Sexual Health','Immune Support','Cardiovascular Health','Metabolic / Blood Sugar'].map(opt => {
                    const selected = form.outcomes.includes(opt);
                    return (
                      <button key={opt} type="button"
                        onClick={() => setForm(prev => ({
                          ...prev,
                          outcomes: selected ? prev.outcomes.filter(o => o !== opt) : [...prev.outcomes, opt]
                        }))}
                        style={{
                          padding: '7px 13px', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s',
                          border: `1px solid ${selected ? '#d4af37' : 'rgba(255,255,255,0.12)'}`,
                          background: selected ? 'rgba(212,175,55,0.12)' : 'rgba(255,255,255,0.03)',
                          color: selected ? '#d4af37' : '#94a3b8',
                        }}
                      >{opt}</button>
                    );
                  })}
                </div>
              </div>

              {/* Q3 — Main issues */}
              <div>
                <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: '#94a3b8', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>What are the main issues you want to resolve? *</label>
                <textarea
                  required
                  className="input-dark"
                  name="issues"
                  value={form.issues}
                  onChange={handleChange}
                  placeholder="e.g. chronic knee pain from an old injury, low energy since my 40s, trouble sleeping, stubborn belly fat..."
                  rows={3}
                  style={{ resize: 'vertical' }}
                />
              </div>

              {/* Q4 — Timeline */}
              <div>
                <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: '#94a3b8', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>When are you looking to get started? *</label>
                <select required className="input-dark" name="timeline" value={form.timeline} onChange={handleChange} style={{ cursor: 'pointer' }}>
                  <option value="">Select a timeline</option>
                  <option value="Right away — I'm ready">Right away — I'm ready</option>
                  <option value="Within the next 2 weeks">Within the next 2 weeks</option>
                  <option value="Within the next month">Within the next month</option>
                  <option value="Just researching for now">Just researching for now</option>
                </select>
              </div>

              {/* Additional notes */}
              <div>
                <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: '#94a3b8', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Anything else Marc should know?</label>
                <textarea
                  className="input-dark"
                  name="message"
                  value={form.message}
                  onChange={handleChange}
                  placeholder="Health history, medications, previous experience with peptides, questions..."
                  rows={3}
                  style={{ resize: 'vertical' }}
                />
              </div>

              <button type="submit" className="btn-gold" disabled={sending} style={{ width: '100%', padding: '14px', fontSize: '0.95rem', cursor: sending ? 'wait' : 'pointer', opacity: sending ? 0.7 : 1 }}>
                {sending ? 'Sending...' : 'Send Message to Marc →'}
              </button>

              <p style={{ margin: 0, fontSize: '0.75rem', color: '#64748b', textAlign: 'center', lineHeight: 1.5 }}>
                Your information is sent securely. Marc will follow up within 24 hours.
              </p>
            </form>
          )}
        </div>
      </div>

      {/* Disclaimer */}
      <div style={{ marginTop: '60px' }} className="disclaimer">
        <p style={{ margin: 0 }}>
          ⚠️ <strong>Important Disclaimer:</strong> Marc Papineau is a peptide researcher, not a licensed physician or pharmacist. Consultations are for informational and educational purposes only. Nothing discussed constitutes medical advice or a patient-physician relationship. Always consult a qualified healthcare professional before beginning any supplement or peptide protocol. You are responsible for your own health decisions.
        </p>
      </div>
    </div>
  );
}
