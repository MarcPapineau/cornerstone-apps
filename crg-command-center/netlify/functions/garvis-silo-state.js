/**
 * Netlify Function: /.netlify/functions/garvis-silo-state
 *
 * GET — returns the canonical 3-silo state from /data/silo-state.json.
 *
 * Garvis liveness sprint. This replaces the hardcoded SILOS array in
 * index.html. The 3 silos are:
 *   1. real-estate — Cornerstone RE Group + marcpapineau.com
 *   2. peptides    — Vitalis Research + Vitalis POS + KLOW
 *   3. primerica   — Vault OS + financial-advisors + NorthLend
 *
 * Doctrine: doctrine_crg_internal_focus.md (ratified 2026-04-25).
 *
 * Response shape:
 *   {
 *     backend: "filesystem",
 *     as_of: ISO,
 *     silos: [...],
 *     agents: [...],
 *     apps_canon: [...],
 *     timestamp: ISO
 *   }
 */

const { checkAuth, unauthorized } = require("./_lib/garvis-auth");
const { loadSiloStateSync } = require("./_lib/silo-state-loader");

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  };
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: cors(), body: "" };
  }
  if (event.httpMethod !== "GET") {
    return {
      statusCode: 405,
      headers: cors(),
      body: JSON.stringify({ error: "method_not_allowed" }),
    };
  }
  if (!checkAuth(event)) return unauthorized(cors());

  const state = loadSiloStateSync();
  const meta = state._meta || {};
  const silos = Array.isArray(state.silos) ? state.silos : [];
  const agents = Array.isArray(state.agents) ? state.agents : [];
  const appsCanon = Array.isArray(state.apps_canon) ? state.apps_canon : [];

  return {
    statusCode: 200,
    headers: cors(),
    body: JSON.stringify({
      backend: meta.error ? "filesystem-error" : "filesystem",
      as_of: meta.as_of || null,
      meta,
      silos,
      agents,
      apps_canon: appsCanon,
      counts: {
        silos: silos.length,
        agents: agents.length,
        apps: appsCanon.length,
      },
      timestamp: new Date().toISOString(),
    }),
  };
};
