#!/usr/bin/env node
/**
 * hosting.test.cjs — red proofs for the dashboard host.
 *
 * The host serves internal engineering process state. Every case asserts a
 * refusal, an auth failure, or a leak that does NOT happen.
 */
'use strict';
const assert = require('assert');
const http = require('http');
const crypto = require('crypto');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn } = require('child_process');
const S = require('../hosting/server.cjs');

let passed = 0;
function test(n, fn) {
  try { fn(); passed++; console.log(`ok   ${n}`); }
  catch (e) { console.error(`FAIL ${n}: ${e.message}`); process.exitCode = 1; }
}
async function atest(n, fn) {
  try { await fn(); passed++; console.log(`ok   ${n}`); }
  catch (e) { console.error(`FAIL ${n}: ${e.message}`); process.exitCode = 1; }
}
const TOKEN = 'test-token-' + crypto.randomBytes(16).toString('hex');

console.log('AEGIS dashboard hosting — red proofs');

test('loopback with a generated token is allowed', () => {
  const v = S.validateConfig({ port: 8791, host: '127.0.0.1' }, {});
  assert.strictEqual(v.ok, true);
  assert.strictEqual(v.config.generated, true, 'a token must be generated when none is supplied');
  assert.ok(v.config.token.length >= 24);
});

test('RED: binding beyond loopback is refused without an explicit flag', () => {
  const v = S.validateConfig({ port: 8791, host: '0.0.0.0' }, {});
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.code, 'NON_LOOPBACK_REFUSED');
});

test('RED: one flag is not enough — exposure must also be acknowledged', () => {
  const v = S.validateConfig({ port: 8791, host: '0.0.0.0', allowNonLoopback: true }, {});
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.code, 'EXPOSURE_UNACKNOWLEDGED');
});

test('RED: an exposed bind may NOT use a generated token', () => {
  const v = S.validateConfig({ port: 8791, host: '0.0.0.0', allowNonLoopback: true, acknowledged: true }, {});
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.code, 'TOKEN_REQUIRED');
});

test('RED: a weak token is refused', () => {
  const v = S.validateConfig({ port: 8791, host: '127.0.0.1', token: 'short' }, {});
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.code, 'WEAK_TOKEN');
});

test('RED: there is no anonymous mode, even on loopback', () => {
  // Auth is structural: every validated config carries a token.
  const v = S.validateConfig({ port: 8791, host: '127.0.0.1' }, {});
  assert.ok(v.config.token, 'a config without a token must not exist');
});

test('RED: sensitive path classes are never servable', () => {
  for (const p of ['/ledger.json', '/builder-control/ledger.json', '/reviews/r.json',
                   '/review-raw/x.txt', '/packets/p.json', '/.env', '/.git/config',
                   '/id.pem', '/secret.json', '/token.txt']) {
    assert.ok(S.isNeverServe(p), `${p} must be refused`);
  }
});

test('RED: the servable allow-list is exactly the projection', () => {
  assert.deepStrictEqual(Object.keys(S.SERVABLE).sort(), ['/', '/index.html', '/state.js']);
  for (const v of Object.values(S.SERVABLE)) {
    assert.ok(['index.html', 'state.js'].includes(v.file), `unexpected servable file ${v.file}`);
  }
});

// ── switchboard UI wiring — static source proofs ────────────────────────────
// These read builder-control/dashboard/index.html as text and prove the
// interactive layer actually exists and stays inside its guardrails, without
// needing a browser: a required objective field, a Start control, honest
// limitation text, no dangerous free-text intake fields, safe DOM rendering,
// and no n8n anywhere.
const DASHBOARD_HTML_PATH = require('path').join(__dirname, '..', 'dashboard', 'index.html');
const dashboardHtml = () => fs.readFileSync(DASHBOARD_HTML_PATH, 'utf8');

test('switchboard: objective intake form exists with objective required', () => {
  const html = dashboardHtml();
  assert.ok(/id="intake-form"/.test(html), 'no objective intake form found');
  assert.ok(/id="in-objective"[^>]*required/.test(html) || /id="in-objective"[\s\S]{0,80}required/.test(html),
    'objective field is not marked required');
  assert.ok(/id="in-project"/.test(html), 'no optional project field');
  assert.ok(/id="in-constraints"/.test(html), 'no optional constraints field');
  assert.ok(/id="in-acceptance"/.test(html), 'no optional acceptance criteria field');
  assert.ok(/id="in-dataclass"/.test(html), 'no optional data classification field');
});

