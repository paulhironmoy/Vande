/**
 * DoD CHU-06: the one sentence that says why a chase was lost traces to a recorded field, for at least 60 losses of
 * different causes, in English, Hindi and Hinglish, and it never blames the player. A trace table of every case is
 * built here from the inputs (the dismissal, the closed reason, the measured timing, the dot-ball counts) and each
 * sentence is checked against exactly those.
 */
import { describe, expect, it } from 'vitest';
import type { CoachingReason, DeliveryResult, Dismissal } from '@/contracts';
import {
  chaseReducer,
  chaseSummary,
  makeChase,
  startChase,
  type BallRuns,
  type ChaseDefinition,
} from '@/practice/chase';
import { createPracticeT, loadPracticeCatalog, type PracticeT } from '@/i18n/practice';
import { dismissalWord, reasonWords } from '@/practice/ui/coaching';
import type { ChaseBallFacts, ShortCause } from '@/practice/ui/chase/attribution';
import { chaseResultLines } from '@/practice/ui/chase/words';

const def = makeChase('c030') as ChaseDefinition;

const DISMISSALS: Dismissal[] = ['bowled', 'caught', 'caught_behind', 'lbw'];
const REASONS: CoachingReason[] = [
  'found_the_gap',
  'hit_to_fielder',
  'cleared_the_rope',
  'beat_the_field',
  'caught_in_the_deep',
  'caught_in_the_ring',
  'edged_behind',
  'edged_to_slip',
  'too_early',
  'too_late',
  'beaten_by_swing',
  'beaten_by_seam',
  'beaten_by_turn',
  'beaten_by_pace',
  'beaten_by_bounce',
  'played_across_the_line',
  'missed_straight_ball',
  'left_well',
  'left_and_bowled',
  'played_on',
  'pad_in_line',
  'solid_defence',
  'mistimed_lofted',
];
const TIMINGS = [
  { name: 'early', timing: 'early' as const, ms: -35, swung: true },
  { name: 'late', timing: 'late' as const, ms: 42, swung: true },
  { name: 'on time', timing: 'on_time' as const, ms: 0, swung: true },
  { name: 'a leave', timing: null, ms: null, swung: false },
];

/** Words that would blame the player in the three languages' Latin and Devanagari forms we ship. */
const BLAME =
  /\b(?:you failed|your fault|your mistake|mistake|careless|poor|bad shot|should have|silly|blunder)\b|galti|गलती|ग़लती/i;

async function translators(): Promise<Array<[string, PracticeT]>> {
  const hi = await loadPracticeCatalog('hi');
  const hl = await loadPracticeCatalog('hi-Latn');
  return [
    ['en', createPracticeT('en', null)],
    ['hi', createPracticeT('hi', hi)],
    ['hi-Latn', createPracticeT('hi-Latn', hl)],
  ];
}

