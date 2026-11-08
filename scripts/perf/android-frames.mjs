/**
 * Android frame capture for scripts/android-practice.mjs (docs/PERFORMANCE.md, "Android"): the passive recorder
 * (scripts/perf/observer.js) inside the app's real WebView, `dumpsys gfxinfo` per delivery (the OS's own count of
 * presented and janky frames), real touches through Android's input pipeline (`adb shell input`), backgrounding
 * between balls, and a stretch of play with the network switched off.
 */
import { readFileSync } from 'node:fs';
import { deliveries, frameWindow, round, waitPhase, within } from './practice-lib.mjs';

const OBSERVER_SRC = readFileSync(new URL('./observer.js', import.meta.url), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Reloads the app with the recorder installed before any app script (so it sees every WebGL context). */
export async function installObserver(page) {
  await page.addInitScript(OBSERVER_SRC);
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => Boolean(window.__perf), undefined, { timeout: 30_000 });
}

/** `dumpsys gfxinfo <pkg>`: the frames the app presented since the last reset, and how many were janky. */
export function parseGfx(text) {
  const num = (re) => {
    const m = text.match(re);
    return m ? Number(m[1]) : null;
  };
  return {
    frames: num(/Total frames rendered: (\d+)/),
    janky: num(/Janky frames: (\d+)/),
    p50: num(/50th percentile: (\d+)ms/),
    p90: num(/90th percentile: (\d+)ms/),
    p95: num(/95th percentile: (\d+)ms/),
    p99: num(/99th percentile: (\d+)ms/),
    missedVsync: num(/Number Missed Vsync: (\d+)/),
    slowUi: num(/Number Slow UI thread: (\d+)/),
    deadlineMissed: num(/Number Frame deadline missed: (\d+)/),
    gpuP95: num(/50th gpu percentile: \d+ms[\s\S]*?95th gpu percentile: (\d+)ms/),
  };
}

/** Phase now, from the recorder. */
const phase = (page) => page.evaluate(() => window.__perf?.phases.at(-1)?.[2] ?? null).catch(() => null);

/** Waits until the phase is one of `want`; its page time, or null. */
const until = (page, want, ms) => waitPhase(page, want, ms).catch(() => null);

/**
 * Plays `n` deliveries with real adb touches (a tap in the gesture surface timed for the ideal contact, the command's
 * own latency allowed for), resetting gfxinfo at each run-up. `forward()` taps the app on towards the next run-up.
 */
export async function playMeasured(page, { shell, pkg, n, forward, screen, log }) {
  const out = [];
  for (let i = 0; i < n; i++) {
    await forward(`ball ${i + 1}`);
    await shell(`dumpsys gfxinfo ${pkg} reset`);
    const rel = await until(page, ['live'], 180_000);
    const flight = await page.evaluate(() => window.__vandePractice?.lastFlight?.() ?? null).catch(() => null);
    // `input tap` takes about 150–300 ms to reach the app on an emulator: start it that much earlier.
    const contactIn = flight ? flight.idealContactT * 1000 - 120 - 220 : 250;
    if (rel !== null) {
      await sleep(Math.max(0, contactIn));
      if (i % 6 !== 5) await shell(`input tap ${Math.round(screen.w * 0.5)} ${Math.round(screen.h * 0.84)}`);
    }
    const dead = await until(page, ['dead', 'closeup', 'coaching', 'paused', 'idle', 'warmup_explain', 'replay'], 180_000);
    const gfx = parseGfx(await shell(`dumpsys gfxinfo ${pkg}`));
    const stats = await page.evaluate(() => window.__vandePractice?.stats?.() ?? null).catch(() => null);
    out.push({ i: i + 1, release: rel, dead, gfx, stats, phase: await phase(page) });
    log(`ball ${i + 1}: gfx ${gfx.frames} frames, ${gfx.janky} janky, p95 ${gfx.p95} ms${stats ? ` · stage ${stats.fps} fps, input→bat ${stats.lastInputToBatMs} ms` : ''}`);
  }
  const perf = await page.evaluate(() => ({ frames: window.__perf.frames, phases: window.__perf.phases, links: window.__perf.gl.links, longTasks: window.__perf.longTasks, buffers: window.__perf.buffers, gl: window.__perf.glSnapshot() }));
  const ds = deliveries(perf.phases);
  const windows = ds.map((d) => ({
    stage: d.stage,
    tier: d.tier,
    all: frameWindow(perf.frames, d.runup, d.dead),
    flight: frameWindow(perf.frames, d.release, d.dead),
    links: within(perf.links, d.runup, d.dead).length,
    // When each program was linked, ms after the release (negative: during the run-up).
    linkAt: within(perf.links, d.runup, d.dead).map((e) => round(e[0] - (d.release ?? d.runup))),
    longTasks: within(perf.longTasks, d.runup, d.dead).length,
    longTaskAt: within(perf.longTasks, d.runup, d.dead).map((e) => [round(e[0] - (d.release ?? d.runup)), round(e[1])]),
    buffers: within(perf.buffers ?? [], d.runup - 2000, d.dead).map((e) => [round(e[0] - (d.release ?? d.runup)), e[1]]),
  }));
  return { balls: out, windows, gl: perf.gl, linksBeforeFirst: perf.links.filter((e) => e[0] < (ds[0]?.runup ?? 0)).length };
}

/** One printable line per delivery: the WebView's frame cadence and the OS's frame counts. */
export function summarise(m) {
  return m.windows.map((w, k) => {
    const g = m.balls[k]?.gfx ?? {};
    return `#${k + 1} ${w.stage}/${w.tier} run-up→dead ${w.all.avgFps} fps p95 ${w.all.p95Ms} worst ${w.all.worstMs} >50ms ${w.all.over50} · flight ${w.flight.avgFps} fps · links ${w.links} · long tasks ${w.longTasks} · gfxinfo ${g.frames} frames, ${g.janky} janky, p90/p95/p99 ${g.p90}/${g.p95}/${g.p99} ms`;
  });
}

/** The innings as stored (localStorage), reduced to what must survive an interruption. */
export async function inningsKey(page) {
  return page
    .evaluate(() => {
      try {
        const s = JSON.parse(localStorage.getItem('vc:practice:innings') ?? 'null')?.state ?? null;
        return s ? { id: s.id, status: s.status, runs: s.runs, balls: s.balls, overs: s.overs?.length ?? 0, current: s.current?.deliveries?.length ?? null, inFlight: s.inFlight } : null;
      } catch {
        return null;
      }
    })
    .catch(() => null);
}

/** Network requests the WebView made to anywhere but the app's own local origin, from the Resource Timing buffer. */
export async function externalRequests(page, sincePerfMs = 0) {
  return page
    .evaluate((since) => {
      const own = location.origin;
      return performance
        .getEntriesByType('resource')
        .filter((e) => e.startTime >= since && !e.name.startsWith(own) && !e.name.startsWith('data:') && !e.name.startsWith('blob:'))
        .map((e) => e.name.slice(0, 120));
    }, sincePerfMs)
    .catch(() => ['(could not read)']);
}

export { round, sleep };
