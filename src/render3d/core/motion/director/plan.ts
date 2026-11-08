/**
 * The plan: the Director's events for one actor in one script (about 22 for a delivery, under 1.5 kB), built once off
 * the frame path. Every random number is a draw from the ball's key with a fixed index (seeds.ts), so the draws do not
 * depend on the anchors or on the ball: the anchors only decide when an event falls. The plan never reads the ball, its
 * speed, length, line, variation or result; a time that depends on the contact, the outcome or the dead ball only
 * matters after that moment (the tests prove it).
 */
import P from './params.json';
import { ballKey, gauss, lognorm, mix, personKey, range, u01 } from './seeds';
import type { DirectorAnchors, DirectorEvents } from './types';

/** Gaze targets. */
export const T_OPP = 0;
const T_HAND = 1;
export const T_GROUND = 2;
export const T_BALL = 3;
/** A glance to the side of the opponent (P3): the fixation's lag column is the yaw offset (deg, + left), plus a small downward pitch. */
export const T_SIDE = 4;

export const FIX_N = 5;
export const BLINK_N = 6;
export const MICRO_N = 3;
/** Floats per fidget event and per reaction (types.ts DirectorEvents). */
export const FIDGET_N = 8;
export const REACT_N = 12;
/** Fidget kinds (column 1): a weight shift, a stance adjust, a shoulder roll, a sigh (the chest lifts quickly and settles slowly). */
export const FIDGET = { weight: 0, stance: 1, shoulder: 2, breath: 3 } as const;

/** Indices in `DirectorEvents.draw` (per-ball draws). */
export const DRAW = {
  breathPhase: 0, // cycles
  ampPhase: 1, // cycles
  modPhase: 2, // cycles
  modHz: 3,
  modCycles: 4,
  swayPhase: 5, // 5, 6, 7: lattice offsets of the three sway octaves
  swayAxis: 8, // rad: direction of the dominant weight shift on the ground
  headDrift: 9, // 9, 10, 11: lattice offsets of the head drift (yaw, pitch, roll)
  neckLagMs: 12,
  lagMs: 13, // pursuit lag: how late the gaze follows the visible ball
  reactionMs: 14, // latency of the first reaction after the outcome
  exertTauS: 15,
  ampModHz: 16,
  eyeDrift: 17, // 17 .. 34: per axis (yaw, pitch) three sinusoids of [Hz, phase rad, amplitude deg]
  N: 36,
} as const;

/** Indices in `DirectorEvents.amp` (person amplitudes, constant for the over). */
export const AMP = { breathHz: 0, breathDepthDeg: 1, breathSkew: 2, swayRootMm: 3, swayRollDeg: 4, blinkMeanS: 5, blinkCv: 6, fidgetX: 7, N: 8 } as const;

const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);

/** The span in which the actor's eyes are busy: the Director blinks neither inside it nor across its edges. */
export function taskWindow(a: DirectorAnchors): [number, number] | null {
  if (a.release === null) return null;
  const [before, after] = P.blink.windowMs[a.role];
  if (a.role === 'bowler') return [(a.gather ?? a.release - 620) - before, a.release + after];
  return [a.release - before, (a.taskEnd ?? a.contact ?? a.release + P.blink.idleEndMs) + after];
}

/**
 * Whether a blink of `total` ms at `t` falls across the seam of a looping script (P2): the fade at the end of the loop
 * (the last `seamMs`) and the pre-roll it fades into (`start` to 0) must both be lid-open, with a margin for the lids'
 * own timing, so a cross-fade never meets a half-closed eye.
 */
export function seamClash(a: DirectorAnchors, t: number, total: number): boolean {
  const seam = a.seamMs ?? 0;
  if (seam <= 0) return false;
  const m = P.blink.skewMs + P.blink.seamMarginMs;
  return t + total + m > a.end - seam || t - m < a.start + seam;
}

