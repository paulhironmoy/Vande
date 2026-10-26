/**
 * Public highlight landing (https://<web>/h/<code>) and attribution. Only consented videos that are published or
 * unlisted are visible; anything else is 404. Mock-upload ids are never shown (the landing plays the replay instead).
 * Attribution: the client reports landing_open, share and install (install from the Play referrer carrying the code);
 * the server itself counts invite_open and match_completed for duels started with the code. Counters per code per
 * IST day only: no person, device or address is stored.
 */
import type { AttributionEvent, HighlightPublic, MatchEventLog } from '@/contracts';
import { HIGHLIGHT_CODE_RE } from '@/net/shared/ids';
import type { RequestContext } from '../http/context';
import { fail } from '../http/errors';
import type { Reply } from '../http/router';
import { istDay } from '../time';
import { loadLog } from './jobs';
import { LIVE_STATUSES, isMockVideoId, type JobRow } from './model';
import { HSQL } from './sql';

const EVENTS: ReadonlySet<AttributionEvent> = new Set(['landing_open', 'share', 'install']);

async function liveJob(ctx: RequestContext): Promise<JobRow> {
  const code = ctx.params.code;
  const row = HIGHLIGHT_CODE_RE.test(code) ? await ctx.env.DB.prepare(HSQL.jobByCode).bind(code).first<JobRow>() : null;
  if (!row || !LIVE_STATUSES.has(row.status)) fail('not_found', 'highlight not found');
  return row;
}

export async function highlightLanding(ctx: RequestContext): Promise<Reply> {
  const row = await liveJob(ctx);
  const body: HighlightPublic = {
    code: row.code,
    day: row.day,
    title: row.title,
    youtubeVideoId: isMockVideoId(row.youtube_video_id) ? null : row.youtube_video_id,
    visibility: row.visibility,
    matchId: row.match_id,
    participants: [
      { alias: row.alias0, avatar: { seed: row.avatar0 }, rank: row.rank0 },
      { alias: row.alias1, avatar: { seed: row.avatar1 }, rank: row.rank1 },
    ],
  };
  return { status: 200, body, headers: { 'cache-control': 'public, max-age=300' } };
}

export async function highlightReplay(ctx: RequestContext): Promise<Reply> {
  const row = await liveJob(ctx);
  const log: MatchEventLog | null = await loadLog(ctx.env, ctx.cfg, row);
  if (!log) fail('unavailable', 'replay not available');
  return { status: 200, body: log, headers: { 'cache-control': 'public, max-age=3600' } };
}

export async function countAttribution(ctx: Pick<RequestContext, 'env' | 'deps' | 'now'>, code: string, event: string, n = 1): Promise<void> {
  await ctx.env.DB.prepare(HSQL.countAttribution).bind(code, istDay(ctx.now), event, n).run();
  ctx.deps.metrics.count('attribution', [event]);
}

export async function postAttribution(ctx: RequestContext): Promise<Reply> {
  const b = (ctx.body ?? {}) as { code?: unknown; event?: unknown };
  if (typeof b.code !== 'string' || !HIGHLIGHT_CODE_RE.test(b.code)) fail('invalid', 'code is not valid');
  if (typeof b.event !== 'string' || !EVENTS.has(b.event as AttributionEvent)) fail('invalid', 'event must be landing_open, share or install');
  // Only live highlights count (unknown codes cannot fill the table).
  if (!(await ctx.env.DB.prepare(HSQL.liveCode).bind(b.code).first())) fail('not_found', 'highlight not found');
  await countAttribution(ctx, b.code, b.event);
  return { status: 200, body: { ok: true } };
}

/** A duel's attribution code, when it names a live highlight (anything else is ignored, never an error). */
export async function validAttribution(ctx: RequestContext, code: unknown): Promise<string | null> {
  if (typeof code !== 'string' || !HIGHLIGHT_CODE_RE.test(code)) return null;
  return (await ctx.env.DB.prepare(HSQL.liveCode).bind(code).first()) ? code : null;
}
