/**
 * The share cap, kept by the server (POST /v1/matches/:id/moments): each player shares each moment of a match or cup
 * at most once (the invitation, one deadline reminder, the final reveal or its highlight), so friends are not spammed
 * and clearing the app's data does not reset it. The app asks just before the share sheet opens and falls back to its
 * own ledger when it cannot reach the server (src/platform/shareMoments.ts).
 *
 *   - Any match or cup id (a cup's invitation is shared under the cup id). The answer says nothing about the match
 *     itself, only about this player's own shares, so it needs no membership read, and it also works the instant a
 *     duel was created, before the match list has caught up.
 *   - The first ask of a moment records when it was opened (D1 share_moments, migration 0007) and is allowed. Asking
 *     again within SHARE_MOMENT_GRACE_MS (a cancelled sheet, the wrong chat) is the same moment and allowed again;
 *     after that the moment is used: `allowed: false`.
 *   - Idempotent by construction (the first time is kept), so no Idempotency-Key; per-player write limits apply.
 */
import { SHARE_MOMENTS } from '@/contracts';
import { CUP_ID_RE, MATCH_ID_RE } from '@/net/shared/ids';
import type { RequestContext } from '../http/context';
import { requireActor } from '../http/context';
import { fail } from '../http/errors';
import type { Reply } from '../http/router';
import { SQL } from '../storage/sql';

/** Re-opening the same moment soon after (a cancelled share sheet, another chat) is still that one moment. */
export const SHARE_MOMENT_GRACE_MS = 10 * 60_000;

export async function claimShareMoment(ctx: RequestContext): Promise<Reply> {
  const actor = requireActor(ctx);
  const id = ctx.params.id;
  const b = ctx.body;
  if (!b || typeof b !== 'object' || Array.isArray(b)) fail('invalid', 'body must be { moment }');
  const body = b as Record<string, unknown>;
  for (const k of Object.keys(body)) if (k !== 'moment') fail('invalid', `unknown field ${k.slice(0, 32)}`);
  const moment = body.moment;
  if (typeof moment !== 'string' || !(SHARE_MOMENTS as readonly string[]).includes(moment)) fail('invalid', "moment must be 'invite', 'reminder' or 'final'");
  if (!MATCH_ID_RE.test(id) && !CUP_ID_RE.test(id)) fail('not_found', 'match not found');
  const db = ctx.env.DB;
  const [, read] = await db.batch([db.prepare(SQL.claimShareMoment).bind(actor.uid, id, moment, ctx.now), db.prepare(SQL.shareMomentFirst).bind(actor.uid, id, moment)]);
  const first = (read.results?.[0] as { first_ms?: number } | undefined)?.first_ms ?? ctx.now;
  const allowed = ctx.now - first < SHARE_MOMENT_GRACE_MS;
  ctx.deps.metrics.count(allowed ? 'share_moment' : 'share_moment_refused', [moment]);
  return { status: 200, body: { allowed } };
}
