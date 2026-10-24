/**
 * VANDE community API — Cloudflare Worker + D1.
 *   POST /v1/daily/:dailyId/results   accept one anonymous official result (deduped per day per install)
 *   GET  /v1/daily/:dailyId/stats     aggregate stats (percentages only from MIN_COHORT results)
 *   GET  /v1/health
 * No framework, no cookies, no raw IP storage. See backend/README.md and docs/BACKEND.md.
 */
import {
  DEFAULT_MIN_COHORT,
  DEFAULT_RATE_LIMIT_PER_MINUTE,
  DEFAULT_RATE_LIMIT_READS_PER_MINUTE,
  MAX_BODY_BYTES,
  RESULT_RETENTION_DAYS,
  STATS_CACHE_SECONDS,
} from './contract';
import { corsHeaders, originAllowed, parseOrigins } from './cors';
import type { D1Like } from './d1';
import { checkRateLimit, pruneRateBuckets } from './ratelimit';
import { SQL, jsonPath } from './sql';
import { aggregatesFromStatsRow, bandOf, publicStats, strategyClass, type Aggregates, type CountRow, type StatsRow } from './stats';
import { isRealUtcDate, validateSubmission } from './validate';

export interface Env {
  DB: D1Like;
  ALLOWED_ORIGINS?: string;
  MIN_COHORT?: string;
  CONTENT_VERSIONS?: string;
  RATE_LIMIT_PER_MINUTE?: string;
  RATE_LIMIT_READS_PER_MINUTE?: string;
  /** Secret (wrangler secret put RATE_SALT). Without it, writes are refused (503) unless ALLOW_UNLIMITED_WRITES=1. */
  RATE_SALT?: string;
  /** Explicit opt-out of write rate limiting for local development only. */
  ALLOW_UNLIMITED_WRITES?: string;
  VERSION?: string;
}

/** The slice of the Cache API the worker uses (so tests can stub it). */
export interface CacheLike {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

export interface HandlerOptions {
  now?: () => Date;
  /** Edge cache for stats responses; omitted = no caching (tests, local dev). */
  cache?: CacheLike;
  /** Lets the cache write outlive the response (Cloudflare `ctx.waitUntil`). */
  waitUntil?: (p: Promise<unknown>) => void;
}

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };

function json(body: unknown, status: number, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extra } });
}

function receivedHour(now: Date): string {
  const d = new Date(now);
  d.setUTCMinutes(0, 0, 0);
  return d.toISOString();
}

let warnedUnlimited = false;

/** Fallback only: scans the day's rows when no incremental `daily_stats` row exists (pre-migration data). */
async function fullAggregates(db: D1Like, dailyId: string, contentVersion: string): Promise<Aggregates> {
  const [count, bands, outcomes, strategies, scores] = await Promise.all([
    db.prepare(SQL.countForDay).bind(dailyId, contentVersion).first<{ n: number }>(),
    db.prepare(SQL.bandsForDay).bind(dailyId, contentVersion).all<CountRow>(),
    db.prepare(SQL.outcomesForDay).bind(dailyId, contentVersion).all<CountRow>(),
    db.prepare(SQL.strategiesForDay).bind(dailyId, contentVersion).all<CountRow>(),
    db.prepare(SQL.scoresForDay).bind(dailyId, contentVersion).all<CountRow>(),
  ]);
  return { count: Number(count?.n ?? 0), bands: bands.results, outcomes: outcomes.results, strategies: strategies.results, scores: scores.results };
}

/** One-row read from `daily_stats`; falls back to the scan when the row is missing. */
export async function aggregates(db: D1Like, dailyId: string, contentVersion: string): Promise<Aggregates> {
  if (contentVersion) {
    const row = await db.prepare(SQL.statsRow).bind(dailyId, contentVersion).first<StatsRow>();
    if (row) return aggregatesFromStatsRow(row);
  }
  return fullAggregates(db, dailyId, contentVersion);
}

function cacheKey(url: URL): Request {
  // Keyed by URL only: CORS headers are re-applied per request after a cache hit.
  return new Request(url.toString(), { method: 'GET' });
}

