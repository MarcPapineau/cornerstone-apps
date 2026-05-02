#!/usr/bin/env node
/**
 * smoke-garvis-ops.js — end-to-end smoke for the Operations Tab API.
 *
 * Cookbook recipe: claude-agent-sdk-05-building-a-session-browser
 *
 * Usage
 * ─────
 *   GARVIS_BASE_URL=https://crg-command.netlify.app \
 *   GARVIS_AUTH_TOKEN=<32-byte-hex> \
 *   node scripts/smoke-garvis-ops.js
 *
 *   Defaults to http://localhost:8888 (netlify dev).
 *
 * Tests
 * ─────
 *   1. garvis-sessions-list returns at least one session (or backend flag if
 *      Langfuse disabled — in that case marks the row PASS-WITH-NOTE).
 *   2. garvis-session-info returns trace details for that session.
 *   3. garvis-session-tag adds a tag, then sessions-list shows it.
 *   4. garvis-session-fork returns 200 with a forked_session_id.
 *
 * Exits nonzero if any test fails. Designed to be paste-friendly into a PR
 * body — outputs Markdown table after running.
 */

const BASE = (process.env.GARVIS_BASE_URL || "http://localhost:8888").replace(/\/+$/, "");
const TOKEN = process.env.GARVIS_AUTH_TOKEN || "";

if (!TOKEN) {
  console.error("ERROR: GARVIS_AUTH_TOKEN env var required (the 32-byte hex cookie value).");
  process.exit(2);
}

function cookie() {
  return `garvis_token=${TOKEN}`;
}

const results = [];

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  const sym = ok === true ? "PASS" : ok === "note" ? "NOTE" : "FAIL";
  // eslint-disable-next-line no-console
  console.log(`[${sym}] ${name} — ${detail}`);
}

async function getJson(path) {
  const url = `${BASE}${path}`;
  const resp = await fetch(url, {
    method: "GET",
    headers: { Cookie: cookie(), Accept: "application/json" },
  });
  const text = await resp.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) { /* leave null */ }
  return { resp, json, text };
}

