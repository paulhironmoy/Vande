/**
 * The crowd's emotion machine (src/audio/emotion): the rhythm of a delivery, natural decay, habituation (maximum crowd
 * noise does not follow every event), pressure, shock and silence, relief, frustration, milestones, determinism and the
 * zero-allocation sample. Times are ms on one monotonic clock.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { StageMoment } from '@/render3d/practice/types';
import {
  CROWD,
  createEmotionMachine,
  initialEmotion,
  reduceEmotion,
  restLevel,
  sampleEmotion,
  type DeliveryContext,
  type EmotionMachine,
  type EmotionMoment,
} from '@/audio/emotion';

type Step = [number, EmotionMoment];
const R = 2000;
/** The run-up, the stride (450 ms before release), the release and the pitch. */
const prelude = (t0 = 0): Step[] => [
  [t0, { kind: 'approach', intensity: 0.4 }],
  [t0 + R - 450, { kind: 'gather', intensity: 0.5 }],
  [t0 + R, { kind: 'release', intensity: 1 }],
  [t0 + R + 380, { kind: 'pitch', intensity: 0.6 }],
];
const carries = (from: number, progress: number[]): Step[] =>
  progress.map((p, i) => [from + i * 150, { kind: 'carry', intensity: p }]);
const sixBall = (t0 = 0): Step[] => [
  ...prelude(t0),
  [t0 + 2600, { kind: 'contact', intensity: 1, contact: 'middle', timing: 'perfect' }],
  ...carries(t0 + 2900, [0.3, 0.45, 0.6, 0.75, 0.9, 1]),
  [t0 + 3800, { kind: 'six', intensity: 1, runs: 6 }],
  [t0 + 3800, { kind: 'dead', intensity: 0 }],
  [t0 + 5600, { kind: 'reflection', intensity: 0.3 }],
];

function machine(ctx: DeliveryContext = { pressure: 0, runs: 10 }, at = 0): EmotionMachine {
  const m = createEmotionMachine();
  m.context(ctx, at);
  return m;
}
const play = (m: EmotionMachine, steps: Step[]) => steps.map(([t, s]) => ({ ...m.moment(s, t) }));
/** The highest arousal over [from, to] (10 ms steps), for a machine whose moments are all before `from`. */
function peak(m: EmotionMachine, from: number, to: number): number {
  let best = 0;
  for (let t = from; t <= to; t += 10) best = Math.max(best, m.sample(t).arousal);
  return best;
}
/** The highest arousal over [from, to], the moments applied in time order as the stage delivers them. */
function peakOf(steps: Step[], from: number, to: number, ctx: DeliveryContext = { pressure: 0, runs: 10 }): number {
  const { out } = trace(steps, to, ctx);
  return Math.max(...out.filter((s) => s.t >= from && s.t <= to).map((s) => s.arousal));
}
/** Runs steps and samples together (moments applied in time order, sampled every 10 ms). */
function trace(steps: Step[], until: number, ctx?: DeliveryContext) {
  const m = machine(ctx);
  const out: Array<{ t: number; arousal: number; mood: string; phase: string }> = [];
  let i = 0;
  for (let t = 0; t <= until; t += 10) {
    while (i < steps.length && steps[i][0] <= t) m.moment(steps[i][1], steps[i++][0]);
    const e = m.sample(t);
    out.push({ t, arousal: e.arousal, mood: e.mood, phase: e.phase });
  }
  return { m, out, at: (t: number) => out[Math.round(t / 10)] };
}

