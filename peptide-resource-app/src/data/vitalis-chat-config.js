// ============================================================================
// VITALIS CHAT — CONFIGURATION
// ============================================================================
// Safety posture, content moderation triggers, and tier toggles.
// Kept as a pure data module so it can be read without importing React.
// ============================================================================

/**
 * Content-moderation triggers.
 * If a user message matches one of these patterns, the chat request is:
 *  - flagged in the Netlify function log
 *  - (if MODERATION_EMAIL is configured server-side) an alert emails Marc
 *  - the system prompt gets an extra "EXTRA-CAUTION" preamble
 *  - for severity "block", the chat refuses to generate and shows crisis copy
 */
export const MODERATION_TRIGGERS = [
  {
    id: 'minors',
    severity: 'block',
    pattern: /\b(my|the|a)\s+(kid|child|daughter|son|teen|teenager|minor)\b|\b(under|below)\s*(13|14|15|16|17|18)\b|\bfor my\s+(\d{1,2})\s*(yo|year old|y\/o)/i,
    label: 'Minor referenced',
    response: 'Peptide protocols are for adults 18+ only. If you are asking on behalf of a minor, please consult a pediatric endocrinologist — we cannot produce guidance here.',
  },
  {
    id: 'self-harm',
    severity: 'block',
    pattern: /\b(kill myself|suicide|suicidal|end my life|self-harm|harm myself)\b/i,
    label: 'Self-harm signal',
    response: 'If you\'re in crisis, please contact the Suicide and Crisis Lifeline (988 in the US, or your local equivalent). We\'re not equipped to help here, but real support is available right now.',
  },
  {
    id: 'illegal-substances',
    severity: 'block',
    pattern: /\b(cocaine|heroin|meth|methamphetamine|fentanyl|crack|ketamine)\b/i,
    label: 'Illegal substance mention',
    response: 'Vitalis only discusses research peptides and FDA-regulated compounds. For substance-use questions, please consult a licensed clinician.',
  },
  {
    id: 'pregnancy-angiogenic',
    severity: 'flag',
    pattern: /\b(pregnan|ttc|trying to conceive|nursing|breastfeeding)\b.*\b(bpc|tb-?500|ghk|selank|klow)\b|\b(bpc|tb-?500|ghk|selank|klow)\b.*\b(pregnan|ttc|trying to conceive|nursing)\b/i,
    label: 'Pregnancy + angiogenic peptide query',
    response: null, // handled by system prompt contraindication rule
  },
  {
    id: 'cancer-angiogenic',
    severity: 'flag',
    pattern: /\bcancer\b.*\b(bpc|tb-?500|ghk|igf|growth hormone)\b|\b(bpc|tb-?500|ghk|igf)\b.*\bcancer\b/i,
    label: 'Cancer history + angiogenic peptide query',
    response: null,
  },
  {
    id: 'diagnose-request',
    severity: 'redirect',
    pattern: /\b(do i have|am i (a )?diabetic|is this cancer|diagnose me)\b/i,
    label: 'Diagnosis request',
    response: 'Vitalis cannot diagnose. If you\'re concerned about a condition, please see a licensed physician for evaluation — then we can help structure a research-backed protocol around their guidance.',
  },
];

/**
 * Clinical vs Community evidence-tier toggle.
 * Default: Clinical mode → T1+T2 only, conservative framing.
 * Community mode → T1+T2+T3, grey-market stacks explicitly labeled.
 */
export const EVIDENCE_MODES = {
  clinical: {
    id: 'clinical',
    label: 'Clinical',
    description: 'T1 (peer-reviewed RCT) + T2 (practitioner consensus) only. Conservative dosing. Default.',
    allowedTiers: ['T1', 'T2'],
    additionalPromptInstructions: 'Use ONLY T1 and T2 sources. Decline any T3 claim. Bias toward the most conservative published dose in every range.',
  },
  community: {
    id: 'community',
    label: 'Community',
    description: 'T1 + T2 + T3 (grey-market / Russian bioregulators / n=1). Every T3 claim explicitly labeled.',
    allowedTiers: ['T1', 'T2', 'T3'],
    additionalPromptInstructions: 'T3 sources are permitted BUT every T3 claim must be explicitly labeled "T3: [source]" and carry the thin-evidence caveat. Never mix T3 dosing into the primary recommendation — always offer T1/T2 first and T3 as "what the grey-market community runs" alternative.',
  },
};

