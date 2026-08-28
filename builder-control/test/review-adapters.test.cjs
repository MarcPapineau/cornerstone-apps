#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const {
  detect,
  extractJson,
  stopWasAbnormal,
  looksUnfinished,
  buildRecord,
  codexPrompt,
  grokPrompt,
  TOOLS,
  isUsableReview,
  runTool,
  prepareReviewSandbox,
  REVIEW_SANDBOX_PREFIX,
  MAX_REVIEW_FILES,
  MAX_REVIEW_BYTES,
} = require('../review-adapters.cjs');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`ok   ${name}`); }
  catch (e) { console.error(`FAIL ${name}: ${e.message}`); process.exitCode = 1; }
}

function reviewSandboxRoots() {
  const parent = path.dirname(REVIEW_SANDBOX_PREFIX);
  const prefix = path.basename(REVIEW_SANDBOX_PREFIX);
  return fs.readdirSync(parent, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
    .map((entry) => path.join(parent, entry.name))
    .sort();
}

function assertNoNewReviewSandbox(before, label) {
  const after = reviewSandboxRoots();
  const leaked = after.filter((value) => !before.includes(value));
  for (const root of leaked) {
    for (const rel of [path.join('home', '.grok', 'auth.json'), path.join('home', '.codex', 'auth.json')]) {
      assert.strictEqual(fs.existsSync(path.join(root, rel)), false, `${label}: copied auth survived at ${rel}`);
    }
  }
  assert.deepStrictEqual(after, before, `${label}: review sandbox root survived preparation failure`);
}

function assertAtomicPreparationFailure(label, action, expected) {
  const before = reviewSandboxRoots();
  assert.throws(action, expected);
  assertNoNewReviewSandbox(before, label);
}

const subject = {
  subjectSha256: 'a'.repeat(64),
  subjectPaths: ['src/app.ts'],
};
const base = {
  reviewer: 'codex',
  reviewerModel: 'test-model',
  packetId: 'PKT-test',
  subject,
  ts: '2026-08-23T04:00:00Z',
};

console.log('Engineering OS — review adapter fixtures');

test('doctor reports every configured role without claiming a review ran', () => {
  const d = detect();
  assert.deepStrictEqual(Object.keys(d).sort(), ['codex', 'copilot', 'grok']);
  for (const value of Object.values(d)) assert.ok(['AVAILABLE', 'UNAVAILABLE', 'UNVERIFIED'].includes(value.status));
});

test('balanced JSON is extracted through surrounding prose', () => {
  assert.deepStrictEqual(extractJson('before {"disposition":"APPROVE","findings":[]} after'), {
    disposition: 'APPROVE', findings: [],
  });
});

test('unparseable output becomes UNAVAILABLE, never APPROVE', () => {
  const record = buildRecord({ ...base, parsed: null, unavailableReason: 'no parseable output' });
  assert.strictEqual(record.disposition, 'UNAVAILABLE');
  assert.strictEqual(record.unavailableReason, 'no parseable output');
  assert.deepStrictEqual(record.findings, []);
});

test('a real reviewer approval binds to the exact subject', () => {
  const record = buildRecord({ ...base, parsed: { disposition: 'APPROVE', findings: [], unverified: [] } });
  assert.strictEqual(record.disposition, 'APPROVE');
  assert.strictEqual(record.reviewOf.diffSha256, subject.subjectSha256);
  assert.deepStrictEqual(record.reviewOf.changedPaths, subject.subjectPaths);
});

test('unevidenced findings are discarded rather than becoming gate evidence', () => {
  const record = buildRecord({
    ...base,
    parsed: { disposition: 'REJECT', findings: [{ severity: 'HIGH', problem: 'guess', evidence: '' }] },
  });
  assert.deepStrictEqual(record.findings, []);
});

test('review prompts are bounded to objective, subject and diff', () => {
  const codex = codexPrompt('Build objective', subject, 'diff --git a b');
  const grok = grokPrompt('Build objective', subject, 'diff --git a b');
  for (const prompt of [codex, grok]) {
    assert.ok(prompt.includes('Build objective'));
    assert.ok(prompt.includes('src/app.ts'));
    assert.ok(prompt.includes('diff --git a b'));
  }
});

// RED PROOF — the doctor must resolve the reviewers at their ABSOLUTE install
// paths. Neither tool puts itself on PATH here, so an earlier `command -v codex`
// check reported Codex as absent while it was installed all along. Reporting a
// present tool as missing is not a safe failure: it silently downgrades the
// review lane and makes the gate look satisfied by fewer reviewers.
test('doctor resolves Codex and Grok at their recorded absolute paths', () => {
  assert.strictEqual(TOOLS.codex.bin, '/Applications/ChatGPT.app/Contents/Resources/codex');
  assert.strictEqual(TOOLS.grok.bin, '/Users/marcpapineau/.grok/downloads/grok-macos-aarch64');

  const d = detect();
  for (const name of ['codex', 'grok']) {
    assert.ok(d[name], `doctor omitted ${name}`);
    assert.strictEqual(d[name].bin, TOOLS[name].bin, `${name} reported at the wrong path`);
    assert.ok(['AVAILABLE', 'UNAVAILABLE'].includes(d[name].status));
    // The status must agree with the filesystem — no optimism, no pessimism.
    const onDisk = fs.existsSync(TOOLS[name].bin);
    assert.strictEqual(d[name].status === 'AVAILABLE', onDisk,
      `${name}: doctor says ${d[name].status} but existsSync says ${onDisk}`);
    assert.ok(d[name].detail && d[name].detail.length > 0, `${name} has no detail`);
  }
});

// ── COPILOT: a LOCAL CLI, an UNVERIFIED entitlement, and no approval ──────
// This block replaces a proof that asserted "Copilot has no local binary and
// its capability sits behind a plan entitlement, therefore report UNVERIFIED".
// The first clause is now false — /opt/homebrew/bin/copilot is a real symlink
// to a real cask — and the test was failing against the corrected adapter.
// The clause that was RIGHT and must survive is the second one: install and
// login presence prove nothing about entitlement. So the two facts are now
// separated into two fields instead of being collapsed into one status, which
// is what let the old reading drift in the first place.
test('RED: Copilot is recognised as a LOCAL CLI at its recorded absolute path', () => {
  assert.strictEqual(TOOLS.copilot.bin, '/opt/homebrew/bin/copilot',
    'Copilot is installed locally; addressing it as a remote API brought back the false-absent bug');
  const d = detect();
  assert.ok(d.copilot, 'doctor omitted copilot');
  // Install status is filesystem truth in BOTH directions — no optimism when
  // it is missing, and no residual pessimism now that it is present.
  const onDisk = fs.existsSync(TOOLS.copilot.bin);
  assert.strictEqual(d.copilot.status === 'AVAILABLE', onDisk,
    `doctor says ${d.copilot.status} but existsSync says ${onDisk}`);
});

test('RED: entitlement is UNVERIFIED for EVERY worker, including installed ones', () => {
  const d = detect();
  for (const [name, r] of Object.entries(d)) {
    // The dangerous case is precisely the one that looks fine: present,
    // executable, logged in — and still not proof that a review may be run.
    assert.strictEqual(r.entitlement, 'UNVERIFIED',
      `${name} reports entitlement ${r.entitlement}; nothing this doctor observes can establish one`);
    assert.ok(r.entitlementReason && r.entitlementReason.length > 0,
      `${name} states no reason for an UNVERIFIED entitlement`);
    // Install presence must never be quietly promoted into an entitlement.
    assert.notStrictEqual(r.entitlement, r.status,
      `${name} lets install status stand in for entitlement`);
  }
});

test('RED: the doctor never claims a review ran, and never spends anything', () => {
  const d = detect();
  for (const [name, r] of Object.entries(d)) {
    assert.ok(!/\breview (ran|was run|completed|passed|approved)\b/i.test(r.detail),
      `${name}: the doctor described a review it did not perform`);
    assert.ok(/filesystem/i.test(r.observes),
      `${name}: the doctor must state that it observes the filesystem only`);
  }
  // The 2026-08-25 defect was a probe that REASONED: it ran a different tool,
  // found it authenticated, and derived a claim about a third thing. Check the
  // code, not the comment — the comment already says the right thing.
  const src = fs.readFileSync(path.join(__dirname, '..', 'review-adapters.cjs'), 'utf8');
  const from = src.indexOf('function detect(');
  const to = src.indexOf('function subjectOf(');
  assert.ok(from !== -1 && to > from, 'could not isolate the detection path');
  const detectionPath = src.slice(from, to)
    .split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  for (const forbidden of ['spawnSync', 'execSync', 'spawn(', 'exec(']) {
    assert.ok(!detectionPath.includes(forbidden),
      `the doctor launches a subprocess (${forbidden}) — a probe that runs something can spend credits and can be wrong in a direction nobody checks`);
  }
});

test('RED: Copilot is ADVISORY — refused as a gate reviewer even though the canon says AVAILABLE', () => {
  const { authorizeLaunch } = require('../review-adapters.cjs');
  const canon = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'TOOL-CAPABILITY-CANON.json'), 'utf8'));
  const t = (canon.tools || []).find((x) => x.toolId === 'copilot-cli');
  assert.ok(t, 'copilot-cli is not declared in the Tool Capability Canon');
  assert.strictEqual(t.approvalAuthority, 'NONE',
    'the canon must record that Copilot holds no approval authority');

  // The whole point: this refusal must NOT depend on the tool being broken,
  // missing or blocked. It is AVAILABLE, installed and executable here, and it
  // is still refused — because availability and authority are different
  // questions, and a working binary next to two reviewer binaries is exactly
  // what tempts someone to answer the second by looking at the first.
  assert.strictEqual(t.availability, 'AVAILABLE',
    'this proof is only meaningful while Copilot is genuinely available');
  assert.strictEqual(detect().copilot.status, 'AVAILABLE',
    'this proof is only meaningful while the Copilot binary is genuinely executable here');

  const r = authorizeLaunch('copilot');
  assert.strictEqual(r.ok, false, 'an AVAILABLE Copilot was authorised as a gate reviewer');
  assert.ok(/advisor/i.test(r.reason) && /approv/i.test(r.reason),
    `the refusal must name advisory status and the absence of approval authority, got: ${r.reason}`);
  assert.strictEqual(detect().copilot.advisoryOnly, true);
  assert.ok(/ADVISORY ONLY/.test(detect().copilot.detail),
    'the doctor line for an advisory worker must say so where an operator reads it');
});

