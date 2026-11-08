/**
 * The chase as the crowd feels it (owner: COPY): the pressure a chase puts on the crowd rises with what the target asks
 * and with the balls running out; the scoreboard (target, balls left) reaches the emotion machine through the delivery
 * context; the crowd follows the physics at the instant it is confirmed (the ball that reaches the target, the last ball
 * that cannot, a wicket) and never before; a close finish sounds close; a lost chase never plays a celebration; and an
 * innings without a target behaves exactly as it did. Everything is pure and deterministic. Times are ms.
 */
import { describe, expect, it } from 'vitest';
import { CAPTION_KEYS } from '@/audio';
import { practiceEn } from '@/i18n/practice/en';
import { practiceHi } from '@/i18n/practice/hi';
import { practiceHiLatn } from '@/i18n/practice/hi-Latn';
import {
  CROWD,
  createEmotionMachine,
  deliveryContext,
  initialEmotion,
  matchPressure,
  reduceEmotion,
  type DeliveryContext,
  type EmotionMachine,
  type EmotionMoment,
  type EmotionState,
  type MatchSituation,
} from '@/audio/emotion';

type Step = [number, EmotionMoment];
const R = 2000;
const prelude = (t0 = 0): Step[] => [
  [t0, { kind: 'approach', intensity: 0.4 }],
  [t0 + R - 450, { kind: 'gather', intensity: 0.5 }],
  [t0 + R, { kind: 'release', intensity: 1 }],
  [t0 + R + 380, { kind: 'pitch', intensity: 0.6 }],
];
const carries = (from: number, progress: number[]): Step[] =>
  progress.map((p, i) => [from + i * 150, { kind: 'carry', intensity: p }]);
/** A struck ball up to the moment the outcome is confirmed at 3800 (the rope, or the ball stopped). */
const struck = (): Step[] => [
  ...prelude(),
  [2600, { kind: 'contact', intensity: 1, contact: 'middle', timing: 'perfect' }],
  ...carries(2900, [0.3, 0.45, 0.6, 0.75, 0.9, 1]),
];
const OUTCOME_AT = 3800;
const ending: Step[] = [
  [OUTCOME_AT, { kind: 'dead', intensity: 0 }],
  [5600, { kind: 'reflection', intensity: 0.3 }],
];
const four: Step = [OUTCOME_AT, { kind: 'four', intensity: 1, runs: 4 }];
const six: Step = [OUTCOME_AT, { kind: 'six', intensity: 1, runs: 6 }];
const runs = (r: number): Step => [OUTCOME_AT, { kind: 'runs', intensity: 0.5, runs: r }];

/** The chase context of the ball about to be bowled: `need` runs to win with `left` legal balls left (this one included). */
const chase = (need: number, left: number, pressure = 0.6, before = 10): DeliveryContext => ({
  pressure,
  runs: before,
  wicketEndsInnings: true,
  target: before + need,
  ballsLeft: left,
});
const plain = (pressure = 0.6): DeliveryContext => ({ pressure, runs: 10, wicketEndsInnings: true });

function run(ctx: DeliveryContext, steps: Step[]): { m: EmotionMachine; states: EmotionState[] } {
  const m = createEmotionMachine();
  m.context(ctx, 0);
  const states = steps.map(([t, step]) => ({ ...m.moment(step, t) }));
  return { m, states };
}
/**
 * The machine right after the outcome moment. The dead ball and the reflection are applied only when asked
 * (`withEnding`): a machine sampled at a time before its last moment gives that moment's curve, so a test that samples
 * from the outcome on must not apply anything later than it.
 */
function after(ctx: DeliveryContext, outcome: Step, withEnding = false) {
  const steps: Step[] = [...struck(), outcome, ...(withEnding ? ending : [])];
  const { m, states } = run(ctx, steps);
  const at = steps.findIndex((s) => s[1].kind === outcome[1].kind);
  return { m, states, s: states[at] };
}
function peak(m: EmotionMachine, from: number, to: number): number {
  let best = 0;
  for (let t = from; t <= to; t += 10) best = Math.max(best, m.sample(t).arousal);
  return best;
}

