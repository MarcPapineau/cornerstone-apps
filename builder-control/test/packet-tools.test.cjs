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

  const COORDINATED_PATH = 'builder-control/schemas/task-packet.schema.json';
  function coordinatedPacket(coordination, overrides = {}) {
    return minimalPacket({ coordination, ...overrides });
  }
  function validateInline(name, packet) {
    const file = path.join(tmp, `${name}.json`);
    fs.writeFileSync(file, JSON.stringify(packet));
    return validate(file);
  }

  test('packets without coordination remain valid', () => {
    const packet = minimalPacket();
    assert.ok(!('coordination' in packet));
    const result = validateInline('coordination-absent', packet);
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    assert.deepStrictEqual(PACKET_TOOLS.validateCoordination(packet), []);
    assert.deepStrictEqual(PACKET_TOOLS.validateCoordination(canonical), []);
  });

  test('serial coordination with an authorized write set is accepted', () => {
    const result = validateInline('coordination-valid', coordinatedPacket({
      executionMode: 'SERIAL_ONLY',
      dependsOnPacketIds: ['PKT-20260826-ASYNC-WORKER-OPERATOR-BETA'],
      writeSet: [COORDINATED_PATH],
    }));
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
  });

  test('coordination refuses an omitted dependency list', () => {
    const result = validateInline('coordination-deps-omitted', coordinatedPacket({
      executionMode: 'SERIAL_ONLY',
      writeSet: [COORDINATED_PATH],
    }));
    assert.strictEqual(result.status, 1, result.stderr || result.stdout);
    assert.match(result.stderr, /SCHEMA VALIDATION FAILED/);
    assert.match(result.stderr, /dependsOnPacketIds/);
    // The semantic check refuses the same omission on its own, so the rule does
    // not depend on schema ordering to hold.
    const direct = PACKET_TOOLS.validateCoordination(coordinatedPacket({
      executionMode: 'SERIAL_ONLY',
      writeSet: [COORDINATED_PATH],
    }));
    assert.ok(direct.some((error) => /dependsOnPacketIds must be declared/.test(error)), direct.join('; '));
  });

  test('coordination accepts an empty dependency list', () => {
    const packet = coordinatedPacket({
      executionMode: 'SERIAL_ONLY',
      dependsOnPacketIds: [],
      writeSet: [COORDINATED_PATH],
    });
    const result = validateInline('coordination-deps-empty', packet);
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    assert.deepStrictEqual(PACKET_TOOLS.validateCoordination(packet), []);
  });

  test('schema pins executionMode, requires all three coordination keys, and refuses unknown keys', () => {
    for (const [name, coordination] of [
      ['mode-parallel', { executionMode: 'PARALLEL', dependsOnPacketIds: [], writeSet: [COORDINATED_PATH] }],
      ['mode-missing', { dependsOnPacketIds: [], writeSet: [COORDINATED_PATH] }],
      ['writeset-missing', { executionMode: 'SERIAL_ONLY', dependsOnPacketIds: [] }],
      ['writeset-empty', { executionMode: 'SERIAL_ONLY', dependsOnPacketIds: [], writeSet: [] }],
      ['writeset-blank', { executionMode: 'SERIAL_ONLY', dependsOnPacketIds: [], writeSet: [''] }],
      ['writeset-duplicate', {
        executionMode: 'SERIAL_ONLY',
        dependsOnPacketIds: [],
        writeSet: [COORDINATED_PATH, COORDINATED_PATH],
      }],
      ['deps-duplicate', {
        executionMode: 'SERIAL_ONLY',
        dependsOnPacketIds: ['PKT-A-ONE', 'PKT-A-ONE'],
        writeSet: [COORDINATED_PATH],
      }],
      ['deps-not-string', {
        executionMode: 'SERIAL_ONLY',
        dependsOnPacketIds: [7],
        writeSet: [COORDINATED_PATH],
      }],
      ['unknown-key', {
        executionMode: 'SERIAL_ONLY',
        dependsOnPacketIds: [],
        writeSet: [COORDINATED_PATH],
        maxWorkers: 4,
      }],
    ]) {
      const result = validateInline(`coordination-${name}`, coordinatedPacket(coordination));
      assert.strictEqual(result.status, 1, `${name} unexpectedly passed`);
      assert.match(result.stderr, /SCHEMA VALIDATION FAILED/, name);
    }
  });

  test('coordination refuses self-dependency', () => {
    const packet = coordinatedPacket({
      executionMode: 'SERIAL_ONLY',
      dependsOnPacketIds: ['PKT-PATH-AUTHORIZATION-TEST'],
      writeSet: [COORDINATED_PATH],
    });
    assert.strictEqual(packet.packetId, 'PKT-PATH-AUTHORIZATION-TEST');
    const result = validateInline('coordination-self-dependency', packet);
    assert.strictEqual(result.status, 1, result.stderr || result.stdout);
    assert.match(result.stderr, /COORDINATION VALIDATION FAILED/);
    assert.match(result.stderr, /must not depend on its own packet/);
  });

  test('coordination refuses unsafe or malformed write-set paths', () => {
    for (const [name, unsafePath] of [
      ['absolute', '/etc/passwd'],
      ['drive', 'C:/windows/system32'],
      ['traversal', '../builder-control/schemas/task-packet.schema.json'],
      ['nested-traversal', 'builder-control/../outside.json'],
      ['backslash', 'builder-control\\schemas\\task-packet.schema.json'],
      ['glob-star', 'builder-control/schemas/*.json'],
      ['glob-doublestar', 'builder-control/**'],
      ['glob-brace', 'builder-control/schemas/{a,b}.json'],
      ['glob-bracket', 'builder-control/schemas/[ab].json'],
      ['glob-question', 'builder-control/schemas/task-packet.schema.jso?'],
      ['empty-segment', 'builder-control//task-packet.schema.json'],
      ['dot-segment', 'builder-control/./task-packet.schema.json'],
      ['trailing-slash', 'builder-control/schemas/'],
    ]) {
      const result = validateInline(`coordination-writeset-${name}`, coordinatedPacket({
        executionMode: 'SERIAL_ONLY',
        dependsOnPacketIds: [],
        writeSet: [unsafePath],
      }, { filesAllowed: [COORDINATED_PATH, 'builder-control/**'] }));
      assert.strictEqual(result.status, 1, `${name} unexpectedly passed`);
      assert.match(result.stderr, /COORDINATION VALIDATION FAILED/, name);
    }
  });

  test('coordination refuses a write path outside filesAllowed', () => {
    const result = validateInline('coordination-writeset-unauthorized', coordinatedPacket({
      executionMode: 'SERIAL_ONLY',
      dependsOnPacketIds: [],
      writeSet: ['builder-control/aegis-run.cjs'],
    }));
    assert.strictEqual(result.status, 1, result.stderr || result.stdout);
    assert.match(result.stderr, /COORDINATION VALIDATION FAILED/);
    assert.match(result.stderr, /is outside filesAllowed/);
  });

  test('validateCoordination reports non-object coordination and duplicate write paths directly', () => {
    assert.deepStrictEqual(
      PACKET_TOOLS.validateCoordination({ ...minimalPacket(), coordination: [] }),
      ['coordination must be an object']);
    const duplicates = PACKET_TOOLS.validateCoordination(minimalPacket({
      coordination: {
        executionMode: 'SERIAL_ONLY',
        dependsOnPacketIds: [],
        writeSet: [COORDINATED_PATH, COORDINATED_PATH],
      },
    }));
    assert.ok(duplicates.some((error) => /must be unique/.test(error)), duplicates.join('; '));
    const selfDuplicates = PACKET_TOOLS.validateCoordination(minimalPacket({
      coordination: {
        executionMode: 'SERIAL_ONLY',
        dependsOnPacketIds: ['PKT-A-ONE', 'PKT-A-ONE'],
        writeSet: [COORDINATED_PATH],
      },
    }));
    assert.ok(selfDuplicates.some((error) => /must be unique/.test(error)), selfDuplicates.join('; '));
  });

  test('coordination refuses a write path that already exists as a directory', () => {
    const directory = 'builder-control/schemas';
    assert.ok(fs.statSync(path.join(ROOT, directory)).isDirectory(), 'fixture directory must exist');
    const result = validateInline('coordination-writeset-directory', coordinatedPacket({
      executionMode: 'SERIAL_ONLY',
      dependsOnPacketIds: [],
      writeSet: [directory],
    }, { filesAllowed: ['builder-control/**'] }));
    assert.strictEqual(result.status, 1, result.stderr || result.stdout);
    assert.match(result.stderr, /COORDINATION VALIDATION FAILED/);
    assert.match(result.stderr, /is an existing directory/);

    // The rule is about directories, not about existence: a packet may declare
    // an exact leaf it has not created yet.
    const unwritten = 'builder-control/schemas/not-yet-created.json';
    assert.ok(!fs.existsSync(path.join(ROOT, unwritten)), 'fixture leaf must not exist');
    assert.deepStrictEqual(PACKET_TOOLS.validateCoordination(minimalPacket({
      filesAllowed: ['builder-control/**'],
      coordination: {
        executionMode: 'SERIAL_ONLY',
        dependsOnPacketIds: [],
        writeSet: [unwritten],
      },
    })), []);
  });

  test('--new emits all three coordination fields with a deliberately unscoped write set', () => {
    const emitted = spawnSync(process.execPath,
      [TOOL, '--new', '--agent', 'habakkuk', '--objective', 'Prove skeleton coordination emission.'],
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
    assert.strictEqual(emitted.status, 0, emitted.stderr || emitted.stdout);
    const skeleton = JSON.parse(emitted.stdout);
    assert.deepStrictEqual(skeleton.coordination, {
      executionMode: 'SERIAL_ONLY',
      dependsOnPacketIds: [],
      writeSet: [],
    });
    // The generated shape is intentionally incomplete until exact targets are
    // added; generation exposes the decision instead of silently omitting it.
    assert.ok(PACKET_TOOLS.validateCoordination(skeleton).some((error) =>
      /must contain at least one exact path/.test(error)));
    assert.deepStrictEqual(skeleton.coordination.writeSet, []);
    assert.deepStrictEqual(skeleton.filesAllowed, []);
  });

  test('packet validation launches no worker of any kind', () => {
    const attempts = path.join(tmp, 'launch-attempts.log');
    const sentinel = path.join(tmp, 'launch-sentinel.cjs');
    fs.writeFileSync(sentinel, [
      "'use strict';",
      "const fs = require('fs');",
      "const childProcess = require('child_process');",
      "const workerThreads = require('worker_threads');",
      `const ATTEMPTS = ${JSON.stringify(attempts)};`,
      "const record = (kind, target) => fs.appendFileSync(ATTEMPTS, `${kind} ${JSON.stringify(target)}\n`);",
      "for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) {",
      "  const original = childProcess[name];",
      "  childProcess[name] = function (...args) { record(name, args[0]); return original.apply(this, args); };",
      "}",
      "const OriginalWorker = workerThreads.Worker;",
      "workerThreads.Worker = class extends OriginalWorker {",
      "  constructor(...args) { record('worker', args[0]); super(...args); }",
      "};",
    ].join('\n'));

    const file = path.join(tmp, 'coordination-no-worker.json');
    fs.writeFileSync(file, JSON.stringify(coordinatedPacket({
      executionMode: 'SERIAL_ONLY',
      dependsOnPacketIds: ['PKT-20260826-ASYNC-WORKER-OPERATOR-BETA'],
      writeSet: [COORDINATED_PATH],
    })));

    const result = spawnSync(process.execPath, ['--require', sentinel, TOOL, '--validate', file],
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    // Coordination is metadata a future scheduler would read. Validating it
    // must stay a pure read: no process, no thread, nothing executed.
    assert.ok(!fs.existsSync(attempts),
      `validation launched: ${fs.existsSync(attempts) ? fs.readFileSync(attempts, 'utf8') : ''}`);
  });
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`${passed} passed, ${process.exitCode ? 'at least 1' : '0'} failed.`);