test('RED: no launch argv exists for an advisory or unknown worker', () => {
  const { buildToolArgv } = require('../review-adapters.cjs');
  // Falling through to Grok's argv would build a real, runnable command line
  // for a worker that must never be launched.
  assert.throws(() => buildToolArgv('copilot', 'P', null), /no launch argv/i,
    'Copilot silently inherited another reviewer\'s command line');
  assert.throws(() => buildToolArgv('nonesuch', 'P', null), /no launch argv/i);
});

// ── CODEX / GROK FAIL-CLOSED SEMANTICS ARE UNCHANGED ─────────────────────
// Adding a third worker must not loosen the two that gate anything. These
// assert the INVARIANT against whatever the canon currently says, rather than
// pinning a literal — pinning is how "declared in policy, enforced nowhere"
// passed a test suite once already.
test('RED: a reviewer that is not positively AVAILABLE in the canon is refused', () => {
  const { authorizeLaunch } = require('../review-adapters.cjs');
  const canon = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'TOOL-CAPABILITY-CANON.json'), 'utf8'));
  for (const [reviewer, toolId] of [['codex', 'codex-local'], ['grok', 'grok-cli']]) {
    const t = (canon.tools || []).find((x) => x.toolId === toolId);
    assert.ok(t, `${toolId} is not declared in the canon`);
    if (t.availability === 'AVAILABLE') continue; // covered by the evidence proof below
    const r = authorizeLaunch(reviewer);
    assert.strictEqual(r.ok, false,
      `${reviewer} is ${t.availability} in the canon and was authorised anyway`);
    assert.ok(new RegExp(t.availability).test(r.reason),
      `the refusal must name the canon state, got: ${r.reason}`);
  }
});

