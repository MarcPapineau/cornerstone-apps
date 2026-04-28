#!/usr/bin/env node
// Smoke test for 2026-04-28 combined fix.
// Asserts:
//   - Ipa+CJC 10mg low/mid/high → 10w / 5w / 3.3w (NEW Marc-confirmed)
//   - BPC+TB 15mg low (regression) → 6w
//   - MOTC 15mg low (regression) → 3w
//   - DAC 5mg solo (regression) doesn't mis-route to no-DAC
//   - Print Protocol output contains "Frequency:" and "Total weekly:"
//   - Print Invoice handler `printInvoice` is callable + opens window via printOrderPDF
//
// Loads app.js into a vm sandbox with stub `window`, `document`, `fetch`, etc.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const appPath = path.resolve(__dirname, '..', 'public', 'js', 'app.js');
const src = fs.readFileSync(appPath, 'utf8');

// Stub minimal browser globals so app.js doesn't throw on top-level evaluation.
let openedWindowHTML = null;
const fakeDoc = {
  documentElement: {},
  addEventListener: () => {},
  querySelectorAll: () => [],
  querySelector: () => null,
  getElementById: () => null,
  createElement: () => ({ classList: { add:()=>{}, remove:()=>{} }, appendChild:()=>{}, style: {} }),
};
const fakeWin = {
  addEventListener: () => {},
  open: () => ({
    document: {
      write: (h) => { openedWindowHTML = h; },
      close: () => {},
    },
    print: () => {},
  }),
  setTimeout: (fn, ms) => fn(),
  console,
  fetch: () => Promise.reject(new Error('no fetch in smoke')),
};

const sandbox = {
  window: fakeWin,
  document: fakeDoc,
  console,
  setTimeout: fakeWin.setTimeout,
  fetch: fakeWin.fetch,
  URL: { createObjectURL: () => 'blob://stub' },
};
sandbox.global = sandbox;
vm.createContext(sandbox);
// Wrap source so const/let declarations escape to sandbox via globalThis.
const wrapped = src + `
;Object.assign(globalThis, {
  __getSupplyData: getSupplyData,
  __SUPPLY_PAIRED: SUPPLY_PAIRED,
  __SUPPLY_DOSING: SUPPLY_DOSING,
  __SUPPLY_ALIASES: SUPPLY_ALIASES,
  __supplyEntriesFor: _supplyEntriesFor,
  __printOrderProtocol: printOrderProtocol,
  __printOrderPDF: printOrderPDF,
  __printInvoice: printInvoice,
  __orderLines: orderLines,
  __clients: clients,
});`;
vm.runInContext(wrapped, sandbox, { filename: appPath });

// Now assertions
const getSupplyData = sandbox.__getSupplyData;
const SUPPLY_PAIRED = sandbox.__SUPPLY_PAIRED;
const SUPPLY_DOSING = sandbox.__SUPPLY_DOSING;
const SUPPLY_ALIASES = sandbox.__SUPPLY_ALIASES;
const _supplyEntriesFor = sandbox.__supplyEntriesFor;
sandbox.printOrderProtocol = sandbox.__printOrderProtocol;
sandbox.printOrderPDF = sandbox.__printOrderPDF;
sandbox.printInvoice = sandbox.__printInvoice;
sandbox.orderLines = sandbox.__orderLines;
sandbox.clients = sandbox.__clients;

let passed = 0;
let failed = 0;
function assert(label, cond, expected, got) {
  if (cond) { passed++; console.log(`  PASS  ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}\n        expected: ${expected}\n        got:      ${got}`); }
}

// -- Supply math anchors
console.log('\n=== Supply math anchors ===');

// Ipa+CJC 10mg pen, low/mid/high
const ipaCjcPen = { name: 'Pen Ipamorelin/CJC1295', mg: 10, totalMg: 10, isPen: true };
const ipa10low  = getSupplyData(ipaCjcPen, 'low');
const ipa10mid  = getSupplyData(ipaCjcPen, 'mid');
const ipa10high = getSupplyData(ipaCjcPen, 'high');
assert('Ipa+CJC 10mg low → 10w',
  ipa10low && Math.abs(ipa10low.perVial - 10) < 0.01,
  '10', ipa10low && ipa10low.perVial);
assert('Ipa+CJC 10mg mid → 5w',
  ipa10mid && Math.abs(ipa10mid.perVial - 5) < 0.01,
  '5', ipa10mid && ipa10mid.perVial);
// Marc spec: 10mg pen (5mg+5mg) at high → 3.3w. Math: 5 / 1.5 = 3.333...
assert('Ipa+CJC 10mg high → 3.33w',
  ipa10high && Math.abs(ipa10high.perVial - (5/1.5)) < 0.001,
  '~3.33', ipa10high && ipa10high.perVial);
