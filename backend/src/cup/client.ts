/** Calls into a Group Cup's Durable Object. */
import type { ApiErrorCode } from '@/contracts';
import type { Config } from '../config';
import type { Env } from '../env';
import { ApiFailure } from '../http/errors';
import type { CupOp } from './protocol';

export async function callCup<T = unknown>(env: Env, cfg: Config, cupId: string, op: CupOp): Promise<{ status: number; body: T }> {
  if (!env.CUP) throw new ApiFailure('unavailable', 'cups are not configured');
  const ns = env.CUP;
  const stub = ns.get(ns.idFromName(cupId), cfg.locationHint ? { locationHint: cfg.locationHint } : undefined);
  const res = await stub.fetch(new Request(`https://cup.internal/${op.op}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(op) }));
  const body = (await res.json().catch(() => null)) as unknown;
  if (res.status >= 400) {
    const err = (body as { error?: { code?: ApiErrorCode; message?: string } } | null)?.error;
    const retryAfter = res.headers.get('retry-after');
    throw new ApiFailure(err?.code ?? 'unavailable', err?.message ?? 'cup unavailable', { status: res.status, headers: retryAfter ? { 'retry-after': retryAfter } : {} });
  }
  return { status: res.status, body: body as T };
}
