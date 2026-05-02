const units = [
  {
    term: 'mg',
    full: 'Milligrams',
    desc: 'The unit most vials are measured in. 1mg = 1,000mcg.',
    example: 'A 5mg vial of BPC-157 contains 5,000mcg of peptide.',
    color: '#60a5fa',
  },
  {
    term: 'mcg',
    full: 'Micrograms',
    desc: '1,000 micrograms = 1 milligram. Most peptide doses are measured in mcg.',
    example: 'A typical BPC-157 dose is 250–500mcg per injection.',
    color: '#4ade80',
  },
  {
    term: 'mL',
    full: 'Milliliters',
    desc: 'The volume unit. Tells you how much liquid to draw into the syringe.',
    example: 'Draw 0.10mL for a 250mcg dose (from a 2,500mcg/mL solution).',
    color: '#c084fc',
  },
  {
    term: 'Units (U)',
    full: 'Insulin Syringe Units',
    desc: 'U-100 insulin syringes are marked in units. 1 unit = 0.01mL. 100 units = 1mL.',
    example: 'For 0.10mL, draw to the "10 unit" mark on your U-100 syringe.',
    color: '#d4af37',
  },
  {
    term: 'mg/mL',
    full: 'Concentration',
    desc: 'How much peptide is in each mL of solution after reconstitution.',
    example: 'Adding 2mL BAC water to a 5mg vial = 2.5mg/mL = 2,500mcg/mL.',
    color: '#fb923c',
  },
  {
    term: 'cc',
    full: 'Cubic Centimeters',
    desc: 'Equivalent to mL for liquid measurements. 1cc = 1mL.',
    example: 'A 1cc syringe holds 1mL. Used interchangeably in medical contexts.',
    color: '#f472b6',
  },
];

const storageRules = [
  { icon: '🔒', title: 'Lyophilized (Dry Powder)', desc: 'Unopened vials can be stored at room temperature or refrigerated. Keep away from light and humidity. Shelf life: 12-24 months.' },
  { icon: '❄️', title: 'After Reconstitution', desc: 'Always refrigerate immediately after adding BAC water. Use within 28 days (14 days for NAD+, 21 days for Semax/Selank). Never freeze a reconstituted vial.' },
  { icon: '🧊', title: 'Never Freeze', desc: 'Freezing a reconstituted peptide damages the molecular structure. Keep in the refrigerator, not the freezer.' },
  { icon: '💡', title: 'Protect from Light', desc: 'UV light degrades peptides. Store in the original dark vial. NAD+ is especially sensitive to light exposure.' },
  { icon: '🌡️', title: 'Temperature', desc: 'Refrigerate at 2-8°C (35-46°F). Never leave reconstituted peptides at room temperature for extended periods.' },
  { icon: '🏷️', title: 'Label Your Vials', desc: 'Write the date of reconstitution on every vial. This is how you track the 28-day (or 21/14-day) use window.' },
];

