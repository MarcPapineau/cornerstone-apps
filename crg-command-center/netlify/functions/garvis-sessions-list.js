/**
 * Netlify Function: /.netlify/functions/garvis-sessions-list
 *
 * GET — returns the list of agent runs ("sessions") visible to Garvis Ops Tab.
 *
 * Cookbook recipe
 * ───────────────
 *   https://platform.claude.com/cookbook/claude-agent-sdk-05-building-a-session-browser
 *   §"Build the session list" — list_sessions(directory, limit, offset)
 *
 * The cookbook reads ~/.claude/projects/<encoded-cwd>/<id>.jsonl. Garvis runs
 * its agents on Netlify/Windmill, not in a developer's home dir, so the
 * "session" concept maps to Langfuse traces (one trace = one agent invocation
 * with input/output/observations), enriched with operator-supplied tags from
 * Netlify Blobs.
 *
 * Query parameters
 * ────────────────
 *   ?agent_name=<canonical>   Filter by registry agent name (matches userId in Langfuse)
 *   ?status=running|completed|failed
 *   ?since=<ISO date>         Inclusive lower bound on trace.timestamp
 *   ?limit=<int>              Default 50, max 100 (Langfuse REST cap)
 *   ?page=<int>               Default 1
 *
 * Response shape
 * ──────────────
 *   {
 *     backend: "langfuse" | "langfuse-disabled" | "langfuse-error",
 *     count, page, limit,
 *     sessions: [
 *       { session_id, agent_name, started_at, completed_at, status,
 *         trace_url, tags, total_tokens, tools_used, error_count }
 *     ],
 *     timestamp
 *   }
 */

const { checkAuth, unauthorized } = require("./_lib/garvis-auth");
const {
  langfuseConfigured,
  listTraces,
  normalizeTraceToSession,
} = require("./_lib/langfuse-client");
const { readTagsMany } = require("./_lib/garvis-tags-blob");
const agentRegistry = require("./_lib/agent-registry");

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  };
}

function clampLimit(raw) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return 50;
  return Math.min(n, 100);
}

function clampPage(raw) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return n;
}

function withinStatus(session, statusFilter) {
  if (!statusFilter) return true;
  return session.status === statusFilter;
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

  // Bootstrap Blobs SDK from the Lambda event so the registry + tag helpers
  // can talk to the Netlify Blobs control plane in production.
  agentRegistry.connect(event);

  const qs = event.queryStringParameters || {};
  const agentName = (qs.agent_name || "").trim() || null;
  const status = (qs.status || "").trim().toLowerCase() || null;
  const since = (qs.since || "").trim() || null;
  const limit = clampLimit(qs.limit);
  const page = clampPage(qs.page);

  if (status && !["running", "completed", "failed"].includes(status)) {
    return {
      statusCode: 400,
      headers: cors(),
      body: JSON.stringify({ error: "invalid_status", allowed: ["running", "completed", "failed"] }),
    };
  }

  // Short-circuit: Langfuse not configured → empty result with backend flag so
  // the UI can render an "Ops Tab requires LANGFUSE_* env vars" notice.
  if (!langfuseConfigured()) {
    return {
      statusCode: 200,
      headers: cors(),
      body: JSON.stringify({
        backend: "langfuse-disabled",
        count: 0,
        page,
        limit,
        sessions: [],
        note: "Set LANGFUSE_HOST + LANGFUSE_PUBLIC_KEY + LANGFUSE_SECRET_KEY to populate.",
        timestamp: new Date().toISOString(),
      }),
    };
  }

  const langfuseParams = {
    limit,
    page,
    fromTimestamp: since || undefined,
    userId: agentName || undefined,
  };

  const { data: traces, meta } = await listTraces(langfuseParams);

  // Overlay operator-supplied tags from Blobs
  const ids = traces.map((t) => t.id).filter(Boolean);
  const tagMap = await readTagsMany(ids);

  let sessions = traces
    .map((trace) => {
      const blobTags = tagMap.get(trace.id);
      const tagsOverride = (Array.isArray(blobTags) && blobTags.length > 0)
        ? blobTags
        : null;
      return normalizeTraceToSession(trace, { tagsOverride });
    })
    .filter(Boolean);

  // Apply status filter post-normalization (Langfuse list endpoint doesn't
  // accept a status filter directly — status is derived from observation
  // levels in normalizeTraceToSession).
  if (status) {
    sessions = sessions.filter((s) => withinStatus(s, status));
  }

  return {
    statusCode: 200,
    headers: cors(),
    body: JSON.stringify({
      backend: meta?.backend || "langfuse",
      count: sessions.length,
      page,
      limit,
      total_items: meta?.totalItems ?? null,
      total_pages: meta?.totalPages ?? null,
      filter: { agent_name: agentName, status, since },
      sessions,
      timestamp: new Date().toISOString(),
    }),
  };
};
