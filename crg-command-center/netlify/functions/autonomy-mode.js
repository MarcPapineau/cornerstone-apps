/**
 * Netlify Function: /.netlify/functions/autonomy-mode
 *
 * GET — returns the current autonomy mode (read-only).
 *
 * Source of truth: the Netlify site env var CRG_AUTONOMY_MODE. The function
 * merely reflects it. Valid values:
 *   off    — all autonomous writes blocked
 *   green  — read-only surfaces only
 *   yellow — human-approved writes via queue
 *   full   — fully autonomous
 *
 * Defaults to 'off' if unset, so new deploys never accidentally auto-act.
 */

const { checkAuth, unauthorized } = require('./_lib/garvis-auth');

const VALID = ['off', 'green', 'yellow', 'full'];

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store'
  };
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

  const raw = (process.env.CRG_AUTONOMY_MODE || 'off').toLowerCase().trim();
  const mode = VALID.includes(raw) ? raw : 'off';

  return {
    statusCode: 200,
    headers: cors(),
    body: JSON.stringify({
      mode,
      valid: VALID,
      env_present: !!process.env.CRG_AUTONOMY_MODE,
      timestamp: new Date().toISOString()
    })
  };
};
