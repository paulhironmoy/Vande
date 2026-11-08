/**
 * The batters away from the stroke (presentation only): the non-striker at the bowler's end, and both batters running
 * between the wickets exactly when and as far as the physics running result says (src/physics/running.ts, through
 * the result's `run` events). Nothing here decides anything: the runs, their completion times and the dead ball are
 * the physics'. Pure and deterministic.
 *
 * - The non-striker stands at his popping crease, bat grounded behind the line, on the side away from the bowler's
 *   arm (clear of the delivery corridor and the bowler's follow-through), backs up as the bowler runs in (the bat stays
 *   behind the line until the release), carries on a few strides after it, and walks back to his crease when no run
 *   is taken.
 * - Each run is a sprint between the batters' turning points (RUNNING.RUN_M apart: the body stops short of the line,
 *   the bat stretched and slid over it), accelerating, cruising and braking so the bat is grounded over the line at
 *   the physics completion time; the run cycle continues through the moves, and the turn is a plant-and-pivot.
 */
import type { DeliveryResult } from '@/contracts/practice';
import { RUNNING } from '@/physics/running';
import { clipStateAt, evaluateActor, type Move } from '../core/actors';
import { clipDuration, clipMarker, hasMotionClip, motionSource, type ClipId } from '../core/clips';
import { PITCH_HALF, POPPING } from '../core/ground';
import { type Vec3, headingOf, v3 } from '../core/math';
import { simToScene } from './frame';

const CREASE_Z = PITCH_HALF - POPPING;

const NON_STRIKER = Object.freeze({
  /** Across from the middle stump, on the side away from the bowler's arm (m). */
  x: 1.15,
  /** Standing: the body this far behind the popping crease, the bat grounded over the line behind it (m). */
  standBehindM: 0.3,
  /** Backing up: starts this long before the release; by the release the body is this far past the line. */
  backUpFromMs: 900,
  backUpToM: 0.45,
  /** After the release he carries on to this far out at a walk, unless a run is called. */
  followOnM: 1.25,
  followOnMs: 900,
  walkMps: 1.15,
});

/** The run lanes: either side of the pitch, clear of the protected area (m from the middle stump). */
const RUN_LANE_X = 1.25;
/**
 * The body's turning point short of each popping crease: the bat is stretched and slid over the line from about a
 * metre out (hips to toe at full stretch, leaning). Physics runs RUNNING.RUN_M "less ~1.2 m of bat stretched over the
 * line"; the drawn turn adds a little more stretch so the run fits the physics times at a sprinter's speed.
 */
export const TURN_SHORT_M = 1.0;
/** Sprint model for the drawn runs: push-off acceleration and braking into the turn (m/s²). */
export const SPRINT = Object.freeze({
  accel: 7,
  brake: 10,
  turnMs: 300,
  slideMs: 420,
  finishMps: 4.5,
  overrunBrake: 6,
});
/** The bat_run cycle's ground speed at rate 1 (m/s): its cadence follows the speed (actors.rateBySpeed). */
export const BAT_RUN_MPS = 6.4;

/** The non-striker's spot (world): the bowler keeps his real arm in the drawn world, so the side follows the arm. */
export function nonStrikerX(bowlerLeftArm: boolean): number {
  return bowlerLeftArm ? NON_STRIKER.x : -NON_STRIKER.x;
}

/** Where the non-striker stands (world) before the bowler runs in. */
export function nonStrikerStand(bowlerLeftArm: boolean): Vec3 {
  return v3(nonStrikerX(bowlerLeftArm), 0, -CREASE_Z - NON_STRIKER.standBehindM);
}

/**
 * The non-striker's moves for a scene (no runs): standing, backing up as the bowler runs in, carrying on after the
 * release, then (after the dead ball, when the scene has time) walking back into his crease and turning to face the
 * striker again.
 */
/**
 * A walk's legs from MOTION's `loco_walk` when loaded, speed-matched (MOTION-SPEC §6; rate within [0.75, 1.3]), in place:
 * the root stays where the layout and the move put it. The arms keep the built-in walk, phase-locked to it.
 */
function walkLegs(m: Move, scale: number): Move {
  if (!hasMotionClip('loco_walk')) return m;
  const src = motionSource('vmp:loco_walk')!;
  return {
    ...m,
    lower: 'vmp:loco_walk',
    lowerStart: 0,
    lowerRate: 1,
    rate: clipDuration('walk') / src.duration,
    rateBySpeed: src.speedMps * scale,
    rateExp: 1,
    rateClamp: [0.75, 1.3],
  };
}

/**
 * A clip-driven stretch (MOTION-SPEC §6): the clip's own ground track, placed at `origin` facing the striker (+z), as
 * short Hermite moves so the root speed is continuous; `mirror` negates the ground's x (the canonical mirror).
 */
function clipDriven(
  clip: `vmp:${string}`,
  t0: number,
  fromClip: number,
  toClip: number,
  origin: Vec3,
  mirror: boolean,
  heading = 0,
): Move[] {
  const src = motionSource(clip)!;
  const g0 = src.ground!(0);
  const c = Math.cos(heading);
  const sn = Math.sin(heading);
  const at = (ct: number) => {
    const g = src.ground!(ct);
    const x = (g.x - g0.x) * (mirror ? -1 : 1);
    const z = g.z - g0.z;
    return v3(origin.x + x * c + z * sn, 0, origin.z - x * sn + z * c);
  };
  const out: Move[] = [];
  const step = 1 / 30;
  const speed = (ct: number) => {
    const a = at(Math.max(fromClip, ct - 0.004));
    const b = at(Math.min(toClip, ct + 0.004));
    return (
      Math.hypot(b.x - a.x, b.z - a.z) / Math.max(1e-6, Math.min(toClip, ct + 0.004) - Math.max(fromClip, ct - 0.004))
    );
  };
  for (let cc = fromClip; cc < toClip - 1e-6; cc += step) {
    const c1 = Math.min(toClip, cc + step);
    const c = cc;
    out.push({
      t0: t0 + (c - fromClip) * 1000,
      t1: t0 + (c1 - fromClip) * 1000,
      clip,
      clipStart: c,
      from: at(c),
      to: at(c1),
      speed: [speed(c), speed(c1)],
      heading,
      ...(c === fromClip ? { inertial: 240 } : { blend: 0 }),
    });
  }
  return out;
}

