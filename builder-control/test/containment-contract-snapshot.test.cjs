#!/usr/bin/env node
'use strict';

// Snapshot-safe contract proofs for AEGIS containment and reviewer routing.
//
// This suite deliberately exercises only pure helpers, profile construction,
// checked-in policy, source contracts, and disposable fixture paths. It does
// not launch a sandbox, reviewer, model, authentication helper, or any process.
// Live macOS containment remains a separate host integration proof.

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const WORKER = require('../aegis-worker.cjs');
const CONTAINMENT = require('../sandbox-containment.cjs');
const REVIEW = require('../review-adapters.cjs');
const ROUTER = require('../tool-router.cjs');

let passed = 0;
function topLevelFunctionSource(source, name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `missing function ${name}`);
  const next = source.indexOf('\nfunction ', start + marker.length);
  return source.slice(start, next < 0 ? source.length : next);
}

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`ok   ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}: ${error.message}`);
    process.exitCode = 1;
  }
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-containment-contract-'));
  const executable = path.join(root, 'fixture-executable');
  const readable = path.join(root, 'readable.txt');
  const writable = path.join(root, 'writable.txt');
  const cache = path.join(root, 'cache');
  fs.writeFileSync(executable, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  fs.writeFileSync(readable, 'read-only fixture\n', { mode: 0o400 });
  fs.writeFileSync(writable, 'before\n', { mode: 0o600 });
  fs.mkdirSync(cache, { mode: 0o700 });
  return { root, executable, readable, writable, cache };
}