describe('the rhythm of a delivery', () => {
  it('anticipation, concentration, the breath, the contact response, rising expectation, full release, reflection', () => {
    const { at, out } = trace(sixBall(), 16000);
    expect(at(0)).toMatchObject({ phase: 'approach', mood: 'anticipation' });
    // The murmur swells as the bowler runs in, then hushes in the stride and holds its breath in flight.
    expect(at(1500).arousal).toBeGreaterThan(at(100).arousal);
    expect(at(1500).arousal).toBeGreaterThan(0.38);
    expect(at(1900)).toMatchObject({ phase: 'stride', mood: 'concentration' });
    expect(at(1900).arousal).toBeLessThan(0.16);
    expect(at(2400)).toMatchObject({ phase: 'flight', mood: 'breath' });
    expect(at(2400).arousal).toBeLessThan(0.08);
    // The clean contact: a breath out, no roar yet.
    expect(at(2700)).toMatchObject({ phase: 'contact', mood: 'response' });
    expect(at(2850).arousal).toBeLessThan(0.25);
    // The hit carries: the crowd lifts and its expectation rises with the ball's progress towards the rope.
    expect(at(3000)).toMatchObject({ phase: 'chase', mood: 'expectation' });
    expect(at(3700).arousal).toBeGreaterThan(0.45);
    // Six: full release, then the reflection and the murmur.
    const six = out.filter((s) => s.t >= 3800 && s.t <= 5000);
    expect(Math.max(...six.map((s) => s.arousal))).toBeCloseTo(CROWD.six, 2);
    expect(at(4200)).toMatchObject({ phase: 'outcome', mood: 'eruption' });
    expect(at(6000)).toMatchObject({ phase: 'reflection', mood: 'reflection' });
    expect(at(10000)).toMatchObject({ phase: 'between', mood: 'murmur' });
    expect(at(16000).arousal).toBeLessThan(0.36);
  });

  it('is continuous: applying a moment never makes the level jump', () => {
    const m = machine();
    for (const [t, step] of sixBall()) {
      const before = m.sample(t).arousal;
      m.moment(step, t);
      expect(Math.abs(m.sample(t).arousal - before)).toBeLessThan(1e-9);
    }
  });

  it('a block that goes nowhere gets no reaction; a dot is mild pressure, a leave restrained', () => {
    const m = machine();
    const states = play(m, [
      ...prelude(),
      [2600, { kind: 'contact', intensity: 0.8, contact: 'middle', timing: 'solid' }],
      [3400, { kind: 'dot', intensity: 0.3, runs: 0 }],
      [3400, { kind: 'dead', intensity: 0 }],
    ]);
    expect(states.every((s) => s.reaction === null)).toBe(true);
    expect(m.sample(4800)).toMatchObject({ outcome: 'dot', mood: 'restless' });
    expect(m.sample(4800).arousal).toBeCloseTo(restLevel(m.state()) + 0.02, 1);
    const l = machine();
    play(l, [...prelude(), [3400, { kind: 'dot', intensity: 0.3, runs: 0 }]]);
    expect(l.sample(6000)).toMatchObject({ outcome: 'leave', mood: 'murmur' });
    expect(l.sample(6000).arousal).toBeLessThan(m.sample(6000).arousal);
  });
});

describe('natural decay and habituation', () => {
  it('decays to the resting murmur on its own, with no further input', () => {
    const m = machine();
    play(m, sixBall().slice(0, -1)); // no reflection moment
    const rest = restLevel(m.state());
    expect(m.sample(4300).arousal).toBeGreaterThan(0.85);
    expect(Math.abs(m.sample(20000).arousal - rest)).toBeLessThan(0.02);
  });

  it('does not play maximum noise after every event: dot < single < four < six, and repeats come out lower', () => {
    const single = peakOf(
      [
        ...prelude(),
        [2600, { kind: 'contact', intensity: 0.8, contact: 'middle', timing: 'solid' }],
        [3800, { kind: 'runs', intensity: 0.55, runs: 1 }],
      ],
      3800,
      6000,
    );
    const four = peakOf(
      [
        ...prelude(),
        [2600, { kind: 'contact', intensity: 0.8, contact: 'middle', timing: 'solid' }],
        [3800, { kind: 'four', intensity: 0.82, runs: 4 }],
      ],
      3800,
      6000,
    );
    const six = peakOf(sixBall(), 3800, 6000);
    expect(single).toBeLessThan(0.55);
    expect(four).toBeCloseTo(CROWD.four, 2);
    expect(single).toBeLessThan(four);
    expect(four).toBeLessThan(six);
    expect(six).toBeLessThan(1);
    // Three sixes in a row: each peak lower than the last; a long break restores the crowd's voice.
    const starts = [0, 12000, 24000, 400000];
    const { out } = trace(
      starts.flatMap((t0) => sixBall(t0)),
      406000,
    );
    const peaks = starts.map((t0) =>
      Math.max(...out.filter((s) => s.t >= t0 + 3800 && s.t <= t0 + 6000).map((s) => s.arousal)),
    );
    expect(peaks[1]).toBeLessThan(peaks[0] - 0.015);
    expect(peaks[2]).toBeLessThan(peaks[1]);
    expect(peaks[3]).toBeCloseTo(peaks[0], 2);
  });
});

