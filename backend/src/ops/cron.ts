/**
 * Scheduled work (wrangler.toml [triggers]). "17 21 * * *" (02:47 IST): retention cleanup in batches within one
 * budget of D1 statements; each step is caught on its own. "30 18 * * *" (00:00 IST): the Daily Top 100 cutoff
 * (top100/cutoff.ts; Daily Six itself resets by date). Every 15 minutes: the highlight sweeper (highlights/sweeper.ts),
 * which also retries the cutoff if it did not run.
 */
import { AUDIT_RETENTION_DAYS, DAY_MS, DELETED_ACCOUNT_TOMBSTONE_DAYS, MATCH_INDEX_RETENTION_DAYS, type Config } from '../config';
import type { Env, ScheduledEventLike } from '../env';
import type { WorkerDeps } from '../http/context';
import { pruneBudget, pruneInBatches, pruneRateBuckets, PRUNE_BATCH } from '../guards/ratelimit';
import { SQL } from '../storage/sql';
import { istDay } from '../time';
import { cutoffDay, runTop100Cutoff } from '../top100/cutoff';
import { runSweep, SWEEP_CRON } from '../highlights/sweeper';
import { HSQL } from '../highlights/sql';
import { pacificDay } from '../highlights/quota';

/**
 * Daily Six attempt rows (attempts used, the attempt in progress, every attempt object's id) are kept 32 days: an
 * attempt object keeps its replay 30 days after its reveal and account deletion finds the objects through these rows.
 * Scores and their histogram 90 days (boards show 30).
 */
export const DAILY_ATTEMPT_RETENTION_DAYS = 32;
export const DAILY_SCORE_RETENTION_DAYS = 90;
/** Attribution counters (per code per day, no personal data) are kept 400 days. */
export const ATTRIBUTION_RETENTION_DAYS = 400;
/** Closed highlight jobs (declined, rejected, removed) and their consent and moderation records: 400 days. */
export const HIGHLIGHT_RETENTION_DAYS = 400;
/** The share cap's records (who opened which moment of which match or cup): 90 days, longer than any match or cup. */
export const SHARE_MOMENT_RETENTION_DAYS = 90;

export const CLEANUP_CRON = '17 21 * * *';
export const DAILY_CUTOFF_CRON = '30 18 * * *';

export async function runScheduled(event: ScheduledEventLike, env: Env, deps: WorkerDeps, cfg: Config): Promise<Record<string, number>> {
  if (event.cron === DAILY_CUTOFF_CRON) {
    const r = await runTop100Cutoff(env, deps, cfg, cutoffDay(deps.now()));
    return { top100_frozen: r.status === 'frozen' ? 1 : 0, top100_ranked: r.ranked, highlight_jobs: r.jobs };
  }
  if (event.cron === SWEEP_CRON) return runSweep(env, deps, cfg);
  const now = deps.now();
  const budget = pruneBudget(cfg.cleanupMaxQueries);
  const steps: Array<[string, () => Promise<number>]> = [
    ['idempotency', () => pruneInBatches(env.DB, SQL.pruneIdempotency, now, budget)],
    ['rate_buckets', () => pruneRateBuckets(env.DB, now, budget)],
    ['sessions_expired', () => pruneInBatches(env.DB, SQL.pruneSessions, now, budget)],
    ['sessions_revoked', () => pruneInBatches(env.DB, SQL.pruneRevokedSessions, now - DAY_MS, budget)],
    ['audit', () => pruneInBatches(env.DB, SQL.pruneAudit, now - AUDIT_RETENTION_DAYS * DAY_MS, budget)],
    ['deleted_accounts', () => pruneInBatches(env.DB, SQL.pruneDeletedAccounts, now - DELETED_ACCOUNT_TOMBSTONE_DAYS * DAY_MS, budget)],
    ['match_index', () => pruneInBatches(env.DB, SQL.pruneMatchPlayers, now - MATCH_INDEX_RETENTION_DAYS * DAY_MS, budget)],
    ['match_results', () => pruneInBatches(env.DB, SQL.pruneMatchResults, istDay(now - MATCH_INDEX_RETENTION_DAYS * DAY_MS), budget)],
    ['daily_attempts', () => pruneInBatches(env.DB, SQL.pruneDailyAttempts, istDay(now - DAILY_ATTEMPT_RETENTION_DAYS * DAY_MS), budget)],
    ['daily_scores', () => pruneInBatches(env.DB, SQL.pruneDailyScores, istDay(now - DAILY_SCORE_RETENTION_DAYS * DAY_MS), budget)],
    ['daily_score_counts', () => pruneInBatches(env.DB, SQL.pruneDailyCounts, istDay(now - DAILY_SCORE_RETENTION_DAYS * DAY_MS), budget)],
    ['internal_nonces', () => pruneInBatches(env.DB, HSQL.pruneNonces, now - DAY_MS, budget)],
    ['yt_quota', () => pruneInBatches(env.DB, HSQL.pruneQuota, pacificDay(now - 60 * DAY_MS), budget)],
    ['attribution', () => pruneInBatches(env.DB, HSQL.pruneAttribution, istDay(now - ATTRIBUTION_RETENTION_DAYS * DAY_MS), budget)],
    ['highlight_consents', () => pruneInBatches(env.DB, HSQL.pruneClosedConsents, now - HIGHLIGHT_RETENTION_DAYS * DAY_MS, budget)],
    ['highlight_moderation', () => pruneInBatches(env.DB, HSQL.pruneClosedModeration, now - HIGHLIGHT_RETENTION_DAYS * DAY_MS, budget)],
    ['highlight_jobs', () => pruneInBatches(env.DB, HSQL.pruneClosedJobs, now - HIGHLIGHT_RETENTION_DAYS * DAY_MS, budget)],
    // A code that expired answers like one that never existed, so it can go at once.
    ['invite_codes', () => pruneInBatches(env.DB, SQL.pruneInviteCodes, now, budget)],
    ['share_moments', () => pruneInBatches(env.DB, SQL.pruneShareMoments, now - SHARE_MOMENT_RETENTION_DAYS * DAY_MS, budget)],
    [
      'exports',
      async () => {
        let n = 0;
        const batch = Math.min(PRUNE_BATCH, 1000);
        while (budget.left >= 2) {
          budget.left -= 2;
          const { results } = await env.DB.prepare(SQL.expiredExports).bind(now, batch).all<{ export_id: string; object_key: string }>();
          if (results.length === 0) break;
          if (env.FILES) await env.FILES.delete(results.map((r) => r.object_key));
          await env.DB.prepare(SQL.deleteExpiredExports).bind(now, batch).run();
          n += results.length;
          if (results.length < batch) break;
        }
        return n;
      },
    ],
  ];
  const report: Record<string, number> = {};
  for (const [name, run] of steps) {
    try {
      report[name] = await run();
    } catch {
      report[name] = -1;
      deps.logger.log('warn', { evt: 'cleanup_failed', step: name });
    }
  }
  report.queries_left = budget.left;
  report.cleanup_incomplete = budget.exhausted ? 1 : 0;
  return report;
}
