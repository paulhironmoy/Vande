/**
 * The rest of the screenshot matrix and its orchestration: Classic batting, the first session, the fallbacks
 * (software graphics through the real device check, and no WebGL at all), the same moment in every quality tier,
 * and portrait. See capture.mjs for the main journeys.
 */
import { bulkDir, context, isTouchVp, hookState, log, newPage, queue, sleep, snap, waitFor, writeJson } from '../lib/env.mjs';
import { find, press, pressUntilBowling } from '../lib/driver.mjs';
import { PH, journeyMain, journeySummary, tryPress } from './capture.mjs';

const isTouch = (vp) => isTouchVp(vp);

async function startQuick(page, touch) {
  return pressUntilBowling(page, touch, { timeoutMs: 60_000 });
}

/** Classic (the 2D presentation) through the hooks' Below tier: run-up, flight and the result. */
async function journeyClassic(browser, args, vp, shots, missing) {
  const touch = isTouch(vp);
  const video = vp === '915x412' && args.video ? bulkDir(args, 'video') : null;
  const ctx = await context(browser, vp, { hooks: { tier: 'below', timeScale: 0.35, seed: 'eval-capture' }, storage: { 'vc:practice:settings': { v: 1, guidedDone: true, demoSeen: true } }, video });
  const errors = [];
  const page = await newPage(ctx, errors);
  const S = async (name, extra) => shots.push(await snap(page, args, vp, name, extra));
  try {
    await page.goto(args.base + '/practice');
    await sleep(1500);
    await queue(page, { kind: 'attack', contactErrorMs: 0, directionDeg: 25, power: 0.75 });
    if (!(await startQuick(page, touch))) return missing.push({ viewport: vp, name: '20-classic-runup', why: 'no Quick action' });
    if (await waitFor(page, PH.runup, 30_000)) {
      await sleep(900);
      await S('20-classic-runup', { stage: (await hookState(page))?.stage });
    }
    if (await waitFor(page, PH.live, 30_000)) {
      await sleep(550);
      await S('21-classic-flight');
    }
    if (await waitFor(page, PH.after, 20_000)) {
      await sleep(900);
      await S('22-classic-after-contact');
    }
    if (await waitFor(page, PH.result, 30_000)) {
      await sleep(700);
      await S('23-classic-result', { last: (await hookState(page))?.last });
    }
  } catch (e) {
    missing.push({ viewport: vp, name: 'journey-classic', why: String(e).slice(0, 300) });
  } finally {
    await ctx.close();
    if (errors.length) missing.push({ viewport: vp, name: 'page-errors-classic', why: errors.slice(0, 8) });
  }
}

/** A new player: launch → Practice with empty storage and the real device check (hardware GPU). */
async function journeyFirst(browser, args, vp, shots, missing) {
  const touch = isTouch(vp);
  const ctx = await context(browser, vp, { hooks: { timeScale: 0.5, seed: 'eval-first' } });
  const errors = [];
  const page = await newPage(ctx, errors);
  const S = async (name, extra) => shots.push(await snap(page, args, vp, name, extra));
  try {
    await page.goto(args.base + '/');
    let practice = null;
    let rootModes = false;
    for (let i = 0; i < 100 && !practice && !rootModes; i++) {
      practice = await find(page, 'practice');
      if (!practice && i > 15) rootModes = Boolean(await find(page, 'random', { reject: (l) => /quick/i.test(l) && !/random/i.test(l) }));
      if (!practice && !rootModes) await sleep(100);
    }
    if (!practice && !rootModes) return missing.push({ viewport: vp, name: '40-first', why: 'no Practice action and no Practice modes' });
    if (practice) await press(page, practice, touch);
    await sleep(700);
    await S('40-first-after-practice');
    const q = await find(page, 'quick', { reject: (l) => /random over/i.test(l) && !/quick/i.test(l) });
    if (q) await S('40b-first-mode-choice');
    await pressUntilBowling(page, touch, { timeoutMs: 60_000 });
    // RK1: the first run's one short demonstration (phase 'intro'), photographed with its skip controls.
    if (await waitFor(page, ['intro'], 15_000)) {
      await sleep(900);
      const skip = await page.evaluate(() => ['practice-intro-skip', 'practice-intro-skip-all'].filter((id) => document.querySelector(`[data-testid="${id}"]`)));
      await S('40c-first-demo', { skipControls: skip });
    } else missing.push({ viewport: vp, name: '40c-first-demo', why: 'no demonstration (phase intro) before the first ball' });
    if (await waitFor(page, PH.runup, 45_000)) {
      await sleep(800);
      await S('41-first-runup');
    }
    if (await waitFor(page, [...PH.explain, ...PH.result], 60_000)) {
      await sleep(800);
      await S('42-first-explained', { state: await hookState(page) });
    } else missing.push({ viewport: vp, name: '42-first-explained', why: 'no explanation after the first ball' });
  } catch (e) {
    missing.push({ viewport: vp, name: 'journey-first', why: String(e).slice(0, 300) });
  } finally {
    await ctx.close();
    if (errors.length) missing.push({ viewport: vp, name: 'page-errors-first', why: errors.slice(0, 8) });
  }
}

