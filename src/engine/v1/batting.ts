/** Batting inputs: timing grades, shot and zone legality, and trace plausibility (engine v1). */
import type { BattingInput, DeliveryTiming, FieldZone, RevealedDelivery, ShotType, TimingGrade } from '@/contracts';
import { LATE_LIMIT_MS, LEGAL_ZONES, MAX_CLIENT_ELAPSED_MS, MIN_SWIPE, SECTOR_ZONES, SHOTS } from './tables';
import { checkTrace, sectorOf, sectorsAdjacent, swipeOf } from './traces';

/** Grade of a tap: signed error = tap − ideal contact. */
export function timingGrade(tapMs: number | null, timing: DeliveryTiming): TimingGrade {
  if (tapMs === null) return 'no_shot';
  const err = tapMs - timing.releaseToContactMs;
  const a = err < 0 ? -err : err;
  if (a <= timing.perfectMs) return 'perfect';
  if (a <= timing.goodMs) return 'good';
  if (a <= timing.edgeMs) return err < 0 ? 'early' : 'late';
  return err < 0 ? 'very_early' : 'very_late';
}

export function isLegalZone(shot: ShotType, zone: FieldZone | null): boolean {
  const legal = LEGAL_ZONES[shot];
  if (!legal) return false;
  if (legal.length === 0) return zone === null;
  return zone !== null && legal.includes(zone);
}

export function validateBattingInput(input: BattingInput, delivery: RevealedDelivery): { ok: true; input: BattingInput } | { ok: false; errors: string[] } {
  if (!input || typeof input !== 'object') return { ok: false, errors: ['input.missing'] };
  const errors: string[] = [];
  if (input.v !== 1) errors.push('input.version');
  if (input.ball !== delivery.ball) errors.push('input.ball_mismatch');
  if (!(SHOTS as readonly string[]).includes(input.shot)) errors.push('input.shot');
  else if (!isLegalZone(input.shot, input.zone)) errors.push(input.zone === null ? 'input.zone_required' : 'input.zone_not_allowed');

  const tap = input.tapMs;
  if (tap !== null) {
    if (typeof tap !== 'number' || !Number.isFinite(tap)) errors.push('input.tap_invalid');
    else if (tap < 0) errors.push('input.tap_before_release');
    else if (tap > delivery.timing.releaseToContactMs + LATE_LIMIT_MS) errors.push('input.tap_after_window');
  }
  const elapsed = input.clientElapsedMs;
  if (typeof elapsed !== 'number' || !Number.isFinite(elapsed) || elapsed < 0) errors.push('input.elapsed_invalid');
  else {
    if (elapsed > MAX_CLIENT_ELAPSED_MS) errors.push('input.elapsed_too_long');
    if (typeof tap === 'number' && Number.isFinite(tap) && elapsed < tap) errors.push('input.elapsed_before_tap');
  }

  const traceErrors = checkTrace(input.trace, 'batting');
  errors.push(...traceErrors.map((e) => `input.${e}`));
  if (!traceErrors.length) {
    const samples = input.trace.samples;
    if (tap !== null && samples.length === 0) errors.push('input.trace_missing_tap');
    if (samples.length && typeof elapsed === 'number' && samples[samples.length - 1][0] > elapsed) errors.push('input.trace_longer_than_elapsed');
    if (input.trace.pointer !== 'keyboard' && input.zone !== null && samples.length >= 2) {
      // Squared length: exact arithmetic, identical on every engine (verification re-runs this check).
      const sw = swipeOf(input.trace);
      if (sw.dx * sw.dx + sw.dy * sw.dy >= MIN_SWIPE * MIN_SWIPE) {
        const s = sectorOf(sw.dx, sw.dy);
        if (!sectorsAdjacent(s, SECTOR_ZONES.indexOf(input.zone))) errors.push('input.swipe_zone_mismatch');
      }
    }
  }
  if (errors.length) return { ok: false, errors };
  const clean: BattingInput = {
    v: 1,
    ball: input.ball,
    shot: input.shot,
    zone: input.zone,
    tapMs: input.tapMs,
    trace: { pointer: input.trace.pointer, samples: input.trace.samples.map((s) => [s[0], s[1], s[2]] as [number, number, number]) },
    clientElapsedMs: input.clientElapsedMs,
  };
  return { ok: true, input: clean };
}

/**
 * Innings-level timing audit for anti-cheat (the platform decides what to do with it). A human cannot hit the ideal
 * contact moment to within a few milliseconds ball after ball; a client that reads the revealed timing and taps
 * automatically does. `suspicious` when at least `SUPERHUMAN_TAPS` taps land within ±`SUPERHUMAN_TAP_MS` of ideal.
 */
export const SUPERHUMAN_TAP_MS = 3;
export const SUPERHUMAN_TAPS = 5;
export function timingAudit(pairs: ReadonlyArray<{ input: BattingInput; delivery: RevealedDelivery }>): { taps: number; bullseyes: number; meanAbsErrorMs: number; suspicious: boolean } {
  let taps = 0;
  let bullseyes = 0;
  let sum = 0;
  for (const { input, delivery } of pairs) {
    if (input.tapMs === null || input.shot === 'leave') continue;
    const err = Math.abs(input.tapMs - delivery.timing.releaseToContactMs);
    taps++;
    sum += err;
    if (err <= SUPERHUMAN_TAP_MS) bullseyes++;
  }
  return { taps, bullseyes, meanAbsErrorMs: taps ? Math.round((sum / taps) * 10) / 10 : 0, suspicious: bullseyes >= SUPERHUMAN_TAPS };
}
