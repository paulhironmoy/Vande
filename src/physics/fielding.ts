/**
 * Deterministic fielding for Practice: who goes for the ball, whether a chance is caught (or dropped), where the ball
 * is stopped or collected, the loose ball after a fumble, the throw, and the moment it is back at the stumps. Pure
 * arithmetic over the post-contact trajectory sampled by the one ball integrator (ball.ts), which also rolls any ball
 * a fielder fumbles, parries or drops; the delivery's seed seeds only the misfield draw and the fumble and throw
 * variation (one stream per fielder, `vande-practice-misfield|seed|fielder`), so the same trajectory, field and seed
 * give the same play every time. The model is documented in docs/PRACTICE_RULES.md, "Fielding model".
 *
 * Every fielder works inside one physical budget (ATHLETICS, DIVE, THROW, below), and every path is built from it:
 *  - Run: he reacts (`reactionS` after the ball leaves the bat), then runs in a straight line from standing (the
 *    quickest path to a fixed point), accelerating at `accel` up to `topSpeed`, braking at `decel` to the slowest
 *    arrival speed that still gets him there in time. A fielder who arrives moving keeps braking through the take; he
 *    throws only once he has planted. Fielders whose target moves (chasers, backing up, the rest of the field closing
 *    in) steer towards it under the same limits, so their paths curve. Nobody stops dead.
 *  - Dive: it replaces the run for its duration. The hips leave the ground at a take-off point he has run to (after
 *    his reaction, at most DIVE.fullS before the take) and travel no further than a launch from standing gives (the
 *    class's dive length, catchDiveReachM − DIVE.handM, at that length over DIVE.fullS) or his run carries him on (at
 *    his running speed, no faster); the hands reach out beyond the hips from his reach on his feet to DIVE.handM by
 *    `diveMinS`. He is on his feet again DIVE.recoverS later. Near the rope a take on his feet needs room to pull up
 *    inside it.
 *  - Catch: the ball is still in the air (before its first bounce after the bat), inside the rope, at a catchable
 *    height. The earliest fielder who can get there takes it; a fielder who can catch it on his feet within a moment of
 *    a team-mate's dive takes it instead (the easier catch is called).
 *  - Drop rule (honest, deterministic): a catch is put down when the ball arrives faster than the fielder can hold
 *    (`holdSpeed` standing, `holdDiveSpeed` diving), needs a dive beyond `holdDiveStretch` of his dive length, gives
 *    him less than `SIGHT_S` to see it after his reaction (keeper and close catchers excepted: they are set for it), or
 *    is a fast ball below `LOW_CATCH_H` (keeper excepted).
 *  - Ground fielding: after the first bounce, the earliest fielder to reach the ball's path stops it (diving for low
 *    balls further away); a ball that comes to rest is collected by whoever gets there first; a ball nobody reaches
 *    before the rope is a boundary. The keeper fields the ball on the ground only within KEEPER_RANGE_M of where he
 *    stands: beyond that he goes to the stumps for the throw and the field chases it.
 *  - Partial stops: a ball that passes just beyond a fielder's diving reach (PARRY_M), low enough to get a hand or a
 *    boot to, is parried; a clean or diving stop is occasionally misfielded (MISFIELD_P, a seeded draw). A parried,
 *    fumbled or dropped ball leaves the hands slowed and deflected (LOOSE, seeded), and the ball integrator carries it
 *    on: he gets up, chases it and picks it up, unless the team-mate backing him up gets there first, or it reaches
 *    the rope.
 *  - Return: after the pickup the ball goes to whichever set of stumps it reaches first with someone there to take it
 *    (the keeper at the striker's end, the bowler at his own end; a keeper or bowler who fields it can run it in). The
 *    throw is not exact: it is off line by a seeded error that grows with its length (THROW), long throws come in on
 *    one bounce, and the receiver moves to take it and brings it to the stumps.
 */
import type { BallSample, FieldLayout, Fielder, FielderAction, FielderPath, FielderRole, SimEvent, Vec3 } from '@/contracts/practice';
import { rngFromKey, type Sfc32 } from '@/engine/prng';
import { simulate } from './ball';
import { BALL_R, BOUNDARY_R, G, PITCH_HALF } from './constants';
import { distanceFromStriker } from './field';
import { DEG, dcos, dsin } from './vec';

// ---------------------------------------------------------------------------------------------------------------
// The physical budget
// ---------------------------------------------------------------------------------------------------------------

export type FielderClass = 'keeper' | 'bowler' | 'close' | 'ring' | 'deep';

