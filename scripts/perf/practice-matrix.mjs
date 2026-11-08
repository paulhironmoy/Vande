/**
 * Runs the Practice frame-time harness over a set of profiles, one fresh browser per run, strictly one at a time, then
 * prints the report (scripts/perf/practice-report.mjs). Results: <out>/<run>.json.
 *
 *   node scripts/perf/practice-matrix.mjs --dist dist-perfh --set evidence [--out test-results-perf/harness]
 *
 * Sets (docs/PERFORMANCE.md, "Method"):
 *   evidence   the rubric's PERF1 and CTL1 matrix:
 *              - Metal at 1× CPU on the 915×412 phone: each tier forced, 50 batted deliveries (every ball a swing);
 *              - Metal at 4× and 6× CPU on the phone: each tier, 30 deliveries;
 *              - Metal at 1× on 640×360, 844×390, 1280×800 and 1920×1080: Premium, Balanced and Classic, 30 each;
 *              - SwiftShader on the phone: the real device check (it lands on Classic) and Classic forced, 30 each;
 *              - a ten-over Standard session with a forced GC each over (memory), and the recorder's own cost (A/B)
 *   quick      the same environments with 6 deliveries each (a smoke run of the evidence set)
 *   core       Metal at 1×, 4× and 6× on the phone: the device check (auto) and each tier forced
 *   swift      SwiftShader on the phone: auto, Lite and Classic
 *   viewports  Metal at 1× and 4× on 640×360, 1280×800 and 2400×1080: auto and Lite
 *   recorder   the recorder's own cost: Standard at 4× with and without the WebGL recorder
 *   one        a single run: --gpu --cpu --viewport --quality
 */
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { ROOT } from './serve.mjs';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? dflt : process.argv[i + 1];
};
const dist = arg('dist', 'dist-perfh');
const out = arg('out', 'test-results-perf/harness');
const n = arg('deliveries', '6');
const set = arg('set', 'core');

const runs = [];
const add = (gpu, cpu, viewport, quality, extra = [], deliveries = n) => runs.push({ gpu, cpu, viewport, quality, extra, deliveries: String(deliveries) });
const TIERS = ['high', 'standard', 'lite', 'classic'];
if (set === 'evidence' || set === 'quick') {
  const k = (full) => (set === 'quick' ? 6 : full);
  for (const q of TIERS) add('metal', 1, 'phone', q, ['--leaves', '0'], k(50));
  for (const cpu of [4, 6]) for (const q of TIERS) add('metal', cpu, 'phone', q, ['--leaves', '0'], k(30));
  for (const vp of ['small', 'common', 'tablet', 'desktop']) for (const q of ['high', 'standard', 'classic']) add('metal', 1, vp, q, ['--leaves', '0'], k(30));
  add('swiftshader', 1, 'phone', 'auto', ['--leaves', '0'], k(30));
  add('swiftshader', 1, 'phone', 'classic', ['--leaves', '0'], k(30));
  // A ten-over session for memory (heap after a forced GC every over, WebGL bytes, DOM, listeners).
  add('metal', 1, 'phone', 'standard', ['--leaves', '6', '--gc-every', '6', '--label', 'metal-cpu1-phone-standard-tenovers'], k(60));
  // The recorder's own cost: the same Standard session at 4× with and without the WebGL recorder.
  add('metal', 4, 'phone', 'standard', ['--leaves', '0', '--label', 'metal-cpu4-phone-standard-recorder'], k(12));
  add('metal', 4, 'phone', 'standard', ['--leaves', '0', '--nogl', '--label', 'metal-cpu4-phone-standard-nogl'], k(12));
}
if (set === 'core') for (const cpu of [1, 4, 6]) for (const q of ['auto', ...TIERS]) add('metal', cpu, 'phone', q);
if (set === 'swift') for (const q of ['auto', 'lite', 'classic']) add('swiftshader', 1, 'phone', q);
if (set === 'viewports') for (const vp of ['small', 'tablet', 'wide']) for (const cpu of [1, 4]) for (const q of ['auto', 'lite']) add('metal', cpu, vp, q);
if (set === 'recorder') {
  add('metal', 4, 'phone', 'standard');
  add('metal', 4, 'phone', 'standard', ['--nogl']);
}
if (set === 'one') add(arg('gpu', 'metal'), Number(arg('cpu', 1)), arg('viewport', 'phone'), arg('quality', 'auto'), process.argv.includes('--leaves') ? ['--leaves', arg('leaves', '6')] : []);

const started = Date.now();
for (const [i, r] of runs.entries()) {
  const args = ['scripts/perf/practice-frames.mjs', '--dist', dist, '--out', out, '--deliveries', r.deliveries, '--gpu', r.gpu, '--cpu', String(r.cpu), '--viewport', r.viewport, '--quality', r.quality, ...r.extra];
  console.log(`\n[${i + 1}/${runs.length}] ${args.slice(5).join(' ')}`);
  const res = spawnSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit', timeout: 40 * 60_000 });
  if (res.status !== 0) console.log(`  (exit ${res.status ?? res.signal})`);
}
console.log(`\n${runs.length} runs in ${Math.round((Date.now() - started) / 1000)} s`);
spawnSync(process.execPath, [join(ROOT, 'scripts/perf/practice-report.mjs'), out], { cwd: ROOT, stdio: 'inherit' });
