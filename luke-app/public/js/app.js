// LUKE Research Operations App
let products = [];
let clients = [];
let orderLines = [];
let currentProtocol = null;
let allOrders = [];

// 2026-04-27 (BUG #6 — restore Gantt cycle-shift): order-page state for the
// Gantt chart. cycleStartWeek lets Marc shift the cycle window forward/back
// without rebuilding the order. Default 0 = cycle starts at week 1.
const orderState = {
  cycleStartWeek: 0,
  showProtocol: false  // Toggle for protocol panel (BUG #7)
};

// ─── Supply & Benefit Data ───────────────────────────────────
const SUPPLY_WEEKS = {
  // Each entry: perVial by dose tier (low=light/maintenance, mid=recovery, high=optimize)
  // perVial = weeks of supply per vial at that dose
  'BPC-157':          { low: { perVial: 17.1, doseNote: '167mcg/day – Light' }, mid: { perVial: 11.4, doseNote: '250mcg/day – Medium' }, high: { perVial: 5.7,  doseNote: '500mcg/day – High' } },
  'TB-500':           { low: { perVial: 16.7, doseNote: '1.5mg 2x/wk – Light' }, mid: { perVial: 10,   doseNote: '2.5mg 2x/wk – Medium' }, high: { perVial: 5,    doseNote: '5mg 2x/wk – High' } },
  'GHK-Cu':           { low: { perVial: 20.8, doseNote: '600mcg 4x/wk – Light' }, mid: { perVial: 12.5, doseNote: '1mg 4x/wk – Medium' }, high: { perVial: 8.3,  doseNote: '1.5mg 4x/wk – High' } },
  'KPV':              { low: { perVial: 20,   doseNote: '357mcg/day – Light' }, mid: { perVial: 14.3, doseNote: '500mcg/day – Medium' }, high: { perVial: 7.1,  doseNote: '1mg/day – High' } },
  'NAD+':             { low: { perVial: 8.3,  doseNote: '167mg 3x/wk – Light' }, mid: { perVial: 5.6,  doseNote: '250mg 3x/wk – Medium' }, high: { perVial: 3.3,  doseNote: '500mg 3x/wk – High' } },
  'CJC-1295 DAC':     { low: { perVial: 10,   doseNote: '0.5mg/wk – Light' }, mid: { perVial: 5,    doseNote: '1mg/wk – Medium' }, high: { perVial: 2.5,  doseNote: '2mg/wk – High' } },
  'Ipamorelin':       { low: { perVial: 7.1,  doseNote: '100mcg/day – Light' }, mid: { perVial: 3.6,  doseNote: '200mcg/day – Medium' }, high: { perVial: 2.4,  doseNote: '300mcg/day – High' } },
  'Retatrutide':      { low: { perVial: 10,   doseNote: '1mg/wk – Light' }, mid: { perVial: 5,    doseNote: '2mg/wk – Medium' }, high: { perVial: 2.5,  doseNote: '4mg/wk – High' } },
  'Tesamorelin':      { low: { perVial: 7.1,  doseNote: '1mg/day – Light' }, mid: { perVial: 3.6,  doseNote: '2mg/day – Medium' }, high: { perVial: 1.8,  doseNote: '4mg/day – High' } },
  'Epitalon':         { low: { perVial: 4.8,  doseNote: '3mg/day (10-day) – Light' }, mid: { perVial: 2.9,  doseNote: '5mg/day (10-day) – Medium' }, high: { perVial: 1.4,  doseNote: '10mg/day (10-day) – High' } },
  'SS-31':            { low: { perVial: 13.3, doseNote: '2.5mg 3x/wk – Light' }, mid: { perVial: 6.7,  doseNote: '5mg 3x/wk – Medium' }, high: { perVial: 3.3,  doseNote: '10mg 3x/wk – High' } },
  'MOTS-C':           { low: { perVial: 6.7,  doseNote: '5mg 3x/wk – Light' }, mid: { perVial: 3.3,  doseNote: '10mg 3x/wk – Medium' }, high: { perVial: 1.7,  doseNote: '20mg 3x/wk – High' } },
  'PT-141':           { low: { perVial: 57.1, doseNote: '0.875mg as needed – Light' }, mid: { perVial: 28.6, doseNote: '1.75mg as needed – Medium' }, high: { perVial: 14.3, doseNote: '3.5mg as needed – High' } },
  'Kisspeptin':       { low: { perVial: 33.3, doseNote: '50mcg 3x/wk – Light' }, mid: { perVial: 16.6, doseNote: '100mcg 3x/wk – Medium' }, high: { perVial: 8.3,  doseNote: '200mcg 3x/wk – High' } },
  'Thymosin Alpha-1': { low: { perVial: 31.3, doseNote: '0.8mg 2x/wk – Light' }, mid: { perVial: 15.6, doseNote: '1.6mg 2x/wk – Medium' }, high: { perVial: 7.8,  doseNote: '3.2mg 2x/wk – High' } },
  'Semax':            { low: { perVial: 8,    doseNote: 'intranasal 1-2x/day – Light' }, mid: { perVial: 4,    doseNote: 'intranasal 2-3x/day – Medium' }, high: { perVial: 2,    doseNote: 'intranasal 3-4x/day – High' } },
  'Selank':           { low: { perVial: 8,    doseNote: 'intranasal 1-2x/day – Light' }, mid: { perVial: 4,    doseNote: 'intranasal 2-3x/day – Medium' }, high: { perVial: 2,    doseNote: 'intranasal 3-4x/day – High' } },
  'AOD-9604':         { low: { perVial: 47.6, doseNote: '150mcg/day – Light' }, mid: { perVial: 23.8, doseNote: '300mcg/day – Medium' }, high: { perVial: 11.9, doseNote: '600mcg/day – High' } },
  'DSIP':             { low: { perVial: 20,   doseNote: '200mcg/day – Light' }, mid: { perVial: 14.3, doseNote: '300mcg/day – Medium' }, high: { perVial: 7.1,  doseNote: '600mcg/day – High' } },
  'Pinealon':         { low: { perVial: 14.3, doseNote: '5mg 3x/wk – Light' }, mid: { perVial: 7.1,  doseNote: '10mg 3x/wk – Medium' }, high: { perVial: 3.6,  doseNote: '20mg 3x/wk – High' } },
  'LL-37':            { low: { perVial: 10,   doseNote: '250mcg/day – Light' }, mid: { perVial: 5,    doseNote: '500mcg/day – Medium' }, high: { perVial: 2.5,  doseNote: '1mg/day – High' } },
  'SLU-PP-332':       { low: { perVial: 6.7,  doseNote: '5mg 3x/wk – Light' }, mid: { perVial: 3.3,  doseNote: '10mg 3x/wk – Medium' }, high: { perVial: 1.7,  doseNote: '20mg 3x/wk – High' } },
  'Hexarelin':        { low: { perVial: 14.3, doseNote: '100mcg/day – Light' }, mid: { perVial: 7.1,  doseNote: '200mcg/day – Medium' }, high: { perVial: 3.6,  doseNote: '400mcg/day – High' } },
  'Sermorelin':       { low: { perVial: 14.3, doseNote: '200mcg/day – Light' }, mid: { perVial: 7.1,  doseNote: '400mcg/day – Medium' }, high: { perVial: 3.6,  doseNote: '800mcg/day – High' } },
  'Dihexa':           { low: { perVial: 10,   doseNote: '5mg/day – Light' }, mid: { perVial: 5,    doseNote: '10mg/day – Medium' }, high: { perVial: 2.5,  doseNote: '20mg/day – High' } },
  'Melanotan':        { low: { perVial: 20,   doseNote: '500mcg 3x/wk – Light' }, mid: { perVial: 10,   doseNote: '1mg 3x/wk – Medium' }, high: { perVial: 5,    doseNote: '2mg 3x/wk – High' } },
  'SNAP-8':           { low: { perVial: 20,   doseNote: 'topical 2x/day – Light' }, mid: { perVial: 14.3, doseNote: 'topical 3x/day – Medium' }, high: { perVial: 7.1,  doseNote: 'topical 4x/day – High' } },
  'HCG':              { low: { perVial: 8.3,  doseNote: '500iu 3x/wk – Light' }, mid: { perVial: 5,    doseNote: '1000iu 3x/wk – Medium' }, high: { perVial: 2.5,  doseNote: '2000iu 3x/wk – High' } },
  'IGF-1':            { low: { perVial: 10,   doseNote: '40mcg/day – Light' }, mid: { perVial: 5,    doseNote: '80mcg/day – Medium' }, high: { perVial: 2.5,  doseNote: '160mcg/day – High' } },
  'GHRP':             { low: { perVial: 7.1,  doseNote: '100mcg 3x/day – Light' }, mid: { perVial: 3.6,  doseNote: '200mcg 3x/day – Medium' }, high: { perVial: 1.8,  doseNote: '400mcg 3x/day – High' } },
  'Cagrilintide':     { low: { perVial: 8.3,  doseNote: '0.3mg/wk – Light' }, mid: { perVial: 5,    doseNote: '0.6mg/wk – Medium' }, high: { perVial: 2.5,  doseNote: '1.2mg/wk – High' } },
  'Glutathione':      { low: { perVial: 5,    doseNote: '600mg 2x/wk – Light' }, mid: { perVial: 3.3,  doseNote: '900mg 2x/wk – Medium' }, high: { perVial: 1.7,  doseNote: '1200mg 2x/wk – High' } },
};

const COMPOUND_BENEFITS = {
  'BPC-157':          ['Heals tendons & ligaments', 'Repairs gut lining', 'Reduces inflammation', 'Neuroprotective'],
  'TB-500':           ['Systemic tissue repair', 'Reduces inflammation everywhere', 'Improves flexibility', 'Cardiac support'],
  'GHK-Cu':           ['Tightens & rejuvenates skin', 'Stimulates collagen', 'Hair growth', 'Activates 4,000+ repair genes'],
  'KPV':              ['Heals gut lining', 'Resolves histamine reactions', 'Anti-inflammatory', 'Safe long-term'],
  'NAD+':             ['Cellular energy restoration', 'DNA repair', 'Brain clarity', 'Anti-aging'],
  'CJC-1295 DAC':     ['Weekly GH stimulation', 'Muscle growth', 'Fat loss', 'Deep sleep improvement'],
  'Ipamorelin':       ['Clean GH release', 'No cortisol spike', 'Muscle & fat recomposition', 'Best for daily use'],
  'Retatrutide':      ['Triple fat loss mechanism', 'Appetite control', 'Insulin sensitivity', 'Up to 24% weight loss'],
  'Tesamorelin':      ['Targets visceral belly fat', 'FDA-approved GHRH', 'GH elevation', 'Proven in clinical trials'],
  'SS-31':            ['Cardiac mitochondrial protection', 'ATP optimization', 'Anti-aging at cell level', 'Longevity'],
  'PT-141':           ['Increases sexual desire', 'Brain-level activation', 'Works for men & women', 'FDA-approved'],
  'Thymosin Alpha-1': ['Restores immune function', 'T-cell activation', 'Post-viral recovery', 'Autoimmune support'],
  'Semax':            ['Elevates BDNF', 'Sharper focus', 'Memory improvement', 'Fast-acting (20min)'],
  'Selank':           ['Reduces anxiety', 'Calm focus', 'No sedation', 'No dependency risk'],
};

function getCompoundBenefits(productName) {
  // Try exact match first, then partial match
  if (COMPOUND_BENEFITS[productName]) return COMPOUND_BENEFITS[productName];
  const key = Object.keys(COMPOUND_BENEFITS).find(k => productName.toLowerCase().includes(k.toLowerCase()) || k.toLowerCase().includes(productName.toLowerCase()));
  return key ? COMPOUND_BENEFITS[key] : null;
}

// 2026-04-27 fix (BUG #9 — Pen TB500+BPC157, MOTc, SS31 missing from supply timeline):
// SUPPLY_WEEKS keys use canonical hyphenated forms (TB-500, MOTS-C, SS-31, BPC-157)
// but product names in catalog drop the hyphen (TB500, SS31) and abbreviate (MOTc).
// Substring match on raw strings can't bridge that. Normalize aggressively + alias map.
const SUPPLY_ALIASES = {
  'motc': 'MOTS-C', 'mots': 'MOTS-C', 'motsc': 'MOTS-C',
  'ss31': 'SS-31', 'ss-31': 'SS-31',
  'tb500': 'TB-500', 'tb-500': 'TB-500',
  'bpc157': 'BPC-157', 'bpc-157': 'BPC-157',
  'cjc1295': 'CJC-1295 DAC', 'cjc-1295': 'CJC-1295 DAC',
  'ghkcu': 'GHK-Cu', 'ghk-cu': 'GHK-Cu', 'skinglow': 'GHK-Cu', 'skin-glow': 'GHK-Cu',
  'ackpv': 'KPV', 'ac-kpv': 'KPV', 'kpvnh2': 'KPV', 'kpv-nh2': 'KPV',
  'reta': 'Retatrutide',
  'tesa': 'Tesamorelin',
  'sluPP332': 'SLU-PP-332', 'slu-pp-332': 'SLU-PP-332',
  'thymosinalpha1': 'Thymosin Alpha-1', 'thymosinalpha': 'Thymosin Alpha-1',
  'aod9604': 'AOD-9604', 'aod-9604': 'AOD-9604',
  'pt141': 'PT-141', 'pt-141': 'PT-141',
  'll37': 'LL-37', 'll-37': 'LL-37',
  'igf1': 'IGF-1', 'igf-1': 'IGF-1',
};

function _normalizeForMatch(s) {
  // Lowercase, strip non-alphanum (so "TB-500" → "tb500", "MOTc" → "motc")
  return (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function _supplyEntryFor(productName) {
  if (!productName) return null;
  // 1. Exact match first (cheap)
  let entry = SUPPLY_WEEKS[productName];
  if (entry) return entry;

  // 2. Strip "Pen ", "Spray ", trailing mg/sizes — work on each token.
  // Composite products like "Pen TB500+BPC157 15mg" should match the FIRST
  // recognized peptide so the timeline at least shows ONE entry per line.
  const cleaned = productName
    .replace(/^(pen|spray|kit|stack|combo)\s+/i, '')
    .replace(/\s+\d+(mg|mcg|iu|ml)\b/gi, '')
    .trim();
  const tokens = cleaned.split(/[+\/&,\s]+/).filter(Boolean);

  for (const token of tokens) {
    const norm = _normalizeForMatch(token);
    // 2a. Try alias table
    if (SUPPLY_ALIASES[norm] && SUPPLY_WEEKS[SUPPLY_ALIASES[norm]]) {
      return SUPPLY_WEEKS[SUPPLY_ALIASES[norm]];
    }
    // 2b. Try normalized substring match against SUPPLY_WEEKS keys
    const matchKey = Object.keys(SUPPLY_WEEKS).find(k => {
      const nk = _normalizeForMatch(k);
      return nk === norm || nk.includes(norm) || norm.includes(nk);
    });
    if (matchKey) return SUPPLY_WEEKS[matchKey];
  }

  // 3. Last-resort: full-name normalized substring match
  const fullNorm = _normalizeForMatch(productName);
  const fallbackKey = Object.keys(SUPPLY_WEEKS).find(k => {
    const nk = _normalizeForMatch(k);
    return fullNorm.includes(nk) || nk.includes(fullNorm);
  });
  return fallbackKey ? SUPPLY_WEEKS[fallbackKey] : null;
}

// 2026-04-27 fix (BUG #2 — Reta pen showing 5wks when 30mg pen at mid = 15wks):
// SUPPLY_WEEKS is keyed on the 10mg-vial baseline (because that is the most common
// vial size). Scale weeksPerVial by (totalMg || mg || 10) / 10 so a 30mg pen returns
// 3x the baseline weeks, a 5mg single vial returns 0.5x, etc. `productOrName` may be
// either a product object (preferred — has totalMg/mg) or a bare name string (legacy
// callers — falls back to baseline 10mg).
function getSupplyData(productOrName, doseLevel) {
  const level = doseLevel || 'mid'; // default to medium
  const productName = typeof productOrName === 'string'
    ? productOrName
    : (productOrName && productOrName.name) || '';
  const entry = _supplyEntryFor(productName);
  if (!entry) return null;
  // Support both old flat format and new tiered format
  const tier = entry.low ? (entry[level] || entry.mid) : entry; // legacy flat
  if (!tier) return null;
  // Determine mg-per-unit for scaling. Prefer totalMg (a box of 10× 5mg = 50mg total)
  // then mg, fall back to the SUPPLY_WEEKS baseline (10mg).
  let mgPerUnit = 10;
  if (typeof productOrName === 'object' && productOrName) {
    mgPerUnit = Number(productOrName.totalMg) || Number(productOrName.mg) || 10;
  }
  const scale = mgPerUnit / 10;
  const scaledPerVial = (tier.perVial || 0) * scale;
  return { perVial: scaledPerVial, doseNote: tier.doseNote, _baselinePerVial: tier.perVial, _mgPerUnit: mgPerUnit };
}

// 2026-04-27 fix (BUG #1 — discount auto-applying on pens):
// Pens, sprays and KLOW are exclusive items per Marc's pricing rules — never discountable
// regardless of catalog flag. Detect from sku prefix, name prefix, category, or isPen flag.
function isExclusiveItem(product) {
  if (!product) return false;
  const sku  = (product.sku  || '').toUpperCase();
  const name = (product.name || '').toLowerCase();
  const cat  = (product.category || '').toLowerCase();
  if (product.isPen === true || product.isSpray === true) return true;
  if (sku.startsWith('PEN-') || sku.startsWith('PEN')) return true;
  if (sku.includes('KLOW')) return true;
  if (name.startsWith('pen ') || name.startsWith('spray ')) return true;
  if (name.includes('klow')) return true;
  if (cat === 'pens' || cat === 'sprays') return true;
  return false;
}

function setLineDosingLevel(index, level) {
  if (orderLines[index]) {
    orderLines[index].doseLevel = level;
    renderOrderLines();
  }
}

// ─── Navigation ───────────────────────────────────────────────
function showPage(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  document.getElementById('page-' + page).classList.add('active');
  document.querySelectorAll('.nav-link').forEach(l => {
    if (l.getAttribute('onclick').includes(page)) l.classList.add('active');
  });
  if (page === 'dashboard') loadDashboard();
  if (page === 'clients') loadClients();
  if (page === 'history') loadOrders();
  if (page === 'compounds') initCompounds();
  if (page === 'diet') {/* form-only, no load needed */}
  if (page === 'stacks') loadStackLibrary();
  if (page === 'catalog') loadCatalog();
  if (page === 'highlights') loadHighlights();
  if (page === 'symptom-search') initSymptomSearch();
  if (page === 'compare') initComparePage();
  if (page === 'pos') initPOSPage();
}

// ─── Init ───────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  await loadProducts();
  await loadClientsData();
  loadDashboard();
});

async function loadProducts() {
  // 2026-04-27 fix: Netlify deploy has no /api/products endpoint (Express
  // backend only runs locally), so the dropdown was always empty in production.
  // Fall back to the static /catalog-data.json the deploy already publishes.
  try {
    const res = await fetch('/api/products');
    if (!res.ok) throw new Error('api unavailable');
    const data = await res.json();
    products = data.products || [];
  } catch {
    try {
      const res = await fetch('/catalog-data.json');
      if (!res.ok) throw new Error('catalog unavailable');
      const cat = await res.json();
      // Flatten { vials, pens, sprays, other } → products[] with category set
      // from the parent array name. Frontend's populateProductDropdown reads
      // p.category for the optgroup label, p.id/sku/name/msrp/cost/margin
      // unchanged from catalog-data.json shape.
      const tag = (arr, category) => (arr || []).map(p => ({
        ...p,
        category: p.category || category,
        // Catalog stores integer/float msrp; ensure number type for .toFixed()
        msrp: Number(p.msrp) || 0,
        cost: Number(p.cost) || 0,
        margin: Number(p.margin) || 0,
      }));
      products = [
        ...tag(cat.vials,  'Vials'),
        ...tag(cat.pens,   'Pens'),
        ...tag(cat.sprays, 'Sprays'),
        ...tag(cat.other,  'Other'),
      ];
      console.log(`loadProducts: catalog fallback loaded ${products.length} products`);
    } catch (err) {
      products = [];
      console.warn('Products API + catalog-data.json fallback both failed:', err.message);
    }
  }
  populateProductDropdown();
}

async function loadClientsData() {
  try {
    const res = await fetch('/api/clients');
    if (!res.ok) throw new Error('unavailable');
    const data = await res.json();
    clients = data.clients || [];
  } catch {
    clients = [];
  }
  populateClientDropdowns();
}

function populateProductDropdown() {
  const sel = document.getElementById('product-select');
  const categories = {};
  products.filter(p => p.msrp > 0).forEach(p => {
    const cat = p.category || 'Other';
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push(p);
  });
  sel.innerHTML = '<option value="">➕ Select product to add...</option>';
  // 2026-04-27 FIX (BUG #5): case-insensitive locale sort so "Pen ss31"
  // groups properly with "Pen Skin-glow" rather than splitting on case.
  Object.entries(categories)
    .sort((a, b) => a[0].localeCompare(b[0], undefined, { sensitivity: 'base' }))
    .forEach(([cat, prods]) => {
    const group = document.createElement('optgroup');
    group.label = cat;
    prods.sort((a,b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })).forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.dataset.name = p.name;
      opt.dataset.sku = p.sku;
      opt.dataset.msrp = p.msrp;
      opt.dataset.cost = p.cost || 0;
      opt.dataset.margin = p.margin || 0;
      opt.dataset.profit = p.profit || 0;
      const marginStr = p.margin ? ` · ${p.margin}% margin` : '';
      // 2026-04-27 FIX (BUG #4): show mg in dropdown text. Prefer mgLabel,
      // fall back to mg (e.g. "15mg"), nothing if unknown (Bacc Water etc.).
      const mgStr = p.mgLabel ? ` · ${p.mgLabel}` : (p.mg ? ` · ${p.mg}mg` : '');
      opt.textContent = `${p.name}${mgStr} — $${p.msrp.toFixed(2)}${marginStr}`;
      group.appendChild(opt);
    });
    sel.appendChild(group);
  });
}

function filterProductDropdown(query) {
  const q = query.toLowerCase().trim();
  const resultsEl = document.getElementById('product-quick-results');
  const sel = document.getElementById('product-select');
  if (!q) { resultsEl.classList.add('hidden'); sel.classList.remove('hidden'); return; }
  // 2026-04-27 FIX (BUG #5): case-insensitive secondary sort within KLOW priority.
  const matches = products.filter(p => p.msrp > 0 && (
    p.name.toLowerCase().includes(q) || (p.sku||'').toLowerCase().includes(q) || (p.category||'').toLowerCase().includes(q)
  )).sort((a, b) => {
    // KLOW always first
    const aKlow = a.sku?.includes('KLOW') || a.name?.toLowerCase().includes('klow');
    const bKlow = b.sku?.includes('KLOW') || b.name?.toLowerCase().includes('klow');
    if (aKlow && !bKlow) return -1;
    if (!aKlow && bKlow) return 1;
    return (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' });
  }).slice(0, 12);
  sel.classList.add('hidden');
  resultsEl.classList.remove('hidden');
  // Fire stack search in parallel — append results when ready
  appendStackSearchResults(q);
  if (matches.length === 0) {
    resultsEl.innerHTML = '<div class="quick-result-empty" id="qr-empty-msg">No direct product matches — checking stacks...</div>';
    return;
  }
  resultsEl.innerHTML = matches.map(p => {
    const profitStr = p.profit ? ` <span class="qr-profit">+$${parseFloat(p.profit).toFixed(2)}</span>` : '';
    const marginStr = p.margin ? ` <span class="qr-margin">${p.margin}%</span>` : '';
    // 2026-04-27 FIX (BUG #4): mg/dose info — prefer catalog mgLabel/mg/totalMg, fall
    // back to description-string scan only if catalog field is missing.
    let doseInfo = '';
    if (p.mgLabel) doseInfo = `<span class="qr-dose">${p.mgLabel}</span>`;
    else if (p.mg)  doseInfo = `<span class="qr-dose">${p.mg}mg${p.totalMg && p.totalMg !== p.mg ? ' ('+p.totalMg+' total)' : ''}</span>`;
    else {
      const desc = p.description || '';
      const doseMatch = desc.match(/(\d+[\.\d]*\s*(?:mg|mcg|mg\/vial|mcg\/day|mg\/day|IU))/i);
      if (doseMatch) doseInfo = `<span class="qr-dose">${doseMatch[1]}</span>`;
      else if (p.name.match(/(\d+\s*(?:mg|mcg|IU))/i)) doseInfo = `<span class="qr-dose">${p.name.match(/(\d+\s*(?:mg|mcg|IU))/i)[1]}</span>`;
    }
    const benefits = getCompoundBenefits(p.name);
    const benefitStr = benefits ? `<div class="qr-benefits">${benefits.slice(0,2).map(b => `<span>✓ ${b}</span>`).join('')}</div>` : '';
    // 2026-04-27 FIX (BUG #2): pass full product so supply is mg-scaled.
    const supply = getSupplyData(p);
    const supplyStr = supply ? `<span class="qr-supply">⏱ ~${supply.perVial.toFixed(1)} wks/vial</span>` : '';
    return `<div class="quick-result-item" onclick="quickAddById('${p.id}')" onmouseenter="previewProduct('${p.id}')">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div class="qr-name">${p.name}${doseInfo}</div>
        <span style="font-size:13px;font-weight:800;color:var(--green)">$${p.msrp.toFixed(2)}</span>
      </div>
      <div class="qr-meta">${profitStr}${marginStr}${supplyStr}<span class="qr-cat">${p.category||''}</span></div>
      ${benefitStr}
    </div>`;
  }).join('');
}

// Product preview card on hover in search results
function previewProduct(productId) {
  const p = products.find(x => x.id === productId);
  if (!p) return;
  // Show a floating preview if compound data exists
  const compound = window.lookupCompoundClient ? window.lookupCompoundClient(p.name) : null;
  // We'll use the existing compound modal for full detail
}

// Show rich compound detail in order - called when clicking product name in order table
function showOrderLineDetail(index) {
  const line = orderLines[index];
  if (!line) return;
  // Reuse compound modal
  openCompound(line.id);
}

function quickAddById(productId) {
  const p = products.find(x => x.id === productId);
  if (!p) return;
  const existing = orderLines.find(l => l.id === p.id);
  if (existing) {
    existing.qty += 1;
    existing.lineTotal = existing.msrp * existing.qty;
    existing.lineCost = existing.cost * existing.qty;
    showToast(`${existing.name} → qty ${existing.qty}`, 'info');
  } else {
    // Exclusive items (pens/sprays/KLOW): force discountAllowed=false regardless of catalog flag.
    const exclusive = isExclusiveItem(p);
    orderLines.push({
      id: p.id, name: p.name, sku: p.sku, msrp: p.msrp,
      cost: p.cost || 0, margin: p.margin || 0, profit: p.profit || 0,
      qty: 1, lineTotal: p.msrp, lineCost: p.cost || 0,
      discountAllowed: exclusive ? false : (p.discountAllowed || false),
      maxDiscountPct: exclusive ? 0 : (p.maxDiscountPct || 0),
      discountPct: 0, discountedPrice: p.msrp,
      // Carry through mg/category/isPen so renderers can scale supply + show mg in row
      mg: p.mg || null, totalMg: p.totalMg || null, mgLabel: p.mgLabel || null,
      category: p.category || null, isPen: !!p.isPen, isSpray: !!p.isSpray,
      isExclusive: exclusive
    });
  }
  document.getElementById('product-search-filter').value = '';
  document.getElementById('product-quick-results').classList.add('hidden');
  document.getElementById('product-select').classList.remove('hidden');
  renderOrderLines();
  showToast(`✓ ${p.name} added`, 'success');
}

function populateClientDropdowns() {
  ['order-client', 'protocol-client'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    sel.innerHTML = '<option value="">Select client...</option>';
    clients.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = `${c.name}${c.type === 'VIP' ? ' ⭐' : ''}`;
      sel.appendChild(opt);
    });
  });
}

