/**
 * The chase's attribution reads only what the physics measured. It names a cause only when at least two dot balls share
 * it, never invents one, ignores the order the balls are listed in, and gives the same answer every time.
 */
import { describe, expect, it } from 'vitest';
import type { CoachingReason } from '@/contracts';
import {
  MIN_PATTERN,
  attributeShort,
  attributeWicket,
  attributeWon,
  ballFacts,
  type ChaseBallFacts,
} from '@/practice/ui/chase/attribution';

const ball = (over: Partial<ChaseBallFacts> = {}): ChaseBallFacts => ({
  runs: 0,
  boundary: null,
  dismissal: null,
  reason: 'solid_defence',
  timing: 'on_time',
  timingErrorMs: 0,
  swung: true,
  ...over,
});
const dot = (reason: CoachingReason) => ball({ reason });

describe('attributeShort', () => {
  it('counts the runs scored, the dot balls and how far short the chase finished', () => {
    const balls = [ball({ runs: 4, boundary: 4, reason: 'found_the_gap' }), dot('solid_defence'), ball({ runs: 1 })];
    const a = attributeShort(balls, 12);
    expect(a).toMatchObject({ kind: 'short', short: 7, scored: 5, balls: 3, dots: 1 });
  });

  it('is never short by less than one run', () => {
    expect(attributeShort([ball({ runs: 6, boundary: 6 })], 4).short).toBe(1);
  });

  it('names the group most of the dot balls belong to when at least two share it', () => {
    const balls = [
      dot('too_late'),
      dot('too_early'),
      dot('mistimed_lofted'),
      dot('beaten_by_swing'),
      dot('solid_defence'),
    ];
    expect(attributeShort(balls, 20)).toMatchObject({ dots: 5, cause: 'timing', causeCount: 3 });
  });

  it('names no cause when no group has a pattern', () => {
    const balls = [dot('too_late'), dot('beaten_by_swing'), dot('missed_straight_ball'), dot('hit_to_fielder')];
    const a = attributeShort(balls, 20);
    expect(MIN_PATTERN).toBe(2);
    expect(a.cause).toBeNull();
    expect(a.causeCount).toBe(0);
  });

  it('breaks ties by a fixed order, not by the order of the balls', () => {
    const forward = [dot('beaten_by_pace'), dot('beaten_by_seam'), dot('too_late'), dot('too_early')];
    const backward = [...forward].reverse();
    expect(attributeShort(forward, 20).cause).toBe('timing');
    expect(attributeShort(backward, 20).cause).toBe('timing');
  });

  it('counts only balls that scored nothing and were not a wicket', () => {
    const balls = [
      ball({ runs: 1, reason: 'too_late' }),
      ball({ runs: 2, reason: 'too_late' }),
      ball({ runs: 0, dismissal: 'bowled', reason: 'too_late' }),
      dot('too_late'),
    ];
    const a = attributeShort(balls, 20);
    expect(a.dots).toBe(1);
    expect(a.cause).toBeNull();
  });

  it('puts every closed coaching reason in one group or none, so nothing is left undecided', () => {
    const reasons: CoachingReason[] = [
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
    for (const r of reasons) {
      const a = attributeShort([dot(r), dot(r)], 10);
      expect(['timing', 'bowler', 'line', 'defence', 'field', null]).toContain(a.cause);
    }
  });

  it('is the same on every call', () => {
    const balls = [dot('too_late'), dot('too_early'), dot('beaten_by_turn')];
    expect(attributeShort(balls, 15)).toEqual(attributeShort(balls, 15));
  });
});

describe('attributeWicket', () => {
  it('carries the dismissal, the closed reason and the measured timing', () => {
    const a = attributeWicket(
      ball({ dismissal: 'bowled', reason: 'too_late', timing: 'late', timingErrorMs: 42, swung: true }),
    );
    expect(a).toEqual({
      kind: 'wicket',
      dismissal: 'bowled',
      reason: 'too_late',
      timing: 'late',
      timingErrorMs: 42,
      swung: true,
    });
  });

  it('keeps a leave a leave: no timing is made up for a ball the batter did not swing at', () => {
    const a = attributeWicket(
      ball({ dismissal: 'bowled', reason: 'left_and_bowled', timing: null, timingErrorMs: null, swung: false }),
    );
    expect(a.timing).toBeNull();
    expect(a.timingErrorMs).toBeNull();
    expect(a.swung).toBe(false);
  });
});

describe('attributeWon', () => {
  it('says how the last runs came and how many balls were left', () => {
    expect(attributeWon(ball({ runs: 6, boundary: 6 }), 3)).toEqual({ kind: 'won', ballsLeft: 3, finish: 6 });
    expect(attributeWon(ball({ runs: 2 }), 0)).toEqual({ kind: 'won', ballsLeft: 0, finish: null });
  });

  it('never reports a negative number of balls left', () => {
    expect(attributeWon(ball({ runs: 1 }), -2).ballsLeft).toBe(0);
  });
});

describe('ballFacts', () => {
  it('reads a delivery result without adding anything of its own', () => {
    const facts = ballFacts({
      outcome: {
        runs: 4,
        boundary: 4,
        dismissal: null,
        fielderId: null,
        endBearingDeg: 10,
        endDistanceM: 70,
        region: null,
      },
      coaching: { reason: 'found_the_gap', timing: 'on_time', zone: null, fielderRole: null, lbw: null },
      contact: { timingErrorMs: -3 } as never,
      swing: {} as never,
    });
    expect(facts).toEqual({
      runs: 4,
      boundary: 4,
      dismissal: null,
      reason: 'found_the_gap',
      timing: 'on_time',
      timingErrorMs: -3,
      swung: true,
    });
  });

  it('marks a leave as no swing', () => {
    const facts = ballFacts({
      outcome: {
        runs: 0,
        boundary: null,
        dismissal: null,
        fielderId: null,
        endBearingDeg: null,
        endDistanceM: null,
        region: null,
      },
      coaching: { reason: 'left_well', timing: null, zone: null, fielderRole: null, lbw: null },
      contact: { timingErrorMs: null } as never,
      swing: null,
    });
    expect(facts.swung).toBe(false);
    expect(facts.timingErrorMs).toBeNull();
  });
});
