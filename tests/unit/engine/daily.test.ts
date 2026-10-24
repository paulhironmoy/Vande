import { afterEach, describe, expect, it } from 'vitest';
import { DAYS, SCHEDULE } from '@/content/daily';
import {
  dailyIdFor,
  dailySeed,
  dateKey,
  dayIdFor,
  dayIndex,
  getDailyDay,
  getDailyScenario,
  getDailySpec,
  getDailySpecForKey,
  getDayScenario,
  isDailyId,
  listDailyDays,
  nextDailyAt,
  resolveDaily,
} from '@/engine/daily';
import { isDailyScenarioId } from '@/engine/types';

const DAY_MS = 86_400_000;
/** Canonical id `offset` days after the schedule epoch. */
const idAt = (offset: number) => dailyIdFor(new Date((dayIndex(SCHEDULE.epoch) + offset) * DAY_MS));

describe('canonical daily ids (UTC)', () => {
  it('uses the UTC calendar date, not the local one', () => {
    expect(dailyIdFor(new Date('2026-10-23T23:59:59.999Z'))).toBe('2026-10-23');
    expect(dailyIdFor(new Date('2026-10-24T00:00:00.000Z'))).toBe('2026-10-24');
    expect(dailyIdFor(new Date('2026-10-24T00:01:00.000Z'))).toBe('2026-10-24');
    // 03:30 IST on the 24th is 22:00 UTC on the 23rd; 20:00 in New York on the 23rd is 01:00 UTC on the 24th.
    expect(dailyIdFor(new Date('2026-10-24T03:30:00+05:30'))).toBe('2026-10-23');
    expect(dailyIdFor(new Date('2026-10-23T20:00:00-05:00'))).toBe('2026-10-24');
  });

  it('accepts only real calendar dates in canonical form', () => {
    expect(isDailyId('2026-10-23')).toBe(true);
    expect(isDailyId('2028-02-29')).toBe(true);
    expect(isDailyId('2026-02-29')).toBe(false);
    expect(isDailyId('2026-13-01')).toBe(false);
    expect(isDailyId('2026-04-31')).toBe(false);
    expect(isDailyId('2026-1-1')).toBe(false);
    expect(isDailyId('today')).toBe(false);
  });

  it('rolls over at 00:00 UTC', () => {
    expect(nextDailyAt('2026-10-23')).toBe('2026-10-24T00:00:00.000Z');
    expect(nextDailyAt('2026-12-31')).toBe('2027-01-01T00:00:00.000Z');
    expect(dayIndex('1970-01-02')).toBe(1);
    expect(dayIndex('2026-10-24') - dayIndex('2026-10-23')).toBe(1);
  });

  it('keeps the deprecated local date key for legacy records', () => {
    expect(dateKey(new Date(2026, 9, 23, 23, 55))).toBe('2026-10-23');
    expect(dateKey(new Date(2026, 9, 23, 0, 5))).toBe('2026-10-23');
  });
});

describe('schedule', () => {
  it('has at least 30 authored days, all present and unique', () => {
    expect(SCHEDULE.order.length).toBeGreaterThanOrEqual(30);
    expect(new Set(SCHEDULE.order).size).toBe(SCHEDULE.order.length);
    for (const id of SCHEDULE.order) expect(DAYS[id], id).toBeDefined();
    expect(isDailyId(SCHEDULE.epoch)).toBe(true);
  });

  it('never repeats a dilemma inside any 30-day window of the rotation', () => {
    const n = SCHEDULE.order.length;
    const window = Math.min(30, n);
    for (let i = 0; i < n; i++) {
      const keys = Array.from({ length: window }, (_, k) => DAYS[SCHEDULE.order[(i + k) % n]].dilemmaKey);
      expect(new Set(keys).size, `window starting at ${SCHEDULE.order[i]}`).toBe(window);
    }
  });

  it('lists days in schedule order', () => {
    expect(listDailyDays().map((d) => d.id)).toEqual(SCHEDULE.order);
    expect(getDailyDay(SCHEDULE.order[0])?.id).toBe(SCHEDULE.order[0]);
    expect(getDailyDay('d999')).toBeUndefined();
  });
});

