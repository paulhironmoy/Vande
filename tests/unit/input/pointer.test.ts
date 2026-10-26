import { describe, expect, it } from 'vitest';
import { PointerTrace, eventTime } from '@/input';

/** A PointerEvent with a chosen timestamp (jsdom stamps epoch time; the trace must use the event's own). */
function ev(type: string, x: number, y: number, t: number, coalesced: Array<[number, number, number]> = []): PointerEvent {
  const e = new PointerEvent(type, { clientX: x, clientY: y, pointerType: 'touch', pointerId: 1 });
  Object.defineProperty(e, 'timeStamp', { value: t });
  if (coalesced.length) Object.defineProperty(e, 'getCoalescedEvents', { value: () => coalesced.map(([cx, cy, ct]) => ev('pointermove', cx, cy, ct)) });
  return e;
}
const rect = { left: 10, top: 20, width: 200, height: 100 };

describe('PointerTrace', () => {
  it('times samples from the events themselves, not from when the handler ran', () => {
    const tr = new PointerTrace(ev('pointerdown', 110, 70, 1000.04), rect);
    expect(tr.t0).toBeCloseTo(1000.04, 6);
    tr.move(ev('pointermove', 120, 60, 1016.66));
    tr.end(ev('pointerup', 130, 50, 1031.2));
    expect(tr.samples).toEqual([
      [0, 0.5, 0.5],
      [16.6, 0.55, 0.4],
      [31.2, 0.6, 0.3],
    ]);
    expect(tr.pointer).toBe('touch');
  });

  it('keeps every coalesced sample, in order, and never goes back in time', () => {
    const tr = new PointerTrace(ev('pointerdown', 10, 20, 500), rect);
    tr.move(ev('pointermove', 30, 20, 512, [[14, 20, 504], [22, 20, 508], [30, 20, 512]]));
    tr.move(ev('pointermove', 40, 20, 510));
    expect(tr.samples.map((s) => s[0])).toEqual([0, 4, 8, 12]);
  });

  it('clamps to the surface and caps the sample count while keeping the release', () => {
    const tr = new PointerTrace(ev('pointerdown', 10, 20, 0.5), rect, { maxSamples: 3 });
    tr.move(ev('pointermove', 500, -50, 10));
    tr.move(ev('pointermove', 20, 20, 20));
    tr.move(ev('pointermove', 30, 20, 30));
    tr.end(ev('pointerup', 40, 20, 40));
    expect(tr.samples.length).toBe(3);
    expect(tr.samples[1]).toEqual([9.5, 1, 0]);
    expect(tr.samples[2][0]).toBe(39.5);
  });

  it('falls back to now for an epoch or missing timestamp', () => {
    const e = new Event('x');
    Object.defineProperty(e, 'timeStamp', { value: Date.now() });
    expect(eventTime(e)).toBeLessThan(1e11);
  });
});