export const DEFAULT_EVIDENCE_MODE = 'clinical';

/**
 * Model configuration.
 * Primary: Sonnet 4.6 (CRG default, per Model Selection Rules).
 * Safety critic (Phase 2): Opus 4.7.
 * Changeable in one line for emergency swaps.
 */
export const MODEL_CONFIG = {
  primary: 'claude-sonnet-4-6',
  criticEnabled: false, // Phase 2 — Opus safety-reviewer pass
  critic: 'claude-opus-4-7',
  maxTokens: 3000,
  temperature: 0.4, // conservative; dosing is not a creative task
};

/**
 * Intake fields — canonical shape.
 * Chat remains locked until this intake is complete.
 */
export const INTAKE_SCHEMA = {
  age: { label: 'Age', type: 'number', required: true, min: 18, max: 120 },
  sex: { label: 'Sex', type: 'select', required: true, options: ['male', 'female', 'intersex', 'prefer not to say'] },
  weight: { label: 'Weight (lbs or kg — specify)', type: 'text', required: true },
  goals: { label: 'Goals', type: 'multiselect', required: true, options: [
    'Fat loss', 'Muscle gain', 'Recovery / injury', 'Anti-aging / longevity',
    'Cognitive / focus', 'Immune restoration', 'Sleep quality', 'Libido / hormonal',
    'Reproductive health', 'General wellness / executive baseline'
  ]},
  medications: { label: 'Current medications (prescription + OTC)', type: 'textarea', required: false },
  conditions: { label: 'Medical conditions (diabetes, thyroid, autoimmune, etc.)', type: 'textarea', required: false },
  allergies: { label: 'Allergies (peptides, excipients, food)', type: 'textarea', required: false },
  athlete: { label: 'WADA-tested athlete?', type: 'boolean', required: true },
  pregnancy: { label: 'Pregnant / nursing / trying to conceive?', type: 'boolean', required: true },
  cancer: { label: 'Cancer history (any type, any remission length)?', type: 'boolean', required: true },
  cancerType: { label: 'Cancer type (if yes)', type: 'text', required: false, showIf: 'cancer' },
};

/**
 * "Send stack to Marc" GHL integration.
 * Reuses existing ghl-proxy pattern — ships the full stack summary to GHL
 * as a contact note so Marc can pick it up in his inbox.
 */
export const SEND_TO_MARC_CONFIG = {
  endpoint: '/.netlify/functions/ghl-proxy',
  action: 'inquiry-contact',
  tagsDefault: ['vitalis-chat-stack', 'vitalis-protocol'],
  source: 'Vitalis Chat — Protocol Recommendation',
};

/**
 * Runtime check: moderate a user message.
 * Returns { flagged: true, trigger: {...} } or { flagged: false }.
 */
export function moderateMessage(text) {
  if (!text || typeof text !== 'string') return { flagged: false };
  for (const trigger of MODERATION_TRIGGERS) {
    if (trigger.pattern.test(text)) {
      return { flagged: true, trigger };
    }
  }
  return { flagged: false };
}

/**
 * Protocol ID generator.
 * Format: VIT-PROTO-YYYYMMDD-<goal>-<tier>-<seq>
 */
export function generateProtocolId({ goal = 'general', tier = 'clinical', seq = 1 } = {}) {
  const d = new Date();
  const yyyymmdd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const safeGoal = String(goal).toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 20);
  const safeTier = String(tier).toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 12);
  const seqPad = String(seq).padStart(3, '0');
  return `VIT-PROTO-${yyyymmdd}-${safeGoal}-${safeTier}-${seqPad}`;
}

export default {
  MODERATION_TRIGGERS,
  EVIDENCE_MODES,
  DEFAULT_EVIDENCE_MODE,
  MODEL_CONFIG,
  INTAKE_SCHEMA,
  SEND_TO_MARC_CONFIG,
  moderateMessage,
  generateProtocolId,
};
