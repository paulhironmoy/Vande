// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeliveryResult } from '@/contracts/practice';
import { resolveDelivery } from '@/physics';
import { fixedInputClauses, fixedPolicy, playInnings, type EvalBall, type PolicyStats } from '@/practice/game/evaluate';

vi.mock('@/physics', () => ({
  autoField: vi.fn(),
  flight: vi.fn(),
  batTravelMs: vi.fn(() => 0),
  idealTimeFor: vi.fn(() => 1),
  resolveDelivery: vi.fn(),
}));

const resolve = vi.mocked(resolveDelivery);
const ball = { over: { bowler: {} }, flight: {}, field: {}, conditions: 'balanced' } as EvalBall;
const innings = (overs: number) => Array.from({ length: overs }, () => Array.from({ length: 6 }, () => ball));
const outcome = (runs: number, dismissal: string | null = null) => ({ outcome: { runs, dismissal } }) as DeliveryResult;
const stats = (runsPerOver: number, dismissalsPerBall: number, boundariesPerOver = 0) =>
  ({ runsPerOver, dismissalsPerBall, boundariesPerOver }) as PolicyStats;

beforeEach(() => resolve.mockReset());

describe('release-gate innings comparison', () => {
  it('stops at the first wicket and starts the next independent innings from its first ball', () => {
    resolve
      .mockReturnValueOnce(outcome(4))
      .mockReturnValueOnce(outcome(0, 'caught'))
      .mockReturnValueOnce(outcome(1))
      .mockReturnValueOnce(outcome(2))
      .mockReturnValueOnce(outcome(0, 'bowled'));
    const result = playInnings([innings(10), innings(10)], fixedPolicy(null, 0), 'real');
    expect(resolve).toHaveBeenCalledTimes(5);
    expect(result.samples).toEqual([
      { runs: 4, balls: 2, dismissed: true, completed: false },
      { runs: 3, balls: 3, dismissed: true, completed: false },
    ]);
    expect(result.meanRuns).toBe(3.5);
    expect(result.dismissalRate).toBe(1);
  });

  it('caps surviving innings at ten overs even if more are supplied', () => {
    resolve.mockReturnValue(outcome(1));
    const result = playInnings([innings(11)], fixedPolicy(null, 0), 'real');
    expect(resolve).toHaveBeenCalledTimes(60);
    expect(result.samples).toEqual([{ runs: 60, balls: 60, dismissed: false, completed: true }]);
  });

  it('does not treat a short sample as a complete ten-over innings', () => {
    resolve.mockReturnValue(outcome(1));
    expect(playInnings([innings(1)], fixedPolicy(null, 0), 'real').completed).toBe(0);
  });
});

describe('FAIR6 fixed-input required clauses', () => {
  it('fails a productive safe input even when its boundaries are below the threshold', () => {
    expect(fixedInputClauses([stats(2, 0.04, 0.2)])).toMatchObject({
      boundaryPass: true,
      productiveDismissalPass: false,
      unsafeProductiveInputs: 1,
    });
  });

  it('excludes unproductive leave/defend inputs and includes exactly one run per over', () => {
    expect(fixedInputClauses([stats(0, 0), stats(0.999, 0), stats(1, 0.1)])).toMatchObject({
      productiveDismissalPass: true,
      productiveInputs: 1,
    });
    expect(fixedInputClauses([stats(1, 0.099)]).productiveDismissalPass).toBe(false);
  });

  it('checks both boundary and dismissal requirements independently', () => {
    expect(fixedInputClauses([stats(10, 0.5, 2)])).toMatchObject({
      boundaryPass: false,
      productiveDismissalPass: true,
    });
    expect(fixedInputClauses([]).boundaryPass).toBe(false);
  });
});
