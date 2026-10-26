/**
 * The diagnostic replay's overlays, as data (world frame): the ball's incoming and outgoing path, where it pitched,
 * the bat's path (its sweet spot) with ghost bats along the swing, the ideal contact point against the actual one
 * (that gap IS the timing), the bat face at contact, and the intended scoring direction against the actual one.
 * Every point carries the scene time it is passed at, so the overlays draw themselves in step with the replay.
 * Pure: the same result always gives the same overlays. No text: the HUD over the canvas names things.
 */
import type { DeliveryResult, LbwReason, SwingTiming, Vec3 as PVec3 } from '@/contracts/practice';
import { batterBody } from '@/physics/bat';
import type { Vec3 } from '../core/math';
import { sweetSpot } from './bat';
import { ballAt, batAt, batToWorld, simToScene, toWorld, type BatPose } from './frame';

export interface DiagnosticArrow {
  from: Vec3;
  /** Unit direction on the ground. */
  dir: Vec3;
  length: number;
}

export interface Diagnostics {
  incoming: Vec3[];
  incomingT: number[];
  outgoing: Vec3[];
  outgoingT: number[];
  release: Vec3;
  bounce: Vec3 | null;
  /** The ball at the ideal contact moment (the timing reference) and where the bat actually met it. */
  ideal: Vec3 | null;
  contact: Vec3 | null;
  batPath: Vec3[];
  batPathT: number[];
  batGhosts: BatPose[];
  batAtContact: BatPose | null;
  /** The bat face's direction at contact (unit, on the ground plane). */
  face: Vec3 | null;
  intended: DiagnosticArrow | null;
  actual: DiagnosticArrow | null;
  timingErrorMs: number | null;
  timing: SwingTiming;
  /**
   * The LBW picture when the ball hit the pad or body first: the impact, the unimpeded flight from there to the
   * stumps plane (the physics' own projection), and whether it was hitting.
   */
  lbw: { impact: Vec3; path: Vec3[]; projected: Vec3; out: boolean; reason: LbwReason; at: number } | null;
  /** The batter's body as the collisions used it (pads, torso, head), shown when the ball met pad or body. */
  body: Array<{ a: Vec3; b: Vec3; r: number }> | null;
  /** Scene ms of each ghost bat. */
  batGhostT: number[];
  /** Scene ms: the release, the pitch, the ideal contact, the contact (or closest approach), the end of the paths. */
  times: { release: number; bounce: number | null; ideal: number; contact: number | null; end: number };
}

const INCOMING_STEP = 0.01;
const OUTGOING_STEP = 0.02;
const OUTGOING_MAX_S = 2.6;
const GHOSTS = 5;

/** Ground direction of a bearing (degrees from straight, + = off side) in the world. */
export function bearingDir(bearingDeg: number, mirror: boolean): Vec3 {
  const a = (bearingDeg * Math.PI) / 180;
  return toWorld({ x: Math.sin(a), y: 0, z: -Math.cos(a) }, mirror);
}