test('RED: an AVAILABLE reviewer still needs DATED evidence behind it', () => {
  const canon = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'TOOL-CAPABILITY-CANON.json'), 'utf8'));
  for (const toolId of ['codex-local', 'grok-cli', 'copilot-cli']) {
    const t = (canon.tools || []).find((x) => x.toolId === toolId);
    if (!t || t.availability !== 'AVAILABLE') continue;
    assert.ok(t.availabilityEvidence && t.availabilityEvidence.observedAt,
      `${toolId} is AVAILABLE with no dated evidence — AVAILABLE without a date is a claim, not an observation`);
    assert.ok(t.availabilityEvidence.method && t.availabilityEvidence.result,
      `${toolId} evidence names no method or result`);
  }
});

// The absolute-path constants are the contract. If someone "helpfully" changes
// them to a bare command name, PATH resolution comes back and the earlier
// false-absent bug returns.
test('reviewer binaries are addressed absolutely, never by bare command name', () => {
  for (const [name, t] of Object.entries(TOOLS)) {
    assert.ok(path.isAbsolute(t.bin), `${name} is not an absolute path: ${t.bin}`);
    assert.ok(t.role && t.label, `${name} is missing role/label`);
  }
});

// ── RED PROOF: declared bounds must be ENFORCED, not merely declared ───────
// This exists because of a real failure on 2026-08-24: MODEL-ROUTING-POLICY
// declared maxTurns:1 for the adversarial reviewer, the adapter never passed
// --max-turns, and a live run went 13 turns and returned no record. The policy
// read as governance and enforced nothing. Every bound the policy states must
// now appear on the actual command line.
test('RED: every declared Grok bound appears on the real command line', () => {
  const { buildToolArgv } = require('../review-adapters.cjs');
  const bounds = require('../tool-router.cjs').loadPolicy().roles['adversarial-review'].bounds;
  const argv = buildToolArgv('grok', 'PROMPT', bounds, '/private/tmp/review-fixture');

  // Not pinned to a literal: the point of this proof is that WHATEVER the
  // policy declares reaches the command line. Hard-coding the number here is
  // what made this test pass while maxTurns:1 silently starved the reviewer.
  assert.ok(Number.isInteger(bounds.maxTurns) && bounds.maxTurns > 0,
    'the policy must declare a positive turn budget');
  const i = argv.indexOf('--max-turns');
  assert.ok(i !== -1, 'maxTurns is declared but --max-turns is not passed — declared-not-enforced');
  assert.strictEqual(argv[i + 1], String(bounds.maxTurns), '--max-turns must carry the policy value');

  assert.ok(argv.includes('--disable-web-search'), 'webAccess:false must disable web search');
  assert.ok(!argv.includes('--agents'), 'subagents:false is expressed by omitting --agents entirely');
  assert.ok(argv.includes('-p'), 'must run in single-turn print mode');
  for (const forbidden of ['--always-approve', '--permission-mode']) {
    assert.ok(!argv.includes(forbidden), `${forbidden} must never be passed to a read-only reviewer`);
  }
});

test('RED: a tightened policy bound propagates to the command line', () => {
  const { buildToolArgv } = require('../review-adapters.cjs');
  const argv = buildToolArgv('grok', 'P', { maxTurns: 3, webAccess: false, subagents: false }, '/private/tmp/review-fixture');
  assert.strictEqual(argv[argv.indexOf('--max-turns') + 1], '3',
    'the adapter must read the bound from the policy, not hardcode it');
});

