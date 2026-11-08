/**
 * Where the main thread goes around bat-ball contact: plays deliveries like practice-frames.mjs (real CDP touches) with
 * the CPU profiler running from each release to dead ball, then lists the functions with the most self time inside the
 * long animation frames of those deliveries (use an unminified build, `vite build --minify false`, for names).
 *
 *   node scripts/perf/practice-profile.mjs --dist dist-perfh-nomin --cpu 6 [--deliveries 4] [--quality standard]
 *        [--out test-results-perf/profile]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT, serveBuild } from './serve.mjs';
import { hookReads, launch, newRun, surfaceCentre, toDelivery, touch, waitPhase } from './practice-lib.mjs';

const arg = (n, d) => (process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1] : d);
const dist = arg('dist', 'dist-perfh-nomin');
const cpu = Number(arg('cpu', 6));
const n = Number(arg('deliveries', 4));
const quality = arg('quality', 'standard');
const out = resolve(ROOT, arg('out', 'test-results-perf/profile'));
mkdirSync(out, { recursive: true });

const server = await serveBuild(dist);
const browser = await launch(arg('gpu', 'metal'));
const totals = new Map();
const frames = [];
const runs = [];
try {
  const { page, cdp } = await newRun(browser, arg('viewport', 'phone'), { quality });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 250 });
  await page.goto(`${server.url}/practice`);
  for (let i = 0; i < n; i++) {
    await toDelivery(page);
    // Started at the run-up, well before the release: starting the profiler itself stalls the page for a moment.
    // The profile's clock starts at Profiler.start; the page time just before it aligns the two (to a few ms).
    const p0 = await page.evaluate(() => performance.now());
    await cdp.send('Profiler.start');
    const rel = await waitPhase(page, ['live'], 90_000);
    const flight = (await hookReads(page))?.flight;
    const kind = i % 2 ? 'tap' : 'flick';
    if (rel !== null && flight) {
      const at = await surfaceCentre(page);
      const wait = rel + flight.idealContactT * 1000 - (kind === 'tap' ? 120 : 150) - (await page.evaluate(() => performance.now()));
      if (wait > 0) await new Promise((ok) => setTimeout(ok, wait));
      if (at) await touch(cdp, at, kind, 0);
    }
    await waitPhase(page, ['dead', 'closeup', 'coaching', 'paused', 'idle'], 90_000);
    const { profile } = await cdp.send('Profiler.stop');
    writeFileSync(resolve(out, `delivery-${i + 1}.cpuprofile`), JSON.stringify(profile));
    // Long animation frames of this delivery (page time) → the profile's clock (µs since its own start).
    const loaf = await page.evaluate((from) => window.__perf.loaf.filter((e) => e[0] >= from && e[1] > 50).map((e) => [e[0], e[1]]), (rel ?? p0) + 100);
    runs.push({ delivery: i + 1, file: `delivery-${i + 1}.cpuprofile`, p0, release: rel, kind, loaf });
    const nodes = new Map(profile.nodes.map((x) => [x.id, x]));
    let t = profile.startTime;
    const pageTime = profile.timeDeltas.map((d) => p0 + ((t += d) - profile.startTime) / 1000);
    for (const [start, dur] of loaf) {
      const self = new Map();
      profile.samples.forEach((id, k) => {
        const ts = pageTime[k];
        if (ts < start || ts > start + dur) return;
        const node = nodes.get(id);
        const f = node.callFrame;
        const key = `${f.functionName || '(anonymous)'} ${f.url.split('/').pop()}:${f.lineNumber + 1}`;
        const dt = (profile.timeDeltas[k + 1] ?? 250) / 1000;
        self.set(key, (self.get(key) ?? 0) + dt);
      });
      frames.push({ delivery: i + 1, at: Math.round(start - (rel ?? 0)), ms: Math.round(dur), top: [...self].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${v.toFixed(1)} ms ${k}`) });
      for (const [k, v] of self) totals.set(k, (totals.get(k) ?? 0) + v);
    }
  }
} finally {
  await browser.close();
  await server.close();
}
for (const f of frames) console.log(`delivery ${f.delivery}: a ${f.ms} ms frame ${f.at} ms after release\n    ${f.top.join('\n    ')}`);
console.log('\nSelf time inside long frames, all deliveries:');
for (const [k, v] of [...totals].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`  ${v.toFixed(1).padStart(7)} ms  ${k}`);
writeFileSync(resolve(out, 'summary.json'), JSON.stringify({ dist, cpu, quality, runs, frames, totals: [...totals].sort((a, b) => b[1] - a[1]).slice(0, 60) }, null, 1));
