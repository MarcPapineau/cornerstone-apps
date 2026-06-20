'use strict';
/**
 * pages.smoke.spec.cjs — cross-role smoke + dashboard screenshots. Catches the "dashboard/page
 * silently rendered empty / light" regression (sprint case 7) and Route-Not-Found leakage.
 *
 * For EVERY route this asserts:
 *   (a) a route-specific HEALTHY signal is present;
 *   (b) the SPA fallback strings `Route not found` / `This surface has no module at that path.` are ABSENT;
 *   (c) <main> has non-trivial text (innerText length > 40);
 *   (d) ZERO console errors / pageerrors.
 * Content assertions (per discovery Surface E) ride on top of (a)–(d): the client dashboard's
 * 8-silo grid + real-first-name greeting, the labs surface's two panels + resolved latest-draw
 * date, the progress entries-ribbon + tracking rings, the documents dossier deep-links, the
 * practice quick-actions + queues, and the admin protocol-drafts/demo-clients counts. Where a seed
 * could legitimately empty, the assertion stays tolerant (accepts the intentional empty-state copy).
 *
 * Role is seeded into localStorage (`vitalis.demoRole`) BEFORE navigation — there is no auth.
 * OWNERSHIP: demo_kristen_a belongs to pr_morgan; the practitioner dossier/roster is pr_morgan's.
 * The non-empty review queue belongs to pr_lun. ADMIN is identity-independent (global data).
 * NO-DRAFT-LEAK: demo_eric_b's only protocol is an un-approved DRAFT, so his portal proves the
 * hard approval boundary at the rendered DOM (assertNoDraftLeak) — a draft must never reach a client.
 */
const { test, expect } = require('@playwright/test');

const FALLBACK_STRINGS = ['Route not found', 'This surface has no module at that path.'];

// Draft-leak canaries — strings that exist ONLY inside the un-approved Eric DRAFT
// (demo_draft_eric: status 'DRAFT') and its practitioner-only internals (warnings/rationale).
// Eric's only protocol is that draft, so NONE of these may ever surface on a CLIENT page. The
// server's clientVisibleProtocols projection drops un-approved drafts to null AND whitelists
// fields (warnings/raw rationale are physically stripped) — these literals are the canaries that
// prove the boundary held end-to-end through the rendered DOM (the runbook's draft-leak guard).
const DRAFT_LEAK_CANARIES = [
  'Retatrutide',                    // Eric DRAFT item productName (he has NO approved protocol)
  'GLP-1/GIP agonism',              // Eric DRAFT rationale fragment
  'NEEDS_REVIEW compliance flag',   // Eric DRAFT warning (practitioner-only, stripped by projection)
  'mandatory 6-wk taper',           // Eric DRAFT warning (practitioner-only, stripped)
  'Lipase / Amylase',               // Eric DRAFT monitoring fragment (un-approved → never projected)
  'Draft · practitioner-only',      // the draft-only banner string — must never reach a client
];

// Assert NONE of the draft-leak canaries appear anywhere in the document.
async function assertNoDraftLeak(page, where) {
  const body = (await page.locator('body').innerText());
  const leaked = DRAFT_LEAK_CANARIES.filter((c) => body.includes(c));
  expect(leaked, `draft content leaked onto ${where}: ${JSON.stringify(leaked)}`).toEqual([]);
}

/**
 * Visit a route under a seeded role and run the universal smoke gate, then any route-specific checks.
 *   role     — { role, practitionerId?, clientId? }
 *   path     — route to visit
 *   ready    — a locator string or fn(page)->locator to await as the route's primary healthy signal
 *   expects  — async (page) => void for additional route-specific assertions
 */
async function smoke(page, { role, path, ready, expects }) {
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

  await page.addInitScript((r) => { localStorage.setItem('vitalis.demoRole', JSON.stringify(r)); }, role);
  await page.goto(path);

  // Primary healthy signal — proves the route actually mounted its module.
  const readyLoc = typeof ready === 'function' ? ready(page) : page.locator(ready);
  await expect(readyLoc.first(), `healthy signal for ${path}`).toBeVisible({ timeout: 15_000 });
  await page.evaluate(() => document.fonts.ready);

  // (b) SPA fallback / not-found copy must be absent.
  for (const s of FALLBACK_STRINGS) {
    await expect(page.getByText(s), `"${s}" must be absent on ${path}`).toHaveCount(0);
  }
  // (c) <main> has non-trivial content.
  const mainText = (await page.locator('main').innerText()).trim();
  expect(mainText.length, `<main> on ${path} must have non-trivial text`).toBeGreaterThan(40);
  // (d) no console errors.
  expect(consoleErrors, `console errors on ${path}: ${JSON.stringify(consoleErrors)}`).toEqual([]);

  if (expects) await expects(page);
}

