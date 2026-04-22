/**
 * Netlify Function: /.netlify/functions/status
 * Called by Command Center dashboard every 30s.
 * Proxies to Windmill system_status_v1 and returns the JSON.
 */

const { checkAuth, unauthorized } = require('./_lib/garvis-auth');

const WINDMILL_BASE = process.env.WINDMILL_BASE_URL || "https://gmbh-lion-mar-epson.trycloudflare.com";
// TODO(levite): rotate WINDMILL_TOKEN — previous value leaked in git history pre-2026-04-21
const WINDMILL_TOKEN = process.env.WINDMILL_TOKEN;

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: cors(), body: "" };
  }

  if (!checkAuth(event)) return unauthorized(cors());

  if (!WINDMILL_TOKEN) {
    return {
      statusCode: 503,
      headers: cors(),
      body: JSON.stringify({
        error: true,
        message: "Service unavailable: WINDMILL_TOKEN not configured",
        systems: {
          windmill: { status: "red", label: "DOWN", detail: "Missing server credentials" }
        },
        counters: { contacts_today: 0, calls_today: 0 },
        timestamp: new Date().toISOString()
      })
    };
  }

  try {
    const url = `${WINDMILL_BASE}/api/w/admins/jobs/run_wait_result/p/u/admin/system_status_v1`;
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${WINDMILL_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({})
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return {
        statusCode: 200,
        headers: cors(),
        body: JSON.stringify({
          error: true,
          message: "Windmill unreachable",
          detail: errText.slice(0, 200),
          systems: {
            script_engine:     { status: "gray", label: "UNKNOWN", detail: "Status service down" },
            vapi_qualifier:    { status: "gray", label: "UNKNOWN" },
            ghl_crm:           { status: "gray", label: "UNKNOWN" },
            windmill:          { status: "red",  label: "DOWN",    detail: `HTTP ${resp.status}` },
            vault_os:          { status: "gray", label: "UNKNOWN" },
            peptide_app:       { status: "gray", label: "UNKNOWN" },
            cloudflare_tunnel: { status: "yellow", label: "QUICK TUNNEL", detail: "Waiting GoDaddy DNS" }
          },
          counters: { contacts_today: 0, calls_today: 0 },
          timestamp: new Date().toISOString()
        })
      };
    }

    const data = await resp.json();
    return {
      statusCode: 200,
      headers: cors(),
      body: JSON.stringify(data)
    };

  } catch (err) {
    return {
      statusCode: 200,
      headers: cors(),
      body: JSON.stringify({
        error: true,
        message: err.message,
        systems: {
          windmill: { status: "red", label: "DOWN", detail: err.message.slice(0, 60) }
        },
        counters: { contacts_today: 0, calls_today: 0 }
      })
    };
  }
};

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Content-Type": "application/json",
    "Cache-Control": "no-store"
  };
}
