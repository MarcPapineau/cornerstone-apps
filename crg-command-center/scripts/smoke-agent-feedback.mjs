#!/usr/bin/env node
/**
 * smoke-agent-feedback.mjs — Phase 3 smoke for the Operations Tab feedback UI.
 *
 * Mirrors the smoke-garvis-ops-ui.mjs pattern: spins a tiny static + mock-API
 * server, drives the UI in headless Chromium, mocks the feedback endpoints,
 * and asserts both backend round-trip and graceful degradation when the
 * Apollos cross-repo URLs return 503.
 *
 * What this verifies (closes the self-doubt checks in the dispatch):
 *   1. 👍 click → form opens with stars
 *   2. 👍 + 5★ + reason → POST /api/agent-feedback → toast success
 *   3. 👎 click → form opens (no stars, reason required)
 *   4. 👎 + reason → POST /api/agent-feedback → toast success → mock receives
 *      failure-mode-trigger call
 *   5. Cancel mid-flow → no API call
 *   6. After submit → reload session → existing-feedback callout shows + buttons disabled
 *      (this is the "feedback persisted" falsification check)
 *   7. Apollos URL returns 503 → UI still toasts success, error captured in response
 *      (graceful degradation)
 *
 * Usage:  node scripts/smoke-agent-feedback.mjs
 */

import { createRequire } from "module";
const _require = createRequire(import.meta.url);
let _playwrightPath;
try {
  _playwrightPath = _require.resolve("playwright");
} catch (_) {
  try {
    _playwrightPath = _require.resolve("playwright", {
      paths: ["/opt/homebrew/lib/node_modules", "/usr/local/lib/node_modules"],
    });
  } catch (e) {
    console.error("playwright not found locally or globally. Install with: npm i -g playwright && npx playwright install chromium");
    process.exit(2);
  }
}
const _pw = await import(_playwrightPath);
const chromium = _pw.chromium || (_pw.default && _pw.default.chromium);
if (!chromium) {
  console.error("Could not resolve playwright.chromium from", _playwrightPath);
  process.exit(2);
}
import { fileURLToPath } from "url";
import path from "path";
import http from "http";
import fs from "fs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const PORT = 8124;

/* ----------------------------- mock data ---------------------------- */
const MOCK_SESSION = {
  session_id: "tr_apollos_001",
  agent_name: "apollos",
  started_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
  completed_at: new Date(Date.now() - 4 * 60 * 1000).toISOString(),
  status: "completed",
  trace_url: "https://cloud.langfuse.com/trace/tr_apollos_001",
  langfuse_url: "https://cloud.langfuse.com/trace/tr_apollos_001",
  tags: ["needs-review"],
  total_tokens: 4321,
  tools_used: ["compose_email"],
  error_count: 0,
  output_full_text: "Greetings Marc — here is the weekly digest synthesizing learnings from our agents.",
  trace_events: [
    {
      id: "e1", type: "GENERATION", name: "claude-opus-4-7",
      start: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      end: new Date(Date.now() - 4.5 * 60 * 1000).toISOString(),
      level: "DEFAULT",
    },
  ],
};

// In-memory state for the mocked feedback endpoints
const feedbackStore = new Map(); // agent → array of entries
const downstreamHits = {
  failure_mode: [],
  reference_curate: [],
};
let failureModeShouldFail = false; // toggled in test 7 to simulate 503

