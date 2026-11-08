/**
 * Exact-ball reproducibility (the same flight, bit for bit, on every repeat, after a reload and in another tier),
 * and outcome explainability (every result's words agree with the physics record: contact, timing and runs).
 * Flights are hashed in the page from the stage's own flight: seed, plan, release, bounce and every sample.
 */
import { context, hookState, log, newPage, queue, sleep, waitFor, writeJson } from '../lib/env.mjs';
import { find, press } from '../lib/driver.mjs';
import { tryPress } from './capture.mjs';

const RESULT_IDS = ['practice-result', 'practice-results', 'practice-coaching', 'practice-result-strip', 'practice-warmup-explain'];
const REPEAT_IDS = ['practice-replay-exact', 'practice-this-ball', 'practice-coach-retry', 'practice-practice-delivery', 'practice-repeat-again'];
const REPEAT_NAMES = [/replay exact ball/i, /practice this (ball|delivery)/i, /try (it|this ball) again/i];

async function resultText(page) {
  for (const id of RESULT_IDS) {
    const loc = page.getByTestId(id);
    if (await loc.first().isVisible().catch(() => false)) return { id, text: ((await loc.first().textContent()) || '').replace(/\s+/g, ' ').trim() };
  }
  return null;
}

async function open(browser, args, vp, tier, seed, timeScale = 4) {
  const ctx = await context(browser, vp, { hooks: { tier, timeScale, seed, autoNext: true }, storage: { 'vc:practice:settings': { v: 1, guidedDone: true, demoSeen: true } } });
  const page = await newPage(ctx, []);
  await page.goto(args.base + '/practice');
  await sleep(1200);
  return { ctx, page };
}

async function startQuick(page) {
  const q = await find(page, 'quick', { reject: (l) => /random over/i.test(l) && !/quick/i.test(l) });
  if (q) await press(page, q, false);
  for (let i = 0; i < 6; i++) {
    const st = await hookState(page);
    if (st && ['radar', 'runup', 'live'].includes(st.phase)) return true;
    if (!(await tryPress(page, false, ['practice-setup-play', 'practice-play-start', 'practice-start', 'practice-tap-go']))) await sleep(300);
  }
  return Boolean(q);
}

/** One exact repeat: Coach Mode's "Replay exact ball" (opening Coach Mode first if needed), else the older paths. */
async function repeatOnce(page) {
  let via = await tryPress(page, false, ['practice-replay-exact'], [/replay exact ball/i]);
  if (via) return via;
  if (await tryPress(page, false, ['practice-practice-ball'], [/practice this ball/i])) {
    await waitFor(page, ['coach'], 10_000);
    await sleep(400);
    via = await tryPress(page, false, ['practice-replay-exact'], [/replay exact ball/i]);
    if (via) return `coach→${via}`;
  }
  return tryPress(page, false, [...REPEAT_IDS, 'practice-repeat-1'], REPEAT_NAMES);
}

/** Bowls one ball with the queued swing; returns the flight hash, the record and the words shown. */
async function oneBall(page) {
  if (!(await waitFor(page, ['runup', 'live'], 60_000))) return { error: 'no delivery' };
  const flight = await page.evaluate(() => window.__eval.flightHash());
  const done = await waitFor(page, ['coaching', 'dead', 'warmup_explain', 'over_summary', 'out'], 60_000);
  await sleep(250);
  const st = await hookState(page);
  return { flight, last: st?.last ?? null, words: done ? await resultText(page) : null, balls: st?.balls ?? null };
}

const SWINGS = [
  { kind: 'attack', contactErrorMs: 0, directionDeg: 20, power: 0.7 },
  { kind: 'attack', contactErrorMs: -70, directionDeg: 0, power: 0.7 },
  { kind: 'attack', contactErrorMs: 70, directionDeg: -20, power: 0.7 },
  'leave',
  { kind: 'defend', contactErrorMs: 0 },
  { kind: 'attack', contactErrorMs: 160, directionDeg: 30, power: 0.9 },
];

const CONTACT_WORDS = {
  middle: /middle|solid|clean|perfect|timed|sweet|good contact|well/i,
  inside_edge: /inside edge|edge/i,
  outside_edge: /outside edge|edge/i,
  top_edge: /top edge|edge|skied|top/i,
  leading_edge: /leading edge|edge/i,
  pad: /pad|lbw|leg/i,
  body: /body|hit on|struck/i,
  miss: /miss|beaten|played and missed|past the bat/i,
  leave: /left|leave|no shot/i,
};
const runWords = (r, out) => (out ? /out|bowled|caught|lbw|stumped|run out|wicket/i : r === 0 ? /dot|no run|0 runs|blocked|defended|left/i : r === 4 ? /four|\b4\b/i : r === 6 ? /six|\b6\b/i : new RegExp(`\\b${r}\\b|${['', 'one|single', 'two', 'three'][r] || r}`, 'i'));

export function explainCheck(ball, swing) {
  const text = ball.words?.text || '';
  const c = ball.last?.contact;
  const ok = { hasText: text.length > 0, contact: c ? CONTACT_WORDS[c]?.test(text) ?? false : false, runs: ball.last ? runWords(ball.last.runs, ball.last.dismissal).test(text) : false, timing: null, ms: /\d+\s?ms/.test(text) };
  if (swing && swing !== 'leave' && Math.abs(swing.contactErrorMs) >= 50 && c !== 'leave') ok.timing = swing.contactErrorMs < 0 ? /early/i.test(text) : /late/i.test(text);
  return { contact: c, runs: ball.last?.runs, dismissal: ball.last?.dismissal, swing, text: text.slice(0, 220), ...ok };
}

