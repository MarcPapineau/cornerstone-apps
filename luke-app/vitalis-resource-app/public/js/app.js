/* app.js — Vitalis Peptide Resource App SPA.
   Vanilla JS, no build step. The server holds the source of truth + gates; this is the view. */

// ---- helpers ---------------------------------------------------------------
async function api(path, { method = 'GET', body } = {}) {
  const opts = { method, headers: {} };
  if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const res = await fetch('/api' + path, opts);
  return res.json();
}
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const view = () => $('#view');
const mount = (html) => { view().innerHTML = html; };
const fmt = (n, d = 1) => (n == null || Number.isNaN(n) ? '—' : Number(n).toFixed(d));

const STATUS_CLASS = {
  SOURCED: 'b-green', ALLOWED_RESOURCE: 'b-green', IN_RANGE: 'b-green', LIVE: 'b-green', SUCCESS: 'b-green', REVIEWED: 'b-green', APPROVED_RESOURCE: 'b-green', AVAILABLE: 'b-green',
  NEEDS_REVIEW: 'b-amber', DRAFT: 'b-amber', NEEDS_ADJUSTMENT: 'b-amber', NEEDS_SOURCE: 'b-amber', PENDING: 'b-amber',
  BLOCKED: 'b-red', FAILURE: 'b-red', OUT_OF_RANGE_LOW: 'b-red', OUT_OF_RANGE_HIGH: 'b-red', DISCONTINUED: 'b-red',
  UNKNOWN: 'b-gray', STUB: 'b-gray', NO_RANGE: 'b-gray', EMPTY: 'b-gray', PLANNED: 'b-gray',
};
const badge = (status, label) => `<span class="badge ${STATUS_CLASS[status] || 'b-gray'}"><span class="bdot"></span>${esc(label || status)}</span>`;
const routeBadge = (route) => route ? `<span class="badge b-teal">${esc(route)}</span>` : badge('UNKNOWN', 'UNKNOWN');

// ---- state -----------------------------------------------------------------
const state = { clients: [], catalog: [], meta: null };
let selectedClientId = localStorage.getItem('vitalis.client') || null;
const setClient = (id) => { selectedClientId = id || null; if (id) localStorage.setItem('vitalis.client', id); };

async function loadClients() { const r = await api('/clients'); state.clients = r.clients || []; if (!selectedClientId && state.clients[0]) setClient(state.clients[0].id); }
async function loadCatalog() { if (state.catalog.length) return; const r = await api('/catalog'); state.catalog = r.products || []; }

function clientSelector() {
  if (!state.clients.length) return '<div class="callout gray">No clients yet — add one on the Clients screen.</div>';
  return `<div class="field" style="max-width:340px;margin-bottom:18px"><label>Client</label>
    <select id="clientSel">${state.clients.map((c) => `<option value="${c.id}" ${c.id === selectedClientId ? 'selected' : ''}>${esc(c.name)}${c._demo ? ' (demo)' : ''}</option>`).join('')}</select></div>`;
}
function wireClientSelector() { const s = $('#clientSel'); if (s) s.onchange = (e) => { setClient(e.target.value); go(); }; }

// ===========================================================================
// SCREEN 1 — Dashboard
// ===========================================================================
async function screenDashboard() {
  mount('<div class="loading">Loading dashboard…</div>');
  const d = await api('/dashboard');
  const c = d.counts;
  const card = (label, value, sub, cls = '') => `<div class="card stat"><span class="label">${label}</span><span class="value ${cls}">${value}</span><span class="sub">${sub}</span></div>`;
  mount(`
    <div class="cards">
      ${card('Clients', c.clients, 'profiles on file')}
      ${card('Draft protocols', c.draftProtocols, 'resource-only drafts', c.draftProtocols ? 'warn' : '')}
      ${card('Pending labs', c.pendingLabs, 'clients without labs')}
      ${card('Flagged labs', c.flaggedLabs, 'values out of range', c.flaggedLabs ? 'warn' : '')}
      ${card('Compliance warnings', c.complianceWarnings, 'items needing review', c.complianceWarnings ? 'warn' : '')}
      ${card('Research gaps', c.researchGaps, 'items with UNKNOWN evidence', c.researchGaps ? 'bad' : '')}
    </div>
    <div class="panel" style="margin-top:22px">
      <div class="panel-head">Operating posture</div>
      <div class="panel-body">
        <div class="callout">${esc(d.disclaimer)}</div>
        <div class="kv" style="margin-top:14px">
          <dt>Demo data</dt><dd>${d.demo.ok ? badge('LIVE', `${d.demo.clientCount} demo clients loaded`) : badge('BLOCKED', 'none')} ${d.demo.allFlaggedDemo ? '<span class="tag-demo">all marked _demo</span>' : ''}</dd>
          <dt>Default jurisdiction</dt><dd>${badge('ALLOWED_RESOURCE', 'Canada')} <span class="faint small">US is config-driven (state-by-state, defaults UNKNOWN)</span></dd>
          <dt>Gate model</dt><dd class="small muted">source-of-truth → research gate → compliance gate → draft → review scorecard</dd>
        </div>
      </div>
    </div>`);
}

