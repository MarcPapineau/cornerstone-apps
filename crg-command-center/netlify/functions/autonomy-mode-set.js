/**
 * Netlify Function: /.netlify/functions/autonomy-mode-set
 *
 * POST — sets the CRG_AUTONOMY_MODE env var on the Netlify site via the
 * Netlify API. Requires:
 *   - NETLIFY_PERSONAL_ACCESS_TOKEN env var (set in Netlify UI — scope:
 *     user PAT with site:write)
 *   - NETLIFY_SITE_ID env var (site UUID — Netlify auto-injects this as
 *     process.env.SITE_ID inside function runtime, but we read both)
 *
 * Auth: Wave 2a is landing a session cookie. For now this endpoint simply
 * requires POST + valid body; once the cookie lands, extend to verify.
 *
 * Body:
 *   { "mode": "off" | "green" | "yellow" | "full" }
 *
 * Returns:
 *   { ok, mode, note? }  — note if the PAT is missing (will flag to Marc)
 */

const { checkAuth, unauthorized } = require('./_lib/garvis-auth');

const VALID = ['off', 'green', 'yellow', 'full'];

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store'
  };
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: cors(), body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: cors(),
      body: JSON.stringify({ error: 'method_not_allowed' })
    };
  }
  if (!checkAuth(event)) return unauthorized(cors());

  let body = {};
  try {
    body = JSON.parse(event.body || '{}');
  } catch (_) {
    return {
      statusCode: 400,
      headers: cors(),
      body: JSON.stringify({ error: 'invalid_json' })
    };
  }

  const mode = String(body.mode || '').toLowerCase().trim();
  if (!VALID.includes(mode)) {
    return {
      statusCode: 400,
      headers: cors(),
      body: JSON.stringify({ error: 'invalid_mode', valid: VALID })
    };
  }

  const pat = process.env.NETLIFY_PERSONAL_ACCESS_TOKEN;
  const siteId =
    process.env.NETLIFY_SITE_ID ||
    process.env.SITE_ID ||
    process.env.NETLIFY_SITE_UUID;

  if (!pat || !siteId) {
    return {
      statusCode: 503,
      headers: cors(),
      body: JSON.stringify({
        ok: false,
        mode,
        note:
          'NETLIFY_PERSONAL_ACCESS_TOKEN and/or NETLIFY_SITE_ID not configured — flag to Marc. Autonomy mode not persisted. Requested mode logged only.',
        missing: {
          pat: !pat,
          site_id: !siteId
        }
      })
    };
  }

  // Use Netlify API to upsert the env var at site scope.
  // PUT /api/v1/accounts/{account_id}/env/{key} ... actually the site-scoped
  // endpoint is POST /api/v1/sites/{site_id}/env (create) or PUT
  // /api/v1/accounts/{account_slug}/env/{key} (update). Simplest cross-version
  // path: POST /api/v1/sites/{site_id}/env with { key, values:[{value, context:'all'}] }
  const url = `https://api.netlify.com/api/v1/sites/${siteId}/env/CRG_AUTONOMY_MODE`;
  try {
    // First try PUT to update existing
    let resp = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${pat}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        key: 'CRG_AUTONOMY_MODE',
        values: [{ value: mode, context: 'all' }]
      })
    });
    if (resp.status === 404) {
      // Env var doesn't exist yet — create it via POST /env
      resp = await fetch(
        `https://api.netlify.com/api/v1/sites/${siteId}/env`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${pat}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify([
            {
              key: 'CRG_AUTONOMY_MODE',
              values: [{ value: mode, context: 'all' }]
            }
          ])
        }
      );
    }
    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      return {
        statusCode: 502,
        headers: cors(),
        body: JSON.stringify({
          ok: false,
          mode,
          error: 'netlify_api_error',
          status: resp.status,
          detail: txt.slice(0, 400)
        })
      };
    }
  } catch (err) {
    return {
      statusCode: 502,
      headers: cors(),
      body: JSON.stringify({
        ok: false,
        mode,
        error: 'netlify_api_unreachable',
        detail: String(err && err.message || err).slice(0, 400)
      })
    };
  }

  return {
    statusCode: 200,
    headers: cors(),
    body: JSON.stringify({
      ok: true,
      mode,
      note:
        'Env var updated on Netlify. Redeploy required for live sites to pick up the new value (autonomy-mode GET will reflect it after next deploy).',
      timestamp: new Date().toISOString()
    })
  };
};
