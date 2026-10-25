/**
 * Rate limits. Every limit is keyed by the network (`limitKey`: IPv4 /32, IPv6 /64), salted and hashed; the raw
 * address is never stored or sent anywhere.
 *
 * Two backends:
 *   - a Workers Rate Limiting binding (preferred; configured in wrangler.toml): counters live in Cloudflare's
 *     limiter, cost no D1 writes, and are kept per Cloudflare location (approximate, eventually consistent);
 *   - a D1 bucket per window in `rate_buckets` (fallback when the binding is absent: tests, local development),
 *     pruned once older than 24 hours.
 * Per-day limits (the goal cap) always use D1: bindings only allow 10 or 60 second periods.
 */
import { DEFAULT_CLEANUP_MAX_QUERIES } from './contract';
import { SQL } from './sql';
import type { D1Like } from './d1';

export const WINDOW_MS = 60_000;

/** One UTC day, for per-day buckets (the goal cap). Pruned with the minute buckets once older than 24 hours. */
export const DAY_MS = 86_400_000;

export type RateScope = 'write' | 'read' | 'dare' | 'goal' | 'global-write' | 'global-read';

/** The Workers Rate Limiting API binding (`[[ratelimits]]` in wrangler.toml). */
export interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** A window's start minute in base 36, six characters (enough for thousands of years), so prefixes sort by time. */
export function windowPrefix(ms: number): string {
  return Math.floor(ms / WINDOW_MS).toString(36).padStart(6, '0');
}

/**
 * Bucket for a limit key (from `limitKey`) in one window: the window's minute, then a salted hash of scope, key and
 * window. Keys sort by window, so the cleanup deletes a key range instead of scanning the table. `scope` separates the
 * budgets so a burst of one kind of request cannot block another.
 */
export async function bucketKey(key: string, salt: string, windowStart: number, scope: RateScope = 'write'): Promise<string> {
  return `${windowPrefix(windowStart)}:${(await sha256Hex(`${salt}:${scope}:${key}:${windowStart}`)).slice(0, 32)}`;
}

/** D1 fallback: bumps the window's bucket and reports whether the count is still within `limit`. */
export async function checkRateLimit(
  db: D1Like,
  key: string,
  salt: string,
  limit: number,
  now = Date.now(),
  scope: RateScope = 'write',
  windowMs: number = WINDOW_MS,
): Promise<{ allowed: boolean; count: number }> {
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const bucket = await bucketKey(key, salt, windowStart, scope);
  const row = await db.prepare(SQL.bumpBucket).bind(bucket, windowStart).first<{ count: number }>();
  const count = row?.count ?? 1;
  return { allowed: count <= limit, count };
}

export interface LimitCheck {
  db: D1Like;
  /** When present, the binding decides (its own limit and period apply) and D1 is not touched. */
  binding?: RateLimitBinding;
  /** A `limitKey` result, or a fixed key for global ceilings. */
  key: string;
  salt: string;
  scope: RateScope;
  /** Per-minute limit for the D1 fallback. */
  limit: number;
  now: number;
}

/** One per-minute check through the binding when configured, otherwise through a D1 bucket. */
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

/** Rows deleted per cleanup statement. */
export const PRUNE_BATCH = 2000;

/** D1 statements left for one cleanup run, shared by every table; `exhausted` once a table had to stop early. */
export interface PruneBudget {
  left: number;
  exhausted: boolean;
}

/** A run's budget from `CLEANUP_MAX_QUERIES` (default 45), between 1 and D1's 1,000 queries per invocation. */
export function pruneBudget(raw?: string): PruneBudget {
  const n = Math.floor(Number(raw ?? DEFAULT_CLEANUP_MAX_QUERIES));
  return { left: Number.isFinite(n) && n >= 1 ? Math.min(n, 1000) : DEFAULT_CLEANUP_MAX_QUERIES, exhausted: false };
}

/**
 * Runs a batched delete (`?1` cutoff, `?2` batch size) until a batch comes back short or the budget runs out. The
 * statement must seek by key or index (see SQL.prune*), so each batch reads about what it deletes. Returns rows deleted.
 */
export async function pruneInBatches(db: D1Like, sql: string, cutoff: string | number, budget = pruneBudget(), batch = PRUNE_BATCH): Promise<number> {
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

/**
 * pruneInBatches for a table whose keys are in random order (lite_attempts): `?3` is a cursor on the leading key
 * column, which the statement returns as `k`, so each batch continues where the last one stopped and a run reads the
 * table once instead of rescanning it from the start for every batch.
 */
export async function pruneByCursor(db: D1Like, sql: string, cutoff: string, budget = pruneBudget(), batch = PRUNE_BATCH): Promise<number> {
  let total = 0;
  let cursor = '';
  for (;;) {
    if (budget.left <= 0) {
      budget.exhausted = true;
      return total;
    }
    budget.left--;
    const { results } = await db.prepare(sql).bind(cutoff, batch, cursor).all<{ k: string }>();
    total += results.length;
    if (results.length < batch) return total;
    for (const r of results) if (r.k > cursor) cursor = r.k;
  }
}

/** Buckets whose window started more than 24 hours ago: a key range, since keys start with the window's minute. */
export async function pruneRateBuckets(db: D1Like, now = Date.now(), budget = pruneBudget()): Promise<number> {
  return pruneInBatches(db, SQL.pruneBuckets, windowPrefix(now - DAY_MS), budget);
}
