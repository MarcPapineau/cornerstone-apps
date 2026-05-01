# Habakkuk Rubric — tests-coverage

> Anti-Drift + WKU loaded at runtime into your system prompt. Not repeated.

## What "tests-coverage" means in this CRG codebase

CRG ships small smoke tests, not exhaustive coverage suites. The patterns
that exist:
- `luke-app/scripts/smoke-supply-2026-04-28.js`
- `luke-app/tests/smoke-paired-pen-math.js`
- `peptide-resource-app/tests/waterfall.spec.js` (Playwright)
- `peptide-resource-app/playwright.config.js`

You are NOT looking for unit-test purity. You ARE looking for:

- Did this PR change behavior that's covered by an existing smoke test
  WITHOUT updating the smoke test?
- Does the PR introduce a smoke test that doesn't actually exercise the
  thing it claims to (e.g. asserts on hardcoded mock data, never calls
  the real function)?
- Are there assertions that will silently pass on bad data (e.g.
  `expect(result).toBeDefined()` instead of `toEqual(...)`)?
- For CRG anchor rules (KLOW dose, paired-pen math, etc) — is there a
  smoke test pinning the doctrine? If a math function is changed and
  the doctrine smoke test isn't updated or extended — flag Major.

## Severity calibration

- **Blocker**: a doctrine math function changed and the existing smoke
  test that pins the doctrine wasn't updated AND would now fail; a test
  added that's tautological (`expect(true).toBe(true)`); test that
  silences a real failure with try/catch.
- **Major**: behavior change in code without a corresponding test
  update; smoke test that mocks the very thing it's supposed to verify;
  Playwright spec that doesn't await an async assertion.
- **Minor**: missing edge-case test for newly added validation;
  hardcoded test fixtures that should be parameterized; over-reliance
  on `setTimeout` for sync timing.
- **Nit**: test file naming conventions; describe-block organization;
  test name clarity.

## Hot patterns to scan in this PR

1. Look for math/dose changes in app.js and check whether the matching
   smoke-* file was touched.
2. New smoke files — read them critically. Do they actually test the
   feature, or do they just import-and-not-throw?
3. Playwright specs — flag `page.click()` without `await`, missing
   `expect()` calls between actions.
4. Mocked Anthropic SDK calls — flag if the mock returns a shape the
   real SDK doesn't produce (e.g. `{ choices: [...] }` is OpenAI shape,
   Anthropic returns `{ content: [...] }`).
5. `it.skip(...)` / `xit(...)` / `test.todo(...)` — flag if recently
   added to disable a test for the change under review.

## What NOT to flag

- "100% coverage" demands.
- "Add property-based testing" without a specific risk.
- Generic TDD lectures.
- Insufficient test isolation when the suite is just smoke checks
  that run sequentially.

## Confidence anchors

- Code change + matching test file change visible, mismatch obvious →
  0.9+
- Test added that you can demonstrate doesn't actually fire the function
  it claims → 0.85+
- Suspect coverage gap based on the diff's surface area → 0.7-0.8
- "Could use more tests" — < 0.7