// ─── Dashboard ───────────────────────────────────────────────
async function loadDashboard() {
  try {
    const res = await fetch('/api/stats');
    if (!res.ok) throw new Error('unavailable');
    const stats = await res.json();
    document.getElementById('stat-clients').textContent = stats.totalClients || 0;
    document.getElementById('stat-orders').textContent = stats.totalOrders || 0;
    document.getElementById('stat-protocols').textContent = stats.activeProtocols || 0;
    document.getElementById('stat-products').textContent = products.length || 0;
  } catch {
    ['stat-clients','stat-orders','stat-protocols'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = '—';
    });
    const el = document.getElementById('stat-products');
    if (el) el.textContent = products.length || '—';
  }

  // Load renewal alerts
  loadRenewalAlerts();

  let ordersData = { orders: [] };
  try {
    const ordersRes = await fetch('/api/orders');
    if (ordersRes.ok) ordersData = await ordersRes.json();
  } catch { /* offline */ }

  // Filter out blank/test orders (no client name and $0 total)
  const recent = (ordersData.orders || []).filter(o => o.clientName || o.total > 0).slice(0, 5);
  const container = document.getElementById('recent-orders');
  if (recent.length === 0) {
    container.innerHTML = '<div class="empty-state">No orders yet</div>';
    return;
  }
  container.innerHTML = recent.map(o => `
    <div class="list-item" onclick="showPage('history')" style="cursor:pointer">
      <div class="list-item-main">
        <span class="item-title">${o.clientName || 'Unknown Client'}</span>
        <span class="item-sub">${o.orderNumber || ''} · ${o.date || ''}</span>
      </div>
      <div class="list-item-right">
        <span class="badge badge-${(o.paymentStatus||'').toLowerCase()}">${o.paymentStatus || 'Pending'}</span>
        <span class="item-price">$${(o.total || 0).toFixed(2)}</span>
      </div>
    </div>`).join('');
}

// ─── Order Builder ───────────────────────────────────────────
function quickAddProduct(sel) {
  const opt = sel.options[sel.selectedIndex];
  if (!opt.value) return;

  const existing = orderLines.find(l => l.id === opt.value);
  if (existing) {
    existing.qty += 1;
    existing.lineTotal = existing.msrp * existing.qty;
    existing.lineCost = existing.cost * existing.qty;
    showToast(`${existing.name} → qty ${existing.qty}`, 'info');
  } else {
    const msrp = parseFloat(opt.dataset.msrp)||0;
    const cost = parseFloat(opt.dataset.cost)||0;
    const p = products.find(x => x.id === opt.value);
    const exclusive = isExclusiveItem(p);
    orderLines.push({
      id: opt.value, name: opt.dataset.name, sku: opt.dataset.sku,
      msrp, cost,
      margin: parseFloat(opt.dataset.margin)||0,
      profit: parseFloat(opt.dataset.profit)||0,
      qty: 1, lineTotal: msrp, lineCost: cost,
      discountAllowed: exclusive ? false : (p?.discountAllowed || false),
      maxDiscountPct: exclusive ? 0 : (p?.maxDiscountPct || 0),
      discountPct: 0, discountedPrice: msrp,
      mg: p?.mg || null, totalMg: p?.totalMg || null, mgLabel: p?.mgLabel || null,
      category: p?.category || null, isPen: !!p?.isPen, isSpray: !!p?.isSpray,
      isExclusive: exclusive
    });
  }

  // Reset dropdown so user can add another
  sel.selectedIndex = 0;
  renderOrderLines();
}

function changeQty(index, delta) {
  const line = orderLines[index];
  if (!line) return;
  line.qty = Math.max(1, (line.qty || 1) + delta);
  const unitPrice = line.discountedPrice || line.msrp;
  line.lineTotal = unitPrice * line.qty;
  line.lineCost = (line.cost||0) * line.qty;
  renderOrderLines();
}

function removeOrderLine(index) {
  if (index < 0 || index >= orderLines.length) return;
  orderLines.splice(index, 1);
  renderOrderLines();
}

function getSubtotal() {
  return orderLines.reduce((sum, l) => sum + l.lineTotal, 0);
}

function renderOrderLines() {
  const empty = document.getElementById('order-empty');
  const table = document.getElementById('order-table');
  const summary = document.getElementById('order-summary');
  const tbody = document.getElementById('order-tbody');

  if (orderLines.length === 0) {
    empty.classList.remove('hidden');
    table.classList.add('hidden');
    summary.classList.add('hidden');
    const sp = document.getElementById('supply-panel');
    if (sp) sp.classList.add('hidden');
    return;
  }

  empty.classList.add('hidden');
  table.classList.remove('hidden');
  summary.classList.remove('hidden');

  // 2026-04-27 FIX (BUG #1 — discount auto-applying):
  // Removed auto-set discount tier. Marc explicitly says discount must be opt-IN.
  // Default = 0% / "No Discount" until Marc picks a tier himself. The dropdown
  // labels still tell him which tier qualifies ("10+ units → 20%") but the app
  // no longer overrides his selection on every render.

  const thead = document.querySelector('#order-table thead tr');
  if (thead && !thead.querySelector('.col-cost')) {
    thead.innerHTML = `<th>Product</th><th>Qty</th><th>MSRP</th><th class="col-cost" style="color:#f59e0b">Cost</th><th>Line Total</th><th class="col-margin" style="color:#22c55e">Net</th><th></th>`;
  }
  tbody.innerHTML = orderLines.map((l, i) => {
    const lineCost = (l.cost||0)*l.qty;
    const lineProfit = l.lineTotal - lineCost;
    const marginPct = l.lineTotal > 0 ? (lineProfit/l.lineTotal*100).toFixed(0) : 0;
    const unitPrice = l.discountedPrice || l.msrp;
    // 2026-04-27 FIX (BUG #1): exclusive items show disabled discount input with tooltip.
    let discountHtml = '';
    if (l.isExclusive) {
      discountHtml = `
        <div class="line-discount line-discount-locked" title="Pens / sprays / KLOW are exclusive items — no discount">
          <span class="discount-label" style="color:var(--muted2);font-weight:600;">Exclusive — no discount</span>
        </div>`;
    } else if (l.discountAllowed) {
      discountHtml = `
        <div class="line-discount">
          <span class="discount-label">Discount:</span>
          <input type="number" class="discount-input" min="0" max="${l.maxDiscountPct}"
                 value="${l.discountPct || 0}"
                 onchange="applyLineDiscount(${i}, this.value)"
                 placeholder="0"/> %
          <span class="discount-max">(max ${l.maxDiscountPct}%)</span>
        </div>`;
    }
    const msrpDisplay = l.discountPct > 0
      ? `<span style="text-decoration:line-through;color:var(--muted2);font-size:10px">$${l.msrp.toFixed(2)}</span> <span style="color:var(--green)">$${unitPrice.toFixed(2)}</span>`
      : `$${l.msrp.toFixed(2)}`;

    // Supply info with dosing tier selector
    const doseLevel = l.doseLevel || 'mid';
    // 2026-04-27 FIX (BUG #2): pass full line object so getSupplyData can scale by mg/totalMg.
    const supplyData = getSupplyData(l, doseLevel);
    let supplyHtml = '';
    if (supplyData) {
      const weeks = (supplyData.perVial * l.qty).toFixed(1);
      const weeksNum = parseFloat(weeks);
      // 2026-04-27 FIX (BUG #3): per-peptide monthly cost using PRD formula
      // monthlyCost = vialPrice / (weeksPerVial / 4.33). Show on each row.
      const perVialWeeks = supplyData.perVial; // already mg-scaled
      const monthlyCost = perVialWeeks > 0 ? (l.msrp / (perVialWeeks / 4.33)).toFixed(2) : '—';
      const cycleTotalCost = l.lineTotal.toFixed(2);
      const entry = _supplyEntryFor(l.name);
      const hasTiers = entry && entry.low;
      const tierSelector = hasTiers ? `
        <select class="dose-tier-select" onchange="setLineDosingLevel(${i}, this.value)" title="Dosing level">
          <option value="low"  ${doseLevel==='low' ?'selected':''}>Light</option>
          <option value="mid"  ${doseLevel==='mid' ?'selected':''}>Medium</option>
          <option value="high" ${doseLevel==='high'?'selected':''}>High</option>
        </select>` : '';
      supplyHtml = `<div class="supply-inline">
        ${tierSelector}
        <span class="supply-chip">⏱ ${weeks} wks supply</span>
        <span class="supply-chip supply-chip-gold">~$${monthlyCost}/mo</span>
        <span class="supply-chip" style="background:rgba(34,197,94,0.1);color:#22c55e;border-color:#22c55e">$${cycleTotalCost} for ${weeks}w</span>
        <span class="supply-chip-dose">${supplyData.doseNote}</span>
      </div>`;
    }

    // Benefits
    const benefits = getCompoundBenefits(l.name);
    const benefitsHtml = benefits ? `<div class="benefits-inline">${benefits.map(b => `<span class="benefit-tag">✓ ${b}</span>`).join('')}</div>` : '';

    // 2026-04-27 FIX (BUG #4): show mg in the row header next to product name.
    const mgValue = l.totalMg || l.mg || null;
    const mgChip = mgValue ? ` <span class="product-mg-chip" style="background:#3296a4;color:#fff;font-size:10px;font-weight:700;padding:2px 7px;border-radius:10px;margin-left:6px;">${mgValue}mg</span>` : '';

    return `<tr>
      <td><div class="product-name" onclick="openCompound('${l.id}')" title="Click for dosing guide">${l.name}${mgChip} <span style="font-size:10px;color:var(--text-muted)">ℹ</span></div><div class="product-sku">${l.sku}</div>${discountHtml}${supplyHtml}${benefitsHtml}</td>
      <td><div class="qty-control">
        <button class="qty-btn" onclick="changeQty(${i},-1)">−</button>
        <span class="qty-display">${l.qty}</span>
        <button class="qty-btn" onclick="changeQty(${i},1)">+</button>
      </div></td>
      <td>${msrpDisplay}</td>
      <td style="color:#f59e0b;font-size:13px">${l.cost>0?'$'+l.cost.toFixed(2):'—'}</td>
      <td><strong>$${l.lineTotal.toFixed(2)}</strong></td>
      <td style="color:#22c55e;font-size:13px;font-weight:600">${lineProfit>0?'+$'+lineProfit.toFixed(2)+' ('+marginPct+'%)':'—'}</td>
      <td><button class="btn-remove" onclick="removeOrderLine(${i})">✕</button></td>
    </tr>`;
  }).join('');

  updateOrderTotals(getSubtotal());
  renderSupplyPanel();
}

// 2026-04-27 (BUG #6): cycle-shift handlers wired from the Gantt header arrows.
function shiftCycleStart(delta) {
  orderState.cycleStartWeek = Math.max(0, (orderState.cycleStartWeek || 0) + delta);
  renderSupplyPanel();
}

function renderSupplyPanel() {
  const panel = document.getElementById('supply-panel');
  if (!panel) return;

  // Only show items that have supply data.
  // 2026-04-27 (BUG #2/#3): pass full line object so getSupplyData scales by mg/totalMg.
  // Per-peptide monthly cost uses PRD formula: vialPrice / (weeksPerVial / 4.33).
  const linesWithSupply = orderLines.map(l => {
    const sd = getSupplyData(l, l.doseLevel || 'mid');
    if (!sd) return null;
    const perVial = sd.perVial;          // mg-scaled weeks of supply per unit
    const weeks = perVial * l.qty;       // total weeks across the qty purchased
    const monthlyCost = perVial > 0 ? l.msrp / (perVial / 4.33) : 0;
    const cycleTotal = l.lineTotal;
    return { name: l.name, weeks, perVial, monthlyCost, cycleTotal, lineTotal: l.lineTotal, doseNote: sd.doseNote, qty: l.qty, msrp: l.msrp };
  }).filter(Boolean);

  if (linesWithSupply.length === 0) {
    panel.classList.add('hidden');
    return;
  }

  panel.classList.remove('hidden');

  const cycleStart = orderState.cycleStartWeek || 0;
  const maxWeeks = Math.max(...linesWithSupply.map(x => x.weeks));
  const minWeeks = Math.min(...linesWithSupply.map(x => x.weeks));
  // Chart end = furthest "supply running" week from current cycle start.
  const chartEnd = Math.max(maxWeeks, cycleStart + maxWeeks);
  const totalMonthly = linesWithSupply.reduce((s, x) => s + x.monthlyCost, 0);

  // Each row: a bar offset by cycleStart, width proportional to that compound's weeks of supply.
  const rows = linesWithSupply.map(x => {
    const offsetPct = chartEnd > 0 ? Math.round((cycleStart / chartEnd) * 100) : 0;
    const barPct = chartEnd > 0 ? Math.round((x.weeks / chartEnd) * 100) : 0;
    const weeksStr = x.weeks % 1 === 0 ? x.weeks.toFixed(0) : x.weeks.toFixed(1);
    const isBottleneck = x.weeks === minWeeks && linesWithSupply.length > 1;
    const barColor = isBottleneck ? 'var(--gold)' : 'var(--green)';
    return `<div class="gantt-row" style="display:grid;grid-template-columns:120px 1fr 140px;align-items:center;gap:8px;padding:6px 0;">
      <div class="gantt-name" title="${x.name}" style="font-size:12px;font-weight:600;">${x.name.length > 16 ? x.name.substring(0,15)+'…' : x.name}</div>
      <div class="gantt-bar-wrap" style="position:relative;background:#f3f4f6;border-radius:4px;height:18px;overflow:hidden;">
        <div class="gantt-bar" style="position:absolute;left:${offsetPct}%;width:${barPct}%;height:100%;background:${barColor};border-radius:4px;"></div>
      </div>
      <div class="gantt-meta" style="display:flex;gap:6px;justify-content:flex-end;font-size:11px;">
        <span class="gantt-weeks" style="color:var(--green);font-weight:700;">${weeksStr}w</span>
        <span class="gantt-monthly" style="color:var(--gold);font-weight:700;">$${x.monthlyCost.toFixed(0)}/mo</span>
        <span class="gantt-total" style="color:var(--text-muted);font-weight:600;">$${x.cycleTotal.toFixed(0)} total</span>
      </div>
    </div>`;
  }).join('');

  const bottleneckWeeks = minWeeks.toFixed(1);
  const maxWeeksStr = maxWeeks % 1 === 0 ? maxWeeks.toFixed(0) : maxWeeks.toFixed(1);
  const bottleneckLine = linesWithSupply.find(x => x.weeks === minWeeks);

  // Per-peptide budget breakdown rows for total cost / monthly cost (BUG #3 / #8)
  const breakdownRows = linesWithSupply.map(x => `
    <div style="display:grid;grid-template-columns:1.2fr 0.8fr 0.8fr 0.8fr;gap:8px;padding:5px 8px;border-bottom:1px solid #f3f4f6;font-size:12px;">
      <span style="font-weight:600;">${x.name}</span>
      <span style="text-align:right;color:var(--gold);font-weight:700;">$${x.monthlyCost.toFixed(0)}/mo</span>
      <span style="text-align:right;color:#22c55e;font-weight:600;">$${x.cycleTotal.toFixed(0)} cycle</span>
      <span style="text-align:right;color:var(--text-muted);">${x.qty}× / ${x.weeks.toFixed(1)}w</span>
    </div>`).join('');

  panel.innerHTML = `
    <div class="supply-panel-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
      <span class="supply-panel-title" style="font-weight:700;font-size:13px;">Protocol Supply Timeline</span>
      <span class="supply-panel-hint" style="font-size:11px;color:var(--text-muted);">
        Cycle starts: <strong>Week ${cycleStart + 1}</strong> ·
        Total supply: <strong>${maxWeeksStr} wks</strong> ·
        Bottleneck: <strong>${bottleneckLine ? bottleneckLine.name : '—'} @ ${bottleneckWeeks}w</strong>
      </span>
      <div class="cycle-shift-controls" style="display:flex;gap:6px;">
        <button onclick="shiftCycleStart(-1)" title="Shift cycle start back 1 week"
          style="padding:4px 10px;border:1px solid #d1d5db;background:#fff;border-radius:4px;cursor:pointer;font-weight:700;">&larr;</button>
        <button onclick="shiftCycleStart(1)" title="Shift cycle start forward 1 week"
          style="padding:4px 10px;border:1px solid #d1d5db;background:#fff;border-radius:4px;cursor:pointer;font-weight:700;">&rarr;</button>
      </div>
    </div>
    <div class="gantt-chart" style="margin:10px 0;">
      ${rows}
    </div>
    <div class="supply-budget-breakdown" style="margin-top:10px;border:1px solid #e5e7eb;border-radius:6px;background:#fafafa;padding:8px;">
      <div style="display:grid;grid-template-columns:1.2fr 0.8fr 0.8fr 0.8fr;gap:8px;padding:4px 8px;font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;border-bottom:2px solid #e5e7eb;">
        <span>Peptide</span><span style="text-align:right;">$/Month</span><span style="text-align:right;">Cycle Cost</span><span style="text-align:right;">Qty / Supply</span>
      </div>
      ${breakdownRows}
    </div>
    <div class="supply-panel-footer" style="display:flex;justify-content:space-between;margin-top:10px;padding:8px;background:#fafafa;border-radius:6px;">
      <div class="supply-footer-item">
        <span class="supply-footer-label" style="font-size:10px;color:var(--text-muted);text-transform:uppercase;">Runs out first</span>
        <div class="supply-footer-value gold" style="font-weight:700;color:var(--gold);">${bottleneckLine ? bottleneckLine.name : '—'} @ ${bottleneckWeeks} wks</div>
      </div>
      <div class="supply-footer-item" style="text-align:right;">
        <span class="supply-footer-label" style="font-size:10px;color:var(--text-muted);text-transform:uppercase;">Total Monthly Cost</span>
        <div class="supply-footer-value green" style="font-weight:700;color:#22c55e;">~$${totalMonthly.toFixed(0)}/month</div>
      </div>
    </div>
    <div class="protocol-toggle-row" style="margin-top:10px;text-align:center;">
      <button onclick="toggleProtocolPanel()" id="protocol-toggle-btn"
        style="padding:8px 18px;background:#3296a4;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:700;font-size:13px;">
        ${orderState.showProtocol ? 'Hide Protocol' : 'Show Protocol'}
      </button>
    </div>
    <div id="order-protocol-panel" style="${orderState.showProtocol ? '' : 'display:none;'}margin-top:10px;">
      ${renderOrderProtocolPanel(linesWithSupply)}
    </div>`;
}

// 2026-04-27 (BUG #7): Vitalis-chat-style protocol panel.
function toggleProtocolPanel() {
  orderState.showProtocol = !orderState.showProtocol;
  renderSupplyPanel();
}

// Helper: find compound info from the global COMPOUND_DATA (loaded via compounds-data.js).
function _lookupCompoundInfo(productName) {
  if (typeof COMPOUND_DATA === 'undefined' || !Array.isArray(COMPOUND_DATA)) return null;
  const n = (productName || '').toLowerCase();
  // Try direct name match first
  let match = COMPOUND_DATA.find(c => c && (n.includes((c.name || '').toLowerCase()) || (c.name || '').toLowerCase().includes(n)));
  if (match) return match;
  // Fallback: try matching the first word
  const firstWord = n.split(/[\s\-]/)[0];
  if (firstWord) match = COMPOUND_DATA.find(c => c && ((c.name || '').toLowerCase().includes(firstWord) || (c.id || '').toLowerCase().includes(firstWord)));
  return match || null;
}

function renderOrderProtocolPanel(linesWithSupply) {
  if (!linesWithSupply || linesWithSupply.length === 0) return '<div style="color:var(--text-muted);font-size:12px;">No compounds selected.</div>';
  const compoundCards = linesWithSupply.map(line => {
    const ref = _lookupCompoundInfo(line.name);
    const fullName = ref ? (ref.full_name || ref.name) : line.name;
    const dose = line.doseNote || 'See dosing guide';
    let recon = 'Reconstitute per supplier instructions; refrigerate after mixing.';
    if (ref && ref.reconstitution) {
      recon = ref.reconstitution.plain_english || ref.reconstitution.steps || recon;
    }
    const timing = (ref && ref.dosing && ref.dosing.timing) ? ref.dosing.timing : (ref && ref.timing) || '—';
    const supplyLine = `Supply: ${line.qty}× = ${line.weeks.toFixed(1)} weeks at this dose. Monthly cost: $${line.monthlyCost.toFixed(0)}.`;
    return `
      <div class="protocol-compound-card" style="border:1px solid #e5e7eb;border-radius:6px;padding:10px 12px;margin-bottom:8px;background:#fff;">
        <div style="font-weight:700;font-size:13px;color:#111827;margin-bottom:4px;">${fullName}</div>
        <div style="font-size:12px;color:#374151;margin-bottom:3px;"><strong>Dose:</strong> ${dose}</div>
        <div style="font-size:12px;color:#374151;margin-bottom:3px;"><strong>Reconstitution:</strong> ${recon}</div>
        <div style="font-size:12px;color:#374151;margin-bottom:3px;"><strong>Timing:</strong> ${timing}</div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:4px;">${supplyLine}</div>
      </div>`;
  }).join('');

  // Synergy hints — hardcoded patterns for the most common stacks.
  const namesLower = linesWithSupply.map(x => x.name.toLowerCase()).join(' | ');
  const synergyNotes = [];
  if (namesLower.includes('bpc') && namesLower.includes('tb-500')) synergyNotes.push('BPC-157 + TB-500: complementary tissue-repair stack — BPC-157 is local/site-targeted, TB-500 systemic.');
  if (namesLower.includes('cjc') && namesLower.includes('ipa')) synergyNotes.push('CJC-1295 + Ipamorelin: classic GH stack — CJC drives the baseline GH ceiling, Ipamorelin produces the pulse. Inject same site, evening empty stomach.');
  if (namesLower.includes('mots') && namesLower.includes('ss-31')) synergyNotes.push('SS-31 + MOTS-C: pair on alternate days. SS-31 protects the membrane, MOTS-C drives biogenesis.');
  if (namesLower.includes('semax') && namesLower.includes('selank')) synergyNotes.push('Semax + Selank: focus + calm without sedation. Usual schedule: Semax morning, Selank afternoon/evening.');
  if (namesLower.includes('reta') || namesLower.includes('sema')) synergyNotes.push('GLP-1 (Reta/Sema): start at lowest dose; titrate upward weekly. Pair with Bacc Water + insulin syringes if vial format.');
  if (namesLower.includes('kpv') && (namesLower.includes('bpc') || namesLower.includes('histamine'))) synergyNotes.push('KPV: add this as your gut/histamine support — particularly useful if you flush or react with other peptides.');

  const synergyHtml = synergyNotes.length
    ? `<div style="background:#fffbeb;border-left:3px solid var(--gold);padding:8px 12px;font-size:12px;color:#92400e;margin-bottom:10px;">
         <strong>Stack synergy notes:</strong><ul style="margin:4px 0 0 16px;padding:0;">${synergyNotes.map(n => `<li style="margin-bottom:3px;">${n}</li>`).join('')}</ul>
       </div>`
    : '';

  const totalMonthly = linesWithSupply.reduce((s, x) => s + x.monthlyCost, 0);
  const totalCycle = linesWithSupply.reduce((s, x) => s + x.cycleTotal, 0);

  return `
    <div class="order-protocol-pane" style="border:1px solid #d1d5db;border-radius:8px;padding:12px;background:#fafafa;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:8px;">
        <div style="font-weight:800;font-size:14px;color:#111827;">Generated Protocol</div>
        <button onclick="printOrderProtocol()" style="padding:6px 14px;background:#0d9488;color:#fff;border:none;border-radius:4px;cursor:pointer;font-weight:700;font-size:12px;">Print Protocol</button>
      </div>
      <div style="font-size:11px;color:var(--text-muted);margin-bottom:8px;">For research purposes only. Not medical advice.</div>
      ${synergyHtml}
      ${compoundCards}
      <div style="display:flex;justify-content:space-between;padding:10px;background:#fff;border-top:2px solid #e5e7eb;border-radius:0 0 6px 6px;font-size:12px;font-weight:700;">
        <span>Cycle total: <span style="color:#22c55e;">$${totalCycle.toFixed(0)}</span></span>
        <span>Monthly cost: <span style="color:var(--gold);">$${totalMonthly.toFixed(0)}/mo</span></span>
      </div>
    </div>`;
}