function persons(pk: number, role: 'bowler' | 'striker'): Float32Array {
  const L = P.life;
  const amp = new Float32Array(AMP.N);
  amp[AMP.breathHz] = range(pk, 0, L.breath.hz[0], L.breath.hz[1]);
  amp[AMP.breathDepthDeg] = range(pk, 1, L.breath.depthDeg[0], L.breath.depthDeg[1]);
  amp[AMP.breathSkew] = range(pk, 2, L.breath.skew[0], L.breath.skew[1]);
  amp[AMP.swayRootMm] = range(pk, 3, L.sway.rootMm[role][0], L.sway.rootMm[role][1]);
  amp[AMP.swayRollDeg] = range(pk, 4, L.sway.rollDeg[0], L.sway.rollDeg[1]);
  amp[AMP.blinkMeanS] = range(pk, 5, P.blink.meanS[0], P.blink.meanS[1]);
  amp[AMP.blinkCv] = range(pk, 6, P.blink.cv[0], P.blink.cv[1]);
  amp[AMP.fidgetX] = range(pk, 7, P.fidget.personX[0], P.fidget.personX[1]);
  return amp;
}

function draws(bk: number, amp: Float32Array): Float32Array {
  const G = P.gaze;
  const L = P.life.breath;
  const d = new Float32Array(DRAW.N);
  const s = mix(bk, 1);
  d[DRAW.breathPhase] = u01(s, 0);
  d[DRAW.ampPhase] = u01(s, 1);
  d[DRAW.modPhase] = u01(s, 2);
  d[DRAW.modHz] = range(s, 3, L.modHz[0], L.modHz[1]);
  // The breath rate swings by +-modDev of itself: the phase wave has amplitude dev * f0 / (2 pi fm) cycles.
  d[DRAW.modCycles] = (range(s, 4, L.modDev[0], L.modDev[1]) * amp[AMP.breathHz]) / (Math.PI * 2 * d[DRAW.modHz]);
  for (let k = 0; k < 3; k++) d[DRAW.swayPhase + k] = range(s, 5 + k, 0, 97);
  d[DRAW.swayAxis] = range(s, 8, 0, Math.PI * 2);
  for (let k = 0; k < 3; k++) d[DRAW.headDrift + k] = range(s, 9 + k, 0, 97);
  d[DRAW.neckLagMs] = range(s, 12, P.head.neckLagMs[0], P.head.neckLagMs[1]);
  d[DRAW.lagMs] = range(s, 13, G.lagMs[0], G.lagMs[1]);
  d[DRAW.reactionMs] = range(s, 14, P.fix.reactionMs[0], P.fix.reactionMs[1]);
  d[DRAW.exertTauS] = range(s, 15, P.life.exert.tauS[0], P.life.exert.tauS[1]);
  d[DRAW.ampModHz] = range(s, 16, L.ampModHz[0], L.ampModHz[1]);
  for (let k = 0; k < 6; k++) {
    const o = DRAW.eyeDrift + 3 * k;
    d[o] = range(s, 20 + 3 * k, G.driftHz[0], G.driftHz[1]);
    d[o + 1] = range(s, 21 + 3 * k, 0, Math.PI * 2);
    d[o + 2] = range(s, 22 + 3 * k, G.driftDeg[0], G.driftDeg[1]);
  }
  return d;
}

/**
 * The shape of blink `j` (draws from `seed`): closing 78 .. 118 ms, a short hold, opening 2 .. 2.8 times the closing,
 * 18% partial. The whole blink then measures 206 .. 414 ms at the 2% edges.
 */
export function blinkShape(seed: number, j: number) {
  const B = P.blink;
  const s = mix(seed, j);
  const close = clamp(98 + 10 * gauss(s, 0), B.closeMs[0], B.closeMs[1]);
  const open = close * range(s, 3, B.openRatio[0], B.openRatio[1]);
  return { close, hold: range(s, 4, B.holdMs[0], B.holdMs[1]), open, depth: u01(s, 5) < B.partialP ? range(s, 6, B.partialDepth[0], B.partialDepth[1]) : 1, skew: (u01(s, 7) - 0.5) * 2 * B.skewMs };
}

