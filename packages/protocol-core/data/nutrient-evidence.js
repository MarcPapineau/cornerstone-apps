/**
 * nutrient-evidence.js — the naturopathy / nutrition source-of-truth for the
 * deficiency → "request for your naturopath" engine.
 *
 * ── Why this file exists ──────────────────────────────────────────────────────
 * The directive: a client drags in their lab report; the system reads it and, for
 * out-of-range vitamins/minerals, produces a SLIP they take to their naturopath
 * (Dr. Vincent Lun) — "ask about these, and ask what this misses." It is NOT a
 * prescription and NOT a diagnosis. The recommendations must be grounded in real
 * clinical/nutrition science — "not just the peptide but also for naturopathy."
 *
 * This is the nutrition counterpart to evidence.json (peptides). Each entry is keyed
 * by the lab MARKER it responds to, carries REAL citations (NIH Office of Dietary
 * Supplements Health-Professional fact sheets + Health Canada DRIs — authoritative,
 * stable, verifiable), and an attributed community/naturopathic-practice profile that
 * rides the SAME two-source rails as the peptide community layer (presentation.js).
 *
 * ── The honesty rules (identical to community.js / evidence.json) ─────────────
 *   • No fabricated statistics. `summary` is qualitative standard-of-practice, never an
 *     invented number. Numbers, if ever shown, come only from a real citation title.
 *   • `community.pattern` (the naturopathic "how" — form/dose feel) is PRACTITIONER-ONLY,
 *     dropped from the client view exactly like the peptide administration pattern.
 *   • Electrolytes (sodium / potassium / phosphorus) are `supplementSafe:false` — an
 *     out-of-range electrolyte routes to PROVIDER REVIEW ONLY. We never suggest an OTC
 *     supplement for them: those abnormalities can be medically significant. Honest +
 *     safe beats helpful-but-reckless.
 *   • A flagged marker with no entry here degrades to "review with your provider" — the
 *     engine never invents a nutrient.
 *
 * `actOn` is the flag DIRECTION that is actionable for this nutrient:
 *   'LOW'  → OUT_OF_RANGE_LOW is the deficiency signal (most micronutrients)
 *   'HIGH' → OUT_OF_RANGE_HIGH is the actionable signal (e.g. hs-CRP → omega-3 discussion)
 *
 * NOT medical advice. NOT a prescription. NOT legal advice.
 */

const ODS = 'NIH Office of Dietary Supplements';

// Small constructor so every entry is shaped identically and missing fields default safely.
const N = (o) => ({
  nutrientId: o.nutrientId,
  name: o.name,
  // The repletion FORM commonly discussed (client-safe to name; dose stays with the naturopath).
  form: o.form || null,
  unit: o.unit || null,                       // a typical lab unit, informational only
  actOn: o.actOn || 'LOW',                    // 'LOW' | 'HIGH'
  supplementSafe: o.supplementSafe !== false, // false → provider-review only, never an OTC suggestion
  // Marker-name matchers (normalized, case-insensitive). The first map entry whose
  // synonym matches the report's marker text wins.
  markerSynonyms: o.markerSynonyms || [],
  // Synthetic evidence record — SAME shape presentation/research read (real citations only).
  evidenceRec: {
    name: o.name,
    evidenceLevel: o.evidenceLevel || 'GUIDELINE',
    hasClinicalTrial: !!o.hasClinicalTrial,
    clinicalTrialStatus: o.hasClinicalTrial ? 'TRIAL_CITED' : 'NO_TRIAL_CITED',
    mechanism: o.mechanism || null,
    summary: o.summary || null,               // qualitative standard-of-practice, never a fabricated stat
    citationCount: (o.citations || []).length,
    citations: o.citations || [],
  },
  // Attributed naturopathic-practice profile (mirrors community.js C()).
  community: {
    basis: o.basis || 'STUDY',                // STUDY | COMMUNITY | EMERGING
    usedFor: o.usedFor || [],
    pattern: o.pattern || null,               // PRACTITIONER-ONLY "how"
    reportedBenefits: o.reportedBenefits || [],
    evidenceNote: o.evidenceNote || null,
  },
  // Food-first sources — client-safe, encourages diet before supplements.
  foodFirst: o.foodFirst || [],
  // The exact thing to ask the naturopath. Never an instruction to the client.
  naturopathAsk: o.naturopathAsk,
});

