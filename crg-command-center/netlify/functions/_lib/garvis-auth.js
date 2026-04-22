/**
 * garvis-auth.js — shared cookie check for all Garvis endpoints.
 *
 * Wave 1e audit finding: queue-list, queue-update, status, morning-brief,
 * and research-feed all shipped with zero auth. The earlier P0 hardening
 * landed on the DECOY site (cornerstoneregroup-site /command/) by
 * mistake. This is the real Garvis.
 *
 * Auth posture (matches the decoy):
 *   - Password prompt on first load → /.netlify/functions/garvis-auth (POST)
 *   - On success: HttpOnly, Secure, SameSite=Strict cookie "garvis_token"
 *     whose value is GARVIS_AUTH_TOKEN (a 32-byte hex opaque token).
 *   - Every subsequent fetch includes the cookie automatically (same-origin).
 *   - Server helper checkAuth(event) compares the cookie against the env var
 *     and returns true / false. Endpoints that fail return 401.
 *
 * Design notes:
 *   - Single shared token (not per-session). Single-tenant operator console
 *     for Marc — same pattern as the decoy’s crg_command cookie.
 *   - Cookie parsed out of event.headers.cookie (Netlify lowercases headers).
 *   - If GARVIS_AUTH_TOKEN isn’t set (misconfigured deploy), checkAuth
 *     returns false so the endpoints stay locked — fail closed.
 */

const COOKIE_NAME = "garvis_token";

function getToken() {
  return process.env.GARVIS_AUTH_TOKEN || "";
}

function readCookie(event, name) {
  const headers = event.headers || {};
  const raw = headers.cookie || headers.Cookie || "";
  if (!raw) return null;
  for (const piece of raw.split(";")) {
    const idx = piece.indexOf("=");
    if (idx === -1) continue;
    if (piece.slice(0, idx).trim() === name) {
      return piece.slice(idx + 1).trim();
    }
  }
  return null;
}

function checkAuth(event) {
  const expected = getToken();
  if (!expected) return false;
  const presented = readCookie(event, COOKIE_NAME);
  if (!presented) return false;
  if (presented.length !== expected.length) return false;
  // Constant-time-ish compare to slow brute force on the cookie value.
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ presented.charCodeAt(i);
  }
  return diff === 0;
}

function unauthorized(extraHeaders = {}) {
  return {
    statusCode: 401,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...extraHeaders },
    body: JSON.stringify({ error: "unauthorized" }),
  };
}

module.exports = {
  COOKIE_NAME,
  checkAuth,
  unauthorized,
};
