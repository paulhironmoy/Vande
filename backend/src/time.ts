/** India Standard Time (UTC+05:30, no daylight saving): Daily Six days, quiet hours and reminders. */
import { DAY_MS, HOUR_MS, MINUTE_MS } from './config';
import { dayIso } from './http/http';

export const IST_OFFSET_MS = 5.5 * HOUR_MS;

/** The IST calendar day (YYYY-MM-DD) of an instant. */
export function istDay(ms: number): string {
  return dayIso(ms + IST_OFFSET_MS);
}

/** UTC ms of the next 00:00 IST after `ms` (the Daily Six reset). */
export function nextIstMidnight(ms: number): number {
  return Math.floor((ms + IST_OFFSET_MS) / DAY_MS) * DAY_MS + DAY_MS - IST_OFFSET_MS;
}

/** Minutes since 00:00 IST. */
export function istMinuteOfDay(ms: number): number {
  return Math.floor(((ms + IST_OFFSET_MS) % DAY_MS) / MINUTE_MS);
}

export function previousDay(day: string): string {
  return dayIso(Date.parse(`${day}T00:00:00Z`) - DAY_MS);
}

export function isIsoDay(day: unknown): day is string {
  return typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) && dayIso(Date.parse(`${day}T00:00:00Z`)) === day;
}

/** The last `n` IST days ending with `day` (oldest first). */
export function daysEnding(day: string, n: number): string[] {
  const end = Date.parse(`${day}T00:00:00Z`);
  return Array.from({ length: n }, (_, i) => dayIso(end - (n - 1 - i) * DAY_MS));
}
