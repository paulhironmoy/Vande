/**
 * What the Practice flow needs from the other workstreams, as structural interfaces of their APIs (src/physics,
 * src/practice/game, src/practice/coach, src/render3d's PracticeStage, src/input, src/audio). The real modules are
 * bound in one place, ../ports.ts; the controller only sees these interfaces, so its tests run against fixtures and
 * nothing here can drift into a second implementation of physics, rules, coaching or rendering.
 */
import type { ComponentType, ReactNode } from 'react';
import type {
  AssistLevel,
  BallCondition,
  BallFlight,
  BowlerFamily,
  BowlerProfile,
  Calibration,
  CoachingReason,
  ContactKind,
  DeliveryRecord,
  DeliveryResult,
  DeliveryVariation,
  Difficulty,
  Dismissal,
  FieldIntent,
  FieldLayout,
  FieldZone,
  FielderRole,
  Footwork,
  GestureInput,
  Handedness,
  InningsStatus,
  NormalizedSwing,
  PaceBand,
  PitchCondition,
  PracticeDeliveryPlan,
  PracticeInningsState,
  PracticeOverPlan,
  SpinType,
  SwingTiming,
} from '@/contracts';
import type { FlightMovement } from '@/physics';
import type { OneGestureState } from '@/input';

export * from './stageTypes';
export * from './coachTypes';
export * from './audioTypes';

export type InningsAction =
  | { type: 'chooseOver'; plan: PracticeOverPlan; field: FieldLayout }
  | { type: 'deliveryStarted' }
  | { type: 'deliveryResolved'; record: DeliveryRecord }
  | { type: 'nextOver' }
  | { type: 'restartOver' }
  | { type: 'abandon' };

export interface FlightArgs {
  plan: PracticeDeliveryPlan;
  bowler: BowlerProfile;
  conditions: PitchCondition;
  seed: string;
  handedness: Handedness;
  /** The over's ball (a worn ball swings and seams less). */
  ball?: BallCondition;
}

export interface ResolveArgs {
  flight: BallFlight;
  swing: NormalizedSwing | null;
  field: FieldLayout;
  bowler: BowlerProfile;
  conditions: PitchCondition;
  handedness: Handedness;
  assist: AssistLevel;
  tierToleranceMs: number;
}

/** The kinds of input that are calibrated separately (CTL9): a touch screen reports later than a keyboard. */
export type InputModality = 'touch' | 'mouse' | 'pen' | 'keyboard';

export interface NormalizeContext {
  releasePerfMs: number;
  calibrationMs: number;
  /** Per modality: a swing is corrected by the offset of the input that made it (else calibrationMs). */
  calibrations?: Partial<Record<InputModality, number>>;
  handedness: Handedness;
  /** Only under the test hooks: the same k given to stage.setTimeScale(k). */
  timeScale?: number;
}

interface BuildBallArgs {
  family: BowlerFamily;
  target: { lineM: number; lengthM: number };
  variation: DeliveryVariation;
  paceBand?: PaceBand;
  spinType?: SpinType;
  assist?: AssistLevel;
}

/** src/physics Region (FieldZone, or straight down the ground, or behind square). */
export type Region = FieldZone | 'straight' | 'behind';

/** src/practice/game NextDelivery: everything the physics needs for the ball due next. */
export interface NextDeliveryLike {
  overIndex: number;
  ballIndex: number;
  plan: PracticeDeliveryPlan;
  seed: string;
  bowler: BowlerProfile;
  field: FieldLayout;
  conditions: PitchCondition;
  handedness: Handedness;
  assist: AssistLevel;
  /** The over's ball. */
  ball: BallCondition;
}

interface ScoringAreaLike {
  region: Region;
  runs: number;
  balls: number;
}

/** src/practice/game OverSummary (the fields the summaries show). */
interface OverSummaryLike {
  overIndex: number;
  runs: number;
  balls: number;
  fours: number;
  sixes: number;
  boundaries: number;
  dots: number;
  timing: Record<SwingTiming, number>;
  scoringAreas: readonly ScoringAreaLike[];
  dismissal: Dismissal | null;
  complete: boolean;
}

/** src/practice/game InningsSummary. */
interface InningsSummaryLike {
  status: InningsStatus;
  finished: boolean;
  runs: number;
  balls: number;
  overs: string;
  completedOvers: number;
  survivedBalls: number;
  fours: number;
  sixes: number;
  dots: number;
  strikeRate: number;
  timing: Record<SwingTiming, number>;
  scoringAreas: readonly ScoringAreaLike[];
  perOver: readonly OverSummaryLike[];
  dismissal: { record: DeliveryRecord; how: Dismissal; reason: CoachingReason; fielderRole: FielderRole | null; ballNumber: number; at: string } | null;
}