/** Blinks: log-normal intervals, none inside the task window (a blink that would fall in it is deferred to just after). */
function blinks(a: DirectorAnchors, bk: number, amp: Float32Array, win: [number, number] | null): number[] {
  const B = P.blink;
  const sg = mix(bk, 11);
  const ss = mix(bk, 12);
  const sd = mix(bk, 13);
  const sr = mix(bk, 14);
  const cv = amp[AMP.blinkCv];
  const mean = (t: number) => amp[AMP.blinkMeanS] * (win === null ? 1 : t < win[0] ? B.attendX[a.role] : B.afterX);
  const shape = (j: number) => blinkShape(ss, j);
  const clashes = (t: number, total: number) => (win !== null && t - B.skewMs < win[1] && t + total + B.skewMs > win[0]) || seamClash(a, t, total);
  const out: number[] = [];
  let t = a.start + lognorm(B.firstMeanMs, cv, gauss(sg, 0));
  for (let k = 0; t < a.end; k++) {
    const b = shape(k);
    const total = b.close + b.hold + b.open;
    if (clashes(t, total)) {
      if (win !== null && t - B.skewMs < win[1] && t + total + B.skewMs > win[0]) t = win[1] + B.skewMs + range(sr, 0, B.reliefMs[0], B.reliefMs[1]);
      else if (t < a.start + (a.seamMs ?? 0) + B.skewMs + B.seamMarginMs) t = a.start + (a.seamMs ?? 0) + B.skewMs + B.seamMarginMs + range(sr, 0, B.reliefMs[0], B.reliefMs[1]);
      else break; // across the seam at the end of a loop: no more blinks
      if (clashes(t, total)) break;
    }
    if (t + total > a.end) break;
    out.push(t, b.close, b.hold, b.open, b.depth, b.skew);
    if (u01(sd, 2 * k) < B.doubleP) {
      const c = shape(1000 + k);
      const t2 = t + total + range(sd, 2 * k + 1, B.doubleGapMs[0], B.doubleGapMs[1]);
      if (t2 + c.close + c.hold + c.open < a.end && !clashes(t2, c.close + c.hold + c.open)) {
        out.push(t2, c.close, c.hold, c.open, c.depth, c.skew);
        t = t2;
      }
    }
    t += Math.max(B.minGapMs, 1000 * lognorm(mean(t), cv, gauss(sg, k + 1)));
  }
  return out;
}

/** Gaze fixations, in time order. Before the ball is visible they depend on the role and the draws only. */
function fixations(a: DirectorAnchors, bk: number, d: Float32Array): number[] {
  const F = P.fix;
  const sf = mix(bk, 21);
  const sb = mix(bk, 22);
  const sx = mix(bk, 23);
  const ss = mix(bk, 24);
  let j = 0;
  const u = () => u01(sf, j++);
  const rr = (r: number[]) => r[0] + (r[1] - r[0]) * u();
  const out: number[] = [];
  // The lag column is the pursuit lag (ms) for the ball and the downward angle (deg) for the ground.
  const add = (t: number, target: number, mode: number, lag: number) => out.push(t, target, mode, target === T_GROUND ? rr(P.gaze.groundPitchDeg) : lag, u01(sb, out.length / FIX_N) < P.blink.shiftP ? 1 : 0);
  const bowler = a.role === 'bowler';
  add(a.start, T_OPP, 0, 0);
  if (a.release === null) {
    let t = a.start;
    for (;;) {
      t += rr(F.idleDwellMs[a.role]);
      if (t >= a.end - F.idleSeamMs) break;
      const v = u();
      const kind = v < F.idleGroundP ? T_GROUND : !bowler && v < F.idleGroundP + 0.15 ? T_HAND : T_OPP;
      // P3: now and then a look to the side of him (the field, the crowd), on its own draws so the rest of the scene is as it was
      const side = !a.reducedMotion && P.fidget.sideGlanceP > u01(ss, 3 * out.length) && kind === T_OPP;
      if (side) add(t, T_SIDE, 0, (u01(ss, 3 * out.length + 1) < 0.5 ? -1 : 1) * range(ss, 3 * out.length + 2, P.fidget.sideYawDeg[0], P.fidget.sideYawDeg[1]));
      else add(t, kind, 0, 0);
    }
    // A between-balls script loops: it ends on the opponent, where it began, so the wrap is not a jump of the gaze.
    add(a.end - F.idleSeamMs + 500, T_OPP, 0, 0);
    return out;
  }
  const lag = d[DRAW.lagMs];
  if (bowler) {
    const g = a.gather ?? a.release - 620;
    for (let t = a.start + rr(F.bowlerDwellMs); t < g - 900; t += rr(F.bowlerDwellMs)) add(t, u() < F.bowlerGroundP ? T_GROUND : T_OPP, 0, 0);
    add(g + range(sx, 0, F.gatherMs[0], F.gatherMs[1]), T_OPP, 0, 0);
    add(a.release + range(sx, 1, F.afterBallMs[0], F.afterBallMs[1]), T_BALL, 1, lag);
    add(a.release + range(sx, 2, F.afterOpponentMs[0], F.afterOpponentMs[1]), T_OPP, 0, 0);
    add(a.release + range(sx, 3, F.afterGroundMs[0], F.afterGroundMs[1]), T_GROUND, 0, 0);
    // Once the follow-through is over he is between balls again: his eyes go back to the idle dwell (P2).
    if (a.followEnd != null) {
      let t = Math.max(a.followEnd, a.release + F.afterGroundMs[1]) + rr(F.idleDwellMs.bowler);
      for (; t < a.end - 500; t += rr(F.idleDwellMs.bowler)) add(t, u() < F.idleGroundP ? T_GROUND : T_OPP, 0, 0);
    }
    return out;
  }
  let hand = false;
  for (let t = a.start + rr(F.strikerDwellMs); t < a.release - 500; t += rr(F.strikerDwellMs)) {
    hand = !hand && u() < F.strikerHandP;
    add(t, hand ? T_HAND : T_OPP, 0, 0);
  }
  add(a.release + range(sx, 0, F.lockOnMs[0], F.lockOnMs[1]), T_BALL, 1, lag);
  if (a.outcomeAt !== null) {
    // After the outcome (and not before): the ground for a wicket, a miss or a dot; back down the pitch, to the bowler, after a boundary.
    const row = a.outcome ? (P.react.table as Record<string, number[]>)[a.outcome] : undefined;
    add(a.outcomeAt + d[DRAW.reactionMs], row && u01(sx, 5) >= row[2] ? T_OPP : T_GROUND, 0, 0);
  } else if (a.dead !== null) add(a.dead + range(sx, 1, F.deadGroundMs[0], F.deadGroundMs[1]), T_GROUND, 0, 0);
  return out;
}

