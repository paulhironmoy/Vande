/**
 * PoseMapper: turns camera pose frames into the commands of ONE virtual contact for the existing GestureTracker
 * (docs/PRACTICE_CAMERA_INPUT.md §4). It decides only WHEN a contact opens, WHAT samples it carries and WHEN it closes; the
 * tracker and normalizeGesture still decide the swing: its start, direction, power and elevation. The mapper never sees the
 * ball, the delivery, the score or the result, and the same frames always give the same commands (pure, no clock, no random).
 *
 *   hands rise                  the contact opens at the last still frame (the press) and the hands' rise becomes the
 *                               pullback: the virtual point moves DOWN the surface (the tracker's "load")
 *   hands held at the top       the output is held at the peak (stationary samples), so the tracker reads "tracking"
 *   hands come down fast        the stroke: the frames from the top are replayed with their own times and a gain, so the
 *                               tracker commits at the true onset and reads the first 40 ms (direction, power, loft)
 *   hands come down gently      after a small backlift: a defence, sent as a tap at the onset; after a big backlift, or
 *                               slower still: just lowering the hands, which is a leave (deliberate) or a fidget (nothing)
 *   tracking lost               the contact is cancelled (an uncommitted one leaves the delivery armed)
 *
 * Plain TypeScript (no enums, no parameter properties) so Node's type stripping can load it.
 */
import type { GestureSample, Handedness } from '@/contracts/practice';
import {
  DEFENCE,
  GAIN,
  ONSET,
  POSE,
  READY,
  RELAX,
  REST,
  SETTLE,
  STRIKE,
  STROKE_SAMPLE_MS,
  VIRTUAL_ORIGIN,
} from './constants';
import { observe } from './landmarks';
import { EMPTY_READINESS, type MapperOutput, type PoseFrame, type PoseReadiness, type TrackerCommand } from './types';

/** One valid frame in body units: height above the shoulder line, sideways (player's right is +), rise above the rest anchor. */
interface Pt {
  t: number;
  h: number;
  x: number;
  rise: number;
}

type Phase = 'idle' | 'loaded' | 'struck' | 'done';

export interface MapperOptions {
  /** The frame the model saw was already mirrored (false for the worker's raw frames). */
  sourceMirrored?: boolean;
  handedness?: Handedness;
}

const K = GAIN.backliftPxPerU;
const ALPHA = GAIN.lateralLoad;
const G = GAIN.strike;
const STEADY_MIN_FRAMES = 3;
const ANCHOR_SETTLE_MS = 300;
/** No valid frame for this long forgets the rest anchor and the scale. */
const FORGET_MS = 2000;
/** A hard cap on frames held back while the hands are below the top. */
const PENDING_MAX = 90;
/** Time and a little lateral wobble tolerated while "still descending". */
const DESCENT_WOBBLE_U = 0.02;

export class PoseMapper {
  private sourceMirrored: boolean;
  private handedness: Handedness;

  private scalePx = 0;
  private lastFrameT = Number.NaN;
  private lastValidT = Number.NaN;
  private anchorH: number | null = null;
  private anchorSettled = false;
  private steadySince: number | null = null;
  private hist: Pt[] = [];

  private armed = false;
  private armedAt = 0;
  private needPreload = false;
  private riseRun = 0;

  private phase: Phase = 'idle';
  private press: { t: number; h: number; x: number } | null = null;
  private peakRaw = 0;
  private peakDB = 0;
  private lastTop: Pt | null = null;
  private pending: Pt[] = [];
  private belowSince: number | null = null;
  private strikeAt = 0;
  private settleSince: number | null = null;
  private strikeBase: { y: number; x: number; top: Pt; rho: number } | null = null;
  private lastStrokeSample: GestureSample | null = null;

  /** The hands have rested steadily since the last contact: a new contact needs this (so waving cannot repeat strokes). */
  private restedSinceContact = true;
  private lastShoulder: { t: number; x: number; y: number } | null = null;
  /** Frame-to-frame landmark noise (variance of the hand height, u squared), learned while the hands are steady. */
  private noiseVar = 0;
  private noiseN = 0;
  private readyStableSince: number | null = null;
  private readiness: PoseReadiness = EMPTY_READINESS;
  private poorLight = false;

  constructor(o: MapperOptions = {}) {
    this.sourceMirrored = o.sourceMirrored === true;
    this.handedness = o.handedness ?? 'right';
  }

