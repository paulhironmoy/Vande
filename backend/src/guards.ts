/**
 * Request guards shared by every route: a per-network limit (IPv4 /32, IPv6 /64) and a global ceiling across all
 * clients, through the Workers Rate Limiting bindings when configured or D1 buckets otherwise (see ratelimit.ts).
 */
import {
  DEFAULT_RATE_LIMIT_GLOBAL_READS_PER_MINUTE,
  DEFAULT_RATE_LIMIT_GLOBAL_WRITES_PER_MINUTE,
} from './contract';
import type { D1Like } from './d1';
import { json, limitKey } from './http';
import { checkLimit, type RateLimitBinding, type RateScope } from './ratelimit';

export interface GuardEnv {
  DB: D1Like;
  /** Secret: salts every rate-limit key. Without it writes are refused (503) unless ALLOW_UNLIMITED_WRITES=1. */
  RATE_SALT?: string;
  /** Explicit opt-out of write rate limiting for local development only. */
  ALLOW_UNLIMITED_WRITES?: string;
  RATE_LIMIT_GLOBAL_WRITES_PER_MINUTE?: string;
  RATE_LIMIT_GLOBAL_READS_PER_MINUTE?: string;
  /** Workers Rate Limiting binding for the global ceilings (keys 'all-writes' and 'all-reads'). */
  RL_GLOBAL?: RateLimitBinding;
}

export interface GuardRequest {
  ip: string;
  now: Date;
  cors: Record<string, string>;
  /** Per-network budget for this route, and its binding when configured. */
  scope: Extract<RateScope, 'write' | 'read' | 'dare'>;
  limit: number;
  binding?: RateLimitBinding;
}

let warnedUnlimited = false;

function numberOr(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const limited = (cors: Record<string, string>, error = 'rate limited') => json({ error }, 429, { ...cors, 'retry-after': '60' });

/**
 * Writes: refuse without a salt (unless explicitly allowed for local development), then the per-network limit, then
 * the global write ceiling. A request without an address is limited under one shared key, never unlimited.
 * Returns the error response, or null to go on.
 */
export async function guardWrite(env: GuardEnv, r: GuardRequest): Promise<Response | null> {
  if (!env.RATE_SALT) {
    if (env.ALLOW_UNLIMITED_WRITES !== '1') {
      return json({ error: 'service not configured', detail: 'RATE_SALT is not set; writes are disabled' }, 503, { ...r.cors, 'retry-after': '3600' });
    }
    if (!warnedUnlimited) {
      warnedUnlimited = true;
      console.warn('[vande-community] RATE_SALT is not set and ALLOW_UNLIMITED_WRITES=1: write rate limiting is OFF. Do not run this in production.');
    }
    return null;
  }
  const now = r.now.getTime();
  const per = await checkLimit({ db: env.DB, binding: r.binding, key: limitKey(r.ip), salt: env.RATE_SALT, scope: r.scope, limit: r.limit, now });
  if (!per.allowed) return limited(r.cors);
  const globalLimit = numberOr(env.RATE_LIMIT_GLOBAL_WRITES_PER_MINUTE, DEFAULT_RATE_LIMIT_GLOBAL_WRITES_PER_MINUTE);
  const all = await checkLimit({ db: env.DB, binding: env.RL_GLOBAL, key: 'all-writes', salt: env.RATE_SALT, scope: 'global-write', limit: globalLimit, now });
  return all.allowed ? null : limited(r.cors, 'busy, try again in a minute');
}

/**
 * Uncached reads: the per-network limit, then the global read ceiling. Without a salt reads are not limited (they are
 * served from the edge cache in production).
 */
export async function guardRead(env: GuardEnv, r: GuardRequest): Promise<Response | null> {
  if (!env.RATE_SALT) return null;
  const now = r.now.getTime();
  const per = await checkLimit({ db: env.DB, binding: r.binding, key: limitKey(r.ip), salt: env.RATE_SALT, scope: r.scope, limit: r.limit, now });
  if (!per.allowed) return limited(r.cors);
  const globalLimit = numberOr(env.RATE_LIMIT_GLOBAL_READS_PER_MINUTE, DEFAULT_RATE_LIMIT_GLOBAL_READS_PER_MINUTE);
  const all = await checkLimit({ db: env.DB, binding: env.RL_GLOBAL, key: 'all-reads', salt: env.RATE_SALT, scope: 'global-read', limit: globalLimit, now });
  return all.allowed ? null : limited(r.cors, 'busy, try again in a minute');
}
