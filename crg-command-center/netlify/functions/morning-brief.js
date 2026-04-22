/**
 * Netlify Function: /.netlify/functions/morning-brief
 * GET — returns the latest morning brief.
 *
 * Strategy:
 *   1. Try Netlify Blobs ('garvis-content' store, key 'morning-brief-latest.json')
 *   2. Fallback: structured placeholder so the dashboard tile never breaks.
 *
 * Shape:
 *   { date: 'YYYY-MM-DD', title, bullets: string[], full_url, generated_at }
 */

const { checkAuth, unauthorized } = require('./_lib/garvis-auth');

const STORE_NAME = 'garvis-content';
const KEY = 'morning-brief-latest.json';

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store'
  };
}

function todayISO() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

const PLACEHOLDER = {
  date: todayISO(),
  title: 'Morning brief — pending',
  bullets: [
    'No brief published yet today.',
    'Daniel agent runs the brief at 06:00 ET — check back at 6:05am.',
    '9 standing topics: tech, AI, mortgage rates, peptides, RE, family-office, longevity, AI ops, mortgage broker industry.'
  ],
  full_url: '/morning-briefs/' + todayISO() + '.md',
  generated_at: null
};

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors(), body: '' };

  if (!checkAuth(event)) return unauthorized(cors());

  let brief = PLACEHOLDER;

  try {
    const { getStore } = await import('@netlify/blobs');
    const store = getStore({ name: STORE_NAME, consistency: 'eventual' });
    const data = await store.get(KEY, { type: 'json' });
    if (data && data.title) brief = data;
  } catch (_) {
    // fall through to placeholder
  }

  return { statusCode: 200, headers: cors(), body: JSON.stringify(brief) };
};
