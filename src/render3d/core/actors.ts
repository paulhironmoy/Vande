/**
 * Actor tracks: what each player does over a ball, as a list of timed moves (clip + root path + heading).
 * Evaluation is a pure function of time so replays can seek and offline rendering can step frames.
 */
import type { ClipId } from './clips';
import { avatarTraits } from '@/ui/avatar/traits';
import { type Vec3, angleDelta, clamp, easeIn, easeInOut, easeOut, headingOf, lerpAngle, lerpV } from './math';

type ActorRole = 'bowler' | 'batter' | 'keeper' | 'fielder' | 'umpire';
export type Ease = 'linear' | 'in' | 'out' | 'inOut';

export interface Move {
  t0: number;
  t1: number;
  clip: ClipId;
  /** Seconds into the clip at t0 (default 0). */
  clipStart?: number;
  /** Clip seconds per scene second (default 1). */
  rate?: number;
  /** Lower-body layer (footwork for batters; running legs under a fielder's pickup or catch). */
  lower?: ClipId;
  lowerStart?: number;
  /** Clip seconds per scene second for the lower layer (default `rate`). */
  lowerRate?: number;
  /**
   * Presentation-only body offset (world metres) at t0 and t1, linearly between: a dive's extension from the fielder's
   * physics position towards the ball. `pos` (the physics position) is unchanged; only the drawn rig is offset.
   */
  bodyFrom?: Vec3;
  bodyTo?: Vec3;
  from?: Vec3;
  to?: Vec3;
  ease?: Ease;
  /** Heading at t0 (radians). When omitted: travel direction if moving, else the previous heading. */
  heading?: number;
  /** Heading at t1 (turns smoothly during the move). */
  headingTo?: number;
  /** Crossfade from the previous move, ms (default 140). */
  blend?: number;
  /**
   * Ground speed (m/s) at t0 and t1 along from → to: the progress is a cubic Hermite with those end speeds instead of
   * `ease`, so consecutive moves that agree on the speed where they meet have a continuous root speed.
   */
  speed?: readonly [number, number];
  /** How fast the actor turns into a new direction of travel (ms for the turn; default 220). */
  turnMs?: number;
  /** The turn's ease: 'smooth' is a smoothstep (its fastest rate is 1.5 times the mean), the default the cubic ease (3 times). */
  turnEase?: 'smooth';
  /** 'linear': heading → headingTo at a constant rate over the move (default: eased in and out). */
  headingEase?: 'linear';
  /**
   * Inertialized transition (ms) instead of a cross-fade: the pose difference and its velocity at the switch are
   * decayed by a critically damped curve over this long, so the new clip plays at full weight from the first frame and
   * nothing pops (pack ↔ procedural switches).
   */
  inertial?: number;
  /**
   * With `speed` (and explicit from/to): the clip advances with the ground speed, `rate` × √(v / rateBySpeed), so a
   * gait's cadence rises and falls with the run instead of stepping at full cadence from a standstill.
   */
  rateBySpeed?: number;
  /** With rateBySpeed: the exponent of (v / rateBySpeed) (default 0.5; 1 = a speed-matched gait loop, MOTION-SPEC §6). */
  rateExp?: number;
  /** With rateBySpeed: the playback rate stays within [lo, hi] (MOTION-SPEC §6: [0.75, 1.3] of the clip's own rate). */
  rateClamp?: readonly [number, number];
}

/** Who the actor is (drives the generated look). */
export interface Look {
  seed: string;
  team: 0 | 1;
  /** Wears pads, gloves and a helmet. */
  gear: 'batter' | 'keeper' | 'fielder' | 'bowler' | 'umpire';
  hero?: boolean;
  /**
   * The rig's scale when it is not the look's own height (avatarTraits): the bowler, fitted to his physics release
   * height (practice/script.ts bowlerScale). Read it through lookScale().
   */
  scale?: number;
}

/** The scale a look's rig is drawn at: its explicit scale, else the avatar's height. */
export function lookScale(look: Look): number {
  return look.scale ?? avatarTraits(look.seed).height;
}

export interface ActorTrack {
  id: string;
  role: ActorRole;
  look: Look;
  start: Vec3;
  heading: number;
  moves: Move[];
  /** Plays every clip mirrored left↔right: a left-handed batter, a left-arm bowler (clips are authored right-handed). */
  mirror?: boolean;
  /** The striker only: the physics batter his drawn legs and trunk are put on (core/motion/humansHook.ts). */
  physicsBody?: PhysicsBodyPlan;
  /**
   * A heading that carries on from an earlier motion instead of snapping to the move that follows it: from `t0` (scene ms) the
   * heading is what the moves give plus `delta` (rad, shortest way) fading to nothing over `ms` (a smoothstep). Where a script takes
   * an actor over from what he was doing (the bowler's follow-through handing to his chase, his celebration, his walk): `delta` is
   * the old heading less the new move's at `t0`, so the heading is continuous there and then settles into the new move's own.
   */
  headingFade?: { t0: number; ms: number; delta: number };
}

