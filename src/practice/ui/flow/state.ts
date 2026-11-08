/**
 * The Practice flow's state (what the screens render) and its constants. One screen, one purpose: the screen says
 * which purpose is on show, the phase says where a delivery is. Delivery Quiet Mode is phases runup, live and playing.
 */
import type {
  AssistLevel,
  AttemptComparison,
  BowlerProfile,
  CoachAnalysis,
  DeliveryRecord,
  DeliveryResult,
  DeviceAssessment,
  Difficulty,
  FieldIntent,
  FieldLayout,
  Handedness,
  MasteryState,
  PerfTier,
  PitchCondition,
  PracticeInningsState,
  PracticeOverPlan,
  PrimaryInsight,
  QualityProfileId,
} from '@/contracts';
import type { ChaseDecided, ChaseHistoryEntry, ChaseState, ChaseSummary } from '@/practice/chase/types';
import type { BowlingChoice } from '@/practice/store';
import type { CoachTipLike } from './coachTypes';
import type { LessonState } from '../lesson/machine';

export type FlowScreen =
  'idle' | 'setup' | 'live' | 'coach' | 'over_summary' | 'out' | 'complete' | 'chase_result' | 'error';
export type LivePhase =
  | 'idle'
  | 'loading'
  | 'intro'
  | 'lesson'
  | 'camera'
  | 'ready'
  | 'runup'
  | 'live'
  | 'playing'
  | 'dead'
  | 'demo'
  | 'closeup'
  | 'replay'
  | 'paused';
export type BallKind = 'innings' | 'repeat';
/** Calm notices, shown between balls (never during a delivery). */
export type FlowNotice =
  | 'classic'
  | 'balanced'
  | 'camera_web'
  | 'help_changed'
  | 'help_less'
  | 'interrupted'
  | 'resumed_leave'
  | 'updated'
  | 'unreadable'
  | null;
/** How the over was chosen: a Random Over (balanced defaults unless changed), the reference over, or the player's own six. */
export type OverKind = 'random' | 'reference' | 'built';

export interface RandomChoice {
  difficulty: Difficulty;
  conditions: PitchCondition;
  bowling: BowlingChoice;
}

/** The over on the setup screen (PREPARE), not yet bowled from (or, for a resumed over, part-way through). */
export interface PendingOver {
  kind: OverKind;
  plan: PracticeOverPlan;
  field: FieldLayout;
  intent: FieldIntent | null;
  overNumber: number;
  conditions: PitchCondition;
  assist: AssistLevel;
  handedness: Handedness;
  random: RandomChoice | null;
  /** The innings already exists, so its pitch and assistance are fixed. */
  continuing: boolean;
  /** Balls of this over already bowled (a resumed or restarted over). */
  bowled: number;
}

export interface LastBall {
  kind: BallKind;
  result: DeliveryResult;
  /** The committed record (innings balls), or the attempt's record (Coach Mode: the source with this swing). */
  record: DeliveryRecord;
  overNumber: number;
  ballNumber: number;
  interrupted: boolean;
}

/** The coach's reading of the dead ball (computed off the main path: the outcome shows at once). */
export interface Insight {
  key: string;
  status: 'working' | 'ready' | 'failed';
  analysis: CoachAnalysis | null;
  primary: PrimaryInsight | null;
  /**
   * The card's one sentence (src/practice/coach tip.ts): the measured fact and exactly one action, the action being
   * `primary.recommendation` itself. Null while working, or if the tip could not be formed (the card then words the
   * primary insight on its own).
   */
  tip: CoachTipLike | null;
}

/** Exact-ball Coach Mode: the same delivery, again, with less and less help. */
export interface CoachSession {
  key: string;
  source: DeliveryRecord;
  sourceResult: DeliveryResult;
  overNumber: number;
  ballNumber: number;
  /** The source ball's analysis: its options (recommended, safest, higher scoring) belong to the delivery. */
  base: CoachAnalysis | null;
  /** The source ball's tip (the card's one sentence before any attempt). */
  baseTip: CoachTipLike | null;
  /** The newest attempt this visit, its tip, and how it compared with the one before. */
  latest: { result: DeliveryResult; analysis: CoachAnalysis; tip: CoachTipLike | null } | null;
  comparison: AttemptComparison | null;
  mastery: MasteryState;
  /**
   * The mastery confirmation of the newest attempt (the restrained sound, haptic and the "less help now" or
   * "mastered" moment): the coach's mastery event, and only when the comparison's verdict is 'better' (WA6, COACH5).
   * The stage and mastery themselves follow the recorded attempts by the coach's rule whatever the verdict
   * (`mastery`), and the stage dots and progress line report them quietly.
   */
  event: 'stage_up' | 'mastered' | null;
  /** Attempts this visit (the tester mode's five-attempt run). */
  attempts: boolean[];
  back: { screen: FlowScreen; phase: LivePhase };
}

export interface ReplayItem {
  result: DeliveryResult;
  overNumber: number;
  ballNumber: number;
}

interface ReplayState {
  items: ReplayItem[];
  index: number;
  playing: boolean;
  speed: number;
  diagnostics: boolean;
  /** A Target Chase's deciding ball: its result clips play in this replay too (the stage's `replay` option). */
  chaseMoment?: ChaseDecided;
  back: { screen: FlowScreen; phase: LivePhase };
}

export interface QualityState {
  stage: '3d' | '2d';
  profile: QualityProfileId;
  tier: PerfTier;
  toleranceMs: number;
}

export interface Board {
  runs: number;
  wickets: number;
  balls: number;
  over: Array<{ runs: number; dismissal: DeliveryRecord['dismissal'] }>;
}

