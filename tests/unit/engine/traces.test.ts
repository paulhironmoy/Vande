// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { FieldZone, InputTrace } from '@/contracts';
import { engine, swipeVectorForZone, zoneFromSwipe } from '@/engine';
import { rngFromKey } from '@/engine/prng';
import { METER, SECTOR_ZONES } from '@/engine/v1/tables';
import { checkTrace, isRobotic, qualityFromRelease, synthBattingTrace, synthExecutionTrace } from '@/engine/v1/traces';

/** A human-looking press-and-hold released at `release` ms. */
function hold(release: number, pointer: InputTrace['pointer'] = 'touch'): InputTrace {
  return synthExecutionTrace(rngFromKey(`hold|${release}|${pointer}`), release, pointer);
}

const errorsOf = (t: InputTrace) => {
  const r = engine.executionQuality(t);
  return r.ok ? [] : r.errors;
};

describe('release meter: execution quality from the trace', () => {
  it('scores the release time linearly around the 800 ms sweet spot', () => {
    expect(qualityFromRelease(800)).toEqual({ quality: 1, grade: 'perfect' });
    expect(qualityFromRelease(824)).toEqual({ quality: 0.85, grade: 'perfect' });
    expect(qualityFromRelease(776).grade).toBe('perfect');
    expect(qualityFromRelease(825).grade).toBe('good');
    expect(qualityFromRelease(880)).toEqual({ quality: 0.5, grade: 'good' });
    expect(qualityFromRelease(881).grade).toBe('loose');
    expect(qualityFromRelease(1200)).toEqual({ quality: 0, grade: 'loose' });
    expect(qualityFromRelease(400).quality).toBe(0);
  });

  it('accepts real-looking holds on every pointer type and grades them', () => {
    for (const pointer of ['touch', 'mouse', 'pen', 'keyboard'] as const) {
      const r = engine.executionQuality(hold(805, pointer));
      expect(r.ok, pointer).toBe(true);
      if (r.ok) expect(r.grade).toBe('perfect');
    }
    const loose = engine.executionQuality(hold(1000));
    expect(loose.ok && loose.grade).toBe('loose');
  });

  it('accepts a minimal two-sample trace (mouse held still)', () => {
    expect(errorsOf({ pointer: 'mouse', samples: [[0, 0.5, 0.8], [812.3, 0.5, 0.8]] })).toEqual([]);
  });
});

