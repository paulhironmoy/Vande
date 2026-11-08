/**
 * TEST FIXTURE ONLY: a small, deterministic cricket world for the Director's tests. It is not the physics (src/physics
 * is): a ballistic ball with one bounce, a bowler running in on a straight line and a striker at the crease, only
 * so that the directions the Director asks for (to the ball, the bowler's head and hand) have the right geometry
 * (distances, angular speeds, sizes). Metres: x across the pitch, y up, z down the pitch from the bowler's end (-z) to
 * the striker's (+z). Angles: yaw + left, pitch + down, as in channels.ts.
 */
import type { AimTarget, DirectorAnchors, Role } from '@/render3d/core/motion/director';
import clipFixture from './fixtures/bowler-clip-head.json';

const DEG = 180 / Math.PI;
const G = 9.81;
const BALL_R = 0.036;
const PITCH_HALF = 10.06;
/** The striker's eye (camera.ts BATTER_EYE: height 1.68, lateral 0.2, 1.2 m in front of the stumps). */
const EYE_S = { x: -0.2, y: 1.68, z: PITCH_HALF - 1.2 };
const REL = { x: 0.32, y: 2.1, z: -PITCH_HALF + 1.22 + 0.15 };
const CREASE_Z = PITCH_HALF - 1.22 + 0.1;

export type Outcome = 'four' | 'six' | 'two' | 'caught' | 'dot' | 'missed' | 'leave' | 'bowled';
export const OUTCOMES: readonly Outcome[] = ['four', 'six', 'two', 'caught', 'dot', 'missed', 'leave', 'bowled'];

export interface BallSpec {
  speedKph: number;
  /** Metres in front of the striker's stumps where the ball pitches. */
  lengthM: number;
  /** Lateral line at the stumps (m). */
  lineM: number;
  /** A label for the delivery's variation (carried to the Spearman tests; it changes nothing in the ball's path). */
  variation: number;
  outcome: Outcome;
}

/** How the crowd reads each test outcome (emotion.ts EmotionOutcome): the category the striker's reaction follows (P3). */
export const OUTCOME_CATEGORY: Record<Outcome, string> = {
  four: 'four',
  six: 'six',
  two: 'runs',
  caught: 'wicket',
  dot: 'dot',
  missed: 'close_call',
  leave: 'leave',
  bowled: 'wicket',
};

export const STOCK: BallSpec = { speedKph: 136, lengthM: 6, lineM: 0.05, variation: 0, outcome: 'four' };

interface P3 {
  x: number;
  y: number;
  z: number;
}

/** The scene timeline of one delivery (scene ms), the way the stage's script has it. */
export interface Timeline {
  start: number;
  gather: number;
  release: number;
  end: number;
  swing: number | null;
  contact: number | null;
  /** The ball passes the batter's crease (flight without contact). */
  passAt: number;
  outcomeAt: number;
  dead: number;
  strokeEnd: number | null;
  runs: number;
}

export interface Delivery {
  spec: BallSpec;
  timeline: Timeline;
  /** The ball as drawn at scene ms t, or null when it is not drawn. `pre` is the flight before the result is known. */
  ball(tMs: number, pre?: boolean): P3 | null;
}

/** Hand and head of the bowler, scene ms. */
function bowlerHead(t: number, release: number): P3 {
  const u = Math.min(1, Math.max(0, (t - 300) / (release - 300)));
  const ease = u * u * (3 - 2 * u) * 0.35 + u * 0.65;
  const zRun = -21 + (-9.3 + 21) * ease;
  const after = Math.min(1.6, Math.max(0, (t - release) / 1000));
  return {
    x: 0.2,
    y: 1.78 - 0.04 * Math.sin(t / 95) * (u > 0 && t < release ? 1 : 0.3),
    z: t < release ? zRun : -9.3 + 1.1 * after,
  };
}
function bowlerHand(t: number, release: number): P3 {
  const h = bowlerHead(t, release);
  const u = Math.min(1, Math.max(0, (t - (release - 600)) / 600));
  const s = u * u * (3 - 2 * u);
  return {
    x: h.x + 0.12 + (REL.x - h.x - 0.12) * s,
    y: h.y - 0.7 + (REL.y - h.y + 0.7) * s,
    z: h.z + 0.1 + (REL.z - h.z - 0.1) * s,
  };
}

