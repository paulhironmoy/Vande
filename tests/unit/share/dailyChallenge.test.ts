import { describe, expect, it } from 'vitest';
import { decodeAnyChallenge, decodeChallenge, decodeDailyChallenge, encodeChallenge, encodeDailyChallenge, isValidDailyId } from '@/engine/challenge';

describe('daily challenge codes', () => {
  it('round-trips with and without optional fields and survives case changes and URLs', () => {
    const full = encodeDailyChallenge({ dailyId: '2026-10-26', score: 78, fingerprint: 'DESDE', outcome: 'resilient' });
    expect(full).toMatch(/^D1-20261026-/);
    expect(decodeDailyChallenge(full)).toEqual({ kind: 'daily', v: 1, dailyId: '2026-10-26', score: 78, fingerprint: 'DESDE', outcome: 'resilient' });
    expect(decodeDailyChallenge(full.toLowerCase())).toMatchObject({ dailyId: '2026-10-26', score: 78 });
    expect(decodeDailyChallenge(`https://vande.example/Vande/?c=${encodeURIComponent(full)}`)).toMatchObject({ dailyId: '2026-10-26' });
    const bare = encodeDailyChallenge({ dailyId: '2026-02-28' });
    expect(decodeDailyChallenge(bare)).toEqual({ kind: 'daily', v: 1, dailyId: '2026-02-28', score: undefined, fingerprint: undefined, outcome: undefined });
  });

  it('rejects tampered, malformed and impossible codes', () => {
    const full = encodeDailyChallenge({ dailyId: '2026-10-26', score: 78, fingerprint: 'DESDE' });
    const tampered = full.replace('-DESDE-', '-DESDX-');
    expect(decodeDailyChallenge(tampered)).toBeNull();
    expect(decodeDailyChallenge('D1-20261332-_-_-_-x')).toBeNull();
    expect(decodeDailyChallenge('D1-2026')).toBeNull();
    expect(() => encodeDailyChallenge({ dailyId: '2026-13-40' })).toThrow();
    expect(isValidDailyId('2026-02-30')).toBe(false);
    expect(isValidDailyId('2026-02-28')).toBe(true);
  });

  it('keeps V1 codes working and routes both kinds through decodeAnyChallenge', () => {
    const v1 = encodeChallenge({ v: 1, scenario: 'examination-crisis', seed: 12345, difficulty: 'standard', opponents: ['exploiter', 'disinfo'], score: 70 });
    expect(decodeChallenge(v1)).toMatchObject({ seed: 12345, score: 70 });
    expect(decodeAnyChallenge(v1)).toMatchObject({ kind: 'campaign', spec: { seed: 12345 } });
    const d1 = encodeDailyChallenge({ dailyId: '2026-10-26', score: 55 });
    expect(decodeAnyChallenge(d1)).toMatchObject({ kind: 'daily', dailyId: '2026-10-26', score: 55 });
    expect(decodeChallenge(d1)).toBeNull();
    expect(decodeAnyChallenge('garbage')).toBeNull();
  });
});