// 2026-04-27 (BUG #7): print-friendly protocol output.
function printOrderProtocol() {
  if (orderLines.length === 0) return showToast('Add products first', 'error');
  const linesWithSupply = orderLines.map(l => {
    const sd = getSupplyData(l, l.doseLevel || 'mid');
    if (!sd) return null;
    const perVial = sd.perVial;
    const weeks = perVial * l.qty;
    const monthlyCost = perVial > 0 ? l.msrp / (perVial / 4.33) : 0;
    return { name: l.name, weeks, perVial, monthlyCost, cycleTotal: l.lineTotal, qty: l.qty, msrp: l.msrp, doseNote: sd.doseNote };
  }).filter(Boolean);
  const html = `<!doctype html><html><head><title>Protocol</title>
    <style>
      body{font-family:-apple-system,Helvetica,Arial,sans-serif;color:#111;padding:24px;max-width:800px;margin:0 auto;}
      h1{font-size:18px;margin:0 0 6px;}
      h2{font-size:14px;margin:18px 0 8px;border-bottom:1px solid #ccc;padding-bottom:4px;}
      .compound{border:1px solid #ccc;padding:10px;margin-bottom:8px;border-radius:4px;}
      .compound .name{font-weight:700;font-size:13px;margin-bottom:4px;}
      .compound .row{font-size:12px;margin-bottom:2px;}
      .totals{margin-top:14px;font-weight:700;font-size:13px;padding:8px;background:#f3f4f6;border-radius:4px;display:flex;justify-content:space-between;}
      .disclaimer{font-size:10px;color:#666;margin-top:18px;}
    </style></head><body>
    <h1>Peptide Protocol</h1>
    <div style="font-size:11px;color:#666;">${new Date().toLocaleDateString()}</div>
    <h2>Compounds</h2>
    ${linesWithSupply.map(x => {
      const ref = _lookupCompoundInfo(x.name);
      const fullName = ref ? (ref.full_name || ref.name) : x.name;
      let recon = 'Reconstitute per supplier instructions.';
      if (ref && ref.reconstitution) recon = ref.reconstitution.plain_english || ref.reconstitution.steps || recon;
      const timing = (ref && ref.dosing && ref.dosing.timing) ? ref.dosing.timing : '';
      return `<div class="compound">
        <div class="name">${fullName}</div>
        <div class="row"><strong>Dose:</strong> ${x.doseNote || '—'}</div>
        <div class="row"><strong>Reconstitution:</strong> ${recon}</div>
        ${timing ? `<div class="row"><strong>Timing:</strong> ${timing}</div>` : ''}
        <div class="row"><strong>Supply:</strong> ${x.qty}× / ${x.weeks.toFixed(1)} weeks · $${x.monthlyCost.toFixed(0)}/mo · $${x.cycleTotal.toFixed(0)} cycle</div>
      </div>`;
    }).join('')}
    <div class="totals">
      <span>Cycle total: $${linesWithSupply.reduce((s,x)=>s+x.cycleTotal,0).toFixed(0)}</span>
      <span>Monthly cost: $${linesWithSupply.reduce((s,x)=>s+x.monthlyCost,0).toFixed(0)}/mo</span>
    </div>
    <div class="disclaimer">For research purposes only. Not medical advice. Consult a physician before use.</div>
  </body></html>`;
  const w = window.open('', '_blank');
  if (!w) return showToast('Pop-up blocked — allow pop-ups to print protocol', 'error');
  w.document.write(html);
  w.document.close();
  setTimeout(() => { try { w.print(); } catch(e){} }, 300);
}

function getDiscountPct() {
  const sel = document.getElementById('discount-select');
  const customInput = document.getElementById('discount-custom');
  if (!sel) return 0;
  const val = sel.value;
  if (val === 'custom') {
    if (customInput) customInput.classList.remove('hidden');
    return Math.min(100, Math.max(0, parseFloat(customInput?.value) || 0));
  } else {
    if (customInput) customInput.classList.add('hidden');
    return parseFloat(val) || 0;
  }
}

function updateOrderTotals(subtotal) {
  const discountPct = getDiscountPct();
  // 2026-04-27 FIX (BUG #1): order-wide discount only applies to NON-exclusive lines.
  // Pens/sprays/KLOW are excluded from the discountable subtotal.
  const discountableSubtotal = orderLines.reduce((s, l) => s + (l.isExclusive ? 0 : l.lineTotal), 0);
  const exclusiveSubtotal = subtotal - discountableSubtotal;
  const discount = discountableSubtotal * (discountPct / 100);
  const total = subtotal - discount;
  const label = discountPct > 0
    ? (exclusiveSubtotal > 0 ? `${discountPct}% Off (excl. pens/sprays)` : `${discountPct}% Off`)
    : 'No Discount';
  const totalCost = orderLines.reduce((s,l) => s+((l.cost||0)*l.qty), 0);
  const netProfit = total - totalCost;
  const netMarginPct = total>0&&totalCost>0 ? (netProfit/total*100).toFixed(1) : null;
  document.getElementById('order-subtotal').textContent = `$${subtotal.toFixed(2)}`;
  document.getElementById('discount-label').textContent = label;
  document.getElementById('order-discount').textContent = `-$${discount.toFixed(2)}`;
  document.getElementById('order-total').textContent = `$${total.toFixed(2)}`;

  // Supply-aware summary additions
  // 2026-04-27 FIX (BUG #2/#3): pass full line object for mg-based scaling.
  const linesWithSupply = orderLines.map(l => {
    const sd = getSupplyData(l, l.doseLevel || 'mid');
    if (!sd) return null;
    return { weeks: sd.perVial * l.qty, lineTotal: l.lineTotal, msrp: l.msrp, perVial: sd.perVial };
  }).filter(Boolean);

  const summarySupplyEl = document.getElementById('order-supply-summary');
  if (summarySupplyEl) {
    if (linesWithSupply.length > 0) {
      const minWeeks = Math.min(...linesWithSupply.map(x=>x.weeks));
      // 2026-04-27 FIX (BUG #3 / #8): use PRD formula
      // monthlyCost = vialPrice / (weeksPerVial / 4.33). Sum across all peptides.
      const totalMonthly = linesWithSupply.reduce(
        (s,x) => s + (x.perVial > 0 ? x.msrp / (x.perVial / 4.33) : 0),
        0
      );
      summarySupplyEl.innerHTML = `
        <div class="summary-item">
          <span class="summary-label">Monthly Cost</span>
          <span class="summary-value" style="color:var(--gold)">~$${totalMonthly.toFixed(0)}/mo</span>
        </div>
        <div class="summary-item">
          <span class="summary-label">Protocol Duration</span>
          <span class="summary-value" style="color:var(--green)">${minWeeks.toFixed(1)} wks supply</span>
        </div>`;
      summarySupplyEl.classList.remove('hidden');
    } else {
      summarySupplyEl.classList.add('hidden');
    }
  }

  let marginEl = document.getElementById('order-margin-summary');
  if (!marginEl) {
    marginEl = document.createElement('div');
    marginEl.id = 'order-margin-summary';
    marginEl.className = 'margin-summary';
    document.getElementById('order-summary').appendChild(marginEl);
  }
  marginEl.innerHTML = totalCost>0 ? `
    <div class="margin-row"><span class="margin-label">Total Cost</span><span class="margin-value cost-value">$${totalCost.toFixed(2)}</span></div>
    <div class="margin-row"><span class="margin-label">Net Profit</span><span class="margin-value profit-value">$${netProfit.toFixed(2)}${netMarginPct?' ('+netMarginPct+'%)':''}</span></div>` : '';
}

function applyLineDiscount(index, pct) {
  const line = orderLines[index];
  if (!line) return;
  // 2026-04-27 FIX (BUG #1): exclusive items are never discountable.
  if (line.isExclusive) {
    line.discountPct = 0;
    line.discountedPrice = line.msrp;
    line.lineTotal = line.msrp * line.qty;
    renderOrderLines();
    showToast('Pens / sprays / KLOW are exclusive — no discount', 'info');
    return;
  }
  const discountPct = Math.min(parseFloat(pct) || 0, line.maxDiscountPct || 0);
  line.discountPct = discountPct;
  line.discountedPrice = line.msrp * (1 - discountPct / 100);
  line.lineTotal = line.discountedPrice * line.qty;
  line.lineCost = (line.cost||0) * line.qty;
  renderOrderLines();
  updateOrderTotals(getSubtotal());
}

// ─── Product Catalog ──────────────────────────────────────────
let catalogData = null;

async function loadCatalog() {
  if (catalogData) return renderCatalog();
  // Try live API first (local server), fall back to static snapshot
  try {
    const res = await fetch('/api/products-catalog');
    if (!res.ok) throw new Error('API unavailable');
    catalogData = await res.json();
  } catch {
    const res = await fetch('/catalog-data.json');
    catalogData = await res.json();
  }
  renderCatalog();
}

function renderCatalog() {
  renderCatalogSection('vials', catalogData.vials);
  renderCatalogSection('pens', catalogData.pens);
  renderCatalogSection('sprays', catalogData.sprays);  // 2026-04-27: spray BPC moved here
  renderCatalogSection('other', catalogData.other);
}

function renderCatalogSection(type, items) {
  const el = document.getElementById('catalog-' + type);
  if (!el) return;
  if (!items || items.length === 0) {
    el.innerHTML = '<div class="empty-state">No products in this category</div>';
    return;
  }
  const header = `
    <div class="catalog-header-row">
      <span>Product</span>
      <span>mg</span>
      <span>Price</span>
      <span>$/mg</span>
      <span>Margin</span>
      <span>Discount?</span>
    </div>`;
  // Pin KLOW to top, then sort by name
  const sorted = [...items].sort((a, b) => {
    const aK = (a.sku||'').includes('KLOW') || (a.displayName||'').toLowerCase().includes('klow');
    const bK = (b.sku||'').includes('KLOW') || (b.displayName||'').toLowerCase().includes('klow');
    if (aK && !bK) return -1;
    if (!aK && bK) return 1;
    return (a.displayName||'').localeCompare(b.displayName||'');
  });
  const rows = sorted.map(p => `
    <div class="catalog-row${(p.sku||'').includes('KLOW') ? ' klow-row' : ''}" style="${(p.sku||'').includes('KLOW') ? 'background:rgba(200,168,75,0.06);border-left:3px solid var(--gold)' : ''}">
      <span class="catalog-name">${p.displayName}${(p.sku||'').includes('KLOW') ? ' ⭐' : ''}</span>
      <span class="catalog-mg">${p.isBox10 && p.mg ? p.mg + 'mg × 10' : p.mg ? p.mg + 'mg' : '—'}</span>
      <span class="catalog-price">$${p.msrp.toLocaleString()}</span>
      <span class="catalog-cpm">${p.costPerMg ? '$' + p.costPerMg + '/mg' : '—'}</span>
      <span class="catalog-margin ${(p.margin||0) > 55 ? 'margin-high' : (p.margin||0) > 40 ? 'margin-mid' : 'margin-low'}">${p.margin !== null ? p.margin + '%' : '—'}</span>
      <span class="catalog-discount">${p.discountAllowed ? '✅ up to ' + p.maxDiscountPct + '%' : '🔒 Fixed'}</span>
    </div>`).join('');
  el.innerHTML = header + rows;
}

function switchCatalogTab(type, btn) {
  document.querySelectorAll('.catalog-section').forEach(s => s.style.display = 'none');
  document.querySelectorAll('.ctab').forEach(b => b.classList.remove('active'));
  document.getElementById('catalog-' + type).style.display = 'block';
  btn.classList.add('active');
}

async function printProtocolPack() {
  if (orderLines.length === 0) return showToast('Add products first', 'error');
  const clientId = document.getElementById('order-client').value;
  const client = clients.find(c => c.id === clientId);
  const smartData = (typeof SmartOrder !== 'undefined' && SmartOrder.getSnapshot) ? SmartOrder.getSnapshot() : null;
  showToast('Generating Protocol Pack…', 'info');
  try {
    const res = await fetch('/api/pdf/protocol-pack', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({
        clientName: client?.name || 'Research Client',
        clientEmail: client?.email || '',
        orderNumber: 'ORD-' + Date.now().toString().slice(-8),
        date: new Date().toISOString(),
        orderItems: orderLines.map(l => ({
          name: l.name, sku: l.sku, qty: l.qty, unitPrice: l.msrp,
          lineTotal: l.lineTotal, doseLevel: l.doseLevel
        })),
        cycleWeeks: smartData?.cycleWeeks || 12,
        doseLevel: smartData?.doseLevel || 'mid',
        timeline: smartData?.timeline || [],
        monthlyCost: smartData?.monthlyCost || null,
        coveredDomains: smartData?.coveredDomains || []
      })
    });
    if (!res.ok) throw new Error('PDF failed');
    const blob = await res.blob();
    window.open(URL.createObjectURL(blob), '_blank');
  } catch(e) { showToast('Error generating Protocol Pack', 'error'); }
}

function clearOrder() {
  orderLines = [];
  document.getElementById('order-client').selectedIndex = 0;
  renderOrderLines();
}

async function saveOrder() {
  const clientId = document.getElementById('order-client').value;
  if (!clientId) return showToast('Select a client', 'error');
  if (orderLines.length === 0) return showToast('Add at least one product', 'error');

  const subtotal = orderLines.reduce((s, l) => s + l.lineTotal, 0);
  const discountPct = getDiscountPct();
  const discount = subtotal * (discountPct / 100);
  const total = subtotal - discount;
  const client = clients.find(c => c.id === clientId);

  const smartData = (typeof SmartOrder !== 'undefined' && SmartOrder.getSnapshot) ? SmartOrder.getSnapshot() : null;
  const orderNumber = 'ORD-' + Date.now().toString().slice(-8);

  const payload = {
    // Both local Airtable + Windmill payload shapes
    clientId,
    clientName: client?.name || '',
    clientEmail: client?.email || '',
    clientPhone: client?.phone || '',
    client,
    orderNumber,
    lines: orderLines,
    subtotal,
    discount,
    discountPct,
    discountLabel: discountPct > 0 ? `${discountPct}% Off` : '',
    discountTier: discountPct > 0 ? `${discountPct}% Off` : 'No Discount',
    total,
    finalTotal: total,
    notes: document.getElementById('order-notes')?.value || '',
    cycleWeeks: smartData?.cycleWeeks || null,
    doseLevel: smartData?.doseLevel || null,
    timeline: smartData?.timeline || [],
    monthlyCost: smartData?.monthlyCost || null,
    coveredDomains: smartData?.coveredDomains || [],
    source: 'MyBioYouth POS'
  };

  showToast('Sending order…', 'info');

  // 1) Save to Airtable (local history)
  let airtableOk = false;
  try {
    const atRes = await fetch('/api/orders', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) });
    const atData = await atRes.json();
    airtableOk = !!atData.success;
  } catch (e) {
    console.warn('Airtable save failed:', e);
  }

  // 2) Submit to email backend (Netlify function → Windmill → email)
  //    Localhost uses the server's /api/submit-order proxy; Netlify deploy uses function directly
  const submitUrl = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
    ? '/api/submit-order'
    : '/.netlify/functions/submit-order';

  try {
    const res = await fetch(submitUrl, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      if (airtableOk) {
        showToast('Order saved locally — email backend failed', 'warning');
        clearOrder();
      } else {
        showToast('Order submission failed — email marc@cornerstoneregroup.ca', 'error');
      }
      return;
    }

    const data = await res.json();
    if (data.success) {
      showToast(`Order ${data.orderId || orderNumber} submitted — email sent to Marc`, 'success');
      clearOrder();
    } else {
      showToast('Order submission failed — ' + (data.error || 'unknown error'), 'error');
    }
  } catch (e) {
    console.error('submit-order error:', e);
    if (airtableOk) {
      showToast('Order saved, email failed — email Marc directly', 'warning');
      clearOrder();
    } else {
      showToast('Error submitting order — email marc@cornerstoneregroup.ca', 'error');
    }
  }
}

async function printOrderPDF() {
  const clientId = document.getElementById('order-client').value;
  if (!clientId || orderLines.length === 0) return showToast('Complete the order first', 'error');
  const client = clients.find(c => c.id === clientId);
  const subtotal = orderLines.reduce((s, l) => s + (l.lineTotal || (l.msrp * l.qty)), 0);

  // Manual discount from dropdown (matches order summary UI)
  const discountPct = getDiscountPct ? getDiscountPct() / 100 : 0;
  const discount = subtotal * discountPct;
  const total = subtotal - discount;

  // Pull smart-order protocol data (if smart mode enabled)
  const smartData = (typeof SmartOrder !== 'undefined' && SmartOrder.getSnapshot) ? SmartOrder.getSnapshot() : null;

  showToast('Generating Invoice PDF…', 'info');

  const payload = {
    orderNumber: 'INV-' + Date.now().toString().slice(-8),
    client,
    clientName: client?.name || 'Research Client',
    lines: orderLines,
    items: orderLines,
    subtotal,
    discount,
    discountPct: discountPct * 100,
    discountLabel: discountPct > 0 ? `${(discountPct*100).toFixed(0)}% Off` : '',
    total,
    finalTotal: total,
    notes: document.getElementById('order-notes')?.value || '',
    date: new Date().toISOString(),
    cycleWeeks: smartData?.cycleWeeks || null,
    doseLevel: smartData?.doseLevel || null,
    timeline: smartData?.timeline || null,
    monthlyCost: smartData?.monthlyCost || null
  };

  try {
    const res = await fetch('/api/pdf/order', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error('PDF failed');
    const blob = await res.blob();
    window.open(URL.createObjectURL(blob), '_blank');
  } catch (e) {
    showToast('Error generating invoice PDF', 'error');
  }
}

// ─── Protocol Generator ──────────────────────────────────────
async function generateProtocol() {
  const goals = Array.from(document.querySelectorAll('.checkbox-grid input:checked')).map(c => c.value);
  if (goals.length === 0) return showToast('Select at least one research goal', 'error');

  const btn = document.querySelector('#page-protocol .btn-primary.full-width');
  btn.textContent = '⏳ Generating...';
  btn.disabled = true;

  const payload = {
    goals,
    healthFlags: document.getElementById('protocol-flags').value,
    currentStack: document.getElementById('protocol-current').value,
    budget: document.getElementById('protocol-budget').value,
    timeline: document.getElementById('protocol-timeline').value
  };

  try {
    const res = await fetch('/api/generate-protocol', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) });
    const data = await res.json();
    currentProtocol = data;
    renderProtocol(data);
  } catch(e) {
    showToast('Error generating protocol', 'error');
  } finally {
    btn.textContent = '🔬 Generate Protocol';
    btn.disabled = false;
  }
}

function renderProtocol(p) {
  document.getElementById('protocol-result').classList.remove('hidden');

  document.getElementById('protocol-compounds').innerHTML = `
    <h3>Recommended Compounds</h3>
    <table class="order-table">
      <thead><tr><th>Compound</th><th>Dose</th><th>Frequency</th><th>Timing</th><th>Duration</th><th>Rationale</th></tr></thead>
      <tbody>
        ${(p.recommended_compounds || []).map(c => `
          <tr>
            <td><strong>${c.name}</strong></td>
            <td>${c.dose_mg}</td>
            <td>${c.frequency}</td>
            <td>${c.timing}</td>
            <td>${c.duration}</td>
            <td class="rationale-cell">${c.rationale}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;

  document.getElementById('protocol-synergies').innerHTML = `<h3>Stack Synergies</h3><p>${p.stack_synergies || '—'}</p>`;
  document.getElementById('protocol-bloodwork').innerHTML = `<h3>Bloodwork Schedule</h3><ul>${(p.bloodwork_schedule||[]).map(b=>`<li>${b}</li>`).join('')}</ul>`;
  document.getElementById('protocol-notes').innerHTML = `<h3>Research Notes</h3><p>${p.research_notes || '—'}</p><div class="disclaimer-banner">⚠️ ${p.disclaimer}</div>`;

  document.getElementById('protocol-result').scrollIntoView({behavior: 'smooth'});
}

async function saveProtocol() {
  if (!currentProtocol) return showToast('Generate a protocol first', 'error');
  const clientId = document.getElementById('protocol-client').value;
  if (!clientId) return showToast('Select a client', 'error');
  const client = clients.find(c => c.id === clientId);
  const goals = Array.from(document.querySelectorAll('.checkbox-grid input:checked')).map(c => c.value);

  const res = await fetch('/api/protocols', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ clientId, clientName: client?.name, goals, protocol: currentProtocol, timeline: document.getElementById('protocol-timeline').value })
  });
  const data = await res.json();
  if (data.success) showToast('Protocol saved!', 'success');
  else showToast('Error saving protocol', 'error');
}

function addProtocolToOrder() {
  if (!currentProtocol) return showToast('Generate a protocol first', 'error');
  showPage('order');
  // Match compounds to products and pre-populate
  currentProtocol.recommended_compounds.forEach(compound => {
    const match = products.find(p => p.name.toLowerCase().includes(compound.name.toLowerCase().split(' ')[0]) && p.msrp > 0);
    if (match) {
      orderLines.push({ id: match.id, name: match.name, sku: match.sku, msrp: match.msrp, qty: 1, lineTotal: match.msrp });
    }
  });
  renderOrderLines();
  showToast(`Added ${orderLines.length} products from protocol`, 'success');
}

async function printProtocolPDF() {
  if (!currentProtocol) return showToast('Generate a protocol first', 'error');
  const clientId = document.getElementById('protocol-client').value;
  const client = clients.find(c => c.id === clientId);
  const goals = Array.from(document.querySelectorAll('.checkbox-grid input:checked')).map(c => c.value);

  const res = await fetch('/api/pdf/protocol', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ client, goals, protocol: currentProtocol, timeline: document.getElementById('protocol-timeline').value })
  });
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
}

// ─── Clients ────────────────────────────────────────────────
async function loadClients() {
  const res = await fetch('/api/clients');
  const data = await res.json();
  clients = data.clients || [];
  const container = document.getElementById('clients-list');
  if (clients.length === 0) {
    container.innerHTML = '<div class="empty-state">No clients yet — add your first client</div>';
    return;
  }
  container.innerHTML = clients.map(c => `
    <div class="list-item" onclick="openClientDetail('${c.id}', '${c.name.replace(/'/g,"\\'")}')">
      <div class="list-item-main">
        <span class="item-title">${c.name} ${c.type === 'VIP' ? '⭐' : ''}</span>
        <span class="item-sub">${c.phone || 'No phone'} · ${c.source || ''}</span>
      </div>
      <div class="list-item-right">
        <span class="badge">${c.type || 'Standard'}</span>
        <span style="font-size:11px;color:var(--muted);margin-left:8px">›</span>
      </div>
    </div>`).join('');
}

// Cache the original "New Client" modal HTML so it can be restored after
// openClientDetail() replaces innerHTML for the client-detail view.
let _newClientModalTemplate = null;

