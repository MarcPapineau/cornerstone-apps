// tests/ops/windmill-healthcheck.test.js
//
// Tests for scripts/ops/windmill-healthcheck.sh — drives the script via env-
// injected fakes for `docker` and `curl` so we never touch the real Docker
// daemon or hit Resend.
//
// Strategy:
//   - For each test, we build a temp dir, drop fake `docker` + `curl` shims
//     into it, prepend it to PATH, and run the script with a controlled
//     compose file + cooldown file + log file.
//   - The shims read scripted output from env vars and append every call
//     they receive to a log file in the temp dir, which the test reads back.
//
// Run: node --test tests/ops/windmill-healthcheck.test.js
//
// Tests added in PR #27 (vs. PR #26 baseline):
//   1. filter ignores stale orphan containers outside allowlist
//   2. cooldown lockfile actually written after repair
//   3. cooldown suppresses alert on next run within 900s window
//   4. missing Resend key file does NOT crash repair flow
//   5. missing watched container is hard fault
//   6. running-but-unhealthy (Health.Status=unhealthy) is unhealthy
//
// Tests #1–#3 are the regression guards for the three production bugs the
// LaunchAgent first-run revealed (substring filter, missing lockfile, alert-
// path silence). The pre-fix tests mocked a 3-container ideal state and
// passed against fiction (Habakkuk Pattern F: tests pass that don't reflect
// production). Those tests have been replaced/extended here.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.resolve(__dirname, '..', '..', 'scripts', 'ops', 'windmill-healthcheck.sh');

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function makeSandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'windmill-hc-test-'));
  // dirs the script writes into
  fs.mkdirSync(path.join(dir, 'logs'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'bin'), { recursive: true });
  // fake compose file (existence-checked by repair_stack)
  fs.writeFileSync(path.join(dir, 'compose.yml'), 'services: {}\n');
  return dir;
}

// Writes a fake `docker` shim into <sandbox>/bin/docker.
//
// The shim consults SCRIPT_DOCKER_INSPECT_MAP — a JSON map of:
//   container-name -> { exit: 0|1, stdout: "<status>" }
// — to mock `docker inspect --format '{{.State.Status}}' NAME`.
//
// For the second-form Health-status inspect call, it consults
// SCRIPT_DOCKER_HEALTH_MAP — same shape, defaults to running+empty if unset.
//
// `docker compose ... up -d` writes to a sentinel file so tests can assert it ran.
function writeDockerShim(sandbox) {
  const shimPath = path.join(sandbox, 'bin', 'docker');
  // The shim is a tiny bash program that looks at its argv and dispatches.
  // It uses node to do JSON lookups — node is on PATH in the test env.
  const shim = `#!/usr/bin/env bash
set -u
LOG="${sandbox}/logs/docker-calls.log"
echo "$@" >> "$LOG"

if [ "$1" = "inspect" ] && [ "$2" = "--format" ]; then
  fmt="$3"
  name="$4"
  if [[ "$fmt" == *"State.Status"* ]] && [[ "$fmt" != *"Health"* ]]; then
    out=$(node -e '
      const m = JSON.parse(process.env.SCRIPT_DOCKER_INSPECT_MAP || "{}");
      const v = m[process.argv[1]];
      if (!v) { process.exit(1); }
      if (v.exit !== 0) { process.exit(v.exit); }
      process.stdout.write(v.stdout);
    ' "$name") || exit 1
    echo "$out"
    exit 0
  fi
  if [[ "$fmt" == *"Health"* ]]; then
    out=$(node -e '
      const m = JSON.parse(process.env.SCRIPT_DOCKER_HEALTH_MAP || "{}");
      const v = m[process.argv[1]];
      if (!v) { process.stdout.write(""); process.exit(0); }
      process.stdout.write(v.stdout || "");
    ' "$name")
    echo "$out"
    exit 0
  fi
fi

if [ "$1" = "compose" ]; then
  echo "compose-up-attempted" > "${sandbox}/logs/compose-ran.sentinel"
  exit 0
fi

# Default: succeed silently.
exit 0
`;
  fs.writeFileSync(shimPath, shim);
  fs.chmodSync(shimPath, 0o755);
}

