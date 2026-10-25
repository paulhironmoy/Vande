import { describe, expect, it } from 'vitest';
import { displayOrder } from '@/lite/order';
import { getScenario } from '@/engine';

describe('displayOrder', () => {
  it('is a deterministic permutation per seed and question', () => {
    const a = displayOrder(42, 'd-first-response', 4);
    expect([...a].sort()).toEqual([0, 1, 2, 3]);
    expect(displayOrder(42, 'd-first-response', 4)).toEqual(a);
    expect(displayOrder(0, 'x', 0)).toEqual([]);
    expect(displayOrder(5, 'x', 1)).toEqual([0]);
  });

  it('spreads the first authored answer evenly over the positions, so the first card is not a strategy', () => {
    const sc = getScenario('examination-crisis');
    const counts = [0, 0, 0, 0];
    let total = 0;
    for (let seed = 1; seed <= 2000; seed++)
      for (const d of sc.decisions.filter((x) => x.options.length === 4)) {
        counts[displayOrder(seed, d.id, 4).indexOf(0)] += 1;
        total += 1;
      }
    for (const c of counts) expect(c / total).toBeGreaterThan(0.22);
    for (const c of counts) expect(c / total).toBeLessThan(0.28);
  });
});