  setHandedness(h: Handedness) {
    this.handedness = h;
  }

  setSourceMirrored(m: boolean) {
    this.sourceMirrored = m;
  }

  /** The capture side's light check; the mapper only reports it. */
  setPoorLight(on: boolean) {
    this.poorLight = on;
  }

  isContactOpen(): boolean {
    return this.phase === 'loaded' || this.phase === 'struck';
  }

  getReadiness(): PoseReadiness {
    return this.readiness;
  }

  /** The delivery went live at `atMs` (the performance clock): from now a rise of the hands can open the contact. */
  arm(atMs: number): TrackerCommand[] {
    const cmds = this.closeContact();
    this.armed = true;
    this.armedAt = atMs;
    this.needPreload = true;
    this.phase = 'idle';
    return cmds;
  }

  /** The delivery is over (or the screen left): close any open contact; nothing opens until the next arm. */
  disarm(): TrackerCommand[] {
    const cmds = this.closeContact();
    this.armed = false;
    this.needPreload = false;
    this.phase = 'idle';
    this.riseRun = 0;
    return cmds;
  }

  /** Forget everything about the person (a new session). */
  reset() {
    this.scalePx = 0;
    this.lastFrameT = Number.NaN;
    this.lastValidT = Number.NaN;
    this.anchorH = null;
    this.anchorSettled = false;
    this.steadySince = null;
    this.hist = [];
    this.armed = false;
    this.needPreload = false;
    this.riseRun = 0;
    this.clearContact();
    this.phase = 'idle';
    this.readyStableSince = null;
    this.readiness = EMPTY_READINESS;
  }

  /** Called without a frame (a watchdog): tracking is lost when no valid pose has been seen for POSE.lostMs. */
  tick(nowMs: number): MapperOutput {
    const cmds: TrackerCommand[] = [];
    const lost = Number.isFinite(this.lastValidT) && nowMs - this.lastValidT >= POSE.lostMs;
    if (lost) this.onLost(nowMs, cmds);
    return this.out(cmds, lost, null);
  }

  push(frame: PoseFrame): MapperOutput {
    const cmds: TrackerCommand[] = [];
    if (!Number.isFinite(this.lastValidT)) this.lastValidT = frame.t;
    const obs = observe(frame, { sourceMirrored: this.sourceMirrored, handedness: this.handedness });
    if (!obs.valid || !(obs.shoulderPx > 0)) {
      const lost = frame.t - this.lastValidT >= POSE.lostMs;
      if (lost) this.onLost(frame.t, cmds);
      this.readiness = this.makeReadiness(frame.t, obs, null, false);
      this.lastFrameT = frame.t;
      return this.out(cmds, lost, null);
    }
    this.lastValidT = frame.t;

    // A jump no person makes (another person stepping in, the model re-finding someone): start again, cancelling any contact.
    const last = this.lastShoulder;
    if (last && this.scalePx > 0 && frame.t - last.t < 200) {
      const scaleJump = Math.abs(obs.shoulderPx / this.scalePx - 1) > POSE.jumpScale;
      const moveJump = Math.hypot(obs.shoulderMidX - last.x, obs.shoulderMidY - last.y) > POSE.jumpU * this.scalePx;
      if (scaleJump || moveJump) this.resetPerson(cmds);
    }
    this.lastShoulder = { t: frame.t, x: obs.shoulderMidX, y: obs.shoulderMidY };

    // The scale: a slow average of the shoulder width, frozen while a contact is open so a stroke's scale cannot change.
    if (this.scalePx === 0) this.scalePx = obs.shoulderPx;
    else if (!this.isContactOpen() && Number.isFinite(this.lastFrameT)) {
      const dt = Math.min(200, Math.max(0, frame.t - this.lastFrameT));
      this.scalePx += (obs.shoulderPx - this.scalePx) * (1 - Math.exp(-dt / POSE.scaleTauMs));
    }
    const u = this.scalePx;
    const sign = this.sourceMirrored ? 1 : -1;
    const pt: Pt = {
      t: frame.t,
      h: (obs.shoulderMidY - obs.handY) / u,
      x: (sign * (obs.handX - obs.shoulderMidX)) / u,
      rise: 0,
    };
    const prevPt = this.hist.length ? this.hist[this.hist.length - 1] : null;
    this.hist.push(pt);
    if (this.hist.length > ONSET.historyFrames + 8) this.hist.shift();

    const steady = this.isSteady(frame.t);
    if (steady) this.steadySince ??= frame.t;
    else this.steadySince = null;
    if (steady && prevPt && pt.t - prevPt.t < 100) {
      const d = pt.h - prevPt.h;
      this.noiseN++;
      this.noiseVar += ((d * d) / 2 - this.noiseVar) * Math.max(0.05, 1 / this.noiseN);
    }

    // The rest anchor: where the hands wait. It follows a steady hand that is not above it by a backlift, never moves
    // during a contact, and is "settled" once the hands have been steady for a moment.
    if (this.anchorH === null) this.anchorH = pt.h;
    else if (!this.isContactOpen() && steady && pt.h - this.anchorH < REST.followRiseU) {
      const dt = Number.isFinite(this.lastFrameT) ? Math.min(200, Math.max(0, frame.t - this.lastFrameT)) : 0;
      this.anchorH += (pt.h - this.anchorH) * (1 - Math.exp(-dt / REST.anchorTauMs));
    }
    if (!this.anchorSettled && this.steadySince !== null && frame.t - this.steadySince >= ANCHOR_SETTLE_MS) {
      this.anchorSettled = true;
    }
    pt.rise = pt.h - this.anchorH;
    this.lastFrameT = frame.t;

    this.readiness = this.makeReadiness(frame.t, obs, pt, steady);

    let decided: 'attack' | 'defence' | null = null;
    if (this.phase === 'idle') decided = this.stepIdle(pt, steady, cmds);
    else if (this.phase === 'loaded') decided = this.stepLoaded(pt, cmds);
    else if (this.phase === 'struck') this.stepStruck(pt, cmds);
    return this.out(cmds, false, decided);
  }

