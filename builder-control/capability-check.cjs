#!/usr/bin/env node
'use strict';

/**
 * capability-check.cjs
 * ─────────────────────────────────────────────────────────────────────────────
 * Builder Control System — the routing check.
 *
 * agent-registry.json  says WHO may act.
 * protected-paths.json says WHERE.
 * doctrine-rules.json  says WHAT may be written.
 * capability-canon.json says WITH WHAT — and this file enforces it.
 *
 * The check is deliberately at the PACKET, not in file content. Regex-scanning a
 * diff for "did this agent hand-roll a video encoder" produces false positives,
 * and a routing gate nobody trusts is a routing gate everybody bypasses. The
 * packet is where the decision is actually made, so that is where it is checked.
 *
 * Usage:
 *   node builder-control/capability-check.cjs --packet builder-control/packets/B1.json
 *   node builder-control/capability-check.cjs --coverage            # canon + gaps
 *   node builder-control/capability-check.cjs --coverage --json     # for AEGIS
 *
 * Exit: 0 = pass · 1 = routing violation · 2 = usage/registry error
 * ─────────────────────────────────────────────────────────────────────────────
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const CANON_PATH = path.join(__dirname, 'capability-canon.json');

const args = process.argv.slice(2);
const asJson = args.includes('--json');

function die(msg, code = 2) {
  console.error(`capability-check: ${msg}`);
  process.exit(code);
}

let canon;
try {
  canon = JSON.parse(fs.readFileSync(CANON_PATH, 'utf8'));
} catch (e) {
  die(`cannot read capability-canon.json — ${e.message}`);
}

const byId = new Map(canon.capabilities.map((c) => [c.id, c]));
const DECISIONS = new Set(canon.routingLaw.order); // REUSE | ROUTE | BUILD

// ── --coverage ────────────────────────────────────────────────────────────────
// The canon as a surface. A capability with no default is a scouting target;
// printing it is the point — an unsurfaced gap is the one that gets hand-rolled.

function coverage() {
  const rows = canon.capabilities.map((c) => ({
    id: c.id,
    capability: c.capability,
    tool: c.default,
    status: c.status,
    verdict: c.verdict,
    proven: c.evidence && !/^unproven/i.test(c.evidence),
  }));

  const gaps = rows.filter((r) => r.status === 'gap');
  const candidates = rows.filter((r) => r.status === 'candidate');
  const summary = {
    registryVersion: canon.registryVersion,
    total: rows.length,
    canon: rows.filter((r) => r.status === 'canon').length,
    candidate: candidates.length,
    gap: gaps.length,
    unproven: rows.filter((r) => !r.proven).length,
  };

  if (asJson) {
    console.log(JSON.stringify({ summary, rows }, null, 2));
    return 0;
  }

  console.log(`\nCAPABILITY COVERAGE — ${canon.registryVersion}`);
  console.log(`${summary.canon} canon · ${summary.candidate} candidate · ${summary.gap} GAP · ${summary.unproven} unproven\n`);
  for (const r of rows) {
    const mark = r.status === 'canon' ? '✓' : r.status === 'candidate' ? '~' : '✗';
    const tool = r.tool || 'NO TOOL CHOSEN';
    const flag = r.proven ? '' : '  [unproven]';
    console.log(`  ${mark} ${r.id.padEnd(26)} ${tool}${flag}`);
  }
  if (gaps.length) {
    console.log(`\n  GAPS — nothing canonical does these yet. Scout them; do not hand-roll them:`);
    for (const g of gaps) console.log(`    · ${g.id} — ${g.capability}`);
  }
  console.log('');
  return 0;
}

// ── --packet ──────────────────────────────────────────────────────────────────
// A packet declares its routing. Each entry must name a real capability, a real
// decision, and — for BUILD — the escape hatch it is invoking. "We decided to
// build it" is not a routing decision; naming which escape hatch applies is.

function checkPacket(packetPath) {
  let packet;
  try {
    packet = JSON.parse(fs.readFileSync(path.resolve(ROOT, packetPath), 'utf8'));
  } catch (e) {
    die(`cannot read packet ${packetPath} — ${e.message}`);
  }

  const violations = [];
  const routing = packet.routing;

  if (routing === undefined) {
    // Not yet declared. Report, do not block: existing packets predate this file
    // and retro-failing them would teach the fleet that the gate is noise.
    const out = {
      packetId: packet.packetId || '(unnamed)',
      verdict: 'UNDECLARED',
      note: 'Packet declares no routing[]. Add one entry per capability this work touches. Not a block — packets written before capability-canon.json v1.0 are grandfathered.',
    };
    if (asJson) console.log(JSON.stringify(out, null, 2));
    else console.log(`capability-check: ${out.packetId} — UNDECLARED (no routing[]; grandfathered, not blocked)`);
    return 0;
  }

  if (!Array.isArray(routing)) {
    violations.push({ rule: 'CAP-MALFORMED', detail: 'routing must be an array' });
  } else {
    routing.forEach((r, i) => {
      const where = `routing[${i}]`;
      const cap = byId.get(r.capabilityId);
      if (!cap) {
        violations.push({
          rule: 'CAP-UNKNOWN-CAPABILITY',
          detail: `${where}: "${r.capabilityId}" is not in capability-canon.json. Add the capability to the canon first — an undeclared capability is how a parallel tool stack starts.`,
        });
        return;
      }
      if (!DECISIONS.has(r.decision)) {
        violations.push({
          rule: 'CAP-BAD-DECISION',
          detail: `${where} (${cap.id}): decision must be one of ${[...DECISIONS].join(' | ')}, got "${r.decision}".`,
        });
        return;
      }
      if (r.decision === 'ROUTE') {
        if (!r.tool) {
          violations.push({ rule: 'CAP-ROUTE-NO-TOOL', detail: `${where} (${cap.id}): ROUTE must name the tool.` });
        } else if (cap.default && r.tool !== cap.default && r.tool !== cap.fallback && !r.reason) {
          violations.push({
            rule: 'CAP-OFF-CANON-TOOL',
            detail: `${where} (${cap.id}): routed to "${r.tool}" but the canon default is "${cap.default}". Off-canon routing is allowed — it just has to say why. Add reason.`,
          });
        }
      }
      if (r.decision === 'BUILD') {
        if (!r.reason) {
          violations.push({
            rule: 'CAP-BUILD-NO-REASON',
            detail: `${where} (${cap.id}): BUILD requires a reason naming the escape hatch.\n      neverBuild:  ${cap.neverBuild}\n      escapeHatch: ${cap.escapeHatch}`,
          });
        } else if (/^none\b/i.test(String(cap.escapeHatch).trim())) {
          violations.push({
            rule: 'CAP-NO-ESCAPE-HATCH',
            detail: `${where} (${cap.id}): this capability has NO escape hatch — it cannot be built here.\n      neverBuild: ${cap.neverBuild}\n      Route to "${cap.default || 'a scouted tool'}" or stop and scout one.`,
          });
        }
      }
      if (r.decision === 'ROUTE' && cap.status === 'gap' && !r.tool) {
        violations.push({
          rule: 'CAP-GAP',
          detail: `${where} (${cap.id}): this capability is a GAP — no canonical tool. Scout one and promote it into the canon before the work, or stop.`,
        });
      }
    });
  }

  const out = {
    packetId: packet.packetId || '(unnamed)',
    verdict: violations.length ? 'BLOCK' : 'PASS',
    routingDeclared: Array.isArray(routing) ? routing.length : 0,
    violations,
  };

  if (asJson) {
    console.log(JSON.stringify(out, null, 2));
  } else if (violations.length) {
    console.error(`\ncapability-check: BLOCK — ${out.packetId}\n`);
    for (const v of violations) console.error(`  [${v.rule}] ${v.detail}\n`);
    console.error(`  Canon: builder-control/capability-canon.json`);
    console.error(`  Law:   ${canon.routingLaw.rule}\n`);
  } else {
    console.log(`capability-check: PASS — ${out.packetId} (${out.routingDeclared} routing decision(s) declared)`);
  }
  return violations.length ? 1 : 0;
}

// ── dispatch ──────────────────────────────────────────────────────────────────

if (args.includes('--coverage')) process.exit(coverage());

const pIdx = args.indexOf('--packet');
if (pIdx !== -1 && args[pIdx + 1]) process.exit(checkPacket(args[pIdx + 1]));

die('usage: capability-check.cjs --packet <path> | --coverage [--json]');