describe('release gates (COH9, FBK3)', () => {
  /** The ball the stage plays, with its dead ball and the reflection 1.8 s after. */
  const boundary = (runs: 4 | 6, t0 = 0): Step[] => [
    ...prelude(t0),
    [t0 + 2600, { kind: 'contact', intensity: 0.8, contact: 'middle', timing: 'solid' }],
    ...carries(t0 + 2900, [0.3, 0.5, 0.7, 0.9]),
    [t0 + 3800, { kind: runs === 6 ? 'six' : 'four', intensity: 1, runs }],
    [t0 + 3800, { kind: 'dead', intensity: 0 }],
    [t0 + 5600, { kind: 'reflection', intensity: 0.3 }],
  ];
  /** Half-life of the celebration: from its peak to halfway back to the resting murmur (ms). */
  function halfLife(steps: Step[], from: number) {
    const { out, m } = trace(steps, 40000);
    const after = out.filter((s) => s.t >= from);
    const top = after.reduce((a, b) => (b.arousal > a.arousal ? b : a));
    const rest = restLevel(m.state());
    const half = after.find((s) => s.t > top.t && s.arousal <= rest + (top.arousal - rest) / 2)!;
    return { peak: top.arousal, ms: half.t - top.t };
  }

  it('peaks: six ≥ four > single > dot; no routine Practice boundary reaches the maximum', () => {
    const contact: Step = [2600, { kind: 'contact', intensity: 0.8, contact: 'middle', timing: 'solid' }];
    const six = peakOf(boundary(6), 3800, 9000);
    const four = peakOf(boundary(4), 3800, 9000);
    const single = peakOf([...prelude(), contact, [3800, { kind: 'runs', intensity: 0.55, runs: 1 }]], 3800, 9000);
    const dot = peakOf([...prelude(), contact, [3800, { kind: 'dot', intensity: 0.3, runs: 0 }]], 3800, 9000);
    const leave = peakOf([...prelude(), [3800, { kind: 'dot', intensity: 0.3, runs: 0 }]], 3800, 9000);
    expect(six).toBeGreaterThan(four);
    expect(four).toBeGreaterThan(single);
    expect(single).toBeGreaterThan(dot);
    expect(dot).toBeGreaterThanOrEqual(leave);
    expect(six).toBeLessThan(0.95);
    // Even the last ball of the final over (pressure 0.35) stays short of the maximum.
    expect(peakOf(boundary(6), 3800, 9000, { pressure: 0.35, runs: 10 })).toBeLessThan(1);
  });

  it('the bands never overlap, whatever the fatigue and the pressure', () => {
    const balls = [0, 6000, 12000, 18000, 24000];
    const tiredSix = peakOf(
      balls.flatMap((t0) => boundary(6, t0)),
      27800,
      30000,
    );
    const freshFour = peakOf(boundary(4), 3800, 9000, { pressure: 1, runs: 10 });
    expect(tiredSix).toBeGreaterThan(freshFour);
    const tiredFour = peakOf(
      balls.flatMap((t0) => boundary(4, t0)),
      27800,
      30000,
    );
    const freshRuns = peakOf([...prelude(), [3800, { kind: 'runs', intensity: 0.9, runs: 3 }]], 3800, 9000, {
      pressure: 1,
      runs: 10,
    });
    expect(tiredFour).toBeGreaterThan(freshRuns);
  });

  it('no look-ahead: while the ball races to the rope the crowd stays at or under 0.6, below every four', () => {
    for (const pressure of [0, 0.35, 1]) {
      const { out } = trace(sixBall(), 3790, { pressure, runs: 10 });
      expect(Math.max(...out.filter((s) => s.t >= 2600).map((s) => s.arousal))).toBeLessThanOrEqual(
        CROWD.expectMax + 1e-9,
      );
    }
  });

  it('a celebration decays with a half-life of 2–8 s', () => {
    for (const runs of [4, 6] as const) {
      const h = halfLife(boundary(runs), 3800);
      expect(h.ms).toBeGreaterThanOrEqual(2000);
      expect(h.ms).toBeLessThanOrEqual(8000);
    }
  });

  it('no reaction before the physical event, even when the stage delivers the moment ahead of time', () => {
    const m = machine();
    play(m, prelude());
    const before = { ...m.sample(3790) };
    // The six is delivered 40 ms early, at 3790, for its moment at 3830.
    const s = m.moment({ kind: 'six', intensity: 1, runs: 6 }, 3830);
    expect(s.reaction).toBe('eruption');
    for (const t of [3790, 3810, 3829]) {
      const e = m.sample(t);
      expect(e.outcome).toBeNull();
      expect(e.mood).toBe(before.mood);
      expect(e.arousal).toBeCloseTo(before.arousal, 2);
    }
    expect(m.sample(3830)).toMatchObject({ outcome: 'six', mood: 'eruption' });
    expect(m.sample(4300).arousal).toBeGreaterThan(0.8);
  });
});

