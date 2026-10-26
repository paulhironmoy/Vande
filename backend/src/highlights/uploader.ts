/**
 * vande-media consumer: uploads to the official channel, removals and privacy changes, through the YouTube adapter.
 *
 * Uploads are resumable and recoverable, and a job is never uploaded twice:
 *   1. a job with a video id is done (a retry only re-announces nothing: the publish UPDATE is guarded);
 *   2. quota is reserved atomically for the current Pacific quota day before a session starts (uploads may use only
 *      the quota minus the headroom); no room → the job is scheduled for the next quota day (overflow);
 *   3. the session URI is stored encrypted BEFORE any byte is sent; after a crash the next attempt asks YouTube how
 *      much it received and continues from there, in 8 MiB chunks read from R2 by range;
 *   4. a withdrawal or removal is a recorded intent (withdraw_pending) plus the consent trail, checked before the session
 *      starts (and the session start itself is a compare-and-swap that refuses a withdrawn job), right after the
 *      session is stored, before every chunk, and before the video is published and announced: noticed before
 *      completion it stops the upload (no video), after completion it removes the video, and it is never announced.
 *      The sweeper removes any live or uploading job whose consent is no longer complete.
 * Transient failures are retried by the queue with backoff; after max_retries the message reaches vande-media-dlq
 * and the job becomes dead_letter. Quota refusals reschedule; permanent refusals mark upload_failed (admin retry).
 *
 * Never a publication that did not happen: in production without the channel's OAuth secrets there is no adapter at
 * all (the mock is for local and test runs only), so a due job is held as awaiting_channel, with no room card and no
 * push, until the secrets exist (the sweeper then schedules it again). A removal that keeps failing becomes
 * removal_failed: listed in /v1/admin/dlq, counted as `highlight_removal_failed` (an alert), its room card taken
 * down at once, and retried by the sweeper every hour until the video is gone.
 */
import type { Config } from '../config';
import type { Env, MessageLike } from '../env';
import type { WorkerDeps } from '../http/context';
import type { MediaMessage } from '../ops/messages';
import { open, seal } from '../security/crypto';
import { dataKeys } from '../security/secrets';
import { parseKeyring } from '../security/keyring';
import { BEFORE_UPLOAD, LIVE_STATUSES, latestDecisions, type ConsentRow, type JobRow } from './model';
import { announcePublished, cancelJob, getJob, scheduleUpload, transition, unannounce } from './pipeline';
import { exhaustDay, nextPacificMidnight, pacificDay, quotaConfig, reserveUnits, reserveUpload } from './quota';
import { HSQL } from './sql';
import { MockYouTube, RealYouTube, YouTubeError, type YouTubePublisher } from './youtube';

export const CHUNK_BYTES = 8 * 1024 * 1024;
/** An upload consumer holds the job this long, extended after every chunk. */
const UPLOAD_LEASE_MS = 15 * 60_000;
/** Overflow uploads start a little after the quota resets, spread by a minute each. */
const OVERFLOW_OFFSET_MS = 10 * 60_000;

let isolateMock: MockYouTube | null = null;
let isolateReal: { key: string; yt: RealYouTube } | null = null;

/**
 * The injected adapter; the real one when the OAuth secrets exist; the per-isolate mock outside production; and in
 * production without the secrets none at all (null): nothing is uploaded, published or announced.
 */
export function publisherFor(env: Env, deps: WorkerDeps): YouTubePublisher | null {
  if (deps.youtube) return deps.youtube;
  if (env.YT_CLIENT_ID && env.YT_CLIENT_SECRET && env.YT_REFRESH_TOKEN) {
    const key = `${env.YT_CLIENT_ID}|${env.YT_REFRESH_TOKEN.length}`;
    if (!isolateReal || isolateReal.key !== key) isolateReal = { key, yt: new RealYouTube({ clientId: env.YT_CLIENT_ID, clientSecret: env.YT_CLIENT_SECRET, refreshToken: env.YT_REFRESH_TOKEN, fetch: deps.fetch, now: deps.now }) };
    return isolateReal.yt;
  }
  // Production unless ENVIRONMENT says otherwise (config.ts): the mock never stands in for the official channel.
  if ((env.ENVIRONMENT ?? 'production') === 'production') return null;
  return (isolateMock ??= new MockYouTube());
}

