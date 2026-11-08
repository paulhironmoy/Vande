// @vitest-environment node
/**
 * Gates G-cost and the budgets: sample is O(1) and allocation-free (at most 5 microseconds and 0 bytes per frame),
 * prepare is cheap enough to run at idle or in bowl(), the plan is under 1.5 kB, the trace is 24 Int16 channels at
 * 60 Hz, the parameter file is at most 6 kB, and the director stays within its share of the lazy stage chunk (16 kB
 * minified). Reason: the Lite 4x run already hitches at the result-arrival frame, and the Android budget is hard.
 * Timings are node timings on this machine (M1 Pro), not phone timings: the phone cost is UNPROVEN until the I1 run.
 *
 * The speed budgets are judged the way tests/unit/support/timing.ts describes: CPU time of the test's thread (a busy machine
 * delays it, it does not make it slower), the least of several rounds, the budget exactly as written. Only when a budget is
 * exceeded on a machine above load 20 does the test skip, by name; it never passes silently, and on a quiet machine it fails.
 * The size budgets below are not timings and stay exact.
 */
import { readFileSync, statSync } from 'node:fs';
import { loadavg } from 'node:os';
import v8 from 'node:v8';
import vm from 'node:vm';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import * as api from '@/render3d/core/motion/director';
import { CHANNELS, createOut, prepare, sample } from '@/render3d/core/motion/director';
import { buildEvents } from '@/render3d/core/motion/director/plan';
import P from '@/render3d/core/motion/director/params.json';
import { bestOf, cpuMicros, cpuMsPerCall, skipOverBudgetWhenLoaded } from '../../support/timing';
import { anchorsFor, delivery, idleAnchors, randomSpec, rng, STOCK } from './world';
import { record, recordFile, stats } from './gates';

recordFile('cost');

const load = () => loadavg()[0];
const planBytes = (p: ReturnType<typeof prepare>) =>
  p.fix.byteLength + p.blink.byteLength + p.micro.byteLength + p.draw.byteLength + p.amp.byteLength;

describe('G-cost: sample', () => {
  const d = delivery(STOCK);
  const striker = prepare(anchorsFor(d, { role: 'striker', key: 'cost#0.1' }));
  const bowler = prepare(anchorsFor(d, { role: 'bowler', key: 'cost#0.1', series: 'pace' }));

  it('takes under 5 microseconds a frame per actor (up to 3,000,000 reads at scattered times in rounds of 1,000,000; the least round counts)', (ctx) => {
    const BUDGET_NS = 5_000;
    const out = createOut();
    // CPU nanoseconds a call over n reads of one plan.
    const run = (plan: typeof striker, n: number) => {
      const t0 = cpuMicros();
      for (let i = 0; i < n; i++) sample(plan, 300 + (i % 7000) * 1.03, out);
      return ((cpuMicros() - t0) * 1e3) / n;
    };
    run(striker, 300_000); // warm
    const ns = [
      bestOf(3, () => run(striker, 1_000_000), BUDGET_NS),
      bestOf(3, () => run(bowler, 1_000_000), BUDGET_NS),
    ];
    const l = load();
    record('sample', { nsPerCall: ns, loadAverage1m: l, indicativeOnly: l > 20, node: process.version });
    skipOverBudgetWhenLoaded(ctx, 'Director sample, nanoseconds a call', Math.max(...ns), BUDGET_NS, 'ns', l);
    expect(Math.max(...ns)).toBeLessThan(BUDGET_NS);
  }, 60_000);

  it('allocates nothing per frame: the heap does not grow over 3,000,000 reads', () => {
    v8.setFlagsFromString('--expose-gc');
    const gc = vm.runInNewContext('gc') as () => void;
    const out = createOut();
    for (let i = 0; i < 300_000; i++) sample(striker, 300 + (i % 7000), out);
    gc();
    gc();
    const before = process.memoryUsage().heapUsed;
    const n = 3_000_000;
    for (let i = 0; i < n; i++) sample(striker, 300 + (i % 7000) * 1.03, out, 2);
    gc();
    gc();
    const delta = process.memoryUsage().heapUsed - before;
    record('heapDeltaBytesOver3e6Calls', delta);
    expect(delta).toBeLessThan(4096);
  }, 60_000);

  it('a plan is data: no function, no object graph, only typed arrays and numbers (so it can be cached and copied)', () => {
    for (const p of [striker, bowler]) {
      for (const [k, v] of Object.entries(p)) {
        expect(typeof v === 'function', k).toBe(false);
        if (typeof v === 'object') expect(ArrayBuffer.isView(v), k).toBe(true);
      }
    }
  });
});

