/**
 * The screenshot matrix: launch, Practice menu, configuration (Random and Predefined), field view, live batting
 * (first person and Classic), after contact, the result, coaching, replay, pause, the over summary, an exact repeat,
 * settings and the fallbacks, at every viewport, plus a video of one first-person ball. Each shot carries its DOM
 * census (controls, text, text issues, running animations). A state the build never reaches is recorded as missing
 * with the reason: that is evidence too.
 */
import { bulkDir, context, isTouchVp, hookState, newPage, queue, sleep, snap, waitFor } from '../lib/env.mjs';
import { find, press, visible } from '../lib/driver.mjs';
import { configureBuildOver } from './flow.mjs';

const PH = {
  field: ['radar', 'field', 'field_preview'],
  runup: ['runup'],
  live: ['live'],
  after: ['playing'],
  result: ['coaching', 'dead'],
  replay: ['replay'],
  explain: ['warmup_explain'],
  coach: ['coach'],
  demo: ['demo'],
  closeup: ['closeup'],
  summary: ['over_summary', 'summary'],
  paused: ['paused'],
};

/** Presses the first visible of these test ids / button names; returns what it pressed or null. */
async function tryPress(page, touch, ids = [], names = []) {
  for (const id of ids) {
    const loc = page.getByTestId(id);
    if (await visible(loc)) {
      await press(page, { loc: loc.first() }, touch).catch(() => undefined);
      return `testid=${id}`;
    }
  }
  for (const n of names) {
    const loc = page.getByRole('button', { name: n });
    if (await visible(loc)) {
      await press(page, { loc: loc.first() }, touch).catch(() => undefined);
      return `name=${n}`;
    }
  }
  return null;
}

async function back(page, touch) {
  return (await tryPress(page, touch, ['screen-back', 'practice-back'], [/^back$/i])) || (await page.goBack().then(() => 'history.back').catch(() => null));
}

