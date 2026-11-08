import { describe, expect, it } from 'vitest';
import { COACH_RESULT_CACHE_SIZE, memoCoachResult, type CoachResult } from '@/practice/coach/simulate';

describe('Coach exact-result LRU', () => {
  it('reuses exact hits, refreshes recency and honestly re-simulates an evicted swing', () => {
    const results = new Map<string, CoachResult>();
    let simulations = 0;
    const resolve = (key: string) =>
      memoCoachResult(
        results,
        key,
        () =>
          ({
            token: `${key}:${++simulations}`,
          }) as unknown as CoachResult,
      );

    const originals = Array.from({ length: COACH_RESULT_CACHE_SIZE }, (_, index) => resolve(String(index)));
    expect(results.size).toBe(COACH_RESULT_CACHE_SIZE);
    expect(simulations).toBe(COACH_RESULT_CACHE_SIZE);

    expect(resolve('0')).toBe(originals[0]);
    expect(simulations).toBe(COACH_RESULT_CACHE_SIZE);

    resolve(String(COACH_RESULT_CACHE_SIZE));
    expect(results.size).toBe(COACH_RESULT_CACHE_SIZE);
    expect(results.has('0')).toBe(true);
    expect(results.has('1')).toBe(false);

    const replayed = resolve('1');
    expect(replayed).not.toBe(originals[1]);
    expect(simulations).toBe(COACH_RESULT_CACHE_SIZE + 2);
    expect(results.size).toBe(COACH_RESULT_CACHE_SIZE);
  });
});
