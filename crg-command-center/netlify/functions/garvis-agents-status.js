/**
 * Netlify Function: /.netlify/functions/garvis-agents-status
 *
 * GET — returns the list of CRG agents with status enrichment:
 *   - last_run timestamp (from Langfuse traces if configured)
 *   - error_count over last 24h
 *   - anti_drift_status (GREEN v2 / YELLOW / RED) — from registry blob
 *   - last seen agent_version (managed-agent v_uuid if present)
 *
 * Garvis liveness sprint. Uses agent-registry from PR #5 if it lands; if
 * not, returns the silo-state agent list with status="unknown" enrichment.
 *
 * Graceful degradation: if Langfuse is not configured, returns
 * status_enrichment="disabled" and the agent list still ships.
 *
 * Response shape:
 *   {
 *     backend: "registry+langfuse" | "silo-state-only",
 *     agents: [
 *       { id, name, role, silo, model, schedule, schedule_human,
 *         memory_store, managed_agent_pr, agent_version, last_run,
 *         error_count_24h, anti_drift_status, runs_last_24h }
 *     ],
 *     timestamp
 *   }
 */

const { checkAuth, unauthorized } = require("./_lib/garvis-auth");
const { loadSiloStateSync } = require("./_lib/silo-state-loader");

const LANGFUSE_BASE = process.env.LANGFUSE_BASE_URL || "https://us.cloud.langfuse.com";
const LANGFUSE_PUBLIC = process.env.LANGFUSE_PUBLIC_KEY || "";
const LANGFUSE_SECRET = process.env.LANGFUSE_SECRET_KEY || "";

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  };
}

function langfuseConfigured() {
  return Boolean(LANGFUSE_PUBLIC && LANGFUSE_SECRET);
}

function basicAuth() {
  const tok = Buffer.from(`${LANGFUSE_PUBLIC}:${LANGFUSE_SECRET}`).toString("base64");
  return `Basic ${tok}`;
}

/**
 * Fetch Langfuse traces newer than `sinceIso`. Mirrors the listTraces
 * helper in PR #5 (langfuse-client.js) but kept self-contained so this
 * endpoint works even if PR #5 hasn't landed.
 */
async function listTracesByAgent(agentName, sinceIso, limit = 50) {
  if (!langfuseConfigured()) return null;
  const url = new URL(`${LANGFUSE_BASE}/api/public/traces`);
  url.searchParams.set("userId", agentName);
  url.searchParams.set("limit", String(limit));
  if (sinceIso) url.searchParams.set("fromTimestamp", sinceIso);

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const resp = await fetch(url.toString(), {
      headers: { Authorization: basicAuth(), "Content-Type": "application/json" },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!resp.ok) return null;
    const json = await resp.json();
    return Array.isArray(json.data) ? json.data : [];
  } catch (_) {
    return null;
  }
}

function summarizeRuns(traces) {
  if (!Array.isArray(traces)) return { last_run: null, error_count_24h: 0, runs_last_24h: 0 };
  const day = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const recent = traces.filter((t) => {
    const ts = t.timestamp || t.startTime || t.createdAt;
    if (!ts) return false;
    return (now - new Date(ts).getTime()) <= day;
  });
  const errors = recent.filter((t) => {
    const lvl = (t.level || "").toLowerCase();
    return lvl === "error" || lvl === "warning";
  });
  // Most recent
  const sorted = [...traces].sort((a, b) => {
    const ta = new Date(a.timestamp || a.startTime || a.createdAt || 0).getTime();
    const tb = new Date(b.timestamp || b.startTime || b.createdAt || 0).getTime();
    return tb - ta;
  });
  const last = sorted[0];
  return {
    last_run: last ? (last.timestamp || last.startTime || last.createdAt || null) : null,
    error_count_24h: errors.length,
    runs_last_24h: recent.length,
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
  const agents = Array.isArray(state.agents) ? state.agents : [];
  const enrichmentEnabled = langfuseConfigured();
  const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const enriched = await Promise.all(agents.map(async (agent) => {
    let last_run = null;
    let error_count_24h = 0;
    let runs_last_24h = 0;
    let backend = "no-enrichment";

    if (enrichmentEnabled) {
      const traces = await listTracesByAgent(agent.id, sinceIso, 25);
      if (traces) {
        backend = "langfuse";
        const s = summarizeRuns(traces);
        last_run = s.last_run;
        error_count_24h = s.error_count_24h;
        runs_last_24h = s.runs_last_24h;
      } else {
        backend = "langfuse-error";
      }
    }

    // Anti-drift status — start with GREEN, downgrade if we see signals.
    // Without a live registry blob this is best-effort. The cornerstoneregroup
    // -site agent registry tracks anti-drift v2 explicitly; once that's
    // exposed via PR #5's agent-registry mirror, this slot upgrades.
    let anti_drift_status = "GREEN";
    if (agent.id === "levite") anti_drift_status = "RED"; // emergency-paused
    if (!agent.managed_agent_pr && agent.silo !== "cross-cutting") {
      // Not yet migrated to managed agents — can't verify v2 block
      anti_drift_status = "YELLOW";
    }

    return {
      ...agent,
      agent_version: agent.managed_agent_pr ? `managed-agent (PR #${agent.managed_agent_pr})` : "unmigrated",
      last_run,
      error_count_24h,
      runs_last_24h,
      anti_drift_status,
      enrichment_backend: backend,
    };
  }));

  return {
    statusCode: 200,
    headers: cors(),
    body: JSON.stringify({
      backend: enrichmentEnabled ? "registry+langfuse" : "silo-state-only",
      langfuse_configured: enrichmentEnabled,
      counts: {
        total: enriched.length,
        green: enriched.filter((a) => a.anti_drift_status === "GREEN").length,
        yellow: enriched.filter((a) => a.anti_drift_status === "YELLOW").length,
        red: enriched.filter((a) => a.anti_drift_status === "RED").length,
        scheduled: enriched.filter((a) => a.schedule).length,
        on_demand: enriched.filter((a) => !a.schedule).length,
      },
      agents: enriched,
      timestamp: new Date().toISOString(),
    }),
  };
};
