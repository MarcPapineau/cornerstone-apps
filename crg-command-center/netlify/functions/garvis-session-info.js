/**
 * Netlify Function: /.netlify/functions/garvis-session-info
 *
 * GET — returns the full detail for a single agent session (Langfuse trace).
 *
 * Cookbook recipe
 * ───────────────
 *   https://platform.claude.com/cookbook/claude-agent-sdk-05-building-a-session-browser
 *   §"If your app already stored a session ID..." — get_session_info(session_id)
 *
 * Returns the same flat session record as garvis-sessions-list, augmented with
 *   trace_events[]   — array of observation summaries (id, type, name,
 *                      start, end, level, status_message)
 *   total_tokens     — sum across all observations (input + output)
 *   tools_used[]     — distinct tool names invoked
 *   error_count      — observations whose level === "ERROR"
 *   langfuse_url     — direct link into the Langfuse UI
 *
 * Query parameters
 * ────────────────
 *   ?session_id=<langfuse-trace-id>   (REQUIRED)
 *
 * Response shape on miss
 * ──────────────────────
 *   404 { error: "not_found", session_id }
 */

const { checkAuth, unauthorized } = require("./_lib/garvis-auth");
const {
  langfuseConfigured,
  getTrace,
  normalizeTraceToSession,
} = require("./_lib/langfuse-client");
const { readTags } = require("./_lib/garvis-tags-blob");
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

  agentRegistry.connect(event);

  const qs = event.queryStringParameters || {};
  const sessionId = (qs.session_id || "").trim();
  if (!sessionId) {
    return {
      statusCode: 400,
      headers: cors(),
      body: JSON.stringify({ error: "missing_session_id" }),
    };
  }

  if (!langfuseConfigured()) {
    return {
      statusCode: 503,
      headers: cors(),
      body: JSON.stringify({
        error: "langfuse_disabled",
        detail: "Set LANGFUSE_HOST + LANGFUSE_PUBLIC_KEY + LANGFUSE_SECRET_KEY",
      }),
    };
  }

  const trace = await getTrace(sessionId);
  if (!trace) {
    return {
      statusCode: 404,
      headers: cors(),
      body: JSON.stringify({ error: "not_found", session_id: sessionId }),
    };
  }

  const blobTags = await readTags(sessionId);
  const tagsOverride = blobTags.length > 0 ? blobTags : null;
  const session = normalizeTraceToSession(trace, { tagsOverride });

  // Enrich with registry metadata if present
  let agentMeta = null;
  if (session.agent_name) {
    agentMeta = await agentRegistry.getAgentIds(session.agent_name);
  }

  return {
    statusCode: 200,
    headers: cors(),
    body: JSON.stringify({
      backend: "langfuse",
      session_id: session.session_id,
      agent_name: session.agent_name,
      agent_meta: agentMeta,
      started_at: session.started_at,
      completed_at: session.completed_at,
      status: session.status,
      trace_url: session.trace_url,
      langfuse_url: session.langfuse_url,
      tags: session.tags,
      total_tokens: session.total_tokens,
      tools_used: session.tools_used,
      error_count: session.error_count,
      trace_events: session.trace_events,
      timestamp: new Date().toISOString(),
    }),
  };
};
