/**
 * Deterministic fielding for Practice: who goes for the ball, whether a chance is caught (or dropped), where the ball
 * is stopped or collected, the throw, and the moment it is back at the stumps. Pure arithmetic over the post-contact
 * trajectory sampled by the one ball integrator (ball.ts); no randomness at all, so the same trajectory and field give
 * the same play every time. The model is documented in docs/PRACTICE_RULES.md, "Fielding model".
 *
 * Kinematics: each fielder reacts (`reactionS` after the ball leaves the bat), then runs in a straight line,
 * accelerating at `accel` up to `topSpeed`. A fielder can take a ball at time t if the ground distance to it, less his
 * reach, is no more than the distance he can run by t. Reach is larger with a dive (lower balls only).
 *  - Catch: the ball is still in the air (before its first bounce after the bat), inside the rope, at a catchable
 *    height. The earliest fielder who can get there takes it; a fielder who can catch it on his feet within a moment of
 *    a team-mate's dive takes it instead (the easier catch is called).
 *  - Drop rule (honest, deterministic): a catch is put down when the ball arrives faster than the fielder can hold
 *    (`holdSpeed` standing, `holdDiveSpeed` diving), needs a dive beyond `holdDiveStretch` of his extra dive reach,
 *    gives him less than `SIGHT_S` to see it after his reaction (keeper and close catchers excepted: they are set for
 *    it), or is a fast ball below `LOW_CATCH_H` (keeper excepted). A dropped ball falls at the fielder's feet and he
 *    picks it up after recovering.
 *  - Ground fielding: after the first bounce, the earliest fielder to reach the ball's path stops it (diving for low
 *    balls further away); a ball that comes to rest is collected by whoever gets there first; a ball nobody reaches
 *    before the rope is a boundary.
 *  - Return: after the pickup the ball goes to whichever set of stumps it reaches first with someone there to take it
 *    (the keeper at the striker's end, the bowler at his own end; a keeper or bowler who fields it can run it in).
 */
import type { BallSample, FieldLayout, Fielder, FielderAction, FielderPath, FielderRole, SimEvent, Vec3 } from '@/contracts/practice';
import { BALL_R, BOUNDARY_R, G, PITCH_HALF } from './constants';
import { distanceFromStriker } from './field';

// ---------------------------------------------------------------------------------------------------------------
// Fielder athletics
// ---------------------------------------------------------------------------------------------------------------

export type FielderClass = 'keeper' | 'bowler' | 'close' | 'ring' | 'deep';

export interface Athletics {
  /** Seconds from the ball leaving the bat to the first step. */
  reactionS: number;
  /** Run: acceleration (m/s²) up to a top speed (m/s). */
  accel: number;
  topSpeed: number;
  /** Catching reach (m, ground distance from the body to the ball) on his feet and at full stretch in a dive. */
  catchReachM: number;
  catchDiveReachM: number;
  /** Highest ball (centre height, m) caught on his feet (arms up, a small jump) and in a dive. */
  catchMaxH: number;
  catchDiveMaxH: number;
  /** Ground fielding reach on his feet and diving (m), and the highest bouncing ball stopped on his feet (m). */
  stopReachM: number;
  stopDiveReachM: number;
  stopMaxH: number;
  /** Drop rule: fastest ball held (m/s at the hands) on his feet and diving; furthest dive held (0..1 of the extra reach). */
  holdSpeed: number;
  holdDiveSpeed: number;
  holdDiveStretch: number;
  /** Average horizontal speed of his throw (m/s). */
  throwSpeed: number;
}

/**
 * Per class of fielder. Ring and deep fielders sprint at club-to-professional speeds (7.5–8 m/s top, ~5.5 m/s²);
 * close catchers react fastest but barely move; the keeper has the biggest reach (gloves) and the safest hands; the
 * bowler is off balance in his follow-through. Deep fielders read the ball later but run and throw furthest.
 */
export const ATHLETICS: Readonly<Record<FielderClass, Athletics>> = {
  keeper: { reactionS: 0.15, accel: 6, topSpeed: 6.5, catchReachM: 1.1, catchDiveReachM: 2.6, catchMaxH: 2.4, catchDiveMaxH: 1.8, stopReachM: 0.9, stopDiveReachM: 2.3, stopMaxH: 2.2, holdSpeed: 40, holdDiveSpeed: 34, holdDiveStretch: 0.8, throwSpeed: 18 },
  bowler: { reactionS: 0.3, accel: 4.5, topSpeed: 7, catchReachM: 0.9, catchDiveReachM: 2.1, catchMaxH: 2.4, catchDiveMaxH: 1.5, stopReachM: 0.75, stopDiveReachM: 1.8, stopMaxH: 2, holdSpeed: 32, holdDiveSpeed: 26, holdDiveStretch: 0.6, throwSpeed: 22 },
  close: { reactionS: 0.18, accel: 5, topSpeed: 6.5, catchReachM: 0.95, catchDiveReachM: 2.3, catchMaxH: 2.3, catchDiveMaxH: 1.6, stopReachM: 0.75, stopDiveReachM: 1.9, stopMaxH: 2, holdSpeed: 37, holdDiveSpeed: 31, holdDiveStretch: 0.7, throwSpeed: 20 },
  ring: { reactionS: 0.28, accel: 5.5, topSpeed: 7.5, catchReachM: 0.95, catchDiveReachM: 2.3, catchMaxH: 2.5, catchDiveMaxH: 1.6, stopReachM: 0.75, stopDiveReachM: 1.9, stopMaxH: 2, holdSpeed: 33, holdDiveSpeed: 26, holdDiveStretch: 0.65, throwSpeed: 25 },
  deep: { reactionS: 0.32, accel: 5.5, topSpeed: 8, catchReachM: 1, catchDiveReachM: 2.4, catchMaxH: 2.6, catchDiveMaxH: 1.6, stopReachM: 0.8, stopDiveReachM: 2, stopMaxH: 2, holdSpeed: 30, holdDiveSpeed: 24, holdDiveStretch: 0.65, throwSpeed: 27 },
};

