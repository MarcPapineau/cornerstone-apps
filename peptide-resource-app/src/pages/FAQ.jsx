import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { COMPOUNDS } from '../data/compounds';

const GENERAL_FAQS = [
  {
    section: '🌐 What Are Peptides?',
    items: [
      {
        q: 'What exactly are peptides? Are they natural?',
        a: 'Peptides are short chains of amino acids — the same building blocks that make up every protein in your body. Your body naturally produces thousands of them. Insulin is a peptide. Growth hormone is a peptide. Oxytocin is a peptide. Most compounds in this catalogue are either identical to naturally occurring human peptides or closely derived from them. The research peptides here are synthetically manufactured versions of those natural sequences, produced in laboratories to precise standards — not foreign chemicals, but signals your biology already knows how to respond to.'
      },
      {
        q: 'How do peptides actually work?',
        a: 'Peptides work by binding to specific receptors on cell surfaces and triggering a cascade of internal signals. Think of a receptor as a lock and a peptide as a key — when the right peptide binds its receptor, the cell receives a specific instruction: produce more collagen, release growth hormone, suppress inflammation, activate DNA repair. The specificity is what makes peptides different from broad-spectrum pharmaceuticals. A well-targeted peptide sends one precise signal to one tissue type without disrupting everything else — which is why the side effect profiles are remarkably clean compared to many drugs.'
      },
      {
        q: 'Are peptides addictive? Can I become dependent on them?',
        a: 'No — peptides are not addictive in any pharmacological sense. They do not interact with dopamine reward pathways, opioid receptors, or the neural circuits involved in chemical dependency. You will not experience cravings, compulsive use, or withdrawal. What some people notice after stopping is the absence of benefits — better sleep, less pain, more energy disappearing as you return to baseline. That is not withdrawal; it is simply your body returning to where it was. The one partial exception is Selank, which works through the enkephalin system, but even it carries zero addiction or dependency risk — specifically studied and confirmed.'
      },
      {
        q: 'What happens when I stop taking peptides?',
        a: 'Most peptides do not create ongoing systemic dependence. For healing compounds (BPC-157, TB-500), the tissue repairs you achieved are generally permanent — a healed tendon stays healed. For GH-stimulating compounds, GH levels gradually return to baseline over days to weeks. For hormonal compounds like Kisspeptin, restored LH pulsatility may persist for some time but will eventually return to pre-protocol levels. The general rule: structural repair is permanent; functional optimization requires continued cycling to maintain.'
      },
      {
        q: 'Has anyone ever died from taking research peptides?',
        a: 'There are no documented fatalities attributable to the peptides in this catalogue at research doses in the published literature. The compounds here — BPC-157, TB-500, CJC-1295, Kisspeptin, PT-141, Semaglutide, NAD+, and others — have extensive safety records accumulated over years of animal studies and human research. The real risks in the peptide research space are: (1) contaminated or mis-labelled products from unreliable suppliers — source quality matters enormously; (2) dosing calculation errors; (3) pre-existing health conditions aggravated by physiological changes without medical supervision. The risk profile compares favourably to many OTC supplements when used correctly at established research doses.'
      },
      {
        q: 'What if I accidentally take a double dose?',
        a: 'For most peptides at typical research doses, a single accidental double dose is unlikely to be dangerous — but it may intensify side effects. GH-stimulating compounds: stronger water retention, more pronounced GH pulse. NAD+: intense flushing if injected quickly — inject very slowly over 10 minutes if this happens. GLP-1 compounds: significant nausea increase — eat nothing, hydrate, rest. PT-141: increased nausea. Universal protocol: stay calm, hydrate, rest, monitor symptoms. If you experience chest pain, difficulty breathing, or concerning symptoms, seek medical attention. No fatalities have been attributed to peptides at research doses.'
      },
    ]
  },
  {
    section: '💉 Practical Use',
    items: [
      {
        q: 'Do I need to refrigerate peptides after reconstitution?',
        a: 'Yes. Once reconstituted with BAC water, peptides must be refrigerated (2–8°C) and used within 28–30 days. Bacteriostatic water contains 0.9% benzyl alcohol which inhibits bacterial growth and gives reconstituted peptides their shelf life. Never use plain sterile water for storage. Unreconstituted vials can be stored at room temperature for short periods or frozen for longer-term storage.'
      },
      {
        q: 'What syringe should I use?',
        a: 'Use an insulin syringe — 1mL (100-unit) U-100 is most common. Each small line = 1 unit = 0.01mL. Needle gauge: 28–31G, 6–8mm for SubQ injection. The higher the gauge number, the finer the needle — 29–31G is ideal for daily use and minimizes discomfort. Longer needles (12mm+) are for intramuscular injection when specified.'
      },
      {
        q: 'Where do I inject?',
        a: 'Subcutaneous (SubQ) into belly fat is most common — pinch 1–2 inches of skin 2 inches from the navel, insert at 45°, inject slowly, release the pinch before withdrawing. Rotate injection sites daily to prevent lipohypertrophy (tissue buildup). Thighs and upper arms work equally well. Some compounds (BPC-157 specifically) can be injected near the injury site for enhanced local effects.'
      },
      {
        q: 'How much BAC water do I add?',
        a: 'For a standard 5mg vial: 2mL BAC water = 2.5mg/mL (2,500mcg/mL). On a 100-unit syringe, every 10 units = 250mcg. This is the default for most compounds. Always check the Dosing Guide for compound-specific instructions — some use different vial sizes or concentrations.'
      },
      {
        q: 'I feel a burning sensation when I inject. Is that normal?',
        a: 'Depends on the compound. GHK-Cu: yes — consistently causes burning due to the copper complex. Expected, not allergic. Inject slowly over 30–60 seconds at room temperature. NAD+: flushing and warmth during injection are expected — inject over 3–5 minutes. BPC-157, TB-500, Ipamorelin: minimal to no burning expected. If burning occurs with a compound not known for it, check your reconstitution ratio.'
      },
      {
        q: 'Can I stack multiple peptides?',
        a: 'Yes — stacking is standard practice. Many peptides have complementary mechanisms: BPC-157 + TB-500 for healing, CJC-1295 + Ipamorelin for GH optimization, Semax + Selank for cognitive performance. Introduce one compound at a time (1–2 weeks between additions) so you can identify which compound causes any reaction. The Stacks page has fully designed multi-compound protocols.'
      },
      {
        q: 'How long before I notice results?',
        a: 'Fastest: PT-141 (45–60 min), NAD+ (hours to days for energy/clarity), BPC-157 for acute gut issues (days). Medium term: GHK-Cu for skin (4–6 weeks), CJC/Ipamorelin for sleep quality (1–2 weeks). Long term: Kisspeptin for fertility/testosterone (8–12 weeks minimum), Epitalon (cycle effects build over months). The biggest variable is consistency — irregularly used compounds produce inconsistent results.'
      },
    ]
  }
];