const CLIENT = { role: 'CLIENT', practitionerId: 'pr_morgan', clientId: 'demo_kristen_a' };
// demo_eric_b's ONLY protocol is an un-approved DRAFT (demo_draft_eric) — the canonical
// permission-boundary trap. Viewing the portal AS Eric must never surface that draft.
const CLIENT_ERIC = { role: 'CLIENT', practitionerId: 'pr_lun', clientId: 'demo_eric_b' };
const PRAC_MORGAN = { role: 'PRACTITIONER', practitionerId: 'pr_morgan', clientId: 'demo_kristen_a' };
const PRAC_LUN = { role: 'PRACTITIONER', practitionerId: 'pr_lun', clientId: 'demo_kristen_a' };
const ADMIN = { role: 'ADMIN', practitionerId: 'pr_lun', clientId: 'demo_kristen_a' };

test.describe('CLIENT portal (demo_kristen_a)', () => {
  test('/portal — welcome dashboard', async ({ page }) => {
    // The hero greets the client by their real first name. The seed display-name is "Demo —
    // Kristen A.", and the page strips the "Demo — " prefix before splitting, so it renders
    // "Welcome, Kristen". Assert the greeting STRUCTURE (the tolerant /^Welcome, / heading — the
    // real healthy signal) AND that the prefix-stripping did not regress to "Welcome, Demo".
    await smoke(page, {
      role: CLIENT, path: '/portal',
      ready: (p) => p.getByRole('heading', { name: /^Welcome, / }),
      expects: async (p) => {
        // The greeting must use the client's REAL first name (the seed's "Demo — " prefix is
        // stripped by the page → "Welcome, Kristen"). A literal "Welcome, Demo" would mean the
        // display-name de-prefixing regressed — assert it explicitly.
        await expect(
          p.getByRole('heading', { name: /^Welcome, Demo\b/ }),
          '/portal greeting must NOT render "Welcome, Demo" (display-name prefix not stripped)',
        ).toHaveCount(0);

        // ServiceSiloPanel — the "Every Vitalis service" grid. It renders one <a> per silo
        // (Peptide / Nutrition / Supplement / Meal / Lab Requests / Bloodwork / Progress /
        // Documents = 8). Scope to the panel that links BOTH the protocols and documents silos
        // (unique to this grid), then assert ≥8 anchor cards, each a real link with an href.
        const siloPanel = p.locator('main div.rounded-xl.border')
          .filter({ has: p.locator(':scope > a[href="/portal/protocols"]') })
          .filter({ has: p.locator(':scope > a[href="/portal/documents"]') })
          .first();
        await expect(siloPanel, 'ServiceSiloPanel grid present').toBeVisible();
        const siloCards = siloPanel.locator(':scope > a[href]');
        const n = await siloCards.count();
        expect(n, 'service-silo grid has ≥8 link cards').toBeGreaterThanOrEqual(8);
        for (let i = 0; i < n; i++) {
          const href = await siloCards.nth(i).getAttribute('href');
          expect(href && href.length > 1, `silo card ${i} is a link with an href`).toBe(true);
        }

        // Defense-in-depth: the client dashboard must never carry an un-approved draft's content.
        await assertNoDraftLeak(p, '/portal (CLIENT demo_kristen_a)');
      },
    });
    await expect(page.getByRole('heading', { name: /^Welcome, / })).toBeVisible();
    await expect(page.locator('header').first()).toHaveScreenshot('dash-client.png', { maxDiffPixelRatio: 0.02 });
    // Dashboard BODY (the new/changed content: metric rail + active-protocol + 8-silo grid +
    // progress rings). Baseline refreshed via test:visual:update — these are INTENDED changes.
    await expect(page.locator('main').first()).toHaveScreenshot('dash-client-body.png', { maxDiffPixelRatio: 0.03 });
  });

  test('/portal/protocols — approved KLOW + sleep protocol', async ({ page }) => {
    await smoke(page, {
      role: CLIENT, path: '/portal/protocols',
      ready: (p) => p.getByRole('heading', { name: 'My Peptide Protocols' }),
      expects: async (p) => {
        await expect(p.getByText('Recovery & Sleep — KLOW + Sleep Stack').first()).toBeVisible();
        // Kristen's APPROVED protocol may render; an un-approved draft's content may not.
        await assertNoDraftLeak(p, '/portal/protocols (CLIENT demo_kristen_a)');
      },
    });
  });

  test('/portal/usage — My Plan', async ({ page }) => {
    await smoke(page, {
      role: CLIENT, path: '/portal/usage',
      ready: (p) => p.getByRole('heading', { name: 'My Plan' }),
    });
  });

  test('/portal/labs — My Labs (2 panels + resolved latest-draw date)', async ({ page }) => {
    // The canonical demo seed POPULATES demo_kristen_a's labs with TWO draws (baseline 2026-03-10
    // + follow-up 2026-04-21; hs-CRP / Ferritin / Magnesium / Vitamin D / AST / ALT, several
    // out-of-range). Acceptance DF1 guarantees the recorded drawnAt survives the flag gate, so the
    // page renders both panel cards AND a RESOLVED latest-draw date — never a "—"/"no draws" stub.
    await smoke(page, {
      role: CLIENT, path: '/portal/labs',
      ready: (p) => p.getByRole('heading', { name: 'My Labs' }),
      expects: async (p) => {
        // Two lab panels render — each panel card carries a "Drawn <Mon DD, YYYY>" header.
        const drawnHeaders = p.getByText(/^Drawn\s+[A-Z][a-z]{2,}\s+\d{1,2},\s*\d{4}$/);
        expect(await drawnHeaders.count(), 'two lab panels render with resolved draw dates')
          .toBeGreaterThanOrEqual(2);

        // The "Latest draw" metric resolves to a real date (not "—" / "no draws yet"). The label and
        // its value live in the same MetricRail cell, so match the date adjacent to the label.
        const labsBody = (await p.locator('main').innerText());
        expect(labsBody, '"Latest draw" metric shows a resolved date')
          .toMatch(/Latest draw[\s\S]{0,40}?(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},\s*\d{4}/i);

        // The unresolved-state stubs must be ABSENT (this is the populated state).
        await expect(p.getByText('no draws yet'), '"no draws yet" must be absent (labs populated)').toHaveCount(0);
        await expect(p.getByText('No labs on file'), '"No labs on file" empty-state must be absent').toHaveCount(0);
        expect(labsBody.includes('Drawn —'), '"Drawn —" (unresolved date) must be absent').toBe(false);
      },
    });
  });

  test('/portal/nutrition — LIVE example slip from the client\'s own latest labs', async ({ page }) => {
    // demo_kristen_a has seeded lab draws, so the nutrition page must OPEN POPULATED: the server
    // resolves a role-softened slip from her most-recent draw (the same nutritionSlipForClient the
    // Client Package uses) and the page renders it framed as "Example from your latest labs" — NOT
    // the empty "Nothing analyzed yet" analyzer. The drop/paste analyzer stays available as the
    // "Analyze a different report" alternate. Acceptance N6 proves the slip is non-empty + client-safe;
    // this proves the rendered page reflects it.
    await smoke(page, {
      role: CLIENT, path: '/portal/nutrition',
      ready: (p) => p.getByRole('heading', { name: 'Nutrition — Naturopath Request Slip' }),
      expects: async (p) => {
        // The live-example framing banner is present (this is the populated state, not the analyzer).
        await expect(
          p.getByText(/Example from your latest labs/i).first(),
          'the live-example framing banner renders',
        ).toBeVisible();

        // The slip itself rendered — it names Dr. Vincent Lun and carries the resource-only banner.
        await expect(p.getByText(/Dr\. Vincent Lun/).first(), 'the slip names Dr. Vincent Lun').toBeVisible();

        // Hard rule D1 re-asserted on the rendered surface: "Vinny" never appears.
        const body = (await p.locator('main').innerText());
        expect(body.toLowerCase().includes('vinny'), 'the rendered nutrition page never says "Vinny"').toBe(false);

        // The empty analyzer stub must be ABSENT — the page is no longer "Nothing analyzed yet".
        await expect(
          p.getByText('Nothing analyzed yet'),
          'the empty "Nothing analyzed yet" stub must be absent (page opens populated)',
        ).toHaveCount(0);

        // It is a resource, never a prescription — the no-draft-leak guard still holds.
        await assertNoDraftLeak(p, '/portal/nutrition (CLIENT demo_kristen_a)');
      },
    });
    await expect(page.locator('main').first()).toHaveScreenshot('nutrition-client-body.png', { maxDiffPixelRatio: 0.03 });
  });

  test('/portal/progress — My Progress (entries ribbon + tracking rings)', async ({ page }) => {
    // The seed gives demo_kristen_a ~12 weeks of self-logged outcomes, so the hero ribbon reads
    // "<n> entries" and the GoalProgressPanel rings populate. Stay tolerant of a future empty seed:
    // accept EITHER the "<n> entries" ribbon OR the "No entries yet" ribbon — but the goal/tracking
    // rings panel ("Tracking rings") is ALWAYS rendered (the page never shows a blank box).
    await smoke(page, {
      role: CLIENT, path: '/portal/progress',
      ready: (p) => p.getByRole('heading', { name: 'My Progress' }),
      expects: async (p) => {
        const entriesRibbon = await p.getByText(/\d+ entries/i).count();
        const emptyRibbon = await p.getByText('No entries yet').count();
        expect(entriesRibbon + emptyRibbon, 'progress hero shows an entries-count ribbon (or the empty-state ribbon)')
          .toBeGreaterThan(0);

        // The goal/tracking rings panel is always present.
        await expect(p.getByText('Tracking rings'), 'goal/tracking rings panel renders').toBeVisible();
        await expect(p.getByText('Goal progress').first()).toBeVisible();
      },
    });
  });

  test('/portal/documents — approved dossier deep-links', async ({ page }) => {
    // Phase 2 wired the "Approved Vitalis documents" card: it surfaces ONLY the client's APPROVED
    // protocol as deep-links into the dossier renderer (/document/peptide/<id> and
    // /document/blood_req/<id>, both ?role=CLIENT). Assert ≥1 "Open" deep-link to /document/.
    await smoke(page, {
      role: CLIENT, path: '/portal/documents',
      ready: (p) => p.getByRole('heading', { name: 'My Documents' }),
      expects: async (p) => {
        const docLinks = p.locator('main a[href^="/document/"]');
        expect(await docLinks.count(), 'at least one /document/ deep-link is present')
          .toBeGreaterThanOrEqual(1);
        // The deep-link is an "Open" affordance and is scoped to the client view.
        const firstHref = await docLinks.first().getAttribute('href');
        expect(firstHref, '/document/ deep-link carries the CLIENT role').toMatch(/^\/document\/.+role=CLIENT/);
        await expect(docLinks.filter({ hasText: 'Open' }).first(), 'an "Open" deep-link renders').toBeVisible();
      },
    });
  });
});

