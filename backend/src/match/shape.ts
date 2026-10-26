/**
 * Structural checks on untrusted plans and inputs before they reach the engine (which then applies the real rules),
 * and sanitisers on engine outputs before they leave the server: only the contract's fields are ever copied, so an
 * engine that accidentally attached a sealed field (intent, gesture, execution, runs) could not leak it.
 */
import { MAX_TRACE_SAMPLES } from '@/contracts';
import type { BattingInput, DeliveryPlan, InputTrace, OverPlan, RevealedDelivery, ShotFeedback } from '@/contracts';

const POINTERS = new Set(['touch', 'mouse', 'pen', 'keyboard']);
const VARIANTS = new Set(['yorker', 'good_length', 'bouncer', 'slower', 'inswing', 'outswing', 'offspin', 'legspin']);
const LINES = new Set(['wide_off', 'off', 'middle', 'leg']);
const LENGTHS = new Set(['full', 'good', 'short']);
const INTENTS = new Set(['attack', 'contain', 'setup']);
const FIELDS = new Set(['attacking', 'balanced', 'sweeper']);
const SHOTS = new Set(['defend', 'rotate', 'drive', 'cut_pull', 'sweep', 'loft', 'leave']);
const ZONES = new Set(['third_man', 'point', 'cover', 'mid_off', 'mid_on', 'midwicket', 'square_leg', 'fine_leg']);

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** A trace with 0..MAX_TRACE_SAMPLES samples (a leave has none; bowling gestures need at least one). */
export function cleanTrace(x: unknown, minSamples = 0): InputTrace | null {
  if (!isObj(x) || !POINTERS.has(x.pointer as string) || !Array.isArray(x.samples)) return null;
  if (x.samples.length < minSamples || x.samples.length > MAX_TRACE_SAMPLES) return null;
  const samples: Array<[number, number, number]> = [];
  for (const s of x.samples) {
    if (!Array.isArray(s) || s.length !== 3 || !finite(s[0]) || !finite(s[1]) || !finite(s[2])) return null;
    samples.push([s[0], s[1], s[2]]);
  }
  return { pointer: x.pointer as InputTrace['pointer'], samples };
}

function cleanDelivery(x: unknown): DeliveryPlan | null {
  if (!isObj(x)) return null;
  if (!VARIANTS.has(x.variant as string) || !LINES.has(x.line as string) || !LENGTHS.has(x.length as string) || !INTENTS.has(x.intent as string)) return null;
  if (x.intensity !== 1 && x.intensity !== 2 && x.intensity !== 3) return null;
  const gesture = cleanTrace(x.gesture, 1);
  if (!gesture) return null;
  return { variant: x.variant as DeliveryPlan['variant'], line: x.line as DeliveryPlan['line'], length: x.length as DeliveryPlan['length'], intensity: x.intensity, intent: x.intent as DeliveryPlan['intent'], gesture };
}

export function cleanOverPlan(x: unknown): OverPlan | null {
  if (!isObj(x) || x.v !== 1 || !FIELDS.has(x.field as string) || !Array.isArray(x.balls) || x.balls.length !== 6) return null;
  const balls = x.balls.map(cleanDelivery);
  const superBall = cleanDelivery(x.superBall);
  if (balls.some((b) => b === null) || !superBall) return null;
  return { v: 1, field: x.field as OverPlan['field'], balls: balls as OverPlan['balls'], superBall };
}

export function cleanBattingInput(x: unknown): BattingInput | null {
  if (!isObj(x) || x.v !== 1 || !Number.isInteger(x.ball) || !SHOTS.has(x.shot as string)) return null;
  if (x.zone !== null && !ZONES.has(x.zone as string)) return null;
  if (x.tapMs !== null && !finite(x.tapMs)) return null;
  if (!finite(x.clientElapsedMs) || x.clientElapsedMs < 0) return null;
  const trace = cleanTrace(x.trace);
  if (!trace) return null;
  return { v: 1, ball: x.ball as number, shot: x.shot as BattingInput['shot'], zone: x.zone as BattingInput['zone'], tapMs: x.tapMs as number | null, trace, clientElapsedMs: x.clientElapsedMs };
}

/** Exactly the RevealedDelivery fields (never intent, gesture or execution). */
export function publicDelivery(d: RevealedDelivery): RevealedDelivery {
  return {
    ball: d.ball,
    variant: d.variant,
    family: d.family,
    line: d.line,
    length: d.length,
    intensity: d.intensity,
    timing: { releaseToContactMs: d.timing.releaseToContactMs, perfectMs: d.timing.perfectMs, goodMs: d.timing.goodMs, edgeMs: d.timing.edgeMs },
    path: {
      speedKph: d.path.speedKph,
      releaseHeightM: d.path.releaseHeightM,
      bounceAtM: d.path.bounceAtM,
      lineAtBatM: d.path.lineAtBatM,
      swingM: d.path.swingM,
      turnM: d.path.turnM,
      heightAtBatM: d.path.heightAtBatM,
      spinRpm: d.path.spinRpm,
      seamUpright: d.path.seamUpright,
    },
  };
}

/** Exactly the ShotFeedback fields (never runs, wickets or the fielder). */
export function publicFeedback(f: ShotFeedback): ShotFeedback {
  return { ball: f.ball, timing: f.timing, contact: f.contact };
}

export function isConditions(x: unknown): x is { pitch: 'green' | 'hard' | 'slow'; weather: 'clear' | 'humid' | 'dew' } {
  return isObj(x) && ['green', 'hard', 'slow'].includes(x.pitch as string) && ['clear', 'humid', 'dew'].includes(x.weather as string) && Object.keys(x).length === 2;
}
