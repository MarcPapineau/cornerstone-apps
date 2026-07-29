#!/usr/bin/env node
/**
 * ledger-writer.cjs  — Builder Control System v1, Module 3
 *
 * Usage:
 *   --append <entry.json>          Validate entry against ledger-entry.schema.json,
 *                                  then append it to builder-control/ledger.json.
 *                                  NEVER mutates or truncates existing entries.
 *   --migrate-policy-ledger        Migrate the single policy/ledger.json record into
 *                                  builder-control/ledger.json as a back-dated IMPORTED
 *                                  entry. Leaves policy/ledger.json as a stub.
 *                                  Safe to re-run: idempotent (checks if already migrated).
 *
 * Invariant: the ledger file is a JSON array. Every operation that touches the file
 * reads the current array, validates no mutation occurred, then writes
 * [  ...existingEntries, newEntry  ]. It never truncates.
 *
 * No npm deps — only Node built-ins + shared hand-rolled JSON-Schema validator.
 */
'use strict';

const fs   = require('fs');
const path = require('path');

// ─── Paths ───────────────────────────────────────────────────────────────────
const LEDGER_FILE   = path.join(__dirname, 'ledger.json');
const SCHEMA_FILE   = path.join(__dirname, 'schemas', 'ledger-entry.schema.json');
const POLICY_LEDGER = path.join(__dirname, '..', 'policy', 'ledger.json');

// ─── Hand-rolled JSON-Schema draft-07 validator (same logic as packet-tools) ─
function validateSchema(schema, data, ctx, defs) {
  ctx  = ctx  || '#';
  defs = defs || schema['$defs'] || schema['definitions'] || {};

  const errors = [];

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

  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const actual = data === null ? 'null' : Array.isArray(data) ? 'array' : typeof data;
    // JSON-Schema: 'integer' means a number with no fractional part
    const typesForCheck = types.map(t => t === 'integer' ? 'number' : t);
    if (!typesForCheck.includes(actual)) {
      errors.push(`${ctx}: expected type ${types.join('|')} but got ${actual}`);
      return errors;
    }
    // If type is 'integer', also verify it's a whole number
    if (types.includes('integer') && actual === 'number' && !Number.isInteger(data)) {
      errors.push(`${ctx}: expected integer but got non-integer number ${data}`);
      return errors;
    }
  }

  if (schema.required && typeof data === 'object' && data !== null && !Array.isArray(data)) {
    for (const req of schema.required) {
      if (!(req in data)) errors.push(`${ctx}: missing required property "${req}"`);
    }
  }

  if (schema.properties && typeof data === 'object' && data !== null && !Array.isArray(data)) {
    for (const [key, subSchema] of Object.entries(schema.properties)) {
      if (key in data) {
        errors.push(...validateSchema(subSchema, data[key], `${ctx}/${key}`, defs));
      }
    }
  }

  if (schema.additionalProperties === false && typeof data === 'object' && data !== null && !Array.isArray(data)) {
    const allowed = new Set(Object.keys(schema.properties || {}));
    for (const key of Object.keys(data)) {
      if (!allowed.has(key)) errors.push(`${ctx}: unexpected additional property "${key}"`);
    }
  }

  if (schema.pattern && typeof data === 'string') {
    if (!new RegExp(schema.pattern).test(data)) {
      errors.push(`${ctx}: string does not match pattern ${schema.pattern}`);
    }
  }

  if (schema.enum && !schema.enum.includes(data)) {
    errors.push(`${ctx}: must be one of ${JSON.stringify(schema.enum)}, got ${JSON.stringify(data)}`);
  }

  if (typeof schema.minItems === 'number' && Array.isArray(data) && data.length < schema.minItems) {
    errors.push(`${ctx}: array has ${data.length} items, minimum is ${schema.minItems}`);
  }

  if (schema.items && Array.isArray(data)) {
    data.forEach((item, idx) => {
      errors.push(...validateSchema(schema.items, item, `${ctx}[${idx}]`, defs));
    });
  }

  if ('const' in schema && data !== schema.const) {
    errors.push(`${ctx}: expected const ${JSON.stringify(schema.const)}, got ${JSON.stringify(data)}`);
  }

  return errors;
}

