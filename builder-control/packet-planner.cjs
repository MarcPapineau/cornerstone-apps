#!/usr/bin/env node
/**
 * packet-planner.cjs — Builder Control System v1, read-only packet planner.
 *
 * Answers two questions about a SET of task packets: in what order could they
 * be integrated, and which of them are fighting over the same file. It plans.
 * It never runs anything — no worker, no reviewer, no model, no git, no lock,
 * no ledger read or write, no run, and no filesystem write of any kind. The
 * only files it opens are the packet files it was handed.
 *
 * THE WAVES ARE ANALYSIS ONLY. A wave says "these packets declare disjoint
 * write sets, so they could not have collided" — it is not permission to run
 * them together, and nothing here launches or schedules work. The reported
 * executionMode stays SERIAL_ONLY, exactly as CONTROL-CONTRACT.md pins it for
 * coordination metadata. `serialOrder` is the order a human or a future
 * scheduler would integrate them in, one at a time.
 *
 * Usage:
 *   node builder-control/packet-planner.cjs --plan --packet <a.json> [--packet <b.json> …] [--json]
 *
 * Exit codes:
 *   0  PLANNED — every packet valid and coordinated, and the set is orderable
 *   1  REFUSED — the set is invalid or unplannable: an invalid packet, a packet
 *                without coordination, a duplicate input path or packet id, a
 *                missing dependency, a self-dependency, or a dependency cycle
 *   2  malformed CLI, or an input that could not be read or parsed at all
 *
 * VALIDITY IS NOT DECIDED HERE. Every packet is handed to the canonical
 * validator — `packet-tools.cjs --validate` — as a subprocess, and its exit
 * code is the answer (0 valid / 1 invalid / 2 unreadable). Schema, registry,
 * authorization and coordination-shape rules live there and are deliberately
 * not reimplemented; the coordination checks below are ordering questions the
 * validator cannot answer, because it only ever sees one packet at a time.
 *
 * DETERMINISM. Output is a pure function of the packet file BYTES, never of
 * argument order: packets sort by packetId, waves take ready packets in
 * lexical order, and write-set paths, dependency ids and conflicts are sorted
 * before they are emitted. Two runs over the same set in different orders
 * produce byte-identical output.
 *
 * ...and never of WHERE the run happened. No path this program emits carries a
 * checkout location or a caller's temporary directory: an input inside the
 * repository is named by its repository-relative path, anything else by its
 * basename alone, and the validator is named only as the fixed contract path
 * `builder-control/packet-tools.cjs`. Text that arrives from somewhere else —
 * a filesystem error, the validator's own output — is scrubbed the same way,
 * because a message is part of the report. Two machines planning the same set
 * produce the same report; a report that named /Users/<somebody> could not be
 * compared against one from anywhere else.
 */
'use strict';

// Reached through the module object (childProcess.spawnSync, never a
// destructured reference) so a test can wrap it and prove exactly which
// subprocesses this planner starts — the canonical validator, and nothing else.
const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const WORKSPACE_ROOT = path.resolve(__dirname, '..');
const PACKET_TOOLS = path.join(__dirname, 'packet-tools.cjs');
// How the validator is NAMED in the report: the contract path, never the
// resolved one. PACKET_TOOLS is where this checkout happens to keep it and is
// only ever passed to spawnSync; PACKET_TOOLS_LABEL is what a reader is told.
const PACKET_TOOLS_LABEL = 'builder-control/packet-tools.cjs';

const SCHEMA_VERSION = 1;
const EXECUTION_MODE = 'SERIAL_ONLY';
const WRITE_SET_CONFLICT_TYPE = 'WRITE_SET_OVERLAP';
const CYCLE_CONFLICT_TYPE = 'DEPENDENCY_CYCLE';
const CONFLICT_RESOLUTION = 'SERIALIZED_BY_PLANNER';

// Exit code carried by each refusal. 2 (could not even read the input) always
// outranks 1 (read it, refused it) — a set is never reported as merely invalid
// when part of it was never actually examined.
const REFUSAL_EXIT = {
  INVALID_ARGUMENTS: 2,
  NO_PACKETS: 2,
  UNREADABLE_PACKET: 2,
  VALIDATOR_UNAVAILABLE: 2,
  INVALID_PACKET: 1,
  DUPLICATE_PACKET_PATH: 1,
  DUPLICATE_PACKET_ID: 1,
  MISSING_COORDINATION: 1,
  INVALID_COORDINATION: 1,
  SELF_DEPENDENCY: 1,
  MISSING_DEPENDENCY: 1,
  DEPENDENCY_CYCLE: 1,
};

