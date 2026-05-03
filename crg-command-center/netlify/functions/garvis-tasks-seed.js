/**
 * Netlify Function: /.netlify/functions/garvis-tasks-seed
 *
 * POST — idempotent seed of the original 10 hardcoded tasks from index.html.
 *
 * Reads the current Blobs store; for any seed-id NOT already present, inserts
 * it. Existing tasks are left alone. Marc can flip done/pending freely without
 * the seeder un-doing his work.
 *
 * Garvis liveness sprint.
 */

const { checkAuth, unauthorized } = require("./_lib/garvis-auth");

const STORE_NAME = "garvis-tasks";
const KEY = "tasks.json";

const SEED_TASKS = [
  {
    id: "seed-benaiah-setup-env",
    title: "Set BENAIAH Netlify env vars (unlocks the Send button)",
    priority: "HIGH",
    silo: "primerica",
    eta_minutes: 5,
    instructions: [
      "Netlify dashboard → cornerstoneregroup site → Site settings → Environment variables",
      "Add ANTHROPIC_API_KEY, RESEND_KEY, GHL_TOKEN (pit-f36f03f4...), GHL_LOCATION_ID (9Z3U7KnyQSbbnaKyTS2e)",
      "Redeploy and test the BENAIAH Send flow",
    ],
    source: "seed-may2",
  },
  {
    id: "seed-paste-ghl-emails",
    title: "Paste 7 mortgage-licensing email templates into GHL",
    priority: "HIGH",
    silo: "primerica",
    eta_minutes: 15,
    instructions: [
      "Open GHL-EMAIL-PACK-MORTGAGE-LICENSING.md",
      "GHL → Marketing → Emails → Templates → + New → HTML Builder for each of EMAIL-01..EMAIL-07",
    ],
    source: "seed-may2",
  },
  {
    id: "seed-ghl-workflow",
    title: "Build GHL drip workflow for licensing inquiry",
    priority: "HIGH",
    silo: "primerica",
    eta_minutes: 10,
    instructions: [
      "Run AFTER the 7 templates are pasted",
      "GHL → Automation → Workflows → + New",
      "Name: Licensing Inquiry — Mortgage Broker; trigger: Tag = licensing-inquiry",
    ],
    source: "seed-may2",
  },
  {
    id: "seed-wire-vapi-assistants",
    title: "Create 3 Vapi assistants for Script Engine tools",
    priority: "HIGH",
    silo: "cross-cutting",
    eta_minutes: 30,
    instructions: [
      "Vapi dashboard → create evaluator-alex, compliance-alex, generator-alex",
      "Paste system prompts from SCRIPT-ENGINE-CALL-AGENT-SCRIPTS.md",
      "Test each with personal phone",
    ],
    source: "seed-may2",
  },
  {
    id: "seed-cloudflare-tunnel",
    title: "Replace Cloudflare quick tunnel with permanent tunnel",
    priority: "LOW",
    silo: "cross-cutting",
    eta_minutes: 15,
    instructions: [
      "cloudflared tunnel login on the host Mac",
      "cloudflared tunnel create cornerstone-prod",
      "Route DNS in GoDaddy/Cloudflare to the tunnel",
      "Update WINDMILL_BASE_URL across functions",
    ],
    source: "seed-may2",
  },
  {
    id: "seed-klow-data-fix",
    title: "KLOW catalog: stop splitting paired-compound dose into components",
    priority: "MEDIUM",
    silo: "peptides",
    eta_minutes: 20,
    instructions: [
      "KLOW = single Vitalis blend (BPC 10mg / TB-500 10mg / KPV 10mg / GHK-Cu 50mg per vial)",
      "Find catalog-data.json entry that breaks it into components and fold into one SKU",
      "Route through Builder → KRITE → Karis (do NOT inline-fix per Build Pipeline doctrine)",
    ],
    source: "seed-may2",
  },
  {
    id: "seed-vault-os-canonical-path",
    title: "Confirm Vault OS canonical path + stack",
    priority: "MEDIUM",
    silo: "primerica",
    eta_minutes: 10,
    instructions: [
      "APPS-CANON.md has Vault OS as TBD path/stack",
      "Decide canonical repo location and stack (likely papineau-family-finance)",
      "Update APPS-CANON.md in same commit as decision",
    ],
    source: "seed-may2",
  },
  {
    id: "seed-asher-protocol-package-endpoint",
    title: "Verify Asher protocol-package on-demand endpoint",
    priority: "MEDIUM",
    silo: "peptides",
    eta_minutes: 15,
    instructions: [
      "asher-protocol-package-background is the on-demand sibling of the weekly-research cron",
      "Test fire from Garvis or curl with a sample client name",
      "Verify Telegram delivery + 3-doc PDF output (naturopath order + N-week guide + recon cheat-sheet)",
    ],
    source: "seed-may2",
  },
  {
    id: "seed-replace-book-calendar",
    title: "Replace GHL calendar slug placeholder on /book/ page",
    priority: "HIGH",
    silo: "real-estate",
    eta_minutes: 5,
    instructions: [
      "GHL → Calendars → Discovery Call → Settings → copy public booking URL",
      "Edit cornerstoneregroup-site/book/index.html — replace cornerstoneregroup-demo with real slug",
      "netlify deploy --prod",
    ],
    source: "seed-may2",
  },
  {
    id: "seed-jason-presentation",
    title: "Review Jason Anbara custom presentation (built overnight)",
    priority: "HIGH",
    silo: "primerica",
    eta_minutes: 10,
    instructions: [
      "Open JASON-ANBARA-RESEARCH-BRIEF.md and JASON-MEETING-PLAN.md",
      "Review email-to-Michael draft at EMAIL-TO-MICHAEL-JASON-ASSISTANT.md",
      "Visit https://cornerstoneregroup.netlify.app/jason/",
      "Approve or request edits, then send",
    ],
    source: "seed-may2",
  },
];

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  };
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

  let store = null;
  try {
    const blobs = await import("@netlify/blobs");
    if (typeof blobs.connectLambda === "function") blobs.connectLambda(event);
    store = blobs.getStore({ name: STORE_NAME, consistency: "strong" });
  } catch (_) {
    return {
      statusCode: 503,
      headers: cors(),
      body: JSON.stringify({ error: "blobs_unavailable", detail: "Cannot seed without Netlify Blobs" }),
    };
  }

  let existing = [];
  try {
    const raw = await store.get(KEY, { type: "json" });
    if (raw && Array.isArray(raw.items)) existing = raw.items;
  } catch (_) {}

  const existingIds = new Set(existing.map((t) => t.id));
  const inserted = [];
  const skipped = [];

  const nowIso = new Date().toISOString();
  for (const seed of SEED_TASKS) {
    if (existingIds.has(seed.id)) {
      skipped.push(seed.id);
      continue;
    }
    inserted.push({
      ...seed,
      status: "pending",
      created_at: nowIso,
      completed_at: null,
    });
  }

  const merged = [...existing, ...inserted];
  try {
    await store.setJSON(KEY, { items: merged, updated_at: nowIso });
  } catch (err) {
    return {
      statusCode: 500,
      headers: cors(),
      body: JSON.stringify({ error: "write_failed", detail: err.message }),
    };
  }

  return {
    statusCode: 200,
    headers: cors(),
    body: JSON.stringify({
      backend: "netlify-blobs",
      ok: true,
      inserted: inserted.map((t) => t.id),
      skipped,
      total: merged.length,
      timestamp: nowIso,
    }),
  };
};
