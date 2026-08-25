#!/usr/bin/env node
/**
 * review-sign.cjs — attestation for review records.
 *
 * THE HOLE THIS CLOSES
 * Before this, `builder-control/reviews/*.json` was plain JSON that the gate
 * trusted. Anyone — including the builder — could write `{"reviewer":"codex",
 * "disposition":"APPROVE"}` into that directory and the gate would count it as
 * independent review. The whole "a builder may not approve its own work" rule
 * was enforced by nothing but the builder's good manners.
 *
 * An attestation now covers the fields that make a record mean something:
 *   subjectSha256 · packetDigest · reviewer · reviewerModel · disposition ·
 *   a canonical digest of the findings
 * Change any of them and the attestation stops verifying.
 *
 * WHAT THIS PROVES — AND WHAT IT DOES NOT
 * This is an HMAC with a machine-local key. It proves a record was produced by
 * this machine's adapter and has not been edited since. It does NOT prove a
 * human approved anything, and it does NOT stop a process that can read the key
 * from minting records. A local key cannot defend against local code; only a
 * reviewer-held key or a remote attestation service could, and neither exists
 * here yet.
 *
 * So the honest claim is narrow: hand-editing a verdict, copying a record
 * between subjects, or dropping a fabricated APPROVE into reviews/ are now
 * detected. Compromise of this machine is not. That limit is stated here rather
 * than left for someone to discover, because an over-claimed control is worse
 * than a missing one — it stops people looking.
 *
 *   node builder-control/review-sign.cjs --sign <record.json>
 *   node builder-control/review-sign.cjs --verify <record.json>
 *   node builder-control/review-sign.cjs --keyinfo
 *
 * Exit: 0 ok · 2 usage · 3 verification failed
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const HERE = __dirname;
const ROOT = path.resolve(HERE, '..');
const KEY_FILE = path.join(HERE, '.attestation-key');
const PACKETS_DIR = path.join(HERE, 'packets');

const EXIT_PASS = 0;
const EXIT_USAGE = 2;
const EXIT_FAIL = 3;

const ALG = 'sha256';
const VERSION = 'aegis-attest-v1';

/**
 * The key never enters the repository. It is read from the environment first
 * (so CI can inject one), then from a gitignored file, and is generated with
 * 0600 permissions if neither exists.
 */
function loadKey({ create = true } = {}) {
  if (process.env.AEGIS_ATTESTATION_KEY) {
    const k = process.env.AEGIS_ATTESTATION_KEY;
    if (k.length < 32) throw new Error('AEGIS_ATTESTATION_KEY is shorter than 32 characters');
    return { key: k, source: 'env:AEGIS_ATTESTATION_KEY' };
  }
  if (fs.existsSync(KEY_FILE)) {
    const k = fs.readFileSync(KEY_FILE, 'utf8').trim();
    if (k.length < 32) throw new Error(`${path.relative(ROOT, KEY_FILE)} is shorter than 32 characters`);
    return { key: k, source: path.relative(ROOT, KEY_FILE) };
  }
  if (!create) throw new Error('no attestation key available');
  const k = crypto.randomBytes(48).toString('base64url');
  fs.writeFileSync(KEY_FILE, k + '\n', { mode: 0o600 });
  try { fs.chmodSync(KEY_FILE, 0o600); } catch { /* best effort */ }
  return { key: k, source: path.relative(ROOT, KEY_FILE), generated: true };
}

/** Stable digest of an arbitrary value — key order must not change the result. */
function canonical(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v);
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
}
const digest = (s) => crypto.createHash(ALG).update(s).digest('hex');

/**
 * Digest of the packet's AUTHORIZING content. Finding #3: a review bound only
 * to a packetId is not bound to what that packet permitted — the packet can be
 * edited afterwards (and packets are excluded from the subject hash, so such an
 * edit moves nothing). Hashing the authorization-bearing fields means widening
 * filesAllowed after a review invalidates that review.
 */
