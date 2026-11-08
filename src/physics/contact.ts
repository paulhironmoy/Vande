/**
 * strike(): the batter plays (or leaves) a delivery. Builds the bat track, sweeps the ball against bat and body,
 * classifies the contact and computes the ball leaving the bat, the pad or the body.
 *
 * Contact kinds come from where the ball meets the bat: the face (middle; the sweet spot is SWEET_U along the blade),
 * the edges (inside, outside, leading; top edge on a cross-bat stroke or the gloves/handle), pad, body, or a miss.
 * The exit velocity and spin come from one impulse model (impact.ts) with an effective restitution that falls off
 * along and across the blade from the sweet spot, the bat's velocity at the contact point, the incoming velocity and
 * spin, the face normal, and the footwork's balance. A mistimed shot goes where that physics sends it: the report
 * keeps the player's intended bearing for coaching. timing is the band of the raw timing error (activeBands).
 */
import type {
  BallFlight,
  BallSample,
  BatSample,
  ContactKind,
  ContactReport,
  NormalizedSwing,
  PlayedFootwork,
  SwingTiming,
} from '@/contracts/practice';
import {
  BAT_EFF_MASS,
  BAT_FRICTION,
  BLADE_HALF_W,
  BLADE_L,
  COR_EDGE,
  DEFEND_EFF_MASS,
  EDGE_EFF_MASS,
  PAD_COR,
  PAD_FRICTION,
  SWEET_ALONG_M,
  SWEET_ACROSS_M,
  SWEET_U,
} from './constants';
import {
  type BatTrack,
  type StrikeOptions,
  batPointVelocity,
  batPose,
  batSamples,
  batterBody,
  buildBatTrack,
  incomingSpin,
  presentationBatSamples,
  resolveFootwork,
} from './bat';
import { faceCor, swingArm } from './batMaterial';
import { type BladeRegion, type SweepHit, type SweepResult, bladeFrame, sweep, sweepFrom } from './collision';
import { impact } from './impact';
import { activeBands, classifyTiming, forgive } from './timing';
import { type Vec3, bearingDeg, cross, dot, elevationDeg, len, norm, sub, v3 } from './vec';

export type { StrikeOptions };
export { faceCor, swingArm } from './batMaterial';

export interface StrikeExit {
  t: number;
  p: Vec3;
  v: Vec3;
  /** Spin vector (rad/s): pass it to simulate({ ..., spin }). */
  spin: Vec3;
  /** Back-spin (+) / top-spin (−) component, rev/s. */
  spinRps: number;
}

export interface StrikeImpact {
  t: number;
  p: Vec3;
  part: 'pad' | 'body';
  vIn: Vec3;
  /** Rebound off the pad or body. */
  vOut: Vec3;
  spinOut: Vec3;
}

export interface StrikeMiss {
  t: number;
  ball: Vec3;
  bat: Vec3;
  /** ball − bat at the closest approach: y > 0 over the bat, x tells which side. */
  delta: Vec3;
}

export interface StrikeResult {
  contact: ContactReport;
  bat: BatSample[];
  exit: StrikeExit | null;
  impact: StrikeImpact | null;
  miss: StrikeMiss | null;
  /** Footwork played (a leave is played from the stance: batterBody(null)). */
  footwork: PlayedFootwork;
  /** Ideal contact time for the footwork played (= flight.idealContactT for automatic footwork). */
  idealT: number;
  /** The bat track (null for a leave), for replays and diagnostics. */
  track: BatTrack | null;
  /** Authoritative static whole-batter x/z root chosen before collision; zero for a leave/no track. */
  batterRootOffset: { x: number; z: number };
  /** Final planted support/torso/head frame used by the same anatomical collision and reach solve. */
  batterBodyFrame: {
    stance: { x: number; z: number };
    torsoTop: Vec3;
    headCentre: Vec3;
  };
  /** Authoritative planted crouch chosen before collision; zero for a leave/no track. */
  batterPosture: { crouchM: number };
  /** Authored motion timing; contactT is the planned velocity peak. Actual blade impulse time remains contact.t. */
  batterMotion: { startT: number; contactT: number; endT: number } | null;
  /** Where on the bat (blade hits): region, offset across the face (m, + along the width axis), sweet-spot hit. */
  quality: { region: BladeRegion | 'handle'; across: number; sweet: boolean } | null;
  /**
   * The swing began after the ball had already met the stance body or hit the stumps (PHYS2 5f): the ball, its impact
   * and the batter's frame are exactly the leave's; the swing is drawn as the raw swing from the input and touches
   * nothing; the report keeps the raw timing; no shot was offered.
   */
  lateSwing?: boolean;
  /**
   * The timing the bat played (PHYS2 5f): the raw error, the band-mapped error forgive(e) and the effective error the
   * swing was played at (the mapped error unless the causal cap reduced it). Real: all three equal. Null for a leave.
   */
  forgiveness?: { rawMs: number; mappedMs: number; effectiveMs: number };
}

