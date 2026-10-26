/**
 * Rate limits (salvaged from the previous Worker). Every per-network limit is keyed by `limitKey` (IPv4 /32, IPv6
 * /64), salted and hashed; the raw address is never stored or sent anywhere. Two backends:
 *   - a Workers Rate Limiting binding (preferred; `[[ratelimits]]` in wrangler.toml): no D1 writes, counted per
 *     Cloudflare location (approximate);
 *   - a D1 bucket per window in `rate_buckets` (fallback when the binding is absent or fails: tests, local runs).
 * Per-day caps always use D1 (bindings only allow 10 or 60 second periods).
 */
import type { D1Like, RateLimitBinding } from '../env';
import { SQL } from '../storage/sql';
import { sha256Hex } from '../security/crypto';
import { DAY_MS, MINUTE_MS } from '../config';

export type RateScope =
  | 'auth'
  | 'invite'
  | 'net-read'
  | 'net-write'
  | 'net-bat'
  | 'player-read'
  | 'player-write'
  | 'player-bat'
  | 'global-write'
  | 'global-read'
  | 'anon-global-write'
  | 'anon-global-read'
  | 'day-guest'
  | 'day-duel'
  | 'day-join'
  | 'day-cup'
  | 'day-notify';

/** A window's start minute in base 36, six characters, so bucket keys sort by time and cleanup deletes a key range. */
export function windowPrefix(ms: number): string {
  return Math.floor(ms / MINUTE_MS).toString(36).padStart(6, '0');
}

export async function bucketKey(key: string, salt: string, windowStart: number, scope: RateScope): Promise<string> {
  return `${windowPrefix(windowStart)}:${(await sha256Hex(`${salt}:${scope}:${key}:${windowStart}`)).slice(0, 32)}`;
}

/** D1 fallback: bumps the window's bucket and reports whether the count is still within `limit`. */
export async function checkRateLimit(db: D1Like, key: string, salt: string, limit: number, now: number, scope: RateScope, windowMs = MINUTE_MS): Promise<{ allowed: boolean; count: number }> {
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const bucket = await bucketKey(key, salt, windowStart, scope);
  const row = await db.prepare(SQL.bumpBucket).bind(bucket, windowStart).first<{ count: number }>();
  const count = row?.count ?? 1;
  return { allowed: count <= limit, count };
}

export interface LimitCheck {
  db: D1Like;
  binding?: RateLimitBinding;
  key: string;
  salt: string;
  scope: RateScope;
  /** Per-minute limit for the D1 fallback (a binding applies its own configured limit). */
  limit: number;
  now: number;
}

/** One per-minute check through the binding when configured, otherwise (or when the binding fails) a D1 bucket. */
export async function checkLimit(c: LimitCheck): Promise<{ allowed: boolean; via: 'binding' | 'd1' }> {
  if (c.binding) {
    try {
      const { success } = await c.binding.limit({ key: (await sha256Hex(`${c.salt}:${c.scope}:${c.key}`)).slice(0, 40) });
      return { allowed: success, via: 'binding' };
    } catch {
      /* a failing binding falls back to D1 rather than to "no limit" */
    }
  }
  const r = await checkRateLimit(c.db, c.key, c.salt, c.limit, c.now, c.scope);
  return { allowed: r.allowed, via: 'd1' };
}

/** A per-UTC-day cap (D1 bucket keyed by the day). */
export async function checkDailyCap(db: D1Like, key: string, salt: string, limit: number, now: number, scope: RateScope): Promise<boolean> {
  return (await checkRateLimit(db, key, salt, limit, now, scope, DAY_MS)).allowed;
}

// ---- cleanup ------------------------------------------------------------------------------------------------------

export const PRUNE_BATCH = 2000;

export interface PruneBudget {
  left: number;
  exhausted: boolean;
}

export function pruneBudget(maxQueries: number): PruneBudget {
  return { left: Math.max(1, Math.min(1000, Math.floor(maxQueries))), exhausted: false };
}

/** Runs a batched delete (`?1` cutoff, `?2` batch size) until a batch comes back short or the budget runs out. */
export async function pruneInBatches(db: D1Like, sql: string, cutoff: string | number, budget: PruneBudget, batch = PRUNE_BATCH): Promise<number> {
  let total = 0;
  for (;;) {
    if (budget.left <= 0) {
      budget.exhausted = true;
      return total;
    }
    budget.left--;
    const res = await db.prepare(sql).bind(cutoff, batch).run();
    const n = res.meta?.changes ?? 0;
    total += n;
    if (n < batch) return total;
  }
}

/** Buckets whose window started more than 24 hours ago (per-day buckets live until their day is a day old). */
export function pruneRateBuckets(db: D1Like, now: number, budget: PruneBudget): Promise<number> {
  return pruneInBatches(db, SQL.pruneBuckets, windowPrefix(now - 2 * DAY_MS), budget);
}
