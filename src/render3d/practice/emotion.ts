/**
 * The delivery's emotional rhythm (north star "Emotional authenticity", constitution §11–13), as signals for the sound,
 * the crowd, the haptics and the players' reactions. Everything here is derived from the resolved DeliveryResult (its
 * SimEvents, contact, outcome and the ball's own path) and the delivery's context, and it is computed after the physics
 * has decided: it can express the outcome, never influence it. Pure and deterministic in (input) → plan.
 *
 * Moments (StageMoment) are discrete and keyed to simulation time; the stage delivers each at its own performance
 * time, like a sound cue. The state (EmotionState) is a continuous function of scene time: the phase of the delivery,
 * how engaged the crowd is (arousal), whether it is glad or dismayed (valence; a home crowd behind the batter), and
 * how much it is expecting (the approach, the ball racing towards the rope).
 *
 *   approach     the run-up: a murmur rising with anticipation
 *   stride       the delivery stride: the hush, concentration before release
 *   flight       the ball travels: the collective breath (near silence)
 *   contact      the contact response: bright for a clean hit, an "ooh" for an edge or a play and miss
 *   chase        a hit travelling on: expectation rising as it nears the rope
 *   outcome      confirmed by the physics: controlled celebration for four, full release for six, shock and then
 *                silence after a wicket, relief after survival, a polite settle after a dot ball
 *   reflection   before the next ball: the crowd settles back to its murmur
 */
import type { ContactKind, DeliveryResult, Dismissal, SimEvent, SwingTiming, Vec3 } from '@/contracts/practice';
import { BOUNDARY_R, CONTACT_Z } from '../core/ground';
import { STUMPS_HALF_W, STUMPS_TOP } from '@/physics/geometry';
import { ballAt } from './frame';

export type StageMomentKind =
  | 'approach'
  | 'gather'
  | 'release'
  | 'pitch'
  | 'contact'
  | 'pad'
  | 'beaten'
  | 'carry'
  | 'fielded'
  | 'four'
  | 'six'
  | 'wicket'
  | 'survived'
  | 'dot'
  | 'runs'
  | 'dead'
  | 'reflection';

export interface StageMoment {
  kind: StageMomentKind;
  /** Simulation seconds from release (negative before it). */
  t: number;
  /** 0..1: how strong (a sweet-spot hit 1, a thin edge about 0.4; a close call by how close it was). */
  intensity: number;
  contact?: ContactKind;
  timing?: SwingTiming;
  dismissal?: Dismissal;
  runs?: number;
  /** Where it happened (physics frame: the striker's own, right-handed). */
  at?: Vec3;
}

export type EmotionPhase = 'between' | 'approach' | 'stride' | 'flight' | 'contact' | 'chase' | 'outcome' | 'reflection';
export type EmotionOutcome = 'four' | 'six' | 'wicket' | 'close_call' | 'runs' | 'dot' | 'leave' | null;

export interface EmotionState {
  phase: EmotionPhase;
  /** 0 hushed … 1 the stadium at full voice. */
  arousal: number;
  /** −1 dismay … +1 joy, for a home crowd behind the batter. */
  valence: number;
  /** 0..1: expectation building (the approach, a ball racing to the rope). */
  expectation: number;
  /** The outcome from the moment the physics confirms it (null before). */
  outcome: EmotionOutcome;
  /** The delivery's pressure (context), 0..1. */
  pressure: number;
}

interface EmotionContext {
  pressure?: number;
  milestone?: 'fifty' | 'hundred' | null;
  wicketEndsInnings?: boolean;
}

/** A moment placed on the scene clock (ms), in time order. */
interface PlannedMoment extends StageMoment {
  scene: number;
}

interface Key {
  scene: number;
  arousal: number;
  valence: number;
  expectation: number;
}