// Fake `curl` shim — appends every invocation's args to a log so we can count
// alert sends. Returns HTTP 200 by default, or whatever SCRIPT_CURL_HTTP_CODE
// says.
function writeCurlShim(sandbox) {
  const shimPath = path.join(sandbox, 'bin', 'curl');
  const shim = `#!/usr/bin/env bash
set -u
LOG="${sandbox}/logs/curl-calls.log"
echo "$@" >> "$LOG"
echo -n "\${SCRIPT_CURL_HTTP_CODE:-200}"
exit 0
`;
  fs.writeFileSync(shimPath, shim);
  fs.chmodSync(shimPath, 0o755);
}

// Run the healthcheck script against a sandbox, with given env overrides.
function runScript(sandbox, env = {}) {
  writeDockerShim(sandbox);
  writeCurlShim(sandbox);

  const composedEnv = {
    PATH: `${path.join(sandbox, 'bin')}:${process.env.PATH || ''}`,
    HOME: sandbox,
    WINDMILL_COMPOSE_FILE: path.join(sandbox, 'compose.yml'),
    WINDMILL_COOLDOWN_FILE: path.join(sandbox, 'cooldown.lock'),
    WINDMILL_LOG_FILE: path.join(sandbox, 'logs', 'hc.log'),
    RESEND_KEY_FILE: path.join(sandbox, 'resend-key'),
    // Empty by default → file path is checked; tests opt-in via env or file.
    ...env,
  };

  const result = spawnSync('bash', [SCRIPT], {
    env: composedEnv,
    encoding: 'utf8',
    timeout: 15_000,
  });

  return {
    code: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    log: fs.existsSync(composedEnv.WINDMILL_LOG_FILE)
      ? fs.readFileSync(composedEnv.WINDMILL_LOG_FILE, 'utf8')
      : '',
    cooldownExists: fs.existsSync(composedEnv.WINDMILL_COOLDOWN_FILE),
    cooldownPath: composedEnv.WINDMILL_COOLDOWN_FILE,
    composeRan: fs.existsSync(path.join(sandbox, 'logs', 'compose-ran.sentinel')),
    curlCalls: fs.existsSync(path.join(sandbox, 'logs', 'curl-calls.log'))
      ? fs.readFileSync(path.join(sandbox, 'logs', 'curl-calls.log'), 'utf8').split('\n').filter(Boolean)
      : [],
    dockerCalls: fs.existsSync(path.join(sandbox, 'logs', 'docker-calls.log'))
      ? fs.readFileSync(path.join(sandbox, 'logs', 'docker-calls.log'), 'utf8').split('\n').filter(Boolean)
      : [],
  };
}

// Helper: build a status map for the 3 watched containers in one call.
function statusMap(post = 'running', worker = 'running', wm = 'running') {
  const ok = (s) => ({ exit: 0, stdout: s });
  return JSON.stringify({
    'windmill-postgres-1': ok(post),
    'windmill-worker': ok(worker),
    'windmill-windmill-1': ok(wm),
  });
}

// Helper: status map plus an ORPHAN container that the old substring filter
// would have matched. The new allowlist must NOT inspect or care about it.
// We assert that by asserting `docker inspect` was never called for it.
function statusMapWithOrphan() {
  const ok = (s) => ({ exit: 0, stdout: s });
  return JSON.stringify({
    'windmill-postgres-1': ok('running'),
    'windmill-worker': ok('running'),
    'windmill-windmill-1': ok('running'),
    // The orphan: would be flagged exited if the script asked about it.
    'windmill': ok('exited'),
  });
}

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

test('Bug 1 regression: filter ignores stale orphan containers outside allowlist', () => {
  const sandbox = makeSandbox();
  const result = runScript(sandbox, {
    SCRIPT_DOCKER_INSPECT_MAP: statusMapWithOrphan(),
  });

  assert.equal(result.code, 0, 'script must exit 0 on healthy stack');
  assert.match(result.log, /VERDICT: HEALTHY/, 'verdict must be HEALTHY despite orphan');
  assert.doesNotMatch(result.log, /UNHEALTHY/, 'no UNHEALTHY line should appear');
  assert.equal(result.composeRan, false, 'repair must NOT run when watched containers are healthy');

  // Belt + suspenders: the orphan name must never appear in any docker
  // inspect call argv (allowlist is hardcoded, no shell-glob in sight).
  const orphanInspections = result.dockerCalls.filter((line) => /\bwindmill\b\s*$/.test(line) && !/windmill-/.test(line));
  assert.equal(orphanInspections.length, 0, 'orphan must never be inspected');
});