/** Fallbacks: software graphics (SwiftShader, the real device check) and no WebGL at all. */
async function journeyFallback(sw, args, vp, shots, missing) {
  const touch = isTouch(vp);
  for (const variant of ['software', 'nowebgl']) {
    const ctx = await context(sw, vp, { hooks: { timeScale: 2, seed: 'eval-fallback' }, storage: { 'vc:practice:settings': { v: 1, guidedDone: true, demoSeen: true } } });
    if (variant === 'nowebgl')
      await ctx.addInitScript(() => {
        const original = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
          if (type === 'webgl2' || type === 'webgl' || type === 'experimental-webgl') return null;
          return original.call(this, type, ...rest);
        };
      });
    const errors = [];
    const page = await newPage(ctx, errors);
    const S = async (name, extra) => shots.push(await snap(page, args, vp, name, extra));
    try {
      await page.goto(args.base + '/practice');
      await sleep(1200);
      const quick = await find(page, 'quick', { reject: (l) => /random over/i.test(l) && !/quick/i.test(l) });
      if (quick) await press(page, quick, touch);
      // The rebuilt Setup says in product words when the Classic view is better; before it, a device check runs.
      for (let i = 0; i < 40; i++) {
        if (await page.getByTestId('practice-setup').isVisible().catch(() => false)) break;
        if (await page.getByTestId('practice-compat').isVisible().catch(() => false)) break;
        await sleep(250);
      }
      await sleep(1500);
      await S(`30-fallback-${variant}-check`);
      await tryPress(page, touch, ['practice-play-start', 'practice-setup-play']);
      const deadline = Date.now() + 60_000;
      let shown = false;
      while (Date.now() < deadline) {
        const st = await hookState(page);
        const compat = await page.getByTestId('practice-compat').isVisible().catch(() => false);
        const notice = await page.locator('[role=status],[role=alert]').first().isVisible().catch(() => false);
        if (compat || (st && ['runup', 'live', 'radar'].includes(st.phase)) || (notice && st?.screen === 'live')) {
          await sleep(500);
          await S(`31-fallback-${variant}`, { state: st, compat });
          shown = true;
          break;
        }
        await sleep(300);
      }
      if (!shown) missing.push({ viewport: vp, name: `31-fallback-${variant}`, why: 'no fallback screen or ball within 60 s' });
      if (await tryPress(page, touch, ['practice-classic'], [/classic/i])) {
        await waitFor(page, PH.runup, 30_000);
        await sleep(700);
        await S(`32-fallback-${variant}-classic`, { state: await hookState(page) });
      }
    } catch (e) {
      missing.push({ viewport: vp, name: `journey-fallback-${variant}`, why: String(e).slice(0, 300) });
    } finally {
      await ctx.close();
    }
  }
}

/** The same moment (0.25 s after release, slow time) in each quality choice the settings offer. */
async function journeyTiers(browser, args, vp, shots, missing) {
  const touch = isTouch(vp);
  const out = [];
  for (const quality of ['high', 'standard', 'lite', 'classic', 'premium', 'balanced']) {
    const ctx = await context(browser, vp, { hooks: { tier: 'full', timeScale: 0.25, seed: 'eval-tier' }, storage: { 'vc:practice:settings': { v: 1, guidedDone: true, demoSeen: true, quality } } });
    const page = await newPage(ctx, []);
    try {
      await page.goto(args.base + '/practice');
      await sleep(1500);
      await queue(page, 'leave');
      await startQuick(page, touch);
      if (await waitFor(page, PH.live, 30_000)) {
        await sleep(1000);
        const st = await hookState(page);
        const q = await page.evaluate(() => window.__eval.stage()?.stats?.()).catch(() => null);
        shots.push(await snap(page, args, vp, `60-tier-${quality}`, { quality, stage: st?.stage, effective: q?.profile ?? null, stats: q }));
        out.push({ quality, stage: st?.stage, profile: q?.profile ?? null });
      } else missing.push({ viewport: vp, name: `60-tier-${quality}`, why: 'no release' });
    } catch (e) {
      missing.push({ viewport: vp, name: `60-tier-${quality}`, why: String(e).slice(0, 200) });
    } finally {
      await ctx.close();
    }
  }
  return out;
}

export async function runCapture(B, args) {
  const shots = [];
  const missing = [];
  const tiers = {};
  for (const vp of args.viewports) {
    const hw = await B.get('hw');
    log(args, `capture ${vp}: main`);
    await journeyMain(hw, args, vp, shots, missing);
    log(args, `capture ${vp}: summary`);
    await journeySummary(hw, args, vp, shots, missing);
    log(args, `capture ${vp}: classic`);
    await journeyClassic(hw, args, vp, shots, missing);
    log(args, `capture ${vp}: first session`);
    await journeyFirst(hw, args, vp, shots, missing);
    if (vp === '915x412' || vp === '1280x800') {
      log(args, `capture ${vp}: tiers`);
      tiers[vp] = await journeyTiers(hw, args, vp, shots, missing);
    }
  }
  // Software graphics last, with the GPU browser closed (one browser at a time).
  for (const vp of ['915x412', '640x360'].filter((v) => args.viewports.includes(v))) {
    log(args, `capture ${vp}: fallbacks (SwiftShader)`);
    await journeyFallback(await B.get('sw'), args, vp, shots, missing);
  }
  const file = writeJson(args, 'capture', { shots, missing, tiers });
  log(args, `capture: ${shots.length} shots, ${missing.length} missing → ${file}`);
  return { shots: shots.length, missing, tiers };
}