const CLOSE_ROLES: ReadonlySet<FielderRole> = new Set<FielderRole>(['slip', 'gully', 'leg_slip', 'short_leg', 'silly_point']);
/** Beyond this distance from the striker is "the deep": fielders standing there are boundary riders, and a catch taken there is a catch in the deep. */
export const DEEP_FROM_M = 38;

export function fielderClass(f: Fielder): FielderClass {
  if (f.role === 'keeper') return 'keeper';
  if (f.role === 'bowler') return 'bowler';
  if (CLOSE_ROLES.has(f.role)) return 'close';
  return distanceFromStriker(f.x, f.z) > DEEP_FROM_M ? 'deep' : 'ring';
}

export const athleticsOf = (f: Fielder): Athletics => ATHLETICS[fielderClass(f)];

/** Ground distance a fielder can cover in `elapsed` seconds after the ball leaves the bat. */
export function coverable(a: Athletics, elapsed: number): number {
  const t = elapsed - a.reactionS;
  if (t <= 0) return 0;
  const tAcc = a.topSpeed / a.accel;
  if (t <= tAcc) return 0.5 * a.accel * t * t;
  return 0.5 * a.accel * tAcc * tAcc + a.topSpeed * (t - tAcc);
}

/** Seconds (after the ball leaves the bat) a fielder needs to run `d` metres; 0 when he need not move. */
export function timeToCover(a: Athletics, d: number, withReaction = true): number {
  if (d <= 0) return 0;
  const r = withReaction ? a.reactionS : 0;
  const dAcc = (a.topSpeed * a.topSpeed) / (2 * a.accel);
  if (d <= dAcc) return r + Math.sqrt((2 * d) / a.accel);
  return r + a.topSpeed / a.accel + (d - dAcc) / a.topSpeed;
}

/** Distance run `tau` seconds after starting from standing (no reaction). */
function runDistance(a: Athletics, tau: number): number {
  if (tau <= 0) return 0;
  const tAcc = a.topSpeed / a.accel;
  if (tau <= tAcc) return 0.5 * a.accel * tau * tau;
  return 0.5 * a.accel * tAcc * tAcc + a.topSpeed * (tau - tAcc);
}

// ---------------------------------------------------------------------------------------------------------------
// Rules of the model
// ---------------------------------------------------------------------------------------------------------------

/** Lowest ball (centre height, m) caught on the feet and in a dive: below that it is effectively a half-volley. */
export const CATCH_MIN_H = 0.12;
export const DIVE_CATCH_MIN_H = 0.08;
/** Highest ball stopped with a dive (m). */
export const STOP_DIVE_MAX_H = 0.7;
/** A catch or stop is only taken with the fielder inside the rope (m from it). */
export const ROPE_MARGIN_M = 0.3;
/** A catch needs at least this long between the fielder's reaction and the ball arriving (s), unless he is the keeper or a close catcher. */
export const SIGHT_S = 0.12;
/** A ball below this height (m) arriving faster than LOW_HOLD_SPEED (m/s) is put down by anyone but the keeper. */
export const LOW_CATCH_H = 0.3;
export const LOW_HOLD_SPEED = 22;
/** A fielder who can take it on his feet within this long of a team-mate's dive takes it instead (s). */
export const CALL_FOR_IT_S = 0.35;
/** A fielder prefers to stop the ball on his feet rather than dive if it costs him no more than this (s). */
export const STAY_ON_FEET_S = 0.25;
/** Ball in hand and ready to throw after: a clean stop, a diving stop (get up), collecting a ball at rest, a drop. */
export const PICKUP_S = { stop: 0.55, dive_stop: 1.1, collect: 0.7, dropped: 0.9, dropped_dive: 1.4 } as const;
/** The keeper or bowler needs this long at the stumps before he can take a throw (s). */
export const RECEIVER_SET_S = 0.2;
/** Hand heights for the in-hand ball and the throw (m). */
const HAND_H = 0.9;
const THROW_RELEASE_H = 1.9;
const THROW_TAKE_H = 0.8;
/** Path sample spacing for rendering (s). */
export const PATH_DT = 0.1;

export const STRIKER_STUMPS = { x: 0, z: PITCH_HALF } as const;
export const BOWLER_STUMPS = { x: 0, z: -PITCH_HALF } as const;

// ---------------------------------------------------------------------------------------------------------------
// Inputs and outputs
// ---------------------------------------------------------------------------------------------------------------