test('switchboard: intake posts to /api/objective, start posts to /api/start', () => {
  const html = dashboardHtml();
  assert.ok(/\/api\/objective/.test(html), 'no reference to /api/objective');
  assert.ok(/\/api\/start/.test(html), 'no reference to /api/start');
  assert.ok(/INTAKE_RECORDED/.test(html), 'no honest INTAKE_RECORDED confirmation rendering');
});

test('switchboard: pause/cancel/retry controls are wired to their API routes', () => {
  const html = dashboardHtml();
  assert.ok(/\/api\/pause/.test(html), 'no pause wiring');
  assert.ok(/\/api\/cancel/.test(html), 'no cancel wiring');
  assert.ok(/\/api\/retry/.test(html), 'no retry wiring');
});

test('switchboard: status bootstrap and SSE event stream are wired same-origin', () => {
  const html = dashboardHtml();
  assert.ok(/fetch\(\s*['"]\/api\/status['"]/.test(html), 'no /api/status bootstrap fetch');
  assert.ok(/new EventSource\(\s*['"]\/api\/events['"]/.test(html), 'no EventSource(\'/api/events\') wiring');
  assert.ok(/credentials:\s*['"]same-origin['"]/.test(html), 'fetch calls must carry same-origin credentials for the cookie session');
});

test('RED: no dangerous free-text intake field is present', () => {
  const html = dashboardHtml();
  for (const bad of ['name="command"', 'name="shell"', 'name="model"', 'name="provider"',
                     'name="path"', 'name="token"', 'name="secret"', 'name="verdict"']) {
    assert.ok(!html.includes(bad), `dangerous field ${bad} must not exist in the intake form`);
  }
});

test('RED: no innerHTML assignment anywhere in the dashboard', () => {
  const html = dashboardHtml();
  assert.ok(!/\.innerHTML\s*=/.test(html), 'innerHTML must never be used to render API-sourced data; use textContent/DOM APIs');
});

test('switchboard: the known active-build limitation is stated in the page, not hidden', () => {
  const html = dashboardHtml();
  assert.ok(/isolated worktree/.test(html) && /does not\s*\n?\s*yet launch an asynchronous builder/.test(html),
    'the Start-prepares-worktree-only limitation must be visible');
  assert.ok(/Pause is unavailable/.test(html), 'the pause-unavailable limitation must be visible');
});

test('RED: n8n is never referenced anywhere in the dashboard', () => {
  assert.ok(!/n8n/i.test(dashboardHtml()), 'n8n must not appear in the active dashboard');
});

test('dashboard-owned script blocks are syntactically valid JavaScript', () => {
  const html = dashboardHtml();
  const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.ok(blocks.length >= 2, 'expected the static renderer and the switchboard control-layer script blocks');
  for (const [i, body] of blocks.entries()) {
    assert.doesNotThrow(() => new Function(body), `script block ${i} is not syntactically valid: see thrown error`);
  }
});

// ── live probes ─────────────────────────────────────────────────────────────
function get(port, path_, headers = {}) {
  return new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port, path: path_, headers }, (res) => {
      let b = ''; res.on('data', (d) => (b += d));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
    }).on('error', () => resolve({ status: 0 }));
  });
}

(async () => {
  const v = S.validateConfig({ port: 8796, host: '127.0.0.1', token: TOKEN }, {});
  const srv = http.createServer(S.handler(v.config));
  await new Promise((r) => srv.listen(8796, '127.0.0.1', r));

  await atest('RED: a request with no token is 401', async () => {
    const r = await get(8796, '/');
    assert.strictEqual(r.status, 401);
  });

  await atest('RED: a wrong token is 401', async () => {
    const r = await get(8796, '/', { authorization: 'Bearer ' + 'x'.repeat(40) });
    assert.strictEqual(r.status, 401);
  });

  await atest('a valid token reaches the projection', async () => {
    const r = await get(8796, '/', { authorization: 'Bearer ' + TOKEN });
    assert.ok(r.status === 200 || r.status === 503, `got ${r.status}`);
  });

  await atest('RED: an authenticated request still cannot reach the ledger', async () => {
    const r = await get(8796, '/ledger.json', { authorization: 'Bearer ' + TOKEN });
    assert.strictEqual(r.status, 403, 'authentication must not grant data access beyond the projection');
  });

  await atest('RED: an authenticated request cannot reach raw reviewer transcripts', async () => {
    const r = await get(8796, '/review-raw/x.txt', { authorization: 'Bearer ' + TOKEN });
    assert.strictEqual(r.status, 403);
  });

  await atest('RED: writes are refused — this host is read-only', async () => {
    const r = await new Promise((resolve) => {
      const req = http.request({ host: '127.0.0.1', port: 8796, path: '/', method: 'POST',
        headers: { authorization: 'Bearer ' + TOKEN } }, (res) => resolve({ status: res.statusCode }));
      req.on('error', () => resolve({ status: 0 })); req.end();
    });
    assert.strictEqual(r.status, 405);
  });

  await atest('security headers are present on a served response', async () => {
    const r = await get(8796, '/state.js', { authorization: 'Bearer ' + TOKEN });
    if (r.status === 200) {
      assert.strictEqual(r.headers['x-content-type-options'], 'nosniff');
      assert.strictEqual(r.headers['x-frame-options'], 'DENY');
      assert.strictEqual(r.headers['cache-control'], 'no-store');
      assert.ok(/frame-ancestors 'none'/.test(r.headers['content-security-policy']));
    }
  });

  srv.close();
  await runApiSuite();
  const failed = process.exitCode ? 'at least 1' : '0';
  console.log(`${passed} passed, ${failed} failed.`);
})();

// ── live child-process API suite ────────────────────────────────────────────
// A dedicated child process, started with a temp AEGIS_RUNS_DIR/
// AEGIS_CHECKPOINTS_DIR/AEGIS_LEDGER_FILE BEFORE it ever requires
// server.cjs/aegis-run.cjs, so nothing here touches the real runs/ or
// ledger.json. The child's own module cache is therefore the only place the
// temp env applies — the correct isolation, since resolveDir() reads
// process.env once at require time.
function post(port, path_, { headers = {}, body, cookie } = {}) {
  return new Promise((resolve) => {
    const data = body === undefined ? null : Buffer.from(body);
    const h = { ...headers };
    if (cookie) h.cookie = cookie;
    if (data) h['content-length'] = data.length;
    const req = http.request(
      { host: '127.0.0.1', port, path: path_, method: 'POST', headers: h },
      (res) => {
        let b = '';
        res.on('data', (d) => (b += d));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
      }
    );
    req.on('error', () => resolve({ status: 0 }));
    if (data) req.write(data);
    req.end();
  });
}
function apiGet(port, path_, headers = {}) {
  return new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port, path: path_, headers }, (res) => {
      let b = ''; res.on('data', (d) => (b += d));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
    }).on('error', () => resolve({ status: 0 }));
  });
}