export function buildDiagnostics(result: DeliveryResult, releaseScene: number, mirror: boolean): Diagnostics {
  const tb = { releaseScene };
  const c = result.contact;
  const w = (p: PVec3) => toWorld(p, mirror);
  const lastT = result.ball.at(-1)?.t ?? result.deadT;
  const stumps = result.events.find((e) => e.kind === 'stumps' || e.kind === 'keeper_take');
  const touched = c.t !== null && c.kind !== 'miss' && c.kind !== 'leave';
  const inEnd = touched ? c.t! : Math.min(lastT, stumps ? stumps.t : Math.max(result.flight.stumpsT + 0.15, c.t ?? 0));
  const incoming: Vec3[] = [];
  const incomingT: number[] = [];
  for (let t = 0; t < inEnd; t += INCOMING_STEP) {
    const p = ballAt(result.ball, t);
    if (p) {
      incoming.push(w(p));
      incomingT.push(simToScene(tb, t));
    }
  }
  const pEnd = ballAt(result.ball, inEnd);
  if (pEnd) {
    incoming.push(w(pEnd));
    incomingT.push(simToScene(tb, inEnd));
  }
  const outgoing: Vec3[] = [];
  const outgoingT: number[] = [];
  if (touched) {
    const outEnd = Math.min(lastT, c.t! + OUTGOING_MAX_S, result.deadT);
    for (let t = c.t!; t <= outEnd + 1e-9; t += OUTGOING_STEP) {
      const p = ballAt(result.ball, t);
      if (p) {
        outgoing.push(w(p));
        outgoingT.push(simToScene(tb, t));
      }
    }
  }
  const batPath: Vec3[] = [];
  const batPathT: number[] = [];
  const ghosts: BatPose[] = [];
  const ghostT: number[] = [];
  let batAtContact: BatPose | null = null;
  if (result.bat.length) {
    const t0 = result.bat[0].t;
    const tc = c.t ?? result.flight.idealContactT;
    const t1 = Math.min(result.bat.at(-1)!.t, tc + 0.12);
    for (let t = t0; t <= t1 + 1e-9; t += 0.008) {
      const pose = batAt(result.bat, t);
      if (!pose) continue;
      batPath.push(w(sweetSpot(pose)));
      batPathT.push(simToScene(tb, t));
    }
    for (let k = 0; k < GHOSTS; k++) {
      const tk = t0 + ((tc - t0) * k) / GHOSTS;
      const pose = batAt(result.bat, tk);
      if (pose) {
        ghosts.push(batToWorld(pose, mirror));
        ghostT.push(simToScene(tb, tk));
      }
    }
    const atC = batAt(result.bat, tc);
    batAtContact = atC ? batToWorld(atC, mirror) : null;
  }
  const idealP = ballAt(result.ball, result.flight.idealContactT) ?? ballAt(result.flight.samples, result.flight.idealContactT);
  const contactP = c.point ? w(c.point) : null;
  const from = contactP ?? (idealP ? w(idealP) : w(result.flight.release.p));
  const ground = { x: from.x, y: 0.02, z: from.z };
  const face = c.faceBearingDeg !== null ? bearingDir(c.faceBearingDeg, mirror) : null;
  const intended = c.intendedBearingDeg !== null ? { from: ground, dir: bearingDir(c.intendedBearingDeg, mirror), length: 12 } : null;
  const actual = c.exitBearingDeg !== null && touched ? { from: ground, dir: bearingDir(c.exitBearingDeg, mirror), length: Math.min(22, Math.max(6, result.outcome.endDistanceM ?? 14)) } : null;
  let lbw: Diagnostics['lbw'] = null;
  if (result.lbw) {
    const hit = result.events.find((e) => e.kind === 'pad' || (e.kind === 'contact' && (e.contact === 'pad' || e.contact === 'body')));
    const tHit = hit ? hit.t : (c.t ?? result.flight.idealContactT);
    const path: Vec3[] = [];
    for (let t = tHit; t <= result.flight.stumpsT + 1e-9; t += INCOMING_STEP) {
      const p = ballAt(result.flight.samples, t);
      if (p) path.push(w(p));
    }
    path.push(w(result.lbw.projected));
    lbw = { impact: w(result.lbw.impact), path, projected: w(result.lbw.projected), out: result.lbw.out, reason: result.lbw.reason, at: simToScene(tb, tHit) };
  }
  const padOrBody = c.kind === 'pad' || c.kind === 'body' || result.lbw !== null;
  const bodyOf = padOrBody ? batterBody(result.footwork, result.flight) : null;
  const body = bodyOf ? [...bodyOf.pads, bodyOf.torso, { a: bodyOf.head.c, b: bodyOf.head.c, r: bodyOf.head.r }].map((k) => ({ a: w(k.a), b: w(k.b), r: k.r })) : null;
  return {
    lbw,
    body,
    incoming,
    incomingT,
    outgoing,
    outgoingT,
    release: w(result.flight.release.p),
    bounce: result.flight.bounce ? w(result.flight.bounce.p) : null,
    ideal: idealP ? w(idealP) : null,
    contact: contactP,
    batPath,
    batPathT,
    batGhosts: ghosts,
    batGhostT: ghostT,
    batAtContact,
    face,
    intended,
    actual,
    timingErrorMs: c.timingErrorMs,
    timing: c.timing,
    times: {
      release: releaseScene,
      bounce: result.flight.bounce ? simToScene(tb, result.flight.bounce.t) : null,
      ideal: simToScene(tb, result.flight.idealContactT),
      contact: c.t !== null ? simToScene(tb, c.t) : null,
      end: outgoingT.at(-1) ?? incomingT.at(-1) ?? releaseScene,
    },
  };
}

/** How many of a path's points are revealed at scene time t (overlays draw in step with the replay). */
export function revealed(times: readonly number[], t: number): number {
  let n = 0;
  while (n < times.length && times[n] <= t) n++;
  return n;
}
