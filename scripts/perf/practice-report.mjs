/**
 * Markdown tables from the Practice harness results (scripts/perf/practice-frames.mjs): one row per run and stage
 * segment (the session monitor may step a run down part-way), against the brief's targets.
 *
 *   node scripts/perf/practice-report.mjs test-results-perf/harness [--json]
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ROOT } from './serve.mjs';

const dir = resolve(ROOT, process.argv[2] ?? 'test-results-perf/harness');
const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
const med = (xs) => {
  const s = xs.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) / 2)] : null;
};
const max = (xs) => {
  const s = xs.filter((x) => typeof x === 'number' && Number.isFinite(x));
  return s.length ? Math.max(...s) : null;
};
const min = (xs) => {
  const s = xs.filter((x) => typeof x === 'number' && Number.isFinite(x));
  return s.length ? Math.min(...s) : null;
};
const f = (v, d = 0) => (v === null || v === undefined ? '–' : Number(v).toFixed(d));
const mb = (b) => (b / 2 ** 20).toFixed(1);

/** The drawing buffer's own memory: front and back colour, depth, and 4× MSAA colour and depth when antialiased. */
function framebufferBytes(c) {
  if (!c) return 0;
  const px = c.w * c.h;
  return px * 4 * 2 + (c.depth ? px * 4 : 0) + (c.antialias ? px * 4 * 4 + (c.depth ? px * 4 * 4 : 0) : 0);
}

const rows = [];
for (const file of files) {
  const r = JSON.parse(readFileSync(join(dir, file), 'utf8'));
  const ws = r.windows ?? [];
  const segs = [];
  for (const w of ws) {
    const d = r.deliveries[w.k - 1];
    const profile = d?.stats?.profile ?? d?.state?.profile ?? null;
    const key = `${w.stage}/${w.stage === '2d' ? 'classic' : (profile ?? w.tier)}`;
    if (!segs.length || segs.at(-1).key !== key) segs.push({ key, ws: [], ds: [] });
    segs.at(-1).ws.push(w);
    segs.at(-1).ds.push(d);
  }
  const last = r.deliveries.at(-1);
  const live = last?.gl?.contexts?.filter((c) => c.live).at(-1);
  for (const [si, s] of segs.entries()) {
    const lat = s.ds.filter((d) => d && d.swing?.kind !== 'leave' && d.touchedAt !== null).map((d) => d.stats?.lastInputToBatMs);
    rows.push({
      run: r.name,
      seg: si,
      gpu: r.opt.gpu,
      cpu: r.opt.cpu,
      viewport: r.opt.viewport,
      quality: r.opt.quality,
      check: r.assessment ? `${r.assessment.tier}/${r.assessment.profile}` : '–',
      checkFps: r.assessment?.avgFps ?? null,
      reasons: (r.assessment?.reasons ?? []).join(','),
      key: s.key,
      n: s.ws.length,
      avgFps: med(s.ws.map((w) => w.all.avgFps)),
      minAvgFps: min(s.ws.map((w) => w.all.avgFps)),
      p95: max(s.ws.map((w) => w.all.p95Ms)),
      worst: max(s.ws.map((w) => w.all.worstMs)),
      over33: s.ws.reduce((a, w) => a + (w.all.over33 ?? 0), 0),
      over50: s.ws.reduce((a, w) => a + (w.all.over50 ?? 0), 0),
      flightFps: med(s.ws.map((w) => w.flight.avgFps)),
      flightP95: max(s.ws.map((w) => w.flight.p95Ms)),
      flightWorst: max(s.ws.map((w) => w.flight.worstMs)),
      minWindow: min(s.ws.map((w) => w.all.minWindowFps)),
      links: s.ws.reduce((a, w) => a + w.links, 0),
      longTasks: s.ws.reduce((a, w) => a + w.longTasks, 0),
      longMax: max(s.ws.map((w) => w.longTaskMaxMs)),
      latMed: med(lat),
      latMax: max(lat),
      heapFirst: r.deliveries[0]?.heap?.jsUsedMb ?? null,
      heapLast: last?.heap?.jsUsedMb ?? null,
      glMb: last?.gl ? mb(last.gl.tex + last.gl.buf + last.gl.rb) : '–',
      fbMb: live ? mb(framebufferBytes(live)) : '–',
      buffer: live ? `${live.w}×${live.h}${live.antialias ? ' MSAA' : ''}` : '–',
      before: r.beforeFirst ?? null,
      between: r.betweenBalls?.links ?? null,
      net: r.network,
      errors: r.errors?.length ?? 0,
      delivered: `${ws.length}/${r.opt.n}`,
      load: r.load?.start ?? '',
    });
  }
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(rows, null, 1));
  process.exit(0);
}
console.log(`\n${files.length} runs in ${dir}\n`);
console.log('| Run | Device check | Stage/profile (balls) | Run-up→dead: median fps (lowest) | p95 / worst frame ms | >33 / >50 ms frames | Release→dead: fps, p95, worst | Lowest 1 s window | Programs linked in deliveries | Long tasks (max ms) | Input→bat ms median (max) | JS heap MB first→last | WebGL MB app + drawing buffer | Buffer |');
console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
for (const x of rows) {
  console.log(
    `| ${x.seg ? '↳' : `${x.gpu} ${x.cpu}× ${x.viewport} ${x.quality}`} | ${x.seg ? '' : `${x.check} ${f(x.checkFps, 1)} fps${x.reasons && x.reasons !== 'ok' ? ` (${x.reasons})` : ''}`} | ${x.key} (${x.n}) | ${f(x.avgFps, 1)} (${f(x.minAvgFps, 1)}) | ${f(x.p95, 1)} / ${f(x.worst, 1)} | ${x.over33} / ${x.over50} | ${f(x.flightFps, 1)}, ${f(x.flightP95, 1)}, ${f(x.flightWorst, 1)} | ${f(x.minWindow, 1)} | ${x.links} | ${x.longTasks} (${f(x.longMax)}) | ${f(x.latMed, 1)} (${f(x.latMax, 1)}) | ${f(x.heapFirst, 1)}→${f(x.heapLast, 1)} | ${x.glMb} + ${x.fbMb} | ${x.buffer} |`,
  );
}
const notes = rows.filter((x) => !x.seg && (x.errors || x.delivered.split('/')[0] !== x.delivered.split('/')[1]));
if (notes.length) console.log(`\nIncomplete runs: ${notes.map((x) => `${x.run} (${x.delivered}, ${x.errors} errors)`).join('; ')}`);
const nets = rows.filter((x) => !x.seg && x.net?.blocked);
for (const x of nets) console.log(`\nNetwork blocked after the first ball (${x.run}): ${x.net.duringPlay.length} requests attempted during play${x.net.duringPlay.length ? `: ${x.net.duringPlay.slice(0, 8).join(', ')}` : ''}`);
console.log(`\nLoad averages at the start of each run: ${[...new Set(rows.filter((x) => !x.seg).map((x) => x.load))].slice(0, 6).join(' · ')}`);
