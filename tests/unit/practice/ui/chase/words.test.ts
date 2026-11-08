/**
 * The words of a chase result, in English, Hindi and Hinglish: every line is made, none is a raw key or an open
 * placeholder, none is longer than COPY's caps, a cause is named only where the balls show one, and the same chase
 * reads the same way every time.
 */
import { describe, expect, it } from 'vitest';
import type { CoachingReason, DeliveryResult } from '@/contracts';
import {
  chaseReducer,
  chaseSummary,
  makeChase,
  startChase,
  type BallRuns,
  type ChaseDefinition,
  type ChaseState,
} from '@/practice/chase';
import { createPracticeT, loadPracticeCatalog, type PracticeT } from '@/i18n/practice';
import { ballFacts, type ChaseBallFacts } from '@/practice/ui/chase/attribution';
import { chaseResultLines } from '@/practice/ui/chase/words';

const def = makeChase('c021') as ChaseDefinition;

/** The chase after these balls (a wicket is the string 'W'). */
function play(balls: Array<BallRuns | 'W'>): ChaseState {
  let s = startChase(def);
  balls.forEach((b, i) => {
    s = chaseReducer(s, {
      type: 'ball',
      overIndex: Math.floor(i / 6),
      ballIndex: i % 6,
      runs: b === 'W' ? 0 : b,
      dismissal: b === 'W' ? 'bowled' : null,
    });
  });
  return s;
}

const fact = (over: Partial<ChaseBallFacts> = {}): ChaseBallFacts => ({
  runs: 0,
  boundary: null,
  dismissal: null,
  reason: 'solid_defence',
  timing: 'on_time',
  timingErrorMs: 0,
  swung: true,
  ...over,
});

const deciding = (reason: CoachingReason, timing: 'early' | 'late' | 'on_time' | null, ms: number | null) =>
  ({
    coaching: { reason, timing, zone: null, fielderRole: null, lbw: null },
    outcome: {
      runs: 0,
      boundary: null,
      dismissal: 'bowled',
      fielderId: null,
      endBearingDeg: null,
      endDistanceM: null,
      region: null,
    },
    contact: { timingErrorMs: ms, timing: timing === 'on_time' ? 'perfect' : 'mistimed' },
  }) as unknown as Pick<DeliveryResult, 'coaching' | 'outcome' | 'contact'>;

async function translators(): Promise<Array<[string, PracticeT]>> {
  const hi = await loadPracticeCatalog('hi');
  const hl = await loadPracticeCatalog('hi-Latn');
  return [
    ['en', createPracticeT('en', null)],
    ['hi', createPracticeT('hi', hi)],
    ['hi-Latn', createPracticeT('hi-Latn', hl)],
  ];
}

const CAPS = { title: 34, detail: 90, score: 90, why: 90 };
const clean = (s: string) => {
  expect(s.length).toBeGreaterThan(0);
  expect(s).not.toMatch(/practice\.chase|\{|\}|undefined|NaN/);
};

