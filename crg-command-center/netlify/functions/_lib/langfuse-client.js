/**
 * langfuse-client.js — read-side Langfuse REST wrapper for the Garvis Ops Tab.
 *
 * Companion to cornerstoneregroup-site's _lib/langfuse.js, which is the
 * write-side wrapper (instruments Anthropic calls and POSTs traces). This
 * module is the inverse: the Ops Tab needs to LIST + READ traces that the
 * fleet has already written to Langfuse so Marc can browse every agent run.
 *
 * Vendor docs cited at build time
 * ───────────────────────────────
 *   - https://langfuse.com/docs/sdk/typescript            (init pattern, env vars)
 *   - https://langfuse.com/docs/query-traces              (REST endpoints)
 *   - https://api.reference.langfuse.com/                 (full REST reference)
 *
 * Why plain fetch instead of @langfuse/client SDK
 * ───────────────────────────────────────────────
 *   - Cold-start budget on Netlify Functions is tight (4KB env-var ceiling
 *     already documented in agent-registry.js). Adding the SDK doubles
 *     cold-start time on the 14 functions in this site for one read API.
 *   - The REST surface we need is two endpoints. Plain fetch is simpler.
 *   - Same posture as the cornerstoneregroup-site write-side helper.
 *
 * Auth
 * ────
 *   Langfuse REST uses HTTP Basic auth: username = LANGFUSE_PUBLIC_KEY,
 *   password = LANGFUSE_SECRET_KEY. Same env vars the write-side helper
 *   already reads.
 *
 * Graceful degradation
 * ────────────────────
 *   If LANGFUSE_HOST is unset OR the keys are missing, the helper returns an
 *   empty result set with backend = "langfuse-disabled". The Ops Tab UI must
 *   tolerate that — it then falls back to the agent-registry only.
 */

const DEFAULT_HOST = "https://cloud.langfuse.com";
const TIMEOUT_MS = 10_000;

function getHost() {
  const h = process.env.LANGFUSE_HOST || process.env.LANGFUSE_BASE_URL || "";
  return h ? h.replace(/\/+$/, "") : "";
}

function langfuseConfigured() {
  if (process.env.LANGFUSE_ENABLED === "0") return false;
  return !!(getHost() && process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY);
}

function basicAuthHeader() {
  const pk = process.env.LANGFUSE_PUBLIC_KEY;
  const sk = process.env.LANGFUSE_SECRET_KEY;
  return "Basic " + Buffer.from(`${pk}:${sk}`).toString("base64");
}

async function fetchJsonWithTimeout(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs || TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      ...opts,
      signal: ctrl.signal,
      headers: {
        Accept: "application/json",
        Authorization: basicAuthHeader(),
        ...(opts.headers || {}),
      },
    });
    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      const err = new Error(`langfuse ${resp.status}: ${txt.slice(0, 200)}`);
      err.status = resp.status;
      throw err;
    }
    return await resp.json();
  } finally {
    clearTimeout(t);
  }
}

/**
 * GET /api/public/traces — list traces with optional filters.
 *
 * @param {object} [params]
 * @param {string} [params.userId]        Langfuse `userId` filter (we set this to agent_id on write)
 * @param {string} [params.name]          Trace name filter (we set this to "<agent>:<model>")
 * @param {string} [params.sessionId]     Specific session
 * @param {string} [params.fromTimestamp] ISO date (inclusive)
 * @param {string} [params.toTimestamp]   ISO date (exclusive)
 * @param {string[]} [params.tags]        AND-matched tag filter
 * @param {number} [params.limit=50]
 * @param {number} [params.page=1]
 *
 * @returns {Promise<{data: object[], meta: object}>}
 *   `data` is the array of trace summaries. Each item includes:
 *     id, name, sessionId, userId, timestamp, tags, latency, totalCost,
 *     observations[].
 */
