/** Worker routes for Cricket Rooms (members only; blocked players' posts are hidden from the blocker). */
import type { BanterRequest, ReactRequest, RoomSettingsRequest } from '@/contracts';
import type { RequestContext } from '../http/context';
import { requireActor } from '../http/context';
import { fail } from '../http/errors';
import type { Reply } from '../http/router';
import { callRoom } from './client';
import { requireAccount, requireSocial } from '../profile/model';

/** Room writes come from active accounts only (an unexpired token of a deleted account posts nothing). */
async function member(ctx: RequestContext): Promise<string> {
  const uid = requireActor(ctx).uid;
  await requireAccount(ctx.env.DB, uid);
  return uid;
}

/** Posts and reactions also need an account no moderator has paused (settings such as mute never do). */
async function poster(ctx: RequestContext): Promise<string> {
  const uid = requireActor(ctx).uid;
  requireSocial(await requireAccount(ctx.env.DB, uid), ctx.now);
  return uid;
}

const ROOM_ID_RE = /^r[a-z2-7]{26}$/;

function roomId(ctx: RequestContext): string {
  if (!ROOM_ID_RE.test(ctx.params.id)) fail('not_found', 'room not found');
  return ctx.params.id;
}

function body(ctx: RequestContext): Record<string, unknown> {
  if (!ctx.body || typeof ctx.body !== 'object' || Array.isArray(ctx.body)) fail('invalid', 'body must be a JSON object');
  return ctx.body as Record<string, unknown>;
}

export async function getRoom(ctx: RequestContext): Promise<Reply> {
  const actor = requireActor(ctx);
  const id = roomId(ctx);
  const cursor = ctx.url.searchParams.get('cursor');
  const blocked = await ctx.env.DB.prepare('SELECT blocked_player_id FROM blocks WHERE uid = ?1').bind(actor.uid).all<{ blocked_player_id: string }>();
  return callRoom(ctx.env, ctx.cfg, id, { op: 'view', uid: actor.uid, cursor: cursor && /^\d{1,9}$/.test(cursor) ? cursor : null, hidden: blocked.results.map((r) => r.blocked_player_id) });
}

export async function react(ctx: RequestContext): Promise<Reply> {
  const b = body(ctx) as Partial<ReactRequest>;
  const id = roomId(ctx);
  return callRoom(ctx.env, ctx.cfg, id, { op: 'react', uid: await poster(ctx), postId: String(b.postId ?? ''), reaction: b.reaction ?? null });
}

export async function banter(ctx: RequestContext): Promise<Reply> {
  const b = body(ctx) as Partial<BanterRequest>;
  const id = roomId(ctx);
  await callRoom(ctx.env, ctx.cfg, id, { op: 'banter', uid: await poster(ctx), phraseId: b.phraseId as BanterRequest['phraseId'] });
  return { status: 200, body: { ok: true } };
}

export async function text(ctx: RequestContext): Promise<Reply> {
  const b = body(ctx);
  if (typeof b.text !== 'string') fail('invalid', 'text is required');
  const id = roomId(ctx);
  await callRoom(ctx.env, ctx.cfg, id, { op: 'text', uid: await poster(ctx), text: b.text });
  return { status: 200, body: { ok: true } };
}

export async function settings(ctx: RequestContext): Promise<Reply> {
  const b = body(ctx) as RoomSettingsRequest;
  const id = roomId(ctx);
  return callRoom(ctx.env, ctx.cfg, id, { op: 'settings', uid: await member(ctx), muted: b.muted, notify: b.notify });
}