export function delivery(spec: BallSpec, release = 2420): Delivery {
  const vz0 = (spec.speedKph / 3.6) * 0.985;
  const bz = PITCH_HALF - spec.lengthM;
  const tb = (bz - REL.z) / vz0;
  const vy0 = (BALL_R - REL.y + 0.5 * G * tb * tb) / tb;
  const vyb = -(vy0 - G * tb);
  const vz1 = vz0 * 0.88;
  const vx = (spec.lineM - REL.x) / ((PITCH_HALF - REL.z) / vz0);
  const flight = (s: number): P3 => {
    if (s <= tb) return { x: REL.x + vx * s, y: REL.y + vy0 * s - 0.5 * G * s * s, z: REL.z + vz0 * s };
    const r = s - tb;
    return { x: REL.x + vx * s, y: Math.max(BALL_R, BALL_R + 0.53 * vyb * r - 0.5 * G * r * r), z: bz + vz1 * r };
  };
  const tPass = tb + (CREASE_Z - bz) / vz1;
  const hits =
    spec.outcome === 'four' ||
    spec.outcome === 'six' ||
    spec.outcome === 'two' ||
    spec.outcome === 'caught' ||
    spec.outcome === 'dot';
  const swung = hits || spec.outcome === 'missed' || spec.outcome === 'bowled';
  const contactS = hits ? tPass : null;
  const tc = contactS ?? tPass;
  const pc = flight(tc);
  // After the bat: a low drive, a lofted six, a catch, a defended dot.
  const phi = (spec.lineM - 0.05) * 0.8 + 0.25;
  const after = (r: number): P3 => {
    const hx = Math.sin(phi);
    const hz = -Math.cos(phi);
    switch (spec.outcome) {
      case 'four': {
        const d = 25 * r - 2 * r * r;
        return { x: pc.x + hx * d, y: Math.max(BALL_R, pc.y + 3 * r - 0.5 * G * r * r), z: pc.z + hz * d };
      }
      case 'two': {
        const d = 12 * r - r * r;
        return { x: pc.x + hx * d, y: Math.max(BALL_R, pc.y + 2 * r - 0.5 * G * r * r), z: pc.z + hz * d };
      }
      case 'six': {
        const d = 26 * r;
        return { x: pc.x + hx * d, y: Math.max(BALL_R, pc.y + 18 * r - 0.5 * G * r * r), z: pc.z + hz * d };
      }
      case 'caught': {
        const d = 14 * r;
        return { x: pc.x + hx * d, y: Math.max(BALL_R, pc.y + 14 * r - 0.5 * G * r * r), z: pc.z + hz * d };
      }
      default: {
        const d = Math.min(1.5, 3 * r - r * r);
        return { x: pc.x + hx * d, y: Math.max(BALL_R, pc.y + 1.5 * r - 0.5 * G * r * r), z: pc.z + hz * d };
      }
    }
  };
  // Without contact the ball goes on to the keeper (gathered at z = 11.6) or into the stumps.
  const tKeeper = tb + (11.6 - bz) / (vz1 * 0.9);
  const tStumps = tb + (PITCH_HALF - bz) / vz1;
  const rel = (s: number): P3 => {
    if (spec.outcome === 'bowled' && s > tStumps) {
      const r = s - tStumps;
      return { x: flight(tStumps).x, y: Math.max(BALL_R, 0.4 - 0.5 * G * r * r), z: PITCH_HALF + 1.2 * r };
    }
    if (s > tKeeper) return { x: flight(tKeeper).x * 0.5, y: 0.9, z: 11.6 };
    return flight(s);
  };
  const tl: Timeline = (() => {
    const r0 = release;
    let outcomeAt: number;
    switch (spec.outcome) {
      case 'four':
        outcomeAt = r0 + (tc + 3.7) * 1000;
        break;
      case 'six':
        outcomeAt = r0 + (tc + 2.7) * 1000;
        break;
      case 'two':
        outcomeAt = r0 + (tc + 3.0) * 1000;
        break;
      case 'caught':
        outcomeAt = r0 + (tc + 2.86) * 1000;
        break;
      case 'dot':
        outcomeAt = r0 + (tc + 2.2) * 1000;
        break;
      case 'bowled':
        outcomeAt = r0 + tStumps * 1000;
        break;
      default:
        outcomeAt = r0 + tKeeper * 1000;
    }
    const swing = swung ? r0 + tc * 1000 - 260 : null;
    const dead = outcomeAt + (spec.outcome === 'dot' ? 0 : 500);
    return {
      start: 0,
      gather: r0 - 620,
      release: r0,
      end: Math.max(dead + 1800, r0 + 6000),
      swing,
      contact: contactS === null ? null : r0 + contactS * 1000,
      passAt: r0 + tPass * 1000,
      outcomeAt,
      dead,
      strokeEnd: swing === null ? r0 + tPass * 1000 + 300 : swing + 900,
      runs: spec.outcome === 'two' ? 2 : 0,
    };
  })();
  return {
    spec,
    timeline: tl,
    ball(tMs, pre = false) {
      if (tMs < 0) return null;
      if (tMs < release) return bowlerHand(tMs, release);
      const s = (tMs - release) / 1000;
      if (tMs > tl.dead && !pre) return null;
      if (contactS === null || pre || s <= tc) return rel(s);
      return after(s - tc);
    },
  };
}

