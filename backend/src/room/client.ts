/** Calls into a Cricket Room's Durable Object (best effort for system posts: a room failure never breaks a match). */
import type { ApiErrorCode } from '@/contracts';
import type { Config } from '../config';
import type { Env } from '../env';
import { ApiFailure } from '../http/errors';
import type { RoomOp } from './protocol';

export async function callRoom<T = unknown>(env: Env, cfg: Config, roomId: string, op: RoomOp): Promise<{ status: number; body: T }> {
  if (!env.ROOM) throw new ApiFailure('unavailable', 'rooms are not configured');
  const ns = env.ROOM;
  const stub = ns.get(ns.idFromName(roomId), cfg.locationHint ? { locationHint: cfg.locationHint } : undefined);
  const res = await stub.fetch(new Request(`https://room.internal/${op.op}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(op) }));
  const body = (await res.json().catch(() => null)) as unknown;
  if (res.status >= 400) {
    const err = (body as { error?: { code?: ApiErrorCode; message?: string } } | null)?.error;
    throw new ApiFailure(err?.code ?? 'unavailable', err?.message ?? 'room unavailable', { status: res.status });
  }
  return { status: res.status, body: body as T };
}

/** A system post or membership change that must not fail the caller. */
export async function roomBestEffort(env: Env, cfg: Config, roomId: string, op: RoomOp): Promise<boolean> {
  try {
    await callRoom(env, cfg, roomId, op);
    return true;
  } catch {
    return false;
  }
}