/**
 * The non-striker with MOTION-BOWL's clips (all cleared 03:24Z): `ns_stance` at his crease, `ns_backup` with its
 * `release` marker on the physics release and its crease line (clip z = +1.0) on the popping crease, so he is never out
 * of his ground before the release, `ns_ready` after it, and (no run, after the dead ball) `ns_walk_back` ending
 * grounded back at the crease. Null when the clips are not loaded.
 */
/**
 * Backing up after the release (lead ruling 04:3xZ: aim 1.2–1.8 m out by the contact, honest at the release): walking
 * on from the clip's release state, up to a jog (`peakMps`) and easing to a stop `stopOutM` past the popping crease.
 * Where the ball arrives before he can be 1.2 m out at these speeds (pace), it is logged, not sped up.
 */
const NS_WALK_ON = { walkTopMps: 1.9, peakMps: 2.5, accelMs: [350, 200] as const, holdMs: 300, stopOutM: 2.0 };
/** Kept for the probes: the distance the ruling aims for by the ball's arrival. */
export const NS_OUT_AT_ARRIVAL_M = 1.5;

function walkOnMoves(t0: number, from: Vec3, vRel: number, scale: number): { moves: Move[]; t: number; end: Vec3 } {
  const W = NS_WALK_ON;
  const segs: Array<{ ms: number; v0: number; v1: number; jog: boolean }> = [
    { ms: W.accelMs[0], v0: vRel, v1: W.walkTopMps, jog: false },
    { ms: W.accelMs[1], v0: W.walkTopMps, v1: W.peakMps, jog: true },
    { ms: W.holdMs, v0: W.peakMps, v1: W.walkTopMps, jog: true },
  ];
  const run = segs.reduce((d, g) => d + ((g.v0 + g.v1) / 2) * (g.ms / 1000), 0);
  const left = Math.max(0.3, -CREASE_Z + W.stopOutM - from.z - run);
  segs.push({ ms: ((2 * left) / W.walkTopMps) * 1000, v0: W.walkTopMps, v1: 0, jog: false });
  const moves: Move[] = [];
  let t = t0;
  let at = from;
  segs.forEach((g, i) => {
    const to = v3(at.x, 0, at.z + ((g.v0 + g.v1) / 2) * (g.ms / 1000));
    const base: Move = {
      t0: t,
      t1: t + g.ms,
      clip: 'walk',
      from: at,
      to,
      speed: [g.v0, g.v1],
      rateBySpeed: 1.4,
      heading: 0,
      ...(i === 0 ? { inertial: 200 } : { blend: segs[i - 1].jog !== g.jog ? 160 : 0 }),
    };
    const m = g.jog ? jogLegs(base, scale) : walkLegs(base, scale);
    // The gait's phase carries on from the stride before (the same foot down at the same moment of the cycle).
    const prev = moves[moves.length - 1];
    if (i > 0 && prev) {
      const st = clipStateAt(prev, prev.t1);
      const cycle = (id: string | undefined, fallback: number) =>
        id && id.startsWith('vmp:') && motionSource(id as `vmp:${string}`)
          ? motionSource(id as `vmp:${string}`)!.duration
          : fallback;
      const walkS = clipDuration('walk');
      m.clipStart = st.time % walkS;
      if (m.lower && st.lower && st.lowerTime !== undefined) {
        const was = cycle(st.lower, walkS);
        const now = cycle(m.lower, walkS);
        m.lowerStart = ((st.lowerTime % was) / was) * now;
      }
    }
    moves.push(m);
    t += g.ms;
    at = to;
  });
  return { moves, t, end: at };
}

/** A jog's legs from MOTION's `loco_jog` (speed-matched within [0.75, 1.3]); the walk's when it is not loaded. */
function jogLegs(m: Move, scale: number): Move {
  if (!hasMotionClip('loco_jog')) return walkLegs(m, scale);
  const src = motionSource('vmp:loco_jog')!;
  return {
    ...m,
    lower: 'vmp:loco_jog',
    lowerStart: 0,
    lowerRate: 1,
    rate: BAT_RUN_CYCLE_S / src.duration,
    rateBySpeed: src.speedMps * scale,
    rateExp: 1,
    rateClamp: [0.75, 1.3],
  };
}

