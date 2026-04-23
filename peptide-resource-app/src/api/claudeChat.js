// ============================================================================
// VITALIS CHAT — API CLIENT
// ============================================================================
// Calls the Netlify function proxy (/api/vitalis-chat). The client NEVER
// touches the Anthropic API key directly — that lives server-side only.
//
// Swap the model in ONE line by editing MODEL_CONFIG in vitalis-chat-config.js.
// ============================================================================

import { MODEL_CONFIG } from '../data/vitalis-chat-config.js';

const ENDPOINT = '/.netlify/functions/vitalis-chat';

/**
 * Send a message to the Vitalis chat backend.
 *
 * @param {Object} params
 * @param {string} params.userMessage - The user's prompt for this turn.
 * @param {Array}  params.history     - Prior turns: [{role, content}, ...].
 * @param {Object} params.intake      - User intake answers.
 * @param {Object} params.catalog     - catalog-data.json (or null to use server default).
 * @param {string} params.evidenceMode - 'clinical' | 'community'.
 * @param {string} params.stackContext - Optional: stack currently selected in UI.
 * @returns {Promise<{ok, text, tokensIn, tokensOut, model, costUsd, error}>}
 */
export async function sendMessage({
  userMessage,
  history = [],
  intake = null,
  catalog = null,
  evidenceMode = 'clinical',
  stackContext = null,
} = {}) {
  if (!userMessage || typeof userMessage !== 'string') {
    return { ok: false, error: 'userMessage is required' };
  }

  try {
    const res = await fetch(ENDPOINT, {
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

    // Handle non-200s without throwing so the UI can show a friendly banner
    if (!res.ok) {
      let errText = `HTTP ${res.status}`;
      try {
        const data = await res.json();
        errText = data.error || errText;
      } catch {
        /* ignore parse error */
      }
      return {
        ok: false,
        error: errText,
        httpStatus: res.status,
      };
    }

    const data = await res.json();

    // Cost tracking — log per-request token usage to console until Langfuse lands
    if (data.tokensIn || data.tokensOut) {
      const cost = estimateCost(data.model, data.tokensIn, data.tokensOut);
      // eslint-disable-next-line no-console
      console.log('[vitalis-chat] cost:', {
        model: data.model,
        in: data.tokensIn,
        out: data.tokensOut,
        usd: cost.toFixed(4),
      });
    }

    return {
      ok: true,
      text: data.text || '',
      tokensIn: data.tokensIn || 0,
      tokensOut: data.tokensOut || 0,
      model: data.model || MODEL_CONFIG.primary,
      costUsd: estimateCost(data.model, data.tokensIn, data.tokensOut),
      moderation: data.moderation || null,
      protocolId: data.protocolId || null,
    };
  } catch (err) {
    return {
      ok: false,
      error: err.message || 'Network error',
    };
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
 * Reuses the existing ghl-proxy function.
 */
export async function sendStackToMarc({ intake, protocolMarkdown, protocolId, userEmail, userName } = {}) {
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
        email: userEmail || 'chat-anonymous@vitalis.local',
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