/** Journey A: a returning player at a slow time scale, from launch to a replayed first ball. */
async function journeyMain(browser, args, vp, shots, missing) {
  const touch = isTouchVp(vp);
  const video = vp === '915x412' && args.video ? bulkDir(args, 'video') : null;
  const ctx = await context(browser, vp, { hooks: { tier: 'full', timeScale: 0.35, seed: 'eval-capture' }, storage: { 'vc:practice:settings': { v: 1, guidedDone: true, demoSeen: true } }, video });
  const errors = [];
  const page = await newPage(ctx, errors);
  const S = async (name, extra) => shots.push(await snap(page, args, vp, name, extra));
  const M = (name, why) => missing.push({ viewport: vp, name, why });
  try {
    await page.goto(args.base + '/');
    const practice = await (async () => {
      for (let i = 0; i < 100; i++) {
        const p = await find(page, 'practice');
        if (p) return p;
        // Stage 1: the root is the Practice home (Random Over, Predefined Over), with no Practice entry.
        if (i > 15 && (await find(page, 'random', { reject: (l) => /quick/i.test(l) && !/random/i.test(l) }))) return null;
        await sleep(100);
      }
      return null;
    })();
    await sleep(600);
    await S('01-launch');
    const rootModes = !practice && (await find(page, 'random', { reject: (l) => /quick/i.test(l) && !/random/i.test(l) }));
    if (!practice && !rootModes) return M('02-practice-menu', 'no Practice action and no Practice modes on the launch screen');
    const chase = await find(page, 'chase');
    if (chase) await S('01b-launch-chase-visible', { chaseLabel: chase.label });
    if (practice) {
      await press(page, practice, touch);
      await sleep(1200);
    }
    await S('02-practice-menu', { rootIsPractice: !practice });
    // Random Over setup (the rebuilt flow) or, before it, the menu's optional pitch.
    const random = await find(page, 'random', { reject: (l) => /quick/i.test(l) });
    if (random) {
      await press(page, random, touch);
      await sleep(900);
      await S('03-random-setup');
      await back(page, touch);
      await sleep(700);
    } else if (await tryPress(page, touch, ['practice-pitch-toggle'])) {
      await sleep(500);
      await S('03-pitch-options');
      await tryPress(page, touch, ['practice-pitch-toggle']);
      M('03-random-setup', 'no Random Over mode on the Practice screen');
    }
    const predefined = await find(page, 'predefined');
    if (predefined) {
      await press(page, predefined, touch);
      await sleep(900);
      await S('04-predefined-empty');
      const taps = await configureBuildOver(page, touch);
      if (taps !== null) await S('05-predefined-full', { configTaps: taps });
      else M('05-predefined-full', 'the driver cannot fill this editor yet (scripts/eval/modules/flow.mjs configurePredefined)');
      await back(page, touch);
      await sleep(900);
    } else M('04-predefined-empty', 'no Predefined/Build an Over action');
    if (await tryPress(page, touch, ['practice-settings-open'], [/^settings$/i])) {
      await sleep(800);
      await S('06-settings');
      await back(page, touch);
      await sleep(800);
    }
    // Quick play: a perfect drive towards cover, so there is contact, a fielding camera and a result.
    await queue(page, { kind: 'attack', contactErrorMs: 0, directionDeg: 25, power: 0.75 });
    const quick = await find(page, 'quick', { reject: (l) => /random over/i.test(l) && !/quick/i.test(l) });
    if (!quick) return M('07-field', 'no Quick action');
    await press(page, quick, touch);
    // The rebuilt flow prepares the session on one screen (conditions, bowler, field, objective) before Play.
    let setupField = false;
    for (let i = 0; i < 12; i++) {
      if (await page.getByTestId('practice-setup').isVisible().catch(() => false)) {
        await sleep(700);
        setupField = await page.getByTestId('practice-field-map').isVisible().catch(() => false);
        await S('07a-setup', { fieldMap: setupField });
        break;
      }
      const st = await hookState(page);
      if (st && ['radar', 'runup', 'live'].includes(st.phase)) break;
      await sleep(250);
    }
    if (await tryPress(page, touch, ['practice-brief-field', 'practice-field-detail-toggle'])) {
      await sleep(600);
      await S('07b-field-detail');
      await tryPress(page, touch, ['practice-brief-close'], [/^close$/i, /^done$/i]);
    }
    for (let i = 0; i < 6; i++) {
      const st = await hookState(page);
      if (st && ['radar', 'runup', 'live'].includes(st.phase)) break;
      if (!(await tryPress(page, touch, ['practice-setup-play', 'practice-play-start', 'practice-start', 'practice-tap-go']))) await sleep(500);
    }
    if (setupField) {
      /* the rebuilt Setup shows the field map before Play (07a-setup) */
    } else if (await waitFor(page, PH.field, 8000)) {
      await sleep(500);
      await S('07-field');
    } else M('07-field', 'no field view before the first ball (no radar phase and no field map on a setup screen)');
    if (await waitFor(page, PH.runup, 30_000)) {
      await sleep(900);
      await S('08-live-runup');
    } else M('08-live-runup', 'run-up never reached');
    if (await waitFor(page, PH.live, 30_000)) {
      await sleep(550);
      await S('09-live-flight');
    } else M('09-live-flight', 'release never reached');
    if (await waitFor(page, PH.after, 20_000)) {
      await sleep(900);
      await S('10-after-contact');
    } else M('10-after-contact', 'no post-contact phase');
    if (await waitFor(page, PH.result, 30_000)) {
      await sleep(900);
      const st = await hookState(page);
      await S('11-result', { last: st?.last ?? null });
      const why = await tryPress(page, touch, ['practice-why-toggle', 'practice-coach-open', 'practice-why-open', 'practice-result-expand'], [/^why\??$/i]);
      if (why) {
        await sleep(800);
        await S('12-why', { via: why });
      } else M('12-why', 'no "Why?" disclosure on the result');
      const rep = await tryPress(page, touch, ['practice-slowmo', 'practice-replay-ball'], [/slow-motion replay/i, /^replay$/i]);
      if (rep && (await waitFor(page, PH.replay, 15_000))) {
        await sleep(2200);
        await S('13-replay', { via: rep });
        await tryPress(page, touch, ['practice-replay-close'], [/^close/i, /^done/i]);
        await waitFor(page, PH.result, 15_000);
        await sleep(600);
      } else M('13-replay', 'no single-ball replay from the result');
      if (await tryPress(page, touch, ['practice-closeup'], [/close-up/i])) {
        if (await waitFor(page, PH.closeup, 8000)) {
          await sleep(1500);
          await S('13b-closeup');
        }
        await waitFor(page, PH.result, 20_000);
        await sleep(500);
      } else M('13b-closeup', 'no ball close-up');
      const coach = await tryPress(page, touch, ['practice-practice-ball', 'practice-coach-open'], [/practice this ball/i]);
      if (coach && (await waitFor(page, PH.coach, 10_000))) {
        await sleep(900);
        await S('12c-coach', { via: coach });
        if (await tryPress(page, touch, ['practice-coach-demo'], [/watch demonstration/i, /^demo/i])) {
          if (await waitFor(page, PH.demo, 10_000)) {
            await sleep(1600);
            await S('12d-coach-demo');
          }
          await waitFor(page, PH.coach, 30_000);
          await sleep(600);
        }
        await queue(page, { kind: 'attack', contactErrorMs: 0, directionDeg: 25, power: 0.75 });
        if (await tryPress(page, touch, ['practice-replay-exact'], [/replay exact ball/i])) {
          if (await waitFor(page, PH.runup, 20_000)) {
            await sleep(900);
            await S('15a-exact-runup');
          }
          if (await waitFor(page, PH.result, 40_000)) {
            await sleep(900);
            await S('15c-exact-result', { last: (await hookState(page))?.last ?? null });
            if (await tryPress(page, touch, ['practice-practice-ball'], [/practice this ball/i])) {
              await waitFor(page, PH.coach, 10_000);
              await sleep(900);
              await S('15d-coach-compare');
            }
          }
        } else M('15a-exact-runup', 'no "Replay exact ball" in Coach Mode');
      } else M('12c-coach', 'no Coach Mode from the result');
    } else M('11-result', 'no result phase');
    await sleep(600);
    if (await tryPress(page, touch, ['practice-pause'], [/^pause$/i])) {
      if (await waitFor(page, PH.paused, 8000)) {
        await sleep(500);
        await S('16-paused');
      }
    }
  } catch (e) {
    M('journey-main', String(e).slice(0, 300));
  } finally {
    await ctx.close();
    if (errors.length) missing.push({ viewport: vp, name: 'page-errors-main', why: errors.slice(0, 8) });
  }
}

