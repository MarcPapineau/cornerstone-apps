// ============================================================
// LUKE — Research Order & Protocol Web App
// Built by Nehemiah for Marc Papineau
// ============================================================
'use strict';

const express = require('express');
const PDFDocument = require('pdfkit');
const path = require('path');
const fetch = require('node-fetch');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Local DB (replaces Airtable) ─────────────────────────────
const { atFetch, atGetAll } = require('./data/localDb');
const TABLES = {
  PRODUCTS:  'tbltxJS3zliUSU1Ce',
  CLIENTS:   'tblxnFPePuNcxdIK2',
  ORDERS:    'tblBUAagSJoIN3ZQ9',
  PROTOCOLS: 'tbly9DuDtpGmKd3yu',
  BLOODWORK: 'tblfex7vkqB0SRFKN'
};

// ── Startup env-var guard ────────────────────────────────────
// Required secrets must be present in production; warn-only in dev.
const REQUIRED_ENV_VARS = ['LUKE_BEARER', 'WINDMILL_TOKEN', 'RESEND_KEY'];
const missingVars = REQUIRED_ENV_VARS.filter(v => !process.env[v]);
if (missingVars.length > 0) {
  const msg = `[Vitalis POS] Missing required env vars: ${missingVars.join(', ')}`;
  if (process.env.NODE_ENV === 'production') {
    console.error(msg);
    process.exit(1);
  } else {
    console.warn(`[WARN] ${msg} — running in dev mode without them`);
  }
}

// ── OpenClaw / Luke AI config ────────────────────────────────
const LUKE_URL    = process.env.LUKE_URL    || 'http://127.0.0.1:18789/v1/chat/completions';
const LUKE_BEARER = process.env.LUKE_BEARER;
const LUKE_MODEL  = process.env.LUKE_MODEL  || 'openclaw';

// ── Middleware ───────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// Cache busting — JS/CSS never cached, images cached 1hr
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.js') || filePath.endsWith('.css')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    } else if (filePath.match(/\.(png|jpg|jpeg|gif|svg|ico|webp)$/)) {
      res.setHeader('Cache-Control', 'public, max-age=3600');
    }
  }
}));


// ── Discount logic ───────────────────────────────────────────
function calcDiscount(total, isVIP = false, vipRate = 0) {
  if (isVIP && vipRate > 0) return { tier: 'VIP', rate: vipRate / 100, label: `VIP (${vipRate}% off)` };
  if (total >= 1500) return { tier: 3, rate: 0.18, label: '18% off (Tier 3)' };
  if (total >= 500)  return { tier: 2, rate: 0.10, label: '10% off (Tier 2)' };
  return { tier: 1, rate: 0, label: 'MSRP (Tier 1)' };
}

// ════════════════════════════════════════════════════════════
// API ROUTES
// ════════════════════════════════════════════════════════════

