#!/usr/bin/env node
/**
 * packet-tools.cjs  — Builder Control System v1, Module 2
 *
 * Usage:
 *   --validate <packet.json>           Validate a packet against task-packet.schema.json
 *                                      AND against the agent's registry record (if present).
 *                                      Exit 0 on valid; non-zero on invalid.
 *   --new --agent <id> --objective "…" Emit a skeleton task-packet to stdout.
 *
 * No npm deps — only Node built-ins + hand-rolled JSON-Schema draft-07 subset.
 *
 * Registry-absent behaviour: if agent-registry.json does not yet exist (B1 writes it),
 * governed validation fails closed when the registry is absent. It does NOT silently skip the
 * registry check when the registry IS present.
 */
'use strict';

const fs   = require('fs');
const path = require('path');

// ─── Paths ───────────────────────────────────────────────────────────────────
const WORKSPACE_ROOT   = path.resolve(__dirname, '..');
const SCHEMA_DIR       = path.join(__dirname, 'schemas');
const PACKET_SCHEMA    = path.join(SCHEMA_DIR, 'task-packet.schema.json');
const REGISTRY_FILE    = path.join(__dirname, 'agent-registry.json');
const PROTECTED_PATHS_FILE = path.join(__dirname, 'protected-paths.json');

// ─── Minimal hand-rolled JSON-Schema draft-07 validator ──────────────────────
// Covers the subset actually used in task-packet.schema.json:
//   type, required, properties, additionalProperties, pattern, enum,
//   minItems, maxItems, uniqueItems, items, $ref, $defs, format (ignored),
//   examples (ignored).
function validateSchema(schema, data, ctx, defs) {
  ctx  = ctx  || '#';
  defs = defs || schema['$defs'] || schema['definitions'] || {};

  const errors = [];

  // Resolve $ref
  if (schema['$ref']) {
    const ref = schema['$ref'];
    if (ref.startsWith('#/$defs/')) {
      const defKey = ref.slice('#/$defs/'.length);
      if (!defs[defKey]) { errors.push(`${ctx}: unresolved $ref ${ref}`); return errors; }
      return validateSchema(defs[defKey], data, ctx, defs);
    }
    errors.push(`${ctx}: unsupported $ref ${ref}`);
    return errors;
  }

  // type check
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const actual = data === null ? 'null' : Array.isArray(data) ? 'array' : typeof data;
    // JSON-Schema: 'integer' means a number with no fractional part
    const typesForCheck = types.map(t => t === 'integer' ? 'number' : t);
    if (!typesForCheck.includes(actual)) {
      errors.push(`${ctx}: expected type ${types.join('|')} but got ${actual}`);
      return errors; // further checks meaningless if type is wrong
    }
    if (types.includes('integer') && actual === 'number' && !Number.isInteger(data)) {
      errors.push(`${ctx}: expected integer but got non-integer number ${data}`);
      return errors;
    }
  }

  // required
  if (schema.required && typeof data === 'object' && data !== null && !Array.isArray(data)) {
    for (const req of schema.required) {
      if (!(req in data)) errors.push(`${ctx}: missing required property "${req}"`);
    }
  }

  // properties
  if (schema.properties && typeof data === 'object' && data !== null && !Array.isArray(data)) {
    for (const [key, subSchema] of Object.entries(schema.properties)) {
      if (key in data) {
        const sub = validateSchema(subSchema, data[key], `${ctx}/${key}`, defs);
        errors.push(...sub);
      }
    }
  }

  // additionalProperties: false
  if (schema.additionalProperties === false && typeof data === 'object' && data !== null && !Array.isArray(data)) {
    const allowed = new Set(Object.keys(schema.properties || {}));
    for (const key of Object.keys(data)) {
      if (!allowed.has(key)) errors.push(`${ctx}: unexpected additional property "${key}"`);
    }
  }

  // pattern (strings)
  if (schema.pattern && typeof data === 'string') {
    const re = new RegExp(schema.pattern);
    if (!re.test(data)) errors.push(`${ctx}: string does not match pattern ${schema.pattern}`);
  }

  // enum
  if (schema.enum) {
    if (!schema.enum.includes(data)) {
      errors.push(`${ctx}: value must be one of ${JSON.stringify(schema.enum)}, got ${JSON.stringify(data)}`);
    }
  }

  // minItems
  if (typeof schema.minItems === 'number' && Array.isArray(data)) {
    if (data.length < schema.minItems) {
      errors.push(`${ctx}: array has ${data.length} items, minimum is ${schema.minItems}`);
    }
  }

  if (typeof schema.maxItems === 'number' && Array.isArray(data)) {
    if (data.length > schema.maxItems) {
      errors.push(`${ctx}: array has ${data.length} items, maximum is ${schema.maxItems}`);
    }
  }

  if (schema.uniqueItems === true && Array.isArray(data)) {
    const canonicalItems = data.map((item) => JSON.stringify(item));
    if (new Set(canonicalItems).size !== canonicalItems.length) {
      errors.push(`${ctx}: array items must be unique`);
    }
  }

  // items (array)
  if (schema.items && Array.isArray(data)) {
    data.forEach((item, idx) => {
      const sub = validateSchema(schema.items, item, `${ctx}[${idx}]`, defs);
      errors.push(...sub);
    });
  }

  // const
  if ('const' in schema && data !== schema.const) {
    errors.push(`${ctx}: expected const ${JSON.stringify(schema.const)}, got ${JSON.stringify(data)}`);
  }

  return errors;
}

