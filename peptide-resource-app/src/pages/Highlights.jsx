import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

const CATEGORIES = [
  { id: 'all',           label: 'All',                emoji: '🔬' },
  { id: 'libido',        label: 'Libido & Sexual',     emoji: '❤️' },
  { id: 'fertility',     label: 'Fertility',           emoji: '🌱' },
  { id: 'hormonal',      label: 'Hormonal',            emoji: '⚡' },
  { id: 'healing',       label: 'Healing',             emoji: '🩹' },
  { id: 'cardiovascular',label: 'Cardiovascular',      emoji: '❤️‍🔥' },
  { id: 'cognitive',     label: 'Cognitive',           emoji: '🧠' },
  { id: 'longevity',     label: 'Longevity',           emoji: '⏳' },
  { id: 'fat-loss',      label: 'Fat Loss',            emoji: '🔥' },
  { id: 'immune',        label: 'Immune',              emoji: '🛡️' },
  { id: 'sleep',         label: 'Sleep',               emoji: '🌙' },
  { id: 'menopause',     label: 'Menopause',           emoji: '🌸' },
  { id: 'metabolic',     label: 'Metabolic',           emoji: '🩺' },
  { id: 'mitochondria',  label: 'Mitochondria',        emoji: '🔋' },
];

const HIGHLIGHTS = [
  {
    compound: 'PT-141', emoji: '❤️', compoundId: 'pt141',
    categories: ['libido'],
    accent: '#e05a7a',
    headline: 'PT-141 Rescued Erections in 342 Men Who Failed Viagra',
    body: 'A randomized double-blind trial (Safarinejad & Hosseini, J Urology, 2008) tested PT-141 specifically in men for whom Viagra had already failed — 342 of them. The result: significant improvement in erectile function scores using a completely different mechanism than PDE5 inhibitors.\n\nViagra fixes the plumbing. PT-141 lights the furnace. It activates MC4R receptors in the hypothalamus that govern sexual desire and arousal — working at the source of the problem, not downstream of it.',
    citation: 'Safarinejad MR, Hosseini SY. J Urol. 2008;179(3):1066–71.'
  },
  {
    compound: 'PT-141', emoji: '❤️', compoundId: 'pt141',
    categories: ['libido', 'menopause'],
    accent: '#e05a7a',
    headline: 'FDA-Approved for Women\'s Sexual Desire — Works for Both Sexes via the Same Brain Circuit',
    body: 'PT-141 was FDA-approved as Vyleesi (2019) for hypoactive sexual desire disorder (HSDD) in women — making it one of the only brain-based sexual treatments with regulatory approval. A 2016 randomized trial showed significant improvements in desire and arousal scores in women with HSDD.\n\nThe same hypothalamic MC4R circuits govern sexual motivation in men and women. PT-141 addresses the neurological root of low desire — not just the physical mechanics.',
    citation: 'Clayton AH et al. Womens Health. 2016;12(3):325–37.'
  },
  {
    compound: 'Kisspeptin', emoji: '⚡', compoundId: 'kisspeptin',
    categories: ['fertility', 'hormonal'],
    accent: '#7ac97a',
    headline: 'Kisspeptin Is Now a Diagnostic Biomarker for Male Infertility',
    body: 'A landmark 2025 study measured kisspeptin in both blood serum and seminal plasma of fertile and infertile men. Result: kisspeptin is measurably and consistently lower in men with abnormal sperm parameters.\n\nThis makes kisspeptin not just a therapeutic target — it is now proposed as a diagnostic marker for male infertility. Restoring kisspeptin pulsatility through research protocols may restore the entire HPG cascade without suppressing the body\'s own production.',
    citation: 'Parkpinyo N et al. J Assist Reprod Genet. 2025;42(11):3993–4002.'
  },
  {
    compound: 'Kisspeptin', emoji: '⚡', compoundId: 'kisspeptin',
    categories: ['menopause', 'hormonal'],
    headline: 'Hot Flashes Are Driven by Kisspeptin Neurons — Targeting Them May Reduce Symptoms at the Source',
    body: 'Researchers identified that the hypothalamic neurons responsible for hot flashes are the same kisspeptin/NKB neurons that regulate reproductive hormone cycles. During menopause, as estrogen declines, these neurons become hyperactive — producing the vasomotor surges experienced as hot flashes.\n\nThis means kisspeptin modulation addresses the mechanism of the most disruptive menopause symptom — not just managing it downstream with hormones.',
    accent: '#f472b6',
    citation: 'Rance NE et al. Front Neuroendocrinol. 2010;31(3):271–8.'
  },
  {
    compound: 'NAD+', emoji: '⚡', compoundId: 'nad',
    categories: ['fertility', 'longevity'],
    accent: '#f5c542',
    headline: 'NAD+ Reversed Reproductive Aging and Restored Fertility Markers in Aging Models',
    body: 'Harvard and Australian researchers found that NAD+ supplementation in aging female models reversed key markers of reproductive aging — including mitochondrial dysfunction in oocytes, reduced follicular quality, and ovarian reserve decline.\n\nEgg quality is mitochondria-dependent. Aging eggs fail because their mitochondria cannot generate enough energy for fertilization. NAD+ directly targets that mechanism.',
    citation: 'Bertoldo MJ et al. Cell Reports. 2020;30(6):1670–81.'
  },
  {
    compound: 'NAD+', emoji: '⚡', compoundId: 'nad',
    categories: ['longevity', 'cognitive'],
    accent: '#f5c542',
    headline: 'Restoring NAD+ Reversed Vascular Aging to Levels Indistinguishable From Young',
    body: "Harvard's David Sinclair found that restoring NAD+ levels in aged mice reversed vascular aging — the stiffening and dysfunction of blood vessels — to levels indistinguishable from young mice within weeks. Humans lose approximately 50% of their NAD+ between ages 40 and 60.\n\nEvery mitochondrion in your body uses NAD+ to generate ATP. The energy collapse, brain fog, and recovery decline that come with age are directly tied to this depletion.",
    citation: 'Das A et al. Cell. 2018;173(1):74–89.'
  },
  {
    compound: 'BPC-157', emoji: '🩹', compoundId: 'bpc157',
    categories: ['healing'],
    accent: '#5b9cf6',
    headline: 'BPC-157 Healed Severed Achilles Tendons Faster Than Surgery',
    body: 'In animal studies, BPC-157 healed completely severed Achilles tendons faster than surgical repair alone. The mechanism: BPC-157 simultaneously upregulates nitric oxide pathways AND growth hormone receptors in tendon fibroblasts — a dual signal that accelerates structural repair far beyond what the body does on its own.\n\nBPC-157 also reversed alcohol-induced stomach ulcers within 24 hours in the same research series — demonstrating a near-universal repair signal across tissue types.',
    citation: 'Sikiric P et al. Int J Mol Sci. 2018.'
  },
  {
    compound: 'TB-500', emoji: '💪', compoundId: 'tb500',
    categories: ['healing', 'cardiovascular'],
    accent: '#5b9cf6',
    headline: 'TB-500 Partially Restored Cardiac Function After Heart Attack in Animal Studies',
    body: 'TB-500 stimulates angiogenesis — new blood vessel growth — throughout the body, including cardiac tissue. Studies in heart attack animal models showed TB-500 reduced scar tissue formation in the heart and partially restored cardiac output in animals that had been in heart failure for extended periods.\n\nThis makes TB-500 the only repair peptide with published evidence of heart muscle regeneration — not just peripheral tissue healing.',
    citation: 'Goldstein AL et al. Trends Mol Med. 2012.'
  },
  {
    compound: 'GHK-Cu', emoji: '✨', compoundId: 'ghkcu',
    categories: ['healing', 'longevity'],
    accent: '#a78bfa',
    headline: 'GHK-Cu Activates 4,000+ Human Genes — Researchers Call It a "Master Reset Switch"',
    body: 'At age 60, your GHK-Cu levels are approximately 100 times lower than at age 20. This copper peptide activates over 4,000 human genes involved in tissue remodelling, collagen synthesis, wound repair, antioxidant defense, and anti-inflammatory signalling.\n\nPublished dermatology studies show GHK-Cu reduced fine wrinkles by 35% and increased skin thickness by 27%. But the visible skin benefit is just the surface of a much deeper systemic repair cascade.',
    citation: 'Pickart L, Margolina A. Int J Mol Sci. 2018;19(7):1987.'
  },
  {
    compound: 'GLP-1 Class', emoji: '💉', compoundId: 'reta',
    categories: ['cardiovascular', 'metabolic'],
    accent: '#f97316',
    headline: 'GLP-1 Receptor Agonists Cut Major Cardiovascular Events by 20% — In Non-Diabetic Patients',
    body: 'The SELECT trial (2023) enrolled 17,604 non-diabetic overweight/obese adults on semaglutide. Finding: GLP-1 receptor activation reduced major cardiovascular events (heart attack, stroke, cardiovascular death) by 20% — independent of weight loss.\n\nThe cardiovascular protection appears to be a direct GLP-1 receptor effect in the heart and vasculature. Retatrutide, as a triple agonist that includes the GLP-1 pathway, is expected to show similar (or stronger) cardioprotective signalling — putting this class of compound on track to become a cardiovascular intervention, not just a fat loss tool.',
    citation: 'Lincoff AM et al. N Engl J Med. 2023;389:2221–32.'
  },
  {
    compound: 'Retatrutide', emoji: '🔥', compoundId: 'reta',
    categories: ['fat-loss', 'metabolic'],
    accent: '#f97316',
    headline: 'Retatrutide Cleared 81% of Liver Fat — The Most Powerful Fat Clearance Ever Recorded',
    body: 'Phase 2 trials (Nature Medicine, 2024) showed retatrutide cleared 81% of liver fat at the 8mg dose over 24 weeks. Participants with metabolic fatty liver disease essentially had the condition reversed — no other compound approaches this magnitude.\n\nIn the same trial, subjects lost 24.2% of body weight over 48 weeks, surpassing semaglutide (~15%). The triple receptor mechanism (GLP-1 + GIP + glucagon) creates three simultaneous fat loss signals no single-receptor compound can replicate.',
    citation: 'Sanyal AJ et al. Nat Med. 2024 Jul;30(7):2037–48.'
  },
  {
    compound: 'Semax', emoji: '🧠', compoundId: 'semax',
    categories: ['cognitive'],
    accent: '#818cf8',
    headline: 'Semax Elevates BDNF Within Hours — What Antidepressants Take Weeks to Achieve',
    body: 'BDNF (brain-derived neurotrophic factor) is the protein responsible for neuroplasticity — forming new connections, consolidating memory, and cognitive adaptation. Antidepressants raise BDNF as a secondary effect, taking 2–4 weeks of daily dosing to produce measurable increases.\n\nSemax elevates BDNF within hours of a single dose. It has been used as a prescription drug in Russia and Ukraine for 30+ years for stroke rehabilitation — making it one of the most clinically validated nootropic peptides in existence.',
    citation: 'Dolotov OV et al. Brain Res Bull. 2006;69(6):652–8.'
  },
  {
    compound: 'Selank', emoji: '🧘', compoundId: 'selank',
    categories: ['cognitive'],
    accent: '#818cf8',
    headline: 'Selank Matched Benzodiazepines for Anxiety Relief — With Zero Dependency or Withdrawal',
    body: 'A Russian double-blind clinical trial directly compared Selank to benzodiazepines in patients with generalized anxiety disorder. Selank matched their effectiveness for anxiety reduction — with zero dependency, zero tolerance, zero withdrawal on discontinuation.\n\nSelank works through the enkephalin system without triggering addiction pathways. No tapering required. No cognitive blunting. Registered as a prescription drug in Russia and Ukraine.',
    citation: 'Zozulia AA et al. Bull Exp Biol Med. 2001.'
  },
  {
    compound: 'Epithalon', emoji: '🧬', compoundId: 'epithalon',
    categories: ['longevity'],
    accent: '#a78bfa',
    headline: 'Epithalon Is the Only Peptide Shown to Directly Activate Telomerase in Human Cells',
    body: 'Telomerase maintains telomere length — the protective caps on chromosomes that shorten with every cell division. Most anti-aging interventions work around telomeres. Epithalon works on them directly.\n\nDeveloped by Russian researcher Vladimir Khavinson over 35+ years of research, Epithalon was shown to activate telomerase in human somatic cells in published research. A single 10-day cycle triggers activation that outlasts the dosing period by months.',
    citation: 'Khavinson VKh et al. Bull Exp Biol Med. 2004;138(6):590–2.'
  },
  {
    compound: 'MOTS-c', emoji: '⚡', compoundId: 'motsc',
    categories: ['mitochondria', 'metabolic'],
    accent: '#f59e0b',
    headline: 'MOTS-c Is Encoded in Mitochondrial DNA — One of the First Peptides Found Inside the Powerplant',
    body: 'Almost every peptide in the human body is encoded in nuclear DNA. MOTS-c is different — it is encoded directly in mitochondrial DNA, making it a mitochondria-derived peptide (MDP) and one of the first of its kind ever discovered.\n\nMOTS-c activates AMPK (the master cellular energy sensor) and reversed obesity-related insulin resistance in animal models without dietary changes. It is being studied as a treatment for type 2 diabetes and metabolic syndrome.',
    citation: 'Lee C et al. Cell Metab. 2015;21(3):443–54.'
  },
  {
    compound: 'SS-31', emoji: '🔋', compoundId: 'ss31',
    categories: ['cardiovascular', 'mitochondria'],
    accent: '#60a5fa',
    headline: 'SS-31 Restored Heart Function in Chronic Heart Failure Models',
    body: 'SS-31 targets cardiolipin — the structural lipid on the inner mitochondrial membrane that degrades under oxidative stress. When cardiolipin collapses, mitochondria lose efficiency and cardiac energy production falls.\n\nAnimal studies showed SS-31 restored mitochondrial membrane integrity in heart cells, reduced cardiac scar tissue, and improved contractile function in animals in heart failure for months. Currently in human clinical trials for heart failure and kidney disease.',
    citation: 'Szeto HH. FASEB J. 2008;22(6):1843–53.'
  },
  {
    compound: 'Thymosin Alpha-1', emoji: '🛡️', compoundId: 'ta1',
    categories: ['immune'],
    accent: '#34d399',
    headline: 'Thymosin Alpha-1 Is an Approved Drug in 35+ Countries — Used in Cancer Immunotherapy and Viral Infections',
    body: 'Thymosin Alpha-1 (sold as Zadaxin) is approved as a prescription pharmaceutical in over 35 countries for hepatitis B, hepatitis C, and as a cancer immunotherapy adjuvant — giving it more published human clinical trial data than almost any research peptide available today.\n\nIt directly activates T-cells and NK cells, with studies showing T-cell count and activity improvements comparable to some pharmaceutical immunotherapy agents — without their side effects.',
    citation: 'Goldstein AL, Goldstein AL. Expert Opin Biol Ther. 2009;9(5):593–608.'
  },
  {
    compound: 'DSIP', emoji: '🌙', compoundId: 'dsip',
    categories: ['sleep'],
    accent: '#6366f1',
    headline: 'DSIP Was Isolated From Sleeping Rabbit Brains — It Specifically Triggers the Deep Repair Stage of Sleep',
    body: 'Delta Sleep-Inducing Peptide was first isolated from rabbit brain tissue in 1977 during sleep research — a factor in sleeping animals that could induce delta (slow-wave) sleep in awake ones. This is the deepest sleep stage, where GH is secreted, memories consolidate, and cellular repair peaks.\n\nDSIP does not sedate — it shifts sleep architecture toward more time in the stages that actually restore you. No dependency, no next-day grogginess.',
    citation: 'Schoenenberger GA, Monnier M. PNAS. 1977.'
  },
  {
    compound: 'GHRP-6', emoji: '💪', compoundId: 'ghrp6',
    categories: ['healing'],
    accent: '#5b9cf6',
    headline: 'GHRP-6 Was Turned Into a Kidney-Repair Hydrogel in a 2025 Acute Kidney Injury Study',
    body: 'A 2025 Journal of Nanobiotechnology paper used GHRP-6 inside a hydrogel platform for acute kidney injury and reported therapeutic benefit through metabolic regulation. That matters because GHRP-6 is usually framed only as a GH secretagogue or appetite peptide — this study pushes it into organ-repair territory.\n\nIf follow-up work translates, GHRP-6 may have a much broader regenerative profile than its bodybuilding reputation suggests. For the app, this is a meaningful expansion of the compound\'s research story beyond GH pulses and hunger signaling.',
    citation: 'Zhao X et al. Journal of Nanobiotechnology. 2025. https://pubmed.ncbi.nlm.nih.gov/41327290/'
  },
  {
    compound: 'Humanin', emoji: '✨', compoundId: 'humanin',
    categories: ['fertility', 'longevity'],
    accent: '#a78bfa',
    headline: 'Humanin Protected Ovarian Function After Chemotherapy in a 2025 Fertility Study',
    body: 'A 2025 Molecular Human Reproduction study found S14G-Humanin improved ovarian function in a cyclophosphamide-induced premature ovarian insufficiency mouse model. That is exactly the kind of eyebrow-raising signal patients search for: can a mitochondrial peptide protect fertility when the ovaries are under severe toxic stress?\n\nThe implication is bigger than one infertility model. Humanin is increasingly looking like a systemic cell-survival peptide with reproductive applications — linking mitochondrial resilience, anti-apoptotic signaling, and fertility preservation in the same research line.',
    citation: 'Huang J et al. Molecular Human Reproduction. 2025. https://pubmed.ncbi.nlm.nih.gov/40811024/'
  },
];
// Note: Oxytocin highlight removed — no corresponding compound in the catalog.
// Re-add the highlight entry once 'oxytocin' is added to src/data/compounds.js.

