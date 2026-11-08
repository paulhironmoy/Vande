/**
 * The player's own six as an over plan: each ball through the game's buildBall (honest speed, legal target), one
 * bowler for the over (its pace band is the median ball's, which the physics uses for the keeper's depth), and the
 * game's buildOver (a seeded one-time shuffle when asked). Throws the game's own validation errors.
 */
import type { AssistLevel, PaceBand, PitchCondition, PracticeOverPlan } from '@/contracts';
import type { BuildDraft, DraftBall } from '@/practice/store';
import type { BuildKit } from '../flow/types';

const BANDS: readonly PaceBand[] = ['controlled', 'fast', 'express'];

function medianBand(balls: readonly DraftBall[], fallback: PaceBand): PaceBand {
  const ranks = balls.map((b) => BANDS.indexOf(b.paceBand ?? fallback)).sort((a, b) => a - b);
  return BANDS[ranks[Math.floor((ranks.length - 1) / 2)]] ?? fallback;
}

export function planFromDraft(build: BuildKit, draft: BuildDraft, opts: { assist: AssistLevel; conditions: PitchCondition; seed: string }): PracticeOverPlan {
  if (draft.balls.some((b) => b === null)) throw new Error('practice: six balls needed');
  const balls = draft.balls as DraftBall[];
  const spinType = draft.family === 'spin' ? draft.spinType : undefined;
  const plans = balls.map((b) => build.buildBall({ family: draft.family, target: { lineM: b.lineM, lengthM: b.lengthM }, variation: b.variation, paceBand: draft.family === 'pace' ? (b.paceBand ?? draft.paceBand) : undefined, spinType, assist: opts.assist }));
  const bowler = build.bowlerFor({ family: draft.family, paceBand: draft.family === 'pace' ? medianBand(balls, draft.paceBand) : undefined, spinType, arm: draft.arm, seed: opts.seed });
  return build.buildOver({ bowler, balls: plans, shuffle: draft.order === 'shuffle', seed: opts.seed, conditions: opts.conditions });
}