// ===========================================================================
// SCREEN 2 — Clients (intake)
// ===========================================================================
async function screenClients() {
  await loadClients();
  const rows = state.clients.map((c) => `
    <tr>
      <td><strong>${esc(c.name)}</strong> ${c._demo ? '<span class="tag-demo">DEMO</span>' : ''}</td>
      <td>${c.age ?? '—'}</td><td>${esc(c.sex || '—')}</td>
      <td class="num">${fmt(c.weightKg)}</td><td class="num">${fmt(c.bodyFatPct)}</td><td class="num">${fmt(c.leanMassKg)}</td>
      <td>${(c.goals || []).map((g) => `<span class="chip">${esc(g)}</span>`).join(' ') || '—'}</td>
      <td class="row-actions">
        <button class="btn ghost sm" data-open="${c.id}">Select</button>
        ${c._demo ? '' : `<button class="btn ghost sm" data-del="${c.id}">Delete</button>`}
      </td>
    </tr>`).join('');
  mount(`
    <div class="two-col">
      <div class="panel">
        <div class="panel-head">New client intake</div>
        <div class="panel-body">
          <div class="form-grid">
            <div class="field full"><label>Name / handle</label><input id="f-name" placeholder="e.g. Demo — A. Client" /></div>
            <div class="field"><label>Age</label><input id="f-age" type="number" /></div>
            <div class="field"><label>Sex</label><select id="f-sex"><option value="">—</option><option>male</option><option>female</option><option>other</option></select></div>
            <div class="field"><label>Weight (kg)</label><input id="f-weight" type="number" step="0.1" /></div>
            <div class="field"><label>Body fat %</label><input id="f-bf" type="number" step="0.1" /></div>
            <div class="field"><label>Lean mass (kg)</label><input id="f-lean" type="number" step="0.1" /></div>
            <div class="field"><label>Goals (comma-sep)</label><input id="f-goals" placeholder="Fat loss, Recovery" /></div>
            <div class="field full"><label>Contraindications (comma-sep)</label><input id="f-contra" placeholder="None reported" /></div>
            <div class="field full"><label>Current products (comma-sep)</label><input id="f-products" placeholder="BPC-157 5mg/vial" /></div>
            <div class="field full"><label>Notes</label><textarea id="f-notes"></textarea></div>
          </div>
          <div class="btn-row"><button class="btn" id="saveClient">Add client</button><span class="faint small">Stored locally · resource use only</span></div>
        </div>
      </div>
      <div class="panel">
        <div class="panel-head">Clients <span class="faint small">${state.clients.length} on file · selected: ${esc((state.clients.find((c) => c.id === selectedClientId) || {}).name || 'none')}</span></div>
        <div class="panel-body tight">
          <table><thead><tr><th>Name</th><th>Age</th><th>Sex</th><th class="num">Wt</th><th class="num">BF%</th><th class="num">Lean</th><th>Goals</th><th></th></tr></thead>
          <tbody>${rows || '<tr><td colspan="8" class="empty">No clients yet.</td></tr>'}</tbody></table>
        </div>
      </div>
    </div>`);
  const csv = (id) => ($('#' + id).value || '').split(',').map((s) => s.trim()).filter(Boolean);
  $('#saveClient').onclick = async () => {
    const body = {
      name: $('#f-name').value || 'Unnamed client', age: $('#f-age').value, sex: $('#f-sex').value,
      weightKg: $('#f-weight').value, bodyFatPct: $('#f-bf').value, leanMassKg: $('#f-lean').value,
      goals: csv('f-goals'), contraindications: csv('f-contra'), currentProducts: csv('f-products'), notes: $('#f-notes').value,
    };
    const r = await api('/clients', { method: 'POST', body });
    if (r.ok) { setClient(r.client.id); await loadClients(); screenClients(); }
  };
  $$('[data-open]').forEach((b) => b.onclick = () => { setClient(b.dataset.open); screenClients(); });
  $$('[data-del]').forEach((b) => b.onclick = async () => { await api('/clients/' + b.dataset.del, { method: 'DELETE' }); await loadClients(); screenClients(); });
}

