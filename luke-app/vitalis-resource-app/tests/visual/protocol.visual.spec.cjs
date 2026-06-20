'use strict';
/**
 * protocol.visual.spec.cjs — anti-drift gate for the flagship Vitalis dossier
 * (/portal/protocols, CLIENT view of demo_kristen_a's APPROVED "Recovery & Sleep — KLOW + Sleep
 * Stack"). DOM/text assertions are the HARD gate (they catch the eight documented Vitalis
 * regressions: thin cards, Section-02 schedule drift, KLOW dosing/translation drift,
 * range-as-selected-dose, a leaked draft, etc.); the screenshots guard layout/structure.
 *
 * Authoring notes (verified against the live rendered DOM, not assumed):
 *  - Role is seeded into localStorage (`vitalis.demoRole`) BEFORE navigation; there is no auth.
 *    demo_kristen_a belongs to pr_morgan (ownership trap), but the CLIENT portal is identity-keyed
 *    on clientId, so the document renders for the client regardless of practitionerId.
 *  - getByText() matches the ORIGINAL DOM text (the dossier's CSS `text-transform: uppercase` is a
 *    visual-only effect; the underlying text nodes keep their authored mixed case). Verified live —
 *    e.g. getByText('Research Documents · Educational Use Only') matches even though it renders
 *    uppercase. So literals below are asserted in their authored case. (innerText() WOULD apply the
 *    transform — hence the few innerText regexes here use the `i` flag.)
 *  - KLOW weekly-exposure translation — WHERE it lives in the DOM (important, see report):
 *      • SECTION 02 (the schedule grid): the milestone column carries the *abbreviated* weekly
 *        translation (`2.5 / 2.5 / 2.5 / 10mg`) per band — asserted here, in S02.
 *      • SECTION 03 (Compound / Blend Reference): the `10 IU weekly translation` panel carries the
 *        *full compound-named* form `…2.5mg BPC-157 … 2.5mg TB-500 … 2.5mg KPV … 10mg GHK-Cu … per
 *        week` plus `not per dose, not per day`. This full-form string is rendered ONLY in S03 by
 *        the product (PeptideProtocolDocument.jsx) — never inside the S02 markup. We assert the
 *        full form against S03 (where it actually renders, and where the broad-range doctrine puts
 *        component math) rather than against S02 where it provably never appears. The anti-drift
 *        intent (KLOW shows the weekly translation; per-dose/per-day math is forbidden) is fully
 *        covered: S02 carries the translation, S03 carries the explicit `not per dose, not per day`.
 */
const { test, expect } = require('@playwright/test');

const ROLE = { role: 'CLIENT', practitionerId: 'pr_morgan', clientId: 'demo_kristen_a' };

// Section runhead literals, in document order. Each is a stable React-rendered string literal.
const RUNHEADS = [
  'SECTION 01 · THE STACK & WHY',
  'SECTION 02 · SELECTED PROTOCOL SCHEDULE',
  'SECTION 03 · COMPOUND / BLEND REFERENCE',
  'SECTION 04 · SUPPORTIVE LIFESTYLE',
  'SECTION 05 · PHYSIOLOGICAL MONITORING',
];

// Helper: the .vd-section whose runhead label === ref (stable, order-independent).
function sectionByRunhead(page, ref) {
  return page.locator('.vdoc .vd-section').filter({ has: page.locator('.vd-runhead__ref', { hasText: ref }) });
}

