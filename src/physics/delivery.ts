/**
 * Deliveries: from a plan (variation, length, line, speed) and a bowler to a released ball and its full flight.
 *
 * releaseFor() builds the physical release: hand position (arm, family and the bowler's build), the real release
 * speed, spin (rate and axis per variation), the seam's swing and its landing (seeded). solveRelease() then aims the
 * ball (two angles, Newton's method on the full integrator) so it pitches at plan.lengthM and passes the striker's
 * stumps plane at plan.lineM, with all movement included. flight() returns the contract's BallFlight.
 *
 * Everything runs in the striker's own right-handed frame. BowlerProfile.arm is the real bowling arm; for a
 * left-handed striker it is mirrored (a right-arm bowler becomes left-arm in that frame), so release side, angle,
 * swing and turn all follow. Variations are batter-relative: an outswinger leaves THIS batter, an off-cutter comes
 * into him. Turn is by spin type and (mirrored) arm: an off-break, into the batter, comes from a right-arm finger
 * spinner or a left-arm wrist spinner; the wrong'un (googly or carrom ball) turns the other way.
 */
import type {
  BallFlight,
  BowlerProfile,
  Footwork,
  Handedness,
  PitchCondition,
  PracticeDeliveryPlan,
} from '@/contracts/practice';
import { PRACTICE_SIM_VERSION } from '@/contracts/practice';
import { rngFromKey } from '@/engine/prng';
import { integrateBall, type SimResult } from './ball';
import {
  AUTO_FORWARD_MAX_LENGTH,
  BALL_R,
  CONTACT_PLANE_M,
  G,
  PITCHES,
  PITCH_HALF,
  RELEASE_GEOMETRY,
  SPIN_RPS,
  STUMPS_HALF_W,
  STUMPS_TOP,
  SWING_CS,
  YORKER_MAX_LENGTH,
  type PitchParams,
} from './constants';
import { type Vec3, RAD, dasin, datan2, dcos, dsin, len, v3 } from './vec';

/** Spin split into the delivery's own frame (rad/s): about the line of travel, the vertical, and the side axis. */
export interface SpinParts {
  /** About the direction of travel (rifle spin). Positive turns the ball towards −x (into a right-hander). */
  rifle: number;
  /** About the vertical. Positive drifts the ball towards +x in the air (Magnus). */
  side: number;
  /** About up × travel. Positive is top-spin (dip); negative is back-spin (lift). */
  top: number;
}

/** Everything about the release except its direction, which solveRelease() finds. */
export interface ReleaseSpec {
  p: Vec3;
  speed: number;
  spin: SpinParts;
  spinRps: number;
  /** Signed swing side-force coefficient (+ towards the off side). */
  swingCs: number;
  /** Seam deflection at the first bounce (rad, + towards the off side). */
  seamDev: number;
  /**
   * Presentation only. Pace: the seam's angle to the line of travel about the vertical (deg, + towards the off side;
   * ±18 for swing, 0 upright). Spin: the spin axis's angle from the line of travel towards the top-spin axis (deg).
   * BallFlight.spin carries the exact spin vectors.
   */
  seamDeg: number;
  pitch: PitchParams;
  /** Arm in the striker's frame (after mirroring for a left-handed striker). */
  arm: 'right' | 'left';
  /** Stock turn direction of this bowler in the striker's frame: −1 into the batter, +1 away, 0 for pace. */
  stockTurn: -1 | 0 | 1;
}

export interface FlightArgs {
  plan: PracticeDeliveryPlan;
  bowler: BowlerProfile;
  conditions: PitchCondition;
  seed: string;
  /** The striker's handedness (default right). The plan's line is batter-relative. */
  handedness?: Handedness;
}

function u01(r: { float(): number }): number {
  return r.float();
}
function signed(r: { float(): number }): number {
  return r.float() * 2 - 1;
}

/** Arm in the striker's frame. */
export function frameArm(arm: 'right' | 'left', handedness: Handedness = 'right'): 'right' | 'left' {
  return handedness === 'left' ? (arm === 'right' ? 'left' : 'right') : arm;
}

/** Stock turn of a spinner in the striker's frame: −1 = off-break (into the batter), +1 = leg-break (away). */
export function stockTurnOf(bowler: BowlerProfile, handedness: Handedness = 'right'): -1 | 0 | 1 {
  if (bowler.family !== 'spin') return 0;
  const arm = frameArm(bowler.arm, handedness);
  const finger = (bowler.spinType ?? 'finger') === 'finger';
  return (finger && arm === 'right') || (!finger && arm === 'left') ? -1 : 1;
}

