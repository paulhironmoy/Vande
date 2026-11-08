/**
 * Bakes a plan into a trace: the channels of channels.ts at `hz` frames per second (60), one script long. Off the frame
 * path (idle or bowl()); `sample` then reads it in O(1).
 *
 * Pipeline per actor, at 240 steps per second inside, written out every `240 / hz` steps:
 *   gaze      saccades (main sequence), smooth pursuit of the delayed ball with catch-up saccades, fixations;
 *   head      a critically damped follower of the neck-delayed gaze keeps the head in space; the overlay is what
 *             must be added to the clip's own head to get there (eased into the neck range, never stopped dead);
 *   eyes      the residual between gaze and the head as it points, plus microsaccades and drift;
 *   lids      blinks from the plan, plus one on some large gaze shifts;
 *   life      breath with exertion and fractal sway, off inside the quiet windows.
 * Honesty: gaze at time t reads the visible ball only at t - lag (lag >= 125 ms) and nothing later; the targets
 * 'opponent' and 'hand' are generic. Nothing here reads the plan of the delivery or its result.
 */
import P from './params.json';
import { CH, CHANNELS, SCALE } from './channels';
import { AMP, BLINK_N, DRAW, FIDGET, FIDGET_N, FIX_N, MICRO_N, T_BALL, T_GROUND, T_OPP, T_SIDE, blinkShape, seamClash, taskWindow } from './plan';
import { fractal, skewSin } from './noise';
import { ballKey, mix, personKey, u01 } from './seeds';
import type { DirectorAnchors, DirectorEvents } from './types';

const TAU = Math.PI * 2;
const DT = 1000 / 240;
const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
const wrap180 = (x: number): number => (x > 180 ? x - 360 : x < -180 ? x + 360 : x);
const sm = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
/**
 * A range limit that eases in: x up to 75% of the limit, then an exponential approach that never passes it. Its slope
 * is continuous (1 at the knee), so the speed of whatever it limits never stops in a single frame.
 */
export const soft = (x: number, limit: number): number => {
  const a = 0.75 * limit;
  const t = x < 0 ? -x : x;
  if (t <= a) return x;
  const y = a + (limit - a) * (1 - Math.exp(-(t - a) / (limit - a)));
  return x < 0 ? -y : y;
};
/** Minimum-jerk position profile: zero speed and acceleration at both ends. */
const mj = (x: number): number => {
  const c = x <= 0 ? 0 : x >= 1 ? 1 : x;
  return c * c * c * (c * (c * 6 - 15) + 10);
};

/** A move out, held a moment and back: smooth at both ends, 1 across the middle third (u in 0..1). */
const bell = (u: number): number => mj(u / 0.38) * (1 - mj((u - 0.62) / 0.38));

interface Blink {
  t0: number;
  close: number;
  hold: number;
  open: number;
  depth: number;
  skew: number;
  total: number;
}

function envelope(b: Blink, u: number): number {
  if (u <= 0) return 0;
  if (u < b.close) return b.depth * mj(u / b.close);
  if (u < b.close + b.hold) return b.depth;
  const v = (u - b.close - b.hold) / b.open;
  return v >= 1 ? 0 : b.depth * (1 - mj(Math.pow(v, 0.75)));
}

/** How much of the body's ambient life is on at t: ramped in at the start, off in the quiet windows (H3). */
function lifeGain(a: DirectorAnchors, t: number): number {
  const L = P.life;
  const ramp = sm((t - a.start) / L.rampInMs);
  if (a.release === null) return ramp;
  if (a.role === 'striker') {
    const S = L.striker;
    const off = sm((t - (a.release - S.offFromMs)) / (S.offFromMs - S.offToMs));
    const back = sm((t - ((a.strokeEnd ?? Infinity) + S.afterStrokeMs)) / S.backMs);
    return ramp * (1 - off * (1 - back));
  }
  const B = L.bowler;
  const g = a.gather ?? a.release - 620;
  // Off from the run's start (P2) or, without it, from the gather (P1); the ramp out ends there.
  const e = Math.min(a.runStart ?? g, g);
  const off = sm((t - (e - B.rampOutMs)) / B.rampOutMs);
  const back = sm((t - (a.release + B.afterReleaseMs)) / B.backMs);
  return ramp * (1 - off * (1 - back));
}

