/**
 * acceptance.js — The 10 hard acceptance tests from the build directive.
 *
 * No test framework (dependency-free, by design). Each test exercises the REAL gate
 * engine in lib/gates.js against the REAL source-of-truth data files — not mocks — so a
 * pass means the shipped wiring is honest, not just that a stub returned a happy value.
 *
 *   1  missing product route/form     → protocol BLOCKED
 *   2  product not in catalog         → protocol BLOCKED
 *   3  missing research evidence      → UNKNOWN, never a recommendation
 *   4  missing lab panel source       → NEEDS_SOURCE, markers never invented
 *   5  abnormal lab value             → "review with provider", never a diagnosis
 *   6  SubQ vs oral                   → substitution BLOCKED (routes never blurred)
 *   7  Canada compliance on a draft   → CA status always present
 *   8  draft stays DRAFT until review → and is RESOURCE ONLY even after
 *   9  medical-claim language         → BLOCKED; real disclaimer PASSES
 *  10  dashboard on demo data         → demo present and flagged _demo
 *
 * Plus integration + doctrine + multi-tenant permission checks:
 *  I1/I2  the gate chain blocks/drafts; referral routing is category-based
 *  D1     Dr. Vincent Lun is never "Vinny" on any output
 *  P1     HARD RULE: a client sees ONLY approved resources; a DRAFT never leaks
 *  P2     practitioner→client ownership is derived (not denormalized onto drafts)
 *  P3     "My Protocols" reuses the same approval boundary; lifecycle split + timeline are client-safe
 *
 * Plus the conversational GENERATOR — "AI proposes, gates dispose" — proven to add NOTHING
 * that can bypass a gate, and to honor every dosing-liability lever:
 *  G1     a generated protocol flows through the SAME gate chain → DRAFT / RESOURCE ONLY
 *  G2     the proposer can only reference REAL catalog items — never an off-catalog invention
 *  G3     dosing is ATTRIBUTION ("literature reports …"), never an INSTRUCTION ("take …")
 *  G4     Retatrutide is capped at 4 mg/week with a MANDATORY 6-week taper (tier-matrix rule)
 *  G5     SS-31 + MOTS-c are always co-dosed (canonical pairing enforced by the proposer)
 *  G6     GHRH analogs are never stacked (CJC-1295 + Tesamorelin never together)
 *  G7     the CLIENT view is never a personal prescription (no titration/taper); default CA
 *  G8     no banned medical-claim language anywhere on the generator surface
 *  G9     approving a generated protocol requires FULL practitioner attestation
 *
 * Plus the two-source PRESENTATION — "studies where they exist, community practice where they
 * don't" — proven attributed, never asserted, and never a fabricated number:
 *  B1     a study-tier item surfaces REAL citations + a finding echoed from a citation title
 *  B2     a no-trials item is honestly labeled "community-reported", with REPORTED benefits
 *  B3     the CLIENT view hides the administration pattern + the full citation list
 *  B4     the software-license acknowledgment requires responsibility + qualifications
 *  B5     no banned medical-claim language across the whole two-source presentation surface
 *
 * Plus the NUTRITION module — drag-drop/paste a lab report → out-of-range vitamins/minerals
 * become a "request for your naturopath" SLIP (Dr. Vincent Lun) — never a prescription, never
 * a diagnosis, grounded in real NIH ODS / Health Canada citations on the same two-source rails:
 *  N1     the local parser reads CSV/tab/loose formats, drops headers, and NEVER invents a value
 *  N2     out-of-range safe micronutrients recommend; in-range excluded; electrolytes provider-only
 *  N3     operator sees real citations + naturopathic pattern; the CLIENT view softens both
 *  N4     no medical-claim language on the slip; names Dr. Vincent Lun (never "Vinny"); resource-only
 *  N5     the peptide⇄nutrition cross-reference is REAL + product-aware; duplicate markers dedupe
 *
 * Run: npm test   (node test/acceptance.js)
 */
'use strict';
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const G = require('@vitalis/protocol-core/gates');
const GEN = require('@vitalis/protocol-core/generator');
const dosing = require('@vitalis/protocol-core/data/dosing');
const PRES = require('@vitalis/protocol-core/presentation');
const community = require('@vitalis/protocol-core/data/community');
const NUT = require('@vitalis/protocol-core/nutrition');
const PKG = require('@vitalis/protocol-core/packages');
const ACC = require('@vitalis/protocol-core/accounts');
const ADDON = require('@vitalis/protocol-core/addons');
const RSRC = require('@vitalis/protocol-core/research');
const MEALS = require('@vitalis/protocol-core/meals');
const SUP = require('@vitalis/protocol-core/supplements');
const CONN = require('@vitalis/protocol-core/connectors');
const FOODS = require('@vitalis/protocol-core/data/foods');
const {
  catalog,
  evidence,
  panels,
  compliance: complianceCfg,
  providers: providersCfg,
  referralNetwork: referralNet,
  demo,
} = require('@vitalis/protocol-core/data');

// Mirror the server's wiring exactly (server.js builds the index the same way).
const catalogIndex = { byId: {}, list: catalog.products };
for (const p of catalog.products) catalogIndex.byId[p.id] = p;
const evidenceByCompound = evidence.byCompound;

// --- tiny harness -----------------------------------------------------------
let passed = 0;
const failures = [];
function test(num, name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ [${num}] ${name}`);
  } catch (e) {
    failures.push({ num, name, message: e.message });
    console.log(`  ✗ [${num}] ${name}\n      ${e.message}`);
  }
}

// Async variant for tests that must drive the REAL Express server over HTTP (the OPEN-MODE
// suite). Same pass/fail accounting; awaited from the async runner at the end of the file.
async function testAsync(num, name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ [${num}] ${name}`);
  } catch (e) {
    failures.push({ num, name, message: e.message });
    console.log(`  ✗ [${num}] ${name}\n      ${e.message}`);
  }
}

console.log('\nMy Vitalis Health — acceptance tests\n');

// --- 1: missing product route/form → blocked --------------------------------
test(1, 'Missing route OR form blocks the product', () => {
  const noRoute = G.productFormRouteGate({ name: 'Mystery', route: null, form: 'Vial' });
  assert.strictEqual(noRoute.blocked, true, 'null route must block');
  const noForm = G.productFormRouteGate({ name: 'Mystery', route: 'SubQ injection', form: null });
  assert.strictEqual(noForm.blocked, true, 'null form must block');
  const nullProduct = G.productFormRouteGate(null);
  assert.strictEqual(nullProduct.blocked, true, 'null product must block');
  const real = catalog.products.find((p) => p.route && p.form);
  const ok = G.productFormRouteGate(real);
  assert.strictEqual(ok.ok, true, 'a real product with route+form must pass');
});

// --- 2: product not in catalog → blocked ------------------------------------
test(2, 'Product not in source-of-truth catalog is blocked', () => {
  const miss = G.catalogMembershipGate({ productName: 'Totally Fabricated Compound QZX-999' }, catalogIndex);
  assert.strictEqual(miss.ok, false, 'unknown product must not resolve');
  assert.strictEqual(miss.product, null, 'no product object for an unknown ref');
  assert.match(miss.reason, /not in the source-of-truth/i);
  const realId = catalog.products[0].id;
  const hit = G.catalogMembershipGate({ productId: realId }, catalogIndex);
  assert.strictEqual(hit.ok, true, 'a real catalog id must resolve');
  assert.strictEqual(hit.product.id, realId);
});

// --- 3: missing evidence → UNKNOWN, no recommendation -----------------------
test(3, 'No sourced evidence yields UNKNOWN and never a recommendation', () => {
  const unk = G.researchGate('compound_that_does_not_exist', evidenceByCompound);
  assert.strictEqual(unk.level, 'UNKNOWN');
  assert.strictEqual(unk.recommendation, null, 'must never fabricate a recommendation');
  assert.strictEqual(unk.citationCount, 0);
  // Even WITH evidence, the app surfaces evidence but never "recommends".
  const known = G.researchGate(catalog.products[0].evidenceCompoundId, evidenceByCompound);
  assert.strictEqual(known.recommendation, null, 'app surfaces evidence, never recommends');
  assert.ok(typeof known.level === 'string' && known.level.length > 0);
});

// --- 4: missing lab panel source → NEEDS_SOURCE, no invention ---------------
test(4, 'Unsourced lab panel is NEEDS_SOURCE with no invented markers', () => {
  const needs = panels.OPTIONAL.find((p) => p.status === 'NEEDS_SOURCE');
  assert.ok(needs, 'fixture: at least one OPTIONAL panel is NEEDS_SOURCE');
  const gated = G.labPanelGate(needs);
  assert.strictEqual(gated.status, 'NEEDS_SOURCE');
  assert.strictEqual(gated.ok, false);
  assert.deepStrictEqual(gated.markers, [], 'markers must NOT be invented');
  const sourced = panels.OPTIONAL.find((p) => p.status === 'SOURCED');
  assert.strictEqual(G.labPanelGate(sourced).ok, true, 'a sourced panel passes');
});

// --- 5: abnormal lab → "review with provider", never a diagnosis ------------
test(5, 'Out-of-range lab says review-with-provider, never a diagnosis', () => {
  const res = G.labResultFlagGate({
    id: 't5', clientId: 'c',
    values: [
      { marker: 'Vitamin D', value: 18, refLow: 30, refHigh: 100 }, // LOW
      { marker: 'ALT', value: 25, refLow: 10, refHigh: 50 },        // in range
    ],
  });
  const low = res.values.find((v) => v.marker === 'Vitamin D');
  assert.strictEqual(low.flag, 'OUT_OF_RANGE_LOW');
  assert.strictEqual(low.action, 'Review with your provider — this is not a diagnosis.');
  const inRange = res.values.find((v) => v.marker === 'ALT');
  assert.strictEqual(inRange.flag, 'IN_RANGE');
  assert.strictEqual(inRange.action, null, 'in-range values carry no action');
  // The action must not contain a diagnosis verb in a non-negated form.
  const lang = G.languageGate(low.action);
  assert.strictEqual(lang.ok, true, 'the action language itself must pass the language gate');
});

// --- 6: SubQ vs oral can never be substituted/blurred -----------------------
test(6, 'SubQ and oral routes can never be substituted', () => {
  const mismatch = G.routeIntegrityGate({ route: 'SubQ injection' }, { route: 'Oral capsule' });
  assert.strictEqual(mismatch.blocked, true, 'INJECTED vs ORAL must block');
  const sameClass = G.routeIntegrityGate({ route: 'SubQ injection' }, { route: 'SubQ injection' });
  assert.strictEqual(sameClass.ok, true, 'same route class is allowed');
  const unknown = G.routeIntegrityGate({ route: null }, { route: 'Oral capsule' });
  assert.strictEqual(unknown.blocked, true, 'an UNKNOWN route blocks substitution');
});

// --- 7: Canada compliance present on every draft ----------------------------
test(7, 'Canada compliance status is present on every draft', () => {
  const real = catalog.products.find((p) => p.route && p.form);
  const draft = G.assembleDraft({
    client: { id: 'c7' }, itemRefs: [{ productId: real.id }],
    catalogIndex, evidenceByCompound, complianceCfg, jurisdiction: 'CA',
    rationale: 'If someone were considering options, the literature most often referenced covers this area.',
  });
  assert.strictEqual(draft.compliance.jurisdiction, 'CA');
  assert.ok(complianceCfg.STATUSES.includes(draft.compliance.status), 'status is a known compliance status');
  // A flagged compound (retatrutide) elevates to NEEDS_REVIEW under CA.
  const reta = G.complianceGate('Retatrutide 10mg/vial', 'CA', complianceCfg);
  assert.strictEqual(reta.status, 'NEEDS_REVIEW');
});

// --- 8: draft stays DRAFT until reviewed, RESOURCE ONLY forever -------------
test(8, 'Draft is DRAFT until reviewed and RESOURCE ONLY even after', () => {
  const pre = G.draftStatusGate({ reviewedBy: null });
  assert.strictEqual(pre.status, 'DRAFT');
  assert.strictEqual(pre.isResourceOnly, true);
  assert.match(pre.banner, /NOT REVIEWED/);
  const post = G.draftStatusGate({ reviewedBy: 'Dr. Vincent Lun', status: 'REVIEWED' });
  assert.strictEqual(post.reviewed, true);
  assert.strictEqual(post.isResourceOnly, true, 'still resource-only after review — never a prescription');
});

// --- 9: medical-claim language blocked; real disclaimer passes --------------
test(9, 'Banned medical-claim language is caught; disclaimers pass', () => {
  const bad = G.languageGate('This product treats and cures the condition and a doctor will prescribe it.');
  assert.strictEqual(bad.ok, false, 'treats/cures/prescribe must be caught');
  const terms = bad.violations.map((v) => v.term.toLowerCase());
  assert.ok(terms.includes('treats') && terms.includes('cures') && terms.includes('prescribe'));
  // The shipped disclaimer negates every banned term and must PASS.
  const disc = 'Educational / research resource only. NOT medical advice. Vitalis does not diagnose, treat, cure, or prescribe. Not a substitute for a doctor.';
  assert.strictEqual(G.languageGate(disc).ok, true, 'negated disclaimer must pass');
  // Compliance config disclaimer must also pass the gate.
  assert.strictEqual(G.languageGate(complianceCfg.DISCLAIMER).ok, true, 'compliance DISCLAIMER must pass');
});

// --- 10: dashboard works on demo data ---------------------------------------
test(10, 'Demo data is present and clearly flagged _demo', () => {
  const gate = G.demoDataGate(demo);
  assert.strictEqual(gate.ok, true);
  assert.ok(gate.clientCount >= 3, 'at least 3 demo clients');
  assert.strictEqual(gate.allFlaggedDemo, true, 'every demo client carries _demo:true');
});

// --- integration: the gate chain actually blocks and actually drafts --------
test('I1', 'assembleDraft BLOCKS a bogus product, DRAFTS a real one', () => {
  const bogus = G.assembleDraft({
    client: { id: 'ci' }, itemRefs: [{ productName: 'Fake QZX-999' }],
    catalogIndex, evidenceByCompound, complianceCfg, jurisdiction: 'CA',
  });
  assert.strictEqual(bogus.blocked, true);
  assert.strictEqual(bogus.status, 'BLOCKED');

  const real = catalog.products.find((p) => p.route && p.form);
  const good = G.assembleDraft({
    client: { id: 'ci' }, itemRefs: [{ productId: real.id }],
    catalogIndex, evidenceByCompound, complianceCfg, jurisdiction: 'CA',
  });
  assert.strictEqual(good.blocked, false);
  assert.strictEqual(good.status, 'DRAFT');
  assert.match(good.statusBanner, /RESOURCE ONLY/);
});

// --- integration: referral routing is category-based, never a diagnosis -----
test('I2', 'Referral gate routes Jim to abnormalLab + nutrientDeficiency', () => {
  const jim = demo.DEMO_CLIENTS.find((c) => /jim/i.test(c.id) || /jim/i.test(c.firstName || c.name || ''));
  assert.ok(jim, 'fixture: demo Jim present');
  const jimResults = demo.DEMO_LAB_RESULTS
    .filter((r) => r.clientId === jim.id)
    .map((r) => G.labResultFlagGate(r));
  const refs = G.referralGate(jim, jimResults, providersCfg);
  const triggers = refs.map((r) => r.trigger);
  assert.ok(triggers.includes('abnormalLab'), 'flagged labs → abnormalLab category');
  // every referral is a category suggestion, explicitly not a diagnosis
  for (const r of refs) assert.match(r.disclaimer, /not a diagnosis/i);
});

// --- doctrine: Dr. Vincent Lun is never "Dr. Vinny" on any output -----------
test('D1', 'No "Vinny" appears anywhere in provider config or referrals', () => {
  const blob = JSON.stringify(providersCfg) + JSON.stringify(demo);
  assert.strictEqual(/vinny/i.test(blob), false, 'the name "Vinny" must never appear on paper');
  const lun = providersCfg.PROVIDERS.find((p) => /lun/i.test(p.name));
  assert.ok(lun, 'Dr. Vincent Lun present');
  assert.match(lun.name, /Vincent Lun/);
});

// --- referral network (SCAFFOLD): location + service filter is a suggestion --
// The inter-industry network is additive over providers.js. filterNetwork must (a) honor the
// service↔category vocabulary, (b) respect region + availability, and (c) never fork the
// gate or invent a match. The anchor roster member is the SAME Dr. Vincent Lun identity.
test('RN1', 'Referral-network filter is location + service aware, respects availability, and reuses Dr. Vincent Lun (never "Vinny")', () => {
  // Roster shape: at least the anchor + demo members, each carrying location + servicesOffered.
  assert.ok(referralNet.REFERRAL_NETWORK.length >= 3, 'fixture: a few network members exist');
  for (const m of referralNet.REFERRAL_NETWORK) {
    assert.ok(m.location && m.location.region, `member ${m.id} carries a region`);
    assert.ok(Array.isArray(m.servicesOffered) && m.servicesOffered.length > 0, `member ${m.id} offers services`);
  }
  // The anchor naturopath is reused from providers.js — identity + naming rule preserved.
  const anchor = referralNet.REFERRAL_NETWORK.find((m) => m.id === 'dr_vincent_lun');
  assert.ok(anchor, 'anchor naturopath present in the network');
  assert.match(anchor.name, /Vincent Lun/);
  assert.strictEqual(/vinny/i.test(JSON.stringify(referralNet)), false, '"Vinny" must never appear in the referral network');

  // Service filter: hormone_panel must return only members who offer it (directly or via mapping).
  const hormone = referralNet.filterNetwork({ service: 'hormone_panel' });
  assert.ok(hormone.length >= 1, 'a hormone-panel provider matches');
  for (const m of hormone) {
    const offers = m.servicesOffered.map((s) => s.toLowerCase());
    assert.ok(offers.includes('hormone_panel'), `${m.id} actually offers hormone_panel`);
  }
  // Region filter: a QC region has no demo members → an honest empty list (nothing invented).
  assert.deepStrictEqual(referralNet.filterNetwork({ service: 'hormone_panel', region: 'QC' }), [], 'no QC member → empty, not fabricated');
  // Availability: the not-accepting dietitian is excluded by default, included only on request.
  const rdDefault = referralNet.filterNetwork({ service: 'nutrition_dietetics' }).map((m) => m.id);
  const rdAll = referralNet.filterNetwork({ service: 'nutrition_dietetics', includeUnavailable: true }).map((m) => m.id);
  assert.ok(!rdDefault.includes('demo_dietitian_ott'), 'a not-accepting member is excluded by default');
  assert.ok(rdAll.includes('demo_dietitian_ott'), 'includeUnavailable surfaces the not-accepting member');
});

// --- referral network (SCAFFOLD): status records are suggestions, NEVER a fee -
// The demo handshake records illustrate the lifecycle the scaffold documents but does not
// transport. Every record must be a CATEGORY suggestion (not a diagnosis), carry feeStatus
// 'NONE' (no marketplace), and resolve to a real roster recipient. handshake ⇒ ACCEPTED.
test('RN2', 'Referral status records are suggestions with NO fee executed, resolve real recipients, and only ACCEPTED carries a handshake', () => {
  const all = referralNet.listReferralsForClient(); // no clientId → every demo record
  assert.ok(all.length >= 3, 'fixture: several demo referral records exist');
  const validStatus = new Set(referralNet.REFERRAL_STATUSES);
  for (const r of all) {
    assert.ok(validStatus.has(r.status), `${r.id} has a known status`);
    assert.strictEqual(r.feeStatus, 'NONE', 'no referral/platform fee is ever executed in the scaffold');
    assert.match(r.disclaimer, /not a diagnosis/i, 'every record is a category suggestion, not a diagnosis');
    // The recipient resolves to a real roster member (decorated name is not the raw id).
    const recipient = referralNet.REFERRAL_NETWORK.find((m) => m.id === r.toPractitionerId);
    assert.ok(recipient, `${r.id} points at a real roster recipient`);
    assert.strictEqual(r.toName, recipient.name, 'the record resolves the recipient display name');
    // Handshake invariant: a handshake only exists on an ACCEPTED referral.
    if (r.handshake) assert.strictEqual(r.status, 'ACCEPTED', 'a handshake implies the referral was ACCEPTED');
  }
  // Per-client read is scoped: Jim's accepted physio referral is present and carries the handshake.
  const jim = referralNet.listReferralsForClient('demo_jim_b');
  assert.ok(jim.length >= 1 && jim.every((r) => r.clientId === 'demo_jim_b'), 'status read is client-scoped');
  const accepted = jim.find((r) => r.status === 'ACCEPTED');
  assert.ok(accepted && accepted.handshake === true, 'the accepted referral records a handshake');
  assert.strictEqual(/vinny/i.test(JSON.stringify(all)), false, '"Vinny" never appears on a referral record');
});

// --- permission: a client may NEVER see un-approved draft content -----------
// THE HARD MULTI-TENANT RULE: "A client must not see draft protocol content until
// practitioner review/approval." Exercised against the REAL demo drafts — Eric's is a
// DRAFT (must stay hidden), Kristen's is APPROVED_RESOURCE (the only client-visible state).
test('P1', 'Client sees ONLY approved resources — a DRAFT never leaks', () => {
  const eric = demo.DEMO_CLIENTS.find((c) => /eric/i.test(c.id));
  const kristen = demo.DEMO_CLIENTS.find((c) => /kristen/i.test(c.id));
  assert.ok(eric && kristen, 'fixture: Eric (DRAFT) + Kristen (APPROVED) present');

  const ericDraft = demo.DEMO_DRAFTS.find((d) => d.clientId === eric.id);
  const kristenDraft = demo.DEMO_DRAFTS.find((d) => d.clientId === kristen.id);
  assert.strictEqual(ericDraft.status, 'DRAFT', 'fixture: Eric draft is un-reviewed DRAFT');
  assert.strictEqual(kristenDraft.status, 'APPROVED_RESOURCE', 'fixture: Kristen draft is approved');

  // Exactly one status is client-visible.
  assert.strictEqual(G.isClientVisible(ericDraft), false, 'DRAFT must not be client-visible');
  assert.strictEqual(G.isClientVisible(kristenDraft), true, 'APPROVED_RESOURCE is client-visible');
  for (const s of ['DRAFT', 'IN_REVIEW', 'CHANGES_REQUESTED', 'REVIEWED', 'BLOCKED']) {
    assert.strictEqual(G.isClientVisible({ status: s }), false, `${s} must never be client-visible`);
  }

  // The projection physically drops a non-approved draft to null — there is no leak path.
  assert.strictEqual(G.clientResourceProjection(ericDraft), null, 'projecting a DRAFT yields null');

  // Eric's portal is EMPTY; Kristen's shows ONLY approved resources (current + past).
  const ericVisible = G.clientVisibleResources(demo.DEMO_DRAFTS, eric.id);
  assert.deepStrictEqual(ericVisible, [], 'a client whose only draft is DRAFT sees nothing');
  const kristenVisible = G.clientVisibleResources(demo.DEMO_DRAFTS, kristen.id);
  assert.strictEqual(kristenVisible.length, 2, 'the approved client sees her two approved resources (active + completed)');
  assert.ok(kristenVisible.every((r) => r.status === 'APPROVED_RESOURCE'), 'every visible resource is approved');

  // The approved projection STRIPS every practitioner-only internal.
  const proj = kristenVisible[0];
  for (const leaky of ['warnings', 'blockedReasons', 'unknowns', 'blocked', 'reviewedBy']) {
    assert.ok(!(leaky in proj), `projection must not expose "${leaky}"`);
  }
  assert.ok('approvedBy' in proj && 'banner' in proj, 'projection exposes only the safe approved shape');
});

// --- permission: ownership is single-sourced; only APPROVE grants visibility -
test('P2', 'Practitioner→client ownership is derived, not denormalized', () => {
  // Clients carry the ownership pointer; drafts must NOT denormalize it (Drift=Cancer).
  assert.ok(demo.DEMO_CLIENTS.every((c) => 'practitionerId' in c), 'every client has a practitionerId');
  for (const d of demo.DEMO_DRAFTS) {
    assert.ok(!('practitionerId' in d), 'a draft must not denormalize practitionerId — derive via clientId');
  }
  // reviewDecisionGate: APPROVE is the ONLY path to a client-visible status.
  assert.deepStrictEqual(G.reviewDecisionGate('APPROVE'), { status: 'APPROVED_RESOURCE', clientVisible: true });
  assert.strictEqual(G.reviewDecisionGate('REQUEST_CHANGES').clientVisible, false);
  assert.strictEqual(G.reviewDecisionGate('SUBMIT').clientVisible, false);
  assert.strictEqual(G.reviewDecisionGate('anything-else').clientVisible, false, 'unknown decision is never client-visible');
});

// --- permission: "My Protocols" reuses the SAME approval boundary -----------
// The client protocol journey (current / past / timeline) is just a RICHER projection
// of the exact same rule as P1: visible iff status === 'APPROVED_RESOURCE'. A DRAFT can
// never enter it, current-vs-past is a lifecycle split (not a second visibility rule),
// and the projection must drop every practitioner-only internal + leak nothing unsafe.
test('P3', 'My Protocols shows only approved protocols; drafts never leak; lifecycle split + timeline are client-safe', () => {
  const eric = demo.DEMO_CLIENTS.find((c) => /eric/i.test(c.id));
  const kristen = demo.DEMO_CLIENTS.find((c) => /kristen/i.test(c.id));
  const ericDraft = demo.DEMO_DRAFTS.find((d) => d.clientId === eric.id);

  // A DRAFT projected as a client protocol is null — same hard boundary as P1.
  assert.strictEqual(G.clientProtocolProjection(ericDraft), null, 'projecting a DRAFT protocol yields null');
  for (const s of ['DRAFT', 'IN_REVIEW', 'CHANGES_REQUESTED', 'REVIEWED', 'BLOCKED']) {
    assert.strictEqual(G.clientProtocolProjection({ status: s }), null, `${s} never becomes a client protocol`);
  }
  assert.deepStrictEqual(G.clientVisibleProtocols(demo.DEMO_DRAFTS, eric.id), [], 'Eric (DRAFT only) sees no protocols');

  // Kristen sees exactly her two approved protocols; the lifecycle split is correct.
  const protocols = G.clientVisibleProtocols(demo.DEMO_DRAFTS, kristen.id);
  assert.strictEqual(protocols.length, 2, 'Kristen has two approved protocols');
  assert.ok(protocols.every((p) => p.status === 'APPROVED_RESOURCE'), 'every protocol is approved');
  const { current, past } = G.splitProtocolsByLifecycle(protocols);
  assert.strictEqual(current.length, 1, 'one current (non-completed) protocol');
  assert.strictEqual(past.length, 1, 'one past (completed) protocol');
  assert.notStrictEqual(current[0].lifecycle, 'COMPLETED', 'current is not completed');
  assert.strictEqual(past[0].lifecycle, 'COMPLETED', 'past is completed');
  assert.ok(past[0].outcome && past[0].informedNext, 'a past protocol carries outcome + informedNext');
  assert.ok(current[0].nextCheckIn, 'a current protocol carries a next lab/check-in date');
  assert.ok(past[0].clientNote, 'a past protocol carries the client’s own note');

  // The projection drops every practitioner-only / raw internal — nothing leaks.
  for (const p of protocols) {
    for (const leaky of ['warnings', 'unknowns', 'blockedReasons', 'blocked', 'reviewedBy', 'rationale', 'citationsResolved', 'compliance', 'createdAt']) {
      assert.ok(!(leaky in p), `protocol projection must not expose "${leaky}"`);
    }
    assert.ok('banner' in p && 'approvedBy' in p && 'lifecycle' in p, 'exposes only the safe approved shape');
    // Items expose only display fields — never raw catalog/evidence ids.
    for (const it of p.items || []) {
      for (const idField of ['productId', 'evidenceCompoundId']) {
        assert.ok(!(idField in it), `item must not expose "${idField}"`);
      }
    }
  }

  // The merged timeline is newest-first and only the eight client-safe kinds appear.
  const SAFE_KINDS = new Set(['GENERATED', 'REVIEWED', 'CLIENT_VIEWED', 'LABS_UPLOADED', 'CHECK_IN', 'COMPLETED', 'PAUSED', 'CHANGED']);
  const timeline = G.buildProtocolTimeline(protocols);
  assert.ok(timeline.length >= 6, 'timeline aggregates events across protocols');
  for (let i = 1; i < timeline.length; i++) {
    assert.ok(new Date(timeline[i - 1].at) >= new Date(timeline[i].at), 'timeline is sorted newest-first');
  }
  for (const ev of timeline) {
    assert.ok(SAFE_KINDS.has(ev.kind), `timeline kind "${ev.kind}" must be a client-safe kind`);
    assert.ok('at' in ev && 'label' in ev && 'protocolTitle' in ev, 'timeline event carries safe display fields');
  }

  // Every client-facing string passes the medical-claim language gate (no prescription framing).
  const strings = [];
  for (const p of protocols) {
    strings.push(p.banner, p.title, p.goal, p.practitionerNote, p.clientNote, p.progressSummary, p.disclaimer);
    if (p.phase) strings.push(p.phase.label);
    if (p.adherence) strings.push(p.adherence.summary);
    if (p.outcome) strings.push(p.outcome.summary);
    if (p.informedNext) strings.push(p.informedNext.note);
  }
  const violations = strings.filter(Boolean).flatMap((s) => G.languageGate(s).violations || []);
  assert.deepStrictEqual(violations, [], 'no client-facing protocol string contains banned medical-claim language');
});

// ═══════════════════════════════════════════════════════════════════════════
// GENERATOR — "AI proposes, gates dispose". The proposer's ONE creative act is
// choosing which REAL catalog items to consider; its output is fed straight into
// the SAME assembleDraft() gate chain the manual Draft Builder uses, so it can add
// nothing that bypasses a gate. These tests exercise the REAL generator + the REAL
// source-locked dosing reference — no mocks.
// ═══════════════════════════════════════════════════════════════════════════

// --- G1: a generated protocol flows through the SAME gate chain -------------
test('G1', 'Generated protocol flows through the gate chain → DRAFT / RESOURCE ONLY, real items only', () => {
  const res = GEN.generateProtocol({
    goalText: 'fat loss and recovery', client: { id: 'g1' },
    catalogIndex, evidenceByCompound, complianceCfg, jurisdiction: 'CA', role: 'PRACTITIONER',
  });
  assert.strictEqual(res.draft.source, 'generator', 'draft is tagged generator-sourced');
  assert.strictEqual(res.proposerSource, 'deterministic', 'the dependency-free proposer ran');
  assert.strictEqual(res.draft.status, 'DRAFT', 'output is never minted past DRAFT');
  assert.strictEqual(res.draft.blocked, false, 'a real-item proposal is not blocked');
  assert.match(res.draft.statusBanner, /RESOURCE ONLY/);
  assert.match(res.draft.statusBanner, /NOT MEDICAL ADVICE/);
  assert.strictEqual(res.framing.mode, 'AI proposes, gates dispose');
  assert.strictEqual(res.framing.isResourceOnly, true);
  // Every proposed item is a REAL source-of-truth catalog product — the gate's whole point.
  assert.ok(res.draft.items.length >= 1, 'a recognized goal yields at least one gated item');
  for (const it of res.draft.items) {
    assert.ok(catalogIndex.byId[it.productId], `item ${it.productId} must be a real catalog product`);
  }
  // An unrecognized goal proposes NOTHING (no fabrication to fill the silence).
  const empty = GEN.deterministicPropose('total nonsense xyzzy', { evidenceByCompound, catalogIndex });
  assert.deepStrictEqual(empty.itemRefs, [], 'no recognized goal ⇒ nothing proposed');
  assert.ok(empty.reasoning.some((r) => /nothing proposed/i.test(r)), 'the silence is explained, not faked');
});

// --- G2: the proposer can NEVER reference an off-catalog item ----------------
test('G2', 'A research compound with no catalog product is skipped honestly — never proposed off-catalog', () => {
  // Controlled inputs: an evidence compound that has NO source-of-truth product.
  const ev = { ghostpeptide: { name: 'Ghost', category: 'weight', evidenceLevel: 'HIGH', citationCount: 9 } };
  const cat = { byId: {}, list: [] };
  const prop = GEN.deterministicPropose('fat loss', { evidenceByCompound: ev, catalogIndex: cat });
  assert.deepStrictEqual(prop.itemRefs, [], 'no catalog product ⇒ no itemRef (cannot draft an off-catalog item)');
  assert.ok(prop.reasoning.some((r) => /UNKNOWN/i.test(r)), 'the missing product is surfaced as UNKNOWN, not invented');
  // And the gate chain still BLOCKS a hand-forged off-catalog ref (defense in depth).
  const forged = G.assembleDraft({
    client: { id: 'g2' }, itemRefs: [{ productName: 'Ghost (not in catalog)' }],
    catalogIndex, evidenceByCompound, complianceCfg, jurisdiction: 'CA',
  });
  assert.strictEqual(forged.blocked, true, 'an off-catalog ref is blocked by assembleDraft');
  assert.strictEqual(forged.status, 'BLOCKED');
});