const dirOf = (role: Role, eye: P3, p: P3, out: Float64Array) => {
  const fwd = role === 'bowler' ? p.z - eye.z : eye.z - p.z;
  const left = role === 'bowler' ? p.x - eye.x : eye.x - p.x;
  out[0] = Math.atan2(left, fwd) * DEG;
  out[1] = Math.atan2(eye.y - p.y, Math.hypot(fwd, left)) * DEG;
};

/** The head of the actor's clip, the way the real clips measure (FACE-1): the striker's is still and 11 degrees off. */
export type ClipHeadModel = 'real' | 'locked' | 'whip' | 'none';

export interface MakeOptions {
  role: Role;
  key: string;
  person?: string;
  reducedMotion?: boolean;
  headPx?: number;
  /** Live, before the result: no contact, no outcome, no dead ball, the flight goes on as if unhit. */
  pre?: boolean;
  /** Which bowler clip series drives the clip head (the real fixtures: 'pace', 'pace-late', 'spin'). */
  series?: 'pace' | 'pace-late' | 'spin';
  clip?: ClipHeadModel;
  /**
   * P3: the ball callback honours `aheadMs` (the production callback does): the ball carried on at its velocity of 10 ms
   * ending at the time asked. Off (default): the callback ignores it, which is the pure-latency mode the P1/P2 tests of
   * the pursuit lag were written for.
   */
  lead?: boolean;
}

type Series = { t0: number; dtMs: number; gather: number; release: number; yaw: number[]; pitch: number[] };
export const SERIES: Record<string, Series> = (clipFixture as unknown as { series: Record<string, Series> }).series;