describe('the pressure of a chase', () => {
  const at = (runsNow: number, target: number, left: number, wickets = 1): MatchSituation => ({
    runs: runsNow,
    wicketsInHand: wickets,
    ballsLeft: left,
    target,
    batterRuns: runsNow,
  });

  it('rises as the balls run out, for the same ask per ball', () => {
    // 1.5 a ball all the way down: 18 off 12, 12 off 8, 6 off 4, 3 off 2.
    const series = [at(0, 18, 12), at(0, 12, 8), at(0, 6, 4), at(0, 3, 2)].map(matchPressure);
    for (let i = 1; i < series.length; i++) expect(series[i], `step ${i}`).toBeGreaterThan(series[i - 1]);
  });

  it('is monotone over a swept grid: up with the runs needed, and up as the balls run out, wherever the target can still be reached', () => {
    // (i) For each count of balls left, more runs needed (a higher required rate) never lowers the pressure.
    for (let left = 1; left <= 12; left++)
      for (let need = 1; need < 6 * left; need++)
        expect(
          matchPressure(at(0, need + 1, left)),
          `balls ${left}, need ${need} -> ${need + 1}`,
        ).toBeGreaterThanOrEqual(matchPressure(at(0, need, left)));
    // (ii) For the same runs needed, fewer balls left (a higher required rate again) never lowers it, while it can be won.
    for (let need = 1; need <= 60; need++)
      for (let left = 12; left > Math.max(1, Math.ceil(need / 6)); left--)
        expect(
          matchPressure(at(0, need, left - 1)),
          `need ${need}, balls ${left} -> ${left - 1}`,
        ).toBeGreaterThanOrEqual(matchPressure(at(0, need, left)));
    // (iii) For the same ask per ball, fewer balls left never lowers it.
    for (const perBall of [0.5, 1, 1.5, 2, 3, 4.5, 6])
      for (let left = 12; left > 1; left--) {
        const a = Math.round(perBall * left);
        const b = Math.round(perBall * (left - 1));
        if (a < 1 || b < 1) continue;
        expect(
          matchPressure(at(0, b, left - 1)),
          `${perBall} a ball, balls ${left} -> ${left - 1}`,
        ).toBeGreaterThanOrEqual(matchPressure(at(0, a, left)) - 0.02);
      }
    // (iv) Out of reach is the one place it falls, and it falls below the same chase made reachable.
    for (let left = 1; left <= 12; left++)
      expect(matchPressure(at(0, 6 * left + 1, left))).toBeLessThan(matchPressure(at(0, 6 * left, left)));
  });

  it('is higher for a hard ask than an easy one with the same balls left, and falls once the target is out of reach', () => {
    const easy = matchPressure(at(0, 6, 12)); // half a run a ball
    const steady = matchPressure(at(0, 18, 12)); // 1.5 a ball
    const stretching = matchPressure(at(0, 36, 12)); // 3 a ball
    const demanding = matchPressure(at(0, 72, 12)); // 6 a ball: still possible
    const impossible = matchPressure(at(0, 73, 12)); // more than 6 a ball
    expect(steady).toBeGreaterThan(easy);
    expect(stretching).toBeGreaterThan(steady);
    expect(demanding).toBeGreaterThanOrEqual(stretching);
    expect(impossible).toBeLessThan(easy);
  });

  it('is the final-over pressure alone once the target is reached, and 1 on the last ball with a six to get', () => {
    expect(matchPressure(at(30, 30, 6))).toBeCloseTo(0.25, 6);
    expect(matchPressure({ ...at(0, 6, 1), batterRuns: 47 })).toBe(1);
    expect(matchPressure(at(0, 6, 1))).toBeGreaterThan(0.95);
  });

  it('keeps the sealed-six reference points of the existing tests', () => {
    const close = matchPressure({ runs: 40, wicketsInHand: 3, ballsLeft: 6, target: 48 });
    expect(close).toBeGreaterThan(0.75);
    expect(matchPressure({ runs: 10, wicketsInHand: 3, ballsLeft: 6, target: 60 })).toBeLessThan(close);
    expect(matchPressure({ runs: 60, wicketsInHand: 3, ballsLeft: 6, target: 60 })).toBeCloseTo(0.25, 6);
    expect(matchPressure({ runs: 40, wicketsInHand: 1, ballsLeft: 6, target: 48 })).toBeGreaterThan(close);
  });

  it('never leaves 0..1 over every chase state of a 12-ball chase', () => {
    for (let left = 1; left <= 12; left++)
      for (let need = -2; need <= 80; need++) {
        const p = matchPressure(at(10, 10 + need, left));
        expect(p, `need ${need} left ${left}`).toBeGreaterThanOrEqual(0);
        expect(p, `need ${need} left ${left}`).toBeLessThanOrEqual(1);
      }
  });

  it('is pure: the same situation gives the same number, and nothing is written to it', () => {
    const s = Object.freeze(at(4, 31, 9));
    expect(matchPressure(s)).toBe(matchPressure({ ...s }));
    expect(matchPressure(s)).toBe(matchPressure(s));
  });
});

