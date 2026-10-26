/**
 * Shared match links (https://<web>/s/<code>): a participant shares a revealed duel or cup match with anyone.
 *
 *   POST /v1/matches/:id/share  participant only, revealed matches only; one code per match, derived with a keyed
 *                               HMAC (cannot be guessed from the match id), so asking twice, from either player or
 *                               either device, gives the same link.
 *   GET  /v1/s/:code            public: conditions, the moderated display names (each player's current alias, or
 *                               "Deleted player" once they deleted their account) and the replay rewritten with them,
 *                               so no match-time alias ever leaves through a shared link.
 *
 * Deleting an account scrubs it from shared_matches (profile/routes.ts); the replay itself is rewritten by the match
 * object and re-archived, and this endpoint rewrites the names again on every read.
 */
import type { MatchEventLog, PlayerRef, SharedMatch } from '@/contracts';
import { MATCH_ID_RE, SHARED_CODE_RE, sharedUrl } from '@/net/shared/ids';
import { publicWebOrigin } from '../config';
import type { Env } from '../env';
import type { RequestContext, WorkerDeps } from '../http/context';
import { requireActor } from '../http/context';
import { fail } from '../http/errors';
import type { Reply } from '../http/router';
import { DELETED_PLAYER } from '../profile/model';
import { hmac, hmacKeyFor } from '../security/crypto';
import { toBase32, utf8 } from '../security/encoding';
import { identityPepper } from '../security/secrets';
import { SQL } from '../storage/sql';
import { loadLog } from '../highlights/jobs';

/** The match's one public code: 10 base32 characters ([a-z2-7], within the 4–16 [a-z0-9] link shape). */
export async function sharedCodeFor(env: Env, deps: WorkerDeps, matchId: string): Promise<string> {
  const key = await hmacKeyFor(utf8(identityPepper(env, deps.logger)), 'pepper', 'share');
  return toBase32(await hmac(key, `share|${matchId}`)).slice(0, 10);
}

export async function shareMatch(ctx: RequestContext): Promise<Reply> {
  const actor = requireActor(ctx);
  const matchId = ctx.params.id;
  if (!MATCH_ID_RE.test(matchId)) fail('not_found', 'match not found');
  const db = ctx.env.DB;
  // Participants only: the player's own match-list row (duels and cup matches; never a Daily Six attempt).
  const mine = await db.prepare(SQL.sharedMatchOfUid).bind(actor.uid, matchId).first<{ phase: string }>();
  if (!mine) fail('not_found', 'match not found');
  if (mine.phase !== 'revealed') fail('conflict', 'only a revealed match can be shared');
  const result = await db.prepare(SQL.resultSeats).bind(matchId).first<{ kind: 'duel' | 'cup'; uid0: string; uid1: string }>();
  // The result row is written with the reveal; a share asked in the same instant waits for it.
  if (!result) fail('conflict', 'the result is still being recorded; try again in a moment', { headers: { 'retry-after': '2' } });
  const code = await sharedCodeFor(ctx.env, ctx.deps, matchId);
  await db.prepare(SQL.insertSharedMatch).bind(code, matchId, result.kind, result.uid0, result.uid1, ctx.now).run();
  ctx.deps.metrics.count('match_shared', [result.kind]);
  return { status: 200, body: { code, url: sharedUrl(publicWebOrigin(ctx.env), code) } };
}

export async function sharedMatch(ctx: RequestContext): Promise<Reply> {
  const code = ctx.params.code;
  if (!SHARED_CODE_RE.test(code)) fail('not_found', 'shared match not found');
  const db = ctx.env.DB;
  const row = await db.prepare(SQL.sharedMatchByCode).bind(code).first<{ match_id: string; kind: 'duel' | 'cup'; uid0: string; uid1: string; alias0: string | null; status0: string | null; alias1: string | null; status1: string | null }>();
  if (!row) fail('not_found', 'shared match not found');
  const log = await loadLog(ctx.env, ctx.cfg, { match_id: row.match_id, uid0: row.uid0 });
  if (!log) fail('unavailable', 'replay not available');
  const name = (uid: string, alias: string | null, status: string | null) => (uid.startsWith('x:') || status !== 'active' || !alias ? null : alias);
  const names = [name(row.uid0, row.alias0, row.status0), name(row.uid1, row.alias1, row.status1)] as const;
  const players = log.players.map((p, i): PlayerRef => (names[i] === null ? DELETED_PLAYER : { ...p, alias: names[i] as string })) as MatchEventLog['players'];
  const body: SharedMatch = {
    code,
    kind: row.kind,
    conditions: { pitch: log.conditions.pitch, weather: log.conditions.weather },
    aliases: [players[0].alias, players[1].alias],
    log: { ...log, players },
  };
  return { status: 200, body, headers: { 'cache-control': 'public, max-age=300' } };
}
