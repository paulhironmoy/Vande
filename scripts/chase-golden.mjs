#!/usr/bin/env node
/**
 * Determinism checks of the chase (definition of done CHC-02): tuples of (seed, difficulty, input policy, assistance, hand)
 * are played through the physics and reduced to a hash.
 *
 *   node scripts/chase-golden.mjs generate --out <golden.json> [--tuples 320]   # make the checked-in golden set
 *   node scripts/chase-golden.mjs check --golden <golden.json> [--limit N]      # play them again in Node and compare
 *   node scripts/chase-golden.mjs repeat [--tuples 1000] [--from 0]             # play 1,000 tuples twice, compare (--from: skip the first k)
 *   node scripts/chase-golden.mjs chromium --golden <golden.json> [--limit N]   # play them in headless Chromium, compare
 *
 * Run under the shared-machine wrapper (`sh <scratch>/heavy.sh chase-golden node scripts/chase-golden.mjs ...`). One tuple is
 * about 0.1 s of physics. Deterministic: no random number, no clock.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import './simulate-loader.mjs';
import { repoRoot } from './simulate-loader.mjs';

const args = process.argv.slice(2);
const command = args[0];
const arg = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const G = await import('../tests/unit/practice/chase/golden.ts');
const uptime = () => {
  try {
    return execFileSync('uptime', { encoding: 'utf8' }).trim();
  } catch {
    return 'unavailable';
  }
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

if (command === 'generate') {
  const n = Number(arg('tuples', 320));
  const out = arg('out');
  if (!out) throw new Error('--out <file> is required');
  const t0 = Date.now();
  const rows = G.goldenTuples(n).map((t) => ({ ...t, ...G.runTuple(t) }));
  writeFileSync(out, `${JSON.stringify({ made: 'node', tuples: rows.length, rows })}\n`);
  const results = {};
  for (const r of rows) results[r.result] = (results[r.result] ?? 0) + 1;
  console.log(`wrote ${rows.length} tuples to ${out} in ${((Date.now() - t0) / 1000).toFixed(1)} s`, results, uptime());
} else if (command === 'check') {
  const golden = JSON.parse(readFileSync(arg('golden'), 'utf8'));
  const limit = Number(arg('limit', golden.rows.length));
  let bad = 0;
  const t0 = Date.now();
  for (const row of golden.rows.slice(0, limit)) {
    const { result, runs, ballsFaced, hash } = G.runTuple(row);
    if (!same({ result, runs, ballsFaced, hash }, { result: row.result, runs: row.runs, ballsFaced: row.ballsFaced, hash: row.hash })) {
      bad++;
      console.log(`MISMATCH ${row.seed} ${row.difficulty} ${row.policy} ${row.assist} ${row.hand}`);
    }
  }
  console.log(`${Math.min(limit, golden.rows.length)} tuples checked in Node, ${bad} differ (${((Date.now() - t0) / 1000).toFixed(1)} s)`, uptime());
  process.exit(bad ? 1 : 0);
} else if (command === 'repeat') {
  const n = Number(arg('tuples', 1000));
  const from = Number(arg('from', 0));
  let bad = 0;
  const t0 = Date.now();
  const seen = new Set();
  const tuples = G.goldenTuples(from + n, 'chase-repeat').slice(from);
  for (const t of tuples) {
    const a = G.runTuple(t);
    const b = G.runTuple(t);
    seen.add(JSON.stringify([t.seed, t.policy, t.difficulty, t.assist, t.hand]));
    if (!same(a, b)) {
      bad++;
      console.log(`DIFFERENT ${t.seed} ${t.difficulty} ${t.policy} ${t.assist} ${t.hand}`);
    }
  }
  const seeds = new Set(tuples.map((t) => t.seed)).size;
  console.log(`${n} tuples (${seen.size} distinct, ${seeds} seeds) played twice, ${bad} differ (${((Date.now() - t0) / 1000).toFixed(1)} s)`, uptime());
  process.exit(bad ? 1 : 0);
} else if (command === 'chromium') {
  const golden = JSON.parse(readFileSync(arg('golden'), 'utf8'));
  const limit = Number(arg('limit', golden.rows.length));
  const work = mkdtempSync(path.join(tmpdir(), 'chase-golden-'));
  try {
    // One browser script: the golden module and everything it imports, bundled as it would be for the page.
    const entry = path.join(work, 'entry.ts');
    writeFileSync(
      entry,
      `import { runTuple } from ${JSON.stringify(path.join(repoRoot, 'tests/unit/practice/chase/golden.ts'))};\n(globalThis as Record<string, unknown>).__runTuple = runTuple;\n`,
    );
    const { rolldown } = await import(path.join(repoRoot, 'node_modules/rolldown/dist/index.mjs'));
    const bundle = await rolldown({ input: entry, platform: 'browser', resolve: { alias: { '@': path.join(repoRoot, 'src') } }, logLevel: 'silent' });
    const { output } = await bundle.generate({ format: 'iife' });
    const code = output[0].code;
    const { chromium } = await import(path.join(repoRoot, 'node_modules/playwright/index.mjs'));
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.setContent('<!doctype html><title>chase golden</title>');
    await page.addScriptTag({ content: code });
    const version = browser.version();
    const rows = golden.rows.slice(0, limit);
    const t0 = Date.now();
    const got = await page.evaluate((tuples) => tuples.map((t) => globalThis.__runTuple(t)), rows.map(({ seed, difficulty, policy, assist, hand }) => ({ seed, difficulty, policy, assist, hand })));
    await browser.close();
    let bad = 0;
    rows.forEach((row, i) => {
      if (!same({ result: got[i].result, runs: got[i].runs, ballsFaced: got[i].ballsFaced, hash: got[i].hash }, { result: row.result, runs: row.runs, ballsFaced: row.ballsFaced, hash: row.hash })) {
        bad++;
        console.log(`MISMATCH ${row.seed} ${row.difficulty} ${row.policy} ${row.assist} ${row.hand}`);
      }
    });
    console.log(`${rows.length} tuples played in headless Chromium ${version}, ${bad} differ from Node (${((Date.now() - t0) / 1000).toFixed(1)} s)`, uptime());
    process.exit(bad ? 1 : 0);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
} else {
  console.error('usage: chase-golden.mjs generate|check|repeat|chromium (see the header of this file)');
  process.exit(2);
}