  // ---- internals --------------------------------------------------------------------------------------------------

  private out(commands: TrackerCommand[], lost: boolean, decided: 'attack' | 'defence' | null): MapperOutput {
    return { commands, readiness: this.readiness, lost, contactOpen: this.isContactOpen(), decided };
  }

  /** The hands moved less than REST.steadyExtentU over the last REST.steadyWindowMs (and enough frames say so). */
  private isSteady(now: number): boolean {
    let n = 0;
    let minH = Infinity;
    let maxH = -Infinity;
    let minX = Infinity;
    let maxX = -Infinity;
    for (let i = this.hist.length - 1; i >= 0; i--) {
      const p = this.hist[i];
      if (now - p.t > REST.steadyWindowMs) break;
      n++;
      if (p.h < minH) minH = p.h;
      if (p.h > maxH) maxH = p.h;
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
    }
    return n >= STEADY_MIN_FRAMES && maxH - minH <= REST.steadyExtentU && maxX - minX <= REST.steadyExtentU;
  }

  private makeReadiness(t: number, obs: ReturnType<typeof observe>, pt: Pt | null, steady: boolean): PoseReadiness {
    const inFrame = obs.valid && obs.shoulders && obs.battingHand;
    const u = this.scalePx > 0 ? this.scalePx : obs.shoulderPx;
    const headroom = obs.head && u > 0 && obs.noseY / u >= READY.headroomU;
    let distance = obs.distance;
    if (distance === 'ok') {
      if (obs.shoulderFrac < READY.tooFarFrac) distance = 'too_far';
      else if (obs.shoulderFrac > READY.tooCloseFrac) distance = 'too_close';
    }
    const below = pt ? -pt.h : -Infinity;
    const handsReadyZone =
      pt !== null && below >= READY.handsBelowShoulderU.min && below <= READY.handsBelowShoulderU.max;
    const all = inFrame && obs.head && distance === 'ok' && headroom && handsReadyZone && steady && !this.poorLight;
    if (all) this.readyStableSince ??= t;
    else this.readyStableSince = null;
    const stableMs = this.readyStableSince === null ? 0 : t - this.readyStableSince;
    return {
      inFrame,
      shoulders: obs.shoulders,
      battingHand: obs.battingHand,
      otherHand: obs.otherHand,
      head: obs.head,
      distance,
      headroom,
      handsReadyZone,
      still: steady,
      stableMs,
      ready: stableMs >= READY.stableMs,
      poorLight: this.poorLight,
    };
  }