function lostByWicket(ball: number) {
  let s = startChase(def);
  for (let i = 0; i < ball; i++)
    s = chaseReducer(s, {
      type: 'ball',
      overIndex: Math.floor(i / 6),
      ballIndex: i % 6,
      runs: 0,
      dismissal: i === ball - 1 ? 'bowled' : null,
    });
  return chaseSummary(s, 'learn')!;
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

describe('the one sentence of a lost chase traces to the record', () => {
  it('a wicket: the dismissal, the coach reason and the measured timing, for every combination (368 losses)', async () => {
    let cases = 0;
    for (const [lang, t] of await translators()) {
      for (const how of DISMISSALS)
        for (const reason of REASONS)
          for (const tm of TIMINGS) {
            const sum = lostByWicket(3);
            const balls = [
              fact(),
              fact({ runs: 0 }),
              fact({ dismissal: how, reason, timing: tm.timing, timingErrorMs: tm.ms, swung: tm.swung }),
            ];
            const deciding = {
              coaching: { reason, timing: tm.timing, zone: null, fielderRole: null, lbw: null },
              outcome: {
                runs: 0,
                boundary: null,
                dismissal: how,
                fielderId: null,
                endBearingDeg: null,
                endDistanceM: null,
                region: null,
              },
              contact: { timingErrorMs: tm.ms, timing: tm.timing === 'on_time' ? 'perfect' : 'mistimed' },
            } as unknown as Pick<DeliveryResult, 'coaching' | 'outcome' | 'contact'>;
            const why = chaseResultLines(t, sum, balls, deciding).why!;
            // Traces: the dismissal word and the reason line are the ones the coach's vocabulary has for these codes ...
            expect(why).toContain(dismissalWord(t, how));
            expect(why).toContain(reasonWords(t, reason, deciding));
            // ... the timing appears exactly when the swing was early or late, and is the measured number ...
            const shouldShow = tm.swung && (tm.timing === 'early' || tm.timing === 'late');
            if (shouldShow) expect(why).toContain(String(Math.abs(tm.ms!)));
            else expect(why).not.toMatch(/\d/);
            // ... it is one sentence of the closed frame, and it never blames.
            expect(why).not.toMatch(BLAME);
            expect(why).not.toMatch(/practice\.|\{|\}|undefined|NaN/);
            if (lang === 'en') {
              expect(why.startsWith('Out: ')).toBe(true);
              expect(why.endsWith('.')).toBe(true);
            }
            cases++;
          }
    }
    expect(cases).toBe(3 * 4 * 23 * 4);
  });

  it('balls ran out: the counts in the sentence are the recorded counts, and the cause is one the dot balls share', async () => {
    const causes: Array<[ShortCause, CoachingReason, RegExp]> = [
      ['timing', 'too_late', /early or late/],
      ['bowler', 'beaten_by_swing', /beat the bat/],
      ['line', 'missed_straight_ball', /missed or hit the pad/],
      ['field', 'hit_to_fielder', /fielder/],
      ['defence', 'solid_defence', /defended or left/],
    ];
    const t = createPracticeT('en', null);
    const zero = Array.from({ length: 12 }, () => 0 as BallRuns);
    let state = startChase(def);
    zero.forEach((r, i) => {
      state = chaseReducer(state, {
        type: 'ball',
        overIndex: Math.floor(i / 6),
        ballIndex: i % 6,
        runs: r,
        dismissal: null,
      });
    });
    const sum = chaseSummary(state, 'learn')!;
    expect(sum.result).toBe('lost_balls');
    let cases = 0;
    for (const [, reason, words] of causes)
      for (let shared = 2; shared <= 12; shared++) {
        const balls = Array.from({ length: 12 }, (_, i) => fact({ reason: i < shared ? reason : 'found_the_gap' }));
        const why = chaseResultLines(t, sum, balls, null).why!;
        const nums = (why.match(/\d+/g) ?? []).map(Number);
        // "N of the D balls that scored nothing ..." or "D of your 12 balls scored nothing."
        expect(nums).toContain(12);
        // Every dot ball a defence: the plain count says it better than "12 of the 12".
        if (reason === 'solid_defence' && shared === 12) expect(why).toBe('12 of your 12 balls scored nothing.');
        else expect(why).toMatch(words);
        expect(why).not.toMatch(BLAME);
        cases++;
      }
    // One shared reason is not a pattern: the plain count is all that is said.
    const single = Array.from({ length: 12 }, (_, i) => fact({ reason: i === 0 ? 'too_late' : 'found_the_gap' }));
    expect(chaseResultLines(t, sum, single, null).why).toBe('12 of your 12 balls scored nothing.');
    expect(cases).toBeGreaterThanOrEqual(55);
  });

  it('is the same sentence for the same record, whichever order the balls are listed in', () => {
    const t = createPracticeT('en', null);
    let state = startChase(def);
    for (let i = 0; i < 12; i++)
      state = chaseReducer(state, {
        type: 'ball',
        overIndex: Math.floor(i / 6),
        ballIndex: i % 6,
        runs: 0,
        dismissal: null,
      });
    const sum = chaseSummary(state, 'learn')!;
    const reasons: CoachingReason[] = [
      'too_late',
      'too_early',
      'beaten_by_pace',
      'beaten_by_seam',
      'solid_defence',
      'left_well',
    ];
    const balls = Array.from({ length: 12 }, (_, i) => fact({ reason: reasons[i % 6] }));
    const a = chaseResultLines(t, sum, balls, null).why;
    // The deciding (last) ball is the last in the list by construction; the others may be permuted without changing the answer.
    const permuted = [...balls.slice(0, 11).reverse(), balls[11]];
    expect(chaseResultLines(t, sum, permuted, null).why).toBe(a);
  });
});