describe('impossible traces are rejected', () => {
  const base: InputTrace = { pointer: 'touch', samples: [[0, 0.5, 0.9], [33.1, 0.501, 0.88], [70.2, 0.503, 0.86], [801.4, 0.505, 0.6]] };

  it('rejects non-monotonic timestamps', () => {
    expect(errorsOf({ ...base, samples: [[0, 0.5, 0.9], [70, 0.5, 0.88], [33, 0.5, 0.86], [801, 0.5, 0.6]] })).toContain('trace.non_monotonic_time');
  });
  it('rejects duplicated timestamps', () => {
    expect(errorsOf({ ...base, samples: [[0, 0.5, 0.9], [33, 0.5, 0.88], [33, 0.5, 0.87], [801, 0.5, 0.6]] })).toContain('trace.duplicate_timestamp');
  });
  it('rejects a first sample that is not at t = 0', () => {
    expect(errorsOf({ ...base, samples: [[5, 0.5, 0.9], [801, 0.5, 0.6]] })).toContain('trace.first_sample_not_zero');
  });
  it('rejects teleporting points', () => {
    expect(errorsOf({ ...base, samples: [[0, 0.1, 0.9], [8, 0.95, 0.1], [801, 0.95, 0.1]] })).toContain('trace.teleport');
  });
  it('rejects durations outside human bounds', () => {
    expect(errorsOf({ pointer: 'touch', samples: [[0, 0.5, 0.5], [12, 0.5, 0.5]] })).toContain('trace.duration_too_short');
    expect(errorsOf({ pointer: 'touch', samples: [[0, 0.5, 0.5], [METER.maxHoldMs + 1, 0.5, 0.5]] })).toContain('trace.duration_too_long');
  });
  it('rejects more than MAX_TRACE_SAMPLES samples', () => {
    const samples = Array.from({ length: 121 }, (_, i) => [i * 6 + (i % 3) * 0.37, 0.5 + (i % 5) * 0.001, 0.9 - i * 0.002] as [number, number, number]);
    expect(errorsOf({ pointer: 'touch', samples })).toContain('trace.too_many_samples');
  });
  it('rejects too few samples, malformed samples, coordinates out of range and unknown pointers', () => {
    expect(errorsOf({ pointer: 'touch', samples: [[0, 0.5, 0.5]] })).toContain('trace.too_few_samples');
    expect(errorsOf({ pointer: 'touch', samples: [[0, 0.5, 0.5], [800, Number.NaN, 0.5]] })).toContain('trace.malformed_sample');
    expect(errorsOf({ pointer: 'touch', samples: [[0, 0.5, 0.5], [800, 1.2, 0.5]] as Array<[number, number, number]> })).toContain('trace.coordinate_out_of_range');
    expect(errorsOf({ pointer: 'stylus' as InputTrace['pointer'], samples: [[0, 0.5, 0.5], [800, 0.5, 0.5]] })).toContain('trace.pointer');
    expect(errorsOf(null as unknown as InputTrace)).toContain('trace.missing');
  });
  it('rejects robotic patterns: perfectly regular intervals with perfectly linear motion', () => {
    const robot: InputTrace = { pointer: 'touch', samples: Array.from({ length: 12 }, (_, i) => [i * 16, 0.5, 0.9 - i * 0.02] as [number, number, number]) };
    expect(isRobotic(robot)).toBe(true);
    const robotHold: InputTrace = { pointer: 'mouse', samples: Array.from({ length: 51 }, (_, i) => [i * 16, 0.5, 0.9 - i * 0.004] as [number, number, number]) };
    expect(errorsOf(robotHold)).toEqual(['trace.robotic_pattern']);
    expect(checkTrace(robot, 'batting')).toContain('trace.robotic_pattern');
    // Jitter in either time or space is human.
    const jittered = { ...robot, samples: robot.samples.map(([t, x, y], i) => [t + (i % 2) * 0.4, x, y] as [number, number, number]) };
    expect(isRobotic(jittered)).toBe(false);
    // Keyboard traces never move, so they are exempt.
    expect(isRobotic({ ...robot, pointer: 'keyboard' })).toBe(false);
  });
});

describe('swipe sectors', () => {
  it('quantises a swipe to eight 45° sectors clockwise from straight up', () => {
    expect(zoneFromSwipe(0, -1)).toBe('mid_off');
    expect(zoneFromSwipe(1, -1)).toBe('cover');
    expect(zoneFromSwipe(1, 0)).toBe('point');
    expect(zoneFromSwipe(1, 1)).toBe('third_man');
    expect(zoneFromSwipe(0, 1)).toBe('fine_leg');
    expect(zoneFromSwipe(-1, 1)).toBe('square_leg');
    expect(zoneFromSwipe(-1, 0)).toBe('midwicket');
    expect(zoneFromSwipe(-1, -1)).toBe('mid_on');
    expect(zoneFromSwipe(-0.01, -1)).toBe('mid_on');
    expect(zoneFromSwipe(0, 0)).toBeNull();
  });

  it('round-trips every zone through its sector-centre vector', () => {
    for (const z of SECTOR_ZONES) {
      const v = swipeVectorForZone(z);
      expect(zoneFromSwipe(v.dx, v.dy)).toBe(z);
      expect(Math.abs(Math.hypot(v.dx, v.dy) - 1)).toBeLessThan(1e-12);
    }
  });

  it('synthesised swipes point at their zone and pass validation', () => {
    const rng = rngFromKey('swipes');
    for (const z of SECTOR_ZONES as readonly FieldZone[]) {
      const t = synthBattingTrace(rng, z, 220);
      expect(checkTrace(t, 'batting')).toEqual([]);
      const s = t.samples;
      expect(zoneFromSwipe(s[s.length - 1][1] - s[0][1], s[s.length - 1][2] - s[0][2])).toBe(z);
    }
  });
});