describe('G-cost: prepare, off the frame path', () => {
  it('takes a few milliseconds a delivery per actor (script of 9 s) and a few more for a minute of standing', (ctx) => {
    const DELIVERY_MS = 3;
    const PLAN_ONLY_MS = 0.5;
    const STANDING_MS = 15;
    const d = delivery(STOCK);
    const a = anchorsFor(d, { role: 'striker', key: 'cost#0.2' });
    const b = anchorsFor(d, { role: 'bowler', key: 'cost#0.2', series: 'pace' });
    for (let i = 0; i < 30; i++) {
      prepare(a);
      prepare(b);
    }
    // CPU milliseconds a call, the least of up to five rounds (a round already inside its budget settles that budget).
    const time = (f: () => void, n: number, budget: number) => bestOf(5, () => cpuMsPerCall(f, n), budget);
    const delivered = Math.max(
      time(() => prepare(a), 100, DELIVERY_MS),
      time(() => prepare(b), 100, DELIVERY_MS),
    );
    const planOnly = Math.max(
      time(() => buildEvents(a), 300, PLAN_ONLY_MS),
      time(() => buildEvents(b), 300, PLAN_ONLY_MS),
    );
    const standing = time(() => prepare(idleAnchors('striker', 'cost#idle', 60_000)), 10, STANDING_MS);
    const l = load();
    record('prepare', {
      deliveryMs: delivered,
      planOnlyMs: planOnly,
      scriptMs: d.timeline.end,
      standing60sMs: standing,
      loadAverage1m: l,
      indicativeOnly: l > 20,
    });
    skipOverBudgetWhenLoaded(ctx, 'Director prepare, a delivery per actor', delivered, DELIVERY_MS, 'ms', l);
    skipOverBudgetWhenLoaded(ctx, 'Director buildEvents, a delivery per actor', planOnly, PLAN_ONLY_MS, 'ms', l);
    skipOverBudgetWhenLoaded(ctx, 'Director prepare, a minute of standing', standing, STANDING_MS, 'ms', l);
    expect(delivered).toBeLessThan(DELIVERY_MS);
    expect(planOnly).toBeLessThan(PLAN_ONLY_MS);
    expect(standing).toBeLessThan(STANDING_MS);
  }, 60_000);
});

describe('budgets: plan, trace, parameters, code', () => {
  it('a delivery plan is under 1.5 kB with about 22 events; a minute standing is under 3 kB', () => {
    const r = rng(5);
    const bytes: number[] = [];
    const events: number[] = [];
    for (let k = 0; k < 200; k++) {
      for (const role of ['bowler', 'striker'] as const) {
        const p = prepare(anchorsFor(delivery(randomSpec(r)), { role, key: `size#${k}`, series: 'pace' }), { hz: 60 });
        bytes.push(planBytes(p));
        events.push(p.fix.length / 5 + p.blink.length / 6 + p.micro.length / 3);
      }
    }
    const stand = planBytes(prepare(idleAnchors('striker', 'size#idle', 60_000)));
    record('planBytes', { delivery: stats(bytes), events: stats(events), standing60s: stand });
    expect(Math.max(...bytes)).toBeLessThan(1500);
    expect(stats(events).p50).toBeGreaterThanOrEqual(15);
    expect(stats(events).p50).toBeLessThanOrEqual(30);
    expect(stand).toBeLessThan(3000);
  });

  it('the trace is CHANNELS (24) Int16 values a frame: 2,880 bytes a second at 60 Hz', () => {
    const p = prepare(idleAnchors('striker', 'size#trace', 10_000));
    expect(CHANNELS).toBe(24);
    expect(p.trace).toBeInstanceOf(Int16Array);
    expect(p.trace.byteLength).toBe(p.n * 24 * 2);
    expect(p.n).toBe(601);
    record('traceBytes', { perSecond: 24 * 2 * 60, tenSeconds: p.trace.byteLength });
  });

  // P3 (fidgets, the reaction, the expressions) took the file from 2.8 to 4.5 kB: the cap is 6 kB, inside the same 40 kB / 15 kB code budget below.
  it('params.json is at most 6 kB, valid, finite, and states its units', () => {
    const file = `${process.cwd()}/src/render3d/core/motion/director/params.json`;
    const bytes = statSync(file).size;
    record('paramsJsonBytes', bytes);
    expect(bytes).toBeLessThanOrEqual(6144);
    expect(typeof (P as { _: string })._).toBe('string');
    expect((P as { _: string })._).toMatch(/Units follow each key's suffix/);
    const walk = (o: unknown, path: string) => {
      if (typeof o === 'number') expect(Number.isFinite(o), path).toBe(true);
      else if (Array.isArray(o)) o.forEach((v, i) => walk(v, `${path}[${i}]`));
      else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) walk(v, `${path}.${k}`);
    };
    walk(JSON.parse(readFileSync(file, 'utf8')), 'params');
  });

  it('the public surface is what P2 plugs into (names guarded)', () => {
    for (const name of [
      'prepare',
      'sample',
      'detailForPx',
      'createOut',
      'CH',
      'CHANNELS',
      'SCALE',
      'DRAW',
      'AMP',
      'deliveryTakeKey',
      'fnv1a32',
      'mix',
      'u01',
      'personKey',
      'ballKey',
    ])
      expect(api, name).toHaveProperty(name);
  });

  it('the director, minified and tree-shaken with its parameter file and the stage binding, is at most 40 kB raw and 15 kB gzip (the lazy stage chunk budget)', async () => {
    // The app's own bundler (Vite) in library mode, in memory: the same minifier and JSON handling as the production build
    // (as an IIFE, because Vite keeps the whitespace of ES library builds). The stage modules the binding imports (actors,
    // choreo, clips) are existing code in the same lazy chunk: external here, so only the Director itself is counted.
    // The bound: it was 16 kB for the core alone in P1; the lead's ruling after P1 (UNIFIED-SPEC.md, "Rulings after P1", 1:
    // 2026-11-07 ~04:35Z) lets the whole director, binding included, use up to 40 kB raw / 15 kB gzip.
    const { build } = await import('vite');
    const cwd = process.cwd();
    const res = (await build({
      configFile: false,
      logLevel: 'silent',
      root: cwd,
      resolve: { alias: { '@': `${cwd}/src` } },
      build: {
        write: false,
        minify: true,
        lib: {
          entry: `${cwd}/src/render3d/core/motion/director/index.ts`,
          formats: ['iife'],
          name: 'Director',
          fileName: 'director',
        },
        rollupOptions: {
          external: (id: string) =>
            /render3d\/core\/(actors|choreo|clips|fieldClips|locomotion|skeleton|math)(\.ts)?$/.test(id),
          output: { globals: () => 'X' },
        },
      },
    })) as { output: { code: string }[] } | { output: { code: string }[] }[];
    const code = (Array.isArray(res) ? res[0] : res).output[0].code;
    const min = Buffer.byteLength(code);
    const gz = gzipSync(code).length;
    record('bundle', {
      minifiedBytes: min,
      gzipBytes: gz,
      bundler: 'vite build (lib, iife, minify, stage modules external), in memory',
    });
    expect(min).toBeGreaterThan(8 * 1024); // it did bundle the director, not an empty file
    expect(min).toBeLessThanOrEqual(40 * 1024);
    expect(gz).toBeLessThanOrEqual(15 * 1024);
  }, 120_000);
});