describe('the delivery context of a chase', () => {
  it('adds the target and the balls left only in a chase; every other innings keeps its four fields', () => {
    expect(deliveryContext({ runs: 47, wicketsInHand: 1, ballsLeft: 30 })).toEqual({
      pressure: 0.12,
      milestone: 'fifty',
      wicketEndsInnings: true,
      runs: 47,
    });
    const c = deliveryContext({ runs: 10, wicketsInHand: 1, ballsLeft: 7, target: 31, batterRuns: 10 });
    expect(c).toMatchObject({ wicketEndsInnings: true, runs: 10, target: 31, ballsLeft: 7 });
    expect(c.pressure).toBeGreaterThan(0.5);
  });

  it('is not a chase without a finite target, or without a ball left', () => {
    for (const s of [
      { runs: 0, wicketsInHand: 1, ballsLeft: 5, target: null },
      { runs: 0, wicketsInHand: 1, ballsLeft: 5, target: Number.NaN },
      { runs: 0, wicketsInHand: 1, ballsLeft: null, target: 20 },
      { runs: 0, wicketsInHand: 1, ballsLeft: 0, target: 20 },
    ] satisfies MatchSituation[]) {
      const c = deliveryContext(s);
      expect(c).not.toHaveProperty('target');
      expect(c).not.toHaveProperty('ballsLeft');
    }
  });
});

describe('the ball that wins the chase', () => {
  it('a six off the last ball is a standing ovation, bigger than a routine six, and sounds like the finish it is', () => {
    const win = after(chase(6, 1), six);
    expect(win.s).toMatchObject({ reaction: 'ovation', caption: 'crowd_ovation', verdict: 'won', outcome: 'six' });
    const routine = after(plain(), six);
    expect(routine.s).toMatchObject({ reaction: 'eruption', caption: 'crowd_erupts', verdict: null });
    expect(win.s.reactionLevel).toBeGreaterThan(routine.s.reactionLevel);
    expect(peak(win.m, OUTCOME_AT, 5000)).toBeGreaterThan(peak(routine.m, OUTCOME_AT, 5000));
    expect(win.m.sample(OUTCOME_AT + 600)).toMatchObject({ phase: 'outcome', mood: 'ovation', outcome: 'six' });
  });

  it('a four that wins in the last over is an ovation too; with plenty of balls to spare it is a cheer, a smaller one', () => {
    const close = after(chase(4, 3), four);
    const easy = after(chase(4, 10), four);
    expect(close.s).toMatchObject({ reaction: 'ovation', verdict: 'won', caption: 'crowd_ovation' });
    expect(easy.s).toMatchObject({ reaction: 'cheer', verdict: 'won', caption: 'crowd_cheers' });
    expect(close.s.reactionLevel).toBeGreaterThan(easy.s.reactionLevel);
    // Even the comfortable win is not below the routine four.
    expect(easy.s.reactionLevel).toBeGreaterThanOrEqual(after(plain(), four).s.reactionLevel);
  });

  it('the finish gets louder the closer it is, ball by ball', () => {
    const levels = [12, 9, 6, 3, 1].map((left) => after(chase(4, left), four).s.reactionLevel);
    for (let i = 1; i < levels.length; i++)
      expect(levels[i], `balls left ${12 - i}`).toBeGreaterThanOrEqual(levels[i - 1]);
    expect(levels[4]).toBeGreaterThan(levels[0]);
  });

  it('runs that reach the target are an ovation in the last over, a cheer before it; never above one', () => {
    const last = after(chase(2, 1), runs(2));
    const early = after(chase(2, 9), runs(2));
    expect(last.s).toMatchObject({ reaction: 'ovation', verdict: 'won', caption: 'crowd_ovation' });
    expect(early.s).toMatchObject({ reaction: 'cheer', verdict: 'won', caption: 'crowd_cheers' });
    expect(last.s.reactionLevel).toBeGreaterThan(early.s.reactionLevel);
    for (const s of [last.s, early.s]) expect(s.reactionLevel).toBeLessThanOrEqual(1);
    // Winning singles are louder than the ordinary acknowledgement of a single.
    expect(early.s.reactionLevel).toBeGreaterThan(after(plain(), runs(1)).s.reactionLevel);
  });

  it('keeps six > four > runs among the balls that win it, at every closeness (EMO1)', () => {
    for (let left = 1; left <= 12; left++) {
      const c = (need: number) => chase(need, left, 0.6);
      const winSix = after(c(6), six).s.reactionLevel;
      const winFour = after(c(4), four).s.reactionLevel;
      const winRun = after(c(2), runs(2)).s.reactionLevel;
      expect(winSix, `balls left ${left}`).toBeGreaterThanOrEqual(winFour);
      expect(winFour, `balls left ${left}`).toBeGreaterThan(winRun);
      expect(winRun, `balls left ${left}`).toBeGreaterThan(0.6);
    }
  });

  it('reaching the target exactly wins; one run short with balls left is just a ball', () => {
    expect(after(chase(4, 5), four).s.verdict).toBe('won');
    const short = after(chase(5, 5), four);
    expect(short.s.verdict).toBeNull();
    expect(short.s).toMatchObject({ reaction: 'cheer', caption: 'crowd_cheers' });
  });
});