function packNonStrikerMoves(o: {
  releaseScene: number;
  duration: number;
  delivery: boolean;
  bowlerLeftArm: boolean;
  deadScene: number | null;
  mirror?: boolean;
  arrivalScene?: number;
  scale?: number;
}): Move[] | null {
  const need = ['ns_stance', 'ns_backup', 'ns_ready', 'ns_walk_back'];
  if (!need.every(hasMotionClip)) return null;
  const x = nonStrikerX(o.bowlerLeftArm);
  // The clip's crease line (its z = +1.0 from its origin) on the popping crease.
  const origin = v3(x, 0, -CREASE_Z - 1.0);
  if (!o.delivery) return [{ t0: 0, t1: o.duration, clip: 'vmp:ns_stance', from: origin, to: origin, heading: 0 }];
  const backup = 'vmp:ns_backup' as const;
  const rel = clipMarker(backup, 'release', 1.6);
  const t0 = o.releaseScene - rel * 1000;
  const lead = Math.max(0, -t0 / 1000);
  const moves: Move[] = [];
  if (t0 > 1) moves.push({ t0: 0, t1: t0, clip: 'vmp:ns_stance', from: origin, to: origin, heading: 0 });
  // The backing-up clip up to its release marker (the bat still grounded behind the line), then walking on (NS_WALK_ON).
  moves.push(...clipDriven(backup, Math.max(0, t0), lead, rel, origin, Boolean(o.mirror)));
  const atRel = moves[moves.length - 1];
  // Walking on, then a few jogging strides and easing to a stop NS_STOP_OUT_M past the line (no run): the gait's
  // own legs at every speed (walk ≤ 1.9 m/s, jog above), never a walk cycle stretched over a jog.
  const vRel =
    Math.hypot(atRel.to!.x - atRel.from!.x, atRel.to!.z - atRel.from!.z) / Math.max(1e-3, (atRel.t1 - atRel.t0) / 1000);
  const on = walkOnMoves(atRel.t1, atRel.to!, vRel, o.scale ?? 1);
  moves.push(...on.moves);
  const onAt = on.end;
  let t = on.t;
  const back = o.deadScene !== null ? Math.max(t + 300, o.deadScene + 500) : null;
  const wb = 'vmp:ns_walk_back' as const;
  const wbMs = clipDuration(wb) * 1000;
  if (back !== null && back + wbMs < o.duration - 300) {
    moves.push({ t0: t, t1: back, clip: 'vmp:ns_ready', from: onAt, to: onAt, heading: 0, blend: 300 });
    // The walk back, placed so it ends grounded at the crease where he started.
    const src = motionSource(wb)!;
    const travel = src.ground!(clipDuration(wb));
    const start = v3(origin.x - travel.x * (o.mirror ? -1 : 1), 0, origin.z - travel.z);
    const walk = clipDriven(wb, back, 0, clipDuration(wb), start, Boolean(o.mirror));
    // The gap from where the backing-up left him to the walk back's start closes over the first moves (no jump).
    const gx = onAt.x - start.x;
    const gz = onAt.z - start.z;
    const fade = (tt: number) =>
      1 - Math.min(1, Math.max(0, (tt - back) / 900)) ** 2 * (3 - 2 * Math.min(1, Math.max(0, (tt - back) / 900)));
    for (const m of walk) {
      m.from = v3(m.from!.x + gx * fade(m.t0), 0, m.from!.z + gz * fade(m.t0));
      m.to = v3(m.to!.x + gx * fade(m.t1), 0, m.to!.z + gz * fade(m.t1));
    }
    moves.push(...walk);
    t = back + wbMs;
    moves.push({
      t0: t,
      t1: Math.max(t + 1, o.duration),
      clip: 'vmp:ns_stance',
      from: origin,
      to: origin,
      heading: 0,
      blend: 300,
    });
  } else
    moves.push({
      t0: t,
      t1: Math.max(t + 1, o.duration),
      clip: 'vmp:ns_ready',
      from: onAt,
      to: onAt,
      heading: 0,
      blend: 300,
    });
  return moves;
}

export function nonStrikerMoves(o: {
  releaseScene: number;
  duration: number;
  delivery: boolean;
  bowlerLeftArm: boolean;
  deadScene: number | null;
  scale?: number;
  mirror?: boolean;
  arrivalScene?: number;
}): Move[] {
  const pack = packNonStrikerMoves(o);
  if (pack) return pack;
  const stand = nonStrikerStand(o.bowlerLeftArm);
  if (!o.delivery) return [{ t0: 0, t1: o.duration, clip: 'bat_rest', from: stand, to: stand, heading: 0 }];
  const x = stand.x;
  const backAt = v3(x, 0, -CREASE_Z + NON_STRIKER.backUpToM);
  const onAt = v3(x, 0, -CREASE_Z + NON_STRIKER.followOnM);
  const t0 = Math.max(1, o.releaseScene - NON_STRIKER.backUpFromMs);
  const vBack = 1.1;
  const backLen = backAt.z - stand.z;
  const onLen = onAt.z - backAt.z;
  const tOn = o.releaseScene + NON_STRIKER.followOnMs;
  const moves: Move[] = [
    { t0: 0, t1: t0, clip: 'bat_rest', from: stand, to: stand, heading: 0 },
    // Walking in with the bowler: from rest, the bat still behind the line until the ball is bowled.
    walkLegs(
      {
        t0,
        t1: o.releaseScene,
        clip: 'walk',
        from: stand,
        to: backAt,
        speed: [0, vBack],
        rateBySpeed: 1.4,
        heading: 0,
        blend: 260,
      },
      o.scale ?? 1,
    ),
    // A few more strides after the release, easing to a stop, alert.
    walkLegs(
      {
        t0: o.releaseScene,
        t1: tOn,
        clip: 'walk',
        from: backAt,
        to: onAt,
        speed: [vBack, 0],
        rateBySpeed: 1.4,
        heading: 0,
        blend: 0,
      },
      o.scale ?? 1,
    ),
  ];
  void backLen;
  void onLen;
  let t = tOn;
  const back = o.deadScene !== null ? Math.max(tOn + 400, o.deadScene + 500) : null;
  if (back !== null && back < o.duration - 1200) {
    moves.push({ t0: t, t1: back, clip: 'bat_rest', from: onAt, to: onAt, heading: 0, blend: 300 });
    const walkMs = ((onAt.z - stand.z) / (NON_STRIKER.walkMps * 0.66)) * 1000;
    // Back into the crease: turning away, walking, turning to face the striker again.
    moves.push(
      walkLegs(
        {
          t0: back,
          t1: back + walkMs,
          clip: 'walk',
          from: onAt,
          to: stand,
          speed: [0, 0],
          rateBySpeed: 1.4,
          turnMs: 650,
          blend: 260,
        },
        o.scale ?? 1,
      ),
    );
    t = back + walkMs;
    moves.push({
      t0: t,
      t1: Math.max(t + 1, o.duration),
      clip: 'bat_rest',
      from: stand,
      to: stand,
      headingTo: 0,
      blend: 300,
    });
  } else
    moves.push({
      t0: t,
      t1: Math.max(t + 1, o.duration),
      clip: 'bat_rest',
      from: onAt,
      to: onAt,
      heading: 0,
      blend: 300,
    });
  return moves;
}

