/**
 * Performance, as supporting evidence only (phones are the evidence: docs/PRACTICE_FIDELITY.md): frame statistics
 * per delivery from the stage itself, long tasks during the delivery, shader programs compiled during the delivery
 * (stutter), a real touch's input-to-bat latency, and memory, on this machine's GPU, with the CPU throttled 4× as a
 * mid-range phone proxy, and on SwiftShader.
 */
import { context, isTouchVp, hookState, log, newPage, queue, sleep, waitFor, writeJson } from '../lib/env.mjs';
import { find, press } from '../lib/driver.mjs';
import { tryPress } from './capture.mjs';

const PROGRAMS = () => {
  const st = window.__eval.stage();
  const s3 = st && (st.stage?.renderer ? st.stage : null);
  return s3?.renderer?.info?.programs?.length ?? null;
};

async function session(browser, args, { vp, tier, throttle = 1, label, touchSwing = true }) {
  const ctx = await context(browser, vp, { hooks: { tier, timeScale: 1, seed: `eval-perf-${tier}`, autoNext: true }, storage: { 'vc:practice:settings': { v: 1, guidedDone: true, demoSeen: true } } });
  const page = await newPage(ctx, []);
  const cdp = await ctx.newCDPSession(page);
  const touch = isTouchVp(vp);
  const balls = [];
  try {
    if (throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
    await page.goto(args.base + '/practice');
    await sleep(1500);
    await page.evaluate(() => {
      window.__evalLong = [];
      try {
        new PerformanceObserver((l) => window.__evalLong.push(...l.getEntries().map((e) => ({ t: e.startTime, d: e.duration })))).observe({ type: 'longtask', buffered: false });
      } catch {
        /* no long task API */
      }
    });
    const q = await find(page, 'quick', { reject: (l) => /random over/i.test(l) && !/quick/i.test(l) });
    if (q) await press(page, q, touch);
    for (let i = 0; i < 6; i++) if (!(await tryPress(page, touch, ['practice-setup-play', 'practice-play-start', 'practice-start', 'practice-tap-go']))) break;
    for (let n = 0; n < 3; n++) {
      if (!touchSwing || !touch) await queue(page, { kind: 'defend', contactErrorMs: 0 });
      if (!(await waitFor(page, ['runup'], 60_000))) break;
      const p0 = await page.evaluate(PROGRAMS);
      const t0 = await page.evaluate(() => performance.now());
      await waitFor(page, ['live'], 30_000);
      let latency = null;
      if (touchSwing && touch) {
        // A real touch on the gesture surface ~0.25 s after release: the stage reports input → first moving-bat frame.
        await sleep(250);
        const box = await page.locator('[role="application"]').boundingBox().catch(() => null);
        if (box) {
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height * 0.7 }] });
          await sleep(60);
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        }
      }
      await waitFor(page, ['coaching', 'dead', 'playing'], 30_000);
      await sleep(300);
      const s = await page.evaluate(([t]) => {
        const st = window.__eval.stage()?.stats?.() ?? null;
        const long = (window.__evalLong || []).filter((e) => e.t >= t);
        return { stats: st, longTasks: long.length, longestTaskMs: long.length ? Math.round(Math.max(...long.map((e) => e.d))) : 0, heapMb: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null };
      }, [t0]);
      const p1 = await page.evaluate(PROGRAMS);
      latency = s.stats?.lastInputToBatMs ?? null;
      balls.push({ n, ...s, programsCompiledDuringDelivery: p0 !== null && p1 !== null ? p1 - p0 : null, inputToBatMs: latency, last: (await hookState(page))?.last });
      await tryPress(page, touch, ['practice-next-ball', 'practice-result-next'], [/^next ball$/i]);
    }
    return { label, vp, tier, throttle, stage: (await hookState(page))?.stage, balls };
  } catch (e) {
    return { label, vp, tier, throttle, error: String(e).slice(0, 300), balls };
  } finally {
    await ctx.close();
  }
}

export async function runPerf(B, args) {
  const runs = [];
  for (const [kind, opts] of [
    ['hw', { vp: '915x412', tier: 'full', label: 'gpu-phone-viewport' }],
    ['hw', { vp: '1920x1080', tier: 'full', label: 'gpu-large-viewport', touchSwing: false }],
    ['hw', { vp: '915x412', tier: 'full', throttle: 4, label: 'gpu-cpu4x-proxy' }],
    ['hw', { vp: '915x412', tier: 'below', label: 'gpu-classic' }],
    ['sw', { vp: '915x412', tier: 'full', label: 'swiftshader-first-person' }],
    ['sw', { vp: '915x412', tier: 'below', label: 'swiftshader-classic' }],
  ]) {
    log(args, `perf ${opts.label}`);
    runs.push(await session(await B.get(kind), args, opts));
  }
  const summary = Object.fromEntries(
    runs.map((r) => [
      r.label,
      {
        stage: r.stage,
        fps: r.balls.map((x) => x.stats?.fps ?? null),
        p95FrameMs: r.balls.map((x) => x.stats?.p95FrameMs ?? null),
        spikes: r.balls.map((x) => x.stats?.spikes ?? null),
        longestTaskMs: r.balls.map((x) => x.longestTaskMs),
        programsCompiledDuringDelivery: r.balls.map((x) => x.programsCompiledDuringDelivery),
        inputToBatMs: r.balls.map((x) => x.inputToBatMs),
        error: r.error ?? null,
      },
    ]),
  );
  const file = writeJson(args, 'perf', { summary, runs });
  log(args, `perf → ${file}`);
  return summary;
}
