#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const CLI = path.join(ROOT, 'builder-control', 'tool-router.cjs');
const REAL = path.join(ROOT, 'builder-control', 'TOOL-CAPABILITY-CANON.json');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-router-test-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {} });

let passed = 0;
let failed = 0;

function run(args) {
  const r = spawnSync('node', [CLI, ...args], { cwd: ROOT, encoding: 'utf8' });
  return { exit: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}

function expect(name, args, exit, contains) {
  const r = run(args);
  const ok = r.exit === exit && [].concat(contains).every((s) => r.out.includes(s));
  if (ok) { passed++; console.log(`ok   ${name}`); }
  else { failed++; console.error(`FAIL ${name}\n${r.out}`); }
}

function fixture(mutator) {
  const canon = JSON.parse(fs.readFileSync(REAL, 'utf8'));
  mutator(canon);
  const file = path.join(TMP, `canon-${Date.now()}-${Math.random()}.json`);
  fs.writeFileSync(file, JSON.stringify(canon, null, 2));
  return file;
}

console.log('AEGIS Tool Router — rule fixtures');

expect('real canon validates', ['--validate'], 0, ['TOOL CANON VALID', 'default metered budget $0']);
expect('video blocks while OpenArt is unverified', ['--task', 'media.video-generate'], 3, ['SPECIALIST_REQUIRED', 'openart-video', 'UNVERIFIED']);
expect('advertising blocks rather than falling back to Claude', ['--task', 'marketing.advertising'], 3, ['SPECIALIST_REQUIRED', 'advertising-specialist-slot', 'disabled']);
expect('unknown task refuses routing', ['--task', 'something.unknown'], 3, 'UNKNOWN_TASK');

const openArtAvailable = fixture((canon) => {
  const tool = canon.tools.find((t) => t.toolId === 'openart-video');
  tool.availability = 'AVAILABLE';
  tool.costClass = 'INCLUDED';
});
expect('verified OpenArt is selected for video', ['--canon', openArtAvailable, '--task', 'media.video-generate'], 0, ['ROUTE: openart-video', 'DESKTOP_ASSISTED']);

const meteredOpenArt = fixture((canon) => {
  const tool = canon.tools.find((t) => t.toolId === 'openart-video');
  tool.availability = 'AVAILABLE';
  tool.costClass = 'METERED';
});
expect('metered tool blocks under the zero-dollar default', ['--canon', meteredOpenArt, '--task', 'media.video-generate'], 3, ['SPECIALIST_REQUIRED', 'no explicit budget authorization']);
// CONFIRMED FINDING #5 tightened this contract: --allow-metered alone no
// longer authorizes spending. It now additionally requires a named human and a
// cap inside the policy ceiling, so this case asserts BOTH halves — the bare
// boolean is refused, and the fully-authorized form routes.
expect('RED: --allow-metered ALONE no longer authorizes metered execution', ['--canon', meteredOpenArt, '--task', 'media.video-generate', '--allow-metered'], 3, ['SPECIALIST_REQUIRED', 'named human']);
expect('metered routes only with a named human and a cap', ['--canon', meteredOpenArt, '--task', 'media.video-generate', '--allow-metered', '--approved-by', 'Marc Papineau', '--cap-usd', '2'], 0, ['ROUTE: openart-video', 'METERED']);
expect('RED: a cap above the policy ceiling is refused', ['--canon', meteredOpenArt, '--task', 'media.video-generate', '--allow-metered', '--approved-by', 'Marc Papineau', '--cap-usd', '9999'], 3, ['SPECIALIST_REQUIRED', 'ceiling']);
expect('data ceiling is enforced', ['--canon', openArtAvailable, '--task', 'media.video-generate', '--data-class', 'CONFIDENTIAL'], 3, ['SPECIALIST_REQUIRED', 'exceeds INTERNAL']);

console.log(`${passed} passed, ${failed} failed.`);
process.exit(failed ? 1 : 0);
