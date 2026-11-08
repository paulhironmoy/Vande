/**
 * The one normalized input model: raw pointer or keyboard samples → one NormalizedSwing, whatever the device
 * (docs/PRACTICE_INPUT.md).
 *
 *   tap        no movement beyond the threshold → the defensive straight bat, timed from the press (the
 *              pointer-down's own timestamp)
 *   swipe      movement beyond it → an attack, timed from the swipe's own start: the moment its movement left the
 *              circle where the finger rested (swipeStart; after any rest, which never counts). It is read from that
 *              start to where the stroke ends (the finger lifts or stops) or READ_MAX_MS later, whichever is first:
 *                direction  the bearing of the stroke: screen-up = straight, towards the batter's off side = +,
 *                           mirrored for left-handers, any direction through 360°
 *                power      the stroke's own average speed (reach ÷ its own duration), log-linear (POWER_CURVE)
 *                elevation  the stroke's reach: along the ground up to LOFT_REACH.from, lofted beyond it
 *   keyboard   Space / Enter defend; an arrow (two for a diagonal, or keypad 1–9) attacks that way; Shift lofts; the
 *              key's own timestamp is the timing
 *   no input   a leave (the caller passes `null` to the physics; nothing here is called)
 * The timing has the calibration offset for its kind of input taken off, on the simulation clock (seconds after
 * release). It is always an event's own timestamp (interpolated between samples), so deciding later never moves it.
 *
 * Pure and deterministic: the same samples always give the same swing. Raw samples are read here and dropped; they
 * are never stored or sent anywhere.
 */
import type { GestureInput, GestureSample, Handedness, InputModality, NormalizedSwing, SwingKind } from '@/contracts/practice';
import {
  DEFEND_POWER,
  DEPARTURE,
  KEYBOARD,
  LOFT_REACH,
  MIN_READ_MS,
  MOVE_THRESHOLD,
  ONE_CONTACT,
  ONSET_GAP,
  ONSET_SPEED_PX_PER_MS,
  POWER_CURVE,
  PRECISION,
  READ_MAX_MS,
  REFERENCE_PX,
  STILL,
  TURN_BACK_RATIO,
} from './constants';

export type { InputModality };

/** A keyboard stroke (the shared contract's GestureInput.key). */
export type KeyStroke = NonNullable<GestureInput['key']>;

/** A GestureInput as src/input emits it (the keyboard's carries its stroke in `key`). */
export type TrackedInput = GestureInput;

export interface NormalizeOptions {
  /** performance.now() time at which the ball left the bowler's hand (PracticeStage.bowl resolves with it). */
  releasePerfMs: number;
  /** Device and input latency from the calibration (Calibration.offsetMs); + means taps register late. */
  calibrationMs: number;
  /**
   * Per-modality offsets (resolveCalibrations): when one is given for the gesture's own modality it is used instead
   * of `calibrationMs`, so a touch calibration never shifts a mouse or keyboard swing.
   */
  calibrations?: Partial<Record<InputModality, number>>;
  handedness: Handedness;
  /** Simulation seconds per real second (PracticeStage.setTimeScale, a test hook; 1 in play). */
  timeScale?: number;
}

/** How a swipe's read ended. */
export type ReadEnd = 'end' | 'stop' | 'cap' | 'turn' | 'stable';

/** What the samples say before any clock or handedness is applied (the tracker, the tests and the examiners use it). */
export interface GestureRead {
  kind: 'tap' | 'flick';
  /** A key press rather than a pointer. */
  source: 'pointer' | 'key';
  /** The swing start (performance.now() ms): the press for a tap or a key; a swipe's own start (swipeStart). */
  startMs: number;
  /** Swipes: the swing start too (kept for older readers); null for a tap. */
  onsetMs: number | null;
  /** Swipes: where the read ended (ms); null for a tap or a key. */
  endMs: number | null;
  /** Swipes: how it ended (the last sample: a lift; the finger stopped; READ_MAX_MS; it came back). */
  closedBy: ReadEnd | null;
  /** Swipes: the time the read covers, from the swipe's start (ms, at least MIN_READ_MS); 0 for a tap or a key. */
  readMs: number;
  /** Bearing of the swipe (or key) on the screen: degrees, 0 = up the screen, + = towards the right. */
  screenBearingDeg: number;
  /** Straight-line distance from where the finger rested to the end of the read, in reference lengths. */
  reach: number;
  /** The same as `reach` (older readers called it length). */
  length: number;
  /** Average speed over the read, in reference lengths per second. */
  speed: number;
  /** Still moving when the read closed at READ_MAX_MS. */
  travelling: boolean;
  /** Keys: Shift was held. */
  loft: boolean;
  /** Present only for the canonical pullback -> forward-stroke path. Legacy taps/flicks remain readable as before. */
  oneContact?: OneContactRead;
}

