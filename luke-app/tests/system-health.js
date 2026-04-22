#!/usr/bin/env node
/**
 * NEHEMIAH SYSTEM HEALTH CHECK
 * Run: node tests/system-health.js
 * Checks ALL critical systems — not just the Luke app.
 * Run this daily or before any major work session.
 */

const http = require('http');
const https = require('https');
const { execSync } = require('child_process');

const RESULTS = [];
const FIXES = [];
let passed = 0, failed = 0, warned = 0;

function fixed(name, what, result) {
  FIXES.push({ name, what, result });
  RESULTS.push({ status: '🔧', name: `Auto-fixed: ${name}`, detail: `${what} → ${result}` });
  passed++;
}

function pass(name, detail) {
  RESULTS.push({ status: '✅', name, detail });
  passed++;
}
function fail(name, detail) {
  RESULTS.push({ status: '❌', name, detail });
  failed++;
}
function warn(name, detail) {
  RESULTS.push({ status: '⚠️', name, detail });
  warned++;
}

function get(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { headers }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
  });
}

async function post(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const mod = url.startsWith('https') ? https : http;
    const opts = Object.assign({ method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...headers } }, require('url').parse(url));
    const req = mod.request(opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

const N8N_KEY = process.env.N8N_API_KEY || '';
if (!N8N_KEY) { console.error('Missing N8N_API_KEY env var — set it in .env.local'); process.exit(1); }

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║         NEHEMIAH — FULL SYSTEM HEALTH CHECK             ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`  ${new Date().toLocaleString('en-CA', { timeZone: 'America/Toronto' })}\n`);

  // ── 1. OPENCLAW GATEWAY ──────────────────────────────────────────────
  console.log('📡 OPENCLAW GATEWAY');
  try {
    const r = await get('http://127.0.0.1:18789/');
    r.status < 400 ? pass('Gateway reachable', `HTTP ${r.status}`) : fail('Gateway returned error', `HTTP ${r.status}`);
  } catch(e) { fail('Gateway unreachable', e.message); }

  // Check gateway token is current
  try {
    const r = await get('http://127.0.0.1:18789/v1/models', {
      'Authorization': `Bearer ${process.env.LUKE_BEARER || ''}`
    });
    r.status === 200 ? pass('Gateway auth token valid', 'Bearer token accepted') : fail('Gateway auth token INVALID', `HTTP ${r.status} — token may have rotated`);
  } catch(e) { fail('Gateway auth test failed', e.message); }

  // ── 2. N8N AUTOMATION ─────────────────────────────────────────────────
  console.log('\n🔧 N8N AUTOMATION');
  try {
    const r = await get('http://localhost:5678/api/v1/workflows?limit=50', { 'X-N8N-API-KEY': N8N_KEY });
    if (r.status === 200) {
      const data = JSON.parse(r.body);
      const active = data.data.filter(w => w.active);
      const inactive = data.data.filter(w => !w.active);
      pass('n8n API reachable', `${data.data.length} workflows (${active.length} active)`);

      // Check critical workflows are active
      const criticalWorkflows = [
        'APOLLOS — Daily Content (Mon–Fri 7:30AM)',
        'SOLOMON — Real-Time Lead Qualifier',
        'EZRA v2 — Morning Briefing + Calendar',
        'NEHEMIAH — EOD Status Report (5PM Mon–Fri)',
        'DANIEL — Tool Intelligence Scout (Monday)'
      ];
      for (const wfName of criticalWorkflows) {
        // Prefer the active workflow if multiple share the same name
        const found = data.data.find(w => w.name === wfName && w.active) || data.data.find(w => w.name === wfName);
        if (!found) warn(`Workflow not found: ${wfName}`, 'May have been renamed or deleted');
        else if (!found.active) {
          // Auto-fix: reactivate without asking
          try {
            const fixR = await new Promise((res, rej) => {
              const req = http.request({ hostname: 'localhost', port: 5678, path: `/api/v1/workflows/${found.id}/activate`, method: 'POST', headers: { 'X-N8N-API-KEY': N8N_KEY, 'Content-Type': 'application/json', 'Content-Length': 2 } }, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>res(JSON.parse(d))); });
              req.on('error', rej); req.write('{}'); req.end();
            });
            fixR.active ? fixed(wfName.split(' — ')[0], 'Was inactive', 'Reactivated') : fail(`Could not reactivate: ${wfName}`, 'Manual intervention needed');
          } catch(e) { fail(`Auto-fix failed: ${wfName}`, e.message); }
        }
        else pass(`Active: ${wfName.split(' — ')[0]}`, '✓');
      }

      // Check for recent errors (last 24h)
      const errR = await get(`http://localhost:5678/api/v1/executions?limit=20&status=error`, { 'X-N8N-API-KEY': N8N_KEY });
      if (errR.status === 200) {
        const errData = JSON.parse(errR.body);
        const recentErrors = errData.data.filter(e => {
          const age = Date.now() - new Date(e.startedAt).getTime();
          return age < 24 * 60 * 60 * 1000;
        });
        recentErrors.length === 0
          ? pass('No workflow errors in last 24h', '✓')
          : warn(`${recentErrors.length} workflow errors in last 24h`, recentErrors.map(e => e.workflowId).join(', '));
      }
    } else {
      fail('n8n API error', `HTTP ${r.status}`);
    }
  } catch(e) { fail('n8n unreachable', e.message); }

  // Check n8n Docker container
  try {
    const result = execSync('docker inspect n8n --format "{{.State.Status}}"', { encoding: 'utf8' }).trim();
    result === 'running' ? pass('n8n Docker container running', '✓') : fail('n8n Docker container not running', result);
  } catch(e) { fail('Docker check failed', e.message); }

  // ── 3. LUKE APP ──────────────────────────────────────────────────────
  console.log('\n💊 LUKE PEPTIDE APP');
  try {
    const r = await get('http://localhost:3000/api/stats');
    if (r.status === 200) {
      const data = JSON.parse(r.body);
      pass('Luke app running', `${data.totalClients || 0} clients, ${data.totalOrders || 0} orders`);
    } else {
      fail('Luke app error', `HTTP ${r.status}`);
    }
  } catch(e) {
    // Auto-fix: restart Luke server
    try {
      require('child_process').execSync('cd /Users/marcpapineau/.openclaw/workspace/luke-app && node server.js &', { detached: true });
      await new Promise(r => setTimeout(r, 4000));
      const retry = await get('http://localhost:3000/api/stats');
      retry.status === 200 ? fixed('Luke server', 'Was not running', 'Restarted') : fail('Luke app restart failed', 'Manual intervention needed');
    } catch(e2) { fail('Luke app not running', e.message); }
  }

  try {
    const r = await get('http://localhost:3000/api/stack-library');
    if (r.status === 200) {
      const data = JSON.parse(r.body);
      data.stacks.length === 10
        ? pass('Stack library loaded', `${data.stacks.length} stacks`)
        : warn('Stack library incomplete', `Only ${data.stacks.length} of 10 stacks`);
    }
  } catch(e) { fail('Stack library error', e.message); }

  try {
    const r = await get('http://localhost:3000/api/products');
    if (r.status === 200) {
      const data = JSON.parse(r.body);
      const count = (data.products || data).length;
      count >= 100 ? pass('Products loaded', `${count} products from localDb`) : warn('Low product count', `${count} products — localDb seed may be incomplete`);
    }
  } catch(e) { fail('Products API error', e.message); }

  // ── 4. EXTERNAL APIs ─────────────────────────────────────────────────
  console.log('\n🌐 EXTERNAL APIs');

  // Anthropic
  try {
    const r = await get('https://api.anthropic.com/v1/models', {
      'x-api-key': process.env.ANTHROPIC_API_KEY || '',
      'anthropic-version': '2023-06-01'
    });
    r.status === 200 ? pass('Anthropic API reachable', '✓') : warn('Anthropic API issue', `HTTP ${r.status}`);
  } catch(e) { fail('Anthropic API unreachable', e.message); }

  // Luma AI
  try {
    const r = await get('https://api.lumalabs.ai/dream-machine/v1/generations?limit=1', {
      'Authorization': `Bearer ${process.env.LUMA_API_KEY || ''}`
    });
    r.status === 200 ? pass('Luma AI API reachable', '✓') : warn('Luma API issue', `HTTP ${r.status}`);
  } catch(e) { fail('Luma AI API unreachable', e.message); }

  // Airtable — RETIRED 2026-04-22 (base unreachable, migrated to localDb)
  // See: ~/.claude/projects/-Users-marcpapineau--openclaw-workspace/memory/backlog_airtable_base_investigation.md
  // Luke-app now uses data/localDb.js as the source of truth for PRODUCTS/CLIENTS/ORDERS/PROTOCOLS/BLOODWORK.

  // GoHighLevel
  try {
    const r = await get('https://services.leadconnectorhq.com/contacts/?locationId=VKXTy0VdENN4Nh0QQXZN&limit=1', {
      'Authorization': `Bearer ${process.env.GHL_PIT || ''}`,
      'Version': '2021-07-28'
    });
    r.status === 200 || r.status === 422 // 422 = invalid params but API is up
      ? pass('GoHighLevel (GHL) reachable', '✓')
      : warn('GHL issue', `HTTP ${r.status}`);
  } catch(e) { fail('GoHighLevel unreachable', e.message); }

  // ── 5. APOLLOS CONTENT PIPELINE ──────────────────────────────────────
  console.log('\n📰 APOLLOS CONTENT PIPELINE');
  // Check if today's article was sent (look at n8n execution log)
  try {
    const today = new Date().toISOString().split('T')[0];
    const r = await get(`http://localhost:5678/api/v1/executions?limit=10`, { 'X-N8N-API-KEY': N8N_KEY });
    if (r.status === 200) {
      const data = JSON.parse(r.body);
      const apollosRuns = data.data.filter(e => {
        const isToday = e.startedAt && e.startedAt.startsWith(today);
        return isToday; // workflow ID oyjzWf2O3TkdmwvL
      });
      // Check if n8n execution log shows Apollos ran today
      const dayOfWeek = new Date().getDay();
      if (dayOfWeek === 0 || dayOfWeek === 6) {
        pass('Apollos daily — weekend', 'No article scheduled Sat/Sun');
      } else {
        // We can't easily filter by workflow here, just note it
        warn('Apollos daily — manual verification needed', 'Check inbox for today\'s article');
      }
    }
  } catch(e) { warn('Could not check Apollos executions', e.message); }

  // ── 6. DISK + PROCESS HEALTH ─────────────────────────────────────────
  console.log('\n💻 LOCAL SYSTEM');
  try {
    const disk = execSync("df -h ~/.openclaw/workspace | tail -1 | awk '{print $5, $4}'", { encoding: 'utf8' }).trim();
    const pct = parseInt(disk);
    pct < 80 ? pass('Disk space OK', `${disk} available`) : warn('Disk space getting low', disk);
  } catch(e) { warn('Could not check disk', e.message); }

  try {
    let lukeRunning = '0';
    try {
      lukeRunning = execSync("lsof -nP -iTCP:3000 -sTCP:LISTEN | grep '[n]ode' | wc -l", { encoding: 'utf8' }).trim();
    } catch (_) {
      lukeRunning = execSync("ps aux | grep '[n]ode.*server.js' | grep 'luke-app' | wc -l", { encoding: 'utf8' }).trim();
    }
    parseInt(lukeRunning) > 0 ? pass('Luke server process running', `PID active`) : fail('Luke server NOT running', 'Run: cd luke-app && node server.js &');
  } catch(e) { warn('Could not check Luke process', e.message); }

  // ── SUMMARY ──────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(60));
  console.log(`  SUMMARY: ${passed} passed · ${failed} failed · ${warned} warnings`);
  console.log('═'.repeat(60));

  RESULTS.forEach(r => console.log(`  ${r.status} ${r.name}: ${r.detail}`));

  // Print fixes report
  if (FIXES.length > 0) {
    console.log('\n🔧 AUTO-FIX REPORT:');
    console.log('  ' + '─'.repeat(56));
    FIXES.forEach(f => console.log(`  • ${f.name}: ${f.what} → ✅ ${f.result}`));
    console.log('  ' + '─'.repeat(56));
  }

  if (failed > 0) {
    console.log('\n🚨 CRITICAL ISSUES TO FIX:');
    RESULTS.filter(r => r.status === '❌').forEach(r => console.log(`  • ${r.name} — ${r.detail}`));
  }
  if (warned > 0) {
    console.log('\n⚠️  WARNINGS:');
    RESULTS.filter(r => r.status === '⚠️').forEach(r => console.log(`  • ${r.name} — ${r.detail}`));
  }

  // Save JSON report
  const report = { timestamp: new Date().toISOString(), passed, failed, warned, fixes: FIXES, results: RESULTS };
  require('fs').writeFileSync('/Users/marcpapineau/.openclaw/workspace/luke-app/tests/system-health-report.json', JSON.stringify(report, null, 2));

  console.log('\n  Report saved to tests/system-health-report.json');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('Health check crashed:', e); process.exit(1); });
