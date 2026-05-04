/**
 * Netlify Function: /.netlify/functions/garvis-system-health
 *
 * GET — probes the canonical CRG app URLs with 5s timeout and returns
 * live status per app. Used by Garvis dashboard System Health row.
 *
 * Probes (in display order):
 *   - cornerstoneregroup.netlify.app          (parent CRG site)
 *   - cornerstoneregroup.netlify.app/real-estate/        (RE silo)
 *   - cornerstoneregroup.netlify.app/financial-advisors/ (FA silo)
 *   - cornerstoneregroup.netlify.app/mortgage-brokers/   (MB silo)
 *   - papineau-family-finance.netlify.app/    (Vault OS)
 *   - peptide-resource-app.netlify.app/        (Vitalis)
 *   - crg-command.netlify.app/                 (Garvis itself)
 *   - crg-script-evaluator.netlify.app/        (Script Engine)
 *   - crg-compliance-engine.netlify.app/       (Compliance)
 *   - <Windmill base url>                       (Windmill control plane)
 *
 * Vitalis POS (luke-app) and Beaverly are intentionally NOT probed —
 * they're local-only (Marc's Mac) and would always show DOWN from
 * Netlify's probe environment. We surface them as kind="local" with
 * status="unknown" instead of polluting the strip.
 *
 * Each probe returns:
 *   { name, url, kind, status, http_code, latency_ms, last_checked, detail }
 *
 * status values: "live" | "degraded" | "down" | "unknown"
 *
 * Garvis liveness sprint.
 */

const { checkAuth, unauthorized } = require("./_lib/garvis-auth");

const PROBE_TIMEOUT_MS = 5_000;
const WINDMILL_BASE = process.env.WINDMILL_BASE_URL || "https://gmbh-lion-mar-epson.trycloudflare.com";

const PROBES = [
  { id: "garvis",            name: "Garvis",                url: "https://crg-command.netlify.app/",                            kind: "internal",   silo: "cross-cutting" },
  { id: "cornerstone-parent",name: "Cornerstone (parent)",  url: "https://cornerstoneregroup.netlify.app/",                     kind: "site",       silo: "cross-cutting" },
  { id: "re-silo",           name: "RE silo page",          url: "https://cornerstoneregroup.netlify.app/real-estate/",         kind: "silo-page",  silo: "real-estate" },
  { id: "fa-silo",           name: "FA silo page",          url: "https://cornerstoneregroup.netlify.app/financial-advisors/",  kind: "silo-page",  silo: "primerica" },
  { id: "mb-silo",           name: "MB silo page",          url: "https://cornerstoneregroup.netlify.app/mortgage-brokers/",    kind: "silo-page",  silo: "primerica" },
  { id: "vault-os",          name: "Vault OS",              url: "https://papineau-family-finance.netlify.app/",                kind: "internal",   silo: "primerica" },
  { id: "vitalis-research",  name: "Vitalis Research",      url: "https://peptide-resource-app.netlify.app/",                   kind: "client",     silo: "peptides" },
  { id: "script-evaluator",  name: "Script Evaluator",      url: "https://crg-script-evaluator.netlify.app/",                   kind: "tool",       silo: "cross-cutting" },
  { id: "compliance-engine", name: "Compliance Engine",     url: "https://crg-compliance-engine.netlify.app/",                  kind: "tool",       silo: "cross-cutting" },
  { id: "learning-dash",     name: "Learning Dashboard",    url: "https://crg-learning-dashboard.netlify.app/",                 kind: "tool",       silo: "cross-cutting" },
  { id: "windmill",          name: "Windmill",              url: WINDMILL_BASE + "/",                                            kind: "infra",      silo: "cross-cutting" },
];

const LOCAL_ONLY = [
  { id: "vitalis-pos", name: "Vitalis POS",  url: "http://localhost:3000/",  kind: "local", silo: "peptides",
    status: "unknown", http_code: null, latency_ms: null, detail: "Local Express app — not probeable from Netlify" },
  { id: "beaverly",     name: "Beaverly",     url: "http://localhost:3001/",  kind: "local", silo: "cross-cutting",
    status: "unknown", http_code: null, latency_ms: null, detail: "Local app — not probeable from Netlify" },
];

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  };
}

async function probe(spec) {
  const startedAt = Date.now();
  let timer = null;
  try {
    const ctrl = new AbortController();
    timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
    const resp = await fetch(spec.url, {
      method: "GET",
      redirect: "follow",
      signal: ctrl.signal,
      headers: { "User-Agent": "Garvis-HealthProbe/1.0 (+https://crg-command.netlify.app/)" },
    });
    const latency = Date.now() - startedAt;
    let status = "live";
    let detail = `HTTP ${resp.status}`;
    if (resp.status >= 500) {
      status = "down"; detail = `HTTP ${resp.status} (server error)`;
    } else if (resp.status >= 400) {
      status = "degraded"; detail = `HTTP ${resp.status} (client error)`;
    } else if (resp.status >= 300) {
      // Followed redirect; treat as live
      status = "live"; detail = `HTTP ${resp.status} (redirect followed)`;
    }
    return {
      ...spec,
      status,
      http_code: resp.status,
      latency_ms: latency,
      last_checked: new Date().toISOString(),
      detail,
    };
  } catch (err) {
    const latency = Date.now() - startedAt;
    const aborted = err && err.name === "AbortError";
    return {
      ...spec,
      status: "down",
      http_code: null,
      latency_ms: latency,
      last_checked: new Date().toISOString(),
      detail: aborted ? `Timeout after ${PROBE_TIMEOUT_MS}ms` : `Probe error: ${(err && err.message) || "unknown"}`,
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
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

  const t0 = Date.now();
  // Run all probes in parallel; each has its own 5s timeout.
  const probed = await Promise.all(PROBES.map(probe));
  const results = [...probed, ...LOCAL_ONLY];

  const counts = {
    total: results.length,
    live: results.filter((r) => r.status === "live").length,
    degraded: results.filter((r) => r.status === "degraded").length,
    down: results.filter((r) => r.status === "down").length,
    unknown: results.filter((r) => r.status === "unknown").length,
  };

  return {
    statusCode: 200,
    headers: cors(),
    body: JSON.stringify({
      backend: "live-probe",
      probe_timeout_ms: PROBE_TIMEOUT_MS,
      total_runtime_ms: Date.now() - t0,
      counts,
      results,
      timestamp: new Date().toISOString(),
    }),
  };
};
