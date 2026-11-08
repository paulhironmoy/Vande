/**
 * Evidence records for the rubric's performance criteria (release/player-experience/ceiling-rubric.md §5 and §8) from a
 * directory of practice-frames.mjs runs: frame-time distributions over complete deliveries per tier and environment
 * (PERF1), quality changes inside deliveries (PERF2), loads and shader programs inside deliveries (PERF4) and input to
 * bat (CTL1, the stage's own measurement plus Event Timing's event-to-next-paint).
 *
 *   node scripts/perf/perf-evidence.mjs --runs <run dir> --out release/player-experience/shared/perf/<build id> \
 *        --build <build id> [--prefix E-PERF]
 * Writes EVIDENCE.md (one record per tier and environment), distributions.json and histograms.csv (1 ms bins).
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { ROOT } from './serve.mjs';
import { VIEWPORTS, pct, round } from './practice-lib.mjs';

const arg = (n, d) => (process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1] : d);
const runsDir = resolve(ROOT, arg('runs', 'test-results-perf/harness'));
const out = resolve(ROOT, arg('out', 'release/player-experience/shared/perf'));
const build = arg('build', 'unknown');
const prefix = arg('prefix', 'E-PERF');
mkdirSync(out, { recursive: true });

const LIMITS = {
  premium: { p95: 18, p99: null },
  balanced: { p95: 22.2, p99: 33.3 },
  classic: { p95: 33.3, p99: null },
};
const LATENCY = { premium: 50, balanced: 50, classic: 67 };
const tierOf = (stage, profile) => (stage === '2d' ? 'classic' : profile === 'high' ? 'premium' : 'balanced');

const groups = new Map();
const special = {};
for (const f of readdirSync(runsDir).filter((x) => x.endsWith('.json')).sort()) {
  const r = JSON.parse(readFileSync(join(runsDir, f), 'utf8'));
  // The ten-over memory session and the recorder A/B are reported on their own, not pooled into PERF1.
  const kind = r.name.match(/-(tenovers|recorder|nogl)$/)?.[1];
  if (kind) {
    special[kind] = { r, file: relative(ROOT, join(runsDir, f)) };
    continue;
  }
  for (const w of r.windows ?? []) {
    const d = r.deliveries[w.k - 1] ?? {};
    const inferred = !w.profile;
    const profile = w.profile ?? (w.stage === '2d' ? 'classic' : r.opt.quality === 'auto' ? r.assessment?.profile : r.opt.quality);
    const tier = tierOf(w.stage, profile);
    const env = `${r.opt.gpu} ${r.opt.cpu}× ${r.opt.viewport}`;
    const key = `${env}|${tier}|${tier === 'balanced' ? profile : ''}`;
    if (!groups.has(key)) groups.set(key, { env, tier, profile: tier === 'balanced' ? profile : tier === 'premium' ? 'high' : '2d', runs: new Set(), files: new Set(), intervals: [], perDelivery: [], latency: [], toPaint: [], qualityChanges: 0, loads: 0, links: 0, inferred: false, uptime: new Set(), browser: r.browser, opt: r.opt, started: r.started });
    const g = groups.get(key);
    if (!g.runs.has(r.name)) {
      g.pageErrors = (g.pageErrors ?? 0) + (r.pageErrors?.length ?? 0);
      g.consoleErrors = (g.consoleErrors ?? 0) + (r.consoleErrors?.length ?? 0);
    }
    g.runs.add(r.name);
    g.files.add(relative(ROOT, join(runsDir, f)));
    g.uptime.add(r.load?.start ?? '');
    g.inferred ||= inferred;
    const iv = w.perf1Intervals ?? [];
    g.intervals.push(...iv);
    g.perDelivery.push({ run: r.name, k: w.k, worst: iv.length ? Math.max(...iv) : null, p95: pct(iv, 95) });
    if (w.qualityChange) g.qualityChanges++;
    if ((w.loads ?? []).length) g.loads++;
    if (w.links) g.links++;
    if (d.swing && d.swing.kind !== 'leave' && d.touchedAt !== null && typeof d.stats?.lastInputToBatMs === 'number') g.latency.push(d.stats.lastInputToBatMs);
    if (typeof w.downToPaint === 'number') g.toPaint.push(w.downToPaint);
  }
}

const rows = [];
const dist = [];
const csv = ['group,bin_ms,count'];
let id = 1;
for (const g of [...groups.values()].sort((a, b) => a.env.localeCompare(b.env) || a.tier.localeCompare(b.tier))) {
  const iv = g.intervals;
  const n = g.perDelivery.length;
  const p50 = pct(iv, 50);
  const p95 = pct(iv, 95);
  const p99 = pct(iv, 99);
  const worst = iv.length ? Math.max(...iv) : null;
  const over100 = iv.filter((v) => v > 100).length;
  const lim = LIMITS[g.tier];
  const perf1 = n >= 30 && p95 !== null && p95 <= lim.p95 && (lim.p99 === null || p99 <= lim.p99) && over100 === 0;
  const latP95 = pct(g.latency, 95);
  const paintP95 = pct(g.toPaint, 95);
  const ctl1 = g.latency.length >= 50 && latP95 !== null && latP95 <= LATENCY[g.tier];
  const vp = VIEWPORTS[g.opt.viewport];
  const settings = `tier ${g.tier}${g.tier === 'balanced' ? ` (${g.profile})` : ''}${g.inferred ? ' [profile inferred from the forced choice]' : ''}; right hand; Quick Practice defaults; audio on; haptics on; motion full; text 1×; ${vp ? `${vp.width}×${vp.height} at ${vp.dpr}×` : g.opt.viewport}`;
  const device = `Apple M1 Pro, macOS 15, headless Chromium ${g.browser}, ${g.opt.gpu === 'metal' ? 'ANGLE Metal (hardware GPU)' : 'SwiftShader (software)'}, CPU throttle ${g.opt.cpu}× (CDP)`;
  const files = [...g.files].join(', ');
  const base = { build, time: g.started, device, settings, path: files };
  const rec = (criterion, method, expected, observed, pass) => rows.push({ id: `${prefix}-${String(id++).padStart(3, '0')}`, criterion, ...base, method, expected, observed, result: pass === null ? 'n/a' : pass ? 'Pass' : 'Fail' });
  rec(
    'PERF1',
    `scripts/perf/practice-frames.mjs (real CDP touches, passive rAF recorder), ${n} deliveries, window 1 s before release → dead ball; uptime ${[...g.uptime].join(' / ')}`,
    `${g.tier}: p95 ≤ ${lim.p95} ms${lim.p99 ? `, p99 ≤ ${lim.p99} ms` : ''}; no frame > 100 ms; ≥ 30 deliveries`,
    `${n} deliveries, ${iv.length} frames: p50 ${round(p50, 1)} ms, p95 ${round(p95, 1)} ms, p99 ${round(p99, 1)} ms, worst ${round(worst, 1)} ms, ${over100} frames > 100 ms`,
    perf1,
  );
  rec('PERF2', 'the same runs: stage, tier and drawing buffer per frame; the profile at release and at dead ball', 'no quality change inside a delivery', `${g.qualityChanges} of ${n} deliveries changed quality`, g.qualityChanges === 0);
  rec('PERF4', 'the same runs: Resource Timing entries and WebGL linkProgram calls between run-up and dead ball', 'no load and no shader program inside a delivery', `${g.loads} deliveries with a load, ${g.links} with a program link`, g.loads === 0 && g.links === 0);
  rec('ERR', 'the same runs: page errors (uncaught) and console errors, counted per run (Stage 0 baseline item 7)', 'no page error and no console error', `${g.pageErrors ?? 0} page errors, ${g.consoleErrors ?? 0} console errors in ${g.runs.size} runs`, !(g.pageErrors ?? 0) && !(g.consoleErrors ?? 0));
  rec(
    'CTL1',
    'the same runs: the stage’s lastInputToBatMs (event timestamp → first submitted frame with the bat moving) per swing; Event Timing pointerdown → next paint as the presented-frame proxy',
    `p95 ≤ ${LATENCY[g.tier]} ms, ≥ 50 swings`,
    g.latency.length ? `${g.latency.length} swings: median ${round(pct(g.latency, 50), 1)} ms, p95 ${round(latP95, 1)} ms, max ${round(Math.max(...g.latency), 1)} ms; to next paint p95 ${round(paintP95, 1)} ms (${g.toPaint.length} swings)` : `not measured (the build has no stats() read); to next paint p95 ${round(paintP95, 1)} ms (${g.toPaint.length} swings)`,
    g.latency.length ? ctl1 : null,
  );
  const hist = new Map();
  for (const v of iv) hist.set(Math.floor(v), (hist.get(Math.floor(v)) ?? 0) + 1);
  for (const [b, c] of [...hist].sort((a, b) => a[0] - b[0])) csv.push(`${g.env} ${g.tier} ${g.profile},${b},${c}`);
  dist.push({ env: g.env, tier: g.tier, profile: g.profile, deliveries: n, frames: iv.length, p50, p95, p99, worst, over33: iv.filter((v) => v > 33.4).length, over50: iv.filter((v) => v > 50).length, over100, perDelivery: g.perDelivery, latency: g.latency, toPaint: g.toPaint, runs: [...g.runs] });
}

// Memory over a ten-over session (heap after a forced GC each over; WebGL bytes; DOM nodes; listeners).
if (special.tenovers) {
  const { r, file } = special.tenovers;
  const gc = r.deliveries.filter((d) => d.heap?.gc);
  const mb = (b) => (b / 2 ** 20).toFixed(1);
  const first = gc[0];
  const last = gc.at(-1);
  const glMb = (d) => (d ? mb(d.gl.tex + d.gl.buf + d.gl.rb) : '–');
  const grow = first && last ? last.heap.jsUsedMb - first.heap.jsUsedMb : null;
  rows.push({
    id: `${prefix}-${String(id++).padStart(3, '0')}`,
    criterion: 'MEM',
    build,
    time: r.started,
    device: `Apple M1 Pro, macOS 15, headless Chromium ${r.browser}, ANGLE Metal, CPU 1×`,
    settings: 'Balanced (Standard) forced; right hand; defaults; 915×412 at 2.625×; every sixth ball left',
    method: `scripts/perf/practice-frames.mjs --deliveries 60 --gc-every 6: after each over a forced GC (HeapProfiler.collectGarbage), then Performance.getMetrics and the recorder's WebGL bytes; uptime ${r.load?.start ?? ''}`,
    expected: 'no growth over ten overs: JS heap after GC within 3 MB of over 1; DOM nodes, listeners, live WebGL bytes and programs flat',
    observed: gc.length ? `${r.deliveries.length} deliveries; heap after GC over 1 → over ${gc.length}: ${first.heap.jsUsedMb} → ${last.heap.jsUsedMb} MB; nodes ${first.heap.nodes} → ${last.heap.nodes}; listeners ${first.heap.listeners} → ${last.heap.listeners}; WebGL ${glMb(first)} → ${glMb(last)} MB; programs ${first.gl.programs} → ${last.gl.programs}; contexts created ${last.gl.contexts.length}` : 'no GC samples',
    result: grow === null ? 'n/a' : grow < 3 && last.heap.nodes - first.heap.nodes < 300 && last.heap.listeners - first.heap.listeners < 60 ? 'Pass' : 'Fail',
    path: file,
  });
}
// The recorder's own cost: the same session with and without its WebGL wrappers.
if (special.recorder && special.nogl) {
  const pool = (x) => x.r.windows.flatMap((w) => w.perf1Intervals ?? []);
  const a = pool(special.recorder);
  const b = pool(special.nogl);
  rows.push({
    id: `${prefix}-${String(id++).padStart(3, '0')}`,
    criterion: 'METHOD',
    build,
    time: special.recorder.r.started,
    device: `Apple M1 Pro, macOS 15, headless Chromium ${special.recorder.r.browser}, ANGLE Metal, CPU 4×`,
    settings: 'Balanced (Standard) forced; 915×412 at 2.625×',
    method: 'the same session twice: with the full recorder, and with its WebGL wrappers off (--nogl)',
    expected: 'the recorder does not change what it measures (p95 within a frame of each other)',
    observed: `with: p50 ${round(pct(a, 50), 1)}, p95 ${round(pct(a, 95), 1)}, p99 ${round(pct(a, 99), 1)} ms (${a.length} frames); without: p50 ${round(pct(b, 50), 1)}, p95 ${round(pct(b, 95), 1)}, p99 ${round(pct(b, 99), 1)} ms (${b.length} frames)`,
    result: a.length && b.length && Math.abs(pct(a, 95) - pct(b, 95)) <= 16.7 ? 'Pass' : 'Fail',
    path: `${special.recorder.file}, ${special.nogl.file}`,
  });
}

const esc = (s) => String(s).replace(/\|/g, '\\|');
const md = [
  `# Performance evidence, build ${build}`,
  '',
  `Generated by scripts/perf/perf-evidence.mjs from ${relative(ROOT, runsDir)} on ${new Date().toISOString()}. Builder evidence: per rubric R3 it counts once an evaluator reruns it (\`scripts/perf/run-perf.sh\`). Desktop and emulator numbers are not evidence of phone performance.`,
  '',
  '| ID | Criterion | Build id | Time (UTC) | Device and browser | Settings | Method | Expected | Observed | Result | Evidence path |',
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ...rows.map((r) => `| ${r.id} | ${r.criterion} | ${r.build} | ${r.time} | ${esc(r.device)} | ${esc(r.settings)} | ${esc(r.method)} | ${esc(r.expected)} | ${esc(r.observed)} | ${r.result} | ${esc(r.path)} |`),
  '',
];
writeFileSync(join(out, 'EVIDENCE.md'), md.join('\n'));
writeFileSync(join(out, 'distributions.json'), JSON.stringify(dist, null, 1));
writeFileSync(join(out, 'histograms.csv'), csv.join('\n'));
const fails = rows.filter((r) => r.result === 'Fail');
console.log(`${rows.length} records (${fails.length} fail) → ${relative(ROOT, out)}/EVIDENCE.md`);
for (const r of rows) console.log(`  ${r.id} ${r.criterion.padEnd(5)} ${r.result.padEnd(4)} ${r.settings.split(';')[0]} · ${r.device.split(', ').slice(-2).join(', ')} · ${r.observed}`);
