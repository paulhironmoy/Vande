#!/usr/bin/env node
/**
 * Lite pictures coverage: which questions show pictures and why the others stay text, plus any tagging errors.
 *   node scripts/lite-visuals-report.mjs                      # Chapter 1 (examination-crisis)
 *   node scripts/lite-visuals-report.mjs electoral-dispute    # other chapters by id
 *   node scripts/lite-visuals-report.mjs --all                # every chapter and every daily crisis
 * Exits 1 when any picture tag is invalid. Loads TypeScript through Vite's SSR module runner, so no build step is
 * needed (see docs/LITE-VISUALS.md).
 */
import { createServer } from 'vite';

const args = process.argv.slice(2);
const all = args.includes('--all');
const ids = args.filter((a) => !a.startsWith('--'));
const server = await createServer({ server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom', logLevel: 'error', optimizeDeps: { noDiscovery: true, include: [] } });
try {
  const { SCENARIOS } = await server.ssrLoadModule('/src/content/index.ts');
  const { DAYS } = await server.ssrLoadModule('/src/content/daily/index.ts');
  const { compileDaily } = await server.ssrLoadModule('/src/engine/dailyCompiler.ts');
  const { validateVisuals } = await server.ssrLoadModule('/src/lite/visuals.ts');
  const { VISUAL_VOCABULARY } = await server.ssrLoadModule('/src/content/lite/visualVocabulary.ts');

  const scenarios = [];
  if (all) {
    scenarios.push(...Object.values(SCENARIOS));
    for (const day of Object.values(DAYS)) scenarios.push(compileDaily(day));
  } else {
    for (const id of ids.length ? ids : ['examination-crisis']) {
      const sc = SCENARIOS[id] ?? (DAYS[id] ? compileDaily(DAYS[id]) : undefined);
      if (!sc) {
        console.error(`  ✗ unknown scenario or day '${id}'`);
        process.exitCode = 1;
        continue;
      }
      scenarios.push(sc);
    }
  }

  let errors = 0;
  let visualTotal = 0;
  let questionTotal = 0;
  for (const sc of scenarios) {
    const v = validateVisuals(sc);
    const visual = v.coverage.filter((c) => c.visual).length;
    visualTotal += visual;
    questionTotal += v.coverage.length;
    console.log(`\n${sc.id}: ${visual} of ${v.coverage.length} questions show pictures`);
    if (!all || visual > 0 || v.errors.length) {
      for (const c of v.coverage) console.log(`  ${c.visual ? '▣ picture' : '▢ text   '}  ${c.id.padEnd(22)} ${c.title}\n               ${c.reason}`);
    }
    for (const e of v.errors) console.error(`  ✗ ${e}`);
    errors += v.errors.length;
  }
  const used = VISUAL_VOCABULARY.map((g) => `${g.id} (${g.roles.join('/')})`).join(', ');
  console.log(`\nVocabulary: ${VISUAL_VOCABULARY.length} glyphs: ${used}`);
  console.log(`Total: ${visualTotal} of ${questionTotal} questions show pictures; ${errors} error${errors === 1 ? '' : 's'}.`);
  if (errors) process.exitCode = 1;
} finally {
  await server.close();
}