describe('resolution', () => {
  const pinnedBackup = { ...SCHEDULE.pinned };
  const orderBackup = [...SCHEDULE.order];
  afterEach(() => {
    for (const k of Object.keys(SCHEDULE.pinned)) delete SCHEDULE.pinned[k];
    Object.assign(SCHEDULE.pinned, pinnedBackup);
    SCHEDULE.order.splice(0, SCHEDULE.order.length, ...orderBackup);
  });

  it('rotates through the schedule from the epoch', () => {
    const n = SCHEDULE.order.length;
    expect(dayIdFor(idAt(0))).toBe(SCHEDULE.order[0]);
    expect(dayIdFor(idAt(1))).toBe(SCHEDULE.order[1]);
    expect(dayIdFor(idAt(n - 1))).toBe(SCHEDULE.order[n - 1]);
    expect(dayIdFor(idAt(n))).toBe(SCHEDULE.order[0]);
    expect(dayIdFor(idAt(-1))).toBe(SCHEDULE.order[n - 1]);
  });

  it('is deterministic and self-describing', () => {
    const id = idAt(5);
    const a = resolveDaily(id);
    const b = resolveDaily(id);
    expect(a).toEqual(b);
    const day = DAYS[a.dayId];
    expect(a.dailyId).toBe(id);
    expect(a.seed).toBe(dailySeed(id, a.dayId, day.version));
    expect([...a.opponents].sort()).toEqual([...day.opponents].sort());
    expect(a.difficulty).toBe('standard');
    expect(a.contentVersion).toBe(SCHEDULE.contentVersion);
    expect(a.nextAt).toBe(nextDailyAt(id));
  });

  it('gives every date its own seed even when the authored day repeats', () => {
    const n = SCHEDULE.order.length;
    const ids = Array.from({ length: 2 * n }, (_, i) => idAt(i));
    expect(new Set(ids.map((id) => resolveDaily(id).seed)).size).toBe(ids.length);
    expect(resolveDaily(idAt(0)).dayId).toBe(resolveDaily(idAt(n)).dayId);
  });

  it('reseeds a date when the day version is bumped', () => {
    expect(dailySeed('2026-11-01', 'd001', 2)).not.toBe(dailySeed('2026-11-01', 'd001', 1));
    expect(dailySeed('2026-11-01', 'd001', 1)).toBe(dailySeed('2026-11-01', 'd001', 1));
  });

  it('pinned dates win over the rotation', () => {
    const id = idAt(7);
    const rotated = dayIdFor(id);
    const pinnedDay = SCHEDULE.order.find((d) => d !== rotated)!;
    SCHEDULE.pinned[id] = pinnedDay;
    expect(dayIdFor(id)).toBe(pinnedDay);
    expect(resolveDaily(id).dayId).toBe(pinnedDay);
    expect(dayIdFor(idAt(8))).toBe(orderBackup[8 % orderBackup.length]);
  });

  it('ignores a pin to a day that is not in the pool', () => {
    const id = idAt(9);
    SCHEDULE.pinned[id] = 'd999';
    expect(dayIdFor(id)).toBe(orderBackup[9 % orderBackup.length]);
  });

  it('appending days keeps the first rotation stable, and pins protect later dates', () => {
    const n = orderBackup.length;
    const before = Array.from({ length: n + 5 }, (_, i) => dayIdFor(idAt(i)));
    SCHEDULE.order.push('d998', 'd999');
    for (let i = 0; i < n; i++) expect(dayIdFor(idAt(i))).toBe(before[i]);
    // Dates after the first cycle move when the pool grows: that is why published dates are pinned before appending.
    expect(dayIdFor(idAt(n))).not.toBe(before[n]);
    for (let i = n; i < n + 5; i++) SCHEDULE.pinned[idAt(i)] = before[i];
    for (let i = 0; i < n + 5; i++) expect(dayIdFor(idAt(i))).toBe(before[i]);
  });

  it('rejects malformed ids', () => {
    expect(() => dayIdFor('2026-02-30')).toThrow(/Invalid daily id/);
    expect(() => resolveDaily('nope')).toThrow(/Invalid daily id/);
  });
});

describe('daily scenarios', () => {
  it('compiles the resolved day into a scenario with a daily id', () => {
    const id = idAt(2);
    const { scenario, resolution, day } = getDailyScenario(id);
    expect(scenario.id).toBe(`daily:${resolution.dayId}`);
    expect(isDailyScenarioId(scenario.id)).toBe(true);
    expect(day.id).toBe(resolution.dayId);
    expect(getDayScenario(resolution.dayId)).toBe(scenario);
    expect(() => getDayScenario('d999')).toThrow(/Unknown daily day/);
  });

  it('exposes the legacy spec shape derived from the v2 resolution', () => {
    const id = idAt(4);
    const spec = getDailySpecForKey(id);
    const res = resolveDaily(id);
    expect(spec.date).toBe(id);
    expect(spec.scenarioId).toBe(`daily:${res.dayId}`);
    expect(spec.seed).toBe(res.seed);
    expect(spec.opponents).toEqual(res.opponents);
    expect(spec.difficulty).toBe('standard');
    expect(spec.title).toBe(DAYS[res.dayId].title);
    expect(spec.simulatedBand.low).toBeLessThan(spec.simulatedBand.typical);
    expect(spec.simulatedBand.typical).toBeLessThan(spec.simulatedBand.high);
    expect(getDailySpecForKey(id)).toEqual(spec);
  });

  it('uses the UTC day for the date-based entry point', () => {
    const late = new Date('2026-11-05T23:59:00Z');
    const early = new Date('2026-11-05T00:01:00Z');
    expect(getDailySpec(late)).toEqual(getDailySpec(early));
    expect(getDailySpec(new Date('2026-11-06T00:01:00Z')).seed).not.toBe(getDailySpec(late).seed);
  });

  it('falls back to today for a malformed key', () => {
    expect(getDailySpecForKey('garbage').date).toBe(dailyIdFor(new Date()));
  });
});
