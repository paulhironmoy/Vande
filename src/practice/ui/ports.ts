/**
 * The one place the Practice UI binds the other workstreams' modules (src/physics, src/practice/game, src/input,
 * src/render3d). Everything else in src/practice/ui sees only the interfaces in ./flow/types.ts, so a rename here is
 * a one-file change and the compiler checks every binding against those interfaces.
 */
import { autoField, flight, regionOf, resolveDelivery } from '@/physics';
import {
  ballSeed,
  bowlerFor,
  buildBall,
  buildOver,
  coachingFacts,
  guidedStart,
  inningsReducer,
  inningsSummary,
  lengthBand,
  lineBand,
  makeRecord,
  newInnings,
  nextDelivery,
  overSummary,
  randomOver,
  repeatDelivery,
  replayDelivery,
  resumeInnings,
  tapFromTarget,
  targetFromTap,
  validateOver,
  variationsFor,
} from '@/practice/game';
import { GestureSurface, calibrationFromTaps, normalizeGesture } from '@/input';
import { createPracticeStage } from '@/render3d';
import type { BuildKit, InputKit, PracticeEngine, StageFactory } from './flow/types';

export const engine: PracticeEngine = {
  flight,
  resolveDelivery,
  autoField,
  regionOf,
  randomOver,
  guidedStart,
  ballSeed,
  newInnings,
  inningsReducer,
  resumeInnings,
  nextDelivery,
  makeRecord,
  replayDelivery,
  repeatDelivery: (record, swing) => repeatDelivery(record, swing),
  overSummary,
  inningsSummary,
  coachingFacts,
  normalizeGesture,
};

export const buildKit: BuildKit = { variationsFor, buildBall, bowlerFor, buildOver, validateOver, targetFromTap, tapFromTarget, lengthBand, lineBand };

export const inputKit: InputKit = { GestureSurface, calibrationFromTaps };

export const createStage: StageFactory = (opts) => createPracticeStage(opts);
