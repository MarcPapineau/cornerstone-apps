/**
 * Netlify Function: /.netlify/functions/command-events
 *
 * GET — returns the recent agent-bus event stream.
 *
 * Primary backend: Netlify Blobs store "events" (written by Wave 2a's
 * persistence migration). Keys are sortable timestamps; values are event
 * objects of shape:
 *   { timestamp, source, type, payload }
 *
 * If the Blobs store is unreachable (Wave 2a not yet merged) we fall
 * back to a static stub at data/events.json which currently carries an
 * empty array — the UI shows a graceful empty state.
 *
 * Query params:
 *   ?limit=50   (default 50, max 200)
 *   ?before=<ISO timestamp>  — for "Load older" pagination
 */

const fs = require('fs');
const path = require('path');
const { checkAuth, unauthorized } = require('./_lib/garvis-auth');

const STORE_NAME = 'events';
const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store'
  };
}

async function loadStore() {
  try {
    const { getStore } = await import('@netlify/blobs');
    return getStore({ name: STORE_NAME, consistency: 'strong' });
  } catch (_) {
    return null;
  }
}

function readStubEvents() {
  const candidates = [
    path.resolve(__dirname, '..', '..', 'data', 'events.json'),
    path.resolve(process.cwd(), 'data', 'events.json')
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const raw = fs.readFileSync(p, 'utf8');
        const obj = JSON.parse(raw);
        if (obj && Array.isArray(obj.events)) return obj.events;
      }
    } catch (_) {
      /* try next */
    }
  }
  return [];
}

async function readFromBlobs(store, limit, before) {
  // List keys (sortable timestamps) and read most recent up to limit.
  let keys = [];
  try {
    const listed = await store.list();
    keys = (listed && listed.blobs ? listed.blobs : []).map((b) => b.key);
  } catch (_) {
    return null;
  }
  // Sort desc — keys should be ISO timestamps or timestamp-prefixed
  keys.sort();
  keys.reverse();
  if (before) keys = keys.filter((k) => k < before);
  keys = keys.slice(0, limit);

  const events = [];
  for (const k of keys) {
    try {
      const val = await store.get(k, { type: 'json' });
      if (val) events.push(val);
    } catch (_) {
      /* skip unreadable */
    }
  }
  return events;
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: cors(), body: '' };
  }
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers: cors(),
      body: JSON.stringify({ error: 'method_not_allowed' })
    };
  }
  if (!checkAuth(event)) return unauthorized(cors());

  const qs = event.queryStringParameters || {};
  let limit = parseInt(qs.limit, 10);
  if (!Number.isFinite(limit) || limit <= 0) limit = DEFAULT_LIMIT;
  if (limit > MAX_LIMIT) limit = MAX_LIMIT;
  const before = qs.before || null;

  let backend = 'stub';
  let events = [];

  const store = await loadStore();
  if (store) {
    const fromBlobs = await readFromBlobs(store, limit, before);
    if (fromBlobs && fromBlobs.length > 0) {
      backend = 'netlify-blobs';
      events = fromBlobs;
    } else if (fromBlobs) {
      // Reachable but empty — Wave 2a not writing yet
      backend = 'netlify-blobs-empty';
      events = readStubEvents();
    } else {
      backend = 'stub-fallback';
      events = readStubEvents();
    }
  } else {
    events = readStubEvents();
  }

  // Normalize: ensure reverse-chronological
  events = [...events].sort((a, b) => {
    const ta = a.timestamp || a.ts || '';
    const tb = b.timestamp || b.ts || '';
    return tb.localeCompare(ta);
  });
  if (before) events = events.filter((e) => (e.timestamp || '') < before);
  events = events.slice(0, limit);

  return {
    statusCode: 200,
    headers: cors(),
    body: JSON.stringify({
      backend,
      count: events.length,
      limit,
      events,
      timestamp: new Date().toISOString()
    })
  };
};