/** src/practice/game CoachingFacts: the measured evidence behind a delivery (the slow-motion replay's numbers). */
export interface CoachingFactsLike {
  reason: CoachingReason;
  timing: 'early' | 'on_time' | 'late' | null;
  timingBand: SwingTiming;
  timingErrorMs: number | null;
  contact: ContactKind;
  /** The continuous input intent exactly as normalized; null is a leave. */
  intent: {
    kind: NormalizedSwing['kind'];
    directionDeg: number;
    power: number;
    elevation: number;
    requestedFootwork: Footwork;
  } | null;
  /** Measured bat evidence; null fields are never inferred by the UI. */
  bat: {
    faceBearingDeg: number | null;
    faceToIntentDeg: number | null;
    speedKph: number | null;
    bladeU: number | null;
    sweetSpotAlongOffsetM: number | null;
    withinSweetSpotAlongBand: boolean | null;
  };
  intendedBearingDeg: number | null;
  intendedRegion: Region | null;
  exitBearingDeg: number | null;
  exitRegion: Region | null;
  bearingErrorDeg: number | null;
  exitSpeedKph: number | null;
  exitElevationDeg: number | null;
  /** src/physics FlightMovement (the delivery's own measured movement). */
  movement: FlightMovement;
  delivery: { variation: DeliveryVariation; speedKph: number; lengthM: number; lineM: number; lengthBand: LengthBand; lineBand: LineBand };
  fielder: { id: string; role: FielderRole } | null;
  returnS: number | null;
  runs: DeliveryResult['outcome']['runs'];
  boundary: 4 | 6 | null;
  dismissal: Dismissal | null;
  endBearingDeg: number | null;
  endDistanceM: number | null;
  endRegion: Region | null;
}

/** The physics, the Practice rules and input normalisation, as plain functions. */
export interface PracticeEngine {
  flight(args: FlightArgs): BallFlight;
  resolveDelivery(args: ResolveArgs): DeliveryResult;
  /** The physics' field for the bowler and pitch; a white ball sets a limited-overs field, a red one a Test field. */
  autoField(bowler: BowlerProfile, conditions: PitchCondition, handedness: Handedness, ball?: Pick<BallCondition, 'colour'>): FieldLayout;
  /** src/physics fieldIntent: what the field is set to do (attacking fielders, protected arcs, gaps, the plan). */
  fieldIntent(field: FieldLayout, bowler: BowlerProfile, conditions: PitchCondition, handedness: Handedness): FieldIntent;
  randomOver(args: { seed: string; conditions: PitchCondition; assist: AssistLevel; difficulty: Difficulty; family?: BowlerFamily }): PracticeOverPlan;
  /** The reference over (the benchmark): the same six balls every time, always on a Balanced pitch. */
  referenceOver(): PracticeOverPlan;
  /** Its six balls in bowling order with their closed training objectives (the UI words them). */
  referenceBalls(): readonly ReferenceBallLike[];
  ballSeed(over: PracticeOverPlan, i: number): string;
  newInnings(args: { id: string; conditions: PitchCondition; assist: AssistLevel; handedness: Handedness }): PracticeInningsState;
  inningsReducer(state: PracticeInningsState, action: InningsAction): PracticeInningsState;
  resumeInnings(state: PracticeInningsState): PracticeInningsState;
  nextDelivery(state: PracticeInningsState): NextDeliveryLike | null;
  makeRecord(next: NextDeliveryLike, swing: NormalizedSwing | null, tierToleranceMs: number, result: Pick<DeliveryResult, 'outcome'>): DeliveryRecord;
  replayDelivery(record: DeliveryRecord): DeliveryResult;
  repeatDelivery(record: DeliveryRecord, swing: NormalizedSwing | null): DeliveryResult;
  overSummary(over: { plan: PracticeOverPlan; deliveries: readonly DeliveryRecord[] }, results?: readonly (DeliveryResult | undefined)[]): OverSummaryLike;
  inningsSummary(state: PracticeInningsState, results?: ReadonlyMap<string, DeliveryResult>): InningsSummaryLike;
  coachingFacts(result: DeliveryResult, record?: Pick<DeliveryRecord, 'bowler' | 'field'>): CoachingFactsLike;
  normalizeGesture(input: GestureInput, ctx: NormalizeContext): NormalizedSwing | null;
  /** Every modality's calibration offset from the stored set (src/input's resolveCalibrations). */
  resolveCalibrations(set: Partial<Record<InputModality, Calibration>> | null): Record<InputModality, number>;
  /** Whether a pointer is down on the page now (src/input's pointerIsDown): a resting finger can still start a swing. */
  pointerIsDown?(): boolean;
  /** src/physics regionOf: the classification that fills DeliveryOutcome.region, for any bearing (batter's frame). */
  regionOf(bearingDeg: number): Region;
}

