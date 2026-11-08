/**
 * Shared pieces of the Practice performance harness (scripts/perf/practice-frames.mjs, docs/PERFORMANCE.md):
 * graphics and viewport profiles, the browser, seeding a device check, driving the real UI to a delivery, real touch
 * input through CDP, and the analysis of the passive recorder's data (scripts/perf/observer.js).
 *
 * Nothing here changes how the app renders. The harness only clicks, touches, reads, and (for the forced-profile runs)
 * stores a device check that earned Premium so that settings may pick any profile, as a player could on such a device.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, chromium } from './serve.mjs';

export const OBSERVER = join(ROOT, 'scripts/perf/observer.js');
export const APP_VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;

/** How the browser draws WebGL. Headless Chromium; the Metal path is the Mac's real GPU (60 Hz synthetic vsync). */
export const GPUS = {
  metal: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
  swiftshader: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
};

/**
 * Landscape viewports (CSS px) at realistic device-pixel ratios: the rubric's matrix (640×360, 844×390, 915×412,
 * 1280×800, 1920×1080) plus 1280×720 and 2400×1080.
 */
export const VIEWPORTS = {
  small: { width: 640, height: 360, dpr: 2, mobile: true, what: '720p phone (1280×720 panel, 640×360 CSS at 2×)' },
  common: { width: 844, height: 390, dpr: 3, mobile: true, what: 'common phone (2532×1170 panel, 844×390 CSS at 3×)' },
  phone: { width: 915, height: 412, dpr: 2.625, mobile: true, what: 'FHD+ phone (1080×2400 panel, 915×412 CSS at 2.625×)' },
  tablet: { width: 1280, height: 800, dpr: 1.5, mobile: true, what: 'tablet (1920×1200 panel, 1280×800 CSS at 1.5×)' },
  hd: { width: 1280, height: 720, dpr: 1.5, mobile: true, what: '1280×720 CSS at 1.5× (1920×1080 panel)' },
  desktop: { width: 1920, height: 1080, dpr: 1, mobile: false, what: 'desktop window, 1920×1080 at 1×' },
  wide: { width: 2400, height: 1080, dpr: 1, mobile: false, what: 'desktop window, 2400×1080 CSS at 1×' },
};

export async function launch(gpu) {
  const pw = await chromium();
  return pw.launch({ headless: true, args: GPUS[gpu] ?? GPUS.metal });
}

/** A device check that earned Premium (High), in the cache format of src/perf/cache.ts. */
export function premiumAssessment(renderer) {
  return { webgl2: true, hardware: true, renderer, shaderCompileMs: 0, avgFps: 60, p95FrameMs: 16.7, spikes: 0, contextLosses: 0, inputToFrameMs: 20, memoryGb: 8, tier: 'full', profile: 'high', reasons: ['high_headroom'], toleranceMs: 0 };
}

/**
 * A fresh context for one run. `quality` 'auto' leaves the device check to run for real; any other choice stores a
 * Premium device check and picks that profile in Practice settings. `noGl` skips the WebGL recorder (A/B of its cost).
 */
export async function newRun(browser, vp, { quality = 'auto', renderer = 'harness', noGl = false, offline = false, settings = {}, appSettings = {} } = {}) {
  const v = VIEWPORTS[vp] ?? vp;
  const context = await browser.newContext({ viewport: { width: v.width, height: v.height }, deviceScaleFactor: v.dpr, isMobile: v.mobile, hasTouch: true, serviceWorkers: 'block' });
  await context.addInitScript(
    ([q, assessment, version, extra, app, noGlFlag]) => {
      if (noGlFlag) window.__perfNoGl = true;
      try {
        if (!sessionStorage.getItem('perf-seeded')) {
          sessionStorage.setItem('perf-seeded', '1');
          if (assessment) localStorage.setItem('vc:practice:perf', JSON.stringify({ v: 1, appVersion: version, assessment }));
          localStorage.setItem('vc:practice:settings', JSON.stringify({ v: 1, quality: q, guidedDone: true, demoSeen: true, hintsShown: 99, ...extra }));
          localStorage.setItem('vc:settings', JSON.stringify({ locale: 'en', reducedMotion: 'off', sound: true, haptics: true, quality: 'auto', textScale: 1, highContrast: false, ...app }));
        }
      } catch {
        /* storage blocked */
      }
    },
    [quality, quality === 'auto' ? null : premiumAssessment(renderer), APP_VERSION, settings, appSettings, noGl],
  );
  await context.addInitScript({ path: OBSERVER });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  const requests = [];
  page.on('request', (r) => requests.push({ t: Date.now(), url: r.url(), type: r.resourceType() }));
  if (offline) await context.route('**', (r) => r.abort());
  return { context, page, cdp, requests, viewport: v };
}

