/**
 * Practice frame-time harness (docs/PERFORMANCE.md): plays complete deliveries in the real app, batting with real touch
 * input through CDP, and reports per delivery the frame cadence from the run-up to dead ball, the release-to-dead-ball
 * window, long tasks, shader programs linked during the delivery, the stage's input-to-bat latency, the JS heap and
 * the WebGL memory the app allocated. The page is observed passively (scripts/perf/observer.js); nothing alters
 * rendering.
 *
 *   VITE_PRACTICE_TEST_HOOKS=1 npx vite build --outDir dist-perfh --emptyOutDir     (a build with the test API, unused
 *                                                                                    except for its read-only calls)
 *   node scripts/perf/practice-frames.mjs --dist dist-perfh --gpu metal --cpu 4 --viewport phone --quality auto
 *        [--deliveries 6] [--label x] [--out test-results-perf/harness] [--nogl] [--offline-after-start]
 *        [--gc-every 6] [--background-at 3] [--lose-context-at 4]
 *
 * --quality auto runs the real device check; high, standard, lite or classic store a Premium device check and pick
 * that profile in Practice settings (the session monitor still steps down as it would for a player).
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { ROOT, serveBuild } from './serve.mjs';
import {
  deliveries,
  frameWindow,
  heap,
  hookReads,
  launch,
  newRun,
  phaseNow,
  round,
  surfaceCentre,
  toDelivery,
  touch,
  waitPhase,
  within,
} from './practice-lib.mjs';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return dflt;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
};
const opt = {
  dist: arg('dist', 'dist-perfh'),
  gpu: arg('gpu', 'metal'),
  cpu: Number(arg('cpu', 1)),
  viewport: arg('viewport', 'phone'),
  quality: arg('quality', 'auto'),
  n: Number(arg('deliveries', 6)),
  out: arg('out', 'test-results-perf/harness'),
  label: arg('label', ''),
  noGl: Boolean(arg('nogl', false)),
  offlineAfterStart: Boolean(arg('offline-after-start', false)),
  gcEvery: Number(arg('gc-every', 0)),
  backgroundAt: Number(arg('background-at', 0)),
  loseContextAt: Number(arg('lose-context-at', 0)),
  verbose: Boolean(arg('verbose', false)),
  /** Every Nth ball is left alone (0: bat every ball, as the latency criterion wants swings). */
  leaves: Number(arg('leaves', 6)),
  /** How long to wait for the next delivery (a loaded machine is slow to answer). */
  patienceMs: Number(arg('patience', 120)) * 1000,
};
const name = opt.label || `${opt.gpu}-cpu${opt.cpu}-${opt.viewport}-${opt.quality}${opt.noGl ? '-nogl' : ''}`;
if (!/^[a-zA-Z0-9_.-]+$/.test(name) || !Number.isInteger(opt.n) || opt.n < 1 || !Number.isFinite(opt.cpu) || opt.cpu < 1) throw new Error('Invalid frame-run name, delivery count or CPU setting');
const output = resolve(ROOT, opt.out, `${name}.json`);
if (existsSync(output)) throw new Error(`Frame evidence exists; choose a new output directory: ${output}`);
const t0 = Date.now();
const log = (...a) => opt.verbose && console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
/** `uptime` (the rubric records it with every timing measurement: the machine is shared and loaded). */
const load = () => {
  try {
    return execSync('uptime', { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
};

// The swings, in turn: attacking flicks and defensive taps with small timing offsets around the ideal (ms). Every
// --leaves'th ball is left alone instead.
const PLAN = [
  { kind: 'flick', dir: 0, err: -20 },
  { kind: 'tap', err: 10 },
  { kind: 'flick', dir: -30, err: 30 },
  { kind: 'flick', dir: 25, err: -35 },
  { kind: 'tap', err: 0 },
];
/** Bat travel to the hitting area, roughly the physics' own (a tap 120 ms; an attacking swing a little longer). */
const TRAVEL = { tap: 120, flick: 150 };

const result = {
  name,
  opt,
  load: { start: load() },
  browser: null,
  started: new Date().toISOString(),
  deliveries: [],
  errors: [],
  pageErrors: [],
  consoleErrors: [],
  cleanupErrors: [],
};
let server, browser;
try {
  server = await serveBuild(opt.dist);
  browser = await launch(opt.gpu);
  result.browser = browser.version();
  const run = await newRun(browser, opt.viewport, {
    quality: opt.quality,
    noGl: opt.noGl,
  });
  const { page, cdp, requests } = run;
  // Uncaught page errors (the app's) are kept apart from the harness's own errors (result.errors).
  page.on('pageerror', (e) => result.pageErrors.push(String(e).slice(0, 300)));
  page.on('crash', () => result.pageErrors.push('Page crashed'));
  // Console errors are counted for the Stage 0 baseline ("crash and error count"); they do not stop a run.
  page.on('console', (m) => m.type() === 'error' && result.consoleErrors.push(m.text().slice(0, 200)));
  if (opt.cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: opt.cpu });
  await page.goto(`${server.url}/practice`, { waitUntil: 'load' });
  let blockedFrom = null;
  try {
    for (let i = 0; i < opt.n; i++) {
      const pressed = await toDelivery(page, {
        log,
        timeoutMs: opt.patienceMs,
      });
      if (i === 0 && opt.offlineAfterStart) {
        await run.context.route('**', (r) => r.abort());
        await run.context.setOffline(true);
        blockedFrom = requests.length;
        log('network blocked');
      }
      const rel = await waitPhase(page, ['live'], 90_000);
      const swing = opt.leaves > 0 && (i + 1) % opt.leaves === 0 ? { kind: 'leave' } : PLAN[i % PLAN.length];
      const reads = await hookReads(page);
      const flight = reads?.flight;
      let touchedAt = null;
      const inputAudit = { requested: swing.kind, targetMs: null, checkedAtMs: null, latenessMs: null, phase: null, armed: false, dispatched: false, observedSwing: null };
      if (rel !== null && swing.kind !== 'leave' && flight) {
        const at = await surfaceCentre(page);
        const target = rel + flight.idealContactT * 1000 - TRAVEL[swing.kind] + swing.err;
        const pnow = await page.evaluate(() => performance.now());
        const wait = target - pnow;
        if (wait > 0) await new Promise((ok) => setTimeout(ok, wait));
        const ready = await page.evaluate(() => ({
          now: performance.now(),
          phase: document.querySelector('[data-testid=practice-play]')?.getAttribute('data-phase') ?? null,
          armed: document.querySelector('[role=application]')?.getAttribute('data-armed') === 'true',
        }));
        Object.assign(inputAudit, { targetMs: target, checkedAtMs: ready.now, latenessMs: ready.now - target, phase: ready.phase, armed: ready.armed });
        if (at && ready.phase === 'live' && ready.armed) {
          touchedAt = ready.now;
          await touch(cdp, at, swing.kind, swing.dir ?? 0);
          inputAudit.dispatched = true;
        }
      }
      if (opt.backgroundAt && i + 1 === opt.backgroundAt) {
        // Backgrounding mid-delivery, as the app sees it on Android: the page is hidden, then shown again.
        await page.evaluate(() => {
          Object.defineProperty(document, 'visibilityState', {
            value: 'hidden',
            configurable: true,
          });
          document.dispatchEvent(new Event('visibilitychange'));
        });
        await cdp.send('Page.setWebLifecycleState', { state: 'frozen' }).catch(() => {});
        await new Promise((ok) => setTimeout(ok, 3000));
        await cdp.send('Page.setWebLifecycleState', { state: 'active' }).catch(() => {});
        await page.evaluate(() => {
          Object.defineProperty(document, 'visibilityState', {
            value: 'visible',
            configurable: true,
          });
          document.dispatchEvent(new Event('visibilitychange'));
        });
        result.background = { at: i + 1, phaseAfter: await phaseNow(page) };
        log('backgrounded and back', result.background.phaseAfter);
      }
      if (opt.loseContextAt && i + 1 === opt.loseContextAt) {
        const lost = await page.evaluate(() => {
          const c = window.__perf.gl.contexts.filter((x) => !x.lost && x.ref.deref()?.isConnected).at(-1);
          const gl = c && c.ref.deref().getContext(c.type);
          const ext = gl && gl.getExtension('WEBGL_lose_context');
          if (!ext) return false;
          ext.loseContext();
          setTimeout(() => ext.restoreContext(), 1500);
          return true;
        });
        result.contextLoss = { at: i + 1, lost };
        log('context lost', lost);
      }
      const dead = await waitPhase(page, ['dead', 'closeup', 'coaching', 'paused', 'idle', 'warmup_explain', 'replay'], 90_000);
      await page.waitForTimeout(150);
      const after = await hookReads(page);
      inputAudit.observedSwing = after?.state?.last?.swing ?? null;
      const gc = opt.gcEvery > 0 && (i + 1) % opt.gcEvery === 0;
      const h = await heap(cdp, gc);
      const gl = await page.evaluate(() => window.__perf.glSnapshot());
      result.deliveries.push({
        i: i + 1,
        utc: new Date().toISOString(),
        uptime: load(),
        pressed,
        swing,
        release: rel,
        dead,
        touchedAt,
        inputAudit,
        atRelease: {
          profile: reads?.stats?.profile ?? reads?.state?.profile ?? null,
          stage: reads?.state?.stage ?? null,
          tier: reads?.state?.tier ?? null,
        },
        stats: after?.stats ?? null,
        sessionFps: after?.sessionFps ?? null,
        state: after?.state ?? null,
        heap: { ...h, gc },
        gl,
      });
      log(
        `delivery ${i + 1}`,
        after?.state?.last ?? '',
        after?.stats ? `lat ${after.stats.lastInputToBatMs} fps ${after.stats.fps}` : '',
        `heap ${h.jsUsedMb} MB`,
      );
    }
  } catch (e) {
    // A failed delivery still leaves the recorder's data for the ones before it (and the phase log of the failure).
    result.errors.push(String(e?.stack ?? e).slice(0, 800));
  }
  const perf = await page.evaluate(() => ({
    frames: window.__perf.frames,
    phases: window.__perf.phases,
    longTasks: window.__perf.longTasks,
    loaf: window.__perf.loaf,
    links: window.__perf.gl.links,
    compiles: window.__perf.gl.compiles,
    waits: window.__perf.gl.waits,
    marks: window.__perf.marks,
    events: window.__perf.events ?? [],
    resources: window.__perf.resources ?? [],
    buffers: window.__perf.buffers ?? [],
  }));
  const assessment = await page.evaluate(() => {
    try {
      return JSON.parse(localStorage.getItem('vc:practice:perf') ?? 'null')?.assessment ?? null;
    } catch {
      return null;
    }
  });
  const ds = deliveries(perf.phases);
  result.assessment = assessment;
  result.phaseLog = perf.phases.map(([t, ...r]) => [round(t), ...r]);
  result.windows = ds.map((d, k) => {
    const all = frameWindow(perf.frames, d.runup, d.dead);
    const flight = frameWindow(perf.frames, d.release, d.dead);
    const lt = within(perf.longTasks, d.runup, d.dead);
    const lf = within(perf.loaf, d.runup, d.dead);
    const del = result.deliveries[k];
    const phasesIn = perf.phases.filter((p) => p[0] > d.runup && p[0] <= d.dead);
    return {
      k: k + 1,
      // The rubric's PERF1 window: from 1 s before release to the outcome (dead ball).
      perf1: frameWindow(perf.frames, d.release - 1000, d.dead),
      perf1Intervals: (() => {
        const ts = perf.frames.filter((t) => t >= d.release - 1000 && t < d.dead);
        return ts.slice(1).map((t, i) => round(t - ts[i], 2));
      })(),
      // PERF2: the stage, tier and drawing buffer never change between the run-up and dead ball; the profile is the
      // same at release and at dead ball.
      qualityChange:
        phasesIn.some((p) => p[3] !== d.stage || p[4] !== d.tier) ||
        within(perf.buffers, d.runup + 1, d.dead).length > 0 ||
        Boolean(del?.atRelease?.profile && del?.stats?.profile && del.atRelease.profile !== del.stats.profile),
      profile: del?.stats?.profile ?? null,
      // PERF4: resources fetched during the delivery.
      loads: within(perf.resources, d.runup, d.dead).map((e) => `${e[1]} ${e[2]}`),
      // CTL1 (proxy): the first pointerdown's Event Timing duration, from the event to the next presented frame.
      downToPaint: (within(perf.events, d.release ?? d.runup, d.dead).find((e) => e[1] === 'pointerdown') ?? [])[4] ?? null,
      stage: d.stage,
      tier: d.tier,
      runupToDeadMs: round(d.dead - d.runup),
      all,
      flight,
      links: within(perf.links, d.runup, d.dead).length,
      // When each program was linked, ms after the release (negative: during the run-up).
      linkAt: within(perf.links, d.runup, d.dead).map((e) => round(e[0] - (d.release ?? d.runup))),
      linkMs: round(
        within(perf.links, d.runup, d.dead).reduce((s, e) => s + e[1], 0),
        1,
      ),
      compiles: within(perf.compiles, d.runup, d.dead).length,
      slowWaits: within(perf.waits, d.runup, d.dead).map((w) => [round(w[1], 1), w[2]]),
      longTasks: lt.length,
      longTaskMaxMs: lt.length ? round(Math.max(...lt.map((e) => e[1]))) : 0,
      // The slowest animation frames, with when they started relative to the release (ms) and their slowest scripts.
      loafWorst: lf
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map((e) => ({
          at: round(e[0] - (d.release ?? d.runup)),
          ms: round(e[1]),
          blocking: round(e[2]),
          render: e[3],
          scripts: e[4],
        })),
      longTaskAt: lt.map((e) => [round(e[0] - (d.release ?? d.runup)), round(e[1])]),
      // Inputs during the delivery (Event Timing): [ms after release, type, input delay, handler ms, to next paint].
      inputs: within(perf.events, d.release ?? d.runup, d.dead)
        .filter((e) => /pointer|touch/.test(e[1]))
        .map((e) => [round(e[0] - (d.release ?? d.runup)), e[1], e[2], e[3], e[4]]),
    };
  });
  const first = ds[0]?.runup ?? 0;
  result.beforeFirst = {
    links: perf.links.filter((e) => e[0] < first).length,
    linkMs: round(perf.links.filter((e) => e[0] < first).reduce((s, e) => s + e[1], 0)),
    longTasks: perf.longTasks.filter((e) => e[0] < first).length,
  };
  result.betweenBalls = {
    links: perf.links.filter((e) => e[0] >= first && !ds.some((d) => e[0] >= d.runup && e[0] < d.dead)).length,
  };
  result.network =
    blockedFrom === null
      ? { blocked: false, total: requests.length }
      : {
          blocked: true,
          duringPlay: requests.slice(blockedFrom).map((r) => `${r.type} ${r.url.replace(server.url, '')}`),
        };
  result.requestsAfterStart = requests.filter((r) => r.t > t0).length;
  result.load.end = load();
} catch (e) {
  result.errors.push(String(e?.stack ?? e).slice(0, 800));
} finally {
  if (browser) try { await browser.close(); } catch (error) { result.cleanupErrors.push({ target: 'browser', message: String(error) }); }
  if (server) try { await server.close(); } catch (error) { result.cleanupErrors.push({ target: 'server', message: String(error) }); }
  result.finished = new Date().toISOString();
  result.load.end = load();
}

mkdirSync(resolve(ROOT, opt.out), { recursive: true });
const w = result.windows ?? [];
// Collection success only. PERF/CTL thresholds and device coverage require separate evaluation of the raw data.
// Errors and partial runs must never receive a successful process status merely because one delivery completed.
result.collectionPassed = result.deliveries.length === opt.n && w.length === opt.n &&
  !result.errors.length && !result.pageErrors.length && !result.consoleErrors.length && !result.cleanupErrors.length;
writeFileSync(output, JSON.stringify(result, null, 1), { flag: 'wx' });
const fmt = (x) => (x === null || x === undefined ? '–' : x);
console.log(
  `${name}: ${w.length}/${opt.n} deliveries, tier ${result.assessment?.tier ?? '–'}/${result.assessment?.profile ?? '–'} (${(result.assessment?.reasons ?? []).join(',')}) · load ${result.load.start} → ${result.load.end ?? ''}`,
);
for (const d of w) {
  const lat = result.deliveries[d.k - 1]?.stats?.lastInputToBatMs;
  console.log(
    `  #${d.k} ${d.stage}/${d.tier} run-up→dead ${d.all.avgFps} fps avg ${d.all.avgMs} p95 ${d.all.p95Ms} worst ${d.all.worstMs} >50ms ${d.all.over50} · flight ${fmt(d.flight.avgFps)} fps p95 ${fmt(d.flight.p95Ms)} worst ${fmt(d.flight.worstMs)} · links ${d.links} · long tasks ${d.longTasks} (max ${d.longTaskMaxMs}) · input→bat ${fmt(lat)} · heap ${result.deliveries[d.k - 1]?.heap.jsUsedMb} MB`,
  );
}
if (result.errors.length) console.log('  errors:', result.errors.slice(0, 3).join(' | '));
process.exitCode = result.collectionPassed ? 0 : 1;