  private clearContact() {
    this.press = null;
    this.peakRaw = 0;
    this.peakDB = 0;
    this.lastTop = null;
    this.pending = [];
    this.belowSince = null;
    this.strikeBase = null;
    this.lastStrokeSample = null;
    this.settleSince = null;
  }

  /** Closes whatever is open: an uncommitted contact is cancelled (the delivery stays armed), a struck one too (its swing is kept). */
  private closeContact(): TrackerCommand[] {
    const cmds: TrackerCommand[] = [];
    if (this.isContactOpen()) cmds.push({ type: 'cancel' });
    this.clearContact();
    this.riseRun = 0;
    return cmds;
  }

  /** How close to the highest rise still counts as the top: 1.5 noise deviations (never under 0.003 u or over 0.08 u). */
  private nearTopEps(): number {
    return Math.min(0.08, Math.max(STRIKE.onsetEpsU, 1.5 * Math.sqrt(this.noiseVar)));
  }

  /** Forgets the person (a jump, a long loss): any contact is cancelled and the rest position must be found again. */
  private resetPerson(cmds: TrackerCommand[]) {
    if (this.isContactOpen()) {
      cmds.push({ type: 'cancel' });
      this.clearContact();
      this.phase = this.phase === 'struck' ? 'done' : 'idle';
    }
    this.riseRun = 0;
    this.readyStableSince = null;
    this.anchorH = null;
    this.anchorSettled = false;
    this.steadySince = null;
    this.scalePx = 0;
    this.hist = [];
    this.lastShoulder = null;
    this.noiseVar = 0;
    this.noiseN = 0;
  }

  private onLost(nowMs: number, cmds: TrackerCommand[]) {
    if (this.isContactOpen()) {
      cmds.push({ type: 'cancel' });
      this.clearContact();
      this.phase = this.phase === 'struck' ? 'done' : 'idle';
    }
    this.riseRun = 0;
    this.readyStableSince = null;
    if (nowMs - this.lastValidT >= FORGET_MS) this.resetPerson(cmds);
  }

  /** The virtual sample for a point while loaded: the output y is the dead-banded running maximum of the rise (a latch). */
  private latch(p: Pt): GestureSample {
    const press = this.press!;
    if (p.rise > this.peakRaw) this.peakRaw = p.rise;
    const banded = p.rise - REST.deadBandU;
    if (banded > this.peakDB) this.peakDB = banded;
    return {
      t: p.t,
      x: VIRTUAL_ORIGIN.x + ALPHA * K * (p.x - press.x),
      y: VIRTUAL_ORIGIN.y + K * Math.max(0, this.peakDB),
    };
  }

  private open(press: Pt, replay: Pt[], cmds: TrackerCommand[]) {
    this.restedSinceContact = false;
    this.press = { t: press.t, h: press.h, x: press.x };
    this.peakRaw = 0;
    this.peakDB = 0;
    this.pending = [];
    this.belowSince = null;
    this.lastTop = press;
    cmds.push({ type: 'down', sample: { t: press.t, x: VIRTUAL_ORIGIN.x, y: VIRTUAL_ORIGIN.y } });
    const samples: GestureSample[] = [];
    for (const p of replay) {
      if (!(p.t > press.t)) continue;
      samples.push(this.latch(p));
      if (p.rise >= this.peakRaw - this.nearTopEps()) this.lastTop = p;
    }
    if (samples.length) cmds.push({ type: 'move', samples });
    this.phase = 'loaded';
  }

  private stepIdle(pt: Pt, steady: boolean, cmds: TrackerCommand[]): 'attack' | 'defence' | null {
    if (pt.rise >= ONSET.riseU) this.riseRun++;
    else this.riseRun = 0;
    if (steady && pt.rise < ONSET.riseU * 0.5) this.restedSinceContact = true;
    if (!this.armed || !this.anchorSettled || pt.t < this.armedAt) return null;
    // Hands already up and still when the delivery went live (loaded during the run-up): the press is the arm moment.
    if (this.needPreload) {
      this.needPreload = false;
      if (pt.rise >= ONSET.riseU && steady) {
        const press: Pt = { t: this.armedAt, h: this.anchorH ?? pt.h, x: pt.x, rise: 0 };
        this.open(press, [{ ...pt, t: Math.max(pt.t, this.armedAt + 1) }], cmds);
        return null;
      }
    }
    if (this.riseRun >= ONSET.frames && this.restedSinceContact) {
      // The press is the last still frame before the run; the proving frames after it are replayed.
      const runStart = this.hist.length - this.riseRun;
      let pressIdx = 0;
      for (let i = runStart - 1; i >= 0; i--) {
        if (this.hist[i].rise < ONSET.riseU * 0.5) {
          pressIdx = i;
          break;
        }
      }
      this.open(this.hist[pressIdx], this.hist.slice(pressIdx + 1), cmds);
    }
    return null;
  }