// ---------------------------------------------------------------------------------------------------------------
// Running between the wickets
// ---------------------------------------------------------------------------------------------------------------

/**
 * The start from rest locked to the clip (lead round 7): `loco_start` played at its own pace with the root on its
 * own ground track until the stance foot's toe-off (its contact bit clearing after the first step), so the planted
 * foot never skates; the sprint then takes over from there and still meets the physics completion time (the caller
 * plans the rest from `{ tMs, dist, v }`). Null when the clip is not loaded or does not fit the run.
 */
function lockedStart(
  dist: number,
  timeS: number,
  scale: number,
): {
  moves: (from: Vec3, dir: { x: number; z: number }, t0: number, heading: number) => Move[];
  tMs: number;
  dist: number;
  v: number;
} | null {
  if (!hasMotionClip('loco_start')) return null;
  const src = motionSource('vmp:loco_start')!;
  if (!src.contacts || !src.ground) return null;
  const dt = 1 / 120;
  const c0 = src.contacts(0) & 3;
  let swing = -1;
  let off = -1;
  for (let c = dt; c <= src.duration; c += dt) {
    const bits = src.contacts(c) & 3;
    if (swing < 0) {
      if (c0 & 1 && !(bits & 1)) swing = 0;
      else if (c0 & 2 && !(bits & 2)) swing = 1;
      continue;
    }
    const stance = swing === 0 ? 2 : 1;
    if (!(bits & stance)) {
      off = c;
      break;
    }
  }
  if (off <= 0) return null;
  const g0 = src.ground(0);
  const along = (c: number) => {
    const g = src.ground!(c);
    return Math.hypot(g.x - g0.x, g.z - g0.z) * scale;
  };
  const dA = along(off);
  const vA = (along(Math.min(src.duration, off + 0.01)) - along(Math.max(0, off - 0.01))) / 0.02;
  if (dA >= dist * 0.5 || off >= timeS * 0.5) return null;
  const moves = (from: Vec3, dir: { x: number; z: number }, t0: number, heading: number): Move[] => {
    const out: Move[] = [];
    const step = 1 / 30;
    const sp = (c: number) => Math.max(0, (along(Math.min(off, c + 0.005)) - along(Math.max(0, c - 0.005))) / 0.01);
    for (let c = 0; c < off - 1e-6; c += step) {
      const c1 = Math.min(off, c + step);
      const a = along(c);
      const b = along(c1);
      out.push({
        t0: t0 + c * 1000,
        t1: t0 + c1 * 1000,
        clip: 'bat_run',
        lower: 'vmp:loco_start',
        lowerStart: c,
        lowerRate: 1,
        from: v3(from.x + dir.x * a, 0, from.z + dir.z * a),
        to: v3(from.x + dir.x * b, 0, from.z + dir.z * b),
        speed: [c === 0 ? 0 : sp(c), sp(c1)],
        heading,
        blend: 0,
      });
    }
    return out;
  };
  return { moves, tMs: off * 1000, dist: dA, v: vA };
}

export interface SprintPhase {
  /** Seconds from the run's start, the distance covered, and the speeds at its ends. */
  t0: number;
  t1: number;
  s0: number;
  s1: number;
  v0: number;
  v1: number;
}

/**
 * A run of `dist` metres in `time` seconds from speed u0, arriving at vEnd: accelerate, cruise, brake (constant
 * rates, so every phase is a quadratic and the speed is continuous). Solves for the cruise speed (the lowest that
 * makes it); if the rates cannot, they are raised until they can. Returns the phases.
 */
/** Sprint windows that needed more than SPRINT_RATE_LOG_ABOVE m/s² of acceleration or braking (lead ruling: logged). */
export const SPRINT_RATE_LOG_ABOVE = 12;
export const sprintRateLog: Array<{ dist: number; time: number; accel: number; brake: number }> = [];