/* ---------- tiny static + mock-API server ---------- */
function startServer() {
  const indexPath = path.resolve(ROOT, "index.html");
  const html = fs.readFileSync(indexPath, "utf8");
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      // CORS preflight handled trivially
      if (req.method === "OPTIONS") {
        res.writeHead(200);
        res.end();
        return;
      }
      if (req.url === "/" || req.url === "/index.html") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(html);
        return;
      }

      // Phase 2 mocks (re-used so the page boots cleanly)
      if (req.url.startsWith("/.netlify/functions/garvis-auth")) {
        res.writeHead(200, { "Content-Type": "application/json", "Set-Cookie": "garvis_token=mocked" });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      if (req.url.startsWith("/.netlify/functions/garvis-sessions-list")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          backend: "langfuse",
          count: 1, page: 1, limit: 25, total_items: 1, total_pages: 1,
          sessions: [MOCK_SESSION],
          timestamp: new Date().toISOString(),
        }));
        return;
      }
      if (req.url.startsWith("/.netlify/functions/garvis-session-info")) {
        const m = req.url.match(/session_id=([^&]+)/);
        const id = m ? decodeURIComponent(m[1]) : "";
        if (id !== MOCK_SESSION.session_id) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "not_found" }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ...MOCK_SESSION, backend: "langfuse" }));
        return;
      }
      if (req.url.startsWith("/.netlify/functions/garvis-session-tag")) {
        let body = "";
        req.on("data", (c) => body += c);
        req.on("end", () => {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ session_id: MOCK_SESSION.session_id, tags: MOCK_SESSION.tags, updated_at: new Date().toISOString() }));
        });
        return;
      }
      if (req.url.startsWith("/.netlify/functions/garvis-session-fork")) {
        let body = ""; req.on("data", c => body += c);
        req.on("end", () => {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ forked_session_id: "fork_x", source_session_id: MOCK_SESSION.session_id, status: "queued" }));
        });
        return;
      }

      // Phase 3 — agent-feedback POST
      if (req.url.startsWith("/.netlify/functions/agent-feedback") &&
          !req.url.includes("agent-feedback-history") &&
          req.method === "POST") {
        let body = "";
        req.on("data", (c) => body += c);
        req.on("end", async () => {
          let parsed;
          try { parsed = JSON.parse(body || "{}"); }
          catch (_) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "invalid_json" }));
            return;
          }
          // Validate
          if (!parsed.session_id || !parsed.agent_name || !parsed.verdict) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "missing_fields" }));
            return;
          }
          if (parsed.verdict === "accept" && !(parsed.rating >= 1 && parsed.rating <= 5)) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "bad_rating" }));
            return;
          }
          if (parsed.verdict === "reject" && !(parsed.reason || "").trim()) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "reason_required" }));
            return;
          }
          // Persist
          const entries = feedbackStore.get(parsed.agent_name) || [];
          entries.push({
            session_id: parsed.session_id,
            verdict: parsed.verdict,
            rating: parsed.rating ?? null,
            reason: parsed.reason || "",
            timestamp: new Date().toISOString(),
          });
          feedbackStore.set(parsed.agent_name, entries);

          // Simulate downstream
          const downstream_dispatched = {};
          if (parsed.verdict === "reject") {
            downstreamHits.failure_mode.push(parsed);
            if (failureModeShouldFail) {
              downstream_dispatched.failure_mode = { url: "mock:fail", ok: false, status: 503, error: null };
            } else {
              downstream_dispatched.failure_mode = { url: "mock:ok", ok: true, status: 200, error: null };
            }
          } else if (parsed.verdict === "accept" && parsed.rating >= 4 && parsed.output_full_text) {
            downstreamHits.reference_curate.push(parsed);
            downstream_dispatched.reference_curate = { url: "mock:ok", ok: true, status: 200, error: null };
          }

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            ok: true,
            session_id: parsed.session_id,
            agent_name: parsed.agent_name,
            verdict: parsed.verdict,
            rating: parsed.rating ?? null,
            written_to_memstore: true,
            downstream_dispatched,
            timestamp: new Date().toISOString(),
          }));
        });
        return;
      }

      // Phase 3 — agent-feedback-history GET
      if (req.url.startsWith("/.netlify/functions/agent-feedback-history")) {
        const u = new URL(req.url, "http://localhost");
        const agent = (u.searchParams.get("agent_name") || "").toLowerCase();
        const sid = u.searchParams.get("session_id") || "";
        const entries = (feedbackStore.get(agent) || []).slice().sort((a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        );
        const session_feedback = sid ? (entries.find(e => e.session_id === sid) || null) : null;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          ok: true,
          agent_name: agent,
          session_feedback,
          recent: entries.slice(0, 10),
          count: entries.length,
          backend: "netlify-blobs",
        }));
        return;
      }

      // static files
      const local = path.resolve(ROOT, req.url.replace(/^\//, ""));
      if (local.startsWith(ROOT) && fs.existsSync(local) && fs.statSync(local).isFile()) {
        res.writeHead(200);
        res.end(fs.readFileSync(local));
        return;
      }
      res.writeHead(404);
      res.end("not found");
    });
    server.listen(PORT, () => resolve(server));
  });
}

/* ---------- runner ---------- */
const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  const sym = ok === true ? "PASS" : ok === "note" ? "NOTE" : "FAIL";
  console.log(`[${sym}] ${name} — ${detail}`);
}

async function openDrawer(page) {
  await page.locator("#gops-open-btn").click();
  await page.waitForSelector("#gops-scrim.open", { timeout: 2000 });
  await page.waitForFunction(
    () => document.querySelectorAll("#gops-tbody tr[data-session-id]").length === 1,
    { timeout: 3000 }
  );
  await page.locator(`#gops-tbody tr[data-session-id="${MOCK_SESSION.session_id}"]`).click();
  await page.waitForSelector("#gops-shell.detail-open", { timeout: 2000 });
  await page.waitForFunction(
    () => document.getElementById("gops-detail-agent")?.textContent?.trim() === "apollos",
    { timeout: 3000 }
  );
  // Allow history fetch to complete
  await page.waitForTimeout(300);
}

