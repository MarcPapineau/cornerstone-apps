const histamineSymptoms = [
  'Skin flushing or redness (beyond the injection site)',
  'Itching or hives',
  'Nasal congestion or runny nose',
  'Headache or brain fog after injection',
  'Anxiety or heart racing',
  'GI discomfort, bloating, or nausea',
  'Fatigue within 20-60 minutes of injection',
];

const kpvSteps = [
  { step: '01', title: 'Identify the reaction', desc: 'Symptoms appear within 5-30 minutes of injection. If you feel flushing, itching, hives, or sudden anxiety — this is likely histamine, not a dangerous reaction.' },
  { step: '02', title: 'Add KPV to your protocol', desc: 'Inject 100–250mcg KPV subcutaneously 15–30 minutes BEFORE your peptide injection. KPV stabilizes mast cells proactively.' },
  { step: '03', title: 'Reduce your peptide dose', desc: 'Temporarily cut your peptide dose in half. Many reactions are dose-dependent and resolve as you start lower and work up.' },
  { step: '04', title: 'Take antihistamine if needed', desc: 'A standard over-the-counter antihistamine (like cetirizine/Reactine) can provide relief during the adjustment period. Consult Marc before adding supplements.' },
  { step: '05', title: 'Gut healing protocol', desc: 'Histamine reactivity often signals leaky gut. KPV, continued at 250–500mcg/day orally or injected, heals tight junction proteins over 4–8 weeks. Address the root cause.' },
];

