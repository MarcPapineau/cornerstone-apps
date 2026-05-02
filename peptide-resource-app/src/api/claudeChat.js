// ============================================================================
// VITALIS CHAT — API CLIENT (BUG-001 fix: polling pattern)
// ============================================================================
// Calls the Netlify sync router (/api/vitalis-chat).
// The ANTHROPIC_API_KEY never reaches the browser — it lives in the
// vitalis-chat-background function only.
//
// Flow:
//   1. POST { userMessage, ... } → 202 { runId, status: "queued" }
//      OR  → 200 { text, moderation } (synchronous moderation block)
//   2. Poll POST { runId, poll: true } every POLL_INTERVAL_MS
//      until status === "complete" | "error" | timeout
//
// Model: swap in one line via MODEL_CONFIG in vitalis-chat-config.js.
// ============================================================================

import { MODEL_CONFIG } from '../data/vitalis-chat-config.js';

const ENDPOINT = '/.netlify/functions/vitalis-chat';
const POLL_INTERVAL_MS = 2000;   // poll every 2 seconds
const POLL_TIMEOUT_MS  = 90000;  // give up after 90 seconds

/**
 * Send a message to the Vitalis chat backend.
 *
 * For a synchronous moderation block, returns immediately with { ok: true, text, moderation }.
 * For a real query, fires the background function, polls until complete, then resolves.
 *
 * @param {Object} params
 * @param {string} params.userMessage
 * @param {Array}  params.history       [{role, content}]
 * @param {Object} params.intake
 * @param {Object} params.catalog
 * @param {string} params.evidenceMode  'clinical' | 'community'
 * @param {string} params.stackContext
 * @param {Function} [params.onStatus]  Optional callback: (status: 'queued'|'polling'|'complete'|'error') => void
 * @returns {Promise<{ok, text, tokensIn, tokensOut, model, costUsd, moderation, protocolId, error}>}
 */
export async function sendMessage({
  userMessage,
  history = [],
  intake = null,
  catalog = null,
  evidenceMode = 'clinical',
  stackContext = null,
  onStatus = null,
} = {}) {
  if (!userMessage || typeof userMessage !== 'string') {
    return { ok: false, error: 'userMessage is required' };
  }

  try {
    // Step 1: Submit the query
    const submitRes = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userMessage,
        history,
        intake,
        catalog,
        evidenceMode,
        stackContext,
        model: MODEL_CONFIG.primary,
        maxTokens: MODEL_CONFIG.maxTokens,
        temperature: MODEL_CONFIG.temperature,
      }),
    });

    if (!submitRes.ok) {
      let errText = `HTTP ${submitRes.status}`;
      try {
        const data = await submitRes.json();
        errText = data.error || errText;
      } catch { /* ignore */ }
      return { ok: false, error: errText, httpStatus: submitRes.status };
    }

    const submitData = await submitRes.json();

    // Synchronous moderation block — no runId, response is immediate
    if (submitData.moderation?.flagged || !submitData.runId) {
      _logCost(submitData);
      return {
        ok: true,
        text: submitData.text || '',
        tokensIn: submitData.tokensIn || 0,
        tokensOut: submitData.tokensOut || 0,
        model: submitData.model || MODEL_CONFIG.primary,
        costUsd: estimateCost(submitData.model, submitData.tokensIn, submitData.tokensOut),
        moderation: submitData.moderation || null,
        protocolId: submitData.protocolId || null,
      };
    }

    // Step 2: Poll for the background result
    const { runId } = submitData;
    if (onStatus) onStatus('queued');

    const result = await _pollForResult(runId, onStatus);
    return result;

  } catch (err) {
    return { ok: false, error: err.message || 'Network error' };
  }
}

