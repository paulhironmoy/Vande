/**
 * GET /v1/top100/:day — frozen days only. Today (and any day the cutoff has not frozen yet) answers 409 `sealed`
 * "decided at 00:00 IST" with the time in `x-decided-at`: never a provisional or padded list. An entry carries
 * `highlightCode` (its public landing) only while the highlight of its best match is live: every participant
 * consented and it is published or unlisted, and nobody is withdrawing it.
 */
import type { Top100Components, Top100Entry } from '@/contracts';
import type { RequestContext } from '../http/context';
import { fail } from '../http/errors';
import type { Reply } from '../http/router';
import { isIsoDay, istDay } from '../time';
import { HSQL } from '../highlights/sql';

export async function getTop100(ctx: RequestContext): Promise<Reply> {
  const day = ctx.params.day;
  if (!isIsoDay(day)) fail('invalid', 'day must be YYYY-MM-DD');
  const today = istDay(ctx.now);
  const frozen = day < today ? await ctx.env.DB.prepare(HSQL.dayFrozen).bind(day).first<{ frozen_ms: number }>() : null;
  if (!frozen) {
    if (day > today) fail('not_found', 'that day has not started yet');
    // The cutoff for an IST day runs at the midnight that ends it: 18:30 UTC on that date.
    const decidedAt = new Date(Date.parse(`${day}T18:30:00Z`)).toISOString();
    fail('sealed', `The Top 100 for ${day} is decided at 00:00 IST`, { headers: { 'x-decided-at': decidedAt } });
  }
  const { results } = await ctx.env.DB.prepare(HSQL.entriesOfDay).bind(day).all<{ rank: number; player_id: string; alias: string; score: number; match_ids: string; best_match_id: string; components: string }>();
  const live = new Map((await ctx.env.DB.prepare(HSQL.liveCodesOfDay).bind(day).all<{ match_id: string; code: string }>()).results.map((j) => [j.match_id, j.code]));
  const entries: Top100Entry[] = results.map((r) => ({
    day,
    rank: r.rank,
    playerId: r.player_id,
    alias: r.alias,
    score: r.score,
    matchIds: JSON.parse(r.match_ids) as string[],
    bestMatchId: r.best_match_id,
    components: JSON.parse(r.components) as Top100Components,
    highlightCode: live.get(r.best_match_id) ?? null,
  }));
  return { status: 200, body: entries, headers: { 'cache-control': 'public, max-age=600' } };
}
