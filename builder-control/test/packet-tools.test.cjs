#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const TOOL = path.join(ROOT, 'builder-control', 'packet-tools.cjs');
const BETA = path.join(ROOT, 'builder-control', 'packets',
  'PKT-20260826-ASYNC-WORKER-OPERATOR-BETA.json');
const HOST_COMMAND = 'node builder-control/test/host-containment.test.cjs';
const HOST_ENTRYPOINT = 'builder-control/test/host-containment.test.cjs';
const PACKET_TOOLS = require('../packet-tools.cjs');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`ok   ${name}`); }
  catch (error) { process.exitCode = 1; console.error(`FAIL ${name}: ${error.message}`); }
}

function validate(packetPath) {
  return spawnSync(process.execPath, [TOOL, '--validate', packetPath], {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
  });
}

function minimalPacket(overrides = {}) {
  return {
    packetId: 'PKT-PATH-AUTHORIZATION-TEST',
    agentId: 'habakkuk',
    objective: 'Prove packet path authorization boundaries.',
    constraints: [],
    sourceOfTruth: ['builder-control/CONTROL-CONTRACT.md'],
    filesAllowed: ['builder-control/schemas/task-packet.schema.json'],
    testsRequired: [],
    stopConditions: [],
    authorization: {
      authorizedBy: 'Marc',
      allowsProtectedPaths: ['builder-control/schemas/task-packet.schema.json'],
      allowsPublicPush: false,
      allowsRelease: false,
    },
    ...overrides,
  };
}

