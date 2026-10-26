/**
 * The one normalized input model: raw pointer or keyboard samples → one NormalizedSwing, whatever the device.
 *
 *   start      the pointer-down (a key press for the keyboard), or a resting finger's first intentional movement,
 *              minus the calibration offset, on the simulation clock (seconds after release)
 *   tap        no movement beyond the threshold → the defensive straight bat (fixed low power, straight)
 *   flick      direction from the first READ_WINDOW_MS of movement (screen-up = straight, towards the batter's off
 *              side = +, mirrored for left-handers); power from its speed; elevation from its length (short stays
 *              along the ground, long is lofted)
 *   no input   a leave (the caller passes `null` to the physics; nothing here is called)
 *
 * Pure and deterministic: the same samples always give the same swing, and nothing waits for pointer-up. Raw samples
 * are read here and dropped; they are never stored or sent anywhere.
 */
import type { GestureInput, GestureSample, Handedness, NormalizedSwing } from '@/contracts/practice';
import { ATTACK_MIN_POWER, DEFEND_POWER, ELEVATION, MIN_READ_MS, MOVE_THRESHOLD, ONSET_SPEED_PX_PER_MS, POWER_SPEED, PRECISION, READ_WINDOW_MS, TAP_DECIDE_MS } from './constants';

export interface NormalizeOptions {
  /** performance.now() time at which the ball left the bowler's hand (PracticeStage.bowl resolves with it). */
  releasePerfMs: number;
  /** Device and input latency from the calibration (Calibration.offsetMs); + means taps register late. */
  calibrationMs: number;
  handedness: Handedness;
  /** Simulation seconds per real second (PracticeStage.setTimeScale, a test hook; 1 in play). */
  timeScale?: number;
}