export default function Highlights() {
  const [activeCategory, setActiveCategory] = useState('all');
  const navigate = useNavigate();

  const filtered = activeCategory === 'all'
    ? HIGHLIGHTS
    : HIGHLIGHTS.filter(h => h.categories.includes(activeCategory));

  const goToCompound = (id) => {
    navigate(`/compounds?id=${id}`);
  };

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '48px 20px' }}>
      {/* Header */}
      <div style={{ marginBottom: '40px' }}>
        <div className="section-eyebrow" style={{ marginBottom: '10px' }}>Research Highlights</div>
        <h1 style={{ fontSize: 'clamp(1.8rem, 4vw, 2.8rem)', fontWeight: 900, margin: '0 0 12px', color: '#fff', letterSpacing: '-0.02em' }}>
          ✨ What the Research Shows
        </h1>
        <p style={{ margin: 0, fontSize: '1rem', color: '#64748b', lineHeight: 1.6, maxWidth: '600px' }}>
          The most remarkable findings in peptide research — organized by what matters to you. Tap any card to explore the compound.
        </p>
      </div>

      {/* Category pills */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '36px' }}>
        {CATEGORIES.map(cat => (
          <button
            key={cat.id}
            onClick={() => setActiveCategory(cat.id)}
            style={{
              padding: '7px 16px',
              borderRadius: '20px',
              border: '1px solid',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.2s',
              whiteSpace: 'nowrap',
              borderColor: activeCategory === cat.id ? '#d4af37' : 'rgba(255,255,255,0.1)',
              background: activeCategory === cat.id ? '#d4af37' : 'rgba(255,255,255,0.04)',
              color: activeCategory === cat.id ? '#0a1628' : '#94a3b8',
            }}
          >
            {cat.emoji} {cat.label}
          </button>
        ))}
      </div>

      {/* Cards grid — sorted alphabetically by compound name */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '20px' }}>
        {filtered.length === 0 ? (
          <div style={{ gridColumn: '1/-1', textAlign: 'center', color: '#475569', padding: '60px 0' }}>
            No highlights in this category yet. More coming soon.
          </div>
        ) : [...filtered].sort((a, b) => a.compound.localeCompare(b.compound)).map((h, i) => (
          <div
            key={i}
            onClick={() => goToCompound(h.compoundId)}
            style={{
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: '14px',
              padding: '22px',
              cursor: 'pointer',
              transition: 'all 0.2s',
              position: 'relative',
              overflow: 'hidden',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = h.accent || '#d4af37';
              e.currentTarget.style.transform = 'translateY(-2px)';
              e.currentTarget.style.boxShadow = `0 8px 28px rgba(0,0,0,0.4)`;
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)';
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = 'none';
            }}
          >
            {/* Accent bar */}
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '3px', background: h.accent || '#d4af37', borderRadius: '14px 14px 0 0' }} />

            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
              <span style={{ fontSize: '22px' }}>{h.emoji}</span>
              <span style={{ fontSize: '12px', fontWeight: 800, color: h.accent || '#d4af37', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h.compound}</span>
              <span style={{ marginLeft: 'auto', fontSize: '11px', background: 'rgba(255,255,255,0.06)', padding: '3px 8px', borderRadius: '10px', color: '#64748b' }}>
                {CATEGORIES.find(c => c.id === h.categories[0])?.emoji} {CATEGORIES.find(c => c.id === h.categories[0])?.label}
              </span>
            </div>

            {/* Headline */}
            <div style={{ fontSize: '15px', fontWeight: 800, color: '#f1f5f9', lineHeight: 1.4, marginBottom: '12px' }}>
              {h.headline}
            </div>

            {/* Body */}
            <div style={{ fontSize: '13px', color: '#94a3b8', lineHeight: 1.65, marginBottom: '12px' }}>
              {h.body.split('\n\n').map((p, j) => (
                <p key={j} style={{ margin: j > 0 ? '8px 0 0' : '0' }}>{p}</p>
              ))}
            </div>

            {/* Citation */}
            {h.citation && (
              <div style={{ fontSize: '11px', color: '#475569', fontStyle: 'italic', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '10px', marginTop: '8px' }}>
                📄 {h.citation}
              </div>
            )}

            {/* CTA */}
            <div style={{ fontSize: '12px', fontWeight: 700, color: h.accent || '#d4af37', marginTop: '10px' }}>
              Explore {h.compound} →
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: '48px', padding: '20px', background: 'rgba(255,255,255,0.02)', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.06)', textAlign: 'center' }}>
        <p style={{ margin: 0, fontSize: '0.8rem', color: '#475569', lineHeight: 1.6 }}>
          ⚠️ For educational and research purposes only. Not medical advice. Citations are from published research — results vary. Consult a qualified healthcare professional before beginning any protocol.
        </p>
      </div>
    </div>
  );
}
