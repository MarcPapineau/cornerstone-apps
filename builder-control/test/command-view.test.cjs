#!/usr/bin/env node
/**
 * command-view.test.cjs — acceptance contract for the founder-facing AEGIS
 * Command View.
 *
 * This suite deliberately tests operator meaning and evidence boundaries, not
 * pixel values, layout coordinates, framework choices, or decorative style.
 * Lower-level anti-theater mechanics remain in dashboard-slice.test.cjs; this
 * file verifies that the selected Command View exposes those facts as useful
 * pilot instruments.
 */
'use strict';

const assert = require('assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const HTML_PATH = path.join(ROOT, 'builder-control', 'dashboard', 'index.html');
const SLICE_TEST_PATH = path.join(ROOT, 'builder-control', 'test', 'dashboard-slice.test.cjs');

const html = fs.readFileSync(HTML_PATH, 'utf8');
const code = html.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
const markup = html
  .replace(/<(?:script|style)\b[\s\S]*?<\/(?:script|style)>/gi, '')
  .replace(/<!--[\s\S]*?-->/g, '');
const commandShellStart = markup.indexOf('<main class="command-shell" id="operator-shell"');
const detailBoundary = markup.indexOf('<details id="raw-state"', commandShellStart);
assert.ok(commandShellStart !== -1 && detailBoundary > commandShellStart,
  'the static Command View or its Detail boundary is missing');
const commandMarkup = markup.slice(commandShellStart, detailBoundary);

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`ok   ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name}: ${error.message}`);
  }
}

let executableDomOutput = null;
function requireDomProof(name) {
  if (executableDomOutput === null) {
    const companion = spawnSync(process.execPath, [SLICE_TEST_PATH], {
      cwd: ROOT, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
    });
    executableDomOutput = `${companion.stdout || ''}\n${companion.stderr || ''}`;
    assert.strictEqual(companion.status, 0,
      `executable dashboard companion failed:\n${executableDomOutput}`);
  }
  assert.ok(executableDomOutput.includes(`ok   ${name}`),
    `Command View acceptance did not execute DOM proof: ${name}`);
}

