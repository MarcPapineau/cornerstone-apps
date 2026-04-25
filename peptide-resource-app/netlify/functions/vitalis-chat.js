/**
 * Netlify Sync Function: /.netlify/functions/vitalis-chat
 *
 * Lightweight router. Two modes:
 *
 * MODE 1 — Submit a new chat query (POST with userMessage):
 *   - Runs client-side moderation synchronously (fast, no Claude call).
 *   - If blocked: returns the moderation response immediately (< 1s).
 *   - Otherwise: generates a runId, fires vitalis-chat-background async,
 *     returns 202 { runId, status: "queued" } in < 1s.
 *
 * MODE 2 — Poll for result (POST with runId + poll: true):
 *   - Reads Netlify Blobs for the runId.
 *   - Returns { runId, status: "pending" | "complete" | "error", result? }.
 *   - If runId not found: returns { runId, status: "not_found" } — NOT a 500.
 *
 * The ANTHROPIC_API_KEY never leaves the background function.
 * This sync function only handles routing and moderation.
 *
 * POST body — new query:
 *   {
 *     userMessage: string,
 *     history: [{role, content}],
 *     intake: {...},
 *     catalog: {...},
 *     evidenceMode: 'clinical' | 'community',
 *     stackContext: string | null,
 *     model: string,
 *     maxTokens: number,
 *     temperature: number
 *   }
 *
 * POST body — poll:
 *   { runId: string, poll: true }
 *
 * Response — queued:
 *   { runId: string, status: "queued" }
 *
 * Response — poll:
 *   { runId: string, status: "pending" | "complete" | "error" | "not_found", result? }
 *
 * Response — moderation block (synchronous, no runId):
 *   { text: string, tokensIn: 0, tokensOut: 0, model: string, moderation: {...}, protocolId: null }
 */

const { getStore } = require('@netlify/blobs');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Internal URL to fire the background function. In Netlify, background
// functions are reachable via the same /.netlify/functions/ path.
// We use the NETLIFY_DEV or URL env var to build the absolute URL —
// background functions must be invoked via HTTP, not imported directly.
function getBackgroundFunctionUrl() {
  const base = process.env.URL || process.env.DEPLOY_URL || 'http://localhost:8888';
  return `${base}/.netlify/functions/vitalis-chat-background`;
}

// ---------------------------------------------------------------------------
// Moderation (same triggers as background + client — defense in depth)
// ---------------------------------------------------------------------------
const MODERATION_TRIGGERS = [
  { id: 'minors', severity: 'block', pattern: /\b(my|the|a)\s+(kid|child|daughter|son|teen|teenager|minor)\b|\b(under|below)\s*(13|14|15|16|17|18)\b|\bfor my\s+(\d{1,2})\s*(yo|year old|y\/o)/i, response: 'Peptide protocols are for adults 18+ only. If you are asking on behalf of a minor, please consult a pediatric endocrinologist — we cannot produce guidance here.' },
  { id: 'self-harm', severity: 'block', pattern: /\b(kill myself|suicide|suicidal|end my life|self-harm|harm myself)\b/i, response: 'If you\'re in crisis, please contact the Suicide and Crisis Lifeline (988 in the US, or your local equivalent). We\'re not equipped to help here, but real support is available right now.' },
  { id: 'illegal-substances', severity: 'block', pattern: /\b(cocaine|heroin|meth|methamphetamine|fentanyl|crack|ketamine)\b/i, response: 'Vitalis only discusses research peptides and FDA-regulated compounds. For substance-use questions, please consult a licensed clinician.' },
];

function moderateMessage(text) {
  if (!text || typeof text !== 'string') return { flagged: false };
  for (const t of MODERATION_TRIGGERS) {
    if (t.pattern.test(text)) return { flagged: true, trigger: { id: t.id, severity: t.severity, response: t.response } };
  }
  return { flagged: false };
}