/**
 * `reuse`: frames before `untilMs` are copied from an earlier trace of the same script at the same rate (a live plan
 * built before the result, when the caller knows the two agree up to `untilMs`), so the clip's head is only asked for
 * the frames after it; the integrators still run from the start, which is cheap.
 */
/** Integration steps (at 240 per second) between two yields of `bakeSteps`: a slice. A power of two. */
const SLICE_STEPS = 64;

/** How many trace frames a script of these anchors has at `hz` (what `bakeSteps` fills). */
export function traceFrames(a: DirectorAnchors, hz: number): number {
  return Math.max(1, Math.floor((a.end - a.start) / (1000 / hz) + 1e-9) + 1);
}

/** How far a bake has got (P3): `step` integration steps are done, so the frames up to `floor((step - 1) / sub)` are final. */
export interface BakeProgress {
  step: number;
}

export function* bakeSteps(
  a: DirectorAnchors,
  ev: DirectorEvents,
  hz: number,
  reuse?: { trace: Int16Array; untilMs: number },
  into?: Int16Array,
  progress?: BakeProgress,
): Generator<void, Int16Array, void> {
  const G = P.gaze;
  const H = P.head;
  const L = P.life;
  const rm = a.reducedMotion;
  const lead = G.leadX;
  const sub = Math.round(240 / hz);
  const dtT = 1000 / hz;
  const n = traceFrames(a, hz);
  const N = (n - 1) * sub + 1;
  // `into`: the caller's own array for the trace (a job that serves the plan while it is still being filled, P3); zero-filled, n * CHANNELS long.
  const trace = into && into.length === n * CHANNELS ? into : new Int16Array(n * CHANNELS);
  const tmp = new Float64Array(3);
  const bk = ballKey(a.key, personKey(a.person, a.role));
  const d = ev.draw;
  const am = ev.amp;
  const win = taskWindow(a);

  const kept = reuse ? Math.max(0, Math.min(n, Math.floor((reuse.untilMs - a.start) / dtT), reuse.trace.length / CHANNELS)) : 0;
  if (reuse) trace.set(reuse.trace.subarray(0, kept * CHANNELS));
  // The clip's own head, on the trace grid (the only per-frame call that may be expensive for the caller).
  const space = a.headMode === 'space';
  const clip = new Float64Array(space ? 0 : n * 3);
  if (!space) {
    for (let k = kept; k < n; k++) {
      tmp[0] = tmp[1] = tmp[2] = 0;
      a.clipHead(a.start + k * dtT, tmp);
      for (let c = 0; c < 3; c++) clip[3 * k + c] = Number.isFinite(tmp[c]) ? tmp[c] : 0;
      if ((k & 31) === 31) yield;
    }
  }

  // Blinks: the plan's, plus those riding on large gaze shifts (inserted as they are decided, always in the future).
  const blinks: Blink[] = [];
  for (let k = 0; k < ev.blink.length; k += BLINK_N) {
    const [t0, close, hold, open, depth, skew] = ev.blink.subarray(k, k + BLINK_N);
    blinks.push({ t0, close, hold, open, depth, skew, total: close + hold + open });
  }
  const shiftSeed = mix(bk, 12);
  const addShiftBlink = (t: number, k: number) => {
    const s = blinkShape(shiftSeed, 5000 + k);
    const total = s.close + s.hold + s.open;
    const t0 = t + u01(mix(bk, 41), k) * 40;
    const gap = P.blink.shiftGapMs;
    if (t0 + total > a.end) return;
    if (win !== null && t0 - P.blink.skewMs < win[1] && t0 + total + P.blink.skewMs > win[0]) return;
    if (seamClash(a, t0, total)) return;
    for (const b of blinks) if (t0 > b.t0 - gap - total && t0 < b.t0 + b.total + gap) return;
    let i = blinks.length;
    while (i > 0 && blinks[i - 1].t0 > t0) i--;
    blinks.splice(i, 0, { t0, ...s, total });
  };
  let bi0 = 0;

  // Gaze, head, eyes.
  const fix = ev.fix;
  const nFix = fix.length / FIX_N;
  const gyH = new Float32Array(N);
  const gpH = new Float32Array(N);
  const latSteps = Math.round(d[DRAW.neckLagMs] / DT);
  const omega = 1000 / (H.tauMs[a.role] * (rm ? H.rmTauX : 1));
  const maxHead = H.maxDegS * (rm ? H.rmSpeedX : 1);
  const comfY = H.comfortDeg * H.yawShare;
  const comfP = H.comfortDeg * H.pitchShare;
  // Smooth-pursuit feed-forward for the head (P3): a critically damped follower of a ramp lags it by 2 / omega, so while the
  // gaze is on the ball the head's target is carried on by that much at the ball target's own (filtered) angular velocity.
  // The velocity comes from the ball target alone (the ball as it was one latency ago, carried on), never from the saccades.
  const ffK = rm ? 0 : (H.ffX * 2) / omega;
  const ffAlpha = 1 - Math.exp(-DT / H.ffTauMs);
  const ffY = new Float32Array(ffK > 0 ? N : 0);
  const ffP = new Float32Array(ffK > 0 ? N : 0);
  let vfY = 0;
  let vfP = 0;
  let pwY = 0;
  let pwP = 0;
  let pwOk = false;
  let hadPw: boolean;
  const eyeY = rm ? G.eyeRmDeg : G.eyeYawDeg;
  const eyeP = rm ? G.eyeRmDeg : G.eyePitchDeg;
  const ovGain = rm ? H.rmGainX : 1;
  const sacCap = (G.saccMaxDegS * DT) / 1000;
  const pursuitStep = (G.pursuitMaxDegS * DT) / 1000;
  let kf = -1;
  let gy = 0;
  let gp = 0;
  let py = 0;
  let pp = 0;
  let haveG = false;
  let sacOn = false;
  let sT0 = 0;
  let sFy = 0;
  let sFp = 0;
  let sTy = 0;
  let sTp = 0;
  let sD = 1;
  let sEnd = -1e9;
  /** A fixation whose saccade waits for the eyes to be free again (a saccade cannot be re-aimed within 120 ms). */
  let pending = -1;
  let groundYaw = 0;
  let groundPitch = 0;
  let hsy = 0;
  let hvy = 0;
  let hsp = 0;
  let hvp = 0;
  let hsInit = false;
  let mi0 = 0;
  const wv = new Float64Array(2);
  /** The first valid target: the gaze starts there, and so does the head (no sweep from nowhere). */
  const initGaze = (i: number) => {
    gy = wv[0];
    gp = wv[1];
    haveG = true;
    for (let j = 0; j <= i; j++) {
      gyH[j] = gy;
      gpH[j] = gp;
    }
  };
  const tgtOf = (kind: number, lag: number, t: number): boolean => {
    if (kind === T_GROUND) {
      wv[0] = groundYaw;
      wv[1] = groundPitch;
      return true;
    }
    if (kind === T_SIDE) {
      // A look to the side of the opponent: the fixation's lag column is the yaw offset.
      tmp[0] = tmp[1] = 0;
      if (!a.aim('opponent', t, tmp) || !Number.isFinite(tmp[0] + tmp[1])) return false;
      wv[0] = tmp[0] + lag;
      wv[1] = tmp[1] + P.fidget.sidePitchDeg;
      return true;
    }
    if (kind === T_BALL) {
      tmp[0] = tmp[1] = 0;
      // The ball as it was one latency ago, carried on at its own velocity to now (P3): still nothing later than t - lag.
      if (!a.visibleBall(t - lag, tmp, lead * lag)) return false;
    } else if (!a.aim(kind === T_OPP ? 'opponent' : 'hand', t, tmp)) return false;
    if (!Number.isFinite(tmp[0] + tmp[1])) return false;
    wv[0] = tmp[0];
    wv[1] = tmp[1];
    return true;
  };
  /** Looking at the ground keeps the gaze's yaw and drops it to the event's downward angle. */
  const setGround = (o: number) => {
    if (fix[o + 1] !== T_GROUND) return;
    groundYaw = gy;
    groundPitch = fix[o + 3];
  };
  const startSaccade = (t: number, ty: number, tp: number) => {
    const amp = Math.sqrt((ty - gy) * (ty - gy) + (tp - gp) * (tp - gp));
    sacOn = true;
    sT0 = t;
    sFy = gy;
    sFp = gp;
    sTy = ty;
    sTp = tp;
    // Main sequence; never faster than the peak-speed cap (the profile peaks at about 1.9 x amplitude / duration).
    sD = Math.max(G.saccBaseMs + G.saccMsPerDeg * amp, (1.9 * amp * 1000) / G.saccMaxDegS);
  };

  // Life.
  const pulses: number[] = [];
  const tau = d[DRAW.exertTauS];
  if (a.release !== null) {
    if (a.role === 'bowler') pulses.push(a.release, L.exert.bowler, tau);
    else {
      if (a.strokeEnd !== null) pulses.push(a.strokeEnd, L.exert.stroke, tau);
      if (a.outcomeAt !== null && a.runs > 0) pulses.push(a.outcomeAt + d[DRAW.reactionMs], Math.min(L.exert.cap, L.exert.perRun * a.runs), tau);
    }
  }
  // P3: a reaction breathes out (the exertion also raises the breath's depth and rate)
  if (ev.react.length) pulses.push(ev.react[0], ev.react[9], P.react.exhaleTauS);
  const rise = L.exert.riseS;
  const swayAmp = L.sway.amp;
  const swayL = L.sway.spacingS;
  const ca = Math.cos(d[DRAW.swayAxis]);
  const sa = Math.sin(d[DRAW.swayAxis]);
  const hSeed = mix(bk, 51);
  const wSeed = mix(bk, 52);
  const fid = ev.fidget;
  const nFid = fid.length / FIDGET_N;
  let fi0 = 0;
  const rea = ev.react;
  const RC = P.react;
  const XC = P.expr.conc;
  const slowX = rm ? P.expr.slowRm : 1;

  for (let i = 0; i < N; i++) {
    if ((i & (SLICE_STEPS - 1)) === SLICE_STEPS - 1) {
      if (progress) progress.step = i;
      yield;
    }
    const t = a.start + i * DT;
    // 1. fixation changes
    while (kf + 1 < nFix && fix[(kf + 1) * FIX_N] <= t) {
      kf++;
      const o = kf * FIX_N;
      if (!haveG) {
        setGround(o);
        if (tgtOf(fix[o + 1], fix[o + 3], t)) initGaze(i);
      } else pending = kf;
    }
    // 2. gaze
    hadPw = pwOk;
    pwOk = false; // set again by the pursuit branch below when it runs this step with the ball as its target
    if (sacOn) {
      const u = (t - sT0) / sD;
      if (u >= 1) {
        gy = sTy;
        gp = sTp;
        sacOn = false;
        sEnd = t;
      } else {
        const w = mj(Math.pow(u, G.saccShape));
        gy = sFy + (sTy - sFy) * w;
        gp = sFp + (sTp - sFp) * w;
      }
    } else if (pending >= 0) {
      // Hold until the eyes are free, then shift to where the target is now.
      if (t - sEnd >= G.refractoryMs) {
        const o = pending * FIX_N;
        setGround(o);
        if (tgtOf(fix[o + 1], fix[o + 3], t)) {
          const amp = Math.sqrt((wv[0] - gy) * (wv[0] - gy) + (wv[1] - gp) * (wv[1] - gp));
          if (amp >= G.saccMinDeg) {
            startSaccade(t, wv[0], wv[1]);
            if (fix[o + 4] > 0 && amp >= P.blink.shiftMinDeg) addShiftBlink(t, pending);
          }
        }
        pending = -1;
      }
    } else if (kf >= 0 && tgtOf(fix[kf * FIX_N + 1], fix[kf * FIX_N + 3], t)) {
      if (ffK > 0) {
        if (fix[kf * FIX_N + 1] === T_BALL) {
          const dY = wrap180(wv[0] - pwY);
          const dP = wv[1] - pwP;
          // A step of more than 8 degrees in 4 ms is a change of target, not a motion: start the estimate again.
          if (hadPw && Math.abs(dY) < 8 && Math.abs(dP) < 8) {
            vfY += ((dY * 1000) / DT - vfY) * ffAlpha;
            vfP += ((dP * 1000) / DT - vfP) * ffAlpha;
          } else if (hadPw) {
            vfY *= 1 - ffAlpha;
            vfP *= 1 - ffAlpha;
          }
          pwY = wv[0];
          pwP = wv[1];
          pwOk = true;
        } else {
          vfY *= 1 - ffAlpha;
          vfP *= 1 - ffAlpha;
          pwOk = false;
        }
      }
      if (!haveG) initGaze(i);
      else {
        const ey = wv[0] - gy;
        const ep = wv[1] - gp;
        const e = Math.sqrt(ey * ey + ep * ep);
        if (e > G.catchUpDeg && t - sEnd >= G.refractoryMs) startSaccade(t, wv[0], wv[1]);
        else if (e > 1e-9) {
          const step = Math.min(e, pursuitStep);
          gy += (ey / e) * step;
          gp += (ep / e) * step;
        }
      }
    }
    if (i > 0) {
      const dd = Math.sqrt((gy - py) * (gy - py) + (gp - pp) * (gp - pp));
      if (dd > sacCap) {
        gy = py + ((gy - py) * sacCap) / dd;
        gp = pp + ((gp - pp) * sacCap) / dd;
      }
    }
    py = gy;
    pp = gp;
    gyH[i] = gy;
    gpH[i] = gp;
    if (ffK > 0) {
      ffY[i] = clamp(ffK * vfY, -H.ffMaxDeg, H.ffMaxDeg);
      ffP[i] = clamp(ffK * vfP, -H.ffMaxDeg, H.ffMaxDeg);
    }
    // 3. head in space: follows the gaze once the eyes would be off centre by more than the comfort zone
    if (!hsInit && haveG) {
      hsy = gy;
      hsp = gp;
      hsInit = true;
    }
    if (hsInit) {
      const di = Math.max(0, i - latSteps);
      const gdY = ffK > 0 ? gyH[di] + ffY[di] : gyH[di];
      const gdP = ffK > 0 ? gpH[di] + ffP[di] : gpH[di];
      const wY = gdY - clamp(gdY - hsy, -comfY, comfY);
      const wP = gdP - clamp(gdP - hsp, -comfP, comfP);
      const dtS = DT / 1000;
      hvy = clamp(hvy + (omega * omega * (wY - hsy) - 2 * omega * hvy) * dtS, -maxHead, maxHead);
      hvp = clamp(hvp + (omega * omega * (wP - hsp) - 2 * omega * hvp) * dtS, -maxHead, maxHead);
      hsy += hvy * dtS;
      hsp += hvp * dtS;
    }
    if (i % sub !== 0 || i / sub < kept) continue;

    // 4. a frame
    const k = i / sub;
    const o = k * CHANNELS;
    const tS = (t - a.start) / 1000;
    const put = (c: number, v: number) => {
      const q = Math.round(v / SCALE[c]);
      trace[o + c] = q > 32767 ? 32767 : q < -32767 ? -32767 : q;
    };
    const cy = space ? 0 : clip[3 * k];
    const cp = space ? 0 : clip[3 * k + 1];
    const cr = space ? 0 : clip[3 * k + 2];
    // head drift (own slow wobble), overlay
    const drift = (c: number, amp: number) => (rm ? 0 : amp * fractal(hSeed + 131 * c, tS, d[DRAW.headDrift + c], H.driftS, [1, 0.5]));
    // The reaction's head (P3, from outcomeAt + 180 ms): up for a good result, down for a bad one, a shake for the worst.
    let hyR = 0;
    let hpR = 0;
    let postureR = 0;
    let rEnv = 0;
    if (rea.length && t > rea[0]) {
      const u = t - rea[0];
      const env = u < rea[3] ? mj(u / rea[3]) : u < rea[3] + rea[4] ? 1 : 1 - mj((u - rea[3] - rea[4]) / rea[5]);
      rEnv = env > 0 ? env : 0;
      if (env > 0) {
        hpR = env * rea[8];
        postureR = env * rea[1] * rea[2] * (rea[1] > 0 ? RC.postureLiftDeg : RC.postureSlumpDeg);
        if (!rm && rea[6] !== 0 && u < RC.shakeMs) hyR = rea[6] * Math.sin((TAU * rea[7] * u) / 1000) * Math.sin((Math.PI * u) / RC.shakeMs);
      }
    }
    const hy = hsy + drift(0, H.driftDeg[0]) + hyR;
    const hp = hsp + drift(1, H.driftDeg[1]) + hpR;
    // eyes: gaze plus microsaccades and drift, minus where the head actually points
    let ux = 0;
    let uy = 0;
    if (!rm) {
      while (mi0 < ev.micro.length / MICRO_N && t - ev.micro[mi0 * MICRO_N] > 1500) mi0++;
      for (let m = mi0; m < ev.micro.length / MICRO_N && ev.micro[m * MICRO_N] <= t; m++) {
        const age = t - ev.micro[m * MICRO_N];
        const w = mj(age / G.microRiseMs) * Math.exp(-age / G.microRelaxMs);
        ux += ev.micro[m * MICRO_N + 1] * w;
        uy += ev.micro[m * MICRO_N + 2] * w;
      }
      for (let s = 0; s < 3; s++) {
        const oy = DRAW.eyeDrift + 3 * s;
        const op = DRAW.eyeDrift + 9 + 3 * s;
        ux += d[oy + 2] * Math.sin(TAU * d[oy] * tS + d[oy + 1]);
        uy += d[op + 2] * Math.sin(TAU * d[op] * tS + d[op + 1]);
      }
    }
    if (space) {
      // The head in space (limited softly so the quantised channel never clips) and the raw gaze: the stage decides
      // the head's share against the pose it drew, and the eyes take the rest (`eyesFor`).
      put(CH.headYaw, soft(hy, H.spaceLimitDeg[0]));
      put(CH.headPitch, soft(hp, H.spaceLimitDeg[1]));
      put(CH.headRoll, soft(H.rollPerYaw * hy + drift(2, H.driftDeg[2]), H.limitDeg[2]));
      put(CH.gazeYaw, gy + ux);
      put(CH.gazePitch, gp + uy);
    } else {
      const ovY = soft(ovGain * (hy - cy), H.limitDeg[0]);
      const ovP = soft(ovGain * (hp - cp), H.limitDeg[1]);
      const ovR = soft(ovGain * (H.rollPerYaw * ovY + drift(2, H.driftDeg[2]) - cr), H.limitDeg[2]);
      put(CH.headYaw, ovY);
      put(CH.headPitch, ovP);
      put(CH.headRoll, ovR);
      const headY = cy + ovY;
      const headP = cp + ovP;
      const eY = soft(gy + ux - headY, eyeY);
      const eP = soft(gp + uy - headP, eyeP);
      put(CH.eyeYawL, eY - G.vergenceDeg / 2);
      put(CH.eyeYawR, eY + G.vergenceDeg / 2);
      put(CH.eyePitchL, eP);
      put(CH.eyePitchR, eP);
      put(CH.lidFollow, clamp(eP / 30, -1, 1) * 0.5);
      put(CH.gazeYaw, headY + eY);
      put(CH.gazePitch, headP + eP);
    }
    // lids
    while (bi0 < blinks.length && t > blinks[bi0].t0 + blinks[bi0].total + 40) bi0++;
    let bl = 0;
    let br = 0;
    for (let b = bi0; b < blinks.length && blinks[b].t0 - 40 <= t; b++) {
      bl = Math.max(bl, envelope(blinks[b], t - blinks[b].t0 - blinks[b].skew));
      br = Math.max(br, envelope(blinks[b], t - blinks[b].t0 + blinks[b].skew));
    }
    put(CH.blinkL, bl);
    put(CH.blinkR, br);
    // expressions (P3): the concentration of the task (closed form of the anchors: the ball is coming), then the reaction's face
    // (from outcomeAt + 180 ms). The batter's effort belongs to his own input: the stage adds it (it is not in the plan).
    let xCon = 0;
    if (a.release !== null) {
      const [mx, leadMs, toMs, decMs] = a.role === 'striker' ? XC.striker : XC.bowler;
      const rise = (leadMs - toMs) * slowX;
      const full = a.release - toMs;
      const end = (a.role === 'striker' ? (a.taskEnd ?? a.contact ?? a.release + P.blink.idleEndMs) : a.release) + XC.afterMs;
      xCon = mx * mj((t - (full - rise)) / rise) * (1 - mj((t - end) / (decMs * slowX)));
    }
    put(CH.xConcentration, Math.min(1, xCon + rEnv * (rea.length ? rea[11] : 0)));
    put(CH.xFrustration, rea.length ? rEnv * Math.max(0, -rea[1]) * rea[2] : 0);
    put(CH.xRelief, rea.length ? rEnv * rea[10] : 0);
    put(CH.xCelebration, rea.length ? rEnv * Math.max(0, rea[1]) * rea[2] : 0);
    // life: exertion first (it raises the breath rate and depth)
    let e = 0;
    let E = 0;
    for (let p = 0; p < pulses.length; p += 3) {
      const x = (t - pulses[p]) / 1000;
      if (x <= 0) continue;
      const tau2 = 1 / (1 / pulses[p + 2] + 1 / rise);
      e += pulses[p + 1] * (1 - Math.exp(-x / rise)) * Math.exp(-x / pulses[p + 2]);
      E += pulses[p + 1] * (pulses[p + 2] * (1 - Math.exp(-x / pulses[p + 2])) - tau2 * (1 - Math.exp(-x / tau2)));
    }
    e = Math.min(L.exert.cap, e);
    put(CH.exertion, e);
    const q = rm ? 0 : lifeGain(a, t);
    if (q > 0) {
      const B = L.breath;
      const phase = d[DRAW.breathPhase] + am[AMP.breathHz] * (tS + B.rateX * E) + d[DRAW.modCycles] * Math.sin(TAU * (d[DRAW.modHz] * tS + d[DRAW.modPhase])) * (1 - B.modDamp * e);
      const depth = (1 + B.ampMod * Math.sin(TAU * (d[DRAW.ampModHz] * tS + d[DRAW.ampPhase]))) * (1 + B.depthX * e);
      put(CH.breath, q * am[AMP.breathDepthDeg] * depth * skewSin(phase, am[AMP.breathSkew]));
      const norm = L.sway.norm;
      const n0 = norm * fractal(wSeed, tS, d[DRAW.swayPhase], swayL, swayAmp);
      const n1 = norm * fractal(wSeed + 1013, tS, d[DRAW.swayPhase + 1], swayL, swayAmp);
      const n2 = norm * fractal(wSeed + 2029, tS, d[DRAW.swayPhase + 2], swayL, swayAmp);
      // fidgets (P3): bell-shaped moves of the same body parts, a function of the plan's events and the time only
      let fX = 0;
      let fZ = 0;
      let fR = 0;
      let fP = 0;
      let fT = 0;
      for (let m = fi0; m < nFid; m++) {
        const o = m * FIDGET_N;
        const f0 = fid[o];
        if (f0 > t) break;
        const u = (t - f0) / fid[o + 2];
        if (u >= 1) {
          if (m === fi0) fi0++;
          continue;
        }
        const kind = fid[o + 1];
        if (kind === FIDGET.breath) {
          // a sigh: the chest lifts quickly and settles slowly
          fP += fid[o + 3] * (u < 0.25 ? mj(u / 0.25) : u < 0.35 ? 1 : 1 - mj((u - 0.35) / 0.65));
          continue;
        }
        const env = bell(u);
        if (kind === FIDGET.weight) {
          fX += fid[o + 3] * env;
          fR += fid[o + 4] * env;
        } else if (kind === FIDGET.stance) {
          fZ += fid[o + 3] * env;
          fT += fid[o + 4] * env;
          fP += fid[o + 5] * env;
        } else {
          fT += fid[o + 3] * Math.sin(TAU * fid[o + 5] * u) * env;
          fP += fid[o + 4] * Math.sin(TAU * fid[o + 5] * u + 1.3) * env;
        }
      }
      put(CH.swayX, q * (am[AMP.swayRootMm] * (n0 * ca - n1 * sa * 0.5) + fX));
      put(CH.swayZ, q * (am[AMP.swayRootMm] * (n0 * sa * 0.5 + n1 * 0.7) + fZ));
      put(CH.swayRoll, q * (am[AMP.swayRollDeg] * n2 + fR));
      put(CH.posture, q * (fP + postureR));
      put(CH.twist, q * fT);
    }
  }
  return trace;
}

/** Runs the bake to the end in one go (the same code `bakeSteps` runs a slice at a time). */
export function bake(a: DirectorAnchors, ev: DirectorEvents, hz: number, reuse?: { trace: Int16Array; untilMs: number }): Int16Array {
  const g = bakeSteps(a, ev, hz, reuse);
  for (;;) {
    const r = g.next();
    if (r.done) return r.value;
  }
}
