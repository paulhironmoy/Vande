/**
 * Recovery from interruption (brief: "a crash, pause or orientation change must not produce a technical loss";
 * "prevent accidental exits and preserve an unfinished over locally"): background and reload mid-delivery, a turn
 * to portrait between balls, going offline, network requests during a delivery, and leaving mid-over. Each check
 * records what the player sees (the notice), whether the innings survived and the taps needed to carry on.
 */
import { context, hookState, log, newPage, queue, sleep, waitFor, writeJson } from '../lib/env.mjs';
import { find, press } from '../lib/driver.mjs';
import { tryPress } from './capture.mjs';

const VP = '915x412';
const BLOCK = { kind: 'defend', contactErrorMs: 0 };

async function open(browser, args, hooks) {
  const ctx = await context(browser, VP, { hooks: { ...hooks, autoNext: true }, storage: { 'vc:practice:settings': { v: 1, guidedDone: true, demoSeen: true } } });
  const page = await newPage(ctx, []);
  await page.goto(args.base + '/practice');
  await sleep(1200);
  return { ctx, page };
}
async function startQuick(page) {
  const q = await find(page, 'quick', { reject: (l) => /random over/i.test(l) && !/quick/i.test(l) });
  if (q) await press(page, q, true);
  for (let i = 0; i < 6; i++) {
    const st = await hookState(page);
    if (st && ['radar', 'runup', 'live'].includes(st.phase)) return true;
    if (!(await tryPress(page, true, ['practice-setup-play', 'practice-play-start', 'practice-start', 'practice-tap-go']))) await sleep(300);
  }
  return Boolean(q);
}
const notices = (page) => page.evaluate(() => Array.from(document.querySelectorAll('[role=status],[role=alert],[data-testid*="notice"]')).map((e) => e.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean)).catch(() => []);

/** Inside the page at the moment the ball is in flight: hide and show the page, or reload it. */
async function whileInFlight(page, action) {
  const run = page.evaluate(async (what) => {
    if (!(await window.__vandePractice.waitFor(['live'], 60000))) throw new Error('never in flight');
    if (what === 'reload') return location.reload();
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise((r) => setTimeout(r, 300));
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  }, action);
  if (action === 'reload') {
    await run.catch(() => undefined);
    await page.waitForLoadState('load');
    await sleep(1500);
  } else await run;
}

async function check(name, fn) {
  try {
    return { name, ...(await fn()) };
  } catch (e) {
    return { name, pass: false, error: String(e).slice(0, 300) };
  }
}