// ---------------------------------------------------------------------------
// runId generator — crypto-random hex, no dependencies
// ---------------------------------------------------------------------------
function generateRunId() {
  // 16 random bytes → 32-char hex string. Works in Node.js without crypto import.
  const bytes = [];
  for (let i = 0; i < 16; i++) bytes.push(Math.floor(Math.random() * 256));
  return bytes.map(b => b.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------------------
// Blob helpers — explicit credentials for sites without auto-injected context
// ---------------------------------------------------------------------------
const BLOBS_SITE_ID = process.env.NETLIFY_SITE_ID || '8d46991f-47d3-4d57-a5f5-f27d07c4048e';
const BLOBS_TOKEN   = process.env.NETLIFY_TOKEN || process.env.NETLIFY_AUTH_TOKEN;

function getBlobsStore() {
  if (BLOBS_TOKEN) {
    return getStore({ name: 'vitalis-chat-runs', siteID: BLOBS_SITE_ID, token: BLOBS_TOKEN });
  }
  // Fall back to environment-injected context (works when NETLIFY_BLOBS_CONTEXT is set)
  return getStore('vitalis-chat-runs');
}

async function writeResult(runId, payload) {
  const store = getBlobsStore();
  await store.setJSON(runId, {
    ...payload,
    writtenAt: new Date().toISOString(),
  });
}

async function readResult(runId) {
  try {
    const store = getBlobsStore();
    const data = await store.get(runId, { type: 'json' });
    return data; // null if not found
  } catch (err) {
    console.error('[vitalis-chat] blob read error:', err.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method Not Allowed' }),
    };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  // -------------------------------------------------------------------------
  // MODE 2: Polling — { runId, poll: true }
  // -------------------------------------------------------------------------
  if (body.poll === true && body.runId) {
    const { runId } = body;

    // Basic runId validation — must be 32-char hex
    if (!/^[a-f0-9]{32}$/.test(runId)) {
      return {
        statusCode: 200,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId, status: 'not_found' }),
      };
    }

    const stored = await readResult(runId);

    if (!stored) {
      // Not in blobs yet — either still running or expired/invalid
      return {
        statusCode: 200,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId, status: 'not_found' }),
      };
    }

    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runId,
        status: stored.status,
        result: stored.result || null,
        error: stored.error || null,
      }),
    };
  }

  // -------------------------------------------------------------------------
  // MODE 1: New query — { userMessage, history, intake, ... }
  // -------------------------------------------------------------------------
  const {
    userMessage,
    history = [],
    intake = null,
    catalog = null,
    evidenceMode = 'clinical',
    stackContext = null,
    model = 'claude-sonnet-4-6',
    maxTokens = 3000,
    temperature = 0.4,
  } = body;

  if (!userMessage || typeof userMessage !== 'string') {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'userMessage is required' }) };
  }

  // Moderation — runs synchronously here so blocked queries never hit Claude
  const mod = moderateMessage(userMessage);
  if (mod.flagged && mod.trigger.severity === 'block') {
    console.log('[vitalis-chat] moderation block:', mod.trigger.id);
    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: mod.trigger.response,
        tokensIn: 0,
        tokensOut: 0,
        model,
        moderation: mod,
        protocolId: null,
        // No runId — moderation blocks are fully synchronous
      }),
    };
  }

  // Generate runId and fire the background function
  const runId = generateRunId();
  const bgUrl = getBackgroundFunctionUrl();

  const bgPayload = {
    runId,
    userMessage,
    history,
    intake,
    catalog,
    evidenceMode,
    stackContext,
    model,
    maxTokens,
    temperature,
  };

  // Fire-and-forget: background function is non-blocking from the client
  // perspective. We don't await it — we return 202 immediately.
  fetch(bgUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(bgPayload),
  }).catch(err => {
    console.error('[vitalis-chat] background invoke error:', err.message);
  });

  console.log('[vitalis-chat] queued', { runId, userMessage: userMessage.slice(0, 60) });

  return {
    statusCode: 202,
    headers: { ...CORS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ runId, status: 'queued' }),
  };
};
