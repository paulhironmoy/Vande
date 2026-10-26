/** Shared job transitions of the highlight pipeline (compare-and-swap on the status, so concurrent steps never fight). */
import type { HighlightStatus } from '@/contracts';
import { highlightUrl } from '@/net/shared/ids';
import { publicWebOrigin, type Config } from '../config';
import type { Env } from '../env';
import type { WorkerDeps } from '../http/context';
import { roomBestEffort } from '../room/client';
import { BEFORE_UPLOAD, type JobRow } from './model';
import { HSQL } from './sql';

/** Uploads scheduled further ahead than this wait for the sweeper (queue delays are capped at 12 h). */
const MAX_QUEUE_DELAY_S = 12 * 3600;

export async function getJob(env: Env, jobId: string): Promise<JobRow | null> {
  return env.DB.prepare(HSQL.jobById).bind(jobId).first<JobRow>();
}

export async function transition(env: Env, deps: WorkerDeps, row: JobRow, to: HighlightStatus, error: string | null = null): Promise<boolean> {
  const r = await env.DB.prepare(HSQL.setStatus).bind(row.job_id, to, error, row.status, deps.now()).run();
  const ok = (r.meta?.changes ?? 0) > 0;
  if (ok) {
    deps.metrics.count('highlight_status', [to]);
    row.status = to;
    row.last_error = error;
  }
  return ok;
}

/** Queues the upload for `atMs` (now by default); the sweeper enqueues anything further out when it falls due. */
export async function scheduleUpload(env: Env, deps: WorkerDeps, row: JobRow, atMs = deps.now(), note: string | null = null): Promise<boolean> {
  const now = deps.now();
  const r = await env.DB.prepare(HSQL.schedule).bind(row.job_id, atMs, note, now).run();
  if ((r.meta?.changes ?? 0) === 0) return false;
  row.status = 'scheduled';
  row.scheduled_ms = atMs;
  deps.metrics.count('highlight_status', ['scheduled']);
  const delay = Math.max(0, Math.ceil((atMs - now) / 1000));
  if (delay <= MAX_QUEUE_DELAY_S) await env.MEDIA_QUEUE?.send({ v: 1, kind: 'upload', jobId: row.job_id }, delay > 0 ? { delaySeconds: delay } : undefined);
  return true;
}

/** Before any upload began: the job is cancelled and its temporary video deleted now. */
export async function cancelJob(env: Env, deps: WorkerDeps, row: JobRow, reason: string): Promise<boolean> {
  if (!BEFORE_UPLOAD.has(row.status)) return false;
  const ok = await transition(env, deps, row, 'consent_declined', reason);
  if (ok && row.video_key) {
    await env.FILES?.delete(row.video_key).catch(() => undefined);
    await env.DB.prepare(HSQL.dropVideo).bind(row.job_id, deps.now()).run();
  }
  return ok;
}

/**
 * Removes a live or uploading video through the adapter (queued; retried until done, within the documented SLA). The
 * intent is written first (withdraw_pending: 1 for a participant, 2 for an admin), so an upload in flight stops at its
 * next check and can never be published afterwards.
 */
export async function requestRemoval(env: Env, deps: WorkerDeps, row: JobRow, by: 'participant' | 'admin' = 'participant'): Promise<void> {
  await env.DB.prepare(by === 'admin' ? HSQL.markRemoval : HSQL.markWithdraw).bind(row.job_id, deps.now()).run();
  row.withdraw_pending = by === 'admin' ? row.withdraw_pending || 2 : 1;
  await env.MEDIA_QUEUE?.send({ v: 1, kind: 'remove', jobId: row.job_id });
}

/** Takes the room's highlight card down once its video is gone (withdrawal, deletion or an admin removal). */
export async function unannounce(env: Env, cfg: Config, row: JobRow): Promise<void> {
  if (row.room_id) await roomBestEffort(env, cfg, row.room_id, { op: 'unpost', upsertKey: `highlight:${row.job_id}` });
}

/** Room post and participant notifications once a video is live (each only once: the publish UPDATE is guarded). */
export async function announcePublished(env: Env, deps: WorkerDeps, cfg: Config, row: JobRow): Promise<void> {
  const url = highlightUrl(publicWebOrigin(env), row.code);
  // refs: the title names both players, so the post goes if either of them deletes their account.
  if (row.room_id) {
    await roomBestEffort(env, cfg, row.room_id, {
      op: 'post',
      kind: 'highlight',
      payload: { jobId: row.job_id, code: row.code, matchId: row.match_id, title: row.title, url },
      upsertKey: `highlight:${row.job_id}`,
      refs: [['title', row.pid0], ['title', row.pid1]],
    });
  }
  for (const uid of [row.uid0, row.uid1]) {
    if (uid.startsWith('x:')) continue;
    await env.NOTIFY_QUEUE?.send({ v: 1, kind: 'highlight_published', uid, matchId: row.match_id, jobId: row.job_id, ...(row.room_id ? { roomId: row.room_id } : {}), dedupe: `highlight:${row.job_id}:${uid}` }).catch(() => undefined);
  }
  deps.logger.log('info', { evt: 'highlight_published', job: row.job_id });
}
