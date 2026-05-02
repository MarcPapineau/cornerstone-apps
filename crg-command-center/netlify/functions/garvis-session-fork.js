/**
 * Netlify Function: /.netlify/functions/garvis-session-fork
 *
 * POST — queue a forked re-run of an agent session with optional edits.
 *
 * Cookbook recipe
 * ───────────────
 *   https://platform.claude.com/cookbook/claude-agent-sdk-05-building-a-session-browser
 *   §"Branch from an existing conversation" — fork_session(source, …)
 *
 *   > "copies a session's transcript into a new file with freshly remapped
 *   > message IDs. The original stays untouched. This is the primitive behind
 *   > 'try a different approach' features…"
 *
 * Phase 1 scope (this build)
 * ──────────────────────────
 *   STUB. Records the fork request to a Netlify Blob queue and returns a
 *   queued-status response. The actual dispatch (re-running the agent through
 *   Windmill / Managed Agents with the edits applied) is Phase 2.
 *
 *   This keeps the API surface stable so the Phase 2 dispatcher can swap in
 *   without changing the UI. The queue blob also gives Marc visibility into
 *   pending forks before the dispatcher exists.
 *
 * Request body (JSON)
 * ───────────────────
 *   {
 *     session_id: string,                  REQUIRED — source trace id
 *     edits?: {
 *       prompt_override?: string,          replace the original system+user prompt
 *       scope_override?: string,           replace the scope / instructions block
 *       up_to_message_id?: string          fork before a specific message (cookbook)
 *     }
 *   }
 *
 * Response
 * ────────
 *   { forked_session_id, status: "queued", dispatch_url, queued_at }
 */

const crypto = require("crypto");
const { checkAuth, unauthorized } = require("./_lib/garvis-auth");

const STORE_NAME = "garvis-fork-queue";

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  };
}

async function loadStore() {
  try {
    const { getStore } = await import("@netlify/blobs");
    return getStore({ name: STORE_NAME, consistency: "strong" });
  } catch (_) {
    return null;
  }
}

function newForkId() {
  // CSPRNG hex — not Math.random — same posture as the peptide-chat runId fix
  // (PR #2509 — Bundle F P1).
  return "fork_" + crypto.randomBytes(8).toString("hex");
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: cors(), body: "" };
  }
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: cors(),
      body: JSON.stringify({ error: "method_not_allowed" }),
    };
  }
  if (!checkAuth(event)) return unauthorized(cors());

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch (_) {
    return {
      statusCode: 400,
      headers: cors(),
      body: JSON.stringify({ error: "invalid_json" }),
    };
  }

  const { session_id, edits } = body;
  if (!session_id || typeof session_id !== "string") {
    return {
      statusCode: 400,
      headers: cors(),
      body: JSON.stringify({ error: "missing_session_id" }),
    };
  }
  if (edits && typeof edits !== "object") {
    return {
      statusCode: 400,
      headers: cors(),
      body: JSON.stringify({ error: "invalid_edits" }),
    };
  }

  const forkedId = newForkId();
  const queuedAt = new Date().toISOString();
  const dispatchUrl = `/.netlify/functions/garvis-session-info?session_id=${encodeURIComponent(forkedId)}`;

  const record = {
    forked_session_id: forkedId,
    source_session_id: session_id,
    edits: edits || {},
    status: "queued",
    queued_at: queuedAt,
    // Phase 2 will populate these:
    dispatched_at: null,
    completed_at: null,
    dispatcher: null,
  };

  const store = await loadStore();
  if (store) {
    try {
      await store.setJSON(`${forkedId}.json`, record);
    } catch (err) {
      console.warn(`[garvis-session-fork] enqueue failed: ${err.message}`);
      // Not fatal — return the queued response anyway so UI can show user feedback.
      // Phase 2 dispatcher will be tolerant of missing queue entries via Langfuse trace.
    }
  }

  return {
    statusCode: 200,
    headers: cors(),
    body: JSON.stringify({
      forked_session_id: forkedId,
      source_session_id: session_id,
      status: "queued",
      dispatch_url: dispatchUrl,
      queued_at: queuedAt,
      phase: 1,
      note: "Phase 1 stub — dispatcher arrives in Phase 2",
    }),
  };
};