// ===========================================================================
// SCREEN 3 — Lab panel builder
// ===========================================================================
let labPanelProducts = [];
async function screenLabPanels() {
  await loadClients(); await loadCatalog();
  const client = state.clients.find((c) => c.id === selectedClientId);
  if (labPanelProducts.length === 0 && client) labPanelProducts = (client.currentProducts || []).slice();
  const q = encodeURIComponent(labPanelProducts.join('|'));
  const d = await api('/lab-panels?products=' + q);
  const baselineSections = (d.baseline.sections || []).map((s) => `
    <tr><td style="white-space:nowrap"><strong>${esc(s.section)}</strong></td><td>${(s.markers || []).map((m) => `<span class="chip">${esc(m)}</span>`).join(' ')}</td></tr>`).join('');
  const optional = d.optional.map((p) => `
    <tr>
      <td><strong>${esc(p.label)}</strong></td>
      <td>${badge(p.status)}</td>
      <td>${p.status === 'NEEDS_SOURCE' ? `<span class="faint small">${esc(p.message || 'Markers not enumerated in source — not invented.')}</span>` : ((p.markers || []).map((m) => `<span class="chip">${esc(m)}</span>`).join(' ') || '<span class="faint small">—</span>')}</td>
    </tr>`).join('');
  const picker = state.catalog.slice(0, 0); // not used; we pick from currentProducts + free add
  mount(`
    ${clientSelector()}
    <div class="panel">
      <div class="panel-head">Baseline — ${esc(d.baseline.label)} ${badge(d.baseline.status)}</div>
      <div class="panel-body tight"><table><thead><tr><th>Section</th><th>Markers</th></tr></thead><tbody>${baselineSections}</tbody></table></div>
    </div>
    <div class="panel">
      <div class="panel-head">Optional panels</div>
      <div class="panel-body tight"><table><thead><tr><th>Panel</th><th>Status</th><th>Markers</th></tr></thead><tbody>${optional}</tbody></table></div>
    </div>
    <div class="panel">
      <div class="panel-head">Peptide safety-monitoring driver <span class="faint small">markers layer on top of baseline by selected compound</span></div>
      <div class="panel-body">
        <label>Selected products feeding the dynamic safety panel</label>
        <div class="chips" id="lpChips" style="margin:8px 0 12px">${labPanelProducts.map((p) => `<span class="chip sel" data-rm="${esc(p)}">${esc(p)} ✕</span>`).join('') || '<span class="faint small">none</span>'}</div>
        <div class="field" style="max-width:420px"><label>Add a catalog product</label>
          <select id="lpAdd"><option value="">— choose —</option>${state.catalog.map((p) => `<option>${esc(p.name)}</option>`).join('')}</select></div>
      </div>
    </div>`);
  wireClientSelector();
  $('#lpAdd').onchange = (e) => { if (e.target.value && !labPanelProducts.includes(e.target.value)) { labPanelProducts.push(e.target.value); screenLabPanels(); } };
  $$('[data-rm]').forEach((c) => c.onclick = () => { labPanelProducts = labPanelProducts.filter((x) => x !== c.dataset.rm); screenLabPanels(); });
}

// ===========================================================================
// SCREEN 4 — Lab results tracker
// ===========================================================================
let labRows = [{ marker: '', value: '', unit: '', refLow: '', refHigh: '' }];
async function screenLabResults() {
  await loadClients();
  const r = selectedClientId ? await api('/lab-results?clientId=' + selectedClientId) : { results: [] };
  const resultPanels = (r.results || []).map((res) => `
    <div class="panel">
      <div class="panel-head">${esc((res.panelId || 'panel'))} <span class="faint small">drawn ${esc((res.id || '').includes('demo') ? 'demo' : '')}</span> ${res.hasFlags ? badge('NEEDS_REVIEW', `${res.flags.length} flagged`) : badge('IN_RANGE', 'all in range')}</div>
      <div class="panel-body tight"><table><thead><tr><th>Marker</th><th class="num">Value</th><th>Unit</th><th class="num">Ref range</th><th>Flag</th></tr></thead>
      <tbody>${res.values.map((v) => `<tr>
        <td>${esc(v.marker)}</td><td class="num">${fmt(v.value, 2)}</td><td>${esc(v.unit || '—')}</td>
        <td class="num">${v.refLow ?? '—'}–${v.refHigh ?? '—'}</td>
        <td>${v.flag === 'IN_RANGE' ? badge('IN_RANGE', 'in range') : (v.flag === 'NO_RANGE' ? badge('NO_RANGE', 'no range') : `${badge(v.flag, v.flag.replace('OUT_OF_RANGE_', 'out · '))}<div class="faint small">${esc(v.action || '')}</div>`)}</td>
      </tr>`).join('')}</tbody></table></div>
    </div>`).join('');
  const rowInputs = labRows.map((row, i) => `
    <tr>
      <td><input data-i="${i}" data-k="marker" value="${esc(row.marker)}" placeholder="Vitamin D" /></td>
      <td><input data-i="${i}" data-k="value" type="number" step="0.01" value="${esc(row.value)}" style="width:90px" /></td>
      <td><input data-i="${i}" data-k="unit" value="${esc(row.unit)}" placeholder="nmol/L" style="width:90px" /></td>
      <td><input data-i="${i}" data-k="refLow" type="number" step="0.01" value="${esc(row.refLow)}" style="width:80px" /></td>
      <td><input data-i="${i}" data-k="refHigh" type="number" step="0.01" value="${esc(row.refHigh)}" style="width:80px" /></td>
      <td><button class="btn ghost sm" data-rmrow="${i}">✕</button></td>
    </tr>`).join('');
  mount(`
    ${clientSelector()}
    <div class="panel">
      <div class="panel-head">Add a lab draw <span class="faint small">reference ranges are the report's own — out-of-range = "review with provider", never a diagnosis</span></div>
      <div class="panel-body">
        <div class="field" style="max-width:240px;margin-bottom:12px"><label>Panel</label><input id="lr-panel" value="baseline" /></div>
        <table><thead><tr><th>Marker</th><th>Value</th><th>Unit</th><th>Ref low</th><th>Ref high</th><th></th></tr></thead><tbody>${rowInputs}</tbody></table>
        <div class="btn-row"><button class="btn ghost sm" id="addRow">+ add marker</button><button class="btn" id="saveLab" ${selectedClientId ? '' : 'disabled'}>Save draw</button></div>
      </div>
    </div>
    <h3 class="block-title">Recorded results over time</h3>
    ${resultPanels || '<div class="empty">No lab results recorded for this client.</div>'}`);
  wireClientSelector();
  $$('[data-k]').forEach((inp) => inp.oninput = () => { labRows[inp.dataset.i][inp.dataset.k] = inp.value; });
  $('#addRow').onclick = () => { labRows.push({ marker: '', value: '', unit: '', refLow: '', refHigh: '' }); screenLabResults(); };
  $$('[data-rmrow]').forEach((b) => b.onclick = () => { labRows.splice(+b.dataset.rmrow, 1); if (!labRows.length) labRows = [{ marker: '', value: '', unit: '', refLow: '', refHigh: '' }]; screenLabResults(); });
  $('#saveLab').onclick = async () => {
    const values = labRows.filter((r) => r.marker).map((r) => ({ marker: r.marker, value: r.value, unit: r.unit, refLow: r.refLow, refHigh: r.refHigh }));
    if (!values.length) return;
    await api('/lab-results', { method: 'POST', body: { clientId: selectedClientId, panelId: $('#lr-panel').value || 'baseline', values } });
    labRows = [{ marker: '', value: '', unit: '', refLow: '', refHigh: '' }];
    screenLabResults();
  };
}

