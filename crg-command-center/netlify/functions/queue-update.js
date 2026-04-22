/**
 * Netlify Function: /.netlify/functions/queue-update
 * POST — mutate a queue item.
 *
 * Body (JSON):
 *   { id: string, action: 'complete' | 'reopen' | 'add' | 'delete', payload?: {...} }
 *
 * For action: 'add', payload should be a partial queue-item.
 */

const { checkAuth, unauthorized } = require('./_lib/garvis-auth');

const STORE_NAME = 'garvis-queue';
const KEY = 'queue.json';

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: cors(), body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: cors(), body: JSON.stringify({ error: 'method_not_allowed' }) };
  }

  if (!checkAuth(event)) return unauthorized(cors());

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (_) {
    return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: 'invalid_json' }) };
  }

  const { id, action, payload } = body;
  if (!action) {
    return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: 'missing_action' }) };
  }

  const store = await loadStore();
  if (!store) {
    return {
      statusCode: 503,
      headers: cors(),
      body: JSON.stringify({ error: 'blobs_unavailable', detail: 'Run via Netlify Dev/Prod for persistent queue.' })
    };
  }

  let data = await store.get(KEY, { type: 'json' });
  if (!data || !Array.isArray(data.items)) data = { items: [] };

  const items = data.items;
  let result = null;

  if (action === 'complete') {
    const idx = items.findIndex((i) => i.id === id);
    if (idx === -1) return { statusCode: 404, headers: cors(), body: JSON.stringify({ error: 'not_found' }) };
    items[idx].completed_at = new Date().toISOString();
    result = items[idx];
  } else if (action === 'reopen') {
    const idx = items.findIndex((i) => i.id === id);
    if (idx === -1) return { statusCode: 404, headers: cors(), body: JSON.stringify({ error: 'not_found' }) };
    items[idx].completed_at = null;
    result = items[idx];
  } else if (action === 'delete') {
    const idx = items.findIndex((i) => i.id === id);
    if (idx === -1) return { statusCode: 404, headers: cors(), body: JSON.stringify({ error: 'not_found' }) };
    result = items.splice(idx, 1)[0];
  } else if (action === 'add') {
    const newItem = {
      id: payload?.id || ('q-' + Math.random().toString(36).slice(2, 10)),
      title: payload?.title || 'Untitled task',
      source: payload?.source || 'manual',
      created_at: new Date().toISOString(),
      completed_at: null,
      ai_estimate: payload?.ai_estimate || null,
      human_estimate: payload?.human_estimate || null,
      priority: payload?.priority || 'MEDIUM',
      silo: payload?.silo || 'platform'
    };
    items.push(newItem);
    result = newItem;
  } else {
    return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: 'unknown_action' }) };
  }

  data.items = items;
  data.updated_at = new Date().toISOString();
  await store.setJSON(KEY, data);

  return {
    statusCode: 200,
    headers: cors(),
    body: JSON.stringify({ ok: true, item: result, count: items.length })
  };
};