export interface Athletics {
  /** Seconds from the ball leaving the bat to the first step. */
  reactionS: number;
  /** Run: acceleration (m/s²) up to a top speed (m/s), and the braking (m/s²) he can sustain. */
  accel: number;
  topSpeed: number;
  decel: number;
  /** Catching reach (m, ground distance from the body to the ball) on his feet, and from the dive's take-off point at full stretch. */
  catchReachM: number;
  catchDiveReachM: number;
  /** Highest ball (centre height, m) caught on his feet (arms up, a small jump) and in a dive. */
  catchMaxH: number;
  catchDiveMaxH: number;
  /** Ground fielding reach on his feet and, from the take-off point, diving (m), and the highest bouncing ball stopped on his feet (m). */
  stopReachM: number;
  stopDiveReachM: number;
  stopMaxH: number;
  /** Shortest dive (take-off to hands at the ball, s). */
  diveMinS: number;
  /** Drop rule: fastest ball held (m/s at the hands) on his feet and diving; furthest dive held (0..1 of his dive length). */
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
 *
 * Sources and status (docs/PRACTICE_RULES.md "Fielding budget"): these are conservative modelling values, not
 * measurements of players. The run (constant acceleration to top speed) covers 10 m in about 2.0 s after the reaction,
 * slower than the 1.7–1.9 s that timing-gate sprints of team-sport athletes usually report; the braking (5–6.5 m/s²)
 * is below the peak decelerations reported for team sports (pointer to verify: Harper, Carling and Kiely 2019, Sports
 * Medicine, a systematic review of acceleration and deceleration demands). Throw speeds are average horizontal speeds
 * over the whole throw (below the 28–33 m/s release speeds of elite throwers' arcs; pointer to verify: Freeston,
 * Ferdinands and Rooney 2007, European Journal of Sport Science, throwing velocity and accuracy in cricketers).
 */
export const ATHLETICS: Readonly<Record<FielderClass, Athletics>> = {
  keeper: { reactionS: 0.15, accel: 6, topSpeed: 6.5, decel: 6, catchReachM: 1.1, catchDiveReachM: 2.6, catchMaxH: 2.4, catchDiveMaxH: 1.8, stopReachM: 0.9, stopDiveReachM: 2.3, stopMaxH: 2.2, diveMinS: 0.15, holdSpeed: 40, holdDiveSpeed: 34, holdDiveStretch: 0.8, throwSpeed: 18 },
  bowler: { reactionS: 0.3, accel: 4.5, topSpeed: 7, decel: 5, catchReachM: 0.9, catchDiveReachM: 2.1, catchMaxH: 2.4, catchDiveMaxH: 1.5, stopReachM: 0.75, stopDiveReachM: 1.8, stopMaxH: 2, diveMinS: 0.2, holdSpeed: 32, holdDiveSpeed: 26, holdDiveStretch: 0.6, throwSpeed: 22 },
  close: { reactionS: 0.18, accel: 5, topSpeed: 6.5, decel: 6, catchReachM: 0.95, catchDiveReachM: 2.3, catchMaxH: 2.3, catchDiveMaxH: 1.6, stopReachM: 0.75, stopDiveReachM: 1.9, stopMaxH: 2, diveMinS: 0.2, holdSpeed: 37, holdDiveSpeed: 31, holdDiveStretch: 0.7, throwSpeed: 20 },
  ring: { reactionS: 0.28, accel: 5.5, topSpeed: 7.5, decel: 6.5, catchReachM: 0.95, catchDiveReachM: 2.3, catchMaxH: 2.5, catchDiveMaxH: 1.6, stopReachM: 0.75, stopDiveReachM: 1.9, stopMaxH: 2, diveMinS: 0.2, holdSpeed: 33, holdDiveSpeed: 26, holdDiveStretch: 0.65, throwSpeed: 25 },
  deep: { reactionS: 0.32, accel: 5.5, topSpeed: 8, decel: 6.5, catchReachM: 1, catchDiveReachM: 2.4, catchMaxH: 2.6, catchDiveMaxH: 1.6, stopReachM: 0.8, stopDiveReachM: 2, stopMaxH: 2, diveMinS: 0.2, holdSpeed: 30, holdDiveSpeed: 24, holdDiveStretch: 0.65, throwSpeed: 27 },
};

/**
 * The dive (conservative modelling values). `handM`: hips to fingertips at full stretch, the same figure the renderer's
 * rig uses (render3d/practice/fielding.ts DIVE_HAND_REACH_M), so the hands it draws meet the ball the physics reached.
 * `fullS`: take-off to full stretch for a dive from standing (the hips then average at most 2.75–3.75 m/s).
 * `recoverS`: from the hands at the ball to on his feet again (the dive clips land and rise in 0.78–0.95 s).
 */
export const DIVE = { handM: 1.1, fullS: 0.4, recoverS: 0.8 } as const;

/**
 * The throw (conservative modelling values). Off line by `baseM + perM × length` (m, one standard deviation; a 30 m
 * throw about 0.9 m, a 60 m throw about 1.5 m), drawn from the fielder's seeded stream (bounded at ±3.46 σ). A throw of
 * `oneBounceM` or more comes in flat on one bounce, landing `bounceFrom`–`bounceTo` of the way, and keeps `skid` of
 * its horizontal speed off the grass. `extraS`: the gather into the throwing position (added to every throw's flight,
 * as before). The receiver can break the stumps from `stumpReachM`, and runs a wide one back in until he can.
 */
export const THROW = { baseM: 0.3, perM: 0.02, oneBounceM: 45, bounceFrom: 0.8, bounceTo: 0.9, skid: 0.7, extraS: 0.1, stumpReachM: 0.9 } as const;

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

// ---------------------------------------------------------------------------------------------------------------
// Kinematics: one run model for the rules and the paths
// ---------------------------------------------------------------------------------------------------------------

/** Ground distance a fielder can cover in `elapsed` seconds after the ball leaves the bat (flat out, never braking). */
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

/** Running speed `tau` seconds after starting from standing, flat out. */
function runSpeed(a: Athletics, tau: number): number {
  return tau <= 0 ? 0 : Math.min(a.accel * tau, a.topSpeed);
}

/**
 * Ground distance a fielder can cover `elapsed` seconds after the ball leaves the bat and still be moving at no more
 * than `u` m/s when he gets there (flat out, then braking just in time).
 */
export function coverableAt(a: Athletics, elapsed: number, u: number): number {
  const tau = elapsed - a.reactionS;
  if (tau <= 0) return 0;
  const A = a.accel;
  const D = a.decel;
  const V = a.topSpeed;
  const w = Math.max(0, u);
  if (w >= V) return runDistance(a, tau);
  if (tau <= w / A) return 0.5 * A * tau * tau;
  const vp = ((tau + w / D) * A * D) / (A + D);
  if (vp <= V) return (vp * vp) / (2 * A) + (vp * vp - w * w) / (2 * D);
  return (V * V) / (2 * A) + V * (tau - V / A - (V - w) / D) + (V * V - w * w) / (2 * D);
}

/** How far (m) a fielder at p running along the unit direction `dir` is from the rope's inside edge. */
function ropeRoom(p: XZ, dir: XZ): number {
  const b = p.x * dir.x + p.z * dir.z;
  const c = p.x * p.x + p.z * p.z - INSIDE_R2;
  if (c >= 0) return 0;
  return -b + Math.sqrt(b * b - c);
}

/**
 * The fastest he may arrive at a take on his feet at `at`, running along `dir`, and still pull up inside the rope
 * (with the ball in his hands; over it, it would be a boundary): his braking over the room he has.
 */
function arrivalCap(a: Athletics, at: XZ, dir: XZ): number {
  return Math.sqrt(2 * a.decel * Math.max(0, ropeRoom(at, dir) - 0.05));
}

/** Seconds to run `d` metres from standing and arrive at no more than `u` m/s (accelerate, cruise, brake). */
export function timeToArrive(a: Athletics, d: number, u: number): number {
  if (d <= 0) return 0;
  const A = a.accel;
  const D = a.decel;
  const V = a.topSpeed;
  const w = Math.min(Math.max(0, u), V);
  if (d <= (w * w) / (2 * A)) return Math.sqrt((2 * d) / A);
  const vp2 = (2 * A * D * d + A * w * w) / (A + D);
  if (vp2 <= V * V) {
    const vp = Math.sqrt(vp2);
    return vp / A + (vp - w) / D;
  }
  return V / A + (V - w) / D + (d - (V * V) / (2 * A) - (V * V - w * w) / (2 * D)) / V;
}

/** One straight run from standing: accelerate to vp (until ta), hold it (until tc), brake to u (at T, distance d). */
interface Run {
  d: number;
  u: number;
  vp: number;
  ta: number;
  tc: number;
  T: number;
  A: number;
  D: number;
}

function makeRun(a: Athletics, d: number, u: number): Run {
  const A = a.accel;
  const D = a.decel;
  const V = a.topSpeed;
  if (d <= 1e-9) return { d: 0, u: 0, vp: 0, ta: 0, tc: 0, T: 0, A, D };
  const w = Math.min(Math.max(0, u), V);
  if (d <= (w * w) / (2 * A)) {
    const T = Math.sqrt((2 * d) / A);
    return { d, u: A * T, vp: A * T, ta: T, tc: T, T, A, D };
  }
  const vp2 = (2 * A * D * d + A * w * w) / (A + D);
  if (vp2 <= V * V) {
    const vp = Math.sqrt(vp2);
    return { d, u: w, vp, ta: vp / A, tc: vp / A, T: vp / A + (vp - w) / D, A, D };
  }
  const ta = V / A;
  const tc = ta + (d - (V * V) / (2 * A) - (V * V - w * w) / (2 * D)) / V;
  return { d, u: w, vp: V, ta, tc, T: tc + (V - w) / D, A, D };
}

/**
 * The run that covers `d` metres in at most `budget` seconds from standing arriving as slowly as possible: braking to
 * a stop when there is time, otherwise arriving at the lowest speed that is still in time (flat out when he must).
 */
function planRun(a: Athletics, d: number, budget: number): Run {
  if (d <= 1e-9) return makeRun(a, 0, 0);
  if (timeToArrive(a, d, 0) <= budget + 1e-12) return makeRun(a, d, 0);
  let lo = 0;
  let hi = Math.min(a.topSpeed, Math.sqrt(2 * a.accel * d));
  for (let i = 0; i < 48; i++) {
    const mid = (lo + hi) / 2;
    if (timeToArrive(a, d, mid) <= budget + 1e-12) hi = mid;
    else lo = mid;
  }
  return makeRun(a, d, hi);
}

/** Distance along the run and speed `tau` seconds after its start (held at the end once it is over). */
function runAt(r: Run, tau: number): { s: number; v: number } {
  if (tau <= 0) return { s: 0, v: 0 };
  if (tau >= r.T) return { s: r.d, v: r.u };
  if (tau <= r.ta) return { s: 0.5 * r.A * tau * tau, v: r.A * tau };
  const sa = 0.5 * r.A * r.ta * r.ta;
  if (tau <= r.tc) return { s: sa + r.vp * (tau - r.ta), v: r.vp };
  const q = tau - r.tc;
  return { s: sa + r.vp * (r.tc - r.ta) + r.vp * q - 0.5 * r.D * q * q, v: r.vp - r.D * q };
}

// ---------------------------------------------------------------------------------------------------------------
// The dive
// ---------------------------------------------------------------------------------------------------------------

/** A dive at a ball `e` seconds after contact: take-off time (after contact), the run before it, the hips' travel. */
interface DivePlan {
  takeoffE: number;
  runM: number;
  hipM: number;
  /** The hands' reach beyond the hips at the take (m). */
  handM: number;
  /** How far into his dive length (or, on the run, the ground his run carries him) the hips travel (0..1). */
  stretch: number;
}

const DIVE_STEPS = 8;

/**
 * Candidate take-offs for a dive reaching at `e` (s after contact): from max(reaction, e − DIVE.fullS) to e, latest
 * first, with the shortest full dive (e − diveMinS) among them.
 */
function diveTakeoffs(a: Athletics, e: number): number[] {
  if (e < a.reactionS - 1e-12) return [];
  const earliest = Math.max(a.reactionS, e - DIVE.fullS);
  const out: number[] = [];
  for (let i = DIVE_STEPS; i >= 0; i--) out.push(earliest + ((e - earliest) * i) / DIVE_STEPS);
  const shortest = e - a.diveMinS;
  if (shortest > earliest) out.push(shortest);
  return out;
}

/**
 * The hips' travel available to a dive taking off at `tau` and reaching at `e`: a launch from standing covers at most
 * the dive length `hipMax` (at hipMax / DIVE.fullS), a dive on the run carries his running speed on (no faster).
 */
function hipCap(a: Athletics, tau: number, e: number, hipMax: number): number {
  const T = e - tau;
  return Math.max(Math.min(hipMax, (hipMax / DIVE.fullS) * T), runSpeed(a, tau - a.reactionS) * T);
}

/** How far the hands reach beyond the hips `T` s into a dive: from his reach on his feet out to DIVE.handM by diveMinS. */
function handReach(a: Athletics, T: number, feetReach: number): number {
  if (T >= a.diveMinS) return DIVE.handM;
  return feetReach + ((DIVE.handM - feetReach) * Math.max(0, T)) / a.diveMinS;
}

/**
 * Furthest ground distance (m) from where he stands that a dive of length `hipMax` reaches `e` seconds after contact
 * (0 when none can); `feetReach` is his reach on his feet for the same take.
 */
export function diveReachM(a: Athletics, e: number, hipMax: number, feetReach: number): number {
  let best = 0;
  for (const tau of diveTakeoffs(a, e)) best = Math.max(best, coverable(a, tau) + hipCap(a, tau, e, hipMax) + handReach(a, e - tau, feetReach));
  return best;
}

/** The least stretched dive that reaches a ball `dist` metres away `e` seconds after contact, or null. */
function diveFor(a: Athletics, e: number, dist: number, hipMax: number, feetReach: number): DivePlan | null {
  let best: DivePlan | null = null;
  for (const tau of diveTakeoffs(a, e)) {
    const run = coverable(a, tau);
    const cap = hipCap(a, tau, e, hipMax);
    const hand = handReach(a, e - tau, feetReach);
    if (run + cap + hand < dist - 1e-9) continue;
    const runM = Math.min(run, Math.max(0, dist - hand));
    const hipM = Math.max(0, dist - hand - runM);
    // How far into his dive length (a dive on the run: into the ground his run carries him).
    const length = Math.max(hipMax, runSpeed(a, tau - a.reactionS) * (e - tau));
    const stretch = length > 1e-9 ? Math.min(1, hipM / length) : 0;
    if (!best || stretch < best.stretch - 1e-9) best = { takeoffE: tau, runM, hipM, stretch, handM: hand };
  }
  return best;
}

/** Dive lengths (hips' travel, m) of a class: for a catch, a ground stop and a parry. */
export function diveLengths(a: Athletics): { catch: number; stop: number; parry: number } {
  return { catch: a.catchDiveReachM - DIVE.handM, stop: a.stopDiveReachM - DIVE.handM, parry: a.stopDiveReachM + PARRY_M - DIVE.handM };
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
/** The keeper fields a ball on the ground only this close to where he stands (m); beyond it he takes the throw. */
export const KEEPER_RANGE_M = 6;
/**
 * Partial stops. A ball passing within this much beyond a fielder's diving stop reach (m), no higher than PARRY_MAX_H,
 * is parried: he gets a hand or a boot to it, and the ball runs on slowed and deflected (LOOSE).
 */
export const PARRY_M = 0.5;
export const PARRY_MAX_H = 0.9;
/**
 * Misfields: the chance a clean stop is fumbled, by class, × (1 + speed / MISFIELD_SPEED_REF) for the ball's speed at the
 * fielder (m/s) and × MISFIELD_DIVE_X for a diving stop (a hard-hit ball at a diving ring fielder: about 10%).
 */
export const MISFIELD_P: Readonly<Record<FielderClass, number>> = { keeper: 0.01, close: 0.02, ring: 0.025, deep: 0.035, bowler: 0.035 };
export const MISFIELD_SPEED_REF = 30;
export const MISFIELD_DIVE_X = 2;
/**
 * The ball off the hands after a drop, a fumble or a parry (conservative modelling values): the share of the ball's
 * speed it keeps, how far its line turns (deg, to a seeded side) and how fast it pops up (m/s). Drawn from the
 * fielder's seeded stream, uniformly in each range; without a seed, the middle of each range to the off side.
 */
export const LOOSE = {
  dropped: { keep: [0.05, 0.2], turnDeg: [0, 100], upMps: [0.5, 2] },
  misfield: { keep: [0.1, 0.3], turnDeg: [15, 80], upMps: [0, 0] },
  parried: { keep: [0.2, 0.45], turnDeg: [20, 70], upMps: [0, 0.8] },
  /** He sees a ball spill from his hands on his feet and goes after it (s). */
  reactS: 0.4,
} as const;
/** Ball in hand and ready to throw after: a clean stop on his feet, a diving stop (get up and set), gathering a ball at rest. */
export const PICKUP_S = { stop: 0.55, dive_stop: 1.1, collect: 0.7 } as const;
/** The keeper or bowler needs this long at the stumps before he can take a throw (s). */
export const RECEIVER_SET_S = 0.2;
/** The receiver waits this far (m) short of the stumps, on his side of them. */
const RECEIVER_SHORT_M = 0.6;
/** A team-mate backs up the fielder going for the ball this far beyond him on the ball's line (m), and the throw this far behind the stumps. */
const BACKUP_BEHIND_M = 4;
const THROW_BACKUP_M = 10;
/** The rest of the field closes in on the ball: at most this far (m) and this share of his top speed (close catchers a step). */
const CLOSE_IN_M = { close: 1, ring: 3, deep: 4 } as const;
const CLOSE_IN_SPEED = 0.6;
/** Hand heights for the in-hand ball and the throw (m), and the time the hands take to bring a gathered ball up (s). */
const HAND_H = 0.9;
const THROW_RELEASE_H = 1.9;
const THROW_TAKE_H = 0.8;
const LIFT_S = 0.25;
/** The throw's wind-up (s before the release: the renderer's throw clip releases 0.42 s in). */
const WIND_UP_S = 0.42;
/** Path sample spacing for rendering (s), and the steering integration step (s). */
export const PATH_DT = 0.1;
const STEER_DT = 0.02;
/** Path samples are at least this far apart (s). */
const MIN_SAMPLE_GAP_S = 0.002;
/**
 * A dive is drawn at least this long (s): a take the rules let him make with a near-instant lunge (a ball too low to
 * take on his feet, within his hands' reach as he runs) is drawn from this far back on his run, his hips carrying on
 * at his running speed, so the path always shows the dive and its landing (never a dead stop at the take).
 */
const DIVE_DRAW_MIN_S = 0.05;

/** When the dive is drawn from: its take-off, or DIVE_DRAW_MIN_S before the take (never before he can move). */
function diveDrawT(takeoffT: number, takeT: number, moveFromT: number): number {
  const latest = takeT - DIVE_DRAW_MIN_S;
  if (takeoffT <= latest) return takeoffT;
  return Math.max(latest, Math.min(takeT - MIN_SAMPLE_GAP_S, moveFromT));
}

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

export type GatherKind = 'stop' | 'dive_stop' | 'collect' | 'dropped' | 'parried' | 'misfield';

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
  /** The ball from contact until it is dead (in-hand, loose-ball and throw segments included). */
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
  /** Reach used on his feet (0 for a dive: the hands reach DIVE.handM beyond the hips). */
  reach: number;
  /** For a dive: how far into his dive length (0..1). */
  stretch: number;
  speed: number;
  /** Seconds between the end of the fielder's reaction and the ball reaching him. */
  sightS: number;
  /** Run before the take (feet) or the take-off (dive), m; the dive's take-off (s after release) and the hips' travel (m). */
  runM: number;
  takeoffT: number;
  hipM: number;
}

// ---------------------------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------------------------

type XZ = { x: number; z: number };

// Plain square roots only (Math.hypot is not guaranteed to round identically on every engine).
const speedOf = (v: Vec3) => Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
const INSIDE_R = BOUNDARY_R - ROPE_MARGIN_M;
const INSIDE_R2 = INSIDE_R * INSIDE_R;
const insideRope = (p: { x: number; z: number }) => p.x * p.x + p.z * p.z <= INSIDE_R2;
const groundDist = (f: { x: number; z: number }, p: { x: number; z: number }) => {
  const dx = p.x - f.x;
  const dz = p.z - f.z;
  return Math.sqrt(dx * dx + dz * dz);
};
const unit = (from: XZ, to: XZ, fallback: XZ = { x: 0, z: 1 }): XZ => {
  const d = groundDist(from, to);
  return d > 1e-9 ? { x: (to.x - from.x) / d, z: (to.z - from.z) / d } : fallback;
};
const along = (p: XZ, u: XZ, s: number): XZ => ({ x: p.x + u.x * s, z: p.z + u.z * s });
/** A point pulled back inside the rope (m from its centre at most `r`). */
const insideBy = (p: XZ, r: number): XZ => {
  const d = Math.sqrt(p.x * p.x + p.z * p.z);
  return d <= r || d < 1e-9 ? p : { x: (p.x * r) / d, z: (p.z * r) / d };
};
const keeperOutOfRange = (f: Fielder, p: { x: number; z: number }) => f.role === 'keeper' && groundDist(f, p) > KEEPER_RANGE_M;

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

/** Whether a take on his feet at p, `elapsed` s after contact, leaves him room to pull up inside the rope. */
function pullsUp(f: XZ, a: Athletics, p: XZ, dist: number, reach: number, elapsed: number): boolean {
  const runM = dist - reach;
  if (runM <= 1e-9) return true;
  const dir = unit(f, p);
  return runM <= coverableAt(a, elapsed, arrivalCap(a, along(f, dir, runM), dir)) + 1e-9;
}

function chanceOn(f: Fielder, a: Athletics, ball: PostContactBall, k: number, dist: number, feetReach: number): Chance {
  const b = ball.samples[k];
  const e = b.t - ball.t0;
  return { fielder: f, a, k, t: b.t, p: b.p, dive: false, dist, reach: feetReach, stretch: 0, speed: speedOf(b.v), sightS: e - a.reactionS, runM: Math.max(0, dist - feetReach), takeoffT: b.t, hipM: 0 };
}

function diveChance(f: Fielder, a: Athletics, ball: PostContactBall, k: number, dist: number, plan: DivePlan): Chance {
  const b = ball.samples[k];
  const e = b.t - ball.t0;
  return { fielder: f, a, k, t: b.t, p: b.p, dive: true, dist, reach: 0, stretch: plan.stretch, speed: speedOf(b.v), sightS: e - a.reactionS, runM: plan.runM, takeoffT: ball.t0 + plan.takeoffE, hipM: plan.hipM };
}

function firstCatch(f: Fielder, a: Athletics, ball: PostContactBall, tBounce: number): Chance | null {
  const s = ball.samples;
  const hipMax = diveLengths(a).catch;
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
    if (y >= CATCH_MIN_H && y <= a.catchMaxH && dist <= a.catchReachM + cover && pullsUp(f, a, b.p, dist, a.catchReachM, elapsed)) {
      const standing = chanceOn(f, a, ball, k, dist, a.catchReachM);
      return dive && dive.t + CALL_FOR_IT_S < standing.t ? dive : standing;
    }
    if (y >= DIVE_CATCH_MIN_H && y <= a.catchDiveMaxH && dist <= cover + hipMax + DIVE.handM) {
      const plan = diveFor(a, elapsed, dist, hipMax, a.catchReachM);
      if (plan && (!dive || plan.stretch < dive.stretch - 1e-9)) dive = diveChance(f, a, ball, k, dist, plan);
    }
  }
  return dive;
}

