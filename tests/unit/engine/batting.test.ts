// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { BattingInput, RevealedDelivery } from '@/contracts';
import { deliveryPath, deliveryTiming, engine, timingAudit, timingGrade } from '@/engine';
import { rngFromKey } from '@/engine/prng';
import { battingInputFor } from '@/engine/v1/policies';
import { LATE_LIMIT_MS, LEGAL_ZONES, SHOTS, VARIANTS } from '@/engine/v1/tables';
import { CONDITIONS, clone, randomInput, randomPlan } from './helpers';

const conditions = { pitch: 'green', weather: 'clear' } as const;
const plan = randomPlan(rngFromKey('batting-plan'));
const delivery: RevealedDelivery = engine.revealDelivery(plan, 2, conditions);
const rng = rngFromKey('batting-inputs');
const good = (): BattingInput => battingInputFor(rng, delivery, 'drive', 'cover', delivery.timing.releaseToContactMs + 10);

const errorsOf = (input: BattingInput, d = delivery) => {
  const r = engine.validateBattingInput(input, d);
  return r.ok ? [] : r.errors;
};

describe('revealDelivery', () => {
  it('reveals what the batter may see, deterministically from the delivery and conditions', () => {
    for (let b = 0; b <= 6; b++) {
      const r = engine.revealDelivery(plan, b, conditions);
      const src = b === 6 ? plan.superBall : plan.balls[b];
      expect(r).toEqual(engine.revealDelivery(clone(plan), b, conditions));
      expect(r.ball).toBe(b);
      expect([r.variant, r.line, r.length, r.intensity]).toEqual([src.variant, src.line, src.length, src.intensity]);
      expect(r).not.toHaveProperty('intent');
      expect(r).not.toHaveProperty('gesture');
    }
    expect(() => engine.revealDelivery(plan, 7, conditions)).toThrow();
  });

  it('produces ordered timing windows and plausible paths for every delivery and condition', () => {
    for (const c of CONDITIONS)
      for (const variant of VARIANTS)
        for (const intensity of [1, 2, 3] as const) {
          const core = { variant, line: 'off' as const, length: variant === 'bouncer' ? ('short' as const) : ('full' as const), intensity, intent: 'attack' as const };
          const t = deliveryTiming(core, c);
          expect(t.perfectMs).toBeGreaterThan(15);
          expect(t.perfectMs).toBeLessThan(t.goodMs);
          expect(t.goodMs).toBeLessThan(t.edgeMs);
          expect(t.releaseToContactMs).toBeGreaterThan(400);
          expect(t.releaseToContactMs).toBeLessThan(1100);
          const p = deliveryPath(core, c);
          expect(p.speedKph).toBeGreaterThan(70);
          expect(p.speedKph).toBeLessThan(150);
          expect(p.bounceAtM).toBeGreaterThan(9);
          expect(p.bounceAtM).toBeLessThan(20.12);
          expect(p.heightAtBatM).toBeGreaterThan(0);
        }
    const express = deliveryTiming({ variant: 'yorker', line: 'off', length: 'full', intensity: 3, intent: 'attack' }, conditions);
    const changeUp = deliveryTiming({ variant: 'yorker', line: 'off', length: 'full', intensity: 1, intent: 'attack' }, conditions);
    expect(express.releaseToContactMs).toBeLessThan(changeUp.releaseToContactMs);
    expect(express.perfectMs).toBeLessThan(changeUp.perfectMs);
  });
});

describe('timing grades', () => {
  it('grades a tap by its distance from the ideal contact moment', () => {
    const t = { releaseToContactMs: 500, perfectMs: 30, goodMs: 78, edgeMs: 156 };
    expect(timingGrade(500, t)).toBe('perfect');
    expect(timingGrade(530, t)).toBe('perfect');
    expect(timingGrade(531, t)).toBe('good');
    expect(timingGrade(422, t)).toBe('good');
    expect(timingGrade(421, t)).toBe('early');
    expect(timingGrade(656, t)).toBe('late');
    expect(timingGrade(657, t)).toBe('very_late');
    expect(timingGrade(100, t)).toBe('very_early');
    expect(timingGrade(null, t)).toBe('no_shot');
  });
});

