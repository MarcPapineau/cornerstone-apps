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
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const DIR = path.join(ROOT, 'builder-control', 'dashboard');
const HTML_PATH = path.join(DIR, 'index.html');
const STATE_PATH = path.join(DIR, 'state.js');
// Read fresh each time: a cached copy would let a proof pass against a page
// that no longer exists on disk.
const htmlSrc = () => fs.readFileSync(HTML_PATH, 'utf8');

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
  assert.ok(fs.existsSync(STATE_PATH), 'state.js missing — regenerate with aegis-state.cjs --out');
  const s = fs.readFileSync(STATE_PATH, 'utf8');
  assert.ok(/Generated by builder-control\/aegis-state\.cjs/.test(s), 'state.js lacks its generator header');
  assert.ok(/do not edit by hand/i.test(s));
  const json = JSON.parse(s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1));
  assert.deepStrictEqual(json.contract.absences, ['UNAVAILABLE', 'STALE', 'UNVERIFIED']);
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
  const state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')
    .replace(/^[\s\S]*?window\.AEGIS_STATE = /, '').replace(/;\s*$/, ''));
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
  const state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')
    .replace(/^[\s\S]*?window\.AEGIS_STATE = /, '').replace(/;\s*$/, ''));
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
  assert.ok(/missionText\.appendChild\(el\('h3','mission-title',deckObjective\)\)/.test(code),
    'the current mission is not the primary operator title');
  assert.ok(/Build sequence/.test(code), 'no founder-facing build sequence exists');
  assert.ok(/routeCrew\.appendChild\(el\('span','command-label','Crew \/ model'\)\)/.test(code),
    'the visual route does not identify its selected crew or model');
  assert.ok(/Evidence, reviewer coverage & run history/.test(code),
    'dense evidence is not available behind a founder-readable disclosure');
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
    runs: { state: 'OK', runs: [], current: { state: 'UNAVAILABLE', reason: 'no run records exist yet, so no run is current.' } },
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
    'Get grok to review this exact change.',
    '1 unresolved gate requirement',
    'No safe checkpoint is recorded for this run.',
  ]) {
    assert.ok(body.includes(phrase), `running pilot deck is missing: ${phrase}`);
  }
  assert.ok(!/Claude|Opus/.test(body), 'the dashboard inferred a model that current run evidence does not name');
  assert.strictEqual(page.document.getElementById('operator-shell').attrs['data-run-status'], 'running');
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
    const body = bootPage(state).text('founder-body');
    assert.ok(/Blocking status unavailable/.test(body), `${c.name}: blocking status was presented as known`);
    assert.ok(c.reason.test(body), `${c.name}: the binding failure reason is missing: ${body}`);
    assert.ok(!/Nothing is blocking this run\./.test(body), `${c.name}: rendered a false clear signal`);
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
  const state = fixtureState({ engineering: Object.assign(fixtureState().engineering, {
    reviewerCompleteness: { complete: false, rows: [
      { reviewer: 'codex', job: 'correctness reviewer', required: 'REQUIRED', executed: 'EXECUTED',
        disposition: 'REJECT', score: '1/2 subject path(s) covered',
        coveredPaths: ['a.cjs'], missingPaths: ['b.cjs'], stalePaths: ['gone.cjs'], reason: 'r' },
      { reviewer: 'grok', job: 'adversarial reviewer', required: 'REQUIRED', executed: 'MISSING',
        disposition: null, score: 'UNAVAILABLE', coveredPaths: [], missingPaths: ['a.cjs', 'b.cjs'], stalePaths: [], reason: 'r' },
    ] } }) });
  const body = bootPage(state).text('founder-body');
  assert.ok(/Risk tier: FULL \(high-risk\)/.test(body), 'the risk tier and high-risk flag are not stated');
  assert.ok(/a high-risk signal is present/.test(body), 'the classifier reason for the tier is not shown');
  assert.ok(/touches a protected path/.test(body), 'the risk reason is not shown');
  assert.ok(/codex/.test(body) && /grok/.test(body), 'reviewer names are not shown');
  assert.ok(/rejected it/.test(body), 'the reviewer disposition is not in plain English');
  assert.ok(/1\/2 subject path\(s\) covered/.test(body), 'the reviewer score is not shown');
  assert.ok(/has not reviewed this change/.test(body), 'a missing required review is not stated plainly');
  // covered / not read / no-longer-part-of-this-change, all three
  assert.ok(/Read: a\.cjs/.test(body), 'covered paths missing');
  assert.ok(/Not read: b\.cjs/.test(body), 'missing paths missing');
  assert.ok(/gone\.cjs/.test(body), 'stale paths missing');
});

test('RED: an absent reviewer table renders UNAVAILABLE, never "complete"', () => {
  const eng = Object.assign(fixtureState().engineering, { reviewerCompleteness: null });
  const body = bootPage(fixtureState({ engineering: eng })).text('founder-body');
  assert.ok(/reviewer coverage is unknown/.test(body), 'a missing reviewer table must read as unknown coverage');
  assert.ok(!/Every required reviewer read every changed file/.test(body), 'unknown coverage rendered as complete');
});

