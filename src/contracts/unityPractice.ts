/**
 * Versioned boundary between the React/TypeScript Practice authority and the optional Unity live surface.
 *
 * TypeScript remains authoritative for input normalization, delivery/contact physics, scoring, wickets, innings,
 * replay and Coach during the first Unity vertical slice. Unity presents the canonical traces and may report an
 * ephemeral local gesture trace; it never invents or re-scores a result. See docs/ARCHITECTURE.md.
 */
import {
  PRACTICE_SIM_VERSION,
  type AssistLevel,
  type AssistanceStage,
  type BallCondition,
  type BallFlight,
  type BallSample,
  type BowlerProfile,
  type DeliveryRecord,
  type DeliveryResult,
  type FieldIntention,
  type FieldLayout,
  type GestureInput,
  type Handedness,
  type NormalizedSwing,
  type PerfTier,
  type PitchCondition,
  type PracticeDeliveryPlan,
  type QualityProfileId,
  type Vec3,
} from './practice';

export const UNITY_PRACTICE_CONTRACT_VERSION = 6 as const;
/** Canonical result trace carried by bridge contract v6 / Practice simulation v3. */
export const UNITY_PRACTICE_TRACE_VERSION = 2 as const;
/** Inline ceiling; current authoritative result goldens are ~275–369 KiB. Reject before hashing or native forwarding. */
export const UNITY_PRACTICE_MAX_PACKET_BYTES = 1024 * 1024;
export const UNITY_PRACTICE_MAX_GESTURE_SAMPLES = 512;
export const UNITY_PRACTICE_MAX_TRACE_SAMPLES = 40_000;
export const UNITY_PRACTICE_MAX_TRACE_EVENTS = 1_024;
export const UNITY_PRACTICE_MAX_SEEN_MESSAGES = 2_048;
export const UNITY_PRACTICE_MAX_IDENTIFIER_LENGTH = 256;
export const UNITY_PRACTICE_MAX_BENCHMARK_DURATION_MS = 10_000;
export const UNITY_PRACTICE_MAX_BENCHMARK_WARMUP_FRAMES = 300;
export const UNITY_PRACTICE_MAX_BENCHMARK_INTERVALS = 1_200;
/**
 * Unity presentation ultimately stores positions, directions and animation scalars as IEEE-754 floats. Keep a
 * deliberately generous ceiling well above any cricket-world value so a valid JavaScript double cannot become
 * Infinity, poison a transform, or overflow interpolation after crossing the runtime boundary.
 */
export const UNITY_PRACTICE_MAX_PRESENTATION_MAGNITUDE = 1_000_000;
export const UNITY_PRACTICE_MAX_TRACE_DURATION_SECONDS = 30;

export type UnityPracticeContractVersion = typeof UNITY_PRACTICE_CONTRACT_VERSION;
export type UnityPracticeMessageType =
  | 'bridge.ack'
  | 'host.initialize'
  | 'host.clock_sync'
  | 'host.clock_selected'
  | 'host.scene'
  | 'host.delivery'
  | 'host.provisional_swing'
  | 'host.result'
  | 'host.dead_ball_ui'
  | 'host.replay'
  | 'host.demonstration'
  | 'host.demonstration_cancel'
  | 'host.profile'
  | 'host.locale'
  | 'host.benchmark'
  | 'host.pause'
  | 'host.resume'
  | 'host.dispose'
  | 'unity.ready'
  | 'unity.clock_sync'
  | 'unity.release'
  | 'unity.pointer'
  | 'unity.gesture'
  | 'unity.dead'
  | 'unity.dead_ball_action'
  | 'unity.protected_regions'
  | 'unity.stats'
  | 'unity.benchmark'
  | 'unity.pause_request'
  | 'unity.quiet'
  | 'unity.unloaded'
  | 'unity.error';

export type UnityPracticeHostMessageType = Extract<UnityPracticeMessageType, `host.${string}`>;
export type UnityPracticeUnityMessageType = Extract<UnityPracticeMessageType, `unity.${string}`>;
export type UnityPracticeSenderFor<T extends UnityPracticeMessageType> = T extends UnityPracticeHostMessageType
  ? 'host'
  : T extends UnityPracticeUnityMessageType
    ? 'unity'
    : 'host' | 'unity';

export interface UnityPracticeEnvelope<TType extends UnityPracticeMessageType = UnityPracticeMessageType, TPayload = unknown> {
  contractVersion: UnityPracticeContractVersion;
  simVersion: typeof PRACTICE_SIM_VERSION;
  buildId: string;
  sessionId: string;
  /** Stable within the session; omitted only for session-level messages. */
  deliveryId: string | null;
  messageId: string;
  /** Strictly increasing for each sender within a session. */
  sequence: number;
  sender: 'host' | 'unity';
  type: TType;
  payload: TPayload;
}

export interface UnityPracticePacket {
  /** Lower-case SHA-256 of the UTF-8 bytes in body. */
  sha256: string;
  /** Canonical JSON containing exactly one UnityPracticeEnvelope. */
  body: string;
}

export interface UnityPracticeInitialize {
  locale: string;
  /** Android DisplayMetrics.density; WebGL uses CSS-pixel semantics (1). */
  pixelsPerDp: number;
  quality: QualityProfileId;
  deviceTier: PerfTier;
  handedness: Handedness;
  assistance: AssistLevel;
  reducedMotion: boolean;
  /** Effective app text scale, including the platform 200% accessibility path. */
  textScale: number;
  highContrast: boolean;
  captions: boolean;
  audio: boolean;
  haptics: boolean;
  /** Metres, seconds, degrees and km/h; +Y up, +Z to striker, +X right-hander off side. */
  coordinateSystem: 'vande-striker-frame-v1';
  /** Unity mirrors presentation once for a left hand; authoritative physics is never mirrored a second time. */
  handednessPolicy: 'physics-right-handed-presentation-mirrors-once';
}

export interface UnityPracticeScene {
  conditions: PitchCondition;
  field: FieldLayout;
  fieldIntent: FieldIntention;
  trainingObjective: 'reference' | 'built' | 'random';
  bowler: BowlerProfile;
  ball: BallCondition;
  handedness: Handedness;
  batterPosition: {
    /** Lateral stance from middle stump in the striker frame (+ is this batter's off side). */
    lateralM: number;
    /** Distance in front of the popping crease; zero is the normal crease stance. */
    creaseOffsetM: number;
    guard: 'leg' | 'middle' | 'off' | 'custom';
  };
}

/**
 * The two runtimes do not share a monotonic clock. The host estimates the offset from a bounded ping/pong exchange
 * before the first delivery; wall-clock time is deliberately never used for contact timing.
 */
export interface UnityPracticeClockPing {
  sampleId: string;
  hostSendPerfMs: number;
}

export interface UnityPracticeClockPong extends UnityPracticeClockPing {
  unityReceiveMs: number;
  unitySendMs: number;
}

/** Confirms the lowest-round-trip sample that both runtimes must use for the rest of this session. */
export interface UnityPracticeClockSelection {
  sampleId: string;
}

/**
 * Presentation-only help latched atomically with one authoritative delivery.
 * The host derives Coach contact data from StageGuide; Unity never predicts a
 * response, changes a timing band or feeds this data back into simulation.
 */
export interface UnityPracticeDeliveryPresentation {
  /** Ordinary Learn landing cue. Mutually exclusive with an exact-ball Coach attempt. */
  learnCue: boolean;
  coach: {
    stage: AssistanceStage;
    /** Null together for a recommended leave or when the guide has no truthful contact. */
    contactT: number | null;
    contactPoint: Vec3 | null;
  } | null;
}

export interface UnityPracticeDelivery {
  overIndex: number;
  ballIndex: number;
  plan: PracticeDeliveryPlan;
  seed: string;
  flight: BallFlight;
  presentation: UnityPracticeDeliveryPresentation;
}

export interface UnityPracticeProvisionalSwing {
  /** performance.now() time in the host clock. It is not a simulation result. */
  atPerfMs: number;
  calibrationMs: number;
  swing: NormalizedSwing;
}

export interface UnityPracticeResolution {
  record: DeliveryRecord;
  result: DeliveryResult;
  score: {
    runs: number;
    wickets: 0 | 1;
    balls: number;
    maxOvers: 10;
  };
  /** SHA-256 of the canonical record + result used by exact replay. */
  replayDigest: string;
}

export interface UnityPracticeReplay {
  resolution: UnityPracticeResolution;
  speed: number;
  diagnostics: boolean;
}

/**
 * A score-inert Coach performance on the already-mounted Unity Practice world.
 * The complete delivery is included so Unity can show its ordinary run-up,
 * release and flight before presenting the canonical recommended response.
 * The resolution is authoritative presentation data; it never enters innings.
 */
export interface UnityPracticeDemonstration {
  delivery: UnityPracticeDelivery;
  resolution: UnityPracticeResolution;
  speed: number;
}

export type UnityPracticeDeadBallAction = 'practice_ball' | 'next_ball';

/**
 * Localized, presentation-only guidance for the retained authoritative dead
 * ball. It carries no measurements and cannot alter replay, score or innings.
 */
export interface UnityPracticeDeadBallUi {
  replayDigest: string;
  reason: string;
  /** Empty while Coach analysis is pending or unavailable. */
  recommendation: string;
  primaryAction: UnityPracticeDeadBallAction;
  primaryLabel: string;
  secondaryAction: 'next_ball' | null;
  secondaryLabel: string | null;
}

export interface UnityPracticeDeadBallActionMessage {
  action: UnityPracticeDeadBallAction;
  replayDigest: string;
}

export type UnityPracticeProtectedRegionKind = 'bowler' | 'release' | 'pitch' | 'ball_path' | 'bat' | 'contact';

/** Unity framebuffer-space evidence for areas the React presentation must not cover. */
export interface UnityPracticeProtectedRegions {
  regions: Array<{
    height: number;
    kind: UnityPracticeProtectedRegionKind;
    width: number;
    x: number;
    y: number;
  }>;
  viewportHeight: number;
  viewportWidth: number;
}

export interface UnityPracticeGesture {
  /**
   * Local, ephemeral input only. The host must normalize it immediately and discard the raw samples after the
   * canonical result is committed. It must never enter persistence, analytics, logs or a request/result file.
   */
  retention: 'memory-until-resolution';
  /** Identifies the accepted clock sample used to transform these Unity-runtime timestamps into performance.now(). */
  clockSampleId: string;
  input: Omit<GestureInput, 'samples'> & {
    /** Time.realtimeSinceStartupAsDouble * 1000 in Unity's monotonic clock. */
    samples: GestureInput['samples'];
  };
}

export interface UnityPracticeStats {
  quality: QualityProfileId;
  /** Complete rendered intervals in this delivery window (warm-up and idle frames excluded). */
  sampleCount: number;
  /** Delivery-window intervals over 50 ms. */
  spikes: number;
  fps: number;
  avgFrameMs: number;
  p95FrameMs: number;
  p99FrameMs: number;
  worstFrameMs: number;
  inputToVisibleBatMs: number | null;
  memoryMb: number | null;
  thermalState: 'unknown' | 'nominal' | 'fair' | 'serious' | 'critical';
}

/** A bounded renderer-local measurement. It classifies Unity from Unity frames, never from the WebView GPU. */
export interface UnityPracticeBenchmarkRequest {
  benchmarkId: string;
  durationMs: number;
  warmupFrames: number;
  sampleCap: number;
  quality: QualityProfileId;
}

export interface UnityPracticeBenchmarkResult {
  benchmarkId: string;
  quality: QualityProfileId;
  frameIntervalsMs: number[];
  warmup: {
    frames: number;
    durationMs: number;
    /** Null means the runtime cannot isolate shader warm-up from total warm-up truthfully. */
    shaderWarmupMs: number | null;
    shaderWarmupCompleted: boolean;
  };
  graphics: {
    api: string;
    device: string;
    contextGeneration: number | null;
    contextLosses: number | null;
  };
  memoryMb: number | null;
  thermalState: UnityPracticeStats['thermalState'];
}