/** The ball after it leaves the bat, as integrated by ball.ts. */
export interface PostContactBall {
  /** Time the ball left the bat (s after release): the fielders react from here. */
  t0: number;
  /** Samples from t0 (fixed step) until the ball comes to rest or reaches the rope. */
  samples: BallSample[];
  /** Ground contacts after the bat, in time order (the first one ends any chance of a catch). */
  bounces: Array<{ t: number; p: Vec3 }>;
  /** The rope crossing, if the ball gets there; `onFull` when it had not touched the ground. */
  boundary: { t: number; p: Vec3; onFull: boolean } | null;
}

export type GatherKind = 'stop' | 'dive_stop' | 'collect' | 'dropped';

export type FieldingPlay =
  | { kind: 'caught'; fielderId: string; t: number; p: Vec3; dive: boolean; speed: number }
  | { kind: 'boundary'; runs: 4 | 6; t: number; p: Vec3 }
  | {
      kind: 'fielded';
      fielderId: string;
      how: GatherKind;
      /** When and where the fielder reached the ball (for a drop: where the chance went down). */
      t: number;
      p: Vec3;
      dive: boolean;
      /** How far the fielder had to run to get there (m). */
      movedM: number;
      /** For a drop: why it went down, how fast the ball was (m/s) and how far the dive stretched (0..1). */
      drop: { reason: DropReason; speed: number; stretch: number } | null;
      releaseT: number;
      /** Ball back at the stumps with someone there to take it: the batters' running is judged against this. */
      returnT: number;
      end: 'striker' | 'bowler';
    };

export interface FieldingResult {
  play: FieldingPlay;
  /** For a ball that beat the field: the fielder who came closest and by how much he fell short (m). */
  nearest: { fielderId: string; shortfallM: number } | null;
  paths: FielderPath[];
  /** The ball from contact until it is dead (in-hand and throw segments included). */
  ball: BallSample[];
  /** ball_bounce, catch, field, throw and boundary events (running and dead are added by the scoring). */
  events: SimEvent[];
  deadT: number;
}

interface Chance {
  fielder: Fielder;
  a: Athletics;
  k: number;
  t: number;
  p: Vec3;
  dive: boolean;
  /** Ground distance from the fielder's start to the ball (m). */
  dist: number;
  /** Reach used on his feet (0 for a dive: he runs as far as he can and the dive covers the rest). */
  reach: number;
  /** For a dive: how far into the extra dive reach (0..1). */
  stretch: number;
  speed: number;
  /** Seconds between the end of the fielder's reaction and the ball reaching him. */
  sightS: number;
}

// ---------------------------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------------------------

// Plain square roots only (Math.hypot is not guaranteed to round identically on every engine).
const speedOf = (v: Vec3) => Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
const INSIDE_R2 = (BOUNDARY_R - ROPE_MARGIN_M) * (BOUNDARY_R - ROPE_MARGIN_M);
const insideRope = (p: Vec3) => p.x * p.x + p.z * p.z <= INSIDE_R2;
const groundDist = (f: { x: number; z: number }, p: { x: number; z: number }) => {
  const dx = p.x - f.x;
  const dz = p.z - f.z;
  return Math.sqrt(dx * dx + dz * dz);
};

/** Ground contacts in a sampled trajectory (the ball's vertical velocity turns upwards at ground level). */
export function detectBounces(samples: BallSample[]): Array<{ t: number; p: Vec3 }> {
  const out: Array<{ t: number; p: Vec3 }> = [];
  for (let k = 1; k < samples.length; k++) {
    const a = samples[k - 1];
    const b = samples[k];
    if (a.v.y < 0 && b.v.y >= 0 && b.p.y <= BALL_R + 0.05) out.push({ t: b.t, p: b.p });
  }
  return out;
}

function firstCatch(f: Fielder, a: Athletics, ball: PostContactBall, tBounce: number): Chance | null {
  const s = ball.samples;
  // The dive he would choose: where the ball is least stretched for (he runs as far as he can first).
  let dive: Chance | null = null;
  for (let k = 1; k < s.length; k++) {
    const b = s[k];
    if (b.t >= tBounce - 1e-9) break;
    if (!insideRope(b.p)) break;
    const elapsed = b.t - ball.t0;
    const cover = coverable(a, elapsed);
    const dist = groundDist(f, b.p);
    const y = b.p.y;
    if (y >= CATCH_MIN_H && y <= a.catchMaxH && dist <= a.catchReachM + cover) {
      const standing: Chance = { fielder: f, a, k, t: b.t, p: b.p, dive: false, dist, reach: a.catchReachM, stretch: 0, speed: speedOf(b.v), sightS: elapsed - a.reactionS };
      return dive && dive.t + CALL_FOR_IT_S < standing.t ? dive : standing;
    }
    if (elapsed >= a.reactionS && y >= DIVE_CATCH_MIN_H && y <= a.catchDiveMaxH && dist <= a.catchDiveReachM + cover) {
      const stretch = Math.min(1, Math.max(0, (dist - cover - a.catchReachM) / (a.catchDiveReachM - a.catchReachM)));
      if (!dive || stretch < dive.stretch - 1e-9) dive = { fielder: f, a, k, t: b.t, p: b.p, dive: true, dist, reach: 0, stretch, speed: speedOf(b.v), sightS: elapsed - a.reactionS };
    }
  }
  return dive;
}

