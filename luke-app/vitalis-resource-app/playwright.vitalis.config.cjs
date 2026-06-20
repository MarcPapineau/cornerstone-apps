'use strict';
/**
 * playwright.vitalis.config.cjs — Vitalis-specific visual-QA config.
 *
 * SEPARATE from the outer luke-app/playwright.config.js (that one belongs to the LUKE
 * order app on :3000 and is NOT touched here). This config:
 *   - is ALWAYS invoked with an explicit `--config=` (see package.json test:visual*),
 *     so it never collides with Playwright's bare `playwright.config.*` auto-discovery;
 *   - reuses the root-installed @playwright/test (resolved via parent node_modules) — NO new dependency;
 *   - targets the Vitalis SPA on :5173 (Vite), which proxies /api → :3100 (Express). Both must be up,
 *     so the webServer boots the whole stack via `npm run dev:all` (concurrently -k → clean teardown).
 *
 * DOM/text assertions are the authoritative anti-drift gate; screenshots catch layout/"thin-card"
 * regressions. Baselines live under tests/visual/__screenshots__/ (committed); transient diffs/traces
 * go to tests/visual/.output/ (gitignored).
 */
const { defineConfig, devices } = require('@playwright/test');
const path = require('node:path');

// Default target: the Vite SPA on :5173 (which proxies /api → the Express server on :3100), booted
// by the webServer block below. OPTIONAL override (additive, default behavior unchanged): set
// VITALIS_VISUAL_BASE_URL to point the suite at an already-running stack (e.g. a one-off
// `PORT=3199 node server.js` that serves the built dist + API on a single free port). When set, the
// config targets that URL and does NOT launch its own webServer — useful when :3100 is occupied by
// another process or in CI. With the env UNSET, `npm run test:visual` behaves exactly as before.
const EXTERNAL_URL = process.env.VITALIS_VISUAL_BASE_URL || null;
const VITALIS_URL = EXTERNAL_URL || 'http://localhost:5173';

module.exports = defineConfig({
  testDir: path.join(__dirname, 'tests', 'visual'),
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}/{arg}{ext}',
  // artifacts under .output/artifacts so the HTML report (.output/report) is a SIBLING, not nested
  // inside outputDir (Playwright clears outputDir on each run). Both stay under the gitignored .output/.
  outputDir: path.join(__dirname, 'tests', 'visual', '.output', 'artifacts'),
  fullyParallel: false, // single dev server + a runtime-mutable demo store → keep tests serial + deterministic
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  reporter: [
    ['list'],
    ['html', { outputFolder: path.join(__dirname, 'tests', 'visual', '.output', 'report'), open: 'never' }],
  ],
  expect: {
    timeout: 10_000,
    // tolerant pixel threshold — DOM assertions are the hard gate; screenshots guard structure/layout.
    toHaveScreenshot: { maxDiffPixelRatio: 0.02, animations: 'disabled', caret: 'hide' },
  },
  use: {
    baseURL: VITALIS_URL,
    headless: true,
    viewport: { width: 1440, height: 900 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // When VITALIS_VISUAL_BASE_URL is set, the caller owns the server → don't launch one here.
  ...(EXTERNAL_URL ? {} : {
    webServer: {
      command: 'npm run dev:all',
      cwd: __dirname,
      url: VITALIS_URL, // poll the SPA; once Vite is up the proxied API (:3100) is up too (same concurrently group)
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  }),
});
