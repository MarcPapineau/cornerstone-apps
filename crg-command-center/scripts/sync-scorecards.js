#!/usr/bin/env node
/**
 * sync-scorecards.js
 *
 * Reads every JSON scorecard from the cornerstone-research-group repo
 * (01-CORNERSTONE-RESEARCH-GROUP/agents/scorecards/*.json) and writes
 * a single aggregated JSON array to data/scorecards.json in the Garvis
 * command-center repo so the command-scorecards Netlify function can
 * serve it at runtime.
 *
 * Intended to be run manually, by the Levite rotation job, or in CI
 * whenever scorecards change. At runtime, the Netlify function only
 * reads the aggregated file — it never touches the source repo, which
 * is not reachable from a Netlify function container.
 *
 * Usage:
 *   node scripts/sync-scorecards.js
 *     [--source <path to scorecards dir>]
 *     [--out <path to data/scorecards.json>]
 */
const fs = require('fs');
const path = require('path');

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}

const SRC = arg(
  '--source',
  path.resolve(
    __dirname,
    '..',
    '..',
    '01-CORNERSTONE-RESEARCH-GROUP',
    'agents',
    'scorecards'
  )
);
const OUT = arg(
  '--out',
  path.resolve(__dirname, '..', 'data', 'scorecards.json')
);

function main() {
  if (!fs.existsSync(SRC)) {
    console.error('[sync-scorecards] source dir not found:', SRC);
    process.exit(1);
  }
  const files = fs
    .readdirSync(SRC)
    .filter((f) => f.endsWith('.json'))
    .sort();

  const scorecards = [];
  for (const f of files) {
    const p = path.join(SRC, f);
    try {
      const raw = fs.readFileSync(p, 'utf8');
      const obj = JSON.parse(raw);
      if (obj && obj.agent_id) scorecards.push(obj);
    } catch (err) {
      console.warn('[sync-scorecards] skip', f, err.message);
    }
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const payload = {
    synced_at: new Date().toISOString(),
    source: path.relative(path.resolve(__dirname, '..'), SRC),
    count: scorecards.length,
    scorecards
  };
  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2) + '\n');
  console.log(
    '[sync-scorecards] wrote',
    scorecards.length,
    'scorecards →',
    OUT
  );
}

main();