const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aegis-packet-tools-'));
try {
  const canonical = JSON.parse(fs.readFileSync(BETA, 'utf8'));

  test('operator beta accepts one pinned and fully authorized host containment command', () => {
    const result = validate(BETA);
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    assert.deepStrictEqual(canonical.hostContainmentRequired, [HOST_COMMAND]);
  });

  test('governed validation fails closed when the canonical agent registry is missing or unreadable', () => {
    const isolatedRoot = path.join(tmp, 'missing-registry-fixture');
    const isolatedControl = path.join(isolatedRoot, 'builder-control');
    fs.mkdirSync(path.join(isolatedControl, 'schemas'), { recursive: true });
    fs.copyFileSync(TOOL, path.join(isolatedControl, 'packet-tools.cjs'));
    fs.copyFileSync(path.join(ROOT, 'builder-control', 'schemas', 'task-packet.schema.json'),
      path.join(isolatedControl, 'schemas', 'task-packet.schema.json'));
    fs.copyFileSync(path.join(ROOT, 'builder-control', 'protected-paths.json'),
      path.join(isolatedControl, 'protected-paths.json'));
    const packetPath = path.join(isolatedRoot, 'packet.json');
    fs.writeFileSync(packetPath, JSON.stringify(minimalPacket()));
    const isolatedTool = path.join(isolatedControl, 'packet-tools.cjs');
    const runIsolated = () => spawnSync(process.execPath, [isolatedTool, '--validate', packetPath], {
      cwd: isolatedRoot, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
    });

    const missing = runIsolated();
    assert.strictEqual(missing.status, 1, missing.stderr || missing.stdout);
    assert.match(missing.stderr, /canonical agent-registry\.json is missing/);

    fs.writeFileSync(path.join(isolatedControl, 'agent-registry.json'), '{not-json');
    const unreadable = runIsolated();
    assert.strictEqual(unreadable.status, 1, unreadable.stderr || unreadable.stdout);
    assert.match(unreadable.stderr, /canonical agent-registry\.json is unreadable/);
  });

  test('worker and packet validator share one canonical * and ** matcher', () => {
    assert.strictEqual(PACKET_TOOLS.globMatch('builder-control/test/*.cjs',
      'builder-control/test/aegis-worker.test.cjs'), true);
    assert.strictEqual(PACKET_TOOLS.globMatch('builder-control/test/*.cjs',
      'builder-control/test/nested/a.cjs'), false);
    assert.strictEqual(PACKET_TOOLS.globMatch('builder-control/**',
      'builder-control/test/nested/a.cjs'), true);
  });

  test('operator beta cannot omit its mandatory host containment evidence', () => {
    const packet = { ...canonical };
    delete packet.hostContainmentRequired;
    const file = path.join(tmp, 'missing-host.json');
    fs.writeFileSync(file, JSON.stringify(packet));
    const result = validate(file);
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /operator beta requires one pinned top-level host command/);
  });

  test('schema refuses unknown, duplicate, or additional host commands', () => {
    for (const [name, commands] of [
      ['unknown', ['node builder-control/test/not-authorized.cjs']],
      ['duplicate', [HOST_COMMAND, HOST_COMMAND]],
      ['additional', [HOST_COMMAND, 'node builder-control/test/not-authorized.cjs']],
    ]) {
      const file = path.join(tmp, `${name}.json`);
      fs.writeFileSync(file, JSON.stringify({ ...canonical, hostContainmentRequired: commands }));
      const result = validate(file);
      assert.strictEqual(result.status, 1, `${name} unexpectedly passed`);
      assert.match(result.stderr, /SCHEMA VALIDATION FAILED/);
    }
  });

  test('host entrypoint must remain in both packet and protected-path scopes', () => {
    for (const [name, packet] of [
      ['missing-files', { ...canonical, filesAllowed: canonical.filesAllowed.filter((p) => p !== HOST_ENTRYPOINT) }],
      ['missing-authorization', {
        ...canonical,
        authorization: {
          ...canonical.authorization,
          allowsProtectedPaths: canonical.authorization.allowsProtectedPaths
            .filter((p) => p !== HOST_ENTRYPOINT),
        },
      }],
    ]) {
      const file = path.join(tmp, `${name}.json`);
      fs.writeFileSync(file, JSON.stringify(packet));
      const result = validate(file);
      assert.strictEqual(result.status, 1, `${name} unexpectedly passed`);
      assert.match(result.stderr, /HOST CONTAINMENT VALIDATION FAILED/);
    }
  });

  test('absolute and parent-traversal packet authorities are refused before registry matching', () => {
    for (const [name, unsafePath] of [
      ['absolute', '/etc/passwd'],
      ['traversal', '../builder-control/schemas/task-packet.schema.json'],
      ['nested-traversal', 'builder-control/../outside.json'],
    ]) {
      const packet = minimalPacket({
        filesAllowed: [unsafePath],
        authorization: {
          ...minimalPacket().authorization,
          allowsProtectedPaths: [unsafePath],
        },
      });
      const file = path.join(tmp, `${name}-path.json`);
      fs.writeFileSync(file, JSON.stringify(packet));
      const result = validate(file);
      assert.strictEqual(result.status, 1, `${name} unexpectedly passed`);
      assert.match(result.stderr, /PACKET PATH VALIDATION FAILED/);
    }
  });

  test('exact authorization cannot bypass the canonical protected-path registry', () => {
    const bypass = 'unprotected/registry-bypass.txt';
    const packet = minimalPacket({
      filesAllowed: [bypass],
      authorization: {
        ...minimalPacket().authorization,
        allowsProtectedPaths: [bypass],
      },
    });
    const file = path.join(tmp, 'registry-bypass.json');
    fs.writeFileSync(file, JSON.stringify(packet));
    const result = validate(file);
    assert.strictEqual(result.status, 1, result.stderr || result.stdout);
    assert.match(result.stderr, /without canonical protected-path authorization/);
  });

  test('human authorization permits an exact path covered by the canonical overridable registry', () => {
    const file = path.join(tmp, 'canonical-protected.json');
    fs.writeFileSync(file, JSON.stringify(minimalPacket()));
    const result = validate(file);
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);

    const noHuman = minimalPacket({
      authorization: { ...minimalPacket().authorization, authorizedBy: 'none' },
    });
    const noHumanFile = path.join(tmp, 'canonical-protected-no-human.json');
    fs.writeFileSync(noHumanFile, JSON.stringify(noHuman));
    const denied = validate(noHumanFile);
    assert.strictEqual(denied.status, 1, denied.stderr || denied.stdout);
  });
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`${passed} passed, ${process.exitCode ? 'at least 1' : '0'} failed.`);
