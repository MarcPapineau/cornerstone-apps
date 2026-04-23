/**
 * Netlify Function: /.netlify/functions/submit-order
 *
 * MyBioYouth POS → Windmill mybioyouth_order_v1
 *
 * Receives the full order payload from the POS "Save Order" button,
 * proxies to Windmill which logs to GHL + emails Marc (via KRITE gate)
 * + emails the client confirmation.
 *
 * No payment processing — email-based fulfilment per Marc's mandate.
 */

const WINDMILL_BASE = process.env.WINDMILL_BASE_URL || "https://gmbh-lion-mar-epson.trycloudflare.com";
const WINDMILL_TOKEN = process.env.WINDMILL_TOKEN;
const SCRIPT_PATH = "u/admin/mybioyouth_order_v1";

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: cors(), body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: cors(), body: JSON.stringify({ error: "Method not allowed" }) };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: "Invalid JSON" }) }; }

  // Validate
  if (!body.clientName && !body.client?.name) {
    return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: "Client name required" }) };
  }
  if (!Array.isArray(body.lines) || body.lines.length === 0) {
    return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: "No order lines" }) };
  }

  // Pull client fields (support both shapes)
  const clientName = body.clientName || body.client?.name || "";
  const clientEmail = body.clientEmail || body.client?.email || "";
  const clientPhone = body.clientPhone || body.client?.phone || "";

  // Use Windmill's async run endpoint — returns job_id immediately,
  // doesn't wait for KRITE gate (which can take 60-120s).
  // The client can poll the job_id or just trust that it ran.
  try {
    const url = `${WINDMILL_BASE}/api/w/admins/jobs/run/p/${SCRIPT_PATH}`;

    const windmillPayload = {
      client_name: clientName,
      client_email: clientEmail,
      client_phone: clientPhone,
      lines: body.lines,
      subtotal: Number(body.subtotal || 0),
      discount: Number(body.discount || 0),
      discount_pct: Number(body.discountPct || 0),
      discount_label: body.discountLabel || "",
      total: Number(body.total || body.finalTotal || 0),
      cycle_weeks: Number(body.cycleWeeks || 12),
      dose_level: body.doseLevel || "mid",
      monthly_cost: Number(body.monthlyCost || 0),
      timeline: body.timeline || [],
      covered_domains: body.coveredDomains || [],
      notes: body.notes || "",
      source: body.source || "MyBioYouth POS",
      order_number_override: body.orderNumber || ""
    };

    // Netlify function timeout is 10s by default — call async endpoint
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${WINDMILL_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(windmillPayload)
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error("Windmill error:", resp.status, errText);
      return {
        statusCode: 500,
        headers: cors(),
        body: JSON.stringify({
          error: "Order service unavailable. Please try again or email marc@cornerstoneregroup.ca directly.",
          detail: errText.slice(0, 200)
        })
      };
    }

    // Windmill run endpoint returns the job UUID as a plain string
    const jobId = (await resp.text()).replace(/"/g, "").trim();

    return {
      statusCode: 200,
      headers: cors(),
      body: JSON.stringify({
        success: true,
        orderId: body.orderNumber || `ORD-${Date.now().toString().slice(-8)}`,
        jobId,
        async: true,
        message: "Order received. Marc will contact you within 24 hours to confirm and arrange payment."
      })
    };

  } catch (err) {
    console.error("Function error:", err);
    return {
      statusCode: 500,
      headers: cors(),
      body: JSON.stringify({
        error: "Service error. Please contact marc@cornerstoneregroup.ca directly to place your order.",
        detail: err.message
      })
    };
  }
};

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json"
  };
}
