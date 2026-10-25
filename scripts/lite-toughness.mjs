#!/usr/bin/env node
/**
 * Computes the Lite toughness tiers (Tricky ×1, Tough ×2, Boss ×3) from the game itself and writes
 * src/content/lite/toughness.json. A unit test recomputes the manifest and fails when it is stale.
 *
 *   node scripts/lite-toughness.mjs           # recompute, write the manifest, print the review table
 *   node scripts/lite-toughness.mjs --check   # recompute and compare only (exit 1 when stale)
 *   node scripts/lite-toughness.mjs --survey  # also print which action kinds can be the best move (twist coverage)
 *
 * Loads the TypeScript engine through Vite's SSR module runner, like scripts/validate-daily.mjs.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'vite';

const check = process.argv.includes('--check');
const survey = process.argv.includes('--survey');
const out = resolve('src/content/lite/toughness.json');

const server = await createServer({ server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom', logLevel: 'error', optimizeDeps: { noDiscovery: true, include: [] } });
try {
  const t = await server.ssrLoadModule('/src/lite/toughness.ts');
  const { manifest, report } = t.computeToughness();
  const json = `${JSON.stringify(manifest, null, 2)}\n`;
  console.table(
    report.map((r) => ({
      id: r.id,
      title: r.title,
      seen: r.seen,
      best: r.bestPts,
      second: r.secondPts,
      close: `${r.signalCounts.closeCall}/${r.seen}`,
      trap: `${r.signalCounts.trap}/${r.seen}`,
      clue: `${r.signalCounts.clueNeeded}/${r.seen}`,
      tier: r.tier,
    })),
  );
  const counts = { tricky: 0, tough: 0, boss: 0 };
  for (const r of report) counts[r.tier] += 1;
  console.log(`thresholds ${JSON.stringify(manifest.thresholds)} · seeds ${manifest.seeds.length} · tiers ${JSON.stringify(counts)} · hash ${manifest.contentHash}`);
  if (survey) {
    const s = t.bestMoveKindSurvey();
    console.log(`best-move kinds over ${s.decisionsSeen} decisions:`, s.kinds);
    console.table(Object.fromEntries(Object.entries(s.byDecision).map(([id, k]) => [id, k])));
  }
  let current = '';
  try {
    current = readFileSync(out, 'utf8');
  } catch {
    /* missing */
  }
  if (check) {
    if (current !== json) {
      console.error('✗ src/content/lite/toughness.json is stale: run node scripts/lite-toughness.mjs');
      process.exitCode = 1;
    } else console.log('✓ toughness manifest is current');
  } else if (current !== json) {
    writeFileSync(out, json);
    console.log(`✓ wrote ${out}`);
  } else console.log('✓ toughness manifest already current');
} finally {
  await server.close();
}