// ── FINDING #2: the exact coverage sentence has to reach the screen ────────
// The gate computes one founder-readable sentence naming which reviewer fell
// short, how, and what to re-run. Hosting already carries it as
// engineering.reviewerCompleteness.completeReason. These proofs hold that the
// panel BINDS that field rather than paraphrasing it, and that it stays text.
function rcFixture(completeReason, over) {
  return fixtureState({ engineering: Object.assign(fixtureState().engineering, {
    reviewerCompleteness: Object.assign({
      complete: false,
      completeReason,
      rows: [
        { reviewer: 'codex', job: 'correctness reviewer', required: 'REQUIRED', executed: 'EXECUTED',
          disposition: 'APPROVE', score: '1/2 subject path(s) covered',
          coveredPaths: ['a.cjs'], missingPaths: ['b.cjs'], stalePaths: [], reason: 'r' },
      ],
    }, over || {}) }) });
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
  assert.ok(/Not every required reviewer has read every changed file/.test(body),
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
  assert.ok(!/Every required reviewer read every changed file/.test(body),
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

// ── FINDING #7 RED PROOF: the summary must REPAINT from the live stream ────
// The panel used to render once from the generated snapshot and never again,
// so a founder watching the page saw an old objective and an old verdict
// presented as current. This drives the page exactly as the server does: an
// authenticated /api/status bootstrap, then a pushed `status` SSE event.
async function asyncTests() {
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

  await atest('DOM: Start reports the governed worker was launched, not merely prepared', async () => {
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
    assert.ok(/Worker launched: BUILDING/.test(message), `Start did not state that the worker launched: ${message}`);
    assert.ok(/PID 4321/.test(message), 'Start did not render returned worker ownership evidence');
    assert.ok(!/has NOT been launched|Worktree prepared at/.test(message),
      'retired synchronous Start messaging is still rendered');
    assert.strictEqual(calls.filter((c) => c.path === '/api/start').length, 1,
      'Start must issue exactly one launch request');
  });

  await atest('DOM: deterministic checks are BUILT-only and repaint to CHECKS_PASSED only from SSE', async () => {
    const built = {
      generatedAt: '2026-08-27T16:00:00.000Z',
      engineering: { state: 'UNAVAILABLE' },
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
      engineering: { state: 'UNAVAILABLE' },
      runsBinding: { state: 'BOUND', runId: 'RUN-REVIEW', updatedAt: '2026-08-27T16:05:00.000Z', reason: 'bound' },
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

  await atest('DOM: canonical review refusal is shown without claiming a review ran', async () => {
    const checked = {
      generatedAt: '2026-08-27T16:06:00.000Z', engineering: { state: 'UNAVAILABLE' },
      runsBinding: { state: 'BOUND', runId: 'RUN-REFUSED', updatedAt: '2026-08-27T16:06:00.000Z', reason: 'bound' },
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

  await atest('DOM: BUILDING Cancel requires verified async ownership, disables pending, then repaints from SSE', async () => {
    const base = {
      generatedAt: '2026-08-26T12:00:00.000Z',
      engineering: { state: 'UNAVAILABLE' },
      runsBinding: { state: 'BOUND', runId: 'RUN-BUILD', updatedAt: '2026-08-26T12:00:00.000Z', reason: 'bound' },
      integration: { connectors: [] },
    };
    const noOwner = Object.assign({}, base, { runs: [{ runId: 'RUN-BUILD', state: 'BUILDING', objective: 'Dashboard',
      build: { mode: 'async', status: 'RUNNING', workerPid: null,
        activity: { code: 'RUNNING', phase: 'RUNNING', active: true, summary: 'Builder is running' },
        heartbeatAt: '2026-08-26T12:00:01.000Z', timedOut: false } }] });
    const unownedPage = bootPage(fixtureState(), { status: noOwner });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    const unownedButtons = allNodes(unownedPage.document.getElementById('runs-list'))
      .filter((n) => n.tagName === 'BUTTON' && /^Cancel/.test(n.textContent));
    assert.strictEqual(unownedButtons.length, 0, 'BUILDING without a verified worker PID must not expose Cancel');

    const running = JSON.parse(JSON.stringify(noOwner));
    running.runs[0].build.workerPid = 2468;
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
    assert.ok(/Ready to open a pull request/.test(after), 'the pushed verdict did not repaint');
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
}

async function atest(name, fn) {
  try { await fn(); passed++; console.log(`ok   ${name}`); }
  catch (e) { console.error(`FAIL ${name}: ${e.message}`); process.exitCode = 1; }
}

asyncTests().then(() => {
  const failedCount = process.exitCode ? 'at least 1' : '0';
  console.log(`${passed} passed, ${failedCount} failed.`);
});