export function sprintProfile(
  dist: number,
  time: number,
  u0: number,
  vEnd: number,
  accel = SPRINT.accel,
  brake = SPRINT.brake,
): SprintPhase[] {
  let a = accel;
  let b = brake;
  const logIfOver = () => {
    if ((a > SPRINT_RATE_LOG_ABOVE || b > SPRINT_RATE_LOG_ABOVE) && sprintRateLog.length < 64)
      sprintRateLog.push({ dist, time, accel: a, brake: b });
  };
  for (let attempt = 0; attempt < 12; attempt++) {
    const covered = (vc: number) => {
      const ta = Math.max(0, (vc - u0) / a);
      const tb = Math.max(0, (vc - vEnd) / b);
      const tc = time - ta - tb;
      if (tc < 0) return -1;
      return (vc * vc - u0 * u0) / (2 * a) + (vc * vc - vEnd * vEnd) / (2 * b) + vc * tc;
    };
    // covered() rises with vc while the cruise lasts: the lowest cruise speed that covers the distance.
    let lo = Math.max(u0, vEnd);
    let hi = lo;
    while (hi < 14 && covered(hi + 0.05) >= 0) hi += 0.05;
    if (covered(lo) <= dist && covered(hi) >= dist) {
      for (let k = 0; k < 50; k++) {
        const mid = (lo + hi) / 2;
        if (covered(mid) < dist) lo = mid;
        else hi = mid;
      }
      const vc = (lo + hi) / 2;
      const ta = Math.max(0, (vc - u0) / a);
      const tb = Math.max(0, (vc - vEnd) / b);
      const da = (vc * vc - u0 * u0) / (2 * a);
      const db = (vc * vc - vEnd * vEnd) / (2 * b);
      logIfOver();
      const out: SprintPhase[] = [];
      if (ta > 1e-4) out.push({ t0: 0, t1: ta, s0: 0, s1: da, v0: u0, v1: vc });
      if (time - ta - tb > 1e-4) out.push({ t0: ta, t1: time - tb, s0: da, s1: dist - db, v0: vc, v1: vc });
      if (tb > 1e-4) out.push({ t0: time - tb, t1: time, s0: dist - db, s1: dist, v0: vc, v1: vEnd });
      return out;
    }
    a *= 1.2;
    b *= 1.2;
  }
  // Unreachable in practice: a straight constant-acceleration line (logged).
  if (sprintRateLog.length < 64)
    sprintRateLog.push({ dist, time, accel: Number.POSITIVE_INFINITY, brake: Number.POSITIVE_INFINITY });
  return [{ t0: 0, t1: time, s0: 0, s1: dist, v0: u0, v1: Math.max(0, (2 * dist) / time - u0) }];
}

/** The bat_run cycle (s): its arm swing is phase-locked to a pack gait under it. */
const BAT_RUN_CYCLE_S = 0.64;
/** The cross-fade into a run (ms): the stroke (or the backing up) hands over to the running clip over this long. */
const RUN_ENTRY_BLEND_MS = 320;
/**
 * The striker's stroke hands over to his run by inertialization this long (ms; lead round 5–6): the stroke overlay's
 * hips and trunk (often 40–60° from the run's) settle onto the run's within the §9 speed caps.
 */
const STRIKER_RUN_ENTRY_INERTIAL_MS = 450;

/**
 * The legs of one sprint phase from MOTION's locomotion pack when it is loaded (MOTION-SPEC §6), the built-in run
 * cycle otherwise: from a standstill `loco_start` warped onto the acceleration, braking to a stop `loco_stop` warped
 * onto the braking, and in between the run or sprint loop speed-matched (rate v / speedMps within [0.75, 1.3]) with the
 * arms and the bat (bat_run) phase-locked to it. The root is always the physics-timed sprint.
 */
function locoLegs(base: Move, ph: SprintPhase, scale: number): Move {
  const dur = ph.t1 - ph.t0 || 1e-3;
  const warp = (name: string): Move | null => {
    const id = `vmp:${name}` as const;
    if (!hasMotionClip(name)) return null;
    return { ...base, lower: id, lowerStart: 0, lowerRate: clipDuration(id) / dur, rateBySpeed: undefined };
  };
  if (ph.v0 < 0.5 && ph.v1 > ph.v0) return warp('loco_start') ?? base;
  if (ph.v1 < 0.5 && ph.v0 > ph.v1) return warp('loco_stop') ?? base;
  const v = (ph.v0 + ph.v1) / 2;
  const name = v > 6.6 && hasMotionClip('loco_sprint') ? 'loco_sprint' : hasMotionClip('loco_run') ? 'loco_run' : null;
  if (!name) return base;
  const id = `vmp:${name}` as const;
  const src = motionSource(id)!;
  return {
    ...base,
    lower: id,
    lowerStart: 0,
    lowerRate: 1,
    rate: BAT_RUN_CYCLE_S / src.duration,
    clipStart: 0,
    rateBySpeed: src.speedMps * scale,
    rateExp: 1,
    rateClamp: [0.75, 1.3],
  };
}

interface TurnPlan {
  /** Scene ms of the completion (at rest at the turning point), the speed and duration of the braking into it. */
  done: number;
  vc: number;
  brakeMs: number;
  /** Heading of the run arriving, and whether the turn is to his left. */
  travelIn: number;
  left: boolean;
}

/** MOTION-BOWL's in-place turn (ns_turn v2): its markers, its entry speed and exit speed (m/s). */
const NS_TURN = { ground: 0.87, dwellEnd: 1.02, exit: 1.763, vIn: 8.7, vOut: 5.2 } as const;

/**
 * The non-striker's turns between runs drawn with MOTION-BOWL's `ns_turn` v2 (in place: the root and its timing stay
 * the physics-timed sprint profile, exactly): the braking strides time-warped onto the braking (entered at clip time
 * (8.7 − v)/10), the dwell onto the physics 0.15 s, the push-off onto the first 5.2 m/s of the next run, the heading from
 * the clip's yaw (the feet pivot with it), then `ns_run` in its phase 0.5. A turn to his right is the clip's mirror alias
 * `ns_turn_r`; a left-handed pair's track mirror is allowed for. Unchanged when the clips are not loaded.
 */
