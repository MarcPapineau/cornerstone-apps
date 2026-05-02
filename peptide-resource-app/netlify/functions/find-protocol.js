// netlify/functions/find-protocol.js
// ---------------------------------------------------------------------------
// Proxies Anthropic's API for the /research compound-finder.
//
// Security/cost posture (rebuilt 2026-05-01 — Builder pass):
//   BUG #1 (P0) — Server-side system prompt only. Client may NOT supply
//                 `systemPrompt`. If they try, we ignore it and log.
//                 See netlify/functions/vitalis-system-prompt.js.
//   BUG #2 (P0) — Origin/referrer allowlist + per-IP rate limit + tightened
//                 CORS. Anonymous abuse is no longer free.
//   BUG #3 (P1) — Model is `claude-sonnet-4-6` per Marc's foundational memory
//                 `feedback_never_use_haiku_for_research.md`:
//                 "NEVER use Haiku for research. Hard rule."
//                 Do NOT swap back to Haiku without rewriting that doctrine.
// ---------------------------------------------------------------------------

const { buildFindProtocolSystemPrompt } = require('./vitalis-system-prompt.js');

// ---------------------------------------------------------------------------
// Origin allowlist
// ---------------------------------------------------------------------------
// Verified from sibling functions (request-access.js, welcome-email.js,
// approve-access.js — all hardcode this domain). The app is deployed at
// `peptide-resource-app.netlify.app`. If/when a custom domain (e.g.
// vitalisbiosciences.ca) is wired up, add it here AND ship via Builder pipeline.
const ALLOWED_ORIGINS = [
  'https://peptide-resource-app.netlify.app',
  // Local dev (vite default + netlify dev default)
  'http://localhost:5173',
  'http://localhost:8888',
];

function isAllowedOrigin(originHeader, refererHeader) {
  if (originHeader && ALLOWED_ORIGINS.includes(originHeader)) return true;
  if (refererHeader) {
    return ALLOWED_ORIGINS.some(allowed => refererHeader.startsWith(allowed + '/') || refererHeader === allowed);
  }
  return false;
}

function corsHeadersFor(originHeader) {
  // Echo back the matched origin (never `*`). If no match, echo the canonical
  // production origin so preflight from the deployed app still works while
  // unauthorized origins fail closed in the main handler.
  const allowed = ALLOWED_ORIGINS.includes(originHeader) ? originHeader : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

// ---------------------------------------------------------------------------
// In-memory per-IP rate limit (sliding 60s window, 5 req/min/IP)
// ---------------------------------------------------------------------------
// Netlify Functions reuse the warm execution environment between invocations
// (AWS Lambda container reuse). A module-scope Map persists across calls on
// the same warm instance. Cold starts reset the counter — this is acceptable
// for an abuse brake, not for billing-grade enforcement. If we need stronger
// guarantees later, swap in @netlify/blobs (see vitalis-chat.js for pattern).
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX       = 5;
const ipHits = new Map(); // ip -> [timestamp_ms, ...]

function getClientIp(event) {
  // Netlify forwards via x-nf-client-connection-ip (preferred) or x-forwarded-for
  const h = event.headers || {};
  const direct = h['x-nf-client-connection-ip'] || h['X-Nf-Client-Connection-Ip'];
  if (direct) return direct;
  const fwd = h['x-forwarded-for'] || h['X-Forwarded-For'];
  if (fwd) return fwd.split(',')[0].trim();
  return 'unknown';
}

function checkRateLimit(ip) {
  const now = Date.now();
  const cutoff = now - RATE_LIMIT_WINDOW_MS;
  const hits = (ipHits.get(ip) || []).filter(t => t > cutoff);
  hits.push(now);
  ipHits.set(ip, hits);
  // Soft-evict map if it grows large (memory hygiene on long warm instances)
  if (ipHits.size > 1000) {
    for (const [k, v] of ipHits.entries()) {
      const filtered = v.filter(t => t > cutoff);
      if (filtered.length === 0) ipHits.delete(k);
      else ipHits.set(k, filtered);
    }
  }
  return { allowed: hits.length <= RATE_LIMIT_MAX, count: hits.length };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
exports.handler = async (event) => {
  const originHeader  = (event.headers && (event.headers.origin  || event.headers.Origin))  || '';
  const refererHeader = (event.headers && (event.headers.referer || event.headers.Referer)) || '';
  const cors = corsHeadersFor(originHeader);

  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: cors, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: cors, body: 'Method Not Allowed' };
  }

  // Origin/referrer allowlist (BUG #2)
  if (!isAllowedOrigin(originHeader, refererHeader)) {
    console.warn('[find-protocol] origin reject', { origin: originHeader, referer: refererHeader });
    return {
      statusCode: 403,
      headers: cors,
      body: JSON.stringify({ error: 'Forbidden' }),
    };
  }

  // Per-IP rate limit (BUG #2)
  const ip = getClientIp(event);
  const rl = checkRateLimit(ip);
  if (!rl.allowed) {
    console.warn('[find-protocol] rate limit', { ip, count: rl.count });
    return {
      statusCode: 429,
      headers: { ...cors, 'Retry-After': '60' },
      body: JSON.stringify({ error: 'Too many requests. Please wait a minute and try again.' }),
    };
  }

  // Parse body
  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  // BUG #1: detect and refuse client-supplied systemPrompt.
  // Strict-reject (not silent-ignore) so the caller learns the contract.
  if (body && Object.prototype.hasOwnProperty.call(body, 'systemPrompt')) {
    console.warn('[find-protocol] client tried to inject systemPrompt — rejecting', { ip });
    return {
      statusCode: 400,
      headers: cors,
      body: JSON.stringify({ error: 'systemPrompt is not accepted from clients. The system prompt is fixed server-side.' }),
    };
  }

  const { query, catalog } = body || {};
  if (!query || typeof query !== 'string' || query.trim().length < 3) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Query too short' }) };
  }

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_KEY) {
    return {
      statusCode: 503,
      headers: cors,
      body: JSON.stringify({ error: 'Search temporarily unavailable — ANTHROPIC_API_KEY not configured' }),
    };
  }

  // Build the system prompt server-side from a fixed template + sanitized catalog
  const systemPrompt = buildFindProtocolSystemPrompt(catalog);

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        // BUG #3: Sonnet 4.6 per `feedback_never_use_haiku_for_research.md`.
        // Bumped max_tokens from 1200 -> 2400 because Haiku's smaller cap was
        // the only reason it was 1200; Sonnet handles the JSON catalog match
        // task with more headroom and rarely truncates at 2400.
        model: 'claude-sonnet-4-6',
        max_tokens: 2400,
        system: systemPrompt,
        messages: [{ role: 'user', content: `My situation: ${query.trim()}` }],
      }),
    });

    const data = await resp.json();
    const text = data.content?.[0]?.text || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { statusCode: 500, headers: cors, body: JSON.stringify({ error: 'Parse error', raw: text.slice(0, 200) }) };
    }
    const result = JSON.parse(jsonMatch[0]);
    return {
      statusCode: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, query: query.trim(), result }),
    };
  } catch (err) {
    console.error('[find-protocol] anthropic error', err.message);
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: err.message }) };
  }
};
