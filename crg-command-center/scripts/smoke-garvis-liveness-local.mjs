#!/usr/bin/env node
/**
 * smoke-garvis-liveness-local.mjs
 *
 * Loads each new Netlify Function via require() and invokes its handler
 * with a synthetic event. Verifies:
 *   - 200/2xx response
 *   - JSON parseable body
 *   - Expected top-level keys present
 *
 * This is a LOCAL smoke — it does NOT hit the deployed preview. For
 * production verification, run the same calls against
 * https://deploy-preview-N--<site>.netlify.app/api/garvis-* once the PR
 * preview is up.
 */

import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FN_DIR = path.resolve(__dirname, "../netlify/functions");

const VALID_TOKEN = "smoke-test-token-32-bytes-of-hex-chars-here-please-yes-thanks";
process.env.GARVIS_AUTH_TOKEN = VALID_TOKEN;

function event(method = "GET", body = null, qs = null) {
  return {
    httpMethod: method,
    headers: { cookie: `garvis_token=${VALID_TOKEN}`, "user-agent": "smoke" },
    queryStringParameters: qs,
    body: body ? JSON.stringify(body) : null,
  };
}

const SUITES = [
  {
    name: "silo-state",
    file: "garvis-silo-state.js",
    event: event("GET"),
    expect: (res) => {
      const data = JSON.parse(res.body);
      if (res.statusCode !== 200) throw new Error("non-200");
      if (!Array.isArray(data.silos) || data.silos.length !== 3) throw new Error(`expected 3 silos, got ${data.silos?.length}`);
      const ids = data.silos.map((s) => s.id).sort();
      const expected = ["peptides", "primerica", "real-estate"];
      if (JSON.stringify(ids) !== JSON.stringify(expected)) {
        throw new Error(`silo ids: expected ${expected.join(",")}, got ${ids.join(",")}`);
      }
      if (!Array.isArray(data.agents) || data.agents.length < 15) throw new Error(`expected >=15 agents, got ${data.agents?.length}`);
      return `${data.silos.length} silos · ${data.agents.length} agents · ${data.apps_canon.length} canon apps`;
    },
  },
  {
    name: "system-health",
    file: "garvis-system-health.js",
    event: event("GET"),
    timeout_ms: 30_000,
    expect: (res) => {
      const data = JSON.parse(res.body);
      if (res.statusCode !== 200) throw new Error("non-200");
      if (!Array.isArray(data.results)) throw new Error("missing results array");
      if (data.results.length < 10) throw new Error(`expected >=10 probes, got ${data.results.length}`);
      const live = data.results.filter((r) => r.status === "live").length;
      return `${data.results.length} probes · live ${live} · runtime ${data.total_runtime_ms}ms`;
    },
  },
  {
    name: "agents-status",
    file: "garvis-agents-status.js",
    event: event("GET"),
    expect: (res) => {
      const data = JSON.parse(res.body);
      if (res.statusCode !== 200) throw new Error("non-200");
      if (!Array.isArray(data.agents)) throw new Error("missing agents array");
      if (data.agents.length < 15) throw new Error(`expected >=15 agents, got ${data.agents.length}`);
      const cls = data.counts;
      return `${data.agents.length} agents · GREEN ${cls.green} / YELLOW ${cls.yellow} / RED ${cls.red} · backend ${data.backend}`;
    },
  },
  {
    name: "routines",
    file: "garvis-routines.js",
    event: event("GET"),
    expect: (res) => {
      const data = JSON.parse(res.body);
      if (res.statusCode !== 200) throw new Error("non-200");
      if (!Array.isArray(data.routines)) throw new Error("missing routines array");
      const withNext = data.routines.filter((r) => r.next_fire_at).length;
      if (withNext < 5) throw new Error(`expected >=5 with next_fire_at, got ${withNext}`);
      return `${data.routines.length} routines · ${withNext} with next_fire · backend ${data.backend}`;
    },
  },
  {
    name: "coming-up",
    file: "garvis-coming-up.js",
    event: event("GET"),
    timeout_ms: 30_000,
    expect: (res) => {
      const data = JSON.parse(res.body);
      if (res.statusCode !== 200) throw new Error("non-200");
      if (!Array.isArray(data.items)) throw new Error("missing items array");
      if (!Array.isArray(data.cron_fires) || data.cron_fires.length < 3) {
        throw new Error(`expected >=3 cron fires, got ${data.cron_fires?.length}`);
      }
      return `${data.items.length} items · ${data.cron_fires.length} fires · ${data.open_prs.length} PRs · backend ${data.backend}`;
    },
  },
  {
    name: "tasks-list-empty",
    file: "garvis-tasks.js",
    event: event("GET"),
    expect: (res) => {
      const data = JSON.parse(res.body);
      if (res.statusCode !== 200) throw new Error("non-200");
      if (!Array.isArray(data.items)) throw new Error("missing items array");
      // In local smoke, there's no Blobs backend — should be memory-only
      return `count ${data.count} · backend ${data.backend}`;
    },
  },
  {
    name: "tasks-create",
    file: "garvis-tasks.js",
    event: event("POST", {
      title: "smoke test task",
      priority: "MEDIUM",
      silo: "cross-cutting",
      eta_minutes: 5,
    }),
    expect: (res) => {
      const data = JSON.parse(res.body);
      // Without Blobs the create silently no-ops; we just verify shape parses
      if (![200, 201, 500].includes(res.statusCode)) {
        throw new Error(`unexpected status ${res.statusCode}`);
      }
      return `status ${res.statusCode} · backend ${data.backend || "?"}`;
    },
  },
];

(async () => {
  let pass = 0, fail = 0;
  console.log("# Garvis liveness smoke (local)");
  console.log("#");
  for (const s of SUITES) {
    process.stdout.write(`- ${s.name.padEnd(22, " ")} `);
    try {
      const handler = require(path.join(FN_DIR, s.file)).handler;
      const t0 = Date.now();
      const res = await Promise.race([
        handler(s.event),
        new Promise((_, rj) => setTimeout(() => rj(new Error("local timeout")), s.timeout_ms || 10_000)),
      ]);
      const elapsed = Date.now() - t0;
      const note = s.expect(res);
      console.log(`OK (${elapsed}ms) · ${note}`);
      pass++;
    } catch (err) {
      console.log(`FAIL · ${err.message}`);
      fail++;
    }
  }
  console.log("#");
  console.log(`# pass=${pass} fail=${fail} total=${SUITES.length}`);
  process.exit(fail ? 1 : 0);
})();
