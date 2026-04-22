/**
 * /.netlify/functions/garvis-auth
 *
 * Password gate for the Garvis Command Center SPA.
 *
 *   POST { password }
 *     → 200 + Set-Cookie: garvis_token=...; HttpOnly; Secure; SameSite=Strict; Max-Age=604800
 *       (7-day session; cookie value is GARVIS_AUTH_TOKEN)
 *     → 401 on bad password
 *
 *   GET
 *     → 200 { ok: true } if the cookie matches GARVIS_AUTH_TOKEN
 *     → 401 otherwise (used by the SPA to probe whether to show the password form)
 *
 * Single-tenant console for Marc — no DB, no per-session tokens. Matches the
 * decoy site's /command-auth contract. Wave 1e audit.
 */

const { checkAuth, COOKIE_NAME } = require("./_lib/garvis-auth");

const MAX_AGE = 60 * 60 * 24 * 7; // 7 days

function jsonHeaders(extra = {}) {
  return {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Credentials": "true",
    ...extra,
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: jsonHeaders(), body: "" };
  }

  const PASSWORD = process.env.GARVIS_PASSWORD || "";
  const TOKEN    = process.env.GARVIS_AUTH_TOKEN || "";

  if (!PASSWORD || !TOKEN) {
    return {
      statusCode: 500,
      headers: jsonHeaders(),
      body: JSON.stringify({ error: "server_misconfigured", detail: "GARVIS_PASSWORD or GARVIS_AUTH_TOKEN not set" }),
    };
  }

  // GET — cookie probe
  if (event.httpMethod === "GET") {
    if (checkAuth(event)) {
      return { statusCode: 200, headers: jsonHeaders(), body: JSON.stringify({ ok: true }) };
    }
    return { statusCode: 401, headers: jsonHeaders(), body: JSON.stringify({ error: "unauthorized" }) };
  }

  // POST — password exchange
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: jsonHeaders(), body: JSON.stringify({ error: "method_not_allowed" }) };
  }

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return { statusCode: 400, headers: jsonHeaders(), body: JSON.stringify({ error: "invalid_json" }) }; }

  const submitted = String(body.password || "");
  // Constant-time-ish compare on password
  const ok = submitted.length === PASSWORD.length && submitted === PASSWORD;
  if (!ok) {
    await new Promise((r) => setTimeout(r, 250));
    return { statusCode: 401, headers: jsonHeaders(), body: JSON.stringify({ error: "incorrect_password" }) };
  }

  const cookie =
    `${COOKIE_NAME}=${TOKEN}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${MAX_AGE}`;

  return {
    statusCode: 200,
    headers: jsonHeaders({ "Set-Cookie": cookie }),
    body: JSON.stringify({ ok: true, expires_in: MAX_AGE }),
  };
};