/**
 * The physics batter (src/physics/bat.ts batterBody, the same pads, torso and head the collisions use) the striker is
 * drawn on, in world space (drawn form: a left-hander already mirrored). Before the input his feet are on the stance
 * pads (a constant offset of the clip's feet, so the trigger keeps its own small step); from the input the feet are
 * carried in the air onto the pads of the stroke the physics played, planted by `plantAt`; the trunk and head lean
 * onto the physics torso top and head over the same window. Presentation only: the root, the bat and the ball are
 * untouched.
 */
export interface PhysicsBodyPlan {
  /** Drawn leg on the front pad (the pad nearer the bowler): L for a right-hander, R for a left-hander. */
  frontLeg: 'L' | 'R';
  /** The stance pads' axes on the ground [front, back] (world). */
  stance: [Vec3, Vec3];
  /** Scene ms of a stance frame both the between-balls and the delivery scripts share (the offset is measured there). */
  stanceRefAt: number;
  /**
   * A delivery: the feet stay on the stance pads through the trigger and the ready hold too. The offset is measured
   * again at `refAt` on the waiting moves alone (`moves`: the same in every script of the delivery, before and after
   * its result), and taken over during the trigger [from, to], while the clip moves the feet a little anyway.
   */
  ready: { moves: Move[]; refAt: number; from: number; to: number } | null;
  /** The stroke the physics played (null: a leave, or no result yet: the stance throughout). */
  stroke: {
    pads: [Vec3, Vec3];
    /** Height (m) at which each drawn shin axis must cross its pad's axis (the ball's height on the pad it hits). */
    hitH: [number, number];
    /** The physics torso's base (the hips go over it) and top, and the head's centre. */
    torsoBase: Vec3;
    torsoTop: Vec3;
    head: Vec3;
    /** The ball's centre when it hits a pad (null: no pad hit). */
    hitBall: Vec3 | null;
    /** The stride: from the input (scene ms) to planted (the physics contact or the ball's arrival, the earlier). */
    strideAt: number;
    plantAt: number;
    /** Scene ms the drawn body is fitted to the physics body (the contact, else the ball's arrival). */
    refAt: number;
    /**
     * The physics pads place the feet (script.ts strideGoverned: a pad or body event, or the ball near the drawn
     * legs). Otherwise the feet go where the stroke clip takes them, the trunk leaning only a little onto the torso.
     */
    governed: boolean;
    /** The stroke is TRACKB's authored overlay (its own feet, planted by its contacts), not the procedural stride. */
    overlay: boolean;
    /** Scene ms the overlay's follow-through begins (its `contact` marker), else null: the planned pelvis is out by then. */
    followAt: number | null;
  } | null;
  /** From this scene ms the fit fades out over `fadeMs` (the stroke's end, or the start of the running). */
  releaseAt: number;
  fadeMs: number;
}

export interface ClipState {
  clip: ClipId;
  time: number;
  lower?: ClipId;
  lowerTime?: number;
}

export interface ActorState {
  pos: Vec3;
  heading: number;
  current: ClipState;
  /** Previous move's clip while crossfading. */
  previous: ClipState | null;
  /** Weight of `current` (1 = fully current). */
  weight: number;
  /** Drawn-rig offset from `pos` (world metres), when the move carries one (a dive's extension); else absent. */
  body?: Vec3;
  /** An inertialized switch in progress (see Move.inertial): what was presented at the switch, and how long ago. */
  inertia?: {
    from: ClipLayer[];
    fromBefore: ClipLayer[];
    to: ClipState;
    toBefore: ClipState;
    /** ms since the switch, and the decay time (ms). */
    tau: number;
    ms: number;
  };
  /**
   * When a move starts while the previous crossfade is still running: every layer of the presented pose, oldest first,
   * each blended over the result so far by its weight (the first's weight is unused). `current` is the last layer.
   * Absent for a plain (two-layer) crossfade.
   */
  stack?: ClipLayer[];
}

interface ClipLayer {
  clip: ClipState;
  weight: number;
}

/** Layers of crossfades still running at t (nested up to `depth` moves back), oldest first. */
function stackAt(moves: readonly Move[], i: number, t: number, clipT: number, depth: number): ClipLayer[] {
  const m = moves[i];
  const state = clipStateAt(m, clipT);
  const blend = m.blend ?? 140;
  if (depth > 0 && i > 0 && blend > 0 && t - m.t0 < blend) {
    const prev = moves[i - 1];
    return [...stackAt(moves, i - 1, t, Math.min(t, prev.t1 + blend), depth - 1), { clip: state, weight: clamp((t - m.t0) / blend, 0, 1) }];
  }
  return [{ clip: state, weight: 1 }];
}