// ===========================================================================
// MICRONUTRIENTS — out-of-range LOW is the deficiency signal (supplementSafe)
// ===========================================================================
const NUTRIENTS = [
  N({
    nutrientId: 'vitamin_d',
    name: 'Vitamin D',
    form: 'Vitamin D3 (cholecalciferol)',
    unit: 'nmol/L',
    actOn: 'LOW',
    markerSynonyms: ['vitamin d', 'vit d', '25-oh', '25 oh', '25-hydroxy', '25 hydroxy', 'calcidiol', 'vitamin d3', 'vitamin d2'],
    evidenceLevel: 'GUIDELINE',
    hasClinicalTrial: true,
    mechanism: 'Fat-soluble secosteroid; regulates calcium/phosphate homeostasis and bone mineralization, with broad roles in immune and muscle function.',
    summary: 'When serum 25-hydroxyvitamin D sits below the report range, repletion with vitamin D3 to restore sufficiency is standard, dose individualized to the deficit and re-tested.',
    citations: [
      { title: 'Vitamin D — Fact Sheet for Health Professionals', source: ODS, url: 'https://ods.od.nih.gov/factsheets/VitaminD-HealthProfessional/', type: 'Other' },
      { title: 'Dietary Reference Intakes — Vitamin D and Calcium', source: 'Health Canada', url: 'https://www.canada.ca/en/health-canada/services/food-nutrition/healthy-eating/vitamins-minerals/vitamin-calcium-updated-dietary-reference-intakes-nutrition.html', type: 'Other' },
    ],
    basis: 'STUDY',
    usedFor: ['Restoring serum vitamin D to the sufficiency range', 'Bone, immune and muscle support'],
    pattern: 'Naturopathic practice: D3 (often paired with vitamin K2 and adequate magnesium for utilization); dose titrated to the size of the deficit and the season, then re-checked at ~8–12 weeks.',
    reportedBenefits: ['Reported energy, mood and immune support once repleted', 'Supports calcium handling alongside bone work'],
    evidenceNote: 'Deficiency and repletion are well characterized in clinical guidelines (NIH ODS, Health Canada DRIs). The benefit of correcting a true deficiency is established; mega-dosing a normal level is not.',
    foodFirst: ['Fatty fish (salmon, sardines, mackerel)', 'Egg yolks', 'Fortified milk / plant milks', 'Sunlight exposure (seasonal)'],
    naturopathAsk: 'Ask Dr. Vincent Lun whether your 25-OH vitamin D warrants D3 repletion, at what dose, whether to pair K2/magnesium, and when to re-test.',
  }),
  N({
    nutrientId: 'vitamin_b12',
    name: 'Vitamin B12',
    form: 'Vitamin B12 (methylcobalamin or cyanocobalamin)',
    unit: 'pmol/L',
    actOn: 'LOW',
    markerSynonyms: ['vitamin b12', 'b12', 'cobalamin', 'b-12'],
    evidenceLevel: 'GUIDELINE',
    hasClinicalTrial: true,
    mechanism: 'Cofactor for methionine synthase and methylmalonyl-CoA mutase; essential for red-cell formation, neurological function and DNA synthesis.',
    summary: 'A low serum B12 is repleted orally or, where absorption is impaired, by injection; the cause of the low level (intake vs absorption) is itself worth a provider review.',
    citations: [
      { title: 'Vitamin B12 — Fact Sheet for Health Professionals', source: ODS, url: 'https://ods.od.nih.gov/factsheets/VitaminB12-HealthProfessional/', type: 'Other' },
    ],
    basis: 'STUDY',
    usedFor: ['Correcting low B12', 'Energy, nerve and red-cell support'],
    pattern: 'Naturopathic practice: oral methyl-B12 for dietary shortfall; intramuscular B12 when absorption (e.g. low intrinsic factor, metformin, PPI use) is suspected. Often assessed with folate and homocysteine together.',
    reportedBenefits: ['Reported improvement in energy and cognitive clarity once repleted', 'Supports healthy red-cell formation'],
    evidenceNote: 'B12 deficiency, its neurological consequences, and repletion are well established (NIH ODS). The actionable point is finding WHY it is low — that is a clinical question for the naturopath/GP.',
    foodFirst: ['Meat, poultry, fish', 'Eggs and dairy', 'Fortified nutritional yeast / cereals (esp. for plant-based diets)'],
    naturopathAsk: 'Ask Dr. Vincent Lun whether your B12 should be repleted orally or by injection, and whether the low level points to an absorption issue worth investigating.',
  }),
  N({
    nutrientId: 'folate',
    name: 'Folate',
    form: 'Folate (5-MTHF / folic acid)',
    unit: 'nmol/L',
    actOn: 'LOW',
    markerSynonyms: ['folate', 'folic acid', 'rbc folate', 'serum folate', 'vitamin b9', 'b9'],
    evidenceLevel: 'GUIDELINE',
    hasClinicalTrial: true,
    mechanism: 'One-carbon donor for nucleotide synthesis and homocysteine remethylation; required for red-cell production and (preconception) neural-tube development.',
    summary: 'Low folate is repleted with dietary folate or a folate supplement, evaluated together with B12 so a B12 deficiency is not masked.',
    citations: [
      { title: 'Folate — Fact Sheet for Health Professionals', source: ODS, url: 'https://ods.od.nih.gov/factsheets/Folate-HealthProfessional/', type: 'Other' },
    ],
    basis: 'STUDY',
    usedFor: ['Correcting low folate', 'Red-cell and methylation support'],
    pattern: 'Naturopathic practice: folate (often as 5-MTHF) assessed alongside B12 and homocysteine; B12 status is confirmed first so repletion does not mask it.',
    reportedBenefits: ['Supports healthy red-cell formation', 'Part of healthy homocysteine handling with B12 and B6'],
    evidenceNote: 'Folate deficiency and repletion are well established (NIH ODS). Folate and B12 are evaluated together by convention — a key reason to involve the naturopath rather than supplement blindly.',
    foodFirst: ['Leafy greens (spinach, romaine)', 'Legumes (lentils, chickpeas)', 'Asparagus, broccoli', 'Fortified grains'],
    naturopathAsk: 'Ask Dr. Vincent Lun about folate repletion and to confirm your B12 status at the same time, so one is not hiding the other.',
  }),
  N({
    nutrientId: 'iron',
    name: 'Iron (ferritin / iron stores)',
    form: 'Iron (e.g. ferrous bisglycinate)',
    unit: 'µg/L',
    actOn: 'LOW',
    markerSynonyms: ['ferritin', 'iron', 'tibc', 'iron / tibc', 'iron tibc', 'transferrin saturation', 'serum iron'],
    evidenceLevel: 'GUIDELINE',
    hasClinicalTrial: true,
    mechanism: 'Essential for hemoglobin and oxygen transport, plus mitochondrial and enzymatic function; ferritin reflects body iron stores.',
    summary: 'Low ferritin/iron stores are repleted with oral iron and dietary iron; because iron overload is also harmful, dosing and re-testing belong with a provider, and the underlying cause of loss matters.',
    citations: [
      { title: 'Iron — Fact Sheet for Health Professionals', source: ODS, url: 'https://ods.od.nih.gov/factsheets/Iron-HealthProfessional/', type: 'Other' },
      // PEER-REVIEWED primary efficacy citations (verified PubMed/DOI 2026-06-04). Journal RCT + journal
      // systematic-review-of-RCTs, indexed in PubMed. NOT government references. Linked by DOI (doi.org).
      {
        title: 'Effect of iron supplementation on fatigue in nonanemic menstruating women with low ferritin: a randomized controlled trial',
        source: 'CMAJ', url: 'https://doi.org/10.1503/cmaj.110950',
        type: 'RandomizedControlledTrial', peerReviewed: true, evidenceTier: 'T1', year: 2012, pmid: '22777991',
        appliesTo: 'iron / ferritin → fatigue / energy',
        claimSupported: 'Associated with reduced fatigue in an RCT: in non-anemic menstruating women with low ferritin, 12 weeks of oral iron reduced subjective fatigue vs placebo (benefit concentrated in those with ferritin ≤ 50 µg/L).',
        limitations: 'Single population (non-anemic menstruating women with low ferritin); subjective fatigue endpoint; iron overload is harmful, so dose, suitability and the cause of low iron require practitioner review.',
      },
      {
        title: 'Efficacy of iron supplementation on fatigue and physical capacity in non-anaemic iron-deficient adults: a systematic review of randomised controlled trials',
        source: 'BMJ Open', url: 'https://doi.org/10.1136/bmjopen-2017-019240',
        type: 'MetaAnalysis', peerReviewed: true, evidenceTier: 'T1', year: 2018, pmid: '29626044',
        appliesTo: 'iron / ferritin → fatigue / energy',
        claimSupported: 'Studied for fatigue: a systematic review/meta-analysis of RCTs found iron supplementation reduced subjective fatigue in non-anaemic iron-deficient adults (no consistent objective physical-capacity gain).',
        limitations: 'Subjective fatigue benefit only; objective physical-capacity effect not established; final dose / suitability / cause-of-deficiency require practitioner review.',
      },
    ],
    basis: 'STUDY',
    usedFor: ['Restoring low iron stores', 'Energy and oxygen-carrying support'],
    pattern: 'Naturopathic practice: oral iron (gentler forms such as bisglycinate) taken with vitamin C, away from calcium/coffee; ferritin re-checked after a course. Persistently low stores prompt a search for the cause of loss.',
    reportedBenefits: ['Reported energy and exercise-tolerance improvement once stores are restored', 'Supports healthy hemoglobin'],
    evidenceNote: 'Iron-deficiency repletion is well established (NIH ODS). Iron is double-edged — too much is harmful — so this is a "discuss the dose AND the cause" item, not a self-serve one.',
    foodFirst: ['Red meat, poultry, fish (heme iron)', 'Lentils, beans, tofu (non-heme)', 'Pair plant iron with vitamin C (citrus, peppers)'],
    naturopathAsk: 'Ask Dr. Vincent Lun whether your ferritin/iron warrants oral iron, at what dose, how to take it for absorption, and whether the low level needs its cause investigated.',
  }),
  N({
    nutrientId: 'magnesium',
    name: 'Magnesium',
    form: 'Magnesium (e.g. glycinate or citrate)',
    unit: 'mmol/L',
    actOn: 'LOW',
    markerSynonyms: ['magnesium', 'mg', 'serum magnesium'],
    evidenceLevel: 'GUIDELINE',
    hasClinicalTrial: true,
    mechanism: 'Cofactor for 300+ enzymes including ATP handling, neuromuscular signaling and vitamin D activation.',
    summary: 'Low magnesium is repleted with dietary magnesium and well-absorbed supplemental forms; serum magnesium underestimates total-body status, which is part of why a provider should interpret it.',
    citations: [
      { title: 'Magnesium — Fact Sheet for Health Professionals', source: ODS, url: 'https://ods.od.nih.gov/factsheets/Magnesium-HealthProfessional/', type: 'Other' },
      // PEER-REVIEWED primary efficacy citation (verified PubMed/DOI 2026-06-04). NOT a government
      // reference: a journal meta-analysis indexed in PubMed. Linked by DOI (doi.org) — never the
      // pubmed.ncbi.nlm.nih.gov host, which the Source Doctrine classifies as government.
      {
        title: 'Oral magnesium supplementation for insomnia in older adults: a Systematic Review & Meta-Analysis',
        source: 'BMC Complement Med Ther', url: 'https://doi.org/10.1186/s12906-021-03297-z',
        type: 'MetaAnalysis', peerReviewed: true, evidenceTier: 'T1', year: 2021, pmid: '33865376',
        appliesTo: 'magnesium → sleep quality / insomnia',
        claimSupported: 'Studied for sleep quality: a meta-analysis of randomized controlled trials found oral magnesium reduced sleep-onset latency vs placebo in older adults with insomnia (effect on total sleep time not significant; authors rate evidence low-to-very-low quality).',
        limitations: 'Three small RCTs, moderate-to-high risk of bias, low/very-low GRADE certainty; population is older adults with insomnia. Suggestive, not definitive — final dose / form / suitability require practitioner review.',
      },
    ],
    basis: 'STUDY',
    usedFor: ['Correcting low magnesium', 'Sleep, muscle and metabolic support'],
    pattern: 'Naturopathic practice: glycinate for calm/sleep, citrate for bowel-tolerance; supports vitamin D utilization, so often discussed together with D repletion.',
    reportedBenefits: ['Reported sleep, cramp and stress-tolerance support', 'Supports vitamin D activation and metabolic function'],
    evidenceNote: 'Magnesium’s roles and the value of correcting a deficiency are well established (NIH ODS). Serum magnesium is an imperfect window on stores — interpretation belongs with the naturopath.',
    foodFirst: ['Pumpkin seeds, almonds, cashews', 'Leafy greens', 'Legumes and whole grains', 'Dark chocolate'],
    naturopathAsk: 'Ask Dr. Vincent Lun whether your magnesium warrants repletion, which form fits your goals (sleep vs bowel tolerance), and whether to pair it with your vitamin D.',
  }),
  N({
    nutrientId: 'calcium',
    name: 'Calcium',
    form: 'Calcium (diet-first; supplement if needed)',
    unit: 'mmol/L',
    actOn: 'LOW',
    markerSynonyms: ['calcium', 'calcium (serum)', 'serum calcium', 'ca'],
    evidenceLevel: 'GUIDELINE',
    hasClinicalTrial: true,
    mechanism: 'Principal mineral of bone; also essential for muscle contraction, nerve signaling and clotting. Serum calcium is tightly regulated.',
    summary: 'A low serum calcium is interpreted with albumin, vitamin D and PTH before any supplement — because serum calcium is tightly regulated, an out-of-range value is itself a reason to involve a provider, not to self-supplement.',
    citations: [
      { title: 'Calcium — Fact Sheet for Health Professionals', source: ODS, url: 'https://ods.od.nih.gov/factsheets/Calcium-HealthProfessional/', type: 'Other' },
    ],
    basis: 'STUDY',
    usedFor: ['Bone-health context', 'Interpreting calcium alongside vitamin D'],
    pattern: 'Naturopathic practice: diet-first calcium with adequate vitamin D and magnesium for utilization; serum calcium read together with albumin and PTH before supplementing.',
    reportedBenefits: ['Supports bone health alongside vitamin D and weight-bearing activity'],
    evidenceNote: 'Calcium intake guidance is well established (NIH ODS, Health Canada). A serum calcium abnormality is a clinical-interpretation item (albumin/PTH/vitamin D), which is exactly why it goes to the naturopath.',
    foodFirst: ['Dairy (yogurt, cheese, milk)', 'Fortified plant milks', 'Tofu set with calcium', 'Leafy greens, almonds'],
    naturopathAsk: 'Ask Dr. Vincent Lun to interpret your calcium alongside albumin, vitamin D and (if needed) PTH, and whether diet or a supplement is appropriate.',
  }),
  N({
    nutrientId: 'zinc',
    name: 'Zinc',
    form: 'Zinc (e.g. picolinate; balance with copper)',
    unit: 'µmol/L',
    actOn: 'LOW',
    markerSynonyms: ['zinc', 'zn', 'zinc / copper', 'zinc copper'],
    evidenceLevel: 'GUIDELINE',
    hasClinicalTrial: true,
    mechanism: 'Cofactor for hundreds of enzymes and transcription factors; central to immune function, wound healing and hormone metabolism.',
    summary: 'Low zinc is repleted with dietary zinc and short supplemental courses, balanced against copper — prolonged zinc supplementation can induce copper deficiency, so the zinc:copper balance is monitored.',
    citations: [
      { title: 'Zinc — Fact Sheet for Health Professionals', source: ODS, url: 'https://ods.od.nih.gov/factsheets/Zinc-HealthProfessional/', type: 'Other' },
    ],
    basis: 'STUDY',
    usedFor: ['Correcting low zinc', 'Immune, wound-healing and hormone support'],
    pattern: 'Naturopathic practice: zinc taken with food, in time-limited courses, with copper watched on longer runs (the Zn:Cu ratio). Relevant alongside copper-peptide / GHK-Cu work.',
    reportedBenefits: ['Reported immune and wound-healing support once repleted', 'Supports healthy testosterone and skin'],
    evidenceNote: 'Zinc’s roles and deficiency repletion are well established (NIH ODS). The copper-balance caveat is real — a reason to course it under the naturopath rather than take it open-endedly.',
    foodFirst: ['Oysters, shellfish, red meat', 'Pumpkin seeds, hemp seeds', 'Legumes and whole grains', 'Cashews'],
    naturopathAsk: 'Ask Dr. Vincent Lun whether your zinc warrants a repletion course, how long to run it, and how to keep copper in balance.',
  }),
  N({
    nutrientId: 'omega3',
    name: 'Omega-3 (EPA/DHA)',
    form: 'Omega-3 (EPA/DHA fish or algal oil)',
    unit: 'mg/L',
    actOn: 'HIGH',                         // elevated hs-CRP is the actionable signal here
    markerSynonyms: ['hs-crp', 'hscrp', 'crp', 'c-reactive', 'c reactive'],
    evidenceLevel: 'SUPPORTIVE',
    hasClinicalTrial: false,
    mechanism: 'EPA/DHA are precursors to specialized pro-resolving mediators; dietary omega-3 is commonly discussed in the context of inflammatory tone, though hs-CRP has many drivers.',
    summary: 'An elevated hs-CRP is a non-specific inflammation signal with many possible causes; omega-3 sufficiency and an anti-inflammatory dietary pattern are commonly discussed, but the elevation itself warrants a provider looking for its cause.',
    citations: [
      { title: 'Omega-3 Fatty Acids — Fact Sheet for Health Professionals', source: ODS, url: 'https://ods.od.nih.gov/factsheets/Omega3FattyAcids-HealthProfessional/', type: 'Other' },
    ],
    basis: 'COMMUNITY',
    usedFor: ['Dietary anti-inflammatory context', 'Omega-3 sufficiency'],
    pattern: 'Naturopathic practice: emphasize omega-3 intake (fish/algal oil) and an anti-inflammatory dietary pattern; an elevated hs-CRP is investigated for its cause rather than simply supplemented over.',
    reportedBenefits: ['Reported as part of an anti-inflammatory dietary pattern', 'Cardiometabolic context'],
    evidenceNote: 'hs-CRP is non-specific — infection, injury, training load and metabolic factors all raise it. Omega-3 is a reasonable dietary discussion, NOT a fix for an unexplained elevation. This one leans on provider review.',
    foodFirst: ['Fatty fish 2–3×/week (salmon, sardines, mackerel)', 'Walnuts, chia, flax (ALA)', 'Algal oil (plant-based EPA/DHA)'],
    naturopathAsk: 'Ask Dr. Vincent Lun what is driving your elevated hs-CRP and whether omega-3 intake or other anti-inflammatory steps fit your situation.',
  }),
];