export interface EmotionPlan {
  moments: PlannedMoment[];
  keys: Key[];
  /** Scene ms at which each phase begins, in order. */
  phases: Array<{ scene: number; phase: EmotionPhase }>;
  /** Scene ms from which the outcome is confirmed, and the outcome. */
  outcomeAt: number;
  outcome: EmotionOutcome;
  pressure: number;
}

/** Timing of the rhythm around the release and the dead ball (ms). */
const EMOTION = {
  /** The hush begins this long before release (the delivery stride). */
  strideMs: 450,
  /** After dead ball the crowd reflects, then settles to its murmur. */
  reflectAfterMs: 1800,
  settleMs: 4200,
  /** Between balls. */
  murmur: 0.3,
  hush: 0.12,
  breath: 0.07,
} as const;

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const first = <K extends SimEvent['kind']>(r: DeliveryResult, kind: K) => r.events.find((e) => e.kind === kind) as Extract<SimEvent, { kind: K }> | undefined;

/** How clean a bat contact was, 0..1 (the sweet spot is 1, a thin edge about 0.35). */
function contactQuality(kind: ContactKind, timing: SwingTiming): number {
  if (kind === 'middle') return timing === 'perfect' ? 1 : timing === 'solid' ? 0.8 : 0.55;
  if (kind === 'inside_edge' || kind === 'leading_edge') return 0.45;
  if (kind === 'outside_edge' || kind === 'top_edge') return 0.35;
  return 0;
}

/**
 * How close an unhit ball came to the stumps (0 far … 1 grazing): the flight at the stumps plane against the wicket,
 * from the physics samples. A ball that would hit them is 1.
 */
function stumpsCloseness(result: DeliveryResult): number {
  const f = result.flight;
  if (f.wouldHitStumps) return 1;
  const p = ballAt(f.samples, f.stumpsT);
  if (!p) return 0;
  const dx = Math.max(0, Math.abs(p.x) - STUMPS_HALF_W);
  const dy = Math.max(0, p.y - STUMPS_TOP);
  const d = Math.hypot(dx, dy);
  return clamp01(1 - d / 0.22);
}

/** The outcome as the crowd reads it (physics outcome, contact and closeness). */
function outcomeOf(result: DeliveryResult): EmotionOutcome {
  const o = result.outcome;
  if (o.dismissal) return 'wicket';
  if (o.boundary === 6) return 'six';
  if (o.boundary === 4) return 'four';
  const c = result.contact.kind;
  const edged = c === 'inside_edge' || c === 'outside_edge' || c === 'top_edge' || c === 'leading_edge';
  const shout = (c === 'pad' || c === 'body') && result.lbw !== null && !result.lbw.out;
  if (c === 'miss' || edged || shout || (c === 'leave' && stumpsCloseness(result) > 0.4)) return 'close_call';
  if (o.runs > 0) return 'runs';
  return c === 'leave' ? 'leave' : 'dot';
}

/** Scene ms at which the physics has confirmed the outcome (the boundary, the stumps, the catch, the decision). */
function confirmedAt(result: DeliveryResult, sceneOf: (t: number) => number): number {
  const b = first(result, 'boundary');
  if (b) return sceneOf(b.t);
  const s = first(result, 'stumps');
  if (s && result.outcome.dismissal === 'bowled') return sceneOf(s.t);
  const c = first(result, 'catch');
  if (c && result.outcome.dismissal) return sceneOf(c.t);
  if (result.outcome.dismissal === 'lbw') {
    const pad = result.events.find((e) => e.kind === 'pad' || (e.kind === 'contact' && (e.contact === 'pad' || e.contact === 'body')));
    // The umpire's decision follows the appeal (the umpire's signal in practice/script.ts is at the same moment).
    return sceneOf((pad?.t ?? result.deadT) + LBW_DECISION_S);
  }
  return sceneOf(result.deadT);
}

/** The umpire gives an LBW this long after the ball hits the pad (s). */
const LBW_DECISION_S = 0.9;