interface ReferenceBallLike {
  id: string;
  index: number;
  variation: DeliveryVariation;
  objective: string;
}

/** src/practice/game OverPattern: honest facts of a fixed over (never computed for a Random Over). */
interface OverPatternLike {
  family: BowlerFamily;
  arm: 'right' | 'left';
  mainLine: 'stumps' | 'off_stump' | 'outside_off' | 'leg_side';
  onTheStumps: number;
  swing: 'away' | 'in' | 'both' | 'none';
  turn: 'away' | 'in' | 'both' | 'none';
  shortBalls: number;
  bouncers: number;
  yorkers: number;
  changeOfPace: number;
  paceKph: [number, number];
}

export type LengthBand = 'yorker' | 'full' | 'good' | 'short' | 'bouncer';
export type LineBand = 'down_leg' | 'leg_stump' | 'middle' | 'off_stump' | 'outside_off' | 'wide_outside_off';

/** Predefined-over helpers (src/practice/game): legal limits, honest speeds, the pitch map and plain-language bands. */
export interface BuildKit {
  variationsFor(family: BowlerFamily, spinType?: SpinType): readonly DeliveryVariation[];
  buildBall(args: BuildBallArgs): PracticeDeliveryPlan;
  bowlerFor(args: { family: BowlerFamily; paceBand?: PaceBand; spinType?: SpinType; arm?: 'right' | 'left'; seed: string }): BowlerProfile;
  buildOver(args: { bowler: BowlerProfile; balls: readonly PracticeDeliveryPlan[]; shuffle: boolean; seed: string; conditions?: PitchCondition }): PracticeOverPlan;
  validateOver(over: PracticeOverPlan): { ok: boolean; errors: string[] };
  /** Pitch-map tap (u across from the leg-side edge, v up from the striker's stumps; both 0–1) → legal target. */
  targetFromTap(u: number, v: number, family: BowlerFamily): { lineM: number; lengthM: number };
  tapFromTarget(t: { lineM: number; lengthM: number }): { u: number; v: number };
  lengthBand(lengthM: number, family: BowlerFamily): LengthBand;
  lineBand(lineM: number): LineBand;
  /** The honest stock speed range (km/h) of a bowler at a difficulty (Beginner bowls genuinely slower; assistance never changes speed). */
  stockRange(bowler: Pick<BowlerProfile, 'family' | 'paceBand' | 'spinType'>, difficulty?: Difficulty): readonly [number, number];
  /** At most this many bouncers in an over (the game's rule). */
  maxBouncers: number;
  /** The known pattern of a fixed over (the reference over or the player's own six; never a Random Over). */
  overPattern(plan: PracticeOverPlan, handedness: Handedness): OverPatternLike;
}

export interface GestureSurfaceProps {
  enabled: boolean;
  onGesture: (input: GestureInput) => void;
  /** The press (or key), at its own timestamp, with the input that made it and the footwork known at that moment. */
  onSwingStart?: (atPerfMs: number, pointer: InputModality, footwork: Footwork) => void;
  /** Defence or attack, as soon as the input says which (src/input's SwingIntent). */
  onIntent?: (intent: { kind: 'defend' | 'attack'; atPerfMs: number; pointer: InputModality; footwork: Footwork }) => void;
  onCancel?: () => void;
  /** Canonical presentation-only state of the active one-contact control. */
  onContactState?: (state: OneGestureState) => void;
  /** Where the press lands sets the footwork (high: forward, low: back); off by default, so footwork stays automatic. */
  pressFootwork?: boolean;
  footwork?: Footwork;
  handedness?: Handedness;
  deliveryKey?: string | number;
  keyboard?: boolean;
  heightFraction?: number;
  label?: string;
  className?: string;
  children?: ReactNode;
}

/** src/input's calibration and gesture surface. */
export interface InputKit {
  GestureSurface: ComponentType<GestureSurfaceProps>;
  calibrationFromTaps(errorsMs: number[]): Calibration;
  /** Calibrations from attempts made with any mix of inputs (a modality without attempts is absent). */
  calibrationsFromTaps(taps: ReadonlyArray<{ modality: InputModality; errorMs: number }>): Partial<Record<InputModality, Calibration>>;
  /** The modality of a pointer or key event. */
  eventModality(e: Event): InputModality;
}
