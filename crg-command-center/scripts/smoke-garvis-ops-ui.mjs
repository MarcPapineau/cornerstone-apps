#!/usr/bin/env node
/**
 * smoke-garvis-ops-ui.mjs — UI-side smoke for the Garvis Operations Tab Phase 2.
 *
 * Cookbook recipe: claude-agent-sdk-05-building-a-session-browser
 *
 * Why this exists alongside scripts/smoke-garvis-ops.js
 * ─────────────────────────────────────────────────────
 * That script exercises the FOUR Phase 1 backend endpoints over HTTP.
 * This script exercises the Phase 2 UI in a headless browser, mocking the
 * endpoints, so the dashboard is verified without requiring a deploy +
 * Langfuse keys. Both run in CI.
 *
 * Usage
 * ─────
 *   node scripts/smoke-garvis-ops-ui.mjs
 *
 *   Requires:  npx playwright (Playwright installed globally or in a parent)
 *
 * Tests
 * ─────
 *   1. Page boots without console errors
 *   2. Operations entry tile renders with stats
 *   3. Clicking "Open Operations" opens the overlay
 *   4. Sessions table populates with 3 mock rows
 *   5. Status badges render (running/completed/failed)
 *   6. Tag chips render
 *   7. Clicking a row opens the detail drawer
 *   8. Detail drawer shows trace events + tags + tools
 *   9. Add-tag flow surfaces input → calls tag endpoint
 *  10. Fork button opens fork modal → submit calls fork endpoint
 *
 * Exits nonzero if any test fails.
 */

// Resolve playwright from a global install (npm root -g) — not declared in
// package.json so Phase 2 doesn't bloat the dashboard's prod deps.
import { createRequire } from "module";
const _require = createRequire(import.meta.url);
let _playwrightPath;
try {
  _playwrightPath = _require.resolve("playwright");
} catch (_) {
  try {
    _playwrightPath = _require.resolve("playwright", { paths: ["/opt/homebrew/lib/node_modules", "/usr/local/lib/node_modules"] });
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
const PORT = 8123;

/* --------------------------- mock data --------------------------- */
const MOCK_SESSIONS = [
  {
    session_id: "tr_001",
    agent_name: "BENAIAH",
    started_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    completed_at: new Date(Date.now() - 4 * 60 * 1000).toISOString(),
    status: "completed",
    trace_url: "https://cloud.langfuse.com/trace/tr_001",
    langfuse_url: "https://cloud.langfuse.com/trace/tr_001",
    tags: ["needs-review", "revenue-impact"],
    total_tokens: 4521,
    tools_used: ["search", "send_email"],
    error_count: 0,
    trace_events: [
      { id: "e1", type: "GENERATION", name: "claude-opus-4-7", start: new Date(Date.now() - 5 * 60 * 1000).toISOString(), end: new Date(Date.now() - 4.5 * 60 * 1000).toISOString(), level: "DEFAULT", status_message: null },
      { id: "e2", type: "TOOL", name: "search", start: new Date(Date.now() - 4.4 * 60 * 1000).toISOString(), end: new Date(Date.now() - 4.3 * 60 * 1000).toISOString(), level: "DEFAULT" },
      { id: "e3", type: "MEMORY", name: "memory_write", start: new Date(Date.now() - 4.2 * 60 * 1000).toISOString(), end: new Date(Date.now() - 4.1 * 60 * 1000).toISOString(), level: "DEFAULT", status_message: "wrote scratchpad" },
    ],
  },
  {
    session_id: "tr_002",
    agent_name: "DANIEL",
    started_at: new Date(Date.now() - 60 * 1000).toISOString(),
    completed_at: null,
    status: "running",
    trace_url: "https://cloud.langfuse.com/trace/tr_002",
    langfuse_url: "https://cloud.langfuse.com/trace/tr_002",
    tags: [],
    total_tokens: null,
    tools_used: [],
    error_count: 0,
    trace_events: [],
  },
  {
    session_id: "tr_003",
    agent_name: "KRITE",
    started_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    completed_at: new Date(Date.now() - 29 * 60 * 1000).toISOString(),
    status: "failed",
    trace_url: "https://cloud.langfuse.com/trace/tr_003",
    langfuse_url: "https://cloud.langfuse.com/trace/tr_003",
    tags: ["error-spike"],
    total_tokens: 1203,
    tools_used: ["fetch"],
    error_count: 2,
    trace_events: [
      { id: "ee1", type: "GENERATION", name: "claude-sonnet-4", start: new Date(Date.now() - 30 * 60 * 1000).toISOString(), end: new Date(Date.now() - 29.5 * 60 * 1000).toISOString(), level: "ERROR", status_message: "rate_limit_exceeded" },
    ],
  },
];

/* ---------- tiny static + mock-API server ---------- */
function startServer() {
  const indexPath = path.resolve(ROOT, "index.html");
  const html = fs.readFileSync(indexPath, "utf8");
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url === "/" || req.url === "/index.html") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(html);
        return;
      }
      // Mock endpoints
      if (req.url.startsWith("/.netlify/functions/garvis-auth")) {
        res.writeHead(200, { "Content-Type": "application/json", "Set-Cookie": "garvis_token=mocked" });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      if (req.url.startsWith("/.netlify/functions/garvis-sessions-list")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          backend: "langfuse",
          count: MOCK_SESSIONS.length,
          page: 1,
          limit: 25,
          total_items: 3,
          total_pages: 1,
          sessions: MOCK_SESSIONS,
          timestamp: new Date().toISOString(),
        }));
        return;
      }
      if (req.url.startsWith("/.netlify/functions/garvis-session-info")) {
        const m = req.url.match(/session_id=([^&]+)/);
        const id = m ? decodeURIComponent(m[1]) : "";
        const found = MOCK_SESSIONS.find(s => s.session_id === id);
        if (!found) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "not_found" }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ...found, backend: "langfuse" }));
        return;
      }
      if (req.url.startsWith("/.netlify/functions/garvis-session-tag")) {
        let body = "";
        req.on("data", (c) => body += c);
        req.on("end", () => {
          const parsed = JSON.parse(body || "{}");
          const merged = (MOCK_SESSIONS.find(s => s.session_id === parsed.session_id)?.tags || []).concat(parsed.tags || []);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            session_id: parsed.session_id,
            tags: Array.from(new Set(merged)),
            updated_at: new Date().toISOString(),
          }));
        });
        return;
      }
      if (req.url.startsWith("/.netlify/functions/garvis-session-fork")) {
        let body = "";
        req.on("data", (c) => body += c);
        req.on("end", () => {
          const parsed = JSON.parse(body || "{}");
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            forked_session_id: "fork_" + Math.random().toString(16).slice(2, 10),
            source_session_id: parsed.session_id,
            status: "queued",
            queued_at: new Date().toISOString(),
            phase: 1,
          }));
        });
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

