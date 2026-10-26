/** Worker-side calls into a match's Durable Object. */
import type { ApiErrorCode } from '@/contracts';
import type { Config } from '../config';
import type { Env } from '../env';
import { ApiFailure } from '../http/errors';
import type { MatchOp } from './protocol';

export async function callMatch<T = unknown>(env: Env, cfg: Config, matchId: string, op: MatchOp): Promise<{ status: number; body: T }> {
  const ns = env.MATCH;
  const stub = ns.get(ns.idFromName(matchId), cfg.locationHint ? { locationHint: cfg.locationHint } : undefined);
  const res = await stub.fetch(
    new Request(`https://match.internal/${op.op}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(op) }),
  );
  const body = (await res.json().catch(() => null)) as unknown;
  if (res.status >= 400) {
    const err = (body as { error?: { code?: ApiErrorCode; message?: string } } | null)?.error;
    const retryAfter = res.headers.get('retry-after');
    throw new ApiFailure(err?.code ?? 'unavailable', err?.message ?? 'match unavailable', { status: res.status, headers: retryAfter ? { 'retry-after': retryAfter } : {} });
  }
  return { status: res.status, body: body as T };
}
