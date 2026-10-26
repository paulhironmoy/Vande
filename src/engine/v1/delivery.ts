/**
 * What the batter sees: flight timing windows and the presentation path, deterministic from the delivery and the
 * conditions (engine v1). The executed path used in the replay adds the bowler's execution error on top.
 */
import type { BallPath, Conditions, DeliveryPlan, DeliveryTiming, ExecutionGrade, OverPlan, RevealedDelivery } from '@/contracts';
import { SUPER_BALL_INDEX } from '@/contracts/cricket';
import type { Sfc32 } from '../prng';
import {
  BOUNCE_AT,
  BOUNCER_BOUNCE_AT,
  BOUNCER_HEIGHT,
  DRAG,
  EDGE_MULT,
  FAMILY,
  FLIGHT_DISTANCE_M,
  GOOD_MULT,
  HEIGHT_AT_BAT,
  INTENSITY_WINDOW,
  LENGTH_TIME,
  LINE_AT_BAT,
  PERFECT_MS,
  PITCH_BOUNCE,
  PITCH_TIME,
  PITCH_WINDOW,
  SPEED_KPH,
  SPIN_TURN_INTENSITY,
  SWING_M,
  SWING_PITCH,
  SWING_WEATHER,
  TURN_M,
  TURN_PITCH,
  TURN_WEATHER,
  VARIANT_TIME,
  VARIANT_WINDOW,
  WEATHER_TIME,
  WEATHER_WINDOW,
  YORKER_BOUNCE_AT,
  YORKER_HEIGHT,
} from './tables';

type Core = Omit<DeliveryPlan, 'gesture'>;

const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;

export function speedKph(d: Core): number {
  return SPEED_KPH[d.variant][d.intensity - 1];
}

export function deliveryTiming(d: Core, c: Conditions): DeliveryTiming {
  const family = FAMILY[d.variant];
  const mps = speedKph(d) / 3.6;
  const factor = DRAG[family] * LENGTH_TIME[d.length] * (VARIANT_TIME[d.variant] ?? 1) * PITCH_TIME[c.pitch] * (family === 'spin' ? 1 : WEATHER_TIME[c.weather]);
  const releaseToContactMs = Math.round(((FLIGHT_DISTANCE_M / mps) * 1000 * factor));
  const perfect = PERFECT_MS[family] * INTENSITY_WINDOW[d.intensity] * (VARIANT_WINDOW[d.variant] ?? 1) * PITCH_WINDOW[c.pitch] * WEATHER_WINDOW[c.weather];
  const perfectMs = Math.round(perfect);
  const goodMs = Math.round(perfect * GOOD_MULT);
  const edgeMs = Math.round(perfect * GOOD_MULT * EDGE_MULT);
  return { releaseToContactMs, perfectMs, goodMs, edgeMs };
}

export function deliveryPath(d: Core, c: Conditions): BallPath {
  const family = FAMILY[d.variant];
  const spin = family === 'spin';
  let bounceAtM = BOUNCE_AT[family][d.length];
  let height = HEIGHT_AT_BAT[family][d.length];
  if (d.variant === 'yorker') {
    bounceAtM = YORKER_BOUNCE_AT;
    height = YORKER_HEIGHT;
  } else if (d.variant === 'bouncer') {
    bounceAtM = BOUNCER_BOUNCE_AT;
    height = BOUNCER_HEIGHT * (d.intensity === 3 ? 1.05 : 1);
  }
  height *= PITCH_BOUNCE[c.pitch];
  let swing = SWING_M[d.variant] ?? 0;
  if (d.variant === 'inswing' || d.variant === 'outswing') {
    swing *= SWING_PITCH[c.pitch] * SWING_WEATHER[c.weather] * (d.intensity === 1 ? 1.1 : d.intensity === 3 ? 0.85 : 1);
  } else if (d.variant === 'good_length') {
    const seam = d.line === 'wide_off' ? 0.05 : d.line === 'off' ? 0.04 : -0.03;
    swing = seam * (c.pitch === 'green' ? 2 : 1);
  }
  let turn = TURN_M[d.variant] ?? 0;
  if (spin) turn *= TURN_PITCH[c.pitch] * TURN_WEATHER[c.weather] * SPIN_TURN_INTENSITY[d.intensity];
  if (d.variant === 'slower' && c.pitch === 'slow') turn = d.line === 'leg' ? 0.03 : -0.03;
  const releaseHeightM = spin ? (d.variant === 'offspin' ? 1.95 : 1.9) : family === 'swing' ? 2.12 : d.variant === 'slower' ? 2.15 : 2.2 + 0.02 * (d.intensity - 2);
  const spinRpm = spin
    ? (d.variant === 'offspin' ? 2100 : 2300) + (d.intensity === 1 ? 300 : d.intensity === 3 ? -300 : 0)
    : d.variant === 'slower'
      ? 1200
      : family === 'swing'
        ? 700
        : 650 + 50 * d.intensity;
  return {
    speedKph: r1(speedKph(d)),
    releaseHeightM: r2(releaseHeightM),
    bounceAtM: r2(bounceAtM),
    lineAtBatM: r2(LINE_AT_BAT[d.line]),
    swingM: r2(swing),
    turnM: r2(turn),
    heightAtBatM: r2(height),
    spinRpm: Math.round(spinRpm),
    seamUpright: !spin && d.variant !== 'slower',
  };
}

/** The delivery actually bowled: a loose ball misses its mark (over-pitched, dragged short, or drifting on the pads). */
export function executedPath(path: BallPath, d: Core, grade: ExecutionGrade, rng: Sfc32): BallPath {
  const u = rng.float();
  const v = rng.float();
  if (grade === 'perfect') return path;
  if (grade === 'good') return { ...path, lineAtBatM: r2(path.lineAtBatM + (u - 0.5) * 0.06), bounceAtM: r2(path.bounceAtM + (v - 0.5) * 0.4) };
  const family = FAMILY[d.variant];
  let bounceAtM: number;
  let heightAtBatM: number;
  if (d.variant === 'yorker' || (d.length === 'full' && u < 0.5)) {
    bounceAtM = family === 'spin' ? 17.6 : 17;
    heightAtBatM = 0.45;
  } else if (d.variant === 'bouncer' || d.length === 'short' || u < 0.5) {
    bounceAtM = family === 'spin' ? 11.8 : 11.5;
    heightAtBatM = family === 'spin' ? 0.85 : 1.05;
  } else {
    bounceAtM = family === 'spin' ? 16.9 : 15.8;
    heightAtBatM = 0.55;
  }
  return {
    ...path,
    bounceAtM: r2(bounceAtM),
    heightAtBatM: r2(heightAtBatM),
    lineAtBatM: r2(v < 0.5 ? path.lineAtBatM - 0.16 : path.lineAtBatM + 0.16),
    swingM: r2(path.swingM * 0.5),
    turnM: r2(path.turnM * 0.6),
  };
}

export function planDelivery(plan: OverPlan, ball: number): DeliveryPlan {
  if (ball === SUPER_BALL_INDEX) return plan.superBall;
  if (!Number.isInteger(ball) || ball < 0 || ball > 5) throw new Error(`engine: no delivery ${ball}`);
  return plan.balls[ball];
}

export function revealDelivery(plan: OverPlan, ball: number, conditions: Conditions): RevealedDelivery {
  const d = planDelivery(plan, ball);
  return {
    ball,
    variant: d.variant,
    family: FAMILY[d.variant],
    line: d.line,
    length: d.length,
    intensity: d.intensity,
    timing: deliveryTiming(d, conditions),
    path: deliveryPath(d, conditions),
  };
}