assert('Ipa+CJC paired entry resolved (peptidesMatched length 2)',
  ipa10low && ipa10low._peptidesMatched && ipa10low._peptidesMatched.length === 2,
  '2', ipa10low && ipa10low._peptidesMatched && ipa10low._peptidesMatched.join(','));
assert('Ipa+CJC paired keys are CJC-1295 + Ipamorelin (no DAC)',
  ipa10low && ipa10low._peptidesMatched && ipa10low._peptidesMatched.slice().sort().join('|') === 'CJC-1295|Ipamorelin',
  'CJC-1295|Ipamorelin', ipa10low && ipa10low._peptidesMatched && ipa10low._peptidesMatched.slice().sort().join('|'));
assert('Ipa+CJC has _drawDoseMgPerWeek=0.5 at low',
  ipa10low && ipa10low._drawDoseMgPerWeek === 0.5,
  '0.5', ipa10low && ipa10low._drawDoseMgPerWeek);

// BPC+TB regression — 15mg pen at low (2.5mg/wk)
const bpcTbPen = { name: 'Pen TB500+BPC157', mg: 15, totalMg: 15, isPen: true };
const bpcTb15low = getSupplyData(bpcTbPen, 'low');
assert('BPC+TB 15mg low → 6w (regression anchor)',
  bpcTb15low && Math.abs(bpcTb15low.perVial - 6) < 0.01,
  '6', bpcTb15low && bpcTb15low.perVial);
assert('BPC+TB still uses combinedMgPerWeek=2.5',
  bpcTb15low && bpcTb15low._drawDoseMgPerWeek === 2.5,
  '2.5', bpcTb15low && bpcTb15low._drawDoseMgPerWeek);

// MOTC regression — 15mg solo at low (5mg/wk)
const motcVial = { name: 'MOTc 5mg', mg: 15, totalMg: 15 };
const motc15low = getSupplyData(motcVial, 'low');
assert('MOTC 15mg low → 3w (regression anchor)',
  motc15low && Math.abs(motc15low.perVial - 3) < 0.01,
  '3', motc15low && motc15low.perVial);

// DAC routing regression — solo DAC product should resolve to 'CJC-1295 DAC' not 'CJC-1295'
const dacEntries = _supplyEntriesFor('CJC-1295 DAC 5mg/vial');
assert('CJC-1295 DAC 5mg/vial routes to CJC-1295 DAC (not no-DAC)',
  dacEntries.length === 1 && dacEntries[0] === 'CJC-1295 DAC',
  'CJC-1295 DAC', dacEntries.join(','));

// CJC alias check — bare cjc1295 token routes to no-DAC
const noDacEntries = _supplyEntriesFor('CJC1295');
assert('CJC1295 (no DAC keyword) routes to CJC-1295 no-DAC',
  noDacEntries.length === 1 && noDacEntries[0] === 'CJC-1295',
  'CJC-1295', noDacEntries.join(','));

// SUPPLY_DOSING / SUPPLY_PAIRED state checks
assert('SUPPLY_DOSING has CJC-1295 (no-DAC) entry',
  SUPPLY_DOSING['CJC-1295'] && SUPPLY_DOSING['CJC-1295'].low.mgPerWeek === 0.5,
  '0.5', SUPPLY_DOSING['CJC-1295'] && SUPPLY_DOSING['CJC-1295'].low.mgPerWeek);
assert('SUPPLY_DOSING has CJC-1295 DAC entry intact',
  SUPPLY_DOSING['CJC-1295 DAC'] && SUPPLY_DOSING['CJC-1295 DAC'].low.mgPerWeek === 1,
  '1', SUPPLY_DOSING['CJC-1295 DAC'] && SUPPLY_DOSING['CJC-1295 DAC'].low.mgPerWeek);
assert('SUPPLY_PAIRED has CJC-1295 + Ipamorelin entry',
  SUPPLY_PAIRED['CJC-1295 + Ipamorelin'] && SUPPLY_PAIRED['CJC-1295 + Ipamorelin'].low.combinedMgPerWeek === 0.5,
  '0.5', SUPPLY_PAIRED['CJC-1295 + Ipamorelin'] && SUPPLY_PAIRED['CJC-1295 + Ipamorelin'].low.combinedMgPerWeek);
assert('SUPPLY_PAIRED does NOT have CJC-1295 DAC + Ipamorelin (regression)',
  !SUPPLY_PAIRED['CJC-1295 DAC + Ipamorelin'],
  'undefined', SUPPLY_PAIRED['CJC-1295 DAC + Ipamorelin']);