/** Anchors for one actor of a delivery. */
export function anchorsFor(d: Delivery, o: MakeOptions): DirectorAnchors {
  const t = d.timeline;
  const pre = Boolean(o.pre);
  const ser = o.series ? SERIES[o.series] : null;
  const eyeB = (ms: number): P3 => bowlerHead(ms, t.release);
  const hd: P3 = { x: -0.15, y: 1.58, z: 8.9 };
  const eye = (ms: number): P3 => (o.role === 'bowler' ? eyeB(ms) : EYE_S);
  const opponent = (ms: number): P3 => (o.role === 'bowler' ? hd : eyeB(ms));
  const aim = (target: AimTarget, ms: number, out: Float64Array): boolean => {
    dirOf(o.role, eye(ms), target === 'hand' ? bowlerHand(ms, t.release) : opponent(ms), out);
    return true;
  };
  const visibleBall = (ms: number, out: Float64Array, aheadMs = 0): boolean => {
    const p = d.ball(ms, pre);
    if (!p) return false;
    const ahead = o.lead ? aheadMs : 0;
    let q = p;
    if (ahead > 0) {
      // Constant velocity from the ball at ms and 10 ms before it: nothing later than ms.
      const p2 = d.ball(ms - 10, pre);
      if (p2) {
        const k = ahead / 10;
        q = { x: p.x + (p.x - p2.x) * k, y: p.y + (p.y - p2.y) * k, z: p.z + (p.z - p2.z) * k };
      }
    }
    dirOf(o.role, eye(ms + ahead), q, out);
    return true;
  };
  const clipHead = (ms: number, out: Float64Array) => {
    out[2] = 0;
    const m = o.clip ?? 'real';
    if (o.role === 'striker' || m === 'none') {
      out[0] = o.role === 'striker' ? 11.3 : 0;
      out[1] = o.role === 'striker' ? 2.9 : 0;
      return;
    }
    // Bowler: the batter's direction plus the measured error.
    dirOf('bowler', eyeB(ms), hd, out);
    if (!ser) return;
    const f = Math.min(ser.yaw.length - 1, Math.max(0, (ms - ser.t0) / ser.dtMs));
    const i = Math.min(ser.yaw.length - 2, Math.floor(f));
    const w = f - i;
    out[0] += ser.yaw[i] + (ser.yaw[i + 1] - ser.yaw[i]) * w;
    out[1] += ser.pitch[i] + (ser.pitch[i + 1] - ser.pitch[i]) * w;
  };
  return {
    role: o.role,
    person: o.person ?? 'look-1',
    key: o.key,
    start: t.start,
    end: t.end,
    gather: o.role === 'bowler' ? t.gather : null,
    release: t.release,
    swing: pre || o.role === 'bowler' ? null : t.swing,
    contact: pre || o.role === 'bowler' ? null : t.contact,
    taskEnd: pre ? t.passAt : (t.contact ?? t.passAt),
    outcomeAt: pre ? null : t.outcomeAt,
    outcome: pre || o.role === 'bowler' ? null : OUTCOME_CATEGORY[d.spec.outcome],
    dead: pre ? null : t.dead,
    strokeEnd: pre || o.role === 'bowler' ? null : t.strokeEnd,
    runs: pre ? 0 : t.runs,
    reducedMotion: Boolean(o.reducedMotion),
    headPx: o.headPx ?? 40,
    visibleBall,
    aim,
    clipHead,
  };
}

/** Anchors for a script between deliveries (no release, no ball). */
export function idleAnchors(
  role: Role,
  key: string,
  endMs: number,
  o: { person?: string; reducedMotion?: boolean } = {},
): DirectorAnchors {
  const hd: P3 = { x: -0.15, y: 1.58, z: 8.9 };
  const stand: P3 = { x: 0.2, y: 1.78, z: -9.9 };
  const eye = role === 'bowler' ? stand : EYE_S;
  return {
    role,
    person: o.person ?? 'look-1',
    key,
    start: 0,
    end: endMs,
    gather: null,
    release: null,
    swing: null,
    contact: null,
    taskEnd: null,
    outcomeAt: null,
    dead: null,
    strokeEnd: null,
    runs: 0,
    reducedMotion: Boolean(o.reducedMotion),
    headPx: 40,
    visibleBall: () => false,
    aim: (target, _ms, out) => {
      dirOf(
        role,
        eye,
        target === 'hand' ? { x: stand.x + 0.12, y: 1.1, z: stand.z + 0.1 } : role === 'bowler' ? hd : stand,
        out,
      );
      return true;
    },
    clipHead: (_ms, out) => {
      out[0] = role === 'striker' ? 11.3 : 0;
      out[1] = role === 'striker' ? 2.9 : 0;
      out[2] = 0;
    },
  };
}

/** A small deterministic generator for the tests' own draws (mulberry32); never the Director's. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A varied delivery: 90 .. 150 km/h, 1 .. 11 m length, a line within 0.6 m, one of eight variations, any outcome. */
export function randomSpec(r: () => number): BallSpec {
  return {
    speedKph: 90 + r() * 60,
    lengthM: 1 + r() * 10,
    lineM: (r() - 0.5) * 1.2,
    variation: Math.floor(r() * 8),
    outcome: OUTCOMES[Math.floor(r() * OUTCOMES.length)],
  };
}
