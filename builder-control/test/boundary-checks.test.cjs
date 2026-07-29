"use strict";
/**
 * boundary-checks.test.cjs
 * Unit assertions for boundary-checks.cjs.
 * Run: node builder-control/test/boundary-checks.test.cjs
 * Exits 0 on all pass, 1 on any failure.
 */

const b = require("../boundary-checks.cjs");

let passed = 0;
let failed = 0;

function assert(label, actual, expected) {
  const ok = actual === expected;
  if (ok) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    console.error(`      expected: ${expected}`);
    console.error(`      actual:   ${actual}`);
    failed++;
  }
}

// ── govLeak ──────────────────────────────────────────────────────────────────
console.log("\n── govLeak ──");

// MUST be TRUE — per packet testsRequired, any appearance of ClinicalTrials.gov / NCT#####
// in customer-facing copy is a violation (DIRECT-AGENT-BYPASS-CONTROL-2026-06-18.md:
// these were the exact extra terms prior gates missed entirely).
assert(
  "bare ClinicalTrials.gov reference → violated",
  b.govLeak("per ClinicalTrials.gov NCT01234567").violated,
  true
);

assert(
  "ClinicalTrials.gov confirms safety (authority framing) → violated",
  b.govLeak("ClinicalTrials.gov confirms this peptide demonstrates safety for human use").violated,
  true
);

assert(
  "NCT01234567 proves safety → violated",
  b.govLeak("NCT01234567 proves safety and efficacy for this compound").violated,
  true
);

assert(
  "FDA-approved → violated",
  b.govLeak("This peptide is FDA-approved for use").violated,
  true
);

assert(
  "503A-compliant quality → violated",
  b.govLeak("Our peptides are sourced from 503A-compliant quality facilities").violated,
  true
);

assert(
  "approvalStatus: approved → violated",
  b.govLeak('approvalStatus: "approved"').violated,
  true
);

assert(
  "U.S. regulator approved → violated",
  b.govLeak("Approved by the U.S. regulator for therapeutic use").violated,
  true
);

// MUST be FALSE
assert(
  "mechanism studied in animals → NOT violated",
  b.govLeak("mechanism studied in animals").violated,
  false
);

assert(
  "animal study data → NOT violated",
  b.govLeak("The animal study data shows promising results for BPC-157").violated,
  false
);

assert(
  "preclinical → NOT violated",
  b.govLeak("Evidence is primarily preclinical at this stage").violated,
  false
);

// Brain source key format: "NCT:NCT01234567" (double-NCT, quoted in JSON — see brain.js sourceKey())
assert(
  "brain NCT source key (JSON-quoted, double-NCT format) → NOT violated",
  b.govLeak('"NCT:NCT01234567"').violated,
  false
);

assert(
  "not FDA-approved → NOT violated",
  b.govLeak("This compound is not FDA-approved for human use").violated,
  false
);

// Gate-G 2026-06-22 regression: a generic citation verb must NOT disarm a real leak,
// and natural-language FDA phrasing with interposed words must be caught.
assert(
  "'see ClinicalTrials.gov for the trial' (citation verb must not disarm) → violated",
  b.govLeak("see ClinicalTrials.gov for the trial").violated,
  true
);

assert(
  "'The FDA has approved this peptide' (NL phrasing, interposed 'has') → violated",
  b.govLeak("The FDA has approved this peptide for sale").violated,
  true
);

// ── inventedAuthority ────────────────────────────────────────────────────────
console.log("\n── inventedAuthority ──");

const unregisteredAgent = {};
const canonAgent = { agentId: "protocol-core", forbiddenTasks: [] };
const forbiddenAgent = {
  agentId: "daniel",
  forbiddenTasks: ["dosing_authority", "evidence_tier_assignment", "brain_ownership"],
};

assert(
  "I calculated the dose (unregistered agent) → violated",
  b.inventedAuthority("I calculated the dose is 5mg per week", unregisteredAgent).violated,
  true
);

assert(
  "I calculated the dose (forbidden-task agent) → violated",
  b.inventedAuthority("I calculated the dose is 5mg per week", forbiddenAgent).violated,
  true
);

