/**
 * Leaderboards of the Daily Six best scores (best of three per IST day): national, city (the player's own city),
 * college and company (private groups: members only), friends (players you finished a duel or cup match with).
 * Ranks share ties. "total" is the real number of ranked players. Rank and totals for national and city come from the
 * trigger-maintained score histogram (a few hundred rows read), never from a scan.
 */
import type { LeaderboardEntry, LeaderboardScope, LeaderboardView } from '@/contracts';
import { GROUP_ID_RE } from '@/net/shared/ids';
import type { RequestContext } from '../http/context';
import { requireActor } from '../http/context';
import { fail } from '../http/errors';
import type { Reply } from '../http/router';
import { SQL } from '../storage/sql';
import { requireAccount } from '../profile/model';
import { isIsoDay, istDay } from '../time';

const SCOPES: readonly LeaderboardScope[] = ['national', 'city', 'college', 'company', 'friends'];
export const LEADERBOARD_SIZE = 100;
/** How far back a leaderboard can be read (days). */
export const LEADERBOARD_HISTORY_DAYS = 30;

interface Row {
  uid: string;
  player_id: string;
  alias: string;
  avatar_seed: string;
  best_score: number;
}

function ranked(rows: Row[], myUid: string): LeaderboardEntry[] {
  let rank = 0;
  let last = Number.POSITIVE_INFINITY;
  return rows.map((r, i) => {
    if (r.best_score < last) {
      rank = i + 1;
      last = r.best_score;
    }
    return { rank, playerId: r.player_id, alias: r.alias, avatar: { seed: r.avatar_seed }, score: r.best_score, isMe: r.uid === myUid };
  });
}

export async function getLeaderboard(ctx: RequestContext): Promise<Reply> {
  const actor = requireActor(ctx);
  const scope = ctx.params.scope as LeaderboardScope;
  if (!SCOPES.includes(scope)) fail('not_found', 'unknown leaderboard');
  const today = istDay(ctx.now);
  const asked = ctx.url.searchParams.get('day');
  const day = asked ?? today;
  if (!isIsoDay(day) || day > today || Date.parse(today) - Date.parse(day) > LEADERBOARD_HISTORY_DAYS * 86_400_000) fail('invalid', `day must be one of the last ${LEADERBOARD_HISTORY_DAYS} IST days`);
  const db = ctx.env.DB;
  const mine = await db.prepare(SQL.dailyScoreRow).bind(day, actor.uid).first<{ best_score: number }>();
  const account = await requireAccount(db, actor.uid);
  const myEntry = (rank: number): LeaderboardEntry | null =>
    mine ? { rank, playerId: account.player_id, alias: account.alias, avatar: { seed: account.avatar_seed }, score: mine.best_score, isMe: true } : null;
  let rows: Row[] = [];
  let total = 0;
  let me: LeaderboardEntry | null = null;
  let groupId: string | undefined;

  if (scope === 'national' || scope === 'city') {
    const key = scope === 'national' ? 'national' : account.city ? `city:${account.city}` : null;
    if (key) {
      rows = (scope === 'national' ? await db.prepare(SQL.topNational).bind(day, LEADERBOARD_SIZE).all<Row>() : await db.prepare(SQL.topCity).bind(day, account.city, LEADERBOARD_SIZE).all<Row>()).results;
      total = Number((await db.prepare(SQL.histogramTotal).bind(day, key).first<{ n: number }>())?.n ?? 0);
      if (mine) me = myEntry(Number((await db.prepare(SQL.histogramAbove).bind(day, key, mine.best_score).first<{ n: number }>())?.n ?? 0) + 1);
    }
  } else if (scope === 'college' || scope === 'company') {
    groupId = ctx.url.searchParams.get('groupId') ?? '';
    if (!GROUP_ID_RE.test(groupId)) fail('invalid', 'groupId is required');
    const member = await db.prepare(SQL.membershipKind).bind(actor.uid, groupId).first<{ kind: string }>();
    // Private: only members see a group's board, and only on its own scope.
    if (!member || member.kind !== scope) fail('forbidden', 'only members can see this group');
    rows = (await db.prepare(SQL.topGroup).bind(groupId, day, LEADERBOARD_SIZE).all<Row>()).results;
    const c = await db.prepare(SQL.countGroup).bind(groupId, day, mine?.best_score ?? Number.MAX_SAFE_INTEGER).first<{ total: number; above: number }>();
    total = Number(c?.total ?? 0);
    if (mine) me = myEntry(Number(c?.above ?? 0) + 1);
  } else {
    rows = (await db.prepare(SQL.topFriends).bind(actor.uid, day, LEADERBOARD_SIZE).all<Row>()).results;
    const c = await db.prepare(SQL.countFriends).bind(actor.uid, day, mine?.best_score ?? Number.MAX_SAFE_INTEGER).first<{ total: number; above: number }>();
    total = Number(c?.total ?? 0);
    if (mine) me = myEntry(Number(c?.above ?? 0) + 1);
  }
  ctx.deps.metrics.count('leaderboard_read', [scope]);
  const view: LeaderboardView = { scope, day, ...(groupId ? { groupId } : {}), entries: ranked(rows, actor.uid), me, total };
  return { status: 200, body: view, headers: { 'cache-control': 'private, max-age=30' } };
}