/** Bisection steps of the causal cap on the forgiveness: the interval [forgive(e), e] (at most 82 ms) to 5 us. */
const CAUSAL_CAP_STEPS = 10;
/** The causal cap's upward scan step (ms) from the mapped error. */
const CAUSAL_CAP_SCAN_MS = 4;

/** Where the sweep starts: the ball 4.5 m from the striker's stumps (nothing of the batter reaches further). */
function sweepStart(samples: BallSample[]): number {
  for (const s of samples) if (s.p.z >= 5.5) return s.t;
  return samples[0].t;
}

/** Sweet-spot hit: within SWEET_ALONG_M along and SWEET_ACROSS_M across the face of the sweet spot. */
export function isSweet(bladeU: number, across: number): boolean {
  return Math.abs((bladeU - SWEET_U) * BLADE_L) <= SWEET_ALONG_M && Math.abs(across) <= SWEET_ACROSS_M;
}

function backspinRps(v: Vec3, spin: Vec3): number {
  const ax = cross(norm(v), v3(0, 1, 0));
  const l = len(ax);
  if (l < 1e-9) return 0;
  return dot(spin, v3(ax.x / l, ax.y / l, ax.z / l)) / (2 * Math.PI);
}

/** Contact kind of a blade or handle hit. */
export function classifyBladeHit(hit: SweepHit, faceBearing: number, intendedBearing: number): ContactKind {
  if (hit.part === 'handle' || !hit.blade) return 'top_edge';
  const { frame, contact, region } = hit.blade;
  if (region === 'face') return 'middle';
  if (region === 'shoulder') return 'top_edge';
  const side = contact.lw >= 0 ? frame.w : v3(-frame.w.x, -frame.w.y, -frame.w.z);
  const vertical = Math.abs(frame.a.y) >= 0.5;
  // A vertical bat's toe end met within the blade's width is a toe-cap contact: contract v6 has no toe kind, and the
  // lead ruling (2026-11-03) classes a toe-cap contact as a middle with bladeU reported. Before (PHYS2 phase 5), such a
  // hit took the inside or outside edge from the sign of its offset across the blade, which for a ball centred under
  // the toe is rounding noise (the 6.5 m drive at -54 ms, offset +0.00003 m, read as the inside edge once the toe was
  // rounded).
  if (vertical && region === 'toe' && Math.abs(contact.lw) <= BLADE_HALF_W) return 'middle';
  if (vertical) {
    const offSide = side.x > 0;
    if (!offSide) return 'inside_edge';
    return faceBearing < -20 ? 'leading_edge' : 'outside_edge';
  }
  if (side.y > 0) return 'top_edge';
  return intendedBearing >= 0 ? 'outside_edge' : 'inside_edge';
}

/**
 * The timing label once the bat has met the ball (lead decision, 2026-11-03: labels follow physics and never
 * contradict the outcome). A bat that met the ball never reads "missed": beyond the edge band it is "mistimed". A
 * block is graded by what it met: one that meets the ball on the face did its job and is at least "solid". An attacking
 * stroke otherwise keeps its pure band label, so a stroke timed right and beaten by the line still reads on time.
 */
export function metTiming(timing: Exclude<SwingTiming, 'none'>, swingKind: NormalizedSwing['kind'], kind: ContactKind): Exclude<SwingTiming, 'none'> {
  if (swingKind === 'defend' && kind === 'middle') return timing === 'perfect' ? 'perfect' : 'solid';
  return timing === 'missed' ? 'mistimed' : timing;
}

function emptyReport(kind: ContactKind, timing: SwingTiming, intended: number | null): ContactReport {
  return {
    kind,
    t: null,
    timingErrorMs: null,
    timing,
    point: null,
    bladeU: null,
    faceBearingDeg: null,
    batSpeedKph: null,
    exitSpeedKph: null,
    exitBearingDeg: null,
    exitElevationDeg: null,
    intendedBearingDeg: intended,
  };
}

function bodyImpact(hit: SweepHit, spin: Vec3): StrikeImpact {
  const out = impact({ v: hit.ballV, spin, n: hit.normal, surfaceV: v3(0, 0, 0), mass: Infinity, cor: PAD_COR, friction: PAD_FRICTION });
  const part = hit.part === 'front_pad' || hit.part === 'back_pad' ? 'pad' : 'body';
  return { t: hit.t, p: hit.ball, part, vIn: hit.ballV, vOut: out.v, spinOut: out.spin };
}

