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
  assert.ok(/chip\(identity\.build\)/.test(renderer) && /chip\(identity\.state\)/.test(renderer),
    'the identity line no longer paints both the build and the gate reading');
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
  assert.ok(/\.strategic-core\{min-height:0\}/.test(WIDE) && /\.core-stage\{min-height:0;gap:10px\}/.test(WIDE),
    'the HUD keeps the fixed 510px/430px reserve that spends the first screen on empty panel');
  assert.ok(/\.aegis-core\{width:148px;height:148px/.test(WIDE),
    'the AEGIS Core keeps a diameter that alone sets the middle HUD row taller than the fold');
  assert.ok(/\.ops-cell\{display:flex;flex-wrap:wrap;[^}]*padding:6px 9px\}/.test(WIDE) &&
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
  assert.ok(/mission\.appendChild\(chip\(controlState\.state\)\)/.test(code),
    'the labelled gate-readiness chip was dropped instead of moved to its own row');
  assert.ok(/el\('div','mission-meta','Gate readiness: ' \+ controlState\.state \+/.test(code) &&
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
  assert.ok(/\.strategic-core\{min-height:0\}/.test(WIDE) && /\.core-stage\{min-height:0;gap:10px\}/.test(WIDE) &&
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
    assert.ok(new RegExp("hudText\\('" + id + "'").test(code),
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
  assert.strictEqual(page.text('hud-core-status'), 'UNAVAILABLE',
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
  assert.strictEqual(page.text('hud-core-status'), 'IDLE');
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
  assert.strictEqual(page.text('hud-core-status'), 'UNAVAILABLE');
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
  assert.strictEqual(page.text('hud-core-status'), 'BLOCKED',
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
      assert.notStrictEqual(page.text('hud-core-status'), 'COMPLETE',
        `${scenario.label}: AEGIS Core falsely reported current completion`);
    } else {
      assert.strictEqual(page.text('hud-core-status'), 'COMPLETE',
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
  assert.strictEqual(page.text('hud-checkpoint-state'), 'RECORDED',
    'the HUD checkpoint state word drifted from the checkpoint resolution beside it');
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
    assert.strictEqual(page.text('hud-core-status'), 'UNAVAILABLE',
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
  assert.strictEqual(none.text('hud-checkpoint-state'), 'NOT RECORDED');
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
  assert.strictEqual(page.text('hud-checkpoint-state'), 'BLOCKED',
    'the HUD state word disagreed with the blocked sentence beside it');

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
function missionMetaText(page) {
  const node = allNodes(page.document.getElementById('founder-body'))
    .find((n) => n.className === 'mission-meta');
  assert.ok(node, 'the mission line lost its status summary');
  return node.textContent;
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
    const meta = missionMetaText(page);
    const hud = page.text('hud-mission-state');
    assert.match(meta, /^Gate readiness: [A-Z_]+ · Run lifecycle: [A-Z_]+/,
      `${name}: the mission line no longer distinguishes the gate from the worker: ${meta}`);
    assert.match(hud, /^GATE READINESS [A-Z_]+ · RUN LIFECYCLE [A-Z_]+$/,
      `${name}: the HUD mission state is not the labelled state pair: ${hud}`);
    assert.ok(hud.startsWith('GATE READINESS ' + page.text('hud-core-status')),
      `${name}: the HUD mission module reports a different gate verdict than the core: ${hud}`);
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
  assert.strictEqual(missionMetaText(failed), 'Gate readiness: BLOCKED · Run lifecycle: BLOCKED',
    'a run whose gate and lifecycle agree still carries a duplicated paragraph');
  assert.strictEqual(briefField(failed, 'now').value,
    'The builder exceeded its fixed time limit. No replacement builder handoff is recorded.',
    'the recorded timeout and handoff evidence was lost with the duplicate text');

  // Gate and lifecycle disagree: the gate refusal is the brief's answer, and
  // the lifecycle sentence the brief does not carry stays on the mission line.
  const gate = bootPage(gateUnavailableFixture());
  assert.strictEqual(missionMetaText(gate),
    'Gate readiness: UNAVAILABLE · Run lifecycle: WAITING — Deterministic checks passed with ' +
    'final required evidence; the run is waiting for independent review evidence.',
    'the run lifecycle explanation was dropped instead of de-duplicated');
  assert.match(briefField(gate, 'needs-marc').value, /Not confirmed — AEGIS cannot yet show/,
    'the fail-closed gate refusal was softened out of the brief');

  const unknown = bootPage(fixtureState());
  renderMinimizedStatus(unknown, briefUnreadableLedgerStatus());
  assert.strictEqual(missionMetaText(unknown),
    'Gate readiness: UNAVAILABLE · Run lifecycle: IDLE — Nothing is currently running.',
    'an unreadable ledger reported something other than the two canonical states');
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
  assert.strictEqual(page.text('hud-core-status'), 'BLOCKED',
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
  assert.strictEqual(page.text('hud-core-status'), 'RUNNING',
    'the core cue moved the canonical core status word');
  assert.strictEqual(page.text('hud-gate-state'), 'BLOCKED',
    'a cue for new worker evidence turned a blocking gate into a passing one');
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
    assert.strictEqual(page.text('hud-core-status'), 'RUNNING');
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
    assert.strictEqual(page.text('hud-core-status'), 'UNAVAILABLE');
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
    assert.strictEqual(page.text('hud-core-status'), 'WAITING');
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
    assert.strictEqual(page.text('hud-review-state'), 'REVIEW EVIDENCE STALE OR MISMATCHED');
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
    assert.ok(/reviews run outside this functional-beta dashboard/.test(page.text('runs-list')),
      'the UI does not explain the external review boundary');
    assert.ok(/does not launch or pay for a review/.test(page.text('runs-list')),
      'the UI can be read as launching or spending on a review');
    await review._listeners.click[0]();
    assert.strictEqual(review.disabled, true, 'review verification must disable while awaiting lifecycle evidence');
    assert.strictEqual(review.textContent, 'Verifying review evidence…');
    const call = calls.find((c) => c.path === '/api/review-bind');
    assert.ok(call, 'review verification did not call the canonical HTTP route');
    assert.deepStrictEqual(JSON.parse(call.options.body), { runId: 'RUN-REVIEW' },
      'dashboard sent fields beyond exact runId authority boundary');
    assert.ok(/waiting for live lifecycle evidence/.test(page.text('live-activity')),
      'the bind response was not treated as pending SSE evidence');
    assert.ok(/No review was launched by this dashboard/.test(page.text('live-activity')),
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
    assert.ok(/checkpoint control is not exposed/.test(page.text('runs-list')),
      'the functional-beta checkpoint boundary is missing');
    assert.ok(!nodes.some((n) => n.tagName === 'BUTTON' && /Verify independent review/.test(n.textContent)),
      'the CHECKS_PASSED-only action survived after SSE advanced the run');
    assert.ok(!nodes.some((n) => n.tagName === 'BUTTON' && /checkpoint/i.test(n.textContent)),
      'checkpoint control was exposed outside this packet');
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
    assert.strictEqual(page.text('hud-core-status'), 'BLOCKED');
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
    assert.strictEqual(page.text('hud-core-status'), 'BLOCKED');
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
    assert.ok(/Now: The build finished and is waiting for deterministic checks\./.test(text),
      `the current task is not stated in plain English: ${text}`);
    assert.ok(/canonical BUILDING → BUILT, run record written 2026-08-28T10:03:00\.000Z/.test(text),
      `the exact canonical states and the record timestamp are not cited: ${text}`);
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
    assert.ok(/does not launch or pay for reviews/.test(nextStep.textContent),
      `the bind action drops the no-launch boundary: ${nextStep.textContent}`);
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
    assert.strictEqual(page.text('hud-review-state'), 'EVIDENCE APPEARS READY FOR SERVER VERIFICATION',
      'the HUD falsely reports proven bind readiness before server verification');
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
        assert.ok(/does not launch or pay for reviews/.test(alternateNext.textContent),
          `${scenario.label} suppressed the bind-only boundary: ${alternateNext.textContent}`);
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
        'EVIDENCE APPEARS READY FOR SERVER VERIFICATION',
        `${scenario.label} lit the HUD server-verification readiness signal`);
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
      assert.strictEqual(alternate.text('hud-review-state'), scenario.hud,
        `${scenario.label} HUD misstates subject binding`);
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
    assert.strictEqual(boundPage.text('hud-review-state'), 'REVIEW COVERAGE COMPLETE',
      'the post-bind HUD does not report completed exact-subject review coverage');
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
    assert.ok(/does not launch or pay for reviews/.test(missingNext.textContent),
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
    assert.ok(/No review was launched by this dashboard/.test(activity),
      `the bind result drops the no-launch boundary: ${activity}`);
    assert.ok(!/\b(?:launched|started|commissioned)\s+(?:an?\s+)?(?:independent\s+)?review\b/i.test(
      activity.replace(/No review was launched by this dashboard/g, '')),
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

  function assertChipShape(chipNode, state, label) {
    assert.ok(chipNode, `the identity line has no ${label} chip`);
    assert.strictEqual(chipNode.children.length, 2,
      `the ${label} chip must carry a glyph and a written state, not colour alone`);
    assert.ok(chipNode.children[0].textContent.trim().length > 0,
      `the ${label} chip glyph is empty, leaving colour as the only shape`);
    assert.strictEqual(chipNode.children[1].textContent, state,
      `the ${label} chip does not write out its canonical state`);
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
    assert.strictEqual(line.fields.canonical.textContent, 'BUILDING',
      'the identity line does not carry the recorded canonical lifecycle state');
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
    assert.strictEqual(line.fields.canonical.textContent, 'REVIEW_FAILED',
      'the recorded canonical state of the displayed run is missing');
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
    assert.strictEqual(line.fields.canonical.textContent, 'UNAVAILABLE');
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
    assert.strictEqual(line.fields.canonical.textContent, 'CHECKS_PASSED',
      'the recorded canonical lifecycle state of the finished worker is missing');
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
    assert.strictEqual(page.text('hud-core-status'), 'BLOCKED');
    assert.match(code, /<div class="core-sub">Gate readiness<\/div>\s*<div class="core-status" id="hud-core-status">/,
      'the core does not name which question its state word answers');
  });

  await atest('DOM: a running worker and an unbound run state the worker plainly, not the gate', async () => {
    const running = JSON.parse(JSON.stringify(REVIEW_PENDING_STATUS));
    running.runs[0].state = 'BUILDING';
    running.runs[0].build = { status: 'RUNNING', activity: { active: true, summary: 'Editing the dashboard renderer.' } };
    const live = bootPage(fixtureState(), { status: running });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    assert.match(live.text('hud-crew-state'), /^RUNNING — /,
      `an active worker was not stated as running: ${live.text('hud-crew-state')}`);

    // No bound run: unknown is stated plainly, and nothing claims live work.
    const unbound = JSON.parse(JSON.stringify(REVIEW_PENDING_STATUS));
    unbound.runsBinding = { state: 'UNAVAILABLE', runId: null, reason: 'no run ledger binding is recorded' };
    unbound.runs = [];
    const idle = bootPage(fixtureState(), { status: unbound });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    const idleCrew = idle.text('hud-crew-state');
    assert.match(idleCrew, /NO ACTIVE WORKER/, `a missing worker was not stated plainly: ${idleCrew}`);
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

async function atest(name, fn) {
  try { await fn(); passed++; console.log(`ok   ${name}`); }
  catch (e) { console.error(`FAIL ${name}: ${e.message}`); process.exitCode = 1; }
}

asyncTests().then(() => {
  const failedCount = process.exitCode ? 'at least 1' : '0';
  console.log(`${passed} passed, ${failedCount} failed.`);
});