/**
 * A Target Chase being batted, or just decided (null in ordinary Practice). `state` is the SHOWN chase: like the board
 * it changes when the stage has shown the ball, never before (src/practice/ui/chase). The innings stays the one truth;
 * the chase is read from its records (src/practice/chase chaseFromInnings).
 */
export interface ChaseFlow {
  state: ChaseState;
  /** The last finished result of this seed and difficulty on this device from before this attempt, or null. */
  previous: ChaseHistoryEntry | null;
  /** The decided chase's numbers for the win and loss screen; null while it is in progress. */
  summary: ChaseSummary | null;
}

export interface FlowState {
  screen: FlowScreen;
  phase: LivePhase;
  /** The first-ball lesson while it is open (phase 'lesson'), or null (src/practice/ui/lesson). */
  lesson: LessonState | null;
  innings: PracticeInningsState | null;
  /** The Target Chase in play, or null. */
  chase: ChaseFlow | null;
  pending: PendingOver | null;
  /** The kind of the over being batted (or last batted), for "Next over". */
  overKind: OverKind | null;
  /** A Random Over's difficulty, while it is batted (the bowler's honest pace range depends on it); null otherwise. */
  overDifficulty: Difficulty | null;
  /** The scoreboard as shown: it changes when the stage has shown the outcome, never before. */
  board: Board;
  ball: { kind: BallKind; overNumber: number; ballNumber: number; bowler: BowlerProfile } | null;
  /** The GestureSurface: armed at release, one gesture per key. */
  gesture: { enabled: boolean; key: string };
  last: LastBall | null;
  insight: Insight | null;
  coach: CoachSession | null;
  replay: ReplayState | null;
  field: FieldLayout | null;
  intent: FieldIntent | null;
  conditions: PitchCondition;
  handedness: Handedness;
  assessment: DeviceAssessment | null;
  quality: QualityState;
  /** The stage is mounted and ready: Play bowls at once. */
  stageReady: boolean;
  notice: FlowNotice;
  /** Waiting for landscape before the delivery (the "turn your phone" overlay). */
  needLandscape: boolean;
  canvasKey: number;
  coachCanvasKey: number;
  storageOk: boolean;
  /** Announcement for screen readers (polite live region). */
  announce: { text: string; id: number } | null;
  error: string | null;
}

/** The pre-delivery moment that teaches "tap to defend, flick to hit" (the first few balls only), before the run-up. */
export const READY_MS = 1100;
/** The hint is taught for this many deliveries on a device. */
export const HINT_BALLS = 3;
/**
 * The coach starts reading a dead ball this long after it is dead (ms, flow clock): first the consequence is shown
 * (the broken wicket, the catch, the boundary, the field settling; the physics' fielder paths run 1 s past the dead
 * ball, src/physics/resolve.ts standingPaths). The coach's simulations are whole physics strokes (each one main-thread
 * task), so none of them may run while that is on screen. Presentation only: what is analysed never changes.
 */
export const INSIGHT_AFTER_DEAD_MS = 1000;
/**
 * The coach's slice (ms of work per task): it checks the clock after every simulation and yields (so a due frame is
 * drawn) once this much is spent, so a task is at most this plus the one simulation in progress (about 16 ms while a
 * simulation costs under 8 ms; one simulation per task when they cost more, as the bat currently does), and several
 * fast simulations share a task instead of each paying for a yield. "Next ball" aborts the reading at once.
 */
export const INSIGHT_SLICE_MS = 8;
/**
 * With the work thread (./offThread.ts) the coach reads the dead ball from the moment it is dead: its simulations run
 * off the main thread, so the consequence is drawn on the main thread exactly as it would be with no reading at all
 * (measured: release/product-sequence/stage-1-practice/wedge/worker/), and the card's words follow the consequence
 * without any wait added to the loop. The two constants above then apply only to a reading the main thread does itself
 * (no worker, or a worker that failed), which still waits for the consequence and still yields to rendering.
 */
export const INSIGHT_OFFTHREAD_AFTER_DEAD_MS = 0;
/** Test builds only: after a dead ball the flow continues by itself after this long (scaled), so long journeys run. */
export const AUTO_NEXT_MS = 1600;
/** No gesture by this long after the ball reaches the stumps: a leave (s, simulation time). */
export const LEAVE_GRACE_S = 0.12;
/** A test-hook swing is "emitted" this long after its start, like a real flick read over 40 ms (ms, scaled). */
export const HOOK_EMIT_MS = 40;
/** Bounded wait for a backdated intentional onset and its gesture after the leave deadline. */
export const SWING_ARRIVAL_MS = 250;
/**
 * With nothing in flight at the leave deadline (no swing cue since release, no pointer down, no native input), the
 * wait is only as long as a swing that still counts could take to show its first cue: every swing starts no earlier
 * than its first cue's own timestamp less its input's calibration (src/input normalize.ts), and a cue reaches the flow
 * within one batch of events (the tracker's own allowance, LATE_SAMPLE_WAIT_MS). So the leave settles this long plus
 * the largest calibration after the deadline (never longer than SWING_ARRIVAL_MS). Which swings count is unchanged.
 */
export const LEAVE_CUE_DISPATCH_MS = 40;
/** A deadline timer this late means the page was busy: one more turn first, so input already queued is seen. */
export const LEAVE_STALL_MS = 8;
/** The last turn's length (a frame), when the page was busy at the deadline. */
export const LEAVE_STALL_RECHECK_MS = 16;

export const EMPTY_BOARD: Board = { runs: 0, wickets: 0, balls: 0, over: [] };

export const isQuiet = (p: LivePhase): boolean => p === 'runup' || p === 'live' || p === 'playing';