function turnInPlace(moves: Move[], turns: TurnPlan[], mirror: boolean, scale: number): Move[] {
  if (!turns.length || !hasMotionClip('ns_turn') || !hasMotionClip('ns_turn_r') || !hasMotionClip('ns_run'))
    return moves;
  const track = {
    id: 'nonStriker',
    role: 'batter' as const,
    look: { seed: '', team: 0 as const, gear: 'batter' as const },
    start: moves[0]?.from ?? v3(0, 0, 0),
    heading: 0,
    moves,
  };
  let out = moves;
  for (const turn of turns) {
    // The visible turn direction; a mirrored track shows the clip mirrored, so it takes the other alias.
    const id = turn.left !== mirror ? ('vmp:ns_turn' as const) : ('vmp:ns_turn_r' as const);
    const src = motionSource(id)!;
    const sgn = mirror ? -1 : 1;
    const entry = Math.max(0, (NS_TURN.vIn - turn.vc) / 10);
    const t0 = turn.done - turn.brakeMs;
    const tDwell = turn.done + RUNNING.TURN_S * 1000;
    // The push-off takes the next run from rest to the clip's exit speed at the run's own acceleration.
    const pushMs = (NS_TURN.exit - NS_TURN.dwellEnd) * 1000 * (SPRINT.accel / 7);
    const tExit = tDwell + pushMs;
    const warp = (t: number) =>
      t <= turn.done
        ? entry + ((t - t0) / Math.max(1, turn.brakeMs)) * (NS_TURN.ground - entry)
        : t <= tDwell
          ? NS_TURN.ground + ((t - turn.done) / (tDwell - turn.done)) * (NS_TURN.dwellEnd - NS_TURN.ground)
          : NS_TURN.dwellEnd + ((t - tDwell) / pushMs) * (NS_TURN.exit - NS_TURN.dwellEnd);
    const g0 = src.ground!(entry).yawDeg;
    const posAt = (t: number) => evaluateActor(track, t).pos;
    const step = 1000 / 30;
    const sub: Move[] = [];
    for (let a = t0; a < tExit - 1e-6; a += step) {
      const b = Math.min(tExit, a + step);
      const pa = posAt(a);
      const pb = posAt(b);
      const ya = (src.ground!(warp(a)).yawDeg - g0) * DEG_RAD * sgn;
      const yb = (src.ground!(warp(b)).yawDeg - g0) * DEG_RAD * sgn;
      const v = Math.hypot(pb.x - pa.x, pb.z - pa.z) / ((b - a) / 1000);
      sub.push({
        t0: a,
        t1: b,
        clip: id,
        clipStart: warp(a),
        rate: (warp(b) - warp(a)) / ((b - a) / 1000),
        from: pa,
        to: pb,
        speed: [v, v],
        heading: turn.travelIn + ya,
        headingTo: turn.travelIn + yb,
        headingEase: 'linear',
        ...(a === t0 ? { blend: 140 } : { blend: 0 }),
      });
    }
    // After the exit: ns_run in its phase 0.5 at the profile's speed, to the end of that acceleration.
    const next = out.find((m) => m.t0 >= tDwell - 1 && m.t0 <= tDwell + 1);
    const accelEnd = next ? next.t1 : tExit;
    const run = 'vmp:ns_run' as const;
    const runSrc = motionSource(run)!;
    const tail: Move[] = [];
    if (accelEnd > tExit + 1) {
      const pa = posAt(tExit);
      const pb = posAt(accelEnd);
      const travelOut = turn.travelIn + Math.PI;
      tail.push({
        t0: tExit,
        t1: accelEnd,
        clip: run,
        clipStart: 0.5 * runSrc.duration,
        from: pa,
        to: pb,
        speed: [NS_TURN.vOut, next?.speed?.[1] ?? NS_TURN.vOut],
        rateBySpeed: runSrc.speedMps * scale,
        rateExp: 1,
        rateClamp: [0.75, 1.3],
        heading: travelOut,
        blend: 100,
      });
    }
    const end = Math.max(tExit, accelEnd);
    out = [...out.filter((m) => m.t1 <= t0 + 1e-6), ...sub, ...tail, ...out.filter((m) => m.t0 >= end - 1e-6)];
  }
  return out;
}
const DEG_RAD = Math.PI / 180;

/** ns_ground's origin is this far short of the popping crease (MOTION-BOWL: "the crease is 4.56 m ahead"). */
const NS_GROUND_CREASE_M = 4.56;

export interface RunningInput {
  /** The batters' rig scale (stride length scales with it; default 1). */
  scale?: number;
  result: DeliveryResult;
  releaseScene: number;
  duration: number;
  mirror: boolean;
  bowlerLeftArm: boolean;
  /** Where each batter is (world) and the clip state its last move is in when the running starts. */
  striker: Vec3;
  nonStriker: Vec3;
  /** The non-striker's walking speed (m/s) when the run is called: the sprint picks it up rather than starting dead. */
  nonStrikerSpeed?: number;
  /**
   * The non-striker's legs when the run is called (their clip and its time): a pack gait loop's phase is carried into
   * the run's first strides (round 7), so his cadence rises from the walk's with no reset of his footing.
   */
  nonStrikerGait?: { clip: ClipId; time: number } | null;
}

/** The completed runs' physics completion times (simulation s), in order. */
export function runTimes(result: DeliveryResult): number[] {
  return result.events
    .filter((e): e is Extract<DeliveryResult['events'][number], { kind: 'run' }> => e.kind === 'run')
    .map((e) => e.t)
    .sort((a, b) => a - b);
}

/** The physics instant the batters set off (simulation s): the first completion less the stroke-and-call and the sprint. */
export function setOffT(runs: readonly number[]): number {
  const dAcc = (RUNNING.TOP_SPEED * RUNNING.TOP_SPEED) / (2 * RUNNING.ACCEL);
  const sprint = RUNNING.TOP_SPEED / RUNNING.ACCEL + (RUNNING.RUN_M - dAcc) / RUNNING.TOP_SPEED;
  return runs[0] - sprint;
}

/**
 * Both batters' running: one sprint per completed run between the turning points, set off at the physics instant,
 * the bat grounded over the line at each physics completion (the body braking to its turning point there when another
 * run follows, running through and pulling up after the last). Returns each batter's moves from the set-off (scene ms)
 * to the end of the scene.
 */