/** The adapter, or an error the queue retries (and dead-letters): production without the channel's secrets. */
function requirePublisher(env: Env, deps: WorkerDeps): YouTubePublisher {
  const yt = publisherFor(env, deps);
  if (!yt) throw new Error('the official channel is not configured (YT_CLIENT_ID, YT_CLIENT_SECRET, YT_REFRESH_TOKEN)');
  return yt;
}

/** Production without the channel's secrets: the job waits, visibly, and nobody is told it was published. */
async function holdForChannel(env: Env, deps: WorkerDeps, row: JobRow): Promise<void> {
  if (await transition(env, deps, row, 'awaiting_channel', 'no_channel_credentials')) deps.logger.log('warn', { evt: 'highlight_awaiting_channel', job: row.job_id });
}

/**
 * Whether this job must not be (or stay) on the channel: a withdrawal or removal is pending, or either participant's
 * latest consent decision is not "granted". Checked before a session starts, right after it is stored, before every
 * chunk, and before the video is published and announced.
 */
async function withdrawn(env: Env, row: JobRow): Promise<boolean> {
  if (row.withdraw_pending !== 0) return true;
  const { results } = await env.DB.prepare(HSQL.consentsOf).bind(row.job_id).all<ConsentRow>();
  const latest = latestDecisions(results);
  return [row.uid0, row.uid1].some((uid) => latest.get(uid)?.decision !== 'granted');
}

/** False when the job stopped being due for upload (withdrawn, removed or cancelled) while the session was created. */
async function storeSession(env: Env, deps: WorkerDeps, row: JobRow, uri: string): Promise<boolean> {
  const sealed = await seal(dataKeys(env, deps.logger).active, 'upload', row.job_id, uri, `upload|${row.job_id}`);
  const r = await env.DB.prepare(HSQL.setSession).bind(row.job_id, sealed, deps.now()).run();
  return (r.meta?.changes ?? 0) > 0;
}

async function openSession(env: Env, row: JobRow): Promise<string | null> {
  if (!row.upload_session) return null;
  const ring = parseKeyring(env.DATA_KEYS);
  return ring ? open(ring.all, 'upload', row.job_id, row.upload_session, `upload|${row.job_id}`) : null;
}

async function overflow(env: Env, deps: WorkerDeps, row: JobRow, why: string): Promise<void> {
  // Spread the overflow over the first hour of the next quota day (stable per job).
  let spread = 0;
  for (let i = 0; i < row.job_id.length; i++) spread = (spread * 31 + row.job_id.charCodeAt(i)) % 60;
  const at = nextPacificMidnight(deps.now()) + OVERFLOW_OFFSET_MS + spread * 60_000;
  deps.metrics.count('quota_overflow');
  await env.DB.prepare(HSQL.clearSession).bind(row.job_id, deps.now()).run();
  await scheduleUpload(env, deps, row, at, why);
}

/** A job that must not be published, before any session exists: cancelled (a withdrawal) or closed as removed (admin). */
async function cancelBeforeUpload(env: Env, deps: WorkerDeps, row: JobRow): Promise<void> {
  if (row.withdraw_pending === 2) {
    await env.DB.prepare(HSQL.forceStatus).bind(row.job_id, 'removed', 'removed_by_admin', deps.now()).run();
    if (row.video_key) {
      await env.FILES?.delete(row.video_key).catch(() => undefined);
      await env.DB.prepare(HSQL.dropVideo).bind(row.job_id, deps.now()).run();
    }
    return;
  }
  await cancelJob(env, deps, row, 'withdrawn');
}

/**
 * Stops an upload that must not finish (withdrawal, deletion, admin removal): if YouTube already finished the video,
 * record it and remove it; if the session is gone or unfinished, no video exists, so close the job (consent_declined
 * for a withdrawal, removed for an admin removal). Any other answer is retried (never guess).
 */
