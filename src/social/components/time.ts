/** Honest deadline text: public rule times from the server only, as a clock time plus "in 3 hours". */
import type { SocialT } from '../i18n';

/** Latin-script locales keep "9:30 pm"; Indic scripts name the part of the day in their own words ("रात 9:30"). */
const LATIN = new Set(['en', 'hi-Latn']);

/** The time-of-day options for this locale (src/screens/app/deadline.ts `clockText` is the reference). */
export function timeOptions(tr: Pick<SocialT, 'locale'>, withMinutes = true): Intl.DateTimeFormatOptions {
  if (LATIN.has(tr.locale)) return withMinutes ? { hour: '2-digit', minute: '2-digit' } : { hour: 'numeric' };
  return withMinutes ? { hour: 'numeric', minute: '2-digit', dayPeriod: 'short' } : { hour: 'numeric', dayPeriod: 'short' };
}

export function clockText(tr: SocialT, iso: string | null | undefined, now: number): string | null {
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  const sameDay = new Date(now).toDateString() === at.toDateString();
  const time = timeOptions(tr);
  return tr.date(at, sameDay ? time : { weekday: 'short', ...time });
}

/** When a room post was made, to the hour: "at 9 pm" today, else "Mon, 26 Oct, 9 pm" ("रात 9" in Hindi). */
export function postHourText(tr: SocialT, iso: string, now: number): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  const time = timeOptions(tr, false);
  const today = new Date(now).toDateString() === at.toDateString();
  return today ? tr.t('social.room.at_hour', { time: tr.date(at, time) }) : tr.date(at, { weekday: 'short', day: 'numeric', month: 'short', ...time });
}

export function untilText(tr: SocialT, iso: string | null | undefined, now: number): string | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  return Number.isFinite(at) ? tr.relative(at - now) : null;
}

export function isPast(iso: string | null | undefined, now: number): boolean {
  if (!iso) return false;
  const at = Date.parse(iso);
  return Number.isFinite(at) && at <= now;
}

/** "21:30 (in 3 hours)" or "21:30" once it has passed. */
export function deadlineText(tr: SocialT, iso: string | null | undefined, now: number): string {
  const clock = clockText(tr, iso, now) ?? '';
  const until = untilText(tr, iso, now);
  return until && !isPast(iso, now) ? tr.t('social.time.at_in', { clock, until }) : clock;
}

/** The IST calendar day (YYYY-MM-DD) of an instant: Daily days and Top 100 days are IST. */
export function istDay(ms: number): string {
  return new Date(ms + 5.5 * 3_600_000).toISOString().slice(0, 10);
}

export function previousDay(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}

/** 00:00 IST at the end of an IST day (18:30 UTC that date): when that day's Top 100 is decided. */
export function decidedAt(day: string): string {
  return new Date(Date.parse(`${day}T18:30:00Z`)).toISOString();
}
