#!/usr/bin/env node
/**
 * knowledge-mirror.cjs — the human knowledge layer, with no authority.
 *
 * WHAT THIS IS
 * Notion (or any comparable store) holds the Product Owner's readable memory:
 * vision, requirements, decisions, known issues, release history. This module
 * models that mirror's STATE and its DISAGREEMENTS with AEGIS.
 *
 * WHAT THIS IS NOT
 * A source of engineering truth. Three mechanical guarantees:
 *
 *   1. SELF-CERTIFICATION IS REFUSED. A knowledge record that asserts tests
 *      passed, a feature is verified, a checkpoint exists, or a gate was
 *      satisfied is REFUSED at load — the same treatment a CONTROL-plane
 *      connector gets. The moment an external document can say "verified", it
 *      is the brain, and it will be wrong exactly when it matters most.
 *
 *   2. SYNC STATE IS SEPARATE FROM ENGINEERING STATE. "Engineering: VERIFIED,
 *      Notion: SYNC FAILED" is a valid pair. A failed connector never
 *      downgrades verified work, and a write that did not happen is never
 *      rendered SYNCED.
 *
 *   3. CONFLICTS ARE NOT RESOLVED. When the mirror and AEGIS disagree, both
 *      values are shown and a Product Owner decision is required. Silently
 *      preferring either side destroys the only signal that something is wrong.
 *
 * NO NETWORK. This module performs no external calls. It reads a local mirror
 * file and reports DISCONNECTED when there is nothing to read, which is the
 * honest state of a connector that has never been authorized.
 *
 *   node builder-control/knowledge-mirror.cjs [--json] [--mirror <file>]
 *
 * Exit: 0 projected · 2 usage · 3 refused (self-certification attempt)
 */
'use strict';

const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const ROOT = path.resolve(HERE, '..');
const MIRROR = path.join(HERE, 'knowledge-mirror.json');

const EXIT_PASS = 0;
const EXIT_USAGE = 2;
const EXIT_REFUSED = 3;

// The vocabulary. PENDING is not optimism — it means dispatched and
// unconfirmed, which is different from succeeded.
const SYNC_STATES = ['SYNCED', 'PENDING', 'STALE', 'FAILED', 'CONFLICT', 'DISCONNECTED'];

// Claims a knowledge record may never make. Each of these is a control-plane
// verdict; a document asserting one is claiming authority it does not have.
const FORBIDDEN_CLAIMS = [
  'testsPassed', 'verified', 'checkpointCreated', 'gateSatisfied',
  'reviewBypassed', 'watchdogOverridden', 'policyAltered', 'releaseApproved',
];

class KnowledgeRefusal extends Error {}

function readMirror(file) {
  const p = file ? path.resolve(file) : MIRROR;
  if (!fs.existsSync(p)) {
    return {
      state: 'DISCONNECTED',
      reason: `no knowledge mirror at ${path.relative(ROOT, p)}. The Notion connector has never been authorized, so there is nothing to mirror.`,
      records: [], source: path.relative(ROOT, p),
    };
  }
  let raw;
  try { raw = JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) {
    return { state: 'FAILED', reason: `knowledge mirror unreadable: ${e.message}`, records: [], source: path.relative(ROOT, p) };
  }
  return { state: 'OK', raw, records: raw.records || [], source: path.relative(ROOT, p) };
}

// Refuse, do not sanitize. Stripping the offending field would let the record
// through in a weakened form and teach whoever wrote it that the claim was
// merely ignored rather than prohibited.
function assertNoSelfCertification(records) {
  for (const r of records) {
    for (const claim of FORBIDDEN_CLAIMS) {
      if (r[claim] !== undefined) {
        throw new KnowledgeRefusal(
          `knowledge record "${r.recordId || '(unnamed)'}" asserts "${claim}". ` +
          'The knowledge mirror organizes human memory; it may not certify engineering state. ' +
          'Remove the claim and let AEGIS evidence decide.'
        );
      }
    }
    if (typeof r.aegisClaim === 'string' && /^(VERIFIED|PASS|APPROVED)$/i.test(r.aegisClaim)) {
      throw new KnowledgeRefusal(
        `knowledge record "${r.recordId || '(unnamed)'}" sets aegisClaim="${r.aegisClaim}". ` +
        'A knowledge record may state what the HUMAN believes (notionStatus), never what AEGIS concluded.'
      );
    }
  }
}

function ageMinutes(iso, now) {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : Math.floor((now - t) / 60000);
}

/**
 * Compare what the human store believes against what AEGIS actually verified.
 * `aegisVerified` is supplied by the caller from real gate output — this module
 * never infers it.
 */