// ===========================================================================
// ELECTROLYTES — provider-review ONLY. An out-of-range value (either direction)
// can be medically significant; we NEVER suggest an OTC supplement for these.
// ===========================================================================
const ELECTROLYTES = [
  N({
    nutrientId: 'potassium',
    name: 'Potassium',
    actOn: 'BOTH',
    supplementSafe: false,
    markerSynonyms: ['potassium', 'k+', 'serum potassium'],
    evidenceLevel: 'GUIDELINE',
    summary: 'An out-of-range potassium is a provider-review item. Vitalis does not suggest potassium supplementation — abnormal potassium can be clinically significant and is interpreted and managed by a provider.',
    citations: [
      { title: 'Potassium — Fact Sheet for Health Professionals', source: ODS, url: 'https://ods.od.nih.gov/factsheets/Potassium-HealthProfessional/', type: 'Other' },
    ],
    basis: 'STUDY',
    usedFor: ['Provider-reviewed electrolyte interpretation'],
    evidenceNote: 'Electrolyte abnormalities can be medically significant. This is deliberately a "take it to your provider" item, never a supplement suggestion.',
    foodFirst: ['Potassium-rich foods (bananas, potatoes, beans) are diet-context only — do not adjust intake around an abnormal lab without your provider.'],
    naturopathAsk: 'Ask Dr. Vincent Lun (or your ordering provider) to interpret your potassium — this is not something to self-supplement.',
  }),
  N({
    nutrientId: 'sodium',
    name: 'Sodium',
    actOn: 'BOTH',
    supplementSafe: false,
    markerSynonyms: ['sodium', 'na+', 'serum sodium'],
    evidenceLevel: 'GUIDELINE',
    summary: 'An out-of-range sodium is a provider-review item — it reflects fluid balance and other factors, and is interpreted by a provider, not corrected with a supplement.',
    citations: [
      { title: 'Sodium in Diet', source: 'MedlinePlus (U.S. National Library of Medicine)', url: 'https://medlineplus.gov/ency/article/002415.htm', type: 'Other' },
    ],
    basis: 'STUDY',
    usedFor: ['Provider-reviewed electrolyte interpretation'],
    evidenceNote: 'Sodium reflects fluid/water balance as much as intake. Out-of-range sodium is a clinical-interpretation item, never a supplement suggestion.',
    foodFirst: [],
    naturopathAsk: 'Ask Dr. Vincent Lun (or your ordering provider) to interpret your sodium in the context of hydration and overall labs.',
  }),
  N({
    nutrientId: 'phosphorus',
    name: 'Phosphorus',
    actOn: 'BOTH',
    supplementSafe: false,
    markerSynonyms: ['phosphorus', 'phosphate', 'po4', 'serum phosphorus'],
    evidenceLevel: 'GUIDELINE',
    summary: 'An out-of-range phosphorus is a provider-review item, interpreted alongside calcium and kidney markers — not a self-supplement decision.',
    citations: [
      { title: 'Phosphorus — Fact Sheet for Health Professionals', source: ODS, url: 'https://ods.od.nih.gov/factsheets/Phosphorus-HealthProfessional/', type: 'Other' },
    ],
    basis: 'STUDY',
    usedFor: ['Provider-reviewed electrolyte / mineral interpretation'],
    evidenceNote: 'Phosphorus is read with calcium and kidney function. Out-of-range phosphorus is a clinical-interpretation item, never a supplement suggestion.',
    foodFirst: [],
    naturopathAsk: 'Ask Dr. Vincent Lun (or your ordering provider) to interpret your phosphorus together with calcium and kidney markers.',
  }),
];

