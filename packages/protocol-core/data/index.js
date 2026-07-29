/**
 * data/index.js — source-of-truth data barrel for @vitalis/protocol-core.
 *
 * These are the seeded, verified source-of-truth files (catalog, evidence corpus,
 * lab panels, compliance config, providers, demo fixtures). Nothing here is invented;
 * unknowns are null / UNKNOWN, never guessed. Runtime state (store.json) lives in the
 * consuming app, NOT in this package.
 */
module.exports = {
  catalog: require('./catalog.json'),
  evidence: require('./evidence.json'),
  panels: require('./lab-panels.js'),
  compliance: require('./compliance.js'),
  providers: require('./providers.js'),
  // Location-aware inter-industry referral network (SCAFFOLD) — additive layer over
  // providers.js. Roster + demo handshake records; suggestion-only, no fee execution.
  referralNetwork: require('./referral-network.js'),
  demo: require('./demo-clients.js'),
  dosing: require('./dosing.js'),
  community: require('./community.js'),
  researchSources: require('./research-sources.js'),
};