// The hard permission boundary, proven through the rendered client DOM. demo_eric_b's ONLY
// protocol is an un-approved DRAFT (demo_draft_eric); the server's approval-gated projection
// drops it (and strips its practitioner-only fields), so NONE of its content may surface on
// Eric's portal. This is sprint regression #6 (client portal leaked a draft) caught at the UI.
test.describe('CLIENT no-draft-leak guard (demo_eric_b — draft-only client)', () => {
  test('/portal — Eric dashboard never shows his draft', async ({ page }) => {
    await smoke(page, {
      role: CLIENT_ERIC, path: '/portal',
      ready: (p) => p.getByRole('heading', { name: /^Welcome, / }),
      expects: async (p) => {
        // Real first name, never the seed prefix.
        await expect(p.getByRole('heading', { name: /^Welcome, Demo\b/ })).toHaveCount(0);
        await assertNoDraftLeak(p, '/portal (CLIENT demo_eric_b)');
      },
    });
  });

  test('/portal/protocols — Eric sees 0 approved, no draft content', async ({ page }) => {
    await smoke(page, {
      role: CLIENT_ERIC, path: '/portal/protocols',
      ready: (p) => p.getByRole('heading', { name: 'My Peptide Protocols' }),
      expects: async (p) => {
        // Eric has NO approved protocol → the dossier renderer (.vdoc) must not mount, and the
        // page must carry none of his draft's content.
        await expect(p.locator('.vdoc'), 'no approved dossier renders for a draft-only client').toHaveCount(0);
        await assertNoDraftLeak(p, '/portal/protocols (CLIENT demo_eric_b)');
      },
    });
  });
});

