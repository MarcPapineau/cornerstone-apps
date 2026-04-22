/**
 * Netlify Function: /.netlify/functions/command-samuel-digest
 *
 * GET — returns the latest Samuel weekly eval digest.
 *
 * Backends tried in order:
 *   1. Netlify Blobs store "samuel" (key: 'latest.json') — will be populated
 *      once samuel-background is updated to emit a `samuel.digest` event and
 *      persist alongside.
 *   2. Static stub at data/samuel-digest.json — empty until first real run.
 *
 * Digest shape (when present):
 *   {
 *     date: ISO,
 *     proposals: [
 *       { agent_id, agent_name, suggested_change, confidence (0-1), rationale }
 *     ],
 *     score_deltas: [
 *       { agent_id, agent_name, prev_grade, new_grade, delta }
 *     ],
 *     flagged_agents: [ { agent_id, reason } ],
 *     summary: string
 *   }
 */

const fs = require('fs');
const path = require('path');
const { checkAuth, unauthorized } = require('./_lib/garvis-auth');

const STORE_NAME = 'samuel';
const KEY = 'latest.json';

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

function readStub() {
  const candidates = [
    path.resolve(__dirname, '..', '..', 'data', 'samuel-digest.json'),
    path.resolve(process.cwd(), 'data', 'samuel-digest.json')
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const raw = fs.readFileSync(p, 'utf8');
        return JSON.parse(raw);
      }
    } catch (_) {
      /* try next */
    }
  }
  return { latest: null };
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

  let backend = 'stub';
  let digest = null;
  let note = null;

  const store = await loadStore();
  if (store) {
    try {
      const val = await store.get(KEY, { type: 'json' });
      if (val) {
        digest = val;
        backend = 'netlify-blobs';
      } else {
        backend = 'netlify-blobs-empty';
      }
    } catch (_) {
      backend = 'stub-fallback';
    }
  }

  if (!digest) {
    const stub = readStub();
    digest = stub.latest || null;
    if (stub.note) note = stub.note;
  }

  return {
    statusCode: 200,
    headers: cors(),
    body: JSON.stringify({
      backend,
      has_digest: !!digest,
      digest,
      note:
        note ||
        (digest
          ? null
          : 'Samuel has not run yet — next eval Monday 06:00 UTC.'),
      timestamp: new Date().toISOString()
    })
  };
};