function firstStop(f: Fielder, a: Athletics, ball: PostContactBall, tFrom: number): Chance | null {
  const s = ball.samples;
  const hipMax = diveLengths(a).stop;
  let dive: Chance | null = null;
  for (let k = 1; k < s.length; k++) {
    const b = s[k];
    if (b.t < tFrom - 1e-9) continue;
    if (!insideRope(b.p)) break;
    if (keeperOutOfRange(f, b.p)) continue;
    const elapsed = b.t - ball.t0;
    const cover = coverable(a, elapsed);
    const dist = groundDist(f, b.p);
    const y = b.p.y;
    if (y <= a.stopMaxH && dist <= a.stopReachM + cover && pullsUp(f, a, b.p, dist, a.stopReachM, elapsed)) {
      const standing = chanceOn(f, a, ball, k, dist, a.stopReachM);
      return dive && dive.t + STAY_ON_FEET_S < standing.t ? dive : standing;
    }
    if (!dive && y <= STOP_DIVE_MAX_H && dist <= cover + hipMax + DIVE.handM) {
      const plan = diveFor(a, elapsed, dist, hipMax, a.stopReachM);
      if (plan) dive = diveChance(f, a, ball, k, dist, plan);
    }
  }
  return dive;
}

/** The first moment a fielder gets a hand or a boot to a ball just beyond his diving stop: a parry (or null). */
function firstParry(f: Fielder, a: Athletics, ball: PostContactBall, tFrom: number): Chance | null {
  const s = ball.samples;
  const hipMax = diveLengths(a).parry;
  for (let k = 1; k < s.length; k++) {
    const b = s[k];
    if (b.t < tFrom - 1e-9) continue;
    if (!insideRope(b.p)) break;
    if (b.p.y > PARRY_MAX_H || keeperOutOfRange(f, b.p)) continue;
    const elapsed = b.t - ball.t0;
    const dist = groundDist(f, b.p);
    if (dist > coverable(a, elapsed) + hipMax + DIVE.handM) continue;
    const plan = diveFor(a, elapsed, dist, hipMax, a.stopReachM);
    if (plan) return { ...diveChance(f, a, ball, k, dist, plan), stretch: 1 };
  }
  return null;
}

/** Whether a clean or diving stop is fumbled: the class's chance raised by the ball's speed and a dive, against a draw seeded by the delivery and the fielder. */
export function misfielded(cls: FielderClass, c: { fielder: Fielder; dive: boolean; speed: number }, seed: string | undefined): boolean {
  if (!seed) return false;
  const p = MISFIELD_P[cls] * (1 + c.speed / MISFIELD_SPEED_REF) * (c.dive ? MISFIELD_DIVE_X : 1);
  return fielderStream(seed, c.fielder.id).float() < p;
}

/**
 * A fielder's seeded stream for the delivery. Its first draw is the misfield draw (misfielded); the fumble's
 * deflection and his throw's error come after it, in that order, so they never change whether he misfields.
 */