async function openClientDetail(clientId, clientName) {
  // Cache the new-client form template the first time we overwrite the modal
  const modalEl = document.getElementById('modal-client');
  if (modalEl && _newClientModalTemplate === null) {
    _newClientModalTemplate = modalEl.innerHTML;
  }

  // Fetch client detail
  const res = await fetch(`/api/clients/${clientId}`);
  const data = await res.json();
  const client = data.client || {};
  const orders = data.orders || [];
  const protocols = data.protocols || [];

  const orderRows = orders.length
    ? orders.map(o => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);font-size:12px;">
          <span>${o.orderNumber || 'Order'} · ${o.date || ''}</span>
          <span style="font-weight:700;color:var(--green)">$${(o.total||0).toFixed(2)}</span>
        </div>`).join('')
    : '<div style="color:var(--muted);font-size:12px;padding:8px 0">No orders yet</div>';

  document.getElementById('modal-client').innerHTML = `
    <div class="modal-box">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <h3 style="margin:0">${clientName} ${client.type==='VIP'?'⭐':''}</h3>
        <button onclick="closeModal()" style="background:none;border:none;color:var(--muted);font-size:18px;cursor:pointer">✕</button>
      </div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:16px">
        ${client.phone||'No phone'} · ${client.source||''} · ${client.type||'Standard'}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:20px">
        <div style="background:var(--card2);border-radius:8px;padding:12px;text-align:center">
          <div style="font-size:20px;font-weight:800;color:var(--green)">${orders.length}</div>
          <div style="font-size:10px;color:var(--muted)">Orders</div>
        </div>
        <div style="background:var(--card2);border-radius:8px;padding:12px;text-align:center">
          <div style="font-size:20px;font-weight:800;color:var(--gold)">$${orders.reduce((s,o)=>s+(o.total||0),0).toFixed(0)}</div>
          <div style="font-size:10px;color:var(--muted)">Total Spent</div>
        </div>
        <div style="background:var(--card2);border-radius:8px;padding:12px;text-align:center">
          <div style="font-size:20px;font-weight:800;color:var(--blue)">${protocols.length}</div>
          <div style="font-size:10px;color:var(--muted)">Protocols</div>
        </div>
      </div>
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--muted);margin-bottom:8px">Order History</div>
      ${orderRows}
      <div style="display:flex;gap:8px;margin-top:16px">
        <button class="btn-g" onclick="closeModal();showPage('order')" style="flex:1;font-size:12px">🛒 New Order</button>
        <button class="btn-sm" onclick="closeModal()" style="flex:1;font-size:12px">Close</button>
      </div>
    </div>`;
  document.getElementById('modal-client').classList.remove('hidden');
}

async function createClient() {
  const name = document.getElementById('new-client-name').value.trim();
  if (!name) return showToast('Name is required', 'error');

  const payload = {
    name,
    phone: document.getElementById('new-client-phone').value,
    source: document.getElementById('new-client-source').value,
    type: document.getElementById('new-client-type').value,
    notes: document.getElementById('new-client-notes').value
  };

  const res = await fetch('/api/clients', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) });
  const data = await res.json();
  if (data.success) {
    showToast('Client created!', 'success');
    closeModal();
    await loadClientsData();
    loadClients();
  } else {
    showToast('Error creating client', 'error');
  }
}

// ─── Order History ───────────────────────────────────────────
async function loadOrders() {
  const res = await fetch('/api/orders');
  const data = await res.json();
  allOrders = data.orders || [];
  renderOrdersList(allOrders);
}

function renderOrdersList(orders) {
  const container = document.getElementById('orders-list');
  // Filter out blank/test orders
  const clean = orders.filter(o => o.clientName || o.total > 0);
  if (clean.length === 0) {
    container.innerHTML = '<div class="empty-state">No orders found</div>';
    return;
  }
  container.innerHTML = clean.map(o => `
    <div class="list-item" onclick="toggleOrderDetail(this, '${o.id}')" style="cursor:pointer">
      <div class="list-item-main">
        <span class="item-title">${o.clientName || 'Unknown'}</span>
        <span class="item-sub">${o.orderNumber || ''} · ${o.date || ''}</span>
      </div>
      <div class="list-item-right">
        <span class="badge badge-${(o.fulfillmentStatus||'').toLowerCase().replace(' ','-')}">${o.fulfillmentStatus || 'Processing'}</span>
        <span class="item-price">$${(o.total || 0).toFixed(2)}</span>
      </div>
      <div class="order-detail-row" style="display:none;width:100%;padding:8px 0 0;font-size:12px;color:var(--muted)">
        <em>Loading order details...</em>
      </div>
    </div>`).join('');
}

async function toggleOrderDetail(el, orderId) {
  const detailRow = el.querySelector('.order-detail-row');
  if (!detailRow) return;
  const isOpen = detailRow.style.display !== 'none';
  if (isOpen) { detailRow.style.display = 'none'; return; }
  detailRow.style.display = 'block';
  try {
    const res = await fetch(`/api/orders/${orderId}`);
    const data = await res.json();
    const order = data.order || data;
    const items = order.orderItems || order.items || [];
    if (items.length) {
      detailRow.innerHTML = items.map(i =>
        `<div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid var(--border)">
          <span>💉 ${i.name || i.sku}</span>
          <span>×${i.qty} · $${((i.unitPrice||i.price||0)*i.qty).toFixed(2)}</span>
        </div>`).join('');
    } else {
      detailRow.innerHTML = '<em>No line items on record</em>';
    }
  } catch(e) {
    detailRow.innerHTML = '<em>Could not load details</em>';
  }
}

function filterOrders(status, btn) {
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  if (status === 'all') renderOrdersList(allOrders);
  else renderOrdersList(allOrders.filter(o => o.fulfillmentStatus === status));
}

// ─── Modal ────────────────────────────────────────────────
function showNewClientModal() {
  // Restore the new-client form template if it was overwritten by a client detail view
  const modalEl = document.getElementById('modal-client');
  if (modalEl && _newClientModalTemplate !== null && !document.getElementById('new-client-name')) {
    modalEl.innerHTML = _newClientModalTemplate;
  }
  document.getElementById('modal-client').classList.remove('hidden');
  document.getElementById('modal-overlay').classList.remove('hidden');
}

function closeModal() {
  document.getElementById('modal-client').classList.add('hidden');
  document.getElementById('modal-overlay').classList.add('hidden');
  closeProtocolModal();
}

// ─── Compounds Library ───────────────────────────────────────
let activeCompoundCategory = 'all';
let compoundSearchTerm = '';

async function initCompounds() {
  await loadProtocolLibrary();
  renderProtocolCards();
  renderCompoundGrid();
}

function filterCompounds() {
  compoundSearchTerm = document.getElementById('compound-search').value.toLowerCase();
  renderCompoundGrid();
}

function filterByCategory(cat, btn) {
  activeCompoundCategory = cat;
  document.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  renderCompoundGrid();
}

function renderCompoundGrid() {
  const grid = document.getElementById('compound-grid');
  const allData = typeof COMPOUND_DATA !== 'undefined' ? COMPOUND_DATA : [];
  let filtered = allData;
  if (activeCompoundCategory !== 'all') filtered = filtered.filter(c => c.category === activeCompoundCategory);
  if (compoundSearchTerm) filtered = filtered.filter(c => c.name.toLowerCase().includes(compoundSearchTerm) || (c.benefits||[]).some(b => b.toLowerCase().includes(compoundSearchTerm)));
  if (filtered.length === 0) { grid.innerHTML = '<div class="empty-state">No compounds found</div>'; return; }
  grid.innerHTML = filtered.map(c => `
    <div class="compound-card" onclick="openCompound('${c.id}')">
      <div class="compound-card-header">
        <div class="compound-card-cat">${c.categoryLabel||''}</div>
        <div class="confidence-dot confidence-${(c.confidence||'MEDIUM').toLowerCase()}"></div>
      </div>
      <h3 class="compound-card-name">${c.name}</h3>
      <p class="compound-card-fullname">${c.fullName||''}</p>
      <div class="compound-card-benefits">${(c.benefits||[]).slice(0,3).map(b=>`<span class="benefit-chip">${b}</span>`).join('')}</div>
      <div class="compound-card-dose"><span>💉 ${c.typicalDose||''}</span><span>📅 ${c.frequency||''}</span></div>
    </div>`).join('');
}

function openCompound(id) {
  const allData = typeof COMPOUND_DATA !== 'undefined' ? COMPOUND_DATA : [];
  let c = allData.find(x => x.id === id);
  // If not found by compound ID, try matching by product ID from order lines
  if (!c) {
    const product = products.find(p => p.id === id);
    if (product) {
      // Try to find compound by product name
      c = allData.find(x => product.name.toLowerCase().includes(x.name.toLowerCase()) || x.name.toLowerCase().includes(product.name.toLowerCase().split(' ').slice(1).join(' ')));
      // If still not found, build a compound card from product data
      if (!c) {
        showProductDetailFallback(product);
        return;
      }
    }
  }
  if (!c) return;
  document.getElementById('cmpd-name').textContent = c.name;
  document.getElementById('cmpd-category-badge').textContent = c.categoryLabel||'';
  document.getElementById('cmpd-description').textContent = c.description||'';
  document.getElementById('cmpd-mechanism').textContent = c.mechanism||'';
  document.getElementById('cmpd-delivery').textContent = c.delivery==='vial'?'💉 Vial + BAC Water + Insulin Syringe':'🖊 Peptide Pen (pre-loaded)';
  document.getElementById('cmpd-storage').textContent = c.storage||'';
  document.getElementById('cmpd-confidence').innerHTML = {HIGH:'<span style="color:#22c55e">● HIGH</span>',MEDIUM:'<span style="color:#f59e0b">● MEDIUM</span>',LOW:'<span style="color:#ef4444">● LOW</span>'}[c.confidence]||c.confidence||'';
  document.getElementById('cmpd-benefits').innerHTML = (c.benefits||[]).map(b=>`<span class="benefit-pill">${b}</span>`).join('');
  const r = c.reconstitution||{};
  document.getElementById('cmpd-recon-bac').textContent = `Add ${r.bac_ml||2}mL BAC water to your ${r.vial_mg||5}mg vial. Swirl gently.`;
  document.getElementById('cmpd-recon-conc').textContent = `${r.concentration_mg_ml||2.5}mg/mL = ${(r.concentration_mcg_ml||2500).toLocaleString()}mcg per mL`;
  document.getElementById('cmpd-recon-draw').textContent = r.plain_english||'';
  const rows = (r.doses||[]).map(d=>`<div class="syringe-row"><div class="syringe-cell label">${d.label||((d.mcg||0).toLocaleString()+'mcg')}</div><div class="syringe-cell">${d.ml}mL</div><div class="syringe-cell highlight">Draw to <strong>${d.units} units</strong></div></div>`).join('');
  document.getElementById('cmpd-syringe-table').innerHTML = `<div class="syringe-header"><div class="syringe-cell label">Dose</div><div class="syringe-cell">Volume</div><div class="syringe-cell">Syringe (100-unit)</div></div>${rows}`;
  document.getElementById('cmpd-dosing-schedule').innerHTML = `<h4>📅 Protocol</h4><div class="protocol-meta"><div><strong>Dose:</strong> ${c.typicalDose||''}</div><div><strong>Frequency:</strong> ${c.frequency||''}</div><div><strong>Duration:</strong> ${c.duration||'8–12 weeks'}</div></div>`;
  const seHtml = (c.sideEffects||[]).map(se=>`<div class="side-effect-item severity-${(se.severity||'mild').replace(/[^a-z]/g,'')}"><div class="se-name">${se.name}</div><div class="se-notes">${se.notes||''}</div></div>`).join('');
  document.getElementById('cmpd-side-effects-content').innerHTML = seHtml?`<h3>Side Effects</h3>${seHtml}`:'';
  document.getElementById('cmpd-flags').innerHTML = (c.flags||[]).length?`<div class="flags-block"><h4>⚠️ Flags</h4><ul>${c.flags.map(f=>`<li>${f}</li>`).join('')}</ul></div>`:'';
  document.getElementById('cmpd-custom-faq').innerHTML = (c.faq||[]).map(f=>`<div class="faq-item"><div class="faq-q" onclick="toggleFaq(this)">${f.q} ▾</div><div class="faq-a hidden">${f.a}</div></div>`).join('');
  document.getElementById('cmpd-research-content').innerHTML = (c.research||[]).map(r=>`<div class="research-item"><div class="research-title">${r.title}</div><div class="research-source">📄 ${r.source}</div><div class="research-note">${r.note||''}</div></div>`).join('')||'<p>References being compiled.</p>';
  showCompoundTab('overview', document.querySelector('.ctab'));
  document.getElementById('modal-compound').classList.remove('hidden');
  document.getElementById('modal-overlay').classList.remove('hidden');
}

// Fallback detail view for products not in compound library
function showProductDetailFallback(p) {
  const desc = p.description || '';
  // Extract dosing from description
  const doseMatch = desc.match(/[Tt]ypical dose[:\s]+([^.\n]+)/);
  const freqMatch = desc.match(/[Ff]requency[:\s]+([^.\n]+)/);
  const reconMatch = desc.match(/[Aa]dd ([^.]+(?:BAC|water)[^.]+)\./i);
  const html = `
    <div style="padding:20px">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
        <div style="font-size:32px">💊</div>
        <div><h2 style="font-size:20px;font-weight:800">${p.name}</h2><div style="font-size:12px;color:var(--text-muted)">${p.sku} &middot; ${p.category}</div></div>
        <div style="margin-left:auto;text-align:right"><div style="font-size:22px;font-weight:900;color:var(--green)">$${p.msrp}</div><div style="font-size:11px;color:var(--text-muted)">MSRP</div></div>
      </div>
      ${doseMatch ? `<div style="background:rgba(62,207,142,.07);border-radius:8px;padding:12px;margin-bottom:12px"><div style="font-size:11px;font-weight:700;color:var(--muted2);margin-bottom:4px">TYPICAL DOSE</div><div style="font-size:13px;font-weight:600">${doseMatch[1]}</div></div>` : ''}
      ${freqMatch ? `<div style="background:rgba(59,130,246,.07);border-radius:8px;padding:12px;margin-bottom:12px"><div style="font-size:11px;font-weight:700;color:var(--muted2);margin-bottom:4px">FREQUENCY</div><div style="font-size:13px;font-weight:600">${freqMatch[1]}</div></div>` : ''}
      ${reconMatch ? `<div style="background:rgba(200,168,75,.07);border-radius:8px;padding:12px;margin-bottom:12px"><div style="font-size:11px;font-weight:700;color:var(--muted2);margin-bottom:4px">RECONSTITUTION</div><div style="font-size:13px;font-weight:600">${reconMatch[1]}</div></div>` : ''}
      ${desc ? `<div style="margin-top:12px"><div style="font-size:11px;font-weight:700;color:var(--muted2);margin-bottom:6px">FULL DESCRIPTION</div><div style="font-size:13px;line-height:1.7;color:var(--text)">${desc}</div></div>` : ''}
    </div>`;
  // Inject into compound modal
  document.getElementById('cmpd-name').textContent = p.name;
  document.getElementById('cmpd-category-badge').textContent = p.category || '';
  document.getElementById('cmpd-description').textContent = desc.split('.')[0] || p.name;
  document.getElementById('cmpd-mechanism').textContent = '';
  document.getElementById('cmpd-delivery').textContent = p.name.toLowerCase().includes('pen') ? '🖊 Peptide Pen (pre-loaded, no reconstitution)' : '💉 Vial + BAC Water + Insulin Syringe';
  document.getElementById('cmpd-storage').textContent = 'Refrigerate after opening. Keep away from light.';
  document.getElementById('cmpd-confidence').innerHTML = '<span style="color:#f59e0b">● PRODUCT</span>';
  document.getElementById('cmpd-benefits').innerHTML = '';
  // Recon section - parse from description
  document.getElementById('cmpd-recon-bac').textContent = reconMatch ? reconMatch[0].replace('.','') : 'See description for reconstitution instructions.';
  document.getElementById('cmpd-recon-conc').textContent = doseMatch ? 'Dose: ' + doseMatch[1] : '';
  document.getElementById('cmpd-recon-draw').textContent = freqMatch ? 'Frequency: ' + freqMatch[1] : '';
  document.getElementById('cmpd-syringe-table').innerHTML = '';
  document.getElementById('cmpd-dosing-schedule').innerHTML = `<div style="padding:12px;background:var(--surface);border-radius:8px">${desc.replace(/\n/g,'<br>')}</div>`;
  document.getElementById('cmpd-side-effects-content').innerHTML = '';
  document.getElementById('cmpd-flags').innerHTML = '';
  document.getElementById('cmpd-custom-faq').innerHTML = '';
  document.getElementById('cmpd-research-content').innerHTML = '<p>Research data for this compound is being compiled.</p>';
  showCompoundTab('overview', document.querySelector('.ctab'));
  document.getElementById('modal-compound').classList.remove('hidden');
  document.getElementById('modal-overlay').classList.remove('hidden');
}

function showCompoundTab(tab, btn) {
  document.querySelectorAll('.ctab-content').forEach(el => el.classList.add('hidden'));
  document.querySelectorAll('.ctab').forEach(el => el.classList.remove('active'));
  document.getElementById('ctab-'+tab).classList.remove('hidden');
  if (btn) btn.classList.add('active');
}

function closeCompoundModal() {
  document.getElementById('modal-compound').classList.add('hidden');
  document.getElementById('modal-overlay').classList.add('hidden');
}

function toggleFaq(el) {
  const answer = el.nextElementSibling;
  const isOpen = !answer.classList.contains('hidden');
  answer.classList.toggle('hidden', isOpen);
  el.textContent = el.textContent.replace(isOpen?'▴':'▾', isOpen?'▾':'▴');
}

// ─── Toast ────────────────────────────────────────────────
function showToast(msg, type = 'info') {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = `toast toast-${type}`;
  setTimeout(() => toast.classList.add('hidden'), 3000);
}

// ═══════════════════════════════════════════════════════════
// DIET PLAN GENERATOR
// ═══════════════════════════════════════════════════════════

async function generateDietPlan() {
  const clientName = document.getElementById('diet-client-name').value || 'Client';
  const bodyWeight = document.getElementById('diet-bodyweight').value;
  const goal = document.getElementById('diet-goal').value;
  const activityLevel = document.getElementById('diet-activity').value;
  const stack = document.getElementById('diet-stack').value;
  const timeline = document.getElementById('diet-timeline').value;

  if (!bodyWeight) return showToast('Please enter body weight', 'error');

  const btn = document.querySelector('#page-diet .btn-primary.full-width');
  btn.textContent = '⏳ Generating plan...';
  btn.disabled = true;

  try {
    const res = await fetch('/api/generate-diet-plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientName, bodyWeight, goal, activityLevel, stack, timeline })
    });
    const plan = await res.json();
    if (plan.error) throw new Error(plan.error);
    renderDietPlan(plan);
  } catch (e) {
    showToast('Error generating diet plan: ' + e.message, 'error');
  } finally {
    btn.textContent = '🥗 Generate Diet Plan';
    btn.disabled = false;
  }
}

function renderDietPlan(plan) {
  document.getElementById('diet-result').classList.remove('hidden');

  // Macro cards
  document.getElementById('diet-macro-cards').innerHTML = `
    <div class="macro-card calories">
      <div class="macro-icon">🔥</div>
      <div class="macro-number">${plan.dailyCalories || '—'}</div>
      <div class="macro-label">Daily Calories</div>
    </div>
    <div class="macro-card protein">
      <div class="macro-icon">💪</div>
      <div class="macro-number">${plan.protein_g || '—'}g</div>
      <div class="macro-label">Protein</div>
    </div>
    <div class="macro-card carbs">
      <div class="macro-icon">⚡</div>
      <div class="macro-number">${plan.carbs_g || '—'}g</div>
      <div class="macro-label">Carbs</div>
    </div>
    <div class="macro-card fat">
      <div class="macro-icon">🥑</div>
      <div class="macro-number">${plan.fat_g || '—'}g</div>
      <div class="macro-label">Fat</div>
    </div>`;

  // Meal timing
  document.getElementById('diet-meal-timing').textContent = plan.mealTiming || '—';

  // Peptide synergies
  document.getElementById('diet-peptide-synergies').textContent = plan.peptideSynergies || '—';

  // 3-day sample plan
  const daysEl = document.getElementById('diet-sample-days');
  const days = plan.sampleDays || [];
  daysEl.innerHTML = days.map(day => `
    <div class="diet-day-card">
      <div class="diet-day-header">
        <h3>${day.day}</h3>
        <div class="diet-day-totals">
          <span class="day-cal">${day.totalCalories || 0} kcal</span>
          <span class="day-protein">${day.totalProtein_g || 0}g protein</span>
        </div>
      </div>
      <div class="diet-meals-list">
        ${(day.meals || []).map(meal => `
          <div class="diet-meal-row">
            <div class="meal-time">${meal.time}</div>
            <div class="meal-info">
              <div class="meal-name">${meal.name}</div>
              <div class="meal-foods">${meal.foods}</div>
            </div>
            <div class="meal-macros">
              <span class="meal-cal">${meal.calories || 0} kcal</span>
              <span class="meal-prot">${meal.protein_g || 0}g P</span>
            </div>
          </div>`).join('')}
      </div>
    </div>`).join('');

  // Disclaimer
  document.getElementById('diet-disclaimer').textContent = plan.disclaimer || 'For research purposes only. Not medical or dietary advice.';

  document.getElementById('diet-result').scrollIntoView({ behavior: 'smooth' });
}

// ═══════════════════════════════════════════════════════════
// RENEWAL ALERTS (Dashboard)
// ═══════════════════════════════════════════════════════════

async function loadRenewalAlerts() {
  try {
    const res = await fetch('/api/renewals');
    const data = await res.json();
    const container = document.getElementById('renewal-alerts');
    const renewals = data.renewals || [];

    if (renewals.length === 0) {
      container.innerHTML = '<div class="empty-state renewal-empty">No renewals due — all clients are stocked up ✅</div>';
      return;
    }

    const urgencyConfig = {
      LIKELY_OUT:  { label: 'LIKELY OUT',  color: '#ef4444', bg: 'rgba(239,68,68,0.12)' },
      RUNNING_LOW: { label: 'RUNNING LOW', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
      FOLLOW_UP:   { label: 'FOLLOW UP',   color: '#3ecf8e', bg: 'rgba(62,207,142,0.12)' }
    };

    container.innerHTML = renewals.map(r => {
      const cfg = urgencyConfig[r.urgency] || urgencyConfig.FOLLOW_UP;
      return `
        <div class="renewal-row" style="border-left: 3px solid ${cfg.color}; background: ${cfg.bg}">
          <div class="renewal-client">
            <div class="renewal-name">${r.clientName}</div>
            <div class="renewal-meta">${r.daysSince} days since order · Last: ${r.orderDate}</div>
          </div>
          <div class="renewal-center">
            <span class="renewal-badge" style="background:${cfg.color};color:#020d06">${cfg.label}</span>
          </div>
          <div class="renewal-actions">
            <button class="btn-call" onclick="callClient('${r.clientName}', '${r.urgency}')">📞 Call</button>
            <button class="btn-reorder" onclick="quickReorder('${r.clientName}')">🛒 Re-order</button>
          </div>
        </div>`;
    }).join('');
  } catch (e) {
    document.getElementById('renewal-alerts').innerHTML = '<div class="empty-state">Unable to load renewals</div>';
  }
}

function callClient(name, urgency) {
  const messages = {
    LIKELY_OUT: `Hey ${name}, it's Marc! Just checking in — you're likely running out of your research compounds. Ready to reorder?`,
    RUNNING_LOW: `Hi ${name}, Marc here! Your supply is running low. Want me to get your next order ready?`,
    FOLLOW_UP: `Hey ${name}, Marc here! Just following up on your research protocol. How are you feeling? Ready for your next round?`
  };
  showToast(`📞 Calling ${name}...`, 'info');
  alert(`Call Script for ${name}:\n\n"${messages[urgency] || messages.FOLLOW_UP}"`);
}

function quickReorder(clientName) {
  showPage('order');
  const clientSel = document.getElementById('order-client');
  const options = Array.from(clientSel.options);
  const match = options.find(o => o.textContent.toLowerCase().includes(clientName.toLowerCase()));
  if (match) {
    clientSel.value = match.value;
    showToast(`Client set to ${clientName}`, 'info');
  }
}

// ═══════════════════════════════════════════════════════════
// QUICK STACKS (Dashboard)
// ═══════════════════════════════════════════════════════════

const QUICK_STACKS = {
  wolverine:  { name: 'Wolverine Stack',     keywords: ['BPC-157', 'TB-500', 'GHK-Cu', 'KPV'] },
  hollywood:  { name: 'Hollywood Shred',     keywords: ['AOD', 'Retatrutide', 'MOTS'] },
  longevity:  { name: 'Longevity Protocol',  keywords: ['Epitalon', 'Pinealon', 'MOTS'] },
  libido:     { name: 'Libido Lift',         keywords: ['PT-141', 'Kisspeptin'] },
  goddess:    { name: 'Goddess Protocol',    keywords: ['Epitalon', 'MOTS', 'Pinealon'] },
  metabolic:  { name: 'Metabolic Reset',     keywords: ['Tesamorelin', 'MOTS'] },
};

async function quickOrderStack(stackKey) {
  const stack = QUICK_STACKS[stackKey];
  if (!stack) return;

  // Ensure products are loaded
  if (products.length === 0) await loadProducts();

  showPage('order');
  await new Promise(r => setTimeout(r, 300));

  let added = 0;
  stack.keywords.forEach(kw => {
    const kwLower = kw.toLowerCase();
    // Find best matching product (prefer pens for convenience)
    const matches = products.filter(p =>
      p.name.toLowerCase().includes(kwLower) && p.msrp > 0
    ).sort((a, b) => {
      // Prefer vials over pens (pens are discontinued / higher cost per mg)
      const aIsPen = a.name.toLowerCase().startsWith('pen ');
      const bIsPen = b.name.toLowerCase().startsWith('pen ');
      if (aIsPen && !bIsPen) return 1;
      if (!aIsPen && bIsPen) return -1;
      return 0;
    });
    if (matches[0] && !orderLines.find(l => l.id === matches[0].id)) {
      const m = matches[0];
      const exclusive = isExclusiveItem(m);
      orderLines.push({
        id: m.id, name: m.name, sku: m.sku,
        msrp: m.msrp, cost: m.cost || 0,
        margin: m.margin || 0, profit: m.profit || 0,
        qty: 1, lineTotal: m.msrp, lineCost: m.cost || 0,
        discountAllowed: exclusive ? false : (m.discountAllowed || false),
        maxDiscountPct: exclusive ? 0 : (m.maxDiscountPct || 0),
        discountPct: 0, discountedPrice: m.msrp,
        mg: m.mg || null, totalMg: m.totalMg || null, mgLabel: m.mgLabel || null,
        category: m.category || null, isPen: !!m.isPen, isSpray: !!m.isSpray,
        isExclusive: exclusive
      });
      added++;
    }
  });

  renderOrderLines();
  updateOrderTotals(getSubtotal());
  if (added > 0) {
    showToast(`✅ ${stack.name}: ${added} products added`, 'success');
  } else {
    showToast(`${stack.name} compounds not found in product catalog`, 'error');
  }
}

// ═══════════════════════════════════════════════════════════
// COMPOUNDS LIBRARY — Protocol Cards (Feature 3)
// ═══════════════════════════════════════════════════════════

let protocolLibraryData = [];

async function loadProtocolLibrary() {
  if (protocolLibraryData.length > 0) return; // already loaded
  try {
    const res = await fetch('/api/protocols-library');
    const data = await res.json();
    protocolLibraryData = data.protocols || [];
  } catch (e) {
    console.error('Failed to load protocol library:', e);
  }
}

function renderProtocolCards() {
  const grid = document.getElementById('compound-grid');
  if (protocolLibraryData.length === 0) return;

  // Prepend protocol section before the compound grid
  let protocolSection = document.getElementById('protocol-library-section');
  if (!protocolSection) {
    protocolSection = document.createElement('div');
    protocolSection.id = 'protocol-library-section';
    protocolSection.className = 'protocol-library-section';
    grid.parentNode.insertBefore(protocolSection, grid);
  }

  protocolSection.innerHTML = `
    <h2 style="color:var(--gold);margin-bottom:8px">🧬 Signature Protocols (${protocolLibraryData.length})</h2>
    <p style="color:var(--muted);font-size:13px;margin-bottom:16px">Curated compound stacks for specific research goals. Click any protocol to view details and add to order.</p>
    <div class="protocol-cards-grid">
      ${protocolLibraryData.map((p, i) => `
        <div class="protocol-card" onclick="openProtocolDetail(${i})">
          <div class="protocol-card-header">
            <div class="protocol-goal-badge">${p.goal || ''}</div>
          </div>
          <h3 class="protocol-card-name">${p.name}</h3>
          <div class="protocol-compounds-list">
            ${(p.compounds || []).map(c => `<span class="protocol-compound-chip">${c}</span>`).join('')}
          </div>
          <div class="protocol-card-footer">
            <span class="protocol-count">${(p.compounds || []).length} compounds</span>
            <span class="protocol-add-hint">View Details →</span>
          </div>
        </div>`).join('')}
    </div>
    <hr style="border-color:var(--border);margin:28px 0 16px">
    <h2 style="color:var(--text);margin-bottom:16px">📚 Individual Compounds</h2>`;
}

function openProtocolDetail(index) {
  const p = protocolLibraryData[index];
  if (!p) return;

  // Show in a modal
  let modal = document.getElementById('modal-protocol-detail');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-protocol-detail';
    modal.className = 'modal';
    document.body.appendChild(modal);
  }

  const compoundChips = (p.compounds || []).map(c => {
    const match = products.find(pr => pr.msrp > 0 && pr.name.toLowerCase().includes(c.toLowerCase().split(' ')[0]));
    const hasProduct = match ? `<span class="protocol-detail-price">$${match.msrp.toFixed(2)}</span>` : '';
    return `<div class="protocol-detail-compound"><span class="protocol-compound-chip">${c}</span>${hasProduct}</div>`;
  }).join('');

  modal.innerHTML = `
    <div class="modal-content modal-compound-content">
      <div class="modal-header compound-modal-header">
        <div>
          <h2>${p.name}</h2>
          <span class="category-badge">${p.goal || ''}</span>
        </div>
        <button class="modal-close" onclick="closeProtocolModal()">✕</button>
      </div>
      <div class="compound-modal-body">
        <p style="color:var(--muted);margin-bottom:16px">A curated research stack targeting: <strong style="color:var(--green)">${p.goal}</strong></p>
        <h3 style="color:var(--gold);margin-bottom:12px">Compounds in this Stack</h3>
        <div class="protocol-detail-compounds-grid">
          ${compoundChips}
        </div>
        <div class="btn-row" style="margin-top:24px">
          <button class="btn-primary" onclick="addProtocolStackToOrder(${index})">🛒 Add to Order</button>
          <button class="btn-ghost" onclick="closeProtocolModal()">Close</button>
        </div>
        <div class="disclaimer-banner" style="margin-top:16px">⚠️ For research purposes only. Not medical advice.</div>
      </div>
    </div>`;

  modal.classList.remove('hidden');
  document.getElementById('modal-overlay').classList.remove('hidden');
}

function closeProtocolModal() {
  const modal = document.getElementById('modal-protocol-detail');
  if (modal) modal.classList.add('hidden');
  document.getElementById('modal-overlay').classList.add('hidden');
}

// ════════════════════════════════════════════════════════════
// STACK BUILDER
// ════════════════════════════════════════════════════════════


// ─── Compound detail lookup ───────────────────────────────────
const COMPOUND_DETAIL = {
  'BPC-157':       'Add 2mL BAC water to 5mg vial → 2,500mcg/mL. Daily SubQ injection. 250mcg = 10 units on insulin syringe. Can inject near injury site.',
  'TB-500':        'Add 2mL BAC water to 5mg vial → 2,500mcg/mL. 2.5mg twice weekly loading, then 1x/week maintenance. Standard dose = 100 units (1mL).',
  'GHK-Cu':        'Add 2mL BAC water to 5mg vial. Blue/green colour is normal. 1mg = 40 units. Inject slowly — burning is expected and normal. 3–5x/week.',
  'KPV':           'Add 2mL BAC water to 5mg vial → 2,500mcg/mL. 500mcg = 20 units. Daily SubQ, take with or before BPC-157.',
  'Retatrutide':   'Add 1mL BAC water to 10mg vial → 10mg/mL. Or use pen: dial to prescribed dose. Start at 2mg/week, titrate up. Once weekly injection.',
  'Semaglutide':   'Add 2mL BAC water to vial. 0.25mg = 25 units on insulin syringe. Pen: dial to dose. Once weekly. Start low, titrate up slowly.',
  'CJC-1295 DAC':  'Add 2mL BAC water to 2mg vial → 1mg/mL. 1mg = 100 units (1mL). Once weekly before bed on empty stomach (3+ hrs after eating).',
  'Ipamorelin':    'Add 2mL BAC water to 5mg vial → 2,500mcg/mL. 200mcg = 8 units. Nightly fasted injection — MUST be on empty stomach (2+ hrs after eating).',
  'NAD+':          'Add 5–10mL BAC water to 500mg vial. Start at 100mg. Inject EXTREMELY slowly (3–5 minutes). Expect significant flushing — this is normal.',
  'Epitalon':      'Add 2mL BAC water to 10mg vial. 5mg = 50 units. Evening SubQ injection for 10 consecutive days. Repeat cycle 2x/year.',
  'MOTS-C':        'Reconstitute per vial instructions. 10mg dose. Alternate days with SLU-PP-332 — NEVER same day. Inject morning on training days.',
  'SLU-PP-332':    'Follow vial or oral instructions. Alternate days with MOTS-C. Do not take on same day as MOTS-C.',
  'SS-31':         'Add 2mL BAC water to 10mg vial. Inject 30–60 min BEFORE MOTS-C on training days for maximum mitochondrial synergy.',
  '5-Amino 1MQ':   'Oral capsule — no injection needed. Take daily with food. No reconstitution required.',
  'Tesamorelin':   'Add 2mL BAC water to vial or use pen. Alternate days with CJC-1295 DAC — do not inject both same day. Daily injection.',
  'AOD-9604':      'Add 2mL BAC water to 5mg vial. 300mcg = 12 units. Inject fasted in the morning, separate from GLP-1 injection day.',
  'PT-141':        'Add 2mL BAC water to 10mg vial. 1.75mg = 35 units. Inject SubQ or nasal spray 45–60 minutes before intended effect.',
  'Kisspeptin':    'Add 2mL BAC water to 5mg vial. 100–200mcg dose. SubQ injection 2–3x per week.',
  'Semax':         'Intranasal spray — no injection needed. 2–3 drops per nostril per dose. Run 2–4 week cycles.',
  'Selank':        'Intranasal or SubQ. 250mcg per dose. Can be taken same day as Semax for combined cognitive effect.',
  'Thymosin Alpha-1': 'Add 1mL BAC water to 5mg vial. 1.6mg = 32 units. SubQ injection 2–3x per week.',
};

function getBenefitDetail(name) {
  return COMPOUND_DETAIL[name] || 'See compound guide for reconstitution and dosing instructions.';
}

// ─── Cycle Length Selector ───────────────────────────────────
function selectCycleLength(weeks, el) {
  stackState.cycleWeeks = weeks;
  document.querySelectorAll('.cycle-btn').forEach(b => b.classList.remove('active'));
  if (el) el.classList.add('active');
  const labels = { 4: 'Testing (~1 month)', 12: 'Short Cycle (~3 months)', 24: 'Builder (~6 months)', 36: 'Optimal (9 months)' };
  showToast('⏱ Cycle set to ' + (labels[weeks] || weeks + ' weeks'), 'success');
  // Re-render tier cards to show updated week count (if visible)
  if (stackState.selectedStack) renderTierCards();
  // Rebuild full result if stack + tier already selected
  if (stackState.selectedStack && stackState.selectedTier) buildStack();
}

let stackState = {
  stacks: [],
  selectedStack: null,
  selectedTier: null,
  dosingLevel: 'mid',
  cycleWeeks: 12,
  result: null,
  compoundFormats: {},     // Feature 1: per-compound format selections
  customRemovals: [],      // Feature 2: session-only removed compounds
  customAdditions: []      // Feature 2: session-only added compounds
};

async function loadStackLibrary() {
  if (stackState.stacks.length) return;
  // Use inline data if available (static/Netlify deployment), fall back to API
  if (window.INLINE_STACKS && window.INLINE_STACKS.length) {
    stackState.stacks = window.INLINE_STACKS;
    renderGoalCards();
    return;
  }
  try {
    const res = await fetch('/api/stack-library');
    const data = await res.json();
    stackState.stacks = data.stacks;
    renderGoalCards();
  } catch(e) {
    console.warn('Stack library API unavailable, no inline data found');
  }
}

function renderGoalCards() {
  const grid = document.getElementById('goal-cards');
  if (!grid) return;
  grid.innerHTML = stackState.stacks.map(s => `
    <div class="goal-card" onclick="selectGoal('${s.id}')">
      <div class="goal-emoji">${s.emoji}</div>
      <div class="goal-name">${s.goal}</div>
      <div class="goal-tagline">${s.tagline}</div>
    </div>
  `).join('');
}

function selectGoal(stackId) {
  stackState.selectedStack = stackState.stacks.find(s => s.id === stackId);
  stackState.selectedTier = null;
  stackState.dosingLevel = 'mid';
  document.getElementById('stack-step1').style.display = 'none';
  document.getElementById('stack-step2').style.display = 'block';
  document.getElementById('stack-output').style.display = 'none';
  document.getElementById('dosing-selector').style.display = 'none';
  renderTierCards();
}

function renderTierCards() {
  const s = stackState.selectedStack;
  const container = document.getElementById('tier-cards');
  const tiers = ['basic', 'intermediate', 'advanced'];
  const colors = ['#3ecf8e', '#c8a84b', '#ef4444'];
  container.innerHTML = tiers.map((t, i) => {
    const td = s.tiers[t];
    if (!td) return '';
    return `
      <div class="tier-card" onclick="selectTier('${t}', this)" style="border-top-color:${colors[i]}">
        <div class="tier-label">${td.label}</div>
        <div class="tier-desc">${td.description}</div>
        <div class="tier-compounds">${(td.compounds || []).map(c =>
          `<span class="compound-chip">${c.replace('KLOW (KPV + BPC-157 + GHK-Cu + TB-500)', '🟢 KLOW')}</span>`
        ).join('')}</div>
        ${td.klowRecommended ? '<div class="klow-badge">🟢 KLOW Recommended</div>' : ''}
        <div class="tier-weeks">⏱ ${stackState.cycleWeeks || td.cycleWeeks} week cycle</div>
      </div>
    `;
  }).join('');
}

function selectTier(tier, el) {
  stackState.selectedTier = tier;
  document.getElementById('dosing-selector').style.display = 'block';
  document.querySelectorAll('.tier-card').forEach(c => c.classList.remove('selected'));
  if (el) el.classList.add('selected');
  // Reset dosing pills to mid
  document.querySelectorAll('.dose-pill').forEach(p => {
    p.classList.toggle('active', p.dataset.level === stackState.dosingLevel);
  });
  updateDosingContext();
}

function selectDose(level) {
  stackState.dosingLevel = level;
  document.querySelectorAll('.dose-pill').forEach(p => p.classList.remove('active'));
  const pill = document.querySelector(`[data-level="${level}"]`);
  if (pill) pill.classList.add('active');
  updateDosingContext();
}

function updateDosingContext() {
  const ctx = document.getElementById('dosing-context');
  const labels = {
    low:  '🌱 <strong>Low / Maintenance</strong> — Long-term use, sensitive clients, first-time users, budget-conscious. Minimal side effects. Results build slowly.',
    mid:  '⚡ <strong>Mid / Recovery</strong> — Active protocol for someone triggering a change. Looking for better results, post-illness, returning from injury. Standard working dose.',
    high: '🔥 <strong>High / Optimize</strong> — Post-surgery, competition prep, aggressive fat loss, athletes in peak training, diabetes prevention. Maximum results.'
  };
  if (ctx) ctx.innerHTML = labels[stackState.dosingLevel] || '';
  if (stackState.selectedTier) buildStack();
}

async function buildStack() {
  const res = await fetch('/api/stack-builder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      stackId:        stackState.selectedStack.id,
      tier:           stackState.selectedTier,
      dosingLevel:    stackState.dosingLevel,
      cycleWeeks:     stackState.cycleWeeks || stackState.selectedStack.tiers[stackState.selectedTier].cycleWeeks,
      customAddons:   stackState.customAddons || [],
      klowFormat:     klowFormat || 'fd',
      customRemovals:  stackState.customRemovals  || [],
      customAdditions: stackState.customAdditions || []
    })
  });
  const data = await res.json();
  stackState.result = data;
  document.getElementById('stack-step2').style.display = 'block';
  document.getElementById('stack-output').style.display = 'block';
  renderStackResult(data);
}

function renderStackResult(data) {
  const content = document.getElementById('stack-result-content');

  const dosingRows = Object.entries(data.dosing || {}).map(([compound, dose]) =>
    `<tr><td class="td-compound">${compound}</td><td class="td-dose">${dose}</td></tr>`
  ).join('');

  const supplyRows = (data.supplyList || []).filter(s => s).map(s =>
    `<tr><td>${s.name}</td><td><strong style="color:var(--green)">${s.units || '?'} ${s.unit || 'vial'}${(s.units > 1) ? 's' : ''}</strong></td><td style="color:var(--text-muted)">${s.weeksPerVial ? `~${Number(s.weeksPerVial).toFixed(1)} wks/vial` : (s.weeksPerUnit ? `~${Number(s.weeksPerUnit).toFixed(1)} wks/unit` : '')}</td></tr>`
  ).join('');

  const scheduleNotes = (data.schedulingNotes || []).map(n => `<li>${n}</li>`).join('');

  const cycleWeeks = data.cycleWeeks || 12;
  const compounds = (data.compounds || []).map(c => c.replace('KLOW (KPV + BPC-157 + GHK-Cu + TB-500)', 'KLOW'));

  // Build supply-aware gantt — track ACTUAL supply duration, not capped to cycleWeeks
  const supplyMap = {};
  (data.supplyList || []).forEach(s => {
    if (!s || !s.name) return;
    const weeksEach = s.weeksPerVial || s.weeksPerUnit || 4;
    const totalWeeksCovered = Math.round((s.units || 1) * weeksEach);
    supplyMap[s.name] = totalWeeksCovered; // NOT capped — full actual coverage
  });
  // KLOW maps to 4 sub-compounds — use minimum coverage of the 4
  if (supplyMap['KPV'] || supplyMap['BPC-157']) {
    const klowWeeks = Math.min(
      supplyMap['KPV'] || cycleWeeks,
      supplyMap['BPC-157'] || cycleWeeks,
      supplyMap['GHK-Cu'] || cycleWeeks,
      supplyMap['TB-500'] || cycleWeeks
    );
    supplyMap['KLOW'] = klowWeeks;
    supplyMap['KLOW (KPV + BPC-157 + GHK-Cu + TB-500)'] = klowWeeks;
  }

  // ganttWeeks = total chart width = longest supply coverage OR cycleWeeks (whichever is larger)
  // This lets leftover bars extend beyond the cycle end marker.
  const maxSupplyWeeks = Math.max(...Object.values(supplyMap), cycleWeeks);
  const ganttWeeks = Math.min(maxSupplyWeeks, cycleWeeks + 24, 60); // cap: cycle + 24 leftover wks max, abs cap 60

  // Feature 3: MOTS-C / SLU-PP-332 alternating — detect both present
  const hasBothMitochondrial = compounds.includes('MOTS-C') && compounds.includes('SLU-PP-332');
  // Feature 4: SS-31 primer — uses data from server
  const ss31PrimerMode = data.ss31PrimerMode || false;
  const primerWeeks    = data.primerWeeks    || 4;

  const ganttRows = compounds.map(c => {
    const cleanC = c.replace('KLOW (KPV + BPC-157 + GHK-Cu + TB-500)', 'KLOW');
    const supplyWeeks = supplyMap[c] || supplyMap[cleanC] || cycleWeeks;

    // Feature 3: override active range for MOTS-C / SLU-PP-332
    let activeStart = 1;
    let activeEnd   = cycleWeeks;
    if (hasBothMitochondrial) {
      if (c === 'MOTS-C')     { activeStart = 1;  activeEnd = Math.min(12, cycleWeeks); }
      if (c === 'SLU-PP-332') { activeStart = 13; activeEnd = cycleWeeks; }
    }

    // Feature 4: SS-31 primer shifts other compounds to start at week 5
    if (ss31PrimerMode) {
      if (c === 'SS-31') { activeStart = 1; activeEnd = primerWeeks; }
      else if (c !== 'KLOW (KPV + BPC-157 + GHK-Cu + TB-500)' && !c.startsWith('KLOW')) {
        activeStart = primerWeeks + 1;
      }
    }

    const cells = Array.from({ length: ganttWeeks }, (_, i) => {
      const wk = i + 1;
      // Active (green): within the selected cycle length AND compound has supply AND within active range
      const withinCycle    = wk <= cycleWeeks;
      const hasSupply      = wk <= supplyWeeks;
      const withinActive   = wk >= activeStart && wk <= activeEnd;
      const isActive       = withinCycle && hasSupply && withinActive;
      // Leftover (steel blue-grey): past cycle end but vials still cover it
      const isExtended     = !withinCycle && hasSupply;
      const isLastActive   = isActive && wk === Math.min(supplyWeeks, activeEnd, cycleWeeks);
      return `<td class="gantt-cell${isActive ? ' gantt-active' : ''}${isExtended ? ' gantt-extended' : ''}${isLastActive ? ' gantt-last' : ''}"
        title="${isActive ? c + ': active Week ' + wk : isExtended ? c + ': leftover supply (cycle ended W' + cycleWeeks + ')' : c + ': not active'}">
        </td>`;
    }).join('');
    const extraWeeks = supplyWeeks > cycleWeeks ? Math.min(supplyWeeks - cycleWeeks, 24) : 0;
    const cleanName = c.replace('KLOW (KPV + BPC-157 + GHK-Cu + TB-500)', 'KLOW');
    const label = extraWeeks > 0
      ? `${cleanName} <span class="gantt-extended-label">+${extraWeeks}wk leftover</span>`
      : cleanName;
    return `<tr>
      <td class="gantt-label" style="white-space:nowrap;">${label}</td>
      ${cells}
    </tr>`;
  }).join('');

  const weekHeaders = Array.from({ length: ganttWeeks }, (_, i) => {
    const wk = i + 1;
    const isCycleEnd = wk === cycleWeeks;
    return `<th class="gantt-wk${wk > cycleWeeks ? ' gantt-wk-ext' : ''}${isCycleEnd ? ' gantt-wk-end' : ''}">W${wk}</th>`;
  }).join('');

  // Build compound breakdown section
  const breakdownHTML = (data.compoundBreakdown || []).map(c => {
    if (c.isBundle) {
      const innerCards = (c.bundleContains || []).map(b => `
        <div class="bundle-compound">
          <span class="bundle-emoji">${b.emoji || '🧬'}</span>
          <div>
            <div class="bundle-name">${b.name}</div>
            <div class="bundle-tagline">${b.tagline || ''}</div>
            <div class="bundle-why">${b.why || ''}</div>
          </div>
        </div>
      `).join('');
      return `
        <div class="compound-card klow-card">
          <div class="compound-card-header">
            <span class="compound-emoji">${c.emoji}</span>
            <div>
              <div class="compound-name">${c.name}</div>
              <div class="compound-tagline">${c.tagline}</div>
            </div>
          </div>
          <div class="klow-picker">
            <div class="klow-picker-label">Choose your KLOW format:</div>
            <div class="klow-options">
              <label class="klow-option klow-option-discontinued" style="opacity:0.45;cursor:not-allowed;">
                <input type="radio" name="klow-format" value="pen" disabled>
                <div class="klow-opt-content">
                  <span class="klow-opt-title">🖊️ KLOW Pen <span style="color:#e55;font-size:0.8em;font-weight:600;">(Unavailable — Discontinued)</span></span>
                  <span class="klow-opt-sub" style="text-decoration:line-through;">All 4 compounds in 1 pen · 1 injection · most convenient</span>
                </div>
              </label>
              <label class="klow-option">
                <input type="radio" name="klow-format" value="fd" checked onchange="selectKlowFormat('fd')">
                <div class="klow-opt-content">
                  <span class="klow-opt-title">🧊 KLOW Freeze-Dried</span>
                  <span class="klow-opt-sub">All 4 compounds in 1 vial · reconstitute with BAC water · 1 injection · ask Marc for pricing</span>
                </div>
              </label>
              <label class="klow-option">
                <input type="radio" name="klow-format" value="individual" onchange="selectKlowFormat('individual')">
                <div class="klow-opt-content">
                  <span class="klow-opt-title">🧪 Individual Products</span>
                  <span class="klow-opt-sub">BPC-157 · TB-500 · KPV · GHK-Cu separately — most flexible dosing, multiple injections</span>
                </div>
              </label>
            </div>
          </div>
          <div class="compound-why">${c.why}</div>
          <div class="bundle-inner">${innerCards}</div>
        </div>`;
    }
    return `
      <div class="compound-card" onclick="this.classList.toggle('expanded')">
        <div class="compound-card-header">
          <span class="compound-emoji">${c.emoji || '🧬'}</span>
          <div style="flex:1;">
            <div class="compound-name">${c.name}</div>
            <div class="compound-tagline">${c.tagline || ''}</div>
          </div>
          <span style="color:var(--muted2);font-size:11px;">▼</span>
        </div>
        <div class="compound-why">${c.why || ''}</div>
        <div class="compound-expand">
          ${c.why || ''}
          <div style="margin-top:8px;padding:8px;background:var(--card);border-radius:6px;">
            <strong style="color:var(--gold);">How to use:</strong><br/>
            ${getBenefitDetail(c.name)}
          </div>
        </div>
        <div class="compound-expand-hint">Click to expand</div>
      </div>`;
  }).join('');

  content.innerHTML = `
    <div class="stack-result-header">
      <span class="stack-emoji">${data.stack.emoji}</span>
      <div>
        <div class="stack-result-title">${data.stack.goal} — ${data.tier}</div>
        <div class="stack-result-sub">Dosing: ${data.dosingLevel.toUpperCase()} · ${data.cycleWeeks}-week cycle</div>
        ${data.tierDescription ? `<div class="tier-description-note">${data.tierDescription}</div>` : ''}
      </div>
    </div>

    ${breakdownHTML ? `
    <div class="result-card" style="margin-bottom:14px;">
      <div class="rc-title">🧬 What's In This Stack & Why</div>
      <div class="compound-breakdown-grid">${breakdownHTML}</div>
    </div>` : ''}

    <div class="result-grid">
      <div class="result-card">
        <div class="rc-title">💊 Dosing Protocol</div>
        <table class="dosing-table">
          <thead><tr><th>Compound</th><th>Dose &amp; Frequency</th></tr></thead>
          <tbody>${dosingRows || '<tr><td colspan="2" style="color:var(--text-muted)">Standard dosing applies — see compound guides</td></tr>'}</tbody>
        </table>
      </div>
      <div class="result-card">
        <div class="rc-title">📦 Supply Needed (${data.cycleWeeks} weeks)</div>
        <table class="dosing-table">
          <thead><tr><th>Compound</th><th>Order Qty</th><th>Notes</th></tr></thead>
          <tbody>${supplyRows}</tbody>
        </table>
      </div>
    </div>

    ${scheduleNotes ? `
    <div class="result-card" style="margin-top:12px;">
      <div class="rc-title">⏰ Scheduling Rules</div>
      <ul class="schedule-list">${scheduleNotes}</ul>
    </div>` : ''}

    <div class="result-card" style="margin-top:12px;">
      <div class="rc-title">📅 ${data.cycleWeeks}-Week Cycle Chart</div>
      <div style="overflow-x:auto;">
        <table class="cycle-gantt">
          <thead><tr><th class="gantt-label-th">Compound</th>${weekHeaders}</tr></thead>
          <tbody>${ganttRows}</tbody>
        </table>
      </div>
    </div>

    ${data.addOns && data.addOns.length ? `
    <div id="custom-addons-display" style="display:none;flex-wrap:wrap;gap:6px;margin:8px 0;" class="custom-addons-bar"></div>
    <div class="result-card addon-card" style="margin-top:12px;">
      <div class="rc-title">➕ Recommended Add-Ons</div>
      ${(data.addOns || []).map(a => `
        <div class="addon-row">
          <div>
            <span class="addon-name">${a.compound}</span>
            <span class="addon-why">${a.why}</span>
          </div>
          <button class="btn-add-addon" onclick="addAddonToStack('${a.compound}')">+ Add to Stack</button>
        </div>
      `).join('')}
    </div>` : ''}

    <div class="print-actions" id="stack-print-bar">
      <button class="btn-print-protocol" onclick="printStackProtocol()">🖨️ Print / Save Protocol</button>
      <span class="print-hint">Opens a print-ready version of this protocol</span>
    </div>
  `;

  // ── Feature 1: Format Picker (appended after add-ons section) ──
  if (data.formatOptions && Object.keys(data.formatOptions).length > 0) {
    const formatPickerHTML = `
      <div class="result-card format-options-card" style="margin-top:12px;">
        <div class="rc-title">📦 Product Formats</div>
        <div class="format-options-body" style="display:flex;flex-direction:column;gap:10px;margin-top:8px;">
          ${Object.entries(data.formatOptions).map(([compound, opts]) => {
            const current = stackState.compoundFormats[compound] || 'vial';
            return `<div class="format-row" style="display:flex;align-items:center;gap:12px;">
              <span class="format-compound-name" style="min-width:140px;font-weight:600;color:var(--text)">${compound}</span>
              <div class="format-toggle" style="display:flex;gap:6px;">
                <button class="fmt-btn${current === 'vial' ? ' active' : ''}" onclick="setCompoundFormat('${compound}', 'vial', this)">💉 Vial</button>
                <button class="fmt-btn${current === 'pen' ? ' active' : ''}" onclick="setCompoundFormat('${compound}', 'pen', this)">🖊️ Pen</button>
              </div>
              <span style="font-size:11px;color:var(--muted)">Selected: <strong>${current}</strong></span>
            </div>`;
          }).join('')}
        </div>
      </div>`;
    const resultContent = document.getElementById('stack-result-content');
    if (resultContent) resultContent.insertAdjacentHTML('beforeend', formatPickerHTML);
  }

  // ── Feature 5: Marc's Recommendations ──
  if (data.marcRecommendations && data.marcRecommendations.length > 0) {
    const recsHTML = `
      <div class="result-card recommendations-card" style="margin-top:12px;border-left:3px solid var(--gold);">
        <div class="rc-title">💡 Marc's Recommendations</div>
        <div style="display:flex;flex-direction:column;gap:8px;margin-top:8px;">
          ${data.marcRecommendations.map(rec => `
            <div style="display:flex;gap:8px;align-items:flex-start;">
              <span style="color:var(--gold);font-size:16px;flex-shrink:0;">💡</span>
              <p style="margin:0;font-size:13px;color:var(--text);line-height:1.5;">${rec}</p>
            </div>
          `).join('')}
        </div>
      </div>`;
    const resultContentRecs = document.getElementById('stack-result-content');
    if (resultContentRecs) resultContentRecs.insertAdjacentHTML('beforeend', recsHTML);
  }

  // ── Feature 2: Stack Editor ──
  const defaultCompoundNames = (data.compounds || []).map(c =>
    c.replace('KLOW (KPV + BPC-157 + GHK-Cu + TB-500)', 'KLOW')
  );
  const editorHTML = `
    <div class="result-card stack-editor-section" style="margin-top:12px;">
      <div class="rc-title" style="display:flex;justify-content:space-between;align-items:center;">
        ✏️ Customize Stack
        <button class="btn-ghost btn-small" onclick="resetStackToDefault()" style="font-size:11px;padding:4px 10px;">↩ Reset to Default</button>
      </div>
      <div id="compound-chips" style="display:flex;flex-wrap:wrap;gap:6px;margin:10px 0;">
        ${defaultCompoundNames.map(name => `
          <span class="compound-chip-edit" style="display:inline-flex;align-items:center;gap:4px;background:var(--card2);border:1px solid var(--border);border-radius:16px;padding:4px 10px;font-size:12px;">
            ${name}
            <button class="chip-remove" onclick="removeCompound('${name}')" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:14px;line-height:1;padding:0 2px;">×</button>
          </span>`).join('')}
      </div>
      <div style="position:relative;margin-top:8px;display:flex;flex-direction:column;gap:6px;">
        <input type="text" id="add-compound-search" placeholder="Search compound to add..." 
               class="form-control" style="width:100%;" oninput="searchAddCompound(this.value)">
        <div id="add-compound-results" class="compound-search-results" style="display:none;position:absolute;top:38px;left:0;right:0;background:var(--card2);border:1px solid var(--border);border-radius:8px;z-index:50;max-height:180px;overflow-y:auto;"></div>
      </div>
    </div>`;
  const resultContent2 = document.getElementById('stack-result-content');
  if (resultContent2) resultContent2.insertAdjacentHTML('beforeend', editorHTML);

  // Fetch and append pricing breakdown
  fetchAndRenderPricing(data);
}

// ── Print Protocol ─────────────────────────────────────────────
function printStackProtocol() {
  document.body.classList.add('printing-protocol');
  window.print();
  setTimeout(() => document.body.classList.remove('printing-protocol'), 1000);
}

// ── Feature 1: Set compound format ────────────────────────────
function setCompoundFormat(compound, format, btn) {
  stackState.compoundFormats[compound] = format;
  // Update button states
  if (btn) {
    const parent = btn.closest('.format-toggle');
    if (parent) parent.querySelectorAll('.fmt-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const infoSpan = btn.closest('.format-row')?.querySelector('strong');
    if (infoSpan) infoSpan.textContent = format;
  }
  // Re-fetch pricing with new format
  const oldPricing = document.querySelector('.pricing-card');
  if (oldPricing) oldPricing.remove();
  if (stackState.result) fetchAndRenderPricing(stackState.result, stackState.customAddons || [], klowFormat);
}

// ── Feature 2: Stack editor functions ─────────────────────────
function removeCompound(name) {
  // Map 'KLOW' back to the KLOW bundle pattern for removal
  const toRemove = name === 'KLOW'
    ? stackState.result?.compounds?.find(c => c.startsWith('KLOW')) || name
    : name;
  if (!stackState.customRemovals.includes(toRemove)) {
    stackState.customRemovals.push(toRemove);
  }
  showToast(name + ' removed from stack', 'info');
  buildStack();
}

function addCompoundToStack(name) {
  if (stackState.customAdditions.includes(name)) { showToast(name + ' already added', 'info'); return; }
  if (stackState.result?.compounds?.includes(name)) { showToast(name + ' already in stack', 'info'); return; }
  stackState.customAdditions.push(name);
  // Remove from removals list if it was previously removed
  stackState.customRemovals = stackState.customRemovals.filter(r => r !== name);
  document.getElementById('add-compound-search').value = '';
  document.getElementById('add-compound-results').style.display = 'none';
  showToast('✅ ' + name + ' added to stack', 'success');
  buildStack();
}

function resetStackToDefault() {
  stackState.customRemovals  = [];
  stackState.customAdditions = [];
  showToast('↩ Stack reset to default', 'info');
  buildStack();
}

function searchAddCompound(query) {
  const resultsEl = document.getElementById('add-compound-results');
  if (!query || query.trim().length < 2) { resultsEl.style.display = 'none'; return; }
  const q = query.toLowerCase().trim();
  // Build list of known compound names from all products + SUPPLY_CALC keys
  const knownNames = [
    'BPC-157','TB-500','GHK-Cu','KPV','NAD+','CJC-1295 DAC','Ipamorelin','Semaglutide',
    'Retatrutide','Tesamorelin','Epitalon','SS-31','MOTS-C','SLU-PP-332','PT-141',
    'Kisspeptin','5-Amino 1MQ','Thymosin Alpha-1','Semax','Selank','AOD-9604',
    'LL-37','Melanotan-2','DSIP','P21','Pinealon'
  ];
  const currentCompounds = (stackState.result?.compounds || []).map(c =>
    c.replace('KLOW (KPV + BPC-157 + GHK-Cu + TB-500)','KLOW')
  );
  const matches = knownNames.filter(n =>
    n.toLowerCase().includes(q) && !currentCompounds.includes(n)
  ).slice(0, 8);
  if (matches.length === 0) { resultsEl.style.display = 'none'; return; }
  resultsEl.style.display = 'block';
  resultsEl.innerHTML = matches.map(name =>
    `<div class="compound-search-item" onclick="addCompoundToStack('${name}')"
          style="padding:8px 12px;cursor:pointer;border-bottom:1px solid var(--border);font-size:13px;color:var(--text);"
          onmouseover="this.style.background='var(--bg3)'" onmouseout="this.style.background=''">${name}</div>`
  ).join('');
}

async function fetchAndRenderPricing(stackData, addons, klowFmt) {
  try {
    const tierKey = (stackData.tier || '').split(' ')[0].toLowerCase(); // 'basic'/'intermediate'/'advanced'
    const res = await fetch('/api/stack-pricing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        stackId:         stackData.stack.id,
        tier:            tierKey,
        dosingLevel:     stackData.dosingLevel,
        cycleWeeks:      stackData.cycleWeeks,
        klowFormat:      klowFmt || klowFormat || 'fd',
        compoundFormats: stackState.compoundFormats || {}
      })
    });
    const p = await res.json();
    if (p.error) return;

    const rows = (p.breakdown || []).map(c => `
      <tr>
        <td class="td-compound">${c.name}</td>
        <td>$${c.pricePerUnit.toLocaleString()}</td>
        <td><strong style="color:var(--green)">${c.unitsNeeded} ${c.unit}${c.unitsNeeded > 1 ? 's' : ''}</strong></td>
        <td>~${c.weeksPerUnit}wk/unit</td>
        <td><strong>$${c.totalCost.toLocaleString()}</strong></td>
        <td style="color:var(--gold)">$${c.monthlyCost.toLocaleString()}/mo</td>
      </tr>
    `).join('');

    const doseRows = (p.doseComparison || []).map(d => `
      <div class="budget-option ${d.level === stackData.dosingLevel ? 'budget-active' : ''}"
           onclick="switchDoseLevel('${d.level}')"
           style="cursor:pointer;" title="Click to switch to ${d.level} dose">
        <span class="budget-level">${d.label}</span>
        <span class="budget-monthly">~$${d.estimatedMonthly.toLocaleString()}/mo</span>
        <span class="budget-total">~$${d.estimatedTotal.toLocaleString()} total</span>
        ${d.level === stackData.dosingLevel ? '<span style="color:var(--green);font-size:10px;font-weight:700;">● ACTIVE</span>' : '<span style="color:var(--muted2);font-size:10px;">Click to select</span>'}
      </div>
    `).join('');

    const pricingHTML = `
      <div class="result-card pricing-card" style="margin-top:12px;border-top:3px solid var(--gold);">
        <div class="rc-title">💰 Pricing &amp; Budget Breakdown</div>

        <div class="pricing-summary">
          <div class="price-stat">
            <div class="ps-val">$${p.grandTotal.toLocaleString()}</div>
            <div class="ps-lbl">Total Stack Cost</div>
          </div>
          <div class="price-stat">
            <div class="ps-val" style="color:var(--gold)">$${p.monthlyAvg.toLocaleString()}/mo</div>
            <div class="ps-lbl">Monthly Average</div>
          </div>
          <div class="price-stat">
            <div class="ps-val" style="color:var(--blue,#60a5fa)">${p.cycleMonths} months</div>
            <div class="ps-lbl">${p.cycleCategory}</div>
          </div>
        </div>

        <table class="dosing-table" style="margin:12px 0;">
          <thead>
            <tr>
              <th>Compound</th>
              <th>Per Unit</th>
              <th>Qty Needed</th>
              <th>Supply</th>
              <th>Total</th>
              <th>Monthly</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
          <tfoot>
            <tr style="background:var(--card2);">
              <td colspan="4"><strong>TOTAL</strong></td>
              <td><strong style="color:var(--green)">$${p.grandTotal.toLocaleString()}</strong></td>
              <td><strong style="color:var(--gold)">$${p.monthlyAvg.toLocaleString()}/mo</strong></td>
            </tr>
          </tfoot>
        </table>

        <div class="rc-title" style="margin-top:14px;">🎚️ Budget Options — Same Stack, Different Dose</div>
        <div class="budget-options">${doseRows}</div>

        <div class="duration-note">${p.durationNote}</div>
        <div class="reorder-note">📅 Suggested reorder reminder: Day ${p.reorderTriggerDay} (${Math.round(p.reorderTriggerDay / 7)} weeks in)</div>
      </div>
    `;

    const resultContent = document.getElementById('stack-result-content');
    if (resultContent) resultContent.insertAdjacentHTML('beforeend', pricingHTML);
  } catch (err) {
    console.warn('Pricing fetch failed:', err.message);
  }
}

// ─── Add-on to Stack ──────────────────────────────────────────

// ─── Add More Vials ────────────────────────────────────────────
function addMoreVials(compoundName, currentEndWeek) {
  // Find the compound in the supply list and increment its units
  if (!stackState.result) return;
  const supply = stackState.result.supplyList;
  const item = supply ? supply.find(s => s && s.name === compoundName) : null;
  if (!item) {
    showToast('Add ' + compoundName + ' to your order to extend the supply', 'info');
    return;
  }
  item.units = (item.units || 1) + 1;
  showToast('✅ Added 1 more ' + (item.unit || 'vial') + ' of ' + compoundName + ' — supply extended', 'success');
  // Re-render the stack result with updated supply
  renderStackResult(stackState.result);
  fetchAndRenderPricing(stackState.result, stackState.customAddons || []);
}

function addAddonToStack(compoundName) {
  if (!stackState.result) return;
  if (!stackState.customAddons) stackState.customAddons = [];
  if (compoundName !== '__refresh__') {
    if (stackState.customAddons.includes(compoundName)) {
      showToast(compoundName + ' already in stack', 'info');
      return;
    }
    stackState.customAddons.push(compoundName);
    showToast('✅ ' + compoundName + ' added to stack', 'success');
  }
  const addonEl = document.getElementById('custom-addons-display');
  if (addonEl) {
    addonEl.innerHTML = stackState.customAddons.map(c =>
      `<span class="addon-chip active">${c} <button onclick="removeAddon('${c}')" class="addon-remove">×</button></span>`
    ).join('');
    addonEl.style.display = stackState.customAddons.length ? 'flex' : 'none';
  }
  // Rebuild entire stack so Gantt, supply list, and pricing all update
  if (stackState.selectedStack && stackState.selectedTier) {
    buildStack();
  } else {
    fetchAndRenderPricing({ ...stackState.result }, stackState.customAddons);
  }
}

function removeAddon(compoundName) {
  if (!stackState.customAddons) return;
  stackState.customAddons = stackState.customAddons.filter(c => c !== compoundName);
  showToast(compoundName + ' removed from stack', 'info');
  if (stackState.selectedStack && stackState.selectedTier) {
    buildStack();
  }
}

// ─── KLOW Format Picker ───────────────────────────────────────
let klowFormat = 'fd';
function selectKlowFormat(format) {
  klowFormat = format;
  const labels = {
    pen: 'KLOW Pen — all 4 compounds in 1 injection, most convenient',
    fd: 'KLOW Freeze-Dried — reconstitute with BAC water, 1 injection per dose',
    individual: 'Individual products — BPC-157, TB-500, KPV, GHK-Cu ordered separately'
  };
  showToast('✅ ' + labels[format], 'success');
  // Remove old pricing card and re-render with new format
  const oldPricing = document.querySelector('.pricing-card');
  if (oldPricing) oldPricing.remove();
  if (stackState.result) {
    fetchAndRenderPricing(stackState.result, stackState.customAddons || [], format);
  }
}

// ─── Switch Dose Level (Budget Pill Click) ────────────────────
async function switchDoseLevel(level) {
  if (!stackState.selectedStack || !stackState.selectedTier) return;
  stackState.dosingLevel = level;
  document.querySelectorAll('.dose-pill').forEach(p => {
    p.classList.toggle('active', p.dataset.level === level);
  });
  showToast('⏳ Recalculating for ' + level + ' dose...', 'info');
  await buildStack();
}

function stackBack() {
  document.getElementById('stack-step1').style.display = 'block';
  document.getElementById('stack-step2').style.display = 'none';
  document.getElementById('stack-output').style.display = 'none';
}

function stackBack2() {
  document.getElementById('stack-output').style.display = 'none';
}

function addStackToOrder() {
  if (!stackState.result) return;
  showPage('order');
  setTimeout(() => {
    const compoundNames = stackState.result.supplyList.filter(s => s).map(s => s.name);
    compoundNames.forEach(name => {
      const kLower = name.toLowerCase().split(' ')[0];
      const match = products.find(pr =>
        pr.msrp > 0 && pr.name.toLowerCase().includes(kLower)
      );
      if (match && !orderLines.find(l => l.id === match.id)) {
        orderLines.push({
          id: match.id, name: match.name, sku: match.sku, msrp: match.msrp,
          cost: match.cost || 0, margin: match.margin || 0, profit: match.profit || 0,
          qty: 1, lineTotal: match.msrp, lineCost: match.cost || 0
        });
      }
    });
    renderOrderLines();
    showToast(`✓ Stack compounds added to order`, 'success');
  }, 300);
}

async function generateProtocolFromStack() {
  if (!stackState.result) return;
  const r = stackState.result;

  // KLOW sub-compound dosing fallback (known standard doses)
  const KLOW_DOSING = {
    low:  { 'KPV': '250mcg/day', 'BPC-157': '200mcg/day', 'GHK-Cu': '1mg 3x/week', 'TB-500': '2mg/week' },
    mid:  { 'KPV': '500mcg/day', 'BPC-157': '300mcg/day', 'GHK-Cu': '1mg daily',   'TB-500': '5mg/week' },
    high: { 'KPV': '1mg/day',    'BPC-157': '500mcg/day', 'GHK-Cu': '2mg daily',   'TB-500': '10mg/week' }
  };
  const klowDoses = KLOW_DOSING[r.dosingLevel] || KLOW_DOSING.mid;

  // KLOW sub-compound rationale
  const KLOW_RATIONALE = {
    'KPV':     'Inhibits NF-κB (master inflammatory switch). Protects gut from GLP-1 side effects.',
    'BPC-157': 'Accelerates tissue and gut repair. Promotes angiogenesis. Essential foundational healing compound.',
    'GHK-Cu':  'Activates 4,000+ repair genes. Stimulates collagen and elastin. Protects skin quality.',
    'TB-500':  'Systemic healing throughout the body. Promotes flexibility, reduces inflammation, accelerates recovery.'
  };

  // Build compound list from compoundBreakdown (includes KLOW expansion)
  const compoundList = [];
  (r.compoundBreakdown || []).forEach(c => {
    if (c.isBundle) {
      // Expand KLOW bundle into its 4 sub-compounds
      ['KPV', 'BPC-157', 'GHK-Cu', 'TB-500'].forEach(k => {
        const dose = klowDoses[k] || r.dosing?.[k] || '';
        compoundList.push({
          name: k,
          dose_mg: dose,
          frequency: dose,
          timing: (SCHEDULING_RULES && SCHEDULING_RULES[k]) ? SCHEDULING_RULES[k].note : 'Daily SubQ',
          duration: r.cycleWeeks + ' weeks',
          rationale: KLOW_RATIONALE[k] || ''
        });
      });
    } else {
      const dose = (r.dosing && r.dosing[c.name]) ? r.dosing[c.name] : '';
      compoundList.push({
        name: c.name,
        dose_mg: dose,
        frequency: dose,
        timing: (SCHEDULING_RULES && SCHEDULING_RULES[c.name]) ? SCHEDULING_RULES[c.name].note : 'See compound guide',
        duration: r.cycleWeeks + ' weeks',
        rationale: c.why || c.tagline || ''
      });
    }
  });

  // Build protocolData from stack result
  const protocolData = {
    recommended_compounds: compoundList,
    cycle_length: r.cycleWeeks + ' weeks',
    stack_synergies: (r.schedulingNotes || []).join(' | ') || '',
    research_notes: r.stack.goal + ' — ' + r.tier + ' tier, ' + r.dosingLevel.toUpperCase() + ' dose',
    disclaimer: 'For research purposes only. Not intended for human use. Not medical advice.',
    bloodwork_schedule: ['Week 0 Baseline', 'Week ' + Math.round(r.cycleWeeks/2) + ' Check', 'Week ' + r.cycleWeeks + ' Final']
  };

  showToast('⏳ Generating protocol PDF...', 'info');

  try {
    const res = await fetch('/api/pdf/protocol', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({
        client: 'Client',
        stackGoal: r.stack.goal,
        tierLabel: r.tier,
        dosingLevel: r.dosingLevel,
        cycleWeeks: r.cycleWeeks,
        schedulingNotes: r.schedulingNotes || [],
        klowFormat: klowFormat || 'fd',
        compounds: compoundList.map(c => ({
          name: c.name,
          dose: c.dose_mg || c.frequency || '',
          frequency: c.frequency || '',
          duration: c.duration || (r.cycleWeeks + ' weeks')
        }))
      })
    });

    if (!res.ok) {
      const err = await res.json();
      showToast('PDF error: ' + (err.error || 'Unknown'), 'error');
      return;
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    showToast('✅ Protocol PDF opened', 'success');
  } catch(e) {
    showToast('PDF failed: ' + e.message, 'error');
  }
}

async function printClientGuide() {
  if (!stackState.result) return showToast('Build a stack first', 'error');
  const r = stackState.result;
  showToast('Generating client guide...', 'info');
  try {
    const res = await fetch('/api/pdf/client-guide', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client: 'Client',
        stackId: stackState.selectedStack.id,
        tier: stackState.selectedTier,
        dosingLevel: stackState.dosingLevel,
        cycleWeeks: stackState.cycleWeeks || r.cycleWeeks,
        klowFormat: klowFormat || 'fd'
      })
    });
    if (!res.ok) throw new Error('PDF generation failed');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
  } catch(e) {
    showToast('Could not generate guide: ' + e.message, 'error');
  }
}

// Scheduling rules reference for stack PDF
const SCHEDULING_RULES = {
  'SS-31': { note: 'Take 30–60 min before MOTS-C' },
  'MOTS-C': { note: 'Alternate days with SLU-PP-332' },
  'SLU-PP-332': { note: 'Alternate days with MOTS-C' },
  'Tesamorelin': { note: 'Alternate days with CJC-1295 DAC' },
  'CJC-1295 DAC': { note: 'Once weekly, fasted preferred' },
  'Ipamorelin': { note: 'Nightly, fasted (2+ hrs after eating)' },
  'Semaglutide': { note: 'Once weekly, consistent day' },
  'Retatrutide': { note: 'Once weekly — titrate up from low dose' },
  'BPC-157': { note: 'Daily SubQ, can inject near injury site' },
  'TB-500': { note: '2x/week loading → 1x/week maintenance' },
  'GHK-Cu': { note: '3–5x/week. Expect burning — inject slowly' },
  'KPV': { note: 'Daily, take before or with BPC-157' },
  'NAD+': { note: 'Morning. Inject VERY slowly (3–5 min). Expect flushing.' },
  'Epitalon': { note: '10-day pulse cycle, evening injection' },
  '5-Amino 1MQ': { note: 'Oral daily with food' }
};

function generateDietFromStack() {
  if (!stackState.result) return;
  showPage('diet');
  const r = stackState.result;
  const stackName = r.stack.goal;

  // Pre-fill stack field
  const stackEl = document.getElementById('diet-stack');
  if (stackEl) {
    // Build compound list — expand KLOW if present
    const compoundNames = [];
    (r.compoundBreakdown || []).forEach(c => {
      if (c.isBundle) {
        compoundNames.push('KPV', 'BPC-157', 'GHK-Cu', 'TB-500');
      } else {
        compoundNames.push(c.name);
      }
    });
    stackEl.value = stackName + ' Stack (' + r.tier + '): ' + compoundNames.join(', ');
  }

  // Pre-fill goal field
  const goalEl = document.getElementById('diet-goal');
  if (goalEl) {
    const goalMap = {
      'Fat Loss': 'fat_loss',
      'Longevity': 'maintain',
      'Muscle Building': 'muscle',
      'Performance': 'muscle',
      'Cognitive Performance': 'maintain',
      'Hormonal Health': 'recomp',
      'Immune Support': 'maintain'
    };
    const mapped = goalMap[r.stack.goal] || 'recomp';
    goalEl.value = mapped;
  }

  showToast('🥗 Stack & goal loaded into Diet Plan generator', 'success');
}

// ════════════════════════════════════════════════════════════

function addProtocolStackToOrder(index) {
  const p = protocolLibraryData[index];
  if (!p) return;
  closeProtocolModal();
  showPage('order');

  const added = [];
  (p.compounds || []).forEach(compoundName => {
    const kLower = compoundName.toLowerCase().split(' ')[0];
    const match = products.find(pr =>
      pr.msrp > 0 && pr.name.toLowerCase().includes(kLower)
    );
    if (match && !orderLines.find(l => l.id === match.id)) {
      orderLines.push({
        id: match.id, name: match.name, sku: match.sku, msrp: match.msrp,
        cost: match.cost || 0, margin: match.margin || 0, profit: match.profit || 0,
        qty: 1, lineTotal: match.msrp, lineCost: match.cost || 0
      });
      added.push(match.name);
    }
  });

  renderOrderLines();
  showToast(`✓ ${p.name}: ${added.length} products added to order`, 'success');
}

// ═══════════════════════════════════════════════════════════
// HIGHLIGHTS — Research Highlight Data & Renderer
// Each entry: compound, emoji, category (array), accent colour,
// headline, body (1-3 paragraphs), citation, compoundKey
// ═══════════════════════════════════════════════════════════

const HIGHLIGHTS = [

  // ── LIBIDO & SEXUAL ────────────────────────────────────────
  {
    compound: 'PT-141', emoji: '❤️',
    categories: ['libido'],
    accent: '#e05a7a',
    headline: 'PT-141 Rescued Erections in 342 Men Who Failed Viagra',
    body: 'A randomized double-blind trial published in the Journal of Urology tested PT-141 specifically in men for whom Viagra had already failed — 342 of them. The result: significant improvement in erectile function scores using a completely different mechanism than PDE5 inhibitors.\n\nViagra works by increasing blood flow to the penis. PT-141 works upstream in the brain — activating MC4R melanocortin receptors in the hypothalamus that govern desire and arousal. Viagra fixes the plumbing. PT-141 lights the furnace.\n\nThis is why PT-141 works where Viagra can\'t — especially for libido issues with a psychological component, stress-related dysfunction, or men who have simply lost desire.',
    citation: 'Safarinejad MR, Hosseini SY. Salvage of sildenafil failures with bremelanotide. J Urol. 2008;179(3):1066–71.',
    compoundKey: 'PT-141'
  },
  {
    compound: 'PT-141', emoji: '❤️',
    categories: ['libido'],
    accent: '#e05a7a',
    headline: 'The First Brain-Based Sexual Treatment — Works for Both Men and Women',
    body: 'Every other sexual function drug works on the body. PT-141 works on the brain. By activating the same hypothalamic circuits responsible for sexual motivation — not just physical response — it addresses the desire side of sexual dysfunction, not just mechanics.\n\nThis makes PT-141 one of the only compounds effective for both men and women, for psychogenic dysfunction, for libido loss from stress or hormonal shifts, and for people who want desire — not just the ability to perform. The effects begin 45–60 minutes after administration and can last 6–12 hours.',
    citation: 'Molinoff PB et al. PT-141: a melanocortin agonist for the treatment of sexual dysfunction. Ann N Y Acad Sci. 2003;994:96–102.',
    compoundKey: 'PT-141'
  },

  // ── FERTILITY ──────────────────────────────────────────────
  {
    compound: 'Kisspeptin', emoji: '⚡',
    categories: ['fertility', 'hormonal'],
    accent: '#7ac97a',
    headline: 'Kisspeptin Levels Are Measurably Lower in Infertile Men — It\'s Now a Diagnostic Biomarker',
    body: 'A landmark 2025 study measured kisspeptin levels in both blood serum and seminal plasma of fertile and infertile men. The result: kisspeptin is measurably and consistently lower in men with abnormal sperm parameters.\n\nThis makes kisspeptin not just a therapeutic target — it\'s now proposed as a diagnostic marker for male infertility. Low kisspeptin = downstream disruption of LH → testosterone → spermatogenesis. Restoring kisspeptin pulsatility through research protocols may restore the entire cascade without suppressing the body\'s own production.',
    citation: 'Parkpinyo N et al. Kisspeptin as a marker for male infertility. J Assist Reprod Genet. 2025 Nov;42(11):3993–4002.',
    compoundKey: 'Kisspeptin'
  },
  {
    compound: 'NAD+', emoji: '⚡',
    categories: ['fertility', 'longevity'],
    accent: '#f5c542',
    headline: 'NAD+ Reversed Reproductive Aging in Female Mice — Restored Fertility Markers',
    body: 'Harvard and Australian researchers found that NAD+ supplementation in aging female mice reversed key markers of reproductive aging — including mitochondrial dysfunction in oocytes, reduced follicular quality, and ovarian reserve decline.\n\nThis matters because egg quality is mitochondria-dependent. Aging eggs don\'t fail because of structural problems — they fail because their mitochondria can\'t generate enough energy for fertilization and early cell division. NAD+ directly targets that exact mechanism.\n\nThe implication for women experiencing age-related fertility decline is significant — and the NAD+ protocol is one of the most accessible research compounds available.',
    citation: 'Bertoldo MJ et al. NAD+ repletion rescues female fertility during reproductive aging. Cell Reports. 2020;30(6):1670–81.',
    compoundKey: 'NAD+'
  },
  {
    compound: 'Kisspeptin', emoji: '⚡',
    categories: ['fertility', 'hormonal'],
    accent: '#7ac97a',
    headline: 'Kisspeptin Restored Natural Testosterone in Men with Hypothalamic Hypogonadism',
    body: 'In men whose testosterone is low because their brain stopped signalling — not because their testes failed — kisspeptin administration restored LH pulsatility and endogenous testosterone production.\n\nThis is the critical distinction: exogenous testosterone replaces the hormone but shuts down the body\'s own production. Kisspeptin restores the signal that tells the body to make testosterone itself. For men concerned about fertility, this matters enormously — testosterone therapy suppresses sperm production. Kisspeptin does the opposite.',
    citation: 'Dhillo WS et al. Kisspeptin-54 stimulates the hypothalamic-pituitary gonadal axis. J Neuroendocrinol. 2005;17(8):549–54.',
    compoundKey: 'Kisspeptin'
  },

  // ── HEALING & RECOVERY ─────────────────────────────────────
  {
    compound: 'BPC-157', emoji: '🩹',
    categories: ['healing'],
    accent: '#5b9cf6',
    headline: 'BPC-157 Healed Severed Achilles Tendons Faster Than Surgery',
    body: 'In animal studies, BPC-157 healed completely severed Achilles tendons faster than surgical repair alone. The mechanism: BPC-157 simultaneously upregulates nitric oxide pathways AND growth hormone receptors in tendon fibroblasts — a dual signal that accelerates structural repair far beyond what the body does on its own.\n\nBPC-157 also reversed alcohol-induced stomach ulcers within 24 hours in the same research line. The compound appears to have a near-universal repair signal — healing structural tissue and gut lining through overlapping but distinct mechanisms.',
    citation: 'Sikiric P et al. BPC 157 and standard angiogenic growth factors. Int J Mol Sci. 2018.',
    compoundKey: 'BPC-157'
  },
  {
    compound: 'TB-500', emoji: '💪',
    categories: ['healing', 'cardiovascular'],
    accent: '#5b9cf6',
    headline: 'TB-500 Partially Restored Cardiac Function After Heart Attack in Animal Studies',
    body: 'TB-500 stimulates angiogenesis — the growth of new blood vessels — throughout the body, including in cardiac tissue. Studies in heart attack animal models showed TB-500 reduced scar tissue formation in the heart and partially restored cardiac output in animals that had been in heart failure for extended periods.\n\nThis makes TB-500 one of the only repair peptides with published evidence of heart muscle regeneration — not just peripheral tissue healing. The systemic nature of TB-500\'s action (it travels through the bloodstream to injury sites) means a single injection protocol benefits the whole body simultaneously.',
    citation: 'Goldstein AL et al. Thymosin beta4: actin-sequestering protein moonlights to repair injured tissues. Trends Mol Med. 2012.',
    compoundKey: 'TB-500'
  },
  {
    compound: 'GHK-Cu', emoji: '✨',
    categories: ['healing', 'longevity'],
    accent: '#a78bfa',
    headline: 'GHK-Cu Activates Over 4,000 Human Genes — Researchers Call It a "Master Reset Switch"',
    body: 'At age 60, your GHK-Cu levels are approximately 100 times lower than at age 20. This copper peptide — present in every human cell — activates over 4,000 genes involved in tissue remodelling, collagen synthesis, wound repair, antioxidant defense, and anti-inflammatory signalling.\n\nDermatology studies show topically applied GHK-Cu reduced fine wrinkles by 35% and increased skin thickness by 27%. But the skin benefit is just the visible surface of a much deeper repair cascade. Subcutaneous injection delivers GHK-Cu systemically — activating that same gene expression program throughout every tissue type.',
    citation: 'Pickart L, Margolina A. Regenerative and protective actions of the GHK-Cu peptide. Int J Mol Sci. 2018;19(7):1987.',
    compoundKey: 'GHK-Cu'
  },
  {
    compound: 'KPV', emoji: '🌿',
    categories: ['healing', 'immune'],
    accent: '#34d399',
    headline: 'KPV Is Only 3 Amino Acids — Yet It Penetrates the Gut Wall Intact and Kills Inflammation at the Source',
    body: 'KPV (Lys-Pro-Val) is one of the smallest peptides in research — just three amino acids. Yet studies show it penetrates gut epithelial cells intact and directly suppresses NF-κB, the master transcription factor that switches on chronic inflammatory cascades.\n\nUnlike systemic anti-inflammatories that blunt immune function broadly, KPV targets the exact molecular switch that drives gut inflammation, autoimmune activity, and IBD. And because oral delivery works for gut-specific effects, it\'s one of the only injectable peptides that can be used orally for its primary target organ.',
    citation: 'Dalmasso G et al. The peptide KPV exerts anti-inflammatory effects in the intestinal epithelial cell line HT-29. Dig Dis Sci. 2008.',
    compoundKey: 'KPV'
  },

  // ── CARDIOVASCULAR ─────────────────────────────────────────
  {
    compound: 'Semaglutide', emoji: '💉',
    categories: ['cardiovascular', 'metabolic'],
    accent: '#f97316',
    headline: 'Semaglutide Cut Major Cardiovascular Events by 20% — In People Who Weren\'t Even Diabetic',
    body: 'The SELECT trial (2023) was a landmark: 17,604 non-diabetic overweight or obese adults. The finding — semaglutide reduced major cardiovascular events (heart attack, stroke, cardiovascular death) by 20%.\n\nThis is independent of weight loss. The cardiovascular protection appears to be a direct effect of GLP-1 receptor activation in the heart and vasculature — not just a downstream benefit of losing weight. Semaglutide is no longer just a weight loss compound. It\'s becoming a cardiovascular intervention.',
    citation: 'Lincoff AM et al. Semaglutide and cardiovascular outcomes in obesity without diabetes. N Engl J Med. 2023;389:2221–32.',
    compoundKey: 'Semaglutide'
  },
  {
    compound: 'SS-31', emoji: '🔋',
    categories: ['cardiovascular', 'mitochondria'],
    accent: '#60a5fa',
    headline: 'SS-31 Restored Heart Function in Chronic Heart Failure Models',
    body: 'SS-31 targets cardiolipin — the structural lipid on the inner mitochondrial membrane that collapses under oxidative stress. When cardiolipin degrades, mitochondria lose their architecture and energy production collapses. This is a central mechanism of both cardiac aging and heart failure.\n\nAnimal studies showed SS-31 restored mitochondrial membrane integrity in heart cells, reduced cardiac scar tissue, and improved contractile function in animals that had been in heart failure for months. It is currently in human clinical trials for heart failure and kidney disease.',
    citation: 'Szeto HH. First-in-class cardioprotective peptide that targets mitochondria. FASEB J. 2008;22(6):1843–53.',
    compoundKey: 'SS-31'
  },

  // ── COGNITIVE ──────────────────────────────────────────────
  {
    compound: 'Semax', emoji: '🧠',
    categories: ['cognitive'],
    accent: '#818cf8',
    headline: 'Semax Elevates BDNF Within Hours — What Antidepressants Take Weeks to Achieve',
    body: 'BDNF (brain-derived neurotrophic factor) is the protein responsible for neuroplasticity — the brain\'s ability to form new connections, consolidate memory, and adapt. Most antidepressants raise BDNF as a secondary effect, taking 2–4 weeks of daily dosing to produce measurable increases.\n\nSemax elevates BDNF within hours of a single dose. It has been used as a prescription drug in Russia and Ukraine for over 30 years for stroke rehabilitation, cognitive recovery, and ADHD — making it one of the most clinically validated nootropic peptides in existence. Intranasal delivery bypasses the blood-brain barrier entirely for direct CNS uptake.',
    citation: 'Dolotov OV et al. Semax, an analog of ACTH 4-10, elevates BDNF and NGF in rat brain. Brain Res Bull. 2006;69(6):652–8.',
    compoundKey: 'Semax'
  },
  {
    compound: 'Selank', emoji: '🧘',
    categories: ['cognitive', 'sleep'],
    accent: '#818cf8',
    headline: 'Selank Matched Benzodiazepines for Anxiety Relief — With Zero Dependency or Withdrawal',
    body: 'A Russian double-blind clinical trial directly compared Selank to benzodiazepines in patients with generalized anxiety disorder. Selank matched their effectiveness for anxiety reduction. Then it did something benzodiazepines cannot: zero dependency, zero tolerance, zero withdrawal on discontinuation.\n\nSelank works through the enkephalin system — the same opioid-adjacent pathway that modulates pain and anxiety — but without the addiction profile. No tapering required. No cognitive blunting. Used as a registered prescription drug in Russia and Ukraine for anxiety treatment.',
    citation: 'Zozulia AA et al. Efficacy and possible mechanisms of action of a new peptide anxiolytic selank. Bull Exp Biol Med. 2001.',
    compoundKey: 'Selank'
  },
  {
    compound: 'NAD+', emoji: '⚡',
    categories: ['cognitive', 'longevity'],
    accent: '#f5c542',
    headline: 'Restoring NAD+ Reversed Vascular Aging in Mice to Levels Indistinguishable From Young',
    body: 'Harvard researcher David Sinclair\'s lab found that restoring NAD+ levels in aged mice reversed vascular aging — the stiffening and dysfunction of blood vessels — to levels indistinguishable from young mice within weeks.\n\nNAD+ activates sirtuins, the longevity proteins that govern DNA repair, mitochondrial biogenesis, and inflammation control. Humans lose approximately 50% of their NAD+ between ages 40 and 60. Injectable NAD+ bypasses the gut conversion inefficiency for complete cellular replenishment — and the flushing response you feel during injection is direct evidence of cellular uptake happening in real time.',
    citation: 'Das A et al. Impairment of an endothelial NAD+-H2S signaling network is a reversible cause of vascular aging. Cell. 2018;173(1):74–89.',
    compoundKey: 'NAD+'
  },
  {
    compound: 'P21', emoji: '🔬',
    categories: ['cognitive', 'longevity'],
    accent: '#818cf8',
    headline: 'P21 Grows New Neurons — One of Very Few Compounds With Evidence of Actual Neurogenesis',
    body: 'Most neuroprotective compounds protect existing neurons. P21 does something rarer: it stimulates the growth of new ones. By activating CNTF (ciliary neurotrophic factor) receptor pathways in the hippocampus and cortex, P21 triggers neurogenesis — the birth of new neurons in adult brain tissue.\n\nAnimal studies show it reversed cognitive deficits in models of Alzheimer\'s disease and traumatic brain injury. When stacked with DSIP (which triggers the deep sleep window where repair hormones peak), P21 creates a powerful overnight protocol: DSIP opens the window, P21 builds inside it.',
    citation: 'Bhatt DL et al. CNTF analogues and neuroregeneration. Neuropeptides. 2019.',
    compoundKey: 'P21'
  },

  // ── LONGEVITY ──────────────────────────────────────────────
  {
    compound: 'Epitalon', emoji: '🧬',
    categories: ['longevity'],
    accent: '#a78bfa',
    headline: 'Epitalon Is the Only Peptide Shown to Directly Activate Telomerase in Human Cells',
    body: 'Telomerase is the enzyme that maintains telomere length — the protective caps on chromosomes that shorten with every cell division. Short telomeres are the most consistent biomarker of biological aging. Most anti-aging interventions work around telomeres. Epitalon works on them directly.\n\nDeveloped by Russian researcher Vladimir Khavinson over 35+ years of study, Epitalon was shown to activate telomerase in human somatic cells in published research. A single 10-day cycle triggers telomerase activation that outlasts the dosing period — making it one of the most efficient anti-aging protocols available.',
    citation: 'Khavinson VKh et al. Tetrapeptide epitalon stimulates telomerase activity in somatic cells of humans. Bull Exp Biol Med. 2004;138(6):590–2.',
    compoundKey: 'Epitalon'
  },
  {
    compound: 'GHK-Cu', emoji: '✨',
    categories: ['longevity', 'healing'],
    accent: '#a78bfa',
    headline: 'At 60, Your GHK-Cu Is 100× Lower Than at 20 — This Single Peptide Activates 4,000 Repair Genes',
    body: 'GHK-Cu isn\'t just a skin peptide. It\'s a systemic biological signal that tells your body to enter repair mode. The collapse of GHK-Cu with age correlates directly with accelerated tissue breakdown across skin, muscle, bone, and vascular tissue.\n\nResearchers describe it as a "master reset switch" — activating over 4,000 human genes including those governing wound repair, collagen synthesis, antioxidant defense, and anti-inflammatory cascades. The blue-green colour in the vial is the copper complex — the same copper-peptide bond that exists naturally in human plasma at age 20.',
    citation: 'Pickart L, Margolina A. Regenerative and protective actions of the GHK-Cu peptide. Int J Mol Sci. 2018;19(7):1987.',
    compoundKey: 'GHK-Cu'
  },

  // ── FAT LOSS ───────────────────────────────────────────────
  {
    compound: 'Retatrutide', emoji: '🔥',
    categories: ['fat-loss', 'metabolic'],
    accent: '#f97316',
    headline: 'Retatrutide Cleared 81% of Liver Fat — The Most Powerful Fat Clearance Ever Recorded in a Peptide Trial',
    body: 'Phase 2 clinical trials published in Nature Medicine (2024) showed retatrutide cleared 81% of liver fat at the 8mg dose over 24 weeks. No other compound approaches this magnitude of liver fat clearance. Participants with metabolic dysfunction-associated steatotic liver disease (MASLD — formerly known as fatty liver disease) essentially had the condition reversed.\n\nIn the same trial, subjects lost 24.2% of body weight over 48 weeks — surpassing semaglutide\'s ~15% and matching tirzepatide\'s best results. The triple receptor mechanism (GLP-1 + GIP + glucagon) creates three simultaneous fat loss signals that no single-receptor compound can replicate.',
    citation: 'Sanyal AJ et al. Triple hormone receptor agonist retatrutide for MASLD. Nat Med. 2024 Jul;30(7):2037–48.',
    compoundKey: 'Retatrutide'
  },
  {
    compound: '5-Amino 1MQ', emoji: '🧬',
    categories: ['fat-loss', 'metabolic'],
    accent: '#f97316',
    headline: 'Scientists Found the Enzyme That Makes Fat Cells Refuse to Shrink With Age — 5-Amino 1MQ Blocks It',
    body: 'NNMT (nicotinamide N-methyltransferase) becomes overactive in aging fat cells. When it activates, fat cells enter a storage-only mode — they stop responding to caloric deficits, resist lipolysis, and generate new fat cells. This is the biological reason fat becomes harder to lose with age despite the same diet and exercise.\n\n5-Amino 1MQ inhibits NNMT directly. Research shows this restores youthful fat cell metabolism, prevents new fat cell formation, and makes existing fat cells responsive again to the energy deficit signals created by GLP-1 compounds. It is one of the only compounds that addresses WHY weight loss resistance happens — not just the symptom.',
    citation: 'Sampathkumar NK et al. NNMT inhibition as a strategy to enhance fat cell responsiveness. Cell Metab. 2020.',
    compoundKey: '5-Amino 1MQ'
  },
  {
    compound: 'AOD-9604', emoji: '🔥',
    categories: ['fat-loss'],
    accent: '#f97316',
    headline: 'AOD-9604: The Fat-Burning Fragment of Growth Hormone — All the Lipolysis, None of the Side Effects',
    body: 'Scientists at Monash University isolated the specific amino acid sequence of HGH responsible for fat metabolism — residues 176 to 191, the C-terminal fragment. The result is AOD-9604: all of HGH\'s lipolytic signal with none of its blood sugar, insulin resistance, or growth effects.\n\nThis means direct stimulation of fat cell breakdown (lipolysis) without the downsides of full growth hormone. Fasted morning injection triggers a clean fat metabolism window that synergizes with any GLP-1 compound in the stack — the GLP-1 suppresses appetite, AOD-9604 simultaneously signals the fat cells to release.',
    citation: 'Ng FM et al. Metabolic studies of a growth hormone fragment AOD9604. J Mol Endocrinol. 2000;24(3):391–400.',
    compoundKey: 'AOD-9604'
  },

  // ── IMMUNE ─────────────────────────────────────────────────
  {
    compound: 'Thymosin Alpha-1', emoji: '🛡️',
    categories: ['immune'],
    accent: '#34d399',
    headline: 'Thymosin Alpha-1 Is an Approved Drug in 35+ Countries — Studied Extensively in Cancer and Viral Infections',
    body: 'Thymosin Alpha-1 (sold as Zadaxin) is approved as a prescription pharmaceutical in over 35 countries for hepatitis B, hepatitis C, and as a cancer immunotherapy adjuvant. It has more published human clinical trial data than almost any other peptide in research use today.\n\nIt directly activates T-cells and natural killer cells, enhancing the adaptive immune response. Studies show it increases T-cell count and activity comparable to some chemotherapy support drugs — without their side effects. For aging clients, post-illness recovery, or anyone with a compromised immune system, it is the most evidence-backed immune peptide available.',
    citation: 'Goldstein AL, Goldstein AL. From lab to bedside: emerging clinical applications of thymosin alpha1. Expert Opin Biol Ther. 2009;9(5):593–608.',
    compoundKey: 'Thymosin Alpha-1'
  },
  {
    compound: 'LL-37', emoji: '🛡️',
    categories: ['immune', 'healing'],
    accent: '#34d399',
    headline: 'LL-37: Your Body\'s Natural Antibiotic — Kills Bacteria Through Membrane Disruption That Resistance Can\'t Beat',
    body: 'LL-37 is a human cathelicidin — an antimicrobial peptide produced by neutrophils and skin cells as the body\'s first-line biological antibiotic. Unlike conventional antibiotics that target specific bacterial enzymes, LL-37 physically disrupts bacterial membranes. Bacteria cannot develop resistance to membrane disruption the way they evolve resistance to enzyme inhibitors.\n\nLL-37 also has anti-biofilm activity — it penetrates and dissolves the protective matrices that allow persistent infections to survive antibiotic treatment. For wound healing, post-surgical infection prevention, and clients with recurrent or resistant infections, it represents a fundamentally different mechanism of antimicrobial defense.',
    citation: 'Zanetti M. Cathelicidins, multifunctional peptides of the innate immunity. J Leukoc Biol. 2004;75(1):39–48.',
    compoundKey: 'LL-37'
  },

  // ── SLEEP ──────────────────────────────────────────────────
  {
    compound: 'DSIP', emoji: '🌙',
    categories: ['sleep', 'cognitive'],
    accent: '#6366f1',
    headline: 'DSIP Was Isolated From Rabbit Brains During Sleep Research — It Specifically Triggers the Repair Stage of Sleep',
    body: 'Delta Sleep-Inducing Peptide was first isolated from rabbit brain tissue in 1977 when researchers noticed a factor in sleeping rabbits that could induce sleep in awake ones. The finding: a specific peptide that selectively promotes delta (slow-wave) sleep — the deepest stage, where human growth hormone is secreted, memories are consolidated, and cellular repair peaks.\n\nMost people with chronic stress, ADD, or aging spend too little time in delta sleep — compounding every other health issue. DSIP doesn\'t sedate you; it shifts your sleep architecture toward more time in the stages that actually restore you. Everything else in your stack works harder when DSIP is running.',
    citation: 'Schoenenberger GA, Monnier M. Characterization of a delta-electroencephalogram-sleep-inducing peptide. PNAS. 1977.',
    compoundKey: 'DSIP'
  },
  {
    compound: 'Pinealon', emoji: '🔮',
    categories: ['sleep', 'longevity'],
    accent: '#6366f1',
    headline: 'Your Pineal Gland Starts Calcifying at Age 17 — Pinealon Slows It Down',
    body: 'The pineal gland is responsible for melatonin production and circadian rhythm regulation. Starting at age 17, it begins calcifying — a progressive process that reduces melatonin output and destabilizes circadian timing with each passing decade. By middle age, many people\'s pineal glands are significantly calcified.\n\nPinealon is a peptide bioregulator developed by Russian longevity researcher Vladimir Khavinson that targets pineal tissue specifically. Research shows it can slow calcification, support melatonin rhythm restoration, and re-synchronize the body clock — directly improving sleep quality through the upstream source of circadian control rather than supplementing melatonin as an external band-aid.',
    citation: 'Khavinson VK et al. Peptide regulation of aging. Neuroendocrinol Lett. 2002;23(1):71–8.',
    compoundKey: 'Pinealon'
  },

  // ── MENOPAUSE ──────────────────────────────────────────────
  {
    compound: 'Kisspeptin', emoji: '⚡',
    categories: ['menopause', 'hormonal'],
    accent: '#f472b6',
    headline: 'Hot Flashes Are Driven by Kisspeptin Neurons — Modulating Them May Reduce Vasomotor Symptoms',
    body: 'Researchers identified that the hypothalamic neurons responsible for hot flashes are the same kisspeptin/NKB neurons that regulate reproductive hormone cycles. During menopause, as estrogen declines, these neurons become hyperactive — producing the vasomotor surges experienced as hot flashes.\n\nThis means kisspeptin is not just a fertility compound — it\'s directly tied to the most disruptive symptom of menopause. Research protocols modulating kisspeptin/NKB signalling have shown promise for reducing hot flash frequency and severity by targeting the mechanism, not just managing symptoms downstream.',
    citation: 'Rance NE et al. Modulation of body temperature and LH secretion by hypothalamic KNDy neurons. Front Neuroendocrinol. 2010;31(3):271–8.',
    compoundKey: 'Kisspeptin'
  },
  {
    compound: 'PT-141', emoji: '❤️',
    categories: ['menopause', 'libido'],
    accent: '#f472b6',
    headline: 'PT-141 Improved Desire and Arousal in Women With Hypoactive Sexual Desire Disorder',
    body: 'Hypoactive sexual desire disorder (HSDD) — loss of sexual desire — is the most common sexual complaint among women in the menopausal transition. A randomized placebo-controlled trial showed PT-141 produced significant improvements in desire and arousal in women with HSDD, including those with menopausal-related onset.\n\nUnlike lubricants or local estrogen therapy that address physical comfort, PT-141 addresses desire at the neurological source — the brain circuits that generate motivation for intimacy. It was subsequently FDA-approved as Vyleesi for premenopausal women with HSDD, making it one of the most clinically validated options in this category.',
    citation: 'Clayton AH et al. Bremelanotide for female sexual dysfunctions in premenopausal women. Womens Health. 2016;12(3):325–37.',
    compoundKey: 'PT-141'
  },

  // ── MITOCHONDRIA ───────────────────────────────────────────
  {
    compound: 'MOTS-C', emoji: '⚡',
    categories: ['mitochondria', 'metabolic'],
    accent: '#f59e0b',
    headline: 'MOTS-C Is Encoded in Mitochondrial DNA — One of the First Peptides Discovered Inside the Powerplant Itself',
    body: 'Almost every peptide in the human body is encoded in nuclear DNA. MOTS-C is different — it\'s encoded directly in mitochondrial DNA, making it a mitochondria-derived peptide (MDP) and one of the first of its kind ever discovered.\n\nMOTS-C activates AMPK, the master cellular energy sensor, and dramatically improves insulin sensitivity. Studies show it can reverse obesity-related insulin resistance in animal models without dietary changes. It is being studied as a potential treatment for type 2 diabetes, metabolic syndrome, and age-related muscle loss — conditions where mitochondrial dysfunction is central.',
    citation: 'Lee C et al. The mitochondrial-derived peptide MOTS-c promotes metabolic homeostasis and reduces obesity and insulin resistance. Cell Metab. 2015;21(3):443–54.',
    compoundKey: 'MOTS-C'
  },
  {
    compound: 'SLU-PP-332', emoji: '🏃',
    categories: ['mitochondria', 'fat-loss'],
    accent: '#f59e0b',
    headline: 'SLU-PP-332 Makes Your Body Think It Just Ran a Marathon — Without Moving',
    body: 'SLU-PP-332 activates ERR (estrogen-related receptors) — the same molecular cascade triggered by sustained aerobic exercise. Researchers describe it as an "exercise mimetic" that produces measurable improvements in endurance, mitochondrial density, and fat oxidation in the absence of physical activity.\n\nThe compound was specifically designed to study what exercise does to mitochondria at the molecular level — and in doing so, created a pathway to deliver those adaptations pharmacologically. For clients who cannot exercise due to injury, disease, or limitation, SLU-PP-332 activates the same metabolic adaptation that would otherwise require hours of weekly cardio.',
    citation: 'Zuercher WJ et al. Identification of ERRα agonists. J Med Chem. 2005.',
    compoundKey: 'SLU-PP-332'
  },

  // ── HORMONAL ───────────────────────────────────────────────
  {
    compound: 'CJC-1295 DAC', emoji: '⚡',
    categories: ['hormonal', 'longevity'],
    accent: '#f5c542',
    headline: 'CJC-1295 DAC Has an 8-Day Half-Life — One Injection Affects Your Pituitary for a Full Week and a Half',
    body: 'No other GHRH analogue comes close to the half-life of CJC-1295 DAC. The Drug Affinity Complex (DAC) binds the peptide to albumin in the bloodstream, giving it a sustained release profile that essentially converts your pituitary into a slow-release GH device.\n\nA single injection on Monday still drives GH output the following Tuesday. This makes it uniquely practical — and uniquely powerful. Because doses accumulate week over week, start low (100–200mcg) and build up. Marc takes 100mcg/week and feels it. The 2mg protocols you see online are for supervised clinical subjects — not the starting point for self-research.',
    citation: 'Jetté L et al. Human growth hormone-releasing factor (hGRF) analog with longer plasma half-life. J Endocrinol. 2005.',
    compoundKey: 'CJC-1295 DAC'
  },
  {
    compound: 'Ipamorelin', emoji: '🌙',
    categories: ['hormonal', 'longevity'],
    accent: '#f5c542',
    headline: 'Ipamorelin Is the Only GHRP That Produces Zero Cortisol or Prolactin Elevation — at Any Dose',
    body: 'Every other growth hormone releasing peptide — GHRP-2, GHRP-6, hexarelin — elevates cortisol and prolactin as a side effect of GH release. These hormonal side effects blunt the net benefit: cortisol breaks down muscle and raises blood sugar; prolactin disrupts sleep and libido.\n\nIpamorelin produces no cortisol elevation and no prolactin elevation at any tested dose. Researchers call it the "cleanest" GHRP ever studied — a selective GH secretagogue with no hormonal collateral damage. Taken before bed on an empty stomach, it amplifies the natural GH pulse during deep sleep with precision that no other compound matches.',
    citation: 'Raun K et al. Ipamorelin, the first selective growth hormone secretagogue. Eur J Endocrinol. 1998;139(5):552–61.',
    compoundKey: 'Ipamorelin'
  },

];

// ── Highlights State ──────────────────────────────────────────
let highlightsLoaded = false;
let currentHighlightCategory = 'all';

function loadHighlights() {
  if (!highlightsLoaded) {
    renderHighlights('all');
    highlightsLoaded = true;
  }
}

function filterHighlights(category, btn) {
  currentHighlightCategory = category;
  document.querySelectorAll('.hcat-pill').forEach(p => p.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderHighlights(category);
}

function renderHighlights(category) {
  const grid = document.getElementById('highlights-grid');
  if (!grid) return;

  const filtered = category === 'all'
    ? HIGHLIGHTS
    : HIGHLIGHTS.filter(h => h.categories.includes(category));

  if (filtered.length === 0) {
    grid.innerHTML = '<div class="highlights-empty">No highlights in this category yet. More coming soon.</div>';
    return;
  }

  grid.innerHTML = filtered.map(h => {
    const categoryLabels = {
      libido: '❤️ Libido & Sexual', fertility: '🌱 Fertility',
      hormonal: '⚡ Hormonal', healing: '🩹 Healing', cardiovascular: '❤️‍🔥 Cardiovascular',
      cognitive: '🧠 Cognitive', longevity: '⏳ Longevity', 'fat-loss': '🔥 Fat Loss',
      immune: '🛡️ Immune', sleep: '🌙 Sleep', menopause: '🌸 Menopause',
      metabolic: '🩺 Metabolic', mitochondria: '🔋 Mitochondria'
    };
    const badge = categoryLabels[h.categories[0]] || h.categories[0];
    // Format body: split on \n\n for paragraphs
    const paragraphs = h.body.split('\n\n').map(p => `<p style="margin:0 0 8px">${p}</p>`).join('');

    return `<div class="highlight-card" style="--card-accent:${h.accent}" onclick="goToCompound('${h.compoundKey}')">
      <div class="highlight-card-header">
        <span class="highlight-compound-emoji">${h.emoji}</span>
        <span class="highlight-compound-name">${h.compound}</span>
        <span class="highlight-category-badge">${badge}</span>
      </div>
      <div class="highlight-headline">${h.headline}</div>
      <div class="highlight-body">${paragraphs}</div>
      ${h.citation ? `<div class="highlight-citation">📄 ${h.citation}</div>` : ''}
      <div class="highlight-cta">Explore ${h.compound} →</div>
    </div>`;
  }).join('');
}

function goToCompound(compoundKey) {
  // Navigate to compounds page and open that compound
  showPage('compounds');
  // Small delay to let the page render, then open compound modal directly
  setTimeout(() => {
    const allData = typeof COMPOUND_DATA !== 'undefined' ? COMPOUND_DATA : [];
    const key = String(compoundKey || '').toLowerCase();

    // 1) Try exact ID match
    let match = allData.find(c => String(c.id || '').toLowerCase() === key);
    // 2) Try name match (e.g. "NAD+", "GHK-Cu")
    if (!match) match = allData.find(c => String(c.name || '').toLowerCase() === key);
    // 3) Partial match against name (e.g. "BPC-157" finds "BPC-157 (Body Protection Compound)")
    if (!match) match = allData.find(c =>
      String(c.name || '').toLowerCase().includes(key) ||
      key.includes(String(c.name || '').toLowerCase())
    );

    if (match && typeof openCompound === 'function') {
      openCompound(match.id);
    } else {
      // Fallback: filter the grid by the search term
      const searchEl = document.getElementById('compound-search');
      if (searchEl) {
        searchEl.value = compoundKey;
        searchEl.dispatchEvent(new Event('input'));
      }
    }
  }, 150);
}

// ═══════════════════════════════════════════════════════════
// SYMPTOM / GOAL SEARCH
// ═══════════════════════════════════════════════════════════

function initSymptomSearch() {
  // Focus textarea on page load
  setTimeout(() => {
    const el = document.getElementById('symptom-query');
    if (el) el.focus();
  }, 100);
}

function setSymptomQuery(text) {
  const el = document.getElementById('symptom-query');
  if (el) {
    el.value = text;
    el.focus();
    // Auto-run after a short delay for snappy UX
    setTimeout(() => runSymptomSearch(), 200);
  }
}

async function runSymptomSearch() {
  const query = (document.getElementById('symptom-query')?.value || '').trim();
  if (!query || query.length < 5) {
    showToast('Please describe your situation in a few words', 'error');
    return;
  }

  const btn = document.getElementById('symptom-search-btn');
  const btnText = document.getElementById('symptom-btn-text');
  const resultsEl = document.getElementById('symptom-results');

  // Loading state
  btn.disabled = true;
  btnText.textContent = 'Searching...';
  resultsEl.classList.remove('hidden');
  resultsEl.innerHTML = `<div class="ss-loading"><div class="ss-spinner"></div>Matching your situation to the research...</div>`;

  try {
    const resp = await fetch('/api/symptom-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query })
    });

    const data = await resp.json();

    if (!data.ok || !data.result) {
      resultsEl.innerHTML = `<div style="color:#e05a7a;padding:20px">Something went wrong. Please try again.</div>`;
      return;
    }

    renderSymptomResults(query, data.result);

  } catch (err) {
    resultsEl.innerHTML = `<div style="color:#e05a7a;padding:20px">Connection error. Please check your connection and try again.</div>`;
  } finally {
    btn.disabled = false;
    btnText.textContent = 'Find Compounds →';
  }
}

function renderSymptomResults(query, result) {
  const el = document.getElementById('symptom-results');

  const priorityColour = { Primary: '#d4af37', Supporting: '#7ac97a', Optional: '#818cf8' };
  const priorityEmoji  = { Primary: '⭐', Supporting: '➕', Optional: '💡' };

  const cards = (result.compounds || []).map((c, i) => {
    const colour = priorityColour[c.priority] || '#d4af37';
    const emoji  = priorityEmoji[c.priority]  || '⭐';
    const tags   = (c.tags || []).map(t => `<span class="ss-tag">${t}</span>`).join('');
    return `
      <div class="ss-compound-card" onclick="goToCompound('${c.name}')">
        <div class="ss-card-rank">${emoji} ${c.priority || 'Recommended'}</div>
        <div class="ss-card-name" style="color:${colour}">${c.name}</div>
        <div class="ss-card-why">${c.why}</div>
        ${tags ? `<div class="ss-card-tags">${tags}</div>` : ''}
        <div class="ss-card-cta">Explore ${c.name} →</div>
      </div>`;
  }).join('');

  const stackNote = result.stackNote
    ? `<div class="ss-stack-note"><strong>🔗 Stack note:</strong> ${result.stackNote}</div>`
    : '';

  el.innerHTML = `
    <div class="ss-query-echo">You searched: "${query}"</div>
    <div class="ss-intro">${result.intro || ''}</div>
    <div class="ss-compound-cards">${cards}</div>
    ${stackNote}
    <div class="ss-disclaimer-result">⚠️ ${result.disclaimer || 'For research purposes only. This is not medical advice. Consult a qualified healthcare professional before beginning any research protocol.'}</div>
  `;

  // Smooth scroll to results
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ─── Build by Goal ────────────────────────────────────────────

function switchOrderTab(tab) {
  const browsePanel = document.getElementById('order-tab-browse');
  const goalsPanel  = document.getElementById('order-tab-goals');
  const browseBtn   = document.getElementById('tab-browse');
  const goalsBtn    = document.getElementById('tab-goals');

  if (tab === 'browse') {
    browsePanel.style.display = '';
    goalsPanel.style.display  = 'none';
    browseBtn.style.borderBottom = '2px solid #3296a4';
    browseBtn.style.color        = '#3296a4';
    goalsBtn.style.borderBottom  = '2px solid transparent';
    goalsBtn.style.color         = '#545454';
  } else {
    browsePanel.style.display = 'none';
    goalsPanel.style.display  = '';
    goalsBtn.style.borderBottom  = '2px solid #3296a4';
    goalsBtn.style.color         = '#3296a4';
    browseBtn.style.borderBottom = '2px solid transparent';
    browseBtn.style.color        = '#545454';
    if (!document.getElementById('bbg-goal-cards').children.length) {
      initBuildByGoal();
    }
  }
}

function initBuildByGoal() {
  const goals = [
    { id: 'metabolic',  label: 'Metabolic Research',    emoji: '🔥', keywords: ['weight','fat','metabolic','insulin','GLP'] },
    { id: 'energy',     label: 'Energy & Performance',   emoji: '⚡', keywords: ['performance','athletic','bodybuilding','muscle','GH'] },
    { id: 'immune',     label: 'Immune Support',         emoji: '🛡️', keywords: ['immune','inflammation','defense','autoimmune'] },
    { id: 'skin',       label: 'Skin & Tissue',          emoji: '✨', keywords: ['anti-aging','antiaging','longevity','skin','collagen'] },
    { id: 'longevity',  label: 'Longevity',              emoji: '🌿', keywords: ['longevity','anti-aging','epitalon','nad','mitochondria'] },
    { id: 'cognitive',  label: 'Cognitive Enhancement',  emoji: '🧠', keywords: ['cognitive','mental','brain','focus','add','memory'] },
    { id: 'recovery',   label: 'Recovery & Repair',      emoji: '🩹', keywords: ['injury','recovery','healing','repair','tendon'] },
    { id: 'sleep',      label: 'Sleep & Rhythm',         emoji: '🌙', keywords: ['sleep','rhythm','circadian','menopause','hormonal'] }
  ];
  window._bbgGoals = goals;

  const grid = document.getElementById('bbg-goal-cards');
  grid.innerHTML = goals.map(g => `
    <div onclick='selectBbgGoal("${g.id}")'
         style='cursor:pointer;background:#f5f7f9;border:2px solid #e0e6ea;border-radius:10px;padding:14px 10px;text-align:center;transition:border-color 0.2s;'
         onmouseover='this.style.borderColor="#3296a4"' onmouseout='this.style.borderColor="#e0e6ea"'>
      <div style='font-size:28px;margin-bottom:6px;'>${g.emoji}</div>
      <div style='font-size:12px;font-weight:600;color:#1f2933;'>${g.label}</div>
    </div>
  `).join('');
}

function selectBbgGoal(goalId) {
  const goal = (window._bbgGoals || []).find(g => g.id === goalId);
  if (!goal) return;

  document.getElementById('bbg-goal-cards').style.display = 'none';
  document.getElementById('bbg-compounds').style.display  = '';
  document.getElementById('bbg-selected-goal-label').textContent = goal.emoji + ' ' + goal.label;

  const render = (stacks) => {
    const KLOW_EXPAND = ['KPV', 'BPC-157', 'GHK-Cu', 'TB-500'];
    const compoundCount = {};

    const expandCompound = (name) => {
      if (name.toUpperCase().startsWith('KLOW')) return KLOW_EXPAND;
      return [name];
    };

    const stackMatches = stacks.filter(s =>
      goal.keywords.some(kw => (s.goal || '').toLowerCase().includes(kw.toLowerCase()))
    );

    const collectFrom = (stackList) => {
      stackList.forEach(s => {
        const tiers = s.tiers || {};
        ['starter', 'intermediate', 'advanced'].forEach(tier => {
          const compounds = (tiers[tier] && tiers[tier].compounds) ? tiers[tier].compounds : [];
          compounds.forEach(c => {
            expandCompound(c).forEach(name => {
              compoundCount[name] = (compoundCount[name] || 0) + 1;
            });
          });
        });
      });
    };

    if (stackMatches.length > 0) {
      collectFrom(stackMatches);
    } else {
      // Fallback: all intermediate compounds from all stacks
      stacks.forEach(s => {
        const tiers = s.tiers || {};
        const compounds = (tiers.intermediate && tiers.intermediate.compounds) ? tiers.intermediate.compounds : [];
        compounds.forEach(c => {
          expandCompound(c).forEach(name => {
            compoundCount[name] = (compoundCount[name] || 0) + 1;
          });
        });
      });
    }

    const ranked = Object.entries(compoundCount)
      .map(([name, count]) => ({ name, relevance: count >= 2 ? 'HIGH' : 'MEDIUM' }))
      .sort((a, b) => (a.relevance === 'HIGH' ? -1 : 1) || a.name.localeCompare(b.name));

    const list = document.getElementById('bbg-compound-list');
    if (!ranked.length) {
      list.innerHTML = '<p style="color:#888;font-size:13px;">No compounds found for this goal.</p>';
      return;
    }

    list.innerHTML = ranked.map(({ name, relevance }) => {
      const isHigh = relevance === 'HIGH';
      const badgeBg    = isHigh ? '#eaf6f8' : '#f5f7f9';
      const badgeColor = isHigh ? '#3296a4' : '#888';
      const safeName = name.replace(/"/g, '&quot;');
      return `
        <div style='display:flex;align-items:center;justify-content:space-between;background:#fff;border:1px solid #e0e6ea;border-radius:8px;padding:10px 14px;'>
          <div>
            <span style='font-weight:600;font-size:14px;color:#1f2933;'>${name}</span>
            <span style='margin-left:8px;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;background:${badgeBg};color:${badgeColor};'>${relevance}</span>
          </div>
          <button onclick='bbgAddCompound("${safeName}")' style='background:#3296a4;color:#fff;border:none;border-radius:6px;padding:6px 14px;cursor:pointer;font-weight:600;font-size:13px;'>Add</button>
        </div>
      `;
    }).join('');
  };

  if (window._bbgStackCache) {
    render(window._bbgStackCache);
  } else {
    fetch('/api/stack-library')
      .then(r => r.json())
      .then(data => {
        window._bbgStackCache = data.stacks || [];
        render(window._bbgStackCache);
      })
      .catch(() => {
        document.getElementById('bbg-compound-list').innerHTML =
          '<p style="color:#c00;font-size:13px;">Failed to load stack library.</p>';
      });
  }
}

function bbgAddCompound(compoundName) {
  const nameLower = compoundName.toLowerCase();
  const match = (products || []).find(p =>
    p.name.toLowerCase().includes(nameLower) ||
    nameLower.includes(p.name.toLowerCase()) ||
    (p.sku && p.sku.toLowerCase().includes(nameLower.replace(/[^a-z0-9]/g, '')))
  );
  if (match) {
    quickAddById(match.id);
    showToast(compoundName + ' added to order', 'success');
  } else {
    showToast('Compound not in current catalog', 'info');
  }
}

function clearBbgSelection() {
  document.getElementById('bbg-goal-cards').style.display = '';
  document.getElementById('bbg-compounds').style.display  = 'none';
  document.getElementById('bbg-compound-list').innerHTML  = '';
}

// ═══════════════════════════════════════════════════════════
// STACKS-AS-PRODUCTS  (added 2026-04-19)
// Search-time stack discovery + stack detail modal
// ═══════════════════════════════════════════════════════════

let _stackSearchToken = 0;
const SHOW_DRAFT_STACKS = true; // flip to false once Marc activates real stacks

async function appendStackSearchResults(query) {
  const token = ++_stackSearchToken;
  const resultsEl = document.getElementById('product-quick-results');
  if (!query || !resultsEl) return;
  let data;
  try {
    const url = '/api/search?q=' + encodeURIComponent(query) + (SHOW_DRAFT_STACKS ? '&showDraft=1' : '');
    const res = await fetch(url);
    if (!res.ok) return;
    data = await res.json();
  } catch { return; }
  // Race-condition guard — newer query already fired
  if (token !== _stackSearchToken) return;
  if (!data.stacks_containing || data.stacks_containing.length === 0) {
    // Clean up "No direct..." placeholder if direct matches returned 0 and stacks also returned 0
    const empty = document.getElementById('qr-empty-msg');
    if (empty) empty.textContent = 'No products or stacks found for "' + query + '"';
    return;
  }
  // If the only thing in the panel is the empty-message placeholder, replace it
  const empty = document.getElementById('qr-empty-msg');
  if (empty) empty.remove();
  const stackHtml = `
    <div class="qr-stacks-section">
      <div class="qr-stacks-label">🧬 Found in stacks (${data.stacks_containing.length})</div>
      ${data.stacks_containing.map(hit => {
        const s = hit.stack;
        const matched = (hit.matched_compounds || []).map(c => `<span class="qr-match-pill">${c}</span>`).join('');
        const draftBadge = s.draft ? '<span class="qr-stack-draft">DRAFT</span>' : '';
        const price = s.price_cents ? '$' + (s.price_cents / 100).toFixed(2) : '';
        return `
          <div class="quick-result-stack" onclick="openStackDetail('${s.id}')">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;">
              <div class="qr-stack-name"><span class="qr-stack-emoji">${s.emoji || '🧬'}</span>${s.name}${draftBadge}</div>
              <span style="font-size:13px;font-weight:800;color:#047857;">${price}</span>
            </div>
            <div class="qr-stack-tagline">${s.tagline || ''}</div>
            ${matched ? `<div class="qr-stack-matched">Matches: ${matched}</div>` : ''}
          </div>`;
      }).join('')}
    </div>`;
  resultsEl.insertAdjacentHTML('beforeend', stackHtml);
}

async function openStackDetail(stackId) {
  const modal = document.getElementById('stack-detail-modal');
  const headerEl = document.getElementById('stack-detail-header');
  const bodyEl   = document.getElementById('stack-detail-body');
  if (!modal) return;
  modal.classList.remove('hidden');
  headerEl.innerHTML = '<div style="font-size:14px;color:#6b7280;">Loading stack…</div>';
  bodyEl.innerHTML = '';
  let data;
  try {
    const res = await fetch('/api/vitalis-stacks/' + encodeURIComponent(stackId));
    if (!res.ok) throw new Error('not found');
    data = await res.json();
  } catch {
    headerEl.innerHTML = '<div style="color:#b91c1c;">Stack not found.</div>';
    return;
  }
  const s = data.stack;
  const price = s.price_cents ? '$' + (s.price_cents / 100).toFixed(2) : '$—';
  headerEl.innerHTML = `
    <h2 class="sd-header-name">${s.emoji || '🧬'} ${s.name}</h2>
    <div class="sd-header-tagline">${s.tagline || ''}</div>
    <div class="sd-header-meta">
      <span class="sd-price">${price}</span>
      <span class="sd-cycle">${s.cycle_weeks || '—'}-week cycle</span>
      ${s.draft ? '<span class="qr-stack-draft">DRAFT — pending Marc review</span>' : ''}
    </div>`;
  const useCases = (s.use_cases || []).map(u => `<span class="sd-use-case-pill">${u}</span>`).join('');
  const contraindications = (s.contraindications || []).map(c => `<li>${c}</li>`).join('');
  const compoundRows = (s.compounds || []).map((c, idx) => {
    const research = c.research || {};
    const researchCell = research.exists
      ? `<div><a class="sd-research-link" onclick="toggleStackResearch(${idx})">View research brief →</a><div id="sd-research-${idx}" class="sd-research-detail" style="display:none;"></div></div>`
      : `<div class="sd-research-pending">Research pending — brief not yet authored.</div>`;
    return `
      <tr>
        <td>
          <div class="sd-compound-name">${c.name}</div>
          ${c.aliases ? `<div class="sd-compound-aliases">${c.aliases}</div>` : ''}
        </td>
        <td>${c.dose_label || '—'}</td>
        <td>${c.frequency || '—'}</td>
        <td>${c.route || '—'}</td>
        <td>${c.duration_days ? c.duration_days + ' days' : '—'}</td>
        <td>${researchCell}</td>
      </tr>`;
  }).join('');
  // Cache research bodies for toggle
  window._sdResearchCache = (s.compounds || []).map(c => c.research || {});
  bodyEl.innerHTML = `
    ${s.draft ? '<div class="sd-draft-banner">⚠️ DRAFT — pending Marc\'s medical review. Doses, choices, and pricing are placeholders.</div>' : ''}
    <div class="sd-section">
      <h3>Use cases</h3>
      <div class="sd-use-cases">${useCases || '<em style="color:#9ca3af">—</em>'}</div>
    </div>
    <div class="sd-section">
      <h3>Compounds & dosing</h3>
      <div style="overflow-x:auto;">
        <table class="sd-compound-table">
          <thead><tr><th>Compound</th><th>Dose</th><th>Frequency</th><th>Route</th><th>Duration</th><th>Research</th></tr></thead>
          <tbody>${compoundRows}</tbody>
        </table>
      </div>
    </div>
    <div class="sd-section">
      <h3>Combined research synthesis (T4)</h3>
      <div class="sd-synthesis">${s.research_summary || '—'}</div>
    </div>
    <div class="sd-section">
      <h3>Contraindications</h3>
      <div class="sd-contraindications"><ul>${contraindications || '<li>—</li>'}</ul></div>
    </div>
    <button class="sd-add-to-order" onclick="addStackToOrder('${s.id}')">➕ Add ${s.name} to order — ${price}</button>
  `;
}

function toggleStackResearch(idx) {
  const el = document.getElementById('sd-research-' + idx);
  if (!el) return;
  if (el.style.display === 'none') {
    const r = (window._sdResearchCache || [])[idx] || {};
    const tiers = r.tiers || {};
    const sections = ['T1','T2','T3','T4'].map(t => {
      if (!tiers[t]) return '';
      return `<div style="margin-top:8px;"><span class="tier-label">${t}</span><span style="white-space:pre-wrap;">${escapeHtml(tiers[t])}</span></div>`;
    }).join('');
    el.innerHTML = sections || `<em>${escapeHtml(r.summary || 'No tier-tagged sections found.')}</em>`;
    el.style.display = 'block';
  } else {
    el.style.display = 'none';
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[ch]);
}

function closeStackDetail() {
  const modal = document.getElementById('stack-detail-modal');
  if (modal) modal.classList.add('hidden');
}

function addStackToOrder(stackId) {
  // Add stack as a single bundled order line. Marc may later choose to expand.
  fetch('/api/vitalis-stacks/' + encodeURIComponent(stackId))
    .then(r => r.json())
    .then(({ stack }) => {
      if (!stack) return showToast('Stack not found', 'error');
      const msrp = (stack.price_cents || 0) / 100;
      orderLines.push({
        id: 'stack:' + stack.id,
        name: stack.name + ' (Stack)',
        sku: stack.slug || stack.id,
        msrp,
        cost: 0,
        margin: 0,
        profit: 0,
        qty: 1,
        lineTotal: msrp,
        lineCost: 0,
        discountAllowed: false,
        maxDiscountPct: 0,
        discountPct: 0,
        discountedPrice: msrp,
        is_stack: true,
        stack_compounds: (stack.compounds || []).map(c => c.name)
      });
      closeStackDetail();
      renderOrderLines();
      showToast('✓ ' + stack.name + ' added to order', 'success');
    })
    .catch(() => showToast('Failed to add stack', 'error'));
}