/** Live, non-terminal phases inferred from one pointer's samples. Terminal phases are owned by GestureTracker. */
export type OneContactMotionPhase = 'ready' | 'loading' | 'tracking' | 'committing';

/**
 * The canonical one-contact read. It is deliberately expressed as intent: it never chooses a shot result, corrects
 * for the ball, or changes the delivery. `commitMs` is the first intentional forward-motion onset, not pointer-up.
 */
export interface OneContactRead {
  phase: OneContactMotionPhase;
  pressMs: number;
  commitMs: number | null;
  /** Downward pullback in reference lengths, and its continuous 0..1 loading intent. */
  pullbackDepth: number;
  pullbackIntent: number;
  /** Signed stance adjustment while loaded, in reference lengths (+ is screen-right). */
  lateralAdjustment: number;
  /** Combined pullback/forward intent, before physics and before the power envelope. */
  aggression: number;
  elevationIntent: number;
  committed: boolean;
  /** True once at least the minimum stable forward interval has been observed. */
  stable: boolean;
  forwardBearingDeg: number | null;
  /** Forward path and reach in reference lengths; velocity is path / event-time seconds. */
  forwardPath: number;
  forwardReach: number;
  forwardVelocity: number;
  forwardReadMs: number;
  forwardEndMs: number | null;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
/** A finger whose speed held at least this share of the segment before was not slowing into its rest. */
const SLOWING_RATIO = 0.75;
/** Rounds to a step, and never returns −0 (records compare equal whatever the platform). */
const round = (v: number, step: number) => {
  const r = Math.round(v / step) * step;
  const fixed = Number(r.toFixed(6));
  return fixed === 0 ? 0 : fixed;
};
const wrap180 = (deg: number) => {
  let d = ((((deg + 180) % 360) + 360) % 360) - 180;
  if (d === -180) d = 180;
  return d;
};

/** The point at time `t` on the segment a → b (linear; clamped to the segment). */
function lerpSample(a: GestureSample, b: GestureSample, t: number): GestureSample {
  const span = b.t - a.t;
  const u = span > 0 ? clamp01((t - a.t) / span) : 1;
  return { t, x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
}

/** The reference length for a surface: its shorter side, clamped to REFERENCE_PX (CSS px). */
export function referenceLength(surface: { width: number; height: number }): number {
  return clamp(Math.min(surface.width, surface.height), REFERENCE_PX.min, REFERENCE_PX.max);
}

/** Movement (CSS px) beyond which a press is a swipe, for a surface. */
export function moveThreshold(surface: { width: number; height: number }): number {
  return clamp(MOVE_THRESHOLD.frac * referenceLength(surface), MOVE_THRESHOLD.minPx, MOVE_THRESHOLD.maxPx);
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
  for (let i = from + 1; i < s.length; i++) if (dist(s[i], a) > threshold) return i;
  return -1;
}

/** A swipe's start, found from its samples (swipeStart). */
export interface SwipeStart {
  /** Index of the sample where the finger rested before the swipe's movement began. */
  restIndex: number;
  /** Where it rested: the stroke's reach and direction are measured from here. */
  rest: GestureSample;
  /** When the movement left the DEPARTURE circle around the rest (ms): the swing's timing. */
  atMs: number;
  /** Index of the first sample beyond the movement threshold (from the first sample). */
  crossIndex: number;
}

/**
 * Where a swipe started, or null when the samples never move beyond `threshold` from the first one (a tap).
 *
 * The run of intentional movement that crossed the threshold is walked back (segments at least ONSET_SPEED_PX_PER_MS,
 * or any real displacement across a silence) to where the finger rested; slower drift only moves the rest point. The
 * start is when the movement left a DEPARTURE.radiusPx circle around that rest, interpolated between the samples
 * either side. When the finger sent no samples while still (a silence longer than ONSET_GAP.ms after a sample still at
 * rest), the first moving sample is carried back at the speed it was moving with (never below ONSET_GAP.minPxPerMs),
 * and never to before a straight interpolation. Every time is an event's own timestamp or interpolated between them,
 * so a later decision never moves it, and the same motion gives (nearly) the same start at any sampling rate.
 */
export function swipeStart(s: readonly GestureSample[], threshold: number): SwipeStart | null {
  const c = crossingIndex(s, threshold);
  if (c < 0) return null;
  let o = c;
  while (o > 0) {
    const p = s[o - 1];
    const q = s[o];
    const dt = q.t - p.t;
    const d = dist(p, q);
    const gap = dt > ONSET_GAP.ms;
    const moving = dt <= 0 ? d > 0 : gap ? d > DEPARTURE.restPx : d / dt >= ONSET_SPEED_PX_PER_MS;
    if (!moving) break;
    o--;
    // Movement across a silence began inside it: the sample before the silence is the rest.
    if (gap) break;
  }
  const rest = s[o];
  let k = o + 1;
  while (k < c && dist(s[k], rest) <= DEPARTURE.radiusPx) k++;
  const a = s[k - 1];
  const m1 = s[k];
  const da = dist(a, rest);
  const d1 = dist(m1, rest);
  let t = d1 > da ? a.t + clamp01((DEPARTURE.radiusPx - da) / (d1 - da)) * (m1.t - a.t) : m1.t;
  if (m1.t - a.t > ONSET_GAP.ms && da <= DEPARTURE.restPx) {
    const m2 = s[k + 1];
    const v12 = m2 && m2.t > m1.t ? (dist(m2, rest) - d1) / (m2.t - m1.t) : 0;
    const v = Math.max(v12, ONSET_GAP.minPxPerMs);
    t = Math.max(t, m1.t - Math.max(0, d1 - DEPARTURE.radiusPx) / v);
  }
  return { restIndex: o, rest, atMs: clamp(t, a.t, m1.t), crossIndex: c };
}

/** The samples up to `capMs`, with the position at `capMs` interpolated when a later sample exists. */
function clipAt(s: readonly GestureSample[], capMs: number): { path: GestureSample[]; capped: boolean } {
  const path: GestureSample[] = [];
  for (let i = 0; i < s.length; i++) {
    const p = s[i];
    if (p.t <= capMs) {
      path.push(p);
      continue;
    }
    if (path[path.length - 1].t < capMs) path.push(lerpSample(s[i - 1], p, capMs));
    return { path, capped: true };
  }
  return { path, capped: false };
}

/** Screen bearing (deg, 0 = up, + = right) of a displacement. */
export function screenBearing(dx: number, dy: number): number {
  return (Math.atan2(dx, -dy) * 180) / Math.PI;
}

/** Path distance through samples `from..to`, including the supplied interpolated endpoints. */
function pathDistance(path: readonly GestureSample[]): number {
  let d = 0;
  for (let i = 1; i < path.length; i++) d += dist(path[i - 1], path[i]);
  return d;
}

/**
 * Reads the pullback -> optional hold/lateral adjustment -> forward stroke from one continuous pointer contact.
 * Returns null for a legacy one-way flick, so the caller falls through to the established swipe reader. This is a
 * compatibility discriminator inside the one canonical normalizer, not a second input authority.
 */
export function readOneContact(input: GestureInput): OneContactRead | null {
  const s = input?.samples;
  const w = input.surface?.width;
  const h = input.surface?.height;
  if (input.pointer === 'keyboard' || !s || !s.length || !validSamples(s) || !(w > 0) || !(h > 0)) return null;

  const press = s[0];
  const ref = referenceLength(input.surface);
  const threshold = moveThreshold(input.surface);
  const first = crossingIndex(s, threshold);
  if (first < 0) {
    return {
      phase: 'ready',
      pressMs: press.t,
      commitMs: null,
      pullbackDepth: 0,
      pullbackIntent: 0,
      lateralAdjustment: 0,
      aggression: 0,
      elevationIntent: 0,
      committed: false,
      stable: false,
      forwardBearingDeg: null,
      forwardPath: 0,
      forwardReach: 0,
      forwardVelocity: 0,
      forwardReadMs: 0,
      forwardEndMs: null,
    };
  }

  // A pullback is deliberately down/back, not merely any old flick that happens to contain a noisy y component.
  const firstDx = s[first].x - press.x;
  const firstDy = s[first].y - press.y;
  const firstDistance = Math.hypot(firstDx, firstDy);
  if (!(firstDy > 0) || firstDy / Math.max(1e-9, firstDistance) < ONE_CONTACT.backwardDominance) return null;

  let peakIndex = first;
  let commitCross = -1;
  for (let i = first + 1; i < s.length; i++) {
    if (s[i].y > s[peakIndex].y) {
      peakIndex = i;
      continue;
    }
    if (s[peakIndex].y - s[i].y > threshold * ONE_CONTACT.forwardThresholdScale) {
      commitCross = i;
      break;
    }
  }

  const peak = s[peakIndex];
  const pullbackDepth = Math.max(0, peak.y - press.y) / ref;
  const pullbackIntent = clamp01(pullbackDepth / ONE_CONTACT.fullPullback);
  if (commitCross < 0) {
    const last = s[s.length - 1];
    const lateralAdjustment = clamp((last.x - press.x) / ref, -1, 1);
    // A one-way behind-square compatibility flick and an un-reversed pullback are geometrically identical. Make the
    // new intentional-load interpretation unambiguous: tracking needs a held lateral refinement, or a very long
    // stationary read. Ordinary released full-circle swipes therefore keep their historical meaning.
    const heldMs = last.t - peak.t;
    const heldLateral = heldMs >= STILL.ms && Math.abs(last.y - peak.y) <= STILL.epsPx && Math.abs(last.x - peak.x) >= threshold * 0.5;
    let stationarySegments = 0;
    for (let i = peakIndex + 1; i < s.length; i++) {
      if (Math.abs(s[i].y - s[i - 1].y) <= 0.1) stationarySegments++;
      else stationarySegments = 0;
    }
    const explicitStationaryHold = stationarySegments >= 2 && heldMs >= STILL.ms;
    const deliberateLongHold = heldMs >= ONE_CONTACT.intentionalLeaveHoldMs && Math.abs(last.y - peak.y) <= STILL.epsPx;
    const tracking = heldLateral || explicitStationaryHold || deliberateLongHold;
    const aggression = 0.65 * pullbackIntent;
    return {
      phase: tracking ? 'tracking' : 'loading',
      pressMs: press.t,
      commitMs: null,
      pullbackDepth,
      pullbackIntent,
      lateralAdjustment,
      aggression,
      elevationIntent: clamp01((aggression - ONE_CONTACT.loftIntentFrom) / (1 - ONE_CONTACT.loftIntentFrom)),
      committed: false,
      stable: false,
      forwardBearingDeg: null,
      forwardPath: 0,
      forwardReach: 0,
      forwardVelocity: 0,
      forwardReadMs: 0,
      forwardEndMs: null,
    };
  }

  // Walk back only through the intentional upward run. A hold or a lateral stance adjustment therefore never enters
  // the timing or velocity denominator.
  let forwardAnchorIndex = commitCross - 1;
  while (forwardAnchorIndex > peakIndex) {
    const a = s[forwardAnchorIndex - 1];
    const b = s[forwardAnchorIndex];
    const dt = b.t - a.t;
    const d = dist(a, b);
    const upward = b.y < a.y && (dt <= 0 ? d > 0 : d / dt >= ONSET_SPEED_PX_PER_MS);
    if (!upward) break;
    forwardAnchorIndex--;
  }
  const anchor = s[forwardAnchorIndex];
  let departIndex = forwardAnchorIndex + 1;
  while (departIndex < s.length && dist(s[departIndex], anchor) <= DEPARTURE.radiusPx) departIndex++;
  if (departIndex >= s.length) return null;
  const before = s[departIndex - 1];
  const after = s[departIndex];
  const d0 = dist(before, anchor);
  const d1 = dist(after, anchor);
  let commitMs = d1 > d0 ? before.t + clamp01((DEPARTURE.radiusPx - d0) / (d1 - d0)) * (after.t - before.t) : after.t;
  if (after.t - before.t > ONSET_GAP.ms && d0 <= DEPARTURE.restPx) {
    const next = s[departIndex + 1];
    const v = Math.max(next && next.t > after.t ? (dist(next, anchor) - d1) / (next.t - after.t) : 0, ONSET_GAP.minPxPerMs);
    commitMs = Math.max(commitMs, after.t - Math.max(0, d1 - DEPARTURE.radiusPx) / v);
  }
  commitMs = clamp(commitMs, before.t, after.t);

  // Forty milliseconds is the target read. Interpolation prevents a 30/60/120 Hz dispatch cadence from moving the
  // endpoint; a shorter released/cancelled contact retains the evidence it actually supplied.
  const stroke: GestureSample[] = [{ t: commitMs, x: anchor.x, y: anchor.y }];
  for (let i = forwardAnchorIndex + 1; i < s.length; i++) if (s[i].t > commitMs) stroke.push(s[i]);
  const clipped = clipAt(stroke, commitMs + ONE_CONTACT.forwardReadMs).path;
  const end = clipped[clipped.length - 1];
  const forwardReadMs = Math.max(0, end.t - commitMs);
  const dx = end.x - anchor.x;
  const dy = end.y - anchor.y;
  const forwardReach = Math.hypot(dx, dy) / ref;
  // Bound tiny digitizer zig-zags while keeping curved, deliberate travel in the power signal.
  const rawPath = pathDistance(clipped) / ref;
  const forwardPath = Math.min(rawPath, Math.max(forwardReach, forwardReach * 1.35));
  const forwardVelocity = forwardReadMs > 0 ? (forwardPath / Math.max(MIN_READ_MS, forwardReadMs)) * 1000 : 0;
  const forwardIntent = clamp01(forwardPath / ONE_CONTACT.fullForwardPath);
  const aggression = clamp01(0.65 * pullbackIntent + 0.35 * forwardIntent);
  const lateralAdjustment = clamp((anchor.x - press.x) / ref, -1, 1);
  return {
    phase: 'committing',
    pressMs: press.t,
    commitMs,
    pullbackDepth,
    pullbackIntent,
    lateralAdjustment,
    aggression,
    elevationIntent: clamp01((aggression - ONE_CONTACT.loftIntentFrom) / (1 - ONE_CONTACT.loftIntentFrom)),
    committed: true,
    stable: forwardReadMs >= ONE_CONTACT.forwardReadMinMs && forwardReach * ref > threshold,
    forwardBearingDeg: forwardReach > 0 ? screenBearing(dx, dy) : null,
    forwardPath,
    forwardReach,
    forwardVelocity,
    forwardReadMs,
    forwardEndMs: end.t,
  };
}

function tapRead(startMs: number, source: 'pointer' | 'key'): GestureRead {
  return { kind: 'tap', source, startMs, onsetMs: null, endMs: null, closedBy: null, readMs: 0, screenBearingDeg: 0, reach: 0, length: 0, speed: 0, travelling: false, loft: false };
}

/**
 * Reads a gesture (null when the samples are unusable: none, non-finite, time going backwards, no surface). The first
 * sample is the press (or where a resting finger rested); pass every sample the tracker saw, through the lift: the read
 * finds the swipe's start and applies READ_MAX_MS itself.
 */
export function readGesture(input: GestureInput): GestureRead | null {
  const s = input?.samples;
  if (!s || s.length === 0 || !validSamples(s)) return null;
  const w = input.surface?.width;
  const h = input.surface?.height;
  if (!(w > 0) || !(h > 0)) return null;
  const t0 = s[0].t;
  if (input.pointer === 'keyboard') {
    const key = (input as TrackedInput).key;
    if (!key || key.kind !== 'attack' || !Number.isFinite(key.screenBearingDeg)) return tapRead(t0, 'key');
    return { ...tapRead(t0, 'key'), kind: 'flick', onsetMs: t0, screenBearingDeg: wrap180(key.screenBearingDeg), loft: key.loft === true };
  }
  const oneContact = readOneContact(input);
  if (oneContact?.committed && oneContact.commitMs !== null && oneContact.forwardBearingDeg !== null && oneContact.forwardEndMs !== null) {
    return {
      kind: 'flick',
      source: 'pointer',
      startMs: oneContact.commitMs,
      onsetMs: oneContact.commitMs,
      endMs: oneContact.forwardEndMs,
      closedBy: oneContact.forwardReadMs >= ONE_CONTACT.forwardReadMs ? 'stable' : 'end',
      readMs: Math.max(MIN_READ_MS, oneContact.forwardReadMs),
      screenBearingDeg: oneContact.forwardBearingDeg,
      reach: oneContact.forwardReach,
      length: oneContact.forwardReach,
      speed: oneContact.forwardVelocity,
      travelling: false,
      loft: false,
      oneContact,
    };
  }
  const start = swipeStart(s, moveThreshold(input.surface));
  if (!start) return tapRead(t0, 'pointer');

  // A swipe: the stroke from its own start (the rest point at that moment) to where it ends, at most READ_MAX_MS later.
  const tau = start.atMs;
  const stroke: GestureSample[] = [{ t: tau, x: start.rest.x, y: start.rest.y }];
  for (let i = start.restIndex + 1; i < s.length; i++) if (s[i].t > tau) stroke.push(s[i]);
  const { path, capped } = clipAt(stroke, tau + READ_MAX_MS);
  const p0 = path[0];
  const lastIdx = path.length - 1;
  const last = path[lastIdx];
  let end = lastIdx;
  let e: GestureSample = last;
  let closedBy: ReadEnd = capped ? 'cap' : 'end';
  // The finger came to rest and stayed: the stroke ended when it reached its resting point. That moment is
  // interpolated on the segment that entered the resting circle, so it does not depend on which samples happen to
  // fall inside the stillness.
  let k = lastIdx;
  while (k > 0 && dist(path[k - 1], last) <= STILL.epsPx) k--;
  if (k < lastIdx && last.t - path[k].t >= STILL.ms) {
    end = k;
    closedBy = 'stop';
    let t = path[k].t;
    if (k > 0) {
      const before = path[k - 1];
      const d1 = dist(before, last);
      const d2 = dist(path[k], last);
      const u = d1 > d2 ? clamp01((d1 - STILL.epsPx) / (d1 - d2)) : 1;
      t = before.t + u * (path[k].t - before.t);
      // The finger may have stopped anywhere inside a long interval. Interpolating assumes it slowed into its rest;
      // carrying on at its approach speed assumes it stopped abruptly. The two segments before say which: slowing
      // down → interpolate; steady → its approach speed; only one segment of evidence → halfway between.
      if (k > 1) {
        const speed = (a: GestureSample, b: GestureSample) => (b.t > a.t ? dist(a, b) / (b.t - a.t) : 0);
        const v = speed(path[k - 2], before);
        if (v > 0) {
          const steady = before.t + Math.max(0, d1 - STILL.epsPx) / v;
          if (steady < t) {
            const v0 = k > 2 ? speed(path[k - 3], path[k - 2]) : 0;
            if (k <= 2 || v0 <= 0) t = (t + steady) / 2;
            else if (v >= SLOWING_RATIO * v0) t = steady;
          }
        }
      }
    }
    e = { t, x: last.x, y: last.y };
  }
  // It came back: read the stroke at its farthest point.
  let far = 0;
  let farIdx = 0;
  for (let i = 1; i <= end; i++) {
    const d = dist(path[i], p0);
    if (d > far) {
      far = d;
      farIdx = i;
    }
  }
  if (dist(e, p0) < TURN_BACK_RATIO * far) {
    e = path[farIdx];
    closedBy = 'turn';
  }
  const dx = e.x - p0.x;
  const dy = e.y - p0.y;
  const reach = Math.hypot(dx, dy) / referenceLength(input.surface);
  const readMs = Math.max(MIN_READ_MS, e.t - tau);
  return {
    kind: 'flick',
    source: 'pointer',
    startMs: tau,
    onsetMs: tau,
    endMs: e.t,
    closedBy,
    readMs,
    screenBearingDeg: screenBearing(dx, dy),
    reach,
    length: reach,
    speed: (reach / readMs) * 1000,
    travelling: closedBy === 'cap',
    loft: false,
  };
}

/** Bat speed 0..1 from a swipe's average speed (reference lengths per second): log-linear, floored. */
export function powerOf(speed: number): number {
  if (!(speed > 0)) return POWER_CURVE.min;
  const u = Math.log(speed / POWER_CURVE.lowSpeed) / Math.log(POWER_CURVE.fullSpeed / POWER_CURVE.lowSpeed);
  return clamp(POWER_CURVE.lowPower + (1 - POWER_CURVE.lowPower) * u, POWER_CURVE.min, 1);
}

/** The swipe speed (reference lengths per second) that gives a power: the inverse of powerOf above its floor. */
export function speedForPower(power: number): number {
  const u = (clamp(power, POWER_CURVE.min, 1) - POWER_CURVE.lowPower) / (1 - POWER_CURVE.lowPower);
  return POWER_CURVE.lowSpeed * Math.pow(POWER_CURVE.fullSpeed / POWER_CURVE.lowSpeed, u);
}

/** Elevation 0..1 from a swipe's reach (reference lengths): along the ground up to LOFT_REACH.from, then lofted. */
export function elevationOf(reach: number): number {
  return clamp01((reach - LOFT_REACH.from) / (LOFT_REACH.full - LOFT_REACH.from));
}

/**
 * Elevation for the canonical one-contact stroke. Pullback plus forward travel expresses the intent; execution power
 * bounds how much of that envelope reaches the normalized swing. This keeps depth meaningful without turning a slow
 * drag into a guaranteed loft or selecting an outcome for the player.
 */
export function oneContactElevationOf(read: Pick<OneContactRead, 'elevationIntent'>, power: number): number {
  const executionEnvelope = clamp01((power - 0.35) / 0.65);
  return Math.min(clamp01(read.elevationIntent), executionEnvelope);
}

/**
 * The least power a swipe can have at an elevation: lofting needs reach, and the read lasts at most READ_MAX_MS, so a
 * lofted swipe is always a quick one (along the ground, any power from the floor up can be played).
 */
export function minPowerForElevation(elevation: number): number {
  const e = clamp01(elevation);
  if (e <= 0) return POWER_CURVE.min;
  const reach = LOFT_REACH.from + e * (LOFT_REACH.full - LOFT_REACH.from);
  return powerOf((reach / READ_MAX_MS) * 1000);
}

/**
 * Whether a player can produce this attacking swing's power and elevation: by a swipe (any direction), or by a key
 * (its fixed values). The coach uses it to demonstrate only swings a player can play.
 */
export function canPlay(swing: { kind: SwingKind; power: number; elevation: number }, modality: InputModality = 'touch'): boolean {
  if (swing.kind === 'defend') return true;
  if (modality === 'keyboard') {
    const near = (a: number, b: number) => Math.abs(a - b) <= PRECISION.unit;
    return (near(swing.power, KEYBOARD.power) && near(swing.elevation, 0)) || (near(swing.power, KEYBOARD.loftPower) && near(swing.elevation, KEYBOARD.loftElevation));
  }
  return swing.power >= POWER_CURVE.min - 1e-9 && swing.power <= 1 + 1e-9 && swing.power + 1e-9 >= minPowerForElevation(swing.elevation);
}

/** The calibration offset normalizeGesture applies to a gesture of this modality. */
export function calibrationOffset(modality: InputModality, opts: Pick<NormalizeOptions, 'calibrationMs' | 'calibrations'>): number {
  const own = opts.calibrations?.[modality];
  return typeof own === 'number' && Number.isFinite(own) ? own : opts.calibrationMs;
}

/**
 * The one batting input the physics sees. Null when the gesture is unusable; a leave is no call at all (the caller
 * passes `null` as the swing).
 */
export function normalizeGesture(input: GestureInput, opts: NormalizeOptions): NormalizedSwing | null {
  const read = readGesture(input);
  if (!read) return null;
  const calibrationMs = calibrationOffset(input.pointer, opts);
  if (!Number.isFinite(opts.releasePerfMs) || !Number.isFinite(calibrationMs)) return null;
  const k = opts.timeScale !== undefined && opts.timeScale > 0 && Number.isFinite(opts.timeScale) ? opts.timeScale : 1;
  const startT = round(((read.startMs - calibrationMs - opts.releasePerfMs) * k) / 1000, PRECISION.startT);
  const footwork = input.footwork ?? 'auto';
  if (read.kind === 'tap') return { kind: 'defend', startT, directionDeg: 0, power: DEFEND_POWER, elevation: 0, footwork };
  const mirror = opts.handedness === 'left' ? -1 : 1;
  const key = read.source === 'key';
  const power = key ? (read.loft ? KEYBOARD.loftPower : KEYBOARD.power) : powerOf(read.speed);
  const elevation = key ? (read.loft ? KEYBOARD.loftElevation : 0) : read.oneContact ? oneContactElevationOf(read.oneContact, power) : elevationOf(read.reach);
  return {
    kind: 'attack',
    startT,
    directionDeg: round(wrap180(read.screenBearingDeg * mirror), PRECISION.directionDeg),
    power: round(power, PRECISION.unit),
    elevation: round(elevation, PRECISION.unit),
    footwork,
  };
}