async function stopUpload(env: Env, deps: WorkerDeps, yt: YouTubePublisher, row: JobRow): Promise<void> {
  const session = await openSession(env, row);
  const head = session && row.video_key ? await env.FILES?.head(row.video_key) : null;
  if (session && head) {
    try {
      const state = await yt.queryUpload(session, head.size);
      if (state.state === 'complete') {
        await env.DB.prepare(HSQL.recordVideo).bind(row.job_id, state.videoId, deps.now()).run();
        await env.MEDIA_QUEUE?.send({ v: 1, kind: 'remove', jobId: row.job_id });
        return;
      }
    } catch (e) {
      if (!(e instanceof YouTubeError && e.kind === 'gone')) throw e;
    }
  }
  await env.DB.prepare(HSQL.clearSession).bind(row.job_id, deps.now()).run();
  const admin = row.withdraw_pending === 2;
  await env.DB.prepare(HSQL.forceStatus).bind(row.job_id, admin ? 'removed' : 'consent_declined', admin ? 'removed_by_admin' : 'withdrawn_during_upload', deps.now()).run();
  if (row.video_key) {
    await env.FILES?.delete(row.video_key).catch(() => undefined);
    await env.DB.prepare(HSQL.dropVideo).bind(row.job_id, deps.now()).run();
  }
}

async function upload(env: Env, deps: WorkerDeps, cfg: Config, jobId: string): Promise<void> {
  const start = await getJob(env, jobId);
  if (!start || start.youtube_video_id || !['scheduled', 'uploading', 'upload_failed'].includes(start.status)) return;
  if (start.status === 'scheduled' && (start.scheduled_ms ?? 0) > deps.now() + 60_000) return; // early: the sweeper re-enqueues
  const leased = await env.DB.prepare(HSQL.leaseUpload).bind(jobId, deps.now() + UPLOAD_LEASE_MS, deps.now()).run();
  if ((leased.meta?.changes ?? 0) === 0) return; // another consumer is on it
  try {
    await uploadLeased(env, deps, cfg, jobId);
  } finally {
    await env.DB.prepare(HSQL.releaseUpload).bind(jobId).run();
  }
}

/** Stops whatever stage a withdrawn or removed job is in (no session yet: cancel; uploading: stopUpload). */
async function halt(env: Env, deps: WorkerDeps, yt: YouTubePublisher, row: JobRow): Promise<void> {
  if (row.status === 'uploading') await stopUpload(env, deps, yt, row);
  else if (BEFORE_UPLOAD.has(row.status)) await cancelBeforeUpload(env, deps, row);
}

