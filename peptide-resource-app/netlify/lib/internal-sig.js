/**
 * Shared internal-call signing — protects the background function from
 * direct/unauthorized invocation. Used by:
 *   - vitalis-chat.js                (signs requests it sends to the bg fn)
 *   - vitalis-chat-background.js     (verifies incoming requests)
 *
 * Threat model
 * ------------
 * Background functions live at a PUBLIC URL: /.netlify/functions/<name>.
 * Without auth, anyone can POST arbitrary payloads and the function will
 * call Anthropic with the site's ANTHROPIC_API_KEY — i.e., free
 * inference on Marc's bill, plus a moderation bypass.
 *
 * Mitigation: HMAC-SHA256 over a compact JSON header carried in the
 * `x-internal-sig` request header. Replay prevented by a 30-second
 * timestamp window. Comparison is timing-safe.
 *
 * Wire format
 * -----------
 * Header value (single line, no spaces): `t=<unix-ms>,r=<runId>,s=<hex-sig>`
 *   - t: client clock (ms since epoch) at sign time
 *   - r: runId being submitted (binds the signature to this specific request)
 *   - s: hex(HMAC_SHA256(secret, `${t}.${r}`))
 *
 * The receiver re-derives s from t+r+secret, timing-safe-compares to the
 * delivered s, and checks `Math.abs(now - t) <= REPLAY_WINDOW_MS`.
 */

const crypto = require('crypto');

const REPLAY_WINDOW_MS = 30_000; // 30 seconds — generous for clock skew + cold start
const SIG_HEADER = 'x-internal-sig';

/**
 * Build the canonical message for HMAC. Kept tiny + deterministic so both
 * sides hash exactly the same bytes regardless of body shape/key order.
 */
function canonicalMessage(timestampMs, runId) {
  return `${timestampMs}.${runId}`;
}

/**
 * Sign — used by the sync router before fire-and-forget POST to bg fn.
 * @param {string} secret  - INTERNAL_FN_SECRET env var
 * @param {string} runId   - 32-char hex run id we are dispatching
 * @returns {string} header value to set on x-internal-sig
 */
function sign(secret, runId) {
  if (!secret) throw new Error('INTERNAL_FN_SECRET not configured');
  if (!runId || typeof runId !== 'string') throw new Error('runId required for signing');
  const t = Date.now();
  const sig = crypto
    .createHmac('sha256', secret)
    .update(canonicalMessage(t, runId))
    .digest('hex');
  return `t=${t},r=${runId},s=${sig}`;
}

/**
 * Parse header value into { t, r, s }. Returns null on malformed input.
 */
function parseHeader(headerValue) {
  if (!headerValue || typeof headerValue !== 'string') return null;
  const parts = headerValue.split(',').map(p => p.trim());
  const out = {};
  for (const p of parts) {
    const eq = p.indexOf('=');
    if (eq < 1) return null;
    const k = p.slice(0, eq);
    const v = p.slice(eq + 1);
    if (!k || !v) return null;
    out[k] = v;
  }
  if (!out.t || !out.r || !out.s) return null;
  const tNum = Number(out.t);
  if (!Number.isFinite(tNum)) return null;
  return { t: tNum, r: out.r, s: out.s };
}

/**
 * Verify — used by the background function on every incoming request.
 *
 * Returns one of:
 *   { ok: true,  runId }
 *   { ok: false, reason: 'missing_header' | 'malformed' | 'stale' | 'bad_runid' | 'bad_signature' | 'no_secret' }
 *
 * Fails CLOSED — if the secret env var is missing, every request is
 * rejected. Better to refuse traffic than to ship a quietly-disabled
 * auth check.
 */
function verify(secret, headerValue, expectedRunIdInBody) {
  if (!secret) return { ok: false, reason: 'no_secret' };
  if (!headerValue) return { ok: false, reason: 'missing_header' };

  const parsed = parseHeader(headerValue);
  if (!parsed) return { ok: false, reason: 'malformed' };

  // Replay window
  const skew = Math.abs(Date.now() - parsed.t);
  if (!Number.isFinite(skew) || skew > REPLAY_WINDOW_MS) {
    return { ok: false, reason: 'stale' };
  }

  // Bind signature to the runId that's actually in the request body.
  // Prevents reusing a captured sig with a different payload.
  if (expectedRunIdInBody && parsed.r !== expectedRunIdInBody) {
    return { ok: false, reason: 'bad_runid' };
  }

  const expected = crypto
    .createHmac('sha256', secret)
    .update(canonicalMessage(parsed.t, parsed.r))
    .digest('hex');

  // Timing-safe compare. Both buffers must be the same length, otherwise
  // timingSafeEqual throws — guard with a length check first.
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(parsed.s, 'hex');
  if (a.length !== b.length) return { ok: false, reason: 'bad_signature' };
  if (!crypto.timingSafeEqual(a, b)) return { ok: false, reason: 'bad_signature' };

  return { ok: true, runId: parsed.r };
}

module.exports = {
  REPLAY_WINDOW_MS,
  SIG_HEADER,
  sign,
  verify,
  // exported for tests
  _canonicalMessage: canonicalMessage,
  _parseHeader: parseHeader,
};