test('RED: Codex runs under a read-only sandbox, always', () => {
  const { buildToolArgv } = require('../review-adapters.cjs');
  const argv = buildToolArgv('codex', 'P', null);
  const i = argv.indexOf('--sandbox');
  assert.ok(i !== -1 && argv[i + 1] === 'read-only',
    'read-only must be enforced at the tool, not requested in the prompt');
});

test('RED: Codex review is isolated from interactive config and persisted sessions', () => {
  const { buildToolArgv, REVIEW_SANDBOX_PREFIX } = require('../review-adapters.cjs');
  const argv = buildToolArgv('codex', 'P', null);
  for (const flag of ['--ephemeral', '--ignore-user-config', '--ignore-rules']) {
    assert.ok(argv.includes(flag), `Codex review is missing ${flag}`);
  }
  assert.ok(!argv.includes(path.resolve(__dirname, '..', '..')),
    'Codex review must not receive the repository as its working root');
  assert.ok(REVIEW_SANDBOX_PREFIX.startsWith(require('os').tmpdir()));
});

test('RED: Grok review disables imported MCPs, subagents and interactive rules', () => {
  const { buildToolArgv, prepareReviewSandbox, cleanupReviewSandbox } = require('../review-adapters.cjs');
  const sandbox = prepareReviewSandbox();
  const argv = buildToolArgv('grok', 'P', { maxTurns: 3, webAccess: false, subagents: false }, sandbox.cwd);
  assert.strictEqual(argv[argv.indexOf('--cwd') + 1], sandbox.cwd);
  assert.ok(argv.includes('--no-subagents'));
  assert.ok(argv.includes('--verbatim'));
  const deny = argv[argv.indexOf('--disallowed-tools') + 1];
  assert.ok(!deny.split(',').includes('Read'), 'Read must remain available for the exact copied subject');
  for (const tool of ['Grep', 'Bash', 'Edit', 'MCPTool', 'WebFetch', 'WebSearch']) {
    assert.ok(deny.split(',').includes(tool), `Grok review did not disable ${tool}`);
  }
  const config = fs.readFileSync(path.join(sandbox.home, '.grok', 'config.toml'), 'utf8');
  assert.match(config, /\[compat\.claude\][\s\S]*mcps = false/);
  assert.match(config, /\[managed_mcps\][\s\S]*enabled = false/);
  const authPath = path.join(sandbox.home, '.grok', 'auth.json');
  if (fs.existsSync(path.join(require('os').homedir(), '.grok', 'auth.json'))) {
    assert.ok(fs.lstatSync(authPath).isFile(), 'review harness auth must be a private regular file');
    assert.ok(!fs.lstatSync(authPath).isSymbolicLink(), 'review harness must not symlink operator auth');
    assert.strictEqual(fs.statSync(authPath).mode & 0o777, 0o400, 'review auth copy must be immutable and owner-readable only');
  }
  assert.ok(!authPath.startsWith(sandbox.cwd + path.sep), 'reviewer auth must be outside the readable source cwd');
  cleanupReviewSandbox(sandbox);
  assert.ok(!fs.existsSync(sandbox.root), 'review sandbox must be removable after the subprocess');
});

test('RED: every review gets a unique private directory with no pre-existing entries', () => {
  const { prepareReviewSandbox, cleanupReviewSandbox, REVIEW_SANDBOX_PREFIX } = require('../review-adapters.cjs');
  const a = prepareReviewSandbox();
  const b = prepareReviewSandbox();
  try {
    assert.notStrictEqual(a.root, b.root, 'two reviews reused the same predictable directory');
    for (const sandbox of [a, b]) {
      const dir = sandbox.root;
      assert.ok(dir.startsWith(REVIEW_SANDBOX_PREFIX));
      const st = fs.lstatSync(dir);
      assert.ok(st.isDirectory() && !st.isSymbolicLink());
      assert.strictEqual(st.mode & 0o777, 0o700, 'review directory must be owner-only');
      assert.deepStrictEqual(fs.readdirSync(dir).sort(), ['home', 'tmp', 'work'],
        'a newly prepared review directory contains an unexpected pre-existing entry');
    }
  } finally {
    cleanupReviewSandbox(a);
    cleanupReviewSandbox(b);
  }
});

test('RED: reviewer prompts restrict reads to the exact copied subject', () => {
  const { codexPrompt, grokPrompt } = require('../review-adapters.cjs');
  for (const prompt of [codexPrompt('o', subject, 'd'), grokPrompt('o', subject, 'd')]) {
    assert.match(prompt, /exact bounded subject and specifications are available\s+read-only/i);
    assert.match(prompt, /Read only those\s+paths/i);
    assert.match(prompt, /Do not inspect parent directories or unrelated files/i);
  }
});

test('RED: exact subject copies preserve path, digest and read-only mode while secrets are refused', () => {
  const { prepareReviewSandbox, cleanupReviewSandbox, safeReviewPath } = require('../review-adapters.cjs');
  const rel = 'builder-control/TOOL-CAPABILITY-CANON.json';
  const sandbox = prepareReviewSandbox([rel]);
  try {
    const copied = path.join(sandbox.cwd, rel);
    assert.ok(fs.existsSync(copied));
    assert.strictEqual(fs.statSync(copied).mode & 0o777, 0o400);
    assert.strictEqual(sandbox.manifest.length, 1);
    assert.strictEqual(sandbox.manifest[0].path, rel);
    assert.strictEqual(sandbox.manifest[0].sha256,
      require('crypto').createHash('sha256').update(fs.readFileSync(copied)).digest('hex'));
    assert.throws(() => safeReviewPath('../outside'), /escapes repository root/);
    assert.throws(() => safeReviewPath('builder-control/ledger.json'), /sensitive or runtime/);
    assert.throws(() => safeReviewPath('.env'), /sensitive or runtime/);
  } finally { cleanupReviewSandbox(sandbox); }
});