export async function runDeterminism(browser, args) {
  const vp = '1280x800';
  const out = { explain: [], repeat: [], tiers: [] };
  // An over with six different swings: words against the record.
  log(args, 'determinism: explainability over');
  {
    const { ctx, page } = await open(browser, args, vp, 'full', 'eval-explain', 3);
    try {
      await queue(page, ...SWINGS);
      await startQuick(page);
      for (const s of SWINGS) {
        const b = await oneBall(page);
        out.explain.push(explainCheck(b, s));
        await tryPress(page, false, ['practice-next-ball', 'practice-result-next'], [/^next ball$/i]);
      }
    } finally {
      await ctx.close();
    }
  }
  // The same seed in first person and in Classic: identical flights and records.
  for (const tier of ['full', 'below']) {
    log(args, `determinism: tier ${tier}`);
    const { ctx, page } = await open(browser, args, vp, tier, 'eval-tiers', 3);
    try {
      await queue(page, ...SWINGS.slice(0, 3));
      await startQuick(page);
      const balls = [];
      for (let i = 0; i < 3; i++) {
        balls.push(await oneBall(page));
        await tryPress(page, false, ['practice-next-ball', 'practice-result-next'], [/^next ball$/i]);
      }
      out.tiers.push({ tier, stage: (await hookState(page))?.stage, balls: balls.map((b) => ({ hash: b.flight?.hash, contact: b.last?.contact, runs: b.last?.runs, dismissal: b.last?.dismissal })) });
    } finally {
      await ctx.close();
    }
  }
  // Repeat the same ball: from the result (rebuilt flow) or after the over (before it); three times, then after a reload.
  log(args, 'determinism: exact repeats');
  {
    const { ctx, page } = await open(browser, args, vp, 'full', 'eval-repeat', 3);
    try {
      const swing = { kind: 'attack', contactErrorMs: 30, directionDeg: 15, power: 0.7 };
      await queue(page, swing);
      await startQuick(page);
      const original = await oneBall(page);
      out.repeat.push({ kind: 'original', hash: original.flight?.hash, last: original.last });
      let via = (await page.getByTestId('practice-practice-ball').isVisible().catch(() => false)) || (await page.getByTestId('practice-replay-exact').isVisible().catch(() => false)) ? 'coach' : await tryPress(page, false, REPEAT_IDS, REPEAT_NAMES);
      if (!via) {
        await queue(page, ...Array.from({ length: 5 }, () => ({ kind: 'defend', contactErrorMs: 0 })));
        await waitFor(page, ['over_summary', 'out'], 120_000);
        await sleep(400);
      }
      for (let i = 0; i < 3; i++) {
        await queue(page, swing);
        via = via && via !== 'coach' && i === 0 ? via : await repeatOnce(page);
        if (!via) {
          out.repeat.push({ kind: `repeat-${i + 1}`, error: 'no repeat action' });
          break;
        }
        const b = await oneBall(page);
        out.repeat.push({ kind: `repeat-${i + 1}`, via, hash: b.flight?.hash, last: b.last, counted: b.balls });
        await tryPress(page, false, ['practice-repeat-back'], [/^back/i]);
        await sleep(500);
      }
      await page.reload();
      await sleep(2000);
      await tryPress(page, false, ['practice-continue'], [/^continue/i]);
      await sleep(1500);
      await queue(page, swing);
      const via2 = await repeatOnce(page);
      if (via2) {
        const b = await oneBall(page);
        out.repeat.push({ kind: 'after-reload', via: via2, hash: b.flight?.hash, last: b.last });
      } else out.repeat.push({ kind: 'after-reload', error: 'no repeat action after a reload' });
    } finally {
      await ctx.close();
    }
  }
  const orig = out.repeat.find((r) => r.kind === 'original');
  const reps = out.repeat.filter((r) => r.kind !== 'original' && r.hash);
  const sameResult = (a, b) => a && b && a.contact === b.contact && a.runs === b.runs && a.dismissal === b.dismissal;
  const tFull = out.tiers.find((t) => t.tier === 'full');
  const tBelow = out.tiers.find((t) => t.tier === 'below');
  const summary = {
    explain: {
      balls: out.explain.length,
      withText: out.explain.filter((e) => e.hasText).length,
      contactAgrees: out.explain.filter((e) => e.contact).length,
      runsAgree: out.explain.filter((e) => e.runs).length,
      timingAgrees: `${out.explain.filter((e) => e.timing === true).length}/${out.explain.filter((e) => e.timing !== null).length}`,
      withMs: out.explain.filter((e) => e.ms).length,
    },
    repeat: { attempts: out.repeat.length - 1, identicalFlights: reps.filter((r) => r.hash === orig?.hash).length, identicalResults: reps.filter((r) => sameResult(r.last, orig?.last)).length, errors: out.repeat.filter((r) => r.error).map((r) => `${r.kind}: ${r.error}`) },
    tiers: tFull && tBelow ? { stages: [tFull.stage, tBelow.stage], identicalFlights: tFull.balls.filter((b, i) => b.hash && b.hash === tBelow.balls[i]?.hash).length, identicalResults: tFull.balls.filter((b, i) => sameResult(b, tBelow.balls[i])).length, of: tFull.balls.length } : null,
  };
  const file = writeJson(args, 'determinism', { summary, ...out });
  log(args, `determinism → ${file}`);
  return summary;
}