test.describe('PRACTITIONER practice', () => {
  test('/practice — command center (pr_morgan)', async ({ page }) => {
    await smoke(page, {
      role: PRAC_MORGAN, path: '/practice',
      ready: (p) => p.getByRole('heading', { name: 'Dr. Morgan Reyes' }),
      expects: async (p) => {
        // The four quick-action links (ActionCommandBar) resolve to their surfaces.
        const quickActions = [
          { label: 'Open a client', href: '/practice/clients' },
          { label: 'Invite client', href: '/practice/invitations' },
          { label: 'Add client', href: '/practice/clients' },
          { label: 'Add-on requests', href: '/practice/add-ons' },
        ];
        for (const qa of quickActions) {
          const link = p.locator(`main a[href="${qa.href}"]`).filter({ hasText: qa.label });
          await expect(link.first(), `quick-action "${qa.label}" → ${qa.href}`).toBeVisible();
        }
        // The command-center queues are present.
        await expect(p.getByText('What needs attention'), 'needs-attention queue').toBeVisible();
        await expect(p.getByText('Today’s review queue'), 'review queue').toBeVisible();
        await expect(p.getByRole('heading', { name: 'My clients' }), 'roster queue').toBeVisible();
      },
    });
    await expect(page.getByRole('heading', { name: 'Dr. Morgan Reyes' })).toBeVisible();
    await expect(page.locator('header').first()).toHaveScreenshot('dash-practice.png', { maxDiffPixelRatio: 0.02 });
    // Practice command-center BODY (new/changed: quick actions + needs-you tiles + queues).
    await expect(page.locator('main').first()).toHaveScreenshot('dash-practice-body.png', { maxDiffPixelRatio: 0.03 });
  });

  test('/practice/clients — roster with Kristen (pr_morgan)', async ({ page }) => {
    await smoke(page, {
      role: PRAC_MORGAN, path: '/practice/clients',
      ready: (p) => p.getByRole('heading', { name: 'My Clients' }),
      expects: async (p) => {
        await expect(p.getByText('Kristen').first()).toBeVisible();
      },
    });
  });

  test('/practice/clients/demo_kristen_a — client dossier + tab bar (pr_morgan)', async ({ page }) => {
    await smoke(page, {
      role: PRAC_MORGAN, path: '/practice/clients/demo_kristen_a',
      ready: (p) => p.getByText('Demo — Kristen A.').first(),
      expects: async (p) => {
        // TabBar present — assert two of its stable tab buttons.
        await expect(p.getByRole('button', { name: 'Overview' })).toBeVisible();
        await expect(p.getByRole('button', { name: 'Care Package' })).toBeVisible();
      },
    });
  });

  test('/practice/reviews — non-empty review queue (pr_lun)', async ({ page }) => {
    await smoke(page, {
      role: PRAC_LUN, path: '/practice/reviews',
      ready: (p) => p.getByRole('heading', { name: 'Review Queue' }),
      expects: async (p) => {
        // pr_lun owns the populated queue → at least one draft card with a review action.
        await expect(p.getByRole('button', { name: /Approve/i }).first()).toBeVisible();
      },
    });
  });
});

