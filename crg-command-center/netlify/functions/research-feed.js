/**
 * Netlify Function: /.netlify/functions/research-feed
 * GET — returns the most recent peptide-research items from the Luke app feed.
 *
 * Strategy:
 *   1. Try Netlify Blobs ('garvis-content' store, key 'research-feed.json')
 *   2. Fallback: structured placeholder.
 *
 * Shape:
 *   { count, items: [{ slug, title, category, last_updated }], browse_url, generated_at }
 */

const { checkAuth, unauthorized } = require('./_lib/garvis-auth');

const STORE_NAME = 'garvis-content';
const KEY = 'research-feed.json';

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store'
  };
}

const PLACEHOLDER = {
  count: 0,
  items: [
    { slug: 'bpc-157',     title: 'BPC-157',     category: 'Healing',   last_updated: null },
    { slug: 'tb-500',      title: 'TB-500',      category: 'Healing',   last_updated: null },
    { slug: 'cjc-1295',    title: 'CJC-1295',    category: 'GH-axis',   last_updated: null },
    { slug: 'ipamorelin',  title: 'Ipamorelin',  category: 'GH-axis',   last_updated: null },
    { slug: 'tesamorelin', title: 'Tesamorelin', category: 'GH-axis',   last_updated: null }
  ],
  browse_url: 'https://peptide-resource-app.netlify.app/',
  generated_at: null,
  note: 'Awaiting overnight peptide research index publish.'
};

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors(), body: '' };

  if (!checkAuth(event)) return unauthorized(cors());

  let feed = PLACEHOLDER;

  try {
    const { getStore } = await import('@netlify/blobs');
    const store = getStore({ name: STORE_NAME, consistency: 'eventual' });
    const data = await store.get(KEY, { type: 'json' });
    if (data && Array.isArray(data.items)) feed = data;
  } catch (_) {
    // fall through to placeholder
  }

  return { statusCode: 200, headers: cors(), body: JSON.stringify(feed) };
};
