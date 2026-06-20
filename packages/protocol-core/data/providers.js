/**
 * providers.js — Provider / referral suggestion config.
 *
 * HARD FRAMING: every entry here is a REFERRAL CATEGORY SUGGESTION, not a diagnosis.
 * The app may suggest "this metric pattern is commonly reviewed by <category>" — it must
 * NEVER state or imply the client HAS a condition. Triggers describe what was OBSERVED
 * (a metric, a lab flag), not a conclusion.
 *
 * Naming rule (locked): the naturopath is "Dr. Vincent Lun" on all output — never "Dr. Vinny".
 */

// Referral categories. `trigger` keys are matched by the gate/UI against observed signals.
// `label` is the category; `whenObserved` states the OBSERVATION that suggests the category;
// `disclaimer` is rendered verbatim with every suggestion.
const REFERRAL_CATEGORIES = [
  {
    trigger: 'lowTestosterone',
    label: 'Hormone health / endocrinology review',
    whenObserved: 'Client-reported goals or an entered hormone marker fall in a range commonly reviewed for low testosterone.',
    suggests: 'Practitioner-ordered full hormone panel and clinical review.',
    disclaimer: 'Referral category suggestion — not a diagnosis. Vitalis does not diagnose low testosterone.',
  },
  {
    trigger: 'nutrientDeficiency',
    label: 'Nutritional / functional medicine review',
    whenObserved: 'An entered vitamin or mineral value sits outside the reference range shown on the lab report.',
    suggests: 'Provider review of the deficiency panel and any repeat testing.',
    disclaimer: 'Referral category suggestion — not a diagnosis. Out-of-range ≠ a confirmed deficiency.',
  },
  {
    trigger: 'metabolic',
    label: 'Metabolic / weight-management review',
    whenObserved: 'Entered metabolic markers (glucose, fasting insulin, HbA1c) or body-composition goals indicate a metabolic focus.',
    suggests: 'Practitioner review of metabolic panel and goals.',
    disclaimer: 'Referral category suggestion — not a diagnosis.',
  },
  {
    trigger: 'abnormalLab',
    label: 'General practitioner / ordering-provider review',
    whenObserved: 'Any entered lab value is flagged outside the report reference range.',
    suggests: 'Review of the flagged value with the ordering provider before any action.',
    disclaimer: 'Referral category suggestion — not a diagnosis. A flag means "review with your provider", nothing more.',
  },
  {
    trigger: 'hormone',
    label: 'Hormone health / endocrinology review',
    whenObserved: 'Goals or markers indicate a broad hormone focus (beyond a single marker).',
    suggests: 'Practitioner-ordered hormone workup.',
    disclaimer: 'Referral category suggestion — not a diagnosis.',
  },
  {
    trigger: 'gutHealth',
    label: 'Functional GI / gut-health review',
    whenObserved: 'Goals or notes indicate a digestive / gut focus.',
    suggests: 'Practitioner review; advanced GI / stool testing is a provider decision.',
    disclaimer: 'Referral category suggestion — not a diagnosis.',
  },
];

// Named providers available for referral. Categories link to one or more of these.
// Nothing here is auto-booked; these are contact suggestions surfaced for the operator.
const PROVIDERS = [
  {
    id: 'dr_vincent_lun',
    name: 'Dr. Vincent Lun',
    role: 'Naturopathic Doctor & Functional Neurology Fellow',
    contact: '613-413-6053',
    focus: ['hormone', 'lowTestosterone', 'nutrientDeficiency', 'metabolic', 'abnormalLab', 'gutHealth'],
    note: 'Partnering naturopath on Vitalis client care. Runs the "Enhanced Healthy Living Assessment" baseline panel. Reviews protocols before use.',
  },
];

module.exports = {
  _provenance: {
    source: 'hand-authored referral config (Vitalis Resource App)',
    note: 'Referral CATEGORY suggestions only — never diagnoses. Dr. Vincent Lun naming rule enforced.',
  },
  REFERRAL_CATEGORIES,
  PROVIDERS,
};