function fielderStream(seed: string, fielderId: string): Sfc32 {
  return rngFromKey(`vande-practice-misfield|${seed}|${fielderId}`);
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

function collect(f: Fielder, a: Athletics, ball: PostContactBall, rest: BallSample): Chance | null {
  if (keeperOutOfRange(f, rest.p)) return null;
  const dist = groundDist(f, rest.p);
  const runM = Math.max(0, dist - a.stopReachM);
  const dir = unit(f, rest.p);
  const t = Math.max(rest.t, ball.t0 + (runM > 0 ? a.reactionS + timeToArrive(a, runM, arrivalCap(a, along(f, dir, runM), dir)) : 0));
  return { fielder: f, a, k: ball.samples.length - 1, t, p: rest.p, dive: false, dist, reach: a.stopReachM, stretch: 0, speed: 0, sightS: t - ball.t0 - a.reactionS, runM: Math.max(0, dist - a.stopReachM), takeoffT: t, hipM: 0 };
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

/**
 * Where the fielder's body goes for a chance: his line to the ball, the run on it (to the take, or to the dive's
 * take-off), the hips at the take, and how fast they are moving then (a dive ends on the ground).
 */
interface Approach {
  dir: XZ;
  run: Run;
  runStartT: number;
  /** End of the run (take point on his feet, take-off point for a dive). */
  runEnd: XZ;
  /** Hips at the take. */
  at: XZ;
  /** Ground speed at the take (0 after a dive, or when he was set in time). */
  u: number;
}

function approachOf(c: Chance, t0: number): Approach {
  const f = c.fielder;
  const dir = unit(f, c.p, unit(f, STRIKER_STUMPS));
  const runStartT = t0 + c.a.reactionS;
  const runEndT = c.dive ? c.takeoffT : c.t;
  const run = planRun(c.a, c.runM, Math.max(0, runEndT - runStartT));
  const runEnd = along(f, dir, c.runM);
  if (c.dive) return { dir, run, runStartT, runEnd, at: along(runEnd, dir, c.hipM), u: 0 };
  const late = runEndT - runStartT < run.T - 1e-9;
  return { dir, run, runStartT, runEnd, at: runEnd, u: c.runM > 1e-9 && !late ? run.u : c.runM > 1e-9 ? runAt(run, runEndT - runStartT).v : 0 };
}

/** Where a fielder braking from `u` along `dir` from `p` is `tau` seconds later (he throws on the move). */
function brakingAt(a: Athletics, p: XZ, dir: XZ, u: number, tau: number): XZ {
  if (u <= 1e-9) return p;
  const br = brakeOf(a, p, dir, u);
  const q = Math.min(tau, br.T);
  return along(p, dir, u * q - 0.5 * br.D * q * q);
}

/** Braking from `u` along `dir` from `p`: where he stops (inside the rope) and how long it takes. */
function brakeOf(a: Athletics, p: XZ, dir: XZ, u: number): { to: XZ; s: number; T: number; D: number } {
  if (u <= 1e-9) return { to: p, s: 0, T: 0, D: a.decel };
  let s = (u * u) / (2 * a.decel);
  let D = a.decel;
  // A fielder gathering on the move near the rope pulls up harder (or slides) to stay inside it.
  const end = along(p, dir, s);
  if (!insideRope(end)) {
    let lo = 0;
    let hi = s;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (insideRope(along(p, dir, mid))) lo = mid;
      else hi = mid;
    }
    s = Math.max(lo, 0.05);
    D = (u * u) / (2 * s);
  }
  return { to: along(p, dir, s), s, T: u / D, D };
}

// ---------------------------------------------------------------------------------------------------------------
// The return to the stumps
// ---------------------------------------------------------------------------------------------------------------

interface Return {
  releaseT: number;
  /** The ball reaches the receiver (or the runner reaches his stumps with it). */
  arriveT: number;
  returnT: number;
  end: 'striker' | 'bowler';
  from: XZ;
  /** Where the throw arrives (or the stumps, carried), and where the ball is when it is back (within reach of the stumps). */
  to: XZ;
  home: XZ;
  stumps: XZ;
  carried: boolean;
  /** A long throw's one bounce. */
  bounce: { t: number; p: XZ } | null;
  receiverId: string | null;
  /** The receiver's spot to take it (his body), when it is thrown. */
  takeAt: XZ | null;
}

/** Where the keeper or bowler waits for the throw: just short of his stumps on his side of them. */
function receiverSpot(r: Fielder, stumps: XZ): XZ {
  return along(stumps, unit(stumps, r, { x: 0, z: stumps.z > 0 ? 1 : -1 }), RECEIVER_SHORT_M);
}

function receiverReadyT(field: FieldLayout, role: 'keeper' | 'bowler', stumps: XZ, t0: number): number {
  const r = field.fielders.find((f) => f.role === role);
  if (!r) return Infinity;
  const a = athleticsOf(r);
  return t0 + a.reactionS + timeToArrive(a, groundDist(r, receiverSpot(r, stumps)), 0) + RECEIVER_SET_S;
}

/** Flight time of a throw `d` metres long (s), on one bounce landing `f` of the way when it is long. */
function throwFlightS(a: Athletics, d: number, f: number): number {
  if (d < THROW.oneBounceM) return d / a.throwSpeed + THROW.extraS;
  return (f * d) / a.throwSpeed + ((1 - f) * d) / (a.throwSpeed * THROW.skid) + THROW.extraS;
}

/** The throw's seeded variation, drawn once from the thrower's stream: its error (standard normal) and where a long one bounces (0..1). */
interface ThrowDraws {
  err: number;
  bounce: number;
}

/**
 * The return. `throwFrom` / `readyT`: where and when he can let the ball go (on the move); `carry`: where he has
 * stopped and when, should he run it in to his own stumps. `busy`: fielders who cannot take a throw (still chasing).
 */
function planReturn(field: FieldLayout, thrower: Fielder, a: Athletics, throwFrom: XZ, readyT: number, carry: { at: XZ; t: number }, t0: number, draws: ThrowDraws | null, busy: ReadonlySet<string>): Return {
  const meanF = (THROW.bounceFrom + THROW.bounceTo) / 2;
  const options: Return[] = [];
  for (const end of ['striker', 'bowler'] as const) {
    const stumps = end === 'striker' ? STRIKER_STUMPS : BOWLER_STUMPS;
    const role = end === 'striker' ? 'keeper' : 'bowler';
    if (thrower.role === role) {
      // He runs it in himself (or is already there), from where he pulled up, stopping at the stumps.
      const run = timeToArrive(a, Math.max(0, groundDist(carry.at, stumps) - RECEIVER_SHORT_M), 0);
      const releaseT = carry.t;
      options.push({ releaseT, arriveT: releaseT + run, returnT: releaseT + run, end, from: carry.at, to: stumps, home: stumps, stumps, carried: true, bounce: null, receiverId: thrower.id, takeAt: null });
      continue;
    }
    const receiver = field.fielders.find((f) => f.role === role) ?? null;
    if (!receiver || busy.has(receiver.id)) continue;
    const flightT = throwFlightS(a, groundDist(throwFrom, stumps), meanF);
    const ready = receiverReadyT(field, role, stumps, t0);
    const releaseT = Math.max(readyT, ready - flightT);
    options.push({ releaseT, arriveT: releaseT + flightT, returnT: releaseT + flightT, end, from: throwFrom, to: stumps, home: stumps, stumps, carried: false, bounce: null, receiverId: receiver.id, takeAt: receiverSpot(receiver, stumps) });
  }
  if (options.length === 0) return planReturn(field, thrower, a, throwFrom, readyT, carry, t0, draws, new Set());
  const best = options.reduce((b, o) => (o.returnT < b.returnT ? o : b));
  if (best.carried) return best;
  // The throw as thrown: off line by the seeded error, on one bounce if long; the receiver takes it and brings it in.
  const at = throwFrom;
  const d = groundDist(at, best.stumps);
  const err = draws ? (THROW.baseM + THROW.perM * d) * draws.err : 0;
  const f = draws ? THROW.bounceFrom + (THROW.bounceTo - THROW.bounceFrom) * draws.bounce : meanF;
  const line = unit(at, best.stumps);
  const to = { x: best.stumps.x - line.z * err, z: best.stumps.z + line.x * err };
  const len = groundDist(at, to);
  const flightT = throwFlightS(a, len, f);
  // The receiver, set at his stumps, moves across to take it: a throw off line arrives no sooner than he can be there.
  const receiver = field.fielders.find((x) => x.id === best.receiverId)!;
  const ra = athleticsOf(receiver);
  const spot = best.takeAt!;
  // He only moves until the ball will arrive within his reach (a little inside it).
  const move = Math.max(0, groundDist(spot, to) - (ra.catchReachM - 0.1));
  const takeAt = move > 0 ? along(spot, unit(spot, to), move) : spot;
  const setAt = receiverReadyT(field, receiver.role as 'keeper' | 'bowler', best.stumps, t0);
  const canTake = move > 0.05 ? setAt + timeToArrive(ra, move, 0) : setAt;
  const releaseT = Math.max(best.releaseT, canTake - flightT);
  const arriveT = releaseT + flightT;
  const bounce = len >= THROW.oneBounceM ? { t: releaseT + (f * len) / a.throwSpeed, p: { x: at.x + (to.x - at.x) * f, z: at.z + (to.z - at.z) * f } } : null;
  // Back at the stumps once the ball is within his reach of them.
  const off = groundDist(to, best.stumps);
  const returnT = arriveT + (off > THROW.stumpReachM ? timeToArrive(ra, off - THROW.stumpReachM, 0) : 0);
  const home = off > THROW.stumpReachM ? along(best.stumps, unit(best.stumps, to), THROW.stumpReachM) : to;
  return { ...best, releaseT, to, home, arriveT, returnT, bounce, takeAt };
}

// ---------------------------------------------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------------------------------------------

type PathSample = FielderPath['samples'][number];

class PathBuilder {
  readonly samples: PathSample[] = [];
  readonly fielder: Fielder;
  /** The fielder's ground velocity at the end of the path so far (m/s). */
  vx = 0;
  vz = 0;
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
    const n = this.samples.length;
    // Samples stay at least MIN_SAMPLE_GAP_S apart (renderers merge closer instants): a sample just before this one
    // that only continues its action gives way to it; one that starts an action (an event) is kept.
    const inGroup = n >= 2 && this.samples[n - 2].action === l.action;
    if ((s.t === l.t && l.t > 0) || (s.t - l.t < MIN_SAMPLE_GAP_S && l.t > 0 && inGroup)) this.samples[n - 1] = s;
    else if (s.t - l.t < MIN_SAMPLE_GAP_S && l.t > 0) {
      if (action === l.action) return this;
      s.t = l.t + MIN_SAMPLE_GAP_S;
      this.samples.push(s);
    } else this.samples.push(s);
    return this;
  }
  /** Where the path is at t (linear between samples, as the path is defined). */
  pos(t: number): XZ {
    const s = this.samples;
    if (t <= s[0].t) return { x: s[0].x, z: s[0].z };
    for (let i = 0; i + 1 < s.length; i++) {
      if (t <= s[i + 1].t) {
        const dt = s[i + 1].t - s[i].t;
        const u = dt > 0 ? (t - s[i].t) / dt : 1;
        return { x: s[i].x + (s[i + 1].x - s[i].x) * u, z: s[i].z + (s[i + 1].z - s[i].z) * u };
      }
    }
    const l = this.last;
    return { x: l.x, z: l.z };
  }
  /** Hold still until t (the last action carried on, or `action`). Only a fielder at rest holds. */
  holdTo(t: number, action?: FielderAction): this {
    const l = this.last;
    if (t > l.t + 1e-9) {
      this.at(t, l.x, l.z, action ?? (l.action === 'run' ? 'idle' : l.action));
      this.vx = 0;
      this.vz = 0;
    }
    return this;
  }
  /** A gap before tStart is a wait where he is. */
  private startAt(tStart: number): void {
    const l = this.last;
    if (tStart > l.t + 1e-9) this.at(tStart, l.x, l.z, l.action);
  }
  /**
   * A planned straight run (from standing at tStart) from the path's last point along `dir`: samples every PATH_DT,
   * the last one at the arrival (never after `endBy`, so the action that follows lands on its event).
   */
  runPlanned(run: Run, tStart: number, dir: XZ, action: FielderAction = 'run', endBy = Infinity): number {
    const from = { x: this.last.x, z: this.last.z };
    if (run.d <= 1e-9) return tStart;
    this.startAt(tStart);
    const end = Math.min(tStart + run.T, Math.max(tStart, endBy));
    for (let t = tStart + PATH_DT; t < end - 1e-9; t += PATH_DT) {
      const s = runAt(run, t - tStart).s;
      this.at(t, from.x + dir.x * s, from.z + dir.z * s, action);
    }
    const fin = runAt(run, end - tStart);
    const s = end >= tStart + run.T - 1e-9 ? run.d : fin.s;
    this.at(end, from.x + dir.x * s, from.z + dir.z * s, action);
    const v = end >= tStart + run.T - 1e-9 ? run.u : fin.v;
    this.vx = dir.x * v;
    this.vz = dir.z * v;
    return end;
  }
  /** Brake from his current velocity to a stop, from the last point (samples every PATH_DT; harder near the rope). */
  brakeNow(a: Athletics, action: FielderAction): number {
    const u = Math.sqrt(this.vx * this.vx + this.vz * this.vz);
    if (u <= 1e-9) return this.last.t;
    const dir = { x: this.vx / u, z: this.vz / u };
    const br = brakeOf(a, { x: this.last.x, z: this.last.z }, dir, u);
    return this.brake(this.last.t, u, dir, br.D, action);
  }
  /** Brake from `u` along `dir`, starting at tStart from the last point, to a stop (samples every PATH_DT). */
  brake(tStart: number, u: number, dir: XZ, decel: number, action: FielderAction): number {
    const from = { x: this.last.x, z: this.last.z };
    if (u <= 1e-9) return tStart;
    const T = u / decel;
    for (let t = tStart + PATH_DT; t < tStart + T - 1e-9; t += PATH_DT) {
      const q = t - tStart;
      const s = u * q - 0.5 * decel * q * q;
      this.at(t, from.x + dir.x * s, from.z + dir.z * s, action);
    }
    const s = (u * u) / (2 * decel);
    this.at(tStart + T, from.x + dir.x * s, from.z + dir.z * s, action);
    this.vx = 0;
    this.vz = 0;
    return tStart + T;
  }
  /**
   * Steer from the path's last point (with its current velocity) towards a target that may move, until tEnd, then
   * pull up: acceleration at most `accel` (`decel` when braking), speed at most `cap`, braking in time to stop at the
   * target. Returns when he is at rest (at or after tEnd).
   */
  steer(a: Athletics, tStart: number, tEnd: number, target: (t: number) => XZ, cap = a.topSpeed, action: FielderAction = 'run', stop: FielderAction = 'idle'): number {
    this.startAt(tStart);
    let x = this.last.x;
    let z = this.last.z;
    let vx = this.vx;
    let vz = this.vz;
    let t = Math.max(tStart, this.last.t);
    let nextSample = tStart + PATH_DT;
    const limit = Math.min(cap, a.topSpeed);
    for (let i = 0; i < 4000; i++) {
      const goal = t < tEnd ? target(t) : null;
      let wx = 0;
      let wz = 0;
      if (goal) {
        const dx = goal.x - x;
        const dz = goal.z - z;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d > 0.05) {
          const want = Math.min(limit, Math.sqrt(2 * a.decel * Math.max(0, d - 0.05)));
          wx = (dx / d) * want;
          wz = (dz / d) * want;
        }
      }
      const sp = Math.sqrt(vx * vx + vz * vz);
      const ws = Math.sqrt(wx * wx + wz * wz);
      const ax = wx - vx;
      const az = wz - vz;
      const dv = Math.sqrt(ax * ax + az * az);
      const max = (ws < sp - 1e-9 ? a.decel : a.accel) * STEER_DT;
      if (dv > max) {
        vx += (ax / dv) * max;
        vz += (az / dv) * max;
      } else {
        vx = wx;
        vz = wz;
      }
      const nx = x + vx * STEER_DT;
      const nz = z + vz * STEER_DT;
      // Never through the rope.
      if (insideRope({ x: nx, z: nz })) {
        x = nx;
        z = nz;
      } else {
        vx = 0;
        vz = 0;
      }
      t += STEER_DT;
      const moving = vx * vx + vz * vz > 1e-6;
      if (t >= nextSample - 1e-9) {
        this.at(t, x, z, moving ? action : t < tEnd ? action : stop);
        nextSample += PATH_DT;
      }
      if (!moving && t >= tEnd) break;
    }
    this.at(t, x, z, stop);
    this.vx = 0;
    this.vz = 0;
    return t;
  }
}

