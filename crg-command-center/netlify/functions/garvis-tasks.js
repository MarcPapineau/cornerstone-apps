/**
 * Netlify Function: /.netlify/functions/garvis-tasks
 *
 * GET    — list all tasks (optionally filter by ?status=pending|done, ?silo=)
 * POST   — create a new task. Body: { title, priority, silo, eta_minutes, instructions }
 * PUT    — update a task.   Body: { id, ...patch }   (idempotent merge)
 * DELETE — delete a task.   Body: { id }   OR  query  ?id=
 *
 * Storage: Netlify Blobs store "garvis-tasks", key "tasks.json".
 * Falls back to in-memory empty list if Blobs unavailable.
 *
 * Item shape:
 *   {
 *     id: "task-<rand>",
 *     title: string,
 *     priority: "HIGH" | "MEDIUM" | "LOW",
 *     status: "pending" | "done",
 *     silo: "real-estate" | "peptides" | "primerica" | "cross-cutting",
 *     eta_minutes: number,
 *     instructions: string[],
 *     created_at: ISO,
 *     completed_at: ISO | null
 *   }
 *
 * Garvis liveness sprint.
 */

const { checkAuth, unauthorized } = require("./_lib/garvis-auth");

const STORE_NAME = "garvis-tasks";
const KEY = "tasks.json";

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  };
}

async function loadStore() {
  try {
    const blobs = await import("@netlify/blobs");
    if (typeof blobs.connectLambda === "function") {
      // connectLambda is called at handler entry; if not yet wired we fall back.
    }
    return blobs.getStore({ name: STORE_NAME, consistency: "strong" });
  } catch (_) {
    return null;
  }
}

async function readTasks(store) {
  if (!store) return [];
  try {
    const raw = await store.get(KEY, { type: "json" });
    if (raw && Array.isArray(raw.items)) return raw.items;
    return [];
  } catch (_) {
    return [];
  }
}

async function writeTasks(store, items) {
  if (!store) return false;
  try {
    await store.setJSON(KEY, { items, updated_at: new Date().toISOString() });
    return true;
  } catch (_) {
    return false;
  }
}

function newId() {
  const rnd = Math.random().toString(36).slice(2, 8);
  const ts = Date.now().toString(36);
  return `task-${ts}-${rnd}`;
}

function parseBody(event) {
  if (!event.body) return {};
  try {
    return JSON.parse(event.body);
  } catch (_) {
    return {};
  }
}

function validatePriority(p) {
  const v = String(p || "MEDIUM").toUpperCase();
  return ["HIGH", "MEDIUM", "LOW"].includes(v) ? v : "MEDIUM";
}

function validateStatus(s) {
  const v = String(s || "pending").toLowerCase();
  return ["pending", "done"].includes(v) ? v : "pending";
}

function validateSilo(s) {
  const v = String(s || "cross-cutting").toLowerCase();
  return ["real-estate", "peptides", "primerica", "cross-cutting"].includes(v) ? v : "cross-cutting";
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: cors(), body: "" };
  }
  if (!checkAuth(event)) return unauthorized(cors());

  // Bootstrap Blobs from Lambda event
  try {
    const blobs = await import("@netlify/blobs");
    if (typeof blobs.connectLambda === "function") {
      blobs.connectLambda(event);
    }
  } catch (_) {}

  const store = await loadStore();
  const backend = store ? "netlify-blobs" : "memory-only";

  if (event.httpMethod === "GET") {
    const items = await readTasks(store);
    const params = event.queryStringParameters || {};
    let filtered = items;
    if (params.status) {
      filtered = filtered.filter((t) => t.status === params.status);
    }
    if (params.silo) {
      filtered = filtered.filter((t) => t.silo === params.silo);
    }
    // Sort: pending first by priority, then completed
    const prioRank = { HIGH: 0, MEDIUM: 1, LOW: 2 };
    filtered = [...filtered].sort((a, b) => {
      const ad = a.status === "done" ? 1 : 0;
      const bd = b.status === "done" ? 1 : 0;
      if (ad !== bd) return ad - bd;
      const pa = prioRank[a.priority] ?? 9;
      const pb = prioRank[b.priority] ?? 9;
      if (pa !== pb) return pa - pb;
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });

    return {
      statusCode: 200,
      headers: cors(),
      body: JSON.stringify({
        backend,
        count: filtered.length,
        pending: filtered.filter((t) => t.status === "pending").length,
        items: filtered,
        timestamp: new Date().toISOString(),
      }),
    };
  }

  if (event.httpMethod === "POST") {
    const body = parseBody(event);
    if (!body.title || typeof body.title !== "string" || body.title.length < 3) {
      return {
        statusCode: 400,
        headers: cors(),
        body: JSON.stringify({ error: "title_required", detail: "Title must be ≥ 3 characters" }),
      };
    }
    const items = await readTasks(store);
    const task = {
      id: body.id || newId(),
      title: body.title.trim(),
      priority: validatePriority(body.priority),
      status: validateStatus(body.status),
      silo: validateSilo(body.silo),
      eta_minutes: typeof body.eta_minutes === "number" ? body.eta_minutes : (body.eta_minutes ? parseInt(body.eta_minutes, 10) : null),
      instructions: Array.isArray(body.instructions) ? body.instructions : (body.instructions ? [String(body.instructions)] : []),
      created_at: new Date().toISOString(),
      completed_at: null,
      source: body.source || "manual",
    };
    items.push(task);
    const ok = await writeTasks(store, items);
    return {
      statusCode: ok ? 201 : 500,
      headers: cors(),
      body: JSON.stringify({ backend, ok, task, count: items.length }),
    };
  }

  if (event.httpMethod === "PUT") {
    const body = parseBody(event);
    if (!body.id) {
      return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: "id_required" }) };
    }
    const items = await readTasks(store);
    const idx = items.findIndex((t) => t.id === body.id);
    if (idx === -1) {
      return { statusCode: 404, headers: cors(), body: JSON.stringify({ error: "not_found", id: body.id }) };
    }
    const merged = { ...items[idx], ...body };
    if (body.status === "done" && !items[idx].completed_at) {
      merged.completed_at = new Date().toISOString();
    }
    if (body.status === "pending") {
      merged.completed_at = null;
    }
    items[idx] = merged;
    const ok = await writeTasks(store, items);
    return {
      statusCode: ok ? 200 : 500,
      headers: cors(),
      body: JSON.stringify({ backend, ok, task: merged }),
    };
  }

  if (event.httpMethod === "DELETE") {
    const body = parseBody(event);
    const id = body.id || (event.queryStringParameters && event.queryStringParameters.id);
    if (!id) {
      return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: "id_required" }) };
    }
    const items = await readTasks(store);
    const next = items.filter((t) => t.id !== id);
    if (next.length === items.length) {
      return { statusCode: 404, headers: cors(), body: JSON.stringify({ error: "not_found", id }) };
    }
    const ok = await writeTasks(store, next);
    return {
      statusCode: ok ? 200 : 500,
      headers: cors(),
      body: JSON.stringify({ backend, ok, deleted: id, count: next.length }),
    };
  }

  return {
    statusCode: 405,
    headers: cors(),
    body: JSON.stringify({ error: "method_not_allowed", method: event.httpMethod }),
  };
};