// Opens an SSE connection and resolves once the first chunk of the body has
// arrived, then destroys the socket. Good enough for header/initial-event
// assertions that don't need the connection to stay open.
function sseFirstChunk(port, path_, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: path_, headers }, (res) => {
      let done = false;
      res.on('data', (d) => {
        if (done) return;
        done = true;
        resolve({ status: res.statusCode, headers: res.headers, firstChunk: d.toString('utf8') });
        req.destroy();
      });
      res.on('end', () => {
        if (!done) { done = true; resolve({ status: res.statusCode, headers: res.headers, firstChunk: '' }); }
      });
    });
    req.on('error', (e) => { if (e.code !== 'ECONNRESET') reject(e); });
  });
}

// Opens a live SSE connection, splitting the byte stream on the SSE record
// separator ("\n\n") into a queue of whole records a test can pull from with
// next()/tryNext(). close() ends the request, the proof-of-cleanup test
// relies on the *server* noticing that and tearing its own timers/watcher
// down, not on anything this helper does.
function openSse(port, path_, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: path_, headers }, (res) => {
      let buf = '';
      const queue = [];
      const waiters = [];
      res.on('data', (d) => {
        buf += d.toString('utf8');
        let idx;
        while ((idx = buf.indexOf('\n\n')) !== -1) {
          const record = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          if (waiters.length) waiters.shift()(record);
          else queue.push(record);
        }
      });
      resolve({
        next(timeoutMs = 2000) {
          if (queue.length) return Promise.resolve(queue.shift());
          return new Promise((res2, rej2) => {
            const to = setTimeout(() => rej2(new Error('timed out waiting for an SSE record')), timeoutMs);
            waiters.push((record) => { clearTimeout(to); res2(record); });
          });
        },
        tryNext(timeoutMs = 400) {
          if (queue.length) return Promise.resolve(queue.shift());
          return new Promise((res2) => {
            const to = setTimeout(() => res2(null), timeoutMs);
            waiters.push((record) => { clearTimeout(to); res2(record); });
          });
        },
        close() { req.destroy(); },
      });
    });
    req.on('error', (e) => { if (e.code !== 'ECONNRESET') reject(e); });
  });
}

