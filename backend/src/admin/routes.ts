/**
 * /v1/admin/* — the admin console's API (types in src/admin/types.ts). Lists jobs by day and status, the consent
 * audit trail, moderation (approve / reject with notes after reviewing the rendered MP4 through a short-lived signed
 * link), scheduling, retrying a render or an upload, unlisting and removing, the YouTube quota and the dead letters.
 * Every action is audited with the admin's Access identity. Authentication: admin/access.ts (route auth "admin").
 */
import { HIGHLIGHT_STATUSES, type HighlightStatus } from '@/contracts';
import type { AdminJob, AdminJobDetail, AdminModeration, AdminQuota } from '@/admin/types';
import type { RequestContext } from '../http/context';
import { fail } from '../http/errors';
import { minuteIso } from '../http/http';
import type { Reply } from '../http/router';
import { audit } from '../ops/audit';
import { hmac, hmacKeyFor, timingSafeEqual } from '../security/crypto';
import { fromBase64Url, toBase64Url } from '../security/encoding';
import { dataKeys } from '../security/secrets';
import { isIsoDay, istDay } from '../time';
import { consentTrail } from '../highlights/consent';
import { JOB_ID_RE, LIVE_STATUSES, jobOf, type JobRow } from '../highlights/model';
import { adminDecision } from '../highlights/moderation';
import { getJob, requestRemoval, scheduleUpload } from '../highlights/pipeline';
import { nextPacificMidnight, pacificDay, quotaConfig, uploadsPerDay, usedOn } from '../highlights/quota';
import { HSQL } from '../highlights/sql';
import { verifyAccessJwt } from './access';

const STATUSES: ReadonlySet<string> = new Set(HIGHLIGHT_STATUSES);
const MEDIA_TTL_MS = 10 * 60_000;

function adminJob(row: JobRow): AdminJob {
  return {
    ...jobOf(row),
    kind: row.kind,
    fixtureLabel: row.fixture_label,
    aliases: [row.alias0, row.alias1],
    ranks: [row.rank0, row.rank1],
    consentBy: minuteIso(row.consent_by_ms),
    videoBytes: row.video_bytes,
    videoMs: row.video_ms,
    publishedAt: row.published_ms === null ? null : new Date(row.published_ms).toISOString(),
    views: row.views,
    quotaDay: row.quota_day,
    withdrawPending: row.withdraw_pending !== 0,
    createdAt: new Date(row.created_ms).toISOString(),
    updatedAt: new Date(row.updated_ms).toISOString(),
  };
}

async function jobParam(ctx: RequestContext): Promise<JobRow> {
  const row = JOB_ID_RE.test(ctx.params.jobId) ? await getJob(ctx.env, ctx.params.jobId) : null;
  if (!row) fail('not_found', 'job not found');
  return row;
}

/** A job whose withdrawal or removal is pending can never be scheduled, retried or re-rendered into publication. */
function refusePending(row: JobRow): void {
  if (row.withdraw_pending !== 0) fail('conflict', 'a withdrawal or removal is pending for this job');
}

async function act(ctx: RequestContext, row: JobRow, action: string, detail: Record<string, string | number | boolean> = {}): Promise<void> {
  ctx.deps.metrics.count('admin_action', [action]);
  await audit(ctx.env.DB, ctx.deps.logger, { at: ctx.now, uid: null, action: 'admin_action', target: row.job_id, detail: { action, admin: ctx.admin?.id ?? 'unknown', ...detail } });
}

function notes(ctx: RequestContext): string {
  const n = (ctx.body as { notes?: unknown } | undefined)?.notes;
  return typeof n === 'string' ? n.trim().slice(0, 500) : '';
}

export async function whoami(ctx: RequestContext): Promise<Reply> {
  return { status: 200, body: ctx.admin };
}

export async function listJobs(ctx: RequestContext): Promise<Reply> {
  const day = ctx.url.searchParams.get('day') ?? istDay(ctx.now);
  const status = ctx.url.searchParams.get('status');
  if (!isIsoDay(day)) fail('invalid', 'day must be YYYY-MM-DD');
  if (status !== null && !STATUSES.has(status)) fail('invalid', 'unknown status');
  const rows = status ? await ctx.env.DB.prepare(HSQL.jobsOfDayStatus).bind(day, status).all<JobRow>() : await ctx.env.DB.prepare(HSQL.jobsOfDay).bind(day).all<JobRow>();
  const counts: Partial<Record<HighlightStatus, number>> = {};
  for (const r of (await ctx.env.DB.prepare(HSQL.jobsOfDay).bind(day).all<JobRow>()).results) counts[r.status] = (counts[r.status] ?? 0) + 1;
  return { status: 200, body: { jobs: rows.results.map(adminJob), counts } };
}