export async function runRecovery(browser, args) {
  const checks = [];
  checks.push(
    await check('background-mid-delivery', async () => {
      const { ctx, page } = await open(browser, args, { tier: 'full', timeScale: 0.5, seed: 'eval-rec-bg' });
      try {
        await startQuick(page);
        await whileInFlight(page, 'background');
        await sleep(800);
        const st = await hookState(page);
        const words = await notices(page);
        const before = st?.balls ?? null;
        await queue(page, BLOCK);
        const taps = (await tryPress(page, true, ['practice-resume'], [/^resume/i, /^continue/i])) ? 1 : 0;
        const next = await waitFor(page, ['runup', 'live'], 20_000);
        return { pass: Boolean(next) && st?.status !== null, phaseAfter: st?.phase, ballsAfter: before, swing: st?.last?.swing ?? null, notice: words, tapsToContinue: taps, continued: next };
      } finally {
        await ctx.close();
      }
    }),
  );
  checks.push(
    await check('reload-mid-delivery', async () => {
      const { ctx, page } = await open(browser, args, { tier: 'full', timeScale: 0.5, seed: 'eval-rec-reload' });
      try {
        await startQuick(page);
        const plan = (await hookState(page))?.over?.variations ?? null;
        await whileInFlight(page, 'reload');
        const words = await notices(page);
        const st = await hookState(page);
        await queue(page, BLOCK, BLOCK);
        const via = await tryPress(page, true, ['practice-continue', 'practice-resume'], [/^continue/i, /^resume/i]);
        const next = await waitFor(page, ['runup', 'live', 'radar'], 30_000);
        const st2 = await hookState(page);
        return { pass: Boolean(next) && (st2?.balls ?? 0) >= 1 && JSON.stringify(st2?.over?.variations) === JSON.stringify(plan), ballsAfterReload: st?.balls, inFlight: st?.inFlight, notice: words, continueVia: via, tapsToContinue: via ? 1 : 0, sameOver: JSON.stringify(st2?.over?.variations) === JSON.stringify(plan) };
      } finally {
        await ctx.close();
      }
    }),
  );
  checks.push(
    await check('portrait-between-balls', async () => {
      const { ctx, page } = await open(browser, args, { tier: 'full', timeScale: 2, seed: 'eval-rec-turn' });
      try {
        await queue(page, BLOCK, BLOCK, BLOCK);
        await startQuick(page);
        await waitFor(page, ['coaching', 'dead'], 40_000);
        await page.setViewportSize({ width: 412, height: 915 });
        await sleep(2500);
        const held = await page.evaluate(() => window.__vandePractice.state().phase);
        const turn = await page.getByTestId('practice-turn').isVisible().catch(() => false);
        const words = await notices(page);
        const ballsHeld = (await hookState(page))?.balls;
        await page.setViewportSize({ width: 915, height: 412 });
        const next = await waitFor(page, ['runup', 'live'], 20_000);
        return { pass: turn && Boolean(next), overlay: turn, phaseWhilePortrait: held, ballsHeld, notice: words, resumed: next };
      } finally {
        await ctx.close();
      }
    }),
  );
  checks.push(
    await check('offline-and-network-during-delivery', async () => {
      const { ctx, page } = await open(browser, args, { tier: 'full', timeScale: 1, seed: 'eval-rec-net' });
      const requests = [];
      try {
        await queue(page, BLOCK, BLOCK);
        await startQuick(page);
        await waitFor(page, ['runup'], 30_000);
        page.on('request', (r) => requests.push(r.url().replace(args.base, '')));
        await waitFor(page, ['coaching', 'dead'], 40_000);
        const during = [...requests];
        await ctx.setOffline(true);
        const next = await waitFor(page, ['runup', 'live'], 20_000);
        const resolved = await waitFor(page, ['coaching', 'dead'], 40_000);
        return { pass: during.length === 0 && Boolean(resolved), requestsDuringDelivery: during.slice(0, 20), offlineBallResolved: resolved, nextBallStarted: next };
      } finally {
        await ctx.close();
      }
    }),
  );
  checks.push(
    await check('leave-mid-over-keeps-it', async () => {
      const { ctx, page } = await open(browser, args, { tier: 'full', timeScale: 2, seed: 'eval-rec-exit' });
      try {
        await queue(page, BLOCK, BLOCK);
        await startQuick(page);
        await waitFor(page, ['coaching', 'dead'], 40_000);
        const ballsBefore = (await hookState(page))?.balls;
        await page.keyboard.press('Escape');
        await sleep(600);
        const askedOrPaused = await page.evaluate(() => window.__vandePractice.state().phase);
        const exitVia = await tryPress(page, true, ['practice-leave', 'practice-exit', 'practice-pause-exit'], [/^leave/i, /^exit/i, /^menu/i, /^back to practice/i]);
        await sleep(900);
        const confirm = await page.locator('[role=dialog],[role=alertdialog]').first().isVisible().catch(() => false);
        if (confirm) await tryPress(page, true, ['practice-leave-dialog-confirm', 'dialog-confirm'], [/^leave/i, /^exit/i, /^yes/i, /^end/i]);
        await sleep(900);
        const card = await page.getByTestId('practice-resume-card').isVisible().catch(() => false);
        const words = await notices(page);
        const st = await hookState(page);
        return { pass: card || st?.balls === ballsBefore, ballsBefore, phaseAfterEscape: askedOrPaused, exitVia, confirmShown: confirm, resumeCard: card, ballsKept: st?.balls, notice: words };
      } finally {
        await ctx.close();
      }
    }),
  );
  const summary = { passed: checks.filter((c) => c.pass).length, of: checks.length, failed: checks.filter((c) => !c.pass).map((c) => c.name) };
  const file = writeJson(args, 'recovery', { summary, checks });
  log(args, `recovery ${summary.passed}/${summary.of} → ${file}`);
  return summary;
}