// ===========================================================================
// SCREEN 5 — Source-of-truth catalog
// ===========================================================================
async function screenCatalog() {
  await loadCatalog();
  mount(`
    <div class="section-head"><div class="field" style="max-width:360px"><label>Search catalog</label><input id="catSearch" placeholder="bpc, retatrutide, mots…" /></div>
    <span class="faint small">${state.catalog.length} products · route/form derived from source · UNKNOWN where not determinable</span></div>
    <div class="panel"><div class="panel-body tight"><table>
      <thead><tr><th>Product</th><th>Category</th><th>Form</th><th>Route</th><th class="num">Strength</th><th>Availability</th><th>Evidence</th></tr></thead>
      <tbody id="catBody"></tbody></table></div></div>`);
  const render = (list) => {
    $('#catBody').innerHTML = list.map((p) => `
      <tr>
        <td><strong>${esc(p.name)}</strong>${p.supplier ? `<div class="faint small">${esc(p.supplier)}</div>` : ''}</td>
        <td>${esc(p.category || '—')}</td>
        <td class="small">${esc(p.form || '—')}</td>
        <td>${routeBadge(p.route)}</td>
        <td class="num">${esc(p.strengthLabel || (p.strengthMg ? p.strengthMg + 'mg' : '—'))}</td>
        <td>${badge(p.availability)}</td>
        <td>${p.evidenceCompoundId ? `<a class="link" href="#research" data-ev="${esc(p.evidenceCompoundId)}">${esc(p.evidenceCompoundId)}</a>` : badge('UNKNOWN', 'no corpus link')}</td>
      </tr>`).join('') || '<tr><td colspan="7" class="empty">No matches.</td></tr>';
  };
  render(state.catalog);
  $('#catSearch').oninput = (e) => { const q = e.target.value.toLowerCase().replace(/[^a-z0-9]/g, ''); render(state.catalog.filter((p) => p.name.toLowerCase().replace(/[^a-z0-9]/g, '').includes(q))); };
}