describe('detail by head size', () => {
  it('drops what is too small to see and does not flicker at the thresholds (15% hysteresis)', () => {
    expect(api.detailForPx(8)).toBe(0);
    expect(api.detailForPx(20)).toBe(1);
    expect(api.detailForPx(45)).toBe(2);
    expect(api.detailForPx(12.5, 0)).toBe(0); // a head just over 12 px does not turn the eyes on yet ...
    expect(api.detailForPx(11, 1)).toBe(1); // ... and just under it does not turn them off
    expect(api.detailForPx(13.7, 0)).toBe(0);
    expect(api.detailForPx(13.9, 0)).toBe(1);
    // P3: the expressions turn on at a 38 px head (lids and brows are not readable below it): in at 43.7 px, out at 32.3 px
    expect(api.detailForPx(43.6, 1)).toBe(1);
    expect(api.detailForPx(43.8, 1)).toBe(2);
    expect(api.detailForPx(32.4, 2)).toBe(2);
    expect(api.detailForPx(32.2, 2)).toBe(1);
    expect(api.detailForPx(37, 0)).toBe(1); // a head not shown before is judged on its size alone ...
    expect(api.detailForPx(38)).toBe(2); // ... and 38 px is the first with a face
  });

  it('sample honours the level: 0 keeps head and life only, 1 adds eyes and lids, 2 adds expressions', () => {
    const d = delivery({ ...STOCK, outcome: 'four' });
    const p = prepare(anchorsFor(d, { role: 'striker', key: 'detail#0.1' }), { hz: 60 });
    const out = createOut();
    const t = d.timeline.release + 700;
    api.sample(p, t, out, 2);
    const full = Array.from(out);
    api.sample(p, t, out, 0);
    for (let c = api.CH.eyeYawL; c <= api.CH.lidFollow; c++) expect(out[c]).toBe(0);
    expect(out[api.CH.headYaw]).toBe(full[api.CH.headYaw]);
    expect(out[api.CH.gazeYaw]).toBe(full[api.CH.gazeYaw]);
    api.sample(p, t, out, 1);
    expect(out[api.CH.eyeYawL]).toBe(full[api.CH.eyeYawL]);
  });
});