export async function handle(request: Request, env: Env, opts: HandlerOptions = {}): Promise<Response> {
  const now = opts.now ? opts.now() : new Date();
  const url = new URL(request.url);
  const origin = request.headers.get('origin');
  const allowed = parseOrigins(env.ALLOWED_ORIGINS);
  const cors = corsHeaders(origin, allowed);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: originAllowed(origin, allowed) ? 204 : 403, headers: cors });
  }
  if (!originAllowed(origin, allowed)) return json({ error: 'origin not allowed' }, 403, cors);

  const health = url.pathname === '/v1/health';
  if (health) {
    if (request.method !== 'GET') return json({ error: 'method not allowed' }, 405, cors);
    return json({ ok: true, version: env.VERSION ?? 'dev', time: receivedHour(now) }, 200, cors);
  }

  const match = url.pathname.match(/^\/v1\/daily\/([^/]+)\/(results|stats)$/);
  if (!match) return json({ error: 'not found' }, 404, cors);
  const dailyId = decodeURIComponent(match[1]);
  if (!isRealUtcDate(dailyId)) return json({ error: 'invalid daily id' }, 400, cors);
  const resource = match[2];
  const ip = request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '';

  if (resource === 'stats') {
    if (request.method !== 'GET') return json({ error: 'method not allowed' }, 405, cors);
    const cvRaw = (url.searchParams.get('cv') ?? '').slice(0, 32);
    const cv = /^[0-9A-Za-z._+-]*$/.test(cvRaw) ? cvRaw : '';
    const statsHeaders = { ...cors, 'cache-control': `public, max-age=${STATS_CACHE_SECONDS}` };
    // Edge cache first: a hit costs no database work and is not rate limited.
    const key = cacheKey(url);
    if (opts.cache) {
      const hit = await opts.cache.match(key).catch(() => undefined);
      if (hit) return new Response(hit.body, { status: hit.status, headers: { ...JSON_HEADERS, ...statsHeaders, 'x-cache': 'hit' } });
    }
    // Reads are limited only on a cache miss (the expensive path); the cap is generous.
    if (env.RATE_SALT && ip) {
      const limit = Number(env.RATE_LIMIT_READS_PER_MINUTE ?? DEFAULT_RATE_LIMIT_READS_PER_MINUTE) || DEFAULT_RATE_LIMIT_READS_PER_MINUTE;
      const rl = await checkRateLimit(env.DB, ip, env.RATE_SALT, limit, now.getTime(), 'read');
      if (!rl.allowed) return json({ error: 'rate limited' }, 429, { ...cors, 'retry-after': '60' });
    }
    const agg = await aggregates(env.DB, dailyId, cv);
    const minCohort = Number(env.MIN_COHORT ?? DEFAULT_MIN_COHORT) || DEFAULT_MIN_COHORT;
    const stats = publicStats(dailyId, cv || '*', agg, now, minCohort);
    const response = json(stats, 200, { ...statsHeaders, 'x-cache': 'miss' });
    if (opts.cache) {
      const put = opts.cache.put(key, response.clone()).catch(() => undefined);
      if (opts.waitUntil) opts.waitUntil(put);
      else await put;
    }
    return response;
  }

  // results
  if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405, cors);
  const lengthHeader = Number(request.headers.get('content-length') ?? '0');
  if (lengthHeader > MAX_BODY_BYTES) return json({ error: 'payload too large' }, 413, cors);
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return json({ error: 'payload too large' }, 413, cors);

  if (!env.RATE_SALT) {
    // Fail closed: an unsalted deployment cannot rate limit, so it refuses writes unless explicitly allowed.
    if (env.ALLOW_UNLIMITED_WRITES !== '1') {
      return json({ error: 'service not configured', detail: 'RATE_SALT is not set; writes are disabled' }, 503, { ...cors, 'retry-after': '3600' });
    }
    if (!warnedUnlimited) {
      warnedUnlimited = true;
      console.warn('[vande-community] RATE_SALT is not set and ALLOW_UNLIMITED_WRITES=1: write rate limiting is OFF. Do not run this in production.');
    }
  } else if (ip) {
    const limit = Number(env.RATE_LIMIT_PER_MINUTE ?? DEFAULT_RATE_LIMIT_PER_MINUTE) || DEFAULT_RATE_LIMIT_PER_MINUTE;
    const rl = await checkRateLimit(env.DB, ip, env.RATE_SALT, limit, now.getTime(), 'write');
    if (!rl.allowed) return json({ error: 'rate limited' }, 429, { ...cors, 'retry-after': '60' });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return json({ error: 'invalid json' }, 400, cors);
  }
  const allowedVersions = parseOrigins(env.CONTENT_VERSIONS);
  const validation = validateSubmission(parsed, now, allowedVersions, text.length);
  if (!validation.ok || !validation.value) return json({ error: 'invalid submission', details: validation.errors }, 400, cors);
  const s = validation.value;
  if (s.dailyId !== dailyId) return json({ error: 'daily id mismatch' }, 400, cors);

  const band = bandOf(s.score);
  const strategy = strategyClass(s.fingerprint);
  const hour = receivedHour(now);
  const result = await env.DB.prepare(SQL.insertResult)
    .bind(s.submissionId, s.dailyId, s.contentVersion, s.appVersion, s.mode, s.score, band, s.outcome, s.fingerprint, strategy, hour)
    .run();
  const inserted = (result.meta?.changes ?? 0) > 0;
  if (inserted) {
    // Incremental aggregates move in one statement per accepted result (see SQL.upsertStats).
    await env.DB.prepare(SQL.upsertStats)
      .bind(
        s.dailyId,
        s.contentVersion,
        s.score,
        band,
        s.outcome,
        strategy,
        String(s.score),
        hour,
        jsonPath(band),
        jsonPath(s.outcome),
        jsonPath(strategy),
        jsonPath(s.score),
      )
      .run();
  }
  return json({ accepted: inserted, duplicate: !inserted }, inserted ? 201 : 200, cors);
}

/** Scheduled maintenance (wrangler cron): prune rate buckets, results and aggregates past retention. */
export async function scheduled(env: Env, now = new Date()): Promise<void> {
  await pruneRateBuckets(env.DB, now.getTime());
  const cutoff = receivedHour(new Date(now.getTime() - RESULT_RETENTION_DAYS * 86400000));
  await env.DB.prepare(SQL.pruneResults).bind(cutoff).run();
  await env.DB.prepare(SQL.pruneStats).bind(cutoff).run();
}

interface ExecutionContextLike {
  waitUntil(p: Promise<unknown>): void;
}

export default {
  fetch(request: Request, env: Env, ctx?: ExecutionContextLike): Promise<Response> {
    const cache = (globalThis as { caches?: { default?: CacheLike } }).caches?.default;
    return handle(request, env, { cache, waitUntil: ctx ? (p) => ctx.waitUntil(p) : undefined }).catch(() => json({ error: 'internal error' }, 500));
  },
  scheduled(_event: unknown, env: Env): Promise<void> {
    return scheduled(env);
  },
};
