/**
 * VANDE community API — Cloudflare Worker + D1.
 *   POST /v1/daily/:dailyId/results          accept one anonymous official result (deduped per day per install)
 *   GET  /v1/daily/:dailyId/stats            aggregate stats (percentages only from MIN_COHORT results)
 *   POST /v1/lite/attempts                   verified dares: start (backend/src/liteDares.ts)
 *   POST /v1/lite/attempts/:attemptId/grade  verified dares: grade and sign
 *   GET  /v1/lite/goal/:day                  verified dares: today's shared goal
 *   GET  /v1/health
 * No framework, no cookies, no raw IP storage. Every limit is keyed by network (IPv4 /32, IPv6 /64) under a global
 * ceiling, through the Workers Rate Limiting bindings when configured (guards.ts). See docs/BACKEND.md.
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
import { guardRead, guardWrite } from './guards';
import { JSON_HEADERS, clientAddress, json, readBody, receivedHour, safeDecode } from './http';
import { handleLite, pruneLite, type LiteEnv } from './liteDares';
import { pruneBudget, pruneInBatches, pruneRateBuckets, type RateLimitBinding } from './ratelimit';
import { SQL, jsonPath } from './sql';
import { aggregatesFromStatsRow, bandOf, publicStats, strategyClass, type Aggregates, type CountRow, type StatsRow } from './stats';
import { isRealUtcDate, validateSubmission } from './validate';

export interface Env extends LiteEnv {
  DB: D1Like;
  ALLOWED_ORIGINS?: string;
  MIN_COHORT?: string;
  CONTENT_VERSIONS?: string;
  RATE_LIMIT_PER_MINUTE?: string;
  RATE_LIMIT_READS_PER_MINUTE?: string;
  VERSION?: string;
  /** D1 statements one scheduled cleanup may run (default 45, the free plan's 50-query limit with a margin). */
  CLEANUP_MAX_QUERIES?: string;
  /** Workers Rate Limiting binding for result submissions per network (wrangler.toml); D1 buckets without it. */
  RL_WRITE?: RateLimitBinding;
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

  const ip = clientAddress(request);
  const lite = await handleLite(request, env, { now, url, cors, ip, cache: opts.cache, waitUntil: opts.waitUntil });
  if (lite) return lite;

  const match = url.pathname.match(/^\/v1\/daily\/([^/]+)\/(results|stats)$/);
  if (!match) return json({ error: 'not found' }, 404, cors);
  const dailyId = safeDecode(match[1]);
  if (dailyId === null || !isRealUtcDate(dailyId)) return json({ error: 'invalid daily id' }, 400, cors);
  const resource = match[2];

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
    const readLimit = Number(env.RATE_LIMIT_READS_PER_MINUTE ?? DEFAULT_RATE_LIMIT_READS_PER_MINUTE) || DEFAULT_RATE_LIMIT_READS_PER_MINUTE;
    const refusedRead = await guardRead(env, { ip, now, cors, scope: 'read', limit: readLimit, binding: env.RL_READ });
    if (refusedRead) return refusedRead;
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
  const text = await readBody(request, MAX_BODY_BYTES);
  if (text === null) return json({ error: 'payload too large' }, 413, cors);

  // Fail closed without a salt (unless explicitly allowed for local development), then per-network and global limits.
  const writeLimit = Number(env.RATE_LIMIT_PER_MINUTE ?? DEFAULT_RATE_LIMIT_PER_MINUTE) || DEFAULT_RATE_LIMIT_PER_MINUTE;
  const refusedWrite = await guardWrite(env, { ip, now, cors, scope: 'write', limit: writeLimit, binding: env.RL_WRITE });
  if (refusedWrite) return refusedWrite;

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

/**
 * Scheduled maintenance (wrangler cron, daily): prune verified-dare attempts after 7 days and goal rows, results and
 * aggregates past retention, and rate buckets older than 24 hours. Deletes run in batches within one budget of D1
 * statements (CLEANUP_MAX_QUERIES), most personal data first, so if the budget runs out it is the rate buckets that
 * wait for the next run. Each step is caught on its own, so one failing table never stops the others. Returns rows
 * deleted per step (-1 when a step failed), the statements left, and `cleanup_incomplete` 1 when rows were left over.
 */
export async function scheduled(env: Env, now = new Date()): Promise<Record<string, number>> {
  const cutoff = receivedHour(new Date(now.getTime() - RESULT_RETENTION_DAYS * 86400000));
  const budget = pruneBudget(env.CLEANUP_MAX_QUERIES);
  const steps: [string, () => Promise<number>][] = [
    ['lite', async () => {
      const r = await pruneLite(env.DB, now, budget);
      return r.attempts + r.goal;
    }],
    ['daily_results', () => pruneInBatches(env.DB, SQL.pruneResults, cutoff, budget)],
    ['daily_stats', () => pruneInBatches(env.DB, SQL.pruneStats, cutoff, budget)],
    ['rate_buckets', () => pruneRateBuckets(env.DB, now.getTime(), budget)],
  ];
  const report: Record<string, number> = {};
  for (const [name, run] of steps) {
    try {
      report[name] = await run();
    } catch (e) {
      report[name] = -1;
      console.warn(`[vande-community] cleanup step ${name} failed: ${e instanceof Error ? e.message : 'unknown error'}`);
    }
  }
  report.queries_left = budget.left;
  report.cleanup_incomplete = budget.exhausted ? 1 : 0;
  if (budget.exhausted) console.warn('[vande-community] cleanup budget used up; the rest waits for the next run (raise CLEANUP_MAX_QUERIES on Workers Paid)');
  return report;
}

interface ExecutionContextLike {
  waitUntil(p: Promise<unknown>): void;
}

export default {
  fetch(request: Request, env: Env, ctx?: ExecutionContextLike): Promise<Response> {
    const cache = (globalThis as { caches?: { default?: CacheLike } }).caches?.default;
    return handle(request, env, { cache, waitUntil: ctx ? (p) => ctx.waitUntil(p) : undefined }).catch(() =>
      // Keep CORS on unexpected errors so the app sees a failure it can handle (and falls back to local play).
      json({ error: 'internal error' }, 500, corsHeaders(request.headers.get('origin'), parseOrigins(env.ALLOWED_ORIGINS))),
    );
  },
  async scheduled(_event: unknown, env: Env): Promise<void> {
    await scheduled(env);
  },
};