describe('validateBattingInput', () => {
  it('accepts well-formed inputs for every legal shot and zone and returns a clean copy', () => {
    for (const shot of SHOTS)
      for (const zone of LEGAL_ZONES[shot].length ? LEGAL_ZONES[shot] : [null]) {
        const input = battingInputFor(rng, delivery, shot, zone, shot === 'leave' ? null : delivery.timing.releaseToContactMs);
        const r = engine.validateBattingInput({ ...input, junk: true } as BattingInput, delivery);
        expect(r.ok, `${shot} ${zone}`).toBe(true);
        if (r.ok) expect(r.input).toEqual(input);
      }
    for (let i = 0; i < 300; i++) expect(errorsOf(randomInput(rng, delivery))).toEqual([]);
  });

  it('rejects taps before the release and after the window', () => {
    expect(errorsOf({ ...good(), tapMs: -5 })).toContain('input.tap_before_release');
    expect(errorsOf({ ...good(), tapMs: delivery.timing.releaseToContactMs + LATE_LIMIT_MS + 1, clientElapsedMs: 5000 })).toContain('input.tap_after_window');
    expect(errorsOf({ ...good(), tapMs: Number.NaN })).toContain('input.tap_invalid');
  });

  it('rejects illegal shots and zones', () => {
    expect(errorsOf({ ...good(), shot: 'hook' as BattingInput['shot'] })).toContain('input.shot');
    expect(errorsOf({ ...good(), zone: 'fine_leg' })).toContain('input.zone_not_allowed');
    expect(errorsOf({ ...good(), zone: null })).toContain('input.zone_required');
    expect(errorsOf({ ...good(), shot: 'defend', zone: 'cover' })).toContain('input.zone_not_allowed');
  });

  it('rejects wrong versions, wrong balls and impossible client timing', () => {
    expect(errorsOf({ ...good(), v: 2 as 1 })).toContain('input.version');
    expect(errorsOf({ ...good(), ball: 3 })).toContain('input.ball_mismatch');
    expect(errorsOf({ ...good(), clientElapsedMs: -1 })).toContain('input.elapsed_invalid');
    expect(errorsOf({ ...good(), clientElapsedMs: 10 })).toEqual(expect.arrayContaining(['input.elapsed_before_tap']));
    expect(errorsOf({ ...good(), clientElapsedMs: 700_000 })).toContain('input.elapsed_too_long');
    expect(errorsOf(null as unknown as BattingInput)).toEqual(['input.missing']);
  });

  it('checks the trace against the shot: present for a tap, no longer than the elapsed time, swipe agrees with the zone', () => {
    expect(errorsOf({ ...good(), trace: { pointer: 'touch', samples: [] } })).toContain('input.trace_missing_tap');
    const g = good();
    expect(errorsOf({ ...g, clientElapsedMs: g.tapMs as number, trace: { pointer: 'touch', samples: [[0, 0.5, 0.5], [4000, 0.5, 0.5]] } })).toContain('input.trace_longer_than_elapsed');
    // A swipe towards fine leg while claiming a cover drive.
    const wrong = battingInputFor(rng, delivery, 'drive', 'cover', delivery.timing.releaseToContactMs);
    const flipped = { ...wrong, trace: { ...wrong.trace, samples: wrong.trace.samples.map(([t, x, y]) => [t, 1 - x, 1 - y] as [number, number, number]) } };
    expect(errorsOf(flipped)).toContain('input.swipe_zone_mismatch');
    // Keyboard play has no swipe direction to check.
    expect(errorsOf({ ...flipped, trace: { ...flipped.trace, pointer: 'keyboard' } })).not.toContain('input.swipe_zone_mismatch');
    expect(errorsOf({ ...good(), trace: { pointer: 'touch', samples: [[0, 0.5, 0.5], [0, 0.5, 0.6]] } })).toContain('input.trace.duplicate_timestamp');
  });
});

describe('timingAudit', () => {
  it('flags superhuman, machine-perfect tapping over an innings', () => {
    const pairs = [0, 1, 2, 3, 4, 5].map((b) => {
      const del = engine.revealDelivery(plan, b, conditions);
      return { delivery: del, input: battingInputFor(rng, del, 'drive', 'cover', del.timing.releaseToContactMs + (b % 2)) };
    });
    expect(timingAudit(pairs).suspicious).toBe(true);
    const human = pairs.map(({ delivery: del }) => ({ delivery: del, input: battingInputFor(rng, del, 'drive', 'cover', del.timing.releaseToContactMs + rng.normal() * 40) }));
    expect(timingAudit(human).bullseyes).toBeLessThan(5);
  });
});
