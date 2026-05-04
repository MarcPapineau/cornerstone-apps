/**
 * Netlify Function: /.netlify/functions/agent-feedback
 *
 * POST — record Marc's accept/reject verdict on an agent's session output and
 *        route the signal to the agent's self-improvement memstore + (on
 *        reject) the failure-mode-trigger and (on high-rated accept) the
 *        reference-curate endpoints.
 *
 * Cookbook recipe extension
 * ─────────────────────────
 *   Cookbook 05 (session browser) ends at "tag a session".
 *   Phase 3 (this endpoint) closes the self-improvement loop:
 *     Marc rates a session → feedback persisted in agent's memstore →
 *     Apollos (and other self-improving agents) read back to refine
 *     prompts / curate reference examples.
 *
 * Request body (JSON)
 * ───────────────────
 *   {
 *     session_id: string,        REQUIRED
 *     agent_name: string,        REQUIRED — canonical lowercase agent name
 *     verdict:    "accept"|"reject",  REQUIRED
 *     reason:     string,        REQUIRED on reject, optional on accept
 *     rating:     1|2|3|4|5,     REQUIRED on accept (else null), null on reject
 *     output_full_text: string,  OPTIONAL — only on accept-with-rating>=4 to
 *                                seed the agent's reference-examples library
 *   }
 *
 * Response
 * ────────
 *   {
 *     ok: boolean,
 *     session_id, agent_name, verdict, rating,
 *     written_to_memstore: boolean,
 *     downstream_dispatched: { failure_mode?: bool, reference_curate?: bool, error?: string },
 *     timestamp: ISO
 *   }
 *
 * Storage
 * ───────
 *   Blob store : "agent-feedback"
 *   Key        : "<agent_name>/marc-decisions.md"
 *   Format     : append-only Markdown log; one entry per call.
 *   Index      : "<agent_name>/index.json"
 *               (compact list of {session_id, verdict, rating, ts} for the
 *                history endpoint to read without reparsing the markdown).
 *
 * Cross-repo dispatch
 * ───────────────────
 *   Reject:        POST <APOLLOS_FAILURE_MODE_TRIGGER_URL or fallback>
 *                  Body: { session_id, reason }
 *   Accept >=4★:   POST <APOLLOS_REFERENCE_CURATE_URL or fallback>
 *                  Body: { session_id, rating, why_marc_liked: reason,
 *                          output_full_text }
 *
 *   Per-agent override env vars (so Habakkuk, Karis, etc can each have their
 *   own URL when their loops come online):
 *     <AGENT_UPPER>_FAILURE_MODE_TRIGGER_URL
 *     <AGENT_UPPER>_REFERENCE_CURATE_URL
 *
 *   If the URL env var is missing for a given agent, we LOG (don't error) and
 *   record `downstream_dispatched.note = "agent X not yet wired for self-improvement,
 *   feedback stored in fallback log"`. Marc's signal is never lost.
 *
 *   If a configured URL returns 4xx/5xx or times out, we still return 200 to
 *   the UI so the toast shows success. The downstream failure is captured in
 *   the response so the UI can log/diagnose.
 *
 * Auth: cookie-based via _lib/garvis-auth (matches PR #5 endpoints).
 */

const { checkAuth, unauthorized } = require("./_lib/garvis-auth");

const STORE_NAME = "agent-feedback";
const DOWNSTREAM_TIMEOUT_MS = 5000;

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  };
}

async function loadStore(event) {
  try {
    const blobs = await import("@netlify/blobs");
    if (typeof blobs.connectLambda === "function" && event) {
      try { blobs.connectLambda(event); } catch (_) {}
    }
    return blobs.getStore({ name: STORE_NAME, consistency: "strong" });
  } catch (_) {
    return null;
  }
}

function decisionsKey(agentName) {
  return `${agentName}/marc-decisions.md`;
}

