/**
 * Sealed Six rules, engine version 1, assembled into the public SealedSixEngineApi. A future version 2 lives in
 * src/engine/v2 beside this one; the registry (src/engine/registry.ts) keeps every version that has replays.
 */
import type { SealedSixEngineApi } from '@/contracts';
import { canonicalPlan, commitHash } from '../canonical';
import { validateBattingInput } from './batting';
import { revealDelivery } from './delivery';
import { resolveNextBall, startInnings, summarise } from './innings';
import { buildDailyLog } from './daily';
import { buildMatchLog } from './match';
import { dailyScore, matchPerformance } from './performance';
import { energyCost, validatePlan } from './plan';
import { autoBat, autoOver, dailyChallenge, GHOSTS, ghostBat, ghostPlan } from './policies';
import { OVER_ENERGY_BUDGET, RULES_VERSION, STARTER_VARIANTS } from './tables';
import { executionQuality } from './traces';
import { verifyMatchLog } from './verify';

export const engineV1: SealedSixEngineApi = {
  ENGINE_VERSION: RULES_VERSION,
  OVER_ENERGY_BUDGET,
  STARTER_VARIANTS,
  energyCost,
  validatePlan,
  executionQuality,
  canonicalPlan,
  commitHash,
  revealDelivery,
  validateBattingInput,
  startInnings,
  resolveNextBall,
  summarise,
  buildMatchLog,
  verifyMatchLog,
  autoOver,
  autoBat,
  GHOSTS,
  ghostPlan,
  ghostBat,
  dailyChallenge,
  buildDailyLog,
  dailyScore,
  matchPerformance,
};