function plain(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function controls() {
  const found = [];
  const re = /<(button|a)\b([^>]*)>([\s\S]*?)<\/\1>|<input\b([^>]*)>/gi;
  for (const match of markup.matchAll(re)) {
    const attrs = match[2] || match[4] || '';
    const body = match[3] || '';
    const attrLabel = (attrs.match(/(?:aria-label|value)\s*=\s*['"]([^'"]+)['"]/i) || [])[1] || '';
    found.push({ attrs, label: plain(body + ' ' + attrLabel) });
  }
  return found;
}

function hasVisibleCommandRegion(labelPattern) {
  return labelPattern.test(plain(commandMarkup));
}

console.log('AEGIS Command View — founder acceptance contract');

test('Command and Detail are explicit, accessible view controls with real disclosure switching', () => {
  const viewControls = controls();
  const command = viewControls.find((item) => /^command view$/i.test(item.label));
  const detail = viewControls.find((item) => /^detail view$/i.test(item.label));
  assert.ok(command, 'no visible Command view control');
  assert.ok(detail, 'no visible Detail view control');
  assert.ok(/aria-pressed|aria-selected|type\s*=\s*['"]radio/i.test(command.attrs),
    'Command view does not expose its selected state to assistive technology');
  assert.ok(/aria-pressed|aria-selected|type\s*=\s*['"]radio/i.test(detail.attrs),
    'Detail view does not expose its selected state to assistive technology');
  assert.ok(/setDetailView\s*\(/.test(code), 'the view controls have no disclosure boundary');
  assert.ok(/rawState\.open\s*=\s*enabled/.test(code),
    'Detail view does not actually disclose the deep evidence surface');
});

test('Command and Detail acceptance executes the companion DOM control contract', () => {
  requireDomProof('DOM: Command and Detail controls execute the real disclosure switch');
});

test('the first screen contains the required command regions, not one undifferentiated telemetry page', () => {
  const required = [
    ['Mission brief', /\bmission (?:brief|control)\b/i],
    ['Workflow / build sequence', /\b(?:workflow|build) (?:route|sequence)\b/i],
    ['Inspector', /\binspector\b/i],
    ['Event history', /\bevent history\b/i],
    ['Decisions required', /\bdecisions? required\b/i],
    ['System health', /\bsystem health\b/i],
    ['Last safe checkpoint', /\blast safe checkpoint\b/i]
  ];
  const missing = required.filter(([, pattern]) => !hasVisibleCommandRegion(pattern)).map(([label]) => label);
  assert.deepStrictEqual(missing, [], `missing command region(s): ${missing.join(', ')}`);
});

test('pilot instruments answer mission, worker, now, next, blocker, decision and safe-state questions in plain English', () => {
  requireDomProof('DOM: a running build shows its mission, current action, elapsed evidence, next step and blocker without inventing a model');
  requireDomProof('DOM: routed Command View renders canonical pilot cards and accessible plain-English workflow state');
  requireDomProof('DOM: a long mission renders one visible pilot headline while preserving exact truth in a collapsed disclosure');
});

// The founder's question during a build is "what is it doing right now", and
// the only honest answer is the bounded category the worker derived from
// authenticated progress evidence. The acceptance bar is therefore not "an
// activity renders": it is that the sentence comes from the projection, that a
// heartbeat alone still reads unavailable, and that Detail View restates the
// same resolution instead of reaching its own.
test('live builder activity reads in plain English, from the projection, on both views', () => {
  requireDomProof('DOM: a running builder with a recorded read activity says what it is doing and when');
  requireDomProof('DOM: a heartbeat with no real progress still reads as progress unavailable');
  requireDomProof('DOM: Command View and Detail View print one builder-activity resolution, never two');
  requireDomProof('DOM: no raw builder output reaches the page through the activity surface');
  assert.ok(/commandCard\('BUILDER PROGRESS'/.test(code),
    'the Command View has no builder progress instrument');
  const fn = code.slice(code.indexOf('function supervisionFacts'),
    code.indexOf('function supervisionEvidence'));
  assert.ok(fn.length > 0, 'the supervisionFacts() boundary was not found');
  assert.ok(/s\.activitySummary/.test(fn) && /s\.activityAt/.test(fn),
    'the deck does not read the projected activity sentence and the time its evidence was recorded');
  assert.ok(!/'READING'|'EDITING'|'SEARCHING'|'WORKING'/.test(fn),
    'the page carries an activity vocabulary of its own instead of reading the canonical projection');
  assert.ok(!/Date\.now\s*\(|new Date\s*\(/.test(fn),
    'the activity instrument consulted a clock rather than the recorded evidence time');
});

test('the Command View fails closed without state.js but remains usable by authenticated live status', () => {
  requireDomProof('DOM: missing state.js paints UNAVAILABLE immediately and authenticated live status repopulates the pilot deck');
  requireDomProof('DOM: missing state.js and unavailable live API leave every primary instrument fail-closed, never loading');
  requireDomProof('DOM: run history uses generated state while live status is unavailable and never invents an empty ledger');
});

test('mission, action, next step, blocker and checkpoint values come from the bound run and evidence helpers', () => {
  requireDomProof('DOM: a running build shows its mission, current action, elapsed evidence, next step and blocker without inventing a model');
  requireDomProof('DOM: the public checkpoint id and rollbackPoint render together in the run card and pilot instruments');
  requireDomProof('DOM: pre-host CHECKS_PASSED is visibly snapshot-pass plus mandatory-host PENDING');
  requireDomProof('DOM: unverified check counters never render snapshot PASS prose');
  requireDomProof('DOM: CHECKS_PASSED preserves named required-reviewer actions while the gate is blocked');
  requireDomProof('DOM: REVIEW_FAILED keeps an uncorroborated claim fail-closed and exposes bounded Retry');
  requireDomProof('DOM: snapshot through live minimization preserves a fail-closed REVIEW_FAILED explanation');
  requireDomProof('DOM: every retryable failure uses the exported helper and POSTs the canonical runId');
  requireDomProof('DOM: model authentication failure names the non-executable Grok failover without exposing Retry');
  requireDomProof('DOM: unverified worker termination is BLOCKED, never STOPPED, and exposes only administrative abandonment');
});

test('checkpoint acceptance executes the real public checkpoint and rollbackPoint DOM contract', () => {
  requireDomProof('DOM: the public checkpoint id and rollbackPoint render together in the run card and pilot instruments');
  requireDomProof('DOM: authenticated checkpoint status and a later SSE checkpoint repaint share one safe formatter');
  requireDomProof('DOM: malformed run evidence is unavailable and never lights the clean-idle instruments');
});

test('the displayed crew/model prefers the canonical route assignment over launch-memory fallbacks', () => {
  requireDomProof('DOM: routed Command View renders canonical pilot cards and accessible plain-English workflow state');
});

test('the handoff strip is wired to canonical run transitions and current task evidence', () => {
  requireDomProof('DOM: a canonical stage change between live pushes activates one plain-English handoff');
  requireDomProof('DOM: out-of-order and uncorroborated evidence never light the handoff');
});

test('workflow state uses colour, icon and plain-English text together', () => {
  requireDomProof('DOM: routed Command View renders canonical pilot cards and accessible plain-English workflow state');
});

// ── the Monday research report and the Marc decision queue ─────────────────
// This is the one surface on the page where the founder takes an irreversible
// action on evidence he did not gather himself, so the acceptance bar is not
// "the panel renders". It is: nothing is shown from a report AEGIS cannot vouch
// for, everything needed to decide is on screen before the controls are, and
// the page can name only which recommendation is being decided.
test('the Command View carries the Monday research report and the Marc decision queue', () => {
  for (const [label, pattern] of [
    ['Monday research report', /\bmonday research report\b/i],
    ['Marc decision queue', /\bmarc decision queue\b/i],
  ]) {
    assert.ok(hasVisibleCommandRegion(pattern), `the Command View has no ${label} region`);
  }
  // Neither panel ships with content of its own. A seeded report, an example
  // recommendation, or a decision control that exists before a projection
  // offered one would all be approvable theater.
  assert.ok(!/REC-[A-Za-z0-9]|RR-\d{8}-/.test(commandMarkup),
    'a research report or recommendation identifier is baked into the shipped markup');
  assert.ok(!/data-research-decision/.test(markup),
    'a decision control ships in the static markup, before any projection has offered one');
  assert.ok(/data-research-decision/.test(code),
    'the decision controls are never built from the projection at all');
});

test('the research panels are honest when no valid report exists and never decide from one', () => {
  requireDomProof('DOM: no valid research report shows an honest empty state and offers no decision');
  requireDomProof('DOM: a stale report and an already-decided recommendation cannot be approved');
});

test('a valid report states what changed, why it matters, evidence, cost, risks and the decision requested', () => {
  requireDomProof('DOM: a valid research report shows what changed, why it matters, evidence, cost, risks and the decision requested');
  requireDomProof('DOM: an unchecked signal is never dressed as a checked recommendation');
});

test('a founder decision names only the recommendation and lets the route carry the decision word', () => {
  requireDomProof('DOM: each founder decision posts only the recommendationId to its own dedicated route');
  requireDomProof('DOM: a refused decision records nothing and says so');
  // The three decision words exist ONLY as three named routes, declared once.
  // A shared endpoint with a verdict field, or a second call site, would put
  // the decision word back under browser control.
  const table = code.slice(code.indexOf('var RESEARCH_DECISIONS = ['),
    code.indexOf('function activityDecision'));
  assert.ok(table.length > 0, 'the one research decision route table was not found');
  for (const route of ['/api/research-approve', '/api/research-park', '/api/research-reject']) {
    assert.ok(table.includes(route), `${route} is missing from the one decision route table`);
  }
  assert.strictEqual((code.match(/\/api\/research-/g) || []).length, 3,
    'a research decision route is named outside the one declared route table');
  assert.ok(/callApi\(choice\.route, \{ recommendationId: item\.recommendationId \}\)/.test(code),
    'the decision request body is built from something other than the one recommendation id');
});

test('research machine identifiers stay in Detail View while the founder panels stay in plain English', () => {
  requireDomProof('DOM: research identifiers and digests stay in Detail View, not in the founder panels');
  assert.ok(!/reportSha256|recommendationSha256|notionPageId/.test(commandMarkup),
    'a machine identifier is labelled in the Command View markup rather than in Detail View');
});

test('existing anti-theater guards remain the single owner for fake progress, decorative loops and transition proof', () => {
  const companion = fs.readFileSync(SLICE_TEST_PATH, 'utf8');
  const delegated = [
    'no timers anywhere: a pulse that can run without a real event is fake activity',
    'the JARVIS shell has no CSS animation or decorative motion loop',
    'no fabricated progress, percentage, uptime or KPI vocabulary',
    'the handoff indicator claims a transition only from canonical run state, never from a repaint'
  ];
  const missing = delegated.filter((name) => !companion.includes(name));
  assert.deepStrictEqual(missing, [], `companion anti-theater contract missing: ${missing.join('; ')}`);
});

console.log(`${passed} passed, ${failed} failed.`);
if (failed) process.exitCode = 1;