const sorted = (values) => Array.from(values).slice().sort();

// ─── Naming a path in the report ─────────────────────────────────────────────
// Inside the repository: the repository-relative path, forward-slashed, which
// is the same string on every machine. Outside it (a scratch directory, an
// absolute path from another tree): the basename alone. The full path is still
// what gets READ and what the validator is handed — this only governs what is
// said about it.
function label(inputPath) {
  const absolutePath = path.resolve(inputPath);
  const relative = path.relative(WORKSPACE_ROOT, absolutePath);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return path.basename(absolutePath);
  }
  return relative.split(path.sep).join('/');
}

// Absolute paths that arrive inside somebody else's message. Anchored on a
// non-word character so a bare separator ("read/parse") is left alone, and
// stopping at quotes and sentence punctuation so a trailing ":" or "," is not
// dragged into the basename.
const ABSOLUTE_PATH = /(?<![\w.~-])(?:\/[^\s'"()<>:;,]+)+/g;

function scrub(text) {
  return String(text === undefined || text === null ? '' : text)
    // Anything under this checkout becomes repository-relative first, so it
    // keeps the context a bare basename would throw away.
    .split(WORKSPACE_ROOT + path.sep).join('')
    .replace(ABSOLUTE_PATH, (match) => path.basename(match));
}

// ─── Reading one packet ──────────────────────────────────────────────────────
// The hash is over the exact bytes on disk, not over a re-serialized object: a
// reformatted packet that parses to the same value is a different packet file,
// and a plan that claimed otherwise would be describing a file nobody has.
function readPacketFile(inputPath) {
  const absolutePath = path.resolve(inputPath);
  let bytes;
  try {
    bytes = fs.readFileSync(absolutePath);
  } catch (error) {
    return { unreadable: `cannot read ${label(inputPath)}: ${scrub(error.message)}` };
  }
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  let packet;
  try {
    packet = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    return { unreadable: `cannot parse ${label(inputPath)} as JSON: ${scrub(error.message)}` };
  }
  return { inputPath, absolutePath, sha256, packet };
}

// ─── The canonical validator, as a subprocess ────────────────────────────────
function runCanonicalValidator(absolutePath) {
  const outcome = childProcess.spawnSync(
    process.execPath,
    [PACKET_TOOLS, '--validate', absolutePath],
    { cwd: WORKSPACE_ROOT, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 },
  );
  if (outcome.error) return { available: false, detail: outcome.error.message };
  if (outcome.status === null) {
    return { available: false, detail: `terminated by signal ${outcome.signal}` };
  }
  const detail = String(outcome.stderr || outcome.stdout || '').trim().split('\n').slice(0, 4).join('; ');
  return { available: true, status: outcome.status, detail };
}

// ─── Coordination, read as an ordering declaration ───────────────────────────
// Shape is the validator's job. What is re-checked here is only what a planner
// cannot proceed without: that the declaration exists at all, and that the two
// fields the plan is computed from are usable arrays.
function readCoordination(packet) {
  const coordination = packet && packet.coordination;
  if (coordination === undefined) {
    return { code: 'MISSING_COORDINATION', detail: 'declares no coordination{}; a packet cannot be ordered against others without one' };
  }
  if (typeof coordination !== 'object' || coordination === null || Array.isArray(coordination)) {
    return { code: 'INVALID_COORDINATION', detail: 'coordination must be an object' };
  }
  if (coordination.executionMode !== EXECUTION_MODE) {
    return { code: 'INVALID_COORDINATION', detail: `coordination.executionMode must be "${EXECUTION_MODE}"` };
  }
  const dependsOn = coordination.dependsOnPacketIds;
  if (!Array.isArray(dependsOn) || dependsOn.some((id) => typeof id !== 'string' || !id.trim())) {
    return { code: 'INVALID_COORDINATION', detail: 'coordination.dependsOnPacketIds must be an array of packet ids' };
  }
  const writeSet = coordination.writeSet;
  if (!Array.isArray(writeSet) || writeSet.length === 0
      || writeSet.some((value) => typeof value !== 'string' || !value.trim())) {
    return { code: 'INVALID_COORDINATION', detail: 'coordination.writeSet must be a non-empty array of exact paths' };
  }
  return { dependsOn: sorted(dependsOn), writeSet: sorted(writeSet) };
}

// ─── Conflicts ───────────────────────────────────────────────────────────────
// One record per pair of packets, keyed on the pair so the same two packets
// colliding again only widens the path list instead of emitting a second,
// order-dependent record.
function recordConflict(conflicts, firstId, secondId, paths) {
  const packetIds = sorted([firstId, secondId]);
  const key = packetIds.join('\u0000');
  const existing = conflicts.get(key);
  if (existing) {
    for (const value of paths) existing.paths.add(value);
    return;
  }
  conflicts.set(key, { packetIds, paths: new Set(paths) });
}

// Every unordered pair, intersected BEFORE a single wave is built. A wave-local
// check can only ever see the pairs that happen to land in one round, and two
// packets that write the same path but are separated by a dependency edge never
// share a round: B depends on A and overlaps A, so A goes to wave 1 and B to
// wave 2 having never been compared against it, and a real collision is
// reported as none. Whether two packets write the same exact path is a fact
// about their write sets, not about the order the graph puts them in, so it is
// computed from the write sets alone, for every pair, up front.
function computeWriteSetOverlaps(entries) {
  const conflicts = new Map();
  const ordered = entries.slice()
    .sort((a, b) => (a.packetId < b.packetId ? -1 : a.packetId > b.packetId ? 1 : 0));
  for (let first = 0; first < ordered.length; first++) {
    const claimed = new Set(ordered[first].writeSet);
    for (let second = first + 1; second < ordered.length; second++) {
      const shared = ordered[second].writeSet.filter((target) => claimed.has(target));
      if (shared.length) {
        recordConflict(conflicts, ordered[first].packetId, ordered[second].packetId, shared);
      }
    }
  }
  return conflicts;
}

function renderConflicts(conflicts, cycleMembers) {
  const records = Array.from(conflicts.values()).map((conflict) => ({
    type: WRITE_SET_CONFLICT_TYPE,
    packetIds: conflict.packetIds,
    paths: sorted(conflict.paths),
    resolution: CONFLICT_RESOLUTION,
  }));
  // A cycle is a conflict too, and the one conflict no `resolution` may be
  // claimed for: the planner did not serialize it, it refused it. It carries
  // the packet ids and nothing else.
  if (cycleMembers && cycleMembers.length) {
    records.push({ type: CYCLE_CONFLICT_TYPE, packetIds: sorted(cycleMembers) });
  }
  const key = (record) => [record.type, ...record.packetIds].join('\u0000');
  return records.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}

// ─── Which packets are actually in the cycle ─────────────────────────────────
// Everything still remaining when nothing can start is BLOCKED, but a packet
// that merely depends on a cycle is a casualty of it, not a member: naming it
// sends someone to go edit a packet that has nothing wrong with it. Members are
// exactly the packets of a strongly connected component holding more than one
// packet (Tarjan, iterative, over sorted nodes and sorted edges so the answer
// never depends on traversal order). A self-dependency is refused earlier and
// never reaches here, so a one-packet component is never a cycle.
function findCycleMembers(remaining, byId) {
  const nodes = sorted(remaining);
  const present = new Set(nodes);
  const edges = new Map(nodes.map((id) => [id,
    sorted(byId.get(id).dependsOn).filter((dependency) => present.has(dependency))]));

  const index = new Map();
  const lowLink = new Map();
  const onStack = new Set();
  const stack = [];
  const members = new Set();
  let counter = 0;

  const open = (id) => {
    index.set(id, counter);
    lowLink.set(id, counter);
    counter++;
    stack.push(id);
    onStack.add(id);
  };

  for (const root of nodes) {
    if (index.has(root)) continue;
    open(root);
    const work = [{ id: root, next: 0 }];
    while (work.length) {
      const frame = work[work.length - 1];
      const neighbours = edges.get(frame.id);
      if (frame.next < neighbours.length) {
        const neighbour = neighbours[frame.next++];
        if (!index.has(neighbour)) {
          open(neighbour);
          work.push({ id: neighbour, next: 0 });
        } else if (onStack.has(neighbour)) {
          lowLink.set(frame.id, Math.min(lowLink.get(frame.id), index.get(neighbour)));
        }
        continue;
      }
      work.pop();
      if (work.length) {
        const parent = work[work.length - 1];
        lowLink.set(parent.id, Math.min(lowLink.get(parent.id), lowLink.get(frame.id)));
      }
      if (lowLink.get(frame.id) === index.get(frame.id)) {
        const component = [];
        let popped;
        do {
          popped = stack.pop();
          onStack.delete(popped);
          component.push(popped);
        } while (popped !== frame.id);
        if (component.length > 1) for (const id of component) members.add(id);
      }
    }
  }

  // Nothing can start only because every remaining packet depends on another
  // remaining packet, so a component larger than one always exists. If that
  // ever stopped holding, name the whole stuck set rather than name nothing.
  return members.size ? sorted(members) : nodes;
}

// ─── Deterministic greedy waves ──────────────────────────────────────────────
// Each round takes the dependency-ready packets in lexical order and adds a
// packet only when its exact write set is disjoint from everything already
// claimed in that round. An overlapping packet is DEFERRED, never dropped: it
// lands in a later wave. Because the first ready packet always fits, every wave
// is non-empty and the loop always makes progress.
//
// The conflicts are NOT accumulated here. They come from
// computeWriteSetOverlaps over every pair, computed once before the first
// round, because a wave-local tally can only see the pairs that happen to meet
// in one round and would silently report a real collision as none whenever a
// dependency edge keeps the two packets in different waves.
function buildWaves(entries) {
  const byId = new Map(entries.map((entry) => [entry.packetId, entry]));
  const remaining = sorted(byId.keys());
  const completed = new Set();
  const waves = [];
  const conflicts = computeWriteSetOverlaps(entries);

  while (remaining.length) {
    const ready = remaining.filter((id) => byId.get(id).dependsOn.every((dep) => completed.has(dep)));
    if (!ready.length) {
      // Nothing can start and nothing has finished: the remainder depends on
      // itself, directly or through a chain. Name only the packets actually in
      // the cycle, not everything the cycle happens to be blocking.
      const cycle = findCycleMembers(remaining, byId);
      return { cycle, waves: [], conflicts: renderConflicts(conflicts, cycle) };
    }

    const wave = [];
    const claimed = new Set(); // exact paths already spoken for this wave
    for (const id of ready) {
      const writeSet = byId.get(id).writeSet;
      // Overlapping the wave defers this packet to a later one; the pair was
      // already recorded up front, so there is nothing to record here.
      if (writeSet.some((target) => claimed.has(target))) continue;
      wave.push(id);
      for (const target of writeSet) claimed.add(target);
    }

    waves.push({ wave: waves.length + 1, packetIds: wave });
    for (const id of wave) {
      completed.add(id);
      remaining.splice(remaining.indexOf(id), 1);
    }
  }

  return { cycle: null, waves, conflicts: renderConflicts(conflicts) };
}

// ─── The plan ────────────────────────────────────────────────────────────────
/**
 * planPacketFiles(packetPaths) -> plan object. Pure analysis; writes nothing.
 *
 * The returned object carries `exitCode` alongside the report so the CLI does
 * not re-derive process semantics from the status string, and so a caller can
 * assert on the same number the shell sees.
 */
function planPacketFiles(packetPaths) {
  const refusals = [];
  let exitCode = 0;
  // Every message goes through scrub() here, so a refusal can never carry a
  // checkout location or a caller's temporary directory into the report — not
  // even one assembled by a call site that forgot to label its path.
  const refuse = (code, message) => {
    refusals.push({ code, message: scrub(message) });
    exitCode = Math.max(exitCode, REFUSAL_EXIT[code]);
  };

  const finish = (packets, waves, serialOrder, conflicts, packetSetHash) => ({
    schemaVersion: SCHEMA_VERSION,
    status: refusals.length ? 'REFUSED' : 'PLANNED',
    executionMode: EXECUTION_MODE,
    exitCode,
    packetSetHash,
    packets,
    waves,
    serialOrder,
    conflicts,
    refusals: refusals.slice().sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1
      : a.message < b.message ? -1 : a.message > b.message ? 1 : 0)),
  });

  if (!Array.isArray(packetPaths)) {
    refuse('INVALID_ARGUMENTS', 'planPacketFiles requires an array of packet paths');
    return finish([], [], [], [], null);
  }
  if (!packetPaths.length) {
    refuse('NO_PACKETS', 'no packet was supplied; pass --packet <path> at least once');
    return finish([], [], [], [], null);
  }
  const badPath = packetPaths.find((value) => typeof value !== 'string' || !value.trim());
  if (badPath !== undefined) {
    refuse('INVALID_ARGUMENTS', `packet path ${JSON.stringify(badPath)} must be a non-empty string`);
    return finish([], [], [], [], null);
  }

  // The same packet handed in twice is a mistake in the caller's set, not a
  // set of one: it is refused, and only examined once so the rest of the
  // report stays coherent.
  const seenPaths = new Map();
  const uniquePaths = [];
  for (const value of packetPaths) {
    const absolutePath = path.resolve(value);
    if (seenPaths.has(absolutePath)) {
      refuse('DUPLICATE_PACKET_PATH', `packet path ${label(value)} was supplied more than once`);
      continue;
    }
    seenPaths.set(absolutePath, value);
    uniquePaths.push(value);
  }

  const entries = [];
  for (const inputPath of uniquePaths) {
    const read = readPacketFile(inputPath);
    if (read.unreadable) {
      refuse('UNREADABLE_PACKET', read.unreadable);
      continue;
    }

    // Canonical validity first, so the planner never reports an ordering
    // opinion about a packet the validator would reject.
    const validation = runCanonicalValidator(read.absolutePath);
    if (!validation.available) {
      refuse('VALIDATOR_UNAVAILABLE', `${PACKET_TOOLS_LABEL} could not be run for ${label(inputPath)}: ${scrub(validation.detail)}`);
      continue;
    }
    if (validation.status === 2) {
      refuse('UNREADABLE_PACKET', `canonical validator could not read ${label(inputPath)}: ${scrub(validation.detail)}`);
      continue;
    }
    if (validation.status !== 0) {
      refuse('INVALID_PACKET', `canonical validator rejected ${label(inputPath)}: ${scrub(validation.detail)}`);
      continue;
    }

    const packetId = read.packet && read.packet.packetId;
    if (typeof packetId !== 'string' || !packetId.trim()) {
      refuse('INVALID_PACKET', `${label(inputPath)} has no usable packetId`);
      continue;
    }

    const coordination = readCoordination(read.packet);
    if (coordination.code) {
      refuse(coordination.code, `${packetId} ${coordination.detail}`);
      continue;
    }

    entries.push({
      packetId,
      sha256: read.sha256,
      dependsOn: coordination.dependsOn,
      writeSet: coordination.writeSet,
    });
  }

  // Two different files claiming one packet id makes every dependency edge
  // pointing at that id ambiguous, so the set cannot be ordered at all.
  const byId = new Map();
  for (const entry of entries) {
    if (byId.has(entry.packetId)) {
      refuse('DUPLICATE_PACKET_ID', `packet id ${entry.packetId} is declared by more than one supplied packet`);
      continue;
    }
    byId.set(entry.packetId, entry);
  }

  for (const entry of entries) {
    for (const dependency of entry.dependsOn) {
      if (dependency === entry.packetId) {
        refuse('SELF_DEPENDENCY', `${entry.packetId} depends on itself`);
      } else if (!byId.has(dependency)) {
        refuse('MISSING_DEPENDENCY', `${entry.packetId} depends on ${dependency}, which is not in the supplied set`);
      }
    }
  }

  const packets = entries
    .map((entry) => ({
      packetId: entry.packetId,
      sha256: entry.sha256,
      dependsOnPacketIds: entry.dependsOn,
      writeSet: entry.writeSet,
    }))
    .sort((a, b) => (a.packetId < b.packetId ? -1 : a.packetId > b.packetId ? 1
      : a.sha256 < b.sha256 ? -1 : a.sha256 > b.sha256 ? 1 : 0));

  // The set hash identifies exactly these packet files at exactly these bytes.
  // Canonical form: id and hash per line, sorted by id. A packetId cannot
  // contain a space or a newline (schema pattern), so the form is unambiguous.
  // It is null unless every distinct supplied path became a packet the planner
  // fully took in — read, validated and coordinated. Hashing a set that was
  // never fully seen would name something other than what was handed over. A
  // set refused only for its ORDERING (cycle, missing dependency, duplicate id)
  // still hashes: those packets were all taken in.
  const packetSetHash = entries.length === uniquePaths.length
    ? crypto.createHash('sha256')
      .update(packets.map((entry) => `${entry.packetId} ${entry.sha256}\n`).join(''))
      .digest('hex')
    : null;

  if (refusals.length) return finish(packets, [], [], [], packetSetHash);

  const plan = buildWaves(entries);
  if (plan.cycle) {
    refuse('DEPENDENCY_CYCLE', `dependency cycle among ${plan.cycle.join(', ')}`);
    return finish(packets, [], [], plan.conflicts, packetSetHash);
  }

  const serialOrder = plan.waves.reduce((order, wave) => order.concat(wave.packetIds), []);
  return finish(packets, plan.waves, serialOrder, plan.conflicts, packetSetHash);
}