test('RED: reviewer sandbox preparation is failure-atomic before and after root creation', () => {
  assertAtomicPreparationFailure('invalid path',
    () => prepareReviewSandbox(['../outside']), /escapes repository root/);

  const tooMany = Array.from({ length: MAX_REVIEW_FILES + 1 }, (_, i) => `missing-review-${i}.txt`);
  assertAtomicPreparationFailure('file-count limit',
    () => prepareReviewSandbox(tooMany), /file count .* exceeds/);

  const largeName = `.aegis-review-large-${process.pid}-${Date.now()}.bin`;
  const largePath = path.join(__dirname, largeName);
  const largeRel = `builder-control/test/${largeName}`;
  try {
    fs.writeFileSync(largePath, Buffer.alloc(MAX_REVIEW_BYTES + 1));
    assertAtomicPreparationFailure('byte limit',
      () => prepareReviewSandbox([largeRel]), /review payload .* exceeds/);
  } finally {
    fs.rmSync(largePath, { force: true });
  }

  const fixtureName = `.aegis-review-fault-${process.pid}-${Date.now()}.txt`;
  const fixturePath = path.join(__dirname, fixtureName);
  const fixtureRel = `builder-control/test/${fixtureName}`;
  fs.writeFileSync(fixturePath, 'bounded review fixture\n');
  try {
    const realCopy = fs.copyFileSync;
    try {
      fs.copyFileSync = function injectedCopyFailure(src, dest, flags) {
        if (String(dest).includes(`${path.sep}work${path.sep}`)) throw new Error('injected review copy failure');
        return realCopy.call(fs, src, dest, flags);
      };
      assertAtomicPreparationFailure('subject copy failure',
        () => prepareReviewSandbox([fixtureRel]), /injected review copy failure/);
    } finally {
      fs.copyFileSync = realCopy;
    }

    const realRead = fs.readFileSync;
    try {
      fs.readFileSync = function injectedReadFailure(target, ...args) {
        if (path.resolve(String(target)) === path.resolve(fixturePath)) throw new Error('injected review read failure');
        return realRead.call(fs, target, ...args);
      };
      assertAtomicPreparationFailure('subject read failure',
        () => prepareReviewSandbox([fixtureRel]), /injected review read failure/);
    } finally {
      fs.readFileSync = realRead;
    }

    try {
      fs.copyFileSync = function injectedDigestMismatch(src, dest, flags) {
        const result = realCopy.call(fs, src, dest, flags);
        if (String(dest).includes(`${path.sep}work${path.sep}`)) fs.appendFileSync(dest, 'altered');
        return result;
      };
      assertAtomicPreparationFailure('subject digest mismatch',
        () => prepareReviewSandbox([fixtureRel]), /review copy digest mismatch/);
    } finally {
      fs.copyFileSync = realCopy;
    }

    const operatorAuthExists = [
      path.join(os.homedir(), '.grok', 'auth.json'),
      path.join(os.homedir(), '.codex', 'auth.json'),
    ].some((value) => fs.existsSync(value));
    if (operatorAuthExists) {
      try {
        fs.copyFileSync = function injectedPostAuthCopyFailure(src, dest, flags) {
          const result = realCopy.call(fs, src, dest, flags);
          if (path.basename(dest) === 'auth.json') throw new Error('injected post-auth copy failure');
          return result;
        };
        assertAtomicPreparationFailure('partial auth copy failure',
          () => prepareReviewSandbox([fixtureRel]), /injected post-auth copy failure/);
      } finally {
        fs.copyFileSync = realCopy;
      }
    }
  } finally {
    fs.rmSync(fixturePath, { force: true });
  }
});

test('RED: runTool converts sandbox preparation failure into a structured refusal', () => {
  const before = reviewSandboxRoots();
  const result = runTool('codex', 'must never launch', 1, { reviewPaths: ['../outside'] });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.raw, '');
  assert.match(result.reason, /review sandbox preparation failed:.*escapes repository root/);
  assertNoNewReviewSandbox(before, 'runTool structured refusal');
});

test('RED: reviewer subprocess stdin is closed instead of inherited', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'review-adapters.cjs'), 'utf8');
  assert.match(src, /stdio:\s*\['ignore',\s*'pipe',\s*'pipe'\]/,
    'reviewer stdin must be closed so a headless CLI cannot wait for more input');
});

test('RED: reviewer sandbox cleanup is guaranteed after every subprocess outcome', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'review-adapters.cjs'), 'utf8');
  const start = src.indexOf('function runTool(');
  const end = src.indexOf('function cmdRun(', start);
  const runTool = src.slice(start, end);
  assert.match(runTool, /try\s*\{[\s\S]*spawnSync[\s\S]*\}\s*finally\s*\{[\s\S]*cleanupReviewSandbox\(sandbox\)/,
    'review temp credentials/config can survive timeout, failure or success');
});

