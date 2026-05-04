/**
 * Netlify Function: /.netlify/functions/agent-feedback-history
 *
 * GET — read prior feedback for a session (if any) and the most recent N
 *       feedback entries for the agent. Used by the Operations Tab detail
 *       drawer to (a) disable Accept/Reject when feedback already exists for
 *       this session and (b) render a small "Recent feedback for <agent>"
 *       roll-up under the buttons.
 *
 * Query
 * ─────
 *   ?session_id=<id>     OPTIONAL — filter to entries on this session
 *   ?agent_name=<name>   REQUIRED — canonical lowercase agent name
 *   ?limit=10            OPTIONAL — agent-wide history depth (default 10, max 50)
 *
 * Response
 * ────────
 *   {
 *     ok: true,
 *     agent_name,
 *     session_feedback: { session_id, verdict, rating, reason, timestamp } | null,
 *     recent: [ { session_id, verdict, rating, reason, timestamp }, ... ],
 *     count: number,           // total entries on file for the agent
 *     backend: "netlify-blobs" | "blobs-unavailable"
 *   }
 *
 * Storage source
 * ──────────────
 *   Reads "agent-feedback" blob store, key "<agent_name>/index.json" written
 *   by the agent-feedback POST endpoint.
 *
 * Auth: cookie via _lib/garvis-auth.
 */

const { checkAuth, unauthorized } = require("./_lib/garvis-auth");

const STORE_NAME = "agent-feedback";

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  };
}

async function loadStore(event) {
  try {
    const blobs = await import("@netlify/blobs");
    if (typeof blobs.connectLambda === "function" && event) {
      try { blobs.connectLambda(event); } catch (_) {}
    }
    return blobs.getStore({ name: STORE_NAME, consistency: "strong" });
  } catch (_) {
    return null;
  }
}

function indexKey(agentName) {
  return `${agentName}/index.json`;
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

  const params = event.queryStringParameters || {};
  const agent_name = (params.agent_name || "").trim().toLowerCase();
  const session_id = (params.session_id || "").trim();
  const limit = Math.max(
    1,
    Math.min(50, parseInt(params.limit || "10", 10) || 10)
  );

  if (!agent_name) {
    return {
      statusCode: 400,
      headers: cors(),
      body: JSON.stringify({ error: "missing_agent_name" }),
    };
  }
  if (!/^[a-z0-9_-]+$/.test(agent_name)) {
    return {
      statusCode: 400,
      headers: cors(),
      body: JSON.stringify({ error: "invalid_agent_name" }),
    };
  }

  const store = await loadStore(event);
  if (!store) {
    return {
      statusCode: 200,
      headers: cors(),
      body: JSON.stringify({
        ok: true,
        agent_name,
        session_feedback: null,
        recent: [],
        count: 0,
        backend: "blobs-unavailable",
      }),
    };
  }

  let entries = [];
  try {
    const raw = await store.get(indexKey(agent_name), { type: "json" });
    if (raw && Array.isArray(raw.entries)) entries = raw.entries;
  } catch (err) {
    console.warn(`[agent-feedback-history] read failed: ${err.message}`);
  }

  // Newest first
  entries.sort((a, b) => {
    const at = new Date(a.timestamp || 0).getTime();
    const bt = new Date(b.timestamp || 0).getTime();
    return bt - at;
  });

  let session_feedback = null;
  if (session_id) {
    // Most recent feedback wins if Marc rated the same session twice
    session_feedback =
      entries.find((e) => e.session_id === session_id) || null;
  }

  const recent = entries.slice(0, limit);

  return {
    statusCode: 200,
    headers: cors(),
    body: JSON.stringify({
      ok: true,
      agent_name,
      session_feedback,
      recent,
      count: entries.length,
      backend: "netlify-blobs",
    }),
  };
};
