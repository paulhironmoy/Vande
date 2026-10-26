/**
 * What the Practice flow needs from the other workstreams, as structural interfaces of the APIs the lead fixed
 * (src/physics, src/practice/game, src/render3d's PracticeStage, src/input). The real modules are bound in one place,
 * ../ports.ts; the controller only sees these interfaces, so its tests run against fixtures and nothing here can
 * drift into a second implementation of physics, rules or rendering.
 */
import type { ComponentType, ReactNode } from 'react';
import type {
  AssistLevel,
  BallFlight,
  BowlerFamily,
  BowlerProfile,
  Calibration,
  DeliveryRecord,
  DeliveryResult,
  DeliveryVariation,
  FieldLayout,
  FieldZone,
  Footwork,
  GestureInput,
  Handedness,
  NormalizedSwing,
  PaceBand,
  PitchCondition,
  PracticeDeliveryPlan,
  PracticeInningsState,
  PracticeOverPlan,
  QualityProfileId,
  SpinType,
  SwingTiming,
  CoachingReason,
  ContactKind,
  Dismissal,
  FielderRole,
  InningsStatus,
} from '@/contracts';
import type { BenchmarkRun } from '@/perf';
import type { FlightMovement } from '@/physics';

export type InningsAction =
  | { type: 'chooseOver'; plan: PracticeOverPlan; field: FieldLayout }
  | { type: 'deliveryStarted' }
  | { type: 'deliveryResolved'; record: DeliveryRecord }
  | { type: 'nextOver' }
  | { type: 'abandon' };

export interface FlightArgs {
  plan: PracticeDeliveryPlan;
  bowler: BowlerProfile;
  conditions: PitchCondition;
  seed: string;
  handedness: Handedness;
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

export interface NormalizeContext {
  releasePerfMs: number;
  calibrationMs: number;
  handedness: Handedness;
  /** Only under the test hooks: the same k given to stage.setTimeScale(k). */
  timeScale?: number;
}

export interface BuildBallArgs {
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
}

export interface ScoringAreaLike {
  region: Region;
  runs: number;
  balls: number;
}

/** src/practice/game OverSummary (the fields the summaries show). */
export interface OverSummaryLike {
  overIndex: number;
  runs: number;
  balls: number;
  fours: number;
  sixes: number;
  boundaries: number;
  dots: number;
  timing: Record<SwingTiming, number>;
  scoringAreas: readonly ScoringAreaLike[];
  weakest: { ballIndex: number; variation: DeliveryVariation; reason: CoachingReason; timing: SwingTiming; runs: number; dismissal: Dismissal | null } | null;
  dismissal: Dismissal | null;
  complete: boolean;
}

/** src/practice/game InningsSummary. */
export interface InningsSummaryLike {
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

/** src/practice/game CoachingFacts: the measured evidence behind a coaching card. */
export interface CoachingFactsLike {
  reason: CoachingReason;
  timing: 'early' | 'on_time' | 'late' | null;
  timingBand: SwingTiming;
  timingErrorMs: number | null;
  contact: ContactKind;
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
  autoField(bowler: BowlerProfile, conditions: PitchCondition, handedness: Handedness): FieldLayout;
  randomOver(args: { seed: string; conditions: PitchCondition; assist: AssistLevel; family?: BowlerFamily; beginner: boolean }): PracticeOverPlan;
  guidedStart(seed: string): { warmup: { bowler: BowlerProfile; plan: PracticeDeliveryPlan; seed: string }; over: PracticeOverPlan };
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
  /** src/physics regionOf: the classification that fills DeliveryOutcome.region, for any bearing (batter's frame). */
  regionOf(bearingDeg: number): Region;
}

export type LengthBand = 'yorker' | 'full' | 'good' | 'short' | 'bouncer';
export type LineBand = 'down_leg' | 'leg_stump' | 'middle' | 'off_stump' | 'outside_off' | 'wide_outside_off';

/** Build an Over helpers (src/practice/game): legal limits, honest speeds, the pitch map and plain-language bands. */
export interface BuildKit {
  variationsFor(family: BowlerFamily, spinType?: SpinType): readonly DeliveryVariation[];
  buildBall(args: BuildBallArgs): PracticeDeliveryPlan;
  bowlerFor(args: { family: BowlerFamily; paceBand?: PaceBand; spinType?: SpinType; arm?: 'right' | 'left'; seed: string }): BowlerProfile;
  buildOver(args: { bowler: BowlerProfile; balls: readonly PracticeDeliveryPlan[]; shuffle: boolean; seed: string }): PracticeOverPlan;
  validateOver(over: PracticeOverPlan): { ok: boolean; errors: string[] };
  /** Pitch-map tap (u across from the leg-side edge, v up from the striker's stumps; both 0–1) → legal target. */
  targetFromTap(u: number, v: number, family: BowlerFamily): { lineM: number; lengthM: number };
  tapFromTarget(t: { lineM: number; lengthM: number }): { u: number; v: number };
  lengthBand(lengthM: number, family: BowlerFamily): LengthBand;
  lineBand(lineM: number): LineBand;
}

export interface StageMountOptions {
  profile: QualityProfileId;
  handedness: Handedness;
  reducedMotion: boolean;
  learnCue: boolean;
}

export interface StageStats {
  fps: number;
  avgFrameMs: number;
  p95FrameMs: number;
  spikes: number;
  lastInputToBatMs: number | null;
  renderer: string;
}

export type StageEvent = 'contextlost' | 'contextrestored' | 'fallback';

/** What each stage event carries (src/render3d PracticeEventPayloads). */
export interface StageEventPayloads {
  contextlost: Record<string, never>;
  contextrestored: Record<string, never>;
  fallback: { reason: 'no_webgl' | 'context_lost' | 'error'; message?: string };
}

/** src/render3d's PracticeStage (the 3D first-person stage and its 2D Classic implementation share it). */
export interface PracticeStageLike {
  readonly kind: '3d' | '2d';
  mount(canvas: HTMLCanvasElement, opts: StageMountOptions): Promise<void>;
  setScene(scene: { field: FieldLayout; bowler: BowlerProfile; conditions: PitchCondition; handedness: Handedness }): void;
  benchmark(ms: number): Promise<BenchmarkRun>;
  bowl(flight: BallFlight): Promise<{ releasePerfMs: number }>;
  /** The provisional bat movement from the raw swing start (with the same calibration normalizeGesture applies). */
  beginSwing(atPerfMs: number, calibrationMs?: number): void;
  play(result: DeliveryResult): Promise<void>;
  replay(result: DeliveryResult, opts?: { speed?: number; diagnostics?: boolean }): Promise<void>;
  setProfile(profile: QualityProfileId): void;
  stats(): StageStats;
  on<E extends StageEvent>(event: E, cb: (payload: StageEventPayloads[E]) => void): () => void;
  setLearnCue(on: boolean): void;
  setReducedMotion(on: boolean): void;
  setTimeScale(k: number): void;
  simToPerf(t: number): number;
  dispose(): void;
}

export type StageFactory = (opts: { force2d: boolean }) => Promise<PracticeStageLike>;

export interface GestureSurfaceProps {
  enabled: boolean;
  onGesture: (input: GestureInput) => void;
  onSwingStart?: (atPerfMs: number) => void;
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
}