const ALL = [...NUTRIENTS, ...ELECTROLYTES];

const normMarker = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * matchNutrient(markerText) — resolve a lab marker string to a nutrient entry, or null.
 * EXACT-substring on normalized synonyms — never a fuzzy guess.
 */
function matchNutrient(markerText) {
  const m = normMarker(markerText);
  if (!m) return null;
  for (const entry of ALL) {
    for (const syn of entry.markerSynonyms) {
      const s = normMarker(syn);
      if (s && (m === s || m.includes(s))) return entry;
    }
  }
  return null;
}

// DOCTRINE GATE: government / regulatory references (NIH ODS fact sheets, Health Canada DRIs) are
// COMPLIANCE / context only — NEVER the evidence authority (Vitalis Source Doctrine). Tag every gov
// citation so the renderer + gates treat it honestly and never present it as peer-reviewed evidence.
const _doctrine = require('../research-doctrine');
for (const n of NUTRIENTS.concat(ELECTROLYTES)) {
  for (const c of ((n.evidenceRec && n.evidenceRec.citations) || [])) {
    if (_doctrine.isGovernmentUrl(c.url) || _doctrine.isExcludedSource(c.source, c.url)) {
      c.type = 'GovernmentReference'; c.lane = _doctrine.SOURCE_LANES.COMPLIANCE; c.evidenceAuthority = false;
    } else {
      c.lane = c.lane || _doctrine.SOURCE_LANES.PRIMARY;
    }
  }
}

module.exports = {
  _provenance: {
    source: 'hand-curated nutrition/naturopathy reference (Vitalis protocol-core)',
    framing:
      'Government fact sheets (NIH ODS, Health Canada DRIs) are tagged COMPLIANCE / regulatory reference ' +
      'context — NOT the evidence authority (Vitalis Source Doctrine). Deficiency context for a "request ' +
      'for your naturopath" slip — NOT a prescription, NOT a diagnosis. Electrolytes are provider-review ' +
      'only (no OTC suggestion). Specific numbers come only from real citation titles.',
    naturopath: 'Dr. Vincent Lun',
  },
  NUTRIENTS,
  ELECTROLYTES,
  ALL,
  matchNutrient,
  normMarker,
};
