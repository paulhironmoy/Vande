// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { NormalizedSwing } from '@/contracts/practice';
import { BLADE_L, SWEET_ALONG_M, SWEET_U } from '@/physics';
import { coachingFacts, repeatDelivery } from '@/practice/game';
import { play, referenceRecord, swingFor } from '../coach/fixtures';

describe('one-gesture physics and coaching evidence', () => {
  it('preserves every continuous intent dimension while reporting only measured bat facts', () => {
    const base = referenceRecord('ref-1', 'real');
    const swing = swingFor(base, {
      kind: 'attack',
      directionDeg: 50,
      elevation: 0.72,
      power: 0.83,
      footwork: 'forward',
      errorMs: 0,
    });
    const { record, result } = play(base, swing);
    const facts = coachingFacts(result, record);

    expect(facts.intent).toEqual({
      kind: 'attack',
      directionDeg: 50,
      elevation: 0.72,
      power: 0.83,
      requestedFootwork: 'forward',
    });
    expect(facts.footwork).toBe(result.footwork);
    expect(facts.timingErrorMs).toBe(result.contact.timingErrorMs);
    expect(facts.intendedBearingDeg).toBe(result.contact.intendedBearingDeg);
    expect(facts.bat.faceBearingDeg).toBe(result.contact.faceBearingDeg);
    expect(facts.bat.speedKph).toBe(result.contact.batSpeedKph);
    expect(facts.bat.bladeU).toBe(result.contact.bladeU);

    if (facts.bat.sweetSpotAlongOffsetM === null) {
      expect(facts.bat.withinSweetSpotAlongBand).toBeNull();
    } else {
      const rawOffsetM = (result.contact.bladeU! - SWEET_U) * BLADE_L;
      expect(facts.bat.withinSweetSpotAlongBand).toBe(Math.abs(rawOffsetM) <= SWEET_ALONG_M);
    }
    // The result contract has no across-face offset, so the facts intentionally expose no full sweet-spot verdict.
    expect(facts.bat).not.toHaveProperty('sweet');
  });

  it('classifies the sweet-spot along-blade boundary from raw evidence before display rounding', () => {
    const base = referenceRecord('ref-1', 'real');
    const swing = swingFor(base, { directionDeg: 50, footwork: 'forward', errorMs: 0 });
    const { record, result } = play(base, swing);
    const offset = (metres: number) => SWEET_U + metres / BLADE_L;
    const factsAt = (metres: number) => coachingFacts({ ...result, contact: { ...result.contact, bladeU: offset(metres) } }, record);

    const justInside = factsAt(SWEET_ALONG_M - 0.00004);
    const justOutside = factsAt(SWEET_ALONG_M + 0.00004);

    // Both display values round to 0.0600 m; the verdict must still preserve the unrounded physical boundary.
    expect(justInside.bat.sweetSpotAlongOffsetM).toBe(0.06);
    expect(justOutside.bat.sweetSpotAlongOffsetM).toBe(0.06);
    expect(justInside.bat.withinSweetSpotAlongBand).toBe(true);
    expect(justOutside.bat.withinSweetSpotAlongBand).toBe(false);
  });

  it.each([
    { label: 'defence', opts: { kind: 'defend' as const, directionDeg: 0, elevation: 0, power: 0.15, footwork: 'back' as const } },
    { label: 'ground stroke', opts: { kind: 'attack' as const, directionDeg: 35, elevation: 0.03, power: 0.62, footwork: 'forward' as const } },
    { label: 'lofted stroke', opts: { kind: 'attack' as const, directionDeg: -115, elevation: 0.91, power: 0.87, footwork: 'back' as const } },
  ])('keeps $label as physical intent rather than selecting an outcome', ({ opts }) => {
    const base = referenceRecord('ref-3', 'real');
    const swing = swingFor(base, opts);
    const { record, result } = play(base, swing);
    const facts = coachingFacts(result, record);

    expect(result.swing).toEqual(swing);
    expect(facts.intent).toEqual({
      kind: opts.kind,
      directionDeg: opts.directionDeg,
      elevation: opts.elevation,
      power: opts.power,
      requestedFootwork: opts.footwork,
    });
    expect(facts.intendedBearingDeg).toBe(opts.directionDeg);
    expect(['middle', 'inside_edge', 'outside_edge', 'top_edge', 'leading_edge', 'pad', 'body', 'miss']).toContain(result.contact.kind);
  });

  it('repeats the exact ball and gesture deterministically, while a timing change remains causal', () => {
    const base = referenceRecord('ref-2', 'real');
    const swing = swingFor(base, { directionDeg: 0, elevation: 0.08, power: 0.68, footwork: 'forward', errorMs: 0 });
    const { record } = play(base, swing);
    const first = repeatDelivery(record, swing);
    const second = repeatDelivery(record, { ...swing });

    expect(second).toEqual(first);
    expect(coachingFacts(second, record)).toEqual(coachingFacts(first, record));

    const late: NormalizedSwing = { ...swing, startT: swing.startT + 0.06 };
    const changed = repeatDelivery(record, late);
    expect(changed.swing).toEqual(late);
    expect(changed.contact.timingErrorMs).not.toBe(first.contact.timingErrorMs);
    expect(coachingFacts(changed, record).timingErrorMs).toBe(changed.contact.timingErrorMs);
  });

  it('does not manufacture intent or bat evidence for a leave', () => {
    const base = referenceRecord('ref-1', 'real');
    const { record, result } = play(base, null);
    const facts = coachingFacts(result, record);

    expect(facts.intent).toBeNull();
    expect(facts.intendedBearingDeg).toBeNull();
    expect(facts.bat).toEqual({
      faceBearingDeg: null,
      faceToIntentDeg: null,
      speedKph: null,
      bladeU: null,
      sweetSpotAlongOffsetM: null,
      withinSweetSpotAlongBand: null,
    });
  });
});
