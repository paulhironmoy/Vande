/**
 * Interface obstruction during the delivery (constitution §3–§4): every animation frame from the run-up to the end
 * of the ball, the painted UI boxes are intersected with the ball (projected position and size), the bowler (rig
 * bones; a body envelope in Classic), the pitch (Law 6 area) and the batter's hitting area, through the stage's own
 * camera. Also records copy and running animations during the delivery, the ball's on-screen size and how long
 * before contact it is still in view. First person and Classic, every viewport, the first-time ball and a normal one.
 */
import { context, isTouchVp, hookState, log, newPage, queue, sleep, uptime, waitFor, writeJson } from '../lib/env.mjs';
import { find, press, pressUntilBowling } from '../lib/driver.mjs';

const MARGIN = 3; // px of clear space the ball needs around it

const inter = (a, b) => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y), w, h } : null;
};
const circleHits = (c, r, b) => {
  const dx = Math.max(b.x - c.x, 0, c.x - (b.x + b.w));
  const dy = Math.max(b.y - c.y, 0, c.y - (b.y + b.h));
  return dx * dx + dy * dy <= r * r;
};
const inPoly = (x, y, poly) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
};
/** Fraction of a region (rect or polygon) covered by the union of boxes, by sampling a grid of `cell` px. */
function covered(region, boxes, cell, canvas) {
  const poly = Array.isArray(region) ? region : null;
  const bb = poly
    ? { x: Math.min(...poly.map((p) => p.x)), y: Math.min(...poly.map((p) => p.y)), w: Math.max(...poly.map((p) => p.x)) - Math.min(...poly.map((p) => p.x)), h: Math.max(...poly.map((p) => p.y)) - Math.min(...poly.map((p) => p.y)) }
    : region;
  const clip = inter(bb, canvas);
  if (!clip) return { area: 0, frac: 0 };
  const near = boxes.filter((b) => inter(b, clip));
  let total = 0;
  let hit = 0;
  for (let y = clip.y + cell / 2; y < clip.y + clip.h; y += cell)
    for (let x = clip.x + cell / 2; x < clip.x + clip.w; x += cell) {
      if (poly && !inPoly(x, y, poly)) continue;
      total++;
      if (near.some((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h)) hit++;
    }
  return { area: total * cell * cell, frac: total ? hit / total : 0 };
}

/** READ2: at release, at the bounce and 5 m before the ideal contact, the ball's size and contrast on screen. */
export function read2(pixels, flight) {
  if (!pixels || !pixels.length || !flight) return null;
  const near = (t) => pixels.reduce((a, p) => (Math.abs(p.t - t) < Math.abs(a.t - t) ? p : a));
  const idealT = flight.idealContactT;
  const speed = (flight.speedKph || 120) / 3.6;
  const moments = { release: pixels[0], bounce: flight.bounce ? near(flight.bounce.t) : null, before5m: near(idealT - 5 / speed) };
  const out = {};
  for (const [k, p] of Object.entries(moments)) {
    if (!p) continue;
    out[k] = { t: Math.round(p.t * 1000) / 1000, diameterCss: Math.round(p.diameterCss * 10) / 10, contrast: Math.round(p.contrast * 100) / 100, peakContrast: Math.round(p.peakContrast * 100) / 100, pass: p.diameterCss >= 3 && p.contrast >= 3 };
  }
  return out;
}

export function analyse(track) {
  const frames = track.frames.filter((f) => f.reg);
  const ballF = frames.filter((f) => f.reg.ball && f.reg.ball.x >= f.reg.canvas.x && f.reg.ball.x <= f.reg.canvas.x + f.reg.canvas.w && f.reg.ball.y >= f.reg.canvas.y && f.reg.ball.y <= f.reg.canvas.y + f.reg.canvas.h);
  let ballCovered = 0;
  const coveringBall = new Set();
  for (const f of ballF) {
    const hits = f.ui.filter((b) => circleHits(f.reg.ball, f.reg.ball.r + MARGIN, b));
    if (hits.length) ballCovered++;
    for (const h of hits) coveringBall.add(`${h.testid}:${h.kind}`);
  }
  const cov = (key, cell) => {
    let max = 0;
    let sum = 0;
    let n = 0;
    const who = new Set();
    for (const f of frames) {
      const r = f.reg[key];
      if (!r || (Array.isArray(r) && r.length < 3)) continue;
      const c = covered(r, f.ui, cell, f.reg.canvas);
      if (!c.area) continue;
      n++;
      sum += c.frac;
      if (c.frac > max) max = c.frac;
      if (c.frac > 0) for (const b of f.ui) if (Array.isArray(r) ? true : inter(b, r)) who.add(`${b.testid}:${b.kind}`);
    }
    return { frames: n, maxPct: Math.round(max * 1000) / 10, meanPct: n ? Math.round((sum / n) * 1000) / 10 : 0, by: Array.isArray(frames[0]?.reg[key]) ? [] : [...who].slice(0, 12) };
  };
  const live = track.frames.filter((f) => f.phase === 'live' || f.phase === 'runup');
  const testids = new Set();
  const text = new Set();
  let maxAnim = 0;
  const animNames = new Set();
  for (const f of live) {
    for (const b of f.ui) {
      testids.add(b.testid || '(none)');
      if (b.kind === 'text') text.add(b.testid || '(none)');
    }
    const a = (f.anim || []).length;
    if (a > maxAnim) maxAnim = a;
    for (const x of f.anim || []) animNames.add(`${x.testid || x.cls || '?'}:${x.name}`);
  }
  // Rubric corridor: the screen region the projected ball path sweeps from release to the bat or keeper, plus 24 px.
  const corridor = ballF.map((f) => ({ x: f.reg.ball.x, y: f.reg.ball.y, r: f.reg.ball.r + 24 }));
  const inCorridor = new Map();
  for (const f of track.frames) {
    if (f.phase !== 'live' && f.phase !== 'runup') continue;
    for (const b of f.ui) if (corridor.some((c) => circleHits(c, c.r, b))) inCorridor.set(`${b.testid}:${b.kind}`, { testid: b.testid, kind: b.kind, x: b.x, y: b.y, w: b.w, h: b.h, phase: f.phase });
  }
  // Info rail: the union of painted UI during the delivery as a share of the screen (M5: at most 8%).
  let railMax = 0;
  for (const f of live) {
    const vp = { x: 0, y: 0, w: track.viewport.w, h: track.viewport.h };
    const c = covered(vp, f.ui, 8, vp);
    if (c.frac > railMax) railMax = c.frac;
  }
  const modals = new Set();
  for (const f of live) for (const m of f.modal || []) modals.add(m);
  const first = ballF[0]?.reg.ball;
  const bounceT = track.flight?.bounce?.t ?? null;
  const atBounce = bounceT !== null && ballF.length ? ballF.reduce((a, f) => (Math.abs(f.reg.ball.t - bounceT) < Math.abs(a.reg.ball.t - bounceT) ? f : a)).reg.ball : null;
  const lastT = ballF.length ? ballF[ballF.length - 1].reg.ball.t : null;
  return {
    stage: frames[0]?.reg.stage ?? null,
    frames: track.frames.length,
    ball: {
      samplesOnScreen: ballF.length,
      samplesCovered: ballCovered,
      coveredPct: ballF.length ? Math.round((ballCovered / ballF.length) * 1000) / 10 : null,
      coveredBy: [...coveringBall],
      diameterPxAtRelease: first ? Math.round(first.r * 2 * 10) / 10 : null,
      diameterPxAtBounce: atBounce ? Math.round(atBounce.r * 2 * 10) / 10 : null,
      inViewUntilMsBeforeIdealContact: lastT !== null && track.flight ? Math.round((track.flight.idealContactT - lastT) * 1000) : null,
    },
    corridor: { samples: corridor.length, uiInCorridor: [...inCorridor.values()] },
    railPctMax: Math.round(railMax * 1000) / 10,
    modalsDuringDelivery: [...modals],
    bowler: cov('bowler', 2),
    // The approach and release (to 0.2 s after release) are protected; the follow-through leaves the frame as the gaze
    // follows the ball, so it is reported apart.
    bowlerApproachRelease: (() => {
      const keep = frames.filter((f) => f.phase === 'runup' || (f.reg.t !== null && f.reg.t <= 0.2));
      let max = 0;
      const who = new Set();
      for (const f of keep) {
        if (!f.reg.bowler) continue;
        const c = covered(f.reg.bowler, f.ui, 2, f.reg.canvas);
        if (c.frac > max) max = c.frac;
        if (c.frac > 0) for (const b of f.ui) if (inter(b, f.reg.bowler)) who.add(`${b.testid}:${b.kind}`);
      }
      return { frames: keep.length, maxPct: Math.round(max * 1000) / 10, by: [...who] };
    })(),
    pitch: cov('pitch', 4),
    hitting: cov('hitting', 4),
    duringDelivery: { uiTestids: [...testids], textTestids: [...text], maxRunningAnimations: maxAnim, animations: [...animNames].slice(0, 12) },
    flight: track.flight,
  };
}

/** One tracked delivery: open Practice with the tier and seed, start Quick, track from the run-up to the end. */
async function trackOne(browser, args, vp, { tier, persona, swing, quality = null, hand = null, motion = null, text = null }) {
  const touch = isTouchVp(vp);
  const settings = { v: 1, guidedDone: true, demoSeen: true, ...(quality ? { quality } : {}), ...(hand ? { handedness: hand } : {}) };
  const storage = persona === 'returning' ? { 'vc:practice:settings': settings } : quality ? { 'vc:practice:settings': { v: 1, quality } } : {};
  if (text) storage['vc:settings'] = { textScale: Math.min(text, 1.3) };
  // 'real': no tier from the hooks, so the device check runs on this GPU (the only way to earn Premium).
  const hooks = tier === 'real' ? { timeScale: 0.5, seed: 'eval-obstruct-real' } : { tier, timeScale: 0.5, seed: `eval-obstruct-${tier}` };
  const ctx = await context(browser, vp, { hooks, storage, reducedMotion: motion === 'reduce' ? 'reduce' : 'no-preference' });
  // 200% text: the app's largest setting is 1.3, so the root scale is held at 2 (A11Y1, the settings axis of §3).
  if (text && text > 1.3) await ctx.addInitScript((sc) => new MutationObserver(() => document.documentElement.style.getPropertyValue('--text-scale') !== String(sc) && document.documentElement.style.setProperty('--text-scale', String(sc))).observe(document.documentElement, { attributes: true }), text);
  const errors = [];
  const page = await newPage(ctx, errors);
  try {
    if (persona === 'new') {
      await page.goto(args.base + '/');
      for (let i = 0; i < 100; i++) {
        const p = await find(page, 'practice');
        if (p) {
          await press(page, p, touch);
          break;
        }
        if (i > 15 && (await find(page, 'random', { reject: (l) => /quick/i.test(l) && !/random/i.test(l) }))) break;
        await sleep(100);
      }
    } else await page.goto(args.base + '/practice');
    await sleep(1200);
    if (swing) await queue(page, swing);
    await pressUntilBowling(page, touch, { timeoutMs: 60_000 });
    if (!(await waitFor(page, ['runup'], 45_000))) return { vp, tier, persona, error: 'no run-up', errors, phase: (await hookState(page))?.phase ?? null, screen: (await hookState(page))?.screen ?? null };
    const pixelMode = await page.evaluate(() => window.__eval.ballPixels(true)).catch((e) => String(e));
    const track = await page.evaluate(() => window.__eval.track({ timeoutMs: 30000 }));
    const pixels = await page.evaluate(() => window.__eval.ballPixels(false)).catch(() => []);
    const style = await page.evaluate(() => window.__eval.ballStyle()).catch(() => null);
    const st = await hookState(page);
    const profile = await page.evaluate(() => window.__eval.stage()?.stats?.().profile ?? null).catch(() => null);
    return { vp, tier, persona, quality, hand, motion, text, effective: { stage: st?.stage ?? null, tier: st?.tier ?? null, profile }, ...analyse(track), read2: read2(pixels, track.flight), pixelMode, pixelSamples: pixels.length, ballStyle: style, result: st?.last ?? null, uptime: uptime(), errors };
  } catch (e) {
    return { vp, tier, persona, error: String(e).slice(0, 300), errors };
  } finally {
    await ctx.close();
  }
}

export async function runObstruction(browser, args) {
  const runs = [];
  for (const vp of args.viewports) {
    const drive = { kind: 'attack', contactErrorMs: 0, directionDeg: 25, power: 0.75 };
    // --parts real,base,extras selects configurations (default: all).
    const want = (tag) => !args.parts || args.parts.includes(tag);
    for (const [tier, persona, swing, quality] of [
      ['real', 'new', null, null],
      ['real', 'returning', drive, 'high'],
      ['full', 'returning', drive, null],
      ['assisted', 'returning', drive, null],
      ['below', 'returning', { kind: 'defend', contactErrorMs: 0 }, null],
    ].filter(([tier]) => want(tier === 'real' ? 'real' : 'base'))) {
      log(args, `obstruction ${vp} ${tier}${quality ? '/' + quality : ''} ${persona}`);
      runs.push(await trackOne(browser, args, vp, { tier, persona, swing, quality }));
    }
    // The settings and hand axes of the configuration matrix, on the common phone viewport.
    if (vp === '915x412' && want('extras'))
      for (const extra of [{ hand: 'left' }, { motion: 'reduce' }, { text: 2 }]) {
        log(args, `obstruction ${vp} full returning ${JSON.stringify(extra)}`);
        runs.push(await trackOne(browser, args, vp, { tier: 'full', persona: 'returning', swing: drive, ...extra }));
      }
  }
  const worst = (k, f) => Math.max(0, ...runs.filter((r) => r[k]).map(f));
  const summary = {
    ballCoveredPctMax: worst('ball', (r) => r.ball.coveredPct ?? 0),
    bowlerCoverPctMax: worst('bowler', (r) => r.bowler.maxPct),
    bowlerApproachReleaseCoverPctMax: worst('bowlerApproachRelease', (r) => r.bowlerApproachRelease.maxPct),
    pitchCoverPctMax: worst('pitch', (r) => r.pitch.maxPct),
    hittingCoverPctMax: worst('hitting', (r) => r.hitting.maxPct),
    maxRunningAnimations: worst('duringDelivery', (r) => r.duringDelivery.maxRunningAnimations),
    corridorViolations: runs.filter((r) => r.corridor?.uiInCorridor?.length).map((r) => `${r.vp}/${r.tier}/${r.persona}: ${r.corridor.uiInCorridor.map((u) => `${u.testid}:${u.kind}`).join(', ')}`),
    railPctMax: worst('railPctMax', (r) => r.railPctMax),
    modalsDuringDelivery: runs.filter((r) => r.modalsDuringDelivery?.length).map((r) => `${r.vp}/${r.tier}: ${r.modalsDuringDelivery.join(', ')}`),
    read2: Object.fromEntries(runs.filter((r) => r.read2).map((r) => [`${r.vp}/${r.tier}/${r.persona}`, r.read2])),
    ballDiameterPxAtRelease: Object.fromEntries(runs.filter((r) => r.ball).map((r) => [`${r.vp}/${r.tier}/${r.persona}`, r.ball.diameterPxAtRelease])),
    errors: runs.filter((r) => r.error).map((r) => `${r.vp}/${r.tier}/${r.persona}: ${r.error}`),
  };
  const file = writeJson(args, 'obstruction', { summary, runs });
  log(args, `obstruction → ${file}`);
  return summary;
}