async function run() {
  const server = await startServer();
  let consoleErrors = [];
  let browser, ctx, page;
  try {
    browser = await chromium.launch();
    ctx = await browser.newContext();
    // Pre-set the auth cookie so the auth gate doesn't block
    await ctx.addCookies([{ name: "garvis_token", value: "mocked", domain: "localhost", path: "/", sameSite: "Strict" }]);
    page = await ctx.newPage();
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => consoleErrors.push("pageerror: " + err.message));
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: "domcontentloaded" });

    // Test 1: page boots
    await page.waitForSelector("#gops-entry-card", { timeout: 5000 });
    record("page boots, entry tile renders", true, "found #gops-entry-card");

    // Test 2: entry tile populates with stats (poll up to 3s for the 60s-interval fetch)
    let total = "";
    for (let i = 0; i < 30; i++) {
      total = await page.locator("#gops-stat-total").textContent();
      if (total && total !== "--") break;
      await page.waitForTimeout(100);
    }
    if (total === "3") {
      record("entry tile stats populate from list endpoint", true, `total=${total}`);
    } else {
      record("entry tile stats populate from list endpoint", false, `expected '3' got '${total}'`);
    }

    // Test 3: open Operations
    await page.locator("#gops-open-btn").click();
    await page.waitForSelector("#gops-scrim.open", { timeout: 2000 });
    record("Operations overlay opens", true, "scrim has .open class");

    // Test 4: rows render
    await page.waitForFunction(
      () => document.querySelectorAll("#gops-tbody tr[data-session-id]").length === 3,
      { timeout: 3000 }
    );
    const rowCount = await page.locator("#gops-tbody tr[data-session-id]").count();
    record("sessions table populates with mock rows", rowCount === 3, `rows=${rowCount}`);

    // Test 5: status badges
    const statusEls = await page.locator(".gops-status").allTextContents();
    const statusOk = statusEls.includes("completed") && statusEls.includes("running") && statusEls.includes("failed");
    record("status badges render correct labels", statusOk, `statuses=[${statusEls.join(", ")}]`);

    // Test 6: tag chips
    const chipsTextOnRow1 = await page.locator("#gops-tbody tr[data-session-id='tr_001'] .gops-chip").allTextContents();
    const chipOk = chipsTextOnRow1.includes("needs-review");
    record("tag chips render in list", chipOk, `chips=[${chipsTextOnRow1.join(", ")}]`);

    // Test 7: click a row → detail opens
    await page.locator("#gops-tbody tr[data-session-id='tr_001']").click();
    await page.waitForSelector("#gops-shell.detail-open", { timeout: 2000 });
    // wait for the async session-info fetch to populate the drawer
    await page.waitForFunction(
      () => {
        const el = document.getElementById("gops-detail-agent");
        return el && el.textContent.trim() === "BENAIAH";
      },
      { timeout: 3000 }
    ).catch(() => {});
    const agentName = await page.locator("#gops-detail-agent").textContent();
    record("detail drawer opens with agent name", agentName.trim() === "BENAIAH", `agent=${agentName}`);

    // Test 8: events render (including memory + error highlighting)
    await page.waitForFunction(
      () => document.querySelectorAll("#gops-detail-events .gops-event").length >= 3,
      { timeout: 3000 }
    ).catch(() => {});
    const eventCount = await page.locator("#gops-detail-events .gops-event").count();
    const memoryEvents = await page.locator("#gops-detail-events .gops-event.memory").count();
    record("trace events render", eventCount === 3, `events=${eventCount}, memory=${memoryEvents}`);

    // Test 9: add tag flow
    await page.locator("#gops-chip-add-btn").click();
    await page.waitForSelector(".gops-chip-input", { timeout: 1000 });
    await page.locator(".gops-chip-input").fill("smoke-test-tag");
    await page.locator(".gops-chip-input").press("Enter");
    // wait for re-render
    await page.waitForTimeout(400);
    const allChips = await page.locator("#gops-detail-chips .gops-chip").allTextContents();
    const tagAdded = allChips.some(t => t.includes("smoke-test-tag"));
    record("add-tag flow round-trips through endpoint", tagAdded, `chips=[${allChips.join(", ")}]`);

    // Test 10: fork modal
    await page.locator("#gops-detail-fork").click();
    await page.waitForSelector("#gops-fork-scrim.open", { timeout: 1000 });
    await page.locator("#gops-fork-prompt").fill("smoke-test fork prompt");
    await page.locator("#gops-fork-queue").click();
    // wait for toast
    await page.waitForTimeout(600);
    const toastText = await page.locator("#gops-toast").textContent();
    const forkOk = /Queued: fork_/.test(toastText);
    record("fork modal queues + shows toast", forkOk, `toast='${toastText.trim()}'`);

    // Console error sentinel — ignore 404/401 noise from un-mocked endpoints
    // (status, queue-list, etc.) since this smoke only mocks the 4 Ops endpoints.
    // Ignore: (a) 4xx for un-mocked dashboard endpoints, (b) console.error
    // calls from existing dashboard widgets that hit those un-mocked endpoints.
    const fatalErrors = consoleErrors.filter(e =>
      !/garvis-auth|status (401|404)|HTTP 404|Failed to load resource|Failed to fetch|Status fetch failed|fetchStatus|loadQueue|loadBrief|loadResearch|loadEvents|loadAutonomy|loadSamuel|loadVaultKeeper|loadScorecards|loadRoutines|fetching the script|service[\s-]?worker|sw\.js/i.test(e)
    );
    if (fatalErrors.length === 0) {
      record("no fatal JS errors", true, `(${consoleErrors.length} non-fatal 4xx noted from un-mocked endpoints)`);
    } else {
      record("no fatal JS errors", false, `${fatalErrors.length} errors: ${fatalErrors[0].slice(0, 120)}`);
    }
  } catch (err) {
    record("smoke runner crashed mid-test", false, err.message);
  } finally {
    if (browser) await browser.close();
    server.close();
  }

  console.log("\n## UI smoke summary\n");
  console.log("| Test | Result | Detail |");
  console.log("|------|--------|--------|");
  for (const r of results) {
    const sym = r.ok === true ? "PASS" : r.ok === "note" ? "NOTE" : "FAIL";
    console.log(`| ${r.name} | ${sym} | ${(r.detail || "").replace(/\|/g, "\\|")} |`);
  }
  const failed = results.some((r) => r.ok === false);
  if (failed) {
    console.log("\nFAILED — at least one UI test reported FAIL.");
    process.exit(1);
  }
  console.log("\nALL PASS.");
}

run().catch((err) => {
  console.error("UI smoke crashed:", err);
  process.exit(2);
});