async function uploadLeased(env: Env, deps: WorkerDeps, cfg: Config, jobId: string): Promise<void> {
  const found = publisherFor(env, deps);
  const q = quotaConfig(env);
  let row = await getJob(env, jobId);
  if (!row || row.youtube_video_id) return;
  if (!found) {
    // No channel: a withdrawn job is simply cancelled (nothing was uploaded); any other waits for the secrets.
    if (await withdrawn(env, row)) {
      if (BEFORE_UPLOAD.has(row.status)) await cancelBeforeUpload(env, deps, row);
      return;
    }
    return holdForChannel(env, deps, row);
  }
  const yt = found;
  if (await withdrawn(env, row)) return halt(env, deps, yt, row);
  const now = deps.now();
  const head = row.video_key ? await env.FILES?.head(row.video_key) : null;
  if (!head || !row.video_key) {
    await transition(env, deps, row, 'upload_failed', 'video_missing');
    return;
  }
  const total = head.size;
  let session = await openSession(env, row);
  if (!session) {
    const qday = pacificDay(now);
    if (row.quota_day !== qday) {
      if (!(await reserveUpload(env.DB, qday, q))) return overflow(env, deps, row, 'quota_full');
      await env.DB.prepare(HSQL.setQuotaDay).bind(row.job_id, qday, now).run();
      row.quota_day = qday;
    }
    try {
      session = (await yt.startUpload({ jobId: row.job_id, title: row.title, description: row.description, privacy: row.visibility, bytes: total, categoryId: env.YT_CATEGORY_ID ?? '20', language: row.locale.slice(0, 2) })).sessionUri;
    } catch (e) {
      return handleError(env, deps, row, e, qday);
    }
    if (!(await storeSession(env, deps, row, session))) {
      // Withdrawn, removed or cancelled while YouTube created the session: no byte is ever sent, so no video exists.
      const now2 = await getJob(env, jobId);
      if (now2 && (await withdrawn(env, now2))) await halt(env, deps, yt, now2);
      return;
    }
    row = (await getJob(env, jobId)) ?? row;
    if (await withdrawn(env, row)) return stopUpload(env, deps, yt, row);
  } else {
    deps.metrics.count('upload_resumed');
  }
  let state;
  try {
    state = await yt.queryUpload(session, total);
    while (state.state === 'incomplete') {
      row = (await getJob(env, jobId)) ?? row;
      if (await withdrawn(env, row)) return stopUpload(env, deps, yt, row);
      const start = state.received;
      const end = Math.min(total, start + CHUNK_BYTES);
      const part = await env.FILES?.get(row.video_key as string, { range: { offset: start, length: end - start } });
      if (!part) throw new YouTubeError('transient', 'video range unavailable');
      state = await yt.uploadChunk(session, new Uint8Array(await part.arrayBuffer()), start, total);
      await env.DB.prepare(HSQL.touchUpload).bind(row.job_id, deps.now(), deps.now() + UPLOAD_LEASE_MS).run();
    }
  } catch (e) {
    if (e instanceof YouTubeError && e.kind === 'gone') {
      // The session expired or never existed: start a new one next time (no video was created from it).
      await env.DB.prepare(HSQL.clearSession).bind(row.job_id, deps.now()).run();
    }
    return handleError(env, deps, row, e, row.quota_day ?? pacificDay(now));
  }
  // The video exists on YouTube now: record it first, so whatever happens next it can be removed.
  await env.DB.prepare(HSQL.recordVideo).bind(row.job_id, state.videoId, deps.now()).run();
  const recorded = (await getJob(env, jobId)) as JobRow;
  if (recorded.youtube_video_id !== state.videoId) {
    // Another session finished first (never expected under the lease): this copy must not stay on the channel.
    await yt.remove(state.videoId).catch(() => deps.logger.log('error', { evt: 'highlight_orphan_video', job: jobId }));
    return;
  }
  if (await withdrawn(env, recorded)) {
    await env.MEDIA_QUEUE?.send({ v: 1, kind: 'remove', jobId });
    return;
  }
  const done = await env.DB.prepare(HSQL.markPublished).bind(row.job_id, state.videoId, deps.now()).run();
  const fresh = (await getJob(env, jobId)) as JobRow;
  if ((done.meta?.changes ?? 0) === 0 || (await withdrawn(env, fresh))) {
    // A withdrawal or removal landed meanwhile: it wins, and nothing is announced.
    if (fresh.withdraw_pending === 0) await env.DB.prepare(HSQL.markWithdraw).bind(jobId, deps.now()).run();
    await env.MEDIA_QUEUE?.send({ v: 1, kind: 'remove', jobId });
    return;
  }
  deps.metrics.count('highlight_status', ['published']);
  await announcePublished(env, deps, cfg, fresh);
}

/** quota → next quota day; permanent → upload_failed; auth → upload_failed (credentials need an operator); else retry. */
async function handleError(env: Env, deps: WorkerDeps, row: JobRow, e: unknown, qday: string): Promise<void> {
  const kind = e instanceof YouTubeError ? e.kind : 'transient';
  deps.metrics.count('youtube_error', [kind]);
  if (kind === 'quota') {
    await exhaustDay(env.DB, qday, quotaConfig(env));
    return overflow(env, deps, row, 'youtube_quota');
  }
  if (kind === 'permanent' || kind === 'auth') {
    await env.DB.prepare(HSQL.forceStatus).bind(row.job_id, 'upload_failed', `youtube_${kind}`, deps.now()).run();
    return;
  }
  await env.DB.prepare(HSQL.setError).bind(row.job_id, `youtube_${kind}`, deps.now()).run();
  throw e instanceof Error ? e : new Error('upload failed');
}

/**
 * Withdrawal, admin removal or account deletion: delete the video (removals may use the quota headroom). A job still
 * uploading is never queued for upload again: its removal intent is recorded and the upload is stopped here, or by
 * the consumer that holds it (at its next check).
 */
