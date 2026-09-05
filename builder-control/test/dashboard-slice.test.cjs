#!/usr/bin/env node
/**
 * dashboard-slice.test.cjs — proves the visual slice cannot lie.
 *
 * These are static assertions over the slice's source. They are deliberately
 * crude and deliberately paranoid, because the failure they guard against is
 * not a crash — it is a dashboard that looks healthy while the system is not.
 * A timer-driven pulse, a hardcoded "PASS", or a seeded fallback object would
 * all render beautifully and mean nothing.
 *
 * Browser behaviour (real render, failure path, contrast, responsive) is
 * verified separately and recorded in the evidence report; these tests hold the
 * invariants that must never regress unnoticed between those sessions.
 */
'use strict';

const assert = require('assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const AegisState = require('../aegis-state.cjs');
const Hosting = require('../hosting/server.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const DIR = path.join(ROOT, 'builder-control', 'dashboard');
const HTML_PATH = path.join(DIR, 'index.html');
// Read fresh each time: a cached copy would let a proof pass against a page
// that no longer exists on disk.
const htmlSrc = () => fs.readFileSync(HTML_PATH, 'utf8');

function generatedDashboardState() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-dashboard-state-test-'));
  const generatedStatePath = path.join(tempDir, 'state.js');
  let source;
  try {
    const generated = spawnSync(process.execPath,
      [path.join(ROOT, 'builder-control', 'aegis-state.cjs'), '--out', generatedStatePath],
      { cwd: ROOT, encoding: 'utf8' });
    assert.strictEqual(generated.status, 0,
      `state.js generator failed: ${(generated.stderr || generated.stdout || '').trim()}`);
    assert.ok(fs.existsSync(generatedStatePath), 'state.js generator produced no isolated test artifact');
    source = fs.readFileSync(generatedStatePath, 'utf8');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  assert.ok(!fs.existsSync(tempDir), 'isolated state.js test directory was not cleaned up');
  return {
    source,
    state: JSON.parse(source.slice(source.indexOf('{'), source.lastIndexOf('}') + 1)),
  };
}

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`ok   ${name}`); }
  catch (e) { console.error(`FAIL ${name}: ${e.message}`); process.exitCode = 1; }
}

const html = fs.readFileSync(HTML_PATH, 'utf8');
// Strip comments so a rule that *describes* a ban is not mistaken for breaking it.
const code = html.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
const HOSTILE_WORKER_OUTPUT = Object.freeze({
  source: 'function INTERNAL_SOURCE_SENTINEL(){ return "repository text must stay private"; }',
  pem: '-----BEGIN PRIVATE KEY-----\nAEGIS-PEM-SENTINEL-DO-NOT-PUBLISH\n-----END PRIVATE KEY-----',
  jwt: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhZWdpcy1qd3Qtc2VudGluZWwifQ.signatureSentinel123',
  cookie: 'Cookie: session=AEGIS-COOKIE-SENTINEL-DO-NOT-PUBLISH',
  unlabelled: 'tR7xQm2LpZ0aVbNc8YeWuJ4KsHdG1fXo',
});

// The plain words the shipped OPS_CHIP_PLAIN seam is expected to print, held
// here as an independent expectation rather than read out of the page: a silent
// rewording of the seam must fail these proofs, not be ratified by them. The
// canonical token is what the page must still carry in its machine attributes,
// its chip titles and its detail sentences, and that is asserted separately.
const RUN_STATE_PLAIN = Object.freeze({
  RUNNING: 'Running', WAITING: 'Waiting', BLOCKED: 'Needs attention',
  COMPLETE: 'Finished', UNVERIFIED: 'Not confirmed', IDLE: 'Nothing running',
  UNAVAILABLE: 'Not recorded',
});
const RUN_LIFECYCLE_PLAIN = Object.freeze({
  CREATED: 'Run created', INTAKE_RECORDED: 'Objective recorded',
  ROUTED: 'Builder chosen', WORKTREE_READY: 'Workspace ready', BUILDING: 'Building',
  BUILD_CONTINUED: 'Build resumed', BUILT: 'Build finished', BUILD_FAILED: 'Build failed',
  CHECKS_PASSED: 'Checks passed', CHECKS_FAILED: 'Checks failed',
  REVIEW_BOUND: 'Review evidence attached', REVIEW_FAILED: 'Review failed',
  CORRECTING: 'Correcting', CHECKPOINTED: 'Safe checkpoint reached',
  ROLLED_BACK: 'Rolled back', ABANDONED: 'Abandoned', UNAVAILABLE: 'Not recorded',
});
function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
// The four state vocabularies the Strategic Systems HUD module footers write.
// Same discipline as above: these are the words the shipped seam must print, and
// the exact code is asserted separately on each footer's machine attribute.
const GATE_OUTCOME_PLAIN = Object.freeze({
  READY_FOR_PR: 'Ready to open a pull request',
  READY_FOR_DETERMINISTIC_VALIDATION: 'Waiting on deterministic checks',
  BLOCKED: 'Needs attention', UNAVAILABLE: 'Not recorded',
});
const CHECKPOINT_EVIDENCE_PLAIN = Object.freeze({
  RECORDED: 'Safe state recorded',
  ROLLBACK_UNAVAILABLE: 'Safe state recorded, no way back',
  NOT_RECORDED: 'No safe state recorded', BLOCKED: 'Needs attention',
  UNAVAILABLE: 'Not recorded',
});
const CODE_VERSION_PLAIN = Object.freeze({
  BOUND: 'Matches this code version', UNAVAILABLE: 'Not confirmed',
});
const REVIEW_COVERAGE_PLAIN = Object.freeze({
  'EVIDENCE UNAVAILABLE': 'No review evidence recorded',
  'REVIEW EVIDENCE STALE OR MISMATCHED': 'Review evidence belongs to another version',
  'REVIEW COVERAGE COMPLETE': 'Review coverage complete',
  'SERVER VERIFICATION CANDIDATE — RUN VERSION DIFFERS':
    'Appears ready to verify, but the recorded version differs',
  'EVIDENCE APPEARS READY FOR SERVER VERIFICATION': 'Appears ready for server verification',
  'REVIEW EVIDENCE NOT YET SERVER-VERIFIED': 'Not yet server-verified',
  'REVIEW COVERAGE INCOMPLETE': 'Review coverage incomplete',
});

console.log('AEGIS dashboard slice — invariants');

// ── nothing may animate on a timer ──────────────────────────────────────────
test('no timers anywhere: a pulse that can run without a real event is fake activity', () => {
  for (const banned of ['setInterval', 'setTimeout', 'requestAnimationFrame']) {
    assert.ok(!new RegExp('\\b' + banned + '\\s*\\(').test(code),
      `${banned}( found in executable code — motion must be bound to state, not to time`);
  }
});

// The shell — every chrome and decorative surface on this page — still owns no
// animation at all, and nothing anywhere owns a loop. Exactly one animation
// exists, it is neither chrome nor a loop, and it is enumerated here by name:
// the AEGIS Core evidence cue, two one-shot keyframes the renderer alternates so
// that one genuinely new recorded builder activity produces one short highlight.
// Alternation is what restarts a CSS one-shot without a timer or a frame loop;
// the two blocks are otherwise identical. A third keyframes block, a second
// animated selector, an iteration count above one, or any looping longhand fails
// this proof rather than shipping quietly.
const CORE_CUE_KEYFRAMES = ['aegis-core-cue-a', 'aegis-core-cue-b'];
const CORE_CUE_SELECTORS = ['#aegis-core[data-core-cue="a"]::after',
  '#aegis-core[data-core-cue="b"]::after'];

test('the JARVIS shell has no CSS animation or decorative motion loop', () => {
  const keyframes = (code.match(/@keyframes\s+([\w-]+)/g) || [])
    .map((match) => match.replace(/@keyframes\s+/, ''));
  assert.deepStrictEqual(keyframes, CORE_CUE_KEYFRAMES,
    `only the two AEGIS Core evidence-cue keyframes may exist, found: ${keyframes.join(', ') || 'none'}`);
  // No longhand may loop, reverse, pause or resume motion: the shorthand below
  // is the whole declaration, so there is nowhere else for a loop to be set.
  for (const longhand of ['animation-iteration-count', 'animation-direction',
    'animation-play-state', 'animation-name']) {
    assert.ok(!new RegExp('\\b' + longhand + '\\s*:').test(code),
      `${longhand} is declared — a one-shot cue must own no restart or loop control`);
  }
  // Every animation declaration in the page is either the suppression reduced
  // motion applies, or one of the two bounded cues on the core's accent ring.
  const animated = [];
  for (const rule of code.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const declared = /(?:^|;)\s*animation\s*:\s*([^;]+)/.exec(rule[2]);
    if (!declared) continue;
    const selector = rule[1].trim();
    const value = declared[1].trim();
    if (value === 'none!important') continue;
    assert.ok(CORE_CUE_SELECTORS.includes(selector),
      `${selector} animates, and only the AEGIS Core evidence accent may`);
    assert.match(value, /^aegis-core-cue-[ab] 620ms ease-out 1$/,
      `${selector} does not run exactly one bounded iteration: ${value}`);
    animated.push(selector);
  }
  assert.deepStrictEqual(animated.sort(), [...CORE_CUE_SELECTORS].sort(),
    'the evidence cue lost one of its two alternating one-shots, so a second genuine update would show nothing');
  // The cue leaves nothing behind: no fill mode, and an accent that starts and
  // ends fully transparent, so a finished cue cannot be read as a status.
  assert.ok(/#aegis-core::after\{[^}]*opacity:0[^}]*\}/.test(code),
    'the core accent ring is not transparent at rest, so it is a standing mark rather than a cue');
  for (const name of CORE_CUE_KEYFRAMES) {
    const block = code.slice(code.indexOf('@keyframes ' + name));
    assert.ok(/0%\{opacity:0[^}]*\}/.test(block.slice(0, 200)) &&
      /100%\{opacity:0[^}]*\}/.test(block.slice(0, 200)),
      `${name} does not start and end at opacity 0, so it leaves a residue on the core`);
    assert.ok(!/\bforwards\b|\bbackwards\b|\bboth\b/.test(block.slice(0, 200)),
      `${name} uses a fill mode, which holds a frame on screen after the evidence is old`);
  }
  assert.ok(/\.stage\.is-active\s+\.dot\s*\{[^}]*box-shadow/.test(code),
    'ACTIVE still needs a static, non-colour-only visual emphasis');
});

test('reduced motion is honoured for any future transitions', () => {
  assert.ok(/@media\s*\(prefers-reduced-motion:\s*reduce\)/.test(code), 'no reduced-motion block');
  const block = code.slice(code.indexOf('prefers-reduced-motion'));
  assert.ok(/transition\s*:\s*none/.test(block.slice(0, 400)), 'reduced motion must disable transitions');
});

test('the keyboard skip link becomes visibly usable when focused', () => {
  assert.ok(/\.sr:focus,\.sr:focus-visible\s*\{[^}]*position:fixed[^}]*width:auto[^}]*height:auto[^}]*clip:auto[^}]*z-index:100/s.test(code),
    'the first keyboard focus target is still clipped or visually hidden');
  assert.ok(/\.sr:focus,\.sr:focus-visible\s*\{[^}]*border:2px solid var\(--focus\)[^}]*background:#08131d[^}]*color:var\(--text-0\)/s.test(code),
    'the visible skip link lost its high-contrast focus treatment');
});

test('normal-size operational HUD text clears the 4.5:1 contrast floor', () => {
  const cssVariables = {};
  const rootRule = /:root\s*\{([^}]*)\}/.exec(code);
  assert.ok(rootRule, 'the shipped :root token rule is missing');
  for (const match of rootRule[1].matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-f]{6})/gi)) {
    cssVariables[match[1]] = match[2].toLowerCase();
  }
  function cssValue(selector, property) {
    let value = null;
    for (const rule of code.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selectors = rule[1].split(',').map((item) => item.trim());
      if (!selectors.includes(selector)) continue;
      const declaration = new RegExp('(?:^|;)\\s*' + property + '\\s*:\\s*([^;]+)', 'i').exec(rule[2]);
      if (declaration) value = declaration[1].replace(/!important/gi, '').trim();
    }
    assert.ok(value, `the shipped ${selector} ${property} declaration is missing`);
    return value;
  }
  function parseColor(value) {
    const token = /^var\((--[\w-]+)\)$/.exec(value);
    if (token) value = cssVariables[token[1]];
    const hex = /^(#[0-9a-f]{6})$/i.exec(value || '');
    if (hex) return { rgb: hex[1].slice(1).match(/../g).map((part) => parseInt(part, 16)), alpha: 1 };
    const rgba = /^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(0|1|0?\.\d+)\s*\)$/i.exec(value || '');
    assert.ok(rgba, `unsupported shipped CSS colour: ${value}`);
    return { rgb: rgba.slice(1, 4).map(Number), alpha: Number(rgba[4]) };
  }
  function composite(foreground, background) {
    const fg = parseColor(foreground);
    const bg = parseColor(background);
    assert.strictEqual(bg.alpha, 1, 'the effective background base must be opaque');
    return { rgb: fg.rgb.map((part, index) => Math.round(part * fg.alpha + bg.rgb[index] * (1 - fg.alpha))), alpha: 1 };
  }
  function luminance(hex) {
    const rgb = (typeof hex === 'string' ? parseColor(hex) : hex).rgb.map((part) => part / 255)
      .map((part) => part <= 0.04045 ? part / 12.92 : Math.pow((part + 0.055) / 1.055, 2.4));
    return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  }
  function contrast(foreground, background) {
    const a = luminance(foreground);
    const b = luminance(background);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  }
  const foreground = cssValue('.mission-meta', 'color');
  const founderBackground = cssValue('#founder-summary', 'background');
  const coreBackground = composite(cssValue('.core-node', 'background'),
    cssValue('.strategic-core', 'background'));
  const panelBackground = cssValue('.command-shell section', 'background');
  const topologyBackground = cssValue('#topology-overview', 'background');
  const effectiveBackgrounds = [
    ['.mission-meta', founderBackground],
    ['.hud-state', coreBackground],
    ['.hud-summary-meta', panelBackground],
    ['.muted in Mission Brief', founderBackground],
    ['.muted in Build Sequence', topologyBackground],
    ['.muted in command panels', panelBackground],
  ];
  assert.strictEqual(foreground, cssValue('.core-node .hud-state', 'color'),
    'HUD state text no longer shares the tested operational foreground token');
  assert.strictEqual(foreground, cssValue('.hud-summary-meta', 'color'),
    'HUD summary text no longer shares the tested operational foreground token');
  assert.strictEqual(foreground, cssValue('.muted', 'color'),
    'muted operational text no longer shares the tested foreground token');
  for (const [selector, background] of effectiveBackgrounds) {
    assert.ok(contrast(foreground, background) >= 4.5,
      `${selector} secondary text is below 4.5:1 against its shipped effective background`);
  }
  for (const selector of ['mission-meta', 'hud-state', 'hud-summary-meta', 'muted']) {
    assert.ok(new RegExp('\\.' + selector + '\\s*\\{[^}]*color:var\\(--text-2\\)', 's').test(code),
      `${selector} no longer uses the tested operational text token`);
  }
});

// ── handoff indicator (PKT-20260825-SWITCHBOARD-FOUNDATION) ────────────────
test('the handoff indicator is compact, motion-free under reduced motion, and silent when inactive', () => {
  assert.ok(/\.handoff\s*\{[^}]*display:flex/.test(code), 'the handoff indicator has no compact single-line layout');
  assert.ok(/\.handoff\[hidden\]\s*\{\s*display:none/.test(code),
    'an inactive handoff strip must actually disappear — display:flex would override the hidden attribute');
  const reduced = code.slice(code.indexOf('prefers-reduced-motion'));
  assert.ok(/\.handoff\s*\{\s*transition:none!important/.test(reduced.slice(0, 600)),
    'the handoff indicator does not explicitly drop its one transition under reduced motion');
  const handoffCss = code.slice(code.indexOf('.handoff{display:flex'), code.indexOf('.handoff-at'));
  assert.ok(handoffCss.length > 0 && handoffCss.length < 900, 'the handoff indicator block was not located');
  assert.ok(!/\banimation\s*:/.test(handoffCss), 'the handoff indicator must not animate');
  assert.ok(/transition:border-color/.test(handoffCss),
    'the indicator has no single named transition for reduced motion to disable');
});

test('the handoff indicator claims a transition only from canonical run state, never from a repaint', () => {
  const fn = code.slice(code.indexOf('function observeHandoff'), code.indexOf('function renderHandoff'));
  assert.ok(fn.length > 0, 'no observeHandoff() boundary found');
  assert.ok(/if\s*\(!seen\)\s*\{[^}]*return handoffMoved/.test(fn),
    'the first sighting of a run must not be reported as a transition');
  assert.ok(/at\s*<\s*seen\.at/.test(fn), 'out-of-order evidence is not refused');
  assert.ok(/run\.state\s*===\s*seen\.state/.test(fn), 'an unchanged state must not be reported as a handoff');
  assert.ok(/count\s*<=\s*seen\.count/.test(fn),
    'a state change is not corroborated against the canonical transition counter');
  const render = code.slice(code.indexOf('function renderHandoff'), code.indexOf('function renderFounderSummary'));
  assert.ok(/moved\.to\s*===\s*run\.state/.test(render),
    'the strip may only stay lit while the run is still in the state it was handed to');
  assert.ok(/strip\.hidden\s*=\s*true/.test(render), 'an inactive strip must be hidden, not rendered as reassuring text');
});

// A recorded transition and the current action are two different kinds of fact.
// Read as one sentence — "X handed off to Y. Now: <task>" — the ledger's own
// history borrowed the present tense of the task beside it, and a repaint that
// changed only the task made a move recorded minutes ago look like a move that
// had just happened. They are kept apart here, in the markup and in the words.
test('the handoff strip reads recorded transition evidence apart from the current action', () => {
  const render = code.slice(code.indexOf('function renderHandoff'), code.indexOf('function renderFounderSummary'));
  const recordedStart = render.indexOf("el('div','handoff-recorded')");
  const currentStart = render.indexOf("el('div','handoff-current')");
  assert.ok(recordedStart !== -1 && currentStart > recordedStart,
    'the strip does not build a recorded group and a current-action group, in that order');
  const recorded = render.slice(recordedStart, currentStart);
  const current = render.slice(currentStart, render.indexOf('host.appendChild(strip)', currentStart));
  assert.ok(/data-handoff-part','RECORDED'/.test(recorded) && /data-handoff-part','CURRENT'/.test(current),
    'the two groups are not marked as what they are, so nothing can tell them apart');
  assert.ok(/'LAST RECORDED HANDOFF'/.test(recorded) && /'CURRENT ACTION'/.test(current),
    'the strip does not say in words which half is recorded history and which is the current action');
  // The recorded half carries the exact canonical states, the actors and the
  // time the run record was written — and nothing about what is happening now.
  assert.ok(/moved\.from/.test(recorded) && /moved\.to/.test(recorded) &&
    /moved\.at \|\| 'UNAVAILABLE'/.test(recorded),
    'the recorded half dropped the exact canonical states or the run-record timestamp');
  assert.ok(!/\btask\b/.test(recorded), 'the current action was mixed back into the recorded transition');
  assert.ok(!/\bmoved\./.test(current), 'the recorded transition was mixed back into the current action');
  assert.ok(/handoff-task', task/.test(current),
    'the current action is no longer the exact task sentence the deck resolved');
  // Announcement stays keyed to the transition alone. Keying it to the task
  // would re-read a handoff that never happened again every time the deck's
  // current action sentence changed.
  const key = /var key = ([^;]+);/.exec(render);
  assert.ok(key, 'the one announcement key was not found');
  assert.ok(!/task/.test(key[1]),
    'the handoff announcement is keyed to the current action, so a changed task re-announces a move');
  assert.ok(/handoffAnnounced !== key/.test(render),
    'the strip no longer announces once per transition');
  assert.ok(!/new Date|Date\.now|setTimeout|setInterval/.test(render),
    'the strip consulted a clock instead of the canonical run record');
  // Two groups mean two things that can be long. A canonical timestamp and a
  // task sentence both wrap inside the strip; neither drags a narrow viewport
  // sideways, and neither is clamped, because clamping would hide evidence.
  for (const selector of ['.handoff-task', '.handoff-at']) {
    assert.ok(new RegExp('\\' + selector + '\\{[^}]*overflow-wrap:anywhere').test(code),
      `${selector} can push a narrow viewport sideways instead of wrapping`);
  }
  assert.ok(/\.handoff-recorded,\.handoff-current\{[^}]*flex-wrap:wrap/.test(code),
    'the recorded and current groups cannot wrap onto their own rows');
  assert.ok(!/\.handoff-(?:task|at|flow)\{[^}]*(?:display:none|-webkit-line-clamp)/.test(code),
    'part of the strip is hidden or clamped instead of wrapped');
});

// ── handoff path around the AEGIS Core (PKT-20260826-ASYNC-WORKER-OPERATOR-BETA) ─
// The failure this guards is the same one the indicator above guards, moved to
// a bigger surface: a row of stations is a diagram, and a diagram that lights
// up on a repaint reads as progress no canonical event ever recorded.
function corePathStations() {
  const start = code.indexOf('var CORE_PATH = [');
  const end = code.indexOf('];', start);
  assert.ok(start !== -1 && end > start, 'the canonical station path was not found in the page source');
  return require('vm').runInNewContext('(' + code.slice(start + 'var CORE_PATH = '.length, end + 1) + ')');
}

function canonicalRunStates() {
  const source = fs.readFileSync(path.join(ROOT, 'builder-control', 'aegis-run.cjs'), 'utf8');
  const start = source.indexOf('const STATES = {');
  const end = source.indexOf('\n};', start);
  assert.ok(start !== -1 && end > start, 'the canonical aegis-run state table was not found');
  const states = {};
  for (const m of source.slice(start, end).matchAll(/^\s+([A-Z_]+):\s*\{[^}]*step:\s*(\d+)/gm)) {
    states[m[1]] = Number(m[2]);
  }
  assert.ok(Object.keys(states).length >= 10, 'the canonical state table parsed as almost empty');
  return states;
}

test('the core path names only real aegis-run states, in the canonical step order, inventing no station', () => {
  const stations = corePathStations();
  const canonical = canonicalRunStates();
  const named = [];
  let previousStep = 0;
  for (const station of stations) {
    assert.ok(station.id && station.label && Array.isArray(station.states) && station.states.length,
      `station ${station.id || '(unnamed)'} carries no canonical states`);
    const steps = station.states.map((state) => {
      assert.ok(Object.prototype.hasOwnProperty.call(canonical, state),
        `station ${station.id} names ${state}, which aegis-run does not declare as a run state`);
      named.push(state);
      return canonical[state];
    });
    assert.strictEqual(new Set(steps).size, 1,
      `station ${station.id} groups run states aegis-run puts at different lifecycle steps`);
    // One station per canonical step, in aegis-run's step order: the sequence
    // a founder reads is the lifecycle's own, not one this page composed.
    assert.ok(steps[0] > previousStep,
      `station ${station.id} is out of canonical step order — the path order must be aegis-run's, not the page's`);
    previousStep = steps[0];
  }
  assert.strictEqual(new Set(named).size, named.length, 'a canonical run state is claimed by two stations');
  // ABANDONED is reachable from any station, so it is deliberately off-path and
  // must be reported as off-path rather than drawn as a step in the sequence.
  assert.deepStrictEqual(Object.keys(canonical).filter((state) => !named.includes(state)), ['ABANDONED'],
    'the path silently dropped or absorbed a canonical run state');
});

test('the handoff path reads around the AEGIS Core HUD and carries no motion of any kind', () => {
  const source = htmlSrc();
  const core = source.indexOf('class="strategic-core"');
  const stage = source.indexOf('class="core-stage"');
  const pathIdx = source.indexOf('id="core-path"');
  const legend = source.indexOf('class="core-legend"');
  assert.ok(core !== -1 && stage !== -1 && pathIdx !== -1 && legend !== -1,
    'the handoff path is not part of the AEGIS Core HUD');
  assert.ok(core < stage && stage < pathIdx && pathIdx < legend,
    'the handoff path must read around the AEGIS Core stage, ahead of the state legend');
  assert.strictEqual((source.match(/id="core-path-track"/g) || []).length, 1,
    'expected exactly one station track — a duplicated path would drift silently');
  const css = code.slice(code.indexOf('.core-path{'),
    code.indexOf('.evidence-deck{grid-template-columns:repeat(5'));
  assert.ok(css.length > 0 && css.length < 2400, 'the handoff path style block was not located');
  assert.ok(!/@keyframes/.test(css) && !/\banimation\s*:/.test(css), 'the handoff path must not animate');
  assert.ok(!/\btransition\s*:/.test(css),
    'the path repaints only when canonical state changes, so it must own no transition for reduced motion to undo');
  assert.ok(/\.core-path-handoff\[hidden\]\s*\{display:none/.test(code),
    'an unproven handoff line must actually disappear, not merely render empty');
});

test('the core path marks a station only from canonical run state and an already-proven handoff', () => {
  const fn = code.slice(code.indexOf('function renderCorePath'), code.indexOf('function reviewerEvidenceReady'));
  assert.ok(fn.length > 0, 'no renderCorePath() boundary found');
  assert.ok(!/observeHandoff\s*\(/.test(fn),
    'the path re-observes the run — a second observer could reach a second verdict about the same evidence');
  assert.ok(/proven\.runId\s*===\s*run\.runId/.test(fn),
    'a handoff proven for another run could still mark this path');
  assert.ok(/proven\.to\s*===\s*run\.state/.test(fn),
    'a stale handoff may not stay marked once the run has moved on');
  assert.ok(/NOT CURRENT/.test(fn),
    'an unmarked station must state its own status in words, never by colour alone');
  assert.ok(/handoffActor\(run\.state, run\)/.test(fn),
    'the current station names a holder from something other than the recorded model/tool identity');
  for (const banned of ['setInterval', 'setTimeout', 'requestAnimationFrame', 'Date.now', 'new Date',
    'Math.random', 'fetch(', 'innerHTML']) {
    assert.ok(!fn.includes(banned), `the path uses ${banned} — it may only re-read facts the deck already resolved`);
  }
  assert.ok(/var provenHandoff = renderHandoff\(host, boundRun, currentAction\);/.test(code) &&
    /renderCorePath\(boundRun, provenHandoff\);/.test(code),
    'the path is not driven by the single handoff the indicator proved');
});

// ── one data path, no seeds ─────────────────────────────────────────────────
test('the slice reads window.AEGIS_STATE and has no fallback seed object', () => {
  assert.ok(/window\.AEGIS_STATE/.test(code), 'must read the projector output');
  assert.ok(!/AEGIS_STATE\s*\|\|\s*\{/.test(code),
    'a `|| {}` fallback would let the page render confidently with no real state');
  assert.ok(/AEGIS_STATE\s*\|\|\s*null/.test(code), 'absence must resolve to null and be handled explicitly');
});

test('state.js is generated, never hand-authored', () => {
  const generated = generatedDashboardState();
  assert.ok(/Generated by builder-control\/aegis-state\.cjs/.test(generated.source),
    'state.js lacks its generator header');
  assert.ok(/do not edit by hand/i.test(generated.source));
  assert.deepStrictEqual(generated.state.contract.absences, ['UNAVAILABLE', 'STALE', 'UNVERIFIED']);
});

test('state.js loads BEFORE the renderer, or the renderer would always see nothing', () => {
  // Search the comment-stripped source. The file's own header comment mentions
  // window.AEGIS_STATE while explaining the rule, and matching that prose
  // instead of the executable read made this test fail on correct code.
  const stateTag = code.indexOf('<script src="state.js">');
  const renderer = code.indexOf('var S = window.AEGIS_STATE');
  assert.ok(stateTag !== -1, 'state.js is never loaded');
  assert.ok(renderer !== -1, 'the renderer no longer reads window.AEGIS_STATE');
  assert.ok(stateTag < renderer,
    `state.js (@${stateTag}) must load before the renderer reads it (@${renderer})`);
});

// ── no fabricated values ────────────────────────────────────────────────────
test('no hardcoded status word appears in the markup', () => {
  const body = html.slice(html.indexOf('<body'));
  const markup = body.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  for (const word of ['PASS', 'HEALTHY', 'VERIFIED', 'COMPLETE']) {
    assert.ok(!new RegExp('>\\s*' + word).test(markup),
      `the literal "${word}" appears in static markup — every status must come from state`);
  }
});

test('no fabricated progress, percentage, uptime or KPI vocabulary', () => {
  for (const banned of ['percentComplete', 'progressPercent', 'uptime', 'Math.random', 'toFixed(0) + \'%\'']) {
    assert.ok(!code.includes(banned), `"${banned}" found — the slice must not synthesise numbers`);
  }
  assert.ok(!/\b\d{1,3}%\s*<\//.test(html), 'a literal percentage is rendered in markup');
});

// ── the three honest absences are all reachable ─────────────────────────────
test('UNAVAILABLE, STALE and UNVERIFIED each have a rendering', () => {
  for (const s of ['UNAVAILABLE', 'STALE', 'UNVERIFIED']) {
    assert.ok(code.includes(s), `${s} has no rendering path`);
    assert.ok(new RegExp('\\.s-' + s + '\\b').test(code) || new RegExp('s-\\$\\{?').test(code),
      `${s} has no state style`);
  }
  assert.ok(/UNAVAILABLE — no AEGIS state is loaded/.test(code),
    'the no-state failure path must be explicit, not an empty page');
});

test('status is never colour-only — every chip carries a glyph and a label', () => {
  assert.ok(/GLYPH\s*=/.test(code), 'no glyph map');
  assert.ok(/c\.appendChild\(el\('span',null,state\)\)/.test(code),
    'the chip must append the state name as text, not rely on colour');
});

// ── 2D is the product ───────────────────────────────────────────────────────
test('no WebGL, no 3D library, no canvas — 2D is authoritative, not a fallback', () => {
  for (const banned of ['webgl', 'three.js', 'THREE.', '<canvas', 'getContext(']) {
    assert.ok(!code.toLowerCase().includes(banned.toLowerCase()),
      `"${banned}" found — the V1 slice must be fully operational without any 3D layer`);
  }
});

// Amended for the switchboard (PKT-20260825-SWITCHBOARD-FOUNDATION): the page
// is now an authenticated control surface, not a file:// static view, and
// legitimately calls same-origin /api/* over fetch()/EventSource. The
// invariant that must never regress is "no CDN, no remote font, no absolute
// URL" — every request stays same-origin and relative.
test('zero external requests: no CDN, no remote font, no absolute URL', () => {
  assert.ok(!/https?:\/\//.test(code.replace(/xmlns="[^"]*"/g, '')),
    'an absolute URL is referenced — this must remain a same-origin control surface');
  for (const m of code.matchAll(/\bfetch\s*\(\s*(['"])([^'"]*)\1/g)) {
    assert.ok(m[2].startsWith('/'), `fetch() must target a same-origin relative path, got: ${m[2]}`);
  }
  for (const m of code.matchAll(/new EventSource\(\s*(['"])([^'"]*)\1/g)) {
    assert.ok(m[2].startsWith('/'), `EventSource must target a same-origin relative path, got: ${m[2]}`);
  }
});

// ── accessibility invariants ────────────────────────────────────────────────
test('keyboard and assistive-tech affordances are present', () => {
  assert.ok(/aria-live="polite"/.test(html), 'no live region');
  assert.ok(/aria-label/.test(code), 'stages carry no accessible label');
  assert.ok(/:focus-visible/.test(code), 'no visible focus style');
  assert.ok(/Escape/.test(code), 'no keyboard dismiss');
  assert.ok(/ArrowDown/.test(code) && /ArrowUp/.test(code), 'no arrow-key traversal along the path');
  assert.ok(/class="sr"[^>]*href="#topology"/.test(html), 'no skip link');
});

test('route cards explicitly activate on Enter and Space', () => {
  assert.ok(/node\.addEventListener\('keydown',[\s\S]{0,240}ev\.key === 'Enter'[\s\S]{0,120}ev\.key === ' '/.test(code),
    'the live route cards do not explicitly support both Enter and Space');
});

test('every state colour token clears 3:1 on the panel background', () => {
  const vars = {};
  const rootBlock = code.slice(code.indexOf(':root{'), code.indexOf('}', code.indexOf(':root{')));
  for (const m of rootBlock.matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{6})/g)) vars[m[1]] = m[2];
  const lum = (h) => {
    const c = h.slice(1).match(/../g).map((x) => {
      const v = parseInt(x, 16) / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); const hi = Math.max(l1, l2), lo = Math.min(l1, l2); return (hi + 0.05) / (lo + 0.05); };
  const bg = vars['--bg-1'];
  assert.ok(bg, 'no --bg-1 token');
  for (const t of ['--pass', '--active', '--warn', '--fail', '--blocked', '--stale', '--unknown', '--text-0', '--text-1']) {
    assert.ok(vars[t], `token ${t} missing`);
    const r = ratio(vars[t], bg);
    assert.ok(r >= 3, `${t} (${vars[t]}) is ${r.toFixed(2)}:1 on ${bg} — below the 3:1 this design requires`);
  }
});

// ── VISUAL INTEGRATION RED PROOFS ─────────────────────────────────────────
test('RED: the page renders ELEVEN steps and numbers them', () => {
  const state = generatedDashboardState().state;
  assert.strictEqual(state.engineering.stages.length, 11,
    'the projection the page reads must carry exactly 11 steps');
  assert.ok(/st\.step/.test(htmlSrc()), 'the page must render the contract step number');
  assert.ok(/stepno/.test(htmlSrc()), 'step numbers need their own style hook');
});

test('RED: exactly ONE topology list exists — no duplicated view', () => {
  // A duplicated topology is the classic full-page-duplication bug: two lists
  // render, both look plausible, and they drift apart silently.
  const listIds = (htmlSrc().match(/id="stages"/g) || []).length;
  assert.strictEqual(listIds, 1, `expected one stage list, found ${listIds}`);
  const topo = (htmlSrc().match(/id="topology"/g) || []).length;
  assert.strictEqual(topo, 1, `expected one topology section, found ${topo}`);
  const bodies = (htmlSrc().match(/<body/g) || []).length;
  assert.ok(bodies <= 1, 'more than one body element would duplicate the whole page');
});

test('RED: the page renders SPEND and never a bare zero for unrecorded cost', () => {
  assert.ok(/id="cost"/.test(htmlSrc()), 'a spend panel must exist');
  assert.ok(/S\.cost/.test(htmlSrc()), 'the page must read the cost projection');
  assert.ok(/UNRECORDED/.test(htmlSrc()), 'the page must be able to say UNRECORDED');
  assert.ok(/AT LEAST|totalUsd/.test(htmlSrc()), 'the headline total must be able to say AT LEAST');
  // A hardcoded currency figure would be a fabricated KPI.
  const hardcoded = htmlSrc().match(/USD\s+\d+\.\d+/g) || [];
  assert.deepStrictEqual(hardcoded, [], `hardcoded currency in the page: ${hardcoded.join(', ')}`);
});

test('RED: no external requests, still', () => {
  const ext = htmlSrc().match(/(?:src|href)\s*=\s*["']https?:\/\//g) || [];
  assert.deepStrictEqual(ext, [], 'the page must make zero external requests');
});

test('RED: responsive rules cover narrow and large widths', () => {
  const queries = htmlSrc().match(/@media[^{]+/g) || [];
  assert.ok(queries.length >= 2, `expected responsive breakpoints, found ${queries.length}`);
  assert.ok(/prefers-reduced-motion/.test(htmlSrc()), 'reduced motion must be honoured');
});

test('RED: every rendered stage carries provenance and a reason', () => {
  const state = generatedDashboardState().state;
  for (const st of state.engineering.stages) {
    assert.ok(st.evidence, `step ${st.step} has no evidence source`);
    assert.ok(st.reason, `step ${st.step} has no reason`);
    assert.ok(!/^PASS$/.test(st.state) || st.reason.length > 10,
      `step ${st.step} claims PASS with no substantive reason`);
  }
});

// ── CORRECTION CYCLE 1 (PKT-20260825-GOVERNANCE-TRUTH) — founder readability ─
test('a primary founder summary exists with what/now/why/next, ahead of the raw state', () => {
  const founderIdx = htmlSrc().indexOf('id="founder-summary"');
  const rawIdx = htmlSrc().indexOf('id="raw-state"');
  assert.ok(founderIdx !== -1, 'no founder-summary section exists');
  assert.ok(rawIdx !== -1, 'no raw-state details wrapper exists');
  assert.ok(founderIdx < rawIdx, 'the founder summary must read before the raw machine state, not after');
  assert.ok(/What was requested/.test(code), 'no "what was requested" field');
  assert.ok(/What is happening now/.test(code), 'no "what is happening now" field');
  assert.ok(/Why blocked/.test(code), 'no "why blocked" field');
  assert.ok(/Next action/.test(code), 'no "next action" field');
});

test('the first-screen shell has objective, topology, inspector and evidence regions in that order of importance', () => {
  const source = htmlSrc();
  for (const cls of ['command-shell', 'left-rail', 'center-console', 'right-rail', 'evidence-deck']) {
    assert.ok(new RegExp('class="[^"]*\\b' + cls + '\\b').test(source), `missing ${cls} region`);
  }
  assert.ok(source.indexOf('id="founder-summary"') < source.indexOf('id="topology-overview"'),
    'the objective rail must precede the central topology in source order');
  assert.ok(source.indexOf('id="topology-overview"') < source.indexOf('id="inspector"'),
    'the live topology must precede the drill-down inspector');
  assert.ok(source.indexOf('class="evidence-deck"') < source.indexOf('id="raw-state"'),
    'deep machine state must live inside the bottom evidence deck');
});

test('the founder-readable two-column layout starts at 1599px so 1440px route labels remain legible', () => {
  assert.ok(/@media\s*\(max-width:1599px\)/.test(code),
    'the two-column command layout does not cover ordinary 1440px desktops');
  assert.ok(!/@media\s*\(max-width:1399px\)/.test(code),
    'the obsolete 1399px breakpoint leaves the center route too narrow at 1440px');
  const breakpoint = code.slice(code.lastIndexOf('@media (max-width:1599px)'),
    code.indexOf('@media (max-width:1050px)'));
  assert.ok(/\.command-shell\s*\{[^}]*grid-template-columns:\s*300px\s+minmax\(600px,1fr\)[^}]*grid-template-areas:\s*"left center"\s*"right right"\s*"evidence evidence"[^}]*\}/s.test(breakpoint),
    'the 1599px Command View must pair its two explicit columns with two-cell area rows; a third area cell creates an implicit column');
  const compact = code.slice(code.indexOf('@media (max-width:1050px)'),
    code.indexOf('@media (max-width:680px)'));
  assert.ok(/\.command-shell\s*\{[^}]*grid-template-columns:\s*1fr[^}]*grid-template-areas:\s*"left"\s*"center"\s*"right"\s*"evidence"[^}]*\}/s.test(compact),
    'the 1050px founder-first single-column stack must remain left, center, right, evidence');
});

test('the objective composer is visible on first paint while run history stays collapsed', () => {
  const source = htmlSrc();
  assert.ok(/<section[^>]*id="objective-composer"/.test(source) && /aria-labelledby="intake-h"/.test(source),
    'objective intake must be a visible first-screen section, not hidden in history');
  assert.ok(!/<details[^>]*aria-labelledby="intake-h"/.test(source),
    'objective intake regressed into a collapsed disclosure');
  assert.ok(/<details(?![^>]*\bopen\b)[^>]*aria-labelledby="runs-h"/.test(source),
    'run history must stay collapsed until the operator asks for it');
  assert.ok(/id="intake-form"/.test(source), 'visible intake lost its working form');
  assert.ok(/id="btn-submit-objective"/.test(source), 'visible intake lost its record action');
  assert.ok(/id="runs-list"/.test(source), 'collapsed history lost its live run surface');
});

test('the first-screen composer keeps the objective and action visible while optional controls stay compact', () => {
  const source = htmlSrc();
  const composerStart = source.indexOf('id="objective-composer"');
  const composerEnd = source.indexOf('</section>', composerStart);
  const composer = source.slice(composerStart, composerEnd);
  const options = composer.match(/<details(?![^>]*\bopen\b)[^>]*class="composer-options"[\s\S]*?<\/details>/);
  assert.ok(options, 'optional project, constraint and acceptance fields must be collapsed by default');
  assert.ok(composer.indexOf('id="in-objective"') < composer.indexOf('class="composer-options"'),
    'the required objective must remain visible ahead of optional fields');
  assert.ok(composer.indexOf('id="btn-submit-objective"') > composer.indexOf('class="composer-options"'),
    'the governed start action must remain visible outside the optional disclosure');
  for (const id of ['in-project', 'in-constraints', 'in-acceptance', 'in-dataclass']) {
    assert.ok(options[0].includes(`id="${id}"`), `optional control ${id} was removed instead of compacted`);
  }
});

test('the primary topology is one connected operator route and connector cards clamp prose without dropping evidence', () => {
  const source = htmlSrc();
  assert.ok(/#topology-live-body\s+\.route-strip\s*\{[^}]*repeat\(11,minmax\(68px,1fr\)\)/.test(code),
    'the wide-screen primary route must render the eleven exact stages as one connected row');
  assert.ok(/\.route-node::after\s*\{[^}]*background:#31536b/.test(code),
    'the exact stage route lost its visible connector line');
  assert.ok(/\.usage-summary\s*\{[^}]*-webkit-line-clamp:3[^}]*overflow:hidden/.test(code),
    'dense connector usage prose is not visually clamped in the summary card');
  assert.ok(/el\('div','meta usage-summary',usage\.text\)/.test(source),
    'the connector card no longer retains the complete truthful usage sentence in the DOM');
  assert.ok(/kv\('Last used by a run',[\s\S]{0,180}usageMessage/.test(source),
    'the inspector must retain full connector usage drill-down evidence');
});

test('the JARVIS shell adds no decorative microphone, fabricated animation control, gradient or CSS-art mark', () => {
  const markup = htmlSrc().replace(/<script[\s\S]*?<\/script>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  assert.ok(!/aria-label="[^"]*microphone/i.test(markup), 'a nonfunctional microphone was added');
  assert.ok(!/<canvas\b/i.test(markup), 'decorative canvas activity is forbidden');
  assert.ok(!/\b(?:repeating-)?(?:linear|radial)-gradient\s*\(/i.test(code), 'decorative gradient found');
  assert.ok(!/clip-path\s*:/i.test(code), 'CSS-art clip path found');
  assert.ok(!/class="brand-mark"/.test(markup), 'CSS-art brand mark found');
});

test('Ask AEGIS is a bounded contextual explainer, not the primary build mechanism or a fake chat backend', () => {
  const source = htmlSrc();
  const composer = source.indexOf('id="objective-composer"');
  const topology = source.indexOf('id="topology-overview"');
  const ask = source.indexOf('id="ask-aegis"');
  const evidence = source.indexOf('class="evidence-deck"');
  assert.ok(composer !== -1 && topology !== -1 && ask !== -1 && evidence !== -1, 'operator hierarchy region missing');
  assert.ok(composer < topology && topology < ask && ask < evidence,
    'objective, topology, contextual explainer and evidence are not in operator order');
  const questions = source.match(/data-aegis-question="(?:explain|summarize|next)"/g) || [];
  assert.strictEqual(questions.length, 3, 'Ask AEGIS must expose exactly three bounded questions');
  assert.ok(!/<textarea[^>]*(?:ask-aegis|command)/i.test(source), 'Ask AEGIS must not masquerade as free-form chat');
  assert.ok(/This does not launch a model or modify the build/.test(source), 'local-only boundary is not stated');
  assert.ok(/operatorAnswer:\s*operatorAnswer/.test(code), 'contextual answer helper is not exported');
  const renderer = code.slice(code.indexOf('function renderAskAnswer'), code.indexOf('var intakeRunId'));
  assert.ok(!/\bfetch\s*\(/.test(renderer), 'Ask AEGIS invented a backend request');
});

test('the raw machine state (topology, connectors, knowledge, reviewers) sits inside a <details>, collapsed by default', () => {
  const html = htmlSrc();
  const detailsOpen = html.indexOf('<details id="raw-state">');
  const detailsClose = html.indexOf('</details>', detailsOpen);
  assert.ok(detailsOpen !== -1 && detailsClose !== -1, 'raw-state <details> not found');
  assert.ok(!/<details[^>]*id="raw-state"[^>]*\bopen\b/.test(html), 'raw-state must not force itself open — it is advanced detail, not the primary view');
  const inner = html.slice(detailsOpen, detailsClose);
  for (const id of ['id="topology"', 'id="conn-h"', 'id="know-h"', 'id="rev-h"']) {
    assert.ok(inner.includes(id), `${id} must be inside the raw-state details, not a duplicate copy outside it`);
  }
});

test('previous runs are collapsed into a <details> inside the founder summary', () => {
  assert.ok(/Previous runs/.test(code), 'no collapsed "previous runs" affordance');
});

test('the primary pilot deck exposes mission, crew, action, elapsed, next step, blocker and checkpoint', () => {
  for (const label of ['CREW / MODEL', 'CURRENT ACTION', 'ELAPSED', 'NEXT STEP', 'BLOCKER', 'LAST SAFE CHECKPOINT']) {
    assert.ok(new RegExp("commandCard\\('" + label).test(code), `operator deck is missing ${label}`);
  }
  assert.ok(/missionText\.appendChild\(el\('h3','mission-title',missionHeadlineText\)\)/.test(code),
    'the current mission is not presented through the bounded pilot headline');
  assert.ok(/Build sequence/.test(code), 'no founder-facing build sequence exists');
  assert.ok(/routeCrew\.appendChild\(el\('span','command-label','Crew \/ model'\)\)/.test(code),
    'the visual route does not identify its selected crew or model');
  assert.ok(/Evidence, reviewer coverage & run history/.test(code),
    'dense evidence is not available behind a founder-readable disclosure');
});

test('ordinary laptop Command View keeps pilot instruments ahead of elapsed detail and exposes the full objective', () => {
  const breakpoint = code.slice(code.lastIndexOf('@media (max-width:1599px)'),
    code.indexOf('@media (max-width:1050px)'));
  assert.ok(/#founder-summary\s+\.mission-title\s*\{[^}]*-webkit-line-clamp:2[^}]*overflow:hidden/s.test(breakpoint),
    'the exact objective can still consume the entire 1280px first viewport');
  assert.ok(/#founder-summary\s+\.mission-head\s*\{[^}]*padding-bottom:8px/s.test(breakpoint) &&
    /#founder-summary\s+\.mission-meta\s*\{[^}]*font-size:11px[^}]*line-height:1\.4/s.test(breakpoint) &&
    /#founder-summary\s+\.command-grid\s*\{[^}]*gap:5px[^}]*margin-top:8px/s.test(breakpoint),
    'the ordinary-laptop rail no longer reserves enough vertical room for the checkpoint value');
  assert.ok(/objectiveDetail\.appendChild\(el\('summary',null,'View full objective'\)\)/.test(code) &&
    /objectiveDetail\.appendChild\(el\('p','mission-objective-full',deckObjective\)\)/.test(code),
    'the compact mission title does not retain an accessible exact full objective');
  const gridStart = code.indexOf("commandGrid.appendChild(commandCard('CREW / MODEL'");
  const gridEnd = code.indexOf('deckDetails.appendChild(commandGrid)', gridStart);
  const grid = code.slice(gridStart, gridEnd);
  const next = grid.indexOf("commandCard('NEXT STEP'");
  const blocker = grid.indexOf("commandCard('BLOCKER'");
  const checkpoint = grid.indexOf("commandCard('LAST SAFE CHECKPOINT'");
  const elapsed = grid.indexOf("commandCard('ELAPSED'");
  assert.ok(next !== -1 && blocker > next && checkpoint > blocker && elapsed > checkpoint,
    'elapsed detail again displaced next, blocker or checkpoint from the pilot-first reading order');
});

test('the primary BLOCKER card summarizes gate count instead of dumping raw governance transcripts', () => {
  const start = code.indexOf('// The first screen is a pilot deck');
  const end = code.indexOf('deckDetails.appendChild(commandGrid)', start);
  const primaryDeck = code.slice(start, end);
  assert.ok(/unresolved gate requirement/.test(code), 'BLOCKER has no founder-readable count summary');
  assert.ok(/Open Evidence, reviewer coverage & run history/.test(code), 'BLOCKER does not route exact detail to evidence');
  assert.ok(!/e\.problems\.map\(function\(p\)\{ return p\.detail; \}\)\.join/.test(primaryDeck),
    'raw blocker details are still concatenated into the primary operator deck');
});

test('technical identity, connector detail and spend are demoted below the pilot instruments', () => {
  const source = htmlSrc();
  const pilot = source.indexOf('id="founder-summary"');
  const rawOpen = source.indexOf('<details id="raw-state">');
  const rawClose = source.indexOf('</details>', rawOpen);
  assert.ok(pilot !== -1 && rawOpen > pilot && rawClose > rawOpen, 'pilot and technical drilldown hierarchy is missing');
  assert.ok(source.slice(rawOpen, rawClose).includes('id="ctx-subject"'),
    'the subject hash escaped the technical evidence drilldown');
  assert.ok(/<details class="panel"[^>]*aria-labelledby="integration-h"/.test(source),
    'connector implementation detail must be collapsed by default');
  assert.ok(/<details class="panel"[^>]*aria-labelledby="cost-h"/.test(source),
    'spend telemetry must be collapsed below the primary instruments');
  assert.ok(!/<details class="panel"[^>]*aria-labelledby="integration-h"[^>]*\bopen\b/.test(source),
    'connector detail must not occupy the first-screen operator surface');
});

test('the operator deck never treats authentication as connector usage', () => {
  const start = code.indexOf("var truth = el('div','truth-grid')");
  const end = code.indexOf('visibleHost = host', start);
  const deck = code.slice(start, end);
  assert.ok(/usageMessage\(c\.lastUsedByRun/.test(deck),
    'connector activity must be derived from lastUsedByRun evidence');
  assert.ok(/Authenticated is not the same as used/.test(code),
    'the distinction between connectivity and use is not stated');
  assert.ok(!/authStatus\s*===\s*['"]AUTHENTICATED['"]\s*\?\s*['"]ACTIVE/.test(deck),
    'authentication is being promoted to active use');
});

test('connector usage is driven by lastUsedByRun, and the two untruthful phrases are gone', () => {
  // These two phrases were the defect (CONFIRMED FINDING #10), not the fix:
  // "Not used for this run" asserted a negative the projector never proved, and
  // "Consulted for this run" claimed a current-run match that was never checked.
  assert.ok(!/Not used for this run/.test(code), 'the unprovable negative "Not used for this run" is back in the page');
  assert.ok(!/Consulted for this run/.test(code), 'the unchecked claim "Consulted for this run" is back in the page');
  assert.ok(/usageMessage\s*\(/.test(code), 'no usageMessage() renderer for connector usage');
  const fn = code.slice(code.indexOf('function usageMessage'), code.indexOf('function usageMessage') + 2000);
  assert.ok(/used\.runId\s*===\s*curRunId/.test(fn),
    '"for this run" must be gated on an exact runId match, not on the presence of a usage record');
  assert.ok(/c\.lastUsedByRun/.test(code), 'connector usage text is not reading lastUsedByRun');
});

test('the inspector renders authentication, lastVerified and lastUsedByRun as three separate lines', () => {
  assert.ok(/connector\.authentication/.test(code), 'inspector does not render the resolved authentication fact');
  assert.ok(/connector\.lastVerified/.test(code), 'inspector does not render the resolved lastVerified fact');
  assert.ok(/connector\.lastUsedByRun/.test(code), 'inspector does not render the resolved lastUsedByRun fact');
});

test('the Pause action is disabled, not merely titled — there is no active build process to suspend', () => {
  const idx = code.indexOf("el('button', 'action', 'Pause')");
  assert.ok(idx !== -1, 'no Pause button found');
  const nearby = code.slice(idx, idx + 400);
  assert.ok(/pauseBtn\.disabled\s*=\s*true/.test(nearby), 'Pause must be disabled — it is unavailable for every run today');
});

test('every rendered field still goes through textContent/DOM APIs — no innerHTML of untrusted data', () => {
  assert.ok(!/\.innerHTML\s*=/.test(code), 'innerHTML assignment found — every field here is untrusted input from state or the API');
});

test('RED: dashboard executable code never reads raw worker output fields', () => {
  const workerRenderer = code.slice(code.indexOf('function buildEvidence'), code.indexOf('function runActionRow'));
  assert.ok(workerRenderer.length > 0, 'worker evidence renderer source boundary was not found');
  for (const field of ['stdoutTail', 'stderrTail', 'rawOutput', 'modelOutput', 'transcript']) {
    assert.ok(!new RegExp('\\b' + field + '\\b').test(workerRenderer),
      `dashboard executable code reads forbidden raw-output field ${field}`);
  }
  assert.ok(!/Safe bounded output tails|Standard output|Error output/.test(workerRenderer),
    'dashboard still advertises raw worker streams as safe evidence');
});

// ── operational status strip (PKT-20260826-ASYNC-WORKER-OPERATOR-BETA) ─────
// The failure guarded here is a first screen that stays calm while the build
// is dying: five operational answers have to be readable above the fold — run
// state, real progress versus heartbeat-only liveness, watchdog or timeout,
// recorded CAD, and last safe checkpoint — each in words and shape, none of
// them produced by a clock, a poll, or a second reading of the run.
test('the operational status strip sits beneath the header, ahead of the operator shell', () => {
  const source = htmlSrc();
  const header = source.indexOf('</header>');
  const strip = source.indexOf('id="ops-strip"');
  const shell = source.indexOf('id="operator-shell"');
  assert.ok(strip !== -1, 'no operational status strip exists on the first screen');
  assert.ok(header !== -1 && header < strip && strip < shell,
    'the strip must render beneath the header and ahead of the operator shell');
  assert.ok(/id="ops-strip-cells"/.test(source), 'the strip has no repaint target');
  assert.strictEqual((source.match(/id="ops-strip-cells"/g) || []).length, 1,
    'a second strip host would let two copies of the same five facts drift apart');
  const markup = source.slice(strip, source.indexOf('</section>', strip));
  for (const word of ['PASS', 'HEALTHY', 'VERIFIED', 'COMPLETE', 'RUNNING', 'IDLE', 'RECORDED']) {
    assert.ok(!new RegExp('>\\s*' + word).test(markup),
      `the strip ships the literal status word ${word} in static markup`);
  }
});

test('the status strip is compact and motion-free, and its state is never colour alone', () => {
  assert.ok(/\.ops-strip-cells\{[^}]*display:grid[^}]*repeat\(5,minmax\(0,1fr\)\)/.test(code),
    'the five operational answers are not laid out as one compact band');
  const strip = code.slice(code.indexOf('.ops-strip{'), code.indexOf('.command-shell{display:grid'));
  assert.ok(strip.length > 0, 'the strip stylesheet block was not located');
  assert.ok(!/\banimation\s*:/.test(strip) && !/\btransition\s*:/.test(strip),
    'the strip animates or transitions — it is an instrument, not decoration');
  assert.ok(/-webkit-line-clamp/.test(strip),
    'the strip does not clamp its prose, so a long canonical sentence would consume the first screen');
  // Colour is emphasis only: the renderer writes the canonical word and a glyph
  // into every cell, and each new supervision token has its own state style.
  for (const token of ['PROGRESS_RECORDED', 'PROGRESS_UNRECORDED', 'TIMED_OUT', 'NOT_RUNNING', 'RECORDED']) {
    assert.ok(new RegExp('\\.s-' + token + '\\b').test(code), `${token} has no state style`);
    assert.ok(new RegExp('\\b' + token + ':').test(code.slice(code.indexOf('var GLYPH'), code.indexOf('function el('))),
      `${token} has no glyph, so that cell would be legible by colour alone`);
  }
  for (const width of ['1599', '1050', '680']) {
    const start = code.lastIndexOf('@media (max-width:' + width + 'px)');
    assert.ok(start !== -1, `the ${width}px breakpoint is missing`);
    const block = code.slice(start, code.indexOf('\n  }', start));
    assert.ok(/\.ops-strip-cells\{grid-template-columns:/.test(block),
      `the strip keeps five columns at ${width}px, where they cannot stay legible`);
  }
});

test('the strip restates existing resolutions and owns no clock, threshold or second authority', () => {
  const fn = code.slice(code.indexOf('function opsStripCells'), code.indexOf('function renderOpsStrip'));
  assert.ok(fn.length > 0, 'no opsStripCells() boundary found');
  for (const banned of ['setInterval', 'setTimeout', 'requestAnimationFrame', 'Date.now', 'new Date',
    'Math.random', 'fetch(', 'innerHTML', 'AEGIS_STATE']) {
    assert.ok(!fn.includes(banned), `the strip uses ${banned} — it may only restate resolved facts`);
  }
  // It is handed resolutions, never raw records: reaching into a run, a view or
  // a projection here would be a sixth verdict about the same build.
  for (const raw of ['run.', 'view.', 'binding', 'engineering', 'lastProgressAt', 'noProgressLimitSec',
    'totalUsd', 'rollbackPoint', 'stdoutTail']) {
    assert.ok(!fn.includes(raw), `the strip reads the raw field ${raw} instead of an existing resolution`);
  }
  assert.strictEqual((code.match(/function opsStripCells/g) || []).length, 1,
    'the strip was resolved by more than one function');
  assert.strictEqual((code.match(/renderOpsStrip\(/g) || []).length, 2,
    'the strip is painted from more than one place, or never painted at all');
  assert.ok(/renderOpsStrip\(opsStripCells\(controlState, supervision,\s*evidenceCostPanel\(view && view\.cost\),\s*evidenceCheckpointPanel\(boundRun, safeCheckpoint\)\)\)/.test(code),
    'the strip is not fed by the deck\'s own control-plane, supervision, CAD cost and checkpoint resolutions');
  // Detail View keeps the deeper evidence: the strip did not take the rail's
  // panels away, and the rail still resolves them through the same renderers.
  assert.ok(/evidenceCostPanel\(view && view\.cost\),\s*evidenceCheckpointPanel\(ctx\.run, ctx\.checkpointText\)/.test(code),
    'the Detail View evidence rail lost its own CAD cost and checkpoint panels');
});

// ── bound-run identity line (PKT-20260826-ASYNC-WORKER-OPERATOR-BETA) ──────
// The failure the five cells above cannot catch: they answer what is happening
// without ever naming the run it is happening to. An older failed or finished
// run that canonical binding still points at therefore reads as live work, and
// the operator has no way to tell which run the whole page is describing. The
// line that fixes that has to name the bound run and its recorded state, stay a
// pure re-read of resolutions the deck already made, fail closed when no run is
// bound, and wrap rather than drag a narrow layout sideways.
test('the bound-run identity line names the current run ahead of the five operational cells', () => {
  const source = htmlSrc();
  const strip = source.indexOf('id="ops-strip"');
  const identity = source.indexOf('id="ops-strip-run"');
  assert.ok(identity !== -1, 'the operational strip never names which run it is describing');
  assert.strictEqual((source.match(/id="ops-strip-run"/g) || []).length, 1,
    'a second identity host would let two copies of the page name different current runs');
  assert.ok(strip !== -1 && strip < identity && identity < source.indexOf('id="ops-strip-cells"'),
    'the run identity must be read inside the strip, ahead of the five cells it labels');
  const markup = source.slice(identity, source.indexOf('</div>', identity));
  for (const word of ['PASS', 'HEALTHY', 'VERIFIED', 'COMPLETE', 'RUNNING', 'IDLE', 'RECORDED', 'UNAVAILABLE']) {
    assert.ok(!new RegExp('>\\s*' + word).test(markup),
      `the identity line ships the literal status word ${word} in static markup`);
  }
});

// The gap the first packet left: the provenance line was inside the mission
// brief, below the operational strip, so the top CURRENT RUN was still read
// before the sentence saying it might be saved evidence. There is still exactly
// ONE of these — a second banner would be a second authority on where the page
// got its evidence.
test('the one provenance line is read before every run fact on the page', () => {
  const source = htmlSrc();
  const prov = source.indexOf('id="state-provenance"');
  assert.ok(prov !== -1, 'the page never says where its evidence came from');
  assert.strictEqual((source.match(/id="state-provenance"/g) || []).length, 1,
    'a second provenance banner would let two lines disagree about the same evidence');
  assert.ok(source.indexOf('id="ops-strip-h"') < prov && prov < source.indexOf('id="ops-strip-run"'),
    'provenance is not read under the operational heading ahead of the run it labels');
  assert.ok(prov < source.indexOf('id="founder-summary"'),
    'the mission brief is read before the sentence saying whether it is confirmed current work');
});

test('the identity line wraps at every width and is never clamped, hidden or animated', () => {
  const rules = [];
  for (const rule of code.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (/\.ops-run\b/.test(rule[1])) rules.push({ selectors: rule[1].trim(), body: rule[2] });
  }
  assert.ok(rules.length > 0, 'the identity line has no shipped layout of its own');
  for (const rule of rules) {
    assert.ok(!/display:none/.test(rule.body),
      `${rule.selectors} hides the line that says which run is on screen`);
    assert.ok(!/-webkit-line-clamp/.test(rule.body),
      `${rule.selectors} clamps the sentence that separates a recorded run from live work`);
    assert.ok(!/\banimation\s*:/.test(rule.body) && !/(?:^|;)transition:(?!none)/.test(rule.body),
      `${rule.selectors} animates the identity line — it is an instrument, not decoration`);
  }
  // A canonical run id is long enough to push a narrow layout sideways on its
  // own, so both the row and every dense value inside it must wrap.
  const strip = code.slice(code.indexOf('.ops-strip{'), code.indexOf('.command-shell{display:grid'));
  assert.ok(/\.ops-run-line\{display:flex;flex-wrap:wrap/.test(strip),
    'the identity row cannot wrap, so a long run id overflows horizontally');
  for (const selector of ['.ops-run-id', '.ops-run-canonical', '.ops-run-why']) {
    assert.ok(new RegExp('\\' + selector + '\\{[^}]*overflow-wrap:anywhere').test(strip),
      `${selector} does not wrap, so it can overflow a wide or mobile layout`);
  }
});

test('the identity line restates existing resolutions and cannot name a run the binding did not', () => {
  const fn = code.slice(code.indexOf('function boundRunIdentity'), code.indexOf('function renderOpsRun'));
  assert.ok(fn.length > 0, 'no boundRunIdentity() boundary found');
  for (const banned of ['setInterval', 'setTimeout', 'requestAnimationFrame', 'Date.now', 'new Date',
    'Math.random', 'fetch(', 'innerHTML', 'AEGIS_STATE', 'filter(', 'sort(', 'updatedAt']) {
    assert.ok(!fn.includes(banned),
      `the identity line uses ${banned} — it may only restate facts the deck already resolved`);
  }
  assert.strictEqual((code.match(/function boundRunIdentity/g) || []).length, 1,
    'the run identity was resolved by more than one function');
  assert.strictEqual((code.match(/renderOpsRun\(/g) || []).length, 2,
    'the identity line is painted from more than one place, or never painted at all');
  assert.ok(/renderOpsRun\(boundRunIdentity\(bind, boundRun, controlState, opState, deckFinished\)\)/.test(code),
    'the identity line is not fed by the deck\'s own binding, run, control-plane, lifecycle and finished resolutions');
  // Selection authority is unchanged: only a positively BOUND binding whose
  // runId matches an actual canonical run record may name a run here.
  assert.ok(/binding\.state !== 'BOUND'/.test(fn) && /!binding\.runId/.test(fn) &&
    /run\.runId !== binding\.runId/.test(fn),
    'the identity line accepts something weaker than an exact canonical binding');
  assert.ok(/lifecycle\.state === 'RUNNING'/.test(fn),
    'live work is claimed from something other than the existing lifecycle resolution');
  // Build activity and gate readiness stay two readings of two existing
  // resolutions: the lifecycle answers the worker, the control plane answers
  // the gate, and neither is recomputed here.
  assert.ok(/build: buildState/.test(fn) && /buildState = typeof lifecycle\.state/.test(fn),
    'the build reading is not taken from the existing lifecycle resolution');
  assert.ok(/state: control\.state/.test(fn),
    'the gate reading is no longer the existing control-plane resolution');
  assert.ok(/buildState === 'UNVERIFIED'/.test(fn),
    'an unverified lifecycle can still be restated as a finished, checked build');
  const renderer = code.slice(code.indexOf('function renderOpsRun'), code.indexOf('function renderFounderSummary'));
  assert.ok(/'BUILD ACTIVITY'/.test(renderer) && /'GATE READINESS'/.test(renderer),
    'the identity line does not label which state belongs to the worker and which to the gate');
  // Both readings are still painted, and both are painted through the ONE
  // shipped label seam — the same opsChip/opsChipLabel pair the five cells
  // beneath already use, so the row cannot grow a second wording authority.
  assert.ok(/opsChip\(identity\.build, opsChipLabel\('run-state', identity\.build\)\)/.test(renderer) &&
    /opsChip\(identity\.state, opsChipLabel\('run-state', identity\.state\)\)/.test(renderer),
    'the identity line no longer paints both the build and the gate reading through the one label seam');
  assert.ok(/opsChipLabel\('run-lifecycle', identity\.canonical\)/.test(renderer),
    'the lifecycle reading is not translated by the one shipped label seam');
  assert.ok(/canonicalNode\.setAttribute\('data-ops-run-code', identity\.canonical\)/.test(renderer) &&
    /canonicalNode\.setAttribute\('title','Canonical run state code: ' \+ identity\.canonical\)/.test(renderer),
    'the plain lifecycle word was written without keeping its exact canonical code on the same node');
});

// ── one label seam, and the exact codes survive it ──────────────────────────
// The failure guarded here is a first screen that leads with BUILD_FAILED,
// CHECKS_PASSED or REVIEW_BOUND — machine vocabulary the owner has to decode —
// and the opposite failure, a page so friendly that the exact canonical code an
// auditor needs is gone. Both are prevented the same way: ONE closed map, no
// second dictionary, and the token preserved everywhere it already appeared.
test('the plain-English state words come from one shipped dictionary and invent no state', () => {
  assert.strictEqual((code.match(/var OPS_CHIP_PLAIN\s*=/g) || []).length, 1,
    'a second plain-language state dictionary appeared, so two surfaces can word one state differently');
  assert.strictEqual((code.match(/function opsChipLabel\(/g) || []).length, 1,
    'the label seam has more than one translation authority');
  const seam = code.slice(code.indexOf('var OPS_CHIP_PLAIN'), code.indexOf('function opsChip('));
  assert.ok(seam.length > 0, 'no OPS_CHIP_PLAIN seam boundary found');
  // A closed map: an unnamed token stays visibly unknown WITH its exact code,
  // and an inherited member can never render as a state word.
  assert.ok(/'Unknown state ' \+ token/.test(seam),
    'an unmapped token no longer keeps its exact code in the label the operator reads');
  assert.ok(/Object\.prototype\.hasOwnProperty\.call\(known, token\)/.test(seam),
    'the label seam resolves tokens by plain member lookup, so an inherited member can render as a state');
  // The lifecycle group names every state aegis-run declares and nothing else:
  // the page may not invent a lifecycle stage or quietly drop one.
  const group = /'run-lifecycle': \{([\s\S]*?)\},\n/.exec(seam);
  assert.ok(group, 'the canonical lifecycle vocabulary has no entry in the shipped label seam');
  const mapped = [...group[1].matchAll(/\b([A-Z_]+):\s*'/g)].map((match) => match[1]);
  const canonical = Object.keys(canonicalRunStates());
  for (const state of canonical) {
    assert.ok(mapped.includes(state),
      `${state} is a canonical aegis-run state with no plain word, so the first screen would print the token`);
  }
  for (const state of mapped) {
    assert.ok(canonical.includes(state) || state === 'UNAVAILABLE',
      `the label seam names ${state}, which aegis-run does not declare as a run state`);
  }
  // The expectations these proofs assert against are the shipped words.
  for (const [state, plain] of Object.entries(RUN_LIFECYCLE_PLAIN)) {
    assert.ok(new RegExp(state + ": '" + plain + "'").test(seam),
      `the shipped lifecycle word for ${state} is no longer ${plain}`);
  }
  for (const [state, plain] of Object.entries(RUN_STATE_PLAIN)) {
    assert.ok(new RegExp(state + ": '" + plain + "'").test(seam),
      `the shipped control-plane word for ${state} is no longer ${plain}`);
  }
  // The HUD module footers translate through this same one seam, so the words
  // they print are asserted here rather than as a second dictionary.
  for (const [group, expected] of [
    ['gate-outcome', GATE_OUTCOME_PLAIN],
    ['checkpoint-evidence', CHECKPOINT_EVIDENCE_PLAIN],
    ['code-version', CODE_VERSION_PLAIN],
    ['review-coverage', REVIEW_COVERAGE_PLAIN],
  ]) {
    assert.ok(seam.includes("'" + group + "': {"),
      `the ${group} module footer has no group in the one shipped label seam`);
    for (const [state, plain] of Object.entries(expected)) {
      const key = /^[A-Z_]+$/.test(state) ? state : "'" + state + "'";
      const entry = new RegExp(escapeRegExp(key) + ":\\s*'" + escapeRegExp(plain) + "'");
      assert.ok(entry.test(seam),
        `the shipped ${group} word for ${state} is no longer ${plain}`);
    }
  }
  // And the seam translates only wording. It reads no run, no gate and no
  // evidence, so it can never become a second state authority.
  for (const banned of ['run.', 'engineering', 'binding', 'verdict', 'problems',
    'setTimeout', 'fetch(', 'Date.now', 'Math.random']) {
    assert.ok(!seam.includes(banned),
      `the label seam reads ${banned} — it may translate a word and nothing else`);
  }
});

test('the exact canonical run-state codes survive the plain-English first screen', () => {
  // Every surface that already wrote the token out still writes it out. These
  // are the audit and detail sentences an operator or reviewer reads to get the
  // exact code back, and the plain first screen may not cost a single one.
  assert.ok(/'Current station: ' \+ current\.label \+ ' — canonical run state ' \+ run\.state/.test(code),
    'the handoff note stopped citing the exact canonical run state beneath the path');
  assert.ok(/'Canonical run state ' \+ run\.state \+ ' belongs to no station on this path'/.test(code),
    'an off-path run state is no longer reported with its exact code');
  assert.ok(/Canonical ' \+ moved\.from \+ ' → ' \+ moved\.to/.test(code),
    'a proven handoff no longer prints the exact canonical states it moved between');
  // The HUD mission footer now reads through the shipped seam, so its exact
  // pair has to survive as the machine attribute on the very node whose words
  // replaced it — not as displayed tokens.
  assert.ok(/hudState\('hud-mission-state',[\s\S]{0,300}?controlState\.state \+ ' · ' \+ opState\.state,/.test(code),
    'the HUD mission state line stopped carrying the exact gate and lifecycle codes');
  assert.ok(/node\.setAttribute\('data-hud-code', canonicalCode\);/.test(code) &&
    /node\.setAttribute\('title', titleText \|\| \('Canonical state code: ' \+ canonicalCode\)\);/.test(code),
  'a HUD module footer no longer keeps the exact canonical code it was written from');
  assert.ok(/missionMeta\.setAttribute\('data-mission-gate-code', controlState\.state\);/.test(code) &&
    /missionMeta\.setAttribute\('data-mission-lifecycle-code', opState\.state\);/.test(code),
  'the mission line dropped the exact gate and lifecycle codes when it started reading in plain English');
  assert.ok(/'Canonical run state: ' \+ \(\(run && run\.state\) \|\| RD_NOT_RECORDED\)/.test(code),
    'the recovery deck disclosure stopped carrying the exact canonical run state');
  assert.ok(/c\.setAttribute\('title','Canonical state code: '\+token\)/.test(code),
    'a plain chip word no longer carries the exact canonical code it replaced');
  // The station mark reads as meaning, not as vocabulary, and the role word it
  // leads with is still the machine role the station records.
  const path = code.slice(code.indexOf('function renderCorePath'), code.indexOf('function reviewerEvidenceReady'));
  assert.ok(/'CURRENT · ' \+ opsChipLabel\('run-lifecycle', run\.state\)/.test(path) &&
    /'HANDED FROM · ' \+ opsChipLabel\('run-lifecycle', moved\.from\)/.test(path),
    'the handoff stations still print raw canonical tokens on the first screen');
  assert.ok(/var role = isCurrent \? 'CURRENT' : \(isFrom \? 'HANDED FROM' : 'NOT CURRENT'\);/.test(path),
    'the station role attribute changed with the wording, which is a state change and not a label change');
});

test('live activity has one translation seam and Detail View alone discloses the exact receipt', () => {
  assert.strictEqual((code.match(/function activityUpdate\(/g) || []).length, 1,
    'live activity has more than one founder-language translation authority');
  assert.strictEqual((code.match(/function appendActivity\(/g) || []).length, 1,
    'live activity has more than one renderer');
  assert.ok(/\.activity-raw\{display:none;[^}]*overflow-wrap:anywhere|\.activity-raw\{display:none;/.test(code),
    'Command View does not keep raw receipts out of its founder-readable feed');
  assert.ok(/body\[data-detail="true"\] \.activity-raw\{display:block\}/.test(code),
    'Detail View does not disclose the exact recorded receipt');
  const renderer = code.slice(code.indexOf('function appendActivity'),
    code.indexOf('// One activity renderer owns the live feed'));
  assert.ok(/String\(text\)/.test(renderer), 'the renderer does not retain the exact supplied receipt text');
  assert.ok(!/new Date|Date\.now|setTimeout|setInterval/.test(renderer),
    'the activity renderer invents time or activity instead of using canonical evidence');
});

// ── repeated status snapshots (PKT-20260826-ASYNC-WORKER-OPERATOR-BETA) ────
// The defect: a quiet system pushed /api/status on its own and Command View
// answered with a wall of byte-identical "AEGIS re-sent the whole picture"
// cards, so the one update that had actually changed was scrolled away by the
// ones that said nothing. The fix must stay narrow — a fold that widened to
// control actions, refusals, failures or unrecognised codes would merge two
// separate things that happened, and a fold that summarised evidence away
// would delete the receipt a reader needs.
test('only consecutive identical status snapshots fold, and a fold deletes no evidence', () => {
  assert.strictEqual((code.match(/ACTIVITY_REPEATABLE_CODES\s*=/g) || []).length, 1,
    'the fold allow-list is declared more than once, or not at all');
  const list = /var ACTIVITY_REPEATABLE_CODES\s*=\s*\[([^\]]*)\]/.exec(code);
  assert.ok(list, 'no ACTIVITY_REPEATABLE_CODES allow-list was found');
  assert.deepStrictEqual(list[1].split(',').map((item) => item.trim()).filter(Boolean),
    ["'STATUS_SNAPSHOT'"], 'a canonical event other than STATUS_SNAPSHOT was made foldable');
  assert.ok(/repeatable:\s*ACTIVITY_REPEATABLE_CODES\.indexOf\(code\) !== -1/.test(code),
    'fold eligibility is decided somewhere other than the one allow-list');
  assert.ok(/repeatable:\s*false/.test(code),
    'an update carrying no canonical event is not explicitly refused the fold');

  const renderer = code.slice(code.indexOf('function appendActivity'),
    code.indexOf('// One activity renderer owns the live feed'));
  assert.ok(/update\.repeatable === true/.test(renderer),
    'the renderer folds without asking the translation seam whether the code may fold at all');
  assert.ok(/lastActivity\.node === host\.firstElementChild/.test(renderer),
    'the fold target is not required to be the newest item, so a non-consecutive repeat could fold');
  assert.ok(/lastActivity\.identity === identity/.test(renderer),
    'the renderer folds without requiring an identical presentation identity');
  assert.ok(/\[update\.code, raw, update\.what, update\.who, update\.moved, update\.next\]/.test(renderer),
    'the fold identity no longer covers the exact receipt and every founder answer');

  const fold = renderer.slice(renderer.indexOf('if (update.repeatable === true'),
    renderer.indexOf('var li = el('));
  assert.ok(fold.length > 0, 'the fold branch was not located');
  assert.ok(!/removeChild|textContent = ''|innerHTML/.test(fold),
    'folding a repeat deletes or clears evidence that was already disclosed');
  assert.ok(/activity-raw-text/.test(fold) && /activity-raw-stamp/.test(fold),
    'a folded repeat does not add its own exact receipt and its own canonical timestamp');
  assert.ok(/repeatSentence\(lastActivity\.count\)/.test(fold),
    'the renderer phrases the repeat count itself instead of using the one translation seam');
  assert.ok(!/moved/.test(fold),
    'folding a repeat rewrites the did-this-move-the-build-forward answer');
  assert.ok(!/new Date|Date\.now|setTimeout|setInterval/.test(fold),
    'the fold invents time or motion instead of counting canonical updates');

  const sentence = code.slice(code.indexOf('function activityRepeat('),
    code.indexOf('function activityUpdate('));
  assert.ok(sentence.length > 0, 'no activityRepeat() translation was found ahead of activityUpdate()');
  assert.ok(/not progress/.test(sentence),
    'the repeat count does not state out loud that a repeat is not progress');
  assert.ok(!/progressed|advanced|completed|succeeded|finished/i.test(sentence),
    'the repeat count implies the build moved because an update repeated');
  assert.ok(/\.activity-repeat\{[^}]*font-size/.test(code) &&
    !/\.activity-repeat\{[^}]*display:none/.test(code),
    'the repeat count is not legible in Command View — a hidden count is how a repeat passes for a change');
});

// ── visible receipt time (PKT-20260826-ASYNC-WORKER-OPERATOR-BETA) ─────────
// The defect: every canonical timestamp lived behind the Detail control, so the
// founder-readable feed was a stack of undated sentences that read as "just
// now" however old the receipt was — and a folded item, standing for several
// receipts, showed no time at all. The fix may only surface times the receipt
// already carries: no clock, no relative wording, and no ranking of one receipt
// above another.
test('the founder feed shows the receipt time it already has, and a fold names two by arrival order', () => {
  assert.ok(/\.activity-stamp\{[^}]*font/.test(code),
    'the visible canonical timestamp has no Command View styling at all');
  assert.ok(!/\.activity-stamp\{[^}]*display:none/.test(code),
    'the receipt time is hidden in Command View — an undated feed is how an old receipt reads as now');
  assert.ok(/\.activity-stamp\{[^}]*overflow-wrap:anywhere/.test(code),
    'a long canonical timestamp can push the feed sideways instead of wrapping');
  assert.ok(/body\[data-detail="true"\] \.activity-raw\{display:block\}/.test(code),
    'the exact receipt no longer belongs to Detail View alone');

  const renderer = code.slice(code.indexOf('function appendActivity'),
    code.indexOf('// One activity renderer owns the live feed'));
  assert.ok(/el\('div', 'activity-stamp', update\.stamp\)/.test(renderer),
    'the visible time is not the stamp the one translation seam already wrote');
  assert.ok(!/new Date|Date\.now|setTimeout|setInterval/.test(renderer),
    'the feed reads a clock instead of the canonical receipt time');
  assert.ok(/firstStamp: update\.stamp/.test(renderer),
    'the item does not remember the stamp of the receipt it was opened with');

  // A fold stands for several receipts, so one time beside it would be a guess
  // about which. Both ends of the arrival order are named, through the same
  // translation seam that phrases the count — never in the renderer's words.
  const fold = renderer.slice(renderer.indexOf('if (update.repeatable === true'),
    renderer.indexOf('var li = el('));
  assert.ok(/foldStampSentence\(lastActivity\.firstStamp, update\.stamp\)/.test(fold),
    'a folded item does not name both the first receipt it took and the one it has just taken');
  assert.strictEqual((fold.match(/lastActivity\.stamp\.textContent =/g) || []).length, 1,
    'the folded item’s visible time is written from more than one place, or not at all');
  assert.ok(!/Canonical timestamp|Received first|Received last/.test(fold),
    'the renderer composes a timestamp sentence of its own instead of using the one seam');

  const sentence = code.slice(code.indexOf('function activityFoldStamp('),
    code.indexOf('function activityUpdate('));
  assert.strictEqual((code.match(/function activityFoldStamp\(/g) || []).length, 1,
    'the folded-receipt time has more than one translation authority, or none');
  assert.ok(/activityFoldStamp: activityFoldStamp/.test(code),
    'the folded-receipt translation is not exported through the one renderer seam');
  assert.ok(/arrived in this feed/.test(sentence) && /not progress/.test(sentence),
    'the two folded receipt times are not stated as arrival order that claims no progress');
  assert.ok(!/\b(newest|latest|freshest|newer|most recent|up to date|current)\b/i.test(sentence),
    'a folded receipt time is ranked by freshness or currency rather than stated as arrival order');
  assert.ok(!/progressed|advanced|completed|succeeded|finished/i.test(sentence),
    'a later arrival is presented as the build having moved');
});

test('accepted, waiting, refused and stopping activity never claims recorded progress', () => {
  const map = code.slice(code.indexOf('var ACTIVITY_UPDATES'), code.indexOf('function activityAnswer'));
  for (const event of ['START_ACCEPTED', 'START_REFUSED', 'CHECKS_ACCEPTED', 'CHECKS_REFUSED',
    'REVIEW_EVIDENCE_ACCEPTED', 'REVIEW_REFUSED_BY_REVIEWER', 'REVIEW_REFUSED_BY_AEGIS',
    'CANCEL_ACCEPTED', 'CANCEL_REFUSED', 'RETRY_ACCEPTED', 'RETRY_REFUSED']) {
    assert.ok(map.includes(event + ':'), `${event} has no founder-readable activity mapping`);
  }
  assert.ok(!/moved:\s*['"][^'"]*(?:Yes|progressed|completed|finished|advanced)/i.test(map),
    'a control receipt is presented as completed or recorded progress');
  assert.ok(/nothing counts as built until AEGIS records it/.test(map) &&
    /a check result counts only once AEGIS writes it into the run history/.test(map),
    'accepted work is not explicitly separated from canonical lifecycle progress');
});

// ── V2 mobile operator cockpit (PKT-20260826-ASYNC-WORKER-OPERATOR-BETA) ───
// The phone failure guarded here is a cockpit that reads like a spreadsheet:
// the owner opens AEGIS on a phone and the first screens are routing rationale,
// live-evidence prose, builder-progress detail, elapsed time and a gate
// transcript, while the operational strip, the mission, the current action, the
// blocker, the next valid action and the last safe checkpoint are scrolled away
// — with the governed controls too small to hit and a mono subject line dragging
// the page sideways. These are static proofs over the shipped phone breakpoint,
// because the regression is silent: it renders perfectly at 1440px.
const phoneStart = code.lastIndexOf('@media (max-width:680px)');
const PHONE = phoneStart === -1 ? '' : code.slice(phoneStart, code.indexOf('\n  }', phoneStart));

function phoneRules() {
  const rules = [];
  for (const rule of PHONE.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    rules.push({ selectors: rule[1].split(',').map((s) => s.trim()).filter(Boolean), body: rule[2] });
  }
  return rules;
}

function phoneSelectorsDeclaring(pattern) {
  const found = new Set();
  for (const rule of phoneRules()) {
    if (!pattern.test(rule.body)) continue;
    for (const selector of rule.selectors) found.add(selector);
  }
  return found;
}

test('the phone cockpit reads strip, mission and decision instruments before supporting evidence', () => {
  assert.ok(PHONE.length > 0, 'the phone breakpoint block was not located');
  const source = htmlSrc();
  assert.ok(source.indexOf('id="ops-strip"') < source.indexOf('id="operator-shell"') &&
    source.indexOf('id="founder-summary"') < source.indexOf('class="evidence-deck"'),
    'the phone reading order rests on source order that no longer puts the strip and mission first');
  assert.ok(/\.ops-strip-cells\{grid-template-columns:1fr\}/.test(PHONE),
    'the five operational answers still share a phone row, where none of them stays legible');
  // Supporting cards are demoted, and only supporting cards. Demoting any of
  // the six operator answers would restore exactly the defect this fixes.
  const demotion = /#founder-summary \.command-card\.is-routing,#founder-summary \.command-card\.is-live-evidence,\s*#founder-summary \.command-card\.is-progress,#founder-summary \.command-card\.is-elapsed\{order:1\}/
    .exec(PHONE);
  assert.ok(demotion, 'routing rationale, live evidence, builder-progress detail and elapsed are not demoted on a phone');
  const demoted = phoneSelectorsDeclaring(/(?:^|;)order:[1-9]/);
  for (const essential of ['.is-now', '.is-next', '.is-blocked', '.is-clear', '.is-checkpoint', '.is-crew']) {
    for (const selector of demoted) {
      assert.ok(!selector.includes('.command-card' + essential),
        `the phone deck demoted the operator card ${essential} below supporting evidence`);
    }
  }
  const brief = {};
  for (const row of PHONE.matchAll(/\.brief-row\[data-operator-brief="([\w-]+)"\]\{order:(\d+)\}/g)) {
    brief[row[1]] = Number(row[2]);
  }
  assert.deepStrictEqual(Object.keys(brief).sort(), ['finished', 'needs-marc', 'next', 'now', 'verify'],
    'the phone brief does not order all five canonical operator answers');
  assert.ok(brief.now < brief['needs-marc'] && brief['needs-marc'] < brief.next &&
    brief.next < brief.finished && brief.finished < brief.verify,
    `the phone brief reads explanation before action: ${JSON.stringify(brief)}`);
  assert.ok(/\.event-panel\{order:1\}/.test(PHONE),
    'the long gate-decision log still reads ahead of the health, decision and checkpoint instruments');
});

test('the phone cockpit keeps Start, Cancel, Retry, the view switch and reduced motion finger-sized', () => {
  const finger = phoneSelectorsDeclaring(/min-height:44px/);
  for (const selector of ['.view-tab', '.hud-control', '.ask-actions .action', 'button.action',
    '.panel-summary', '.field input', '.field textarea', '.field select']) {
    assert.ok(finger.has(selector), `${selector} is not a finger-sized target at phone width`);
  }
  // The composer's optional fields carry an explicit 34px override at desktop
  // width; without the same selector the phone rule loses the cascade to it.
  for (const selector of ['.objective-composer .field:not(:first-child) input',
    '.objective-composer .field:not(:first-child) textarea',
    '.objective-composer .field:not(:first-child) select']) {
    assert.ok(finger.has(selector), `${selector} keeps its 34px desktop height on a phone`);
  }
  assert.ok(/\.field input[^{]*\{[^}]*font-size:16px/.test(PHONE),
    'a sub-16px field still lets mobile Safari zoom the governed form off-screen on focus');
  // The three governed run controls are ordinary .action buttons, which is what
  // the rule above sizes. If any of them stops being one, this proof fails
  // rather than silently sizing nothing.
  const source = htmlSrc();
  assert.ok(/<button type="submit" class="action primary" id="btn-submit-objective"/.test(source),
    'the governed Start control is no longer an .action button the phone rule sizes');
  assert.ok(/el\('button', 'action warn', 'Cancel'\)/.test(code),
    'the safe Cancel control is no longer an .action button the phone rule sizes');
  assert.ok(/el\('button', 'action', 'Retry'\)/.test(code) && /el\('button','action primary','Retry'\)/.test(code),
    'a valid Retry control is no longer an .action button the phone rule sizes');
  assert.ok(/<button type="button" class="hud-control" id="toggle-motion"/.test(source),
    'the reduced-motion control is no longer a .hud-control the phone rule sizes');
  assert.ok(/\.btn-row>button\.action\{[^}]*flex:1 1 auto/.test(PHONE) && /\.btn-row>\.meta\{flex:1 0 100%\}/.test(PHONE),
    'governed controls and their refusal reasons still compete for one phone row');
});

test('the phone cockpit wraps dense canonical values instead of scrolling the page sideways', () => {
  const wrapped = phoneSelectorsDeclaring(/overflow-wrap:anywhere/);
  for (const selector of ['.mission-meta', '.command-value', '.brief-value', '.row .name', '.row .meta',
    '.run-card .meta', '.kv dt', '.hud-value']) {
    assert.ok(wrapped.has(selector), `${selector} can still push the phone viewport sideways`);
  }
  assert.ok(/\.kv\{grid-template-columns:minmax\(0,1fr\)/.test(PHONE),
    'the two-column key/value grid keeps an auto label column that a long canonical key widens');
  assert.ok(/\.chip\{white-space:normal\}/.test(PHONE), 'a long canonical state word cannot wrap inside its chip');
  assert.ok(/\.row\{flex-wrap:wrap\}/.test(PHONE) && /\.badges\{justify-content:flex-start\}/.test(PHONE),
    'list rows still force their name and badges onto one phone line');
  assert.ok(/\.context-cell,\.context-cell\.mono\{max-width:100%\}/.test(PHONE),
    'the header context cells keep a fixed width wider than a phone');
  // Wrapping is the fix. Clipping the document would hide the overflow instead
  // of preventing it, and would hide the evidence that overflowed with it.
  assert.ok(!/html,body\{[^}]*overflow/.test(code) && !/(?:^|;)overflow-x:/.test(PHONE),
    'horizontal overflow is being masked by clipping the page rather than by wrapping the value');
});

test('the phone cockpit hides no evidence, adds no motion, and leaves the desktop and tablet HUD intact', () => {
  for (const rule of phoneRules()) {
    if (!/display:none/.test(rule.body)) continue;
    for (const selector of rule.selectors) {
      assert.ok(/::(?:before|after)$/.test(selector),
        `the phone cockpit removes ${selector} instead of demoting or collapsing it`);
    }
  }
  assert.ok(!/\banimation\s*:/.test(PHONE) && !/(?:^|;)transition:(?!none)/.test(PHONE),
    'the phone cockpit introduced motion — it is an instrument panel, not decoration');
  for (const card of ["commandCard('WHY THIS MODEL / TOOL'", "commandCard('LIVE EVIDENCE'",
    "commandCard('ELAPSED'", "commandCard('CREW / MODEL'", "commandCard('LAST SAFE CHECKPOINT'"]) {
    assert.ok(code.includes(card), `${card} was deleted rather than demoted on the phone deck`);
  }
  assert.ok(!/<details[^>]*id="raw-state"[^>]*\bopen\b/.test(htmlSrc()),
    'deep technical evidence was forced open on the phone first screen');
  // Above the phone breakpoint nothing moved: the wide Strategic HUD, its
  // five-column strip and its five-instrument evidence band are untouched.
  assert.ok(/\.ops-strip-cells\{display:grid;grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/.test(code),
    'the desktop status strip lost its five-column band');
  assert.ok(/\.core-stage\{position:relative;min-height:430px;display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/.test(code),
    'the desktop Strategic HUD core stage was rebuilt for the phone');
  assert.ok(/\.evidence-deck\{grid-template-columns:repeat\(5,minmax\(0,1fr\)\)\}/.test(code),
    'the desktop evidence deck lost its five instrument columns');
  assert.ok(/\.command-shell\{grid-template-columns:300px minmax\(600px,1fr\)/.test(code) &&
    /#topology-live-body \.route-strip\{grid-template-columns:repeat\(6,minmax\(78px,1fr\)\)\}/.test(code),
    'the tablet and ordinary-laptop layouts were changed by the phone packet');
});

test('the phone command summary compacts the header and the strip instead of burying the answers', () => {
  // The defect guarded here is a phone first screen spent entirely on chrome:
  // a three-block header above five desktop-height status cards, with the
  // mission, the current action, the owner decision, the next action and the
  // last safe checkpoint all pushed past the fold. The fix is compaction, so
  // every proof below pairs "smaller" with "still present and still whole".
  const header = /\.command-header\{display:flex;position:static;([^}]*)\}/.exec(PHONE);
  assert.ok(header, 'the phone header rule was rebuilt away');
  assert.ok(/min-height:0/.test(header[1]) && /padding:8px 12px/.test(header[1]),
    'the phone header still reserves the full desktop header band above the instruments');
  assert.ok(/\.header-state\{display:contents\}/.test(PHONE),
    'the header state block still takes a full-width row of its own on a phone');
  assert.ok(/\.header-state \.hud-control\{order:1\}/.test(PHONE) &&
    /\.header-state \.context-strip\{order:3;flex:1 0 100%/.test(PHONE),
    'the header controls and the canonical context line are not laid out as one compact band');
  // display:contents relocates a box; it removes nothing, and the proof above
  // already forbids display:none anywhere in this block. Both controls and all
  // three canonical context cells stay exactly where the markup has them.
  const source = htmlSrc();
  for (const id of ['ctx-entity', 'ctx-generated', 'ctx-verdict', 'toggle-motion']) {
    assert.ok(source.includes('id="' + id + '"'), `${id} was deleted rather than compacted`);
  }

  // The operational status becomes one summary line per answer: written label
  // and canonical state word on the first row, resolved sentence clamped under
  // it. Five full-height cards are exactly what buried the operator answers.
  assert.ok(/\.ops-cell\{display:flex;flex-wrap:wrap;[^}]*padding:5px 10px\}/.test(PHONE),
    'the phone strip still stacks five desktop-height status cards');
  assert.ok(/\.ops-cell>\.chip\{[^}]*margin-top:0/.test(PHONE),
    'the canonical state word still takes a row of its own inside every phone cell');
  assert.ok(/\.ops-value\{[^}]*-webkit-line-clamp:1\}/.test(PHONE),
    'the strip sentence is not compacted to one summary line at phone width');
  // Clamping is a stylesheet decision, never a truncated value: the renderer
  // still writes the whole canonical sentence into the cell, the mission brief
  // reads the run-state sentence unclamped, and every other sentence the strip
  // abbreviates is rendered in full further down this same page.
  assert.ok(/node\.appendChild\(el\('div','ops-value',cell\.value\)\)/.test(code),
    'the strip truncates its canonical sentence in the renderer instead of in the stylesheet');
  assert.ok(!/mission-meta\{[^}]*line-clamp/.test(PHONE),
    'the mission status sentence is clamped in the strip and in the brief, so a phone cannot read it in full');
  assert.ok(!/brief-value\{[^}]*line-clamp/.test(PHONE),
    'a canonical operator answer is clamped instead of read in full');
  for (const restated of ["commandCard('BUILDER PROGRESS'", "commandCard('LAST SAFE CHECKPOINT'",
    'evidenceCostPanel(view && view.cost)']) {
    assert.ok(code.includes(restated), `${restated} no longer restates in full a sentence the phone strip clamps`);
  }

  // The brief pays for the space it saves in padding and in one stacked chip
  // row — never in the canonical answers themselves.
  assert.ok(/#founder-summary \.mission-head\{flex-direction:row;flex-wrap:wrap/.test(PHONE),
    'the mission state chip still takes a stacked row of its own above the operator answers');
  assert.ok(/\.operator-brief\{display:flex;flex-direction:column;margin-top:9px;padding:9px 11px\}/.test(PHONE),
    'the operator brief keeps its full desktop padding on a phone');
  // Nothing compacted here drops below the size that keeps it readable: the
  // operator answers stay at 13px or larger and governed inputs stay at 16px,
  // which is the size that stops mobile Safari zooming the form on focus.
  for (const rule of phoneRules()) {
    const target = rule.selectors.join(',');
    for (const declared of rule.body.matchAll(/font-size:(\d+(?:\.\d+)?)px/g)) {
      const px = Number(declared[1]);
      if (/\.field |input|textarea|select/.test(target)) {
        assert.ok(px >= 16, `${target} drops a governed form control to ${px}px`);
      } else if (/brief-value|command-value|mission-title/.test(target)) {
        assert.ok(px >= 13, `${target} shrinks a canonical operator answer to ${px}px`);
      } else {
        assert.ok(px >= 10, `${target} shrinks page text to ${px}px`);
      }
    }
  }

  // Above 680px the header band, the header state row and the strip cell are
  // exactly what they were: this packet changed a phone, not a desktop.
  assert.ok(/\.command-header\{min-height:72px;padding:12px 20px/.test(code),
    'the desktop header band was rebuilt by the phone packet');
  assert.ok(/\.header-state\{display:flex;align-items:center/.test(code),
    'the desktop header state row lost its own layout');
  assert.ok(/\.ops-cell\{min-width:0;padding:9px 11px/.test(code) &&
    /\.ops-value\{[^}]*-webkit-line-clamp:4/.test(code),
    'the desktop strip cell or its four-line clamp was rebuilt by the phone packet');
});

// ── wide-screen Command View density (PKT-20260826-ASYNC-WORKER-OPERATOR-BETA) ─
// The failure guarded here is a working command centre that reads as a
// four-screen document: on an ordinary 1292×994 desktop the first viewport is
// spent on header chrome, two rows of full-height status cards and a fixed
// 510px HUD reserve, so the AEGIS Core, its six evidence modules, the
// nine-station handoff path and the build route are all scrolled away. The fix
// is density, so every proof below pairs "smaller" with "still present, still
// whole, and still never legible by colour alone". These are static proofs over
// the shipped breakpoint, because the regression is silent: it renders
// perfectly on a phone and on a 1920px wall display.
const wideStart = code.lastIndexOf('@media (min-width:1100px)');
const WIDE = wideStart === -1 ? '' : code.slice(wideStart, code.indexOf('\n  }', wideStart));

function wideRules() {
  const rules = [];
  for (const rule of WIDE.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    rules.push({ selectors: rule[1].split(',').map((s) => s.trim()).filter(Boolean), body: rule[2] });
  }
  return rules;
}

function wideSelectorsDeclaring(pattern) {
  const found = new Set();
  for (const rule of wideRules()) {
    if (!pattern.test(rule.body)) continue;
    for (const selector of rule.selectors) found.add(selector);
  }
  return found;
}

test('the wide Command View compacts the first screen without hiding, repainting or animating anything', () => {
  assert.ok(WIDE.length > 0, 'the wide-screen Command View density block was not located');
  // It starts exactly at the tablet ceiling: 681–1099px keeps the styles it
  // shipped with, and nothing here can reach a phone.
  // Scanned inside WIDE, not the whole stylesheet: unrelated breakpoints
  // elsewhere are not this block's invariant.
  const added = (WIDE.match(/@media \(min-width:(\d+)px\)/g) || [])
    .map((query) => Number(/(\d+)/.exec(query)[1]));
  assert.ok(added.includes(1100), 'the wide Command View density layer is not scoped to 1100px and above');
  for (const width of added) {
    assert.ok(width >= 1100,
      `a min-width:${width}px rule reaches below the wide band, into preserved phone or tablet styles`);
  }
  // Compaction, never removal: a display:none here would delete an instrument
  // from the very screen this block exists to complete.
  for (const rule of wideRules()) {
    assert.ok(!/display:none/.test(rule.body),
      `the wide Command View removes ${rule.selectors.join(',')} instead of compacting it`);
  }
  // Density may not become a second status signal, and it may not outrank one:
  // no colour, no border colour, no shadow, and no !important that could
  // silently delete the .is-now / .is-blocked / .is-clear inset state bars.
  for (const rule of wideRules()) {
    const target = rule.selectors.join(',');
    assert.ok(!/(?:^|;)\s*(?:color|background|border-color|box-shadow)\s*:/.test(rule.body),
      `${target} repaints a state signal instead of compacting a box`);
    assert.ok(!/!important/.test(rule.body), `${target} outranks a shipped state signal with !important`);
  }
  assert.ok(!/@keyframes/.test(WIDE) && !/\banimation\s*:/.test(WIDE) && !/(?:^|;)transition:(?!none)/.test(WIDE),
    'the wide Command View introduced motion — it is an instrument panel, not decoration');
  // No new authority: this layer is CSS, so it may not carry a script, a data
  // source or a network dependency of any kind.
  for (const banned of ['setInterval', 'setTimeout', 'requestAnimationFrame', 'Date.now', 'url(', 'AEGIS_STATE']) {
    assert.ok(!WIDE.includes(banned), `the density layer uses ${banned} — it may only compact shipped boxes`);
  }
});

test('the wide Command View fits the whole HUD, all nine stations and the build route, and clamps only supporting prose', () => {
  // The two fixed reserves are what pushed the path and the route off-screen.
  // The proof is the reserve, not the gap: min-height:0 is what returns the
  // fixed 510px/430px band to the instruments, and the stage's own gap is a
  // composition value the fidelity slice below sets and holds its own proof for.
  assert.ok(/\.strategic-core\{min-height:0\}/.test(WIDE) && /\.core-stage\{min-height:0;gap:/.test(WIDE),
    'the HUD keeps the fixed 510px/430px reserve that spends the first screen on empty panel');
  assert.ok(/\.aegis-core\{width:148px;height:148px/.test(WIDE),
    'the AEGIS Core keeps a diameter that alone sets the middle HUD row taller than the fold');
  assert.ok(/\.ops-cell\{display:flex;flex-wrap:wrap;[^}]*padding:4px 9px\}/.test(WIDE) &&
    /\.ops-cell>\.chip\{[^}]*margin-top:0/.test(WIDE) &&
    /\.ops-strip-cells\{grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/.test(WIDE),
    'the operational status is still two rows of full-height cards on a wide screen');
  assert.ok(/\.command-header\{min-height:0;/.test(WIDE) && /\.command-shell\{padding:10px 14px 14px;gap:12px\}/.test(WIDE),
    'header and shell chrome still reserve their full band above the instruments');
  // Complete means complete: the stage keeps three canonical columns, the track
  // keeps nine, and neither is re-columned into a second screen here.
  const retracked = wideSelectorsDeclaring(/grid-template-columns/);
  for (const selector of ['.core-stage', '.core-path-track', '#topology-live-body .route-strip']) {
    assert.ok(!retracked.has(selector), `${selector} is re-columned at wide width, which splits the cockpit`);
  }
  const source = htmlSrc();
  for (const id of ['hud-mission', 'hud-crew', 'hud-review', 'hud-gate', 'hud-evidence', 'hud-checkpoint',
    'aegis-core', 'core-path-track', 'core-path-note', 'ops-strip-cells', 'founder-body', 'topology-live-body']) {
    assert.ok(source.includes('id="' + id + '"'), `${id} was deleted rather than compacted`);
  }
  assert.strictEqual(corePathStations().length, 9, 'the handoff path no longer declares nine canonical stations');

  // Clamping is presentation over supporting prose only. Every operator answer
  // — current action, next step, blocker, last safe checkpoint, and the brief's
  // right-now / next-action / attention rows — is read in full at this width.
  const clamped = wideSelectorsDeclaring(/-webkit-line-clamp/);
  for (const answer of ['.is-now', '.is-next', '.is-blocked', '.is-clear', '.is-checkpoint',
    '"now"', '"next"', '"needs-marc"']) {
    for (const selector of clamped) {
      assert.ok(!selector.includes(answer), `the wide Command View clamps the operator answer ${answer}`);
    }
  }
  // And every clamped value is still written whole by its renderer, so it stays
  // in the DOM for assistive technology and unabridged in Detail View.
  assert.ok(/card\.appendChild\(el\('div','command-value',value\)\)/.test(code) &&
    /row\.appendChild\(el\('div','brief-value',value\)\)/.test(code) &&
    /item\.appendChild\(el\('span','core-station-mark',/.test(code),
    'a value the wide Command View clamps is truncated in the renderer instead of in the stylesheet');

  // Below 1100px nothing moved: the phone cockpit and the tablet HUD are exactly
  // the styles they shipped with.
  assert.ok(/\.core-stage\{position:relative;min-height:430px;display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/.test(code) &&
    /\.aegis-core\{position:relative;z-index:2;grid-column:2;grid-row:2;justify-self:center;width:188px;height:188px/.test(code),
    'the shipped sub-1100px HUD geometry was rebuilt by the density packet');
  assert.ok(/\.command-header\{min-height:72px;padding:12px 20px/.test(code) &&
    /\.ops-cell\{min-width:0;padding:9px 11px/.test(code) &&
    /\.ops-value\{[^}]*-webkit-line-clamp:4/.test(code),
    'the shipped header band or status cell was rebuilt rather than overridden above 1100px');
  assert.ok(/\.command-shell\{grid-template-columns:1fr;grid-template-areas:"left" "center" "right" "evidence"\}/.test(code) &&
    /#topology-live-body \.route-strip\{grid-template-columns:repeat\(3,minmax\(100px,1fr\)\)\}/.test(code),
    'the 681–1099px tablet stack was changed by the wide-screen density packet');
  assert.ok(/\.ops-strip-cells\{grid-template-columns:1fr\}/.test(PHONE) &&
    /\.core-path-track\{grid-template-columns:1fr\}/.test(PHONE),
    'the phone cockpit was changed by the wide-screen density packet');
});

// ── mission brief: the rail's width belongs to the objective ───────────────
// The failure guarded here is the 300px left rail splitting its mission head
// between a title and a status chip: at 1292px the objective got roughly half
// the rail, so even a short one wrapped and clamped early and the head grew
// taller than the words in it. The correction is one wrapped flex row — the
// title block takes the whole row and the same labelled chip falls to a compact
// status row under it. Nothing is added, removed, promoted or rewritten, so
// these proofs are about width and about what survives the move.
test('the mission brief gives the objective the whole rail and drops the status chip to its own row', () => {
  assert.ok(/\.mission-head\{display:flex;flex-wrap:wrap;[^}]*align-items:flex-start\}/.test(code),
    'the mission head cannot wrap, so the status chip still shares the objective row');
  assert.ok(/\.mission-head>div\{[^}]*width:100%[^}]*min-width:0\}/.test(code),
    'the mission title block does not claim the full rail width');
  // A separate row, never a row painted over the title: no absolute placement,
  // no negative pull-up, no clamp and no removal may enter here.
  const head = code.slice(code.indexOf('.mission-head{display:flex;flex-wrap:wrap'));
  const headRules = head.slice(0, head.indexOf('.mission-kicker'));
  assert.ok(!/position:absolute|margin-top:-|line-clamp|display:none/.test(headRules),
    'the mission status row overlaps, clips or hides part of the mission head');
  // Every canonical fact the head carried still renders, from the same fields.
  assert.ok(/mission\.appendChild\(opsChip\(controlState\.state,\n?\s*opsChipLabel\('run-state', controlState\.state\)\)\)/.test(code),
    'the labelled gate-readiness chip was dropped instead of moved to its own row');
  assert.ok(/el\('div','mission-meta','Gate readiness: ' \+\n?\s*opsChipLabel\('run-state', controlState\.state\) \+/.test(code) &&
    /objectiveDetail\.appendChild\(el\('p','mission-objective-full',deckObjective\)\)/.test(code),
    'the gate/lifecycle pair or the exact full objective left the mission head');
  // The single-column tablet stack already gives the rail the whole page, so the
  // chip costs no title width there and that band keeps what it shipped with.
  const compact = code.slice(code.indexOf('@media (max-width:1050px)'),
    code.indexOf('@media (max-width:680px)'));
  assert.ok(/#founder-summary \.mission-head>div\{flex:1 1 200px\}/.test(compact),
    'the 681–1050px tablet stack lost the basis that keeps its chip beside the mission text');
  // The phone keeps chip and text on one row: it overrides the flex basis, and
  // a 200px basis outranks the width the shared rule above sets.
  assert.ok(/#founder-summary \.mission-head\{flex-direction:row;flex-wrap:wrap/.test(PHONE) &&
    /#founder-summary \.mission-head>div\{flex:1 1 200px;min-width:0\}/.test(PHONE),
    'the phone mission head lost the override that keeps its chip beside the text');
  // And the ordinary laptop still bounds the headline at two lines — now two
  // lines of the full rail — with the exact objective behind its disclosure.
  assert.ok(/#founder-summary \.mission-title\{[^}]*-webkit-line-clamp:2/.test(code),
    'the ordinary-laptop mission headline lost its two-line bound');
});

// ── wide-screen Strategic Systems HUD treatment (PKT-20260826-ASYNC-WORKER-OPERATOR-BETA) ─
// The failure guarded here is a command centre that looks like one by inventing
// signal: a halo that implies a run is emitting light, a rail that colours a
// state nothing reported, a texture pulled from an asset or bound to a run
// status, or "depth" that quietly resizes a panel and pushes an instrument off
// the screen the density layer above just finished fitting.
//
// The treatment layer is declared BEFORE the density layer, so density wins
// every tie and the compact wide fit is still decided by exactly the block the
// tests above hold. That ordering is itself asserted, because reversing it would
// silently move authority over the fit into an untested block.
const hudStart = code.indexOf('@media (min-width:1100px)');
const HUD = hudStart === -1 ? '' : code.slice(hudStart, code.indexOf('\n  }', hudStart));

// Paint, and nothing else. Every property here changes how a shipped box looks;
// none of them changes where it is, how large it is, or whether it renders.
const HUD_PAINT_ONLY = new Set(['color', 'background', 'background-color', 'background-image',
  'background-size', 'background-position', 'background-repeat', 'border-color', 'border-top-color',
  'border-right-color', 'border-bottom-color', 'border-left-color', 'border-width', 'box-shadow',
  'opacity']);
// Geometry is tolerated only on the layer's own decorative pseudo-elements,
// which are hairlines that occupy no layout space of their own.
const HUD_PSEUDO_GEOMETRY = new Set(['width', 'height']);

function hudRules() {
  const rules = [];
  for (const rule of HUD.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    rules.push({ selectors: rule[1].split(',').map((s) => s.trim()).filter(Boolean), body: rule[2] });
  }
  return rules;
}

// Multi-layer shadows and rgba() carry commas but never semicolons, so a
// semicolon split is an exact declaration split for this stylesheet.
function hudDeclarations(body) {
  return body.split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
    const colon = part.indexOf(':');
    return { prop: part.slice(0, colon).trim().toLowerCase(), value: part.slice(colon + 1).trim() };
  });
}

test('the wide Strategic Systems HUD treatment cannot hide, move, animate or fabricate anything', () => {
  assert.ok(HUD.length > 0, 'the wide Strategic Systems HUD treatment block was not located');
  assert.ok(hudRules().length > 0, 'the treatment layer declares no rules');
  assert.ok(hudStart < wideStart && HUD !== WIDE,
    'the treatment layer no longer precedes the density layer, so density no longer wins a tie and the compact wide fit is decided somewhere its own proofs do not reach');

  // Nothing disappears. The cheapest way to make a dense panel look calm is to
  // stop drawing part of it, and this page exists to not do that.
  for (const rule of hudRules()) {
    const target = rule.selectors.join(',');
    for (const { prop, value } of hudDeclarations(rule.body)) {
      assert.ok(prop !== 'display' || value !== 'none', `${target} hides an instrument`);
      assert.ok(prop !== 'visibility' && prop !== 'content-visibility' && prop !== 'overflow',
        `${target} hides or clips an instrument with ${prop}`);
      if (prop === 'opacity') {
        assert.ok(Number(value) > 0, `${target} renders an instrument at opacity ${value}`);
      }
    }
  }
  assert.ok(!/-webkit-line-clamp/.test(HUD),
    'the treatment layer clamps prose — clamping belongs to the density layer, which holds its own proofs about what may be clamped');

  // No motion of any kind, so reduced motion still has nothing here to suppress,
  // and no glow, sweep or gradient that could read as travel.
  assert.ok(!/@keyframes/.test(HUD) && !/\banimation\b/.test(HUD) && !/\btransition\b/.test(HUD) &&
    !/\bwill-change\b/.test(HUD) && !/\btransform\b/.test(HUD),
    'the treatment layer introduced motion — an instrument panel may not animate');
  // No second authority and no dependency: this layer is stylesheet text, so it
  // may not carry a script, a data source, an asset or a network fetch.
  for (const banned of ['url(', 'setInterval', 'setTimeout', 'requestAnimationFrame', 'Date.now',
    'fetch(', 'AEGIS_STATE', 'conic-gradient', '!important']) {
    assert.ok(!HUD.includes(banned), `the treatment layer uses ${banned} — it may only repaint shipped boxes`);
  }
  // It writes no words and no glyphs of its own, so it cannot state anything
  // canonical state has not stated.
  for (const declared of HUD.matchAll(/content\s*:\s*([^;}]+)/g)) {
    assert.strictEqual(declared[1].trim(), '""',
      'the treatment layer writes its own label or glyph into the page');
  }
});

test('the wide HUD treatment repaints only, so the compact wide fit and every narrower layout survive it', () => {
  const borderWidthOn = new Set();
  for (const rule of hudRules()) {
    const target = rule.selectors.join(',');
    const pseudoOnly = rule.selectors.every((selector) => /::(before|after)$/.test(selector));
    for (const { prop } of hudDeclarations(rule.body)) {
      if (HUD_PAINT_ONLY.has(prop)) {
        if (prop === 'border-width') for (const selector of rule.selectors) borderWidthOn.add(selector);
        continue;
      }
      assert.ok(pseudoOnly && HUD_PSEUDO_GEOMETRY.has(prop),
        `${target} declares ${prop}, which resizes or moves a shipped box instead of repainting it`);
    }
  }
  // One border width changes, and it reflows nothing: .aegis-core is a fixed
  // width/height box-sizing:border-box circle, so a heavier rim is paid for out
  // of the core's own padding and no neighbour moves.
  assert.deepStrictEqual([...borderWidthOn].sort(), ['.aegis-core'],
    'the treatment layer changes a border width on a box whose size is not already fixed, which reflows the compact wide fit');
  assert.ok(/\.aegis-core\{position:relative;z-index:2;grid-column:2;grid-row:2;justify-self:center;width:188px;height:188px/.test(code) &&
    /\.aegis-core\{width:148px;height:148px/.test(WIDE),
    'the AEGIS Core no longer has a fixed diameter, so its rim weight now reflows the HUD stage');

  // The fit itself is still the density layer's, untouched.
  assert.ok(/\.strategic-core\{min-height:0\}/.test(WIDE) && /\.core-stage\{min-height:0;gap:/.test(WIDE) &&
    /\.command-shell\{padding:10px 14px 14px;gap:12px\}/.test(WIDE),
    'the treatment packet rebuilt the compact wide-screen fit instead of painting over it');

  // Below 1100px nothing moved at all: the shipped HUD geometry, the tablet
  // stack and the phone cockpit are exactly the styles they shipped with.
  assert.ok(/\.core-stage\{position:relative;min-height:430px;display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/.test(code) &&
    /\.core-node\{position:relative;z-index:1;min-height:92px;padding:12px 13px 13px/.test(code) &&
    /\.core-station\{position:relative;min-width:0;padding:8px 9px 8px 11px/.test(code),
    'the shipped sub-1100px HUD geometry was rebuilt by the treatment packet');
  assert.ok(/#topology-live-body \.route-strip\{grid-template-columns:repeat\(3,minmax\(100px,1fr\)\)\}/.test(code) &&
    /\.command-shell\{grid-template-columns:1fr;grid-template-areas:"left" "center" "right" "evidence"\}/.test(code),
    'the 681–1099px tablet stack was changed by the wide-screen treatment packet');
  assert.ok(/\.core-stage\{display:flex;flex-direction:column;min-height:0\}/.test(PHONE) &&
    /\.core-path-track\{grid-template-columns:1fr\}/.test(PHONE) &&
    /\.ops-strip-cells\{grid-template-columns:1fr\}/.test(PHONE),
    'the phone cockpit was changed by the wide-screen treatment packet');
});

test('every wide HUD accent restates a canonical state word the page already prints in text', () => {
  // Canonical state tokens are reserved for boxes that carry a canonical state
  // hook. Chrome hairlines in this layer — the header rule, the panel bracket,
  // the stage graticule — use explicit low-alpha rgba precisely so that the
  // tokens keep meaning "this repeats a reported state" and nothing else.
  const stateToken = /var\(--(pass|fail|warn|blocked|active|stale|unknown|cyan)\)/;
  const stateHooks = [/\[data-run-status=/, /\[data-ops-state=/, /\.is-current\b/, /\.is-from\b/,
    /\.is-now\b/, /\.is-blocked\b/, /\.is-clear\b/, /\.is-PASS\b/, /\.is-ACTIVE\b/, /\.s-[A-Z_]+/];
  let railed = 0;
  for (const rule of hudRules()) {
    if (!stateToken.test(rule.body)) continue;
    for (const selector of rule.selectors) {
      assert.ok(stateHooks.some((hook) => hook.test(selector)),
        `${selector} paints a canonical state colour on a box that carries no canonical state hook`);
      railed++;
    }
  }
  assert.ok(railed > 0, 'the treatment layer claims status-bound accent rails but binds none to a state hook');

  // A rail may only key off a state word the shipped chip vocabulary already
  // names, so the rail and the chip printed beside it can never disagree.
  const chipStates = new Set([...code.matchAll(/\.s-([A-Z_]+)\b/g)].map((match) => match[1]));
  const railStates = [...code.matchAll(/\[data-ops-state="([A-Z_]+)"\]/g)].map((match) => match[1]);
  assert.ok(railStates.length > 0, 'no operational rail keys off a canonical state word');
  for (const state of railStates) {
    assert.ok(chipStates.has(state),
      `a status rail keys off ${state}, which the shipped .s-STATE chip vocabulary never names`);
  }

  // Colour is emphasis, never the signal. Every box this layer rails still
  // carries its own written state, and the renderers that write it are
  // untouched — so the page reads identically with colour removed.
  const source = htmlSrc();
  for (const id of ['hud-mission-state', 'hud-crew-state', 'hud-review-state', 'hud-gate-state',
    'hud-evidence-state', 'hud-checkpoint-state', 'hud-core-status']) {
    assert.ok(source.includes('id="' + id + '"'),
      `${id} lost the written state that its module's accent only repeats`);
  }
  assert.ok(/node\.setAttribute\('data-ops-state', cell\.state\)/.test(code) &&
    /node\.appendChild\(opsChip\(cell\.chip, cell\.chipPlain\)\)/.test(code),
    'an operational cell carries a status rail without the chip and state word the rail repeats');
  assert.ok(/item\.appendChild\(el\('span','core-station-mark',/.test(code),
    'a handoff station carries a rail without the written mark the rail repeats');
  // The six evidence modules are marked by identity, not by status: no rule in
  // this layer ties a module's corner tick to a run state or an ops state.
  for (const rule of hudRules()) {
    if (!rule.selectors.some((selector) => /^\.core-node/.test(selector))) continue;
    for (const selector of rule.selectors) {
      assert.ok(!/\[data-run-status=|\[data-ops-state=/.test(selector),
        `${selector} makes an evidence module's category tick change with a run state it never reported`);
    }
  }
});

test('the wide HUD surface is flat, static, asset-free, gradient-free and identical in every run state', () => {
  // This layer paints no artwork of any kind. The page already holds a global
  // invariant that no decorative gradient or CSS-art mark may enter the
  // stylesheet, and the wide treatment does not get an exemption from it: the
  // only surface it is allowed is flat colour, a border and an inset shadow.
  // Everything banned here is a way of drawing a surface that can tile, blend,
  // resolve differently as a panel resizes, or move under the page as it
  // scrolls — and a backdrop that moves reads as activity nothing reported.
  for (const banned of ['gradient(', 'url(', 'image-set(', 'element(', 'paint(', 'background-image',
    'background-size', 'background-position', 'background-repeat', 'background-attachment',
    'background-blend-mode', 'mix-blend-mode', 'filter', 'backdrop-filter', 'mask']) {
    assert.ok(!HUD.includes(banned),
      `the treatment layer builds surface with ${banned} — the HUD backdrop is flat colour, border and inset shadow only`);
  }

  // The stage still reads as a seated plate, and it gets that the only way this
  // layer may: one flat colour, and depth that is entirely inset. An OUTER
  // shadow on the stage would be a glow around the instrument field, which is a
  // light source, which is a claim that something is on.
  const stage = hudRules().filter((rule) => rule.selectors.includes('.core-stage'));
  assert.strictEqual(stage.length, 1,
    'the HUD stage backdrop is not one rule — technical surface is a backdrop, not a decoration budget');
  assert.deepStrictEqual(stage[0].selectors, ['.core-stage'],
    'the HUD stage backdrop moved onto a box that carries evidence');
  const stageDeclarations = hudDeclarations(stage[0].body);
  const stageBackground = stageDeclarations.find((declaration) => declaration.prop === 'background');
  assert.ok(stageBackground && /^#[0-9a-f]{6}$/i.test(stageBackground.value),
    'the HUD stage backdrop is not a single flat colour');
  const stageShadow = stageDeclarations.find((declaration) => declaration.prop === 'box-shadow');
  assert.ok(stageShadow, 'the HUD stage lost the inset seat that gives it depth without artwork');
  assert.ok(stageShadow.value.replace(/rgba?\([^)]*\)/g, 'C').split(',')
    .every((layer) => layer.trim().startsWith('inset')),
    'the HUD stage casts an outer shadow — its depth must be an inset seat, not a glow around the instrument field');

  // The surface is the same surface in every state. No box in this layer that
  // paints a background is selected by a run state or an operational state, so
  // a backdrop can never be read as a reading.
  for (const rule of hudRules()) {
    if (!/(?:^|;)\s*background(?:-color)?\s*:/.test(rule.body)) continue;
    for (const selector of rule.selectors) {
      assert.ok(!/\[data-run-status=|\[data-ops-state=|\.is-[A-Za-z]/.test(selector),
        `${selector} makes a surface change with a state, which turns a backdrop into an activity claim`);
    }
  }

  // The two halos this layer touches, it removes. Both removals keep the signal:
  // a panel corner never carried a reading at all, and the ACTIVE route stage
  // keeps its shipped cyan border plus its own written state word and glyph.
  assert.ok(/\.command-shell section::before,\.command-shell details\.panel::before\{[^}]*box-shadow:none/.test(HUD),
    'the panel corner bracket keeps a halo that reads as an emitting light source');
  assert.ok(/\.route-node\.is-ACTIVE\{box-shadow:inset 3px 0 0 var\(--cyan\)/.test(HUD),
    'the ACTIVE route stage keeps an outer glow instead of a crisp status rail');
  assert.ok(/\.route-node\.is-ACTIVE\{border-color:var\(--cyan\)/.test(code),
    'the ACTIVE route stage lost the shipped border that states its status alongside its word');
});

// ── command topology legibility (PKT-20260826-ASYNC-WORKER-OPERATOR-BETA) ─
// The failure guarded here is a Strategic Systems HUD that is complete and
// still unreadable: six evidence modules whose nameplate, canonical answer and
// state word are three lines of near-identical small text; six modules each
// casting the same heavy drop shadow as the panel behind them, so the
// instrument field has seven centres instead of one; and a nine-station handoff
// path whose sequence anchor is the quietest mark on the plate and whose
// stations sit as nine separate cards behind a link that stops short of the
// next one.
//
// Every proof below pairs "easier to read" with "states nothing new". The tiers
// are spacing, weight and one neutral rule; the depth is identical on all six
// modules in every run state; and the link between two stations is the same
// hairline on every link, so it can only say "these are in sequence" and never
// "this one was reached".

// Multi-layer shadows separate on commas that are never inside rgba().
function shadowLayers(value) {
  return value.replace(/rgba?\([^)]*\)/g, 'C').split(',').map((layer) => layer.trim());
}

// The widest outer blur a box casts. Inset layers are seating, not presence.
function outerBlur(value) {
  let widest = 0;
  for (const layer of shadowLayers(value)) {
    if (layer.startsWith('inset')) continue;
    const lengths = layer.match(/-?\d*\.?\d+/g) || [];
    if (lengths.length >= 3) widest = Math.max(widest, Math.abs(Number(lengths[2])));
  }
  return widest;
}

function hudShadow(selector) {
  let value = null;
  for (const rule of hudRules()) {
    if (!rule.selectors.includes(selector)) continue;
    for (const declaration of hudDeclarations(rule.body)) {
      if (declaration.prop === 'box-shadow') value = declaration.value;
    }
  }
  assert.ok(value, `the wide HUD treatment declares no box-shadow for ${selector}`);
  return value;
}

test('the AEGIS Core is the only centre of the wide HUD stage, and the six modules are seated rather than floating', () => {
  const core = outerBlur(hudShadow('.aegis-core'));
  assert.ok(core > 0, 'the AEGIS Core lost the outer presence that makes it the centre of the topology');
  const evidenceModule = outerBlur(hudShadow('.core-node'));
  assert.ok(evidenceModule <= 12,
    `each of the six evidence modules casts a ${evidenceModule}px drop shadow, so the stage reads as six competing cards rather than one topology`);
  for (const selector of ['.command-shell section', '.ops-cell', '#founder-summary']) {
    assert.ok(outerBlur(hudShadow(selector)) < core,
      `${selector} casts a heavier outer shadow than the AEGIS Core, which moves the centre of the command topology off the control plane`);
    assert.ok(evidenceModule <= outerBlur(hudShadow(selector)),
      `${selector} is now quieter than the six HUD modules, which inverts the reading order of the first screen`);
  }
  // Depth is chrome, never a reading: nothing on the stage is raised or seated
  // by a state, so a module can never look lifted because of something the run
  // reported rather than because of what it is.
  for (const rule of hudRules()) {
    if (!/box-shadow\s*:/.test(rule.body)) continue;
    for (const selector of rule.selectors) {
      if (!/^\.core-node/.test(selector) && selector !== '.core-stage' && selector !== '.aegis-core') continue;
      assert.ok(!/\[data-run-status=|\[data-ops-state=/.test(selector),
        `${selector} seats or raises a HUD box according to a state it never reported`);
    }
  }
  // Repaint bought this, not reflow: the stage, the modules and the core keep
  // the exact geometry the density layer already fits to the first screen.
  assert.ok(/\.core-node\{position:relative;z-index:1;min-height:92px;padding:12px 13px 13px/.test(code) &&
    /\.core-node\{min-height:0;padding:9px 11px 10px\}/.test(WIDE) &&
    /\.aegis-core\{width:148px;height:148px/.test(WIDE),
    'the depth hierarchy was bought by resizing a shipped box instead of by repainting it');
});

test('each HUD evidence module reads as nameplate, answer and state instead of one stack of small text', () => {
  const answer = /\.core-node \.hud-value\{([^}]*)\}/.exec(code);
  assert.ok(answer, 'the module answer rule was rebuilt away');
  assert.ok(/font-weight:500/.test(answer[1]),
    'the canonical answer carries no weight of its own, so it reads at the same level as the nameplate above it');
  assert.ok(/color:var\(--text-0\)/.test(answer[1]), 'the module answer lost the primary text token');
  const state = /\.core-node \.hud-state\{([^}]*)\}/.exec(code);
  assert.ok(state, 'the module state rule was rebuilt away');
  assert.ok(/padding-top:\d+px/.test(state[1]),
    'the module state sits flush against the answer above it, so the module is still one undifferentiated stack');
  const divider = /border-top:1px solid (#[0-9a-f]{6})/i.exec(state[1]);
  assert.ok(divider, 'the module state is not ruled off from the answer above it');
  // The divider is the nameplate's own neutral hairline, so it separates tiers
  // and can never be mistaken for a state the module did not report.
  const nameplate = /\.core-node h3\{[^}]*border-bottom:1px solid (#[0-9a-f]{6})/i.exec(code);
  assert.ok(nameplate && nameplate[1].toLowerCase() === divider[1].toLowerCase(),
    'the module divider is a colour of its own rather than the neutral hairline the nameplate already uses');
  assert.ok(!/var\(--(pass|fail|warn|blocked|active|stale|unknown|cyan)\)/.test(state[1]),
    'the module state footer is drawn with a canonical state colour, which makes a divider look like a reading');

  // The separation survives on the screen the acceptance criterion names, and
  // the density layer only tightens it — it never repaints or drops it.
  assert.ok(/\.core-node \.hud-state\{margin-top:6px;padding-top:5px\}/.test(WIDE),
    'the wide Command View drops the module state footer on the screen that most needs it');
  assert.ok(!/\.core-node \.hud-state\{[^}]*border/.test(WIDE),
    'the density layer repaints the module divider instead of inheriting it');
  assert.ok(/\.core-node \.hud-value\{[^}]*-webkit-line-clamp:3/.test(WIDE),
    'the module answer is clamped harder than the three lines the density layer already holds');

  // Nothing was made scannable by removing it: all six modules, the core status
  // and the renderer that writes every one of their canonical values are intact.
  const source = htmlSrc();
  for (const id of ['hud-mission', 'hud-mission-state', 'hud-crew', 'hud-crew-state', 'hud-review',
    'hud-review-state', 'hud-gate', 'hud-gate-state', 'hud-evidence', 'hud-evidence-state',
    'hud-checkpoint', 'hud-checkpoint-state', 'hud-core-status']) {
    assert.ok(source.includes('id="' + id + '"'), `${id} was restyled away instead of being made scannable`);
    // A module footer is written either as plain text or through the seam-aware
    // writer that also carries the exact canonical code; both are the renderer.
    assert.ok(new RegExp("hud(?:Text|State)\\('" + id + "'").test(code),
      `${id} lost the renderer that writes its canonical value`);
  }
});

test('the nine-station handoff track reads as one connected path with a legible sequence anchor', () => {
  const baseGap = /\.core-path-track\{list-style:none;[^}]*gap:(\d+)px\}/.exec(code);
  const baseLink = /\.core-station::after\{content:"";[^}]*right:-(\d+)px;top:50%;width:(\d+)px;height:1px/.exec(code);
  assert.ok(baseGap && baseLink, 'the shipped station track or the link between its stations was rebuilt away');
  assert.strictEqual(Number(baseLink[2]), Number(baseGap[1]),
    'the link between two stations is shorter than the gap it crosses, so nine plates still read as nine separate cards');
  assert.strictEqual(Number(baseLink[1]), Number(baseLink[2]),
    'the link is offset by a distance other than its own length, so it either overlaps a station or floats');
  const wideGap = /\.core-path-track\{margin-top:8px;gap:(\d+)px\}/.exec(WIDE);
  const wideLink = /\.core-station::after\{right:-(\d+)px;width:(\d+)px\}/.exec(WIDE);
  assert.ok(wideGap && wideLink, 'the wide track tightens its gap without tightening the link that crosses it');
  assert.strictEqual(Number(wideLink[2]), Number(wideGap[1]),
    'the wide Command View leaves a break in the handoff path it exists to fit onto one screen');
  assert.strictEqual(Number(wideLink[1]), Number(wideLink[2]),
    'the wide link is offset by a distance other than its own length');

  // The link is adjacency, never progress. It is one fixed hairline on every
  // link in every run state, the last canonical station has nothing after it to
  // point at, and a phone that stacks the track drops the sideways link
  // entirely rather than letting it widen the page.
  assert.ok(/\.core-station:last-child::after\{display:none\}/.test(code),
    'the final canonical station points at a tenth station that does not exist');
  for (const rule of code.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    for (const selector of rule[1].split(',').map((part) => part.trim())) {
      if (!/^\.core-station.*::after$/.test(selector)) continue;
      assert.ok(!/\.is-current|\.is-from|\[data-run-status=|\[data-ops-state=/.test(selector),
        `${selector} changes the link between two stations with a run state, which turns adjacency into progress`);
    }
  }
  assert.ok(/\.core-station::after\{display:none\}/.test(PHONE),
    'the phone stacks the track into one column and keeps a sideways link that can only push the page wider');

  // The ordinal is what the track is scanned by, and it is order only: it is
  // the list's own counter, it keeps the tested operational text token, and the
  // wide treatment lifts it with one fixed chrome colour no state can change.
  const ordinal = /\.core-station::before\{content:counter\(station\);[^}]*font:(\d+) (\d+)px[^}]*color:var\(--text-2\)\}/.exec(code);
  assert.ok(ordinal, 'the station ordinal is no longer rendered from the list counter with the tested text token');
  assert.ok(Number(ordinal[1]) >= 700 && Number(ordinal[2]) >= 10,
    `the sequence anchor is still the quietest mark on the plate (font:${ordinal[1]} ${ordinal[2]}px)`);
  assert.ok(/\.core-station::before\{color:#[0-9a-f]{6}\}/i.test(HUD),
    'the wide treatment does not lift the sequence anchor, or lifts it with something other than a fixed chrome colour');

  // Where the run actually is stays the loudest mark on the track, and both
  // marks are still the shipped inset rails beside a mark the station writes in
  // words — so the path is completely readable with colour removed.
  const current = /\.core-station\.is-current\{box-shadow:inset (\d+)px 0 0 var\(--cyan\)/.exec(HUD);
  const from = /\.core-station\.is-from\{[^}]*box-shadow:inset (\d+)px 0 0 #/.exec(HUD);
  assert.ok(current && from, 'the marked-station rails were rebuilt away');
  assert.ok(Number(current[1]) > Number(from[1]),
    'the station the run is at is marked no more strongly than the station it came from');
  assert.ok(/item\.appendChild\(el\('span','core-station-mark',/.test(code),
    'a station carries a rail without the written mark the rail only repeats');
});

// ── first-screen command-view fidelity (PKT-20260826-ASYNC-WORKER-OPERATOR-BETA) ─
// The failure guarded here is the cheapest way to make a first screen look like
// a command centre: buy the composition with something that isn't composition.
// A visual-fidelity pass is where a card quietly stops being drawn to make the
// stack look calmer, where a header control loses its hit area or its focus
// ring to make a bar look tidy, where a "premium" surface arrives as an asset,
// a gradient or an animation, and where the phone layout is sacrificed for the
// desktop reference nobody is looking at 390px on.
//
// So every proof below pairs "closer to the reference" with "the same truthful
// states, the same controls, and the same page below 1100px". The slice is
// stylesheet text in the two wide layers that already hold their own proofs —
// paint in the treatment layer, spacing and type in the density layer — so it
// touches no renderer, reads no state and can state nothing.

// Every declaration this slice adds is one of these. None of them can add,
// remove, reorder or re-source a value; they change size, rhythm and weight.
const FIDELITY_COMPOSITION = new Set(['padding', 'padding-top', 'padding-left', 'margin',
  'margin-top', 'margin-left', 'margin-right', 'gap', 'min-height', 'min-width', 'width',
  'height', 'font-size', 'line-height', 'letter-spacing']);

test('the first-screen fidelity slice composes with spacing, type and paint only, and adds no authority', () => {
  // It lives entirely inside the two wide layers. Nothing below 1100px is in
  // scope, so a phone cannot inherit a desktop composition value by accident.
  assert.ok(WIDE.length > 0 && HUD.length > 0, 'the wide Command View layers were not located');

  // The command rail: paint in the treatment layer, geometry in the density
  // layer, and no rule in either that could carry a reading.
  const rail = hudRules().filter((rule) => rule.selectors.some((selector) =>
    ['.command-header', '.view-nav', '.hud-control', '.context-cell', '.brand-sub',
      '.view-tab[aria-pressed="true"]'].includes(selector)));
  assert.ok(rail.length >= 5, 'the command rail was not seated as one instrument band');
  for (const rule of rail) {
    const target = rule.selectors.join(',');
    for (const { prop } of hudDeclarations(rule.body)) {
      assert.ok(HUD_PAINT_ONLY.has(prop),
        `the command rail declares ${prop} on ${target}, which moves or resizes chrome instead of painting it`);
    }
    assert.ok(!/var\(--(pass|fail|warn|blocked|active|stale|unknown|cyan)\)/.test(rule.body),
      `${target} paints the command rail with a canonical state colour, so chrome would read as a reading`);
    for (const selector of rule.selectors) {
      assert.ok(!/\[data-run-status=|\[data-ops-state=/.test(selector),
        `${selector} makes the command rail change with a state it never reported`);
    }
  }
  // One control height across the rail, and it is a floor, never a cap: a
  // shorter control is what makes a bar look tidy and a keyboard target vanish.
  const railHeights = new Map();
  for (const rule of wideRules()) {
    for (const { prop, value } of hudDeclarations(rule.body)) {
      if (prop !== 'min-height') continue;
      for (const selector of rule.selectors) railHeights.set(selector, value);
    }
  }
  for (const selector of ['.view-tab', '.hud-control', '.context-cell']) {
    assert.strictEqual(railHeights.get(selector), '28px',
      `${selector} does not sit on the shared command-rail control height`);
  }
  assert.ok(!/(?:^|;)\s*(?:max-height|height)\s*:/.test(WIDE.slice(WIDE.indexOf('.view-nav{'),
    WIDE.indexOf('.header-state{'))),
    'a command-rail control is capped rather than floored, which can clip its own label');

  // Composition, not deletion. Every declaration the slice adds in the density
  // layer is spacing, size or type; the layer's own proofs already ban
  // display:none, colour, shadow and !important here.
  for (const selector of ['.command-header', '.brand-lockup', '.brand-name', '.brand-sub',
    '.view-nav', '.view-tab', '.hud-control', '.header-state', '.context-cell',
    '.core-stage', '.core-node.is-review', '.core-node.is-gate', '.core-mark', '.core-sub',
    '.core-status', '.core-legend']) {
    const rule = wideRules().find((entry) => entry.selectors.includes(selector));
    assert.ok(rule, `${selector} lost its wide Command View composition rule`);
    for (const { prop } of hudDeclarations(rule.body)) {
      assert.ok(FIDELITY_COMPOSITION.has(prop),
        `${selector} declares ${prop}, which is neither spacing, size nor type`);
    }
  }

  // No asset, no artwork, no motion, no script and no second data source enters
  // with the polish.
  for (const layer of [['density', WIDE], ['treatment', HUD]]) {
    for (const banned of ['url(', 'gradient(', 'image-set(', 'filter', 'backdrop-filter',
      '@keyframes', 'animation', 'transform', 'will-change', 'setInterval', 'setTimeout',
      'requestAnimationFrame', 'Date.now', 'fetch(', 'AEGIS_STATE', '/api/']) {
      assert.ok(!layer[1].includes(banned),
        `the ${layer[0]} layer of the fidelity slice uses ${banned}`);
    }
  }
});

test('the fidelity slice keeps the AEGIS Core the centre and seats the six modules symmetrically around it', () => {
  // The core is composed, never enlarged: its diameter is still the fixed one
  // every layer around it is fitted to, so the polish cannot be paid for by
  // pushing an instrument off the screen the density layer exists to complete.
  assert.ok(/\.aegis-core\{width:148px;height:148px/.test(WIDE),
    'the AEGIS Core changed diameter, so the compact wide fit and the rim weight are no longer the ones that were proven');
  assert.ok(/\.core-mark\{font-size:\d+px;letter-spacing:/.test(WIDE) &&
    /\.core-sub\{margin-top:\d+px;letter-spacing:/.test(WIDE) &&
    /\.core-status\{margin-top:\d+px\}/.test(WIDE),
    'the control plane is still one undifferentiated stack of mark, reading and state');

  // The graticule is geometry on the stage's own decorative pseudo-elements and
  // stays clear of the core: two concentric rings, both wider than the core, so
  // neither can be mistaken for the rim that carries the run state.
  const outer = /\.core-stage::before\{width:(\d+)px;height:(\d+)px\}/.exec(WIDE);
  const inner = /\.core-stage::after\{width:(\d+)px;height:(\d+)px\}/.exec(WIDE);
  const core = /\.aegis-core\{width:(\d+)px/.exec(WIDE);
  assert.ok(outer && inner && core, 'the wide HUD graticule or the core diameter was rebuilt away');
  assert.strictEqual(outer[1], outer[2], 'the outer graticule ring is not a circle');
  assert.strictEqual(inner[1], inner[2], 'the inner graticule ring is not a circle');
  assert.ok(Number(outer[1]) > Number(inner[1]) && Number(inner[1]) > Number(core[1]),
    'the graticule no longer stands clear of the core, so a ring can be read as the core rim that carries run state');

  // Orbital seating is symmetric margin and nothing else: the same offset on
  // both flanks, on the two modules the core is widest beside, and keyed to
  // module identity rather than to anything a run reported.
  const review = /\.core-node\.is-review\{margin-right:(\d+)px\}/.exec(WIDE);
  const gate = /\.core-node\.is-gate\{margin-left:(\d+)px\}/.exec(WIDE);
  assert.ok(review && gate, 'the middle-row modules are not seated around the core');
  assert.strictEqual(review[1], gate[1],
    'the two middle-row modules stand off the core by different amounts, so the stage is no longer symmetrical about its centre');
  for (const rule of wideRules()) {
    if (!rule.selectors.some((selector) => /^\.core-node/.test(selector))) continue;
    for (const selector of rule.selectors) {
      assert.ok(!/\[data-run-status=|\[data-ops-state=|\.is-current|\.is-from/.test(selector),
        `${selector} seats an evidence module according to a state it never reported`);
    }
  }
  // The stage is still the three canonical columns with all six modules and the
  // core in it, and the density layer still refuses to re-column it.
  assert.ok(!wideSelectorsDeclaring(/grid-template-columns/).has('.core-stage'),
    'the fidelity slice re-columned the HUD stage, which splits the cockpit across two screens');
  const source = htmlSrc();
  for (const id of ['hud-mission', 'hud-crew', 'hud-review', 'hud-gate', 'hud-evidence',
    'hud-checkpoint', 'hud-core-status']) {
    assert.ok(source.includes('id="' + id + '"'), `${id} was composed away instead of being seated`);
    assert.ok(new RegExp("hudText\\('" + id + "'").test(code),
      `${id} lost the renderer that writes its canonical value`);
  }
});

test('the fidelity slice sharpens the mission brief hierarchy without promoting or hiding an answer', () => {
  // Four tiers, by type: kicker, objective headline, gate/lifecycle line, then
  // the answers. Every one of them is still rendered from the same field.
  assert.ok(/#founder-summary \.mission-kicker\{letter-spacing:/.test(WIDE) &&
    /#founder-summary \.mission-title\{font-size:\d+px;line-height:/.test(WIDE) &&
    /#founder-summary \.mission-meta\{margin-top:\d+px\}/.test(WIDE),
    'the mission brief still reads as four sizes of the same small text');
  assert.ok(/el\('div','mission-meta','Gate readiness: ' \+\n?\s*opsChipLabel\('run-state', controlState\.state\) \+/.test(code) &&
    /mission\.appendChild\(opsChip\(controlState\.state,\n?\s*opsChipLabel\('run-state', controlState\.state\)\)\)/.test(code) &&
    /objectiveDetail\.appendChild\(el\('p','mission-objective-full',deckObjective\)\)/.test(code),
    'a canonical mission fact was restyled away rather than re-tiered');

  // The three decision answers read first, and they earn it with size — never
  // by clamping, hiding or reordering the four supporting cards.
  const decision = /#founder-summary \.command-card\.is-now \.command-value,\s*#founder-summary \.command-card\.is-blocked \.command-value,\s*#founder-summary \.command-card\.is-clear \.command-value\{font-size:([\d.]+)px/.exec(WIDE);
  assert.ok(decision, 'the three decision answers carry no tier of their own');
  const base = /#founder-summary \.command-value\{margin-top:\d+px;font-size:([\d.]+)px\}/.exec(WIDE);
  assert.ok(base, 'the shared answer size was rebuilt away');
  assert.ok(Number(decision[1]) > Number(base[1]),
    'the decision answers are set no larger than the supporting cards they must be read before');
  const clamped = wideSelectorsDeclaring(/-webkit-line-clamp/);
  for (const selector of clamped) {
    assert.ok(!/\.is-now|\.is-blocked|\.is-clear/.test(selector),
      `${selector} clamps a decision answer to make room for the tier above it`);
  }
  // The supporting cards are quieter, not gone: edge colour only, no background
  // bound to a card state, and every card still in the DOM with its own label.
  const supporting = hudRules().find((rule) =>
    rule.selectors.includes('#founder-summary .command-card.is-crew'));
  assert.ok(supporting, 'the supporting mission cards were not given a quieter edge');
  for (const { prop } of hudDeclarations(supporting.body)) {
    assert.strictEqual(prop, 'border-color',
      `the supporting mission cards declare ${prop}, which is more than one step of edge contrast`);
  }
  assert.ok(/#founder-summary \.command-card\.is-now\{border-color:[^;]+;box-shadow:inset \d+px 0 0 var\(--active\)\}/.test(HUD) &&
    /#founder-summary \.command-card\.is-blocked\{[^}]*box-shadow:inset \d+px 0 0 var\(--fail\)\}/.test(HUD) &&
    /#founder-summary \.command-card\.is-clear\{[^}]*box-shadow:inset \d+px 0 0 var\(--pass\)\}/.test(HUD),
    'a decision card lost the shipped inset state bar that is its only signal');
});

test('the fidelity slice changes nothing below 1100px and removes no control, label or hit area', () => {
  // The phone cockpit, the tablet stack and the shipped base geometry are
  // exactly the styles they were: a desktop reference is not a reason to move
  // a 390px layout that nobody in the reference is looking at.
  assert.ok(/\.command-header\{min-height:72px;padding:12px 20px/.test(code) &&
    /\.core-stage\{position:relative;min-height:430px;display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/.test(code) &&
    /\.aegis-core\{position:relative;z-index:2;grid-column:2;grid-row:2;justify-self:center;width:188px;height:188px/.test(code) &&
    /\.core-node\{position:relative;z-index:1;min-height:92px;padding:12px 13px 13px/.test(code),
    'the shipped base chrome or HUD geometry was rebuilt by the fidelity slice');
  assert.ok(/\.command-shell\{grid-template-columns:1fr;grid-template-areas:"left" "center" "right" "evidence"\}/.test(code) &&
    /\.core-stage\{grid-template-columns:1fr 150px 1fr\}\.aegis-core\{width:145px;height:145px\}/.test(code),
    'the 681–1099px tablet stack was changed by the fidelity slice');
  assert.ok(/\.command-header\{display:flex;position:static/.test(PHONE) &&
    /\.core-stage\{display:flex;flex-direction:column;min-height:0\}/.test(PHONE) &&
    /\.header-state\{display:contents\}/.test(PHONE) &&
    /\.ops-strip-cells\{grid-template-columns:1fr\}/.test(PHONE),
    'the phone cockpit was changed by the fidelity slice');
  // The phone keeps its finger-sized targets, and the desktop rail's 28px floor
  // cannot reach them: it is declared above 1100px and the phone rule is both
  // later in the stylesheet and larger.
  assert.ok(/\.view-tab,\.hud-control,[^}]*\{min-height:44px\}/.test(PHONE),
    'the phone lost the 44px hit area on its view switch or its header controls');
  assert.ok(code.indexOf('@media (max-width:680px)') < code.lastIndexOf('@media (min-width:1100px)'),
    'the wide composition layer is declared before the phone rules it must never outrank');

  // Every control the rail seats is still a real control with a real label and
  // a visible keyboard focus ring.
  const source = htmlSrc();
  for (const id of ['view-command', 'view-detail', 'toggle-motion', 'ctx-entity', 'ctx-generated',
    'ctx-verdict', 'motion-state']) {
    assert.ok(source.includes('id="' + id + '"'), `${id} was removed from the command rail`);
  }
  assert.ok(/\.view-tab:focus-visible,\.hud-control:focus-visible\{outline:2px solid var\(--focus\)/.test(code),
    'the command rail controls lost their visible keyboard focus ring');
  assert.ok(/\.hud-control:disabled,\.hud-control\[aria-disabled="true"\]\{border-style:dashed/.test(code),
    'an inert command-rail control is no longer distinguishable by shape');
  assert.ok(/\.view-tab\[aria-pressed="true"\]\{background:#123149;color:#d8f5ff;box-shadow:inset 0 -2px 0 var\(--cyan\)\}/.test(code),
    'the view switch lost the shipped pressed state its repaint only deepens');
});

// ── Detail View tactical evidence surface (PKT-20260826-ASYNC-WORKER-OPERATOR-BETA) ─
// The failure guarded here is a Detail View that looks like an instrument and
// behaves like a second dashboard: a rail that reaches its own reading of what
// is happening, a plate that lights by state so the framing becomes a signal
// nothing reported, prose clamped away on the one surface the operator opened
// in order to read it whole, or a "tactical" treatment that quietly stops
// drawing a receipt the Command View still shows.
//
// The block is located by its first shipped selector rather than by a media
// query, because it deliberately has none: Detail View is the same surface at
// every width, and a breakpoint here would be a place for a receipt to vanish
// on a phone without any proof noticing.
const detailStart = code.lastIndexOf('#evidence-rail{border-color');
const DETAIL = detailStart === -1 ? '' : code.slice(detailStart, code.indexOf('</style>', detailStart));

function detailRules() {
  const rules = [];
  for (const rule of DETAIL.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    rules.push({ selectors: rule[1].split(',').map((s) => s.trim()).filter(Boolean), body: rule[2] });
  }
  return rules;
}

test('the Detail View evidence surface frames shipped receipts and hides, clamps or animates nothing', () => {
  assert.ok(DETAIL.length > 0, 'the Detail View evidence surface block was not located');
  assert.ok(detailRules().length > 0, 'the Detail View evidence surface declares no rules');
  for (const rule of detailRules()) {
    const target = rule.selectors.join(',');
    assert.ok(!/display:\s*none/.test(rule.body),
      `${target} stops drawing a receipt on the surface the operator opened to read it`);
    assert.ok(!/visibility:|content-visibility:|-webkit-line-clamp/.test(rule.body),
      `${target} hides or truncates evidence in Detail View, which is where it must be read whole`);
  }
  assert.ok(!/@keyframes/.test(DETAIL) && !/\banimation\s*:/.test(DETAIL) &&
    !/(?:^|;)\s*transition:(?!none)/.test(DETAIL),
    'the Detail View surface introduced motion — reduced motion must still have nothing here to suppress');
  // It is stylesheet text framing shipped boxes, so it carries no asset, no
  // artwork, no script, no data source and no override of a shipped signal.
  for (const banned of ['gradient(', 'url(', 'image-set(', 'element(', 'paint(', 'background-image',
    'background-size', 'background-repeat', 'filter', 'backdrop-filter', 'mask', 'clip-path',
    'setInterval', 'setTimeout', 'requestAnimationFrame', 'Date.now', 'fetch(', 'AEGIS_STATE',
    '!important']) {
    assert.ok(!DETAIL.includes(banned),
      `the Detail View surface uses ${banned} — it may only frame boxes the renderer already fills`);
  }
  // It writes no words and no glyphs of its own, so it can state nothing that
  // canonical state has not already stated inside the panel.
  for (const declared of DETAIL.matchAll(/content\s*:\s*([^;}]+)/g)) {
    assert.strictEqual(declared[1].trim(), '""',
      'the Detail View surface writes its own label or glyph into an evidence panel');
  }
  // Detail View has no breakpoint of its own, so no width can be given a
  // different set of receipts from any other width.
  assert.ok(!/@media/.test(DETAIL),
    'the Detail View surface added a breakpoint, which is a place for a receipt to disappear at one width');
});

test('the Detail View rail wraps dense receipts at every width instead of scrolling the page sideways', () => {
  // A fixed track minimum is what turns a receipt into a horizontal scrollbar
  // on the narrowest phone, and clipping it would hide the evidence that
  // overflowed along with the overflow.
  assert.ok(/#evidence-rail>\.body\{[^}]*grid-template-columns:repeat\(auto-fit,minmax\(min\(232px,100%\),1fr\)\)/.test(code),
    'the rail keeps a track minimum wider than the column it has to fit in');
  assert.ok(/\.evidence-value\{[^}]*overflow-wrap:anywhere/.test(code) &&
    /\.evidence-meta\{[^}]*overflow-wrap:anywhere/.test(code) &&
    /\.evidence-list>li\{[^}]*overflow-wrap:anywhere/.test(code),
    'a canonical subject, path or run identifier can still widen the page instead of wrapping');
  assert.ok(!/(?:^|;)\s*overflow-x:/.test(DETAIL) && !/(?:^|;)\s*overflow:/.test(DETAIL),
    'horizontal overflow is masked by clipping the rail rather than prevented by wrapping the value');
});

test('every Detail View plate is marked by receipt identity, never by a status the plate never reported', () => {
  const stateToken = /var\(--(pass|fail|warn|blocked|active|stale|unknown|cyan|hud-blue|hud-violet|orange)\)/;
  let marked = 0;
  for (const rule of detailRules()) {
    if (!stateToken.test(rule.body)) continue;
    for (const selector of rule.selectors) {
      assert.ok(!/\[data-evidence-state=|\[data-run-status=|\[data-ops-state=|\.s-[A-Z_]/.test(selector),
        `${selector} changes a Detail View plate with a run or evidence state, which turns framing into a second signal`);
      marked++;
    }
  }
  assert.ok(marked > 0, 'the Detail View surface marks no panel by category at all');
  // Colour is emphasis and never the reading: every panel prints its own
  // canonical state word as a chip with a glyph, and repeats it as a machine
  // attribute, so the rail is completely legible with colour removed.
  assert.ok(/article\.appendChild\(chip\(panel\.chip\)\)/.test(code) &&
    /article\.setAttribute\('data-evidence-state', panel\.state\)/.test(code),
    'a Detail View panel carries a category tick without the canonical state word beside it');
});

test('Detail View leads with the evidence rail and demotes deep machine state without removing either', () => {
  assert.ok(/body\[data-detail="true"\] #evidence-rail\{display:block\}/.test(code),
    'the Detail control no longer discloses the evidence rail');
  assert.ok(/body\[data-detail="true"\] #evidence-rail\{order:-1\}/.test(code),
    'Detail View does not lead with the evidence rail');
  assert.ok(/body\[data-detail="true"\] \.event-panel\{order:1\}/.test(code) &&
    /body\[data-detail="true"\] #raw-state\{order:2\}/.test(code),
    'the recent-decision log and the deep machine state are not demoted below the rail in Detail View');
  assert.ok(/\.evidence-panel\.evidence-lead\{grid-column:1\/-1/.test(code),
    'the current action is not the full-width lead instrument of the rail');
  // Reordering is not removing: every demoted panel is still rendered, and
  // Command View keeps the order and the disclosure state it shipped with.
  for (const kept of ['class="event-panel"', 'id="raw-state"', 'id="evidence-rail"']) {
    assert.ok(htmlSrc().includes(kept), `${kept} was removed rather than reordered in Detail View`);
  }
  assert.ok(!/body\[data-detail="false"\]/.test(code),
    'Command View was given rules of its own by the Detail View packet');
});

// ── DOM harness: render the REAL page source, not a copy of it ─────────────
// jsdom is not a dependency here and will not become one for a governance
// dashboard, so this is a deliberately small DOM: enough of createElement /
// appendChild / textContent / getElementById for the page's own renderers to
// run untouched, and nothing else. It executes the <script> blocks EXTRACTED
// FROM index.html, so a proof that passes here passed against the file that
// ships. If the page starts using a DOM API this shim lacks, these tests throw
// rather than silently assert against a stub.
const vm = require('vm');

function makeNode(tag) {
  const node = {
    tagName: String(tag || '').toUpperCase(),
    className: '',
    children: [],
    attrs: {},
    _text: '',
    style: {},
    dataset: {},
    appendChild(c) { this.children.push(c); return c; },
    insertBefore(c, ref) {
      const i = this.children.indexOf(ref);
      if (i === -1) this.children.push(c); else this.children.splice(i, 0, c);
      return c;
    },
    removeChild(c) {
      const i = this.children.indexOf(c);
      if (i !== -1) this.children.splice(i, 1);
      return c;
    },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
    removeAttribute(k) { delete this.attrs[k]; },
    addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); },
    querySelectorAll() { return []; },
    // Focus is observable here: the deck restores the keyboard position on a
    // disclosure summary across a repaint, and a stub focus() would let that
    // regress unnoticed.
    focus() { if (node._doc) node._doc.activeElement = node; },
    scrollIntoView() {},
    _listeners: {},
    classList: {
      contains(c) { return String(node.className).split(/\s+/).includes(c); },
    },
  };
  Object.defineProperty(node, 'textContent', {
    get() {
      if (!node.children.length) return node._text;
      return node._text + node.children.map((c) => c.textContent).join('');
    },
    set(v) { node.children.length = 0; node._text = String(v); },
  });
  Object.defineProperty(node, 'firstElementChild', { get() { return node.children[0] || null; } });
  Object.defineProperty(node, 'firstChild', { get() { return node.children[0] || null; } });
  Object.defineProperty(node, 'lastChild', { get() { return node.children[node.children.length - 1] || null; } });
  return node;
}

// Depth-first search for a node carrying an attribute, so a test can ask for
// "the connector usage line" without knowing the page's element structure.
function findByAttr(root, attr, out = []) {
  if (root.attrs && root.attrs[attr] !== undefined) out.push(root);
  (root.children || []).forEach((c) => findByAttr(c, attr, out));
  return out;
}

function pageScripts() {
  // Only inline scripts. <script src="state.js"> is the state file, which each
  // fixture supplies directly as window.AEGIS_STATE.
  const out = [];
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(htmlSrc())) !== null) out.push(m[1]);
  assert.ok(out.length >= 2, 'expected the renderer and the switchboard script blocks in the page');
  return out;
}

// Boot the page against a fixture. Returns the sandbox plus the captured SSE
// listeners, so a test can push a status event exactly as the server would.
function bootPage(state, opts = {}) {
  const byId = new Map();
  const document = {
    activeElement: null,
    getElementById(id) {
      if (!byId.has(id)) { const n = makeNode('div'); n.attrs.id = id; n._doc = document; byId.set(id, n); }
      return byId.get(id);
    },
    createElement: (t) => { const n = makeNode(t); n._doc = document; return n; },
    createTextNode(t) { const n = makeNode('#text'); n._text = String(t); return n; },
    addEventListener() {},
    body: makeNode('body'),
  };
  const sse = { listeners: {}, opened: false };
  const sandbox = {
    document,
    console: { log() {}, error() {} },
    Date,
    JSON,
    Math,
    Object,
    Array,
    String,
    Number,
    Boolean,
    RegExp,
    Error,
    Promise,
    fetch: opts.fetch || (async () => ({ ok: true, json: async () => opts.status || {} })),
    EventSource: function () {
      sse.opened = true;
      return {
        addEventListener(type, fn) { (sse.listeners[type] = sse.listeners[type] || []).push(fn); },
        // The transport handlers are captured rather than dropped, so a proof
        // can open and drop the stream exactly as the browser does — and can
        // therefore observe what the page claims from transport alone.
        set onerror(f) { sse.onerror = f; }, set onopen(f) { sse.onopen = f; },
      };
    },
  };
  sandbox.window = sandbox;
  sandbox.window.AEGIS_STATE = state;
  // Device-level presentation preferences the page reads but cannot set:
  // width and prefers-reduced-motion. A fixture may supply its own resolver so
  // a proof can boot the page as the device it is claiming to describe; the
  // default answers "no" to everything, which is the shipped desktop case.
  sandbox.window.matchMedia = opts.matchMedia || (() => ({ matches: false }));
  vm.createContext(sandbox);
  for (const src of pageScripts()) vm.runInContext(src, sandbox, { filename: 'dashboard/index.html' });
  return { sandbox, document, byId, sse, text: (id) => document.getElementById(id).textContent };
}

// Feed the public /api/status shape through the actual live switchboard seam.
// The fixture remains a minimized flat API payload, never the projector
// envelope, and any bootstrap/SSE mapping regression is therefore observable.
function renderMinimizedStatus(page, status) {
  page.sandbox.AEGIS_DASHBOARD.applyStatus(status);
}

// Fixture builders — deliberately explicit, so what each proof assumes is
// visible in the proof rather than buried in a shared blob.
function fixtureState(over) {
  const base = {
    generatedAt: '2026-08-25T23:00:00.000Z',
    contract: { absences: ['UNAVAILABLE', 'STALE', 'UNVERIFIED'] },
    engineering: {
      state: 'OK', verdict: 'BLOCKED', lane: 'FULL', highRisk: true,
      laneWhy: ['a high-risk signal is present'],
      riskReasons: ['touches a protected path'],
      subjectSha256: 'aaaaaaaaaaaabbbbbbbbbbbbcccccccccccc',
      subjectPaths: ['builder-control/dashboard/index.html'],
      problems: [{ rule: 'ENGOS-REVIEW-MISSING', detail: 'grok is required and has no review bound to this subject.' }],
      reviewerCompleteness: { complete: false, rows: [] },
      stages: [], source: 'builder-control/engineering-os.cjs',
    },
    integration: { connectors: { state: 'OK', connectors: [] } },
    knowledge: { state: 'OK', records: [] },
    reviewers: { state: 'OK', reviewers: [] },
    cost: { state: 'UNAVAILABLE', reason: 'no transcripts' },
    runs: { state: 'OK', runs: [], current: { state: 'UNAVAILABLE', runId: null,
      evidenceState: 'OK', reason: 'no run records exist yet, so no run is current.' } },
    events: { state: 'OK', events: [] },
  };
  return Object.assign(base, over || {});
}

function connectorFixture(lastUsedByRun) {
  return {
    connectorId: 'c1', label: 'Test connector', provider: 'test', plane: 'INTEGRATION',
    executionPath: 'mcp', authStatus: 'AUTHENTICATED', health: 'HEALTHY',
    staleness: { state: 'FRESH' }, capabilities: [], declaredNotSupported: [],
    failureCount: 0, riskLevel: 'LOW', legacy: false, source: 'builder-control/connector-registry.json',
    lastUsedByRun,
  };
}

// ── event history reads as recorded receipts, not a product scoreboard ─────
test('DOM: every event row leads with its recorded historical result and keeps the exact receipt', () => {
  const events = [
    { entryId: 'E1', ts: '2026-08-27T12:00:00.000Z', gate: 'aegis-run', status: 'PASS' },
    { entryId: 'E2', ts: '2026-08-27T12:01:00.000Z', gate: 'build', status: 'BLOCKED', blockRule: 'ENGOS-REVIEW-MISSING' },
    { entryId: 'E3', ts: '2026-08-27T12:02:00.000Z', gate: 'aegis-check-receipt', status: 'FAILED' },
    { entryId: 'E4', ts: '2026-08-27T12:03:00.000Z', gate: 'aegis-marc-decision', status: 'SUPERSEDED' },
    { entryId: 'E5', ts: '2026-08-27T12:04:00.000Z', gate: 'aegis-run' },
  ];
  const list = bootPage(fixtureState({ events: { state: 'OK', events } })).document.getElementById('events');
  assert.strictEqual(list.children.length, events.length, 'the event panel dropped, added or merged recorded rows');
  const rows = list.children.map((li) => ({
    outcome: li.children[0].children[0].textContent,
    receipt: li.children[0].children[1].textContent,
    ts: li.children[0].children[2].textContent,
    badge: li.children[1].textContent,
  }));

  // Every recorded result reads differently from the others. A PASS receipt in
  // particular must not read as "this works now".
  assert.strictEqual(new Set(rows.map((r) => r.outcome)).size, events.length,
    'recorded outcomes are not distinguishable from one another');
  assert.match(rows[0].outcome, /^Recorded PASS — aegis-run was recorded as passed on this dated receipt\./);
  assert.match(rows[0].outcome, /not a statement of current readiness/);
  assert.match(rows[1].outcome, /^Recorded BLOCKED — a rule stopped Build on this dated receipt\./);
  assert.match(rows[1].outcome, /not a current permission/);
  assert.match(rows[2].outcome, /^Recorded FAILED — aegis-check-receipt broke on this dated receipt\./);
  assert.match(rows[3].outcome, /^Recorded SUPERSEDED — this page does not recognise that outcome word/);
  assert.match(rows[4].outcome, /^Outcome unavailable — this receipt records no result word\./);

  // The exact evidence still travels with the sentence, in order.
  assert.strictEqual(rows[0].receipt, 'aegis-run', 'an unfamiliar gate name was rewritten');
  assert.strictEqual(rows[1].receipt, 'build · ENGOS-REVIEW-MISSING', 'the exact gate and block rule were not preserved');
  rows.forEach((r, i) => assert.strictEqual(r.ts, events[i].ts, `row ${i} lost its recorded timestamp or order`));
  assert.match(rows[3].badge, /SUPERSEDED$/, 'the exact recorded status badge was not preserved');
  assert.match(rows[4].badge, /UNKNOWN$/, 'a receipt with no status lost its UNKNOWN badge');
});

test('DOM: an event history that is empty says so, and one that could not be read keeps its exact reason', () => {
  const emptyText = bootPage(fixtureState({ events: { state: 'OK', events: [] } })).text('events');
  assert.match(emptyText, /No gate decisions are recorded yet\. The history was read and it holds no events\./);
  assert.doesNotMatch(emptyText, /UNAVAILABLE/, 'an available empty history was reported as unreadable');

  const unreadable = bootPage(fixtureState({
    events: { state: 'UNAVAILABLE', reason: 'ledger unreadable: Unexpected token }', events: [] },
  })).text('events');
  assert.match(unreadable, /UNAVAILABLE — ledger unreadable: Unexpected token \}/);
  assert.doesNotMatch(unreadable, /No gate decisions are recorded yet/,
    'an unreadable history was reported as an empty one');
});

test('DOM: an event receipt missing its gate or timestamp states the absence instead of printing undefined', () => {
  const text = bootPage(fixtureState({
    events: { state: 'OK', events: [{ entryId: 'E1', status: 'PASS' }] },
  })).text('events');
  assert.doesNotMatch(text, /undefined|null/, 'a missing event field reached the page as a machine value');
  assert.match(text, /Gate unavailable — this receipt names no gate\./);
  assert.match(text, /Timestamp unavailable — this receipt carries no time\./);
  assert.match(text, /Recorded PASS — an unnamed gate was recorded as passed/);
});

test('event history rows wrap long gate names and rules instead of widening the page', () => {
  assert.match(code, /#events \.row>div:first-child\{min-width:0/,
    'the event row text column can be stretched by one long recorded value');
  assert.match(code, /#events \.name,#events \.meta\{overflow-wrap:anywhere\}/,
    'event names and receipts do not wrap at every width');
});

test('DOM: Command and Detail controls execute the real disclosure switch', () => {
  const page = bootPage(fixtureState());
  const command = page.document.getElementById('view-command');
  const detail = page.document.getElementById('view-detail');
  const raw = page.document.getElementById('raw-state');
  assert.strictEqual((detail._listeners.click || []).length, 1,
    'Detail view has no executable click handler');
  assert.strictEqual((command._listeners.click || []).length, 1,
    'Command view has no executable click handler');

  detail._listeners.click[0]();
  assert.strictEqual(page.document.body.getAttribute('data-detail'), 'true',
    'Detail view did not switch the real page disclosure state');
  assert.strictEqual(detail.getAttribute('aria-pressed'), 'true',
    'Detail view did not expose its selected state');
  assert.strictEqual(command.getAttribute('aria-pressed'), 'false',
    'Command view remained selected after Detail view activation');
  assert.strictEqual(raw.open, true, 'Detail view did not open the real evidence disclosure');

  command._listeners.click[0]();
  assert.strictEqual(page.document.body.getAttribute('data-detail'), 'false',
    'Command view did not restore the command-first disclosure state');
  assert.strictEqual(command.getAttribute('aria-pressed'), 'true',
    'Command view did not expose its selected state');
  assert.strictEqual(detail.getAttribute('aria-pressed'), 'false',
    'Detail view remained selected after Command view activation');
  assert.strictEqual(raw.open, false, 'Command view did not close the deep evidence disclosure');
});

// The Detail View rail, in the order an operator reads it: what is being done
// now, which exact code version that is, which paths changed, what the
// deterministic checks recorded, what independent review covers, what it cost,
// and where the last safe checkpoint is.
const DETAIL_PANEL_ORDER = ['action', 'subject', 'paths', 'checks', 'review', 'cost', 'checkpoint'];

function evidencePanels(page) {
  return findByAttr(page.document.getElementById('evidence-rail-body'), 'data-evidence-panel');
}

function evidencePanelsById(page) {
  return Object.fromEntries(evidencePanels(page).map((panel) => [panel.attrs['data-evidence-panel'], panel]));
}

function evidencePanelValue(panel) {
  const value = allNodes(panel).find((node) => String(node.className) === 'evidence-value');
  assert.ok(value, `evidence panel ${panel.attrs['data-evidence-panel']} rendered no value`);
  return value.textContent;
}

test('DOM: Detail View leads with the canonical current action and then the seven receipts in operator order', () => {
  const run = {
    runId: 'RUN-DETAIL', state: 'BUILDING', objective: 'Refine the AEGIS Detail View',
    updatedAt: '2026-08-27T14:10:00.000Z',
    build: {
      mode: 'async', status: 'RUNNING', workerPid: 4242,
      startedAt: '2026-08-27T14:00:00.000Z', endedAt: null,
      activity: { active: true, summary: 'Refining the founder-readable evidence surface.' },
    },
  };
  const page = bootPage(fixtureState({
    generatedAt: '2026-08-27T14:10:00.000Z',
    runs: { state: 'OK', runs: [run], current: {
      state: 'BOUND', runId: run.runId, updatedAt: run.updatedAt, reason: 'exact current run is bound',
    } },
  }));
  const panels = evidencePanels(page);
  assert.deepStrictEqual(panels.map((panel) => panel.attrs['data-evidence-panel']), DETAIL_PANEL_ORDER,
    'the Detail View rail no longer prioritizes the operator questions in order');

  const lead = panels[0];
  assert.ok(lead.classList.contains('evidence-lead'),
    'the current action is not rendered as the full-width lead instrument');

  // One authority: the lead prints the exact sentence the Command View
  // CURRENT ACTION card prints, and the exact control state the shell carries,
  // so the two surfaces cannot answer "what is happening" differently.
  const deckCurrentAction = findByAttr(page.document.getElementById('founder-body'), 'data-operator-field')
    .find((node) => node.attrs['data-operator-field'] === 'current-action');
  assert.ok(deckCurrentAction, 'the Command View CURRENT ACTION card was not rendered to compare against');
  assert.ok(deckCurrentAction.textContent.endsWith(evidencePanelValue(lead)),
    `the rail derived its own current action: ${evidencePanelValue(lead)}`);
  assert.strictEqual(lead.attrs['data-evidence-state'],
    page.document.getElementById('operator-shell').attrs['data-run-status'].toUpperCase(),
    'the rail lead states a control-plane verdict the shell never recorded');
  assert.match(lead.textContent, /Bound run: RUN-DETAIL/, 'the rail lead does not name the bound run');
  assert.match(lead.textContent, /Next governed action: \S/,
    'the rail lead does not carry the next governed action the gate module already states');
  assert.match(lead.textContent, /Refining the founder-readable evidence surface\./,
    'the rail lead lost the canonical builder activity the deck already renders');
});

test('DOM: an unbound Detail View states every missing receipt as missing and invents no run, cost or checkpoint', () => {
  const page = bootPage(fixtureState());
  const panels = evidencePanelsById(page);
  assert.deepStrictEqual(Object.keys(panels).sort(), [...DETAIL_PANEL_ORDER].sort(),
    'an unbound Detail View drops a receipt instead of reporting it as unavailable');
  assert.match(panels.action.textContent, /Bound run: UNAVAILABLE — no run is bound to this page\./,
    'the rail lead invented a bound run');
  assert.strictEqual(panels.subject.attrs['data-evidence-state'], 'BINDING_UNAVAILABLE');
  assert.match(evidencePanelValue(panels.subject),
    /AEGIS cannot confirm an exact code-version binding for the current run\./,
    'an unproven code-version binding is not stated as unproven');
  assert.strictEqual(panels.checks.attrs['data-evidence-state'], 'UNAVAILABLE');
  assert.match(panels.checks.textContent, /no deterministic check result can be attributed/,
    'a run that recorded no checks is not reported as unattributable');
  assert.strictEqual(panels.review.attrs['data-evidence-state'], 'UNAVAILABLE');
  assert.match(panels.cost.textContent, /CAD UNAVAILABLE — no transcripts/,
    'an absent cost projection is not stated as unavailable');
  const rail = page.text('evidence-rail-body');
  assert.ok(!/CAD 0|\$0|0 checks passed|no changes/i.test(rail),
    'an absent figure or absent receipt was back-filled as a zero or as an empty change');
});

function passingReviewCompleteness(subject = 'a'.repeat(64), paths = ['builder-control/dashboard/index.html']) {
  return {
    subjectSha256: subject,
    required: ['codex'],
    complete: true,
    pathCoverage: {
      total: paths.length,
      coveredByEveryRequiredReviewer: paths.slice(),
      notCoveredByEveryRequiredReviewer: [],
    },
    rows: [{
      reviewer: 'codex', required: 'REQUIRED', executed: 'EXECUTED', disposition: 'APPROVE',
      coveredPaths: paths.slice(), missingPaths: [], stalePaths: [],
    }],
  };
}

test('DOM: an unbound dashboard leads with a truthful idle mission and a dominant next action', () => {
  const page = bootPage(fixtureState());
  const body = page.text('founder-body');
  for (const phrase of [
    'No active task',
    'Nothing is currently running.',
    'No worker is assigned.',
    'Not running.',
    'Enter an objective and start a governed build.',
    'No blocker — no run has started.',
    'No run is active.',
  ]) {
    assert.ok(body.includes(phrase), `idle pilot deck is missing: ${phrase}`);
  }
  assert.strictEqual(page.document.getElementById('operator-shell').attrs['data-run-status'], 'idle',
    'the shell must expose truthful idle state so the objective composer becomes the dominant action');
  assert.ok(/IDLE/.test(page.text('ctx-verdict')), 'the header must say IDLE rather than inherit a stale gate verdict');
});

test('DOM: minimized empty live status with unavailable run evidence never renders clean idle', () => {
  const page = bootPage(fixtureState());
  const status = {
    generatedAt: '2026-08-29T00:05:00.000Z',
    engineering: { state: 'UNAVAILABLE', reason: 'the engineering snapshot is unavailable' },
    integration: { connectors: [] }, reviewers: [],
    cost: { state: 'UNAVAILABLE', reason: null },
    runs: [],
    runsBinding: { state: 'UNAVAILABLE', runId: null, updatedAt: null,
      reason: 'the engineering snapshot is unavailable, so no run could be bound' },
    events: [], knowledge: { state: 'UNKNOWN', conflicts: null },
  };
  renderMinimizedStatus(page, status);
  const body = page.text('founder-body');
  assert.ok(/UNAVAILABLE/.test(page.text('ctx-verdict')) && !/IDLE/.test(page.text('ctx-verdict')),
    `an unavailable empty live projection rendered a healthy idle header: ${page.text('ctx-verdict')}`);
  assert.strictEqual(page.text('hud-core-status'), RUN_STATE_PLAIN.UNAVAILABLE,
    'AEGIS Core rendered healthy idle without positive run-ledger evidence');
  assert.strictEqual(page.document.getElementById('operator-shell').attrs['data-run-status'], 'unavailable',
    'the shell rendered clean idle without positive run-ledger evidence');
  assert.ok(/Blocking status unavailable/.test(body),
    'the pilot deck omitted the unavailable run/binding warning');
  assert.ok(!/No blocker — no run has started\./.test(body),
    'an empty array was treated as proof that no run exists');
  assert.match(page.text('runs-list'), /Run history UNAVAILABLE/i);
  assert.doesNotMatch(page.text('runs-list'), /No runs yet/i,
    'unavailable ledger evidence rendered the affirmative empty-history message');
});

test('DOM: a genuinely empty minimized live status stays truthful without a top-level runsState field', () => {
  const page = bootPage(fixtureState());
  const status = {
    generatedAt: '2026-08-29T00:06:00.000Z',
    engineering: fixtureState().engineering,
    integration: { connectors: [] }, reviewers: [],
    cost: { state: 'UNAVAILABLE', reason: null },
    runs: [],
    runsBinding: { state: 'UNAVAILABLE', runId: null, updatedAt: null,
      evidenceState: 'OK', reason: 'no run records exist yet, so no run is current.' },
    events: [], knowledge: { state: 'UNKNOWN', conflicts: null },
  };
  assert.ok(!Object.prototype.hasOwnProperty.call(status, 'runsState'),
    'the fixture must exercise the pinned minimized contract, which has no runsState field');
  renderMinimizedStatus(page, status);
  const body = page.text('founder-body');
  assert.ok(/IDLE/.test(page.text('ctx-verdict')),
    `affirmatively empty live evidence did not remain idle: ${page.text('ctx-verdict')}`);
  assert.strictEqual(page.text('hud-core-status'), RUN_STATE_PLAIN.IDLE);
  assert.strictEqual(page.document.getElementById('operator-shell').attrs['data-run-status'], 'idle');
  assert.ok(/No blocker — no run has started\./.test(body));
  assert.ok(/READY FOR AN OBJECTIVE/.test(page.text('hud-system-health')));
  assert.match(page.text('runs-list'), /No runs yet\. Record an objective above\./,
    'affirmative clean-empty evidence did not render the empty-history message');
});

test('DOM: malformed run evidence is unavailable and never lights the clean-idle instruments', () => {
  const page = bootPage(fixtureState());
  const status = {
    generatedAt: '2026-08-29T00:07:00.000Z',
    engineering: Object.assign({}, fixtureState().engineering, {
      stages: [{ id: 'surface', step: 11, label: 'Evidence', state: 'UNVERIFIED',
        reason: 'surface gaps: run evidence unavailable' }],
    }),
    integration: { connectors: [] }, reviewers: [],
    cost: { state: 'UNAVAILABLE', reason: null },
    runs: [],
    runsBinding: { state: 'UNAVAILABLE', runId: null, updatedAt: null,
      evidenceState: 'UNAVAILABLE',
      reason: '1 run record(s) could not be read or validated, so current run status is unavailable.' },
    events: [], knowledge: { state: 'UNKNOWN', conflicts: null },
  };
  renderMinimizedStatus(page, status);
  const body = page.text('founder-body');
  assert.ok(/UNAVAILABLE/.test(page.text('ctx-verdict')) && !/IDLE/.test(page.text('ctx-verdict')),
    `malformed evidence rendered clean idle: ${page.text('ctx-verdict')}`);
  assert.strictEqual(page.text('hud-core-status'), RUN_STATE_PLAIN.UNAVAILABLE);
  assert.notStrictEqual(page.text('hud-system-health'), 'READY FOR AN OBJECTIVE');
  assert.strictEqual(page.document.getElementById('operator-shell').attrs['data-run-status'], 'unavailable');
  assert.ok(/could not be read or validated/.test(body),
    `the founder cannot see why run status is unavailable: ${body}`);
  assert.ok(!/No blocker — no run has started\./.test(body));
  assert.match(page.text('runs-list'), /Run history UNAVAILABLE/i);
  assert.doesNotMatch(page.text('runs-list'), /No runs yet/i,
    'malformed run evidence rendered the affirmative empty-history message');
});

// ── run history: objective first, recorded outcome second, evidence third ────
// Every attempt used to lead with its run id, so the reader had to decode
// RUN-2026… before learning what the attempt was for or what came of it. These
// proofs pin the reading order AND its truthfulness: passed checks are stated
// as passed checks and nothing more, and finished, failed, running,
// self-contradicting and unrecognised evidence each keep a distinct sentence.
const HISTORY_BINDING = { state: 'BOUND', runId: 'RUN-HISTORY-PASSED',
  updatedAt: '2026-09-03T09:00:00.000Z', evidenceState: 'OK', reason: 'bound to current run' };

function historyRuns() {
  return [
    { runId: 'RUN-HISTORY-PASSED', state: 'CHECKS_PASSED',
      objective: 'Read the run ledger at a glance', updatedAt: '2026-09-03T09:00:00.000Z',
      checks: { passed: 4, total: 4, outcome: 'PASS' } },
    { runId: 'RUN-HISTORY-FAILED', state: 'CHECKS_FAILED',
      objective: 'Stop this attempt on a failed check', updatedAt: '2026-09-03T09:01:00.000Z' },
    { runId: 'RUN-HISTORY-RUNNING', state: 'BUILDING',
      objective: 'Keep the governed builder working', updatedAt: '2026-09-03T09:02:00.000Z',
      build: { status: 'RUNNING', activity: { code: 'AUTHORIZED_WRITE', phase: 'BUILD',
        active: true, summary: 'The builder is editing an allowed file.' } } },
    { runId: 'RUN-HISTORY-CONTRADICTED', state: 'BUILDING',
      objective: 'Say so when the record contradicts itself', updatedAt: '2026-09-03T09:03:00.000Z',
      build: { status: 'RUNNING', exit: 124, activity: { code: 'AUTHORIZED_WRITE', phase: 'BUILD',
        active: true, summary: 'The builder is editing an allowed file.' } } },
    { runId: 'RUN-HISTORY-UNNAMED', state: 'CORRECTING',
      objective: 'Carry a state the outcome sentences do not name',
      updatedAt: '2026-09-03T09:04:00.000Z' },
  ];
}

function historyCards(runs, binding) {
  const page = bootPage(fixtureState());
  page.sandbox.AEGIS_DASHBOARD.renderRuns(runs, binding === undefined ? HISTORY_BINDING : binding, 'OK');
  return { page, cards: page.document.getElementById('runs-list').children };
}

test('DOM: every run card leads with its objective and a plain-English recorded outcome', () => {
  const { cards } = historyCards(historyRuns());
  assert.strictEqual(cards.length, 5, 'run history dropped or duplicated a canonical attempt');
  assert.deepStrictEqual(cards.map((card) => card.children[0].tagName),
    ['H3', 'H3', 'H3', 'H3', 'H3'], 'something other than the objective leads the card');
  assert.deepStrictEqual(cards.map((card) => card.children[0].textContent),
    historyRuns().map((run) => run.objective),
    'the run id, not the objective, still leads the card');
  const outcomes = cards.map((card) => card.children[1].textContent);
  assert.deepStrictEqual(outcomes, [
    'The build finished and its automated checks passed.',
    'Nothing finished — this run stopped on a failed check.',
    'Nothing has finished yet — the assigned worker is still building this change.',
    'Nothing has finished yet — the assigned worker is still building this change.',
    'UNAVAILABLE — canonical run evidence does not record what finished.',
  ], 'the recorded outcomes are not distinct plain-English readings of each canonical state');
  // Passed checks are build-and-check evidence. They are not delivery,
  // integration, or a safe checkpoint, and this card may never say they are.
  assert.doesNotMatch(outcomes[0], /shipp|integrat|deploy|merge|checkpoint|safe/i,
    `CHECKS_PASSED was described as more than passing checks: ${outcomes[0]}`);
  assert.deepStrictEqual(cards.map((card) => card.children[1].attrs['data-run-outcome']),
    ['CHECKS_PASSED', 'CHECKS_FAILED', 'BUILDING', 'BUILDING', 'CORRECTING'],
    'the outcome line is no longer marked with the canonical state it reads');
  // A run still recorded as BUILDING whose worker already exited is the one
  // case the outcome sentence cannot describe, so the existing lifecycle
  // reading is stated beside it — and the genuinely running run is not padded
  // with a second sentence that repeats what the first already said.
  assert.strictEqual(cards[3].children[2].textContent,
    'The run still says building, but the builder has already recorded terminal exit 124.',
    'a run contradicting its own worker evidence was left claiming it is still building');
  assert.strictEqual(cards[2].children[2].attrs['data-run-evidence'], 'RUN-HISTORY-RUNNING',
    'the running run gained a redundant lifecycle line ahead of its evidence');
});

test('DOM: the exact run id, glyph, canonical state and recorded time stay readable on every card', () => {
  const { cards } = historyCards(historyRuns());
  assert.deepStrictEqual(cards.map((card) => findByAttr(card, 'data-run-evidence')[0].textContent), [
    'RUN-HISTORY-PASSED  ● CHECKS_PASSED · updated 2026-09-03T09:00:00.000Z',
    'RUN-HISTORY-FAILED  ✕ CHECKS_FAILED · updated 2026-09-03T09:01:00.000Z',
    'RUN-HISTORY-RUNNING  ◐ BUILDING · updated 2026-09-03T09:02:00.000Z',
    'RUN-HISTORY-CONTRADICTED  ◐ BUILDING · updated 2026-09-03T09:03:00.000Z',
    'RUN-HISTORY-UNNAMED  ▲ CORRECTING · updated 2026-09-03T09:04:00.000Z',
  ], 'an exact run identifier, state glyph or recorded time is no longer readable on the card');
  // The bound current run keeps the control the binding authorizes.
  assert.ok(allNodes(cards[0]).some((node) => node.tagName === 'BUTTON' &&
    node.textContent === 'Verify independent review'),
  'the bound CHECKS_PASSED run lost its permission-checked review control');
  assert.ok(!allNodes(cards[1]).some((node) => node.tagName === 'BUTTON' &&
    node.textContent === 'Verify independent review'),
  'an unbound run gained a control its binding does not authorize');
});

test('DOM: missing and unrecognised run evidence stays UNAVAILABLE, with controls and warnings intact', () => {
  const { cards } = historyCards([
    { runId: 'RUN-HISTORY-BARE', state: 'REVIEW_FAILED', updatedAt: null,
      checks: { passed: 2, total: 3, outcome: 'FAIL' },
      reviewFailure: { summary: 'codex refused this exact code version.' } },
    { runId: 'RUN-HISTORY-UNMAPPED', state: 'constructor', objective: 'Probe the glyph map' },
  ], { state: 'UNAVAILABLE', runId: null, reason: 'no run is bound' });
  assert.strictEqual(cards[0].children[0].textContent,
    'UNAVAILABLE — no objective is recorded for this run.',
    'a missing objective was filled in rather than reported absent');
  assert.strictEqual(cards[0].children[1].textContent,
    'Nothing finished — this run stopped on independent review.',
    'the review-failed outcome is not stated in plain English');
  assert.strictEqual(findByAttr(cards[0], 'data-run-evidence')[0].textContent,
    'RUN-HISTORY-BARE  ✕ REVIEW_FAILED · updated UNAVAILABLE',
    'an unrecorded time was invented rather than reported absent');
  assert.strictEqual(cards[1].children[1].textContent,
    'UNAVAILABLE — canonical run evidence does not record what finished.',
    'an unrecognised state resolved to an inherited sentence about finished work');
  assert.strictEqual(findByAttr(cards[1], 'data-run-evidence')[0].textContent,
    'RUN-HISTORY-UNMAPPED  ? constructor · updated UNAVAILABLE',
    'an unrecognised state resolved to an inherited member of the glyph map');
  // Nothing the card carried before the reordering was dropped.
  assert.match(cards[0].textContent, /checks: 2\/3 · FAIL/,
    'the exact check counters left the card');
  assert.match(cards[0].textContent, /codex refused this exact code version\./,
    'the review-failure warning left the card');
  const buttons = allNodes(cards[0]).filter((node) => node.tagName === 'BUTTON');
  assert.deepStrictEqual(buttons.map((node) => node.textContent), ['Pause', 'Cancel', 'Retry'],
    'the existing run controls were lost, reordered or duplicated by the reordering');
  assert.strictEqual(buttons[0].disabled, true, 'Pause stopped being disabled');
});

test('DOM: a running build shows its mission, current action, elapsed evidence, next step and blocker without inventing a model', () => {
  const run = {
    runId: 'RUN-PILOT', state: 'BUILDING', objective: 'Improve the AEGIS operator dashboard',
    updatedAt: '2026-08-27T14:10:00.000Z',
    build: {
      mode: 'async', status: 'RUNNING', workerPid: 4242,
      startedAt: '2026-08-27T14:00:00.000Z', endedAt: null,
      activity: { active: true, summary: 'Refining the founder-readable mission controls.' },
    },
  };
  const state = fixtureState({
    generatedAt: '2026-08-27T14:10:00.000Z',
    engineering: Object.assign({}, fixtureState().engineering, {
      reviewerCompleteness: { complete: false, rows: [{
        reviewer: 'grok', job: 'adversarial reviewer', required: 'REQUIRED', executed: 'MISSING',
        disposition: null, score: 'UNAVAILABLE', coveredPaths: [], missingPaths: [], stalePaths: [],
      }] },
    }),
    runs: { state: 'OK', runs: [run], current: {
      state: 'BOUND', runId: run.runId, updatedAt: run.updatedAt,
      reason: 'exact current run is bound',
    } },
  });
  const page = bootPage(state);
  const body = page.text('founder-body');
  for (const phrase of [
    'Improve the AEGIS operator dashboard',
    'Governed builder active · model identity UNAVAILABLE in current status evidence.',
    'Refining the founder-readable mission controls.',
    '10 minutes as of the latest evidence.',
    'Wait for the governed builder to finish this change.',
    'run only the deterministic checks this packet declares.',
    '1 unresolved gate requirement',
    'No safe checkpoint is recorded for this run.',
  ]) {
    assert.ok(body.includes(phrase), `running pilot deck is missing: ${phrase}`);
  }
  // While the canonical state is BUILDING there is no builder result to review,
  // so no reviewer may be named as the next or current stage.
  const buildingNext = findByAttr(page.document.getElementById('founder-body'), 'data-operator-field')
    .find((node) => node.attrs['data-operator-field'] === 'next-step');
  assert.ok(buildingNext && !/review/i.test(buildingNext.textContent),
    `BUILDING claimed a review stage as the next step: ${buildingNext && buildingNext.textContent}`);
  assert.ok(!/Get \S+ to review this exact change/.test(body),
    'BUILDING named an independent reviewer as the pending action');
  assert.ok(!/Claude|Opus/.test(body), 'the dashboard inferred a model that current run evidence does not name');
  assert.strictEqual(page.document.getElementById('operator-shell').attrs['data-run-status'], 'running');
});

test('DOM: routed Command View renders canonical pilot cards and accessible plain-English workflow state', () => {
  const run = {
    runId: 'RUN-COMMAND-DOM', state: 'BUILDING', objective: 'Render the governed Command View',
    updatedAt: '2026-08-27T14:10:00.000Z', transitions: 4,
    route: { model: 'claude-opus-5', execution: 'claude-cli', source: 'tool-router.cjs routeRole' },
    build: { mode: 'async', status: 'RUNNING', workerPid: 4242,
      startedAt: '2026-08-27T14:00:00.000Z', endedAt: null,
      activity: { active: true, summary: 'Building the operator controls.' } },
  };
  const state = fixtureState({
    generatedAt: '2026-08-27T14:10:00.000Z',
    engineering: Object.assign({}, fixtureState().engineering, { stages: [
      { id: 'build', step: 5, label: 'Builder execution', state: 'ACTIVE',
        reason: 'the governed worker is still running' },
    ] }),
    runs: { state: 'OK', runs: [run], current: {
      state: 'BOUND', runId: run.runId, updatedAt: run.updatedAt, reason: 'canonical current run',
    } },
  });
  const page = bootPage(state);
  const founder = page.document.getElementById('founder-body');
  const fields = Object.fromEntries(findByAttr(founder, 'data-operator-field')
    .map((node) => [node.attrs['data-operator-field'], node.textContent]));
  assert.match(page.text('founder-body'), /Render the governed Command View/,
    'the rendered Mission card lost the canonical objective');
  assert.match(fields['crew-/-model'], /claude-opus-5 · claude-cli · Selected by AEGIS/,
    'the rendered Crew / Model card did not use canonical routing evidence');
  assert.match(fields['current-action'], /Building the operator controls/,
    'the rendered Current Action card lost live worker evidence');
  assert.ok(fields['next-step'] && fields.blocker && fields['last-safe-checkpoint'],
    `the rendered pilot cards are incomplete: ${Object.keys(fields).join(', ')}`);

  const stages = allNodes(page.document.getElementById('topology-live-body'))
    .filter((node) => node.tagName === 'BUTTON' && /route-node/.test(node.className));
  assert.strictEqual(stages.length, 1, `expected one rendered route stage, got ${stages.length}`);
  assert.strictEqual(stages[0].attrs['aria-label'],
    'Build: ACTIVE — the governed worker is still running');
  assert.match(stages[0].textContent, /05 · Build◐ Working/,
    'the rendered workflow stage lacks its icon plus plain-English state');
});

test('DOM: a checkpoint receipt cannot make a blocked mismatched current subject look COMPLETE', () => {
  const gateSubject = 'a'.repeat(64);
  const runSubject = 'b'.repeat(64);
  const run = {
    runId: 'RUN-OLDER-CHECKPOINT', state: 'CHECKPOINTED', objective: 'Preserve the checkpoint without hiding the current gate.',
    updatedAt: '2026-08-28T21:42:07.000Z',
    subject: { subjectSha256: runSubject },
    checkpoint: 'CP-OLDER', rollbackPoint: 'a'.repeat(40),
  };
  // This is the real minimized /api/status shape: runs is an array and the
  // projector's current-run authority travels separately as runsBinding.
  const status = {
    generatedAt: '2026-08-28T21:42:07.000Z',
    engineering: Object.assign({}, fixtureState().engineering, {
      state: 'OK', verdict: 'BLOCKED', subjectSha256: gateSubject,
      problems: [
        { rule: 'ENGOS-SUBJECT', detail: 'No exact subject was supplied.' },
        { rule: 'ENGOS-REVIEW-MISSING', detail: 'Required review is missing.' },
      ],
    }),
    runs: [run],
    runsBinding: {
      state: 'BOUND', runId: run.runId, updatedAt: run.updatedAt,
      subjectState: 'MISMATCHED', subjectSha256: null,
      gateSubjectSha256: gateSubject, runSubjectSha256: runSubject,
      reason: 'the run checkpoint covers an older subject',
    },
    integration: { connectors: [] }, reviewers: [],
    cost: { state: 'UNAVAILABLE', reason: null }, events: [],
    knowledge: { state: 'UNKNOWN', conflicts: null },
  };
  const page = bootPage(fixtureState());
  renderMinimizedStatus(page, status);
  assert.ok(/BLOCKED/.test(page.text('ctx-verdict')) && !/COMPLETE/.test(page.text('ctx-verdict')),
    `the header hides a blocked mismatched subject behind COMPLETE: ${page.text('ctx-verdict')}`);
  assert.strictEqual(page.text('hud-core-status'), RUN_STATE_PLAIN.BLOCKED,
    'AEGIS Core hides the current blocked subject behind the historical checkpoint state');
  assert.strictEqual(page.text('hud-system-health'), 'BLOCKED',
    'System Health hides the current blocked subject behind the historical checkpoint state');
  assert.ok(/older code version than the current gate subject/.test(page.text('founder-body')),
    'the primary pilot deck does not explain why the checkpoint is not current completion');
  assert.ok(/This run reached a recorded checkpoint/.test(page.text('founder-body')) &&
    /Checkpoint CP-OLDER · rollback commit a{40}/.test(page.text('founder-body')),
    'the correction erased the truthful historical checkpoint lifecycle/receipt');
  assert.strictEqual(page.document.getElementById('operator-shell').attrs['data-run-status'], 'blocked',
    'the visual shell still illuminates as complete instead of blocked');
});

test('DOM: BLOCKED or UNAVAILABLE control truth can never render a green-clear BLOCKER card', () => {
  const gateSubject = '1'.repeat(64);
  const runSubject = '2'.repeat(64);
  const run = {
    runId: 'RUN-BLOCKER-TRUTH', state: 'CHECKPOINTED', objective: 'Keep the warning instrument truthful',
    updatedAt: '2026-08-29T00:11:00.000Z', checkpoint: 'CP-BLOCKER', rollbackPoint: '3'.repeat(40),
  };
  const clearProblemsButMismatched = fixtureState({
    engineering: Object.assign({}, fixtureState().engineering, {
      state: 'OK', verdict: 'BLOCKED', subjectSha256: gateSubject, problems: [],
    }),
    runs: { state: 'OK', runs: [run], current: {
      state: 'BOUND', runId: run.runId, updatedAt: run.updatedAt,
      subjectState: 'MISMATCHED', subjectSha256: null,
      runSubjectSha256: runSubject, gateSubjectSha256: gateSubject,
      reason: 'the run and gate subjects differ',
    } },
  });
  const blocked = bootPage(clearProblemsButMismatched);
  const blockedCard = findByAttr(blocked.document.getElementById('founder-body'), 'data-operator-field')
    .find((node) => node.attrs['data-operator-field'] === 'blocker');
  assert.ok(blockedCard, 'the BLOCKER card is missing');
  assert.match(blockedCard.className, /\bis-blocked\b/);
  assert.doesNotMatch(blockedCard.className, /\bis-clear\b/);
  assert.match(blockedCard.textContent, /older code version than the current gate subject/);

  const unavailable = bootPage(fixtureState({
    engineering: { state: 'UNAVAILABLE', reason: 'the exact-subject gate is unavailable', problems: [] },
    runs: { state: 'OK', runs: [run], current: {
      state: 'BOUND', runId: run.runId, updatedAt: run.updatedAt,
      subjectState: 'UNAVAILABLE', subjectSha256: null, reason: 'subject binding unavailable',
    } },
  }));
  const unavailableCard = findByAttr(unavailable.document.getElementById('founder-body'), 'data-operator-field')
    .find((node) => node.attrs['data-operator-field'] === 'blocker');
  assert.match(unavailableCard.className, /\bis-blocked\b/);
  assert.doesNotMatch(unavailableCard.className, /\bis-clear\b/);
  // Founder language, same fail-closed meaning: unavailable gate evidence must
  // still refuse to call the work finished, without naming the control plane.
  assert.match(unavailableCard.textContent, /Not confirmed — AEGIS cannot yet show/);
  assert.match(unavailableCard.textContent, /will not call the work finished/);
  assert.doesNotMatch(unavailableCard.textContent, /control[- ]plane|exact-subject gate/i);
});

// ── the BLOCKER card describes the CURRENT stage, not a later gate ─────────
// During canonical BUILDING the only stage that has run is the builder. A
// missing downstream review is a requirement of a gate that has not run yet, so
// rendering it as the active build's blocker tells the operator the build is
// stuck when it is simply still working.
function buildingBlockerFixture(over) {
  const run = Object.assign({
    runId: 'RUN-BUILDING-BLOCKER', state: 'BUILDING',
    objective: 'Keep the blocker card bound to the current stage',
    updatedAt: '2026-09-02T10:10:00.000Z',
    build: {
      mode: 'async', status: 'RUNNING', workerPid: 5150,
      startedAt: '2026-09-02T10:00:00.000Z', endedAt: null, exit: null,
      timedOut: false, retrySafe: null, recoveryCode: null, failure: null, failover: null,
      activity: { active: true, phase: 'RUNNING', code: 'RUNNING', summary: 'Builder is running' },
    },
  }, over || {});
  return fixtureState({
    generatedAt: '2026-09-02T10:10:00.000Z',
    engineering: Object.assign({}, fixtureState().engineering, {
      state: 'OK', verdict: 'BLOCKED',
      problems: [{ rule: 'ENGOS-REVIEW-MISSING',
        detail: 'grok is required and has no review bound to this subject.' }],
      reviewerCompleteness: { complete: false, rows: [{
        reviewer: 'grok', job: 'adversarial reviewer', required: 'REQUIRED', executed: 'MISSING',
        disposition: null, score: 'UNAVAILABLE', coveredPaths: [], missingPaths: [], stalePaths: [],
      }] },
    }),
    runs: { state: 'OK', runs: [run], current: {
      state: 'BOUND', runId: run.runId, updatedAt: run.updatedAt,
      reason: 'exact current run is bound',
    } },
  });
}

function blockerCard(page) {
  return findByAttr(page.document.getElementById('founder-body'), 'data-operator-field')
    .find((node) => node.attrs['data-operator-field'] === 'blocker');
}

test('DOM: an active BUILDING run reports no current builder blocker instead of a later review gate', () => {
  const page = bootPage(buildingBlockerFixture());
  const card = blockerCard(page);
  assert.ok(card, 'the BLOCKER card is missing');
  assert.match(card.textContent, /No current builder blocker is recorded\./,
    `BUILDING did not state its current-stage blocker truth: ${card.textContent}`);
  assert.match(card.textContent, /later review and checkpoint gates have not run yet/,
    'the card does not say the later gates have not run');
  assert.doesNotMatch(card.textContent, /unresolved gate requirement/,
    'a downstream gate requirement was promoted into the active build blocker');
  assert.doesNotMatch(card.textContent, /grok/i,
    'the active build blocker names a reviewer for a gate that has not run');
  assert.match(card.className, /\bis-clear\b/, 'no current blocker must not render as a blocked card');
  assert.doesNotMatch(card.className, /\bis-blocked\b/);
  // The requirement itself is not hidden — it stays in the evidence disclosure.
  const body = page.text('founder-body');
  assert.ok(body.includes('grok is required and has no review bound to this subject.'),
    'the exact downstream requirement disappeared from detailed evidence');
  assert.ok(body.includes('1 unresolved gate requirement belongs to the review and checkpoint gates'),
    `the counted downstream requirement is missing from detailed evidence: ${body}`);
});

test('DOM: recorded builder failure, cancellation, timeout or unverified activity keeps the BUILDING blocker', () => {
  const cases = [
    { label: 'model auth failure recorded', over: { build: Object.assign({},
      buildingBlockerFixture().runs.runs[0].build, {
        failure: { code: 'MODEL_AUTH_FAILURE', provider: 'claude-subscription',
          summary: 'Claude authentication failed.' } }) } },
    { label: 'builder timed out', over: { build: Object.assign({},
      buildingBlockerFixture().runs.runs[0].build, { timedOut: true }) } },
    { label: 'cancellation recovery recorded', over: { build: Object.assign({},
      buildingBlockerFixture().runs.runs[0].build, { recoveryCode: 'CANCELLED', retrySafe: false }) } },
    { label: 'owner decision recorded', over: { ownerDecision: { state: 'ABANDON_REQUESTED' } } },
    { label: 'terminal exit contradicts BUILDING', over: { build: Object.assign({},
      buildingBlockerFixture().runs.runs[0].build, { exit: 1 }) } },
    { label: 'worker activity unverified', over: { build: Object.assign({},
      buildingBlockerFixture().runs.runs[0].build, {
        status: 'LAUNCH_CLAIMED', activity: { active: false, phase: 'CLAIMED', code: 'LAUNCH_CLAIMED',
          summary: 'Builder launch is claimed; process startup is not yet verified' } }) } },
  ];
  for (const scenario of cases) {
    const page = bootPage(buildingBlockerFixture(scenario.over));
    const card = blockerCard(page);
    assert.ok(card, `${scenario.label}: the BLOCKER card is missing`);
    assert.doesNotMatch(card.textContent, /No current builder blocker is recorded\./,
      `${scenario.label}: recorded builder evidence was rendered as no blocker`);
    assert.match(card.className, /\bis-blocked\b/,
      `${scenario.label}: recorded builder evidence rendered a clear card`);
    assert.doesNotMatch(card.className, /\bis-clear\b/);
  }
});

test('DOM: CHECKPOINTED is COMPLETE only for positively bound current-subject clear evidence', () => {
  const subject = 'c'.repeat(64);
  const run = {
    runId: 'RUN-CURRENT-CHECKPOINT', state: 'CHECKPOINTED', objective: 'Prove current checkpoint completion',
    updatedAt: '2026-08-29T00:10:00.000Z', checkpoint: 'CP-CURRENT', rollbackPoint: '4'.repeat(40),
  };
  const clearEngineering = Object.assign({}, fixtureState().engineering, {
    state: 'OK', verdict: 'READY_FOR_PR', subjectSha256: subject, problems: [],
  });
  const bound = {
    state: 'BOUND', runId: run.runId, updatedAt: run.updatedAt,
    subjectState: 'BOUND', subjectSha256: subject,
    runSubjectSha256: subject, gateSubjectSha256: subject,
    reason: 'the run and gate subjects match',
  };
  const cases = [
    { label: 'positive current subject', binding: bound, engineering: clearEngineering,
      expected: 'COMPLETE' },
    { label: 'binding unavailable', binding: { state: 'UNAVAILABLE', runId: null,
      reason: 'no current run could be established' }, engineering: clearEngineering,
      expected: 'UNAVAILABLE' },
    { label: 'subject unlinked', binding: Object.assign({}, bound, {
      subjectState: 'UNLINKED', subjectSha256: null, runSubjectSha256: null,
      reason: 'the run records no subject' }), engineering: clearEngineering,
      expected: 'UNAVAILABLE' },
    { label: 'engineering unavailable', binding: bound,
      engineering: { state: 'UNAVAILABLE', reason: 'gate projection missing' },
      expected: 'UNAVAILABLE' },
    { label: 'nonblocking evidence not affirmative', binding: bound,
      engineering: Object.assign({}, clearEngineering, { verdict: 'READY_FOR_DETERMINISTIC_VALIDATION' }),
      expected: 'COMPLETE' },
  ];

  for (const scenario of cases) {
    const page = bootPage(fixtureState({
      engineering: scenario.engineering,
      runs: { state: 'OK', runs: [run], current: scenario.binding },
    }));
    const header = page.text('ctx-verdict');
    assert.ok(new RegExp(scenario.expected).test(header),
      `${scenario.label}: expected ${scenario.expected}, got ${header}`);
    if (scenario.expected !== 'COMPLETE') {
      assert.ok(!/COMPLETE/.test(header),
        `${scenario.label}: historical checkpoint falsely became current completion`);
      assert.notStrictEqual(page.text('hud-core-status'), RUN_STATE_PLAIN.COMPLETE,
        `${scenario.label}: AEGIS Core falsely reported current completion`);
    } else {
      assert.strictEqual(page.text('hud-core-status'), RUN_STATE_PLAIN.COMPLETE,
        'positive current-subject checkpoint lost its completion signal');
      assert.ok(/Checkpoint CP-CURRENT · rollback commit 4{40}/.test(page.text('founder-body')),
        'positive completion lost its checkpoint receipt');
      assert.strictEqual(page.text('hud-safe-checkpoint'),
        'This run has a recorded safe state and a recorded way back. ' +
        'Checkpoint CP-CURRENT · rollback commit ' + '4'.repeat(40),
        'the strategic HUD did not consume the real public checkpoint/rollbackPoint shape');
    }
  }
});

test('DOM: the public checkpoint id and rollbackPoint render together in the run card and pilot instruments', () => {
  const subject = 'e'.repeat(64);
  const run = {
    runId: 'RUN-PUBLIC-CHECKPOINT', state: 'CHECKPOINTED', objective: 'Show the real safe state',
    updatedAt: '2026-08-29T00:12:00.000Z', checkpoint: 'CHK-20260829-001',
    rollbackPoint: '0123456789abcdef0123456789abcdef01234567',
  };
  const state = fixtureState({
    engineering: Object.assign({}, fixtureState().engineering, {
      state: 'OK', verdict: 'READY_FOR_PR', subjectSha256: subject, problems: [],
    }),
    runs: { state: 'OK', runs: [run], current: {
      state: 'BOUND', runId: run.runId, updatedAt: run.updatedAt, evidenceState: 'OK',
      subjectState: 'BOUND', subjectSha256: subject,
      runSubjectSha256: subject, gateSubjectSha256: subject,
      reason: 'the run and gate subjects match',
    } },
  });
  const page = bootPage(state);
  // Plain English first, canonical identifiers after it — and the identifiers
  // appear only because this fixture actually carries both of them.
  const expected = 'This run has a recorded safe state and a recorded way back. ' +
    'Checkpoint CHK-20260829-001 · rollback commit 0123456789abcdef0123456789abcdef01234567';
  assert.ok(page.text('founder-body').includes(expected),
    'the pilot deck did not render the checkpoint receipt from the public contract');
  assert.strictEqual(page.text('hud-checkpoint'), expected);
  assert.strictEqual(page.text('hud-safe-checkpoint'), expected);
  assert.strictEqual(page.text('hud-checkpoint-state'), 'Safe state recorded',
    'the HUD checkpoint state word drifted from the checkpoint resolution beside it');
  assert.strictEqual(page.document.getElementById('hud-checkpoint-state').attrs['data-hud-code'],
    'RECORDED', 'the HUD checkpoint footer dropped its exact canonical code');
  assert.ok(!/\[object Object\]/.test(page.text('founder-body')),
    'a fixture-only checkpoint object leaked into visible text');
});

test('DOM: a long mission renders one visible pilot headline while preserving exact truth in a collapsed disclosure', () => {
  const objective = 'Improve only the AEGIS operator dashboard by making every pilot instrument plain English. ' +
    'Preserve exact-subject truth, canonical controls, reduced motion, evidence, checkpoint state, and connector-use truth. ' +
    'Do not invent activity, model use, progress, authorization, reviewer execution, or completion.';
  const run = {
    runId: 'RUN-LONG-MISSION', state: 'BUILT', objective,
    updatedAt: '2026-08-28T21:42:07.000Z', build: {},
  };
  const state = fixtureState({ runs: { state: 'OK', runs: [run], current: {
    state: 'BOUND', runId: run.runId, updatedAt: run.updatedAt,
    subjectState: 'UNLINKED', gateSubjectSha256: 'a'.repeat(64),
  } } });
  const page = bootPage(state);
  const founderNodes = allNodes(page.document.getElementById('founder-body'));
  const headline = founderNodes
    .find((node) => node.tagName === 'H3' && node.className === 'mission-title');
  const details = founderNodes
    .find((node) => node.tagName === 'DETAILS' && node.className === 'mission-objective-detail');
  assert.ok(headline, 'the pilot-readable mission headline is missing from the visible Command View');
  assert.strictEqual(headline.hidden, undefined, 'the primary mission headline is hidden');
  assert.ok(headline.textContent.length <= 140 && headline.textContent !== objective,
    `the primary instrument still dumps the full ${objective.length}-character objective`);
  assert.match(headline.textContent, /[.!?\u2026]$/,
    'the compact mission headline ends mid-thought without a readable boundary');
  assert.strictEqual(page.text('hud-mission'), headline.textContent,
    'the strategic HUD duplicated a different or full-length mission instead of the same pilot headline');
  assert.ok(details, 'the long mission has no full-objective disclosure');
  assert.ok(/View full objective/.test(details.textContent) && details.textContent.includes(objective),
    'the compact mission presentation dropped or altered the exact objective');
  assert.notStrictEqual(details.attrs.open, '', 'the full objective must remain collapsed until requested');
});

// ── handoff indicator: it must stay dark until canonical state moves ───────
function handoffNode(page) {
  const nodes = findByAttr(page.document.getElementById('founder-body'), 'data-handoff-state');
  assert.strictEqual(nodes.length, 1, `expected exactly one handoff indicator, found ${nodes.length}`);
  return nodes[0];
}

// The strip carries two labelled groups, and they answer two different
// questions: what canonical state change was RECORDED, and what the deck says
// is happening now. Reading them apart is what these proofs are for — a single
// blob of text cannot show that a repaint changed one without touching the
// other.
function handoffParts(page) {
  const parts = {};
  for (const node of findByAttr(handoffNode(page), 'data-handoff-part')) {
    parts[node.attrs['data-handoff-part']] = node.textContent;
  }
  return parts;
}

test('DOM: an idle dashboard renders a hidden, silent handoff indicator', () => {
  const node = handoffNode(bootPage(fixtureState()));
  assert.strictEqual(node.attrs['data-handoff-state'], 'INACTIVE',
    'an idle dashboard reported a handoff it never observed');
  assert.strictEqual(node.hidden, true, 'the inactive indicator must be hidden, not merely empty');
  assert.strictEqual(node.textContent, '', 'the inactive indicator must say nothing at all');
});

test('DOM: the FIRST sighting of a running build is a starting point, not a handoff', () => {
  const run = {
    runId: 'RUN-FIRST', state: 'BUILDING', objective: 'First sighting',
    updatedAt: '2026-08-28T09:00:00.000Z', transitions: 4,
    route: { model: 'claude-opus-5', execution: 'claude-cli', source: 'tool-router.cjs routeRole' },
    build: { mode: 'async', status: 'RUNNING', startedAt: '2026-08-28T08:55:00.000Z',
      activity: { active: true, summary: 'Editing the dashboard.' } },
  };
  const page = bootPage(fixtureState({ runs: { state: 'OK', runs: [run],
    current: { state: 'BOUND', runId: run.runId, updatedAt: run.updatedAt, reason: 'bound' } } }));
  const node = handoffNode(page);
  assert.strictEqual(node.attrs['data-handoff-state'], 'INACTIVE',
    'a run that was already BUILDING when the page opened is not evidence of a transition');
  assert.ok(!/handed off/.test(page.text('founder-body')), 'the page invented a handoff from a single observation');
});

// ── the station path: dark until canonical evidence says otherwise ────────
function stationRoles(page) {
  const nodes = findByAttr(page.document.getElementById('core-path-track'), 'data-station');
  assert.strictEqual(nodes.length, 9, `expected the nine canonical stations, found ${nodes.length}`);
  const roles = {};
  for (const node of nodes) roles[node.attrs['data-station']] = node.attrs['data-station-role'];
  return roles;
}

function corePathHandoff(page) {
  return page.document.getElementById('core-path-handoff');
}

test('DOM: an unbound dashboard marks no station and claims no handoff on the path', () => {
  const page = bootPage(fixtureState());
  const roles = stationRoles(page);
  assert.deepStrictEqual([...new Set(Object.values(roles))], ['NOT CURRENT'],
    `an unbound dashboard marked a station it has no run for: ${JSON.stringify(roles)}`);
  assert.match(page.text('core-path-note'), /HANDOFF PATH UNAVAILABLE — no run is bound/,
    'the path invented a current station with no bound run');
  const line = corePathHandoff(page);
  assert.strictEqual(line.attrs['data-core-handoff'], 'INACTIVE', 'the path claimed a handoff it never observed');
  assert.strictEqual(line.hidden, true, 'the inactive handoff line must be hidden, not merely empty');
  assert.strictEqual(line.textContent, '', 'the inactive handoff line must say nothing at all');
});

test('DOM: a first sighting highlights the current station and still proves no handoff', () => {
  const run = {
    runId: 'RUN-STATION', state: 'BUILDING', objective: 'First sighting',
    updatedAt: '2026-08-28T09:00:00.000Z', transitions: 4,
    route: { model: 'claude-opus-5', execution: 'claude-cli', source: 'tool-router.cjs routeRole' },
  };
  const page = bootPage(fixtureState({ runs: { state: 'OK', runs: [run],
    current: { state: 'BOUND', runId: run.runId, updatedAt: run.updatedAt, reason: 'bound' } } }));
  const roles = stationRoles(page);
  assert.strictEqual(roles.build, 'CURRENT', 'the canonical BUILDING state did not highlight its own station');
  assert.strictEqual(Object.values(roles).filter((role) => role === 'CURRENT').length, 1,
    'more than one station claimed to be current');
  assert.ok(!Object.values(roles).includes('HANDED FROM'),
    'a single observation was drawn as a completed handoff between two stations');
  // The mark reads as what the run is doing; the exact code is not printed on
  // it because the note directly beneath still writes it out in full.
  const marks = allNodes(page.document.getElementById('core-path-track'))
    .filter((node) => String(node.className) === 'core-station-mark')
    .map((node) => node.textContent);
  assert.strictEqual(marks.length, 9, `expected one written mark per station, found ${marks.length}`);
  assert.ok(marks.includes('CURRENT · Building'),
    `the current station does not say in plain English what the run is doing: ${marks.join(' | ')}`);
  for (const mark of marks) {
    const marked = /^(?:CURRENT|HANDED FROM) · (.+)$/.exec(mark);
    if (!marked) continue;
    assert.ok(!/[A-Z]{2,}|_/.test(marked[1]),
      `a marked station still reads as a machine code: ${mark}`);
  }
  const note = page.text('core-path-note');
  assert.match(note, /Current station: Build — canonical run state BUILDING/,
    `the current station does not cite the exact canonical run state: ${note}`);
  assert.match(note, /held by claude-opus-5 \(claude-cli\)/,
    `the station holder is not the recorded model and execution path: ${note}`);
  assert.strictEqual(corePathHandoff(page).attrs['data-core-handoff'], 'INACTIVE',
    'the path claimed a handoff from one sighting of a running build');
});

test('DOM: a run whose canonical state is off-path marks nothing and says so', () => {
  const run = { runId: 'RUN-ABANDONED', state: 'ABANDONED', objective: 'Stopped',
    updatedAt: '2026-08-28T09:00:00.000Z', transitions: 9 };
  const page = bootPage(fixtureState({ runs: { state: 'OK', runs: [run],
    current: { state: 'BOUND', runId: run.runId, updatedAt: run.updatedAt, reason: 'bound' } } }));
  assert.ok(!Object.values(stationRoles(page)).includes('CURRENT'),
    'a state that belongs to no station was forced onto one');
  assert.match(page.text('core-path-note'),
    /Canonical run state ABANDONED belongs to no station on this path/,
    'the page hid the fact that the canonical state is off-path');
});

// ── FINDING #10 RED PROOF: four evidence states, four different sentences ──
test('RED: connector usage renders four distinct, truthful messages from real DOM output', () => {
  const cases = [
    { name: 'absent evidence',
      used: { state: 'UNAVAILABLE', plain: 'x' },
      bound: 'RUN-A',
      expectState: 'UNAVAILABLE',
      must: [/UNAVAILABLE/, /no record exists/i],
      mustNot: [/\bUsed by this run\b/, /Last used by run/] },
    { name: 'unconfirmed claim',
      used: { state: 'UNVERIFIED', claim: { runId: 'RUN-CLAIM' } },
      bound: 'RUN-A',
      expectState: 'UNVERIFIED',
      must: [/UNVERIFIED/, /RUN-CLAIM/, /claim/i],
      mustNot: [/\bUsed by this run\b/] },
    { name: 'confirmed historical use by another run',
      used: { state: 'USED', runId: 'RUN-OLD', observedAt: '2026-08-01T00:00:00.000Z', ledgerConfirmed: true },
      bound: 'RUN-A',
      expectState: 'USED_HISTORICAL',
      must: [/Last used by run RUN-OLD/, /not the current run/],
      mustNot: [/\bUsed by this run\b/] },
    { name: 'confirmed use by the exact current run',
      used: { state: 'USED', runId: 'RUN-A', observedAt: '2026-08-25T00:00:00.000Z', ledgerConfirmed: true },
      bound: 'RUN-A',
      expectState: 'USED_CURRENT',
      must: [/Used by this run \(RUN-A\)/],
      mustNot: [/Last used by run/] },
  ];
  const seen = new Set();
  for (const c of cases) {
    const state = fixtureState({
      integration: { connectors: { state: 'OK', connectors: [connectorFixture(c.used)] } },
      runs: { state: 'OK', runs: [{ runId: c.bound, state: 'BUILT', objective: 'o', updatedAt: '2026-08-25T00:00:00.000Z' }],
        current: { state: 'BOUND', runId: c.bound, updatedAt: '2026-08-25T00:00:00.000Z', packetId: null, subjectSha256: null, reason: 'r' } },
    });
    const page = bootPage(state);
    const lines = findByAttr(page.document.getElementById('connectors'), 'data-usage-state');
    assert.strictEqual(lines.length, 1, `${c.name}: expected exactly one usage line, got ${lines.length}`);
    const line = lines[0];
    assert.strictEqual(line.attrs['data-usage-state'], c.expectState, `${c.name}: wrong usage state`);
    for (const re of c.must) assert.ok(re.test(line.textContent), `${c.name}: rendered text missing ${re} — got: ${line.textContent}`);
    for (const re of c.mustNot) assert.ok(!re.test(line.textContent), `${c.name}: rendered text wrongly asserts ${re} — got: ${line.textContent}`);
    assert.ok(!seen.has(line.textContent), `${c.name}: this message is identical to another state's message`);
    seen.add(line.textContent);
  }
  assert.strictEqual(seen.size, 4, 'the four evidence states must produce four different sentences');
});

test('RED: a confirmed use is never called "this run" when no run is bound', () => {
  const state = fixtureState({
    integration: { connectors: { state: 'OK', connectors: [connectorFixture(
      { state: 'USED', runId: 'RUN-OLD', observedAt: '2026-08-01T00:00:00.000Z', ledgerConfirmed: true })] } },
    runs: { state: 'OK', runs: [], current: { state: 'UNAVAILABLE', reason: 'no run records exist yet, so no run is current.' } },
  });
  const page = bootPage(state);
  const line = findByAttr(page.document.getElementById('connectors'), 'data-usage-state')[0];
  assert.strictEqual(line.attrs['data-usage-state'], 'USED_HISTORICAL');
  assert.ok(/Last used by run RUN-OLD/.test(line.textContent));
  assert.ok(/No current run is bound/.test(line.textContent),
    'with no binding the page must say so rather than imply the use belongs to the current run');
});

// ── V2 INTEGRATIONS — four questions, four separate answers, one authority ─
// The Command View names a worker; the founder's next question is what that
// worker can actually reach. Four different facts answer it, and collapsing any
// two of them is the original connector defect returning by a different door:
// how a call would reach the service (execution path), whether our credential
// was valid at a dated check (authentication), whether the service itself last
// answered a probe (verification), and whether the CURRENT bound run actually
// consumed it (usage). These proofs hold three properties: the four are
// rendered separately, an absent field is an explicit UNAVAILABLE rather than
// the more flattering neighbouring fact, and the deck resolves them through the
// same connector resolution the Detail View inspector already owns, so the two
// surfaces can never answer the same question differently.
function commandConnectorCards(page) {
  return findByAttr(page.document.getElementById('integration-overview'), 'role');
}

function commandConnectorFacts(page) {
  const cards = commandConnectorCards(page);
  assert.strictEqual(cards.length, 1, `expected exactly one Command View connector card, found ${cards.length}`);
  const facts = {};
  for (const node of findByAttr(cards[0], 'data-connector-fact')) {
    // Each fact line is an inline label plus its value; the rendered claim under
    // test is the value, so a label can never satisfy a proof about evidence.
    facts[node.attrs['data-connector-fact']] = {
      state: node.attrs['data-connector-fact-state'],
      text: node.children.length ? node.lastChild.textContent : node.textContent,
      line: node.textContent,
    };
  }
  return facts;
}

function integrationFixture(connector, boundRunId) {
  const run = { runId: boundRunId, state: 'BUILT', objective: 'Explain the integrations from canonical state',
    updatedAt: '2026-09-02T12:00:00.000Z' };
  return fixtureState({
    generatedAt: '2026-09-02T12:10:00.000Z',
    integration: { connectors: { state: 'OK', connectors: [connector] } },
    runs: { state: 'OK', runs: [run], current: {
      state: 'BOUND', runId: run.runId, updatedAt: run.updatedAt, reason: 'exact current run is bound',
    } },
  });
}

test('the connection-side connector facts are resolved once and read by both Command View and the inspector', () => {
  assert.ok(/function connectorFacts\(connector\)/.test(code), 'no connectorFacts() boundary found');
  const fn = code.slice(code.indexOf('function connectorFacts'), code.indexOf('function renderConnectors'))
    .replace(/\/\/[^\n]*/g, '');
  assert.ok(fn.length > 0, 'the connectorFacts() body was not located');
  assert.ok(/connector\.executionPath/.test(fn) && /connector\.authentication/.test(fn) &&
    /connector\.lastVerified/.test(fn),
    'the three connection facts are not each read from their own canonical projection field');
  for (const derived of ['lastUsedByRun', 'usageMessage', 'health', 'staleness']) {
    assert.ok(!new RegExp('\\b' + derived + '\\b').test(fn),
      `connectorFacts() reads ${derived} — usage, health and freshness may never speak for a credential or a probe`);
  }
  const deck = code.slice(code.indexOf("var truth = el('div','truth-grid')"), code.indexOf('visibleHost = host'));
  assert.ok(/connectorFacts\(resolvedConnector\(c\)\)/.test(deck),
    'Command View resolves connector evidence outside the connector resolution the inspector already owns');
  assert.ok(/usageMessage\(c\.lastUsedByRun/.test(deck),
    'Command View usage no longer comes from the single usage authority');
  const inspector = code.slice(code.indexOf("} else if (kind === 'connector'){"), code.indexOf("kv('Supports'"));
  assert.ok(/connectorFacts\(connector\)/.test(inspector),
    'the Detail View inspector derives the same facts a second time instead of reading the resolved ones');
});

test('DOM: the Command View connector card states execution path, authentication, verification and current-run usage separately', () => {
  const connector = connectorFixture({ state: 'UNAVAILABLE' });
  connector.authentication = { state: 'AUTHENTICATED',
    plain: 'Our credential for this service was valid when checked 3 minute(s) ago.' };
  connector.lastVerified = { state: 'FRESH', plain: 'Checked 3 minute(s) ago and it responded.' };
  const facts = commandConnectorFacts(bootPage(integrationFixture(connector, 'RUN-INTEGRATION')));
  assert.deepStrictEqual(Object.keys(facts).sort(),
    ['authentication', 'execution-path', 'last-verified', 'used-by-current-run'],
    'the four connector questions are not rendered as four separate answers');
  assert.strictEqual(facts['execution-path'].state, 'RECORDED');
  assert.match(facts['execution-path'].text, /^mcp$/, 'the recorded execution path was not rendered exactly');
  assert.strictEqual(facts.authentication.state, 'AUTHENTICATED');
  assert.match(facts.authentication.text, /valid when checked 3 minute\(s\) ago/,
    'the card did not render the projector\'s own dated credential sentence');
  assert.strictEqual(facts['last-verified'].state, 'FRESH');
  assert.match(facts['last-verified'].text, /Checked 3 minute\(s\) ago and it responded/,
    'the card did not render the projector\'s own verification sentence');
  assert.strictEqual(facts['used-by-current-run'].state, 'UNAVAILABLE');
  assert.match(facts['used-by-current-run'].text, /no record exists/,
    'absent usage evidence was not reported as missing evidence');
  assert.doesNotMatch(facts['used-by-current-run'].text, /\bUsed by this run\b/,
    'an authenticated, freshly verified connector was rendered as one the current run used');
  for (const field of ['authentication', 'last-verified']) {
    assert.doesNotMatch(facts[field].text, /\bused\b|\bconsulted\b/i,
      `the ${field} answer claims consumption, which only a usage receipt may state`);
  }
});

test('DOM: only an exact current-run usage receipt lets a connector card say the bound run used it', () => {
  const connector = connectorFixture({ state: 'USED', runId: 'RUN-USE',
    observedAt: '2026-09-02T11:00:00.000Z', ledgerConfirmed: true });
  connector.authentication = { state: 'AUTHENTICATED', plain: 'Credential valid when checked 2 minute(s) ago.' };
  connector.lastVerified = { state: 'FRESH', plain: 'Checked 2 minute(s) ago and it responded.' };
  const used = commandConnectorFacts(bootPage(integrationFixture(connector, 'RUN-USE')));
  assert.strictEqual(used['used-by-current-run'].state, 'USED_CURRENT');
  assert.match(used['used-by-current-run'].text, /Used by this run \(RUN-USE\)/,
    'a ledger-confirmed use by the bound run was not attributed to it');
  assert.strictEqual(used.authentication.state, 'AUTHENTICATED',
    'a proven use rewrote the separate credential answer');

  const other = commandConnectorFacts(bootPage(integrationFixture(connector, 'RUN-OTHER')));
  assert.strictEqual(other['used-by-current-run'].state, 'USED_HISTORICAL');
  assert.match(other['used-by-current-run'].text, /not the current run \(RUN-OTHER\)/,
    'a use recorded for a different run was not distinguished from the bound run');
  assert.doesNotMatch(other['used-by-current-run'].text, /\bUsed by this run\b/);
});

test('DOM: missing credential, verification or execution evidence renders explicit UNAVAILABLE, never a neighbouring fact', () => {
  const connector = connectorFixture({ state: 'USED', runId: 'RUN-BARE',
    observedAt: '2026-09-02T11:30:00.000Z', ledgerConfirmed: true });
  delete connector.authStatus;
  connector.executionPath = 'UNKNOWN';
  connector.health = 'HEALTHY';
  connector.staleness = { state: 'FRESH', ageMinutes: 1 };
  const facts = commandConnectorFacts(bootPage(integrationFixture(connector, 'RUN-BARE')));
  for (const field of ['execution-path', 'authentication', 'last-verified']) {
    assert.strictEqual(facts[field].state, 'UNAVAILABLE',
      `${field} was reported as a fact the projection does not carry`);
    assert.match(facts[field].text, /^UNAVAILABLE — /,
      `${field} absence is not stated as an explicit honest absence: ${facts[field].text}`);
    assert.doesNotMatch(facts[field].text, /HEALTHY|FRESH|RUN-BARE/,
      `${field} borrowed health, freshness or usage evidence to fill its own gap`);
  }
  // The one fact that IS recorded stays fully reported: an absence elsewhere
  // must not suppress evidence the ledger actually confirmed.
  assert.strictEqual(facts['used-by-current-run'].state, 'USED_CURRENT');
  assert.match(facts['used-by-current-run'].text, /Used by this run \(RUN-BARE\)/);
});

test('DOM: a minimized live connector card answers through the existing inspector resolution, not a second one', () => {
  const rich = connectorFixture({ state: 'UNAVAILABLE' });
  rich.authentication = { state: 'AUTHENTICATED', plain: 'Credential checked from dated evidence.' };
  rich.lastVerified = { state: 'FRESH', plain: 'Probe succeeded from dated evidence.' };
  const page = bootPage(fixtureState({
    integration: { connectors: { state: 'OK', connectors: [rich] } },
  }));
  // The real minimized payload carries no authentication or verification
  // object; only the display allowlist hosting is permitted to publish.
  renderMinimizedStatus(page, {
    generatedAt: '2026-09-02T13:00:00.000Z',
    engineering: fixtureState().engineering,
    integration: { connectors: { state: 'OK', connectors: [{
      label: rich.label, provider: rich.provider, executionPath: rich.executionPath,
      health: rich.health, staleness: rich.staleness, authStatus: rich.authStatus,
      lastUsedByRun: rich.lastUsedByRun, legacy: false,
    }] } },
    reviewers: [], cost: { state: 'UNAVAILABLE', reason: null },
    runs: [],
    runsBinding: { state: 'UNAVAILABLE', runId: null, updatedAt: null,
      evidenceState: 'OK', reason: 'no run records exist yet, so no run is current.' },
    events: [], knowledge: { state: 'UNKNOWN', conflicts: null },
  });
  const facts = commandConnectorFacts(page);
  assert.strictEqual(facts.authentication.state, 'AUTHENTICATED');
  assert.match(facts.authentication.text, /Credential checked from dated evidence/,
    'the live card did not resolve credential evidence through the existing connector resolution');
  assert.match(facts['last-verified'].text, /Probe succeeded from dated evidence/,
    'the live card did not resolve verification evidence through the existing connector resolution');

  const cards = commandConnectorCards(page);
  cards[0]._listeners.click[0]();
  const inspector = page.text('inspector');
  for (const field of ['execution-path', 'authentication', 'last-verified']) {
    assert.ok(inspector.includes(facts[field].text),
      `Command View and the Detail View inspector disagree about ${field}: ` +
      `card said "${facts[field].text}"`);
  }
});

// ── FINDING #7 RED PROOFS: binding, not array position ────────────────────
test('RED: the current run is selected by timestamp, not by array position', () => {
  // Deliberately out of order: the NEWEST run is FIRST in the array, and the
  // run ids do not sort in time order either. Old behaviour (last element)
  // would show the stale objective.
  const runs = [
    { runId: 'RUN-20260826-aaaa', state: 'BUILT', objective: 'THE NEW OBJECTIVE', updatedAt: '2026-08-26T10:00:00.000Z', packetId: 'builder-control/packets/P-NEW.json' },
    { runId: 'RUN-20260825-zzzz', state: 'BUILT', objective: 'THE STALE OBJECTIVE', updatedAt: '2026-08-25T10:00:00.000Z', packetId: 'builder-control/packets/P-OLD.json' },
  ];
  const state = fixtureState({ runs: { state: 'OK', runs,
    current: { state: 'BOUND', runId: 'RUN-20260826-aaaa', updatedAt: '2026-08-26T10:00:00.000Z',
      packetId: 'builder-control/packets/P-NEW.json', subjectSha256: 'aaaaaaaaaaaabbbb', objective: 'THE NEW OBJECTIVE',
      reason: 'Bound to RUN-20260826-aaaa, whose own record was last written 2026-08-26T10:00:00.000Z.' } } });
  const body = bootPage(state).text('founder-body');
  assert.ok(/THE NEW OBJECTIVE/.test(body), 'the bound run objective is not rendered');
  assert.ok(!/What was requested: THE STALE OBJECTIVE/.test(body), 'a stale objective is being presented as current');
  // All four coordinates must be stated, not just the run id.
  assert.ok(/RUN-20260826-aaaa/.test(body), 'run id missing');
  assert.ok(/2026-08-26T10:00:00.000Z/.test(body), 'authoritative timestamp missing');
  assert.ok(/P-NEW\.json/.test(body), 'packet id missing');
  assert.ok(/aaaaaaaaaaaa/.test(body), 'subject hash missing');
});

test('RED: with no authoritative binding the summary renders UNAVAILABLE, not the last run in the list', () => {
  const state = fixtureState({ runs: { state: 'OK',
    runs: [{ runId: 'RUN-UNDATED', state: 'BUILT', objective: 'UNDATED OBJECTIVE', updatedAt: null }],
    current: { state: 'UNAVAILABLE', runId: null,
      reason: '1 run record(s) exist but none carries a parseable updatedAt timestamp, so which one is current cannot be established.' } } });
  const body = bootPage(state).text('founder-body');
  assert.ok(/UNAVAILABLE/.test(body), 'an unbound summary must say UNAVAILABLE');
  assert.ok(!/What was requested: UNDATED OBJECTIVE/.test(body),
    'an undated run must not be promoted to "current" — selecting by list position is the defect');
  assert.ok(/none carries a parseable updatedAt/.test(body), 'the reason the binding failed must be shown');
});

test('DOM: founder summary says nothing is blocking only for a matching BOUND run and engineering OK', () => {
  const run = { runId: 'RUN-CLEAR', state: 'BUILT', objective: 'CLEAR OBJECTIVE',
    updatedAt: '2026-08-27T13:00:00.000Z' };
  const state = fixtureState({
    engineering: Object.assign({}, fixtureState().engineering, {
      state: 'OK', verdict: 'READY_FOR_PR', problems: [],
    }),
    runs: { state: 'OK', runs: [run], current: { state: 'BOUND', runId: 'RUN-CLEAR',
      updatedAt: run.updatedAt, reason: 'exact current run is bound' } },
  });
  const body = bootPage(state).text('founder-body');
  assert.ok(/Nothing is blocking this run\./.test(body),
    `matching BOUND + engineering OK did not render the clear signal: ${body}`);
  assert.ok(!/Blocking status unavailable/.test(body),
    'positive current evidence must not be downgraded to unavailable');
});

test('DOM: mismatched or ghost binding fails closed and preserves recorded problem counts', () => {
  const cases = [
    { name: 'mismatched', binding: { state: 'MISMATCHED', runId: 'RUN-WRONG',
      reason: 'binding subject does not match the current subject' },
      problems: [{ detail: 'required review is missing' }], reason: /binding subject does not match/ },
    { name: 'bound id absent from run evidence', binding: { state: 'BOUND', runId: 'RUN-GHOST',
      reason: 'claimed bound' }, problems: [], reason: /no matching run record is present/ },
  ];
  cases.forEach((c) => {
    const state = fixtureState({
      engineering: Object.assign({}, fixtureState().engineering, { state: 'OK', problems: c.problems }),
      runs: { state: 'OK', runs: [], current: c.binding },
    });
    const page = bootPage(state);
    const body = page.text('founder-body');
    assert.ok(/Blocking status unavailable/.test(body), `${c.name}: blocking status was presented as known`);
    assert.ok(c.reason.test(body), `${c.name}: the binding failure reason is missing: ${body}`);
    assert.ok(!/Nothing is blocking this run\./.test(body), `${c.name}: rendered a false clear signal`);
    assert.ok(/UNAVAILABLE/.test(page.text('ctx-verdict')) && !/IDLE/.test(page.text('ctx-verdict')),
      `${c.name}: the primary header rendered false IDLE: ${page.text('ctx-verdict')}`);
    assert.strictEqual(page.text('hud-core-status'), RUN_STATE_PLAIN.UNAVAILABLE,
      `${c.name}: AEGIS Core rendered false healthy idle`);
    assert.strictEqual(page.document.getElementById('operator-shell').attrs['data-run-status'], 'unavailable',
      `${c.name}: the shell rendered false idle`);
    assert.ok(!/No blocker — no run has started\./.test(body),
      `${c.name}: contradictory binding evidence rendered the clean-idle blocker`);
    if (c.problems.length) {
      assert.ok(/1 unresolved gate requirement/.test(body), `${c.name}: recorded problem count was hidden`);
    }
  });
});

test('DOM: unavailable engineering evidence fails closed even when the run binding matches', () => {
  const run = { runId: 'RUN-BOUND', state: 'BUILT', objective: 'BOUND OBJECTIVE',
    updatedAt: '2026-08-27T13:05:00.000Z' };
  const state = fixtureState({
    engineering: { state: 'UNAVAILABLE', reason: 'gate projection could not be read', problems: [] },
    runs: { state: 'OK', runs: [run], current: { state: 'BOUND', runId: run.runId,
      updatedAt: run.updatedAt, reason: 'exact current run is bound' } },
  });
  const body = bootPage(state).text('founder-body');
  assert.ok(/Blocking status unavailable/.test(body), 'unavailable engineering evidence was treated as clear');
  assert.ok(/gate projection could not be read/.test(body), 'engineering failure reason is missing');
  assert.ok(!/Nothing is blocking this run\./.test(body), 'unavailable engineering evidence rendered a false clear signal');
});

test('RED: the founder summary states the risk tier, its reasons, and reviewer coverage in plain English', () => {
  const subject = 'a'.repeat(64);
  const run = { runId: 'RUN-REVIEW-DETAIL', state: 'BUILT', objective: 'Review detail',
    updatedAt: '2026-08-27T13:10:00.000Z' };
  const state = fixtureState({ engineering: Object.assign(fixtureState().engineering, {
    subjectSha256: subject,
    reviewerCompleteness: { subjectSha256: subject, complete: false, rows: [
      { reviewer: 'codex', job: 'correctness reviewer', required: 'REQUIRED', executed: 'EXECUTED',
        disposition: 'REJECT', score: '1/2 subject path(s) covered',
        coveredPaths: ['a.cjs'], missingPaths: ['b.cjs'], stalePaths: ['gone.cjs'], reason: 'r' },
      { reviewer: 'grok', job: 'adversarial reviewer', required: 'REQUIRED', executed: 'MISSING',
        disposition: null, score: 'UNAVAILABLE', coveredPaths: [], missingPaths: ['a.cjs', 'b.cjs'], stalePaths: [], reason: 'r' },
    ] } }), runs: { state: 'OK', runs: [run], current: { state: 'BOUND', runId: run.runId,
      updatedAt: run.updatedAt, subjectState: 'UNLINKED', gateSubjectSha256: subject,
      reason: 'current gate subject' } } });
  const body = bootPage(state).text('founder-body');
  assert.ok(/Risk tier: FULL \(high-risk\)/.test(body), 'the risk tier and high-risk flag are not stated');
  assert.ok(/a high-risk signal is present/.test(body), 'the classifier reason for the tier is not shown');
  assert.ok(/touches a protected path/.test(body), 'the risk reason is not shown');
  assert.ok(/codex/.test(body) && /grok/.test(body), 'reviewer names are not shown');
  assert.ok(/rejected it/.test(body), 'the reviewer disposition is not in plain English');
  assert.ok(/1\/2 subject path\(s\) covered/.test(body), 'the reviewer score is not shown');
  assert.ok(/has not reviewed this change/.test(body), 'a missing required review is not stated plainly');
  // covered / not read / no-longer-part-of-this-change, all three
  assert.ok(/Covered by bound evidence: a\.cjs/.test(body), 'covered paths missing');
  assert.ok(/Not covered: b\.cjs/.test(body), 'missing paths missing');
  assert.ok(/gone\.cjs/.test(body), 'stale paths missing');
});

test('DOM: Strategic HUD reviewer totals count only REQUIRED rows while detail preserves advisory context', () => {
  const subject = 'a'.repeat(64);
  const run = { runId: 'RUN-MIXED-REVIEWERS', state: 'BUILT', objective: 'Mixed reviewers',
    updatedAt: '2026-08-27T13:11:00.000Z' };
  const rows = [
    { reviewer: 'codex', job: 'correctness reviewer', required: 'REQUIRED', executed: 'EXECUTED',
      disposition: 'APPROVE', score: '1/1 subject path(s) covered', coveredPaths: ['a.cjs'],
      missingPaths: [], stalePaths: [] },
    { reviewer: 'grok', job: 'adversarial reviewer', required: 'REQUIRED', executed: 'MISSING',
      disposition: null, score: 'UNAVAILABLE', coveredPaths: [], missingPaths: ['a.cjs'], stalePaths: [] },
    { reviewer: 'copilot', job: 'repository guardian', required: 'ADVISORY', executed: 'EXECUTED',
      disposition: 'APPROVE_WITH_NOTES', score: '1/1 subject path(s) covered', coveredPaths: ['a.cjs'],
      missingPaths: [], stalePaths: [] },
    { reviewer: 'visual-qa', job: 'visual observer', required: 'NOT_REQUIRED', executed: 'EXECUTED',
      disposition: 'APPROVE', score: '1/1 subject path(s) covered', coveredPaths: ['a.cjs'],
      missingPaths: [], stalePaths: [] },
  ];
  const state = fixtureState({ engineering: Object.assign({}, fixtureState().engineering, {
    subjectSha256: subject,
    reviewerCompleteness: { subjectSha256: subject, complete: false, rows },
  }), runs: { state: 'OK', runs: [run], current: { state: 'BOUND', runId: run.runId,
    updatedAt: run.updatedAt, subjectState: 'UNLINKED', gateSubjectSha256: subject,
    reason: 'current gate subject' } } });
  const page = bootPage(state);
  assert.strictEqual(page.text('hud-review'),
    '1 of 2 required reviewer row(s) executed for the current gate subject.',
    'advisory or not-required execution inflated the Strategic HUD numerator or denominator');
  const detail = page.text('founder-body');
  assert.ok(/copilot \(repository guardian, advisory only — cannot unblock anything\)/.test(detail),
    'the detailed reviewerLine lost advisory-role context while the HUD count was narrowed');
  assert.ok(/visual-qa \(visual observer, not required for this tier\)/.test(detail),
    'the detailed reviewerLine lost not-required context while the HUD count was narrowed');
});

test('RED: an absent reviewer table renders UNAVAILABLE, never "complete"', () => {
  const eng = Object.assign(fixtureState().engineering, { reviewerCompleteness: null });
  const body = bootPage(fixtureState({ engineering: eng })).text('founder-body');
  assert.ok(/reviewer coverage is unknown/.test(body), 'a missing reviewer table must read as unknown coverage');
  assert.ok(!/Every required review has bound evidence for every changed file/.test(body), 'unknown coverage rendered as complete');
});

// ── FINDING #2: the exact coverage sentence has to reach the screen ────────
// The gate computes one founder-readable sentence naming which reviewer fell
// short, how, and what to re-run. Hosting already carries it as
// engineering.reviewerCompleteness.completeReason. These proofs hold that the
// panel BINDS that field rather than paraphrasing it, and that it stays text.
function rcFixture(completeReason, over) {
  const subject = 'a'.repeat(64);
  const run = { runId: 'RUN-RC-FIXTURE', state: 'BUILT', objective: 'Reviewer coverage fixture',
    updatedAt: '2026-08-27T13:12:00.000Z' };
  return fixtureState({ engineering: Object.assign(fixtureState().engineering, {
    subjectSha256: subject,
    reviewerCompleteness: Object.assign({
      subjectSha256: subject,
      complete: false,
      completeReason,
      rows: [
        { reviewer: 'codex', job: 'correctness reviewer', required: 'REQUIRED', executed: 'EXECUTED',
          disposition: 'APPROVE', score: '1/2 subject path(s) covered',
          coveredPaths: ['a.cjs'], missingPaths: ['b.cjs'], stalePaths: [], reason: 'r' },
      ],
    }, over || {}) }), runs: { state: 'OK', runs: [run], current: {
      state: 'BOUND', runId: run.runId, updatedAt: run.updatedAt,
      subjectState: 'UNLINKED', gateSubjectSha256: subject, reason: 'current gate subject',
    } } });
}

// Every element the page built, so a proof can ask what was CREATED rather
// than only what the concatenated text reads like.
function allNodes(root, out = []) {
  out.push(root);
  (root.children || []).forEach((c) => allNodes(c, out));
  return out;
}

test('RED: incomplete coverage renders the gate\'s exact completeness sentence, not just a yes/no', () => {
  const reason = 'Review coverage is INCOMPLETE: codex read only part of the change. ' +
    'Re-run the reviewer(s) named above against this exact change.';
  const body = bootPage(rcFixture(reason)).text('founder-body');
  assert.ok(/Not every required review has bound evidence for every changed file/.test(body),
    'the coverage headline is gone');
  assert.ok(body.includes(reason),
    'engineering.reviewerCompleteness.completeReason is not bound to the panel — the founder is told THAT coverage is short but never which reviewer, how, or what to re-run');
});

test('RED: complete coverage renders its own exact sentence too, so "complete" is never unexplained', () => {
  const reason = 'Every required reviewer (codex and grok) reviewed this exact change and read all ' +
    '2 changed file(s), and no reviewer claims a file outside it.';
  const body = bootPage(rcFixture(reason, { complete: true })).text('founder-body');
  assert.ok(body.includes(reason), 'a complete verdict is asserted with no evidence sentence behind it');
});

test('RED: a completeness sentence the gate never recorded reads as UNAVAILABLE, never as blank or complete', () => {
  const body = bootPage(rcFixture(null)).text('founder-body');
  assert.ok(/no explanation for this coverage verdict/.test(body),
    'an absent completeReason silently vanishes — absence must be stated, not rendered as nothing');
  assert.ok(/UNAVAILABLE/.test(body), 'the absence is not labelled with a contract absence word');
  assert.ok(!/Every required review has bound evidence for every changed file/.test(body),
    'a missing reason rendered as complete coverage');
});

test('RED: the completeness sentence is text — markup in a reviewer name or path cannot become DOM', () => {
  const hostile = 'Review coverage is INCOMPLETE: <img src=x onerror="alert(1)"> read only part of ' +
    '<script>alert(2)</script> the change. Re-run the reviewer(s) named above against this exact change.';
  const page = bootPage(rcFixture(hostile));
  const host = page.document.getElementById('founder-body');
  assert.ok(page.text('founder-body').includes(hostile),
    'the sentence was mangled or dropped instead of being shown verbatim as text');
  const tags = allNodes(host).map((n) => n.tagName);
  assert.ok(!tags.includes('SCRIPT') && !tags.includes('IMG'),
    `markup inside the sentence was parsed into elements: ${tags.join(',')}`);
  // The whole sentence must live in ONE text-bearing node, which is what
  // textContent assignment produces; parsing would have split it into children.
  const carrier = allNodes(host).filter((n) => n._text === hostile);
  assert.strictEqual(carrier.length, 1,
    'the sentence is not carried by a single textContent assignment — some other, unsafe write path is in use');
});

test('RED: the spend panel shows CAD only from dated FX evidence, and UNAVAILABLE without it', () => {
  const noFx = fixtureState({ cost: { state: 'OK', recordedUsdDisplay: 2.46, totalUsd: 'AT LEAST 2.46',
    recordedRuns: 3, unrecordedRuns: 1, caveat: null, byReviewer: { codex: { recordedUsd: 2.46, unrecordedRuns: 1 } },
    cad: { state: 'UNAVAILABLE', reason: 'no canonical FX evidence exists at builder-control/fx-canon.json' },
    source: 'builder-control/review-raw' } });
  const bodyNoFx = bootPage(noFx).text('cost');
  assert.ok(/CAD UNAVAILABLE/.test(bodyNoFx), 'with no rate evidence the headline must read CAD UNAVAILABLE');
  assert.ok(/no canonical FX evidence/.test(bodyNoFx), 'the reason CAD is unavailable must be shown');
  assert.ok(/USD AT LEAST 2\.46/.test(bodyNoFx), 'the USD audit value must survive');

  const withFx = fixtureState({ cost: Object.assign({}, noFx.cost, {
    cad: { state: 'OK', rate: 1.37, asOf: '2026-08-24', ageDays: 1, fxSource: 'Bank of Canada daily rate',
      source: 'builder-control/fx-canon.json', plain: '1 USD = 1.37 CAD, observed 2026-08-24 (Bank of Canada daily rate).',
      recordedCad: 3.38, totalCad: 'AT LEAST 3.38', byReviewerCad: { codex: { recordedCad: 3.38, unrecordedRuns: 1 } } } }) });
  const bodyFx = bootPage(withFx).text('cost');
  assert.ok(/CAD AT LEAST 3\.38/.test(bodyFx), 'the CAD headline is not rendered from the evidence');
  assert.ok(/1 USD = 1\.37 CAD/.test(bodyFx), 'the rate itself must be shown');
  assert.ok(/2026-08-24/.test(bodyFx), 'the rate date must be shown');
  assert.ok(/Bank of Canada daily rate/.test(bodyFx), 'the rate source must be shown');
  assert.ok(/builder-control\/fx-canon\.json/.test(bodyFx), 'the rate evidence file must be cited');
  assert.ok(/USD AT LEAST 2\.46/.test(bodyFx), 'the USD audit value must be preserved alongside CAD');
});

test('no FX rate is hardcoded anywhere in the page — a rate may only arrive as evidence', () => {
  assert.ok(!/\b1\.[23]\d\b/.test(code.replace(/--[\w-]+:[^;]*;/g, '')),
    'a literal exchange-rate-shaped constant appears in the page');
  assert.ok(!/exchangerate|openexchange|fixer\.io|api\.frankfurter/i.test(code),
    'the page must never fetch a live FX rate');
});

// ── SAFE STATE, RECOVERY ROUTE, SPEND AND FRESHNESS ───────────────────────
// Four founder questions the instruments below already carry the evidence for,
// and four ways they used to answer them badly: a receipt id printed without
// saying what it means; an unvalidated receipt reported as no receipt at all;
// runs that never wrote their spend folded into the same grey line as the runs
// that did; and a dated exchange rate rendered as a plain number. Every proof
// here reads the shipped page's own DOM, so a regression fails here rather than
// in front of the owner.
function checkpointRunPage(run) {
  return bootPage(fixtureState({
    runs: { state: 'OK', runs: [run], current: {
      state: 'BOUND', runId: run.runId, updatedAt: run.updatedAt,
      reason: 'exact current run is bound',
    } },
  }));
}

test('DOM: checkpoint and rollback truth is plain English, and identifiers appear only with evidence', () => {
  const commit = 'b'.repeat(40);
  const base = { state: 'CHECKPOINTED', objective: 'Prove the safe state reads in plain English',
    updatedAt: '2026-09-03T10:00:00.000Z' };

  const both = checkpointRunPage(Object.assign({}, base, { runId: 'RUN-CKPT-BOTH',
    checkpoint: 'CHK-BOTH', rollbackPoint: commit, checkpointState: 'VALIDATED' }));
  const bothPanel = evidencePanelsById(both).checkpoint;
  assert.strictEqual(bothPanel.attrs['data-evidence-state'], 'RECORDED');
  assert.match(evidencePanelValue(bothPanel),
    /^This run has a recorded safe state and a recorded way back\./,
    'the recorded case cites identifiers before it answers the question');
  assert.match(evidencePanelValue(bothPanel),
    new RegExp('Checkpoint CHK-BOTH · rollback commit ' + commit),
    'the recorded case dropped the identifiers its evidence actually carries');

  // A checkpoint with no rollback commit: the id is real and is named, the way
  // back is not, and the sentence says which is which rather than implying one.
  const noRoute = checkpointRunPage(Object.assign({}, base, { runId: 'RUN-CKPT-NOROUTE',
    checkpoint: 'CHK-NOROUTE', rollbackPoint: null, checkpointState: 'VALIDATED' }));
  const noRoutePanel = evidencePanelsById(noRoute).checkpoint;
  assert.strictEqual(noRoutePanel.attrs['data-evidence-state'], 'ROLLBACK_UNAVAILABLE');
  assert.match(evidencePanelValue(noRoutePanel),
    /no rollback commit is recorded, so there is no recorded way back/,
    'a checkpoint with no recovery route did not say so in plain English');
  assert.match(evidencePanelValue(noRoutePanel), /Checkpoint CHK-NOROUTE/);
  assert.match(evidencePanelValue(noRoutePanel), /rollback commit UNAVAILABLE/);
  assert.match(noRoutePanel.textContent,
    /Recovery route: UNAVAILABLE — this checkpoint records no rollback commit/);
  assert.ok(!new RegExp(commit).test(noRoutePanel.textContent),
    'a commit this run never recorded appeared beside a checkpoint that has none');

  // Nothing recorded at all: no identifier is invented on any surface.
  const none = checkpointRunPage(Object.assign({}, base, { runId: 'RUN-CKPT-NONE',
    checkpoint: null, rollbackPoint: null, checkpointState: 'ABSENT' }));
  const nonePanel = evidencePanelsById(none).checkpoint;
  assert.strictEqual(nonePanel.attrs['data-evidence-state'], 'NOT_RECORDED');
  assert.strictEqual(evidencePanelValue(nonePanel), 'No safe checkpoint is recorded for this run.');
  assert.ok(!/CHK-/.test(none.text('founder-body') + none.text('evidence-rail-body')),
    'an absent checkpoint was given an identifier');
  assert.strictEqual(none.text('hud-checkpoint-state'), 'No safe state recorded');
  assert.strictEqual(none.document.getElementById('hud-checkpoint-state').attrs['data-hud-code'],
    'NOT_RECORDED', 'the HUD checkpoint footer dropped the exact NOT_RECORDED code');
});

test('DOM: an unvalidated checkpoint receipt is a BLOCKED recovery route, never a simple absence', () => {
  // Exactly what the canonical projector emits for a receipt that failed
  // validation: no public id, no rollback commit, and its recorded reason.
  const reason = 'the checkpoint digest does not authenticate the complete canonical receipt';
  const page = checkpointRunPage({
    runId: 'RUN-CKPT-INVALID', state: 'CHECKPOINTED',
    objective: 'Prove a blocked recovery route fails closed',
    updatedAt: '2026-09-03T10:05:00.000Z',
    checkpoint: null, rollbackPoint: null,
    checkpointState: 'INVALID', checkpointReason: reason,
  });
  const panel = evidencePanelsById(page).checkpoint;
  assert.strictEqual(panel.attrs['data-evidence-state'], 'BLOCKED',
    'an unvalidated checkpoint receipt was not reported as a blocked recovery route');
  assert.match(evidencePanelValue(panel),
    /AEGIS could not validate it, so no safe state and no way back can be named/,
    'a blocked recovery route did not fail closed in words');
  assert.match(panel.textContent, new RegExp('Recorded reason: ' + reason),
    'the canonical refusal reason was replaced by the page\'s own explanation');
  assert.match(panel.textContent, /Recovery route: BLOCKED/);
  assert.match(panel.textContent, /Rollback commit: UNAVAILABLE/);
  assert.strictEqual(page.text('hud-checkpoint-state'), 'Needs attention',
    'the HUD state word disagreed with the blocked sentence beside it');
  assert.strictEqual(page.document.getElementById('hud-checkpoint-state').attrs['data-hud-code'],
    'BLOCKED', 'the HUD checkpoint footer dropped the exact BLOCKED code');

  // Failing closed is not an invitation to repair it by hand: no surface that
  // carries this state may hand the owner something to execute.
  for (const id of ['founder-body', 'hud-checkpoint', 'hud-safe-checkpoint',
    'evidence-rail-body', 'ops-strip-cells', 'runs-list']) {
    const text = page.text(id);
    assert.ok(!/No safe checkpoint is recorded for this run\./.test(text),
      `${id} reported an unvalidated receipt as a run that simply has none`);
    for (const executable of [/\bgit\s/i, /\bnpm\s/i, /\bnode\s+builder-control/i,
      /--force/, /--hard/, /\bcheckout\b/i, /\bsudo\b/i]) {
      assert.ok(!executable.test(text),
        `${id} proposed an executable recovery action matching ${executable}`);
    }
  }
  // The run card is where a blocked receipt used to vanish entirely, because
  // the projector clears run.checkpoint for it.
  assert.match(page.text('runs-list'), /could not validate it/,
    'run history hid a blocked recovery route behind an absent checkpoint id');
});

test('RED: recorded spend and unrecorded runs are shaped apart, and stale CAD evidence is named as dated', () => {
  const staleFx = {
    state: 'STALE', rate: 1.41, asOf: '2026-08-01', ageDays: 33,
    fxSource: 'Bank of Canada daily rate', source: 'builder-control/fx-canon.json',
    plain: '1 USD = 1.41 CAD, observed 2026-08-01 (Bank of Canada daily rate). ' +
      'That evidence is 33 days old, so every CAD figure here is dated, not current.',
    recordedCad: 3.47, totalCad: 'AT LEAST 3.47',
    byReviewerCad: { codex: { recordedCad: 3.47, unrecordedRuns: 2 } },
  };
  const page = bootPage(fixtureState({ cost: {
    state: 'OK', recordedUsdDisplay: 2.46, totalUsd: 'AT LEAST 2.46',
    recordedRuns: 3, unrecordedRuns: 2, caveat: null,
    byReviewer: { codex: { recordedUsd: 2.46, unrecordedRuns: 2 } },
    source: 'builder-control/review-raw', cad: staleFx,
  } }));

  // Two facts, two elements, two treatments — not one grey sentence in which
  // the runs that never reported their spend read as a footnote to the ones
  // that did.
  const nodes = allNodes(page.document.getElementById('cost'));
  const recorded = nodes.find((node) => String(node.className) === 'cost-recorded');
  const unrecorded = nodes.find((node) => String(node.className) === 'cost-unrecorded');
  assert.ok(recorded, 'the spend panel does not shape recorded spend as its own element');
  assert.ok(unrecorded, 'unrecorded runs share the recorded-spend treatment, so the unknown is invisible');
  assert.match(recorded.textContent, /RECORDED: 3 run\(s\) reported cost/);
  assert.match(unrecorded.textContent, /UNRECORDED: 2 run\(s\) reported none/);
  assert.match(unrecorded.textContent, /never zero/,
    'unrecorded spend is not stated as real-but-unknown');
  assert.ok(/\.cost-unrecorded\{[^}]*border-left:2px solid var\(--warn\)/.test(code),
    'unrecorded spend is separated from recorded spend by colour alone');

  // Dated FX evidence is named in the figure and beside it, never rendered as
  // a current rate.
  const body = page.text('cost');
  assert.match(body, /CAD AT LEAST 3\.47/, 'the CAD figure is not rendered from the dated evidence');
  assert.match(body, /STALE/, 'the stale FX chip is gone');
  assert.match(body,
    /Dated CAD evidence: the rate above was observed 2026-08-01 and is 33 day\(s\) old/,
    'stale FX evidence is not named with its own observation date and age');
  assert.match(body, /dated, not current/);

  // The strip and the Detail View rail read the same resolution, so no surface
  // can present the dated figure as current or the unknown spend as zero.
  const costPanel = evidencePanelsById(page).cost;
  assert.match(evidencePanelValue(costPanel),
    /CAD AT LEAST 3\.47 — dated CAD, converted at FX evidence observed 2026-08-01, not a current rate\./,
    'the Detail View CAD figure does not name its dated rate');
  assert.match(costPanel.textContent, /Recorded spend: 3 run\(s\) reported what they cost\./);
  assert.match(costPanel.textContent, /UNRECORDED spend: 2 run\(s\) wrote no cost telemetry/);
  assert.match(costPanel.textContent, /it is not zero and it is not in the figure above/);
  assert.ok(!/CAD 0\b|\$0\b/.test(costPanel.textContent + body),
    'unrecorded spend was rendered as a zero somewhere on the spend surface');
});

test('the safe-state and spend instruments cannot drag a desktop or a phone sideways', () => {
  // Every instrument that carries a canonical identifier or a dense figure has
  // to break the word rather than widen the page — on the half-width pilot
  // cards as well as at the phone breakpoint.
  for (const selector of ['.command-value', '.hud-summary-value', '.evidence-value',
    '.cost-recorded,.cost-unrecorded']) {
    assert.ok(new RegExp(selector.replace(/\./g, '\\.') + '\\{[^}]*overflow-wrap:anywhere').test(code),
      `${selector} carries canonical values that cannot wrap, so a 40-character commit overflows`);
  }
  assert.ok(/\.cost-head\{[^}]*flex-wrap:wrap/.test(code),
    'the spend headline row cannot wrap its figure, chip and two run counts');
  const phoneWrapped = phoneSelectorsDeclaring(/overflow-wrap:anywhere/);
  for (const selector of ['.command-value', '.hud-value']) {
    assert.ok(phoneWrapped.has(selector),
      `${selector} loses its phone wrapping, so the cockpit scrolls sideways`);
  }
});

// ── WHY THIS MODEL / TOOL — the routing instrument may not infer a reason ───
// The pilot deck names a worker. The founder's next question is "why that
// one?", and the only honest answer is the run's recorded route: who selected
// it, and — for a refusal — the one reason AEGIS actually writes down. A
// successful route records the selection and no reason at all, so the card must
// say the reason is UNAVAILABLE rather than reconstruct a plausible capability,
// cost or failover story the evidence never contained.
function routingFixture(run, over) {
  return fixtureState(Object.assign({
    generatedAt: '2026-09-02T12:10:00.000Z',
    runs: { state: 'OK', runs: [run], current: {
      state: 'BOUND', runId: run.runId, updatedAt: run.updatedAt,
      reason: 'exact current run is bound',
    } },
  }, over || {}));
}

function routingRun(over) {
  return Object.assign({
    runId: 'RUN-ROUTING-WHY', state: 'BUILDING',
    objective: 'Explain the selected worker from routing evidence',
    updatedAt: '2026-09-02T12:10:00.000Z', transitions: 4,
    build: {
      mode: 'async', status: 'RUNNING', workerPid: 6161,
      startedAt: '2026-09-02T12:00:00.000Z', endedAt: null,
      activity: { active: true, phase: 'RUNNING', code: 'RUNNING', summary: 'Builder is running' },
    },
  }, over || {});
}

function operatorFields(page) {
  return findByAttr(page.document.getElementById('founder-body'), 'data-operator-field');
}

function routingCard(page) {
  return operatorFields(page).find((node) => node.attrs['data-operator-field'] === 'why-this-model-/-tool');
}

// The card is label + value; the rendered claim under test is the value.
function routingText(page) {
  const card = routingCard(page);
  assert.ok(card, 'the WHY THIS MODEL / TOOL card is missing');
  return card.lastChild.textContent;
}

test('the routing instrument is one pilot card built beside Crew / Model from run.route alone', () => {
  assert.ok(/commandCard\('WHY THIS MODEL \/ TOOL'/.test(code),
    'the pilot deck has no WHY THIS MODEL / TOOL instrument');
  const grid = code.slice(code.indexOf("commandGrid.appendChild(commandCard('CREW / MODEL'"),
    code.indexOf('deckDetails.appendChild(commandGrid)'));
  assert.strictEqual((grid.match(/commandCard\('WHY THIS MODEL \/ TOOL'/g) || []).length, 1,
    'the routing instrument must appear exactly once in the primary pilot deck');
  assert.ok(grid.indexOf("commandCard('WHY THIS MODEL / TOOL'") < grid.indexOf("commandCard('CURRENT ACTION'"),
    'the routing instrument was separated from Crew / Model by other pilot cards');
  const fn = code.slice(code.indexOf('function routingRationale'), code.indexOf('function elapsedEvidence'));
  assert.ok(fn.length > 0, 'no routingRationale() boundary found');
  assert.ok(/route\.source === 'tool-router\.cjs routeRole'/.test(fn),
    'a selected route is claimed without the canonical router source marker');
  for (const invented of ['capabilit', 'cheaper', 'cost', 'usd', 'fallback', 'failover', 'faster', 'best']) {
    assert.ok(!new RegExp(invented, 'i').test(fn.replace(/\/\/[^\n]*/g, '')),
      `the routing instrument invents a "${invented}" claim that routing evidence does not carry`);
  }
});

test('DOM: a router-selected route names the selection and its authority, and still calls the reason UNAVAILABLE', () => {
  const page = bootPage(routingFixture(routingRun({
    route: { model: 'claude-opus-5', execution: 'claude-cli', source: 'tool-router.cjs routeRole' },
  })));
  const card = routingCard(page);
  assert.ok(card, 'the WHY THIS MODEL / TOOL card is missing');
  const fields = operatorFields(page).map((node) => node.attrs['data-operator-field']);
  assert.strictEqual(fields.indexOf('why-this-model-/-tool'), fields.indexOf('crew-/-model') + 1,
    `the routing instrument no longer renders beside Crew / Model: ${fields.join(', ')}`);
  assert.strictEqual(card.getAttribute('hidden'), null,
    'the routing instrument is hidden during an active build');
  assert.strictEqual(card.firstChild.textContent, 'WHY THIS MODEL / TOOL',
    'the routing instrument lost its founder-readable label');
  const text = routingText(page);
  assert.match(text, /claude-opus-5/, 'the card does not name the routed model');
  assert.match(text, /^AEGIS chose /, `the selection is not stated in plain English: ${text}`);
  assert.match(text, /claude-cli/, 'the card does not name the recorded execution path');
  assert.match(text, /No selection reason is recorded[\s\S]*UNAVAILABLE/,
    `a recorded selection reason was invented: ${text}`);
  assert.doesNotMatch(text, /capabilit|cost|cheap|fallback|failover|fastest|best/i,
    `the card claimed a capability, cost or fallback fact: ${text}`);
  // The source marker is provenance, not headline copy: it must leave the
  // sentence and stay reachable as the card's accessible detail.
  assert.doesNotMatch(text, /tool-router\.cjs|routeRole|\.cjs/,
    `a source function name is still primary card copy: ${text}`);
  for (const field of ['why-this-model-/-tool', 'crew-/-model']) {
    const node = operatorFields(page).find((n) => n.attrs['data-operator-field'] === field);
    assert.strictEqual(node.attrs.title,
      'Recorded route: model claude-opus-5 · execution claude-cli · recorded by tool-router.cjs routeRole',
      `${field} no longer keeps the exact recorded route reachable: ${node.attrs.title}`);
  }
});

test('DOM: the canonical Claude subscription route reads naturally and keeps its exact record', () => {
  const page = bootPage(routingFixture(routingRun({
    route: { model: 'claude', execution: 'SUBSCRIPTION', source: 'tool-router.cjs routeRole' },
  })));
  const crew = operatorFields(page).find((n) => n.attrs['data-operator-field'] === 'crew-/-model');
  assert.strictEqual(crew.lastChild.textContent, 'Claude · Subscription · Selected by AEGIS',
    `the recorded subscription route does not read as plain English: ${crew.lastChild.textContent}`);
  assert.strictEqual(page.text('hud-crew'), crew.lastChild.textContent,
    'the HUD and the deck stopped sharing one crew identity');
  assert.strictEqual(routingText(page),
    'AEGIS chose Claude for this run, and recorded Subscription as the way to run it. ' +
    'No selection reason is recorded with that choice, so why AEGIS picked this one is UNAVAILABLE.',
    `the routing card invented or lost part of the recorded selection: ${routingText(page)}`);
  assert.match(crew.attrs.title, /model claude · execution SUBSCRIPTION · recorded by tool-router\.cjs routeRole/,
    `the exact recorded identifiers are no longer reachable: ${crew.attrs.title}`);
});

test('DOM: an unknown provider or execution label is shown as recorded, never given a friendly alias', () => {
  const page = bootPage(routingFixture(routingRun({
    route: { model: 'grok-builder', execution: 'CANON_UNKNOWN_REQUIRES_PREFLIGHT',
      source: 'tool-router.cjs routeRole' },
  })));
  const crew = operatorFields(page).find((n) => n.attrs['data-operator-field'] === 'crew-/-model');
  assert.strictEqual(crew.lastChild.textContent,
    'grok-builder · CANON_UNKNOWN_REQUIRES_PREFLIGHT · Selected by AEGIS',
    `an unrecognised route label was renamed instead of shown as recorded: ${crew.lastChild.textContent}`);
});

test('DOM: a REFUSED route renders its canonical refusal code and recorded reason', () => {
  const page = bootPage(routingFixture(routingRun({
    state: 'CREATED', build: undefined,
    route: { state: 'REFUSED', code: 'DATA_CLASS_VETO',
      reason: 'SECRET data may not be sent to claude-opus-5 (max INTERNAL).' },
  })));
  const text = routingText(page);
  assert.strictEqual(text,
    'AEGIS routing refused to select a worker for this run (DATA_CLASS_VETO). ' +
    'Recorded routing reason: SECRET data may not be sent to claude-opus-5 (max INTERNAL).',
    `the refusal code and the one reason routing actually records were not rendered exactly: ${text}`);
});

test('DOM: a named worker without router evidence reports the routing reason as UNAVAILABLE', () => {
  const page = bootPage(routingFixture(routingRun({
    builder: { provider: 'claude-subscription', model: 'claude-opus-5' },
  })));
  const text = routingText(page);
  assert.strictEqual(text,
    'This run names claude-opus-5 via claude-subscription as its worker, but no canonical routing ' +
    'decision is recorded for it, so the routing reason is UNAVAILABLE.',
    `a routing reason the run never recorded was inferred for a named worker: ${text}`);
  // The crew line carries the same distinction, because it is also read alone
  // on the HUD and on the build-sequence strip.
  const crew = operatorFields(page).find((n) => n.attrs['data-operator-field'] === 'crew-/-model');
  assert.strictEqual(crew.lastChild.textContent,
    'claude-opus-5 via claude-subscription · named on the run record, not a recorded AEGIS selection',
    `a builder-only name was presented as a proven AEGIS selection: ${crew.lastChild.textContent}`);
  assert.doesNotMatch(crew.lastChild.textContent, /Selected by AEGIS/,
    'a builder-only name borrowed the router-selected wording');
  assert.strictEqual(crew.attrs.title, undefined,
    'a run with no recorded route advertised route provenance it does not have');
});

test('DOM: a run with no routing evidence states UNAVAILABLE and names no model', () => {
  const text = routingText(bootPage(routingFixture(routingRun())));
  assert.strictEqual(text,
    'No canonical routing decision is recorded for this run, so the routing reason is UNAVAILABLE.',
    `absent routing evidence produced something other than an honest absence: ${text}`);

  assert.strictEqual(routingText(bootPage(fixtureState())),
    'No run is active, so no routing decision is recorded.',
    'an idle dashboard claims a routing decision it does not have');
});

// ── LIVE EVIDENCE — the live surface must name what it is actually made of ─
// "Live" here means exactly one thing: the canonical run record changed. The
// card may therefore report only the two facts aegis-run writes down — the
// updatedAt stamp of the last lifecycle event and the ledger's transition
// counter — and must say UNAVAILABLE when either is missing or unusable. The
// failure this guards is a card that reads the browser clock and presents it as
// evidence of a running build.
function liveEvidenceFixture(run) {
  return fixtureState({
    generatedAt: '2026-09-02T12:10:00.000Z',
    runs: { state: 'OK', runs: [run], current: {
      state: 'BOUND', runId: run.runId, updatedAt: run.updatedAt || null,
      reason: 'exact current run is bound',
    } },
  });
}

// The card is label + value; the rendered claim under test is the value.
function liveEvidenceText(page) {
  const card = operatorFields(page).find((node) => node.attrs['data-operator-field'] === 'live-evidence');
  assert.ok(card, 'the LIVE EVIDENCE card is missing from the pilot deck');
  assert.strictEqual(card.firstChild.textContent, 'LIVE EVIDENCE',
    'the live evidence instrument lost its founder-readable label');
  return card.lastChild.textContent;
}

test('the live evidence instrument is one pilot card beside CURRENT ACTION with no clock of its own', () => {
  const grid = code.slice(code.indexOf("commandGrid.appendChild(commandCard('CREW / MODEL'"),
    code.indexOf('deckDetails.appendChild(commandGrid)'));
  assert.strictEqual((grid.match(/commandCard\('LIVE EVIDENCE'/g) || []).length, 1,
    'the live evidence instrument must appear exactly once in the primary pilot deck');
  assert.ok(grid.indexOf("commandCard('CURRENT ACTION'") < grid.indexOf("commandCard('LIVE EVIDENCE'") &&
    grid.indexOf("commandCard('LIVE EVIDENCE'") < grid.indexOf("commandCard('NEXT STEP'"),
    'the live evidence instrument was separated from CURRENT ACTION by other pilot cards');
  // Slice liveEvidence()'s OWN body, ended at its closing brace rather than at
  // the next named function. Sibling helpers declared after it are governed by
  // their own proofs; sweeping them in here would report their vocabulary —
  // heartbeat, progress — as an invention of this card, which reads neither.
  const fnStart = code.indexOf('function liveEvidence');
  const fnEnd = code.indexOf('\n  }\n', fnStart);
  assert.ok(fnStart !== -1 && fnEnd !== -1 && fnEnd < code.indexOf('function missionHeadline'),
    'no liveEvidence() boundary found');
  const fn = code.slice(fnStart, fnEnd);
  assert.ok(/run\.updatedAt/.test(fn), 'the lifecycle event time is not read from run.updatedAt');
  assert.ok(/run\.transitions/.test(fn), 'the transition count is not read from the canonical run record');
  assert.ok(!/Date\.now\s*\(/.test(fn), 'the live card reads the browser clock instead of the run record');
  const executable = fn.replace(/\/\/[^\n]*/g, '');
  for (const invented of ['setInterval', 'setTimeout', 'heartbeatAt', 'progress', 'percent', 'score', 'fetch']) {
    assert.ok(!new RegExp(invented, 'i').test(executable),
      `the live evidence instrument invents a "${invented}" mechanism the run record does not carry`);
  }
});

test('DOM: a completed run reports its exact recorded lifecycle time and transition count', () => {
  const page = bootPage(liveEvidenceFixture({
    runId: 'RUN-LIVE-EVIDENCE', state: 'CHECKPOINTED',
    objective: 'Show the founder what the live surface is based on',
    updatedAt: '2026-09-02T12:09:30.000Z', transitions: 7,
  }));
  assert.strictEqual(liveEvidenceText(page),
    'Last recorded lifecycle event: 2026-09-02T12:09:30.000Z. Recorded transitions: 7. ' +
    'This card reads the canonical run record only; it is not a heartbeat.',
    'the recorded lifecycle evidence was not rendered exactly as the run record wrote it');
});

test('DOM: an active run reports the same two recorded facts, including a zero transition count', () => {
  const page = bootPage(liveEvidenceFixture({
    runId: 'RUN-LIVE-EVIDENCE-ACTIVE', state: 'BUILDING',
    objective: 'Prove an active run reports recorded evidence, not elapsed time',
    updatedAt: '2026-09-02T12:00:00.000Z', transitions: 0,
    build: { mode: 'async', status: 'RUNNING', startedAt: '2026-09-02T11:59:00.000Z', endedAt: null },
  }));
  assert.strictEqual(liveEvidenceText(page),
    'Last recorded lifecycle event: 2026-09-02T12:00:00.000Z. Recorded transitions: 0. ' +
    'This card reads the canonical run record only; it is not a heartbeat.',
    'a recorded zero transition count must be reported as 0, never as an absence');
});

test('DOM: missing or invalid lifecycle evidence is reported as UNAVAILABLE, never reconstructed', () => {
  const invalid = bootPage(liveEvidenceFixture({
    runId: 'RUN-LIVE-EVIDENCE-INVALID', state: 'BUILDING',
    objective: 'Prove unusable evidence is refused',
    updatedAt: 'not-a-timestamp', transitions: 'several',
  }));
  assert.strictEqual(liveEvidenceText(invalid),
    'Last recorded lifecycle event: UNAVAILABLE. Recorded transitions: UNAVAILABLE. ' +
    'This card reads the canonical run record only; it is not a heartbeat.',
    'unparseable lifecycle evidence was rendered as if it were a fact');

  const missing = bootPage(liveEvidenceFixture({
    runId: 'RUN-LIVE-EVIDENCE-MISSING', state: 'BUILT',
    objective: 'Prove absent evidence is refused',
  }));
  assert.strictEqual(liveEvidenceText(missing),
    'Last recorded lifecycle event: UNAVAILABLE. Recorded transitions: UNAVAILABLE. ' +
    'This card reads the canonical run record only; it is not a heartbeat.',
    'absent lifecycle evidence produced something other than an honest absence');

  assert.strictEqual(liveEvidenceText(bootPage(fixtureState())),
    'No canonical run is recorded, so live evidence is UNAVAILABLE.',
    'an idle dashboard claims live evidence it does not have');
});

// ── V2 OPERATOR COCKPIT — the operator brief ──────────────────────────────
// Completed so far / Still to verify / Right now / Next action / Attention.
// The brief is the first
// thing the owner reads and the single place the deck explains itself in
// founder language, so the only thing it may do is repeat canonical fields the
// deck has already resolved. These proofs hold the properties that would make
// it a liability if they regressed: the five questions are actually named,
// each answer is the canonical field itself rather than a second derivation of
// it, and an absent field produces an honest UNAVAILABLE instead of a
// reassuring sentence. It must also stay inert — no timer, no elapsed
// arithmetic, no invented activity.
function briefRows(page) {
  return findByAttr(page.document.getElementById('founder-body'), 'data-operator-brief')
    .filter((node) => node.attrs['data-operator-brief'] !== 'summary');
}

function briefField(page, field) {
  const row = briefRows(page).find((node) => node.attrs['data-operator-brief'] === field);
  assert.ok(row, `the operator brief has no ${field} row`);
  return { label: row.firstChild.textContent, value: row.lastChild.textContent };
}

function deckCardText(page, field) {
  const card = operatorFields(page).find((node) => node.attrs['data-operator-field'] === field);
  assert.ok(card, `the pilot deck has no ${field} card`);
  return card.lastChild.textContent;
}

function briefBuildingFixture() {
  const run = {
    runId: 'RUN-BRIEF', state: 'BUILDING', objective: 'Prove the operator brief repeats canonical fields',
    updatedAt: '2026-09-02T14:10:00.000Z',
    build: {
      mode: 'async', status: 'RUNNING', workerPid: 4242,
      startedAt: '2026-09-02T14:00:00.000Z', endedAt: null,
      activity: { active: true, summary: 'Editing the command deck.' },
    },
  };
  return fixtureState({
    generatedAt: '2026-09-02T14:10:00.000Z',
    runs: { state: 'OK', runs: [run], current: { state: 'BOUND', runId: run.runId,
      updatedAt: run.updatedAt, reason: 'exact current run is bound' } },
  });
}

// The malformed-evidence projection is the honest-absence case that a real
// operator hits: the ledger could not be read, so no answer about the owner is
// available and none may be invented.
function briefUnreadableLedgerStatus() {
  return {
    generatedAt: '2026-09-02T14:20:00.000Z',
    engineering: fixtureState().engineering,
    integration: { connectors: [] }, reviewers: [],
    cost: { state: 'UNAVAILABLE', reason: null },
    runs: [],
    runsBinding: { state: 'UNAVAILABLE', runId: null, updatedAt: null, evidenceState: 'UNAVAILABLE',
      reason: '1 run record(s) could not be read or validated, so current run status is unavailable.' },
    events: [], knowledge: { state: 'UNKNOWN', conflicts: null },
  };
}

test('DOM: the operator brief names the five operator questions in the owner\'s words at the top of Command View', () => {
  const page = bootPage(fixtureState());
  const rows = briefRows(page);
  assert.deepStrictEqual(rows.map((node) => node.attrs['data-operator-brief']),
    ['finished', 'verify', 'now', 'next', 'needs-marc'],
    'the brief must answer exactly the five operator questions, in that order');
  // The headings are the operator's own words. "Needs Marc" in particular
  // named an owner for evidence that is usually a generic build blocker.
  assert.deepStrictEqual(rows.map((node) => node.firstChild.textContent),
    ['Completed so far', 'Still to verify', 'Right now', 'Next action', 'Attention'],
    'the five brief labels are not rendered as founder-readable text');
  assert.doesNotMatch(rows.map((node) => node.firstChild.textContent).join(' '), /Marc/i,
    'a brief heading still claims every blocker is a personal request for the owner');
  const founder = page.document.getElementById('founder-body');
  const classes = founder.children.map((node) => node.className);
  const brief = classes.indexOf('operator-brief');
  assert.ok(brief !== -1, 'no operator brief is rendered in Command View');
  assert.ok(brief <= 1, `the brief is not near the top of Command View: ${classes.join(', ')}`);
  // The dense cards now sit inside one disclosure; the brief still reads first.
  assert.ok(brief < classes.indexOf('command-details'),
    'the brief must read before the dense pilot card disclosure, not after it');
  assert.strictEqual(classes.filter((cls) => cls === 'operator-brief').length, 1,
    'exactly one operator brief may exist — a second copy would drift from the first');
});

test('DOM: every brief answer is the canonical field the deck already resolved, not a second derivation', () => {
  const page = bootPage(briefBuildingFixture());
  assert.strictEqual(briefField(page, 'now').value, deckCardText(page, 'current-action'),
    'NOW is not the canonical current-action field');
  assert.strictEqual(briefField(page, 'next').value, deckCardText(page, 'next-step'),
    'NEXT is not the canonical next-action field');
  const needs = briefField(page, 'needs-marc').value;
  const blocker = deckCardText(page, 'blocker');
  assert.ok(needs.endsWith(blocker),
    `Attention is not built from the canonical blocker/decision field: ${needs}`);
  assert.match(briefField(page, 'now').value, /Editing the command deck\./,
    'Right now dropped the recorded worker activity the deck reads');
  // A running builder is a stage fact, not an owner decision — and an absent
  // blocker is not a record that owner approvals are settled either.
  assert.match(needs, /No blocker is currently recorded, which is not evidence that owner approvals are settled\./,
    `a running build was presented as waiting on the owner: ${needs}`);
  for (const invented of [/\d+\s*%/, /elapsed/i, /remaining/i, /estimat/i, /progress/i]) {
    assert.doesNotMatch(briefRows(page).map((node) => node.textContent).join(' '), invented,
      `the brief invented a ${invented} claim the canonical fields do not carry`);
  }
});

test('DOM: Attention states only what a clear blocker proves, and never softens a real one', () => {
  const idle = bootPage(fixtureState());
  const idleNeeds = briefField(idle, 'needs-marc').value;
  assert.match(idleNeeds, /No blocker is currently recorded, which is not evidence that owner approvals are settled\./,
    `an idle deck did not state plainly what its clear blocker evidence proves: ${idleNeeds}`);
  // blockerClear proves an absence of blockers, so the row may not be read as
  // a positive record that the owner has approved anything.
  assert.doesNotMatch(idleNeeds, /No owner decision is (?:canonically )?required/,
    `an absent blocker was inflated into settled owner approval: ${idleNeeds}`);
  assert.ok(idleNeeds.includes(deckCardText(idle, 'blocker')),
    'the plain "no blocker recorded" answer dropped the canonical blocker line it rests on');

  const blockedState = fixtureState({
    engineering: Object.assign({}, fixtureState().engineering, { state: 'OK', problems: [] }),
    runs: { state: 'OK', runs: [], current: { state: 'MISMATCHED', runId: 'RUN-WRONG',
      reason: 'binding subject does not match the current subject' } },
  });
  const blocked = bootPage(blockedState);
  const blockedNeeds = briefField(blocked, 'needs-marc').value;
  assert.strictEqual(blockedNeeds, deckCardText(blocked, 'blocker'),
    'a real blocker was not carried into Attention verbatim');
  assert.doesNotMatch(blockedNeeds, /No blocker is currently recorded/,
    `a recorded blocker was reported as needing nothing from the owner: ${blockedNeeds}`);
});

test('DOM: unreadable run evidence makes the brief say so instead of answering for the owner', () => {
  const page = bootPage(fixtureState());
  renderMinimizedStatus(page, briefUnreadableLedgerStatus());
  const now = briefField(page, 'now').value;
  const needs = briefField(page, 'needs-marc').value;
  assert.strictEqual(now, deckCardText(page, 'current-action'),
    'NOW stopped tracking the canonical current-action field under unavailable evidence');
  assert.strictEqual(needs, deckCardText(page, 'blocker'),
    'Attention stopped tracking the canonical blocker field under unavailable evidence');
  assert.match(needs, /could not be read or validated/,
    `the recorded reason the ledger is unusable was withheld from the brief: ${needs}`);
  assert.doesNotMatch(needs, /No blocker is currently recorded/,
    'unreadable evidence was rendered as a positive "nothing is needed" answer');
  assert.doesNotMatch(briefRows(page).map((node) => node.textContent).join(' '), /No blocker — no run has started\./,
    'unreadable evidence was rendered as clean idle in the brief');
  // No bound run is not the same fact as nothing built. An unreadable ledger
  // produces no run too, so the founder answers must fail closed rather than
  // report a clean slate the evidence cannot support.
  assert.strictEqual(briefField(page, 'finished').value,
    'UNAVAILABLE — canonical run evidence does not record what finished.',
    'an unreadable ledger was reported as "nothing has been built yet"');
  assert.strictEqual(briefField(page, 'verify').value,
    'UNAVAILABLE — canonical evidence does not record whether anything was verified.',
    'an unreadable ledger was reported as having nothing left to verify');

  const idle = bootPage(fixtureState());
  assert.strictEqual(briefField(idle, 'finished').value,
    'Nothing has been built yet — no run has started.',
    'positively clean idle evidence was withheld from the founder answer');
  assert.strictEqual(briefField(idle, 'verify').value, 'Nothing is waiting to be verified.',
    'positively clean idle evidence was withheld from the founder answer');
});

test('the brief is inert: it computes no time, no activity and no status of its own', () => {
  const start = code.indexOf("var brief = el('div','operator-brief')");
  const end = code.indexOf('renderHandoff(host, boundRun, currentAction)', start);
  assert.ok(start !== -1 && end > start, 'the operator brief renderer boundary was not found');
  const brief = code.slice(start, end);
  for (const banned of ['setInterval', 'setTimeout', 'requestAnimationFrame', 'Date.now', 'new Date',
    'Math.random', 'fetch(', 'innerHTML', 'addEventListener']) {
    assert.ok(!brief.includes(banned),
      `the brief uses ${banned} — it may only re-read fields the deck already resolved`);
  }
  // Only the canonical inputs the packet allows — the two founder-language
  // fields are resolved with the rest of the deck, so the brief still only
  // re-reads values, it never computes one.
  for (const canonical of ['deckFinished', 'deckVerification', 'currentAction',
    'deckActions.join', 'operatorBlocker', 'blockerClear']) {
    assert.ok(brief.includes(canonical), `the brief no longer reads the canonical ${canonical} field`);
  }
  for (const raw of ['boundRun', 'view.', 'S.runs', 'build.activity', 'elapsed']) {
    assert.ok(!brief.includes(raw), `the brief reaches past the resolved deck fields into ${raw}`);
  }
  assert.ok(/UNAVAILABLE — no canonical run evidence records what finished\./.test(brief) &&
    /UNAVAILABLE — no canonical evidence records whether this code version was verified\./.test(brief) &&
    /UNAVAILABLE — no current action is recorded in canonical run evidence\./.test(brief) &&
    /UNAVAILABLE — no next action is recorded in canonical run evidence\./.test(brief) &&
    /UNAVAILABLE — no canonical blocker or decision evidence is recorded/.test(brief),
    'an absent canonical field would render as blank or reassuring text instead of an honest UNAVAILABLE');
  assert.ok(!/@keyframes|animation\s*:/.test(code.slice(code.indexOf('.operator-brief{'),
    code.indexOf('.handoff{display:flex'))), 'the brief block introduced motion');
});

// ── V2 OPERATOR COCKPIT — one disclosure for the duplicated instruments ────
// The brief above already answers crew, action, blocker, next and checkpoint in
// founder language; the command cards restate the same canonical fields in
// instrument form. They stay — nothing is deleted, moved to a second resolution
// or recomputed — but they sit behind one native disclosure so the answers and
// the governed controls own the first screen. The properties that matter are
// therefore: the cards are all still there, the brief and the controls are not
// inside with them, and a live repaint cannot shut the disclosure or drop the
// keyboard while Marc is reading it.
function deckDisclosureNode(page) {
  const nodes = findByAttr(page.document.getElementById('founder-body'), 'data-operator-disclosure');
  assert.strictEqual(nodes.length, 1, `expected exactly one deck disclosure, found ${nodes.length}`);
  return nodes[0];
}

function deckCardPairs(root) {
  return findByAttr(root, 'data-operator-field')
    .map((node) => [node.attrs['data-operator-field'], node.textContent]);
}

// The same building run the brief fixtures use, in the flat /api/status shape,
// so a repaint arrives through the real live seam rather than a re-render.
function briefBuildingStatus() {
  const state = briefBuildingFixture();
  return {
    generatedAt: state.generatedAt,
    engineering: state.engineering,
    integration: { connectors: [] }, reviewers: [],
    cost: { state: 'UNAVAILABLE', reason: null },
    runs: state.runs.runs, runsBinding: state.runs.current,
    events: [], knowledge: { state: 'UNKNOWN', conflicts: null },
  };
}

test('DOM: the duplicated technical cards sit in one labelled disclosure, collapsed, with the brief and controls outside it', () => {
  const page = bootPage(briefBuildingFixture());
  const disclosure = deckDisclosureNode(page);
  assert.strictEqual(disclosure.tagName, 'DETAILS',
    'the secondary instruments are not a native disclosure, so they are not keyboard-operable');
  assert.strictEqual(disclosure.open, false,
    'the secondary instruments are disclosed by default, which is the clutter this replaced');
  const summary = disclosure.firstElementChild;
  assert.strictEqual(summary.tagName, 'SUMMARY', 'the disclosure has no summary to operate');
  assert.strictEqual(summary.textContent, 'Worker and evidence details',
    'the disclosure does not say what it holds');
  // Every command card is inside it, once, and the grid is whole.
  assert.deepStrictEqual(findByAttr(disclosure, 'data-operator-field')
    .map((node) => node.attrs['data-operator-field']),
  ['crew-/-model', 'why-this-model-/-tool', 'current-action', 'live-evidence',
    'builder-progress', 'failure-state', 'next-step', 'blocker', 'last-safe-checkpoint', 'elapsed'],
  'the disclosure changed which instruments exist instead of only collapsing them');
  const founder = page.document.getElementById('founder-body');
  assert.strictEqual(findByAttr(founder, 'data-operator-field').length,
    findByAttr(disclosure, 'data-operator-field').length,
    'a command card was duplicated or left behind outside the disclosure');
  // The primary answers and every control stay outside and visible.
  assert.strictEqual(findByAttr(disclosure, 'data-operator-brief').length, 0,
    'the operator brief was collapsed along with the cards it explains');
  assert.deepStrictEqual(allNodes(disclosure).filter((node) => node.tagName === 'BUTTON'), [],
    'a governed control was moved inside the collapsed disclosure');
  assert.strictEqual(page.text('hud-crew'), deckCardText(page, 'crew-/-model'),
    'the crew the disclosure holds is no longer stated in the visible HUD');
  for (const answer of ['now', 'next', 'needs-marc']) {
    assert.ok(briefField(page, answer).value.length > 0,
      `the ${answer} answer was hidden or emptied by the disclosure`);
  }
});

test('DOM: the disclosure survives a real status repaint with its open state, its keyboard position and every card', () => {
  const page = bootPage(briefBuildingFixture());
  renderMinimizedStatus(page, briefBuildingStatus());
  const opened = deckDisclosureNode(page);
  // What a browser does when the summary is operated by keyboard: the element
  // opens. Nothing here reaches past the real rendered node.
  opened.open = true;
  opened.firstElementChild.focus();
  const before = deckCardPairs(opened);
  assert.ok(before.length === 10, 'the fixture did not render the full instrument grid');

  renderMinimizedStatus(page, briefBuildingStatus());
  const after = deckDisclosureNode(page);
  assert.notStrictEqual(after, opened, 'the deck was never repainted, so this proves nothing');
  assert.strictEqual(after.open, true,
    'a live status repaint shut the disclosure while the owner was inspecting it');
  assert.strictEqual(page.document.activeElement, after.firstElementChild,
    'the repaint left the keyboard behind on a discarded summary');
  assert.deepStrictEqual(deckCardPairs(after), before,
    'the repaint removed or recomputed evidence inside the disclosure');
});

test('the disclosure is presentation only: no timer, no state of its own, no forced close', () => {
  const start = code.indexOf("var deckDetails = el('details','command-details')");
  const end = code.indexOf('currentOperatorContext = {', start);
  assert.ok(start !== -1 && end > start, 'the deck disclosure renderer boundary was not found');
  const block = code.slice(start, end);
  for (const banned of ['setInterval', 'setTimeout', 'requestAnimationFrame', 'Date.now', 'new Date',
    'fetch(', 'innerHTML', 'localStorage', 'sessionStorage']) {
    assert.ok(!block.includes(banned),
      `the disclosure uses ${banned} — it may only carry over the state already in the DOM`);
  }
  assert.ok(/deckDetails\.open = disclosureOpen;/.test(block),
    'the disclosure no longer restores the open state the repaint is replacing');
  assert.ok(/document\.activeElement === priorDisclosure\.firstElementChild/.test(code),
    'the keyboard position on the summary is read from something other than the live DOM');
  // Existing tokens only: a summary already carries the page's focus ring, and
  // the phone rules already size every disclosure as a finger-sized target.
  assert.ok(/\.command-details>summary\{cursor:pointer;color:var\(--text-1\);font-weight:600/.test(code),
    'the disclosure summary does not use the deck\'s existing disclosure treatment');
  assert.ok(phoneSelectorsDeclaring(/min-height:44px/).has('.command-details>summary'),
    'the disclosure summary is not a finger-sized target at phone width');
  assert.ok(!/animation|transition/.test(code.slice(code.indexOf('.command-details{'),
    code.indexOf('.command-grid{display:grid'))), 'the disclosure block introduced motion');
});

// ── first screen: one explanation, two named states ───────────────────────
// The mission line and the HUD mission module used to print the same gate
// paragraph the Operator brief already answers, so the same multi-line text
// occupied the left rail, the HUD and the brief at once. They now carry the
// labelled state pair only. The properties that make that safe: the gate and
// the worker stay separately named, the brief keeps the complete sentence, and
// the one explanation the brief does NOT carry — the run lifecycle sentence
// when the two verdicts disagree — stays visible on the mission line.
function missionMetaNode(page) {
  const node = allNodes(page.document.getElementById('founder-body'))
    .find((n) => n.className === 'mission-meta');
  assert.ok(node, 'the mission line lost its status summary');
  return node;
}

function missionMetaText(page) {
  return missionMetaNode(page).textContent;
}

function blockedBuildFixture() {
  const run = {
    runId: 'RUN-FIRST-SCREEN-FAILED', state: 'BUILD_FAILED',
    objective: 'Prove a failed run keeps its recorded reason', updatedAt: '2026-09-03T13:00:00.000Z',
    build: { failure: { code: 'BUILDER_TIMEOUT', summary: 'The builder exceeded its fixed time limit.' } },
  };
  return fixtureState({ runs: { state: 'OK', runs: [run], current: {
    state: 'BOUND', runId: run.runId, updatedAt: run.updatedAt, reason: 'exact current run is bound' } } });
}

function gateUnavailableFixture() {
  const run = {
    runId: 'RUN-FIRST-SCREEN-GATE', state: 'CHECKS_PASSED',
    objective: 'Prove passed checks with unreadable gate evidence', updatedAt: '2026-09-03T13:10:00.000Z',
    checks: { passed: 3, total: 3, outcome: 'PASS' },
  };
  return fixtureState({
    engineering: { state: 'UNAVAILABLE', reason: 'the gate projection could not be read', problems: [] },
    runs: { state: 'OK', runs: [run], current: { state: 'BOUND', runId: run.runId,
      updatedAt: run.updatedAt, subjectState: 'UNAVAILABLE', subjectSha256: null } },
  });
}

test('DOM: the mission line and HUD name the gate and the run lifecycle without repeating the brief paragraph', () => {
  const unknown = bootPage(fixtureState());
  renderMinimizedStatus(unknown, briefUnreadableLedgerStatus());
  const pages = [
    ['a running build', bootPage(briefBuildingFixture())],
    ['passed checks with unreadable gate evidence', bootPage(gateUnavailableFixture())],
    ['a failed build', bootPage(blockedBuildFixture())],
    ['an unreadable run ledger', unknown],
  ];
  for (const [name, page] of pages) {
    const metaNode = missionMetaNode(page);
    const meta = metaNode.textContent;
    const hudNode = page.document.getElementById('hud-mission-state');
    const hud = page.text('hud-mission-state');
    // Both first-screen state lines now read as words. The exact canonical pair
    // did not disappear with the tokens: it moved onto the same nodes as machine
    // attributes, which is what the next block proves.
    const gateCode = metaNode.attrs['data-mission-gate-code'];
    const lifecycleCode = metaNode.attrs['data-mission-lifecycle-code'];
    assert.ok(Object.prototype.hasOwnProperty.call(RUN_STATE_PLAIN, gateCode) &&
      Object.prototype.hasOwnProperty.call(RUN_STATE_PLAIN, lifecycleCode),
    `${name}: the mission line carries no exact gate/lifecycle codes: ${gateCode} / ${lifecycleCode}`);
    assert.strictEqual(metaNode.attrs.title, 'Canonical state codes: gate readiness ' +
      gateCode + ', run lifecycle ' + lifecycleCode,
    `${name}: the exact canonical pair is not reachable from the mission line's plain words`);
    assert.strictEqual(hudNode.attrs['data-hud-code'], gateCode + ' · ' + lifecycleCode,
      `${name}: the HUD mission footer dropped the exact gate and lifecycle codes`);
    assert.strictEqual(hudNode.attrs.title, metaNode.attrs.title,
      `${name}: the HUD mission footer and the mission line disclose different canonical codes`);
    const metaPair = 'Gate readiness: ' + RUN_STATE_PLAIN[gateCode] +
      ' · Run lifecycle: ' + RUN_STATE_PLAIN[lifecycleCode];
    assert.ok(meta.startsWith(metaPair),
      `${name}: the mission line no longer distinguishes the gate from the worker: ${meta}`);
    // The one explanation the brief does not carry — the lifecycle sentence when
    // the two readings disagree — is still the only thing appended here.
    assert.strictEqual(meta.slice(metaPair.length).length > 0, gateCode !== lifecycleCode,
      `${name}: the mission line's lifecycle sentence appears when the two states agree, or is missing when they differ: ${meta}`);
    assert.strictEqual(hud, 'Gate readiness: ' + RUN_STATE_PLAIN[gateCode] +
      ' · Run lifecycle: ' + RUN_STATE_PLAIN[lifecycleCode],
    `${name}: the HUD mission state is not the labelled state pair: ${hud}`);
    // Neither first-screen state line may lead with a machine token again.
    for (const [label, value] of [['mission line', meta.split(' — ')[0]], ['HUD mission footer', hud]]) {
      assert.ok(!/[A-Z]{2,}|_/.test(value),
        `${name}: the ${label} still leads with a machine token: ${value}`);
    }
    // The gate-readiness chip beside the mission line is the same resolution and
    // the same s-STATE colour it always was; it now reads as a word, with its
    // exact canonical code on the chip's own title.
    const missionHead = allNodes(page.document.getElementById('founder-body'))
      .find((n) => String(n.className) === 'mission-head');
    assert.ok(missionHead, `${name}: the mission head was removed`);
    const missionChip = (missionHead.children || [])
      .find((n) => String(n.className).includes('chip'));
    assert.ok(missionChip, `${name}: the mission head lost its gate-readiness chip`);
    assert.ok(String(missionChip.className).includes('s-' + gateCode),
      `${name}: the mission chip lost the canonical state style behind its plain word`);
    assert.strictEqual(missionChip.attrs.title, 'Canonical state code: ' + gateCode,
      `${name}: the mission chip dropped the exact canonical code its plain word replaced`);
    assert.strictEqual(missionChip.children[1].textContent, RUN_STATE_PLAIN[gateCode],
      `${name}: the mission chip still leads with a machine token: ${missionChip.children[1].textContent}`);
    // The core reads the gate in plain English through the same seam, so it and
    // the mission module must still be the SAME resolution.
    assert.strictEqual(page.text('hud-core-status'), RUN_STATE_PLAIN[gateCode],
      `${name}: the HUD mission module reports a different gate reading than the core: ${hud}`);
    assert.ok(!/[A-Z]{2,}|_/.test(page.text('hud-core-status')),
      `${name}: the AEGIS Core still leads with a machine token: ${page.text('hud-core-status')}`);
    // The complete gate sentence stays in the brief, and only there on the
    // first screen — that duplication is what made this screen unreadable.
    const now = briefField(page, 'now').value;
    assert.ok(now.length > 0 && !meta.includes(now) && !hud.includes(now),
      `${name}: the brief's own explanation is still repeated on the mission line or HUD: ${meta} / ${hud}`);
    // Nothing that tells the owner what is wrong or what to do was dropped.
    for (const field of ['next', 'needs-marc']) {
      assert.ok(briefField(page, field).value.length > 0, `${name}: the ${field} answer was emptied`);
    }
    assert.ok(deckCardText(page, 'blocker').length > 0 && deckCardText(page, 'next-step').length > 0,
      `${name}: the blocker or next-step instrument was emptied`);
  }
});

test('DOM: every exact reason survives — the brief keeps the gate sentence, the mission line keeps the lifecycle one', () => {
  // Gate and lifecycle agree: the whole recorded reason, including the missing
  // handoff, is the brief's answer and the mission line stays two state words.
  const failed = bootPage(blockedBuildFixture());
  assert.strictEqual(missionMetaText(failed),
    'Gate readiness: Needs attention · Run lifecycle: Needs attention',
    'a run whose gate and lifecycle agree still carries a duplicated paragraph');
  // The words replaced the tokens on screen; the tokens are still on the node.
  assert.strictEqual(missionMetaNode(failed).attrs['data-mission-gate-code'], 'BLOCKED');
  assert.strictEqual(missionMetaNode(failed).attrs['data-mission-lifecycle-code'], 'BLOCKED');
  assert.strictEqual(briefField(failed, 'now').value,
    'The builder exceeded its fixed time limit. No replacement builder handoff is recorded.',
    'the recorded timeout and handoff evidence was lost with the duplicate text');

  // Gate and lifecycle disagree: the gate refusal is the brief's answer, and
  // the lifecycle sentence the brief does not carry stays on the mission line.
  const gate = bootPage(gateUnavailableFixture());
  assert.strictEqual(missionMetaText(gate),
    'Gate readiness: Not recorded · Run lifecycle: Waiting — Deterministic checks passed with ' +
    'final required evidence; the run is waiting for independent review evidence.',
    'the run lifecycle explanation was dropped instead of de-duplicated');
  assert.strictEqual(missionMetaNode(gate).attrs.title,
    'Canonical state codes: gate readiness UNAVAILABLE, run lifecycle WAITING',
    'the exact canonical pair left the mission line when its wording changed');
  assert.match(briefField(gate, 'needs-marc').value, /Not confirmed — AEGIS cannot yet show/,
    'the fail-closed gate refusal was softened out of the brief');

  const unknown = bootPage(fixtureState());
  renderMinimizedStatus(unknown, briefUnreadableLedgerStatus());
  assert.strictEqual(missionMetaText(unknown),
    'Gate readiness: Not recorded · Run lifecycle: Nothing running — Nothing is currently running.',
    'an unreadable ledger reported something other than the two canonical states');
  assert.strictEqual(missionMetaNode(unknown).attrs.title,
    'Canonical state codes: gate readiness UNAVAILABLE, run lifecycle IDLE',
    'the unreadable-ledger mission line dropped the exact canonical pair');
  assert.match(briefField(unknown, 'needs-marc').value, /could not be read or validated/,
    'the recorded reason the ledger is unusable was withheld from the brief');
});

// ── V2 FOUNDER LANGUAGE — one explanation, not the gate's own vocabulary ────
// Command View used to repeat internal phrasing — "control-plane status is
// unavailable", "the exact-subject gate" — across the mission line, the brief,
// the BLOCKER card and the HUD. The replacement has to do three things at once:
// answer the founder's five questions in plain words, keep every fail-closed
// refusal exactly as strict as it was, and leave the exact technical evidence
// in Detail View. These proofs hold all three, because dropping any one of them
// turns a readable deck into a reassuring one. The pattern below is exactly the
// two phrase families this packet replaced, not a general jargon filter.
const FOUNDER_JARGON = /control[- ]plane|exact-subject/i;

function founderSurfaceText(page) {
  return [
    page.text('founder-body'), page.text('hud-mission-state'), page.text('hud-evidence'),
    page.text('hud-review'), page.text('hud-decisions'), page.text('hud-system-health-meta'),
  ].join(' ');
}

// ── the missing-evidence next step ──────────────────────────────────────────
// The fail-closed fallback used to be "Resolve the recorded blocker before
// continuing", which named neither the absent evidence nor a place to read it.
// These are the four sentences it was replaced with, written out here so a
// silent rewording of any of them fails a proof instead of shipping.
const MISSING_EVIDENCE_READ = ' Use "Show changes and checks" and read ';
const MISSING_EVIDENCE_INERT = ' Viewing evidence starts no check, review or retry.';
const MISSING_EVIDENCE_NEXT = Object.freeze({
  noRun: 'No current run is bound to this page, so there is no recorded code version ' +
    'the blocker can be attributed to.' + MISSING_EVIDENCE_READ +
    '"What is happening now" for the recorded binding reason.' + MISSING_EVIDENCE_INERT,
  mismatched: 'This run is recorded against a different code version than the one being ' +
    'gated now, so its evidence is not coverage of the current change.' + MISSING_EVIDENCE_READ +
    '"Which exact version this is" for both recorded subject hashes.' + MISSING_EVIDENCE_INERT,
  gateUnreadable: 'The gate evidence for this code version could not be read, so the unmet ' +
    'requirements are unknown — not zero.' + MISSING_EVIDENCE_READ +
    '"What the checks recorded" for the last recorded receipt.' + MISSING_EVIDENCE_INERT,
  bindingMissing: 'AEGIS cannot show which exact code version this run was checked against, ' +
    'so nothing here is confirmed.' + MISSING_EVIDENCE_READ +
    '"Which exact version this is" for the recorded binding.' + MISSING_EVIDENCE_INERT,
});

test('DOM: a finished-but-unverified run is explained in founder language, not internal phrasing', () => {
  const gateSubject = 'a'.repeat(64);
  const runSubject = 'b'.repeat(64);
  const run = {
    runId: 'RUN-FOUNDER-LANGUAGE', state: 'CHECKPOINTED',
    objective: 'Explain a finished run whose integrated version is still unverified',
    updatedAt: '2026-09-03T10:00:00.000Z',
    checkpoint: 'CP-FOUNDER', rollbackPoint: 'c'.repeat(40),
  };
  const page = bootPage(fixtureState({
    engineering: Object.assign({}, fixtureState().engineering, {
      state: 'OK', verdict: 'BLOCKED', subjectSha256: gateSubject, problems: [],
    }),
    runs: { state: 'OK', runs: [run], current: {
      state: 'BOUND', runId: run.runId, updatedAt: run.updatedAt,
      subjectState: 'MISMATCHED', subjectSha256: null,
      runSubjectSha256: runSubject, gateSubjectSha256: gateSubject,
      reason: 'the run and gate subjects differ',
    } },
  }));

  // What finished and why it is still not verified are both stated, and both
  // are true at the same time. Saying only one of them is how a checkpoint
  // receipt starts reading as completion.
  assert.strictEqual(briefField(page, 'finished').value,
    'This run finished and reached its recorded safe checkpoint.',
    'the deck cannot say plainly what actually finished');
  assert.strictEqual(briefField(page, 'verify').value,
    'This run was checked against an older code version than the one in the build ' +
    'right now, so it is not confirmed finished.',
    'the deck cannot explain why the integrated version still requires verification');

  // The refusal itself is unchanged.
  assert.strictEqual(page.text('hud-core-status'), RUN_STATE_PLAIN.BLOCKED,
    'founder language softened a blocked control state into a finished one');
  assert.match(briefField(page, 'needs-marc').value, /older code version/,
    'Attention dropped the real blocker');
  assert.doesNotMatch(briefField(page, 'needs-marc').value,
    /No blocker is currently recorded/,
    'a real blocker was reported as needing nothing from the owner');
  assert.strictEqual(briefField(page, 'next').value, MISSING_EVIDENCE_NEXT.mismatched,
    'the next valid action is not stated in founder language');

  assert.doesNotMatch(founderSurfaceText(page), FOUNDER_JARGON,
    `Command View still repeats the internal phrases this packet replaced: ${founderSurfaceText(page)}`);

  // Detail View still carries the exact evidence the founder wording
  // summarises. The plain words are a reading order, never a deletion.
  assert.strictEqual(page.text('ctx-subject'), 'subject ' + 'a'.repeat(12) + '…',
    'Detail View lost the exact subject identity behind the founder wording');
  assert.match(page.text('founder-body'), /Checkpoint CP-FOUNDER · rollback commit c{40}/,
    'the recorded checkpoint receipt was dropped');
});

test('DOM: a still-building run says nothing finished and nothing is verified yet', () => {
  const page = bootPage(briefBuildingFixture());
  assert.strictEqual(briefField(page, 'finished').value,
    'Nothing has finished yet — the assigned worker is still building this change.',
    'an in-flight build was reported as finished work');
  assert.strictEqual(briefField(page, 'verify').value,
    'Nothing has been verified yet — the automated checks for this code version have not run.',
    'an in-flight build claimed verification that has not happened');
  assert.doesNotMatch(founderSurfaceText(page), FOUNDER_JARGON,
    `Command View still repeats the internal phrases this packet replaced: ${founderSurfaceText(page)}`);
});

test('DOM: unavailable gate evidence refuses to call the work finished, in plain words', () => {
  const run = {
    runId: 'RUN-FOUNDER-UNAVAILABLE', state: 'CHECKS_PASSED',
    objective: 'Refuse to claim completion without available gate evidence',
    updatedAt: '2026-09-03T11:00:00.000Z',
    checks: { passed: 3, total: 3, outcome: 'PASS' },
  };
  const page = bootPage(fixtureState({
    engineering: { state: 'UNAVAILABLE', reason: 'the gate projection could not be read', problems: [] },
    runs: { state: 'OK', runs: [run], current: {
      state: 'BOUND', runId: run.runId, updatedAt: run.updatedAt,
      subjectState: 'UNAVAILABLE', subjectSha256: null, reason: 'subject binding unavailable',
    } },
  }));
  assert.strictEqual(briefField(page, 'finished').value,
    'The build finished and its automated checks passed.',
    'the deck hid the work that genuinely finished');
  assert.strictEqual(briefField(page, 'verify').value,
    'AEGIS cannot yet show that this work was checked against the combined code as ' +
    'it stands right now, so it is not confirmed finished.',
    'unavailable gate evidence was not explained as an unverified integrated version');
  assert.match(briefField(page, 'needs-marc').value, /Not confirmed — AEGIS cannot yet show/,
    'the fail-closed refusal was softened out of Attention');
  assert.doesNotMatch(founderSurfaceText(page), FOUNDER_JARGON,
    `Command View still repeats the internal phrases this packet replaced: ${founderSurfaceText(page)}`);
});

test('the founder explanation has exactly one source, so no two surfaces can phrase it differently', () => {
  assert.ok(/var FOUNDER = \{/.test(code), 'the single founder-language source is gone');
  assert.strictEqual((code.match(/var FOUNDER = \{/g) || []).length, 1,
    'a second founder-language source would drift from the first');
  assert.ok(/founder: FOUNDER/.test(code),
    'the run-card renderer cannot reach the same founder sentences the deck reads');
  for (const key of ['STATUS_UNCONFIRMED', 'REVIEW_FAILED_UNCONFIRMED',
    'HOST_PENDING', 'RETRY_UNCONFIRMED']) {
    assert.ok(new RegExp('(FOUNDER|D\\.founder)\\.' + key).test(code),
      `${key} is defined but never used, so some surface still carries its own wording`);
  }
});

// ── V2 MISSING EVIDENCE — say what is missing and where it is readable ──────
// A fail-closed control verdict with no auth failure, no valid retry and no
// named reviewer action used to print one sentence: "Resolve the recorded
// blocker before continuing." The owner could not tell whether the run, the
// code-version link or the gate projection was the absent piece, and was given
// nowhere to look. The replacement names the absent evidence and the shipped
// panel that records it. It stays a presentation mapping: it invents no gate,
// turns nothing green, and the route it names is read-only.
function missingEvidencePage(engineeringOver, run, currentOver) {
  return bootPage(fixtureState({
    engineering: Object.assign({}, fixtureState().engineering, engineeringOver || {}),
    runs: { state: 'OK', runs: [run], current: Object.assign(
      { state: 'BOUND', runId: run.runId, updatedAt: run.updatedAt }, currentOver || {}) },
  }));
}

function missingEvidenceRun(over) {
  return Object.assign({ runId: 'RUN-MISSING-EVIDENCE', state: 'CHECKS_PASSED',
    objective: 'Explain which evidence is missing', updatedAt: '2026-09-03T12:00:00.000Z' }, over || {});
}

test('DOM: an unreadable run ledger names the absent run and a read-only route to its record', () => {
  const page = bootPage(fixtureState());
  renderMinimizedStatus(page, briefUnreadableLedgerStatus());
  assert.strictEqual(briefField(page, 'next').value, MISSING_EVIDENCE_NEXT.noRun,
    'a missing current run was still reported as an unexplained recorded blocker');
});

test('DOM: an absent code-version link says so and points at the version panel', () => {
  const page = missingEvidencePage(null, missingEvidenceRun(),
    { subjectState: 'MISSING', subjectSha256: null, reason: 'no subject is bound to this run' });
  assert.strictEqual(briefField(page, 'next').value, MISSING_EVIDENCE_NEXT.bindingMissing,
    'a missing code-version binding was not explained to the owner');
});

test('DOM: an unavailable engineering projection reports unknown requirements, never zero', () => {
  const page = missingEvidencePage({ state: 'UNAVAILABLE', reason: 'the gate projection could not be read' },
    missingEvidenceRun({ runId: 'RUN-GATE-UNREADABLE' }),
    { subjectState: 'UNAVAILABLE', subjectSha256: null });
  assert.strictEqual(briefField(page, 'next').value, MISSING_EVIDENCE_NEXT.gateUnreadable,
    'unreadable gate evidence was not distinguished from a met requirement list');
  assert.doesNotMatch(briefField(page, 'next').value, /passed|approved|complete/i,
    'absent gate evidence was phrased as a passing or completed state');
});

test('DOM: Command and Detail read the SAME missing-evidence sentence, from one resolution', () => {
  const page = missingEvidencePage(null, missingEvidenceRun({ runId: 'RUN-ONE-RESOLUTION' }),
    { subjectState: 'MISSING', subjectSha256: null });
  assert.strictEqual(briefField(page, 'next').value, deckCardText(page, 'next-step'),
    'the brief and the NEXT STEP card reached two readings of one missing-evidence state');
  assert.ok(evidencePanelsById(page).action.textContent.includes(
    'Next governed action: ' + MISSING_EVIDENCE_NEXT.bindingMissing),
  'Detail View did not restate the deck\'s own missing-evidence resolution');
  // The route is an inspection route. Naming it must not make an unproven
  // binding look proven anywhere the deck reports version state.
  assert.strictEqual(evidencePanelsById(page).subject.attrs['data-evidence-state'],
    'BINDING_UNAVAILABLE',
    'the missing-evidence route reported an unbound code version as bound');
  assert.doesNotMatch(founderSurfaceText(page), FOUNDER_JARGON,
    `the missing-evidence sentences reintroduced internal phrasing: ${founderSurfaceText(page)}`);
});

test('DOM: auth, retry, named-reviewer and running-builder guidance still outrank the missing-evidence route', () => {
  const cases = [
    ['re-authentication', missingEvidencePage(null, missingEvidenceRun({
      runId: 'RUN-AUTH', state: 'BUILD_FAILED',
      build: { failure: { code: 'MODEL_AUTH_FAILURE', summary: 'The builder could not authenticate.' } },
    }), { subjectState: 'MISSING', subjectSha256: null }),
    /^Re-authenticate Claude before continuing\./],
    ['a refused retry', missingEvidencePage(null, missingEvidenceRun({
      runId: 'RUN-RETRY-LIMIT', state: 'CHECKS_FAILED', corrections: 2, maxCorrections: 2,
    }), { subjectState: 'MISSING', subjectSha256: null }),
    /^All 2 bounded correction cycle\(s\) are already used/],
    ['an available retry', missingEvidencePage(null, missingEvidenceRun({
      runId: 'RUN-RETRY-OK', state: 'BUILD_FAILED',
    }), { subjectState: 'MISSING', subjectSha256: null }),
    /^Retry this failed run through its bounded recovery route\./],
    ['a named missing reviewer', missingEvidencePage({
      reviewerCompleteness: { complete: false, rows: [
        { reviewer: 'grok', required: 'REQUIRED', executed: 'NOT_EXECUTED', missingPaths: [] }] },
    }, missingEvidenceRun({ runId: 'RUN-NAMED-REVIEWER' }),
    { subjectState: 'MISSING', subjectSha256: null }),
    /^Get grok to review this exact change\./],
    ['a running builder', bootPage(briefBuildingFixture()),
      /^Wait for the governed builder to finish this change\./],
  ];
  for (const [name, page, expected] of cases) {
    const next = briefField(page, 'next').value;
    assert.match(next, expected, `${name} lost precedence to the missing-evidence route: ${next}`);
    assert.doesNotMatch(next, /Show changes and checks/,
      `${name} was replaced by the missing-evidence route instead of keeping precedence`);
  }
});

// ── V2 reduced motion and keyboard presentation (PKT-20260826-ASYNC-WORKER-OPERATOR-BETA) ─
// Four presentation gaps, all of them on both Command View and Detail View:
//
//   1. The reduced-motion state was simply ABSENT until the control was first
//      pressed, and the control never read the device's own setting — so on a
//      machine that asks for reduced motion the page said "Reduced motion" with
//      aria-pressed="false" while the media query was suppressing every
//      transition. The control was describing a state nobody had resolved.
//   2. <summary> and <a> are keyboard controls with no focus treatment in this
//      palette, and the disclosures are the only route to demoted evidence in
//      Command View and to the deep machine state in Detail View.
//   3. The view switch moved the scroll position and left the keyboard on the
//      tab that was pressed, and said nothing to a screen reader.
//   4. An inert control explained itself only through a hover tooltip.
//
// None of this touches lifecycle, routing, ledger, review, checkpoint, cost or
// run-selection authority, and none of it may introduce motion: the fix for a
// reduced-motion gap can never be something new to reduce.

test('the reduced-motion state is resolved from the first byte, never an absent third state', () => {
  assert.ok(/<body[^>]*\sdata-reduced-motion="false"/.test(htmlSrc()),
    'the page ships with no reduced-motion state at all, so the control describes nothing until it is pressed');
  assert.ok(/body\[data-reduced-motion="true"\] \*\{transition:none!important;animation:none!important;scroll-behavior:auto!important\}/.test(code),
    'the operator control no longer suppresses animations, transitions and smooth scrolling');
  // A pseudo-element runs its own animation, so the wildcard above cannot reach
  // the core evidence cue, which is drawn on ::after. Without this the control
  // would report a suppression it does not actually apply.
  assert.ok(/body\[data-reduced-motion="true"\] \*::before,body\[data-reduced-motion="true"\] \*::after\{transition:none!important;animation:none!important\}/.test(code),
    'the operator control does not reach pseudo-element motion, so the AEGIS Core cue would keep running under reduced motion');
  // "off" owns no rules of its own. Giving it any would mean the page had
  // something to switch back on beyond the one evidence-bound cue.
  assert.ok(!/body\[data-reduced-motion="false"\]/.test(code),
    'the unreduced state was given rules of its own, which is a page inventing motion in order to remove it');
});

test('the device setting and the on-page control apply exactly the same suppression', () => {
  const media = code.slice(code.indexOf('@media (prefers-reduced-motion: reduce)'));
  const block = media.slice(0, media.indexOf('\n  }'));
  assert.ok(block.length > 0, 'the reduced-motion media block was not located');
  for (const declaration of ['transition:none!important', 'animation:none!important',
    'scroll-behavior:auto!important']) {
    assert.ok(block.includes(declaration),
      `the device setting does not apply ${declaration}, so it and the control leave the page in two different states`);
  }
  // Pseudo-element coverage on both sides, or the device setting and the control
  // would suppress two different amounts of the same page.
  assert.ok(/\*::before,\*::after\{transition:none!important;animation:none!important\}/.test(block),
    'the device setting does not reach pseudo-element motion, so the AEGIS Core cue would survive it');
  // animation:none is suppression; a keyframes block or any animation value
  // other than none would be this block inventing the motion it exists to remove.
  assert.ok(!/@keyframes/.test(block) && !/animation\s*:\s*(?!none)/.test(block),
    'the reduced-motion block introduced motion, which is the one thing it may never do');
});

test('every keyboard-operable control carries a visible focus ring, disclosures included', () => {
  const focusable = new Set();
  for (const rule of code.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/outline:2px solid var\(--focus\)/.test(rule[2])) continue;
    for (const selector of rule[1].split(',')) focusable.add(selector.trim());
  }
  for (const selector of ['.stage:focus-visible', '.route-node:focus-visible', '.view-tab:focus-visible',
    '.hud-control:focus-visible', 'button.action:focus-visible', 'summary:focus-visible',
    'a:focus-visible', '[tabindex="-1"]:focus']) {
    assert.ok(focusable.has(selector), `${selector} can be reached by keyboard with no visible focus`);
  }
  // Drawn outside the control, so it is a shape rather than a colour change
  // inside it — except on the full-width landing regions, where an outward ring
  // is exactly what would widen the page at 390px.
  assert.ok(/\[tabindex="-1"\]:focus\{outline:2px solid var\(--focus\);outline-offset:-2px\}/.test(code),
    'a full-width landing region draws its focus ring outside itself, which can push a 390px viewport sideways');
});

test('the reduced-motion state line wraps instead of widening the header at any width', () => {
  assert.ok(/\.header-state\{display:flex;[^}]*flex-wrap:wrap/.test(code),
    'the header band cannot wrap, so one extra line of text overflows an ordinary laptop width');
  assert.ok(/\.motion-state\{[^}]*overflow-wrap:anywhere/.test(code),
    'the reduced-motion state sentence can push the viewport sideways');
  assert.ok(/\.header-state \.motion-state\{order:4;flex:1 0 100%/.test(PHONE),
    'the reduced-motion state sentence competes with the brand for one phone row');
  assert.ok(!/motion-state\{[^}]*display:none/.test(PHONE),
    'the phone cockpit removed the reduced-motion state instead of reflowing it');
});

test('an unavailable control is inert by shape and explains itself without a tooltip', () => {
  assert.ok(/\.hud-control:disabled,\.hud-control\[aria-disabled="true"\]\{border-style:dashed;cursor:not-allowed\}/.test(code),
    'an inert control is drawn exactly like an operable one, or is told apart by colour alone');
  const flat = /<button type="button" class="hud-control" disabled[^>]*>([\s\S]*?)<\/button>/.exec(htmlSrc());
  assert.ok(flat, 'the inert Flat 2D control was removed rather than explained');
  assert.ok(/class="sr"[^>]*>\s*—\s*unavailable/.test(flat[1]),
    'an inert control is explained only by a hover tooltip a keyboard or touch operator never opens');
});

test('DOM: the reduced-motion control reports the device setting instead of claiming "off"', () => {
  const asksForReduce = (query) => ({ matches: /prefers-reduced-motion/.test(query) });
  const held = bootPage(fixtureState(), { matchMedia: asksForReduce });
  const toggle = held.document.getElementById('toggle-motion');
  assert.strictEqual(held.document.body.getAttribute('data-reduced-motion'), 'true',
    'a device that asks for reduced motion booted the page in the unreduced state');
  assert.strictEqual(toggle.getAttribute('aria-pressed'), 'true',
    'the control reported "off" while the stylesheet was already suppressing every transition');
  assert.strictEqual(toggle.textContent, 'Reduced motion: on',
    `the control state is not readable in words: ${toggle.textContent}`);
  assert.strictEqual(toggle.getAttribute('aria-disabled'), 'true',
    'a control the media query outranks was still presented as switchable');
  assert.match(held.text('motion-state'), /Reduced motion ON · device setting/,
    `where the state came from is not stated: ${held.text('motion-state')}`);
  // A media query cannot be outranked by an attribute on <body>, so pressing
  // the control may not print a state the stylesheet contradicts.
  toggle._listeners.click[0]();
  assert.strictEqual(held.document.body.getAttribute('data-reduced-motion'), 'true',
    'the control switched off a suppression the device setting still applies');
  assert.strictEqual(toggle.getAttribute('aria-pressed'), 'true',
    'the control reported an unreduced page the media query contradicts');

  const plain = bootPage(fixtureState());
  const plainToggle = plain.document.getElementById('toggle-motion');
  assert.strictEqual(plain.document.body.getAttribute('data-reduced-motion'), 'false',
    'a device with no preference did not resolve to the shipped default');
  assert.strictEqual(plainToggle.textContent, 'Reduced motion: off',
    `the control state is not readable in words: ${plainToggle.textContent}`);
  assert.strictEqual(plainToggle.getAttribute('aria-disabled'), 'false',
    'the control is inert on a device that has asked for nothing');
  assert.match(plain.text('motion-state'), /Reduced motion OFF · no device setting/,
    `the resolved state and its source are not stated: ${plain.text('motion-state')}`);
  plainToggle._listeners.click[0]();
  assert.strictEqual(plain.document.body.getAttribute('data-reduced-motion'), 'true',
    'the operator could not set reduced motion on a device with no preference of its own');
  assert.strictEqual(plainToggle.getAttribute('aria-pressed'), 'true');
  assert.match(plain.text('motion-state'), /Reduced motion ON · set here/,
    `an operator-set state is not distinguished from a device setting: ${plain.text('motion-state')}`);
  plainToggle._listeners.click[0]();
  assert.strictEqual(plain.document.body.getAttribute('data-reduced-motion'), 'false',
    'the operator control is one-way and cannot be released again');
});

test('DOM: the Command and Detail switch moves the keyboard, not only the scroll position', () => {
  const page = bootPage(fixtureState());
  const command = page.document.getElementById('view-command');
  const detail = page.document.getElementById('view-detail');
  const focused = [];
  page.document.getElementById('evidence-rail').focus = () => focused.push('evidence-rail');
  page.document.getElementById('operator-shell').focus = () => focused.push('operator-shell');

  detail._listeners.click[0]();
  assert.deepStrictEqual(focused, ['evidence-rail'],
    'Detail view scrolled the page and left the keyboard on the tab that was pressed');
  assert.match(page.text('live'), /Detail view\./,
    'switching to Detail view is silent to a screen reader');

  command._listeners.click[0]();
  assert.deepStrictEqual(focused, ['evidence-rail', 'operator-shell'],
    'Command view did not return the keyboard to the command deck');
  assert.match(page.text('live'), /Command view\./,
    'returning to Command view is silent to a screen reader');

  // A landing region has to be able to hold focus at all, or the ring above
  // never appears and the switch is scroll-only again.
  const source = htmlSrc();
  assert.ok(/<main class="command-shell" id="operator-shell"[^>]*tabindex="-1"/.test(source),
    'the command deck cannot receive focus from the view switch or the skip link');
  assert.ok(/<section id="evidence-rail"[^>]*tabindex="-1"/.test(source),
    'the Detail View evidence rail cannot receive focus from the view switch');
  assert.ok(/<a class="sr" href="#operator-shell">/.test(source),
    'the first keyboard target still skips into a collapsed engineer disclosure rather than the command deck');
});

// ── "Show changes and checks": the signposted way into the receipts ────────
// The defect these proofs guard is a founder who can see that something is
// blocked and cannot find what says why: the rail exists, but the only door to
// it is labelled with a disclosure level rather than with what is behind it.
//
// The defect the FIX could introduce is worse than the one it removes. A jump
// that keeps its own copy of the receipts would be a second evidence surface
// that can disagree with the rail; a jump that touches a build, gate, review or
// checkpoint route on the way would make reading the evidence an action; and a
// "return" that leaves the keyboard inside a region Command View has just
// hidden would strand the operator who used it. So every proof below holds the
// same shape: the control is real, reachable and named in words; it only
// discloses; the surface it opens is the one canonical rail, repainted from
// current state and still saying UNAVAILABLE where evidence is missing; and the
// way back lands somewhere an operator can carry on from.

// Boot the page with the evidence-navigation seams instrumented: every request
// the page makes, and every scroll and focus move on the four elements this
// navigation is allowed to touch. The spies are installed after boot, so what
// they record is what the control did, never what loading the page did.
function evidenceJumpPage(state, opts) {
  const calls = [];
  const settings = opts || {};
  const page = bootPage(state, Object.assign({}, settings, {
    fetch: async (url, init) => {
      calls.push({ url, init });
      return { ok: true, json: async () => settings.status || {} };
    },
  }));
  const focused = [];
  const scrolled = [];
  for (const id of ['evidence-rail', 'evidence-rail-h', 'operator-shell', 'btn-show-evidence']) {
    const node = page.document.getElementById(id);
    node.focus = () => focused.push(id);
    node.scrollIntoView = () => scrolled.push(id);
  }
  return { page, calls, focused, scrolled };
}

test('DOM: the Command View evidence jump discloses the rail, lands on its heading and reaches no API', () => {
  const source = htmlSrc();
  const shellStart = source.indexOf('<main class="command-shell" id="operator-shell"');
  const railStart = source.indexOf('<section id="evidence-rail"');
  const jumpAt = source.indexOf('id="btn-show-evidence"');
  assert.ok(shellStart !== -1 && railStart > shellStart, 'the command shell or the evidence rail moved');
  assert.ok(jumpAt > shellStart && jumpAt < railStart,
    'the Show changes and checks control is not on the Command View first screen');
  assert.ok(/<button type="button" class="action" id="btn-show-evidence"[\s\S]{0,160}>Show changes and checks<\/button>/.test(source),
    'the way into the receipts is not a real button with a plain-English name');
  assert.ok(/id="btn-show-evidence"[\s\S]{0,160}aria-describedby="evidence-jump-note"/.test(source) &&
    /id="evidence-jump-note"/.test(source),
    'the jump never says in words what it opens or that it changes nothing');

  const { page, calls, focused, scrolled } = evidenceJumpPage(fixtureState());
  const button = page.document.getElementById('btn-show-evidence');
  assert.strictEqual((button._listeners.click || []).length, 1,
    'the Show changes and checks control has no executable click handler');
  const before = calls.length;
  button._listeners.click[0]();

  assert.strictEqual(page.document.body.getAttribute('data-detail'), 'true',
    'the jump did not enter Detail view, so the rail it points at stays hidden');
  assert.strictEqual(page.document.getElementById('view-detail').getAttribute('aria-pressed'), 'true',
    'the view switch does not report the view the jump actually put the operator in');
  assert.strictEqual(page.document.getElementById('view-command').getAttribute('aria-pressed'), 'false',
    'Command view still reports itself as selected after the jump left it');
  assert.strictEqual(page.document.getElementById('raw-state').open, true,
    'the jump used a disclosure state of its own instead of the one the view switch owns');
  assert.deepStrictEqual(scrolled, ['evidence-rail'],
    'the jump did not bring the evidence rail into view');
  assert.deepStrictEqual(focused, ['evidence-rail-h'],
    'the jump moved the page and left the keyboard on the button rather than on the rail heading');
  assert.match(page.text('live'), /Detail view\./, 'the jump is silent to a screen reader');
  // Reading the evidence is not an action: no build, run, gate, review,
  // checkpoint or connector route may be touched by looking at it.
  assert.strictEqual(calls.length, before,
    `the evidence jump issued a request: ${JSON.stringify(calls.slice(before))}`);
  assert.ok(/<section id="evidence-rail"[^>]*tabindex="-1"/.test(source) &&
    /<h2 id="evidence-rail-h" tabindex="-1"/.test(source),
    'the rail heading cannot hold the focus the jump gives it, so the ring never appears');
});

test('DOM: Return to Command restores the command-first view and the keyboard position the jump left', () => {
  const source = htmlSrc();
  assert.ok(/<button type="button" class="action" id="btn-return-command"[\s\S]{0,160}>Return to Command view<\/button>/.test(source),
    'the evidence rail offers no way back to Command view');
  const railStart = source.indexOf('<section id="evidence-rail"');
  const railBody = source.indexOf('id="evidence-rail-body"');
  const backAt = source.indexOf('id="btn-return-command"');
  assert.ok(backAt > railStart && backAt < railBody,
    'the way back is not a static part of the rail above the receipts the renderer repaints');

  const { page, calls, focused } = evidenceJumpPage(fixtureState());
  page.document.getElementById('btn-show-evidence')._listeners.click[0]();
  const back = page.document.getElementById('btn-return-command');
  assert.strictEqual((back._listeners.click || []).length, 1, 'the way back has no executable click handler');
  const before = calls.length;
  focused.length = 0;
  back._listeners.click[0]();

  assert.strictEqual(page.document.body.getAttribute('data-detail'), 'false',
    'Return to Command did not restore the command-first disclosure state');
  assert.strictEqual(page.document.getElementById('view-command').getAttribute('aria-pressed'), 'true',
    'the view switch does not report the view the way back put the operator in');
  assert.strictEqual(page.document.getElementById('raw-state').open, false,
    'Return to Command left the deep machine state disclosed behind the rail it closed');
  assert.deepStrictEqual(focused, ['btn-show-evidence'],
    'Return to Command stranded the keyboard in the region Command view has just hidden');
  assert.match(page.text('live'), /Command view\./, 'the way back is silent to a screen reader');
  assert.strictEqual(calls.length, before,
    `the way back issued a request: ${JSON.stringify(calls.slice(before))}`);

  // Reached by the view switch instead of by the jump there is no origin to
  // restore, so the way back returns to the command deck rather than nowhere.
  const other = evidenceJumpPage(fixtureState());
  other.page.document.getElementById('view-detail')._listeners.click[0]();
  other.focused.length = 0;
  other.page.document.getElementById('btn-return-command')._listeners.click[0]();
  assert.deepStrictEqual(other.focused, ['operator-shell'],
    'a rail opened from the view switch has no sensible way back to the command deck');
});

test('DOM: the rail the jump opens is repainted from current canonical state and keeps absent evidence absent', () => {
  const { page } = evidenceJumpPage(fixtureState());
  page.document.getElementById('btn-show-evidence')._listeners.click[0]();
  const unbound = evidencePanelsById(page);
  assert.deepStrictEqual(Object.keys(unbound).sort(), [...DETAIL_PANEL_ORDER].sort(),
    'the jump opened a rail that is missing a receipt');
  assert.strictEqual(unbound.subject.attrs['data-evidence-state'], 'BINDING_UNAVAILABLE',
    'an unproven code-version binding read as proven on the surface the jump advertises');
  assert.strictEqual(unbound.checks.attrs['data-evidence-state'], 'UNAVAILABLE');
  assert.match(unbound.action.textContent, /Bound run: UNAVAILABLE/,
    'the jump invented a bound run to have something to show');

  // The same page, one canonical push later. The receipts have to be the new
  // ones: a jump that kept what it read when it was pressed would be a second
  // evidence surface that can disagree with the rail.
  const subject = 'd'.repeat(64);
  renderMinimizedStatus(page, {
    generatedAt: '2026-09-03T12:00:00.000Z', runsState: 'OK',
    engineering: {
      state: 'OK', verdict: 'BLOCKED', subjectSha256: subject,
      subjectPaths: ['builder-control/dashboard/index.html', 'builder-control/test/dashboard-slice.test.cjs'],
      problems: [], reviewerCompleteness: null, stages: [],
    },
    runs: [{
      runId: 'RUN-JUMP', state: 'CHECKS_PASSED', objective: 'Open the receipts from Command view',
      updatedAt: '2026-09-03T12:00:00.000Z',
      checks: { passed: 5, total: 5, outcome: 'PASS', snapshotOutcome: 'PASS' },
      checkpoint: null, rollbackPoint: null, checkpointState: 'ABSENT',
    }],
    runsBinding: { state: 'BOUND', runId: 'RUN-JUMP', updatedAt: '2026-09-03T12:00:00.000Z',
      subjectState: 'UNLINKED', gateSubjectSha256: subject, reason: 'bound to current run' },
    integration: { connectors: { state: 'OK', connectors: [] } }, reviewers: [], events: [],
    cost: { state: 'UNAVAILABLE', reason: 'no transcripts' },
    knowledge: { state: 'UNKNOWN', conflicts: null },
  });
  const bound = evidencePanelsById(page);
  assert.match(bound.action.textContent, /Bound run: RUN-JUMP/,
    'the rail held the reading it had when the jump was pressed instead of repainting from canonical state');
  assert.match(evidencePanelValue(bound.paths), /2 exact changed path\(s\)/,
    'the changed-path receipt did not repaint from the current gate subject');
  assert.match(bound.paths.textContent, /builder-control\/test\/dashboard-slice\.test\.cjs/,
    'the exact changed paths were summarised away rather than listed');
  assert.match(bound.checks.textContent, /5\/5 checks passed/,
    'the recorded check receipt did not repaint');

  // A repaint is not permission to fill in what is still missing. The subject
  // is UNLINKED, no cost was projected and no checkpoint was recorded, and all
  // three have to keep saying so on the surface the jump advertises.
  assert.strictEqual(bound.subject.attrs['data-evidence-state'], 'BINDING_UNAVAILABLE',
    'an unlinked subject was upgraded to an exact binding by a repaint');
  assert.match(evidencePanelValue(bound.cost), /CAD UNAVAILABLE/,
    'a repainted rail invented a cost figure');
  assert.strictEqual(evidencePanelValue(bound.checkpoint), 'No safe checkpoint is recorded for this run.',
    'a repainted rail invented a saved checkpoint');
  assert.ok(!/CAD 0|\$0|0 checks passed/i.test(page.text('evidence-rail-body')),
    'an absent figure was back-filled as a zero');
  assert.strictEqual(page.document.body.getAttribute('data-detail'), 'true',
    'a canonical repaint closed the rail the operator had opened');
});

test('the evidence rail heads every receipt in plain English and the navigation adds no second truth source', () => {
  const page = bootPage(fixtureState());
  const headings = evidencePanels(page).map((panel) => {
    const h3 = allNodes(panel).find((node) => node.tagName === 'H3');
    assert.ok(h3, `evidence panel ${panel.attrs['data-evidence-panel']} rendered no heading`);
    return h3.textContent;
  });
  assert.deepStrictEqual(headings, [
    'What is happening now',
    'Which exact version this is',
    'What changed',
    'What the checks recorded',
    'What review covers',
    'What it cost (CAD)',
    'Where the safe point is',
  ], 'the evidence rail stopped heading its receipts with the question each one answers');

  // One rail, one renderer, one writer. The navigation may reveal the rail and
  // move the keyboard; it may not paint, cache or re-derive anything in it.
  assert.strictEqual((code.match(/function renderEvidenceRail\(/g) || []).length, 1,
    'a second evidence rail renderer appeared beside the canonical one');
  assert.strictEqual((code.match(/\$\('evidence-rail-body'\)/g) || []).length, 1,
    'a second writer reaches into the evidence rail body');
  const jumpStart = code.indexOf("var showEvidence = $('btn-show-evidence')");
  assert.ok(jumpStart !== -1, 'the evidence navigation wiring was not found');
  const jumpCode = code.slice(jumpStart, code.indexOf('── reduced motion', jumpStart))
    .replace(/^\s*\/\/.*$/gm, '');
  assert.ok(jumpCode.trim().length > 0, 'the evidence navigation wiring is empty');
  assert.ok(!/callApi|fetch\(|\/api\//.test(jumpCode),
    'the evidence navigation reaches a route rather than only disclosing what is already on the page');
  assert.ok(!/renderEvidenceRail|evidence-rail-body|AEGIS_STATE|textContent\s*=/.test(jumpCode),
    'the evidence navigation writes or re-derives evidence of its own');
  assert.ok(/setDetailView\(true, 'evidence-rail-h'\)/.test(jumpCode),
    'the jump does not reuse the one disclosure switch to land on the rail heading');
  // The landing, not only the jump. The command header is sticky from 681px up,
  // so a rail scrolled to block:"start" puts its heading and the way back out
  // underneath the header unless the header's own band is reserved on the scroll
  // container. Every reserved band has to clear the header at its wrapped desktop
  // height — 72px min-height plus 12px of padding top and bottom — or the
  // operator arrives on chrome instead of on the receipts.
  const landingBands = [...code.matchAll(/scroll-padding-top:(\d+)px/g)].map(m => Number(m[1]));
  assert.ok(landingBands.length > 0 && landingBands.every(px => px >= 96),
    'the evidence landing does not clear the sticky header: ' + JSON.stringify(landingBands));
});

test('the evidence navigation stays usable on a 390px phone, by keyboard, with reduced motion', () => {
  // Wrapping, not widening: the explanatory line beside each control is the
  // longest thing in either row, and a row that refuses to wrap it is a
  // horizontal scrollbar on the narrowest phone this deck supports.
  assert.ok(/\.evidence-jump\{[^}]*display:flex[^}]*flex-wrap:wrap/.test(code),
    'the evidence navigation rows do not wrap');
  assert.ok(/\.evidence-jump>\.rail-note\{[^}]*min-width:0[^}]*overflow-wrap:anywhere/.test(code),
    'the sentence beside the evidence controls can widen the page instead of wrapping');
  assert.ok(!/\.evidence-jump[^{}]*\{[^}]*(?:overflow-x|overflow:|white-space:nowrap|position:fixed)/.test(code),
    'the evidence navigation clips or pins itself instead of wrapping');
  // Finger-sized on a phone, through the shipped hit-target rule rather than a
  // second one of its own.
  const phone = code.slice(code.indexOf('@media (max-width:680px)'));
  assert.ok(/button\.action,[\s\S]{0,300}?\{min-height:44px\}/.test(phone),
    'the evidence navigation buttons fall below the shipped phone hit-target floor');
  // Nothing here may animate, so the reduced-motion control still has nothing
  // on this page to suppress and a smooth scroll cannot outlive it.
  assert.ok(!/scrollIntoView\([^)]*behavior/.test(code),
    'the evidence navigation asks for animated scrolling');
  assert.ok(!/\.evidence-jump[^{}]*\{[^}]*(?:transition|animation)\s*:/.test(code),
    'the evidence navigation introduced motion of its own');
});

// ── V2 failure-state storyboard (PKT-20260826-ASYNC-WORKER-OPERATOR-BETA) ──
// Three failures read identically on a status page and need completely
// different responses: work that stopped moving, a provider that could not do
// the work, and a change that keeps coming back from review. The defect these
// proofs guard is the deck answering all three with one grey "blocked", and the
// defect the FIX could introduce is worse: a storyboard that decides which of
// the three it is from atmosphere rather than from the run record — calling a
// single correction a cycle, calling an attempt with no progress yet a stall,
// or filing an unexplained failure under the most plausible story.
//
// So every proof below holds the same shape: the state is named only when a
// canonical field proves it, the last recorded evidence is shown, exactly one
// next governed action is shown, and that action is the deck's own — never a
// second recovery opinion. Absence of evidence is UNAVAILABLE, and nothing
// about a failed or stalled run may move.
const STORYBOARD_START = code.indexOf('function failureStoryboard(');
const STORYBOARD = STORYBOARD_START === -1 ? ''
  : code.slice(STORYBOARD_START, code.indexOf('// ── Detail View evidence inspector', STORYBOARD_START));

function failureFixture(run) {
  return fixtureState({
    generatedAt: '2026-09-03T12:00:00.000Z',
    runs: { state: 'OK', runs: [run], current: {
      state: 'BOUND', runId: run.runId, updatedAt: run.updatedAt,
      evidenceState: 'OK', reason: 'exact current run is bound',
    } },
  });
}

// The storyboard through the page's own DOM: its machine state, its written
// state word and glyph, the evidence line, and however many next-action lines
// it rendered — the count matters as much as the text, because "exactly one"
// is the property that keeps this a decision instead of a menu.
function failureParts(page) {
  const card = findByAttr(page.document.getElementById('founder-body'), 'data-operator-field')
    .find((node) => node.attrs['data-operator-field'] === 'failure-state');
  assert.ok(card, 'Command View exposes no failure-state instrument');
  const evidence = findByAttr(card, 'data-failure-evidence');
  const next = findByAttr(card, 'data-failure-next');
  const nextStep = findByAttr(page.document.getElementById('founder-body'), 'data-operator-field')
    .find((node) => node.attrs['data-operator-field'] === 'next-step');
  return {
    card,
    state: card.attrs['data-failure-state'],
    chip: (card.children || []).find((child) => /^chip\b/.test(String(child.className))),
    evidence: evidence.length ? evidence[0].textContent : null,
    next: next.length ? next[0].textContent : null,
    nextCount: next.length,
    deckNextStep: nextStep ? nextStep.textContent : '',
  };
}

// A named failure states its kind three ways — machine attribute, written word
// and glyph — and repeats the deck's own single next action verbatim.
function assertNamedFailure(parts, state) {
  assert.strictEqual(parts.state, state, `the storyboard did not name ${state}`);
  assert.ok(parts.chip, `${state} is signalled without a state chip`);
  assert.strictEqual(parts.chip.children.length, 2,
    `${state} is signalled by colour alone, without a glyph and a written state`);
  assert.ok(parts.chip.children[0].textContent.trim().length > 0,
    `${state} has an empty glyph, leaving colour as the only shape`);
  assert.strictEqual(parts.chip.children[1].textContent, state,
    `${state} is not written out beside its glyph`);
  assert.match(parts.card.className, /\bis-blocked\b/,
    `${state} did not take the deck's recorded-problem shape`);
  assert.strictEqual(parts.nextCount, 1,
    `${state} rendered ${parts.nextCount} next actions instead of exactly one`);
  const action = parts.next.replace('One next governed action: ', '');
  assert.ok(action.length > 0, `${state} rendered an empty next action`);
  assert.ok(parts.deckNextStep.includes(action),
    `${state} reached its own recovery opinion instead of the deck's next step: ${action}`);
}

test('the failure storyboard owns no clock, no threshold, no lifecycle and no second recovery route', () => {
  assert.ok(STORYBOARD.length > 0, 'the failure-state storyboard resolver was not located');
  for (const banned of ['setInterval', 'setTimeout', 'requestAnimationFrame', 'Date.now', 'new Date',
    'Math.', 'fetch(', 'innerHTML', 'addEventListener', 'callApi', 'matchMedia']) {
    assert.ok(!STORYBOARD.includes(banned),
      `the storyboard uses ${banned} — it may only re-read recorded fields`);
  }
  // A threshold is exactly what would turn this presentation mapping into a
  // second watchdog: the fixed limits belong to aegis-worker and are printed by
  // the supervision instrument, and nothing here may compare against them.
  for (const owned of ['noProgressLimitSec', 'wallClockLimitSec', 'heartbeatAt', 'transitions']) {
    assert.ok(!STORYBOARD.includes(owned),
      `the storyboard reads ${owned}, which belongs to another instrument's authority`);
  }
  // Every fact it does read is a canonical field the projection already wrote.
  for (const canonical of ['build.failure', 'build.failover', 'build.timedOut', 'build.exit',
    's.timeoutReason', 'run.corrections', 'run.maxCorrections', 'run.reviewFailure', 'run.route']) {
    assert.ok(STORYBOARD.includes(canonical),
      `the storyboard no longer reads the canonical ${canonical}`);
  }
  assert.ok(/corrections >= 2/.test(STORYBOARD),
    'repeated review or correction activity is no longer required before churn is claimed');
});

test('no failed or stalled state pulses, spins or borrows a working shape', () => {
  assert.ok(/\.s-PROVIDER_FAILURE\{color:var\(--fail\)\}/.test(code) &&
    /\.s-STALLED,\.s-REVIEW_CHURN\{color:var\(--warn\)\}/.test(code) &&
    /\.s-NO_RECORDED_FAILURE\{color:var\(--text-1\)\}/.test(code),
    'the three failure states are not given distinct, static state colours');
  // The working marks — the half-filled ACTIVE/RUNNING disc and the PASS dot —
  // are what make a dead run look live. No failure state may carry either.
  const glyphs = /PROVIDER_FAILURE:'(.)', STALLED:'(.)', REVIEW_CHURN:'(.)', NO_RECORDED_FAILURE:'(.)'/
    .exec(code);
  assert.ok(glyphs, 'the failure states have no glyphs, so they would be legible by colour alone');
  for (const glyph of glyphs.slice(1)) {
    assert.ok(glyph !== '◐' && glyph !== '●',
      `a failure state carries the working glyph ${glyph}`);
  }
  assert.ok(!/is-failure/.test(PHONE) && !/is-failure/.test(WIDE),
    'the failure storyboard is demoted or re-laid-out instead of read where it is');
  assert.ok(/\.command-card \.meta\{[^}]*overflow-wrap:anywhere/.test(code),
    'canonical failure codes and timestamps can drag the deck sideways inside a pilot card');
  assert.ok(!/\.command-card \.meta\{[^}]*line-clamp/.test(code),
    'the recorded failure evidence is clamped instead of read in full');
});

test('DOM: a recorded provider failure is named as one, with its evidence and one next action', () => {
  const page = bootPage(failureFixture({
    runId: 'RUN-PROVIDER-FAILURE', state: 'BUILD_FAILED',
    objective: 'Continue after a recorded provider failure',
    updatedAt: '2026-09-03T12:00:00.000Z',
    build: {
      mode: 'async', status: 'FAILED', exit: 1, timedOut: false, retrySafe: false,
      recoveryCode: 'MODEL_AUTH_FAILURE',
      activity: { code: 'MODEL_AUTH_FAILURE', phase: 'BLOCKED', active: false,
        summary: 'Claude authentication failed' },
      failure: { code: 'MODEL_AUTH_FAILURE', provider: 'claude-subscription',
        summary: 'Claude authentication failed.' },
      failover: { state: 'NOT_EXECUTABLE', provider: 'grok-subscription', model: 'grok-4.6',
        reason: 'Grok is the next eligible builder, but automatic failover is not enabled for this beta.' },
    },
  }));
  const parts = failureParts(page);
  assertNamedFailure(parts, 'PROVIDER_FAILURE');
  assert.match(parts.card.textContent, /the recorded builder provider could not do this work/,
    'a provider failure is not stated in founder language');
  assert.match(parts.evidence, /Claude authentication failed\./);
  assert.match(parts.evidence, /Recorded failure code MODEL_AUTH_FAILURE, provider claude-subscription\./);
  assert.match(parts.evidence, /Grok is the next eligible builder, but automatic failover is not enabled/,
    'the recorded failover evidence was dropped');
  assert.match(parts.next, /Re-authenticate Claude before continuing/,
    'the provider failure did not carry the deck governed action');
  assert.ok(!/WORK STALLED|REVIEW CHURN/.test(parts.card.textContent),
    'a provider failure was also described as stalled work or review churn');
});

test('DOM: a recorded watchdog timeout is stalled work, not a provider or review failure', () => {
  const page = bootPage(failureFixture({
    runId: 'RUN-STALLED-TIMEOUT', state: 'BUILD_FAILED',
    objective: 'Explain work that stopped making progress',
    updatedAt: '2026-09-03T12:05:00.000Z',
    build: {
      mode: 'async', status: 'FAILED', exit: 124, timedOut: true, retrySafe: null,
      activity: { code: 'FAILED', phase: 'STOPPED', active: false,
        summary: 'Builder stopped with exit 124' },
      supervision: {
        progressState: 'RECORDED', progressKind: 'STDOUT',
        progressSummary: 'Builder is emitting model and tool stream activity',
        lastProgressAt: '2026-09-03T11:50:00.000Z', progressReason: null,
        noProgressLimitSec: 300, wallClockLimitSec: 900,
        timeoutReason: 'NO_PROGRESS_TIMEOUT',
        timeoutSummary: 'Stopped because no real builder progress was observed inside the fixed no-progress limit',
      },
    },
  }));
  const parts = failureParts(page);
  assertNamedFailure(parts, 'STALLED');
  assert.match(parts.card.textContent, /WORK STALLED — the governed watchdog stopped this attempt\./);
  assert.match(parts.evidence,
    /Stopped because no real builder progress was observed inside the fixed no-progress limit\./);
  assert.match(parts.evidence, /Recorded timeout reason NO_PROGRESS_TIMEOUT\./);
  assert.match(parts.evidence, /Last recorded builder progress: 2026-09-03T11:50:00\.000Z\./,
    'stalled work does not show the last progress the run actually recorded');
  assert.match(parts.next, /Continue this run from the AEGIS CLI/,
    'the stalled run did not carry the deck governed continuation route');
  assert.ok(!/PROVIDER FAILURE|REVIEW CHURN/.test(parts.card.textContent),
    'stalled work was also described as a provider failure or review churn');
});

test('DOM: a run still recorded as building with terminal builder evidence reads as stalled', () => {
  const page = bootPage(failureFixture({
    runId: 'RUN-STALLED-CONTRADICTION', state: 'BUILDING',
    objective: 'Explain a build whose worker already stopped',
    updatedAt: '2026-09-03T12:10:00.000Z',
    build: {
      mode: 'async', status: 'RUNNING', workerPid: 4242, exit: 3, timedOut: false,
      activity: { code: 'TERMINAL_STATE_MISMATCH', phase: 'BLOCKED', active: false,
        summary: 'Terminal builder exit 3 conflicts with an active lifecycle claim' },
    },
  }));
  const parts = failureParts(page);
  assertNamedFailure(parts, 'STALLED');
  assert.match(parts.evidence,
    /Terminal builder exit 3 conflicts with an active lifecycle claim\./);
  assert.match(parts.evidence, /Recorded activity code TERMINAL_STATE_MISMATCH, active NO, exit 3\./);
  assert.match(parts.evidence, /Last recorded builder progress: UNAVAILABLE\./,
    'an unrecorded progress fact was filled in rather than stated as unavailable');
});

test('DOM: repeated recorded correction cycles are review churn, and one correction is not', () => {
  const churn = bootPage(failureFixture({
    runId: 'RUN-REVIEW-CHURN', state: 'REVIEW_FAILED',
    objective: 'Correct exact review findings',
    updatedAt: '2026-09-03T12:15:00.000Z', corrections: 3, maxCorrections: 3,
    reviewFailure: { status: 'UNVERIFIED', reasonCode: 'REVIEW_FAILURE_UNCORROBORATED',
      summary: 'The run records a review-failure claim, but attested gate evidence is unavailable in this projection.' },
  }));
  const churnParts = failureParts(churn);
  assertNamedFailure(churnParts, 'REVIEW_CHURN');
  assert.match(churnParts.card.textContent,
    /REVIEW CHURN — this change has already been corrected more than once\./);
  assert.match(churnParts.evidence, /Recorded correction cycles: 3 of 3 allowed\./);
  assert.match(churnParts.evidence,
    /Last recorded review outcome: The run records a review-failure claim/,
    'review churn dropped the last recorded review outcome');
  assert.match(churnParts.next, /All 3 bounded correction cycle\(s\) are already used/,
    'review churn did not carry the deck recorded refusal as its one next action');

  // One correction is a correction. Calling it a cycle would be the storyboard
  // inventing the very pattern it exists to report.
  const single = bootPage(failureFixture({
    runId: 'RUN-ONE-CORRECTION', state: 'REVIEW_FAILED',
    objective: 'Correct exact review findings once',
    updatedAt: '2026-09-03T12:16:00.000Z', corrections: 1, maxCorrections: 3,
  }));
  const singleParts = failureParts(single);
  assert.strictEqual(singleParts.state, 'UNAVAILABLE',
    'a single recorded correction was reported as repeated review activity');
  assert.ok(!/REVIEW CHURN|WORK STALLED|PROVIDER FAILURE/.test(singleParts.card.textContent),
    'a failure with no canonical kind was filed under one of the three stories');
  assert.match(singleParts.card.textContent,
    /no canonical evidence names it as stalled work, a provider failure or review churn/);
  assert.match(singleParts.evidence, /Recorded correction cycles: 1 of 3 allowed\./,
    'the recorded correction count was hidden by the unavailable kind');
  assert.strictEqual(singleParts.nextCount, 1,
    'a recorded failure of unavailable kind must still carry exactly one next action');
});

test('DOM: with no failure evidence and no bound run the storyboard claims nothing', () => {
  const healthy = failureParts(bootPage(failureFixture({
    runId: 'RUN-NO-FAILURE', state: 'BUILDING', objective: 'Build with nothing recorded as wrong',
    updatedAt: '2026-09-03T12:20:00.000Z',
    build: { mode: 'async', status: 'RUNNING', workerPid: 4242, exit: null, timedOut: false,
      activity: { code: 'RUNNING', phase: 'RUNNING', active: true, summary: 'Builder is running' } },
  })));
  assert.strictEqual(healthy.state, 'NO_RECORDED_FAILURE');
  assert.doesNotMatch(healthy.card.className, /\bis-blocked\b/,
    'a run with no recorded failure was given the recorded-problem shape');
  assert.strictEqual(healthy.nextCount, 0,
    'a run with no recorded failure was still given a failure recovery action');
  assert.match(healthy.evidence, /Recorded run state: BUILDING\./);
  assert.match(healthy.evidence, /Recorded correction cycles: UNAVAILABLE\./,
    'an absent correction counter was rendered as zero rather than unavailable');

  const unbound = failureParts(bootPage(fixtureState()));
  assert.strictEqual(unbound.state, 'UNAVAILABLE');
  assert.strictEqual(unbound.nextCount, 0);
  assert.match(unbound.card.textContent,
    /UNAVAILABLE — no run is bound, so no failure state can be read\./);
  assert.ok(!/REVIEW CHURN|WORK STALLED|PROVIDER FAILURE/.test(unbound.card.textContent),
    'an unbound page invented a failure story');

  // An absence in the record is never presented as a healthy run.
  const noBuild = failureParts(bootPage(failureFixture({
    runId: 'RUN-NO-BUILDER', state: 'INTAKE_RECORDED', objective: 'Recorded objective only',
    updatedAt: '2026-09-03T12:21:00.000Z',
  })));
  assert.strictEqual(noBuild.state, 'NO_RECORDED_FAILURE');
  assert.match(noBuild.evidence, /absence of evidence rather than proof that nothing failed/,
    'a run with no builder attempt was reported as a proven-clean attempt');
});

test('DOM: Detail View restates the same failure reading, so the two surfaces cannot disagree', () => {
  const page = bootPage(failureFixture({
    runId: 'RUN-DETAIL-FAILURE', state: 'BUILD_FAILED',
    objective: 'Read the same failure on both surfaces',
    updatedAt: '2026-09-03T12:25:00.000Z',
    build: {
      mode: 'async', status: 'FAILED', exit: 1, timedOut: false, retrySafe: false,
      activity: { code: 'MODEL_AUTH_FAILURE', phase: 'BLOCKED', active: false,
        summary: 'Claude authentication failed' },
      failure: { code: 'MODEL_AUTH_FAILURE', provider: 'claude-subscription',
        summary: 'Claude authentication failed.' },
      failover: { state: 'NOT_EXECUTABLE', provider: 'grok-subscription', model: 'grok-4.6',
        reason: 'Grok is the next eligible builder, but automatic failover is not enabled for this beta.' },
    },
  }));
  const parts = failureParts(page);
  const lead = evidencePanelsById(page).action;
  assert.ok(lead, 'the Detail View lead instrument is missing');
  assert.match(lead.textContent, /Failure state: PROVIDER_FAILURE — /,
    'Detail View does not restate the resolved failure state');
  assert.ok(lead.textContent.includes(parts.evidence.replace('Last recorded evidence: ', '')),
    'Detail View derived its own failure evidence instead of restating the resolved one');
  assert.ok(lead.textContent.includes(parts.next.replace('One next governed action: ', '')),
    'Detail View and Command View disagree about the one next governed action');
});

test('DOM: founder activity preserves exact evidence and never promotes a control receipt to progress', () => {
  const page = bootPage(fixtureState());
  const raw = 'Retry failed for RUN-FOUNDER: exact refusal [AEGIS-BOUNDARY]';
  page.sandbox.AEGIS_DASHBOARD.appendActivity(raw, {
    code: 'RETRY_REFUSED', runId: 'RUN-FOUNDER', ts: '2026-09-03T15:04:05.000Z',
  });
  const host = page.document.getElementById('live-activity');
  const items = findByAttr(host, 'data-activity');
  assert.strictEqual(items.length, 1, 'one receipt produced more than one activity item');
  assert.strictEqual(items[0].attrs['data-activity'], 'RETRY_REFUSED');
  assert.match(items[0].textContent, /The correction cycle did not start/,
    'Command View did not translate the refusal into founder-readable language');
  assert.match(items[0].textContent, /No — nothing moved forward/,
    'a refused retry was allowed to imply progress');
  const evidence = findByAttr(host, 'data-activity-evidence');
  assert.strictEqual(evidence.length, 1, 'the exact receipt does not share its founder activity item');
  assert.ok(evidence[0].textContent.includes(raw), 'Detail evidence rewrote or dropped the exact receipt');
  assert.match(evidence[0].textContent, /Canonical timestamp 2026-09-03T15:04:05\.000Z/,
    'the canonical timestamp was not retained beside the exact receipt');

  const unknown = page.sandbox.AEGIS_DASHBOARD.activityUpdate({ code: 'HEARTBEAT_ONLY' });
  assert.strictEqual(unknown.code, 'UNAVAILABLE');
  assert.match(unknown.moved, /^No —/,
    'an unknown or heartbeat-only update was allowed to imply progress');
  assert.match(unknown.stamp, /timestamp UNAVAILABLE/,
    'an event without a canonical timestamp received an invented browser time');
  assert.strictEqual(unknown.repeatable, false,
    'an update AEGIS cannot name was still marked foldable into another item');
});

test('DOM: repeated status snapshots read as one counted item that keeps every receipt', () => {
  const page = bootPage(fixtureState());
  const host = page.document.getElementById('live-activity');
  const push = (text, record) => page.sandbox.AEGIS_DASHBOARD.appendActivity(text, record);
  const kids = (node, cls) => node.children.filter((child) => child.className === cls);
  const codes = () => findByAttr(host, 'data-activity');
  const raw = 'status: engineering=OK runs=1 current=RUN-QUIET';

  // Two pushes of the SAME picture. The system sent them by itself; nothing
  // was pressed and no build step ran for either one.
  push(raw, { code: 'STATUS_SNAPSHOT', ts: '2026-09-03T15:00:00.000Z', runId: 'RUN-QUIET' });
  push(raw, { code: 'STATUS_SNAPSHOT', ts: '2026-09-03T15:00:30.000Z', runId: 'RUN-QUIET' });

  let items = codes();
  assert.strictEqual(items.length, 1,
    'two byte-identical status snapshots produced duplicate Command View cards');
  assert.strictEqual(items[0].attrs['data-activity'], 'STATUS_SNAPSHOT');
  assert.strictEqual(items[0].attrs['data-activity-repeats'], '2',
    'the one item does not carry a truthful count of the canonical updates it stands for');
  const repeat = kids(items[0], 'activity-repeat');
  assert.strictEqual(repeat.length, 1, 'the folded item has no single founder-readable repeat line');
  assert.match(repeat[0].textContent, /arrived 2 times in a row/,
    'Command View does not say how many identical updates this one item stands for');
  assert.match(repeat[0].textContent, /not progress/,
    'a repeated update was counted as build progress');
  assert.match(items[0].textContent, /Not from this update/,
    'the folded item stopped answering that the update claims no step of its own');

  // Detail View still holds BOTH exact receipts and BOTH canonical timestamps,
  // in arrival order, inside that same item.
  let evidence = findByAttr(host, 'data-activity-evidence');
  assert.strictEqual(evidence.length, 1, 'a folded repeat opened a second evidence block');
  assert.deepStrictEqual(kids(evidence[0], 'activity-raw-text').map((n) => n.textContent), [raw, raw],
    'Detail View dropped or rewrote one of the two exact receipts');
  assert.deepStrictEqual(kids(evidence[0], 'activity-raw-stamp').map((n) => n.textContent), [
    'Canonical timestamp 2026-09-03T15:00:00.000Z',
    'Canonical timestamp 2026-09-03T15:00:30.000Z',
  ], 'Detail View lost a canonical timestamp or disclosed the two receipts out of order');

  // A CHANGED picture is a different thing to read and gets its own item.
  push('status: engineering=OK runs=2 current=RUN-QUIET',
    { code: 'STATUS_SNAPSHOT', ts: '2026-09-03T15:01:00.000Z', runId: 'RUN-QUIET' });
  assert.strictEqual(codes().length, 2,
    'a changed status snapshot was folded into the item it differs from');
  assert.strictEqual(host.children[0].attrs['data-activity-repeats'], '1',
    'a first sighting was counted as a repeat');
  assert.strictEqual(host.children[1].attrs['data-activity-repeats'], '2',
    'opening a new item rewrote the count of the item it did not fold into');
  assert.strictEqual(kids(host.children[0], 'activity-repeat').length, 0,
    'an item standing for one update still shows a repeat count');

  // Only CONSECUTIVE repeats fold: the first text is back, but something else
  // has been read since, so it is a new occurrence and not a repeat of that item.
  push(raw, { code: 'STATUS_SNAPSHOT', ts: '2026-09-03T15:01:30.000Z', runId: 'RUN-QUIET' });
  assert.strictEqual(codes().length, 3, 'a non-consecutive repeat was folded into an older item');

  // Nothing else folds. Two identical refusals are two refusals, and an update
  // AEGIS cannot name is never merged into another one.
  push('Retry failed for RUN-QUIET: exact refusal',
    { code: 'RETRY_REFUSED', runId: 'RUN-QUIET', ts: '2026-09-03T15:02:00.000Z' });
  push('Retry failed for RUN-QUIET: exact refusal',
    { code: 'RETRY_REFUSED', runId: 'RUN-QUIET', ts: '2026-09-03T15:02:10.000Z' });
  push('heartbeat only', { code: 'HEARTBEAT_ONLY', ts: '2026-09-03T15:03:00.000Z' });
  push('heartbeat only', { code: 'HEARTBEAT_ONLY', ts: '2026-09-03T15:03:10.000Z' });

  items = codes();
  const byCode = (want) => items.filter((n) => n.attrs['data-activity'] === want);
  assert.strictEqual(byCode('RETRY_REFUSED').length, 2,
    'two identical control refusals were coalesced — each refusal is a separate thing that happened');
  assert.strictEqual(byCode('UNAVAILABLE').length, 2,
    'an update AEGIS cannot name was folded into another one');
  for (const item of byCode('RETRY_REFUSED').concat(byCode('UNAVAILABLE'))) {
    assert.strictEqual(item.attrs['data-activity-repeats'], '1',
      'a non-foldable event was given a repeat count');
    assert.strictEqual(kids(item, 'activity-repeat').length, 0,
      'a non-foldable event was given a repeat line');
  }

  // Eight canonical updates arrived; eight exact receipts are still on the page.
  evidence = findByAttr(host, 'data-activity-evidence');
  assert.strictEqual(items.length, 7, 'the feed holds the wrong number of activity items');
  assert.strictEqual(
    evidence.reduce((total, block) => total + kids(block, 'activity-raw-text').length, 0), 8,
    'the feed holds fewer exact receipts than the number of canonical updates it received');
});

test('DOM: every founder activity card shows the canonical time it carries, or states that it carries none', () => {
  const page = bootPage(fixtureState());
  const host = page.document.getElementById('live-activity');
  const push = (text, record) => page.sandbox.AEGIS_DASHBOARD.appendActivity(text, record);
  const kids = (node, cls) => node.children.filter((child) => child.className === cls);
  const stampOf = (item) => {
    const stamps = kids(item, 'activity-stamp');
    assert.strictEqual(stamps.length, 1, 'an activity card carries no single visible receipt time');
    return stamps[0].textContent;
  };

  // A receipt that carries a canonical timestamp prints that exact timestamp in
  // Command View, without opening Detail View and without a relative reading.
  push('Retry failed for RUN-TIMED: exact refusal',
    { code: 'RETRY_REFUSED', runId: 'RUN-TIMED', ts: '2026-09-03T15:04:05.000Z' });
  assert.strictEqual(stampOf(host.children[0]), 'Canonical timestamp 2026-09-03T15:04:05.000Z',
    'the founder card did not print the exact canonical timestamp the receipt carries');
  assert.ok(!/\bago\b|\bjust now\b|\bmoments\b|\bminutes\b/i.test(host.children[0].textContent),
    'the card described the receipt time relative to a clock instead of citing it');

  // A control receipt carries no time of its own, and the card says so rather
  // than stamping one — that absence is the whole reason this line is visible.
  push('Cancel accepted for RUN-TIMED', { code: 'CANCEL_ACCEPTED', runId: 'RUN-TIMED' });
  assert.strictEqual(stampOf(host.children[0]),
    'Canonical timestamp UNAVAILABLE — this receipt carries none.',
    'a receipt with no canonical time was given one, or was left silently undated');

  // A folded item stands for several receipts, so its visible time names both
  // ends of the ARRIVAL order and nothing in between is lost.
  const raw = 'status: engineering=OK runs=1 current=RUN-TIMED';
  push(raw, { code: 'STATUS_SNAPSHOT', runId: 'RUN-TIMED', ts: '2026-09-03T15:10:00.000Z' });
  const folded = host.children[0];
  push(raw, { code: 'STATUS_SNAPSHOT', runId: 'RUN-TIMED', ts: '2026-09-03T15:10:30.000Z' });
  push(raw, { code: 'STATUS_SNAPSHOT', runId: 'RUN-TIMED', ts: '2026-09-03T15:11:00.000Z' });
  assert.strictEqual(host.children[0], folded, 'the three identical snapshots did not fold into one item');
  assert.strictEqual(folded.attrs['data-activity-repeats'], '3',
    'the fold lost its truthful count of the canonical updates it stands for');
  const foldStamp = stampOf(folded);
  assert.ok(foldStamp.includes('Received first: Canonical timestamp 2026-09-03T15:10:00.000Z'),
    `the folded item does not name the receipt it was opened with: ${foldStamp}`);
  assert.ok(foldStamp.includes('Received last: Canonical timestamp 2026-09-03T15:11:00.000Z'),
    `the folded item does not name the receipt it has just taken in: ${foldStamp}`);
  assert.match(foldStamp, /order these receipts arrived in this feed/,
    `the two times are not stated as arrival order: ${foldStamp}`);
  assert.ok(!/newest|latest|most recent|freshest/i.test(foldStamp),
    `the folded item ranked one receipt above the other: ${foldStamp}`);

  // Every raw receipt and every canonical stamp is still disclosed, in arrival
  // order, inside that same item: the visible line summarises nothing away.
  const evidence = findByAttr(folded, 'data-activity-evidence');
  assert.strictEqual(evidence.length, 1, 'a folded repeat opened a second evidence block');
  assert.deepStrictEqual(kids(evidence[0], 'activity-raw-text').map((n) => n.textContent), [raw, raw, raw],
    'Detail View dropped one of the three exact receipts');
  assert.deepStrictEqual(kids(evidence[0], 'activity-raw-stamp').map((n) => n.textContent), [
    'Canonical timestamp 2026-09-03T15:10:00.000Z',
    'Canonical timestamp 2026-09-03T15:10:30.000Z',
    'Canonical timestamp 2026-09-03T15:11:00.000Z',
  ], 'Detail View lost a canonical timestamp or disclosed the three receipts out of order');

  // The items the fold did not touch still read exactly as they did.
  assert.strictEqual(stampOf(host.children[1]),
    'Canonical timestamp UNAVAILABLE — this receipt carries none.',
    'folding one item rewrote the visible time of the item below it');
  assert.strictEqual(stampOf(host.children[2]), 'Canonical timestamp 2026-09-03T15:04:05.000Z',
    'folding one item rewrote the visible time of an older item');
});

// ── founder-readable builder activity (PKT-20260826-ASYNC-WORKER-OPERATOR-BETA) ─
// "Stream activity was observed" is true and tells the owner nothing. The
// supervision projection now carries a bounded category and the time its own
// evidence was recorded, and these proofs hold the three properties that make
// that safe: the category is stated in plain English with its evidence time, a
// heartbeat with no real progress still reads unavailable, and Command View and
// Detail View print it from the one shared resolution rather than two.
const RECORDED_ACTIVITY_SUPERVISION = Object.freeze({
  progressState: 'RECORDED', progressKind: 'STDOUT',
  progressSummary: 'Builder is emitting model and tool stream activity',
  lastProgressAt: '2026-09-03T14:09:50.000Z', progressReason: null,
  activityState: 'RECORDED', activityCode: 'READING',
  activitySummary: 'Reading files in the worktree',
  activityAt: '2026-09-03T14:09:45.000Z', activityReason: null,
  noProgressLimitSec: 300, wallClockLimitSec: 900,
  timeoutReason: null, timeoutSummary: null,
});
const HEARTBEAT_ONLY_SUPERVISION = Object.freeze({
  progressState: 'UNRECORDED', progressKind: null, progressSummary: null,
  lastProgressAt: null,
  progressReason: 'No real builder progress is recorded for this attempt, so builder ' +
    'liveness rests on the supervisor heartbeat alone.',
  activityState: 'UNRECORDED', activityCode: null, activitySummary: null, activityAt: null,
  activityReason: 'No bounded builder activity is recorded for this attempt, so what the ' +
    'builder is doing right now is unavailable.',
  noProgressLimitSec: 300, wallClockLimitSec: 900,
  timeoutReason: null, timeoutSummary: null,
});

function liveActivityRun(supervision) {
  return {
    runId: 'RUN-ACTIVITY', state: 'BUILDING',
    objective: 'Make live builder activity founder-readable',
    updatedAt: '2026-09-03T14:10:00.000Z', transitions: 4,
    build: {
      mode: 'async', status: 'RUNNING', workerPid: 7171,
      startedAt: '2026-09-03T14:00:00.000Z', heartbeatAt: '2026-09-03T14:09:59.000Z',
      endedAt: null, exit: null, timedOut: false, cancelAvailable: true,
      activity: { active: true, phase: 'RUNNING', code: 'RUNNING', summary: 'Builder is running' },
      supervision: supervision,
    },
  };
}

// opts reaches bootPage unchanged, so a proof can boot this same running
// builder as a device that asks for reduced motion.
function liveActivityPage(supervision, opts) {
  const run = liveActivityRun(supervision);
  return bootPage(fixtureState({
    generatedAt: '2026-09-03T14:10:00.000Z',
    runs: { state: 'OK', runs: [run], current: {
      state: 'BOUND', runId: run.runId, updatedAt: run.updatedAt,
      reason: 'exact current run is bound',
    } },
  }), opts);
}

function builderProgressCard(page) {
  const cards = findByAttr(page.document.getElementById('founder-body'), 'data-supervision-state');
  assert.strictEqual(cards.length, 1, `expected one BUILDER PROGRESS card, found ${cards.length}`);
  return cards[0];
}

test('DOM: a running builder with a recorded read activity says what it is doing and when', () => {
  const page = liveActivityPage(RECORDED_ACTIVITY_SUPERVISION);
  const card = builderProgressCard(page);
  assert.strictEqual(card.attrs['data-supervision-state'], 'PROGRESS_RECORDED');
  assert.match(card.textContent,
    /Reading files in the worktree — activity evidence recorded 2026-09-03T14:09:45\.000Z\./,
    'the deck does not state the current activity in plain English with its own evidence time');
  // The two facts stay separate: what it is doing, and when it last did
  // anything real. Merging them is how a stalled build reads as busy.
  assert.match(card.textContent, /last real progress 2026-09-03T14:09:50\.000Z/,
    'the activity replaced the last-real-progress fact instead of joining it');
  assert.match(card.textContent,
    /Supervisor heartbeat 2026-09-03T14:09:59\.000Z is liveness only, never progress\./,
    'the heartbeat qualifier was dropped once an activity was available');
});

test('DOM: a heartbeat with no real progress still reads as progress unavailable', () => {
  const page = liveActivityPage(HEARTBEAT_ONLY_SUPERVISION);
  const card = builderProgressCard(page);
  assert.strictEqual(card.attrs['data-supervision-state'], 'PROGRESS_UNRECORDED');
  assert.match(card.textContent, /liveness rests on the supervisor heartbeat alone/,
    'a heartbeating builder with no progress did not say what its liveness actually rests on');
  for (const invented of [/activity evidence recorded/, /Reading files/, /Editing files/,
    /last real progress/]) {
    assert.doesNotMatch(card.textContent, invented,
      `a heartbeat produced ${invented}, which no canonical progress evidence supports`);
  }
  const detail = page.text('runs-list');
  assert.match(detail, /Last observed activity: NOT RECORDED/,
    'Detail View filled an unrecorded activity in rather than stating the absence');
});

test('DOM: Command View and Detail View print one builder-activity resolution, never two', () => {
  const page = liveActivityPage(RECORDED_ACTIVITY_SUPERVISION);
  const facts = page.sandbox.AEGIS_DASHBOARD.supervisionFacts(
    liveActivityRun(RECORDED_ACTIVITY_SUPERVISION).build);
  assert.strictEqual(facts.activity,
    'Reading files in the worktree — activity evidence recorded 2026-09-03T14:09:45.000Z.');
  assert.ok(builderProgressCard(page).textContent.includes(facts.headline),
    'the Command View card printed something other than the shared resolution headline');
  const detailBlocks = findByAttr(page.document.getElementById('runs-list'), 'data-supervision-state');
  assert.strictEqual(detailBlocks.length, 1,
    `expected one Detail View supervision block, found ${detailBlocks.length}`);
  assert.strictEqual(detailBlocks[0].attrs['data-supervision-state'],
    builderProgressCard(page).attrs['data-supervision-state'],
    'the two surfaces disagree about the supervision state');
  assert.ok(detailBlocks[0].textContent.includes('Last observed activity: ' + facts.activity),
    'Detail View derived its own activity sentence instead of restating the resolved one');
  // One resolution, read twice — not two renderers that happen to agree today.
  assert.ok(/window\.AEGIS_DASHBOARD\.supervisionFacts\(build\)/.test(code),
    'Detail View no longer reads the shared supervision resolution');
  assert.strictEqual((code.match(/function supervisionFacts\(/g) || []).length, 1,
    'a second supervision resolution would drift from the first');
});

// ── the AEGIS Core evidence cue ─────────────────────────────────────────────
// The page now has one animation, and the whole question is whether it can ever
// mean anything except "new recorded builder activity arrived". These proofs
// hold both halves of that: it fires for genuinely new evidence, and it fires
// for nothing else — not a repaint, not a duplicate, not a heartbeat, not the
// historical snapshot the page opens with, not a stopped or unreadable worker,
// and never while motion is suppressed.
// The bounded categories the projection publishes, with the sentence it
// publishes beside each. A fixture that changed the category without the
// sentence would be evidence no projection could produce.
const ACTIVITY_SUMMARY = Object.freeze({
  READING: 'Reading files in the worktree',
  EDITING: 'Editing files in the worktree',
});
function activityEvidence(at, activityCode) {
  const named = activityCode || 'READING';
  return Object.assign({}, RECORDED_ACTIVITY_SUPERVISION, {
    activityAt: at, activityCode: named, activitySummary: ACTIVITY_SUMMARY[named],
  });
}

// The minimized flat /api/status shape, pushed through the real switchboard
// seam. `over` mutates exactly the canonical evidence a proof is about.
function activityStatus(supervision, over) {
  const edit = over || {};
  const run = liveActivityRun(supervision);
  if (edit.supervision) {
    run.build.supervision = Object.assign({}, run.build.supervision, edit.supervision);
  }
  if (edit.build) Object.assign(run.build, edit.build);
  if (edit.run) Object.assign(run, edit.run);
  return {
    generatedAt: '2026-09-03T14:10:10.000Z',
    engineering: fixtureState().engineering,
    integration: { connectors: [] }, reviewers: [],
    cost: { state: 'UNAVAILABLE', reason: null },
    runs: [run],
    runsBinding: Object.assign({
      state: 'BOUND', runId: run.runId, updatedAt: run.updatedAt,
      evidenceState: 'OK', reason: 'exact current run is bound',
    }, edit.binding || {}),
    events: [], knowledge: { state: 'UNKNOWN', conflicts: null },
  };
}

const coreCue = (page) => page.document.getElementById('aegis-core').getAttribute('data-core-cue');

test('DOM: new recorded builder activity cues the core once, and the opening snapshot never does', () => {
  const page = liveActivityPage(RECORDED_ACTIVITY_SUPERVISION);
  // The page opens onto a builder that was already running with already-recorded
  // activity. That is history, not news arriving while the operator watches.
  assert.strictEqual(coreCue(page), null,
    'the first activity the page resolved was historical evidence, and it animated the core anyway');
  renderMinimizedStatus(page, activityStatus(activityEvidence('2026-09-03T14:10:04.000Z', 'EDITING')));
  const first = coreCue(page);
  assert.ok(first === 'a' || first === 'b',
    `a genuinely new recorded activity produced no core cue: ${first}`);
  // A second genuine update must be visible as a second cue, which means the
  // animation name has to change — otherwise the one-shot never restarts.
  renderMinimizedStatus(page, activityStatus(activityEvidence('2026-09-03T14:10:06.000Z', 'EDITING')));
  const second = coreCue(page);
  assert.notStrictEqual(second, first,
    'a second genuine update reused the same animation name, so nothing would restart on screen');
  // The recorded category is part of the identity, not only its timestamp: a
  // different thing observed at the same evidence time is still a new thing.
  renderMinimizedStatus(page, activityStatus(activityEvidence('2026-09-03T14:10:06.000Z', 'READING')));
  assert.notStrictEqual(coreCue(page), second,
    'a different recorded activity category at the same evidence time was folded into a duplicate');
  // The cue is worker evidence, not a gate outcome: the core still prints the
  // canonical lifecycle word, and the gate is still recorded as BLOCKED.
  assert.strictEqual(page.text('hud-core-status'), RUN_STATE_PLAIN.RUNNING,
    'the core cue moved the canonical core status word');
  assert.strictEqual(page.text('hud-gate-state'), 'Needs attention',
    'a cue for new worker evidence turned a blocking gate into a passing one');
  assert.strictEqual(page.document.getElementById('hud-gate-state').attrs['data-hud-code'], 'BLOCKED',
    'the HUD gate footer dropped the exact canonical gate code');
  assert.match(page.text('founder-body'), /activity evidence recorded 2026-09-03T14:10:06\.000Z/,
    'the readable activity sentence was replaced by the visual cue');
});

test('DOM: a duplicate push and a heartbeat-only push never cue the core', () => {
  const page = liveActivityPage(RECORDED_ACTIVITY_SUPERVISION);
  renderMinimizedStatus(page, activityStatus(activityEvidence('2026-09-03T14:10:04.000Z')));
  const cued = coreCue(page);
  assert.ok(cued, 'the setup update produced no cue to test against');
  // Identical evidence again. The identity is unchanged, so the page does
  // nothing at all: a repaint neither invents a second cue nor cuts short the
  // one already running.
  renderMinimizedStatus(page, activityStatus(activityEvidence('2026-09-03T14:10:04.000Z')));
  assert.strictEqual(coreCue(page), cued,
    'a duplicate push restarted or cancelled the core cue instead of leaving it alone');
  // A push carrying supervisor liveness and no recorded activity is not
  // evidence that anything happened.
  renderMinimizedStatus(page, activityStatus(HEARTBEAT_ONLY_SUPERVISION));
  assert.strictEqual(coreCue(page), null,
    'a heartbeat with no recorded activity left the core claiming new worker evidence');
  // And the same old evidence coming back is still the same old evidence.
  renderMinimizedStatus(page, activityStatus(activityEvidence('2026-09-03T14:10:04.000Z')));
  assert.strictEqual(coreCue(page), null,
    'evidence the page had already displayed was replayed as if it were new');
});

test('DOM: no cue survives a stopped, waiting, failed, unbound or unreadable worker', () => {
  const stops = [
    ['a terminal builder exit', { build: { exit: 0 } }],
    ['a stopped worker status', { build: { status: 'EXITED' } }],
    ['a recorded builder timeout', { build: { timedOut: true } }],
    ['a failed run', { run: { state: 'BUILD_FAILED' } }],
    ['a worker claimed but not yet working', { build: { status: 'QUEUED' } }],
    ['an unavailable current-run binding', { binding: { state: 'UNAVAILABLE', runId: null } }],
    ['a binding that names another run', { binding: { runId: 'RUN-SOMETHING-ELSE' } }],
    ['an activity category the projection could not name',
      { supervision: { activityState: 'UNRECORDED', activityCode: null } }],
    ['activity evidence with no recorded time', { supervision: { activityAt: null } }],
  ];
  for (const [label, over] of stops) {
    const page = liveActivityPage(RECORDED_ACTIVITY_SUPERVISION);
    renderMinimizedStatus(page, activityStatus(activityEvidence('2026-09-03T14:10:04.000Z')));
    assert.ok(coreCue(page), `${label}: the setup update produced no cue to clear`);
    // The activity time moves as well, so a missing guard would show itself as a
    // cue rather than as evidence that merely happens to repeat.
    renderMinimizedStatus(page, activityStatus(activityEvidence('2026-09-03T14:10:07.000Z'), over));
    assert.strictEqual(coreCue(page), null,
      `${label} left the AEGIS Core cued, which claims live worker evidence that is not recorded`);
  }
});

test('DOM: reduced motion from either source suppresses the cue and the words survive it', () => {
  const asksForReduce = (query) => ({ matches: /prefers-reduced-motion/.test(query) });
  const device = liveActivityPage(RECORDED_ACTIVITY_SUPERVISION, { matchMedia: asksForReduce });
  assert.strictEqual(device.document.body.getAttribute('data-reduced-motion'), 'true',
    'the device fixture did not boot the page in the reduced state');
  renderMinimizedStatus(device, activityStatus(activityEvidence('2026-09-03T14:10:04.000Z')));
  assert.strictEqual(coreCue(device), null,
    'a device that asks for reduced motion was still given a core cue');
  assert.match(device.text('founder-body'), /Reading files in the worktree/,
    'suppressing the motion also removed the readable activity it was standing in for');

  // Set here instead, mid-cue: pressing the control cancels what is on screen
  // rather than letting it finish.
  const local = liveActivityPage(RECORDED_ACTIVITY_SUPERVISION);
  renderMinimizedStatus(local, activityStatus(activityEvidence('2026-09-03T14:10:04.000Z')));
  assert.ok(coreCue(local), 'the setup update produced no cue to cancel');
  local.document.getElementById('toggle-motion')._listeners.click[0]();
  assert.strictEqual(local.document.body.getAttribute('data-reduced-motion'), 'true',
    'the on-page control did not reach the reduced state');
  assert.strictEqual(coreCue(local), null,
    'switching reduced motion on left an active core cue running');
  renderMinimizedStatus(local, activityStatus(activityEvidence('2026-09-03T14:10:09.000Z')));
  assert.strictEqual(coreCue(local), null,
    'new evidence animated the core while the operator had reduced motion switched on');
  assert.match(local.text('founder-body'), /activity evidence recorded 2026-09-03T14:10:09\.000Z/,
    'with motion off the operator lost the activity evidence entirely');
});

test('the core cue is bound to an evidence identity and owns no timer, log or verdict', () => {
  const fn = code.slice(code.indexOf('var CORE_CUE_STEPS'),
    code.indexOf('function reviewerEvidenceReady'));
  assert.ok(fn.length > 0, 'the core cue resolver was not located');
  for (const banned of ['setInterval', 'setTimeout', 'requestAnimationFrame', 'Date.now', 'new Date',
    'Math.', 'fetch(', 'innerHTML']) {
    assert.ok(!fn.includes(banned),
      `the cue uses ${banned} — motion must be bound to recorded evidence, never to time`);
  }
  // It re-reads the resolutions the deck already owns, and derives no run
  // reading of its own.
  for (const canonical of ["binding.state !== 'BOUND'", 'binding.runId !== run.runId',
    "operationalState(run).state !== 'RUNNING'", 'supervisionFacts(build)',
    's.activityCode', 's.activityAt']) {
    assert.ok(fn.includes(canonical), `the cue no longer reads the canonical ${canonical}`);
  }
  // Deduplication only: one identity, not a second activity log or counter.
  assert.ok(/var coreCueIdentity = null;/.test(fn) && !/\.push\(/.test(fn) && !/\.concat\(/.test(fn),
    'the cue accumulates activity instead of holding the single identity it needs to deduplicate');
  // And it says nothing about gates, review or checkpoints.
  for (const owned of ['hud-core-status', 'verdict', 'engineering', 'problems', 'checkpoint',
    'subjectSha256']) {
    assert.ok(!fn.includes(owned),
      `the cue reads ${owned} — it reports new worker evidence, never a gate or review outcome`);
  }
  // One driver, one place that can start a cue, and a clearing seam the
  // switchboard uses for the two facts the renderer cannot see.
  assert.ok(/renderCoreActivityCue\(boundRun, bind\);/.test(code),
    'the cue is not driven by the bound run and binding the deck already resolved');
  assert.strictEqual((code.match(/core\.setAttribute\('data-core-cue'/g) || []).length, 1,
    'a second place in the page can start a core cue');
  const disconnect = code.slice(code.indexOf('es.onerror = function()'));
  assert.ok(/clearCoreActivityCue\(\)/.test(disconnect.slice(0, 700)),
    'a dropped live stream leaves the core cued, which claims evidence that has stopped arriving');
  const motion = code.slice(code.indexOf('function applyMotion()'));
  assert.ok(/reduced && window\.AEGIS_DASHBOARD && window\.AEGIS_DASHBOARD\.clearCoreActivityCue/
    .test(motion.slice(0, 600)),
    'switching reduced motion on does not take an active cue off the screen');
});

// ── the live operations rail (PKT-20260826-ASYNC-WORKER-OPERATOR-BETA) ──────
// What is working now, which model owns it, the last recorded action with the
// time its evidence was received, and the last proven handoff used to be facts
// an owner assembled from separate surfaces. They are one rail now, and the
// failure that consolidation invites is a second authority: a rail that
// resolved presence, model identity, activity or a transition for itself would
// be free to disagree with the supervision card, the station path and the
// announcement that already report them. Every proof below therefore holds the
// same property from a different angle — the rail restates, it never decides,
// and an absence stays an absence rather than becoming a reassuring blank.
function opsRail(page) {
  const rails = findByAttr(page.document.getElementById('founder-body'), 'data-ops-rail');
  assert.strictEqual(rails.length, 1, `expected exactly one live operations rail, found ${rails.length}`);
  return rails[0];
}

function opsRailRows(page) {
  const rows = {};
  for (const node of findByAttr(opsRail(page), 'data-ops-rail-field')) {
    rows[node.attrs['data-ops-rail-field']] = node.textContent;
  }
  return rows;
}

const RAIL_UNBOUND = 'Not recorded — no canonical run is bound to this deck.';
const RAIL_ROUTE = { model: 'claude-opus-5', execution: 'claude-cli', source: 'tool-router.cjs routeRole' };
const RAIL_ROUTED_MODEL = 'claude-opus-5 (claude-cli)';

test('the live operations rail restates four already-resolved facts and owns no motion, clock or verdict', () => {
  const render = code.slice(code.indexOf('function renderHandoff'),
    code.indexOf('function renderFounderSummary'));
  const rail = render.slice(0, render.indexOf("el('div','handoff-recorded')"));
  assert.ok(rail.length > 0, 'no live operations rail is built ahead of the recorded-transition strip');
  // The four facts, in the order the rail exists to answer them in.
  const fields = [...rail.matchAll(/opsRailRow\(host, '([\w-]+)'/g)].map((m) => m[1]);
  assert.deepStrictEqual(fields, ['working', 'owner', 'action', 'handoff'],
    `the rail lost, added or reordered one of the four facts it answers: ${fields.join(', ') || 'none'}`);
  // One rail, and the recorded-transition strip is seated inside it rather than
  // beside it: two surfaces holding the same transition are two answers waiting
  // to disagree.
  assert.strictEqual((code.match(/el\('div','ops-rail'\)/g) || []).length, 1,
    'a second place on the page builds a live operations rail');
  assert.strictEqual((code.match(/function renderHandoff\b/g) || []).length, 1,
    'the rail has more than one renderer');
  assert.ok(/var host = el\('div','ops-rail'\);/.test(rail) && /deck\.appendChild\(host\);/.test(rail),
    'the rail is not the element the deck receives, so the strip is not inside it');
  assert.ok(/host\.appendChild\(strip\)/.test(render),
    'the recorded-transition strip is no longer seated in the rail that holds it');
  // Every value is a re-read of a resolution this page already owns.
  for (const canonical of ['supervisionEvidence(run)', 'WORKER_PRESENCE_PLAIN[supervision.presence]',
    'builderIdentity(run)', 'supervision.activity', 'handoffActor(moved.from, run)',
    'handoffActor(moved.to, run)']) {
    assert.ok(rail.includes(canonical), `the rail no longer restates the canonical ${canonical}`);
  }
  // It observes nothing of its own, and it reaches no gate, review or
  // checkpoint conclusion — those have their own authorities elsewhere.
  for (const banned of ['setInterval', 'setTimeout', 'requestAnimationFrame', 'Date.now', 'new Date',
    'Math.', 'fetch(', 'innerHTML', '.push(', 'verdict', 'problems', 'subjectSha256',
    'checkpointEvidence', 'reviewerCompleteness']) {
    assert.ok(!rail.includes(banned),
      `the rail uses ${banned} — it may only re-read facts the deck already resolved`);
  }
  // Absence is stated, never blanked: each of the four rows has a sentence for
  // the case where the canonical field it reads is not recorded.
  assert.ok(rail.includes(RAIL_UNBOUND), 'an unbound deck would render the rail blank instead of saying so');
  assert.ok(rail.includes('Not recorded — no bounded builder activity evidence is recorded for this run.') &&
    rail.includes('Not recorded — no canonical handoff is proven for this run.'),
    'a missing activity or an unproven handoff would render as an empty row');
  // The one thing that moves on this page is the AEGIS Core evidence cue. The
  // rail owns no animation and no transition, so reduced motion has nothing of
  // the rail's to undo, and nothing is clamped out of sight either.
  // The end marker is searched from the rail's own start: .founder-details{ also
  // appears earlier in the sheet, and an unanchored lookup slices backwards to an
  // empty string that would satisfy every 'the rail has no X' check below.
  const railCssStart = code.indexOf('.ops-rail{');
  assert.notStrictEqual(railCssStart, -1, 'the live operations rail style block does not begin at .ops-rail{');
  const railCssEnd = code.indexOf('.founder-details{', railCssStart);
  assert.notStrictEqual(railCssEnd, -1, 'the live operations rail style block does not end before .founder-details{');
  const railCss = code.slice(railCssStart, railCssEnd);
  assert.ok(railCss.trim().length > 0, 'the live operations rail style block is empty');
  assert.ok(!/@keyframes/.test(railCss) && !/\banimation\s*:/.test(railCss) &&
    !/\btransition\s*:/.test(railCss),
    'the rail introduced motion of its own — the AEGIS Core evidence cue is the only thing that may move');
  assert.ok(!/display:none|-webkit-line-clamp|text-overflow/.test(railCss),
    'part of the rail is hidden or truncated instead of wrapped, which removes evidence from the screen');
  assert.ok(/\.ops-rail-value\{[^}]*overflow-wrap:anywhere/.test(railCss),
    'a long receipt time or activity sentence can push a narrow viewport sideways instead of wrapping');
});

test('DOM: an unbound deck renders the rail as four honest absences and a silent strip', () => {
  const page = bootPage(fixtureState());
  const rows = opsRailRows(page);
  assert.deepStrictEqual(Object.keys(rows), ['working', 'owner', 'action', 'handoff'],
    `the rail does not read as its four canonical rows: ${Object.keys(rows).join(', ') || 'none'}`);
  for (const [field, label] of [['working', 'WORKING NOW'], ['owner', 'MODEL IN CHARGE'],
    ['action', 'LAST RECORDED ACTION'], ['handoff', 'LAST PROVEN HANDOFF']]) {
    assert.strictEqual(rows[field], label + RAIL_UNBOUND,
      `the ${field} row claimed something with no run bound: ${rows[field]}`);
  }
  assert.strictEqual(opsRail(page).attrs['data-ops-rail-presence'], 'NOT_RUNNING',
    'the rail recorded a worker presence with no run bound');
  assert.strictEqual(opsRail(page).attrs['data-ops-rail-handoff'], 'NOT_PROVEN',
    'the rail recorded a handoff with no run bound');
  // The strip is the rail's last row and is still hidden and silent.
  const strip = handoffNode(page);
  assert.ok(opsRail(page).children.includes(strip),
    'the recorded-transition strip is not seated inside the rail');
  assert.strictEqual(strip.hidden, true, 'the inactive strip must be hidden, not merely empty');
  assert.strictEqual(strip.textContent, '', 'the inactive strip must say nothing at all');
});

test('DOM: a running builder rail names presence, the model and the recorded action with its receipt time', () => {
  const page = liveActivityPage(RECORDED_ACTIVITY_SUPERVISION);
  const rows = opsRailRows(page);
  assert.strictEqual(rows.working, 'WORKING NOWThe worker is running now.',
    `the rail does not state whether anything is working now: ${rows.working}`);
  // This run record carries no route and no builder identity, so the rail says
  // so rather than inferring an owner from the fact that a build is running.
  assert.strictEqual(rows.owner,
    'MODEL IN CHARGEthe governed builder — model identity UNAVAILABLE in current status evidence',
    `the rail inferred a model the run record does not name: ${rows.owner}`);
  assert.strictEqual(rows.action,
    'LAST RECORDED ACTIONReading files in the worktree — activity evidence recorded 2026-09-03T14:09:45.000Z.',
    `the last recorded action lost its plain English or its receipt time: ${rows.action}`);
  assert.strictEqual(rows.handoff, 'LAST PROVEN HANDOFFNot recorded — no canonical handoff is proven for this run.',
    `one sighting of a running build was reported as a handoff: ${rows.handoff}`);
  assert.strictEqual(opsRail(page).attrs['data-ops-rail-presence'], 'RUNNING');

  // A supervisor heartbeat with no recorded activity is liveness, never an
  // action: the presence row may say the worker is running while the action row
  // still refuses to name something no bounded evidence recorded.
  const beat = liveActivityPage(HEARTBEAT_ONLY_SUPERVISION);
  const beatRows = opsRailRows(beat);
  assert.strictEqual(beatRows.working, 'WORKING NOWThe worker is running now.',
    `the heartbeat fixture no longer records a running worker: ${beatRows.working}`);
  assert.strictEqual(beatRows.action,
    'LAST RECORDED ACTIONNot recorded — no bounded builder activity evidence is recorded for this run.',
    `a heartbeat was promoted into a recorded action: ${beatRows.action}`);
});

test('DOM: a proven transition names both ends on the rail and keeps the exact evidence on the strip', () => {
  const page = liveActivityPage(RECORDED_ACTIVITY_SUPERVISION);
  assert.strictEqual(opsRailRows(page).handoff,
    'LAST PROVEN HANDOFFNot recorded — no canonical handoff is proven for this run.',
    'precondition: one sighting of a running build is not a transition');
  renderMinimizedStatus(page, activityStatus(RECORDED_ACTIVITY_SUPERVISION, {
    run: { state: 'BUILT', updatedAt: '2026-09-03T14:12:00.000Z', transitions: 5, route: RAIL_ROUTE },
    build: { status: 'EXITED', exit: 0,
      activity: { active: false, phase: 'STOPPED', code: 'EXITED', summary: 'Worker exited.' } },
  }));
  const rows = opsRailRows(page);
  assert.strictEqual(rows.handoff,
    'LAST PROVEN HANDOFF' + RAIL_ROUTED_MODEL + ' → the deterministic checks',
    `the rail does not name the origin and the destination of the proven handoff: ${rows.handoff}`);
  assert.strictEqual(rows.working, 'WORKING NOWThe worker has stopped, so nothing is running now.',
    `a stopped worker was still reported as working: ${rows.working}`);
  assert.strictEqual(rows.owner, 'MODEL IN CHARGE' + RAIL_ROUTED_MODEL,
    `the rail dropped the canonical routed model: ${rows.owner}`);
  // A stopped worker still shows what it was last seen doing, and that reading
  // keeps its own receipt time rather than borrowing the present tense.
  assert.strictEqual(rows.action,
    'LAST RECORDED ACTIONReading files in the worktree — activity evidence recorded 2026-09-03T14:09:45.000Z.',
    `the last recorded action was rewritten when the worker stopped: ${rows.action}`);
  assert.strictEqual(opsRail(page).attrs['data-ops-rail-handoff'], 'PROVEN');
  // The exact canonical codes and the run-record time stay on the strip inside
  // the rail: the row is the summary, the strip is the evidence.
  assert.ok(opsRail(page).children.includes(handoffNode(page)),
    'the strip left the rail when the handoff was proven');
  assert.match(handoffParts(page).RECORDED,
    /canonical BUILDING → BUILT, run record written 2026-09-03T14:12:00\.000Z/,
    'the exact canonical states and the run-record time left the strip');
});

test('DOM: a newly proven handoff cues the core once, and no cue survives leaving the running state', () => {
  const page = liveActivityPage(RECORDED_ACTIVITY_SUPERVISION);
  // The build was already running when the page opened, so the first evidence
  // it resolves is history and is adopted silently.
  assert.strictEqual(coreCue(page), null, 'the opening snapshot animated the core');
  const moved = (state, updatedAt, transitions) => activityStatus(RECORDED_ACTIVITY_SUPERVISION, {
    run: { state, updatedAt, transitions, route: RAIL_ROUTE },
  });
  // Out of the running state entirely: the run is not active, so nothing may be cued.
  renderMinimizedStatus(page, moved('BUILD_CONTINUED', '2026-09-03T14:12:00.000Z', 5));
  assert.strictEqual(coreCue(page), null, 'a run that is not running was given a cue');
  // Back into BUILDING. The recorded activity evidence is byte-identical across
  // every push in this proof, so the proven handoff is the only new thing the
  // page has — and it is enough on its own.
  renderMinimizedStatus(page, moved('BUILDING', '2026-09-03T14:13:00.000Z', 6));
  const cued = coreCue(page);
  assert.ok(cued === 'a' || cued === 'b', `a newly proven handoff produced no core cue: ${cued}`);
  const rows = opsRailRows(page);
  assert.strictEqual(rows.action,
    'LAST RECORDED ACTIONReading files in the worktree — activity evidence recorded 2026-09-03T14:09:45.000Z.',
    `the activity evidence moved, so this proof no longer isolates the handoff: ${rows.action}`);
  assert.match(rows.handoff,
    new RegExp('the build continued stage — its owner is UNAVAILABLE in current status evidence → ' +
      escapeRegExp(RAIL_ROUTED_MODEL)),
    `the rail did not name both ends of the handoff the cue was fired for: ${rows.handoff}`);
  // A repaint of exactly the same evidence is not a second handoff: it neither
  // restarts the cue nor cuts the one already on screen short.
  renderMinimizedStatus(page, moved('BUILDING', '2026-09-03T14:13:00.000Z', 6));
  assert.strictEqual(coreCue(page), cued,
    'a repaint of unchanged evidence restarted or cancelled the core cue');
  // A handoff into a stopped worker is reported in words and cues nothing.
  renderMinimizedStatus(page, activityStatus(RECORDED_ACTIVITY_SUPERVISION, {
    run: { state: 'BUILT', updatedAt: '2026-09-03T14:14:00.000Z', transitions: 7, route: RAIL_ROUTE },
    build: { status: 'EXITED', exit: 0,
      activity: { active: false, phase: 'STOPPED', code: 'EXITED', summary: 'Worker exited.' } },
  }));
  assert.strictEqual(coreCue(page), null,
    'a handoff out of a stopped worker left the core claiming live worker evidence');
  assert.strictEqual(opsRailRows(page).handoff,
    'LAST PROVEN HANDOFF' + RAIL_ROUTED_MODEL + ' → the deterministic checks',
    'the proven handoff was lost along with the cue it must never have produced');
});

test('the core cue fires for new activity or a proven handoff, and for nothing else', () => {
  const fn = code.slice(code.indexOf('function coreEvidenceIdentity'),
    code.indexOf('function motionSuppressed'));
  assert.ok(fn.length > 0, 'the core cue evidence identity was not located');
  // The handoff half is the transition renderHandoff already proved. Observing
  // the run a second time here would be a second verdict about one fact.
  assert.ok(!/observeHandoff\s*\(/.test(fn),
    'the cue re-observes the run, so it could reach a second verdict about the same evidence');
  assert.ok(/handoffMoved\.runId === run\.runId/.test(fn),
    'a handoff proven for another run could still cue this one');
  assert.ok(/handoffMoved\.to === run\.state/.test(fn),
    'a stale handoff would keep cueing once the run has moved past it');
  // Neither half present is not news; it is the no-cue answer.
  assert.ok(/if \(!activity && !moved\) return null;/.test(fn),
    'the cue can fire with neither recorded activity nor a proven handoff behind it');
  // And the run must actually be active, on both readings the deck already owns.
  assert.ok(/operationalState\(run\)\.state !== 'RUNNING'/.test(fn) &&
    /facts\.presence !== 'RUNNING'/.test(fn),
    'the cue no longer requires the bound run to be actually running');
  assert.ok(/return run\.runId \+ '\|'/.test(fn),
    'the cue identity is not bound to the run it describes, so it could carry across runs');
});

test('the reduced-motion note describes the cue that exists instead of denying animation', () => {
  const note = /<span class="sr" id="motion-note">([\s\S]*?)<\/span>/.exec(htmlSrc());
  assert.ok(note, 'the reduced-motion screen-reader note was removed');
  const text = note[1].replace(/\s+/g, ' ').trim();
  assert.ok(!/no animation/i.test(text),
    'the note still tells a screen-reader operator this page has no animation, which is no longer true');
  assert.match(text, /AEGIS Core/, 'the note does not say where the one animation actually is');
  assert.match(text, /runs once when new recorded builder activity arrives/,
    'the note does not say what the cue means or when it fires');
  assert.match(text, /never loops, never runs on a timer/,
    'the note does not rule out the decorative loop this page refuses to ship');
  assert.match(text, /reports no verdict/,
    'the note lets the cue be read as a review or gate outcome');
  assert.match(text, /written out in words as well/,
    'the note does not say the same evidence is readable without the motion');
  assert.match(text, /Reduced motion suppresses that highlight/,
    'the note no longer states that the control suppresses the cue it just described');
});

test('DOM: no raw builder output reaches the page through the activity surface', () => {
  const run = liveActivityRun(RECORDED_ACTIVITY_SUPERVISION);
  // Exactly the fields a compromised or careless worker record could carry.
  Object.assign(run.build, {
    stdoutTail: HOSTILE_WORKER_OUTPUT.source + '\n' + HOSTILE_WORKER_OUTPUT.pem,
    stderrTail: HOSTILE_WORKER_OUTPUT.jwt,
    rawOutput: HOSTILE_WORKER_OUTPUT.unlabelled,
  });
  const page = bootPage(fixtureState({
    generatedAt: '2026-09-03T14:10:00.000Z',
    runs: { state: 'OK', runs: [run], current: {
      state: 'BOUND', runId: run.runId, updatedAt: run.updatedAt, reason: 'exact current run is bound',
    } },
  }));
  const rendered = ['founder-body', 'runs-list', 'evidence-rail-body', 'ops-strip-cells']
    .map((id) => page.text(id)).join(' ');
  for (const [kind, sentinel] of Object.entries(HOSTILE_WORKER_OUTPUT)) {
    assert.ok(!rendered.includes(sentinel), `the rendered page leaked ${kind} worker output`);
  }
  assert.match(rendered, /Reading files in the worktree/,
    'the bounded activity category must still reach the page beside the refused raw output');
});

// ── observed-then vs running-now ───────────────────────────────────────────
// The same recorded activity and the same canonical timestamps, under a
// running worker and under a stopped one. A BUILD_FAILED attempt must still
// show what it was last seen doing — losing that evidence is its own defect —
// but it may not read as work in progress, and "running now" is granted only
// on validated active worker evidence.
function stoppedActivityRun(overrides) {
  const run = liveActivityRun(RECORDED_ACTIVITY_SUPERVISION);
  run.state = 'BUILD_FAILED';
  Object.assign(run.build, {
    status: 'FAILED', exit: 1, endedAt: '2026-09-03T14:10:00.000Z',
    activity: { active: false, phase: 'STOPPED', code: 'FAILED', summary: 'Builder exited' },
  }, overrides || {});
  return run;
}

test('DOM: the same observed activity reads as history on a stopped run and as now on a running one', () => {
  const running = builderProgressCard(liveActivityPage(RECORDED_ACTIVITY_SUPERVISION)).textContent;
  const stoppedRun = stoppedActivityRun();
  const stopped = builderProgressCard(bootPage(fixtureState({
    generatedAt: '2026-09-03T14:10:00.000Z',
    runs: { state: 'OK', runs: [stoppedRun], current: {
      state: 'BOUND', runId: stoppedRun.runId, updatedAt: stoppedRun.updatedAt,
      reason: 'exact current run is bound',
    } },
  }))).textContent;

  // The evidence itself, verbatim and identically timed, on both.
  for (const kept of [
    /Last observed activity: Reading files in the worktree — activity evidence recorded 2026-09-03T14:09:45\.000Z\./,
    /Last observed progress: Builder is emitting model and tool stream activity — last real progress 2026-09-03T14:09:50\.000Z\./,
    /Supervisor heartbeat 2026-09-03T14:09:59\.000Z is liveness only, never progress\./,
  ]) {
    assert.match(running, kept, `a running worker lost recorded evidence: ${kept}`);
    assert.match(stopped, kept, `a stopped worker lost recorded evidence: ${kept}`);
  }
  // Only the lifecycle reading differs, and only one of them may say "now".
  assert.match(running, /The worker is running now\./,
    'a validated active worker did not say it is running now');
  assert.match(stopped, /The worker has stopped, so nothing is running now\./,
    'a BUILD_FAILED attempt did not state that nothing is running now');
  assert.doesNotMatch(stopped, /The worker is running now/,
    'a stopped worker was presented as currently running');
});

test('supervisionFacts: present-tense worker wording is granted only by validated lifecycle', () => {
  const resolve = bootPage(fixtureState()).sandbox.AEGIS_DASHBOARD.supervisionFacts;
  const facts = (build) => resolve(build);
  const base = () => liveActivityRun(RECORDED_ACTIVITY_SUPERVISION).build;

  assert.strictEqual(facts(base()).presence, 'RUNNING');
  for (const status of ['FAILED', 'EXITED', 'CANCELLED', 'ORPHANED']) {
    assert.strictEqual(facts(stoppedActivityRun({ status, exit: null }).build).presence, 'STOPPED',
      `a ${status} worker was not read as stopped`);
  }
  // A terminal exit or a recorded timeout under a still-RUNNING status is the
  // contradiction case: stopped, never running.
  assert.strictEqual(facts(Object.assign(base(), { exit: 3 })).presence, 'STOPPED');
  assert.strictEqual(facts(Object.assign(base(), { timedOut: true })).presence, 'STOPPED');
  // Claimed but not yet working, and active worker evidence that never arrived.
  assert.strictEqual(facts(Object.assign(base(), {
    status: 'LAUNCH_CLAIMED', activity: { active: false, phase: 'CLAIMED', code: 'LAUNCH_CLAIMED' },
  })).presence, 'WAITING');
  assert.strictEqual(facts(Object.assign(base(), { activity: null })).presence, 'UNVERIFIED');
  assert.match(facts(Object.assign(base(), { activity: null })).headline,
    /Whether the worker is running now is UNVERIFIED/,
    'an unverified worker borrowed the present tense');
  // Heartbeat-only evidence stays unrecorded, whatever the lifecycle says.
  const quiet = Object.assign(base(), { supervision: HEARTBEAT_ONLY_SUPERVISION });
  assert.strictEqual(facts(quiet).activity, null);
  assert.ok(facts(quiet).detail.some((line) => /^Last observed activity: NOT RECORDED/.test(line)),
    'a heartbeat-only attempt did not state its activity as unrecorded');
});

// ── FINDING #7 RED PROOF: the summary must REPAINT from the live stream ────
// The panel used to render once from the generated snapshot and never again,
// so a founder watching the page saw an old objective and an old verdict
// presented as current. This drives the page exactly as the server does: an
// authenticated /api/status bootstrap, then a pushed `status` SSE event.
async function asyncTests() {
  await atest('DOM: missing state.js paints UNAVAILABLE immediately and authenticated live status repopulates the pilot deck', async () => {
    const subject = '9'.repeat(64);
    const run = {
      runId: 'RUN-LIVE-NO-SNAPSHOT', state: 'BUILDING',
      objective: 'Render the authenticated live mission without a generated snapshot',
      updatedAt: '2026-08-30T16:40:00.000Z',
      route: { model: 'claude', execution: 'SUBSCRIPTION', source: 'tool-router.cjs routeRole' },
      build: {
        mode: 'async', status: 'RUNNING', workerState: 'RUNNING', workerPid: 4210,
        startedAt: '2026-08-30T16:39:00.000Z', heartbeatAt: '2026-08-30T16:39:59.000Z',
        endedAt: null, exit: null, timedOut: false, cancelAvailable: true,
        activity: { active: true, phase: 'BUILDING', code: 'RUNNING', summary: 'Claude is implementing the live dashboard repair.' },
      },
    };
    const status = {
      generatedAt: run.updatedAt, runsState: 'OK',
      engineering: {
        state: 'OK', verdict: 'BLOCKED', subjectSha256: subject,
        problems: [{ rule: 'ENGOS-REVIEW-MISSING', detail: 'Independent review is still required.' }],
        reviewerCompleteness: { complete: false, rows: [] }, stages: [],
      },
      runs: [run],
      runsBinding: {
        state: 'BOUND', runId: run.runId, updatedAt: run.updatedAt, evidenceState: 'OK',
        subjectState: 'UNLINKED', subjectSha256: null, gateSubjectSha256: subject,
        reason: 'the authenticated live status selected this current run',
      },
      integration: { connectors: { state: 'OK', connectors: [] } },
      reviewers: [], events: [], cost: { state: 'UNAVAILABLE', reason: 'no cost receipt' },
    };
    let resolveBootstrap;
    const page = bootPage(null, { fetch: () => new Promise((resolve) => { resolveBootstrap = resolve; }) });

    assert.ok(page.sandbox.AEGIS_DASHBOARD,
      'the renderer seam was not exported when the generated state was absent');
    assert.strictEqual(typeof page.sandbox.AEGIS_DASHBOARD.applyStatus, 'function',
      'the authenticated live repaint seam was not installed');
    assert.match(page.text('fatal'), /UNAVAILABLE — no AEGIS state is loaded/);
    for (const id of ['founder-body','hud-mission','hud-crew','hud-review','hud-gate','hud-evidence','hud-checkpoint']) {
      assert.doesNotMatch(page.text(id), /Loading/i, `${id} retained a loading placeholder without state.js`);
    }
    assert.match(page.text('founder-body'), /UNAVAILABLE/i,
      'the immediate founder view did not fail closed');

    resolveBootstrap({ ok: true, json: async () => status });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    assert.match(page.text('founder-body'), /Render the authenticated live mission/i,
      'authenticated /api/status did not repopulate the founder mission');
    assert.strictEqual(page.text('hud-core-status'), RUN_STATE_PLAIN.RUNNING);
    assert.match(page.text('hud-crew'), /claude/i,
      'authenticated route evidence did not repopulate the crew instrument');
    assert.match(page.text('fatal'), /LIVE STATUS ACTIVE — generated state\.js is unavailable/,
      'the stale no-evidence warning remained after authenticated live state arrived');
    assert.doesNotMatch(page.text('founder-body'), /Loading/i);
  });

  await atest('DOM: missing state.js and unavailable live API leave every primary instrument fail-closed, never loading', async () => {
    const page = bootPage(null, { fetch: async () => { throw new Error('live status unavailable'); } });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    assert.ok(page.sandbox.AEGIS_DASHBOARD,
      'the renderer seam disappeared when both state sources were unavailable');
    assert.match(page.text('fatal'), /UNAVAILABLE — no AEGIS state is loaded/);
    assert.match(page.text('live-conn-state'), /UNAVAILABLE — could not bootstrap \/api\/status/);
    assert.match(page.text('founder-body'), /UNAVAILABLE/i);
    assert.strictEqual(page.text('hud-core-status'), RUN_STATE_PLAIN.UNAVAILABLE);
    assert.match(page.text('runs-list'), /Run history UNAVAILABLE/i);
    assert.doesNotMatch(page.text('runs-list'), /No runs yet/i,
      'two unavailable state sources fabricated a clean empty run ledger');
    for (const id of ['founder-body','hud-mission','hud-crew','hud-review','hud-gate','hud-evidence','hud-checkpoint']) {
      assert.doesNotMatch(page.text(id), /Loading/i, `${id} retained a loading placeholder after both sources failed`);
    }
  });

  await atest('DOM: run history uses generated state while live status is unavailable and never invents an empty ledger', async () => {
    const run = {
      runId: 'RUN-GENERATED-ONLY', state: 'BUILDING',
      objective: 'Keep generated run evidence visible during live API failure',
      updatedAt: '2026-08-30T16:50:00.000Z',
      build: { mode: 'async', status: 'RUNNING', exit: null, retrySafe: null,
        activity: { code: 'RUNNING', phase: 'RUNNING', active: true,
          summary: 'Builder is running from generated evidence' } },
    };
    const state = fixtureState({
      runs: { state: 'OK', runs: [run], current: {
        state: 'BOUND', runId: run.runId, updatedAt: run.updatedAt, evidenceState: 'OK',
        reason: 'generated state selected the current run',
      } },
    });
    const page = bootPage(state, { fetch: async () => { throw new Error('live status unavailable'); } });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    assert.match(page.text('runs-list'), /RUN-GENERATED-ONLY/,
      'the generated run was erased before authenticated live evidence arrived');
    assert.match(page.text('runs-list'), /Keep generated run evidence visible/);
    assert.doesNotMatch(page.text('runs-list'), /No runs yet|Run history UNAVAILABLE/i,
      'available generated run evidence was replaced with a false empty/unavailable ledger');
  });

  await atest('DOM: pre-host CHECKS_PASSED is visibly snapshot-pass plus mandatory-host PENDING', async () => {
    const subject = 'd'.repeat(64);
    const hostReason = 'Snapshot checks passed. Mandatory host containment is pending until exact-subject review completes.';
    const run = {
      runId: 'RUN-HOST-PENDING', state: 'CHECKS_PASSED', objective: 'Prove host containment truth',
      updatedAt: '2026-08-30T12:30:00.000Z',
      checks: {
        passed: 4, total: 4, outcome: 'SNAPSHOT_PASS_HOST_PENDING', snapshotOutcome: 'PASS',
        hostContainmentState: 'PENDING', hostContainmentReason: hostReason,
      },
    };
    const status = {
      generatedAt: run.updatedAt,
      runsState: 'OK',
      engineering: {
        state: 'OK', verdict: 'READY_FOR_DETERMINISTIC_VALIDATION', lane: 'FULL', highRisk: true,
        subjectSha256: subject, problems: [], reviewerCompleteness: { complete: false, rows: [] },
        stages: [{ id: 6, step: 'deterministic-checks', label: 'Deterministic checks',
          state: 'UNVERIFIED', reason: 'Snapshot checks passed; mandatory host containment is pending.' }],
      },
      runs: [run],
      runsBinding: {
        state: 'BOUND', runId: run.runId, updatedAt: run.updatedAt,
        subjectState: 'UNLINKED', subjectSha256: null, runSubjectSha256: null,
        gateSubjectSha256: subject, reason: 'bound to current run',
      },
      cost: { state: 'UNAVAILABLE', reason: 'cost not recorded' },
      integration: { connectors: { state: 'OK', connectors: [] } },
      reviewers: [], events: [],
    };
    const page = bootPage(fixtureState(), { status });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    const fields = findByAttr(page.document.getElementById('founder-body'), 'data-operator-field');
    const current = fields.find((node) => node.attrs['data-operator-field'] === 'current-action');
    assert.match(current.textContent, new RegExp(hostReason.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      'CURRENT ACTION collapsed the two-part check state into an unqualified pass');
    assert.match(page.text('runs-list'), /SNAPSHOT_PASS_HOST_PENDING/);
    assert.match(page.text('runs-list'), /Mandatory host containment is pending/);
    assert.doesNotMatch(page.text('founder-body'), /final required evidence/i,
      'the primary pilot deck called pre-host checks final');
    assert.strictEqual(page.text('hud-core-status'), RUN_STATE_PLAIN.WAITING);
  });

  await atest('DOM: unverified check counters never render snapshot PASS prose', async () => {
    const subject = 'e'.repeat(64);
    const run = {
      runId: 'RUN-HOST-UNVERIFIED', state: 'CHECKS_PASSED', objective: 'Reject mutable pass counters',
      updatedAt: '2026-08-30T12:31:00.000Z',
      checks: {
        passed: 4, total: 4, outcome: 'UNVERIFIED', snapshotOutcome: 'UNVERIFIED',
        hostContainmentState: 'PENDING', hostContainmentReason: null,
      },
    };
    const status = {
      generatedAt: run.updatedAt, runsState: 'OK',
      engineering: {
        state: 'OK', verdict: 'READY_FOR_PR', subjectSha256: subject,
        subjectPaths: ['builder-control/dashboard/index.html'], problems: [], stages: [],
        reviewerCompleteness: {
          complete: true, subjectSha256: subject, required: ['codex'],
          pathCoverage: { total: 1,
            coveredByEveryRequiredReviewer: ['builder-control/dashboard/index.html'],
            notCoveredByEveryRequiredReviewer: [] },
          rows: [{ reviewer: 'codex', required: 'REQUIRED', executed: 'EXECUTED',
            disposition: 'APPROVE', coveredPaths: ['builder-control/dashboard/index.html'],
            missingPaths: [], stalePaths: [] }],
        },
      },
      runs: [run],
      runsBinding: { state: 'BOUND', runId: run.runId, updatedAt: run.updatedAt,
        subjectState: 'UNLINKED', gateSubjectSha256: subject, reason: 'bound to current run' },
      cost: { state: 'UNAVAILABLE', reason: 'cost not recorded' },
      integration: { connectors: { state: 'OK', connectors: [] } }, reviewers: [], events: [],
    };
    const page = bootPage(fixtureState(), { status });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    const founder = page.text('founder-body');
    assert.match(founder, /canonical receipt and lifecycle evidence have not verified a passing outcome/i);
    assert.doesNotMatch(founder, /Snapshot checks passed|final required evidence/i);
    assert.doesNotMatch(founder, /appears ready for server verification/i,
      'equal mutable counters overrode the UNVERIFIED receipt outcome');
    assert.match(page.text('runs-list'), /UNVERIFIED/);
  });

  await atest('DOM: snapshot through live minimization preserves a fail-closed REVIEW_FAILED explanation', async () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-review-failure-compose-'));
    try {
      const runId = 'RUN-20260830-feed0001';
      const raw = {
        runId, state: 'REVIEW_FAILED', objective: 'Correct exact review findings',
        createdAt: '2026-08-30T12:00:00.000Z', updatedAt: '2026-08-30T12:01:00.000Z',
        packet: 'builder-control/packets/PKT-TEST.json', corrections: 0,
        reviewFailure: {
          schemaVersion: 1, status: 'REFUSED', reasonCode: 'EXACT_SUBJECT_REVIEW_REFUSED',
          subjectSha256: 'a'.repeat(64), checkReceiptSha256: 'b'.repeat(64),
          packet: { path: 'builder-control/packets/PKT-TEST.json', sha256: 'c'.repeat(64) },
          refusedAt: '2026-08-30T12:01:00.000Z', authority: 'engineering-os.cjs --gate-done',
          rejectedReviewers: [{ reviewer: 'codex', reviewId: 'REV-codex-current' }],
          blockingFindingCount: 1, refusalRuleCount: 2,
        },
      };
      fs.writeFileSync(path.join(temp, `${runId}.json`), JSON.stringify(raw));
      const snapshot = AegisState.snapshot({}, { runsDir: temp });
      const status = Hosting.minimizeApiStatus(snapshot);
      assert.deepStrictEqual(status.runs[0].reviewFailure, {
        status: 'UNVERIFIED', reasonCode: 'REVIEW_FAILURE_UNCORROBORATED',
        summary: 'The run records a review-failure claim, but attested exact-subject gate evidence is unavailable in this projection.',
      });
      const page = bootPage(fixtureState(), { status });
      for (let i = 0; i < 10; i++) await Promise.resolve();
      assert.match(page.text('runs-list'), /REVIEW_FAILED/);
      assert.match(page.text('founder-body'), /attested exact-subject gate evidence is unavailable/i);
      assert.ok(findByAttr(page.document.getElementById('founder-body'), 'data-command-control')
        .some((node) => node.attrs['data-command-control'] === 'retry'),
      'the composed fail-closed status lost bounded Retry');
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  });

  await atest('DOM: CHECKS_PASSED preserves named required-reviewer actions while the gate is blocked', async () => {
    const subject = 'f'.repeat(64);
    const run = { runId: 'RUN-NAMED-REVIEW', state: 'CHECKS_PASSED',
      objective: 'Obtain exact reviewer evidence', updatedAt: '2026-08-30T12:32:00.000Z',
      checks: { passed: 4, total: 4, outcome: 'PASS', snapshotOutcome: 'PASS' } };
    const status = {
      generatedAt: run.updatedAt, runsState: 'OK',
      engineering: { state: 'OK', verdict: 'BLOCKED', subjectSha256: subject,
        problems: [{ rule: 'ENGOS-REVIEW-MISSING', detail: 'required reviews are missing' }],
        reviewerCompleteness: { subjectSha256: subject, complete: false, rows: [
          { reviewer: 'codex', required: 'REQUIRED', executed: 'MISSING', missingPaths: [] },
          { reviewer: 'grok', required: 'REQUIRED', executed: 'MISSING', missingPaths: [] },
        ] }, stages: [] },
      runs: [run],
      runsBinding: { state: 'BOUND', runId: run.runId, updatedAt: run.updatedAt,
        subjectState: 'UNLINKED', gateSubjectSha256: subject, reason: 'bound to current run' },
      integration: { connectors: { state: 'OK', connectors: [] } }, reviewers: [], events: [],
    };
    const page = bootPage(fixtureState(), { status });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    const next = findByAttr(page.document.getElementById('founder-body'), 'data-operator-field')
      .find((node) => node.attrs['data-operator-field'] === 'next-step').textContent;
    assert.match(next, /Get codex to review this exact change/);
    assert.match(next, /Get grok to review this exact change/);
    assert.doesNotMatch(next, /^Resolve the recorded blocker before continuing\.$/);
  });

  await atest('DOM: authenticated checkpoint status and a later SSE checkpoint repaint share one safe formatter', async () => {
    const subject = 'c'.repeat(64);
    const statusFor = (runId, checkpoint, rollbackPoint, generatedAt) => ({
      generatedAt,
      runsState: 'OK',
      engineering: {
        state: 'OK', verdict: 'READY_FOR_PR', lane: 'FULL', highRisk: true,
        subjectSha256: subject, problems: [], reviewerCompleteness: null, stages: [],
      },
      runs: [{
        runId, state: 'CHECKPOINTED', objective: 'Preserve the safe checkpoint',
        checkpoint, rollbackPoint, updatedAt: generatedAt,
      }],
      runsBinding: {
        state: 'BOUND', runId, updatedAt: generatedAt, evidenceState: 'OK',
        subjectState: 'BOUND', subjectSha256: subject,
        runSubjectSha256: subject, gateSubjectSha256: subject,
        reason: 'the run and gate subjects match',
      },
      cost: { state: 'UNAVAILABLE', reason: 'cost not recorded' },
      integration: { connectors: { state: 'OK', connectors: [] } },
      reviewers: [], events: [],
    });

    const rollbackA = 'a'.repeat(40);
    const rollbackB = 'b'.repeat(40);
    const bootstrap = statusFor('RUN-CP-A', 'CHK-A', rollbackA, '2026-08-29T01:00:00.000Z');
    const page = bootPage(fixtureState(), { status: bootstrap });
    for (let i = 0; i < 10; i++) await Promise.resolve();

    assert.ok(page.sse.opened && page.sse.listeners.status && page.sse.listeners.status.length,
      'authenticated checkpoint bootstrap threw before the SSE subscription opened');
    assert.doesNotThrow(() => page.sandbox.AEGIS_DASHBOARD.renderRuns(
      bootstrap.runs, bootstrap.runsBinding, false),
    'renderRuns threw while interpreting the public checkpoint and rollbackPoint');
    assert.doesNotThrow(() => page.sandbox.AEGIS_DASHBOARD.applyStatus(bootstrap),
      'applyStatus threw while repainting the authenticated checkpoint payload');
    assert.ok(page.text('runs-list').includes('Checkpoint CHK-A · rollback commit ' + rollbackA),
      'the live run card did not render the public checkpoint receipt');

    const pushed = statusFor('RUN-CP-B', 'CHK-B', rollbackB, '2026-08-29T01:01:00.000Z');
    page.sse.listeners.status.forEach((fn) => fn({ data: JSON.stringify(pushed) }));
    assert.ok(/RUN-CP-B/.test(page.text('runs-list')) &&
      page.text('runs-list').includes('Checkpoint CHK-B · rollback commit ' + rollbackB),
    'the subsequent SSE checkpoint repaint did not continue through the shared formatter');
    assert.ok(page.text('founder-body').includes('Checkpoint CHK-B · rollback commit ' + rollbackB),
      'the pilot instruments and run card diverged after the SSE repaint');
  });

  await atest('RED: the complete page script survives bootstrap and an SSE push repaints connectors, summary, runs and cost', async () => {
    const oldConnector = connectorFixture({ state: 'UNAVAILABLE' });
    const bootstrapStatus = {
      generatedAt: '2026-08-27T10:00:00.000Z',
      engineering: { state: 'OK', verdict: 'BLOCKED', lane: 'FULL', highRisk: true,
        laneWhy: ['review pending'], riskReasons: ['protected change'], subjectSha256: 'old111111111aaaa',
        problems: [], reviewerCompleteness: null, stages: [] },
      runs: [{ runId: 'RUN-OLD', state: 'BUILDING', objective: 'OLD OBJECTIVE',
        updatedAt: '2026-08-27T09:59:00.000Z' }],
      runsBinding: { state: 'BOUND', runId: 'RUN-OLD', updatedAt: '2026-08-27T09:59:00.000Z',
        subjectSha256: 'old111111111aaaa', objective: 'OLD OBJECTIVE', reason: 'bound' },
      cost: { state: 'UNAVAILABLE', reason: 'cost pending' },
      integration: { connectors: { state: 'OK', connectors: [oldConnector] } },
    };
    const page = bootPage(fixtureState(), { status: bootstrapStatus });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    assert.ok(page.sse.listeners.status && page.sse.listeners.status.length,
      'the complete script did not reach the SSE subscription after bootstrap');

    const pushed = JSON.parse(JSON.stringify(bootstrapStatus));
    pushed.generatedAt = '2026-08-27T10:01:00.000Z';
    pushed.engineering.verdict = 'READY_FOR_PR';
    pushed.engineering.subjectSha256 = 'new222222222bbbb';
    pushed.runs = [{ runId: 'RUN-NEW', state: 'BUILT', objective: 'NEW OBJECTIVE',
      updatedAt: '2026-08-27T10:01:00.000Z' }];
    pushed.runsBinding = { state: 'BOUND', runId: 'RUN-NEW', updatedAt: '2026-08-27T10:01:00.000Z',
      subjectSha256: 'new222222222bbbb', objective: 'NEW OBJECTIVE', reason: 'bound' };
    pushed.cost = { state: 'OK', recordedUsdDisplay: 7.25, totalUsd: 7.25, recordedRuns: 1,
      unrecordedRuns: 0, caveat: null, byReviewer: {},
      cad: { state: 'OK', totalCad: 'AT LEAST 9.93', rate: 1.37, asOf: '2026-08-27',
        fxSource: 'test evidence', source: 'builder-control/fx-canon.json' } };
    pushed.integration.connectors.connectors[0].lastUsedByRun = {
      state: 'USED', runId: 'RUN-NEW', observedAt: '2026-08-27T10:00:59.000Z', ledgerConfirmed: true,
    };
    page.sse.listeners.status.forEach((fn) => fn({ data: JSON.stringify(pushed) }));

    assert.ok(/Used by this run \(RUN-NEW\)/.test(page.text('connectors')), 'connectors did not repaint');
    assert.ok(/NEW OBJECTIVE/.test(page.text('founder-body')), 'founder summary did not repaint');
    assert.ok(/new222222222/.test(page.text('ctx-subject')), 'header subject did not repaint');
    assert.ok(/2026-08-27T10:01:00\.000Z/.test(page.text('ctx-generated')), 'header generated time did not repaint');
    assert.ok(/WAITING/.test(page.text('ctx-verdict')) && !/BLOCKED/.test(page.text('ctx-verdict')),
      'header operational state did not replace the static snapshot state');
    assert.ok(/RUN-NEW/.test(page.text('runs-list')) && !/RUN-OLD/.test(page.text('runs-list')),
      'runs did not repaint');
    assert.ok(/CAD AT LEAST 9\.93/.test(page.text('cost')), 'cost did not repaint');
  });

  await atest('RED: two successive live payloads replace gate events, exact stages and reviewer evidence', async () => {
    const bootstrap = {
      generatedAt: '2026-08-27T12:00:00.000Z',
      engineering: { state: 'OK', verdict: 'BLOCKED', subjectSha256: 'base444444444dddd', stages: [] },
      runs: [], runsBinding: { state: 'UNAVAILABLE', reason: 'none' },
      integration: { connectors: { state: 'OK', connectors: [] } },
      reviewers: [], events: [],
    };
    const page = bootPage(fixtureState(), { status: bootstrap });
    for (let i = 0; i < 10; i++) await Promise.resolve();

    const first = JSON.parse(JSON.stringify(bootstrap));
    first.generatedAt = '2026-08-27T12:01:00.000Z';
    first.engineering.stages = [{ id: 'codex', step: 6, label: 'FIRST STAGE', state: 'MISSING', reason: 'FIRST REASON' }];
    first.reviewers = [{ toolId: 'codex-local', label: 'FIRST REVIEWER', role: 'first role', availability: 'AVAILABLE' }];
    first.events = [{ entryId: 'E-FIRST', ts: '2026-08-27T12:00:59.000Z', gate: 'FIRST GATE', status: 'FAILED' }];
    page.sse.listeners.status.forEach((fn) => fn({ data: JSON.stringify(first) }));
    assert.ok(/FIRST STAGE.*MISSING/.test(page.text('stages')), 'first stage payload did not render');
    assert.ok(/FIRST REVIEWER.*AVAILABLE.*MISSING/.test(page.text('reviewers')), 'first reviewer payload did not render with stage coverage');
    assert.ok(/FIRST GATE.*FAILED/.test(page.text('events')), 'first gate event did not render');

    const second = JSON.parse(JSON.stringify(bootstrap));
    second.generatedAt = '2026-08-27T12:02:00.000Z';
    second.engineering.stages = [{ id: 'codex', step: 6, label: 'SECOND STAGE', state: 'PASS', reason: 'SECOND REASON' }];
    second.reviewers = [{ toolId: 'codex-local', label: 'SECOND REVIEWER', role: 'second role', availability: 'UNAVAILABLE' }];
    second.events = [{ entryId: 'E-SECOND', ts: '2026-08-27T12:01:59.000Z', gate: 'SECOND GATE', status: 'PASS' }];
    page.sse.listeners.status.forEach((fn) => fn({ data: JSON.stringify(second) }));

    const stagesText = page.text('stages');
    const reviewersText = page.text('reviewers');
    const eventsText = page.text('events');
    assert.ok(/SECOND STAGE.*PASS/.test(stagesText) && !/FIRST STAGE|MISSING/.test(stagesText),
      `stage panel retained superseded evidence: ${stagesText}`);
    assert.ok(/SECOND REVIEWER.*UNAVAILABLE.*PASS/.test(reviewersText) && !/FIRST REVIEWER|AVAILABLEMISSING/.test(reviewersText),
      `reviewer panel retained superseded evidence: ${reviewersText}`);
    assert.ok(/SECOND GATE.*PASS/.test(eventsText) && !/FIRST GATE|FAILED/.test(eventsText),
      `event panel retained superseded evidence: ${eventsText}`);
  });

  await atest('RED: minimized live connector cards inspect through truthful snapshot fallbacks', async () => {
    const rich = connectorFixture({ state: 'UNAVAILABLE', plain: 'no usage evidence' });
    rich.authentication = { state: 'AUTHENTICATED', plain: 'Credential checked from dated evidence.' };
    rich.lastVerified = { state: 'FRESH', plain: 'Probe succeeded from dated evidence.' };
    rich.capabilities = ['read-status'];
    rich.declaredNotSupported = ['engineering-authority'];
    rich.authorityNote = 'Integration worker only.';
    const state = fixtureState({ integration: { connectors: { state: 'OK', connectors: [rich] } } });
    const live = {
      generatedAt: '2026-08-27T11:00:00.000Z',
      engineering: { state: 'OK', verdict: 'BLOCKED', subjectSha256: 'live333333333cccc', stages: [] },
      runs: [], runsBinding: { state: 'UNAVAILABLE', reason: 'none' },
      integration: { connectors: { state: 'OK', connectors: [{
        connectorId: rich.connectorId, label: rich.label, provider: rich.provider,
        executionPath: rich.executionPath, authStatus: rich.authStatus, health: rich.health,
        staleness: rich.staleness, lastUsedByRun: rich.lastUsedByRun,
      }] } },
    };
    const page = bootPage(state, { status: live });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    const cards = findByAttr(page.document.getElementById('integration-overview'), 'role');
    assert.strictEqual(cards.length, 1, 'expected one live connector card');
    cards[0]._listeners.click[0]();
    const body = page.text('inspector');
    assert.ok(/INTEGRATION — worker, never engineering authority/.test(body), 'snapshot plane fallback was not used');
    assert.ok(/Credential checked from dated evidence/.test(body), 'authentication evidence fallback was not used');
    assert.ok(/Probe succeeded from dated evidence/.test(body), 'verification evidence fallback was not used');
    assert.ok(/read-status/.test(body), 'capability fallback was not used');
    assert.ok(!/undefined|UNKNOWN/.test(body), `inspector exposed a missing-value placeholder despite available evidence: ${body}`);
  });

  await atest('DOM: Start reports accepted launch truth without claiming RUNNING early', async () => {
    const status = { generatedAt: '2026-08-26T12:00:00.000Z', engineering: { state: 'UNAVAILABLE' },
      runs: [], runsBinding: { state: 'UNAVAILABLE', reason: 'none' }, integration: { connectors: [] } };
    const calls = [];
    const page = bootPage(fixtureState(), { fetch: async (path, options) => {
      calls.push({ path, options });
      if (path === '/api/status') return { ok: true, json: async () => status };
      if (path === '/api/objective') return { ok: true, json: async () => ({
        runId: 'RUN-START', state: 'INTAKE_RECORDED' }) };
      if (path === '/api/start') return { ok: true, json: async () => ({
        runId: 'RUN-START', state: 'BUILDING', workerPid: 4321,
        builder: { provider: 'claude-subscription', model: 'opus' } }) };
      throw new Error('unexpected request ' + path);
    } });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    page.document.getElementById('in-objective').value = 'Build only the dashboard';
    page.document.getElementById('in-project').value = '';
    page.document.getElementById('in-constraints').value = '';
    page.document.getElementById('in-acceptance').value = '';
    page.document.getElementById('in-dataclass').value = '';
    const form = page.document.getElementById('intake-form');
    await form._listeners.submit[0]({ preventDefault() {} });
    const start = allNodes(page.document.getElementById('intake-result'))
      .find((n) => n.tagName === 'BUTTON' && /Start governed builder/.test(n.textContent));
    assert.ok(start, 'objective intake did not render the governed Start control');
    await start._listeners.click[0]();
    const message = page.text('intake-result');
    assert.ok(/Worker launch accepted: BUILDING/.test(message), `Start did not report accepted launch: ${message}`);
    assert.ok(/PID 4321/.test(message), 'Start did not render returned worker ownership evidence');
    assert.ok(/Live evidence will show when it reaches RUNNING/.test(message),
      'Start did not distinguish accepted launch from observed RUNNING evidence');
    assert.ok(!/Worker launched:|is running/.test(message),
      'Start claimed an active worker before canonical lifecycle evidence observed it');
    assert.ok(!/has NOT been launched|Worktree prepared at/.test(message),
      'retired synchronous Start messaging is still rendered');
    assert.strictEqual(calls.filter((c) => c.path === '/api/start').length, 1,
      'Start must issue exactly one launch request');
  });

  await atest('DOM: a restored INTAKE_RECORDED run starts once by canonical runId without recreating its objective', async () => {
    const restored = {
      generatedAt: '2026-08-30T18:00:00.000Z',
      engineering: { state: 'UNAVAILABLE' },
      runsBinding: { state: 'BOUND', runId: 'RUN-RESTORED-INTAKE', reason: 'bound' },
      integration: { connectors: [] },
      runs: [{
        runId: 'RUN-RESTORED-INTAKE',
        state: 'INTAKE_RECORDED',
        objective: 'Use the already-recorded objective exactly once',
        updatedAt: '2026-08-30T17:59:00.000Z',
      }],
    };
    const calls = [];
    let resolveStart;
    const startResponse = new Promise((resolve) => { resolveStart = resolve; });
    const page = bootPage(fixtureState(), { fetch: async (path, options) => {
      calls.push({ path, options });
      if (path === '/api/status') return { ok: true, json: async () => restored };
      if (path === '/api/start') {
        await startResponse;
        return { ok: true, json: async () => ({
          runId: 'RUN-RESTORED-INTAKE', state: 'BUILDING', workerPid: 9876,
          builder: { provider: 'claude-subscription', model: 'opus' },
        }) };
      }
      throw new Error('unexpected request ' + path);
    } });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    const start = allNodes(page.document.getElementById('runs-list'))
      .find((node) => node.tagName === 'BUTTON' && /Start governed builder/.test(node.textContent));
    assert.ok(start, 'restored INTAKE_RECORDED run did not render Start');
    const firstClick = start._listeners.click[0]();
    const duplicateClick = start._listeners.click[0]();
    resolveStart();
    await Promise.all([firstClick, duplicateClick]);
    const startCalls = calls.filter((call) => call.path === '/api/start');
    assert.strictEqual(startCalls.length, 1, 'restored Start issued duplicate launch requests');
    assert.deepStrictEqual(JSON.parse(startCalls[0].options.body), { runId: 'RUN-RESTORED-INTAKE' },
      'restored Start did not use the canonical runId directly');
    assert.strictEqual(calls.filter((call) => call.path === '/api/objective').length, 0,
      'restored Start recreated or duplicated the recorded objective');
    assert.ok(/Worker launch accepted: BUILDING/.test(page.text('live-activity')),
      'restored Start did not report the accepted asynchronous launch');
  });

  await atest('DOM: BUILT makes deterministic checks the only founder next step and keeps its control visible', async () => {
    const subject = 'a'.repeat(64);
    const built = {
      generatedAt: '2026-08-28T13:00:00.000Z',
      engineering: { state: 'OK', verdict: 'READY_FOR_PR', subjectSha256: subject,
        subjectPaths: ['builder-control/dashboard/index.html'], problems: [],
        reviewerCompleteness: { subjectSha256: subject, complete: false, rows: [{
          reviewer: 'grok', job: 'adversarial reviewer', required: 'REQUIRED',
          executed: 'MISSING', disposition: null, coveredPaths: [],
          missingPaths: ['builder-control/dashboard/index.html'], stalePaths: [],
        }] } },
      runsBinding: { state: 'BOUND', runId: 'RUN-BUILT-NEXT', subjectState: 'UNLINKED',
        gateSubjectSha256: subject, updatedAt: '2026-08-28T13:00:00.000Z', reason: 'bound' },
      integration: { connectors: [] },
      runs: [{ runId: 'RUN-BUILT-NEXT', state: 'BUILT', objective: 'Finish dashboard checks',
        updatedAt: '2026-08-28T13:00:00.000Z' }],
    };
    const page = bootPage(fixtureState(), { fetch: async (path) => {
      if (path === '/api/status') return { ok: true, json: async () => built };
      throw new Error('unexpected request ' + path);
    } });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    const founder = page.text('founder-body');
    assert.ok((founder.match(/Run deterministic checks on this completed build\./g) || []).length >= 2,
      `primary and expanded founder views do not agree on the BUILT action: ${founder}`);
    assert.ok(/The build finished and is waiting for deterministic checks/.test(founder),
      `BUILT current action is missing from the whole founder view: ${founder}`);
    assert.ok(!/Open the pull request|server verification|Get grok to review this exact change/.test(founder),
      `BUILT founder guidance leaked a later PR/review stage: ${founder}`);
    assert.ok(allNodes(page.document.getElementById('runs-list')).some((node) =>
      node.tagName === 'BUTTON' && node.textContent === 'Run deterministic checks' && node.disabled !== true),
    'BUILT did not retain the enabled deterministic-check control');
  });

  await atest('DOM: stale reviewer subject is never attributed as current-subject HUD or founder coverage', async () => {
    const currentSubject = 'a'.repeat(64);
    const staleSubject = 'b'.repeat(64);
    const status = {
      generatedAt: '2026-08-28T13:05:00.000Z',
      engineering: { state: 'OK', verdict: 'READY_FOR_PR', subjectSha256: currentSubject,
        subjectPaths: ['builder-control/dashboard/index.html'], problems: [],
        reviewerCompleteness: Object.assign({}, passingReviewCompleteness(staleSubject), {
          completeReason: 'Every required review has bound evidence for every changed file of the stale subject.',
        }) },
      runsBinding: { state: 'BOUND', runId: 'RUN-STALE-REVIEW', subjectState: 'BOUND',
        subjectSha256: currentSubject, runSubjectSha256: currentSubject,
        gateSubjectSha256: currentSubject, updatedAt: '2026-08-28T13:05:00.000Z', reason: 'bound' },
      integration: { connectors: [] },
      runs: [{ runId: 'RUN-STALE-REVIEW', state: 'REVIEW_BOUND', objective: 'Reject stale review attribution',
        subject: { subjectSha256: currentSubject }, updatedAt: '2026-08-28T13:05:00.000Z' }],
    };
    const page = bootPage(fixtureState(), { fetch: async (path) => {
      if (path === '/api/status') return { ok: true, json: async () => status };
      throw new Error('unexpected request ' + path);
    } });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    assert.strictEqual(page.text('hud-review-state'),
      REVIEW_COVERAGE_PLAIN['REVIEW EVIDENCE STALE OR MISMATCHED']);
    assert.strictEqual(page.document.getElementById('hud-review-state').attrs['data-hud-code'],
      'REVIEW EVIDENCE STALE OR MISMATCHED',
      'the HUD review footer dropped the exact coverage code behind its plain words');
    assert.ok(/different code subject.*not current coverage/.test(page.text('hud-review')),
      `HUD attributed stale reviewer rows to the current subject: ${page.text('hud-review')}`);
    const founder = page.text('founder-body');
    assert.ok(/recorded reviewer rows belong to a different code subject/i.test(founder),
      `expanded founder evidence does not explain the stale subject: ${founder}`);
    assert.ok(!/Every required review has bound evidence for every changed file|reviewed this exact version and approved/.test(founder),
      `expanded founder evidence attributed stale coverage to the current change: ${founder}`);
    assert.ok(!/1 of 1 required reviewer row\(s\) executed for the current gate subject/.test(
      page.text('operator-shell')),
    'whole operator view labels stale reviewer execution as current gate coverage');
  });

  await atest('DOM: deterministic checks are BUILT-only and repaint to CHECKS_PASSED only from SSE', async () => {
    const built = {
      generatedAt: '2026-08-27T16:00:00.000Z',
      engineering: { state: 'OK', verdict: 'READY_FOR_PR',
        reviewerCompleteness: { complete: true, rows: [{ reviewer: 'codex', required: 'REQUIRED',
          executed: 'EXECUTED', disposition: 'APPROVE', missingPaths: [] }] } },
      runsBinding: { state: 'BOUND', runId: 'RUN-CHECKS', updatedAt: '2026-08-27T16:00:00.000Z', reason: 'bound' },
      integration: { connectors: [] },
      runs: [{ runId: 'RUN-CHECKS', state: 'BUILT', objective: 'Dashboard checks',
        updatedAt: '2026-08-27T16:00:00.000Z' }],
    };
    const calls = [];
    const page = bootPage(fixtureState(), { fetch: async (path, options) => {
      calls.push({ path, options });
      if (path === '/api/status') return { ok: true, json: async () => built };
      if (path === '/api/checks') return { ok: true, json: async () => ({
        runId: 'RUN-CHECKS', state: 'CHECKS_PASSED', action: 'checks', checks: { passed: 1, total: 1 },
      }) };
      throw new Error('unexpected request ' + path);
    } });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    let nodes = allNodes(page.document.getElementById('runs-list'));
    const checks = nodes.find((n) => n.tagName === 'BUTTON' && n.textContent === 'Run deterministic checks');
    assert.ok(checks && checks.disabled !== true, 'BUILT must expose the enabled checks control');
    await checks._listeners.click[0]();
    assert.strictEqual(checks.disabled, true, 'checks control must remain disabled while awaiting authoritative repaint');
    assert.strictEqual(checks.textContent, 'Checks running…');
    const call = calls.find((c) => c.path === '/api/checks');
    assert.ok(call, 'checks control did not call the canonical HTTP route');
    assert.deepStrictEqual(JSON.parse(call.options.body), { runId: 'RUN-CHECKS' },
      'dashboard sent fields beyond the exact runId authority boundary');
    assert.ok(/waiting for live lifecycle evidence/.test(page.text('live-activity')),
      'the response was not treated as pending live lifecycle evidence');
    assert.ok(/BUILT/.test(page.text('runs-list')) && !/CHECKS_PASSED/.test(page.text('runs-list')),
      'the POST response optimistically repainted state before SSE evidence');

    const pushed = JSON.parse(JSON.stringify(built));
    pushed.generatedAt = '2026-08-27T16:00:01.000Z';
    pushed.runs[0].state = 'CHECKS_PASSED';
    pushed.runs[0].checks = { passed: 1, total: 1 };
    page.sse.listeners.status.forEach((fn) => fn({ data: JSON.stringify(pushed) }));
    nodes = allNodes(page.document.getElementById('runs-list'));
    assert.ok(/CHECKS_PASSED/.test(page.text('runs-list')), 'SSE did not repaint the passed-checks state');
    assert.ok(/checks: 1\/1/.test(page.text('runs-list')), 'SSE did not repaint deterministic evidence');
    assert.ok(!nodes.some((n) => n.tagName === 'BUTTON' && /deterministic checks/.test(n.textContent)),
      'the BUILT-only checks control survived after SSE advanced the run');
  });

  await atest('DOM: review verification is CHECKS_PASSED-only, bind-only, and repaints REVIEW_BOUND from SSE', async () => {
    const checked = {
      generatedAt: '2026-08-27T16:05:00.000Z',
      engineering: { state: 'OK', verdict: 'READY_FOR_PR', subjectSha256: 'a'.repeat(64),
        subjectPaths: ['builder-control/dashboard/index.html'], problems: [],
        reviewerCompleteness: passingReviewCompleteness() },
      runsBinding: { state: 'BOUND', runId: 'RUN-REVIEW', updatedAt: '2026-08-27T16:05:00.000Z',
        subjectState: 'UNLINKED', gateSubjectSha256: 'a'.repeat(64), reason: 'bound' },
      integration: { connectors: [] },
      runs: [{ runId: 'RUN-REVIEW', state: 'CHECKS_PASSED', objective: 'Bind existing review evidence',
        checks: { passed: 1, total: 1 }, updatedAt: '2026-08-27T16:05:00.000Z' }],
    };
    const calls = [];
    const page = bootPage(fixtureState(), { fetch: async (path, options) => {
      calls.push({ path, options });
      if (path === '/api/status') return { ok: true, json: async () => checked };
      if (path === '/api/review-bind') return { ok: true, json: async () => ({
        runId: 'RUN-REVIEW', state: 'REVIEW_BOUND', action: 'bind-independent-review', nextAction: 'checkpoint',
      }) };
      throw new Error('unexpected request ' + path);
    } });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    let nodes = allNodes(page.document.getElementById('runs-list'));
    const review = nodes.find((n) => n.tagName === 'BUTTON' && n.textContent === 'Verify independent review');
    assert.ok(review && review.disabled !== true, 'CHECKS_PASSED must expose review verification');
    // The boundary belongs to THIS action, not to the whole page. Since the run
    // card can also request a Codex review, a blanket "this dashboard cannot
    // get a review" would be a false statement printed beside a control that
    // does exactly that.
    assert.ok(/starts no new review and pays for nothing/.test(page.text('runs-list')),
      'the UI does not explain what verifying evidence does and does not do');
    assert.ok(/Requesting a review is a separate, explicit act/.test(page.text('runs-list')),
      'the UI does not distinguish verifying existing evidence from requesting a review');
    assert.ok(!/reviews run outside this .*dashboard|does not launch or pay for a review/
      .test(page.text('runs-list')),
    `the run card still claims this dashboard cannot obtain a review: ${page.text('runs-list')}`);
    await review._listeners.click[0]();
    assert.strictEqual(review.disabled, true, 'review verification must disable while awaiting lifecycle evidence');
    assert.strictEqual(review.textContent, 'Verifying review evidence…');
    const call = calls.find((c) => c.path === '/api/review-bind');
    assert.ok(call, 'review verification did not call the canonical HTTP route');
    assert.deepStrictEqual(JSON.parse(call.options.body), { runId: 'RUN-REVIEW' },
      'dashboard sent fields beyond exact runId authority boundary');
    assert.ok(/waiting for live lifecycle evidence/.test(page.text('live-activity')),
      'the bind response was not treated as pending SSE evidence');
    assert.ok(/Verifying started no review/.test(page.text('live-activity')),
      'the activity feed does not preserve the bind-only boundary');
    assert.ok(/CHECKS_PASSED/.test(page.text('runs-list')) && !/REVIEW_BOUND/.test(page.text('runs-list')),
      'the POST response optimistically repainted the run before SSE evidence');

    const pushed = JSON.parse(JSON.stringify(checked));
    pushed.generatedAt = '2026-08-27T16:05:01.000Z';
    pushed.runs[0].state = 'REVIEW_BOUND';
    page.sse.listeners.status.forEach((fn) => fn({ data: JSON.stringify(pushed) }));
    nodes = allNodes(page.document.getElementById('runs-list'));
    assert.ok(/REVIEW_BOUND/.test(page.text('runs-list')), 'SSE did not repaint the review-bound state');
    assert.ok(/checkpoint is the next stage/.test(page.text('runs-list')),
      'REVIEW_BOUND does not explain the next truthful stage');
    assert.ok(!nodes.some((n) => n.tagName === 'BUTTON' && /Verify independent review/.test(n.textContent)),
      'the CHECKS_PASSED-only action survived after SSE advanced the run');
    // The bound REVIEW_BOUND run may now ask AEGIS to RECORD its checkpoint —
    // and only that. The control that appears here writes no commit, starts no
    // review, restores nothing and deploys nothing, and it reached no route
    // simply by being offered.
    const offered = nodes.find((n) => n.tagName === 'BUTTON' && /checkpoint/i.test(n.textContent));
    assert.ok(offered && offered.textContent === 'Record checkpoint' && offered.disabled !== true,
      'the bound REVIEW_BOUND run exposes no explicit checkpoint control');
    assert.ok(/records where this reviewed run reached/.test(page.text('runs-list')),
      'the checkpoint control does not say plainly what recording a checkpoint is');
    assert.ok(/writes no commit, starts no review, restores no files and deploys nothing/
      .test(page.text('runs-list')),
    `the checkpoint control does not state what it cannot do: ${page.text('runs-list')}`);
    assert.ok(/must already be committed through the approved narrow external path/
      .test(page.text('runs-list')),
    'the checkpoint control does not state that the reviewed changes are committed elsewhere first');
    assert.ok(/AEGIS rechecks eligibility and may refuse/.test(page.text('runs-list')),
      'the checkpoint control presents the browser as the authority rather than the server');
    assert.strictEqual(calls.filter((c) => c.path === '/api/checkpoint').length, 0,
      'offering the checkpoint control reached the canonical checkpoint route');
  });

  // ── "Check review readiness": an ask, never a review ──────────────────────
  // The canonical route behind this control only READS. Every proof below has
  // to hold both halves of that: the operator learns what review is actually
  // needed, and asking launches nothing, binds nothing, spends nothing and
  // moves no run. An answer this page cannot read must land as readiness
  // UNAVAILABLE — never as an optimistic "nothing more is needed".
  function readinessStatus(runId, runState) {
    return {
      generatedAt: '2026-09-04T09:00:00.000Z', runsState: 'OK',
      engineering: { state: 'OK', verdict: 'READY_FOR_PR', subjectSha256: 'a'.repeat(64),
        subjectPaths: ['builder-control/dashboard/index.html'], problems: [],
        reviewerCompleteness: passingReviewCompleteness() },
      runsBinding: { state: 'BOUND', runId, updatedAt: '2026-09-04T09:00:00.000Z',
        subjectState: 'UNLINKED', gateSubjectSha256: 'a'.repeat(64), reason: 'bound' },
      integration: { connectors: [] },
      runs: [{ runId, state: runState || 'CHECKS_PASSED',
        objective: 'Ask what review this version still needs',
        checks: { passed: 2, total: 2, outcome: 'PASS' }, updatedAt: '2026-09-04T09:00:00.000Z' }],
    };
  }

  function readinessPage(status, answer) {
    const calls = [];
    const page = bootPage(fixtureState(), { fetch: async (requestPath, options) => {
      calls.push({ path: requestPath, options });
      if (requestPath === '/api/status') return { ok: true, json: async () => status };
      if (requestPath === '/api/review-preflight') return answer(options);
      throw new Error('unexpected request ' + requestPath);
    } });
    return { page, calls };
  }

  function readinessControl(page) {
    return allNodes(page.document.getElementById('runs-list'))
      .find((node) => node.tagName === 'BUTTON' && node.textContent === 'Check review readiness') || null;
  }

  function readinessLine(page) {
    return findByAttr(page.document.getElementById('runs-list'), 'data-review-readiness')[0] || null;
  }

  function runButtonLabels(page) {
    return allNodes(page.document.getElementById('runs-list'))
      .filter((node) => node.tagName === 'BUTTON').map((node) => node.textContent);
  }

  function preflightCalls(calls) {
    return calls.filter((call) => call.path === '/api/review-preflight');
  }

  await atest('DOM: review readiness is an explicit ask on the bound CHECKS_PASSED run and reaches no API until it is clicked', async () => {
    const status = readinessStatus('RUN-READY');
    const { page, calls } = readinessPage(status, () => {
      throw new Error('the page asked for readiness without an operator click');
    });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    const ask = readinessControl(page);
    assert.ok(ask && ask.disabled !== true,
      'the bound CHECKS_PASSED run exposes no review-readiness control');
    assert.ok(/launches, binds and pays for nothing/.test(page.text('runs-list')),
      'the readiness control does not state that asking changes nothing');
    // The label is the operator's question, not the route's vocabulary.
    assert.ok(!/preflight|REVIEW_PERMITTED|API|POST/i.test(ask.textContent),
      `the readiness label carries code jargon: ${ask.textContent}`);
    assert.strictEqual(readinessLine(page), null,
      'the card claimed a readiness answer it never asked for');
    assert.strictEqual(preflightCalls(calls).length, 0,
      'the first paint reached the readiness route with no operator click');

    // A live status push and a repaint are repaints, not questions.
    page.sse.listeners.status.forEach((fn) => fn({ data: JSON.stringify(status) }));
    for (let i = 0; i < 10; i++) await Promise.resolve();
    assert.strictEqual(preflightCalls(calls).length, 0,
      'a live status push asked the readiness route on the operator\'s behalf');

    // The new control is an addition: nothing that was on the card is gone.
    const labels = runButtonLabels(page);
    for (const kept of ['Verify independent review', 'Cancel', 'Pause']) {
      assert.ok(labels.includes(kept),
        `the readiness control displaced ${kept}: ${labels.join(', ')}`);
    }

    // Every other run is unchanged, and none of them may ask this question.
    for (const scenario of [
      { label: 'an unbound history row',
        status: Object.assign(readinessStatus('RUN-READY'), { runsBinding: {
          state: 'UNAVAILABLE', runId: null, reason: 'no authoritative binding' } }),
        keeps: [] },
      { label: 'a review-bound run', status: readinessStatus('RUN-READY', 'REVIEW_BOUND'), keeps: [] },
      { label: 'a built run', status: readinessStatus('RUN-READY', 'BUILT'),
        keeps: ['Run deterministic checks'] },
      { label: 'a failed-checks run', status: readinessStatus('RUN-READY', 'CHECKS_FAILED'),
        keeps: ['Retry'] },
    ]) {
      const other = readinessPage(scenario.status, () => {
        throw new Error('an ineligible run reached the readiness route');
      });
      for (let i = 0; i < 10; i++) await Promise.resolve();
      assert.strictEqual(readinessControl(other.page), null,
        `${scenario.label} exposed the review-readiness control`);
      const otherLabels = runButtonLabels(other.page);
      for (const kept of scenario.keeps) {
        assert.ok(otherLabels.includes(kept),
          `${scenario.label} lost ${kept}: ${otherLabels.join(', ')}`);
      }
    }
  });

  await atest('DOM: review readiness states three truthful outcomes, posts only the run id, and moves nothing', async () => {
    const cases = [
      { label: 'review still needed',
        body: { runId: 'RUN-READY', state: 'CHECKS_PASSED', status: 'REVIEW_PERMITTED',
          mutations: 'NONE', reasonCode: 'EXACT_SUBJECT_REVIEW_PENDING',
          reasonSummary: 'At least one required reviewer still owes a review of this exact checked version.' },
        expect: [/Review is still needed for this exact checked version/,
          /Nothing was launched, nothing was bound and nothing was paid for/],
        forbid: [/No further review is needed/, /cannot prepare a review/] },
      { label: 'no further review needed',
        body: { runId: 'RUN-READY', state: 'CHECKS_PASSED', status: 'NO_ADDITIONAL_REVIEW_NEEDED',
          mutations: 'NONE', reasonCode: 'EXACT_SUBJECT_REVIEW_COMPLETE',
          reasonSummary: 'Review coverage of this exact checked version is already complete.' },
        expect: [/No further review is needed for this exact checked version/,
          /Nothing was newly reviewed and nothing was bound/],
        forbid: [/Review is still needed/] },
      { label: 'refused with a canonical reason',
        body: { runId: 'RUN-READY', state: 'CHECKS_PASSED', status: 'REFUSED', mutations: 'NONE',
          reasonCode: 'REVIEW-CYCLE-EXHAUSTED',
          reasonSummary: 'The bounded review cycle for this packet permits no further round; another round is an escalation decision, not remaining work.' },
        expect: [/AEGIS cannot prepare a review for this run right now/, /Nothing was launched/,
          /bounded review cycle for this packet permits no further round/],
        forbid: [/No further review is needed/, /It gave no reason/] },
      { label: 'refused with no reason at all',
        body: { runId: 'RUN-READY', state: 'CHECKS_PASSED', status: 'REFUSED', mutations: 'NONE',
          reasonCode: null, reasonSummary: null },
        expect: [/AEGIS cannot prepare a review for this run right now/,
          /It gave no reason this page can state/],
        forbid: [/No further review is needed/, /undefined|null/] },
    ];
    for (const scenario of cases) {
      const status = readinessStatus('RUN-READY');
      const { page, calls } = readinessPage(status,
        () => ({ ok: true, json: async () => scenario.body }));
      for (let i = 0; i < 10; i++) await Promise.resolve();
      const ask = readinessControl(page);
      assert.ok(ask, `${scenario.label} exposed no readiness control`);
      // Two clicks, one question: a second press while the first is in flight
      // must not become a second request.
      const first = ask._listeners.click[0]();
      const second = ask._listeners.click[0]();
      await first;
      await second;
      for (let i = 0; i < 10; i++) await Promise.resolve();
      const asked = preflightCalls(calls);
      assert.strictEqual(asked.length, 1,
        `${scenario.label} sent ${asked.length} readiness requests for one operator ask`);
      assert.deepStrictEqual(JSON.parse(asked[0].options.body), { runId: 'RUN-READY' },
        `${scenario.label} sent fields beyond the exact runId authority boundary`);
      assert.strictEqual(asked[0].options.method, 'POST',
        `${scenario.label} did not use the canonical POST route`);
      assert.strictEqual(asked[0].options.credentials, 'same-origin',
        `${scenario.label} did not reuse the same-origin credential path`);

      const line = readinessLine(page);
      assert.ok(line, `${scenario.label} printed no readiness answer`);
      assert.strictEqual(line.attrs['data-review-readiness'], scenario.body.status,
        `${scenario.label} recorded the wrong canonical outcome on the card`);
      for (const expected of scenario.expect) {
        assert.ok(expected.test(line.textContent),
          `${scenario.label} is missing ${expected}: ${line.textContent}`);
      }
      for (const banned of scenario.forbid) {
        assert.ok(!banned.test(line.textContent),
          `${scenario.label} says ${banned}: ${line.textContent}`);
      }
      assert.ok(!/\b(?:launched|started|commissioned|ran|paid)\s+(?:for\s+)?(?:an?\s+)?(?:independent\s+)?review\b/i
        .test(line.textContent.replace(/Nothing was [^.]*\./g, '')),
      `${scenario.label} claims this dashboard obtained a review: ${line.textContent}`);

      // Asking changed nothing: the run, its lifecycle and every other control
      // are exactly where they were, and the control is ready to be asked again.
      assert.ok(/CHECKS_PASSED/.test(page.text('runs-list')) &&
        !/REVIEW_BOUND|REVIEW_FAILED/.test(page.text('runs-list')),
      `${scenario.label} repainted the run lifecycle from a readiness answer`);
      assert.strictEqual(ask.textContent, 'Check review readiness',
        `${scenario.label} left the readiness control in its pending label`);
      assert.strictEqual(ask.disabled, false,
        `${scenario.label} left the readiness control disabled after an answer`);
      assert.ok(runButtonLabels(page).includes('Verify independent review'),
        `${scenario.label} disturbed the review-bind control`);
      assert.strictEqual(calls.filter((call) =>
        ['/api/review-bind', '/api/checks', '/api/start', '/api/retry', '/api/cancel']
          .indexOf(call.path) !== -1).length, 0,
      `${scenario.label} reached a lifecycle route while only asking a question`);
    }
  });

  await atest('DOM: an unreadable, failed or late readiness answer reports UNAVAILABLE and never lands on another card', async () => {
    const unreadable = [
      { label: 'an answer about a different run',
        body: { runId: 'RUN-OTHER', status: 'REVIEW_PERMITTED', mutations: 'NONE' } },
      { label: 'an unrecognised outcome',
        body: { runId: 'RUN-READY', status: 'REVIEW_STARTED', mutations: 'NONE' } },
      { label: 'an answer that admits a mutation',
        body: { runId: 'RUN-READY', status: 'NO_ADDITIONAL_REVIEW_NEEDED', mutations: 'SOME' } },
      { label: 'an inherited property name as the outcome',
        body: { runId: 'RUN-READY', status: 'constructor', mutations: 'NONE' } },
      { label: 'no answer body at all', body: null },
    ];
    for (const scenario of unreadable) {
      const { page } = readinessPage(readinessStatus('RUN-READY'),
        () => ({ ok: true, json: async () => scenario.body }));
      for (let i = 0; i < 10; i++) await Promise.resolve();
      await readinessControl(page)._listeners.click[0]();
      for (let i = 0; i < 10; i++) await Promise.resolve();
      const line = readinessLine(page);
      assert.ok(line, `${scenario.label} printed nothing at all`);
      assert.strictEqual(line.attrs['data-review-readiness'], 'UNAVAILABLE',
        `${scenario.label} was treated as a readable readiness answer`);
      assert.ok(/Review readiness is unavailable/.test(line.textContent),
        `${scenario.label} did not report readiness as unavailable: ${line.textContent}`);
      assert.ok(!/No further review is needed|Review is still needed/.test(line.textContent),
        `${scenario.label} produced an optimistic readiness claim: ${line.textContent}`);
      assert.ok(/CHECKS_PASSED/.test(page.text('runs-list')),
        `${scenario.label} moved the run`);
    }

    // A refused or broken transport is the same honest absence, and it keeps
    // the canonical refusal text the server did publish.
    const { page: failed } = readinessPage(readinessStatus('RUN-READY'),
      () => ({ ok: false, status: 500, json: async () => ({ error: {
        code: 'INTERNAL', message: 'review preflight failed' } }) }));
    for (let i = 0; i < 10; i++) await Promise.resolve();
    const failedAsk = readinessControl(failed);
    await failedAsk._listeners.click[0]();
    for (let i = 0; i < 10; i++) await Promise.resolve();
    const failedLine = readinessLine(failed);
    assert.strictEqual(failedLine.attrs['data-review-readiness'], 'UNAVAILABLE',
      'an HTTP failure was reported as a readiness reading');
    assert.ok(/Review readiness is unavailable/.test(failedLine.textContent) &&
      /review preflight failed/.test(failedLine.textContent),
    `the failure drops either the honest absence or its recorded reason: ${failedLine.textContent}`);
    assert.strictEqual(failedAsk.disabled, false, 'a failed ask left the control unusable');
    assert.strictEqual(failedAsk.textContent, 'Check review readiness',
      'a failed ask left the control in its pending label');

    // A late answer belongs to the card that asked. After canonical evidence
    // repaints the run, the answer must reach no card at all.
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const lateStatus = readinessStatus('RUN-LATE');
    const { page: late } = readinessPage(lateStatus, async () => {
      await gate;
      return { ok: true, json: async () => ({ runId: 'RUN-LATE', status: 'NO_ADDITIONAL_REVIEW_NEEDED',
        mutations: 'NONE', reasonSummary: null }) };
    });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    const pending = readinessControl(late)._listeners.click[0]();
    const advanced = JSON.parse(JSON.stringify(lateStatus));
    advanced.generatedAt = '2026-09-04T09:00:05.000Z';
    advanced.runs[0].state = 'REVIEW_BOUND';
    advanced.runs[0].updatedAt = '2026-09-04T09:00:05.000Z';
    late.sse.listeners.status.forEach((fn) => fn({ data: JSON.stringify(advanced) }));
    release();
    await pending;
    for (let i = 0; i < 10; i++) await Promise.resolve();
    assert.ok(/REVIEW_BOUND/.test(late.text('runs-list')),
      'the repaint that outran the answer did not happen');
    assert.strictEqual(readinessLine(late), null,
      'a late readiness answer attached itself to the repainted card');
    assert.ok(!/No further review is needed/.test(late.text('runs-list')),
      'a late readiness answer put a stale reading on the current run');
    assert.strictEqual(readinessControl(late), null,
      'the readiness control survived after the run left CHECKS_PASSED');
  });

  // ── "Request Codex review": one explicit ask, and honest uncertainty ───────
  // This is the only control on the page that can cause a canonical review to
  // be attempted, so every proof below holds one of four lines: it is offered
  // only when the canonical preflight has just said Codex owes a review of THIS
  // run; it dispatches exactly once even across a repaint; it never presents a
  // written record, a stopped process or a lost answer as an approval; and an
  // answer it cannot read is an honest unknown rather than a quiet success.
  const codexSettle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

  function codexPreflight(over) {
    return Object.assign({
      runId: 'RUN-READY', state: 'CHECKS_PASSED', status: 'REVIEW_PERMITTED', mutations: 'NONE',
      reasonCode: 'EXACT_SUBJECT_REVIEW_PENDING',
      reasonSummary: 'At least one required reviewer still owes a review of this exact checked version.',
      requiredReviewers: ['codex', 'grok'],
      pendingReviewers: [{ reviewer: 'codex', executed: 'MISSING', coverage: 'NONE' }],
    }, over || {});
  }

  function codexAnswer(over) {
    return Object.assign({
      runId: 'RUN-READY', reviewer: 'codex', review: 'RECORD_WRITTEN',
      reviewProcess: 'DRAINED', admission: 'RELEASED', reasonCode: 'REVIEW_RECORD_WRITTEN',
      reasonSummary: 'A review record was written. It records what the reviewer said; it is not an approval and it moves no gate.',
    }, over || {});
  }

  // The canonical preflight answers about the run it was asked about, so the
  // default fixture echoes the posted runId. A proof that wants a mismatched
  // answer builds one explicitly rather than getting it by accident.
  const codexPreflightEcho = (over) => (options) => ({ ok: true,
    json: async () => codexPreflight(Object.assign(
      { runId: JSON.parse(options.body).runId }, over || {})) });

  // preflight and request are functions of the request options, so a proof can
  // change the answer between asks, stall one, or refuse the transport outright.
  function codexPage(status, preflight, request) {
    const calls = [];
    const page = bootPage(fixtureState(), { fetch: async (requestPath, options) => {
      calls.push({ path: requestPath, options });
      if (requestPath === '/api/status') return { ok: true, json: async () => status };
      if (requestPath === '/api/review-preflight') return preflight(options);
      if (requestPath === '/api/request-codex-review') return request(options);
      throw new Error('unexpected request ' + requestPath);
    } });
    return { page, calls };
  }

  function codexOfferNodes(page) {
    return findByAttr(page.document.getElementById('runs-list'), 'data-codex-offer');
  }

  function codexControl(page) {
    return codexOfferNodes(page).find((node) => node.tagName === 'BUTTON') || null;
  }

  function codexResult(page) {
    return findByAttr(page.document.getElementById('runs-list'), 'data-codex-request')[0] || null;
  }

  function codexCalls(calls) {
    return calls.filter((call) => call.path === '/api/request-codex-review');
  }

  const codexRefused = () => { throw new Error('the page requested a Codex review it was never told to request'); };

  await atest('DOM: the Codex request appears only after the preflight names Codex as still owing a review of this run', async () => {
    // Nothing on first paint, and nothing from a repaint: only an answered ask
    // can put this control on the page.
    const status = readinessStatus('RUN-READY');
    const { page, calls } = codexPage(status,
      codexPreflightEcho(), codexRefused);
    await codexSettle();
    assert.strictEqual(codexControl(page), null,
      'the Codex request control was offered before any readiness answer existed');
    page.sse.listeners.status.forEach((fn) => fn({ data: JSON.stringify(status) }));
    await codexSettle();
    assert.strictEqual(codexControl(page), null,
      'a live status push offered a Codex review request on the operator\'s behalf');
    assert.strictEqual(codexCalls(calls).length, 0,
      'the page reached the canonical review request route with no operator click');

    // The one eligible answer offers it, in the operator's words, and still
    // reaches no route.
    await readinessControl(page)._listeners.click[0]();
    await codexSettle();
    const ask = codexControl(page);
    assert.ok(ask && ask.disabled !== true,
      'an eligible preflight answer offered no Codex review request');
    assert.strictEqual(ask.textContent, 'Request Codex review',
      `the Codex control does not say plainly what it does: ${ask.textContent}`);
    assert.strictEqual(ask.attrs['data-codex-offer'], 'AVAILABLE',
      'the offered Codex control does not record itself as available');
    assert.ok(/separate, explicit act/.test(page.text('runs-list')),
      'the page does not say that requesting a review is a separate explicit act');
    assert.ok(/AEGIS rechecks eligibility and may refuse/.test(page.text('runs-list')),
      'the page presents the browser reading as the authority rather than the server');
    assert.strictEqual(codexCalls(calls).length, 0,
      'offering the control dispatched a canonical review request by itself');
    assert.strictEqual(codexResult(page), null,
      'the card reported a request outcome before any request was made');
    // Everything that was on the card is still on it.
    for (const kept of ['Verify independent review', 'Check review readiness', 'Cancel', 'Pause']) {
      assert.ok(runButtonLabels(page).includes(kept),
        `the Codex control displaced ${kept}: ${runButtonLabels(page).join(', ')}`);
    }

    // Every answer that does not name Codex as pending on a permitted review
    // leaves no control behind — including the ones that are about a review
    // still being needed by somebody else.
    const ineligible = [
      { label: 'only Grok still owes a review',
        body: codexPreflight({ pendingReviewers: [{ reviewer: 'grok', executed: 'MISSING', coverage: 'NONE' }] }) },
      { label: 'no reviewer is named as pending', body: codexPreflight({ pendingReviewers: [] }) },
      { label: 'the pending list is missing', body: codexPreflight({ pendingReviewers: undefined }) },
      { label: 'the pending list is not a list', body: codexPreflight({ pendingReviewers: { reviewer: 'codex' } }) },
      { label: 'a pending entry is a bare string', body: codexPreflight({ pendingReviewers: ['codex'] }) },
      { label: 'a pending entry is null', body: codexPreflight({ pendingReviewers: [null] }) },
      { label: 'review coverage is already complete',
        body: codexPreflight({ status: 'NO_ADDITIONAL_REVIEW_NEEDED', reasonCode: 'EXACT_SUBJECT_REVIEW_COMPLETE' }) },
      { label: 'the preflight refused', body: codexPreflight({ status: 'REFUSED', reasonCode: 'REVIEW-GATE-BLOCKED' }) },
      { label: 'the answer admits a mutation', body: codexPreflight({ mutations: 'SOME' }) },
      { label: 'the answer is about another run', body: codexPreflight({ runId: 'RUN-OTHER' }) },
      { label: 'the answer is unreadable', body: null },
    ];
    for (const scenario of ineligible) {
      const other = codexPage(readinessStatus('RUN-READY'),
        () => ({ ok: true, json: async () => scenario.body }), codexRefused);
      await codexSettle();
      await readinessControl(other.page)._listeners.click[0]();
      await codexSettle();
      assert.strictEqual(codexControl(other.page), null,
        `${scenario.label} offered a Codex review request anyway`);
      assert.strictEqual(codexOfferNodes(other.page).length, 0,
        `${scenario.label} left a Codex offer node on the card`);
      assert.strictEqual(codexCalls(other.calls).length, 0,
        `${scenario.label} reached the canonical review request route`);
      // Grok's own eligibility reading is untouched by any of this.
      assert.ok(readinessLine(other.page), `${scenario.label} lost the readiness answer itself`);
    }

    // A later ineligible answer withdraws an offer an earlier one made: the
    // control never outlives the reading that justified it.
    let permitted = true;
    const { page: withdrawn, calls: withdrawnCalls } = codexPage(readinessStatus('RUN-READY'),
      () => ({ ok: true, json: async () => (permitted ? codexPreflight()
        : codexPreflight({ status: 'NO_ADDITIONAL_REVIEW_NEEDED', pendingReviewers: [] })) }),
      codexRefused);
    await codexSettle();
    await readinessControl(withdrawn)._listeners.click[0]();
    await codexSettle();
    assert.ok(codexControl(withdrawn), 'the first eligible answer offered nothing');
    permitted = false;
    await readinessControl(withdrawn)._listeners.click[0]();
    await codexSettle();
    assert.strictEqual(codexControl(withdrawn), null,
      'a stale Codex request control survived an answer that no longer permits one');
    assert.strictEqual(codexCalls(withdrawnCalls).length, 0,
      'withdrawing the offer dispatched a request');
  });

  await atest('DOM: one Codex request sends exactly the run id, exactly once, and states pending as an open question', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const { page, calls } = codexPage(readinessStatus('RUN-READY'),
      codexPreflightEcho(),
      async () => { await gate; return { ok: true, json: async () => codexAnswer() }; });
    await codexSettle();
    await readinessControl(page)._listeners.click[0]();
    await codexSettle();
    const ask = codexControl(page);

    // Two presses, one canonical request.
    const first = ask._listeners.click[0]();
    const second = ask._listeners.click[0]();
    await codexSettle();
    const sent = codexCalls(calls);
    assert.strictEqual(sent.length, 1,
      `two presses produced ${sent.length} canonical review requests`);
    assert.deepStrictEqual(JSON.parse(sent[0].options.body), { runId: 'RUN-READY' },
      'the request carried a field beyond the exact runId authority boundary');
    assert.strictEqual(sent[0].options.method, 'POST', 'the canonical POST route was not used');
    assert.strictEqual(sent[0].options.credentials, 'same-origin',
      'the request left the same-origin authenticated credential path');

    // Pending is an open question about the request, never evidence of work.
    const pendingLine = codexResult(page);
    assert.ok(pendingLine, 'the in-flight request printed nothing at all');
    assert.strictEqual(pendingLine.attrs['data-codex-request'], 'PENDING',
      'an in-flight request did not record itself as pending');
    assert.ok(/not proof that a reviewer is running/.test(pendingLine.textContent),
      `pending is presented as proof of reviewer work: ${pendingLine.textContent}`);
    assert.ok(!/approved|complete|passed|succeeded/i.test(pendingLine.textContent),
      `an unanswered request claims an outcome: ${pendingLine.textContent}`);
    assert.strictEqual(ask.disabled, true, 'the control stayed pressable while its request was open');
    assert.ok(/Requested \d{4}-\d{2}-\d{2}T[\d:.]+Z · no answer has come back here yet\./
      .test(pendingLine.textContent),
    `an open request is undated or claims a receipt it never got: ${pendingLine.textContent}`);

    release();
    await first;
    await second;
    await codexSettle();
    assert.strictEqual(codexCalls(calls).length, 1,
      'the settled request produced a second dispatch');
    assert.strictEqual(codexResult(page).attrs['data-codex-request'], 'RECORD_WRITTEN',
      'the canonical answer did not replace the pending line');
    assert.strictEqual(calls.filter((call) =>
      ['/api/review-bind', '/api/checks', '/api/start', '/api/retry', '/api/cancel']
        .indexOf(call.path) !== -1).length, 0,
    'requesting a review reached a lifecycle route');
    assert.ok(/CHECKS_PASSED/.test(page.text('runs-list')) &&
      !/REVIEW_BOUND/.test(page.text('runs-list')),
    'a review request repainted the run lifecycle from its own answer');
  });

  await atest('DOM: a Codex request reports record, processes and admission as three separate facts and never as approval', async () => {
    const outcomes = [
      { label: 'a record written and everything given back',
        body: codexAnswer(),
        request: 'RECORD_WRITTEN', process: 'DRAINED', admission: 'RELEASED',
        expect: [/A review record was written/, /It is not an approval, it is not a pass, and it moves no gate/,
          /Stopped means the processes ended, not that a review passed/,
          /Every claim this request took was given back/,
          /not a reading of what the review gate needs now/] },
      { label: 'a record written while the admission slot stays held',
        body: codexAnswer({ reviewProcess: 'UNDRAINED', admission: 'HELD' }),
        request: 'RECORD_WRITTEN', process: 'UNDRAINED', admission: 'HELD',
        expect: [/A review record was written/, /not recorded as finished/,
          /deliberately still held, so nothing else can take it/] },
      { label: 'the reviewer refused',
        body: codexAnswer({ review: 'REVIEW_REFUSED', reviewProcess: 'DRAINED', admission: 'RELEASED',
          reasonCode: 'REVIEW_REQUEST_REFUSED',
          reasonSummary: 'The canonical reviewer refused this request. That is not an approval, and it does not establish whether a review record was published before the refusal.' }),
        request: 'REVIEW_REFUSED', process: 'DRAINED', admission: 'RELEASED',
        expect: [/The reviewer refused this request/, /whether any record was published before the refusal is not established/,
          /canonical reviewer refused this request/] },
      { label: 'the review never completed and claims could not be confirmed free',
        body: codexAnswer({ review: 'REVIEW_UNCOMPLETED', reviewProcess: 'UNKNOWN', admission: 'UNCONFIRMED',
          reasonCode: 'REVIEW_CALL_FAILED',
          reasonSummary: 'The canonical review call did not complete, so what the reviewer did is unknown.' }),
        request: 'REVIEW_UNCOMPLETED', process: 'UNKNOWN', admission: 'UNCONFIRMED',
        expect: [/No completed review record came back/, /Whether reviewer work is still running is unknown/,
          /could not be confirmed free/] },
      { label: 'nothing was requested because admission was unavailable',
        body: codexAnswer({ review: 'NOT_REQUESTED', reviewProcess: 'NOT_LAUNCHED', admission: 'NOT_ACQUIRED',
          reasonCode: 'ADMISSION_UNAVAILABLE',
          reasonSummary: 'A build or review already holds the single governed admission slot, so no review was started.' }),
        request: 'NOT_REQUESTED', process: 'NOT_LAUNCHED', admission: 'NOT_ACQUIRED',
        expect: [/No review record was written, because no reviewer was ever asked/,
          /No reviewer process was started/, /never taken by this request/,
          /already holds the single governed admission slot/] },
      { label: 'the canonical result itself was unreadable to the server',
        body: codexAnswer({ review: 'UNKNOWN', reviewProcess: 'UNKNOWN', admission: 'UNCONFIRMED',
          reasonCode: 'REVIEW_RESULT_UNREADABLE',
          reasonSummary: 'The canonical review request produced no answer this host recognises, so what the reviewer did — and whether the governed admission slot came back — are both unknown.' }),
        request: 'UNKNOWN', process: 'UNKNOWN', admission: 'UNCONFIRMED',
        expect: [/What the reviewer did is unknown/, /Whether reviewer work is still running is unknown/,
          /could not be confirmed free/] },
      { label: 'a refusal that carries no reason this page can state',
        body: codexAnswer({ review: 'NOT_REQUESTED', reviewProcess: 'NOT_LAUNCHED', admission: 'NOT_ACQUIRED',
          reasonCode: null, reasonSummary: null }),
        request: 'NOT_REQUESTED', process: 'NOT_LAUNCHED', admission: 'NOT_ACQUIRED',
        expect: [/It gave no reason this page can state/],
        forbid: [/undefined|null/] },
    ];
    for (const scenario of outcomes) {
      const { page, calls } = codexPage(readinessStatus('RUN-READY'),
        codexPreflightEcho(),
        () => ({ ok: true, json: async () => scenario.body }));
      await codexSettle();
      await readinessControl(page)._listeners.click[0]();
      await codexSettle();
      await codexControl(page)._listeners.click[0]();
      await codexSettle();

      const line = codexResult(page);
      assert.ok(line, `${scenario.label} printed no outcome`);
      assert.strictEqual(codexCalls(calls).length, 1,
        `${scenario.label} did not send exactly one canonical request`);
      // The three questions stay three answers. A record says nothing about a
      // process, and neither says whether the governed slot came back.
      assert.strictEqual(line.attrs['data-codex-request'], scenario.request,
        `${scenario.label} recorded the wrong review-record outcome`);
      assert.strictEqual(line.attrs['data-codex-process'], scenario.process,
        `${scenario.label} recorded the wrong reviewer-process outcome`);
      assert.strictEqual(line.attrs['data-codex-admission'], scenario.admission,
        `${scenario.label} recorded the wrong admission outcome`);
      for (const expected of scenario.expect) {
        assert.ok(expected.test(line.textContent),
          `${scenario.label} is missing ${expected}: ${line.textContent}`);
      }
      for (const banned of scenario.forbid || []) {
        assert.ok(!banned.test(line.textContent),
          `${scenario.label} says ${banned}: ${line.textContent}`);
      }
      // No outcome may read as approval, as a passed review, or as a moved gate,
      // and DRAINED specifically may not read as a review that succeeded. The
      // page's own denials are removed first, so "not that a review passed" is
      // measured as the denial it is rather than as the claim it refuses.
      const claimed = line.textContent
        .replace(/\bnot that a review passed\b/gi, '')
        .replace(/\bis not an approval\b/gi, '')
        .replace(/\bnot a pass\b/gi, '');
      for (const claim of [/\breview passed\b/i, /\bis approved\b/i, /\bapproval granted\b/i,
        /\bgate (?:is )?(?:clear|cleared|moved)\b/i, /\breview succeeded\b/i, /ready to merge/i]) {
        assert.ok(!claim.test(claimed),
          `${scenario.label} claims ${claim}: ${line.textContent}`);
      }
      // The page holds this for as long as it stays open — that is what makes a
      // delayed answer visible at all — and says exactly that, without implying
      // a durable record that outlives the tab or that anyone else can read.
      assert.ok(/held by this open page/.test(line.textContent) &&
        /Reloading or closing the page loses it/.test(line.textContent),
      `${scenario.label} does not state how long this answer is kept: ${line.textContent}`);
      assert.ok(!/\bnot kept\b|disappears when this page repaints/.test(line.textContent),
        `${scenario.label} still claims a repaint discards the answer: ${line.textContent}`);
      // Dated by two real moments: when the request left, and when the answer
      // came back. An undated outcome cannot be told from a fresher one.
      assert.ok(/Requested \d{4}-\d{2}-\d{2}T[\d:.]+Z · answer received \d{4}-\d{2}-\d{2}T[\d:.]+Z\./
        .test(line.textContent),
      `${scenario.label} did not date the request and the answer it received: ${line.textContent}`);
      assert.strictEqual(line.attrs['data-codex-run'], 'RUN-READY',
        `${scenario.label} did not record which run this outcome belongs to`);
      assert.ok(/CHECKS_PASSED/.test(page.text('runs-list')),
        `${scenario.label} moved the run from its canonical state`);
    }
  });

  await atest('DOM: a malformed answer or a lost one is an honest unknown, is never retried, and never reads as success', async () => {
    const unreadable = [
      { label: 'an answer about a different run', body: codexAnswer({ runId: 'RUN-OTHER' }) },
      { label: 'an answer from a different reviewer', body: codexAnswer({ reviewer: 'grok' }) },
      { label: 'an unrecognised review word', body: codexAnswer({ review: 'REVIEW_PASSED' }) },
      { label: 'an unrecognised process word', body: codexAnswer({ reviewProcess: 'FINISHED' }) },
      { label: 'an unrecognised admission word', body: codexAnswer({ admission: 'FREE' }) },
      { label: 'an inherited property name as the review word', body: codexAnswer({ review: 'constructor' }) },
      { label: 'an inherited property name as the admission word', body: codexAnswer({ admission: 'toString' }) },
      { label: 'an array instead of a record', body: [] },
      { label: 'no answer body at all', body: null },
    ];
    for (const scenario of unreadable) {
      const { page, calls } = codexPage(readinessStatus('RUN-READY'),
        codexPreflightEcho(),
        () => ({ ok: true, json: async () => scenario.body }));
      await codexSettle();
      await readinessControl(page)._listeners.click[0]();
      await codexSettle();
      await codexControl(page)._listeners.click[0]();
      await codexSettle();
      const line = codexResult(page);
      assert.ok(line, `${scenario.label} printed nothing at all`);
      assert.strictEqual(line.attrs['data-codex-request'], 'UNREADABLE',
        `${scenario.label} was treated as a readable request outcome`);
      assert.strictEqual(line.attrs['data-codex-admission'], 'UNCONFIRMED',
        `${scenario.label} reported the governed admission slot as settled`);
      assert.ok(/not one this page can read/.test(line.textContent),
        `${scenario.label} did not report the answer as unreadable: ${line.textContent}`);
      assert.ok(!/A review record was written|given back|No reviewer process was started/
        .test(line.textContent),
      `${scenario.label} produced an optimistic claim: ${line.textContent}`);
      assert.strictEqual(codexCalls(calls).length, 1,
        `${scenario.label} was retried automatically`);
    }

    // A refused or broken transport is the same honest absence, keeps whatever
    // reason the server did publish, and is never retried on the page's own.
    for (const scenario of [
      { label: 'an HTTP refusal',
        respond: () => ({ ok: false, status: 409, json: async () => ({ error: {
          code: 'RUN_CLAIM_UNAVAILABLE', message: 'another action already holds this run' } }) }),
        leaked: /another action already holds this run|RUN_CLAIM_UNAVAILABLE|request failed with status/ },
      { label: 'a dropped connection',
        respond: () => { throw new Error('network error'); },
        leaked: /network error/ },
    ]) {
      const { page, calls } = codexPage(readinessStatus('RUN-READY'),
        codexPreflightEcho(),
      scenario.respond);
      await codexSettle();
      await readinessControl(page)._listeners.click[0]();
      await codexSettle();
      await codexControl(page)._listeners.click[0]();
      await codexSettle();
      const line = codexResult(page);
      assert.strictEqual(line.attrs['data-codex-request'], 'NO_ANSWER',
        `${scenario.label} was reported as a request outcome`);
      assert.strictEqual(line.attrs['data-codex-process'], 'UNKNOWN',
        `${scenario.label} claimed to know whether reviewer work is running`);
      assert.strictEqual(line.attrs['data-codex-admission'], 'UNCONFIRMED',
        `${scenario.label} reported the governed admission slot as free`);
      assert.ok(/no answer came back/.test(line.textContent),
        `${scenario.label} dropped the honest absence: ${line.textContent}`);
      // The transport's own words are deliberately not shown. A socket error or
      // an HTTP status describes the trip, not the review, and printed beside
      // three plain-English unknowns it reads as the reason a review did not
      // happen. The fixed sentence says the only thing actually known.
      assert.ok(!scenario.leaked.test(line.textContent),
        `${scenario.label} printed raw transport text as if it explained the review: ${line.textContent}`);
      assert.ok(/Nothing was retried/.test(line.textContent),
        `${scenario.label} does not state that nothing was retried`);
      assert.strictEqual(codexCalls(calls).length, 1,
        `${scenario.label} sent ${codexCalls(calls).length} requests — a lost answer must never be retried`);
    }
  });

  await atest('DOM: a repaint cannot dispatch a second Codex request, and no other run inherits a pending one', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const status = readinessStatus('RUN-READY');
    const { page, calls } = codexPage(status,
      codexPreflightEcho(),
      async () => { await gate; return { ok: true, json: async () => codexAnswer() }; });
    await codexSettle();
    await readinessControl(page)._listeners.click[0]();
    await codexSettle();
    const pending = codexControl(page)._listeners.click[0]();
    await codexSettle();
    assert.strictEqual(codexCalls(calls).length, 1, 'the first request never left');

    // A live repaint rebuilds the card. The open request survives it, because a
    // repaint is not an answer: it is redrawn from page memory onto the new
    // card, still pending and still dated by when it was actually sent. What
    // must NOT survive is the offer of a second request while one is open.
    const pendingText = codexResult(page).textContent;
    const repainted = JSON.parse(JSON.stringify(status));
    repainted.generatedAt = '2026-09-04T09:00:02.000Z';
    page.sse.listeners.status.forEach((fn) => fn({ data: JSON.stringify(repainted) }));
    await codexSettle();
    const afterRepaint = codexResult(page);
    assert.ok(afterRepaint, 'the repaint dropped the open request the operator had already made');
    assert.strictEqual(afterRepaint.attrs['data-codex-request'], 'PENDING',
      'the repainted card resolved an open request it had no answer for');
    assert.strictEqual(afterRepaint.textContent, pendingText,
      `the repaint rewrote the pending request instead of restating it: ${afterRepaint.textContent}`);
    assert.strictEqual(codexControl(page), null,
      'a repaint re-offered the Codex request without a readiness answer');
    await readinessControl(page)._listeners.click[0]();
    await codexSettle();
    assert.strictEqual(codexControl(page), null,
      'a repaint plus a fresh readiness ask offered a second Codex request while one was open');
    const held = codexOfferNodes(page);
    assert.strictEqual(held.length, 1, 'the repainted card explains nothing about the open request');
    assert.strictEqual(held[0].tagName === 'BUTTON', false,
      'the repainted card offered a pressable second request while one was open');
    assert.strictEqual(held[0].attrs['data-codex-offer'], 'IN_FLIGHT',
      'the repainted card does not record the open request as in flight');
    assert.ok(/already waiting for an outcome/.test(held[0].textContent),
      `the repainted card does not say why no request is offered: ${held[0].textContent}`);
    assert.strictEqual(codexCalls(calls).length, 1,
      `the repaint path dispatched ${codexCalls(calls).length} requests`);

    // A different run cannot take the open slot either, and cannot be given the
    // first run's result.
    const moved = JSON.parse(JSON.stringify(status));
    moved.generatedAt = '2026-09-04T09:00:05.000Z';
    moved.runs[0].runId = 'RUN-SECOND';
    moved.runsBinding.runId = 'RUN-SECOND';
    page.sse.listeners.status.forEach((fn) => fn({ data: JSON.stringify(moved) }));
    await codexSettle();
    await readinessControl(page)._listeners.click[0]();
    await codexSettle();
    assert.strictEqual(codexControl(page), null,
      'a different run was offered a Codex request while another run\'s request was open');
    assert.ok(/for another run is already waiting/.test(page.text('runs-list')),
      'the second run does not say the open request belongs to a different run');

    release();
    await pending;
    await codexSettle();
    assert.strictEqual(codexCalls(calls).length, 1, 'settling the request dispatched another');
    assert.strictEqual(codexResult(page), null,
      'the first run\'s answer landed on a different run\'s card');
    assert.ok(!/A review record was written/.test(page.text('runs-list')),
      'a stale request outcome was printed on the run that never asked for it');

    // With the request settled the guard is released, and the SAME server
    // authority — a fresh eligible preflight answer — is what re-offers it.
    await readinessControl(page)._listeners.click[0]();
    await codexSettle();
    assert.strictEqual(codexCalls(calls).length, 1,
      're-offering the control dispatched a request by itself');
    const reoffered = codexControl(page);
    assert.ok(reoffered && reoffered.disabled !== true,
      'the in-flight guard was never released after the request settled');
  });

  // ── the answer has to reach the person who asked ──────────────────────────
  // The request is asynchronous and every status push rebuilds every card, so
  // the node a click starts from is routinely detached before the answer
  // arrives. An outcome written only to that node is written where no reader
  // can see it: the operator makes the one request on this page that can cause
  // a review, and is left looking at "pending" forever. The outcome is
  // therefore kept per run, redrawn on whichever card is on the page now, and
  // never carried onto a run that did not ask.
  await atest('DOM: a delayed Codex answer reaches the card on the page, is kept by run, and is restored dated', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const status = readinessStatus('RUN-READY');
    let permitted = true;
    const { page, calls } = codexPage(status,
      (options) => ({ ok: true, json: async () => (permitted
        ? codexPreflight({ runId: JSON.parse(options.body).runId })
        : codexPreflight({ runId: JSON.parse(options.body).runId,
          status: 'NO_ADDITIONAL_REVIEW_NEEDED', pendingReviewers: [] })) }),
      async () => { await gate; return { ok: true, json: async () => codexAnswer() }; });
    await codexSettle();
    await readinessControl(page)._listeners.click[0]();
    await codexSettle();
    const pending = codexControl(page)._listeners.click[0]();
    await codexSettle();
    assert.strictEqual(codexResult(page).attrs['data-codex-request'], 'PENDING',
      'the request was never reported as open');

    // The repaint that destroys the card the request was made from.
    const repainted = JSON.parse(JSON.stringify(status));
    repainted.generatedAt = '2026-09-04T09:00:03.000Z';
    page.sse.listeners.status.forEach((fn) => fn({ data: JSON.stringify(repainted) }));
    await codexSettle();
    assert.ok(codexResult(page), 'a routine repaint discarded a request that was still open');

    // The answer lands AFTER that repaint, and has to be visible on the card
    // that exists now rather than on the one that was replaced.
    release();
    await pending;
    await codexSettle();
    const answered = codexResult(page);
    assert.ok(answered, 'the delayed answer went to a card that is no longer on the page');
    assert.strictEqual(answered.attrs['data-codex-request'], 'RECORD_WRITTEN',
      'the operator was left looking at a pending line that its own answer never replaced');
    assert.ok(/A review record was written/.test(answered.textContent),
      `the delayed answer is not readable on the repainted card: ${answered.textContent}`);
    const answerText = answered.textContent;
    assert.ok(/Requested \d{4}-\d{2}-\d{2}T[\d:.]+Z · answer received \d{4}-\d{2}-\d{2}T[\d:.]+Z\./
      .test(answerText), `the delayed answer is undated: ${answerText}`);

    // Withdrawing the offer is not erasing the outcome. Whether AEGIS would
    // permit ANOTHER request is a question about the future; what this operator
    // already caused is a question about the past, and the two are not the same
    // fact. The outcome therefore does not depend on a new request being
    // offerable.
    permitted = false;
    await readinessControl(page)._listeners.click[0]();
    await codexSettle();
    assert.strictEqual(codexControl(page), null,
      'an answer that permits no review still offered one');
    assert.strictEqual(codexResult(page).textContent, answerText,
      'withdrawing the offer erased the outcome of a request that had already been made');

    // A run that never asked inherits nothing — not the outcome, not the words.
    const moved = JSON.parse(JSON.stringify(status));
    moved.generatedAt = '2026-09-04T09:00:04.000Z';
    moved.runs[0].runId = 'RUN-SECOND';
    moved.runsBinding.runId = 'RUN-SECOND';
    page.sse.listeners.status.forEach((fn) => fn({ data: JSON.stringify(moved) }));
    await codexSettle();
    assert.strictEqual(codexResult(page), null,
      'a run that never asked for a review inherited another run\'s outcome');
    assert.ok(!/A review record was written/.test(page.text('runs-list')),
      `a stale outcome was printed on the run that never asked for it: ${page.text('runs-list')}`);

    // ...and the run that did ask gets it back, restated rather than re-decided:
    // the same sentences and the same two stamps, with no readiness ask, no
    // re-fetch and no second request.
    const back = JSON.parse(JSON.stringify(status));
    back.generatedAt = '2026-09-04T09:00:05.000Z';
    page.sse.listeners.status.forEach((fn) => fn({ data: JSON.stringify(back) }));
    await codexSettle();
    const restored = codexResult(page);
    assert.ok(restored, 'returning to the run that asked restored nothing');
    assert.strictEqual(restored.textContent, answerText,
      `the restored outcome was rewritten rather than restated: ${restored.textContent}`);
    assert.strictEqual(restored.attrs['data-codex-run'], 'RUN-READY',
      'the restored outcome does not name the run it belongs to');
    assert.strictEqual(codexControl(page), null,
      'restoring an outcome also re-offered a request no readiness answer permits');

    // The run moving on does not unmake what the operator asked for.
    const bound = JSON.parse(JSON.stringify(status));
    bound.generatedAt = '2026-09-04T09:00:06.000Z';
    bound.runs[0].state = 'REVIEW_BOUND';
    page.sse.listeners.status.forEach((fn) => fn({ data: JSON.stringify(bound) }));
    await codexSettle();
    assert.ok(codexResult(page) && codexResult(page).textContent === answerText,
      'the outcome vanished as soon as the run left the state that can request a review');

    // None of the above re-asked, re-fetched, polled or retried anything.
    assert.strictEqual(codexCalls(calls).length, 1,
      `repaints and restorations dispatched ${codexCalls(calls).length} canonical review requests`);
  });

  // ── "Record checkpoint": one explicit ask, one dated receipt ───────────────
  // A checkpoint RECORDS where a reviewed run reached. It is the one remaining
  // governed act this page can ask for, and the failure it must never produce is
  // a page that reads as a delivery: every proof below holds one of five lines.
  // It is offered only on the run AEGIS currently binds, in REVIEW_BOUND, and
  // reaches no route until it is pressed. It sends the run id and nothing else,
  // exactly once, even across a repaint. A recorded outcome is a compact dated
  // receipt that says what it is and what it is not. An uncertain, unreadable,
  // refused or lost answer is an honest outcome that never claims nothing
  // changed unless AEGIS refused before recording. And nothing here ever
  // commits, restores, deploys or retries on the page's own initiative.
  const checkpointSettle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

  function checkpointStatus(runId, runState) {
    return readinessStatus(runId, runState || 'REVIEW_BOUND');
  }

  function checkpointAnswer(over) {
    return Object.assign({
      runId: 'RUN-READY', action: 'checkpoint', outcome: 'RECORDED', state: 'CHECKPOINTED',
      checkpointId: 'CP-20260904090000-ab12cd34', createdAt: '2026-09-04T09:00:00.000Z',
      rollbackPoint: 'a'.repeat(40), tree: 'b'.repeat(40), digest: 'c'.repeat(64),
      reasonCode: null, reasonSummary: null,
      summary: 'A checkpoint was recorded for this run. It marks a known-good point and nothing else.',
    }, over || {});
  }

  function checkpointPage(status, respond) {
    const calls = [];
    const page = bootPage(fixtureState(), { fetch: async (requestPath, options) => {
      calls.push({ path: requestPath, options });
      if (requestPath === '/api/status') return { ok: true, json: async () => status };
      if (requestPath === '/api/checkpoint') return respond(options);
      throw new Error('unexpected request ' + requestPath);
    } });
    return { page, calls };
  }

  function checkpointOfferNodes(page) {
    return findByAttr(page.document.getElementById('runs-list'), 'data-checkpoint-offer');
  }

  function checkpointControl(page) {
    return checkpointOfferNodes(page).find((node) => node.tagName === 'BUTTON') || null;
  }

  function checkpointResult(page) {
    return findByAttr(page.document.getElementById('runs-list'), 'data-checkpoint-outcome')[0] || null;
  }

  function checkpointCalls(calls) {
    return calls.filter((call) => call.path === '/api/checkpoint');
  }

  const checkpointRefused = () => {
    throw new Error('the page asked for a checkpoint it was never told to ask for');
  };

  await atest('DOM: the checkpoint control is offered only on the bound REVIEW_BOUND run and reaches no route until it is pressed', async () => {
    const status = checkpointStatus('RUN-READY');
    const { page, calls } = checkpointPage(status, checkpointRefused);
    await checkpointSettle();
    const ask = checkpointControl(page);
    assert.ok(ask && ask.disabled !== true,
      'the canonically bound REVIEW_BOUND run exposes no checkpoint control');
    assert.strictEqual(ask.textContent, 'Record checkpoint',
      `the checkpoint control does not say plainly what it does: ${ask.textContent}`);
    assert.strictEqual(ask.attrs['data-checkpoint-offer'], 'AVAILABLE',
      'the offered checkpoint control does not record itself as available');
    // The label is the operator's act, not the route's vocabulary.
    assert.ok(!/API|POST|endpoint|DTO|runId/i.test(ask.textContent),
      `the checkpoint label carries code jargon: ${ask.textContent}`);
    // What it is, and what it is not — including the one prerequisite that lives
    // outside this dashboard entirely.
    const offerText = page.text('runs-list');
    assert.ok(/records where this reviewed run reached/.test(offerText),
      'the control does not say what recording a checkpoint is');
    assert.ok(/writes no commit, starts no review, restores no files and deploys nothing/.test(offerText),
      `the control does not state what it cannot do: ${offerText}`);
    assert.ok(/must already be committed through the approved narrow external path/.test(offerText),
      'the control does not state that the reviewed changes are committed elsewhere first');
    assert.ok(/AEGIS rechecks eligibility and may refuse/.test(offerText),
      'the control presents the browser reading as the authority rather than the server');
    assert.strictEqual(checkpointResult(page), null,
      'the card reported a checkpoint outcome before any request was made');
    assert.strictEqual(checkpointCalls(calls).length, 0,
      'the first paint reached the canonical checkpoint route with no operator press');

    // A live repaint is not an operator, and never becomes one.
    page.sse.listeners.status.forEach((fn) => fn({ data: JSON.stringify(status) }));
    await checkpointSettle();
    assert.ok(checkpointControl(page), 'a live status push withdrew the checkpoint control');
    assert.strictEqual(checkpointCalls(calls).length, 0,
      'a live status push asked for a checkpoint on the operator\'s behalf');
    // The new control is an addition: nothing that was on the card is gone.
    for (const kept of ['Cancel', 'Pause']) {
      assert.ok(runButtonLabels(page).includes(kept),
        `the checkpoint control displaced ${kept}: ${runButtonLabels(page).join(', ')}`);
    }

    // No other canonical state may ask, whatever else the card offers.
    for (const state of ['BUILT', 'CHECKS_PASSED', 'CHECKS_FAILED', 'BUILDING', 'CHECKPOINTED']) {
      const other = checkpointPage(checkpointStatus('RUN-READY', state), checkpointRefused);
      await checkpointSettle();
      assert.strictEqual(checkpointControl(other.page), null,
        `a ${state} run offered a checkpoint request`);
      assert.strictEqual(checkpointOfferNodes(other.page).length, 0,
        `a ${state} run left a checkpoint offer node on the card`);
      assert.strictEqual(checkpointCalls(other.calls).length, 0,
        `a ${state} run reached the canonical checkpoint route`);
    }

    // Neither may a REVIEW_BOUND run AEGIS is not currently binding: the row
    // stays readable and says why it offers nothing.
    for (const scenario of [
      { label: 'an unbound history row',
        binding: { state: 'UNAVAILABLE', runId: null, reason: 'no authoritative binding' } },
      { label: 'a binding that names another run',
        binding: { state: 'BOUND', runId: 'RUN-OTHER', updatedAt: '2026-09-04T09:00:00.000Z',
          subjectState: 'UNLINKED', gateSubjectSha256: 'a'.repeat(64), reason: 'bound' } },
    ]) {
      const unboundStatus = Object.assign(checkpointStatus('RUN-READY'), { runsBinding: scenario.binding });
      const other = checkpointPage(unboundStatus, checkpointRefused);
      await checkpointSettle();
      assert.strictEqual(checkpointControl(other.page), null,
        `${scenario.label} offered a checkpoint request`);
      assert.ok(/Only the run AEGIS currently binds can ask for its checkpoint/
        .test(other.page.text('runs-list')),
      `${scenario.label} does not say why it offers no checkpoint control`);
      assert.strictEqual(checkpointCalls(other.calls).length, 0,
        `${scenario.label} reached the canonical checkpoint route`);
    }
  });

  await atest('DOM: one checkpoint request sends exactly the run id, exactly once, and states pending as an open question', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const { page, calls } = checkpointPage(checkpointStatus('RUN-READY'),
      async () => { await gate; return { ok: true, json: async () => checkpointAnswer() }; });
    await checkpointSettle();
    const ask = checkpointControl(page);

    // Two presses, one canonical request.
    const first = ask._listeners.click[0]();
    const second = ask._listeners.click[0]();
    await checkpointSettle();
    const sent = checkpointCalls(calls);
    assert.strictEqual(sent.length, 1,
      `two presses produced ${sent.length} canonical checkpoint requests`);
    assert.deepStrictEqual(JSON.parse(sent[0].options.body), { runId: 'RUN-READY' },
      'the request carried a field beyond the exact runId authority boundary');
    assert.strictEqual(sent[0].options.method, 'POST', 'the canonical POST route was not used');
    assert.strictEqual(sent[0].options.credentials, 'same-origin',
      'the request left the same-origin authenticated credential path');

    // Pending is an open question about the request, never evidence of a record.
    const pendingLine = checkpointResult(page);
    assert.ok(pendingLine, 'the in-flight request printed nothing at all');
    assert.strictEqual(pendingLine.attrs['data-checkpoint-outcome'], 'PENDING',
      'an in-flight request did not record itself as pending');
    assert.ok(/not proof that a checkpoint exists/.test(pendingLine.textContent),
      `pending is presented as proof of a recorded checkpoint: ${pendingLine.textContent}`);
    assert.ok(!/\bwas recorded\b|\bdeployed\b|\bcomplete\b|Checkpoint CP-/i.test(pendingLine.textContent),
      `an unanswered request claims an outcome: ${pendingLine.textContent}`);
    assert.strictEqual(ask.disabled, true, 'the control stayed pressable while its request was open');
    assert.ok(/Requested \d{4}-\d{2}-\d{2}T[\d:.]+Z · no answer has come back here yet\./
      .test(pendingLine.textContent),
    `an open request is undated or claims a receipt it never got: ${pendingLine.textContent}`);

    release();
    await first;
    await second;
    await checkpointSettle();
    assert.strictEqual(checkpointCalls(calls).length, 1,
      'the settled request produced a second dispatch');
    assert.strictEqual(checkpointResult(page).attrs['data-checkpoint-outcome'], 'RECORDED',
      'the canonical answer did not replace the pending line');
    // The one act this page can take is asking. It reaches no lifecycle route,
    // and the canonical state on the card still comes from status/SSE alone.
    assert.deepStrictEqual([...new Set(calls.map((call) => call.path))].sort(),
      ['/api/checkpoint', '/api/status'],
      'asking for a checkpoint reached a route beyond the canonical checkpoint endpoint');
    assert.ok(/REVIEW_BOUND/.test(page.text('runs-list')) &&
      !/CHECKPOINTED/.test(page.text('runs-list')),
    'a checkpoint answer repainted the canonical run lifecycle from its own reply');
  });

  await atest('DOM: a recorded checkpoint is one compact dated receipt that claims no deployment and no current readiness', async () => {
    const { page, calls } = checkpointPage(checkpointStatus('RUN-READY'),
      () => ({ ok: true, json: async () => checkpointAnswer() }));
    await checkpointSettle();
    await checkpointControl(page)._listeners.click[0]();
    await checkpointSettle();

    const line = checkpointResult(page);
    assert.ok(line, 'a recorded checkpoint printed nothing at all');
    assert.strictEqual(line.attrs['data-checkpoint-outcome'], 'RECORDED');
    assert.strictEqual(line.attrs['data-checkpoint-run'], 'RUN-READY',
      'the receipt does not record which run it belongs to');
    // The three coordinates an operator needs, from the answer and nowhere else.
    assert.strictEqual(line.attrs['data-checkpoint-id'], 'CP-20260904090000-ab12cd34');
    assert.strictEqual(line.attrs['data-checkpoint-commit'], 'a'.repeat(40));
    assert.strictEqual(line.attrs['data-checkpoint-recorded-at'], '2026-09-04T09:00:00.000Z');
    assert.ok(line.textContent.includes('Checkpoint CP-20260904090000-ab12cd34 · rollback commit ' +
      'a'.repeat(40) + ' · recorded 2026-09-04T09:00:00.000Z.'),
    `the receipt is not readable as id, commit and recorded time: ${line.textContent}`);
    assert.ok(/a point to come back to and nothing else/.test(line.textContent),
      'the receipt does not say in plain English what a checkpoint is');
    assert.ok(/not a reading of what the gate needs now/.test(line.textContent),
      'the receipt reads as current gate readiness rather than as a dated request');
    // Dated by two real moments: when the request left, and when it was answered.
    assert.ok(/Requested \d{4}-\d{2}-\d{2}T[\d:.]+Z · answer received \d{4}-\d{2}-\d{2}T[\d:.]+Z\./
      .test(line.textContent), `the receipt is undated: ${line.textContent}`);
    // Compact: four sentences and the two stamps, no decorative panel.
    assert.ok(line.children.length <= 6,
      `the receipt grew into a panel of ${line.children.length} lines`);
    // Nothing the browser has no use for travels into view.
    assert.ok(!line.textContent.includes('c'.repeat(64)) && !line.textContent.includes('b'.repeat(40)),
      'the receipt published the canonical digest or tree beside the operator-readable coordinates');
    // No outcome may read as a delivery. The page's own denials are removed
    // first, so "nothing was deployed" is measured as the denial it is.
    const claimed = line.textContent
      .replace(/No files were restored and nothing was deployed\./gi, '')
      .replace(/it is not a deployment or a release/gi, '');
    for (const claim of [/\bdeployed\b/i, /\breleased\b/i, /\bshipped\b/i, /\bmerged\b/i,
      /ready to merge/i, /gate (?:is )?(?:clear|cleared|moved)\b/i, /\bin production\b/i]) {
      assert.ok(!claim.test(claimed), `the receipt claims ${claim}: ${line.textContent}`);
    }

    // A recorded receipt withdraws the offer instead of inviting a second record.
    assert.strictEqual(checkpointControl(page), null,
      'a run with a recorded checkpoint receipt was offered a second request');
    const held = checkpointOfferNodes(page);
    assert.strictEqual(held.length, 1, 'the answered card explains nothing about why it offers no request');
    assert.strictEqual(held[0].attrs['data-checkpoint-offer'], 'RECORDED');
    assert.strictEqual(checkpointCalls(calls).length, 1,
      'the recorded outcome dispatched a second canonical request');
  });

  await atest('DOM: uncertain, unreadable, refused and lost checkpoint answers stay honest and are never retried', async () => {
    // Only AEGIS refusing before it records anything may be reported as nothing
    // recorded. Everything else is unknown, and unknown is stated as unknown.
    const unknown = [
      { label: 'the canonical claim could not be proven released',
        body: checkpointAnswer({ outcome: 'UNCERTAIN', state: null, checkpointId: null,
          createdAt: null, rollbackPoint: null, tree: null, digest: null,
          reasonCode: 'CHECKPOINT_CLAIM_NOT_RELEASED' }),
        outcome: 'UNCERTAIN',
        expect: [/could not prove it released the claim/, /not idle/] },
      { label: 'the canonical call did not complete',
        body: checkpointAnswer({ outcome: 'UNCERTAIN', state: null, checkpointId: null,
          createdAt: null, rollbackPoint: null, tree: null, digest: null,
          reasonCode: 'CHECKPOINT_CALL_FAILED' }),
        outcome: 'UNCERTAIN',
        expect: [/did not complete, so what it recorded before it stopped is unknown/] },
      { label: 'an uncertain answer with no reason this page can state',
        body: checkpointAnswer({ outcome: 'UNCERTAIN', state: null, checkpointId: null,
          createdAt: null, rollbackPoint: null, tree: null, digest: null, reasonCode: 'NEW_REASON' }),
        outcome: 'UNCERTAIN',
        expect: [/It gave no reason this page can state/], forbid: [/undefined|null|NEW_REASON/] },
      { label: 'a checkpoint id that is not a canonical identifier',
        body: checkpointAnswer({ checkpointId: 'CP-1' }), outcome: 'UNREADABLE' },
      { label: 'a rollback point that is not a commit',
        body: checkpointAnswer({ rollbackPoint: 'HEAD~1' }), outcome: 'UNREADABLE' },
      { label: 'a recorded time that is not a canonical timestamp',
        body: checkpointAnswer({ createdAt: 'yesterday' }), outcome: 'UNREADABLE' },
      { label: 'a recorded outcome that names no checkpointed state',
        body: checkpointAnswer({ state: 'REVIEW_BOUND' }), outcome: 'UNREADABLE' },
      { label: 'an answer about a different run',
        body: checkpointAnswer({ runId: 'RUN-OTHER' }), outcome: 'UNREADABLE' },
      { label: 'an answer about a different action',
        body: checkpointAnswer({ action: 'rollback' }), outcome: 'UNREADABLE' },
      { label: 'an unrecognised outcome word',
        body: checkpointAnswer({ outcome: 'ROLLED_BACK' }), outcome: 'UNREADABLE' },
      { label: 'an inherited property name as the outcome word',
        body: checkpointAnswer({ outcome: 'constructor' }), outcome: 'UNREADABLE' },
      { label: 'an array instead of a record', body: [], outcome: 'UNREADABLE' },
      { label: 'no answer body at all', body: null, outcome: 'UNREADABLE' },
    ];
    for (const scenario of unknown) {
      const { page, calls } = checkpointPage(checkpointStatus('RUN-READY'),
        () => ({ ok: true, json: async () => scenario.body }));
      await checkpointSettle();
      await checkpointControl(page)._listeners.click[0]();
      await checkpointSettle();
      const line = checkpointResult(page);
      assert.ok(line, `${scenario.label} printed nothing at all`);
      assert.strictEqual(line.attrs['data-checkpoint-outcome'], scenario.outcome,
        `${scenario.label} recorded the wrong outcome`);
      assert.ok(/Whether a checkpoint was recorded is unknown/.test(line.textContent),
        `${scenario.label} did not state the honest unknown: ${line.textContent}`);
      for (const expected of scenario.expect || []) {
        assert.ok(expected.test(line.textContent),
          `${scenario.label} is missing ${expected}: ${line.textContent}`);
      }
      for (const banned of scenario.forbid || []) {
        assert.ok(!banned.test(line.textContent),
          `${scenario.label} says ${banned}: ${line.textContent}`);
      }
      // Unknown is never "nothing happened", and never a receipt.
      for (const claim of [/nothing changed/i, /nothing happened/i, /no checkpoint was recorded/i,
        /A checkpoint was recorded for this run/, /Checkpoint CP-/]) {
        assert.ok(!claim.test(line.textContent),
          `${scenario.label} claims ${claim}: ${line.textContent}`);
      }
      assert.ok(!line.attrs['data-checkpoint-id'] && !line.attrs['data-checkpoint-commit'],
        `${scenario.label} published receipt coordinates it never validated`);
      assert.ok(/Requested \d{4}-\d{2}-\d{2}T[\d:.]+Z · answer received \d{4}-\d{2}-\d{2}T[\d:.]+Z\./
        .test(line.textContent), `${scenario.label} left the outcome undated: ${line.textContent}`);
      assert.strictEqual(checkpointCalls(calls).length, 1,
        `${scenario.label} was retried automatically`);
      // An outcome that may already have written a record does not invite a
      // second one, and nothing asks again on its own.
      assert.strictEqual(checkpointControl(page), null,
        `${scenario.label} offered a second request while what was recorded is unknown`);
      assert.strictEqual(checkpointOfferNodes(page)[0].attrs['data-checkpoint-offer'], 'UNKNOWN',
        `${scenario.label} does not say why no second request is offered`);
      assert.ok(/CHECKS_PASSED|REVIEW_BOUND/.test(page.text('runs-list')) &&
        !/CHECKPOINTED/.test(page.text('runs-list')),
      `${scenario.label} moved the run from its canonical state`);
    }

    // A refusal AEGIS raises before recording is the one honest "nothing was
    // recorded" — stated in this page's words, never in the canonical message,
    // and it leaves the control available to an operator who fixes the cause.
    const refusal = checkpointPage(checkpointStatus('RUN-READY'),
      () => ({ ok: false, status: 409, json: async () => ({ error: {
        code: 'CHECKPOINT_DIRTY_TREE',
        message: 'uncommitted changes in /Users/fixture/worktree/builder-control/dashboard/index.html',
      } }) }));
    await checkpointSettle();
    await checkpointControl(refusal.page)._listeners.click[0]();
    await checkpointSettle();
    const refused = checkpointResult(refusal.page);
    assert.strictEqual(refused.attrs['data-checkpoint-outcome'], 'REFUSED',
      'a canonical refusal was not reported as a refusal');
    assert.ok(/No checkpoint was recorded, nothing was committed and nothing was changed/
      .test(refused.textContent),
    `the refusal does not state what it means: ${refused.textContent}`);
    assert.ok(/The reviewed changes are not committed/.test(refused.textContent) &&
      /approved narrow external path/.test(refused.textContent),
    `the refusal does not explain the one thing the operator must do elsewhere: ${refused.textContent}`);
    assert.ok(!/\/Users\/fixture|uncommitted changes in|409|CHECKPOINT_DIRTY_TREE/
      .test(refused.textContent),
    `the refusal printed raw canonical text or a status line: ${refused.textContent}`);
    assert.strictEqual(checkpointCalls(refusal.calls).length, 1,
      'a refusal was retried automatically');
    const reoffered = checkpointControl(refusal.page);
    assert.ok(reoffered && reoffered.disabled !== true,
      'a refusal that recorded nothing left no way for an operator to ask again');
    assert.strictEqual(checkpointCalls(refusal.calls).length, 1,
      're-offering the control dispatched a request by itself');

    // A refusal this page does not recognise still came back: it is an answer
    // that could not be read, never a proven absence of a record.
    const unrecognised = checkpointPage(checkpointStatus('RUN-READY'),
      () => ({ ok: false, status: 500, json: async () => ({ error: {
        code: 'INTERNAL_ERROR', message: 'internal error' } }) }));
    await checkpointSettle();
    await checkpointControl(unrecognised.page)._listeners.click[0]();
    await checkpointSettle();
    const opaque = checkpointResult(unrecognised.page);
    assert.strictEqual(opaque.attrs['data-checkpoint-outcome'], 'UNREADABLE',
      'an unrecognised canonical refusal was reported as a settled outcome');
    assert.ok(/Whether a checkpoint was recorded is unknown/.test(opaque.textContent),
      `an unrecognised refusal did not stay unknown: ${opaque.textContent}`);
    assert.ok(!/internal error|INTERNAL_ERROR|500|request failed with status/.test(opaque.textContent),
      `an unrecognised refusal printed raw transport text: ${opaque.textContent}`);
    assert.strictEqual(checkpointCalls(unrecognised.calls).length, 1,
      'an unrecognised refusal was retried automatically');

    // A lost answer proves nothing about what the request reached.
    const lost = checkpointPage(checkpointStatus('RUN-READY'),
      () => { throw new Error('network error'); });
    await checkpointSettle();
    await checkpointControl(lost.page)._listeners.click[0]();
    await checkpointSettle();
    const dropped = checkpointResult(lost.page);
    assert.strictEqual(dropped.attrs['data-checkpoint-outcome'], 'NO_ANSWER',
      'a dropped connection was reported as an outcome of the request');
    assert.ok(/no answer came back/.test(dropped.textContent) &&
      /Whether a checkpoint was recorded is unknown/.test(dropped.textContent),
    `a dropped connection did not stay unknown: ${dropped.textContent}`);
    assert.ok(/Nothing was retried/.test(dropped.textContent),
      'the lost answer does not state that nothing was retried');
    assert.ok(!/network error/.test(dropped.textContent),
      `the transport's own words were printed as if they explained the run: ${dropped.textContent}`);
    assert.strictEqual(checkpointCalls(lost.calls).length, 1,
      `a lost answer produced ${checkpointCalls(lost.calls).length} requests — it must never be retried`);
  });

  await atest('DOM: a delayed checkpoint answer reaches the card on the page, is kept by run, and survives the run advancing', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const status = checkpointStatus('RUN-READY');
    const { page, calls } = checkpointPage(status,
      async () => { await gate; return { ok: true, json: async () => checkpointAnswer() }; });
    await checkpointSettle();
    const pending = checkpointControl(page)._listeners.click[0]();
    await checkpointSettle();
    assert.strictEqual(checkpointResult(page).attrs['data-checkpoint-outcome'], 'PENDING',
      'the request was never reported as open');
    const pendingText = checkpointResult(page).textContent;

    // The repaint that destroys the card the request was made from. The open
    // request survives it, because a repaint is not an answer — and no second
    // request may be offered while the first is unresolved.
    const repainted = JSON.parse(JSON.stringify(status));
    repainted.generatedAt = '2026-09-04T09:00:02.000Z';
    page.sse.listeners.status.forEach((fn) => fn({ data: JSON.stringify(repainted) }));
    await checkpointSettle();
    const afterRepaint = checkpointResult(page);
    assert.ok(afterRepaint, 'a routine repaint discarded a request that was still open');
    assert.strictEqual(afterRepaint.attrs['data-checkpoint-outcome'], 'PENDING',
      'the repainted card resolved an open request it had no answer for');
    assert.strictEqual(afterRepaint.textContent, pendingText,
      `the repaint rewrote the pending request instead of restating it: ${afterRepaint.textContent}`);
    assert.strictEqual(checkpointControl(page), null,
      'a repaint offered a second checkpoint request while one was open');
    assert.strictEqual(checkpointOfferNodes(page)[0].attrs['data-checkpoint-offer'], 'IN_FLIGHT',
      'the repainted card does not record the open request as in flight');
    assert.strictEqual(checkpointCalls(calls).length, 1,
      `the repaint path dispatched ${checkpointCalls(calls).length} requests`);

    // A different run can neither take the open slot nor be given this answer.
    const moved = JSON.parse(JSON.stringify(status));
    moved.generatedAt = '2026-09-04T09:00:03.000Z';
    moved.runs[0].runId = 'RUN-SECOND';
    moved.runsBinding.runId = 'RUN-SECOND';
    page.sse.listeners.status.forEach((fn) => fn({ data: JSON.stringify(moved) }));
    await checkpointSettle();
    assert.strictEqual(checkpointControl(page), null,
      'a different run was offered a checkpoint while another run\'s request was open');
    assert.ok(/for another run is already waiting/.test(page.text('runs-list')),
      'the second run does not say the open request belongs to a different run');

    release();
    await pending;
    await checkpointSettle();
    assert.strictEqual(checkpointCalls(calls).length, 1, 'settling the request dispatched another');
    assert.strictEqual(checkpointResult(page), null,
      'the first run\'s receipt landed on a different run\'s card');
    assert.ok(!/Checkpoint CP-20260904090000-ab12cd34/.test(page.text('runs-list')),
      'a receipt was printed on the run that never asked for it');

    // The run that did ask gets it back, restated rather than re-decided.
    const back = JSON.parse(JSON.stringify(status));
    back.generatedAt = '2026-09-04T09:00:04.000Z';
    page.sse.listeners.status.forEach((fn) => fn({ data: JSON.stringify(back) }));
    await checkpointSettle();
    const restored = checkpointResult(page);
    assert.ok(restored, 'returning to the run that asked restored nothing');
    assert.strictEqual(restored.attrs['data-checkpoint-outcome'], 'RECORDED',
      'the operator was left looking at a pending line its own answer never replaced');
    assert.strictEqual(restored.attrs['data-checkpoint-run'], 'RUN-READY',
      'the restored receipt does not name the run it belongs to');
    const receiptText = restored.textContent;
    assert.ok(/Requested \d{4}-\d{2}-\d{2}T[\d:.]+Z · answer received \d{4}-\d{2}-\d{2}T[\d:.]+Z\./
      .test(receiptText), `the restored receipt is undated: ${receiptText}`);

    // The run advancing to its checkpointed state does not unmake the dated
    // answer the operator was given for the request they made.
    const advanced = JSON.parse(JSON.stringify(status));
    advanced.generatedAt = '2026-09-04T09:00:05.000Z';
    advanced.runs[0].state = 'CHECKPOINTED';
    advanced.runs[0].checkpoint = 'CP-20260904090000-ab12cd34';
    advanced.runs[0].rollbackPoint = 'a'.repeat(40);
    page.sse.listeners.status.forEach((fn) => fn({ data: JSON.stringify(advanced) }));
    await checkpointSettle();
    const kept = checkpointResult(page);
    assert.ok(kept && kept.textContent === receiptText,
      'the receipt vanished or was rewritten as soon as the run advanced');
    assert.strictEqual(checkpointControl(page), null,
      'a run that has left REVIEW_BOUND was offered a checkpoint request');

    // None of the above re-asked, re-fetched, polled or retried anything.
    assert.strictEqual(checkpointCalls(calls).length, 1,
      `repaints and restorations dispatched ${checkpointCalls(calls).length} canonical checkpoint requests`);
  });

  // A settled request must leave the card the operator is LOOKING AT accurate.
  // The card that asked may already have been replaced by a repaint, so an
  // offer redrawn through the closure that started the request refreshes a node
  // no reader can see — and every card still on the page keeps saying a request
  // is waiting for an outcome that has already come back. Both halves of that
  // are proved here: the run that asked, and a different bound run that never
  // did.
  await atest('DOM: a checkpoint answer arriving after a repaint refreshes the offer on the card that is showing, not the one that asked', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const status = checkpointStatus('RUN-READY');
    const { page, calls } = checkpointPage(status, async () => {
      await gate;
      // A refusal AEGIS raises BEFORE it records anything: the one outcome that
      // may honestly leave the control available again.
      return { ok: false, status: 409, json: async () => ({ error: {
        code: 'CHECKPOINT_DIRTY_TREE',
        message: 'uncommitted changes in /Users/fixture/worktree/builder-control/dashboard/index.html',
      } }) };
    });
    await checkpointSettle();
    const pending = checkpointControl(page)._listeners.click[0]();
    await checkpointSettle();

    // The repaint that destroys the card the request was made from, replacing it
    // with a fresh card for the same run.
    const repainted = JSON.parse(JSON.stringify(status));
    repainted.generatedAt = '2026-09-04T09:00:02.000Z';
    page.sse.listeners.status.forEach((fn) => fn({ data: JSON.stringify(repainted) }));
    await checkpointSettle();
    assert.strictEqual(checkpointOfferNodes(page)[0].attrs['data-checkpoint-offer'], 'IN_FLIGHT',
      'the repainted card does not record the open request as in flight');

    release();
    await pending;
    await checkpointSettle();

    // The refusal is on the card that is on the page, dated, in this page's own
    // words — not stranded on the detached node the request was made from.
    const refused = checkpointResult(page);
    assert.ok(refused, 'the refusal never reached the card that replaced the one that asked');
    assert.strictEqual(refused.attrs['data-checkpoint-outcome'], 'REFUSED',
      'a canonical refusal that arrived after a repaint was not reported as a refusal');
    assert.strictEqual(refused.attrs['data-checkpoint-run'], 'RUN-READY',
      'the refusal does not name the run it belongs to');
    assert.ok(/No checkpoint was recorded, nothing was committed and nothing was changed/
      .test(refused.textContent),
    `the refusal does not state what it means: ${refused.textContent}`);
    assert.ok(/Requested \d{4}-\d{2}-\d{2}T[\d:.]+Z · answer received \d{4}-\d{2}-\d{2}T[\d:.]+Z\./
      .test(refused.textContent), `the refusal is undated: ${refused.textContent}`);

    // And the offer the operator can actually see is a usable control again —
    // no card left reading as still waiting for an answer that has landed.
    const offers = checkpointOfferNodes(page);
    assert.ok(!offers.some((node) => node.attrs['data-checkpoint-offer'] === 'IN_FLIGHT'),
      'a settled request left a card still saying a checkpoint request is waiting for an outcome');
    const reoffered = checkpointControl(page);
    assert.ok(reoffered && reoffered.disabled !== true,
      'the refusal refreshed the detached card that asked and left the visible one with no way to ask again');
    assert.strictEqual(reoffered.textContent, 'Record checkpoint',
      `the re-offered control is stuck on the label of a request that has settled: ${reoffered.textContent}`);
    assert.strictEqual(reoffered.attrs['data-checkpoint-offer'], 'AVAILABLE',
      'the re-offered control does not record itself as available');

    // Refreshing the offer is a redraw, never an ask: the operator presses it or
    // nothing happens, and nothing was retried on the page's own initiative.
    assert.strictEqual(checkpointCalls(calls).length, 1,
      `the repaint-and-settle path dispatched ${checkpointCalls(calls).length} canonical checkpoint requests`);
  });

  await atest('DOM: settling a request while a different bound run is showing gives that run neither the answer nor a stale waiting offer', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const status = checkpointStatus('RUN-READY');
    const { page, calls } = checkpointPage(status,
      async () => { await gate; return { ok: true, json: async () => checkpointAnswer() }; });
    await checkpointSettle();
    const pending = checkpointControl(page)._listeners.click[0]();
    await checkpointSettle();

    // AEGIS binds a different run while the first request is still open. That
    // run withholds its own control only because the page-wide guard is held.
    const moved = JSON.parse(JSON.stringify(status));
    moved.generatedAt = '2026-09-04T09:00:03.000Z';
    moved.runs[0].runId = 'RUN-SECOND';
    moved.runsBinding.runId = 'RUN-SECOND';
    page.sse.listeners.status.forEach((fn) => fn({ data: JSON.stringify(moved) }));
    await checkpointSettle();
    assert.strictEqual(checkpointOfferNodes(page)[0].attrs['data-checkpoint-offer'], 'IN_FLIGHT',
      'the newly bound run does not record the other run\'s open request as in flight');

    release();
    await pending;
    await checkpointSettle();

    // The receipt belongs to the run that asked and to no other: the run on the
    // page never asked, so it is given nothing.
    assert.strictEqual(checkpointResult(page), null,
      'the first run\'s receipt landed on a run that never asked for it');
    assert.ok(!/Checkpoint CP-20260904090000-ab12cd34/.test(page.text('runs-list')),
      'a receipt was printed on the run that never asked for it');

    // ...and it is not left reading as waiting for an outcome that has arrived.
    assert.ok(!/already waiting for an outcome/.test(page.text('runs-list')),
      `a settled request left a newly bound run waiting on it: ${page.text('runs-list')}`);
    assert.ok(!checkpointOfferNodes(page)
      .some((node) => node.attrs['data-checkpoint-offer'] === 'IN_FLIGHT'),
    'the guard was released but the visible offer still records a request in flight');
    const offered = checkpointControl(page);
    assert.ok(offered && offered.disabled !== true,
      'the run now bound was left with no checkpoint control after the other run\'s request settled');
    assert.strictEqual(offered.attrs['data-checkpoint-offer'], 'AVAILABLE',
      'the freed control does not record itself as available');

    // Freeing the guard offers a control; it never presses it.
    assert.strictEqual(checkpointCalls(calls).length, 1,
      `settling one request dispatched ${checkpointCalls(calls).length} canonical checkpoint requests`);
  });

  await atest('DOM: ROOT-subject mismatch cannot hide run-scoped review verification and canonical refusal stays truthful', async () => {
    const checked = {
      generatedAt: '2026-08-27T16:06:00.000Z',
      // Deliberately describe a different ROOT subject than the bound run's
      // gate subject. The browser may qualify its summary, but it must not use
      // this parent-checkout projection to suppress the run-worktree action.
      engineering: { state: 'OK', verdict: 'READY_FOR_PR', subjectSha256: 'b'.repeat(64),
        subjectPaths: ['builder-control/dashboard/index.html'], problems: [],
        reviewerCompleteness: passingReviewCompleteness('b'.repeat(64)) },
      runsBinding: { state: 'BOUND', runId: 'RUN-REFUSED', updatedAt: '2026-08-27T16:06:00.000Z',
        subjectState: 'UNLINKED', gateSubjectSha256: 'a'.repeat(64), reason: 'bound' },
      integration: { connectors: [] },
      runs: [{ runId: 'RUN-REFUSED', state: 'CHECKS_PASSED', objective: 'Refused review binding',
        checks: { passed: 1, total: 1 }, updatedAt: '2026-08-27T16:06:00.000Z' }],
    };
    const page = bootPage(fixtureState(), { fetch: async (path) => {
      if (path === '/api/status') return { ok: true, json: async () => checked };
      if (path === '/api/review-bind') return { ok: false, status: 409, json: async () => ({ error: {
        code: 'REVIEW-GATE-REFUSED', message: 'canonical exact-subject review gate did not pass',
      } }) };
      throw new Error('unexpected request ' + path);
    } });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    const review = allNodes(page.document.getElementById('runs-list'))
      .find((n) => n.tagName === 'BUTTON' && n.textContent === 'Verify independent review');
    assert.ok(review && review.disabled !== true,
      'a mismatched ROOT engineering subject hid the bound run-worktree verification action');
    await review._listeners.click[0]();
    assert.strictEqual(review.disabled, false, 'refused verification did not re-enable the action');
    assert.strictEqual(review.textContent, 'Verify independent review');
    const activity = page.text('live-activity');
    assert.ok(/Review verification refused.*REVIEW-GATE-REFUSED/.test(activity),
      `canonical refusal code is missing: ${activity}`);
    assert.ok(/canonical exact-subject review gate did not pass/.test(activity),
      'canonical refusal reason is missing');
    assert.ok(!/review (ran|launched|completed)/i.test(activity),
      `refusal falsely claims a reviewer ran: ${activity}`);
    assert.ok(/CHECKS_PASSED/.test(page.text('runs-list')), 'refusal advanced the run state');
  });

  await atest('DOM: REVIEW_FAILED keeps an uncorroborated claim fail-closed and exposes bounded Retry', async () => {
    const checked = {
      generatedAt: '2026-08-29T10:00:00.000Z', engineering: { state: 'OK', verdict: 'BLOCKED',
        problems: [{ rule: 'ENGOS-REVIEW-REJECTED', detail: 'codex returned REJECT' }] },
      runsBinding: { state: 'BOUND', runId: 'RUN-REVIEW-FAILED',
        updatedAt: '2026-08-29T10:00:00.000Z', reason: 'bound' },
      integration: { connectors: [] },
      runs: [{ runId: 'RUN-REVIEW-FAILED', state: 'CHECKS_PASSED', objective: 'Correct exact review findings',
        checks: { passed: 11, total: 11 }, updatedAt: '2026-08-29T10:00:00.000Z' }],
    };
    const calls = [];
    const page = bootPage(fixtureState(), { fetch: async (path, options) => {
      calls.push({ path, options });
      if (path === '/api/status') return { ok: true, json: async () => checked };
      if (path === '/api/review-bind') return { ok: true, json: async () => ({
        runId: 'RUN-REVIEW-FAILED', state: 'REVIEW_FAILED', action: 'bind-independent-review',
        outcome: 'REFUSED', reasonCode: 'EXACT_SUBJECT_REVIEW_REFUSED', nextAction: 'retry',
      }) };
      if (path === '/api/retry') return { ok: true, json: async () => ({
        runId: 'RUN-REVIEW-FAILED', state: 'CORRECTING', action: 'retry', correction: 2,
      }) };
      throw new Error('unexpected request ' + path);
    } });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    let nodes = allNodes(page.document.getElementById('runs-list'));
    const verify = nodes.find((n) => n.tagName === 'BUTTON' && n.textContent === 'Verify independent review');
    assert.ok(verify, 'CHECKS_PASSED did not expose server verification');
    await verify._listeners.click[0]();
    assert.ok(/Independent review refused this exact checked version/.test(page.text('live-activity')),
      'the canonical refusal response was not explained in plain English');
    assert.ok(/CHECKS_PASSED/.test(page.text('runs-list')),
      'the POST response optimistically repainted REVIEW_FAILED before SSE evidence');

    const pushed = JSON.parse(JSON.stringify(checked));
    pushed.generatedAt = '2026-08-29T10:00:01.000Z';
    pushed.runs[0].state = 'REVIEW_FAILED';
    pushed.runs[0].updatedAt = '2026-08-29T10:00:01.000Z';
    pushed.runs[0].reviewFailure = {
      status: 'UNVERIFIED', reasonCode: 'REVIEW_FAILURE_UNCORROBORATED',
      summary: 'The run records a review-failure claim, but attested exact-subject gate evidence is unavailable in this projection.',
    };
    page.sse.listeners.status.forEach((fn) => fn({ data: JSON.stringify(pushed) }));
    nodes = allNodes(page.document.getElementById('runs-list'));
    assert.ok(/REVIEW_FAILED/.test(page.text('runs-list')));
    assert.ok(/review-failure claim.*attested exact-subject gate evidence is unavailable/i.test(page.text('runs-list')),
      'REVIEW_FAILED card promoted or hid the uncorroborated claim');
    assert.doesNotMatch(page.text('runs-list'), /found 2 blocking issue|codex returned REJECT/i,
      'mutable run JSON became a blocking reviewer verdict');
    const retry = nodes.find((n) => n.tagName === 'BUTTON' && n.textContent === 'Retry');
    assert.ok(retry && retry.disabled !== true, 'REVIEW_FAILED did not expose Retry');
    const commandRetry = findByAttr(page.document.getElementById('founder-body'), 'data-command-control')
      .find((n) => n.attrs['data-command-control'] === 'retry');
    assert.ok(commandRetry && commandRetry.tagName === 'BUTTON' && commandRetry.disabled !== true,
      'REVIEW_FAILED did not expose Retry in the primary command deck');
    const commandFields = findByAttr(page.document.getElementById('founder-body'), 'data-operator-field');
    assert.match(commandFields.find((n) => n.attrs['data-operator-field'] === 'current-action').textContent,
      /review-failure claim.*attested exact-subject gate evidence is unavailable/i,
      'CURRENT ACTION hid the fail-closed review evidence');
    assert.match(commandFields.find((n) => n.attrs['data-operator-field'] === 'next-step').textContent,
      /bounded correction route/,
      'NEXT STEP hid the safe bounded recovery action');
    assert.ok(!nodes.some((n) => n.tagName === 'BUTTON' && n.textContent === 'Verify independent review'),
      'review verification survived after the canonical refusal transition');
    await commandRetry._listeners.click[0]();
    const retryCall = calls.find((call) => call.path === '/api/retry');
    assert.deepStrictEqual(JSON.parse(retryCall.options.body), { runId: 'RUN-REVIEW-FAILED' },
      'Retry sent browser verdict or finding authority');
    const retryActivity = page.text('live-activity');
    assert.match(retryActivity, /Retry accepted for RUN-REVIEW-FAILED: state CORRECTING; action retry\./,
      'Retry did not report the canonical API state and action');
    assert.doesNotMatch(retryActivity, /Retry queued/,
      'Retry used the old hardcoded queued claim instead of the API result');
  });

  await atest('DOM: every retryable failure uses the exported helper and POSTs the canonical runId', async () => {
    for (const state of ['BUILD_FAILED', 'CHECKS_FAILED', 'REVIEW_FAILED']) {
      const runId = 'RUN-RETRY-' + state;
      const status = {
        generatedAt: '2026-08-30T13:00:00.000Z', runsState: 'OK',
        engineering: { state: 'OK', verdict: 'BLOCKED', problems: [], stages: [] },
        runsBinding: { state: 'BOUND', runId, updatedAt: '2026-08-30T13:00:00.000Z', reason: 'bound' },
        integration: { connectors: [] },
        runs: [{ runId, state, objective: 'Exercise bounded Retry',
          updatedAt: '2026-08-30T13:00:00.000Z' }],
      };
      const calls = [];
      const page = bootPage(fixtureState(), { fetch: async (path, options) => {
        calls.push({ path, options });
        if (path === '/api/status') return { ok: true, json: async () => status };
        if (path === '/api/retry') return { ok: true, json: async () => ({
          runId, state: 'CORRECTING', action: 'retry', correction: 1,
        }) };
        throw new Error('unexpected request ' + path);
      } });
      for (let i = 0; i < 10; i++) await Promise.resolve();
      assert.strictEqual(typeof page.sandbox.AEGIS_DASHBOARD.requestRunRetry, 'function',
        `${state} has no exported shared Retry helper`);
      const retry = allNodes(page.document.getElementById('runs-list'))
        .find((node) => node.tagName === 'BUTTON' && node.textContent === 'Retry');
      assert.ok(retry, `${state} has no run-history Retry control`);
      await retry._listeners.click[0]();
      const retryCalls = calls.filter((call) => call.path === '/api/retry');
      assert.strictEqual(retryCalls.length, 1, `${state} did not POST exactly one Retry request`);
      assert.deepStrictEqual(JSON.parse(retryCalls[0].options.body), { runId },
        `${state} Retry crossed fields beyond canonical runId`);
    }
  });

  await atest('DOM: model authentication failure names the non-executable Grok failover without exposing Retry', async () => {
    const runId = 'RUN-MODEL-AUTH-FAILURE';
    const status = {
      generatedAt: '2026-08-30T13:10:00.000Z', runsState: 'OK',
      engineering: { state: 'OK', verdict: 'BLOCKED', problems: [], stages: [] },
      runsBinding: { state: 'BOUND', runId, updatedAt: '2026-08-30T13:10:00.000Z', reason: 'bound' },
      integration: { connectors: [] },
      runs: [{ runId, state: 'BUILD_FAILED', objective: 'Continue after provider authentication failure',
        updatedAt: '2026-08-30T13:10:00.000Z', build: {
          mode: 'async', status: 'FAILED', exit: 1, retrySafe: false,
          recoveryCode: 'MODEL_AUTH_FAILURE',
          activity: { code: 'MODEL_AUTH_FAILURE', phase: 'BLOCKED', active: false,
            summary: 'Claude authentication failed' },
          failure: { code: 'MODEL_AUTH_FAILURE', provider: 'claude-subscription',
            summary: 'Claude authentication failed.' },
          failover: { state: 'NOT_EXECUTABLE', provider: 'grok-subscription', model: 'grok-4.6',
            reason: 'Grok is the next eligible builder, but automatic failover is not enabled for this beta.' },
        } }],
    };
    const page = bootPage(fixtureState(), { status });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    const fields = findByAttr(page.document.getElementById('founder-body'), 'data-operator-field');
    assert.match(fields.find((node) => node.attrs['data-operator-field'] === 'current-action').textContent,
      /Claude authentication failed.*Grok.*automatic failover is not enabled/i);
    assert.match(fields.find((node) => node.attrs['data-operator-field'] === 'next-step').textContent,
      /Re-authenticate Claude.*Grok.*automatic failover is not enabled/i);
    assert.match(page.text('runs-list'), /MODEL_AUTH_FAILURE/);
    assert.match(page.text('runs-list'), /Grok is the next eligible builder.*not enabled/i);
    assert.ok(!allNodes(page.document.getElementById('runs-list'))
      .some((node) => node.tagName === 'BUTTON' && node.textContent === 'Retry'),
    'unsafe same-provider Retry was exposed for MODEL_AUTH_FAILURE');
    assert.strictEqual(page.text('hud-core-status'), RUN_STATE_PLAIN.BLOCKED);
  });

  await atest('DOM: unverified worker termination is BLOCKED, never STOPPED, and exposes only administrative abandonment', async () => {
    const runId = 'RUN-TERMINATION-UNVERIFIED';
    const status = {
      generatedAt: '2026-08-30T13:15:00.000Z', runsState: 'OK',
      engineering: { state: 'OK', verdict: 'BLOCKED', problems: [], stages: [] },
      runsBinding: { state: 'BOUND', runId, updatedAt: '2026-08-30T13:15:00.000Z',
        evidenceState: 'OK', reason: 'bound' },
      integration: { connectors: [] },
      runs: [{ runId, state: 'BUILD_FAILED', objective: 'Contain an unverified worker descendant',
        updatedAt: '2026-08-30T13:15:00.000Z', build: {
          mode: 'async', status: 'FAILED', exit: 124, retrySafe: false,
          recoveryCode: 'TERMINATION_UNVERIFIED',
          activity: { code: 'TERMINATION_UNVERIFIED', phase: 'BLOCKED', active: false,
            summary: 'Termination could not be verified; retry is blocked' },
        } }],
    };
    const page = bootPage(fixtureState(), { status });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    const runText = page.text('runs-list');
    assert.match(runText, /Activity: TERMINATION_UNVERIFIED · Phase: BLOCKED · Active: NO/);
    assert.doesNotMatch(runText, /Phase: STOPPED|Builder stopped/i,
      'the dashboard presented an unverified descendant as stopped');
    const fields = findByAttr(page.document.getElementById('founder-body'), 'data-operator-field');
    assert.match(fields.find((node) => node.attrs['data-operator-field'] === 'current-action').textContent,
      /Termination could not be verified; retry is blocked/i);
    const buttons = allNodes(page.document.getElementById('runs-list'))
      .filter((node) => node.tagName === 'BUTTON').map((node) => node.textContent);
    assert.ok(buttons.includes('Cancel'), 'administrative abandonment was not available');
    assert.ok(!buttons.includes('Retry'), 'unsafe Retry was exposed while termination remained unverified');
    assert.strictEqual(page.text('hud-core-status'), RUN_STATE_PLAIN.BLOCKED);
  });

  await atest('DOM: BUILDING Cancel requires verified async ownership, disables pending, then repaints from SSE', async () => {
    const base = {
      generatedAt: '2026-08-26T12:00:00.000Z',
      engineering: { state: 'UNAVAILABLE' },
      runsBinding: { state: 'BOUND', runId: 'RUN-BUILD', updatedAt: '2026-08-26T12:00:00.000Z', reason: 'bound' },
      integration: { connectors: [] },
    };
    const noOwner = Object.assign({}, base, { runs: [{ runId: 'RUN-BUILD', state: 'BUILDING', objective: 'Dashboard',
      build: { mode: 'async', status: 'RUNNING', workerPid: null, cancelAvailable: false,
        activity: { code: 'RUNNING', phase: 'RUNNING', active: true, summary: 'Builder is running' },
        heartbeatAt: '2026-08-26T12:00:01.000Z', timedOut: false } }] });
    const unownedPage = bootPage(fixtureState(), { status: noOwner });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    const unownedButtons = allNodes(unownedPage.document.getElementById('runs-list'))
      .filter((n) => n.tagName === 'BUTTON' && /^Cancel/.test(n.textContent));
    assert.strictEqual(unownedButtons.length, 0,
      'BUILDING without the canonical cancellation capability must not expose Cancel');

    const running = JSON.parse(JSON.stringify(noOwner));
    running.runs[0].build.workerPid = 2468;
    const pidOnlyPage = bootPage(fixtureState(), { status: running });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    assert.ok(!allNodes(pidOnlyPage.document.getElementById('runs-list'))
      .some((n) => n.tagName === 'BUTTON' && /^Cancel/.test(n.textContent)),
    'a worker PID plus RUNNING telemetry must not fabricate cancellation authority');

    running.runs[0].build.cancelAvailable = true;
    running.runs[0].build.startedAt = '2026-08-26T12:00:00.000Z';
    running.runs[0].build.exit = 17;
    running.runs[0].build.stdoutTail = HOSTILE_WORKER_OUTPUT.source + '\n' + HOSTILE_WORKER_OUTPUT.pem;
    running.runs[0].build.stderrTail = HOSTILE_WORKER_OUTPUT.jwt + '\n' + HOSTILE_WORKER_OUTPUT.cookie;
    running.runs[0].build.rawOutput = HOSTILE_WORKER_OUTPUT.unlabelled;
    running.runs[0].build.modelOutput = HOSTILE_WORKER_OUTPUT.source;
    running.runs[0].build.transcript = HOSTILE_WORKER_OUTPUT.pem;
    let cancelCalls = 0;
    const page = bootPage(fixtureState(), { fetch: async (path) => {
      if (path === '/api/status') return { ok: true, json: async () => running };
      if (path === '/api/cancel') { cancelCalls++; return { ok: true, json: async () => ({ state: 'ABANDONED' }) }; }
      throw new Error('unexpected request ' + path);
    } });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    let nodes = allNodes(page.document.getElementById('runs-list'));
    let cancel = nodes.find((n) => n.tagName === 'BUTTON' && n.textContent === 'Cancel');
    assert.ok(cancel && cancel.disabled !== true, 'owned BUILDING run must expose enabled Cancel');
    const evidence = nodes.find((n) => n.attrs && n.attrs['data-build-evidence'] === 'RUNNING');
    assert.ok(evidence, 'run.build evidence was not rendered');
    assert.ok(/State: RUNNING — Builder is running/.test(evidence.textContent), 'state/current activity missing');
    assert.ok(/Activity: RUNNING · Phase: RUNNING · Active: YES/.test(evidence.textContent),
      'structured activity evidence missing');
    assert.ok(/Heartbeat: 2026-08-26T12:00:01.000Z/.test(evidence.textContent), 'heartbeat missing');
    assert.ok(/Exit: 17 · Timed out: NO/.test(evidence.textContent), 'exit/timeout evidence missing');
    for (const [kind, sentinel] of Object.entries(HOSTILE_WORKER_OUTPUT)) {
      assert.ok(!page.text('runs-list').includes(sentinel), `dashboard rendered ${kind} worker output`);
    }

    await cancel._listeners.click[0]();
    assert.strictEqual(cancelCalls, 1, 'Cancel must issue exactly one request');
    assert.strictEqual(cancel.disabled, true, 'Cancel must stay disabled while awaiting lifecycle evidence');
    assert.strictEqual(cancel.textContent, 'Cancel requested…');
    assert.ok(/waiting for lifecycle evidence/.test(page.text('live-activity')),
      'the dashboard must not optimistically claim cancellation before SSE evidence');

    const stopped = JSON.parse(JSON.stringify(running));
    stopped.generatedAt = '2026-08-26T12:00:03.000Z';
    stopped.runs[0].state = 'ABANDONED';
    stopped.runs[0].build.status = 'TERMINATED';
    stopped.runs[0].build.activity = {
      code: 'TERMINATED', phase: 'STOPPED', active: false, summary: 'Builder was terminated',
    };
    stopped.runs[0].build.endedAt = '2026-08-26T12:00:02.000Z';
    page.sse.listeners.status.forEach((fn) => fn({ data: JSON.stringify(stopped) }));
    nodes = allNodes(page.document.getElementById('runs-list'));
    assert.ok(/ABANDONED/.test(page.text('runs-list')), 'SSE did not repaint the terminal run state');
    assert.ok(/State: TERMINATED — Builder was terminated/.test(page.text('runs-list')),
      'SSE did not repaint terminal worker evidence');
    assert.ok(/Activity: TERMINATED · Phase: STOPPED · Active: NO/.test(page.text('runs-list')),
      'SSE did not repaint structured terminal activity');
    for (const [kind, sentinel] of Object.entries(HOSTILE_WORKER_OUTPUT)) {
      assert.ok(!page.text('runs-list').includes(sentinel), `terminal SSE rendered ${kind} worker output`);
    }
    assert.ok(!nodes.some((n) => n.tagName === 'BUTTON' && /^Cancel/.test(n.textContent)),
      'terminal SSE evidence must remove the active Cancel control');
  });

  await atest('RED: an SSE status push repaints connector usage without a page reload', async () => {
    const old = connectorFixture({ state: 'UNAVAILABLE', plain: 'no usage evidence' });
    const bootstrapStatus = {
      generatedAt: '2026-08-25T23:00:00.000Z',
      engineering: { state: 'OK', verdict: 'BLOCKED', lane: 'FULL', highRisk: true, laneWhy: [], riskReasons: [],
        subjectSha256: 'old000000000aaaa', problems: [], reviewerCompleteness: null, stages: [] },
      runs: [{ runId: 'RUN-A', state: 'BUILT', objective: 'OLD', updatedAt: '2026-08-25T10:00:00.000Z' }],
      runsBinding: { state: 'BOUND', runId: 'RUN-A', updatedAt: '2026-08-25T10:00:00.000Z', packetId: null,
        subjectSha256: 'old000000000aaaa', reason: 'bound' },
      cost: { state: 'UNAVAILABLE', reason: 'none' }, events: [],
      integration: { connectors: { state: 'OK', connectors: [old] } }, reviewers: [], knowledge: { state: 'OK', conflicts: 0 },
    };
    const page = bootPage(fixtureState(), { status: bootstrapStatus });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    let line = findByAttr(page.document.getElementById('connectors'), 'data-usage-state')[0];
    assert.strictEqual(line.attrs['data-usage-state'], 'UNAVAILABLE', 'precondition must show missing usage evidence');
    const pushed = JSON.parse(JSON.stringify(bootstrapStatus));
    pushed.generatedAt = '2026-08-26T10:00:01.000Z';
    pushed.integration.connectors.connectors[0].lastUsedByRun = {
      state: 'USED', runId: 'RUN-A', observedAt: '2026-08-26T10:00:00.000Z',
      operationId: 'op-a', ledgerConfirmed: true,
    };
    page.sse.listeners.status.forEach((fn) => fn({ data: JSON.stringify(pushed) }));
    line = findByAttr(page.document.getElementById('connectors'), 'data-usage-state')[0];
    assert.strictEqual(line.attrs['data-usage-state'], 'USED_CURRENT', 'live usage evidence did not replace the unavailable row');
    assert.ok(/Used by this run \(RUN-A\)/.test(line.textContent));
  });

  await atest('RED: an SSE status push repaints the founder summary with the newly bound run', async () => {
    const state = fixtureState({ runs: { state: 'OK',
      runs: [{ runId: 'RUN-OLD', state: 'BUILT', objective: 'OLD OBJECTIVE', updatedAt: '2026-08-25T10:00:00.000Z' }],
      current: { state: 'BOUND', runId: 'RUN-OLD', updatedAt: '2026-08-25T10:00:00.000Z', packetId: null,
        subjectSha256: 'old000000000aaaa', objective: 'OLD OBJECTIVE', reason: 'bound to RUN-OLD' } } });

    // The bootstrap GET returns the SAME state the page was generated with, so
    // any change below can only have come from the pushed event.
    const bootstrapStatus = {
      generatedAt: '2026-08-25T23:00:00.000Z',
      engineering: { state: 'OK', verdict: 'BLOCKED', lane: 'FULL', highRisk: true, laneWhy: [], riskReasons: [],
        subjectSha256: 'old000000000aaaa', problems: [], reviewerCompleteness: null, stages: [] },
      runs: [{ runId: 'RUN-OLD', state: 'BUILT', objective: 'OLD OBJECTIVE', updatedAt: '2026-08-25T10:00:00.000Z' }],
      runsBinding: { state: 'BOUND', runId: 'RUN-OLD', updatedAt: '2026-08-25T10:00:00.000Z', packetId: null,
        subjectSha256: 'old000000000aaaa', objective: 'OLD OBJECTIVE', reason: 'bound to RUN-OLD' },
      cost: { state: 'UNAVAILABLE', reason: 'none' }, events: [], integration: { connectors: [] }, reviewers: [],
      knowledge: { state: 'OK', conflicts: 0 },
    };
    const page = bootPage(state, { status: bootstrapStatus });
    // Let the bootstrap's awaits settle before pushing.
    for (let i = 0; i < 10; i++) await Promise.resolve();
    assert.ok(page.sse.listeners.status && page.sse.listeners.status.length,
      'the page never subscribed to the status stream');
    assert.ok(/OLD OBJECTIVE/.test(page.text('founder-body')), 'precondition: the old run should be showing');

    const pushed = JSON.parse(JSON.stringify(bootstrapStatus));
    pushed.generatedAt = '2026-08-26T10:00:01.000Z';
    pushed.engineering.verdict = 'READY_FOR_PR';
    pushed.engineering.subjectSha256 = 'new999999999bbbb';
    pushed.runs.unshift({ runId: 'RUN-NEW', state: 'BUILT', objective: 'NEW OBJECTIVE',
      updatedAt: '2026-08-26T10:00:00.000Z', packetId: 'builder-control/packets/P-NEW.json' });
    pushed.runsBinding = { state: 'BOUND', runId: 'RUN-NEW', updatedAt: '2026-08-26T10:00:00.000Z',
      packetId: 'builder-control/packets/P-NEW.json', subjectSha256: 'new999999999bbbb', objective: 'NEW OBJECTIVE',
      reason: 'bound to RUN-NEW' };
    page.sse.listeners.status.forEach((fn) => fn({ data: JSON.stringify(pushed) }));

    const after = page.text('founder-body');
    assert.ok(/NEW OBJECTIVE/.test(after), 'the pushed run did not replace the summary');
    assert.ok(!/What was requested: OLD OBJECTIVE/.test(after), 'the stale objective survived a live push');
    assert.ok(/RUN-NEW/.test(after), 'the newly bound run id is not shown');
    assert.ok(/new999999999/.test(after), 'the summary is not bound to the pushed subject hash');
    assert.ok(/P-NEW\.json/.test(after), 'the pushed packet id is not shown');
    assert.ok(/The build finished and is waiting for deterministic checks/.test(after),
      'the pushed BUILT lifecycle did not remain authoritative over a premature READY_FOR_PR label');
    assert.ok(!/Ready to open a pull request|Open the pull request/.test(after),
      'a BUILT run exposed pull-request guidance before canonical review binding');
    // The whole point of the binding: the same subject hash governs both.
    assert.ok(!/old000000000/.test(after), 'the old subject hash is still on screen after the repaint');
  });

  // ── handoff indicator, driven exactly as the server drives it ────────────
  function handoffStatus() {
    return {
      generatedAt: '2026-08-28T10:00:00.000Z',
      engineering: { state: 'UNAVAILABLE' },
      integration: { connectors: [] },
      reviewers: [], events: [],
      runs: [{ runId: 'RUN-HANDOFF', state: 'BUILDING', objective: 'Add the handoff indicator',
        updatedAt: '2026-08-28T10:00:00.000Z', transitions: 4,
        route: { model: 'claude-opus-5', execution: 'claude-cli', source: 'tool-router.cjs routeRole' },
        build: { mode: 'async', status: 'RUNNING', workerPid: 99, startedAt: '2026-08-28T09:55:00.000Z',
          activity: { active: true, code: 'RUNNING', phase: 'RUNNING', summary: 'Editing the dashboard.' } } }],
      runsBinding: { state: 'BOUND', runId: 'RUN-HANDOFF', updatedAt: '2026-08-28T10:00:00.000Z', reason: 'bound' },
    };
  }

  function movedToBuilt() {
    const built = JSON.parse(JSON.stringify(handoffStatus()));
    built.generatedAt = '2026-08-28T10:04:00.000Z';
    built.runs[0].state = 'BUILT';
    built.runs[0].updatedAt = '2026-08-28T10:03:00.000Z';
    built.runs[0].transitions = 5;
    built.runs[0].build.status = 'EXITED';
    built.runs[0].build.activity = { active: false, code: 'EXITED', phase: 'STOPPED', summary: 'Worker exited.' };
    built.runsBinding.updatedAt = '2026-08-28T10:03:00.000Z';
    return built;
  }

  await atest('DOM: a canonical stage change between live pushes activates one plain-English handoff', async () => {
    const page = bootPage(fixtureState(), { status: handoffStatus() });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    assert.strictEqual(handoffNode(page).attrs['data-handoff-state'], 'INACTIVE',
      'precondition: one observation of a BUILDING run is not a transition');

    page.sse.listeners.status.forEach((fn) => fn({ data: JSON.stringify(movedToBuilt()) }));
    const node = handoffNode(page);
    assert.strictEqual(node.attrs['data-handoff-state'], 'ACTIVE',
      'a real canonical stage change did not activate the indicator');
    assert.notStrictEqual(node.hidden, true, 'an observed handoff must actually be visible');
    const text = node.textContent;
    assert.ok(/claude-opus-5 \(claude-cli\) handed off to the deterministic checks\./.test(text),
      `the routed model and its destination are not both named: ${text}`);
    assert.ok(/The build finished and is waiting for deterministic checks\./.test(text),
      `the current task is not stated in plain English: ${text}`);
    assert.ok(/canonical BUILDING → BUILT, run record written 2026-08-28T10:03:00\.000Z/.test(text),
      `the exact canonical states and the record timestamp are not cited: ${text}`);
    // The recorded transition and the current action are two different kinds of
    // fact and are read as two labelled groups, so a move the ledger wrote at
    // 10:03 cannot be read as something starting at this moment.
    const parts = handoffParts(page);
    assert.match(parts.RECORDED, /LAST RECORDED HANDOFF/,
      `the recorded half of the strip is not labelled as recorded history: ${parts.RECORDED}`);
    assert.match(parts.RECORDED, /run record written 2026-08-28T10:03:00\.000Z/,
      `the canonical record time does not sit with the transition it belongs to: ${parts.RECORDED}`);
    assert.ok(!/The build finished and is waiting/.test(parts.RECORDED),
      `the current action leaked into the recorded transition: ${parts.RECORDED}`);
    assert.match(parts.CURRENT, /CURRENT ACTIONThe build finished and is waiting for deterministic checks\./,
      `the current action is not labelled as the current action: ${parts.CURRENT}`);
    assert.ok(!/handed off|BUILDING → BUILT|run record written/.test(parts.CURRENT),
      `the recorded transition leaked into the current action: ${parts.CURRENT}`);
    assert.ok(/claude-opus-5 \(claude-cli\) handed off to the deterministic checks\./.test(page.text('live')),
      'the transition was never announced to assistive technology');
  });

  await atest('DOM: repeating the same canonical state repaints without inventing a second handoff', async () => {
    const page = bootPage(fixtureState(), { status: handoffStatus() });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    page.sse.listeners.status.forEach((fn) => fn({ data: JSON.stringify(movedToBuilt()) }));
    const first = handoffNode(page).textContent;

    const repeat = movedToBuilt();
    repeat.generatedAt = '2026-08-28T10:05:00.000Z';   // a new push, the same run record
    page.sse.listeners.status.forEach((fn) => fn({ data: JSON.stringify(repeat) }));
    const node = handoffNode(page);
    assert.strictEqual(node.attrs['data-handoff-state'], 'ACTIVE',
      'the observed handoff was dropped by a repaint of the same evidence');
    assert.strictEqual(node.textContent, first,
      'a repaint of unchanged state rewrote the handoff — a repaint is not a transition');
  });

  // The defect this proves out: the strip read "X handed off to Y. Now: <task>"
  // as one sentence, so a transition the ledger recorded minutes ago was read
  // as something happening at this moment, and a changed task made the whole
  // line look like a fresh move. The two facts are now separate, and each has
  // to survive the other changing.
  await atest('DOM: a same-state repaint updates the current action and leaves the recorded handoff untouched', async () => {
    const routed = {
      generatedAt: '2026-08-28T10:00:00.000Z',
      engineering: { state: 'UNAVAILABLE' },
      integration: { connectors: [] },
      reviewers: [], events: [],
      runs: [{ runId: 'RUN-SPLIT', state: 'ROUTED', objective: 'Separate history from now',
        updatedAt: '2026-08-28T10:00:00.000Z', transitions: 3,
        route: { model: 'claude-opus-5', execution: 'claude-cli', source: 'tool-router.cjs routeRole' } }],
      runsBinding: { state: 'BOUND', runId: 'RUN-SPLIT', updatedAt: '2026-08-28T10:00:00.000Z', reason: 'bound' },
    };
    // One canonical transition, then TWO readings of the same BUILDING state
    // whose recorded activity sentence differs. Only the second changes.
    const building = (updatedAt, summary) => {
      const next = JSON.parse(JSON.stringify(routed));
      next.generatedAt = updatedAt;
      next.runs[0].state = 'BUILDING';
      next.runs[0].updatedAt = updatedAt;
      next.runs[0].transitions = 4;
      next.runs[0].build = { mode: 'async', status: 'RUNNING', startedAt: '2026-08-28T10:03:00.000Z',
        activity: { active: true, code: 'RUNNING', phase: 'RUNNING', summary } };
      next.runsBinding.updatedAt = updatedAt;
      return next;
    };

    const page = bootPage(fixtureState(), { status: routed });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    assert.strictEqual(handoffNode(page).attrs['data-handoff-state'], 'INACTIVE',
      'precondition: the first sighting of a routed run is not a transition');

    page.sse.listeners.status.forEach((fn) => fn({ data: JSON.stringify(
      building('2026-08-28T10:03:00.000Z', 'Editing the dashboard.')) }));
    const first = handoffParts(page);
    assert.match(first.RECORDED, /AEGIS capability routing handed off to claude-opus-5 \(claude-cli\)\./,
      `the recorded transition does not name both canonical actors: ${first.RECORDED}`);
    assert.match(first.RECORDED, /canonical ROUTED → BUILDING, run record written 2026-08-28T10:03:00\.000Z/,
      `the recorded transition does not cite its canonical states and record time: ${first.RECORDED}`);
    assert.match(first.CURRENT, /CURRENT ACTIONEditing the dashboard\./,
      `the current action is not the recorded activity sentence: ${first.CURRENT}`);
    const announced = page.text('live');
    assert.match(announced, /Last recorded handoff: AEGIS capability routing handed off to claude-opus-5 \(claude-cli\)\./,
      `the transition was not announced as recorded history: ${announced}`);

    // A later push of the SAME canonical state with a different recorded
    // activity sentence. No transition happened, so the recorded half — actors,
    // exact states and the run-record time — must be byte-identical.
    page.sse.listeners.status.forEach((fn) => fn({ data: JSON.stringify(
      building('2026-08-28T10:09:00.000Z', 'Running the deterministic checks.')) }));
    const second = handoffParts(page);
    assert.strictEqual(handoffNode(page).attrs['data-handoff-state'], 'ACTIVE',
      'the observed handoff was dropped by a repaint that changed only the current action');
    assert.strictEqual(second.RECORDED, first.RECORDED,
      `a repaint rewrote recorded history: ${first.RECORDED} → ${second.RECORDED}`);
    assert.ok(!/10:09:00/.test(second.RECORDED),
      `the recorded transition adopted the time of a repaint that moved nothing: ${second.RECORDED}`);
    assert.match(second.CURRENT, /CURRENT ACTIONRunning the deterministic checks\./,
      `the current action did not follow the newly recorded activity sentence: ${second.CURRENT}`);
    assert.ok(!/Editing the dashboard\./.test(second.CURRENT),
      `the superseded current action survived the repaint: ${second.CURRENT}`);
    // Announced once per transition, not once per repaint: nothing moved, so
    // the live region must still hold the one announcement it already made.
    assert.strictEqual(page.text('live'), announced,
      'a repaint that moved nothing announced the same handoff a second time');
  });

  await atest('DOM: out-of-order and uncorroborated evidence never light the handoff', async () => {
    for (const c of [
      { name: 'older evidence contradicting what was already read',
        mutate: (s) => { s.runs[0].state = 'BUILDING'; s.runs[0].updatedAt = '2026-08-28T09:59:00.000Z';
          s.runs[0].transitions = 4; } },
      { name: 'a state change the canonical transition counter does not corroborate',
        mutate: (s) => { s.runs[0].state = 'CHECKS_PASSED'; s.runs[0].updatedAt = '2026-08-28T10:06:00.000Z';
          s.runs[0].transitions = 5; } },
      { name: 'a run with no orderable timestamp',
        mutate: (s) => { s.runs[0].state = 'CHECKS_PASSED'; s.runs[0].updatedAt = null; s.runs[0].transitions = 9; } },
    ]) {
      const page = bootPage(fixtureState(), { status: handoffStatus() });
      for (let i = 0; i < 10; i++) await Promise.resolve();
      page.sse.listeners.status.forEach((fn) => fn({ data: JSON.stringify(movedToBuilt()) }));
      assert.strictEqual(handoffNode(page).attrs['data-handoff-state'], 'ACTIVE', `${c.name}: precondition failed`);

      const bad = movedToBuilt();
      bad.generatedAt = '2026-08-28T10:07:00.000Z';
      c.mutate(bad);
      bad.runsBinding.updatedAt = bad.runs[0].updatedAt;
      page.sse.listeners.status.forEach((fn) => fn({ data: JSON.stringify(bad) }));
      const node = handoffNode(page);
      assert.strictEqual(node.attrs['data-handoff-state'], 'INACTIVE',
        `${c.name}: the indicator claimed a handoff the evidence does not support`);
      assert.strictEqual(node.textContent, '', `${c.name}: an unsupported handoff still rendered text`);
    }
  });

  await atest('DOM: a reading the transition counter refuses never becomes the baseline for the next handoff', async () => {
    // The subtle version of the fabrication this indicator exists to prevent.
    // Refusing to CLAIM a handoff off uncorroborated evidence is only half the
    // rule: if that same evidence is still recorded as "what we last saw", the
    // next real transition is either described as starting from a state the
    // page already declined to believe, or — as here — silently swallowed,
    // because the refused reading and the real one name the same state.
    const page = bootPage(fixtureState(), { status: handoffStatus() });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    page.sse.listeners.status.forEach((fn) => fn({ data: JSON.stringify(movedToBuilt()) }));
    assert.strictEqual(handoffNode(page).attrs['data-handoff-state'], 'ACTIVE',
      'precondition: BUILDING → BUILT should have been observed');

    // The state moves, but the canonical transition counter does not: refused.
    const refused = movedToBuilt();
    refused.generatedAt = '2026-08-28T10:07:00.000Z';
    refused.runs[0].state = 'CHECKS_PASSED';
    refused.runs[0].updatedAt = '2026-08-28T10:06:00.000Z';
    refused.runsBinding.updatedAt = refused.runs[0].updatedAt;
    page.sse.listeners.status.forEach((fn) => fn({ data: JSON.stringify(refused) }));
    assert.strictEqual(handoffNode(page).attrs['data-handoff-state'], 'INACTIVE',
      'precondition: an uncorroborated state change must not light the strip');

    // The corroborated move out of BUILT arrives afterwards, and is real.
    const real = movedToBuilt();
    real.generatedAt = '2026-08-28T10:09:00.000Z';
    real.runs[0].state = 'CHECKS_PASSED';
    real.runs[0].updatedAt = '2026-08-28T10:08:00.000Z';
    real.runs[0].transitions = 6;
    real.runsBinding.updatedAt = real.runs[0].updatedAt;
    page.sse.listeners.status.forEach((fn) => fn({ data: JSON.stringify(real) }));

    const node = handoffNode(page);
    assert.strictEqual(node.attrs['data-handoff-state'], 'ACTIVE',
      'the refused reading was kept as the baseline, so the real canonical transition out of BUILT was never reported');
    assert.ok(/canonical BUILT → CHECKS_PASSED, run record written 2026-08-28T10:08:00\.000Z/.test(node.textContent),
      `the reported transition does not start from the last corroborated state: ${node.textContent}`);
    assert.ok(/the deterministic checks handed off to independent review\./.test(node.textContent),
      `the plain-English actors do not match the canonical states: ${node.textContent}`);
  });

  await atest('DOM: a newly bound, previously unseen run inherits no handoff from the run before it', async () => {
    const page = bootPage(fixtureState(), { status: handoffStatus() });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    page.sse.listeners.status.forEach((fn) => fn({ data: JSON.stringify(movedToBuilt()) }));
    assert.strictEqual(handoffNode(page).attrs['data-handoff-state'], 'ACTIVE', 'precondition failed');

    const other = movedToBuilt();
    other.generatedAt = '2026-08-28T11:00:00.000Z';
    other.runs = [{ runId: 'RUN-OTHER', state: 'BUILT', objective: 'A different run',
      updatedAt: '2026-08-28T11:00:00.000Z', transitions: 5 }];
    other.runsBinding = { state: 'BOUND', runId: 'RUN-OTHER', updatedAt: '2026-08-28T11:00:00.000Z', reason: 'bound' };
    page.sse.listeners.status.forEach((fn) => fn({ data: JSON.stringify(other) }));
    const node = handoffNode(page);
    assert.strictEqual(node.attrs['data-handoff-state'], 'INACTIVE',
      'a different run inherited a handoff that was observed for another run');
    assert.ok(!/handed off/.test(page.text('founder-body')),
      'the previous run’s handoff sentence survived onto an unrelated run');
  });

  await atest('DOM: a proven transition marks the origin station and names both ends of the path handoff', async () => {
    const page = bootPage(fixtureState(), { status: handoffStatus() });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    assert.strictEqual(corePathHandoff(page).attrs['data-core-handoff'], 'INACTIVE',
      'precondition: one observation of a BUILDING run is not a transition');

    // BUILDING → BUILT is a canonical move inside one station: the station is
    // current, and it must not also be drawn as the place the run came from.
    page.sse.listeners.status.forEach((fn) => fn({ data: JSON.stringify(movedToBuilt()) }));
    let roles = stationRoles(page);
    assert.strictEqual(roles.build, 'CURRENT', 'the canonical BUILT state lost its own station');
    assert.ok(!Object.values(roles).includes('HANDED FROM'),
      'a move inside one station was drawn as a handoff between two stations');
    assert.match(corePathHandoff(page).textContent, /Canonical BUILDING → BUILT/,
      'the path did not report the proven in-station transition in canonical terms');

    // BUILT → CHECKS_PASSED crosses stations, corroborated by the counter.
    const real = movedToBuilt();
    real.generatedAt = '2026-08-28T10:09:00.000Z';
    real.runs[0].state = 'CHECKS_PASSED';
    real.runs[0].updatedAt = '2026-08-28T10:08:00.000Z';
    real.runs[0].transitions = 6;
    real.runsBinding.updatedAt = real.runs[0].updatedAt;
    page.sse.listeners.status.forEach((fn) => fn({ data: JSON.stringify(real) }));
    roles = stationRoles(page);
    assert.strictEqual(roles.checks, 'CURRENT', 'the run moved but the current station did not');
    assert.strictEqual(roles.build, 'HANDED FROM', 'the proven origin station is not marked');
    assert.strictEqual(Object.values(roles).filter((role) => role === 'NOT CURRENT').length, 7,
      'a station with no canonical evidence on it was still marked');
    const line = corePathHandoff(page);
    assert.strictEqual(line.attrs['data-core-handoff'], 'ACTIVE', 'a proven crossing did not reach the path');
    assert.strictEqual(line.hidden, false, 'a proven handoff must actually be visible');
    assert.match(line.textContent,
      /Last proven handoff: the deterministic checks handed off to independent review\./,
      `the path handoff is not readable in plain English: ${line.textContent}`);
    assert.match(line.textContent,
      /Canonical BUILT → CHECKS_PASSED, run record written 2026-08-28T10:08:00\.000Z\./,
      `the path handoff does not cite the exact canonical states and record time: ${line.textContent}`);
  });

  await atest('DOM: a refused reading moves the station but never lights a handoff on the path', async () => {
    // The station highlight is the run record's own state field, which every
    // other instrument on this page already reads. The handoff claim is not:
    // when the canonical transition counter refuses to corroborate the change,
    // the path must show where the run says it is and claim no move at all.
    const page = bootPage(fixtureState(), { status: handoffStatus() });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    page.sse.listeners.status.forEach((fn) => fn({ data: JSON.stringify(movedToBuilt()) }));
    assert.strictEqual(corePathHandoff(page).attrs['data-core-handoff'], 'ACTIVE', 'precondition failed');

    const refused = movedToBuilt();
    refused.generatedAt = '2026-08-28T10:07:00.000Z';
    refused.runs[0].state = 'CHECKS_PASSED';
    refused.runs[0].updatedAt = '2026-08-28T10:06:00.000Z';
    refused.runsBinding.updatedAt = refused.runs[0].updatedAt;
    page.sse.listeners.status.forEach((fn) => fn({ data: JSON.stringify(refused) }));
    const roles = stationRoles(page);
    assert.strictEqual(roles.checks, 'CURRENT', 'the path stopped reporting the canonical run state');
    assert.ok(!Object.values(roles).includes('HANDED FROM'),
      'an uncorroborated state change was drawn as a completed handoff');
    const line = corePathHandoff(page);
    assert.strictEqual(line.attrs['data-core-handoff'], 'INACTIVE',
      'the path claimed a handoff the transition counter refused');
    assert.strictEqual(line.textContent, '', 'a refused handoff still rendered a sentence');
  });

  await atest('DOM: an unrelated newly bound run inherits no station handoff and invents no identity', async () => {
    const page = bootPage(fixtureState(), { status: handoffStatus() });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    page.sse.listeners.status.forEach((fn) => fn({ data: JSON.stringify(movedToBuilt()) }));
    assert.strictEqual(corePathHandoff(page).attrs['data-core-handoff'], 'ACTIVE', 'precondition failed');

    const other = movedToBuilt();
    other.generatedAt = '2026-08-28T11:00:00.000Z';
    other.runs = [{ runId: 'RUN-OTHER', state: 'BUILT', objective: 'A different run',
      updatedAt: '2026-08-28T11:00:00.000Z', transitions: 5 }];
    other.runsBinding = { state: 'BOUND', runId: 'RUN-OTHER', updatedAt: '2026-08-28T11:00:00.000Z', reason: 'bound' };
    page.sse.listeners.status.forEach((fn) => fn({ data: JSON.stringify(other) }));
    const roles = stationRoles(page);
    assert.strictEqual(roles.build, 'CURRENT', 'the newly bound run lost its own canonical station');
    assert.ok(!Object.values(roles).includes('HANDED FROM'),
      'a different run inherited a station handoff observed for another run');
    assert.strictEqual(corePathHandoff(page).attrs['data-core-handoff'], 'INACTIVE',
      'the previous run’s proven handoff survived onto an unrelated run');
    assert.doesNotMatch(page.text('core-path-note'), /claude-opus-5/,
      'the previous run’s recorded model was carried onto a run whose own record names none');
  });

  await atest('RED: a malformed live push never blanks or half-paints the summary', async () => {
    const state = fixtureState({ runs: { state: 'OK',
      runs: [{ runId: 'RUN-OLD', state: 'BUILT', objective: 'OLD OBJECTIVE', updatedAt: '2026-08-25T10:00:00.000Z' }],
      current: { state: 'BOUND', runId: 'RUN-OLD', updatedAt: '2026-08-25T10:00:00.000Z', packetId: null,
        subjectSha256: 'old000000000aaaa', objective: 'OLD OBJECTIVE', reason: 'bound to RUN-OLD' } } });
    const page = bootPage(state, { status: { runs: [], runsBinding: { state: 'UNAVAILABLE', reason: 'none bound' }, engineering: { state: 'UNAVAILABLE' } } });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    page.sse.listeners.status.forEach((fn) => fn({ data: 'not json{' }));
    const after = page.text('founder-body');
    assert.ok(/Current run/.test(after) || /UNAVAILABLE/.test(after),
      'a malformed push must leave the last honest render standing, not an empty panel');
  });

  // ── functional-beta review boundary ───────────────────────────────────────
  // The failure this guards against is a quiet one. A CHECKS_PASSED run has
  // passed everything this machine can decide by itself, so the deck has every
  // opportunity to look finished; the one thing still owed is a review this
  // process cannot perform. Saying nothing there reads as "nothing is needed",
  // and saying it too warmly reads as "handled". Both are the same lie in
  // different tones, so this proof holds the deck to stating the requirement
  // AND the boundary, and to never describing a reviewer it did not launch.
  await atest('DOM: only runsBinding may select a CHECKS_PASSED run for review binding', async () => {
    const checkedRun = { runId: 'RUN-SOLE-CHECKED', state: 'CHECKS_PASSED',
      objective: 'A sole checked array item', checks: { passed: 2, total: 2, outcome: 'PASS' },
      updatedAt: '2026-08-28T09:00:00.000Z' };
    const base = {
      generatedAt: '2026-08-28T09:00:00.000Z',
      engineering: { state: 'OK', verdict: 'READY_FOR_PR', subjectSha256: 'a'.repeat(64),
        subjectPaths: ['builder-control/dashboard/index.html'], problems: [],
        reviewerCompleteness: passingReviewCompleteness() },
      integration: { connectors: [] },
      runs: [checkedRun],
    };

    for (const scenario of [
      { label: 'unavailable binding', binding: { state: 'UNAVAILABLE', reason: 'no authoritative binding' } },
      { label: 'ghost binding', binding: { state: 'BOUND', runId: 'RUN-NOT-PRESENT', reason: 'bound run absent' } },
    ]) {
      const status = Object.assign({}, base, { runsBinding: scenario.binding });
      const page = bootPage(fixtureState(), { fetch: async (path) => {
        if (path === '/api/status') return { ok: true, json: async () => status };
        throw new Error('unexpected request ' + path);
      } });
      for (let i = 0; i < 10; i++) await Promise.resolve();
      const founder = page.text('founder-body');
      assert.ok(/No active task/.test(founder) && /Nothing is currently running/.test(founder),
        `${scenario.label} promoted the sole array item to current: ${founder}`);
      assert.ok(!/appears ready for server verification/.test(founder),
        `${scenario.label} exposed a bind action without a present bound run`);
      assert.ok(!allNodes(page.document.getElementById('runs-list'))
        .some((n) => n.tagName === 'BUTTON' && n.textContent === 'Verify independent review'),
      `${scenario.label} exposed a review-bind control on an unbound history row`);
    }

    const boundStatus = Object.assign({}, base, { runsBinding: {
      state: 'BOUND', runId: checkedRun.runId, updatedAt: checkedRun.updatedAt,
      subjectState: 'UNLINKED', subjectSha256: null, runSubjectSha256: null,
      gateSubjectSha256: 'a'.repeat(64), reason: 'canonical bound run',
    } });
    const bound = bootPage(fixtureState(), { fetch: async (path) => {
      if (path === '/api/status') return { ok: true, json: async () => boundStatus };
      throw new Error('unexpected request ' + path);
    } });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    assert.ok(/appears ready for server verification/.test(bound.text('founder-body')),
      'a canonically bound CHECKS_PASSED + UNLINKED run lost its server-verification action');
    assert.ok(allNodes(bound.document.getElementById('runs-list'))
      .some((n) => n.tagName === 'BUTTON' && n.textContent === 'Verify independent review'),
    'a canonically bound CHECKS_PASSED run lost its review-bind control');
  });

  await atest('DOM: a complete LIGHT lane with zero required reviewers keeps the bind control', async () => {
    const subject = 'a'.repeat(64);
    const run = { runId: 'RUN-LIGHT-NOREVIEW', state: 'CHECKS_PASSED',
      objective: 'Verify a low-risk visual adjustment', checks: { passed: 2, total: 2, outcome: 'PASS' },
      updatedAt: '2026-08-28T09:00:00.000Z' };
    const status = {
      generatedAt: '2026-08-28T09:00:00.000Z',
      engineering: { state: 'OK', verdict: 'READY_FOR_PR', lane: 'LIGHT', highRisk: false,
        subjectSha256: subject, subjectPaths: ['builder-control/dashboard/index.html'], problems: [],
        reviewerCompleteness: { subjectSha256: subject, required: [], complete: true,
          pathCoverage: { total: 1,
            coveredByEveryRequiredReviewer: ['builder-control/dashboard/index.html'],
            notCoveredByEveryRequiredReviewer: [] }, rows: [] } },
      runsBinding: { state: 'BOUND', runId: run.runId, updatedAt: run.updatedAt,
        subjectState: 'UNLINKED', subjectSha256: null, runSubjectSha256: null,
        gateSubjectSha256: subject, reason: 'canonical bound run' },
      integration: { connectors: [] }, reviewers: [], runs: [run],
    };
    const page = bootPage(fixtureState(), { fetch: async (requestPath) => {
      if (requestPath === '/api/status') return { ok: true, json: async () => status };
      throw new Error('unexpected request ' + requestPath);
    } });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    assert.ok(allNodes(page.document.getElementById('runs-list'))
      .some((node) => node.tagName === 'BUTTON' && node.textContent === 'Verify independent review'),
    'the valid zero-reviewer LIGHT lane hid the canonical server-verification control');
  });

  await atest('DOM: a CHECKS_PASSED run distinguishes existing review evidence from missing review work and never claims it launched a reviewer', async () => {
    const checked = {
      generatedAt: '2026-08-28T09:00:00.000Z',
      engineering: { state: 'OK', verdict: 'READY_FOR_PR', subjectSha256: 'a'.repeat(64),
        subjectPaths: ['builder-control/dashboard/index.html'], problems: [],
        reviewerCompleteness: passingReviewCompleteness() },
      runsBinding: { state: 'BOUND', runId: 'RUN-EXTREVIEW', updatedAt: '2026-08-28T09:00:00.000Z',
        subjectState: 'UNLINKED', subjectSha256: null, runSubjectSha256: null,
        gateSubjectSha256: 'a'.repeat(64), reason: 'bound' },
      integration: { connectors: [] },
      runs: [{ runId: 'RUN-EXTREVIEW', state: 'CHECKS_PASSED', objective: 'Bind existing review evidence',
        checks: { passed: 2, total: 2, outcome: 'PASS' }, updatedAt: '2026-08-28T09:00:00.000Z' }],
    };
    const calls = [];
    const page = bootPage(fixtureState(), { fetch: async (path, options) => {
      calls.push({ path, options });
      if (path === '/api/status') return { ok: true, json: async () => checked };
      if (path === '/api/review-bind') return { ok: true, json: async () => ({
        runId: 'RUN-EXTREVIEW', state: 'REVIEW_BOUND', action: 'bind-independent-review',
        subjectSha256: 'a'.repeat(64), nextAction: 'checkpoint',
      }) };
      throw new Error('unexpected request ' + path);
    } });
    for (let i = 0; i < 10; i++) await Promise.resolve();

    // (1) The real post-checks projection is UNLINKED because the bind action
    // is what records run.subject. Complete gate-subject evidence must still
    // produce one truthful bind action instead of inventing a prerequisite.
    // not a request to commission another review or open a PR prematurely.
    const nextStep = findByAttr(page.document.getElementById('founder-body'), 'data-operator-field')
      .find((n) => n.attrs['data-operator-field'] === 'next-step');
    assert.ok(nextStep, 'the pilot deck exposes no NEXT STEP field');
    assert.ok(/appears ready for server verification/.test(nextStep.textContent),
      `complete review evidence did not produce the server-verification action: ${nextStep.textContent}`);
    assert.ok(/only the server can approve and bind it/.test(nextStep.textContent),
      `pre-bind browser copy claims authority the server owns: ${nextStep.textContent}`);
    assert.ok(!/External independent review is required/.test(nextStep.textContent),
      `complete review evidence was presented as review work still owed: ${nextStep.textContent}`);
    assert.ok(!/No next action is recorded yet/.test(nextStep.textContent),
      'a CHECKS_PASSED run still falls through to the silent next-step fallback');
    assert.ok(/starts no new review and pays for nothing/.test(nextStep.textContent),
      `the bind action drops the no-launch boundary: ${nextStep.textContent}`);
    assert.ok(!/(?:This dashboard|It) does not launch or pay for reviews/.test(nextStep.textContent),
      `the deck still denies the page can request a review at all: ${nextStep.textContent}`);
    assert.ok(!/Open the pull request for review/.test(nextStep.textContent),
      `CHECKS_PASSED preserved a contradictory PR action: ${nextStep.textContent}`);
    assert.ok(!/Ready to open a pull request|Open the pull request/.test(page.text('founder-body')),
      `pre-bind CHECKS_PASSED founder evidence contains contradictory PR guidance: ${page.text('founder-body')}`);
    const currentAction = findByAttr(page.document.getElementById('founder-body'), 'data-operator-field')
      .find((n) => n.attrs['data-operator-field'] === 'current-action');
    assert.ok(currentAction && /current gate subject appears ready for server verification.*Only AEGIS can approve and bind it to this run/.test(currentAction.textContent),
      `CURRENT ACTION overstates or hides the server-verification candidate: ${currentAction && currentAction.textContent}`);
    assert.ok(!/waiting for independent review evidence/.test(currentAction.textContent),
      `CURRENT ACTION contradicts the completed review evidence: ${currentAction.textContent}`);
    assert.strictEqual(page.text('hud-review-state'),
      REVIEW_COVERAGE_PLAIN['EVIDENCE APPEARS READY FOR SERVER VERIFICATION'],
      'the HUD falsely reports proven bind readiness before server verification');
    assert.strictEqual(page.document.getElementById('hud-review-state').attrs['data-hud-code'],
      'EVIDENCE APPEARS READY FOR SERVER VERIFICATION',
      'the HUD review footer dropped the exact coverage code behind its plain words');
    assert.ok(/appears ready for server verification/.test(page.text('hud-decisions')),
      `the HUD hides the remaining server-verification action: ${page.text('hud-decisions')}`);
    assert.ok(!/None right now/.test(page.text('hud-decisions')),
      'the HUD reports no action while review evidence still needs binding');

    for (const scenario of [
      { label: 'validation fallback', engineering: { state: 'OK', verdict: 'READY_FOR_DETERMINISTIC_VALIDATION',
        subjectSha256: 'a'.repeat(64) },
        expected: /Independent-review evidence is not yet complete or its status is unavailable/,
        forbidden: /Run the deterministic checks/, reviewBoundary: true },
      // Unreadable gate evidence must say which evidence is absent and where it
      // is readable, not hand back an unexplained "resolve the blocker".
      { label: 'unavailable engineering', engineering: { state: 'UNAVAILABLE' },
        expected: /The gate evidence for this code version could not be read.*Use "Show changes and checks"/,
        forbidden: /No next action is recorded yet/, reviewBoundary: false },
    ]) {
      const status = Object.assign({}, checked, { engineering: scenario.engineering });
      const alternate = bootPage(fixtureState(), { fetch: async (path) => {
        if (path === '/api/status') return { ok: true, json: async () => status };
        throw new Error('unexpected request ' + path);
      } });
      for (let i = 0; i < 10; i++) await Promise.resolve();
      const alternateNext = findByAttr(alternate.document.getElementById('founder-body'), 'data-operator-field')
        .find((n) => n.attrs['data-operator-field'] === 'next-step');
      assert.ok(alternateNext && scenario.expected.test(alternateNext.textContent),
        `${scenario.label} presented unknown review evidence as ready: ${alternateNext && alternateNext.textContent}`);
      if (scenario.reviewBoundary) {
        assert.ok(/starts no new review and pays for nothing/.test(alternateNext.textContent),
          `${scenario.label} suppressed the bind-only boundary: ${alternateNext.textContent}`);
        assert.ok(/Requesting a review is a separate, explicit act/.test(alternateNext.textContent),
          `${scenario.label} presented verifying as the only way to obtain a review: ${alternateNext.textContent}`);
      }
      assert.ok(!scenario.forbidden.test(alternateNext.textContent),
        `${scenario.label} leaked a contradictory fallback: ${alternateNext.textContent}`);
      assert.ok(allNodes(alternate.document.getElementById('runs-list'))
        .some((n) => n.tagName === 'BUTTON' && n.textContent === 'Verify independent review'),
      `${scenario.label} hid the canonical server-verification action behind ROOT projection evidence`);
    }

    const advisoryRejectStatus = Object.assign({}, checked, {
      engineering: Object.assign({}, checked.engineering, {
        problems: [],
        reviewerCompleteness: Object.assign({}, passingReviewCompleteness(), { rows: [Object.assign(
          {}, passingReviewCompleteness().rows[0], { disposition: 'REJECT' })] }),
      }),
    });
    const advisoryReject = bootPage(fixtureState(), { fetch: async (path) => {
      if (path === '/api/status') return { ok: true, json: async () => advisoryRejectStatus };
      throw new Error('unexpected request ' + path);
    } });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    assert.ok(/appears ready for server verification/.test(advisoryReject.text('founder-body')),
      'a canonical complete review with an advisory REJECT was rewritten as incomplete');
    assert.match(advisoryReject.text('founder-body'),
      /recorded an advisory rejection with no blocking finding/,
      'the founder surface did not explain why the REJECT is complete but nonblocking');
    assert.doesNotMatch(advisoryReject.text('founder-body'), /all reviewers approved|every required reviewer approved/i,
      'the founder surface rewrote an advisory REJECT as unanimous approval');

    for (const scenario of [
      { label: 'complete coverage with blocking engineering problem', controlBlocked: true, engineering: Object.assign({}, checked.engineering, {
        problems: [{ rule: 'ENGOS-GATE-BLOCKED', detail: 'The exact-subject gate still has a blocking problem.' }],
      }) },
      { label: 'complete coverage with null required disposition', engineering: Object.assign({}, checked.engineering, {
        reviewerCompleteness: Object.assign({}, passingReviewCompleteness(), { rows: [Object.assign(
          {}, passingReviewCompleteness().rows[0], { disposition: null })] }),
      }) },
      { label: 'complete coverage with unknown required disposition', engineering: Object.assign({}, checked.engineering, {
        reviewerCompleteness: Object.assign({}, passingReviewCompleteness(), { rows: [Object.assign(
          {}, passingReviewCompleteness().rows[0], { disposition: 'UNAVAILABLE' })] }),
      }) },
      { label: 'review completeness subject differs from engineering and gate subject', engineering: Object.assign({}, checked.engineering, {
        reviewerCompleteness: passingReviewCompleteness('b'.repeat(64)),
      }) },
      { label: 'aggregate path coverage is incomplete', engineering: Object.assign({}, checked.engineering, {
        reviewerCompleteness: Object.assign({}, passingReviewCompleteness(), {
          pathCoverage: {
            total: 1,
            coveredByEveryRequiredReviewer: [],
            notCoveredByEveryRequiredReviewer: ['builder-control/dashboard/index.html'],
          },
        }),
      }) },
      { label: 'CHECKS_PASSED label has no positive all-passed check record', engineering: checked.engineering,
        runs: [Object.assign({}, checked.runs[0], { checks: { passed: 0, total: 0 } })] },
    ]) {
      const status = Object.assign({}, checked, {
        engineering: scenario.engineering,
        runs: scenario.runs || checked.runs,
      });
      const guarded = bootPage(fixtureState(), { fetch: async (path) => {
        if (path === '/api/status') return { ok: true, json: async () => status };
        throw new Error('unexpected request ' + path);
      } });
      for (let i = 0; i < 10; i++) await Promise.resolve();
      assert.ok(!/appears ready for server verification/.test(guarded.text('founder-body')),
        `${scenario.label} was presented as ready to bind`);
      if (scenario.controlBlocked) {
        // The blocked lane no longer says "Resolve the recorded blocker before
        // continuing" — that sentence named neither the absent evidence nor
        // where it is recorded. The fail-closed explanation must now name the
        // missing piece, point at the shipped panel that holds it, and state
        // that reading it is inert, so this asserts all three parts on the
        // NEXT STEP surface rather than accepting any blocked-sounding text.
        const blockedNextStep = (findByAttr(guarded.document.getElementById('founder-body'),
          'data-operator-field').find((n) => n.attrs['data-operator-field'] === 'next-step') || {}).textContent;
        assert.ok(blockedNextStep, `${scenario.label} exposes no NEXT STEP field to fail closed in`);
        assert.match(blockedNextStep,
          /AEGIS cannot show which exact code version this run was checked against, so nothing here is confirmed\./,
          `${scenario.label} did not retain the fail-closed missing-evidence explanation: ${blockedNextStep}`);
        assert.match(blockedNextStep,
          /Use "Show changes and checks" and read "Which exact version this is" for the recorded binding\./,
          `${scenario.label} dropped the read-only navigation to the panel recording that evidence: ${blockedNextStep}`);
        assert.match(blockedNextStep, /Viewing evidence starts no check, review or retry\./,
          `${scenario.label} stopped stating that viewing the evidence starts nothing: ${blockedNextStep}`);
        assert.doesNotMatch(blockedNextStep, /Resolve the recorded blocker before continuing/,
          `${scenario.label} restored the superseded blocker sentence: ${blockedNextStep}`);
      } else {
        assert.ok(/Independent-review evidence is not yet complete or its status is unavailable/.test(
          guarded.text('founder-body')),
        `${scenario.label} did not retain the fail-closed founder explanation`);
      }
      assert.notStrictEqual(guarded.text('hud-review-state'),
        REVIEW_COVERAGE_PLAIN['EVIDENCE APPEARS READY FOR SERVER VERIFICATION'],
        `${scenario.label} lit the HUD server-verification readiness signal`);
      assert.notStrictEqual(guarded.document.getElementById('hud-review-state').attrs['data-hud-code'],
        'EVIDENCE APPEARS READY FOR SERVER VERIFICATION',
        `${scenario.label} recorded the server-verification readiness code behind a softer word`);
      assert.ok(allNodes(guarded.document.getElementById('runs-list'))
        .some((n) => n.tagName === 'BUTTON' && n.textContent === 'Verify independent review'),
      `${scenario.label} hid the run-scoped server-verification action`);
    }

    // UNLINKED is the expected pre-bind state; MISMATCHED may qualify the
    // projected evidence, but neither may erase the canonical bind action.
    for (const scenario of [
      { label: 'UNLINKED', binding: Object.assign({}, checked.runsBinding,
          { subjectState: 'UNLINKED', subjectSha256: null, runSubjectSha256: null }),
        current: /current gate subject appears ready for server verification.*Only AEGIS can approve and bind it to this run/,
        hud: 'EVIDENCE APPEARS READY FOR SERVER VERIFICATION' },
      { label: 'MISMATCHED', binding: Object.assign({}, checked.runsBinding,
          { subjectState: 'MISMATCHED', subjectSha256: null, runSubjectSha256: 'b'.repeat(64) }),
        current: /appears ready for server verification, but this run records an older code version.*AEGIS will recompute the subject and refuse if they do not match/,
        hud: 'SERVER VERIFICATION CANDIDATE — RUN VERSION DIFFERS' },
    ]) {
      const status = Object.assign({}, checked, { runsBinding: scenario.binding });
      const alternate = bootPage(fixtureState(), { fetch: async (path) => {
        if (path === '/api/status') return { ok: true, json: async () => status };
        throw new Error('unexpected request ' + path);
      } });
      for (let i = 0; i < 10; i++) await Promise.resolve();
      const fields = findByAttr(alternate.document.getElementById('founder-body'), 'data-operator-field');
      const alternateNext = fields.find((n) => n.attrs['data-operator-field'] === 'next-step');
      const alternateCurrent = fields.find((n) => n.attrs['data-operator-field'] === 'current-action');
      assert.ok(alternateNext && /appears ready for server verification/.test(alternateNext.textContent),
        `${scenario.label} erased the server-verification action: ${alternateNext && alternateNext.textContent}`);
      assert.ok(alternateCurrent && scenario.current.test(alternateCurrent.textContent),
        `${scenario.label} CURRENT ACTION misstates the gate/run relationship: ${alternateCurrent && alternateCurrent.textContent}`);
      assert.strictEqual(alternate.text('hud-review-state'), REVIEW_COVERAGE_PLAIN[scenario.hud],
        `${scenario.label} HUD misstates subject binding`);
      assert.strictEqual(alternate.document.getElementById('hud-review-state').attrs['data-hud-code'],
        scenario.hud, `${scenario.label} HUD dropped the exact coverage code`);
      assert.ok(/appears ready for server verification/.test(alternate.text('hud-decisions')),
        `${scenario.label} HUD hides the remaining governed action`);
    }

    // REVIEW_BOUND + BOUND is the real post-bind projection. Only here may the
    // HUD call coverage complete, and the bind CTA must disappear.
    const boundStatus = Object.assign({}, checked, {
      runsBinding: Object.assign({}, checked.runsBinding, {
        subjectState: 'BOUND', subjectSha256: 'a'.repeat(64), runSubjectSha256: 'a'.repeat(64),
      }),
      runs: [Object.assign({}, checked.runs[0], {
        state: 'REVIEW_BOUND', subject: { subjectSha256: 'a'.repeat(64) },
      })],
    });
    const boundPage = bootPage(fixtureState(), { fetch: async (path) => {
      if (path === '/api/status') return { ok: true, json: async () => boundStatus };
      throw new Error('unexpected request ' + path);
    } });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    assert.strictEqual(boundPage.text('hud-review-state'),
      REVIEW_COVERAGE_PLAIN['REVIEW COVERAGE COMPLETE'],
      'the post-bind HUD does not report completed exact-subject review coverage');
    assert.strictEqual(boundPage.document.getElementById('hud-review-state').attrs['data-hud-code'],
      'REVIEW COVERAGE COMPLETE',
      'the post-bind HUD dropped the exact coverage code behind its plain words');
    assert.strictEqual(boundPage.text('hud-review'),
      '1 of 1 required reviewer row(s) executed for the current gate subject.',
      'valid exact-subject post-bind reviewer coverage was not attributed to the current gate subject');
    assert.ok(/Ready to open a pull request/.test(boundPage.text('founder-body')) &&
      /Open the pull request/.test(boundPage.text('founder-body')),
    'post-bind REVIEW_BOUND + exact-subject READY_FOR_PR lost its pull-request guidance');
    assert.ok(!/appears ready for server verification/.test(boundPage.text('founder-body')),
      'the bind action survives after canonical REVIEW_BOUND evidence');
    assert.ok(!allNodes(boundPage.document.getElementById('runs-list'))
      .some((n) => n.tagName === 'BUTTON' && n.textContent === 'Verify independent review'),
    'the CHECKS_PASSED-only bind control survives after REVIEW_BOUND');

    // (2) When the gate names a missing required reviewer, that authoritative
    // action survives CHECKS_PASSED and the page adds only its bind-only limit.
    const missingStatus = Object.assign({}, checked, { engineering: {
      state: 'OK', verdict: 'BLOCKED', subjectSha256: 'a'.repeat(64),
      reviewerCompleteness: { complete: false, rows: [{
        reviewer: 'grok', required: 'REQUIRED', executed: 'MISSING', missingPaths: [],
      }] },
    } });
    const missing = bootPage(fixtureState(), { fetch: async (path) => {
      if (path === '/api/status') return { ok: true, json: async () => missingStatus };
      throw new Error('unexpected request ' + path);
    } });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    const missingNext = findByAttr(missing.document.getElementById('founder-body'), 'data-operator-field')
      .find((n) => n.attrs['data-operator-field'] === 'next-step');
    assert.ok(missingNext && /Get grok to review this exact change/.test(missingNext.textContent),
      `CHECKS_PASSED erased the gate's named reviewer action: ${missingNext && missingNext.textContent}`);
    assert.ok(/starts no new review and pays for nothing/.test(missingNext.textContent),
      `CHECKS_PASSED dropped the external-review boundary: ${missingNext && missingNext.textContent}`);
    assert.ok(!/appears ready for server verification/.test(missingNext.textContent),
      `missing review evidence was presented as ready to bind: ${missingNext.textContent}`);
    assert.ok(allNodes(missing.document.getElementById('runs-list'))
      .some((n) => n.tagName === 'BUTTON' && n.textContent === 'Verify independent review'),
    'missing ROOT reviewer evidence hid the run-scoped server-verification control');

    // (3) Nowhere on the deck may the page describe a review it did not run.
    const deck = page.text('founder-body');
    assert.ok(!/\b(?:launched|ran|performed|completed|obtained)\s+(?:an?\s+)?(?:external\s+)?(?:independent\s+)?review\b/i.test(deck),
      `the deck claims a review was carried out by this dashboard: ${deck}`);

    // (4) The bind action carries the runId and nothing else. Which subject the
    // evidence must match is decided by the canonical gate, not by the browser,
    // so any extra field here would be the dashboard asserting subject authority
    // it does not have.
    const review = allNodes(page.document.getElementById('runs-list'))
      .find((n) => n.tagName === 'BUTTON' && n.textContent === 'Verify independent review');
    assert.ok(review && review.disabled !== true, 'CHECKS_PASSED did not expose the review verification control');
    await review._listeners.click[0]();
    const bind = calls.filter((c) => c.path === '/api/review-bind');
    assert.strictEqual(bind.length, 1, `expected exactly one bind request, got ${bind.length}`);
    assert.deepStrictEqual(JSON.parse(bind[0].options.body), { runId: 'RUN-EXTREVIEW' },
      'the dashboard sent fields beyond the exact runId authority boundary');

    // (5) A successful bind is reported as verification of evidence that already
    // existed — never as a review this page caused to happen — and the run does
    // not advance until canonical lifecycle evidence says so.
    const activity = page.text('live-activity');
    assert.ok(/Verifying started no review/.test(activity),
      `the bind result drops the no-launch boundary: ${activity}`);
    assert.ok(!/\b(?:launched|started|commissioned)\s+(?:an?\s+)?(?:independent\s+)?review\b/i.test(
      activity.replace(/Verifying started no review/g, '')),
      `the activity feed claims this dashboard launched a review: ${activity}`);
    assert.ok(/CHECKS_PASSED/.test(page.text('runs-list')) && !/REVIEW_BOUND/.test(page.text('runs-list')),
      'the bind response optimistically advanced the run before SSE evidence');
  });

  // ── generic Retry must match what the canonical run state actually permits ──
  // aegis-run refuses /api/retry once the recorded correction budget is spent,
  // and a recorded builder timeout can only be continued from the CLI, where a
  // command and a timeout may legally be chosen. A live-looking Retry in either
  // case is a control that promises an action AEGIS would reject.
  function retryStatusFixture(run, generatedAt) {
    return {
      generatedAt, runsState: 'OK',
      engineering: { state: 'OK', verdict: 'BLOCKED', problems: [], stages: [] },
      runsBinding: { state: 'BOUND', runId: run.runId, updatedAt: generatedAt, reason: 'bound' },
      integration: { connectors: [] },
      runs: [run],
    };
  }

  function bootRetryFixture(status) {
    const calls = [];
    const page = bootPage(fixtureState(), { fetch: async (path, options) => {
      calls.push({ path, options });
      if (path === '/api/status') return { ok: true, json: async () => status };
      if (path === '/api/retry') return { ok: true, json: async () => ({
        runId: status.runs[0].runId, state: 'CORRECTING', action: 'retry', correction: 2,
      }) };
      throw new Error('unexpected request ' + path);
    } });
    return { page, calls };
  }

  function retryControls(page) {
    return {
      history: allNodes(page.document.getElementById('runs-list'))
        .find((node) => node.tagName === 'BUTTON' && node.textContent === 'Retry') || null,
      command: findByAttr(page.document.getElementById('founder-body'), 'data-command-control')
        .find((node) => node.attrs['data-command-control'] === 'retry') || null,
      nextStep: (findByAttr(page.document.getElementById('founder-body'), 'data-operator-field')
        .find((node) => node.attrs['data-operator-field'] === 'next-step') || { textContent: '' }).textContent,
    };
  }

  await atest('DOM: an exhausted correction budget disables generic Retry and states the truthful next action', async () => {
    const status = retryStatusFixture({
      runId: 'RUN-CORRECTION-LIMIT', state: 'CHECKS_FAILED',
      objective: 'Spend the bounded correction budget', updatedAt: '2026-09-02T09:00:00.000Z',
      corrections: 3, maxCorrections: 3,
    }, '2026-09-02T09:00:00.000Z');
    const { page, calls } = bootRetryFixture(status);
    for (let i = 0; i < 10; i++) await Promise.resolve();
    const found = retryControls(page);
    assert.ok(found.history, 'the exhausted run hid Retry instead of explaining the refusal');
    assert.strictEqual(found.history.disabled, true,
      'Retry stayed clickable after every bounded correction cycle was already used');
    assert.strictEqual((found.history._listeners.click || []).length, 0,
      'a refused Retry still carries an executable click handler');
    assert.match(page.text('runs-list'), /All 3 bounded correction cycle\(s\) are already used/,
      'the run card never states why Retry is refused');
    assert.match(page.text('runs-list'), /Escalate this run or abandon it/,
      'the run card offers no truthful next action');
    assert.ok(found.command && found.command.disabled === true,
      'the command deck kept a live Retry the canonical run state refuses');
    assert.match(found.nextStep, /All 3 bounded correction cycle\(s\) are already used[\s\S]*Escalate this run or abandon it/,
      `NEXT STEP still advertises a retry route: ${found.nextStep}`);
    assert.strictEqual(page.sandbox.AEGIS_DASHBOARD.retryAvailability(status.runs[0]).state,
      'CORRECTION_LIMIT', 'the projection does not name the canonical refusal');
    await page.sandbox.AEGIS_DASHBOARD.requestRunRetry(status.runs[0], null);
    assert.strictEqual(calls.filter((call) => call.path === '/api/retry').length, 0,
      'the shared helper still POSTed a retry the canonical run state refuses');
  });

  await atest('DOM: a recorded builder timeout disables generic Retry and names CLI continuation', async () => {
    const status = retryStatusFixture({
      runId: 'RUN-BUILDER-TIMEOUT', state: 'BUILD_FAILED',
      objective: 'Continue a timed-out builder', updatedAt: '2026-09-02T09:05:00.000Z',
      corrections: 1, maxCorrections: 3,
      build: { mode: 'async', status: 'FAILED', exit: 124, timedOut: true, retrySafe: null,
        activity: { code: 'FAILED', phase: 'STOPPED', active: false,
          summary: 'Builder stopped with exit 124' } },
    }, '2026-09-02T09:05:00.000Z');
    const { page, calls } = bootRetryFixture(status);
    for (let i = 0; i < 10; i++) await Promise.resolve();
    const found = retryControls(page);
    assert.ok(found.history, 'the timed-out run hid Retry instead of explaining the refusal');
    assert.strictEqual(found.history.disabled, true,
      'a timed-out builder still exposed a generic same-bound Retry');
    assert.strictEqual((found.history._listeners.click || []).length, 0,
      'a refused Retry still carries an executable click handler');
    assert.match(page.text('runs-list'), /Continue this run from the AEGIS CLI/,
      'the run card never names the one valid continuation route');
    assert.ok(found.command && found.command.disabled === true,
      'the command deck kept a live Retry for a timed-out builder');
    assert.match(found.nextStep, /timed out[\s\S]*Continue this run from the AEGIS CLI/,
      `NEXT STEP still advertises a generic retry route: ${found.nextStep}`);
    assert.strictEqual(page.sandbox.AEGIS_DASHBOARD.retryAvailability(status.runs[0]).state,
      'CLI_TIMEOUT_CONTINUATION', 'the projection does not name the CLI-only continuation');
    await page.sandbox.AEGIS_DASHBOARD.requestRunRetry(status.runs[0], null);
    assert.strictEqual(calls.filter((call) => call.path === '/api/retry').length, 0,
      'the shared helper POSTed a retry that only the CLI can legally continue');
  });

  await atest('DOM: remaining correction capacity still exposes an executable bounded Retry', async () => {
    const status = retryStatusFixture({
      runId: 'RUN-CORRECTION-AVAILABLE', state: 'BUILD_FAILED',
      objective: 'Keep the bounded recovery route usable', updatedAt: '2026-09-02T09:10:00.000Z',
      corrections: 1, maxCorrections: 3,
    }, '2026-09-02T09:10:00.000Z');
    const { page, calls } = bootRetryFixture(status);
    for (let i = 0; i < 10; i++) await Promise.resolve();
    const found = retryControls(page);
    assert.ok(found.history && found.history.disabled !== true,
      'remaining correction capacity lost its executable Retry');
    assert.ok(found.command && found.command.disabled !== true,
      'remaining correction capacity lost the command-deck Retry');
    assert.doesNotMatch(page.text('runs-list'), /already used|Continue this run from the AEGIS CLI/,
      'an available retry was described as refused');
    await found.history._listeners.click[0]();
    const retryCalls = calls.filter((call) => call.path === '/api/retry');
    assert.strictEqual(retryCalls.length, 1, 'the available Retry did not POST exactly one request');
    assert.deepStrictEqual(JSON.parse(retryCalls[0].options.body), { runId: 'RUN-CORRECTION-AVAILABLE' },
      'Retry crossed fields beyond the canonical runId');
  });

  // ── live supervision (PKT-20260826-ASYNC-WORKER-OPERATOR-BETA) ────────────
  // The failure guarded here is the one an operator cannot see through: a build
  // that heartbeats steadily, does nothing, and is presented as working until
  // the watchdog kills it. The page must therefore state real progress and
  // supervisor liveness as two separate facts, publish the fixed limits the
  // build is judged against, and say "not recorded" rather than reassure.
  function supervisionStatusFixture(build, generatedAt) {
    const runId = 'RUN-SUPERVISION';
    return {
      generatedAt, runsState: 'OK',
      engineering: { state: 'OK', verdict: 'BLOCKED', problems: [], stages: [] },
      runsBinding: { state: 'BOUND', runId, updatedAt: generatedAt, reason: 'bound' },
      integration: { connectors: [] },
      runs: [{ runId, state: 'BUILDING', objective: 'Prove live supervision',
        updatedAt: generatedAt, transitions: 4, build }],
    };
  }

  const RECORDED_SUPERVISION_BUILD = {
    mode: 'async', status: 'RUNNING', workerPid: 4242,
    startedAt: '2026-09-02T10:00:00.000Z', heartbeatAt: '2026-09-02T10:09:59.000Z',
    endedAt: null, timedOut: false, retrySafe: null, cancelAvailable: true,
    activity: { code: 'RUNNING', phase: 'RUNNING', active: true, summary: 'Builder is running' },
    supervision: {
      progressState: 'RECORDED', progressKind: 'AUTHORIZED_WRITE',
      progressSummary: 'Builder changed a file it is authorized to write',
      lastProgressAt: '2026-09-02T10:04:00.000Z', progressReason: null,
      noProgressLimitSec: 300, wallClockLimitSec: 900,
      timeoutReason: null, timeoutSummary: null,
    },
  };

  function supervisionCard(page) {
    return findByAttr(page.document.getElementById('founder-body'), 'data-operator-field')
      .find((node) => node.attrs['data-operator-field'] === 'builder-progress') || null;
  }

  await atest('DOM: Command View states real progress and the heartbeat as two different facts', async () => {
    const status = supervisionStatusFixture(RECORDED_SUPERVISION_BUILD, '2026-09-02T10:10:00.000Z');
    const page = bootPage(fixtureState(), { status });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    const card = supervisionCard(page);
    assert.ok(card, 'Command View exposes no builder-progress instrument');
    assert.strictEqual(card.attrs['data-supervision-state'], 'PROGRESS_RECORDED');
    assert.match(card.textContent, /Builder changed a file it is authorized to write/,
      `the sanitized progress phase is missing: ${card.textContent}`);
    assert.match(card.textContent, /last real progress 2026-09-02T10:04:00\.000Z/,
      `the last real progress timestamp is missing: ${card.textContent}`);
    assert.match(card.textContent,
      /Supervisor heartbeat 2026-09-02T10:09:59\.000Z is liveness only, never progress/,
      `Command View merged the heartbeat into progress: ${card.textContent}`);

    // Detail View carries the deeper facts, resolved by the same authority.
    const detail = page.text('runs-list');
    assert.match(detail, /Progress phase: AUTHORIZED_WRITE/);
    assert.match(detail, /Last real progress: 2026-09-02T10:04:00\.000Z/);
    assert.match(detail,
      /Heartbeat: 2026-09-02T10:09:59\.000Z — supervisor liveness only; it is not builder progress\./,
      `Detail View left the heartbeat unqualified, where it reads as progress: ${detail}`);
    assert.match(detail,
      /Fixed no-progress watchdog: the build is stopped after 300s without real progress · fixed wall-clock limit 900s\./,
      `Detail View omitted the fixed watchdog and wall-clock limits: ${detail}`);
    assert.match(detail, /Timeout: none recorded/);
    assert.match(detail, /Recovery: cancel capability RECORDED · retry-safe UNVERIFIED/,
      `Detail View omitted the recorded recovery availability: ${detail}`);
    // Raw output, prompts and model prose stay out of both surfaces.
    const whole = page.text('founder-body') + detail;
    assert.ok(whole.length > 0, 'the supervision surfaces rendered nothing to inspect');
    for (const [kind, sentinel] of Object.entries(HOSTILE_WORKER_OUTPUT)) {
      assert.ok(!whole.includes(sentinel), `the supervision surface rendered ${kind} worker output`);
    }
  });

  await atest('DOM: a heartbeating build with no recorded progress is never rendered as working', async () => {
    const status = supervisionStatusFixture(Object.assign({}, RECORDED_SUPERVISION_BUILD, {
      supervision: Object.assign({}, RECORDED_SUPERVISION_BUILD.supervision, {
        progressState: 'UNRECORDED', progressKind: null, progressSummary: null,
        lastProgressAt: null,
        progressReason: 'No real builder progress is recorded for this attempt, so builder liveness rests on the supervisor heartbeat alone.',
      }),
    }), '2026-09-02T10:11:00.000Z');
    const page = bootPage(fixtureState(), { status });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    const card = supervisionCard(page);
    assert.ok(card, 'Command View exposes no builder-progress instrument');
    assert.strictEqual(card.attrs['data-supervision-state'], 'PROGRESS_UNRECORDED');
    assert.match(card.textContent, /No real builder progress is recorded for this attempt/,
      `an unrecorded progress state was not stated plainly: ${card.textContent}`);
    assert.match(card.textContent, /liveness rests on the supervisor heartbeat alone/);
    assert.ok(!/last real progress 2026/.test(card.textContent),
      'an absent progress timestamp was back-filled');
    assert.match(page.text('runs-list'), /Last real progress: NOT RECORDED/,
      'Detail View turned an absent progress record into a value');
  });

  await atest('DOM: a recorded no-progress timeout names its canonical stop reason', async () => {
    const status = supervisionStatusFixture({
      mode: 'async', status: 'FAILED', exit: 124, timedOut: true, retrySafe: false,
      heartbeatAt: '2026-09-02T10:14:00.000Z',
      activity: { code: 'FAILED', phase: 'STOPPED', active: false, summary: 'Builder stopped with exit 124' },
      supervision: {
        progressState: 'RECORDED', progressKind: 'STDOUT',
        progressSummary: 'Builder is emitting model and tool stream activity',
        lastProgressAt: '2026-09-02T10:04:00.000Z', progressReason: null,
        noProgressLimitSec: 300, wallClockLimitSec: 900,
        timeoutReason: 'NO_PROGRESS_TIMEOUT',
        timeoutSummary: 'Stopped because no real builder progress was observed inside the fixed no-progress limit',
      },
    }, '2026-09-02T10:15:00.000Z');
    const page = bootPage(fixtureState(), { status });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    const card = supervisionCard(page);
    assert.strictEqual(card.attrs['data-supervision-state'], 'TIMED_OUT');
    assert.match(card.textContent, /Stopped because no real builder progress was observed/,
      `the recorded stop reason is missing from Command View: ${card.textContent}`);
    assert.match(page.text('runs-list'), /Timeout: NO_PROGRESS_TIMEOUT — Stopped because no real builder progress/);
    assert.match(page.text('runs-list'), /Recovery: cancel capability NOT RECORDED · retry-safe NO/);
  });

  await atest('DOM: an absent supervision projection is UNAVAILABLE, never an assumed start', async () => {
    const status = supervisionStatusFixture({
      mode: 'async', status: 'RUNNING', heartbeatAt: '2026-09-02T10:16:00.000Z',
      activity: { code: 'RUNNING', phase: 'RUNNING', active: true, summary: 'Builder is running' },
    }, '2026-09-02T10:16:30.000Z');
    const page = bootPage(fixtureState(), { status });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    const card = supervisionCard(page);
    assert.strictEqual(card.attrs['data-supervision-state'], 'UNAVAILABLE');
    assert.match(card.textContent, /Builder supervision UNAVAILABLE/,
      `a missing supervision projection was rendered as a healthy state: ${card.textContent}`);
    assert.ok(!/STARTED|AUTHORIZED_WRITE/.test(card.textContent),
      'a missing supervision projection invented a progress phase');
  });

  await atest('supervision is one shared resolution with no clock, timer or duplicated authority', async () => {
    const facts = code.slice(code.indexOf('function supervisionFacts'),
      code.indexOf('function supervisionEvidence'));
    assert.ok(facts.length > 0, 'no supervisionFacts() boundary found');
    for (const banned of ['setInterval', 'setTimeout', 'requestAnimationFrame', 'Date.now', 'new Date',
      'Math.random', 'fetch(', 'innerHTML']) {
      assert.ok(!facts.includes(banned),
        `supervision uses ${banned} — it may only restate facts the projection already recorded`);
    }
    // Cost and checkpoint keep their existing renderers; supervision neither
    // recomputes nor estimates either of them.
    for (const foreign of ['checkpoint', 'rollbackPoint', 'cost', 'cad', 'totalUsd', 'elapsed']) {
      assert.ok(!facts.includes(foreign),
        `supervision reached into ${foreign}, which already has its own renderer`);
    }
    assert.ok(/evidenceCostPanel\(view && view\.cost\)/.test(code) &&
      /evidenceCheckpointPanel\(ctx\.run, ctx\.checkpointText\)/.test(code),
      'the Detail View rail no longer reuses the existing CAD cost and checkpoint/rollback renderers');
    assert.ok(/commandCard\('LAST SAFE CHECKPOINT', safeCheckpoint/.test(code),
      'Command View stopped reading checkpoint status through checkpointEvidence()');

    // One authority, read twice: the Command View card and the Detail View
    // builder-evidence block must not resolve supervision independently.
    assert.strictEqual((code.match(/function supervisionFacts/g) || []).length, 1,
      'supervision was resolved by more than one function');
    assert.ok(/supervisionFacts:\s*supervisionFacts/.test(code),
      'the shared supervision resolution is not exported to the switchboard layer');
    const workerRenderer = code.slice(code.indexOf('function buildEvidence'),
      code.indexOf('function runActionRow'));
    assert.ok(/window\.AEGIS_DASHBOARD\.supervisionFacts\(build\)/.test(workerRenderer),
      'the Detail View builder evidence does not read the shared supervision resolution');
    assert.ok(!/progressKind|noProgressLimitSec|lastProgressAt/.test(workerRenderer),
      'the Detail View rebuilt its own supervision vocabulary instead of reusing the resolved facts');
    assert.ok(/var supervision = supervisionEvidence\(boundRun\);/.test(code) &&
      /commandCard\('BUILDER PROGRESS', supervision\.headline/.test(code),
      'the Command View progress card is not driven by the shared supervision resolution');
  });

  // ── first-screen operational status strip ─────────────────────────────────
  // Five cells, one repaint path. Each proof below reads the strip through the
  // page's own DOM, so a cell that answers from a clock, from a neighbouring
  // fact, or from raw worker output fails here rather than on a real build.
  function opsCells(page) {
    const found = {};
    findByAttr(page.document.getElementById('ops-strip-cells'), 'data-ops-cell')
      .forEach((node) => { found[node.attrs['data-ops-cell']] = node; });
    return found;
  }

  // A cell states its condition three ways: the machine attribute, a written
  // word, and a glyph. Colour is never the only carrier. The written word is
  // the operator's plain English; the canonical token the renderer resolved —
  // which may be the evidence renderer's own vocabulary, as a recorded CAD
  // figure is an AVAILABLE chip over a RECORDED state — stays exact in the
  // machine attribute and in the chip title. All three are asserted.
  function assertCellStates(cell, expected, label) {
    const state = typeof expected === 'string' ? expected : expected.state;
    const chipWord = typeof expected === 'string' ? expected
      : (expected.chip || expected.state);
    const plain = typeof expected === 'string' ? null : expected.plain;
    assert.ok(cell, `the strip has no ${label} cell`);
    assert.strictEqual(cell.attrs['data-ops-state'], state,
      `the ${label} cell does not carry the canonical state ${state}`);
    const chipNode = (cell.children || []).find((c) => String(c.className).includes('chip'));
    assert.ok(chipNode, `the ${label} cell has no state chip`);
    assert.strictEqual(chipNode.children.length, 2,
      `the ${label} chip must carry a glyph and a written state, not colour alone`);
    assert.ok(chipNode.children[0].textContent.trim().length > 0,
      `the ${label} chip glyph is empty, leaving colour as the only shape`);
    assert.ok(plain, `the ${label} expectation names no plain-English chip word`);
    assert.strictEqual(chipNode.children[1].textContent, plain,
      `the ${label} chip does not read in plain English`);
    assert.strictEqual(chipNode.attrs.title, 'Canonical state code: ' + chipWord,
      `the ${label} chip does not keep its exact canonical code accessible`);
    assert.ok(String(chipNode.className).includes('s-' + chipWord),
      `the ${label} chip lost the canonical state style behind its plain word`);
  }

  const IDLE_STATUS = {
    generatedAt: '2026-09-02T09:00:00.000Z', runsState: 'OK',
    engineering: { state: 'OK', verdict: 'READY_FOR_DETERMINISTIC_VALIDATION', problems: [], stages: [] },
    runsBinding: { state: 'UNAVAILABLE', runId: null, evidenceState: 'OK',
      reason: 'no run records exist yet, so no run is current.' },
    runs: [], integration: { connectors: [] },
    cost: { state: 'UNAVAILABLE', reason: 'no transcripts are recorded' },
  };

  await atest('DOM: the strip answers all five operational questions from one live status push', async () => {
    const page = bootPage(fixtureState(), { status: IDLE_STATUS });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    // Idle first: the strip is calm, and every cell still says something true.
    let cells = opsCells(page);
    assert.deepStrictEqual(Object.keys(cells).sort(),
      ['checkpoint', 'cost', 'progress', 'run-state', 'watchdog'],
      'the strip does not expose exactly the five operational answers');
    assertCellStates(cells['run-state'], { state: 'IDLE', plain: 'Nothing running' }, 'run state');
    // This cell has always carried controlPlaneState, which answers whether the
    // current gate subject is clear rather than what the worker is doing, and it
    // is now labelled as the gate. The canonical cell id is unchanged.
    assert.match(cells['run-state'].textContent, /GATE READINESS/);
    assert.ok(!/RUN STATE/.test(cells['run-state'].textContent),
      'the gate cell still claims to be the run state, which reads a blocked gate as a stalled worker');
    assert.match(cells['run-state'].textContent, /Nothing is currently running\./);
    assertCellStates(cells.progress, { state: 'NOT_RUNNING', plain: 'Nothing running' }, 'progress');
    assert.match(cells.progress.textContent, /No run is active, so there is no builder to supervise\./);
    assertCellStates(cells.watchdog, { state: 'NOT_RUNNING', plain: 'Nothing running' }, 'watchdog');
    assert.match(cells.watchdog.textContent, /no builder watchdog is armed/);
    // Both labels ask the operator's question; the sentences beneath them, and
    // the canonical cell ids, are unchanged.
    assert.match(cells.progress.textContent, /Latest builder activity/);
    assert.match(cells.watchdog.textContent, /Run limits/);
    for (const jargon of [/REAL PROGRESS VS HEARTBEAT/, /WATCHDOG \/ TIMEOUT/]) {
      assert.doesNotMatch(cells.progress.textContent + ' ' + cells.watchdog.textContent, jargon,
        `the strip still leads with implementation vocabulary: ${jargon}`);
    }
    assertCellStates(cells.cost, { state: 'UNAVAILABLE', plain: 'Not recorded' }, 'cost');
    assert.match(cells.cost.textContent, /CAD UNAVAILABLE — no transcripts are recorded/,
      `an absent cost projection was not stated as explicitly unavailable: ${cells.cost.textContent}`);
    assertCellStates(cells.checkpoint, { state: 'UNAVAILABLE', plain: 'Not recorded' }, 'checkpoint');
    assert.match(cells.checkpoint.textContent, /LAST SAFE CHECKPOINT/);
    assert.match(cells.checkpoint.textContent, /No run is active\./);

    // The same live seam a real build repaints through: no reload, no timer,
    // and no second renderer — the strip must follow canonical status.
    renderMinimizedStatus(page, supervisionStatusFixture(RECORDED_SUPERVISION_BUILD,
      '2026-09-02T10:10:00.000Z'));
    cells = opsCells(page);
    assertCellStates(cells['run-state'], { state: 'RUNNING', plain: 'Running' }, 'run state');
    assert.match(cells['run-state'].textContent, /Builder is running/,
      `the strip did not repaint the running run state: ${cells['run-state'].textContent}`);
    assertCellStates(cells.progress,
      { state: 'PROGRESS_RECORDED', plain: 'Activity recorded' }, 'progress');
    assert.match(cells.progress.textContent,
      /Builder changed a file it is authorized to write — last real progress 2026-09-02T10:04:00\.000Z\./,
      `the strip did not state real progress: ${cells.progress.textContent}`);
    assert.match(cells.progress.textContent,
      /Supervisor heartbeat 2026-09-02T10:09:59\.000Z is liveness only, never progress/,
      `the strip merged the heartbeat into progress: ${cells.progress.textContent}`);
    assertCellStates(cells.watchdog, { state: 'RECORDED', plain: 'Limits recorded' }, 'watchdog');
    assert.match(cells.watchdog.textContent,
      /Fixed no-progress watchdog: the build is stopped after 300s without real progress · fixed wall-clock limit 900s\./,
      `the strip omitted the fixed watchdog limits: ${cells.watchdog.textContent}`);
    assert.match(cells.watchdog.textContent, /Timeout: none recorded/);
    // This projection carries no cost envelope at all, which is not zero.
    assertCellStates(cells.cost, { state: 'UNAVAILABLE', plain: 'Not recorded' }, 'cost');
    assert.match(cells.cost.textContent, /CAD UNAVAILABLE/);
    assert.ok(!/CAD 0|\$0/.test(cells.cost.textContent), 'a missing cost projection was rendered as zero');
    assertCellStates(cells.checkpoint,
      { state: 'NOT_RECORDED', chip: 'UNAVAILABLE', plain: 'Not recorded' }, 'checkpoint');
    assert.match(cells.checkpoint.textContent, /No safe checkpoint is recorded for this run\./);
  });

  await atest('DOM: a heartbeating build with no recorded progress is never calm in the strip', async () => {
    const status = supervisionStatusFixture(Object.assign({}, RECORDED_SUPERVISION_BUILD, {
      supervision: Object.assign({}, RECORDED_SUPERVISION_BUILD.supervision, {
        progressState: 'UNRECORDED', progressKind: null, progressSummary: null, lastProgressAt: null,
        progressReason: 'No real builder progress is recorded for this attempt, so builder liveness rests on the supervisor heartbeat alone.',
      }),
    }), '2026-09-02T10:11:00.000Z');
    const page = bootPage(fixtureState(), { status });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    const cells = opsCells(page);
    assertCellStates(cells.progress,
      { state: 'PROGRESS_UNRECORDED', plain: 'No activity recorded' }, 'progress');
    assert.match(cells.progress.textContent, /No real builder progress is recorded for this attempt/);
    assert.match(cells.progress.textContent, /liveness rests on the supervisor heartbeat alone/);
    assert.ok(!/last real progress 2026/.test(cells.progress.textContent),
      'the strip back-filled an absent progress timestamp');
    // The watchdog has not fired, and the strip says exactly that rather than
    // implying the build is fine.
    assertCellStates(cells.watchdog, { state: 'RECORDED', plain: 'Limits recorded' }, 'watchdog');
    assert.match(cells.watchdog.textContent, /Timeout: none recorded/);
  });

  await atest('DOM: a recorded timeout is stated in the strip with its canonical stop reason', async () => {
    const status = supervisionStatusFixture({
      mode: 'async', status: 'FAILED', exit: 124, timedOut: true, retrySafe: false,
      heartbeatAt: '2026-09-02T10:14:00.000Z',
      activity: { code: 'FAILED', phase: 'STOPPED', active: false, summary: 'Builder stopped with exit 124' },
      supervision: {
        progressState: 'RECORDED', progressKind: 'STDOUT',
        progressSummary: 'Builder is emitting model and tool stream activity',
        lastProgressAt: '2026-09-02T10:04:00.000Z', progressReason: null,
        noProgressLimitSec: 300, wallClockLimitSec: 900,
        timeoutReason: 'NO_PROGRESS_TIMEOUT',
        timeoutSummary: 'Stopped because no real builder progress was observed inside the fixed no-progress limit',
      },
    }, '2026-09-02T10:15:00.000Z');
    const page = bootPage(fixtureState(), { status });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    const cells = opsCells(page);
    assertCellStates(cells.watchdog, { state: 'TIMED_OUT', plain: 'Timed out' }, 'watchdog');
    assert.match(cells.watchdog.textContent,
      /Timeout: NO_PROGRESS_TIMEOUT — Stopped because no real builder progress was observed inside the fixed no-progress limit/,
      `the strip did not name the canonical stop reason: ${cells.watchdog.textContent}`);
    assertCellStates(cells.progress, { state: 'TIMED_OUT', plain: 'Timed out' }, 'progress');
    // A run record still saying BUILDING against a terminal exit is a
    // contradiction the control plane already resolves; the strip repeats it.
    assertCellStates(cells['run-state'], { state: 'BLOCKED', plain: 'Needs attention' }, 'run state');
    assert.match(cells['run-state'].textContent, /recorded terminal exit 124/);
  });

  await atest('DOM: an absent supervision projection is UNAVAILABLE in the strip, never an assumed start', async () => {
    const status = supervisionStatusFixture({
      mode: 'async', status: 'RUNNING', heartbeatAt: '2026-09-02T10:16:00.000Z',
      activity: { code: 'RUNNING', phase: 'RUNNING', active: true, summary: 'Builder is running' },
    }, '2026-09-02T10:16:30.000Z');
    const page = bootPage(fixtureState(), { status });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    const cells = opsCells(page);
    assertCellStates(cells.progress, { state: 'UNAVAILABLE', plain: 'Not recorded' }, 'progress');
    assert.match(cells.progress.textContent, /Builder supervision UNAVAILABLE/);
    assertCellStates(cells.watchdog, { state: 'UNAVAILABLE', plain: 'Not recorded' }, 'watchdog');
    assert.match(cells.watchdog.textContent, /Watchdog limits UNAVAILABLE/,
      `an absent watchdog limit was not stated as unavailable: ${cells.watchdog.textContent}`);
    assert.ok(!/300s|900s|AUTHORIZED_WRITE/.test(cells.watchdog.textContent + cells.progress.textContent),
      'a missing supervision projection invented a limit or a progress phase');
  });

  await atest('DOM: the strip states recorded CAD and a recorded checkpoint from the existing renderers', async () => {
    const status = supervisionStatusFixture(RECORDED_SUPERVISION_BUILD, '2026-09-02T10:10:00.000Z');
    status.cost = { state: 'OK', totalUsd: 'AT LEAST 2.46', recordedRuns: 3, unrecordedRuns: 0,
      cad: { state: 'OK', totalCad: '3.38', source: 'builder-control/fx-canon.json',
        plain: '1 USD = 1.37 CAD, observed 2026-08-24 (Bank of Canada daily rate).' } };
    status.runs[0].checkpoint = 'CKPT-2026-09-02';
    status.runs[0].rollbackPoint = 'f'.repeat(40);
    const page = bootPage(fixtureState(), { status });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    const cells = opsCells(page);
    assertCellStates(cells.cost, { state: 'RECORDED', chip: 'AVAILABLE', plain: 'Recorded' }, 'cost');
    assert.match(cells.cost.textContent, /CAD 3\.38/,
      `the recorded CAD figure is missing from the strip: ${cells.cost.textContent}`);
    assertCellStates(cells.checkpoint,
      { state: 'RECORDED', chip: 'AVAILABLE', plain: 'Recorded' }, 'checkpoint');
    assert.match(cells.checkpoint.textContent,
      new RegExp('Checkpoint CKPT-2026-09-02 · rollback commit ' + 'f'.repeat(40)),
      `the recorded checkpoint is missing from the strip: ${cells.checkpoint.textContent}`);
    // The same two facts stay available, unabridged, in Detail View.
    const rail = page.text('evidence-rail-body');
    assert.match(rail, /1 USD = 1\.37 CAD/, 'Detail View lost the CAD rate evidence behind the strip figure');
    assert.match(rail, /Rollback commit: f{40}/, 'Detail View lost the deeper checkpoint evidence');
  });

  await atest('DOM: the strip never renders raw worker output', async () => {
    const hostile = Object.assign({}, RECORDED_SUPERVISION_BUILD, {
      stdoutTail: HOSTILE_WORKER_OUTPUT.source, stderrTail: HOSTILE_WORKER_OUTPUT.pem,
      rawOutput: HOSTILE_WORKER_OUTPUT.jwt, modelOutput: HOSTILE_WORKER_OUTPUT.cookie,
      transcript: HOSTILE_WORKER_OUTPUT.unlabelled,
    });
    const page = bootPage(fixtureState(), { status: supervisionStatusFixture(hostile, '2026-09-02T10:10:00.000Z') });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    const stripText = page.text('ops-strip-cells');
    assert.ok(stripText.length > 0, 'the strip rendered nothing to inspect');
    for (const [kind, sentinel] of Object.entries(HOSTILE_WORKER_OUTPUT)) {
      assert.ok(!stripText.includes(sentinel), `the status strip rendered ${kind} worker output`);
    }
  });

  // The five badges are read by the owner, not by a machine. PROGRESS_UNRECORDED,
  // TIMED_OUT and UNAVAILABLE are precise and unreadable, and a badge nobody can
  // read is a badge nobody acts on. The canonical token still has to be here —
  // in the machine attribute and on the chip — or the plain word becomes the
  // only record of what the evidence actually said.
  await atest('DOM: the five strip badges read in plain English and keep their exact codes', async () => {
    const status = supervisionStatusFixture(Object.assign({}, RECORDED_SUPERVISION_BUILD, {
      supervision: Object.assign({}, RECORDED_SUPERVISION_BUILD.supervision, {
        progressState: 'UNRECORDED', progressKind: null, progressSummary: null, lastProgressAt: null,
        progressReason: 'No real builder progress is recorded for this attempt.',
      }),
    }), '2026-09-02T10:12:00.000Z');
    const page = bootPage(fixtureState(), { status });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    for (const [id, cell] of Object.entries(opsCells(page))) {
      const chipNode = (cell.children || []).find((c) => String(c.className).includes('chip'));
      const word = chipNode.children[1].textContent;
      assert.ok(!/[A-Z]{2,}|_/.test(word), `the ${id} badge still reads as a machine code: ${word}`);
      const token = cell.attrs['data-ops-state'];
      assert.ok(/^[A-Z_]+$/.test(token), `the ${id} cell lost its canonical state token`);
      assert.match(chipNode.attrs.title, /^Canonical state code: [A-Z_]+$/,
        `the ${id} badge does not keep its exact canonical code accessible`);
    }
  });

  // A token this page has never seen must not be smoothed into a friendly word.
  // The strip is fed resolutions, so the unmapped case is proved through the
  // same seam the renderer uses rather than through an invented fixture state.
  await atest('an unmapped canonical token stays visibly unknown with its exact code', async () => {
    const page = bootPage(fixtureState());
    const unknown = 'FUTURE_STATE_TOKEN';
    const panel = { state: unknown, chip: unknown, value: 'a resolved sentence' };
    const cells = page.sandbox.AEGIS_DASHBOARD.opsStripCells(
      { state: unknown, plain: 'a resolved sentence' },
      { state: unknown, watchdogState: unknown, headline: 'h', watchdog: 'w', timeout: 't' },
      panel, panel);
    assert.strictEqual(cells.length, 5, 'the strip no longer resolves exactly five cells');
    for (const cell of cells) {
      assert.strictEqual(cell.state, unknown, `the ${cell.id} cell rewrote its canonical state`);
      assert.strictEqual(cell.chipPlain, 'Unknown state ' + unknown,
        `the ${cell.id} cell invented a readable word for an unmapped code: ${cell.chipPlain}`);
    }
  });

  // ── the bound-run identity line ───────────────────────────────────────────
  // Which run the whole page is describing, and whether that run is working now
  // or is a record of work already finished or failed. These proofs read the
  // line through the page's own DOM, so a line that names an unbound run, or
  // that lets an older failed run read as live work, fails here rather than in
  // front of the owner.
  // Two separately labelled chips now: what the worker did, and whether the
  // gate is clear. They are selected by their own machine attribute, so a
  // renderer that merged them back into one word fails here.
  function opsRunLine(page) {
    const host = page.document.getElementById('ops-strip-run');
    const fields = {};
    findByAttr(host, 'data-ops-run-field').forEach((node) => {
      fields[node.attrs['data-ops-run-field']] = node;
    });
    const chips = {};
    findByAttr(host, 'data-ops-run-chip').forEach((node) => {
      chips[node.attrs['data-ops-run-chip']] = node;
    });
    return { host, fields, chips, chipNode: chips.gate };
  }

  // A chip states its condition four ways: the machine attribute beside it, a
  // written word the operator can read, a glyph, and the exact canonical code
  // kept on the title and in the s-STATE style. Colour is never the carrier and
  // the token is never the headline, but the token is never lost either.
  function assertChipShape(chipNode, state, label) {
    assert.ok(chipNode, `the identity line has no ${label} chip`);
    assert.strictEqual(chipNode.children.length, 2,
      `the ${label} chip must carry a glyph and a written state, not colour alone`);
    assert.ok(chipNode.children[0].textContent.trim().length > 0,
      `the ${label} chip glyph is empty, leaving colour as the only shape`);
    assert.ok(Object.prototype.hasOwnProperty.call(RUN_STATE_PLAIN, state),
      `${label}: ${state} has no plain word in the shipped label seam`);
    assert.strictEqual(chipNode.children[1].textContent, RUN_STATE_PLAIN[state],
      `the ${label} chip does not read its canonical state in plain English`);
    assert.strictEqual(chipNode.attrs.title, 'Canonical state code: ' + state,
      `the ${label} chip does not keep its exact canonical code accessible`);
    assert.ok(String(chipNode.className).includes('s-' + state),
      `the ${label} chip lost the canonical state style behind its plain word`);
  }

  // The plain word replaced the token on screen; the exact aegis-run code must
  // still be on the same node, so nothing is softened away from an auditor.
  function assertCanonicalField(line, state) {
    const node = line.fields.canonical;
    assert.ok(node, 'the identity line carries no lifecycle reading at all');
    assert.ok(Object.prototype.hasOwnProperty.call(RUN_LIFECYCLE_PLAIN, state),
      `${state} has no plain word in the shipped lifecycle label seam`);
    assert.strictEqual(node.textContent, RUN_LIFECYCLE_PLAIN[state],
      `the identity line does not read the recorded lifecycle state in plain English`);
    assert.ok(!/[A-Z]{2,}|_/.test(node.textContent),
      `the identity line still leads with a machine token: ${node.textContent}`);
    assert.strictEqual(node.attrs['data-ops-run-code'], state,
      `the identity line dropped the exact canonical code ${state}`);
    assert.strictEqual(node.attrs.title, 'Canonical run state code: ' + state,
      `the exact canonical code ${state} is not reachable from the plain word`);
  }

  // The gate chip states its condition three ways, exactly like a strip cell:
  // the machine attribute, a written state word, and a glyph. It carries the
  // control-plane reading, which is what data-ops-run has always recorded.
  function assertIdentityChip(line, state) {
    assert.strictEqual(line.host.attrs['data-ops-run'], state,
      `the identity line does not carry the canonical state ${state}`);
    assertChipShape(line.chipNode, state, 'gate readiness');
  }

  // The build chip is the lifecycle reading and nothing else: a blocked gate
  // may never rewrite it, and it may never turn a blocked gate green.
  function assertBuildChip(line, state) {
    assertChipShape(line.chips.build, state, 'build activity');
  }

  const HISTORICAL_FAILED_STATUS = {
    generatedAt: '2026-09-02T11:00:00.000Z', runsState: 'OK',
    engineering: { state: 'OK', verdict: 'BLOCKED', problems: [], stages: [] },
    runsBinding: { state: 'BOUND', runId: 'RUN-OLD-FAILED', updatedAt: '2026-08-30T09:00:00.000Z',
      evidenceState: 'OK', reason: 'the run ledger still names this the current run' },
    integration: { connectors: [] },
    cost: { state: 'UNAVAILABLE', reason: 'no transcripts are recorded' },
    runs: [{ runId: 'RUN-OLD-FAILED', state: 'REVIEW_FAILED', transitions: 7,
      objective: 'An older run that stopped on independent review',
      updatedAt: '2026-08-30T09:00:00.000Z' }],
  };

  await atest('DOM: the identity line names the bound run, its canonical state and that it is working now', async () => {
    const page = bootPage(fixtureState(),
      { status: supervisionStatusFixture(RECORDED_SUPERVISION_BUILD, '2026-09-02T10:10:00.000Z') });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    const line = opsRunLine(page);
    assertIdentityChip(line, 'RUNNING');
    assertBuildChip(line, 'RUNNING');
    assert.match(line.host.textContent, /CURRENT RUN/,
      `the identity line is not labelled: ${line.host.textContent}`);
    for (const label of ['BUILD ACTIVITY', 'GATE READINESS']) {
      assert.match(line.host.textContent, new RegExp(label),
        `the identity line does not say which state is the ${label}: ${line.host.textContent}`);
    }
    assert.strictEqual(line.host.attrs['data-ops-run-id'], 'RUN-SUPERVISION');
    assert.strictEqual(line.fields.id.textContent, 'RUN-SUPERVISION',
      'the identity line does not name the canonically bound run');
    assertCanonicalField(line, 'BUILDING');
    assert.match(line.fields.why.textContent,
      /Nothing has finished yet — the assigned worker is still building this change\./,
      `the recorded state is not stated in founder language: ${line.fields.why.textContent}`);
    assert.match(line.fields.why.textContent, /This is the run AEGIS is working on right now\./,
      `an active build was not identified as the run being worked on: ${line.fields.why.textContent}`);
    assert.ok(!/recorded evidence of a run that is not working right now/.test(line.fields.why.textContent),
      'an active build was explained as a historical record');
  });

  await atest('DOM: an older failed bound run is explained as recorded evidence, never as live work', async () => {
    const page = bootPage(fixtureState(), { status: HISTORICAL_FAILED_STATUS });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    const line = opsRunLine(page);
    assertIdentityChip(line, 'BLOCKED');
    // A run that actually stopped on review keeps a blocked BUILD reading too:
    // separating the two questions may not soften a real failure.
    assertBuildChip(line, 'BLOCKED');
    assert.strictEqual(line.fields.id.textContent, 'RUN-OLD-FAILED');
    assertCanonicalField(line, 'REVIEW_FAILED');
    assert.match(line.fields.why.textContent,
      /Nothing finished — this run stopped on independent review\./,
      `the failed outcome is not stated in founder language: ${line.fields.why.textContent}`);
    assert.match(line.fields.why.textContent,
      /This is recorded evidence of a run that is not working right now\./,
      `a failed run was not explained as a record: ${line.fields.why.textContent}`);
    assert.match(line.fields.why.textContent,
      /still on screen because canonical binding evidence still names it the current run/,
      `the reason an older run is still displayed is missing: ${line.fields.why.textContent}`);
    assert.ok(!/is the run AEGIS is working on right now/.test(line.fields.why.textContent),
      'a failed historical run was presented as work happening now');
  });

  await atest('DOM: unbound and ghost run evidence names no run at all and fails closed as UNAVAILABLE', async () => {
    const page = bootPage(fixtureState(), { status: IDLE_STATUS });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    let line = opsRunLine(page);
    assertIdentityChip(line, 'UNAVAILABLE');
    assertBuildChip(line, 'UNAVAILABLE');
    assert.strictEqual(line.host.attrs['data-ops-run-id'], 'UNAVAILABLE');
    assert.strictEqual(line.fields.id.textContent, 'UNAVAILABLE');
    assertCanonicalField(line, 'UNAVAILABLE');
    assert.match(line.fields.why.textContent,
      /UNAVAILABLE — canonical binding evidence does not name a current run/,
      `an unbound page did not fail closed: ${line.fields.why.textContent}`);

    // A binding that names a run the ledger does not carry is a ghost. Array
    // position is not a substitute: the line may not fall back to the one run
    // that happens to be in the list.
    const ghost = JSON.parse(JSON.stringify(HISTORICAL_FAILED_STATUS));
    ghost.runsBinding.runId = 'RUN-DOES-NOT-EXIST';
    renderMinimizedStatus(page, ghost);
    line = opsRunLine(page);
    assertIdentityChip(line, 'UNAVAILABLE');
    assert.strictEqual(line.fields.id.textContent, 'UNAVAILABLE');
    assert.ok(!/RUN-OLD-FAILED|RUN-DOES-NOT-EXIST/.test(line.host.textContent),
      `a ghost binding named a run no canonical record supports: ${line.host.textContent}`);
  });

  // ── build activity vs gate readiness ──────────────────────────────────────
  // The reported defect: a worker that had finished, with its focused checks
  // passed and only required-reviewer evidence outstanding, was the only state
  // word on the first screen — the gate's BLOCKED — so a finished build read as
  // frozen or failed. The two questions must be answered separately and both
  // must stay true: the gate keeps its block and its recorded reason, and the
  // build keeps its finished sentence.
  const REVIEW_PENDING_STATUS = {
    generatedAt: '2026-09-03T09:00:00.000Z', runsState: 'OK',
    engineering: { state: 'OK', verdict: 'BLOCKED', stages: [],
      problems: [{ rule: 'ENGOS-REVIEW-MISSING',
        detail: 'grok is required and has no review bound to this subject.' }] },
    runsBinding: { state: 'BOUND', runId: 'RUN-REVIEW-PENDING', updatedAt: '2026-09-03T08:59:00.000Z',
      evidenceState: 'OK', reason: 'the run ledger names this the current run' },
    integration: { connectors: [] },
    cost: { state: 'UNAVAILABLE', reason: 'no transcripts are recorded' },
    runs: [{ runId: 'RUN-REVIEW-PENDING', state: 'CHECKS_PASSED', transitions: 5,
      objective: 'A finished worker whose independent review evidence is outstanding',
      updatedAt: '2026-09-03T08:59:00.000Z', checks: { outcome: 'PASS' } }],
  };

  await atest('DOM: a finished worker with review outstanding is not presented as a stalled or failed build', async () => {
    const page = bootPage(fixtureState(), { status: REVIEW_PENDING_STATUS });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    const line = opsRunLine(page);
    // The gate is untouched: still blocked, still the page's control state.
    assertIdentityChip(line, 'BLOCKED');
    // The worker is stated separately, and truthfully.
    assertBuildChip(line, 'WAITING');
    assertCanonicalField(line, 'CHECKS_PASSED');
    assert.match(line.fields.why.textContent, /The build finished and its automated checks passed\./,
      `a finished worker was not stated as finished: ${line.fields.why.textContent}`);
    assert.ok(!/Nothing finished|Nothing has finished yet|stopped on/.test(line.fields.why.textContent),
      `a finished worker was described as a failure: ${line.fields.why.textContent}`);
    assert.ok(!/is the run AEGIS is working on right now/.test(line.fields.why.textContent),
      'a finished worker was presented as work still running');

    const cells = opsCells(page);
    assertCellStates(cells['run-state'], { state: 'BLOCKED', plain: 'Needs attention' }, 'gate readiness');
    assert.match(cells['run-state'].textContent, /GATE READINESS/);
    assert.match(cells['run-state'].textContent,
      /Blocked — the required checks on this exact code version still have unmet requirements\./,
      `the gate lost its recorded reason: ${cells['run-state'].textContent}`);
    // The gate is never repainted as clear, and the reason stays reachable.
    assert.ok(!/^(PASS|COMPLETE)$/.test(cells['run-state'].attrs['data-ops-state']),
      'a blocked gate was rendered as a cleared one');
    const evidence = page.text('founder-body') + ' ' + page.text('evidence-rail-body');
    assert.match(evidence, /unresolved gate requirement/,
      `the unresolved gate requirement is no longer reachable from the current evidence view: ${evidence}`);
  });

  // The same two questions on the central HUD: Crew & models had been fed
  // currentAction, which the control plane overwrites with its own reason
  // whenever the gate blocks, and the core named its state only "Control plane".
  await atest('DOM: the central HUD separates worker state from gate readiness', async () => {
    const page = bootPage(fixtureState(), { status: REVIEW_PENDING_STATUS });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    const crew = page.text('hud-crew-state');
    assert.match(crew, /The build finished and its automated checks passed\./,
      `the finished worker is not stated on the crew instrument: ${crew}`);
    assert.ok(!/required checks on this exact code version|unmet requirements/.test(crew),
      `the crew instrument substituted the gate's reason for the worker state: ${crew}`);
    // The gate itself is untouched: same state word, now explicitly labelled.
    assert.strictEqual(page.text('hud-core-status'), RUN_STATE_PLAIN.BLOCKED);
    assert.match(code, /<div class="core-sub">Gate readiness<\/div>\s*<div class="core-status" id="hud-core-status">/,
      'the core does not name which question its state word answers');
  });

  await atest('DOM: a running worker and an unbound run state the worker plainly, not the gate', async () => {
    const running = JSON.parse(JSON.stringify(REVIEW_PENDING_STATUS));
    running.runs[0].state = 'BUILDING';
    running.runs[0].build = { status: 'RUNNING', activity: { active: true, summary: 'Editing the dashboard renderer.' } };
    const live = bootPage(fixtureState(), { status: running });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    assert.match(live.text('hud-crew-state'), new RegExp('^' + RUN_STATE_PLAIN.RUNNING + ' — '),
      `an active worker was not stated as running: ${live.text('hud-crew-state')}`);
    assert.strictEqual(live.document.getElementById('hud-crew-state').attrs['data-hud-code'], 'RUNNING',
      'the crew footer dropped the exact canonical lifecycle code behind its plain word');

    // No bound run: unknown is stated plainly, and nothing claims live work.
    const unbound = JSON.parse(JSON.stringify(REVIEW_PENDING_STATUS));
    unbound.runsBinding = { state: 'UNAVAILABLE', runId: null, reason: 'no run ledger binding is recorded' };
    unbound.runs = [];
    const idle = bootPage(fixtureState(), { status: unbound });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    const idleCrew = idle.text('hud-crew-state');
    assert.match(idleCrew, /^No active worker — /, `a missing worker was not stated plainly: ${idleCrew}`);
    assert.strictEqual(idle.document.getElementById('hud-crew-state').attrs['data-hud-code'], 'IDLE',
      'the crew footer dropped the exact canonical lifecycle code for an absent worker');
    assert.ok(!/RUNNING|working on right now/.test(idleCrew),
      `a historical activity claimed a live worker: ${idleCrew}`);
  });

  await atest('DOM: recorded check counters without a verified receipt never read as checks that passed', async () => {
    const unverified = JSON.parse(JSON.stringify(REVIEW_PENDING_STATUS));
    unverified.runs[0].checks = { total: 12, passed: 12 };
    const page = bootPage(fixtureState(), { status: unverified });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    const line = opsRunLine(page);
    assertBuildChip(line, 'UNVERIFIED');
    assertIdentityChip(line, 'BLOCKED');
    assert.match(line.fields.why.textContent,
      /Check totals are recorded, but canonical receipt and lifecycle evidence have not verified a passing outcome\./,
      `unverified counters were not stated as unverified: ${line.fields.why.textContent}`);
    assert.ok(!/automated checks passed/.test(line.fields.why.textContent),
      `unverified counters were restated as checks that passed: ${line.fields.why.textContent}`);
  });

  // ── recording a founder decision ────────────────────────────────────────
  // The browser may say WHICH recommendation is being decided and nothing else.
  // The decision word is carried by the route it calls, so a page that could
  // post a verdict — or post anything beyond the one recommendation id — fails
  // here rather than after a decision is already in the canonical ledger.
  function researchDecisionPage(calls, response) {
    const status = researchStatus(researchProjectionFixture());
    return bootPage(fixtureState(), {
      fetch: async (path, init) => {
        calls.push({ path, init: init || {} });
        if (init && init.method === 'POST') return response;
        return { ok: true, json: async () => status };
      },
    });
  }

  const RECORDED_DECISION = {
    ok: true,
    json: async () => ({
      decision: 'APPROVED', lifecycleState: 'APPROVED_BY_MARC',
      decisionId: 'DEC-20260903120000-0a1b2c3d', decidedAt: '2026-09-03T12:00:00.000Z',
      decidedBy: 'MARC', recommendationId: 'REC-review-model-routing',
      reportId: 'RR-20260831-weekly', builderStarted: false,
      nextAction: 'A bounded packet proposal is recorded against this recommendation. No builder was ' +
        'started; scoping the packet and starting a governed build remain separate decisions.',
    }),
  };

  await atest('DOM: each founder decision posts only the recommendationId to its own dedicated route', async () => {
    const expected = [['APPROVE', 'Approve', '/api/research-approve'],
      ['PARK', 'Park', '/api/research-park'],
      ['REJECT', 'Reject', '/api/research-reject']];
    for (let index = 0; index < expected.length; index++) {
      const [word, label, route] = expected[index];
      const calls = [];
      const page = researchDecisionPage(calls, RECORDED_DECISION);
      for (let i = 0; i < 20; i++) await Promise.resolve();

      const buttons = decisionButtons(page);
      assert.deepStrictEqual(buttons.map((b) => b.attrs['data-research-decision']),
        ['APPROVE', 'PARK', 'REJECT'],
        'a decidable recommendation does not offer exactly the three founder decisions');
      assert.strictEqual(buttons[index].textContent, label,
        `the ${word} control is unlabelled or renamed`);

      buttons[index]._listeners.click[0]();
      for (let i = 0; i < 20; i++) await Promise.resolve();

      const posted = calls.filter((call) => call.init.method === 'POST');
      assert.strictEqual(posted.length, 1,
        `pressing ${label} produced ${posted.length} requests instead of exactly one`);
      assert.strictEqual(posted[0].path, route,
        `${label} did not post to its own dedicated route`);
      assert.strictEqual(posted[0].init.credentials, 'same-origin',
        `${label} was posted without the authenticated session`);
      assert.deepStrictEqual(Object.keys(JSON.parse(posted[0].init.body)), ['recommendationId'],
        `the ${label} body carried a field other than the one recommendation id`);
      assert.deepStrictEqual(JSON.parse(posted[0].init.body),
        { recommendationId: 'REC-review-model-routing' },
        `${label} named something other than the recommendation being decided`);
      assert.ok(buttons.every((button) => button.disabled === true),
        `the decision controls stayed pressable after ${label} was recorded`);
      assert.match(page.text('decision-queue-list'),
        new RegExp(`AEGIS recorded ${label} for this recommendation\\.`),
        `${label} recorded no visible receipt`);
      assert.match(page.text('decision-queue-list'),
        /No builder was started/,
        'the receipt did not restate that approving starts nothing');
      assert.match(page.text('live-activity'),
        new RegExp(`AEGIS wrote down your decision on one research recommendation: ${label}\\.`),
        `${label} was not published to the one activity feed`);
      assert.match(page.text('live-activity'), /deciding about research is not a build step/,
        'a recorded research decision was allowed to read as build progress');
    }
  });

  await atest('DOM: a refused decision records nothing and says so', async () => {
    const calls = [];
    const page = researchDecisionPage(calls, {
      ok: false, status: 409,
      json: async () => ({ error: { code: 'DECISION_ALREADY_RECORDED',
        message: 'this recommendation is not open for a decision' } }),
    });
    for (let i = 0; i < 20; i++) await Promise.resolve();
    const buttons = decisionButtons(page);
    buttons[0]._listeners.click[0]();
    for (let i = 0; i < 20; i++) await Promise.resolve();

    assert.match(page.text('decision-queue-list'),
      /AEGIS refused this decision \(DECISION_ALREADY_RECORDED\): this recommendation is not open for a decision\. Nothing was recorded\./,
      'a refused decision did not state the exact refusal, or claimed something was recorded');
    assert.ok(buttons.every((button) => button.disabled === false),
      'a refused decision left the controls locked, so the refusal cannot be acted on');
    assert.match(page.text('live-activity'), /so nothing was decided/,
      'a refused decision was not published as having decided nothing');
  });

  // ── startup and reconnect provenance ─────────────────────────────────────
  // OBSERVED ON A REAL RELOAD: a September 1 saved snapshot painted CURRENT RUN
  // and BLOCKED with nothing saying it was saved evidence, so an old run read as
  // freshly confirmed current work until the September 3 authenticated status
  // replaced it. These proofs drive the shipped bootstrap, the shipped
  // applyStatus seam and the shipped stream handlers — the page is never told
  // what to say, and no second status authority is introduced to say it.
  const SNAPSHOT_RUN = {
    runId: 'RUN-20260901-SNAPSHOT', state: 'BUILDING',
    objective: 'Saved snapshot objective recorded on September 1',
    updatedAt: '2026-09-01T09:00:00.000Z',
    build: { mode: 'async', status: 'RUNNING', exit: null,
      activity: { code: 'RUNNING', phase: 'RUNNING', active: true,
        summary: 'Builder was recorded working when this snapshot was written' } },
  };
  const savedSnapshot = () => fixtureState({
    generatedAt: '2026-09-01T09:00:00.000Z',
    runs: { state: 'OK', runs: [SNAPSHOT_RUN], current: {
      state: 'BOUND', runId: SNAPSHOT_RUN.runId, updatedAt: SNAPSHOT_RUN.updatedAt,
      evidenceState: 'OK', reason: 'the saved snapshot recorded this run as current',
    } },
  });
  const LIVE_RUN = {
    runId: 'RUN-20260903-LIVE', state: 'BUILD_FAILED',
    objective: 'Authenticated live objective recorded on September 3',
    updatedAt: '2026-09-03T14:00:00.000Z',
    build: { mode: 'async', status: 'FAILED', exit: 1, endedAt: '2026-09-03T14:00:00.000Z',
      activity: { active: false, phase: 'STOPPED', code: 'FAILED', summary: 'Builder exited' } },
  };
  const LIVE_STATUS = {
    generatedAt: '2026-09-03T14:00:00.000Z', runsState: 'OK',
    engineering: { state: 'OK', verdict: 'BLOCKED', subjectSha256: '7'.repeat(64), problems: [],
      reviewerCompleteness: { complete: false, rows: [] }, stages: [] },
    runs: [LIVE_RUN],
    runsBinding: { state: 'BOUND', runId: LIVE_RUN.runId, updatedAt: LIVE_RUN.updatedAt,
      evidenceState: 'OK', subjectState: 'UNLINKED', subjectSha256: null,
      gateSubjectSha256: '7'.repeat(64), reason: 'the authenticated live status selected this current run' },
    integration: { connectors: { state: 'OK', connectors: [] } },
    reviewers: [], events: [], cost: { state: 'UNAVAILABLE', reason: 'no cost receipt' },
  };
  const provenance = (page) => page.text('state-provenance');
  const provenanceState = (page) =>
    page.document.getElementById('state-provenance').getAttribute('data-provenance');

  await atest('DOM: startup names the saved snapshot as saved evidence with the live check still outstanding', async () => {
    // The bootstrap never answers, which is exactly the window in which the old
    // page presented September 1 as the current run.
    const page = bootPage(savedSnapshot(), { fetch: () => new Promise(() => {}) });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    assert.strictEqual(provenanceState(page), 'SNAPSHOT',
      'the startup view did not mark itself as saved snapshot evidence');
    assert.match(provenance(page),
      /SAVED SNAPSHOT \(2026-09-01T09:00:00\.000Z\) — not confirmed current work/,
      'the startup view did not name itself as saved evidence recorded at its own canonical time');
    assert.match(provenance(page), /Live status is being checked now/,
      'the startup view did not state that the live check is still outstanding');
    assert.doesNotMatch(provenance(page), /CURRENT AUTHENTICATED STATUS/,
      'a saved snapshot was presented as confirmed current status');
    // The saved evidence itself stays on the page, labelled rather than hidden.
    assert.match(page.text('runs-list'), /RUN-20260901-SNAPSHOT/,
      'the saved run evidence was erased instead of being labelled');
    assert.match(page.text('founder-body'), /Saved snapshot objective recorded/i,
      'the saved objective was dropped from the brief it was recorded for');
  });

  await atest('DOM: only a validated authenticated status promotes provenance — an open stream cannot', async () => {
    // The bootstrap answers with a payload carrying no canonical evidence, so
    // the stream opens with nothing validated behind it.
    const page = bootPage(savedSnapshot(), { status: {} });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    assert.strictEqual(provenanceState(page), 'UNVERIFIED',
      'a response with no canonical evidence was accepted as live status');
    assert.match(provenance(page), /Nothing here is confirmed current work/,
      'an unusable status response left the page claiming confirmed work');
    assert.match(provenance(page),
      /saved snapshot evidence from state\.js \(2026-09-01T09:00:00\.000Z\)/,
      'the unverified reading stopped naming the evidence the page can actually account for');
    assert.match(page.text('runs-list'), /RUN-20260901-SNAPSHOT/,
      'an empty response blanked run evidence instead of leaving it labelled');

    assert.ok(page.sse.opened && typeof page.sse.onopen === 'function',
      'the page never opened the live stream, so transport cannot be proven inert');
    page.sse.onopen();
    assert.strictEqual(provenanceState(page), 'UNVERIFIED',
      'an open transport promoted the page to live status on its own');
    assert.match(page.text('live-conn-state'), /stream open — waiting for the first status push/,
      'the connection line claimed status evidence the stream had not delivered');

    page.sse.listeners.status[0]({ data: JSON.stringify(LIVE_STATUS) });
    assert.strictEqual(provenanceState(page), 'LIVE',
      'a validated authenticated status did not change the provenance of the page');
    assert.match(provenance(page), /CURRENT AUTHENTICATED STATUS \(2026-09-03T14:00:00\.000Z\)/,
      'live provenance did not cite the canonical time of the status it was granted by');
    assert.match(page.text('runs-list'), /RUN-20260903-LIVE/,
      'the validated live status did not replace the saved run view');
  });

  await atest('DOM: a dropped stream states the connection is unavailable and keeps the last received evidence intact', async () => {
    const page = bootPage(savedSnapshot(), { status: LIVE_STATUS });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    assert.strictEqual(provenanceState(page), 'LIVE',
      'an authenticated bootstrap did not establish live provenance');

    page.sse.onerror();
    assert.strictEqual(provenanceState(page), 'DISCONNECTED',
      'a dropped stream left the page claiming confirmed current status');
    assert.match(provenance(page), /LIVE STATUS UNAVAILABLE — the connection could not be confirmed/,
      'the dropped connection was not stated');
    assert.match(provenance(page),
      /the last authenticated status received \(2026-09-03T14:00:00\.000Z\)/,
      'the disconnected view did not name the last evidence it actually received');
    assert.match(provenance(page), /no recorded run outcome has been changed/,
      'the disconnected view did not state that it rewrote nothing');
    assert.match(page.text('live-conn-state'), /disconnected/,
      'the connection line kept claiming a live stream');
    assert.match(page.text('runs-list'), /RUN-20260903-LIVE/,
      'the last received run evidence was erased by the disconnection');
    assert.match(page.text('runs-list'), /BUILD_FAILED/,
      'a recorded run outcome was rewritten by the disconnection');

    // Reconnect: only a validated status may restore live provenance.
    page.sse.listeners.status[0]({ data: 'not json' });
    assert.strictEqual(provenanceState(page), 'DISCONNECTED',
      'a malformed push restored live provenance');
    page.sse.listeners.status[0]({ data: JSON.stringify(LIVE_STATUS) });
    assert.strictEqual(provenanceState(page), 'LIVE',
      'a validated push after a reconnect did not restore live provenance');
  });

  await atest('DOM: a failed bootstrap keeps the saved snapshot visible and labelled as unconfirmed', async () => {
    const page = bootPage(savedSnapshot(),
      { fetch: async () => { throw new Error('live status unavailable'); } });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    assert.match(page.text('live-conn-state'), /UNAVAILABLE — could not bootstrap \/api\/status/);
    assert.strictEqual(provenanceState(page), 'DISCONNECTED',
      'a failed bootstrap left the saved snapshot reading as confirmed current work');
    assert.match(provenance(page),
      /saved snapshot evidence from state\.js \(2026-09-01T09:00:00\.000Z\)/,
      'the failed bootstrap did not name the saved evidence still on the screen');
    assert.match(provenance(page), /It is not confirmed current work/,
      'saved evidence was left unqualified after the live check failed');
    assert.match(page.text('runs-list'), /RUN-20260901-SNAPSHOT/,
      'the saved run evidence was erased when the live check failed');
  });

  await atest('DOM: with no snapshot and no live status the provenance line claims no evidence at all', async () => {
    const page = bootPage(null, { fetch: async () => { throw new Error('live status unavailable'); } });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    assert.strictEqual(provenanceState(page), 'DISCONNECTED');
    assert.match(provenance(page), /no saved snapshot and no authenticated status/,
      'a page with no evidence at all still named some');
    assert.match(page.text('fatal'), /UNAVAILABLE — no AEGIS state is loaded/,
      'the missing-snapshot warning was rewritten by the provenance line');
  });

  // The second gap: the validator accepted ANY named field that was not null,
  // so a bare timestamp or a plane arriving as false bought live provenance,
  // and the stream handler wrote "receiving authenticated status" before
  // anything had been validated at all.
  await atest('DOM: a timestamp alone and a malformed plane are not live status evidence', async () => {
    for (const [label, payload] of [
      ['a bare timestamp', { generatedAt: '2026-09-03T14:00:00.000Z' }],
      ['a plane arriving as false', { generatedAt: '2026-09-03T14:00:00.000Z', engineering: false }],
      ['a plane arriving as a list', { runsBinding: [] }],
      ['a plane arriving as a string', { engineering: 'OK' }],
      ['a list where the envelope belongs', [{ runs: [] }]],
    ]) {
      const page = bootPage(savedSnapshot(), { status: payload });
      for (let i = 0; i < 10; i++) await Promise.resolve();
      assert.strictEqual(provenanceState(page), 'UNVERIFIED',
        `${label} was accepted as an authenticated evidence plane`);
      assert.match(page.text('live-conn-state'), /UNVERIFIED/,
        `${label} left the connection line claiming confirmed status`);
      assert.match(page.text('runs-list'), /RUN-20260901-SNAPSHOT/,
        `${label} blanked the previous run evidence instead of keeping it labelled`);
      assert.match(provenance(page),
        /saved snapshot evidence from state\.js \(2026-09-01T09:00:00\.000Z\)/,
        `${label} stopped the page naming the evidence it can actually account for`);
    }
  });

  // The bar is minimal, not a schema: an honestly partial answer is still
  // evidence, and rejecting it would blank instruments over an UNAVAILABLE
  // envelope the projector recorded on purpose.
  await atest('DOM: one correctly typed plane is enough, including an authentic partial answer', async () => {
    for (const [label, payload] of [
      ['an UNAVAILABLE cost envelope', { generatedAt: '2026-09-03T14:00:00.000Z',
        cost: { state: 'UNAVAILABLE', reason: 'no cost receipt' } }],
      ['an empty runs list', { generatedAt: '2026-09-03T14:00:00.000Z', runs: [] }],
      ['a runs state word', { generatedAt: '2026-09-03T14:00:00.000Z', runsState: 'UNAVAILABLE' }],
    ]) {
      const page = bootPage(savedSnapshot(), { status: payload });
      for (let i = 0; i < 10; i++) await Promise.resolve();
      assert.strictEqual(provenanceState(page), 'LIVE',
        `${label} was refused, so an authentic partial answer was treated as malformed`);
    }
  });

  await atest('DOM: an unusable push never labels the stream as receiving status, and clears the motion cue', async () => {
    const page = bootPage(savedSnapshot(), { status: LIVE_STATUS });
    for (let i = 0; i < 10; i++) await Promise.resolve();

    // A genuine push labels the stream and cues the core; the unusable push
    // that follows must take both back rather than leave them standing.
    page.sse.listeners.status[0]({ data: JSON.stringify(
      activityStatus(activityEvidence('2026-09-03T14:10:04.000Z', 'EDITING'))) });
    assert.match(page.text('live-conn-state'), /connected — receiving authenticated status/,
      'a validated push did not establish the connection line');
    page.sse.listeners.status[0]({ data: JSON.stringify(
      activityStatus(activityEvidence('2026-09-03T14:10:06.000Z', 'EDITING'))) });
    const cued = coreCue(page);
    assert.ok(cued === 'a' || cued === 'b',
      `a genuinely new recorded activity produced no core cue to clear: ${cued}`);

    page.sse.listeners.status[0]({ data: JSON.stringify({ generatedAt: '2026-09-03T14:11:00.000Z' }) });
    assert.strictEqual(provenanceState(page), 'UNVERIFIED',
      'a push carrying only a timestamp was promoted to live status');
    assert.doesNotMatch(page.text('live-conn-state'), /receiving authenticated status/,
      'the stream was labelled as receiving authenticated status before anything validated it');
    assert.match(page.text('live-conn-state'), /UNVERIFIED/,
      'an unusable push left the connection line unqualified');
    assert.strictEqual(coreCue(page), null,
      'an unusable push left a motion cue standing for activity nothing confirmed');
  });
}

// ── the Monday research report and the Marc decision queue ─────────────────
// The failure these proofs exist to catch is the one this whole surface is
// built to prevent: a founder approving something nobody checked, or approving
// from a report AEGIS could not vouch for. Every proof below drives the REAL
// hosting minimizer and the REAL page renderer, so a panel that shows a report
// it should have refused, or offers a decision the projector closed, fails here
// rather than on a Monday morning.
function researchRecommendationFixture(over) {
  return Object.assign({
    recommendationId: 'REC-review-model-routing',
    title: 'Route independent review to the cheaper checked model',
    whatChanged: 'The provider published a cheaper review model with the same recorded review quality.',
    whyItMatters: 'Every independent review is billed at the older price today, so this changes what a review costs.',
    marcMustDecide: 'Whether AEGIS should route independent review to the cheaper model.',
    evidence: [{ label: 'Published pricing page', url: 'https://example.com/pricing' }],
    risks: ['The cheaper model has no recorded review result on this repository yet.'],
    cost: { state: 'ESTIMATED', amountUsd: 12.5, display: 'US$12.50 estimated',
      basis: 'the provider list price applied to the last recorded review volume' },
    verification: { verifiedAt: '2026-09-01T08:30:00.000Z', verifiedBy: 'research-agent',
      method: 'read the published pricing page and compared it with the recorded review volume' },
    reportedStage: 'RECOMMENDED',
    lifecycle: { state: 'RECOMMENDED', label: 'RECOMMENDED',
      plain: AegisState.RESEARCH_LIFECYCLE_PLAIN.RECOMMENDED,
      source: 'builder-control/research-report.json' },
    decision: null, outcome: null,
    decidable: true, notDecidableReason: null,
    recommendationSha256: 'c'.repeat(64),
    source: 'builder-control/research-report.json',
  }, over || {});
}

function researchProjectionFixture(over) {
  return Object.assign({
    state: 'OK', reason: null,
    source: 'builder-control/research-report.json',
    ledgerSource: 'builder-control/ledger.json',
    report: {
      reportId: 'RR-20260831-weekly', title: 'Weekly research: one change worth deciding on',
      weekOf: '2026-08-31', notionPageId: 'a'.repeat(32),
      notionUrl: `https://www.notion.so/${'a'.repeat(32)}`,
      fetchedAt: '2026-09-01T09:00:00.000Z', fetchedBy: 'aegis-research-fetcher',
      fetchedAgeMinutes: 120, thresholdMinutes: 10080, reportSha256: 'b'.repeat(64),
    },
    decisionsAvailable: true, decisionsUnavailableReason: null,
    recommendations: [researchRecommendationFixture()],
    counts: { total: 1, awaitingMarc: 1, approved: 0, parked: 0, rejected: 0 },
  }, over || {});
}

// The status shape the browser actually receives: the projector envelope put
// through the REAL hosting minimizer, never a hand-written public payload.
function researchStatus(projection) {
  return {
    generatedAt: '2026-09-03T12:00:00.000Z',
    engineering: { state: 'UNAVAILABLE', reason: 'not under test here' },
    integration: { connectors: [] }, reviewers: [], events: [],
    cost: { state: 'UNAVAILABLE', reason: null },
    runs: [],
    runsBinding: { state: 'UNAVAILABLE', runId: null, evidenceState: 'OK',
      reason: 'no run records exist yet, so no run is current.' },
    research: Hosting.minimizeResearch(projection),
  };
}

function decisionButtons(page) {
  return findByAttr(page.document.getElementById('decision-queue-list'), 'data-research-decision');
}

function researchCommandText(page) {
  return `${page.text('research-report-body')} ${page.text('decision-queue-summary')} ${page.text('decision-queue-list')}`;
}

test('DOM: no valid research report shows an honest empty state and offers no decision', () => {
  // The generated snapshot carries no research plane at all — the exact case a
  // dashboard fills with a friendly placeholder.
  const page = bootPage(fixtureState());
  assert.match(page.text('research-report-body'), /No Monday research report is being shown/,
    'a missing research projection did not say so');
  assert.match(page.text('research-report-body'),
    /No Monday research report has been fetched, so there is nothing to read and nothing to approve\./,
    'the honest empty state did not state why nothing is shown');
  assert.match(page.text('decision-queue-list'),
    /Nothing can be approved, parked or rejected while no valid report is available\./,
    'the decision queue invented a queue with no report behind it');
  assert.deepStrictEqual(decisionButtons(page), [],
    'a decision control was offered with no research report at all');

  // An INVALID artifact is the more dangerous case: the file exists. Nothing
  // from it may reach the screen, whole or in part.
  renderMinimizedStatus(page, researchStatus({
    state: 'INVALID',
    reason: 'The Monday research report projection failed 3 contract check(s), so none of it is shown.',
    report: null, recommendations: [], decisionsAvailable: false,
    decisionsUnavailableReason: 'The Monday research report projection failed 3 contract check(s), so none of it is shown.',
    counts: { total: 0, awaitingMarc: 0, approved: 0, parked: 0, rejected: 0 },
  }));
  assert.match(page.text('research-report-body'), /failed 3 contract check\(s\)/,
    'an invalid report did not state the recorded refusal');
  assert.doesNotMatch(researchCommandText(page), /REC-|RR-2026/,
    'an invalid report leaked report or recommendation content onto the screen');
  assert.deepStrictEqual(decisionButtons(page), [],
    'an invalid report still offered a decision control');
});

test('DOM: a valid research report shows what changed, why it matters, evidence, cost, risks and the decision requested', () => {
  const page = bootPage(fixtureState());
  const projection = researchProjectionFixture();
  renderMinimizedStatus(page, researchStatus(projection));
  const item = projection.recommendations[0];

  const report = page.text('research-report-body');
  assert.ok(report.includes(projection.report.title), 'the report title is missing');
  assert.match(report, /Week of 2026-08-31\./, 'the week the report covers is missing');
  assert.match(report, /Copied from the research document by aegis-research-fetcher\./,
    'the report does not say where it came from or who fetched it');
  assert.match(report, /This is the current report\. Everything in it is a proposal until you decide on it\./,
    'a current report is not stated as a set of proposals');
  assert.match(report, /1 recommendation\(s\) in this report · 1 waiting for your decision/,
    'the report does not count what is waiting for a decision');

  const queue = page.text('decision-queue-list');
  for (const [label, value] of [
    ['What changed', item.whatChanged],
    ['Why it matters', item.whyItMatters],
    ['What you are being asked to decide', item.marcMustDecide],
  ]) {
    assert.ok(queue.includes(label), `the queue does not ask "${label}"`);
    assert.ok(queue.includes(value), `the queue does not answer "${label}"`);
  }
  assert.ok(queue.includes(item.title), 'the recommendation has no title');
  assert.ok(queue.includes(AegisState.RESEARCH_LIFECYCLE_PLAIN.RECOMMENDED),
    'the projector-owned lifecycle sentence was replaced or dropped');
  assert.match(queue, /US\$12\.50 estimated — the provider list price/,
    'the recorded cost and its basis are missing');
  assert.ok(queue.includes(item.risks[0]), 'the recorded risk is missing');
  assert.ok(queue.includes(item.evidence[0].label), 'the evidence link is missing');
  assert.ok(queue.includes(item.verification.method),
    'the queue does not say how this claim was checked');

  // The local control surface stays same-origin. The evidence label is visible
  // in Command View and the exact source reference is preserved in Detail View.
  const links = findByAttr(page.document.getElementById('decision-queue-list'), 'href');
  assert.deepStrictEqual(links, [], 'Command View created an external navigation link');
  assert.ok(page.document.getElementById('research-machine').textContent.includes(item.evidence[0].url),
    'Detail View dropped the exact evidence source reference');
});

test('DOM: an unchecked signal is never dressed as a checked recommendation', () => {
  const page = bootPage(fixtureState());
  renderMinimizedStatus(page, researchStatus(researchProjectionFixture({
    recommendations: [researchRecommendationFixture({
      verification: null,
      lifecycle: { state: 'SIGNAL', label: 'SIGNAL',
        plain: AegisState.RESEARCH_LIFECYCLE_PLAIN.SIGNAL,
        source: 'builder-control/research-report.json' },
    })],
  })));
  const queue = page.text('decision-queue-list');
  assert.ok(queue.includes(AegisState.RESEARCH_LIFECYCLE_PLAIN.SIGNAL),
    'an unverified signal did not carry the projector sentence saying nobody checked it');
  assert.match(queue, /Not checked — nobody has verified this claim/,
    'a recommendation with no verification record did not say so');
  const state = findByAttr(page.document.getElementById('decision-queue-list'), 'data-recommendation-state');
  assert.deepStrictEqual(state.map((node) => node.attrs['data-recommendation-state']), ['SIGNAL'],
    'the recommendation does not carry its canonical lifecycle state as a machine attribute');
});

test('DOM: a stale report and an already-decided recommendation cannot be approved', () => {
  const staleReason = 'This projection was fetched 20000 minute(s) ago, older than the 10080-minute ' +
    'Monday cycle. It is shown as history; approving from an out-of-date report is not offered.';
  const page = bootPage(fixtureState());
  renderMinimizedStatus(page, researchStatus(researchProjectionFixture({
    state: 'STALE', reason: staleReason,
    decisionsAvailable: false, decisionsUnavailableReason: staleReason,
    recommendations: [researchRecommendationFixture({ decidable: false, notDecidableReason: staleReason })],
  })));
  assert.match(page.text('research-report-body'), /older than the 10080-minute/,
    'a stale report did not explain that it is history');
  assert.ok(page.text('decision-queue-list').includes(staleReason),
    'the stale report did not state why no decision is offered on the item');
  assert.deepStrictEqual(decisionButtons(page), [],
    'a stale report still offered Approve, Park or Reject');

  // Already decided: the ledger holds the decision, and a second one would be a
  // reversal rather than a decision. The queue states the recorded decision and
  // offers no control.
  const decidedReason = 'You already recorded APPROVED BY MARC for this on 2026-09-02T10:00:00.000Z. ' +
    'Decisions are appended, never overwritten.';
  renderMinimizedStatus(page, researchStatus(researchProjectionFixture({
    counts: { total: 1, awaitingMarc: 0, approved: 1, parked: 0, rejected: 0 },
    recommendations: [researchRecommendationFixture({
      decidable: false, notDecidableReason: decidedReason,
      lifecycle: { state: 'APPROVED_BY_MARC', label: 'APPROVED BY MARC',
        plain: AegisState.RESEARCH_LIFECYCLE_PLAIN.APPROVED_BY_MARC,
        source: 'builder-control/ledger.json#LED-DECISION-0123456789abcdef0123456789abcdef' },
      decision: { state: 'APPROVED_BY_MARC', decisionId: 'DEC-20260902100000-0a1b2c3d',
        decidedAt: '2026-09-02T10:00:00.000Z', decidedBy: 'MARC',
        entryId: 'LED-DECISION-0123456789abcdef0123456789abcdef',
        proposal: { proposalId: 'PROP-20260902100000-4e5f6a7b', state: 'PROPOSED',
          proposedPacketId: 'PKT-PROPOSED-20260902100000-REC-review-model-routing',
          objective: 'Route independent review to the cheaper checked model',
          sourceRecommendationId: 'REC-review-model-routing', builderStarted: false } },
    })],
  })));
  assert.ok(page.text('decision-queue-list').includes(decidedReason),
    'an already-decided recommendation did not restate the recorded decision');
  assert.deepStrictEqual(decisionButtons(page), [],
    'an already-decided recommendation was offered a second, overwriting decision');
  assert.ok(page.text('decision-queue-list').includes(
    AegisState.RESEARCH_LIFECYCLE_PLAIN.APPROVED_BY_MARC),
  'the recorded approval did not state that no builder was started');
});

test('DOM: research identifiers and digests stay in Detail View, not in the founder panels', () => {
  const page = bootPage(fixtureState());
  const projection = researchProjectionFixture();
  renderMinimizedStatus(page, researchStatus(projection));

  const machine = page.text('research-machine');
  for (const value of ['RR-20260831-weekly', 'b'.repeat(64), 'REC-review-model-routing',
    'a'.repeat(32), '2026-09-01T09:00:00.000Z']) {
    assert.ok(machine.includes(value), `Detail View dropped the machine value ${value}`);
  }
  assert.match(machine, /decidable=true/, 'Detail View does not disclose the decidability it acted on');

  const command = researchCommandText(page);
  for (const machineOnly of ['RR-20260831-weekly', 'b'.repeat(64), 'c'.repeat(64),
    'REC-review-model-routing', 'reportSha256']) {
    assert.ok(!command.includes(machineOnly),
      `the founder panels print the machine field ${machineOnly}`);
  }
});

// ── the recommendation card: reading order, full text, decision footer ─────
// The failure guarded here is a layout failure with a governance consequence.
// The card inherits .row, a two-column ledger line, which sets the risks beside
// the evidence and squeezes Approve / Park / Reject into a third column where
// the "appended once and never overwritten" notice is a fragment beside the
// button that takes the decision. Every proof below drives the REAL renderer,
// so a card that reads sideways, drops a sentence, or breaks the footer fails
// here rather than under a founder's cursor on a Monday morning.
const LONG_TITLE = 'Route independent review to the cheaper checked model everywhere it is ' +
  'billed today, including the protected-path lane that currently carries every high-risk subject';
const LONG_DECISION = 'Whether AEGIS should route independent review to the cheaper model for ' +
  'every subject, or only for the low-risk lane, knowing that the cheaper model has never ' +
  'returned a recorded verdict on a protected path in this repository and that the first ' +
  'review under it would be the one that decides whether a high-risk change is allowed to land.';
const LONG_RISK = 'The cheaper model has no recorded review result on this repository yet, so ' +
  'approving this route would make the first independent review billed under it the same review ' +
  'that has to catch a protected-path regression nobody has seen it catch before.';
const SECOND_RISK = 'A second recorded risk must still be readable and must not be pushed off ' +
  'the card by the length of the first one.';
const LONG_EVIDENCE_LABEL = 'Published pricing page for the independent review model family, ' +
  'compared against the recorded review volume of the last four weeks';
const LONG_EVIDENCE_URL = 'https://example.com/pricing/independent-review/' + 'a'.repeat(120) +
  '?compare=recorded-review-volume';

function longResearchProjection(over) {
  return researchProjectionFixture(Object.assign({
    recommendations: [researchRecommendationFixture(Object.assign({
      title: LONG_TITLE,
      marcMustDecide: LONG_DECISION,
      risks: [LONG_RISK, SECOND_RISK],
      evidence: [{ label: LONG_EVIDENCE_LABEL, url: LONG_EVIDENCE_URL }],
    }, (over && over.item) || {}))],
  }, (over && over.projection) || {}));
}

function researchCard(page) {
  const list = page.document.getElementById('decision-queue-list');
  assert.strictEqual(list.children.length, 1, 'expected exactly one rendered recommendation card');
  return list.children[0];
}

// "H3", "DIV.research-head" — tag plus the exact shipped class list, so a
// reordered, renamed or newly-wrapped child is a visible diff in the failure.
function shape(node) {
  return node.children.map((c) => `${c.tagName}${c.className ? `.${c.className}` : ''}`);
}

// The page sets className directly rather than via setAttribute, so findByAttr
// cannot see it.
function findByClass(root, cls, out = []) {
  if (root.classList && root.classList.contains(cls)) out.push(root);
  (root.children || []).forEach((c) => findByClass(c, cls, out));
  return out;
}

const CARD_SHAPE = ['H3', 'DIV.research-head', 'DIV.research-line',
  'DL.research-answers', 'DIV.btn-row research-decision'];

test('DOM: a recommendation reads top to bottom as one card and keeps every sentence in full', () => {
  const page = bootPage(fixtureState());
  const projection = longResearchProjection();
  renderMinimizedStatus(page, researchStatus(projection));

  const card = researchCard(page);
  assert.ok(card.classList.contains('research-item'),
    'the recommendation card lost the class its scoped layout is written against');
  assert.ok(card.classList.contains('row'),
    'the shipped list-row class was removed rather than overridden in research-scoped CSS');
  assert.deepStrictEqual(shape(card), CARD_SHAPE,
    'the card must read title, recorded state, plain sentence, answers, then controls');

  // Nothing is abbreviated on the way to an irreversible decision: the whole
  // recorded sentence is on the card, not a prefix of it.
  const queue = page.text('decision-queue-list');
  for (const full of [LONG_TITLE, LONG_DECISION, LONG_RISK, SECOND_RISK, LONG_EVIDENCE_LABEL]) {
    assert.ok(queue.includes(full), `the card truncated or dropped a recorded sentence: ${full.slice(0, 48)}…`);
  }
  assert.ok(!queue.includes('…'), 'the card ellipsised recorded text');
  // Both risks are separate list items, so the second cannot be swallowed by
  // the length of the first.
  const lists = findByClass(card, 'research-list');
  assert.strictEqual(lists.length, 2, 'expected one list for the risks and one for the evidence');
  assert.deepStrictEqual(lists[0].children.map((li) => li.textContent), [LONG_RISK, SECOND_RISK],
    'the recorded risks are not two separately readable items');
  assert.ok(page.text('research-machine').includes(LONG_EVIDENCE_URL),
    'Detail View dropped the exact long evidence address');
});

test('DOM: the decision footer carries the three controls with the immutable notice below them', () => {
  const page = bootPage(fixtureState());
  renderMinimizedStatus(page, researchStatus(longResearchProjection()));

  const card = researchCard(page);
  const footer = card.children[card.children.length - 1];
  assert.strictEqual(footer.className, 'btn-row research-decision',
    'the decision footer is not the shipped button row marked as this card\'s footer');
  assert.deepStrictEqual(shape(footer), [
    'BUTTON.action primary', 'BUTTON.action', 'BUTTON.action warn', 'DIV.research-blocked',
  ], 'the footer must be Approve, Park, Reject, then the notice on its own line below them');

  // Labels, payload routes and handlers are the shipped ones; only where the
  // notice sits has changed.
  const buttons = decisionButtons(page);
  assert.deepStrictEqual(buttons.map((b) => [b.attrs['data-research-decision'], b.textContent]),
    [['APPROVE', 'Approve'], ['PARK', 'Park'], ['REJECT', 'Reject']],
    'the decision controls changed word or label');
  const notice = footer.children[footer.children.length - 1];
  assert.strictEqual(notice.textContent, 'A decision is appended once and never overwritten.',
    'the immutable-decision notice was reworded or moved out of the footer');
});

test('DOM: a blocked recommendation keeps the same card and footer, with the refusal and no control', () => {
  const blocked = 'You already recorded APPROVED BY MARC for this on 2026-09-02T10:00:00.000Z. ' +
    'Decisions are appended, never overwritten.';
  const page = bootPage(fixtureState());
  renderMinimizedStatus(page, researchStatus(longResearchProjection({
    item: { decidable: false, notDecidableReason: blocked },
  })));

  const card = researchCard(page);
  assert.deepStrictEqual(shape(card), CARD_SHAPE,
    'a blocked recommendation reads in a different order from a decidable one');
  const footer = card.children[card.children.length - 1];
  assert.strictEqual(footer.className, 'btn-row research-decision',
    'a blocked recommendation lost the ruled footer that separates decision from reading');
  assert.deepStrictEqual(shape(footer), ['DIV.research-blocked'],
    'the blocked footer must hold the recorded refusal and nothing else');
  assert.strictEqual(footer.children[0].textContent, blocked,
    'the recorded refusal was reworded on its way to the footer');
  assert.deepStrictEqual(decisionButtons(page), [],
    'an already-decided recommendation was offered a second, overwriting decision');
});

test('the research card layout is scoped to research and hides nothing', () => {
  // The shipped list-row and button-row rules are byte-identical: every other
  // list and every other control row on the page is untouched by this card.
  assert.ok(code.includes('.row{display:flex;justify-content:space-between;gap:calc(var(--sp)*3);align-items:flex-start;'),
    'the global .row rule was changed to fix one card');
  assert.ok(code.includes('.btn-row{display:flex;flex-wrap:wrap;gap:calc(var(--sp)*2)}'),
    'the global .btn-row rule was changed to fix one card');

  const css = code.slice(code.indexOf('.research-head{'), code.indexOf('#evidence-rail{border-color'));
  assert.ok(css.length > 0 && css.length < 2400, 'the research style block was not located');
  for (const [selector, property] of [
    ['.research-item{', 'display:block'],
    ['.research-decision{', 'border-top:1px solid var(--line)'],
  ]) {
    const rule = css.slice(css.indexOf(selector), css.indexOf('}', css.indexOf(selector)));
    assert.ok(css.includes(selector) && rule.includes(property),
      `${selector} does not set ${property}, so the card would keep the inherited row layout`);
  }
  assert.ok(/\.research-decision>\.research-blocked,\s*\.research-decision>\.api-msg\{flex:1 0 100%/.test(css),
    'the decision notice and the recorded receipt that replaces it must both take a full line');

  // Every selector in the block names the research surface, so nothing here can
  // reach another panel.
  const selectors = (css.match(/[^{}]+\{/g) || []).map((s) => s.slice(0, -1))
    .join(',').split(',').map((s) => s.trim()).filter(Boolean);
  assert.ok(selectors.length > 0, 'no research selectors were parsed');
  for (const selector of selectors) {
    assert.ok(selector.includes('research'),
      `the research block styles ${selector}, which is not scoped to the research surface`);
  }
  // A half-shown recommendation is how an unread risk gets approved: nothing on
  // this card may clamp, mask, truncate or hide.
  for (const banned of [/-webkit-line-clamp/, /text-overflow/, /overflow\s*:\s*hidden/,
    /white-space\s*:\s*nowrap/, /max-height/, /display\s*:\s*none/, /visibility\s*:/]) {
    assert.ok(!banned.test(css), `the research card uses ${banned} to hide recorded text`);
  }
});

// ── build journal (PKT-20260826-ASYNC-WORKER-OPERATOR-BETA) ────────────────
// The deck answers "what is happening" about one bound run. The journal answers
// "what happened lately", and the failure it must not have is the one every
// other instrument on this page is written against: a dated list of REQUESTED
// changes that reads as a list of delivered, available features. These proofs
// hold the four refusals it rests on — the window is measured from the recorded
// snapshot time, an undated or future record is never counted as recent and is
// never deleted, one entry per exact run id with disagreeing records left
// unverified, and no build state promoted into an availability or milestone
// claim.
const JOURNAL_AS_OF = '2026-09-03T12:00:00.000Z';

function journalRun(over) {
  return Object.assign({
    runId: 'RUN-20260903-aaaaaaaa', state: 'BUILT',
    objective: 'Add a compact build journal to Command View',
    updatedAt: '2026-09-03T11:00:00.000Z',
  }, over || {});
}

function journalFixture(runs, over) {
  return fixtureState(Object.assign({
    generatedAt: JOURNAL_AS_OF,
    runs: { state: 'OK', runs: runs, current: { state: 'UNAVAILABLE', runId: null,
      evidenceState: 'OK', reason: 'no run is bound in this journal fixture.' } },
  }, over || {}));
}

function journalSection(page) {
  const found = findByAttr(page.document.getElementById('founder-body'), 'data-build-journal');
  assert.strictEqual(found.length, 1, 'Command View does not render exactly one build journal');
  return found[0];
}

function journalList(section, name) {
  return findByAttr(section, 'data-journal-list')
    .find((node) => node.attrs['data-journal-list'] === name) || null;
}

function journalRows(section, name) {
  const list = journalList(section, name);
  assert.ok(list, `the build journal rendered no ${name} list`);
  return (list.children || []).filter((row) => row.attrs && row.attrs['data-journal-entry'] !== undefined);
}

function journalTabs(section) {
  return Object.fromEntries(findByAttr(section, 'data-journal-tab')
    .map((node) => [node.attrs['data-journal-tab'], node]));
}

test('DOM: the build journal windows 24 hours from the recorded snapshot time and reads newest first', () => {
  const runs = [
    journalRun({ runId: 'RUN-20260902-cccccccc', state: 'CHECKPOINTED',
      objective: 'One millisecond outside the window', updatedAt: '2026-09-02T11:59:59.999Z' }),
    journalRun({ runId: 'RUN-20260902-bbbbbbbb', state: 'BUILT',
      objective: 'Exactly on the 24 hour edge', updatedAt: '2026-09-02T12:00:00.000Z' }),
    journalRun({ runId: 'RUN-20260903-aaaaaaaa', state: 'CHECKS_PASSED',
      objective: 'One hour before the snapshot', updatedAt: '2026-09-03T11:00:00.000Z' }),
  ];
  const section = journalSection(bootPage(journalFixture(runs)));
  assert.strictEqual(section.attrs['data-build-journal'], 'OK');
  assert.deepStrictEqual(journalRows(section, 'recent').map((row) => row.attrs['data-journal-entry']),
    ['RUN-20260903-aaaaaaaa', 'RUN-20260902-bbbbbbbb'],
    'the 24-hour window is not measured from the snapshot time, or entries are not newest first');
  assert.deepStrictEqual(journalRows(section, 'older').map((row) => row.attrs['data-journal-entry']),
    ['RUN-20260902-cccccccc'],
    'a record just outside the window was deleted instead of kept in the earlier view');
  const asOf = findByAttr(section, 'data-journal-asof')[0];
  assert.ok(asOf, 'the journal states no as-of time at all');
  assert.strictEqual(asOf.attrs['data-journal-asof'], 'RECORDED');
  assert.match(asOf.textContent, /Last 24 hours as of the recorded snapshot time 2026-09-03T12:00:00\.000Z/,
    'the window is dated from something other than the recorded snapshot time');
  assert.match(asOf.textContent, /not your device clock/);
  // The as-of line restates the page's existing provenance signal rather than
  // inventing a second answer to "where did this come from".
  assert.match(asOf.textContent, /saved snapshot evidence from state\.js/,
    'the journal does not reuse the shipped connection and staleness signal');
});

test('DOM: a live authenticated push re-dates the journal window and names that provenance', () => {
  const page = bootPage(journalFixture([]));
  renderMinimizedStatus(page, {
    generatedAt: '2026-09-03T13:00:00.000Z',
    engineering: fixtureState().engineering,
    integration: { connectors: [] }, reviewers: [],
    cost: { state: 'UNAVAILABLE', reason: null },
    runs: [journalRun({ updatedAt: '2026-09-03T12:30:00.000Z' })],
    runsBinding: { state: 'UNAVAILABLE', runId: null, updatedAt: null, evidenceState: 'OK',
      reason: 'no run is bound in this journal fixture.' },
    events: [], knowledge: { state: 'UNKNOWN', conflicts: null },
  });
  const section = journalSection(page);
  const asOf = findByAttr(section, 'data-journal-asof')[0];
  assert.match(asOf.textContent, /Last 24 hours as of the recorded snapshot time 2026-09-03T13:00:00\.000Z/,
    'the journal kept the stale snapshot time after an authenticated status arrived');
  assert.match(asOf.textContent, /the last authenticated status received \(2026-09-03T13:00:00\.000Z\)/,
    'the journal does not name the authenticated status it was painted from');
  assert.strictEqual(journalRows(section, 'recent').length, 1,
    'the live push did not repaint the journal from its own run evidence');
});

test('DOM: with no recorded snapshot time the journal counts nothing as recent and keeps every record', () => {
  const section = journalSection(bootPage(journalFixture([journalRun()], { generatedAt: null })));
  const asOf = findByAttr(section, 'data-journal-asof')[0];
  assert.strictEqual(asOf.attrs['data-journal-asof'], 'UNAVAILABLE');
  assert.match(asOf.textContent, /As-of time UNAVAILABLE/);
  assert.strictEqual(journalRows(section, 'recent').length, 0,
    'a record was counted as recent with no recorded snapshot time to measure it against');
  const older = journalRows(section, 'older');
  assert.strictEqual(older.length, 1, 'the record was deleted rather than moved out of the window');
  assert.strictEqual(older[0].attrs['data-journal-time'], 'UNWINDOWED');
});

test('DOM: missing and future timestamps are never counted as recent and never print a machine value', () => {
  const runs = [
    journalRun({ runId: 'RUN-20260903-dddddddd', objective: 'No recorded time', updatedAt: null }),
    journalRun({ runId: 'RUN-20260903-eeeeeeee', objective: 'Unreadable time', updatedAt: 'yesterday-ish' }),
    journalRun({ runId: 'RUN-20260904-ffffffff', objective: 'Later than the snapshot',
      updatedAt: '2026-09-04T12:00:00.000Z' }),
  ];
  const section = journalSection(bootPage(journalFixture(runs)));
  assert.strictEqual(journalRows(section, 'recent').length, 0,
    'an unusable or future timestamp was silently counted as recent build work');
  const older = Object.fromEntries(journalRows(section, 'older')
    .map((row) => [row.attrs['data-journal-entry'], row]));
  assert.deepStrictEqual(Object.keys(older).sort(),
    ['RUN-20260903-dddddddd', 'RUN-20260903-eeeeeeee', 'RUN-20260904-ffffffff'],
    'a record with a bad or future timestamp was dropped from the journal entirely');
  assert.strictEqual(older['RUN-20260903-dddddddd'].attrs['data-journal-time'], 'UNDATED');
  assert.strictEqual(older['RUN-20260903-eeeeeeee'].attrs['data-journal-time'], 'UNDATED');
  assert.strictEqual(older['RUN-20260904-ffffffff'].attrs['data-journal-time'], 'FUTURE');
  assert.match(older['RUN-20260904-ffffffff'].textContent, /later than the snapshot time/);
  assert.doesNotMatch(section.textContent, /undefined|NaN|Invalid Date/,
    'a missing journal field reached the page as a machine value');
});

test('DOM: one journal entry per exact run id, and records that disagree stay unverified', () => {
  const conflicting = [
    journalRun({ state: 'BUILD_FAILED', updatedAt: '2026-09-03T10:00:00.000Z' }),
    journalRun({ state: 'CHECKS_PASSED', updatedAt: '2026-09-03T11:00:00.000Z',
      checks: { passed: 4, total: 4, outcome: 'PASS' } }),
  ];
  const section = journalSection(bootPage(journalFixture(conflicting)));
  const rows = journalRows(section, 'recent');
  assert.strictEqual(rows.length, 1, 'two records for one exact run id rendered as two journal entries');
  assert.strictEqual(rows[0].attrs['data-journal-state'], 'UNVERIFIED',
    'conflicting records for one run id were merged into a single recorded outcome');
  assert.match(rows[0].textContent, /2 records are filed under this exact run id and they do not agree/);
  assert.doesNotMatch(rows[0].textContent, /The build finished and its automated checks passed/,
    'the newer of two conflicting records was promoted into a successful outcome');
  // Deduplication is not deletion: both records stay readable under the entry.
  assert.match(rows[0].textContent, /Unmerged record: state BUILD_FAILED/);
  assert.match(rows[0].textContent, /Unmerged record: state CHECKS_PASSED/);

  // Records that agree are one entry reported from the latest of them, with no
  // unverified verdict invented out of an ordinary repeated write.
  const agreeing = [
    journalRun({ state: 'BUILT', updatedAt: '2026-09-03T10:00:00.000Z' }),
    journalRun({ state: 'BUILT', updatedAt: '2026-09-03T11:00:00.000Z' }),
  ];
  const agreed = journalRows(journalSection(bootPage(journalFixture(agreeing))), 'recent');
  assert.strictEqual(agreed.length, 1, 'two agreeing records for one run id rendered as two entries');
  assert.strictEqual(agreed[0].attrs['data-journal-state'], 'BUILT');
  assert.match(agreed[0].textContent, /Recorded 2026-09-03T11:00:00\.000Z/,
    'the entry is not reported from the latest recorded record for that run id');
  assert.match(agreed[0].textContent, /Records filed under this exact run id: 2\./);
});

test('DOM: a BUILT or CHECKS_PASSED journal entry is never promoted into availability or a milestone', () => {
  const runs = [
    journalRun({ runId: 'RUN-20260903-aaaaaaaa', state: 'BUILT', objective: 'Ship the founder dashboard',
      updatedAt: '2026-09-03T11:00:00.000Z' }),
    journalRun({ runId: 'RUN-20260903-bbbbbbbb', state: 'CHECKS_PASSED', objective: 'Ship the founder dashboard',
      updatedAt: '2026-09-03T11:30:00.000Z', checks: { passed: 4, total: 4, outcome: 'PASS' } }),
  ];
  const rows = journalRows(journalSection(bootPage(journalFixture(runs))), 'recent');
  assert.strictEqual(rows.length, 2);
  for (const row of rows) {
    assert.match(row.textContent, /Requested change: Ship the founder dashboard/,
      'the objective is stated as something other than the change that was requested');
    assert.doesNotMatch(row.textContent,
      /\bis available\b|\bnow available\b|\bavailable to use\b|\bshipped\b|\bdeployed\b|\bin production\b|\bmilestone reached\b/i,
      'a recorded build state was promoted into an availability or milestone claim');
    // A build state proves a build finished. It proves nothing about whether the
    // change can be used, and nothing about a milestone.
    assert.strictEqual(row.attrs['data-journal-availability'], 'UNVERIFIED',
      'a recorded build state was read as proof that the change is available');
    assert.match(row.textContent, /Available now: UNVERIFIED — no validated checkpoint is recorded for this run/,
      'the entry does not state in words that availability is unverified');
    assert.strictEqual(row.attrs['data-journal-milestone'], 'NONE',
      'an entry with no checkpoint, receipt or release evidence was marked a milestone');
    assert.match(row.textContent, /Not a milestone in the record: no validated checkpoint is recorded/,
      'the entry does not say why it is not a milestone');
    assert.strictEqual(row.attrs['data-journal-category'], 'unclassified',
      'a category was inferred from wording that matches no published term');
    assert.match(row.textContent, /Change type as requested: Unclassified — the recorded wording matches no term/,
      'the entry does not state that its change type is unclassified, and why');
    assert.match(row.textContent, /Release or publication receipt: NONE/,
      'the entry does not state that no release evidence exists at all');
  }
  // Newest first, in the page's own founder vocabulary — not a second one.
  assert.match(rows[0].textContent, /The build finished and its automated checks passed\./);
  assert.match(rows[1].textContent, /The build finished\. Its automated checks have not run yet\./);
  assert.strictEqual((code.match(/function founderFinished\(/g) || []).length, 1,
    'the journal introduced a second founder-language outcome authority');
});

test('DOM: the journal window toggle is a real keyboard control that hides no evidence', () => {
  const runs = [
    journalRun({ runId: 'RUN-20260903-aaaaaaaa', updatedAt: '2026-09-03T11:00:00.000Z' }),
    journalRun({ runId: 'RUN-20260901-bbbbbbbb', objective: 'Older work', updatedAt: '2026-09-01T11:00:00.000Z' }),
  ];
  const section = journalSection(bootPage(journalFixture(runs)));
  const tabs = journalTabs(section);
  assert.deepStrictEqual(Object.keys(tabs).sort(), ['older', 'recent'],
    'the journal does not offer exactly the last-24-hours and earlier/undated windows');
  for (const name of ['recent', 'older']) {
    assert.strictEqual(tabs[name].tagName, 'BUTTON', `the ${name} window control is not a button`);
    assert.strictEqual(tabs[name].type, 'button', `the ${name} window control could submit a form`);
    assert.ok(tabs[name].classList.contains('hud-control'),
      `the ${name} window control does not reuse the shipped finger-sized control`);
    assert.strictEqual((tabs[name]._listeners.click || []).length, 1,
      `the ${name} window control has no executable handler`);
  }
  assert.match(tabs.recent.textContent, /Last 24 hours \(1\)/);
  assert.match(tabs.older.textContent, /Earlier & undated \(1\)/);
  assert.strictEqual(tabs.recent.getAttribute('aria-pressed'), 'true');
  assert.strictEqual(tabs.older.getAttribute('aria-pressed'), 'false');
  assert.strictEqual(journalList(section, 'recent').getAttribute('hidden'), null);
  assert.strictEqual(journalList(section, 'older').getAttribute('hidden'), '');

  tabs.older._listeners.click[0]();
  assert.strictEqual(tabs.older.getAttribute('aria-pressed'), 'true');
  assert.strictEqual(tabs.recent.getAttribute('aria-pressed'), 'false');
  assert.strictEqual(journalList(section, 'older').getAttribute('hidden'), null,
    'the earlier and undated view is not disclosed by its own control');
  assert.strictEqual(journalList(section, 'recent').getAttribute('hidden'), '');
  assert.strictEqual(section.getAttribute('data-journal-view'), 'older');
  // Windowing is presentation: both recorded entries exist either way.
  assert.strictEqual(journalRows(section, 'recent').length + journalRows(section, 'older').length, 2,
    'switching the window deleted a recorded entry instead of disclosing the other list');
  // The list rule sets display:flex, which outranks the browser's own [hidden]
  // default: without this rule the closed window paints beside the open one.
  assert.ok(/\.journal-list\[hidden\]\{display:none\}/.test(code),
    'a journal window marked hidden is still displayed by the .journal-list rule');
});

// ── the 24-hour window is compact, not shortened ──────────────────────────
// Six recorded updates inside one 24 hours is an ordinary build day, and drawing
// all six open is what turns a 320px left rail into a page-long column beside a
// deck that fits one screen. The failure guarded here is the obvious way to fix
// that: quietly stop rendering the older half of the window, or re-sort it, or
// clamp its text, so a rail that reads calm is a rail that no longer carries the
// record. So each proof pairs "the rail is short" with "every recorded entry is
// still here, exactly once, in the recorded order, with its exact receipts".
const JOURNAL_MANY_IDS = ['RUN-20260903-aaaaaaaa', 'RUN-20260903-bbbbbbbb', 'RUN-20260903-cccccccc',
  'RUN-20260903-dddddddd', 'RUN-20260903-eeeeeeee', 'RUN-20260903-ffffffff'];
const JOURNAL_MANY_HOURS = ['11', '10', '09', '08', '07', '06'];

function journalBusyDay(count) {
  // Newest first by id, handed to the page in the WRONG order on purpose: the
  // visible set has to be the head of the resolver's own ordering, never the
  // order the ledger happened to arrive in.
  return JOURNAL_MANY_IDS.slice(0, count).map((runId, index) => journalRun({ runId,
    objective: `Recorded update ${index}`,
    updatedAt: `2026-09-03T${JOURNAL_MANY_HOURS[index]}:00:00.000Z` })).reverse();
}

function journalMoreDisclosure(section) {
  const found = findByAttr(section, 'data-journal-more');
  assert.strictEqual(found.length, 1,
    'the held-back 24-hour entries are not behind exactly one disclosure');
  return found[0];
}

test('DOM: the 24-hour window draws the newest few entries and discloses the rest exactly once', () => {
  const older = journalRun({ runId: 'RUN-20260901-99999999', objective: 'Older work',
    updatedAt: '2026-09-01T11:00:00.000Z' });
  const section = journalSection(bootPage(journalFixture(journalBusyDay(6).concat([older]))));

  // The rail: the newest three, in the recorded order the resolver already
  // established, and nothing else painted open.
  assert.deepStrictEqual(journalRows(section, 'recent').map((row) => row.attrs['data-journal-entry']),
    JOURNAL_MANY_IDS.slice(0, 3),
    'the open 24-hour list is not exactly the newest three recorded entries, newest first');

  // The record: the exact remainder, once, still newest first, behind a native
  // disclosure that counts what it is holding.
  const more = journalMoreDisclosure(section);
  assert.strictEqual(more.tagName, 'DETAILS',
    'the remaining recorded entries are not behind a native disclosure');
  assert.strictEqual(more.firstElementChild.tagName, 'SUMMARY',
    'the disclosure holding recorded entries has no keyboard-operable summary');
  assert.match(more.firstElementChild.textContent, /Show 3 more from the last 24 hours/,
    'the disclosure does not say how many recorded entries it is holding back');
  assert.deepStrictEqual(journalRows(section, 'recent-more').map((row) => row.attrs['data-journal-entry']),
    JOURNAL_MANY_IDS.slice(3),
    'the disclosed entries are not the exact remainder of the same newest-first window');
  // It belongs to the 24-hour list, so the existing window toggle still owns it:
  // switching to the earlier view closes the whole window, disclosure included.
  assert.strictEqual(findByAttr(journalList(section, 'recent'), 'data-journal-more').length, 1,
    'the disclosure sits outside the 24-hour list it belongs to, so the window toggle no longer governs it');
  assert.strictEqual(journalList(section, 'recent-more').getAttribute('hidden'), null,
    'the disclosed entries are hidden a second time, so opening the disclosure would reveal nothing');

  // Nothing is dropped and nothing is drawn twice: six recent entries plus the
  // one earlier record, each rendered exactly once anywhere in the journal.
  const painted = findByAttr(section, 'data-journal-entry').map((row) => row.attrs['data-journal-entry']);
  assert.strictEqual(painted.length, 7,
    'compacting the 24-hour window deleted a recorded entry or painted one twice');
  assert.deepStrictEqual(Array.from(new Set(painted)).sort(),
    JOURNAL_MANY_IDS.concat(['RUN-20260901-99999999']).sort(),
    'a recorded entry is missing from the journal, or appears under two windows at once');

  // The window control still counts every recorded entry, not just the visible
  // ones, so a compact rail can never read as a quieter build day.
  const tabs = journalTabs(section);
  assert.match(tabs.recent.textContent, /Last 24 hours \(6\)/,
    'the 24-hour count reports the visible entries rather than the recorded ones');
  assert.match(tabs.older.textContent, /Earlier & undated \(1\)/);

  // The earlier and undated view is unchanged: it is already one control away,
  // so it holds no second disclosure and hides nothing of its own.
  assert.deepStrictEqual(journalRows(section, 'older').map((row) => row.attrs['data-journal-entry']),
    ['RUN-20260901-99999999']);
  assert.strictEqual(findByAttr(journalList(section, 'older'), 'data-journal-more').length, 0,
    'the earlier and undated view was collapsed too, which hides evidence behind two disclosures');

  // A disclosed entry is the same entry, not a summary of one: its founder
  // sentences and its exact recorded receipts travel with it.
  const disclosed = journalRows(section, 'recent-more')[0];
  assert.match(journalLine(disclosed, 'availability'), /Available now: UNVERIFIED/,
    'a disclosed entry lost the availability sentence the visible entries carry');
  const detail = (disclosed.children || []).find((node) => node.tagName === 'DETAILS');
  assert.ok(detail, 'a disclosed entry lost its own exact-evidence disclosure');
  assert.match(detail.textContent, /Exact recorded timestamps: created UNAVAILABLE · updated 2026-09-03T08:00:00\.000Z/,
    'a disclosed entry lost the exact recorded timestamps it was rendered from');
});

test('DOM: a short 24-hour window is drawn open, with no disclosure and no held-back entry', () => {
  const section = journalSection(bootPage(journalFixture(journalBusyDay(3))));
  assert.deepStrictEqual(journalRows(section, 'recent').map((row) => row.attrs['data-journal-entry']),
    JOURNAL_MANY_IDS.slice(0, 3), 'a window at the visible limit was not drawn open');
  assert.strictEqual(findByAttr(section, 'data-journal-more').length, 0,
    'a disclosure appeared with no recorded entry behind it');
  assert.strictEqual(journalList(section, 'recent-more'), null,
    'an empty overflow list was rendered, which reads as evidence being held back');
});

test('the journal overflow is one declared cap over the resolver\'s own order, and it hides no text', () => {
  const journal = code.slice(code.indexOf('var JOURNAL_WINDOW_MS'),
    code.indexOf('function renderFounderSummary'));
  assert.ok(journal.length > 0, 'the build journal source boundary was not found');
  // One declared number, and the split is a slice of the list the existing
  // resolver already ordered — no second sort, filter, window or source.
  assert.ok(/var JOURNAL_VISIBLE_RECENT = 3;/.test(journal),
    'the visible 24-hour set is not one declared cap');
  assert.ok(/pane\.entries\.slice\(JOURNAL_VISIBLE_RECENT\)/.test(journal) &&
    /pane\.entries\.slice\(0, JOURNAL_VISIBLE_RECENT\)/.test(journal),
    'the visible and disclosed sets are not the two halves of one already-ordered list');
  assert.ok(/pane\.name === 'recent' && pane\.entries\.length > JOURNAL_VISIBLE_RECENT/.test(journal),
    'the cap reaches a window other than the 24-hour one, or collapses a list it does not need to');
  assert.strictEqual((journal.match(/function journalOverflow\(/g) || []).length, 1,
    'more than one place holds back a recorded journal entry');
  assert.strictEqual((journal.match(/journalOverflow\(overflow\)/g) || []).length, 1,
    'the overflow disclosure is built from more than one place, or never built at all');
  // Entries are rendered by the one existing row builder, so a disclosed entry
  // cannot become a shorter, second kind of entry.
  assert.strictEqual((journal.match(/list\.appendChild\(journalRow\(entry\)\)/g) || []).length, 2,
    'a disclosed entry is painted by something other than the journal\'s one row builder');
  assert.strictEqual((journal.match(/function journalRow\(/g) || []).length, 1,
    'a second row builder exists, so a disclosed entry could be a shorter kind of entry');

  // The rail is shortened by disclosing rows, never by hiding recorded text.
  const start = code.indexOf('.journal-more{');
  const end = code.indexOf('\n\n', start);
  assert.ok(start !== -1 && end > start, 'the journal overflow CSS block was not found');
  const css = code.slice(start, end);
  assert.ok(/\.journal-more>summary\{cursor:pointer/.test(css),
    'the overflow summary does not read as a control');
  assert.ok(/\.journal-more>summary:focus-visible\{outline:2px solid var\(--focus\)/.test(css),
    'the overflow summary loses the page\'s keyboard focus ring');
  assert.ok(!/@keyframes/.test(css) && !/\banimation\s*:/.test(css) && !/\btransition\s*:/.test(css),
    'the journal overflow animates — a disclosure may not move to look important');
  for (const banned of [/-webkit-line-clamp/, /text-overflow/, /overflow\s*:\s*hidden/,
    /white-space\s*:\s*nowrap/, /max-height/, /display\s*:\s*none/]) {
    assert.ok(!banned.test(css), `the journal overflow uses ${banned} to hide recorded text`);
  }
  // Phone: the new disclosure is as tappable as the exact-evidence one beside
  // it, and the phone reading order is untouched by any of this.
  assert.ok(/\.journal-detail>summary,\.journal-more>summary\{min-height:44px;display:flex;align-items:center\}/.test(PHONE),
    'the overflow disclosure is not finger-sized at phone width');
  assert.ok(/\.event-panel\{order:1\}#evidence-rail\{order:2\}#raw-state\{order:3\}/.test(PHONE),
    'the phone reading order changed while the desktop rail was compacted');
});

test('DOM: a record written twice is one fact, and equal-time records that differ still disagree', () => {
  const identical = [
    journalRun({ state: 'BUILT', updatedAt: '2026-09-03T11:00:00.000Z' }),
    journalRun({ state: 'BUILT', updatedAt: '2026-09-03T11:00:00.000Z' }),
  ];
  const repeated = journalRows(journalSection(bootPage(journalFixture(identical))), 'recent');
  assert.strictEqual(repeated.length, 1, 'one run id rendered as two journal entries');
  assert.strictEqual(repeated[0].attrs['data-journal-state'], 'BUILT',
    'a record written twice, byte for byte, was reported as records that disagree');
  assert.match(repeated[0].textContent, /Records filed under this exact run id: 1\./);
  assert.doesNotMatch(repeated[0].textContent, /they do not agree/,
    'an ordinary repeated write was turned into a contradiction in the record');

  // Same recorded time, different recorded evidence: a real contradiction, and
  // deduplication must not reach it. Both records stay, unmerged and readable.
  const differing = [
    journalRun({ state: 'BUILT', updatedAt: '2026-09-03T11:00:00.000Z',
      checks: { passed: 4, total: 4, outcome: 'PASS' } }),
    journalRun({ state: 'BUILT', updatedAt: '2026-09-03T11:00:00.000Z',
      checks: { passed: 3, total: 4, outcome: 'FAIL' } }),
  ];
  const tied = journalRows(journalSection(bootPage(journalFixture(differing))), 'recent');
  assert.strictEqual(tied.length, 1, 'one run id rendered as two journal entries');
  assert.strictEqual(tied[0].attrs['data-journal-state'], 'UNVERIFIED',
    'two records recorded at the same time with different evidence were merged into one outcome');
  assert.match(tied[0].textContent, /2 records are filed under this exact run id and they do not agree/);
});

test('DOM: an unreadable run ledger renders no journal entries, says why, and changes no existing control', () => {
  const page = bootPage(fixtureState({
    generatedAt: JOURNAL_AS_OF,
    runs: { state: 'UNAVAILABLE', reason: 'run records could not be read', runs: [],
      current: { state: 'UNAVAILABLE', runId: null, evidenceState: 'UNAVAILABLE',
        reason: '1 run record(s) could not be read or validated, so current run status is unavailable.' } },
  }));
  const section = journalSection(page);
  assert.strictEqual(section.attrs['data-build-journal'], 'UNAVAILABLE');
  assert.match(section.textContent,
    /Build journal UNAVAILABLE — 1 run record\(s\) could not be read or validated/,
    'the unreadable ledger lost its exact recorded reason');
  assert.match(section.textContent, /would not be evidence that nothing was built/);
  assert.strictEqual(journalList(section, 'recent'), null,
    'an unreadable ledger still rendered a 24-hour list, which would read as an empty week');
  // The journal is additive: the deck's existing cards and the run history the
  // page already shipped are untouched by it.
  assert.ok(findByAttr(page.document.getElementById('founder-body'), 'data-operator-field').length > 0,
    'the journal displaced the existing Command View cards');
  assert.match(page.text('runs-list'), /Run history UNAVAILABLE/i);

  // An affirmatively empty ledger is a different fact and says so.
  const empty = journalSection(bootPage(journalFixture([])));
  assert.strictEqual(empty.attrs['data-build-journal'], 'OK');
  assert.match(empty.textContent,
    /No recorded build update falls inside the 24 hours before the snapshot time/);
  assert.strictEqual(journalRows(empty, 'recent').length, 0);
});

test('the build journal reads recorded evidence only: no clock, no request, no second state source', () => {
  const journal = code.slice(code.indexOf('var JOURNAL_WINDOW_MS'),
    code.indexOf('function renderFounderSummary'));
  assert.ok(journal.length > 0, 'the build journal source boundary was not found');
  for (const banned of ['setInterval', 'setTimeout', 'requestAnimationFrame', 'Date.now', 'new Date',
    'Math.random', 'fetch(', 'innerHTML', 'AEGIS_STATE', 'document.querySelector']) {
    assert.ok(!journal.includes(banned),
      `the build journal uses ${banned} — it may only read the run projection the deck was handed`);
  }
  // The 24-hour window is a named constant read from the snapshot time, and the
  // outcome, check and checkpoint sentences are the page's existing ones.
  assert.ok(/var JOURNAL_WINDOW_MS = 24 \* 60 \* 60 \* 1000;/.test(journal),
    'the window is not one declared 24-hour constant');
  assert.ok(/win\.asOfMs - ms <= JOURNAL_WINDOW_MS/.test(journal),
    'recency is decided by something other than the recorded snapshot time');
  for (const helper of ['founderFinished(latest, false)', 'evidenceChecksPanel(entry.record)',
    'checkpointEvidence(entry.record)', 'evidenceOnScreen()']) {
    assert.ok(journal.includes(helper),
      `the journal does not reuse ${helper} — a second vocabulary for the same evidence`);
  }
  assert.strictEqual((code.match(/renderBuildJournal\(/g) || []).length, 2,
    'the journal is painted from more than one place, or never painted at all');
  assert.ok(/renderBuildJournal\(host, journalReading\(view, emptyRunsAvailable\)\)/.test(code),
    'the journal is not handed the deck\'s own view and empty-ledger judgement');
});

// ── the 24-hour improvement journal: type, milestone, available now ────────
// Three founder facts were added to each entry, and each of them is a separate
// way for this page to start lying. The proofs below hold the one rule they all
// rest on: a fact is stated only from the canonical source named for it, and is
// labelled unclassified or unverified in every other case.
//
//   · change type   — read ONLY from the wording of the recorded objective, by
//                     whole-word match against a fixed published lexicon. No
//                     match, two matches, no objective or records that disagree
//                     all mean unclassified. There is no ranking and no nearest
//                     category, because a ranking is how a guess becomes a fact;
//   · milestone     — set ONLY by a VALIDATED checkpoint receipt or by a ledger
//                     receipt recorded PASS whose packet id matches AND whose
//                     recorded time falls inside that run record's own window;
//   · available now — stated ONLY from a validated checkpoint, and even then it
//                     says the record holds no release evidence.
const JOURNAL_PACKET = 'PKT-20260826-ASYNC-WORKER-OPERATOR-BETA';
const JOURNAL_ROLLBACK = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';

function journalDatedRun(over) {
  return journalRun(Object.assign({
    createdAt: '2026-09-03T09:00:00.000Z',
    updatedAt: '2026-09-03T11:00:00.000Z',
    packetId: JOURNAL_PACKET,
  }, over || {}));
}

function journalCheckpointRun(over) {
  return journalDatedRun(Object.assign({
    state: 'CHECKPOINTED', checkpoint: 'CKPT-20260903-01',
    rollbackPoint: JOURNAL_ROLLBACK, checkpointState: 'VALIDATED',
  }, over || {}));
}

function journalReceipt(over) {
  return Object.assign({
    entryId: 'E-JOURNAL-1', ts: '2026-09-03T10:00:00.000Z',
    gate: 'aegis-check-receipt', status: 'PASS', packetId: JOURNAL_PACKET,
  }, over || {});
}

function journalOneRow(runs, events) {
  const section = journalSection(bootPage(journalFixture(runs,
    events === undefined ? undefined : { events: { state: 'OK', events } })));
  const rows = journalRows(section, 'recent');
  assert.strictEqual(rows.length, 1, 'the fixture did not render exactly one recent journal entry');
  return rows[0];
}

function journalLine(row, name) {
  const found = findByAttr(row, 'data-journal-line')
    .find((node) => node.attrs['data-journal-line'] === name);
  assert.ok(found, `the journal entry states no ${name} line at all`);
  return found.textContent;
}

test('DOM: the change type is a whole-word reading of the recorded request, and nothing else', () => {
  const cases = [
    ['Restructure the evidence rail', 'structure', 'Structure', /"restructure"/],
    ['Speed up the founder deck', 'speed', 'Speed', /"speed"/],
    ['Repair the broken receipt binding', 'error-repair', 'Error repair', /"repair", "broken"/],
    ['Optimise the ledger read path', 'optimization', 'Optimization', /"optimise"/],
    ['Add a harness for the governed worker', 'tooling', 'Tooling', /"harness"/],
    ['Tighten the spacing on the deck', 'visual', 'Visual', /"spacing"/],
    // The published list carries the ordinary forms of its own terms, so the
    // wording a recorded objective actually uses is read rather than missed.
    ['Optimizing the ledger read path', 'optimization', 'Optimization', /"optimizing"/],
    ['Restore the deck colours', 'visual', 'Visual', /"colours"/],
    // Carrying the same recorded evidence in less space is the optimization
    // request the list already publishes, so the forms recorded objectives
    // actually write are read rather than missed.
    ['Compact the build journal evidence', 'optimization', 'Optimization', /"compact"/],
    ['Compacted the recorded run rail', 'optimization', 'Optimization', /"compacted"/],
    ['Compacting the build journal', 'optimization', 'Optimization', /"compacting"/],
    ['Compaction of the recorded run journal', 'optimization', 'Optimization', /"compaction"/],
    // Clarity is read the same way as every other type: from the words the
    // recorded objective actually uses, and the matched words are printed.
    ['Rewrite the run receipt in plain English', 'clarity', 'Clarity', /"english"/],
    ['Make the gate wording readable', 'clarity', 'Clarity', /"readable", "wording"/],
    ['Translate the concise ledger summary', 'clarity', 'Clarity', /"translate", "concise"/],
  ];
  for (const [objective, id, label, matched] of cases) {
    const row = journalOneRow([journalDatedRun({ objective })]);
    assert.strictEqual(row.attrs['data-journal-category'], id,
      `"${objective}" was not categorised from its own recorded wording`);
    assert.match(journalLine(row, 'category'),
      new RegExp(`Change type as requested: ${label} — the recorded objective uses`),
      `"${objective}" does not name the category in words beside its evidence`);
    assert.match(journalLine(row, 'category'), matched,
      `"${objective}" does not print the exact recorded term it was categorised from`);
  }

  // Everything the recorded wording does not prove is unclassified, and each
  // refusal says which refusal it is.
  const unmatched = journalOneRow([journalDatedRun({ objective: 'Record the founder objective' })]);
  assert.strictEqual(unmatched.attrs['data-journal-category'], 'unclassified');
  assert.match(journalLine(unmatched, 'category'), /matches no term in the published list/);

  const ambiguous = journalOneRow([journalDatedRun({ objective: 'Fix the layout' })]);
  assert.strictEqual(ambiguous.attrs['data-journal-category'], 'unclassified',
    'wording that matches two categories was resolved into one of them');
  assert.match(journalLine(ambiguous, 'category'),
    /matches more than one type \(error repair, visual\)/);

  // A substring is not a word: "prefixed" is not a fix and must not read as one.
  const substring = journalOneRow([journalDatedRun({ objective: 'Prefixed identifiers stay stable' })]);
  assert.strictEqual(substring.attrs['data-journal-category'], 'unclassified',
    'a category was matched on a substring inside an unrelated word');

  // Publishing more word forms widens what the list KNOWS and never what it
  // infers: a form the list does not carry is still unknown wording, and wording
  // that reaches both an optimization and a visual term is still ambiguous.
  const unknownForm = journalOneRow([journalDatedRun({ objective: 'Restyle the founder deck' })]);
  assert.strictEqual(unknownForm.attrs['data-journal-category'], 'unclassified',
    'a word form the published list does not carry was resolved to a category anyway');
  assert.match(journalLine(unknownForm, 'category'), /matches no term in the published list/);

  // Clarity buys no exemption from either refusal. A word the clarity list does
  // not publish is unknown wording, and wording that reaches clarity AND another
  // published type is still ambiguous and still refused.
  const unpublishedClarity = journalOneRow([journalDatedRun({ objective: 'Clarify the founder deck' })]);
  assert.strictEqual(unpublishedClarity.attrs['data-journal-category'], 'unclassified',
    'a clarity request was inferred from wording the published list does not carry');
  assert.match(journalLine(unpublishedClarity, 'category'), /matches no term in the published list/);

  const plainText = journalOneRow([journalDatedRun({ objective: 'Record the exit code as plain text' })]);
  assert.strictEqual(plainText.attrs['data-journal-category'], 'unclassified',
    '"plain text" was read as a request about readable wording');

  const clarityAmbiguous = journalOneRow([
    journalDatedRun({ objective: 'Translate the deck styling into plain English' })]);
  assert.strictEqual(clarityAmbiguous.attrs['data-journal-category'], 'unclassified',
    'wording matching a visual term and a clarity term was resolved into one of them');
  assert.match(journalLine(clarityAmbiguous, 'category'),
    /matches more than one type \(visual, clarity\)/);

  const twoTypes = journalOneRow([journalDatedRun({ objective: 'Optimise the deck styling' })]);
  assert.strictEqual(twoTypes.attrs['data-journal-category'], 'unclassified',
    'wording matching an optimization term and a visual term was resolved into one of them');
  assert.match(journalLine(twoTypes, 'category'),
    /matches more than one type \(optimization, visual\)/);

  // The compaction forms buy no exemption from either refusal either. A form the
  // list does not publish is still unknown wording, a substring inside an
  // unrelated word is still not a word, and wording that also reaches a visual
  // term is still ambiguous and still refused.
  const unpublishedCompact = journalOneRow([journalDatedRun({ objective: 'Improve deck compactness' })]);
  assert.strictEqual(unpublishedCompact.attrs['data-journal-category'], 'unclassified',
    'a compaction word form the published list does not carry was resolved to a category anyway');
  assert.match(journalLine(unpublishedCompact, 'category'), /matches no term in the published list/);

  const compactSubstring = journalOneRow([journalDatedRun({ objective: 'Compactor rails stay recorded' })]);
  assert.strictEqual(compactSubstring.attrs['data-journal-category'], 'unclassified',
    '"compact" was matched as a substring inside an unrelated word');

  const compactAmbiguous = journalOneRow([journalDatedRun({ objective: 'Compact the deck layout' })]);
  assert.strictEqual(compactAmbiguous.attrs['data-journal-category'], 'unclassified',
    'wording matching a compaction term and a visual term was resolved into one of them');
  assert.match(journalLine(compactAmbiguous, 'category'),
    /matches more than one type \(optimization, visual\)/);

  const noObjective = journalOneRow([journalDatedRun({ objective: null })]);
  assert.strictEqual(noObjective.attrs['data-journal-category'], 'unclassified');
  assert.match(journalLine(noObjective, 'category'), /this record carries no objective/);
  assert.doesNotMatch(noObjective.textContent, /undefined|null|NaN/,
    'a missing objective reached the page as a machine value');

  // Records that disagree describe no single request, so they describe no type.
  const conflicted = journalOneRow([
    journalDatedRun({ objective: 'Fix the crash', state: 'BUILT' }),
    journalDatedRun({ objective: 'Fix the crash', state: 'BUILD_FAILED' }),
  ]);
  assert.strictEqual(conflicted.attrs['data-journal-category'], 'unclassified',
    'a category was read from records that do not agree about what was requested');
  assert.match(journalLine(conflicted, 'category'), /do not agree, so there is no one recorded request/);
});

test('DOM: a milestone is emphasised only from a validated checkpoint or a bound ledger receipt', () => {
  // 1. A validated checkpoint: the strongest evidence this record can carry.
  const checkpointed = journalOneRow([journalCheckpointRun({ objective: 'Restructure the evidence rail' })]);
  assert.strictEqual(checkpointed.attrs['data-journal-milestone'], 'RECORDED');
  assert.match(journalLine(checkpointed, 'milestone'),
    /MILESTONE — this entry is backed by a checkpoint receipt the canonical projector validated\./);
  const flag = findByAttr(checkpointed, 'data-journal-tag')
    .find((node) => node.attrs['data-journal-tag'] === 'milestone');
  assert.ok(flag, 'an emphasised milestone carries no MILESTONE word, only a colour');
  assert.strictEqual(flag.textContent, 'Milestone');
  assert.ok(flag.classList.contains('is-milestone'));
  // The exact receipt travels with it, verbatim.
  assert.match(checkpointed.textContent,
    new RegExp(`Milestone evidence — checkpoint receipt CKPT-20260903-01 · rollback commit ${JOURNAL_ROLLBACK} · recorded state VALIDATED\\.`),
    'the emphasised entry did not preserve its exact checkpoint receipt');

  // 2. A ledger receipt: PASS, same packet, recorded inside this run record's
  //    own created-to-updated window — and the packet-not-run caveat is printed.
  const bound = journalOneRow([journalDatedRun()], [journalReceipt()]);
  assert.strictEqual(bound.attrs['data-journal-milestone'], 'RECORDED');
  assert.match(journalLine(bound, 'milestone'),
    /backed by a ledger receipt recorded PASS inside this run record's own window/);
  assert.match(bound.textContent,
    new RegExp(`Milestone evidence — ledger receipt E-JOURNAL-1 · gate aegis-check-receipt · status PASS · recorded 2026-09-03T10:00:00\\.000Z · packet ${JOURNAL_PACKET}\\.`),
    'the bound receipt lost its exact recorded identifiers or timestamp');
  assert.match(bound.textContent, /bound to this entry by packet id and by falling inside this run record's own recorded window — it is not a run-id match/,
    'the entry hides that the ledger names packets rather than runs');

  // 3. Every way a receipt can fail to be evidence for THIS entry.
  const refusals = [
    [journalReceipt({ ts: '2026-09-03T08:00:00.000Z' }), 'a receipt recorded before this run record existed'],
    [journalReceipt({ ts: '2026-09-03T11:30:00.000Z' }), 'a receipt recorded after this run record was last written'],
    [journalReceipt({ status: 'BLOCKED' }), 'a receipt that records no PASS'],
    [journalReceipt({ packetId: 'PKT-SOMETHING-ELSE' }), 'a receipt for another packet'],
    [journalReceipt({ ts: 'yesterday-ish' }), 'a receipt with an unreadable time'],
  ];
  for (const [event, why] of refusals) {
    const row = journalOneRow([journalDatedRun()], [event]);
    assert.strictEqual(row.attrs['data-journal-milestone'], 'NONE', `${why} was accepted as a milestone`);
    assert.match(journalLine(row, 'milestone'),
      /no recorded PASS receipt names this run's packet inside the run record's own window/);
  }

  // The live status shape carries receipts with no packet id at all. That must
  // read as evidence that cannot be bound, never as a milestone.
  const unbindable = journalOneRow([journalDatedRun()],
    [{ entryId: 'E9', ts: '2026-09-03T10:00:00.000Z', gate: 'aegis-run', status: 'PASS' }]);
  assert.strictEqual(unbindable.attrs['data-journal-milestone'], 'NONE');
  assert.match(journalLine(unbindable, 'milestone'),
    /the recorded receipts on this page carry no packet id, so none of them can be bound to this run/);

  // A run record with no window of its own cannot contain a receipt.
  const undatedRun = journalOneRow([journalDatedRun({ createdAt: null })], [journalReceipt()]);
  assert.strictEqual(undatedRun.attrs['data-journal-milestone'], 'NONE');
  assert.match(journalLine(undatedRun, 'milestone'),
    /carries no readable created-to-updated window/);

  // A checkpoint that did not validate is worse than none, and is never emphasis.
  const invalid = journalOneRow([journalCheckpointRun({ checkpointState: 'INVALID' })]);
  assert.strictEqual(invalid.attrs['data-journal-milestone'], 'NONE');
  assert.match(journalLine(invalid, 'milestone'), /a checkpoint receipt exists for this run and did not validate/);

  // A rolled-back run keeps its checkpoint receipt and loses its emphasis.
  const rolledBack = journalOneRow([journalCheckpointRun({ state: 'ROLLED_BACK' })]);
  assert.strictEqual(rolledBack.attrs['data-journal-milestone'], 'NONE',
    'a run the record ends at ROLLED_BACK was still highlighted as a milestone');
  assert.match(journalLine(rolledBack, 'milestone'), /the record ends this run at ROLLED_BACK/);

  // Records that disagree are never a milestone, whatever is attached to them.
  const conflicted = journalOneRow([
    journalCheckpointRun({ state: 'CHECKPOINTED' }),
    journalCheckpointRun({ state: 'BUILD_FAILED' }),
  ]);
  assert.strictEqual(conflicted.attrs['data-journal-milestone'], 'NONE');
  assert.match(journalLine(conflicted, 'milestone'), /do not agree, so nothing here is established/);
});

test('DOM: "available now" is stated only from a validated checkpoint and never claims a release', () => {
  const available = journalOneRow([journalCheckpointRun()]);
  assert.strictEqual(available.attrs['data-journal-availability'], 'IN_THE_RECORD');
  assert.match(journalLine(available, 'availability'),
    new RegExp(`Available now: IN THE RECORD — checkpoint CKPT-20260903-01 validated and names rollback commit ${JOURNAL_ROLLBACK}`),
    'the availability sentence does not name the exact evidence it rests on');
  assert.match(journalLine(available, 'availability'),
    /No release or publication receipt exists here, so it does not prove anyone else can use it yet\./,
    'a validated checkpoint was allowed to read as a delivery');
  assert.doesNotMatch(available.textContent,
    /\bis available\b|\bnow available\b|\bavailable to use\b|\bshipped\b|\bdeployed\b|\bin production\b/i,
    'the strongest recorded evidence was still promoted into a delivery claim');

  const rolledBack = journalOneRow([journalCheckpointRun({ state: 'ROLLED_BACK' })]);
  assert.strictEqual(rolledBack.attrs['data-journal-availability'], 'WITHDRAWN');
  assert.match(journalLine(rolledBack, 'availability'), /Available now: NO — the record ends this run at ROLLED_BACK\./);

  const unverified = journalOneRow([journalDatedRun({ state: 'CHECKS_PASSED' })]);
  assert.strictEqual(unverified.attrs['data-journal-availability'], 'UNVERIFIED');
  assert.match(journalLine(unverified, 'availability'),
    /Available now: UNVERIFIED — no validated checkpoint is recorded for this run and no release receipt exists/);

  // The three facts are independent readings: a milestone does not grant
  // availability, and availability is not granted by a passing build.
  const receiptOnly = journalOneRow([journalDatedRun()], [journalReceipt()]);
  assert.strictEqual(receiptOnly.attrs['data-journal-milestone'], 'RECORDED');
  assert.strictEqual(receiptOnly.attrs['data-journal-availability'], 'UNVERIFIED',
    'a bound ledger receipt was promoted into proof that the change is available');
});

test('DOM: every journal entry preserves its exact raw evidence and timestamps behind the disclosure', () => {
  const row = journalOneRow([journalCheckpointRun({ objective: 'Restructure the evidence rail' })],
    [journalReceipt()]);
  const detail = (row.children || []).find((node) => node.tagName === 'DETAILS');
  assert.ok(detail, 'the entry keeps no evidence disclosure at all');
  assert.strictEqual(detail.firstElementChild.tagName, 'SUMMARY',
    'the exact evidence is not behind a native keyboard-operable disclosure');
  const evidence = detail.textContent;
  assert.match(evidence, /Exact recorded timestamps: created 2026-09-03T09:00:00\.000Z · updated 2026-09-03T11:00:00\.000Z/,
    'the entry rewrote or dropped the run record\'s own recorded timestamps');
  assert.match(evidence, new RegExp(`Packet id on this run record: ${JOURNAL_PACKET}`));
  assert.match(evidence, /Change type: Structure — the recorded objective uses "restructure"\. Terms matched in the recorded objective: restructure\./,
    'the exact matched category terms are not preserved beside the plain-English type');
  assert.match(evidence, /Release or publication receipt: NONE/,
    'the absence of release evidence is not recorded on the entry');
  assert.match(evidence, /Run id: RUN-20260903-aaaaaaaa/);
  assert.match(evidence, /How to read this entry: the change type is read only from the wording/,
    'the entry no longer says which of its facts are read from what');

  // A record with nothing recorded prints absence, never a machine value.
  const bare = journalOneRow([journalRun({ createdAt: null, packetId: null, updatedAt: '2026-09-03T11:00:00.000Z' })]);
  assert.match(bare.textContent, /Exact recorded timestamps: created UNAVAILABLE · updated 2026-09-03T11:00:00\.000Z/);
  assert.match(bare.textContent, /Packet id on this run record: UNAVAILABLE/);
  assert.doesNotMatch(bare.textContent, /undefined|null|NaN|Invalid Date/,
    'a missing evidence field reached the page as a machine value');
});

// ── the open card is a founder update, and the explanation is one keypress away ──
// Each 24-hour entry had grown to five stacked paragraphs: the requested change,
// then availability, then why that change type was chosen, then why the entry is
// or is not a milestone. Every one of those sentences is true and none of them
// may be deleted — but an owner scanning the last day reads none of them, and a
// card nobody reads is a record nobody checks. So the card keeps what changed,
// its type, what the record proves finished and the evidence-backed milestone
// flag, and the explanations MOVE into the disclosure the entry already carried.
//
// The failure guarded here is the cheap way to shorten a card: a sentence that
// was softened, summarised, dropped, or left behind on the card AND copied into
// the disclosure, so one recorded fact starts reading as two.
function journalOpenCard(row) {
  return (row.children || []).filter((node) => node.tagName !== 'DETAILS')
    .map((node) => node.textContent).join(' ');
}

function journalEntryDisclosure(row) {
  const found = (row.children || []).filter((node) => node.tagName === 'DETAILS');
  assert.strictEqual(found.length, 1, 'the entry does not carry exactly one evidence disclosure');
  return found[0];
}

function journalTimes(haystack, needle) {
  return haystack.split(needle).length - 1;
}

test('DOM: an open 24-hour card states what changed, its type, its recorded outcome and any proven milestone', () => {
  const row = journalOneRow([journalCheckpointRun({ objective: 'Restructure the evidence rail' })], []);
  const open = journalOpenCard(row);
  assert.match(open, /Recorded 2026-09-03T11:00:00\.000Z\./,
    'the card no longer says when the change was recorded');
  assert.match(open, /Requested change: Restructure the evidence rail/,
    'the card no longer says what changed');
  assert.match(open, /Change type: Structure/,
    'the card no longer states the category the recorded request resolved to');
  assert.match(open, /What the record proves finished: This run finished and reached its recorded safe checkpoint\./,
    'the card no longer states the recorded outcome');

  // The milestone signal stays open, because it is the one fact an owner is
  // scanning for — and it is drawn only where evidence is bound to this entry.
  const flag = findByAttr(row, 'data-journal-tag')
    .find((node) => node.attrs['data-journal-tag'] === 'milestone');
  assert.ok(flag, 'a proven milestone carries no open signal at all');
  assert.strictEqual(findByAttr(journalEntryDisclosure(row), 'data-journal-tag')
    .filter((node) => node === flag).length, 0,
    'the proven milestone signal was demoted into the disclosure');

  // Nothing else is: no provenance paragraph, no exact machine state, no
  // explanation of how a fact was resolved.
  for (const paragraph of [/Available now/, /Change type as requested/, /MILESTONE — this entry is backed by/,
    /Not a milestone in the record/, /Release or publication receipt/, /Exact recorded timestamps/,
    /Packet id on this run record/, /Records filed under this exact run id/, /What the checks recorded/,
    /How to read this entry/]) {
    assert.doesNotMatch(open, paragraph, `${paragraph} is still a paragraph on the open 24-hour card`);
  }
  // The disclosure says it holds the explanation, not only the receipts, or an
  // owner has no reason to open the one place the explanation now lives.
  assert.match(journalEntryDisclosure(row).firstElementChild.textContent,
    /Full explanation and exact receipts for this entry/,
    'the disclosure does not say that it holds the full explanation');

  // An entry with no bound evidence carries no milestone signal on the card at
  // all — the flag is emphasis for proof, never decoration for an entry.
  const plain = journalOneRow([journalDatedRun({ state: 'BUILT', objective: 'Restructure the evidence rail' })], []);
  assert.strictEqual(findByAttr(plain, 'data-journal-tag')
    .filter((node) => node.attrs['data-journal-tag'] === 'milestone').length, 0,
    'an entry with no bound checkpoint or receipt was still flagged as a milestone');
  assert.match(journalOpenCard(plain),
    /What the record proves finished: The build finished\. Its automated checks have not run yet\./,
    'a card with no milestone lost its recorded outcome too');
});

test('DOM: every journal sentence the card no longer prints survives exactly once behind its disclosure', () => {
  const proven = journalOneRow([journalCheckpointRun({ objective: 'Restructure the evidence rail' })],
    [journalReceipt()]);
  const provenDetail = journalEntryDisclosure(proven);
  const movedWhenProven = [
    `Available now: IN THE RECORD — checkpoint CKPT-20260903-01 validated and names rollback commit ${JOURNAL_ROLLBACK}`,
    'Change type as requested: Structure — the recorded objective uses "restructure".',
    'MILESTONE — this entry is backed by a checkpoint receipt the canonical projector validated and ' +
      'a ledger receipt recorded PASS inside this run record\'s own window.',
    'Milestone evidence — checkpoint receipt CKPT-20260903-01',
    'Milestone evidence — ledger receipt E-JOURNAL-1',
    'Release or publication receipt: NONE',
    'Exact recorded timestamps: created 2026-09-03T09:00:00.000Z · updated 2026-09-03T11:00:00.000Z',
    `Packet id on this run record: ${JOURNAL_PACKET}`,
    'Change type: Structure — the recorded objective uses "restructure". Terms matched in the recorded ' +
      'objective: restructure.',
    'How to read this entry:',
  ];
  for (const sentence of movedWhenProven) {
    assert.strictEqual(journalTimes(proven.textContent, sentence), 1,
      `"${sentence}" was dropped from the entry, or is now printed twice`);
    assert.strictEqual(journalTimes(provenDetail.textContent, sentence), 1,
      `"${sentence}" is not inside the entry's own evidence disclosure`);
  }

  // The refusals are the sentences most worth losing and least worth losing:
  // an entry that proves nothing must still say so, once, where it can be read.
  // The objective here is named rather than defaulted: the shared fixture's own
  // wording is a published optimization request, and this block is proving the
  // UNCLASSIFIED refusal still prints once in both places.
  const unproven = journalOneRow([journalDatedRun({ state: 'BUILT',
    objective: 'Record the founder objective' })], []);
  const unprovenDetail = journalEntryDisclosure(unproven);
  for (const sentence of [
    'Available now: UNVERIFIED — no validated checkpoint is recorded for this run',
    'Not a milestone in the record: no validated checkpoint is recorded for this run',
    'the recorded receipts on this page carry no packet id, so none of them can be bound to this run',
    'Release or publication receipt: NONE',
    'Change type as requested: Unclassified — the recorded wording matches no term in the published list',
  ]) {
    assert.strictEqual(journalTimes(unproven.textContent, sentence), 1,
      `"${sentence}" was dropped from the entry, or is now printed twice`);
    assert.strictEqual(journalTimes(unprovenDetail.textContent, sentence), 1,
      `"${sentence}" is not inside the entry's own evidence disclosure`);
  }

  // A disclosed 24-hour entry is the same entry: compacting the rail and
  // compacting the card cannot combine into a card with less in it.
  const busy = journalSection(bootPage(journalFixture(journalBusyDay(6))));
  const disclosed = journalRows(busy, 'recent-more')[0];
  assert.match(journalOpenCard(disclosed), /Requested change: Recorded update 3/,
    'an entry behind the 24-hour disclosure lost its open founder update');
  assert.match(journalEntryDisclosure(disclosed).textContent, /Available now: UNVERIFIED/,
    'an entry behind the 24-hour disclosure lost the explanation the visible cards keep');
});

test('the journal card and its disclosure are one row builder: the sentences moved, and none was re-typed', () => {
  const journal = code.slice(code.indexOf('var JOURNAL_WINDOW_MS'),
    code.indexOf('function renderFounderSummary'));
  assert.ok(journal.length > 0, 'the build journal source boundary was not found');
  for (const name of ['availability', 'category', 'milestone']) {
    assert.strictEqual((journal.match(new RegExp(`detail\\.appendChild\\(${name}\\)`, 'g')) || []).length, 1,
      `the ${name} explanation is not appended to the entry's one disclosure`);
    assert.ok(!new RegExp(`li\\.appendChild\\(${name}\\)`).test(journal),
      `the ${name} explanation is drawn open on the card as well, so one fact reads as two`);
  }
  // Each moved sentence is still rendered from the ONE resolver that owned it,
  // so a compact card cannot carry a second, shorter version of the truth.
  assert.strictEqual((journal.match(/entry\.availability\.text/g) || []).length, 1,
    'the availability sentence is rendered from more than one place');
  assert.strictEqual((journal.match(/entry\.milestone\.text/g) || []).length, 1,
    'the milestone sentence is rendered from more than one place');
  assert.strictEqual((journal.match(/entry\.category\.why/g) || []).length, 2,
    'the change-type reason is rendered somewhere other than the moved line and its exact-evidence fact');
  assert.strictEqual((journal.match(/function journalRow\(/g) || []).length, 1,
    'a second row builder exists, so an open card could tell a different story from a disclosed one');
  // No new disclosure, control or window was invented to hold the moved text.
  assert.strictEqual((journal.match(/el\('details'/g) || []).length, 2,
    'the moved explanations were put behind a new disclosure instead of the entry\'s existing one');
  assert.strictEqual((journal.match(/data-journal-line/g) || []).length, 3,
    'the journal renders more or fewer than the three moved explanation lines');
});

test('the moved journal explanations keep the wrapping and emphasis that make them readable at 390px', () => {
  const row = journalOneRow([journalCheckpointRun()], []);
  const detail = journalEntryDisclosure(row);
  const lines = findByAttr(row, 'data-journal-line');
  assert.deepStrictEqual(lines.map((node) => node.attrs['data-journal-line']),
    ['availability', 'category', 'milestone'],
    'the entry no longer carries exactly the three moved explanations, in their recorded order');
  const inside = findByAttr(detail, 'data-journal-line');
  for (const line of lines) {
    assert.ok(inside.includes(line), 'a moved explanation is rendered outside the disclosure that holds it');
    assert.ok(String(line.className).split(/\s+/).includes('journal-line'),
      'a moved explanation lost the class the phone wrapping rule is written against');
  }
  assert.ok(lines[2].classList.contains('is-milestone'),
    'the milestone sentence lost its own emphasis when it moved into the disclosure');
  // The phone contract is untouched: the moved sentences still wrap, both
  // disclosures are still finger-sized, and the reading order is the shipped one.
  assert.ok(/\.journal-empty,\.journal-line,\.journal-tag\{overflow-wrap:anywhere\}/.test(PHONE),
    'the moved journal sentences no longer wrap at phone width');
  assert.ok(/\.journal-detail>summary,\.journal-more>summary\{min-height:44px;display:flex;align-items:center\}/.test(PHONE),
    'the disclosure now holding every explanation is not finger-sized at phone width');
  assert.ok(/\.journal-head,\.journal-entry-head\{flex-direction:column;align-items:flex-start;gap:4px\}/.test(PHONE),
    'the compacted card head no longer stacks at phone width');
  assert.ok(/\.event-panel\{order:1\}#evidence-rail\{order:2\}#raw-state\{order:3\}/.test(PHONE),
    'the phone reading order changed while the 24-hour card was compacted');
});

test('the milestone emphasis is a shape and a word before it is a colour, and it never animates', () => {
  const start = code.indexOf('.journal-badges{');
  const end = code.indexOf('\n\n', start);
  assert.ok(start !== -1 && end > start, 'the journal emphasis CSS block was not found');
  const css = code.slice(start, end);
  assert.ok(/\.journal-entry\[data-journal-milestone="RECORDED"\]\{[^}]*border-left:3px solid var\(--cyan\)/.test(css),
    'an emphasised milestone is distinguished by colour alone, with no border of its own');
  assert.ok(/\.journal-tag\.is-milestone\{/.test(css), 'the MILESTONE flag has no treatment of its own');
  assert.ok(!/@keyframes/.test(css) && !/\banimation\s*:/.test(css) && !/\btransition\s*:/.test(css),
    'the journal emphasis animates — an entry may not move to look important');
  for (const banned of [/-webkit-line-clamp/, /text-overflow/, /overflow\s*:\s*hidden/,
    /white-space\s*:\s*nowrap/, /max-height/]) {
    assert.ok(!banned.test(css), `the journal emphasis uses ${banned} to hide recorded text`);
  }
  // Phone width: the three badges wrap under the recorded time and every added
  // sentence wraps rather than dragging a 390px viewport sideways.
  assert.ok(/\.journal-empty,\.journal-line,\.journal-tag\{overflow-wrap:anywhere\}/.test(PHONE),
    'the added journal sentences and tags do not wrap at phone width');
  assert.ok(/\.journal-badges\{width:100%\}/.test(PHONE),
    'the state chip, change type and milestone flag compete for one phone line');
});

// ── the change type is easier to scan, and no easier to misread ────────────
// A day of build updates is read down a column, and seven identically grey
// cards make an owner read seven headings to find the one type they came for.
// So each RESOLVED type carries one accent in two places — the card's left rail
// and the border of the tag that already prints the type in words.
//
// The failures guarded here are exactly the ones an accent invites: a colour
// that starts carrying the meaning the label carried; an accent that reaches the
// recorded state chip or the milestone emphasis and lets a change type look like
// a lifecycle fact; a new colour, category or id invented to be accented; two
// types sharing one accent, which groups nothing; and the "unclassified" refusal
// quietly given a look of its own so a proven reading and a refused one stop
// being told apart.
const JOURNAL_ACCENTS = [
  ['structure', '--blocked'], ['speed', '--active'], ['error-repair', '--fail'],
  ['optimization', '--pass'], ['tooling', '--warn'], ['visual', '--orange'],
  ['clarity', '--unknown'],
];

const JOURNAL_ACCENT_LABELS = {
  structure: ['Restructure the evidence rail', 'Structure'],
  speed: ['Speed up the founder deck', 'Speed'],
  'error-repair': ['Repair the broken receipt binding', 'Error repair'],
  optimization: ['Optimise the ledger read path', 'Optimization'],
  tooling: ['Add a harness for the governed worker', 'Tooling'],
  visual: ['Tighten the spacing on the deck', 'Visual'],
  clarity: ['Make the gate wording readable', 'Clarity'],
};

function journalEmphasisCss() {
  const start = code.indexOf('.journal-badges{');
  const end = code.indexOf('\n\n', start);
  assert.ok(start !== -1 && end > start, 'the journal emphasis CSS block was not found');
  return code.slice(start, end);
}

function journalCategoryTag(row) {
  const found = findByAttr(row, 'data-journal-tag')
    .find((node) => node.attrs['data-journal-tag'] === 'category');
  assert.ok(found, 'the entry carries no change-type tag at all');
  return found;
}

test('each resolved change type carries one distinct accent, declared only as a rail and a tag border', () => {
  const css = journalEmphasisCss();
  const tokens = new Set();
  for (const [id, token] of JOURNAL_ACCENTS) {
    // Each assertion matches the WHOLE declaration block, so a rule that also
    // filled, recoloured, clamped or animated the card would not match at all.
    assert.ok(new RegExp(`\\.journal-entry\\[data-journal-category="${id}"\\]\\{border-left:3px solid var\\(${token}\\)\\}`)
      .test(css), `the ${id} card carries no left rail of its own, or its rail declares more than a border`);
    assert.ok(new RegExp(`\\.journal-entry\\[data-journal-category="${id}"\\] \\[data-journal-tag="category"\\]\\{border-color:var\\(${token}\\)\\}`)
      .test(css), `the ${id} change-type tag carries no accent of its own, or it recolours the tag's text`);
    // Only tokens this stylesheet already declares: an accent may not introduce
    // a colour, and the tag's own text keeps the --text-1 it was measured at.
    assert.ok(new RegExp(`${token}:\\s*#`).test(code),
      `${token} is not an existing palette token, so the accent invented a colour`);
    tokens.add(token);
  }
  assert.strictEqual(tokens.size, JOURNAL_ACCENTS.length,
    'two change types share one accent, so the accent groups nothing');
  assert.ok(!tokens.has('--cyan'),
    'a change type took the accent a proven milestone is emphasised with');

  // Exactly fourteen rules: one rail and one tag border per resolved type, and
  // nothing else keyed to a change type anywhere in this block.
  const accentRules = css.split('\n').filter((line) => line.includes('[data-journal-category='));
  assert.strictEqual(accentRules.length, JOURNAL_ACCENTS.length * 2,
    'the change-type accent is drawn by more or fewer rules than one rail and one tag border per type');
  for (const rule of accentRules) {
    assert.ok(!/\.chip|is-milestone|data-journal-tag="milestone"|data-journal-state|data-journal-milestone/.test(rule),
      `a change-type accent reaches the recorded state or milestone signal: ${rule.trim()}`);
  }
  assert.ok(!/@keyframes/.test(css) && !/\banimation\s*:/.test(css) && !/\btransition\s*:/.test(css),
    'the change-type accent animates — a card may not move to look like a category');

  // The proven milestone still wins the rail it earned: the two rules carry the
  // same specificity, so the milestone rule must stay written after these.
  const lastAccent = css.lastIndexOf('[data-journal-category=');
  const milestone = css.indexOf('.journal-entry[data-journal-milestone="RECORDED"]');
  assert.ok(milestone !== -1 && lastAccent !== -1 && milestone > lastAccent,
    'the change-type accent is written after the milestone rule, so it steals the rail a proven entry earned');
  assert.ok(/\.journal-entry\[data-journal-milestone="RECORDED"\]\{[^}]*border-left:3px solid var\(--cyan\)/.test(css),
    'the proven milestone lost the rail of its own when the change type gained one');

  // The accented ids are the published ones. Nothing was invented to be
  // accented, and the refusal is not a type and is given nothing.
  const lexicon = code.slice(code.indexOf('var JOURNAL_CATEGORIES = ['),
    code.indexOf('var JOURNAL_UNCLASSIFIED'));
  assert.strictEqual((lexicon.match(/\{ id: '/g) || []).length, JOURNAL_ACCENTS.length + 1,
    'the published category list no longer holds exactly the accented types plus the unclassified fallback');
  for (const [id] of JOURNAL_ACCENTS) {
    assert.ok(lexicon.includes(`{ id: '${id}'`), `${id} is accented but is not a published change type`);
  }
  assert.ok(!/data-journal-category="unclassified"/.test(code),
    'the unclassified refusal was given a look of its own instead of the neutral card it already had');

  // Phone width is untouched: the accented tag still wraps rather than dragging
  // a 390px viewport sideways, and the badges still get their own row.
  assert.ok(/\.journal-empty,\.journal-line,\.journal-tag\{overflow-wrap:anywhere\}/.test(PHONE),
    'the accented change-type tag no longer wraps at phone width');
  assert.ok(/\.journal-badges\{width:100%\}/.test(PHONE),
    'the accented change-type tag now competes with the state chip for one phone line');
});

test('DOM: an accented card still names its change type in words, and unclassified stays plain', () => {
  for (const [id, [objective, label]] of Object.entries(JOURNAL_ACCENT_LABELS)) {
    const row = journalOneRow([journalDatedRun({ objective })]);
    // The attribute the accent is keyed to is the resolver's own reading, so an
    // accent can never be painted onto an entry whose sentence disagrees.
    assert.strictEqual(row.attrs['data-journal-category'], id,
      `"${objective}" no longer resolves to the type its accent is keyed to`);
    const tag = journalCategoryTag(row);
    assert.strictEqual(tag.textContent, `Change type: ${label}`,
      `the ${id} accent replaced or abbreviated the written type instead of accompanying it`);
    assert.ok(String(tag.className).split(/\s+/).includes('journal-tag'),
      `the ${id} tag lost the class its wrapping and phone rules are written against`);
    assert.match(journalLine(row, 'category'),
      new RegExp(`Change type as requested: ${label} — the recorded objective uses`),
      `the ${id} entry lost the sentence its accent was read from`);
  }

  // A refusal is not a type: it carries the same written label and no accent.
  const unclassified = journalOneRow([journalDatedRun({ objective: 'Record the founder objective' })]);
  assert.strictEqual(unclassified.attrs['data-journal-category'], 'unclassified');
  assert.strictEqual(journalCategoryTag(unclassified).textContent, 'Change type: Unclassified',
    'the unclassified refusal stopped naming itself when the resolved types gained accents');

  // Type and milestone are two readings, and the accent took neither from the
  // other: a proven entry keeps its evidence-backed flag and its type.
  const proven = journalOneRow([journalCheckpointRun({ objective: 'Restructure the evidence rail' })]);
  assert.strictEqual(proven.attrs['data-journal-category'], 'structure');
  assert.strictEqual(proven.attrs['data-journal-milestone'], 'RECORDED');
  assert.strictEqual(journalCategoryTag(proven).textContent, 'Change type: Structure');
  assert.ok(findByAttr(proven, 'data-journal-tag')
    .some((node) => node.attrs['data-journal-tag'] === 'milestone'),
    'a proven milestone lost its flag when the change type gained an accent');
});

test('the three added journal facts are each resolved from one named canonical source', () => {
  const journal = code.slice(code.indexOf('var JOURNAL_WINDOW_MS'),
    code.indexOf('function renderFounderSummary'));
  assert.ok(journal.length > 0, 'the build journal source boundary was not found');
  // Change type: a fixed published lexicon, whole-word matched against the ONE
  // recorded objective. No scoring, no ranking, no nearest match.
  assert.ok(/var JOURNAL_CATEGORIES = \[/.test(journal), 'the category lexicon is not one declared list');
  const categories = require('vm').runInNewContext('(' + journal.slice(
    journal.indexOf('var JOURNAL_CATEGORIES = [') + 'var JOURNAL_CATEGORIES = '.length,
    journal.indexOf('];', journal.indexOf('var JOURNAL_CATEGORIES = [')) + 1) + ')');
  // Array.from rebuilds the ids in this realm: the literal is parsed in a separate
  // vm context, so an array it produced itself can never compare deep-strict-equal.
  assert.deepStrictEqual(Array.from(categories, (category) => category.id),
    ['structure', 'speed', 'error-repair', 'optimization', 'tooling', 'visual', 'clarity', 'unclassified'],
    'the published category list is not the seven canonical types plus unclassified');
  // Whole-word matching cannot compare a phrase, so the clarity type publishes
  // the recorded WORDS it reads and not the generic word "plain": a list that
  // claimed "plain" would read "plain text" as a request about wording.
  const clarity = categories.find((category) => category.id === 'clarity');
  assert.ok(clarity && !clarity.terms.includes('plain'),
    'the clarity type claims the generic word "plain", so unrelated wording can match it');
  for (const category of categories) {
    if (category.id === 'unclassified') {
      assert.ok(Array.isArray(category.terms) && !category.terms.length,
        'the unclassified fallback publishes terms, so recorded wording could match it instead of falling back to it');
      continue;
    }
    assert.ok(Array.isArray(category.terms) && category.terms.length,
      `category ${category.id} carries no published terms`);
    assert.ok(category.terms.every((term) => /^[a-z0-9]+$/.test(term)),
      `category ${category.id} carries a term that whole-word matching cannot compare`);
  }
  assert.ok(/var JOURNAL_UNCLASSIFIED = JOURNAL_CATEGORIES\[/.test(journal),
    'the unclassified label is declared a second time instead of read from the one published list');
  const seen = new Set();
  for (const category of categories) {
    for (const term of category.terms) {
      assert.ok(!seen.has(term), `"${term}" is claimed by two categories, so a match is not deterministic`);
      seen.add(term);
    }
  }
  assert.ok(/hits\.length > 1/.test(journal), 'two matching categories do not fall back to unclassified');
  // The three refusals are structural, not stylistic: no objective, no matched
  // term and two matched categories each return the unclassified label rather
  // than the nearest, first or most specific type.
  assert.strictEqual((journal.match(/label: JOURNAL_UNCLASSIFIED/g) || []).length, 4,
    'the category resolver has more or fewer unclassified exits than the four documented refusals');
  assert.ok(/words\.indexOf\(term\) !== -1/.test(journal),
    'category terms are matched as substrings rather than as whole recorded words');

  // Milestone: a VALIDATED checkpoint, or a PASS receipt bound by packet id AND
  // contained by the run record's own window. Nothing else may set it.
  assert.ok(/record\.checkpointState !== 'VALIDATED'/.test(journal),
    'a checkpoint that the canonical projector did not validate can set the milestone flag');
  assert.ok(/rollbackCommitRecorded\(record\)/.test(journal),
    'the milestone does not reuse the page\'s own rollback-commit predicate');
  assert.ok(/eventPacket !== packet \|\| event\.status !== 'PASS'/.test(journal),
    'a receipt for another packet, or one that records no PASS, can set the milestone flag');
  assert.ok(/at < openedAt \|\| at > wroteAt/.test(journal),
    'a receipt outside the run record\'s own recorded window can set the milestone flag');
  assert.ok(/state: 'RECORDED', evidence: evidence/.test(journal),
    'the milestone state is not tied to the evidence list it was resolved from');

  // Availability: a validated checkpoint and nothing else, and never a release.
  assert.ok(/JOURNAL_RELEASE_FACT/.test(journal), 'the absence of release evidence is not stated anywhere');
  assert.ok(!/RELEASED|PUBLISHED|LIVE_FOR_USERS/.test(journal),
    'the journal invented a release or publication state the canonical record does not carry');
  // Still no clock, no request, no second state source in any of the new code.
  for (const banned of ['setInterval', 'setTimeout', 'requestAnimationFrame', 'Date.now', 'new Date',
    'Math.random', 'fetch(', 'innerHTML', 'AEGIS_STATE', 'document.querySelector']) {
    assert.ok(!journal.includes(banned),
      `the build journal uses ${banned} — it may only read the projection the deck was handed`);
  }
  // The event plane is handed in from the same two seams every other instrument
  // is painted from; the journal never opens a source of its own.
  assert.ok(/var events = \(view && Array\.isArray\(view\.events\)\) \? view\.events : \[\]/.test(journal),
    'the journal does not read the recorded event plane it was handed');
  assert.strictEqual((code.match(/events: \(S\.events && S\.events\.state === 'OK' && Array\.isArray\(S\.events\.events\)\)/g) || []).length, 1,
    'the saved snapshot does not hand its recorded receipts to the deck exactly once');
  assert.strictEqual((code.match(/events: Array\.isArray\(status\.events\) \? status\.events : \[\]/g) || []).length, 1,
    'the live push does not hand its recorded receipts to the deck exactly once');
});

// ── CHANGES & RECEIPTS INSPECTOR ──────────────────────────────────────────
// One founder-readable inspector over ONE canonical run: what scope was
// requested, what change is recorded, which focused check receipt exists, what
// the evidence proves is available now, and what is still unverified.
//
// The failure these proofs guard against is not a crash. It is an inspector
// that fills a gap: attributing the page's gate-subject paths to a run nobody
// bound them to, reading an earlier run's silence as "nothing changed", or
// showing a compact summary that quietly drops the receipt it rests on. So each
// proof asks the same two questions of every answer — is the recorded fact
// printed exactly, and is the ABSENT fact named as absent rather than inferred.
const CR_SUBJECT = 'a'.repeat(64);
const CR_OTHER_SUBJECT = 'b'.repeat(64);
const CR_PACKET = 'PKT-20260826-ASYNC-WORKER-OPERATOR-BETA';
const CR_CURRENT_ID = 'RUN-20260904-1111aaaa';
const CR_EARLIER_ID = 'RUN-20260903-2222bbbb';
const CR_PATHS = ['builder-control/dashboard/index.html', 'builder-control/test/dashboard-slice.test.cjs'];

function crRun(over) {
  return Object.assign({
    runId: CR_CURRENT_ID, state: 'CHECKPOINTED',
    objective: 'Give the founder one place to read changes and receipts',
    packetId: CR_PACKET,
    createdAt: '2026-09-04T12:00:00.000Z', updatedAt: '2026-09-04T12:30:00.000Z',
    subjectSha256: CR_SUBJECT,
    checks: { passed: 6, total: 6, outcome: 'PASS', snapshotOutcome: 'PASS',
      hostContainmentState: 'PASSED' },
    checkpoint: 'CHK-20260904-1', checkpointState: 'VALIDATED', rollbackPoint: 'f'.repeat(40),
  }, over || {});
}

function crEngineering(over) {
  return Object.assign({
    state: 'OK', verdict: 'READY_FOR_PR', lane: 'FULL', highRisk: false,
    laneWhy: [], riskReasons: [],
    subjectSha256: CR_SUBJECT, subjectPaths: CR_PATHS.slice(), excludedAsEvidence: [],
    problems: [], observed: [], unverified: ['codex: runtime behaviour was not exercised'],
    reviewerCompleteness: { complete: true, rows: [], subjectSha256: CR_SUBJECT },
    stages: [], source: 'builder-control/engineering-os.cjs',
  }, over || {});
}

function crBinding(over) {
  return Object.assign({
    state: 'BOUND', runId: CR_CURRENT_ID, evidenceState: 'OK', subjectState: 'BOUND',
    subjectSha256: CR_SUBJECT, runSubjectSha256: CR_SUBJECT, gateSubjectSha256: CR_SUBJECT,
    updatedAt: '2026-09-04T12:30:00.000Z', reason: 'the exact current run is bound',
  }, over || {});
}

// Oldest first, exactly as the canonical projector orders runs.
function crFixture(over) {
  const options = over || {};
  const runs = options.runs || [
    crRun({ runId: CR_EARLIER_ID, state: 'BUILT', objective: 'Record an earlier governed build',
      createdAt: '2026-09-03T09:00:00.000Z', updatedAt: '2026-09-03T09:40:00.000Z',
      subjectSha256: CR_OTHER_SUBJECT, checks: null,
      checkpoint: null, checkpointState: null, rollbackPoint: null }),
    crRun(),
  ];
  return fixtureState({
    generatedAt: '2026-09-04T13:00:00.000Z',
    engineering: options.engineering || crEngineering(),
    events: { state: 'OK', events: options.events || [] },
    runs: { state: 'OK', runs, current: options.binding || crBinding() },
  });
}

function crRunButtons(page) {
  return findByAttr(page.document.getElementById('cr-picker-runs'), 'data-cr-run');
}

function crRunButton(page, runId) {
  const button = crRunButtons(page).find((node) => node.attrs['data-cr-run'] === runId);
  assert.ok(button, `the run picker offers no control for ${runId}`);
  return button;
}

function crAnswers(page) {
  return findByAttr(page.document.getElementById('cr-answers'), 'data-cr-answer');
}

function crAnswer(page, id) {
  const node = crAnswers(page).find((answer) => answer.attrs['data-cr-answer'] === id);
  assert.ok(node, `the inspector rendered no "${id}" answer`);
  return node;
}

function crValue(page, id) {
  const value = allNodes(crAnswer(page, id)).find((node) => String(node.className) === 'cr-value');
  assert.ok(value, `the "${id}" answer rendered no founder-readable value`);
  return value.textContent;
}

function crDisclosure(page, id) {
  const exact = allNodes(crAnswer(page, id)).find((node) => String(node.className) === 'cr-exact');
  assert.ok(exact, `the "${id}" answer rendered no exact-evidence disclosure`);
  return exact;
}

const INSPECTOR = code.slice(code.indexOf('// ── changes & receipts inspector'),
  code.indexOf('// ── operational status strip'));

test('DOM: the inspector answers the five founder questions for the bound current run, in that order', () => {
  const page = bootPage(crFixture());
  assert.deepStrictEqual(crAnswers(page).map((node) => node.attrs['data-cr-answer']),
    ['scope', 'changed', 'checks', 'available', 'unverified'],
    'the inspector does not answer requested scope, recorded change, check receipt, availability and gaps in that order');
  assert.deepStrictEqual(crAnswers(page).map((node) => node.children[0].textContent),
    ['What was allowed', 'What changed', 'Which check receipt is recorded', 'What is available now',
      'What is still unverified'],
    'the five answers are not titled in the founder\'s own words');

  // Requested scope and recorded change are two different facts, and the packet's
  // allowed-file list is not on this page: saying so is the whole point.
  assert.match(crValue(page, 'scope'), /names a recorded packet/);
  assert.match(crValue(page, 'scope'), /allowed scope itself is Not recorded here/);
  assert.match(crValue(page, 'changed'),
    /^2 file\(s\) are recorded as changed in the exact code version this run is bound to\./,
    'a proven exact-subject binding did not produce a recorded change count');
  assert.match(crValue(page, 'checks'), /Every declared deterministic check passed/,
    'the recorded check receipt is not read from the page\'s own checks resolution');
  assert.match(crValue(page, 'available'), /Available now: IN THE RECORD/,
    'a validated checkpoint is not read as recorded availability');
  assert.match(crValue(page, 'unverified'), /are not established by the evidence on this page/);
  assert.match(crValue(page, 'unverified'), /none of them is a recorded failure, and none of them is a pass/,
    'an unverified gap was allowed to read as a failure or as a pass');
});

test('DOM: the inspector never attributes the page\'s gate-subject paths to a run nobody bound them to', () => {
  const page = bootPage(crFixture());
  crRunButton(page, CR_EARLIER_ID)._listeners.click[0]();
  assert.strictEqual(crRunButton(page, CR_EARLIER_ID).getAttribute('aria-pressed'), 'true',
    'choosing an earlier recorded run did not select it');
  assert.strictEqual(crRunButton(page, CR_CURRENT_ID).getAttribute('aria-pressed'), 'false',
    'two runs are selected at once, so the answers below name no single subject');
  assert.match(crValue(page, 'changed'),
    /^Not recorded — a changed-file list is delivered to this page only for the run it is bound to/,
    'an earlier run borrowed the bound run\'s changed-file list');
  const inspector = page.document.getElementById('cr-answers').textContent;
  for (const changed of CR_PATHS) {
    assert.ok(!inspector.includes(changed),
      `the recorded path ${changed} was attributed to a run that is not bound to it`);
  }
  // Silence is not a clean run: the same answer must not read as "changed nothing".
  assert.doesNotMatch(crValue(page, 'changed'), /no files|nothing changed|0 file/i,
    'missing changed-file evidence was rendered as a change with no files');
  // And the scope question still answers from the earlier run's OWN record.
  assert.match(crDisclosure(page, 'scope').textContent, new RegExp(CR_EARLIER_ID),
    'the answers still describe the previously selected run after the picker moved');
  assert.match(crValue(page, 'available'), /Available now: UNVERIFIED/,
    'a run with no validated checkpoint was reported as available');
});

test('DOM: an unproven exact-subject binding reads UNVERIFIED, and keeps the recorded paths as gate-subject evidence', () => {
  const page = bootPage(crFixture({
    binding: crBinding({ subjectState: 'MISMATCHED', subjectSha256: CR_OTHER_SUBJECT,
      runSubjectSha256: CR_OTHER_SUBJECT }),
  }));
  assert.strictEqual(crAnswer(page, 'changed').getAttribute('data-cr-state'), 'UNVERIFIED',
    'an unproven code-version binding was recorded as a proven change');
  assert.match(crValue(page, 'changed'), /^Unverified — 2 file\(s\) are recorded as changed in the gate subject/);
  assert.match(crValue(page, 'changed'), /not proven to be this run's change/);
  // Preserved as evidence, never deleted and never promoted.
  const exact = crDisclosure(page, 'changed').textContent;
  for (const changed of CR_PATHS) {
    assert.ok(exact.includes(changed), `the gate-subject path ${changed} was dropped instead of labelled`);
  }
  assert.match(exact, /Recorded changed paths of the gate subject/,
    'the preserved paths are not labelled as the gate subject\'s');
  assert.match(crValue(page, 'unverified'), /are not established by the evidence on this page/);
});

test('DOM: exact run ids, packet ids, subject hashes, recorded paths and receipt times stay behind the disclosures', () => {
  const page = bootPage(crFixture());
  const exact = [CR_CURRENT_ID, CR_PACKET, CR_SUBJECT.slice(0, 12), CR_PATHS[0],
    '2026-09-04T12:00:00.000Z', '2026-09-04T12:30:00.000Z'];
  for (const answer of crAnswers(page)) {
    const summary = allNodes(answer)
      .filter((node) => ['cr-value', 'chip'].includes(String(node.className)))
      .map((node) => node.textContent).join(' ');
    for (const value of exact) {
      assert.ok(!summary.includes(value),
        `the compact answer "${answer.attrs['data-cr-answer']}" prints the exact value ${value}`);
    }
    // Compact means one readable sentence pair, not a receipt dump.
    assert.ok(crValue(page, answer.attrs['data-cr-answer']).length <= 340,
      `the "${answer.attrs['data-cr-answer']}" summary is too long to read at a glance`);
    // Visible summary is exactly: title, answer, state chip, one disclosure.
    assert.strictEqual(answer.children.length, 4,
      `the "${answer.attrs['data-cr-answer']}" answer grew extra visible rows around its disclosure`);
    assert.strictEqual(String(answer.children[3].className), 'cr-exact',
      'the exact evidence is not the last, disclosed part of the answer');
    assert.strictEqual(answer.children[3].open, false,
      'an exact-evidence disclosure is forced open, so the summary is no longer compact');
    assert.strictEqual(answer.children[3].children[0].tagName, 'SUMMARY',
      'the exact evidence is not behind a native, keyboard-operable disclosure');
  }
  // Every one of those exact facts is still on the page, one keyboard press away.
  const disclosed = crAnswers(page).map((answer) => crDisclosure(page, answer.attrs['data-cr-answer']).textContent).join(' ');
  for (const value of exact) {
    assert.ok(disclosed.includes(value), `the exact recorded value ${value} was dropped instead of disclosed`);
  }
  assert.match(crDisclosure(page, 'checks').textContent, /Recorded run times: created 2026-09-04T12:00:00\.000Z/);
  assert.match(crDisclosure(page, 'checks').textContent,
    /Exact check command names are not delivered to this page/,
    'the inspector implies it knows which check commands ran');
});

test('DOM: a recorded ledger receipt is bound by packet and window, and says so; an unbindable one says why', () => {
  const receipt = { entryId: 'E-CR-1', ts: '2026-09-04T12:20:00.000Z', gate: 'aegis-check-receipt',
    status: 'PASS', packetId: CR_PACKET };
  const page = bootPage(crFixture({ events: [receipt] }));
  const disclosed = crDisclosure(page, 'checks').textContent;
  assert.ok(disclosed.includes('E-CR-1') && disclosed.includes('2026-09-04T12:20:00.000Z'),
    'the recorded ledger receipt and its canonical timestamp are not disclosed');
  assert.match(disclosed, /it is not a run-id match/,
    'a packet-bound receipt is presented as if the ledger named this run');

  // A receipt for another packet is not this run's receipt, and the absence is
  // explained rather than left blank.
  const foreign = bootPage(crFixture({
    events: [Object.assign({}, receipt, { packetId: 'PKT-SOMETHING-ELSE' })],
  }));
  const foreignText = crDisclosure(foreign, 'checks').textContent;
  assert.ok(!foreignText.includes('E-CR-1'), 'a receipt recorded for another packet was bound to this run');
  assert.match(foreignText, /Ledger receipts bound to this run: none — no recorded PASS receipt names this run's packet/);
});

test('DOM: the inspector tells an empty run ledger apart from one it could not read', () => {
  const empty = bootPage(fixtureState());
  const emptyScope = empty.document.getElementById('cr-scope');
  assert.strictEqual(emptyScope.getAttribute('data-cr-scope'), 'NO_RUNS');
  assert.match(emptyScope.textContent, /No canonical run is recorded yet, so there is nothing to inspect here\./);
  assert.strictEqual(crAnswers(empty).length, 0, 'answers were rendered for a run that does not exist');

  const unreadable = bootPage(fixtureState({
    runs: { state: 'UNAVAILABLE', runs: [],
      current: { state: 'UNAVAILABLE', runId: null, evidenceState: 'UNAVAILABLE',
        reason: '1 run record(s) could not be read or validated.' } },
  }));
  const unreadableScope = unreadable.document.getElementById('cr-scope');
  assert.strictEqual(unreadableScope.getAttribute('data-cr-scope'), 'UNAVAILABLE');
  assert.match(unreadableScope.textContent,
    /Run evidence UNAVAILABLE — 1 run record\(s\) could not be read or validated\./);
  assert.match(unreadableScope.textContent, /An empty list is not proof that no run exists\./,
    'an unreadable run ledger was reported as an empty one');
});

test('DOM: a live status repaint keeps the chosen run, the opened receipt and the keyboard where they were', () => {
  const page = bootPage(crFixture());
  crRunButton(page, CR_EARLIER_ID)._listeners.click[0]();
  crRunButton(page, CR_EARLIER_ID).focus();
  crDisclosure(page, 'checks').open = true;

  renderMinimizedStatus(page, {
    generatedAt: '2026-09-04T13:05:00.000Z',
    engineering: crEngineering(),
    runs: crFixture().runs.runs,
    runsBinding: crBinding(),
    runsState: 'OK',
    cost: { state: 'UNAVAILABLE', reason: 'no transcripts' },
    integration: { connectors: [] }, reviewers: [], events: [],
  });

  assert.strictEqual(crRunButton(page, CR_EARLIER_ID).getAttribute('aria-pressed'), 'true',
    'a live push moved the inspector off the run the operator chose');
  assert.strictEqual(page.document.activeElement, crRunButton(page, CR_EARLIER_ID),
    'a live push moved the keyboard off the run control the operator was on');
  assert.strictEqual(crDisclosure(page, 'checks').open, true,
    'a live push closed the receipt the operator had opened');
  assert.strictEqual(crDisclosure(page, 'scope').open, false,
    'a live push opened a disclosure the operator never opened');
});

test('the changes & receipts inspector adds no authority, timer, request, writer or second source of truth', () => {
  assert.ok(INSPECTOR.length > 2000, 'the inspector source block was not located');
  for (const banned of ['setInterval', 'setTimeout', 'requestAnimationFrame', 'Date.now', 'new Date',
    'Math.random', 'fetch(', 'XMLHttpRequest', 'EventSource', 'innerHTML', 'localStorage',
    'AEGIS_STATE', 'document.querySelector', 'callApi']) {
    assert.ok(!INSPECTOR.includes(banned),
      `the inspector uses ${banned} — it may only read the canonical resolutions it was handed`);
  }
  // It never writes to canonical evidence, and it holds exactly one page-local
  // reading position that is not a run, a verdict or a lifecycle claim.
  assert.ok(!/\b(?:run|record|binding|option\.run|e)\.[A-Za-z]+\s*=[^=]/.test(INSPECTOR),
    'the inspector assigns to a canonical record instead of reading it');
  assert.strictEqual((INSPECTOR.match(/crSelectedRunId = /g) || []).length, 3,
    'the inspector remembers more than the one reading position it is allowed to own');
  // Every answer restates a resolution this page already owns.
  for (const seam of ['evidenceChecksPanel(run)', 'journalAvailability(false, run)',
    'journalReceiptProof(run, events, win)', 'journalWindow(view && view.generatedAt)',
    'missionHeadline(option.run.objective)', 'shortSubject(run && run.subjectSha256)']) {
    assert.ok(INSPECTOR.includes(seam), `the inspector re-derives ${seam} instead of reusing the page's own resolution`);
  }
  // The deck hands it the same facts the evidence rail is handed, once.
  assert.strictEqual((code.match(/renderChangesReceipts\(/g) || []).length, 3,
    'the inspector is called from somewhere other than the deck repaint and its own picker');
  const call = code.slice(code.indexOf('renderChangesReceipts(view, {'));
  const handed = call.slice(0, call.indexOf('});'));
  for (const field of ['engineering: e,', 'binding: bind,', 'runs: runs,',
    'exactSubjectBound: exactSubjectBound,', 'emptyRunsAvailable: emptyRunsAvailable']) {
    assert.ok(handed.includes(field), `the inspector is not handed the deck's own ${field}`);
  }
  // No new lifecycle, verdict, provider, release or availability vocabulary.
  assert.ok(!/RELEASED|PUBLISHED|DEPLOYED|SHIPPED/.test(INSPECTOR),
    'the inspector invented a release claim the canonical record does not carry');
  assert.ok(!/claude|gpt|grok|codex|openai|anthropic/i.test(INSPECTOR),
    'the inspector hardcoded a provider or model status');
});

test('the changes & receipts inspector is keyboard operable and legible at 390px', () => {
  const source = htmlSrc();
  assert.ok(/<section id="changes-receipts" aria-labelledby="changes-receipts-h">/.test(source),
    'the inspector is not a labelled first-screen region');
  assert.ok(source.indexOf('id="topology-overview"') < source.indexOf('id="changes-receipts"') &&
    source.indexOf('id="changes-receipts"') < source.indexOf('id="inspector"'),
    'the inspector is not in the founder\'s reading order between the build route and the drill-down inspector');
  assert.ok(source.indexOf('id="changes-receipts"') < source.indexOf('class="evidence-deck"'),
    'the Command View inspector was buried in the deep evidence deck');
  assert.ok(/role="group" aria-labelledby="cr-picker-h"/.test(source),
    'the run picker is not an accessibly labelled group');
  // Real buttons, real pressed state — not a click handler on a div.
  assert.ok(/var button = el\('button','cr-run'\);/.test(INSPECTOR) &&
    /button\.type = 'button';/.test(INSPECTOR),
    'the run picker is not built from real buttons');
  assert.ok(/button\.setAttribute\('aria-pressed', isSelected \? 'true' : 'false'\);/.test(INSPECTOR),
    'the selected run is not exposed to assistive technology');
  assert.ok(/· selected/.test(INSPECTOR) && /· current run/.test(INSPECTOR),
    'selection and binding are signalled by colour alone');
  // 390px: one answer per row, finger-sized controls, and every canonical value
  // wraps instead of pushing the viewport sideways.
  assert.ok(/#cr-answers\{grid-template-columns:1fr\}/.test(PHONE),
    'the inspector still shares a phone row between answers');
  assert.ok(/button\.cr-run\{min-height:44px\}/.test(PHONE), 'the run picker is not finger-sized on a phone');
  assert.ok(/\.cr-exact>summary\{min-height:44px/.test(PHONE),
    'the exact-evidence disclosure is not finger-sized on a phone');
  const wrapped = phoneSelectorsDeclaring(/overflow-wrap:anywhere/);
  assert.ok(wrapped.has('.cr-scope') && wrapped.has('.cr-value') && wrapped.has('.cr-fact'),
    'inspector values can still push a 390px viewport sideways');
  for (const rule of [/\.cr-value\{[^}]*overflow-wrap:anywhere/, /\.cr-fact\{[^}]*overflow-wrap:anywhere/,
    /\.cr-list>li\{[^}]*overflow-wrap:anywhere/, /button\.cr-run\{[^}]*overflow-wrap:anywhere/]) {
    assert.ok(rule.test(code), `a dense inspector value does not wrap at every width: ${rule}`);
  }
  assert.ok(/button\.cr-run:focus-visible\{outline:2px solid var\(--focus\)/.test(code) &&
    /\.cr-exact>summary:focus-visible\{outline:2px solid var\(--focus\)/.test(code),
    'the inspector controls have no visible keyboard focus');
});

// ── SAFE-CANCEL & RECOVERY DECK ───────────────────────────────────────────
// One founder-readable deck over the moment a governed run has to be
// interrupted: what can be safely stopped right now, what survives stopping it,
// whether Retry is valid, when this same run has to be continued outside the
// dashboard instead, and the one next action.
//
// The failure these proofs guard against is a recovery surface that reassures.
// A cancellation REQUEST reading as a stopped process, an absent correction
// counter reading as remaining capacity, a recorded timeout quietly offering
// Retry, an unvalidated checkpoint reading as a safe state, or a rollback that
// looks like something the owner could press would each render calmly and be
// false. So every proof asks the same two questions of every answer: is the
// recorded fact printed exactly, and is the ABSENT fact named as absent.
const RD_RUN_ID = 'RUN-20260904-9999cccc';
const RD_COMMIT = 'e'.repeat(40);

function rdBuild(over) {
  return Object.assign({
    mode: 'async', status: 'RUNNING', workerPid: 4242, cancelAvailable: true,
    startedAt: '2026-09-04T12:05:00.000Z', heartbeatAt: '2026-09-04T12:29:00.000Z',
    endedAt: null, exit: null, timedOut: false, retrySafe: null, recoveryCode: null,
    failure: null, failover: null,
    activity: { code: 'RUNNING', phase: 'RUNNING', active: true, summary: 'Builder is running' },
  }, over || {});
}

// A stopped worker attempt: no capability, no live process, nothing running.
function rdStoppedBuild(over) {
  return rdBuild(Object.assign({
    status: 'EXITED', cancelAvailable: false, exit: 0, endedAt: '2026-09-04T12:31:00.000Z',
    activity: { code: 'EXITED', phase: 'STOPPED', active: false, summary: 'Builder exited' },
  }, over || {}));
}

function rdTimeoutSupervision() {
  return {
    progressState: 'RECORDED', progressKind: 'STDOUT',
    progressSummary: 'Builder is emitting model and tool stream activity',
    lastProgressAt: '2026-09-04T12:20:00.000Z', progressReason: null,
    activityState: 'UNAVAILABLE', activitySummary: null, activityAt: null,
    activityReason: 'no bounded builder activity is recorded.',
    noProgressLimitSec: 300, wallClockLimitSec: 900,
    timeoutReason: 'NO_PROGRESS_TIMEOUT',
    timeoutSummary: 'Stopped because no real builder progress was observed inside the fixed no-progress limit',
  };
}

function rdRun(over) {
  return Object.assign({
    runId: RD_RUN_ID, state: 'BUILDING',
    objective: 'Give the founder one honest recovery path',
    packetId: 'PKT-20260826-ASYNC-WORKER-OPERATOR-BETA',
    createdAt: '2026-09-04T12:00:00.000Z', updatedAt: '2026-09-04T12:30:00.000Z',
    corrections: 0, maxCorrections: 3,
    checkpoint: null, checkpointState: null, rollbackPoint: null,
    build: rdBuild(),
  }, over || {});
}

function rdPage(run) { return bootPage(failureFixture(run)); }

function rdAnswers(page) {
  return findByAttr(page.document.getElementById('rd-answers'), 'data-rd-answer');
}

function rdAnswer(page, id) {
  const node = rdAnswers(page).find((answer) => answer.attrs['data-rd-answer'] === id);
  assert.ok(node, `the recovery deck rendered no "${id}" answer`);
  return node;
}

function rdState(page, id) { return rdAnswer(page, id).getAttribute('data-rd-state'); }

function rdValue(page, id) {
  const value = allNodes(rdAnswer(page, id)).find((node) => String(node.className) === 'rd-value');
  assert.ok(value, `the "${id}" answer rendered no founder-readable value`);
  return value.textContent;
}

function rdDisclosure(page, id) {
  const exact = allNodes(rdAnswer(page, id)).find((node) => String(node.className) === 'rd-exact');
  assert.ok(exact, `the "${id}" answer rendered no exact-evidence disclosure`);
  return exact;
}

function rdDeckNextStep(page) {
  const step = findByAttr(page.document.getElementById('founder-body'), 'data-operator-field')
    .find((node) => node.attrs['data-operator-field'] === 'next-step');
  return step ? step.textContent : '';
}

const RECOVERY = code.slice(code.indexOf('// ── safe-cancel & recovery deck'),
  code.indexOf('// ── V2 failure-state storyboard'));

test('DOM: the recovery deck answers the five safe-cancel questions for the bound run, in that order', () => {
  const page = rdPage(rdRun());
  assert.deepStrictEqual(rdAnswers(page).map((node) => node.attrs['data-rd-answer']),
    ['stop', 'preserved', 'retry', 'continue', 'next'],
    'the deck does not answer what can be stopped, what survives, whether Retry is valid, when this run leaves the dashboard, and the next action in that order');
  assert.deepStrictEqual(rdAnswers(page).map((node) => node.children[0].textContent),
    ['What can be safely stopped now', 'What is preserved if you stop', 'Is Retry valid',
      'When it must continue outside the dashboard', 'The single next action'],
    'the five answers are not titled as the owner\'s own questions');
  const scope = page.document.getElementById('rd-scope');
  assert.strictEqual(scope.getAttribute('data-rd-scope'), 'BOUND_RUN');
  assert.match(scope.textContent, /Reading recovery evidence for the run this page is bound to right now\./);
  assert.match(scope.textContent, /It stops, retries, records and decides nothing, and no rollback control exists here\./,
    'the deck does not state its own reading-only boundary');
  // The next action is the deck's, restated — never a second recovery opinion.
  assert.ok(rdValue(page, 'next').length > 0 && rdDeckNextStep(page).includes(rdValue(page, 'next')),
    'the recovery deck reached its own next action instead of restating the deck\'s');
});

test('DOM: a running worker with recorded cancellation capability can be asked to stop, and is never called stopped', () => {
  const page = rdPage(rdRun());
  assert.strictEqual(rdState(page, 'stop'), 'WORKER_CANCELABLE');
  assert.match(rdValue(page, 'stop'),
    /an authenticated cancellation capability is recorded for its current attempt/);
  assert.match(rdValue(page, 'stop'),
    /stopped when the termination receipt is recorded, not when the request is accepted/,
    'an accepted cancellation request was allowed to read as a stopped process');
  assert.ok(!/Nothing is left to stop/.test(rdValue(page, 'stop')),
    'a still-running worker was reported as already stopped');
  assert.match(rdDisclosure(page, 'stop').textContent,
    /Recorded worker cancellation capability: RECORDED/);
  assert.match(rdDisclosure(page, 'stop').textContent, /Recorded termination receipt: NONE/);
  // A BUILDING run is not an abandonable lifecycle state, so nothing offers to
  // close its record either.
  assert.ok(!/close the run record/.test(rdValue(page, 'stop')));
});

test('DOM: a BUILDING run with no recorded cancellation capability is not stoppable from this page', () => {
  const page = rdPage(rdRun({ build: rdBuild({ cancelAvailable: false }) }));
  assert.strictEqual(rdState(page, 'stop'), 'NO_CANCEL_CAPABILITY');
  assert.match(rdValue(page, 'stop'), /this page cannot stop its process/);
  assert.match(rdDisclosure(page, 'stop').textContent,
    /Recorded worker cancellation capability: NOT RECORDED/);
  assert.ok(!/can be asked to stop/.test(rdValue(page, 'stop')),
    'a run with no recorded capability was offered as stoppable');
});

test('DOM: a signalled cancellation with no termination receipt never reads as a stopped process', () => {
  const page = rdPage(rdRun({
    build: rdBuild({ status: 'TERMINATION_UNVERIFIED', cancelAvailable: false,
      retrySafe: false, recoveryCode: 'TERMINATION_UNVERIFIED' }),
  }));
  assert.strictEqual(rdState(page, 'stop'), 'TERMINATION_UNVERIFIED');
  assert.match(rdValue(page, 'stop'), /AEGIS cannot say the process stopped/);
  assert.ok(!/Nothing is left to stop/.test(rdValue(page, 'stop')),
    'a cancellation with no receipt was reported as a completed stop');
  assert.match(rdDisclosure(page, 'stop').textContent,
    /Recorded termination receipt: TERMINATION_UNVERIFIED/);
  assert.match(rdDisclosure(page, 'stop').textContent,
    /AEGIS reports a process stopped only when its worker attempt is recorded TERMINATED\./);
  // And the same run is named as one this page cannot finish accounting for.
  assert.strictEqual(rdState(page, 'continue'), 'UNVERIFIED_TERMINATION');
  assert.match(rdValue(page, 'continue'),
    /can only be established outside this dashboard/);
});

test('DOM: a record that can still be closed is never confused with a process that stopped', () => {
  const page = rdPage(rdRun({
    state: 'BUILD_FAILED',
    build: rdBuild({ status: 'FAILED', cancelAvailable: false, exit: 1, retrySafe: false,
      recoveryCode: 'TERMINATION_UNVERIFIED' }),
  }));
  assert.strictEqual(rdState(page, 'stop'), 'TERMINATION_UNVERIFIED');
  assert.match(rdValue(page, 'stop'),
    /Cancel can still close the run record as abandoned, which closes the record and proves nothing about the process\./);
  assert.match(rdValue(page, 'stop'), /AEGIS cannot say the process stopped/);
});

test('DOM: an orphaned worker attempt is an unobserved termination, not a stop', () => {
  const page = rdPage(rdRun({
    build: rdBuild({ status: 'ORPHANED', cancelAvailable: false, retrySafe: false,
      recoveryCode: 'ORPHANED' }),
  }));
  assert.strictEqual(rdState(page, 'stop'), 'ORPHANED');
  assert.match(rdValue(page, 'stop'), /its termination was never observed/);
  assert.ok(!/Nothing is left to stop/.test(rdValue(page, 'stop')));
  assert.match(rdDisclosure(page, 'stop').textContent, /Recorded termination receipt: ORPHANED/);
  assert.strictEqual(rdState(page, 'continue'), 'UNVERIFIED_TERMINATION');
});

test('DOM: only a recorded TERMINATED attempt lets the deck say the process stopped', () => {
  const page = rdPage(rdRun({
    state: 'ABANDONED',
    build: rdBuild({ status: 'TERMINATED', cancelAvailable: false,
      endedAt: '2026-09-04T12:31:00.000Z' }),
  }));
  assert.strictEqual(rdState(page, 'stop'), 'STOPPED');
  assert.match(rdValue(page, 'stop'),
    /Nothing is left to stop\. This run's worker attempt is recorded TERMINATED, which is the canonical receipt that the process stopped\./);
  const exact = rdDisclosure(page, 'stop').textContent;
  assert.match(exact, /Recorded termination receipt: TERMINATED/);
  assert.match(exact, /Recorded worker end time: 2026-09-04T12:31:00\.000Z/);
});

test('DOM: cancelling a run with no running worker closes the record and is said to stop nothing', () => {
  const page = rdPage(rdRun({ state: 'BUILT', build: rdStoppedBuild() }));
  assert.strictEqual(rdState(page, 'stop'), 'RECORD_ONLY');
  assert.match(rdValue(page, 'stop'),
    /Cancel here closes the run record as abandoned\. It stops no process, because none is recorded running\./);

  // A state the transition authority does not abandon offers nothing at all,
  // and says which recorded state that is.
  const closed = rdPage(rdRun({ state: 'CHECKPOINTED', build: rdStoppedBuild(),
    checkpoint: 'CHK-20260904-9', checkpointState: 'VALIDATED', rollbackPoint: RD_COMMIT }));
  assert.strictEqual(rdState(closed, 'stop'), 'NOT_CANCELABLE');
  assert.match(rdValue(closed, 'stop'),
    /its recorded state CHECKPOINTED is not one AEGIS cancels, and no worker process is recorded running/);
});

test('DOM: a validated checkpoint is preserved evidence, never an exposed rollback control', () => {
  const page = rdPage(rdRun({ state: 'CHECKPOINTED', build: rdStoppedBuild(),
    checkpoint: 'CHK-20260904-9', checkpointState: 'VALIDATED', rollbackPoint: RD_COMMIT }));
  assert.strictEqual(rdState(page, 'preserved'), 'RECORDED');
  assert.match(rdValue(page, 'preserved'),
    /^This run has a recorded safe checkpoint, so stopping it leaves a recorded safe state behind\./);
  const exact = rdDisclosure(page, 'preserved').textContent;
  assert.match(exact, /Checkpoint receipt: CHK-20260904-9/);
  assert.ok(exact.includes(RD_COMMIT), 'the recorded rollback commit was dropped instead of disclosed');
  assert.match(exact, /Restoring it is a governed action AEGIS does not expose here\./,
    'the deck implies rollback is something this page can perform');
  assert.match(exact,
    /What the builder left in its isolated worktree is not delivered to this page/,
    'unrecorded worktree contents were treated as proven kept or proven lost');
});

test('DOM: an unvalidated or absent checkpoint is a closed door, never a preserved safe state', () => {
  const invalid = rdPage(rdRun({ state: 'BUILD_FAILED', build: rdStoppedBuild({ exit: 1, status: 'FAILED' }),
    checkpoint: null, checkpointState: 'INVALID',
    checkpointReason: 'the checkpoint receipt did not match its recorded subject' }));
  assert.strictEqual(rdState(invalid, 'preserved'), 'BLOCKED');
  assert.match(rdValue(invalid, 'preserved'),
    /checkpoint receipt did not validate, so no safe state and no way back can be named for it/);
  assert.match(rdDisclosure(invalid, 'preserved').textContent,
    /Recovery route: BLOCKED/);

  const none = rdPage(rdRun({ state: 'BUILD_FAILED', build: rdStoppedBuild({ exit: 1, status: 'FAILED' }) }));
  assert.strictEqual(rdState(none, 'preserved'), 'NOT_RECORDED');
  assert.match(rdValue(none, 'preserved'),
    /No checkpoint is recorded for this run, so stopping it leaves no recorded safe state to return to\./);
  assert.ok(!/rollback commit [0-9a-f]/.test(rdValue(none, 'preserved')),
    'an identifier was printed for a checkpoint that does not exist');
});

test('DOM: Retry is valid only where the canonical retry authority says so', () => {
  const failed = rdPage(rdRun({ state: 'BUILD_FAILED',
    build: rdStoppedBuild({ status: 'FAILED', exit: 1 }) }));
  assert.strictEqual(rdState(failed, 'retry'), 'AVAILABLE');
  assert.match(rdValue(failed, 'retry'), /^Retry is valid\./);
  assert.match(rdDisclosure(failed, 'retry').textContent, /Recorded correction cycles: 0 used of 3 allowed\./);
  assert.strictEqual(rdState(failed, 'continue'), 'NOT_REQUIRED');
  assert.match(rdValue(failed, 'continue'),
    /No recorded timeout and no spent correction budget requires this run to leave the dashboard\./);

  // A running build has no failure to correct, so Retry is not offered at all.
  const building = rdPage(rdRun());
  assert.strictEqual(rdState(building, 'retry'), 'NOT_APPLICABLE');
  assert.match(rdValue(building, 'retry'), /^Retry is not offered\./);

  // A recorded unsafe attempt refuses Retry and leaves no bounded route here.
  const unsafe = rdPage(rdRun({ state: 'BUILD_FAILED',
    build: rdStoppedBuild({ status: 'FAILED', exit: 1, retrySafe: false }) }));
  assert.strictEqual(rdState(unsafe, 'retry'), 'UNSAFE');
  assert.match(rdValue(unsafe, 'retry'), /recorded retry-safe NO, so AEGIS will not re-enter the bounded correction route/);
  assert.strictEqual(rdState(unsafe, 'continue'), 'NO_DASHBOARD_ROUTE');
});

test('DOM: an exhausted correction budget refuses Retry and names no dashboard route left', () => {
  const page = rdPage(rdRun({ state: 'REVIEW_FAILED', corrections: 3, maxCorrections: 3,
    build: rdStoppedBuild() }));
  assert.strictEqual(rdState(page, 'retry'), 'CORRECTION_LIMIT');
  assert.match(rdValue(page, 'retry'),
    /All 3 bounded correction cycle\(s\) are already used, so AEGIS refuses another retry\./);
  assert.strictEqual(rdState(page, 'continue'), 'NO_DASHBOARD_ROUTE');
  assert.match(rdValue(page, 'continue'), /^No bounded route remains on this page\./);
  assert.match(rdDisclosure(page, 'retry').textContent, /Recorded correction cycles: 3 used of 3 allowed\./);
});

test('DOM: absent correction counters read UNVERIFIED, never as spent capacity', () => {
  const page = rdPage(rdRun({ state: 'BUILD_FAILED', corrections: null, maxCorrections: null,
    build: rdStoppedBuild({ status: 'FAILED', exit: 1 }) }));
  assert.strictEqual(rdState(page, 'retry'), 'AVAILABLE',
    'missing correction counters were treated as proof the budget is spent');
  assert.match(rdDisclosure(page, 'retry').textContent,
    /Recorded correction cycles: UNVERIFIED — this run record carries no correction counters, which is missing evidence, not proof of remaining capacity\./);
});

test('DOM: a recorded builder timeout refuses Retry here and sends the same run to the CLI', () => {
  const page = rdPage(rdRun({ state: 'BUILD_FAILED',
    build: rdStoppedBuild({ status: 'FAILED', exit: 124, timedOut: true,
      supervision: rdTimeoutSupervision() }) }));
  assert.strictEqual(rdState(page, 'retry'), 'CLI_TIMEOUT_CONTINUATION');
  assert.match(rdValue(page, 'retry'), /Retry here would repeat the same bounded attempt and spend a correction cycle\./);
  assert.strictEqual(rdState(page, 'continue'), 'CLI_CONTINUATION');
  assert.match(rdValue(page, 'continue'),
    /^Now\. The builder timed out\./);
  assert.match(rdValue(page, 'continue'),
    /Continue this run from the AEGIS CLI, which is the only place a command and a timeout may be chosen\./);
  const exact = rdDisclosure(page, 'continue').textContent;
  assert.match(exact, /Timeout: NO_PROGRESS_TIMEOUT/);
  assert.match(exact, /This page may never choose an executable, a command, a provider, a model or a timeout/);

  // A run still recorded as building with a fired watchdog is named the same
  // way, from the supervision resolution alone.
  const stalled = rdPage(rdRun({ build: rdBuild({ cancelAvailable: false, timedOut: true,
    supervision: rdTimeoutSupervision() }) }));
  assert.strictEqual(rdState(stalled, 'continue'), 'TIMEOUT_RECORDED');
  assert.match(rdValue(stalled, 'continue'),
    /A builder timeout is recorded for this run, so continuing this same run is a CLI action\./);
});

test('DOM: an unbound recovery deck states what is not recorded and invents no stop, retry or safe state', () => {
  const page = bootPage(fixtureState());
  const scope = page.document.getElementById('rd-scope');
  assert.strictEqual(scope.getAttribute('data-rd-scope'), 'NO_RUN');
  assert.match(scope.textContent, /No canonical run is bound to this page/);
  assert.strictEqual(rdState(page, 'stop'), 'NO_RUN');
  assert.match(rdValue(page, 'stop'), /there is nothing to stop\./);
  assert.strictEqual(rdState(page, 'retry'), 'NO_RUN');
  assert.match(rdValue(page, 'retry'), /so Retry is not offered\./);
  assert.strictEqual(rdState(page, 'continue'), 'NO_RUN');
  assert.match(rdValue(page, 'continue'), /so no run has to be continued anywhere\./);
  assert.strictEqual(rdState(page, 'preserved'), 'UNAVAILABLE');
  assert.match(rdValue(page, 'preserved'), /whether a recorded safe state exists is UNAVAILABLE/);
  const disclosed = rdAnswers(page)
    .map((answer) => rdDisclosure(page, answer.attrs['data-rd-answer']).textContent).join(' ');
  assert.ok(!/RUN-\d/.test(disclosed), 'the unbound deck named a run nobody bound');
  assert.match(rdDisclosure(page, 'stop').textContent, /Run id: Not recorded/);
});

test('DOM: exact state codes, run id, receipts and checkpoint identifiers stay behind the disclosures', () => {
  const page = rdPage(rdRun({ state: 'BUILD_FAILED', corrections: 1, maxCorrections: 3,
    checkpoint: 'CHK-20260904-9', checkpointState: 'VALIDATED', rollbackPoint: RD_COMMIT,
    build: rdStoppedBuild({ status: 'FAILED', exit: 1, timedOut: true,
      supervision: rdTimeoutSupervision() }) }));
  const exact = [RD_RUN_ID, 'CHK-20260904-9', RD_COMMIT, 'NO_PROGRESS_TIMEOUT', 'BUILD_FAILED',
    '2026-09-04T12:31:00.000Z'];
  for (const answer of rdAnswers(page)) {
    const id = answer.attrs['data-rd-answer'];
    const summary = allNodes(answer)
      .filter((node) => String(node.className) === 'rd-value' || /^chip\b/.test(String(node.className)))
      .map((node) => node.textContent).join(' ');
    for (const value of exact) {
      assert.ok(!summary.includes(value), `the compact answer "${id}" prints the exact value ${value}`);
    }
    // Compact means one readable sentence pair. The next action is exempt: it is
    // the deck's own sentence, and shortening it here would make two surfaces
    // state the same governed action differently.
    if (id !== 'next') {
      assert.ok(rdValue(page, id).length <= 340,
        `the "${id}" summary is too long to read at a glance`);
    }
    // Visible summary is exactly: title, answer, state chip, one disclosure.
    assert.strictEqual(answer.children.length, 4,
      `the "${id}" answer grew extra visible rows around its disclosure`);
    assert.strictEqual(String(answer.children[3].className), 'rd-exact',
      'the exact evidence is not the last, disclosed part of the answer');
    assert.strictEqual(answer.children[3].open, false,
      'an exact-evidence disclosure is forced open, so the deck is no longer compact');
    assert.strictEqual(answer.children[3].children[0].tagName, 'SUMMARY',
      'the exact evidence is not behind a native, keyboard-operable disclosure');
  }
  // Every one of those exact facts is still on the page, one keyboard press away.
  const disclosed = rdAnswers(page)
    .map((answer) => rdDisclosure(page, answer.attrs['data-rd-answer']).textContent).join(' ');
  for (const value of exact) {
    assert.ok(disclosed.includes(value), `the exact recorded value ${value} was dropped instead of disclosed`);
  }
  // Status is never colour alone: each answer carries its state as a word.
  for (const answer of rdAnswers(page)) {
    const badge = answer.children[2];
    assert.match(String(badge.className), /^chip\b/, 'an answer state is signalled without a chip');
    assert.strictEqual(badge.children.length, 2,
      'an answer state chip carries no glyph beside its written label');
    assert.ok(badge.children[1].textContent.length > 0, 'an answer state chip has no written label');
  }
});

test('DOM: a live status repaint keeps the opened receipt and the keyboard where they were', () => {
  const page = rdPage(rdRun());
  rdDisclosure(page, 'retry').open = true;
  rdDisclosure(page, 'retry').children[0].focus();

  renderMinimizedStatus(page, {
    generatedAt: '2026-09-04T13:05:00.000Z',
    engineering: crEngineering(),
    runs: [rdRun()],
    runsBinding: { state: 'BOUND', runId: RD_RUN_ID, evidenceState: 'OK',
      updatedAt: '2026-09-04T12:30:00.000Z', reason: 'the exact current run is bound' },
    runsState: 'OK',
    cost: { state: 'UNAVAILABLE', reason: 'no transcripts' },
    integration: { connectors: [] }, reviewers: [], events: [],
  });

  assert.strictEqual(rdDisclosure(page, 'retry').open, true,
    'a live push closed the receipt the operator had opened');
  assert.strictEqual(page.document.activeElement, rdDisclosure(page, 'retry').children[0],
    'a live push moved the keyboard off the disclosure the operator was on');
  assert.strictEqual(rdDisclosure(page, 'stop').open, false,
    'a live push opened a disclosure the operator never opened');
  assert.strictEqual(rdState(page, 'stop'), 'WORKER_CANCELABLE',
    'the repaint did not read the pushed canonical run');
});

test('the recovery deck adds no authority, timer, endpoint, control, writer or provider claim', () => {
  assert.ok(RECOVERY.length > 2000, 'the recovery deck source block was not located');
  for (const banned of ['setInterval', 'setTimeout', 'requestAnimationFrame', 'Date.now', 'new Date',
    'Math.random', 'fetch(', 'XMLHttpRequest', 'EventSource', 'innerHTML', 'localStorage',
    'AEGIS_STATE', 'document.querySelector', 'callApi', '/api/']) {
    assert.ok(!RECOVERY.includes(banned),
      `the recovery deck uses ${banned} — it may only read the canonical resolutions it was handed`);
  }
  // It adds no control: Start, Cancel and Retry stay where they already are.
  assert.ok(!/addEventListener|el\('button'/.test(RECOVERY),
    'the recovery deck added a control of its own instead of describing the existing ones');
  // Rollback is never presented as something this page exposes.
  assert.ok(!/ROLLED_BACK|rollbackRun|requestRollback/.test(RECOVERY),
    'the recovery deck reached for a rollback route this page does not expose');
  // No invented provider, model or failover claim.
  assert.ok(!/claude|gpt|grok|codex|openai|anthropic|failover/i.test(RECOVERY),
    'the recovery deck hardcoded a provider, model or failover status');
  // It re-derives none of the verdicts it prints; it is handed every one.
  for (const derived of ['retryAvailability(', 'checkpointEvidenceState(', 'supervisionFacts(',
    'evidenceCheckpointPanel(', 'blockingStatus(', 'operationalState(']) {
    assert.ok(!RECOVERY.includes(derived),
      `the recovery deck calls ${derived} instead of restating the resolution it was handed`);
  }
  // It never writes to a canonical record.
  assert.ok(!/\b(?:run|build|retry|panel|answer|context|supervision)\.[A-Za-z]+\s*=[^=]/.test(RECOVERY),
    'the recovery deck assigns to a canonical record instead of reading it');
  // The deck hands it the same facts every other instrument was painted from.
  assert.strictEqual((code.match(/renderRecoveryDeck\(/g) || []).length, 2,
    'the recovery deck is called from somewhere other than its definition and the deck repaint');
  const call = code.slice(code.indexOf('renderRecoveryDeck({'));
  const handed = call.slice(0, call.indexOf('});'));
  for (const field of ['run: boundRun,', 'supervision: supervision,', 'retry: deckRetry,',
    'checkpoint: evidenceCheckpointPanel(boundRun, safeCheckpoint),', 'nextAction: deckActions[0]']) {
    assert.ok(handed.includes(field), `the recovery deck is not handed the deck's own ${field}`);
  }
});

test('one authority decides what Cancel is offered for, and the run card reads it', () => {
  assert.strictEqual((code.match(/var CANCEL_ABANDON_STATES = /g) || []).length, 1,
    'the abandonable-state list exists in more than one place');
  assert.strictEqual((code.match(/function cancelOffer\(/g) || []).length, 1,
    'cancellation availability is resolved by more than one function');
  assert.ok(!/hasCancellationCapability/.test(code),
    'a second cancellation-capability reading survives beside the shared one');
  assert.ok(!/var CANCELABLE = /.test(code),
    'a second cancelable-state list survives beside the shared one');
  assert.ok(/cancelOffer:\s*cancelOffer/.test(code),
    'the shared cancel offer is not exported to the switchboard layer');
  const runCard = code.slice(code.indexOf('function runActionRow'), code.indexOf('function renderRuns'));
  assert.ok(/window\.AEGIS_DASHBOARD\.cancelOffer\(run\)/.test(runCard),
    'the run card keeps its own opinion about which runs may be cancelled');
  assert.ok(/\{ worker: false, lifecycle: false, offered: false \}/.test(runCard),
    'the run card does not fail closed when the shared cancel authority is unavailable');
  // Cancellation authority is the server's projection, never a browser guess.
  assert.ok(/run\.build\.cancelAvailable === true/.test(RECOVERY),
    'the deck infers cancellation capability instead of reading the canonical projection');
  assert.ok(!/workerPid|heartbeatAt|startedAt/.test(RECOVERY.slice(RECOVERY.indexOf('function cancelOffer'),
    RECOVERY.indexOf('function rdStopFacts'))),
    'cancellation authority was inferred from a pid, a heartbeat or elapsed time');
});

test('the recovery deck is keyboard operable, motion-free and legible at 390px', () => {
  const source = htmlSrc();
  assert.ok(/<section id="recovery-deck" aria-labelledby="recovery-deck-h">/.test(source),
    'the recovery deck is not a labelled first-screen region');
  assert.ok(source.indexOf('id="topology-overview"') < source.indexOf('id="recovery-deck"') &&
    source.indexOf('id="recovery-deck"') < source.indexOf('id="changes-receipts"'),
    'the recovery deck is not in the founder\'s reading order between the build route and the receipts inspector');
  assert.ok(source.indexOf('id="recovery-deck"') < source.indexOf('class="evidence-deck"'),
    'the Command View recovery deck was buried in the deep evidence deck');
  // 390px: one answer per row, finger-sized disclosures, every canonical value
  // wraps instead of pushing the viewport sideways.
  assert.ok(/#rd-answers\{grid-template-columns:1fr\}/.test(PHONE),
    'the recovery deck still shares a phone row between answers');
  assert.ok(/\.rd-exact>summary\{min-height:44px/.test(PHONE),
    'the exact-evidence disclosure is not finger-sized on a phone');
  const wrapped = phoneSelectorsDeclaring(/overflow-wrap:anywhere/);
  assert.ok(wrapped.has('.rd-scope') && wrapped.has('.rd-value') && wrapped.has('.rd-fact'),
    'recovery values can still push a 390px viewport sideways');
  for (const rule of [/\.rd-scope\{[^}]*overflow-wrap:anywhere/, /\.rd-value\{[^}]*overflow-wrap:anywhere/,
    /\.rd-fact\{[^}]*overflow-wrap:anywhere/]) {
    assert.ok(rule.test(code), `a dense recovery value does not wrap at every width: ${rule}`);
  }
  assert.ok(/\.rd-exact>summary:focus-visible\{outline:2px solid var\(--focus\)/.test(code),
    'the recovery deck disclosures have no visible keyboard focus');
  // Nothing on a recovery surface may move: a failed or stopped run must never
  // borrow a working shape.
  // Slice the stylesheet out of `source`, not `code`: `code` has CSS comments
  // stripped, so the delimiters below only exist in the comment-preserving read.
  const css = source.slice(source.indexOf('/* ── recovery deck ──'),
    source.indexOf('/* ── changes & receipts inspector ──'));
  assert.ok(css.length > 400, 'the recovery deck stylesheet block was not located');
  assert.ok(!/animation|transition|@keyframes/.test(css), 'the recovery deck animates');
});

// ── command ribbon & sharpened mission brief ───────────────────────────────
// The failure guarded here is the one the reference HUD does not have: a first
// screen whose top is a document. Where the evidence came from, which run it is
// about, and the five operational answers each took a full-width band of their
// own, the gate reading took a third row under the run it belongs to, and the
// mission brief spent two clamped rows explaining itself before it got to the
// one next action — so the control plane started below the fold.
//
// The correction is composition, and every proof below pairs "more compact"
// with "the same truth is still here". Nothing may be deleted, shortened,
// re-sourced or made unreachable: a sentence that leaves the first screen has
// to be one keyboard press away, whole, in a native disclosure.

function ribbonRun(page) {
  const host = page.document.getElementById('ops-strip-run');
  const chips = {};
  findByAttr(host, 'data-ops-run-chip').forEach((node) => {
    chips[node.attrs['data-ops-run-chip']] = node;
  });
  const fields = {};
  findByAttr(host, 'data-ops-run-field').forEach((node) => {
    fields[node.attrs['data-ops-run-field']] = node;
  });
  return { host, chips, fields };
}

function briefSupportingNode(page) {
  const nodes = findByAttr(page.document.getElementById('founder-body'), 'data-brief-detail');
  assert.strictEqual(nodes.length, 1,
    `expected exactly one supporting-answer disclosure, found ${nodes.length}`);
  return nodes[0];
}

test('the command ribbon reads provenance and the bound run as one band, in the shipped order', () => {
  const source = htmlSrc();
  assert.strictEqual((source.match(/class="ops-ribbon"/g) || []).length, 1,
    'a second command ribbon would let two bands claim the same provenance and the same run');
  // Source order is the reading order for a screen reader and for the phone
  // stack, and it is unchanged: the heading, then where the evidence came from,
  // then which run it is about, then the five answers about that run.
  const strip = source.indexOf('id="ops-strip"');
  const ribbon = source.indexOf('class="ops-ribbon"');
  const prov = source.indexOf('id="state-provenance"');
  const identity = source.indexOf('id="ops-strip-run"');
  const cells = source.indexOf('id="ops-strip-cells"');
  assert.ok(strip < source.indexOf('id="ops-strip-h"') && source.indexOf('id="ops-strip-h"') < ribbon &&
    ribbon < prov && prov < identity && identity < cells,
    'the ribbon changed the order in which provenance, the bound run and the five answers are read');
  // Two segments side by side above 1100px, and an ordinary block below it, so
  // the phone and tablet stacks are exactly the ones that already shipped.
  assert.ok(/\.ops-ribbon\{min-width:0\}/.test(code),
    'the ribbon container carries no shipped base layout, so a long value can widen the page');
  assert.ok(/\.ops-ribbon\{display:grid;grid-template-columns:minmax\(0,20fr\) minmax\(0,29fr\)/.test(WIDE),
    'the wide command ribbon is not one band: provenance and the bound run still stack');
  assert.ok(!/\.ops-ribbon\{/.test(PHONE),
    'the ribbon reached below 1100px and changed the shipped phone stack');
  // A container, never an editor: it may not hide, clamp, cap or animate either
  // segment, and both segments are still in the DOM with their own ids.
  for (const rule of code.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/\.ops-ribbon\b/.test(rule[1])) continue;
    assert.ok(!/display:none|visibility:|-webkit-line-clamp|max-height|text-overflow/.test(rule[2]),
      `${rule[1].trim()} hides, caps or truncates a ribbon segment instead of composing it`);
    assert.ok(!/\banimation\s*:/.test(rule[2]) && !/(?:^|;)transition:(?!none)/.test(rule[2]),
      `${rule[1].trim()} animates the ribbon — it is an instrument, not decoration`);
  }
  for (const id of ['state-provenance', 'ops-strip-run', 'ops-strip-cells']) {
    assert.ok(source.includes('id="' + id + '"'), `${id} was composed away instead of being seated`);
  }
});

// ── the operational band is a ribbon, not a second row of dashboard cards ──
// The failure guarded here is the one an owner sees at 1292×994: the five
// operational answers rendered as a second row of deck-sized cards directly
// under the header, so the mission brief, the central AEGIS Core and the
// Inspector all started below the fold. The correction is rhythm in the wide
// density block only — spacing and one line clamp — so every proof below pairs
// "slimmer" with "the same six facts are still readable in words, nothing left
// the DOM, and every clamped sentence is still read in full somewhere else on
// this page".
//
// The six facts this band has to keep readable are the bound run, gate
// readiness, the latest builder activity, the run limits, the recorded cost and
// the last safe checkpoint. They are read here out of the real DOM, through the
// real renderers, so a compaction that quietly drops one fails here.
test('the wide operational band is one slim ribbon: compacted by spacing, never by removal', () => {
  // One summary line per answer: the written label and the canonical state word
  // share the first row, and the resolved sentence reads under them clamped to a
  // single line — inside a cell with ribbon padding, not card padding.
  assert.ok(/\.ops-cell\{display:flex;flex-wrap:wrap;[^}]*padding:4px 9px\}/.test(WIDE),
    'the five operational answers still carry full-height card padding at laptop width');
  assert.ok(/\.ops-value\{flex:1 0 100%;margin-top:2px;-webkit-line-clamp:1\}/.test(WIDE),
    'the strip sentence still takes two lines in every cell of the wide band');
  assert.ok(/\.ops-strip-cells\{grid-template-columns:repeat\(5,minmax\(0,1fr\)\);gap:6px;padding:5px 0 0\}/.test(WIDE),
    'the wide cell band keeps the card gutter and the card band padding it had');
  // The heading and the two ribbon segments above the cells are seated tight
  // against them, so the operational area is one band rather than three.
  assert.ok(/\.ops-strip>\.ops-strip-title\{min-height:0;padding:3px 2px\}/.test(WIDE),
    'the strip heading still reserves a band of its own above the ribbon');
  assert.ok(/\.ops-ribbon\{display:grid;[^}]*gap:3px 20px;\s*align-items:start;padding:4px 0 0\}/.test(WIDE) &&
    /\.ops-ribbon>#state-provenance\{margin:0;padding:5px 9px\}/.test(WIDE) &&
    /\.ops-run-line\{gap:4px 8px\}/.test(WIDE) && /\.ops-run-why\{margin-top:3px\}/.test(WIDE),
    'the ribbon segments keep the full-height rhythm the cells no longer have');

  // Compaction is spacing and a clamp. Nothing in the operational band may be
  // removed, capped, masked or repainted to make it slim.
  for (const rule of wideRules()) {
    const target = rule.selectors.join(',');
    if (!/\.ops-/.test(target)) continue;
    assert.ok(!/display:none|visibility:|content-visibility:|max-height|text-overflow/.test(rule.body),
      `${target} hides or caps an operational answer instead of compacting it`);
  }
  // Clamping is a stylesheet decision, never a truncated value: the renderer
  // still writes the whole canonical sentence into the cell.
  assert.ok(/node\.appendChild\(el\('div','ops-value',cell\.value\)\)/.test(code),
    'the ribbon truncates its canonical sentence in the renderer instead of in the stylesheet');
  // And every sentence the ribbon clamps is rendered unabridged further down the
  // same page, through the shipped seams that already carry it.
  for (const restated of ["commandCard('BUILDER PROGRESS'", "commandCard('LAST SAFE CHECKPOINT'",
    'evidenceCostPanel(view && view.cost)']) {
    assert.ok(code.includes(restated),
      `${restated} no longer restates in full a sentence the wide ribbon clamps`);
  }

  // The bound run and gate readiness, read out of the real identity row.
  const page = rdPage(rdRun());
  const line = ribbonRun(page);
  assert.ok(line.fields.id.textContent.includes(RD_RUN_ID),
    'the slim ribbon no longer names the canonically bound run');
  assert.strictEqual(line.chips.gate.children[1].textContent,
    RUN_STATE_PLAIN[line.host.attrs['data-ops-run']],
    'gate readiness is no longer readable as a word on the slim ribbon');
  assert.ok(line.fields.why.textContent.length > 0,
    'the sentence that stops a recorded run reading as live work left the ribbon');

  // The four remaining facts, each still a written label, a plain state word and
  // its own canonical sentence in the DOM.
  const cells = {};
  findByAttr(page.document.getElementById('ops-strip-cells'), 'data-ops-cell')
    .forEach((node) => { cells[node.attrs['data-ops-cell']] = node; });
  assert.deepStrictEqual(Object.keys(cells).sort(),
    ['checkpoint', 'cost', 'progress', 'run-state', 'watchdog'],
    'the slim ribbon dropped one of the five operational answers');
  for (const [id, label] of [['run-state', 'GATE READINESS'], ['progress', 'Latest builder activity'],
    ['watchdog', 'Run limits'], ['cost', 'RECORDED COST (CAD)'],
    ['checkpoint', 'LAST SAFE CHECKPOINT']]) {
    const cell = cells[id];
    const labelNode = (cell.children || []).find((c) => String(c.className) === 'ops-label');
    assert.ok(labelNode && labelNode.textContent === label,
      `the ${id} answer lost its written label on the slim ribbon`);
    const chipNode = (cell.children || []).find((c) => String(c.className).includes('chip'));
    assert.ok(chipNode && chipNode.children.length === 2 &&
      chipNode.children[1].textContent.length > 0,
    `the ${id} answer lost the glyph and plain state word the ribbon keeps readable`);
    assert.match(chipNode.attrs.title, /^Canonical state code: [A-Z_]+$/,
      `the ${id} answer lost the exact canonical code behind its plain word`);
    const value = (cell.children || []).find((c) => String(c.className) === 'ops-value');
    assert.ok(value && value.textContent.length > 0,
      `the ${id} sentence left the DOM instead of being clamped in the stylesheet`);
  }

  // Every narrower layout is untouched: the base cell, the tablet band and the
  // 390px phone stack are exactly the styles they shipped with.
  assert.ok(/\.ops-cell\{min-width:0;padding:9px 11px/.test(code) &&
    /\.ops-value\{[^}]*-webkit-line-clamp:4/.test(code),
    'the shipped base status cell was rebuilt instead of being overridden above 1100px');
  assert.ok(/\.ops-cell\{display:flex;flex-wrap:wrap;[^}]*padding:5px 10px\}/.test(PHONE) &&
    /\.ops-value\{[^}]*-webkit-line-clamp:1\}/.test(PHONE) &&
    /\.ops-strip-cells\{grid-template-columns:1fr\}/.test(PHONE),
    'the 390px phone strip was changed by the wide ribbon compaction');
  assert.ok(/\.ops-strip-cells\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/.test(code) &&
    /\.ops-strip-cells\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)\}/.test(code),
    'the tablet and ordinary-laptop status bands were changed by the wide ribbon compaction');
});

test('DOM: gate readiness rides the identity row and keeps its own label, chip and written word', () => {
  const page = rdPage(rdRun());
  const line = ribbonRun(page);
  // One band and one sentence: the row, then the reason. The gate no longer
  // costs a third stacked row under the run it describes.
  assert.strictEqual(line.host.children.length, 2,
    'the bound-run identity is not one row plus its reason sentence');
  assert.strictEqual(String(line.host.children[0].className), 'ops-run-line');
  assert.strictEqual(String(line.host.children[1].className), 'ops-run-why');
  // Both readings are on that row, each still under its own written heading.
  const row = line.host.children[0].textContent;
  for (const label of ['CURRENT RUN', 'BUILD ACTIVITY', 'GATE READINESS']) {
    assert.ok(row.includes(label), `the identity row lost the ${label} heading: ${row}`);
  }
  assert.ok(row.includes(RD_RUN_ID), 'the identity row no longer names the canonically bound run');
  // Two separate chips, each a glyph plus a written state word, so neither
  // reading is legible by colour alone and neither can rewrite the other. The
  // gate chip is the control-plane reading the host already records; the build
  // chip is the lifecycle reading, and it is not the same node. The word is now
  // the operator's plain English, and the exact canonical code has to stay
  // reachable on the same node — in its title and in its s-STATE style.
  for (const id of ['build', 'gate']) {
    const node = line.chips[id];
    assert.ok(node, `the identity row has no ${id} chip`);
    assert.strictEqual(node.children.length, 2,
      `the ${id} chip carries no glyph beside its written state`);
    assert.ok(node.children[0].textContent.trim().length > 0, `the ${id} chip glyph is empty`);
    assert.ok(!/[A-Z]{2,}|_/.test(node.children[1].textContent),
      `the ${id} chip still leads with a machine token: ${node.children[1].textContent}`);
    assert.match(node.attrs.title, /^Canonical state code: [A-Z_]+$/,
      `the ${id} chip dropped the exact canonical code its plain word replaced`);
  }
  assert.notStrictEqual(line.chips.build, line.chips.gate,
    'the two readings were merged back into one chip on the compacted row');
  assert.strictEqual(line.chips.gate.attrs.title,
    'Canonical state code: ' + line.host.attrs['data-ops-run'],
    'the gate chip on the identity row is not the control-plane reading the line records');
  assert.strictEqual(line.chips.gate.children[1].textContent,
    RUN_STATE_PLAIN[line.host.attrs['data-ops-run']],
    'the gate chip does not read the control-plane state in plain English');
  assert.strictEqual(line.chips.build.children[1].textContent, RUN_STATE_PLAIN.RUNNING,
    'a recorded running worker lost its lifecycle reading when the row was compacted');
  // The lifecycle state itself reads as what it means, and its exact aegis-run
  // code is still carried on the very node whose word replaced it.
  assert.strictEqual(line.fields.canonical.textContent, RUN_LIFECYCLE_PLAIN.BUILDING,
    'the identity row still leads with the canonical lifecycle token');
  assert.strictEqual(line.fields.canonical.attrs['data-ops-run-code'], 'BUILDING');
  assert.strictEqual(line.fields.canonical.attrs.title, 'Canonical run state code: BUILDING');
  assert.ok(allNodes(line.host.children[0]).some((node) => node.attrs['data-ops-run-chip'] === 'gate'),
    'the gate chip was moved off the identity row instead of onto it');
  // The sentence that stops a recorded run from being read as live work is
  // still written whole, outside every disclosure, and still unclamped.
  assert.match(line.fields.why.textContent, /This is the run AEGIS is working on right now\./,
    `the identity reason sentence was shortened by the ribbon: ${line.fields.why.textContent}`);
  assert.strictEqual(line.fields.why.tagName, 'P',
    'the identity reason was folded into the row instead of staying its own sentence');
  assert.ok(/\.ops-run-gate\{display:inline-flex/.test(code) &&
    /\.ops-run-gate>\.chip\{margin:0;white-space:normal\}/.test(code),
    'the gate reading has no shipped layout on the identity row, so its chip cannot wrap there');
  // The renderer is still handed the same two resolutions and reaches for
  // nothing else: composition may not become a third reading.
  const renderer = code.slice(code.indexOf('function renderOpsRun'), code.indexOf('function deckDisclosure'));
  for (const banned of ['setInterval', 'setTimeout', 'requestAnimationFrame', 'Date.now', 'new Date',
    'Math.random', 'fetch(', 'innerHTML', 'AEGIS_STATE', 'addEventListener']) {
    assert.ok(!renderer.includes(banned),
      `the identity renderer uses ${banned} — it may only paint the resolution it was handed`);
  }
  assert.ok(/opsChip\(identity\.build, opsChipLabel\('run-state', identity\.build\)\)/.test(renderer) &&
    /opsChip\(identity\.state, opsChipLabel\('run-state', identity\.state\)\)/.test(renderer),
    'the identity row stopped painting both the build and the gate reading');
});

test('DOM: the two explanatory brief answers read behind one collapsed, keyboard-operable disclosure', () => {
  const page = bootPage(fixtureState());
  const supporting = briefSupportingNode(page);
  assert.strictEqual(supporting.tagName, 'DETAILS',
    'the supporting answers are not a native disclosure, so they are not keyboard-operable');
  assert.strictEqual(supporting.open, false,
    'the supporting answers are disclosed by default, which is the density this replaced');
  const summary = supporting.firstElementChild;
  assert.strictEqual(summary.tagName, 'SUMMARY', 'the disclosure has no summary to operate');
  assert.strictEqual(summary.textContent, 'Completed so far and still to verify',
    'the disclosure does not say which answers it holds');
  // Exactly the two explanatory answers are inside it.
  assert.deepStrictEqual(findByAttr(supporting, 'data-operator-brief')
    .map((node) => node.attrs['data-operator-brief']), ['finished', 'verify'],
  'the disclosure holds something other than the two explanatory answers');
  // The objective, the state summary, the current action, the one next action
  // and attention all stay outside it and visible.
  for (const answer of ['now', 'next', 'needs-marc']) {
    assert.ok(!findByAttr(supporting, 'data-operator-brief')
      .some((node) => node.attrs['data-operator-brief'] === answer),
    `the ${answer} answer was collapsed with the explanation it is not`);
  }
  const founder = page.document.getElementById('founder-body');
  assert.ok(!findByAttr(supporting, 'data-operator-field').length,
    'a command card was moved into the brief disclosure');
  assert.deepStrictEqual(allNodes(supporting).filter((node) => node.tagName === 'BUTTON'), [],
    'a governed control was moved inside the brief disclosure');
  const missionTitle = allNodes(founder).find((node) => String(node.className) === 'mission-title');
  const missionMeta = allNodes(founder).find((node) => String(node.className) === 'mission-meta');
  assert.ok(missionTitle && missionTitle.textContent.length > 0,
    'the objective headline left the top of the brief');
  assert.match(missionMeta.textContent, /^Gate readiness: .+ · Run lifecycle: .+/,
    'the compact state summary left the top of the brief');
  assert.ok(missionMeta.attrs['data-mission-gate-code'] &&
    missionMeta.attrs['data-mission-lifecycle-code'],
  'the compact state summary lost the exact canonical pair behind its plain words');
  // Still exactly the five canonical answers, in the canonical order, and the
  // two that moved say exactly what they said before.
  assert.deepStrictEqual(briefRows(page).map((node) => node.attrs['data-operator-brief']),
    ['finished', 'verify', 'now', 'next', 'needs-marc'],
    'the disclosure changed which answers exist, or the order they are read in');
  assert.strictEqual(briefField(page, 'finished').value,
    'Nothing has been built yet — no run has started.',
    'the completed-so-far sentence was rewritten or shortened by the disclosure');
  assert.strictEqual(briefField(page, 'verify').value, 'Nothing is waiting to be verified.',
    'the still-to-verify sentence was rewritten or shortened by the disclosure');
  // It is a second disclosure, not a second copy of the first: the deck's own
  // worker-and-evidence disclosure is still the only one of its kind.
  assert.strictEqual(deckDisclosureNode(page).getAttribute('data-operator-disclosure'),
    'worker-evidence', 'the brief disclosure was mistaken for the deck disclosure');
  assert.strictEqual((code.match(/setAttribute\('data-brief-detail','supporting'\)/g) || []).length, 1,
    'the supporting disclosure is created in more than one place');
});

test('DOM: a live repaint keeps the brief disclosure open and the keyboard where the owner left it', () => {
  const page = bootPage(briefBuildingFixture());
  briefSupportingNode(page).open = true;
  briefSupportingNode(page).firstElementChild.focus();

  renderMinimizedStatus(page, briefBuildingStatus());

  const after = briefSupportingNode(page);
  assert.strictEqual(after.open, true,
    'a live status push shut the answers the owner had opened');
  assert.strictEqual(page.document.activeElement, after.firstElementChild,
    'a live status push moved the keyboard off the disclosure the owner was on');
  assert.strictEqual(deckDisclosureNode(page).open, false,
    'the repaint opened a disclosure the owner never opened');
  // And it repainted from the pushed canonical status rather than replaying the
  // answers it already had.
  assert.match(briefField(page, 'now').value, /Editing the command deck\./,
    'the repaint did not read the pushed canonical run');
  assert.ok(/briefSupporting\.open = briefDetailOpen;/.test(code),
    'the disclosure no longer restores the open state the repaint is replacing');
  assert.ok(/priorBriefDetail && priorBriefDetail\.open/.test(code) &&
    /document\.activeElement === priorBriefDetail\.firstElementChild/.test(code),
    'the open state and keyboard position are read from something other than the live DOM');
  assert.strictEqual((code.match(/function briefDetail\(/g) || []).length, 1,
    'the supporting disclosure is located by more than one function');
  const reader = code.slice(code.indexOf('function briefDetail('),
    code.indexOf('// ── build journal'));
  for (const banned of ['setInterval', 'setTimeout', 'requestAnimationFrame', 'Date.now', 'new Date',
    'fetch(', 'innerHTML', 'localStorage', 'sessionStorage', 'AEGIS_STATE', '/api/']) {
    assert.ok(!reader.includes(banned),
      `the disclosure reader uses ${banned} — it may only read the DOM it is about to replace`);
  }
});

test('the sharpened brief hides nothing: the moved sentences are unclamped, tappable and motion-free', () => {
  // The two answers used to be clamped to two lines on a wide screen. They are
  // not clamped anywhere now: the disclosure holds them whole.
  for (const selector of wideSelectorsDeclaring(/-webkit-line-clamp/)) {
    assert.ok(!/"finished"|"verify"/.test(selector),
      `${selector} still truncates an answer the disclosure now holds in full`);
  }
  assert.ok(!/brief-value\{[^}]*line-clamp/.test(PHONE) && !/brief-supporting[^{]*\{[^}]*line-clamp/.test(code),
    'a canonical operator answer is clamped instead of read in full');
  // Keyboard and touch: a visible focus ring at every width, and a finger-sized
  // target on a phone, exactly like every other disclosure on this page.
  assert.ok(/\.brief-supporting>summary\{cursor:pointer/.test(code),
    'the supporting disclosure has no shipped summary treatment');
  assert.ok(/\.brief-supporting>summary:focus-visible\{outline:2px solid var\(--focus\)/.test(code),
    'the supporting disclosure has no visible keyboard focus');
  assert.ok(phoneSelectorsDeclaring(/min-height:44px/).has('.brief-supporting>summary'),
    'the supporting disclosure is not a finger-sized target at phone width');
  // The phone keeps action before explanation: the disclosure is ordered after
  // the current action, attention and the one next action.
  assert.ok(/\.brief-supporting\{display:flex;flex-direction:column;order:4\}/.test(PHONE),
    'the phone brief no longer orders the explanation after the decision answers');
  const order = {};
  for (const row of PHONE.matchAll(/\.brief-row\[data-operator-brief="([\w-]+)"\]\{order:(\d+)\}/g)) {
    order[row[1]] = Number(row[2]);
  }
  assert.ok(order.finished < order.verify,
    'the two answers inside the disclosure lost the order they are read in');
  assert.ok(order.now < order['needs-marc'] && order['needs-marc'] < order.next && order.next <= 4,
    `the phone brief reads explanation before action: ${JSON.stringify(order)}`);
  // Nothing on the brief moves, and the disclosure added no motion of its own.
  const css = code.slice(code.indexOf('.operator-brief{'), code.indexOf('.handoff{display:flex'));
  assert.ok(/\.brief-supporting\{/.test(css), 'the supporting disclosure has no stylesheet block');
  assert.ok(!/@keyframes|\banimation\s*:|(?:^|;)transition:(?!none)/.test(css),
    'the sharpened brief introduced motion');
});

// ── wide-screen three-rail operator cockpit ────────────────────────────────
// The gap closed here is compositional, not textual. Every wide screen below
// 1600px laid the operator's own rail out as a full-width three-across band
// UNDER the centre console, so the first screen the owner works on had two
// rails and the Inspector, the tools context and Ask AEGIS were below the fold.
// The approved reference is a cockpit with three rails — mission brief, the
// AEGIS Core and its six modules, operator rail — so the rail that already
// exists is seated beside the HUD instead of being stacked beneath it.
//
// The failure a re-composition invites is a second surface: a duplicated
// Inspector, a second Ask AEGIS answer, a control that quietly leaves the page,
// or a "layout" block that starts repainting state. So every proof below pairs
// "seated on the wide screen" with "the same single DOM, the same sentences,
// and nothing new that could claim anything".
const cockpitStart = code.indexOf('@media (min-width:1280px)');
const COCKPIT = cockpitStart === -1 ? '' : code.slice(cockpitStart, code.indexOf('\n  }', cockpitStart));

function cockpitRules() {
  const rules = [];
  for (const rule of COCKPIT.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    rules.push({ selectors: rule[1].split(',').map((s) => s.trim()).filter(Boolean), body: rule[2] });
  }
  return rules;
}

// Seating, and nothing else. Every property this block may declare places a box
// that already exists; none of them paints, hides, clamps, times or renames
// anything inside it.
const COCKPIT_SEATING_ONLY = new Set(['grid-template-columns', 'grid-template-areas', 'display',
  'flex-direction', 'position', 'top', 'max-height', 'overflow', 'scrollbar-gutter']);

test('the wide first screen seats three rails: the mission brief, the HUD, and the operator rail', () => {
  assert.ok(COCKPIT.length > 0, 'the wide three-rail cockpit block was not located');
  assert.strictEqual((code.match(/@media \(min-width:1280px\)/g) || []).length, 1,
    'the cockpit is composed in more than one block, so two rules could disagree about where the rail sits');
  const shell = cockpitRules().find((rule) => rule.selectors.join(',') === '.command-shell');
  assert.ok(shell, 'the wide cockpit declares no shell layout at all');
  assert.match(shell.body, /grid-template-areas:"left center right" "evidence evidence evidence"/,
    'the wide shell is not three rails above one full-width evidence row');
  // Three real tracks, and the centre is the one that grows: a fixed rail pair
  // would take the width the six modules and the nine-station path need.
  assert.match(shell.body,
    /grid-template-columns:minmax\(0,clamp\(272px,21vw,320px\)\) minmax\(0,1fr\) minmax\(0,clamp\(252px,20vw,340px\)\)/,
    'the cockpit rails are not fluid around a growing centre console');
  const rail = cockpitRules().find((rule) => rule.selectors.join(',') === '.right-rail');
  assert.ok(rail, 'the operator rail is not seated by the cockpit block');
  assert.match(rail.body, /display:flex;flex-direction:column/,
    'the operator rail is still laid out as a band of columns instead of as one rail');
  assert.match(rail.body, /position:sticky/,
    'the operator rail does not stay beside the HUD while the centre console scrolls');
  // A capped rail that cannot scroll is a hidden control, so the cap and the
  // scroll are in the same rule and neither can ship without the other.
  assert.strictEqual(/max-height:/.test(rail.body), /overflow:auto/.test(rail.body),
    'the operator rail is capped without being scrollable, so a control inside it can become unreachable');
  // One seat, in one place: two seating rules are two answers to "where does
  // the operator rail live" at two widths.
  const seated = [];
  for (const rule of code.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (/position:sticky/.test(rule[2]) && /right-rail/.test(rule[1])) seated.push(rule[1].trim());
  }
  assert.deepStrictEqual(seated, ['.right-rail'],
    'the operator rail is seated by more than one rule, so two widths could disagree about where it sits');
});

test('the cockpit is wide-screen only: the 1100px band, the tablet stack and the 390px order are untouched', () => {
  assert.ok(!/@media \(max-width/.test(COCKPIT),
    'the cockpit block carries a max-width of its own, which is a second place for a width to be re-composed');
  for (const query of COCKPIT.match(/@media \(min-width:(\d+)px\)/g) || []) {
    assert.ok(Number(/(\d+)/.exec(query)[1]) >= 1280,
      `the cockpit reaches below 1280px (${query}), into a layout that shipped and was not re-composed`);
  }
  // Both shipped narrow layouts still say exactly what they said: the two-rail
  // band from 1100px to 1279px, and the founder-first single-column stack.
  assert.ok(/\.command-shell\{grid-template-columns:300px minmax\(600px,1fr\);\s*grid-template-areas:"left center" "right right" "evidence evidence"\}/.test(code),
    'the 1100–1279px band lost the two-rail layout it shipped with');
  assert.ok(/\.command-shell\{grid-template-columns:1fr;grid-template-areas:"left" "center" "right" "evidence"\}/.test(code),
    'the single-column stack lost its left, center, right, evidence order');
  // The phone is not re-composed at all: the cockpit sets no shell tracks and no
  // rail rule there, and the 390px reading order is the one that shipped.
  assert.ok(!/\.command-shell\{[^}]*grid-template/.test(PHONE) && !/\.right-rail\{/.test(PHONE),
    'the cockpit re-composed the phone stack instead of leaving it exactly as it shipped');
  assert.ok(/\.brief-supporting\{display:flex;flex-direction:column;order:4\}/.test(PHONE) &&
    /\.event-panel\{order:1\}#evidence-rail\{order:2\}#raw-state\{order:3\}/.test(PHONE),
    'the 390px reading order changed while the wide cockpit was being seated');
});

test('the cockpit block seats boxes and does nothing else: no paint, no clamp, no motion, no words', () => {
  assert.ok(cockpitRules().length > 0, 'the cockpit block declares no rules');
  for (const rule of cockpitRules()) {
    const target = rule.selectors.join(',');
    for (const part of rule.body.split(';').map((s) => s.trim()).filter(Boolean)) {
      const prop = part.slice(0, part.indexOf(':')).trim().toLowerCase();
      assert.ok(COCKPIT_SEATING_ONLY.has(prop),
        `${target} declares ${prop}, which is not seating — composition may not repaint or re-read anything`);
    }
    assert.ok(!/display:none|visibility:|content-visibility:|-webkit-line-clamp|text-overflow/.test(rule.body),
      `${target} hides or truncates part of the cockpit instead of seating it`);
    assert.ok(!/!important/.test(rule.body), `${target} outranks a shipped state signal with !important`);
  }
  assert.ok(!/@keyframes/.test(COCKPIT) && !/\banimation\s*:/.test(COCKPIT) &&
    !/(?:^|;)\s*transition:(?!none)/.test(COCKPIT),
    'the cockpit introduced motion — it is an instrument panel, not decoration');
  for (const banned of ['gradient(', 'url(', 'image-set(', 'filter', 'backdrop-filter', 'content:',
    'setInterval', 'setTimeout', 'requestAnimationFrame', 'fetch(', 'AEGIS_STATE', '/api/']) {
    assert.ok(!COCKPIT.includes(banned),
      `the cockpit block uses ${banned} — it may only seat boxes the renderers already fill`);
  }
  // Only the two boxes the composition moves. A third selector here would be a
  // rail quietly editing an instrument it merely sits beside.
  const touched = new Set();
  for (const rule of cockpitRules()) for (const selector of rule.selectors) touched.add(selector);
  assert.deepStrictEqual([...touched].sort(), ['.command-shell', '.right-rail'],
    'the cockpit block reaches past the shell and the rail it seats');
});

test('the operator rail is the shipped Inspector, tools and Ask AEGIS — seated, never duplicated', () => {
  const source = htmlSrc();
  assert.strictEqual((source.match(/class="right-rail"/g) || []).length, 1,
    'a second operator rail would let two rails claim the same inspector and the same answer');
  const railStart = source.indexOf('class="right-rail"');
  const railEnd = source.indexOf('</aside>', railStart);
  assert.ok(railStart !== -1 && railEnd > railStart, 'the operator rail markup was not located');
  const rail = source.slice(railStart, railEnd);
  // Exactly the sections that shipped, in the order they shipped in.
  assert.strictEqual((rail.match(/<section\b/g) || []).length, 2,
    'the seated rail gained or lost a section instead of being seated as it is');
  assert.strictEqual((rail.match(/<details\b/g) || []).length, 1,
    'the seated rail gained or lost a disclosure instead of being seated as it is');
  assert.ok(rail.indexOf('id="inspector"') < rail.indexOf('id="integration-overview"') &&
    rail.indexOf('id="integration-overview"') < rail.indexOf('id="ask-aegis"'),
    'the operator rail no longer reads Inspector, then tools, then Ask AEGIS');
  // One of each on the whole page: seating may not become a copy.
  for (const id of ['inspector', 'integration-overview', 'ask-aegis', 'ask-aegis-answer',
    'ask-aegis-explain', 'ask-aegis-summarize', 'ask-aegis-next']) {
    assert.strictEqual((source.match(new RegExp('id="' + id + '"', 'g')) || []).length, 1,
      `${id} exists more than once, so two surfaces could answer differently`);
  }
  // Every control and every sentence the rail carries is the shipped one.
  for (const label of ['Explain status', 'Summarize', 'Next action']) {
    assert.ok(rail.includes('>' + label + '<'), `the seated rail lost the ${label} control`);
  }
  assert.ok(rail.includes('Select a command to explain the current evidence. ' +
    'This does not launch a model or modify the build.'),
  'the Ask AEGIS context sentence was rewritten while the rail was being seated');
  assert.ok(rail.includes('Select a route stage, connector or reviewer.'),
    'the Inspector empty-state sentence was rewritten while the rail was being seated');
  assert.ok(rail.includes('Tools &amp; integrations') && rail.includes('Loading connector evidence…'),
    'the tools context left the operator rail');
});

test('the cockpit reads brief, HUD, operator rail — with evidence, history, research and recovery below it', () => {
  const source = htmlSrc();
  const at = (needle) => {
    const idx = source.indexOf(needle);
    assert.notStrictEqual(idx, -1, `${needle} is missing from the command shell`);
    return idx;
  };
  assert.ok(at('class="left-rail"') < at('class="center-console"') &&
    at('class="center-console"') < at('class="right-rail"') &&
    at('class="right-rail"') < at('class="evidence-deck"'),
    'the three rails and the evidence deck are no longer in the shipped source order');
  // The centre leads with the HUD; the route, recovery, the receipts inspector
  // and the research surfaces stay under it.
  assert.ok(at('class="strategic-core"') < at('id="topology-overview"') &&
    at('id="topology-overview"') < at('id="recovery-deck"') &&
    at('id="recovery-deck"') < at('id="changes-receipts"') &&
    at('id="changes-receipts"') < at('id="research-report"'),
    'an evidence, recovery or research surface was promoted above the central HUD');
  assert.ok(at('class="evidence-deck"') < at('id="evidence-rail"') &&
    at('id="evidence-rail"') < at('id="raw-state"'),
    'the evidence rail or the deep machine state left the deck below the cockpit');
  // History stays where it shipped: collapsed, in the mission rail, under the
  // brief and the composer.
  const leftStart = at('class="left-rail"');
  const left = source.slice(leftStart, source.indexOf('</aside>', leftStart));
  assert.ok(left.indexOf('id="founder-summary"') < left.indexOf('id="objective-composer"') &&
    left.indexOf('id="objective-composer"') < left.indexOf('aria-labelledby="runs-h"'),
    'the mission rail no longer reads brief, composer, then collapsed history');
  assert.ok(/<details(?![^>]*\bopen\b)[^>]*aria-labelledby="runs-h"/.test(left),
    'run history was opened onto the first screen instead of staying collapsed below the cockpit');
});

// ── wide-screen lower operations deck ──────────────────────────────────────
// The cockpit above the fold was composed by the block proved above. Below it
// the same page still shipped a single file of seven full-width centre panels
// followed by a flat five-across evidence band, so on a wide desktop the
// answers an owner reads after the HUD — the handoff path, recovery, the
// recorded receipts, live activity, the research proposals, the decision
// queue, the event log, system health and the last safe checkpoint — arrived
// as a long stack of unrelated surfaces with most of the width empty beside
// each one.
//
// The failure a lower-deck composition invites is not ugliness, it is loss:
// a duplicated panel, an instrument squeezed under `overflow:hidden` until it
// is silently clipped, a visual order that no longer matches the DOM an
// assistive technology reads, a "layout" block that starts repainting state,
// or a narrower layout quietly re-composed on the way past. Every proof below
// therefore pairs "seated on the wide screen" with "the same single DOM, the
// same renderers, nothing squeezed, and nothing narrower touched".
const deckStart = code.indexOf('@media (min-width:1760px)');
const LOWER_DECK = deckStart === -1 ? '' : code.slice(deckStart, code.indexOf('\n  }', deckStart));

function lowerDeckRules() {
  const rules = [];
  for (const rule of LOWER_DECK.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    rules.push({ selectors: rule[1].split(',').map((s) => s.trim()).filter(Boolean), body: rule[2] });
  }
  return rules;
}

function lowerDeckDeclaration(selector, prop) {
  for (const rule of lowerDeckRules()) {
    if (!rule.selectors.includes(selector)) continue;
    const found = new RegExp('(?:^|;)\\s*' + prop + '\\s*:\\s*([^;]+)').exec(rule.body);
    if (found) return found[1].trim();
  }
  return null;
}

// The centre console in the order the DOM reads it. Read out of the markup
// rather than hardcoded, so a panel added, removed or moved fails the
// placement proof below instead of being ratified by a stale list.
function centreConsolePanels() {
  const source = htmlSrc();
  const start = source.indexOf('<div class="center-console">');
  assert.notStrictEqual(start, -1, 'the centre console was not located');
  const end = source.indexOf('<aside class="right-rail"', start);
  assert.ok(end > start, 'the centre console has no end boundary');
  const panels = [];
  for (const tag of source.slice(start, end).matchAll(/<section\b([^>]*)>/g)) {
    const id = /\bid="([^"]+)"/.exec(tag[1]);
    if (id) { panels.push(id[1]); continue; }
    const cls = /\bclass="([^"]+)"/.exec(tag[1]);
    assert.ok(cls, `a centre-console section carries neither an id nor a class: ${tag[0]}`);
    panels.push(cls[1].trim().split(/\s+/)[0]);
  }
  return panels;
}

// Seating, and nothing else. Every property this block may declare places a box
// that already exists; none of them paints, hides, clamps, times or renames
// anything inside it.
const LOWER_DECK_SEATING_ONLY = new Set(['display', 'grid-template-columns', 'align-items',
  'grid-column', 'min-width']);

test('the wide lower section is one operations deck: full-width bands, paired supporting surfaces, one log-led evidence band', () => {
  assert.ok(LOWER_DECK.length > 0, 'the wide-screen lower operations deck block was not located');
  assert.strictEqual((code.match(/@media \(min-width:1760px\)/g) || []).length, 1,
    'the lower deck is composed in more than one block, so two rules could disagree about where a panel sits');
  assert.strictEqual(lowerDeckDeclaration('.center-console', 'display'), 'grid',
    'the lower section is still a single file of full-width panels rather than a deck');
  assert.strictEqual(lowerDeckDeclaration('.center-console', 'grid-template-columns'),
    'repeat(2,minmax(0,1fr))',
    'the deck does not pair its supporting surfaces into two even, zero-floor tracks');
  // minmax(0,...) tracks cap the column, so every seated panel needs its own
  // zero floor too or it overflows a track that cannot grow — and every panel
  // on this page is overflow:hidden, which turns that into silent clipping.
  assert.strictEqual(lowerDeckDeclaration('.center-console>*', 'min-width'), '0',
    'a seated panel can overflow its own capped track and be clipped by the shipped overflow:hidden');
  // The evidence band leads with the log and still seats every shipped
  // instrument on one row: the spans must add up to the tracks exactly, or a
  // panel is pushed onto an orphan row that reads as a missing instrument.
  assert.strictEqual(lowerDeckDeclaration('.evidence-deck', 'grid-template-columns'),
    'repeat(6,minmax(0,1fr))', 'the evidence band did not gain the track the event log is widened into');
  assert.strictEqual(lowerDeckDeclaration('.event-panel', 'grid-column'), 'span 2',
    'the event log is still one of five equal slots instead of leading the band');
  assert.ok(/\.evidence-deck\{grid-template-columns:repeat\(5,minmax\(0,1fr\)\)\}/.test(code),
    'the shipped five-across evidence band was replaced instead of being re-seated at wide width only');
  assert.ok(/#evidence-rail\{grid-column:1\/-1/.test(code) && /#raw-state\{grid-column:1\/-1\}/.test(code),
    'the detail rail or the deep machine state now competes for a band track instead of spanning it');
});

test('the deck seats the handoff path, the route and the decision queue full width — nothing is squeezed or clipped', () => {
  const full = lowerDeckRules().find((rule) => /grid-column:1\/-1/.test(rule.body));
  assert.ok(full, 'the deck spans nothing full width, so every instrument is halved');
  assert.deepStrictEqual([...full.selectors].sort(),
    ['#decision-queue', '#topology-overview', '.strategic-core'],
    'the full-width band of the deck is not exactly the HUD with its handoff path, the exact route and the decision queue');
  // Why each of those three may never be halved, proved against the shipped
  // rule that would be truncated if it were.
  assert.ok(/\.core-path-track\{[^}]*grid-template-columns:repeat\(9,minmax\(0,1fr\)\)/.test(code),
    'the handoff path is no longer one nine-station row, so the band it is seated in proves nothing');
  assert.ok(/#topology-live-body\s+\.route-strip\s*\{[^}]*repeat\(11,minmax\(68px,1fr\)\)/.test(code),
    'the exact eleven-stage route is no longer one connected row, so its full-width band proves nothing');
  assert.ok(/\.command-shell section,\.command-shell details\.panel\{position:relative;overflow:hidden/.test(code),
    'panels are no longer overflow:hidden, so the reason the deck must not squeeze an instrument has moved');
  // The pairing must leave no empty cell: an orphaned half row reads as a panel
  // that failed to render. Simulated over the real DOM order.
  const panels = centreConsolePanels();
  const isFull = (name) => full.selectors.includes('#' + name) || full.selectors.includes('.' + name);
  const rows = [];
  for (const panel of panels) {
    const last = rows[rows.length - 1];
    if (isFull(panel)) { rows.push([panel]); rows.push([]); continue; }
    if (last && last.length === 1 && !isFull(last[0])) last.push(panel);
    else rows.push([panel]);
  }
  const laid = rows.filter((row) => row.length > 0);
  for (const row of laid) {
    assert.ok(row.length === 2 || isFull(row[0]),
      `${row[0]} is left alone in a half-width row, which reads as a panel that failed to render`);
  }
  assert.deepStrictEqual(laid.flat(), panels,
    'the deck lost, duplicated or reordered a centre-console panel while seating it');
});

test('the lower deck seats boxes and does nothing else: no paint, no clamp, no motion, no state, no words', () => {
  assert.ok(lowerDeckRules().length > 0, 'the lower deck block declares no rules');
  for (const rule of lowerDeckRules()) {
    const target = rule.selectors.join(',');
    for (const part of rule.body.split(';').map((s) => s.trim()).filter(Boolean)) {
      const prop = part.slice(0, part.indexOf(':')).trim().toLowerCase();
      assert.ok(LOWER_DECK_SEATING_ONLY.has(prop),
        `${target} declares ${prop}, which is not seating — composition may not repaint or re-read anything`);
    }
    assert.ok(!/display:none|visibility:|content-visibility:|-webkit-line-clamp|text-overflow|overflow:/.test(rule.body),
      `${target} hides or truncates part of the deck instead of seating it`);
    assert.ok(!/!important/.test(rule.body), `${target} outranks a shipped state signal with !important`);
  }
  // Visual order must stay reading order: `order` and dense packing both move a
  // panel on screen without moving it in the DOM, which is exactly how a
  // keyboard or screen-reader operator and a sighted one stop reading the same
  // deck. Neither may appear here.
  assert.ok(!/\border\s*:/.test(LOWER_DECK) && !/\bdense\b/.test(LOWER_DECK) &&
    !/grid-auto-flow|grid-row|grid-template-areas/.test(LOWER_DECK),
    'the deck re-orders panels on screen, so the visual deck and the DOM an assistive technology reads diverge');
  assert.ok(!/@keyframes/.test(LOWER_DECK) && !/\banimation\s*:/.test(LOWER_DECK) &&
    !/(?:^|;)\s*transition:(?!none)/.test(LOWER_DECK),
    'the lower deck introduced motion — it is an instrument panel, not decoration');
  for (const banned of ['gradient(', 'url(', 'image-set(', 'filter', 'backdrop-filter', 'content:',
    'setInterval', 'setTimeout', 'requestAnimationFrame', 'fetch(', 'AEGIS_STATE', '/api/']) {
    assert.ok(!LOWER_DECK.includes(banned),
      `the lower deck block uses ${banned} — it may only seat boxes the renderers already fill`);
  }
  const touched = new Set();
  for (const rule of lowerDeckRules()) for (const selector of rule.selectors) touched.add(selector);
  assert.deepStrictEqual([...touched].sort(),
    ['#decision-queue', '#topology-overview', '.center-console', '.center-console>*',
      '.event-panel', '.evidence-deck', '.strategic-core'],
    'the lower deck block reaches past the containers and the panels it seats');
});

test('the lower deck is wide-screen only: the cockpit, the 1100px band, the tablet stack and the 390px order are untouched', () => {
  assert.ok(!/@media \(max-width/.test(LOWER_DECK),
    'the deck block carries a max-width of its own, which is a second place for a width to be re-composed');
  for (const query of LOWER_DECK.match(/@media \(min-width:(\d+)px\)/g) || []) {
    assert.ok(Number(/(\d+)/.exec(query)[1]) >= 1760,
      `the lower deck reaches below 1760px (${query}), into a layout that shipped and was not re-composed`);
  }
  // 1760px is the floor because below it a half centre column is narrower than
  // the two 232px answer tracks recovery and the receipts inspector already
  // ship, so the pairing would cost an answer column instead of saving height.
  // If that shipped minimum ever moves, this floor has to be re-derived.
  assert.ok(/#rd-answers\{display:grid;grid-template-columns:repeat\(auto-fit,minmax\(232px,1fr\)\)/.test(code) &&
    /#cr-answers\{display:grid;grid-template-columns:repeat\(auto-fit,minmax\(232px,1fr\)\)/.test(code),
    'the answer-track minimum the 1760px floor was derived from has changed without the floor being re-derived');
  // The deck is declared after every narrower rule it must not outrank, and it
  // is the only place the centre console is ever laid out as a grid.
  assert.ok(deckStart > code.lastIndexOf('@media (max-width:680px)') &&
    deckStart > code.indexOf('@media (min-width:1280px)'),
    'the lower deck is declared ahead of a narrower layout, so a phone or the cockpit could inherit it');
  const stylesheet = code.slice(code.indexOf('<style'), code.indexOf('</style>'));
  const composed = [];
  for (const rule of stylesheet.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (/center-console/.test(rule[1]) && /display:grid/.test(rule[2])) composed.push(rule[1].trim());
  }
  assert.deepStrictEqual(composed, ['.center-console'],
    'the centre console is composed by more than one rule, so two widths could disagree about the deck');
  // Every shipped narrow layout still says exactly what it said.
  assert.ok(/\.command-shell\{grid-template-columns:300px minmax\(600px,1fr\);\s*grid-template-areas:"left center" "right right" "evidence evidence"\}/.test(code),
    'the 1100–1279px band lost the two-rail layout it shipped with');
  assert.ok(/\.command-shell\{grid-template-columns:1fr;grid-template-areas:"left" "center" "right" "evidence"\}/.test(code),
    'the single-column stack lost its left, center, right, evidence order');
  assert.ok(/\.evidence-deck\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)\}\.event-panel\{grid-column:span 2\}/.test(code) &&
    /\.evidence-deck\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}\.event-panel\{grid-column:span 2\}/.test(code),
    'a narrower evidence band was re-composed while the wide deck was being seated');
  assert.ok(/\.evidence-deck\{grid-template-columns:1fr\}\.event-panel\{grid-column:auto\}/.test(PHONE) &&
    /\.event-panel\{order:1\}#evidence-rail\{order:2\}#raw-state\{order:3\}/.test(PHONE),
    'the 390px evidence band or reading order changed while the wide deck was being seated');
  assert.ok(!/\.center-console\{/.test(PHONE) && !/\.command-shell\{[^}]*grid-template/.test(PHONE),
    'the lower deck re-composed the phone stack instead of leaving it exactly as it shipped');
});

test('the deck is the shipped surfaces re-seated: every answer still exists exactly once, from one renderer', () => {
  const source = htmlSrc();
  // One of each, page-wide: seating may never become a copy, because two
  // surfaces holding the same answer are two answers waiting to disagree.
  for (const id of ['core-path', 'core-path-track', 'core-path-note', 'topology-overview',
    'recovery-deck', 'rd-answers', 'changes-receipts', 'cr-answers', 'research-report',
    'decision-queue', 'decision-queue-list', 'live-activity', 'events',
    'hud-system-health', 'hud-decisions', 'hud-safe-checkpoint']) {
    assert.strictEqual((source.match(new RegExp('id="' + id + '"', 'g')) || []).length, 1,
      `${id} exists more than once, so two surfaces on the deck could answer differently`);
  }
  for (const cls of ['center-console', 'evidence-deck', 'live-panel', 'event-panel', 'strategic-core']) {
    assert.strictEqual((source.match(new RegExp('class="[^"]*\\b' + cls + '\\b[^"]*"', 'g')) || []).length, 1,
      `a second ${cls} would let two decks claim the same evidence`);
  }
  assert.strictEqual((source.match(/class="hud-summary"/g) || []).length, 3,
    'the deck gained or lost a summary instrument instead of re-seating the three that shipped');
  // The headings and empty-state sentences the deck seats are the shipped ones.
  for (const words of ['Handoff path', 'Live activity', 'Event history', 'Marc decision queue',
    'System health', 'Decisions required', 'Last safe checkpoint',
    'Waiting for the first status push.', 'Recorded checkpoint evidence only.',
    'HANDOFF PATH UNAVAILABLE — no canonical run state is loaded.']) {
    assert.ok(source.includes(words), `the deck rewrote or dropped "${words}" while being seated`);
  }
  // Still one canonical renderer per surface, still driven by the single pass
  // the cockpit is driven by: a deck may not become a second source of truth.
  for (const fn of ['renderCorePath', 'renderEvidenceRail', 'renderFounderSummary']) {
    assert.strictEqual((code.match(new RegExp('function ' + fn + '\\b', 'g')) || []).length, 1,
      `${fn} was duplicated, which is a second renderer for a surface the deck seats`);
  }
  assert.ok(/renderCorePath\(boundRun, provenHandoff\);/.test(code),
    'the seated handoff path is no longer driven by the single handoff the indicator proved');
});

async function atest(name, fn) {
  try { await fn(); passed++; console.log(`ok   ${name}`); }
  catch (e) { console.error(`FAIL ${name}: ${e.message}`); process.exitCode = 1; }
}

asyncTests().then(() => {
  const failedCount = process.exitCode ? 'at least 1' : '0';
  console.log(`${passed} passed, ${failedCount} failed.`);
});
