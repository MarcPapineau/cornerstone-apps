/**
 * Netlify Function: /.netlify/functions/garvis-routines
 *
 * GET — returns the canonical list of CRG cron-scheduled functions
 * (routines) with last/next-fire metadata.
 *
 * Source of truth: silo-state.json `agents[]` entries that have a
 * `schedule` (cron expression). For each, we compute:
 *   - cron expression (from registry)
 *   - human-readable schedule (from registry)
 *   - last_fired_at — best-effort from Langfuse (may be null without creds)
 *   - next_fire_at — naive cron evaluation in America/Toronto
 *   - status — never-fired | overdue | running-soon | healthy
 *
 * Naive cron evaluator handles standard 5-field expressions (m h dom mon dow).
 * Sufficient for our expressions like every-15-min, hourly, daily, etc.
 *
 * Garvis liveness sprint.
 */

const { checkAuth, unauthorized } = require("./_lib/garvis-auth");
const { loadSiloStateSync } = require("./_lib/silo-state-loader");

const LANGFUSE_BASE = process.env.LANGFUSE_BASE_URL || "https://us.cloud.langfuse.com";
const LANGFUSE_PUBLIC = process.env.LANGFUSE_PUBLIC_KEY || "";
const LANGFUSE_SECRET = process.env.LANGFUSE_SECRET_KEY || "";

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  };
}

/* ─── Naive cron parser ─────────────────────────────────────────────────── */

function parseField(field, min, max) {
  // Returns sorted array of integers within [min,max] that match this field.
  if (field === "*") {
    const out = [];
    for (let i = min; i <= max; i++) out.push(i);
    return out;
  }
  const out = new Set();
  field.split(",").forEach((part) => {
    let step = 1;
    let body = part;
    if (body.includes("/")) {
      const [b, s] = body.split("/");
      body = b;
      step = parseInt(s, 10) || 1;
    }
    if (body === "*") {
      for (let i = min; i <= max; i += step) out.add(i);
      return;
    }
    if (body.includes("-")) {
      const [a, b] = body.split("-").map((n) => parseInt(n, 10));
      for (let i = a; i <= b; i += step) {
        if (i >= min && i <= max) out.add(i);
      }
      return;
    }
    const v = parseInt(body, 10);
    if (Number.isFinite(v)) out.add(v);
  });
  return [...out].sort((a, b) => a - b);
}

/**
 * Compute the next fire time for a cron expression IN America/Toronto.
 * Iterates minute-by-minute from `from` (Date) up to 366 days ahead. Returns
 * a Date, or null if not found (e.g. "Jan 1 only" expressions can return null
 * if `from` is past Jan 1 of next year — extremely rare here).
 *
 * For our load (5 fields, common expressions, < 1y horizon) the linear
 * scan is fine — under 525,600 iterations max, but in practice exits within
 * one day.
 */
function nextFire(cron, from) {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [mF, hF, domF, monF, dowF] = parts;
  const minutes = new Set(parseField(mF, 0, 59));
  const hours = new Set(parseField(hF, 0, 23));
  const doms = new Set(parseField(domF, 1, 31));
  const months = new Set(parseField(monF, 1, 12));
  const dows = new Set(parseField(dowF, 0, 6)); // 0 = Sun

  // We evaluate against America/Toronto wallclock. JS Date is always UTC at
  // its core, so build candidate timestamps by getting Toronto-local fields.
  const TZ = "America/Toronto";
  const cursor = new Date(from.getTime());
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1); // start from "next minute"

  const horizonMs = 366 * 24 * 60 * 60 * 1000;
  const stop = from.getTime() + horizonMs;

  while (cursor.getTime() <= stop) {
    const fields = torontoFields(cursor);
    if (
      minutes.has(fields.minute) &&
      hours.has(fields.hour) &&
      doms.has(fields.day) &&
      months.has(fields.month) &&
      dows.has(fields.weekday)
    ) {
      return new Date(cursor.getTime());
    }
    cursor.setMinutes(cursor.getMinutes() + 1);
  }
  return null;
}

