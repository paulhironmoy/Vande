/**
 * Honest deadline text. Only public rule times from the server (lock and batting deadlines, reveal times, daily
 * reset) are ever shown, as "in 3 hours" plus the local clock time; never anything about when an opponent acted.
 */
import type { Translator } from '@/i18n';

export function untilText(t: Translator, iso: string | null | undefined, now: number): string | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return null;
  return t.relative(at - now);
}

/** Latin-script locales keep "9:30 pm"; Indic scripts name the part of the day in their own words ("रात 9:30"). */
const LATIN = new Set(['en', 'hi-Latn']);

/** "21:30" (or "Tue 21:30" when not today) in the device's time zone, in the locale's own way of telling time. */
export function clockText(t: Translator, iso: string | null | undefined, now: number): string | null {
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  const sameDay = new Date(now).toDateString() === at.toDateString();
  const time: Intl.DateTimeFormatOptions = LATIN.has(t.locale) ? { hour: '2-digit', minute: '2-digit' } : { hour: 'numeric', minute: '2-digit', dayPeriod: 'short' };
  return t.date(at, sameDay ? time : { weekday: 'short', ...time });
}

export function isPast(iso: string | null | undefined, now: number): boolean {
  if (!iso) return false;
  const at = Date.parse(iso);
  return Number.isFinite(at) && at <= now;
}
