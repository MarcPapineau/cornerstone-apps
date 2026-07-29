'use strict';
/**
 * catalog.js — canonical product catalog access + role-aware projections.
 *
 * `packages/protocol-core/data/catalog.json` is the SINGLE canonical source of truth
 * for products + pricing across the Vitalis platform. It carries internal economics
 * (cost, margin, costPerMg) alongside client-facing pricing (msrp, pricePerVial, boxPrice).
 *
 * PRICING IS OWNER-CONTROLLED. Marc sets cost / price / margin manually. There is NO
 * automatic discount logic anywhere — no discount policy, no maxDiscountPct, no default
 * discount, no coupon logic, no practitioner/client discount controls. Discount fields
 * from the legacy LUKE catalog are intentionally NOT carried forward as business logic.
 * (The historical legacy values remain only in the frozen luke snapshot.) A discount may
 * exist only if Marc explicitly creates one manually, later.
 *
 * Projections (server-authoritative — surfaces ask, they never decide):
 *   ADMIN                  → full record incl. internal economics (cost / margin / costPerMg)
 *   PRACTITIONER / CLIENT  → pricing only; NO internal economics
 *
 * A client/practitioner must NEVER see cost / margin / internal economics. Enforced here,
 * once, for every surface. NOT medical advice — research / resource tooling only.
 */

const catalogData = require('./data/catalog.json');

// Internal economics — ADMIN only. A client/practitioner must never receive these.
const INTERNAL_ECONOMICS_FIELDS = Object.freeze(['cost', 'margin', 'costPerMg']);

// Discount logic is DELIBERATELY ABSENT. These field names must never appear in the
// canonical catalog or in business logic; the guard fails the build if they do.
const FORBIDDEN_DISCOUNT_FIELDS = Object.freeze([
  'discountAllowed', 'maxDiscountPct', 'discount', 'discountPct', 'defaultDiscount',
  'coupon', 'couponCode', 'discountPolicy',
]);

const ROLES = Object.freeze({ CLIENT: 'CLIENT', PRACTITIONER: 'PRACTITIONER', ADMIN: 'ADMIN' });

// Unknown / missing role → PRACTITIONER (the app-wide default), which still never exposes
// internal economics. Only an explicit ADMIN role unlocks cost / margin.
function normalizeRole(role) {
  const r = String(role || '').toUpperCase();
  return (r === ROLES.ADMIN || r === ROLES.PRACTITIONER || r === ROLES.CLIENT) ? r : ROLES.PRACTITIONER;
}

function stripFields(product, fields) {
  const out = {};
  for (const k of Object.keys(product)) if (!fields.includes(k)) out[k] = product[k];
  return out;
}

/**
 * projectProduct — a role-appropriate COPY of one product. Pure; never mutates input.
 * ADMIN sees internal economics; everyone else (practitioner, client, default) does not.
 * No role ever receives discount logic — there isn't any.
 */
function projectProduct(product, role) {
  if (!product || typeof product !== 'object') return product;
  return normalizeRole(role) === ROLES.ADMIN ? { ...product } : stripFields(product, INTERNAL_ECONOMICS_FIELDS);
}

function projectCatalog(products, role) {
  const list = Array.isArray(products) ? products : (catalogData.products || []);
  return list.map((p) => projectProduct(p, role));
}

// Raw accessors — server-internal ONLY (gates/index build off these; they never reach a
// surface without going through projectProduct / projectCatalog first).
const PRODUCTS = catalogData.products || [];
function allProductsRaw() { return PRODUCTS; }
function getProductRaw(id) { return PRODUCTS.find((p) => p.id === id) || null; }

// Guard helpers.
function leaksEconomics(projected) {
  const arr = Array.isArray(projected) ? projected : [projected];
  return arr.some((p) => p && typeof p === 'object' && INTERNAL_ECONOMICS_FIELDS.some((f) => f in p));
}
// Does any product carry a forbidden discount field? (Used by the guard to fail the build.)
function hasDiscountField(productOrList) {
  const arr = Array.isArray(productOrList) ? productOrList : [productOrList];
  return arr.some((p) => p && typeof p === 'object' && FORBIDDEN_DISCOUNT_FIELDS.some((f) => f in p));
}

module.exports = {
  ROLES,
  INTERNAL_ECONOMICS_FIELDS,
  FORBIDDEN_DISCOUNT_FIELDS,
  normalizeRole,
  projectProduct,
  projectCatalog,
  allProductsRaw,
  getProductRaw,
  leaksEconomics,
  hasDiscountField,
  provenance: catalogData._provenance || null,
};
