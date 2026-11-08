/**
 * Rookie adversarial machine checks (DUAL-CEILING-RUBRIC §3; evaluator evidence, never real-player evidence):
 *   RK3  ≥ 300 jittered novice touch gestures (tap, flick, leave) through the real GestureSurface (CDP touch)
 *   F5   a novice input model (timing N(0, 60 ms), direction ±30°) on Quick defaults: success within 6 balls, 50 seeds
 *   F6/RK4/COACH1  a failure-heavy run: every failure shows one plain reason and one next action
 *   RK5/COACH2/COACH4/COACH5  from a failure, the exact retry (taps counted), the recommended response executed by
 *        script on the identical ball, and the comparison language
 *   RK6  taps from the end of an over to the next over's first ball, and whether "another over" is the primary action
 */
import { context, hookState, log, newPage, queue, sleep, uptime, waitFor, writeJson } from '../lib/env.mjs';
import { find, press } from '../lib/driver.mjs';
import { tryPress } from './capture.mjs';

const VP = '915x412';
const PLAY_IDS = ['practice-setup-play', 'practice-play-start', 'practice-start', 'practice-tap-go'];
const RESULT_IDS = ['practice-result', 'practice-result-reason', 'practice-result-recommendation', 'practice-coaching', 'practice-why', 'practice-compare', 'practice-coach', 'practice-coach-recommendation', 'practice-mastery'];

// A seeded normal and uniform source, so the novice model is the same on every run.
function rng(seed) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return ((h >>> 0) % 1e9) / 1e9;
  };
}
const normal = (r) => Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r());

async function open(browser, args, hooks, path = '/practice') {
  const ctx = await context(browser, VP, { hooks, storage: { 'vc:practice:settings': { v: 1, guidedDone: true, demoSeen: true } } });
  const page = await newPage(ctx, []);
  await page.goto(args.base + path);
  await sleep(1500);
  await page.evaluate((ids) => window.__eval.recordTexts(ids), RESULT_IDS);
  return { ctx, page };
}

/** Quick (default) or another over kind; presses through setup to the first ball. */
async function startOver(page, kind = 'quick') {
  const t = await find(page, kind, kind === 'quick' ? { reject: (l) => /random over/i.test(l) && !/quick/i.test(l) } : {});
  if (t) await press(page, t, true);
  await sleep(600);
  if (kind === 'predefined') await tryPress(page, true, ['practice-build-start']);
  for (let i = 0; i < 8; i++) {
    const st = await hookState(page);
    if (st && ['ready', 'runup', 'live', 'radar'].includes(st.phase)) return true;
    if (!(await tryPress(page, true, PLAY_IDS))) await sleep(300);
  }
  return Boolean(t);
}

/** After a dead ball: the record, the coach insight once ready, and every result-layer text shown since `since`. */
async function afterBall(page, since) {
  for (let i = 0; i < 40; i++) {
    const ins = await page.evaluate(() => window.__eval.flow()?.getState().insight?.status ?? null).catch(() => null);
    if (ins === 'ready' || ins === 'failed' || ins === null) break;
    await sleep(100);
  }
  return page.evaluate((t) => {
    const st = window.__eval.flow()?.getState();
    const ins = st?.insight;
    const rec = ins?.analysis?.options?.find((o) => o.kind === 'recommended') ?? null;
    return {
      last: window.__vandePractice.state().last,
      insight: ins ? { status: ins.status, reason: ins.primary?.reason ?? null, recommendation: ins.primary?.recommendation ?? null, timingMs: ins.primary?.timingMs ?? null } : null,
      recommended: rec ? { swing: rec.swing, decision: rec.decision, outcome: rec.outcome, contact: rec.contact } : null,
      texts: window.__eval.readTexts(t),
      buttons: window.__eval.controls().filter((c) => c.reachable && !c.disabled).map((c) => c.name),
    };
  }, since);
}

const nowMs = (page) => page.evaluate(() => performance.now());
const failure = (l) => l && (l.dismissal || ['miss', 'inside_edge', 'outside_edge', 'top_edge', 'leading_edge', 'pad', 'body'].includes(l.contact) || (l.swing && l.runs === 0 && l.contact !== 'middle'));
const sentences = (t) => (t.match(/[.!?](\s|$)/g) || []).length || (t.trim() ? 1 : 0);