describe('the last ball that cannot win it, and the wicket', () => {
  it('a boundary on the last ball that falls short gets polite applause, then a quiet crowd: no celebration', () => {
    for (const [step, name] of [
      [six, 'six'],
      [four, 'four'],
    ] as const) {
      const lost = after(chase(10, 1), step, true);
      expect(lost.s, name).toMatchObject({
        reaction: 'applause',
        caption: 'crowd_applauds',
        verdict: 'lost',
        subdued: true,
      });
      expect(lost.s.reactionLevel, name).toBeLessThanOrEqual(0.6);
      expect(lost.s.reactionLevel, name).toBeLessThan(after(plain(), step).s.reactionLevel);
      // A moment later the mood is dismay, and the reflection keeps it.
      expect(lost.m.sample(OUTCOME_AT + 2000).mood, name).toBe('dismay');
      expect(lost.m.sample(5600 + 100).mood, name).toBe('dismay');
    }
  });

  it('keeps the order six > four > a run > a dot on that last ball, in the lost chase too (EMO1)', () => {
    const attempt = (c: DeliveryContext) =>
      run(c, [...struck().slice(0, 5), [3400, { kind: 'dot', intensity: 0.3, runs: 0 }]]).states[5].reactionLevel;
    for (const pressure of [0.2, 0.6, 1]) {
      const c = chase(10, 1, pressure);
      const lostSix = after(c, six).s.reactionLevel;
      const lostFour = after(c, four).s.reactionLevel;
      const lostRun = after(c, runs(1)).s.reactionLevel;
      const lostDot = attempt(c);
      expect(lostSix, `pressure ${pressure}`).toBeGreaterThan(lostFour);
      expect(lostFour, `pressure ${pressure}`).toBeGreaterThan(lostRun);
      expect(lostRun, `pressure ${pressure}`).toBeGreaterThan(lostDot);
      expect(lostDot, `pressure ${pressure}`).toBeGreaterThan(0);
    }
  });

  it('a dot on the last ball ends the chase quietly: a groan only for a real attempt, a leave settles', () => {
    const attempt = run(chase(3, 1), [
      ...struck().slice(0, 5),
      [3400, { kind: 'dot', intensity: 0.3, runs: 0 }],
      [3400, { kind: 'dead', intensity: 0 }],
    ]);
    const dot = attempt.states[5];
    expect(dot).toMatchObject({ verdict: 'lost', subdued: true, reaction: 'groan', caption: 'crowd_groans' });
    expect(attempt.m.sample(3400 + 300).mood).toBe('dismay');
    const leave = run(chase(3, 1), [...prelude(), [3000, { kind: 'dot', intensity: 0, runs: 0 }]]);
    expect(leave.states[4]).toMatchObject({ verdict: 'lost', subdued: true, reaction: null });
    expect(leave.m.sample(3300).mood).toBe('dismay');
  });

  it('runs that fall short on the last ball are acknowledged, much quieter than the same runs elsewhere', () => {
    const lost = after(chase(5, 1), runs(2));
    expect(lost.s).toMatchObject({ reaction: 'applause', verdict: 'lost', subdued: true });
    expect(lost.s.reactionLevel).toBeLessThan(after(plain(), runs(2)).s.reactionLevel);
  });

  it('a wicket ends the chase as it ends an innings: decisive silence within 150 ms, then dismay, never a cheer', () => {
    const steps: Step[] = [...prelude(), [3000, { kind: 'wicket', intensity: 1, dismissal: 'bowled' }]];
    const a = run(chase(20, 7), steps);
    const b = run(plain(), steps);
    expect(a.states[4]).toMatchObject({ verdict: 'lost', subdued: true, reaction: 'dismay', caption: 'crowd_stunned' });
    expect(b.states[4].verdict).toBeNull();
    expect(a.m.sample(3150).arousal).toBeLessThan(0.1);
    expect(a.m.sample(3150).mood).toBe('silence');
    expect(a.m.sample(4100).mood).toBe('dismay');
    // The crowd's own curve is the one a plain wicket gives: the chase adds nothing to it.
    for (let t = 3000; t <= 9000; t += 250) expect(a.m.sample(t)).toEqual(b.m.sample(t));
    // No reaction that celebrates, in any state of the ball.
    for (const s of a.states) expect(['eruption', 'ovation', 'cheer', 'lift']).not.toContain(s.reaction ?? '');
  });

  it('after a lost chase nothing celebrates until a new delivery begins', () => {
    const lost = after(chase(10, 1), six, true);
    for (let t = 6000; t <= 20_000; t += 500)
      expect(['celebration', 'eruption', 'ovation']).not.toContain(lost.m.sample(t).mood);
    expect(lost.m.state().subdued).toBe(true);
    // A new chase (a new context) and its approach lift the subdued state.
    lost.m.context(chase(30, 12), 30_000);
    lost.m.moment({ kind: 'approach', intensity: 0.4 }, 30_000);
    expect(lost.m.state().subdued).toBe(false);
    expect(lost.m.state().verdict).toBeNull();
  });
});

