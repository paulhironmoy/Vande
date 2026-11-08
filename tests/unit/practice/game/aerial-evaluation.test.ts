// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { evaluateAerialFielding } from '@/practice/game/evaluate';

describe('aerial field-placement evaluation', () => {
  it('accounts for every preset launch and compares actual catch opportunities independently of ground arcs', () => {
    const result = evaluateAerialFielding();
    expect(result.total).toBe(4 * 8 * 3 * 3);
    expect(result.eligible + Object.values(result.excluded).reduce((n, count) => n + count, 0)).toBe(result.total);
    expect(result.eligible).toBeGreaterThan(0);
    expect(result.protectedCatches).toBeGreaterThan(0);
    expect(result.gapCatches).toBeLessThanOrEqual(result.protectedCatches * 0.5);
  }, 30_000);
});