const ZERO_V: Vec3 = { x: 0, y: 0, z: 0 };

function ease(kind: Ease | undefined, u: number): number {
  switch (kind) {
    case 'in':
      return easeIn(u);
    case 'out':
      return easeOut(u);
    case 'inOut':
      return easeInOut(u);
    default:
      return u;
  }
}

/** Progress along a move with end speeds v0, v1 (m/s) over `len` metres in `span` ms: a monotone cubic Hermite. */
function hermiteProgress(u: number, v0: number, v1: number, len: number, span: number): number {
  if (len < 1e-6) return u;
  const k = span / 1000 / len;
  const m0 = Math.max(0, Math.min(3, v0 * k));
  const m1 = Math.max(0, Math.min(3, v1 * k));
  const u2 = u * u;
  const u3 = u2 * u;
  return (u3 - 2 * u2 + u) * m0 + (-2 * u3 + 3 * u2) + (u3 - u2) * m1;
}

/** Ground speed (m/s) on a `speed` move at progress u. */
function hermiteSpeed(u: number, v0: number, v1: number, len: number, span: number): number {
  if (len < 1e-6) return 0;
  const k = span / 1000 / len;
  const m0 = Math.max(0, Math.min(3, v0 * k));
  const m1 = Math.max(0, Math.min(3, v1 * k));
  const d = (3 * u * u - 4 * u + 1) * m0 + (-6 * u * u + 6 * u) + (3 * u * u - 2 * u) * m1;
  return (d * len * 1000) / span;
}

/** Clip seconds advanced on a speed-paced move by `local` scene seconds (Simpson's rule on √(v/ref)). */
function pacedClipTime(m: Move, local: number): number {
  const from = m.from!;
  const to = m.to!;
  const len = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
  const span = Math.max(1, m.t1 - m.t0);
  const ref = m.rateBySpeed!;
  const n = 16;
  const h = local / n;
  let sum = 0;
  for (let i = 0; i <= n; i++) {
    const u = clamp(((i * h) * 1000) / span, 0, 1);
    const ratio = Math.max(0, hermiteSpeed(u, m.speed![0], m.speed![1], len, span)) / ref;
    let f = (m.rateExp ?? 0.5) === 0.5 ? Math.sqrt(ratio) : ratio ** (m.rateExp ?? 0.5);
    if (m.rateClamp) f = clamp(f, m.rateClamp[0], m.rateClamp[1]);
    sum += f * (i === 0 || i === n ? 1 : i % 2 ? 4 : 2);
  }
  return (sum * h) / 3;
}

/** The clip state a move shows at scene time t (its clip time, and its footwork layer's). */
export function clipStateAt(m: Move, t: number): ClipState {
  const local = (t - m.t0) / 1000;
  const rate = m.rate ?? 1;
  const paced = m.rateBySpeed !== undefined && m.speed !== undefined && m.from !== undefined && m.to !== undefined;
  const clock = paced ? pacedClipTime(m, Math.max(0, local)) : local;
  const time = (m.clipStart ?? 0) + clock * rate;
  return m.lower ? { clip: m.clip, time, lower: m.lower, lowerTime: (m.lowerStart ?? 0) + clock * (m.lowerRate ?? rate) } : { clip: m.clip, time };
}

/** Position and heading at the end of move `i` (resolving inherited values). */
function resolveUpTo(track: ActorTrack, i: number): { pos: Vec3; heading: number } {
  let pos = track.start;
  let heading = track.heading;
  for (let k = 0; k <= i && k < track.moves.length; k++) {
    const m = track.moves[k];
    const from = m.from ?? pos;
    const to = m.to ?? from;
    if (m.headingTo !== undefined) heading = m.headingTo;
    else if (m.heading !== undefined) heading = m.heading;
    else if (Math.hypot(to.x - from.x, to.z - from.z) > 0.05) heading = headingOf(to.x - from.x, to.z - from.z);
    pos = to;
  }
  return { pos, heading };
}

