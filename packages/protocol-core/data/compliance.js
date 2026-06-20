/**
 * compliance.js — Compliance configuration (NOT legal advice).
 *
 * These are OPERATIONAL FLAGS that route an item to the correct review path.
 * They are deliberately conservative and they are NOT legal determinations.
 * Nothing here clears a compound for use anywhere — the app's job is to surface
 * the review requirement, never to resolve it.
 *
 * Statuses (the only four allowed): ALLOWED_RESOURCE | NEEDS_REVIEW | BLOCKED | UNKNOWN
 *   ALLOWED_RESOURCE — may be presented as educational/research resource in this jurisdiction
 *   NEEDS_REVIEW     — overlaps an approved/scheduled drug or other elevated class; legal + practitioner review required
 *   BLOCKED          — do not present as a resource (explicit prohibition recorded)
 *   UNKNOWN          — status not determinable from any sourced config (honest default; never guessed)
 *
 * Architecture rule (per directive): Canada is the default operating jurisdiction.
 * US is config-driven STATE-BY-STATE — NOT hardcoded determinations. Every US state
 * defaults to UNKNOWN until a real per-state legal source is supplied.
 */

const DISCLAIMER =
  'Compliance flags are operational routing signals only — NOT legal advice and NOT a legal determination. ' +
  'Every NEEDS_REVIEW / UNKNOWN item must be cleared by a qualified practitioner and/or legal counsel before any use.';

const STATUSES = ['ALLOWED_RESOURCE', 'NEEDS_REVIEW', 'BLOCKED', 'UNKNOWN'];

// Default jurisdiction posture. US "default" is UNKNOWN on purpose: federal vs state
// status varies and is not determinable here without a sourced legal reference.
const JURISDICTIONS = {
  CA: {
    code: 'CA',
    label: 'Canada',
    isDefault: true,
    default: 'ALLOWED_RESOURCE',
    basis: 'Canada is the default operating jurisdiction; baseline posture is research/educational resource framing. Elevated only by compound-class flags below.',
    states: null,
  },
  US: {
    code: 'US',
    label: 'United States',
    isDefault: false,
    default: 'UNKNOWN',
    basis: 'US status is federal + state dependent and is NOT determinable here without a sourced per-state legal reference. State map is a CONFIG SKELETON — every entry defaults UNKNOWN until sourced.',
    // Config skeleton ONLY. Real determinations require a legal source per state.
    // Demonstrates the state-by-state architecture without inventing legal status.
    states: {
      CA_STATE: { label: 'California', status: 'UNKNOWN', source: null },
      FL: { label: 'Florida', status: 'UNKNOWN', source: null },
      NY: { label: 'New York', status: 'UNKNOWN', source: null },
      TX: { label: 'Texas', status: 'UNKNOWN', source: null },
    },
  },
};

// Compound-class flags. Substring match (normalized, lowercase a-z0-9) tested against
// the product/compound name. A match ELEVATES the jurisdiction default to the flagged
// status. Conservative on purpose. Reasons are stated, not invented as legal fact.
const COMPOUND_FLAGS = [
  {
    match: ['semaglutide', 'sema', 'tirzepatide', 'tirzep', 'retatrutide', 'reta'],
    status: 'NEEDS_REVIEW',
    reason: 'GLP-1 / GIP class overlaps approved prescription drugs (e.g. Ozempic, Mounjaro). Resource use requires practitioner + legal review.',
  },
  {
    match: ['hgh', 'somatropin', 'growthhormone'],
    status: 'NEEDS_REVIEW',
    reason: 'Somatropin (growth hormone) is an approved/scheduled drug in CA & US. Elevated review required.',
  },
  {
    match: ['testosterone', 'trt', 'enanthate', 'cypionate'],
    status: 'NEEDS_REVIEW',
    reason: 'Anabolic / androgen class — controlled in CA & US. Requires a prescriber; resource framing only with explicit review.',
  },
  {
    match: ['clenbuterol'],
    status: 'NEEDS_REVIEW',
    reason: 'Not approved for human use in CA/US and prohibited in sport (WADA). Resource-only, explicit review required.',
  },
  {
    match: ['dnp', 'dinitrophenol'],
    status: 'BLOCKED',
    reason: 'Recorded as explicitly hazardous / prohibited for human use. Do not present as a resource.',
  },
];

module.exports = {
  _provenance: {
    source: 'hand-authored operational config (Vitalis Resource App)',
    note: 'NOT legal advice. Conservative routing flags only. US state map is a config skeleton defaulting to UNKNOWN.',
    disclaimer: DISCLAIMER,
  },
  DISCLAIMER,
  STATUSES,
  JURISDICTIONS,
  COMPOUND_FLAGS,
};
