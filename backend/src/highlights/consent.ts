/**
 * Consent before rendering. Participants review the exact cut in the app (GET /v1/highlights/:jobId/preview returns the
 * HighlightRenderInput the trusted renderer will use, composed on the device by the same deterministic composer), with
 * the aliases, title, description and visibility. Publication needs every participant: "granted" with the 18+
 * confirmation and a visibility (the stricter choice wins: unlisted over public). Any decline means no video (the
 * Top 100 badge stays); no answer within 48 h counts as declined. A withdrawal is possible at any time: before the
 * upload it cancels the job; during or after it, the video is removed through the adapter. Every decision is an
 * append-only highlight_consents row (the audit trail); nothing is ever published without explicit consent.
 */
import type { ConsentRecord, ConsentRequest, HighlightJob, HighlightPreview, Visibility, WithdrawConsentRequest } from '@/contracts';
import type { RequestContext } from '../http/context';
import { requireActor } from '../http/context';
import { fail } from '../http/errors';
import type { Reply } from '../http/router';
import type { Config } from '../config';
import { DAY_MS } from '../config';
import type { Env } from '../env';
import type { WorkerDeps } from '../http/context';
import { dayIso, hourIso } from '../http/http';
import { renderInputFor } from './jobs';
import { BEFORE_UPLOAD, LIVE_STATUSES, JOB_ID_RE, consentOf, jobOf, latestDecisions, participantIndex, strictestVisibility, type ConsentRow, type JobRow } from './model';
import { moderateConsented } from './moderation';
import { cancelJob, getJob, requestRemoval, transition } from './pipeline';
import { HSQL } from './sql';
import { requireLiveSession } from '../auth/routes';
import { requireAccount } from '../profile/model';

const MINE_DAYS = 30;

/** The job and the caller's seat in it; decisions need a live session and an active account (`decide`). */
async function participantJob(ctx: RequestContext, decide = false): Promise<{ row: JobRow; seat: 0 | 1 }> {
  const actor = decide ? await requireLiveSession(ctx) : requireActor(ctx);
  if (decide) await requireAccount(ctx.env.DB, actor.uid);
  const jobId = ctx.params.jobId;
  const row = JOB_ID_RE.test(jobId) ? await getJob(ctx.env, jobId) : null;
  const seat = row ? participantIndex(row, actor.uid) : null;
  // Not a participant and not found look the same.
  if (!row || seat === null) fail('not_found', 'highlight not found');
  return { row, seat };
}

async function consentRows(env: Env, jobId: string): Promise<ConsentRow[]> {
  return (await env.DB.prepare(HSQL.consentsOf).bind(jobId).all<ConsentRow>()).results;
}

async function record(env: Env, deps: WorkerDeps, row: JobRow, seat: 0 | 1, decision: ConsentRecord['decision'], adult: boolean, visibility: Visibility, reason: string | null): Promise<ConsentRecord> {
  const uid = seat === 0 ? row.uid0 : row.uid1;
  const pid = seat === 0 ? row.pid0 : row.pid1;
  const now = deps.now();
  await env.DB.prepare(HSQL.insertConsent).bind(row.job_id, uid, pid, decision, adult ? 1 : 0, row.title, visibility, reason, now).run();
  return { jobId: row.job_id, playerId: pid, decision, adultConfirmed: adult, approvedTitle: row.title, approvedVisibility: visibility, decidedHour: hourIso(now) };
}

/** Everyone granted: the stricter visibility, then the automatic checks (render or reject). */
async function evaluate(env: Env, deps: WorkerDeps, cfg: Config, row: JobRow): Promise<void> {
  const latest = latestDecisions(await consentRows(env, row.job_id));
  const decisions = [latest.get(row.uid0), latest.get(row.uid1)];
  if (decisions.some((d) => d?.decision === 'declined' || d?.decision === 'withdrawn')) {
    await transition(env, deps, row, 'consent_declined', 'declined');
    return;
  }
  if (!decisions.every((d) => d?.decision === 'granted' && d.adult === 1)) return;
  const visibility = strictestVisibility(decisions.map((d) => (d as ConsentRow).approved_visibility));
  await env.DB.prepare(HSQL.setVisibility).bind(row.job_id, visibility, deps.now()).run();
  row.visibility = visibility;
  await moderateConsented(env, deps, cfg, row);
}

export async function myHighlights(ctx: RequestContext): Promise<Reply> {
  const actor = requireActor(ctx);
  const since = dayIso(ctx.now - MINE_DAYS * DAY_MS);
  const { results } = await ctx.env.DB.prepare(HSQL.jobsOfUid).bind(actor.uid, since).all<JobRow>();
  const body: HighlightJob[] = results.map(jobOf);
  return { status: 200, body };
}