/**
 * Poll the sync router for a background result.
 * Resolves when status is "complete" or "error", rejects on timeout.
 *
 * F4 fix (2026-05-01) — patience for cold starts.
 * WKU rationale (Wisdom·Knowledge·Understanding, Proverbs 24:3-4):
 *   Wisdom — Marc and real users see "background function may have failed
 *     to start" as a hard error, then re-send the message. That doubles
 *     Anthropic spend AND duplicates context for the user. Cold-start error
 *     theater costs money and trust.
 *   Knowledge — Netlify Background Function cold starts can take 12-15s
 *     before the function writes its first blob entry. The prior threshold
 *     (5 polls × 2000ms = 10s) gave up BEFORE many legitimate cold starts.
 *     Worse: the counter incremented on every poll regardless of status,
 *     so a transient `pending` between two `not_found`s did not reset it.
 *   Understanding — Track CONSECUTIVE not_found polls only. Any other
 *     status (including pending) means the background function reached the
 *     blob store and is alive. Extend the consecutive threshold to 20 so
 *     even a 30-40s cold start is tolerated. The overall POLL_TIMEOUT_MS
 *     (90s) remains the real backstop. Use a gentle backoff (2/3/5/5/5…)
 *     so users see fewer redundant spinner flashes early without changing
 *     the long-tail behavior.
 */
const NOT_FOUND_GIVEUP_THRESHOLD = 20;
const BACKOFF_INTERVALS_MS = [2000, 3000, 5000];

async function _pollForResult(runId, onStatus) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let pollCount = 0;
  let consecutiveNotFound = 0;

  while (Date.now() < deadline) {
    // Wait before each poll — background function needs at least a moment to
    // start. Backoff array is short; once exhausted we plateau on the last
    // interval (5000ms) so the long tail is still bounded by POLL_TIMEOUT_MS.
    const interval = BACKOFF_INTERVALS_MS[Math.min(pollCount, BACKOFF_INTERVALS_MS.length - 1)];
    await _sleep(interval);
    pollCount++;

    if (onStatus) onStatus('polling');

    let pollData;
    try {
      const pollRes = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId, poll: true }),
      });

      if (!pollRes.ok) {
        // Transient network hiccup — keep trying until deadline.
        // Don't bump consecutiveNotFound: this is a network failure, not a
        // confirmed "blob missing" signal from the server.
        console.warn('[vitalis-chat] poll HTTP error', pollRes.status, '— retrying');
        continue;
      }

      pollData = await pollRes.json();
    } catch (err) {
      console.warn('[vitalis-chat] poll fetch error:', err.message, '— retrying');
      continue;
    }

    const { status, result, error } = pollData;

    if (status === 'complete' && result) {
      if (onStatus) onStatus('complete');
      _logCost(result);
      return {
        ok: true,
        text: result.text || '',
        tokensIn: result.tokensIn || 0,
        tokensOut: result.tokensOut || 0,
        model: result.model || MODEL_CONFIG.primary,
        costUsd: estimateCost(result.model, result.tokensIn, result.tokensOut),
        moderation: result.moderation || null,
        protocolId: result.protocolId || null,
      };
    }

    if (status === 'error') {
      if (onStatus) onStatus('error');
      return {
        ok: false,
        error: error || result?.error || 'Background function reported an error',
      };
    }

    // F4 — count CONSECUTIVE not_found responses; reset on any other status.
    // A transient pending between two not_founds proves the bg function is
    // alive and writing, so we should not treat the next not_found as a
    // continuation of the cold-start window.
    if (status === 'not_found') {
      consecutiveNotFound++;
      if (consecutiveNotFound >= NOT_FOUND_GIVEUP_THRESHOLD) {
        return {
          ok: false,
          error: `Chat job ${runId} not found after ${consecutiveNotFound} consecutive polls — background function may have failed to start`,
        };
      }
    } else {
      consecutiveNotFound = 0;
    }
  }

  if (onStatus) onStatus('error');
  return {
    ok: false,
    error: `Chat timed out after ${POLL_TIMEOUT_MS / 1000}s. The server may still be generating — please try again.`,
    httpStatus: 504,
  };
}

