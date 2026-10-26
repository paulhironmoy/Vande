/**
 * Offline innings against the local engine (Training, Practice Ghosts): same rules, validation and outcome model
 * as the server, no network. Supplies BattingScreen's nextBall/submitShot.
 */
import type { BattingInput, Conditions, OverPlan, RevealedDelivery, ShotFeedback } from '@/contracts';
import { SUPER_BALL_INDEX } from '@/contracts';
import type { InningsState, SealedSixEngineApi } from '@/contracts';
import { engine as realEngine } from '@/engine';
import type { NextBall } from '../batting/BattingScreen';

export interface LocalInnings {
  nextBall(): Promise<NextBall | null>;
  submitShot(input: BattingInput): Promise<ShotFeedback>;
  state(): InningsState;
  inputs(): Array<BattingInput | null>;
}

export function localInnings(opts: { plan: OverPlan; conditions: Conditions; seed: string; innings?: 0 | 1; includeSuperBall?: boolean; maxBalls?: number; engine?: SealedSixEngineApi }): LocalInnings {
  const eng = opts.engine ?? realEngine;
  let state = eng.startInnings(opts.innings ?? 0);
  let pending: RevealedDelivery | null = null;
  const inputs: Array<BattingInput | null> = [];
  let played = 0;
  return {
    async nextBall() {
      if (state.done || (state.mainDone && !opts.includeSuperBall) || (opts.maxBalls !== undefined && played >= opts.maxBalls)) return null;
      const ball = state.mainDone ? SUPER_BALL_INDEX : state.nextBall;
      pending = eng.revealDelivery(opts.plan, ball, opts.conditions);
      // Deliveries still to come after this one, Super Ball included (6 down to 0), as the server reports it.
      const ballsLeft = SUPER_BALL_INDEX - ball;
      return { delivery: pending, ballsLeft };
    },
    async submitShot(input) {
      if (!pending) throw new Error('no delivery in play');
      const checked = eng.validateBattingInput(input, pending);
      const valid = checked.ok ? checked.input : null;
      const r = eng.resolveNextBall(state, { seed: opts.seed, conditions: opts.conditions, plan: opts.plan, input: valid });
      state = r.state;
      inputs.push(valid);
      pending = null;
      played++;
      return r.feedback;
    },
    state: () => state,
    inputs: () => inputs,
  };
}