// ─── Load JSON file ───────────────────────────────────────────────────────────
function loadJSON(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

// ─── Read the current ledger array (creates empty array if file absent) ────────
function readLedger() {
  if (!fs.existsSync(LEDGER_FILE)) return [];
  const raw = fs.readFileSync(LEDGER_FILE, 'utf8').trim();
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(`Ledger at ${LEDGER_FILE} is not a JSON array — aborting to prevent data loss`);
  }
  return parsed;
}

// ─── Write the ledger, asserting old entries are byte-identical ───────────────
function writeLedger(oldEntries, newEntry) {
  const newArray  = [...oldEntries, newEntry];

  // Safety: re-read and verify old entries are unchanged
  if (fs.existsSync(LEDGER_FILE)) {
    const onDisk = readLedger();
    if (onDisk.length < oldEntries.length) {
      throw new Error('LEDGER INTEGRITY VIOLATION: on-disk array is shorter than expected — refusing write');
    }
    // Byte-compare each old entry
    for (let i = 0; i < oldEntries.length; i++) {
      if (JSON.stringify(onDisk[i]) !== JSON.stringify(oldEntries[i])) {
        throw new Error(`LEDGER INTEGRITY VIOLATION: entry at index ${i} differs on disk vs in memory — another process may have written concurrently`);
      }
    }
  }

  fs.writeFileSync(LEDGER_FILE, JSON.stringify(newArray, null, 2) + '\n', 'utf8');
  return newArray.length;
}

// ─── Validate an entry object against the ledger-entry schema ─────────────────
function validateEntry(entry) {
  const schema = loadJSON(SCHEMA_FILE);
  const defs   = schema['$defs'] || {};
  return validateSchema(schema, entry, '#', defs);
}

// ─── --append <entry.json> ────────────────────────────────────────────────────
function appendEntry(entryPath) {
  // Load entry
  let entry;
  try {
    entry = loadJSON(path.resolve(entryPath));
  } catch (e) {
    console.error(`ERROR loading entry file: ${e.message}`);
    process.exit(2);
  }

  // Validate
  const errors = validateEntry(entry);
  if (errors.length) {
    console.error('SCHEMA VALIDATION FAILED for entry:');
    errors.forEach(e => console.error(`  • ${e}`));
    process.exit(1);
  }

  // Append
  const before = readLedger();
  const newLen = writeLedger(before, entry);

  console.log(`[ledger-writer] Appended entry "${entry.entryId}" to ${LEDGER_FILE}`);
  console.log(`[ledger-writer] Ledger length: ${before.length} → ${newLen}  (grew by 1)`);
  process.exit(0);
}