/** RK3: real touches, jittered like a novice. */
export async function gestures(browser, args, n = 300) {
  const { ctx, page } = await open(browser, args, { tier: 'full', timeScale: 2, seed: 'eval-rk3' });
  const cdp = await ctx.newCDPSession(page);
  const r = rng('rk3');
  const out = [];
  // CTL1 (RULINGS.md): Event Timing, input to next paint, where that paint already shows the moving bat; otherwise
  // the stage's lastInputToBatMs plus one frame at the measured rate.
  await page.evaluate(() => {
    window.__evalEvents = [];
    try {
      new PerformanceObserver((l) => window.__evalEvents.push(...l.getEntries().filter((e) => /pointerdown|touchstart|mousedown|keydown/.test(e.name)).map((e) => ({ name: e.name, start: e.startTime, duration: e.duration })))).observe({ type: 'event', buffered: true, durationThreshold: 16 });
    } catch {
      /* no Event Timing */
    }
  });
  try {
    await startOver(page);
    for (let i = 0; i < n; i++) {
      const cls = ['tap', 'flick', 'leave'][i % 3];
      const tSent = await page.evaluate(() => performance.now()).catch(() => 0);
      if (!(await waitFor(page, ['live'], 60_000))) {
        if ((await hookState(page))?.screen === 'over_summary' || (await hookState(page))?.screen === 'out') {
          (await tryPress(page, true, ['practice-next-over', 'practice-new-innings'], [/next over/i, /new innings/i])) && (await startOver(page));
          i--;
          continue;
        }
        break;
      }
      await page.locator('[role="application"][data-armed="true"]').first().waitFor({ timeout: 3000 }).catch(() => undefined);
      await sleep(40 + r() * 120);
      const box = await page.locator('[role="application"]').first().boundingBox();
      if (box && cls !== 'leave') {
        const x = box.x + box.width * (0.3 + r() * 0.4);
        const y = box.y + box.height * (0.45 + r() * 0.4);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
        if (cls === 'tap') {
          const wob = r() * 8;
          await sleep(25 + r() * 110);
          if (wob > 3) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + wob * 0.6, y: y - wob * 0.8 }] });
        } else {
          const ang = ((-90 + (r() * 80 - 40)) * Math.PI) / 180;
          const len = 40 + r() * 140;
          const steps = 4 + Math.floor(r() * 7);
          for (let k = 1; k <= steps; k++) {
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + (Math.cos(ang) * len * k) / steps, y: y + (Math.sin(ang) * len * k) / steps }] });
            await sleep((60 + r() * 190) / steps);
          }
        }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      }
      await waitFor(page, ['dead', 'coaching', 'over_summary', 'out'], 30_000);
      const last = (await hookState(page))?.last;
      const got = last?.swing ?? 'leave';
      const want = cls === 'tap' ? 'defend' : cls === 'flick' ? 'attack' : 'leave';
      const lat =
        cls === 'leave'
          ? null
          : await page
              .evaluate((t0) => {
                const st = window.__eval.stage()?.stats?.() ?? null;
                const ev = (window.__evalEvents || []).filter((e) => e.start >= t0 - 5).sort((a, b) => a.start - b.start)[0] ?? null;
                const frame = st?.avgFrameMs ?? (st?.fps ? 1000 / st.fps : 16.7);
                const bat = st?.lastInputToBatMs ?? null;
                // Event Timing reports only events of 16 ms or more; a missing entry means under 16 ms to the next paint.
                const verified = ev && bat !== null && bat <= ev.duration;
                return { eventMs: ev?.duration ?? null, eventName: ev?.name ?? null, batMs: bat, frameMs: Math.round(frame * 10) / 10, ctl1Ms: verified ? ev.duration : bat !== null ? Math.round((bat + frame) * 10) / 10 : null, method: verified ? 'event-timing' : 'bat+frame', profile: st?.profile ?? null };
              }, tSent)
              .catch(() => null);
      out.push({ i, cls, want, got, ok: got === want, contact: last?.contact ?? null, latency: lat });
      await tryPress(page, true, ['practice-next-ball'], [/^next ball$/i]);
    }
  } finally {
    await ctx.close();
  }
  const by = (c) => out.filter((g) => g.cls === c);
  const lat = out.map((g) => g.latency?.ctl1Ms).filter((x) => typeof x === 'number').sort((a, b) => a - b);
  const pct = (p) => (lat.length ? lat[Math.min(lat.length - 1, Math.ceil((p / 100) * lat.length) - 1)] : null);
  return { n: out.length, ctl1: { swings: lat.length, p50: pct(50), p95: pct(95), max: lat[lat.length - 1] ?? null, byMethod: { 'event-timing': out.filter((g) => g.latency?.method === 'event-timing').length, 'bat+frame': out.filter((g) => g.latency?.method === 'bat+frame').length } }, recognisedPct: out.length ? Math.round((out.filter((g) => g.ok).length / out.length) * 1000) / 10 : null, perClass: Object.fromEntries(['tap', 'flick', 'leave'].map((c) => [c, `${by(c).filter((g) => g.ok).length}/${by(c).length}`])), wrong: out.filter((g) => !g.ok).slice(0, 20), uptime: uptime() };
}

