/**
 * Practice choreography: the scene setup, the delivery's BallFlight and (once known) its DeliveryResult become one
 * BallScript, the same model the match renderer draws (so the stadium, players, ball, stumps and effects are the
 * one renderer's). Everything the physics decided is taken as given: the ball follows the physics samples, the bat
 * the physics bat, fielders their FielderPaths; the choreography only adds what the physics does not model (the
 * bowler's run-up and action, the umpires, the batters' running, the keeper's take). Pure and deterministic.
 */
import type { BowlerAction, DeliveryFamily } from '@/contracts';
import type {
  BallFlight,
  BallSample,
  BowlerProfile,
  DeliveryResult,
  DeliveryVariation,
  Fielder,
  FielderPath,
  Vec3 as PVec3,
} from '@/contracts/practice';
import type { OneGestureState } from '@/input';
import {
  clipStateAt,
  evaluateActor,
  lookScale,
  truncateMoves,
  type ActorTrack,
  type Look,
  type Move,
  type PhysicsBodyPlan,
} from '../core/actors';
import { WALK_CLIP_MPS, bowlerRun, type BallScript, type BallSeg } from '../core/choreo';
import {
  type ClipId,
  type MotionClipId,
  type SampledPose,
  clipDuration,
  clipMarker,
  createPose,
  hasMotionClip,
  mirrorSampledPose,
  motionSource,
  samplePresented,
} from '../core/clips';
import { type Joints, createJoints, forwardKinematics, jointWorld } from '../core/locomotion';
import { humansPoseHook, type WarmablePoseHook } from '../core/motion/humansHook';
import { PITCH_HALF, POPPING, RELEASE, SQUARE_UMPIRE_POS, UMPIRE_POS } from '../core/ground';
import { type Vec3, angleDelta, clamp, hash32, headingOf, v3 } from '../core/math';
import { seamSpin } from '../core/trajectory';
import { batterBody, batTravelMs, idealTimeFor } from '@/physics/bat';
import { shotFamily, type ShotFamily } from '@/physics/shot';
import { ballRotation, releaseFor } from '@/physics/delivery';
import { BALL_R } from '@/physics/geometry';
import { BACKLIFT, type BatTrack, PROVISIONAL_TRAVEL_MS, reachable } from './bat';

const BACKLIFT_TOP_MS = BACKLIFT.toMs;
import { feedbackCues, presentedBounce, sceneEventsOf, type FeedbackCue } from './feedback';
import { ballAt, ballVelocityAt, simToScene, toWorld } from './frame';
import { buildEmotion, crowdKeys, type EmotionPlan } from './emotion';
import { chasedBall, fieldingMoves, type FieldingContext } from './fielding';
import { nonStrikerMoves, nonStrikerStand, runTimes, runningMoves, setOffT } from './nonStriker';
import { fieldClips, matchedRate } from '../core/fieldClips';
import { avatarTraits } from '@/ui/avatar/traits';
import { releaseSurfaceTangent } from './ballLook';
import type { DeliveryContext, PracticeSceneSetup } from './types';

const rotateAround = (v: Vec3, rawAxis: Vec3, angle: number): Vec3 => {
  const n = Math.hypot(rawAxis.x, rawAxis.y, rawAxis.z) || 1;
  const a = v3(rawAxis.x / n, rawAxis.y / n, rawAxis.z / n);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const d = (a.x * v.x + a.y * v.y + a.z * v.z) * (1 - c);
  return v3(
    v.x * c + (a.y * v.z - a.z * v.y) * s + a.x * d,
    v.y * c + (a.z * v.x - a.x * v.z) * s + a.y * d,
    v.z * c + (a.x * v.y - a.y * v.x) * s + a.z * d,
  );
};

// ---------------------------------------------------------------------------------------------------------------
// The data the practice cameras, the bat and the overlays read
// ---------------------------------------------------------------------------------------------------------------

/**
 * What the face-and-life Director needs to know about one actor's script (scene ms; `null` = does not exist or is not
 * known yet). Plain data: the plan is baked off the frame path from it (core/motion/director, directorRuntime).
 */
export interface DirectorActorSpec {
  start: number;
  end: number;
  /** The bowler's run-up starts, and his delivery stride (before the back foot lands). */
  runStart: number | null;
  gather: number | null;
  /** The ball leaves the hand; `null` between balls. */
  release: number | null;
  /** The bowler's follow-through ends. */
  followEnd: number | null;
  /** The striker's own swing input. */
  swing: number | null;
  contact: number | null;
  /** The striker's visual task ends: contact, else the unhit ball passing (a live script has only the second). */
  taskEnd: number | null;
  /** The physics has confirmed the outcome. */
  outcomeAt: number | null;
  /** How the crowd reads it ('six', 'four', 'runs', 'dot', 'leave', 'close_call', 'wicket'): the Director's reaction, from `outcomeAt` + 180 ms. */
  outcome: string | null;
  dead: number | null;
  /** The striker's stroke or leave ends. */
  strokeEnd: number | null;
  /** Runs the batters ran. */
  runs: number;
}

/** The Director's anchors for both actors of a script. They never depend on the result before it is known (the live script has none). */
export interface DirectorSpec {
  /** The ball's seed (`flight.seed`): the key of the delivery, the same live and in every replay; null between balls. */
  seed: string | null;
  /** The striker's eye in the stance, whatever the result's planted offset: what the bowler looks at and the striker looks from. */
  strikerEye: Vec3;
  /** When the flight the script draws before the result ends (the ball holds still there until the result's takes over), scene ms. */
  flightEnd: number | null;
  bowler: DirectorActorSpec;
  striker: DirectorActorSpec;
}

export interface PracticeInfo {
  /** A left-hander: physics positions are mirrored back for drawing. */
  mirror: boolean;
  /**
   * The batter's eye (world): in the physics stance head, 1.65–1.75 m above the crease. A live result keeps the eye of
   * the script it replaces (`handover`): the camera stays where it was for the rest of the delivery, whatever the
   * footwork. A replay, built from the result alone, uses the result's planted stance.
   */
  eye: Vec3;
  /**
   * Live only: the script shown until this one took over at `atScene` (scene ms). The first-person gaze continues
   * from that script's gaze instead of starting again (core/camera.ts), so the view does not jump at the hand-over.
   */
  gazeFrom?: { script: BallScript; atScene: number } | null;
  /** The eye in the result's planted stance (equal to `eye` unless a live result kept the eye on screen). */
  stanceEye?: Vec3;
  /** Scene ms of the release (simulation t = 0). */
  releaseScene: number;
  /** Where the ball leaves the hand (world): the first-person gaze is set on it. */
  releaseWorld: Vec3;
  /**
   * How far (m, world) the physics release point is above the bowling hand of this bowler's rig (at his bowlerScale)
   * at the release marker, negative below. The stage takes the last centimetres up in the 200 ms before the release by
   * the trunk's side flexion and the shoulder's turn, never the elbow (stageScene.ts reachRelease); ThreePracticeStage
   * cueHook uses it only for a bouncer's lean on the stock clip. The body is never lifted.
   */
  releaseLift?: number;
  /** The bowler bowls MOTION-BOWL's bouncer delivery (its wrist and back cue are in the clip: no cue is added). */
  bouncerClip?: boolean;
  flight: BallFlight | null;
  result: DeliveryResult | null;
  bat: BatTrack;
  /** Scene ms of the bat, edge, pad or body contact, else null. */
  contactScene: number | null;
  /** First person until this scene time (Infinity: stay first-person), then the external camera. */
  firstPersonUntil: number;
  external: 'fielding' | 'stumps' | 'none';
  /** Learn assistance: where the ball pitches (world), from the release on. */
  landing: Vec3 | null;
  variation: DeliveryVariation | null;
  action: BowlerAction;
  /** The bowler bowls left-arm (its clips play mirrored). */
  bowlerLeftArm: boolean;
  cues: FeedbackCue[];
  deadScene: number | null;
  /** Actors the first-person camera does not draw (the batter's own body). */
  firstPersonHidden: string[];
  emotion: EmotionPlan;
  /** The face-and-life Director's anchors (the plan is baked from them outside the frame that builds this script). */
  director: DirectorSpec;
  /**
   * A result with a swing: the striker's stride decision, while it has not been made (strideGoverned: more than half of
   * the work of building the result's script). The striker's moves and physics body are made when first read, or in the
   * spare time of the frames before that (the stage calls `advance`). Not enumerable: the script is the same data with
   * or without it. Absent when the decision was made in the build.
   */
  stride?: StrideDecision;
}

/** A stride decision still to be made; see PracticeInfo.stride. */
export interface StrideDecision {
  /** The decision is made, and the striker's moves and physics body are final. */
  readonly done: boolean;
  /**
   * Works on the decision for about `ms` of wall time (at least one pose) and returns whether it is made. `hook`: the
   * script's planted-feet hook (humansPoseHookFor): the plans the decision makes are then the ones the frames use. A
   * decision that is read before it is made is made by the read, whole, with a hook of its own.
   */
  advance(ms: number, hook?: WarmablePoseHook): boolean;
}

// ---------------------------------------------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------------------------------------------

/** Run-up: a moment at the top of the mark, then at most this much visible run-up (ms), so every ball comes quickly. */
const PRACTICE_RUN = { preMs: 300, maxRunMs: { pace: 1500, spin: 900 } } as const;
/** First person holds this long after the bat meets the ball (the gentle head-follow), then the fielding camera. */
const HEAD_FOLLOW_MS = 450;
/** After the stumps are hit, first person holds this long before the camera shows the broken wicket. */
const BOWLED_HOLD_MS = 160;
/** Scene kept after dead ball (the camera holds while the coaching shows). */
const AFTER_DEAD_MS = 6000;
/** The physics batter in the stance (src/physics/bat.ts batterBody): the same body the pad and LBW collisions use. */
const STANCE_BODY = batterBody(null);
/** The physics pad capsule's radius and the ball's (src/physics/constants.ts BODY.padR, geometry.ts BALL_R). */
const PAD_CAPSULE_R = STANCE_BODY.pads[0].r;
const BALL_RADIUS = BALL_R;
/** The batter's stance root (physics frame): the centre between the feet. */
export const STANCE_ROOT: Vec3 = v3(STANCE_BODY.stance.x, 0, STANCE_BODY.stance.z);
/** The eye sits this far above the physics head's centre, and always inside the brief's 1.65–1.75 m. */
const EYE_ABOVE_HEAD_CENTRE = 0.06;
const EYE_HEIGHT_RANGE = [1.65, 1.75] as const;

/** The batter's eye (world) for a handedness: in the physics stance head. */
export function batterEye(
  mirror: boolean,
  root: Readonly<{ x: number; z: number }> = { x: 0, z: 0 },
  crouchM = 0,
): Vec3 {
  const h = STANCE_BODY.head.c;
  return toWorld(
    v3(
      h.x + root.x,
      clamp(h.y - crouchM + EYE_ABOVE_HEAD_CENTRE, EYE_HEIGHT_RANGE[0] - 0.18, EYE_HEIGHT_RANGE[1]),
      h.z + root.z,
    ),
    mirror,
  );
}
const CREASE_Z = PITCH_HALF - POPPING;

/**
 * Bowling hand at the release marker, relative to the bowler's root at heading 0 (right arm, rig scale 1). The 3D
 * stage measures the real rig and passes its own; these defaults keep the 2D stage and tests close.
 */
export const NOMINAL_RELEASE_HAND: Record<BowlerAction, Vec3> = {
  pace_long: v3(-0.27, 2.12, 0.34),
  pace_short: v3(-0.27, 2.1, 0.32),
  swing_side_on: v3(-0.25, 2.1, 0.33),
  spin_off: v3(-0.24, 2.0, 0.3),
  spin_leg: v3(-0.24, 2.02, 0.3),
};

// ---------------------------------------------------------------------------------------------------------------
// Bowler
// ---------------------------------------------------------------------------------------------------------------

/** One action per bowler for the whole over: the family and pace show, the variation does not. */
export function practiceAction(b: BowlerProfile): BowlerAction {
  if (b.family === 'spin') return b.spinType === 'wrist' ? 'spin_leg' : 'spin_off';
  if (b.paceBand === 'express') return 'pace_long';
  if (b.paceBand === 'controlled') return 'swing_side_on';
  return hash32(b.lookSeed) % 2 ? 'pace_long' : 'pace_short';
}

