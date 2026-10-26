/**
 * The highlight sweeper (cron every 15 minutes; every step is idempotent and caught on its own):
 *   cutoff     — freezes yesterday's Top 100 if the 00:00 IST run did not (and retries its notifications);
 *   consent    — no answer within 48 h counts as declined;
 *   render     — an expired render lease is a failed attempt (retried with backoff, then dead_letter);
 *   consent    — any uploading or live job whose removal is pending or whose consent is no longer complete (a
 *                withdrawal that raced the pipeline, a deleted account) is marked and removed;
 *   uploads    — scheduled uploads that fell due (overflow to the next quota day) and stalled ones are queued again;
 *   channel    — jobs held as awaiting_channel are scheduled again once the official channel's secrets exist;
 *   removals   — failed removals (removal_failed) are tried again every hour until the video is gone;
 *   videos     — temporary MP4s are deleted 72 h after a confirmed upload (or after the job closed);
 *   views      — daily view counts of published videos (one quota unit per 50 videos).
 */
import type { Config } from '../config';
import { DAY_MS, HOUR_MS, MINUTE_MS } from '../config';
import type { Env } from '../env';
import type { WorkerDeps } from '../http/context';
import { cutoffDay, runTop100Cutoff } from '../top100/cutoff';
import { istDay } from '../time';
import { expireConsent } from './consent';
import type { JobRow } from './model';
import { getJob, scheduleUpload } from './pipeline';
import { pacificDay, quotaConfig, reserveUnits } from './quota';
import { renderAttemptFailed } from './render';
import { HSQL } from './sql';
import { publisherFor } from './uploader';

export const SWEEP_CRON = '*/15 * * * *';
export const VIDEO_RECOVERY_MS = 72 * HOUR_MS;
const STALL_MS = 30 * MINUTE_MS;
/** A failed removal is tried again this long after its last attempt. */
export const REMOVAL_RETRY_MS = HOUR_MS;
const VIEWS_EVERY_MS = DAY_MS;
const VIEWS_FOR_MS = 30 * DAY_MS;

export async function runSweep(env: Env, deps: WorkerDeps, cfg: Config): Promise<Record<string, number>> {
  const now = deps.now();
  const report: Record<string, number> = {};
  const step = async (name: string, run: () => Promise<number>) => {
    try {
      report[name] = await run();
    } catch {
      report[name] = -1;
      deps.logger.log('warn', { evt: 'sweep_failed', step: name });
    }
  };
  await step('cutoff', async () => ((await runTop100Cutoff(env, deps, cfg, cutoffDay(now))).status === 'frozen' ? 1 : 0));
  await step('consent_timeouts', async () => {
    const { results } = await env.DB.prepare(HSQL.expiredConsents).bind(now).all<{ job_id: string }>();
    for (const r of results) {
      const row = await getJob(env, r.job_id);
      if (row) await expireConsent(env, deps, row);
    }
    return results.length;
  });
  await step('render_leases', async () => {
    const { results } = await env.DB.prepare(HSQL.expiredLeases).bind(now).all<{ job_id: string }>();
    for (const r of results) {
      const row = await getJob(env, r.job_id);
      if (row) await renderAttemptFailed({ env, deps, now }, row, 'lease_expired', true);
    }
    return results.length;
  });
  await step('consent_reconcile', async () => {
    const { results } = await env.DB.prepare(HSQL.unconsented).all<JobRow>();
    for (const row of results) {
      if (row.withdraw_pending === 0) await env.DB.prepare(HSQL.markWithdraw).bind(row.job_id, now).run();
      await env.MEDIA_QUEUE?.send({ v: 1, kind: 'remove', jobId: row.job_id });
    }
    if (results.length) deps.metrics.count('highlight_status', ['reconciled'], results.length);
    return results.length;
  });
  await step('uploads_due', async () => {
    const due = (await env.DB.prepare(HSQL.dueUploads).bind(now).all<{ job_id: string }>()).results;
    const stalled = (await env.DB.prepare(HSQL.staleUploads).bind(now - STALL_MS).all<{ job_id: string }>()).results;
    for (const r of [...due, ...stalled]) await env.MEDIA_QUEUE?.send({ v: 1, kind: 'upload', jobId: r.job_id });
    return due.length + stalled.length;
  });
  await step('channel_ready', async () => {
    if (!publisherFor(env, deps)) return 0;
    const { results } = await env.DB.prepare(HSQL.jobsWithStatus).bind('awaiting_channel', 25).all<JobRow>();
    for (const row of results) await scheduleUpload(env, deps, row, now, 'channel_ready');
    return results.length;
  });
  await step('removals_retried', async () => {
    const { results } = await env.DB.prepare(HSQL.removalRetriesDue).bind(now - REMOVAL_RETRY_MS).all<{ job_id: string }>();
    for (const r of results) {
      await env.DB.prepare(HSQL.retryRemoval).bind(r.job_id, now).run();
      await env.MEDIA_QUEUE?.send({ v: 1, kind: 'remove', jobId: r.job_id });
    }
    return results.length;
  });
  await step('videos_deleted', async () => {
    const { results } = await env.DB.prepare(HSQL.oldVideos).bind(now - VIDEO_RECOVERY_MS).all<{ job_id: string; video_key: string }>();
    if (results.length && env.FILES) await env.FILES.delete(results.map((r) => r.video_key));
    for (const r of results) await env.DB.prepare(HSQL.dropVideo).bind(r.job_id, now).run();
    return results.length;
  });
  await step('views', async () => {
    const { results } = await env.DB.prepare(HSQL.statsDue).bind(now - VIEWS_EVERY_MS, now - VIEWS_FOR_MS).all<Pick<JobRow, 'job_id' | 'code' | 'youtube_video_id' | 'views'>>();
    if (!results.length) return 0;
    const yt = publisherFor(env, deps);
    if (!yt) return 0;
    const q = quotaConfig(env);
    if (!(await reserveUnits(env.DB, pacificDay(now), Math.ceil(results.length / 50) * q.perList, q))) return 0;
    const counts = await yt.statistics(results.map((r) => r.youtube_video_id as string));
    for (const r of results) {
      const views = counts.get(r.youtube_video_id as string);
      if (views === undefined) continue;
      await env.DB.prepare(HSQL.setViews).bind(r.job_id, views, now).run();
      if (views > r.views) await env.DB.prepare(HSQL.countAttribution).bind(r.code, istDay(now), 'views', views - r.views).run();
    }
    return results.length;
  });
  return report;
}