// ─── Load a JSON file (throws with path on failure) ──────────────────────────
function loadJSON(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    throw new Error(`Cannot read/parse ${filePath}: ${e.message}`);
  }
}

// ─── Glob-match helper ───────────────────────────────────────────────────────
// Supports * (single segment) and ** (any depth). No external dep.
function globMatch(pattern, str) {
  // Normalise to forward slashes
  pattern = pattern.replace(/\\/g, '/');
  str     = str.replace(/\\/g, '/');

  // Escape regex special chars except * and /
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '§DSTAR§')
    .replace(/\*/g, '[^/]*')
    .replace(/§DSTAR§/g, '.*');

  const re = new RegExp(`^${escaped}$`);
  return re.test(str);
}

// ─── Check if a path is allowed by a set of globs ───────────────────────────
function pathAllowedByGlobs(filePath, globs) {
  return globs.some(g => globMatch(g, filePath));
}

function repositoryPathProblem(value, { exact = false } = {}) {
  if (typeof value !== 'string' || !value || value.includes('\0')) return 'must be a non-empty string';
  if (value.includes('\\')) return 'must use POSIX separators';
  if (path.posix.isAbsolute(value) || /^[A-Za-z]:/.test(value)) return 'must be repository-relative';
  const segments = value.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    return 'must not contain empty, current-directory, or parent-directory segments';
  }
  if (!exact && /[?\[\]{}]/.test(value)) return 'supports only * and ** glob operators';
  if (exact && /[*?[\]{}]/.test(value)) return 'must be an exact path, not a glob';
  return null;
}

function validateRepositoryPaths(packet) {
  const errors = [];
  for (const value of packet.filesAllowed || []) {
    const problem = repositoryPathProblem(value);
    if (problem) errors.push(`filesAllowed ${JSON.stringify(value)} ${problem}`);
  }
  const authorized = packet.authorization && Array.isArray(packet.authorization.allowsProtectedPaths)
    ? packet.authorization.allowsProtectedPaths : [];
  for (const value of authorized) {
    const problem = repositoryPathProblem(value, { exact: true });
    if (problem) errors.push(`authorization.allowsProtectedPaths ${JSON.stringify(value)} ${problem}`);
  }
  return errors;
}

function protectedOverrideAllowed(filePath, protectedPaths) {
  return Object.values((protectedPaths && protectedPaths.categories) || {}).some((category) =>
    category && category.overridable === true && Array.isArray(category.paths) &&
      category.paths.some((pattern) => globMatch(pattern, filePath)));
}