function torontoFields(d) {
  // Use Intl.DateTimeFormat to get Toronto local fields without DST headaches.
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Toronto",
    hour12: false, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", weekday: "short",
  });
  const parts = fmt.formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t)?.value || "";
  const wdMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: parseInt(get("year"), 10),
    month: parseInt(get("month"), 10),
    day: parseInt(get("day"), 10),
    hour: parseInt(get("hour"), 10) % 24,
    minute: parseInt(get("minute"), 10),
    weekday: wdMap[get("weekday")] ?? 0,
  };
}

/* ─── Status classification ─────────────────────────────────────────────── */

function classify(routine, now) {
  if (!routine.last_fired_at) return { status: "never-fired", note: "No firing recorded" };
  const last = new Date(routine.last_fired_at).getTime();
  const next = routine.next_fire_at ? new Date(routine.next_fire_at).getTime() : null;
  // Heuristic: if last fired > 2x cron interval ago and we have a next, mark overdue
  // We don't compute the interval — instead check whether last fired is older than 7d
  if (now - last > 7 * 24 * 60 * 60 * 1000) {
    return { status: "overdue", note: "Last firing > 7 days ago" };
  }
  if (next && next - now < 60 * 60 * 1000) {
    return { status: "running-soon", note: "Fires in the next hour" };
  }
  return { status: "healthy", note: "Recent firing" };
}

/* ─── Langfuse last_run lookup (best-effort) ───────────────────────────── */

async function lastFiredAt(agentId) {
  if (!LANGFUSE_PUBLIC || !LANGFUSE_SECRET) return null;
  try {
    const url = new URL(`${LANGFUSE_BASE}/api/public/traces`);
    url.searchParams.set("userId", agentId);
    url.searchParams.set("limit", "1");
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3500);
    const tok = Buffer.from(`${LANGFUSE_PUBLIC}:${LANGFUSE_SECRET}`).toString("base64");
    const resp = await fetch(url.toString(), {
      headers: { Authorization: `Basic ${tok}`, "Content-Type": "application/json" },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!resp.ok) return null;
    const json = await resp.json();
    const data = Array.isArray(json.data) ? json.data : [];
    if (!data.length) return null;
    return data[0].timestamp || data[0].startTime || data[0].createdAt || null;
  } catch (_) {
    return null;
  }
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: cors(), body: "" };
  }
  if (event.httpMethod !== "GET") {
    return {
      statusCode: 405,
      headers: cors(),
      body: JSON.stringify({ error: "method_not_allowed" }),
    };
  }
  if (!checkAuth(event)) return unauthorized(cors());

  const state = loadSiloStateSync();
  const agents = Array.isArray(state.agents) ? state.agents : [];
  const scheduled = agents.filter((a) => a.schedule);

  const now = new Date();
  const out = await Promise.all(scheduled.map(async (a) => {
    const next = nextFire(a.schedule, now);
    const last = await lastFiredAt(a.id);
    const routine = {
      id: a.id,
      name: a.name,
      role: a.role,
      silo: a.silo,
      cron: a.schedule,
      cron_human: a.schedule_human,
      last_fired_at: last,
      next_fire_at: next ? next.toISOString() : null,
    };
    const cls = classify(routine, now.getTime());
    return { ...routine, status: cls.status, status_detail: cls.note };
  }));

  // Sort by next_fire ascending, nulls last
  out.sort((a, b) => {
    const ax = a.next_fire_at ? new Date(a.next_fire_at).getTime() : Infinity;
    const bx = b.next_fire_at ? new Date(b.next_fire_at).getTime() : Infinity;
    return ax - bx;
  });

  return {
    statusCode: 200,
    headers: cors(),
    body: JSON.stringify({
      backend: LANGFUSE_PUBLIC ? "registry+langfuse" : "registry-only",
      counts: {
        total: out.length,
        healthy: out.filter((r) => r.status === "healthy").length,
        running_soon: out.filter((r) => r.status === "running-soon").length,
        overdue: out.filter((r) => r.status === "overdue").length,
        never_fired: out.filter((r) => r.status === "never-fired").length,
      },
      routines: out,
      timestamp: now.toISOString(),
    }),
  };
};