/** Distance progress (0..1) of the ball from the striker towards the rope along its own bearing, at time t (s). */
function ropeProgress(result: DeliveryResult, t: number): number {
  const p = ballAt(result.ball, t);
  if (!p) return 0;
  const dx = p.x;
  const dz = p.z - CONTACT_Z;
  const d = Math.hypot(dx, dz);
  if (d < 0.5) return 0;
  // Where the ray from the striker along (dx, dz) meets the rope.
  const ux = dx / d;
  const uz = dz / d;
  const b = ux * 0 + uz * CONTACT_Z;
  const toRope = -b + Math.sqrt(Math.max(0, b * b - (CONTACT_Z * CONTACT_Z - BOUNDARY_R * BOUNDARY_R)));
  return clamp01(d / Math.max(1, toRope));
}

export interface EmotionInput {
  releaseScene: number;
  /** null: between balls, or the delivery before its result is known. */
  result: DeliveryResult | null;
  /** True once a delivery has started (the run-up), false between balls. */
  delivery: boolean;
  context?: EmotionContext;
  /** Scene length (ms). */
  duration: number;
}

/** Builds the delivery's emotion plan. */
export function buildEmotion(input: EmotionInput): EmotionPlan {
  const { releaseScene: R, result } = input;
  const pressure = clamp01(input.context?.pressure ?? 0);
  const k = 1 + 0.35 * pressure;
  const sceneOf = (t: number) => R + t * 1000;
  const keys: Key[] = [];
  const moments: PlannedMoment[] = [];
  const phases: EmotionPlan['phases'] = [];
  const key = (scene: number, arousal: number, valence: number, expectation: number) => keys.push({ scene, arousal: clamp01(arousal), valence: Math.max(-1, Math.min(1, valence)), expectation: clamp01(expectation) });
  const moment = (m: Omit<PlannedMoment, 'scene'>) => moments.push({ ...m, scene: sceneOf(m.t) });
  if (!input.delivery) {
    key(0, EMOTION.murmur, 0, 0);
    key(input.duration, EMOTION.murmur, 0, 0);
    return { moments, keys, phases: [{ scene: 0, phase: 'between' }], outcomeAt: Number.POSITIVE_INFINITY, outcome: null, pressure };
  }
  // Approach, stride, flight: the same for every ball (nothing here may hint at what is coming).
  const stride = R - EMOTION.strideMs;
  phases.push({ scene: 0, phase: 'approach' }, { scene: stride, phase: 'stride' }, { scene: R, phase: 'flight' });
  key(0, EMOTION.murmur, 0, 0.15);
  key(stride, Math.min(0.62, 0.42 * k), 0, 0.6 + 0.25 * pressure);
  key(R - 150, EMOTION.hush / k, 0, 0.72 + 0.2 * pressure);
  key(R + 60, EMOTION.breath / k, 0, 0.78 + 0.2 * pressure);
  moment({ kind: 'approach', t: -R / 1000, intensity: 0.4 + 0.4 * pressure });
  moment({ kind: 'gather', t: -EMOTION.strideMs / 1000, intensity: 0.5 + 0.5 * pressure });
  moment({ kind: 'release', t: 0, intensity: 1 });
  if (!result) {
    // The result is not known yet: hold the breath (the plan is rebuilt when it arrives).
    key(input.duration, EMOTION.breath / k, 0, 0.78);
    return { moments: sortMoments(moments), keys, phases, outcomeAt: Number.POSITIVE_INFINITY, outcome: null, pressure };
  }
  const bounce = first(result, 'bounce');
  if (bounce) moment({ kind: 'pitch', t: bounce.t, intensity: 0.6, at: bounce.p });
  const c = result.contact;
  const outcome = outcomeOf(result);
  const outcomeAt = confirmedAt(result, sceneOf);
  const dead = sceneOf(result.deadT);
  const hitT = c.t ?? result.flight.idealContactT;
  const touched = c.t !== null && c.kind !== 'miss' && c.kind !== 'leave';
  const batHit = touched && c.kind !== 'pad' && c.kind !== 'body';
  const contactScene = sceneOf(hitT);
  phases.push({ scene: contactScene, phase: 'contact' });
  if (batHit) {
    const q = contactQuality(c.kind, c.timing);
    moment({ kind: 'contact', t: hitT, intensity: q, contact: c.kind, timing: c.timing, at: c.point ?? undefined });
    const edge = c.kind !== 'middle';
    key(contactScene, EMOTION.breath / k, 0, 0.8);
    key(contactScene + 120, (edge ? 0.5 : 0.32 + 0.3 * q) * k, edge ? -0.25 : 0.25 + 0.2 * q, 0.6);
    // A hit travelling on: expectation follows the ball towards the rope until something confirms what happened.
    const stopT = Math.min(result.deadT, (outcomeAt - R) / 1000, (first(result, 'field')?.t ?? Infinity) + 0.05, (first(result, 'catch')?.t ?? Infinity) + 0.05);
    if (stopT > hitT + 0.3 && !(outcome === 'dot' && (c.exitSpeedKph ?? 0) < 25)) {
      phases.push({ scene: contactScene + 300, phase: 'chase' });
      for (let t = hitT + 0.3; t < stopT; t += 0.15) {
        const p = ropeProgress(result, t);
        key(sceneOf(t), (0.32 + 0.55 * p * p) * k, 0.15 + 0.45 * p, 0.35 + 0.6 * p);
        // Only progress already reached can prompt a crowd response; a later boundary must not leak at contact.
        if (p > 0.45 && !moments.some((m) => m.kind === 'carry')) moment({ kind: 'carry', t, intensity: p });
      }
    }
  } else if (c.kind === 'pad' || c.kind === 'body') {
    moment({ kind: 'pad', t: hitT, intensity: 0.55, contact: c.kind, at: c.point ?? undefined });
    key(contactScene + 100, 0.45 * k, -0.15, 0.7);
  } else {
    // A leave or a play and miss: an "ooh" when it beat the bat or passed close to the stumps.
    const close = c.kind === 'miss' ? Math.max(0.55, stumpsCloseness(result)) : stumpsCloseness(result);
    const passT = c.kind === 'miss' ? hitT : result.flight.stumpsT;
    if (close > 0.4 && !result.outcome.dismissal) {
      moment({ kind: 'beaten', t: passT, intensity: close, contact: c.kind });
      key(sceneOf(passT), EMOTION.breath / k, 0, 0.8);
      key(sceneOf(passT) + 140, (0.3 + 0.35 * close) * k, -0.3 * close, 0.4);
    } else key(sceneOf(passT) + 140, 0.16, 0, 0.2);
  }
  for (const e of result.events) if (e.kind === 'field') moment({ kind: 'fielded', t: e.t, intensity: 0.5, at: e.p });
  // The confirmed outcome.
  // Hold the latest causal state to confirmation. Linear interpolation directly towards the outcome key would
  // begin celebrating a four/six (or showing dismay at a catch) while the ball was still travelling.
  const prior = [...keys].filter((entry) => entry.scene < outcomeAt).sort((a, b) => a.scene - b.scene).at(-1);
  if (prior && outcomeAt > prior.scene) key(outcomeAt - 0.001, prior.arousal, prior.valence, prior.expectation);
  phases.push({ scene: outcomeAt, phase: 'outcome' });
  const runs = result.outcome.runs;
  switch (outcome) {
    case 'six':
      moment({ kind: 'six', t: (outcomeAt - R) / 1000, intensity: 1, runs: 6, at: first(result, 'boundary')?.p });
      key(outcomeAt, 1, 1, 0);
      key(outcomeAt + 4800, 0.62, 0.6, 0);
      break;
    case 'four':
      moment({ kind: 'four', t: (outcomeAt - R) / 1000, intensity: 0.82, runs: 4, at: first(result, 'boundary')?.p });
      key(outcomeAt, 0.84, 0.8, 0);
      key(outcomeAt + 3500, 0.5, 0.45, 0);
      break;
    case 'wicket': {
      moment({ kind: 'wicket', t: (outcomeAt - R) / 1000, intensity: 1, dismissal: result.outcome.dismissal ?? undefined });
      // Shock, then the silence of a damaging dismissal (in Practice a wicket ends the innings).
      const damaging = input.context?.wicketEndsInnings ?? true;
      key(outcomeAt, 0.78, -0.9, 0);
      key(outcomeAt + 900, damaging ? 0.06 : 0.25, -1, 0);
      key(outcomeAt + 4000, damaging ? 0.1 : 0.28, -0.6, 0);
      break;
    }
    case 'close_call':
      moment({ kind: 'survived', t: (outcomeAt - R) / 1000, intensity: 0.6, runs });
      key(outcomeAt, 0.42, 0.25, 0);
      key(outcomeAt + 2400, 0.32, 0.1, 0);
      break;
    case 'runs':
      moment({ kind: 'runs', t: (outcomeAt - R) / 1000, intensity: Math.min(1, 0.4 + runs * 0.15), runs });
      key(outcomeAt, 0.42 + 0.06 * runs, 0.3, 0);
      key(outcomeAt + 2400, 0.32, 0.1, 0);
      break;
    default:
      moment({ kind: 'dot', t: (outcomeAt - R) / 1000, intensity: 0.3, runs: 0 });
      key(outcomeAt, 0.24, 0.05, 0);
      break;
  }
  moment({ kind: 'dead', t: result.deadT, intensity: 0 });
  const reflect = Math.max(dead, outcomeAt) + EMOTION.reflectAfterMs;
  phases.push({ scene: reflect, phase: 'reflection' });
  moment({ kind: 'reflection', t: (reflect - R) / 1000, intensity: 0.3 });
  const settled = outcome === 'wicket' ? 0.12 : EMOTION.murmur;
  key(reflect + EMOTION.settleMs, settled, 0, 0);
  key(Math.max(input.duration, reflect + EMOTION.settleMs + 1), settled, 0, 0);
  keys.sort((a, b) => a.scene - b.scene);
  return { moments: sortMoments(moments), keys, phases: phases.sort((a, b) => a.scene - b.scene), outcomeAt, outcome, pressure };
}