/** Microsaccades: Poisson in time, small, mostly horizontal. */
function micro(a: DirectorAnchors, bk: number): number[] {
  const G = P.gaze;
  const s = mix(bk, 31);
  const sa = mix(bk, 32);
  const out: number[] = [];
  let t = a.start;
  for (let k = 0; ; k++) {
    t += (-Math.log(1 - u01(s, 5 * k)) / G.microHz) * 1000;
    if (t >= a.end) break;
    const amp = lognorm(G.microMeanDeg, G.microCv, gauss(sa, k));
    const ang = u01(s, 5 * k + 2) < G.microHorizP ? (u01(s, 5 * k + 3) < 0.5 ? 0 : Math.PI) : u01(s, 5 * k + 4) * Math.PI * 2;
    out.push(t, amp * Math.cos(ang), amp * Math.sin(ang) * 0.6);
  }
  return out;
}

/**
 * Fidgets (P3): a stance adjust, a weight shift, a shoulder roll, a deep breath, one after another with log-normal gaps, every
 * parameter a draw of the ball's key at a fixed index (the anchors only say where they may fall: between balls, the whole
 * scene but its seam; in a delivery, the striker's waiting, until 1 s before the release; the bowler's run-up has none). A
 * fidget is zero inside the quiet windows (bake.ts gates it like the breath and the sway) and in Reduced Motion.
 */