/** Physical release for a plan: position, real speed, spin, swing and seam (direction solved separately). */
export function releaseFor(
  plan: PracticeDeliveryPlan,
  bowler: BowlerProfile,
  conditions: PitchCondition,
  seed: string,
  handedness: Handedness = 'right',
): ReleaseSpec {
  const pitch = PITCHES[conditions];
  const arm = frameArm(bowler.arm, handedness);
  const armSign = arm === 'right' ? 1 : -1;
  const build = rngFromKey(`vande-practice-bowler|${bowler.lookSeed}`);
  const rng = rngFromKey(`vande-practice-delivery|${seed}|${plan.variation}`);
  const geo = bowler.family === 'pace' ? RELEASE_GEOMETRY.pace : RELEASE_GEOMETRY.spin;
  let height = geo.heightMin + (geo.heightMax - geo.heightMin) * u01(build);
  const wide = 0.9 + 0.2 * u01(build);
  const v = plan.variation;
  if (bowler.family === 'pace' && v === 'bouncer') height += 0.04;
  if (bowler.family === 'pace' && v === 'yorker') height -= 0.02;
  const p = v3(armSign * geo.x * wide, height, geo.z);
  const speed = plan.speedKph / 3.6;
  const landing = signed(rng); // which way the seam lands: −1..1
  const wobble = signed(rng); // natural variation of the release
  const sideOf = landing >= 0 ? 1 : -1;
  const sf = pitch.swingFactor;
  let spin: SpinParts;
  let rps: number;
  let swingCs = 0;
  let seamDev = 0;
  let seamDeg = 0;
  let stockTurn: -1 | 0 | 1 = 0;
  if (bowler.family === 'pace') {
    rps = SPIN_RPS.paceBackspin * (1 + 0.08 * wobble);
    spin = { rifle: 0, side: 0, top: -2 * Math.PI * rps };
    seamDev = pitch.seamGrip * landing;
    swingCs = 0.025 * sf * sideOf;
    seamDeg = 6 * sideOf;
    switch (v) {
      case 'outswing':
      case 'inswing': {
        const dir = v === 'outswing' ? 1 : -1;
        swingCs = SWING_CS * sf * dir * (0.9 + 0.2 * u01(rng));
        seamDev = pitch.seamGrip * landing * 0.6;
        seamDeg = 18 * dir;
        break;
      }
      case 'seam': {
        rps = SPIN_RPS.seamBackspin * (1 + 0.06 * wobble);
        spin = { rifle: 0, side: 0, top: -2 * Math.PI * rps };
        swingCs = 0.015 * sf * sideOf;
        seamDev = pitch.seamGrip * 1.7 * sideOf * (0.55 + 0.45 * Math.abs(landing));
        seamDeg = 0;
        break;
      }
      case 'cutter': {
        // Fingers drag across the seam: mostly rifle spin, so it grips and cuts off the pitch.
        const off = u01(rng) < 0.6; // off-cutter (into the batter) or leg-cutter (away)
        rps = SPIN_RPS.cutter * (1 + 0.08 * wobble);
        const w = 2 * Math.PI * rps;
        spin = { rifle: (off ? 1 : -1) * 0.82 * w, side: 0, top: -0.57 * w };
        swingCs = 0;
        seamDev = pitch.seamGrip * landing * 0.4;
        seamDeg = off ? -25 : 25;
        break;
      }
      case 'slower': {
        // Out of the back of the hand: the seam tumbles, a little over-spin, no swing.
        rps = SPIN_RPS.slower * (1 + 0.1 * wobble);
        const w = 2 * Math.PI * rps;
        spin = { rifle: 0.3 * w * sideOf, side: 0, top: 0.95 * w };
        swingCs = 0;
        seamDev = pitch.seamGrip * landing * 0.5;
        seamDeg = 40 * sideOf;
        break;
      }
      case 'bouncer':
        rps = (SPIN_RPS.paceBackspin + 1) * (1 + 0.08 * wobble);
        spin = { rifle: 0, side: 0, top: -2 * Math.PI * rps };
        swingCs = 0.02 * sf * sideOf;
        break;
      case 'yorker':
        swingCs = 0.04 * sf * sideOf;
        seamDev = pitch.seamGrip * landing * 0.5;
        break;
      default:
        break;
    }
  } else {
    stockTurn = stockTurnOf(bowler, handedness);
    const wrist = (bowler.spinType ?? 'finger') === 'wrist';
    rps = (wrist ? SPIN_RPS.wrist : SPIN_RPS.finger) * (1 + 0.05 * wobble);
    let turn: number = stockTurn;
    // Fractions of the spin rate about (rifle, top, side); normalised below.
    let fr = 0.62;
    let ft = 0.55;
    let fs = 0.25;
    switch (v) {
      case 'flighted':
        rps *= 1.05;
        fr = 0.55;
        ft = 0.7;
        fs = 0.3;
        break;
      case 'quicker':
        rps *= 0.9;
        fr = 0.7;
        ft = 0.3;
        fs = 0.15;
        break;
      case 'topspinner':
        fr = 0.25;
        ft = 0.92;
        fs = 0.1;
        break;
      case 'arm_ball':
        // Back-spin with the seam upright: it goes on with the arm instead of turning.
        rps *= 0.8;
        fr = 0.1;
        ft = -0.95;
        fs = 0;
        swingCs = 0.06 * sf * armSign;
        break;
      case 'wrong_un':
        turn = -stockTurn;
        if (wrist) {
          fr = 0.55;
          ft = 0.68;
          fs = 0.2;
        } else {
          rps *= 0.9;
          fr = 0.78;
          ft = 0.3;
          fs = 0.1;
        }
        break;
      default:
        break;
    }
    const n = Math.sqrt(fr * fr + ft * ft + fs * fs);
    const w = 2 * Math.PI * rps;
    // rifle > 0 turns towards −x; turn = −1 is into the batter (−x), so rifle = −turn·|rifle|. Drift opposes turn.
    spin = { rifle: (-turn * fr * w) / n, top: (ft * w) / n, side: (-turn * fs * w) / n };
    seamDev = pitch.seamGrip * landing * 0.3;
    seamDeg = datan2(spin.top, spin.rifle) * RAD;
  }
  return { p, speed, spin, spinRps: rps, swingCs, seamDev, seamDeg, pitch, arm, stockTurn };
}

