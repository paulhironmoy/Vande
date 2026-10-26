/** Tunables with defaults; every value can be overridden per deployment in wrangler.toml [vars]. */
import type { Env } from './env';

export const MINUTE_MS = 60_000;
export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;

export const ACCESS_TOKEN_TTL_S = 15 * 60;
/** Refresh families expire after this much inactivity (each rotation extends it). Guest accounts depend on it. */
export const REFRESH_IDLE_DAYS = 365;
/** A refresh token just rotated may be presented again this long (lost response) and gets a fresh successor. */
export const REFRESH_GRACE_MS = 2 * MINUTE_MS;
/** Idempotency records are replayable this long. */
export const IDEMPOTENCY_TTL_MS = DAY_MS;
/** A pending idempotency record older than this is considered abandoned (the Worker died mid-request). */
export const IDEMPOTENCY_PENDING_MS = MINUTE_MS;
export const EXPORT_TTL_MS = DAY_MS;
export const AUDIT_RETENTION_DAYS = 180;
export const DELETED_ACCOUNT_TOMBSTONE_DAYS = 30;
export const MATCH_INDEX_RETENTION_DAYS = 400;

/** Body limits in bytes. A sealed over carries seven gesture traces of up to 120 samples. */
export const BODY_LIMITS = { default: 4 * 1024, lock: 48 * 1024, shot: 8 * 1024 } as const;

export const MAX_GROUP_MEMBERSHIPS = 4;
export const MAX_PUSH_TOKENS = 5;
export const MAX_MATCH_LIST = 50;
/** Invalid shot submissions tolerated on one outstanding ball before it resolves as a leave. */
export const MAX_INVALID_SHOTS = 3;
/** clientElapsedMs may exceed the server-measured time since the reveal by at most this much. */
export const CLIENT_CLOCK_SLACK_MS = 2_000;
/**
 * Late answers plus missed balls (shown, then settled as leaves: the answer window expired, too many invalid answers,
 * or the batting deadline) tolerated in one innings. The Top 100 rule (`TOP100.maxLateAnswers` in src/engine/ranking.ts,
 * which is given the same count as `lateAnswers`), applied to the Daily Six boards too.
 */
export const MAX_IRREGULAR_BALLS = 1;

/** Origin of the web app (PUBLIC_WEB_ORIGIN): the invite, highlight and shared-match links the Worker builds. */
export function publicWebOrigin(env: Env): string {
  return env.PUBLIC_WEB_ORIGIN ?? 'https://vande.cricket';
}

function num(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  if (raw === undefined || raw === '' || !Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** IPv6 prefix that counts as one network for anonymous routes (sign-up, invite lookups, public pages). */
export type AnonV6Prefix = 48 | 56 | 64;

/** "60-600" (seconds, a range) or "0" (off; local development and tests): the activity jitter, see below. */
export function parseJitter(raw: string | undefined): { minMs: number; maxMs: number } {
  const m = /^\s*(\d{1,5})(?:\s*-\s*(\d{1,5}))?\s*$/.exec(raw ?? '');
  if (!m) return { minMs: 60_000, maxMs: 600_000 };
  const lo = Number(m[1]) * 1000;
  const hi = Number(m[2] ?? m[1]) * 1000;
  return { minMs: Math.min(lo, hi), maxMs: Math.max(lo, hi) };
}

export interface Config {
  production: boolean;
  version: string;
  duelLockMs: number;
  duelBatMs: number;
  /**
   * Activity jitter: a lock or a finished innings becomes visible to the opponent, the cup and the room (and the
   * "opponent locked" push arrives) this long after it happened, chosen at random per event (ACTIVITY_JITTER_S).
   */
  activityJitter: { minMs: number; maxMs: number };
  /** Duels reveal at the next whole slot (DUEL_REVEAL_SLOT_S, 300 s) at least 60 s after both innings end; 0: at once. */
  duelRevealSlotMs: number;
  /** Anonymous routes group IPv6 addresses by this prefix (ANON_IPV6_PREFIX: 48, 56 or 64; default 56). */
  anonV6Prefix: AnonV6Prefix;
  /** A revealed ball must be answered (the shot made) within this long. */
  ballLiveMs: number;
  /** A shot made in time but delivered late (queued offline) is accepted until this long after the reveal. */
  ballLateMs: number;
  rate: {
    net: number;
    auth: number;
    invite: number;
    player: number;
    globalWrites: number;
    globalReads: number;
    /** Separate, smaller global budgets for anonymous traffic (and failed sign-ins), so it is shed first. */
    anonGlobalWrites: number;
    anonGlobalReads: number;
    guestsPerNetworkPerDay: number;
    duelsPerPlayerPerDay: number;
    groupJoinsPerPlayerPerDay: number;
  };
  cleanupMaxQueries: number;
  locationHint: string | undefined;
}

export function readConfig(env: Env): Config {
  return {
    production: (env.ENVIRONMENT ?? 'production') === 'production',
    version: env.VERSION ?? 'dev',
    duelLockMs: num(env.DUEL_LOCK_HOURS, 24, 1, 24 * 14) * HOUR_MS,
    duelBatMs: num(env.DUEL_BAT_HOURS, 24, 1, 24 * 14) * HOUR_MS,
    activityJitter: parseJitter(env.ACTIVITY_JITTER_S),
    duelRevealSlotMs: Math.floor(num(env.DUEL_REVEAL_SLOT_S, 300, 0, 3600)) * 1000,
    anonV6Prefix: env.ANON_IPV6_PREFIX === '48' ? 48 : env.ANON_IPV6_PREFIX === '64' ? 64 : 56,
    ballLiveMs: num(env.BALL_LIVE_MS, 20_000, 5_000, 120_000),
    ballLateMs: num(env.BALL_LATE_MS, 10 * MINUTE_MS, 30_000, 60 * MINUTE_MS),
    rate: {
      net: num(env.RATE_NET_PER_MINUTE, 600, 1, 1_000_000),
      auth: num(env.RATE_AUTH_PER_MINUTE, 30, 1, 1_000_000),
      invite: num(env.RATE_INVITE_PER_MINUTE, 60, 1, 1_000_000),
      player: num(env.RATE_PLAYER_PER_MINUTE, 120, 1, 1_000_000),
      globalWrites: num(env.RATE_GLOBAL_WRITES_PER_MINUTE, 3000, 1, 10_000_000),
      globalReads: num(env.RATE_GLOBAL_READS_PER_MINUTE, 6000, 1, 10_000_000),
      anonGlobalWrites: num(env.RATE_ANON_GLOBAL_WRITES_PER_MINUTE, 1000, 1, 10_000_000),
      anonGlobalReads: num(env.RATE_ANON_GLOBAL_READS_PER_MINUTE, 2000, 1, 10_000_000),
      guestsPerNetworkPerDay: num(env.GUESTS_PER_NETWORK_PER_DAY, 300, 1, 1_000_000),
      duelsPerPlayerPerDay: num(env.DUELS_PER_PLAYER_PER_DAY, 100, 1, 100_000),
      groupJoinsPerPlayerPerDay: num(env.GROUP_JOINS_PER_PLAYER_PER_DAY, 20, 1, 10_000),
    },
    cleanupMaxQueries: Math.floor(num(env.CLEANUP_MAX_QUERIES, 200, 1, 1000)),
    locationHint: env.DO_LOCATION_HINT || undefined,
  };
}
