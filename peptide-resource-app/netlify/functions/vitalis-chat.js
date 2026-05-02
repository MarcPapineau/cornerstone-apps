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
const { randomBytes } = require('crypto');
const { moderateMessage } = require('../lib/moderation');
const { sign: signInternal, SIG_HEADER } = require('../lib/internal-sig');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// 1 hour — Blob retention window for completed/queued runs.
// Stored as an `expiresAt` ISO timestamp in metadata (Bug #3 fix).
// Netlify Blobs do NOT auto-expire; callers should treat anything past
// expiresAt as eligible for cleanup. A separate sweep job (out of scope
// for this patch) can enumerate the store and delete stale keys.
const BLOB_TTL_MS = 60 * 60 * 1000;

// Internal URL to fire the background function. In Netlify, background
// functions are reachable via the same /.netlify/functions/ path.
// We use the NETLIFY_DEV or URL env var to build the absolute URL —
// background functions must be invoked via HTTP, not imported directly.
function getBackgroundFunctionUrl() {
  const base = process.env.URL || process.env.DEPLOY_URL || 'http://localhost:8888';
  return `${base}/.netlify/functions/vitalis-chat-background`;
}

// Moderation logic lives in netlify/lib/moderation.js so the sync router
// AND the background function share the exact same trigger set + response
// strings. Both paths must call moderateMessage() before any Anthropic call.

// ---------------------------------------------------------------------------
// runId generator — true crypto-random hex via Node stdlib `crypto`.
//
// WKU rationale (Wisdom·Knowledge·Understanding, Proverbs 24:3-4):
//   Wisdom — runId is the BLOB KEY that stores chat output. A guessable runId
//     lets an attacker poll another user's blob, leaking protocol content.
//   Knowledge — Math.random() is a non-cryptographic PRNG (V8 uses xorshift128+),
//     seedable + predictable. The prior comment claimed "crypto-random" — theater.
//     Node's `crypto.randomBytes(16)` reads from the OS CSPRNG (/dev/urandom on
//     Linux, BCryptGenRandom on Windows). Built into Node 18+ stdlib, no new dep.
//   Understanding — F1 fix (P1 bug): swap Math.random for randomBytes. 16 bytes
//     → 32-char hex matches the existing `^[a-f0-9]{32}$` validator at line 159
//     so no other call sites need to change.
// ---------------------------------------------------------------------------
function generateRunId() {
  // 16 random bytes from the OS CSPRNG → 32-char hex string.
  return randomBytes(16).toString('hex');
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
  const writtenAt = new Date();
  const expiresAt = new Date(writtenAt.getTime() + BLOB_TTL_MS);
  // Bug #3 fix: write explicit expiresAt metadata. Netlify Blobs does not
  // auto-expire — the prior doc-comment claim was theater. A future sweep
  // job (out of scope here) can enumerate keys and delete past expiresAt.
  await store.setJSON(
    runId,
    {
      ...payload,
      writtenAt: writtenAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    },
    { metadata: { expiresAt: expiresAt.toISOString(), ttlMs: BLOB_TTL_MS } }
  );
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

  // Bug #1 fix: sign every internal call so the bg function can refuse
  // unauthenticated direct invocations. Fail closed if the secret env var
  // is missing — better to refuse traffic than to ship with auth disabled.
  const internalSecret = process.env.INTERNAL_FN_SECRET;
  if (!internalSecret) {
    console.error('[vitalis-chat] INTERNAL_FN_SECRET not configured — refusing dispatch');
    return {
      statusCode: 503,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Chat service misconfigured. Please contact Marc.' }),
    };
  }
  const sigHeader = signInternal(internalSecret, runId);

  // Fire-and-forget: background function is non-blocking from the client
  // perspective. We don't await it — we return 202 immediately.
  fetch(bgUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      [SIG_HEADER]: sigHeader,
    },
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