function packetDigest(packetPath) {
  if (!packetPath || !fs.existsSync(packetPath)) return null;
  const p = JSON.parse(fs.readFileSync(packetPath, 'utf8'));
  // GROK G9 FINDING #3: this covered six fields and omitted testsRequired,
  // constraints and stopConditions — all REQUIRED by the packet schema. Emptying
  // testsRequired produced an identical digest, so a review stayed "valid" after
  // the checks it was supposed to depend on were deleted. Packets are excluded
  // from the subject hash, so such an edit moves nothing else the gate binds to.
  //
  // Everything the packet uses to authorize or constrain the work is hashed now.
  return digest(canonical({
    packetId: p.packetId,
    agentId: p.agentId,
    objective: p.objective,
    constraints: p.constraints,
    filesAllowed: p.filesAllowed,
    testsRequired: p.testsRequired,
    stopConditions: p.stopConditions,
    authorization: p.authorization,
    sourceOfTruth: p.sourceOfTruth,
  }));
}

function resolvePacketForRecord(rec) {
  if (!fs.existsSync(PACKETS_DIR)) return null;
  for (const f of fs.readdirSync(PACKETS_DIR)) {
    if (!f.endsWith('.json')) continue;
    const full = path.join(PACKETS_DIR, f);
    try {
      if (JSON.parse(fs.readFileSync(full, 'utf8')).packetId === rec.packetId) return full;
    } catch { /* skip unreadable */ }
  }
  return null;
}

/** The exact bytes an attestation covers. */
function attestationPayload(rec, pktDigest) {
  return canonical({
    v: VERSION,
    // PROVEN DEFECT (2026-08-25): these four were outside the attestation and
    // could be rewritten on a signed record without detection. Two of them are
    // load-bearing: reviewId is how supersession names its target, so relabelling
    // one record could retire a different reviewer's rejection; group.groupId is
    // how coverage is computed, so relabelling G1 to G3 could fake exact coverage
    // over a subject that was never fully reviewed.
    reviewId: rec.reviewId,
    // GROK G11 FINDING #1: reviewId was covered because supersession names its
    // target by it — but the POINTER was not. A hand-edit could add or retarget
    // `supersedes` on a validly-signed record and retire a different reviewer's
    // rejection. Covering the target without covering the pointer secures the
    // noun and leaves the verb open.
    supersedes: rec.supersedes || null,
    // GROK G11 FINDING #5: the schema and chunker both claimed that embedding
    // each group's attestation digest makes an aggregate stop matching if a
    // group is edited later. That claim was false: the aggregate object sat
    // OUTSIDE the signed payload, so every embedded digest could be rewritten
    // to match whatever the groups had become. The claim is now true.
    aggregate: rec.aggregate ? {
      groupCount: rec.aggregate.groupCount,
      plannedGroupCount: rec.aggregate.plannedGroupCount,
      coverage: rec.aggregate.coverage,
      groups: (rec.aggregate.groups || []).map((g) => ({
        groupId: g.groupId, groupDigest: g.groupDigest,
        pathCount: g.pathCount, disposition: g.disposition,
        reviewId: g.reviewId, attestationDigest: g.attestationDigest,
      })),
    } : null,
    ts: rec.ts,
    unavailableReason: rec.unavailableReason || null,
    group: rec.group ? { groupId: rec.group.groupId, groupDigest: rec.group.groupDigest || null } : null,
    subjectSha256: rec.reviewOf && rec.reviewOf.diffSha256,
    changedPaths: (rec.reviewOf && rec.reviewOf.changedPaths) || [],
    packetId: rec.packetId,
    packetDigest: pktDigest,
    reviewer: rec.reviewer,
    reviewerModel: rec.reviewerModel,
    disposition: rec.disposition,
    // Findings are covered so severities cannot be downgraded after the fact.
    findings: (rec.findings || []).map((f) => ({
      severity: f.severity, file: f.file, problem: f.problem,
      evidence: f.evidence, status: f.status,
    })),
  });
}

function sign(rec, opts = {}) {
  const { key, source } = loadKey();
  const pkt = opts.packetPath || resolvePacketForRecord(rec);
  const pd = packetDigest(pkt);
  const payload = attestationPayload(rec, pd);
  const mac = crypto.createHmac(ALG, key).update(payload).digest('hex');
  return {
    ...rec,
    attestation: {
      v: VERSION, alg: `HMAC-${ALG.toUpperCase()}`,
      packetDigest: pd,
      payloadDigest: digest(payload),
      mac,
      signedAt: new Date().toISOString(),
      keySource: source,
      scope: 'Proves this record was produced by this machine\'s adapter and is unmodified. Does NOT prove human approval and does not defend against a process that can read the key.',
    },
  };
}