describe('every ball of a chase, every event', () => {
  const EVENTS: Array<[string, Step[]]> = [
    ['leave', [...prelude(), [3000, { kind: 'dot', intensity: 0, runs: 0 }]]],
    ['dot after a shot', [...struck().slice(0, 5), [3400, { kind: 'dot', intensity: 0.3, runs: 0 }]]],
    ['one run', [...struck(), runs(1)]],
    ['two runs', [...struck(), runs(2)]],
    ['four', [...struck(), four]],
    ['six', [...struck(), six]],
    ['wicket', [...prelude(), [3000, { kind: 'wicket', intensity: 1, dismissal: 'bowled' }]]],
  ];
  const NEEDS = [1, 2, 4, 6, 9, 20, 40];

  it('never celebrates a lost chase, always celebrates a won one, and stays inside 0..1: 12 balls x 7 events x 7 targets', () => {
    let balls = 0;
    const captions = new Set<string>();
    const celebratory = ['eruption', 'ovation', 'cheer'];
    for (let left = 1; left <= 12; left++)
      for (const need of NEEDS)
        for (const [name, steps] of EVENTS) {
          const { m, states } = run(chase(need, left, 0.5), steps);
          balls++;
          const last = states[states.length - 1];
          const label = `${name}, need ${need}, balls left ${left}`;
          for (const st of states) {
            if (st.caption) captions.add(st.caption);
            expect(st.reactionLevel, label).toBeLessThanOrEqual(1);
            expect(st.reactionLevel, label).toBeGreaterThanOrEqual(0);
          }
          // The runs of the event decide the verdict, the same way for the crowd and for the scoreboard.
          const scored =
            name === 'one run' ? 1 : name === 'two runs' ? 2 : name === 'four' ? 4 : name === 'six' ? 6 : 0;
          const expected = name === 'wicket' ? 'lost' : scored >= need ? 'won' : left === 1 ? 'lost' : null;
          expect(last.verdict, label).toBe(expected);
          if (expected === 'lost') {
            expect(celebratory, label).not.toContain(last.reaction ?? '');
            expect(last.subdued, label).toBe(true);
            for (let t = 6000; t <= 12_000; t += 1000)
              expect(['celebration', 'eruption', 'ovation'], label).not.toContain(m.sample(t).mood);
          }
          if (expected === 'won') expect(celebratory, label).toContain(last.reaction ?? '');
        }
    expect(balls).toBe(12 * NEEDS.length * EVENTS.length);
    // Every sound has a caption, and every caption the chase asks for is an existing closed key worded in all three languages.
    expect([...captions].sort()).toEqual(
      expect.arrayContaining(['crowd_applauds', 'crowd_cheers', 'crowd_groans', 'crowd_ovation', 'crowd_stunned']),
    );
    for (const key of captions) {
      expect(CAPTION_KEYS as readonly string[], key).toContain(key);
      for (const catalog of [practiceEn, practiceHi, practiceHiLatn] as Array<Record<string, string>>)
        expect(`practice.caption.${key}` in catalog, key).toBe(true);
    }
  });
});