// ─── Validate a packet against the schema + registry ─────────────────────────
function validatePacket(packetPath) {
  // 1. Load schema
  const schema = loadJSON(PACKET_SCHEMA);
  const defs   = schema['$defs'] || {};

  // 2. Load packet
  let packet;
  try {
    packet = loadJSON(packetPath);
  } catch (e) {
    console.error(`ERROR: ${e.message}`);
    process.exit(2);
  }

  // 3. Schema validation
  const schemaErrors = validateSchema(schema, packet, '#', defs);
  if (schemaErrors.length) {
    console.error('SCHEMA VALIDATION FAILED:');
    schemaErrors.forEach(e => console.error(`  • ${e}`));
    process.exit(1);
  }

  console.log(`[packet-tools] Schema check: PASS  (${path.basename(packetPath)})`);

  const pathErrors = validateRepositoryPaths(packet);
  if (pathErrors.length) {
    console.error('PACKET PATH VALIDATION FAILED:');
    pathErrors.forEach((error) => console.error(`  • ${error}`));
    process.exit(1);
  }

  // Host containment is a separate executable boundary, not an ordinary
  // snapshot check.  The schema pins its one command; this semantic check
  // proves the executable itself is inside both packet write scope and the
  // explicit protected-path authorization.  The operator beta may never omit
  // this evidence after declaring it part of its completion gate.
  const hostCommands = packet.hostContainmentRequired;
  const betaRequiresHost = packet.packetId === 'PKT-20260826-ASYNC-WORKER-OPERATOR-BETA';
  if (betaRequiresHost && (!Array.isArray(hostCommands) || hostCommands.length !== 1)) {
    console.error('HOST CONTAINMENT VALIDATION FAILED: operator beta requires one pinned top-level host command');
    process.exit(1);
  }
  if (Array.isArray(hostCommands)) {
    const hostEntrypoints = hostCommands.map((command) => command.slice('node '.length));
    const authorized = packet.authorization && Array.isArray(packet.authorization.allowsProtectedPaths)
      ? packet.authorization.allowsProtectedPaths : [];
    const missingScope = hostEntrypoints.filter((entrypoint) =>
      !packet.filesAllowed.includes(entrypoint) || !authorized.includes(entrypoint));
    if (missingScope.length) {
      console.error('HOST CONTAINMENT VALIDATION FAILED: host command entrypoint lacks filesAllowed/protected-path authorization:');
      missingScope.forEach((entrypoint) => console.error(`  • ${entrypoint}`));
      process.exit(1);
    }
  }

  // 4. Registry validation
  const registryExists = fs.existsSync(REGISTRY_FILE);
  if (!registryExists) {
    console.error('REGISTRY VALIDATION FAILED: canonical agent-registry.json is missing');
    console.error('  Governed validation cannot downgrade to schema-only authorization.');
    process.exit(1);
  }

  let registry;
  try {
    registry = loadJSON(REGISTRY_FILE);
  } catch (error) {
    console.error('REGISTRY VALIDATION FAILED: canonical agent-registry.json is unreadable');
    console.error(`  ${error.message}`);
    process.exit(1);
  }
  const agents   = (registry && registry.agents) ? registry.agents : {};
  const agentId  = packet.agentId;

  // 4a. agentId must be a registry key
  if (!agents[agentId]) {
    console.error(`REGISTRY VALIDATION FAILED: agentId "${agentId}" is not a key in agent-registry.json`);
    console.error(`  Known agents: ${Object.keys(agents).join(', ') || '(none)'}`);
    process.exit(1);
  }

  const record       = agents[agentId];
  const allowedGlobs = record.allowedPathGlobs || [];
  const protectedPaths = loadJSON(PROTECTED_PATHS_FILE);

  // 4b. filesAllowed must not escape the agent's allowedPathGlobs unless packet.authorization.allowsProtectedPaths covers it
  const authPaths  = (packet.authorization && packet.authorization.allowsProtectedPaths) ? packet.authorization.allowsProtectedPaths : [];
  const violations = [];

  for (const filePath of (packet.filesAllowed || [])) {
    // Glob match against allowedPathGlobs
    if (pathAllowedByGlobs(filePath, allowedGlobs)) continue;
    // A human authorization is an override only when the exact path is also
    // covered by an overridable canonical protected-path registry entry.
    if (authPaths.includes(filePath) &&
        packet.authorization.authorizedBy !== 'none' &&
        protectedOverrideAllowed(filePath, protectedPaths)) continue;
    violations.push(filePath);
  }

  if (violations.length) {
    console.error('REGISTRY VALIDATION FAILED: filesAllowed contains paths outside agent allowedPathGlobs without canonical protected-path authorization:');
    violations.forEach(v => console.error(`  • ${v}  (not covered by agent globs and an overridable protected-paths.json entry)`));
    process.exit(1);
  }

  console.log(`[packet-tools] Registry check: PASS  (agentId="${agentId}", all filesAllowed within allowedPathGlobs)`);
  console.log('[packet-tools] Result: VALID');
  process.exit(0);
}

// ─── Generate a packet skeleton ──────────────────────────────────────────────
function newPacket(agentId, objective) {
  if (!agentId || !objective) {
    console.error('Usage: --new --agent <id> --objective "<objective>"');
    process.exit(2);
  }

  const now = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const skeleton = {
    packetId:       `PKT-${now}-001`,
    agentId:        agentId,
    objective:      objective,
    constraints:    ['Reuse > rebuild', 'Anti-theater: claim done only with evidence in the same response'],
    sourceOfTruth:  ['builder-control/CONTROL-CONTRACT.md'],
    filesAllowed:   [],
    testsRequired:  [],
    stopConditions: [
      'Fix would require touching a protected path not listed in authorization.allowsProtectedPaths',
      'Claude Code fails twice on the same issue',
      'Marc issues STOP / delegate / canon language'
    ],
    authorization: {
      authorizedBy:        'none',
      allowsProtectedPaths: [],
      allowsPublicPush:    false,
      allowsRelease:       false
    }
  };

  console.log(JSON.stringify(skeleton, null, 2));
  process.exit(0);
}

// ─── CLI dispatch ─────────────────────────────────────────────────────────────
function main(args = process.argv.slice(2)) {
  const cmd = args[0];
  if (cmd === '--validate') {
    const packetPath = args[1];
    if (!packetPath) {
      console.error('Usage: node packet-tools.cjs --validate <packet.json>');
      process.exit(2);
    }
    validatePacket(path.resolve(packetPath));
  } else if (cmd === '--new') {
    const agentIdx = args.indexOf('--agent');
    const objIdx = args.indexOf('--objective');
    const agentId = agentIdx >= 0 ? args[agentIdx + 1] : null;
    const objective = objIdx >= 0 ? args[objIdx + 1] : null;
    newPacket(agentId, objective);
  } else {
    console.error('Usage:');
    console.error('  node packet-tools.cjs --validate <packet.json>');
    console.error('  node packet-tools.cjs --new --agent <id> --objective "<objective>"');
    process.exit(2);
  }
}

if (require.main === module) main();

module.exports = Object.freeze({ globMatch, pathAllowedByGlobs, repositoryPathProblem });