test('RED: Grok subprocess HOME is the isolated review harness', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'review-adapters.cjs'), 'utf8');
  assert.match(src, /HOME:\s*sandbox\.home/,
    'Grok must not rediscover interactive MCPs and rules through the operator HOME');
});

test('RED: reviewer environment is a strict allowlist with no operator secrets', () => {
  const { prepareReviewSandbox, cleanupReviewSandbox, reviewerEnvironment } = require('../review-adapters.cjs');
  const sandbox = prepareReviewSandbox();
  try {
    const source = {
      LANG: 'en_CA.UTF-8',
      ANTHROPIC_API_KEY: 'must-not-cross',
      XAI_API_KEY: 'must-not-cross',
      GITHUB_TOKEN: 'must-not-cross',
      AWS_SECRET_ACCESS_KEY: 'must-not-cross',
    };
    for (const reviewer of ['codex', 'grok']) {
      const env = reviewerEnvironment(reviewer, sandbox, source);
      assert.strictEqual(env.LANG, 'en_CA.UTF-8');
      for (const secret of ['ANTHROPIC_API_KEY', 'XAI_API_KEY', 'GITHUB_TOKEN', 'AWS_SECRET_ACCESS_KEY']) {
        assert.ok(!Object.prototype.hasOwnProperty.call(env, secret), `${reviewer} inherited ${secret}`);
      }
      assert.deepStrictEqual(Object.keys(env).sort(),
        (reviewer === 'codex'
          ? ['CODEX_HOME', 'HOME', 'LANG', 'PATH', 'TMPDIR']
          : ['GROK_MANAGED_MCPS_ENABLED', 'HOME', 'LANG', 'PATH', 'TMPDIR']).sort());
    }
  } finally { cleanupReviewSandbox(sandbox); }
});

test('RED: Grok model tools can read only the copied review tree, not credential HOME', () => {
  const { prepareReviewSandbox, cleanupReviewSandbox, buildToolArgv } = require('../review-adapters.cjs');
  const sandbox = prepareReviewSandbox();
  try {
    const argv = buildToolArgv('grok', 'P', { maxTurns: 1, webAccess: false }, sandbox.cwd);
    const allowAt = argv.indexOf('--allow');
    assert.strictEqual(argv[allowAt + 1], `Read(${sandbox.cwd}/**)`);
    const denyRules = argv.reduce((all, value, index) => value === '--deny' ? [...all, argv[index + 1]] : all, []);
    assert.ok(denyRules.includes(`Read(${sandbox.home}/**)`));
    assert.ok(denyRules.includes('Read(../**)'));
  } finally { cleanupReviewSandbox(sandbox); }
});

test('RED: packet filesAllowed is the fail-closed review subject authority', () => {
  const { resolveBoundedReviewPaths } = require('../review-adapters.cjs');
  const rel = 'builder-control/review-adapters.cjs';
  assert.deepStrictEqual(resolveBoundedReviewPaths(
    { subjectPaths: [rel] },
    { filesAllowed: [rel], sourceOfTruth: [] },
  ), [rel]);
  assert.throws(() => resolveBoundedReviewPaths(
    { subjectPaths: [rel] },
    { filesAllowed: ['builder-control/aegis-run.cjs'], sourceOfTruth: [] },
  ), /outside packet filesAllowed/);
  assert.throws(() => resolveBoundedReviewPaths(
    { subjectPaths: [rel] },
    { filesAllowed: [rel], sourceOfTruth: ['builder-control/ledger.json'] },
  ), /sensitive or runtime/);
});