/** A path's position at t (linear between samples). */
function pathPos(p: FielderPath, t: number): XZ {
  const s = p.samples;
  if (t <= s[0].t) return { x: s[0].x, z: s[0].z };
  for (let i = 0; i + 1 < s.length; i++) {
    if (t <= s[i + 1].t) {
      const dt = s[i + 1].t - s[i].t;
      const u = dt > 0 ? (t - s[i].t) / dt : 1;
      return { x: s[i].x + (s[i + 1].x - s[i].x) * u, z: s[i].z + (s[i + 1].z - s[i].z) * u };
    }
  }
  const l = s[s.length - 1];
  return { x: l.x, z: l.z };
}

// ---------------------------------------------------------------------------------------------------------------
// Ball tails: in hand, loose, thrown
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

/** Push a sample keeping times strictly increasing. */
function push(out: BallSample[], s: BallSample): void {
  const l = out[out.length - 1];
  if (l && s.t <= l.t + 1e-12) return;
  out.push(s);
}

/** The ball lying still where it stopped, until a fielder reaches it. */
function restSegment(out: BallSample[], from: number, to: number, p: Vec3, dt: number): void {
  for (let t = from; t < to - 1e-9; t += dt) push(out, { t, p: v3(p.x, BALL_R, p.z), v: ZERO });
}

/**
 * The ball in his hands from `from`: held where it was gathered until `liftT` (a diving stop: until he gets up), then
 * brought up into the hand over LIFT_S, then it moves with him.
 */
function inHandSegment(out: BallSample[], from: number, to: number, start: Vec3, hand: (t: number) => XZ, dt: number, liftT = from, windUpT = Infinity): void {
  for (let t = from; t < to - 1e-9; t += dt) {
    const h = hand(t);
    const k = Math.min(1, Math.max(0, (t - liftT) / LIFT_S));
    const w = k * k * (3 - 2 * k);
    // The wind-up takes the ball back and up to the release height (none when he runs it in: it stays in his hand).
    const span = to - windUpT;
    const q = Number.isFinite(windUpT) && span > 1e-9 ? Math.min(1, Math.max(0, (t - windUpT) / span)) : 0;
    const y = start.y + (HAND_H - start.y) * w + (THROW_RELEASE_H - HAND_H) * q * q * (3 - 2 * q);
    push(out, { t, p: v3(start.x + (h.x - start.x) * w, y, start.z + (h.z - start.z) * w), v: ZERO });
  }
}

/** A ballistic arc from (from, h0) to (to, h1) over [t0, t1]. */
function arc(out: BallSample[], t0: number, t1: number, from: XZ, h0: number, to: XZ, h1: number, dt: number): void {
  const T = t1 - t0;
  if (T <= 1e-6) return;
  const vx = (to.x - from.x) / T;
  const vz = (to.z - from.z) / T;
  const vy0 = (h1 - h0 + 0.5 * G * T * T) / T;
  for (let t = t0; t < t1 - 1e-9; t += dt) {
    const tau = t - t0;
    push(out, { t, p: v3(from.x + vx * tau, h0 + vy0 * tau - 0.5 * G * tau * tau, from.z + vz * tau), v: v3(vx, vy0 - G * tau, vz) });
  }
}

