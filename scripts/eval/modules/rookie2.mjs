/**
 * Rookie adversarial machine checks, part 2 (see rookie.mjs): failure reasons over a failure-heavy run, the exact
 * retry from a failure with the recommended response executed by script, and "another over".
 */
import { hookState, queue, sleep, uptime, waitFor } from '../lib/env.mjs';
import { tryPress } from './capture.mjs';
import { afterBall, failure, nowMs, open, sentences, startOver } from './rookie.mjs';

/** Failure-heavy swings, cycled: late, early, a miss, a leave, a wild aim, a defence, and one ideal drive. */
const MIX = [
  { kind: 'attack', contactErrorMs: 90, directionDeg: 10, power: 0.7 },
  { kind: 'attack', contactErrorMs: -90, directionDeg: -10, power: 0.7 },
  { kind: 'attack', contactErrorMs: 170, directionDeg: 0, power: 0.8 },
  'leave',
  { kind: 'attack', contactErrorMs: 0, directionDeg: 75, power: 0.9, elevation: 0.8 },
  { kind: 'defend', contactErrorMs: 40 },
  { kind: 'attack', contactErrorMs: 0, directionDeg: 20, power: 0.7 },
];

async function nextBallOrOver(page) {
  const st = await hookState(page);
  if (st?.screen === 'over_summary') {
    await tryPress(page, true, ['practice-next-over'], [/next over/i, /another over/i]);
    await sleep(700);
    for (let i = 0; i < 6; i++) if (!(await tryPress(page, true, ['practice-play-start', 'practice-setup-play']))) break;
    return;
  }
  if (st?.screen === 'out' || st?.screen === 'complete') {
    await tryPress(page, true, ['practice-new-innings'], [/new innings/i, /start new innings/i]);
    await sleep(900);
    await tryPress(page, true, ['practice-new-innings-confirm', 'practice-discard-dialog-confirm'], [/^start/i, /^new innings/i]);
    await sleep(700);
    await startOver(page);
    return;
  }
  await tryPress(page, true, ['practice-next-ball'], [/^next ball$/i]);
}

/** F6, RK4, COACH1: 60 balls; every failure must show a reason (one sentence) and exactly one recommendation. */
export async function failures(browser, args, n = 60) {
  const { page } = await open(browser, args, { tier: 'full', timeScale: 1, seed: 'eval-f6' });
  const rows = [];
  try {
    await page.evaluate(() => window.__eval.timeline(true));
    await startOver(page);
    for (let i = 0; i < n; i++) {
      await queue(page, MIX[i % MIX.length]);
      if (!(await waitFor(page, ['runup', 'live'], 45_000))) {
        await nextBallOrOver(page);
        if (!(await waitFor(page, ['runup', 'live'], 45_000))) break;
      }
      const since = await nowMs(page);
      if (!(await waitFor(page, ['dead', 'coaching', 'out', 'over_summary'], 45_000))) break;
      await sleep(350);
      const a = await afterBall(page, since);
      const pick = (id) => a.texts.filter((x) => x.id === id).map((x) => x.text).pop() || '';
      const reason = pick('practice-result-reason') || pick('practice-coaching');
      const rec = pick('practice-result-recommendation');
      const fail = failure(a.last);
      rows.push({ i, swing: MIX[i % MIX.length], last: a.last, failure: Boolean(fail), reason, reasonSentences: sentences(reason), recommendation: rec, recommendations: rec ? 1 : 0, insight: a.insight, layer: pick('practice-result').slice(0, 240), buttons: a.buttons });
      await nextBallOrOver(page);
    }
    var timeline = await page.evaluate(() => window.__eval.timeline(false)).catch(() => []);
  } finally {
    await page.context().close();
  }
  // FAIR4: the shown score never changes while a ball is still in play (run-up, live, playing).
  const scoreEarly = [];
  const qualityChanges = [];
  for (let k = 1; k < (timeline || []).length; k++) {
    const a = timeline[k - 1];
    const b = timeline[k];
    if ((a.runs !== b.runs || a.scoreText !== b.scoreText) && ['runup', 'live', 'playing'].includes(b.phase)) scoreEarly.push({ at: b.t, from: a.scoreText, to: b.scoreText, phase: b.phase });
    // FAIR5: quality and assistance constant from release to outcome.
    if ((a.quality !== b.quality || a.assist !== b.assist) && ['live', 'playing'].includes(b.phase)) qualityChanges.push({ at: b.t, from: `${a.quality}|${a.assist}`, to: `${b.quality}|${b.assist}`, phase: b.phase });
  }
  // READ4: run-up time (run-up start → release) by bowling family, and whether the release speed is ever shown.
  const runups = { pace: [], spin: [] };
  for (let k = 1; k < (timeline || []).length; k++) if (timeline[k].phase === 'live' && timeline[k - 1].phase === 'runup' && runups[timeline[k].family]) runups[timeline[k].family].push(timeline[k].t - timeline[k - 1].t);
  const med = (xs) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null);
  const speedShown = rows.some((r) => /km\/h|kph/i.test(`${r.layer} ${r.reason} ${r.recommendation}`));
  const fails = rows.filter((r) => r.failure);
  return {
    read4: { runupMedianMs: { pace: med(runups.pace), spin: med(runups.spin) }, balls: { pace: runups.pace.length, spin: runups.spin.length }, speedShownOnResult: speedShown },
    balls: rows.length,
    failures: fails.length,
    withReason: fails.filter((r) => r.reason).length,
    reasonOneSentence: fails.filter((r) => r.reason && r.reasonSentences <= 1).length,
    withOneRecommendation: fails.filter((r) => r.recommendations === 1).length,
    insightReady: fails.filter((r) => r.insight?.status === 'ready').length,
    fair4: { timelineEvents: (timeline || []).length, scoreChangedDuringPlay: scoreEarly },
    fair5: { qualityOrAssistChangedDuringDelivery: qualityChanges },
    rows,
    uptime: uptime(),
  };
}