async function listTraces(params = {}) {
  if (!langfuseConfigured()) {
    return { data: [], meta: { backend: "langfuse-disabled" } };
  }
  const host = getHost();
  const qs = new URLSearchParams();
  if (params.userId) qs.set("userId", params.userId);
  if (params.name) qs.set("name", params.name);
  if (params.sessionId) qs.set("sessionId", params.sessionId);
  if (params.fromTimestamp) qs.set("fromTimestamp", params.fromTimestamp);
  if (params.toTimestamp) qs.set("toTimestamp", params.toTimestamp);
  if (Array.isArray(params.tags)) {
    for (const t of params.tags) qs.append("tags", t);
  }
  qs.set("limit", String(Math.min(params.limit || 50, 100)));
  qs.set("page", String(params.page || 1));

  const url = `${host}/api/public/traces?${qs.toString()}`;
  try {
    const json = await fetchJsonWithTimeout(url);
    // Langfuse returns { data: [...], meta: { totalItems, totalPages, page, limit } }
    const items = Array.isArray(json?.data) ? json.data : [];
    return { data: items, meta: { ...(json?.meta || {}), backend: "langfuse" } };
  } catch (err) {
    console.warn(`[langfuse-client] listTraces failed: ${err.message}`);
    return { data: [], meta: { backend: "langfuse-error", error: err.message } };
  }
}

/**
 * GET /api/public/traces/{traceId} — fetch a single trace plus its observations.
 *
 * @param {string} traceId
 * @returns {Promise<object|null>}  The trace object, or null on error/missing.
 */
async function getTrace(traceId) {
  if (!langfuseConfigured()) return null;
  if (!traceId || typeof traceId !== "string") return null;
  const host = getHost();
  const url = `${host}/api/public/traces/${encodeURIComponent(traceId)}`;
  try {
    return await fetchJsonWithTimeout(url);
  } catch (err) {
    console.warn(`[langfuse-client] getTrace(${traceId}) failed: ${err.message}`);
    return null;
  }
}

/**
 * Normalize a Langfuse trace object into the flat session record the Ops Tab
 * UI consumes. Lossless on missing fields — the UI tolerates nulls.
 */
function normalizeTraceToSession(trace, { tagsOverride = null } = {}) {
  if (!trace || typeof trace !== "object") return null;

  // started_at = trace.timestamp; completed_at = max of observations endTime
  const startedAt = trace.timestamp || trace.createdAt || null;
  let completedAt = null;
  let errorCount = 0;
  const toolsUsed = new Set();
  if (Array.isArray(trace.observations)) {
    for (const obs of trace.observations) {
      const end = obs.endTime || obs.completionStartTime || null;
      if (end && (!completedAt || end > completedAt)) completedAt = end;
      if (obs.level === "ERROR") errorCount += 1;
      if (obs.type === "TOOL" && obs.name) toolsUsed.add(obs.name);
      // Tool calls attached to the generation metadata too
      const metaToolCalls = obs?.metadata?.tool_calls;
      if (Array.isArray(metaToolCalls)) {
        for (const tc of metaToolCalls) {
          if (tc?.name) toolsUsed.add(tc.name);
        }
      }
    }
  }

  let status = "running";
  if (errorCount > 0) status = "failed";
  else if (completedAt) status = "completed";

  // Agent name: trace.userId is the canonical write-side field (see
  // cornerstoneregroup-site/_lib/langfuse.js — userId is set to agent_id).
  const agentName = trace.userId || trace.name?.split(":")[0] || "unknown";

  const tags = tagsOverride !== null ? tagsOverride
    : (Array.isArray(trace.tags) ? trace.tags : []);

  const host = getHost();
  const langfuseUrl = host && trace.id ? `${host}/trace/${trace.id}` : null;

  // total_tokens — sum across observations
  let totalTokens = null;
  if (Array.isArray(trace.observations)) {
    let sum = 0;
    let any = false;
    for (const obs of trace.observations) {
      const u = obs.usage;
      if (u && (u.total || u.input || u.output)) {
        sum += (u.total || (u.input || 0) + (u.output || 0));
        any = true;
      }
    }
    if (any) totalTokens = sum;
  }

  return {
    session_id: trace.id,
    agent_name: agentName,
    started_at: startedAt,
    completed_at: completedAt,
    status,
    trace_url: langfuseUrl,
    langfuse_url: langfuseUrl,
    tags,
    total_tokens: totalTokens,
    tools_used: Array.from(toolsUsed),
    error_count: errorCount,
    trace_events: Array.isArray(trace.observations) ? trace.observations.map((o) => ({
      id: o.id,
      type: o.type,
      name: o.name,
      start: o.startTime,
      end: o.endTime,
      level: o.level,
      status_message: o.statusMessage,
    })) : [],
  };
}

module.exports = {
  langfuseConfigured,
  listTraces,
  getTrace,
  normalizeTraceToSession,
  // exposed for tests
  _internals: { getHost, basicAuthHeader, fetchJsonWithTimeout },
};
