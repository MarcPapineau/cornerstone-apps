'use strict';
/**
 * supplement.visual.spec.cjs — anti-drift gate for the Vitalis SUPPLEMENT research mini-dossier
 * (/document/supplement/demo_addondraft_kristen_supp, Kristen's APPROVED "Recovery & Sleep" plan).
 *
 * The supplement adapter (toSupplementDocProps) enriches the plan into an 11-section research
 * resource: Exec Summary · Client Snapshot · Lab+Lifestyle Findings (from her REAL labs, baseline
 * vs latest) · Priority Ranking · Supplement Detail · Food-First · Timing · Monitoring · (operator)
 * Practitioner Review · Evidence Reference · Research Basis & Source Transparency.
 *
 * DOM/text assertions are the HARD gate — they prove the honest-tiering + no-fabrication contract
 * renders (T1–T5/NEEDS_SOURCE tiers, FORM-not-dose, client softening, Dr. Vincent Lun). The single
 * fullpage screenshot guards layout/structure and is baselined fresh; the four protocol-*.png
 * baselines are untouched (a different spec/route).
 *
 * Authoring notes (mirror protocol.visual.spec.cjs, verified against the live DOM):
 *  - Role is seeded into localStorage (`vitalis.demoRole`) BEFORE navigation; there is no auth. The
 *    document route is served by the server adapter; a CLIENT only ever receives the APPROVED plan.
 *  - getByText matches the ORIGINAL DOM text (CSS uppercase is visual-only) — literals in authored case.
 */
const { test, expect } = require('@playwright/test');

const SUPP_ID = 'demo_addondraft_kristen_supp';
const CLIENT = { role: 'CLIENT', practitionerId: 'pr_morgan', clientId: 'demo_kristen_a' };
const PRACTITIONER = { role: 'PRACTITIONER', practitionerId: 'pr_morgan', clientId: 'demo_kristen_a' };

function sectionByRunhead(page, ref) {
  return page.locator('.vdoc .vd-section').filter({ has: page.locator('.vd-runhead__ref', { hasText: ref }) });
}

async function openDoc(page, role) {
  await page.addInitScript((r) => localStorage.setItem('vitalis.demoRole', JSON.stringify(r)), role);
  await page.goto(`/document/supplement/${SUPP_ID}?role=${role.role}`);
  await expect(page.locator('.vdoc'), 'supplement dossier root .vdoc must render').toBeVisible({ timeout: 20_000 });
  await page.evaluate(() => document.fonts.ready);
}

test.describe('Vitalis supplement research mini-dossier — /document/supplement (Kristen)', () => {
  test('CLIENT — 11-section spine, real-lab findings, FORM-not-dose, honest tiers, citations dropped', async ({ page }) => {
    await openDoc(page, CLIENT);

    // Approved banner (defense-in-depth: only an APPROVED plan reaches a client).
    const banner = page.locator('.vd-banner').first();
    await expect(banner).toContainText('Approved resource');

    // Exec summary panel (S01) names the resource-only framing.
    await expect(page.getByText('Executive summary').first()).toBeVisible();
    await expect(page.getByText('Final dose, timing, suitability, and duration require practitioner review.').first()).toBeVisible();

    // The new mini-dossier section runheads are present (a subset, asserted by label).
    for (const ref of [
      'SECTION 02 · CLIENT SNAPSHOT',
      'SECTION 03 · LAB + LIFESTYLE FINDINGS',
      'SECTION 04 · PRIORITY RANKING',
      'SECTION 05 · SUPPLEMENT DETAIL',
      'SECTION 08 · MONITORING & NEXT LABS',
      'SECTION 10 · EVIDENCE REFERENCE',
      'SECTION 11 · RESEARCH BASIS',
    ]) {
      await expect(sectionByRunhead(page, ref), `runhead "${ref}" present`).toHaveCount(1);
    }

    // S03 — Lab + Lifestyle Findings derived from her REAL labs (baseline → latest deltas).
    const s03 = sectionByRunhead(page, 'SECTION 03 · LAB + LIFESTYLE FINDINGS');
    const s03Text = await s03.innerText();
    expect(s03Text, 'a real flagged marker (Magnesium) is surfaced').toMatch(/Magnesium/i);
    expect(s03Text, 'baseline-vs-latest movement is shown').toMatch(/0\.7\s*(mmol\/L)?\s*→\s*0\.82/i);
    // Lifestyle honestly not captured (never fabricated) — the intake-question prompt appears.
    expect(s03Text, 'lifestyle is honestly not captured').toMatch(/not yet captured/i);

    // S05 — Supplement Detail: FORM, never a dose; research/resource phrasing.
    const s05 = sectionByRunhead(page, 'SECTION 05 · SUPPLEMENT DETAIL');
    const s05Text = await s05.innerText();
    expect(s05Text, 'names a FORM with the dose deferred to the naturopath').toMatch(/dose is your naturopath/i);
    expect(s05Text, 'research/resource phrasing, never "take X"').toMatch(/Research and practitioner discussions commonly reference/i);
    expect(/\btake\s+\d/i.test(s05Text), 'no "take <dose>" imperative anywhere in S05').toBe(false);

    // S11 — Research Basis: tier legend incl. NEEDS_SOURCE, the research-gap callout, and NO leaked gov URL.
    const s11 = sectionByRunhead(page, 'SECTION 11 · RESEARCH BASIS');
    const s11Text = await s11.innerText();
    expect(s11Text, 'the source-gap tier is visible').toMatch(/NEEDS_SOURCE|source gap/i);
    expect(s11Text, 'the research-gap list is surfaced').toMatch(/Research-gap list/i);
    // CLIENT softening: no government citation URL leaks anywhere in the document.
    const docText = await page.locator('.vdoc').innerText();
    expect(/ods\.od\.nih\.gov/i.test(docText), 'no NIH-ODS citation URL leaks into the client view').toBe(false);

    // The practitioner-only checklist is ABSENT for a client.
    await expect(sectionByRunhead(page, 'SECTION 09 · PRACTITIONER REVIEW')).toHaveCount(0);

    // Dr. Vincent Lun — never "Vinny".
    expect(/vinny/i.test(docText), 'never "Vinny" on the rendered supplement dossier').toBe(false);
    await expect(page.getByText('Dr. Vincent Lun').first()).toBeVisible();

    // ---- Screenshot (structure/layout guard; DOM above is the hard gate) ----
    const vdoc = page.locator('.vdoc');
    await expect(vdoc).toHaveScreenshot('supplement-client-fullpage.png', { maxDiffPixelRatio: 0.02 });
  });

  test('PRACTITIONER — adds the review checklist + operator citation detail (client never sees these)', async ({ page }) => {
    await openDoc(page, PRACTITIONER);

    // S09 — the practitioner review checklist is present for the operator.
    const s09 = sectionByRunhead(page, 'SECTION 09 · PRACTITIONER REVIEW');
    await expect(s09).toHaveCount(1);
    const s09Text = await s09.innerText();
    expect(s09Text).toMatch(/Confirm lab interpretation/i);
    expect(s09Text).toMatch(/Approve \/ modify \/ hold/i);

    // S11 operator view carries the full per-claim provenance (a real gov reference URL is clickable here).
    const s11 = sectionByRunhead(page, 'SECTION 11 · RESEARCH BASIS');
    const link = s11.locator('a[href*="ods.od.nih.gov"]').first();
    expect(await link.count(), 'operator sees the real government reference link (T3, reference-only)').toBeGreaterThanOrEqual(1);
  });
});
