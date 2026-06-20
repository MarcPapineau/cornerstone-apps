'use strict';
/**
 * order-ops.visual.spec.cjs — visual baselines for the internal Order Ops surface (admin-only),
 * added in the Order Ops sprint line. Covers all nine sub-routes under /admin/orders so future
 * layout drift ("thin-card" / empty-render / overflow) is caught.
 *
 * Role is seeded ADMIN into localStorage (`vitalis.demoRole`) BEFORE navigation — there is no auth;
 * the /api/ops/* surface is admin-gated, so a non-admin role would 403 the data. Each test asserts
 * the route mounted (a healthy signal), the EXACT simulation banner is visible, the SPA not-found
 * fallback is absent, and there are ZERO console errors — then snapshots the <main> body.
 *
 * Detail routes use the deterministic demo-seed ids (store.resetDemo → orders ops_ord_demo_1..5,
 * customers ops_cust_demo_1..3). The pixel threshold is tolerant (0.03): the demo seed dates are
 * RELATIVE to seed time, so date strings drift slightly day-to-day — DOM assertions are the hard
 * gate, screenshots guard structure/layout.
 */
const { test, expect } = require('@playwright/test');

const BANNER = 'This is a simulation, for Research purposes. Not actual representation.';
const ADMIN = { role: 'ADMIN', practitionerId: 'pr_lun', clientId: 'demo_kristen_a' };

const ROUTES = [
  { name: 'overview',        path: '/admin/orders',                           ready: 'Recent orders' },
  { name: 'new-order',       path: '/admin/orders/new',                       ready: 'Create order + invoice' },
  { name: 'orders-list',     path: '/admin/orders/list',                      ready: 'Payment status, balance, margin, and quick collection actions.' },
  { name: 'customers',       path: '/admin/orders/customers',                 ready: 'Select a row to see order history.' },
  { name: 'inventory',       path: '/admin/orders/inventory',                 ready: 'Low-stock reorder' },
  { name: 'suppliers',       path: '/admin/orders/suppliers',                 ready: 'New supplier order' },
  { name: 'referrals',       path: '/admin/orders/referrals',                 ready: 'Account credit only' },
  { name: 'order-detail',    path: '/admin/orders/ops_ord_demo_1',            ready: 'Lifecycle' },
  { name: 'customer-detail', path: '/admin/orders/customers/ops_cust_demo_1', ready: 'Order history' },
];

for (const r of ROUTES) {
  test(`order-ops ${r.name} — ${r.path}`, async ({ page }) => {
    const consoleErrors = [];
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

    await page.addInitScript((role) => { localStorage.setItem('vitalis.demoRole', JSON.stringify(role)); }, ADMIN);
    await page.goto(r.path);

    await expect(page.getByText(r.ready).first(), `healthy signal for ${r.path}`).toBeVisible({ timeout: 15_000 });
    await page.evaluate(() => document.fonts.ready);

    // Every Order Ops screen carries the EXACT simulation banner.
    await expect(page.getByText(BANNER).first(), `simulation banner on ${r.path}`).toBeVisible();
    // SPA not-found fallback must be absent.
    await expect(page.getByText('Route not found'), `no SPA fallback on ${r.path}`).toHaveCount(0);
    // No console errors / pageerrors.
    expect(consoleErrors, `console errors on ${r.path}: ${JSON.stringify(consoleErrors)}`).toEqual([]);

    // Body screenshot (banner + tab bar + content). Tolerant threshold — relative seed dates drift.
    await expect(page.locator('main').first()).toHaveScreenshot(`order-ops-${r.name}.png`, { maxDiffPixelRatio: 0.03 });
  });
}