  private stepLoaded(pt: Pt, cmds: TrackerCommand[]): 'attack' | 'defence' | null {
    const press = this.press!;
    // Too long idle: a fidget, dropped.
    if (pt.t - press.t > RELAX.maxLoadedMs) {
      cmds.push({ type: 'cancel' });
      this.clearContact();
      this.phase = 'idle';
      this.riseRun = 0;
      return null;
    }
    const nearTop = pt.rise >= this.peakRaw - this.nearTopEps();
    if (nearTop) {
      // Still at (or above) the top: any frames held back were a dip that recovered; they become held samples.
      const samples: GestureSample[] = [];
      for (const p of this.pending) samples.push(this.latch(p));
      this.pending = [];
      this.belowSince = null;
      samples.push(this.latch(pt));
      this.lastTop = pt;
      cmds.push({ type: 'move', samples });
      return null;
    }
    this.pending.push(pt);
    const top = this.lastTop!;
    const n = this.pending.length;
    const descent = top.rise - pt.rise;
    const dt = pt.t - top.t;
    const prev = n >= 2 ? this.pending[n - 2] : top;
    if (n >= 2 && descent >= STRIKE.descentU && dt > 0 && pt.rise <= prev.rise + DESCENT_WOBBLE_U) {
      // The stroke's speed: from the last frame near the top (a noise-tolerant start), to this frame.
      let speedTop = top;
      for (const p of this.pending) if (p.rise >= this.peakRaw - STRIKE.speedEpsU) speedTop = p;
      const v = pt.t > speedTop.t ? ((speedTop.rise - pt.rise) / (pt.t - speedTop.t)) * 1000 : 0;
      const bigBacklift = this.peakRaw >= DEFENCE.maxPeakRiseU;
      const fastEnough = bigBacklift ? v >= STRIKE.minUPerS : v >= STRIKE.attackUPerS;
      const inWindow = pt.t - speedTop.t <= STRIKE.windowMs;
      if (inWindow && this.peakRaw >= STRIKE.minPeakRiseU && fastEnough) {
        // The stroke: replay the held-back frames from the top with their own times and the forward gain.
        const baseY = VIRTUAL_ORIGIN.y + K * Math.max(0, this.peakDB);
        const baseX = VIRTUAL_ORIGIN.x + ALPHA * K * (top.x - press.x);
        // Direction: the slope of sideways against down over the WHOLE descent seen so far (a least-squares line through the
        // top), not the first 40 ms alone: camera noise swamps 40 ms of sideways movement (sd 35 degrees in the synthetic
        // check), but over the descent the vertical travel is a long baseline (sd under 10 degrees).
        let sxy = 0;
        let syy = 0;
        for (const p of this.pending) {
          const dy = top.rise - p.rise;
          sxy += (p.x - top.x) * dy;
          syy += dy * dy;
        }
        const rho = syy > 0 ? Math.max(-STRIKE.maxSlope, Math.min(STRIKE.maxSlope, sxy / syy)) : 0;
        this.strikeBase = { y: baseY, x: baseX, top, rho };
        const topSample: GestureSample = { t: top.t, x: baseX, y: baseY };
        const run = this.strokeRun(topSample, this.pending);
        this.lastStrokeSample = run[run.length - 1];
        cmds.push({ type: 'move', samples: run });
        this.pending = [];
        this.phase = 'struck';
        this.strikeAt = pt.t;
        this.settleSince = null;
        return 'attack';
      }
      if (!bigBacklift && v >= DEFENCE.minUPerS && v < STRIKE.attackUPerS) {
        // A short, gentle push: the defensive straight bat, which the tracker knows as a tap at the onset.
        cmds.push({ type: 'cancel' });
        cmds.push({ type: 'down', sample: { t: top.t, x: VIRTUAL_ORIGIN.x, y: VIRTUAL_ORIGIN.y } });
        cmds.push({ type: 'up', sample: { t: top.t + DEFENCE.tapMs, x: VIRTUAL_ORIGIN.x, y: VIRTUAL_ORIGIN.y } });
        this.clearContact();
        this.phase = 'done';
        return 'defence';
      }
    }
    // Back down without a stroke?
    const low = pt.rise <= this.peakRaw * RELAX.fracOfPeak || pt.rise <= ONSET.riseU * 0.5;
    if (low) this.belowSince ??= pt.t;
    else this.belowSince = null;
    if ((this.belowSince !== null && pt.t - this.belowSince >= RELAX.holdMs) || n >= PENDING_MAX) this.relax(pt, cmds);
    return null;
  }