export async function jobDetail(ctx: RequestContext): Promise<Reply> {
  const row = await jobParam(ctx);
  const moderation = (await ctx.env.DB.prepare(HSQL.moderationOf).bind(row.job_id).all<{ alias_check: 'pass' | 'fail'; anti_cheat: 'pass' | 'fail'; duplicate: 'pass' | 'fail'; reviewer: 'auto' | 'admin'; admin: string | null; decision: AdminModeration['decision']; notes: string; decided_ms: number }>()).results;
  const attribution = (await ctx.env.DB.prepare(HSQL.attributionOf).bind(row.code).all<{ day: string; event: string; n: number }>()).results;
  const body: AdminJobDetail = {
    job: adminJob(row),
    consents: await consentTrail(ctx.env, row.job_id),
    moderation: moderation.map((m) => ({ aliasCheck: m.alias_check, antiCheat: m.anti_cheat, duplicate: m.duplicate, reviewer: m.reviewer, admin: m.admin, decision: m.decision, notes: m.notes, decidedAt: new Date(m.decided_ms).toISOString() })),
    attribution,
  };
  return { status: 200, body };
}

export async function approveJob(ctx: RequestContext): Promise<Reply> {
  const row = await jobParam(ctx);
  if (!(await adminDecision(ctx.env, ctx.deps, row, ctx.admin?.id ?? 'unknown', true, notes(ctx)))) fail('conflict', `cannot approve a job that is ${row.status}`);
  await act(ctx, row, 'approve');
  return { status: 200, body: { status: row.status } };
}

export async function rejectJob(ctx: RequestContext): Promise<Reply> {
  const row = await jobParam(ctx);
  if (!(await adminDecision(ctx.env, ctx.deps, row, ctx.admin?.id ?? 'unknown', false, notes(ctx)))) fail('conflict', `cannot reject a job that is ${row.status}`);
  await act(ctx, row, 'reject');
  return { status: 200, body: { status: row.status } };
}

export async function scheduleJob(ctx: RequestContext): Promise<Reply> {
  const row = await jobParam(ctx);
  const at = Date.parse(String((ctx.body as { at?: unknown } | undefined)?.at ?? ''));
  if (!Number.isFinite(at) || at < ctx.now - 60_000 || at > ctx.now + 30 * 86_400_000) fail('invalid', 'at must be an ISO time within the next 30 days');
  if (!['approved', 'scheduled', 'upload_failed', 'dead_letter'].includes(row.status) || row.youtube_video_id) fail('conflict', `cannot schedule a job that is ${row.status}`);
  if (row.status === 'dead_letter' && !row.video_key) fail('conflict', 'this job has no rendered video; retry the render');
  refusePending(row);
  if (!(await scheduleUpload(ctx.env, ctx.deps, row, at, 'scheduled_by_admin'))) fail('conflict', 'this job can no longer be scheduled');
  await act(ctx, row, 'schedule', { at: new Date(at).toISOString() });
  return { status: 200, body: { status: row.status } };
}

export async function retryRender(ctx: RequestContext): Promise<Reply> {
  const row = await jobParam(ctx);
  if (!['render_failed', 'dead_letter', 'pending_moderation', 'upload_failed'].includes(row.status) || row.youtube_video_id) fail('conflict', `cannot re-render a job that is ${row.status}`);
  refusePending(row);
  await ctx.env.DB.prepare(HSQL.resetRender).bind(row.job_id, ctx.now).run();
  await act(ctx, row, 'retry_render');
  return { status: 200, body: { status: 'queued_render' } };
}

export async function retryUpload(ctx: RequestContext): Promise<Reply> {
  const row = await jobParam(ctx);
  if (!['upload_failed', 'dead_letter', 'scheduled', 'awaiting_channel', 'uploading'].includes(row.status) || !row.video_key || row.youtube_video_id) fail('conflict', `cannot retry the upload of a job that is ${row.status}`);
  refusePending(row);
  if (row.status === 'uploading') await ctx.env.MEDIA_QUEUE?.send({ v: 1, kind: 'upload', jobId: row.job_id });
  else if (!(await scheduleUpload(ctx.env, ctx.deps, row, ctx.now, 'retried_by_admin'))) fail('conflict', 'this job can no longer be retried');
  await act(ctx, row, 'retry_upload');
  return { status: 200, body: { status: row.status } };
}

export async function unlistJob(ctx: RequestContext): Promise<Reply> {
  const row = await jobParam(ctx);
  if (row.status !== 'published' || !row.youtube_video_id) fail('conflict', `cannot unlist a job that is ${row.status}`);
  await ctx.env.MEDIA_QUEUE?.send({ v: 1, kind: 'unlist', jobId: row.job_id });
  await act(ctx, row, 'unlist');
  return { status: 202, body: { status: row.status } };
}

export async function removeJob(ctx: RequestContext): Promise<Reply> {
  const row = await jobParam(ctx);
  if (!LIVE_STATUSES.has(row.status) && row.status !== 'uploading' && row.status !== 'removal_failed') fail('conflict', `nothing is published for a job that is ${row.status}`);
  // The intent is recorded before the message: an upload in flight stops and can never be published afterwards.
  await requestRemoval(ctx.env, ctx.deps, row, 'admin');
  await act(ctx, row, 'remove');
  return { status: 202, body: { status: row.status } };
}