async function postJson(path, body) {
  const url = `${BASE}${path}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Cookie: cookie(),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) { /* leave null */ }
  return { resp, json, text };
}

async function main() {
  // -------------------------- TEST 1: list -------------------------------
  let pickSessionId = null;
  try {
    const { resp, json } = await getJson("/.netlify/functions/garvis-sessions-list?limit=10");
    if (resp.status !== 200) {
      record("sessions-list responds 200", false, `got ${resp.status}`);
    } else {
      const backend = json?.backend || "unknown";
      const count = json?.count ?? 0;
      if (backend === "langfuse-disabled") {
        record(
          "sessions-list returns sessions",
          "note",
          `backend=langfuse-disabled, count=0 — Langfuse env vars not set on this deploy. Endpoint shape OK.`
        );
      } else if (count > 0) {
        pickSessionId = json.sessions[0].session_id;
        record(
          "sessions-list returns sessions",
          true,
          `backend=${backend}, count=${count}, first_id=${pickSessionId}`
        );
      } else {
        record(
          "sessions-list returns sessions",
          "note",
          `backend=${backend}, count=0 — no traces in window. Endpoint shape OK.`
        );
      }
    }
  } catch (err) {
    record("sessions-list responds 200", false, err.message);
  }

  // ---------------------- TEST 2: session-info ---------------------------
  if (pickSessionId) {
    try {
      const { resp, json } = await getJson(
        `/.netlify/functions/garvis-session-info?session_id=${encodeURIComponent(pickSessionId)}`
      );
      if (resp.status === 200 && json?.session_id === pickSessionId) {
        record(
          "session-info returns trace details",
          true,
          `agent=${json.agent_name}, status=${json.status}, events=${json.trace_events?.length || 0}`
        );
      } else {
        record(
          "session-info returns trace details",
          false,
          `status=${resp.status}, body=${JSON.stringify(json).slice(0, 120)}`
        );
      }
    } catch (err) {
      record("session-info returns trace details", false, err.message);
    }
  } else {
    record(
      "session-info returns trace details",
      "note",
      "skipped — no session id from list step"
    );
  }

  // -------------------------- TEST 3: tag --------------------------------
  // Use a synthetic id when no real session — verifies the Blobs path
  // independently of Langfuse.
  const tagSessionId = pickSessionId || `smoke-${Date.now().toString(36)}`;
  const stamp = new Date().toISOString();
  const newTag = `smoke-${stamp}`;
  try {
    const { resp, json } = await postJson("/.netlify/functions/garvis-session-tag", {
      session_id: tagSessionId,
      tags: [newTag],
    });
    if (resp.status === 200 && Array.isArray(json?.tags) && json.tags.includes(newTag)) {
      record(
        "session-tag merges new tag",
        true,
        `tag '${newTag}' present in [${json.tags.join(", ")}]`
      );

      // Re-list and confirm the tag surfaces (only if we have a real Langfuse session).
      if (pickSessionId) {
        const { json: listAgain } = await getJson("/.netlify/functions/garvis-sessions-list?limit=10");
        const found = (listAgain?.sessions || []).find((s) => s.session_id === pickSessionId);
        if (found && Array.isArray(found.tags) && found.tags.includes(newTag)) {
          record(
            "tag visible in sessions-list overlay",
            true,
            `tag '${newTag}' surfaced in re-listed session`
          );
        } else {
          record(
            "tag visible in sessions-list overlay",
            false,
            `tag '${newTag}' NOT found on re-list (overlay broken?)`
          );
        }
      } else {
        record(
          "tag visible in sessions-list overlay",
          "note",
          "skipped — synthetic session id won't appear in Langfuse list"
        );
      }
    } else if (resp.status === 503 && json?.error === "blobs_unavailable") {
      record(
        "session-tag merges new tag",
        "note",
        `blobs_unavailable — local dev without netlify dev. Endpoint shape OK.`
      );
    } else {
      record(
        "session-tag merges new tag",
        false,
        `status=${resp.status}, body=${JSON.stringify(json).slice(0, 120)}`
      );
    }
  } catch (err) {
    record("session-tag merges new tag", false, err.message);
  }

  // -------------------------- TEST 4: fork -------------------------------
  try {
    const { resp, json } = await postJson("/.netlify/functions/garvis-session-fork", {
      session_id: tagSessionId,
      edits: { prompt_override: "[smoke] re-run with no edits", scope_override: null },
    });
    if (
      resp.status === 200 &&
      typeof json?.forked_session_id === "string" &&
      json.status === "queued"
    ) {
      record(
        "session-fork returns queued forked_session_id",
        true,
        `forked_id=${json.forked_session_id}, status=${json.status}`
      );
    } else {
      record(
        "session-fork returns queued forked_session_id",
        false,
        `status=${resp.status}, body=${JSON.stringify(json).slice(0, 120)}`
      );
    }
  } catch (err) {
    record("session-fork returns queued forked_session_id", false, err.message);
  }

  // ----------------------------- summary ---------------------------------
  console.log("\n## Smoke summary\n");
  console.log("| Test | Result | Detail |");
  console.log("|------|--------|--------|");
  for (const r of results) {
    const sym = r.ok === true ? "PASS" : r.ok === "note" ? "NOTE" : "FAIL";
    console.log(`| ${r.name} | ${sym} | ${r.detail.replace(/\|/g, "\\|")} |`);
  }
  const failed = results.some((r) => r.ok === false);
  if (failed) {
    console.log("\nFAILED — at least one test reported FAIL.");
    process.exit(1);
  }
  console.log("\nALL PASS (NOTE rows are environment-dependent, not failures).");
}

main().catch((err) => {
  console.error("smoke runner crashed:", err);
  process.exit(2);
});