/**
 * Play (swing) or leave (null) a delivery. Deterministic in (flight, swing, opts).
 * The calibration offset is already in swing.startT (the input layer applies it); physics adds no latency.
 */
export function strike(flight: BallFlight, swing: NormalizedSwing | null, opts: StrikeOptions): StrikeResult {
  const samples = flight.samples;
  const t0 = sweepStart(samples);
  const t1 = samples[samples.length - 1].t;
  if (swing && !(Number.isFinite(swing.startT) && Number.isFinite(swing.directionDeg) && Number.isFinite(swing.power) && Number.isFinite(swing.elevation))) {
    swing = null; // a malformed swing cannot move the bat: treated as a leave
  }
  if (!swing) {
    const footwork = resolveFootwork(flight, 'auto');
    const body = batterBody(null);
    const batterBodyFrame = {
      stance: { x: body.stance.x, z: body.stance.z },
      torsoTop: { ...body.torso.b },
      headCentre: { ...body.head.c },
    };
    const sw = sweep(samples, null, body, t0, t1);
    if (sw.hit) {
      const imp = bodyImpact(sw.hit, incomingSpin(flight, sw.hit.t));
      const contact: ContactReport = { ...emptyReport(imp.part, 'none', null), t: imp.t, point: sw.hit.point };
      return { contact, bat: [], exit: null, impact: imp, miss: null, footwork, idealT: flight.idealContactT, track: null, batterRootOffset: { x: 0, z: 0 }, batterBodyFrame, batterPosture: { crouchM: 0 }, batterMotion: null, quality: null };
    }
    return {
      contact: emptyReport('leave', 'none', null),
      bat: [],
      exit: null,
      impact: null,
      miss: null,
      footwork,
      idealT: flight.idealContactT,
      track: null,
      batterRootOffset: { x: 0, z: 0 },
      batterBodyFrame,
      batterPosture: { crouchM: 0 },
      batterMotion: null,
      quality: null,
    };
  }
  const track = buildBatTrack(flight, swing, opts);
  const timing = classifyTiming(track.errorMs, activeBands(opts.assist, opts.tierToleranceMs ?? 0));
  const base: ContactReport = { ...emptyReport('miss', timing, swing.directionDeg), timingErrorMs: track.errorMs };
  // Causality (PHYS2 phase 5f; WORKER fix-round, evaluator eval-phys-5e after-stumps): no input changes anything that
  // happened before it. Until the player's raw input start the batter is the leave's, so a ball that met the stance
  // pads or body, or hit the stumps, before the input is resolved exactly as the leave (lateSwing). Before: the
  // footwork body stood in place for the whole trace, so a swing begun up to 150 ms after the stumps turned a bowled
  // leave into LBW (Real 4 of 120 inputs after the stumps in the evaluator's probe, 15 of 39 bowled leaves in WORKER's);
  // and the Learn/Play whole-swing shift (5e, SYS1) started the forgiven bat up to 82 ms before the input, so a defence
  // begun 1 ms after the stumps met the ball 76 ms before it (learn/20 middle, not out).
  const inputT = swing.startT;
  const deadT = flight.wouldHitStumps ? flight.stumpsT : Infinity;
  const leaveBody = batterBody(null);
  const preInput = inputT > t0 ? sweep(samples, null, leaveBody, t0, inputT).hit : null;
  if (inputT >= deadT || (preInput && preInput.t < inputT && preInput.t < deadT)) {
    // The ball, its impact and the batter's frame are the leave's; the swing is still drawn as played, the raw swing
    // from the input (Real at the raw error), touching nothing.
    const leave = strike(flight, null, opts);
    const kind = leave.contact.kind === 'leave' ? 'miss' : leave.contact.kind;
    const raw = opts.assist === 'real' ? track : buildBatTrack(flight, swing, { ...opts, assist: 'real', tierToleranceMs: 0 });
    const bat = batSamples(raw);
    return {
      ...leave,
      contact: { ...leave.contact, kind, timing, timingErrorMs: track.errorMs, intendedBearingDeg: swing.directionDeg },
      bat,
      track: raw,
      idealT: raw.idealT,
      batterMotion: { startT: bat[0].t, contactT: raw.plannedContactT, endT: raw.zoneOut },
      lateSwing: true,
    };
  }
  // buildBatTrack has already planned one anatomy-valid visible stroke and static whole-batter root from delivery,
  // read and swing inputs alone. The swing is played as the Real swing at its effective error: the footwork body
  // takes its place at the swing's own start (before that it does not collide; PHYS2 5f), and a touch once the ball has
  // broken the wicket is no touch. The plain sweep is kept wherever its first touch is not before the swing's start.
  const play = (tr: BatTrack): { hit: SweepHit | null; closest: SweepResult['closest'] } => {
    const plain = sweep(samples, tr, tr.body, t0, t1);
    const sw = plain.hit && plain.hit.t < tr.startT ? sweepFrom(samples, tr, tr.body, t0, t1, tr.startT) : plain;
    return { hit: sw.hit && sw.hit.t < deadT ? sw.hit : null, closest: sw.closest };
  };
  const causal = (sw: { hit: SweepHit | null }): boolean => !sw.hit || sw.hit.t >= inputT;
  let played = track;
  let sw = play(track);
  // The declared errors, computed exactly as buildBatTrack shifts the swing (bat.ts): Real plays the raw swing.
  const rawMs = track.errorMs;
  const mappedMs = opts.assist === 'real' ? rawMs : forgive(rawMs, activeBands(opts.assist, opts.tierToleranceMs ?? 0));
  let effectiveErrorMs = mappedMs;
  if (!causal(sw)) {
    // Causal cap on the forgiveness (lead ruling 2026-11-04, 5f). Learn and Play play the Real swing at the mapped
    // error forgive(e), whose start is before the input for a late swing; for a short-travel stroke (a block) begun
    // after the ball reached the batter it can meet the ball before the input (evaluator eval-phys-5e, 337 of 2,880
    // late Learn/Play results). The effective error is then reduced from forgive(e) towards e only as far as needed:
    // the smallest error in [forgive(e), e] whose first touch (bat, pad or body) is not before the raw input, found by
    // CAUSAL_CAP_STEPS bisection steps on that interval. e itself always qualifies: that swing starts at the input.
    // The result is exactly Real at the effective error (physErrorMs); the report keeps the raw error.
    const e = rawMs;
    const realAt = (x: number): BatTrack => buildBatTrack(flight, { ...swing, startT: inputT + (x - e) / 1000 }, { ...opts, assist: 'real', tierToleranceMs: 0 });
    let lo = mappedMs;
    let hi = e;
    played = realAt(hi);
    sw = play(played);
    // The first causal error: scan up from the mapped error on a fixed grid of CAUSAL_CAP_SCAN_MS (absolute errors, so
    // neighbouring inputs test the same errors), then bisect inside the first causal step. The causal set need not be
    // one interval; this takes the least reduction the grid can see.
    for (let x = (Math.floor(lo / CAUSAL_CAP_SCAN_MS) + 1) * CAUSAL_CAP_SCAN_MS; x < e; x += CAUSAL_CAP_SCAN_MS) {
      const trial = realAt(x);
      const trialSw = play(trial);
      if (causal(trialSw)) {
        hi = x;
        played = trial;
        sw = trialSw;
        break;
      }
      lo = x;
    }
    for (let step = 0; step < CAUSAL_CAP_STEPS; step++) {
      const mid = (lo + hi) / 2;
      const trial = realAt(mid);
      const trialSw = play(trial);
      if (causal(trialSw)) {
        hi = mid;
        played = trial;
        sw = trialSw;
      } else {
        lo = mid;
      }
    }
    effectiveErrorMs = hi;
    played = { ...played, errorMs: e };
  }
  const common = {
    footwork: played.footwork,
    idealT: played.idealT,
    track: played,
    batterRootOffset: played.batterRootOffset,
    batterBodyFrame: {
      stance: { x: played.body.stance.x, z: played.body.stance.z },
      torsoTop: { ...played.body.torso.b },
      headCentre: { ...played.body.head.c },
    },
    batterPosture: played.batterPosture,
  };
  const out = strikeWith(flight, swing, played, base, timing, sw, common);
  return { ...out, forgiveness: { rawMs, mappedMs, effectiveMs: effectiveErrorMs } };
}