function _sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function _logCost(data) {
  if (data && (data.tokensIn || data.tokensOut)) {
    const cost = estimateCost(data.model, data.tokensIn, data.tokensOut);
    // eslint-disable-next-line no-console
    console.log('[vitalis-chat] cost:', {
      model: data.model,
      in: data.tokensIn,
      out: data.tokensOut,
      usd: cost.toFixed(4),
    });
  }
}

/**
 * Quick cost estimate.
 * Prices per 1M tokens (USD), updated against Anthropic public pricing Apr 2026.
 */
const PRICE_PER_MTOK = {
  'claude-sonnet-4-6': { in: 3, out: 15 },
  'claude-opus-4-7':   { in: 15, out: 75 },
  'claude-haiku-4-5':  { in: 1, out: 5 },
};

function estimateCost(model, tokensIn = 0, tokensOut = 0) {
  const p = PRICE_PER_MTOK[model] || PRICE_PER_MTOK['claude-sonnet-4-6'];
  return (tokensIn * p.in + tokensOut * p.out) / 1_000_000;
}

/**
 * Send the completed stack recommendation to Marc via GHL.
 * Reuses the existing ghl-proxy function — unchanged.
 */
export async function sendStackToMarc({ intake, protocolMarkdown, protocolId, userEmail, userName } = {}) {
  // FX2 (Bundle F-Extension) — defense-in-depth helper-level guard.
  // WKU: Wisdom — F3 already gates at SendToMarcBar, but background callers
  // (retry logic, vitalis-chat-background.js, future test harnesses) could
  // bypass the UI gate and silently create 'chat-anonymous@vitalis.local'
  // GHL contacts that Marc can never reach. Knowledge — throwing at function
  // entry forces every caller to surface the missing-email bug at integration
  // time instead of letting it escape to GHL. Understanding — paired with the
  // INTAKE_SCHEMA email field (FX1), this closes the loophole at both layers
  // (UI + API) per CRG defense-in-depth doctrine.
  if (!userEmail || typeof userEmail !== 'string' || !userEmail.trim()) {
    throw new Error('sendStackToMarc: userEmail is required (no anonymous fallback — Marc must be able to reply)');
  }
  if (!protocolMarkdown) {
    return { ok: false, error: 'protocolMarkdown required' };
  }

  try {
    const note = [
      `Vitalis Chat Protocol Recommendation`,
      `Protocol ID: ${protocolId || 'none'}`,
      ``,
      `Intake:`,
      `- Age: ${intake?.age || 'n/a'}`,
      `- Sex: ${intake?.sex || 'n/a'}`,
      `- Weight: ${intake?.weight || 'n/a'}`,
      `- Goals: ${Array.isArray(intake?.goals) ? intake.goals.join(', ') : intake?.goals || 'n/a'}`,
      `- Athlete: ${intake?.athlete ? 'yes' : 'no'}`,
      `- Pregnancy/TTC: ${intake?.pregnancy ? 'yes' : 'no'}`,
      `- Cancer history: ${intake?.cancer ? `yes (${intake?.cancerType || 'unspecified'})` : 'no'}`,
      ``,
      `Protocol recommendation:`,
      protocolMarkdown,
    ].join('\n');

    const res = await fetch('/.netlify/functions/ghl-proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'inquiry-contact',
        firstName: userName?.split(' ')[0] || 'Vitalis',
        lastName: userName?.split(' ').slice(1).join(' ') || 'Chat User',
        // FX2 — fallback string removed; entry-guard above guarantees userEmail.
        email: userEmail,
        tags: ['vitalis-chat-stack', 'vitalis-protocol'],
        source: 'Vitalis Chat — Protocol Recommendation',
        note,
      }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return { ok: false, error: data.error || `HTTP ${res.status}` };
    }

    const data = await res.json();
    return { ok: true, contactId: data.contactId };
  } catch (err) {
    return { ok: false, error: err.message || 'Network error' };
  }
}

export default sendMessage;
