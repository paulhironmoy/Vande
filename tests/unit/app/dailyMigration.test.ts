import { beforeEach, describe, expect, it } from 'vitest';
import { __resetStoreForTests, mergeDailyRecords, migrateDailyRecords, useApp, utcDayKey } from '@/app/store';
import { __resetPersistenceForTests, storage } from '@/app/persistence';
import type { DailyRecord, DailyRecordV2 } from '@/engine/types';

describe('daily records v1 → v2 migration', () => {
  beforeEach(async () => {
    await __resetPersistenceForTests();
    __resetStoreForTests();
  });

  it('turns every legacy day into an immutable official result and keeps existing v2 rows', () => {
    const legacy: DailyRecord[] = [
      { date: '2026-10-20', score: 71, outcome: 'resilient', completedAt: '2026-10-20T10:00:00.000Z' },
      { date: '2026-10-21', score: 44, outcome: 'free-fragile', completedAt: '2026-10-21T10:00:00.000Z' },
    ];
    const existing: DailyRecordV2[] = [
      {
        v: 2,
        dailyId: '2026-10-21',
        official: { score: 60, outcome: 'manipulated', fingerprint: 'DDE', completedAt: '2026-10-21T09:00:00.000Z', contentVersion: 'daily-1', mode: 'simple', scores: { freedom: 60, grievance: 60, safety: 60, evidence: 60, trust: 60, economy: 60 } },
      },
    ];
    const out = migrateDailyRecords(legacy, existing);
    expect(out).toHaveLength(2);
    const d20 = out.find((r) => r.dailyId === '2026-10-20')!;
    expect(d20.official?.score).toBe(71);
    expect(d20.official?.fingerprint).toBe('legacy');
    expect(d20.official?.contentVersion).toBe('v1-campaign');
    const d21 = out.find((r) => r.dailyId === '2026-10-21')!;
    expect(d21.official?.score).toBe(60); // the v2 row wins over the legacy row
    expect(out[0].dailyId > out[1].dailyId).toBe(true); // newest first
  });

  it('migrates once on hydrate, persists the result and generates an anonymous install id', async () => {
    await storage.setDaily([{ date: '2026-10-19', score: 58, outcome: 'order-without-trust', completedAt: '2026-10-19T08:00:00.000Z' }]);
    await useApp.getState().hydrate();
    const s = useApp.getState();
    expect(s.dailyV2.map((r) => r.dailyId)).toEqual(['2026-10-19']);
    expect(s.dailyV2[0].official?.score).toBe(58);
    expect(s.installId.length).toBeGreaterThan(8);
    expect(s.daily).toHaveLength(1); // legacy rows untouched
    const persisted = await storage.getDailyV2();
    expect(persisted?.[0]?.dailyId).toBe('2026-10-19');
    const meta = await storage.getMeta();
    expect(meta?.dailyMigratedV2).toBe(true);
    expect(meta?.installId).toBe(s.installId);
  });

  it('rotates the install id on request and after deleting all data', async () => {
    await useApp.getState().hydrate();
    const first = useApp.getState().installId;
    await useApp.getState().rotateInstallId();
    const second = useApp.getState().installId;
    expect(second).not.toBe(first);
    expect((await storage.getMeta())?.installId).toBe(second);
    await useApp.getState().deleteAllData();
    const third = useApp.getState().installId;
    expect(third).not.toBe(second);
    expect(third.length).toBeGreaterThan(8);
  });

  it('uses the UTC calendar day as the canonical daily id', () => {
    expect(utcDayKey(new Date('2026-10-24T23:59:59Z'))).toBe('2026-10-24');
    expect(utcDayKey(new Date('2026-10-25T00:00:01Z'))).toBe('2026-10-25');
  });

  it('drops malformed legacy rows and keeps the best score per date', () => {
    const junk = [
      { date: 'not-a-date', score: 50, outcome: 'resilient', completedAt: 'x' },
      { date: '2026-10-21' } as unknown as DailyRecord,
      { date: '2026-10-22', score: 50, outcome: 'resilient', completedAt: '2026-10-22T01:00:00.000Z' },
      { date: '2026-10-22', score: 70, outcome: 'free-fragile', completedAt: '2026-10-22T02:00:00.000Z' },
      { date: '2026-10-23', score: 500, outcome: 'resilient', completedAt: 'x' },
      { date: '2026-10-24', score: 40, outcome: 'nonsense', completedAt: 'x' } as unknown as DailyRecord,
    ] as DailyRecord[];
    const out = migrateDailyRecords(junk, []);
    expect(out.map((r) => r.dailyId)).toEqual(['2026-10-22']);
    expect(out[0].official?.score).toBe(70);
  });

  it('merges records from another tab: the earlier official result wins and the other completion becomes practice', () => {
    const mk = (score: number, at: string): DailyRecordV2['official'] => ({ score, outcome: 'resilient', fingerprint: 'DDD', completedAt: at, contentVersion: 'c', mode: 'simple', scores: { freedom: 0, grievance: 0, safety: 0, evidence: 0, trust: 0, economy: 0 } });
    const stored: DailyRecordV2[] = [{ v: 2, dailyId: '2026-10-24', official: mk(60, '2026-10-24T10:00:00.000Z') }];
    const local: DailyRecordV2[] = [{ v: 2, dailyId: '2026-10-24', official: mk(90, '2026-10-24T10:05:00.000Z') }];
    const merged = mergeDailyRecords(stored, local);
    expect(merged[0].official?.score).toBe(60);
    expect(merged[0].practice?.best.score).toBe(90);
    expect(merged[0].practice?.attempts).toBe(1);
    // Nothing stored yet: local wins unchanged.
    expect(mergeDailyRecords(undefined, local)[0].official?.score).toBe(90);
  });
});