export type UnityPracticeErrorCode =
  | 'contract_version'
  | 'simulation_version'
  | 'integrity'
  | 'invalid_message'
  | 'out_of_order'
  | 'timeout'
  | 'unity_unavailable'
  | 'unity_load_failed'
  | 'unity_runtime'
  | 'lifecycle'
  | 'low_memory';

export interface UnityPracticeError {
  code: UnityPracticeErrorCode;
  recoverable: boolean;
  /** Calm diagnostic detail; never display this raw string to a player. */
  detail: string;
  fallback: 'three' | 'classic' | 'return_to_practice';
}

export type UnityPracticePayloadByType = {
  'bridge.ack': { acknowledgedMessageId: string };
  'host.initialize': UnityPracticeInitialize;
  'host.clock_sync': UnityPracticeClockPing;
  'host.clock_selected': UnityPracticeClockSelection;
  'host.scene': UnityPracticeScene;
  'host.delivery': UnityPracticeDelivery;
  'host.provisional_swing': UnityPracticeProvisionalSwing;
  'host.result': UnityPracticeResolution;
  'host.dead_ball_ui': UnityPracticeDeadBallUi;
  'host.replay': UnityPracticeReplay;
  'host.demonstration': UnityPracticeDemonstration;
  'host.demonstration_cancel': Record<string, never>;
  'host.profile': { quality: QualityProfileId };
  'host.locale': { locale: string };
  'host.benchmark': UnityPracticeBenchmarkRequest;
  'host.pause': { reason: 'player' | 'background' | 'interruption' };
  'host.resume': { reason: 'player' | 'foreground' | 'recreated' };
  'host.dispose': { reason: 'complete' | 'cancelled' | 'fallback' | 'error' };
  'unity.ready': { renderer: string; unityVersion: string };
  'unity.clock_sync': UnityPracticeClockPong;
  'unity.release': { releaseUnityMs: number; clockSampleId: string };
  'unity.pointer': {
    phase: 'down' | 'cancel';
    atUnityMs: number;
    clockSampleId: string;
    pointer: GestureInput['pointer'];
  };
  'unity.gesture': UnityPracticeGesture;
  'unity.dead': { deadT: number; replayDigest: string };
  'unity.dead_ball_action': UnityPracticeDeadBallActionMessage;
  'unity.protected_regions': UnityPracticeProtectedRegions;
  'unity.stats': UnityPracticeStats;
  'unity.benchmark': UnityPracticeBenchmarkResult;
  'unity.pause_request': { reason: 'player' };
  'unity.quiet': { quiet: boolean };
  'unity.unloaded': { retainedMemoryMb: number | null };
  'unity.error': UnityPracticeError;
};

export type UnityPracticeMessage<T extends UnityPracticeMessageType = UnityPracticeMessageType> = T extends UnityPracticeMessageType
  ? UnityPracticeEnvelope<T, UnityPracticePayloadByType[T]>
  : never;

export interface UnityPracticeEnvelopeFields {
  buildId: string;
  sessionId: string;
  deliveryId?: string | null;
  messageId: string;
  sequence: number;
}

export function makeUnityPracticeMessage<T extends UnityPracticeMessageType>(
  fields: UnityPracticeEnvelopeFields & { sender: UnityPracticeSenderFor<T> },
  type: T,
  payload: UnityPracticePayloadByType[T],
): UnityPracticeMessage<T> {
  if (!senderMatchesType(fields.sender, type)) throw new TypeError(`Sender ${fields.sender} cannot emit ${type}.`);
  return {
    contractVersion: UNITY_PRACTICE_CONTRACT_VERSION,
    simVersion: PRACTICE_SIM_VERSION,
    buildId: fields.buildId,
    sessionId: fields.sessionId,
    deliveryId: fields.deliveryId ?? null,
    messageId: fields.messageId,
    sequence: fields.sequence,
    sender: fields.sender,
    type,
    payload,
  } as UnityPracticeMessage<T>;
}

const MESSAGE_TYPES: ReadonlySet<string> = new Set<UnityPracticeMessageType>([
  'bridge.ack',
  'host.initialize',
  'host.clock_sync',
  'host.clock_selected',
  'host.scene',
  'host.delivery',
  'host.provisional_swing',
  'host.result',
  'host.dead_ball_ui',
  'host.replay',
  'host.demonstration',
  'host.demonstration_cancel',
  'host.profile',
  'host.locale',
  'host.benchmark',
  'host.pause',
  'host.resume',
  'host.dispose',
  'unity.ready',
  'unity.clock_sync',
  'unity.release',
  'unity.pointer',
  'unity.gesture',
  'unity.dead',
  'unity.dead_ball_action',
  'unity.protected_regions',
  'unity.stats',
  'unity.benchmark',
  'unity.pause_request',
  'unity.quiet',
  'unity.unloaded',
  'unity.error',
]);

const HOST_MESSAGE_TYPES: ReadonlySet<string> = new Set<UnityPracticeHostMessageType>([
  'host.initialize',
  'host.clock_sync',
  'host.clock_selected',
  'host.scene',
  'host.delivery',
  'host.provisional_swing',
  'host.result',
  'host.dead_ball_ui',
  'host.replay',
  'host.demonstration',
  'host.demonstration_cancel',
  'host.profile',
  'host.locale',
  'host.benchmark',
  'host.pause',
  'host.resume',
  'host.dispose',
]);

const UNITY_MESSAGE_TYPES: ReadonlySet<string> = new Set<UnityPracticeUnityMessageType>([
  'unity.ready',
  'unity.clock_sync',
  'unity.release',
  'unity.pointer',
  'unity.gesture',
  'unity.dead',
  'unity.dead_ball_action',
  'unity.protected_regions',
  'unity.stats',
  'unity.benchmark',
  'unity.pause_request',
  'unity.quiet',
  'unity.unloaded',
  'unity.error',
]);

const DELIVERY_MESSAGE_TYPES: ReadonlySet<string> = new Set<UnityPracticeMessageType>([
  'host.delivery',
  'host.provisional_swing',
  'host.result',
  'host.dead_ball_ui',
  'host.replay',
  'host.demonstration',
  'host.demonstration_cancel',
  'unity.release',
  'unity.pointer',
  'unity.gesture',
  'unity.dead',
  'unity.dead_ball_action',
  'unity.protected_regions',
]);

function senderMatchesType(sender: 'host' | 'unity', type: UnityPracticeMessageType): boolean {
  if (type === 'bridge.ack') return true;
  return sender === 'host' ? HOST_MESSAGE_TYPES.has(type) : UNITY_MESSAGE_TYPES.has(type);
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key)) && Object.keys(value).every((key) => allowed.has(key));
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function boundedIdentifier(value: unknown): value is string {
  return nonEmptyString(value) &&
    value.length <= UNITY_PRACTICE_MAX_IDENTIFIER_LENGTH &&
    !/[\u0000-\u001f\u007f]/u.test(value);
}

function localeTag(value: unknown): value is string {
  return nonEmptyString(value) && value.length <= 32 && !/[\u0000-\u001f\u007f]/u.test(value);
}