/** World spin vector for a ball released with horizontal direction (dx, dz) and the given parts. */
export function spinVector(parts: SpinParts, v: Vec3): Vec3 {
  const h = Math.sqrt(v.x * v.x + v.z * v.z) || 1;
  const fx = v.x / h;
  const fz = v.z / h;
  // top axis = up × f = (fz, 0, −fx); side axis = up; rifle axis = f.
  return v3(parts.top * fz + parts.rifle * fx, parts.side, -parts.top * fx + parts.rifle * fz);
}

// ---------------------------------------------------------------------------------------------------------------
// Aiming: pitch at plan.lengthM, pass the stumps plane at plan.lineM
// ---------------------------------------------------------------------------------------------------------------

function launchVelocity(speed: number, theta: number, phi: number): Vec3 {
  const c = dcos(theta);
  return v3(speed * c * dsin(phi), speed * dsin(theta), speed * c * dcos(phi));
}

function shoot(spec: ReleaseSpec, theta: number, phi: number, untilZ: number): SimResult {
  const v = launchVelocity(spec.speed, theta, phi);
  return integrateBall(
    { t: 0, p: spec.p, v, spin: spinVector(spec.spin, v) },
    { swingCs: spec.swingCs, seamDev: spec.seamDev, pitch: spec.pitch, untilZ, untilT: 3, stopAtBoundary: false, stopAtRest: false },
  );
}

function residual(sim: SimResult, zTarget: number, line: number): [number, number] {
  const b = sim.bounces[0];
  const zb = b ? b.p.z : sim.end.p.z + 2; // no bounce yet: aimed too high
  const x = sim.plane ? sim.plane.p.x : sim.end.p.x;
  return [zb - zTarget, x - line];
}

export interface SolvedRelease {
  spec: ReleaseSpec;
  v: Vec3;
  spin: Vec3;
  /** Remaining aiming error (m) at the bounce (z) and the stumps (x). */
  error: [number, number];
}