function verify(rec, opts = {}) {
  if (!rec || !rec.attestation) {
    return { ok: false, code: 'ATTESTATION-MISSING', reason: 'the record carries no attestation. An unsigned record is not review evidence — anyone can write JSON into reviews/.' };
  }
  const a = rec.attestation;
  if (a.v !== VERSION) return { ok: false, code: 'ATTESTATION-VERSION', reason: `unknown attestation version ${a.v}` };

  let key;
  try { key = loadKey({ create: false }).key; }
  catch (e) { return { ok: false, code: 'ATTESTATION-NO-KEY', reason: `cannot verify: ${e.message}. Refusing to accept an unverifiable record.` }; }

  const pkt = opts.packetPath || resolvePacketForRecord(rec);
  const pd = packetDigest(pkt);

  // Finding #3: if the packet's authorizing content changed since signing, the
  // review no longer describes the permissions it was granted under.
  // GROK G9 FINDING #3b: `a.packetDigest && pd && …` skipped the comparison
  // whenever the packet was gone, so DELETING the authorizing packet verified
  // exactly like leaving it untouched. Deletion is the largest possible change
  // to an authorization and must never be the quietest.
  if (a.packetDigest && !pd) {
    return {
      ok: false, code: 'ATTESTATION-PACKET-MISSING',
      reason: 'this record was signed against a task packet that can no longer be read. A review cannot be verified against an authorization that no longer exists.',
    };
  }
  if (a.packetDigest && pd && a.packetDigest !== pd) {
    return {
      ok: false, code: 'ATTESTATION-PACKET-CHANGED',
      reason: 'the task packet\'s authorization content changed after this review was signed. The review no longer describes what the packet permits.',
    };
  }

  const payload = attestationPayload(rec, a.packetDigest);
  const expect = crypto.createHmac(ALG, key).update(payload).digest('hex');
  const got = String(a.mac || '');
  const eq = got.length === expect.length &&
    crypto.timingSafeEqual(Buffer.from(got, 'hex'), Buffer.from(expect, 'hex'));
  if (!eq) {
    return {
      ok: false, code: 'ATTESTATION-INVALID',
      reason: 'the attestation does not match the record contents. A covered field (subject, packet, reviewer, model, disposition, or findings) was changed after signing.',
    };
  }
  return { ok: true, packetDigest: pd };
}

// ── CLI ─────────────────────────────────────────────────────────────────────
if (require.main === module) {
  const argv = process.argv.slice(2);
  const file = argv[1];
  let code = EXIT_PASS;
  try {
    if (argv[0] === '--keyinfo') {
      const k = loadKey({ create: false });
      console.log(`attestation key source: ${k.source}`);
      console.log('the key itself is never printed and is never committed');
    } else if (argv[0] === '--sign' && file) {
      const rec = JSON.parse(fs.readFileSync(file, 'utf8'));
      fs.writeFileSync(file, JSON.stringify(sign(rec), null, 2) + '\n');
      console.log(`signed ${path.relative(ROOT, file)}`);
    } else if (argv[0] === '--verify' && file) {
      const r = verify(JSON.parse(fs.readFileSync(file, 'utf8')));
      console.log(r.ok ? `VERIFIED  ${path.relative(ROOT, file)}` : `REFUSED   ${path.relative(ROOT, file)}\n  ${r.code}: ${r.reason}`);
      code = r.ok ? EXIT_PASS : EXIT_FAIL;
    } else {
      process.stderr.write('usage: review-sign.cjs --sign|--verify <record.json> | --keyinfo\n');
      code = EXIT_USAGE;
    }
  } catch (e) {
    process.stderr.write(`\n[review-sign] ${e.message}\n`);
    code = EXIT_FAIL;
  }
  process.exit(code);
}

module.exports = { sign, verify, packetDigest, attestationPayload, canonical, loadKey, resolvePacketForRecord, VERSION };