function boundedUiText(value: unknown, maximum: number, allowEmpty = false): value is string {
  if (typeof value !== 'string' || value.length > maximum || /\p{Cc}/u.test(value)) return false;
  return value.length === 0 ? allowEmpty : value.trim().length > 0;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function presentationNumber(value: unknown): value is number {
  return finite(value) && Math.abs(value) <= UNITY_PRACTICE_MAX_PRESENTATION_MAGNITUDE;
}

function traceTime(value: unknown): value is number {
  return finite(value) && value >= 0 && value <= UNITY_PRACTICE_MAX_TRACE_DURATION_SECONDS;
}

function signedTraceTime(value: unknown): value is number {
  return finite(value) && Math.abs(value) <= UNITY_PRACTICE_MAX_TRACE_DURATION_SECONDS;
}

function integer(value: unknown, minimum = 0): value is number {
  return Number.isSafeInteger(value) && (value as number) >= minimum;
}

function oneOf(value: unknown, values: readonly string[]): value is string {
  return typeof value === 'string' && values.includes(value);
}

function digest(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function vec3(value: unknown): boolean {
  return record(value) && presentationNumber(value.x) && presentationNumber(value.y) && presentationNumber(value.z);
}

function batterRootOffset(value: unknown): boolean {
  if (!record(value) || !exactKeys(value, ['x', 'z']) || !presentationNumber(value.x) || !presentationNumber(value.z)) return false;
  return Math.hypot(value.x, value.z) <= 0.18;
}

function exactVec3(value: unknown): boolean {
  return record(value) && exactKeys(value, ['x', 'y', 'z']) &&
    presentationNumber(value.x) && presentationNumber(value.y) && presentationNumber(value.z);
}

function batterBodyFrame(value: unknown): boolean {
  if (!(record(value) && exactKeys(value, ['stance', 'torsoTop', 'headCentre']) &&
    record(value.stance) && exactKeys(value.stance, ['x', 'z']) &&
    presentationNumber(value.stance.x) && presentationNumber(value.stance.z) &&
    exactVec3(value.torsoTop) && exactVec3(value.headCentre))) return false;
  const stance = value.stance as { x: number; z: number };
  const torso = value.torsoTop as Vec3;
  const head = value.headCentre as Vec3;
  return Math.abs(stance.x) <= 3 && stance.z >= 5 && stance.z <= 11 &&
    Math.abs(torso.x) <= 3 && torso.y >= 0 && torso.y <= 3 && torso.z >= 5 && torso.z <= 11 &&
    Math.abs(head.x) <= 3 && head.y >= torso.y && head.y <= 3 && head.z >= 5 && head.z <= 11 &&
    Math.hypot(torso.x - stance.x, torso.z - stance.z) <= 3 &&
    Math.hypot(head.x - torso.x, head.y - torso.y, head.z - torso.z) <= 1;
}

function batterPosture(value: unknown): boolean {
  return record(value) && exactKeys(value, ['crouchM']) && presentationNumber(value.crouchM) && value.crouchM >= 0 && value.crouchM <= 0.18;
}

function batterMotion(value: unknown): boolean {
  return record(value) && exactKeys(value, ['startT', 'contactT', 'endT']) &&
    traceTime(value.startT) && traceTime(value.contactT) && traceTime(value.endT) &&
    value.startT < value.contactT && value.contactT < value.endT;
}

function sameBatPose(left: Record<string, unknown>, right: Record<string, unknown>, tolerance = 0.000000001): boolean {
  for (const key of ['grip', 'toe', 'face'] as const) {
    const a = left[key] as Vec3;
    const b = right[key] as Vec3;
    if (Math.abs(a.x - b.x) > tolerance || Math.abs(a.y - b.y) > tolerance || Math.abs(a.z - b.z) > tolerance) return false;
  }
  return true;
}

const CANONICAL_BAT_LENGTH_METRES = 0.86;
const CANONICAL_BAT_LENGTH_TOLERANCE_METRES = 0.000001;
const CANONICAL_BAT_UNIT_TOLERANCE = 0.000001;
const CANONICAL_BAT_ORTHOGONALITY_TOLERANCE = 0.000001;
const EXACT_TRACE_TIME_TOLERANCE_SECONDS = 0.000000000001;

function rigidBatKnot(value: unknown): boolean {
  if (!record(value) || !traceTime(value.t) || !vec3(value.grip) || !vec3(value.toe) || !vec3(value.face)) return false;
  const grip = value.grip as Vec3;
  const toe = value.toe as Vec3;
  const face = value.face as Vec3;
  const axis = { x: grip.x - toe.x, y: grip.y - toe.y, z: grip.z - toe.z };
  const length = Math.hypot(axis.x, axis.y, axis.z);
  if (Math.abs(length - CANONICAL_BAT_LENGTH_METRES) > CANONICAL_BAT_LENGTH_TOLERANCE_METRES) return false;
  const faceLength = Math.hypot(face.x, face.y, face.z);
  if (Math.abs(faceLength - 1) > CANONICAL_BAT_UNIT_TOLERANCE) return false;
  const axisFaceDot = (axis.x * face.x + axis.y * face.y + axis.z * face.z) / length;
  return Math.abs(axisFaceDot) <= CANONICAL_BAT_ORTHOGONALITY_TOLERANCE;
}

function hasValidBatContactKnot(bat: unknown[], events: unknown[]): boolean {
  let contactEvents = 0;
  let contactT = 0;
  for (const event of events) {
    if (!record(event) || event.kind !== 'contact' || !oneOf(event.contact, ['middle', 'inside_edge', 'outside_edge', 'top_edge', 'leading_edge'])) continue;
    contactEvents++;
    contactT = event.t as number;
  }
  if (contactEvents > 1) return false;
  if (contactEvents === 0) return true;
  let matchingKnots = 0;
  for (const sample of bat) {
    if (record(sample) && Math.abs((sample.t as number) - contactT) <= EXACT_TRACE_TIME_TOLERANCE_SECONDS) matchingKnots++;
  }
  return matchingKnots === 1;
}

function plan(value: unknown): boolean {
  return (
    record(value) &&
    oneOf(value.variation, ['stock', 'outswing', 'inswing', 'seam', 'cutter', 'slower', 'bouncer', 'yorker', 'flighted', 'quicker', 'topspinner', 'arm_ball', 'wrong_un']) &&
    finite(value.lengthM) &&
    finite(value.lineM) &&
    finite(value.speedKph) &&
    value.lengthM >= 0 &&
    value.lengthM <= 12 &&
    value.speedKph >= 40 &&
    value.speedKph <= 180
  );
}

function bowler(value: unknown): boolean {
  if (!record(value) || !oneOf(value.family, ['pace', 'spin']) || !oneOf(value.arm, ['right', 'left']) || !nonEmptyString(value.lookSeed)) return false;
  if (value.paceBand !== undefined && !oneOf(value.paceBand, ['controlled', 'fast', 'express'])) return false;
  if (value.spinType !== undefined && !oneOf(value.spinType, ['finger', 'wrist'])) return false;
  return value.family === 'pace' ? value.paceBand !== undefined : value.spinType !== undefined;
}

function ballCondition(value: unknown): boolean {
  return record(value) && oneOf(value.colour, ['red', 'white']) && oneOf(value.age, ['new', 'worn']);
}

function field(value: unknown): boolean {
  if (!record(value) || !nonEmptyString(value.id) || !Array.isArray(value.fielders) || value.fielders.length !== 11) return false;
  const ids = new Set<string>();
  return value.fielders.every(
    (fielder) => {
      if (!record(fielder) || !nonEmptyString(fielder.id) || ids.has(fielder.id)) return false;
      ids.add(fielder.id);
      return (
        oneOf(fielder.role, ['keeper', 'bowler', 'slip', 'gully', 'point', 'backward_point', 'cover', 'extra_cover', 'mid_off', 'mid_on', 'midwicket', 'square_leg', 'fine_leg', 'third_man', 'deep_point', 'deep_cover', 'long_off', 'long_on', 'deep_midwicket', 'deep_square', 'short_leg', 'silly_point', 'leg_slip']) &&
        presentationNumber(fielder.x) &&
        presentationNumber(fielder.z)
      );
    },
  );
}

function ballSamples(value: unknown): boolean {
  if (!Array.isArray(value) || value.length === 0 || value.length > UNITY_PRACTICE_MAX_TRACE_SAMPLES) return false;
  let prior = -Infinity;
  for (const sample of value) {
    if (!record(sample) || !traceTime(sample.t) || sample.t < prior || !vec3(sample.p) || !vec3(sample.v)) return false;
    prior = sample.t;
  }
  return Math.abs((value[0] as { t: number }).t) <= 0.000001;
}

function flight(value: unknown): boolean {
  if (!record(value) || value.version !== PRACTICE_SIM_VERSION || !plan(value.plan) || !nonEmptyString(value.seed)) return false;
  if (!record(value.release) || !vec3(value.release.p) || !vec3(value.release.v) || !presentationNumber(value.release.spinRps) || !finite(value.release.seamDeg) || !finite(value.release.speedKph)) return false;
  if (value.bounce !== null && !(record(value.bounce) && traceTime(value.bounce.t) && vec3(value.bounce.p))) return false;
  if (!record(value.spin) || !vec3(value.spin.release) || (value.spin.afterBounce !== null && !vec3(value.spin.afterBounce))) return false;
  if (!record(value.seam) || !vec3(value.seam.axis) || !vec3(value.seam.shine) || !finite(value.seam.wobble)) return false;
  return traceTime(value.idealContactT) && traceTime(value.stumpsT) && typeof value.wouldHitStumps === 'boolean' && ballSamples(value.samples);
}

function normalizedSwing(value: unknown): boolean {
  return (
    record(value) &&
    oneOf(value.kind, ['defend', 'attack']) &&
    signedTraceTime(value.startT) &&
    presentationNumber(value.directionDeg) &&
    finite(value.power) &&
    value.power >= 0 &&
    value.power <= 1 &&
    finite(value.elevation) &&
    value.elevation >= 0 &&
    value.elevation <= 1 &&
    oneOf(value.footwork, ['auto', 'forward', 'back', 'across', 'down_track'])
  );
}

function gesture(value: unknown): boolean {
  if (!record(value) || !exactKeys(value, ['pointer', 'samples', 'surface'], ['footwork', 'key']) || !oneOf(value.pointer, ['touch', 'mouse', 'pen', 'keyboard'])) return false;
  if (!record(value.surface) || !exactKeys(value.surface, ['width', 'height']) || !finite(value.surface.width) || !finite(value.surface.height) || value.surface.width <= 0 || value.surface.height <= 0 || value.surface.width > 16_384 || value.surface.height > 16_384) return false;
  if (!Array.isArray(value.samples) || value.samples.length === 0 || value.samples.length > UNITY_PRACTICE_MAX_GESTURE_SAMPLES) return false;
  let prior = -Infinity;
  let first = 0;
  for (const sample of value.samples) {
    if (!record(sample) || !exactKeys(sample, ['t', 'x', 'y']) || !finite(sample.t) || sample.t < prior || !finite(sample.x) || !finite(sample.y)) return false;
    if (prior === -Infinity) first = sample.t;
    prior = sample.t;
  }
  if (prior - first > 3_000) return false;
  if (value.footwork !== undefined && !oneOf(value.footwork, ['auto', 'forward', 'back', 'across', 'down_track'])) return false;
  if (value.key !== undefined && !(record(value.key) && exactKeys(value.key, ['kind', 'screenBearingDeg', 'loft']) && oneOf(value.key.kind, ['defend', 'attack']) && finite(value.key.screenBearingDeg) && typeof value.key.loft === 'boolean')) return false;
  return true;
}

function deliveryRecord(value: unknown): boolean {
  return (
    record(value) &&
    value.version === PRACTICE_SIM_VERSION &&
    integer(value.overIndex) &&
    integer(value.ballIndex) &&
    bowler(value.bowler) &&
    plan(value.plan) &&
    nonEmptyString(value.seed) &&
    oneOf(value.conditions, ['balanced', 'green', 'hard', 'turning']) &&
    ballCondition(value.ball) &&
    field(value.field) &&
    oneOf(value.handedness, ['right', 'left']) &&
    oneOf(value.assist, ['learn', 'play', 'real']) &&
    finite(value.tierToleranceMs) &&
    (value.swing === null || normalizedSwing(value.swing)) &&
    [0, 1, 2, 3, 4, 6].includes(value.runs as number) &&
    (value.dismissal === null || oneOf(value.dismissal, ['bowled', 'caught', 'caught_behind', 'lbw']))
  );
}

function contact(value: unknown): boolean {
  if (!record(value) || !oneOf(value.kind, ['middle', 'inside_edge', 'outside_edge', 'top_edge', 'leading_edge', 'pad', 'body', 'miss', 'leave'])) return false;
  if (!oneOf(value.timing, ['perfect', 'solid', 'mistimed', 'missed', 'none'])) return false;
  for (const key of ['t', 'timingErrorMs', 'bladeU', 'faceBearingDeg', 'batSpeedKph', 'exitSpeedKph', 'exitBearingDeg', 'exitElevationDeg', 'intendedBearingDeg']) {
    if (value[key] !== null && !finite(value[key])) return false;
  }
  return value.point === null || vec3(value.point);
}

function outcome(value: unknown): boolean {
  return (
    record(value) &&
    [0, 1, 2, 3, 4, 6].includes(value.runs as number) &&
    (value.boundary === null || value.boundary === 4 || value.boundary === 6) &&
    (value.dismissal === null || oneOf(value.dismissal, ['bowled', 'caught', 'caught_behind', 'lbw'])) &&
    (value.fielderId === null || nonEmptyString(value.fielderId)) &&
    (value.endBearingDeg === null || finite(value.endBearingDeg)) &&
    (value.endDistanceM === null || finite(value.endDistanceM)) &&
    (value.region === null || nonEmptyString(value.region))
  );
}

function monotonic(values: unknown[], validate: (value: unknown) => boolean): boolean {
  let prior = -Infinity;
  for (const value of values) {
    if (!validate(value) || !record(value) || !traceTime(value.t) || value.t < prior) return false;
    prior = value.t;
  }
  return true;
}

/** Bat interpolation divides by every adjacent time span, so duplicate knots are invalid at the boundary. */
function strictlyMonotonic(values: unknown[], validate: (value: unknown) => boolean): boolean {
  let prior = -Infinity;
  for (const value of values) {
    if (!validate(value) || !record(value) || !traceTime(value.t) || value.t <= prior) return false;
    prior = value.t;
  }
  return true;
}

function fielderPath(value: unknown): boolean {
  if (!record(value) || !nonEmptyString(value.fielderId) || !Array.isArray(value.samples) || value.samples.length === 0 || value.samples.length > UNITY_PRACTICE_MAX_TRACE_SAMPLES) return false;
  return monotonic(
    value.samples,
    (sample) => record(sample) && traceTime(sample.t) && presentationNumber(sample.x) && presentationNumber(sample.z) && oneOf(sample.action, ['set', 'run', 'dive', 'catch', 'drop', 'pickup', 'throw', 'celebrate', 'idle']),
  );
}

function simEvent(value: unknown): boolean {
  if (!record(value) || !traceTime(value.t) || !oneOf(value.kind, ['release', 'bounce', 'contact', 'pad', 'stumps', 'keeper_take', 'ball_bounce', 'catch', 'field', 'throw', 'boundary', 'run', 'dead'])) return false;
  switch (value.kind) {
    case 'release':
    case 'dead':
      return true;
    case 'contact':
      return oneOf(value.contact, ['middle', 'inside_edge', 'outside_edge', 'top_edge', 'leading_edge', 'pad', 'body', 'miss', 'leave']) && vec3(value.p);
    case 'catch':
    case 'field':
    case 'throw':
      return nonEmptyString(value.fielderId) && vec3(value.p);
    case 'boundary':
      return (value.runs === 4 || value.runs === 6) && vec3(value.p);
    case 'run':
      return integer(value.completed, 1);
    default:
      return vec3(value.p);
  }
}

function coaching(value: unknown): boolean {
  return (
    record(value) &&
    oneOf(value.reason, ['found_the_gap', 'hit_to_fielder', 'cleared_the_rope', 'beat_the_field', 'caught_in_the_deep', 'caught_in_the_ring', 'edged_behind', 'edged_to_slip', 'too_early', 'too_late', 'beaten_by_swing', 'beaten_by_seam', 'beaten_by_turn', 'beaten_by_pace', 'beaten_by_bounce', 'played_across_the_line', 'missed_straight_ball', 'left_well', 'left_and_bowled', 'played_on', 'pad_in_line', 'solid_defence', 'mistimed_lofted']) &&
    (value.timing === null || oneOf(value.timing, ['early', 'on_time', 'late'])) &&
    (value.zone === null || oneOf(value.zone, ['third_man', 'point', 'cover', 'mid_off', 'mid_on', 'midwicket', 'square_leg', 'fine_leg'])) &&
    (value.fielderRole === null || oneOf(value.fielderRole, ['keeper', 'bowler', 'slip', 'gully', 'point', 'backward_point', 'cover', 'extra_cover', 'mid_off', 'mid_on', 'midwicket', 'square_leg', 'fine_leg', 'third_man', 'deep_point', 'deep_cover', 'long_off', 'long_on', 'deep_midwicket', 'deep_square', 'short_leg', 'silly_point', 'leg_slip'])) &&
    (value.lbw === null || oneOf(value.lbw, ['pitched_outside_leg', 'impact_outside_leg', 'impact_outside_off', 'missing', 'high', 'out']))
  );
}

function deliveryResult(value: unknown): boolean {
  if (!record(value) || value.version !== PRACTICE_SIM_VERSION || !flight(value.flight) || (value.swing !== null && !normalizedSwing(value.swing))) return false;
  if (!batterRootOffset(value.batterRootOffset)) return false;
  if (!batterBodyFrame(value.batterBodyFrame)) return false;
  if (!batterPosture(value.batterPosture)) return false;
  if (!oneOf(value.footwork, ['forward', 'back', 'across', 'down_track']) || !contact(value.contact) || !ballSamples(value.ball) || !outcome(value.outcome) || !traceTime(value.deadT) || value.deadT <= 0) return false;
  if (!Array.isArray(value.bat) || value.bat.length > UNITY_PRACTICE_MAX_TRACE_SAMPLES || !strictlyMonotonic(value.bat, rigidBatKnot)) return false;
  if (value.bat.length === 0) {
    const root = value.batterRootOffset as { x: number; z: number };
    const posture = value.batterPosture as { crouchM: number };
    if (Math.abs(root.x) > 0.000001 || Math.abs(root.z) > 0.000001 || Math.abs(posture.crouchM) > 0.000001 || value.batterMotion !== null) return false;
  } else {
    if (!batterMotion(value.batterMotion)) return false;
    const motion = value.batterMotion as { startT: number; contactT: number; endT: number };
    const first = value.bat[0] as { t: number };
    const last = value.bat[value.bat.length - 1] as { t: number };
    if (motion.startT !== first.t || motion.endT > last.t) return false;
    const contactKnots = (value.bat as unknown[]).filter((sample) => record(sample) && Math.abs((sample.t as number) - motion.contactT) <= EXACT_TRACE_TIME_TOLERANCE_SECONDS);
    const endKnots = (value.bat as unknown[]).filter((sample) => record(sample) && Math.abs((sample.t as number) - motion.endT) <= EXACT_TRACE_TIME_TOLERANCE_SECONDS);
    if (contactKnots.length !== 1 || endKnots.length !== 1) return false;
    const held = endKnots[0] as Record<string, unknown>;
    if ((value.bat as unknown[]).some((sample) => record(sample) && (sample.t as number) > motion.endT + EXACT_TRACE_TIME_TOLERANCE_SECONDS && !sameBatPose(sample, held))) return false;
  }
  if (!Array.isArray(value.fielders) || value.fielders.length !== 11 || !value.fielders.every(fielderPath)) return false;
  if (new Set((value.fielders as Array<{ fielderId: string }>).map((path) => path.fielderId)).size !== value.fielders.length) return false;
  if (!Array.isArray(value.events) || value.events.length === 0 || value.events.length > UNITY_PRACTICE_MAX_TRACE_EVENTS || !monotonic(value.events, simEvent)) return false;
  if (!hasValidBatContactKnot(value.bat, value.events)) return false;
  if (!coaching(value.coaching)) return false;
  if (value.lbw !== null && !(record(value.lbw) && typeof value.lbw.out === 'boolean' && oneOf(value.lbw.reason, ['pitched_outside_leg', 'impact_outside_leg', 'impact_outside_off', 'missing', 'high', 'out']) && vec3(value.lbw.impact) && vec3(value.lbw.projected))) return false;
  return true;
}

function resolution(value: unknown): boolean {
  if (!record(value) || !deliveryRecord(value.record) || !deliveryResult(value.result) || !record(value.score) || !digest(value.replayDigest)) return false;
  const deliveryRecordValue = value.record as DeliveryRecord;
  const deliveryResultValue = value.result as DeliveryResult;
  if (!integer(value.score.runs) || value.score.runs > 360 || (value.score.wickets !== 0 && value.score.wickets !== 1) || !integer(value.score.balls, 1) || value.score.balls > 60 || value.score.maxOvers !== 10) return false;
  if (deliveryRecordValue.runs !== deliveryResultValue.outcome.runs || deliveryRecordValue.dismissal !== deliveryResultValue.outcome.dismissal) return false;
  if ((deliveryResultValue.outcome.dismissal === null) !== (value.score.wickets === 0)) return false;
  if (deliveryRecordValue.seed !== deliveryResultValue.flight.seed || canonicalUnityPracticeJson(deliveryRecordValue.plan) !== canonicalUnityPracticeJson(deliveryResultValue.flight.plan)) return false;
  return canonicalUnityPracticeJson(deliveryRecordValue.swing) === canonicalUnityPracticeJson(deliveryResultValue.swing);
}

function deliveryPresentation(value: unknown): boolean {
  if (!record(value) || !exactKeys(value, ['coach', 'learnCue']) || typeof value.learnCue !== 'boolean') return false;
  if (value.coach === null) return true;
  if (value.learnCue || !record(value.coach) || !exactKeys(value.coach, ['contactPoint', 'contactT', 'stage'])) return false;
  if (![1, 2, 3, 4].includes(value.coach.stage as number)) return false;
  const contactAbsent = value.coach.contactT === null && value.coach.contactPoint === null;
  const contactPresent =
    traceTime(value.coach.contactT) &&
    record(value.coach.contactPoint) &&
    exactKeys(value.coach.contactPoint, ['x', 'y', 'z']) &&
    vec3(value.coach.contactPoint);
  // Stage four is explicitly no assistance and therefore carries no unused guide data.
  return (contactAbsent || contactPresent) && (value.coach.stage !== 4 || contactAbsent);
}

function unityDelivery(value: unknown): value is UnityPracticeDelivery {
  return (
    record(value) &&
    exactKeys(value, ['overIndex', 'ballIndex', 'plan', 'presentation', 'seed', 'flight']) &&
    integer(value.overIndex) &&
    value.overIndex < 10 &&
    integer(value.ballIndex) &&
    value.ballIndex < 6 &&
    plan(value.plan) &&
    nonEmptyString(value.seed) &&
    flight(value.flight) &&
    deliveryPresentation(value.presentation) &&
    value.seed === (value.flight as BallFlight).seed &&
    canonicalUnityPracticeJson(value.plan) === canonicalUnityPracticeJson((value.flight as BallFlight).plan)
  );
}

/** A demonstration may only present the exact delivery described by its canonical result. */
function deliveryPayloadMatchesResolution(deliveryValue: unknown, resolutionValue: unknown): boolean {
  if (!unityDelivery(deliveryValue) || !resolution(resolutionValue)) return false;
  const checkedResolution = resolutionValue as UnityPracticeResolution;
  const recordValue = checkedResolution.record;
  const resultValue = checkedResolution.result;
  return (
    recordValue.overIndex === deliveryValue.overIndex &&
    recordValue.ballIndex === deliveryValue.ballIndex &&
    recordValue.seed === deliveryValue.seed &&
    canonicalUnityPracticeJson(recordValue.plan) === canonicalUnityPracticeJson(deliveryValue.plan) &&
    canonicalUnityPracticeJson(resultValue.flight) === canonicalUnityPracticeJson(deliveryValue.flight)
  );
}

function protectedRegions(value: Record<string, unknown>): boolean {
  const viewportWidth = value.viewportWidth;
  const viewportHeight = value.viewportHeight;
  if (
    !integer(viewportWidth, 1) ||
    viewportWidth > 32_768 ||
    !integer(viewportHeight, 1) ||
    viewportHeight > 32_768 ||
    !Array.isArray(value.regions) ||
    value.regions.length < 1 ||
    value.regions.length > 6
  ) return false;
  const kinds = new Set<string>();
  for (const region of value.regions) {
    if (!record(region) || !exactKeys(region, ['height', 'kind', 'width', 'x', 'y'])) return false;
    if (!oneOf(region.kind, ['bowler', 'release', 'pitch', 'ball_path', 'bat', 'contact']) || kinds.has(region.kind)) return false;
    if (
      !finite(region.x) || region.x < 0 ||
      !finite(region.y) || region.y < 0 ||
      !finite(region.width) || region.width <= 0 ||
      !finite(region.height) || region.height <= 0 ||
      region.x + region.width > viewportWidth ||
      region.y + region.height > viewportHeight
    ) return false;
    kinds.add(region.kind);
  }
  return true;
}

const PAYLOAD_KEYS: Record<UnityPracticeMessageType, readonly string[]> = {
  'bridge.ack': ['acknowledgedMessageId'],
  'host.initialize': ['locale', 'pixelsPerDp', 'quality', 'deviceTier', 'handedness', 'assistance', 'reducedMotion', 'textScale', 'highContrast', 'captions', 'audio', 'haptics', 'coordinateSystem', 'handednessPolicy'],
  'host.clock_sync': ['sampleId', 'hostSendPerfMs'],
  'host.clock_selected': ['sampleId'],
  'host.scene': ['conditions', 'field', 'fieldIntent', 'trainingObjective', 'bowler', 'ball', 'handedness', 'batterPosition'],
  'host.delivery': ['overIndex', 'ballIndex', 'plan', 'presentation', 'seed', 'flight'],
  'host.provisional_swing': ['atPerfMs', 'calibrationMs', 'swing'],
  'host.result': ['record', 'result', 'score', 'replayDigest'],
  'host.dead_ball_ui': ['replayDigest', 'reason', 'recommendation', 'primaryAction', 'primaryLabel', 'secondaryAction', 'secondaryLabel'],
  'host.replay': ['resolution', 'speed', 'diagnostics'],
  'host.demonstration': ['delivery', 'resolution', 'speed'],
  'host.demonstration_cancel': [],
  'host.profile': ['quality'],
  'host.locale': ['locale'],
  'host.benchmark': ['benchmarkId', 'durationMs', 'warmupFrames', 'sampleCap', 'quality'],
  'host.pause': ['reason'],
  'host.resume': ['reason'],
  'host.dispose': ['reason'],
  'unity.ready': ['renderer', 'unityVersion'],
  'unity.clock_sync': ['sampleId', 'hostSendPerfMs', 'unityReceiveMs', 'unitySendMs'],
  'unity.release': ['releaseUnityMs', 'clockSampleId'],
  'unity.pointer': ['phase', 'atUnityMs', 'clockSampleId', 'pointer'],
  'unity.gesture': ['retention', 'clockSampleId', 'input'],
  'unity.dead': ['deadT', 'replayDigest'],
  'unity.dead_ball_action': ['action', 'replayDigest'],
  'unity.protected_regions': ['regions', 'viewportHeight', 'viewportWidth'],
  'unity.stats': ['quality', 'sampleCount', 'spikes', 'fps', 'avgFrameMs', 'p95FrameMs', 'p99FrameMs', 'worstFrameMs', 'inputToVisibleBatMs', 'memoryMb', 'thermalState'],
  'unity.benchmark': ['benchmarkId', 'quality', 'frameIntervalsMs', 'warmup', 'graphics', 'memoryMb', 'thermalState'],
  'unity.pause_request': ['reason'],
  'unity.quiet': ['quiet'],
  'unity.unloaded': ['retainedMemoryMb'],
  'unity.error': ['code', 'recoverable', 'detail', 'fallback'],
};

function payloadShape(type: UnityPracticeMessageType, payload: Record<string, unknown>): boolean {
  if (!exactKeys(payload, PAYLOAD_KEYS[type])) return false;
  switch (type) {
    case 'bridge.ack':
      return nonEmptyString(payload.acknowledgedMessageId);
    case 'host.initialize':
      return (
        localeTag(payload.locale) &&
        finite(payload.pixelsPerDp) &&
        payload.pixelsPerDp >= 1 &&
        payload.pixelsPerDp <= 8 &&
        oneOf(payload.quality, ['lite', 'standard', 'high']) &&
        oneOf(payload.deviceTier, ['full', 'assisted', 'below']) &&
        oneOf(payload.handedness, ['right', 'left']) &&
        oneOf(payload.assistance, ['learn', 'play', 'real']) &&
        typeof payload.reducedMotion === 'boolean' &&
        finite(payload.textScale) &&
        payload.textScale >= 1 &&
        payload.textScale <= 2 &&
        typeof payload.highContrast === 'boolean' &&
        typeof payload.captions === 'boolean' &&
        typeof payload.audio === 'boolean' &&
        typeof payload.haptics === 'boolean' &&
        payload.coordinateSystem === 'vande-striker-frame-v1' &&
        payload.handednessPolicy === 'physics-right-handed-presentation-mirrors-once'
      );
    case 'host.clock_sync':
      return nonEmptyString(payload.sampleId) && finite(payload.hostSendPerfMs);
    case 'host.clock_selected':
      return nonEmptyString(payload.sampleId);
    case 'host.scene':
      return (
        field(payload.field) &&
        oneOf(payload.fieldIntent, ['attack_outside_off', 'attack_the_stumps', 'short_ball_trap', 'yorker_and_boundaries', 'spin_close_catchers', 'save_singles', 'protect_boundaries']) &&
        oneOf(payload.trainingObjective, ['reference', 'built', 'random']) &&
        bowler(payload.bowler) &&
        ballCondition(payload.ball) &&
        oneOf(payload.conditions, ['balanced', 'green', 'hard', 'turning']) &&
        oneOf(payload.handedness, ['right', 'left']) &&
        record(payload.batterPosition) &&
        finite(payload.batterPosition.lateralM) &&
        Math.abs(payload.batterPosition.lateralM) <= 2 &&
        finite(payload.batterPosition.creaseOffsetM) &&
        Math.abs(payload.batterPosition.creaseOffsetM) <= 3 &&
        oneOf(payload.batterPosition.guard, ['leg', 'middle', 'off', 'custom'])
      );
    case 'host.delivery':
      return unityDelivery(payload);
    case 'host.provisional_swing':
      return finite(payload.atPerfMs) && finite(payload.calibrationMs) && normalizedSwing(payload.swing);
    case 'host.result':
      return resolution(payload);
    case 'host.dead_ball_ui': {
      if (
        !digest(payload.replayDigest) ||
        !boundedUiText(payload.reason, 160) ||
        !boundedUiText(payload.recommendation, 160, true) ||
        !oneOf(payload.primaryAction, ['practice_ball', 'next_ball']) ||
        !boundedUiText(payload.primaryLabel, 64)
      ) return false;
      if (payload.primaryAction === 'practice_ball') {
        return payload.secondaryAction === 'next_ball' && boundedUiText(payload.secondaryLabel, 64);
      }
      return payload.secondaryAction === null && payload.secondaryLabel === null;
    }
    case 'host.replay':
      return resolution(payload.resolution) && finite(payload.speed) && payload.speed > 0 && payload.speed <= 4 && typeof payload.diagnostics === 'boolean';
    case 'host.demonstration':
      return (
        deliveryPayloadMatchesResolution(payload.delivery, payload.resolution) &&
        finite(payload.speed) &&
        payload.speed > 0 &&
        payload.speed <= 4
      );
    case 'host.demonstration_cancel':
      return true;
    case 'host.profile':
      return oneOf(payload.quality, ['lite', 'standard', 'high']);
    case 'host.locale':
      return localeTag(payload.locale);
    case 'host.benchmark':
      return (
        nonEmptyString(payload.benchmarkId) &&
        finite(payload.durationMs) &&
        payload.durationMs >= 1_000 &&
        payload.durationMs <= UNITY_PRACTICE_MAX_BENCHMARK_DURATION_MS &&
        integer(payload.warmupFrames) &&
        payload.warmupFrames <= UNITY_PRACTICE_MAX_BENCHMARK_WARMUP_FRAMES &&
        integer(payload.sampleCap, 2) &&
        payload.sampleCap <= UNITY_PRACTICE_MAX_BENCHMARK_INTERVALS &&
        oneOf(payload.quality, ['lite', 'standard', 'high'])
      );
    case 'host.pause': return oneOf(payload.reason, ['player', 'background', 'interruption']);
    case 'host.resume': return oneOf(payload.reason, ['player', 'foreground', 'recreated']);
    case 'host.dispose': return oneOf(payload.reason, ['complete', 'cancelled', 'fallback', 'error']);
    case 'unity.ready':
      return nonEmptyString(payload.renderer) && nonEmptyString(payload.unityVersion);
    case 'unity.clock_sync':
      return (
        nonEmptyString(payload.sampleId) &&
        finite(payload.hostSendPerfMs) &&
        finite(payload.unityReceiveMs) &&
        finite(payload.unitySendMs) &&
        payload.unitySendMs >= payload.unityReceiveMs
      );
    case 'unity.release':
      return finite(payload.releaseUnityMs) && nonEmptyString(payload.clockSampleId);
    case 'unity.pointer':
      return oneOf(payload.phase, ['down', 'cancel']) && finite(payload.atUnityMs) && nonEmptyString(payload.clockSampleId) && oneOf(payload.pointer, ['touch', 'mouse', 'pen', 'keyboard']);
    case 'unity.gesture':
      return payload.retention === 'memory-until-resolution' && nonEmptyString(payload.clockSampleId) && gesture(payload.input);
    case 'unity.dead':
      return finite(payload.deadT) && digest(payload.replayDigest);
    case 'unity.dead_ball_action':
      return oneOf(payload.action, ['practice_ball', 'next_ball']) && digest(payload.replayDigest);
    case 'unity.protected_regions':
      return protectedRegions(payload);
    case 'unity.stats':
      return (
        oneOf(payload.quality, ['lite', 'standard', 'high']) &&
        integer(payload.sampleCount) &&
        payload.sampleCount <= UNITY_PRACTICE_MAX_BENCHMARK_INTERVALS &&
        integer(payload.spikes) &&
        payload.spikes <= payload.sampleCount &&
        finite(payload.fps) &&
        finite(payload.avgFrameMs) &&
        finite(payload.p95FrameMs) &&
        finite(payload.p99FrameMs) &&
        finite(payload.worstFrameMs) &&
        (payload.inputToVisibleBatMs === null || finite(payload.inputToVisibleBatMs)) &&
        (payload.memoryMb === null || finite(payload.memoryMb)) &&
        oneOf(payload.thermalState, ['unknown', 'nominal', 'fair', 'serious', 'critical'])
      );
    case 'unity.benchmark': {
      if (
        !nonEmptyString(payload.benchmarkId) ||
        !oneOf(payload.quality, ['lite', 'standard', 'high']) ||
        !Array.isArray(payload.frameIntervalsMs) ||
        payload.frameIntervalsMs.length === 0 ||
        payload.frameIntervalsMs.length > UNITY_PRACTICE_MAX_BENCHMARK_INTERVALS ||
        !payload.frameIntervalsMs.every((interval) => finite(interval) && interval > 0 && interval <= 10_000) ||
        !record(payload.warmup) ||
        !exactKeys(payload.warmup, ['frames', 'durationMs', 'shaderWarmupMs', 'shaderWarmupCompleted']) ||
        !integer(payload.warmup.frames) ||
        payload.warmup.frames > UNITY_PRACTICE_MAX_BENCHMARK_WARMUP_FRAMES ||
        !finite(payload.warmup.durationMs) ||
        payload.warmup.durationMs < 0 ||
        (payload.warmup.shaderWarmupMs !== null && (!finite(payload.warmup.shaderWarmupMs) || payload.warmup.shaderWarmupMs < 0)) ||
        typeof payload.warmup.shaderWarmupCompleted !== 'boolean' ||
        !record(payload.graphics) ||
        !exactKeys(payload.graphics, ['api', 'device', 'contextGeneration', 'contextLosses']) ||
        !nonEmptyString(payload.graphics.api) ||
        !nonEmptyString(payload.graphics.device) ||
        (payload.graphics.contextGeneration !== null && !integer(payload.graphics.contextGeneration)) ||
        (payload.graphics.contextLosses !== null && !integer(payload.graphics.contextLosses)) ||
        (payload.memoryMb !== null && (!finite(payload.memoryMb) || payload.memoryMb < 0))
      ) return false;
      return oneOf(payload.thermalState, ['unknown', 'nominal', 'fair', 'serious', 'critical']);
    }
    case 'unity.pause_request':
      return payload.reason === 'player';
    case 'unity.quiet':
      return typeof payload.quiet === 'boolean';
    case 'unity.unloaded':
      return payload.retainedMemoryMb === null || finite(payload.retainedMemoryMb);
    case 'unity.error':
      return (
        oneOf(payload.code, ['contract_version', 'simulation_version', 'integrity', 'invalid_message', 'out_of_order', 'timeout', 'unity_unavailable', 'unity_load_failed', 'unity_runtime', 'lifecycle', 'low_memory']) &&
        typeof payload.recoverable === 'boolean' &&
        nonEmptyString(payload.detail) &&
        oneOf(payload.fallback, ['three', 'classic', 'return_to_practice'])
      );
  }
}

export function isUnityPracticeMessage(value: unknown): value is UnityPracticeMessage {
  if (!record(value) || value.contractVersion !== UNITY_PRACTICE_CONTRACT_VERSION || value.simVersion !== PRACTICE_SIM_VERSION) return false;
  if (!exactKeys(value, ['contractVersion', 'simVersion', 'buildId', 'sessionId', 'deliveryId', 'messageId', 'sequence', 'sender', 'type', 'payload'])) return false;
  if (!boundedIdentifier(value.buildId) || !boundedIdentifier(value.sessionId) || !boundedIdentifier(value.messageId)) return false;
  if (value.deliveryId !== null && !boundedIdentifier(value.deliveryId)) return false;
  if (!Number.isSafeInteger(value.sequence) || (value.sequence as number) < 0) return false;
  if (value.sender !== 'host' && value.sender !== 'unity') return false;
  if (!nonEmptyString(value.type) || !MESSAGE_TYPES.has(value.type) || !record(value.payload)) return false;
  const type = value.type as UnityPracticeMessageType;
  if (!senderMatchesType(value.sender, type)) return false;
  if (DELIVERY_MESSAGE_TYPES.has(type) && !nonEmptyString(value.deliveryId)) return false;
  return payloadShape(type, value.payload);
}

export class UnityPracticeContractError extends Error {
  readonly code: 'invalid_json' | 'invalid_message' | 'packet_too_large' | 'integrity';

  constructor(code: UnityPracticeContractError['code'], message: string) {
    super(message);
    this.name = 'UnityPracticeContractError';
    this.code = code;
  }
}

export function parseUnityPracticeMessage(body: string): UnityPracticeMessage {
  if (new TextEncoder().encode(body).byteLength > UNITY_PRACTICE_MAX_PACKET_BYTES) {
    throw new UnityPracticeContractError('packet_too_large', 'Unity Practice message exceeds the local bridge limit.');
  }
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    throw new UnityPracticeContractError('invalid_json', 'Unity Practice message is not valid JSON.');
  }
  if (!isUnityPracticeMessage(value)) {
    throw new UnityPracticeContractError('invalid_message', 'Unity Practice message has an incompatible or invalid shape.');
  }
  return value;
}

/**
 * The canonical JSON text of one value, kept so that a document embedding that value copies the text instead of
 * canonicalizing the value again. Only this module makes fragments (the class is exported as a type alone), which is
 * what keeps "already canonical" true: sorted keys, scalars as JSON.stringify writes them.
 */
class CanonicalFragment {
  readonly json: string;

  // No parameter property: the goldens and scenario scripts load this file with Node's type stripping, which cannot erase one.
  constructor(json: string) {
    this.json = json;
  }
}
export type { CanonicalFragment };

interface CanonicalWalk {
  readonly seen: Set<object>;
  /** How many fragments the walk met: zero means JSON.stringify can write the whole tree. */
  fragments: number;
}

function canonicalValue(value: unknown, walk: CanonicalWalk): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Canonical JSON cannot contain a non-finite number.');
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map((item) => canonicalValue(item, walk));
  if (typeof value === 'object') {
    if (value instanceof CanonicalFragment) {
      walk.fragments += 1;
      return value;
    }
    if (walk.seen.has(value as object)) throw new TypeError('Canonical JSON cannot contain a cycle.');
    walk.seen.add(value as object);
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      if (source[key] === undefined) throw new TypeError('Canonical JSON cannot contain undefined.');
      out[key] = canonicalValue(source[key], walk);
    }
    walk.seen.delete(value as object);
    return out;
  }
  throw new TypeError(`Canonical JSON cannot contain ${typeof value}.`);
}

