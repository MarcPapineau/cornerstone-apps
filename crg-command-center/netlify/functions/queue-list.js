/**
 * Netlify Function: /.netlify/functions/queue-list
 * GET — returns the live task queue from Netlify Blobs.
 *
 * Falls back to an in-memory seed if Netlify Blobs is unavailable
 * (e.g. local dev without `netlify dev`).
 *
 * Item shape:
 *   { id, title, source, created_at, completed_at, ai_estimate, human_estimate, priority, silo }
 */

const { checkAuth, unauthorized } = require('./_lib/garvis-auth');

const STORE_NAME = 'garvis-queue';
const KEY = 'queue.json';

const SEED_QUEUE = [
  {
    id: 'seed-benaiah-env',
    title: 'Set BENAIAH Netlify env vars (unblock Send button)',
    source: 'overnight-build',
    created_at: '2026-04-19T05:00:00Z',
    completed_at: null,
    ai_estimate: '0min',
    human_estimate: '5min',
    priority: 'HIGH',
    silo: 'mortgage-brokers'
  },
  {
    id: 'seed-jason-presentation',
    title: 'Review Jason Anbara custom presentation',
    source: 'overnight-build',
    created_at: '2026-04-19T05:05:00Z',
    completed_at: null,
    ai_estimate: '0min',
    human_estimate: '10min',
    priority: 'HIGH',
    silo: 'mortgage-brokers'
  },
  {
    id: 'seed-paste-ghl-emails',
    title: 'Paste 7 mortgage-licensing email templates into GHL',
    source: 'manual',
    created_at: '2026-04-19T05:10:00Z',
    completed_at: null,
    ai_estimate: '0min',
    human_estimate: '15min',
    priority: 'HIGH',
    silo: 'mortgage-brokers'
  },
  {
    id: 'seed-vault-keeper',
    title: 'Approve Vault Keeper / Levite agent build',
    source: 'overnight-build',
    created_at: '2026-04-19T05:15:00Z',
    completed_at: null,
    ai_estimate: '5min',
    human_estimate: '10min',
    priority: 'MEDIUM',
    silo: 'platform'
  }
];

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

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: cors(), body: '' };
  }
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: cors(), body: JSON.stringify({ error: 'method_not_allowed' }) };
  }

  if (!checkAuth(event)) return unauthorized(cors());

  const store = await loadStore();
  let queue = SEED_QUEUE;
  let backend = 'seed';

  if (store) {
    backend = 'netlify-blobs';
    try {
      const raw = await store.get(KEY, { type: 'json' });
      if (raw && Array.isArray(raw.items)) {
        queue = raw.items;
      } else {
        // First run — seed it
        await store.setJSON(KEY, { items: SEED_QUEUE, updated_at: new Date().toISOString() });
        queue = SEED_QUEUE;
      }
    } catch (err) {
      backend = 'seed-fallback';
      queue = SEED_QUEUE;
    }
  }

  // Sort: pending first by priority then created_at, then completed last
  const prioRank = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  queue = [...queue].sort((a, b) => {
    const ad = a.completed_at ? 1 : 0;
    const bd = b.completed_at ? 1 : 0;
    if (ad !== bd) return ad - bd;
    const pa = prioRank[a.priority] ?? 9;
    const pb = prioRank[b.priority] ?? 9;
    if (pa !== pb) return pa - pb;
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });

  return {
    statusCode: 200,
    headers: cors(),
    body: JSON.stringify({
      backend,
      count: queue.length,
      pending: queue.filter((i) => !i.completed_at).length,
      items: queue,
      timestamp: new Date().toISOString()
    })
  };
};