  private strokeSample(p: Pt): GestureSample {
    const b = this.strikeBase!;
    const down = b.top.rise - p.rise;
    return { t: p.t, x: b.x + G * K * b.rho * down, y: b.y - G * K * down };
  }

  /**
   * The stroke's samples from `from` (already sent, or the top) to the frames in `points`, with straight-line samples between
   * frames at most STROKE_SAMPLE_MS apart. No sample is invented beyond a line between two real frames.
   */
  private strokeRun(from: GestureSample, points: readonly Pt[]): GestureSample[] {
    const out: GestureSample[] = [];
    let a = from;
    for (const p of points) {
      const b = this.strokeSample(p);
      if (STROKE_SAMPLE_MS > 0 && b.t - a.t > STROKE_SAMPLE_MS * 1.5) {
        const n = Math.ceil((b.t - a.t) / STROKE_SAMPLE_MS);
        for (let i = 1; i < n; i++) {
          const u = i / n;
          out.push({ t: a.t + (b.t - a.t) * u, x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u });
        }
      }
      out.push(b);
      a = b;
    }
    return out;
  }

  /** The hands came back without a stroke: a deliberate leave when the backlift was deliberate, else a fidget (nothing). */
  private relax(pt: Pt, cmds: TrackerCommand[]) {
    const press = this.press!;
    const deliberate = this.peakRaw >= RELAX.deliberatePeakU && pt.t - press.t >= RELAX.deliberateLoadedMs;
    // The frames held back were held samples; sending them first makes the tracker read a held backlift ("tracking"), so
    // lifting it is a clean leave and never the legacy behind-square flick that an un-held pullback would be.
    const samples: GestureSample[] = [];
    for (const p of this.pending) samples.push(this.latch(p));
    this.pending = [];
    if (deliberate) {
      const last = samples.length ? samples[samples.length - 1] : this.latch(pt);
      if (!samples.length) samples.push(last);
      cmds.push({ type: 'move', samples });
      cmds.push({ type: 'up', sample: { t: Math.max(pt.t, last.t), x: last.x, y: last.y } });
      this.clearContact();
      this.phase = 'done';
    } else {
      cmds.push({ type: 'cancel' });
      this.clearContact();
      this.phase = 'idle';
    }
    this.riseRun = 0;
  }

  private stepStruck(pt: Pt, cmds: TrackerCommand[]) {
    const run = this.strokeRun(this.lastStrokeSample!, [pt]);
    this.lastStrokeSample = run[run.length - 1];
    cmds.push({ type: 'move', samples: run });
    const steady = this.isSteadyFor(pt.t, SETTLE.holdMs);
    if (steady) this.settleSince ??= pt.t;
    else this.settleSince = null;
    const settled = this.settleSince !== null && pt.t - this.settleSince >= SETTLE.holdMs;
    if (settled || pt.t - this.strikeAt >= SETTLE.maxMs) {
      const s = this.strokeSample(pt);
      cmds.push({ type: 'up', sample: s });
      this.clearContact();
      this.phase = 'done';
    }
  }

  private isSteadyFor(now: number, windowMs: number): boolean {
    let n = 0;
    let minH = Infinity;
    let maxH = -Infinity;
    for (let i = this.hist.length - 1; i >= 0; i--) {
      const p = this.hist[i];
      if (now - p.t > windowMs) break;
      n++;
      if (p.h < minH) minH = p.h;
      if (p.h > maxH) maxH = p.h;
    }
    return n >= 2 && maxH - minH <= REST.steadyExtentU;
  }
}