function reconcile(records, aegisVerifiedById, now, staleAfterMin = 1440) {
  const rows = [];
  for (const r of records) {
    const notion = r.notionStatus || 'UNKNOWN';
    const aegis = aegisVerifiedById && Object.prototype.hasOwnProperty.call(aegisVerifiedById, r.recordId)
      ? aegisVerifiedById[r.recordId]
      : 'NOT_VERIFIED';

    let sync = SYNC_STATES.includes(r.syncState) ? r.syncState : 'DISCONNECTED';

    // A write that was never confirmed is not a write.
    if (sync === 'SYNCED' && !r.lastSyncedAt) {
      sync = 'PENDING';
    } else if (sync === 'SYNCED' && r.lastSyncedAt) {
      const age = ageMinutes(r.lastSyncedAt, now);
      if (age === null) sync = 'PENDING';
      else if (age > staleAfterMin) sync = 'STALE';
    }

    // The disagreement that matters: the human store says done, AEGIS has no
    // evidence. This is not resolved here and must not be.
    const claimsDone = /^(DONE|COMPLETE|SHIPPED|VERIFIED)$/i.test(notion);
    const conflict = claimsDone && aegis !== 'VERIFIED';
    if (conflict) sync = 'CONFLICT';

    rows.push({
      recordId: r.recordId,
      title: r.title || r.recordId,
      notionStatus: notion,
      aegisStatus: aegis,
      syncState: sync,
      lastSyncedAt: r.lastSyncedAt || null,
      ageMinutes: r.lastSyncedAt ? ageMinutes(r.lastSyncedAt, now) : null,
      conflict: conflict
        ? {
            kind: 'SOURCE-OF-TRUTH CONFLICT',
            notion, aegis,
            requiredAction: 'RECONCILE — Product Owner decision required. This is not resolved automatically in either direction.',
          }
        : null,
      // Human proposals are inert until they enter the workflow.
      proposal: r.proposedChange
        ? { state: 'PROPOSED', detail: r.proposedChange,
            note: 'A Product Owner change becomes a PROPOSED objective and enters the normal loop. It never modifies code directly and never skips a stage.' }
        : null,
    });
  }
  return rows;
}

function project(opts = {}) {
  const now = typeof opts.now === 'number' ? opts.now : Date.now();
  const m = readMirror(opts.mirror);
  if (m.state === 'DISCONNECTED' || m.state === 'FAILED') {
    return {
      state: m.state, reason: m.reason, source: m.source,
      records: [], conflicts: 0,
      authorityNote: 'The knowledge mirror holds human memory and never engineering authority.',
    };
  }
  assertNoSelfCertification(m.records);
  const rows = reconcile(m.records, opts.aegisVerifiedById || {}, now, m.raw.staleAfterMinutes);
  return {
    state: 'OK',
    source: m.source,
    records: rows,
    conflicts: rows.filter((r) => r.conflict).length,
    syncStates: SYNC_STATES,
    authorityNote: 'The knowledge mirror holds human memory and never engineering authority.',
  };
}

// ── CLI ─────────────────────────────────────────────────────────────────────
if (require.main === module) {
  const argv = process.argv.slice(2);
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--mirror') opts.mirror = argv[++i];
    else if (argv[i] === '--json') opts.json = true;
  }
  let code = EXIT_PASS;
  try {
    const out = project(opts);
    if (opts.json) console.log(JSON.stringify(out, null, 2));
    else {
      console.log('AEGIS — KNOWLEDGE MIRROR');
      console.log('='.repeat(56));
      console.log(`state  : ${out.state}`);
      if (out.reason) console.log(`reason : ${out.reason}`);
      console.log(`source : ${out.source}`);
      if (out.records.length) {
        console.log('');
        for (const r of out.records) {
          console.log(`  ${r.syncState.padEnd(12)} ${r.title}`);
          console.log(`               notion=${r.notionStatus}  aegis=${r.aegisStatus}`);
          if (r.conflict) {
            console.log(`               ${r.conflict.kind}`);
            console.log(`               ${r.conflict.requiredAction}`);
          }
        }
        console.log('');
        console.log(`conflicts: ${out.conflicts}`);
      }
      console.log('');
      console.log(out.authorityNote);
    }
  } catch (e) {
    if (e instanceof KnowledgeRefusal) {
      process.stderr.write(`\nAEGIS-KNOWLEDGE-SELF-CERTIFICATION\n  ${e.message}\n\nNothing was projected. Refused rather than sanitized.\n`);
      code = EXIT_REFUSED;
    } else throw e;
  }
  process.exit(code);
}

module.exports = { project, reconcile, assertNoSelfCertification, readMirror, SYNC_STATES, FORBIDDEN_CLAIMS, KnowledgeRefusal };