/** The throw (or the run in with the ball), then the receiver bringing it to the stumps by returnT. */
function throwSegment(out: BallSample[], r: Return, runner: (t: number) => XZ, receiver: ((t: number) => XZ) | null, dt: number): void {
  if (r.carried) {
    // In his hand as he runs it in, to the stumps at returnT.
    for (let t = r.releaseT; t <= r.returnT + 1e-9; t += dt) {
      const h = runner(Math.min(t, r.returnT));
      push(out, { t: Math.min(t, r.returnT), p: v3(h.x, HAND_H, h.z), v: ZERO });
    }
    const h = runner(r.returnT);
    push(out, { t: r.returnT, p: v3(h.x, HAND_H, h.z), v: ZERO });
    return;
  }
  if (r.bounce) {
    arc(out, r.releaseT, r.bounce.t, r.from, THROW_RELEASE_H, r.bounce.p, BALL_R, dt);
    arc(out, r.bounce.t, r.arriveT, r.bounce.p, BALL_R, r.to, THROW_TAKE_H, dt);
  } else arc(out, r.releaseT, r.arriveT, r.from, THROW_RELEASE_H, r.to, THROW_TAKE_H, dt);
  push(out, { t: r.arriveT, p: v3(r.to.x, THROW_TAKE_H, r.to.z), v: ZERO });
  if (r.returnT > r.arriveT + 1e-9) {
    // A throw off line: the receiver takes it and brings it to the stumps.
    // In his gloves, where he took it relative to his body, as he runs it in.
    const body0 = receiver ? receiver(r.arriveT) : r.to;
    const hold = { x: r.to.x - body0.x, z: r.to.z - body0.z };
    const ballAt = (t: number) => {
      if (!receiver) {
        const k = (t - r.arriveT) / (r.returnT - r.arriveT);
        return { x: r.to.x + (r.home.x - r.to.x) * k, z: r.to.z + (r.home.z - r.to.z) * k };
      }
      const b = receiver(t);
      return { x: b.x + hold.x, z: b.z + hold.z };
    };
    for (let t = r.arriveT + dt; t < r.returnT - 1e-9; t += dt) {
      const q = ballAt(t);
      push(out, { t, p: v3(q.x, THROW_TAKE_H, q.z), v: ZERO });
    }
    const q = ballAt(r.returnT);
    push(out, { t: r.returnT, p: v3(q.x, THROW_TAKE_H, q.z), v: ZERO });
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The loose ball
// ---------------------------------------------------------------------------------------------------------------

interface Loose {
  /** The loose ball from the touch (the integrator's samples), its bounces and any rope crossing. */
  samples: BallSample[];
  bounces: Array<{ t: number; p: Vec3 }>;
  boundary: { t: number; p: Vec3; onFull: boolean } | null;
}

/** The ball off the hands after a drop, a fumble or a parry, carried on by the one integrator. */
function looseBall(c: Chance, how: 'dropped' | 'misfield' | 'parried', vin: Vec3, rng: Sfc32 | null): Loose {
  const L = LOOSE[how];
  const pick = (r: readonly [number, number], u: number) => r[0] + (r[1] - r[0]) * u;
  const uKeep = rng ? rng.float() : 0.5;
  const uTurn = rng ? rng.float() : 0.5;
  const side = rng ? (rng.float() < 0.5 ? -1 : 1) : 1;
  const uUp = rng ? rng.float() : 0.5;
  const vh = Math.sqrt(vin.x * vin.x + vin.z * vin.z);
  const dir = vh > 1e-6 ? { x: vin.x / vh, z: vin.z / vh } : unit(c.fielder, c.p);
  const turn = side * pick(L.turnDeg, uTurn) * DEG;
  const cs = dcos(turn);
  const sn = dsin(turn);
  const out = { x: dir.x * cs - dir.z * sn, z: dir.x * sn + dir.z * cs };
  const speed = pick(L.keep, uKeep) * speedOf(vin);
  const start = { t: c.t, p: v3(c.p.x, Math.max(BALL_R, c.p.y), c.p.z), v: v3(out.x * speed, pick(L.upMps, uUp), out.z * speed), spin: ZERO };
  const r = simulate(start);
  const samples = r.samples;
  if (samples[samples.length - 1].t < r.end.t - 1e-12) samples.push({ t: r.end.t, p: r.end.p, v: r.end.v });
  return { samples, bounces: r.bounces.map((b) => ({ t: b.t, p: b.p })), boundary: r.boundary };
}

/** The first moment a fielder free to move at `from` from `freeT` (from standing) gathers the loose ball on his feet. */
function gatherLoose(a: Athletics, from: XZ, freeT: number, loose: Loose): { t: number; k: number; p: Vec3; dist: number } | null {
  const s = loose.samples;
  for (let k = 0; k < s.length; k++) {
    const b = s[k];
    if (b.t < freeT - 1e-9) continue;
    if (!insideRope(b.p)) break;
    if (b.p.y > a.stopMaxH) continue;
    const dist = groundDist(from, b.p);
    if (dist <= a.stopReachM + runDistance(a, b.t - freeT) && pullsUp(from, a, b.p, dist, a.stopReachM, b.t - freeT + a.reactionS)) return { t: b.t, k, p: b.p, dist };
  }
  if (loose.boundary) return null;
  const rest = s[s.length - 1];
  const dist = groundDist(from, rest.p);
  const runM = Math.max(0, dist - a.stopReachM);
  const dir = unit(from, rest.p);
  return { t: Math.max(rest.t, freeT + (runM > 0 ? timeToArrive(a, runM, arrivalCap(a, along(from, dir, runM), dir)) : 0)), k: s.length - 1, p: rest.p, dist };
}

// ---------------------------------------------------------------------------------------------------------------
// The play
// ---------------------------------------------------------------------------------------------------------------

/** The ball's ground position at t during the play (struck ball, then any loose ball). */
type GroundTrack = (t: number) => XZ;

function trackOf(samples: BallSample[]): GroundTrack {
  return (t: number) => {
    if (samples.length === 0) return { x: 0, z: 0 };
    if (t <= samples[0].t) return { x: samples[0].p.x, z: samples[0].p.z };
    let lo = 0;
    let hi = samples.length - 1;
    if (t >= samples[hi].t) return { x: samples[hi].p.x, z: samples[hi].p.z };
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (samples[mid].t <= t) lo = mid;
      else hi = mid;
    }
    const a = samples[lo];
    const b = samples[hi];
    const u = (t - a.t) / (b.t - a.t || 1);
    return { x: a.p.x + (b.p.x - a.p.x) * u, z: a.p.z + (b.p.z - a.p.z) * u };
  };
}

/** Who comes closest to a ball that beats everyone (for "found the gap" versus "beat the field"). */
function nearestMiss(field: FieldLayout, ball: PostContactBall, tBounce: number, until: number): { fielderId: string; shortfallM: number } | null {
  let best: { fielderId: string; shortfallM: number } | null = null;
  for (const f of field.fielders) {
    const a = athleticsOf(f);
    const L = diveLengths(a);
    let worstOk = Infinity;
    for (let k = 1; k < ball.samples.length; k++) {
      const b = ball.samples[k];
      if (b.t > until) break;
      if (!insideRope(b.p)) break;
      const airborne = b.t < tBounce;
      const maxH = airborne ? a.catchMaxH : a.stopMaxH;
      if (b.p.y > maxH) continue;
      if (!airborne && keeperOutOfRange(f, b.p)) continue;
      const e = b.t - ball.t0;
      const feet = (airborne ? a.catchReachM : a.stopReachM) + coverable(a, e);
      const canDive = airborne ? b.p.y <= a.catchDiveMaxH : b.p.y <= STOP_DIVE_MAX_H;
      const reach = canDive ? Math.max(feet, diveReachM(a, e, airborne ? L.catch : L.stop, airborne ? a.catchReachM : a.stopReachM)) : feet;
      const short = groundDist(f, b.p) - reach;
      if (short < worstOk) worstOk = short;
    }
    if (Number.isFinite(worstOk) && (!best || worstOk < best.shortfallM)) best = { fielderId: f.id, shortfallM: Math.max(0, worstOk) };
  }
  return best;
}

/** How the ball was gathered for the throw, and by whom. */
interface Gathered {
  by: Fielder;
  a: Athletics;
  t: number;
  /** The ball where it was gathered. */
  p: Vec3;
  readyT: number;
  /** Where he throws from. */
  from: XZ;
  /** When the hands bring the ball up (a diving stop: as he gets up). */
  liftT: number;
  /** How he is moving at the gather (he brakes from here): where, which way, how fast. */
  moveAt: XZ;
  moveDir: XZ;
  moveU: number;
  /** A loose ball: his run to it from where he was free to go. */
  run?: Run;
  runFrom?: { t: number; at: XZ };
  dir?: XZ;
}

/**
 * Field one struck ball. `ball` is the post-contact trajectory from the integrator (until rest or the rope); `seed` is
 * the delivery's (it seeds the misfield draws, the fumble and the throw; without one there are no misfields and the
 * throws are exact). Deterministic: a pure function of the field, the trajectory and the seed.
 */
export function simulateFielding(field: FieldLayout, ball: PostContactBall, opts: { seed?: string } = {}): FieldingResult {
  const t0 = ball.t0;
  const dt = stepOf(ball.samples);
  const tBounce = firstGroundT(ball);
  const fielders = field.fielders;
  const ath = new Map(fielders.map((f) => [f.id, athleticsOf(f)] as const));
  const events: SimEvent[] = [];
  const bouncesBefore = (t: number) => {
    for (const b of ball.bounces) if (b.t < t - 1e-9) events.push({ t: b.t, kind: 'ball_bounce', p: b.p });
  };
  const streams = new Map<string, Sfc32 | null>();
  /** A fielder's stream with the misfield draw already taken (null without a seed). */
  const streamOf = (id: string): Sfc32 | null => {
    if (!streams.has(id)) {
      const s = opts.seed ? fielderStream(opts.seed, id) : null;
      s?.float();
      streams.set(id, s);
    }
    return streams.get(id)!;
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
    const paths = buildPaths(field, ath, t0, deadT + 1, trackOf(tail), { primary: { chance: c, action: 'catch' }, celebrate: true });
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
      // A fielder who cannot stop it may still get a hand or a boot to it (a parry) before it runs on.
      const pr = !s && Number.isFinite(tBounce) ? firstParry(f, a, ball, tBounce) : null;
      if (s) options.push({ c: s, how: s.dive ? 'dive_stop' : 'stop' });
      else if (pr) options.push({ c: pr, how: 'parried' });
      else if (rest) {
        const cl = collect(f, a, ball, rest);
        if (cl) options.push({ c: cl, how: 'collect' });
      }
    }
    for (const o of options) if (!gather || o.c.t < gather.c.t - 1e-12) gather = o;
    // A clean or diving stop is now and then fumbled.
    if (gather && (gather.how === 'stop' || gather.how === 'dive_stop') && misfielded(fielderClass(gather.c.fielder), gather.c, opts.seed)) gather = { c: gather.c, how: 'misfield' };
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
    const paths = buildPaths(field, ath, t0, crossing.t + 1, trackOf(tail), { chase: { until: crossing.t, nearest } });
    return { play: { kind: 'boundary', runs, t: crossing.t, p: crossing.p }, nearest, paths, ball: tail, events, deadT: crossing.t };
  }

  const { c, how } = gather;
  const ap = approachOf(c, t0);
  const movedM = groundDist(c.fielder, ap.at);
  const loose = how === 'dropped' || how === 'parried' || how === 'misfield';
  const backup = backupOf(field, ath, c, ball);
  const backupPrefix = backup ? backupRun(backup, ath.get(backup.f.id)!, t0, loose ? c.t + LOOSE.reactS : Math.max(t0 + ath.get(backup.f.id)!.reactionS, c.t + 0.4)) : null;

  let got: Gathered;
  let looseTrack: Loose | null = null;
  let gatherer: 'primary' | 'backup' = 'primary';
  let primaryFree: { t: number; at: XZ } | null = null;
  let backupFree: { t: number; at: XZ } | null = null;

  if (!loose) {
    // A clean take: he may be moving; he brakes through the gather and lets it go on the move when ready.
    const readyT = c.t + (c.dive ? PICKUP_S.dive_stop : how === 'collect' ? PICKUP_S.collect : PICKUP_S.stop);
    const u = c.dive ? 0 : ap.u;
    got = { by: c.fielder, a: c.a, t: c.t, p: c.p, readyT, from: brakingAt(c.a, ap.at, ap.dir, u, readyT - c.t), liftT: c.dive ? c.t + DIVE.recoverS - LIFT_S : c.t, moveAt: ap.at, moveDir: ap.dir, moveU: u };
  } else {
    // The ball runs on off his hands (or boot); he recovers and goes after it, unless his back-up is there first.
    looseTrack = looseBall(c, how, ball.samples[c.k].v, streamOf(c.fielder.id));
    const br = brakeOf(c.a, ap.at, ap.dir, ap.u);
    primaryFree = c.dive ? { t: c.t + DIVE.recoverS, at: ap.at } : { t: c.t + Math.max(LOOSE.reactS, br.T), at: br.to };
    const mine = gatherLoose(c.a, primaryFree.at, primaryFree.t, looseTrack);
    let theirs: ReturnType<typeof gatherLoose> = null;
    if (backup && backupPrefix) {
      // The back-up has been running to his spot; he sees the ball spill, pulls up, and goes for it from there.
      backupFree = { t: backupPrefix.last.t, at: { x: backupPrefix.last.x, z: backupPrefix.last.z } };
      theirs = gatherLoose(ath.get(backup.f.id)!, backupFree.at, backupFree.t, looseTrack);
    }
    const take: 'primary' | 'backup' | null = theirs && (!mine || theirs.t < mine.t - 1e-9) ? 'backup' : mine ? 'primary' : null;
    const looseSeen = trackOf(looseTrack.samples);
    if (!take) {
      // Nobody gets to it before the rope.
      const bd = looseTrack.boundary!;
      const groundedBefore = Number.isFinite(tBounce) || looseTrack.bounces.some((b) => b.t < bd.t - 1e-9);
      const runs: 4 | 6 = bd.onFull && !groundedBefore ? 6 : 4;
      bouncesBefore(c.t);
      for (const b of looseTrack.bounces) if (b.t < bd.t - 1e-9) events.push({ t: b.t, kind: 'ball_bounce', p: b.p });
      events.push({ t: bd.t, kind: 'boundary', runs, p: bd.p });
      const tail = ball.samples.slice(0, c.k + 1);
      for (const s of looseTrack.samples) if (s.t > c.t + 1e-9 && s.t <= bd.t + 1e-9) push(tail, s);
      const nearest = { fielderId: c.fielder.id, shortfallM: 0 };
      const paths = buildPaths(field, ath, t0, bd.t + 1, trackOf(tail), {
        primary: { chance: c, action: 'drop', ap, free: primaryFree, chaseLoose: looseSeen, chaseUntil: bd.t },
        chase: { until: bd.t, nearest },
        ...(backup && backupPrefix ? { backup: { f: backup.f, spot: backup.spot, prefix: backupPrefix, chaseLoose: looseSeen, chaseUntil: bd.t } } : {}),
      });
      return { play: { kind: 'boundary', runs, t: bd.t, p: bd.p }, nearest, paths, ball: tail, events, deadT: bd.t };
    }
    gatherer = take;
    const g = take === 'backup' ? theirs! : mine!;
    const by = take === 'backup' ? backup!.f : c.fielder;
    const a = ath.get(by.id)!;
    const free = take === 'backup' ? backupFree! : primaryFree;
    const dir = unit(free.at, g.p, ap.dir);
    const runM = Math.max(0, g.dist - a.stopReachM);
    const run = planRun(a, runM, Math.max(0, g.t - free.t));
    const at = along(free.at, dir, runM);
    const u = runM > 1e-9 ? runAt(run, Math.min(run.T, g.t - free.t)).v : 0;
    const readyT = g.t + PICKUP_S.stop;
    got = { by, a, t: g.t, p: g.p, readyT, from: brakingAt(a, at, dir, u, readyT - g.t), liftT: g.t, run, runFrom: free, dir, moveAt: at, moveDir: dir, moveU: u };
  }

  // The return: thrown on the move from where he is at the release (released later when the receiver is not yet
  // there, so from further on), or run in from where he pulled up. The throw's variation is drawn once.
  const rng = streamOf(got.by.id);
  const draws: ThrowDraws | null = rng ? { err: rng.normal(), bounce: rng.float() } : null;
  const busy = new Set<string>(got.by.id === c.fielder.id ? [] : [c.fielder.id]);
  const stop = brakeOf(got.a, got.moveAt, got.moveDir, got.moveU);
  const carry = { at: stop.to, t: Math.max(got.readyT, got.t + stop.T) };
  const where = (t: number) => brakingAt(got.a, got.moveAt, got.moveDir, got.moveU, t - got.t);
  // The release moves only later, until he lets it go from where he is at that moment.
  let releaseAt = got.readyT;
  let ret = planReturn(field, got.by, got.a, where(releaseAt), releaseAt, carry, t0, draws, busy);
  for (let i = 0; i < 16 && !ret.carried && ret.releaseT > releaseAt + 1e-9; i++) {
    releaseAt = ret.releaseT;
    ret = planReturn(field, got.by, got.a, where(releaseAt), releaseAt, carry, t0, draws, busy);
  }
  got.from = ret.carried ? carry.at : ret.from;
  bouncesBefore(c.t);
  events.push({ t: c.t, kind: 'field', fielderId: c.fielder.id, p: c.p });
  if (looseTrack) for (const b of looseTrack.bounces) if (b.t < got.t - 1e-9) events.push({ t: b.t, kind: 'ball_bounce', p: b.p });
  if (!ret.carried) events.push({ t: ret.releaseT, kind: 'throw', fielderId: got.by.id, p: v3(got.from.x, THROW_RELEASE_H, got.from.z) });
  if (ret.bounce) events.push({ t: ret.bounce.t, kind: 'ball_bounce', p: v3(ret.bounce.p.x, BALL_R, ret.bounce.p.z) });

  // The ball: struck until the take; loose until the gather; in hand; thrown (or run in).
  const tail = ball.samples.slice(0, c.k + 1);
  const restEnd = tail[tail.length - 1];
  if (how === 'collect' && restEnd.t < c.t - 1e-9) restSegment(tail, restEnd.t + dt, c.t + 1e-9, restEnd.p, dt);
  if (looseTrack) {
    for (const s of looseTrack.samples) if (s.t > c.t + 1e-9 && s.t <= got.t + 1e-9) push(tail, s);
    const lastLoose = tail[tail.length - 1];
    if (lastLoose.t < got.t - 1e-9) restSegment(tail, lastLoose.t + dt, got.t + 1e-9, lastLoose.p, dt);
  }
  const looseSeen = looseTrack ? trackOf(looseTrack.samples) : null;
  const paths = buildPaths(field, ath, t0, ret.returnT + 0.6, trackOf(tail), {
    primary: { chance: c, action: loose ? 'drop' : 'pickup', ap, ...(loose && primaryFree && looseSeen ? { free: primaryFree, chaseLoose: looseSeen, chaseUntil: got.t } : {}) },
    gathered: { got, ret, gatherer },
    receivers: ret,
    ...(backup && backupPrefix ? { backup: { f: backup.f, spot: backup.spot, prefix: backupPrefix, ...(looseSeen ? { chaseLoose: looseSeen, chaseUntil: got.t } : {}) } } : {}),
  });
  const handOf = (id: string) => {
    const p = paths.find((x) => x.fielderId === id)!;
    return (t: number) => pathPos(p, t);
  };
  const gatheredAt = tail[tail.length - 1].p;
  inHandSegment(tail, got.t + dt, ret.releaseT, gatheredAt, handOf(got.by.id), dt, got.liftT, ret.carried ? Infinity : Math.max(got.liftT + LIFT_S, ret.releaseT - WIND_UP_S));
  throwSegment(tail, ret, handOf(got.by.id), ret.carried || !ret.receiverId ? null : handOf(ret.receiverId), dt);

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

/** The quickest other fielder to the take (not the keeper or bowler), and his spot just beyond it on the ball's line. */
function backupOf(field: FieldLayout, ath: Map<string, Athletics>, c: Chance, ball: PostContactBall): { f: Fielder; spot: XZ } | null {
  let best: { f: Fielder; t: number } | null = null;
  for (const f of field.fielders) {
    if (f.id === c.fielder.id || f.role === 'keeper' || f.role === 'bowler') continue;
    const t = timeToCover(ath.get(f.id)!, groundDist(f, c.p));
    if (!best || t < best.t - 1e-12) best = { f, t };
  }
  if (!best) return null;
  const v = ball.samples[c.k].v;
  const dir = unit({ x: 0, z: 0 }, { x: v.x, z: v.z }, unit(STRIKER_STUMPS, c.p));
  return { f: best.f, spot: insideBy(along(c.p, dir, BACKUP_BEHIND_M), INSIDE_R - 1) };
}

/** The back-up's run to his spot from his reaction until `until`, pulled up to a stop (the gather decision reads where he is then). */
function backupRun(b: { f: Fielder; spot: XZ }, a: Athletics, t0: number, until: number): PathBuilder {
  const pb = new PathBuilder(b.f);
  pb.at(t0, b.f.x, b.f.z, 'set');
  const spot = b.spot;
  pb.steer(a, t0 + a.reactionS, until, () => spot, a.topSpeed, 'run', 'run');
  return pb;
}

interface PathPlan {
  primary?: {
    chance: Chance;
    action: FielderAction;
    ap?: Approach;
    /** After a drop: when and where he is free to chase the loose ball, the loose ball, and until when he chases it. */
    free?: { t: number; at: XZ };
    chaseLoose?: GroundTrack;
    chaseUntil?: number;
  };
  gathered?: { got: Gathered; ret: Return; gatherer: 'primary' | 'backup' };
  receivers?: Return;
  /** The back-up: his spot, his path already run to it (until he pulled up), and the loose ball he then chases. */
  backup?: { f: Fielder; spot: XZ; prefix: PathBuilder; chaseLoose?: GroundTrack; chaseUntil?: number };
  chase?: { until: number; nearest: { fielderId: string; shortfallM: number } | null };
  celebrate?: boolean;
}

function buildPaths(field: FieldLayout, ath: Map<string, Athletics>, t0: number, endT: number, ballTrack: GroundTrack, plan: PathPlan): FielderPath[] {
  const out: FielderPath[] = [];
  const primaryId = plan.primary?.chance.fielder.id ?? null;
  const got = plan.gathered?.got ?? null;
  const ret = plan.gathered?.ret ?? null;
  const backupId = plan.backup?.f.id ?? null;
  const chasers = new Set<string>();
  if (plan.chase) {
    const toward = ballTrack(plan.chase.until);
    const ranked = field.fielders
      .filter((f) => f.role !== 'keeper' && f.role !== 'bowler' && f.id !== primaryId && f.id !== backupId)
      .map((f) => ({ f, d: groundDist(f, toward) }))
      .sort((a, b) => a.d - b.d || (a.f.id < b.f.id ? -1 : 1));
    for (const r of ranked.slice(0, 2)) chasers.add(r.f.id);
    const near = plan.chase.nearest?.fielderId;
    if (near && near !== primaryId && near !== backupId && field.fielders.some((f) => f.id === near && f.role !== 'keeper' && f.role !== 'bowler')) chasers.add(near);
  }
  // Someone backs up the throw behind the stumps it goes to.
  let throwBackerId: string | null = null;
  let throwBackSpot: XZ | null = null;
  if (ret && !ret.carried) {
    throwBackSpot = insideBy(along(ret.stumps, unit(ret.from, ret.stumps), THROW_BACKUP_M), INSIDE_R - 1);
    let best = Infinity;
    for (const f of field.fielders) {
      if (f.id === primaryId || f.id === backupId || f.id === got?.by.id || f.role === 'keeper' || f.role === 'bowler' || chasers.has(f.id)) continue;
      const d = groundDist(f, throwBackSpot);
      if (d < best && d < 40) {
        best = d;
        throwBackerId = f.id;
      }
    }
  }
  const settleT = plan.chase?.until ?? got?.t ?? plan.primary?.chance.t ?? endT;

  for (const f of field.fielders) {
    const a = ath.get(f.id)!;
    const go = t0 + a.reactionS;
    let pb = new PathBuilder(f);
    pb.at(t0, f.x, f.z, 'set');
    if (plan.primary && f.id === primaryId) primaryPath(pb, a, t0, plan, endT);
    else if (plan.backup && f.id === backupId) {
      const b = plan.backup;
      pb = b.prefix;
      if (got && plan.gathered!.gatherer === 'backup') throwerTail(pb, a, got, ret!, endT);
      else if (b.chaseLoose && b.chaseUntil !== undefined) {
        // He joins the chase for the loose ball until it is gathered or gone.
        const loose = b.chaseLoose;
        pb.steer(a, pb.last.t, b.chaseUntil, (t) => insideBy(loose(t), INSIDE_R - 1));
      }
    } else if (f.role === 'keeper' || f.role === 'bowler') {
      const stumps = f.role === 'keeper' ? STRIKER_STUMPS : BOWLER_STUMPS;
      const spot = receiverSpot(f, stumps);
      if (plan.celebrate) {
        // Up to the stumps while the ball is in the air, pulled up at the catch, then the celebration.
        const c = plan.primary!.chance;
        pb.steer(a, go, c.t, () => spot);
        pb.holdTo(Math.max(pb.last.t, c.t + 0.3), 'celebrate');
        pb.at(pb.last.t, pb.last.x, pb.last.z, 'celebrate');
      } else {
        pb.runPlanned(planRun(a, groundDist(f, spot), Infinity), go, unit(f, spot));
        const r = plan.receivers;
        if (r && !r.carried && r.receiverId === f.id && r.takeAt) receiveThrow(pb, a, r);
      }
    } else if (chasers.has(f.id)) {
      // Chase it down to the rope: aim at where the ball will be a moment from now (so the run curves with it).
      const until = plan.chase!.until;
      pb.steer(a, go, until, (t) => insideBy(ballTrack(Math.min(until, t + 0.6)), BOUNDARY_R - 1.5));
    } else if (f.id === throwBackerId && throwBackSpot) {
      const spot = throwBackSpot;
      pb.steer(a, go, ret!.arriveT, () => spot);
    } else {
      // The rest of the field closes in on the ball: a few urgent steps, curving with it, then he stops to watch.
      const cls = fielderClass(f);
      const capM = cls === 'deep' ? CLOSE_IN_M.deep : cls === 'ring' ? CLOSE_IN_M.ring : CLOSE_IN_M.close;
      pb.steer(
        a,
        go,
        Math.max(go + 0.6, Math.min(settleT, go + 2.5)),
        (t) => {
          const b = ballTrack(t + 0.5);
          const d = groundDist(f, b);
          return insideBy(along(f, unit(f, b), Math.min(capM, Math.max(0, d - 2))), INSIDE_R - 1);
        },
        a.topSpeed * CLOSE_IN_SPEED,
      );
    }
    pb.holdTo(Math.max(pb.last.t, endT), pb.last.action === 'run' ? 'idle' : pb.last.action);
    out.push({ fielderId: f.id, samples: pb.samples });
  }
  return out;
}

/** The keeper or bowler takes the throw where it arrives (moving across as late as he can), then runs it in until he can break the stumps. */
function receiveThrow(pb: PathBuilder, a: Athletics, r: Return): void {
  const take = r.takeAt!;
  const d = groundDist(pb.last, take);
  if (d > 0.05) {
    const move = planRun(a, d, Infinity);
    const start = Math.max(pb.last.t, r.arriveT - move.T);
    pb.holdTo(start, 'idle');
    pb.runPlanned(move, start, unit(pb.last, take), 'run');
  }
  pb.holdTo(Math.max(pb.last.t, r.arriveT), 'idle');
  const back = groundDist(r.to, r.home);
  if (r.returnT > r.arriveT + 1e-9 && back > 1e-6) {
    pb.runPlanned(planRun(a, back, Infinity), r.arriveT, unit(r.to, r.home), 'run');
    pb.vx = 0;
    pb.vz = 0;
  }
  pb.holdTo(Math.max(pb.last.t, r.returnT), 'idle');
}

/** The fielder going for the ball: the run, the take (or the dive), and what follows it. */
function primaryPath(pb: PathBuilder, a: Athletics, t0: number, plan: PathPlan, endT: number): void {
  const p = plan.primary!;
  const c = p.chance;
  const ap = p.ap ?? approachOf(c, t0);
  if (c.dive) {
    // Drawn from the take-off (or, for a near-instant lunge, from DIVE_DRAW_MIN_S back on his run).
    const drawT = diveDrawT(c.takeoffT, c.t, ap.runStartT);
    if (drawT > ap.runStartT) pb.runPlanned(ap.run, ap.runStartT, ap.dir, 'run', drawT);
    pb.holdTo(drawT, 'run');
    const from = drawT >= c.takeoffT ? ap.runEnd : along(c.fielder, ap.dir, runAt(ap.run, drawT - ap.runStartT).s);
    pb.at(drawT, from.x, from.z, 'dive');
    pb.at(c.t, ap.at.x, ap.at.z, p.action);
    pb.vx = 0;
    pb.vz = 0;
  } else {
    pb.runPlanned(ap.run, ap.runStartT, ap.dir, 'run', c.t);
    pb.holdTo(c.t, 'run');
    pb.at(c.t, ap.at.x, ap.at.z, p.action);
  }
  if (p.action === 'catch') {
    // Pulled up from the run (or up from the dive) before he celebrates.
    pb.brakeNow(a, 'catch');
    pb.holdTo(Math.max(pb.last.t, c.t + (c.dive ? DIVE.recoverS : 0.3)), 'catch');
    pb.at(pb.last.t, pb.last.x, pb.last.z, 'celebrate');
    return;
  }
  const g = plan.gathered;
  if (p.action === 'pickup') {
    if (g) throwerTail(pb, a, g.got, g.ret, endT);
    return;
  }
  // After a drop, a fumble or a parry: pulled up (or up from the dive), then after the loose ball.
  pb.brakeNow(a, 'drop');
  if (!p.free || !p.chaseLoose || p.chaseUntil === undefined) return;
  pb.holdTo(p.free.t, 'drop');
  if (g && g.gatherer === 'primary') throwerTail(pb, a, g.got, g.ret, endT);
  else {
    const loose = p.chaseLoose;
    pb.steer(a, p.free.t, p.chaseUntil, (t) => insideBy(loose(t), INSIDE_R - 1));
  }
}

/**
 * The gatherer: for a loose ball, the run to it (from where he was free to go); the pickup at the gather, braking if
 * he is moving; the throw once planted (or the run in to his own stumps); then he watches.
 */
function throwerTail(pb: PathBuilder, a: Athletics, got: Gathered, ret: Return, endT: number): void {
  if (got.run && got.runFrom && got.dir) pb.runPlanned(got.run, got.runFrom.t, got.dir, 'run', got.t);
  const at = pb.pos(got.t);
  pb.holdTo(got.t, 'run');
  pb.at(got.t, at.x, at.z, 'pickup');
  if (ret.carried) {
    pb.brakeNow(a, 'pickup');
    pb.holdTo(ret.releaseT, 'pickup');
    const d = groundDist(pb.last, ret.stumps) - RECEIVER_SHORT_M;
    if (d > 0.05) pb.runPlanned(planRun(a, d, ret.returnT - pb.last.t), pb.last.t, unit(pb.last, ret.stumps), 'run', ret.returnT);
    pb.brakeNow(a, 'idle');
    pb.holdTo(Math.max(pb.last.t, ret.returnT), 'idle');
  } else {
    // Gathered on the move, he brakes through the wind-up and lets it go at the release (from got.from), braking on.
    const u = Math.sqrt(pb.vx * pb.vx + pb.vz * pb.vz);
    if (u > 1e-9) {
      const dir = { x: pb.vx / u, z: pb.vz / u };
      const br = brakeOf(a, at, dir, u);
      const stopT = got.t + br.T;
      const until = Math.min(stopT, ret.releaseT);
      for (let t = got.t + PATH_DT; t < until - 1e-9; t += PATH_DT) {
        const q = t - got.t;
        const s = u * q - 0.5 * br.D * q * q;
        pb.at(t, at.x + dir.x * s, at.z + dir.z * s, 'pickup');
      }
      if (stopT <= ret.releaseT + 1e-9) {
        pb.at(stopT, br.to.x, br.to.z, 'pickup');
        pb.vx = 0;
        pb.vz = 0;
        pb.holdTo(ret.releaseT, 'pickup');
        pb.at(ret.releaseT, got.from.x, got.from.z, 'throw');
      } else {
        pb.at(ret.releaseT, got.from.x, got.from.z, 'throw');
        const v = u - br.D * (ret.releaseT - got.t);
        pb.brake(ret.releaseT, v, dir, br.D, 'idle');
      }
      pb.vx = 0;
      pb.vz = 0;
    } else {
      pb.holdTo(ret.releaseT, 'pickup');
      pb.at(ret.releaseT, pb.last.x, pb.last.z, 'throw');
    }
    pb.holdTo(Math.max(pb.last.t, ret.releaseT + 0.4), 'idle');
  }
  pb.holdTo(Math.max(pb.last.t, endT), 'idle');
}

// ---------------------------------------------------------------------------------------------------------------
// The keeper takes a ball that passes the bat
// ---------------------------------------------------------------------------------------------------------------

export interface KeeperTake {
  t: number;
  p: Vec3;
  dive: boolean;
  path: FielderPath;
  /** How far the ball passed beyond his reach (m): 0 when he got to it. Practice has no byes, so it is still dead there. */
  shortM: number;
}

/**
 * The keeper gathers a delivery the batter missed or left. `samples` continue the delivery past the stumps (from the
 * integrator); the keeper watches it from release and moves across from `watchFromT`, in his crouched shuffle, then
 * dives if he must (the same dive budget as everyone's). Practice has no byes, so the ball is dead in his gloves; a
 * ball beyond his dive is still dead as it reaches him, and `shortM` says by how much he could not reach it.
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
  const side = take.p.x - keeper.x < 0 ? -1 : 1;
  const dir = { x: side, z: 0 };
  const startT = Math.min(take.t, watchFromT + a.reactionS);
  const budget = take.t - startT;
  const e = take.t - watchFromT;
  const pb = new PathBuilder(keeper);
  pb.at(startT, keeper.x, keeper.z, 'set');
  const feetNeed = Math.max(0, lateral - a.catchReachM);
  let dive = false;
  let shortM = 0;
  if (feetNeed <= runDistance(a, budget) + 1e-9) {
    // Across on his feet (the crouched shuffle), set if there is time.
    const run = planRun(a, feetNeed, budget);
    pb.runPlanned(run, startT, dir, 'set');
    pb.holdTo(take.t, 'set');
    pb.at(take.t, keeper.x + side * feetNeed, keeper.z, 'catch');
    if (run.u > 0) pb.brake(take.t, run.u, dir, a.decel, 'catch');
  } else {
    const hipMax = diveLengths(a).catch;
    const plan = diveFor(a, e, lateral, hipMax, a.catchReachM);
    dive = plan !== null || diveTakeoffs(a, e).length > 0;
    let runM: number;
    let hipM: number;
    let takeoffT: number;
    if (plan) {
      runM = plan.runM;
      hipM = plan.hipM;
      takeoffT = watchFromT + plan.takeoffE;
    } else {
      // Beyond him: he goes full length at it and the ball is past his gloves.
      let bestTau = Math.max(a.reactionS, e - a.diveMinS);
      let bestReach = -Infinity;
      let bestHand: number = DIVE.handM;
      for (const tau of diveTakeoffs(a, e)) {
        const hand = handReach(a, e - tau, a.catchReachM);
        const reach = coverable(a, tau) + hipCap(a, tau, e, hipMax) + hand;
        if (reach > bestReach + 1e-12) {
          bestReach = reach;
          bestTau = tau;
          bestHand = hand;
        }
      }
      runM = coverable(a, bestTau);
      hipM = Math.max(0, Number.isFinite(bestReach) ? bestReach - bestHand - runM : 0);
      takeoffT = watchFromT + bestTau;
      shortM = Math.max(0, lateral - (Number.isFinite(bestReach) ? bestReach : a.catchReachM));
    }
    if (dive) {
      const run = planRun(a, runM, Math.max(0, takeoffT - startT));
      const drawT = diveDrawT(takeoffT, take.t, startT);
      if (drawT > startT) pb.runPlanned(run, startT, dir, 'set', drawT);
      pb.holdTo(drawT, 'set');
      const s = drawT >= takeoffT ? runM : runAt(run, drawT - startT).s;
      pb.at(drawT, keeper.x + side * s, keeper.z, 'dive');
      pb.at(take.t, keeper.x + side * (runM + hipM), keeper.z, 'catch');
    } else {
      // It is on him before he can move: he takes it where he stands, or it is past him.
      shortM = Math.max(0, lateral - a.catchReachM);
      pb.at(take.t, keeper.x, keeper.z, 'catch');
    }
  }
  // Height (PHYS2 5f, WEB-FIELD finding; lead ruling 2026-11-04): his gloves reach catchMaxH standing and catchDiveMaxH
  // at full stretch, so a ball above them passed him too. shortM is then the distance from the ball to what he could
  // reach (lateral and vertical shortfall together). Only shortM changes: the take's time and place, his path and the
  // dead ball (no byes) are the same. Before, the check was lateral only, so a dive under a ball 2.19 m up read clean.
  const highM = Math.max(0, take.p.y - (dive ? a.catchDiveMaxH : a.catchMaxH));
  if (highM > 0) shortM = Math.hypot(shortM, highM);
  pb.holdTo(Math.max(pb.last.t, take.t + (dive ? DIVE.recoverS : 0.5), endT ?? 0), 'idle');
  return { t: take.t, p: take.p, dive, path: { fielderId: keeper.id, samples: pb.samples }, shortM };
}

/** Everyone but the keeper stays set (a ball that never leaves the cut strip, or a delivery that was left or missed). */
export function standingPaths(field: FieldLayout, endT: number, except: ReadonlySet<string> = new Set(), celebrate = false): FielderPath[] {
  return field.fielders
    .filter((f) => !except.has(f.id))
    .map((f) => {
      const pb = new PathBuilder(f);
      if (celebrate && (f.role === 'keeper' || f.role === 'bowler')) pb.at(Math.max(0.01, endT - 0.6), f.x, f.z, 'celebrate');
      pb.at(endT, f.x, f.z, celebrate && (f.role === 'keeper' || f.role === 'bowler') ? 'celebrate' : 'idle');
      return { fielderId: f.id, samples: pb.samples };
    });
}
