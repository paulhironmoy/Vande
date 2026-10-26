/**
 * The public Practice physics API (src/contracts/practice.ts). Everything here is pure and deterministic and runs in
 * the physics frame (the striker's own, right-handed frame; presentation mirrors x for a left-hander).
 *
 *   flight({ plan, bowler, conditions, seed, handedness })   the delivery, fixed before the batter acts
 *   resolveDelivery({ flight, swing, field, bowler, conditions, handedness, assist, tierToleranceMs })
 *                                                             the whole play: contact, ball, fielders, events, score
 *   replayDelivery(record)                                    re-simulates a DeliveryRecord exactly
 *   autoField(bowler, conditions, handedness)                 the automatic field
 *   regionOf(bearing)                                         the one field-region classification
 *   flightFromPath(path, { family, releaseToContactMs, ... })  a multiplayer BallPath through the same physics
 *   aimShot(from, { p, mode }, opts)                          an outcome-first post-contact flight (match reveals)
 */
export * from './constants';
export type { LbwDecision, LbwReason, PlayedFootwork } from '@/contracts/practice';
export { bearingDeg, bearingDelta, dirFromBearing, elevationDeg } from './vec';
export { batTravelMs } from './bat';
export { activeBands, classifyTiming } from './timing';
export { flight, flightMovement, sampleAt, type FlightMovement } from './delivery';
export { simulate, type SimResult, type SimStart, type SimulateOptions } from './ball';
export { CONDITIONS_FOR_PITCH, flightFromPath, type FromPathOptions, type PathFit } from './matchPath';
export { aimShot, defaultElevationDeg, type AimMode, type AimOptions, type AimResult, type AimTarget } from './aim';
export { practiceFlight, replayDelivery, resolveDelivery, type ResolveArgs } from './resolve';
export {
  DEEP_INSET_M,
  KEEPER_BACK_M,
  autoField,
  bearingFromStriker,
  distanceFromStriker,
  groundRadius,
  physicsBowler,
  pointFromStriker,
  ropeDistance,
  turnsAway,
  validateField,
} from './field';
export {
  BEATEN_BY,
  BEAT_THE_FIELD_M,
  REGION_EDGES,
  diagnoseBeaten,
  judge,
  regionOf,
  zoneOf,
  type Judgement,
  type PlayFacts,
  type Region,
} from './scoring';
export {
  ATHLETICS,
  DEEP_FROM_M,
  PICKUP_S,
  athleticsOf,
  coverable,
  fielderClass,
  keeperTake,
  simulateFielding,
  timeToCover,
  type Athletics,
  type DropReason,
  type FielderClass,
  type FieldingPlay,
  type FieldingResult,
  type GatherKind,
  type PostContactBall,
} from './fielding';
export { RUNNING, autoRuns, runCompletionS, type RunningResult } from './running';