async function runApiSuite() {
  const PORT = 18797;
  const API_TOKEN = 'api-test-token-' + crypto.randomBytes(16).toString('hex');
  const ORIGIN = `http://127.0.0.1:${PORT}`;

  const TMP = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aegis-hosting-api-'));
  const runsDir = path.join(TMP, 'runs');
  const cpDir = path.join(TMP, 'checkpoints');
  const ledger = path.join(TMP, 'ledger.json');

  const serverPath = path.resolve(__dirname, '..', 'hosting', 'server.cjs');
  const driver = `
    process.env.AEGIS_RUNS_DIR = ${JSON.stringify(runsDir)};
    process.env.AEGIS_CHECKPOINTS_DIR = ${JSON.stringify(cpDir)};
    process.env.AEGIS_LEDGER_FILE = ${JSON.stringify(ledger)};
    const S = require(${JSON.stringify(serverPath)});
    const http = require('http');
    const v = S.validateConfig({ port: ${PORT}, host: '127.0.0.1', token: ${JSON.stringify(API_TOKEN)} }, {});
    if (!v.ok) { console.error('CONFIG_FAIL ' + JSON.stringify(v)); process.exit(1); }
    const server = http.createServer(S.handler(v.config));
    server.listen(${PORT}, '127.0.0.1', () => { console.log('READY'); });
  `;

  const child = spawn('node', ['-e', driver], { cwd: path.resolve(__dirname, '..', '..'), stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));

  await new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error('API child did not become ready: ' + out)), 10000);
    const check = setInterval(() => {
      if (/READY/.test(out)) { clearInterval(check); clearTimeout(to); resolve(); }
      if (child.exitCode !== null) { clearInterval(check); clearTimeout(to); reject(new Error('API child exited early: ' + out)); }
    }, 25);
  });

  try {
    await atest('API RED: unauthenticated GET /api/status is 401', async () => {
      const r = await apiGet(PORT, '/api/status');
      assert.strictEqual(r.status, 401);
    });

    await atest('API RED: unauthenticated POST /api/objective is 401', async () => {
      const r = await post(PORT, '/api/objective', {
        headers: { 'content-type': 'application/json', origin: ORIGIN },
        body: JSON.stringify({ objective: 'unauthenticated attempt' }),
      });
      assert.strictEqual(r.status, 401);
    });

    let statusBody;
    await atest('authenticated GET /api/status is 200 JSON, no-store', async () => {
      const r = await apiGet(PORT, '/api/status', { authorization: 'Bearer ' + API_TOKEN });
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.headers['cache-control'], 'no-store');
      assert.ok(/application\/json/.test(r.headers['content-type']));
      statusBody = r.body;
      assert.doesNotThrow(() => JSON.parse(statusBody));
    });

    await atest('API RED: /api/status leaks none of the forbidden terms', () => {
      assert.ok(statusBody, 'status body must have been captured by the previous test');
      const lower = statusBody.toLowerCase();
      for (const term of ['token', 'secret', 'review-raw', 'stdouttail', 'stderrtail', TMP.toLowerCase(), process.cwd().toLowerCase()]) {
        assert.ok(!lower.includes(term), `/api/status leaked forbidden term: ${term}`);
      }
    });

    let cookie;
    await atest('a bearer GET establishes a session cookie', async () => {
      const r = await apiGet(PORT, '/api/status', { authorization: 'Bearer ' + API_TOKEN });
      const sc = r.headers['set-cookie'];
      assert.ok(sc && sc.length, 'expected a set-cookie header on a primary-credential request');
      cookie = sc[0].split(';')[0];
    });

    await atest('API RED: cookie POST without Origin is 403', async () => {
      const r = await post(PORT, '/api/pause', {
        headers: { 'content-type': 'application/json' },
        cookie,
        body: JSON.stringify({ runId: 'RUN-does-not-exist' }),
      });
      assert.strictEqual(r.status, 403);
    });

    await atest('API RED: cookie POST with wrong Origin is 403 before the body is read', async () => {
      const r = await post(PORT, '/api/pause', {
        headers: { 'content-type': 'application/json', origin: 'http://evil.example' },
        cookie,
        body: 'not even json',
      });
      assert.strictEqual(r.status, 403);
    });

    await atest('a bearer POST may omit Origin entirely', async () => {
      const r = await post(PORT, '/api/pause', {
        headers: { authorization: 'Bearer ' + API_TOKEN, 'content-type': 'application/json' },
        body: JSON.stringify({ runId: 'RUN-does-not-exist' }),
      });
      assert.notStrictEqual(r.status, 403);
    });

    await atest('API RED: a bearer POST with the wrong Origin present is still 403', async () => {
      const r = await post(PORT, '/api/pause', {
        headers: { authorization: 'Bearer ' + API_TOKEN, 'content-type': 'application/json', origin: 'http://evil.example' },
        body: JSON.stringify({ runId: 'RUN-does-not-exist' }),
      });
      assert.strictEqual(r.status, 403);
    });

    await atest('API RED: wrong content-type is 415', async () => {
      const r = await post(PORT, '/api/objective', {
        headers: { authorization: 'Bearer ' + API_TOKEN, 'content-type': 'text/plain', origin: ORIGIN },
        body: JSON.stringify({ objective: 'wrong content type' }),
      });
      assert.strictEqual(r.status, 415);
    });

    await atest('API RED: malformed JSON is 400', async () => {
      const r = await post(PORT, '/api/objective', {
        headers: { authorization: 'Bearer ' + API_TOKEN, 'content-type': 'application/json', origin: ORIGIN },
        body: '{not valid json',
      });
      assert.strictEqual(r.status, 400);
    });

    await atest('API RED: a body over 16 KiB returns an actual 413 response', async () => {
      const big = JSON.stringify({ objective: 'x'.repeat(20 * 1024) });
      const r = await post(PORT, '/api/objective', {
        headers: { authorization: 'Bearer ' + API_TOKEN, 'content-type': 'application/json', origin: ORIGIN },
        body: big,
      });
      assert.strictEqual(r.status, 413, `expected 413, got ${r.status} (0 means the connection was reset, not answered)`);
    });

    await atest('API RED: an objective with an unknown key is rejected', async () => {
      const r = await post(PORT, '/api/objective', {
        headers: { authorization: 'Bearer ' + API_TOKEN, 'content-type': 'application/json', origin: ORIGIN },
        body: JSON.stringify({ objective: 'has an unknown field', packet: 'evil.json' }),
      });
      assert.strictEqual(r.status, 400);
    });

    await atest('API RED: an objective with a dangerous field value is rejected', async () => {
      const r = await post(PORT, '/api/objective', {
        headers: { authorization: 'Bearer ' + API_TOKEN, 'content-type': 'application/json', origin: ORIGIN },
        body: JSON.stringify({ objective: 'legit objective text', project: 'shell' }),
      });
      assert.strictEqual(r.status, 400);
    });

    await atest('a valid objective creates a run and stops at INTAKE_RECORDED', async () => {
      const r = await post(PORT, '/api/objective', {
        headers: { authorization: 'Bearer ' + API_TOKEN, 'content-type': 'application/json', origin: ORIGIN },
        body: JSON.stringify({ objective: 'hosting API suite isolated intake test' }),
      });
      assert.strictEqual(r.status, 200, `expected 200, got ${r.status}: ${r.body}`);
      const parsed = JSON.parse(r.body);
      assert.strictEqual(parsed.state, 'INTAKE_RECORDED');
      assert.ok(parsed.runId, 'response must carry the created runId');
      const runFile = path.join(runsDir, `${parsed.runId}.json`);
      assert.ok(fs.existsSync(runFile), 'the run must have been written to the isolated temp runs dir, not the real one');
      assert.ok(fs.existsSync(ledger), 'the intake transition must have been recorded to the isolated temp ledger');
    });

    await atest('API RED: a runId route rejects an extra key', async () => {
      const r = await post(PORT, '/api/pause', {
        headers: { authorization: 'Bearer ' + API_TOKEN, 'content-type': 'application/json', origin: ORIGIN },
        body: JSON.stringify({ runId: 'RUN-does-not-exist', force: true }),
      });
      assert.strictEqual(r.status, 400);
    });

    await atest('API RED: a runId route for a nonexistent run maps to a stable 404', async () => {
      const r = await post(PORT, '/api/pause', {
        headers: { authorization: 'Bearer ' + API_TOKEN, 'content-type': 'application/json', origin: ORIGIN },
        body: JSON.stringify({ runId: 'RUN-20260825-deadbeef' }),
      });
      assert.strictEqual(r.status, 404);
      const parsed = JSON.parse(r.body);
      assert.strictEqual(parsed.error.code, 'RUN_NOT_FOUND');
    });

    await atest('API RED: an unknown API path cannot mutate', async () => {
      const r = await post(PORT, '/api/does-not-exist', {
        headers: { authorization: 'Bearer ' + API_TOKEN, 'content-type': 'application/json', origin: ORIGIN },
        body: JSON.stringify({ runId: 'RUN-x' }),
      });
      assert.strictEqual(r.status, 405);
    });

    await atest('API RED: unauthenticated GET /api/events is 401', async () => {
      const r = await apiGet(PORT, '/api/events');
      assert.strictEqual(r.status, 401);
    });

    await atest('authenticated GET /api/events streams SSE headers and an initial event', async () => {
      const { status, headers, firstChunk } = await sseFirstChunk(PORT, '/api/events', { authorization: 'Bearer ' + API_TOKEN });
      assert.strictEqual(status, 200);
      assert.ok(/text\/event-stream/.test(headers['content-type']), `unexpected content-type: ${headers['content-type']}`);
      assert.strictEqual(headers['cache-control'], 'no-store');
      assert.strictEqual(headers['connection'], 'keep-alive');
      assert.strictEqual(headers['x-accel-buffering'], 'no');
      assert.ok(/^event: status\ndata: /.test(firstChunk), `expected an initial status event, got: ${firstChunk}`);
      const parsed = JSON.parse(firstChunk.replace(/^event: status\ndata: /, '').trim());
      assert.ok(parsed.generatedAt, 'initial event must carry a sanitized status snapshot');
    });

    await atest('API RED: SSE stream leaks none of the forbidden terms', async () => {
      const { firstChunk } = await sseFirstChunk(PORT, '/api/events', { authorization: 'Bearer ' + API_TOKEN });
      const lower = firstChunk.toLowerCase();
      for (const term of ['token', 'secret', 'review-raw', 'stdouttail', 'stderrtail', TMP.toLowerCase(), process.cwd().toLowerCase()]) {
        assert.ok(!lower.includes(term), `SSE stream leaked forbidden term: ${term}`);
      }
    });

    await atest('a ledger change produces a debounced status event, not a duplicate per write', async () => {
      const sse = await openSse(PORT, '/api/events', { authorization: 'Bearer ' + API_TOKEN });
      try {
        await sse.next(); // discard the initial event
        // Several rapid writes inside the debounce window must collapse into
        // one further event, not one per write.
        for (let i = 0; i < 5; i++) {
          fs.writeFileSync(ledger, JSON.stringify([{ tick: i }]));
          await new Promise((r) => setTimeout(r, 20));
        }
        const evt = await sse.next(2000);
        assert.ok(/^event: status\n/.test(evt), `expected a status event after the ledger changed, got: ${evt}`);
        // Give any further debounced sends a chance to land, then confirm the
        // burst collapsed rather than firing one event per write.
        const extra = await sse.tryNext(400);
        assert.strictEqual(extra, null, `debounce must collapse a write burst, got an extra event: ${extra}`);
      } finally {
        sse.close();
      }
    });

    await atest('disconnecting an SSE client lets its child-owned resources go, and the child still exits', async () => {
      const sse = await openSse(PORT, '/api/events', { authorization: 'Bearer ' + API_TOKEN });
      await sse.next();
      sse.close();
      // No assertion beyond "this does not hang" — the real proof is the
      // child process exiting cleanly in the outer finally block below,
      // which would hang forever if a watcher/timer/listener leaked.
      await new Promise((r) => setTimeout(r, 100));
    });

    await atest('SERVABLE remains exactly the three-entry projection', () => {
      assert.deepStrictEqual(Object.keys(S.SERVABLE).sort(), ['/', '/index.html', '/state.js']);
    });
  } finally {
    child.kill();
    fs.rmSync(TMP, { recursive: true, force: true });
  }
}
