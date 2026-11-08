#!/usr/bin/env node
/**
 * Practice evaluation runner (docs/EVALUATION.md). Drives a served build (with VITE_PRACTICE_TEST_HOOKS=1) in
 * Chromium and writes evidence to release/eval/<label>/: screenshots, a video, and metrics/*.json.
 *
 *   node scripts/eval/run.mjs --base http://localhost:4211 --label before-38924bd --build-id 38924bd
 *   node scripts/eval/run.mjs --base http://localhost:4213 --label snap-<time> --build-id <scripts/build-id.sh> --only flow,capture
 * Evidence: release/player-experience/rookie/runs/<label>/ (rubric R1, R10: build id and uptime recorded).
 *
 * Modules: flow, capture, obstruction, a11y, determinism, recovery, scene, perf, rookie (default: all).
 * rookie parts: --parts gestures,novice,failures,retry,another
 * --gpu hw (default: full Chromium, the machine's GPU) or sw (SwiftShader); --viewports 640x360,915x412,...
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cpus } from 'node:os';
import { launch, log, outDir, parseArgs, uptime } from './lib/env.mjs';

const args = parseArgs();
const want = (m) => !args.only || args.only.includes(m);
outDir(args);
writeFileSync(join(args.out, 'run.json'), JSON.stringify({ base: args.base, label: args.label, startedAt: new Date().toISOString(), argv: process.argv.slice(2), node: process.version, cpus: cpus().length, buildId: args.buildId, uptimeAtStart: uptime() }, null, 2));
log(args, `eval start: ${process.argv.slice(2).join(' ')}`);

/** One browser at a time (AGENTS.md, shared machine): get('hw' | 'sw') closes the other before launching. */
const B = {
  cur: null,
  kind: null,
  async get(kind) {
    if (this.cur && this.kind === kind) return this.cur;
    if (this.cur) await this.cur.close().catch(() => undefined);
    this.cur = await launch(kind === 'sw' ? 'sw' : args.gpu);
    this.kind = kind;
    return this.cur;
  },
  async close() {
    if (this.cur) await this.cur.close().catch(() => undefined);
    this.cur = null;
    this.kind = null;
  },
};
const results = {};
try {
  const hw = await B.get('hw');
  const renderer = await (async () => {
    const p = await hw.newPage();
    await p.setContent('<canvas id=c></canvas>');
    const r = await p.evaluate(() => {
      const gl = document.getElementById('c').getContext('webgl2');
      const e = gl && gl.getExtension('WEBGL_debug_renderer_info');
      return gl ? (e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) : 'no webgl2';
    });
    await p.close();
    return r;
  })();
  log(args, `renderer: ${renderer}; chromium ${hw.version()}`);
  results.renderer = renderer;
  results.browser = `Chromium ${hw.version()} (Playwright, ${args.gpu === 'sw' ? 'headless shell, SwiftShader' : 'new headless, hardware GPU'})`;
  if (want('flow')) {
    const { runFlow } = await import('./modules/flow.mjs');
    results.flow = await runFlow(await B.get('hw'), args, { gpu: 'hw' });
    results.flowSoftware = await runFlow(await B.get('sw'), args, { gpu: 'sw', reps: 1 });
  }
  if (want('capture')) {
    const { runCapture } = await import('./modules/capture-run.mjs');
    results.capture = await runCapture(B, args);
  }
  for (const [m, file, fn] of [
    ['obstruction', './modules/obstruction.mjs', 'runObstruction'],
    ['a11y', './modules/a11y.mjs', 'runA11y'],
    ['determinism', './modules/determinism.mjs', 'runDeterminism'],
    ['recovery', './modules/recovery.mjs', 'runRecovery'],
    ['scene', './modules/scene.mjs', 'runScene'],
  ]) {
    if (!want(m)) continue;
    const mod = await import(file);
    results[m] = await mod[fn](await B.get('hw'), args);
  }
  if (want('rookie')) {
    const { runRookie } = await import('./modules/rookie.mjs');
    results.rookie = await runRookie(await B.get('hw'), args, args.parts || undefined);
  }
  if (want('perf')) {
    const { runPerf } = await import('./modules/perf.mjs');
    results.perf = await runPerf(B, args);
  }
} finally {
  await B.close();
}
results.uptimeAtEnd = uptime();
writeFileSync(join(args.out, `results-${(args.only || ['all']).join('+')}.json`), JSON.stringify(results, null, 2));
log(args, `eval done (${results.uptimeAtEnd})`);