/** What the samples say before any clock or handedness is applied (the tracker and the tests use it too). */
export interface GestureRead {
  kind: 'tap' | 'flick';
  /** Swing start (performance.now() ms): the pointer-down, or a resting finger's first intentional movement. */
  startMs: number;
  /** Flicks: where the movement began (ms), else null. */
  onsetMs: number | null;
  /** How much of the read window the samples actually covered (ms, at least MIN_READ_MS). */
  readMs: number;
  /** Bearing of the flick on the screen: degrees, 0 = up the screen, + = towards the right. */
  screenBearingDeg: number;
  /** Average speed over the read, in surface lengths (the shorter side) per second. */
  speed: number;
  /** Path length over the read, as a fraction of the shorter side. */
  length: number;
  /** Still travelling when the read window closed: a long flick. */
  travelling: boolean;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
/** Rounds to a step, and never returns −0 (records compare equal whatever the platform). */
const round = (v: number, step: number) => {
  const r = Math.round(v / step) * step;
  const fixed = Number(r.toFixed(6));
  return fixed === 0 ? 0 : fixed;
};
const wrap180 = (deg: number) => {
  let d = ((deg + 180) % 360 + 360) % 360 - 180;
  if (d === -180) d = 180;
  return d;
};

/** Movement (CSS px) beyond which a press is a flick, for a surface. */
export function moveThreshold(surface: { width: number; height: number }): number {
  return clamp(MOVE_THRESHOLD.frac * Math.min(surface.width, surface.height), MOVE_THRESHOLD.minPx, MOVE_THRESHOLD.maxPx);
}

function validSamples(s: readonly GestureSample[]): boolean {
  for (let i = 0; i < s.length; i++) {
    const p = s[i];
    if (!p || !Number.isFinite(p.t) || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return false;
    if (i > 0 && p.t < s[i - 1].t) return false;
  }
  return true;
}

/** First sample farther than `threshold` from sample `from`, or −1. */
export function crossingIndex(s: readonly GestureSample[], threshold: number, from = 0): number {
  const a = s[from];
  for (let i = from + 1; i < s.length; i++) if (Math.hypot(s[i].x - a.x, s[i].y - a.y) > threshold) return i;
  return -1;
}

/** Where the run of intentional movement that reached sample `c` began (walking back while it moves fast enough). */
export function onsetIndex(s: readonly GestureSample[], c: number, from = 0): number {
  let i = c;
  while (i > from) {
    const a = s[i - 1];
    const b = s[i];
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    const dt = b.t - a.t;
    // Coalesced samples can share a timestamp: any movement between them is part of the run.
    const moving = dt <= 0 ? d > 0 : d / dt >= ONSET_SPEED_PX_PER_MS;
    if (!moving) break;
    i--;
  }
  return i;
}

/** Position at time `t`, interpolated between samples (clamped to the first and last sample). */
function positionAt(s: readonly GestureSample[], t: number): { x: number; y: number } {
  if (t <= s[0].t) return { x: s[0].x, y: s[0].y };
  for (let i = 1; i < s.length; i++) {
    const b = s[i];
    if (t <= b.t) {
      const a = s[i - 1];
      const span = b.t - a.t;
      const u = span > 0 ? (t - a.t) / span : 1;
      return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
    }
  }
  const z = s[s.length - 1];
  return { x: z.x, y: z.y };
}

/** Path length between two times (CSS px). */
function pathLength(s: readonly GestureSample[], t0: number, t1: number): number {
  if (t1 <= t0) return 0;
  let len = 0;
  let prev = positionAt(s, t0);
  for (const p of s) {
    if (p.t <= t0) continue;
    if (p.t >= t1) break;
    len += Math.hypot(p.x - prev.x, p.y - prev.y);
    prev = p;
  }
  const end = positionAt(s, t1);
  return len + Math.hypot(end.x - prev.x, end.y - prev.y);
}

/** Reads a gesture (null when the samples are unusable: none, non-finite, time going backwards, no surface). */
export function readGesture(input: GestureInput): GestureRead | null {
  const s = input?.samples;
  if (!s || s.length === 0 || !validSamples(s)) return null;
  const w = input.surface?.width;
  const h = input.surface?.height;
  if (!(w > 0) || !(h > 0)) return null;
  const first = s[0].t;
  const tap: GestureRead = { kind: 'tap', startMs: first, onsetMs: null, readMs: 0, screenBearingDeg: 0, speed: 0, length: 0, travelling: false };
  if (input.pointer === 'keyboard') return tap;
  const side = Math.min(w, h);
  const c = crossingIndex(s, moveThreshold(input.surface));
  if (c < 0) return tap;
  const o = onsetIndex(s, c);
  const onsetMs = s[o].t;
  // A press is armed at once (start = pointer-down); a finger that rested longer than a tap takes to decide starts
  // its swing where it begins to move (the tracker only lets that happen for a finger already down when armed).
  const startMs = onsetMs - first > TAP_DECIDE_MS ? onsetMs : first;
  const last = s[s.length - 1].t;
  const windowEnd = onsetMs + READ_WINDOW_MS;
  const end = Math.min(windowEnd, last);
  const readMs = Math.max(MIN_READ_MS, end - onsetMs);
  const p0 = s[o];
  const p1 = positionAt(s, end);
  let dx = p1.x - p0.x;
  let dy = p1.y - p0.y;
  if (Math.hypot(dx, dy) < 1e-6) {
    dx = s[c].x - p0.x;
    dy = s[c].y - p0.y;
  }
  const speed = ((Math.hypot(dx, dy) / readMs) * 1000) / side;
  const length = pathLength(s, onsetMs, end) / side;
  let travelling = false;
  if (last >= windowEnd - 0.5) {
    const tail = ELEVATION.tailMs;
    const a = positionAt(s, windowEnd - tail);
    const b = positionAt(s, windowEnd);
    const tailSpeed = Math.hypot(b.x - a.x, b.y - a.y) / tail;
    const average = pathLength(s, onsetMs, windowEnd) / READ_WINDOW_MS;
    travelling = average > 0 && tailSpeed >= ELEVATION.stillRatio * average;
  }
  return { kind: 'flick', startMs, onsetMs, readMs, screenBearingDeg: (Math.atan2(dx, -dy) * 180) / Math.PI, speed, length, travelling };
}

/** Bat speed 0..1 from a flick's speed (surface lengths per second). */
export function powerOf(speed: number): number {
  return ATTACK_MIN_POWER + (1 - ATTACK_MIN_POWER) * clamp01((speed - POWER_SPEED.lo) / (POWER_SPEED.hi - POWER_SPEED.lo));
}

/** Elevation 0..1 from a flick's length (fraction of the shorter side) and whether it was still travelling. */
export function elevationOf(length: number, travelling: boolean): number {
  const u = clamp01((length - ELEVATION.lengthLo) / (ELEVATION.lengthHi - ELEVATION.lengthLo));
  return travelling ? ELEVATION.loftFrom + (1 - ELEVATION.loftFrom) * u : ELEVATION.groundMax * u;
}

/**
 * The one batting input the physics sees. Null when the gesture is unusable; a leave is no call at all (the caller
 * passes `null` as the swing).
 */
export function normalizeGesture(input: GestureInput, opts: NormalizeOptions): NormalizedSwing | null {
  const read = readGesture(input);
  if (!read) return null;
  if (!Number.isFinite(opts.releasePerfMs) || !Number.isFinite(opts.calibrationMs)) return null;
  const k = opts.timeScale !== undefined && opts.timeScale > 0 && Number.isFinite(opts.timeScale) ? opts.timeScale : 1;
  const startT = round(((read.startMs - opts.calibrationMs - opts.releasePerfMs) * k) / 1000, PRECISION.startT);
  const footwork = input.footwork ?? 'auto';
  if (read.kind === 'tap') return { kind: 'defend', startT, directionDeg: 0, power: DEFEND_POWER, elevation: 0, footwork };
  const mirror = opts.handedness === 'left' ? -1 : 1;
  return {
    kind: 'attack',
    startT,
    directionDeg: round(wrap180(read.screenBearingDeg * mirror), PRECISION.directionDeg),
    power: round(powerOf(read.speed), PRECISION.unit),
    elevation: round(elevationOf(read.length, read.travelling), PRECISION.unit),
    footwork,
  };
}