/** The phase now: [screen, phase, stage, tier] from the recorder (the play screen's data attributes or the test API). */
export async function phaseNow(page) {
  return page.evaluate(() => {
    const p = window.__perf?.phases.at(-1);
    return p ? { screen: p[1], phase: p[2], stage: p[3], tier: p[4] } : null;
  });
}

// Buttons that move Practice on towards a bowled ball, for the current UI and the one being built.
const FORWARD = ['launch-practice', 'practice-resume', 'practice-continue', 'practice-quick', 'practice-random', 'practice-play-start', 'practice-radar-go', 'practice-tap-go', 'practice-next-ball', 'practice-next-over', 'practice-new-innings', 'practice-start-over', 'practice-classic', 'practice-turn-continue', 'practice-discard-dialog-confirm'];
// Per-page delivery cursor: a slow CDP response can arrive after run-up and release have already passed. Remember
// the recorded delivery, rather than clicking through its result and accidentally measuring a different ball.
const deliveryCursors = new WeakMap();

/** From wherever the app is to the next run-up (or live ball), through the real UI. Returns the buttons pressed. */
export async function toDelivery(page, { timeoutMs = 120_000, log = () => {} } = {}) {
  const pressed = [];
  const until = Date.now() + timeoutMs;
  const initial = await page.evaluate(() => window.__perf.phases);
  let from = initial.length;
  if (['runup', 'live', 'playing'].includes(initial.at(-1)?.[2])) {
    const index = initial.findLastIndex((p) => p[2] === 'runup');
    from = index >= 0 ? index : initial.length - 1;
  }
  while (Date.now() < until) {
    const started = await page.evaluate((start) => {
      const phases = window.__perf.phases;
      return phases.findIndex((p, i) => i >= start && ['runup', 'live', 'playing'].includes(p[2]));
    }, from);
    if (started >= 0) {
      deliveryCursors.set(page, started);
      return pressed;
    }
    const id = await page
      .evaluate((ids) => {
        for (const id of ids) {
          const el = document.querySelector(`[data-testid="${id}"]`);
          if (el && !el.disabled && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden') return id;
        }
        return null;
      }, FORWARD)
      .catch(() => null);
    if (id && !pressed.includes(id)) {
      log('tap', id);
      pressed.push(id);
      // A successful SPA action is established by the recorded delivery, not an unrelated navigation epilogue.
      // Never silently retry a timeout: a dispatched Play may already be preparing its one delivery.
      await page.getByTestId(id).first().click({ timeout: 10_000, noWaitAfter: true });
      await page.waitForTimeout(300);
    } else await page.waitForTimeout(200);
  }
  throw new Error(`no delivery within ${timeoutMs} ms (pressed ${pressed.join(', ')})`);
}

/** Resolves with the page time at which the phase became one of `phases` (now, if it already is); null on timeout. */
export async function waitPhase(page, phases, timeoutMs = 60_000) {
  return page.evaluate(
    ([want, ms, cursor]) =>
      new Promise((resolve) => {
        const P = window.__perf;
        const start = cursor ?? Math.max(0, P.phases.length - 1);
        const t0 = performance.now();
        const check = () => {
          for (let i = start; i < P.phases.length; i++) if (want.includes(P.phases[i][2])) return resolve(P.phases[i][0]);
          if (performance.now() - t0 > ms) return resolve(null);
          setTimeout(check, 5);
        };
        check();
      }),
    [phases, timeoutMs, deliveryCursors.get(page)],
  );
}

/** The centre of the armed gesture surface (src/input GestureSurface) in CSS px. */
export async function surfaceCentre(page) {
  const box = await page.locator('[role=application][data-armed]').first().boundingBox();
  return box ? { x: box.x + box.width / 2, y: box.y + box.height * 0.6 } : null;
}

/** A real touch through the browser's input pipeline (CDP): a tap (defend) or an upward flick (attack). */
export async function touch(cdp, at, kind = 'tap', dirDeg = 0) {
  const pt = (x, y) => [{ x, y, radiusX: 6, radiusY: 6, force: 1, id: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(at.x, at.y) });
  if (kind === 'flick') {
    const r = (dirDeg * Math.PI) / 180;
    for (let i = 1; i <= 5; i++) {
      await new Promise((ok) => setTimeout(ok, 8));
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(at.x + Math.sin(r) * 16 * i, at.y - Math.cos(r) * 16 * i) });
    }
  } else await new Promise((ok) => setTimeout(ok, 30));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

