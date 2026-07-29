#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

const args = process.argv.slice(2);
const strict = args.includes('--strict');
const requireKriteApproved = args.includes('--require-krite-approved') || args.includes('--release');
const help = args.includes('--help') || args.includes('-h');
const daysArgIndex = args.indexOf('--days');
const days = daysArgIndex >= 0 ? Number(args[daysArgIndex + 1]) : 21;
const targetFiles = [];

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--file') {
    targetFiles.push(args[i + 1]);
    i += 1;
  } else if (args[i].startsWith('--file=')) {
    targetFiles.push(args[i].slice('--file='.length));
  }
}

function usage() {
  return [
    'Usage:',
    '  node scripts/audit-protocol-content-contract.mjs [--days N] [--strict]',
    '  node scripts/audit-protocol-content-contract.mjs --file path/to/guide.html [--file another.html] [--strict]',
    '  node scripts/audit-protocol-content-contract.mjs --file path/to/guide.html --strict --require-krite-approved',
    '',
    'Default mode scans recent protocol guides and exits 0.',
    '--strict exits 1 when any scanned guide is missing required buckets.',
    '--file ignores the --days window and audits only the provided guide file(s).',
    '--require-krite-approved (alias --release) also fails unless KRITE and user approval markers are present.',
  ].join('\n');
}

if (help) {
  console.log(usage());
  process.exit(0);
}

if (targetFiles.some((file) => !file) || (!targetFiles.length && (!Number.isFinite(days) || days <= 0))) {
  console.error(usage());
  process.exit(2);
}

const workspaceRoot = process.cwd();
const protocolRoot = join(workspaceRoot, '01-CORNERSTONE-RESEARCH-GROUP');
const sinceMs = Date.now() - days * 24 * 60 * 60 * 1000;

const ignoredPath = /(^|\/)(archive|backups?|_backups|node_modules)(\/|$)/i;
const ignoredFile = /(cheat|invoice|naturopath|pre-protocol|order|letter|receipt)/i;

const buckets = [
  {
    key: 'researchPositioning',
    label: 'research-only positioning',
    patterns: [
      /research (education|oriented|aggregator|positioning|material)/i,
      /not (a )?(diagnosis|prescription|medical advice|medical opinion)/i,
      /not original .* data/i,
      /doing your own research/i,
    ],
  },
  {
    key: 'plainObjective',
    label: 'plain objective',
    patterns: [
      /before you begin/i,
      /goal in plain language/i,
      /the goal/i,
      /why this protocol/i,
      /stack at a glance/i,
    ],
  },
  {
    key: 'latestLanguage',
    label: 'latest language',
    patterns: [
      /how (confidence|evidence) is labeled/i,
      /what the studies show/i,
      /what the app carries/i,
      /worth knowing/i,
      /research positioning/i,
      /clinical-outcome-inspired/i,
    ],
  },
  {
    key: 'evidenceLabels',
    label: 'evidence labels',
    patterns: [
      /confidence (is )?labeled/i,
      /evidence (is )?labeled/i,
      /human evidence/i,
      /animal evidence/i,
      /mechanism/i,
      /hypothesis/i,
      /what the research (shows|does not show)/i,
    ],
  },
  {
    key: 'discoveryLineage',
    label: 'discovery lineage',
    patterns: [
      /why .* (exists|was studied|was created|was developed)/i,
      /discovery lineage/i,
      /discovered/i,
      /parent molecule/i,
      /pathway/i,
      /biological problem/i,
    ],
  },
  {
    key: 'evidenceBoundary',
    label: 'evidence boundary',
    patterns: [
      /does not (show|prove|support)/i,
      /not yet (tested|shown|studied)/i,
      /borrowed from/i,
      /analog/i,
      /gene therap/i,
      /animal-stage/i,
      /mechanism does not equal/i,
      /boundary/i,
    ],
  },
  {
    key: 'dosingMath',
    label: 'dosing math',
    patterns: [
      /dose/i,
      /schedule/i,
      /reconstitution/i,
      /iu\b/i,
      /click/i,
      /mg\b/i,
      /ml\b/i,
      /weekly grid/i,
      /administration/i,
    ],
  },
  {
    key: 'expectManage',
    label: 'expect/manage',
    patterns: [
      /what to expect/i,
      /manage/i,
      /management levers/i,
      /common .* temporary/i,
      /tolerability/i,
      /side effects?/i,
    ],
  },
  {
    key: 'supportiveLayer',
    label: 'supportive layer',
    patterns: [
      /supportive (lifestyle|layer|foundation|recovery|care)/i,
      /sleep hygiene/i,
      /hydration/i,
      /nutrition/i,
      /protein/i,
      /site rotation/i,
      /getting the most from/i,
    ],
  },
  {
    key: 'safetyStops',
    label: 'safety/stops',
    patterns: [
      /safety, flags/i,
      /hard stops?/i,
      /caution/i,
      /contraindications?/i,
      /discuss first/i,
      /stop-trigger/i,
      /start gate/i,
    ],
  },
  {
    key: 'monitoring',
    label: 'monitoring',
    patterns: [
      /monitoring/i,
      /lab monitoring/i,
      /bloodwork/i,
      /baseline panel/i,
      /re-evaluation/i,
      /checkpoints?/i,
      /watch/i,
      /log\b/i,
    ],
  },
  {
    key: 'communityPractice',
    label: 'community/practice',
    patterns: [
      /community/i,
      /practitioner/i,
      /practice/i,
      /clinics?/i,
      /what .* are doing/i,
    ],
  },
  {
    key: 'sourcesReferences',
    label: 'sources/references',
    patterns: [
      /references/i,
      /sources? (&|and) research/i,
      /research citations/i,
      /primary research/i,
      /citations/i,
    ],
  },
  {
    key: 'supplyInvoiceSeparation',
    label: 'supply/invoice separation',
    patterns: [
      /supply planning/i,
      /supply plan/i,
      /invoice/i,
      /product/i,
      /sku/i,
      /billing/i,
      /separate document/i,
    ],
  },
  {
    key: 'kriteStatus',
    label: 'KRITE status',
    patterns: [
      /KRITE STATUS/i,
      /KRITE REQUIRED/i,
      /CURRENT STATE/i,
      /USER APPROVAL STATUS/i,
      /NEXT CORRECT ACTION/i,
    ],
  },
];

