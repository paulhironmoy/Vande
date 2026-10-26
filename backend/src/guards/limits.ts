/**
 * Request guards: a per-network limit (IPv4 /32; IPv6 /64 for signed-in routes and a shorter prefix, /56 by default,
 * for anonymous ones), a per-player limit for signed-in routes, and global ceilings that address rotation cannot pass.
 * Per-network limits are generous because Indian mobile carriers put many players behind one IPv4 (CGNAT) and college
 * Wi-Fi does the same; the per-player limit is the real control for signed-in traffic.
 *
 * Two global budgets: anonymous traffic (sign-up, invite lookups, public pages, the signed render API before its
 * signature is checked) and failed sign-ins spend a smaller anonymous budget, checked before anything else; signed-in
 * traffic spends its own budget, checked only after the bearer token was verified. A flood of anonymous or forged
 * requests is therefore shed first and can never use up what signed-in players need.
 */
import type { Config } from '../config';
import type { D1Like, Env, RateLimitBinding } from '../env';
import { fail } from '../http/errors';
import { limitKey } from '../http/http';
import type { Metrics } from '../ops/metrics';
import { checkDailyCap, checkLimit, type RateScope } from './ratelimit';

export type LimitScope = 'auth' | 'invite' | 'read' | 'write' | 'bat' | 'none';

/** Who is asking: an anonymous request, or one whose route needs a verified signed-in player (or admin). */
export type Caller = 'anonymous' | 'signed';

export interface GuardContext {
  env: Env;
  cfg: Config;
  metrics: Metrics;
  /** Null only when limits are explicitly off for local development. */
  salt: string | null;
  ip: string;
  uid?: string;
  now: number;
}

function limited(metrics: Metrics, scope: string): never {
  metrics.count('rate_limited', [scope]);
  return fail('rate_limited', 'too many requests, try again in a minute', { headers: { 'retry-after': '60' } });
}

async function one(db: D1Like, salt: string, now: number, metrics: Metrics, binding: RateLimitBinding | undefined, key: string, scope: RateScope, limit: number): Promise<void> {
  const r = await checkLimit({ db, binding, key, salt, scope, limit, now });
  if (!r.allowed) limited(metrics, scope);
}

/** The network key a caller's limits use (anonymous routes group IPv6 by the shorter, configured prefix). */
export function networkKey(cfg: Config, ip: string, caller: Caller): string {
  return limitKey(ip, caller === 'anonymous' ? cfg.anonV6Prefix : 64);
}

/** Per-network limit, before authentication (so a flood of bad tokens is limited like any other traffic). */
export async function enforceNetworkLimit(g: GuardContext, scope: LimitScope, caller: Caller): Promise<void> {
  if (scope === 'none' || g.salt === null) return;
  const { env, cfg, salt, now, metrics } = g;
  const net = networkKey(cfg, g.ip, caller);
  if (scope === 'auth') await one(env.DB, salt, now, metrics, env.RL_AUTH, net, 'auth', cfg.rate.auth);
  else if (scope === 'invite') await one(env.DB, salt, now, metrics, env.RL_INVITE, net, 'invite', cfg.rate.invite);
  else await one(env.DB, salt, now, metrics, env.RL_NET, net, `net-${scope}`, cfg.rate.net);
}

function globalBucket(scope: LimitScope, caller: Caller, cfg: Config, env: Env): { key: string; scope: RateScope; limit: number; binding: RateLimitBinding | undefined } {
  const isRead = scope === 'read' || scope === 'invite';
  if (caller === 'anonymous') {
    return { key: isRead ? 'anon-reads' : 'anon-writes', scope: isRead ? 'anon-global-read' : 'anon-global-write', limit: isRead ? cfg.rate.anonGlobalReads : cfg.rate.anonGlobalWrites, binding: env.RL_GLOBAL_ANON };
  }
  return { key: isRead ? 'all-reads' : 'all-writes', scope: isRead ? 'global-read' : 'global-write', limit: isRead ? cfg.rate.globalReads : cfg.rate.globalWrites, binding: env.RL_GLOBAL };
}

/**
 * The global ceiling of the caller's class: anonymous requests before anything else, signed-in requests after their
 * token was verified (and after the per-player limit).
 */
export async function enforceGlobal(g: GuardContext, scope: LimitScope, caller: Caller): Promise<void> {
  if (scope === 'none' || g.salt === null) return;
  const b = globalBucket(scope, caller, g.cfg, g.env);
  const r = await checkLimit({ db: g.env.DB, binding: b.binding, key: b.key, salt: g.salt, scope: b.scope, limit: b.limit, now: g.now });
  if (!r.allowed) {
    g.metrics.count('rate_limited', [caller === 'anonymous' ? 'global-anon' : 'global']);
    fail('rate_limited', 'busy, try again in a minute', { headers: { 'retry-after': '60' } });
  }
}

/** A request that failed to sign in spends the anonymous budget (forged tokens are shed with anonymous traffic). */
export async function chargeAnonymous(g: GuardContext, scope: LimitScope): Promise<void> {
  if (scope === 'none' || g.salt === null) return;
  const b = globalBucket(scope, 'anonymous', g.cfg, g.env);
  await checkLimit({ db: g.env.DB, binding: b.binding, key: b.key, salt: g.salt, scope: b.scope, limit: b.limit, now: g.now }).catch(() => undefined);
}

/** Per-account limit for signed-in routes (reads get twice the budget). */
export async function enforcePlayerLimit(g: GuardContext, scope: LimitScope): Promise<void> {
  if (g.salt === null || !g.uid || (scope !== 'read' && scope !== 'write' && scope !== 'bat')) return;
  await one(g.env.DB, g.salt, g.now, g.metrics, g.env.RL_PLAYER, `u:${g.uid}`, `player-${scope}`, scope === 'read' ? g.cfg.rate.player * 2 : g.cfg.rate.player);
}

/** Per-day caps (D1): guest sign-ups per network, duels created per player, group joins per player. */
export async function enforceDailyCap(g: GuardContext, scope: 'day-guest' | 'day-duel' | 'day-join' | 'day-cup', key: string, limit: number): Promise<void> {
  if (g.salt === null) return;
  if (!(await checkDailyCap(g.env.DB, key, g.salt, limit, g.now, scope))) limited(g.metrics, scope);
}

export { limitKey };