export default function SideEffects() {
  return (
    <div style={{ maxWidth: '1000px', margin: '0 auto', padding: '48px 20px' }}>
      {/* Header */}
      <div style={{ marginBottom: '56px' }}>
        <div className="section-eyebrow" style={{ marginBottom: '10px' }}>Safety & Side Effects</div>
        <h1 style={{ fontSize: 'clamp(1.8rem, 4vw, 2.8rem)', fontWeight: 900, margin: '0 0 16px', color: '#fff', letterSpacing: '-0.02em' }}>
          What to Expect — And What to Watch For
        </h1>
        <p style={{ margin: 0, fontSize: '1rem', color: '#64748b', lineHeight: 1.7, maxWidth: '600px' }}>
          Most peptide protocols are well tolerated. But some clients experience reactions — especially early on. This page explains what's expected, what's not, and what to do.
        </p>
      </div>

      {/* GHK-Cu burn */}
      <section style={{ marginBottom: '48px' }}>
        <div className="warning-burn" style={{ padding: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
            <span style={{ fontSize: '1.5rem' }}>🔥</span>
            <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: '#f87171' }}>GHK-Cu: Burning Is Expected — Not Allergic</h2>
          </div>
          <p style={{ margin: '0 0 12px', fontSize: '0.9rem', color: '#fca5a5', lineHeight: 1.7 }}>
            GHK-Cu consistently causes a burning sensation at the injection site. This is one of the most frequently reported "surprises" for new clients.
          </p>
          <p style={{ margin: '0 0 16px', fontSize: '0.9rem', color: '#fca5a5', lineHeight: 1.7 }}>
            <strong style={{ color: '#f87171' }}>Why it happens:</strong> The copper-peptide complex (Cu²⁺ bound to GHK) reacts with tissue upon injection. This is the mechanism working — not an allergic response. The copper is biologically active and the sensation reflects that activity.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {[
              '✓ Inject VERY SLOWLY — over 30-60 full seconds',
              '✓ Warm the syringe to room temperature before injecting',
              '✓ Use a smaller gauge needle (29-31G)',
              '✓ The burning diminishes significantly after the first few sessions',
              '✓ If burning is severe, dilute the injection with 0.1mL sterile water',
            ].map((tip, i) => (
              <div key={i} style={{ fontSize: '0.875rem', color: '#fca5a5' }}>{tip}</div>
            ))}
          </div>
        </div>
      </section>

      {/* NAD+ flush */}
      <section style={{ marginBottom: '48px' }}>
        <div className="warning-flush" style={{ padding: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
            <span style={{ fontSize: '1.5rem' }}>🌡️</span>
            <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: '#fb923c' }}>NAD+: Flushing Is Expected — Inject Slowly</h2>
          </div>
          <p style={{ margin: '0 0 12px', fontSize: '0.9rem', color: '#fdba74', lineHeight: 1.7 }}>
            NAD+ causes warmth, flushing, and tingling during injection — particularly at doses of 100mg+. This is completely expected and temporary.
          </p>
          <p style={{ margin: '0 0 16px', fontSize: '0.9rem', color: '#fdba74', lineHeight: 1.7 }}>
            <strong style={{ color: '#fb923c' }}>Why it happens:</strong> NAD+ rapidly activates cellular metabolism. The warmth and flushing is your body responding to sudden mitochondrial activation — similar to a niacin flush, but via a different pathway.
          </p>
          <div style={{ background: 'rgba(249,115,22,0.1)', borderRadius: '10px', padding: '14px 16px', marginBottom: '16px' }}>
            <strong style={{ color: '#fb923c', fontSize: '0.85rem' }}>Titration Protocol:</strong>
            <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {[
                'Week 1: Start at 50-100mg. Inject over 3-5 minutes.',
                'Week 2: Increase to 150-200mg if tolerated.',
                'Week 3+: Work up to 250mg target dose.',
                'The body adapts — flushing diminishes after 3-5 sessions at each dose level.',
              ].map((line, i) => (
                <span key={i} style={{ fontSize: '0.85rem', color: '#fdba74' }}>• {line}</span>
              ))}
            </div>
          </div>
          <p style={{ margin: 0, fontSize: '0.875rem', color: '#fdba74' }}>
            ⏱ Flushing peaks at 5-15 minutes and fully resolves within 30-45 minutes. Plan injections accordingly.
          </p>
        </div>
      </section>

      {/* Histamine reactions */}
      <section style={{ marginBottom: '48px' }}>
        <h2 style={{ fontSize: '1.3rem', fontWeight: 700, color: '#fff', margin: '0 0 8px' }}>🔬 Histamine Reactions — The Full Picture</h2>
        <p style={{ margin: '0 0 24px', fontSize: '0.875rem', color: '#64748b' }}>
          This is the most important safety education for any peptide client.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '20px', marginBottom: '32px' }}>
          <div style={{ background: 'rgba(168,85,247,0.08)', border: '1px solid rgba(168,85,247,0.2)', borderRadius: '14px', padding: '20px' }}>
            <div style={{ fontSize: '1.3rem', marginBottom: '10px' }}>🧬</div>
            <h3 style={{ margin: '0 0 8px', fontSize: '0.95rem', fontWeight: 700, color: '#c084fc' }}>Why Reactions Happen</h3>
            <p style={{ margin: 0, fontSize: '0.85rem', color: '#d8b4fe', lineHeight: 1.6 }}>
              Peptides are bioactive compounds that interact with cellular receptors. In clients with mast cell sensitivity or a compromised gut barrier, peptide administration can trigger mast cell degranulation — releasing histamine systemically.
            </p>
          </div>
          <div style={{ background: 'rgba(168,85,247,0.08)', border: '1px solid rgba(168,85,247,0.2)', borderRadius: '14px', padding: '20px' }}>
            <div style={{ fontSize: '1.3rem', marginBottom: '10px' }}>🫁</div>
            <h3 style={{ margin: '0 0 8px', fontSize: '0.95rem', fontWeight: 700, color: '#c084fc' }}>What It Means</h3>
            <p style={{ margin: 0, fontSize: '0.85rem', color: '#d8b4fe', lineHeight: 1.6 }}>
              A histamine reaction is NOT a sign that peptides are dangerous or that you should stop. It's a signal that your gut barrier needs attention. Most clients with initial reactions fully resolve them within 2-4 weeks on KPV.
            </p>
          </div>
        </div>

        <div style={{ background: 'rgba(168,85,247,0.06)', border: '1px solid rgba(168,85,247,0.15)', borderRadius: '14px', padding: '20px', marginBottom: '28px' }}>
          <h3 style={{ margin: '0 0 14px', fontSize: '0.95rem', fontWeight: 700, color: '#c084fc' }}>Common Histamine Symptoms (Watch for These)</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '8px' }}>
            {histamineSymptoms.map((symptom, i) => (
              <div key={i} style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <span style={{ color: '#c084fc', fontSize: '0.8rem', flexShrink: 0 }}>◆</span>
                <span style={{ fontSize: '0.85rem', color: '#d8b4fe' }}>{symptom}</span>
              </div>
            ))}
          </div>
        </div>

        {/* KPV solution */}
        <div style={{ background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: '14px', padding: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
            <span style={{ fontSize: '1.5rem' }}>🌿</span>
            <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: '#4ade80' }}>The Solution: KPV</h2>
          </div>
          <p style={{ margin: '0 0 20px', fontSize: '0.9rem', color: '#86efac', lineHeight: 1.7 }}>
            KPV (Lys-Pro-Val) is a tripeptide fragment of alpha-MSH. It is the primary intervention for peptide-induced histamine reactions. It works by directly inhibiting NF-κB and stabilizing mast cell degranulation.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {kpvSteps.map(item => (
              <div key={item.step} style={{ display: 'flex', gap: '14px', padding: '14px 16px', background: 'rgba(34,197,94,0.06)', borderRadius: '10px' }}>
                <span style={{ minWidth: '28px', height: '28px', borderRadius: '50%', background: 'rgba(34,197,94,0.2)', color: '#4ade80', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.72rem', fontWeight: 700, flexShrink: 0 }}>{item.step}</span>
                <div>
                  <div style={{ fontSize: '0.875rem', fontWeight: 700, color: '#fff', marginBottom: '4px' }}>{item.title}</div>
                  <p style={{ margin: 0, fontSize: '0.82rem', color: '#86efac', lineHeight: 1.5 }}>{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* General safety */}
      <section style={{ marginBottom: '48px' }}>
        <h2 style={{ fontSize: '1.3rem', fontWeight: 700, color: '#fff', margin: '0 0 20px' }}>⚠️ General Safety Principles</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '14px' }}>
          {[
            { icon: '📉', title: 'Start Low', desc: 'Always begin at the lowest recommended dose and titrate up over 1-2 weeks. Your body needs time to adapt.' },
            { icon: '📋', title: 'Never Self-Prescribe', desc: 'Every protocol should be designed with Marc based on your health history and bloodwork. Do not guess at stacks or doses.' },
            { icon: '💉', title: 'Sterile Technique', desc: 'Swab vial tops with alcohol before every draw. Use a fresh needle for each injection. Never reuse needles.' },
            { icon: '🩺', title: 'Know Your Baseline', desc: 'Get baseline bloodwork before starting. This lets Marc track changes and catch anything that needs attention.' },
            { icon: '📝', title: 'Log Everything', desc: 'Keep a simple log: date, compound, dose, time, and how you felt. This data is invaluable for protocol optimization.' },
            { icon: '🚨', title: 'When to Stop', desc: 'Stop immediately and contact your doctor if you experience severe difficulty breathing, rapid heartbeat, or significant swelling. These are rare but warrant immediate medical attention.' },
          ].map(item => (
            <div key={item.title} style={{ display: 'flex', gap: '14px', padding: '16px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '12px' }}>
              <span style={{ fontSize: '1.3rem', flexShrink: 0 }}>{item.icon}</span>
              <div>
                <div style={{ fontSize: '0.875rem', fontWeight: 700, color: '#fff', marginBottom: '6px' }}>{item.title}</div>
                <p style={{ margin: 0, fontSize: '0.8rem', color: '#94a3b8', lineHeight: 1.5 }}>{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="disclaimer">
        This safety information is educational and for research purposes only. It does not replace personalized medical guidance. If you experience severe or unusual reactions, stop your protocol immediately and consult a qualified healthcare professional.
      </div>
    </div>
  );
}