// ===========================================================================
// SCREEN 6 — Research gate
// ===========================================================================
async function screenResearch() {
  const r = await api('/evidence');
  const idx = (r.index || []).sort((a, b) => (b.citationCount || 0) - (a.citationCount || 0));
  mount(`
    <div class="two-col">
      <div>
        <div class="panel">
          <div class="panel-head">Live lookup <span class="faint small">PubMed + ClinicalTrials.gov</span></div>
          <div class="panel-body">
            <div class="field"><label>Search term</label><input id="lkTerm" placeholder="tesamorelin" /></div>
            <div class="btn-row"><button class="btn" id="lkGo">Look up</button></div>
            <div id="lkOut" style="margin-top:12px"></div>
          </div>
        </div>
      </div>
      <div class="panel">
        <div class="panel-head">Evidence corpus <span class="faint small">${idx.length} compounds · citations verbatim from source</span></div>
        <div class="panel-body tight"><table><thead><tr><th>Compound</th><th>Level</th><th class="num">Citations</th></tr></thead>
        <tbody>${idx.map((e) => `<tr class="clickable" data-ev="${esc(e.compoundId)}"><td><strong>${esc(e.name)}</strong></td><td>${badge(e.evidenceLevel)}</td><td class="num">${e.citationCount}</td></tr>`).join('')}</tbody></table></div>
      </div>
    </div>
    <div id="evDetail" style="margin-top:18px"></div>`);
  const showDetail = async (id) => {
    const d = await api('/evidence/' + id); const g = d.research;
    $('#evDetail').innerHTML = `<div class="panel"><div class="panel-head">${esc(id)} ${badge(g.level)}</div><div class="panel-body">
      ${g.level === 'UNKNOWN' ? `<div class="callout gray">${esc(g.message)}</div>` : `
      <div class="kv">
        <dt>Mechanism</dt><dd>${esc(g.mechanism || '—')}</dd>
        <dt>Clinical trial</dt><dd>${g.hasClinicalTrial ? badge('LIVE', 'trial cited') : badge('UNKNOWN', 'none cited')}</dd>
        <dt>Recommendation</dt><dd class="muted small">This app never recommends — evidence is surfaced for a provider decision.</dd>
      </div>
      ${(g.contraindicationFlags || []).length ? `<div class="callout warn" style="margin-top:12px">${g.contraindicationFlags.map(esc).join(' · ')}</div>` : ''}
      <h3 class="block-title">Citations (${g.citationCount})</h3>
      <table><thead><tr><th>Title</th><th>Source</th><th>Type</th></tr></thead><tbody>${(g.citations || []).map((c) => `<tr><td>${c.url ? `<a class="link" href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.title || c.url)}</a>` : esc(c.title || '—')}</td><td class="small">${esc(c.source || '—')}</td><td>${badge(c.type === 'ClinicalTrial' ? 'LIVE' : 'UNKNOWN', c.type)}</td></tr>`).join('')}</tbody></table>`}
    </div></div>`;
  };
  $$('[data-ev]').forEach((el) => el.onclick = (e) => { e.preventDefault(); showDetail(el.dataset.ev); });
  $('#lkGo').onclick = async () => {
    const term = $('#lkTerm').value.trim(); if (!term) return;
    $('#lkOut').innerHTML = '<div class="loading">Querying…</div>';
    const out = (await api('/research/lookup', { method: 'POST', body: { term } })).lookup;
    const block = (src) => `<h3 class="block-title">${esc(src.source)} ${badge(src.status)}</h3>${src.message ? `<div class="callout gray small">${esc(src.message)}</div>` : (src.results || []).map((x) => `<div class="small" style="padding:5px 0;border-bottom:1px solid var(--line)"><a class="link" href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title || x.nctId || x.pmid)}</a> ${x.status ? badge('LIVE', x.status) : ''}</div>`).join('')}`;
    $('#lkOut').innerHTML = block(out.pubmed) + block(out.clinicaltrials) + block(out.healthcanada_dpd) + block(out.openfda);
  };
  const hashEv = new URLSearchParams(location.hash.split('?')[1] || '').get('ev');
  if (hashEv) showDetail(hashEv);
}