/**
 * RK5, COACH2, COACH4, COACH5 on the reference over (three failure types per ball): from the failed ball, the taps
 * to the retried ball's run-up; the recommended response (the coach's own option, queued exactly) on the identical
 * ball; whether it succeeds; and the comparison shown after it.
 */
export async function retry(browser, args) {
  const types = [{ name: 'late', swing: { kind: 'attack', contactErrorMs: 110, directionDeg: 10, power: 0.7 } }, { name: 'early', swing: { kind: 'attack', contactErrorMs: -110, directionDeg: -5, power: 0.7 } }, { name: 'leave', swing: 'leave' }];
  const cases = [];
  for (const type of types) {
    const { ctx, page } = await open(browser, args, { tier: 'full', timeScale: 1.5, seed: `eval-retry-${type.name}` });
    try {
      await startOver(page, 'predefined');
      const kind = (await hookState(page))?.over?.source ?? null;
      for (let b = 0; b < 6; b++) {
        await queue(page, type.swing);
        if (!(await waitFor(page, ['runup', 'live'], 45_000))) break;
        const flightA = await page.evaluate(() => window.__eval.flightHash());
        await waitFor(page, ['dead', 'coaching', 'out', 'over_summary'], 45_000);
        await sleep(400);
        const a = await afterBall(page, 0);
        const c = { type: type.name, ball: b + 1, over: kind, first: a.last, taps: 0, via: [] };
        // Tap 1: the retry entry on the result.
        let v = await tryPress(page, true, ['practice-replay-exact', 'practice-practice-ball', 'practice-practice-delivery'], [/replay exact ball/i, /practice this (ball|delivery)/i, /try again/i]);
        if (v) {
          c.taps++;
          c.via.push(v);
        }
        await sleep(700);
        const coach = await page.evaluate(() => {
          const s = window.__eval.flow()?.getState();
          const rec = s?.coach?.base?.options?.find((o) => o.kind === 'recommended') ?? null;
          return { screen: s?.screen, rec: rec ? { swing: rec.swing, decision: rec.decision, contact: rec.contact, outcome: rec.outcome } : null };
        });
        c.recommended = coach.rec;
        if (coach.rec) await queue(page, coach.rec.swing ? { ...coach.rec.swing } : 'leave');
        else await queue(page, type.swing);
        const st = await hookState(page);
        if (!st || !['runup', 'live', 'ready'].includes(st.phase)) {
          v = await tryPress(page, true, ['practice-replay-exact'], [/replay exact ball/i]);
          if (v) {
            c.taps++;
            c.via.push(v);
          }
        }
        if (await waitFor(page, ['runup', 'live'], 30_000)) {
          c.flightSame = (await page.evaluate(() => window.__eval.flightHash()))?.hash === flightA?.hash;
          await waitFor(page, ['dead', 'coaching', 'out', 'over_summary'], 45_000);
          await sleep(600);
          const after = await afterBall(page, 0);
          c.retry = after.last;
          c.success = Boolean(after.last && !after.last.dismissal && (after.last.contact === 'middle' || (after.last.swing === null && coach.rec?.decision === 'leave')));
          c.compare = await page.evaluate(() => document.querySelector('[data-testid="practice-compare"]')?.innerText?.replace(/\s+/g, ' ').trim() ?? null);
          c.comparison = await page.evaluate(() => window.__eval.flow()?.getState().coach?.comparison ?? null);
        }
        cases.push(c);
        // Back to the over for the next ball.
        await tryPress(page, true, ['practice-coach-back'], [/^back/i, /^continue/i]);
        await sleep(600);
        await tryPress(page, true, ['practice-next-ball'], [/^next ball$/i]);
        if ((await hookState(page))?.screen === 'out') break;
      }
    } catch (e) {
      cases.push({ type: type.name, error: String(e).slice(0, 200) });
    } finally {
      await ctx.close();
    }
  }
  const done = cases.filter((c) => c.retry);
  return {
    cases: cases.length,
    retried: done.length,
    oneTap: cases.filter((c) => c.taps === 1 && c.retry).length,
    tapsSeen: [...new Set(cases.map((c) => c.taps))],
    identicalFlight: done.filter((c) => c.flightSame).length,
    recommendationSucceeded: done.filter((c) => c.success).length,
    withComparison: done.filter((c) => c.compare).length,
    rows: cases,
    uptime: uptime(),
  };
}