function firstStop(f: Fielder, a: Athletics, ball: PostContactBall, tFrom: number): Chance | null {
  const s = ball.samples;
  let dive: Chance | null = null;
  for (let k = 1; k < s.length; k++) {
    const b = s[k];
    if (b.t < tFrom - 1e-9) continue;
    if (!insideRope(b.p)) break;
    const elapsed = b.t - ball.t0;
    const cover = coverable(a, elapsed);
    const dist = groundDist(f, b.p);
    const y = b.p.y;
    if (y <= a.stopMaxH && dist <= a.stopReachM + cover) {
      const standing: Chance = { fielder: f, a, k, t: b.t, p: b.p, dive: false, dist, reach: a.stopReachM, stretch: 0, speed: speedOf(b.v), sightS: elapsed - a.reactionS };
      return dive && dive.t + STAY_ON_FEET_S < standing.t ? dive : standing;
    }
    if (!dive && elapsed >= a.reactionS && y <= STOP_DIVE_MAX_H && dist <= a.stopDiveReachM + cover) {
      const stretch = (dist - cover - a.stopReachM) / (a.stopDiveReachM - a.stopReachM);
      dive = { fielder: f, a, k, t: b.t, p: b.p, dive: true, dist, reach: 0, stretch: Math.min(1, Math.max(0, stretch)), speed: speedOf(b.v), sightS: elapsed - a.reactionS };
    }
  }
  return dive;
}

/**
 * The ball at rest (or at the end of the integration) if it never reached the rope. It may lie right by the rope: the
 * fielder collects it from inside.
 */
function restingBall(ball: PostContactBall): BallSample | null {
  if (ball.boundary) return null;
  return ball.samples[ball.samples.length - 1] ?? null;
}

/**
 * When the struck ball first touched the ground: its first bounce, or the first moment it is rolling along the grass
 * (a ball squeezed out along the ground may never "bounce"). Before this it can be caught; from it on it cannot.
 */
export function firstGroundT(ball: PostContactBall): number {
  let t = ball.bounces.length ? ball.bounces[0].t : Infinity;
  for (const s of ball.samples) {
    if (s.t >= t) break;
    if (s.p.y <= BALL_R + 1e-6 && s.v.y <= 1e-9 && s.v.y > -0.6) {
      t = s.t;
      break;
    }
  }
  return t;
}

function collect(f: Fielder, a: Athletics, ball: PostContactBall, rest: BallSample): Chance {
  const dist = groundDist(f, rest.p);
  const t = Math.max(rest.t, ball.t0 + timeToCover(a, dist - a.stopReachM));
  return { fielder: f, a, k: ball.samples.length - 1, t, p: rest.p, dive: false, dist, reach: a.stopReachM, stretch: 0, speed: 0, sightS: t - ball.t0 - a.reactionS };
}

const earliest = (cs: Array<Chance | null>): Chance | null =>
  cs.reduce<Chance | null>((best, c) => (c && (!best || c.t < best.t - 1e-12) ? c : best), null);

/** Why a chance went down, or null when it is held (the drop rule above). */
export type DropReason = 'too_fast' | 'full_stretch' | 'no_time' | 'low_and_fast';

export function dropReason(cls: FielderClass, a: Athletics, c: { dive: boolean; speed: number; stretch: number; sightS: number; p: Vec3 }): DropReason | null {
  if (c.speed > (c.dive ? a.holdDiveSpeed : a.holdSpeed)) return 'too_fast';
  if (c.dive && c.stretch > a.holdDiveStretch) return 'full_stretch';
  if (cls !== 'keeper' && cls !== 'close' && c.sightS < SIGHT_S) return 'no_time';
  if (cls !== 'keeper' && c.p.y < LOW_CATCH_H && c.speed > LOW_HOLD_SPEED) return 'low_and_fast';
  return null;
}

/** Where the fielder's body is when he takes the ball: as far towards it as he needed to run. */
function bodyAt(c: Chance, elapsed: number): { x: number; z: number } {
  const need = Math.max(0, c.dist - c.reach);
  const run = Math.min(need, coverable(c.a, elapsed));
  if (c.dist < 1e-9) return { x: c.fielder.x, z: c.fielder.z };
  const ux = (c.p.x - c.fielder.x) / c.dist;
  const uz = (c.p.z - c.fielder.z) / c.dist;
  return { x: c.fielder.x + ux * run, z: c.fielder.z + uz * run };
}

// ---------------------------------------------------------------------------------------------------------------
// The return to the stumps
// ---------------------------------------------------------------------------------------------------------------

interface Return {
  releaseT: number;
  returnT: number;
  end: 'striker' | 'bowler';
  from: { x: number; z: number };
  to: { x: number; z: number };
  carried: boolean;
}

function receiverReadyT(field: FieldLayout, role: 'keeper' | 'bowler', stumps: { x: number; z: number }, t0: number): number {
  const r = field.fielders.find((f) => f.role === role);
  if (!r) return Infinity;
  const a = athleticsOf(r);
  const d = Math.max(0, groundDist(r, stumps) - 0.6);
  return t0 + timeToCover(a, d) + RECEIVER_SET_S;
}