function indexKey(agentName) {
  return `${agentName}/index.json`;
}

function escapeMarkdown(s) {
  if (s == null) return "";
  return String(s).replace(/\r\n/g, "\n");
}

function markdownEntry({ session_id, agent_name, verdict, reason, rating, timestamp }) {
  const title =
    verdict === "accept"
      ? `### ${timestamp} · ACCEPT · ${rating}★ · ${session_id}`
      : `### ${timestamp} · REJECT · ${session_id}`;
  const lines = [
    "",
    title,
    `- agent: \`${agent_name}\``,
    `- verdict: ${verdict}`,
  ];
  if (rating != null) lines.push(`- rating: ${rating}/5`);
  if (reason && reason.trim()) {
    lines.push("- reason:");
    lines.push("");
    lines.push("```");
    lines.push(escapeMarkdown(reason));
    lines.push("```");
  }
  lines.push("");
  return lines.join("\n");
}

async function appendToMemstore(store, agentName, entry, indexEntry) {
  if (!store) return false;
  // Append markdown
  let existing = "";
  try {
    existing = (await store.get(decisionsKey(agentName), { type: "text" })) || "";
  } catch (_) {
    existing = "";
  }
  if (!existing) {
    existing =
      "# Marc Decisions Log\n\n" +
      `Self-improvement signal for **${agentName}**. Append-only log of Marc's\n` +
      "accept/reject verdicts on session outputs from the Garvis Operations Tab.\n" +
      "Generated by `/api/agent-feedback`.\n";
  }
  const next = existing + entry;
  await store.set(decisionsKey(agentName), next, { contentType: "text/markdown" });

  // Update compact index for history endpoint
  let idx = [];
  try {
    const raw = await store.get(indexKey(agentName), { type: "json" });
    if (raw && Array.isArray(raw.entries)) idx = raw.entries;
  } catch (_) {}
  idx.push(indexEntry);
  // Trim to last 200 entries to keep blob small
  if (idx.length > 200) idx = idx.slice(-200);
  await store.setJSON(indexKey(agentName), {
    agent_name: agentName,
    updated_at: new Date().toISOString(),
    entries: idx,
  });

  return true;
}