/** Find the release direction (two angles) for which the full simulation pitches and passes where planned. */
export function solveRelease(spec: ReleaseSpec, plan: PracticeDeliveryPlan): SolvedRelease {
  const zTarget = PITCH_HALF - plan.lengthM;
  const untilZ = Math.max(PITCH_HALF + 0.3, zTarget + 3);
  const D = zTarget - spec.p.z;
  const T = D / (spec.speed * 0.95);
  const vy0 = (BALL_R - spec.p.y + 0.5 * G * T * T) / T;
  let theta = dasin(Math.max(-0.9, Math.min(0.9, vy0 / spec.speed)));
  let phi = datan2(plan.lineM - spec.p.x, PITCH_HALF - spec.p.z);
  let r = residual(shoot(spec, theta, phi, untilZ), zTarget, plan.lineM);
  const d = 2e-5;
  for (let it = 0; it < 16; it++) {
    if (Math.abs(r[0]) < 2e-4 && Math.abs(r[1]) < 2e-4) break;
    const rt = residual(shoot(spec, theta + d, phi, untilZ), zTarget, plan.lineM);
    const rp = residual(shoot(spec, theta, phi + d, untilZ), zTarget, plan.lineM);
    const a = (rt[0] - r[0]) / d;
    const b = (rp[0] - r[0]) / d;
    const c = (rt[1] - r[1]) / d;
    const e = (rp[1] - r[1]) / d;
    const det = a * e - b * c;
    if (Math.abs(det) < 1e-12) break;
    let dt = (-r[0] * e + r[1] * b) / det;
    let dp = (-a * r[1] + c * r[0]) / det;
    dt = Math.max(-0.05, Math.min(0.05, dt));
    dp = Math.max(-0.05, Math.min(0.05, dp));
    // Damped step: accept only if it improves the residual.
    let lambda = 1;
    for (let k = 0; k < 6; k++) {
      const nt = theta + lambda * dt;
      const np = phi + lambda * dp;
      const nr = residual(shoot(spec, nt, np, untilZ), zTarget, plan.lineM);
      if (Math.abs(nr[0]) + Math.abs(nr[1]) < Math.abs(r[0]) + Math.abs(r[1]) || k === 5) {
        theta = nt;
        phi = np;
        r = nr;
        break;
      }
      lambda /= 2;
    }
  }
  const v = launchVelocity(spec.speed, theta, phi);
  return { spec, v, spin: spinVector(spec.spin, v), error: r };
}

// ---------------------------------------------------------------------------------------------------------------
// Contact planes and the flight
// ---------------------------------------------------------------------------------------------------------------

/** Automatic footwork from the length: forward to full and good lengths, back to short ones; yorkers dug out. */
export function autoFootwork(plan: PracticeDeliveryPlan, family: BowlerProfile['family']): 'forward' | 'back' {
  if (plan.lengthM <= YORKER_MAX_LENGTH) return 'back';
  return plan.lengthM < AUTO_FORWARD_MAX_LENGTH[family] ? 'forward' : 'back';
}

/** z of the contact plane for an explicit footwork (manual footwork; 'across' plays from the neutral plane). */
export function contactPlaneZ(footwork: Exclude<Footwork, 'auto'>): number {
  const m = footwork === 'across' ? CONTACT_PLANE_M.neutral : CONTACT_PLANE_M[footwork];
  return PITCH_HALF - m;
}

/** Time the ball first reaches z (linear between samples), or null if it never does. */
export function timeAtZ(samples: BallFlight['samples'], z: number): number | null {
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    if (a.p.z < z && b.p.z >= z) return a.t + ((z - a.p.z) / (b.p.z - a.p.z)) * (b.t - a.t);
  }
  return samples.length && samples[0].p.z >= z ? samples[0].t : null;
}

/** Ball state at time t (linear between samples, clamped to the sampled range). */
export function sampleAt(samples: BallFlight['samples'], t: number): { t: number; p: Vec3; v: Vec3 } {
  const n = samples.length;
  if (t <= samples[0].t) return samples[0];
  if (t >= samples[n - 1].t) return samples[n - 1];
  const dt = samples[1].t - samples[0].t;
  let i = Math.floor((t - samples[0].t) / dt);
  if (i < 0) i = 0;
  if (i > n - 2) i = n - 2;
  const a = samples[i];
  const b = samples[i + 1];
  const g = (t - a.t) / (b.t - a.t);
  return {
    t,
    p: v3(a.p.x + (b.p.x - a.p.x) * g, a.p.y + (b.p.y - a.p.y) * g, a.p.z + (b.p.z - a.p.z) * g),
    v: v3(a.v.x + (b.v.x - a.v.x) * g, a.v.y + (b.v.y - a.v.y) * g, a.v.z + (b.v.z - a.v.z) * g),
  };
}

