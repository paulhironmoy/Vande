import { describe, expect, it } from 'vitest';
import { dateKey, getDailySpec, getDailySpecForKey } from '../../../src/engine/daily';
import { SCENARIO_IDS } from '../../../src/engine/types';

describe('daily challenge', () => {
  it('is deterministic for a calendar day', () => {
    const a = getDailySpecForKey('2026-10-23');
    const b = getDailySpecForKey('2026-10-23');
    expect(a).toEqual(b);
    expect(a.difficulty).toBe('standard');
    expect(a.opponents.length).toBeGreaterThanOrEqual(2);
    expect(a.opponents.length).toBeLessThanOrEqual(3);
    expect(new Set(a.opponents).size).toBe(a.opponents.length);
    expect(a.simulatedBand.low).toBeLessThan(a.simulatedBand.typical);
    expect(a.simulatedBand.typical).toBeLessThan(a.simulatedBand.high);
    expect(a.title).toContain('Daily Crisis');
  });

  it('rotates scenarios across consecutive days', () => {
    const ids = ['2026-10-23', '2026-10-24', '2026-10-25'].map((k) => getDailySpecForKey(k).scenarioId);
    expect(new Set(ids).size).toBe(3);
    for (const id of ids) expect(SCENARIO_IDS).toContain(id);
    expect(getDailySpecForKey('2026-10-26').scenarioId).toBe(ids[0]);
  });

  it('uses the local calendar day regardless of time of day', () => {
    const morning = new Date(2026, 9, 23, 0, 5);
    const night = new Date(2026, 9, 23, 23, 55);
    expect(dateKey(morning)).toBe('2026-10-23');
    expect(dateKey(night)).toBe('2026-10-23');
    expect(getDailySpec(morning)).toEqual(getDailySpec(night));
    expect(getDailySpec(new Date(2026, 9, 24, 0, 1)).seed).not.toBe(getDailySpec(night).seed);
  });

  it('different days get different seeds', () => {
    const seeds = new Set(Array.from({ length: 30 }, (_, i) => getDailySpecForKey(`2026-11-${String(i + 1).padStart(2, '0')}`).seed));
    expect(seeds.size).toBe(30);
  });
});