function sortMoments(m: PlannedMoment[]): PlannedMoment[] {
  return m.sort((a, b) => a.scene - b.scene);
}

/** The emotion state at scene time t (pure; piecewise-linear between keys). */
export function emotionAt(plan: EmotionPlan, t: number): EmotionState {
  const k = plan.keys;
  let a = k[0] ?? { scene: 0, arousal: EMOTION.murmur, valence: 0, expectation: 0 };
  let b = a;
  for (let i = 0; i < k.length; i++) {
    if (k[i].scene <= t) a = k[i];
    if (k[i].scene >= t) {
      b = k[i];
      break;
    }
    b = k[i];
  }
  const u = b.scene > a.scene ? clamp01((t - a.scene) / (b.scene - a.scene)) : 0;
  let phase: EmotionPhase = plan.phases[0]?.phase ?? 'between';
  for (const p of plan.phases) if (p.scene <= t) phase = p.phase;
  return {
    phase,
    arousal: a.arousal + (b.arousal - a.arousal) * u,
    valence: a.valence + (b.valence - a.valence) * u,
    expectation: a.expectation + (b.expectation - a.expectation) * u,
    outcome: t >= plan.outcomeAt ? plan.outcome : null,
    pressure: plan.pressure,
  };
}

/** The crowd envelope ([scene ms, level]) for sinks that only follow a level (src/audio's crowd bed). */
export function crowdKeys(plan: EmotionPlan): Array<[number, number]> {
  return plan.keys.map((k) => [k.scene, k.arousal] as [number, number]);
}