/** Whether a ball centre at the stumps plane (x, y) touches the wicket (any part of the ball on stumps or bails). */
export function hitsStumpsAt(x: number, y: number): boolean {
  return Math.abs(x) < STUMPS_HALF_W + BALL_R && y < STUMPS_TOP + BALL_R;
}

/**
 * The delivery from release to just past the striker's stumps: fixed before the batter acts, never changed after.
 * The release speed is the plan's speed exactly (release.speedKph is |v| at release).
 */
export function flight(args: FlightArgs): BallFlight {
  const { plan, bowler, conditions, seed } = args;
  const handedness = args.handedness ?? 'right';
  const spec = releaseFor(plan, bowler, conditions, seed, handedness);
  const solved = solveRelease(spec, plan);
  const sim = integrateBall(
    { t: 0, p: spec.p, v: solved.v, spin: solved.spin },
    { swingCs: spec.swingCs, seamDev: spec.seamDev, pitch: spec.pitch, untilZ: PITCH_HALF + 0.3, untilT: 3, stopAtBoundary: false, stopAtRest: false },
  );
  const first = sim.bounces[0];
  const bounce = first && first.p.z <= PITCH_HALF ? { t: first.t, p: first.p } : null;
  const zc = PITCH_HALF - CONTACT_PLANE_M[autoFootwork(plan, bowler.family)];
  const idealContactT = timeAtZ(sim.samples, zc) ?? sim.samples[sim.samples.length - 1].t;
  const plane = sim.plane ?? { t: sim.end.t, p: sim.end.p, v: sim.end.v };
  // Spin just after the bounce: replay the release spin through the same bounce (exact, from a short re-run).
  let afterBounce: Vec3 | null = null;
  if (bounce) {
    const probe = integrateBall(
      { t: 0, p: spec.p, v: solved.v, spin: solved.spin },
      { swingCs: spec.swingCs, seamDev: spec.seamDev, pitch: spec.pitch, untilT: bounce.t + 0.002, stopAtBoundary: false, stopAtRest: false },
    );
    afterBounce = probe.end.spin;
  }
  const speed = len(solved.v);
  return {
    version: PRACTICE_SIM_VERSION,
    plan,
    seed,
    release: { p: spec.p, v: solved.v, spinRps: spec.spinRps, seamDeg: spec.seamDeg, speedKph: speed * 3.6 },
    bounce,
    idealContactT,
    stumpsT: plane.t,
    wouldHitStumps: hitsStumpsAt(plane.p.x, plane.p.y),
    samples: sim.samples,
    spin: { release: solved.spin, afterBounce },
  };
}

/** How the delivery moved, for coaching: in the air, off the pitch, and the height at the bat (m). */
export interface FlightMovement {
  /** Lateral movement in the air up to the bounce (swing for pace, drift for spin); + towards the off side. */
  airM: number;
  /** Lateral deviation off the pitch by the stumps plane (seam or turn); + towards the off side. Null: full toss. */
  pitchM: number | null;
  /** Ball height at the ideal contact. */
  heightAtBatM: number;
  /** Line at the stumps plane and whether it would hit. */
  lineAtStumpsM: number;
}

export function flightMovement(f: BallFlight): FlightMovement {
  const s0 = f.samples[0];
  const at = sampleAt(f.samples, f.idealContactT);
  const plane = sampleAt(f.samples, f.stumpsT);
  const straightX = (z: number) => s0.p.x + (s0.v.x / s0.v.z) * (z - s0.p.z);
  if (!f.bounce) {
    return { airM: plane.p.x - straightX(plane.p.z), pitchM: null, heightAtBatM: at.p.y, lineAtStumpsM: plane.p.x };
  }
  const pre = sampleAt(f.samples, f.bounce.t - 0.002);
  const airM = f.bounce.p.x - straightX(f.bounce.p.z);
  const onX = f.bounce.p.x + (pre.v.x / pre.v.z) * (PITCH_HALF - f.bounce.p.z);
  return { airM, pitchM: plane.p.x - onX, heightAtBatM: at.p.y, lineAtStumpsM: plane.p.x };
}