test('Bug 2 regression: cooldown lockfile actually written after repair', () => {
  const sandbox = makeSandbox();
  const result = runScript(sandbox, {
    SCRIPT_DOCKER_INSPECT_MAP: statusMap('running', 'exited', 'running'),
  });

  assert.equal(result.code, 0);
  assert.match(result.log, /VERDICT: UNHEALTHY/);
  assert.equal(result.composeRan, true, 'repair must run on unhealthy verdict');
  assert.equal(
    result.cooldownExists,
    true,
    'cooldown lockfile must exist on disk after a repair flow',
  );
  assert.equal(
    fs.existsSync(result.cooldownPath),
    true,
    'fs.existsSync confirms cooldown path',
  );
  // Mtime should be very recent (<10s).
  const ageSec = (Date.now() / 1000) - fs.statSync(result.cooldownPath).mtimeMs / 1000;
  assert.ok(ageSec < 10, `cooldown mtime should be fresh (got age=${ageSec}s)`);
});

test('Bug 2/3 regression: cooldown suppresses alert on second run within window', () => {
  const sandbox = makeSandbox();
  // Pre-write a Resend key file so alert path is enabled.
  fs.writeFileSync(path.join(sandbox, 'resend-key'), 'test-key-xyz', { mode: 0o600 });

  // First run: unhealthy → repair → alert sent → cooldown written.
  const r1 = runScript(sandbox, {
    SCRIPT_DOCKER_INSPECT_MAP: statusMap('running', 'exited', 'running'),
  });
  assert.equal(r1.cooldownExists, true);
  assert.equal(r1.curlCalls.length, 1, 'first run sends exactly one alert');

  // Wipe just the curl-call log so the second run's count is independent.
  // (docker shim is rewritten by runScript anyway.)
  fs.rmSync(path.join(sandbox, 'logs', 'curl-calls.log'), { force: true });
  fs.rmSync(path.join(sandbox, 'logs', 'compose-ran.sentinel'), { force: true });

  // Second run, 0 seconds later: still unhealthy → repair runs → alert SUPPRESSED.
  const r2 = runScript(sandbox, {
    SCRIPT_DOCKER_INSPECT_MAP: statusMap('running', 'exited', 'running'),
  });
  assert.equal(r2.composeRan, true, 'repair still runs during cooldown (cooldown is for alerts only)');
  assert.equal(r2.curlCalls.length, 0, 'second run within cooldown window must NOT call curl');
  assert.match(r2.log, /COOLDOWN: alert suppressed/, 'log explains the suppression');
});

test('Bug 3 regression: missing Resend key (env + file) does NOT crash repair flow', () => {
  const sandbox = makeSandbox();
  // Note: no resend-key file written, no RESEND_API_KEY env. This is the
  // exact launchd minimal-env scenario from the prod first-run.
  const result = runScript(sandbox, {
    SCRIPT_DOCKER_INSPECT_MAP: statusMap('running', 'exited', 'running'),
  });

  assert.equal(result.code, 0, 'set -e must not kill the script on missing key');
  assert.equal(result.composeRan, true, 'repair must still run');
  assert.equal(result.cooldownExists, true, 'cooldown still written');
  assert.match(
    result.log,
    /WARN: no RESEND_API_KEY .* alert skipped, repair still ran/,
    'explicit warn line documents the skip',
  );
  assert.equal(result.curlCalls.length, 0, 'no Resend HTTP call attempted');
});