describe('context and pressure', () => {
  it('pressure deepens the hush and raises the swings; only then does a six reach full voice', () => {
    const calm = trace(sixBall(), 6000, { pressure: 0 });
    const tense = trace(sixBall(), 6000, { pressure: 1 });
    expect(tense.at(1900).arousal).toBeLessThan(calm.at(1900).arousal);
    expect(tense.at(2400).arousal).toBeLessThan(calm.at(2400).arousal);
    expect(Math.max(...tense.out.map((s) => s.arousal))).toBe(1);
    expect(Math.max(...calm.out.map((s) => s.arousal))).toBeLessThan(0.95);
  });

  it('without a context the approach intensity still carries the pressure (0.4 + 0.4 × pressure)', () => {
    const m = createEmotionMachine();
    m.moment({ kind: 'approach', intensity: 0.4 + 0.4 * 0.5 }, 0);
    expect(m.sample(10).pressure).toBeCloseTo(0.5, 6);
  });

  it('a milestone brings an ovation (48 + a four, 99 + two runs)', () => {
    const m = machine({ runs: 48 });
    const s = m.moment({ kind: 'four', intensity: 1, runs: 4 }, 1000);
    expect([s.reaction, s.caption]).toEqual(['ovation', 'milestone_fifty']);
    expect(m.sample(1500).mood).toBe('ovation');
    m.context({ runs: 99 }, 20000);
    expect(m.moment({ kind: 'runs', intensity: 0.7, runs: 2 }, 21000).caption).toBe('milestone_hundred');
    m.context({ runs: 10 }, 40000);
    expect(m.moment({ kind: 'four', intensity: 1, runs: 4 }, 41000).caption).toBe('crowd_cheers');
  });
});