function AccordionItem({ q, a }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{
      borderBottom: '1px solid rgba(255,255,255,0.06)',
    }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: '100%',
          textAlign: 'left',
          background: 'none',
          border: 'none',
          padding: '18px 0',
          cursor: 'pointer',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: '16px',
          color: open ? '#d4af37' : '#e2e8f0',
          transition: 'color 0.2s',
        }}
      >
        <span style={{ fontSize: '15px', fontWeight: 600, lineHeight: 1.4 }}>{q}</span>
        <span style={{
          flexShrink: 0,
          width: '22px',
          height: '22px',
          borderRadius: '50%',
          border: `1px solid ${open ? '#d4af37' : 'rgba(255,255,255,0.2)'}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '14px',
          color: open ? '#d4af37' : '#64748b',
          transition: 'all 0.2s',
          transform: open ? 'rotate(45deg)' : 'none',
        }}>+</span>
      </button>
      {open && (
        <div style={{
          padding: '0 0 20px',
          fontSize: '14px',
          color: '#94a3b8',
          lineHeight: 1.7,
        }}>
          {a}
        </div>
      )}
    </div>
  );
}

export default function FAQ() {
  const [compoundSearch, setCompoundSearch] = useState('');
  const [selectedCompound, setSelectedCompound] = useState(null);
  const navigate = useNavigate();

  const compoundsWithFaq = COMPOUNDS.filter(c => c.faq && c.faq.length > 0);
  const filteredCompounds = compoundsWithFaq.filter(c =>
    !compoundSearch || c.name.toLowerCase().includes(compoundSearch.toLowerCase())
  );

  return (
    <div style={{ maxWidth: '900px', margin: '0 auto', padding: '48px 20px' }}>
      {/* Header */}
      <div style={{ marginBottom: '48px' }}>
        <div className="section-eyebrow" style={{ marginBottom: '10px' }}>FAQ</div>
        <h1 style={{ fontSize: 'clamp(1.8rem, 4vw, 2.8rem)', fontWeight: 900, margin: '0 0 12px', color: '#fff', letterSpacing: '-0.02em' }}>
          ❓ Frequently Asked Questions
        </h1>
        <p style={{ margin: 0, fontSize: '1rem', color: '#64748b', lineHeight: 1.6, maxWidth: '560px' }}>
          General questions about peptides, safety, and practical use — plus compound-specific Q&amp;As with answers from the research.
        </p>
      </div>

      {/* General FAQs */}
      {GENERAL_FAQS.map(section => (
        <div key={section.section} style={{ marginBottom: '48px' }}>
          <h2 style={{
            fontSize: '13px',
            fontWeight: 800,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            color: '#d4af37',
            marginBottom: '8px',
          }}>
            {section.section}
          </h2>
          <div style={{
            background: 'rgba(255,255,255,0.02)',
            border: '1px solid rgba(255,255,255,0.07)',
            borderRadius: '12px',
            padding: '0 24px',
          }}>
            {section.items.map((item, i) => (
              <AccordionItem key={i} q={item.q} a={item.a} />
            ))}
          </div>
        </div>
      ))}

      {/* Compound-specific FAQs */}
      <div style={{ marginBottom: '32px' }}>
        <h2 style={{
          fontSize: '13px',
          fontWeight: 800,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          color: '#d4af37',
          marginBottom: '16px',
        }}>
          💊 Compound-Specific Q&amp;A
        </h2>
        <input
          type="text"
          placeholder="Search a compound..."
          value={compoundSearch}
          onChange={e => setCompoundSearch(e.target.value)}
          style={{
            width: '100%',
            padding: '12px 16px',
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: '10px',
            color: '#e2e8f0',
            fontSize: '14px',
            marginBottom: '20px',
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />

        {/* Compound selector */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '28px' }}>
          {filteredCompounds.map(c => (
            <button
              key={c.id}
              onClick={() => setSelectedCompound(selectedCompound?.id === c.id ? null : c)}
              style={{
                padding: '7px 14px',
                borderRadius: '8px',
                border: '1px solid',
                fontSize: '13px',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.15s',
                borderColor: selectedCompound?.id === c.id ? '#d4af37' : 'rgba(255,255,255,0.1)',
                background: selectedCompound?.id === c.id ? 'rgba(212,175,55,0.12)' : 'rgba(255,255,255,0.03)',
                color: selectedCompound?.id === c.id ? '#d4af37' : '#94a3b8',
              }}
            >
              {c.emoji} {c.name}
            </button>
          ))}
        </div>

        {/* Selected compound FAQs */}
        {selectedCompound ? (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
              <span style={{ fontSize: '28px' }}>{selectedCompound.emoji}</span>
              <div>
                <div style={{ fontSize: '18px', fontWeight: 800, color: '#fff' }}>{selectedCompound.name}</div>
                <div style={{ fontSize: '13px', color: '#64748b' }}>{selectedCompound.tagline}</div>
              </div>
              <button
                onClick={() => navigate(`/compounds?id=${selectedCompound.id}`)}
                style={{
                  marginLeft: 'auto',
                  padding: '8px 16px',
                  background: 'rgba(212,175,55,0.1)',
                  border: '1px solid rgba(212,175,55,0.3)',
                  borderRadius: '8px',
                  color: '#d4af37',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                Full Profile →
              </button>
            </div>
            <div style={{
              background: 'rgba(255,255,255,0.02)',
              border: '1px solid rgba(255,255,255,0.07)',
              borderRadius: '12px',
              padding: '0 24px',
            }}>
              {selectedCompound.faq.map((item, i) => (
                <AccordionItem key={i} q={item.q} a={item.a} />
              ))}
            </div>
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '40px 0', color: '#475569', fontSize: '14px' }}>
            Select a compound above to see its specific Q&amp;A
          </div>
        )}
      </div>

      <div style={{ marginTop: '40px', padding: '20px', background: 'rgba(255,255,255,0.02)', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.06)', textAlign: 'center' }}>
        <p style={{ margin: 0, fontSize: '0.8rem', color: '#475569', lineHeight: 1.6 }}>
          ⚠️ For educational and research purposes only. Not medical advice. Always consult a qualified healthcare professional before beginning any research protocol.
        </p>
      </div>
    </div>
  );
}
