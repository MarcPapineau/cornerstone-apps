/**
 * Netlify Function: /.netlify/functions/garvis-session-tag
 *
 * POST — add operator-supplied tags to a session.
 *
 * Cookbook recipe
 * ───────────────
 *   https://platform.claude.com/cookbook/claude-agent-sdk-05-building-a-session-browser
 *   §"Tag and filter" — tag_session(session_id, tag, directory)
 *
 *   > "Tags are a single string attached to a session. Use them for whatever
 *   > categorization your product needs: 'archived', 'needs-review', 'favorite'."
 *
 * Garvis extends the cookbook's single-tag-per-session model to a tag SET
 * (array) so Marc can categorize a run with multiple labels at once
 * (e.g. needs-review + revenue-impact). Tags merge — sending the same body
 * twice is idempotent.
 *
 * Request body (JSON)
 * ───────────────────
 *   {
 *     session_id: string,    REQUIRED
 *     tags: string[]         REQUIRED — array of new tag strings to merge
 *   }
 *
 * Response
 * ────────
 *   { session_id, tags: [updated array], updated_at }
 *
 * The list endpoint overlays Blob tags over Langfuse trace.tags so the UI
 * always sees the freshest operator state.
 */

const { checkAuth, unauthorized } = require("./_lib/garvis-auth");
const { addTags } = require("./_lib/garvis-tags-blob");

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  };
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

  const { session_id, tags } = body;
  if (!session_id || typeof session_id !== "string") {
    return {
      statusCode: 400,
      headers: cors(),
      body: JSON.stringify({ error: "missing_session_id" }),
    };
  }
  if (!Array.isArray(tags)) {
    return {
      statusCode: 400,
      headers: cors(),
      body: JSON.stringify({ error: "tags_must_be_array" }),
    };
  }
  if (tags.some((t) => typeof t !== "string")) {
    return {
      statusCode: 400,
      headers: cors(),
      body: JSON.stringify({ error: "tags_must_be_strings" }),
    };
  }

  try {
    const merged = await addTags(session_id, tags);
    return {
      statusCode: 200,
      headers: cors(),
      body: JSON.stringify({
        session_id,
        tags: merged,
        updated_at: new Date().toISOString(),
      }),
    };
  } catch (err) {
    if (err && err.code === "BLOBS_UNAVAILABLE") {
      return {
        statusCode: 503,
        headers: cors(),
        body: JSON.stringify({
          error: "blobs_unavailable",
          detail: "Run via Netlify Dev/Prod for persistent tags.",
        }),
      };
    }
    return {
      statusCode: 500,
      headers: cors(),
      body: JSON.stringify({
        error: "tag_write_failed",
        detail: err.message,
      }),
    };
  }
};