describe('chaseResultLines', () => {
  it('a win: the title, the balls to spare, the score; there is nothing to explain', async () => {
    const sixes = Math.ceil(def.target / 6);
    const state = play(Array.from({ length: sixes }, () => 6 as BallRuns));
    const sum = chaseSummary(state, 'learn')!;
    expect(sum.result).toBe('won');
    const balls = state.balls.map((b) => fact({ runs: b.runs, boundary: b.runs === 6 ? 6 : null }));
    for (const [, t] of await translators()) {
      const lines = chaseResultLines(t, sum, balls, null);
      expect(lines.tone).toBe('won');
      expect(lines.why).toBeNull();
      for (const s of [lines.title, lines.detail!, lines.score]) clean(s);
      expect(lines.title.length).toBeLessThanOrEqual(CAPS.title);
      expect(lines.score.length).toBeLessThanOrEqual(CAPS.score);
    }
    const en = createPracticeT('en', null);
    expect(chaseResultLines(en, sum, balls, null).detail).toMatch(/to spare|last ball/i);
  });

  it('a wicket: how it ended and the coach reason, with the timing only when the swing was early or late', async () => {
    const state = play([0, 1, 'W']);
    const sum = chaseSummary(state, 'learn')!;
    const balls = [
      fact(),
      fact({ runs: 1 }),
      fact({ dismissal: 'bowled', reason: 'too_late', timing: 'late', timingErrorMs: 42 }),
    ];
    for (const [name, t] of await translators()) {
      const late = chaseResultLines(t, sum, balls, deciding('too_late', 'late', 42));
      expect(late.tone).toBe('lost');
      clean(late.why!);
      expect(late.why!.length).toBeLessThanOrEqual(CAPS.why);
      expect(late.why).toContain('42');
      const onTime = chaseResultLines(
        t,
        sum,
        balls.slice(0, 2).concat(fact({ dismissal: 'bowled', reason: 'beaten_by_swing', timing: 'on_time' })),
        deciding('beaten_by_swing', 'on_time', 0),
      );
      clean(onTime.why!);
      expect(onTime.why).not.toContain('42');
      if (name === 'en') expect(late.why).toMatch(/^Out: /);
    }
  });

  it('twelve balls without the target: a cause only when two or more dot balls share it, else the plain count', async () => {
    const state = play(Array.from({ length: 12 }, () => 0 as BallRuns));
    const sum = chaseSummary(state, 'learn')!;
    expect(sum.result).toBe('lost_balls');
    const late = Array.from({ length: 12 }, (_, i) => fact({ reason: i < 8 ? 'too_late' : 'solid_defence' }));
    const mixed = Array.from({ length: 12 }, (_, i) =>
      fact({ reason: i === 0 ? 'too_late' : i === 1 ? 'beaten_by_swing' : 'found_the_gap' }),
    );
    for (const [, t] of await translators()) {
      const caused = chaseResultLines(t, sum, late, null).why!;
      const plain = chaseResultLines(t, sum, mixed, null).why!;
      clean(caused);
      clean(plain);
      expect(caused).not.toBe(plain);
      expect(caused.length).toBeLessThanOrEqual(CAPS.why);
    }
    const en = createPracticeT('en', null);
    expect(chaseResultLines(en, sum, late, null).why).toMatch(/early or late/);
    expect(chaseResultLines(en, sum, mixed, null).why).toBe('12 of your 12 balls scored nothing.');
  });

  it('says nothing about why when every ball scored (nothing to attribute)', () => {
    const state = play(Array.from({ length: 12 }, () => 1 as BallRuns));
    const sum = chaseSummary(state, 'learn')!;
    if (sum.result !== 'lost_balls') return; // a target of 12 or less is won by singles; nothing to say then
    const balls = state.balls.map((b) => fact({ runs: b.runs }));
    expect(chaseResultLines(createPracticeT('en', null), sum, balls, null).why).toBeNull();
  });

  it('is the same every time for the same chase', () => {
    const state = play([0, 0, 'W']);
    const sum = chaseSummary(state, 'learn')!;
    const balls = [
      fact(),
      fact(),
      fact({ dismissal: 'bowled', reason: 'too_early', timing: 'early', timingErrorMs: -30 }),
    ];
    const t = createPracticeT('en', null);
    const a = chaseResultLines(t, sum, balls, deciding('too_early', 'early', -30));
    expect(chaseResultLines(t, sum, balls, deciding('too_early', 'early', -30))).toEqual(a);
  });

  it('reads the facts of a simulated result without adding to them', () => {
    const r = deciding('too_late', 'late', 42);
    const f = ballFacts({ ...r, swing: {} as never });
    expect(f).toMatchObject({ reason: 'too_late', timing: 'late', timingErrorMs: 42, swung: true });
  });
});