/** RK6: from the end of an over, taps to the next over's first ball, and the primary action there. */
export async function another(browser, args) {
  const { ctx, page } = await open(browser, args, { tier: 'full', timeScale: 3, seed: 'eval-rk6' });
  try {
    await queue(page, ...Array.from({ length: 6 }, () => ({ kind: 'defend', contactErrorMs: 0 })));
    await startOver(page);
    if (!(await waitFor(page, ['over_summary', 'out'], 120_000))) return { error: 'over did not end' };
    await sleep(800);
    const controls = await page.evaluate(() => window.__eval.controls().filter((c) => c.reachable && !c.disabled).sort((a, b) => b.weight - a.weight));
    const primary = controls[0]?.name ?? null;
    let taps = 0;
    const via = [];
    await queue(page, { kind: 'defend', contactErrorMs: 0 });
    for (let i = 0; i < 5; i++) {
      const st = await hookState(page);
      if (st && ['ready', 'runup', 'live'].includes(st.phase) && st.screen === 'live') break;
      const v = await tryPress(page, true, ['practice-next-over', 'practice-another-over', 'practice-play-start', 'practice-setup-play'], [/another over/i, /next over/i, /^play$/i]);
      if (!v) break;
      taps++;
      via.push(v);
      await sleep(900);
    }
    const reached = await waitFor(page, ['runup', 'live'], 30_000);
    return { primary, controls: controls.slice(0, 8).map((c) => `${c.name} (w${c.weight})`), taps, via, reached, uptime: uptime() };
  } finally {
    await ctx.close();
  }
}

/**
 * COACH3 and COACH6 in Coach Mode: the demonstration plays the identical ball (flight hash), and repeated correct
 * execution (the coach's own recommended swing, queued exactly) steps the assistance stage down; mastery needs more
 * than one success. Reads practice-mastery (data-stage, data-mastered) and the controller's coach state after each try.
 */
export async function coach(browser, args, tries = 6) {
  const { ctx, page } = await open(browser, args, { tier: 'full', timeScale: 2, seed: 'eval-coach' });
  const out = { tries: [] };
  try {
    await queue(page, 'leave');
    await startOver(page);
    if (!(await waitFor(page, ['runup', 'live'], 45_000))) return { error: 'no ball' };
    const source = await page.evaluate(() => window.__eval.flightHash());
    await waitFor(page, ['dead', 'coaching'], 45_000);
    await sleep(500);
    out.first = (await hookState(page))?.last ?? null;
    // Into Coach Mode on the identical ball: queue the coach's recommended response first (the tap bowls at once).
    const rec = await page.evaluate(() => window.__eval.flow()?.getState().insight?.analysis?.options?.find((o) => o.kind === 'recommended') ?? null);
    out.recommended = rec ? { decision: rec.decision, swing: rec.swing, contact: rec.contact, outcome: rec.outcome } : null;
    for (let i = 0; i < tries; i++) {
      await queue(page, rec?.swing ? { ...rec.swing } : 'leave');
      const via = await tryPress(page, true, i === 0 ? ['practice-practice-ball', 'practice-practice-delivery'] : ['practice-replay-exact'], i === 0 ? [/practice this ball/i] : [/replay exact ball/i]);
      if (!via) {
        out.tries.push({ i, error: 'no retry control' });
        break;
      }
      if (!(await waitFor(page, ['runup', 'live'], 30_000))) break;
      const h = await page.evaluate(() => window.__eval.flightHash());
      for (let k = 0; k < 80; k++) {
        const ph = (await hookState(page))?.phase;
        if (!['runup', 'live', 'playing', 'ready'].includes(ph)) break;
        await sleep(100);
      }
      await sleep(600);
      const m = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="practice-mastery"]');
        const c = window.__eval.flow()?.getState().coach;
        const L = c?.latest?.result;
        return { stage: el?.getAttribute('data-stage') ?? null, mastered: el?.getAttribute('data-mastered') ?? null, text: el?.innerText?.replace(/\s+/g, ' ').trim().slice(0, 160) ?? null, verdict: c?.comparison?.verdict ?? null, attempts: c?.attempts ?? null, contact: L?.contact?.kind ?? null, dismissal: L?.outcome?.dismissal ?? null };
      });
      out.tries.push({ i, via, identical: h?.hash === source?.hash, ...m });
    }
    // COACH3: the demonstration, on the identical ball.
    if (await tryPress(page, true, ['practice-coach-demo'], [/watch demonstration/i])) {
      const ok = await waitFor(page, ['demo'], 10_000);
      await sleep(400);
      const h = await page.evaluate(() => window.__eval.flightHash());
      out.demo = { started: ok, identical: h?.hash === source?.hash, hash: h?.hash ?? null };
    } else out.demo = { started: false, why: 'no demonstration control in Coach Mode' };
  } catch (e) {
    out.error = String(e).slice(0, 200);
  } finally {
    await ctx.close();
  }
  out.uptime = uptime();
  return out;
}
