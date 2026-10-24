import { describe, expect, it } from 'vitest';
import { createRng, hashString, rngFloat, rngInt } from '../../../src/engine/prng';

describe('prng', () => {
  it('hashString is stable and sensitive to input', () => {
    expect(hashString('vande')).toBe(hashString('vande'));
    expect(hashString('vande')).not.toBe(hashString('Vande'));
    expect(hashString('')).toBeGreaterThanOrEqual(0);
    expect(hashString('vande-daily-2026-10-23')).toBeLessThanOrEqual(0xffffffff);
  });

  it('same seed produces the same sequence', () => {
    let a = createRng(42);
    let b = createRng(42);
    for (let i = 0; i < 50; i++) {
      const ra = rngFloat(a);
      const rb = rngFloat(b);
      expect(ra.value).toBe(rb.value);
      a = ra.next;
      b = rb.next;
    }
    expect(rngFloat(createRng(42)).value).not.toBe(rngFloat(createRng(43)).value);
  });

  it('floats are uniform in [0,1)', () => {
    let r = createRng(7);
    let sum = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) {
      const f = rngFloat(r);
      expect(f.value).toBeGreaterThanOrEqual(0);
      expect(f.value).toBeLessThan(1);
      sum += f.value;
      r = f.next;
    }
    expect(sum / n).toBeGreaterThan(0.48);
    expect(sum / n).toBeLessThan(0.52);
  });

  it('ints cover the inclusive range', () => {
    let r = createRng(99);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const v = rngInt(r, 3, 7);
      expect(v.value).toBeGreaterThanOrEqual(3);
      expect(v.value).toBeLessThanOrEqual(7);
      seen.add(v.value);
      r = v.next;
    }
    expect([...seen].sort()).toEqual([3, 4, 5, 6, 7]);
    expect(rngInt(createRng(1), 5, 5).value).toBe(5);
  });
});