test.describe('ADMIN platform', () => {
  test('/admin — Vitalis Platform overview', async ({ page }) => {
    await smoke(page, {
      role: ADMIN, path: '/admin',
      ready: (p) => p.getByRole('heading', { name: 'Vitalis Platform' }),
    });
    await expect(page.getByRole('heading', { name: 'Vitalis Platform' })).toBeVisible();
    await expect(page.locator('header').first()).toHaveScreenshot('dash-admin.png', { maxDiffPixelRatio: 0.02 });
  });

  test('/admin/system — System Health + research source registry', async ({ page }) => {
    await smoke(page, {
      role: ADMIN, path: '/admin/system',
      ready: (p) => p.getByRole('heading', { name: 'System Health' }),
      expects: async (p) => {
        await expect(p.getByText('Research source registry')).toBeVisible();

        // The protocol-drafts tile (rendered as "Drafts awaiting review") must resolve to a NUMERIC
        // value, never "—". Acceptance DF2 guarantees admin overview exposes a real draftsAwaiting
        // count; this asserts it reached the rendered tile. Find the tile by its label, then read
        // the font-data value node in the same Stat card.
        const draftsLabel = p.getByText('Drafts awaiting review', { exact: true });
        await expect(draftsLabel, 'protocol-drafts tile present').toBeVisible();
        // Each Stat tile is a `div.p-4` card holding the label + exactly one `.font-data` value.
        const draftsCard = p.locator('div.p-4').filter({ has: draftsLabel });
        const draftsValue = (await draftsCard.locator('.font-data').innerText()).trim();
        expect(draftsValue, 'Drafts-awaiting tile shows a numeric value, not "—"').toMatch(/^\d+$/);

        // The demo-clients control line shows a number ("<n> demo clients currently seeded.").
        await expect(
          p.getByText(/\d+\s+demo clients currently seeded/i),
          'demo-clients line shows a number',
        ).toBeVisible();
      },
    });
  });

  test('/admin/practitioners — Lun + Reyes rows', async ({ page }) => {
    await smoke(page, {
      role: ADMIN, path: '/admin/practitioners',
      ready: (p) => p.getByText('Dr. Vincent Lun').first(),
      expects: async (p) => {
        await expect(p.getByText('Dr. Vincent Lun').first()).toBeVisible();
        await expect(p.getByText('Dr. Morgan Reyes').first()).toBeVisible();
      },
    });
  });
});
