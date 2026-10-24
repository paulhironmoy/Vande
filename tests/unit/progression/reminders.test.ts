import { describe, expect, it } from 'vitest';
import { REMINDER_COPY, REMINDER_HOURS, canUseReminders, cancelDailyReminder, scheduleDailyReminder } from '@/reminders';
import { dailyStateFor } from '@/progression/dailyState';

describe('reminders', () => {
  it('are unsupported on the web and never guilt-trip', async () => {
    expect(canUseReminders()).toBe(false);
    expect(await scheduleDailyReminder(19)).toBe('unsupported');
    await expect(cancelDailyReminder()).resolves.toBeUndefined();
    for (const text of Object.values(REMINDER_COPY)) {
      expect(text.toLowerCase()).not.toMatch(/lost|streak|broken|don't forget|missing out|hurry|last chance|miss(ed)? your/);
    }
    expect(REMINDER_HOURS.map((h) => h.value)).toEqual([8, 12, 19, 21]);
  });
});

describe('daily state line', () => {
  const now = new Date('2026-10-24T18:48:00.000Z');
  const official = { score: 72, outcome: 'resilient' as const, fingerprint: 'DES', completedAt: '2026-10-24T10:00:00.000Z', contentVersion: 'v2', mode: 'simple' as const, scores: { freedom: 70, grievance: 70, safety: 70, evidence: 70, trust: 70, economy: 70 } };

  it('shows not started, in progress and official states with the next reset', () => {
    expect(dailyStateFor('2026-10-24', [], false, false, now)).toMatchObject({ status: 'not-started', cta: "Play Today's Crisis" });
    expect(dailyStateFor('2026-10-24', [], true, true, now).status).toBe('in-progress');
    const done = dailyStateFor('2026-10-24', [{ v: 2, dailyId: '2026-10-24', official, practice: { best: { ...official, score: 80 }, attempts: 1 } }], false, false, now);
    expect(done.status).toBe('official');
    expect(done.line).toBe('Official result: 72 · practice best 80 · next crisis in 5h 12m');
    expect(done.cta).toMatch(/Practice/);
  });
});