// ─── CLI ─────────────────────────────────────────────────────────────────────
const USAGE = [
  'Usage:',
  '  node builder-control/packet-planner.cjs --plan --packet <packet.json> [--packet <packet.json> …] [--json]',
].join('\n');

function parseArgs(argv) {
  const packetPaths = [];
  let plan = false;
  let json = false;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--plan') { plan = true; continue; }
    if (arg === '--json') { json = true; continue; }
    if (arg === '--packet') {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) {
        return { error: '--packet requires a packet path' };
      }
      packetPaths.push(value);
      index++;
      continue;
    }
    return { error: `unknown argument ${JSON.stringify(arg)}` };
  }
  if (!plan) return { error: '--plan is required' };
  // An invocation naming no packet is a malformed command line, not a plan of
  // an empty set: it is refused here so the CLI never prints a report for a
  // call it is about to exit 2 on. planPacketFiles([]) refuses it too, for
  // callers that come in through the module instead.
  if (!packetPaths.length) return { error: '--packet must be supplied at least once' };
  return { packetPaths, json };
}

function renderText(result) {
  const lines = [];
  lines.push('PACKET PLANNER — read-only analysis');
  lines.push('='.repeat(52));
  lines.push(`status         : ${result.status}`);
  lines.push(`executionMode  : ${result.executionMode}`);
  lines.push(`packetSetHash  : ${result.packetSetHash || '(not computable)'}`);
  lines.push(`packets        : ${result.packets.length}`);
  for (const packet of result.packets) {
    lines.push(`  ${packet.packetId}  ${packet.sha256}`);
    lines.push(`      depends on : ${packet.dependsOnPacketIds.join(', ') || '(none)'}`);
    lines.push(`      writes     : ${packet.writeSet.join(', ')}`);
  }
  if (result.waves.length) {
    lines.push('');
    lines.push('WAVES (analysis only — nothing is launched or scheduled):');
    for (const wave of result.waves) lines.push(`  wave ${wave.wave}: ${wave.packetIds.join(', ')}`);
    lines.push(`serial order   : ${result.serialOrder.join(' -> ')}`);
  }
  if (result.conflicts.length) {
    lines.push('');
    lines.push('CONFLICTS:');
    for (const conflict of result.conflicts) {
      // A DEPENDENCY_CYCLE record carries neither a resolution (the planner
      // refused it rather than serializing it) nor paths, so neither is
      // printed as an empty field or an undefined.
      const resolution = conflict.resolution ? ` -> ${conflict.resolution}` : '';
      lines.push(`  ${conflict.type} ${conflict.packetIds.join(' + ')}${resolution}`);
      for (const target of conflict.paths || []) lines.push(`      ${target}`);
    }
  }
  if (result.refusals.length) {
    lines.push('');
    lines.push('REFUSED:');
    for (const refusal of result.refusals) lines.push(`  ${refusal.code}: ${refusal.message}`);
  }
  return lines.join('\n');
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.error) {
    console.error(`ERROR: ${args.error}`);
    console.error(USAGE);
    process.exit(2);
  }
  const result = planPacketFiles(args.packetPaths);
  console.log(args.json ? JSON.stringify(result, null, 2) : renderText(result));
  process.exit(result.exitCode);
}

if (require.main === module) main();

module.exports = Object.freeze({ planPacketFiles });