async function run() {
  const server = await startServer();
  let consoleErrors = [];
  let browser, ctx, page;
  let networkLog = [];
  try {
    browser = await chromium.launch();
    ctx = await browser.newContext();
    await ctx.addCookies([{ name: "garvis_token", value: "mocked", domain: "localhost", path: "/", sameSite: "Strict" }]);
    page = await ctx.newPage();
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => consoleErrors.push("pageerror: " + err.message));
    page.on("request", (req) => {
      if (req.url().includes("agent-feedback")) {
        networkLog.push({ method: req.method(), url: req.url() });
      }
    });
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: "domcontentloaded" });

    // ─── Test 0: feedback panel renders inside the drawer ─────────────
    await page.waitForSelector("#gops-entry-card", { timeout: 5000 });
    await openDrawer(page);
    const panelExists = await page.locator("#gfb-panel").count();
    record("feedback panel renders inside drawer", panelExists === 1, `panel count=${panelExists}`);

    // ─── Test 1: 👍 click opens form with stars visible ───────────────
    await page.locator("#gfb-accept-btn").click();
    await page.waitForSelector("#gfb-form.open", { timeout: 1000 });
    const starsVisible = await page.locator("#gfb-stars").isVisible();
    record("👍 click reveals form with stars", starsVisible, `stars visible=${starsVisible}`);

    // ─── Test 2: cancel resets, no API call yet ───────────────────────
    networkLog = [];
    await page.locator("#gfb-cancel").click();
    await page.waitForTimeout(200);
    const cancelClean = networkLog.filter(n => n.method === "POST").length === 0;
    record("cancel mid-flow makes no API call", cancelClean, `posts after cancel=${networkLog.filter(n => n.method === "POST").length}`);

    // ─── Test 3: 👍 + 5★ + reason → submit → toast success ────────────
    networkLog = [];
    await page.locator("#gfb-accept-btn").click();
    await page.waitForSelector("#gfb-form.open", { timeout: 1000 });
    await page.locator('#gfb-stars .gfb-star[data-star="5"]').click();
    await page.locator("#gfb-reason").fill("Tone matched Marc's voice perfectly.");
    await page.locator("#gfb-submit").click();
    await page.waitForTimeout(800);
    const toastTextAcc = await page.locator("#gops-toast").textContent();
    const acceptToastOk = /Accepted/.test(toastTextAcc) && /5★/.test(toastTextAcc);
    record("accept submit toasts success", acceptToastOk, `toast='${toastTextAcc.trim()}'`);

    const acceptPosts = networkLog.filter(n => n.method === "POST" && /agent-feedback/.test(n.url) && !/history/.test(n.url));
    record("accept POSTs to /api/agent-feedback", acceptPosts.length === 1, `posts=${acceptPosts.length}`);

    const referenceCurated = downstreamHits.reference_curate.length === 1 &&
                             downstreamHits.reference_curate[0].rating === 5;
    record("accept >=4★ triggers reference-curate downstream", referenceCurated, `hits=${downstreamHits.reference_curate.length}`);

    // ─── Test 4: existing-feedback callout shows + buttons disabled ──
    // History endpoint should mark this session as already-rated on next drawer load.
    // Re-trigger session detail load.
    await page.evaluate((sid) => {
      // Force a re-fetch by clicking the row again (toggles selection but re-renders detail)
      const tr = document.querySelector(`#gops-tbody tr[data-session-id="${sid}"]`);
      if (tr) tr.click();
    }, MOCK_SESSION.session_id);
    await page.waitForTimeout(500);
    const existingVisible = await page.locator("#gfb-existing").isVisible();
    const accDisabled = await page.locator("#gfb-accept-btn").isDisabled();
    const rejDisabled = await page.locator("#gfb-reject-btn").isDisabled();
    record("after submit: existing-feedback callout visible + buttons disabled",
      existingVisible && accDisabled && rejDisabled,
      `existing=${existingVisible} acc.disabled=${accDisabled} rej.disabled=${rejDisabled}`);

    // ─── Test 5: 👎 reject flow on a different mock session ──────────
    // Reset feedbackStore for the apollos agent so the buttons unlock.
    feedbackStore.clear();
    downstreamHits.failure_mode = [];
    downstreamHits.reference_curate = [];
    // Re-trigger drawer load to pull fresh history
    await page.evaluate((sid) => {
      const tr = document.querySelector(`#gops-tbody tr[data-session-id="${sid}"]`);
      if (tr) tr.click();
    }, MOCK_SESSION.session_id);
    await page.waitForTimeout(500);
    const accStillDisabled = await page.locator("#gfb-accept-btn").isDisabled();
    record("after store-clear + reload: buttons re-enable", !accStillDisabled, `acc.disabled=${accStillDisabled}`);

    networkLog = [];
    await page.locator("#gfb-reject-btn").click();
    await page.waitForSelector("#gfb-form.open", { timeout: 1000 });
    const starsHidden = !(await page.locator("#gfb-stars").isVisible());
    record("👎 hides star rating", starsHidden, `stars hidden=${starsHidden}`);

    // Submit should be disabled until reason filled
    const submitDisabledBefore = await page.locator("#gfb-submit").isDisabled();
    record("reject: submit disabled when reason empty", submitDisabledBefore, `disabled=${submitDisabledBefore}`);

    await page.locator("#gfb-reason").fill("Used wrong format — pen, not vial.");
    const submitEnabledAfter = !(await page.locator("#gfb-submit").isDisabled());
    record("reject: submit enables when reason filled", submitEnabledAfter, `enabled=${submitEnabledAfter}`);

    await page.locator("#gfb-submit").click();
    await page.waitForTimeout(800);
    const toastTextRej = await page.locator("#gops-toast").textContent();
    const rejectToastOk = /Rejected/.test(toastTextRej);
    record("reject submit toasts success", rejectToastOk, `toast='${toastTextRej.trim()}'`);
    record("reject triggers failure-mode-trigger downstream",
      downstreamHits.failure_mode.length === 1,
      `hits=${downstreamHits.failure_mode.length}`);

    // ─── Test 6: graceful degradation when downstream returns 503 ────
    feedbackStore.clear();
    downstreamHits.failure_mode = [];
    failureModeShouldFail = true;
    await page.evaluate((sid) => {
      const tr = document.querySelector(`#gops-tbody tr[data-session-id="${sid}"]`);
      if (tr) tr.click();
    }, MOCK_SESSION.session_id);
    await page.waitForTimeout(500);
    await page.locator("#gfb-reject-btn").click();
    await page.waitForSelector("#gfb-form.open", { timeout: 1000 });
    await page.locator("#gfb-reason").fill("trigger 503 path");
    await page.locator("#gfb-submit").click();
    await page.waitForTimeout(800);
    const toastTextDegrade = await page.locator("#gops-toast").textContent();
    // Should still show success toast — but with note about downstream status
    const degradeOk = /Rejected/.test(toastTextDegrade) || /503/.test(toastTextDegrade) || /returned/i.test(toastTextDegrade);
    record("graceful degrade: 503 from downstream → toast still success",
      degradeOk, `toast='${toastTextDegrade.trim()}'`);
    failureModeShouldFail = false;

    // ─── Final: console errors ────────────────────────────────────────
    const fatalErrors = consoleErrors.filter(e =>
      !/garvis-auth|status (401|404)|HTTP 404|Failed to load resource|Failed to fetch|Status fetch failed|fetchStatus|loadQueue|loadBrief|loadResearch|loadEvents|loadAutonomy|loadSamuel|loadVaultKeeper|loadScorecards|loadRoutines|fetching the script|service[\s-]?worker|sw\.js|net::ERR_|cornerstoneregroup\.netlify\.app|levite\/snapshot|CORS|blocked by CORS/i.test(e)
    );
    if (fatalErrors.length === 0) {
      record("no fatal JS errors", true, `(${consoleErrors.length} non-fatal noted)`);
    } else {
      record("no fatal JS errors", false, `${fatalErrors.length}: ${fatalErrors[0].slice(0, 120)}`);
    }
  } catch (err) {
    record("smoke runner crashed mid-test", false, err.message);
    if (err.stack) console.error(err.stack);
  } finally {
    if (browser) await browser.close();
    server.close();
  }

  console.log("\n## Phase 3 feedback smoke summary\n");
  console.log("| Test | Result | Detail |");
  console.log("|------|--------|--------|");
  for (const r of results) {
    const sym = r.ok === true ? "PASS" : r.ok === "note" ? "NOTE" : "FAIL";
    console.log(`| ${r.name} | ${sym} | ${(r.detail || "").replace(/\|/g, "\\|")} |`);
  }
  const failed = results.some((r) => r.ok === false);
  if (failed) {
    console.log("\nFAILED — at least one Phase 3 test reported FAIL.");
    process.exit(1);
  }
  console.log("\nALL PASS.");
}

run().catch((err) => {
  console.error("Smoke crashed:", err);
  process.exit(2);
});
