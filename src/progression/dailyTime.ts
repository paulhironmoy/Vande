/**
 * Canonical daily time helpers (UTC day boundaries). Pure and dependency-free so screens can use them
 * before the engine's daily resolver lands; the engine remains the source of truth for `DailyResolution`.
 */
export const DAY_MS = 86_400_000;

/** Canonical daily id for a moment in time: the UTC calendar date `YYYY-MM-DD`. */
export function utcDailyId(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

/** Midnight UTC that starts the given daily id. */
export function dailyIdStart(dailyId: string): Date {
  const [y, m, d] = dailyId.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** ISO time of the next reset (00:00 UTC after `now`). */
export function nextResetAt(now: Date = new Date()): string {
  const start = dailyIdStart(utcDailyId(now));
  return new Date(start.getTime() + DAY_MS).toISOString();
}

/** Milliseconds until the next reset. */
export function msUntilReset(now: Date = new Date()): number {
  return Math.max(0, new Date(nextResetAt(now)).getTime() - now.getTime());
}

/** "5h 12m" / "42m" / "under a minute". */
export function formatCountdown(ms: number): string {
  const totalMin = Math.floor(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h <= 0 && m <= 0) return 'under a minute';
  if (h <= 0) return `${m}m`;
  return `${h}h ${m}m`;
}

/** Previous / next daily ids. */
export function shiftDailyId(dailyId: string, days: number): string {
  return utcDailyId(new Date(dailyIdStart(dailyId).getTime() + days * DAY_MS));
}

/** Whole days between two daily ids (b − a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((dailyIdStart(b).getTime() - dailyIdStart(a).getTime()) / DAY_MS);
}

/** "Friday 24 Oct" (the UTC date, written for people). */
export function dailyIdWords(dailyId: string, locale = 'en-GB'): string {
  const d = dailyIdStart(dailyId);
  return d.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/** Local wall-clock time at which the next daily arrives, e.g. "5:30 am". */
export function resetLocalTime(now: Date = new Date(), locale = 'en-GB'): string {
  return new Date(nextResetAt(now)).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
}