describe('wickets, close calls and missed opportunities', () => {
  it('a damaging wicket: decisive silence within 150 ms, no spike, then the shift; subdued after', () => {
    const steps: Step[] = [
      ...prelude(),
      [2620, { kind: 'wicket', intensity: 1, dismissal: 'bowled' }],
      [2700, { kind: 'dead', intensity: 0 }],
      [4500, { kind: 'reflection', intensity: 0.3 }],
    ];
    const { at, out, m } = trace(steps, 12000);
    const before = at(2620).arousal;
    expect(Math.max(...out.filter((s) => s.t >= 2620 && s.t <= 2770).map((s) => s.arousal))).toBeLessThanOrEqual(
      before + 1e-9,
    );
    expect(at(2770).arousal).toBeLessThan(before * 0.5);
    expect(at(2700).mood).toBe('silence');
    // The shift: 900 ms after the wicket the crowd's murmur of dismay rises out of the silence.
    expect(at(3600).mood).toBe('dismay');
    expect(Math.max(...out.filter((s) => s.t > 3520 && s.t < 4400).map((s) => s.arousal))).toBeGreaterThan(
      at(3500).arousal + 0.05,
    );
    expect(at(12000)).toMatchObject({ mood: 'dismay', phase: 'between' });
    expect(at(12000).arousal).toBeLessThanOrEqual(CROWD.subdued + 0.005);
    expect(m.sample(12000).valence).toBeLessThan(0);
    // Play going on (a new innings) lifts the silence.
    m.moment({ kind: 'approach', intensity: 0.4 }, 30000);
    expect(m.state().subdued).toBe(false);
    expect(m.sample(31000).arousal).toBeGreaterThan(0.3);
  });

  it('a catch in the deep: the rising expectation collapses into silence within 150 ms', () => {
    const steps: Step[] = [
      ...prelude(),
      [2600, { kind: 'contact', intensity: 1, contact: 'middle', timing: 'perfect' }],
      ...carries(2900, [0.3, 0.5, 0.7, 0.9]),
      [3700, { kind: 'wicket', intensity: 1, dismissal: 'caught' }],
    ];
    const { at } = trace(steps, 6000);
    expect(at(3700).arousal).toBeGreaterThan(0.45);
    expect(at(3850).arousal).toBeLessThan(0.15);
  });

  it('a close call is a gasp by how close it was, then relief', () => {
    const near = machine();
    const far = machine();
    play(near, prelude());
    play(far, prelude());
    const a = near.moment({ kind: 'beaten', intensity: 0.9, contact: 'miss' }, 2600);
    expect([a.reaction, a.caption]).toEqual(['ooh', 'crowd_gasps']);
    far.moment({ kind: 'beaten', intensity: 0.45, contact: 'miss' }, 2600);
    expect(peak(near, 2600, 3200)).toBeGreaterThan(peak(far, 2600, 3200) + 0.1);
    const r = near.moment({ kind: 'survived', intensity: 0.6 }, 3300);
    expect([r.reaction, r.caption]).toEqual(['relief', 'crowd_relieved']);
    expect(near.sample(3500)).toMatchObject({ mood: 'relief', outcome: 'close_call' });
  });

  it('a ball racing to the rope and stopped is a groan (frustration)', () => {
    const m = machine();
    play(m, [
      ...prelude(),
      [2600, { kind: 'contact', intensity: 0.8, contact: 'middle', timing: 'solid' }],
      ...carries(2900, [0.3, 0.5, 0.7]),
    ]);
    const s = m.moment({ kind: 'fielded', intensity: 0.5 }, 3400);
    expect([s.reaction, s.caption]).toEqual(['groan', 'crowd_groans']);
    expect(m.sample(3600).mood).toBe('frustration');
  });

  it('captions the crowd once per beat: rises (once), erupts, stunned', () => {
    const states = play(machine(), sixBall());
    expect(states.filter((s) => s.caption === 'crowd_rises')).toHaveLength(1);
    expect(states.map((s) => s.caption).filter(Boolean)).toEqual(['crowd_rises', 'crowd_erupts']);
  });
});

describe('purity, determinism and allocation', () => {
  it('the same moments give the same emotion, bit for bit', () => {
    const a = trace(sixBall(), 9000).out;
    const b = trace(sixBall(), 9000).out;
    expect(a).toEqual(b);
  });

  it('reduceEmotion is pure without `out` and equals the in-place machine', () => {
    const s0 = initialEmotion();
    const frozen = JSON.stringify(s0);
    const s1 = reduceEmotion(s0, { type: 'moment', moment: { kind: 'approach', intensity: 0.4 }, at: 100 });
    expect(JSON.stringify(s0)).toBe(frozen);
    expect(s1).not.toBe(s0);
    const m = createEmotionMachine();
    m.moment({ kind: 'approach', intensity: 0.4 }, 100);
    expect(sampleEmotion(s1, 900)).toEqual({ ...m.sample(900) });
  });

  it('sample() writes one object in place; time never runs backwards', () => {
    const m = machine();
    expect(m.sample(10)).toBe(m.sample(20));
    play(m, prelude());
    m.moment({ kind: 'contact', intensity: 1, contact: 'middle', timing: 'perfect' }, 1000); // late arrival
    expect(m.state().t0).toBe(R + 380);
  });

  it('accepts the stage moments as they are (StageMoment is an EmotionMoment)', () => {
    expectTypeOf<StageMoment>().toMatchTypeOf<EmotionMoment>();
  });

  it('is import-safe for render3d: no runtime import beyond its own pure modules', () => {
    const sources = import.meta.glob(
      ['/src/audio/emotion.ts', '/src/audio/emotionCore.ts', '/src/audio/emotionMachine.ts', '/src/audio/situation.ts'],
      { query: '?raw', import: 'default', eager: true },
    ) as Record<string, string>;
    expect(Object.keys(sources)).toHaveLength(4);
    for (const src of Object.values(sources)) {
      const runtime = [...src.matchAll(/^(?:import|export)\s+(?!type\b)[^;]*?from\s+'([^']+)'/gm)].map((x) => x[1]);
      for (const spec of runtime) expect(['./emotionCore', './emotionMachine', './situation']).toContain(spec);
    }
  });
});
