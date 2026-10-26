/** Worker routes for Group Cups; the cup's Durable Object does the work. */
import type { CreateCupRequest, CreateCupResponse } from '@/contracts';
import { checkGroupName } from '@/net/shared/alias';
import { CUP_ID_RE, inviteUrl } from '@/net/shared/ids';
import { publicWebOrigin } from '../config';
import type { RequestContext } from '../http/context';
import { requireActor } from '../http/context';
import { fail } from '../http/errors';
import type { Reply } from '../http/router';
import { enforceDailyCap } from '../guards/limits';
import { randomId } from '../security/crypto';
import { playerRefOf, requireAccount, requireSocial } from '../profile/model';
import { callCup } from './client';
import { MAX_CUP_PLAYERS, MIN_CUP_PLAYERS, PACES } from './schedule';

export const CUPS_PER_PLAYER_PER_DAY = 10;

export async function createCup(ctx: RequestContext): Promise<Reply> {
  const actor = requireActor(ctx);
  const b = (ctx.body ?? {}) as Partial<CreateCupRequest>;
  const name = checkGroupName(b.name);
  if (!name.ok) fail('invalid', `cup name not allowed (${name.reason})`);
  if (!Number.isInteger(b.maxPlayers) || (b.maxPlayers as number) < MIN_CUP_PLAYERS || (b.maxPlayers as number) > MAX_CUP_PLAYERS) fail('invalid', `maxPlayers must be ${MIN_CUP_PLAYERS}–${MAX_CUP_PLAYERS}`);
  // Own keys only: `in` would also accept inherited names such as "toString" or "constructor".
  if (typeof b.pace !== 'string' || !Object.hasOwn(PACES, b.pace)) fail('invalid', 'pace must be sprint, daily or weekend');
  await enforceDailyCap({ env: ctx.env, cfg: ctx.cfg, metrics: ctx.deps.metrics, salt: ctx.salt, ip: ctx.ip, uid: actor.uid, now: ctx.now }, 'day-cup', `u:${actor.uid}`, CUPS_PER_PLAYER_PER_DAY);
  const account = await requireAccount(ctx.env.DB, actor.uid);
  requireSocial(account, ctx.now);
  const cupId = randomId('c');
  const created = await callCup<{ inviteToken: string }>(ctx.env, ctx.cfg, cupId, {
    op: 'create',
    cupId,
    name: name.value,
    pace: b.pace as CreateCupRequest['pace'],
    maxPlayers: b.maxPlayers as number,
    creator: { uid: actor.uid, ref: playerRefOf(account) },
  });
  const body: CreateCupResponse = { cupId, inviteToken: created.body.inviteToken, inviteUrl: inviteUrl(publicWebOrigin(ctx.env), created.body.inviteToken) };
  return { status: 201, body };
}

export function getCup(ctx: RequestContext): Promise<Reply> {
  if (!CUP_ID_RE.test(ctx.params.id)) fail('not_found', 'cup not found');
  return callCup(ctx.env, ctx.cfg, ctx.params.id, { op: 'view', uid: requireActor(ctx).uid });
}