async function mediaSig(ctx: RequestContext, jobId: string, exp: number): Promise<Uint8Array> {
  const key = dataKeys(ctx.env, ctx.deps.logger).active;
  return hmac(await hmacKeyFor(key.material, key.kid, 'media'), `media|${jobId}|${exp}`);
}

export async function previewUrl(ctx: RequestContext): Promise<Reply> {
  const row = await jobParam(ctx);
  if (!row.video_key) fail('not_found', 'no rendered video for this job');
  const exp = ctx.now + MEDIA_TTL_MS;
  // The origin the console called: in production the admin hostname behind Cloudflare Access, so the video request
  // carries the Access token too.
  const url = `${ctx.url.origin}/v1/admin/media/${row.job_id}?exp=${exp}&sig=${toBase64Url(await mediaSig(ctx, row.job_id, exp))}`;
  await act(ctx, row, 'preview');
  return { status: 200, body: { url, expiresAt: new Date(exp).toISOString() } };
}

/** The temporary MP4 behind a signed link (a <video> element cannot send headers); Range requests for seeking. */
export async function media(ctx: RequestContext): Promise<Reply> {
  const exp = Number(ctx.url.searchParams.get('exp'));
  const sig = fromBase64Url(ctx.url.searchParams.get('sig') ?? '');
  const jobId = ctx.params.jobId;
  if (!JOB_ID_RE.test(jobId) || !Number.isInteger(exp) || exp < ctx.now || exp > ctx.now + MEDIA_TTL_MS || !sig) fail('forbidden', 'link expired or not valid');
  if (!timingSafeEqual(await mediaSig(ctx, jobId, exp), sig)) fail('forbidden', 'link expired or not valid');
  // Behind Cloudflare Access in production the request must also carry a valid Access token.
  if (ctx.cfg.production && ctx.env.CF_ACCESS_AUD) {
    const jwt = ctx.request.headers.get('cf-access-jwt-assertion');
    if (!jwt || !(await verifyAccessJwt(ctx, jwt))) fail('unauthorized', 'admin sign-in required');
  }
  const row = await getJob(ctx.env, jobId);
  const head = row?.video_key ? await ctx.env.FILES?.head(row.video_key) : null;
  if (!row?.video_key || !head) fail('not_found', 'video not found');
  const range = /^bytes=(\d+)-(\d*)$/.exec(ctx.request.headers.get('range') ?? '');
  const headers: Record<string, string> = { 'content-type': 'video/mp4', 'accept-ranges': 'bytes', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' };
  if (range) {
    const start = Number(range[1]);
    const end = range[2] ? Math.min(Number(range[2]), head.size - 1) : head.size - 1;
    if (start >= head.size || end < start) return new Response(null, { status: 416, headers: { ...headers, 'content-range': `bytes */${head.size}` } });
    const part = await ctx.env.FILES?.get(row.video_key, { range: { offset: start, length: end - start + 1 } });
    if (!part) fail('not_found', 'video not found');
    return new Response(part.body, { status: 206, headers: { ...headers, 'content-range': `bytes ${start}-${end}/${head.size}`, 'content-length': String(end - start + 1) } });
  }
  const whole = await ctx.env.FILES?.get(row.video_key);
  if (!whole) fail('not_found', 'video not found');
  return new Response(whole.body, { status: 200, headers: { ...headers, 'content-length': String(head.size) } });
}

export async function quota(ctx: RequestContext): Promise<Reply> {
  const q = quotaConfig(ctx.env);
  const qday = pacificDay(ctx.now);
  const scheduled = new Map<string, number>();
  for (const r of (await ctx.env.DB.prepare(HSQL.scheduledByDay).all<{ scheduled_ms: number }>()).results) {
    const d = pacificDay(Math.max(ctx.now, r.scheduled_ms));
    scheduled.set(d, (scheduled.get(d) ?? 0) + 1);
  }
  const body: AdminQuota = {
    quotaDay: qday,
    nextResetAt: new Date(nextPacificMidnight(ctx.now)).toISOString(),
    daily: q.daily,
    usable: q.usable,
    ...(await usedOn(ctx.env.DB, qday)),
    perUpload: q.perUpload,
    uploadsPerDay: uploadsPerDay(q),
    headroom: q.headroom,
    scheduled: [...scheduled.entries()].sort().map(([quotaDay, jobs]) => ({ quotaDay, jobs })),
  };
  return { status: 200, body };
}

export async function deadLetters(ctx: RequestContext): Promise<Reply> {
  const out: JobRow[] = [];
  // Everything that needs an operator: failed removals first (a video may still be up), then the held and the failed.
  for (const s of ['removal_failed', 'awaiting_channel', 'dead_letter', 'upload_failed', 'render_failed'] as const) out.push(...(await ctx.env.DB.prepare(HSQL.jobsWithStatus).bind(s, 100).all<JobRow>()).results);
  return { status: 200, body: { jobs: out.map(adminJob) } };
}
