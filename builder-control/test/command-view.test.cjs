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
