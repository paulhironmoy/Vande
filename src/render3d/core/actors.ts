/**
 * Actor tracks: what each player does over a ball, as a list of timed moves (clip + root path + heading).
 * Evaluation is a pure function of time so replays can seek and offline rendering can step frames.
 */
import type { ClipId } from './clips';
import { type Vec3, angleDelta, clamp, easeIn, easeInOut, easeOut, headingOf, lerpAngle, lerpV } from './math';

export type ActorRole = 'bowler' | 'batter' | 'keeper' | 'fielder' | 'umpire';
export type Ease = 'linear' | 'in' | 'out' | 'inOut';

export interface Move {
  t0: number;
  t1: number;
  clip: ClipId;
  /** Seconds into the clip at t0 (default 0). */
  clipStart?: number;
  /** Clip seconds per scene second (default 1). */
  rate?: number;
  /** Lower-body layer (footwork) for batters. */
  lower?: ClipId;
  lowerStart?: number;
  from?: Vec3;
  to?: Vec3;
  ease?: Ease;
  /** Heading at t0 (radians). When omitted: travel direction if moving, else the previous heading. */
  heading?: number;
  /** Heading at t1 (turns smoothly during the move). */
  headingTo?: number;
  /** Crossfade from the previous move, ms (default 140). */
  blend?: number;
}

/** Who the actor is (drives the generated look). */
export interface Look {
  seed: string;
  team: 0 | 1;
  /** Wears pads, gloves and a helmet. */
  gear: 'batter' | 'keeper' | 'fielder' | 'bowler' | 'umpire';
  hero?: boolean;
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
}

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

function clipStateAt(m: Move, t: number): ClipState {
  const local = (t - m.t0) / 1000;
  const rate = m.rate ?? 1;
  const time = (m.clipStart ?? 0) + local * rate;
  return m.lower ? { clip: m.clip, time, lower: m.lower, lowerTime: (m.lowerStart ?? 0) + local * rate } : { clip: m.clip, time };
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
  const pos = lerpV(from, to, ease(m.ease, u));
  const moving = Math.hypot(to.x - from.x, to.z - from.z) > 0.05;
  let heading: number;
  if (m.heading !== undefined && m.headingTo !== undefined) heading = lerpAngle(m.heading, m.headingTo, easeInOut(u));
  else if (m.headingTo !== undefined) heading = lerpAngle(before.heading, m.headingTo, easeInOut(clamp(u * 2.5, 0, 1)));
  else if (m.heading !== undefined) heading = m.heading;
  else if (moving) {
    const target = headingOf(to.x - from.x, to.z - from.z);
    // Turn into the run quickly rather than snapping.
    heading = Math.abs(angleDelta(before.heading, target)) > 0.01 ? lerpAngle(before.heading, target, clamp((t - m.t0) / 220, 0, 1)) : target;
  } else heading = before.heading;

  const current = clipStateAt(m, t);
  const blend = m.blend ?? 140;
  if (i > 0 && blend > 0 && t - m.t0 < blend) {
    const prev = moves[i - 1];
    return { pos, heading, current, previous: clipStateAt(prev, Math.min(t, prev.t1 + blend)), weight: clamp((t - m.t0) / blend, 0, 1) };
  }
  return { pos, heading, current, previous: null, weight: 1 };
}

/** Appends a move that starts where the track currently ends. */
export function push(track: ActorTrack, move: Move): Move {
  track.moves.push(move);
  return move;
}