/** The test API's observation-only reads, when the build has them (null otherwise). */
export async function hookReads(page) {
  return page.evaluate(() => {
    const api = window.__vandePractice;
    if (!api) return null;
    const safe = (f) => {
      try {
        return f();
      } catch {
        return null;
      }
    };
    return { state: safe(() => api.state()), stats: safe(() => api.stats?.() ?? null), sessionFps: safe(() => api.sessionFps?.() ?? null), flight: safe(() => api.lastFlight()) };
  });
}

export async function heap(cdp, gc = false) {
  if (gc) await cdp.send('HeapProfiler.collectGarbage').catch(() => {});
  const { metrics } = await cdp.send('Performance.getMetrics');
  const m = Object.fromEntries(metrics.map((x) => [x.name, x.value]));
  return { jsUsedMb: round(m.JSHeapUsedSize / 2 ** 20, 1), jsTotalMb: round(m.JSHeapTotalSize / 2 ** 20, 1), nodes: m.Nodes, listeners: m.JSEventListeners, documents: m.Documents };
}

export const round = (v, d = 0) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : null);
export const pct = (xs, p) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
};

/** Frame statistics over the rAF timestamps inside [from, to). */
export function frameWindow(frames, from, to) {
  const ts = frames.filter((t) => t >= from && t < to);
  const iv = ts.slice(1).map((t, i) => t - ts[i]);
  if (!iv.length) return { frames: 0 };
  const sum = iv.reduce((s, v) => s + v, 0);
  let minWin = Infinity;
  for (let i = 0, j = 0, acc = 0; i < iv.length; i++) {
    while (j < iv.length && acc < 1000) acc += iv[j++];
    if (acc < 1000) break;
    minWin = Math.min(minWin, ((j - i) / acc) * 1000);
    acc -= iv[i];
  }
  return {
    frames: iv.length,
    ms: round(sum),
    avgFps: round((iv.length / sum) * 1000, 1),
    avgMs: round(sum / iv.length, 1),
    p95Ms: round(pct(iv, 95), 1),
    p99Ms: round(pct(iv, 99), 1),
    worstMs: round(Math.max(...iv), 1),
    over33: iv.filter((v) => v > 1000 / 30 + 1).length,
    over50: iv.filter((v) => v > 50).length,
    minWindowFps: Number.isFinite(minWin) ? round(minWin, 1) : round((iv.length / sum) * 1000, 1),
  };
}

/** Deliveries from the phase log: run-up start, release (live), dead ball (the first phase after playing). */
export function deliveries(phases) {
  const out = [];
  let cur = null;
  for (const [t, _screen, phase, stage, tier] of phases) {
    if (phase === 'runup' && (!cur || cur.dead !== null)) {
      cur = { runup: t, release: null, playing: null, dead: null, stage, tier };
      out.push(cur);
    } else if (!cur || cur.dead !== null) continue;
    else if (phase === 'live' && cur.release === null) cur.release = t;
    else if (phase === 'playing' && cur.playing === null) cur.playing = t;
    else if (phase !== 'runup' && phase !== 'live' && phase !== 'playing') {
      cur.dead = t;
      cur.after = phase;
    }
  }
  return out.filter((d) => d.release !== null && d.dead !== null);
}

/** Entries [t, …] inside [from, to). */
export const within = (list, from, to) => list.filter((e) => e[0] >= from && e[0] < to);