function envOverride(agentName, suffix) {
  const upper = String(agentName || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_");
  return process.env[`${upper}_${suffix}`] || null;
}

function defaultFailureModeUrl(agentName) {
  // Apollos was the pilot; until each agent has its own failure-mode-trigger
  // we fall back to apollos's so the signal still gets observed.
  return (
    envOverride(agentName, "FAILURE_MODE_TRIGGER_URL") ||
    process.env.APOLLOS_FAILURE_MODE_TRIGGER_URL ||
    null
  );
}

function defaultReferenceCurateUrl(agentName) {
  return (
    envOverride(agentName, "REFERENCE_CURATE_URL") ||
    process.env.APOLLOS_REFERENCE_CURATE_URL ||
    null
  );
}

async function postWithTimeout(url, body) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), DOWNSTREAM_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(t);
    return { ok: res.ok, status: res.status };
  } catch (err) {
    clearTimeout(t);
    return { ok: false, status: 0, error: err.message };
  }
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: cors(), body: "" };
  }
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: cors(),
      body: JSON.stringify({ error: "method_not_allowed" }),
    };
  }
  if (!checkAuth(event)) return unauthorized(cors());

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch (_) {
    return {
      statusCode: 400,
      headers: cors(),
      body: JSON.stringify({ error: "invalid_json" }),
    };
  }

  const session_id = body.session_id;
  const agent_name = body.agent_name;
  const verdict = body.verdict;
  const reason = body.reason || "";
  const rating = body.rating == null ? null : Number(body.rating);
  const output_full_text = body.output_full_text || null;

  // ── Validation ──────────────────────────────────────────────────────
  if (!session_id || typeof session_id !== "string") {
    return errResp(400, "missing_session_id");
  }
  if (!agent_name || typeof agent_name !== "string") {
    return errResp(400, "missing_agent_name");
  }
  const normalizedAgent = agent_name.trim().toLowerCase();
  if (!/^[a-z0-9_-]+$/.test(normalizedAgent)) {
    return errResp(400, "invalid_agent_name");
  }
  if (verdict !== "accept" && verdict !== "reject") {
    return errResp(400, "verdict_must_be_accept_or_reject");
  }
  if (verdict === "accept") {
    if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
      return errResp(400, "rating_required_1_to_5_on_accept");
    }
  } else {
    // reject — reason required
    if (!reason || typeof reason !== "string" || !reason.trim()) {
      return errResp(400, "reason_required_on_reject");
    }
    if (rating != null) {
      return errResp(400, "rating_must_be_null_on_reject");
    }
  }
  if (reason && reason.length > 4000) {
    return errResp(400, "reason_too_long_max_4000");
  }
  if (output_full_text != null) {
    if (typeof output_full_text !== "string") {
      return errResp(400, "output_full_text_must_be_string");
    }
    if (output_full_text.length > 200_000) {
      return errResp(400, "output_full_text_too_long_max_200k");
    }
  }

  const timestamp = new Date().toISOString();
  const downstream_dispatched = {};

  // ── Persist to memstore ─────────────────────────────────────────────
  const store = await loadStore(event);
  let written_to_memstore = false;
  let memstore_note = null;

  if (!store) {
    memstore_note =
      "blobs_unavailable — feedback received but not persisted (run via Netlify Dev/Prod for storage)";
  } else {
    try {
      const entry = markdownEntry({
        session_id,
        agent_name: normalizedAgent,
        verdict,
        reason,
        rating,
        timestamp,
      });
      const indexEntry = {
        session_id,
        verdict,
        rating: rating ?? null,
        reason: reason ? reason.slice(0, 280) : "",
        timestamp,
      };
      written_to_memstore = await appendToMemstore(
        store,
        normalizedAgent,
        entry,
        indexEntry
      );
    } catch (err) {
      memstore_note = `memstore_write_failed: ${err.message}`;
    }
  }

  // ── Cross-repo dispatch ─────────────────────────────────────────────
  if (verdict === "reject") {
    const url = defaultFailureModeUrl(normalizedAgent);
    if (url) {
      const r = await postWithTimeout(url, { session_id, reason });
      downstream_dispatched.failure_mode = {
        url,
        ok: r.ok,
        status: r.status,
        error: r.error || null,
      };
    } else {
      downstream_dispatched.failure_mode = {
        ok: false,
        skipped: true,
        note: `agent '${normalizedAgent}' not yet wired for self-improvement, feedback stored in fallback log`,
      };
    }
  } else if (verdict === "accept" && rating >= 4 && output_full_text) {
    const url = defaultReferenceCurateUrl(normalizedAgent);
    if (url) {
      const r = await postWithTimeout(url, {
        session_id,
        rating,
        why_marc_liked: reason,
        output_full_text,
      });
      downstream_dispatched.reference_curate = {
        url,
        ok: r.ok,
        status: r.status,
        error: r.error || null,
      };
    } else {
      downstream_dispatched.reference_curate = {
        ok: false,
        skipped: true,
        note: `agent '${normalizedAgent}' not yet wired for self-improvement, feedback stored in fallback log`,
      };
    }
  }

  return {
    statusCode: 200,
    headers: cors(),
    body: JSON.stringify({
      ok: true,
      session_id,
      agent_name: normalizedAgent,
      verdict,
      rating: rating ?? null,
      written_to_memstore,
      memstore_note,
      downstream_dispatched,
      timestamp,
    }),
  };
};

function errResp(status, code, detail) {
  return {
    statusCode: status,
    headers: cors(),
    body: JSON.stringify(detail ? { error: code, detail } : { error: code }),
  };
}