/** JSON.stringify of a canonicalValue tree that holds fragments: the same text, each fragment copied as it is. */
function stringifyWithFragments(value: unknown): string {
  if (value instanceof CanonicalFragment) return value.json;
  if (Array.isArray(value)) return `[${value.map((item) => stringifyWithFragments(item)).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const source = value as Record<string, unknown>;
    return `{${Object.keys(source).map((key) => `${JSON.stringify(key)}:${stringifyWithFragments(source[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * Sorted-key JSON. The checksum is over these exact UTF-8 bytes; receivers need not reformat them. A CanonicalFragment
 * inside the value is written as it is, so the text is the one the whole value would have given.
 */
export function canonicalUnityPracticeJson(value: unknown): string {
  const walk: CanonicalWalk = { seen: new Set<object>(), fragments: 0 };
  const canonical = canonicalValue(value, walk);
  return walk.fragments === 0 ? JSON.stringify(canonical) : stringifyWithFragments(canonical);
}

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

export async function unityPracticeSha256(body: string): Promise<string> {
  // DOM and WebWorker globals are both included by this project. Their merged
  // `globalThis` type does not consistently expose `crypto`, even though both
  // supported runtimes do. Keep the capability check explicit so a broken host
  // fails closed instead of silently emitting an unchecked bridge packet.
  const cryptoApi = (globalThis as unknown as { crypto?: Crypto }).crypto;
  if (!cryptoApi?.subtle) {
    throw new UnityPracticeContractError('integrity', 'SHA-256 is unavailable in this runtime.');
  }
  const digest = await cryptoApi.subtle.digest('SHA-256', new TextEncoder().encode(body));
  return toHex(new Uint8Array(digest));
}

/** The sender and type of the message inside a packet that packUnityPracticeMessage made. */
export interface PackedUnityPracticePacket {
  sender: UnityPracticeMessage['sender'];
  type: UnityPracticeMessage['type'];
}

// The packets packUnityPracticeMessage made in this runtime, by identity. Created on first use (see the note at resolutionFingerprint).
let packedPackets: WeakMap<UnityPracticePacket, PackedUnityPracticePacket> | undefined;

/**
 * What packUnityPracticeMessage recorded about a packet it made in this runtime, else null. Such a packet is frozen, so it is still
 * exactly what was packed: shape-checked, canonical, checksummed and, for a resolution, identity-checked then. A bridge may forward it
 * without unpacking it again. Any other packet (copied, altered, received or hand built) gets null and is unpacked as always.
 */
export function packedUnityPracticePacket(packet: UnityPracticePacket): PackedUnityPracticePacket | null {
  return packedPackets?.get(packet) ?? null;
}

export async function packUnityPracticeMessage(message: UnityPracticeMessage): Promise<UnityPracticePacket> {
  if (!isUnityPracticeMessage(message)) {
    throw new UnityPracticeContractError('invalid_message', 'Unity Practice message has an incompatible or invalid shape.');
  }
  const known = await verifyUnityPracticeReplayIdentity(message);
  const body = canonicalUnityPracticeJson(known === null ? message : withCanonicalResolution(message, known));
  if (new TextEncoder().encode(body).byteLength > UNITY_PRACTICE_MAX_PACKET_BYTES) {
    throw new UnityPracticeContractError('packet_too_large', 'Unity Practice message exceeds the local bridge limit.');
  }
  const packet: UnityPracticePacket = Object.freeze({ body, sha256: await unityPracticeSha256(body) });
  (packedPackets ??= new WeakMap()).set(packet, { sender: message.sender, type: message.type });
  return packet;
}

export async function unpackUnityPracticePacket(packet: UnityPracticePacket): Promise<UnityPracticeMessage> {
  if (!record(packet) || typeof packet.body !== 'string' || typeof packet.sha256 !== 'string') {
    throw new UnityPracticeContractError('invalid_message', 'Unity Practice packet has an invalid shape.');
  }
  if (!exactKeys(packet, ['body', 'sha256'])) {
    throw new UnityPracticeContractError('invalid_message', 'Unity Practice packet contains unsupported fields.');
  }
  if (new TextEncoder().encode(packet.body).byteLength > UNITY_PRACTICE_MAX_PACKET_BYTES) {
    throw new UnityPracticeContractError('packet_too_large', 'Unity Practice message exceeds the local bridge limit.');
  }
  if (!/^[0-9a-f]{64}$/.test(packet.sha256) || (await unityPracticeSha256(packet.body)) !== packet.sha256) {
    throw new UnityPracticeContractError('integrity', 'Unity Practice message failed its integrity check.');
  }
  const message = parseUnityPracticeMessage(packet.body);
  if (canonicalUnityPracticeJson(message) !== packet.body) {
    throw new UnityPracticeContractError('integrity', 'Unity Practice message body is not canonical JSON.');
  }
  await verifyUnityPracticeReplayIdentity(message);
  return message;
}

/** The canonical text of a record and of a result, and the replay digest over both. */
export interface CanonicalResolution {
  record: CanonicalFragment;
  result: CanonicalFragment;
  replayDigest: string;
}

async function digestCanonicalResolution(recordJson: string, resultJson: string): Promise<CanonicalResolution> {
  // canonicalUnityPracticeJson({ simVersion, record, result }) sorts its keys as record, result, simVersion, so the
  // text it would give is these two canonical texts between the keys: no value is walked a second time.
  const replayDigest = await unityPracticeSha256(`{"record":${recordJson},"result":${resultJson},"simVersion":${PRACTICE_SIM_VERSION}}`);
  return { record: new CanonicalFragment(recordJson), result: new CanonicalFragment(resultJson), replayDigest };
}

/** Canonicalizes the record and the result once and digests them, exactly as unityPracticeReplayDigest frames them. */
export async function canonicalizeUnityPracticeResolution(record: DeliveryRecord, result: DeliveryResult): Promise<CanonicalResolution> {
  return digestCanonicalResolution(canonicalUnityPracticeJson(record), canonicalUnityPracticeJson(result));
}

/** Exact framing for replay identity; Unity echoes this host-issued digest and never computes a different outcome. */
export async function unityPracticeReplayDigest(record: DeliveryRecord, result: DeliveryResult): Promise<string> {
  return (await canonicalizeUnityPracticeResolution(record, result)).replayDigest;
}

// A 32-bit tripwire over a resolution's live record and result, cheap enough (tens of microseconds for a 330 KB result)
// to run at every check: it reads every number of the bulk traces and walks the small remainder generically, so an
// appended, removed, replaced, reordered or rewritten sample changes it. It is not a checksum and never replaces the
// digest: when it differs the resolution is verified by recomputation, exactly as any other resolution is.
//
// The scratch arrays and the registry below are created on first use, never at module load: a module-level initialiser
// makes the bundler treat this module as having side effects, and the web build then moves it, and the modules it
// shares, out of the entry chunk into four extra chunks that the first page load must fetch (127 chunks became 131).
let fingerprintBits: Float64Array | undefined;
let fingerprintWords: Uint32Array | undefined;

function foldWord(hash: number, word: number): number {
  return Math.imul(((hash << 5) | (hash >>> 27)) ^ word, 0x9e3779b1);
}

function foldNumber(hash: number, value: number): number {
  if (fingerprintBits === undefined || fingerprintWords === undefined) {
    fingerprintBits = new Float64Array(1);
    fingerprintWords = new Uint32Array(fingerprintBits.buffer);
  }
  fingerprintBits[0] = value;
  return foldWord(foldWord(hash, fingerprintWords[0]), fingerprintWords[1]);
}

function foldString(hash: number, value: string): number {
  let next = foldWord(hash, value.length);
  for (let i = 0; i < value.length; i++) next = foldWord(next, value.charCodeAt(i));
  return next;
}

function foldVec3(hash: number, v: Vec3): number {
  return foldNumber(foldNumber(foldNumber(hash, v.x), v.y), v.z);
}

function foldValue(hash: number, value: unknown): number {
  switch (typeof value) {
    case 'number':
      return foldNumber(hash, value);
    case 'string':
      return foldString(hash, value);
    case 'boolean':
      return foldWord(hash, value ? 1 : 2);
    case 'object': {
      if (value === null) return foldWord(hash, 3);
      if (Array.isArray(value)) {
        let next = foldWord(hash, value.length);
        for (let i = 0; i < value.length; i++) next = foldValue(next, value[i]);
        return next;
      }
      const source = value as Record<string, unknown>;
      const keys = Object.keys(source);
      let next = foldWord(hash, keys.length);
      for (let i = 0; i < keys.length; i++) next = foldValue(foldString(next, keys[i]), source[keys[i]]);
      return next;
    }
    default:
      return foldWord(hash, 4);
  }
}

function foldBallSamples(hash: number, samples: BallSample[]): number {
  let next = foldWord(hash, samples.length);
  for (let i = 0; i < samples.length; i++) next = foldVec3(foldVec3(foldNumber(next, samples[i].t), samples[i].p), samples[i].v);
  return next;
}

function resolutionFingerprint(record: DeliveryRecord, result: DeliveryResult): number {
  // The bulk traces are read field by field; every other member of the result (a new one included) is walked generically.
  const { ball, bat, fielders, flight, ...resultRest } = result;
  const { samples, ...flightRest } = flight;
  let hash = foldValue(foldValue(foldValue(0, record), resultRest), flightRest);
  hash = foldBallSamples(foldBallSamples(hash, ball), samples);
  hash = foldWord(hash, bat.length);
  for (let i = 0; i < bat.length; i++) hash = foldVec3(foldVec3(foldVec3(foldNumber(hash, bat[i].t), bat[i].grip), bat[i].toe), bat[i].face);
  hash = foldWord(hash, fielders.length);
  for (let i = 0; i < fielders.length; i++) {
    const path = fielders[i].samples;
    hash = foldWord(foldString(hash, fielders[i].fielderId), path.length);
    for (let j = 0; j < path.length; j++) hash = foldString(foldNumber(foldNumber(foldNumber(hash, path[j].t), path[j].x), path[j].z), path[j].action);
  }
  return hash >>> 0;
}

/**
 * The resolutions this runtime made itself, each with the canonical text its digest was taken over. One found here,
 * whose record, result and digest are still the very objects and string that were digested and whose content still has
 * the fingerprint it had then, is verified and packed from that text, without recomputing it. A resolution that is not
 * here (hand built, copied, or arrived from Unity or the network) is always verified by recomputation.
 */
interface KnownResolution {
  readonly record: DeliveryRecord;
  readonly result: DeliveryResult;
  readonly canonical: CanonicalResolution;
  /** resolutionFingerprint, taken in the turn that canonicalized the record and the result. */
  readonly fingerprint: number;
}

let knownResolutions: WeakMap<UnityPracticeResolution, KnownResolution> | undefined;

/**
 * The only way the host makes a UnityPracticeResolution: it canonicalizes and digests the record and the result once,
 * and remembers that, so the identity checks and the packet that follow do not repeat it.
 */
export async function makeUnityPracticeResolution(
  record: DeliveryRecord,
  result: DeliveryResult,
  score: UnityPracticeResolution['score'],
): Promise<UnityPracticeResolution> {
  const recordJson = canonicalUnityPracticeJson(record);
  const resultJson = canonicalUnityPracticeJson(result);
  let fingerprint: number | null = null;
  try {
    fingerprint = resolutionFingerprint(record, result);
  } catch {
    // A result of an unexpected shape is simply never remembered; it is verified by recomputation.
  }
  const canonical = await digestCanonicalResolution(recordJson, resultJson);
  const resolution: UnityPracticeResolution = { record, result, score, replayDigest: canonical.replayDigest };
  if (fingerprint !== null) (knownResolutions ??= new WeakMap()).set(resolution, { record, result, canonical, fingerprint });
  return resolution;
}

/** The canonical text of a resolution made here and unchanged since, else null. */
function knownCanonicalResolution(resolution: UnityPracticeResolution): CanonicalResolution | null {
  const known = knownResolutions?.get(resolution);
  if (
    known === undefined ||
    known.record !== resolution.record ||
    known.result !== resolution.result ||
    known.canonical.replayDigest !== resolution.replayDigest
  ) return null;
  try {
    return resolutionFingerprint(known.record, known.result) === known.fingerprint ? known.canonical : null;
  } catch {
    return null;
  }
}

/** True when makeUnityPracticeResolution made the resolution and neither it nor its record and result have changed since. */
export function isUnchangedUnityPracticeResolution(resolution: UnityPracticeResolution): boolean {
  return knownCanonicalResolution(resolution) !== null;
}

/**
 * Whether two resolutions have the same canonical JSON. Resolutions made here and unchanged since are compared by identity or by the text
 * they were made with, so neither is canonicalized again; any other pair is canonicalized and compared as it always was.
 */
function sameUnityPracticeResolution(a: UnityPracticeResolution, b: UnityPracticeResolution): boolean {
  const knownA = knownCanonicalResolution(a);
  const knownB = knownA === null ? null : a === b ? knownA : knownCanonicalResolution(b);
  if (knownA !== null && knownB !== null) {
    if (a === b) return true;
    // Everything but the record and the result is small; the two are compared as the text each was made with.
    return knownA.record.json === knownB.record.json
      && knownA.result.json === knownB.result.json
      && canonicalUnityPracticeJson({ ...a, record: null, result: null }) === canonicalUnityPracticeJson({ ...b, record: null, result: null });
  }
  return canonicalUnityPracticeJson(a) === canonicalUnityPracticeJson(b);
}

/** Whether the resolution's digest is the digest of its own record and result. */
export async function hasValidUnityPracticeResolutionIdentity(resolution: UnityPracticeResolution): Promise<boolean> {
  return knownCanonicalResolution(resolution) !== null || (await resolutionDigestMatches(resolution));
}

async function resolutionDigestMatches(resolution: UnityPracticeResolution): Promise<boolean> {
  return resolution.replayDigest === (await unityPracticeReplayDigest(resolution.record, resolution.result));
}

function resolutionOf(message: UnityPracticeMessage): UnityPracticeResolution | null {
  if (message.type === 'host.result') return message.payload as UnityPracticeResolution;
  if (message.type === 'host.replay') return (message.payload as UnityPracticeReplay).resolution;
  if (message.type === 'host.demonstration') return (message.payload as UnityPracticeDemonstration).resolution;
  return null;
}

/**
 * Throws unless the message's resolution (if it has one) carries the digest of its own record and result. Returns the
 * canonical text of a resolution made here, which then needs no canonicalizing again, else null.
 */
async function verifyUnityPracticeReplayIdentity(message: UnityPracticeMessage): Promise<CanonicalResolution | null> {
  const resolution = resolutionOf(message);
  if (resolution === null) return null;
  const known = knownCanonicalResolution(resolution);
  if (known !== null) return known;
  if (!(await resolutionDigestMatches(resolution))) {
    throw new UnityPracticeContractError('integrity', 'Unity Practice replay identity does not match its authoritative record and result.');
  }
  return null;
}

/** The same message with the record and the result of its resolution replaced by their canonical text. */
function withCanonicalResolution(message: UnityPracticeMessage, known: CanonicalResolution): unknown {
  const embed = (resolution: UnityPracticeResolution) => ({ ...resolution, record: known.record, result: known.result });
  if (message.type === 'host.result') return { ...message, payload: embed(message.payload as UnityPracticeResolution) };
  if (message.type === 'host.replay' || message.type === 'host.demonstration') {
    const payload = message.payload as UnityPracticeReplay | UnityPracticeDemonstration;
    return { ...message, payload: { ...payload, resolution: embed(payload.resolution) } };
  }
  return message;
}

/** Duplicate/out-of-order guard kept independently by each sender/receiver pair. */
export class UnityPracticeSequenceGuard {
  private readonly seen = new Set<string>();
  private readonly order: string[] = [];
  private lastSequence = -1;

  classify(message: Pick<UnityPracticeEnvelope, 'messageId' | 'sequence'>): 'accept' | 'duplicate' | 'out_of_order' {
    if (this.seen.has(message.messageId)) return 'duplicate';
    if (message.sequence <= this.lastSequence) return 'out_of_order';
    return 'accept';
  }

  accept(message: Pick<UnityPracticeEnvelope, 'messageId' | 'sequence'>): 'accept' | 'duplicate' | 'out_of_order' {
    const decision = this.classify(message);
    if (decision !== 'accept') return decision;
    this.seen.add(message.messageId);
    this.order.push(message.messageId);
    if (this.order.length > UNITY_PRACTICE_MAX_SEEN_MESSAGES) {
      const oldest = this.order.shift();
      if (oldest !== undefined) this.seen.delete(oldest);
    }
    this.lastSequence = message.sequence;
    return 'accept';
  }
}

/** Both runtimes require the same five-sample exchange; the lowest-RTT sample is then selected explicitly. */
export const UNITY_PRACTICE_MIN_CLOCK_SAMPLES = 5;

export type UnityPracticeProtocolPhase =
  | 'cold'
  | 'loading'
  | 'ready'
  | 'scene_ready'
  | 'delivery'
  | 'resolved'
  | 'dead_ball'
  | 'replaying'
  | 'demonstrating'
  | 'disposing'
  | 'unloaded'
  | 'failed';

export type UnityPracticeProtocolDecision =
  | 'accept'
  | 'duplicate'
  | 'out_of_order'
  | 'invalid_message'
  | 'session_mismatch'
  | 'invalid_transition'
  | 'delivery_mismatch'
  | 'handedness_mismatch'
  | 'clock_unsynchronized'
  | 'clock_mismatch'
  | 'benchmark_mismatch'
  | 'replay_mismatch'
  | 'duplicate_action'
  | 'action_unavailable';

/**
 * Stateful guard for the bidirectional stream. Call it for both outbound host messages and inbound Unity messages.
 * It binds one build/session, enforces direction and ordering, requires clock synchronization before scene/play, and
 * prevents Unity from acknowledging a different delivery or replay. Invalid messages do not advance sequence state.
 */
export class UnityPracticeProtocolGuard {
  private readonly hostSequence = new UnityPracticeSequenceGuard();
  private readonly unitySequence = new UnityPracticeSequenceGuard();
  private readonly pendingClock = new Map<string, number>();
  private readonly acceptedClock = new Set<string>();
  private readonly pendingBenchmarks = new Map<string, QualityProfileId>();
  private selectedClockId: string | null = null;
  private buildId: string | null = null;
  private sessionId: string | null = null;
  private handedness: Handedness | null = null;
  private assistance: AssistLevel | null = null;
  private scene: UnityPracticeScene | null = null;
  private activeDelivery: UnityPracticeDelivery | null = null;
  private provisionalSwing: NormalizedSwing | null | undefined;
  private lastResolution: UnityPracticeResolution | null = null;
  private activeDeliveryId: string | null = null;
  private lastDeliveryId: string | null = null;
  private replayDigest: string | null = null;
  /** Demo completion identity is separate so a Coach performance cannot replace the last scored ball. */
  private demonstrationDigest: string | null = null;
  private demonstrationReturnPhase: 'scene_ready' | 'dead_ball' | null = null;
  /**
   * A cancelled demo can still have already-queued native release/projection/dead
   * packets. Retain their exact identity so those packets consume the ordered
   * Unity sequence without changing the current live presentation.
   */
  private readonly cancelledDemonstrationDigests = new Map<string, string>();
  private lastDemonstrationId: string | null = null;
  private deadBallUiSent = false;
  private deadBallActionAccepted = false;
  private deadBallActionsHeld = false;
  private paused = false;
  private currentPhase: UnityPracticeProtocolPhase = 'cold';

  get phase(): UnityPracticeProtocolPhase {
    return this.currentPhase;
  }

  get clockReady(): boolean {
    return this.acceptedClock.size >= UNITY_PRACTICE_MIN_CLOCK_SAMPLES;
  }

  acceptsClockSample(sampleId: string): boolean {
    return this.acceptedClock.has(sampleId);
  }

  /**
   * Closes the native dead-ball action gate synchronously before the async
   * host.pause packet can cross runtimes. The validated host.resume transition
   * is still the only operation that reopens it.
   */
  suspendDeadBallActions(): void {
    this.paused = true;
  }

  accept(value: unknown): UnityPracticeProtocolDecision {
    if (!isUnityPracticeMessage(value)) return 'invalid_message';
    const message = value;

    if (this.currentPhase === 'cold') {
      if (message.type !== 'host.initialize' || message.deliveryId !== null) return 'invalid_transition';
    } else if (message.buildId !== this.buildId || message.sessionId !== this.sessionId) {
      return 'session_mismatch';
    }

    const sequence = message.sender === 'host' ? this.hostSequence : this.unitySequence;
    const sequenceDecision = sequence.classify(message);
    if (sequenceDecision !== 'accept') return sequenceDecision;

    const transitionDecision = this.transition(message);
    if (transitionDecision === 'duplicate_action' || transitionDecision === 'action_unavailable') {
      // These delivery-scoped actions are intentionally ignored, but their
      // validated envelope sequence is consumed so one stale tap cannot make
      // every later runtime message appear out of order.
      const consumed = sequence.accept(message);
      return consumed === 'accept' ? transitionDecision : consumed;
    }
    if (transitionDecision !== 'accept') return transitionDecision;
    return sequence.accept(message);
  }

  private transition(message: UnityPracticeMessage): UnityPracticeProtocolDecision {
    if (message.type === 'bridge.ack') return this.currentPhase === 'cold' ? 'invalid_transition' : 'accept';

    switch (message.type) {
      case 'host.initialize':
        if (this.currentPhase !== 'cold') return 'invalid_transition';
        this.buildId = message.buildId;
        this.sessionId = message.sessionId;
        this.handedness = message.payload.handedness;
        this.assistance = message.payload.assistance;
        this.currentPhase = 'loading';
        return 'accept';

      case 'unity.ready':
        if (this.currentPhase !== 'loading' || message.deliveryId !== null) return 'invalid_transition';
        this.currentPhase = 'ready';
        return 'accept';

      case 'host.clock_sync':
        if (!['ready', 'scene_ready'].includes(this.currentPhase) || message.deliveryId !== null) return 'invalid_transition';
        this.pendingClock.set(message.payload.sampleId, message.payload.hostSendPerfMs);
        return 'accept';

      case 'unity.clock_sync': {
        if (!['ready', 'scene_ready'].includes(this.currentPhase) || message.deliveryId !== null) return 'invalid_transition';
        const expected = this.pendingClock.get(message.payload.sampleId);
        if (expected === undefined || expected !== message.payload.hostSendPerfMs) return 'clock_mismatch';
        this.pendingClock.delete(message.payload.sampleId);
        this.acceptedClock.add(message.payload.sampleId);
        return 'accept';
      }

      case 'host.clock_selected':
        if (!['ready', 'scene_ready'].includes(this.currentPhase) || message.deliveryId !== null) return 'invalid_transition';
        if (!this.clockReady || !this.acceptedClock.has(message.payload.sampleId)) return 'clock_mismatch';
        this.selectedClockId = message.payload.sampleId;
        return 'accept';

      case 'host.scene':
        if (!['ready', 'scene_ready', 'dead_ball'].includes(this.currentPhase) || message.deliveryId !== null) return 'invalid_transition';
        if (!this.clockReady || this.selectedClockId === null) return 'clock_unsynchronized';
        if (message.payload.handedness !== this.handedness) return 'handedness_mismatch';
        this.scene = message.payload;
        this.deadBallUiSent = false;
        this.currentPhase = 'scene_ready';
        return 'accept';

      case 'host.delivery':
        if (!['scene_ready', 'dead_ball'].includes(this.currentPhase) || message.deliveryId === null) return 'invalid_transition';
        this.activeDelivery = message.payload;
        this.provisionalSwing = undefined;
        this.activeDeliveryId = message.deliveryId;
        this.replayDigest = null;
        this.deadBallUiSent = false;
        this.deadBallActionAccepted = false;
        this.deadBallActionsHeld = false;
        this.currentPhase = 'delivery';
        return 'accept';

      case 'unity.release':
        if (message.deliveryId !== null && this.cancelledDemonstrationDigests.has(message.deliveryId)) {
          return message.payload.clockSampleId === this.selectedClockId ? 'accept' : 'clock_mismatch';
        }
        if (!['delivery', 'demonstrating'].includes(this.currentPhase) || !this.matchesActiveDelivery(message.deliveryId)) return 'delivery_mismatch';
        return message.payload.clockSampleId === this.selectedClockId ? 'accept' : 'clock_mismatch';

      case 'unity.pointer':
        if (!['delivery', 'resolved'].includes(this.currentPhase) || !this.matchesActiveDelivery(message.deliveryId)) return 'delivery_mismatch';
        return message.payload.clockSampleId === this.selectedClockId ? 'accept' : 'clock_mismatch';

      case 'unity.gesture':
        if (!['delivery', 'resolved'].includes(this.currentPhase) || !this.matchesActiveDelivery(message.deliveryId)) return 'delivery_mismatch';
        return message.payload.clockSampleId === this.selectedClockId ? 'accept' : 'clock_mismatch';

      case 'host.provisional_swing':
        if (this.currentPhase !== 'delivery' || !this.matchesActiveDelivery(message.deliveryId)) return 'delivery_mismatch';
        this.provisionalSwing = message.payload.swing;
        return 'accept';

      case 'host.result':
        if (this.currentPhase !== 'delivery' || !this.matchesActiveDelivery(message.deliveryId)) return 'delivery_mismatch';
        if (!this.resultMatchesActive(message.payload)) return 'delivery_mismatch';
        this.lastDeliveryId = message.deliveryId;
        this.lastResolution = message.payload;
        this.replayDigest = message.payload.replayDigest;
        this.deadBallUiSent = false;
        this.deadBallActionAccepted = false;
        this.currentPhase = 'resolved';
        return 'accept';

      case 'host.dead_ball_ui':
        if (this.currentPhase !== 'dead_ball' || message.deliveryId !== this.lastDeliveryId) return 'invalid_transition';
        if (message.payload.replayDigest !== this.replayDigest) return 'replay_mismatch';
        // A Coach insight update can already be queued when the player chooses.
        // It still crosses the ordered stream and receives a benign ACK; the
        // runtime must not render it after the consumed action.
        if (this.deadBallActionAccepted) return 'accept';
        this.deadBallUiSent = true;
        return 'accept';

      case 'host.replay':
        if (!['resolved', 'scene_ready', 'dead_ball'].includes(this.currentPhase) || message.deliveryId !== this.lastDeliveryId) return 'delivery_mismatch';
        if (this.replayDigest !== message.payload.resolution.replayDigest) return 'replay_mismatch';
        if (this.lastResolution === null || !sameUnityPracticeResolution(this.lastResolution, message.payload.resolution)) return 'replay_mismatch';
        this.activeDeliveryId = message.deliveryId;
        this.deadBallUiSent = false;
        this.currentPhase = 'replaying';
        return 'accept';

      case 'host.demonstration': {
        if (!['scene_ready', 'dead_ball'].includes(this.currentPhase) || message.deliveryId === null) return 'invalid_transition';
        if (!this.resultMatchesDelivery(message.payload.delivery, message.payload.resolution, undefined)) return 'delivery_mismatch';
        this.lastDemonstrationId = null;
        this.demonstrationReturnPhase = this.currentPhase === 'dead_ball' ? 'dead_ball' : 'scene_ready';
        this.demonstrationDigest = message.payload.resolution.replayDigest;
        this.activeDelivery = message.payload.delivery;
        this.activeDeliveryId = message.deliveryId;
        this.provisionalSwing = undefined;
        this.deadBallUiSent = false;
        this.deadBallActionAccepted = false;
        this.deadBallActionsHeld = false;
        this.currentPhase = 'demonstrating';
        return 'accept';
      }

      case 'host.demonstration_cancel': {
        // Completion can cross Skip in flight. The native bridge treats a
        // cancellation of that just-completed exact demo as a benign,
        // ACK-backed reset; mirror that lifecycle here.
        if (this.currentPhase !== 'demonstrating') {
          return message.deliveryId !== null && message.deliveryId === this.lastDemonstrationId
            ? 'accept'
            : 'delivery_mismatch';
        }
        if (!this.matchesActiveDelivery(message.deliveryId) || message.deliveryId === null || this.demonstrationDigest === null) {
          return 'delivery_mismatch';
        }
        this.rememberCancelledDemonstration(message.deliveryId, this.demonstrationDigest);
        this.lastDemonstrationId = message.deliveryId;
        this.activeDelivery = null;
        this.activeDeliveryId = null;
        this.provisionalSwing = undefined;
        this.demonstrationDigest = null;
        this.currentPhase = this.demonstrationReturnPhase ?? 'scene_ready';
        this.demonstrationReturnPhase = null;
        return 'accept';
      }

      case 'unity.dead': {
        if (message.deliveryId !== null) {
          const cancelledDigest = this.cancelledDemonstrationDigests.get(message.deliveryId);
          if (cancelledDigest !== undefined) {
            return message.payload.replayDigest === cancelledDigest ? 'accept' : 'replay_mismatch';
          }
        }
        if (!['resolved', 'replaying', 'demonstrating'].includes(this.currentPhase) || !this.matchesActiveDelivery(message.deliveryId)) return 'delivery_mismatch';
        if (this.currentPhase === 'demonstrating') {
          if (message.payload.replayDigest !== this.demonstrationDigest) return 'replay_mismatch';
          this.lastDemonstrationId = message.deliveryId;
          this.activeDeliveryId = null;
          this.activeDelivery = null;
          this.provisionalSwing = undefined;
          this.demonstrationDigest = null;
          this.deadBallUiSent = false;
          this.deadBallActionAccepted = false;
          this.currentPhase = this.demonstrationReturnPhase ?? 'scene_ready';
          this.demonstrationReturnPhase = null;
          return 'accept';
        }
        if (message.payload.replayDigest !== this.replayDigest) return 'replay_mismatch';
        this.activeDeliveryId = null;
        this.activeDelivery = null;
        this.provisionalSwing = undefined;
        this.deadBallUiSent = false;
        this.deadBallActionAccepted = false;
        this.currentPhase = 'dead_ball';
        return 'accept';
      }

      case 'unity.dead_ball_action':
        if (this.currentPhase !== 'dead_ball' || this.paused || this.deadBallActionsHeld || !this.deadBallUiSent) return 'action_unavailable';
        if (message.deliveryId !== this.lastDeliveryId) return 'delivery_mismatch';
        if (message.payload.replayDigest !== this.replayDigest) return 'replay_mismatch';
        if (this.deadBallActionAccepted) return 'duplicate_action';
        this.deadBallActionAccepted = true;
        return 'accept';

      case 'unity.protected_regions':
        if (message.deliveryId !== null && this.cancelledDemonstrationDigests.has(message.deliveryId)) return 'accept';
        return ['delivery', 'resolved', 'demonstrating'].includes(this.currentPhase) && this.matchesActiveDelivery(message.deliveryId)
          ? 'accept'
          : 'delivery_mismatch';

      case 'host.profile':
      case 'host.locale':
        return ['ready', 'scene_ready', 'delivery', 'resolved', 'dead_ball', 'replaying', 'demonstrating'].includes(this.currentPhase) && message.deliveryId === null
          ? 'accept'
          : 'invalid_transition';

      case 'host.pause':
        if (!['ready', 'scene_ready', 'delivery', 'resolved', 'dead_ball', 'replaying', 'demonstrating'].includes(this.currentPhase) || message.deliveryId !== null) return 'invalid_transition';
        this.paused = true;
        return 'accept';

      case 'host.resume':
        if (!['ready', 'scene_ready', 'delivery', 'resolved', 'dead_ball', 'replaying', 'demonstrating'].includes(this.currentPhase) || message.deliveryId !== null) return 'invalid_transition';
        this.paused = false;
        // Foreground lifecycle resumes the engine/protocol but not the hidden
        // native dead-ball controls. Explicit player/recreated resume releases
        // that presentation hold.
        this.deadBallActionsHeld = message.payload.reason === 'foreground';
        return 'accept';

      case 'host.benchmark':
        if (!['ready', 'scene_ready'].includes(this.currentPhase) || message.deliveryId !== null) return 'invalid_transition';
        if (!this.clockReady || this.selectedClockId === null || this.pendingBenchmarks.has(message.payload.benchmarkId)) return 'benchmark_mismatch';
        this.pendingBenchmarks.set(message.payload.benchmarkId, message.payload.quality);
        return 'accept';

      case 'unity.benchmark': {
        if (!['ready', 'scene_ready'].includes(this.currentPhase) || message.deliveryId !== null) return 'invalid_transition';
        const quality = this.pendingBenchmarks.get(message.payload.benchmarkId);
        if (quality === undefined || quality !== message.payload.quality) return 'benchmark_mismatch';
        this.pendingBenchmarks.delete(message.payload.benchmarkId);
        return 'accept';
      }

      case 'unity.stats':
      case 'unity.pause_request':
      case 'unity.quiet':
        return ['ready', 'scene_ready', 'delivery', 'resolved', 'dead_ball', 'replaying', 'demonstrating'].includes(this.currentPhase) && message.deliveryId === null
          ? 'accept'
          : 'invalid_transition';

      case 'host.dispose':
        if (['cold', 'disposing', 'unloaded'].includes(this.currentPhase) || message.deliveryId !== null) return 'invalid_transition';
        this.currentPhase = 'disposing';
        return 'accept';

      case 'unity.unloaded':
        if (this.currentPhase !== 'disposing' || message.deliveryId !== null) return 'invalid_transition';
        this.currentPhase = 'unloaded';
        return 'accept';

      case 'unity.error':
        if (['cold', 'unloaded'].includes(this.currentPhase)) return 'invalid_transition';
        if (!message.payload.recoverable) this.currentPhase = 'failed';
        return 'accept';
    }
  }

  private rememberCancelledDemonstration(deliveryId: string, replayDigest: string): void {
    this.cancelledDemonstrationDigests.set(deliveryId, replayDigest);
    if (this.cancelledDemonstrationDigests.size <= 32) return;
    const oldest = this.cancelledDemonstrationDigests.keys().next().value as string | undefined;
    if (oldest) this.cancelledDemonstrationDigests.delete(oldest);
  }

  private matchesActiveDelivery(deliveryId: string | null): boolean {
    return deliveryId !== null && deliveryId === this.activeDeliveryId;
  }

  private resultMatchesActive(resolution: UnityPracticeResolution): boolean {
    const delivery = this.activeDelivery;
    return delivery ? this.resultMatchesDelivery(delivery, resolution, this.provisionalSwing) : false;
  }

  private resultMatchesDelivery(
    delivery: UnityPracticeDelivery,
    resolution: UnityPracticeResolution,
    provisionalSwing: NormalizedSwing | null | undefined,
  ): boolean {
    const scene = this.scene;
    if (!scene) return false;
    const record = resolution.record;
    if (record.overIndex !== delivery.overIndex || record.ballIndex !== delivery.ballIndex || record.seed !== delivery.seed) return false;
    if (canonicalUnityPracticeJson(record.plan) !== canonicalUnityPracticeJson(delivery.plan)) return false;
    if (canonicalUnityPracticeJson(resolution.result.flight) !== canonicalUnityPracticeJson(delivery.flight)) return false;
    if (canonicalUnityPracticeJson(record.bowler) !== canonicalUnityPracticeJson(scene.bowler)) return false;
    if (canonicalUnityPracticeJson(record.field) !== canonicalUnityPracticeJson(scene.field)) return false;
    if (canonicalUnityPracticeJson(record.ball) !== canonicalUnityPracticeJson(scene.ball)) return false;
    if (record.conditions !== scene.conditions || record.handedness !== scene.handedness || record.assist !== this.assistance) return false;
    return provisionalSwing === undefined || canonicalUnityPracticeJson(record.swing) === canonicalUnityPracticeJson(provisionalSwing);
  }
}
