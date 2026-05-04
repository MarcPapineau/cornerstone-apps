/**
 * silo-state-loader.js — read /data/silo-state.json from disk.
 *
 * Garvis liveness sprint (feat/garvis-liveness-sprint).
 *
 * Single shared helper so every silos endpoint reads the same source of
 * truth. The file is committed to git, so this is durable across deploys
 * (no Blobs round-trip). For runtime overrides (e.g. when the dashboard
 * eventually wants to recompute objectives from PR state) we'd add a
 * Blobs layer here — for now, file-only.
 *
 * Doctrine reference: doctrine_crg_internal_focus.md (3-silo lock).
 */

const fs = require("fs");
const path = require("path");

let _cache = null;
let _cacheAt = 0;
const CACHE_TTL_MS = 30_000;

function _findFile() {
  // Netlify deploys functions next to a copy of the publish dir; locate the
  // committed JSON by walking up from the function bundle.
  const candidates = [
    path.resolve(__dirname, "../../../data/silo-state.json"),
    path.resolve(__dirname, "../../data/silo-state.json"),
    path.resolve(__dirname, "../../../../data/silo-state.json"),
    path.resolve(process.cwd(), "data/silo-state.json"),
    path.resolve(process.cwd(), "crg-command-center/data/silo-state.json"),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch (_) {}
  }
  return null;
}

function loadSiloStateSync() {
  const now = Date.now();
  if (_cache && (now - _cacheAt) < CACHE_TTL_MS) return _cache;

  const file = _findFile();
  if (!file) {
    return { _meta: { error: "silo-state.json not found" }, silos: [], agents: [], apps_canon: [] };
  }
  try {
    const raw = fs.readFileSync(file, "utf8");
    const parsed = JSON.parse(raw);
    _cache = parsed;
    _cacheAt = now;
    return parsed;
  } catch (err) {
    return { _meta: { error: "silo-state.json parse: " + err.message }, silos: [], agents: [], apps_canon: [] };
  }
}

function _resetCache() {
  _cache = null;
  _cacheAt = 0;
}

module.exports = { loadSiloStateSync, _resetCache };