export const familyOf = (b: BowlerProfile): DeliveryFamily => (b.family === 'spin' ? 'spin' : 'pace');

function runOptions(b: BowlerProfile) {
  return {
    preMs: PRACTICE_RUN.preMs,
    maxRunMs: b.family === 'spin' ? PRACTICE_RUN.maxRunMs.spin : PRACTICE_RUN.maxRunMs.pace,
  };
}

/** Scene ms from the start of the run-up to the release, for a bowler (the same for every ball of the over). */
export function practiceReleaseScene(b: BowlerProfile): number {
  return bowlerRun({ action: practiceAction(b), look: { seed: b.lookSeed, team: 1, gear: 'bowler' }, ...runOptions(b) })
    .release;
}

/**
 * The release point before a flight is known (world). Over the wicket the bowling arm is next to the stumps, so in
 * the real world it depends only on the real arm (the physics frame mirrors it for a left-hander, and drawing
 * mirrors it back).
 */
/**
 * The bowler's rig scale (lead ruling 05:1xZ; MOTION-BOWL's higher pace release arm has landed, so pace is back in
 * [0.95, 1.12] like spin, the interim 1.18 retired): his own physics
 * release height (the stock ball: src/physics/delivery.ts releaseFor, by his look) over his rig's release hand at
 * scale 1 (`measured`: ThreePracticeStage.releaseHand, at his look's own height), within BOWLER_SCALE for his family,
 * so every ball of his over is drawn by the same body. The rest (a bouncer's higher release, a clamped scale) is the
 * stage's release reach (PracticeInfo.releaseLift). Without a measurement: his look's own height, the nominal hand.
 */
export const BOWLER_SCALE = { pace: [0.95, 1.12], spin: [0.95, 1.12] } as const;

/**
 * The ball in the bowler's hand at the release marker, measured on his own rig at his look's height (the stage's
 * releaseHand), with, when MOTION-BOWL's bouncer delivery is loaded, the same for it (`bouncer`).
 */
export type ReleaseHands = Vec3 & { bouncer?: Vec3 };

export function bowlerScale(b: BowlerProfile, measured: Vec3 | null, look: Look): { scale: number; hand: Vec3 | null } {
  const own = avatarTraits(look.seed).height;
  if (!measured || measured.y <= 0) return { scale: own, hand: null };
  const stock = releaseFor(
    { variation: 'stock', lengthM: 6, lineM: 0, speedKph: b.family === 'spin' ? 85 : 130 },
    b,
    'balanced',
    'bowler-scale',
  ).p.y;
  const [lo, hi] = BOWLER_SCALE[b.family === 'spin' ? 'spin' : 'pace'];
  const unit = measured.y / own;
  const scale = clamp(stock / unit, lo, hi);
  const k = scale / own;
  return { scale, hand: v3(measured.x * k, measured.y * k, measured.z * k) };
}

function nominalRelease(b: BowlerProfile): Vec3 {
  return v3(b.arm === 'left' ? -RELEASE.x : RELEASE.x, RELEASE.y, RELEASE.z);
}

const smooth01 = (u: number) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));

/** The bowler walks back to his mark after the ball: at a stroll, after a pause, turning gently. */
const WALK_BACK = { pauseMs: 900, mps: 1.0, turnMs: 900 } as const;

/**
 * How the bowler's follow-through hands over to what he does next (his chase of the ball, his celebration, his stroll to the spot): the
 * pose cross-fades over `blendMs` (the first move of a path is `ready` with no blend, and the follow-through is cut off
 * with the bowling arm still swinging: the forearms turned 57 to 65 degrees, an upper arm 41 and the chest 5 in the one frame of the
 * switch), and the heading carries on from the follow-through's over a time that grows with the turn (the first move says 0, and the
 * follow-through ends 7 to 26 degrees off it: a snap of the whole body in one frame) instead of snapping to the new move's. The blend is
 * short on purpose: from 60 ms no arm, trunk or head bone turns more than 25 degrees a frame, and the longer the legs of the follow-through
 * stay in the pose the planted-feet plan is given, the harder its first step of the chase lands (the forward defence of the motion reel:
 * no leg step over 25 degrees a frame with 120 ms, a left thigh of 31 with 220 ms and of 41 with 280 ms).
 */
export const FOLLOW_HANDOVER = { blendMs: 120, fadeMsPerDeg: 16.7, minFadeMs: 300, maxFadeMs: 900 } as const;

function handOverFollowThrough(track: ActorTrack, first: number, headingBefore: number): void {
  const m = track.moves[first];
  if (!m) return;
  if ((m.blend ?? 140) < FOLLOW_HANDOVER.blendMs) track.moves[first] = { ...m, blend: FOLLOW_HANDOVER.blendMs };
  const delta = angleDelta(evaluateActor(track, m.t0).heading, headingBefore);
  if (Math.abs(delta) < 1e-4) return;
  const deg = Math.abs(delta) * (180 / Math.PI);
  track.headingFade = {
    t0: m.t0,
    ms: clamp(deg * FOLLOW_HANDOVER.fadeMsPerDeg, FOLLOW_HANDOVER.minFadeMs, FOLLOW_HANDOVER.maxFadeMs),
    delta,
  };
}

/**
 * Appends the walk back to the top of the mark once the bowler's last move has ended (a follow-through, his fielding
 * or a celebration), when the scene still has time for it. Presentation only; the speed rises from and falls to rest.
 */
