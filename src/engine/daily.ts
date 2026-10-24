/**
 * Daily Quick Play resolution. The canonical daily id is the UTC calendar date (`YYYY-MM-DD`): everyone in the
 * world resolving the same id receives the same crisis, and a new one starts at 00:00 UTC.
 */
import type { DailyCrisis, DailyId, DailyResolution, DailySpec, OpponentId, Scenario } from './types';
import { OPPONENT_IDS } from './types';
import { createRng, hashString, rngInt } from './prng';
import { compileDaily, dailyScenarioId } from './dailyCompiler';
import { DAILY_CONTENT_VERSION, DAYS, SCHEDULE } from '../content/daily';

export { DAILY_CONTENT_VERSION, dailyScenarioId };

const ID_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

/** Canonical daily id for an instant: the UTC date. */
export function dailyIdFor(date: Date): DailyId {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

/** @deprecated Local calendar day; kept for legacy records. Use `dailyIdFor`. */
export function dateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function isDailyId(value: string): value is DailyId {
  const m = ID_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  return back.getUTCFullYear() === y && back.getUTCMonth() === mo - 1 && back.getUTCDate() === d;
}

/** Whole days since 1970-01-01 UTC. */
export function dayIndex(dailyId: DailyId): number {
  const m = ID_RE.exec(dailyId);
  if (!m) throw new Error(`Invalid daily id '${dailyId}'`);
  return Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY_MS);
}

/** ISO instant at which the daily after `dailyId` becomes available (00:00 UTC of the next day). */
export function nextDailyAt(dailyId: DailyId): string {
  return new Date((dayIndex(dailyId) + 1) * DAY_MS).toISOString();
}

export function dailySeed(dailyId: DailyId, dayId: string, version: number): number {
  return hashString(`vande-daily-v2:${dailyId}:${dayId}:${version}`);
}

/** Which authored day a canonical id maps to: pinned assignments win; otherwise the schedule rotates from its epoch. */
export function dayIdFor(dailyId: DailyId): string {
  if (!isDailyId(dailyId)) throw new Error(`Invalid daily id '${dailyId}'`);
  const pinned = SCHEDULE.pinned[dailyId];
  if (pinned && DAYS[pinned]) return pinned;
  const n = SCHEDULE.order.length;
  if (n === 0) throw new Error('Daily schedule is empty');
  const offset = dayIndex(dailyId) - dayIndex(SCHEDULE.epoch);
  return SCHEDULE.order[((offset % n) + n) % n];
}

export function resolveDaily(dailyId: DailyId): DailyResolution {
  const dayId = dayIdFor(dailyId);
  const day = DAYS[dayId];
  if (!day) throw new Error(`Daily day '${dayId}' is missing from the content index`);
  return {
    dailyId,
    dayId,
    seed: dailySeed(dailyId, dayId, day.version),
    opponents: OPPONENT_IDS.filter((id) => day.opponents.includes(id)),
    difficulty: 'standard',
    contentVersion: DAILY_CONTENT_VERSION,
    nextAt: nextDailyAt(dailyId),
  };
}

const compiled = new Map<string, Scenario>();

/** Compiled scenario for an authored day (memoised; compilation is pure). */
export function getDayScenario(dayId: string): Scenario {
  const cached = compiled.get(dayId);
  if (cached) return cached;
  const day = DAYS[dayId];
  if (!day) throw new Error(`Unknown daily day '${dayId}'`);
  const scenario = compileDaily(day);
  compiled.set(dayId, scenario);
  return scenario;
}

export function getDailyScenario(dailyId: DailyId): { scenario: Scenario; resolution: DailyResolution; day: DailyCrisis } {
  const resolution = resolveDaily(dailyId);
  return { scenario: getDayScenario(resolution.dayId), resolution, day: DAYS[resolution.dayId] };
}

export function getDailyDay(dayId: string): DailyCrisis | undefined {
  return DAYS[dayId];
}

export function listDailyDays(): DailyCrisis[] {
  return SCHEDULE.order.map((id) => DAYS[id]).filter((d): d is DailyCrisis => Boolean(d));
}

/** Legacy spec shape used by the current daily screens; derived from the v2 resolution. */
export function getDailySpecForKey(key: string): DailySpec {
  const id = isDailyId(key) ? key : dailyIdFor(new Date());
  const res = resolveDaily(id);
  const day = DAYS[res.dayId];
  let rng = createRng(res.seed);
  const low = rngInt(rng, 45, 60);
  rng = low.next;
  const typical = rngInt(rng, 60, 75);
  rng = typical.next;
  const high = rngInt(rng, 78, 92);
  return {
    date: id,
    scenarioId: dailyScenarioId(res.dayId),
    seed: res.seed,
    difficulty: res.difficulty,
    opponents: res.opponents as OpponentId[],
    title: day.title,
    simulatedBand: { low: low.value, typical: typical.value, high: high.value },
  };
}

/** Today's daily (UTC). */
export function getDailySpec(date: Date): DailySpec {
  return getDailySpecForKey(dailyIdFor(date));
}