export async function previewHighlight(ctx: RequestContext): Promise<Reply> {
  const { row, seat } = await participantJob(ctx);
  const input = await renderInputFor(ctx.env, ctx.cfg, row);
  if (!input) fail('unavailable', 'the replay of this match is not available');
  const latest = latestDecisions(await consentRows(ctx.env, row.job_id)).get(seat === 0 ? row.uid0 : row.uid1);
  const body: HighlightPreview = { job: jobOf(row), input, myDecision: latest?.decision ?? null };
  return { status: 200, body };
}

export async function decideConsent(ctx: RequestContext): Promise<Reply> {
  const { row, seat } = await participantJob(ctx, true);
  const b = (ctx.body ?? {}) as Partial<ConsentRequest>;
  if (b.decision !== 'granted' && b.decision !== 'declined') fail('invalid', 'decision must be granted or declined');
  if (b.visibility !== 'public' && b.visibility !== 'unlisted') fail('invalid', 'visibility must be public or unlisted');
  if (typeof b.adultConfirmed !== 'boolean') fail('invalid', 'adultConfirmed must be true or false');
  if (b.decision === 'granted' && !b.adultConfirmed) fail('invalid', 'publication needs your confirmation that you are 18 or older');
  if (row.status !== 'pending_consent' || ctx.now > row.consent_by_ms) fail('conflict', 'this highlight is no longer waiting for consent');
  const rec = await record(ctx.env, ctx.deps, row, seat, b.decision, b.adultConfirmed, b.visibility, null);
  await evaluate(ctx.env, ctx.deps, ctx.cfg, row);
  return { status: 200, body: rec };
}

export async function withdrawConsent(ctx: RequestContext): Promise<Reply> {
  const { row, seat } = await participantJob(ctx, true);
  const b = (ctx.body ?? {}) as Partial<WithdrawConsentRequest>;
  const reason = typeof b.reason === 'string' ? b.reason.slice(0, 200) : null;
  const rec = await record(ctx.env, ctx.deps, row, seat, 'withdrawn', false, row.visibility, reason ? `player: ${reason}` : 'player');
  await applyWithdrawal(ctx.env, ctx.deps, row, 'withdrawn');
  return { status: 200, body: rec };
}

/**
 * Cancels before the upload, removes during or after it (also used by account deletion). The intent is written first
 * (withdraw_pending), so a step racing this one sees it: the uploader stops before its session, at every chunk and
 * before it publishes; scheduling refuses the job. A compare-and-swap that loses the race re-reads the job and acts on
 * what it is now, and anything still moving is left to the uploader and the sweeper, which remove it.
 */
export async function applyWithdrawal(env: Env, deps: WorkerDeps, row: JobRow, reason: string): Promise<void> {
  await env.DB.prepare(HSQL.markWithdraw).bind(row.job_id, deps.now()).run();
  let current: JobRow | null = { ...row, withdraw_pending: 1 };
  for (let i = 0; i < 4 && current; i++) {
    if (BEFORE_UPLOAD.has(current.status)) {
      if (await cancelJob(env, deps, current, reason)) return;
      current = await getJob(env, row.job_id);
      continue;
    }
    if (current.status === 'uploading' || LIVE_STATUSES.has(current.status)) await requestRemoval(env, deps, current);
    return;
  }
  if (current) await env.MEDIA_QUEUE?.send({ v: 1, kind: 'remove', jobId: row.job_id });
}

/** No answer within 48 h counts as declined (one system record per participant who did not decide). */
export async function expireConsent(env: Env, deps: WorkerDeps, row: JobRow): Promise<void> {
  if (row.status !== 'pending_consent') return;
  const latest = latestDecisions(await consentRows(env, row.job_id));
  for (const seat of [0, 1] as const) {
    const uid = seat === 0 ? row.uid0 : row.uid1;
    if (!latest.has(uid)) await record(env, deps, row, seat, 'declined', false, row.visibility, 'timeout');
  }
  await transition(env, deps, row, 'consent_declined', 'consent_timeout');
}

/** Account deletion withdraws every consent: open jobs are cancelled and live videos removed. */
export async function withdrawForDeletion(env: Env, deps: WorkerDeps, uid: string): Promise<number> {
  const { results } = await env.DB.prepare(HSQL.liveJobsOfUid).bind(uid).all<JobRow>();
  for (const row of results) {
    const seat = participantIndex(row, uid);
    if (seat === null) continue;
    await record(env, deps, row, seat, 'withdrawn', false, row.visibility, 'account_deleted');
    await applyWithdrawal(env, deps, row, 'account_deleted');
  }
  return results.length;
}

export async function consentTrail(env: Env, jobId: string): Promise<Array<ConsentRecord & { reason: string | null }>> {
  return (await consentRows(env, jobId)).map((r) => ({ ...consentOf(jobId, r), reason: r.reason }));
}