async function remove(env: Env, deps: WorkerDeps, cfg: Config, jobId: string): Promise<void> {
  const row = await getJob(env, jobId);
  if (!row || row.status === 'removed') return;
  if (row.status === 'removal_failed' && !row.youtube_video_id) {
    // The removal failed while stopping an upload: stop it again.
    await env.DB.prepare(HSQL.retryRemoval).bind(row.job_id, deps.now()).run();
    row.status = 'uploading';
  }
  if (!row.youtube_video_id) {
    if (row.status === 'uploading') {
      if (row.withdraw_pending === 0) {
        await env.DB.prepare(HSQL.markRemoval).bind(jobId, deps.now()).run();
        row.withdraw_pending = 2;
      }
      const leased = await env.DB.prepare(HSQL.leaseUpload).bind(jobId, deps.now() + UPLOAD_LEASE_MS, deps.now()).run();
      if ((leased.meta?.changes ?? 0) === 0) return; // the consumer holding it stops at its next check
      try {
        await stopUpload(env, deps, requirePublisher(env, deps), row);
      } finally {
        await env.DB.prepare(HSQL.releaseUpload).bind(jobId).run();
      }
      return;
    }
    if (BEFORE_UPLOAD.has(row.status)) await cancelBeforeUpload(env, deps, row);
    return;
  }
  const yt = requirePublisher(env, deps);
  const q = quotaConfig(env);
  if (!(await reserveUnits(env.DB, pacificDay(deps.now()), q.perDelete, q))) throw new Error('no quota left for a removal today');
  await yt.remove(row.youtube_video_id);
  await env.DB.prepare(HSQL.forceStatus).bind(row.job_id, 'removed', row.withdraw_pending === 2 ? 'removed_by_admin' : 'withdrawn', deps.now()).run();
  deps.metrics.count('highlight_status', ['removed']);
  await unannounce(env, cfg, row);
}

async function unlist(env: Env, deps: WorkerDeps, jobId: string): Promise<void> {
  const row = await getJob(env, jobId);
  if (!row || !row.youtube_video_id || !LIVE_STATUSES.has(row.status)) return;
  const yt = requirePublisher(env, deps);
  const q = quotaConfig(env);
  if (!(await reserveUnits(env.DB, pacificDay(deps.now()), q.perUpdate, q))) throw new Error('no quota left for a privacy change today');
  await yt.setPrivacy(row.youtube_video_id, 'unlisted');
  await env.DB.prepare(HSQL.setVisibility).bind(row.job_id, 'unlisted', deps.now()).run();
  await env.DB.prepare(HSQL.forceStatus).bind(row.job_id, 'unlisted', null, deps.now()).run();
}

export async function processMedia(env: Env, deps: WorkerDeps, cfg: Config, msg: MediaMessage): Promise<void> {
  if (msg?.v !== 1 || typeof msg.jobId !== 'string') return;
  if (msg.kind === 'upload') await upload(env, deps, cfg, msg.jobId);
  else if (msg.kind === 'remove') await remove(env, deps, cfg, msg.jobId);
  else if (msg.kind === 'unlist') await unlist(env, deps, msg.jobId);
}

/**
 * Retries exhausted (vande-media-dlq): an unfinished upload becomes dead_letter; a failed removal becomes
 * removal_failed (listed in /v1/admin/dlq, an alert metric, the room card taken down now, retried hourly by the
 * sweeper until the video is gone).
 */
export async function mediaDeadLetter(env: Env, deps: WorkerDeps, cfg: Config, message: MessageLike<MediaMessage>): Promise<void> {
  const msg = message.body;
  deps.metrics.count('media_dead_letter', [msg?.kind ?? 'unknown']);
  const row = msg?.jobId ? await getJob(env, msg.jobId) : null;
  if (!row) return;
  if (msg.kind === 'upload' && !row.youtube_video_id) {
    // A job whose withdrawal or removal is pending is closed instead (an admin can never retry it into publication).
    if (row.withdraw_pending === 0) await env.DB.prepare(HSQL.forceStatus).bind(row.job_id, 'dead_letter', 'retries_exhausted', deps.now()).run();
    else await env.DB.prepare(HSQL.forceStatus).bind(row.job_id, row.withdraw_pending === 2 ? 'removed' : 'consent_declined', 'retries_exhausted', deps.now()).run();
  }
  else if (msg.kind === 'remove' && row.status !== 'removed') {
    await env.DB.prepare(HSQL.forceStatus).bind(row.job_id, 'removal_failed', 'retries_exhausted', deps.now()).run();
    deps.metrics.count('highlight_removal_failed');
    deps.metrics.count('highlight_status', ['removal_failed']);
    deps.logger.log('error', { evt: 'highlight_removal_failed', job: row.job_id });
    // Consent was withdrawn (or an admin removed it): the app stops showing it now, whatever YouTube still does.
    await unannounce(env, cfg, row);
  }
}

export function __resetYouTubeForTests(): void {
  isolateMock = null;
  isolateReal = null;
}
