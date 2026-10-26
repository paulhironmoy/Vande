/**
 * Idempotency-Key handling for mutations served by the Worker (auth, profile, groups, duel creation, push, reports).
 *
 *   1. Claim (scope, key) with a pending record (one INSERT … ON CONFLICT DO NOTHING).
 *   2. Someone else holds it: same request and done → replay the stored response; same request still pending →
 *      409 conflict with retry-after (or take it over when the holder died); different request → 409 conflict.
 *   3. Run the handler; store a 2xx–4xx JSON reply (encrypted: replies can hold tokens) or release the claim when the
 *      handler threw, so a retry recomputes.
 *
 * Match mutations (lock, bat, accept, rematch) keep their records inside the match's Durable Object instead, in the
 * same atomic write as the state change.
 */
import { IDEMPOTENCY_PENDING_MS, IDEMPOTENCY_TTL_MS } from '../config';
import type { D1Like } from '../env';
import { fail } from '../http/errors';
import type { Reply } from '../http/router';
import type { Keyring } from '../security/keyring';
import { open, seal, sha256Hex } from '../security/crypto';
import { SQL } from '../storage/sql';
import type { Metrics } from '../ops/metrics';

export interface IdempotencyInput {
  db: D1Like;
  dataKeys: Keyring;
  metrics: Metrics;
  scope: string;
  key: string;
  route: string;
  /** Route params and raw body: what makes two requests "the same". */
  fingerprint: string;
  now: number;
}

interface Row {
  route: string;
  req_hash: string;
  state: 'pending' | 'done';
  status: number | null;
  body_enc: string | null;
  created_ms: number;
}

export async function requestHash(route: string, fingerprint: string): Promise<string> {
  return sha256Hex(`${route}\n${fingerprint}`);
}

export async function withIdempotency(i: IdempotencyInput, run: () => Promise<Reply>): Promise<Reply> {
  const reqHash = await requestHash(i.route, i.fingerprint);
  const claimed = await i.db.prepare(SQL.claimIdempotency).bind(i.scope, i.key, i.route, reqHash, i.now, i.now + IDEMPOTENCY_TTL_MS).run();
  if ((claimed.meta?.changes ?? 0) === 0) {
    const row = await i.db.prepare(SQL.idempotencyRow).bind(i.scope, i.key).first<Row>();
    if (!row) fail('conflict', 'request in progress, retry', { headers: { 'retry-after': '1' } });
    if (row.route !== i.route || row.req_hash !== reqHash) fail('conflict', 'Idempotency-Key was already used for a different request');
    if (row.state === 'done' && row.status !== null && row.body_enc) {
      const text = await open(i.dataKeys.all, 'idempotency', i.scope, row.body_enc, `${i.scope}|${i.key}|${i.route}`);
      if (text === null) fail('conflict', 'stored response is no longer readable; use a new Idempotency-Key');
      i.metrics.count('idempotent_replay', [i.route]);
      return { status: row.status, body: JSON.parse(text) as unknown, headers: { 'idempotent-replay': 'true' } };
    }
    const takeover = await i.db.prepare(SQL.reclaimIdempotency).bind(i.scope, i.key, i.now - IDEMPOTENCY_PENDING_MS, i.now).run();
    if ((takeover.meta?.changes ?? 0) === 0) fail('conflict', 'request in progress, retry', { headers: { 'retry-after': '1' } });
  }
  let reply: Reply;
  try {
    reply = await run();
  } catch (e) {
    await i.db.prepare(SQL.releaseIdempotency).bind(i.scope, i.key).run().catch(() => undefined);
    throw e;
  }
  if (reply instanceof Response || reply.status >= 500) {
    await i.db.prepare(SQL.releaseIdempotency).bind(i.scope, i.key).run().catch(() => undefined);
    return reply;
  }
  const enc = await seal(i.dataKeys.active, 'idempotency', i.scope, JSON.stringify(reply.body ?? null), `${i.scope}|${i.key}|${i.route}`);
  await i.db.prepare(SQL.completeIdempotency).bind(i.scope, i.key, reply.status, enc).run();
  return reply;
}
