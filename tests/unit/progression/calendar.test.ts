import { describe, expect, it } from 'vitest';
import type { DailyRecordV2 } from '@/engine/types';
import { CALENDAR_REASSURANCE, buildMonth, indexRecords, monthLine, recentDays } from '@/progression/calendar';
import { dailyIdWords, daysBetween, formatCountdown, msUntilReset, nextResetAt, shiftDailyId, utcDailyId } from '@/progression/dailyTime';

const attempt = (score: number) => ({ score, outcome: 'resilient' as const, fingerprint: 'DES', completedAt: '2026-10-20T10:00:00.000Z', contentVersion: 'v2', mode: 'simple' as const, scores: { freedom: 70, grievance: 70, safety: 70, evidence: 70, trust: 70, economy: 70 } });

const records: DailyRecordV2[] = [
  { v: 2, dailyId: '2026-10-20', official: attempt(72) },
  { v: 2, dailyId: '2026-10-21', official: attempt(60), practice: { best: attempt(80), attempts: 2 } },
  { v: 2, dailyId: '2026-10-23', practice: { best: attempt(55), attempts: 1 } },
];

describe('daily time (UTC)', () => {
  it('uses the UTC calendar date as the daily id and resets at 00:00 UTC', () => {
    const late = new Date('2026-10-24T23:30:00.000Z');
    expect(utcDailyId(late)).toBe('2026-10-24');
    expect(nextResetAt(late)).toBe('2026-10-25T00:00:00.000Z');
    expect(msUntilReset(late)).toBe(30 * 60_000);
    expect(formatCountdown(msUntilReset(late))).toBe('30m');
    expect(formatCountdown(5 * 3_600_000 + 12 * 60_000)).toBe('5h 12m');
    expect(shiftDailyId('2026-10-24', -1)).toBe('2026-10-23');
    expect(daysBetween('2026-10-20', '2026-10-24')).toBe(4);
    expect(dailyIdWords('2026-10-24')).toMatch(/Saturday 24 Oct/);
  });
});

describe('calendar derivation', () => {
  const index = indexRecords(records, [{ date: '2026-10-18', score: 50, outcome: 'free-fragile', completedAt: '2026-10-18T09:00:00.000Z' }]);
  const month = buildMonth(2026, 9, index, '2026-10-24');

  it('marks official, practice-only, missed, today, future and before-start days', () => {
    const state = (id: string) => month.cells.find((c) => c.dailyId === id)?.state;
    expect(state('2026-10-18')).toBe('official'); // legacy record counts as a completion
    expect(state('2026-10-20')).toBe('official');
    expect(state('2026-10-21')).toBe('official'); // practice never overrides official
    expect(state('2026-10-23')).toBe('practice');
    expect(state('2026-10-22')).toBe('missed');
    expect(state('2026-10-24')).toBe('today');
    expect(state('2026-10-25')).toBe('future');
    expect(state('2026-10-10')).toBe('before');
    expect(month.cells.find((c) => c.dailyId === '2026-10-21')?.score).toBe(60);
    expect(month.officialCount).toBe(3);
    expect(month.playedCount).toBe(4);
  });

  it('lays out Monday-first and keeps the mosaic in order', () => {
    expect(month.leading).toBe(3); // 1 Oct 2026 is a Thursday
    const mosaic = recentDays(index, 7, '2026-10-24');
    expect(mosaic.map((c) => c.dailyId)).toEqual(['2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24']);
    expect(mosaic.map((c) => c.state)).toEqual(['official', 'missed', 'official', 'official', 'missed', 'practice', 'today']);
  });

  it('never shames: copy counts completions and reassures about missed days', () => {
    expect(monthLine(month, false)).toBe('3 days this month');
    expect(monthLine(buildMonth(2026, 10, index, '2026-11-02'), true)).toMatch(/good start/);
    for (const text of [monthLine(month, false), monthLine(month, true), CALENDAR_REASSURANCE.full, CALENDAR_REASSURANCE.simple]) {
      expect(text.toLowerCase()).not.toMatch(/lost|streak|broken|fail|shame|miss(ed)? (out|your)/);
    }
  });
});
