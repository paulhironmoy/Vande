/**
 * Daily Six batting over the network: the same interruption-safe shape as a match innings (src/net/batting.ts), on
 * the attempt routes. The revealed ball is kept in durable storage (IndexedDB, like BattingClient), so an app that is
 * killed after a release resumes the same ball instead of letting it lapse into a leave; answers go through the
 * durable outbox. The server decides when the attempt is over (no next ball, or `inningsComplete`).
 */
import type { BattingInput, NextBallResponse, ShotResponse } from '@/contracts';
import type { Net } from '@/net';
import { idbKeyValue, type KeyValue } from '@/net';
import { ApiClientError } from '@/net/errors';
import type { BattingTransport } from '../match/netInnings';

const ATTEMPT_KEY = 'vc:daily-attempt';
const ball = (id: string) => `daily-ball:${id}`;

export interface SavedAttempt {
  day: string;
  attemptId: string;
  attempt: 1 | 2 | 3;
}

export function savedAttempt(day: string): SavedAttempt | null {
  try {
    const a = JSON.parse(localStorage.getItem(ATTEMPT_KEY) ?? 'null') as SavedAttempt | null;
    return a && a.day === day ? a : null;
  } catch {
    return null;
  }
}

export function saveAttempt(a: SavedAttempt | null): void {
  try {
    if (a) localStorage.setItem(ATTEMPT_KEY, JSON.stringify(a));
    else localStorage.removeItem(ATTEMPT_KEY);
  } catch {
    /* storage unavailable */
  }
}

let sharedKv: KeyValue | null = null;

export function dailyTransport(net: Pick<Net, 'api' | 'outbox'>, kv: KeyValue = sharedKv ?? (sharedKv = idbKeyValue())): BattingTransport {
  const lane = (id: string) => `daily:${id}`;
  return {
    async next(id) {
      const drained = await net.outbox.drainGroup(lane(id));
      if (!drained) throw new ApiClientError('offline', 'answers are still waiting to be sent');
      const r = await net.api.call('POST /v1/daily/attempts/:id/next', { params: { id } });
      await kv.set(ball(id), JSON.stringify(r));
      return r;
    },
    async outstanding(id) {
      const raw = await kv.get(ball(id));
      return raw ? (JSON.parse(raw) as NextBallResponse) : null;
    },
    async shot(id: string, ballToken: string, input: BattingInput) {
      await kv.remove(ball(id));
      const r = await net.outbox.submit<ShotResponse>({ route: 'POST /v1/daily/attempts/:id/shot', params: { id }, body: { ballToken, input }, group: lane(id) });
      return r.status === 'sent' ? { status: 'resolved' as const, response: r.response } : { status: 'queued' as const, delivered: r.delivered };
    },
  };
}