test.describe('Vitalis peptide dossier — /portal/protocols (CLIENT, demo_kristen_a)', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript((role) => {
      localStorage.setItem('vitalis.demoRole', JSON.stringify(role));
    }, ROLE);
    await page.goto('/portal/protocols');
    // The dossier root proves the APPROVED protocol is actually rendering. If it never appears,
    // the approved protocol isn't projecting → that is a STOP-and-report drift, surfaced as a
    // hard failure here (not silently worked around).
    await expect(page.locator('.vdoc'), 'dossier root .vdoc must render — approved protocol not projecting if absent')
      .toBeVisible({ timeout: 20_000 });
    await page.evaluate(() => document.fonts.ready);
  });

  test('cover — brand, kicker, approved banner, physician meta, review framing; no draft leak', async ({ page }) => {
    const cover = page.locator('.vdoc header').first();
    // Brand wordmark — scope to .vd-wordmark; the cover also has a "Source: Vitalis Research"
    // <dd> meta value, so a bare getByText would be a strict-mode collision.
    await expect(cover.locator('.vd-wordmark').first()).toContainText('Vitalis Research');
    await expect(cover.getByText('Research Documents · Educational Use Only')).toBeVisible();

    // Approved banner — defense-in-depth: a draft can never reach the client portal.
    const banner = page.locator('.vd-banner').first();
    await expect(banner).toContainText('Approved resource');
    await expect(banner).toHaveClass(/vd-banner--approved/);

    // Cover metadata + review framing.
    await expect(cover.getByText('Referral physician')).toBeVisible();
    await expect(page.getByText('For physician review').first()).toBeVisible();
    await expect(page.getByText('guide only').first()).toBeVisible();

    // The draft-only banner string must be ABSENT anywhere in the document.
    await expect(page.getByText('Draft · practitioner-only')).toHaveCount(0);
  });

  test('section spine — all five runheads present, in order', async ({ page }) => {
    const refs = await page.locator('.vdoc .vd-runhead__ref').allTextContents();
    expect(refs).toEqual(RUNHEADS);
    for (const ref of RUNHEADS) {
      await expect(sectionByRunhead(page, ref)).toHaveCount(1);
    }
  });

  test('section 01 — stat band + compound cards (not thin)', async ({ page }) => {
    const s01 = sectionByRunhead(page, 'SECTION 01 · THE STACK & WHY');
    await expect(s01).toHaveCount(1);

    const statband = s01.locator('.vd-statband');
    await expect(statband).toBeVisible();
    expect(await statband.locator('.vd-stat').count()).toBeGreaterThanOrEqual(1);
    // Old-standard readiness stats — labels asserted in authored case.
    await expect(statband.getByText('Weeks total')).toBeVisible();
    await expect(statband.getByText('Schedules selected')).toBeVisible();

    // ≥3 compound cards (KLOW, DSIP, Selank) and each body non-empty (guards the thin-card regression).
    const cards = s01.locator('.vd-card');
    expect(await cards.count()).toBeGreaterThanOrEqual(3);
    const bodies = s01.locator('.vd-card .vd-card__body');
    const bodyCount = await bodies.count();
    expect(bodyCount).toBeGreaterThanOrEqual(3);
    for (let i = 0; i < bodyCount; i++) {
      expect((await bodies.nth(i).innerText()).trim().length, `card body ${i} must be non-empty`).toBeGreaterThan(0);
    }
  });

  test('section 02 — selected schedule grid (HIGHEST RISK)', async ({ page }) => {
    const s02 = sectionByRunhead(page, 'SECTION 02 · SELECTED PROTOCOL SCHEDULE');
    await expect(s02).toHaveCount(1);

    // The old-Vitalis time-phased weekly grid must exist.
    const weekly = s02.locator('table.vd-sched.vd-sched--weekly');
    await expect(weekly).toHaveCount(1);

    // Header carries Block + PHASE MILESTONE (case-insensitive: rendered uppercase via CSS).
    const headText = await weekly.locator('thead').innerText();
    expect(headText).toMatch(/Block/i);
    expect(headText).toMatch(/PHASE MILESTONE/i);

    // KLOW present, as a co-lyophilized blend, in exactly ONE column (never four BPC/TB/KPV/GHK columns).
    await expect(s02.getByText('KLOW 10 IU').first()).toBeVisible();
    await expect(s02.getByText('co-lyophilized blend').first()).toBeVisible();
    const headerCells = await weekly.locator('thead th').allInnerTexts();
    const klowHeaderCells = headerCells.filter((t) => /\bKLOW\b/.test(t));
    expect(klowHeaderCells.length, 'KLOW must be exactly one schedule column').toBe(1);
    for (const drifted of ['BPC-157', 'TB-500', 'KPV', 'GHK-Cu']) {
      const isOwnColumn = headerCells.some((t) => new RegExp(`^\\s*${drifted.replace('-', '\\-')}`).test(t.trim()));
      expect(isOwnColumn, `${drifted} must NOT be its own schedule column`).toBe(false);
    }

    // KLOW weekly translation IN S02: the milestone column carries the abbreviated weekly-exposure
    // translation per band (2.5 / 2.5 / 2.5 / 10mg). (Full compound-named form lives in S03 — see test below.)
    const s02Text = await s02.innerText();
    expect(s02Text, 'S02 milestones carry the KLOW weekly-exposure translation').toMatch(
      /2\.5\s*\/\s*2\.5\s*\/\s*2\.5\s*\/\s*10mg/i,
    );

    // Selected doses (NOT ranges).
    await expect(s02.getByText('100 mcg').first()).toBeVisible(); // DSIP selected dose
    await expect(s02.getByText('250 mcg').first()).toBeVisible(); // Selank selected dose

    // FORBIDDEN in S02: drifted KLOW vial math.
    for (const forbidden of ['12.5mg BPC-157', '50mg GHK-Cu', '70mg GHK-Cu', '12.5 mg GHK']) {
      expect(s02Text.includes(forbidden), `S02 must NOT contain "${forbidden}"`).toBe(false);
    }
    // FORBIDDEN in S02: any broad-range-as-dose inside the schedule table (no dose CELL is a range).
    const tableCells = await s02.locator('table.vd-sched td').allInnerTexts();
    const rangeyCells = tableCells.filter((c) => /\d+(\.\d+)?\s*[–-]\s*\d+(\.\d+)?\s*(mcg|mg|IU)/.test(c));
    expect(rangeyCells, `no schedule cell may be a dose range; offenders: ${JSON.stringify(rangeyCells)}`).toEqual([]);
    // Specifically the S03 reference ranges must NOT have leaked into S02 as selected doses.
    for (const range of ['100–300', '100-300', '250–750', '250-750']) {
      expect(s02Text.includes(range), `S02 must NOT contain the broad range "${range}" (it belongs in S03)`).toBe(false);
    }
  });

  test('section 03 — compound reference: tier legend + full KLOW translation + forbids per-dose math', async ({ page }) => {
    const s03 = sectionByRunhead(page, 'SECTION 03 · COMPOUND / BLEND REFERENCE');
    await expect(s03).toHaveCount(1);

    // Evidence tiering callout + all four tier badges.
    await expect(s03.getByText('Evidence tiering used throughout.')).toBeVisible();
    for (const tier of ['T1', 'T2', 'T3', 'T4']) {
      expect(await s03.locator('.vd-badge', { hasText: new RegExp(`^${tier}$`) }).count(),
        `tier badge ${tier} present in S03`).toBeGreaterThanOrEqual(1);
    }

    // Full compound-named KLOW weekly translation renders here (and ONLY here in the product).
    const s03Text = await s03.innerText();
    expect(s03Text, 'S03 carries the full KLOW weekly translation').toMatch(
      /2\.5mg BPC-157[\s\S]*2\.5mg TB-500[\s\S]*2\.5mg KPV[\s\S]*10mg GHK-Cu[\s\S]*per week/i,
    );
    expect(s03Text, 'S03 explicitly forbids per-dose / per-day component math').toMatch(/not per dose, not per day/i);
  });

  test('section 04 — supportive lifestyle: numbered list + weekly tracking', async ({ page }) => {
    const s04 = sectionByRunhead(page, 'SECTION 04 · SUPPORTIVE LIFESTYLE');
    await expect(s04).toHaveCount(1);
    const ol = s04.locator('ol.vd-ol');
    await expect(ol.first()).toBeVisible();
    expect(await ol.locator('> li').count()).toBeGreaterThanOrEqual(4);
    await expect(s04.getByText('What to track weekly:')).toBeVisible();
  });

  test('section 05 — physiological monitoring: response patterns, signal tiers, checkpoints, contraindications, disclaimer', async ({ page }) => {
    const s05 = sectionByRunhead(page, 'SECTION 05 · PHYSIOLOGICAL MONITORING');
    await expect(s05).toHaveCount(1);

    await expect(s05.getByText('Three distinct response patterns')).toBeVisible();

    // Three signal tiers, each with ≥2 cards, identified by their exact eyebrow literals.
    const tiers = [
      { eyebrow: 'Expected adaptation · observe', sel: '.vd-signal--observe' },
      { eyebrow: 'Meaningful drift · check in', sel: '.vd-signal--drift' },
      { eyebrow: 'Stop now · physician same day', sel: '.vd-signal--stop' },
    ];
    await expect(s05.locator('.vd-signalgrid')).toBeVisible();
    for (const t of tiers) {
      expect(await s05.getByText(t.eyebrow).count(), `eyebrow "${t.eyebrow}" present`).toBeGreaterThanOrEqual(1);
      expect(await s05.locator(t.sel).count(), `tier ${t.sel} has ≥2 signal cards`).toBeGreaterThanOrEqual(2);
    }

    // Re-evaluation checkpoints (≥4).
    await expect(s05.getByText('Re-evaluation checkpoints')).toBeVisible();
    expect(await s05.locator('ul.vd-checkpoints > li').count()).toBeGreaterThanOrEqual(4);

    // Contraindications callout (coral) with ≥5 items (· -joined). Lives at document level (after S05).
    const contra = page.locator('.vdoc .vd-callout--coral').first();
    await expect(contra).toBeVisible();
    const contraText = await contra.innerText();
    expect(contraText.split('·').length, 'contraindications list has ≥5 items').toBeGreaterThanOrEqual(5);

    // Closing research/educational disclaimer.
    await expect(page.getByText('Strictly for research and educational purposes.')).toBeVisible();
  });

  // ---- Screenshots (structure/layout guard; DOM above is the hard gate) ----
  test('screenshots — fullpage, cover, S02 schedule, S05 signals', async ({ page }) => {
    await page.evaluate(() => document.fonts.ready);

    const vdoc = page.locator('.vdoc');
    await expect(vdoc).toBeVisible();
    await expect(vdoc).toHaveScreenshot('protocol-fullpage.png', { maxDiffPixelRatio: 0.02 });

    const cover = page.locator('.vdoc header').first();
    await expect(cover).toBeVisible();
    await expect(cover).toHaveScreenshot('protocol-cover.png', { maxDiffPixelRatio: 0.02 });

    const schedule = page.locator('table.vd-sched.vd-sched--weekly');
    await expect(schedule).toBeVisible();
    await expect(schedule).toHaveScreenshot('protocol-s02-schedule.png', { maxDiffPixelRatio: 0.02 });

    const signals = sectionByRunhead(page, 'SECTION 05 · PHYSIOLOGICAL MONITORING').locator('.vd-signalgrid');
    await expect(signals).toBeVisible();
    await expect(signals).toHaveScreenshot('protocol-s05-signals.png', { maxDiffPixelRatio: 0.02 });
  });
});