export function addWalkBack(track: ActorTrack, mark: Vec3, duration: number) {
  const last = track.moves[track.moves.length - 1];
  if (!last) return;
  const t0 = last.t1 + WALK_BACK.pauseMs;
  if (t0 > duration - 1500) return;
  const was = evaluateActor(track, last.t1);
  const from = was.pos;
  const d = Math.hypot(mark.x - from.x, mark.z - from.z);
  if (d < 1) return;
  // He turns to face the way he walks at 180 degrees a second at the fastest (a half turn took 900 ms with the cubic ease: 10 degrees a frame).
  const turnMs = clamp(
    (Math.abs(angleDelta(was.heading, headingOf(mark.x - from.x, mark.z - from.z))) * 180 * 8.4) / Math.PI,
    WALK_BACK.turnMs,
    1700,
  );
  const t1 = t0 + (d / (WALK_BACK.mps * 0.66)) * 1000;
  track.moves.push(
    { t0: last.t1, t1: t0, clip: 'idle', from, to: from, blend: 300 },
    // MOTION-BOWL's walk back when loaded (speed-matched, MOTION-SPEC §6), else the walk cycle.
    hasMotionClip('bowl_walk_back')
      ? {
          t0,
          t1,
          clip: 'vmp:bowl_walk_back',
          from,
          to: v3(mark.x, 0, mark.z),
          speed: [0, 0],
          rateBySpeed: motionSource('vmp:bowl_walk_back')!.speedMps,
          rateExp: 1,
          rateClamp: [0.75, 1.3],
          rate: 1,
          turnMs,
          turnEase: 'smooth',
          blend: 280,
        }
      : {
          t0,
          t1,
          clip: 'walk',
          from,
          to: v3(mark.x, 0, mark.z),
          speed: [0, 0],
          rateBySpeed: WALK_CLIP_MPS,
          rate: 1,
          turnMs,
          turnEase: 'smooth',
          blend: 280,
        },
    { t0: t1, t1: Math.max(t1 + 1, duration), clip: 'idle', headingTo: 0, blend: 320 },
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Looks
// ---------------------------------------------------------------------------------------------------------------

export interface PracticeCast {
  bowler: Look;
  striker: Look;
  nonStriker: Look;
  keeper: Look;
  fielder(id: string): Look;
  umpires: [Look, Look];
}

export function practiceCast(b: BowlerProfile): PracticeCast {
  return {
    bowler: { seed: b.lookSeed, team: 1, gear: 'bowler', hero: true },
    striker: { seed: 'practice:batter', team: 0, gear: 'batter', hero: true },
    nonStriker: { seed: 'practice:partner', team: 0, gear: 'batter' },
    keeper: { seed: `${b.lookSeed}:keeper`, team: 1, gear: 'keeper' },
    fielder: (id) => ({ seed: `${b.lookSeed}:${id}`, team: 1, gear: 'fielder' }),
    umpires: [
      { seed: `umpire:${b.lookSeed}:0`, team: 0, gear: 'umpire' },
      { seed: `umpire:${b.lookSeed}:1`, team: 0, gear: 'umpire' },
    ],
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Fielder paths → actor moves
// ---------------------------------------------------------------------------------------------------------------

/**
 * Moves that draw a FielderPath (positions in world, the path's own times). The root is the path at every instant;
 * the body is choreographed on it by `fieldingMoves` (practice/fielding.ts): anticipation aligned to the physics
 * events, running legs under a pickup on the move, rate-limited headings, a dive that reaches the ball.
 */
export function pathMoves(
  path: FielderPath,
  mirror: boolean,
  releaseScene: number,
  opts: FieldingContext & { faceTowards?: (t: number) => Vec3 | null } = {},
): Move[] {
  const { faceTowards, ...ctx } = opts;
  return fieldingMoves(path, mirror, releaseScene, { ...(faceTowards ? { ball: faceTowards } : {}), ...ctx });
}

/** Close catchers crouch as the bowler runs in; everyone else in the field walks in with him and settles. */
const CLOSE_ROLES: ReadonlySet<Fielder['role']> = new Set<Fielder['role']>([
  'slip',
  'gully',
  'leg_slip',
  'short_leg',
  'silly_point',
]);
/** The walk in: about 1.3 m/s, settled into the ready crouch this long before the release (ms). */
export const WALK_IN = {
  mps: 1.3,
  settleMs: 450,
  earliestMs: 350,
  maxMs: 1400,
  deepM: 2.0,
  ringM: 1.5,
  deepFromM: 38,
} as const;

/**
 * Where a fielder starts the walk in (world) and when (scene ms): back along his line from the striker, so he walks in
 * to his physics position and is set there before the release. Null for the keeper, close catchers and a run-up too
 * short to walk in.
 */
export function walkIn(
  f: Fielder,
  pos: Vec3,
  striker: Vec3,
  releaseScene: number,
  id: string,
): { start: Vec3; t0: number; t1: number } | null {
  if (f.role === 'keeper' || f.role === 'bowler' || CLOSE_ROLES.has(f.role)) return null;
  const dx = striker.x - pos.x;
  const dz = striker.z - pos.z;
  const d = Math.hypot(dx, dz) || 1;
  const t1 = releaseScene - WALK_IN.settleMs;
  const t0 = Math.max(WALK_IN.earliestMs + (hash32(`walk:${id}`) % 200), t1 - WALK_IN.maxMs);
  const metres = Math.min(d > WALK_IN.deepFromM ? WALK_IN.deepM : WALK_IN.ringM, (WALK_IN.mps * (t1 - t0)) / 1000);
  if (metres < 0.5 || t1 - t0 < 400) return null;
  return { start: v3(pos.x - (dx / d) * metres, 0, pos.z - (dz / d) * metres), t0, t1 };
}

/**
 * Post-ball reactions on the spot (presentation only), each after the physical event that earns it: a wicket (the
 * stumps broken, the catch taken, or the LBW decision's own celebration time), a ball beaten past the edge (after the
 * keeper's take), a chase that lost the race to the rope (after the boundary), and the receiver's take of a throw
 * (aligned to the instant the physics ball reaches him). Who caught it, the keeper and the bowler already celebrate
 * in the physics paths.
 */
export function fieldReactions(
  result: DeliveryResult,
  fielders: readonly Fielder[],
  paths: ReadonlyMap<string, FielderPath>,
): Map<string, { t: number; clip: ClipId }> {
  const out = new Map<string, { t: number; clip: ClipId }>();
  const jitter = (id: string, k: number) => ((hash32(`react:${id}`) % 1000) / 1000) * k;
  const at = (kind: DeliveryResult['events'][number]['kind']) => result.events.find((e) => e.kind === kind)?.t;
  const d = result.outcome.dismissal;
  if (d) {
    const tD =
      d === 'bowled'
        ? (at('stumps') ?? result.deadT)
        : d === 'lbw'
          ? result.deadT + 0.4
          : (at('catch') ?? at('keeper_take') ?? result.deadT);
    for (const f of fielders) {
      if (f.role === 'keeper' || f.role === 'bowler' || f.id === result.outcome.fielderId) continue;
      out.set(
        f.id,
        CLOSE_ROLES.has(f.role)
          ? { t: tD + 0.2 + jitter(f.id, 0.25), clip: 'celebrate_jump' }
          : { t: tD + 0.45 + jitter(f.id, 0.5), clip: 'clap' },
      );
    }
    return out;
  }
  const boundary = at('boundary');
  if (boundary !== undefined) {
    // Only the fielders who chased it down (fielding.ts chasedBall), not everyone who moved.
    const end = result.events.find(
      (e): e is Extract<DeliveryResult['events'][number], { kind: 'boundary' }> => e.kind === 'boundary',
    )!.p;
    for (const f of fielders) {
      const path = paths.get(f.id);
      if (path && chasedBall(path, f, end, boundary))
        out.set(f.id, { t: boundary + 0.35 + jitter(f.id, 0.3), clip: 'hands_on_hips' });
    }
    return out;
  }
  const take = at('keeper_take');
  if (take !== undefined && result.swing && result.contact.kind === 'miss') {
    for (const f of fielders)
      if (f.role === 'slip' || f.role === 'gully')
        out.set(f.id, { t: take + 0.15 + jitter(f.id, 0.15), clip: 'hands_on_head' });
    return out;
  }
  if (at('throw') !== undefined) {
    const end = result.ball[result.ball.length - 1]?.p;
    for (const f of fielders) {
      if (!end || (f.role !== 'keeper' && f.role !== 'bowler')) continue;
      const last = paths.get(f.id)?.samples.at(-1);
      if (!last || Math.hypot(last.x - end.x, last.z - end.z) > 2.5) continue;
      const clip: ClipId = f.role === 'keeper' ? 'keep_take' : 'catch_chest';
      out.set(f.id, { t: result.deadT - clipMarker(clip, 'catch', 0.3), clip });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// The batter's stroke (presentation: the physics bat is drawn regardless)
// ---------------------------------------------------------------------------------------------------------------

const FOOT_CLIP = {
  forward: 'foot_forward',
  back: 'foot_back',
  across: 'foot_across',
  down_track: 'foot_charge',
} as const;

/**
 * A legitimate stroke animation for the swing and the delivery: the upper body from the swing and the line and
 * length, the stride from the footwork the physics actually played (never the swing's 'auto'). It never changes
 * where the ball goes: the drawn bat is the physics bat.
 */
function strokeFor(result: DeliveryResult): { clip: ClipId; lower: ClipId } {
  const swing = result.swing;
  const stride: ClipId = FOOT_CLIP[result.footwork] ?? 'foot_still';
  if (!swing) return { clip: 'bat_leave', lower: 'foot_still' };
  // The body follows the stroke the physics played: its shot family (the swing's kind and direction on the footwork
  // the physics chose), so a cover drive is a drive, an edged pull is a pull and a defensive push is a block.
  const family = shotFamily(swing.kind, swing.directionDeg, result.footwork);
  const lofted = swing.kind === 'attack' && swing.elevation >= 0.45;
  switch (family) {
    case 'forward_defence':
    case 'back_defence':
      return { clip: 'bat_block', lower: stride };
    case 'straight_drive':
    case 'off_drive':
    case 'on_drive':
    case 'cover_drive':
    case 'square_drive':
      return { clip: lofted ? 'bat_loft' : 'bat_drive', lower: stride };
    case 'steer':
    case 'cut':
      return { clip: 'bat_cut', lower: stride };
    case 'pull':
    case 'hook':
      return { clip: lofted ? 'bat_loft' : 'bat_pull', lower: stride };
    case 'glance':
      return result.footwork === 'forward' && swing.directionDeg < -110
        ? { clip: 'bat_sweep', lower: 'foot_sweep' }
        : { clip: 'bat_push', lower: stride };
    default:
      // The flick, the back-foot drive and punches: a firm push through the line.
      return { clip: lofted ? 'bat_loft' : 'bat_push', lower: stride };
  }
}

/**
 * TRACKB's authored stroke overlays (pack batter_strokes, assets-src/motion/batter_strokes/SOURCE.md): one table for the
 * web and Unity (agreed with UNITY-2), from the physics shot family of the swing at the input (its kind and direction on
 * the footwork the physics played; never the outcome). Null: no clip fits, and the procedural stride is drawn (a sweep's
 * kneel, a charge down the pitch).
 */
export const STROKE_OVERLAYS: Readonly<
  Record<ShotFamily, 'bat_drive' | 'bat_fwd_defence' | 'bat_backfoot_punch' | 'bat_pull' | 'bat_back_defence'>
> = {
  forward_defence: 'bat_fwd_defence',
  back_defence: 'bat_back_defence',
  straight_drive: 'bat_drive',
  off_drive: 'bat_drive',
  cover_drive: 'bat_drive',
  square_drive: 'bat_drive',
  on_drive: 'bat_drive',
  // No clip of their own: a front-foot stroke that holds its shape over the front knee.
  steer: 'bat_fwd_defence',
  flick: 'bat_fwd_defence',
  glance: 'bat_fwd_defence',
  back_drive: 'bat_backfoot_punch',
  back_punch: 'bat_backfoot_punch',
  back_on_punch: 'bat_backfoot_punch',
  // No clip of its own: the back-and-across step, the chest turning a little to off.
  cut: 'bat_backfoot_punch',
  pull: 'bat_pull',
  // No clip of its own: the pull's step and turn.
  hook: 'bat_pull',
};
/** The hand-over from a stroke overlay into the rest (ms): its hips change stays within §9 (0.30 m/s per frame). */
const STROKE_REST_INERTIAL_MS = 800;
/** The shortest input → plant windows that keep the §9 gates with the smooth warp (SOURCE.md), by footwork (ms). */
const STROKE_MIN_WINDOW_MS = { front: 233.3, back: 166.7 } as const;

/**
 * The overlay a swing plays (strokeOverlay), unless the physics pads govern a window shorter than its shortest one:
 * then the procedural stride plants in it instead (as at 5f), so a pad or body hit is never drawn mid-stride for the
 * sake of a clip (the pad gap stays at its 5f numbers; the §9 caps of that procedural stride are reported).
 */
function strokeOverlayIn(
  result: DeliveryResult,
  releaseScene: number,
  governed: boolean,
): { id: MotionClipId; plantMs: number; minMs: number } | null {
  const ov = strokeOverlay(result);
  if (!ov || !governed || !result.swing) return ov;
  const strideAt = simToScene({ releaseScene }, result.swing.startT);
  const arrival = simToScene({ releaseScene }, idealTimeFor(result.flight, result.footwork));
  const contact =
    result.contact.t !== null && result.contact.kind !== 'miss' && result.contact.kind !== 'leave'
      ? simToScene({ releaseScene }, result.contact.t)
      : arrival;
  return Math.min(arrival, contact) - strideAt < ov.minMs ? null : ov;
}

/** The overlay a swing plays, its plant (ms from the input at 1x) and shortest window; null for none (or not loaded). */
export function strokeOverlay(result: DeliveryResult): { id: MotionClipId; plantMs: number; minMs: number } | null {
  const swing = result.swing;
  if (!swing) return null;
  if (result.footwork === 'down_track') return null;
  if (
    result.footwork === 'forward' &&
    swing.kind === 'attack' &&
    swing.directionDeg < -110 &&
    shotFamily(swing.kind, swing.directionDeg, result.footwork) === 'glance'
  )
    return null;
  const name = STROKE_OVERLAYS[shotFamily(swing.kind, swing.directionDeg, result.footwork)];
  if (!hasMotionClip(name)) return null;
  const id = `vmp:${name}` as const;
  const front = result.footwork === 'forward';
  return {
    id,
    plantMs: clipMarker(id, 'plant', front ? 0.32 : 0.28) * 1000,
    minMs: front ? STROKE_MIN_WINDOW_MS.front : STROKE_MIN_WINDOW_MS.back,
  };
}

/**
 * The striker before his stroke (presentation): TRACKB's live stance (breathing, small weight shifts, bat taps, the
 * head still and level on the bowler) while he waits, the trigger as the bowler gathers (identical every ball,
 * anchored to the presented release, feet planted before it, never towards the line), the backlift from the release
 * (top 0.25 s later), then the ready hold; with the batter pack not loaded, the built-in stance. Between balls, the
 * live stance (or the built-in one) throughout.
 */
export function strikerPreSwing(releaseScene: number, duration: number, delivery: boolean): Move[] {
  const live = hasMotionClip('bat_stance_live') ? 'vmp:bat_stance_live' : null;
  if (!live) return [{ t0: 0, t1: duration, clip: 'stance' }];
  if (
    !delivery ||
    !hasMotionClip('bat_trigger') ||
    !hasMotionClip('bat_backlift') ||
    !hasMotionClip('bat_ready_hold')
  ) {
    return [{ t0: 0, t1: duration, clip: live }];
  }
  const trig = 'vmp:bat_trigger' as const;
  // The compact backlift (BACKLIFT_TOP) when TRACKB's compact variant is in the pack, else the standard one.
  const compact = hasMotionClip('bat_backlift_compact') && hasMotionClip('bat_ready_hold_compact');
  const lift = compact ? ('vmp:bat_backlift_compact' as const) : ('vmp:bat_backlift' as const);
  const hold = compact ? ('vmp:bat_ready_hold_compact' as const) : ('vmp:bat_ready_hold' as const);
  const trigAt = releaseScene - clipMarker(trig, 'release', clipDuration(trig)) * 1000;
  const liftAt = releaseScene - clipMarker(lift, 'release', 0) * 1000;
  const holdAt = liftAt + clipDuration(lift) * 1000;
  return [
    { t0: 0, t1: Math.max(1, trigAt), clip: live },
    { t0: Math.max(1, trigAt), t1: liftAt, clip: trig, blend: 160 },
    { t0: liftAt, t1: holdAt, clip: lift, blend: 60 },
    { t0: holdAt, t1: Math.max(holdAt + 1, duration), clip: hold, blend: 120 },
  ];
}

/** The hold's blends: off the physics path into the hand after the take, back onto it before the release (ms). */
const HOLD_BLEND = { inMs: 80, outMs: 90 } as const;

/**
 * Splits the ball's physics path segments around each hold: from a fielder's take (`field`, `catch`) or the keeper's
 * (`keeper_take`) to that player's next `throw` (or, without one, until the ball moves off again or the scene ends), the
 * ball is drawn in that player's hand, leaving the path at exactly the physics take position and rejoining it at
 * exactly the physics release point. The physics flight before and after is unchanged.
 */
export function holdBallInHands(
  balls: BallSeg[],
  result: DeliveryResult,
  releaseScene: number,
  duration: number,
  mirror: boolean,
  actorOf: (fielderId: string) => string,
) {
  const path = balls.find((b): b is Extract<BallSeg, { k: 'path' }> => b.k === 'path');
  if (!path) return;
  const holds: Array<{ actor: string; t0: number; t1: number; out: boolean }> = [];
  const evs = result.events;
  for (let i = 0; i < evs.length; i++) {
    const e = evs[i];
    let who: string | null = null;
    if (e.kind === 'field' || e.kind === 'catch') who = e.fielderId;
    else if (e.kind === 'keeper_take') {
      // The keeper's take of a return throw, and a clean take of the delivery (physics 5f: `shortM` absent or 0). A
      // delivery that went past his reach (`shortM` > 0, dead only because there are no byes) is never held.
      const ofThrow = evs.slice(0, i).some((x) => x.kind === 'throw');
      if (!ofThrow && (e.shortM ?? 0) > 0) continue;
      who = result.fielders.map((f) => f.fielderId).find((fid) => actorOf(fid) === 'keeper') ?? '__keeper__';
    }
    if (!who) continue;
    const thr = evs
      .slice(i + 1)
      .find((x): x is Extract<typeof x, { kind: 'throw' }> => x.kind === 'throw' && x.fielderId === who);
    let end = thr?.t ?? null;
    if (end === null) {
      // No throw: held until the ball moves off again (a celebration toss), else to the end.
      const at = ballAt(result.ball, e.t);
      const off = at
        ? result.ball.find((b) => b.t > e.t + 0.05 && Math.hypot(b.p.x - at.x, b.p.y - at.y, b.p.z - at.z) > 0.3)
        : undefined;
      end = off ? off.t - 0.02 : null;
    }
    const t0 = simToScene({ releaseScene }, e.t);
    const t1 = end === null ? duration : simToScene({ releaseScene }, end);
    if (t1 - t0 < 60) continue;
    holds.push({ actor: who === '__keeper__' ? 'keeper' : actorOf(who), t0, t1, out: end !== null });
  }
  if (!holds.length) return;
  holds.sort((a, b) => a.t0 - b.t0);
  const out: BallSeg[] = [];
  for (const seg of balls) {
    if (seg.k !== 'path') {
      out.push(seg);
      continue;
    }
    let cur = seg.t0;
    for (const h of holds) {
      if (h.t1 <= cur || h.t0 >= seg.t1) continue;
      if (h.t0 > cur) out.push({ ...seg, t0: cur, t1: h.t0 });
      const t1 = Math.min(h.t1, seg.t1);
      out.push({
        k: 'hand',
        t0: Math.max(cur, h.t0),
        t1,
        actor: h.actor,
        ...(h.out ? { throwHand: true } : {}),
        path: {
          samples: seg.samples,
          release: seg.release,
          mirror,
          inMs: HOLD_BLEND.inMs,
          outMs: h.out && t1 === h.t1 ? HOLD_BLEND.outMs : 0,
        },
      });
      cur = t1;
    }
    if (cur < seg.t1) out.push({ ...seg, t0: cur, t1: seg.t1 });
  }
  balls.splice(0, balls.length, ...out);
}

/** The stride lands this long into every footwork clip (clips.ts foot_*: the front or back foot planted at 0.32 s). */
export const STRIDE_PLANT_MS = 320;
/** Kept for the probes and the docs' history: the floor of the old pre-input stride lead (ruling 05:0xZ: no lead). */
export const STRIDE_EARLIEST_MS = 150;
/**
 * The quickest the footwork clip is played to plant the stride inside a short input-to-contact window (×, ms): faster
 * than this would be a jump, so a later plant is reported (strideWindow) instead of leading the input.
 */
const STRIDE_MAX_RATE = 3;

/**
 * The scene ms the footwork's stride starts: the swing's own start (lead ruling, superseding the footwork-lead
 * exception: before the input only the generic trigger and backlift, the feet on the stance pads, as the physics
 * collides with the stance body until the swing starts). Null for a leave: the feet stay in the stance throughout.
 */
export function strideStartScene(result: DeliveryResult, releaseScene: number): number | null {
  if (!result.swing) return null;
  return simToScene({ releaseScene }, result.swing.startT);
}

/**
 * The stride's window: from the input to planted by the physics contact or the ball's arrival at the footwork's
 * contact plane, whichever is earlier; the footwork clip plays at `rate` (its plant at STRIDE_PLANT_MS) to land
 * then. `late` when even STRIDE_MAX_RATE cannot plant it in time (the plant then follows, reported, never led).
 */
export function strideWindow(
  result: DeliveryResult,
  releaseScene: number,
  governed?: boolean,
): { strideAt: number; plantAt: number; rate: number; late: boolean; compressed: boolean } | null {
  const strideAt = strideStartScene(result, releaseScene);
  if (strideAt === null) return null;
  const must0 = governed ?? strideMustPlant(result, strideAt, releaseScene);
  const ov = strokeOverlayIn(result, releaseScene, must0);
  if (ov) {
    // The overlay: at 1x from the input; compressed (smooth warp, input → plant) only when governed and its window
    // allows (strokeOverlayIn); it never leads the input.
    const must = must0;
    if (!must) return { strideAt, plantAt: strideAt + ov.plantMs, rate: 1, late: false, compressed: false };
    const arrival = simToScene({ releaseScene }, idealTimeFor(result.flight, result.footwork));
    const contact =
      result.contact.t !== null && result.contact.kind !== 'miss' && result.contact.kind !== 'leave'
        ? simToScene({ releaseScene }, result.contact.t)
        : arrival;
    const due = Math.min(arrival, contact);
    const W = Math.min(ov.plantMs, Math.max(ov.minMs, due - strideAt));
    return {
      strideAt,
      plantAt: strideAt + W,
      rate: ov.plantMs / W,
      late: strideAt + W > due + 1,
      compressed: W < ov.plantMs - 1e-6,
    };
  }
  // Lead ruling 05:4xZ: the stride keeps its own pace (it may land just after the contact) unless the pads must be
  // where the physics has them before then: a pad or body event, or the ball passing the still-moving legs
  // (`governed`: strideGoverned, from the drawn legs; without it, the physics-frame estimate strideMustPlant).
  if (!(governed ?? strideMustPlant(result, strideAt, releaseScene)))
    return { strideAt, plantAt: strideAt + STRIDE_PLANT_MS, rate: 1, late: false, compressed: false };
  const arrival = simToScene({ releaseScene }, idealTimeFor(result.flight, result.footwork));
  const contact =
    result.contact.t !== null && result.contact.kind !== 'miss' && result.contact.kind !== 'leave'
      ? simToScene({ releaseScene }, result.contact.t)
      : arrival;
  const due = Math.min(arrival, contact);
  const window = due - strideAt;
  const rate = Math.min(STRIDE_MAX_RATE, Math.max(1, STRIDE_PLANT_MS / Math.max(1, window)));
  const plantAt = strideAt + STRIDE_PLANT_MS / rate;
  return { strideAt, plantAt, rate, late: plantAt > due + 1, compressed: true };
}

/** How near (m, beyond touching) the ball may pass a pad still on its way across before the stride must plant first. */
export const STRIDE_BALL_CLEAR_M = 0.03;

/**
 * Whether the stride must be planted by the contact (or the ball's arrival): (a) the physics has a pad or body event,
 * or (b) the ball's path passes within STRIDE_BALL_CLEAR_M of either pad as drawn on its way across at the stride's
 * own pace (each pad's axis eased from its stance place to its stroke place over STRIDE_PLANT_MS, a pad's capsule
 * radius plus the ball's), so the ball is never drawn through a leg the physics had moved away. Physics frame.
 */
function strideMustPlant(result: DeliveryResult, strideAt: number, releaseScene: number): boolean {
  if (result.events.some((e) => e.kind === 'pad' || (e.kind === 'contact' && e.contact === 'body'))) return true;
  const root = result.batterRootOffset;
  const stroke = batterBody(result.footwork, result.flight);
  const near = PAD_CAPSULE_R + BALL_RADIUS + STRIDE_BALL_CLEAR_M;
  for (let t = strideAt; t <= strideAt + STRIDE_PLANT_MS; t += 1000 / 120) {
    const b = ballAt(result.ball, (t - releaseScene) / 1000);
    if (!b || b.y > STANCE_BODY.pads[0].b.y + PAD_CAPSULE_R + BALL_RADIUS) continue;
    const u = smooth01((t - strideAt) / STRIDE_PLANT_MS);
    for (let i = 0; i < 2; i++) {
      const x = STANCE_BODY.pads[i].a.x + (stroke.pads[i].a.x - STANCE_BODY.pads[i].a.x) * u + root.x;
      const z = STANCE_BODY.pads[i].a.z + (stroke.pads[i].a.z - STANCE_BODY.pads[i].a.z) * u + root.z;
      if (Math.hypot(b.x - x, b.z - z) < near) return true;
    }
  }
  return false;
}

/**
 * The striker's moves once the result is known (presentation): the stance (and, in it, the presented backlift), then
 * from the input the footwork stride the physics played, played to plant by the contact or the ball's arrival
 * (strideWindow), with the stroke of the physics' shot family on it, its contact on the physics contact (clip
 * time-warped, never before the input), then at rest on the bat. A leave stays in the stance (the physics collides
 * with the stance body) and lifts the bat out of the line as the ball arrives.
 */
export function strikerMoves(
  result: DeliveryResult,
  releaseScene: number,
  duration: number,
  governed?: boolean,
): Move[] {
  const swing = result.swing;
  const input = swing ? simToScene({ releaseScene }, swing.startT) : null;
  const upper: ClipId = swing ? strokeFor(result).clip : 'bat_leave';
  const meet = simToScene(
    { releaseScene },
    result.batterMotion?.contactT ?? result.contact.t ?? result.flight.idealContactT,
  );
  const marker = clipMarker(upper, 'contact', 0.45) * 1000;
  // The stroke (or the leave's lift) starts at the input; without one, as the ball arrives (a leave).
  const strokeAt = input ?? Math.max(releaseScene + BACKLIFT_TOP_MS, meet - marker);
  const clipStart = Math.max(0, (marker - (meet - strokeAt)) / 1000);
  const strokeEnd = strokeAt + (clipDuration(upper) - clipStart) * 1000;
  const pre = strikerPreSwing(releaseScene, duration, true);
  const moves: Move[] = truncateMoves(
    {
      id: 'striker',
      role: 'batter',
      look: { seed: '', team: 0, gear: 'batter' },
      start: v3(0, 0, 0),
      heading: 0,
      moves: pre,
    },
    strokeAt,
  );
  // A leave keeps the waiting clip's legs (the ready hold, on the stance pads): the physics collides with the stance.
  const waiting = pre.filter((m) => m.t0 <= strokeAt).at(-1) ?? pre[0];
  const strideClip: ClipId = swing ? strokeFor(result).lower : waiting.clip;
  const leaveLegs = swing ? {} : { lowerStart: clipStateAt(waiting, strokeAt).time };
  const win = strideWindow(result, releaseScene, governed);
  // The hand-over into the stroke (round 4, §9): long enough that its peak is not the first step's.
  const inertial = swing ? 200 : 220;
  const ov = win ? strokeOverlayIn(result, releaseScene, governed ?? win.compressed) : null;
  if (swing && ov && win) {
    // TRACKB's overlay (hips, trunk, head, legs) on the stroke clip's arms (reached to the bat): from the input, at 1x,
    // or with input → plant smoothly warped into the window (clip time P·(a·u + b·u²), speed 1x at the plant).
    const P = ov.plantMs;
    const W = win.plantAt - strokeAt;
    const end = Math.max(strokeEnd, win.plantAt + (clipDuration(ov.id) * 1000 - P));
    if (W < P - 1e-6) {
      const a = 2 - W / P;
      const b = W / P - 1;
      const g = (u: number) => P * (a * u + b * u * u);
      const N = 8;
      for (let k = 0; k < N; k++) {
        const u0 = k / N;
        const u1 = (k + 1) / N;
        const t0 = strokeAt + u0 * W;
        const t1 = strokeAt + u1 * W;
        moves.push({
          t0,
          t1,
          clip: upper,
          clipStart: clipStart + (t0 - strokeAt) / 1000,
          rate: 1,
          lower: ov.id,
          lowerStart: g(u0) / 1000,
          lowerRate: (g(u1) - g(u0)) / (t1 - t0),
          ...(k === 0 ? { inertial } : { blend: 0 }),
        });
      }
      moves.push({
        t0: win.plantAt,
        t1: end,
        clip: upper,
        clipStart: clipStart + W / 1000,
        lower: ov.id,
        lowerStart: P / 1000,
        lowerRate: 1,
        blend: 0,
      });
    } else
      moves.push({
        t0: strokeAt,
        t1: end,
        clip: upper,
        clipStart,
        lower: ov.id,
        lowerStart: 0,
        lowerRate: 1,
        inertial,
      });
    // Out of the stroke into the rest: an inertial hand-over long enough that the hips (often 0.2–0.3 m from the rest)
    // never step more than §9 allows (critically damped, ω = 6.6/T: the first frame's change ∝ ω²).
    moves.push({ t0: end, t1: Math.max(end + 1, duration), clip: 'bat_rest', inertial: STROKE_REST_INERTIAL_MS });
    return moves;
  }
  if (!swing && hasMotionClip('bat_leave')) {
    // TRACKB's leave (re-baked, no grip roll): the body stays in the stance, the bat at the compact top; the head turns
    // to watch the ball past. On the waiting clip's arms and bat, its `contact` on the ball's passing.
    const lv = 'vmp:bat_leave' as const;
    const at = Math.max(releaseScene + BACKLIFT_TOP_MS, meet - clipMarker(lv, 'contact', 0.13) * 1000);
    const kept = truncateMoves(
      {
        id: 'striker',
        role: 'batter',
        look: { seed: '', team: 0, gear: 'batter' },
        start: v3(0, 0, 0),
        heading: 0,
        moves: pre,
      },
      at,
    );
    const wait = pre.filter((m) => m.t0 <= at).at(-1) ?? pre[0];
    const lvEnd = at + clipDuration(lv) * 1000;
    kept.push({
      t0: at,
      t1: lvEnd,
      clip: wait.clip,
      clipStart: clipStateAt(wait, at).time,
      lower: lv,
      lowerStart: 0,
      lowerRate: 1,
      inertial: 220,
    });
    kept.push({ t0: lvEnd, t1: Math.max(lvEnd + 1, duration), clip: 'bat_rest', inertial: 320 });
    return kept;
  }
  if (win && win.rate > 1 && win.plantAt < strokeEnd - 1) {
    // The stride played quicker to its plant, then at its own pace; the stroke clip runs on unbroken across the split.
    moves.push({
      t0: strokeAt,
      t1: win.plantAt,
      clip: upper,
      clipStart,
      lower: strideClip,
      lowerStart: 0,
      lowerRate: win.rate,
      inertial,
    });
    moves.push({
      t0: win.plantAt,
      t1: strokeEnd,
      clip: upper,
      clipStart: clipStart + (win.plantAt - strokeAt) / 1000,
      lower: strideClip,
      lowerStart: STRIDE_PLANT_MS / 1000,
      lowerRate: 1,
      blend: 0,
    });
  } else
    moves.push({
      t0: strokeAt,
      t1: strokeEnd,
      clip: upper,
      clipStart,
      lower: strideClip,
      lowerStart: 0,
      inertial,
      ...leaveLegs,
    });
  moves.push({ t0: strokeEnd, t1: Math.max(strokeEnd + 1, duration), clip: 'bat_rest', inertial: 320 });
  return moves;
}

/** The stance fit is measured this far into every script (ms): past the planted-foot plan's fade-in (humansHook). */
export const STANCE_FIT_AT_MS = 400;

/** The physics pads' axes on the ground (world, drawn form) of a physics body translated by the batter's root. */
function padsWorld(
  body: { pads: ReadonlyArray<{ a: PVec3 }> },
  root: { x: number; z: number },
  mirror: boolean,
): [Vec3, Vec3] {
  const at = (i: number) =>
    toWorld({ x: body.pads[i].a.x + root.x, y: 0, z: body.pads[i].a.z + root.z } as PVec3, mirror);
  return [at(0), at(1)];
}

/**
 * The physics batter the striker is drawn on (PhysicsBodyPlan): the stance pads always (the nominal stance body under
 * the batter's root); with a swing, the pads of the footwork body the physics played and its torso top and head
 * (batterBodyFrame), fitted at the contact (else the ball's arrival), the stride from the input to its plant.
 */
export function strikerPhysicsBody(
  result: DeliveryResult | null,
  releaseScene: number | null,
  mirror: boolean,
  stanceRefAt: number,
  releaseAt: number,
  waiting: Move[] | null = null,
  arrivalScene: number | null = null,
  governed?: boolean,
): PhysicsBodyPlan {
  const root = result?.batterRootOffset ?? { x: 0, z: 0 };
  const stance = padsWorld(STANCE_BODY, root, mirror);
  // The trigger window of the waiting moves (strikerPreSwing): from its start to the backlift.
  const trig = waiting?.find((m) => m.clip === 'vmp:bat_trigger');
  const ready =
    waiting && trig && arrivalScene !== null
      ? { moves: waiting, refAt: arrivalScene, from: trig.t0, to: trig.t1 }
      : null;
  const plan: PhysicsBodyPlan = {
    frontLeg: mirror ? 'R' : 'L',
    stance,
    stanceRefAt,
    ready,
    stroke: null,
    releaseAt,
    fadeMs: 400,
  };
  if (!result?.swing || releaseScene === null) return plan;
  const win = strideWindow(result, releaseScene, governed);
  if (!win) return plan;
  const body = batterBody(result.footwork, result.flight);
  const pads = padsWorld(body, root, mirror);
  const pad = result.events.find((e): e is Extract<typeof e, { kind: 'pad' }> => e.kind === 'pad');
  const hitH: [number, number] = [0.3, 0.3];
  const hitBall = pad ? toWorld(pad.p, mirror) : null;
  if (pad) {
    const p = hitBall!;
    const i = Math.hypot(p.x - pads[0].x, p.z - pads[0].z) <= Math.hypot(p.x - pads[1].x, p.z - pads[1].z) ? 0 : 1;
    hitH[i] = clamp(pad.p.y, 0.1, 0.58);
  }
  const contact =
    result.contact.t !== null && result.contact.kind !== 'miss' && result.contact.kind !== 'leave'
      ? simToScene({ releaseScene }, result.contact.t)
      : null;
  const arrival = simToScene({ releaseScene }, idealTimeFor(result.flight, result.footwork));
  const f = result.batterBodyFrame;
  plan.stroke = {
    pads,
    hitH,
    torsoBase: toWorld({ x: body.torso.a.x + root.x, y: body.torso.a.y, z: body.torso.a.z + root.z } as PVec3, mirror),
    torsoTop: toWorld(f.torsoTop, mirror),
    head: toWorld(f.headCentre, mirror),
    hitBall,
    strideAt: win.strideAt,
    plantAt: win.plantAt,
    refAt: Math.max(win.plantAt, contact ?? arrival),
    governed: governed ?? win.compressed,
    overlay: strokeOverlayIn(result, releaseScene, governed ?? win.compressed) !== null,
    followAt: (() => {
      const ov = strokeOverlayIn(result, releaseScene, governed ?? win.compressed);
      return ov ? win.plantAt + (clipMarker(ov.id, 'contact', (ov.plantMs + 50) / 1000) * 1000 - ov.plantMs) : null;
    })(),
  };
  return plan;
}

/**
 * Whether the physics pads govern the stride's placement as well as its timing (lead ruling 06:0xZ): (a) the physics
 * has a pad or body event, or (b) the ball's path passes within STRIDE_BALL_CLEAR_M of a drawn leg as the stroke clip
 * naturally places it (the track's own feet, carried from the stance pads; drawn form), from the input to the
 * natural plant and 200 ms on. Otherwise the feet go where the clip takes them (a back-foot stroke's real back and
 * across), and the physics pads only time the stance.
 */
export function strideGoverned(
  result: DeliveryResult,
  releaseScene: number,
  natural: ActorTrack,
  mirror: boolean,
): boolean {
  return finish(strideGovernedSteps(result, releaseScene, natural, mirror));
}

/** A sliced stride decision advances the planted-feet plan this far (scene ms) between pauses. */
const STRIDE_PLAN_SLICE_MS = 250;

/** Two ground positions are the same (bit for bit). */
function samePlace(a: Vec3, b: Vec3): boolean {
  return Object.is(a.x, b.x) && Object.is(a.y, b.y) && Object.is(a.z, b.z);
}

/** Runs a build's steps to their end in one go (the warm-up takes them a slice at a time instead). */
function finish<T>(steps: Generator<void, T, void>): T {
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
  }
}

/**
 * `strideGoverned`, pausing after each pose it works out. The first pose is the planted-feet hook's whole plan from the
 * start of the script, the others a tenth of it each; `sliced` has the plan advanced a stretch at a time first (the
 * hook's plan is a pure function of time, built forward on demand, so this changes nothing it says). `legs`: a planted-feet
 * hook of the script's own, without the reach of the bat (humansPoseHook's `legs`), to work the legs out with; its plans
 * for `natural` are then there for the frames that draw it. Without one the decision makes a hook of its own.
 */
export function* strideGovernedSteps(
  result: DeliveryResult,
  releaseScene: number,
  natural: ActorTrack,
  mirror: boolean,
  sliced = false,
  legs?: (track: ActorTrack, pose: SampledPose, t: number) => void,
): Generator<void, boolean, void> {
  if (result.events.some((e) => e.kind === 'pad' || (e.kind === 'contact' && e.contact === 'body'))) return true;
  const strideAt = strideStartScene(result, releaseScene);
  if (strideAt === null) return false;
  // The legs exactly as the stage would draw them unguided (`natural` carries its ungoverned PhysicsBodyPlan; the same
  // planted-feet hook), each shin's axis at the ball's height. Made when the first pose is asked for.
  let rig: {
    hook: (track: ActorTrack, pose: SampledPose, t: number) => void;
    a: SampledPose;
    b: SampledPose;
    lw: SampledPose;
    j: Joints;
  } | null = null;
  const scale = lookScale(natural.look);
  const shinsAt = (t: number, y: number): Array<{ x: number; z: number }> => {
    const { hook, a, b, lw, j } = (rig ??= {
      hook: legs ?? humansPoseHook({ actors: [natural] } as unknown as BallScript),
      a: createPose(),
      b: createPose(),
      lw: createPose(),
      j: createJoints(),
    });
    const st = evaluateActor(natural, t);
    const pose = samplePresented(st, a, b, lw);
    hook(natural, pose, t);
    if (natural.mirror) mirrorSampledPose(pose);
    forwardKinematics(pose, j);
    const root = { x: st.pos.x + (st.body?.x ?? 0), y: 0, z: st.pos.z + (st.body?.z ?? 0) };
    return (['L', 'R'] as const).map((side) => {
      const ankle = jointWorld(j, `foot${side}`, root, st.heading, scale);
      const knee = jointWorld(j, `shin${side}`, root, st.heading, scale);
      const u = Math.min(1.4, Math.max(0, (y - ankle.y) / Math.max(1e-3, knee.y - ankle.y)));
      return { x: ankle.x + (knee.x - ankle.x) * u, z: ankle.z + (knee.z - ankle.z) * u };
    });
  };
  const ref = natural.physicsBody?.stroke?.refAt ?? strideAt + STRIDE_PLANT_MS;
  const near = PAD_CAPSULE_R + BALL_RADIUS + STRIDE_BALL_CLEAR_M;
  const top = STANCE_BODY.pads[0].b.y + PAD_CAPSULE_R + BALL_RADIUS;
  let rolled = !sliced;
  for (let t = strideAt; t <= ref + 300; t += 1000 / 120) {
    const bp = ballAt(result.ball, (t - releaseScene) / 1000);
    if (!bp || bp.y > top) continue;
    if (!rolled) {
      // The plan up to the first pose, a stretch at a time.
      rolled = true;
      for (let u = STRIDE_PLAN_SLICE_MS; u < t; u += STRIDE_PLAN_SLICE_MS) {
        shinsAt(u, bp.y);
        yield;
      }
    }
    const ball = toWorld(bp, mirror);
    for (const q of shinsAt(t, bp.y)) if (Math.hypot(ball.x - q.x, ball.z - q.z) < near) return true;
    yield;
  }
  return false;
}

/** What `deferStride` needs of the build. */
interface DeferredStride {
  /** The striker's track: its `moves` and `physicsBody` become accessors that make the decision when first read. */
  striker: ActorTrack;
  result: DeliveryResult;
  releaseScene: number;
  mirror: boolean;
  /** The natural stride's moves and physics body: what the decision works on, and what the striker is until it is made. */
  natural: Move[];
  natBody: PhysicsBodyPlan;
  /** The striker's moves and physics body once `governed` is known (all the build does with them after the decision). */
  settle: (governed: boolean) => { moves: Move[]; physicsBody: PhysicsBodyPlan };
  /**
   * The natural stride is what the striker is drawn with unless the decision says otherwise (nothing the build does later
   * changes it, as a run's set-off does): the decision then runs on his own track, with the stage's hook, and the plans it
   * makes are the ones his frames use.
   */
  shared: boolean;
}

/**
 * Has the striker's stride decision made when it is needed rather than in the build (PERF-3, 2026-11-07): his moves and
 * physics body wait on it, and a read of either makes it, whole, so everything that reads them is as it was; the stage
 * works it out ahead of that in the spare time of the frames (`StrideDecision.advance`), because it is more than half of the
 * work of building a result's script and the striker is hidden from the first-person camera until it cuts away. While the
 * decision runs it reads the natural stride from the striker (his moves and physics body read as that, not as what it will
 * decide), and what it decides replaces them. If the decision is "governed", the plans a hook made for the natural stride
 * are dropped (`forget`).
 */
function deferStride(d: DeferredStride): StrideDecision {
  const { striker } = d;
  const provisional = { moves: d.natural, physicsBody: d.natBody };
  // Before the accessors: a copy of his track as it is, with the natural stride (for a decision that runs on a track of its own).
  const track: ActorTrack = d.shared ? striker : { ...striker, moves: d.natural, physicsBody: d.natBody };
  let made: { moves: Move[]; physicsBody: PhysicsBodyPlan } | null = null;
  let steps: Generator<void, boolean, void> | null = null;
  let shared: WarmablePoseHook | undefined;
  let inside = false;
  /** A decision that threw (a result that is not one) throws again for whoever asks next, as the build that made it would have. */
  let failure: { error: unknown } | null = null;
  const advance = (ms: number, hook?: WarmablePoseHook): boolean => {
    if (made) return true;
    if (inside) return false;
    if (failure) throw failure.error;
    if (!steps) {
      if (d.shared) shared = hook;
      steps = strideGovernedSteps(d.result, d.releaseScene, track, d.mirror, true, shared?.legs);
    }
    const t0 = performance.now();
    inside = true;
    try {
      for (;;) {
        const r = steps.next();
        if (r.done) {
          made = d.settle(r.value);
          if (r.value) shared?.forget?.(striker);
          break;
        }
        if (performance.now() - t0 >= ms) break;
      }
    } catch (error) {
      failure = { error };
      throw error;
    } finally {
      inside = false;
    }
    return made !== null;
  };
  const read = () => {
    if (made) return made;
    if (inside) return provisional;
    advance(Number.POSITIVE_INFINITY);
    return made!;
  };
  for (const key of ['moves', 'physicsBody'] as const) {
    Object.defineProperty(striker, key, {
      get: () => read()[key],
      set: (v) => {
        read();
        (made as Record<string, unknown>)[key] = v;
      },
      enumerable: true,
      configurable: true,
    });
  }
  return {
    get done() {
      return made !== null;
    },
    advance,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The Director's anchors
// ---------------------------------------------------------------------------------------------------------------

/** The unhit ball is taken to have passed the batter this long after it crosses the crease line (a late contact behind it). */
const PASS_MARGIN_MS = 30;

/**
 * The anchors the face-and-life Director plans from (`DirectorSpec`). Nothing here may differ between the script before
 * the result and the one after it except from the time the result matters: the live script has no contact, outcome,
 * dead ball or stroke end (`null`), and its task ends when the UNHIT ball passes the batter, which no contact can
 * outlast (a contact is at or before the ball's passing), so the blink-free window of the live plan is never shorter
 * than the result's and the two plans agree until the contact (honesty tests, directorStage.test.ts).
 */
export function directorSpec(o: {
  flight: BallFlight | null;
  result: DeliveryResult | null;
  idle: boolean;
  runUp: boolean;
  run: ReturnType<typeof bowlerRun>;
  releaseScene: number;
  duration: number;
  contactScene: number | null;
  deadScene: number | null;
  strokeEndScene: number | null;
  runsRun: number;
  outcomeAt: number;
  outcome: string | null;
  mirror: boolean;
}): DirectorSpec {
  const delivery = !o.idle || o.runUp;
  const R = o.releaseScene;
  // When the unhit flight crosses the batting crease (physics frame z), scene ms.
  let pass: number | null = null;
  if (o.flight) {
    const s = o.flight.samples;
    for (let i = 0; i < s.length; i++) {
      if (s[i].p.z >= CREASE_Z) {
        pass = simToScene({ releaseScene: R }, s[i].t);
        break;
      }
    }
    if (pass === null) pass = simToScene({ releaseScene: R }, o.flight.idealContactT);
  }
  const bowler: DirectorActorSpec = {
    start: 0,
    end: o.duration,
    runStart: delivery ? o.run.runStart : null,
    gather: delivery ? R - o.run.releaseMarker * 1000 : null,
    release: delivery ? R : null,
    followEnd: delivery ? o.run.followDone : null,
    swing: null,
    contact: null,
    taskEnd: null,
    outcomeAt: null,
    outcome: null,
    dead: null,
    strokeEnd: null,
    runs: 0,
  };
  const striker: DirectorActorSpec = {
    start: 0,
    end: o.duration,
    runStart: null,
    gather: null,
    release: delivery ? R : null,
    followEnd: null,
    swing: o.result?.swing ? simToScene({ releaseScene: R }, o.result.swing.startT) : null,
    contact: o.contactScene,
    taskEnd: pass === null ? null : (o.contactScene ?? pass + PASS_MARGIN_MS),
    outcomeAt: Number.isFinite(o.outcomeAt) ? o.outcomeAt : null,
    outcome: Number.isFinite(o.outcomeAt) ? o.outcome : null,
    dead: o.deadScene,
    strokeEnd: o.strokeEndScene,
    runs: o.runsRun,
  };
  const last = o.flight?.samples.at(-1);
  return {
    seed: o.flight ? o.flight.seed : null,
    strikerEye: batterEye(o.mirror),
    flightEnd: o.flight && last ? simToScene({ releaseScene: R }, last.t) : null,
    bowler,
    striker,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------------------------------------------

export interface PracticeBuildInput {
  setup: PracticeSceneSetup;
  /** The delivery (null: the scene between balls). */
  flight: BallFlight | null;
  result?: DeliveryResult | null;
  /** Scene ms the provisional swing started (live only). */
  provisionalStart?: number | null;
  /** Latest canonical live contact state (presentation only). */
  contactState?: OneGestureState | null;
  /** Scene ms the result arrived (live only; replays leave it out and draw the physics bat alone). */
  resultAt?: number | null;
  /**
   * Live only: the script on screen when the result arrived and that moment (scene ms). The new script keeps its eye
   * and continues its gaze (PracticeInfo.eye, gazeFrom). Ignored unless both share the release.
   */
  handover?: { script: BallScript; atScene: number } | null;
  learnCue?: boolean;
  /** Bowling hand at release relative to the bowler's root (actor frame, right arm, the rig's own scale). */
  releaseHand?: Vec3;
  /** Length of the between-balls scene (ms). */
  idleMs?: number;
  /** Between balls, the bowler runs in and bowls with the ball still in hand (the benchmark's scene). */
  runUp?: boolean;
  context?: DeliveryContext;
  /**
   * The build is being taken in slices (`buildPracticeScriptSteps`, the stage's warm-up): it also pauses inside its long
   * waits, advancing the stride decision's planted-feet plan a stretch at a time. Never changes the script.
   */
  sliced?: boolean;
}

const HALF_PI = Math.PI / 2;

function firstEvent<K extends DeliveryResult['events'][number]['kind']>(
  r: DeliveryResult,
  kind: K,
): Extract<DeliveryResult['events'][number], { kind: K }> | undefined {
  return r.events.find((e) => e.kind === kind) as Extract<DeliveryResult['events'][number], { kind: K }> | undefined;
}

/** Builds the Practice scene at one moment of knowledge: between balls, mid-delivery, or with the result. */
export function buildPracticeScript(input: PracticeBuildInput): BallScript {
  return finish(buildPracticeScriptSteps(input));
}

/**
 * `buildPracticeScript` paused between its parts (after the bowler's run, the reactions, each fielder, the batters, the
 * result's cues, the stride decision and each pose it works out, the non-striker's moves, the runs): the stage's warm-up
 * takes the build a slice of a frame at a time, so the first real result does not pay for compiling it. Driven to its end
 * in one go it is the build: nothing here depends on how it is driven.
 */
export function* buildPracticeScriptSteps(input: PracticeBuildInput): Generator<void, BallScript, void> {
  const { setup, flight } = input;
  const result = input.result ?? null;
  const batterRootOffset = result?.batterRootOffset ?? { x: 0, z: 0 };
  const mirror = setup.handedness === 'left';
  const bowler = setup.bowler;
  const action = practiceAction(bowler);
  const family = familyOf(bowler);
  const cast = practiceCast(bowler);
  const leftArm = bowler.arm === 'left';
  const releaseWorld = flight ? toWorld(flight.release.p, mirror) : nominalRelease(bowler);
  // The bowler's rig at his own release height (bowlerScale), the ball in his hand measured on his rig scaled with it.
  // A pace bouncer is MOTION-BOWL's bouncer delivery (when loaded and measured): its own ball in hand, the same scale.
  const measured = (input.releaseHand ?? null) as ReleaseHands | null;
  const bowlerFit = bowlerScale(bowler, measured, cast.bowler);
  const bowlerLook: Look = { ...cast.bowler, scale: bowlerFit.scale };
  const bouncerClip =
    flight?.plan.variation === 'bouncer' && family === 'pace' && Boolean(measured?.bouncer) && bowlerFit.hand !== null;
  const own = avatarTraits(cast.bowler.seed).height;
  const hand = bouncerClip
    ? v3(
        measured!.bouncer!.x * (bowlerFit.scale / own),
        measured!.bouncer!.y * (bowlerFit.scale / own),
        measured!.bouncer!.z * (bowlerFit.scale / own),
      )
    : (bowlerFit.hand ?? NOMINAL_RELEASE_HAND[action]);
  const handX = leftArm ? -hand.x : hand.x;
  const releaseRoot = v3(releaseWorld.x - handX, 0, releaseWorld.z - hand.z);
  const actors: ActorTrack[] = [];
  const balls: BallSeg[] = [];
  const idle = !flight;

  // Bowler: at the top of the mark between balls; otherwise the run-up, the action and the follow-through.
  // The follow-through comes to rest on the physics bowler's spot (where the physics fields from).
  const bowlerSpot = setup.field.fielders.find((f) => f.role === 'bowler');
  const followTo = bowlerSpot ? toWorld(v3(bowlerSpot.x, 0, bowlerSpot.z), mirror) : undefined;
  const run = bowlerRun({
    action,
    look: bowlerLook,
    releaseRoot,
    ...(bouncerClip ? { variant: 'bouncer' as const } : {}),
    mirror: leftArm,
    ...(followTo ? { followTo } : {}),
    ...runOptions(bowler),
  });
  const releaseScene = run.release;
  const duration = idle
    ? (input.idleMs ?? 60_000)
    : result
      ? Math.max(simToScene({ releaseScene }, result.deadT) + AFTER_DEAD_MS, releaseScene + 4000)
      : releaseScene + Math.max(4000, ((flight.samples.at(-1)?.t ?? 1) + 2.5) * 1000);
  if (idle && !input.runUp) {
    actors.push({ ...run.track, moves: [{ t0: 0, t1: duration, clip: 'idle', heading: run.track.moves[0].heading }] });
  } else actors.push(run.track);
  const bowlerTrack = actors[0];
  yield;

  // Fielders (the keeper and the bowler have their own tracks).
  const paths = new Map<string, FielderPath>((result?.fielders ?? []).map((p) => [p.fielderId, p]));
  const keeperField = setup.field.fielders.find((f) => f.role === 'keeper');
  const bowlerField = setup.field.fielders.find((f) => f.role === 'bowler');
  const striker = toWorld(v3(batterRootOffset.x, 0, CREASE_Z + batterRootOffset.z), mirror);
  const catchEvent = result ? firstEvent(result, 'catch') : undefined;
  const ballFace = (t: number): Vec3 | null => {
    if (!result) return null;
    const p = ballAt(result.ball, t);
    return p ? toWorld(p, mirror) : null;
  };
  const ballVelocity = (t: number): Vec3 | null => {
    if (!result) return null;
    const v = ballVelocityAt(result.ball, t);
    return v ? toWorld(v, mirror) : null;
  };
  const reactions = result
    ? fieldReactions(result, setup.field.fielders, paths)
    : new Map<string, { t: number; clip: ClipId }>();
  yield;
  /** The physics bat (or pad) contact, simulation s, for the fielders' anticipation; undefined without one. */
  const contactT = result ? result.events.find((e) => e.kind === 'contact')?.t : undefined;
  const fielderTrack = (f: Fielder, id: string, look: Look, before: ClipId): ActorTrack => {
    const pos = toWorld(v3(f.x, 0, f.z), mirror);
    const facing = headingOf(striker.x - pos.x, striker.z - pos.z);
    const keeperRole = before === 'keep_crouch';
    const phase = (hash32(id) % 1000) / 500;
    const scale = avatarTraits(look.seed).height;
    // Between balls and early in the run-up he stands where the walk in starts; by the release he is set at his
    // physics position (the path's first sample), so nothing after the release moves off the path.
    const walk = walkIn(f, pos, striker, releaseScene, id);
    const start = walk ? walk.start : pos;
    const moves: Move[] = idle
      ? [{ t0: 0, t1: duration, clip: 'idle', heading: facing, clipStart: phase }]
      : walk
        ? [
            { t0: 0, t1: walk.t0, clip: 'idle', heading: facing, clipStart: phase },
            {
              t0: walk.t0,
              t1: walk.t1,
              clip: 'walk',
              from: walk.start,
              to: pos,
              rate: matchedRate(fieldClips().walk, WALK_IN.mps, scale),
              heading: facing,
              blend: 240,
            },
            { t0: walk.t1, t1: duration, clip: before, heading: facing, blend: 280 },
          ]
        : [
            // The keeper is down and still before the bowler's gather (never dropping during the delivery).
            {
              t0: 0,
              t1: Math.max(1, releaseScene - (keeperRole ? 1800 : 900)),
              clip: 'idle',
              heading: facing,
              clipStart: phase,
            },
            {
              t0: Math.max(1, releaseScene - (keeperRole ? 1800 : 900)),
              t1: duration,
              clip: before,
              heading: facing,
              blend: keeperRole ? 900 : 320,
            },
          ];
    const path = paths.get(f.id);
    if (path && !idle) {
      const pm = pathMoves(path, mirror, releaseScene, {
        catchHigh: catchEvent?.fielderId === f.id && catchEvent.p.y > 1.9,
        faceTowards: ballFace,
        ballVelocity,
        keeper: keeperRole,
        heading: facing,
        striker,
        endScene: duration,
        phase,
        returnTo: walk?.start ?? pos,
        scale,
        playT: contactT,
        bounceT: result?.flight.bounce?.t ?? null,
        ...(reactions.has(f.id) ? { reaction: reactions.get(f.id)! } : {}),
      });
      if (pm.length) {
        const cut = pm[0].t0;
        const kept = truncateMoves({ id, role: 'fielder', look, start, heading: facing, moves }, cut);
        moves.splice(0, moves.length, ...kept, ...pm);
        const last = moves[moves.length - 1];
        if (last.t1 < duration) moves.push({ t0: last.t1, t1: duration, clip: 'idle', blend: 300 });
      }
    }
    return { id, role: id === 'keeper' ? 'keeper' : 'fielder', look, start, heading: facing, moves };
  };
  for (const f of setup.field.fielders) {
    if (f.role === 'bowler') continue;
    if (f.role === 'keeper') actors.push(fielderTrack(f, 'keeper', cast.keeper, 'keep_crouch'));
    else actors.push(fielderTrack(f, `fielder:${f.id}`, cast.fielder(f.id), 'ready'));
    yield;
  }
  // The bowler fields its own bowling when the physics sends it after the ball.
  if (result && bowlerField) {
    const path = paths.get(bowlerField.id);
    if (path) {
      const pm = pathMoves(path, mirror, releaseScene, {
        catchHigh: catchEvent?.fielderId === bowlerField.id && catchEvent.p.y > 1.9,
        faceTowards: ballFace,
        ballVelocity,
        striker,
        endScene: duration,
        ...(reactions.has(bowlerField.id) ? { reaction: reactions.get(bowlerField.id)! } : {}),
      }).filter((m) => m.t0 >= run.deliveryEnd - 150);
      if (pm.length) {
        // The chase takes over from wherever the follow-through has carried him (no jump onto the path).
        const cut = pm[0].t0;
        const was = evaluateActor(bowlerTrack, cut);
        const at = was.pos;
        bowlerTrack.moves = truncateMoves(bowlerTrack, cut);
        // The physics path from where it is at `cut`, plus the gap to where the follow-through has carried him,
        // fading out (C1) over a time that keeps the join's extra speed under ~1.5 m/s.
        const onPath = pm[0].from ?? at;
        const gap = { x: at.x - onPath.x, z: at.z - onPath.z };
        const fadeMs = Math.min(1200, Math.max(350, (Math.hypot(gap.x, gap.z) / 1.5) * 1500));
        const k = (t: number) => 1 - smooth01((t - cut) / fadeMs);
        const shift = (p: Vec3 | undefined, t: number): Vec3 | undefined =>
          p ? v3(p.x + gap.x * k(t), p.y, p.z + gap.z * k(t)) : p;
        for (let i = 0; i < pm.length && pm[i].t0 < cut + fadeMs; i++) {
          const m = pm[i];
          const from = m.from ?? (i === 0 ? onPath : undefined);
          const to = m.to ?? from;
          pm[i] = { ...m, ...(from ? { from: shift(from, m.t0) } : {}), ...(to ? { to: shift(to, m.t1) } : {}) };
        }
        bowlerTrack.moves.push(...pm);
        handOverFollowThrough(bowlerTrack, bowlerTrack.moves.length - pm.length, was.heading);
      }
    }
  }
  if (!idle && !input.runUp) addWalkBack(bowlerTrack, run.track.start, duration);
  yield;

  // The keeper takes the ball when the physics says so (unless its own path already covers it).
  const take = result ? firstEvent(result, 'keeper_take') : undefined;
  const keeper = actors.find((a) => a.id === 'keeper');
  if (keeper && take && !paths.has(keeperField?.id ?? '')) {
    const at = simToScene({ releaseScene }, take.t) - clipMarker('keep_take', 'catch', 0.3) * 1000;
    keeper.moves = truncateMoves(keeper, at);
    keeper.moves.push(
      { t0: at, t1: at + 1000, clip: 'keep_take', blend: 80 },
      { t0: at + 1000, t1: duration, clip: 'idle', blend: 300 },
    );
  }

  // Batters: the striker (hidden from the first-person camera) and a running partner at the other end.
  const stanceWorld = toWorld(
    v3(STANCE_ROOT.x + batterRootOffset.x, STANCE_ROOT.y, STANCE_ROOT.z + batterRootOffset.z),
    mirror,
  );
  const waitingMoves = strikerPreSwing(releaseScene, duration, !idle || Boolean(input.runUp));
  const arrivalScene = flight ? simToScene({ releaseScene }, flight.idealContactT) : null;
  const strikerTrack: ActorTrack = {
    id: 'striker',
    role: 'batter',
    look: cast.striker,
    start: stanceWorld,
    heading: mirror ? -HALF_PI : HALF_PI,
    ...(mirror ? { mirror: true } : {}),
    moves: waitingMoves,
    // On the physics stance pads from the start (every script alike: the fit is measured on the first stance frame).
    physicsBody: strikerPhysicsBody(
      null,
      null,
      mirror,
      STANCE_FIT_AT_MS,
      Number.POSITIVE_INFINITY,
      waitingMoves,
      arrivalScene,
    ),
  };
  // The non-striker: at his crease on the side away from the bowler's arm, backing up as the bowler runs in.
  const nsDelivery = !idle || Boolean(input.runUp);
  const nsTrack: ActorTrack = {
    id: 'nonStriker',
    role: 'batter',
    look: cast.nonStriker,
    start: nonStrikerStand(leftArm),
    heading: 0,
    ...(mirror ? { mirror: true } : {}),
    // With a result these are made again below (its dead ball and runs decide them): not worked out twice.
    moves:
      result && flight
        ? []
        : nonStrikerMoves({
            releaseScene,
            duration,
            delivery: nsDelivery,
            bowlerLeftArm: leftArm,
            deadScene: null,
            scale: avatarTraits(cast.nonStriker.seed).height,
            mirror,
            ...(flight ? { arrivalScene: simToScene({ releaseScene }, flight.idealContactT) } : {}),
          }),
  };
  actors.push(strikerTrack, nsTrack);
  actors.push(
    {
      id: 'umpire',
      role: 'umpire',
      look: cast.umpires[0],
      start: toWorld(UMPIRE_POS, mirror),
      heading: 0,
      moves: [{ t0: 0, t1: duration, clip: 'ump_stand' }],
    },
    {
      id: 'umpire2',
      role: 'umpire',
      look: cast.umpires[1],
      start: toWorld(SQUARE_UMPIRE_POS, mirror),
      heading: mirror ? -HALF_PI : HALF_PI,
      moves: [{ t0: 0, t1: duration, clip: 'ump_stand' }],
    },
  );

  // The ball: in the bowler's hand, then the physics path (the flight until the result is known, then the result).
  let cues: FeedbackCue[] = [];
  let contactScene: number | null = null;
  let firstPersonUntil = Number.POSITIVE_INFINITY;
  let external: PracticeInfo['external'] = 'none';
  let deadScene: number | null = null;
  let strokeEndScene: number | null = null;
  let stride: StrideDecision | null = null;
  let runsRun = 0;
  const events: BallScript['events'] = [];
  const stumps: BallScript['stumps'] = { striker: null, nonStriker: null };
  const emotion = buildEmotion({
    releaseScene,
    result,
    delivery: !idle || Boolean(input.runUp),
    duration,
    context: input.context,
  });
  if (idle) {
    balls.push({ k: 'hand', t0: 0, t1: duration, actor: 'bowler' });
  } else {
    const samples: readonly BallSample[] = result ? result.ball : flight.samples;
    balls.push({ k: 'hand', t0: 0, t1: releaseScene, actor: 'bowler' });
    // The release spin until the pitch, then the spin it comes off the pitch with. A ball met before it pitches never
    // reaches the flight's bounce (COH4): it keeps its release spin, with no change at a bounce that did not happen.
    const pitch = flight.bounce && (!result || presentedBounce(result, flight.bounce)) ? flight.bounce : null;
    const bounceAt = pitch && flight.spin.afterBounce ? simToScene({ releaseScene }, pitch.t) : duration;
    const rotation = ballRotation(flight);
    // A plane normal is axial under the left-handed mirror; the polished pole is a point on the ball, so it is polar.
    // They remain the same unoriented line because BallFlight.shine is ±BallFlight.seam.axis.
    const seamAxis = mirror
      ? v3(flight.seam.axis.x, -flight.seam.axis.y, -flight.seam.axis.z)
      : v3(flight.seam.axis.x, flight.seam.axis.y, flight.seam.axis.z);
    const shineAxis = mirror
      ? v3(-flight.seam.shine.x, flight.seam.shine.y, flight.seam.shine.z)
      : v3(flight.seam.shine.x, flight.seam.shine.y, flight.seam.shine.z);
    // The engine defines the pole and seam plane but not texture roll around that pole. Freeze the renderer's existing
    // shortest-arc release roll as a second material axis, then carry all three axes rigidly through the bounce.
    const surfaceTangent = releaseSurfaceTangent(shineAxis);
    const surface = { seamAxis, shineAxis, surfaceTangent };
    const releaseRotation = seamSpin(rotation.release, family, mirror);
    balls.push({
      k: 'path',
      t0: releaseScene,
      t1: bounceAt,
      samples,
      release: releaseScene,
      spinOrigin: releaseScene,
      mirror,
      ...releaseRotation,
      ...surface,
    });
    if (bounceAt < duration && rotation.afterBounce) {
      // Carry the complete rigid surface to the bounce before changing rotation axis/rate. Without the carried axes
      // the new after-bounce spin would be applied retroactively from release and the visible seam would jump.
      const atBounce = (bounceAt - releaseScene) * releaseRotation.spinRate;
      const carried = {
        seamAxis: rotateAround(seamAxis, releaseRotation.spinAxis, atBounce),
        shineAxis: rotateAround(shineAxis, releaseRotation.spinAxis, atBounce),
        surfaceTangent: rotateAround(surfaceTangent, releaseRotation.spinAxis, atBounce),
      };
      balls.push({
        k: 'path',
        t0: bounceAt,
        t1: duration,
        samples,
        release: releaseScene,
        spinOrigin: bounceAt,
        mirror,
        ...seamSpin(rotation.afterBounce, family, mirror),
        ...carried,
      });
    }
    if (!result) {
      // Until the result lands, the delivery's own events (release, pitch) still sound on time.
      events.push({ t: releaseScene, kind: 'release', intensity: Math.min(1.1, flight.release.speedKph / 150) });
      if (flight.bounce)
        events.push({
          t: simToScene({ releaseScene }, flight.bounce.t),
          kind: 'bounce',
          intensity: 0.6,
          at: toWorld(flight.bounce.p, mirror),
        });
    } else {
      cues = feedbackCues(result, releaseScene, mirror);
      yield;
      events.push(...sceneEventsOf(cues));
      deadScene = simToScene({ releaseScene }, result.deadT);
      const c = result.contact;
      const touched = c.t !== null && c.kind !== 'miss' && c.kind !== 'leave';
      contactScene = touched ? simToScene({ releaseScene }, c.t!) : null;
      const stumpsHit = firstEvent(result, 'stumps');
      if (stumpsHit) {
        const at = simToScene({ releaseScene }, stumpsHit.t);
        const vel = ballVelocityAt(result.ball, stumpsHit.t) ?? { x: 0, y: 0, z: 1 };
        const dir = toWorld(vel as PVec3, mirror);
        const l = Math.hypot(dir.x, dir.z) || 1;
        stumps.striker = { t: at, dir: v3(dir.x / l, 0, dir.z / l), strength: 1 };
        firstPersonUntil = at + BOWLED_HOLD_MS;
        external = 'stumps';
      } else if (touched && (c.kind === 'middle' || c.kind.endsWith('_edge'))) {
        firstPersonUntil = contactScene! + HEAD_FOLLOW_MS;
        external = 'fielding';
      }
      // The striker's body (practice/script strikerMoves): from the input, the stride of the footwork the physics
      // played and the stroke; a leave stays in the stance and lets the ball go.
      // The natural stride first; the physics pads govern it only when the ball needs them to (strideGoverned).
      const natural = strikerMoves(result, releaseScene, duration, false);
      yield;
      const natRest = natural.find((m) => m.clip === 'bat_rest')?.t0 ?? duration;
      const natBody = strikerPhysicsBody(
        result,
        releaseScene,
        mirror,
        STANCE_FIT_AT_MS,
        result.swing ? natRest : Number.POSITIVE_INFINITY,
        waitingMoves,
        arrivalScene,
        false,
      );
      const runTs = runTimes(result);
      const setOff = runTs.length ? simToScene({ releaseScene }, setOffT(runTs)) : null;
      // The decision may wait (deferStride) when nothing else the build does depends on how it comes out: the stroke ends at
      // the same time either way (the Director's anchor) and the striker stands in the same place when a run sets off.
      const governedMoves = result.swing && !input.sliced ? strikerMoves(result, releaseScene, duration, true) : null;
      const waits =
        governedMoves !== null &&
        (governedMoves.find((m) => m.clip === 'bat_rest')?.t0 ?? duration) === natRest &&
        (setOff === null ||
          samePlace(
            evaluateActor({ ...strikerTrack, moves: natural }, setOff).pos,
            evaluateActor({ ...strikerTrack, moves: governedMoves }, setOff).pos,
          ));
      const governed =
        result.swing && !waits
          ? yield* strideGovernedSteps(
              result,
              releaseScene,
              { ...strikerTrack, moves: natural, physicsBody: natBody },
              mirror,
              input.sliced,
            )
          : false;
      strikerTrack.moves = governed ? strikerMoves(result, releaseScene, duration, true) : natural;
      // The drawn legs and trunk on the physics body: the stance pads, and with a swing the stroke's (strideWindow).
      const atRest = strikerTrack.moves.find((m) => m.clip === 'bat_rest')?.t0 ?? duration;
      strokeEndScene = atRest;
      strikerTrack.physicsBody = waits
        ? natBody
        : strikerPhysicsBody(
            result,
            releaseScene,
            mirror,
            STANCE_FIT_AT_MS,
            result.swing ? atRest : Number.POSITIVE_INFINITY,
            waitingMoves,
            arrivalScene,
            governed,
          );
      // The non-striker walks back into his crease after a dead ball with no run; with runs, both batters run them
      // exactly when and as far as the physics says (practice/nonStriker.ts).
      yield;
      nsTrack.moves = nonStrikerMoves({
        releaseScene,
        duration,
        delivery: true,
        bowlerLeftArm: leftArm,
        deadScene,
        scale: avatarTraits(cast.nonStriker.seed).height,
        mirror,
        arrivalScene: simToScene({ releaseScene }, result.flight.idealContactT),
      });
      yield;
      runsRun = runTs.length;
      let running: ReturnType<typeof runningMoves> = null;
      if (setOff !== null) {
        running = runningMoves({
          scale: avatarTraits(cast.nonStriker.seed).height,
          result,
          releaseScene,
          duration,
          mirror,
          bowlerLeftArm: leftArm,
          striker: evaluateActor(strikerTrack, setOff).pos,
          nonStriker: evaluateActor(nsTrack, setOff).pos,
          nonStrikerGait: (() => {
            const c = evaluateActor(nsTrack, setOff).current;
            return c.lower ? { clip: c.lower, time: c.lowerTime ?? 0 } : { clip: c.clip, time: c.time };
          })(),
          nonStrikerSpeed: (() => {
            const a = evaluateActor(nsTrack, setOff - 50).pos;
            const b = evaluateActor(nsTrack, setOff).pos;
            return Math.hypot(b.x - a.x, b.z - a.z) / 0.05;
          })(),
        });
        if (running) {
          if (!waits) {
            strikerTrack.moves = [...truncateMoves(strikerTrack, running.start), ...running.striker];
            strikerTrack.physicsBody = {
              ...strikerTrack.physicsBody!,
              releaseAt: Math.min(strikerTrack.physicsBody!.releaseAt, running.start),
            };
          }
          nsTrack.moves = [...truncateMoves(nsTrack, running.start), ...running.nonStriker];
        }
      }
      if (waits) {
        const runs = running;
        const own = { ...strikerTrack };
        stride = deferStride({
          striker: strikerTrack,
          result,
          releaseScene,
          mirror,
          natural,
          natBody,
          shared: !runs,
          settle: (isGoverned) => {
            let moves = isGoverned ? governedMoves! : natural;
            let physicsBody = isGoverned
              ? strikerPhysicsBody(
                  result,
                  releaseScene,
                  mirror,
                  STANCE_FIT_AT_MS,
                  natRest,
                  waitingMoves,
                  arrivalScene,
                  true,
                )
              : natBody;
            if (runs) {
              moves = [...truncateMoves({ ...own, moves }, runs.start), ...runs.striker];
              physicsBody = { ...physicsBody, releaseAt: Math.min(physicsBody.releaseAt, runs.start) };
            }
            return { moves, physicsBody };
          },
        });
      }
      // Umpire signals and the crowd.
      const boundary = firstEvent(result, 'boundary');
      const dismissal = result.outcome.dismissal;
      const umpire = actors.find((a) => a.id === 'umpire')!;
      if (boundary) {
        const at = simToScene({ releaseScene }, boundary.t);
        umpire.moves = [
          { t0: 0, t1: at + 600, clip: 'ump_stand' },
          { t0: at + 600, t1: duration, clip: boundary.runs === 6 ? 'ump_six' : 'ump_four', blend: 200 },
        ];
      } else if (dismissal) {
        const at = simToScene({ releaseScene }, (stumpsHit ?? catchEvent)?.t ?? result.deadT);
        if (dismissal !== 'bowled')
          umpire.moves = [
            { t0: 0, t1: at + 900, clip: 'ump_stand' },
            { t0: at + 900, t1: duration, clip: 'ump_out', blend: 200 },
          ];
      }
    }
  }
  // A delivery past the keeper's reach (physics 5f `shortM` > 0) is not held: if its physics path ends there, the
  // ball goes from view as his gloves miss it rather than hanging in the air where the dead ball left it.
  if (result && !idle) {
    const take = result.events.find((e): e is Extract<typeof e, { kind: 'keeper_take' }> => e.kind === 'keeper_take');
    const lastT = result.ball.at(-1)?.t ?? 0;
    if (
      take &&
      (take.shortM ?? 0) > 0 &&
      !result.events.some((e) => e.kind === 'throw' && e.t < take.t) &&
      lastT <= take.t + 0.02
    ) {
      const at = simToScene({ releaseScene }, take.t) + 30;
      const kept: BallSeg[] = [];
      for (const b of balls) if (b.t0 < at) kept.push(b.t1 > at ? { ...b, t1: at } : b);
      kept.push({ k: 'gone', t0: at, t1: duration });
      balls.splice(0, balls.length, ...kept);
    }
  }
  // The ball in the fielder's (or keeper's) hand between the physics take and the throw's release (lead ruling).
  if (result && !idle)
    holdBallInHands(balls, result, releaseScene, duration, mirror, (fid) =>
      fid === keeperField?.id ? 'keeper' : fid === bowlerField?.id ? 'bowler' : `fielder:${fid}`,
    );
  events.sort((a, b) => a.t - b.t);

  const aimSim = flight ? ballAt(flight.samples, flight.idealContactT) : null;
  const bat: BatTrack = {
    mirror,
    releaseScene,
    delivery: !idle || Boolean(input.runUp),
    inputScene: result?.swing ? simToScene({ releaseScene }, result.swing.startT) : null,
    travelMs: result?.swing ? batTravelMs(result.swing.kind, result.swing.power) : PROVISIONAL_TRAVEL_MS,
    samples: result ? result.bat : null,
    contactState: input.contactState ?? null,
    provisionalStart: input.provisionalStart ?? null,
    aim: reachable(aimSim ?? v3(0.1, 0.5, CREASE_Z - 0.6)),
    resultAt: input.resultAt ?? null,
    contactScene,
    contactImpulseScene:
      result && result.contact.t !== null && (result.contact.kind === 'middle' || result.contact.kind.endsWith('_edge'))
        ? simToScene({ releaseScene }, result.contact.t)
        : null,
    velocityPeakScene: result?.batterMotion ? simToScene({ releaseScene }, result.batterMotion.contactT) : null,
  };
  // A live result takes over from the script on screen (same release, same batter): keep its eye, continue its gaze.
  const h = input.handover;
  const hp = h?.script.practice;
  const handover =
    h && hp && hp.releaseScene === releaseScene && hp.mirror === mirror && Number.isFinite(h.atScene)
      ? { script: h.script, atScene: h.atScene }
      : null;
  const stanceEye = batterEye(mirror, batterRootOffset, result?.batterPosture.crouchM ?? 0);
  const practice: PracticeInfo = {
    mirror,
    eye: handover ? handover.script.practice!.eye : stanceEye,
    gazeFrom: handover,
    stanceEye,
    releaseScene,
    releaseWorld,
    releaseLift: flight ? releaseWorld.y - hand.y : 0,
    bouncerClip,
    flight,
    result,
    bat,
    contactScene,
    firstPersonUntil,
    external,
    landing: input.learnCue && flight?.bounce ? toWorld(flight.bounce.p, mirror) : null,
    variation: flight ? flight.plan.variation : null,
    action,
    bowlerLeftArm: leftArm,
    cues,
    deadScene,
    firstPersonHidden: ['striker'],
    emotion,
    director: directorSpec({
      flight,
      result,
      idle,
      runUp: Boolean(input.runUp),
      run,
      releaseScene,
      duration,
      contactScene,
      deadScene,
      strokeEndScene,
      runsRun,
      outcomeAt: emotion.outcomeAt,
      outcome: emotion.outcome,
      mirror,
    }),
  };
  if (stride)
    Object.defineProperty(practice, 'stride', {
      value: stride,
      enumerable: false,
      writable: false,
      configurable: true,
    });
  const contact = contactScene ?? (flight ? simToScene({ releaseScene }, flight.idealContactT) : duration);
  // A ball met on the full has no bounce before the contact (the full-toss convention), whatever the flight says.
  const pitched = flight?.bounce && (!result || presentedBounce(result, flight.bounce)) ? flight.bounce : null;
  const bounceScene = pitched ? simToScene({ releaseScene }, pitched.t) : contact;
  return {
    kind: 'live',
    duration,
    family,
    bowlerAction: action,
    ball: balls,
    actors,
    stumps,
    events,
    overlay: [],
    crowd: crowdKeys(emotion),
    slowMo: null,
    cameras: null,
    times: {
      runStart: run.runStart,
      release: releaseScene,
      bounce: bounceScene,
      contact,
      decisive: deadScene ?? contact,
      shotEnd: contact,
      celebrate: null,
      end: duration,
    },
    fate: { kind: 'live' },
    celebration: 'none',
    heroes: [],
    shotBearing:
      result?.contact.exitBearingDeg !== null && result?.contact.exitBearingDeg !== undefined
        ? mirror
          ? -result.contact.exitBearingDeg
          : result.contact.exitBearingDeg
        : null,
    sealAt: null,
    practice,
  };
}
