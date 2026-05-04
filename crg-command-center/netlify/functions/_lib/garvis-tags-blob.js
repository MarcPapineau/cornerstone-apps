/**
 * garvis-tags-blob.js — read/write helper for session-tag annotations.
 *
 * Cookbook recipe (claude-agent-sdk-05) keeps tags inside the session's JSONL
 * transcript. We don't have transcripts in Garvis; the source-of-truth for an
 * agent run is its Langfuse trace. Langfuse trace tags exist but require write
 * permission on the trace object — we keep our annotations as a sidecar in
 * Netlify Blobs so:
 *   - Marc can tag any session immediately without round-tripping Langfuse
 *   - The UI doesn't need a Langfuse write key (least-privilege)
 *   - We can migrate to native Langfuse tags later without UI changes
 *
 * Storage shape
 * ─────────────
 *   Blob store : "garvis-tags"
 *   Key        : "<session_id>.json"
 *   Value      : { session_id, tags: [string], updated_at: ISO }
 *
 * The list endpoint's overlay logic prefers Blob tags over Langfuse trace
 * tags when both exist (operator-supplied is more current than write-time).
 */

const STORE_NAME = "garvis-tags";

async function loadStore() {
  try {
    const { getStore } = await import("@netlify/blobs");
    return getStore({ name: STORE_NAME, consistency: "strong" });
  } catch (_) {
    return null;
  }
}

function keyFor(sessionId) {
  // Sessions IDs are UUID-ish from Langfuse; safe to use directly. Append .json
  // so the blob list reads like a folder of files.
  return `${sessionId}.json`;
}

/**
 * Read tags for a single session. Returns the empty array when missing or
 * when Blobs is unreachable.
 */
async function readTags(sessionId) {
  if (!sessionId) return [];
  const store = await loadStore();
  if (!store) return [];
  try {
    const raw = await store.get(keyFor(sessionId), { type: "json" });
    if (!raw || !Array.isArray(raw.tags)) return [];
    return raw.tags;
  } catch (err) {
    console.warn(`[garvis-tags] readTags(${sessionId}) failed: ${err.message}`);
    return [];
  }
}

/**
 * Read tags for many sessions in one fan-out. Returns Map<sessionId, string[]>.
 * Sessions with no record return an empty array.
 */
async function readTagsMany(sessionIds) {
  const out = new Map();
  if (!Array.isArray(sessionIds) || sessionIds.length === 0) return out;
  const store = await loadStore();
  if (!store) {
    for (const id of sessionIds) out.set(id, []);
    return out;
  }
  await Promise.all(
    sessionIds.map(async (id) => {
      try {
        const raw = await store.get(keyFor(id), { type: "json" });
        out.set(id, raw && Array.isArray(raw.tags) ? raw.tags : []);
      } catch (_) {
        out.set(id, []);
      }
    })
  );
  return out;
}

/**
 * Merge new tags into the existing set. De-dupes case-sensitively, preserves
 * insertion order (existing first, then new ones). Returns the persisted array.
 */
async function addTags(sessionId, newTags) {
  if (!sessionId) throw new Error("addTags: sessionId required");
  if (!Array.isArray(newTags)) throw new Error("addTags: tags must be an array");
  const store = await loadStore();
  if (!store) {
    const err = new Error("blobs_unavailable");
    err.code = "BLOBS_UNAVAILABLE";
    throw err;
  }

  // Read-modify-write. No CAS primitive in @netlify/blobs; same posture as
  // queue-update.js.
  const existing = (await store.get(keyFor(sessionId), { type: "json" })) || {};
  const merged = Array.isArray(existing.tags) ? [...existing.tags] : [];
  const seen = new Set(merged);
  for (const t of newTags) {
    if (typeof t !== "string") continue;
    const trimmed = t.trim();
    if (!trimmed) continue;
    if (seen.has(trimmed)) continue;
    merged.push(trimmed);
    seen.add(trimmed);
  }

  const record = {
    session_id: sessionId,
    tags: merged,
    updated_at: new Date().toISOString(),
  };
  await store.setJSON(keyFor(sessionId), record);
  return merged;
}

/**
 * Replace the tag set entirely. Used by the UI's "clear" affordance.
 */
async function setTags(sessionId, tags) {
  if (!sessionId) throw new Error("setTags: sessionId required");
  if (!Array.isArray(tags)) throw new Error("setTags: tags must be an array");
  const store = await loadStore();
  if (!store) {
    const err = new Error("blobs_unavailable");
    err.code = "BLOBS_UNAVAILABLE";
    throw err;
  }
  const cleaned = [];
  const seen = new Set();
  for (const t of tags) {
    if (typeof t !== "string") continue;
    const trimmed = t.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    cleaned.push(trimmed);
    seen.add(trimmed);
  }
  const record = {
    session_id: sessionId,
    tags: cleaned,
    updated_at: new Date().toISOString(),
  };
  await store.setJSON(keyFor(sessionId), record);
  return cleaned;
}

module.exports = {
  STORE_NAME,
  readTags,
  readTagsMany,
  addTags,
  setTags,
  // exposed for tests
  _internals: { keyFor, loadStore },
};
