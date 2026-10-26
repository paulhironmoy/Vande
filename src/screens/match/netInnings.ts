/**
 * An innings against the server, safe against interruptions (src/net/batting.ts does the durable part): the first
 * ball is fetched when the player taps Start (it carries the field they face), a ball revealed before the app was
 * closed is resumed, and an answer made offline is queued and delivered when the connection returns.
 */
import type { BattingInput, NextBallResponse, ShotFeedback, ShotResponse } from '@/contracts';
import { isApiClientError } from '@/net/errors';
import type { NextBall } from '../batting/BattingScreen';

export interface BattingTransport {
  next(id: string): Promise<NextBallResponse>;
  outstanding(id: string): Promise<NextBallResponse | null>;
  shot(id: string, ballToken: string, input: BattingInput): Promise<{ status: 'resolved'; response: ShotResponse } | { status: 'queued'; delivered: Promise<ShotResponse> }>;
}

export interface NetInnings {
  /** Fetches (or resumes) the first ball; its field is what the batter faces. */
  start(): Promise<NextBallResponse | null>;
  nextBall(): Promise<NextBall | null>;
  submitShot(input: BattingInput): Promise<ShotFeedback>;
  complete(): boolean;
}

/** True when the server says the innings is already over. */
function inningsOver(e: unknown): boolean {
  return isApiClientError(e) && e.code === 'conflict' && !e.retryable;
}

export function netInnings(transport: BattingTransport, matchId: string, hooks: { onQueued?: (queued: boolean) => void } = {}): NetInnings {
  let pending: NextBallResponse | null = null;
  let token: string | null = null;
  let done = false;
  const fetchBall = async (): Promise<NextBallResponse | null> => {
    try {
      return (await transport.outstanding(matchId)) ?? (await transport.next(matchId));
    } catch (e) {
      if (inningsOver(e)) {
        done = true;
        return null;
      }
      throw e;
    }
  };
  return {
    async start() {
      if (done) return null;
      pending = await fetchBall();
      return pending;
    },
    async nextBall() {
      if (done) return null;
      const ball = pending ?? (await fetchBall());
      pending = null;
      if (!ball) return null;
      token = ball.ballToken;
      return { delivery: ball.delivery, ballsLeft: ball.ballsLeft };
    },
    async submitShot(input) {
      if (!token) throw new Error('no ball in play');
      const out = await transport.shot(matchId, token, input);
      token = null;
      if (out.status === 'resolved') {
        done = out.response.inningsComplete;
        return out.response.feedback;
      }
      hooks.onQueued?.(true);
      try {
        const r = await out.delivered;
        done = r.inningsComplete;
        return r.feedback;
      } finally {
        hooks.onQueued?.(false);
      }
    },
    complete: () => done,
  };
}
