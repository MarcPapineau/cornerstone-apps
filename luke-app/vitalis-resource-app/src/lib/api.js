/**
 * api.js — thin client for the server-authoritative gate API.
 *
 * The browser NEVER decides clinical outcomes; it asks the Express server, which runs
 * every gate from @vitalis/protocol-core. This module only marshals JSON over /api.
 * Endpoint shapes mirror server.js exactly.
 */
const BASE = '/api';

async function request(path, { method = 'GET', body, signal, headers } = {}) {
  // Merge optional custom headers (e.g. the Order Ops operator role) with the JSON content-type
  // when there is a body. Backward-compatible: with no body and no custom headers, headers stays
  // undefined exactly as before.
  const merged = { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(headers || {}) };
  const res = await fetch(BASE + path, {
    method,
    headers: Object.keys(merged).length ? merged : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok || (data && data.ok === false)) {
    const msg = (data && (data.error || data.message)) || `Request failed (${res.status})`;
    const err = new Error(msg);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

const qs = (params) => {
  const p = Object.entries(params || {}).filter(([, v]) => v != null && v !== '');
  return p.length ? '?' + p.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&') : '';
};

// Order Ops is internal/operator-only — the server hard-gates every /api/ops/* route to ADMIN.
// opsHeaders() supplies the operator role signal as the `x-vitalis-role` header, read from the SAME
// demo role the app already persists (roleContext writes 'vitalis.demoRole' to localStorage). It is
// NOT a hardcoded ADMIN: switching the demo role to CLIENT/PRACTITIONER makes ops calls fail closed
// (403), which is the intended behavior. The server enforces access; this only reports the role.
const OPS_ROLE_KEY = 'vitalis.demoRole';
function opsHeaders() {
  let role = 'ADMIN';
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(OPS_ROLE_KEY) : null;
    const saved = raw ? JSON.parse(raw) : null;
    if (saved && saved.role) role = saved.role;
  } catch { /* unreadable storage → fall back to ADMIN (the operator surface default) */ }
  return { 'x-vitalis-role': role };
}

export const api = {
  health: () => request('/health'),
  meta: () => request('/meta'),
  // Runtime client config — { openMode }. Server reads VITALIS_OPEN_MODE at request time (not
  // baked in at build), so the SPA learns the TEST/OPEN-MODE state on load. Default openMode:false.
  config: () => request('/config'),
  dashboard: () => request('/dashboard'),

  clients: () => request('/clients'),
  client: (id) => request(`/clients/${encodeURIComponent(id)}`),
  createClient: (payload) => request('/clients', { method: 'POST', body: payload }),
  removeClient: (id) => request(`/clients/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  labPanels: (productNames = []) => request(`/lab-panels${qs({ products: productNames.join('|') })}`),
  labResults: (clientId) => request(`/lab-results${qs({ clientId })}`),
  createLabResult: (payload) => request('/lab-results', { method: 'POST', body: payload }),

  // Nutrition module — drag-drop/paste a lab report, confirm the parsed values, then the
  // SERVER analyzes them into a role-softened "request for your naturopath" slip (DRAFT /
  // resource-only, not a prescription). nutritionParse is the best-effort local→server parse;
  // nutritionAnalyze takes the human-confirmed { values, role, clientId, products }.
  nutritionParse: (text) => request('/nutrition/parse', { method: 'POST', body: { text } }),
  nutritionAnalyze: (payload) => request('/nutrition/analyze', { method: 'POST', body: payload }),
  // The LIVE example: the server resolves a role-softened slip from the client's OWN most-recent
  // stored lab draw (reuses nutritionSlipForClient — no client-side values, no fabrication).
  // Returns { slip, status: 'LIVE' | 'PENDING_LABS', clientName }. PENDING_LABS → honest empty.
  nutritionSlip: ({ clientId, role = 'CLIENT' }) => request(`/nutrition/slip${qs({ clientId, role })}`),

  catalog: (q) => request(`/catalog${qs({ q })}`),
  catalogItem: (id) => request(`/catalog/${encodeURIComponent(id)}`),

  evidenceIndex: () => request('/evidence'),
  evidence: (compoundId) => request(`/evidence/${encodeURIComponent(compoundId)}`),
  researchLookup: (term) => request('/research/lookup', { method: 'POST', body: { term } }),

  drafts: (clientId) => request(`/protocol/drafts${qs({ clientId })}`),
  draft: (id) => request(`/protocol/drafts/${encodeURIComponent(id)}`),
  draftProtocol: (payload) => request('/protocol/draft', { method: 'POST', body: payload }),
  // In-app chat generator: AI/deterministic proposes → gates dispose → DRAFT/resource-only.
  // role drives the dosing view (practitioner = full DRAFT, client = literature ranges).
  generateProtocol: (payload) => request('/protocol/generate', { method: 'POST', body: payload }),
  // Software-license acknowledgment (responsibility shift) — logged, practitioner/operator only.
  licenseAck: (payload) => request('/protocol/license-ack', { method: 'POST', body: payload }),
  genEvents: (clientId) => request(`/protocol/gen-events${qs({ clientId })}`),
  // reviewDraft accepts either a plain reviewer (back-compat "mark reviewed") or a full
  // decision object { decision, reviewedBy, comment }. APPROVE is the only path that makes
  // a draft client-visible (server-enforced via the approval gate).
  reviewDraft: (id, arg) => {
    const body = typeof arg === 'string' ? { reviewedBy: arg } : (arg || {});
    return request(`/protocol/drafts/${encodeURIComponent(id)}/review`, { method: 'POST', body });
  },

  // Multi-tenant / role-aware surfaces.
  practitioners: () => request('/practitioners'),
  practitioner: (id) => request(`/practitioners/${encodeURIComponent(id)}`),
  practitionerClients: (id) => request(`/practitioner/${encodeURIComponent(id)}/clients`),
  createClientForPractitioner: (pid, payload) => request(`/practitioner/${encodeURIComponent(pid)}/clients`, { method: 'POST', body: { ...payload, role: 'PRACTITIONER' } }),
  clientDossier: (pid, cid) => request(`/practitioner/${encodeURIComponent(pid)}/clients/${encodeURIComponent(cid)}/dossier${qs({ role: 'PRACTITIONER' })}`),
  practitionerReviews: (id) => request(`/practitioner/${encodeURIComponent(id)}/reviews`),
  clientResources: (id) => request(`/client/${encodeURIComponent(id)}/resources`),
  clientProtocols: (id) => request(`/client/${encodeURIComponent(id)}/protocols`),
  requestProtocol: (id, payload) => request(`/client/${encodeURIComponent(id)}/protocol-requests`, { method: 'POST', body: payload }),
  clientProtocolRequests: (id) => request(`/client/${encodeURIComponent(id)}/protocol-requests`),
  updateDraft: (id, fields) => request(`/protocol/drafts/${encodeURIComponent(id)}`, { method: 'PATCH', body: { ...fields, role: 'PRACTITIONER' } }),
  draftAudit: (id) => request(`/protocol/drafts/${encodeURIComponent(id)}/audit`),
  // Vertical documents — the server renders engine output as a Vitalis dossier (peptide live).
  document: (silo, id, role = 'PRACTITIONER') => request(`/documents/${encodeURIComponent(silo)}/${encodeURIComponent(id)}${qs({ role })}`),
  adminOverview: () => request('/admin/overview'),
  adminDirectClients: () => request('/admin/direct-clients'),
  createPractitioner: (payload) => request('/practitioners', { method: 'POST', body: payload }),
  updatePractitioner: (id, patch) => request(`/practitioners/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch }),
  practitionerAnalytics: (id) => request(`/practitioner/${encodeURIComponent(id)}/analytics`),

  // One-click Client Package — a gated protocol presented as Protocol + Bloodwork + Nutrition.
  // packageForDraft composes an operator preview from a draft (full dosing; nutrition is
  // PENDING_LABS until the client has labs). clientPackage is the portal view — APPROVED only,
  // server-projected, role CLIENT (no draft can ever surface). Returns { package, status }.
  packageForDraft: (id, role = 'PRACTITIONER') => request(`/protocol/drafts/${encodeURIComponent(id)}/package${qs({ role })}`),
  clientPackage: (id) => request(`/client/${encodeURIComponent(id)}/package`),

  referrals: (clientId) => request(`/referrals${qs({ clientId })}`),
  providers: () => request('/providers'),
  // Inter-industry referral network (SCAFFOLD): location + service filtered partner roster
  // and the demo referral-status records. Suggestion-only — no booking, no fee transport.
  referralNetwork: ({ clientId, service, region, location, includeUnavailable } = {}) =>
    request(`/referrals/network${qs({ clientId, service, region, location, includeUnavailable: includeUnavailable ? 'true' : '' })}`),
  referralStatus: (clientId) => request(`/referrals/status${qs({ clientId })}`),

  outcomes: (clientId) => request(`/outcomes${qs({ clientId })}`),
  createOutcome: (payload) => request('/outcomes', { method: 'POST', body: payload }),
  scorecard: (clientId) => request(`/scorecard/${encodeURIComponent(clientId)}`),

  complianceConfig: () => request('/compliance'),
  complianceCheck: (subject, jurisdiction = 'CA') => request(`/compliance${qs({ subject, jurisdiction })}`),

  // --- Platform: onboarding (invitations + self-intake + documents) ---------
  createInvitation: (payload) => request('/invitations', { method: 'POST', body: payload }),
  invitations: (practitionerId) => request(`/invitations${qs({ practitionerId })}`),
  invitation: (token) => request(`/invitations/${encodeURIComponent(token)}`),
  submitIntake: (token, payload) => request(`/invitations/${encodeURIComponent(token)}/intake`, { method: 'POST', body: payload }),
  clientDocuments: (id) => request(`/client/${encodeURIComponent(id)}/documents`),
  uploadDocument: (id, payload) => request(`/client/${encodeURIComponent(id)}/documents`, { method: 'POST', body: payload }),

  // --- Platform: entitlements (active-protocol cap) -------------------------
  clientEntitlements: (id) => request(`/client/${encodeURIComponent(id)}/entitlements`),

  // --- Platform: paid add-ons (supplement + meal plans) ---------------------
  // Same DRAFT → review → approve spine; a draft is never client-visible until approved.
  requestAddOn: (id, payload) => request(`/client/${encodeURIComponent(id)}/add-ons/request`, { method: 'POST', body: payload }),
  clientAddOns: (id) => request(`/client/${encodeURIComponent(id)}/add-ons`),
  practitionerAddOns: (id, role = 'PRACTITIONER') => request(`/practitioner/${encodeURIComponent(id)}/add-ons${qs({ role })}`),
  markAddOnPaid: (requestId, paymentStatus = 'MANUALLY_APPROVED') => request(`/add-ons/${encodeURIComponent(requestId)}/payment`, { method: 'POST', body: { paymentStatus, role: 'PRACTITIONER' } }),
  generateAddOn: (requestId, payload = {}) => request(`/add-ons/${encodeURIComponent(requestId)}/generate`, { method: 'POST', body: payload }),
  reviewAddOn: (draftId, payload) => request(`/add-ons/${encodeURIComponent(draftId)}/review`, { method: 'POST', body: payload }),

  // --- Protocol lock-in (accept as the single CURRENT protocol) -------------
  lockProtocolCurrent: (draftId, payload = {}) => request(`/protocol/drafts/${encodeURIComponent(draftId)}/lock-current`, { method: 'POST', body: payload }),

  // --- Research source registry (honest LIVE/STUB/PLANNED) ------------------
  researchSources: () => request('/research/sources'),
  plans: () => request('/plans'),

  resetDemo: () => request('/admin/reset-demo', { method: 'POST' }),

  // --- Order Ops (internal/operator only) -----------------------------------
  // Every /api/ops/* route is hard-gated to ADMIN server-side. The operator surface signals its
  // role with the `x-vitalis-role` header (opsHeaders), reusing the SAME demo role the app already
  // persists (roleContext → localStorage 'vitalis.demoRole'). Reading the persisted role — not a
  // hardcoded ADMIN — keeps the client honest with the role switcher: switch to CLIENT/PRACTITIONER
  // and these calls correctly fail closed (403). The server is the real boundary; this is only the
  // signal it reads.
  opsCatalog: () => request('/ops/catalog', { headers: opsHeaders() }),
  opsDashboard: () => request('/ops/dashboard', { headers: opsHeaders() }),

  opsCustomers: () => request('/ops/customers', { headers: opsHeaders() }),
  opsCustomer: (id) => request(`/ops/customers/${encodeURIComponent(id)}`, { headers: opsHeaders() }),
  opsCreateCustomer: (payload) => request('/ops/customers', { method: 'POST', body: payload, headers: opsHeaders() }),

  opsOrders: () => request('/ops/orders', { headers: opsHeaders() }),
  opsOrder: (id) => request(`/ops/orders/${encodeURIComponent(id)}`, { headers: opsHeaders() }),
  opsCreateOrder: (payload) => request('/ops/orders', { method: 'POST', body: payload, headers: opsHeaders() }),
  // Order detail + lifecycle (invoiceStatus DRAFT|SENT|PAID|VOID; items DRAFT-only; amountPaid; notes).
  opsUpdateOrder: (id, payload) => request(`/ops/orders/${encodeURIComponent(id)}`, { method: 'PATCH', body: payload, headers: opsHeaders() }),
  opsUpdatePayment: (id, payload) => request(`/ops/orders/${encodeURIComponent(id)}/payment`, { method: 'PATCH', body: payload, headers: opsHeaders() }),
  opsInvoice: (id) => request(`/ops/orders/${encodeURIComponent(id)}/invoice`, { headers: opsHeaders() }),

  opsInventory: () => request('/ops/inventory', { headers: opsHeaders() }),
  opsInventoryAdjust: (payload) => request('/ops/inventory/adjust', { method: 'POST', body: payload, headers: opsHeaders() }),

  opsSupplierOrders: () => request('/ops/supplier-orders', { headers: opsHeaders() }),
  opsCreateSupplierOrder: (payload) => request('/ops/supplier-orders', { method: 'POST', body: payload, headers: opsHeaders() }),
  opsUpdateSupplierOrder: (id, payload) => request(`/ops/supplier-orders/${encodeURIComponent(id)}`, { method: 'PATCH', body: payload, headers: opsHeaders() }),

  opsReferrals: () => request('/ops/referrals', { headers: opsHeaders() }),
  opsReferralCredit: (id, payload) => request(`/ops/referrals/${encodeURIComponent(id)}/credit`, { method: 'POST', body: payload, headers: opsHeaders() }),
  opsReferralDebit: (id, payload) => request(`/ops/referrals/${encodeURIComponent(id)}/debit`, { method: 'POST', body: payload, headers: opsHeaders() }),
};

export default api;
