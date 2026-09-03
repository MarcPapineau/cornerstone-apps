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

test('the JARVIS shell has no CSS animation or decorative motion loop', () => {
  const keyframes = code.match(/@keyframes\s+([\w-]+)/g) || [];
  assert.strictEqual(keyframes.length, 0, `expected no keyframes block, found ${keyframes.length}`);
  assert.ok(!/\banimation\s*:/.test(code), 'CSS animation found — state must be legible without motion');
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
  const gridEnd = code.indexOf('host.appendChild(commandGrid)', gridStart);
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
  const end = code.indexOf('host.appendChild(commandGrid)', start);
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
    focus() {},
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
    getElementById(id) {
      if (!byId.has(id)) { const n = makeNode('div'); n.attrs.id = id; byId.set(id, n); }
      return byId.get(id);
    },
    createElement: (t) => makeNode(t),
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
        set onerror(_f) {}, set onopen(_f) {},
      };
    },
  };
  sandbox.window = sandbox;
  sandbox.window.AEGIS_STATE = state;
  sandbox.window.matchMedia = () => ({ matches: false });
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
  assert.match(fields['crew-/-model'], /claude-opus-5 via claude-cli · router-selected/,
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
  assert.match(unavailableCard.textContent, /Current control-plane status is unavailable/);
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
  const expected = 'Checkpoint CHK-20260829-001 · rollback commit 0123456789abcdef0123456789abcdef01234567';
  assert.ok(page.text('founder-body').includes(expected),
    'the pilot deck did not render the checkpoint receipt from the public contract');
  assert.strictEqual(page.text('hud-checkpoint'), expected);
  assert.strictEqual(page.text('hud-safe-checkpoint'), expected);
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
    code.indexOf('host.appendChild(commandGrid)'));
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
  assert.match(text, /tool-router\.cjs routeRole/,
    'the card does not attribute the selection to the canonical routing authority');
  assert.match(text, /claude-cli/, 'the card does not name the recorded execution path');
  assert.match(text, /No selection reason is recorded[\s\S]*UNAVAILABLE/,
    `a recorded selection reason was invented: ${text}`);
  assert.doesNotMatch(text, /capabilit|cost|cheap|fallback|failover|fastest|best/i,
    `the card claimed a capability, cost or fallback fact: ${text}`);
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
    code.indexOf('host.appendChild(commandGrid)'));
  assert.strictEqual((grid.match(/commandCard\('LIVE EVIDENCE'/g) || []).length, 1,
    'the live evidence instrument must appear exactly once in the primary pilot deck');
  assert.ok(grid.indexOf("commandCard('CURRENT ACTION'") < grid.indexOf("commandCard('LIVE EVIDENCE'") &&
    grid.indexOf("commandCard('LIVE EVIDENCE'") < grid.indexOf("commandCard('NEXT STEP'"),
    'the live evidence instrument was separated from CURRENT ACTION by other pilot cards');
  const fn = code.slice(code.indexOf('function liveEvidence'), code.indexOf('function missionHeadline'));
  assert.ok(fn.length > 0, 'no liveEvidence() boundary found');
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
    assert.doesNotMatch(next, /^Resolve the recorded control-plane blocker before continuing\.$/);
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
      { label: 'unavailable engineering', engineering: { state: 'UNAVAILABLE' },
        expected: /Resolve the recorded control-plane blocker before continuing/,
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
      assert.ok((scenario.controlBlocked
        ? /Resolve the recorded control-plane blocker before continuing|Get [a-z0-9._-]+ to review this exact change/i
        : /Independent-review evidence is not yet complete or its status is unavailable/).test(
          guarded.text('founder-body')),
      `${scenario.label} did not retain the fail-closed founder explanation`);
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
}

async function atest(name, fn) {
  try { await fn(); passed++; console.log(`ok   ${name}`); }
  catch (e) { console.error(`FAIL ${name}: ${e.message}`); process.exitCode = 1; }
}

asyncTests().then(() => {
  const failedCount = process.exitCode ? 'at least 1' : '0';
  console.log(`${passed} passed, ${failedCount} failed.`);
});
