/**
 * Netlify Function: /.netlify/functions/garvis-coming-up
 *
 * GET — surfaces the "What's Coming Up" dashboard section.
 *
 * Aggregates THREE sources:
 *   1. Next 5 scheduled cron firings (from silo-state.json)
 *   2. Open pull requests in cornerstoneregroup-site + cornerstone-apps
 *      (from GitHub REST API; requires GITHUB_TOKEN env)
 *   3. Future: scheduled deploys / Netlify build queue
 *
 * Each item: { kind, title, when_iso, when_human, ref, link }
 *
 * Garvis liveness sprint.
 */

const { checkAuth, unauthorized } = require("./_lib/garvis-auth");
const { loadSiloStateSync } = require("./_lib/silo-state-loader");

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
const REPOS = [
  { owner: "marcpapineau", name: "cornerstoneregroup-site" },
  { owner: "MarcPapineau", name: "cornerstone-apps" },
];

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  };
}

/* ── Cron eval (mirror of garvis-routines) ────────────────────────── */
function parseField(field, min, max) {
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

function torontoFields(d) {
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

function nextFire(cron, from) {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [mF, hF, domF, monF, dowF] = parts;
  const minutes = new Set(parseField(mF, 0, 59));
  const hours = new Set(parseField(hF, 0, 23));
  const doms = new Set(parseField(domF, 1, 31));
  const months = new Set(parseField(monF, 1, 12));
  const dows = new Set(parseField(dowF, 0, 6));

  const cursor = new Date(from.getTime());
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);
  const stop = from.getTime() + 366 * 24 * 60 * 60 * 1000;

  while (cursor.getTime() <= stop) {
    const f = torontoFields(cursor);
    if (
      minutes.has(f.minute) && hours.has(f.hour) &&
      doms.has(f.day) && months.has(f.month) && dows.has(f.weekday)
    ) {
      return new Date(cursor.getTime());
    }
    cursor.setMinutes(cursor.getMinutes() + 1);
  }
  return null;
}

function humanWhen(iso, now) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  const diff = t - now;
  const sign = diff < 0 ? "ago" : "from now";
  const abs = Math.abs(diff);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (abs < hour) return `${Math.round(abs / minute)} min ${sign}`;
  if (abs < day) return `${Math.round(abs / hour)} hour ${sign}`;
  return `${Math.round(abs / day)} day ${sign}`;
}

/* ── GitHub PRs ───────────────────────────────────────────────────── */
async function fetchOpenPRs(repo) {
  const url = `https://api.github.com/repos/${repo.owner}/${repo.name}/pulls?state=open&per_page=10`;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const headers = {
      "Accept": "application/vnd.github+json",
      "User-Agent": "Garvis-ComingUp/1.0",
    };
    if (GITHUB_TOKEN) headers["Authorization"] = `Bearer ${GITHUB_TOKEN}`;
    const resp = await fetch(url, { headers, signal: ctrl.signal });
    clearTimeout(t);
    if (!resp.ok) return [];
    const json = await resp.json();
    if (!Array.isArray(json)) return [];
    return json.map((pr) => ({
      kind: "pr-open",
      title: `PR #${pr.number} · ${pr.title}`,
      when_iso: pr.created_at,
      ref: `${repo.owner}/${repo.name}#${pr.number}`,
      link: pr.html_url,
      draft: pr.draft === true,
      labels: (pr.labels || []).map((l) => l.name),
    }));
  } catch (_) {
    return [];
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

  const now = new Date();
  const state = loadSiloStateSync();
  const agents = Array.isArray(state.agents) ? state.agents : [];

  // 1. Next 5 cron firings
  const fires = agents
    .filter((a) => a.schedule)
    .map((a) => {
      const next = nextFire(a.schedule, now);
      return next ? {
        kind: "cron-fire",
        title: `${a.schedule_human || a.schedule} · ${a.name}`,
        when_iso: next.toISOString(),
        ref: a.id,
        link: null,
        agent_id: a.id,
        silo: a.silo,
      } : null;
    })
    .filter(Boolean)
    .sort((a, b) => new Date(a.when_iso) - new Date(b.when_iso))
    .slice(0, 5);

  // 2. Open PRs (parallel fetch across repos)
  const prsByRepo = await Promise.all(REPOS.map(fetchOpenPRs));
  const prs = prsByRepo.flat()
    .sort((a, b) => new Date(b.when_iso) - new Date(a.when_iso))
    .slice(0, 10);

  // Decorate humans
  const nowMs = now.getTime();
  const fireItems = fires.map((f) => ({ ...f, when_human: humanWhen(f.when_iso, nowMs) }));
  const prItems = prs.map((p) => ({ ...p, when_human: humanWhen(p.when_iso, nowMs) }));

  // Combined feed (cron firings first, then PRs)
  const items = [...fireItems, ...prItems];

  return {
    statusCode: 200,
    headers: cors(),
    body: JSON.stringify({
      backend: GITHUB_TOKEN ? "registry+github" : "registry-only",
      counts: {
        total: items.length,
        cron_fires: fireItems.length,
        open_prs: prItems.length,
      },
      cron_fires: fireItems,
      open_prs: prItems,
      items,
      timestamp: now.toISOString(),
    }),
  };
};
