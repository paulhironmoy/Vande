/**
 * YouTube Data API quota: a daily allowance (YT_DAILY_QUOTA, default 10,000 units) reset at midnight Pacific time.
 * Uploads (YT_UNITS_PER_UPLOAD, default 1,600) may use only (1 − YT_HEADROOM) of it (headroom at least 20 %, so
 * removals, privacy changes and statistics always have room); removals may use the headroom. Reservations are atomic in
 * D1, so concurrent uploads never overspend; an upload that does not fit is scheduled for the next quota day.
 */
import type { D1Like, Env } from '../env';

export interface QuotaConfig {
  daily: number;
  perUpload: number;
  headroom: number;
  /** Units uploads may use per quota day. */
  usable: number;
  perUpdate: number;
  perDelete: number;
  perList: number;
}

function num(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  if (raw === undefined || raw === '' || !Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function quotaConfig(env: Env): QuotaConfig {
  const daily = Math.floor(num(env.YT_DAILY_QUOTA, 10_000, 1, 100_000_000));
  const perUpload = Math.floor(num(env.YT_UNITS_PER_UPLOAD, 1_600, 1, 1_000_000));
  const headroom = num(env.YT_HEADROOM, 0.2, 0.2, 0.9);
  return { daily, perUpload, headroom, usable: Math.floor(daily * (1 - headroom)), perUpdate: 50, perDelete: 50, perList: 1 };
}

/** How many uploads fit in one quota day. */
export function uploadsPerDay(q: QuotaConfig): number {
  return Math.floor(q.usable / q.perUpload);
}

const PT = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });

function ptParts(ms: number): { y: number; m: number; d: number; h: number; mi: number; s: number } {
  const p = Object.fromEntries(PT.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), h: Number(p.hour) % 24, mi: Number(p.minute), s: Number(p.second) };
}

/** Pacific wall-clock offset from UTC at an instant (−7 h in summer, −8 h in winter). */
function ptOffsetMs(ms: number): number {
  const p = ptParts(ms);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000;
}

/** The Pacific calendar day of an instant: the YouTube quota day. */
export function pacificDay(ms: number): string {
  const p = ptParts(ms);
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

/** UTC ms of the next midnight Pacific time after `ms` (handles the daylight-saving switches). */
export function nextPacificMidnight(ms: number): number {
  const p = ptParts(ms);
  const wall = Date.UTC(p.y, p.m - 1, p.d + 1, 0, 0, 0);
  let guess = wall - ptOffsetMs(ms);
  guess = wall - ptOffsetMs(guess);
  return guess;
}

/**
 * Atomically reserves one upload on a quota day: uploads together stay within the quota minus the headroom, and all
 * calls together within the quota (removals and statistics spend the headroom, never the upload budget).
 */
export async function reserveUpload(db: D1Like, qday: string, q: QuotaConfig): Promise<boolean> {
  if (q.perUpload > q.usable) return false;
  const row = await db
    .prepare('INSERT INTO yt_quota (qday, used, uploads) VALUES (?1, ?2, ?2) ON CONFLICT (qday) DO UPDATE SET used = used + excluded.used, uploads = uploads + excluded.uploads WHERE uploads + excluded.uploads <= ?3 AND used + excluded.used <= ?4 RETURNING used')
    .bind(qday, q.perUpload, q.usable, q.daily)
    .first<{ used: number }>();
  return row !== null;
}

/** Reserves `units` for another call (removal, privacy change, statistics) within the whole daily quota. */
export async function reserveUnits(db: D1Like, qday: string, units: number, q: QuotaConfig): Promise<boolean> {
  if (units > q.daily) return false;
  const row = await db
    .prepare('INSERT INTO yt_quota (qday, used, uploads) VALUES (?1, ?2, 0) ON CONFLICT (qday) DO UPDATE SET used = used + excluded.used WHERE used + excluded.used <= ?3 RETURNING used')
    .bind(qday, units, q.daily)
    .first<{ used: number }>();
  return row !== null;
}

/** YouTube said the quota is spent (another client, a miscount): treat the day as full. */
export async function exhaustDay(db: D1Like, qday: string, q: QuotaConfig): Promise<void> {
  await db.prepare('INSERT INTO yt_quota (qday, used, uploads) VALUES (?1, ?2, ?3) ON CONFLICT (qday) DO UPDATE SET used = MAX(used, excluded.used), uploads = MAX(uploads, excluded.uploads)').bind(qday, q.daily, q.usable).run();
}

export async function usedOn(db: D1Like, qday: string): Promise<{ used: number; uploads: number }> {
  const r = await db.prepare('SELECT used, uploads FROM yt_quota WHERE qday = ?1').bind(qday).first<{ used: number; uploads: number }>();
  return { used: r?.used ?? 0, uploads: r?.uploads ?? 0 };
}