test('missing watched container is a hard fault (UNHEALTHY verdict)', () => {
  const sandbox = makeSandbox();
  // postgres returns exit=1 from `docker inspect` → script reads "missing".
  const map = JSON.parse(statusMap());
  map['windmill-postgres-1'] = { exit: 1, stdout: '' };
  const result = runScript(sandbox, {
    SCRIPT_DOCKER_INSPECT_MAP: JSON.stringify(map),
  });

  assert.equal(result.code, 0);
  assert.match(result.log, /UNHEALTHY: windmill-postgres-1 status=missing/);
  assert.match(result.log, /VERDICT: UNHEALTHY/);
  assert.equal(result.composeRan, true);
  assert.equal(result.cooldownExists, true);
});

test('running-but-unhealthy (Health.Status=unhealthy) is unhealthy', () => {
  const sandbox = makeSandbox();
  // All three say running, but worker has Health.Status=unhealthy.
  const result = runScript(sandbox, {
    SCRIPT_DOCKER_INSPECT_MAP: statusMap('running', 'running', 'running'),
    SCRIPT_DOCKER_HEALTH_MAP: JSON.stringify({
      'windmill-postgres-1': { stdout: 'healthy' },
      'windmill-worker': { stdout: 'unhealthy' },
      'windmill-windmill-1': { stdout: '' },
    }),
  });

  assert.equal(result.code, 0);
  assert.match(result.log, /UNHEALTHY: windmill-worker status=running-unhealthy/);
  assert.equal(result.composeRan, true);
});

test('all healthy → no repair, no cooldown, no alert', () => {
  const sandbox = makeSandbox();
  const result = runScript(sandbox, {
    SCRIPT_DOCKER_INSPECT_MAP: statusMap(),
  });

  assert.equal(result.code, 0);
  assert.match(result.log, /VERDICT: HEALTHY/);
  assert.equal(result.composeRan, false);
  assert.equal(result.cooldownExists, false);
  assert.equal(result.curlCalls.length, 0);
});

test('alert send fires when key file present and stack unhealthy (no cooldown yet)', () => {
  const sandbox = makeSandbox();
  fs.writeFileSync(path.join(sandbox, 'resend-key'), 'test-key-xyz', { mode: 0o600 });
  const result = runScript(sandbox, {
    SCRIPT_DOCKER_INSPECT_MAP: statusMap('running', 'exited', 'running'),
  });

  assert.equal(result.code, 0);
  assert.equal(result.curlCalls.length, 1, 'one Resend POST');
  assert.match(result.curlCalls[0], /api\.resend\.com\/emails/);
  assert.match(result.log, /alert sent/);
});

test('Resend non-2xx response is logged but does not fail script', () => {
  const sandbox = makeSandbox();
  fs.writeFileSync(path.join(sandbox, 'resend-key'), 'test-key-xyz', { mode: 0o600 });
  const result = runScript(sandbox, {
    SCRIPT_DOCKER_INSPECT_MAP: statusMap('running', 'exited', 'running'),
    SCRIPT_CURL_HTTP_CODE: '500',
  });

  assert.equal(result.code, 0);
  assert.match(result.log, /WARN: alert send returned http=500/);
  assert.equal(result.composeRan, true);
  assert.equal(result.cooldownExists, true);
});

test('RESEND_API_KEY env takes precedence over file (and works under env-only)', () => {
  const sandbox = makeSandbox();
  // No file written; env present.
  const result = runScript(sandbox, {
    SCRIPT_DOCKER_INSPECT_MAP: statusMap('running', 'exited', 'running'),
    RESEND_API_KEY: 'env-key-abc',
  });

  assert.equal(result.code, 0);
  assert.equal(result.curlCalls.length, 1);
  assert.match(result.curlCalls[0], /Authorization: Bearer env-key-abc/);
});

test('multiple unhealthy containers: all reported in single log line', () => {
  const sandbox = makeSandbox();
  const result = runScript(sandbox, {
    SCRIPT_DOCKER_INSPECT_MAP: statusMap('exited', 'restarting', 'running'),
  });

  assert.equal(result.code, 0);
  assert.match(result.log, /VERDICT: UNHEALTHY \(2\/3 bad/);
  assert.match(result.log, /windmill-postgres-1=exited/);
  assert.match(result.log, /windmill-worker=restarting/);
});
