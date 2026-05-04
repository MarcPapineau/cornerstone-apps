/**
 * agent-registry.js — read-only mirror of the cornerstoneregroup-site
 * agent registry (PR #41).
 *
 * The Managed-Agents migration stores each agent's IDs as a single JSON blob
 * keyed by canonical agent name (habakkuk, karis, apollos, …). The full
 * pattern (write side, RMW serialization, strong consistency, cache TTL) lives
 * in cornerstoneregroup-site/netlify/functions/_lib/agent-registry.js.
 *
 * Garvis Ops only NEEDS to read. We mirror the read API and the Blobs config
 * here so this site can resolve agent metadata without round-tripping the
 * other site. If the registry is empty (e.g. fresh deploy, Blobs disabled,
 * NETLIFY_AUTH_TOKEN missing) the UI degrades to "agent_name = trace.userId"
 * and shows the Langfuse data without enrichment.
 *
 * Source pattern reference:
 *   /Users/marcpapineau/.openclaw/workspace/_worktrees/nehemiah-migration/
 *     netlify/functions/_lib/agent-registry.js
 *
 * Per the dispatch: "copy the pattern" — same store name, same key, same
 * cache TTL. Writes are NOT exposed in this mirror; the source-of-truth for
 * registry mutations remains the migration scripts in cornerstoneregroup-site.
 */

const blobs = require("@netlify/blobs");

const STORE_NAME = "agent-registry";
const KEY = "managed-agents";
const CACHE_TTL_MS = 60_000;

let _cache = null;
let _cacheAt = 0;
let _connected = false;

function connect(event) {
  if (!event || _connected) return;
  try {
    if (typeof blobs.connectLambda === "function") {
      blobs.connectLambda(event);
      _connected = true;
    }
  } catch (_) {
    // Local dev — registry reads will return empty.
  }
}

function _getStore() {
  return blobs.getStore({ name: STORE_NAME, consistency: "strong" });
}

/**
 * Load the full agent registry. Cached for CACHE_TTL_MS in-process.
 * Returns {} on miss / Blobs error.
 */
async function loadRegistry() {
  const now = Date.now();
  if (_cache && (now - _cacheAt) < CACHE_TTL_MS) return _cache;
  try {
    const store = _getStore();
    const json = await store.get(KEY, { type: "json" });
    _cache = json || {};
  } catch (err) {
    console.warn("[agent-registry] loadRegistry error:", err.message);
    _cache = {};
  }
  _cacheAt = now;
  return _cache;
}

/**
 * Look up one agent by canonical name. Returns the entry or null.
 */
async function getAgentIds(agentName) {
  if (!agentName || typeof agentName !== "string") return null;
  const reg = await loadRegistry();
  return reg[agentName] || null;
}

/**
 * Returns the canonical list of agent names known to the registry.
 * Used by the Ops Tab to populate the "filter by agent" dropdown.
 */
async function listAgentNames() {
  const reg = await loadRegistry();
  return Object.keys(reg).sort();
}

function _resetCache() {
  _cache = null;
  _cacheAt = 0;
  _connected = false;
}

module.exports = {
  connect,
  loadRegistry,
  getAgentIds,
  listAgentNames,
  _resetCache,
  STORE_NAME,
  KEY,
  CACHE_TTL_MS,
};
