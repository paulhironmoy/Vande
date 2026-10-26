/**
 * Who gets which push, and when. Applied by the notify queue consumer to every message:
 *   1. global opt-out (notify_prefs.enabled = 0) drops everything;
 *   2. the room's settings: muted drops everything, "none" too, "important" keeps only important kinds;
 *   3. quiet hours (IST; default 22:00–08:00, per player): routine pushes are dropped, important ones wait until the
 *      quiet hours end (re-queued once with a delay, at most 12 hours);
 *   4. daily caps per player (IST day): routine pushes stop after NOTIFY_ROUTINE_PER_DAY (4), everything after
 *      NOTIFY_MAX_PER_DAY (8). Deadline reminders are additionally limited to one per player per match at the source.
 */
import type { Env } from '../env';
import { IMPORTANT_KINDS, type NotifyKind } from './messages';
import { istMinuteOfDay } from '../time';

export interface Quiet {
  start: number;
  end: number;
}

export function defaultQuietHours(env: Env): Quiet {
  const m = /^(\d\d):(\d\d)-(\d\d):(\d\d)$/.exec(env.NOTIFY_QUIET_HOURS ?? '22:00-08:00');
  if (!m) return { start: 22 * 60, end: 8 * 60 };
  return { start: Number(m[1]) * 60 + Number(m[2]), end: Number(m[3]) * 60 + Number(m[4]) };
}

/** A player's quiet hours: their own, none (-1), or the default when they never chose. */
export function quietOf(env: Env, row: { quiet_start: number | null; quiet_end: number | null } | null): Quiet | null {
  if (!row || row.quiet_start === null || row.quiet_end === null) return defaultQuietHours(env);
  if (row.quiet_start < 0 || row.quiet_end < 0) return null;
  return { start: row.quiet_start, end: row.quiet_end };
}

/** Minutes until the quiet hours end, or 0 when `nowMs` is outside them. Handles windows across midnight. */
export function minutesOfQuietLeft(quiet: Quiet | null, nowMs: number): number {
  if (!quiet) return 0;
  const m = istMinuteOfDay(nowMs);
  const inside = quiet.start < quiet.end ? m >= quiet.start && m < quiet.end : m >= quiet.start || m < quiet.end;
  if (!inside) return 0;
  return (quiet.end - m + 1440) % 1440 || 1440;
}

export function isImportant(kind: NotifyKind): boolean {
  return IMPORTANT_KINDS.has(kind);
}

export function caps(env: Env): { routine: number; total: number } {
  const n = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : d);
  return { routine: n(env.NOTIFY_ROUTINE_PER_DAY, 4), total: n(env.NOTIFY_MAX_PER_DAY, 8) };
}