function planReturn(field: FieldLayout, fielder: Fielder, a: Athletics, at: { x: number; z: number }, readyT: number, t0: number): Return {
  const options: Return[] = [];
  for (const end of ['striker', 'bowler'] as const) {
    const stumps = end === 'striker' ? STRIKER_STUMPS : BOWLER_STUMPS;
    const receiver = end === 'striker' ? 'keeper' : 'bowler';
    const d = groundDist(at, stumps);
    if (fielder.role === receiver) {
      // He runs it in himself (or is already there).
      const run = timeToCover(a, Math.max(0, d - 0.6), false);
      options.push({ releaseT: readyT, returnT: readyT + run, end, from: at, to: stumps, carried: true });
      continue;
    }
    const flightT = d / a.throwSpeed + 0.1;
    const ready = receiverReadyT(field, receiver, stumps, t0);
    const releaseT = Math.max(readyT, ready - flightT);
    options.push({ releaseT, returnT: releaseT + flightT, end, from: at, to: stumps, carried: false });
  }
  return options[0].returnT <= options[1].returnT ? options[0] : options[1];
}

// ---------------------------------------------------------------------------------------------------------------
// Paths for rendering
// ---------------------------------------------------------------------------------------------------------------

type PathSample = FielderPath['samples'][number];