// ─── --migrate-policy-ledger ──────────────────────────────────────────────────
function migratePolicyLedger() {
  // 1. Read the policy ledger
  if (!fs.existsSync(POLICY_LEDGER)) {
    console.error(`ERROR: policy/ledger.json not found at ${POLICY_LEDGER}`);
    process.exit(2);
  }

  let source;
  try {
    source = loadJSON(POLICY_LEDGER);
  } catch (e) {
    console.error(`ERROR parsing policy/ledger.json: ${e.message}`);
    process.exit(2);
  }

  // Check if already a stub (migration already done)
  if (source && source._stub === true) {
    console.log('[ledger-writer] policy/ledger.json is already a stub — migration already complete.');
    process.exit(0);
  }

  // 2. Extract the single record
  // Shape: { "agent:main:main": { artifacts: { research_report: [ { ts, source: { via, targetAgent, targetRole } } ] } } }
  const agentKey   = 'agent:main:main';
  const agentBlock = source[agentKey];

  if (!agentBlock) {
    console.error(`ERROR: Expected key "${agentKey}" in policy/ledger.json — STOP (stopCondition: migrated record would lose data)`);
    process.exit(2);
  }

  const artifacts = agentBlock.artifacts || {};
  const reports   = artifacts.research_report || [];

  if (reports.length === 0) {
    console.error('ERROR: No research_report entries found — STOP (would lose data)');
    process.exit(2);
  }

  // We migrate ONE record as specified (the contract says "the single existing record")
  const original = reports[0];
  const via          = original.source && original.source.via         ? original.source.via         : null;
  const targetAgent  = original.source && original.source.targetAgent ? original.source.targetAgent : null;
  const targetRole   = original.source && original.source.targetRole  ? original.source.targetRole  : null;
  const origTs       = original.ts || '2026-04-16T14:02:52.750Z';

  // 3. Check if already migrated in ledger (idempotency)
  const existing = readLedger();
  const alreadyMigrated = existing.some(e => e.gate === 'legacy-import' && e.notes && e.notes.includes('agent:main:main'));
  if (alreadyMigrated) {
    console.log('[ledger-writer] Entry for agent:main:main already present in ledger — skipping duplicate migration.');
    process.exit(0);
  }

  // 4. Build the IMPORTED ledger entry
  // Preserve ALL original fields in notes so no data is lost.
  const preservedOriginal = JSON.stringify(original);

  const importedEntry = {
    entryId:       'LED-LEGACY-IMPORT-0001',
    ts:            new Date().toISOString(),               // migration timestamp (now)
    packetId:      null,                                   // no packet existed at original write time
    agentId:       targetAgent || 'daniel',               // the original target agent
    gate:          'legacy-import',
    status:        'IMPORTED',
    blockRule:     null,
    operation:     `research_report dispatch via ${via || 'sessions_spawn'} to ${targetAgent || 'daniel'} (back-dated ${origTs})`,
    changed:       [],
    commandsRun:   [],
    testsRun:      [],
    screenshots:   [],
    commitSha:     null,
    bundleHash:    null,
    evidencePaths: [],
    driftChecks:   [],
    notes: [
      `MIGRATED from policy/ledger.json on ${new Date().toISOString()}.`,
      `Original key: agent:main:main`,
      `Original ts: ${origTs}`,
      `Original via: ${via}`,
      `Original targetAgent: ${targetAgent}`,
      `Original targetRole: ${targetRole}`,
      `Full original record: ${preservedOriginal}`
    ].join(' | ')
  };

  // 5. Validate the entry before writing
  const errors = validateEntry(importedEntry);
  if (errors.length) {
    console.error('STOP: migrated entry fails schema validation — not writing (data preserved in policy/ledger.json):');
    errors.forEach(e => console.error(`  • ${e}`));
    process.exit(1);
  }

  // 6. Append to ledger
  const newLen = writeLedger(existing, importedEntry);
  console.log(`[ledger-writer] Migrated entry written to ${LEDGER_FILE}`);
  console.log(`[ledger-writer] Ledger length: ${existing.length} → ${newLen}`);

  // 7. Leave policy/ledger.json as a stub pointing to the canonical ledger
  const stub = {
    _stub:      true,
    _canonical: 'builder-control/ledger.json',
    _migrated:  new Date().toISOString(),
    _note:      'This file is a stub. The single record originally here was migrated to builder-control/ledger.json as entryId LED-LEGACY-IMPORT-0001. Do not delete this file or edit builder-control/ledger.json directly — use ledger-writer.cjs --append.'
  };
  fs.writeFileSync(POLICY_LEDGER, JSON.stringify(stub, null, 2) + '\n', 'utf8');
  console.log(`[ledger-writer] policy/ledger.json → stub written (canonical: builder-control/ledger.json)`);

  // 8. Print the migrated entry for anti-theater verification
  console.log('\n[ledger-writer] Migrated entry:');
  console.log(JSON.stringify(importedEntry, null, 2));

  process.exit(0);
}

// ─── CLI dispatch ─────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const cmd  = args[0];

if (cmd === '--append') {
  const entryPath = args[1];
  if (!entryPath) {
    console.error('Usage: node ledger-writer.cjs --append <entry.json>');
    process.exit(2);
  }
  appendEntry(entryPath);

} else if (cmd === '--migrate-policy-ledger') {
  migratePolicyLedger();

} else {
  console.error('Usage:');
  console.error('  node ledger-writer.cjs --append <entry.json>');
  console.error('  node ledger-writer.cjs --migrate-policy-ledger');
  process.exit(2);
}