export function runningMoves(o: RunningInput): { start: number; striker: Move[]; nonStriker: Move[] } | null {
  const runs = runTimes(o.result);
  if (!runs.length) return null;
  const start = simToScene(o, setOffT(runs));
  const laneN = Math.sign(nonStrikerX(o.bowlerLeftArm)) * RUN_LANE_X;
  const turns: TurnPlan[] = [];
  // The walk's phase (0–1 of its loop) as the run is called, when his legs are in a pack gait loop.
  const walkPhase = (() => {
    const g = o.nonStrikerGait;
    if (!g || !String(g.clip).startsWith('vmp:loco_') || g.clip === 'vmp:loco_start' || g.clip === 'vmp:loco_stop')
      return null;
    const d = clipDuration(g.clip);
    return d > 0 ? (((g.time / d) % 1) + 1) % 1 : null;
  })();
  /** The first stride's legs (and the bat_run arms locked to them) from the walk's phase: no reset (round 7). */
  const carry = (m: Move, phase: number | null): Move => {
    if (
      phase === null ||
      !m.lower ||
      !String(m.lower).startsWith('vmp:loco_') ||
      m.lower === 'vmp:loco_start' ||
      m.lower === 'vmp:loco_stop'
    )
      return m;
    const d = clipDuration(m.lower);
    return { ...m, lowerStart: phase * d, ...(m.clip === 'bat_run' ? { clipStart: phase * BAT_RUN_CYCLE_S } : {}) };
  };
  const plan = (
    from: Vec3,
    firstTowardsBowler: boolean,
    lane: number,
    groundClip = false,
    u0 = 0,
    inertialEntry = false,
    phase0: number | null = null,
  ): Move[] => {
    const moves: Move[] = [];
    let at = from;
    let clipT = 0;
    let t = start;
    let heading = firstTowardsBowler ? Math.PI : 0;
    for (let k = 0; k < runs.length; k++) {
      const towardsBowler = k % 2 === 0 ? firstTowardsBowler : !firstTowardsBowler;
      const endZ = towardsBowler ? -CREASE_Z + TURN_SHORT_M : CREASE_Z - TURN_SHORT_M;
      const done = simToScene(o, runs[k]);
      const last = k === runs.length - 1;
      if (last && groundClip && hasMotionClip('ns_ground')) {
        // MOTION-BOWL's ns_ground for the last run: its `ground` marker (the bat grounded over the line) on the physics
        // completion, its origin NS_GROUND_CREASE_M short of the popping crease; the sprint delivers him to that origin
        // at the clip's own entry speed, then the clip (its ground track) brakes him to a stop.
        const clip = 'vmp:ns_ground' as const;
        const src = motionSource(clip)!;
        const dirZ = towardsBowler ? -1 : 1;
        const origin = v3(lane, 0, dirZ * CREASE_Z - dirZ * NS_GROUND_CREASE_M);
        const groundAt = clipMarker(clip, 'ground', 1.0);
        const tEnter = done - groundAt * 1000;
        const g0 = src.ground!(0);
        const g1 = src.ground!(0.02);
        const vEnter = Math.hypot(g1.x - g0.x, g1.z - g0.z) / 0.02;
        const dist = Math.hypot(origin.x - at.x, origin.z - at.z);
        const dir = { x: (origin.x - at.x) / (dist || 1), z: (origin.z - at.z) / (dist || 1) };
        const travel = headingOf(dir.x, dir.z);
        const v0 = k === 0 ? u0 : 0;
        const lock = v0 < 0.5 && k > 0 ? lockedStart(dist, Math.max(0.3, (tEnter - t) / 1000), o.scale ?? 1) : null;
        let s0 = 0;
        if (lock) {
          const lm = lock.moves(at, dir, t, travel);
          lm[0] = { ...lm[0], blend: k === 0 ? RUN_ENTRY_BLEND_MS : 160, turnMs: SPRINT.turnMs };
          delete (lm[0] as { heading?: number }).heading;
          moves.push(...lm);
          t += lock.tMs;
          s0 = lock.dist;
        }
        const phases = sprintProfile(dist - s0, Math.max(0.3, (tEnter - t) / 1000), lock ? lock.v : v0, vEnter);
        const p = (sd: number) => v3(at.x + dir.x * (sd + s0), 0, at.z + dir.z * (sd + s0));
        phases.forEach((ph, i) => {
          const m0 = locoLegs(
            {
              t0: t + ph.t0 * 1000,
              t1: t + ph.t1 * 1000,
              clip: 'bat_run',
              lower: 'bat_run',
              lowerStart: clipT,
              clipStart: clipT,
              from: p(ph.s0),
              to: p(ph.s1),
              speed: [ph.v0, ph.v1],
              rateBySpeed: BAT_RUN_MPS,
              blend: i === 0 && k === 0 && !lock ? 220 : i === 0 && lock ? 120 : 0,
              ...(i === 0 && !lock ? { turnMs: SPRINT.turnMs } : { heading: travel }),
            },
            ph,
            o.scale ?? 1,
          );
          const m = i === 0 && k === 0 && !lock ? carry(m0, phase0) : m0;
          moves.push(m);
          clipT = m.lower === 'bat_run' ? (clipStateAt(m, t + ph.t1 * 1000).lowerTime ?? clipT) : clipT;
        });
        const heading = towardsBowler ? Math.PI : 0;
        const tail = clipDriven(clip, tEnter, 0, clipDuration(clip), origin, Boolean(o.mirror), heading);
        tail[0] = { ...tail[0], blend: 160 };
        delete tail[0].inertial;
        moves.push(...tail);
        const end = tail[tail.length - 1];
        moves.push({
          t0: end.t1,
          t1: Math.max(end.t1 + 1, o.duration),
          clip: hasMotionClip('ns_stance') ? 'vmp:ns_stance' : 'bat_rest',
          from: end.to!,
          to: end.to!,
          headingTo: towardsBowler ? 0 : Math.PI,
          blend: 320,
        });
        return moves;
      }
      const to = v3(lane, 0, endZ);
      const dist = Math.hypot(to.x - at.x, to.z - at.z);
      const dir = { x: (to.x - at.x) / (dist || 1), z: (to.z - at.z) / (dist || 1) };
      const travel = headingOf(dir.x, dir.z);
      // From rest: the start locked to loco_start until the stance foot's toe-off, the sprint from there (round 7).
      const v0 = k === 0 ? u0 : 0;
      // (The first leg's start is not locked: the striker sets off from his stroke, not from a stance the clip knows,
      // and locking it measured worse (round 7, zz-runstart); the restarts after a turn are from rest.)
      const lock = v0 < 0.5 && k > 0 ? lockedStart(dist, (done - t) / 1000, o.scale ?? 1) : null;
      let s0 = 0;
      if (lock) {
        const lm = lock.moves(at, dir, t, travel);
        lm[0] = {
          ...lm[0],
          ...(k === 0
            ? inertialEntry
              ? { inertial: STRIKER_RUN_ENTRY_INERTIAL_MS }
              : { blend: RUN_ENTRY_BLEND_MS }
            : { blend: 160 }),
          turnMs: SPRINT.turnMs,
        };
        delete (lm[0] as { heading?: number }).heading;
        moves.push(...lm);
        t += lock.tMs;
        s0 = lock.dist;
      }
      const phases = sprintProfile(dist - s0, (done - t) / 1000, lock ? lock.v : v0, last ? SPRINT.finishMps : 0);
      const p = (s: number) => v3(at.x + dir.x * (s + s0), 0, at.z + dir.z * (s + s0));
      phases.forEach((ph, i) => {
        const t0 = t + ph.t0 * 1000;
        const t1 = t + ph.t1 * 1000;
        // The last strides into the crease: the bat goes down and slides over the line.
        const sliding = t1 > done - SPRINT.slideMs - 1;
        const base: Move = {
          t0,
          t1,
          clip: sliding ? 'bat_slide' : 'bat_run',
          lower: 'bat_run',
          lowerStart: clipT,
          clipStart: sliding ? 0 : clipT,
          from: p(ph.s0),
          to: p(ph.s1),
          speed: [ph.v0, ph.v1],
          rateBySpeed: BAT_RUN_MPS,
          // Into the run a cross-fade (inertializing it measured worse: a 0.98 m plant slide mid-sprint) of at least
          // RUN_ENTRY_BLEND_MS, so the striker's stroke hands over to the run without a pop (§9; lead round 5); the bat
          // going down for the slide is an upper-body change over the same legs.
          ...(i === 0 && k === 0 && !lock
            ? inertialEntry
              ? { inertial: STRIKER_RUN_ENTRY_INERTIAL_MS }
              : { blend: RUN_ENTRY_BLEND_MS }
            : { blend: sliding ? 160 : i === 0 && lock ? 120 : 0 }),
          ...(i === 0 && !lock ? { turnMs: SPRINT.turnMs } : { heading: travel }),
        };
        const m0 = locoLegs(base, ph, o.scale ?? 1);
        const m = i === 0 && k === 0 && !lock && !sliding ? carry(m0, phase0) : m0;
        moves.push(m);
        clipT = m.lower === 'bat_run' ? (clipStateAt(m, t1).lowerTime ?? clipT) : clipT;
      });
      heading = travel;
      at = to;
      t = done;
      if (!last && groundClip) {
        const brake = phases[phases.length - 1];
        const towardsCentre = Math.sign(-at.x) || 1;
        // Left (+yaw) when the pitch centre is on his left as he arrives.
        const left = towardsCentre * (towardsBowler ? -1 : 1) > 0;
        turns.push({ done, vc: brake.v0, brakeMs: (brake.t1 - brake.t0) * 1000, travelIn: travel, left });
      }
      if (!last) {
        // Plant and pivot: half the turn on the spot (towards the pitch), the rest as he pushes off.
        const towardsCentre = Math.sign(-at.x) || 1;
        const half = heading + towardsCentre * (towardsBowler ? -1 : 1) * (Math.PI / 2);
        const pivot = RUNNING.TURN_S * 1000;
        moves.push({
          t0: t,
          t1: t + pivot,
          clip: 'ready',
          from: at,
          to: at,
          heading,
          headingTo: half,
          headingEase: 'linear',
          inertial: 140,
        });
        heading = half;
        t += pivot;
      }
    }
    // After the last run: pull up past the line, then stand, facing back down the pitch.
    const lastDir = Math.sign(at.z) || 1;
    const stopLen = (SPRINT.finishMps * SPRINT.finishMps) / (2 * SPRINT.overrunBrake);
    const stopAt = v3(at.x, 0, at.z + lastDir * stopLen);
    const stopMs = ((2 * stopLen) / SPRINT.finishMps) * 1000;
    moves.push({
      t0: t,
      t1: t + stopMs,
      clip: 'bat_run',
      lower: 'bat_run',
      clipStart: clipT,
      lowerStart: clipT,
      from: at,
      to: stopAt,
      speed: [SPRINT.finishMps, 0],
      rateBySpeed: BAT_RUN_MPS,
      heading,
      blend: 140,
    });
    t += stopMs;
    moves.push({
      t0: t,
      t1: Math.max(t + 1, o.duration),
      clip: 'bat_rest',
      from: stopAt,
      to: stopAt,
      headingTo: lastDir > 0 ? Math.PI : 0,
      blend: 320,
    });
    return moves;
  };
  return {
    start,
    striker: plan(o.striker, true, -laneN, false, 0, true),
    nonStriker: turnInPlace(
      plan(o.nonStriker, false, laneN, true, Math.min(2, o.nonStrikerSpeed ?? 0), false, walkPhase),
      turns,
      Boolean(o.mirror),
      o.scale ?? 1,
    ),
  };
}