class PathBuilder {
  readonly samples: PathSample[] = [];
  readonly fielder: Fielder;
  constructor(fielder: Fielder) {
    this.fielder = fielder;
    this.samples.push({ t: 0, x: fielder.x, z: fielder.z, action: 'set' });
  }
  get last(): PathSample {
    return this.samples[this.samples.length - 1];
  }
  at(t: number, x: number, z: number, action: FielderAction): this {
    // Times stay exact so an action lands on the same instant as its event (catch, field, throw); positions to the mm.
    const r = (v: number) => Math.round(v * 1000) / 1000;
    const s = { t, x: r(x), z: r(z), action };
    const l = this.last;
    if (s.t < l.t) s.t = l.t;
    if (s.t === l.t && l.t > 0) this.samples[this.samples.length - 1] = s;
    else this.samples.push(s);
    return this;
  }
  /** Run from where he stands towards (x, z), starting at tStart from standing, until he arrives or tEnd. */
  runTo(a: Athletics, tStart: number, tEnd: number, x: number, z: number): number {
    const from = { x: this.last.x, z: this.last.z };
    const d = groundDist(from, { x, z });
    if (d < 0.05 || tEnd <= tStart) return tStart;
    const arrive = tStart + timeToCover(a, d, false);
    const stop = Math.min(arrive, tEnd);
    this.at(tStart, from.x, from.z, 'set');
    for (let t = tStart + PATH_DT; t < stop - 1e-9; t += PATH_DT) {
      const s = runDistance(a, t - tStart) / d;
      this.at(t, from.x + (x - from.x) * s, from.z + (z - from.z) * s, 'run');
    }
    const s = Math.min(1, runDistance(a, stop - tStart) / d);
    this.at(stop, from.x + (x - from.x) * s, from.z + (z - from.z) * s, 'run');
    return stop;
  }
  build(): FielderPath {
    return { fielderId: this.fielder.id, samples: this.samples };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Ball tails: in hand, dropped, thrown
// ---------------------------------------------------------------------------------------------------------------

const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const ZERO: Vec3 = v3(0, 0, 0);

function stepOf(samples: BallSample[]): number {
  if (samples.length >= 2) {
    const dt = samples[1].t - samples[0].t;
    if (dt > 0) return Math.max(dt, 1 / 240);
  }
  return 1 / 120;
}

/** The ball lying still where it stopped, until a fielder reaches it. */
function restSegment(out: BallSample[], from: number, to: number, p: Vec3, dt: number): void {
  for (let t = from; t < to - 1e-9; t += dt) out.push({ t, p: v3(p.x, BALL_R, p.z), v: ZERO });
}

function holdSegment(out: BallSample[], from: number, to: number, x: number, z: number, dt: number): void {
  for (let t = from; t < to - 1e-9; t += dt) out.push({ t, p: v3(x, HAND_H, z), v: ZERO });
}

/** A ball parried at height y that drops at the fielder's feet and stays there. */
function dropSegment(out: BallSample[], from: number, to: number, p: Vec3, dt: number): void {
  const fallT = Math.sqrt((2 * Math.max(0, p.y - BALL_R)) / G);
  for (let t = from; t < to - 1e-9; t += dt) {
    const tau = t - from;
    if (tau < fallT) out.push({ t, p: v3(p.x, p.y - 0.5 * G * tau * tau, p.z), v: v3(0, -G * tau, 0) });
    else out.push({ t, p: v3(p.x, BALL_R, p.z), v: ZERO });
  }
}

/** A throw from `from` (release height) to the stumps, as a ballistic arc arriving at returnT. */
function throwSegment(out: BallSample[], r: Return, dt: number): void {
  const T = r.returnT - r.releaseT;
  if (T <= 1e-6) {
    out.push({ t: r.returnT, p: v3(r.to.x, THROW_TAKE_H, r.to.z), v: ZERO });
    return;
  }
  if (r.carried) {
    // Run in with the ball in hand.
    const vx = (r.to.x - r.from.x) / T;
    const vz = (r.to.z - r.from.z) / T;
    for (let t = r.releaseT; t < r.returnT - 1e-9; t += dt) {
      const tau = t - r.releaseT;
      out.push({ t, p: v3(r.from.x + vx * tau, HAND_H, r.from.z + vz * tau), v: v3(vx, 0, vz) });
    }
    out.push({ t: r.returnT, p: v3(r.to.x, HAND_H, r.to.z), v: ZERO });
    return;
  }
  const vx = (r.to.x - r.from.x) / T;
  const vz = (r.to.z - r.from.z) / T;
  const vy0 = (THROW_TAKE_H - THROW_RELEASE_H + 0.5 * G * T * T) / T;
  for (let t = r.releaseT; t < r.returnT - 1e-9; t += dt) {
    const tau = t - r.releaseT;
    out.push({ t, p: v3(r.from.x + vx * tau, THROW_RELEASE_H + vy0 * tau - 0.5 * G * tau * tau, r.from.z + vz * tau), v: v3(vx, vy0 - G * tau, vz) });
  }
  out.push({ t: r.returnT, p: v3(r.to.x, THROW_TAKE_H, r.to.z), v: v3(vx, vy0 - G * T, vz) });
}

// ---------------------------------------------------------------------------------------------------------------
// The play
// ---------------------------------------------------------------------------------------------------------------

/** Who comes closest to a ball that beats everyone (for "found the gap" versus "beat the field"). */
function nearestMiss(field: FieldLayout, ball: PostContactBall, tBounce: number, until: number): { fielderId: string; shortfallM: number } | null {
  let best: { fielderId: string; shortfallM: number } | null = null;
  for (const f of field.fielders) {
    const a = athleticsOf(f);
    let worstOk = Infinity;
    for (let k = 1; k < ball.samples.length; k++) {
      const b = ball.samples[k];
      if (b.t > until) break;
      if (!insideRope(b.p)) break;
      const airborne = b.t < tBounce;
      const maxH = airborne ? a.catchMaxH : a.stopMaxH;
      if (b.p.y > maxH) continue;
      const reach = airborne ? (b.p.y <= a.catchDiveMaxH ? a.catchDiveReachM : a.catchReachM) : b.p.y <= STOP_DIVE_MAX_H ? a.stopDiveReachM : a.stopReachM;
      const short = groundDist(f, b.p) - reach - coverable(a, b.t - ball.t0);
      if (short < worstOk) worstOk = short;
    }
    if (Number.isFinite(worstOk) && (!best || worstOk < best.shortfallM)) best = { fielderId: f.id, shortfallM: Math.max(0, worstOk) };
  }
  return best;
}

/**
 * Field one struck ball. `ball` is the post-contact trajectory from the integrator (until rest or the rope).
 * Deterministic: a pure function of the field and the trajectory.
 */
export function simulateFielding(field: FieldLayout, ball: PostContactBall): FieldingResult {
  const t0 = ball.t0;
  const dt = stepOf(ball.samples);
  const tBounce = firstGroundT(ball);
  const fielders = field.fielders;
  const ath = new Map(fielders.map((f) => [f.id, athleticsOf(f)] as const));
  const events: SimEvent[] = [];
  const bouncesBefore = (t: number) => {
    for (const b of ball.bounces) if (b.t < t - 1e-9) events.push({ t: b.t, kind: 'ball_bounce', p: b.p });
  };

  // 1. A catch: the earliest fielder who can take it before it bounces; an easier catch on the feet is called.
  const catches = fielders.map((f) => firstCatch(f, ath.get(f.id)!, ball, tBounce)).filter((c): c is Chance => c !== null);
  let chance = earliest(catches);
  if (chance && chance.dive) {
    const standing = earliest(catches.filter((c) => !c.dive && c.t <= chance!.t + CALL_FOR_IT_S));
    if (standing) chance = standing;
  }
  const dropped = chance ? dropReason(fielderClass(chance.fielder), chance.a, chance) : null;
  if (chance && dropped === null) {
    const c = chance;
    bouncesBefore(c.t);
    events.push({ t: c.t, kind: 'catch', fielderId: c.fielder.id, p: c.p });
    const deadT = c.t;
    const tail = ball.samples.slice(0, c.k + 1);
    const paths = buildPaths(field, ath, t0, deadT + 1, {
      primary: { chance: c, action: 'catch', after: 'celebrate' },
      celebrate: true,
    });
    return { play: { kind: 'caught', fielderId: c.fielder.id, t: c.t, p: c.p, dive: c.dive, speed: c.speed }, nearest: null, paths, ball: tail, events, deadT };
  }

  // 2. A dropped chance, or the ball on the ground: the earliest fielder to stop or collect it.
  let gather: { c: Chance; how: GatherKind } | null = null;
  if (chance) gather = { c: chance, how: 'dropped' };
  else {
    const rest = restingBall(ball);
    const options: Array<{ c: Chance; how: GatherKind }> = [];
    for (const f of fielders) {
      const a = ath.get(f.id)!;
      const s = Number.isFinite(tBounce) ? firstStop(f, a, ball, tBounce) : null;
      if (s) options.push({ c: s, how: s.dive ? 'dive_stop' : 'stop' });
      else if (rest) options.push({ c: collect(f, a, ball, rest), how: 'collect' });
    }
    for (const o of options) if (!gather || o.c.t < gather.c.t - 1e-12) gather = o;
  }

  if (!gather) {
    // 3. Nobody gets there: the ball reaches the rope.
    const bd = ball.boundary;
    const last = ball.samples[ball.samples.length - 1];
    const crossing = bd ?? { t: last.t, p: last.p, onFull: !Number.isFinite(tBounce) };
    // Six only if it never touched the ground before the rope (bounced or rolled).
    const runs: 4 | 6 = crossing.onFull && !(tBounce < crossing.t) ? 6 : 4;
    bouncesBefore(crossing.t);
    events.push({ t: crossing.t, kind: 'boundary', runs, p: crossing.p });
    const tail = ball.samples.filter((b) => b.t <= crossing.t + 1e-9);
    const nearest = nearestMiss(field, ball, tBounce, crossing.t);
    const paths = buildPaths(field, ath, t0, crossing.t + 1, { chase: { toward: crossing.p, until: crossing.t, nearest } });
    return { play: { kind: 'boundary', runs, t: crossing.t, p: crossing.p }, nearest, paths, ball: tail, events, deadT: crossing.t };
  }

  const { c, how } = gather;
  const body = bodyAt(c, c.t - t0);
  const movedM = groundDist(c.fielder, body);
  const pickupS = how === 'dropped' ? (c.dive ? PICKUP_S.dropped_dive : PICKUP_S.dropped) : PICKUP_S[how];
  const readyT = c.t + pickupS;
  const ret = planReturn(field, c.fielder, c.a, body, readyT, t0);
  bouncesBefore(c.t);
  events.push({ t: c.t, kind: 'field', fielderId: c.fielder.id, p: c.p });
  if (!ret.carried) events.push({ t: ret.releaseT, kind: 'throw', fielderId: c.fielder.id, p: v3(body.x, THROW_RELEASE_H, body.z) });

  const tail = ball.samples.slice(0, c.k + 1);
  const restEnd = tail[tail.length - 1];
  if (how === 'collect' && restEnd.t < c.t - 1e-9) restSegment(tail, restEnd.t + dt, c.t + 1e-9, restEnd.p, dt);
  if (how === 'dropped') {
    dropSegment(tail, c.t + dt, readyT, c.p, dt);
    holdSegment(tail, readyT, ret.releaseT, body.x, body.z, dt);
  } else holdSegment(tail, c.t + dt, ret.releaseT, body.x, body.z, dt);
  throwSegment(tail, ret, dt);

  const paths = buildPaths(field, ath, t0, ret.returnT + 0.6, {
    primary: { chance: c, action: how === 'dropped' ? 'drop' : 'pickup', after: 'idle', readyT, ret },
    receivers: ret,
  });
  const drop = how === 'dropped' && dropped ? { reason: dropped, speed: c.speed, stretch: c.stretch } : null;
  return {
    play: { kind: 'fielded', fielderId: c.fielder.id, how, t: c.t, p: c.p, dive: c.dive, movedM, drop, releaseT: ret.releaseT, returnT: ret.returnT, end: ret.end },
    nearest: null,
    paths,
    ball: tail,
    events,
    deadT: ret.returnT,
  };
}

interface PathPlan {
  primary?: { chance: Chance; action: FielderAction; after: FielderAction; readyT?: number; ret?: Return };
  receivers?: Return;
  chase?: { toward: Vec3; until: number; nearest: { fielderId: string; shortfallM: number } | null };
  celebrate?: boolean;
}

function buildPaths(field: FieldLayout, ath: Map<string, Athletics>, t0: number, endT: number, plan: PathPlan): FielderPath[] {
  const out: FielderPath[] = [];
  const primaryId = plan.primary?.chance.fielder.id ?? null;
  // The next quickest fielder backs up the primary one (runs to just beyond where the ball is taken).
  let backupId: string | null = null;
  if (plan.primary && plan.primary.action !== 'catch') {
    const p = plan.primary.chance.p;
    let best = Infinity;
    for (const f of field.fielders) {
      if (f.id === primaryId || f.role === 'keeper' || f.role === 'bowler') continue;
      const t = timeToCover(ath.get(f.id)!, groundDist(f, p));
      if (t < best) {
        best = t;
        backupId = f.id;
      }
    }
  }
  const chasers = new Set<string>();
  if (plan.chase) {
    const ranked = field.fielders
      .filter((f) => f.role !== 'keeper' && f.role !== 'bowler')
      .map((f) => ({ f, d: groundDist(f, plan.chase!.toward) }))
      .sort((a, b) => a.d - b.d || (a.f.id < b.f.id ? -1 : 1));
    for (const r of ranked.slice(0, 2)) chasers.add(r.f.id);
    if (plan.chase.nearest) chasers.add(plan.chase.nearest.fielderId);
  }

  for (const f of field.fielders) {
    const a = ath.get(f.id)!;
    const pb = new PathBuilder(f);
    pb.at(t0, f.x, f.z, 'set');
    const go = t0 + a.reactionS;
    if (plan.primary && f.id === primaryId) {
      const { chance: c, action, after } = plan.primary;
      const body = bodyAt(c, c.t - t0);
      const diveT = Math.max(go, c.t - 0.2);
      pb.runTo(a, go, c.dive ? diveT : c.t, body.x, body.z);
      if (c.dive) {
        pb.at(diveT, pb.last.x, pb.last.z, 'dive');
        const ux = c.dist > 1e-9 ? (c.p.x - c.fielder.x) / c.dist : 0;
        const uz = c.dist > 1e-9 ? (c.p.z - c.fielder.z) / c.dist : 0;
        const reach = groundDist(pb.last, c.p);
        pb.at(c.t, pb.last.x + ux * Math.max(0, reach - 0.6), pb.last.z + uz * Math.max(0, reach - 0.6), action);
      } else pb.at(c.t, pb.last.x, pb.last.z, action);
      if (plan.primary.ret && plan.primary.readyT !== undefined) {
        const r = plan.primary.ret;
        // After a drop he gets up and picks the ball up just before he is ready to throw.
        if (action === 'drop') pb.at(Math.max(c.t + 0.05, plan.primary.readyT - 0.25), pb.last.x, pb.last.z, 'pickup');
        if (r.carried) {
          pb.runTo(a, plan.primary.readyT, r.returnT, r.to.x, r.to.z);
          pb.at(r.returnT, pb.last.x, pb.last.z, 'idle');
        } else {
          pb.at(r.releaseT, pb.last.x, pb.last.z, 'throw');
          pb.at(r.releaseT + 0.4, pb.last.x, pb.last.z, 'idle');
        }
      } else pb.at(c.t + 0.3, pb.last.x, pb.last.z, after);
    } else if (plan.receivers && (f.role === 'keeper' || f.role === 'bowler')) {
      const stumps = f.role === 'keeper' ? STRIKER_STUMPS : BOWLER_STUMPS;
      const side = f.role === 'keeper' ? 0.6 : -0.6;
      pb.runTo(a, go, endT, stumps.x + 0.3, stumps.z + side);
      pb.at(Math.max(pb.last.t, plan.receivers.returnT), pb.last.x, pb.last.z, 'idle');
    } else if (backupId && f.id === backupId && plan.primary) {
      const c = plan.primary.chance;
      const d = groundDist(f, c.p);
      const ux = d > 1e-9 ? (c.p.x - f.x) / d : 0;
      const uz = d > 1e-9 ? (c.p.z - f.z) / d : 0;
      const stopAt = Math.max(0, d - 4);
      pb.runTo(a, go, endT, f.x + ux * stopAt, f.z + uz * stopAt);
      pb.at(Math.max(pb.last.t, c.t + 0.5), pb.last.x, pb.last.z, 'idle');
    } else if (plan.chase && chasers.has(f.id)) {
      const target = plan.chase.toward;
      const r = Math.sqrt(target.x * target.x + target.z * target.z) || 1;
      const inset = (BOUNDARY_R - 1.5) / r;
      pb.runTo(a, go, plan.chase.until, target.x * inset, target.z * inset);
      pb.at(plan.chase.until, pb.last.x, pb.last.z, 'idle');
    } else if (plan.celebrate && (f.role === 'keeper' || f.role === 'bowler')) {
      const c = plan.primary!.chance;
      pb.at(c.t + 0.3, f.x, f.z, 'celebrate');
    } else {
      pb.at(go + 0.7, f.x, f.z, 'idle');
    }
    pb.at(Math.max(pb.last.t, endT), pb.last.x, pb.last.z, pb.last.action === 'run' ? 'idle' : pb.last.action);
    out.push(pb.build());
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// The keeper takes a ball that passes the bat
// ---------------------------------------------------------------------------------------------------------------

export interface KeeperTake {
  t: number;
  p: Vec3;
  dive: boolean;
  path: FielderPath;
}

/**
 * The keeper gathers a delivery the batter missed or left. `samples` continue the delivery past the stumps (from the
 * integrator); the keeper watches it from release and moves across from `watchFromT`. Practice has no byes, so the
 * ball is dead in his gloves (and a ball beyond his dive is gathered as it reaches him: legal deliveries never are).
 */
export function keeperTake(field: FieldLayout, samples: BallSample[], watchFromT: number, endT?: number): KeeperTake | null {
  const keeper = field.fielders.find((f) => f.role === 'keeper');
  if (!keeper || samples.length === 0) return null;
  const a = athleticsOf(keeper);
  let take: BallSample | null = null;
  for (const s of samples) {
    if (s.p.z >= keeper.z - 0.4) {
      take = s;
      break;
    }
  }
  take ??= samples[samples.length - 1];
  const lateral = Math.abs(take.p.x - keeper.x);
  const cover = Math.max(0, Math.min(lateral - a.catchReachM, runDistance(a, take.t - watchFromT - a.reactionS)));
  const dive = lateral - cover > a.catchReachM + 1e-9;
  const pb = new PathBuilder(keeper);
  const startT = Math.min(take.t, watchFromT + a.reactionS);
  const side = Math.sign(take.p.x - keeper.x);
  pb.at(startT, keeper.x, keeper.z, 'set');
  if (cover > 0.05) pb.at(take.t - (dive ? 0.15 : 0), keeper.x + side * cover, keeper.z, dive ? 'dive' : 'run');
  pb.at(take.t, keeper.x + side * cover, keeper.z, 'catch');
  pb.at(Math.max(take.t + 0.5, endT ?? 0), keeper.x + side * cover, keeper.z, 'idle');
  return { t: take.t, p: take.p, dive, path: pb.build() };
}

/** Everyone but the keeper stays set (a ball that never leaves the cut strip, or a delivery that was left or missed). */
export function standingPaths(field: FieldLayout, endT: number, except: ReadonlySet<string> = new Set(), celebrate = false): FielderPath[] {
  return field.fielders
    .filter((f) => !except.has(f.id))
    .map((f) => {
      const pb = new PathBuilder(f);
      if (celebrate && (f.role === 'keeper' || f.role === 'bowler')) pb.at(Math.max(0.01, endT - 0.6), f.x, f.z, 'celebrate');
      pb.at(endT, f.x, f.z, celebrate && (f.role === 'keeper' || f.role === 'bowler') ? 'celebrate' : 'idle');
      return pb.build();
    });
}
