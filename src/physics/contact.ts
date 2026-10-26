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
  BAT_COR,
  BAT_EFF_MASS,
  BAT_FRICTION,
  BLADE_HALF_W,
  BLADE_L,
  COR_ACROSS_LOSS,
  COR_ALONG_FLOOR,
  COR_ALONG_M,
  COR_EDGE,
  DEFEND_COR,
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
  batPose,
  batSamples,
  batterBody,
  buildBatTrack,
  incomingSpin,
  resolveFootwork,
} from './bat';
import { type BladeRegion, type SweepHit, bladeFrame, sweep } from './collision';
import { impact } from './impact';
import { activeBands, classifyTiming } from './timing';
import { type Vec3, bearingDeg, cross, dot, elevationDeg, len, norm, sub, v3 } from './vec';

export type { StrikeOptions };

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
  /** Where on the bat (blade hits): region, offset across the face (m, + along the width axis), sweet-spot hit. */
  quality: { region: BladeRegion | 'handle'; across: number; sweet: boolean } | null;
}

/** Where the sweep starts: the ball 4.5 m from the striker's stumps (nothing of the batter reaches further). */
function sweepStart(samples: BallSample[]): number {
  for (const s of samples) if (s.p.z >= 5.5) return s.t;
  return samples[0].t;
}

/** Effective restitution of a face hit at (bladeU, across offset). */
export function faceCor(kind: NormalizedSwing['kind'], bladeU: number, across: number, balance: number): number {
  const du = (bladeU - SWEET_U) * BLADE_L;
  const q = du / COR_ALONG_M;
  const along = Math.max(COR_ALONG_FLOOR, 1 - (1 - COR_ALONG_FLOOR) * q * q);
  const w = Math.min(1, Math.abs(across) / BLADE_HALF_W);
  const acrossF = 1 - COR_ACROSS_LOSS * w * w;
  return (kind === 'defend' ? DEFEND_COR : BAT_COR) * along * acrossF * (0.9 + 0.1 * balance);
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
  if (vertical) {
    const offSide = side.x > 0;
    if (!offSide) return 'inside_edge';
    return faceBearing < -20 ? 'leading_edge' : 'outside_edge';
  }
  if (side.y > 0) return 'top_edge';
  return intendedBearing >= 0 ? 'outside_edge' : 'inside_edge';
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

/** Velocity of a point fixed to the bat (given at time t) at time t. */
function pointVelocity(track: BatTrack, t: number, point: Vec3): Vec3 {
  const f = bladeFrame(batPose(track, t));
  const d = sub(point, f.centre);
  const lu = dot(d, f.a);
  const lw = dot(d, f.w);
  const ln = dot(d, f.n);
  const at = (tt: number): Vec3 => {
    const g = bladeFrame(batPose(track, tt));
    return v3(
      g.centre.x + g.a.x * lu + g.w.x * lw + g.n.x * ln,
      g.centre.y + g.a.y * lu + g.w.y * lw + g.n.y * ln,
      g.centre.z + g.a.z * lu + g.w.z * lw + g.n.z * ln,
    );
  };
  const h = 0.0002;
  const p1 = at(t + h);
  const p0 = at(t - h);
  return v3((p1.x - p0.x) / (2 * h), (p1.y - p0.y) / (2 * h), (p1.z - p0.z) / (2 * h));
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
    const sw = sweep(samples, null, batterBody(null), t0, t1);
    if (sw.hit) {
      const imp = bodyImpact(sw.hit, incomingSpin(flight, sw.hit.t));
      const contact: ContactReport = { ...emptyReport(imp.part, 'none', null), t: imp.t, point: sw.hit.point };
      return { contact, bat: [], exit: null, impact: imp, miss: null, footwork, idealT: flight.idealContactT, track: null, quality: null };
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
      quality: null,
    };
  }
  const track = buildBatTrack(flight, swing, opts);
  const timing = classifyTiming(track.errorMs, activeBands(opts.assist, opts.tierToleranceMs ?? 0));
  const bat = batSamples(track);
  const base: ContactReport = { ...emptyReport('miss', timing, swing.directionDeg), timingErrorMs: track.errorMs };
  const sw = sweep(samples, track, track.body, t0, t1);
  const common = { bat, footwork: track.footwork, idealT: track.idealT, track };
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
    return { contact, exit: null, impact: null, miss, quality: null, ...common };
  }
  const hit = sw.hit;
  const pose = batPose(track, hit.t);
  const faceBearing = bearingDeg(pose.n.x, pose.n.z);
  if (hit.part !== 'blade' && hit.part !== 'handle') {
    const imp = bodyImpact(hit, incomingSpin(flight, hit.t));
    const contact: ContactReport = { ...base, kind: imp.part, t: hit.t, point: hit.point, faceBearingDeg: faceBearing };
    return { contact, exit: null, impact: imp, miss: null, quality: null, ...common };
  }
  const kind = classifyBladeHit(hit, faceBearing, swing.directionDeg);
  const batV = pointVelocity(track, hit.t, hit.point);
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
  const out = impact({ v: hit.ballV, spin: incomingSpin(flight, hit.t), n: hit.normal, surfaceV: batV, mass, cor, friction });
  const exit: StrikeExit = { t: hit.t, p: hit.ball, v: out.v, spin: out.spin, spinRps: backspinRps(out.v, out.spin) };
  const contact: ContactReport = {
    ...base,
    kind,
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
  return { contact, exit, impact: null, miss: null, quality, ...common };
}