// ── Layer 1 — doctrine that is checkable, not just written down ──────────────
//
// The buckets above answer "is the required content PRESENT?". These answer the
// opposite question: "is forbidden content present?" — a rule a bucket can never
// express, because a bucket passes as soon as it finds one match and stops
// looking.
//
// Every entry cites the document that makes it a rule. An error message that
// says only "naming violation" sends someone hunting for the authority; one that
// names the file and quotes the rule can be acted on without asking anybody.
const violations = [
  {
    key: 'namingCanon',
    label: 'naming canon',
    source: 'memory/rule_naturopath_dr_vincent_lun.md (HARD RULE, locked 2026-05-26)',
    rule: 'The partnering naturopath is "Dr. Vincent Lun". The casual form "Vinny" is verbal shorthand and must never appear on a document that leaves the building.',
    // The canon states the check literally: "grep the source HTML for
    // `Vinny|vinny` — must return zero hits."
    pattern: /\bvinny\b/gi,
  },
  {
    key: 'internalJargon',
    label: 'internal jargon in customer-facing text',
    source: 'CLAUDE.md — "Do not use internal jargon in customer-facing text"',
    rule: 'These are build-system words. A client reading them learns how the document was manufactured instead of what to do: canon, provenance, evidence-tier, reverse-engineering, agent workflow, source-of-truth, usableClaim, doesNotShow.',
    pattern: /\b(canonical|canon|provenance|evidence[-\s]tiers?|reverse[-\s]engineer(ing|ed)?|agent workflows?|source[-\s]of[-\s]truth|usableClaim|doesNotShow)\b/gi,
  },
  {
    key: 'regulatoryAuthorityFraming',
    label: 'North American regulator used as value authority',
    source: 'CLAUDE.md — "Keep North American government/regulatory agencies out of customer-facing peptide-value authority framing"',
    rule: 'Naming a regulator as the thing that makes a peptide worth taking borrows an authority these compounds do not have. Stating a boundary ("not approved by...") is required and stays allowed; borrowing endorsement is not.',
    // Deliberately narrow. A blunt ban on the agency names would fire on the
    // evidence-boundary language the contract REQUIRES ("not approved by the
    // FDA"), and a check that cries wolf on correct writing gets switched off.
    // So: agency within ~60 chars of an endorsement verb, minus negated forms.
    pattern: /\b(FDA|Health Canada|USDA|NIH|CDC|Food and Drug Administration)\b[^.]{0,60}?\b(approved|endorsed|backed|certified|recommends?|recommended|sanctioned)\b|\b(approved|endorsed|backed|certified|sanctioned)\b[^.]{0,60}?\b(FDA|Health Canada|USDA|NIH|CDC|Food and Drug Administration)\b/gi,
    // Boundary statements are the correct use and must not be flagged.
    exempt: /\b(not|never|no|isn't|is not|aren't|are not|lacks?|without|hasn't|has not|none of)\b[^.]{0,40}?\b(FDA|Health Canada|USDA|NIH|CDC|approved|endorsed|backed|certified|sanctioned)\b/i,
  },
];

function findViolations(text) {
  const found = [];
  for (const v of violations) {
    const hits = [...text.matchAll(v.pattern)];
    for (const hit of hits) {
      const start = Math.max(0, hit.index - 45);
      const excerpt = text.slice(start, hit.index + hit[0].length + 45).trim();
      if (v.exempt && v.exempt.test(excerpt)) continue;
      found.push({ key: v.key, label: v.label, source: v.source, rule: v.rule, match: hit[0], excerpt });
    }
  }
  return found;
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (ignoredPath.test(path)) continue;
    if (entry.isDirectory()) out.push(...walk(path));
    if (entry.isFile() && entry.name.endsWith('.html')) out.push(path);
  }
  return out;
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&lsquo;|&rsquo;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function headingText(html) {
  return [...html.matchAll(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/gi)]
    .map((match) => stripHtml(match[1]))
    .filter(Boolean)
    .join(' | ');
}

function matchesBucket(text, headings, bucket) {
  return bucket.patterns.some((pattern) => pattern.test(headings) || pattern.test(text));
}

function releaseGate(text) {
  const kriteRequired = /KRITE\s+REQUIRED\s*:\s*YES/i.test(text);
  const kriteApproved = /KRITE\s+STATUS\s*:\s*APPROVED/i.test(text);
  const userApprovalOk = /USER\s+APPROVAL\s+STATUS\s*:\s*(APPROVED|NOT\s+REQUIRED)/i.test(text);
  const currentStateOk = /CURRENT\s+STATE\s*:\s*(APPROVED|RELEASED)/i.test(text);
  const failures = [];

  if (!kriteRequired) failures.push('KRITE REQUIRED: YES missing');
  if (!kriteApproved) failures.push('KRITE STATUS: APPROVED missing');
  if (!userApprovalOk) failures.push('USER APPROVAL STATUS must be APPROVED or NOT REQUIRED');
  if (!currentStateOk) failures.push('CURRENT STATE must be APPROVED or RELEASED');

  return {
    ok: failures.length === 0,
    failures,
  };
}

// The KRITE / release-control status lives in a SIDECAR file (RELEASE-CONTROL.md/.html)
// next to the guide — NEVER embedded in the client-facing guide body.
function readReleaseControl(guideFile) {
  try {
    const dir = dirname(guideFile);
    const sidecar = readdirSync(dir).find((n) => /release.?control/i.test(n));
    return sidecar ? readFileSync(join(dir, sidecar), 'utf8') : '';
  } catch {
    return '';
  }
}

// Signature of the internal release-control block — it must NOT appear in a client guide body.
const internalBlockSignature = /Release-control record|not part of the client narrative|KRITE\s+REQUIRED|Internal\s*[·.]\s*Release\s*Control|internal build\/QA artifact/i;

if (!existsSync(protocolRoot)) {
  console.error(`Protocol root not found: ${protocolRoot}`);
  process.exit(2);
}

function resolveTarget(file) {
  return isAbsolute(file) ? file : resolve(workspaceRoot, file);
}

const files = (targetFiles.length
  ? targetFiles.map(resolveTarget)
  : walk(protocolRoot)
    .filter((file) => /protocol/i.test(file))
    .filter((file) => !ignoredFile.test(file))
    .filter((file) => statSync(file).mtimeMs >= sinceMs)
).sort();

const missingFiles = files.filter((file) => !existsSync(file));
if (missingFiles.length > 0) {
  console.error(`Missing file(s): ${missingFiles.join(', ')}`);
  process.exit(2);
}

const rows = files.map((file) => {
  const html = readFileSync(file, 'utf8');
  const text = stripHtml(html);
  const headings = headingText(html);
  const rcText = readReleaseControl(file);
  const present = Object.fromEntries(
    buckets.map((bucket) => [
      bucket.key,
      bucket.key === 'kriteStatus'
        ? matchesBucket(rcText, '', bucket)
        : matchesBucket(text, headings, bucket),
    ]),
  );
  const missing = buckets.filter((bucket) => !present[bucket.key]);
  if (internalBlockSignature.test(text)) {
    missing.push({
      key: 'internalLeak',
      label: 'Internal release-control block leaked into client guide body (move it to a RELEASE-CONTROL sidecar)',
    });
  }
  const release = releaseGate(rcText);
  return {
    file,
    rel: relative(workspaceRoot, file),
    mtime: statSync(file).mtime.toISOString().slice(0, 10),
    present,
    missing,
    release,
    violations: findViolations(text),
  };
});

let warnCount = 0;
let releaseWarnCount = 0;
let violationCount = 0;

const scopeLabel = targetFiles.length ? `${files.length} target file(s)` : `${days} days`;
console.log(`Protocol content-contract audit (${scopeLabel})`);
console.log(requireKriteApproved
  ? 'Mode: structural screen + KRITE release gate.\n'
  : 'Note: this is a structural drift screen, not KRITE approval.\n');

// A scan that matched nothing is not a clean scan — it is a scan that did not
// happen. Reporting PASS here would mean "no protocol guide changed recently"
// and "every protocol guide is correct" print the same word.
if (!targetFiles.length && rows.length === 0) {
  console.log(`BLOCKED — no protocol guide matched the last ${days} days under ${relative(workspaceRoot, protocolRoot)}.`);
  console.log('  Nothing was audited, so nothing can be reported as passing.');
  console.log('  Audit a specific file with --file, or widen the window with --days N.');
  process.exit(strict ? 1 : 0);
}

for (const row of rows) {
  const missingLabels = row.missing.map((bucket) => bucket.label);
  const releaseFailures = requireKriteApproved ? row.release.failures : [];
  const status = missingLabels.length === 0 && releaseFailures.length === 0 && row.violations.length === 0
    ? 'PASS'
    : (row.violations.length > 0 ? 'FAIL' : 'WARN');
  if (status !== 'PASS') warnCount += 1;
  if (releaseFailures.length > 0) releaseWarnCount += 1;
  violationCount += row.violations.length;
  console.log(`${status} ${row.mtime} ${row.rel}`);
  if (missingLabels.length > 0) console.log(`  missing: ${missingLabels.join(', ')}`);
  if (releaseFailures.length > 0) console.log(`  release blocked: ${releaseFailures.join('; ')}`);

  // Grouped by rule, and each group names the document that makes it a rule —
  // so the fix does not require finding whoever knows the doctrine.
  const byRule = new Map();
  for (const v of row.violations) {
    if (!byRule.has(v.key)) byRule.set(v.key, { ...v, matches: [] });
    byRule.get(v.key).matches.push(v);
  }
  for (const g of byRule.values()) {
    console.log(`  VIOLATION [${g.key}] ${g.label} — ${g.matches.length} occurrence(s)`);
    console.log(`    file  : ${row.rel}`);
    console.log(`    rule  : ${g.rule}`);
    console.log(`    canon : ${g.source}`);
    for (const m of g.matches.slice(0, 3)) {
      console.log(`    found : "${m.match}"  in  ...${m.excerpt.replace(/\s+/g, ' ')}...`);
    }
    if (g.matches.length > 3) console.log(`    ...and ${g.matches.length - 3} more`);
  }
}

console.log('');
console.log(`Summary: files=${rows.length} pass=${rows.length - warnCount} warn/fail=${warnCount} violations=${violationCount}`);
if (requireKriteApproved) console.log(`Release gate: pass=${rows.length - releaseWarnCount} blocked=${releaseWarnCount}`);

if (strict && warnCount > 0) process.exit(1);
// A doctrine violation is a hard fail in every mode. Unlike a missing bucket —
// which can be a structural near-miss — forbidden content is present, in a file
// headed for a client, right now.
if (violationCount > 0) process.exit(1);
// A blocked release gate must fail the process, not just print. Any wrapper, hook, or CI
// step gating on exit status would otherwise treat "release blocked" as a pass.
if (requireKriteApproved && releaseWarnCount > 0) process.exit(1);