// ── Dashboard stats ──────────────────────────────────────────
app.get('/api/stats', async (req, res) => {
  try {
    const [orders, protocols, clients] = await Promise.all([
      atGetAll(TABLES.ORDERS),
      atGetAll(TABLES.PROTOCOLS),
      atGetAll(TABLES.CLIENTS)
    ]);
    const recent = orders
      .sort((a, b) => new Date(b.createdTime) - new Date(a.createdTime))
      .slice(0, 8)
      .map(r => ({
        id:     r.id,
        client: r.fields['Client Name'] || r.fields['Client'] || 'Unknown',
        total:  r.fields['Final Total'] || r.fields['Total'] || 0,
        status: r.fields['Status'] || 'Processing',
        date:   r.createdTime
      }));
    res.json({
      totalOrders:     orders.length,
      activeProtocols: protocols.filter(p => p.fields['Status'] !== 'Archived').length,
      totalClients:    clients.length,
      recentOrders:    recent
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Products ─────────────────────────────────────────────────
app.get('/api/products', async (req, res) => {
  try {
    const records = await atGetAll(TABLES.PRODUCTS);
    const products = records.map(r => {
      const msrp = parseFloat(r.fields['MSRP'] || r.fields['Price'] || 0);
      const cost = parseFloat(r.fields['Cost'] || 0);
      const margin = msrp > 0 && cost > 0 ? ((msrp - cost) / msrp * 100).toFixed(1) : null;
      return {
        id:       r.id,
        sku:      r.fields['SKU'] || '',
        name:     r.fields['Product Name'] || r.fields['Name'] || '',
        category: r.fields['Category'] || '',
        msrp,
        cost,
        margin,
        profit:   msrp > 0 && cost > 0 ? parseFloat((msrp - cost).toFixed(2)) : null,
        status:   r.fields['Status'] || 'Active',
        description: (r.fields['Description'] || '').substring(0, 200),
        discountAllowed: margin !== null && parseFloat(margin) > 45,
        maxDiscountPct: parseFloat(margin) > 70 ? 20 : parseFloat(margin) > 55 ? 15 : parseFloat(margin) > 45 ? 10 : 0
      };
    }).filter(p => p.name && p.status !== 'Archived');
    res.json({ products });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Clients ──────────────────────────────────────────────────
app.get('/api/clients', async (req, res) => {
  try {
    const records = await atGetAll(TABLES.CLIENTS);
    const clients = records.map(r => ({
      id:         r.id,
      name:       r.fields['Client Name'] || r.fields['Name'] || '',
      phone:      r.fields['Phone'] || '',
      email:      r.fields['Email'] || '',
      source:     r.fields['Source'] || '',
      notes:      r.fields['Notes'] || '',
      type:       r.fields['Client Type'] || 'Standard',
      isVIP:      (r.fields['Client Type'] || '') === 'VIP',
      vipRate:    0
    })).filter(c => c.name);
    res.json({ clients });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/clients', async (req, res) => {
  try {
    const { name, phone, email, source, notes, clientType, isVIP, vipRate } = req.body;
    const data = await atFetch(TABLES.CLIENTS, 'POST', {
      fields: {
        'Client Name': name,
        'Phone':       phone || '',
        'Source':      source || 'Word of Mouth',
        'Notes':       notes || '',
        'Client Type': clientType || 'Standard'
      }
    });
    res.json({ success: true, id: data.id, ...data.fields });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/clients/:id', async (req, res) => {
  try {
    const [record, orders, protocols] = await Promise.all([
      atFetch(TABLES.CLIENTS, 'GET', null, req.params.id),
      atGetAll(TABLES.ORDERS,    `FIND("${req.params.id}", {Client ID})`),
      atGetAll(TABLES.PROTOCOLS, `FIND("${req.params.id}", {Client ID})`)
    ]);
    res.json({
      client:    { id: record.id, ...record.fields },
      orders:    orders.map(r => ({ id: r.id, ...r.fields })),
      protocols: protocols.map(r => ({ id: r.id, ...r.fields }))
    });
  } catch (e) {
    // Try without formula if fields don't match
    try {
      const record = await atFetch(TABLES.CLIENTS, 'GET', null, req.params.id);
      res.json({ client: { id: record.id, ...record.fields }, orders: [], protocols: [] });
    } catch (e2) {
      res.status(500).json({ error: e2.message });
    }
  }
});

// ── Orders ───────────────────────────────────────────────────
app.get('/api/orders', async (req, res) => {
  try {
    const records = await atGetAll(TABLES.ORDERS);
    const orders = records
      .map(r => ({
        id: r.id,
        createdTime: r.createdTime,
        orderNumber: r.fields['Order Number'] || '',
        clientName: r.fields['Client Name'] || '',
        total: parseFloat(r.fields['Total'] || r.fields['Final Total'] || 0),
        paymentStatus: r.fields['Payment Status'] || 'Pending',
        fulfillmentStatus: r.fields['Fulfillment Status'] || 'Processing',
        date: r.createdTime ? new Date(r.createdTime).toLocaleDateString() : ''
      }))
      .sort((a, b) => new Date(b.createdTime) - new Date(a.createdTime));
    res.json({ orders });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/orders/:id', async (req, res) => {
  try {
    const record = await atFetch(TABLES.ORDERS, 'GET', null, req.params.id);
    res.json({ id: record.id, createdTime: record.createdTime, ...record.fields });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/orders', async (req, res) => {
  try {
    const { clientId, clientName, lines, subtotal, discount, total, discountTier, notes } = req.body;
    const orderNum = 'ORD-' + Date.now().toString().slice(-6);
    const itemsSummary = (lines || []).map(l => `${l.name} x${l.qty} @ $${l.msrp}`).join('\n');
    // Ensure we only write fields that exist in the target Airtable schema.
    // Some tables don't include 'Reorder Trigger Date' or 'Cycle Category' — omit them to avoid write failures.
    const orderFields = {
      'Order Number':    orderNum,
      'Client Name':     clientName || '',
      'Items Summary':   itemsSummary,
      'Subtotal':        parseFloat(subtotal) || 0,
      'Discount Amount': parseFloat(discount) || 0,
      'Total':           parseFloat(total) || 0,
      'Discount Tier':   discountTier || 'Tier 1 - MSRP',
      'Notes':           notes || '',
      'Payment Status':      'Pending',
      'Fulfillment Status':  'Processing',
      // Do not write a Date field by default — createdTime is used for timestamps in Airtable.
    };

    console.log('DEBUG: orderFields ->', JSON.stringify(orderFields));
    const data = await atFetch(TABLES.ORDERS, 'POST', { fields: orderFields });
    res.json({ success: true, id: data.id, orderNumber: orderNum });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.patch('/api/orders/:id', async (req, res) => {
  try {
    const data = await atFetch(TABLES.ORDERS, 'PATCH', { fields: req.body }, req.params.id);
    res.json({ id: data.id, ...data.fields });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── /api/submit-order — localhost proxy matching Netlify function ─
//    Same behaviour as netlify/functions/submit-order.js (see that file).
//    Forwards the full MyBioYouth POS payload to Windmill mybioyouth_order_v1.
const WINDMILL_BASE = process.env.WINDMILL_BASE_URL || 'http://localhost:8000';
const WINDMILL_TOKEN_SRV = process.env.WINDMILL_TOKEN;
const MBY_SCRIPT_PATH = 'u/admin/mybioyouth_order_v1';

app.post('/api/submit-order', async (req, res) => {
  try {
    const body = req.body || {};
    const clientName = body.clientName || body.client?.name || '';
    const clientEmail = body.clientEmail || body.client?.email || '';
    const clientPhone = body.clientPhone || body.client?.phone || '';

    if (!clientName) return res.status(400).json({ error: 'Client name required' });
    if (!Array.isArray(body.lines) || body.lines.length === 0) {
      return res.status(400).json({ error: 'No order lines' });
    }

    const windmillPayload = {
      client_name: clientName,
      client_email: clientEmail,
      client_phone: clientPhone,
      lines: body.lines,
      subtotal: Number(body.subtotal || 0),
      discount: Number(body.discount || 0),
      discount_pct: Number(body.discountPct || 0),
      discount_label: body.discountLabel || '',
      total: Number(body.total || body.finalTotal || 0),
      cycle_weeks: Number(body.cycleWeeks || 12),
      dose_level: body.doseLevel || 'mid',
      monthly_cost: Number(body.monthlyCost || 0),
      timeline: body.timeline || [],
      covered_domains: body.coveredDomains || [],
      notes: body.notes || '',
      source: body.source || 'MyBioYouth POS',
      order_number_override: body.orderNumber || ''
    };

    // Use async run endpoint — returns job_id immediately.
    // The actual email delivery happens in the background via KRITE gate.
    const url = `${WINDMILL_BASE}/api/w/admins/jobs/run/p/${MBY_SCRIPT_PATH}`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${WINDMILL_TOKEN_SRV}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(windmillPayload),
      timeout: 15000
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error('Windmill error:', resp.status, errText);
      return res.status(500).json({
        error: 'Order service unavailable — email marc@cornerstoneregroup.ca',
        detail: errText.slice(0, 200)
      });
    }

    const jobId = (await resp.text()).replace(/"/g, '').trim();
    res.json({
      success: true,
      orderId: body.orderNumber || ('ORD-' + Date.now().toString().slice(-8)),
      jobId,
      async: true,
      message: 'Order received. Marc will contact the client within 24 hours.'
    });
  } catch (e) {
    console.error('submit-order proxy error:', e);
    res.status(500).json({ error: e.message || 'Proxy error' });
  }
});

// ── Protocols ────────────────────────────────────────────────
app.get('/api/protocols', async (req, res) => {
  try {
    const records = await atGetAll(TABLES.PROTOCOLS);
    const protocols = records
      .map(r => ({ id: r.id, createdTime: r.createdTime, ...r.fields }))
      .sort((a, b) => new Date(b.createdTime) - new Date(a.createdTime));
    res.json(protocols);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/protocols', async (req, res) => {
  try {
    const { clientId, clientName, goals, healthFlags, currentStack, budget, timeline, protocolData } = req.body;
    // Write only safe fields that exist in the current Airtable schema for protocols.
    const protocolFields = {
      'Goals':         Array.isArray(goals) ? goals.join(', ') : goals || '',
      'Health Flags':  healthFlags || '',
      'Current Stack': currentStack || '',
      'Budget Range':  budget || '',
      'Timeline':      timeline || '',
      'Protocol JSON': JSON.stringify(protocolData),
      'Status':        'Active'
    };
    const data = await atFetch(TABLES.PROTOCOLS, 'POST', { fields: protocolFields });
    res.json({ id: data.id, ...data.fields });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Luke AI ──────────────────────────────────────────────────
app.post('/api/generate-protocol', async (req, res) => {
  try {
    const { clientName, goals, healthFlags, currentStack, budget, timeline } = req.body;

    const userMessage = `
Research Protocol Request:
- Client: ${clientName || 'Anonymous'}
- Goals: ${Array.isArray(goals) ? goals.join(', ') : goals}
- Health Flags / Notes: ${healthFlags || 'None provided'}
- Current Stack: ${currentStack || 'None'}
- Budget Range: ${budget || 'Not specified'}
- Timeline: ${timeline || '12 weeks'}

Please recommend a research compound stack and return the JSON object as specified.
Return ONLY valid JSON, no markdown, no extra text.
    `.trim();

    const response = await fetch(LUKE_URL, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        Authorization:   `Bearer ${LUKE_BEARER}`
      },
      body: JSON.stringify({
        model: LUKE_MODEL,
        messages: [
          {
            role: 'system',
            content: `You are LUKE, a research protocol assistant for a peptide research company.
All outputs are FOR RESEARCH PURPOSES ONLY. Not intended for human use. Not medical advice.

Based on the research goals and parameters provided, recommend a compound stack.

Return a JSON object with:
{
  "recommended_compounds": [
    {
      "name": "compound name",
      "sku_search": "partial SKU to match in database",
      "dose_mg": "dose in mg",
      "frequency": "daily/weekly/etc",
      "timing": "morning/evening/etc",
      "duration": "X weeks",
      "rationale": "why this compound for these goals"
    }
  ],
  "cycle_length": "X weeks",
  "bloodwork_schedule": ["Week 0 baseline", "Week 6 check", "Week 12 final"],
  "stack_synergies": "How these compounds work together",
  "research_notes": "Key research points",
  "disclaimer": "For research purposes only. Not intended for human use. Not medical advice."
}

Return ONLY valid JSON with no markdown formatting, no code blocks, no extra text.`
          },
          { role: 'user', content: userMessage }
        ],
        max_tokens: 2000
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Luke AI error ${response.status}: ${errText}`);
    }

    const data    = await response.json();
    const content = data.choices?.[0]?.message?.content || '';

    // Strip possible markdown code fences
    const cleaned = content.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    let protocol;
    try {
      protocol = JSON.parse(cleaned);
    } catch {
      // Try to extract JSON from response
      const match = cleaned.match(/\{[\s\S]+\}/);
      if (match) {
        protocol = JSON.parse(match[0]);
      } else {
        throw new Error('Luke returned non-JSON response: ' + content.slice(0, 200));
      }
    }

    res.json(protocol);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Discount calculator ──────────────────────────────────────
app.post('/api/discount', (req, res) => {
  const { total, isVIP, vipRate } = req.body;
  res.json(calcDiscount(parseFloat(total) || 0, isVIP, parseFloat(vipRate) || 0));
});

// ════════════════════════════════════════════════════════════
// PDF GENERATION
// ════════════════════════════════════════════════════════════

// ── Colour palette ───────────────────────────────────────────
const NAVY   = '#0D1B2A';
const GOLD   = '#C9A84C';
const LIGHT  = '#E8EAF0';
const MUTED  = '#8899AA';
const WHITE  = '#FFFFFF';
const DARK2  = '#1A2840';
const ACCENT = '#2A3F5F';


function pdfHeader(doc, title) {
  // Background bar
  doc.rect(0, 0, doc.page.width, 80).fill(NAVY);
  doc.rect(0, 80, doc.page.width, 4).fill(GOLD);
  doc.fillColor(GOLD).fontSize(22).font('Helvetica-Bold')
     .text('MARC PAPINEAU', 40, 20, { lineBreak: false });
  doc.fillColor(LIGHT).fontSize(10).font('Helvetica')
     .text('Research Operations  |  613-884-8960', 40, 46, { lineBreak: false });
  doc.fillColor(WHITE).fontSize(14).font('Helvetica-Bold')
     .text(title, doc.page.width - 260, 28, { width: 220, align: 'right', lineBreak: false });
  doc.y = 90;
}

function pdfFooter(doc, pageNum, totalPages, disclaimer = false) {
  // Temporarily zero the bottom margin so PDFKit does not auto-paginate while
  // we render content inside the footer zone, then restore it afterward.
  const savedBottomMargin = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;

  // Use lineBreak:false to prevent PDFKit from auto-paginating inside the footer margin zone
  const y = doc.page.height - 60;
  doc.rect(0, y - 8, doc.page.width, 1).fill(GOLD);
  if (disclaimer) {
    doc.fillColor(MUTED).fontSize(7).font('Helvetica')
       .text(
         'FOR RESEARCH PURPOSES ONLY. Not intended for human use. Not medical advice. ' +
         'This document is provided for scientific research only.',
         40, y, { width: doc.page.width - 80, align: 'center', lineBreak: false }
       );
  } else {
    doc.fillColor(MUTED).fontSize(8).font('Helvetica')
       .text('Thank you for your research order.', 40, y, { align: 'center', width: doc.page.width - 80, lineBreak: false });
  }
  doc.fillColor(MUTED).fontSize(7)
     .text(`Page ${pageNum} of ${totalPages}`, 40, y + 14, { align: 'center', width: doc.page.width - 80, lineBreak: false });

  doc.page.margins.bottom = savedBottomMargin;
}

// ── Premium Invoice / Order PDF ──────────────────────────────
// Rebuilt 2026-04-17 — MyBioYouth brand, line-item table with dose/weeks/discount,
// protocol supply timeline, monthly cost summary.
app.post('/api/pdf/order', (req, res) => {
  try {
    const {
      orderNumber, clientName, client, items, lines,
      subtotal, discount, discountRate, discountPct, discountLabel,
      total, finalTotal, notes, date,
      cycleWeeks, doseLevel, timeline, monthlyCost
    } = req.body;

    // Resolve client name from either string or object
    const resolvedClientName = clientName
      || (typeof client === 'string' ? client : client?.name)
      || 'Research Client';
    const clientEmail = client?.email || '';
    const clientPhone = client?.phone || '';

    // Resolve line items — support both { items: [...] } and { lines: [...] }
    const rawItems = items || lines || [];
    const parsedItems = typeof rawItems === 'string' ? JSON.parse(rawItems) : rawItems;

    const sub = parseFloat(subtotal || 0);
    const disc = discount !== undefined
      ? parseFloat(discount || 0)
      : (discountRate ? sub * parseFloat(discountRate) : 0);
    const final = parseFloat(finalTotal !== undefined ? finalTotal : (total !== undefined ? total : sub - disc));
    const discPct = discountPct !== undefined
      ? parseFloat(discountPct)
      : (sub > 0 ? (disc / sub) * 100 : 0);

    const dateStr = date
      ? new Date(date).toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' })
      : new Date().toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });

    const invoiceNum = orderNumber || ('INV-' + Date.now().toString().slice(-8));

    const doc = new PDFDocument({
      size: 'LETTER',
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      compress: false,
      bufferPages: true,
      info: {
        Title: `MyBioYouth Invoice ${invoiceNum}`,
        Author: 'MyBioYouth',
        Subject: 'Research Order Invoice'
      }
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="mybioyouth-invoice-${invoiceNum}.pdf"`);
    doc.pipe(res);

    const PW = doc.page.width;
    const PH = doc.page.height;
    const MARGIN = 40;

    // ─── BRANDED HEADER ──────────────────────────────────────
    function invoiceHeader(pageTitle) {
      // Navy block
      doc.rect(0, 0, PW, 92).fill(NAVY);
      // Gold accent strip
      doc.rect(0, 92, PW, 4).fill(GOLD);
      // Brand mark
      doc.fillColor(GOLD).fontSize(22).font('Helvetica-Bold')
         .text('MYBIOYOUTH', MARGIN, 22, { lineBreak: false, characterSpacing: 3 });
      doc.fillColor(LIGHT).fontSize(9).font('Helvetica')
         .text('Cornerstone RE Health  |  Peptide Research Operations', MARGIN, 50, { lineBreak: false });
      doc.fillColor(MUTED).fontSize(8).font('Helvetica')
         .text('marc@cornerstoneregroup.ca  |  613-884-8960', MARGIN, 66, { lineBreak: false });
      // Page title right
      doc.fillColor(WHITE).fontSize(14).font('Helvetica-Bold')
         .text(pageTitle, PW - 260, 32, { width: 220, align: 'right', lineBreak: false });
      doc.fillColor(GOLD).fontSize(9).font('Helvetica')
         .text(invoiceNum, PW - 260, 54, { width: 220, align: 'right', lineBreak: false });
    }

    function invoiceFooter(pageNum, totalPages) {
      const fy = PH - 58;
      // Gold hairline
      doc.rect(MARGIN, fy, PW - MARGIN * 2, 1).fill(GOLD);
      // Footer text
      doc.fillColor(NAVY).fontSize(8).font('Helvetica-Bold')
         .text('Cornerstone RE Health', MARGIN, fy + 10, { lineBreak: false });
      doc.fillColor(MUTED).fontSize(7).font('Helvetica')
         .text('marc@cornerstoneregroup.ca  |  mybioyouth.com  |  FOR RESEARCH PURPOSES ONLY — Not intended for human use, not medical advice.',
               MARGIN, fy + 22, { width: PW - MARGIN * 2, lineBreak: false });
      doc.fillColor(MUTED).fontSize(7)
         .text('Page ' + pageNum + ' of ' + totalPages, MARGIN, fy + 36, { width: PW - MARGIN * 2, align: 'center', lineBreak: false });
    }

    // ─── PAGE 1 ──────────────────────────────────────────────
    invoiceHeader('INVOICE');
    let y = 112;

    // Bill-to / invoice meta card
    const cardH = 82;
    doc.rect(MARGIN, y, PW - MARGIN * 2, cardH).fill(LIGHT);
    doc.rect(MARGIN, y, 4, cardH).fill(GOLD);

    // Left: bill-to
    doc.fillColor(MUTED).fontSize(8).font('Helvetica-Bold').text('BILL TO', MARGIN + 14, y + 10, { characterSpacing: 1.2 });
    doc.fillColor(NAVY).fontSize(14).font('Helvetica-Bold').text(resolvedClientName, MARGIN + 14, y + 24);
    if (clientEmail) doc.fillColor(MUTED).fontSize(9).font('Helvetica').text(clientEmail, MARGIN + 14, y + 44);
    if (clientPhone) doc.fillColor(MUTED).fontSize(9).font('Helvetica').text(clientPhone, MARGIN + 14, y + 58);

    // Right: invoice details
    const metaX = PW - 220;
    doc.fillColor(MUTED).fontSize(8).font('Helvetica-Bold').text('INVOICE DATE', metaX, y + 10, { width: 180, align: 'right', characterSpacing: 1.2 });
    doc.fillColor(NAVY).fontSize(11).font('Helvetica').text(dateStr, metaX, y + 24, { width: 180, align: 'right' });
    doc.fillColor(MUTED).fontSize(8).font('Helvetica-Bold').text('INVOICE #', metaX, y + 44, { width: 180, align: 'right', characterSpacing: 1.2 });
    doc.fillColor(GOLD).fontSize(11).font('Helvetica-Bold').text(invoiceNum, metaX, y + 58, { width: 180, align: 'right' });

    y += cardH + 16;

    // ─── LINE ITEMS TABLE ────────────────────────────────────
    // Headers: Compound / Dose / Weeks / Unit Price / Qty / Disc% / Line Total
    const col = {
      name:    { x: MARGIN, w: 170, align: 'left' },
      dose:    { x: MARGIN + 170, w: 70, align: 'left' },
      weeks:   { x: MARGIN + 240, w: 48, align: 'center' },
      unit:    { x: MARGIN + 288, w: 60, align: 'right' },
      qty:     { x: MARGIN + 348, w: 30, align: 'center' },
      disc:    { x: MARGIN + 378, w: 40, align: 'right' },
      line:    { x: MARGIN + 418, w: PW - MARGIN - MARGIN - 418, align: 'right' }
    };

    // Header bar
    doc.rect(MARGIN, y, PW - MARGIN * 2, 28).fill(NAVY);
    doc.fillColor(GOLD).fontSize(8).font('Helvetica-Bold');
    doc.text('COMPOUND',    col.name.x + 8, y + 10, { width: col.name.w - 8, align: col.name.align, characterSpacing: 1 });
    doc.text('DOSE',        col.dose.x, y + 10, { width: col.dose.w, align: col.dose.align, characterSpacing: 1 });
    doc.text('SUPPLY',      col.weeks.x, y + 10, { width: col.weeks.w, align: col.weeks.align, characterSpacing: 1 });
    doc.text('UNIT $',      col.unit.x, y + 10, { width: col.unit.w, align: col.unit.align, characterSpacing: 1 });
    doc.text('QTY',         col.qty.x, y + 10, { width: col.qty.w, align: col.qty.align, characterSpacing: 1 });
    doc.text('DISC',        col.disc.x, y + 10, { width: col.disc.w, align: col.disc.align, characterSpacing: 1 });
    doc.text('TOTAL',       col.line.x, y + 10, { width: col.line.w - 8, align: col.line.align, characterSpacing: 1 });
    y += 28;

    // Build a lookup from timeline by name for supply info
    const tMap = {};
    (timeline || []).forEach(t => { if (t && t.name) tMap[t.name] = t; });

    parsedItems.forEach((item, i) => {
      const rowBg = i % 2 === 0 ? '#F5F7FA' : WHITE;
      doc.rect(MARGIN, y, PW - MARGIN * 2, 30).fill(rowBg);

      const itemName = item.name || item.productName || '—';
      const itemQty = parseInt(item.qty || item.quantity || 1);
      const itemUnit = parseFloat(item.unitPrice || item.msrp || 0);
      const itemDisc = parseFloat(item.discountPct || 0);
      const itemLine = parseFloat(item.lineTotal || (itemUnit * itemQty * (1 - itemDisc/100)));

      // Dose from item.doseLevel or smart-order
      const tline = tMap[itemName];
      const doseText = (item.dose || item.doseLevel || tline?.doseNote || '—').toString();
      // Weeks supply
      const weeksText = tline?.totalWeeks
        ? `${tline.totalWeeks}w`
        : (tline?.perVial ? `~${tline.perVial}w` : '—');

      doc.fillColor(NAVY).fontSize(10).font('Helvetica-Bold')
         .text(itemName, col.name.x + 8, y + 9, { width: col.name.w - 8, lineBreak: false, ellipsis: true });
      // SKU subtitle
      if (item.sku) {
        doc.fillColor(MUTED).fontSize(7).font('Helvetica')
           .text(item.sku, col.name.x + 8, y + 20, { width: col.name.w - 8, lineBreak: false });
      }
      doc.fillColor(MUTED).fontSize(9).font('Helvetica')
         .text(doseText.length > 14 ? doseText.slice(0, 13) + '…' : doseText, col.dose.x, y + 11, { width: col.dose.w, align: col.dose.align, lineBreak: false });
      doc.fillColor(NAVY).fontSize(9).font('Helvetica')
         .text(weeksText, col.weeks.x, y + 11, { width: col.weeks.w, align: col.weeks.align, lineBreak: false });
      doc.fillColor(NAVY).fontSize(9).font('Helvetica')
         .text('$' + itemUnit.toFixed(2), col.unit.x, y + 11, { width: col.unit.w, align: col.unit.align, lineBreak: false });
      doc.fillColor(NAVY).fontSize(10).font('Helvetica-Bold')
         .text(String(itemQty), col.qty.x, y + 11, { width: col.qty.w, align: col.qty.align, lineBreak: false });
      doc.fillColor(itemDisc > 0 ? GOLD : MUTED).fontSize(9).font('Helvetica')
         .text(itemDisc > 0 ? itemDisc + '%' : '—', col.disc.x, y + 11, { width: col.disc.w, align: col.disc.align, lineBreak: false });
      doc.fillColor(NAVY).fontSize(10).font('Helvetica-Bold')
         .text('$' + itemLine.toFixed(2), col.line.x, y + 11, { width: col.line.w - 8, align: col.line.align, lineBreak: false });

      y += 30;
      if (y > PH - 260) {
        doc.addPage();
        invoiceHeader('INVOICE (continued)');
        y = 112;
      }
    });

    // ─── PROTOCOL SUPPLY TIMELINE (visual bars) ──────────────
    if (Array.isArray(timeline) && timeline.length > 0 && cycleWeeks) {
      y += 16;
      if (y > PH - 220) { doc.addPage(); invoiceHeader('INVOICE'); y = 112; }

      // Section bar
      doc.rect(MARGIN, y, PW - MARGIN * 2, 22).fill(DARK2);
      doc.fillColor(GOLD).fontSize(9).font('Helvetica-Bold')
         .text('PROTOCOL SUPPLY TIMELINE', MARGIN + 10, y + 7, { characterSpacing: 1.2 });
      doc.fillColor(LIGHT).fontSize(8).font('Helvetica')
         .text(`${cycleWeeks}-week cycle  |  ${(doseLevel || 'mid').toUpperCase()} dose`,
               PW - 200, y + 8, { width: 160, align: 'right' });
      y += 28;

      // Compute max-weeks for scaling
      const maxWks = Math.max(cycleWeeks, ...timeline.filter(t => t.totalWeeks).map(t => t.totalWeeks), 1);
      const barTrackX = MARGIN + 140;
      const barTrackW = PW - MARGIN - barTrackX - 10;

      timeline.forEach(t => {
        if (y > PH - 180) return;
        const name = (t.name || '').length > 22 ? (t.name || '').slice(0, 20) + '…' : (t.name || '');
        doc.fillColor(NAVY).fontSize(9).font('Helvetica-Bold')
           .text(name, MARGIN, y + 4, { width: 130, lineBreak: false });

        // Track
        doc.rect(barTrackX, y + 3, barTrackW, 14).fill('#ECEEF3');

        if (t.totalWeeks != null && !t.isManual) {
          const activeWks = Math.min(cycleWeeks, t.totalWeeks);
          const activeW = Math.max(2, Math.round((activeWks / maxWks) * barTrackW));
          const leftoverWks = Math.max(0, t.totalWeeks - cycleWeeks);
          const leftoverW = Math.round((leftoverWks / maxWks) * barTrackW);

          doc.rect(barTrackX, y + 3, activeW, 14).fill(GOLD);
          if (leftoverW > 2) {
            doc.rect(barTrackX + activeW, y + 3, leftoverW, 14).fill(ACCENT);
          }
          // Label on bar
          doc.fillColor(NAVY).fontSize(8).font('Helvetica-Bold')
             .text(`${activeWks}w`, barTrackX + 4, y + 6, { width: Math.max(16, activeW - 6), lineBreak: false });
        } else {
          // Manual row
          doc.rect(barTrackX, y + 3, 6, 14).fill(MUTED);
          doc.fillColor(MUTED).fontSize(8).font('Helvetica')
             .text(t.doseNote || 'Manual qty', barTrackX + 10, y + 6, { width: barTrackW - 16, lineBreak: false });
        }

        // Monthly price label
        if (t.monthlyPrice) {
          doc.fillColor(MUTED).fontSize(8).font('Helvetica')
             .text('~$' + t.monthlyPrice + '/mo', PW - MARGIN - 66, y + 5, { width: 60, align: 'right', lineBreak: false });
        }
        y += 20;
      });

      // Tick axis
      y += 2;
      doc.fillColor(MUTED).fontSize(7).font('Helvetica')
         .text('0w', barTrackX, y, { lineBreak: false });
      doc.fillColor(MUTED).fontSize(7).font('Helvetica')
         .text(`${Math.round(maxWks/2)}w`, barTrackX + barTrackW/2 - 10, y, { lineBreak: false });
      doc.fillColor(MUTED).fontSize(7).font('Helvetica')
         .text(`${Math.round(maxWks)}w`, barTrackX + barTrackW - 18, y, { lineBreak: false });
      y += 14;
    }

    // ─── TOTALS BOX ──────────────────────────────────────────
    if (y > PH - 200) { doc.addPage(); invoiceHeader('INVOICE'); y = 112; }
    y += 10;

    const tboxX = PW - 280;
    const tboxW = 240;
    const tboxH = disc > 0 ? 120 : 96;
    doc.rect(tboxX, y, tboxW, tboxH).fill(NAVY);
    doc.rect(tboxX, y, 4, tboxH).fill(GOLD);

    let tboxY = y + 12;
    doc.fillColor(LIGHT).fontSize(9).font('Helvetica').text('Subtotal', tboxX + 16, tboxY, { width: 100 });
    doc.fillColor(WHITE).fontSize(10).font('Helvetica').text('$' + sub.toFixed(2), tboxX + 120, tboxY, { width: 110, align: 'right' });
    tboxY += 20;

    if (disc > 0) {
      doc.fillColor(LIGHT).fontSize(9).font('Helvetica').text(`Discount${discountLabel ? ' (' + discountLabel + ')' : (discPct ? ' (' + discPct.toFixed(0) + '%)' : '')}`, tboxX + 16, tboxY, { width: 140 });
      doc.fillColor(GOLD).fontSize(10).font('Helvetica').text('-$' + disc.toFixed(2), tboxX + 120, tboxY, { width: 110, align: 'right' });
      tboxY += 20;
    }

    // Gold separator
    doc.rect(tboxX + 16, tboxY + 2, tboxW - 32, 1).fill(GOLD);
    tboxY += 10;

    doc.fillColor(GOLD).fontSize(11).font('Helvetica-Bold').text('TOTAL', tboxX + 16, tboxY + 4, { width: 100 });
    doc.fillColor(GOLD).fontSize(16).font('Helvetica-Bold').text('$' + final.toFixed(2), tboxX + 120, tboxY, { width: 110, align: 'right' });

    // Secondary meta: monthly cost / cycle
    if (monthlyCost && cycleWeeks) {
      const metaY2 = y + tboxH + 10;
      doc.fillColor(MUTED).fontSize(8).font('Helvetica-Bold')
         .text(`PROTOCOL: ${cycleWeeks} WEEKS  |  EST. ~$${Math.round(monthlyCost).toLocaleString()}/MONTH`,
               tboxX, metaY2, { width: tboxW, align: 'right', characterSpacing: 1 });
    }

    y += tboxH + 30;

    // ─── NOTES ───────────────────────────────────────────────
    if (notes) {
      if (y > PH - 140) { doc.addPage(); invoiceHeader('INVOICE'); y = 112; }
      doc.rect(MARGIN, y, PW - MARGIN * 2, 4).fill(GOLD);
      y += 10;
      doc.fillColor(NAVY).fontSize(9).font('Helvetica-Bold').text('NOTES', MARGIN, y, { characterSpacing: 1.2 });
      y += 14;
      doc.fillColor(MUTED).fontSize(9).font('Helvetica')
         .text(notes, MARGIN, y, { width: PW - MARGIN * 2, lineGap: 2 });
    }

    // ─── PAYMENT INSTRUCTIONS ────────────────────────────────
    const payY = PH - 150;
    doc.rect(MARGIN, payY, PW - MARGIN * 2, 60).fill(LIGHT);
    doc.rect(MARGIN, payY, 4, 60).fill(GOLD);
    doc.fillColor(NAVY).fontSize(9).font('Helvetica-Bold').text('PAYMENT', MARGIN + 14, payY + 10, { characterSpacing: 1.2 });
    doc.fillColor(MUTED).fontSize(9).font('Helvetica')
       .text('Marc will contact you directly to confirm your order and arrange payment. Interac e-Transfer preferred: marc@cornerstoneregroup.ca',
             MARGIN + 14, payY + 26, { width: PW - MARGIN * 2 - 28, lineGap: 2 });

    // Finalise footer on last page (may span 2 pages)
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      invoiceFooter(i + 1, range.count);
    }

    doc.end();
  } catch (e) {
    console.error('Invoice PDF error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ── Protocol PDF ─────────────────────────────────────────────
// Rebuilt March 25 2026 — per-compound structure, no Helvetica oblique
app.post('/api/pdf/protocol', (req, res) => {
  try {
    const {
      clientName, client, stackGoal, tierLabel, dosingLevel,
      cycleWeeks: bodyCycleWeeks, compounds: bodyCompounds,
      schedulingNotes, dosing: bodyDosing, supplyList: bodySupply, date,
      protocol: aiProtocol, goals
    } = req.body;

    // Resolve client name — handle string, object {name,phone}, or fallback
    const resolvedClientName = clientName
      || (typeof client === 'string' ? client : client?.name)
      || 'Research Client';

    // Resolve compounds — handle 3 call formats:
    // 1. Stack builder: compounds: [{name, dose, frequency, duration}]
    // 2. Protocol tab: protocol: { recommended_compounds: [{name, dose_mg, frequency}] }
    // 3. Legacy: compounds as string array
    let normalizedCompounds = bodyCompounds;
    if (!normalizedCompounds && aiProtocol?.recommended_compounds) {
      normalizedCompounds = aiProtocol.recommended_compounds.map(c => ({
        name: c.name,
        dose: c.dose_mg ? `${c.dose_mg}mg` : '',
        frequency: c.frequency || '',
        duration: c.duration || `${bodyCycleWeeks || 12} weeks`,
        rationale: c.rationale || ''
      }));
    }
    const dateStr = date
      ? new Date(date).toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' })
      : new Date().toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });
    // Parse cycle length from AI protocol if not explicitly provided
    const aiCycleWeeks = aiProtocol?.cycle_length
      ? parseInt(aiProtocol.cycle_length) || 12
      : null;
    const cycleLen = bodyCycleWeeks || aiCycleWeeks || 12;
    const dosingObj = bodyDosing || {};

    // Resolve goal/title — use AI protocol context if from Protocol tab
    const resolvedGoal = stackGoal
      || (goals && Array.isArray(goals) ? goals.join(' + ') : null)
      || 'Research Protocol';
    const resolvedSchedulingNotes = schedulingNotes
      || aiProtocol?.bloodwork_schedule
      || [];

    // Normalize compound list — can be strings (names) or objects ({name,...})
    const rawCompounds = Array.isArray(normalizedCompounds) ? normalizedCompounds : [];
    // Expand KLOW bundles to individual compounds for per-compound pages
    const compoundSections = [];
    const allCompoundNames = [];
    rawCompounds.forEach(c => {
      const name = typeof c === 'string' ? c : (c.name || '');
      if (name.startsWith('KLOW') || ['KPV','BPC-157','GHK-Cu','TB-500'].every(k => rawCompounds.map(x => typeof x === 'string' ? x : x.name).includes(k))) {
        if (name === 'KLOW' || name.startsWith('KLOW')) {
          ['KPV','BPC-157','GHK-Cu','TB-500'].forEach(k => {
            if (!compoundSections.find(s => s.name === k)) {
              compoundSections.push({ name: k, dose: dosingObj[k] || '' });
              allCompoundNames.push(k);
            }
          });
          return;
        }
      }
      if (!compoundSections.find(s => s.name === name)) {
        compoundSections.push({ name, dose: dosingObj[name] || (typeof c === 'object' ? (c.dose || c.dose_mg || '') : '') });
        allCompoundNames.push(name);
      }
    });

    function getPricingForCompound(name) {
      const pr = COMPOUND_PRICING[name];
      if (!pr || !pr.msrp) return null;
      const mult = { low: 0.6, mid: 0.8, high: 1.0 }[dosingLevel] || 0.8;
      const wpu = (pr.weeksSupply || 4) / mult;
      const units = Math.ceil(cycleLen / wpu);
      const monthlyCost = Math.round(pr.msrp / (wpu / 4.33));
      return { pricePerUnit: pr.msrp, unit: pr.unit || 'vial', units, wpu: Math.round(wpu), totalCost: Math.round(units * pr.msrp), monthlyCost };
    }

    // totalPages = 1 cover + 1 dosing guide + N compound pages + 1 quick ref
    const totalPDFPages = compoundSections.length + 3;

    const doc = new PDFDocument({
      size: 'LETTER',
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      compress: false
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="research-protocol.pdf"');
    doc.pipe(res);

    // Helper: section label bar (gold text on navy)
    function sectionBar(doc, label, y) {
      doc.rect(40, y, doc.page.width - 80, 22).fill(NAVY);
      doc.fillColor(GOLD).fontSize(8.5).font('Helvetica-Bold').text(label, 52, y + 7);
      return y + 26;
    }
    // Helper: section label bar dark variant
    function sectionBarDark(doc, label, y) {
      doc.rect(40, y, doc.page.width - 80, 22).fill(DARK2);
      doc.fillColor(GOLD).fontSize(8.5).font('Helvetica-Bold').text(label, 52, y + 7);
      return y + 26;
    }
    // Helper: attachment label top-right of compound header
    function attachmentTag(doc, attNum, total, y) {
      doc.fillColor(GOLD).fontSize(8).font('Helvetica-Bold')
         .text('ATTACHMENT ' + attNum + ' OF ' + total, doc.page.width - 160, y, { width: 120, align: 'right' });
    }

    // ── PAGE 1: COVER ──────────────────────────────────────
    pdfHeader(doc, 'Research Protocol');
    let y = 110;

    // Title block
    doc.rect(40, y, doc.page.width - 80, 54).fill(NAVY);
    doc.fillColor(GOLD).fontSize(22).font('Helvetica-Bold')
       .text(resolvedGoal, 52, y + 10, { width: doc.page.width - 104 });
    doc.fillColor(LIGHT).fontSize(10).font('Helvetica')
       .text([(tierLabel || ''), (dosingLevel ? dosingLevel.toUpperCase() + ' DOSE' : ''), (cycleLen + '-Week Cycle')].filter(Boolean).join('   |   '), 52, y + 36, { width: doc.page.width - 104 });
    y += 66;

    // Client + date banner
    doc.rect(40, y, doc.page.width - 80, 34).fill(LIGHT);
    doc.fillColor(NAVY).fontSize(11).font('Helvetica-Bold')
       .text('Prepared for: ' + resolvedClientName, 52, y + 11);
    doc.fillColor(MUTED).fontSize(10).font('Helvetica')
       .text(dateStr, doc.page.width - 180, y + 13, { align: 'right', width: 130 });
    y += 46;

    // What's included label
    y = sectionBar(doc, 'WHAT IS INCLUDED IN THIS PROTOCOL PACKAGE', y);

    // Compound list — no emoji, clean text rows
    compoundSections.forEach((sec, i) => {
      if (y + 22 > doc.page.height - 130) { doc.addPage(); pdfHeader(doc, 'Research Protocol'); y = 110; }
      const info = COMPOUND_INFO[sec.name] || {};
      const bg = i % 2 === 0 ? '#EEF1F7' : WHITE;
      doc.rect(40, y, doc.page.width - 80, 24).fill(bg);
      // Attachment number badge
      doc.rect(40, y, 32, 24).fill(GOLD);
      doc.fillColor(NAVY).fontSize(9).font('Helvetica-Bold')
         .text('A' + (i + 2), 40, y + 7, { width: 32, align: 'center' });
      doc.fillColor(NAVY).fontSize(10).font('Helvetica-Bold')
         .text(sec.name, 80, y + 7, { width: 180 });
      doc.fillColor(MUTED).fontSize(9).font('Helvetica')
         .text(info.tagline || '', 268, y + 8, { width: doc.page.width - 316 });
      y += 24;
    });

    // Attachment 1 = Dosing Guide row
    y += 6;
    if (y + 24 > doc.page.height - 130) { doc.addPage(); pdfHeader(doc, 'Research Protocol'); y = 110; }
    doc.rect(40, y, doc.page.width - 80, 24).fill('#EEF1F7');
    doc.rect(40, y, 32, 24).fill(GOLD);
    doc.fillColor(NAVY).fontSize(9).font('Helvetica-Bold').text('A1', 40, y + 7, { width: 32, align: 'center' });
    doc.fillColor(NAVY).fontSize(10).font('Helvetica-Bold').text('Dosing & Administration Guide', 80, y + 7, { width: 260 });
    doc.fillColor(MUTED).fontSize(9).font('Helvetica').text('BAC water, syringe guide, storage rules, key warnings', 348, y + 8, { width: doc.page.width - 396 });
    y += 32;

    // Scheduling / bloodwork notes
    if (Array.isArray(resolvedSchedulingNotes) && resolvedSchedulingNotes.length > 0) {
      if (y + 40 > doc.page.height - 130) { doc.addPage(); pdfHeader(doc, 'Research Protocol'); y = 110; }
      y = sectionBar(doc, aiProtocol?.bloodwork_schedule ? 'BLOODWORK SCHEDULE' : 'SCHEDULING NOTES', y);
      resolvedSchedulingNotes.forEach(note => {
        if (y + 18 > doc.page.height - 130) { doc.addPage(); pdfHeader(doc, 'Research Protocol'); y = 110; }
        doc.fillColor(NAVY).fontSize(9.5).font('Helvetica').text('\u2022  ' + note, 52, y, { width: doc.page.width - 92 });
        y = doc.y + 5;
      });
      y += 6;
    }

    // Stack synergies from AI protocol
    if (aiProtocol?.stack_synergies) {
      if (y + 50 > doc.page.height - 130) { doc.addPage(); pdfHeader(doc, 'Research Protocol'); y = 110; }
      y = sectionBarDark(doc, 'STACK SYNERGIES', y);
      doc.fillColor(NAVY).fontSize(9.5).font('Helvetica')
         .text(aiProtocol.stack_synergies, 52, y, { width: doc.page.width - 92, lineGap: 2 });
      y = doc.y + 10;
    }

    // Cover disclaimer box
    const cvDiscY = doc.page.height - 128;
    doc.rect(40, cvDiscY, doc.page.width - 80, 48).fill(LIGHT);
    doc.rect(40, cvDiscY, 4, 48).fill(MUTED);
    doc.fillColor(MUTED).fontSize(7.5).font('Helvetica-Bold').text('RESEARCH DISCLAIMER', 52, cvDiscY + 8);
    doc.fillColor(MUTED).fontSize(7.5).font('Helvetica')
       .text('All compounds listed are for research purposes only. Not intended for human use. Not medical advice. Consult a qualified physician before use.', 52, cvDiscY + 22, { width: doc.page.width - 104, lineGap: 2 });
    pdfFooter(doc, 1, totalPDFPages, true);

    // ── PAGE 2: ATTACHMENT 1 — DOSING & ADMINISTRATION GUIDE ──
    doc.addPage();
    pdfHeader(doc, 'Attachment 1 — Dosing Guide');
    let dy = 110;

    // Attachment header bar
    doc.rect(40, dy, doc.page.width - 80, 40).fill(NAVY);
    doc.fillColor(GOLD).fontSize(16).font('Helvetica-Bold')
       .text('DOSING & ADMINISTRATION GUIDE', 52, dy + 10, { width: doc.page.width - 104 });
    doc.fillColor(LIGHT).fontSize(9).font('Helvetica')
       .text('Attachment 1  |  Keep for reference throughout your protocol', 52, dy + 30);
    dy += 52;

    // BAC Water Reconstitution
    dy = sectionBar(doc, 'STANDARD RECONSTITUTION — EVERY PEPTIDE', dy);
    const reconSteps = [
      'Gather: peptide vial, BAC water vial, 3mL syringe (for BAC water), insulin syringe (for dosing), alcohol swabs.',
      'Swab the top of both vials with an alcohol swab. Let dry 10 seconds.',
      'Draw the specified amount of BAC water into the 3mL syringe.',
      'Insert the needle into the peptide vial at an angle. Let the water run down the inside wall — do not spray directly onto the powder.',
      'Swirl the vial GENTLY. Never shake. Shaking breaks the peptide chains.',
      'Let sit 2-3 minutes until fully dissolved. Label the vial with the date and concentration.'
    ];
    reconSteps.forEach((step, i) => {
      if (dy + 28 > doc.page.height - 130) { doc.addPage(); pdfHeader(doc, 'Attachment 1 — Dosing Guide'); dy = 110; }
      doc.rect(40, dy, 26, 22).fill(GOLD);
      doc.fillColor(NAVY).fontSize(10).font('Helvetica-Bold').text(String(i + 1), 40, dy + 6, { width: 26, align: 'center' });
      doc.fillColor(NAVY).fontSize(9.5).font('Helvetica').text(step, 72, dy + 5, { width: doc.page.width - 116, lineGap: 1 });
      dy = doc.y + 6;
    });
    dy += 8;

    // Syringe Reference Table
    if (dy + 100 > doc.page.height - 130) { doc.addPage(); pdfHeader(doc, 'Attachment 1 — Dosing Guide'); dy = 110; }
    dy = sectionBarDark(doc, 'INSULIN SYRINGE REFERENCE — U-100 (Most common)', dy);
    const tCols = [40, 155, 290, 420];
    const tWids = [110, 130, 125, doc.page.width - 460];
    const tHdrs = ['VOLUME (mL)', 'SYRINGE UNITS', 'COMMON USE', 'EXAMPLE DOSE'];
    doc.rect(40, dy, doc.page.width - 80, 20).fill(ACCENT);
    doc.fillColor(GOLD).fontSize(7.5).font('Helvetica-Bold');
    tHdrs.forEach((h, i) => doc.text(h, tCols[i], dy + 6, { width: tWids[i] }));
    dy += 20;
    const syringeRows = [
      ['0.05 mL', '5 units', 'Very low dose', '100mcg'],
      ['0.10 mL', '10 units', 'Low dose', '250mcg @ 2,500mcg/mL'],
      ['0.20 mL', '20 units', 'Standard', '500mcg @ 2,500mcg/mL'],
      ['0.50 mL', '50 units', 'Mid/High', '1.25mg @ 2,500mcg/mL'],
      ['1.00 mL', '100 units', 'Full syringe', '2.5mg @ 2,500mcg/mL'],
    ];
    syringeRows.forEach((row, i) => {
      const bg = i % 2 === 0 ? '#EEF1F7' : WHITE;
      doc.rect(40, dy, doc.page.width - 80, 20).fill(bg);
      doc.fillColor(NAVY).fontSize(8.5).font(i === 0 ? 'Helvetica' : 'Helvetica');
      row.forEach((cell, j) => doc.text(cell, tCols[j], dy + 5, { width: tWids[j] }));
      dy += 20;
    });
    dy += 10;

    // Storage Rules
    if (dy + 80 > doc.page.height - 130) { doc.addPage(); pdfHeader(doc, 'Attachment 1 — Dosing Guide'); dy = 110; }
    dy = sectionBar(doc, 'STORAGE RULES', dy);
    const storageRules = [
      { rule: 'Lyophilized (freeze-dried) peptides', detail: 'Store at room temperature or refrigerated. Keep away from light and moisture.' },
      { rule: 'After reconstitution', detail: 'Refrigerate at 2-8\u00B0C immediately. Use within 30 days.' },
      { rule: 'Never freeze reconstituted peptides', detail: 'Freezing after adding BAC water degrades the peptide. Freeze only if still in powder form.' },
      { rule: 'Protect from light', detail: 'Store in the box or wrap vial in foil. UV light degrades peptides quickly.' },
      { rule: 'Label every vial', detail: 'Write: compound name, date reconstituted, concentration (mcg/mL).' },
      { rule: 'Travel / heat exposure', detail: 'Keep in a cooler with an ice pack. Do not leave in a hot car.' },
    ];
    storageRules.forEach((item, i) => {
      if (dy + 26 > doc.page.height - 130) { doc.addPage(); pdfHeader(doc, 'Attachment 1 — Dosing Guide'); dy = 110; }
      const bg = i % 2 === 0 ? '#EEF1F7' : WHITE;
      doc.rect(40, dy, doc.page.width - 80, 24).fill(bg);
      doc.fillColor(NAVY).fontSize(9).font('Helvetica-Bold').text(item.rule + ':', 52, dy + 7, { width: 180, lineBreak: false });
      doc.fillColor(MUTED).fontSize(8.5).font('Helvetica').text(item.detail, 240, dy + 8, { width: doc.page.width - 288 });
      dy += 24;
    });
    dy += 8;

    // Key Warnings
    if (dy + 60 > doc.page.height - 130) { doc.addPage(); pdfHeader(doc, 'Attachment 1 — Dosing Guide'); dy = 110; }
    dy = sectionBarDark(doc, 'KEY WARNINGS FOR YOUR PROTOCOL', dy);
    const warnings = [];
    if (allCompoundNames.includes('GHK-Cu'))
      warnings.push({ title: 'GHK-Cu — Burning Sensation', body: 'GHK-Cu causes a burning sensation at the injection site that lasts 30-60 seconds. This is NORMAL and expected due to the copper peptide complex. Inject very slowly over 15-20 seconds to minimize the sensation. It resolves on its own.' });
    if (allCompoundNames.includes('NAD+'))
      warnings.push({ title: 'NAD+ — Flushing / Warmth', body: 'NAD+ causes flushing, warmth, chest pressure, or nausea if injected too quickly. Inject EXTREMELY slowly over 3-5 minutes. These sensations are signs the compound is working. Start with 50-100mg and titrate up over several sessions.' });
    if (allCompoundNames.includes('Retatrutide') || allCompoundNames.includes('Semaglutide'))
      warnings.push({ title: 'GLP-1 — Nausea & Titration', body: 'GLP-1 compounds (Retatrutide, Semaglutide) must be titrated slowly. Start at the lowest dose and increase only when the current dose is well tolerated. Nausea, reduced appetite, and fatigue in the first 1-2 weeks are expected and resolve with titration.' });
    if (warnings.length === 0)
      warnings.push({ title: 'General', body: 'Follow all compound-specific dosing and injection instructions in your Attachment sheets. When in doubt, start at the lower end of the dose range.' });
    warnings.forEach(w => {
      if (dy + 52 > doc.page.height - 130) { doc.addPage(); pdfHeader(doc, 'Attachment 1 — Dosing Guide'); dy = 110; }
      doc.rect(40, dy, 4, 48).fill(GOLD);
      doc.rect(44, dy, doc.page.width - 84, 48).fill('#FFF8E7');
      doc.fillColor(NAVY).fontSize(9).font('Helvetica-Bold').text(w.title, 54, dy + 8, { width: doc.page.width - 104 });
      doc.fillColor(NAVY).fontSize(8.5).font('Helvetica').text(w.body, 54, dy + 22, { width: doc.page.width - 104, lineGap: 1 });
      dy = Math.max(dy + 52, doc.y + 8);
    });

    pdfFooter(doc, 2, totalPDFPages, true);

    // ── PAGES 3+: ONE PAGE PER COMPOUND — labeled as Attachment 2, 3 ... ──
    compoundSections.forEach((sec, secIdx) => {
      doc.addPage();
      const attNum = secIdx + 2;  // Attachment 2 = first compound, etc.
      pdfHeader(doc, 'Attachment ' + attNum + ' \u2014 ' + sec.name);
      let cy = 110;

      const info = COMPOUND_INFO[sec.name] || { tagline: sec.name, benefit: 'See compound guide for full details.', reconstitute: ['Follow compound-specific instructions.'] };
      const pricing = getPricingForCompound(sec.name);

      // Compound header block — no emoji, clean typography
      doc.rect(40, cy, doc.page.width - 80, 52).fill(NAVY);
      doc.fillColor(GOLD).fontSize(20).font('Helvetica-Bold')
         .text(sec.name, 52, cy + 8, { width: doc.page.width - 200 });
      doc.fillColor(LIGHT).fontSize(10).font('Helvetica')
         .text(info.tagline, 52, cy + 34, { width: doc.page.width - 200 });
      // Attachment badge top-right
      doc.rect(doc.page.width - 130, cy, 90, 52).fill(GOLD);
      doc.fillColor(NAVY).fontSize(8).font('Helvetica-Bold')
         .text('ATTACHMENT', doc.page.width - 128, cy + 10, { width: 86, align: 'center' });
      doc.fillColor(NAVY).fontSize(20).font('Helvetica-Bold')
         .text(attNum, doc.page.width - 128, cy + 22, { width: 86, align: 'center' });
      cy += 64;

      // Benefits
      cy = sectionBar(doc, 'WHAT IT DOES', cy);
      doc.fillColor(NAVY).fontSize(10).font('Helvetica')
         .text(info.benefit || '', 40, cy, { width: doc.page.width - 80, lineGap: 3 });
      cy = doc.y + 14;

      // How it works in the stack
      if (cy + 50 > doc.page.height - 130) { doc.addPage(); pdfHeader(doc, 'Attachment ' + attNum + ' \u2014 ' + sec.name); cy = 110; }
      cy = sectionBarDark(doc, 'HOW IT WORKS IN YOUR STACK', cy);
      doc.fillColor(NAVY).fontSize(10).font('Helvetica')
         .text(getCompoundSynergy(sec.name, allCompoundNames), 40, cy, { width: doc.page.width - 80, lineGap: 3 });
      cy = doc.y + 14;

      // Your Dose
      if (cy + 46 > doc.page.height - 130) { doc.addPage(); pdfHeader(doc, 'Attachment ' + attNum + ' \u2014 ' + sec.name); cy = 110; }
      cy = sectionBar(doc, 'YOUR DOSE', cy);
      const doseStr = sec.dose || dosingObj[sec.name] || 'As prescribed by Marc';
      const doseH = Math.max(32, Math.ceil(doseStr.length / 65) * 16 + 12);
      doc.rect(40, cy, doc.page.width - 80, doseH).fill(LIGHT);
      doc.rect(40, cy, 4, doseH).fill(GOLD);
      doc.fillColor(NAVY).fontSize(12).font('Helvetica-Bold')
         .text(doseStr, 52, cy + 9, { width: doc.page.width - 104 });
      cy += doseH + 10;

      // Reconstitution steps
      if (cy + 80 > doc.page.height - 130) { doc.addPage(); pdfHeader(doc, 'Attachment ' + attNum + ' \u2014 ' + sec.name); cy = 110; }
      cy = sectionBarDark(doc, 'RECONSTITUTION STEPS', cy);
      const steps = info.reconstitute || ['Follow compound-specific instructions.'];
      steps.forEach((step, i) => {
        if (cy + 28 > doc.page.height - 130) { doc.addPage(); pdfHeader(doc, 'Attachment ' + attNum + ' \u2014 ' + sec.name); cy = 110; }
        doc.rect(40, cy, 26, 24).fill(GOLD);
        doc.fillColor(NAVY).fontSize(11).font('Helvetica-Bold').text(String(i + 1), 40, cy + 6, { width: 26, align: 'center' });
        doc.fillColor(NAVY).fontSize(10).font('Helvetica').text(step, 72, cy + 7, { width: doc.page.width - 116, lineGap: 1 });
        cy = doc.y + 7;
      });

      // Supply & Cost box
      if (pricing) {
        cy += 8;
        if (cy + 52 > doc.page.height - 130) { doc.addPage(); pdfHeader(doc, 'Attachment ' + attNum + ' \u2014 ' + sec.name); cy = 110; }
        doc.rect(40, cy, doc.page.width - 80, 46).fill('#F5F7FA');
        doc.rect(40, cy, 4, 46).fill(GOLD);
        doc.fillColor(NAVY).fontSize(10).font('Helvetica-Bold')
           .text(pricing.units + ' ' + pricing.unit + (pricing.units > 1 ? 's' : '') + ' needed for ' + cycleLen + '-week cycle', 52, cy + 8, { width: doc.page.width - 104 });
        doc.fillColor(MUTED).fontSize(9).font('Helvetica')
           .text('$' + pricing.pricePerUnit.toLocaleString() + ' / unit   \u00B7   $' + pricing.totalCost.toLocaleString() + ' total   \u00B7   ~$' + pricing.monthlyCost.toLocaleString() + ' / month', 52, cy + 26, { width: doc.page.width - 104 });
        cy += 54;
      }

      pdfFooter(doc, secIdx + 3, totalPDFPages, true);
    });

    // ── LAST PAGE: QUICK REFERENCE SUMMARY ────────────────────────
    doc.addPage();
    pdfHeader(doc, 'Quick Reference Summary');
    let qy = 110;

    // Header
    doc.rect(40, qy, doc.page.width - 80, 40).fill(NAVY);
    doc.fillColor(GOLD).fontSize(16).font('Helvetica-Bold')
       .text('QUICK REFERENCE \u2014 ALL COMPOUNDS AT A GLANCE', 52, qy + 10, { width: doc.page.width - 104 });
    doc.fillColor(LIGHT).fontSize(9).font('Helvetica')
       .text(resolvedClientName + '   |   ' + cycleLen + '-Week Cycle   |   ' + dateStr, 52, qy + 28);
    qy += 52;

    // Table header
    const qCols  = [40, 170, 295, 375, 448, 510];
    const qWidths = [125, 120, 75,  68,  57,  doc.page.width - 550];
    const qHdrs  = ['COMPOUND', 'YOUR DOSE', 'QTY NEEDED', 'SUPPLY', 'UNIT PRICE', 'PER MONTH'];
    doc.rect(40, qy, doc.page.width - 80, 24).fill(ACCENT);
    doc.fillColor(GOLD).fontSize(7.5).font('Helvetica-Bold');
    qHdrs.forEach((h, i) => doc.text(h, qCols[i], qy + 8, { width: qWidths[i] }));
    qy += 24;

    let grandTotal = 0, monthlyTotal = 0;
    compoundSections.forEach((sec, i) => {
      if (qy + 24 > doc.page.height - 140) { doc.addPage(); pdfHeader(doc, 'Quick Reference Summary'); qy = 110; }
      const pr = getPricingForCompound(sec.name);
      const bg = i % 2 === 0 ? '#EEF1F7' : WHITE;
      doc.rect(40, qy, doc.page.width - 80, 24).fill(bg);
      // Attachment number badge
      doc.rect(40, qy, 18, 24).fill(GOLD);
      doc.fillColor(NAVY).fontSize(7).font('Helvetica-Bold')
         .text('A' + (i + 2), 40, qy + 8, { width: 18, align: 'center' });
      doc.fillColor(NAVY).fontSize(8.5).font('Helvetica-Bold')
         .text(sec.name, qCols[0] + 22, qy + 7, { width: qWidths[0] - 22 });
      doc.font('Helvetica').fontSize(7.5);
      const ds = sec.dose || dosingObj[sec.name] || '\u2014';
      doc.fillColor(NAVY).text(ds.length > 28 ? ds.slice(0, 26) + '\u2026' : ds, qCols[1], qy + 7, { width: qWidths[1] });
      if (pr) {
        doc.fillColor(NAVY).text(pr.units + ' ' + pr.unit + (pr.units > 1 ? 's' : ''), qCols[2], qy + 7, { width: qWidths[2] });
        doc.text('~' + pr.wpu + ' wk', qCols[3], qy + 7, { width: qWidths[3] });
        doc.text('$' + pr.pricePerUnit.toLocaleString(), qCols[4], qy + 7, { width: qWidths[4] });
        doc.fillColor(GOLD).font('Helvetica-Bold').text('$' + pr.monthlyCost.toLocaleString(), qCols[5], qy + 7, { width: qWidths[5] });
        grandTotal += pr.totalCost; monthlyTotal += pr.monthlyCost;
      } else {
        doc.fillColor(MUTED).text('\u2014', qCols[2], qy + 7, { width: 120 });
      }
      qy += 24;
    });

    // Total row
    if (qy + 30 > doc.page.height - 140) { doc.addPage(); pdfHeader(doc, 'Quick Reference Summary'); qy = 110; }
    doc.rect(40, qy, doc.page.width - 80, 30).fill(DARK2);
    doc.fillColor(GOLD).fontSize(11).font('Helvetica-Bold').text('TOTAL', 62, qy + 9, { width: 200 });
    doc.fillColor(WHITE).fontSize(10).font('Helvetica-Bold')
       .text('$' + grandTotal.toLocaleString(), qCols[4], qy + 9, { width: 60 });
    doc.fillColor(GOLD).text('$' + monthlyTotal.toLocaleString() + '/mo', qCols[5], qy + 9, { width: qWidths[5] });
    qy += 38;

    doc.fillColor(MUTED).fontSize(8).font('Helvetica')
       .text(cycleLen + '-week cycle   \u00B7   ~' + (Math.round(cycleLen / 4.33 * 10) / 10) + ' months   \u00B7   See each Attachment for full dosing detail', 40, qy, { width: doc.page.width - 80 });
    qy = doc.y + 18;

    // Final disclaimer
    if (qy + 64 > doc.page.height - 80) { doc.addPage(); pdfHeader(doc, 'Quick Reference Summary'); qy = 110; }
    doc.rect(40, qy, doc.page.width - 80, 64).fill(LIGHT);
    doc.rect(40, qy, 4, 64).fill(MUTED);
    doc.fillColor(MUTED).fontSize(7.5).font('Helvetica-Bold').text('RESEARCH DISCLAIMER', 52, qy + 10);
    doc.fillColor(MUTED).fontSize(7.5).font('Helvetica')
       .text('For research purposes only. Not intended for human use. Not medical advice. Store all peptides refrigerated at 2-8\u00B0C after reconstitution. Discard any vial that appears cloudy, discoloured, or has particles. Consult a qualified physician before use.', 52, qy + 24, { width: doc.page.width - 104, lineGap: 2 });

    pdfFooter(doc, totalPDFPages, totalPDFPages, true);
    doc.end();

  } catch (e) {
    console.error('Protocol PDF error:', e);
    res.status(500).json({ error: e.message });
  }
});
// ════════════════════════════════════════════════════════════
// PROTOCOL PACK PDF — ships with every order
// ════════════════════════════════════════════════════════════

const { lookupCompound, calcVialDuration } = require('./data/compounds.js');

// Resource URL — update when client app is deployed
const RESOURCE_URL = 'http://localhost:5173';

app.post('/api/pdf/protocol-pack', (req, res) => {
  try {
    const {
      clientName, orderItems, orderNumber, date,
      cycleWeeks, doseLevel, timeline, monthlyCost, coveredDomains
    } = req.body;
    const items = typeof orderItems === 'string' ? JSON.parse(orderItems) : (orderItems || []);
    const dateStr = date
      ? new Date(date).toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' })
      : new Date().toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });
    const resolvedCycle = cycleWeeks || 12;
    const resolvedDose = doseLevel || 'mid';

    const doc = new PDFDocument({
      size: 'LETTER',
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      bufferPages: true,
      compress: false,
      info: {
        Title: `MyBioYouth Protocol Pack - ${orderNumber || 'draft'}`,
        Author: 'MyBioYouth',
        Subject: 'Peptide Research Protocol Reference'
      }
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="mybioyouth-protocol-pack-${orderNumber || 'draft'}.pdf"`);
    doc.pipe(res);

    const PW = doc.page.width;
    const PH = doc.page.height;
    const M = 40;

    // ═════════════════════════════════════════════════════════
    // HELPER: branded content-page header + footer
    // ═════════════════════════════════════════════════════════
    function contentHeader(title, subtitle) {
      doc.rect(0, 0, PW, 88).fill(NAVY);
      doc.rect(0, 88, PW, 3).fill(GOLD);
      doc.fillColor(GOLD).fontSize(20).font('Helvetica-Bold')
         .text('MYBIOYOUTH', M, 22, { characterSpacing: 3, lineBreak: false });
      doc.fillColor(LIGHT).fontSize(9).font('Helvetica')
         .text('Cornerstone RE Health  |  Peptide Research Operations', M, 48, { lineBreak: false });
      doc.fillColor(WHITE).fontSize(13).font('Helvetica-Bold')
         .text(title, PW - 300, 28, { width: 260, align: 'right', lineBreak: false });
      if (subtitle) doc.fillColor(GOLD).fontSize(8).font('Helvetica')
         .text(subtitle, PW - 300, 50, { width: 260, align: 'right', lineBreak: false });
    }

    function contentFooter(pageNum, totalPages) {
      const fy = PH - 52;
      doc.rect(M, fy, PW - M * 2, 1).fill(GOLD);
      doc.fillColor(MUTED).fontSize(7).font('Helvetica')
         .text('FOR RESEARCH PURPOSES ONLY. Not intended for human use. Not medical advice. Always consult a qualified physician.',
               M, fy + 10, { width: PW - M * 2, align: 'center', lineBreak: false });
      doc.fillColor(MUTED).fontSize(7)
         .text(`MyBioYouth  |  marc@cornerstoneregroup.ca  |  Page ${pageNum} of ${totalPages}`,
               M, fy + 24, { width: PW - M * 2, align: 'center', lineBreak: false });
    }

    // ═════════════════════════════════════════════════════════
    // PAGE 1: COVER PAGE
    // ═════════════════════════════════════════════════════════
    // Full navy bg
    doc.rect(0, 0, PW, PH).fill(NAVY);
    // Gold accent strip bottom
    doc.rect(0, PH - 6, PW, 6).fill(GOLD);

    // Top brand strip
    doc.fillColor(GOLD).fontSize(24).font('Helvetica-Bold')
       .text('MYBIOYOUTH', M, 60, { characterSpacing: 4, lineBreak: false });
    doc.fillColor(LIGHT).fontSize(10).font('Helvetica')
       .text('Cornerstone RE Health  —  Peptide Research Operations', M, 94, { lineBreak: false });
    doc.rect(M, 122, 80, 2).fill(GOLD);

    // Big title block
    doc.fillColor(GOLD).fontSize(11).font('Helvetica-Bold')
       .text('RESEARCH COMPOUND REFERENCE', M, 220, { characterSpacing: 3 });
    doc.fillColor(WHITE).fontSize(52).font('Helvetica-Bold')
       .text('Protocol', M, 244, { lineGap: 2 });
    doc.fillColor(GOLD).fontSize(52).font('Helvetica-Bold')
       .text('Pack', M, 298);
    doc.rect(M, 370, 100, 3).fill(GOLD);

    // Client info
    const nameParts = (clientName || 'Research Client').split(' ');
    const displayName = nameParts[0] + (nameParts[1] ? ' ' + nameParts[1][0] + '.' : '');
    doc.fillColor(LIGHT).fontSize(16).font('Helvetica').text(`Prepared for: ${displayName}`, M, 390);
    doc.fillColor(MUTED).fontSize(10).font('Helvetica').text(dateStr, M, 416);
    if (orderNumber) doc.fillColor(MUTED).fontSize(10).font('Helvetica').text(`Order: ${orderNumber}`, M, 432);

    // Key stats row
    const statY = 474;
    const statW = (PW - M * 2 - 20) / 3;
    // Box 1 — cycle
    doc.rect(M, statY, statW, 60).fill(DARK2);
    doc.fillColor(GOLD).fontSize(8).font('Helvetica-Bold')
       .text('CYCLE LENGTH', M + 12, statY + 10, { characterSpacing: 1.5 });
    doc.fillColor(WHITE).fontSize(24).font('Helvetica-Bold')
       .text(resolvedCycle + 'w', M + 12, statY + 26);
    // Box 2 — dose
    doc.rect(M + statW + 10, statY, statW, 60).fill(DARK2);
    doc.fillColor(GOLD).fontSize(8).font('Helvetica-Bold')
       .text('DOSE LEVEL', M + statW + 22, statY + 10, { characterSpacing: 1.5 });
    doc.fillColor(WHITE).fontSize(24).font('Helvetica-Bold')
       .text(resolvedDose.charAt(0).toUpperCase() + resolvedDose.slice(1), M + statW + 22, statY + 26);
    // Box 3 — compounds
    doc.rect(M + statW * 2 + 20, statY, statW, 60).fill(DARK2);
    doc.fillColor(GOLD).fontSize(8).font('Helvetica-Bold')
       .text('COMPOUNDS', M + statW * 2 + 32, statY + 10, { characterSpacing: 1.5 });
    doc.fillColor(WHITE).fontSize(24).font('Helvetica-Bold')
       .text(String(items.length), M + statW * 2 + 32, statY + 26);

    // Pack contents
    doc.fillColor(GOLD).fontSize(10).font('Helvetica-Bold')
       .text('THIS PACK CONTAINS', M, 560, { characterSpacing: 1.5 });
    const includes = [
      'Compound-by-compound reconstitution guide',
      'Exact dosing in mg / mcg / insulin syringe units',
      'Injection timing, location, and schedule',
      'Expected timeline (week 1-2, 3-4, 6-8)',
      'Combined protocol overview table',
      'Stack synergies and interactions',
      'Contraindications and safety warnings',
      'Online research references with URLs'
    ];
    let iy = 584;
    includes.forEach(line => {
      doc.fillColor(GOLD).fontSize(10).font('Helvetica-Bold').text('—', M, iy, { lineBreak: false });
      doc.fillColor(LIGHT).fontSize(10).font('Helvetica').text(line, M + 14, iy);
      iy += 18;
    });

    // QR / resource link
    doc.rect(M, PH - 140, PW - M * 2, 60).fill(DARK2);
    doc.rect(M, PH - 140, 4, 60).fill(GOLD);
    doc.fillColor(GOLD).fontSize(9).font('Helvetica-Bold')
       .text('ONLINE RESOURCE CENTRE', M + 14, PH - 130, { characterSpacing: 1.5 });
    doc.fillColor(LIGHT).fontSize(10).font('Helvetica')
       .text('Full compound research, stack recommendations, and FAQ:', M + 14, PH - 112);
    doc.fillColor(GOLD).fontSize(11).font('Helvetica-Bold')
       .text(RESOURCE_URL, M + 14, PH - 94);

    doc.fillColor(MUTED).fontSize(7).font('Helvetica')
       .text('FOR RESEARCH PURPOSES ONLY. Not intended for human use. Not medical advice.',
             M, PH - 22, { align: 'center', width: PW - M * 2 });

    // ═════════════════════════════════════════════════════════
    // PAGES 2+: PER-COMPOUND PAGES
    // ═════════════════════════════════════════════════════════
    const knownItems = items.filter(item => {
      const c = lookupCompound(item.name || item.productName || '');
      return c !== null;
    });

    knownItems.forEach((item, idx) => {
      const productName = item.name || item.productName || 'Unknown';
      const qty = parseInt(item.qty || item.quantity || 1);
      const compound = lookupCompound(productName);

      doc.addPage();
      contentHeader(compound.name, `Attachment ${idx + 1} of ${knownItems.length}`);

      let y = 100;

      // Compound name banner
      doc.rect(M, y, PW - M * 2, 44).fill(DARK2);
      doc.rect(M, y, 4, 44).fill(GOLD);
      doc.fillColor(GOLD).fontSize(18).font('Helvetica-Bold')
         .text(compound.name, M + 14, y + 10, { width: 340, lineBreak: false });
      doc.fillColor(MUTED).fontSize(8.5).font('Helvetica')
         .text(compound.fullName, M + 14, y + 30, { width: 400, lineBreak: false });
      doc.fillColor(LIGHT).fontSize(9).font('Helvetica')
         .text(`${qty} vial${qty > 1 ? 's' : ''} ordered`, PW - M - 120, y + 17, { width: 106, align: 'right', lineBreak: false });
      y += 50;

      // WHAT IS IT (compact)
      doc.fillColor(NAVY).fontSize(8.5).font('Helvetica-Bold')
         .text('WHAT IT IS', M, y, { characterSpacing: 1.2 });
      y += 11;
      doc.fillColor(NAVY).fontSize(9).font('Helvetica')
         .text(compound.what, M, y, { width: PW - M * 2, lineGap: 1.5 });
      y = doc.y + 8;

      // KEY BENEFITS as chips (tighter)
      doc.fillColor(NAVY).fontSize(8.5).font('Helvetica-Bold')
         .text('KEY BENEFITS', M, y, { characterSpacing: 1.2 });
      y += 11;
      let bx = M;
      compound.benefits.forEach(b => {
        const bw = b.length * 5 + 14;
        if (bx + bw > PW - M) { bx = M; y += 20; }
        doc.rect(bx, y, bw, 16).fill(ACCENT);
        doc.fillColor(GOLD).fontSize(7.5).font('Helvetica-Bold')
           .text(b, bx + 7, y + 4, { width: bw - 14, lineBreak: false });
        bx += bw + 6;
      });
      y += 22;

      // RECONSTITUTION + DOSING combined into two-column layout for density
      // LEFT column: reconstitution (compact)
      const colW = (PW - M * 2 - 12) / 2;

      // LEFT: Reconstitution
      doc.rect(M, y, colW, 20).fill(NAVY);
      doc.fillColor(GOLD).fontSize(8).font('Helvetica-Bold')
         .text('RECONSTITUTION', M + 8, y + 6, { characterSpacing: 1.2 });

      // RIGHT: Dosing syringe guide
      doc.rect(M + colW + 12, y, colW, 20).fill(NAVY);
      doc.fillColor(GOLD).fontSize(8).font('Helvetica-Bold')
         .text('DOSING (100u SYRINGE)', M + colW + 20, y + 6, { characterSpacing: 1.2 });

      const colTop = y + 20;
      const r = compound.reconstitution;
      const steps = r.bacMl > 0 ? [
        `Add ${r.bacMl}mL BAC water to ${r.vialMg}mg vial`,
        `Swirl gently — never shake or heat`,
        `Final: ${r.concMgMl}mg/mL (${r.concMcgMl.toLocaleString()}mcg/mL)`
      ] : ['Ready to use — no reconstitution needed'];

      let ly = colTop + 4;
      steps.forEach((step, i) => {
        doc.rect(M, ly, 18, 16).fill(i === steps.length - 1 ? GOLD : DARK2);
        doc.fillColor(i === steps.length - 1 ? NAVY : GOLD).fontSize(9).font('Helvetica-Bold')
           .text(String(i + 1), M, ly + 3, { width: 18, align: 'center', lineBreak: false });
        doc.fillColor(NAVY).fontSize(8.5).font('Helvetica')
           .text(step, M + 24, ly + 3, { width: colW - 30, lineGap: 0 });
        ly += 22;
      });
      const leftEnd = ly;

      // RIGHT: Syringe table
      let ry2 = colTop;
      doc.rect(M + colW + 12, ry2, colW, 18).fill(ACCENT);
      doc.fillColor(LIGHT).fontSize(7).font('Helvetica-Bold');
      doc.text('DOSE', M + colW + 20, ry2 + 5, { width: 70 });
      doc.text('mL', M + colW + 92, ry2 + 5, { width: 50 });
      doc.text('UNITS', M + colW + 150, ry2 + 5, { width: 60 });
      ry2 += 18;

      compound.syringeTable.forEach((row, i) => {
        const bg = i % 2 === 0 ? '#EEF1F7' : WHITE;
        doc.rect(M + colW + 12, ry2, colW, 20).fill(bg);
        doc.fillColor(NAVY).fontSize(9).font('Helvetica-Bold')
           .text(row.dose, M + colW + 20, ry2 + 5, { width: 70, lineBreak: false });
        doc.fillColor(NAVY).fontSize(8.5).font('Helvetica')
           .text(row.ml, M + colW + 92, ry2 + 6, { width: 50, lineBreak: false });
        doc.fillColor(GOLD).fontSize(9).font('Helvetica-Bold')
           .text(`${row.units}u`, M + colW + 150, ry2 + 5, { width: 60, lineBreak: false });
        ry2 += 20;
      });
      const rightEnd = ry2;
      y = Math.max(leftEnd, rightEnd) + 8;

      // SUPPLY DURATION (slim strip)
      const duration = calcVialDuration(compound, qty);
      if (duration) {
        doc.rect(M, y, PW - M * 2, 28).fill(DARK2);
        doc.rect(M, y, 4, 28).fill(GOLD);
        const weeksLabel = duration.weeks < 2 ? duration.weeks.toFixed(1) : Math.round(duration.weeks);
        doc.fillColor(GOLD).fontSize(8).font('Helvetica-Bold')
           .text('SUPPLY', M + 14, y + 5, { characterSpacing: 1.2 });
        doc.fillColor(LIGHT).fontSize(9).font('Helvetica')
           .text(
             `${qty} vial${qty > 1 ? 's' : ''} × ${compound.typicalDoseMcg.toLocaleString()}mcg @ ${compound.typicalFreqPerWeek}×/wk = ~${weeksLabel} weeks (${duration.days} days)`,
             M + 14, y + 15, { width: PW - M * 2 - 28, lineBreak: false });
        y += 34;
      }

      // TIMING + STORAGE in two columns
      const ts1 = y;
      doc.fillColor(NAVY).fontSize(8.5).font('Helvetica-Bold')
         .text('INJECTION TIMING & LOCATION', M, y, { characterSpacing: 1.2 });
      doc.fillColor(NAVY).fontSize(8.5).font('Helvetica-Bold')
         .text('STORAGE', M + colW + 12, y, { characterSpacing: 1.2 });
      y += 11;

      const timingEndY = y;
      doc.fillColor(NAVY).fontSize(8.5).font('Helvetica')
         .text(compound.timing, M, y, { width: colW, lineGap: 1 });
      const leftY = doc.y;
      doc.fillColor(NAVY).fontSize(8.5).font('Helvetica')
         .text(compound.storage, M + colW + 12, timingEndY, { width: colW, lineGap: 1 });
      const rightY = doc.y;
      y = Math.max(leftY, rightY) + 10;

      // EXPECTED TIMELINE (phases)
      doc.fillColor(NAVY).fontSize(8.5).font('Helvetica-Bold')
         .text('EXPECTED TIMELINE', M, y, { characterSpacing: 1.2 });
      y += 11;

      const phases = buildTimelinePhases(compound);
      phases.forEach((p, pi) => {
        const bg = pi % 2 === 0 ? '#F5F7FA' : WHITE;
        doc.rect(M, y, PW - M * 2, 22).fill(bg);
        doc.rect(M, y, 74, 22).fill(ACCENT);
        doc.fillColor(GOLD).fontSize(8).font('Helvetica-Bold')
           .text(p.label, M + 8, y + 7, { width: 66, lineBreak: false, characterSpacing: 0.5 });
        doc.fillColor(NAVY).fontSize(8.5).font('Helvetica')
           .text(p.note, M + 82, y + 7, { width: PW - M * 2 - 90, lineBreak: false, ellipsis: true });
        y += 22;
      });
      y += 8;

      // SAFETY / WARNINGS (compact)
      if (compound.burnWarning && compound.burnNote) {
        const warnH = 42;
        doc.rect(M, y, PW - M * 2, warnH).fill('#FFF7E6');
        doc.rect(M, y, 4, warnH).fill('#F59E0B');
        doc.fillColor('#92400E').fontSize(7.5).font('Helvetica-Bold')
           .text('SAFETY — EXPECTED BURNING ON INJECTION', M + 14, y + 6, { characterSpacing: 1.2 });
        doc.fillColor('#78350F').fontSize(7.5).font('Helvetica')
           .text(compound.burnNote, M + 14, y + 18, { width: PW - M * 2 - 28, lineGap: 1, ellipsis: true, height: warnH - 22 });
        y += warnH + 6;
      }
      if (compound.flushWarning && compound.flushNote) {
        const warnH = 42;
        doc.rect(M, y, PW - M * 2, warnH).fill('#FEF2F2');
        doc.rect(M, y, 4, warnH).fill('#EF4444');
        doc.fillColor('#7F1D1D').fontSize(7.5).font('Helvetica-Bold')
           .text('SAFETY — EXPECTED FLUSHING', M + 14, y + 6, { characterSpacing: 1.2 });
        doc.fillColor('#991B1B').fontSize(7.5).font('Helvetica')
           .text(compound.flushNote, M + 14, y + 18, { width: PW - M * 2 - 28, lineGap: 1, ellipsis: true, height: warnH - 22 });
        y += warnH + 6;
      }

      // NOTES (compact)
      if (compound.notes && y < PH - 110) {
        doc.fillColor(NAVY).fontSize(8.5).font('Helvetica-Bold')
           .text('RESEARCH NOTES', M, y, { characterSpacing: 1.2 });
        y += 11;
        doc.fillColor(MUTED).fontSize(8.5).font('Helvetica')
           .text(compound.notes, M, y, { width: PW - M * 2, lineGap: 1.5, height: PH - y - 80 });
      }

      contentFooter(idx + 2, knownItems.length + 3);
    });

    // ═════════════════════════════════════════════════════════
    // PENULTIMATE PAGE: COMBINED PROTOCOL OVERVIEW + SYNERGIES
    // ═════════════════════════════════════════════════════════
    doc.addPage();
    contentHeader('Combined Protocol Overview', 'Stack summary');

    let oy = 108;

    // Title block
    doc.rect(M, oy, PW - M * 2, 40).fill(NAVY);
    doc.fillColor(GOLD).fontSize(15).font('Helvetica-Bold')
       .text('YOUR COMPLETE PROTOCOL', M + 14, oy + 11, { characterSpacing: 1.5 });
    doc.fillColor(LIGHT).fontSize(9).font('Helvetica')
       .text(`${resolvedCycle}-week cycle  |  ${resolvedDose.toUpperCase()} dose level  |  ${knownItems.length} compound${knownItems.length !== 1 ? 's' : ''}`,
             M + 14, oy + 28);
    oy += 50;

    // Overview table
    const cCols = [M, M + 110, M + 200, M + 290, M + 380, M + 450];
    const cWids = [108, 88, 88, 88, 68, PW - M - 450 - 10];
    const cHdrs = ['COMPOUND', 'TYPICAL DOSE', 'FREQUENCY', 'TIMING', 'VIALS', 'SUPPLY'];
    doc.rect(M, oy, PW - M * 2, 22).fill(ACCENT);
    doc.fillColor(GOLD).fontSize(7.5).font('Helvetica-Bold');
    cHdrs.forEach((h, i) => doc.text(h, cCols[i] + 4, oy + 8, { width: cWids[i], lineBreak: false, characterSpacing: 1 }));
    oy += 22;

    knownItems.forEach((item, i) => {
      const compound = lookupCompound(item.name || item.productName || '');
      if (!compound) return;
      const qty = parseInt(item.qty || item.quantity || 1);
      const duration = calcVialDuration(compound, qty);
      const bg = i % 2 === 0 ? '#EEF1F7' : WHITE;
      doc.rect(M, oy, PW - M * 2, 22).fill(bg);
      doc.fillColor(NAVY).fontSize(9).font('Helvetica-Bold')
         .text(compound.name, cCols[0] + 4, oy + 6, { width: cWids[0], lineBreak: false, ellipsis: true });
      doc.fillColor(NAVY).fontSize(8).font('Helvetica')
         .text(compound.typicalDoseMcg >= 1000 ? (compound.typicalDoseMcg / 1000) + 'mg' : compound.typicalDoseMcg + 'mcg',
               cCols[1] + 4, oy + 7, { width: cWids[1], lineBreak: false });
      doc.text(compound.typicalFreqPerWeek + '×/week', cCols[2] + 4, oy + 7, { width: cWids[2], lineBreak: false });
      // Timing (first fragment)
      const tShort = (compound.timing || '').split('.')[0].slice(0, 28);
      doc.fillColor(MUTED).text(tShort, cCols[3] + 4, oy + 7, { width: cWids[3], lineBreak: false, ellipsis: true });
      doc.fillColor(NAVY).text(String(qty), cCols[4] + 4, oy + 7, { width: cWids[4], lineBreak: false });
      doc.fillColor(GOLD).fontSize(9).font('Helvetica-Bold')
         .text(duration ? duration.weeks + 'w' : '—', cCols[5] + 4, oy + 6, { width: cWids[5], lineBreak: false });
      oy += 22;
    });

    oy += 16;

    // STACK SYNERGIES (why these were chosen together)
    doc.rect(M, oy, PW - M * 2, 22).fill(NAVY);
    doc.fillColor(GOLD).fontSize(9).font('Helvetica-Bold')
       .text('STACK SYNERGIES — WHY THESE COMPOUNDS TOGETHER', M + 10, oy + 7, { characterSpacing: 1.5 });
    oy += 26;

    const synergies = buildSynergies(knownItems);
    synergies.forEach(s => {
      if (oy > PH - 160) return;
      doc.fillColor(GOLD).fontSize(9).font('Helvetica-Bold').text('— ', M, oy, { lineBreak: false });
      doc.fillColor(NAVY).fontSize(9).font('Helvetica-Bold').text(s.title, M + 12, oy, { lineBreak: false, continued: true });
      doc.fillColor(MUTED).font('Helvetica').text(': ' + s.note, { lineBreak: false });
      oy = doc.y + 6;
    });
    oy += 8;

    // CONTRAINDICATIONS
    if (oy > PH - 140) { oy = PH - 140; }
    doc.rect(M, oy, PW - M * 2, 22).fill(NAVY);
    doc.fillColor(GOLD).fontSize(9).font('Helvetica-Bold')
       .text('INTERACTIONS & CONTRAINDICATIONS', M + 10, oy + 7, { characterSpacing: 1.5 });
    oy += 26;

    const contra = buildContraindications(knownItems);
    contra.forEach(c => {
      if (oy > PH - 100) return;
      doc.fillColor('#F59E0B').fontSize(9).font('Helvetica-Bold').text('!  ', M, oy, { lineBreak: false });
      doc.fillColor(NAVY).fontSize(9).font('Helvetica')
         .text(c, M + 16, oy, { width: PW - M * 2 - 16, lineGap: 1 });
      oy = doc.y + 6;
    });

    contentFooter(knownItems.length + 2, knownItems.length + 3);

    // ═════════════════════════════════════════════════════════
    // FINAL PAGE: ONLINE RESOURCES + DISCLAIMER
    // ═════════════════════════════════════════════════════════
    doc.addPage();
    contentHeader('Online Research Resources', 'Further reading');

    let ry = 108;

    doc.fillColor(NAVY).fontSize(15).font('Helvetica-Bold')
       .text('Curated Research References', M, ry); ry += 24;
    doc.fillColor(MUTED).fontSize(9).font('Helvetica')
       .text('Peer-reviewed research, clinical trials, and deep-dive references for every compound in your protocol.',
             M, ry, { width: PW - M * 2, lineGap: 2 });
    ry = doc.y + 18;

    const resources = [
      { title: 'MyBioYouth Compound Library', url: 'https://mybioyouth.com/compounds', note: 'Full compound reference with dosing, protocols, and safety data.' },
      { title: 'PubMed — Peptide Research Database', url: 'https://pubmed.ncbi.nlm.nih.gov/', note: 'Primary literature on every peptide. Search by compound name.' },
      { title: 'Examine.com — Supplement & Peptide Analyses', url: 'https://examine.com/', note: 'Evidence-based summaries of compounds and their research base.' },
      { title: 'Peptide Research Hub (PRH)', url: 'https://peptideresearchhub.com/', note: 'Community research logs, protocol reviews, sourcing verification.' },
      { title: 'Cornerstone RE Health — Marc Direct', url: 'mailto:marc@cornerstoneregroup.ca', note: 'Questions about your specific protocol? Email Marc directly.' }
    ];

    resources.forEach((r, i) => {
      const bg = i % 2 === 0 ? '#F5F7FA' : WHITE;
      doc.rect(M, ry, PW - M * 2, 50).fill(bg);
      doc.rect(M, ry, 4, 50).fill(GOLD);
      doc.fillColor(NAVY).fontSize(11).font('Helvetica-Bold')
         .text(r.title, M + 14, ry + 8, { width: PW - M * 2 - 28 });
      doc.fillColor(GOLD).fontSize(9).font('Helvetica-Bold')
         .text(r.url, M + 14, ry + 24);
      doc.fillColor(MUTED).fontSize(8).font('Helvetica')
         .text(r.note, M + 14, ry + 36, { width: PW - M * 2 - 28 });
      ry += 54;
    });

    ry += 10;
    // Measurement glossary
    doc.rect(M, ry, PW - M * 2, 2).fill(GOLD);
    ry += 12;
    doc.fillColor(NAVY).fontSize(12).font('Helvetica-Bold')
       .text('Understanding Your Measurements', M, ry);
    ry += 18;

    const glossary = [
      ['mg', '1 milligram = 1,000 mcg'],
      ['mcg', 'microgram — the typical peptide dose unit'],
      ['mL / cc', 'millilitre — same thing, how much liquid to draw'],
      ['IU / units', '100-unit syringe: each mark = 0.01mL']
    ];
    const glW = (PW - M * 2 - 24) / 2;
    glossary.forEach((g, i) => {
      const gx = M + (i % 2) * (glW + 24);
      const gy = ry + Math.floor(i / 2) * 26;
      doc.rect(gx, gy, glW, 22).fill('#F5F7FA');
      doc.rect(gx, gy, 60, 22).fill(NAVY);
      doc.fillColor(GOLD).fontSize(10).font('Helvetica-Bold')
         .text(g[0], gx, gy + 6, { width: 60, align: 'center', lineBreak: false });
      doc.fillColor(MUTED).fontSize(8).font('Helvetica')
         .text(g[1], gx + 70, gy + 7, { width: glW - 78, lineBreak: false });
    });
    ry += 56;

    // Final disclaimer box
    doc.rect(M, PH - 160, PW - M * 2, 60).fill(LIGHT);
    doc.rect(M, PH - 160, 4, 60).fill(MUTED);
    doc.fillColor(NAVY).fontSize(8).font('Helvetica-Bold')
       .text('FULL RESEARCH DISCLAIMER', M + 14, PH - 152, { characterSpacing: 1.5 });
    doc.fillColor(MUTED).fontSize(8).font('Helvetica')
       .text('All compounds listed in this document are for research purposes only. Not intended for human use. Not medical advice. ' +
             'Store all peptides refrigerated at 2-8°C after reconstitution. Discard any vial that appears cloudy, discoloured, or contains particles. ' +
             'Consult a qualified physician before use.',
             M + 14, PH - 138, { width: PW - M * 2 - 28, lineGap: 1.5 });

    contentFooter(knownItems.length + 3, knownItems.length + 3);

    doc.end();
  } catch (e) {
    console.error('Protocol pack PDF error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ── Per-compound timeline phases (used by Protocol Pack) ──────────────
function buildTimelinePhases(compound) {
  const name = (compound.name || '').toLowerCase();
  // Custom phases based on compound type
  if (name.includes('bpc-157')) return [
    { label: 'WEEK 1-2', note: 'Adaptation phase. Localised inflammation reduction begins. Minor sleep changes possible.' },
    { label: 'WEEK 3-4', note: 'Tendon/ligament repair accelerates. Pain reduction and range-of-motion improvements.' },
    { label: 'WEEK 6-8', note: 'Full healing benefits. Gut lining repaired. Maintain for lingering injuries.' }
  ];
  if (name.includes('tb-500')) return [
    { label: 'WEEK 1-2', note: 'Loading phase. Mild head rush post-injection is normal — sit 5 minutes.' },
    { label: 'WEEK 3-4', note: 'Systemic flexibility and tissue repair noticeable. Reduce to 1×/wk maintenance.' },
    { label: 'WEEK 6-8', note: 'Full-body healing synergy with BPC-157. Cardiac and hair benefits emerge.' }
  ];
  if (name.includes('ghk-cu')) return [
    { label: 'WEEK 1-2', note: 'Burning on injection is expected. Skin texture changes begin. Blue-green solution is normal.' },
    { label: 'WEEK 3-4', note: 'Collagen synthesis visible — skin firmness, wound healing acceleration.' },
    { label: 'WEEK 6-8', note: 'Hair follicle stimulation, DNA repair signalling at full effect.' }
  ];
  if (name.includes('nad+')) return [
    { label: 'WEEK 1-2', note: 'Start at 50-100mg slow-push. Flushing expected — slower injection reduces it.' },
    { label: 'WEEK 3-4', note: 'Titrate to 250mg. Cognitive clarity, reduced brain fog, energy stabilisation.' },
    { label: 'WEEK 6-8', note: 'Full mitochondrial restoration. Sirtuin activation. Continue 2-3x/wk for longevity.' }
  ];
  if (name.includes('semaglutide') || name.includes('retatrutide')) return [
    { label: 'WEEK 1-2', note: 'Start at lowest dose. Nausea and reduced appetite are expected. Small low-fat meals.' },
    { label: 'WEEK 3-4', note: 'Titrate up only when current dose is well-tolerated. Steady weight loss begins.' },
    { label: 'WEEK 6-8', note: 'Therapeutic dose reached. 1-2% bodyweight loss/week typical at this point.' }
  ];
  if (name.includes('cjc-1295') || name.includes('ipamorelin')) return [
    { label: 'WEEK 1-2', note: 'Mild water retention is normal and resolves. Improved sleep quality noticeable within 3-5 days.' },
    { label: 'WEEK 3-4', note: 'Recovery speed improves. Empty stomach injection required for GH pulse.' },
    { label: 'WEEK 6-8', note: 'IGF-1 elevation peaks. Body composition shifts — leaner, more recovery capacity.' }
  ];
  if (name.includes('kpv')) return [
    { label: 'WEEK 1-2', note: 'Gut symptom relief begins. Reduces histamine reactions to other peptides in the stack.' },
    { label: 'WEEK 3-4', note: 'Leaky gut barrier strengthening. Mast cell reactivity drops noticeably.' },
    { label: 'WEEK 6-8', note: 'Full anti-inflammatory effect. Continue as safety peptide alongside other compounds.' }
  ];
  if (name.includes('semax')) return [
    { label: 'WEEK 1-2', note: 'Cognitive clarity and focus improvements within 3-5 days. Vivid dreams possible.' },
    { label: 'WEEK 3-4', note: 'BDNF elevation peaks. Memory formation and mental stamina noticeably enhanced.' },
    { label: 'WEEK 6-8', note: 'Cycle 2-4 weeks on, 2 weeks off to prevent tolerance buildup.' }
  ];
  if (name.includes('selank')) return [
    { label: 'WEEK 1-2', note: 'Anxiolytic effect begins within days. Mild drowsiness initial few days resolves quickly.' },
    { label: 'WEEK 3-4', note: 'Stress resilience improves. Sleep quality enhanced. No sedation or addiction risk.' },
    { label: 'WEEK 6-8', note: 'Pairs beautifully with Semax for calm-focused productivity. Cycle 2 weeks off.' }
  ];
  // Default
  return [
    { label: 'WEEK 1-2', note: 'Adaptation phase. Track any initial reactions. Mild side effects possible.' },
    { label: 'WEEK 3-4', note: 'Early effects become noticeable. Maintain consistent dosing schedule.' },
    { label: 'WEEK 6-8', note: 'Full therapeutic window. Peak benefits from the compound.' }
  ];
}

// ── Synergy + contraindication synthesis (used by Protocol Pack) ──────
function buildSynergies(knownItems) {
  const names = knownItems.map(i => {
    const c = lookupCompound(i.name || i.productName || '');
    return c ? c.name : '';
  }).filter(Boolean);
  const out = [];

  if (names.includes('BPC-157') && names.includes('TB-500'))
    out.push({ title: 'BPC-157 + TB-500', note: 'Classic full-spectrum healing stack. BPC-157 handles local repair, TB-500 drives systemic tissue regeneration.' });
  if (names.includes('CJC-1295 DAC') && names.includes('Ipamorelin'))
    out.push({ title: 'CJC-1295 + Ipamorelin', note: 'Amplified GH pulse — CJC raises baseline GHRH, Ipamorelin adds clean selective GH release with no cortisol spike.' });
  if (names.includes('GHK-Cu'))
    out.push({ title: 'GHK-Cu skin/repair signalling', note: 'Activates 4,000+ genes related to tissue remodelling. Complements healing stacks and GH protocols.' });
  if (names.includes('NAD+') && (names.includes('SS-31') || names.includes('MOTS-C')))
    out.push({ title: 'NAD+ + mitochondrial', note: 'Stacks for metabolic regeneration — NAD+ restores electron transport co-factor, SS-31/MOTS-C protect and bioenergise mitochondria directly.' });
  if ((names.includes('Semaglutide') || names.includes('Retatrutide')) && names.includes('AOD-9604'))
    out.push({ title: 'GLP-1 + AOD-9604', note: 'GLP-1 suppresses appetite + glucose, AOD-9604 directly mobilises fat without affecting IGF-1 axis.' });
  if (names.includes('Semax') && names.includes('Selank'))
    out.push({ title: 'Semax + Selank', note: 'Focus + calm — Semax for cognition and drive, Selank for anxiolytic balance. Neither is sedating; together they produce calm productivity.' });
  if (names.includes('KPV'))
    out.push({ title: 'KPV as safety peptide', note: 'Mitigates histamine-type reactions to other peptides. Include in any stack with a healing compound for robust gut + mast-cell support.' });

  if (out.length === 0) out.push({ title: 'Individual research', note: 'Compounds chosen for their individual research profile — see each attachment for full detail.' });
  return out;
}

function buildContraindications(knownItems) {
  const names = knownItems.map(i => {
    const c = lookupCompound(i.name || i.productName || '');
    return c ? c.name : '';
  }).filter(Boolean);
  const out = [];

  if (names.includes('Semaglutide') || names.includes('Retatrutide'))
    out.push('GLP-1 agonists: avoid in active pancreatitis, personal/family history of medullary thyroid carcinoma, or MEN-2. Titrate slowly to avoid nausea.');
  if (names.includes('NAD+'))
    out.push('NAD+: inject very slowly (3-5 min for 250mg) to prevent flushing/chest pressure. Do NOT push fast. Start at 50-100mg first 2-3 sessions.');
  if (names.includes('GHK-Cu'))
    out.push('GHK-Cu: burning sensation on injection is EXPECTED due to copper-peptide complex — this is not an allergy. Inject slowly over 30-60 seconds.');
  if (names.includes('CJC-1295 DAC') || names.includes('Ipamorelin'))
    out.push('GH secretagogues: empty stomach required (carbs blunt the GH pulse). Mild water retention first 2 weeks is normal and resolves.');
  if (names.includes('Kisspeptin'))
    out.push('Kisspeptin: pulsatile dosing only (2-3x/week). Continuous use paradoxically suppresses the HPG axis.');
  if (names.includes('Epitalon'))
    out.push('Epitalon: 10-day pulse cycles only — not continuous. Run at start of longevity cycle; repeat mid-cycle for advanced protocols.');
  if (names.includes('IGF-1 LR3'))
    out.push('IGF-1 LR3: 4-week pulses only. Hypoglycemia risk — never skip meals. Advanced users only.');

  if (out.length === 0) out.push('Follow each compound attachment for specific warnings. Start at the lower end of the dose range when in doubt.');
  out.push('For all peptides: refrigerate after reconstitution, use within 28 days, never inject cold solution straight from fridge.');
  return out;
}

// ════════════════════════════════════════════════════════════
// RENEWAL TRACKER
// ════════════════════════════════════════════════════════════

// GET /api/renewals — clients likely running low based on order date + typical supply
app.get('/api/renewals', async (req, res) => {
  try {
    const orders = await atGetAll(TABLES.ORDERS);
    const clients = await atGetAll(TABLES.CLIENTS);

    const clientMap = {};
    clients.forEach(c => { clientMap[c.id] = c.fields['Name'] || 'Unknown'; });

    const now = Date.now();
    const renewals = [];

    orders.forEach(o => {
      const f = o.fields;
      const orderDate = new Date(o.createdTime).getTime();
      const daysSince = Math.floor((now - orderDate) / 86400000);
      const clientId = Array.isArray(f['Client']) ? f['Client'][0] : f['Client'];
      const clientName = f['Client Name'] || clientMap[clientId] || 'Unknown';
      const items = f['Line Items'] || f['Products'] || '';
      const total = parseFloat(f['Final Total'] || f['Total'] || 0);

      // Flag orders 20-35 days old (likely running low on 30-day supply)
      // Flag orders 50-65 days old (running low on 60-day supply)
      let urgency = null;
      let daysUntilEmpty = null;
      if (daysSince >= 20 && daysSince <= 35) {
        urgency = 'FOLLOW_UP';
        daysUntilEmpty = 30 - daysSince;
      } else if (daysSince >= 50 && daysSince <= 65) {
        urgency = 'RUNNING_LOW';
        daysUntilEmpty = 60 - daysSince;
      } else if (daysSince > 65 && daysSince <= 90) {
        urgency = 'LIKELY_OUT';
        daysUntilEmpty = 0;
      }

      if (urgency) {
        renewals.push({
          orderId: o.id,
          clientName,
          clientId,
          orderDate: new Date(o.createdTime).toLocaleDateString('en-CA'),
          daysSince,
          daysUntilEmpty: Math.max(0, daysUntilEmpty),
          urgency,
          items: items.toString().substring(0, 120),
          total,
          status: f['Status'] || f['Fulfillment Status'] || 'Unknown'
        });
      }
    });

    // Sort: LIKELY_OUT first, then RUNNING_LOW, then FOLLOW_UP
    const urgencyOrder = { LIKELY_OUT: 0, RUNNING_LOW: 1, FOLLOW_UP: 2 };
    renewals.sort((a, b) => urgencyOrder[a.urgency] - urgencyOrder[b.urgency]);

    res.json({ renewals, count: renewals.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ════════════════════════════════════════════════════════════
// BLOODWORK RECEIVER + AI ANALYSIS
// ════════════════════════════════════════════════════════════

// POST /api/bloodwork/analyze — accepts bloodwork data, returns AI stack recommendations
app.post('/api/bloodwork/analyze', async (req, res) => {
  try {
    const { clientId, clientName, bloodwork, doctorNotes, currentStack, goals } = req.body;
    if (!bloodwork) return res.status(400).json({ error: 'Bloodwork data required' });

    const prompt = `You are LUKE, a peptide research assistant for Marc Papineau's research operation.

A client has submitted their bloodwork results. Analyze and return research-based recommendations.

CLIENT: ${clientName || 'Unknown'}
GOALS: ${(goals || []).join(', ') || 'Not specified'}
CURRENT STACK: ${currentStack || 'None'}
DOCTOR NOTES: ${doctorNotes || 'None provided'}

BLOODWORK RESULTS:
${typeof bloodwork === 'string' ? bloodwork : JSON.stringify(bloodwork, null, 2)}

Based on this bloodwork, provide:
1. KEY FINDINGS — what markers stand out (high, low, borderline)
2. RESEARCH IMPLICATIONS — what each finding suggests for peptide/compound research
3. RECOMMENDED STACK — specific compounds with doses and rationale, matched to findings
4. COMPOUNDS TO AVOID — anything contraindicated given these results
5. NUTRITIONAL RECOMMENDATIONS — macros, specific nutrients, foods to emphasize/avoid
6. CUSTOM MEAL PLAN OUTLINE — 3-day sample plan with macros aligned to goals and bloodwork
7. FOLLOW-UP MARKERS — what to retest in 60-90 days and why
8. FLAGS — anything requiring physician consultation before proceeding

IMPORTANT: All recommendations are for RESEARCH PURPOSES ONLY. Always include appropriate disclaimers. Never recommend compounds for conditions — frame as research protocols.

Return as structured JSON with keys: findings, implications, recommended_stack, avoid_list, nutritional_recommendations, meal_plan, followup_markers, flags, disclaimer.`;

    const aiRes = await fetch(LUKE_URL, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${LUKE_BEARER}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: LUKE_MODEL, max_tokens: 4000, messages: [{ role: 'user', content: prompt }] })
    });
    const aiData = await aiRes.json();
    let content = aiData.choices?.[0]?.message?.content || '{}';
    if (typeof content === 'string') {
      content = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    }
    let analysis;
    try { analysis = JSON.parse(content); } catch(e) { analysis = { raw: content }; }

    // Save to Airtable bloodwork table if clientId provided
    if (clientId) {
      try {
        await atFetch(TABLES.BLOODWORK, 'POST', {
          records: [{
            fields: {
              'Client': [clientId],
              'Analysis Date': new Date().toISOString().split('T')[0],
              'Raw Bloodwork': typeof bloodwork === 'string' ? bloodwork : JSON.stringify(bloodwork),
              'AI Analysis': JSON.stringify(analysis),
              'Status': 'Analyzed'
            }
          }]
        });
      } catch(e) { console.log('Bloodwork save warning:', e.message); }
    }

    res.json({ success: true, analysis, clientName, analyzedAt: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/bloodwork/:clientId — get bloodwork history for a client
app.get('/api/bloodwork/:clientId', async (req, res) => {
  try {
    const records = await atGetAll(TABLES.BLOODWORK,
      `FIND("${req.params.clientId}", ARRAYJOIN({Client Ref}))`);
    const history = records.map(r => ({
      id: r.id,
      date: r.fields['Date Drawn'] || r.fields['Date Reviewed'] || r.createdTime?.split('T')[0],
      status: r.fields['Status'] || 'Pending',
      summary: r.fields['Key Markers'] ? 'Analysis complete' : 'Pending analysis',
      followUp: r.fields['Follow-Up Notes'] || '',
      nextDate: r.fields['Next Bloodwork Date'] || ''
    }));
    res.json({ history });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ════════════════════════════════════════════════════════════
// DIET PLAN GENERATOR
// ════════════════════════════════════════════════════════════

// POST /api/generate-diet-plan — AI-powered nutrition plan synced to peptide stack
app.post('/api/generate-diet-plan', async (req, res) => {
  try {
    const { clientName, bodyWeight, goal, activityLevel, stack, timeline } = req.body;

    const userMessage = `
Nutrition Plan Request:
- Client: ${clientName || 'Anonymous'}
- Body Weight: ${bodyWeight || '?'} lbs
- Goal: ${goal || 'recomp'}
- Activity Level: ${activityLevel || 'moderate'}
- Current Peptide Stack: ${stack || 'None specified'}
- Timeline: ${timeline || '12 weeks'}

Please generate a comprehensive nutrition plan and return ONLY valid JSON with no markdown formatting.
    `.trim();

    const response = await fetch(LUKE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${LUKE_BEARER}`
      },
      body: JSON.stringify({
        model: LUKE_MODEL,
        messages: [
          {
            role: 'system',
            content: `You are LUKE, a research nutrition assistant for a peptide research company.
All outputs are FOR RESEARCH PURPOSES ONLY. Not medical or dietary advice.

Generate a detailed nutrition plan synced to the client's peptide research stack.

Return a JSON object with exactly these keys:
{
  "dailyCalories": number,
  "protein_g": number,
  "carbs_g": number,
  "fat_g": number,
  "mealTiming": "string describing when to eat relative to peptide injections and training",
  "sampleDays": [
    {
      "day": "Day 1",
      "meals": [
        { "time": "7:00 AM", "name": "Meal name", "foods": "food list", "calories": 400, "protein_g": 35 }
      ],
      "totalCalories": number,
      "totalProtein_g": number
    }
  ],
  "peptideSynergies": "How this nutrition plan synergizes with the peptide stack for enhanced results",
  "disclaimer": "For research purposes only. Not intended as medical or dietary advice."
}

sampleDays must contain exactly 3 days. Each day must have 4-6 meals/snacks.
Return ONLY valid JSON with no markdown formatting, no code blocks, no extra text.`
          },
          { role: 'user', content: userMessage }
        ],
        max_tokens: 3000
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Luke AI error ${response.status}: ${errText}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    const cleaned = content.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    let plan;
    try {
      plan = JSON.parse(cleaned);
    } catch {
      const match = cleaned.match(/\{[\s\S]+\}/);
      if (match) {
        plan = JSON.parse(match[0]);
      } else {
        throw new Error('Luke returned non-JSON response: ' + content.slice(0, 200));
      }
    }

    res.json(plan);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ════════════════════════════════════════════════════════════
// PROTOCOLS LIBRARY — serves the research DB
// ════════════════════════════════════════════════════════════

// GET /api/protocols-library — returns signature protocols + compound list from research DB
app.get('/api/protocols-library', (req, res) => {
  try {
    const fs = require('fs');
    const dbPath = path.join(__dirname, '..', 'research', 'luke_compound_database.json');
    const raw = fs.readFileSync(dbPath, 'utf8');
    const db = JSON.parse(raw);
    res.json({
      protocols: db.signature_protocols || [],
      compounds: (db.compounds || []).map(c => ({
        name: c.name,
        category: c.category,
        benefits: c.benefits || [],
        typical_dose: c.typical_dose,
        dose_frequency: c.dose_frequency,
        cycle_length: c.cycle_length,
        research_confidence: c.research_confidence,
        flags: c.flags || []
      }))
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ════════════════════════════════════════════════════════════
// STACK BUILDER
// ════════════════════════════════════════════════════════════

const { STACKS, DOSING, SCHEDULING_RULES, SUPPLY_CALC, calcSupply } = require('./data/stack-library.js');
const VitalisStacks = require('./data/vitalis-stacks.js');

// ── Dose-aware supply calculation ────────────────────────────
function calcSupplyDosed(compoundName, cycleWeeks, doseMultiplier) {
  // Try exact match first, then case-insensitive/trimmed fallback
  let rule = SUPPLY_CALC[compoundName];
  if (!rule) {
    const nameLower = compoundName.toLowerCase().trim();
    const key = Object.keys(SUPPLY_CALC).find(k => k.toLowerCase().trim() === nameLower);
    if (key) rule = SUPPLY_CALC[key];
  }
  if (!rule) return { units: 1, unit: 'vial', weeksPerVial: cycleWeeks, doseMcgPerInjection: null };
  const mult = doseMultiplier || 0.8;
  if (rule.pen) {
    const effectiveWeeksPerUnit = rule.weeksPerUnit / mult;
    const units = Math.ceil(cycleWeeks / effectiveWeeksPerUnit);
    return { units, unit: 'pen', weeksPerUnit: Math.round(effectiveWeeksPerUnit * 10) / 10, doseMultiplier: mult };
  }
  if (rule.oral) {
    const effectiveWeeksPerUnit = rule.weeksPerUnit / mult;
    const units = Math.ceil(cycleWeeks / effectiveWeeksPerUnit);
    return { units, unit: 'bottle', weeksPerUnit: Math.round(effectiveWeeksPerUnit * 10) / 10, doseMultiplier: mult };
  }
  if (rule.intranasal) {
    const effectiveWeeksPerVial = rule.weeksPerVial / mult;
    const units = Math.ceil(cycleWeeks / effectiveWeeksPerVial);
    return { units, unit: 'vial', weeksPerVial: Math.round(effectiveWeeksPerVial * 10) / 10, doseMultiplier: mult };
  }
  const effectiveWeeksPerVial = rule.weeksPerVial / mult;
  const units = Math.ceil(cycleWeeks / effectiveWeeksPerVial);
  const doseMcg = rule.doseMcg ? Math.round(rule.doseMcg * mult) : null;
  return {
    units,
    unit: 'vial',
    weeksPerVial: Math.round(effectiveWeeksPerVial * 10) / 10,
    doseMcgPerInjection: doseMcg,
    doseMultiplier: mult
  };
}

// ════════════════════════════════════════════════════════════
// SHARED COMPOUND INFO — used by both PDF endpoints
// ════════════════════════════════════════════════════════════

const COMPOUND_INFO = {
  'BPC-157':         {
    emoji: '🩹', tagline: 'Tissue & Gut Repair',
    notable: 'In animal studies, BPC-157 healed severed Achilles tendons faster than surgical repair alone — and reversed alcohol-induced stomach ulcers within 24 hours. It simultaneously upregulates nitric oxide pathways AND growth hormone receptors, making it one of the most multi-mechanism repair compounds in research.',
    benefit: 'BPC-157 is one of the most researched repair peptides available. It accelerates healing of tendons, ligaments, muscle, and gut lining by promoting angiogenesis. It also activates growth hormone receptors in tendon fibroblasts, dramatically speeding structural repair. For anyone on a GLP-1 protocol, BPC-157 protects the gut lining from inflammation and maintains motility.',
    reconstitute: ['Add 2mL BAC water to 5mg vial — swirl gently, do not shake.', 'Concentration: 2,500mcg/mL.', 'Inject 250mcg = 10 units on insulin syringe. Can inject near injury site.']
  },
  'TB-500':          {
    emoji: '💪', tagline: 'Systemic Healing',
    notable: 'TB-500 stimulates new blood vessel formation (angiogenesis) in cardiac tissue. Studies in heart attack models showed it reduced scar tissue and partially restored cardiac function post-infarction — making it the only healing peptide with published evidence of heart muscle repair.',
    benefit: 'TB-500 works throughout the entire body — not just at injection sites. It promotes systemic healing by upregulating actin, reduces inflammation system-wide, promotes flexibility, accelerates full-body recovery, and has shown cardiac tissue repair properties. The loading phase (2x/week for 4 weeks) saturates tissue, then maintenance continues the repair.',
    reconstitute: ['Add 2mL BAC water to 5mg vial. Swirl gently, do not shake.', 'Concentration: 2,500mcg/mL.', 'Standard dose: 2.5mg = 100 units (1mL) on insulin syringe.']
  },
  'GHK-Cu':          {
    emoji: '✨', tagline: 'Collagen & Anti-Aging',
    notable: 'GHK-Cu activates over 4,000 human genes — researchers call it a "master reset switch" for aging tissue. At age 60, your GHK-Cu levels are approximately 100x lower than at age 20. Published dermatology studies show topically applied GHK-Cu reduced fine wrinkles by 35% and increased skin thickness by 27%.',
    benefit: 'GHK-Cu activates over 4,000 repair genes including those responsible for collagen and elastin production, antioxidant defense, and skin quality restoration. As fat drops during a weight loss protocol, GHK-Cu prevents the deflated look by rebuilding the collagen matrix. Note: the burning sensation during injection is normal and expected — inject slowly.',
    reconstitute: ['Add 2mL BAC water to 5mg vial. Swirl gently.', 'Blue/green colour in vial is normal — copper peptide complex.', 'Inject very slowly — GHK-Cu causes a burning sensation that passes in 30-60 seconds.']
  },
  'KPV':             {
    emoji: '🌿', tagline: 'Inflammation Control',
    notable: 'KPV is just 3 amino acids — the smallest peptide on the list — yet research shows it can penetrate the gut epithelium intact and directly suppress NF-κB inflammation signalling inside intestinal cells. Oral delivery actually works for gut-specific effects, making it one of the only injectable peptides with a valid oral route for its primary target.',
    benefit: 'KPV directly inhibits NF-kB — the master switch of inflammation in the body. Unlike broad anti-inflammatories, KPV targets the specific inflammatory cascade that drives chronic inflammation. This makes it essential for clients on GLP-1 protocols where GI inflammation is common, those with autoimmune conditions, gut issues, or any protocol where inflammation must be precisely controlled.',
    reconstitute: ['Add 2mL BAC water to 5mg vial. Swirl gently.', 'Concentration: 2,500mcg/mL. 500mcg = 20 units.', 'Daily SubQ injection, preferably with or just before BPC-157.']
  },
  'Retatrutide':     {
    emoji: '🔥', tagline: 'Triple-Receptor Fat Loss',
    notable: 'Phase 2 trials (Nature Medicine, 2024) showed 24% body weight reduction over 48 weeks — surpassing semaglutide — AND 81% reduction in liver fat at 8mg over 24 weeks. No other compound approaches this magnitude of liver fat clearance. Retatrutide essentially reversed metabolic dysfunction-associated steatotic liver disease (MASLD) in trial participants. Phase 3 is ongoing.',
    benefit: 'Retatrutide is the most potent fat loss compound available, activating three receptor pathways simultaneously: GLP-1 (appetite suppression and insulin regulation), GIP (enhanced fat mobilization), and glucagon (thermogenesis and metabolic rate). Phase 2 clinical trials showed 24% body weight reduction and 81% liver fat clearance over 48 weeks. It requires careful titration starting at 2mg/week because the triple-receptor activation is powerful enough that too much too fast causes severe nausea.',
    reconstitute: ['Add 1mL BAC water to 10mg vial. Swirl gently.', 'Concentration: 10mg/mL. 2mg dose = 20 units on insulin syringe.', 'Start at 2mg/week and titrate: 2mg then 4mg then 6mg then 8mg over 5-10 weeks.']
  },
  'Semaglutide':     {
    emoji: '💉', tagline: 'GLP-1 Appetite Control',
    notable: 'Beyond weight loss: the SELECT cardiovascular outcomes trial (2023) showed semaglutide reduced major cardiovascular events by 20% in non-diabetic obese patients — the first weight loss compound to show independent heart protection. Emerging research also suggests GLP-1 receptors in the brain\'s reward centers may reduce addictive behaviors including alcohol and opioid cravings.',
    benefit: 'Semaglutide mimics the GLP-1 hormone to suppress appetite, slow gastric emptying, and stabilize blood sugar. It is the most clinically studied peptide for weight management with proven long-term results. The SELECT cardiovascular trial demonstrated a 20% reduction in major cardiac events independent of weight loss. Weekly dosing with gradual titration allows the body to adapt and minimizes nausea.',
    reconstitute: ['Vial: add 2mL BAC water. Swirl gently.', '0.25mg = 25 units on insulin syringe.', 'Once weekly SubQ injection, same day each week. Start at 0.25mg and titrate slowly.']
  },
  'CJC-1295 DAC':    {
    emoji: '⚡', tagline: 'Growth Hormone Optimization',
    notable: 'CJC-1295 DAC has an 8-day half-life — the longest of any GHRH analogue. A single injection on Monday is still affecting your pituitary\'s GH output the following Tuesday. This converts the pituitary into a slow-release GH device, producing a continuous natural pattern that no other compound replicates. ⚠️ IMPORTANT: Because doses stack week-over-week, sensitivity varies enormously. Always start low.',
    benefit: 'CJC-1295 DAC has an 8-day half-life meaning only one injection per week is needed to maintain elevated growth hormone levels. It works by stimulating the pituitary gland to release GH in a sustained natural pattern. Results: improved sleep quality, faster recovery, preservation of lean muscle while fat drops, and improved skin quality. When stacked with Ipamorelin, the synergy significantly amplifies GH output — which also amplifies side effects if dosed too aggressively.',
    reconstitute: [
      '⚠️ START LOW — sensitivity varies. Begin at 100-200mcg, not the full dose.',
      'Add 2mL BAC water to 2mg vial. Swirl gently. Concentration: 1,000mcg/mL.',
      'Week 1-2 (sensitivity test): 100-200mcg = 10-20 units.',
      'Week 3-4 (if well tolerated): 300-500mcg = 30-50 units.',
      'Experienced users: 500mcg-1mg = 50-100 units once weekly.',
      'Inject before bed on empty stomach — minimum 3 hours after eating.'
    ]
  },
  'Ipamorelin':      {
    emoji: '🌙', tagline: 'Clean GH Pulse',
    notable: 'Unlike every other GHRP (GHRP-2, GHRP-6, hexarelin), Ipamorelin produces zero cortisol or prolactin elevation at any dose tested. It is the only truly selective GH secretagogue with no hormonal collateral effects — research calls it the "cleanest" GHRP ever studied. ⚠️ When combined with CJC-1295 DAC, the synergistic GH output is significantly amplified — if CJC is already causing flush or BP elevation, adding Ipamorelin will intensify that effect.',
    benefit: 'Ipamorelin is the cleanest GHRP available — it produces a significant GH pulse without the cortisol spike or prolactin elevation other GHRPs cause. Taken nightly before bed on an empty stomach, it amplifies the natural GH pulse during deep sleep, maximizing overnight repair and recovery. The synergy with CJC-1295 DAC is powerful: CJC extends GH signal duration, Ipamorelin amplifies pulse amplitude. Note: when combining both, the GH output is substantially greater than either alone — users already sensitive to CJC should introduce Ipamorelin at minimum dose (100mcg) before increasing.',
    reconstitute: ['Add 2mL BAC water to 5mg vial. Swirl gently.', '200mcg = 8 units on insulin syringe. Start at 100mcg if combining with CJC-1295 DAC.', 'MUST be taken on empty stomach — minimum 2 hours after eating. Take immediately before bed.']
  },
  'NAD+':            {
    emoji: '⚡', tagline: 'Cellular Energy & DNA Repair',
    notable: 'Harvard\'s David Sinclair found that restoring NAD+ levels in aged mice reversed vascular aging to levels indistinguishable from young mice within weeks. NAD+ activates sirtuins — the longevity proteins that control DNA repair. Humans lose approximately 50% of their NAD+ between ages 40 and 60, which researchers now link directly to accelerated aging across every tissue type.',
    benefit: 'NAD+ is the fundamental currency of cellular energy and declines by approximately 50% between ages 40 and 60. Injectable NAD+ bypasses the gut for complete cellular replenishment. Once inside cells, NAD+ activates sirtuins — the enzymes responsible for DNA repair and cellular aging. The flushing during injection is a sign it is actively working. Inject extremely slowly over 3-5 minutes.',
    reconstitute: [
      '⚠️ FIRST-DOSE PROTOCOL — do not skip this step.',
      'Session 1-3: start at 25-50mg only. Your body needs to adapt to NAD+ flushing.',
      'Session 4-6: increase to 100mg once flushing is manageable.',
      'Established users: 250mg is the standard research dose.',
      'Add 5-10mL BAC water to 500mg vial. Swirl gently.',
      'Inject EXTREMELY slowly — 3-5 full minutes for a 250mg dose. Rushing causes intense flushing and nausea.',
      'Flushing, warmth, and tingling are NORMAL and expected. They peak at 5-15 minutes and fully resolve within 45 minutes.'
    ]
  },
  'Epitalon':        {
    emoji: '🧬', tagline: 'Telomere Support',
    notable: 'Epitalon is the only peptide shown to directly activate telomerase — the enzyme that maintains telomere length, the primary biomarker of cellular aging. Developed by Russian researcher Vladimir Khavinson over 35+ years of research, it is the most studied peptide bioregulator in existence. A single 10-day cycle triggers telomerase activation that outlasts the dosing period by months.',
    benefit: 'Epitalon is the only peptide shown to activate telomerase — the enzyme responsible for maintaining telomere length, the key biomarker of cellular aging. Short telomeres are associated with accelerated aging and cancer risk. Epitalon runs as a 10-day pulse cycle that triggers a sustained telomerase activation outlasting the dosing period.',
    reconstitute: ['Add 2mL BAC water to 10mg vial. Swirl gently.', '5mg dose = 50 units on insulin syringe.', 'Evening SubQ injection for 10 consecutive days, then stop. Repeat cycle in 3-6 months.']
  },
  'MOTS-C':          {
    emoji: '⚡', tagline: 'Mitochondrial Performance',
    notable: 'MOTS-C is a peptide encoded directly in mitochondrial DNA — not nuclear DNA like almost every other peptide. It is one of the first mitochondrial-derived peptides discovered, activating AMPK (the master cellular energy sensor) and dramatically improving insulin sensitivity. Studies show it can reverse obesity-related insulin resistance in animal models without dietary changes.',
    benefit: 'MOTS-C is a mitochondrial-derived peptide that activates AMPK — the master cellular energy switch. It dramatically improves insulin sensitivity, increases fat oxidation, and significantly improves endurance by optimizing how mitochondria produce ATP. It is alternated with SLU-PP-332 because both activate overlapping mitochondrial pathways — alternating prevents receptor downregulation.',
    reconstitute: ['Add 1mL BAC water to 10mg vial or use pen format.', '10mg dose = 100 units (1mL) on insulin syringe.', 'Alternate days with SLU-PP-332 — never take both on the same day.']
  },
  'SLU-PP-332':      {
    emoji: '🏃', tagline: 'Exercise Mimetic',
    notable: 'SLU-PP-332 activates ERR (estrogen-related receptor) pathways — the same cascade triggered by sustained aerobic exercise — producing measurable improvements in endurance and mitochondrial density without physical exertion. Researchers describe it as making the body "think" it just ran a marathon at the cellular level. It was specifically developed to study what exercise does to mitochondria.',
    benefit: 'SLU-PP-332 is an ERR agonist that activates the same mitochondrial biogenesis pathways triggered by intense aerobic exercise — dramatic improvements in endurance, fat oxidation, and mitochondrial density without the physical exertion. It must be alternated with MOTS-C on different days to prevent receptor desensitization.',
    reconstitute: ['Follow pen dial or vial reconstitution instructions per supplied guide.', 'Alternate days with MOTS-C — never take on the same day as MOTS-C.']
  },
  'SS-31':           {
    emoji: '🔋', tagline: 'Mitochondrial Protection',
    notable: 'SS-31 targets cardiolipin on the inner mitochondrial membrane — a structural lipid that collapses under oxidative stress and aging, causing mitochondria to lose efficiency. Studies in heart failure models showed SS-31 restored mitochondrial function and cardiac output in animals that had been in heart failure for months. It is being studied as a treatment for heart failure, kidney disease, and age-related muscle loss.',
    benefit: 'SS-31 targets the inner mitochondrial membrane directly, protecting cardiolipin — the structural lipid that maintains mitochondrial integrity and enables efficient energy production. It has shown remarkable results in cardiac function recovery. When taken 30-60 minutes before MOTS-C, it creates a powerful priming effect.',
    reconstitute: ['Add 2mL BAC water to 10mg vial. Swirl gently.', '5mg dose = 50 units on insulin syringe.', 'Take 30-60 minutes BEFORE MOTS-C on training days for maximum synergistic priming.']
  },
  '5-Amino 1MQ':     {
    emoji: '🧬', tagline: 'Fat Cell Metabolism',
    notable: '5-Amino 1MQ inhibits NNMT (nicotinamide N-methyltransferase) — an enzyme that becomes overactive in aging fat cells, locking them in a storage-only mode. Research shows NNMT inhibition not only reverses existing fat cell resistance to weight loss but prevents new fat cells from forming entirely. It is one of the only compounds that addresses why fat becomes harder to lose with age at the cellular level.',
    benefit: '5-Amino 1MQ inhibits NNMT — an enzyme that becomes overactive in fat cells as we age, putting them in a storage-only mode that resists weight loss. By inhibiting NNMT, it restores youthful fat cell metabolism, prevents new fat cell formation, and makes existing fat cells responsive to the energy deficit created by GLP-1 compounds.',
    reconstitute: ['Oral capsule — no reconstitution or injection needed.', 'Take daily with food for best absorption and tolerability.']
  },
  'Tesamorelin':     {
    emoji: '🎯', tagline: 'Visceral Fat Targeting',
    notable: 'Tesamorelin is FDA-approved (as Egrifta) for visceral fat reduction in HIV-associated lipodystrophy — making it one of the few peptides with an actual approved clinical indication. Studies show it specifically reduces visceral adipose tissue (VAT) — the metabolically dangerous abdominal fat that surrounds organs — with minimal effect on subcutaneous fat elsewhere.',
    benefit: 'Tesamorelin is a GHRH analogue with particularly strong affinity for visceral adipose tissue — the dangerous belly fat that surrounds organs and drives metabolic disease. It specifically targets this fat type, making it the compound of choice when abdominal fat is the primary target. Must alternate with CJC-1295 DAC on different days.',
    reconstitute: ['Add 2mL BAC water to vial. Swirl gently.', '1-2mg daily SubQ injection.', 'Alternate days with CJC-1295 DAC — do not take on the same day.']
  },
  'Thymosin Alpha-1':{
    emoji: '🛡️', tagline: 'Immune System Activation',
    notable: 'Thymosin Alpha-1 is approved as a prescription drug in 35+ countries (sold as Zadaxin) for hepatitis B, hepatitis C, and as a cancer immunotherapy adjuvant. It has more published human clinical trial data than almost any peptide on this list. Studies show it increases T-cell count and activity comparably to some chemotherapy support drugs — without the side effects.',
    benefit: 'Thymosin Alpha-1 is one of the most clinically studied immune-modulating peptides with extensive research in oncology and chronic viral infections. It directly activates T-cells and natural killer cells, enhancing the adaptive immune response. Essential for aging clients, post-illness recovery, or anyone with a compromised immune system.',
    reconstitute: ['Add 1mL BAC water to 5mg vial. Swirl gently.', '1.6mg = 32 units on insulin syringe.', 'SubQ injection 2-3x per week.']
  },
  'AOD-9604':        {
    emoji: '🔥', tagline: 'HGH Fat Fragment',
    notable: 'AOD-9604 is the C-terminal fragment of HGH (amino acids 176-191) — the specific sequence responsible for fat burning, completely isolated from the growth and insulin-resistance effects of full HGH. This means all the lipolytic benefit of growth hormone with none of the blood sugar impact. It was developed by Monash University specifically to separate HGH\'s fat-burning mechanism from its other actions.',
    benefit: 'AOD-9604 is the fat-metabolizing fragment of Human Growth Hormone — specifically the amino acid sequence responsible for triggering lipolysis without affecting blood sugar, insulin, or muscle growth. It works synergistically with all GLP-1 compounds by adding a direct fat-breakdown signal on top of appetite suppression.',
    reconstitute: ['Add 2mL BAC water to 5mg vial. Swirl gently.', '300mcg = 12 units on insulin syringe.', 'Fasted morning injection — do not eat for 30 minutes after.']
  },
  'PT-141':          {
    emoji: '❤️', tagline: 'Brain-Based Sexual Function',
    notable: 'A randomized double-blind trial published in the Journal of Urology (Safarinejad & Hosseini, 2008) tested PT-141 specifically in 342 men who had ALREADY FAILED Viagra. Result: significant improvement in erectile function scores in men for whom PDE5 inhibitors provided no benefit. This is the key finding — PT-141 doesn\'t just complement Viagra, it works through an entirely different pathway and succeeds where Viagra cannot.',
    benefit: 'PT-141 (bremelanotide) activates MC4R melanocortin receptors in the hypothalamus — the brain region governing sexual motivation and arousal. Unlike PDE5 inhibitors (Viagra, Cialis) which only increase blood flow, PT-141 works upstream at the source of desire itself. This is why it works for both men and women, for libido with psychological components, and critically — for men who have failed Viagra. Effects begin 45-60 minutes after administration and can last 6-12 hours. FDA-approved for women (as Vyleesi); used off-label in men. Common side effects: transient nausea (dose-dependent), flushing, mild blood pressure increase.',
    reconstitute: [
      'Add 2mL BAC water to 10mg vial. Swirl gently.',
      '⚠️ Start at 0.5mg (10 units) to assess nausea tolerance. Published effective dose is 1.75mg.',
      '0.5mg = 10 units | 1mg = 20 units | 1.75mg = 35 units on insulin syringe.',
      'SubQ injection 45-60 minutes before intended effect. Effects last 6-12 hours.',
      'Nausea is the most common side effect — take on a light stomach, not fully fasted or fully fed.'
    ]
  },
  'Kisspeptin':      {
    emoji: '⚡', tagline: 'HPG Axis Master Switch',
    notable: 'A 2025 study (Journal of Assisted Reproduction and Genetics) found kisspeptin levels in seminal plasma are measurably lower in infertile men than fertile men — proposing it as a new diagnostic biomarker for male infertility. Separately, pulsatile kisspeptin administration has been shown to restore LH pulsatility and endogenous testosterone in men with hypothalamic hypogonadism — restoring hormone production without suppressing the body\'s own system.',
    benefit: 'Kisspeptin is the master upstream signal of the entire HPG (hypothalamic-pituitary-gonadal) axis: Kisspeptin → GnRH → LH/FSH → Testosterone + Sperm Production. Rather than replacing hormones, it restores the brain\'s own signalling cascade. Research shows it can restore natural testosterone production in men with secondary hypogonadism and improve sperm quality in men with fertility issues. ⚠️ CRITICAL: Kisspeptin must be dosed in a pulsatile pattern — NOT continuously. Continuous administration paradoxically suppresses the HPG axis (same mechanism as GnRH agonists used to treat prostate cancer). Timing and frequency of doses are as important as the dose amount.',
    reconstitute: [
      'Add 2mL BAC water to 5mg vial. Swirl gently.',
      '⚠️ PULSATILE DOSING IS ESSENTIAL — do not dose daily without cycling.',
      'Research protocol: 50-100mcg per dose, 2-3x per week with rest days between.',
      '100mcg = 4 units on insulin syringe.',
      'SubQ injection. Allow 48h between doses to maintain receptor sensitivity.',
      'Continuous daily dosing will suppress — not restore — testosterone. Respect the pulse pattern.'
    ]
  },
  'Semax':           {
    emoji: '🧠', tagline: 'Focus & BDNF',
    notable: 'Semax has been used as a registered prescription drug in Russia and Ukraine for over 30 years for stroke rehabilitation and cognitive recovery — making it one of the most clinically tested nootropic peptides in existence. It elevates BDNF (brain-derived neurotrophic factor) within hours of a single dose — the same protein that antidepressants take 2-4 weeks to affect. It also increases NGF, the nerve growth factor responsible for maintaining neuron health.',
    benefit: 'Semax elevates BDNF — the brain\'s growth factor that drives neuroplasticity, learning, and memory consolidation. It also activates dopaminergic and noradrenergic signaling directly responsible for executive function and sustained attention. Intranasal delivery provides rapid CNS uptake. Run 2-4 week cycles to prevent receptor downregulation. Start at 100mcg and titrate up — some users are highly sensitive to its stimulating effects.',
    reconstitute: ['Intranasal spray — no injection needed.', '⚠️ Start at 100mcg (1 drop per nostril) before increasing to full dose.', '2-3 drops per nostril per dose at full dose. Tilt head slightly back.', 'Run 2-4 week cycles with 1-2 week breaks for best sustained effect.']
  },
  'Selank':          {
    emoji: '🧘', tagline: 'Calm Focus',
    notable: 'A Russian double-blind clinical trial showed Selank reduced generalized anxiety disorder symptoms as effectively as benzodiazepines — with none of the dependency, tolerance, or withdrawal. It works through the enkephalin system (the same pathway as opioids) but without addiction or sedation. No tapering required on discontinuation. Used as a registered drug in Russia and Ukraine.',
    benefit: 'Selank modulates GABA and serotonin to reduce anxiety and quiet racing thoughts — without sedation, dependency risk, or cognitive blunting. This is the grounding compound in cognitive stacks: Semax drives focus up, Selank keeps you centered without the edge. Pairs naturally with Semax for a calm/focused state.',
    reconstitute: ['Intranasal or SubQ — no injection required for nasal route.', '250mcg per dose as directed.', 'Can be taken same session as Semax for combined effect.']
  },
  'LL-37':           {
    emoji: '🛡️', tagline: 'Antimicrobial Defense',
    notable: 'LL-37 is a human cathelicidin — a natural antimicrobial peptide produced by neutrophils and epithelial cells as a first-line defense. Unlike antibiotics, it disrupts bacterial membranes physically, meaning bacteria cannot easily develop resistance. Research also shows LL-37 has anti-biofilm activity, making it effective against persistent infections that antibiotics cannot penetrate.',
    benefit: 'LL-37 is a human host-defense peptide providing direct antimicrobial activity against bacteria, fungi, and viruses. It is critical for wound healing, post-surgical infection prevention, and for clients with compromised barriers. Unlike antibiotics, LL-37 works via membrane disruption that pathogens cannot easily develop resistance to.',
    reconstitute: ['Add 2mL BAC water to vial. Swirl gently.', 'Follow prescribed dose. SubQ injection.']
  },
  'DSIP':            {
    emoji: '🌙', tagline: 'Deep Sleep Induction',
    notable: 'DSIP (Delta Sleep-Inducing Peptide) was originally isolated from rabbit brain tissue in 1977 during sleep research. It specifically triggers delta (slow-wave) sleep — the stage where human growth hormone is secreted, memories are consolidated, and cellular repair peaks. Research shows it normalizes disrupted sleep patterns and reduces stress-induced cortisol without sedative dependency.',
    benefit: 'DSIP specifically triggers delta (slow-wave) sleep stages — where physical repair, memory consolidation, and cognitive restoration occur. Many people with ADD or chronic stress spend too little time in delta sleep, compounding cognitive dysfunction and slowing physical recovery. The overnight repair effect means BPC-157 and SS-31 work harder when DSIP is in the protocol.',
    reconstitute: ['Add 2mL BAC water to vial. Swirl gently.', 'SubQ injection 20-30 minutes before bed.']
  },
  'P21':             {
    emoji: '🔬', tagline: 'Neurogenesis & Neuroprotection',
    notable: 'P21 is a CNTF (ciliary neurotrophic factor) analogue that stimulates the growth of new neurons — a process called neurogenesis — in the hippocampus and cortex. Animal studies show it reverses cognitive deficits in models of Alzheimer\'s and traumatic brain injury. It is one of the few compounds with published evidence of actual new neuron generation rather than just protecting existing ones.',
    benefit: 'P21 activates CNTF receptor pathways — triggering the growth of new neurons and protecting existing ones from damage. It has been studied for cognitive decline, memory improvement, and neuroprotection. When stacked with DSIP, P21 creates a powerful overnight protocol: DSIP triggers the deep sleep window, P21 activates neurogenesis during that repair window.',
    reconstitute: ['Add 1-2mL BAC water to vial. Swirl gently.', 'SubQ injection 2-3x per week. Can be taken evening alongside DSIP.']
  },
  'Pinealon':        {
    emoji: '🔮', tagline: 'Pineal & Circadian Optimization',
    notable: 'Pinealon is a tripeptide bioregulator (Ala-Glu-Asp-Gly) targeting the pineal gland — an organ that calcifies progressively from age 17 onward, reducing melatonin output and disrupting circadian signaling. Russian longevity researcher Vladimir Khavinson\'s work showed pineal bioregulators can slow this calcification process and partially restore melatonin rhythm in older adults, directly correlating with improved sleep quality scores.',
    benefit: 'Pinealon is a peptide bioregulator targeting the pineal gland and brain — responsible for melatonin production and circadian rhythm regulation. As the pineal gland calcifies with age, melatonin production drops and sleep quality deteriorates. Pinealon supports pineal function, restores melatonin balance, and helps re-synchronize the body clock.',
    reconstitute: ['Add 1mL BAC water to vial. Swirl gently.', 'SubQ injection before bed.']
  },
};

// Synergy notes — compound-to-compound relationship notes
function getCompoundSynergy(compoundName, allCompounds) {
  const hasGLP1   = allCompounds.some(c => ['Semaglutide','Retatrutide'].includes(c));
  const hasCJC    = allCompounds.includes('CJC-1295 DAC');
  const hasIpa    = allCompounds.includes('Ipamorelin');
  const hasMots   = allCompounds.includes('MOTS-C');
  const hasSlu    = allCompounds.includes('SLU-PP-332');
  const hasSS31   = allCompounds.includes('SS-31');
  const hasKlowComp = allCompounds.some(c => ['KPV','BPC-157','GHK-Cu','TB-500'].includes(c));

  if (compoundName === 'BPC-157' && hasGLP1)
    return 'Protects gut lining from GLP-1-related inflammation — essential when Retatrutide or Semaglutide is in the stack. As GLP-1 slows gastric motility, BPC-157 prevents the resulting gut irritation and maintains the mucosal barrier.';
  if (compoundName === 'CJC-1295 DAC' && hasIpa)
    return 'Together with Ipamorelin, these create a synergistic GH pulse — CJC-1295 DAC extends the duration of GH signal at the pituitary, while Ipamorelin amplifies the pulse amplitude. The combination produces significantly higher GH output than either alone.';
  if (compoundName === 'Ipamorelin' && hasCJC)
    return 'Working in tandem with CJC-1295 DAC, Ipamorelin delivers a clean, amplified GH pulse with no cortisol or prolactin side effects. CJC provides the sustained signal; Ipamorelin provides the sharp peak. Taken together before bed for maximum overnight GH release.';
  if (compoundName === 'MOTS-C' && hasSlu)
    return 'Alternates every 3 months with SLU-PP-332 for maximum mitochondrial adaptation — MOTS-C activates AMPK for weeks 1-12, then SLU-PP-332 takes over via ERR pathways for weeks 13+. This prevents receptor downregulation and keeps the mitochondrial stimulus fresh.';
  if (compoundName === 'SLU-PP-332' && hasMots)
    return 'Alternates with MOTS-C to deliver continuous mitochondrial optimization without receptor fatigue — SLU-PP-332 via ERR signaling during the off-cycle from MOTS-C. Together they cover the full spectrum of mitochondrial biogenesis pathways.';
  if (compoundName === 'SS-31' && (hasMots || hasSlu))
    return 'SS-31 runs as a mitochondrial primer — taken 30-60 minutes before MOTS-C, it restores inner mitochondrial membrane integrity so that when MOTS-C activates AMPK, it finds a fully functional mitochondrial system ready to respond.';
  if (['KPV','GHK-Cu','TB-500'].includes(compoundName) && hasKlowComp)
    return 'Works within the KLOW foundational healing layer to create a comprehensive repair environment — KPV controls inflammation, BPC-157 drives local repair, GHK-Cu rebuilds the collagen matrix, and TB-500 provides systemic healing throughout the body.';
  if (hasSS31 && !['SS-31','MOTS-C','SLU-PP-332'].includes(compoundName))
    return 'SS-31 runs as a 4-week mitochondrial primer at the start of this protocol, establishing optimal cellular energy production before this compound begins at week 5.';
  return compoundName + ' works synergistically with the other compounds in this stack to amplify overall results — each compound addresses a distinct mechanism while the stack as a whole creates compounding benefits.';
}

// ── Compound Pricing Reference Map (from Airtable PRODUCTS) ──
const COMPOUND_PRICING = {
  'Semaglutide':      { sku: 'PEN-SEMA',               msrp: 210,  unit: 'pen',    unitsPerPack: 1,  weeksSupply: 4   },
  'Retatrutide':      { sku: 'RETA-10MG-BOX10',         msrp: 1900, unit: 'box',    unitsPerPack: 10, weeksSupply: 50  },
  'Retatrutide-pen':  { sku: 'PEN-RETA-BESTVAL',        msrp: 700,  unit: 'pen',    unitsPerPack: 1,  weeksSupply: 5   },
  'CJC-1295 DAC':     { sku: 'CJC-1295-DAC-5MG',       msrp: 450,  unit: 'vial',   unitsPerPack: 1,  weeksSupply: 5   }, // 5mg vial confirmed by Marc
  'Ipamorelin':       { sku: 'IPA-5MG-BOX10',           msrp: 500,  unit: 'box',    unitsPerPack: 10, weeksSupply: 35.7 },
  'CJC+Ipa combo':    { sku: 'COMBO-CJC5-IPA5-BOX10',   msrp: 800,  unit: 'box',    unitsPerPack: 10, weeksSupply: 20  },
  'BPC-157':          { sku: 'BPC-157-5MG-BOX10',       msrp: 600,  unit: 'box',    unitsPerPack: 10, weeksSupply: 114 },
  'BPC-157-pen':      { sku: 'PEN-BPC157',              msrp: 275,  unit: 'pen',    unitsPerPack: 1,  weeksSupply: 4   },
  'TB-500':           { sku: 'TB500-5MG-BOX10',         msrp: 500,  unit: 'box',    unitsPerPack: 10, weeksSupply: 100 },
  'TB-500-pen':       { sku: 'PEN-TB500',               msrp: 290,  unit: 'pen',    unitsPerPack: 1,  weeksSupply: 4   },
  'GHK-Cu':           { sku: 'GHK-CU-50MG-BOX10',      msrp: 600,  unit: 'box',    unitsPerPack: 10, weeksSupply: 125 },
  'KPV':              { sku: 'KPV-5MG-BOX10',           msrp: 500,  unit: 'box',    unitsPerPack: 10, weeksSupply: 143 },
  'KPV-pen':          { sku: 'PEN-AC-KPV-NH2',          msrp: 230,  unit: 'pen',    unitsPerPack: 1,  weeksSupply: 4   },
  // KLOW as a single product (pen or freeze-dried) — pricing TBD by Marc
  'KLOW-pen':          { sku: 'KLOW-PEN',               msrp: 0,    unit: 'pen',  unitsPerPack: 1, weeksSupply: 4, note: 'Pen format NOT available — use freeze-dried', discontinued: true },
  'KLOW-fd':           { sku: 'KLOW-FD',                msrp: 2050, unit: 'vial', unitsPerPack: 10, weeksSupply: 4.33, note: 'Biogenix freeze-dried. $900/box of 10 vials ($90/vial cost). MSRP $2,050/box ($205/vial). 1 vial = 1 month supply.' },
  // KLOW individual components (when client selects "Individual Products")
  'KLOW-ind-tb-bpc':   { sku: 'PEN-TB500-BPC157',      msrp: 290,  unit: 'pen',  unitsPerPack: 1, weeksSupply: 4  },
  'KLOW-ind-kpv':      { sku: 'PEN-AC-KPV-NH2',        msrp: 230,  unit: 'pen',  unitsPerPack: 1, weeksSupply: 4  },
  'KLOW-ind-ghk':      { sku: 'PEN-SKINGLOW-GHK30',    msrp: 220,  unit: 'pen',  unitsPerPack: 1, weeksSupply: 4  },
  'NAD+':             { sku: 'NAD-500MG-BOX10',         msrp: 800,  unit: 'box',    unitsPerPack: 10, weeksSupply: 56  },
  'MOTS-C':           { sku: 'PEN-MOTSC',               msrp: 210,  unit: 'pen',    unitsPerPack: 1,  weeksSupply: 3   },
  'SLU-PP-332':       { sku: 'SLUP332-50CT-500MCG',     msrp: 155,  unit: 'bottle', unitsPerPack: 1,  weeksSupply: 3   },
  'SS-31':            { sku: 'SS31-10MG-BOX10',         msrp: 800,  unit: 'box',    unitsPerPack: 10, weeksSupply: 67  },
  '5-Amino 1MQ':      { sku: 'PEN-5AMINO-1MG',          msrp: 300,  unit: 'pen',    unitsPerPack: 1,  weeksSupply: 4   },
  'Epitalon':         { sku: 'EPITALON-10MG-BOX10',     msrp: 450,  unit: 'box',    unitsPerPack: 10, weeksSupply: 29  },
  'Tesamorelin':      { sku: 'TESA-5MG-BOX10',          msrp: 1000, unit: 'box',    unitsPerPack: 10, weeksSupply: 36  },
  'Tesamorelin-pen':  { sku: 'PEN-TESA-5MG',            msrp: 210,  unit: 'pen',    unitsPerPack: 1,  weeksSupply: 4   },
  'Thymosin Alpha-1': { sku: 'TA1-5MG-BOX10',           msrp: 675,  unit: 'box',    unitsPerPack: 10, weeksSupply: 156 },
  'LL-37':            { sku: 'LL37-5MG-BOX10',          msrp: 800,  unit: 'box',    unitsPerPack: 10, weeksSupply: null },
  'PT-141':           { sku: 'PT141-10MG-BOX10',        msrp: 520,  unit: 'box',    unitsPerPack: 10, weeksSupply: 286 },
  'Kisspeptin':       { sku: 'KISS-5MG-BOX10',          msrp: 1000, unit: 'box',    unitsPerPack: 10, weeksSupply: null },
  'Melanotan-2':      { sku: 'MT2-5MG-BOX10',           msrp: 500,  unit: 'box',    unitsPerPack: 10, weeksSupply: null },
  'AOD-9604':         { sku: 'AOD-9604-5MG-BOX10',      msrp: 560,  unit: 'box',    unitsPerPack: 10, weeksSupply: 238 },
  'Semax':            { sku: 'SEMAX-5MG-BOX10',         msrp: 570,  unit: 'box',    unitsPerPack: 10, weeksSupply: 40  },
};

app.get('/api/stack-library', (req, res) => {
  const publicStackIds = [
    'fat-loss',
    'anti-aging',
    'athletics',
    'injury-recovery',
    'bodybuilding',
    'metabolic-health',
    'mental-performance',
    'immune-defense',
    'libido-hormonal',
    'add-protocol'
  ];
  res.json({
    stacks: STACKS.filter(s => publicStackIds.includes(s.id)),
    scheduling: SCHEDULING_RULES
  });
});

app.post('/api/stack-builder', (req, res) => {
  const { stackId, tier, dosingLevel, cycleWeeks, customAddons, klowFormat, customRemovals, customAdditions } = req.body;
  const stack = STACKS.find(s => s.id === stackId);
  if (!stack) return res.status(404).json({ error: 'Stack not found' });

  const tierData = stack.tiers[tier];
  if (!tierData) return res.status(404).json({ error: 'Tier not found' });

  const rawDosing = tierData.dosing[dosingLevel] || {};
  // Merge base compounds with any custom add-ons from the client
  const baseCompounds = tierData.compounds;
  const extras = Array.isArray(customAddons) ? customAddons.filter(c => !baseCompounds.includes(c)) : [];
  // Feature 2: apply session-only custom removals/additions
  const removals  = Array.isArray(customRemovals)  ? customRemovals  : [];
  const additions = Array.isArray(customAdditions) ? customAdditions : [];
  let compounds = [...baseCompounds, ...extras]
    .filter(c => !removals.some(r => c === r || (c.startsWith('KLOW') && r === 'KLOW')));
  additions.forEach(a => { if (!compounds.includes(a)) compounds.push(a); });

  // Dose multipliers affect how quickly compounds are consumed
  const doseMultipliers = { low: 0.6, mid: 0.8, high: 1.0 };
  const doseMultiplier = doseMultipliers[dosingLevel] || 0.8;

  const weeks = cycleWeeks || tierData.cycleWeeks;
  const supplyList = compounds.map(name => {
    if (name.startsWith('KLOW')) {
      if (klowFormat === 'fd') {
        const vials = Math.ceil(weeks / (4 / doseMultiplier));
        return [{ name: 'KLOW Blend (FD)', units: vials, unit: 'vial', weeksPerVial: Math.round((4 / doseMultiplier) * 10) / 10, note: '10mg BPC-157 / 10mg TB-500 / 10mg KPV / 50mg GHK-Cu per vial' }];
      }
      return [
        { name: 'KPV',     ...calcSupplyDosed('KPV',     weeks, doseMultiplier) },
        { name: 'BPC-157', ...calcSupplyDosed('BPC-157', weeks, doseMultiplier) },
        { name: 'GHK-Cu',  ...calcSupplyDosed('GHK-Cu',  weeks, doseMultiplier) },
        { name: 'TB-500',  ...calcSupplyDosed('TB-500',  weeks, doseMultiplier) }
      ];
    }
    return [{ name, ...calcSupplyDosed(name, weeks, doseMultiplier) }];
  }).flat();

  // Build per-compound benefit cards for client-facing breakdown
  const COMPOUND_BENEFITS = {
    'KLOW (KPV + BPC-157 + GHK-Cu + TB-500)': { emoji: '🟢', tagline: 'The Foundational Healing Layer', why: 'Marc\'s foundational healing blend. KPV controls inflammation, BPC-157 repairs tissue and gut, GHK-Cu rebuilds collagen and activates repair genes, TB-500 provides systemic healing throughout the body. Available as: Individual vials (best value, 1 needle each) or 3 pens (TB-500+BPC-157 combo pen, KPV pen, GHK-Cu pen — more convenient but 3 injections and higher cost per mg).' },
    'KPV':              { emoji: '🌿', tagline: 'Inflammation Control', why: 'Directly inhibits NF-κB — the master switch of inflammation. Protects the gut from GLP-1 side effects, reduces systemic inflammation, and creates the clean environment where all other compounds work better.' },
    'BPC-157':          { emoji: '🩹', tagline: 'Tissue & Gut Repair', why: 'Accelerates healing of tendons, ligaments, muscle, and gut lining. Promotes new blood vessel growth to injured areas. One of the most researched repair peptides available.' },
    'GHK-Cu':           { emoji: '✨', tagline: 'Collagen & Anti-Aging', why: 'Activates over 4,000 repair genes. Stimulates collagen and elastin production. As fat drops, this compound protects skin quality and prevents the "deflated" look.' },
    'TB-500':           { emoji: '💪', tagline: 'Systemic Healing', why: 'Works throughout the entire body — not just at injection sites. Promotes flexibility, reduces inflammation, supports cardiac tissue, and accelerates full-body recovery.' },
    'Retatrutide':      { emoji: '🔥', tagline: 'Triple-Receptor Fat Loss', why: 'The most potent GLP-1 available. Activates GLP-1, GIP, and glucagon receptors simultaneously — driving appetite suppression, fat mobilization, and metabolic rate increase all at once.' },
    'Semaglutide':      { emoji: '💉', tagline: 'GLP-1 Appetite Control', why: 'Mimics the GLP-1 hormone to suppress appetite and stabilize blood sugar. The most clinically studied weight loss peptide. Simple once-weekly injection.' },
    'CJC-1295 DAC':     { emoji: '⚡', tagline: 'Growth Hormone Optimization', why: 'Stimulates the pituitary gland to release GH in natural pulses. 8-day half-life means once-weekly dosing. Preserves lean muscle while fat drops, improves sleep quality and recovery.' },
    'Ipamorelin':       { emoji: '🌙', tagline: 'Clean GH Pulse', why: 'The cleanest GHRP available — no cortisol spike, no prolactin elevation. Taken nightly before bed, it amplifies the natural GH pulse during deep sleep, maximizing repair and recovery.' },
    'MOTS-C':           { emoji: '⚡', tagline: 'Mitochondrial Performance', why: 'Activates AMPK — the cellular energy switch. Improves insulin sensitivity, increases fat oxidation, and dramatically improves endurance. Alternates with SLU-PP-332 for maximum mitochondrial output.' },
    'SLU-PP-332':       { emoji: '🏃', tagline: 'Exercise Mimetic', why: 'Activates the same pathways as intense exercise at the mitochondrial level. More VO2, more fat burned, more power output. Alternates with MOTS-C — do not take same day.' },
    '5-Amino 1MQ':      { emoji: '🧬', tagline: 'Fat Cell Metabolism', why: 'Inhibits NNMT — an enzyme that makes fat cells resistant to weight loss. Restores youthful metabolic rate, prevents new fat cell formation, and supercharges the fat loss from GLP-1s.' },
    'SS-31':            { emoji: '🔋', tagline: 'Mitochondrial Protection', why: 'Targets mitochondria directly. Protects cellular energy production from oxidative stress. Take 30-60 min before MOTS-C for synergistic mitochondrial priming. Critical for longevity and cardiac health.' },
    'NAD+':             { emoji: '⚡', tagline: 'Cellular Energy & DNA Repair', why: 'The fundamental currency of cellular energy. Declines 50% between age 40-60. Injectable NAD+ bypasses digestion for full cellular replenishment. Activates sirtuins for DNA repair and anti-aging.' },
    'Epitalon':         { emoji: '🧬', tagline: 'Telomere Support', why: 'The only peptide shown to activate telomerase — the enzyme that maintains telomere length. Run as a 10-day pulse cycle. The cornerstone of aggressive longevity protocols.' },
    'Tesamorelin':      { emoji: '🎯', tagline: 'Visceral Fat Targeting', why: 'Specifically targets visceral (belly) fat — the most dangerous and stubborn fat type. Stimulates GH release with particular affinity for abdominal adipose tissue. Alternate days with CJC-1295.' },
    'AOD-9604':         { emoji: '🔥', tagline: 'HGH Fragment Fat Loss', why: 'The fat-metabolizing fragment of HGH, without the muscle-building effects. Directly stimulates fat breakdown without affecting blood sugar. Synergistic with all GLP-1 compounds.' },
    'Thymosin Alpha-1': { emoji: '🛡️', tagline: 'Immune System Activation', why: 'Activates T-cells and natural killer cells. Clinically studied for immune modulation. Essential for aging clients, post-illness recovery, and anyone with compromised immunity.' },
    'LL-37':            { emoji: '🛡️', tagline: 'Antimicrobial Defense', why: 'Human-derived antimicrobial peptide. Critical for wound healing, post-surgical infection prevention, and immune defense against bacteria, fungi, and viruses.' },
    'PT-141':           { emoji: '❤️', tagline: 'Libido & Arousal', why: 'Works directly on brain reward circuitry — unlike PDE5 inhibitors which only affect circulation. Influences desire and motivation in both men and women. Use 45-60 min before intended effect.' },
    'Kisspeptin':       { emoji: '⚡', tagline: 'Hormone Cascade Trigger', why: 'The upstream signal that triggers LH, FSH, and ultimately testosterone production. Restores the body\'s own hormonal signaling without replacing hormones.' },
    'Semax':            { emoji: '🧠', tagline: 'Focus, BDNF & Dopamine', why: 'Elevates BDNF — the brain\'s growth factor. Improves working memory, processing speed, and executive function. Particularly effective for ADD/ADHD: activates dopaminergic and noradrenergic pathways that regulate attention and impulse control. Intranasal delivery for fast CNS uptake.' },
    'Selank':           { emoji: '🧘', tagline: 'Calm Focus — No Sedation', why: 'Modulates GABA and serotonin to quiet the anxiety and racing thoughts that shatter sustained attention. The key difference from medications: no sedation, no dependency, no withdrawal. Pairs with Semax — Semax drives up, Selank keeps you grounded in the zone.' },
    'DSIP':             { emoji: '🌙', tagline: 'Deep Sleep Induction', why: 'Delta Sleep-Inducing Peptide. ADD brains frequently have disrupted slow-wave sleep — fixing this is non-negotiable for focus recovery. DSIP triggers deep restorative sleep where memory consolidation and emotional regulation reset. Take SubQ 20–30 min before bed.' },
    'P21':              { emoji: '🔬', tagline: 'Neurogenesis & CNTF Signaling', why: 'Activates CNTF receptor pathways for the growth of new neurons and protection of existing ones. Studied for cognitive improvement, memory, and long-term brain health. The "overnight repair" compound — pairs with DSIP for a powerful nighttime neuroplasticity protocol.' },
    'P21':              { emoji: '🧠', tagline: 'Neuroprotection', why: 'Activates CNTF receptor pathways for neuroprotection and neurogenesis. Studied for cognitive decline, memory improvement, and long-term brain health.' },
    'Melanotan-2':      { emoji: '☀️', tagline: 'Tanning & Libido', why: 'Activates melanocortin receptors for natural tanning and UV protection. Secondary effect: libido enhancement. Popular add-on for clients wanting multiple benefits from one compound.' },
    'DSIP':             { emoji: '🌙', tagline: 'Deep Sleep Induction', why: 'Delta Sleep-Inducing Peptide — triggers the deep slow-wave sleep stages where cognitive repair and memory consolidation happen. Take before bed. The overnight partner to Semax and Selank during the day.' },
    'P21':              { emoji: '🧠', tagline: 'Neurogenesis & Neuroprotection', why: 'Activates CNTF receptor pathways — triggers the growth of new neurons and protects existing ones from damage. Studied for memory improvement, cognitive decline, and brain fog. SubQ 2–3x/week, pairs perfectly with DSIP for overnight brain repair.' },
    'Pinealon':         { emoji: '🔮', tagline: 'Pineal & Circadian Optimization', why: 'Peptide bioregulator specifically targeting the brain and pineal gland. Helps regulate melatonin balance, circadian rhythm, and sleep architecture. Particularly effective for aging clients where pineal function has declined. Take before bed.' },
    'AOD-9604':         { emoji: '🔥', tagline: 'HGH Fragment Fat Loss', why: 'The fat-metabolizing fragment of HGH, without the muscle-building or blood sugar effects. Directly stimulates fat breakdown. Synergistic with all GLP-1 compounds. Fasted morning injection.' },
  };

  const compoundBreakdown = compounds.map(name => {
    const isKlow = name.startsWith('KLOW');
    if (isKlow) {
      return {
        name: 'KLOW — Foundational Healing Blend',
        isBundle: true,
        emoji: '🟢',
        tagline: 'The Foundational Healing Layer',
        why: tierData.klowNote || COMPOUND_BENEFITS['KLOW (KPV + BPC-157 + GHK-Cu + TB-500)']?.why || '',
        bundleContains: ['KPV', 'BPC-157', 'GHK-Cu', 'TB-500'].map(k => ({
          name: k,
          ...COMPOUND_BENEFITS[k]
        }))
      };
    }
    return { name, isBundle: false, ...(COMPOUND_BENEFITS[name] || { emoji: '🧬', tagline: name, why: '' }) };
  });

  // Bug 4 fix: fill empty dosing gaps from DOSING master reference
  const dosingDisplay = {};
  compounds.forEach(name => {
    if (name.startsWith('KLOW')) {
      if (klowFormat === 'fd') {
        // KLOW FD vial: show single combined entry reflecting actual vial ratios
        dosingDisplay['KLOW Blend (FD)'] = '1 vial: 10mg BPC-157 / 10mg TB-500 / 10mg KPV / 50mg GHK-Cu — reconstitute per schedule';
      } else {
        // Expand KLOW bundle into individual compound doses
        ['KPV', 'BPC-157', 'GHK-Cu', 'TB-500'].forEach(k => {
          if (rawDosing[k]) {
            dosingDisplay[k] = rawDosing[k];
          } else if (DOSING[k] && DOSING[k][dosingLevel]) {
            dosingDisplay[k] = DOSING[k][dosingLevel].dose;
          }
        });
      }
    } else if (rawDosing[name]) {
      dosingDisplay[name] = rawDosing[name];
    } else if (DOSING[name] && DOSING[name][dosingLevel]) {
      dosingDisplay[name] = DOSING[name][dosingLevel].dose;
    }
  });

  // Feature 1: Format Options (compounds with both pen + vial variants)
  // Also expand KLOW into its sub-compounds when klowFormat === 'individual' so each gets a picker
  const formatOptions = {};
  const effectiveCompounds = [];
  compounds.forEach(name => {
    if (name.startsWith('KLOW') && klowFormat === 'individual') {
      ['KPV', 'BPC-157', 'GHK-Cu', 'TB-500'].forEach(k => effectiveCompounds.push(k));
    } else {
      effectiveCompounds.push(name);
    }
  });
  effectiveCompounds.forEach(name => {
    if (name.startsWith('KLOW')) return; // skip non-individual KLOW bundles
    const hasPen  = COMPOUND_PRICING[name + '-pen'];
    const hasVial = COMPOUND_PRICING[name];
    if (hasPen && hasVial) formatOptions[name] = ['vial', 'pen'];
  });

  // Feature 3: MOTS-C / SLU-PP-332 alternating scheduling note
  const flatNames = compounds.map(c => c.startsWith('KLOW') ? 'KLOW' : c);
  const hasMoTS   = flatNames.includes('MOTS-C');
  const hasSLU    = flatNames.includes('SLU-PP-332');
  const finalSchedulingNotes = [...(tierData.schedulingNotes || [])];
  if (hasMoTS && hasSLU && !finalSchedulingNotes.some(n => n.includes('week 13'))) {
    finalSchedulingNotes.push('⚡ MOTS-C: Weeks 1–12. SLU-PP-332: Start week 13. Alternate every 3 months for maximum mitochondrial adaptation.');
  }

  // Feature 4: SS-31 as 4-week mitochondrial primer
  const hasSS31       = compounds.includes('SS-31');
  const ss31PrimerMode = hasSS31;
  if (hasSS31 && !finalSchedulingNotes.some(n => n.includes('primer'))) {
    finalSchedulingNotes.push('🔋 SS-31: Run weeks 1–4 as mitochondrial primer. All other compounds begin week 5.');
  }

  // Feature 5: Marc's Recommendations
  const marcRecommendations = [];
  const hasKlowBundle   = compounds.some(c => c.startsWith('KLOW'));
  const hasBPC          = flatNames.includes('BPC-157');
  const hasTB500        = flatNames.includes('TB-500');
  const hasKPV          = flatNames.includes('KPV');
  const hasGHKCu        = flatNames.includes('GHK-Cu');
  const hasKlow         = flatNames.includes('KLOW') || hasKlowBundle;

  // Rule 1: BPC-157 alone (not with TB-500, not inside KLOW bundle)
  if (hasBPC && !hasTB500 && !hasKlow) {
    marcRecommendations.push('BPC-157 works significantly better paired with TB-500. More cost-effective and superior healing benefits. Consider adding TB-500 to this stack.');
  }

  // Rule 2: Any individual healing compound → recommend KLOW bundle
  // (only if they are NOT already using KLOW and are using any of the 4 healing compounds individually)
  const healingCompoundsPresent = (hasBPC || hasTB500 || hasKPV || hasGHKCu) && !hasKlow;
  if (healingCompoundsPresent) {
    marcRecommendations.push('If you\'re using healing peptides, KLOW (KPV + BPC-157 + GHK-Cu + TB-500) combines all 4 in one freeze-dried vial at $205/vial ($2,050/box of 10) — more cost-effective and convenient than ordering individually.');
  }

  res.json({
    stack:             { id: stack.id, goal: stack.goal, emoji: stack.emoji, description: stack.description, tagline: stack.tagline },
    tier:              tierData.label,
    tierDescription:   tierData.description,
    klowNote:          tierData.klowNote || null,
    dosingLevel,
    cycleWeeks:        cycleWeeks || tierData.cycleWeeks,
    compounds,
    compoundBreakdown,
    dosing:            dosingDisplay,
    supplyList,
    schedulingNotes:   finalSchedulingNotes,
    addOns:            stack.addOns || [],
    formatOptions,
    ss31PrimerMode,
    primerWeeks:       hasSS31 ? 4 : 0,
    marcRecommendations
  });
});

// ── Stack Pricing ─────────────────────────────────────────────
app.post('/api/stack-pricing', (req, res) => {
  const { stackId, tier, dosingLevel, cycleWeeks, klowFormat, compoundFormats } = req.body;
  const stack = STACKS.find(s => s.id === stackId);
  if (!stack) return res.status(404).json({ error: 'Stack not found' });

  const tierData = stack.tiers[tier];
  if (!tierData) return res.status(404).json({ error: 'Tier not found' });

  const dosing = tierData.dosing[dosingLevel] || {};
  const compounds = tierData.compounds;
  const fmt = klowFormat || 'fd'; // 'fd', 'pen' (discontinued), or 'individual'

  // Flatten KLOW bundles based on selected format
  const allCompounds = [];
  compounds.forEach(c => {
    if (c.startsWith('KLOW')) {
      if (fmt === 'pen') {
        allCompounds.push('__KLOW_PEN__');
      } else if (fmt === 'fd') {
        allCompounds.push('__KLOW_FD__');
      } else {
        // individual — price each compound separately
        ['KPV', 'BPC-157', 'TB-500', 'GHK-Cu'].forEach(k => allCompounds.push(k));
      }
    } else {
      allCompounds.push(c);
    }
  });

  const weeks = cycleWeeks || tierData.cycleWeeks;
  const months = weeks / 4.33;

  // Build per-compound pricing breakdown
  const breakdown = allCompounds.map(compoundName => {
    // Handle KLOW format variants
    if (compoundName === '__KLOW_PEN__') {
      const pricing = COMPOUND_PRICING['KLOW-pen'];
      const weeksPerUnit = pricing.weeksSupply || 4;
      const unitsNeeded = Math.ceil(weeks / weeksPerUnit);
      if (!pricing.msrp || pricing.msrp === 0) {
        return { name: 'KLOW Pen (All 4 compounds)', sku: pricing.sku, unit: 'pen', pricePerUnit: 0, unitsNeeded, weeksPerUnit, totalCost: 0, monthlyCost: 0, dose: 'All 4 compounds', note: pricing.note || 'Pricing TBD — contact Marc' };
      }
      const totalCost = unitsNeeded * pricing.msrp;
      const monthlyCostPen = Math.round(pricing.msrp / (weeksPerUnit / 4.33));
      return { name: 'KLOW Pen (All 4 compounds)', sku: pricing.sku, unit: 'pen', pricePerUnit: pricing.msrp, unitsNeeded, weeksPerUnit, totalCost: Math.round(totalCost), monthlyCost: monthlyCostPen, dose: 'All 4 compounds', note: `${unitsNeeded} pen${unitsNeeded>1?'s':''} covers ${Math.round(unitsNeeded*weeksPerUnit)} weeks` };
    }
    if (compoundName === '__KLOW_FD__') {
      const pricing = COMPOUND_PRICING['KLOW-fd'];
      const weeksPerUnit = pricing.weeksSupply || 4;
      const unitsNeeded = Math.ceil(weeks / weeksPerUnit);
      if (!pricing.msrp || pricing.msrp === 0) {
        return { name: 'KLOW Freeze-Dried (All 4 compounds)', sku: pricing.sku, unit: 'vial', pricePerUnit: 0, unitsNeeded, weeksPerUnit, totalCost: 0, monthlyCost: 0, dose: 'All 4 compounds', note: pricing.note || 'Pricing TBD — contact Marc' };
      }
      const totalCost = unitsNeeded * pricing.msrp;
      const monthlyCostFd = Math.round(pricing.msrp / (weeksPerUnit / 4.33));
      return { name: 'KLOW Freeze-Dried (All 4 compounds)', sku: pricing.sku, unit: 'vial', pricePerUnit: pricing.msrp, unitsNeeded, weeksPerUnit, totalCost: Math.round(totalCost), monthlyCost: monthlyCostFd, dose: 'All 4 compounds', note: `${unitsNeeded} vial${unitsNeeded>1?'s':''} covers ${Math.round(unitsNeeded*weeksPerUnit)} weeks` };
    }

    // Feature 1: pen format substitution
    const selectedFormat = (compoundFormats || {})[compoundName];
    let pricing;
    if (selectedFormat === 'pen') {
      pricing = COMPOUND_PRICING[compoundName + '-pen'] || COMPOUND_PRICING[compoundName];
    } else {
      pricing = COMPOUND_PRICING[compoundName] || COMPOUND_PRICING[compoundName + '-pen'];
    }
    if (!pricing || !pricing.msrp) {
      return { name: compoundName, pricePerUnit: 0, unitsNeeded: 1, totalCost: 0, monthlyCost: 0, weeksSupply: weeks, note: 'Price on request' };
    }

    const doseMultipliers2 = { low: 0.6, mid: 0.8, high: 1.0 };
    const mult = doseMultipliers2[dosingLevel] || 0.8;
    const weeksPerUnit = (pricing.weeksSupply || 4) / mult; // lower dose = lasts longer
    const unitsNeeded  = Math.ceil(weeks / weeksPerUnit);
    const totalCost    = unitsNeeded * pricing.msrp;
    const monthlyCost  = Math.round(pricing.msrp / (weeksPerUnit / 4.33));
    const dose         = dosing[compoundName] || '';

    return {
      name:        compoundName,
      sku:         pricing.sku,
      unit:        pricing.unit,
      pricePerUnit: pricing.msrp,
      unitsNeeded,
      weeksPerUnit: Math.round(weeksPerUnit),
      totalCost:   Math.round(totalCost),
      monthlyCost: monthlyCost,
      dose,
      note: `${unitsNeeded} ${pricing.unit}${unitsNeeded > 1 ? 's' : ''} covers ${Math.round(unitsNeeded * weeksPerUnit)} weeks`
    };
  }).filter(c => c.pricePerUnit > 0 || c.note === 'Price on request' || c.note?.includes('Pricing TBD'));

  const grandTotal  = breakdown.reduce((s, c) => s + c.totalCost, 0);
  const monthlyAvg  = breakdown.reduce((s, c) => s + c.monthlyCost, 0);

  // Cycle classification
  let cycleCategory, reorderTriggerDay;
  if (weeks <= 5)        { cycleCategory = 'Tester';            reorderTriggerDay = 20; }
  else if (weeks <= 14)  { cycleCategory = 'Short Cycle';       reorderTriggerDay = Math.round(weeks * 7 * 0.7); }
  else if (weeks <= 28)  { cycleCategory = 'Builder';           reorderTriggerDay = Math.round(weeks * 7 * 0.75); }
  else                   { cycleCategory = 'Full Optimization'; reorderTriggerDay = Math.round(weeks * 7 * 0.8); }

  // Budget comparison — recalculate each dose level independently
  // so numbers are always stable absolute values, not relative to current selection.
  function calcTotalsForDose(dlevel) {
    const dm = { low: 0.6, mid: 0.8, high: 1.0 }[dlevel] || 0.8;
    let total = 0, monthly = 0;
    allCompounds.forEach(cn => {
      let pr;
      if (cn === '__KLOW_FD__') {
        pr = COMPOUND_PRICING['KLOW-fd'];
        if (!pr || !pr.msrp) return;
        const wpu = pr.weeksSupply || 4.33;
        const units = Math.ceil(weeks / wpu);
        total   += units * pr.msrp;
        monthly += Math.round(pr.msrp / (wpu / 4.33));
      } else if (cn === '__KLOW_PEN__') {
        pr = COMPOUND_PRICING['KLOW-pen'];
        if (!pr || !pr.msrp) return;
        const wpu = pr.weeksSupply || 4;
        const units = Math.ceil(weeks / wpu);
        total   += units * pr.msrp;
        monthly += Math.round(pr.msrp / (wpu / 4.33));
      } else {
        pr = COMPOUND_PRICING[cn];
        if (!pr || !pr.msrp) return;
        const wpu = (pr.weeksSupply || 4) / dm;
        const units = Math.ceil(weeks / wpu);
        total   += units * pr.msrp;
        monthly += Math.round(pr.msrp / (wpu / 4.33));
      }
    });
    return { total, monthly };
  }

  const doseComparison = ['low', 'mid', 'high'].map(level => {
    const t = calcTotalsForDose(level);
    return {
      level,
      label: level === 'low' ? '🌱 Maintenance' : level === 'mid' ? '⚡ Recovery' : '🔥 Optimize',
      estimatedMonthly: t.monthly,
      estimatedTotal:   t.total
    };
  });

  res.json({
    stack:         { id: stack.id, goal: stack.goal },
    tier:          tierData.label,
    dosingLevel,
    cycleWeeks:    weeks,
    cycleMonths:   Math.round(months * 10) / 10,
    cycleCategory,
    reorderTriggerDay,
    breakdown,
    grandTotal,
    monthlyAvg:    Math.round(monthlyAvg),
    doseComparison,
    durationNote:  `Your stack runs approximately ${Math.round(months)} months. Each compound has a different supply window — the shortest compound determines your reorder date.`
  });
});

// ════════════════════════════════════════════════════════════
// SERVE PAGES (SPA-style with JS routing)
// ════════════════════════════════════════════════════════════
// PRODUCTS CATALOG
// ════════════════════════════════════════════════════════════

function buildDisplayName(name, mg, isBox10) {
  let clean = name
    .replace(/\s*\(?BOX10\)?\s*/gi, '')
    .replace(/\s*\/vial\s*/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  return clean;
}

// Pen mg reference — all pens are 3mL, mg is the total compound loaded
const PEN_MG = {
  // mg values from Rows AI spreadsheet — confirmed March 24, 2026
  'KLOW-PEN':             { mg: null,  label: 'Blend',     note: 'KPV + BPC-157 + GHK-Cu + TB-500 blend' },
  'MOTC-PEN-15MG':        { mg: 15,    label: '15mg' },
  'CLEN-PEN-80SP':        { mg: 0.025, label: '0.025mg',   note: '80 sprays' },
  'PEN-5AMINO-1MG':       { mg: 100,   label: '100mg' },
  'PEN-AC-KPV-NH2':       { mg: 15,    label: '15mg' },
  'PEN-AC-SELANK-NH2':    { mg: 15,    label: '15mg' },
  'PEN-AC-SELANK-DELTA':  { mg: 15,    label: '15mg',      note: 'AC-Selank-NH2 + Delta-sleep mix' },
  'PEN-AC-SEMAX-NH2':     { mg: 15,    label: '15mg' },
  'PEN-ADIPOTIDE':        { mg: 30,    label: '30mg' },
  'PEN-AOD9604':          { mg: 30,    label: '30mg' },
  'PEN-BPC-SPRAY':        { mg: 50,    label: '50mg',      note: 'Spray format' },
  'PEN-BPC157':           { mg: 15,    label: '15mg' },
  'PEN-BRONCHOGEN':       { mg: 30,    label: '30mg' },
  'PEN-CAGRILINTIDE':     { mg: 30,    label: '30mg' },
  'PEN-CARDIOGEN':        { mg: 30,    label: '30mg' },
  'PEN-CJC-NO-DAC':       { mg: 30,    label: '30mg' },
  'PEN-DELTA-SLEEP':      { mg: 30,    label: '30mg' },
  'PEN-EPITALON':         { mg: 30,    label: '30mg' },
  'PEN-FOLLISTATIN344':   { mg: 3,     label: '3mg' },
  'PEN-GCMAF':            { mg: 1.8,   label: '1.8mg' },
  'PEN-GHRP6':            { mg: 15,    label: '15mg' },
  'PEN-HUMANIN':          { mg: 30,    label: '30mg' },
  'PEN-HUMANIN-LOWDOSE':  { mg: 7.5,   label: '7.5mg' },
  'PEN-IGF1-LR3':         { mg: 3,     label: '3mg' },
  'PEN-IPA':              { mg: 15,    label: '15mg' },
  'PEN-IPA-CJC1295':      { mg: 15,    label: '15mg',      note: 'Ipamorelin + CJC-1295 mix' },
  'PEN-KISSPEPTIN':       { mg: 15,    label: '15mg' },
  'PEN-LCARNITINE':       { mg: 600,   label: '600mg' },
  'PEN-MELANOTAN2':       { mg: 30,    label: '30mg' },
  'PEN-MELITTIN':         { mg: 15,    label: '15mg' },
  'PEN-MOTSC':            { mg: 15,    label: '15mg' },
  'PEN-NAD-100':          { mg: 300,   label: '300mg' },
  'PEN-NAD-200':          { mg: 600,   label: '600mg' },
  'PEN-NAD-1000':         { mg: 1000,  label: '1,000mg' },
  'PEN-PHDPS-SPRAY':      { mg: 100,   label: '100mg',     note: 'Spray' },
  'PEN-PNC27':            { mg: 30,    label: '30mg' },
  'PEN-PNC27-PNC28':      { mg: 30,    label: '30mg',      note: 'PNC27 + PNC28 mix' },
  'PEN-PNC28':            { mg: 30,    label: '30mg' },
  'PEN-PROSTAMAX':        { mg: 30,    label: '30mg' },
  'PEN-PT141':            { mg: 15,    label: '15mg' },
  'PEN-RETA-BESTVAL':     { mg: 30,    label: '30mg' },
  'PEN-SEMA':             { mg: 5,     label: '5mg' },
  'PEN-SERM':             { mg: 7.5,   label: '7.5mg' },
  'PEN-SKINGLOW-GHK100':  { mg: 100,   label: '100mg' },
  'PEN-SKINGLOW-GHK30':   { mg: 30,    label: '30mg' },
  'PEN-SOMATROPIN':       { mg: 20,    label: '20mg' },
  'PEN-SS31':             { mg: 30,    label: '30mg' },
  'PEN-SS31-CARDIOGEN':   { mg: 30,    label: '30mg',      note: 'SS-31 + Cardiogen mix' },
  'PEN-TB4-THYMOSIN-B4':  { mg: 30,    label: '30mg' },
  'PEN-TB500':            { mg: 15,    label: '15mg' },
  'PEN-TB500-BPC157':     { mg: 15,    label: '15mg',      note: 'TB-500 + BPC-157 mix' },
  'PEN-TERIPARATIDE':     { mg: 0.6,   label: '0.6mg' },
  'PEN-TESA-10MG':        { mg: 30,    label: '30mg' },
  'PEN-TESA-5MG':         { mg: 15,    label: '15mg' },
  'PEN-THYMALIN':         { mg: 30,    label: '30mg' },
  'PEN-THYMOGEN':         { mg: 30,    label: '30mg' },
  'PEN-THYMOSIN-A1':      { mg: 30,    label: '30mg' },
  'PEN-VIP':              { mg: 15,    label: '15mg',      note: 'Post-COVID treatment' },
  'PEN-VIP-MOTSC':        { mg: 30,    label: '30mg',      note: 'VIP + MOTS-C mix' },
};

// ════════════════════════════════════════════════════════════
// VITALIS STACKS-AS-PRODUCTS  (added 2026-04-19)
// New routes — additive, do not break existing /api/products consumers.
//   GET  /api/vitalis-stacks            — list (default: active only; ?showDraft=1 to include drafts)
//   GET  /api/vitalis-stacks/:id        — full stack detail with per-compound research
//   GET  /api/search?q=<term>           — unified catalog search:
//                                          { direct_matches: [...vials/pens/other...],
//                                            stacks_containing: [{ stack, matched_compounds: [] }] }
// ════════════════════════════════════════════════════════════

app.get('/api/vitalis-stacks', (req, res) => {
  try {
    const includeDraft = req.query.showDraft === '1' || req.query.showDraft === 'true';
    const stacks = VitalisStacks.getStacks({ includeDraft });
    res.json({ stacks });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/vitalis-stacks/:id', (req, res) => {
  try {
    const stack = VitalisStacks.getStackWithResearch(req.params.id);
    if (!stack) return res.status(404).json({ error: 'Stack not found' });
    res.json({ stack });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Unified search — direct product matches + stacks containing query ──
app.get('/api/search', async (req, res) => {
  try {
    const q = (req.query.q || '').toLowerCase().trim();
    const includeDraft = req.query.showDraft === '1' || req.query.showDraft === 'true';
    if (!q) return res.json({ query: '', direct_matches: [], stacks_containing: [] });

    // 1) Direct matches against the product catalog (vials/pens/other).
    //    Reuse the same pattern as /api/products-catalog so the shape is familiar.
    let direct_matches = [];
    try {
      const records = await atGetAll(TABLES.PRODUCTS);
      direct_matches = records
        .map(r => {
          const f = r.fields || {};
          const name = f['Product Name'] || f['Name'] || '';
          const sku  = f['SKU'] || '';
          const cat  = f['Category'] || '';
          const msrp = parseFloat(f['MSRP'] || f['Price'] || 0);
          if (!name) return null;
          const isPen = name.toLowerCase().includes('pen') || sku.toUpperCase().startsWith('PEN-') || sku === 'KLOW-PEN';
          const isFat = cat === 'FatBurners';
          const type  = isPen ? 'pen' : (isFat || cat !== 'Peptides' ? 'other' : 'vial');
          return { id: r.id, sku, name, category: cat, type, msrp };
        })
        .filter(p => p && (
          p.name.toLowerCase().includes(q) ||
          (p.sku || '').toLowerCase().includes(q) ||
          (p.category || '').toLowerCase().includes(q)
        ))
        .slice(0, 25);
    } catch { /* products store unavailable — return only stacks */ }

    // 2) Stacks containing matching compounds (or matching name/use_cases)
    const stacks_containing = VitalisStacks.searchStacks(q, { includeDraft }).map(hit => ({
      stack: {
        id:           hit.stack.id,
        name:         hit.stack.name,
        type:         'stack',
        emoji:        hit.stack.emoji,
        tagline:      hit.stack.tagline,
        use_cases:    hit.stack.use_cases,
        price_cents:  hit.stack.price_cents,
        cycle_weeks:  hit.stack.cycle_weeks,
        compounds:    (hit.stack.compounds || []).map(c => ({ compound_id: c.compound_id, name: c.name, dose_label: c.dose_label, frequency: c.frequency })),
        active:       hit.stack.active,
        draft:        hit.stack.draft
      },
      matched_compounds: hit.matched_compounds
    }));

    res.json({ query: q, direct_matches, stacks_containing });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/products-catalog', async (req, res) => {
  try {
    const records = await atGetAll(TABLES.PRODUCTS);

    const vials = [], pens = [], other = [];

    records.forEach(r => {
      const f = r.fields;
      const name = f['Product Name'] || f['Name'] || '';
      const sku = f['SKU'] || '';
      const msrp = parseFloat(f['MSRP'] || 0);
      const cost = parseFloat(f['Cost'] || 0);
      const cat = f['Category'] || '';

      if (!name || msrp === 0) return;

      const margin = msrp > 0 && cost > 0 ? Math.round(((msrp - cost) / msrp) * 100) : null;
      const isPen = name.toLowerCase().includes('pen') || sku.toUpperCase().startsWith('PEN-') || sku === 'KLOW-PEN';
      const isBox10 = sku.includes('BOX10') || sku.includes('box');
      const isFat = cat === 'FatBurners';

      // For pens: use PEN_MG reference table; for vials: parse from name
      const penRef = isPen ? (PEN_MG[sku] || null) : null;
      const mgMatch = name.match(/(\d+(?:\.\d+)?)\s*mg/i);
      const mg = isPen
        ? (penRef ? penRef.mg : (mgMatch ? parseFloat(mgMatch[1]) : null))
        : (mgMatch ? parseFloat(mgMatch[1]) : null);
      const mgLabel = isPen ? (penRef ? penRef.label : (mg ? mg + 'mg' : null)) : (mg ? mg + 'mg' : null);
      const penNote = penRef ? (penRef.note || null) : null;
      const totalMg = isBox10 && mg ? mg * 10 : mg;
      const costPerMg = totalMg && msrp ? (msrp / totalMg).toFixed(2) : null;

      const discountAllowed = margin !== null && margin > 45;
      const maxDiscountPct = margin > 70 ? 20 : margin > 55 ? 15 : margin > 45 ? 10 : 0;

      const entry = {
        id: r.id,
        sku,
        name: name.replace(/\s*\(?\s*BOX10\)?\s*/i, '').trim(),
        displayName: buildDisplayName(name, mg, isBox10),
        msrp,
        cost,
        margin,
        mg,
        totalMg,
        costPerMg: costPerMg ? parseFloat(costPerMg) : null,
        isBox10,
        pricePerVial: isBox10 && msrp ? Math.round(msrp / 10 * 100) / 100 : null,
        boxPrice: isBox10 ? msrp : null,
        isPen,
        mgLabel: mgLabel || null,
        penNote: penNote || null,
        discountAllowed,
        maxDiscountPct,
        status: f['Status'] || 'Active'
      };

      if (entry.status === 'Archived') return;

      if (isPen) pens.push(entry);
      else if (isFat || (!isPen && cat !== 'Peptides')) other.push(entry);
      else vials.push(entry);
    });

    vials.sort((a, b) => a.displayName.localeCompare(b.displayName));
    pens.sort((a, b) => a.displayName.localeCompare(b.displayName));
    other.sort((a, b) => a.displayName.localeCompare(b.displayName));

    res.json({ vials, pens, other });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ════════════════════════════════════════════════════════════
// VALUE COMPARE
// ════════════════════════════════════════════════════════════

const VALUE_MAP = {
  'BPC-157':      { vial: 'BPC-157-5MG-BOX10',      pen: 'PEN-BPC157' },
  'TB-500':       { vial: 'TB500-5MG-BOX10',         pen: 'PEN-TB500' },
  'GHK-Cu':       { vial: 'GHK-CU-50MG-BOX10',      pen: 'PEN-SKINGLOW-GHK100' },
  'NAD+':         { vial: 'NAD-500MG-BOX10',         pen: 'PEN-NAD-200' },
  'Retatrutide':  { vial: 'RETA-10MG-BOX10',         pen: 'PEN-RETA-BESTVAL' },
  'Semaglutide':  { vial: null,                       pen: 'PEN-SEMA' },
  'CJC-1295 DAC': { vial: 'CJC-1295-DAC-2MG-BOX10', pen: 'PEN-IPA-CJC1295' },
  'Ipamorelin':   { vial: 'IPA-5MG-BOX10',           pen: 'PEN-IPA' },
  'MOTS-C':       { vial: 'MOTC-10MG-BOX10',         pen: 'PEN-MOTSC' },
  'KPV':          { vial: 'KPV-5MG-BOX10',           pen: 'PEN-AC-KPV-NH2' },
  'Tesamorelin':  { vial: 'TESA-5MG-BOX10',          pen: 'PEN-TESA-10MG' },
  'SS-31':        { vial: 'SS31-10MG-BOX10',         pen: 'PEN-SS31-CARDIOGEN' },
  'Kisspeptin':   { vial: 'KISS-5MG-BOX10',          pen: 'PEN-KISSPEPTIN' },
  'Semax':        { vial: 'SEMAX-5MG-BOX10',         pen: 'PEN-AC-SEMAX-NH2' },
  'Selank':       { vial: 'SELANK-10MG-BOX10',       pen: 'PEN-AC-SELANK-NH2' },
};

app.get('/api/value-compare/:compound', async (req, res) => {
  try {
    const compoundName = req.params.compound;
    const map = VALUE_MAP[compoundName];
    if (!map) return res.json({ options: [] });

    const options = [];

    if (map.vial) {
      const records = await atGetAll(TABLES.PRODUCTS, `{SKU}="${map.vial}"`);
      if (records[0]) {
        const f = records[0].fields;
        const msrp = parseFloat(f['MSRP'] || 0);
        const mgMatch = (f['Product Name'] || '').match(/(\d+(?:\.\d+)?)\s*mg/i);
        const mg = mgMatch ? parseFloat(mgMatch[1]) * 10 : null;
        options.push({
          type: 'vial-box10',
          label: '💎 Best Value (per mg)',
          sku: map.vial,
          name: f['Product Name'],
          msrp,
          totalMg: mg,
          costPerMg: mg ? (msrp / mg).toFixed(2) : null,
          note: 'Requires reconstitution with BAC water. Best cost per mg.'
        });
      }
    }

    if (map.pen) {
      const records = await atGetAll(TABLES.PRODUCTS, `{SKU}="${map.pen}"`);
      if (records[0]) {
        const f = records[0].fields;
        const msrp = parseFloat(f['MSRP'] || 0);
        const mgMatch = (f['Product Name'] || '').match(/(\d+(?:\.\d+)?)\s*mg/i);
        const mg = mgMatch ? parseFloat(mgMatch[1]) : null;
        options.push({
          type: 'pen',
          label: '⭐ Best Quality (convenience)',
          sku: map.pen,
          name: f['Product Name'],
          msrp,
          totalMg: mg,
          costPerMg: mg ? (msrp / mg).toFixed(2) : null,
          note: 'Pre-filled pen. Easy dosing. No reconstitution needed. Premium priced.'
        });
      }
    }

    res.json({ compound: compoundName, options });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});


// ════════════════════════════════════════════════════════════
// CLIENT COMPOUND GUIDE PDF
// POST /api/pdf/client-guide
// Body: { client, stackId, tier, dosingLevel, cycleWeeks, klowFormat }
// ════════════════════════════════════════════════════════════
app.post('/api/pdf/client-guide', (req, res) => {
  try {
    const { client, stackId, tier, dosingLevel, cycleWeeks, klowFormat } = req.body;

    const stack = STACKS.find(s => s.id === stackId);
    if (!stack) return res.status(404).json({ error: 'Stack not found' });
    const tierData = stack.tiers[tier];
    if (!tierData) return res.status(404).json({ error: 'Tier not found' });

    const weeks = cycleWeeks || tierData.cycleWeeks;
    const fmt = klowFormat || 'fd';
    const clientName = client || 'Client';
    const dateStr = new Date().toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });
    const rawDosing = tierData.dosing[dosingLevel] || {};
    const compounds = tierData.compounds;
    const doseMultipliers = { low: 0.6, mid: 0.8, high: 1.0 };
    const doseMultiplier = doseMultipliers[dosingLevel] || 0.8;

    const dosingDisplay = {};
    compounds.forEach(name => {
      if (name.startsWith('KLOW')) {
        if (fmt === 'fd') {
          dosingDisplay['KLOW Blend (FD)'] = '1 vial: 10mg BPC-157 / 10mg TB-500 / 10mg KPV / 50mg GHK-Cu — reconstitute per schedule';
        } else {
          ['KPV', 'BPC-157', 'GHK-Cu', 'TB-500'].forEach(k => {
            if (rawDosing[k]) dosingDisplay[k] = rawDosing[k];
            else if (DOSING[k]?.[dosingLevel]) dosingDisplay[k] = DOSING[k][dosingLevel].dose;
          });
        }
      } else if (rawDosing[name]) {
        dosingDisplay[name] = rawDosing[name];
      } else if (DOSING[name]?.[dosingLevel]) {
        dosingDisplay[name] = DOSING[name][dosingLevel].dose;
      }
    });

    const supplyList = compounds.map(name => {
      if (name.startsWith('KLOW')) {
        if (fmt === 'fd') {
          const weeksPerVial = Math.round((4 / doseMultiplier) * 10) / 10;
          return [{ name: 'KLOW Blend (FD)', units: Math.ceil(weeks / weeksPerVial), unit: 'vial', weeksPerVial }];
        }
        return ['KPV', 'BPC-157', 'GHK-Cu', 'TB-500'].map(k => ({ name: k, ...calcSupplyDosed(k, weeks, doseMultiplier) }));
      }
      return [{ name, ...calcSupplyDosed(name, weeks, doseMultiplier) }];
    }).flat();

    const allCompounds = [];
    compounds.forEach(c => {
      if (c.startsWith('KLOW')) {
        if (fmt === 'pen') allCompounds.push('__KLOW_PEN__');
        else if (fmt === 'fd') allCompounds.push('__KLOW_FD__');
        else ['KPV', 'BPC-157', 'TB-500', 'GHK-Cu'].forEach(k => allCompounds.push(k));
      } else {
        allCompounds.push(c);
      }
    });

    const pricingBreakdown = allCompounds.map(compoundName => {
      if (compoundName === '__KLOW_FD__') {
        const pricing = COMPOUND_PRICING['KLOW-fd'];
        const weeksPerUnit = pricing.weeksSupply || 4;
        const unitsNeeded = Math.ceil(weeks / weeksPerUnit);
        return {
          name: 'KLOW Freeze-Dried (All 4 compounds)',
          unit: 'vial',
          pricePerUnit: pricing.msrp || 0,
          unitsNeeded,
          weeksPerUnit,
          totalCost: Math.round(unitsNeeded * (pricing.msrp || 0)),
          monthlyCost: pricing.msrp ? Math.round(pricing.msrp / (weeksPerUnit / 4.33)) : 0
        };
      }
      if (compoundName === '__KLOW_PEN__') {
        const pricing = COMPOUND_PRICING['KLOW-pen'];
        const weeksPerUnit = pricing.weeksSupply || 4;
        const unitsNeeded = Math.ceil(weeks / weeksPerUnit);
        return {
          name: 'KLOW Pen (All 4 compounds)',
          unit: 'pen',
          pricePerUnit: pricing.msrp || 0,
          unitsNeeded,
          weeksPerUnit,
          totalCost: Math.round(unitsNeeded * (pricing.msrp || 0)),
          monthlyCost: pricing.msrp ? Math.round(pricing.msrp / (weeksPerUnit / 4.33)) : 0
        };
      }
      const pricing = COMPOUND_PRICING[compoundName] || COMPOUND_PRICING[compoundName + '-pen'];
      if (!pricing || !pricing.msrp) {
        return { name: compoundName, unit: 'vial', pricePerUnit: 0, unitsNeeded: 1, weeksPerUnit: weeks, totalCost: 0, monthlyCost: 0 };
      }
      const weeksPerUnit = (pricing.weeksSupply || 4) / doseMultiplier;
      const unitsNeeded = Math.ceil(weeks / weeksPerUnit);
      return {
        name: compoundName,
        unit: pricing.unit || 'vial',
        pricePerUnit: pricing.msrp,
        unitsNeeded,
        weeksPerUnit: Math.round(weeksPerUnit),
        totalCost: Math.round(unitsNeeded * pricing.msrp),
        monthlyCost: Math.round(pricing.msrp / (weeksPerUnit / 4.33))
      };
    });

    const grandTotal = pricingBreakdown.reduce((sum, item) => sum + (item.totalCost || 0), 0);
    const monthlyAvg = pricingBreakdown.reduce((sum, item) => sum + (item.monthlyCost || 0), 0);

    const compoundSections = [];
    compounds.forEach(name => {
      if (name.startsWith('KLOW')) {
        if (fmt === 'fd') compoundSections.push({ name: 'KLOW Blend (FD)', isKlowFD: true });
        else ['KPV', 'BPC-157', 'GHK-Cu', 'TB-500'].forEach(k => compoundSections.push({ name: k }));
      } else {
        compoundSections.push({ name });
      }
    });

    const doc = new PDFDocument({ size: 'LETTER', margins: { top: 100, bottom: 80, left: 40, right: 40 }, bufferPages: true, compress: false });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="client-guide-${stackId || 'stack'}.pdf"`);
    doc.pipe(res);

    const totalPages = compoundSections.length + 2;

    pdfHeader(doc, 'Research Protocol Guide');
    let y = 108;
    doc.rect(40, y, doc.page.width - 80, 50).fill(NAVY);
    doc.fillColor(GOLD).fontSize(20).font('Helvetica-Bold').text(`${stack.emoji || '🧬'} ${stack.goal}`, 52, y + 8, { width: doc.page.width - 104 });
    doc.fillColor(LIGHT).fontSize(10).font('Helvetica').text(`${tierData.label} Tier  ·  ${dosingLevel.toUpperCase()} Dose  ·  ${weeks}-Week Cycle`, 52, y + 31, { width: doc.page.width - 104 });
    y += 64;

    doc.rect(40, y, doc.page.width - 80, 36).fill(LIGHT);
    doc.fillColor(NAVY).fontSize(12).font('Helvetica-Bold').text(`Prepared for: ${clientName}`, 52, y + 9);
    doc.fillColor(MUTED).fontSize(10).font('Helvetica').text(dateStr, doc.page.width - 180, y + 10, { width: 130, align: 'right' });
    y += 52;

    doc.fillColor(NAVY).fontSize(10.5).font('Helvetica').text(stack.description || '', 40, y, { width: doc.page.width - 80, lineGap: 3 });
    y = doc.y + 16;

    const overview = [
      ['Goal', stack.goal],
      ['Tier', tierData.label],
      ['Cycle Length', `${weeks} weeks`],
      ['Dose Level', dosingLevel === 'low' ? 'Maintenance' : dosingLevel === 'mid' ? 'Recovery' : 'Optimize'],
      ['KLOW Format', fmt === 'fd' ? 'Freeze-Dried' : fmt === 'pen' ? 'Pen' : 'Individual'],
      ['Compounds', String(compoundSections.length)]
    ];
    doc.rect(40, y, doc.page.width - 80, 22).fill(DARK2);
    doc.fillColor(GOLD).fontSize(9).font('Helvetica-Bold').text('PROTOCOL OVERVIEW', 52, y + 7);
    y += 26;
    overview.forEach((row, idx) => {
      doc.rect(40, y, doc.page.width - 80, 24).fill(idx % 2 === 0 ? '#EEF1F7' : WHITE);
      doc.fillColor(MUTED).fontSize(8.5).font('Helvetica-Bold').text(row[0].toUpperCase(), 52, y + 8, { width: 120 });
      doc.fillColor(NAVY).fontSize(9).font('Helvetica').text(row[1], 180, y + 8, { width: doc.page.width - 220 });
      y += 24;
    });

    if (tierData.description) {
      y += 10;
      doc.rect(40, y, doc.page.width - 80, 22).fill(ACCENT);
      doc.fillColor(GOLD).fontSize(8.5).font('Helvetica-Bold').text('TIER NOTES', 52, y + 7);
      y += 28;
      doc.fillColor(NAVY).fontSize(9.5).font('Helvetica').text(tierData.description, 40, y, { width: doc.page.width - 80, lineGap: 2 });
      y = doc.y + 8;
    }

    pdfFooter(doc, 1, totalPages, true);

    compoundSections.forEach((section, idx) => {
      doc.addPage();
      pdfHeader(doc, 'Compound Guide');
      let cy = 110;

      const info = section.isKlowFD
        ? {
            emoji: '🟢',
            tagline: 'The Foundational Healing Layer',
            benefit: "Marc's foundational healing blend combines inflammation control, tissue repair, collagen support, and systemic recovery in one vial. KPV helps calm inflammatory load, BPC-157 supports tissue and gut healing, GHK-Cu drives collagen and repair signaling, and TB-500 extends healing throughout the body.",
            reconstitute: [
              'Add 2mL BAC water to vial.',
              'Contains 10mg BPC-157 / 10mg TB-500 / 10mg KPV / 50mg GHK-Cu.',
              'Inject per schedule.'
            ]
          }
        : (COMPOUND_INFO[section.name] || { emoji: '🧬', tagline: section.name, benefit: 'See compound guide for full details.', reconstitute: ['Follow compound-specific instructions.'] });

      const dose = section.isKlowFD
        ? dosingDisplay['KLOW Blend (FD)']
        : (dosingDisplay[section.name] || rawDosing[section.name] || DOSING[section.name]?.[dosingLevel]?.dose || 'See compound guide');

      const pricingItem = section.isKlowFD
        ? pricingBreakdown.find(p => p.name.includes('KLOW'))
        : pricingBreakdown.find(p => p.name === section.name);
      const supplyItem = section.isKlowFD
        ? supplyList.find(s => s.name === 'KLOW Blend (FD)')
        : supplyList.find(s => s.name === section.name);

      doc.rect(40, cy, doc.page.width - 80, 46).fill(NAVY);
      doc.fillColor(GOLD).fontSize(17).font('Helvetica-Bold').text(`${info.emoji} ${section.isKlowFD ? 'KLOW Blend (FD)' : section.name}`, 52, cy + 7, { width: doc.page.width - 160 });
      doc.fillColor(LIGHT).fontSize(10).font('Helvetica').text(info.tagline || '', 52, cy + 28, { width: doc.page.width - 160 });
      doc.fillColor(GOLD).fontSize(8.5).font('Helvetica-Bold').text(`${idx + 1} of ${compoundSections.length}`, doc.page.width - 105, cy + 17, { width: 55, align: 'right' });
      cy += 60;

      doc.rect(40, cy, doc.page.width - 80, 20).fill(ACCENT);
      doc.fillColor(GOLD).fontSize(8).font('Helvetica-Bold').text('BENEFITS', 52, cy + 6);
      cy += 26;
      doc.fillColor(NAVY).fontSize(10).font('Helvetica').text(info.benefit || '', 40, cy, { width: doc.page.width - 80, height: 72, lineGap: 3 });
      cy += 82;

      doc.rect(40, cy, doc.page.width - 80, 20).fill(DARK2);
      doc.fillColor(GOLD).fontSize(8).font('Helvetica-Bold').text('YOUR DOSE', 52, cy + 6);
      cy += 24;
      doc.rect(40, cy, doc.page.width - 80, 34).fill(LIGHT);
      doc.fillColor(NAVY).fontSize(10.5).font('Helvetica-Bold').text(dose || 'See compound guide', 52, cy + 9, { width: doc.page.width - 104, height: 18, ellipsis: true });
      cy += 46;

      doc.rect(40, cy, doc.page.width - 80, 20).fill(ACCENT);
      doc.fillColor(GOLD).fontSize(8).font('Helvetica-Bold').text('RECONSTITUTION', 52, cy + 6);
      cy += 26;
      (info.reconstitute || []).slice(0, 3).forEach((step, stepIdx) => {
        doc.rect(40, cy, 18, 18).fill(GOLD);
        doc.fillColor(NAVY).fontSize(10).font('Helvetica-Bold').text(String(stepIdx + 1), 40, cy + 4, { width: 18, align: 'center' });
        doc.fillColor(NAVY).fontSize(9.5).font('Helvetica').text(step, 66, cy + 3, { width: doc.page.width - 106, height: 16, ellipsis: true });
        cy += 24;
      });

      cy += 10;
      doc.rect(40, cy, doc.page.width - 80, 46).fill('#F5F7FA');
      doc.rect(40, cy, 4, 46).fill(GOLD);
      doc.fillColor(NAVY).fontSize(9).font('Helvetica-Bold').text(`Supply for ${weeks}-week cycle`, 52, cy + 7, { width: 180 });
      doc.fillColor(MUTED).fontSize(9).font('Helvetica').text(
        pricingItem
          ? `${pricingItem.unitsNeeded} ${pricingItem.unit}${pricingItem.unitsNeeded > 1 ? 's' : ''} · covers ~${pricingItem.weeksPerUnit} weeks/unit · $${pricingItem.monthlyCost}/month`
          : `${supplyItem?.units || 1} ${supplyItem?.unit || 'vial'}${(supplyItem?.units || 1) > 1 ? 's' : ''}`,
        52,
        cy + 23,
        { width: doc.page.width - 104 }
      );

      pdfFooter(doc, idx + 2, totalPages, true);
    });

    doc.addPage();
    pdfHeader(doc, 'Quick Reference');
    let qy = 110;

    doc.rect(40, qy, doc.page.width - 80, 22).fill(NAVY);
    doc.fillColor(GOLD).fontSize(9).font('Helvetica-Bold').text('QUICK REFERENCE + COST SUMMARY', 52, qy + 7);
    qy += 26;

    const cols = [42, 145, 305, 400, 485];
    const widths = [95, 150, 85, 80, 75];
    const headers = ['COMPOUND', 'DOSE', 'VIALS NEEDED', 'COVERS', '$/MO'];
    doc.rect(40, qy, doc.page.width - 80, 20).fill(ACCENT);
    doc.fillColor(GOLD).fontSize(7.5).font('Helvetica-Bold');
    headers.forEach((h, i) => doc.text(h, cols[i], qy + 6, { width: widths[i] }));
    qy += 22;

    compoundSections.forEach((section, idx) => {
      const pricingItem = section.isKlowFD ? pricingBreakdown.find(p => p.name.includes('KLOW')) : pricingBreakdown.find(p => p.name === section.name);
      const dose = section.isKlowFD ? 'KLOW Blend (FD)' : (dosingDisplay[section.name] || '—');
      doc.rect(40, qy, doc.page.width - 80, 20).fill(idx % 2 === 0 ? '#EEF1F7' : WHITE);
      doc.fillColor(NAVY).fontSize(8).font('Helvetica-Bold').text(section.isKlowFD ? 'KLOW (FD)' : section.name, cols[0], qy + 6, { width: widths[0] });
      doc.fillColor(NAVY).fontSize(7.2).font('Helvetica').text((dose || '—').slice(0, 28), cols[1], qy + 6, { width: widths[1] });
      doc.text(pricingItem ? `${pricingItem.unitsNeeded} ${pricingItem.unit}${pricingItem.unitsNeeded > 1 ? 's' : ''}` : '—', cols[2], qy + 6, { width: widths[2] });
      doc.text(pricingItem ? `${pricingItem.weeksPerUnit}wk` : '—', cols[3], qy + 6, { width: widths[3] });
      doc.fillColor(GOLD).text(pricingItem ? `$${pricingItem.monthlyCost}` : '—', cols[4], qy + 6, { width: widths[4] });
      qy += 20;
    });

    qy += 14;
    doc.rect(40, qy, doc.page.width - 80, 22).fill(NAVY);
    doc.fillColor(GOLD).fontSize(9).font('Helvetica-Bold').text('MONTHLY COST BREAKDOWN', 52, qy + 7);
    qy += 26;

    pricingBreakdown.forEach((item, idx) => {
      doc.rect(40, qy, doc.page.width - 80, 20).fill(idx % 2 === 0 ? '#EEF1F7' : WHITE);
      doc.fillColor(NAVY).fontSize(8.5).font('Helvetica-Bold').text(item.name, 52, qy + 6, { width: 220 });
      doc.fillColor(MUTED).fontSize(8.5).font('Helvetica').text(`${item.unitsNeeded} × $${item.pricePerUnit}`, 280, qy + 6, { width: 90 });
      doc.fillColor(NAVY).text(`$${item.totalCost}`, 390, qy + 6, { width: 70 });
      doc.fillColor(GOLD).text(`$${item.monthlyCost}/mo`, 470, qy + 6, { width: 80 });
      qy += 20;
    });

    qy += 8;
    doc.rect(40, qy, doc.page.width - 80, 26).fill(DARK2);
    doc.fillColor(GOLD).fontSize(11).font('Helvetica-Bold').text('TOTAL CYCLE COST', 52, qy + 7, { width: 220 });
    doc.fillColor(WHITE).text(`$${grandTotal.toLocaleString()}`, 390, qy + 7, { width: 70 });
    doc.fillColor(GOLD).text(`$${monthlyAvg.toLocaleString()}/mo avg`, 470, qy + 7, { width: 90 });
    qy += 40;

    doc.rect(40, qy, doc.page.width - 80, 58).fill(LIGHT);
    doc.rect(40, qy, 4, 58).fill(MUTED);
    doc.fillColor(MUTED).fontSize(8).font('Helvetica-Bold').text('RESEARCH DISCLAIMER', 52, qy + 8);
    doc.fillColor(MUTED).fontSize(8).font('Helvetica').text('For research purposes only. Not intended for human use. Not medical advice. Store properly and consult a qualified physician before any use or handling decisions.', 52, qy + 22, { width: doc.page.width - 104, lineGap: 2 });

    pdfFooter(doc, totalPages, totalPages, true);
    doc.end();
  } catch (e) {
    console.error('Client Guide PDF error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ── Symptom / Goal Search (must be before wildcard) ──────────
app.post('/api/symptom-search', async (req, res) => {
  const { query } = req.body;
  if (!query || query.trim().length < 3) return res.status(400).json({ error: 'Query too short' });

  const compoundSummary = Object.entries(COMPOUND_INFO).map(([name, c]) => {
    const benefits = Array.isArray(c.benefits) ? c.benefits.slice(0,4).join(', ') : c.tagline;
    return `${name}: ${c.tagline}. Benefits: ${benefits}.`;
  }).join('\n');

  const systemPrompt = `You are a research assistant for a peptide research platform. Match someone's health goals or symptoms to the most relevant research peptides from this catalogue. You are NOT a doctor. All responses are research information only.

Available compounds:
${compoundSummary}

RULES:
- Recommend 3–5 compounds maximum. Most relevant first.
- Each rationale: 2–3 sentences referencing the mechanism or published research, specific to this person's situation.
- Include a stackNote if 2+ compounds work well together.
- Always end disclaimer with "For research purposes only. Not medical advice."
- Respond ONLY with valid JSON in this exact format:
{
  "intro": "1-2 sentence summary",
  "compounds": [
    { "name": "Compound Name", "priority": "Primary", "why": "2-3 sentence rationale", "tags": ["tag1","tag2"] }
  ],
  "stackNote": "how these work together (or empty string)",
  "disclaimer": "For research purposes only. Not medical advice. Consult a qualified healthcare professional."
}
Priority values: "Primary" | "Supporting" | "Optional"`;

  try {
    const ANTHROPIC_KEY = 'REDACTED_ANTHROPIC_KEY';
    const aiResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 1200,
        system: systemPrompt,
        messages: [{ role: 'user', content: `My situation: ${query.trim()}` }]
      })
    });

    const aiData = await aiResp.json();
    const text = aiData.content?.[0]?.text || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return res.status(500).json({ error: 'Parse error', raw: text.slice(0,300) });
    const result = JSON.parse(jsonMatch[0]);
    res.json({ ok: true, query: query.trim(), result });

  } catch (err) {
    console.error('Symptom search error:', err.message);
    res.status(500).json({ error: 'Search failed', message: err.message });
  }
});

// ════════════════════════════════════════════════════════════
// PEPTIDE COMPARISON ENGINE
// ════════════════════════════════════════════════════════════

const { peptideComparisons, aiGeneratedCache, findComparison } = require('./data/peptide-comparisons');

// ── GET /api/compare/popular — top 10 by view_count ─────────
app.get('/api/compare/popular', (req, res) => {
  const sorted = [...peptideComparisons]
    .sort((a, b) => b.view_count - a.view_count)
    .slice(0, 10)
    .map(c => ({
      id: c.id,
      title: c.title,
      peptides: c.peptides,
      categories: c.categories,
      synergy_score: c.synergy_score,
      view_count: c.view_count
    }));
  res.json({ ok: true, comparisons: sorted });
});

// ── POST /api/compare — look up or generate comparison ───────
app.post('/api/compare', async (req, res) => {
  const { peptides, goal } = req.body;
  if (!peptides || !Array.isArray(peptides) || peptides.length < 2) {
    return res.status(400).json({ error: 'Provide at least 2 peptides in array' });
  }

  // Look in pre-built database
  let comparison = findComparison(peptides);

  if (comparison) {
    // Increment view count (in-memory)
    comparison.view_count = (comparison.view_count || 0) + 1;
    return res.json({ ok: true, source: 'database', comparison });
  }

  // Check AI cache
  const cacheKey = peptides.map(p => p.toLowerCase().trim()).sort().join('_') + (goal ? `_${goal}` : '');
  if (aiGeneratedCache.has(cacheKey)) {
    return res.json({ ok: true, source: 'ai_cache', comparison: aiGeneratedCache.get(cacheKey) });
  }

  // Generate via AI
  try {
    const [peptideA, peptideB, peptideC] = peptides;
    const peptideList = peptides.join(', ');
    const goalStr = goal || 'general wellness';

    const aiPrompt = `You are a peptide research assistant. Compare ${peptideList} for the goal of ${goalStr}.

For each peptide provide:
- mechanism summary (2 sentences, research framing)
- best research use cases (array of 3-5 strings)
- research_maturity: "high" | "moderate" | "emerging"

Then provide:
- synergy_score: 1-10 integer
- synergy_notes: when/why to stack them (2-3 sentences)
- decision_matrix: object with keys like "budget_limited", "goal_specific", "comprehensive" each having { pick: "peptide name or both", reason: "..." }
- contraindications: string

Research framing only. No medical advice. No dosing.

Return ONLY valid JSON in this exact format:
{
  "id": "generated_comparison",
  "peptides": ${JSON.stringify(peptides)},
  "title": "${peptides.join(' vs ')}",
  "categories": ["research"],
  "synergy_score": 5,
  "view_count": 0,
  "profiles": {
    "${peptideA}": { "mechanism": "...", "best_for": [], "research_maturity": "moderate" }${peptideB ? `,
    "${peptideB}": { "mechanism": "...", "best_for": [], "research_maturity": "moderate" }` : ''}${peptideC ? `,
    "${peptideC}": { "mechanism": "...", "best_for": [], "research_maturity": "moderate" }` : ''}
  },
  "synergy_notes": "...",
  "decision_matrix": {},
  "recommendation_template": "For ${goalStr}, {recommendation}.",
  "contraindications": "...",
  "popular_queries": []
}`;

    const aiResp = await fetch(LUKE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LUKE_BEARER}`
      },
      body: JSON.stringify({
        model: LUKE_MODEL,
        max_tokens: 2000,
        messages: [{ role: 'user', content: aiPrompt }]
      })
    });

    const aiData = await aiResp.json();
    const text = aiData.choices?.[0]?.message?.content || aiData.content?.[0]?.text || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('AI parse error');
    const generated = JSON.parse(jsonMatch[0]);

    // Cache it
    aiGeneratedCache.set(cacheKey, generated);
    return res.json({ ok: true, source: 'ai_generated', comparison: generated });

  } catch (err) {
    console.error('Compare AI error:', err.message);
    return res.status(500).json({ error: 'AI generation failed', message: err.message });
  }
});

// ── POST /api/compare/lead — save comparison lead ────────────
app.post('/api/compare/lead', (req, res) => {
  try {
    const { name, phone, email, message, comparison_context } = req.body;
    if (!email && !phone) return res.status(400).json({ error: 'Provide email or phone' });

    const lead = {
      id: `lead_${Date.now()}`,
      timestamp: new Date().toISOString(),
      name: name || '',
      phone: phone || '',
      email: email || '',
      message: message || '',
      comparison_context: comparison_context || {}
    };

    const leadsFile = path.join(__dirname, 'data', 'compare-leads.json');
    let leads = [];
    try { leads = JSON.parse(fs.readFileSync(leadsFile, 'utf8')); } catch(e) { leads = []; }
    leads.unshift(lead);
    fs.writeFileSync(leadsFile, JSON.stringify(leads, null, 2));

    console.log(`\n📊 COMPARISON LEAD CAPTURED:\n  Name: ${lead.name}\n  Email: ${lead.email}\n  Phone: ${lead.phone}\n  Context: ${JSON.stringify(lead.comparison_context)}\n`);

    res.json({ ok: true, message: 'Lead saved. Marc will be in touch within a few hours.', leadId: lead.id });
  } catch (err) {
    console.error('Compare lead error:', err.message);
    res.status(500).json({ error: 'Failed to save lead' });
  }
});

// ════════════════════════════════════════════════════════════
// POINT OF SALE (POS)
// ════════════════════════════════════════════════════════════

// In-memory POS sessions (survives restarts via persistence if needed)
const posSessions = new Map();

// ── POST /api/pos/session — create new POS session ───────────
app.post('/api/pos/session', (req, res) => {
  const { clientId, clientName, clientEmail, clientPhone } = req.body;
  const sessionId = `pos_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
  const session = {
    id: sessionId,
    createdAt: new Date().toISOString(),
    client: { id: clientId || null, name: clientName || 'Walk-in Client', email: clientEmail || '', phone: clientPhone || '' },
    cart: [],
    discountRate: 0,
    discountLabel: '',
    status: 'open'
  };
  posSessions.set(sessionId, session);
  console.log(`🛒 POS Session created: ${sessionId} for ${session.client.name}`);
  res.json({ ok: true, session });
});

// ── GET /api/pos/session/:id — get session ───────────────────
app.get('/api/pos/session/:id', (req, res) => {
  const session = posSessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json({ ok: true, session });
});

// ── POST /api/pos/cart/add — add product to cart ─────────────
app.post('/api/pos/cart/add', async (req, res) => {
  const { sessionId, productId, productName, price, quantity } = req.body;
  const session = posSessions.get(sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (session.status !== 'open') return res.status(400).json({ error: 'Session is not open' });

  const qty = parseInt(quantity) || 1;
  const existing = session.cart.find(item => item.productId === productId);
  if (existing) {
    existing.quantity += qty;
    existing.lineTotal = existing.quantity * existing.price;
  } else {
    session.cart.push({
      productId,
      productName: productName || productId,
      price: parseFloat(price) || 0,
      quantity: qty,
      lineTotal: (parseFloat(price) || 0) * qty
    });
  }
  res.json({ ok: true, session });
});

// ── POST /api/pos/cart/remove — remove product ───────────────
app.post('/api/pos/cart/remove', (req, res) => {
  const { sessionId, productId } = req.body;
  const session = posSessions.get(sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  session.cart = session.cart.filter(item => item.productId !== productId);
  res.json({ ok: true, session });
});

// ── POST /api/pos/discount — apply discount to session ───────
app.post('/api/pos/discount', (req, res) => {
  const { sessionId, discountRate, discountLabel } = req.body;
  const session = posSessions.get(sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  session.discountRate = parseFloat(discountRate) || 0;
  session.discountLabel = discountLabel || `${session.discountRate}% discount`;
  res.json({ ok: true, session });
});

// ── POST /api/pos/checkout — finalize order ──────────────────
app.post('/api/pos/checkout', async (req, res) => {
  const { sessionId, notes } = req.body;
  const session = posSessions.get(sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (session.status !== 'open') return res.status(400).json({ error: 'Session already closed' });
  if (!session.cart.length) return res.status(400).json({ error: 'Cart is empty' });

  const subtotal = session.cart.reduce((sum, item) => sum + item.lineTotal, 0);
  const discountAmt = subtotal * (session.discountRate / 100);
  const afterDiscount = subtotal - discountAmt;
  const hst = afterDiscount * 0.13;
  const total = afterDiscount + hst;

  const orderNumber = `POS-${Date.now().toString().slice(-8)}`;

  try {
    // Create in Airtable ORDERS table
    const orderFields = {
      'Order Number': orderNumber,
      'Client Name': session.client.name,
      'Status': 'Pending',
      'Notes': notes || `POS Order — Session ${sessionId}`,
      'Total': parseFloat(total.toFixed(2))
    };
    if (session.client.id) orderFields['Client'] = [session.client.id];

    let airtableOrderId = null;
    try {
      const atResult = await atFetch(TABLES.ORDERS, 'POST', { fields: orderFields });
      airtableOrderId = atResult.id;
    } catch (atErr) {
      console.warn('Airtable order creation warning:', atErr.message);
    }

    session.status = 'completed';
    session.orderNumber = orderNumber;
    session.airtableOrderId = airtableOrderId;
    session.totals = { subtotal, discountAmt, afterDiscount, hst, total };
    session.completedAt = new Date().toISOString();

    console.log(`✅ POS Checkout: ${orderNumber} | ${session.client.name} | $${total.toFixed(2)}`);

    res.json({
      ok: true,
      orderNumber,
      airtableOrderId,
      client: session.client,
      cart: session.cart,
      totals: session.totals,
      discountRate: session.discountRate,
      discountLabel: session.discountLabel
    });
  } catch (err) {
    console.error('POS checkout error:', err.message);
    res.status(500).json({ error: 'Checkout failed', message: err.message });
  }
});

// ── GET /api/pos/receipt/:orderId — receipt data ─────────────
app.get('/api/pos/receipt/:orderId', (req, res) => {
  const { orderId } = req.params;
  // Search completed sessions
  for (const [, session] of posSessions) {
    if (session.orderNumber === orderId || session.airtableOrderId === orderId) {
      return res.json({ ok: true, receipt: session });
    }
  }
  res.status(404).json({ error: 'Receipt not found. Sessions reset on server restart.' });
});

// ── POST /api/send-client-package — email stack to client ────
app.post('/api/send-client-package', async (req, res) => {
  const { clientName, clientEmail, note, stackData } = req.body;
  if (!clientEmail) return res.status(400).json({ error: 'Client email required' });

  const RESEND_KEY = process.env.RESEND_KEY;
  const FROM_EMAIL = 'onboarding@resend.dev';
  const FROM_NAME  = 'Marc Papineau — Cornerstone Research';
  const REPLY_TO   = 'marc@cornerstoneregroup.ca';

  const stackName   = stackData?.stackName || 'Your Research Stack';
  const tier        = stackData?.tier || '';
  const compounds   = stackData?.compounds || [];
  const pricing     = stackData?.pricing || null;
  const dosing      = stackData?.dosing || {};
  const noteSection = note ? `<p style="font-family:Georgia,serif;font-size:16px;font-style:italic;color:#555;border-left:3px solid #d4af37;padding-left:16px;margin:20px 0;">&ldquo;${note}&rdquo;</p>` : '';

  const compoundRows = compounds.map(c =>
    `<tr><td style="padding:10px 16px;border-bottom:1px solid #f0f0f0;font-weight:600;">${c}</td>
     <td style="padding:10px 16px;border-bottom:1px solid #f0f0f0;color:#666;">${dosing[c] || 'See protocol guide'}</td></tr>`
  ).join('');

  const pricingSection = pricing ? `
    <div style="background:#f9f7f3;border:1px solid #e8e0d0;border-radius:8px;padding:20px;margin:24px 0;">
      <h3 style="font-family:Georgia,serif;color:#1a1a1a;margin:0 0 12px;">Pricing Summary</h3>
      <table style="width:100%;border-collapse:collapse;">
        <tr><td style="padding:6px 0;color:#666;">Total Stack Cost</td><td style="padding:6px 0;text-align:right;font-weight:700;">$${pricing.total || '—'}</td></tr>
        <tr><td style="padding:6px 0;color:#666;">Monthly Average</td><td style="padding:6px 0;text-align:right;font-weight:700;color:#d4af37;">$${pricing.monthly || '—'}/mo</td></tr>
      </table>
    </div>` : '';

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Inter,-apple-system,sans-serif;">
<div style="max-width:600px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
<div style="background:#0A122A;padding:40px;text-align:center;">
  <div style="font-family:Georgia,serif;font-size:28px;font-weight:300;color:#fff;">Your Research Package</div>
  <div style="font-size:13px;color:rgba(255,255,255,0.55);margin-top:8px;letter-spacing:2px;text-transform:uppercase;">${stackName}${tier ? ' — ' + tier.toUpperCase() : ''}</div>
</div>
<div style="height:3px;background:linear-gradient(90deg,#d4af37,#f0d070,#d4af37);"></div>
<div style="padding:40px;">
  <p style="font-size:16px;color:#1a1a1a;margin:0 0 8px;">Hi ${clientName || 'there'},</p>
  <p style="font-size:15px;color:#555;line-height:1.7;margin:0 0 20px;">Here is your personalized research package — stack overview, compounds, and pricing for your reference.</p>
  ${noteSection}
  <h3 style="font-family:Georgia,serif;color:#1a1a1a;font-weight:400;font-size:18px;border-bottom:2px solid #f0e8d0;padding-bottom:10px;">Compounds in Your Stack</h3>
  <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
    <thead><tr style="background:#f9f7f3;"><th style="padding:10px 16px;text-align:left;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#999;">Compound</th><th style="padding:10px 16px;text-align:left;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#999;">Protocol</th></tr></thead>
    <tbody>${compoundRows || '<tr><td colspan="2" style="padding:16px;color:#999;text-align:center;">See protocol guide</td></tr>'}</tbody>
  </table>
  ${pricingSection}
  <div style="text-align:center;margin:32px 0 24px;"><a href="mailto:${REPLY_TO}" style="display:inline-block;background:#0A122A;color:#fff;text-decoration:none;padding:14px 36px;border-radius:8px;font-size:14px;font-weight:600;">Reply to Marc</a></div>
  <div style="background:#fff8e6;border:1px solid #f0d070;border-radius:6px;padding:14px 18px;">
    <p style="font-size:12px;color:#8a6a00;margin:0;line-height:1.6;">&#9888; <strong>Research Purposes Only.</strong> This information is educational and does not constitute medical advice. Consult a qualified healthcare professional before beginning any protocol.</p>
  </div>
</div>
<div style="background:#f9f7f3;padding:24px 40px;text-align:center;border-top:1px solid #e8e0d0;">
  <p style="font-size:12px;color:#999;margin:0;">Marc Papineau &nbsp;&middot;&nbsp; Cornerstone Research Group &nbsp;&middot;&nbsp; ${REPLY_TO}</p>
</div>
</div></body></html>`;

  try {
    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: `${FROM_NAME} <${FROM_EMAIL}>`, to: [clientEmail], reply_to: REPLY_TO, subject: `Your Research Package — ${stackName}`, html })
    });
    const emailData = await emailRes.json();
    if (emailRes.ok && emailData.id) {
      console.log(`\n📧 Stack sent to ${clientEmail} — Email ID: ${emailData.id}`);
      res.json({ ok: true, emailId: emailData.id, to: clientEmail });
    } else {
      res.status(500).json({ error: emailData.message || 'Email send failed' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/compare/category/:category — smart category compare ─
const { CATEGORY_COMPARISONS } = require('./data/category-comparisons.js');

app.get('/api/compare/category/:category', (req, res) => {
  const cat = req.params.category.toLowerCase();
  const data = CATEGORY_COMPARISONS[cat];
  if (!data) return res.status(404).json({ error: 'Category not found', available: Object.keys(CATEGORY_COMPARISONS) });
  res.json({ ok: true, category: cat, data });
});

app.get('/api/compare/categories', (req, res) => {
  const summary = Object.entries(CATEGORY_COMPARISONS).map(([key, val]) => ({
    id: key, label: val.label, compoundCount: val.ranked?.length || 0, topCompound: val.ranked?.[0]?.compound || null
  }));
  res.json({ ok: true, categories: summary });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Start ────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🔥 LUKE App running at http://0.0.0.0:${PORT}`);
  console.log(`📱 Access from phone: http://[your-mac-ip]:${PORT}\n`);
});