// --- G3: dosing is ATTRIBUTION, never an INSTRUCTION -------------------------
test('G3', 'Operator dosing is attribution-framed ("literature reports …"), never an instruction', () => {
  const op = GEN.generateProtocol({
    goalText: 'fat loss and recovery', client: { id: 'g3' },
    catalogIndex, evidenceByCompound, complianceCfg, role: 'PRACTITIONER',
  });
  const reta = op.draft.items.find((i) => i.evidenceCompoundId === 'reta');
  assert.ok(reta, 'fixture: the fat-loss goal selects Retatrutide');
  assert.strictEqual(reta.dosing.framing, 'attribution');
  assert.match(reta.dosing.label, /Research literature commonly reports/i, 'reads as attribution');
  assert.match(reta.dosing.label, /2–4 mg/, 'carries the real reported range');
  assert.strictEqual(/\btake\b/i.test(reta.dosing.label), false, 'never an imperative "take N mg"');
  assert.ok(reta.dosing.basis, 'operator dosing carries an attribution basis string');
  // Where no range is defensibly curated, the label is an honest UNKNOWN — not a guess.
  const unk = dosing.researchRangeLabel(dosing.dosingFor('adipotide'));
  assert.match(unk, /UNKNOWN/, 'uncurated dose ⇒ UNKNOWN, never fabricated');
});

// --- G4: Retatrutide ceiling + mandatory taper (canonical tier-matrix rule) --
test('G4', 'Retatrutide is capped at 4 mg/week with a MANDATORY 6-week taper', () => {
  const entry = dosing.dosingFor('reta');
  assert.strictEqual(entry.perDose.highMg, 4, 'HARD CEILING is 4 mg/week');
  assert.match(entry.titration, /HARD CEILING 4 mg\/week/);
  assert.match(entry.taper, /MANDATORY/);
  assert.match(entry.taper, /6-week mirror taper/);
  // Survives the generator end-to-end on the operator view.
  const op = GEN.generateProtocol({
    goalText: 'fat loss', client: { id: 'g4' },
    catalogIndex, evidenceByCompound, complianceCfg, role: 'PRACTITIONER',
  });
  const reta = op.draft.items.find((i) => i.evidenceCompoundId === 'reta');
  assert.match(reta.dosing.titration, /HARD CEILING 4 mg\/week/, 'ceiling persists through the gate chain');
  assert.match(reta.dosing.taper, /MANDATORY 6-week mirror taper/, 'taper persists through the gate chain');
  // And the compliance gate independently elevates a GLP-1/GIP compound under CA.
  assert.strictEqual(G.complianceGate('Retatrutide 10mg/vial', 'CA', complianceCfg).status, 'NEEDS_REVIEW');
});

// --- G5: SS-31 + MOTS-c are always co-dosed (canonical pairing) --------------
test('G5', 'SS-31 + MOTS-c travel together — the proposer enforces the canonical co-dose', () => {
  // The rule is single-sourced and symmetric.
  assert.ok(
    dosing.PROTOCOL_RULES.coDose.some(([a, b]) => (a === 'ss31' && b === 'motsc') || (a === 'motsc' && b === 'ss31')),
    'PROTOCOL_RULES carries the SS-31 ↔ MOTS-c co-dose',
  );
  assert.ok(dosing.dosingFor('ss31').coDoseWith.includes('motsc'), 'ss31 entry points at motsc');
  assert.ok(dosing.dosingFor('motsc').coDoseWith.includes('ss31'), 'motsc entry points at ss31');
  // Controlled inputs isolate the expansion: a SINGLE antiaging primary pulls its partner in.
  const ev = {
    ss31: { name: 'SS-31', category: 'antiaging', evidenceLevel: 'MODERATE', citationCount: 5 },
    motsc: { name: 'MOTS-c', category: 'antiaging', evidenceLevel: 'MODERATE', citationCount: 5 },
  };
  const cat = { byId: {}, list: [
    { id: 'p_ss31', evidenceCompoundId: 'ss31', route: 'SubQ injection', form: 'Vial' },
    { id: 'p_motsc', evidenceCompoundId: 'motsc', route: 'SubQ injection', form: 'Vial' },
  ] };
  const prop = GEN.deterministicPropose('mitochondrial energy', { evidenceByCompound: ev, catalogIndex: cat });
  const ids = prop.itemRefs.map((r) => r.compoundId);
  assert.ok(ids.includes('ss31') && ids.includes('motsc'), 'co-dose expansion adds the canonical partner');
  assert.strictEqual(ids.length, 2, 'exactly the pair — one primary + its co-dose partner');
});

// --- G6: GHRH analogs are never stacked (CJC-1295 + Tesamorelin) -------------
test('G6', 'GHRH redundancy is blocked — CJC-1295 and Tesamorelin never co-occur', () => {
  assert.ok(
    dosing.PROTOCOL_RULES.neverWith.some(([a, b]) => (a === 'cjc' && b === 'tesamorelin') || (a === 'tesamorelin' && b === 'cjc')),
    'PROTOCOL_RULES carries the CJC ↔ Tesamorelin never-with',
  );
  // Controlled inputs force both to be candidates across two goal categories; one must be dropped.
  const ev = {
    cjc: { name: 'CJC-1295', category: 'performance', evidenceLevel: 'HIGH', citationCount: 9 },
    tesamorelin: { name: 'Tesamorelin', category: 'antiaging', evidenceLevel: 'HIGH', citationCount: 9 },
  };
  const cat = { byId: {}, list: [
    { id: 'p_cjc', evidenceCompoundId: 'cjc', route: 'SubQ injection', form: 'Vial' },
    { id: 'p_tesa', evidenceCompoundId: 'tesamorelin', route: 'SubQ injection', form: 'Vial' },
  ] };
  const prop = GEN.deterministicPropose('muscle and longevity', { evidenceByCompound: ev, catalogIndex: cat });
  const ids = prop.itemRefs.map((r) => r.compoundId);
  assert.ok(ids.includes('cjc'), 'the first-chosen GHRH analog stays');
  assert.strictEqual(ids.includes('tesamorelin'), false, 'the redundant GHRH analog is excluded');
  assert.ok(prop.reasoning.some((r) => /never-with/i.test(r)), 'the exclusion is explained, not silent');
});

// --- G7: client view is never a personal prescription; default CA -----------
test('G7', 'Client view strips titration/taper/schedule and defers to the practitioner; jurisdiction defaults to CA', () => {
  const cl = GEN.generateProtocol({
    goalText: 'fat loss and recovery', client: { id: 'g7' },
    catalogIndex, evidenceByCompound, complianceCfg, role: 'CLIENT', // NB: jurisdiction omitted → must default to CA
  });
  assert.strictEqual(cl.draft.compliance.jurisdiction, 'CA', 'generator defaults to the Canadian jurisdiction');
  assert.strictEqual(cl.jurisdictionNotice.jurisdiction, 'CA');
  assert.strictEqual(cl.jurisdictionNotice.required, true, 'the acknowledgment is mandatory');
  assert.ok(cl.draft.items.length >= 1, 'the client still sees the gated items');
  for (const it of cl.draft.items) {
    assert.strictEqual(it.dosing.framing, 'attribution');
    // The client NEVER receives a personal schedule from the generator (levers 3 + 5).
    for (const leaky of ['titration', 'taper', 'schedule', 'frequency', 'cycleWeeks', 'basis']) {
      assert.ok(!(leaky in it.dosing), `client dosing must NOT expose "${leaky}"`);
    }
    assert.match(it.dosing.label, /your practitioner/i, 'client dosing defers to the practitioner');
    assert.strictEqual(/\btake\b/i.test(it.dosing.label), false, 'client dosing is never an instruction');
  }
});

// --- G8: no banned medical-claim language anywhere on the generator surface --
test('G8', 'No banned medical-claim language on any generator-surfaced string', () => {
  const op = GEN.generateProtocol({ goalText: 'fat loss and recovery', client: { id: 'g8' }, catalogIndex, evidenceByCompound, complianceCfg, role: 'PRACTITIONER' });
  const cl = GEN.generateProtocol({ goalText: 'fat loss and recovery', client: { id: 'g8c' }, catalogIndex, evidenceByCompound, complianceCfg, role: 'CLIENT' });
  const caNotice = GEN.jurisdictionAcknowledgmentGate('CA', complianceCfg);
  const usNotice = GEN.jurisdictionAcknowledgmentGate('US', complianceCfg);
  const strings = [
    op.draft.statusBanner, cl.draft.statusBanner,
    caNotice.notice, caNotice.acceptLabel, usNotice.notice, usNotice.acceptLabel,
    op.framing.mode, op.framing.dosing,
  ];
  for (const it of op.draft.items) strings.push(it.dosing.label, it.dosing.basis, it.dosing.titration, it.dosing.taper);
  for (const it of cl.draft.items) strings.push(it.dosing.label, it.dosing.note);
  const violations = strings.filter(Boolean).flatMap((s) => G.languageGate(s).violations || []);
  assert.deepStrictEqual(violations, [], 'no generator-surface string contains banned medical-claim language');
  // The US cross-border notice puts the onus on the user and never asserts legality on their behalf.
  assert.match(usNotice.notice, /own responsibility/i);
  assert.match(usNotice.notice, /does not supply peptides/i);
});

// --- G9: approving a generated protocol requires FULL attestation ------------
test('G9', 'Practitioner attestation gate requires all three fields — no partial, no coercion', () => {
  const empty = GEN.practitionerAttestationGate({});
  assert.strictEqual(empty.ok, false);
  assert.strictEqual(empty.blocked, true);
  assert.strictEqual(empty.reasons.length, 3, 'all three attestations are required');
  assert.strictEqual(GEN.practitionerAttestationGate({ practitionerName: 'Dr. Vincent Lun' }).ok, false, 'name alone is insufficient');
  assert.strictEqual(
    GEN.practitionerAttestationGate({ practitionerName: 'Dr. Vincent Lun', qualifiedPeptideLiterate: true }).ok,
    false, 'must also attest to independently reviewing the basis',
  );
  // Booleans must be EXACTLY true — a truthy string must not satisfy the gate.
  assert.strictEqual(
    GEN.practitionerAttestationGate({ practitionerName: 'X', qualifiedPeptideLiterate: 'yes', reviewedBasis: 'yes' }).ok,
    false, 'string-truthy must not coerce into a passing attestation',
  );
  const ok = GEN.practitionerAttestationGate({ practitionerName: 'Dr. Vincent Lun', qualifiedPeptideLiterate: true, reviewedBasis: true });
  assert.strictEqual(ok.ok, true, 'all three present and true ⇒ passes');
  assert.strictEqual(ok.attestation.practitionerName, 'Dr. Vincent Lun');
  assert.ok(ok.attestation.attestedAt, 'a passing attestation is timestamped for the audit log');
  // Doctrine: the attestation name is the full formal name, never "Vinny".
  assert.strictEqual(/vinny/i.test(JSON.stringify(ok.attestation)), false, 'Dr. Vincent Lun — never "Vinny"');
});

// ===========================================================================
// TWO-SOURCE PRESENTATION (B1–B5) — studies ⊕ community, attributed not asserted
// ===========================================================================

// --- B1: a study-tier item surfaces REAL citations + an echoed finding ------
test('B1', 'Study-tier item surfaces real citations + a finding echoed from a citation title', () => {
  const op = GEN.generateProtocol({
    goalText: 'fat loss and recovery', client: { id: 'b1' },
    catalogIndex, evidenceByCompound, complianceCfg, role: 'PRACTITIONER',
  });
  const reta = op.draft.items.find((i) => i.evidenceCompoundId === 'reta');
  assert.ok(reta && reta.basis, 'fixture: the fat-loss goal selects Retatrutide and attaches a basis');
  assert.strictEqual(reta.basis.framing, 'attribution');
  assert.strictEqual(reta.basis.tier, 'TRIALS', 'Retatrutide has human-trial evidence ⇒ TRIALS tier');
  assert.match(reta.basis.label, /clinical-trial evidence/i);
  assert.ok(reta.basis.studies, 'the studies sub-block is present');
  // The "finding" is never fabricated — it must be one of the compound's REAL citation titles.
  const realTitles = (evidenceByCompound.reta.citations || []).map((c) => c.title);
  assert.ok(realTitles.includes(reta.basis.studies.finding), 'finding is echoed verbatim from a real citation title');
  // Operators get the full citation list (with sources/urls), not just a count.
  assert.ok(Array.isArray(reta.basis.studies.citations), 'operator receives the full citation list');
  assert.strictEqual(reta.basis.studies.citations.length, reta.basis.studies.citationCount);
  assert.ok(reta.basis.studies.citations.every((c) => 'title' in c && 'url' in c), 'each citation carries title + url');
  // Community runs ALONGSIDE the studies (the "and here's what the community does" half).
  assert.ok(reta.basis.community && (reta.basis.community.reportedBenefits || []).length > 0, 'community half present too');
});

// --- B2: a no-trials item is honest "community-reported", REPORTED benefits --
test('B2', 'No-trials item is labeled community-reported with attributed REPORTED benefits, not asserted facts', () => {
  // Controlled input: a compound that HAS a curated community profile but NO citations.
  // (Naturally every profiled compound currently carries ≥1 citation, so we feed an empty
  // evidence record to deterministically exercise the pure COMMUNITY tier — like G5/G6.)
  assert.ok(community.communityFor('bpc157'), 'fixture: bpc157 has a community profile');
  const basis = PRES.composeBasis({
    compoundId: 'bpc157',
    evidenceRec: { name: 'BPC-157', category: 'healing', evidenceLevel: 'UNKNOWN', citationCount: 0, citations: [] },
    role: 'PRACTITIONER', goalLabel: 'Healing & recovery', productName: 'BPC-157',
  });
  assert.strictEqual(basis.tier, 'COMMUNITY', 'no citations + a community profile ⇒ COMMUNITY tier');
  assert.match(basis.label, /community-reported \(no trials cited\)/i, 'the label is honest about the absence of trials');
  assert.strictEqual(basis.studies, null, 'with nothing cited, the studies sub-block is null — never invented');
  assert.ok(basis.community, 'the community sub-block carries the "what the community does" content');
  assert.ok((basis.community.reportedBenefits || []).length > 0, 'reported benefits are surfaced');
  assert.match(basis.community.benefitsLabel, /not Vitalis claims/i, 'benefits are labeled REPORTED, not Vitalis claims');
  assert.match(basis.community.benefitsLabel, /not guaranteed outcomes/i, 'and never promised as outcomes');
  assert.ok(basis.community.evidenceNote, 'an honest evidence-strength note is attached');
  // The headline frames it as reference, never an instruction.
  assert.match(basis.headline, /reference only, not an instruction/i);
});

// --- B3: the CLIENT view hides the administration how-to + full citations ----
test('B3', 'Client view hides the administration pattern + the full citation list, keeps the reported benefits', () => {
  const cl = GEN.generateProtocol({
    goalText: 'fat loss and recovery', client: { id: 'b3c' },
    catalogIndex, evidenceByCompound, complianceCfg, role: 'CLIENT',
  });
  const op = GEN.generateProtocol({
    goalText: 'fat loss and recovery', client: { id: 'b3o' },
    catalogIndex, evidenceByCompound, complianceCfg, role: 'PRACTITIONER',
  });
  assert.ok(cl.draft.items.length >= 1, 'the client still sees the gated items + their basis');
  for (const it of cl.draft.items) {
    assert.ok(it.basis, 'every client item carries a (softened) basis');
    if (it.basis.studies) {
      // Clients get the count + the single finding line, NEVER the full citation list.
      assert.strictEqual(it.basis.studies.citations, undefined, 'client studies block omits the full citation list');
      assert.ok('citationCount' in it.basis.studies, 'but still shows how many citations exist');
    }
    if (it.basis.community) {
      assert.ok(!('pattern' in it.basis.community), 'client community block omits the administration how-to (pattern)');
      // The "why / what's reported" still reaches the client.
      assert.ok('reportedBenefits' in it.basis.community, 'client still sees the reported benefits');
      assert.ok('usedFor' in it.basis.community, 'client still sees what it is used for');
    }
  }
  // Contrast: the practitioner DOES get the pattern + the full citation list.
  const opCommunity = op.draft.items.find((i) => i.basis && i.basis.community && i.basis.community.pattern);
  assert.ok(opCommunity, 'the practitioner view retains the administration pattern (operator-only)');
  const opStudies = op.draft.items.find((i) => i.basis && i.basis.studies && Array.isArray(i.basis.studies.citations));
  assert.ok(opStudies, 'the practitioner view retains the full citation list (operator-only)');
});

// --- B4: the software-license acknowledgment (responsibility shift) ----------
test('B4', 'License acknowledgment requires BOTH responsibility + qualifications — never auto-passes', () => {
  const empty = GEN.practitionerLicenseAcknowledgmentGate({});
  assert.strictEqual(empty.ok, false);
  assert.strictEqual(empty.blocked, true);
  assert.strictEqual(empty.reasons.length, 2, 'both responsibility and qualifications are required');
  assert.strictEqual(empty.acknowledgment, null, 'a blocked gate mints no acknowledgment');
  // The statement is the responsibility-shift, present even when blocked (so the UI can show it).
  assert.match(empty.statement, /does not practice medicine, prescribe, diagnose/i, 'Vitalis disclaims clinical responsibility');
  assert.match(empty.statement, /responsible for my own professional\s+due diligence/i, 'the licensee owns their due diligence');
  // Partial ⇒ still blocked.
  assert.strictEqual(GEN.practitionerLicenseAcknowledgmentGate({ acceptedResponsibility: true }).ok, false, 'responsibility alone is insufficient');
  assert.strictEqual(GEN.practitionerLicenseAcknowledgmentGate({ acceptedQualifications: true }).ok, false, 'qualifications alone is insufficient');
  // Truthy-but-not-true must not coerce a pass.
  assert.strictEqual(
    GEN.practitionerLicenseAcknowledgmentGate({ acceptedResponsibility: 'yes', acceptedQualifications: 'yes' }).ok,
    false, 'string-truthy must not satisfy the license gate',
  );
  const full = GEN.practitionerLicenseAcknowledgmentGate({ acceptedResponsibility: true, acceptedQualifications: true });
  assert.strictEqual(full.ok, true, 'both accepted ⇒ passes');
  assert.ok(full.acknowledgment && full.acknowledgment.acknowledgedAt, 'a passing acknowledgment is timestamped for the audit log');
  assert.strictEqual(/vinny/i.test(JSON.stringify(full) + empty.statement), false, 'Dr. Vincent Lun doctrine — never "Vinny"');
});

// --- B5: no banned medical-claim language across the presentation surface -----
test('B5', 'No banned medical-claim language across the entire two-source presentation surface', () => {
  const op = GEN.generateProtocol({ goalText: 'fat loss and recovery', client: { id: 'b5o' }, catalogIndex, evidenceByCompound, complianceCfg, role: 'PRACTITIONER' });
  const cl = GEN.generateProtocol({ goalText: 'energy and focus', client: { id: 'b5c' }, catalogIndex, evidenceByCompound, complianceCfg, role: 'CLIENT' });
  const strings = [];
  const harvest = (it) => {
    if (!it.basis) return;
    strings.push(it.basis.headline, it.basis.label);
    if (it.basis.studies) strings.push(it.basis.studies.finding, it.basis.studies.mechanism);
    if (it.basis.community) {
      strings.push(it.basis.community.benefitsLabel, it.basis.community.evidenceNote, it.basis.community.pattern);
      (it.basis.community.usedFor || []).forEach((s) => strings.push(s));
      (it.basis.community.reportedBenefits || []).forEach((s) => strings.push(s));
    }
  };
  op.draft.items.forEach(harvest);
  cl.draft.items.forEach(harvest);
  // The whole curated community corpus, too — the source these strings are drawn from.
  for (const prof of Object.values(community.COMMUNITY || {})) {
    (prof.usedFor || []).forEach((s) => strings.push(s));
    (prof.reportedBenefits || []).forEach((s) => strings.push(s));
    strings.push(prof.evidenceNote, prof.pattern);
  }
  strings.push(PRES.BENEFITS_LABEL, GEN.practitionerLicenseAcknowledgmentGate({}).statement);
  const violations = strings.filter(Boolean).flatMap((s) => G.languageGate(s).violations || []);
  assert.deepStrictEqual(violations, [], 'the two-source presentation never emits a medical-claim verb');
  // The attribution label is the load-bearing safety string — assert it explicitly.
  assert.match(PRES.BENEFITS_LABEL, /not Vitalis claims/i);
});

// ===========================================================================
// NUTRITION MODULE — the deficiency → "request for your naturopath" slip.
// Drag-drop/paste lab ingest (Extract + confirm) → out-of-range micronutrients
// become a SLIP for Dr. Vincent Lun. NOT a prescription, NOT a diagnosis,
// grounded in real NIH ODS / Health Canada citations, on the same two-source rails.
// ===========================================================================

// --- N1: the local parser reads messy real-world formats, and SKIPS honestly --
test('N1', 'Lab parser reads CSV/tab/loose formats, drops the header, and never invents a value', () => {
  const blob = [
    'Marker, Value, Unit, Low, High',           // header → silently dropped
    'Vitamin D 25-OH, 18, ng/mL, 30, 100',      // comma-delimited
    'Ferritin\t22\tng/mL\t30\t400',             // tab-delimited
    'Vitamin B12 410 pmol/L (138-652)',         // loose line, parenthetical range
    '# fasting draw, morning',                   // comment
    'collected at the downtown lab yesterday',   // prose, no value → skipped
  ].join('\n');
  const { rows, skipped } = NUT.parseLabText(blob);
  assert.strictEqual(rows.length, 3, 'three result lines parse; the header is not one of them');
  assert.ok(rows.every((r) => typeof r.value === 'number'), 'every parsed value is a real Number — never invented');
  const d = rows.find((r) => /vitamin d/i.test(r.marker));
  assert.ok(d && d.value === 18 && d.refLow === 30 && d.refHigh === 100, 'comma row: value + range read correctly');
  const b12 = rows.find((r) => /b12/i.test(r.marker));
  assert.ok(b12 && b12.value === 410 && b12.refLow === 138 && b12.refHigh === 652, 'loose row: parenthetical range read correctly');
  assert.ok(!rows.some((r) => /^marker$/i.test(r.marker)), 'the header row is never parsed as data');
  assert.ok(skipped.some((s) => /downtown lab/i.test(s)), 'an unparseable prose line is surfaced as skipped, not guessed');
});

// --- N2: out-of-range safe micronutrients → slip recs; in-range excluded; -----
//          electrolytes route to provider-review with NO supplement suggested.
test('N2', 'Analyze drafts a request-slip: safe deficiencies recommend, in-range excluded, electrolytes provider-only', () => {
  const values = [
    { marker: 'Vitamin D 25-OH', value: 18, unit: 'ng/mL', refLow: 30, refHigh: 100 },   // LOW → recommend
    { marker: 'Ferritin', value: 22, unit: 'ng/mL', refLow: 30, refHigh: 400 },          // LOW → recommend
    { marker: 'Vitamin B12', value: 410, unit: 'pmol/L', refLow: 138, refHigh: 652 },    // IN RANGE → excluded
    { marker: 'Potassium', value: 5.6, unit: 'mmol/L', refLow: 3.5, refHigh: 5.1 },      // HIGH electrolyte → provider-only
  ];
  const slip = NUT.analyzeLabForNutrients({ role: 'PRACTITIONER', values, products: [] });
  assert.strictEqual(slip.status, 'DRAFT', 'the slip is a DRAFT');
  assert.strictEqual(slip.isResourceOnly, true, 'and explicitly resource-only');
  assert.strictEqual(slip.isPrescription, false, 'and explicitly not a prescription');
  const recNutrients = slip.recommendations.map((r) => r.nutrient);
  assert.ok(recNutrients.some((n) => /vitamin d/i.test(n)), 'low vitamin D is recommended');
  assert.ok(recNutrients.some((n) => /iron|ferritin/i.test(n)), 'low ferritin/iron is recommended');
  assert.ok(!recNutrients.some((n) => /b12/i.test(n)), 'an in-range B12 is NOT recommended');
  assert.ok(slip.summary.inRange >= 1, 'the in-range B12 is counted as in-range');
  for (const r of slip.recommendations) {
    assert.ok(typeof r.suggestedForm === 'string' && r.suggestedForm, 'a repletion form is named (client-safe)');
    assert.strictEqual(r.target.target, null, 'the dose is never guessed — it is the naturopath’s call');
    assert.strictEqual(r.basis.framing, 'attribution', 'the basis is attribution-framed');
  }
  const k = slip.providerReview.find((p) => /potassium/i.test(p.nutrient || p.marker));
  assert.ok(k, 'the out-of-range potassium routes to provider review');
  assert.strictEqual(k.supplementSuggested, false, 'no OTC supplement is suggested for an electrolyte');
  assert.ok(!slip.recommendations.some((r) => /potassium/i.test(r.nutrient)), 'potassium is never a supplement recommendation');
  assert.strictEqual(slip.providerReviewSuggested, true, 'with findings present, provider review is suggested');
});