type StrikeCommon = Pick<StrikeResult, 'footwork' | 'idealT' | 'track' | 'batterRootOffset' | 'batterBodyFrame' | 'batterPosture'>;

/** The strike result of one played track and its sweep (bat hit, body impact or miss). */
function strikeWith(
  flight: BallFlight,
  swing: NormalizedSwing,
  track: BatTrack,
  base: ContactReport,
  timing: Exclude<SwingTiming, 'none'>,
  sw: { hit: SweepHit | null; closest: SweepResult['closest'] },
  common: StrikeCommon,
): StrikeResult {
  if (!sw.hit) {
    const c = sw.closest;
    const pose = c ? batPose(track, c.t) : null;
    const contact: ContactReport = {
      ...base,
      kind: 'miss',
      t: c ? c.t : null,
      point: c ? c.ball : null,
      faceBearingDeg: pose ? bearingDeg(pose.n.x, pose.n.z) : null,
    };
    const miss = c ? { t: c.t, ball: c.ball, bat: c.bat, delta: sub(c.ball, c.bat) } : null;
    const presentedBat = batSamples(track);
    const batterMotion = { startT: presentedBat[0].t, contactT: track.plannedContactT, endT: track.zoneOut };
    return { contact, bat: presentedBat, exit: null, impact: null, miss, quality: null, batterMotion, ...common };
  }
  const hit = sw.hit;
  const pose = batPose(track, hit.t);
  const faceBearing = bearingDeg(pose.n.x, pose.n.z);
  if (hit.part !== 'blade' && hit.part !== 'handle') {
    const imp = bodyImpact(hit, incomingSpin(flight, hit.t));
    const contact: ContactReport = { ...base, kind: imp.part, t: hit.t, point: hit.point, faceBearingDeg: faceBearing };
    const presentedBat = batSamples(track);
    const batterMotion = { startT: presentedBat[0].t, contactT: track.plannedContactT, endT: track.zoneOut };
    return { contact, bat: presentedBat, exit: null, impact: imp, miss: null, quality: null, batterMotion, ...common };
  }
  const kind = classifyBladeHit(hit, faceBearing, swing.directionDeg);
  const batV = batPointVelocity(track, hit.t, hit.point);
  let cor: number;
  let mass: number;
  let friction = BAT_FRICTION;
  let bladeU: number;
  let across = 0;
  let region: BladeRegion | 'handle' = 'handle';
  if (hit.blade) {
    const c = hit.blade.contact;
    region = hit.blade.region;
    bladeU = (c.lu + BLADE_L / 2) / BLADE_L;
    across = c.lw;
    if (region === 'face') {
      cor = faceCor(swing.kind, bladeU, across, track.balance);
      const w = Math.min(1, Math.abs(across) / BLADE_HALF_W);
      mass = (swing.kind === 'defend' ? DEFEND_EFF_MASS : BAT_EFF_MASS) * track.balance * (1 - 0.5 * w * w);
    } else {
      cor = COR_EDGE;
      mass = EDGE_EFF_MASS;
    }
  } else {
    const f = bladeFrame(pose);
    bladeU = (dot(sub(hit.point, f.centre), f.a) + BLADE_L / 2) / BLADE_L;
    cor = 0.2;
    mass = 0.5;
    friction = 0.4;
  }
  // The swing's arc changes effective mass along the blade; velocity is the exact rigid-body velocity field at the
  // actual contact point and time, never a central stencil across a kinematic branch.
  const arm = swingArm(bladeU < 0 ? 0 : bladeU > 1 ? 1 : bladeU);
  mass *= arm.mass;
  const out = impact({ v: hit.ballV, spin: incomingSpin(flight, hit.t), n: hit.normal, surfaceV: batV, mass, cor, friction });
  const exit: StrikeExit = { t: hit.t, p: hit.ball, v: out.v, spin: out.spin, spinRps: backspinRps(out.v, out.spin) };
  const contact: ContactReport = {
    ...base,
    kind,
    timing: metTiming(timing, swing.kind, kind),
    t: hit.t,
    point: hit.point,
    bladeU,
    faceBearingDeg: faceBearing,
    batSpeedKph: len(batV) * 3.6,
    exitSpeedKph: len(out.v) * 3.6,
    exitBearingDeg: bearingDeg(out.v.x, out.v.z),
    exitElevationDeg: elevationDeg(out.v),
  };
  const quality = { region, across, sweet: region === 'face' && isSweet(bladeU, across) };
  // Collision, point velocity and every outcome above use the untouched canonical batPose. Only after a blade or
  // handle hit is final do we author the result/render trace with its exact impulse knot. Non-bat outcomes use the
  // same continuous canonical no-impulse path above and never inherit this collision tangent.
  const presentedBat = presentationBatSamples(track, hit.t);
  if (!presentedBat) throw new Error('Admitted blade/handle contact has no safe presentation trace');
  const batterMotion = { startT: presentedBat[0].t, contactT: track.plannedContactT, endT: presentedBat.at(-1)!.t };
  return { contact, bat: presentedBat, exit, impact: null, miss: null, quality, batterMotion, ...common };
}
