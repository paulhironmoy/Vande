/**
 * Every match ball flight comes from the one physics engine (src/physics), never a drawn curve:
 *
 *   buildFlight  the delivery. flightFromPath() finds the release that reproduces the server's BallPath and meets
 *                the contact plane at exactly releaseToContactMs (the number taps are validated against); a ball
 *                nothing touches flies on (simulate) into the keeper's gloves.
 *   aimPath      after the bat, outcome first. aimShot() finds the launch that takes the ball where the result says
 *                (a fielder's hands, rest at a spot, over the rope, into the stands); the choreography is timed
 *                from its arrival.
 *   flyFrom      a launch with nothing to reach (a sealed live shot): simulate() alone.
 *
 * The match draws a right-handed striker, so the physics frame is the world frame. Times are seconds from the start
 * of each simulation. Results are pure and deterministic, and cached: a replay builds every ball's script more than
 * once (the reveal screen and the renderer), and a live shot rebuilds its script at the tap.
 */
import type { BallPath, DeliveryFamily } from '@/contracts';
import type { BallFlight, BallSample, PitchCondition } from '@/contracts/practice';
import { type AimMode, type AimOptions, aimShot } from '@/physics/aim';
import { backspinVector, simulate } from '@/physics/ball';
import { PITCHES, STUMP_R } from '@/physics/constants';
import { type PathFit, flightFromPath } from '@/physics/matchPath';
import { ballAt } from '../practice/frame';
import { BALL_R, CONTACT_Z, PITCH_HALF, RELEASE, keeperPos } from './ground';
import { type Vec3, clamp, v3 } from './math';

// ---------------------------------------------------------------------------------------------------------------
// The seam on screen
// ---------------------------------------------------------------------------------------------------------------

/** Real spin rates strobe at 60 fps: the seam turns about the physics' own axis at a readable rate. */
const MAX_VISUAL_RPS = { pace: 6, spin: 8 } as const;

export interface SeamSpin {
  /** Unit rotation axis (world). */
  spinAxis: Vec3;
  /** Radians per scene ms. */
  spinRate: number;
}

/** The drawn seam from a physics spin vector (rad/s, striker frame); a mirrored world turns an axial vector into (x, −y, −z). */
export function seamSpin(spin: Vec3, family: DeliveryFamily, mirror = false): SeamSpin {
  const mag = Math.hypot(spin.x, spin.y, spin.z);
  const a = mag > 1e-6 ? v3(spin.x / mag, spin.y / mag, spin.z / mag) : v3(1, 0, 0);
  const axis = mirror ? v3(a.x, -a.y, -a.z) : a;
  const rps = Math.min(mag / (Math.PI * 2), family === 'spin' ? MAX_VISUAL_RPS.spin : MAX_VISUAL_RPS.pace);
  return { spinAxis: axis, spinRate: (rps * Math.PI * 2) / 1000 };
}

/** A ball sent along the ground carries no launch spin; it rolls (ω = up × v / r), and the seam turns with it. */
function rollingSpin(v: Vec3): Vec3 {
  return v3(v.z / BALL_R, 0, -v.x / BALL_R);
}

/** First time (s) the samples' z reaches `z`, interpolated; null if they never do. */
function timeAtZ(samples: readonly BallSample[], z: number): number | null {
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    if (a.p.z < z && b.p.z >= z) return a.t + ((z - a.p.z) / (b.p.z - a.p.z)) * (b.t - a.t);
  }
  return null;
}

