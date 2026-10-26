/**
 * Batting over the network, safe against interruptions.
 *
 *   next(matchId)  delivers this match's queued answers first (lane order), then asks for the next ball with a stored
 *                  Idempotency-Key, so a retry after a lost response replays the same ball instead of revealing
 *                  another. The revealed ball is remembered so a restarted app can resume it.
 *   shot(...)      writes the answer to the outbox before sending it; offline it stays queued and is retried until
 *                  the server answers (a shot made offline is never lost; the server accepts it if it arrives within
 *                  the late window and otherwise counts the ball as a leave).
 */
import type { BattingInput, NextBallResponse, ShotResponse } from '@/contracts';
import type { ApiClient } from './client';
import { ApiClientError } from './errors';
import type { KeyValue } from './idb';
import type { Outbox } from './outbox';
import { newIdempotencyKey } from './routes';

export const matchLane = (matchId: string): string => `match:${matchId}`;

export type ShotOutcome = { status: 'resolved'; response: ShotResponse } | { status: 'queued'; delivered: Promise<ShotResponse> };

export class BattingClient {
  constructor(
    private readonly api: ApiClient,
    private readonly outbox: Outbox,
    private readonly kv: KeyValue,
  ) {}

  async next(matchId: string): Promise<NextBallResponse> {
    const drained = await this.outbox.drainGroup(matchLane(matchId));
    if (!drained) throw new ApiClientError('offline', 'answers are still waiting to be sent');
    const slot = `next:${matchId}`;
    let key = await this.kv.get(slot);
    if (!key) {
      key = newIdempotencyKey();
      await this.kv.set(slot, key);
    }
    const ball = await this.api.call('POST /v1/matches/:id/bat/next', { params: { id: matchId } }, { idempotencyKey: key });
    await this.kv.remove(slot);
    await this.kv.set(`ball:${matchId}`, JSON.stringify(ball));
    return ball;
  }

  /** The ball revealed to this device and not yet answered (to resume after a restart), if any. */
  async outstanding(matchId: string): Promise<NextBallResponse | null> {
    const raw = await this.kv.get(`ball:${matchId}`);
    return raw ? (JSON.parse(raw) as NextBallResponse) : null;
  }

  async shot(matchId: string, ballToken: string, input: BattingInput): Promise<ShotOutcome> {
    await this.kv.remove(`ball:${matchId}`);
    const result = await this.outbox.submit<ShotResponse>({ route: 'POST /v1/matches/:id/bat/shot', params: { id: matchId }, body: { ballToken, input }, group: matchLane(matchId) });
    return result.status === 'sent' ? { status: 'resolved', response: result.response } : { status: 'queued', delivered: result.delivered };
  }
}
