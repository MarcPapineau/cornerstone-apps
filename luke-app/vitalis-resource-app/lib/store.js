/**
 * store.js — Tiny file-backed persistence (no DB for the MVP).
 *
 * Boots from clearly-labeled DEMO data on first run, then persists every mutation to
 * data/store.json so state survives restarts. Server-authoritative: the SPA never holds
 * the source of truth, it asks the API.
 */
const { readFileSync, writeFileSync, existsSync, mkdirSync } = require('node:fs');
const { resolve, dirname } = require('node:path');

const STORE_PATH = resolve(__dirname, '..', 'data', 'store.json');
const demo = require('@vitalis/protocol-core/data/demo-clients');
const { buildOpsDemo } = require('./ops-demo'); // Order Ops SIMULATION seed (every record _demo:true)

const COLLECTIONS = [
  'practitioners', 'clients', 'labResults', 'outcomes', 'drafts', 'reviews', 'genEvents',
  // Platform layer — onboarding, entitlements, paid add-ons
  'invitations', 'intakeSubmissions', 'clientDocuments', 'entitlements', 'addOnRequests', 'addOnDrafts',
  // Order Ops layer — internal operator order management (not customer-facing)
  'opsCustomers', 'opsOrders', 'opsInventory', 'opsInventoryMovements',
  'opsSupplierOrders', 'opsReferralAccounts', 'opsReferralLedger',
];

function seedFromDemo() {
  return {
    _seededAt: new Date().toISOString(),
    practitioners: (demo.DEMO_PRACTITIONERS || []).map((p) => ({ ...p })),
    clients: demo.DEMO_CLIENTS.map((c) => ({ ...c })),
    labResults: demo.DEMO_LAB_RESULTS.map((r) => ({ ...r })),
    outcomes: demo.DEMO_OUTCOMES.map((o) => ({ ...o })),
    drafts: demo.DEMO_DRAFTS.map((d) => ({ ...d })),
    reviews: [],
    genEvents: [],   // acknowledgment + practitioner-attestation log for the chat generator
    // Platform layer demo seeds (intakeSubmissions starts empty; clientDocuments seeds from demo).
    invitations: (demo.DEMO_INVITATIONS || []).map((x) => ({ ...x })),
    intakeSubmissions: [],
    clientDocuments: (demo.DEMO_CLIENT_DOCUMENTS || []).map((x) => ({ ...x })),
    entitlements: (demo.DEMO_ENTITLEMENTS || []).map((x) => ({ ...x })),
    addOnRequests: (demo.DEMO_ADDON_REQUESTS || []).map((x) => ({ ...x })),
    addOnDrafts: (demo.DEMO_ADDON_DRAFTS || []).map((x) => ({ ...x })),
    // Order Ops SIMULATION seed — fake customers/orders/inventory/suppliers/referrals built from
    // the canonical catalog; every record carries _demo:true. Makes the operator dashboard useful
    // on first boot instead of all-zeros. NOT real data, NOT a customer-facing surface.
    ...buildOpsDemo(),
  };
}

let state = null;

function load() {
  if (state) return state;
  if (existsSync(STORE_PATH)) {
    try { state = JSON.parse(readFileSync(STORE_PATH, 'utf8')); }
    catch { state = seedFromDemo(); save(); }
  } else {
    state = seedFromDemo();
    save();
  }
  for (const c of COLLECTIONS) if (!Array.isArray(state[c])) state[c] = [];
  return state;
}

function save() {
  if (!state) return;
  // data/ holds only gitignored runtime state, so it does not exist in a fresh
  // clone — and the first save then died with ENOENT on the DIRECTORY, not the
  // file. That made the app unbootable from a clean checkout while working
  // perfectly on any machine that had run it before. CI found this on its first
  // green-on-my-Mac / red-on-the-runner split.
  mkdirSync(dirname(STORE_PATH), { recursive: true });
  writeFileSync(STORE_PATH, JSON.stringify(state, null, 2));
}

function list(collection) { return load()[collection] || []; }
function get(collection, id) { return list(collection).find((x) => x.id === id) || null; }

function upsert(collection, obj) {
  load();
  const coll = state[collection];
  const i = coll.findIndex((x) => x.id === obj.id);
  if (i >= 0) coll[i] = { ...coll[i], ...obj };
  else coll.push(obj);
  save();
  return obj;
}

function remove(collection, id) {
  load();
  const before = state[collection].length;
  state[collection] = state[collection].filter((x) => x.id !== id);
  save();
  return state[collection].length < before;
}

function resetDemo() { state = seedFromDemo(); save(); return state; }

module.exports = { STORE_PATH, COLLECTIONS, load, save, list, get, upsert, remove, resetDemo };