function fidgets(a: DirectorAnchors, bk: number, amp: Float32Array): number[] {
  const F = P.fidget;
  const sg = mix(bk, 63);
  const sk = mix(bk, 64);
  const sa = mix(bk, 62);
  const out: number[] = [];
  const idle = a.release === null;
  if (!idle && a.role === 'bowler') return out;
  const lo = (a.seamMs ?? 0) > 0 ? a.start + (a.seamMs ?? 0) : a.start;
  const hi = idle ? a.end - F.idleEndMs : (a.release as number) - F.endBeforeReleaseMs;
  const gain = F.roleX[a.role] * amp[AMP.fidgetX];
  const [gapMean, gapCv] = F.gapS[a.role];
  let t = lo + range(sg, 1000, F.firstMs[0], F.firstMs[1]);
  const D = F.durMs;
  for (let k = 0; k < 400; k++) {
    const pick = u01(sk, k);
    const kind = pick < F.kindCum[0] ? FIDGET.weight : pick < F.kindCum[1] ? FIDGET.stance : pick < F.kindCum[2] ? FIDGET.shoulder : FIDGET.breath;
    const r = (i: number, lo2: number, hi2: number) => range(sa, 8 * k + i, lo2, hi2);
    const sgn = (i: number) => (u01(sa, 8 * k + i) < 0.5 ? -1 : 1);
    let dur: number;
    let b1: number;
    let b2: number;
    let b3: number;
    let dir = sgn(0);
    if (kind === FIDGET.weight) {
      dur = r(1, D.weight[0], D.weight[1]);
      b1 = dir * r(2, F.weight.swayMm[0], F.weight.swayMm[1]) * gain;
      b2 = dir * r(3, F.weight.rollDeg[0], F.weight.rollDeg[1]) * gain;
      b3 = 0;
    } else if (kind === FIDGET.stance) {
      dur = r(1, D.stance[0], D.stance[1]);
      b1 = dir * r(2, F.stance.swayZMm[0], F.stance.swayZMm[1]) * gain;
      b2 = sgn(4) * r(3, F.stance.twistDeg[0], F.stance.twistDeg[1]) * gain;
      b3 = r(5, F.stance.postureDeg[0], F.stance.postureDeg[1]) * gain;
    } else if (kind === FIDGET.shoulder) {
      dur = r(1, D.shoulder[0], D.shoulder[1]);
      b1 = r(2, F.shoulder.twistDeg[0], F.shoulder.twistDeg[1]) * gain;
      b2 = r(3, F.shoulder.postureDeg[0], F.shoulder.postureDeg[1]) * gain;
      b3 = F.shoulder.cycles;
    } else {
      dur = r(1, D.breath[0], D.breath[1]);
      b1 = r(2, F.breath.postureDeg[0], F.breath.postureDeg[1]) * gain;
      b2 = 0;
      b3 = 0;
      dir = 1;
    }
    if (t + dur > hi) break;
    out.push(t, kind, dur, b1, b2, b3, dir, 0);
    t += dur + 1000 * lognorm(gapMean, gapCv, gauss(sg, k));
  }
  return out;
}

/**
 * The reaction to the outcome (P3): none until the physics has confirmed it, then one event at `outcomeAt` plus the seeded 180 to
 * 380 ms (the same latency as the eyes' move). What the outcome decides is how much and which way (params react.table: valence,
 * strength); every other number is a draw of the key at a fixed index, so two outcomes of one ball differ only from that moment.
 * The bowler's valence is the opposite of the batter's and weaker.
 */
function reaction(a: DirectorAnchors, bk: number, d: Float32Array): number[] {
  const R = P.react;
  const row = a.outcomeAt !== null && a.outcome ? (R.table as Record<string, number[]>)[a.outcome] : undefined;
  if (!row || a.outcomeAt === null) return [];
  const sr = mix(bk, 71);
  const bowler = a.role === 'bowler';
  const v = row[0] * (bowler ? R.bowlerValenceX : 1);
  const s = row[1] * (bowler ? R.bowlerStrengthX : 1);
  const shake = v < -R.shakeFrom ? (u01(sr, 4) < 0.5 ? -1 : 1) * R.shakeDeg * -v * s : 0;
  const slow = a.reducedMotion ? P.expr.slowRm : 1;
  return [a.outcomeAt + d[DRAW.reactionMs], v, s, slow * range(sr, 0, R.riseMs[0], R.riseMs[1]), slow * range(sr, 1, R.holdMs[0], R.holdMs[1]), slow * range(sr, 2, R.decayMs[0], R.decayMs[1]), shake, range(sr, 3, R.shakeHz[0], R.shakeHz[1]), (v > 0 ? R.headUpDeg * v : -R.headDownDeg * v) * s, R.exhale * s, row[3] * s, row[4] * s];
}

/** The plan of one actor in one script. */
export function buildEvents(a: DirectorAnchors): DirectorEvents {
  const pk = personKey(a.person, a.role);
  const bk = ballKey(a.key, pk);
  const amp = persons(pk, a.role);
  const draw = draws(bk, amp);
  return {
    fix: Float32Array.from(fixations(a, bk, draw)),
    blink: Float32Array.from(blinks(a, bk, amp, taskWindow(a))),
    micro: Float32Array.from(micro(a, bk)),
    fidget: Float32Array.from(fidgets(a, bk, amp)),
    react: Float32Array.from(reaction(a, bk, draw)),
    draw,
    amp,
  };
}