// ===========================================================================
// SCREEN 7 — Protocol draft builder
// ===========================================================================
let draftPicks = [];
async function screenDraft() {
  await loadClients(); await loadCatalog();
  mount(`
    ${clientSelector()}
    <div class="two-col">
      <div class="panel">
        <div class="panel-head">Select products <span class="faint small">source-of-truth only</span></div>
        <div class="panel-body">
          <div class="field"><label>Search catalog</label><input id="dSearch" placeholder="type to filter…" /></div>
          <div id="dList" style="max-height:280px;overflow:auto;margin-top:10px"></div>
          <h3 class="block-title">Selected</h3>
          <div class="chips" id="dPicks">${draftPicks.length ? '' : '<span class="faint small">none</span>'}</div>
          <div class="field full" style="margin-top:14px"><label>Rationale (resource framing)</label><textarea id="dRationale" placeholder="If someone were considering options, the literature most often referenced covers…"></textarea></div>
          <div class="field full"><label>Monitoring notes</label><textarea id="dMonitor"></textarea></div>
          <div class="btn-row"><button class="btn" id="dGen">Generate gated draft</button></div>
        </div>
      </div>
      <div id="draftOut"><div class="empty">Select products and generate a draft to run the gate chain.</div></div>
    </div>`);
  wireClientSelector();
  const renderList = (q = '') => {
    const qn = q.toLowerCase().replace(/[^a-z0-9]/g, '');
    $('#dList').innerHTML = state.catalog.filter((p) => p.name.toLowerCase().replace(/[^a-z0-9]/g, '').includes(qn)).slice(0, 40)
      .map((p) => `<div class="small" style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--line)"><span>${esc(p.name)} ${routeBadge(p.route)}</span><button class="btn ghost sm" data-add="${esc(p.id)}">add</button></div>`).join('');
    $$('[data-add]').forEach((b) => b.onclick = () => { const p = state.catalog.find((x) => x.id === b.dataset.add); if (p && !draftPicks.find((d) => d.productId === p.id)) draftPicks.push({ productId: p.id, name: p.name, route: p.route }); renderPicks(); });
  };
  const renderPicks = () => { $('#dPicks').innerHTML = draftPicks.length ? draftPicks.map((d) => `<span class="chip sel" data-rmp="${esc(d.productId)}">${esc(d.name)} ✕</span>`).join('') : '<span class="faint small">none</span>'; $$('[data-rmp]').forEach((c) => c.onclick = () => { draftPicks = draftPicks.filter((d) => d.productId !== c.dataset.rmp); renderPicks(); }); };
  renderList(); renderPicks();
  $('#dSearch').oninput = (e) => renderList(e.target.value);
  $('#dGen').onclick = async () => {
    $('#draftOut').innerHTML = '<div class="loading">Running gates…</div>';
    const r = await api('/protocol/draft', { method: 'POST', body: { clientId: selectedClientId, itemRefs: draftPicks.map((d) => ({ productId: d.productId })), rationale: $('#dRationale').value, monitoring: $('#dMonitor').value, persist: true } });
    renderDraft(r.draft);
  };
}
function renderDraft(dr) {
  const bannerCls = dr.blocked ? 'blocked' : (dr.reviewedBy ? 'reviewed' : 'draft');
  const items = (dr.items || []).map((it) => `<tr>
    <td><strong>${esc(it.productName)}</strong></td><td>${routeBadge(it.route)}</td>
    <td>${badge(it.evidenceLevel)} <span class="faint small">${it.citationCount} cites</span></td>
    <td>${badge(it.compliance.status)}</td></tr>`).join('');
  $('#draftOut').innerHTML = `<div class="panel">
    <div class="panel-head">Protocol draft <span class="faint small">resource only</span></div>
    <div class="panel-body">
      <div class="banner ${bannerCls}">${esc(dr.statusBanner || dr.status)}</div>
      ${dr.blocked ? `<div class="callout bad"><strong>Blocked by gate:</strong><ul style="margin:6px 0 0">${dr.blockedReasons.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
      ${items ? `<table style="margin-top:8px"><thead><tr><th>Product</th><th>Route</th><th>Evidence</th><th>Compliance (CA)</th></tr></thead><tbody>${items}</tbody></table>` : ''}
      ${(dr.unknowns || []).length ? `<div class="callout gray" style="margin-top:12px"><strong>UNKNOWN evidence:</strong> ${dr.unknowns.map(esc).join(' · ')}</div>` : ''}
      ${(dr.warnings || []).length ? `<div class="callout warn" style="margin-top:12px">${dr.warnings.map(esc).join('<br>')}</div>` : ''}
      <div class="kv" style="margin-top:14px"><dt>Compliance (CA)</dt><dd>${badge(dr.compliance.status)} <span class="faint small">${esc(dr.compliance.reason || '')}</span></dd>
      <dt>Rationale</dt><dd class="small">${esc(dr.rationale || '—')}</dd></div>
      ${!dr.blocked ? `<div class="btn-row"><button class="btn" id="dReview">Mark reviewed (Dr. Vincent Lun)</button><span class="faint small">stays RESOURCE ONLY even after review</span></div>` : ''}
    </div></div>`;
  const rb = $('#dReview'); if (rb) rb.onclick = async () => { const r = await api('/protocol/drafts/' + dr.id + '/review', { method: 'POST', body: {} }); renderDraft(r.draft); };
}

// ===========================================================================
// SCREEN 8 — Provider referrals
// ===========================================================================
async function screenReferrals() {
  await loadClients();
  const r = selectedClientId ? await api('/referrals?clientId=' + selectedClientId) : { referrals: [] };
  const refs = (r.referrals || []).map((x) => `<div class="panel"><div class="panel-head">${esc(x.label)} ${badge('NEEDS_REVIEW', x.trigger)}</div><div class="panel-body">
    <div class="kv"><dt>Observed</dt><dd>${esc(x.whenObserved)}</dd><dt>Suggests</dt><dd>${esc(x.suggests)}</dd>
    ${x.provider ? `<dt>Provider</dt><dd><strong>${esc(x.provider.name)}</strong> · ${esc(x.provider.role)} · ${esc(x.provider.contact)}</dd>` : ''}</div>
    <div class="callout gray" style="margin-top:10px">${esc(x.disclaimer)}</div></div></div>`).join('');
  const pr = await api('/providers');
  mount(`
    ${clientSelector()}
    <h3 class="block-title">Suggested referral categories</h3>
    ${refs || '<div class="empty">No referral signals for this client. (Add an out-of-range lab or a relevant goal to surface suggestions.)</div>'}
    <h3 class="block-title">Provider directory</h3>
    ${(pr.providers || []).map((p) => `<div class="panel"><div class="panel-body"><div class="kv"><dt>${esc(p.name)}</dt><dd>${esc(p.role)} · ${esc(p.contact)}</dd><dt>Focus</dt><dd>${(p.focus || []).map((f) => `<span class="chip">${esc(f)}</span>`).join(' ')}</dd><dt>Note</dt><dd class="small muted">${esc(p.note)}</dd></div></div></div>`).join('')}`);
  wireClientSelector();
}

// ===========================================================================
// SCREEN 9 — Outcome scorecard
// ===========================================================================
async function screenScorecard() {
  await loadClients();
  if (!selectedClientId) { mount(clientSelector() + '<div class="empty">Select a client.</div>'); wireClientSelector(); return; }
  const [o, s] = await Promise.all([api('/outcomes?clientId=' + selectedClientId), api('/scorecard/' + selectedClientId)]);
  const sc = s.scorecard;
  const rows = (o.outcomes || []).sort((a, b) => new Date(a.recordedAt) - new Date(b.recordedAt)).map((x) => `<tr>
    <td>${esc((x.recordedAt || '').slice(0, 10))}</td><td class="num">${fmt(x.weightKg)}</td><td class="num">${fmt(x.bodyFatPct)}</td><td class="num">${fmt(x.leanMassKg)}</td>
    <td class="num">${x.adherencePct ?? '—'}%</td><td class="small">${(x.sideEffects || []).map(esc).join(', ') || '—'}</td></tr>`).join('');
  const delta = (v, unit) => v == null ? '—' : `<span class="${v < 0 ? '' : ''}">${v > 0 ? '+' : ''}${v}${unit}</span>`;
  mount(`
    ${clientSelector()}
    <div class="cards">
      <div class="card stat"><span class="label">Outcome flag</span><span class="value">${badge(sc.outcomeFlag)}</span><span class="sub">heuristic · operator-facing</span></div>
      <div class="card stat"><span class="label">Δ Weight</span><span class="value">${delta(sc.deltas.weightKg, ' kg')}</span></div>
      <div class="card stat"><span class="label">Δ Body fat</span><span class="value">${delta(sc.deltas.bodyFatPct, ' %')}</span></div>
      <div class="card stat"><span class="label">Δ Lean mass</span><span class="value">${delta(sc.deltas.leanMassKg, ' kg')}</span></div>
      <div class="card stat"><span class="label">Adherence avg</span><span class="value">${sc.adherenceAvg ?? '—'}%</span></div>
    </div>
    <div class="panel" style="margin-top:18px"><div class="panel-head">Outcome metrics over time</div>
      <div class="panel-body tight"><table><thead><tr><th>Date</th><th class="num">Weight</th><th class="num">BF%</th><th class="num">Lean</th><th class="num">Adherence</th><th>Side effects</th></tr></thead><tbody>${rows || '<tr><td colspan="6" class="empty">No metrics yet.</td></tr>'}</tbody></table></div></div>
    <div class="panel"><div class="panel-head">Record a datapoint</div><div class="panel-body">
      <div class="form-grid">
        <div class="field"><label>Weight (kg)</label><input id="o-w" type="number" step="0.1" /></div>
        <div class="field"><label>Body fat %</label><input id="o-bf" type="number" step="0.1" /></div>
        <div class="field"><label>Lean mass (kg)</label><input id="o-lean" type="number" step="0.1" /></div>
        <div class="field"><label>Adherence %</label><input id="o-adh" type="number" /></div>
        <div class="field full"><label>Side effects (comma-sep)</label><input id="o-se" /></div>
        <div class="field full"><label>Notes</label><input id="o-notes" /></div>
      </div>
      <div class="btn-row"><button class="btn" id="saveOut">Add datapoint</button></div>
    </div></div>`);
  wireClientSelector();
  $('#saveOut').onclick = async () => {
    await api('/outcomes', { method: 'POST', body: { clientId: selectedClientId, weightKg: $('#o-w').value, bodyFatPct: $('#o-bf').value, leanMassKg: $('#o-lean').value, adherencePct: $('#o-adh').value, sideEffects: ($('#o-se').value || '').split(',').map((s) => s.trim()).filter(Boolean), notes: $('#o-notes').value } });
    screenScorecard();
  };
}

// ===========================================================================
// SCREEN 10 — Compliance panel
// ===========================================================================
async function screenCompliance() {
  const d = await api('/compliance');
  const jx = d.jurisdictions;
  const states = (jx.US.states ? Object.values(jx.US.states) : []).map((s) => `<tr><td>${esc(s.label)}</td><td>${badge(s.status)}</td><td class="small faint">${esc(s.source || 'no sourced legal reference')}</td></tr>`).join('');
  const flags = (d.flags || []).map((f) => `<tr><td>${f.match.map((m) => `<span class="chip">${esc(m)}</span>`).join(' ')}</td><td>${badge(f.status)}</td><td class="small">${esc(f.reason)}</td></tr>`).join('');
  mount(`
    <div class="callout gray">${esc(d.disclaimer)}</div>
    <div class="panel" style="margin-top:16px"><div class="panel-head">Subject lookup</div><div class="panel-body">
      <div class="form-grid" style="grid-template-columns:1fr 200px">
        <div class="field"><label>Product / compound</label><input id="cmSubj" placeholder="Retatrutide 10mg" /></div>
        <div class="field"><label>Jurisdiction</label><select id="cmJx"><option value="CA">Canada (default)</option><option value="US">United States</option></select></div>
      </div>
      <div class="btn-row"><button class="btn" id="cmGo">Check</button></div>
      <div id="cmOut" style="margin-top:12px"></div>
    </div></div>
    <div class="list-split">
      <div class="panel"><div class="panel-head">Jurisdiction posture</div><div class="panel-body tight"><table><thead><tr><th>Jurisdiction</th><th>Default</th><th>Basis</th></tr></thead><tbody>
        <tr><td><strong>${esc(jx.CA.label)}</strong> ${jx.CA.isDefault ? '<span class="tag-demo">DEFAULT</span>' : ''}</td><td>${badge(jx.CA.default)}</td><td class="small">${esc(jx.CA.basis)}</td></tr>
        <tr><td><strong>${esc(jx.US.label)}</strong></td><td>${badge(jx.US.default)}</td><td class="small">${esc(jx.US.basis)}</td></tr>
      </tbody></table></div></div>
      <div class="panel"><div class="panel-head">US state config <span class="faint small">skeleton · all UNKNOWN until sourced</span></div><div class="panel-body tight"><table><thead><tr><th>State</th><th>Status</th><th>Source</th></tr></thead><tbody>${states}</tbody></table></div></div>
    </div>
    <div class="panel"><div class="panel-head">Compound-class flags <span class="faint small">elevate the jurisdiction default</span></div><div class="panel-body tight"><table><thead><tr><th>Match terms</th><th>Status</th><th>Reason</th></tr></thead><tbody>${flags}</tbody></table></div></div>`);
  $('#cmGo').onclick = async () => {
    const subj = $('#cmSubj').value.trim(); if (!subj) return;
    const r = await api(`/compliance?subject=${encodeURIComponent(subj)}&jurisdiction=${$('#cmJx').value}`);
    const c = r.check;
    $('#cmOut').innerHTML = `<div class="callout ${c.status === 'BLOCKED' ? 'bad' : (c.status === 'NEEDS_REVIEW' ? 'warn' : (c.status === 'UNKNOWN' ? 'gray' : ''))}">${badge(c.status)} <strong>${esc(c.subject)}</strong> · ${esc(c.jurisdiction)}<div style="margin-top:6px">${esc(c.reason || '')}</div></div>`;
  };
}

// ---- router ----------------------------------------------------------------
const SCREENS = [
  { id: 'dashboard', title: 'Dashboard', fn: screenDashboard },
  { id: 'clients', title: 'Clients', fn: screenClients },
  { id: 'lab-panels', title: 'Lab Panel Builder', fn: screenLabPanels },
  { id: 'lab-results', title: 'Lab Results Tracker', fn: screenLabResults },
  { id: 'catalog', title: 'Source-of-Truth Catalog', fn: screenCatalog },
  { id: 'research', title: 'Research Gate', fn: screenResearch },
  { id: 'draft', title: 'Protocol Draft Builder', fn: screenDraft },
  { id: 'referrals', title: 'Provider Referrals', fn: screenReferrals },
  { id: 'scorecard', title: 'Outcome Scorecard', fn: screenScorecard },
  { id: 'compliance', title: 'Compliance Panel', fn: screenCompliance },
];
function setActiveNav(id) { $$('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.id === id)); }
function go() {
  const id = (location.hash.slice(1).split('?')[0]) || 'dashboard';
  const s = SCREENS.find((x) => x.id === id) || SCREENS[0];
  $('#screenTitle').textContent = s.title;
  setActiveNav(s.id);
  s.fn().catch((e) => mount(`<div class="callout bad">Error: ${esc(e.message)}</div>`));
}

window.addEventListener('hashchange', go);

async function boot() {
  state.meta = await api('/meta');
  $('#disclaimerBar').textContent = state.meta.disclaimer;
  $('#nav').innerHTML = SCREENS.map((s, i) => `<a href="#${s.id}" data-id="${s.id}"><span class="num">${i + 1}</span>${esc(s.title)}</a>`).join('');
  $('#resetDemo').onclick = async () => { await api('/admin/reset-demo', { method: 'POST' }); state.clients = []; state.catalog = []; selectedClientId = null; localStorage.removeItem('vitalis.client'); go(); };
  await loadClients();
  if (!location.hash) location.hash = '#dashboard';
  go();
}
boot();