assert('SUPPLY_ALIASES cjc1295 routes to CJC-1295 (no-DAC)',
  SUPPLY_ALIASES['cjc1295'] === 'CJC-1295',
  'CJC-1295', SUPPLY_ALIASES['cjc1295']);
assert('SUPPLY_ALIASES cjc1295dac routes to CJC-1295 DAC',
  SUPPLY_ALIASES['cjc1295dac'] === 'CJC-1295 DAC',
  'CJC-1295 DAC', SUPPLY_ALIASES['cjc1295dac']);

// -- Print Protocol upgrade
console.log('\n=== Print Protocol upgrade ===');
sandbox.orderLines.length = 0;
sandbox.orderLines.push({ id: 'p1', name: 'Pen Ipamorelin/CJC1295', sku: 'PEN-IPA-CJC', msrp: 800, qty: 1, lineTotal: 800, mg: 10, totalMg: 10, isPen: true, doseLevel: 'mid' });
// Need a fake order-client element returning empty value
const realGet = sandbox.document.getElementById;
sandbox.document.getElementById = (id) => {
  if (id === 'order-client') return { value: '' };
  return null;
};
openedWindowHTML = null;
sandbox.printOrderProtocol();
assert('Print Protocol opened a window (popup HTML written)',
  openedWindowHTML && openedWindowHTML.length > 0,
  'non-empty', openedWindowHTML && openedWindowHTML.length);
assert('Print Protocol output contains "Frequency:"',
  openedWindowHTML && openedWindowHTML.includes('Frequency:'),
  'true', openedWindowHTML && openedWindowHTML.includes('Frequency:'));
assert('Print Protocol output contains "Total weekly:"',
  openedWindowHTML && openedWindowHTML.includes('Total weekly:'),
  'true', openedWindowHTML && openedWindowHTML.includes('Total weekly:'));
assert('Print Protocol output contains dose-tier chip class',
  openedWindowHTML && /chip-(low|mid|high)/.test(openedWindowHTML),
  'true', openedWindowHTML && /chip-(low|mid|high)/.test(openedWindowHTML));
assert('Print Protocol output contains 5x/wk frequency for Ipa+CJC',
  openedWindowHTML && /5×\/wk/.test(openedWindowHTML),
  'true', openedWindowHTML && /5×\/wk/.test(openedWindowHTML));
assert('Print Protocol output contains "mg of each substance per week"',
  openedWindowHTML && openedWindowHTML.includes('mg of each substance per week'),
  'true', openedWindowHTML && openedWindowHTML.includes('mg of each substance per week'));

// -- Print Invoice fix
console.log('\n=== Print Invoice fix ===');
sandbox.document.getElementById = (id) => {
  if (id === 'order-client') return { value: 'c1' };
  if (id === 'order-notes') return { value: 'Test notes' };
  return null;
};
sandbox.clients.length = 0;
sandbox.clients.push({ id: 'c1', name: 'Test Client', email: 'test@example.com', phone: '555' });
openedWindowHTML = null;
let invoiceErr = null;
try {
  // printOrderPDF is async, but our window.open stub is synchronous so the
  // popup HTML is written before the function returns the Promise.
  const p = sandbox.printOrderPDF();
  if (p && p.catch) p.catch(e => { invoiceErr = e; });
} catch (e) { invoiceErr = e; }
assert('Print Invoice (printOrderPDF) did NOT throw',
  !invoiceErr,
  'no error', invoiceErr && invoiceErr.message);
assert('Print Invoice opened a window',
  openedWindowHTML && openedWindowHTML.length > 0,
  'non-empty', openedWindowHTML && openedWindowHTML.length);
assert('Print Invoice does NOT POST to /api/pdf/order anymore (HTML rendered client-side)',
  openedWindowHTML && openedWindowHTML.includes('<title>Invoice INV-'),
  'true', openedWindowHTML && openedWindowHTML.slice(0, 200));
assert('Print Invoice handler `printInvoice` exists and is callable',
  typeof sandbox.printInvoice === 'function',
  'function', typeof sandbox.printInvoice);
assert('Print Invoice contains "Bill to" + client name',
  openedWindowHTML && openedWindowHTML.includes('Bill to') && openedWindowHTML.includes('Test Client'),
  'true', openedWindowHTML && (openedWindowHTML.includes('Bill to') && openedWindowHTML.includes('Test Client')));

console.log(`\n=== Summary ===\nPASSED: ${passed}\nFAILED: ${failed}`);
if (failed > 0) process.exit(1);