/** The samples up to time t, ending with one exactly at t (at `p`). */
function cutAt(samples: readonly BallSample[], t: number, p: Vec3): BallSample[] {
  const out: BallSample[] = [];
  let next: BallSample | undefined;
  for (const s of samples) {
    if (s.t < t - 1e-9) out.push(s);
    else {
      next = s;
      break;
    }
  }
  const v = next?.v ?? out[out.length - 1]?.v ?? v3();
  out.push({ t, p: { x: p.x, y: p.y, z: p.z }, v: { x: v.x, y: v.y, z: v.z } });
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// The delivery
// ---------------------------------------------------------------------------------------------------------------

export interface DeliveryFlight {
  path: BallPath;
  family: DeliveryFamily;
  /** The physics flight (1 ms samples, release to just past the stumps) and how closely it reproduces the path. */
  physics: BallFlight & { fit: PathFit };
  /** Release to the keeper's gloves, seconds after release. */
  samples: readonly BallSample[];
  release: Vec3;
  /** Where and when (ms after release) it pitches, if it pitches before the bat; null when the bat meets it on the full (a yorker pitching under the bat, a full toss). */
  bounce: Vec3 | null;
  bounceMs: number | null;
  /** Ms after release when it pitches at all (also behind the contact plane): the seam changes there. */
  pitchMs: number | null;
  /** On the contact plane at exactly contactMs. */
  atBat: Vec3;
  contactMs: number;
  /** A ball nothing touches: when it reaches the front of the striker's stumps (ms after release), and whether it hits them. */
  stumpsMs: number;
  wouldHitStumps: boolean;
  /** A ball nothing touches, in the keeper's gloves. */
  keeper: Vec3;
  keeperMs: number;
  /** Seam spin from the release to the pitch, and off it. */
  seam: { release: SeamSpin; afterBounce: SeamSpin | null };
  /** Position `ms` after release (held at the ends). */
  at(ms: number): Vec3;
}

/** Default flight time when no DeliveryTiming is available (old replays): the fit then solves the speed for it. */
export function defaultFlightMs(path: BallPath): number {
  const speed = clamp(path.speedKph, 50, 165) / 3.6;
  const d = CONTACT_Z - RELEASE.z;
  return Math.round((d / speed) * 1000 * 1.06);
}

export function familyOf(path: BallPath, variant?: string): DeliveryFamily {
  if (variant === 'offspin' || variant === 'legspin') return 'spin';
  if (variant === 'inswing' || variant === 'outswing') return 'swing';
  if (variant) return 'pace';
  return path.speedKph < 100 ? 'spin' : Math.abs(path.swingM) > 0.12 ? 'swing' : 'pace';
}

/** The keeper's gloves are this far in front of the keeper's stance. */
const GLOVES_AHEAD_M = 0.8;
/** Where the ball's centre meets the front of the striker's stumps (a straight hit). */
export const STUMPS_FRONT_Z = PITCH_HALF - STUMP_R - BALL_R;

const flights = new WeakMap<BallPath, Map<string, DeliveryFlight>>();

/** The delivery for a server BallPath, landing on the contact plane at releaseToContactMs (cached per path). */
export function buildFlight(path: BallPath, family: DeliveryFamily, releaseToContactMs?: number, conditions: PitchCondition = 'balanced'): DeliveryFlight {
  const tc = Math.max(250, releaseToContactMs ?? defaultFlightMs(path));
  const key = `${family}|${tc}|${conditions}`;
  const known = flights.get(path)?.get(key);
  if (known) return known;
  const physics = flightFromPath(path, { family, releaseToContactMs: tc, conditions });
  const own = physics.samples;
  const last = own[own.length - 1];
  const takeZ = keeperPos(family).z - GLOVES_AHEAD_M;
  // On past the stumps into the keeper's gloves (a spinner's keeper stands up: the flight already gets there).
  let samples: readonly BallSample[] = own;
  if (last.p.z < takeZ) {
    const on = simulate(
      { t: last.t, p: last.p, v: last.v, spin: physics.spin.afterBounce ?? physics.spin.release },
      { pitch: PITCHES[conditions], untilZ: takeZ, untilT: last.t + 3, stopAtBoundary: false, stopAtRest: true },
    );
    samples = own.concat(on.samples.slice(1));
  }
  const tTake = timeAtZ(samples, takeZ) ?? samples[samples.length - 1].t;
  const keeper = ballAt(samples, tTake)!;
  const pitchT = physics.bounce ? physics.bounce.t : null;
  const before = pitchT !== null && pitchT * 1000 < tc;
  const flight: DeliveryFlight = {
    path,
    family,
    physics,
    samples,
    release: { ...physics.release.p },
    bounce: before ? { ...physics.bounce!.p } : null,
    bounceMs: before ? pitchT! * 1000 : null,
    pitchMs: pitchT !== null ? pitchT * 1000 : null,
    atBat: ballAt(samples, tc / 1000)!,
    contactMs: tc,
    stumpsMs: (timeAtZ(samples, STUMPS_FRONT_Z) ?? physics.stumpsT) * 1000,
    wouldHitStumps: physics.wouldHitStumps,
    keeper,
    keeperMs: tTake * 1000,
    seam: {
      release: seamSpin(physics.spin.release, family),
      afterBounce: physics.spin.afterBounce ? seamSpin(physics.spin.afterBounce, family) : null,
    },
    at: (ms) => ballAt(samples, ms / 1000)!,
  };
  let byPath = flights.get(path);
  if (!byPath) flights.set(path, (byPath = new Map()));
  byPath.set(key, flight);
  return flight;
}

// ---------------------------------------------------------------------------------------------------------------
// After the bat
// ---------------------------------------------------------------------------------------------------------------

export interface BallPathSim {
  /** Seconds from the launch (t = 0). */
  samples: readonly BallSample[];
  seam: SeamSpin;
}

export interface AimedPath extends BallPathSim {
  /** When (s after the launch) and where it meets the target: the catch, the pickup, rest, the rope, the stands. */
  tArrive: number;
  arrive: Vec3;
  /** False when no launch reaches the target (the nearest trajectory is kept, missing by errorM metres). */
  feasible: boolean;
  errorM: number;
}

export interface AimPathOptions extends Omit<AimOptions, 'pitch'> {
  /** Surface for bounces on the pitch strip. */
  conditions?: PitchCondition;
  /** 'arrive': the path ends where it meets the target (caught, picked up, in the stands); 'all': on to rest or the rope. */
  keep?: 'arrive' | 'all';
}

const aims = new Map<string, AimedPath>();
/** About two matches of aims (a ball makes one to four); each holds up to a few thousand samples. */
const AIM_CACHE_SIZE = 96;

/** aimShot from `from` (launched at t = 0) to where the outcome says the ball goes (cached). */
export function aimPath(from: Vec3, target: { p: Vec3; mode: AimMode }, opts: AimPathOptions = {}): AimedPath {
  const key = JSON.stringify([from, target, opts]);
  const known = aims.get(key);
  if (known) return known;
  const { conditions, keep = 'arrive', ...aim } = opts;
  const r = aimShot({ t: 0, p: from }, target, { ...aim, pitch: PITCHES[conditions ?? 'balanced'] });
  const spin = Math.hypot(r.spin.x, r.spin.y, r.spin.z) > 1e-6 ? r.spin : rollingSpin(r.v);
  const out: AimedPath = {
    samples: keep === 'arrive' ? cutAt(r.sim.samples, r.tArrive, r.arrive) : r.sim.samples,
    seam: seamSpin(spin, 'pace'),
    tArrive: r.tArrive,
    arrive: { ...r.arrive },
    feasible: r.feasible,
    errorM: r.errorM,
  };
  if (aims.size >= AIM_CACHE_SIZE) aims.delete(aims.keys().next().value!);
  aims.set(key, out);
  return out;
}

/** A launch with nothing to reach (a sealed live shot): the one integrator alone, for `seconds`. */
export function flyFrom(from: Vec3, v: Vec3, seconds: number, opts: { backspinRps?: number; conditions?: PitchCondition } = {}): BallPathSim {
  const rps = opts.backspinRps ?? 0;
  const spin = rps !== 0 ? backspinVector(v, rps) : v3();
  const sim = simulate({ t: 0, p: from, v, spin }, { pitch: PITCHES[opts.conditions ?? 'balanced'], untilT: seconds, stopAtBoundary: false, stopAtRest: true });
  return { samples: sim.samples, seam: seamSpin(rps !== 0 ? spin : rollingSpin(v), 'pace') };
}
