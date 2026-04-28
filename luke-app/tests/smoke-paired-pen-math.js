// Smoke test for paired-pen dose math fix (BUG #11).
// Marc anchor 2026-04-27 EOD: 15mg BPC+TB pen at 2.5mg/wk = 6 weeks per pen.
// Loads app.js in a sandbox and asserts getSupplyData() output for the
// canonical anchor cases. No browser deps required.

const fs = require('fs');
const vm = require('vm');
const path = require('path');

const appPath = path.resolve(__dirname, '..', 'public', 'js', 'app.js');
const src = fs.readFileSync(appPath, 'utf8');

// Provide minimal browser-like globals that app.js may touch at top level.
const sandbox = {
  console,
  document: {
    getElementById: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
  },
  window: {
    addEventListener: () => {},
    location: { href: '' },
  },
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  navigator: { userAgent: 'node' },
  fetch: () => Promise.resolve({ ok: false, json: () => ({}) }),
  setTimeout, clearTimeout, setInterval, clearInterval,
};
vm.createContext(sandbox);

// Run in non-strict mode so top-level `let products = []` etc. don't break us.
// Wrap in try so DOM-only init code that throws doesn't kill the smoke run —
// we only need getSupplyData to be defined.
try {
  vm.runInContext(src, sandbox, { filename: 'app.js' });
} catch (e) {
  // Top-level DOM init may throw — that's fine, getSupplyData should still be defined.
  console.warn('[smoke] non-fatal init error:', e.message);
}

const getSupplyData = sandbox.getSupplyData;
if (typeof getSupplyData !== 'function') {
  console.error('FAIL: getSupplyData not defined in sandbox');
  process.exit(1);
}

const cases = [
  // [label, productOrName, doseLevel, expectedWeeks]
  ['BPC+TB 15mg pen LOW (Marc anchor 2026-04-27 EOD: 6w)',
    { name: 'Pen TB500+BPC157 15mg', totalMg: 15 }, 'low', 6],
  ['BPC+TB 15mg pen MID (3w)',
    { name: 'Pen TB500+BPC157 15mg', totalMg: 15 }, 'mid', 3],
  ['BPC+TB 15mg pen HIGH (2w)',
    { name: 'Pen TB500+BPC157 15mg', totalMg: 15 }, 'high', 2],
  // Regression check: MOTC anchor must still hold (single-peptide branch untouched).
  ['MOTS-C 15mg pen LOW (regression check: 5mg/wk → 3w)',
    { name: 'MOTS-C', totalMg: 15 }, 'low', 3],
  ['MOTS-C 15mg pen MID (10mg/wk → 1.5w)',
    { name: 'MOTS-C', totalMg: 15 }, 'mid', 1.5],
  ['MOTS-C 15mg pen HIGH (15mg/wk → 1w)',
    { name: 'MOTS-C', totalMg: 15 }, 'high', 1],
];

let pass = 0;
let fail = 0;
const EPS = 1e-6;

for (const [label, productOrName, level, expected] of cases) {
  const sd = getSupplyData(productOrName, level);
  const actual = sd && typeof sd.perVial === 'number' ? sd.perVial : null;
  const ok = actual !== null && Math.abs(actual - expected) < EPS;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  console.log(`        expected: ${expected}w · actual: ${actual === null ? 'null' : actual + 'w'}`);
  if (sd && sd.doseNote) console.log(`        doseNote: ${sd.doseNote}`);
  if (ok) pass++; else fail++;
}

console.log(`\n${pass}/${pass + fail} passed.`);
process.exit(fail === 0 ? 0 : 1);