export function evaluateActor(track: ActorTrack, t: number): ActorState {
  const moves = track.moves;
  if (moves.length === 0) {
    return { pos: track.start, heading: track.heading, current: { clip: 'idle', time: t / 1000 }, previous: null, weight: 1 };
  }
  let i = 0;
  while (i < moves.length - 1 && t >= moves[i + 1].t0) i++;
  const m = moves[i];
  const before = i > 0 ? resolveUpTo(track, i - 1) : { pos: track.start, heading: track.heading };
  const from = m.from ?? before.pos;
  const to = m.to ?? from;
  const span = Math.max(1, m.t1 - m.t0);
  const u = clamp((t - m.t0) / span, 0, 1);
  const pos = lerpV(from, to, m.speed ? hermiteProgress(u, m.speed[0], m.speed[1], Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z), span) : ease(m.ease, u));
  const moving = Math.hypot(to.x - from.x, to.z - from.z) > 0.05;
  let heading: number;
  const turn = (x: number) => (m.headingEase === 'linear' ? x : easeInOut(x));
  if (m.heading !== undefined && m.headingTo !== undefined) heading = lerpAngle(m.heading, m.headingTo, turn(u));
  else if (m.headingTo !== undefined) heading = lerpAngle(before.heading, m.headingTo, turn(clamp(u * 2.5, 0, 1)));
  else if (m.heading !== undefined) heading = m.heading;
  else if (moving) {
    const target = headingOf(to.x - from.x, to.z - from.z);
    // Turn into the run quickly rather than snapping.
    const turned = clamp((t - m.t0) / (m.turnMs ?? 220), 0, 1);
    heading = Math.abs(angleDelta(before.heading, target)) > 0.01 ? lerpAngle(before.heading, target, m.turnMs === undefined ? turned : m.turnEase === 'smooth' ? turned * turned * (3 - 2 * turned) : easeInOut(turned)) : target;
  } else heading = before.heading;
  if (track.headingFade && t >= track.headingFade.t0) {
    const f = track.headingFade;
    const gone = clamp((t - f.t0) / Math.max(1, f.ms), 0, 1);
    heading += f.delta * (1 - gone * gone * (3 - 2 * gone));
  }

  const current = clipStateAt(m, t);
  const body = m.bodyFrom || m.bodyTo ? lerpV(m.bodyFrom ?? ZERO_V, m.bodyTo ?? ZERO_V, u) : undefined;
  if (i > 0 && m.inertial && t - m.t0 < m.inertial) {
    const dt = 1000 / 60;
    const prev = moves[i - 1];
    const pb = prev.blend ?? 140;
    const inertia = {
      from: stackAt(moves, i - 1, m.t0, Math.min(m.t0, prev.t1 + pb), 2),
      fromBefore: stackAt(moves, i - 1, m.t0 - dt, Math.min(m.t0 - dt, prev.t1 + pb), 2),
      to: clipStateAt(m, m.t0),
      toBefore: clipStateAt(m, m.t0 - dt),
      tau: t - m.t0,
      ms: m.inertial,
    };
    return { pos, heading, current, previous: null, weight: 1, ...(body ? { body } : {}), inertia };
  }
  const blend = m.blend ?? 140;
  if (i > 0 && blend > 0 && t - m.t0 < blend) {
    const prev = moves[i - 1];
    const stack = stackAt(moves, i, t, t, 3);
    return { pos, heading, current, previous: clipStateAt(prev, Math.min(t, prev.t1 + blend)), weight: clamp((t - m.t0) / blend, 0, 1), ...(body ? { body } : {}), ...(stack.length > 2 ? { stack } : {}) };
  }
  return { pos, heading, current, previous: null, weight: 1, ...(body ? { body } : {}) };
}

/**
 * The moves of a track cut at `cut` (scene ms) without changing anything drawn before it: a move still running at
 * `cut` ends there at the position, and (for a `speed` move) the speed, it had reached, so the move that follows can
 * take over from exactly that state.
 */
export function truncateMoves(track: ActorTrack, cut: number): Move[] {
  const out: Move[] = [];
  for (let i = 0; i < track.moves.length; i++) {
    const m = track.moves[i];
    if (m.t0 >= cut) break;
    if (m.t1 <= cut) {
      out.push(m);
      continue;
    }
    const span = Math.max(1, m.t1 - m.t0);
    const before = i > 0 ? resolveUpTo(track, i - 1) : { pos: track.start, heading: track.heading };
    const from = m.from ?? before.pos;
    const to = m.to ?? from;
    const at = evaluateActor(track, cut).pos;
    const moved = Math.hypot(to.x - from.x, to.z - from.z) > 1e-6;
    if (!moved) {
      out.push({ ...m, t1: cut });
      continue;
    }
    const len = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
    const u = clamp((cut - m.t0) / span, 0, 1);
    const cutMove: Move = { ...m, t1: cut, from, to: at };
    if (m.speed) cutMove.speed = [m.speed[0], hermiteSpeed(u, m.speed[0], m.speed[1], len, span)];
    else if (m.ease && m.ease !== 'linear') {
      // Re-express the eased stretch as a Hermite with the same end speeds (eases are not closed under cutting).
      const e = (x: number) => ease(m.ease, x);
      const h = 1e-3;
      const v0 = ((e(h) - e(0)) / h) * (len * 1000) / span;
      const v1 = ((e(u) - e(Math.max(0, u - h))) / h) * (len * 1000) / span;
      cutMove.speed = [v0, v1];
      delete cutMove.ease;
    }
    out.push(cutMove);
  }
  return out;
}