/** Journey S: the over summary, an exact repeat and Replay This Over, at a quicker time scale. */
async function journeySummary(browser, args, vp, shots, missing) {
  const touch = isTouchVp(vp);
  const ctx = await context(browser, vp, { hooks: { tier: 'full', timeScale: 3, seed: 'eval-summary', autoNext: true }, storage: { 'vc:practice:settings': { v: 1, guidedDone: true, demoSeen: true } } });
  const errors = [];
  const page = await newPage(ctx, errors);
  const S = async (name, extra) => shots.push(await snap(page, args, vp, name, extra));
  try {
    await page.goto(args.base + '/practice');
    await sleep(1500);
    const swings = [
      { kind: 'attack', contactErrorMs: 0, directionDeg: 20, power: 0.7 },
      { kind: 'defend', contactErrorMs: 0 },
      { kind: 'attack', contactErrorMs: 45, directionDeg: -30, power: 0.6 },
      'leave',
      { kind: 'attack', contactErrorMs: -40, directionDeg: 10, power: 0.8 },
      { kind: 'defend', contactErrorMs: 0 },
    ];
    await queue(page, ...swings);
    const quick = await find(page, 'quick', { reject: (l) => /random over/i.test(l) && !/quick/i.test(l) });
    if (quick) await press(page, quick, touch);
    for (let i = 0; i < 6; i++) if (!(await tryPress(page, touch, ['practice-setup-play', 'practice-play-start', 'practice-start', 'practice-tap-go']))) break;
    const end = await waitFor(page, [...PH.summary, 'out'], 150_000);
    await sleep(900);
    if (!end) missing.push({ viewport: vp, name: '14-over-summary', why: 'over did not finish' });
    await S('14-over-summary', { state: await hookState(page) });
    await queue(page, { kind: 'attack', contactErrorMs: 0, directionDeg: 20, power: 0.7 });
    const rep = await tryPress(page, touch, ['practice-repeat-1', 'practice-practice-delivery', 'practice-this-ball'], [/practice this (ball|delivery)/i]);
    if (rep && (await waitFor(page, PH.result, 60_000))) {
      await sleep(700);
      await S('15-repeat-result', { via: rep, state: await hookState(page) });
      await tryPress(page, touch, ['practice-repeat-back'], [/^back to/i, /^done/i]);
      await sleep(900);
    } else missing.push({ viewport: vp, name: '15-repeat-result', why: 'no exact repeat from the summary' });
    if (await tryPress(page, touch, ['practice-replay-over'], [/replay this over/i])) {
      if (await waitFor(page, PH.replay, 20_000)) {
        await sleep(1500);
        await S('17-replay-over');
      }
    }
  } catch (e) {
    missing.push({ viewport: vp, name: 'journey-summary', why: String(e).slice(0, 300) });
  } finally {
    await ctx.close();
    if (errors.length) missing.push({ viewport: vp, name: 'page-errors-summary', why: errors.slice(0, 8) });
  }
}

export { tryPress, journeyMain, journeySummary, PH };