test('RED: OS sandbox denies unrelated reads and non-allowlisted writes', () => {
  if (process.platform !== 'darwin') return;
  const {
    buildMacSandboxProfile,
    sandboxedCommand,
    strictEnvironment,
    sandboxCapability,
  } = require('../sandbox-containment.cjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-containment-test-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-containment-outside-'));
  try {
    const readable = path.join(root, 'allowed.txt');
    const writable = path.join(root, 'write');
    const deniedInside = path.join(root, 'denied.txt');
    const deniedOutside = path.join(outside, 'secret.txt');
    fs.writeFileSync(readable, 'ALLOWED');
    fs.mkdirSync(writable);
    fs.writeFileSync(deniedInside, 'DENIED');
    fs.writeFileSync(deniedOutside, 'SECRET');
    const profile = buildMacSandboxProfile({
      root,
      executable: '/bin/bash',
      readPaths: [readable],
      writePaths: [writable],
      allowNetwork: false,
    });
    const run = (script, args = []) => {
      const command = sandboxedCommand(profile, ['-c', script, 'aegis-test', ...args]);
      return spawnSync(command.bin, command.argv, { encoding: 'utf8', env: strictEnvironment() });
    };
    const capability = sandboxCapability();
    if (!capability.available) {
      const refused = run('exit 0');
      assert.notStrictEqual(refused.status, 0, 'unavailable OS containment failed open');
      assert.match(capability.reason, /refusing|failed|unavailable|not permitted/i);
      return;
    }
    assert.strictEqual(run('IFS= read -r value < "$1"; printf "%s" "$value"', [readable]).stdout, 'ALLOWED');
    assert.notStrictEqual(run('IFS= read -r value < "$1"', [deniedInside]).status, 0);
    assert.notStrictEqual(run('IFS= read -r value < "$1"', [deniedOutside]).status, 0);
    assert.strictEqual(run('printf ok > "$1"', [path.join(writable, 'ok.txt')]).status, 0);
    assert.notStrictEqual(run('printf bad > "$1"', [deniedInside]).status, 0);
    assert.notStrictEqual(run('printf bad > "$1"', [path.join(outside, 'bad.txt')]).status, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('RED: reusable worker containment rejects packet paths outside its worktree', () => {
  const { prepareWorkerContainment } = require('../sandbox-containment.cjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-worker-containment-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-worker-outside-'));
  try {
    const allowed = path.join(root, 'subject.cjs');
    const writeDir = path.join(root, 'out');
    const foreign = path.join(outside, 'foreign.cjs');
    fs.writeFileSync(allowed, 'module.exports = 1;');
    fs.mkdirSync(writeDir);
    fs.writeFileSync(foreign, 'secret');
    assert.throws(() => prepareWorkerContainment({
      worktree: root,
      executable: '/bin/bash',
      packetReadPaths: [allowed, foreign],
      packetWritePaths: [writeDir],
    }), /escapes containment root/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('RED: reviewer runtime allowances never leak into the worker profile', () => {
  const { buildMacSandboxProfile } = require('../sandbox-containment.cjs');
  if (process.platform !== 'darwin') return;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-runtime-scope-'));
  try {
    const allowed = path.join(root, 'allowed.txt');
    fs.writeFileSync(allowed, 'ok');
    const worker = buildMacSandboxProfile({
      root,
      executable: '/usr/bin/true',
      readPaths: [allowed],
      reviewerRuntime: false,
    }).profile;
    const reviewer = buildMacSandboxProfile({
      root,
      executable: '/usr/bin/true',
      readPaths: [allowed],
      reviewerRuntime: true,
    }).profile;
    assert.ok(!worker.includes('(allow system-socket)'));
    assert.ok(!worker.includes('(allow user-preference-read)'));
    assert.ok(reviewer.includes('(allow system-socket)'));
    assert.ok(reviewer.includes('(allow user-preference-read)'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// ── PROVEN DEFECT D2 (2026-08-25): envelope verdicts were discarded ────────
// Several CLIs return {text, stopReason, usage, num_turns} with the model's
// answer inside `text`. extractJson returned the envelope, isUsableReview saw
// no disposition, and a genuine REJECT was recorded as UNAVAILABLE. The
// reviewer was blamed three times for "producing no parseable JSON".
test('RED: a verdict inside a CLI envelope is RECOVERED, not discarded', () => {
  const env = JSON.stringify({
    text: 'Here is my review:\n{"disposition":"REJECT","findings":[{"severity":"HIGH","file":"x.cjs","problem":"p","evidence":"e","status":"OPEN"}]}',
    stopReason: 'end_turn', num_turns: 5, total_cost_usd: 0.12,
  });
  const got = extractJson(env);
  assert.ok(got, 'nothing extracted');
  assert.strictEqual(got.disposition, 'REJECT', 'the real verdict was thrown away');
  assert.strictEqual(got.findings.length, 1, 'findings were lost with it');
  assert.strictEqual(isUsableReview(got), true);
});

test('RED: an envelope with NO verdict inside is still UNAVAILABLE', () => {
  // The opposite failure would be worse: inventing a verdict from a cancelled run.
  const env = JSON.stringify({ text: 'I could not finish the review', stopReason: 'cancelled', num_turns: 9 });
  assert.strictEqual(isUsableReview(extractJson(env)), false,
    'a cancelled run must never yield a usable verdict');
});

test('RED: envelope unwrapping is bounded to one level', () => {
  const nested = JSON.stringify({ text: JSON.stringify({ text: '{"disposition":"APPROVE"}' }) });
  assert.strictEqual(isUsableReview(extractJson(nested)), false,
    'unbounded unwrapping would let arbitrary nesting smuggle a verdict');
});

test('a plain JSON verdict with no envelope still works', () => {
  const got = extractJson('prose {"disposition":"APPROVE","findings":[]} trailing');
  assert.strictEqual(got.disposition, 'APPROVE');
  assert.strictEqual(isUsableReview(got), true);
});

// ── PROVEN DEFECT (2026-08-25): schema-valid ≠ real ───────────────────────
// --json-schema constrains the model to emit conforming JSON on EVERY turn, so
// a run cut off mid-investigation still emits a perfect-looking verdict. The
// fixture below is the REAL output of a truncated run, kept in the repo:
//   {"disposition":"REJECT","findings":[{"severity":"HIGH","location":"pending",
//     "problem":"Full prompt and subject files not yet inspected; starting…"}]}
// Constraining output makes this gap WIDER, not narrower — the placeholder now
// passes every syntactic check a record has.
const TRUNCATED_FIXTURE = path.join(__dirname, '..', 'review-raw', '20260825021136-grok.txt');

test('RED: the real truncated run is detected as an abnormal stop', () => {
  if (!fs.existsSync(TRUNCATED_FIXTURE)) return; // fixture archived away
  const raw = fs.readFileSync(TRUNCATED_FIXTURE, 'utf8');
  assert.ok(stopWasAbnormal(raw), 'a run that ended "max turns reached" must be flagged abnormal');
});

test('RED: the real truncated run DOES parse as a schema-valid verdict — which is the danger', () => {
  if (!fs.existsSync(TRUNCATED_FIXTURE)) return;
  const raw = fs.readFileSync(TRUNCATED_FIXTURE, 'utf8');
  const v = extractJson(raw);
  assert.strictEqual(v && v.disposition, 'REJECT',
    'this fixture exists precisely because it looks like a real verdict');
  // The ORIGINAL assertion here checked looksUnfinished, which was true while
  // the parser returned the first-turn placeholder. Now that the parser returns
  // the LAST object, this fixture surfaces a later, plausible-looking finding —
  // and the placeholder heuristic no longer fires on it. That is exactly why the
  // abnormal-stop guard has to be the primary defence: it does not depend on the
  // payload looking wrong, only on the run not having finished.
  assert.ok(stopWasAbnormal(raw),
    'the stop guard must catch a truncated run even when its payload looks perfectly finished');
});

test('RED: the placeholder heuristic still fires on a genuine placeholder', () => {
  const placeholder = { disposition: 'REJECT', findings: [
    { severity: 'HIGH', file: 'x.cjs', location: 'pending', problem: 'not yet inspected', evidence: 'e', status: 'OPEN' },
  ] };
  assert.strictEqual(looksUnfinished(placeholder), true,
    'the secondary net must still catch a self-declared placeholder that stopped cleanly');
});

test('RED: placeholder findings are recognised across the phrasings a model uses', () => {
  for (const marker of ['pending', 'not yet inspected', 'starting adversarial review', 'in progress', 'TBD']) {
    assert.strictEqual(
      looksUnfinished({ disposition: 'REJECT', findings: [{ location: marker, problem: 'x' }] }),
      true, `"${marker}" was not recognised as a placeholder`);
  }
});

test('a genuine finished verdict is NOT flagged as unfinished', () => {
  const real = { disposition: 'REJECT', findings: [
    { severity: 'HIGH', file: 'x.cjs', location: 'line 42', problem: 'auth bypass on the admin route', evidence: 'code', status: 'OPEN' },
  ] };
  assert.strictEqual(looksUnfinished(real), false, 'the guard must not eat real findings');
  assert.strictEqual(stopWasAbnormal(JSON.stringify({ text: '{}', stopReason: 'end_turn' })), null);
});

test('RED: an abnormal stop outranks a parseable payload', () => {
  // Order matters: if the payload were trusted first, a truncated run's
  // placeholder would be recorded as a real REJECT at the gate.
  const truncated = JSON.stringify({
    text: '{"disposition":"APPROVE","findings":[]}',
    stopReason: 'max_turns', num_turns: 16,
  });
  assert.ok(stopWasAbnormal(truncated), 'max_turns must be abnormal');
  assert.strictEqual(extractJson(truncated).disposition, 'APPROVE',
    'the payload really is parseable — which is exactly why the stop reason must win');
});

// ── PARSER DEFECT (2026-08-25): the first-turn placeholder won ───────────
// --json-schema makes the model emit a conforming object EVERY turn, so the
// payload holds several verdicts. Taking the FIRST returned a REJECT with zero
// findings while the real verdict — five HIGH findings — sat later in the same
// string. Worse than a timeout: it produces a PLAUSIBLE record that reads as a
// completed review which happened to find nothing.
const REAL_G9 = path.join(__dirname, '..', 'review-raw', '20260825022432-grok.txt');

test('RED: the real multi-verdict run yields the FINAL verdict, not the first turn', () => {
  if (!fs.existsSync(REAL_G9)) return;
  const v = extractJson(fs.readFileSync(REAL_G9, 'utf8'));
  assert.strictEqual(v.disposition, 'REJECT');
  assert.strictEqual(v.findings.length, 5,
    `expected the 5-finding final verdict, got ${v.findings.length} — the first-turn placeholder won again`);
});

test('RED: structuredOutput is preferred over anything in the text stream', () => {
  const raw = JSON.stringify({
    text: '{"disposition":"APPROVE","findings":[]}',
    structuredOutput: { disposition: 'REJECT', findings: [{ severity: 'HIGH', file: 'x', problem: 'p', evidence: 'e', status: 'OPEN' }] },
    stopReason: 'end_turn',
  });
  const v = extractJson(raw);
  assert.strictEqual(v.disposition, 'REJECT', 'the tool\'s authoritative result must win over a stream fragment');
  assert.strictEqual(v.findings.length, 1);
});

test('RED: with no structuredOutput, the LAST conforming object wins', () => {
  const raw = '{"disposition":"REJECT","findings":[],"unverified":["still reading"]}'
    + '{"disposition":"REJECT","findings":[],"unverified":["half read"]}'
    + '{"disposition":"APPROVE_WITH_NOTES","findings":[{"severity":"LOW","file":"a","problem":"p","evidence":"e","status":"OPEN"}]}';
  const v = extractJson(raw);
  assert.strictEqual(v.disposition, 'APPROVE_WITH_NOTES', 'an earlier placeholder outranked the final word');
  assert.strictEqual(v.findings.length, 1);
});

test('a single plain verdict is unaffected by multi-object handling', () => {
  const v = extractJson('prose {"disposition":"APPROVE","findings":[]} trailing');
  assert.strictEqual(v.disposition, 'APPROVE');
  assert.strictEqual(isUsableReview(v), true);
});

const failedCount = process.exitCode ? 'at least 1' : '0';
console.log(`${passed} passed, ${failedCount} failed.`);