function removeFixture(root) {
  fs.chmodSync(root, 0o700);
  for (const entry of fs.readdirSync(root)) {
    const target = path.join(root, entry);
    if (!fs.lstatSync(target).isSymbolicLink()) fs.chmodSync(target, fs.lstatSync(target).isDirectory() ? 0o700 : 0o600);
  }
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('AEGIS snapshot-safe containment contracts');

test('Claude model policy is file-only and retains fail-closed nested-sandbox requirements', () => {
  assert.strictEqual(WORKER.assertClaudeModelSandboxPolicy(), true);
  assert.deepStrictEqual(WORKER.CLAUDE_FILE_TOOLS, ['Read', 'Edit', 'Write', 'Glob', 'Grep']);
  assert.deepStrictEqual(WORKER.CLAUDE_DISALLOWED_TOOLS, ['Bash']);
  assert.strictEqual(WORKER.CLAUDE_SETTINGS.sandbox.enabled, true);
  assert.strictEqual(WORKER.CLAUDE_SETTINGS.sandbox.failIfUnavailable, true);
  assert.strictEqual(WORKER.CLAUDE_SETTINGS.sandbox.allowUnsandboxedCommands, false);
  assert.ok(WORKER.CLAUDE_SETTINGS.sandbox.filesystem.denyRead.includes('~/Library/Keychains'));
  assert.ok(WORKER.CLAUDE_SETTINGS.permissions.deny.includes('Read(~/.claude.json)'));
  assert.ok(WORKER.CLAUDE_SETTINGS.permissions.deny.includes('Bash(/usr/bin/security *)'));
});

test('deny-default worker profile is constructed from exact disposable paths without executing it', () => {
  const fixture = makeFixture();
  try {
    const executableReal = fs.realpathSync(fixture.executable);
    const readableReal = fs.realpathSync(fixture.readable);
    const writableReal = fs.realpathSync(fixture.writable);
    const profile = CONTAINMENT.buildMacSandboxProfile({
      root: fixture.root,
      executable: fixture.executable,
      readPaths: [fixture.readable],
      writePaths: [fixture.writable],
      processOnlyReadDirectoryPaths: [fixture.cache],
      allowNetwork: false,
      reviewerRuntime: false,
    });
    assert.ok(profile.profile.startsWith('(version 1)\n(deny default)\n'));
    assert.ok(profile.profile.includes('(allow process*)'));
    assert.ok(profile.profile.includes(`(allow file-read* (literal "${executableReal}"))`));
    assert.ok(profile.profile.includes(`(allow file-read* (subpath "${readableReal}"))`));
    assert.ok(profile.profile.includes(`(allow file-write* (literal "${writableReal}"))`));
    assert.ok(profile.profile.includes(`(process-path "${executableReal}")`));
    assert.ok(!profile.profile.includes('(allow default)'));
    assert.ok(!profile.profile.includes('(allow network-outbound)'));

    const descriptor = CONTAINMENT.sandboxedCommand(profile, ['--fixture']);
    assert.strictEqual(descriptor.bin, CONTAINMENT.SANDBOX_EXEC);
    assert.deepStrictEqual(descriptor.argv.slice(-2), [executableReal, '--fixture']);
  } finally {
    removeFixture(fixture.root);
  }
});

test('write authorities fail closed on escapes and symlink substitution', () => {
  const fixture = makeFixture();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-containment-outside-'));
  try {
    const exact = CONTAINMENT.resolveWriteAuthorities([fixture.writable], fixture.root, 'fixture write');
    assert.strictEqual(exact.length, 1);
    assert.deepStrictEqual(
      { path: exact[0].path, matcher: exact[0].matcher, newLeaf: exact[0].newLeaf },
      { path: fs.realpathSync(fixture.writable), matcher: 'literal', newLeaf: false },
    );
    assert.strictEqual(typeof exact[0].device, 'number');
    assert.strictEqual(typeof exact[0].inode, 'number');
    assert.throws(
      () => CONTAINMENT.resolveWriteAuthorities([path.join(outside, 'escape.txt')], fixture.root, 'fixture write'),
      /escapes containment root/,
    );
    const link = path.join(fixture.root, 'link');
    fs.symlinkSync(outside, link);
    assert.throws(
      () => CONTAINMENT.resolveWriteAuthorities([path.join(link, 'escape.txt')], fixture.root, 'fixture write'),
      /escapes containment root/,
    );
    assert.strictEqual(
      CONTAINMENT.atomicWriteTemporaryRegex(fixture.writable),
      `^${fixture.writable.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')}\\.tmp\\.[0-9]+\\.[^/]+$`,
    );
  } finally {
    fs.rmSync(outside, { recursive: true, force: true });
    removeFixture(fixture.root);
  }
});

test('write authorities refuse hard-linked files and revalidate identity at command construction', () => {
  const fixture = makeFixture();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-hardlink-outside-'));
  try {
    const outsideAlias = path.join(outside, 'unauthorized-alias.txt');
    fs.linkSync(fixture.writable, outsideAlias);
    assert.throws(
      () => CONTAINMENT.resolveWriteAuthorities([fixture.writable], fixture.root, 'fixture write'),
      /must have exactly one hard link/,
    );
    fs.unlinkSync(outsideAlias);

    const profile = CONTAINMENT.buildMacSandboxProfile({
      root: fixture.root,
      executable: fixture.executable,
      writePaths: [fixture.writable],
      allowNetwork: false,
    });
    fs.linkSync(fixture.writable, outsideAlias);
    assert.throws(
      () => CONTAINMENT.sandboxedCommand(profile),
      /must retain exactly one hard link/,
    );
  } finally {
    fs.rmSync(outside, { recursive: true, force: true });
    removeFixture(fixture.root);
  }
});

test('single-link files and absent exact leaves retain literal atomic-write authority', () => {
  const fixture = makeFixture();
  try {
    const existingProfile = CONTAINMENT.buildMacSandboxProfile({
      root: fixture.root,
      executable: fixture.executable,
      writePaths: [fixture.writable],
      allowNetwork: false,
    });
    assert.doesNotThrow(() => CONTAINMENT.sandboxedCommand(existingProfile));

    const newLeaf = path.join(fixture.root, 'new-output.txt');
    const newLeafReal = path.join(fs.realpathSync(fixture.root), 'new-output.txt');
    const newProfile = CONTAINMENT.buildMacSandboxProfile({
      root: fixture.root,
      executable: fixture.executable,
      writePaths: [newLeaf],
      allowNetwork: false,
    });
    assert.deepStrictEqual(newProfile.writeAuthorities, [{
      path: newLeafReal,
      matcher: 'literal',
      newLeaf: true,
      device: null,
      inode: null,
    }]);
    assert.ok(newProfile.profile.includes(`(allow file-write* (literal "${newLeafReal}"))`));
    assert.ok(newProfile.profile.includes(`${newLeafReal.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')}\\.tmp\\.`));
    assert.doesNotThrow(() => CONTAINMENT.sandboxedCommand(newProfile));
  } finally {
    removeFixture(fixture.root);
  }
});

test('strict environments preserve only explicit runtime fields and reject credentials or loaders', () => {
  const source = { LANG: 'C', LC_ALL: 'C', NODE_ENV: 'test' };
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-env-contract-'));
  try {
    const env = CONTAINMENT.strictEnvironment({
      HOME: root,
      TMPDIR: root,
      USER: 'aegis-contract',
      LOGNAME: 'aegis-contract',
      GROK_MANAGED_MCPS_ENABLED: 'false',
    }, source);
    assert.deepStrictEqual(Object.keys(env).sort(), [
      'GROK_MANAGED_MCPS_ENABLED', 'HOME', 'LANG', 'LC_ALL', 'LOGNAME', 'PATH', 'TMPDIR', 'USER',
    ]);
    assert.strictEqual(env.PATH, CONTAINMENT.FIXED_PATH);
    for (const key of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'XAI_API_KEY', 'NODE_OPTIONS', 'DYLD_INSERT_LIBRARIES']) {
      assert.throws(() => CONTAINMENT.strictEnvironment({ [key]: 'forbidden' }, source), /is not allowed/);
    }

    const workerEnv = WORKER.workerEnvironment({
      HOME: root,
      TMPDIR: root,
      USER: 'fixture',
      LOGNAME: 'fixture',
      ANTHROPIC_API_KEY: 'must-not-pass',
      UNRELATED: 'must-not-pass',
    });
    assert.strictEqual(Object.prototype.hasOwnProperty.call(workerEnv, 'ANTHROPIC_API_KEY'), false);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(workerEnv, 'UNRELATED'), false);
    assert.strictEqual(workerEnv.AEGIS_REMOVED_ANTHROPIC_OVERRIDES, '1');
    assert.strictEqual(workerEnv.AEGIS_REMOVED_ANTHROPIC_API_KEY, '1');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('packet allowlists include only declared sources, checks, dependencies, packet, and exact write leaves', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-allowlist-contract-'));
  const priorNodeEnv = process.env.NODE_ENV;
  try {
    fs.mkdirSync(path.join(root, 'builder-control'), { recursive: true });
    fs.writeFileSync(path.join(root, 'source.txt'), 'source\n');
    fs.writeFileSync(path.join(root, 'dependency.cjs'), "module.exports = 'fixture';\n");
    fs.writeFileSync(path.join(root, 'check.cjs'), "require('./dependency.cjs');\n");
    const packetPath = path.join(root, 'builder-control', 'packet.json');
    fs.writeFileSync(packetPath, JSON.stringify({
      packetId: 'PKT-SNAPSHOT-CONTRACT',
      agentId: 'claude-code',
      sourceOfTruth: ['source.txt'],
      testsRequired: ['node check.cjs'],
      filesAllowed: ['source.txt', 'builder-control/new-output.txt'],
    }));
    process.env.NODE_ENV = 'test';
    const result = WORKER.derivePacketAllowlists(
      { packet: packetPath, worktree: { path: root } }, root,
    );
    assert.strictEqual(result.packetId, 'PKT-SNAPSHOT-CONTRACT');
    assert.deepStrictEqual(result.readPaths, [
      'builder-control/packet.json', 'check.cjs', 'dependency.cjs', 'source.txt',
    ]);
    assert.deepStrictEqual(result.writePaths, ['builder-control/new-output.txt', 'source.txt']);
    assert.throws(
      () => WORKER.declaredCheckEntrypoint('sh -c "touch outside"'),
      /not an approved deterministic check form/,
    );
  } finally {
    if (priorNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = priorNodeEnv;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('builder executable versions, model routes, and file-only tool sets stay pinned', () => {
  assert.strictEqual(WORKER.CLAUDE_VERSION, '2.1.245');
  assert.strictEqual(path.basename(WORKER.CLAUDE_EXECUTABLE), WORKER.CLAUDE_VERSION);
  assert.strictEqual(
    WORKER.GROK_PINNED_EXECUTABLE,
    path.join(os.homedir(), '.grok', 'downloads', 'grok-macos-aarch64'),
  );
  assert.strictEqual(REVIEW.TOOLS.grok.bin, '/Users/marcpapineau/.grok/downloads/grok-macos-aarch64');
  assert.strictEqual(REVIEW.TOOLS.codex.bin, '/Applications/ChatGPT.app/Contents/Resources/codex');
  assert.strictEqual(REVIEW.GROK_EXPECTED_VERSION, 'grok 1.0.5 (5115b46bc909) [stable]');
  assert.match(REVIEW.GROK_EXPECTED_SHA256, /^[a-f0-9]{64}$/);

  assert.deepStrictEqual(
    WORKER.normalizeLaunchSpec({ provider: 'claude-subscription', model: 'opus', prompt: 'bounded' }),
    { provider: 'claude-subscription', model: 'opus', prompt: 'bounded' },
  );
  assert.deepStrictEqual(
    WORKER.normalizeLaunchSpec({ provider: 'grok-subscription', model: 'grok-4.6', prompt: 'bounded' }),
    { provider: 'grok-subscription', model: 'grok-4.6', prompt: 'bounded' },
  );
  assert.throws(
    () => WORKER.normalizeLaunchSpec({ provider: 'grok-subscription', model: 'unapproved', prompt: 'bounded' }),
    /model must be one of/,
  );
  assert.deepStrictEqual(WORKER.GROK_FILE_TOOLS, ['read_file', 'search_replace', 'grep', 'list_dir']);
  assert.ok(WORKER.GROK_DISALLOWED_TOOLS.includes('run_terminal_cmd'));
  assert.ok(WORKER.GROK_DISALLOWED_TOOLS.includes('web_search'));
});

test('canonical routing separates builder and reviewers and refuses unbounded spend or recursion', () => {
  const policy = ROUTER.loadPolicy();
  assert.strictEqual(policy.roles.orchestrator.default, 'claude');
  assert.strictEqual(policy.roles['implementation-review'].default, 'codex');
  assert.strictEqual(policy.roles['adversarial-review'].default, 'grok');
  assert.deepStrictEqual(policy.models.claude.workerRoute, { provider: 'claude-subscription', model: 'opus' });

  const incompleteAuthorization = ROUTER.routeRole('adversarial-review', {
    allowMetered: true,
    approvedBy: 'Marc Papineau',
  });
  assert.strictEqual(incompleteAuthorization.ok, false);
  assert.strictEqual(incompleteAuthorization.code, 'METERED_UNAUTHORIZED');
  const invocationId = 'REV-containment-routing-proof';
  const deferredPreflightRoute = ROUTER.routeRole('adversarial-review', {
    allowMetered: true,
    approvedBy: 'Marc Papineau',
    capUsd: 5,
    invocationId,
    deferSubscriptionProof: true,
    preflightStage: 'adapter-billing-preflight',
  });
  assert.strictEqual(deferredPreflightRoute.ok, true);
  const now = Date.now();
  const zeroMeteredRoute = ROUTER.routeRole('adversarial-review', {
    allowMetered: true,
    approvedBy: 'Marc Papineau',
    capUsd: 5,
    invocationId,
    subscriptionProof: {
      ok: true,
      mode: 'zero-metered',
      invocationId,
      preflightId: 'GBPF-containment-routing-proof',
      observedAt: new Date(now - 1_000).toISOString(),
      expiresAt: new Date(now + 60_000).toISOString(),
      subscriptionTier: null,
      subscriptionTierState: 'UNREPORTED',
      unifiedBilling: true,
      onDemandCap: 0,
      onDemandUsed: 0,
      prepaidBalance: 0,
      autoTopup: 'DISABLED',
    },
  });
  assert.strictEqual(zeroMeteredRoute.ok, true);
  assert.strictEqual(zeroMeteredRoute.model, 'grok');
  assert.strictEqual(zeroMeteredRoute.execution, 'CANON_UNKNOWN_REQUIRES_PREFLIGHT');
  const recursive = ROUTER.routeRole('orchestrator', { wantsDelegation: true });
  assert.strictEqual(recursive.ok, false);
  assert.strictEqual(recursive.code, 'RECURSIVE_DELEGATION_REFUSED');
  const selfReview = ROUTER.routeRole('implementation-review', { model: 'claude' });
  assert.strictEqual(selfReview.ok, false);
  assert.strictEqual(selfReview.code, 'SELF_REVIEW_REFUSED');

  const selected = WORKER.selectFailoverBuilder(
    { provider: 'claude-subscription', model: 'opus', prompt: 'unchanged objective' },
    { code: 'MODEL_AUTH_FAILURE', provider: 'claude-subscription', failoverEligible: true },
    { objective: 'bounded dashboard objective' },
    policy,
  );
  assert.strictEqual(selected.launchSpec.provider, 'grok-subscription');
  assert.strictEqual(selected.launchSpec.model, 'grok-4.6');
  assert.strictEqual(selected.handoff.sameProviderRetryAllowed, false);
  assert.strictEqual(selected.handoff.builderMayApproveOwnWork, false);
});

test('reviewer argv is fixed, non-interactive, file-bounded, and unavailable for advisory tools', () => {
  const cwd = path.join(os.tmpdir(), 'aegis-review-contract', 'work');
  const codex = REVIEW.buildToolArgv('codex', 'stdin-only', null, cwd);
  assert.ok(codex.includes('--dangerously-bypass-approvals-and-sandbox'));
  assert.ok(codex.includes('--ephemeral'));
  assert.ok(codex.includes('--ignore-user-config'));
  assert.strictEqual(codex[codex.length - 1], '-');
  assert.strictEqual(codex.includes('stdin-only'), false);

  const grok = REVIEW.buildToolArgv('grok', 'bounded prompt', { maxTurns: 8, webAccess: false }, cwd);
  assert.deepStrictEqual(grok.slice(0, 2), ['-p', 'bounded prompt']);
  assert.ok(grok.includes('read_file'));
  assert.ok(grok.includes('Grep,Bash,Edit,MCPTool,WebFetch,WebSearch'));
  assert.ok(grok.includes('--disable-web-search'));
  assert.deepStrictEqual(grok.slice(-2), ['8', '--disable-web-search']);
  assert.throws(() => REVIEW.buildToolArgv('copilot', 'x', null, cwd), /no launch argv/);
  assert.match(REVIEW.authorizeLaunch('copilot').reason, /ADVISORY.*approvalAuthority NONE/);
});

test('reviewer environments use only caller-supplied disposable paths and fixed safety flags', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-review-env-contract-'));
  try {
    const sandbox = {
      home: path.join(root, 'home'),
      tmp: path.join(root, 'tmp'),
    };
    fs.mkdirSync(sandbox.home);
    fs.mkdirSync(sandbox.tmp);
    const source = { LANG: 'C', NODE_ENV: 'production', XAI_API_KEY: 'must-not-pass' };
    const grok = REVIEW.reviewerEnvironment('grok', sandbox, source);
    assert.deepStrictEqual(Object.keys(grok).sort(), [
      'GROK_DISABLE_AUTOUPDATER', 'GROK_MANAGED_MCPS_ENABLED', 'HOME', 'LANG', 'PATH', 'TMPDIR',
    ]);
    assert.strictEqual(grok.HOME, sandbox.home);
    assert.strictEqual(grok.TMPDIR, sandbox.tmp);
    assert.strictEqual(grok.GROK_DISABLE_AUTOUPDATER, '1');
    assert.strictEqual(grok.GROK_MANAGED_MCPS_ENABLED, 'false');
    assert.strictEqual(Object.prototype.hasOwnProperty.call(grok, 'XAI_API_KEY'), false);

    const codex = REVIEW.reviewerEnvironment('codex', sandbox, source);
    assert.strictEqual(codex.CODEX_HOME, path.join(sandbox.home, '.codex'));
    assert.strictEqual(Object.prototype.hasOwnProperty.call(codex, 'OPENAI_API_KEY'), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Grok read receipts require exact returned bytes, path, digest, and one terminal end event', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-grok-receipt-contract-'));
  try {
    const relative = 'subject/file.txt';
    const text = 'alpha\nbeta\n';
    const manifest = [{
      path: relative,
      lines: 2,
      bytes: Buffer.byteLength(text),
      sha256: sha256(text),
    }];
    const events = [
      {
        type: 'tool_call',
        toolCallId: 'read-1',
        toolName: 'read_file',
        status: 'in_progress',
        rawInput: { target_file: relative },
      },
      {
        type: 'tool_call_update',
        toolCallId: 'read-1',
        status: 'completed',
        rawOutput: { type: 'ReadFile', FileContent: {
          content: text,
          raw_output: text,
          absolute_path: path.join(cwd, relative),
          offset: null,
          total_lines: 3,
        } },
      },
      { type: 'text', data: '{"disposition":"APPROVE","findings":[],"unverified":[]}' },
      { type: 'end', stopReason: 'end_turn', total_cost_usd: 0 },
    ];
    const raw = events.map((event) => JSON.stringify(event)).join('\n') + '\n';
    const coverage = REVIEW.grokReadReceiptCoverage(raw, manifest, cwd);
    assert.strictEqual(coverage.complete, true);
    assert.deepStrictEqual(coverage.readPaths, [relative]);
    assert.deepStrictEqual(coverage.missingPaths, []);

    const noReturnedBytes = events.map((event) => ({ ...event }));
    noReturnedBytes[1] = {
      ...noReturnedBytes[1],
      rawOutput: { type: 'ReadFile', FileContent: {
        content: '', raw_output: null, absolute_path: path.join(cwd, relative), total_lines: 3,
      } },
    };
    const incomplete = REVIEW.grokReadReceiptCoverage(
      noReturnedBytes.map((event) => JSON.stringify(event)).join('\n') + '\n', manifest, cwd,
    );
    assert.strictEqual(incomplete.complete, false);
    assert.deepStrictEqual(incomplete.missingPaths, [relative]);
    assert.strictEqual(REVIEW.enforceGrokReadReceipts('grok', { disposition: 'APPROVE' }, incomplete).parsed, null);

    const wrongReturnedPath = events.map((event) => ({ ...event }));
    wrongReturnedPath[1] = {
      ...wrongReturnedPath[1],
      rawOutput: { type: 'ReadFile', FileContent: {
        content: text,
        raw_output: text,
        absolute_path: path.join(cwd, 'subject', 'same-length-sibling.txt'),
        offset: null,
        total_lines: 3,
      } },
    };
    const wrongPathCoverage = REVIEW.grokReadReceiptCoverage(
      wrongReturnedPath.map((event) => JSON.stringify(event)).join('\n') + '\n', manifest, cwd,
    );
    assert.strictEqual(wrongPathCoverage.complete, false,
      'a read receipt for different returned path satisfied exact-subject coverage');
    assert.deepStrictEqual(wrongPathCoverage.missingPaths, [relative]);

    const wrongDigest = events.map((event) => ({ ...event }));
    const sameLengthWrongBytes = text.replace('alpha', 'omega');
    assert.strictEqual(Buffer.byteLength(sameLengthWrongBytes), Buffer.byteLength(text));
    wrongDigest[1] = {
      ...wrongDigest[1],
      rawOutput: { type: 'ReadFile', FileContent: {
        content: sameLengthWrongBytes,
        raw_output: sameLengthWrongBytes,
        absolute_path: path.join(cwd, relative),
        offset: null,
        total_lines: 3,
      } },
    };
    const wrongDigestCoverage = REVIEW.grokReadReceiptCoverage(
      wrongDigest.map((event) => JSON.stringify(event)).join('\n') + '\n', manifest, cwd,
    );
    assert.strictEqual(wrongDigestCoverage.complete, false,
      'same-length wrong returned bytes satisfied the manifest digest');
    assert.deepStrictEqual(wrongDigestCoverage.missingPaths, [relative]);

    const duplicateEnd = raw + `${JSON.stringify({ type: 'end', stopReason: 'end_turn', total_cost_usd: 0 })}\n`;
    assert.strictEqual(REVIEW.grokReadReceiptCoverage(duplicateEnd, manifest, cwd).complete, false);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('Grok billing validation distinguishes subscription evidence from cost telemetry and fails closed', () => {
  const safe = {
    ok: true,
    initialized: true,
    groupDrained: true,
    retainSandbox: false,
    billing: {
      subscription_tier: 'SuperGrok',
      config: {
        isUnifiedBillingUser: true,
        onDemandCap: { val: 0 },
        onDemandUsed: { val: 0 },
        prepaidBalance: { val: 0 },
      },
    },
    autoTopup: {},
  };
  const invocationId = 'REV-containment-billing-proof';
  const nowMs = Date.parse('2026-08-30T12:00:00.000Z');
  const validated = REVIEW.validateGrokBillingEvidence(safe, { invocationId, nowMs });
  assert.strictEqual(validated.ok, true);
  assert.strictEqual(validated.mode, 'zero-metered');
  assert.strictEqual(validated.invocationId, invocationId);
  assert.ok(typeof validated.preflightId === 'string' && validated.preflightId.length > 8);
  assert.strictEqual(validated.observedAt, '2026-08-30T12:00:00.000Z');
  assert.strictEqual(validated.expiresAt, '2026-08-30T12:05:00.000Z');
  assert.strictEqual(validated.subscriptionTier, 'SuperGrok');
  assert.strictEqual(validated.subscriptionTierState, 'REPORTED');
  assert.strictEqual(validated.unifiedBilling, true);
  assert.strictEqual(validated.onDemandCap, 0);
  assert.strictEqual(validated.onDemandUsed, 0);
  assert.strictEqual(validated.prepaidBalance, 0);
  assert.strictEqual(validated.autoTopup, 'ABSENT');
  assert.strictEqual(REVIEW.validateGrokBillingEvidence({
    ...safe,
    billing: { ...safe.billing, config: { ...safe.billing.config, onDemandUsed: { val: 0.01 } } },
  }, { invocationId, nowMs }).ok, false);
  assert.strictEqual(REVIEW.validateGrokBillingEvidence(
    { ...safe, autoTopup: { enabled: true } }, { invocationId, nowMs }).ok, false);
  assert.strictEqual(REVIEW.validateGrokBillingEvidence(safe, { nowMs }).ok, false,
    'billing evidence without an exact invocation binding must refuse');

  const terminal = `${JSON.stringify({ type: 'end', stopReason: 'end_turn', total_cost_usd: 0.25 })}\n`;
  const spend = REVIEW.authoritativeGrokSpend(terminal, 1);
  assert.strictEqual(spend.ok, true);
  assert.strictEqual(spend.classification, 'credit-equivalent-pricing-telemetry');
  assert.strictEqual(spend.authorizationScope, 'post-run-telemetry-only');
  assert.strictEqual(spend.telemetryCeilingUsd, 1);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(spend, 'capUsd'), false);
  assert.strictEqual(spend.billedSpend, false);
  assert.strictEqual(spend.capEnforcement, false);
  assert.strictEqual(spend.preRunSpendEnforced, false);
  assert.strictEqual(spend.incrementalSpendEnforced, false);
  assert.deepStrictEqual(REVIEW.grokSpendContract(10), {
    authorizationScope: 'post-run-telemetry-only',
    telemetryCeilingUsd: 10,
    billingRequirement: 'fresh-execution-bound-zero-metered',
    billedSpend: false,
    capEnforcement: false,
    preRunSpendEnforced: false,
    incrementalSpendEnforced: false,
    enforceablePrechargeCap: false,
  });
  assert.strictEqual(REVIEW.authoritativeGrokSpend(terminal, 0.1).ok, false);
  assert.strictEqual(REVIEW.authoritativeGrokSpend(terminal + terminal, 1).ok, false);
});

test('review paths, check receipts, auth freshness, and unknown launch fields all fail closed', () => {
  for (const rejected of [
    '../escape.txt',
    '/absolute.txt',
    '.env',
    'builder-control/ledger.json',
    'builder-control/review-raw/output.json',
    'auth/credential.json',
  ]) assert.throws(() => REVIEW.safeReviewPath(rejected), /invalid|escapes|sensitive|runtime/);
  assert.strictEqual(REVIEW.safeReviewPath('builder-control/aegis-worker.cjs'), 'builder-control/aegis-worker.cjs');

  assert.deepStrictEqual(REVIEW.runnablePacketChecks({ testsRequired: [
    'node builder-control/test/a.test.cjs',
    'node builder-control/engineering-os.cjs --gate-done',
  ] }), ['node builder-control/test/a.test.cjs']);
  assert.throws(
    () => WORKER.normalizeLaunchSpec({ provider: 'claude-subscription', prompt: 'x', shell: true }),
    /unknown launchSpec field/,
  );
  assert.throws(
    () => WORKER.assertClaudeOAuthFreshness({ expiresAt: 1, hasRefreshToken: true }, 1),
    /expired or too close to expiry/,
  );
  assert.throws(() => WORKER.normalizeTimeoutSec(3601), /must be an integer/);
});

test('source contracts keep production containment fail-closed without executing live containment here', () => {
  const containmentSource = fs.readFileSync(path.join(__dirname, '..', 'sandbox-containment.cjs'), 'utf8');
  const reviewSource = fs.readFileSync(path.join(__dirname, '..', 'review-adapters.cjs'), 'utf8');
  const workerSource = fs.readFileSync(path.join(__dirname, '..', 'aegis-worker.cjs'), 'utf8');

  assert.match(topLevelFunctionSource(containmentSource, 'assertSandboxOperational'),
    /refusing uncontained launch/);
  assert.match(topLevelFunctionSource(containmentSource, 'prepareWorkerContainment'),
    /assertSandboxOperational\(\);/);
  assert.match(topLevelFunctionSource(reviewSource, 'containedReviewerCommand'),
    /assertSandboxOperational\(\);/);
  assert.match(workerSource, /sandbox:\s*\{[\s\S]*failIfUnavailable:\s*true/);
  assert.match(workerSource, /allowUnsandboxedCommands:\s*false/);

  const thisSource = fs.readFileSync(__filename, 'utf8');
  const contractTestAt = thisSource.indexOf("test('source contracts keep production containment");
  assert.ok(contractTestAt > 0, 'could not isolate snapshot-safe calls from the source-guard declaration');
  const exercisedSuiteSource = thisSource.slice(0, contractTestAt);
  for (const forbiddenCall of [
    'REVIEW.runTool(',
    'REVIEW.containedReviewerCommand(',
    'REVIEW.validateGrokExecutableIdentity(',
    'CONTAINMENT.sandboxCapability(',
    'CONTAINMENT.assertSandboxOperational(',
    'WORKER.resolveClaudeExecutable(',
    'WORKER.resolveGrokExecutable(',
  ]) {
    assert.strictEqual(exercisedSuiteSource.includes(forbiddenCall), false,
      `snapshot contract suite contains a live host operation: ${forbiddenCall}`);
  }
});

test('check snapshot source has explicit reads and per-execution network only', () => {
  const runSource = fs.readFileSync(path.join(__dirname, '..', 'aegis-run.cjs'), 'utf8');
  const execute = topLevelFunctionSource(runSource, 'executeCheckInSnapshot');
  assert.doesNotMatch(execute, /['"]\(allow file-read\*\)['"]/,
    'blanket file-read authority returned to the check sandbox');
  assert.doesNotMatch(execute, /subpath "\/opt\/homebrew\/(?:Cellar|opt|bin)"/,
    'broad Homebrew package-tree read authority returned to the check sandbox');
  assert.match(runSource, /function nodeRuntimeReadRoots\(\)[\s\S]*\/usr\/bin\/otool[\s\S]*fs\.realpathSync\(candidate\)/,
    'check sandbox does not derive an exact linked-library allowlist from the pinned Node executable');
  assert.doesNotMatch(execute, /\b8796\b|\b18797\b/,
    'fixed loopback test ports returned to the check sandbox');
  assert.match(execute, /reserveContainedCheckPorts\(2\)/);
  assert.match(execute, /node --test builder-control\/test\/hosting\.test\.cjs/,
    'the canonical packet command must receive its per-execution ports');
  assert.match(execute, /AEGIS_TEST_HOSTING_PORT/);
  assert.match(execute, /AEGIS_TEST_HOSTING_API_PORT/);
  assert.ok(execute.includes('(subpath "/System")'));
  assert.match(execute, /subpath .*boundaryRoot/);
});

process.on('beforeExit', () => {
  console.log(`${passed} passed, ${process.exitCode ? 'at least 1 failed' : '0 failed'}.`);
});