export default function DosingGuide() {
  return (
    <div style={{ maxWidth: '1000px', margin: '0 auto', padding: '48px 20px' }}>
      {/* Header */}
      <div style={{ marginBottom: '56px' }}>
        <div className="section-eyebrow" style={{ marginBottom: '10px' }}>Dosing Guide</div>
        <h1 style={{ fontSize: 'clamp(1.8rem, 4vw, 2.8rem)', fontWeight: 900, margin: '0 0 16px', color: '#fff', letterSpacing: '-0.02em' }}>
          Complete Dosing Reference
        </h1>
        <p style={{ margin: 0, fontSize: '1rem', color: '#64748b', lineHeight: 1.7, maxWidth: '600px' }}>
          Everything you need to understand units, reconstitute correctly, use your syringe, and store your peptides safely.
        </p>
      </div>

      {/* Units explainer */}
      <section style={{ marginBottom: '64px' }}>
        <h2 style={{ fontSize: '1.3rem', fontWeight: 700, color: '#fff', margin: '0 0 8px' }}>📐 Understanding Units</h2>
        <p style={{ margin: '0 0 24px', fontSize: '0.875rem', color: '#64748b' }}>Before you draw your first dose, know what these terms mean.</p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
          {units.map(unit => (
            <div key={unit.term} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '14px', padding: '20px', borderLeft: `3px solid ${unit.color}` }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '8px' }}>
                <span style={{ fontSize: '1.3rem', fontWeight: 800, color: unit.color, fontFamily: 'monospace' }}>{unit.term}</span>
                <span style={{ fontSize: '0.78rem', color: '#64748b', fontWeight: 500 }}>{unit.full}</span>
              </div>
              <p style={{ margin: '0 0 10px', fontSize: '0.85rem', color: '#94a3b8', lineHeight: 1.5 }}>{unit.desc}</p>
              <div style={{ padding: '8px 12px', background: `${unit.color}12`, borderRadius: '8px', border: `1px solid ${unit.color}20` }}>
                <span style={{ fontSize: '0.78rem', color: unit.color, fontWeight: 500 }}>Example: {unit.example}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Reconstitution steps */}
      <section style={{ marginBottom: '64px' }}>
        <h2 style={{ fontSize: '1.3rem', fontWeight: 700, color: '#fff', margin: '0 0 8px' }}>🧪 Standard Reconstitution Protocol</h2>
        <p style={{ margin: '0 0 24px', fontSize: '0.875rem', color: '#64748b' }}>This process applies to most peptide vials. Exact BAC water volumes vary — always check the compound profile.</p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {[
            { step: '01', title: 'Gather supplies', desc: 'Vial of lyophilized peptide, bacteriostatic water (BAC water), 1–2 alcohol swabs, a reconstitution/drawing syringe (18–25 gauge), and your insulin syringe for dosing.' },
            { step: '02', title: 'Swab the vial tops', desc: 'Wipe the rubber stopper on both the peptide vial and BAC water vial with an alcohol swab. Let air dry for 10 seconds.' },
            { step: '03', title: 'Draw BAC water', desc: 'Draw the required amount of BAC water into your syringe (see each compound\'s profile — usually 1–2mL). Point the needle to the side and check for bubbles; tap to remove.' },
            { step: '04', title: 'Inject at an angle', desc: 'Insert the needle at the edge of the peptide vial stopper. Let the BAC water run down the inside wall of the vial — do NOT spray directly onto the powder.' },
            { step: '05', title: 'Swirl gently', desc: 'Gently swirl the vial until the powder dissolves completely. DO NOT shake. Shaking can damage the peptide structure. Solution should be clear (except GHK-Cu, which is blue/green).' },
            { step: '06', title: 'Label and refrigerate', desc: 'Write today\'s date on the vial with a marker. Place in the refrigerator immediately. Use within the compound\'s window (28 days for most, 21 for Semax/Selank, 14 for NAD+).' },
          ].map(item => (
            <div key={item.step} style={{ display: 'flex', gap: '16px', padding: '18px 20px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '12px' }}>
              <div style={{ minWidth: '36px', height: '36px', borderRadius: '10px', background: 'rgba(212,175,55,0.15)', color: '#d4af37', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.78rem', fontWeight: 700, flexShrink: 0 }}>{item.step}</div>
              <div>
                <div style={{ fontSize: '0.9rem', fontWeight: 700, color: '#fff', marginBottom: '6px' }}>{item.title}</div>
                <p style={{ margin: 0, fontSize: '0.85rem', color: '#94a3b8', lineHeight: 1.6 }}>{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Syringe guide */}
      <section style={{ marginBottom: '64px' }}>
        <h2 style={{ fontSize: '1.3rem', fontWeight: 700, color: '#fff', margin: '0 0 8px' }}>💉 Syringe Guide</h2>
        <p style={{ margin: '0 0 24px', fontSize: '0.875rem', color: '#64748b' }}>U-100 insulin syringes are standard. Here's how to read them.</p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px', marginBottom: '24px' }}>
          {[
            { title: 'Use U-100 Insulin Syringes', desc: '1mL capacity, marked 0-100 units. Each unit = 0.01mL. These are available at most pharmacies without prescription.', icon: '💉' },
            { title: 'Gauge Matters', desc: '28-31 gauge needles minimize injection discomfort. Higher gauge = thinner needle = less pain. 29G or 31G recommended for subQ.', icon: '📏' },
            { title: 'Subcutaneous Injection', desc: 'Most peptides are injected subcutaneously — pinch skin on abdomen, thigh, or arm, inject at 45° angle, 1-2 inches from navel.', icon: '🎯' },
            { title: 'Rotate Sites', desc: 'Rotate injection sites to prevent scar tissue buildup. Keep a simple log to track which area you used last.', icon: '🔄' },
          ].map(item => (
            <div key={item.title} style={{ padding: '18px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '12px' }}>
              <div style={{ fontSize: '1.4rem', marginBottom: '10px' }}>{item.icon}</div>
              <div style={{ fontSize: '0.9rem', fontWeight: 700, color: '#fff', marginBottom: '8px' }}>{item.title}</div>
              <p style={{ margin: 0, fontSize: '0.82rem', color: '#94a3b8', lineHeight: 1.5 }}>{item.desc}</p>
            </div>
          ))}
        </div>

        {/* Quick unit conversion */}
        <div style={{ background: 'rgba(212,175,55,0.06)', border: '1px solid rgba(212,175,55,0.15)', borderRadius: '12px', padding: '20px' }}>
          <div style={{ fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#d4af37', marginBottom: '14px' }}>Quick Unit Conversion (U-100 Syringe)</div>
          <div style={{ overflowX: 'auto' }}>
            <table className="syringe-table">
              <thead>
                <tr>
                  <th>Volume</th>
                  <th>Units (U-100 Syringe)</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['0.05mL', '5 units'],
                  ['0.10mL', '10 units'],
                  ['0.20mL', '20 units'],
                  ['0.25mL', '25 units'],
                  ['0.40mL', '40 units'],
                  ['0.50mL', '50 units'],
                  ['1.00mL', '100 units'],
                ].map(([vol, units]) => (
                  <tr key={vol}>
                    <td style={{ fontWeight: 600 }}>{vol}</td>
                    <td style={{ color: '#d4af37', fontWeight: 700 }}>{units}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Storage */}
      <section style={{ marginBottom: '48px' }}>
        <h2 style={{ fontSize: '1.3rem', fontWeight: 700, color: '#fff', margin: '0 0 8px' }}>❄️ Storage Rules</h2>
        <p style={{ margin: '0 0 24px', fontSize: '0.875rem', color: '#64748b' }}>Proper storage is essential for maintaining potency.</p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '14px' }}>
          {storageRules.map(rule => (
            <div key={rule.title} style={{ display: 'flex', gap: '14px', padding: '16px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '12px' }}>
              <span style={{ fontSize: '1.4rem', flexShrink: 0 }}>{rule.icon}</span>
              <div>
                <div style={{ fontSize: '0.88rem', fontWeight: 700, color: '#fff', marginBottom: '6px' }}>{rule.title}</div>
                <p style={{ margin: 0, fontSize: '0.8rem', color: '#94a3b8', lineHeight: 1.5 }}>{rule.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="disclaimer">
        This dosing guide is for educational purposes. Always follow the specific instructions provided by Marc for your individual protocol. Do not adjust doses without consultation.
      </div>
    </div>
  );
}