describe('no look-ahead, determinism, and the innings that is not a chase', () => {
  it('the crowd cannot know the result early: the scoreboard changes nothing before the physics confirms the ball', () => {
    // Everything the crowd does up to the outcome, for a ball that will win, one that will not, and no chase at all.
    const before = (ctx: DeliveryContext) => {
      const m = createEmotionMachine();
      m.context(ctx, 0);
      const steps = struck();
      const out: Array<ReturnType<EmotionMachine['sample']>> = [];
      let i = 0;
      for (let t = 0; t < OUTCOME_AT; t += 10) {
        while (i < steps.length && steps[i][0] <= t) {
          m.moment(steps[i][1], steps[i][0]);
          i++;
        }
        out.push({ ...m.sample(t) });
      }
      return { out, outcome: m.state().outcome, verdict: m.state().verdict };
    };
    const winnable = before(chase(6, 1, 0.9));
    const hopeless = before(chase(20, 1, 0.9));
    const notAChase = before(plain(0.9));
    expect(winnable.out).toEqual(hopeless.out);
    expect(winnable.out).toEqual(notAChase.out);
    for (const e of [winnable, hopeless, notAChase]) {
      expect(e.outcome).toBeNull();
      expect(e.verdict).toBeNull();
      // Until it is confirmed, the crowd stays under the level of every four (no look-ahead).
      expect(Math.max(...e.out.filter((_, i) => i * 10 >= 2600).map((x) => x.arousal))).toBeLessThanOrEqual(
        CROWD.expectMax + 1e-9,
      );
    }
    // The physics then decides, and only then do they part.
    expect(after(chase(6, 1, 0.9), six).s.verdict).toBe('won');
    expect(after(chase(20, 1, 0.9), six).s.verdict).toBe('lost');
  });

  it('the context alone moves nothing but the murmur: no reaction, no verdict, no outcome', () => {
    const m = createEmotionMachine();
    m.context(chase(6, 1, 1), 0);
    expect(m.state()).toMatchObject({ verdict: null, outcome: null, reaction: null, target: 16, ballsLeft: 1 });
  });

  it('is deterministic and pure: the same inputs give the same states, and an input state is never changed', () => {
    const run1 = after(chase(4, 2), four).states;
    const run2 = after(chase(4, 2), four).states;
    expect(run1).toEqual(run2);
    const s0 = Object.freeze(initialEmotion());
    const withCtx = reduceEmotion(s0, { type: 'context', context: chase(4, 2), at: 0 });
    expect(withCtx.target).toBe(14);
    expect(s0.target).toBeNull();
  });

  it('an innings without a target is exactly what it was: the same states with and without the chase fields at rest', () => {
    const steps: Step[] = [...struck(), four, ...ending];
    const a = run(plain(), steps);
    const b = run({ ...plain(), target: null, ballsLeft: null }, steps);
    expect(a.states).toEqual(b.states);
    // A scoreboard that does not reach the target and is not the last ball changes nothing either.
    const c = run(chase(30, 6), steps);
    expect(c.states.map((s) => ({ ...s, target: null, ballsLeft: null }))).toEqual(a.states);
  });

  it("a target without the striker's runs is not a chase, and the scoreboard of one ball is not kept for the next", () => {
    const m = createEmotionMachine();
    m.context({ pressure: 0.5, target: 20, ballsLeft: 1 }, 0);
    expect(m.state()).toMatchObject({ target: null, ballsLeft: null });
    m.context(chase(4, 1), 100);
    expect(m.state()).toMatchObject({ target: 14, ballsLeft: 1 });
    m.context(plain(), 200);
    expect(m.state()).toMatchObject({ target: null, ballsLeft: null, verdict: null });
  });

  it('a practice replay of the deciding ball has no scoreboard, so it can never sound like a chase result', () => {
    const replay = after(plain(), six).s;
    expect(replay).toMatchObject({ reaction: 'eruption', verdict: null });
  });
});
