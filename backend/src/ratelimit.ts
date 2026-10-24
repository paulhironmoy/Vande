import { SQL } from './sql';
import type { D1Like } from './d1';

export const WINDOW_MS = 60_000;

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Salted hash of the client address for the current one-minute window. The raw address is never stored.
 * `scope` separates write and read buckets so a burst of reads cannot block a submission (or vice versa).
 */
export async function bucketKey(ip: string, salt: string, windowStart: number, scope: 'write' | 'read' = 'write'): Promise<string> {
  return (await sha256Hex(`${salt}:${scope}:${ip}:${windowStart}`)).slice(0, 40);
}

export async function checkRateLimit(
  db: D1Like,
  ip: string,
  salt: string,
  limit: number,
  now = Date.now(),
  scope: 'write' | 'read' = 'write',
): Promise<{ allowed: boolean; count: number }> {
  const windowStart = Math.floor(now / WINDOW_MS) * WINDOW_MS;
  const key = await bucketKey(ip, salt, windowStart, scope);
  const row = await db.prepare(SQL.bumpBucket).bind(key, windowStart).first<{ count: number }>();
  const count = row?.count ?? 1;
  return { allowed: count <= limit, count };
}

export async function pruneRateBuckets(db: D1Like, now = Date.now()): Promise<void> {
  await db.prepare(SQL.pruneBuckets).bind(now - 24 * 60 * 60 * 1000).run();
}