/** F5: a novice model on Quick defaults; success = a clean (middle) contact without being out, within the first 6 balls. */
export async function novice(browser, args, seeds = 50) {
  const rows = [];
  for (let s = 1; s <= seeds; s++) {
    const r = rng(`novice-${s}`);
    const swings = Array.from({ length: 6 }, () => ({ kind: 'attack', contactErrorMs: Math.round(normal(r) * 60), directionDeg: Math.round(r() * 60 - 30), power: 0.7 }));
    const { ctx, page } = await open(browser, args, { tier: 'full', timeScale: 4, seed: `eval-novice-${s}`, autoNext: true });
    let first = null;
    const balls = [];
    try {
      await queue(page, ...swings);
      await startOver(page);
      for (let b = 0; b < 6; b++) {
        if (!(await waitFor(page, ['dead', 'coaching'], 60_000))) break;
        const l = (await hookState(page))?.last;
        balls.push(l ? `${l.contact}/${l.runs}${l.dismissal ? '/' + l.dismissal : ''}` : 'none');
        if (l && l.contact === 'middle' && !l.dismissal && first === null) first = b + 1;
        if (l?.dismissal) break;
        await tryPress(page, true, ['practice-next-ball'], [/^next ball$/i]);
        await waitFor(page, ['runup', 'live', 'over_summary', 'out'], 30_000);
      }
    } catch (e) {
      balls.push(`error ${String(e).slice(0, 80)}`);
    } finally {
      await ctx.close();
    }
    rows.push({ seed: `eval-novice-${s}`, firstSuccessBall: first, balls });
  }
  const ok = rows.filter((x) => x.firstSuccessBall !== null).length;
  return { seeds: rows.length, succeeded: ok, pct: Math.round((ok / rows.length) * 1000) / 10, rows, uptime: uptime() };
}

export { open, startOver, afterBall, failure, sentences, rng, normal, nowMs, VP };

export async function runRookie(hw, args, only = ['gestures', 'novice', 'failures', 'retry', 'coach', 'another']) {
  const out = {};
  if (only.includes('gestures')) {
    log(args, 'rookie RK3: 300 novice gestures');
    out.gestures = await gestures(hw, args);
  }
  if (only.includes('novice')) {
    log(args, 'rookie F5: novice model, 50 seeds');
    out.novice = await novice(hw, args);
  }
  const more = await import('./rookie2.mjs');
  if (only.includes('failures')) {
    log(args, 'rookie F6/RK4: failure reasons over 60 balls');
    out.failures = await more.failures(hw, args);
  }
  if (only.includes('retry')) {
    log(args, 'rookie RK5/COACH2: exact retry with the recommended response');
    out.retry = await more.retry(hw, args);
  }
  if (only.includes('coach')) {
    log(args, 'rookie COACH3/COACH6: demonstration and assistance stages');
    out.coach = await more.coach(hw, args);
  }
  if (only.includes('another')) {
    log(args, 'rookie RK6: another over');
    out.another = await more.another(hw, args);
  }
  const file = writeJson(args, 'rookie', out);
  log(args, `rookie → ${file}`);
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([kk]) => !['rows', 'balls', 'cases'].includes(kk))) : v]));
}