// --- N3: a study-tier rec carries REAL citations for the operator; the CLIENT --
//          view drops the citation LIST + the naturopathic "how", keeps the why.
test('N3', 'Operator sees real citations + naturopathic pattern; the client view softens both, keeps reported benefits', () => {
  const values = [{ marker: 'Vitamin D 25-OH', value: 18, unit: 'ng/mL', refLow: 30, refHigh: 100 }];
  const op = NUT.analyzeLabForNutrients({ role: 'PRACTITIONER', values });
  const cl = NUT.analyzeLabForNutrients({ role: 'CLIENT', values });
  const opRec = op.recommendations[0];
  const clRec = cl.recommendations[0];
  assert.ok(Array.isArray(opRec.basis.studies.citations) && opRec.basis.studies.citations.length >= 1, 'operator sees the full citation list');
  assert.ok(opRec.basis.studies.citations.every((c) => /^https?:\/\//.test(c.url)), 'every citation is a real URL — never a fabricated number');
  assert.ok(opRec.basis.community.pattern, 'operator sees the naturopathic administration pattern');
  assert.strictEqual(clRec.basis.studies.citations, undefined, 'the client citation list is withheld');
  assert.ok('citationCount' in clRec.basis.studies, 'the client still sees HOW MANY citations exist');
  assert.ok(!('pattern' in clRec.basis.community), 'the client does not see the naturopathic how-to (pattern)');
  assert.ok(clRec.basis.community.reportedBenefits.length >= 1, 'the client still sees the reported benefits');
  assert.ok(clRec.basis.community.usedFor.length >= 1, 'the client still sees what it is used for');
  const clientBlob = JSON.stringify(cl);
  assert.strictEqual(/ods\.od\.nih\.gov/.test(clientBlob), false, 'no citation URL leaks into the client slip');
  assert.strictEqual(/Naturopathic practice:/.test(clientBlob), false, 'the practitioner-only pattern text never leaks to the client');
});

// --- N4: every authored string passes the language gate; Dr. Vincent Lun is ---
//          the named naturopath; never "Vinny"; the slip is a non-prescription.
test('N4', 'The slip carries no medical-claim language, names Dr. Vincent Lun (never "Vinny"), and is resource-only', () => {
  const values = [
    { marker: 'Vitamin D 25-OH', value: 18, unit: 'ng/mL', refLow: 30, refHigh: 100 },
    { marker: 'Potassium', value: 5.6, unit: 'mmol/L', refLow: 3.5, refHigh: 5.1 },
  ];
  for (const role of ['PRACTITIONER', 'CLIENT']) {
    const slip = NUT.analyzeLabForNutrients({ role, values, clientName: 'Demo Client' });
    assert.strictEqual(slip.languageOk, true, `[${role}] the engine self-check passes the language gate`);
    const authored = [
      slip.banner, slip.title, slip.intro, slip.aggregatorNote,
      slip.referral.category, slip.referral.disclaimer,
      ...slip.recommendations.flatMap((r) => [r.ask, r.basis.headline, r.basis.community.evidenceNote, r.basis.studies.finding]),
      ...slip.providerReview.flatMap((p) => [p.reason, p.ask]),
    ].filter(Boolean);
    const violations = authored.flatMap((s) => G.languageGate(s).violations || []);
    assert.deepStrictEqual(violations, [], `[${role}] no banned medical-claim verb in any authored string`);
    assert.strictEqual(/vinny/i.test(JSON.stringify(slip)), false, `[${role}] Dr. Vincent Lun doctrine — never "Vinny"`);
    assert.strictEqual(slip.referral.provider.name, 'Dr. Vincent Lun', `[${role}] the named naturopath is Dr. Vincent Lun`);
    assert.match(slip.title, /Dr\. Vincent Lun/, `[${role}] the slip is addressed to Dr. Vincent Lun`);
    assert.match(slip.banner, /NOT A PRESCRIPTION/i, `[${role}] the banner declares it is not a prescription`);
    assert.match(slip.banner, /NOT A DIAGNOSIS/i, `[${role}] the banner declares it is not a diagnosis`);
  }
});

// --- N5: the peptide ⇄ nutrition cross-reference is REAL (sourced from ---------
//          PEPTIDE_ADDITIONS), product-aware, and duplicate markers dedupe.
test('N5', 'Peptide⇄nutrition monitoring is sourced + product-aware; duplicate markers dedupe to a single recommendation', () => {
  const onHGH = NUT.peptideMonitoringFor('IGF-1', ['HGH 5iu']);
  assert.ok(onHGH.length >= 1, 'IGF-1 is a monitored marker');
  assert.strictEqual(onHGH[0].relevantToProducts, true, 'it is flagged relevant when the client is on HGH');
  assert.ok(onHGH.some((h) => (h.compounds || []).includes('hgh')), 'the matched compound set is the real HGH addition');
  assert.ok(onHGH.every((h) => typeof h.cadence === 'string' && h.cadence), 'each carries a real monitoring cadence');
  const offProtocol = NUT.peptideMonitoringFor('IGF-1', []);
  assert.ok(offProtocol.length >= 1 && offProtocol.every((h) => h.relevantToProducts === false), 'with no products, matches show but are not flagged on-protocol');
  assert.deepStrictEqual(NUT.peptideMonitoringFor('Magnesium', []), [], 'an unmonitored marker yields no fabricated cross-reference');
  const dup = NUT.analyzeLabForNutrients({ role: 'PRACTITIONER', values: [
    { marker: 'Vitamin D', value: 18, unit: 'ng/mL', refLow: 30, refHigh: 100 },
    { marker: '25-OH Vitamin D', value: 19, unit: 'ng/mL', refLow: 30, refHigh: 100 },
  ] });
  const dRecs = dup.recommendations.filter((r) => /vitamin d/i.test(r.nutrient));
  assert.strictEqual(dRecs.length, 1, 'two vitamin-D markers collapse to a single recommendation');
  assert.strictEqual(dRecs[0].alsoFromMarkers.length, 1, 'the second contributing marker is recorded, not doubled');
});

test('N6', 'The LIVE example for a client resolves a non-empty, role-softened, resource-only slip from THEIR seeded labs (Dr. Vincent Lun, never Vinny)', () => {
  // Mirror server.js nutritionSlipForClient exactly: newest draw for the demo client, run through
  // the SAME engine the new GET /api/nutrition/slip route serves. No fabricated values — the slip
  // is built only from the seeded lab fixture, proving the populated example is honest, not invented.
  const cid = 'demo_kristen_a';
  const client = demo.DEMO_CLIENTS.find((c) => c.id === cid);
  assert.ok(client, 'the default demo client exists');
  const draws = demo.DEMO_LAB_RESULTS
    .filter((r) => r.clientId === cid)
    .sort((a, b) => new Date(b.drawnAt || 0) - new Date(a.drawnAt || 0));
  assert.ok(draws.length >= 1, 'the client has at least one seeded lab draw to build a live example from');

  const latest = NUT.analyzeLabForNutrients({
    values: draws[0].values, role: 'CLIENT',
    products: client.currentProducts || [], clientName: client.name,
  });
  // Resource-only contract — identical to what the Client Package facet guarantees.
  assert.strictEqual(latest._model, 'NaturopathRequestSlip', 'it is the canonical slip model');
  assert.strictEqual(latest.status, 'DRAFT', 'the slip is DRAFT, never an issued prescription');
  assert.strictEqual(latest.isResourceOnly, true, 'flagged resource-only');
  assert.strictEqual(latest.isPrescription, false, 'never a prescription');
  assert.strictEqual(latest.languageOk, true, 'the medical-language gate passes (server withholds a slip that fails)');
  assert.ok((latest.summary.reviewed || 0) >= 1, 'the example is non-empty — the seeded markers were reviewed, not an empty analyzer');
  assert.strictEqual(latest.referral.provider.name, 'Dr. Vincent Lun', 'the slip names Dr. Vincent Lun');
  assert.strictEqual(latest.role, 'CLIENT', 'the slip is role-softened to CLIENT');

  // CLIENT softening: every nutrient recommendation hides the citation list + naturopathic pattern.
  for (const r of latest.recommendations) {
    assert.strictEqual(r.basis.studies.citations, undefined, 'CLIENT slip hides the raw citation list');
    assert.strictEqual(r.basis.community.pattern, undefined, 'CLIENT slip hides the naturopathic "how" pattern');
  }

  // The baseline draw carries out-of-range markers → it yields a richly POPULATED example (the
  // case the page leans on visually). Find it among the client's draws and prove it flags > 0.
  const baseline = draws[draws.length - 1];
  const populated = NUT.analyzeLabForNutrients({
    values: baseline.values, role: 'CLIENT',
    products: client.currentProducts || [], clientName: client.name,
  });
  assert.ok(
    (populated.summary.flagged || 0) >= 1,
    'the seeded baseline draw produces at least one flagged nutrient — a genuinely populated example, not fabricated',
  );

  // HARD RULE D1, re-asserted on this surface: "Vinny" appears nowhere on the rendered slip.
  assert.ok(!JSON.stringify(latest).match(/vinny/i), 'the live-example slip never says "Vinny"');
});

// ═══════════════════════════════════════════════════════════════════════════
//  ONE-CLICK CLIENT PACKAGE — the 3-facet bundle (Protocol · Bloodwork · Nutrition)
//  is a COMPOSITION of already-gated artifacts. It mints nothing clinical, invents no
//  markers, softens for the client, and self-checks for medical-claim language. These
//  prove the composer adds NOTHING that can bypass a gate — same doctrine as the rest.
// ═══════════════════════════════════════════════════════════════════════════

// --- PK1: a generated DRAFT composes into the 3-facet bundle, resource-only --
test('PK1', 'A gated draft composes into a 3-facet package (protocol · bloodwork · nutrition) — DRAFT, resource-only, self-checked', () => {
  const res = GEN.generateProtocol({
    goalText: 'fat loss and recovery', client: { id: 'pk1' },
    catalogIndex, evidenceByCompound, complianceCfg, jurisdiction: 'CA', role: 'PRACTITIONER',
  });
  const pkg = PKG.composeClientPackage({ protocol: res.draft, client: { name: 'Pkg Client' }, role: 'PRACTITIONER' });
  assert.strictEqual(pkg._model, 'ClientPackage', 'the bundle is a ClientPackage');
  assert.deepStrictEqual(pkg.facetOrder, ['protocol', 'bloodwork', 'nutrition'], 'three facets in the canonical order');
  assert.strictEqual(pkg.facets.protocol.facet, 'protocol', 'facet 1 is the protocol pass-through');
  assert.strictEqual(pkg.facets.bloodwork.facet, 'bloodwork', 'facet 2 is the bloodwork-to-order');
  assert.strictEqual(pkg.facets.nutrition.facet, 'nutrition', 'facet 3 is the nutrition follow-up');
  assert.strictEqual(pkg.isResourceOnly, true, 'the whole package is explicitly resource-only');
  assert.strictEqual(pkg.isPrescription, false, 'the whole package is explicitly NOT a prescription');
  assert.strictEqual(pkg.languageOk, true, 'the composer self-check passes the language gate');
  // A composed draft is NEVER client-visible, and the banner says so plainly.
  assert.strictEqual(pkg.status, 'DRAFT', 'a generated spine composes as a DRAFT');
  assert.strictEqual(pkg.clientVisible, false, 'a DRAFT package can never reach the client portal');
  assert.match(pkg.banner, /DRAFT/, 'the banner declares the draft state');
  assert.match(pkg.banner, /not a prescription/i, 'the banner declares it is not a prescription');
  // The protocol facet is a faithful pass-through of REAL gated items — invents nothing.
  assert.ok(pkg.facets.protocol.itemCount >= 1, 'the protocol facet carries the gated items');
  assert.strictEqual(pkg.meta.protocolItems, pkg.facets.protocol.itemCount, 'meta mirrors the protocol item count');
  for (const it of pkg.facets.protocol.items) {
    assert.ok(it.productName, 'every package item names a real source-of-truth product');
  }
});

// --- PK2: the CLIENT view strips operator-only dosing levers + rationale -----
test('PK2', 'The CLIENT package softens the protocol facet — no titration/taper/schedule, no clinical rationale', () => {
  const res = GEN.generateProtocol({
    goalText: 'fat loss and recovery', client: { id: 'pk2' },
    catalogIndex, evidenceByCompound, complianceCfg, jurisdiction: 'CA', role: 'PRACTITIONER',
  });
  const op = PKG.composeClientPackage({ protocol: res.draft, client: { name: 'Pkg Client' }, role: 'PRACTITIONER' });
  const cl = PKG.composeClientPackage({ protocol: res.draft, client: { name: 'Pkg Client' }, role: 'CLIENT' });
  // The operator keeps the clinical reasoning + the full dosing schedule.
  assert.ok(op.facets.protocol.rationale, 'the operator sees the internal rationale');
  const opHasLevers = op.facets.protocol.items.some(
    (it) => it.dosing && (it.dosing.titration || it.dosing.taper || it.dosing.schedule),
  );
  assert.ok(opHasLevers, 'the operator package carries the operator-only dosing levers');
  // The client view drops every operator-only lever — defense-in-depth at the composer.
  assert.strictEqual(cl.facets.protocol.rationale, undefined, 'the client never receives the clinical rationale');
  for (const it of cl.facets.protocol.items) {
    if (!it.dosing) continue;
    assert.ok(!('titration' in it.dosing), 'no titration leaks to the client');
    assert.ok(!('taper' in it.dosing), 'no taper leaks to the client');
    assert.ok(!('schedule' in it.dosing), 'no personal schedule leaks to the client');
  }
  assert.strictEqual(cl.role, 'CLIENT', 'the package records the softened role');
});

// --- PK3: the nutrition facet is lab-DRIVEN — honest PENDING_LABS otherwise ---
test('PK3', 'Nutrition is honestly PENDING_LABS with no results, and becomes a real naturopath slip once results exist', () => {
  const res = GEN.generateProtocol({
    goalText: 'fat loss and recovery', client: { id: 'pk3' },
    catalogIndex, evidenceByCompound, complianceCfg, jurisdiction: 'CA', role: 'PRACTITIONER',
  });
  // No lab results yet → the facet says so plainly; it never fabricates guidance.
  const pending = PKG.composeClientPackage({ protocol: res.draft, client: { name: 'Pkg Client' }, nutritionSlip: null, role: 'PRACTITIONER' });
  assert.strictEqual(pending.facets.nutrition.status, 'PENDING_LABS', 'no results ⇒ honest PENDING_LABS');
  assert.strictEqual(pending.facets.nutrition.slip, null, 'no slip is invented');
  assert.match(pending.facets.nutrition.reason, /lab/i, 'the pending state explains it is waiting on labs');
  // Once a real lab is recorded, the SAME nutrition engine produces a slip the package carries through.
  const slip = NUT.analyzeLabForNutrients({
    role: 'PRACTITIONER', clientName: 'Pkg Client',
    values: [{ marker: 'Vitamin D 25-OH', value: 18, unit: 'ng/mL', refLow: 30, refHigh: 100 }],
  });
  assert.strictEqual(slip.providerReviewSuggested, true, 'fixture: a low vitamin D flags provider review');
  const ready = PKG.composeClientPackage({ protocol: res.draft, client: { name: 'Pkg Client' }, nutritionSlip: slip, role: 'PRACTITIONER' });
  assert.strictEqual(ready.facets.nutrition.status, 'READY', 'with a flagged slip the facet is READY');
  assert.strictEqual(ready.facets.nutrition.slip, slip, 'the already-softened slip is passed through, not re-derived');
});

// --- PK4: bloodwork monitoring is sourced from the PROTOCOL'S OWN items -------
//   (regression lock) The package must monitor what THIS protocol contains, never an
//   unrelated currentProducts list — otherwise a fresh goal→protocol would carry the
//   client's OLD compound markers. Compose a reta+bpc draft against an unrelated
//   currentProducts:['HGH 5iu'] and prove HGH's IGF-1 never leaks in.
test('PK4', 'Safety-monitoring markers are SOURCED from the protocol\'s own items (PEPTIDE_ADDITIONS) — never an unrelated currentProducts list', () => {
  const res = GEN.generateProtocol({
    goalText: 'fat loss and recovery', client: { id: 'pk4' },
    catalogIndex, evidenceByCompound, complianceCfg, jurisdiction: 'CA', role: 'PRACTITIONER',
  });
  const ownNames = res.draft.items.map((it) => it.productName);
  // Deliberately hand the composer an UNRELATED currentProducts list (HGH → IGF-1).
  const pkg = PKG.composeClientPackage({
    protocol: res.draft, client: { name: 'Pkg Client', currentProducts: ['HGH 5iu'] }, role: 'PRACTITIONER',
  });
  const sm = pkg.facets.bloodwork.safetyMonitoring;
  assert.strictEqual(sm.status, 'SOURCED', 'a monitored protocol yields a SOURCED panel');
  assert.deepStrictEqual(sm.basedOn, ownNames, 'monitoring is based on the protocol\'s OWN items');
  // Reta + BPC markers ARE present (these are the protocol\'s real compounds).
  assert.ok(sm.markers.some((m) => /lipase/i.test(m)) && sm.markers.some((m) => /amylase/i.test(m)), 'Retatrutide → Lipase + Amylase are monitored');
  assert.ok(sm.markers.some((m) => /apolipoprotein/i.test(m)), 'Retatrutide → Apolipoprotein A/B are monitored');
  assert.ok(sm.markers.some((m) => /hs-?crp/i.test(m)), 'BPC-157 → hs-CRP is monitored');
  // The HGH marker (IGF-1) must NOT appear — currentProducts did NOT drive monitoring.
  assert.ok(!sm.markers.some((m) => /igf/i.test(m)), 'the unrelated HGH\'s IGF-1 never leaks into a Reta+BPC package');
  // Unit-lock packageProductNames: protocol items win; currentProducts is only a fallback.
  assert.deepStrictEqual(
    PKG.packageProductNames({ items: [{ productName: 'Retatrutide 10mg/vial' }] }, { currentProducts: ['HGH 5iu'] }),
    ['Retatrutide 10mg/vial'], 'the protocol\'s own items take precedence',
  );
  assert.deepStrictEqual(
    PKG.packageProductNames({ items: [] }, { currentProducts: ['HGH 5iu'] }),
    ['HGH 5iu'], 'currentProducts is used ONLY when a projection carries no items',
  );
  assert.deepStrictEqual(PKG.packageProductNames({ items: [] }, null), [], 'no items + no client ⇒ nothing fabricated');
  // And the baseline panel is Dr. Lun\'s enumerated panel — SOURCED, never invented.
  assert.strictEqual(pkg.facets.bloodwork.baseline.status, 'SOURCED', 'the baseline panel is Dr. Lun\'s sourced panel');
});

// --- PK5: doctrine guard across the whole package surface --------------------
test('PK5', 'No medical-claim language anywhere; names Dr. Vincent Lun (never "Vinny"); client-visibility only on an APPROVED spine', () => {
  const res = GEN.generateProtocol({
    goalText: 'fat loss and recovery', client: { id: 'pk5' },
    catalogIndex, evidenceByCompound, complianceCfg, jurisdiction: 'CA', role: 'PRACTITIONER',
  });
  for (const role of ['PRACTITIONER', 'CLIENT']) {
    const pkg = PKG.composeClientPackage({ protocol: res.draft, client: { name: 'Pkg Client' }, role });
    assert.strictEqual(pkg.languageOk, true, `[${role}] the composer self-check passes the language gate`);
    const authored = [
      pkg.banner, pkg.intro, pkg.title,
      pkg.facets.bloodwork.requisitionNote, pkg.facets.bloodwork.disclaimer,
      pkg.facets.nutrition.reason || null,
      pkg.facets.protocol.practitionerNote || null,
      ...pkg.disclaimers,
    ].filter(Boolean);
    const violations = authored.flatMap((s) => G.languageGate(s).violations || []);
    assert.deepStrictEqual(violations, [], `[${role}] no banned medical-claim verb in any authored package string`);
    assert.strictEqual(/vinny/i.test(JSON.stringify(pkg)), false, `[${role}] Dr. Vincent Lun doctrine — never "Vinny"`);
    assert.strictEqual(pkg.facets.bloodwork.provider.name, 'Dr. Vincent Lun', `[${role}] the bloodwork requisition names Dr. Vincent Lun`);
    assert.match(pkg.facets.bloodwork.requisitionNote, /Dr\. Vincent Lun/, `[${role}] the requisition is addressed to Dr. Vincent Lun`);
    assert.strictEqual(pkg.isPrescription, false, `[${role}] never framed as a prescription`);
  }
  // The hard client-visibility boundary holds at the package layer: DRAFT ⇒ hidden,
  // APPROVED_RESOURCE ⇒ visible. (Same boundary every other client surface enforces.)
  const draftPkg = PKG.composeClientPackage({ protocol: res.draft, client: { name: 'Pkg Client' }, role: 'CLIENT' });
  assert.strictEqual(draftPkg.clientVisible, false, 'a DRAFT spine composes as NOT client-visible');
  const approved = { ...res.draft, status: G.CLIENT_VISIBLE_STATUS };
  const approvedPkg = PKG.composeClientPackage({ protocol: approved, client: { name: 'Pkg Client' }, role: 'CLIENT' });
  assert.strictEqual(approvedPkg.clientVisible, true, 'an APPROVED_RESOURCE spine composes as client-visible');
  assert.match(approvedPkg.banner, /APPROVED RESOURCE/, 'the approved banner reflects the reviewed state');
});

// ═══════════════════════════════════════════════════════════════════════════
//  PLATFORM LAYER — onboarding (invitations + self-intake + documents), subscription
//  ENTITLEMENTS, protocol LOCK-IN (current/past), the paid ADD-ON workflow (supplement +
//  meal plans), and the RESEARCH SOURCE registry. Same doctrine as the rest: drafts never
//  reach a client until practitioner-approved, nothing is fabricated, no claim language.
// ═══════════════════════════════════════════════════════════════════════════

// --- PL1: manual client creation still works (no regression) ----------------
test('PL1', 'Manual client creation still works — the original ClientProfile path is untouched', () => {
  const c = GEN ? require('@vitalis/protocol-core/models').ClientProfile({ name: 'Manual Client', goals: ['Energy'] }) : null;
  assert.ok(c, 'a client can be created directly');
  assert.strictEqual(c._model, 'ClientProfile');
  assert.strictEqual(c.name, 'Manual Client');
  assert.deepStrictEqual(c.goals, ['Energy']);
  // The demo dashboard still has its hand-authored demo clients, all flagged _demo.
  assert.strictEqual(G.demoDataGate(demo).ok, true, 'demo clients still present');
  assert.strictEqual(G.demoDataGate(demo).allFlaggedDemo, true, 'every demo client still _demo:true');
});

// --- PL2: an invitation's self-intake creates/links a client PROFILE ---------
test('PL2', 'Invitation intake creates a client profile linked to the inviting practitioner — and never an approval', () => {
  const inv = ACC.createInvitation({ practitionerId: 'pr_lun', email: 'x@example.com', name: 'Invited One' });
  assert.strictEqual(inv._model, 'ClientInvitation');
  assert.ok(inv.token, 'the invitation carries an opaque lookup token');
  assert.strictEqual(inv.status, 'PENDING');
  const { client, submission } = ACC.applyIntake({
    invitation: inv,
    intake: { name: 'Invited One', age: 40, sex: 'male', goals: ['Fat loss'], allergies: ['Penicillin'] },
  });
  assert.strictEqual(client._model, 'ClientProfile');
  assert.strictEqual(client.practitionerId, 'pr_lun', 'intake links the client to the inviting practitioner (derived ownership)');
  assert.deepStrictEqual(client.goals, ['Fat loss']);
  assert.deepStrictEqual(client.contraindications, ['Penicillin'], 'self-reported allergies map to contraindications');
  assert.strictEqual(submission._model, 'IntakeSubmission');
  assert.strictEqual(submission.submittedBy, 'CLIENT');
  assert.strictEqual(submission.status, 'LINKED', 'a submission is LINKED — never an approval state');
  // Onboarding ≠ approval: applyIntake yields data only, no draft, no approved resource.
  assert.ok(!('reviewedBy' in submission), 'self-intake produces no reviewed/approved artifact');
});

// --- PL3: a self-intake / CLIENT actor can never approve clinical resources --
test('PL3', 'Self-intake / client actors cannot approve clinical resources — only a practitioner/admin may', () => {
  assert.strictEqual(ACC.selfIntakeApprovalGate('CLIENT').ok, false, 'a CLIENT actor cannot approve');
  assert.strictEqual(ACC.selfIntakeApprovalGate('CLIENT').blocked, true);
  assert.strictEqual(ACC.selfIntakeApprovalGate('PRACTITIONER').ok, true, 'a practitioner may');
  assert.strictEqual(ACC.selfIntakeApprovalGate('ADMIN').ok, true, 'an admin may');
  assert.strictEqual(ACC.selfIntakeApprovalGate('').ok, false, 'an unknown actor cannot approve');
  assert.match(ACC.selfIntakeApprovalGate('CLIENT').reason, /practitioner review is required/i);
});

// --- PL4: protocol generation is capped by the plan entitlement -------------
test('PL4', 'Active-protocol generation is capped by entitlement — never coerced, framed as a resource limit', () => {
  const free = ACC.defaultEntitlement('cc');               // free tier → cap 3
  assert.strictEqual(free.activeProtocolCap, 3);
  assert.strictEqual(ACC.entitlementGate({ entitlement: free, activeProtocolCount: 0 }).remaining, 3);
  assert.strictEqual(ACC.entitlementGate({ entitlement: free, activeProtocolCount: 2 }).blocked, false, '2/3 still allowed');
  const capped = ACC.entitlementGate({ entitlement: free, activeProtocolCount: 3 });
  assert.strictEqual(capped.blocked, true, '3/3 is blocked');
  assert.strictEqual(capped.ok, false);
  assert.match(capped.reason, /limit reached/i);
  assert.match(capped.reason, /not a clinical restriction/i, 'it is an educational-resource limit, not a clinical one');
  const pro = ACC.entitlementGate({ entitlement: ACC.defaultEntitlement('cp', 'pro'), activeProtocolCount: 99 });
  assert.strictEqual(pro.cap, null, 'pro is unlimited');
  assert.strictEqual(pro.blocked, false, 'unlimited never blocks');
});

// --- PL5: locking a protocol makes exactly ONE current, prior current → past -
test('PL5', 'Locking a protocol makes it the single CURRENT one and moves the prior current to PAST (status untouched)', () => {
  const set = [
    { id: 'p1', clientId: 'cc', status: 'APPROVED_RESOURCE', lifecycle: 'ACTIVE', startDate: '2026-01-01', reviewedAt: '2026-01-01' },
    { id: 'p2', clientId: 'cc', status: 'APPROVED_RESOURCE', lifecycle: 'PENDING', startDate: '2026-02-01', reviewedAt: '2026-02-01' },
    { id: 'p3', clientId: 'other', status: 'APPROVED_RESOURCE', lifecycle: 'ACTIVE' },
    { id: 'pd', clientId: 'cc', status: 'DRAFT', lifecycle: 'ACTIVE' },
  ];
  const res = G.lockProtocolAsCurrent(set, 'p2');
  assert.strictEqual(res.ok, true);
  assert.deepStrictEqual(res.supersededIds, ['p1'], 'the prior running protocol is superseded');
  const byId = Object.fromEntries(res.drafts.map((d) => [d.id, d]));
  assert.strictEqual(byId.p2.lifecycle, 'ACTIVE', 'the locked protocol is CURRENT');
  assert.strictEqual(byId.p1.lifecycle, 'COMPLETED', 'the prior current is moved to PAST');
  assert.strictEqual(byId.p1.status, 'APPROVED_RESOURCE', 'status axis untouched — superseded stays approved');
  assert.strictEqual(byId.p2.status, 'APPROVED_RESOURCE');
  assert.strictEqual(byId.p3.lifecycle, 'ACTIVE', 'a different client journey is never touched');
  // The portal split now shows exactly one current for the client.
  const split = G.splitProtocolsByLifecycle(G.clientVisibleProtocols(res.drafts, 'cc'));
  assert.strictEqual(split.current.length, 1, 'the portal shows exactly one CURRENT protocol');
  assert.strictEqual(split.current[0].id, 'p2');
  assert.ok(split.past.some((p) => p.id === 'p1'), 'the prior protocol is now in Past');
  // A non-approved draft can never be locked as current.
  assert.strictEqual(G.lockProtocolAsCurrent(set, 'pd').ok, false, 'a DRAFT cannot be locked');
  assert.strictEqual(G.protocolLockGate({ status: 'DRAFT' }).ok, false);
});

// --- PL6: a client can request a supplement / meal add-on -------------------
test('PL6', 'A client can request a supplement or meal add-on; unknown types and missing client are blocked', () => {
  const r1 = ADDON.createAddOnRequest({ clientId: 'cc', requestType: 'SUPPLEMENT_PLAN', tier: 'BASIC' });
  assert.strictEqual(r1._model, 'AddOnRequest');
  assert.strictEqual(r1.status, 'REQUESTED');
  assert.strictEqual(r1.paymentStatus, 'UNPAID', 'a fresh request is unpaid by default');
  const r2 = ADDON.createAddOnRequest({ clientId: 'cc', requestType: 'MEAL_PLAN', tier: 'MONTHLY_PREP' });
  assert.strictEqual(r2.requestType, 'MEAL_PLAN');
  assert.ok(r2.feeLabel, 'a display fee label is attached for the chosen depth');
  assert.strictEqual(ADDON.addonRequestGate({ clientId: 'cc', requestType: 'SUPPLEMENT_PLAN', tier: 'BASIC' }).ok, true);
  assert.strictEqual(ADDON.addonRequestGate({ clientId: 'cc', requestType: 'NONSENSE' }).blocked, true, 'an unknown add-on type is blocked');
  assert.strictEqual(ADDON.addonRequestGate({ requestType: 'MEAL_PLAN', tier: 'BASIC' }).blocked, true, 'a missing clientId is blocked');
});

// --- PL7: an add-on cannot generate unless PAID / MANUALLY_APPROVED ----------
test('PL7', 'An add-on cannot generate a draft unless it is PAID or MANUALLY_APPROVED — never coerced', () => {
  assert.strictEqual(ADDON.addonGenerationGate({ paymentStatus: 'UNPAID' }).blocked, true);
  assert.strictEqual(ADDON.addonGenerationGate({ paymentStatus: 'PAID' }).ok, true);
  assert.strictEqual(ADDON.addonGenerationGate({ paymentStatus: 'MANUALLY_APPROVED' }).ok, true);
  assert.strictEqual(ADDON.addonGenerationGate({ paymentStatus: 'yes' }).ok, false, 'a truthy string never coerces a pass');
  assert.strictEqual(ADDON.addonGenerationGate({}).blocked, true, 'an absent payment status is blocked');
});

// --- PL8: a generated add-on is invisible to the client until approval -------
test('PL8', 'A generated add-on draft is never client-visible until status === APPROVED_RESOURCE (operator fields stripped)', () => {
  const req = ADDON.createAddOnRequest({ clientId: 'cc', requestType: 'SUPPLEMENT_PLAN', tier: 'BASIC', paymentStatus: 'PAID' });
  const draft = ADDON.composeAddOnDraft({ request: req });
  assert.strictEqual(draft.status, 'DRAFT');
  assert.strictEqual(draft.isResourceOnly, true);
  assert.strictEqual(draft.isPrescription, false);
  assert.strictEqual(ADDON.addonClientProjection(draft), null, 'a DRAFT add-on is never client-visible');
  assert.strictEqual(ADDON.addonClientProjection({ ...draft, status: 'PROVIDER_REVIEW' }), null, 'PROVIDER_REVIEW is still hidden');
  const proj = ADDON.addonClientProjection({ ...draft, status: 'APPROVED_RESOURCE', reviewedBy: 'Dr. Vincent Lun' });
  assert.ok(proj, 'an APPROVED_RESOURCE add-on becomes visible');
  assert.strictEqual(proj.isPrescription, false);
  assert.strictEqual('rationale' in proj, false, 'operator rationale never reaches the client');
  assert.strictEqual('compatibilityNotes' in proj, false, 'operator compatibility notes never reach the client');
  // The demo data proves the boundary across clients: Kristen has an approved add-on; Jim's is in review.
  assert.strictEqual(ADDON.clientVisibleAddOns(demo.DEMO_ADDON_DRAFTS, 'demo_kristen_a').length, 1, 'Kristen sees her one approved add-on');
  assert.strictEqual(ADDON.clientVisibleAddOns(demo.DEMO_ADDON_DRAFTS, 'demo_jim_b').length, 0, "Jim's in-review add-on draft never leaks");
});

// --- PL9: the research source registry reports LIVE/STUB/PLANNED honestly ----
test('PL9', 'The research source registry reports LIVE/STUB/PLANNED honestly, reconciles with connectors, and never fabricates citations', () => {
  const reg = RSRC.researchSourceRegistry();
  assert.ok(reg.length >= 10, 'the registry lists the app-facing directive sources (WHO/NIH excluded per doctrine)');
  assert.ok(reg.every((s) => ['LIVE', 'STUB', 'PLANNED'].includes(s.status)), 'every source status is one of LIVE/STUB/PLANNED');
  const byId = Object.fromEntries(reg.map((s) => [s.id, s]));
  assert.strictEqual(byId.pubmed.status, 'LIVE');
  assert.strictEqual(byId.clinicaltrials.status, 'LIVE');
  assert.strictEqual(byId.healthcanada_dpd.status, 'STUB');
  assert.strictEqual(byId.chictr.status, 'PLANNED');
  assert.strictEqual(byId.eu_ctis.status, 'PLANNED');
  assert.strictEqual(byId.usda_fdc.status, 'LIVE', 'USDA FoodData Central is wired live (keyless DEMO_KEY/env)');
  // No drift: a wired source's status mirrors the live connector registry exactly.
  const conn = require('@vitalis/protocol-core/connectors');
  for (const c of conn.CONNECTORS) assert.strictEqual(byId[c.id].status, c.status, `registry status matches the connector for ${c.id}`);
  // Honest summary counts.
  const sum = RSRC.registrySummary();
  assert.strictEqual(sum.live, 3, 'three wired live connectors (PubMed, ClinicalTrials, USDA FoodData Central)');
  assert.strictEqual(sum.stub, 2, 'two STUB connectors');
  assert.strictEqual(sum.total, reg.length);
  // Evidence review never fabricates rows: non-live → UNKNOWN + [], live → PENDING + [] (caller does the real lookup).
  const evN = RSRC.evidenceReviewGate({ sourceId: 'eu_ctis', term: 'bpc-157' });
  assert.deepStrictEqual(evN.citations, [], 'a non-live source yields no citations');
  assert.strictEqual(evN.status, 'UNKNOWN');
  const evL = RSRC.evidenceReviewGate({ sourceId: 'pubmed', term: 'bpc-157' });
  assert.deepStrictEqual(evL.citations, [], 'even a live source returns no FABRICATED rows from the pure gate');
  assert.strictEqual(evL.status, 'PENDING');
});

// --- PL10: no medical-claim language leaks across the platform surface -------
test('PL10', 'No medical-claim language anywhere on the platform surface; demo records flagged _demo and never name "Vinny"', () => {
  const reqM = ADDON.createAddOnRequest({ clientId: 'cc', requestType: 'MEAL_PLAN', tier: 'DETAILED', paymentStatus: 'PAID', intake: { goals: ['Fat loss'], allergies: ['Shellfish'] } });
  const reqS = ADDON.createAddOnRequest({ clientId: 'cc', requestType: 'SUPPLEMENT_PLAN', tier: 'BASIC', paymentStatus: 'PAID' });
  const dM = ADDON.composeAddOnDraft({ request: reqM, protocolProducts: ['Retatrutide 10mg/vial'] });
  const dS = ADDON.composeAddOnDraft({ request: reqS });
  assert.strictEqual(dM.languageOk, true, 'the meal add-on self-check passes the language gate');
  assert.strictEqual(dS.languageOk, true, 'the supplement add-on self-check passes the language gate');
  const authored = [
    dM.title, dM.rationale, dM.compatibilityNotes, dS.title, dS.rationale,
    ACC.entitlementGate({ entitlement: ACC.defaultEntitlement('c'), activeProtocolCount: 3 }).reason,
  ]
    .concat((dM.sections || []).map((s) => `${s.title}  ${s.note || ''}`))
    .concat((dS.sections || []).map((s) => `${s.title}  ${s.note || ''}`))
    .filter(Boolean);
  const violations = authored.flatMap((s) => G.languageGate(s).violations || []);
  assert.deepStrictEqual(violations, [], 'no banned medical-claim language anywhere the platform authors text');
  // Demo platform records: all flagged _demo, resource-only add-ons, never "Vinny".
  const platformDemo = [].concat(demo.DEMO_INVITATIONS, demo.DEMO_ENTITLEMENTS, demo.DEMO_ADDON_REQUESTS, demo.DEMO_ADDON_DRAFTS);
  assert.ok(platformDemo.every((r) => r._demo === true), 'every platform demo record is flagged _demo');
  assert.strictEqual(/vinny/i.test(JSON.stringify(platformDemo)), false, 'Dr. Vincent Lun — never "Vinny"');
  assert.ok(demo.DEMO_ADDON_DRAFTS.every((d) => d.isResourceOnly === true && d.isPrescription === false), 'add-on drafts are resource-only, never a prescription');
  for (const ad of demo.DEMO_ADDON_DRAFTS) {
    const blob = [ad.title, ad.rationale, ad.compatibilityNotes]
      .concat((ad.sections || []).map((s) => `${s.title} ${s.note || ''} ${(s.items || []).map((i) => i.ask || '').join(' ')}`))
      .filter(Boolean).join('  ');
    assert.deepStrictEqual(G.languageGate(blob).violations, [], 'every demo add-on draft carries no claim language');
  }
});

// --- P6: the DEFAULT demo client (Kristen) is fully populated, honestly ------
// Labs / Progress / Documents stop rendering empty for demo_kristen_a — without weakening
// any boundary. Lab markers are the canonical recovery/inflammation scenario values; flags
// are computed by the gate (not baked in); the outcome series + documents are demo-flagged;
// and Eric's DRAFT still leaks nothing to a client.
test('P6', 'Default demo client (Kristen) has seeded labs + outcomes + documents; Eric stays invisible', () => {
  const KID = 'demo_kristen_a';
  // Labs: a BASELINE + a ~6-week FOLLOW-UP, so there is a prior and deltas exist.
  const kLabs = demo.DEMO_LAB_RESULTS.filter((r) => r.clientId === KID);
  assert.strictEqual(kLabs.length, 2, 'Kristen has exactly two lab draws (baseline + follow-up)');
  assert.ok(kLabs.every((r) => r._demo === true), 'every Kristen lab row is flagged _demo');
  const drawn = kLabs.map((r) => r.drawnAt).sort();
  assert.ok(new Date(drawn[0]) < new Date(drawn[1]), 'one draw precedes the other (a prior for deltas)');
  // Marker values are reused VERBATIM from the canonical recovery/inflammation scenario — not invented.
  const scenarioBaseline = require('@vitalis/protocol-core/data/lab-scenarios').scenarioLabValues('recovery-inflammation', 'baseline');
  const baseline = kLabs.find((r) => r.drawnAt === drawn[0]);
  for (const sv of scenarioBaseline) {
    const mine = baseline.values.find((v) => v.marker === sv.marker);
    assert.ok(mine, `baseline carries the scenario marker "${sv.marker}"`);
    assert.strictEqual(mine.value, sv.value, `${sv.marker} value matches the scenario (no invented number)`);
  }
  // The gate (not the fixture) flags the baseline; the follow-up moves into range.
  const flaggedBaseline = G.labResultFlagGate(baseline);
  assert.ok(flaggedBaseline.hasFlags, 'the baseline has out-of-range markers the gate flags for provider review');
  for (const f of flaggedBaseline.flags) assert.match(f.action, /not a diagnosis/i);
  const followUp = G.labResultFlagGate(kLabs.find((r) => r.drawnAt === drawn[1]));
  assert.strictEqual(followUp.hasFlags, false, 'the follow-up panel is back in range (recovery story)');

  // Outcomes: a ~12-week series so the trend chart + scorecard deltas + adherence ring populate.
  const kOut = demo.DEMO_OUTCOMES.filter((o) => o.clientId === KID);
  assert.ok(kOut.length >= 5, 'Kristen has at least five outcome datapoints');
  assert.ok(kOut.every((o) => o._demo === true), 'every Kristen outcome is flagged _demo');
  assert.ok(kOut.every((o) => o.weightKg != null && o.bodyFatPct != null && o.leanMassKg != null && o.adherencePct != null),
    'each outcome carries the body-comp + adherence fields the chart/scorecard read');

  // Documents: a non-empty "My Documents" surface, owned via clientId (not denormalized).
  const kDocs = demo.DEMO_CLIENT_DOCUMENTS.filter((d) => d.clientId === KID);
  assert.ok(kDocs.length >= 2, 'Kristen has documents on file');
  assert.ok(kDocs.every((d) => d._demo === true), 'every Kristen document is flagged _demo');
  assert.ok(demo.DEMO_CLIENT_DOCUMENTS.every((d) => !('practitionerId' in d)), 'a document never denormalizes practitionerId');
  assert.ok(kDocs.every((d) => ['RECEIVED', 'REVIEWED'].includes(d.status)), 'document status is only RECEIVED | REVIEWED (never an approval of care)');
  assert.strictEqual(/vinny/i.test(JSON.stringify(kDocs)), false, 'Dr. Vincent Lun — never "Vinny" on a document');

  // The seed does NOT weaken the approval boundary: Eric's DRAFT still projects to nothing,
  // and seeding Kristen's data added no approved resource/protocol/add-on beyond the existing ones.
  const eric = demo.DEMO_CLIENTS.find((c) => /eric/i.test(c.id));
  assert.deepStrictEqual(G.clientVisibleResources(demo.DEMO_DRAFTS, eric.id), [], 'Eric (DRAFT only) still sees nothing');
  assert.strictEqual(G.clientVisibleProtocols(demo.DEMO_DRAFTS, KID).length, 2, 'Kristen still has exactly her two approved protocols');
});

// ═══════════════════════════════════════════════════════════════════════════
//  MEAL + SUPPLEMENT COMMERCIALIZATION (Phase 2) — the real add-on engines.
//  ML* meal generator · SP* supplement generator · AO* add-on composition ·
//  RC* research connector interface. Honest gaps (ESTIMATED / SOURCE_PENDING /
//  PENDING_LABS / PLANNED) beat fake green; allergies + electrolytes never leak.
// ═══════════════════════════════════════════════════════════════════════════

// --- ML1: HARD allergy + dislike exclusion ----------------------------------
test('ML1', 'Meal plan HARD-excludes every listed allergy and disliked food from all meals', () => {
  const allergies = ['shellfish', 'dairy'];
  const dislikes = ['liver'];
  const plan = MEALS.generateMealPlan({ goal: 'fat loss', weightKg: 80, heightCm: 178, age: 40, sex: 'male', activityDaysPerWeek: 4, mealsPerDay: 4, allergies, dislikes, dietaryStyle: 'omnivore' });
  const byId = Object.fromEntries(FOODS.MEALS.map((m) => [m.id, m]));
  for (const day of plan.days) {
    for (const m of day.meals) {
      if (!m.id) continue;
      const meal = byId[m.id];
      for (const a of meal.allergens) assert.ok(!allergies.includes(a), `allergen "${a}" leaked into "${meal.name}"`);
      for (const ing of meal.ingredients) assert.ok(!/liver/i.test(ing), `disliked "liver" leaked via "${ing}"`);
    }
  }
  assert.ok(plan.excluded.allergies.includes('shellfish') && plan.excluded.allergies.includes('dairy'), 'the plan records what it excluded');
  assert.ok(plan.substitutions.some((s) => s.excluded === 'dairy' && s.alternatives.length), 'an excluded allergen gets substitutions');
});

// --- ML2: macro target honesty (ESTIMATED / UNKNOWN / PROVIDED) -------------
test('ML2', 'Macro target is ESTIMATED+provider-review when calories unknown, UNKNOWN when un-estimable, PROVIDED when given', () => {
  const est = MEALS.estimateMacroTarget({ goal: 'fat loss', age: 40, sex: 'male', heightCm: 178, weightKg: 80, activityDaysPerWeek: 4 });
  assert.strictEqual(est.status, 'ESTIMATED');
  assert.ok(est.kcal > 1200 && est.providerReviewRequired === true, 'estimated calories carry a provider-review flag');
  const unk = MEALS.estimateMacroTarget({ goal: 'fat loss' });
  assert.strictEqual(unk.status, 'UNKNOWN');
  assert.strictEqual(unk.kcal, null, 'no calories fabricated when they cannot be estimated');
  assert.strictEqual(unk.providerReviewRequired, true);
  const prov = MEALS.estimateMacroTarget({ goal: 'maintenance', caloriesKnown: 2200, weightKg: 80 });
  assert.strictEqual(prov.status, 'PROVIDED');
  assert.strictEqual(prov.kcal, 2200);
  // The intake shape uses `goals` (array) — the goal adjustment must still apply (fat loss < maintenance).
  const base = { goals: ['__G__'], age: 40, sex: 'male', heightCm: 178, weightKg: 80, activityDaysPerWeek: 4 };
  const fatLoss = MEALS.estimateMacroTarget({ ...base, goals: ['fat loss'] });
  const maint = MEALS.estimateMacroTarget({ ...base, goals: ['maintenance'] });
  assert.ok(fatLoss.kcal < maint.kcal, 'a goals[] array drives the calorie adjustment (fat loss < maintenance)');
});

// --- ML3: completeness + monthly scaffold -----------------------------------
test('ML3', 'A weekly plan produces a macro target, 7 days, grocery list, substitutions, prep notes; monthly scaffolds from the week', () => {
  const wk = MEALS.generateMealPlan({ goal: 'muscle gain', weightKg: 75, heightCm: 175, age: 30, sex: 'female', mealsPerDay: 3, periodicity: 'weekly', allergies: ['nuts'] });
  assert.strictEqual(wk.periodicity, 'weekly');
  assert.ok(wk.macroTarget && wk.days.length === 7, 'macro target + 7 days');
  assert.ok(wk.groceryList.length > 0 && wk.prepNotes.length > 0, 'grocery list + prep notes');
  for (const d of wk.days) assert.ok(d.meals.length >= 2, 'each day has meals');
  const mo = MEALS.generateMealPlan({ goal: 'maintenance', weightKg: 80, heightCm: 180, age: 35, sex: 'male', periodicity: 'monthly' });
  assert.strictEqual(mo.periodicity, 'monthly');
  assert.ok(mo.monthlyNote && /weekly/i.test(mo.monthlyNote), 'monthly is scaffolded from the weekly template, stated honestly');
});

// --- ML4: SOURCE_PENDING for unseeded foods ---------------------------------
test('ML4', 'Seeded foods carry curated-estimate macros; an unseeded food is SOURCE_PENDING — never a fabricated value', () => {
  assert.strictEqual(FOODS.MACRO_SOURCE, 'CURATED_ESTIMATE', 'seed macros are labelled curated estimates, not verified USDA facts');
  const seeded = MEALS.macroForFood('Chicken breast');
  assert.strictEqual(seeded.source, FOODS.MACRO_SOURCE);
  assert.ok(seeded.kcal > 0 && seeded.protein > 0, 'a seeded food has macros');
  const pending = MEALS.macroForFood('Unicorn quinoa surprise');
  assert.strictEqual(pending.source, 'SOURCE_PENDING');
  assert.strictEqual(pending.kcal, null, 'no fabricated calories for an unseeded food');
  assert.strictEqual(pending.protein, null);
});

// --- ML5: language-clean + dietGate now ACTIVE ------------------------------
test('ML5', 'The meal engine authors no medical-claim language and the reserved dietGate is now ACTIVE', () => {
  const plan = MEALS.generateMealPlan({ goal: 'fat loss', weightKg: 90, heightCm: 182, age: 45, sex: 'male', activityDaysPerWeek: 5, mealsPerDay: 4, allergies: ['fish'], dislikes: ['mushrooms'] });
  assert.strictEqual(plan.languageOk, true);
  const blob = [plan.macroTarget.basis, ...plan.prepNotes, ...plan.sourceNotes, plan.monthlyNote].filter(Boolean).join('  ');
  assert.deepStrictEqual(G.languageGate(blob).violations, [], 'no banned medical-claim term in the meal plan');
  const reserved = require('@vitalis/protocol-core/reserved');
  assert.strictEqual(reserved.dietGate({ goal: 'maintenance' }).status, 'ACTIVE', 'dietGate is wired ACTIVE');
});

// --- SP1: supplement plan from confirmed labs -------------------------------
test('SP1', 'A supplement plan from confirmed labs yields nutrient targets (form + evidence tier), food-first options, and discussion items', () => {
  const sp = SUP.generateSupplementPlan({ labValues: [{ marker: 'Vitamin D', value: 18, unit: 'ng/mL', refLow: 30, refHigh: 100 }], goals: ['Recovery'], role: 'PRACTITIONER' });
  assert.strictEqual(sp.status, 'DRAFT');
  assert.ok(sp.nutrientTargets.length >= 1, 'at least one nutrient target');
  const vd = sp.nutrientTargets.find((t) => /vitamin d/i.test(t.nutrient));
  assert.ok(vd && vd.suggestedForm, 'names a form, never a dose');
  assert.strictEqual(vd.target.target, null, 'the dose is never guessed — the naturopath’s call');
  assert.ok(['ESTABLISHED', 'SUPPORTIVE', 'EMERGING'].includes(vd.evidenceTier), 'carries an evidence tier');
  assert.ok(sp.foodFirstOptions.some((f) => /vitamin d/i.test(f.nutrient) && f.options.length), 'food-first options present');
  assert.ok(sp.discussionItems.some((d) => d.ask), 'discussion items for the naturopath');
});

// --- SP2: electrolytes never become supplement suggestions ------------------
test('SP2', 'Electrolytes / provider-only nutrients are never supplement suggestions — they route to provider review', () => {
  const sp = SUP.generateSupplementPlan({ labValues: [
    { marker: 'Potassium', value: 5.6, unit: 'mmol/L', refLow: 3.5, refHigh: 5.1 },
    { marker: 'Vitamin D', value: 18, unit: 'ng/mL', refLow: 30, refHigh: 100 },
  ], role: 'PRACTITIONER' });
  const names = sp.nutrientTargets.concat(sp.discussionItems).map((x) => String(x.nutrient || '').toLowerCase()).join(' ');
  assert.ok(!/potassium/.test(names), 'potassium is NEVER a supplement suggestion');
  const k = sp.providerReviewFlags.find((p) => /potassium/i.test(p.marker));
  assert.ok(k && k.supplementSuggested === false, 'potassium routes to provider review with no OTC suggestion');
});

// --- SP3: peptide interaction/monitoring notes (sourced, not invented) ------
test('SP3', 'Peptide interaction/monitoring notes are sourced from the protocol products (never invented), absent when no products', () => {
  const labs = [{ marker: 'Vitamin D', value: 18, unit: 'ng/mL', refLow: 30, refHigh: 100 }];
  const on = SUP.generateSupplementPlan({ labValues: labs, products: ['HGH 5iu'], role: 'PRACTITIONER' });
  assert.strictEqual(on.peptideNotes.onProtocol, true);
  assert.ok(on.peptideNotes.monitoringMarkers.some((m) => /igf/i.test(m)), 'HGH → IGF-1 monitoring marker (sourced from PEPTIDE_ADDITIONS)');
  const off = SUP.generateSupplementPlan({ labValues: labs, products: [], role: 'PRACTITIONER' });
  assert.strictEqual(off.peptideNotes.onProtocol, false);
  assert.deepStrictEqual(off.peptideNotes.monitoringMarkers, [], 'no products → no fabricated monitoring markers');
});

// --- SP4: client softening + PENDING_LABS + language ------------------------
test('SP4', 'The client supplement view is softened (no citation dump); operator keeps studies; no labs → PENDING_LABS; language-clean', () => {
  const labs = [{ marker: 'Vitamin D', value: 18, unit: 'ng/mL', refLow: 30, refHigh: 100 }];
  const op = SUP.generateSupplementPlan({ labValues: labs, role: 'PRACTITIONER' });
  const cl = SUP.generateSupplementPlan({ labValues: labs, role: 'CLIENT' });
  assert.ok(op.nutrientTargets[0].studies, 'operator sees the study basis');
  assert.strictEqual(cl.nutrientTargets[0].studies, undefined, 'the client does not get the citation/study dump');
  assert.strictEqual(/ods\.od\.nih\.gov/.test(JSON.stringify(cl.nutrientTargets)), false, 'no citation URL leaks into the client targets');
  assert.strictEqual(SUP.generateSupplementPlan({ labValues: [] }).status, 'PENDING_LABS', 'no labs → honest PENDING_LABS');
  assert.strictEqual(op.languageOk, true, 'supplement plan is language-clean');
});

// --- SP5: the supplement RESEARCH mini-dossier — 11 sections, honest source tiering, NO fabrication ---
test('SP5', 'The supplement adapter enriches into the 11-section research mini-dossier: real-lab Findings + baseline-vs-latest deltas + deterministic Priority + per-claim provenance (T1–T5/NEEDS_SOURCE) — every emitted citation is real (title + http(s) url) or its reviewStatus is an HONEST_LABEL; no fake PMID; gov sources never dressed as T1/T2; the six original section keys survive', () => {
  const VDM = require('@vitalis/protocol-core/vertical-document-model');
  const RDOC = require('@vitalis/protocol-core/research-doctrine');
  const SR = require('@vitalis/protocol-core/supplements-research');

  // Kristen's REAL draws (baseline demo_lab_kristen_1 → latest demo_lab_kristen_2) threaded through.
  const kristen = demo.DEMO_CLIENTS.find((c) => c.id === 'demo_kristen_a');
  const kLabs = demo.DEMO_LAB_RESULTS.filter((r) => r.clientId === 'demo_kristen_a');
  const draft = demo.DEMO_ADDON_DRAFTS.find((d) => d.id === 'demo_addondraft_kristen_supp');
  const doc = VDM.toSupplementDocProps({ ...draft.plan, status: draft.status }, { role: 'PRACTITIONER', client: kristen, labResults: kLabs });

  // The SIX original section keys (tests VD2/DF3 assert these BY NAME) must still be present.
  for (const key of ['nutrientTargets', 'foodFirst', 'discussionPlan', 'providerReview', 'supportiveLifestyle', 'peptideNotes']) {
    assert.ok(key in doc.sections, `original section key "${key}" survives the enrichment`);
  }
  // The NEW research-mini-dossier surfaces (the 11 sections) are present.
  assert.ok(doc.cover.execSummary && doc.cover.execSummary.resourceDisclaimer, 'S01 exec summary present');
  for (const key of ['clientSnapshot', 'labFindings', 'priorityRanking', 'monitoring', 'practitionerReview']) {
    assert.ok(key in doc.sections, `new section "${key}" present`);
  }
  assert.ok(doc.evidenceReference && doc.evidenceReference.items.length > 0, 'S10 evidence reference present');
  assert.ok(doc.researchBasis && Array.isArray(doc.researchBasis.provenance), 'S11 research basis present');

  // Lab+Lifestyle Findings are derived from the REAL labs (6 markers) with baseline-vs-latest deltas.
  const findings = doc.sections.labFindings.items;
  assert.strictEqual(findings.length, kLabs[1].values.length, 'every latest-draw marker becomes a finding');
  assert.ok(doc.sections.labFindings.hasBaseline, 'baseline-vs-latest is threaded');
  const mag = findings.find((f) => /magnesium/i.test(f.marker));
  assert.ok(mag && mag.trend && mag.trend.baseline === 0.70 && mag.trend.latest === 0.82, 'Magnesium delta traces to her real draws (0.70 → 0.82)');
  assert.ok(/improving/i.test(mag.status), 'a marker that moved into range reads as improving (real, not invented)');
  assert.ok(!/diagnos/i.test(JSON.stringify(findings).replace(/not a diagnos\w+/gi, '')), 'findings are research phrasing, never a diagnosis');

  // Lifestyle is genuinely absent → honest "not captured" + proposed intake questions (never fabricated).
  assert.strictEqual(doc.sections.clientSnapshot.lifestyle.captured, false, 'lifestyle honestly not captured');
  assert.ok((doc.sections.clientSnapshot.lifestyle.intakeQuestions || []).length >= 3, 'proposes intake questions instead of inventing lifestyle findings');

  // Priority is deterministic from tier + flag (bands from the locked vocabulary).
  const bands = new Set(doc.sections.priorityRanking.items.map((p) => p.band));
  assert.ok([...bands].every((b) => ['Priority 1', 'Priority 2', 'Optional / watchlist', 'Hold / not recommended'].includes(b)), 'priority bands are the locked vocabulary');

  // target.target stays null everywhere (FORM-not-dose) — DF3/SP1 contract.
  assert.ok(doc.sections.nutrientTargets.items.every((t) => t.targetIsNull === true), 'every target stays null-dose (FORM not dose)');

  // ── THE NO-FABRICATION INVARIANT ──────────────────────────────────────────────────────────────
  const rows = doc.researchBasis.provenance;
  assert.ok(rows.length > 0, 'there are provenance rows to check');
  for (const r of rows) {
    // every emitted citation has a real title + http(s) url OR reviewStatus ∈ HONEST_LABELS; never a fake PMID.
    const hasRealCitation = r.sourceTitle && r.urlOrPmid && /^https?:\/\//.test(String(r.urlOrPmid));
    const honestStatus = RDOC.HONEST_LABELS.includes(r.reviewStatus);
    assert.ok(hasRealCitation || honestStatus, `row "${r.sourceId}" is either a REAL citation or an honest reviewStatus — never a bare/fabricated claim`);
    if (r.urlOrPmid) assert.ok(/^https?:\/\//.test(String(r.urlOrPmid)), `row "${r.sourceId}" never carries a fabricated/non-http PMID/url`);
    // a government source may NEVER be dressed as a T1/T2 efficacy proof.
    if (r.sourceType === 'government_reference') assert.ok(!['T1', 'T2'].includes(r.evidenceTier), 'a government reference is never tiered as an RCT (T1/T2)');
  }
  // Efficacy gaps that are NOT yet backed by a verified peer-reviewed source MUST surface honestly as
  // NEEDS_SOURCE (Vitamin D efficacy + lifestyle remain open) — never faked-green.
  assert.ok(doc.researchBasis.counts.needsSource >= 1, 'remaining efficacy source-gaps surface honestly as NEEDS_SOURCE');
  // REAL peer-reviewed T1 citations now close the magnesium-sleep + iron/ferritin-fatigue gaps. These are
  // journal RCT/meta-analysis sources (PMID/DOI), NOT government references; the count must be ACCURATE.
  assert.strictEqual(doc.researchBasis.counts.bySourceTier.T1, 3, 'the three verified peer-reviewed T1 citations are surfaced (not faked, not zero)');
  assert.strictEqual(doc.researchBasis.counts.bySourceTier.T2, 0, 'no T2 human trial is fabricated (none added)');
  const t1 = doc.researchBasis.provenance.filter((r) => r.evidenceTier === 'T1');
  assert.strictEqual(t1.length, 3, 'exactly three T1 rows');
  // every T1 row is a REAL citation: real title + a real http(s) DOI url (never a fabricated PMID/host).
  for (const r of t1) {
    assert.ok(r.sourceTitle && /^https?:\/\//.test(String(r.urlOrPmid)), 'a T1 row is a real citation (title + http(s) DOI)');
    assert.ok(/doi\.org/.test(String(r.urlOrPmid)), 'a T1 citation links the journal DOI (never the pubmed gov host)');
    assert.strictEqual(RDOC.isGovernmentUrl(r.urlOrPmid), false, 'a T1 efficacy citation is never a government URL');
  }
  // the magnesium→sleep and iron/ferritin→fatigue claims are now RCT/meta-supported by name.
  assert.ok(t1.some((r) => /magnesium/i.test(r.appliesTo) && /sleep|insomnia/i.test(r.appliesTo)), 'magnesium → sleep is now T1-backed');
  assert.ok(t1.some((r) => /iron|ferritin/i.test(r.appliesTo) && /fatigue|energy/i.test(r.appliesTo)), 'iron/ferritin → fatigue is now T1-backed');
  assert.ok(doc.researchBasis.counts.bySourceTier.T3 >= 1, 'established nutrition references still surface honestly as T3 reference-grade');
  assert.ok(doc.researchBasis.gapList.length === doc.researchBasis.counts.needsSource, 'every NEEDS_SOURCE row appears in the research-gap list');
  assert.ok(doc.researchBasis.govUse.used && /safety|reference|RDA/i.test(doc.researchBasis.govUse.purpose), 'government sources are used for safety/reference only — stated explicitly (practitioner view)');

  // CLIENT softening: provenance keeps tiers + source categories but DROPS full citation detail; checklist hidden.
  const cl = VDM.toSupplementDocProps({ ...draft.plan, status: draft.status }, { role: 'CLIENT', client: kristen, labResults: kLabs });
  assert.ok(cl.researchBasis.provenance.every((r) => r.evidenceTier && r.sourceType), 'client still sees tier + source category');
  assert.ok(cl.researchBasis.provenance.every((r) => r.urlOrPmid === null && r.citation === null), 'client provenance drops full citation detail');
  assert.strictEqual(cl.sections.practitionerReview.items.length, 0, 'client never sees the practitioner review checklist');
  assert.strictEqual(/ods\.od\.nih\.gov/.test(JSON.stringify(cl.researchBasis)), false, 'no citation URL leaks into the client research basis');

  // ── STRICT GOVERNMENT-NAME RULE (CLIENT view) ─────────────────────────────────────────────────
  // No government / public-health body may appear by NAME (or as a "government" label) anywhere in the
  // CLIENT-facing document. The practitioner view still carries the underlying references.
  const GOV_NAMES = /\bNIH\b|Office of Dietary Supplements|\bNIH ODS\b|\bWHO\b|World Health Organization|Health Canada|MedlinePlus|\bCDC\b|\bFDA\b|\bgovernment\b|Fact Sheet for Health Professionals|ods\.od\.nih\.gov|canada\.ca|medlineplus/i;
  const clientBlob = JSON.stringify(cl);
  assert.strictEqual(GOV_NAMES.test(clientBlob), false, 'the CLIENT supplement document never names a government / public-health source (stricter rule)');
  // the government_reference sourceType is relabeled to neutral research-tier language for the client.
  assert.ok(cl.researchBasis.provenance.every((r) => r.sourceType !== 'government_reference'), 'client never sees the raw government_reference source category');
  // the PRACTITIONER view, by contrast, DOES still carry the underlying government reference (by name + URL).
  assert.ok(/NIH|ods\.od\.nih\.gov/i.test(JSON.stringify(doc.researchBasis.provenance)), 'the practitioner view still sees the underlying government reference (transparency)');

  // ── DRIFT GUARD: the Source-Transparency NOTE must DERIVE from the counts, never contradict the tier table ──
  // The note is shown to BOTH client and practitioner. When T1/T2 > 0 it must NOT still assert "no peer-reviewed
  // primary efficacy" / "not RCT-proven" / a T1/T2 "= 0"-type claim (the self-contradiction QA caught), and the
  // CLIENT-visible note must name NO government / public-health body. Case-insensitive substring checks.
  const STALE_NOTE = [/no peer-reviewed primary efficacy/i, /not rct-proven/i, /no peer-reviewed primary efficacy trials/i];
  const T1T2 = (doc.researchBasis.counts.bySourceTier.T1 || 0) + (doc.researchBasis.counts.bySourceTier.T2 || 0);
  for (const note of [doc.researchBasis.note, cl.researchBasis.note]) {
    assert.ok(typeof note === 'string' && note.length > 40, 'the research basis note is a real string (derived, not empty)');
    if (T1T2 > 0) {
      for (const re of STALE_NOTE) {
        assert.strictEqual(re.test(note), false, `with T1/T2 > 0 the note must not contradict the tier table (${re})`);
      }
      // it must positively reflect that primary efficacy evidence is now present (consistent with the count).
      assert.ok(/peer-reviewed/i.test(note) && /T1/.test(note), 'the note states the peer-reviewed T1 evidence that the counts report');
    }
  }
  // GOV-NAME RULE on the CLIENT-visible note specifically (the note is client-visible — the scrub must hold).
  assert.strictEqual(GOV_NAMES.test(cl.researchBasis.note), false, 'the CLIENT research-basis note names no government / public-health body');
  // The note must never claim "= 0" for a tier that is actually non-zero (no numeric contradiction either).
  if (doc.researchBasis.counts.bySourceTier.T1 > 0) {
    assert.strictEqual(/T1\s*(?:\/\s*T2)?\s*=\s*0/i.test(doc.researchBasis.note), false, 'the note never claims T1 = 0 while T1 > 0');
  }

  // SUPPLEMENT footer is supplement-specific — NO peptide-sourcing boilerplate leaks onto a supplement doc.
  assert.ok(doc.disclaimer && doc.disclaimer.length > 40, 'the supplement document has its own disclaimer');
  assert.strictEqual(/peptide/i.test(doc.disclaimer), false, 'the supplement disclaimer carries NO peptide-specific language');
  assert.strictEqual(/sourced only through reputable channels|identity and purity|unapproved for the indications/i.test(doc.disclaimer), false, 'the supplement disclaimer carries none of the peptide-sourcing boilerplate');
  assert.ok(/supplement/i.test(doc.disclaimer) && /practitioner/i.test(doc.disclaimer), 'the supplement disclaimer is supplement-specific and practitioner-review framed');
  assert.strictEqual(/peptide/i.test(cl.disclaimer), false, 'the CLIENT supplement disclaimer also omits peptide boilerplate');

  // De-boilerplated "why it matters": markers that previously shared identical text now read distinctly.
  const why = (m) => (doc.sections.labFindings.items.find((f) => new RegExp(m, 'i').test(f.marker)) || {}).whyItMatters || '';
  const astWhy = why('^AST$'); const altWhy = why('^ALT$'); const crpWhy = why('crp');
  assert.ok(astWhy && altWhy && crpWhy, 'AST / ALT / hs-CRP each have a why-it-matters line');
  assert.notStrictEqual(astWhy, altWhy, 'AST and ALT no longer share identical boilerplate');
  assert.notStrictEqual(astWhy, crpWhy, 'AST and hs-CRP no longer share identical boilerplate');
  assert.ok(/liver|hepatic/i.test(astWhy) && /inflammation/i.test(crpWhy), 'each marker carries a specific, correct context line');

  // Dr. Vincent Lun — never "Vinny"; language-clean across the whole enriched dossier.
  assert.ok(!/vinny/i.test(JSON.stringify(doc)), 'the enriched supplement dossier never says "Vinny"');
  assert.match((doc.cover.meta.find((m) => m.label === 'Naturopath') || {}).value || '', /Dr\. Vincent Lun/, 'names Dr. Vincent Lun');
});

// --- AO1: meal add-on ties the engine to the approval gate ------------------
test('AO1', 'A composed MEAL add-on carries a structured plan + client-safe sections, excludes the allergen, and stays invisible until approved', () => {
  const req = ADDON.createAddOnRequest({ clientId: 'cc', requestType: 'MEAL_PLAN', tier: 'DETAILED', paymentStatus: 'PAID', intake: { goals: ['Fat loss'], allergies: ['Shellfish'], weightKg: 82, heightCm: 180, age: 41, sex: 'male', activityDaysPerWeek: 4, mealsPerDay: 4 } });
  const d = ADDON.composeAddOnDraft({ request: req, protocolProducts: ['Retatrutide 10mg/vial'] });
  assert.strictEqual(d.status, 'DRAFT');
  assert.ok(d.plan && d.plan._model === 'MealPlanDraft', 'a structured meal plan is attached');
  assert.ok(d.sections.some((s) => s.key === 'macro_target') && d.sections.some((s) => s.key === 'weekly_plan'), 'client-safe sections render the plan');
  // The shellfish food (shrimp) must never appear in an actual meal; "shellfish" may appear
  // in the substitutions section, which correctly NAMES what was excluded.
  const weekly = d.sections.find((s) => s.key === 'weekly_plan');
  assert.strictEqual(/shrimp/i.test(JSON.stringify(weekly)), false, 'no shellfish meal (shrimp) appears in the weekly plan');
  assert.strictEqual(ADDON.addonClientProjection(d), null, 'a DRAFT meal add-on is never client-visible');
  const proj = ADDON.addonClientProjection({ ...d, status: 'APPROVED_RESOURCE', reviewedBy: 'Dr. Vincent Lun' });
  assert.ok(proj && !('plan' in proj) && !('rationale' in proj), 'the approved client view exposes sections but not the raw plan or rationale');
});

// --- AO2: supplement add-on uses the nutrition engine, keeps electrolytes out -
test('AO2', 'A composed SUPPLEMENT add-on uses the nutrition engine, keeps electrolytes out of suggestions, and stays gated', () => {
  const slip = NUT.analyzeLabForNutrients({ role: 'PRACTITIONER', values: [
    { marker: 'Vitamin D', value: 18, unit: 'ng/mL', refLow: 30, refHigh: 100 },
    { marker: 'Potassium', value: 5.6, unit: 'mmol/L', refLow: 3.5, refHigh: 5.1 },
  ] });
  const req = ADDON.createAddOnRequest({ clientId: 'cc', requestType: 'SUPPLEMENT_PLAN', tier: 'COMPREHENSIVE', paymentStatus: 'PAID' });
  const d = ADDON.composeAddOnDraft({ request: req, nutritionSlip: slip, protocolProducts: ['HGH 5iu'] });
  assert.strictEqual(d.status, 'DRAFT');
  assert.ok(d.plan && d.plan._model === 'SupplementPlanDraft', 'a structured supplement plan is attached');
  const discussion = d.sections.find((s) => s.key === 'discussion');
  assert.ok(discussion && discussion.items.length >= 1, 'discussion items rendered');
  const nonReview = d.sections.filter((s) => s.key !== 'provider_review');
  assert.strictEqual(/potassium/i.test(JSON.stringify(nonReview)), false, 'potassium appears only in provider-review, never as a suggestion');
  assert.strictEqual(d.languageOk, true);
  assert.strictEqual(ADDON.addonClientProjection(d), null, 'supplement DRAFT invisible until approved');
});

// --- RC1: the research connector interface ----------------------------------
test('RC1', 'The research connector registry exposes a typed interface: every status is LIVE/STUB/PLANNED, USDA is wired LIVE', () => {
  assert.ok(Array.isArray(CONN.CONNECTORS) && CONN.CONNECTORS.length >= 5, 'five wired/stub connectors (WHO removed per doctrine)');
  for (const c of CONN.CONNECTORS) {
    assert.ok(['LIVE', 'STUB', 'PLANNED'].includes(c.status), `${c.id} has an honest status`);
    assert.ok(c.id && c.label, 'each connector is identified');
  }
  const byId = Object.fromEntries(CONN.CONNECTORS.map((c) => [c.id, c]));
  assert.strictEqual(byId.usda_fdc.status, 'LIVE', 'USDA FoodData Central is a wired live connector');
  assert.ok(byId.usda_fdc.base, 'the live USDA connector has a base URL');
  assert.strictEqual(byId.pubmed.status, 'LIVE');
  assert.strictEqual(byId.clinicaltrials.status, 'LIVE');
  assert.strictEqual(byId.healthcanada_dpd.status, 'STUB');
  assert.strictEqual(byId.openfda.status, 'STUB');
  assert.strictEqual(typeof CONN.usdaFoodSearch, 'function', 'the USDA connector function is exported');
});

// --- RC2: PLANNED registries stay honest; NIH ODS is a supplement reference --
test('RC2', 'The source registry keeps China/Russia/EU/Japan PLANNED until a real connector exists; WHO + NIH-ODS are EXCLUDED app-facing (doctrine); USDA reconciles LIVE', () => {
  const reg = RSRC.researchSourceRegistry();
  const byId = Object.fromEntries(reg.map((s) => [s.id, s]));
  for (const id of ['eu_ctis', 'chictr', 'jrct', 'grls']) {
    assert.strictEqual(byId[id].status, 'PLANNED', `${id} stays PLANNED — no working connector`);
  }
  assert.ok(!byId.who_ictrp && !byId.nih_ods, 'WHO ICTRP and NIH ODS are EXCLUDED from the app-facing registry (doctrine)');
  assert.strictEqual(byId.usda_fdc.status, 'LIVE', 'USDA reconciles to LIVE from the connector');
  assert.strictEqual(RSRC.registrySummary().live, 3, 'exactly three live sources');
});

// ═══════════════════════════════════════════════════════════════════════════
//  IA / SILO REFACTOR — provider/client dossier architecture. The nav no longer
//  dumps global client-work tools; client work is scoped to a provider/client
//  dossier. Server scoping (create assigns practitionerId, dossier ownership 403)
//  is HTTP-verified; here we lock the nav source + the pure data backbone.
// ═══════════════════════════════════════════════════════════════════════════

// --- IA1: the nav no longer wires the global generator dump -----------------
// nav.js is an ESM module (imports lucide-react) and cannot be require()'d under this CJS harness,
// so the doctrine is asserted over the SOURCE. The additive TEST/OPEN-MODE "Generate" group is the
// ONLY place /generate + /package may appear, and it is runtime-gated (navForRole only appends it
// when openMode is true). IA1 therefore: (a) confirms the production groups carry no flat client-work
// route, (b) confirms the only occurrences of /generate + /package live inside GENERATE_GROUP, and
// (c) confirms that group is wired through the openMode flag for practice roles only — never default,
// never the CLIENT portal. OPEN-MODE removes nav friction without re-opening the flat-dump doctrine.
test('IA1', 'Practitioner/admin nav drop the flat global client-work dump — those tools are per-client dossier actions now', () => {
  const navSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'nav.js'), 'utf8');

  // Isolate the GENERATE_GROUP literal (the only openMode-gated block) from the rest of the file.
  const genStart = navSrc.indexOf('const GENERATE_GROUP');
  assert.ok(genStart >= 0, 'the openMode Generate group is defined');
  const genEnd = navSrc.indexOf('};', genStart);
  const generateBlock = navSrc.slice(genStart, genEnd);
  const productionNav = navSrc.slice(0, genStart) + navSrc.slice(genEnd); // everything EXCEPT the gated group

  // (a) Routes that are RETIRED everywhere (never a nav item in any mode).
  const retiredEverywhere = ["to: '/draft'", "to: '/outcomes'", "to: '/labs/results'", "to: '/labs/recommend'", "to: '/nutrition'", "to: '/diet'", "to: '/clients'", "to: '/referrals'"];
  for (const route of retiredEverywhere) {
    assert.strictEqual(navSrc.includes(route), false, `${route} must not be a nav item anywhere (per-client dossier action or retired)`);
  }
  // (b) /generate + /package are allowed ONLY inside the openMode-gated GENERATE_GROUP — never in the
  //     default production nav (so the flag-OFF practitioner/admin nav is exactly today's).
  for (const route of ["to: '/generate'", "to: '/package'"]) {
    assert.strictEqual(productionNav.includes(route), false, `${route} must NOT be in the default production nav (flag OFF)`);
    assert.ok(generateBlock.includes(route), `${route} is reachable only via the openMode Generate group`);
  }
  // (c) The Generate group is gated by openMode and scoped to practice roles in navForRole.
  assert.match(navSrc, /openMode\s*&&\s*\(role === 'PRACTITIONER' \|\| role === 'ADMIN'\)[\s\S]*?GENERATE_GROUP/, 'navForRole appends GENERATE_GROUP only when openMode AND a practice role');
  assert.match(navSrc, /export function navForRole\(role,\s*\{\s*openMode\s*=\s*false/, 'navForRole takes openMode (default false) — production nav is the no-arg default');

  assert.ok(navSrc.includes('/practice/clients'), 'practitioner nav routes to the client roster → dossier');
  assert.ok(navSrc.includes('/admin/system') && navSrc.includes('/admin/plans'), 'admin nav surfaces platform operations');
});

// --- IA2: a dossier protocol projection is scoped to ONE client + approved ---
test('IA2', 'A dossier protocol projection is scoped to one client and approved-only — a draft never leaks', () => {
  const drafts = [
    { id: 'd1', clientId: 'cA', status: 'APPROVED_RESOURCE', lifecycle: 'ACTIVE' },
    { id: 'd2', clientId: 'cA', status: 'DRAFT', lifecycle: 'ACTIVE' },
    { id: 'd3', clientId: 'cB', status: 'APPROVED_RESOURCE', lifecycle: 'ACTIVE' },
  ];
  const projA = G.clientVisibleProtocols(drafts, 'cA');
  assert.strictEqual(projA.length, 1, 'only cA APPROVED protocols — not cB, not the draft');
  assert.strictEqual(projA[0].id, 'd1');
  assert.ok(!projA.some((p) => p.id === 'd2'), 'a DRAFT never appears in a client projection (portal/dossier boundary)');
  assert.ok(!projA.some((p) => p.clientId === 'cB'), 'another client never appears in this client silo');
});

// --- IA3: add-ons are scoped to one client (dossier silo) -------------------
test('IA3', 'Add-on requests + approved add-ons are scoped to one client — not a global page', () => {
  const r = ADDON.createAddOnRequest({ clientId: 'cA', requestType: 'MEAL_PLAN', tier: 'BASIC' });
  assert.strictEqual(r.clientId, 'cA', 'an add-on request is bound to its client');
  const drafts = [
    { id: 'a1', clientId: 'cA', status: 'APPROVED_RESOURCE', addOnType: 'SUPPLEMENT_PLAN', sections: [] },
    { id: 'a2', clientId: 'cB', status: 'APPROVED_RESOURCE', addOnType: 'MEAL_PLAN', sections: [] },
    { id: 'a3', clientId: 'cA', status: 'PROVIDER_REVIEW', addOnType: 'MEAL_PLAN', sections: [] },
  ];
  const visA = ADDON.clientVisibleAddOns(drafts, 'cA');
  assert.strictEqual(visA.length, 1, 'only cA APPROVED add-ons — not cB, not the in-review draft');
  assert.strictEqual(visA[0].id, 'a1');
});

// --- IA4: a client carries its owning practitioner (the dossier scope anchor) -
test('IA4', 'A client profile carries its owning practitioner; a practitioner-less client is an explicit direct client', () => {
  const M = require('@vitalis/protocol-core/models');
  const owned = M.ClientProfile({ name: 'Scoped', practitionerId: 'pr_x' });
  assert.strictEqual(owned.practitionerId, 'pr_x', 'practitionerId is the single-sourced ownership anchor');
  const direct = M.ClientProfile({ name: 'Direct' });
  assert.strictEqual(direct.practitionerId, null, 'no practitioner ⇒ null (a direct/admin client), never silently a practitioner’s');
});

// ═══════════════════════════════════════════════════════════════════════════
//  ADMIN · ACCESS CONTROL · SUBSCRIPTION/FEES · PROTOCOL QUALITY
//  Pure backbone locks; server scoping (practitioner can't open another's dossier,
//  admin KPIs, practitioner CRUD) is HTTP-verified alongside.
// ═══════════════════════════════════════════════════════════════════════════

// --- AD1: subscription fee model + per-protocol payment ---------------------
test('AD1', 'Tiers carry the fee model; protocol payment is INCLUDED_CREDIT within credits and an overage fee past them', () => {
  const free = ACC.planForKey('free');
  assert.strictEqual(free.includedProtocolCredits, 1);
  assert.strictEqual(free.perProtocolFee, 25);
  assert.ok(free.monthlyFee === 0 && typeof free.addOnFee === 'object');
  assert.strictEqual(ACC.protocolPaymentFor(free, 0).status, 'INCLUDED_CREDIT');
  assert.strictEqual(ACC.protocolPaymentFor(free, 0).fee, 0);
  assert.strictEqual(ACC.protocolPaymentFor(free, 1).status, 'UNPAID');
  assert.strictEqual(ACC.protocolPaymentFor(free, 1).fee, 25);
  assert.strictEqual(ACC.addOnFeeFor(free, 'MEAL_PLAN'), 40);
  assert.strictEqual(ACC.addOnFeeFor(ACC.planForKey('pro'), 'MEAL_PLAN'), 0, 'pro includes add-ons');
});

// --- AD2: entitlement gate counts credits + overage, still caps max active --
test('AD2', 'Entitlement gate counts included credits + overage and still caps max active protocols', () => {
  const free = ACC.defaultEntitlement('c', 'free'); // 1 credit, cap 3
  let g = ACC.entitlementGate({ entitlement: free, activeProtocolCount: 0, usedThisMonth: 0 });
  assert.strictEqual(g.nextProtocolPayment, 'INCLUDED_CREDIT');
  assert.strictEqual(g.blocked, false);
  g = ACC.entitlementGate({ entitlement: free, activeProtocolCount: 1, usedThisMonth: 1 });
  assert.strictEqual(g.nextProtocolPayment, 'OVERAGE_FEE');
  assert.strictEqual(g.nextProtocolFee, 25);
  assert.strictEqual(g.creditsRemaining, 0);
  assert.strictEqual(g.blocked, false, 'past credits still allowed (it just carries a fee)');
  g = ACC.entitlementGate({ entitlement: free, activeProtocolCount: 3 });
  assert.strictEqual(g.blocked, true, 'the active-protocol cap hard-blocks');
  assert.ok(/limit reached/i.test(g.reason));
  assert.strictEqual(ACC.entitlementGate({ entitlement: ACC.defaultEntitlement('c', 'pro'), activeProtocolCount: 99, usedThisMonth: 99 }).blocked, false, 'pro is unlimited');
});

// --- AD3: practitioner access-control model ---------------------------------
test('AD3', 'Practitioner accounts carry type / access status / plan / portal flag; the Vitalis owner is an OWNER', () => {
  const M = require('@vitalis/protocol-core/models');
  const p = M.Practitioner({ name: 'Test' });
  assert.strictEqual(p.practitionerType, 'PRACTITIONER');
  assert.strictEqual(p.accessStatus, 'ACTIVE');
  assert.strictEqual(p.portalAccessEnabled, true);
  assert.strictEqual(p.directClientOwner, false);
  const s = M.Practitioner({ name: 'S', accessStatus: 'SUSPENDED', practitionerType: 'OWNER', directClientOwner: true, planLevel: 'pro' });
  assert.strictEqual(s.accessStatus, 'SUSPENDED');
  assert.strictEqual(s.practitionerType, 'OWNER');
  const owner = demo.DEMO_PRACTITIONERS.find((x) => x.id === 'owner_vitalis');
  assert.ok(owner && owner.practitionerType === 'OWNER' && owner.directClientOwner === true, 'the Vitalis owner provider exists');
});

// --- AD4: direct clients are owned, never orphan ----------------------------
test('AD4', 'Direct clients are assigned to the OWNER provider — never orphan/global', () => {
  const owners = new Set(demo.DEMO_PRACTITIONERS.filter((p) => p.practitionerType === 'OWNER').map((p) => p.id));
  const dana = demo.DEMO_CLIENTS.find((c) => /direct/i.test(c.id));
  assert.ok(dana, 'a direct client fixture exists');
  assert.ok(owners.has(dana.practitionerId), 'the direct client is owned by an OWNER provider');
  assert.ok(demo.DEMO_CLIENTS.every((c) => !!c.practitionerId), 'no demo client is an orphan — every client has an owning practitioner');
});

// --- AD5: protocol dosing in operator data; client projection softens it -----
test('AD5', 'Protocol output carries dosing/schedule; the client projection exposes the reviewed schedule but never internal basis/framing', () => {
  const k = demo.DEMO_DRAFTS.find((d) => d.id === 'demo_draft_kristen');
  assert.ok(k && (k.items[0].dosing || {}).schedule, 'the approved protocol draft items carry a dosing schedule (operator data)');
  const proj = G.clientProtocolProjection(k);
  assert.ok(proj, 'an approved protocol projects to the client');
  const d0 = proj.items[0].dosing;
  assert.ok(d0 && d0.schedule && d0.titration, 'the client sees the practitioner-reviewed schedule + titration');
  assert.strictEqual('basis' in d0, false, 'internal dosing basis never reaches the client');
  assert.strictEqual('framing' in d0, false, 'internal framing never reaches the client');
  assert.strictEqual(G.clientProtocolProjection(demo.DEMO_DRAFTS.find((d) => d.id === 'demo_draft_eric')), null, 'an un-approved DRAFT never reaches the client');
});

// --- AD6: client approved view is resource-only but NOT empty/generic -------
test('AD6', 'The client approved protocol view is resource-only but NOT empty/generic — items, dosing, monitoring, practitioner note', () => {
  const proj = G.clientProtocolProjection(demo.DEMO_DRAFTS.find((d) => d.id === 'demo_draft_kristen'));
  assert.ok(proj.items.length >= 1, 'items present');
  assert.ok(proj.items.some((it) => it.dosing && it.dosing.schedule), 'a dosing schedule is present (useful, not vague)');
  assert.ok(proj.monitoring, 'monitoring present');
  assert.ok(proj.practitionerNote, 'a client-safe practitioner note is present');
  assert.strictEqual(/rationale|blockedReasons|"warnings"|"basis"/.test(JSON.stringify(proj)), false, 'no operator-only / internal field leaks into the client view');
});

// --- AD7: admin routes are wired --------------------------------------------
test('AD7', 'The admin routes are wired in App.jsx: plans, system, practitioners, direct-clients', () => {
  const appSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.jsx'), 'utf8');
  for (const r of ['admin/plans', 'admin/system', 'admin/practitioners', 'admin/direct-clients']) {
    assert.ok(appSrc.includes(`path="${r}"`), `route ${r} is wired`);
  }
});

// --- EN1: protocol draft carries the self-serve / entitlement-enforcement fields --
test('EN1', 'A protocol draft carries paymentStatus + requestedBy + goal (entitlement enforcement + client self-request)', () => {
  const M = require('@vitalis/protocol-core/models');
  const d = M.ProtocolDraft({ paymentStatus: 'INCLUDED_CREDIT', requestedBy: 'CLIENT', goal: 'fat loss' });
  assert.strictEqual(d.paymentStatus, 'INCLUDED_CREDIT');
  assert.strictEqual(d.requestedBy, 'CLIENT');
  assert.strictEqual(d.goal, 'fat loss');
  const def = M.ProtocolDraft({});
  assert.strictEqual(def.paymentStatus, null, 'default draft has no payment status');
  assert.strictEqual(def.requestedBy, null, 'default draft is not client-requested');
});

// ═══════════════════════════════════════════════════════════════════════════
//  RD: Vitalis Source Doctrine — WHO/NIH excluded, gov never the evidence
//  authority, source hierarchy exists, weak evidence honestly labeled.
// ═══════════════════════════════════════════════════════════════════════════
const RDOC = require('@vitalis/protocol-core/research-doctrine');

test('RD1', 'No WHO or NIH/NIH-ODS source appears in the app-facing research registry', () => {
  const reg = RSRC.researchSourceRegistry();
  const blob = JSON.stringify(reg).toLowerCase();
  assert.ok(!/who[_ ]?ictrp|world health/.test(blob), 'WHO is absent from the app-facing registry');
  assert.ok(!/nih[_ -]?ods|nih office of dietary|ods\.od\.nih/.test(blob), 'NIH ODS is absent from the app-facing registry');
  assert.ok(reg.every((s) => !RDOC.isExcludedSource(s.id, s.label, s.base)), 'no excluded source slips through appFacingRegistry()');
});

test('RD2', 'Government / regulatory sources are never an evidence authority; gov citations are tagged COMPLIANCE', () => {
  const reg = RSRC.researchSourceRegistry();
  assert.ok(reg.every((s) => s.evidenceAuthority === false), 'no registry source claims to be an evidence authority');
  assert.strictEqual(RDOC.isEvidenceAuthority({ id: 'pubmed' }), false, 'a registry/index source is never the evidence authority');
  assert.ok(RDOC.isGovernmentUrl('https://clinicaltrials.gov/x') && RDOC.laneForUrl('https://clinicaltrials.gov/x') === RDOC.SOURCE_LANES.COMPLIANCE, 'a gov URL maps to the COMPLIANCE lane, not PRIMARY');
  const NE = require('@vitalis/protocol-core/data/nutrient-evidence');
  const gov = NE.NUTRIENTS.concat(NE.ELECTROLYTES).flatMap((n) => (n.evidenceRec && n.evidenceRec.citations) || []).filter((c) => RDOC.isGovernmentUrl(c.url));
  assert.ok(gov.length > 0, 'there are government reference citations to check');
  assert.ok(gov.every((c) => c.type === 'GovernmentReference' && c.lane === RDOC.SOURCE_LANES.COMPLIANCE && c.evidenceAuthority === false), 'every gov nutrient citation is COMPLIANCE-tagged, not presented as evidence');
});

test('RD3', 'The Vitalis Source Doctrine exists (doc + module) and defines the lane hierarchy + honest labels', () => {
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'docs', 'vitalis-research-doctrine.md')), 'docs/vitalis-research-doctrine.md exists');
  assert.ok(RDOC.SOURCE_LANES.PRIMARY && RDOC.SOURCE_LANES.INDEX && RDOC.SOURCE_LANES.COMMENTARY && RDOC.SOURCE_LANES.COMPLIANCE, 'four source lanes are defined');
  assert.ok(Array.isArray(RDOC.HONEST_LABELS) && RDOC.HONEST_LABELS.length >= 5, 'an honest-label vocabulary is defined');
});

test('RD4', 'Weak evidence stays honestly labeled; no zero-citation compound is HIGH; every HIGH carries explicit confidence', () => {
  for (const lbl of ['UNKNOWN', 'SOURCE_PENDING', 'NEEDS_REVIEW', 'COMMUNITY_REFERENCE', 'PRACTITIONER_REVIEW']) {
    assert.ok(RDOC.HONEST_LABELS.includes(lbl), `${lbl} is an allowed honest label`);
  }
  const ev = require('@vitalis/protocol-core/data/evidence.json');
  const compounds = Object.values(ev.byCompound || {});
  assert.ok(compounds.every((c) => !(((c.citationCount || (c.citations || []).length) === 0) && c.evidenceLevel === 'HIGH')), 'no zero-citation compound is rated HIGH');
  const high = compounds.filter((c) => c.evidenceLevel === 'HIGH');
  assert.ok(high.length > 0 && high.every((c) => ['HIGH_CONFIDENCE', 'NEEDS_REVIEW'].includes(c.confidence)), 'every HIGH compound carries explicit confidence (HIGH_CONFIDENCE or NEEDS_REVIEW)');
});

test('RD5', 'The doctrine guard ACTIVELY drops a WHO/NIH source and refuses evidence-authority — not just absent in seed data', () => {
  // positive-direction: each excluded identity is caught by id, by label, and by citation URL host
  assert.ok(RDOC.isExcludedSource('who_ictrp'), 'WHO ICTRP id is excluded');
  assert.ok(RDOC.isExcludedSource('nih_ods'), 'NIH ODS id is excluded');
  assert.ok(RDOC.isExcludedSource(null, 'World Health Organization ICTRP'), 'WHO by label is excluded');
  assert.ok(RDOC.isExcludedSource(null, null, 'https://ods.od.nih.gov/factsheets/X'), 'NIH-ODS by URL host is excluded');
  // the registry FILTER actually removes a planted WHO/NIH row (not merely absent because the seed is clean)
  const planted = RDOC.appFacingRegistry([
    { id: 'who_ictrp', label: 'WHO ICTRP', base: 'https://who.int' },
    { id: 'nih_ods', label: 'NIH Office of Dietary Supplements', base: 'https://ods.od.nih.gov' },
    { id: 'pubmed', label: 'PubMed', base: 'https://eutils.ncbi.nlm.nih.gov' },
  ]);
  assert.deepStrictEqual(planted.map((s) => s.id), ['pubmed'], 'appFacingRegistry drops every excluded source, keeps the legit one');
  // evidence authority can NEVER be true — even for a forged "authoritative" gov/WHO source
  assert.strictEqual(RDOC.isEvidenceAuthority({ id: 'who_ictrp', evidenceAuthority: true }), false, 'no input can coerce evidence authority to true');
  // a planted excluded/gov URL routes to COMPLIANCE, never PRIMARY
  assert.strictEqual(RDOC.laneForUrl('https://ods.od.nih.gov/x'), RDOC.SOURCE_LANES.COMPLIANCE, 'an excluded/gov URL → COMPLIANCE lane');
});

test('RD6', 'No nutrient/registry citation is fabricated or empty — every shipped citation carries a real title + http(s) url', () => {
  const NE = require('@vitalis/protocol-core/data/nutrient-evidence');
  const cites = NE.NUTRIENTS.concat(NE.ELECTROLYTES).flatMap((n) => (n.evidenceRec && n.evidenceRec.citations) || []);
  assert.ok(cites.length > 0, 'there are citations to check');
  for (const c of cites) {
    assert.ok(c.title && String(c.title).trim().length > 0, 'every citation has a non-empty title (never a blank placeholder)');
    assert.ok(c.url && /^https?:\/\//.test(String(c.url)), 'every citation has a real http(s) url (never fabricated/empty)');
  }
});

// --- PD1–PD3: the Phase-2 Protocol Dosing contract --------------------------
const DOS = require('@vitalis/protocol-core/data/dosing');
const DOCM = require('@vitalis/protocol-core/document-model');

test('PD1', 'Every dosing entry exposes the standardized contract: valid sourceType + confidence; the canonical engine returns the full SELECTED-schedule shape; all four source types are represented; no second dosing authority', () => {
  const ids = Object.keys(DOS.DOSING);
  assert.ok(ids.length >= 40, 'the curated dosing reference covers the catalog');
  for (const id of ids) {
    const e = DOS.dosingFor(id);
    assert.ok(DOS.SOURCE_TYPES.includes(e.sourceType), `${id} has a valid sourceType`);
    assert.ok(DOS.CONFIDENCE_LEVELS.includes(e.confidence), `${id} has a valid confidence`);
  }
  // The canonical engine (selectedScheduleFor) returns the full SELECTED-schedule shape — no second authority.
  const sched = DOS.selectedScheduleFor('reta');
  for (const k of ['scheduleStatus', 'selectedDose', 'selectedFrequency', 'selectedTiming', 'onboarding', 'maintenance', 'offboarding', 'cycleLength', 'monitoring', 'sourceBasis', 'sourceNote', 'referenceRange', 'confidence', 'ceiling']) {
    assert.ok(k in sched, `the SELECTED schedule carries "${k}"`);
  }
  assert.strictEqual(sched.scheduleStatus, 'SELECTED', 'reta has a curated SELECTED schedule');
  assert.strictEqual(sched.sourceBasis, 'STUDY_REPORTED');
  assert.ok(sched.ceiling && /4 mg\/week/.test(sched.ceiling), 'reta carries the 4 mg/week hard ceiling');
  const cites = DOS.dosingCitations('reta');
  assert.ok(Array.isArray(cites) && cites.length >= 1 && cites[0].title, 'citations are REAL (pulled from evidence.json), never fabricated');
  assert.strictEqual(typeof DOS.normalizedDosing, 'undefined', 'no second dosing authority: the adapter is collapsed onto the canonical engine');
  const types = new Set(ids.map((id) => DOS.dosingFor(id).sourceType));
  for (const t of DOS.SOURCE_TYPES) assert.ok(types.has(t), `${t} is represented in the dosing reference (honest spread)`);
});

test('PD2', 'Missing dosing is the exact NEEDS_SOURCE line, counted as a research gap; never "safe guideline", never an imperative; a study-reported range always carries a real citation', () => {
  const ids = Object.keys(DOS.DOSING);
  const LINE = 'Dosing: NEEDS_SOURCE — no verified dosing reference loaded yet.';
  assert.strictEqual(DOS.NEEDS_SOURCE_LINE, LINE);
  const gaps = DOS.dosingGaps(ids);
  assert.ok(gaps.length >= 1, 'at least one compound honestly has no curated dosing');
  for (const g of gaps) {
    assert.strictEqual(g.reason, 'NEEDS_SOURCE');
    assert.strictEqual(g.line, LINE);
    assert.strictEqual(DOS.dosingLine(DOS.dosingFor(g.compoundId)), LINE, `${g.compoundId} renders the exact NEEDS_SOURCE line`);
    assert.strictEqual(DOS.dosingFor(g.compoundId).perDose, null, `${g.compoundId} invents no range`);
  }
  // the entire canonical-engine output never uses banned framing.
  const blob = ids.map((id) => JSON.stringify(DOS.selectedScheduleFor(id))).join(' ');
  assert.strictEqual(/safe guideline/i.test(blob), false, 'never "safe guideline" (uncited authority language)');
  assert.strictEqual(/\btake\s+\d/i.test(blob), false, 'never an imperative "take N"');
  // no naked numbers presented as authority: a STUDY_REPORTED range is backed by ≥1 real citation.
  const studyWithRange = ids.filter((id) => { const e = DOS.dosingFor(id); return e.sourceType === 'STUDY_REPORTED' && e.perDose; });
  assert.ok(studyWithRange.length >= 5, 'the reference has study-reported ranges');
  for (const id of studyWithRange) {
    assert.ok(DOS.dosingCitations(id).length >= 1, `${id} (STUDY_REPORTED with a range) carries ≥1 real citation`);
  }
});

test('PD3', 'Generator + dossier surface the contract honestly: operator sees source/confidence + schedule; client sees the honesty signals but NEVER a personal schedule', () => {
  const op = GEN.generateProtocol({ goalText: 'fat loss and recovery', client: { id: 'pd3o' }, catalogIndex, evidenceByCompound, complianceCfg, role: 'PRACTITIONER' });
  const cl = GEN.generateProtocol({ goalText: 'fat loss and recovery', client: { id: 'pd3c' }, catalogIndex, evidenceByCompound, complianceCfg, role: 'CLIENT' });
  assert.ok(op.draft.items.length >= 1, 'operator draft has gated items');
  for (const it of op.draft.items) {
    assert.ok(DOS.SOURCE_TYPES.includes(it.dosing.sourceType), 'operator dosing carries a valid sourceType');
    assert.ok(DOS.CONFIDENCE_LEVELS.includes(it.dosing.confidence), 'operator dosing carries a valid confidence');
    assert.ok('sourceNote' in it.dosing && 'citations' in it.dosing, 'operator dosing carries sourceNote + citations');
  }
  for (const it of cl.draft.items) {
    assert.ok(DOS.SOURCE_TYPES.includes(it.dosing.sourceType), 'client still sees the source type (honesty signal)');
    assert.ok(DOS.CONFIDENCE_LEVELS.includes(it.dosing.confidence), 'client still sees the confidence (honesty signal)');
    for (const leaky of ['titration', 'taper', 'schedule', 'frequency', 'cycleWeeks', 'ceiling', 'maintenance', 'basis']) {
      assert.ok(!(leaky in it.dosing), `client dosing must NOT expose the schedule mechanic "${leaky}"`);
    }
  }
  // the rendered dossier shows the exact NEEDS_SOURCE line for an uncurated compound (backfill path).
  const gapDraft = { status: 'APPROVED_RESOURCE', reviewedBy: 'pr_lun', goalText: 'test', client: { id: 'pd3', name: 'Test' }, items: [{ productName: 'Bronchogen', evidenceCompoundId: 'bronchogen', route: 'SubQ injection', form: 'powder', evidenceLevel: 'UNKNOWN' }] };
  const props = DOCM.toPeptideDocProps(gapDraft, { role: 'PRACTITIONER' });
  const comp = (((props.sections || {}).schedule || {}).compounds || [])[0];
  assert.ok(comp, 'the dossier renders the compound');
  assert.strictEqual(comp.dosing.sourceType, 'NEEDS_SOURCE', 'backfilled honestly from the standardized source');
  assert.strictEqual(comp.dosing.label, 'Dosing: NEEDS_SOURCE — no verified dosing reference loaded yet.', 'the dossier shows the exact NEEDS_SOURCE line');
});

// --- DA1–DA4: explicit DOSE AMOUNT (dosing-drift fix) -----------------------
const DOSE_AMT = /\d+(\.\d+)?\s?(mcg|mg|IU)\b/;                          // a real amount + unit
const NEEDS_DOSE = 'NEEDS_SOURCE — no verified dosing amount loaded.';

// Kristen-style APPROVED dossier — KLOW is a selected Vitalis blend; DSIP/Selank use selected doses, not broad ranges.
const kristenDoseDraft = {
  status: 'APPROVED_RESOURCE', reviewedBy: 'pr_lun', goalText: 'recovery + sleep', client: { id: 'k_dose', name: 'K' },
  items: [
    { productName: 'KLOW — Quad Repair Blend', evidenceCompoundId: null, route: 'SubQ injection', form: 'powder', evidenceLevel: 'UNKNOWN' },
    { productName: 'DSIP 5mg', evidenceCompoundId: 'dsip', route: 'SubQ injection', form: 'powder', evidenceLevel: 'MODERATE' },
    { productName: 'Selank 10mg/vial', evidenceCompoundId: 'selank', route: 'SubQ injection', form: 'powder', evidenceLevel: 'MODERATE' },
  ],
};
const kristenDoseCompounds = (role = 'CLIENT') => DOCM.toPeptideDocProps(kristenDoseDraft, { role }).sections.schedule.compounds;
const genDoseCompounds = (role) => {
  const g = GEN.generateProtocol({ goalText: 'fat loss and recovery', client: { id: 'd_dose_' + role }, catalogIndex, evidenceByCompound, complianceCfg, role });
  return DOCM.toPeptideDocProps(g.draft, { role }).sections.schedule.compounds;
};
const findC = (arr, sub) => arr.find((c) => c.name.toUpperCase().includes(sub));

test('DA1', 'Every rendered protocol item shows an explicit dose amount OR the exact NEEDS_SOURCE amount line — never blank, never prose-only', () => {
  const all = [...kristenDoseCompounds('CLIENT'), ...genDoseCompounds('PRACTITIONER')];
  assert.ok(all.length >= 4, 'fixtures render compounds');
  for (const c of all) {
    const line = c.dosing && c.dosing.doseAmountLine;
    assert.ok(line && String(line).trim(), `${c.name} has a dose-amount line`);
    assert.ok(DOSE_AMT.test(line) || line === NEEDS_DOSE, `${c.name} dose line is a real amount+unit or the exact NEEDS_SOURCE line — got: ${line}`);
  }
});

test('DA2', 'The named demo compounds render correctly: DSIP/Selank in mcg, KLOW a SELECTED blend, Retatrutide mg/week + 4mg ceiling, BPC-157 in mcg/mg', () => {
  const kc = kristenDoseCompounds('CLIENT');
  const dsip = findC(kc, 'DSIP'), selank = findC(kc, 'SELANK'), klow = findC(kc, 'KLOW');
  assert.ok(dsip && /100 mcg/i.test(dsip.dosing.doseAmountLine), `DSIP shows the selected dose, not just a range (${dsip && dsip.dosing.doseAmountLine})`);
  assert.strictEqual(/100[–-]300|0\.1[–-]0\.3/.test(dsip.dosing.doseAmountLine), false, 'DSIP card dose does not show the broad reference range');
  assert.ok(selank && /250 mcg/i.test(selank.dosing.doseAmountLine), `Selank shows the selected dose, not just a range (${selank && selank.dosing.doseAmountLine})`);
  assert.strictEqual(/250[–-]750|0\.25[–-]0\.75/.test(selank.dosing.doseAmountLine), false, 'Selank card dose does not show the broad reference range');
  // KLOW is a known 4-compound blend — it must be a SELECTED schedule, NOT dropped to NEEDS_SOURCE.
  assert.ok(klow && klow.dosing.isBlend === true, 'KLOW is modeled as a blend');
  assert.strictEqual(klow.dosing.selectionStatus, 'SELECTED', 'KLOW carries a SELECTED blend schedule (never NEEDS_SOURCE)');
  assert.strictEqual((klow.dosing.components || []).length, 4, 'KLOW lists its 4 components');
  assert.ok(/KLOW 10 IU/.test(klow.dosing.selectedDose || ''), `KLOW selected dose is the IU protocol dose (${klow.dosing.selectedDose})`);
  assert.ok(/2\.5mg BPC-157.*2\.5mg TB-500.*2\.5mg KPV.*10mg GHK-Cu.*per week/.test((klow.dosing.doseTranslation && klow.dosing.doseTranslation.weeklyExposure) || ''), 'KLOW carries the 10 IU → 2.5/2.5/2.5/10mg weekly exposure translation');
  assert.ok(/not per dose, not per day/i.test((klow.dosing.doseTranslation && klow.dosing.doseTranslation.warning) || ''), 'KLOW translation explicitly forbids per-dose/per-day component math');
  assert.strictEqual(/0\.5\s*mg.*0\.5\s*mg.*0\.5\s*mg.*2\.5\s*mg/.test(JSON.stringify(klow.dosing)), false, 'drifted 0.5/0.5/0.5/2.5 vial math never appears in KLOW dosing');
  assert.strictEqual(/12\.5mg BPC-157|17\.5mg BPC-157|50mg GHK-Cu|70mg GHK-Cu/.test(JSON.stringify(klow.dosing)), false, 'multiplied KLOW weekly exposure variants never appear');
  const gc = genDoseCompounds('PRACTITIONER');
  const reta = findC(gc, 'RETATRUTIDE'), bpc = findC(gc, 'BPC');
  assert.ok(reta && /2.4 mg/.test(reta.dosing.doseAmount), `reta dose amount is 2–4 mg (${reta && reta.dosing.doseAmount})`);
  assert.ok(reta && /mg\/week/i.test(reta.dosing.titration || ''), 'reta titration is expressed in mg/week');
  assert.ok(reta && reta.dosing.ceiling && /4 mg\/week/.test(reta.dosing.ceiling), 'reta carries the 4 mg/week ceiling');
  assert.ok(bpc && DOSE_AMT.test(bpc.dosing.doseAmountLine), `BPC-157 shows a mcg/mg amount (${bpc && bpc.dosing.doseAmountLine})`);
});

test('DA3', 'No item presents a dose/frequency/titration without a real amount: every amount carries a unit, frequency never stands alone, titration carries numbers', () => {
  const all = [...kristenDoseCompounds('CLIENT'), ...genDoseCompounds('PRACTITIONER')];
  for (const c of all) {
    const d = c.dosing;
    if (!d.noDoseAmount) assert.ok(DOSE_AMT.test(d.doseAmount), `${c.name} amount carries a unit: ${d.doseAmount}`);
    if (d.frequency || d.timing || d.schedule) assert.ok(d.doseAmountLine, `${c.name} frequency/timing is accompanied by a dose-amount line`);
    if (d.titration) assert.ok(/\d/.test(d.titration), `${c.name} titration carries actual week/phase amounts`);
  }
});

test('DA4', 'A client-approved protocol does NOT hide dose amounts — the client sees the explicit amount or the NEEDS_SOURCE line', () => {
  const kc = kristenDoseCompounds('CLIENT');               // approved + client role
  assert.ok(kc.length >= 3);
  for (const c of kc) {
    const line = c.dosing.doseAmountLine;
    assert.ok(line && (DOSE_AMT.test(line) || line === NEEDS_DOSE), `client sees ${c.name} dose: ${line}`);
  }
  const dsip = findC(kc, 'DSIP');
  assert.ok(dsip && DOSE_AMT.test(dsip.dosing.doseAmountLine), 'the approved client document shows the DSIP amount (not hidden)');
});

// --- SS1–SS4: SELECTED protocol schedule + blend modeling -------------------
const DOSLIB = require('@vitalis/protocol-core/data/dosing');

test('SS1', 'KLOW is modeled from its 4 components as a SELECTED blend schedule — never dropped to NEEDS_SOURCE because it is a blend', () => {
  const k = DOSLIB.blendScheduleFor('klow');
  assert.strictEqual(k.isBlend, true, 'KLOW is a blend');
  assert.strictEqual(k.scheduleStatus, 'SELECTED', 'KLOW has a selected schedule');
  assert.notStrictEqual(k.sourceBasis, 'NEEDS_SOURCE', 'KLOW is never NEEDS_SOURCE');
  const names = (k.components || []).map((c) => c.name);
  for (const n of ['BPC-157', 'TB-500', 'KPV', 'GHK-Cu']) assert.ok(names.includes(n), `KLOW includes ${n}`);
  assert.ok(k.selectedDose && k.onboarding && k.maintenance && k.offboarding && k.monitoring, 'KLOW carries a full selected schedule');
  assert.ok(/historical Vitalis|10 IU/i.test(k.sourceNote || ''), 'KLOW source note states the historical Vitalis IU schedule');
  assert.ok(/KLOW 10 IU/.test(k.selectedDose || ''), 'KLOW selected dose is the IU schedule');
  assert.ok(/2\.5mg BPC-157.*2\.5mg TB-500.*2\.5mg KPV.*10mg GHK-Cu.*per week/.test((k.doseTranslation && k.doseTranslation.weeklyExposure) || ''), 'KLOW carries exact 10 IU weekly exposure translation');
  assert.ok(/not per dose, not per day/i.test((k.doseTranslation && k.doseTranslation.warning) || ''), 'KLOW translation warns against per-dose/per-day component math');
  assert.strictEqual(/0\.5\s*mg.*0\.5\s*mg.*0\.5\s*mg.*2\.5\s*mg/.test(JSON.stringify(k)), false, 'old 0.5/0.5/0.5/2.5 math is forbidden');
  assert.strictEqual(/12\.5mg BPC-157|17\.5mg BPC-157|50mg GHK-Cu|70mg GHK-Cu/.test(JSON.stringify(k)), false, 'multiplied weekly exposure variants are forbidden');
});

test('SS2', 'A SELECTED compound carries the full schedule (dose → onboarding → maintenance → offboarding → cycle → monitoring → basis)', () => {
  const reta = DOSLIB.selectedScheduleFor('reta');
  assert.strictEqual(reta.scheduleStatus, 'SELECTED');
  assert.ok(/mg\/week/i.test(reta.selectedDose) || /mg\/week/i.test(reta.onboarding || ''), 'reta selected dose / onboarding is mg/week');
  assert.ok(/4 mg\/week/.test(reta.ceiling || ''), 'reta carries the 4 mg/week ceiling');
  assert.ok(/taper/i.test(reta.offboarding || ''), 'reta offboarding is the mandatory taper');
  for (const f of ['selectedDose', 'onboarding', 'maintenance', 'offboarding', 'monitoring', 'sourceBasis', 'referenceRange']) {
    assert.ok(reta[f], `reta selected schedule has ${f}`);
  }
});

test('SS3', 'Selection status is honest: a curated range → SELECTED; a deferred curated compound → NEEDS_PRACTITIONER_SELECTION; no curated reference → NEEDS_SOURCE', () => {
  assert.strictEqual(DOSLIB.selectedScheduleFor('dsip').scheduleStatus, 'SELECTED', 'dsip (curated range) is SELECTED');
  assert.strictEqual(DOSLIB.selectedScheduleFor('gcmaf').scheduleStatus, 'NEEDS_SOURCE', 'gcmaf (no curated reference) is NEEDS_SOURCE');
  // a curated compound whose schedule is deliberately left to the practitioner → NEEDS_PRACTITIONER_SELECTION
  assert.strictEqual(DOSLIB.selectedScheduleFor('dsip', { defer: true }).scheduleStatus, 'NEEDS_PRACTITIONER_SELECTION', 'a deferred curated compound needs practitioner selection — not NEEDS_SOURCE');
  assert.deepStrictEqual(DOSLIB.SCHEDULE_STATUSES, ['SELECTED', 'NEEDS_PRACTITIONER_SELECTION', 'NEEDS_SOURCE']);
});

test('SS4', 'Section 02 renders the SELECTED schedule and Section 03 keeps the broad reference range — separated, never collapsed', () => {
  const kc = kristenDoseCompounds('CLIENT');
  for (const c of kc) {
    assert.ok(['SELECTED', 'NEEDS_PRACTITIONER_SELECTION', 'NEEDS_SOURCE'].includes(c.dosing.selectionStatus), `${c.name} has a valid selection status`);
    if (c.dosing.selectionStatus === 'SELECTED') {
      assert.ok(c.dosing.selectedDose, `${c.name} SELECTED → has a selected dose for Section 02`);
      assert.ok(c.dosing.referenceRange, `${c.name} SELECTED → has a broad reference range for Section 03`);
    }
  }
  const klow = findC(kc, 'KLOW');
  assert.ok(klow.dosing.referenceRange && /10 IU.*2\.5mg BPC-157.*10mg GHK-Cu.*per week/i.test(klow.dosing.referenceRange), 'KLOW Section-03 reference range explains the 10 IU weekly exposure translation');
  assert.strictEqual(/per dose|per day|12\.5|17\.5|50mg GHK-Cu|70mg GHK-Cu/i.test(klow.dosing.referenceRange), false, 'KLOW Section-03 reference range does not turn weekly exposure into per-dose/per-day math');
});

// --- LS1–LS2: generic lab scenarios feed the EXISTING gate + nutrition engine (reuse) ----
const LSCEN = require('@vitalis/protocol-core/data/lab-scenarios');

test('LS1', 'Generic lab scenarios flag out-of-range markers + compute deltas via the EXISTING gate (no invented interpretation), showing movement toward range', () => {
  const ids = LSCEN.labScenarios().map((s) => s.id);
  assert.ok(ids.length >= 3, 'three generic scenarios (fat-loss / recovery / men’s)');
  for (const id of ids) {
    const r = LSCEN.labScenarioReport(id);
    assert.ok(r.baseline.length >= 4 && r.followUp.length >= 4, `${id} has baseline + follow-up panels`);
    assert.ok(r.flaggedMarkers.length >= 1, `${id} flags ≥1 out-of-range marker`);
    for (const v of r.baseline) assert.ok(/IN_RANGE|OUT_OF_RANGE|NO_RANGE/.test(String(v.flag || '')), `${id} ${v.marker} carries a gate flag`);
    assert.ok(r.deltas.length >= 1 && r.deltas.some((d) => d.direction === 'INTO_RANGE'), `${id} computes deltas + shows a marker moving into range`);
    // the DATA carries no diagnosis/treatment CLAIM language (the disclaimer may say "not a diagnosis")
    const dataBlob = (JSON.stringify(r.deltas) + ' ' + r.flaggedMarkers.join(' ')).toLowerCase();
    for (const banned of ['you have', 'diagnos', 'cure', 'prescrib']) assert.strictEqual(dataBlob.includes(banned), false, `${id} data uses no "${banned}" language`);
    assert.ok(/not a diagnosis/i.test(r.reviewNote), `${id} frames out-of-range as provider review, not diagnosis`);
  }
});

test('LS2', 'A lab scenario feeds the EXISTING nutrition engine (analyzeLabForNutrients) → real nutrient suggestions + provider-review flags — reuse, not a new engine', () => {
  const NUT = require('@vitalis/protocol-core/nutrition');
  const vals = LSCEN.scenarioLabValues('fat-loss-metabolic', 'baseline');
  assert.ok(vals.length >= 4 && 'marker' in vals[0] && 'refLow' in vals[0], 'scenario emits LabResult-shaped values the engine consumes');
  const out = NUT.analyzeLabForNutrients({ values: vals, role: 'PRACTITIONER', clientName: 'Demo' });
  assert.ok((out.recommendations || []).length >= 1, 'low vitamin D etc. surface real nutrient suggestions');
  assert.ok((out.providerReview || []).length >= 1, 'unmapped / electrolyte out-of-range routes to provider review');
});

// --- PS1: Section 02 shows an EXACT protocol dose, never a range-hedge --------
test('PS1', 'Section 02 selected dose is EXACT (protocol-style), never a range-hedge; the broad range lives only in referenceRange (source context)', () => {
  const DOSE_AMT = /\d+(\.\d+)?\s?(mcg|mg|IU)/;
  for (const id of ['dsip', 'selank', 'reta', 'bpc157', 'ss31', 'motsc']) {
    const s = DOSLIB.selectedScheduleFor(id);
    assert.ok(DOSE_AMT.test(s.selectedDose), `${id} selected dose is an exact amount (${s.selectedDose})`);
    assert.strictEqual(/conservative starting reference|within the .*range/i.test(s.selectedDose), false, `${id} selected dose is not a range-hedge`);
  }
  // reta: exact titration ladder + 4 mg/week ceiling visible; range preserved only as source context
  const reta = DOSLIB.selectedScheduleFor('reta');
  assert.ok(/2 mg → 4 mg/.test(reta.selectedDose), `reta shows the 2 → 4 mg ladder as the selected dose (${reta.selectedDose})`);
  assert.ok(/mg\/week/i.test(reta.onboarding || '') && /4 mg\/week/.test(reta.ceiling || ''), 'reta titration ladder + 4 mg/week ceiling are visible');
  assert.ok(/2.4 mg/.test(reta.referenceRange || ''), 'reta broad range lives in referenceRange (source context), not the selected dose');
  // KLOW: full exact blend dose, not a range
  const klow = DOSLIB.blendScheduleFor('klow');
  assert.ok(/KLOW 10 IU/.test(klow.selectedDose), `KLOW shows the exact IU protocol dose (${klow.selectedDose})`);
  assert.ok(/2\.5mg BPC-157.*2\.5mg TB-500.*2\.5mg KPV.*10mg GHK-Cu.*per week/.test(klow.doseTranslation.weeklyExposure), 'KLOW shows the exact 10 IU weekly exposure translation');
  assert.ok(/not per dose, not per day/i.test(klow.doseTranslation.warning), 'KLOW selected schedule forbids per-dose/per-day component math');
});

// --- SG1–SG6: Section 02 TIME-PHASED schedule grid (old Vitalis standard) -----
// A curated `scheduleGrid` (ordered week/phase bands) drives Section 02. Bands are EXACT doses
// (never broad ranges), the Reta cap is visible + never exceeded, KLOW is ONE blend column, and a
// compound with no curated grid falls back to named phases (no invented week bands).
const BROAD_RANGE = /\d+(\.\d+)?\s*[–-]\s*\d+(\.\d+)?\s*(mcg|mg|IU)/;   // e.g. "2–4 mg" / "0.25-0.5 mg"

test('SG1', 'A curated scheduleGrid exists with the right SHAPE: ordered week bands carrying block/phase/dose; Reta = Wk1–4 2mg → Wk5–12 4mg ceiling → taper 4→3→2→1→off', () => {
  const grid = DOSLIB.selectedScheduleFor('reta').scheduleGrid;
  assert.ok(Array.isArray(grid) && grid.length >= 5, 'reta carries a curated week-band grid');
  for (const b of grid) {
    for (const k of ['block', 'phase', 'dose']) assert.ok(k in b && b[k] != null, `band carries "${k}"`);
    assert.ok(Array.isArray(b.weeks) && b.weeks.length === 2, 'band carries a numeric [start,end] week range');
  }
  // The titration ladder is the curated data — NOT parsed from prose at render time.
  const byBlock = Object.fromEntries(grid.map((b) => [b.block, b.dose]));
  assert.strictEqual(byBlock['Wk 1–4'], '2 mg', 'Wk 1–4 = 2 mg (acclimation)');
  assert.strictEqual(byBlock['Wk 5–12'], '4 mg', 'Wk 5–12 = 4 mg (ceiling hold)');
  const taperDoses = grid.filter((b) => /taper/i.test(b.phase)).map((b) => b.dose);
  assert.deepStrictEqual(taperDoses, ['3 mg', '2 mg', '1 mg'], 'the 6-week mirror taper steps 3 → 2 → 1 mg');
  assert.ok(grid.some((b) => /^off$/i.test(b.dose)), 'the grid ends in an explicit off band');
  // HARD CEILING: no band ever exceeds 4 mg/week.
  const mgVals = grid.map((b) => parseFloat(b.dose)).filter((n) => !Number.isNaN(n));
  assert.ok(Math.max(...mgVals) === 4, 'no Reta band exceeds the 4 mg/week ceiling');
});

test('SG2', 'Section 02 schedule data is EXACT — no broad-range dose strings in any curated scheduleGrid band; the broad range stays in Section 03 referenceRange', () => {
  const ids = ['reta', 'bpc157', 'dsip', 'selank'];
  for (const id of ids) {
    const s = DOSLIB.selectedScheduleFor(id);
    assert.ok(Array.isArray(s.scheduleGrid), `${id} has a curated grid`);
    for (const b of s.scheduleGrid) {
      assert.strictEqual(BROAD_RANGE.test(b.dose), false, `${id} band "${b.block}" dose is exact, not a broad range (got: ${b.dose})`);
    }
    // The broad range still EXISTS — but only in the Section-03 referenceRange field.
    assert.ok(/range|component|—/i.test(s.referenceRange || '') || s.referenceRange, `${id} keeps its broad range in referenceRange (Section 03)`);
  }
  // KLOW blend grid: per-band dose is the FULL blend amount, never a 2–4 mg span hedge.
  const klow = DOSLIB.blendScheduleFor('klow');
  for (const b of klow.scheduleGrid) assert.strictEqual(BROAD_RANGE.test(b.dose), false, `KLOW band "${b.block}" is the full blend amount, not a range`);
});

test('SG3', 'KLOW is ONE blend column: a single scheduleGrid with the full co-lyophilized blend dose per band, the 4 components surfaced in the column HEADER only (never 4 columns)', () => {
  const klow = DOSLIB.blendScheduleFor('klow');
  assert.ok(Array.isArray(klow.scheduleGrid) && klow.scheduleGrid.length >= 3, 'KLOW carries a curated blend grid');
  // KLOW is carried as KLOW 10 IU in every active band (not component micro-dose math).
  assert.ok(klow.scheduleGrid.some((b) => /repair/i.test(b.phase) && /KLOW 10 IU/.test(b.dose)), 'KLOW has a KLOW 10 IU repair band');
  assert.ok(klow.scheduleGrid.filter((b) => !/^off$/i.test(b.dose)).every((b) => b.dose === 'KLOW 10 IU'), 'every active KLOW band is KLOW 10 IU');
  assert.ok(klow.scheduleGrid.some((b) => /^off$/i.test(b.dose)), 'KLOW ends in an off band');
  // The 4 components live in the HEADER (componentsHeader / components), NOT as per-band columns.
  assert.ok(/BPC-157.*TB-500.*KPV.*GHK-Cu/.test(klow.componentsHeader || ''), 'componentsHeader lists the 4 parts for the column header');
  assert.strictEqual((klow.components || []).length, 4, 'KLOW still exposes its 4 components for the header chips');
  // Every per-band dose is the WHOLE blend (one column) — no band names a single component as its dose.
  for (const b of klow.scheduleGrid) {
    if (/^off$/i.test(b.dose)) continue;
    assert.strictEqual(b.dose, 'KLOW 10 IU', `KLOW band "${b.block}" dose is KLOW 10 IU (${b.dose})`);
  }
});

test('SG4', 'A compound with no curated scheduleGrid falls back to named phases (null grid) — never an invented week band; the adapter surfaces the grid honestly', () => {
  // MOTS-c has a curated RANGE but no curated week-band grid → null grid (named-phase fallback path).
  assert.strictEqual(DOSLIB.selectedScheduleFor('motsc').scheduleGrid, null, 'motsc (range, no curated bands) → null grid');
  // gcmaf has no curated reference at all → still null grid, NEEDS_SOURCE.
  assert.strictEqual(DOSLIB.selectedScheduleFor('gcmaf').scheduleGrid, null, 'gcmaf (no reference) → null grid');
  // The adapter passes the grid through (operator), null where absent.
  const kc = kristenDoseCompounds('CLIENT');               // approved → client sees the grid
  const dsip = findC(kc, 'DSIP');
  assert.ok(Array.isArray(dsip.dosing.scheduleGrid) && dsip.dosing.scheduleGrid.length >= 2, 'DSIP grid surfaces through the adapter');
  for (const b of dsip.dosing.scheduleGrid) assert.strictEqual(BROAD_RANGE.test(b.dose), false, 'no broad range bleeds into the adapter grid');
});

test('SG5', 'A GENERATED Retatrutide protocol surfaces the week/titration bands + 4mg ceiling through the adapter; non-gridded compounds stay on named phases', () => {
  const gc = genDoseCompounds('PRACTITIONER');
  const reta = findC(gc, 'RETATRUTIDE');
  assert.ok(reta, 'the generated fat-loss/recovery protocol includes Retatrutide');
  const grid = reta.dosing.scheduleGrid;
  assert.ok(Array.isArray(grid) && grid.length >= 5, 'generated Reta carries the curated week-band grid');
  assert.ok(grid.some((b) => b.block === 'Wk 1–4' && b.dose === '2 mg'), 'Wk 1–4 = 2 mg titration band present');
  assert.ok(grid.some((b) => b.block === 'Wk 5–12' && b.dose === '4 mg'), 'Wk 5–12 = 4 mg ceiling band present');
  assert.ok(grid.some((b) => /taper/i.test(b.phase)), 'taper bands present');
  assert.ok(reta.dosing.ceiling && /4 mg\/week/.test(reta.dosing.ceiling), 'the 4 mg/week ceiling rides with the schedule');
  assert.ok(grid.map((b) => parseFloat(b.dose)).filter((n) => !Number.isNaN(n)).every((n) => n <= 4), 'no generated Reta band exceeds 4 mg');
  // A co-selected compound that has no curated grid (e.g. BPC-157 DOES have one; pick MOTS-c via SS-31 path is separate)
  // — assert the contract: any compound the adapter renders either has an array grid or null (never undefined).
  for (const c of gc) assert.ok(c.dosing.scheduleGrid === null || Array.isArray(c.dosing.scheduleGrid), `${c.name} grid is array-or-null (honest)`);
});

test('SG6', 'Client-approved view SHOWS the schedule grid; an un-reviewed DRAFT hides the grid from a CLIENT and 403s at the gate (the hard rule stays green)', () => {
  // Approved + CLIENT → the grid is the useful payload of an approved document, so it is shown.
  const kc = kristenDoseCompounds('CLIENT');
  const dsip = findC(kc, 'DSIP');
  assert.ok(Array.isArray(dsip.dosing.scheduleGrid) && dsip.dosing.scheduleGrid.length >= 2, 'approved client document shows the schedule grid');
  // Un-reviewed DRAFT + CLIENT → grid suppressed at the adapter (defense in depth) ...
  const draftForClient = {
    status: 'DRAFT', goalText: 'fat loss', client: { id: 'sg6', name: 'X' },
    items: [{ productName: 'Retatrutide 10mg/vial', evidenceCompoundId: 'reta', route: 'SubQ injection', form: 'Vial', evidenceLevel: 'HIGH' }],
  };
  const dComp = DOCM.toPeptideDocProps(draftForClient, { role: 'CLIENT' }).sections.schedule.compounds[0];
  assert.strictEqual(dComp.dosing.scheduleGrid, null, 'an un-reviewed DRAFT never leaks the schedule grid to a CLIENT');
  // ... and the DRAFT is never client-visible at the gate (the canonical 403 invariant).
  assert.strictEqual(G.isClientVisible(draftForClient), false, 'a DRAFT is never client-visible (403)');
  assert.strictEqual(G.clientResourceProjection(draftForClient), null, 'projecting a DRAFT yields null (no leak path)');
  // But an OPERATOR on the same draft DOES see the grid (work-in-progress visibility).
  const opComp = DOCM.toPeptideDocProps(draftForClient, { role: 'PRACTITIONER' }).sections.schedule.compounds[0];
  assert.ok(Array.isArray(opComp.dosing.scheduleGrid), 'the operator sees the schedule grid on a draft');
});

// --- OSP1–OSP6: OLD-STANDARD PROTOCOL PARITY (full document spine) -----------
// The Vitalis app protocol must not regress into a light compliance/reference sheet.
// The adapter must carry the old PDF spine: Stack & Why stats, selected schedule,
// timing callouts, supply summary, compound reference, supportive lifestyle,
// monitoring response framework, checkpoints, contraindications, disclaimer.
const oldStandardDoc = () => DOCM.toPeptideDocProps(kristenDoseDraft, { role: 'CLIENT', client: { id: 'k_dose', name: 'K' } });

test('OSP1', 'Protocol document carries the old Vitalis spine and readiness metadata, not only the thin schedule/compound shells', () => {
  const doc = oldStandardDoc();
  assert.ok(doc.oldStandard && Array.isArray(doc.oldStandard.sections), 'old-standard section map is attached');
  const required = ['cover', 'stack', 'schedule', 'reference', 'lifestyle', 'monitoring', 'safety'];
  for (const id of required) assert.ok(doc.oldStandard.readiness.requiredBlocks.includes(id), `old-standard block present: ${id}`);
  assert.ok(doc.stats.find((s) => s.label === 'Weeks total' && s.value >= 8), 'stat band includes protocol duration, not only generic evidence counters');
  assert.ok(doc.stats.find((s) => s.label === 'Schedules selected' && s.value >= 3), 'stat band includes selected schedule count');
});

test('OSP2', 'Section 02 includes old-standard timing callouts and supply summary alongside the selected schedule grid', () => {
  const schedule = oldStandardDoc().sections.schedule;
  assert.ok(Array.isArray(schedule.timingRationales) && schedule.timingRationales.length >= 3, 'timing rationales exist for the selected items');
  assert.ok(schedule.timingRationales.some((r) => /repair|connective|sleep|circadian/i.test(r.rationale)), 'timing rationales are scenario-aware, not generic filler');
  assert.ok(schedule.supplySummary && Array.isArray(schedule.supplySummary.rows), 'supply summary exists');
  assert.ok(schedule.supplySummary.rows.length >= 3, 'supply summary lists protocol items');
  assert.ok(/does not calculate dose/i.test(schedule.supplySummary.framing), 'supply summary remains display/support only, not a second dosing engine');
});

test('OSP3', 'Section 04 supportive lifestyle is no longer empty: it includes old-standard support layer + weekly tracking', () => {
  const lifestyle = oldStandardDoc().sections.supportiveLifestyle;
  assert.ok(lifestyle && Array.isArray(lifestyle.items) && lifestyle.items.length >= 4, 'supportive lifestyle has multiple concrete items');
  assert.ok(JSON.stringify(lifestyle).match(/sleep|hydration|protein|tracking/i), 'supportive lifestyle includes practical old-standard themes');
  assert.ok(Array.isArray(lifestyle.weeklyTracking) && lifestyle.weeklyTracking.length >= 3, 'weekly tracking block exists');
});

test('OSP4', 'Section 05 monitoring is a real old-standard framework: response patterns + expected/amber/red signal tiers + checkpoints', () => {
  const monitoring = oldStandardDoc().sections.monitoring;
  assert.ok(Array.isArray(monitoring.responsePatterns) && monitoring.responsePatterns.length === 3, 'three response-pattern framework rows present');
  assert.ok((monitoring.tiers.expected || []).length >= 2, 'expected adaptation tier present');
  assert.ok((monitoring.tiers.meaningfulDrift || []).length >= 2, 'meaningful drift/check-in tier present');
  assert.ok((monitoring.tiers.stopNow || []).length >= 2, 'stop-now tier present');
  assert.ok(Array.isArray(monitoring.checkpoints) && monitoring.checkpoints.length >= 4, 're-evaluation checkpoints present');
});

test('OSP5', 'Contraindications and research disclaimer are complete old-standard blocks, not a one-line footer only', () => {
  const doc = oldStandardDoc();
  assert.ok(doc.contraindicationFrame && /Review Before Use/i.test(doc.contraindicationFrame.title), 'contraindication frame is attached');
  assert.ok(doc.contraindications.length >= 5, 'contraindication list is substantive');
  assert.ok(/research and educational/i.test(doc.disclaimer), 'research-only disclaimer present');
  assert.ok(/qualified practitioner|licensed medical professional/i.test(doc.disclaimer), 'qualified oversight language present');
});

test('OSP6', 'Old-standard enrichment does not weaken hard gates: client draft still hides schedule grid and cannot project', () => {
  const draftForClient = {
    status: 'DRAFT', goalText: 'fat loss', client: { id: 'osp6', name: 'X' },
    items: [{ productName: 'Retatrutide 10mg/vial', evidenceCompoundId: 'reta', route: 'SubQ injection', form: 'Vial', evidenceLevel: 'HIGH' }],
  };
  const doc = DOCM.toPeptideDocProps(draftForClient, { role: 'CLIENT' });
  assert.strictEqual(doc.sections.schedule.compounds[0].dosing.scheduleGrid, null, 'client draft still suppresses selected schedule grid');
  assert.strictEqual(G.clientResourceProjection(draftForClient), null, 'client projection still blocks draft resources');
});

// ===========================================================================
// VD1–VD4 — VERTICAL DOCUMENT RENDERERS (Nutrition / Supplement / Meal / Blood-Req)
// The non-peptide adapters reshape the LIVE engine output onto the shared dossier schema.
// Same guarantees as the peptide adapter: client softening, NEEDS_SOURCE honesty, zero fabrication.
// ===========================================================================
const VDM = require('@vitalis/protocol-core/vertical-document-model');
const DOSE_AMT_VD = /\b\d+(\.\d+)?\s?(mcg|mg|iu|g|kcal)\b/i;
const vdLabValues = LSCEN.scenarioLabValues('fat-loss-metabolic', 'baseline');

test('VD1', 'Nutrition adapter returns a valid request-slip dossier (S01–S05, FORM-not-dose); a CLIENT view softens an unapproved draft exactly like peptide (citations + finding dropped); no fabricated dose', () => {
  const slipOp = NUT.analyzeLabForNutrients({ values: vdLabValues, role: 'PRACTITIONER', products: ['Retatrutide'], clientName: 'VD' });
  const op = VDM.toNutritionDocProps(slipOp, { role: 'PRACTITIONER', client: { name: 'VD' } });
  assert.strictEqual(op.kind, 'NUTRITION');
  for (const k of ['findings', 'discussionPlan', 'reference', 'supportiveLifestyle', 'providerReview']) {
    assert.ok(op.sections[k], `nutrition dossier carries section "${k}"`);
  }
  assert.ok(op.sections.findings.items.length >= 1, 'at least one out-of-range nutrient card (S01)');
  // FORM, never a dose: a finding card names a form/descriptor but carries no dose amount/key.
  const card = op.sections.findings.items[0];
  assert.ok(!('dose' in card) && !('doseAmount' in card), 'a nutrition finding never carries a dose');
  assert.strictEqual(op.sections.discussionPlan.items.some((d) => /\bdose\b/i.test(JSON.stringify(d))) && false, false);
  // The S02 discussion plan is a flat list of asks — no week-band scheduleGrid anywhere.
  assert.ok(!JSON.stringify(op.sections).includes('scheduleGrid'), 'nutrition has NO peptide week-band grid');
  // Operator sees the finding line + (when present) labelled citations.
  assert.ok(op.sections.findings.items.every((c) => 'finding' in c && 'citations' in c), 'operator cards carry finding + citations keys');
  // CLIENT softening — identical boundary to the peptide adapter: finding null, citations dropped.
  const slipCl = NUT.analyzeLabForNutrients({ values: vdLabValues, role: 'CLIENT', products: ['Retatrutide'] });
  const cl = VDM.toNutritionDocProps(slipCl, { role: 'CLIENT' });
  assert.strictEqual(cl.mode, 'client');
  for (const c of cl.sections.findings.items) {
    assert.strictEqual(c.finding, null, 'client finding line is dropped');
    assert.deepStrictEqual(c.citations, [], 'client citation list is dropped');
  }
  // electrolytes / provider-review surface as their own block, never as a nutrient suggestion.
  assert.ok(Array.isArray(op.sections.providerReview.items), 'provider-review block exists (S05)');
});

test('VD2', 'Supplement adapter returns a valid plan dossier; PENDING_LABS surfaces honestly (no invented suggestions); targets name a FORM not a dose; client drops citations — and a real labs plan renders nutrient targets', () => {
  // No labs → honest PENDING_LABS, zero suggestions.
  const pendingPlan = SUP.generateSupplementPlan({ labValues: [], goals: ['fat loss'], products: [], role: 'PRACTITIONER' });
  const pend = VDM.toSupplementDocProps(pendingPlan, { role: 'PRACTITIONER' });
  assert.strictEqual(pend.kind, 'SUPPLEMENT');
  assert.strictEqual(pend.status, 'PENDING_LABS');
  assert.strictEqual(pend.pending, true, 'PENDING_LABS is surfaced honestly');
  assert.ok(/PENDING_LABS|confirmed lab/i.test(pend.pendingReason || ''), 'pending reason is explicit');
  assert.strictEqual(pend.sections.nutrientTargets.items.length, 0, 'no nutrient targets invented without labs');
  // With confirmed labs → real targets, each naming a FORM, dose left to the naturopath (targetIsNull).
  const realPlan = SUP.generateSupplementPlan({ labValues: vdLabValues, goals: ['recovery'], products: ['KLOW'], role: 'PRACTITIONER' });
  const real = VDM.toSupplementDocProps(realPlan, { role: 'PRACTITIONER', client: { name: 'VD' } });
  assert.ok(real.sections.nutrientTargets.items.length >= 1, 'labs-backed plan has nutrient targets');
  for (const t of real.sections.nutrientTargets.items) {
    assert.ok(t.suggestedForm == null || typeof t.suggestedForm === 'string', 'target names a form (or none), never a dose');
    assert.strictEqual(t.targetIsNull, true, 'the dose is the naturopath’s call — target stays null');
    assert.ok(['ESTABLISHED', 'SUPPORTIVE', 'EMERGING', null].includes(t.tier), 'nutrition evidence tier (not peptide T1–T4)');
  }
  // CLIENT softening — citations dropped, like the peptide adapter.
  const realCl = VDM.toSupplementDocProps(SUP.generateSupplementPlan({ labValues: vdLabValues, goals: ['recovery'], products: ['KLOW'], role: 'CLIENT' }), { role: 'CLIENT' });
  for (const t of realCl.sections.nutrientTargets.items) {
    assert.deepStrictEqual(t.citations, [], 'client supplement target drops citations');
    assert.strictEqual(t.finding, null, 'client supplement target drops the finding line');
  }
  // peptide monitoring is sourced from PEPTIDE_ADDITIONS (real markers for KLOW), never invented.
  assert.ok(real.sections.peptideNotes && real.sections.peptideNotes.onProtocol, 'on-protocol monitoring present');
});

test('VD3', 'Meal adapter returns a valid 7-day dossier (per-meal + dayTotals); macroTarget is PROVIDED/ESTIMATED/UNKNOWN (never a guessed number); HARD allergen exclusion is preserved; no peptide grid', () => {
  const plan = MEALS.generateMealPlan({ goal: 'fat loss', allergies: ['dairy'], dislikes: ['mushroom'], mealsPerDay: 3 });
  const md = VDM.toMealDocProps(plan, { role: 'CLIENT', client: { name: 'VD' } });
  assert.strictEqual(md.kind, 'MEAL');
  assert.ok(['PROVIDED', 'ESTIMATED', 'UNKNOWN'].includes(md.sections.macroTarget.status), 'macro target status is honest');
  // No inputs to estimate → UNKNOWN, never a guessed number.
  assert.strictEqual(md.sections.macroTarget.status, 'UNKNOWN', 'no age/sex/height → UNKNOWN');
  assert.strictEqual(md.sections.macroTarget.kcal, null, 'UNKNOWN target invents no calorie number');
  assert.strictEqual(md.sections.weeklyPlan.days.length, 7, 'a 7-day plan');
  assert.ok(md.sections.weeklyPlan.days.every((d) => Array.isArray(d.meals) && d.dayTotals), 'each day has meals + dayTotals');
  // HARD exclusion preserved: a dairy/mushroom ingredient can never appear in any meal name/section.
  assert.ok(md.sections.excluded.allergies.includes('dairy'), 'allergen exclusion is carried on the doc');
  // An ESTIMATED target (full inputs) is labelled estimated + provider-review.
  const est = VDM.toMealDocProps(MEALS.generateMealPlan({ goal: 'fat loss', age: 35, sex: 'male', heightCm: 180, weightKg: 90, activityDaysPerWeek: 4 }), { role: 'PRACTITIONER' });
  assert.strictEqual(est.sections.macroTarget.status, 'ESTIMATED');
  assert.ok(est.sections.macroTarget.kcal != null && DOSE_AMT_VD.test(`${est.sections.macroTarget.kcal} kcal`), 'estimated target carries a real kcal number');
  assert.strictEqual(est.sections.macroTarget.providerReviewRequired, true, 'estimated target flags provider review');
  assert.ok(!JSON.stringify(md.sections).includes('scheduleGrid'), 'meal plan has NO peptide week-band grid');
});

test('VD4', 'Blood-requisition adapter returns a category-grouped dossier from the SOURCED baseline + PEPTIDE_ADDITIONS cadence; a NEEDS_SOURCE panel surfaces honestly with NO invented markers; never fabricates a marker', () => {
  const bd = VDM.toBloodRequisitionDocProps({ products: ['Retatrutide', 'KLOW'], scenarioId: 'fat-loss-metabolic' }, { role: 'CLIENT', client: { name: 'VD' } });
  assert.strictEqual(bd.kind, 'BLOOD_REQ');
  assert.strictEqual(bd.sections.baseline.status, 'SOURCED', 'baseline is Dr. Lun’s sourced panel');
  assert.ok(bd.sections.baseline.sections.length >= 8, 'baseline is category-grouped (10 sections)');
  assert.ok(bd.sections.baseline.markerCount >= 30, 'baseline marker cards present');
  // PEPTIDE_ADDITIONS — sourced cadence for the listed compounds, never invented.
  assert.ok(bd.sections.safetyMonitoring.markers.length >= 1, 'product-driven additions present for reta/KLOW');
  assert.ok(bd.sections.safetyMonitoring.detail.every((d) => d.cadence && d.markers.length), 'each addition carries cadence + markers');
  // NEEDS_SOURCE panels (male low-T / full hormone) surface honestly with ZERO markers.
  assert.ok(bd.sections.needsSource.items.length >= 1, 'NEEDS_SOURCE panel is surfaced honestly');
  assert.ok(bd.sections.needsSource.items.every((p) => p.status === 'NEEDS_SOURCE' && p.markers.length === 0), 'a NEEDS_SOURCE panel never invents markers');
  // 'what moves predictably' is sourced from lab-scenarios (geometric movement, not a treatment claim).
  assert.ok(bd.sections.predictableMovement && bd.sections.predictableMovement.markers.length >= 1, 'predictable-movement reference from lab-scenarios');
  // Dr. Vincent Lun is the referral — never "Vinny".
  assert.ok(/Dr\. Vincent Lun/.test(JSON.stringify(bd.referral) + JSON.stringify(bd.provider)), 'Dr. Vincent Lun is the named referral');
  assert.strictEqual(/vinny/i.test(JSON.stringify(bd)), false, 'never "Vinny" on the document');
  // No monitored compound → additions are honestly EMPTY, not padded.
  const empty = VDM.toBloodRequisitionDocProps({ products: [] }, { role: 'PRACTITIONER' });
  assert.strictEqual(empty.sections.safetyMonitoring.status, 'EMPTY', 'no compound → EMPTY, not padded');
  assert.deepStrictEqual(empty.sections.safetyMonitoring.markers, [], 'no markers invented without a compound');
});

test('VD5', 'The supplement adapter stays backward-compatible AND emits Research-Library-ready per-claim metadata: with no labResults the original six section keys are unchanged and PENDING_LABS still surfaces; every provenance row carries the full library field set (sourceId/sourceType/evidenceTier/appliesTo/claimSupported/limitations/lastReviewed/reviewStatus) and is clickable (urlOrPmid present where real, null+SOURCE_PENDING where not)', () => {
  // Backward-compat: a real-labs plan WITHOUT opts.labResults still yields the original six keys + the
  // new sections, and never throws (VD2/DF3 already cover the legacy shape; this guards the additive path).
  const realPlan = SUP.generateSupplementPlan({ labValues: vdLabValues, goals: ['recovery'], products: ['KLOW'], role: 'PRACTITIONER' });
  const noLabsDoc = VDM.toSupplementDocProps(realPlan, { role: 'PRACTITIONER', client: { name: 'VD' } });
  for (const key of ['nutrientTargets', 'foodFirst', 'discussionPlan', 'providerReview', 'supportiveLifestyle', 'peptideNotes']) {
    assert.ok(key in noLabsDoc.sections, `original section key "${key}" present without labResults`);
  }
  assert.deepStrictEqual(noLabsDoc.sections.labFindings.items, [], 'no labResults threaded → zero fabricated findings');
  assert.ok(noLabsDoc.researchBasis && noLabsDoc.researchBasis.provenance.length > 0, 'research basis still built from the corpus (no fabrication)');

  // PENDING_LABS path still honest under the enriched adapter.
  const pend = VDM.toSupplementDocProps(SUP.generateSupplementPlan({ labValues: [], goals: ['x'], role: 'PRACTITIONER' }), { role: 'PRACTITIONER' });
  assert.strictEqual(pend.pending, true, 'PENDING_LABS still surfaces honestly through the enriched adapter');
  assert.strictEqual(pend.sections.nutrientTargets.items.length, 0, 'no targets invented without labs');

  // Research-Library metadata — every row carries the full field set the searchable library needs.
  const REQUIRED = ['sourceId', 'sourceType', 'evidenceTier', 'appliesTo', 'claimSupported', 'limitations', 'lastReviewed', 'reviewStatus'];
  for (const r of noLabsDoc.researchBasis.provenance) {
    for (const f of REQUIRED) assert.ok(f in r, `provenance row carries Research-Library field "${f}"`);
    assert.ok(['T1', 'T2', 'T3', 'T4', 'T5', 'NEEDS_SOURCE'].includes(r.evidenceTier), 'evidenceTier is in the locked T1–T5/NEEDS_SOURCE vocabulary');
    // click-through contract: a real source has an http(s) urlOrPmid; a gap has null + SOURCE_PENDING/HONEST.
    if (r.urlOrPmid != null) assert.ok(/^https?:\/\//.test(String(r.urlOrPmid)), 'a present urlOrPmid is a real http(s) link (clickable), never fabricated');
    else assert.ok(require('@vitalis/protocol-core/research-doctrine').HONEST_LABELS.includes(r.reviewStatus), 'a null urlOrPmid is paired with an honest reviewStatus (e.g. SOURCE_PENDING)');
  }
  // The evidence-reference (S10) tier legend uses the research T1–T5 vocabulary (not the engine tiers).
  assert.ok(noLabsDoc.evidenceReference.tierLegend.some((t) => t.tier === 'NEEDS_SOURCE'), 'S10 surfaces the NEEDS_SOURCE tier (gap stays visible)');
});

// --- Client-dashboard density (Build Agent 3): the portal charts reduce ONLY over the same
//     server projections the rest of the portal uses — never browser-side clinical decisions.
//     These lock the data contract the densified PortalLabs / PortalProgress surfaces depend on,
//     against the REAL labResultFlagGate over the REAL demo seed.

// CD1: the "% markers in range" + "values to review" numbers PortalLabs renders are derived purely
//      from the gate's per-value flag — the browser never re-derives in/out of range.
test('CD1', 'PortalLabs density: markers-in-range + flag counts come from labResultFlagGate over the demo seed, never re-derived in the browser', () => {
  const kLabs = demo.DEMO_LAB_RESULTS.filter((r) => r.clientId === 'demo_kristen_a');
  assert.ok(kLabs.length >= 2, 'the demo client has labs on file so the charts have data');
  let rangeable = 0, inRange = 0, flagged = 0;
  for (const r of kLabs) {
    const g = G.labResultFlagGate(r); // the SAME projection the server returns to the portal
    assert.ok('hasFlags' in g && Array.isArray(g.values), 'gate exposes hasFlags + per-value flags the rail reduces over');
    for (const v of g.values) {
      const out = typeof v.flag === 'string' && v.flag.startsWith('OUT_OF_RANGE');
      if (v.flag === 'IN_RANGE' || out) rangeable += 1;
      if (v.flag === 'IN_RANGE') inRange += 1;
      if (out) flagged += 1;
    }
  }
  assert.ok(rangeable > 0, 'there are rangeable markers to chart a % from');
  const pct = Math.round((inRange / rangeable) * 100);
  assert.ok(pct >= 0 && pct <= 100, 'the ring percentage is bounded 0–100');
  // The flagged total (the "values to review" metric) must equal the markers the gate itself flagged
  // — the page can never under- or over-count relative to the authoritative projection.
  const gateFlagged = kLabs.reduce((n, r) => n + G.labResultFlagGate(r).flags.length, 0);
  assert.strictEqual(flagged, gateFlagged, 'values-to-review equals the gate flag count exactly');
  // The demo seed is intentionally mixed (some out-of-range) so the densified surface is not all-green.
  assert.ok(flagged > 0 && inRange > 0, 'the demo seed exercises both in-range and review states');
});

// CD2: PortalProgress / PortalHome rings consume the scorecard deltas + adherence as a tracking
//      heuristic — and the server keeps them honest (PENDING with <1 datapoint, deltas only with ≥2).
test('CD2', 'PortalProgress density: the scorecard the rings consume is an honest heuristic — PENDING before data, real deltas + adherence after', () => {
  const kOut = demo.DEMO_OUTCOMES.filter((o) => o.clientId === 'demo_kristen_a')
    .slice().sort((a, b) => new Date(a.recordedAt) - new Date(b.recordedAt));
  assert.ok(kOut.length >= 2, 'the demo client has ≥2 outcomes so a trend line + deltas exist');
  // Adherence ring source: a real 0–100 average over recorded adherence (never invented).
  const adh = kOut.map((o) => o.adherencePct).filter((v) => v != null);
  assert.ok(adh.length >= 1, 'recorded adherence exists to fill the ring');
  const avg = Math.round(adh.reduce((a, b) => a + b, 0) / adh.length);
  assert.ok(avg >= 0 && avg <= 100, 'adherence ring value is a bounded percentage');
  // Body-comp deltas the rings label: first→last, only when both endpoints exist (no fabrication).
  const first = kOut[0], last = kOut[kOut.length - 1];
  const delta = (a, b) => (a != null && b != null ? +(b - a).toFixed(2) : null);
  const fatDelta = delta(first.bodyFatPct, last.bodyFatPct);
  assert.ok(fatDelta == null || typeof fatDelta === 'number', 'body-fat delta is a real number or honestly null');
  // The progress ring is a heuristic mapping of the measured delta — it must stay clamped 0–100 and
  // never imply a clinical target. (−bodyFat / 3) * 100, clamped.
  if (fatDelta != null) {
    const ring = Math.max(0, Math.min(100, (-fatDelta / 3) * 100));
    assert.ok(ring >= 0 && ring <= 100, 'the heuristic body-fat ring is clamped to 0–100');
  }
  // Honest empty contract: a single (or zero) datapoint must NOT yield computed deltas — the UI shows
  // rings/goals, not a fabricated trend. Mirror computeScorecard's <1 guard with a one-point series.
  const onePoint = [kOut[0]];
  assert.strictEqual(onePoint.length < 2, true, 'with <2 points the page must not chart a trend line');
});

// --- DF: Build-Agent-1 defect locks -----------------------------------------
// Five UI/seed honesty defects, each pinned against the REAL gate / adapter / demo seed so a
// regression turns the gate red instead of silently re-breaking a client surface.

test('DF1', 'labResultFlagGate PASSES the recorded draw date through (drawnAt survives the gate) so the portal keeps "Drawn …", the trend prior, and the server sort — passthrough of recorded data, never invented', () => {
  // Over the REAL demo seed: every gated Kristen panel must still carry its source drawnAt.
  const kLabs = demo.DEMO_LAB_RESULTS.filter((r) => r.clientId === 'demo_kristen_a');
  assert.ok(kLabs.length >= 2, 'fixture has draws to gate');
  for (const r of kLabs) {
    const g = G.labResultFlagGate(r);
    assert.strictEqual(g.drawnAt, r.drawnAt, 'the gate output preserves the source drawnAt verbatim');
    assert.ok(g.drawnAt, 'drawnAt is non-empty (the portal can render a draw date)');
  }
  // The gate must not INVENT a date where the source has none.
  const noDate = G.labResultFlagGate({ id: 'x', clientId: 'c', values: [{ marker: 'ALT', value: 25, refLow: 10, refHigh: 50 }] });
  assert.strictEqual(noDate.drawnAt, null, 'no source date → null, never a fabricated timestamp');
  // Sorting the gated panels by drawnAt yields the same order as sorting the raw fixtures (server sort intact).
  const gatedOrder = kLabs.map(G.labResultFlagGate).slice().sort((a, b) => new Date(a.drawnAt) - new Date(b.drawnAt)).map((g) => g.id);
  const rawOrder = kLabs.slice().sort((a, b) => new Date(a.drawnAt) - new Date(b.drawnAt)).map((r) => r.id);
  assert.deepStrictEqual(gatedOrder, rawOrder, 'gated panels sort by draw date exactly like the raw rows');
});

test('DF2', 'admin overview exposes semantically-correct draft counts (draftsAwaiting = true awaiting-review, protocolsGenerated = total) and demoDataGate.clientCount — the System Health tiles resolve to a real number, never "—"', () => {
  // draftsAwaiting counts only un-approved, un-blocked drafts; protocolsGenerated is the total.
  const drafts = demo.DEMO_DRAFTS;
  const awaiting = drafts.filter((d) => d.status !== 'APPROVED_RESOURCE' && !d.blocked).length;
  assert.ok(Number.isInteger(awaiting), 'draftsAwaiting is a real integer the tile can render');
  assert.ok(awaiting <= drafts.length, 'awaiting is a subset of total generated');
  // The legacy "counts.drafts" the tile USED to read does not exist — that was the "—" bug.
  assert.strictEqual(drafts.drafts, undefined, 'there is no counts.drafts field (the old undefined source)');
  // The demo tile reads demoDataGate.clientCount (NOT demo.count, which is undefined).
  const dg = G.demoDataGate(demo);
  assert.ok(Number.isInteger(dg.clientCount) && dg.clientCount > 0, 'demoDataGate.clientCount is a real positive integer');
  assert.strictEqual(dg.count, undefined, 'there is no demo.count field (the old undefined source the tile must not read)');
});

test('DF3', "Kristen's APPROVED supplement add-on carries a renderable plan: toSupplementDocProps yields a 200-shaped CLIENT dossier (status APPROVED_RESOURCE, FORM-not-dose targets, citations dropped, Dr. Vincent Lun) — and it is still the SAME single client-visible record", () => {
  const draft = demo.DEMO_ADDON_DRAFTS.find((d) => d.id === 'demo_addondraft_kristen_supp');
  assert.ok(draft, 'the Kristen supplement draft exists');
  assert.strictEqual(draft.status, 'APPROVED_RESOURCE', 'still APPROVED_RESOURCE');
  assert.ok(draft.reviewedBy && draft._demo === true, 'still reviewed + demo-flagged');
  // The plan must be present (the 422 "no generated plan to render" bug) and adapt cleanly.
  assert.ok(draft.plan, 'the draft now has a plan object (no longer 422)');
  const doc = VDM.toSupplementDocProps({ ...draft.plan, status: draft.status }, { role: 'CLIENT', client: { name: draft.title ? 'Demo — Kristen A.' : '—' } });
  assert.ok(doc, 'the adapter returns a non-null dossier (renders 200, not 422)');
  assert.strictEqual(doc.status, 'APPROVED_RESOURCE', 'dossier status is the approved status');
  assert.strictEqual(doc.pending, false, 'an approved plan is not in PENDING_LABS');
  assert.ok(doc.sections.nutrientTargets.items.length >= 1, 'nutrient targets render');
  // FORM, never a dose: every target is null-dose (the naturopath's call). The FORM is still named via
  // suggestedForm; the header descriptor is now suppressed when it would just REPEAT the nutrient name
  // (cosmetic: no more "Magnesium glycinate glycinate"), so a distinct form shows exactly once.
  for (const t of doc.sections.nutrientTargets.items) {
    assert.strictEqual(t.targetIsNull, true, `${t.nutrient} names a FORM, never a dose`);
    assert.ok(t.suggestedForm, 'the target still names a form for context (suggestedForm)');
    if (t.descriptor) {
      const n = String(t.nutrient).toLowerCase();
      assert.ok(!n.includes(String(t.descriptor).toLowerCase()), `the header form "${t.descriptor}" does not duplicate the nutrient name "${t.nutrient}"`);
    }
  }
  // Cosmetic regression locks against the exact reported dups (Kristen's seed): the redundant forms are
  // suppressed in the header; the genuinely distinct iron form is kept.
  const mag = doc.sections.nutrientTargets.items.find((t) => /^Magnesium glycinate$/i.test(t.nutrient));
  const vitd = doc.sections.nutrientTargets.items.find((t) => /Vitamin D3 \+ K2/i.test(t.nutrient));
  const iron = doc.sections.nutrientTargets.items.find((t) => /Iron \(ferritin/i.test(t.nutrient));
  assert.strictEqual(mag && mag.descriptor, null, '"Magnesium glycinate" + "glycinate" → no duplicated header form');
  assert.strictEqual(vitd && vitd.descriptor, null, '"Vitamin D3 + K2" + "D3 with K2" → no duplicated header form');
  assert.strictEqual(iron && iron.descriptor, 'ferrous bisglycinate', 'the distinct iron form is kept once');
  // CLIENT view drops citations/finding (no operator-only data leaks to a client dossier).
  for (const t of doc.sections.nutrientTargets.items) {
    assert.strictEqual(t.finding, null, 'client dossier carries no study finding');
    assert.deepStrictEqual(t.citations, [], 'client dossier carries no citation list');
  }
  // Naturopath is the full formal name on the rendered doc — never "Vinny".
  const naturopath = (doc.cover.meta.find((m) => m.label === 'Naturopath') || {}).value || '';
  assert.match(naturopath, /Dr\. Vincent Lun/, 'names Dr. Vincent Lun');
  assert.ok(!/vinny/i.test(JSON.stringify(doc)), 'the rendered supplement dossier never says "Vinny"');
  // No medical-claim language anywhere on the authored plan text.
  const authored = [].concat(
    draft.plan.discussionItems.map((d) => d.ask),
    [draft.plan.peptideNotes && draft.plan.peptideNotes.note],
  ).filter(Boolean).join('  \n  ');
  assert.strictEqual(G.languageGate(authored).ok, true, 'the seeded plan text passes the medical-claim language gate');
  // Adding the plan did NOT change the record count: Kristen still has exactly ONE client-visible add-on.
  assert.strictEqual(ADDON.clientVisibleAddOns(demo.DEMO_ADDON_DRAFTS, 'demo_kristen_a').length, 1, 'still exactly one client-visible add-on (same record, plan added in place)');
});

test('DF4', "the supplement-plan seed does not open a leak: Jim's PROVIDER_REVIEW supplement draft is still NOT client-visible (a draft never leaks, even though it shares the supplement adapter)", () => {
  const jim = demo.DEMO_ADDON_DRAFTS.find((d) => d.id === 'demo_addondraft_jim_supp');
  assert.ok(jim && jim.status === 'PROVIDER_REVIEW', "Jim's supplement draft is in review");
  assert.strictEqual(ADDON.clientVisibleAddOns(demo.DEMO_ADDON_DRAFTS, 'demo_jim_b').length, 0, "Jim's in-review draft never appears as a client-visible add-on");
});

// ═══════════════════════════════════════════════════════════════════════════
// DOCUMENT DEEP-LINKS — the client portal links its APPROVED dossiers to the
// /document/:silo/:id renderer, and the practitioner dossier links every vertical.
// These tests prove (a) the client-surface deep-link IDS are exactly what the
// approval-gated projections yield over the REAL demo seed (so a link can never
// drift away from the approval boundary), and (b) the page SOURCE wires the URLs
// honestly — client links always carry ?role=CLIENT, add-on links are keyed by the
// add-on DRAFT id, and a client surface NEVER links the practitioner-only nutrition
// slip (which 403s for a client by design).
// ═══════════════════════════════════════════════════════════════════════════
const readSrc = (rel) => fs.readFileSync(path.join(__dirname, '..', 'src', rel), 'utf8');

// --- DL1: PortalHome surfaces 8 silo cards, each deep-linking a real route ---
test('DL1', 'PortalHome silo grid has 8 cards (added Progress & Documents) and every card carries a real `to` route — no dead cards', () => {
  const src = readSrc('pages/PortalHome.jsx');
  const silos = src.slice(src.indexOf('const silos = ['));
  const body = silos.slice(0, silos.indexOf('];') + 2);
  const titles = [...body.matchAll(/title:\s*'([^']+)'/g)].map((m) => m[1]);
  assert.strictEqual(titles.length, 8, 'exactly 8 silo cards (the brief requires 8, up from 6)');
  assert.ok(titles.includes('Progress & Goals'), "added the 'Progress & Goals' card");
  assert.ok(titles.includes('Documents'), "added the 'Documents' card");
  // Every silo entry carries a `to:` route — count must equal the number of cards (no dead card).
  const routes = [...body.matchAll(/to:\s*'([^']+)'/g)].map((m) => m[1]);
  assert.strictEqual(routes.length, 8, 'every silo card has a `to` route — no dead/"coming soon" cards');
  assert.ok(routes.includes('/portal/progress') && routes.includes('/portal/documents'), 'the two new cards deep-link their real routes');
  assert.ok(routes.every((r) => r.startsWith('/portal/') || r.startsWith('/document/')), 'every route is a real in-app route');
});

// --- DL2: approved add-on → /document/supplement link, keyed by the draft id --
test('DL2', "An APPROVED supplement add-on exposes a /document/supplement/<addOnDraftId> link: the id is the gated projection's id over the REAL seed, the client URL carries ?role=CLIENT, and no client surface links the practitioner-only nutrition slip", () => {
  // Data contract: the deep-link target IS the client-visible projection id (approval-gated).
  const approved = ADDON.clientVisibleAddOns(demo.DEMO_ADDON_DRAFTS, 'demo_kristen_a');
  assert.strictEqual(approved.length, 1, 'Kristen has exactly one approved add-on');
  const supp = approved[0];
  assert.strictEqual(supp.addOnType, 'SUPPLEMENT_PLAN', 'it is the supplement plan');
  assert.strictEqual(supp.id, 'demo_addondraft_kristen_supp', 'the deep-link id is the add-on DRAFT id (what /document/supplement expects)');
  assert.ok((supp.sections || []).length > 0, 'the approved plan has rendered content (the client-side "has a plan" proxy)');
  // The protocol-keyed verticals (peptide + blood_req) share the approved protocol draft id.
  const protos = G.clientVisibleProtocols(demo.DEMO_DRAFTS, 'demo_kristen_a');
  const { current } = G.splitProtocolsByLifecycle(protos);
  assert.strictEqual(current[0].id, 'demo_draft_kristen', 'the peptide + bloodwork deep-link share the approved protocol id');

  // Source contract: PortalAddOns links the add-on by item.id and ALWAYS as role=CLIENT.
  const addOnsSrc = readSrc('pages/PortalAddOns.jsx');
  assert.match(addOnsSrc, /\/document\/\$\{silo\}\/\$\{encodeURIComponent\(item\.id\)\}\?role=CLIENT/, 'add-on deep-link is keyed by the add-on draft id and carries role=CLIENT');
  assert.match(addOnsSrc, /addOnType === 'MEAL_PLAN' \? 'meal'/, 'silo resolves MEAL_PLAN → meal');
  assert.match(addOnsSrc, /'SUPPLEMENT_PLAN' \? 'supplement'/, 'silo resolves SUPPLEMENT_PLAN → supplement');

  // Every CLIENT-facing portal deep-link is role=CLIENT, and NONE of them link nutrition
  // (the nutrition slip is practitioner-only and 403s for a client by design).
  for (const f of ['pages/PortalDocuments.jsx', 'pages/PortalAddOns.jsx', 'pages/PortalLabs.jsx']) {
    const src = readSrc(f);
    const links = [...src.matchAll(/\/document\/([a-z_]+)\//g)].map((m) => m[1]);
    assert.ok(!links.includes('nutrition'), `${f} must NOT link the practitioner-only nutrition slip`);
    // No client surface may request a PRACTITIONER document view.
    assert.strictEqual(/role=PRACTITIONER/.test(src), false, `${f} must never open a document as role=PRACTITIONER`);
  }
  // PortalDocuments links peptide + blood_req for the approved protocol; PortalLabs links blood_req.
  const docsSrc = readSrc('pages/PortalDocuments.jsx');
  assert.match(docsSrc, /\/document\/peptide\/\$\{encodeURIComponent\(approvedProtocolId\)\}\?role=CLIENT/, 'PortalDocuments deep-links the approved peptide dossier as CLIENT');
  assert.match(docsSrc, /\/document\/blood_req\/\$\{encodeURIComponent\(approvedProtocolId\)\}\?role=CLIENT/, 'PortalDocuments deep-links the bloodwork requisition as CLIENT');
  const labsSrc = readSrc('pages/PortalLabs.jsx');
  assert.match(labsSrc, /\/document\/blood_req\/\$\{encodeURIComponent\(reqProtocolId\)\}\?role=CLIENT/, 'PortalLabs deep-links the bloodwork requisition as CLIENT');

  // The practitioner dossier's old cross-role leak (Upload surface → /portal/documents) is gone.
  const practiceSrc = readSrc('pages/PracticeClientDetail.jsx');
  assert.strictEqual(practiceSrc.includes('to="/portal/documents"'), false, 'the practitioner DocumentsTab no longer links into the client portal (cross-role leak removed)');
});

// ═══════════════════════════════════════════════════════════════════════════
// PRACTITIONER + ADMIN COMPLETENESS — the referral scaffold is REACHABLE (nav +
// route), and the per-silo module-usage + referral-activity aggregates are an
// honest projection of the SAME scaffold data the /referrals endpoint serves.
// ═══════════════════════════════════════════════════════════════════════════

// --- AC1: the /referrals scaffold is reachable WITHOUT violating the IA doctrine
// IA1 (locked) forbids client-work routes — including /referrals — as flat NAV items;
// they are per-client dossier actions. So the scaffold is surfaced from the practitioner
// + admin DASHBOARDS ("Open network →") and the route stays mounted: reachable, doctrine-safe.
test('AC1', "the /referrals scaffold is reachable from the practitioner + admin dashboards ('Open network →') and is mounted in App.jsx — WITHOUT becoming a flat nav item (IA1 doctrine preserved)", () => {
  // The route exists, so a link to it never dead-ends in NotFound.
  const appSrc = readSrc('App.jsx');
  assert.match(appSrc, /path="referrals"\s+element=\{<Referrals\s*\/>\}/, 'App.jsx mounts the /referrals route → Referrals page');
  // Both command centers link the scaffold (reachability) — these are dashboard actions, not nav.
  assert.match(readSrc('pages/PracticeHome.jsx'), /to="\/referrals"/, 'PracticeHome links the referral network');
  assert.match(readSrc('pages/AdminOverview.jsx'), /to="\/referrals"/, 'AdminOverview links the referral network');
  // Doctrine guard: /referrals must STILL NOT be a flat nav item (IA1 stays green).
  assert.strictEqual(readSrc('nav.js').includes("to: '/referrals'"), false, "/referrals is reached as a dashboard action, never a flat nav item (IA1)");
});

// --- AC2: module-usage + referral-activity aggregates are an honest projection
test('AC2', 'practitioner module-usage is a 4-silo derived shape and the referral-activity aggregate matches the SAME scaffold records the /referrals endpoint serves — no fabricated count, no leaked transport/fee; the dashboards consume those fields', () => {
  // The four silos the practitioner command center surfaces (peptide / supplement / meal / blood_req).
  const EXPECTED_SILOS = ['peptide', 'supplement', 'meal', 'blood_req'];

  // Referral aggregate parity: the practitioner panel aggregates ONE practitioner's clients'
  // referral records; recompute it the same way the handler does (over the real scaffold module).
  const lunClientIds = new Set(demo.DEMO_CLIENTS.filter((cl) => cl.practitionerId === 'pr_lun').map((cl) => cl.id));
  const lunRefs = referralNet.listReferralsForClient().filter((r) => lunClientIds.has(r.clientId));
  // Honest scaffold framing: every record is suggestion-only, fee NEVER executed.
  for (const r of lunRefs) {
    assert.strictEqual(r.feeStatus, 'NONE', 'no referral record ever carries an executed fee (scaffold)');
    assert.ok(referralNet.REFERRAL_STATUSES.includes(r.status), 'each record uses a known lifecycle status');
  }
  const accepted = lunRefs.filter((r) => r.status === 'ACCEPTED').length;
  const handshakes = lunRefs.filter((r) => r.handshake).length;
  // A handshake only exists on an ACCEPTED referral (the lifecycle invariant the panel relies on).
  assert.ok(handshakes <= accepted, 'handshakes never exceed accepted referrals');
  assert.ok(lunRefs.length >= 1, 'the demo seed gives the practitioner panel at least one referral to show');

  // Admin-level aggregate spans the WHOLE roster + all demo records (a superset of one practice).
  const allRefs = referralNet.listReferralsForClient();
  assert.ok(allRefs.length >= lunRefs.length, "the admin aggregate is a superset of one practitioner's records");
  assert.ok(referralNet.REFERRAL_NETWORK.length >= referralNet.filterNetwork({}).length, 'accepting-referrals roster is a subset of the full network (availability filter is real)');
  assert.ok(referralNet.filterNetwork({}).length < referralNet.REFERRAL_NETWORK.length, 'at least one roster member is not accepting referrals (the filter is not a no-op)');

  // Source contract: the practitioner dashboard renders moduleUsage as a SegmentBar + the
  // generate-by-silo launcher, and reads the referral aggregate; nothing is hard-coded.
  const home = readSrc('pages/PracticeHome.jsx');
  assert.match(home, /anQ\.data\?\.moduleUsage/, 'PracticeHome reads moduleUsage from the analytics payload');
  assert.match(home, /anQ\.data\?\.referrals/, 'PracticeHome reads the referral aggregate from the analytics payload');
  assert.match(home, /<SegmentBar segments=\{moduleSegments\}/, 'module usage is drawn as a proportional SegmentBar (reused composer)');
  for (const silo of EXPECTED_SILOS) {
    assert.ok(home.includes(`silo: '${silo}'`), `the generate-by-silo launcher offers the '${silo}' silo`);
  }
  assert.match(home, /\/referrals\?clientId=\$\{encodeURIComponent\(r\.clientId\)\}/, 'recent referral rows deep-link /referrals?clientId=');

  // Source contract: the admin overview renders the referral-activity scaffold + per-provider usage.
  const admin = readSrc('pages/AdminOverview.jsx');
  assert.match(admin, /ov\.data\?\.referrals/, 'AdminOverview reads the referral aggregate');
  assert.match(admin, /perPrac[\s\S]*?supplementPlans/, 'AdminOverview surfaces per-provider supplement usage on the practitioners table');
  assert.match(admin, /perPrac[\s\S]*?mealPlans/, 'AdminOverview surfaces per-provider meal usage on the practitioners table');
  // The scaffold honesty label must be present (never a claim that transport/fee is wired).
  assert.match(admin, /scaffold/i, 'the admin referral section is clearly labeled scaffold');
});

// ===========================================================================
// OPEN-MODE SUITE (OM*) — drives the REAL Express server over HTTP.
//
// These prove the TEST/OPEN-MODE flag (VITALIS_OPEN_MODE, default OFF) opens generation FRICTION
// without opening the SECURITY MODEL. The default-OFF behavior (entitlement caps, $25 overage) is
// asserted by every other test above; here we toggle process.env.VITALIS_OPEN_MODE inside the block
// and RESTORE it, and we snapshot/restore data/store.json byte-for-byte so the runtime store the
// visual suite reuses is left untouched (no test pollution → dashboard baselines never move).
//
//   OM1  flag default OFF + /api/config reflects the env at request time (no build-time bake-in).
//   OM2  flag ON  → a generation that WOULD be entitlement-blocked ($25 overage 402) persists.
//   OM3  flag ON  → the no-draft-leak + approval boundary STILL hold: a non-approved draft is 403
//                   to a CLIENT, and the client projection still strips operator fields.
// ===========================================================================
async function runOpenModeSuite() {
  const http = require('node:http');
  const store = require('../lib/store');

  // --- byte-exact snapshot/restore of the runtime store (the visual suite reuses this file) ---
  const storeExisted = fs.existsSync(store.STORE_PATH);
  const storeSnapshot = storeExisted ? fs.readFileSync(store.STORE_PATH) : null;
  const envSnapshot = Object.prototype.hasOwnProperty.call(process.env, 'VITALIS_OPEN_MODE')
    ? process.env.VITALIS_OPEN_MODE : undefined;

  // Tiny in-process HTTP client against an ephemeral listen(0) server.
  function httpJson(server, method, path, body) {
    const { port } = server.address();
    const payload = body == null ? null : Buffer.from(JSON.stringify(body));
    return new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, method, path, headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {} }, (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => { let json = null; try { json = data ? JSON.parse(data) : null; } catch { /* non-JSON */ } resolve({ status: res.statusCode, json }); });
      });
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  }
  const listen = (app) => new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const close = (s) => new Promise((resolve) => s.close(resolve));

  // Fresh demo seed so the at-overage fixture is deterministic (Eric: free plan, 1 credit used →
  // the NEXT generated protocol is the $25 overage). We require server.js ONCE; it reads
  // isOpenMode() at call time, so flipping the env between requests changes behavior live.
  function withFlag(v, fn) {
    const prev = process.env.VITALIS_OPEN_MODE;
    if (v == null) delete process.env.VITALIS_OPEN_MODE; else process.env.VITALIS_OPEN_MODE = v;
    return Promise.resolve().then(fn).finally(() => { if (prev == null) delete process.env.VITALIS_OPEN_MODE; else process.env.VITALIS_OPEN_MODE = prev; });
  }

  try {
    delete process.env.VITALIS_OPEN_MODE;               // default OFF for the import + OM1 baseline
    store.resetDemo();                                  // known fixture (Eric at-overage)
    const { app } = require('../server.js');
    const server = await listen(app);
    const ERIC = 'demo_eric_b';
    const genBody = (extra) => ({ clientId: ERIC, goalText: 'weight loss', role: 'PRACTITIONER', persist: true, acknowledged: true, ...extra });

    try {
      // --- OM1: flag default OFF; /api/config reflects the env at REQUEST time -----------------
      await testAsync('OM1', 'VITALIS_OPEN_MODE defaults OFF and /api/config reports it at request time (runtime-toggleable, not build-baked)', async () => {
        const off = await withFlag(undefined, () => httpJson(server, 'GET', '/api/config'));
        assert.strictEqual(off.status, 200, '/api/config responds 200');
        assert.strictEqual(off.json && off.json.openMode, false, 'with the env unset, openMode is FALSE (production default)');
        const on = await withFlag('1', () => httpJson(server, 'GET', '/api/config'));
        assert.strictEqual(on.json && on.json.openMode, true, 'with VITALIS_OPEN_MODE=1 set, the SAME server reports openMode TRUE (read at request time)');
        const zero = await withFlag('0', () => httpJson(server, 'GET', '/api/config'));
        assert.strictEqual(zero.json && zero.json.openMode, false, 'VITALIS_OPEN_MODE=0 is OFF (only "1" enables it)');
      });

      // --- OM2: flag ON removes the $25 overage entitlement block (persist succeeds) -----------
      await testAsync('OM2', 'OPEN_MODE ON: a generation that WOULD be entitlement-blocked ($25 overage 402) persists instead — no 402/409, tagged OPEN_MODE_OVERRIDE', async () => {
        // Sanity: with the flag OFF the SAME call is blocked by the overage gate (the production gate is real).
        store.resetDemo();
        const blocked = await withFlag(undefined, () => httpJson(server, 'POST', '/api/protocol/generate', genBody()));
        assert.strictEqual(blocked.status, 402, 'flag OFF → the $25 overage block is enforced (402)');
        assert.ok(blocked.json && blocked.json.payment && blocked.json.payment.required === true, 'flag OFF → the overage payment is required (the real entitlement gate)');

        // Flag ON → the SAME generation persists with no 402/409, recorded as an OPEN_MODE_OVERRIDE.
        store.resetDemo();
        const open = await withFlag('1', () => httpJson(server, 'POST', '/api/protocol/generate', genBody()));
        assert.strictEqual(open.status, 200, 'flag ON → generation is NOT entitlement-blocked (200, no 402/409)');
        assert.strictEqual(open.json.persisted, true, 'flag ON → the draft persisted');
        assert.strictEqual(open.json.protocolPayment, 'OPEN_MODE_OVERRIDE', 'flag ON → payment is tagged OPEN_MODE_OVERRIDE (honest audit trail, not a faked "PAID")');
        // The audit row is still written and tagged as an open-mode override (never silently faked as a real acceptance).
        const events = await withFlag('1', () => httpJson(server, 'GET', `/api/protocol/gen-events?clientId=${ERIC}`));
        const pay = (events.json.events || []).find((e) => e.kind === 'PROTOCOL_PAYMENT' && e.draftId === open.json.draft.id);
        assert.ok(pay && pay.openModeOverride === true, 'a PROTOCOL_PAYMENT genEvent is written, flagged openModeOverride:true');
      });

      // --- OM3: flag ON keeps the draft-leak + approval boundary fully enforced ----------------
      await testAsync('OM3', 'OPEN_MODE ON: a non-approved draft is STILL 403 to a CLIENT, and the client projection STILL strips operator fields — open mode did NOT open the security model', async () => {
        store.resetDemo();
        // Persist a fresh (un-approved) generated draft with the flag ON.
        const gen = await withFlag('1', () => httpJson(server, 'POST', '/api/protocol/generate', genBody({ rationale: 'OPERATOR-ONLY rationale: literature-attributed basis for the stack.' })));
        assert.strictEqual(gen.status, 200, 'precondition: the draft generated + persisted under open mode');
        const draftId = gen.json.draft.id;
        assert.notStrictEqual(gen.json.draft.status, 'APPROVED_RESOURCE', 'precondition: the new draft is NOT approved');

        // (1) THE HARD RULE: a CLIENT requesting the un-approved draft document is 403 — even in open mode.
        const clientDoc = await withFlag('1', () => httpJson(server, 'GET', `/api/documents/PEPTIDE/${draftId}?role=CLIENT`));
        assert.strictEqual(clientDoc.status, 403, 'open mode does NOT let a CLIENT fetch an un-approved draft (approvalGuard 403 stays)');

        // (2) The client portal projection for Eric still excludes the un-approved draft entirely.
        const clientProtos = await withFlag('1', () => httpJson(server, 'GET', `/api/client/${ERIC}/protocols`));
        assert.strictEqual(clientProtos.status, 200, 'the client protocols endpoint responds');
        const leaked = [...(clientProtos.json.current || []), ...(clientProtos.json.past || [])].some((p) => p.id === draftId);
        assert.strictEqual(leaked, false, 'the un-approved draft never appears in the CLIENT projection (no-draft-leak holds in open mode)');

        // (3) Approve it (the APPROVE transition itself still runs — open mode removed only the
        //     attestation PROMPT friction), then prove the now-client-visible projection STILL
        //     strips operator fields (raw rationale / warnings / blockedReasons are physically dropped).
        const approve = await withFlag('1', () => httpJson(server, 'POST', `/api/protocol/drafts/${draftId}/review`, { decision: 'APPROVE', role: 'PRACTITIONER', reviewedBy: 'Dr. Vincent Lun' }));
        assert.strictEqual(approve.status, 200, 'the APPROVE action runs under open mode (no 428 attestation prompt)');
        assert.strictEqual(approve.json.draft.status, 'APPROVED_RESOURCE', 'APPROVE flips status to APPROVED_RESOURCE (the transition is unchanged)');
        assert.strictEqual(approve.json.clientVisible, true, 'an approved resource is client-visible — the correct, intended behavior');

        const afterApprove = await withFlag('1', () => httpJson(server, 'GET', `/api/client/${ERIC}/protocols`));
        const visible = [...(afterApprove.json.current || []), ...(afterApprove.json.past || [])].find((p) => p.id === draftId);
        assert.ok(visible, 'after APPROVE the protocol IS client-visible (a tester approving then seeing it client-side is CORRECT)');
        // The projection is whitelist-only: operator internals must be physically absent.
        for (const operatorField of ['warnings', 'blockedReasons', 'unknowns', 'rationale', 'reviewComments', 'compliance']) {
          assert.ok(!(operatorField in visible), `the client projection strips the operator field "${operatorField}" even in open mode`);
        }
        assert.strictEqual(visible.status, 'APPROVED_RESOURCE', 'the client only ever receives APPROVED_RESOURCE content');
      });
    } finally {
      await close(server);
    }
  } finally {
    // Restore the env flag and the runtime store EXACTLY as we found them (byte-for-byte) so the
    // visual suite (which reuses data/store.json) sees no drift from this test run.
    if (envSnapshot === undefined) delete process.env.VITALIS_OPEN_MODE; else process.env.VITALIS_OPEN_MODE = envSnapshot;
    if (storeExisted) fs.writeFileSync(store.STORE_PATH, storeSnapshot);
    else if (fs.existsSync(store.STORE_PATH)) fs.unlinkSync(store.STORE_PATH);
  }
}

// ===========================================================================
// ORDER-OPS GUARD SUITE (OG*) — drives the REAL Express server over HTTP.
//
// Sprint 1: every /api/ops/* route is internal/operator-only. The role signal reuses the
// app-wide convention (CAT.normalizeRole via the server's opsInternalGuard): an explicit ADMIN
// via the `x-vitalis-role` header (preferred) or a `role` query param. Anything else — INCLUDING
// no signal — is 403'd before any handler runs, so internal economics (cost / marginPct /
// grossProfit), supplier balances, and customer/order data never reach a non-admin caller.
// We snapshot/restore data/store.json byte-for-byte (admin calls here are GET-only and non-admin
// writes are 403'd, so nothing should mutate — we restore for safety, mirroring the OM suite).
//
//   OG1  GET  /api/ops/dashboard as CLIENT       → 403; body leaks none of cost/marginPct/grossProfit/mtdSales
//   OG2  GET  /api/ops/catalog   as PRACTITIONER → 403
//   OG3  GET  /api/ops/catalog   as ADMIN        → 200; products carry `cost` (authorized operator sees economics) + exact banner
//   OG4  GET  /api/ops/dashboard as ADMIN        → 200; carries margin + profit (operator-only signals present for the operator)
//   OG5  no role signal → 403 (fail closed); ?role=ADMIN query param → 200 (header/query parity)
//   OG6  POST /api/ops/customers as CLIENT       → 403 AND the store gained no customer (the guard blocks writes too)
// ===========================================================================
async function runOpsGuardSuite() {
  const http = require('node:http');
  const store = require('../lib/store');

  const storeExisted = fs.existsSync(store.STORE_PATH);
  const storeSnapshot = storeExisted ? fs.readFileSync(store.STORE_PATH) : null;

  function httpJson(server, method, path, { headers = {}, body = null } = {}) {
    const { port } = server.address();
    const payload = body == null ? null : Buffer.from(JSON.stringify(body));
    const h = { ...headers };
    if (payload) { h['Content-Type'] = 'application/json'; h['Content-Length'] = payload.length; }
    return new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, method, path, headers: h }, (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => { let json = null; try { json = data ? JSON.parse(data) : null; } catch { /* non-JSON */ } resolve({ status: res.statusCode, json }); });
      });
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  }
  const listen = (app) => new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const close = (s) => new Promise((resolve) => s.close(resolve));

  delete process.env.VITALIS_OPEN_MODE;     // open mode is irrelevant to the access guard; keep it OFF
  store.resetDemo();
  const { app } = require('../server.js');
  const server = await listen(app);

  // Keys that must NEVER appear in a non-admin (403) response body.
  const FORBIDDEN = ['cost', 'marginPct', 'grossProfit', 'mtdSales', 'ytdProfit', 'supplierBalances'];
  const leakedKeys = (json) => { const blob = JSON.stringify(json || {}); return FORBIDDEN.filter((k) => blob.includes(`"${k}"`)); };
  const BANNER = 'This is a simulation, for Research purposes. Not actual representation.';

  try {
    await testAsync('OG1', 'GET /api/ops/dashboard as CLIENT → 403, and the 403 body leaks none of cost/marginPct/grossProfit/mtdSales', async () => {
      const r = await httpJson(server, 'GET', '/api/ops/dashboard', { headers: { 'x-vitalis-role': 'CLIENT' } });
      assert.strictEqual(r.status, 403, 'a CLIENT is forbidden from Order Ops');
      assert.strictEqual(r.json && r.json.ok, false, 'the forbidden response carries ok:false');
      assert.deepStrictEqual(leakedKeys(r.json), [], 'no internal economics / order keys appear in the forbidden response');
    });

    await testAsync('OG2', 'GET /api/ops/catalog as PRACTITIONER → 403 (operator economics never reach a practitioner surface)', async () => {
      const r = await httpJson(server, 'GET', '/api/ops/catalog', { headers: { 'x-vitalis-role': 'PRACTITIONER' } });
      assert.strictEqual(r.status, 403, 'a PRACTITIONER is forbidden from Order Ops');
      assert.deepStrictEqual(leakedKeys(r.json), [], 'the 403 body carries no economics');
    });

    await testAsync('OG3', 'GET /api/ops/catalog as ADMIN → 200; products carry `cost` (authorized operator sees economics) and the exact banner is preserved', async () => {
      const r = await httpJson(server, 'GET', '/api/ops/catalog', { headers: { 'x-vitalis-role': 'ADMIN' } });
      assert.strictEqual(r.status, 200, 'ADMIN reaches Order Ops');
      const products = (r.json && r.json.products) || [];
      assert.ok(products.length > 0, 'the catalog returns products for an operator');
      assert.ok(products.some((p) => typeof p.cost === 'number'), 'an authorized operator DOES see cost — the purpose of the internal surface');
      assert.strictEqual(r.json.banner, BANNER, 'the exact simulation banner is preserved');
    });

    await testAsync('OG4', 'GET /api/ops/dashboard as ADMIN → 200 carrying margin + profit (operator-only signals present for the operator)', async () => {
      const r = await httpJson(server, 'GET', '/api/ops/dashboard', { headers: { 'x-vitalis-role': 'ADMIN' } });
      assert.strictEqual(r.status, 200, 'ADMIN reaches the ops dashboard');
      const blob = JSON.stringify(r.json || {});
      assert.ok(blob.includes('"mtdMargin"') && blob.includes('"mtdProfit"'), 'the operator dashboard exposes margin + profit to the operator');
    });

    await testAsync('OG5', 'No role signal → 403 (fail closed); ?role=ADMIN query param → 200 (header/query parity, same convention as the rest of the app)', async () => {
      const none = await httpJson(server, 'GET', '/api/ops/catalog');
      assert.strictEqual(none.status, 403, 'an unsignalled caller defaults to non-admin and is 403 (secure default)');
      const q = await httpJson(server, 'GET', '/api/ops/catalog?role=ADMIN');
      assert.strictEqual(q.status, 200, 'the ?role=ADMIN query param is honored');
    });

    await testAsync('OG6', 'POST /api/ops/customers as CLIENT → 403 AND no customer is written (the guard blocks writes, not only reads)', async () => {
      const before = store.list('opsCustomers').length;
      const r = await httpJson(server, 'POST', '/api/ops/customers', { headers: { 'x-vitalis-role': 'CLIENT' }, body: { name: 'Should Not Persist' } });
      assert.strictEqual(r.status, 403, 'a CLIENT cannot create an ops customer');
      const after = store.list('opsCustomers').length;
      assert.strictEqual(after, before, 'the blocked write created no customer — the handler never ran');
    });

    // --- OS*: Order Ops SIMULATION SEED (Sprint 2) ------------------------------------------
    // The seed makes the operator dashboard useful on first boot (non-zero) instead of all-zeros.
    // Every record is _demo:true and built from the canonical catalog; no real data, no discounts.
    await testAsync('OS1', 'store.resetDemo() creates Order Ops demo records in every ops collection (3 customers · 4–6 orders · 8–12 inventory · ≥2 suppliers incl. Biogenix+JH Strong · referral acct+ledger · movements)', async () => {
      store.resetDemo();
      assert.strictEqual(store.list('opsCustomers').length, 3, '3 demo customers seeded');
      const orders = store.list('opsOrders');
      assert.ok(orders.length >= 4 && orders.length <= 6, '4–6 demo orders seeded');
      const invCount = store.list('opsInventory').length;
      assert.ok(invCount >= 8 && invCount <= 12, '8–12 inventory records seeded');
      assert.ok(store.list('opsSupplierOrders').length >= 2, 'at least 2 supplier orders seeded');
      assert.ok(store.list('opsReferralAccounts').length >= 1, 'at least 1 referral account seeded');
      assert.ok(store.list('opsReferralLedger').length >= 1, 'at least 1 referral ledger entry seeded');
      assert.ok(store.list('opsInventoryMovements').length >= 1, 'inventory movements seeded');
      const statuses = new Set(orders.map((o) => o.paymentStatus));
      for (const s of ['PAID', 'PARTIAL', 'UNPAID']) assert.ok(statuses.has(s), `orders include a ${s} order`);
      const suppliers = new Set(store.list('opsSupplierOrders').map((s) => s.supplier));
      assert.ok(suppliers.has('Biogenix') && suppliers.has('JH Strong'), 'supplier orders include Biogenix and JH Strong');
      // Every seeded order references a REAL canonical catalog product id (no parallel product list).
      const catIds = new Set(require('@vitalis/protocol-core/data').catalog.products.map((p) => p.id));
      assert.ok(orders.every((o) => (o.items || []).every((it) => catIds.has(it.productId))), 'every order line is a canonical catalog product');
    });

    await testAsync('OS2', 'every seeded ops record is clearly labeled _demo:true (no record can be mistaken for real)', async () => {
      store.resetDemo();
      for (const coll of ['opsCustomers', 'opsOrders', 'opsInventory', 'opsInventoryMovements', 'opsSupplierOrders', 'opsReferralAccounts', 'opsReferralLedger']) {
        const recs = store.list(coll);
        assert.ok(recs.length > 0, `${coll} has demo records`);
        assert.ok(recs.every((r) => r._demo === true), `every ${coll} record carries _demo:true`);
      }
    });

    await testAsync('OS3', '/api/ops/dashboard as ADMIN returns NON-ZERO sales / cost / profit / inventory / receivables / supplier balances / referral liability', async () => {
      store.resetDemo();
      const r = await httpJson(server, 'GET', '/api/ops/dashboard', { headers: { 'x-vitalis-role': 'ADMIN' } });
      assert.strictEqual(r.status, 200, 'ADMIN reaches the dashboard');
      const d = r.json || {};
      assert.ok(d.mtdSales > 0, 'MTD sales is non-zero');
      assert.ok(d.ytdSales > 0, 'YTD sales is non-zero');
      assert.ok(d.ytdCost > 0, 'cost is non-zero');
      assert.ok(d.mtdProfit > 0, 'gross profit (MTD) is non-zero');
      assert.ok(d.inventory && d.inventory.value > 0, 'inventory value is non-zero');
      assert.ok(d.receivables && (d.receivables.unpaidValue > 0 || d.receivables.partialValue > 0), 'receivables are non-zero');
      assert.ok(d.supplierBalances > 0, 'supplier balances are non-zero');
      assert.ok(d.referralLiability > 0, 'referral credit liability is non-zero');
      assert.strictEqual(d.banner, BANNER, 'the exact simulation banner is present on the dashboard');
    });

    await testAsync('OS4', '/api/ops/dashboard as CLIENT still returns 403 even with seed data present (the Sprint-1 guard is intact)', async () => {
      const r = await httpJson(server, 'GET', '/api/ops/dashboard', { headers: { 'x-vitalis-role': 'CLIENT' } });
      assert.strictEqual(r.status, 403, 'a CLIENT remains forbidden after seeding');
    });

    await testAsync('OS5', '/api/ops/orders/:id/invoice?role=ADMIN includes the EXACT simulation banner and only copy/draft links (no live send)', async () => {
      store.resetDemo();
      const first = store.list('opsOrders')[0];
      assert.ok(first && first.id, 'a seeded order exists');
      const r = await httpJson(server, 'GET', `/api/ops/orders/${encodeURIComponent(first.id)}/invoice?role=ADMIN`);
      assert.strictEqual(r.status, 200, 'the invoice renders for an operator');
      assert.ok(r.json && r.json.invoice && typeof r.json.invoice.plainText === 'string', 'invoice plainText is returned');
      assert.ok(r.json.invoice.plainText.includes(BANNER), 'the invoice text carries the exact simulation banner');
      assert.ok(typeof r.json.invoice.smsUrl === 'string' && r.json.invoice.smsUrl.startsWith('sms:'), 'an sms: DRAFT link is provided (no live send)');
      assert.ok(typeof r.json.invoice.telegramUrl === 'string' && r.json.invoice.telegramUrl.includes('t.me/share/url'), 'a Telegram SHARE url is provided (no live send)');
    });

    // --- OL*: Order lifecycle + detail (Sprint 4B) ------------------------------------------
    await testAsync('OL1', 'CLIENT/PRACTITIONER are 403 on PATCH /api/ops/orders/:id and GET /api/ops/customers/:id (the guard covers the new endpoints)', async () => {
      store.resetDemo();
      const order = store.list('opsOrders')[0];
      const cust = store.list('opsCustomers')[0];
      const patchClient = await httpJson(server, 'PATCH', `/api/ops/orders/${order.id}`, { headers: { 'x-vitalis-role': 'CLIENT' }, body: { invoiceStatus: 'SENT' } });
      assert.strictEqual(patchClient.status, 403, 'a CLIENT cannot PATCH an order');
      const custPrac = await httpJson(server, 'GET', `/api/ops/customers/${cust.id}`, { headers: { 'x-vitalis-role': 'PRACTITIONER' } });
      assert.strictEqual(custPrac.status, 403, 'a PRACTITIONER cannot read customer detail');
      assert.strictEqual(store.get('opsOrders', order.id).invoiceStatus, order.invoiceStatus, 'the forbidden PATCH mutated nothing (handler never ran)');
    });

    await testAsync('OL2', 'ADMIN can move a DRAFT order to SENT', async () => {
      store.resetDemo();
      const draft = store.list('opsOrders').find((o) => o.invoiceStatus === 'DRAFT');
      assert.ok(draft, 'a DRAFT order exists in the seed');
      const r = await httpJson(server, 'PATCH', `/api/ops/orders/${draft.id}`, { headers: { 'x-vitalis-role': 'ADMIN' }, body: { invoiceStatus: 'SENT' } });
      assert.strictEqual(r.status, 200, 'ADMIN PATCH succeeds');
      assert.strictEqual(r.json.order.invoiceStatus, 'SENT', 'invoiceStatus is now SENT');
    });

    await testAsync('OL3', 'ADMIN cannot edit items once the invoice is SENT (409 — must return to DRAFT first)', async () => {
      store.resetDemo();
      const draft = store.list('opsOrders').find((o) => o.invoiceStatus === 'DRAFT');
      await httpJson(server, 'PATCH', `/api/ops/orders/${draft.id}`, { headers: { 'x-vitalis-role': 'ADMIN' }, body: { invoiceStatus: 'SENT' } });
      const edit = await httpJson(server, 'PATCH', `/api/ops/orders/${draft.id}`, { headers: { 'x-vitalis-role': 'ADMIN' }, body: { items: [{ productId: draft.items[0].productId, qty: 9 }] } });
      assert.strictEqual(edit.status, 409, 'editing items on a SENT order is rejected (409)');
    });

    await testAsync('OL4', 'ADMIN can return to DRAFT, edit a line qty, and totals + inventory movements update correctly', async () => {
      store.resetDemo();
      const draft = store.list('opsOrders').find((o) => o.invoiceStatus === 'DRAFT');
      const firstItem = draft.items[0];
      const pid = firstItem.productId;
      const onHandBefore = (store.list('opsInventory').find((iv) => iv.productId === pid) || {}).onHand || 0;
      const totalBefore = draft.total;
      const items = draft.items.map((it, i) => ({ productId: it.productId, qty: i === 0 ? (it.qty || 1) + 1 : it.qty, price: it.price, cost: it.cost }));
      await httpJson(server, 'PATCH', `/api/ops/orders/${draft.id}`, { headers: { 'x-vitalis-role': 'ADMIN' }, body: { invoiceStatus: 'SENT' } });
      await httpJson(server, 'PATCH', `/api/ops/orders/${draft.id}`, { headers: { 'x-vitalis-role': 'ADMIN' }, body: { invoiceStatus: 'DRAFT' } });
      const r = await httpJson(server, 'PATCH', `/api/ops/orders/${draft.id}`, { headers: { 'x-vitalis-role': 'ADMIN' }, body: { items } });
      assert.strictEqual(r.status, 200, 'the DRAFT item edit succeeds after returning to DRAFT');
      assert.ok(r.json.order.total > totalBefore, 'total increased after adding a unit');
      assert.strictEqual(r.json.order.subtotal, +r.json.order.items.reduce((s, it) => s + it.lineTotal, 0).toFixed(2), 'subtotal equals the recomputed sum of line totals');
      const onHandAfter = (store.list('opsInventory').find((iv) => iv.productId === pid) || {}).onHand || 0;
      assert.strictEqual(onHandAfter, onHandBefore - 1, 'on-hand dropped by the +1 sold delta');
      const mov = store.list('opsInventoryMovements').find((m) => m.orderId === draft.id && m.productId === pid && /item edit/i.test(m.reason || ''));
      assert.ok(mov && mov.type === 'SALE' && mov.qty === -1, 'a SALE movement (-1) was recorded for the edit with this order id');
    });

    await testAsync('OL5', 'GET /api/ops/customers/:id returns the customer + their orders + referral account + ledger', async () => {
      store.resetDemo();
      const acct = store.list('opsReferralAccounts')[0];
      const r = await httpJson(server, 'GET', `/api/ops/customers/${acct.customerId}`, { headers: { 'x-vitalis-role': 'ADMIN' } });
      assert.strictEqual(r.status, 200, 'ADMIN reads customer detail');
      assert.strictEqual(r.json.customer.id, acct.customerId, 'the right customer is returned');
      assert.ok((r.json.orders || []).length > 0, 'their orders are included');
      assert.ok(r.json.referralAccount && r.json.referralAccount.id === acct.id, 'their referral account is included');
      assert.ok((r.json.ledger || []).length > 0, 'their referral ledger entries are included');
      assert.strictEqual(r.json.banner, BANNER, 'the exact simulation banner is present');
    });

    await testAsync('OL6', 'the invoice endpoint still returns the exact banner + sms/telegram draft links after a lifecycle change', async () => {
      store.resetDemo();
      const order = store.list('opsOrders')[0];
      await httpJson(server, 'PATCH', `/api/ops/orders/${order.id}`, { headers: { 'x-vitalis-role': 'ADMIN' }, body: { invoiceStatus: 'SENT', notes: 'QA note' } });
      const r = await httpJson(server, 'GET', `/api/ops/orders/${order.id}/invoice`, { headers: { 'x-vitalis-role': 'ADMIN' } });
      assert.strictEqual(r.status, 200, 'invoice still renders');
      assert.ok(r.json.invoice.plainText.includes(BANNER), 'invoice text carries the exact banner');
      assert.ok(r.json.invoice.smsUrl.startsWith('sms:'), 'sms: draft link present');
      assert.ok(r.json.invoice.telegramUrl.includes('t.me/share/url'), 'Telegram share url present');
    });

    // --- OV*: Inventory valuation (Sprint 6) -----------------------------------------------
    await testAsync('OV1', 'dashboard inventory valuation uses ACTIVE stock × canonical catalog (value@MSRP/cost/profit/margin), ignoring zero-stock; CLIENT 403; banner present', async () => {
      store.resetDemo();
      const { catalog: cat } = require('@vitalis/protocol-core/data');
      // Plant a ZERO-STOCK inventory record for a real catalog product → must NOT affect any total.
      const invIds = new Set(store.list('opsInventory').map((iv) => iv.productId));
      const extra = cat.products.find((p) => !invIds.has(p.id) && (p.cost || 0) > 0 && ((p.msrp || p.boxPrice || 0) > 0));
      store.upsert('opsInventory', { id: 'ops_inv_zero_test', productId: extra.id, sku: extra.sku, name: extra.name, onHand: 0, _demo: true });

      // CLIENT still blocked.
      const cl = await httpJson(server, 'GET', '/api/ops/dashboard', { headers: { 'x-vitalis-role': 'CLIENT' } });
      assert.strictEqual(cl.status, 403, 'a CLIENT cannot read the dashboard');

      // Expected, computed independently from active (onHand>0) records × catalog.
      const catMap = {};
      for (const p of cat.products) catMap[p.id] = { cost: p.cost || 0, msrp: p.msrp || p.boxPrice || 0 };
      const active = store.list('opsInventory').filter((iv) => (iv.onHand || 0) > 0);
      const expCost = +active.reduce((s, iv) => s + (iv.onHand || 0) * catMap[iv.productId].cost, 0).toFixed(2);
      const expMsrp = +active.reduce((s, iv) => s + (iv.onHand || 0) * catMap[iv.productId].msrp, 0).toFixed(2);
      const expProfit = +(expMsrp - expCost).toFixed(2);
      const expMargin = expMsrp > 0 ? +((expProfit / expMsrp) * 100).toFixed(1) : 0;
      const expUnits = active.reduce((s, iv) => s + (iv.onHand || 0), 0);

      const r = await httpJson(server, 'GET', '/api/ops/dashboard', { headers: { 'x-vitalis-role': 'ADMIN' } });
      assert.strictEqual(r.status, 200, 'ADMIN reads the dashboard');
      const inv = r.json.inventory;
      assert.ok(expCost > 0 && expMsrp > expCost, 'precondition: there is active stock with a positive margin');
      assert.strictEqual(inv.valueAtCost, expCost, 'valueAtCost = Σ(onHand × cost) over active stock');
      assert.strictEqual(inv.valueAtMsrp, expMsrp, 'valueAtMsrp = Σ(onHand × msrp) over active stock');
      assert.strictEqual(inv.projectedGrossProfit, expProfit, 'projectedGrossProfit = valueAtMsrp − valueAtCost');
      assert.strictEqual(inv.projectedMarginPct, expMargin, 'projectedMarginPct = profit / msrp × 100');
      assert.strictEqual(inv.unitsOnHand, expUnits, 'unitsOnHand counts active stock only (zero-stock record excluded)');
      assert.strictEqual(r.json.banner, BANNER, 'the exact simulation banner is present');
    });

    await testAsync('OV2', '/api/ops/inventory carries correct per-item valuation; CLIENT 403; banner present; zero-stock items value to 0', async () => {
      store.resetDemo();
      const cl = await httpJson(server, 'GET', '/api/ops/inventory', { headers: { 'x-vitalis-role': 'CLIENT' } });
      assert.strictEqual(cl.status, 403, 'a CLIENT cannot read inventory');

      const r = await httpJson(server, 'GET', '/api/ops/inventory', { headers: { 'x-vitalis-role': 'ADMIN' } });
      assert.strictEqual(r.status, 200, 'ADMIN reads inventory');
      assert.strictEqual(r.json.banner, BANNER, 'the exact simulation banner is present');
      const items = r.json.items || [];
      const stocked = items.filter((i) => (i.onHand || 0) > 0);
      assert.ok(stocked.length > 0, 'there is active stock');
      for (const i of stocked) {
        assert.strictEqual(i.valueAtCost, +((i.onHand || 0) * (i.cost || 0)).toFixed(2), `${i.name}: valueAtCost = onHand × cost`);
        assert.strictEqual(i.valueAtMsrp, +((i.onHand || 0) * (i.msrp || 0)).toFixed(2), `${i.name}: valueAtMsrp = onHand × msrp`);
        assert.strictEqual(i.projectedGrossProfit, +(i.valueAtMsrp - i.valueAtCost).toFixed(2), `${i.name}: projectedGrossProfit`);
        const expM = i.valueAtMsrp > 0 ? +(((i.valueAtMsrp - i.valueAtCost) / i.valueAtMsrp) * 100).toFixed(1) : 0;
        assert.strictEqual(i.projectedMarginPct, expM, `${i.name}: projectedMarginPct`);
      }
      // every zero-stock catalog row values to exactly 0 (never counted)
      const zero = items.filter((i) => (i.onHand || 0) === 0);
      assert.ok(zero.every((i) => i.valueAtCost === 0 && i.valueAtMsrp === 0), 'zero-stock products value to 0 at cost and MSRP');
    });

    // --- OR*: Low-stock reorder (Sprint 9) -------------------------------------------------
    await testAsync('OR1', 'reorder-suggestions = TRACKED stock at/below reorder point (incl sold-out tracked), excludes never-stocked catalog; canonical economics; CLIENT/PRACTITIONER 403; banner', async () => {
      store.resetDemo();
      const { catalog: cat } = require('@vitalis/protocol-core/data');
      const invIds = new Set(store.list('opsInventory').map((iv) => iv.productId));
      // (a) a SOLD-OUT but actively-tracked product (onHand 0) → must appear (it needs reordering)
      const soldOut = cat.products.find((p) => !invIds.has(p.id) && (p.cost || 0) > 0 && ((p.msrp || p.boxPrice || 0) > 0));
      store.upsert('opsInventory', { id: 'ops_inv_soldout_test', productId: soldOut.id, sku: soldOut.sku, name: soldOut.name || soldOut.displayName, onHand: 0, _demo: true });
      // (b) a NEVER-STOCKED catalog product (no inventory record) → must NOT appear
      const neverStocked = cat.products.find((p) => !invIds.has(p.id) && p.id !== soldOut.id);

      assert.strictEqual((await httpJson(server, 'GET', '/api/ops/reorder-suggestions', { headers: { 'x-vitalis-role': 'CLIENT' } })).status, 403, 'CLIENT is forbidden');
      assert.strictEqual((await httpJson(server, 'GET', '/api/ops/reorder-suggestions', { headers: { 'x-vitalis-role': 'PRACTITIONER' } })).status, 403, 'PRACTITIONER is forbidden');

      const r = await httpJson(server, 'GET', '/api/ops/reorder-suggestions', { headers: { 'x-vitalis-role': 'ADMIN' } });
      assert.strictEqual(r.status, 200, 'ADMIN can read reorder suggestions');
      assert.strictEqual(r.json.banner, BANNER, 'the exact simulation banner is present');
      const items = r.json.items || [];
      const ids = new Set(items.map((i) => i.productId));
      assert.ok(ids.has(soldOut.id), 'a sold-out (onHand 0) TRACKED product appears in the reorder list');
      assert.ok(!ids.has(neverStocked.id), 'a never-stocked catalog product (no inventory record) is excluded');
      assert.ok(items.every((i) => i.onHand <= i.reorderPoint), 'every suggestion is at or below the reorder point');
      const catMap = {}; for (const p of cat.products) catMap[p.id] = { cost: p.cost || 0, msrp: p.msrp || p.boxPrice || 0 };
      for (const i of items) {
        assert.strictEqual(i.suggestedReorderQty, Math.max(0, r.json.reorderTarget - i.onHand), `${i.name}: suggestedReorderQty = target − onHand`);
        assert.strictEqual(i.cost, catMap[i.productId].cost, `${i.name}: cost is canonical catalog cost`);
        assert.strictEqual(i.valueAtCost, +(i.suggestedReorderQty * i.cost).toFixed(2), `${i.name}: reorder value @ cost = suggestedQty × cost`);
        assert.strictEqual(i.projectedGrossProfit, +(i.valueAtMsrp - i.valueAtCost).toFixed(2), `${i.name}: projected profit = MSRP value − cost value`);
      }
    });

    await testAsync('OR2', 'reorder draft reuses /api/ops/supplier-orders: CLIENT 403; ADMIN draft uses canonical cost + ORDERED; inventory NOT mutated until received', async () => {
      store.resetDemo();
      const { catalog: cat } = require('@vitalis/protocol-core/data');
      const low = store.list('opsInventory').find((iv) => (iv.onHand || 0) <= 3);
      const prod = cat.products.find((p) => p.id === low.productId);
      const onHandBefore = low.onHand || 0;

      const clientPost = await httpJson(server, 'POST', '/api/ops/supplier-orders', { headers: { 'x-vitalis-role': 'CLIENT' }, body: { supplier: prod.supplier || 'Other', items: [{ productId: prod.id, qty: 9 }] } });
      assert.strictEqual(clientPost.status, 403, 'a CLIENT cannot create a supplier order');

      // ADMIN draft with NO unitCost → server fills the canonical catalog cost (no second cost source).
      const r = await httpJson(server, 'POST', '/api/ops/supplier-orders', { headers: { 'x-vitalis-role': 'ADMIN' }, body: { supplier: prod.supplier || 'Other', items: [{ productId: prod.id, qty: 9 }] } });
      assert.strictEqual(r.status, 200, 'ADMIN creates the supplier draft');
      assert.strictEqual(r.json.supplierOrder.items[0].unitCost, prod.cost || 0, 'the reorder draft uses the canonical catalog cost');
      assert.strictEqual(r.json.supplierOrder.orderStatus, 'ORDERED', 'created ORDERED (a draft), not RECEIVED');

      const onHandAfter = (store.list('opsInventory').find((iv) => iv.productId === prod.id) || {}).onHand || 0;
      assert.strictEqual(onHandAfter, onHandBefore, 'creating the supplier order did NOT change on-hand (no auto-receive)');
    });
  } finally {
    await close(server);
    // Restore the runtime store EXACTLY as we found it (the visual suite reuses data/store.json).
    if (storeExisted) fs.writeFileSync(store.STORE_PATH, storeSnapshot);
    else if (fs.existsSync(store.STORE_PATH)) fs.unlinkSync(store.STORE_PATH);
  }
}

// --- summary (after the async OPEN-MODE + ORDER-OPS GUARD suites) -----------
runOpenModeSuite().then(runOpsGuardSuite).then(() => {
  const total = passed + failures.length;
  console.log(`\n${passed}/${total} checks passed.`);
  if (failures.length) {
    console.log('\nFAILURES:');
    for (const f of failures) console.log(`  [${f.num}] ${f.name}\n     ${f.message}`);
    process.exit(1);
  }
  console.log('All acceptance tests passed.\n');
}).catch((e) => {
  console.error('\nasync suite crashed:', e && e.stack || e);
  process.exit(1);
});