assert(
  "plain text no assertion (canon agent) → NOT violated",
  b.inventedAuthority("The research shows promising results", canonAgent).violated,
  false
);

assert(
  "I built my own research brain (unregistered) → violated",
  b.inventedAuthority("I built my own research brain for this peptide", unregisteredAgent).violated,
  true
);

assert(
  "plain informational text → NOT violated",
  b.inventedAuthority("BPC-157 has been studied for gut healing in rodent models", forbiddenAgent).violated,
  false
);

// ── dosingOutOfCanon ─────────────────────────────────────────────────────────
console.log("\n── dosingOutOfCanon ──");

assert(
  "5mg per week with no attribution → violated",
  b.dosingOutOfCanon("Inject 5mg per week on Monday mornings").violated,
  true
);

assert(
  "dose of 2 without attribution → violated",
  b.dosingOutOfCanon("The dosage of 2 subcutaneous injections per day").violated,
  true
);

assert(
  "protocol-core cited → NOT violated",
  b.dosingOutOfCanon("Per protocol-core: inject 5mg per week as defined in dosing.js").violated,
  false
);

assert(
  "general description without numeric dose → NOT violated",
  b.dosingOutOfCanon("BPC-157 supports gut mucosal healing through cytoprotective pathways").violated,
  false
);

// ── publicPush ───────────────────────────────────────────────────────────────
console.log("\n── publicPush ──");

assert(
  "cornerstoneregroup-site/index.html → violated",
  b.publicPush("cornerstoneregroup-site/index.html").violated,
  true
);

assert(
  "cornerstoneregroup-site/data/agents.json → violated",
  b.publicPush("cornerstoneregroup-site/data/agents.json").violated,
  true
);

assert(
  "peptide-resource-app/public/catalog.json → violated",
  b.publicPush("peptide-resource-app/public/catalog.json").violated,
  true
);

assert(
  "packages/protocol-core/data/dosing.js → violated",
  b.publicPush("packages/protocol-core/data/dosing.js").violated,
  true
);

assert(
  "builder-control/gate.cjs → NOT violated",
  b.publicPush("builder-control/gate.cjs").violated,
  false
);

assert(
  "luke-app/public/catalog-data.json → NOT violated",
  b.publicPush("luke-app/public/catalog-data.json").violated,
  false
);

assert(
  "research/daniel-tool-scout-2026-06-22.json → NOT violated",
  b.publicPush("research/daniel-tool-scout-2026-06-22.json").violated,
  false
);

// ── customerCopyNoKrite ──────────────────────────────────────────────────────
console.log("\n── customerCopyNoKrite ──");

const kritefullArtifact = `
KRITE REQUIRED: YES
KRITE STATUS: APPROVED
USER APPROVAL STATUS: APPROVED
CURRENT STATE: APPROVED
This is a Vitalis Protocol Guide for BPC-157.
`;

const kritePartialArtifact = `
KRITE REQUIRED: YES
KRITE STATUS: NOT RUN
USER APPROVAL STATUS: APPROVED
CURRENT STATE: DRAFT
This is a Vitalis Protocol Guide for BPC-157.
`;

const nonProtocolArtifact = `
This is a generic document about research.
No protocol content here.
`;

assert(
  "all KRITE markers present → NOT violated",
  b.customerCopyNoKrite(kritefullArtifact, "01-CORNERSTONE-RESEARCH-GROUP/bpc157-protocol-guide.html").violated,
  false
);

assert(
  "missing KRITE STATUS: APPROVED → violated",
  b.customerCopyNoKrite(kritePartialArtifact, "01-CORNERSTONE-RESEARCH-GROUP/bpc157-protocol-guide.html").violated,
  true
);

assert(
  "non-protocol artifact → NOT violated",
  b.customerCopyNoKrite(nonProtocolArtifact, "docs/readme.md").violated,
  false
);

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n── Results: ${passed} passed / ${failed} failed ──\n`);
process.exit(failed > 0 ? 1 : 0);
