import { describe, expect, it } from 'vitest';
import type { GestureInput } from '@/contracts/practice';
import { GestureTracker, normalizeGesture, READ_GRACE_MS, type TrackerScheduler } from '@/input';
import { READ_WINDOW_MS, TAP_DECIDE_MS } from '@/input/constants';

/** A scheduler driven by the test: time only moves when the test says so. */
function fakeClock(start = 1000) {
  let now = start;
  const timers: Array<{ at: number; fn: () => void; id: number }> = [];
  let next = 1;
  const sched: TrackerScheduler = {
    now: () => now,
    setTimer: (fn, ms) => {
      const id = next++;
      timers.push({ at: now + ms, fn, id });
      return id;
    },
    clearTimer: (id) => {
      const i = timers.findIndex((t) => t.id === id);
      if (i >= 0) timers.splice(i, 1);
    },
  };
  const advance = (to: number) => {
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const t = timers[0];
      if (!t || t.at > to) break;
      timers.shift();
      now = t.at;
      t.fn();
    }
    now = to;
  };
  return { sched, advance, now: () => now };
}

function setup() {
  const clock = fakeClock();
  const starts: Array<[number, string]> = [];
  const gestures: GestureInput[] = [];
  const tr = new GestureTracker({ swingStart: (t, p) => starts.push([t, p]), gesture: (g) => gestures.push(g) }, clock.sched);
  tr.setSurface(844, 180);
  return { tr, clock, starts, gestures };
}

describe('GestureTracker', () => {
  it('reports the swing start at the pointer-down timestamp and a tap after TAP_DECIDE_MS', () => {
    const { tr, clock, starts, gestures } = setup();
    tr.setEnabled(true);
    tr.pointerDown(1, 'touch', { t: 1002.5, x: 100, y: 90 });
    expect(starts).toEqual([[1002.5, 'touch']]);
    clock.advance(1002.5 + TAP_DECIDE_MS - 1);
    expect(gestures).toHaveLength(0);
    clock.advance(1002.5 + TAP_DECIDE_MS);
    expect(gestures).toHaveLength(1);
    expect(normalizeGesture(gestures[0], { releasePerfMs: 1000, calibrationMs: 0, handedness: 'right' })!.kind).toBe('defend');
    // Lifting afterwards changes nothing: one gesture per arming.
    tr.pointerUp(1, { t: 1080, x: 100, y: 90 });
    expect(gestures).toHaveLength(1);
  });

  it('a quick tap emits at pointer-up without waiting', () => {
    const { tr, clock, gestures } = setup();
    tr.setEnabled(true);
    tr.pointerDown(1, 'touch', { t: 1000, x: 100, y: 90 });
    clock.advance(1020);
    tr.pointerUp(1, { t: 1020, x: 101, y: 90 });
    expect(gestures).toHaveLength(1);
    expect(gestures[0].samples.at(-1)!.t).toBe(1020);
  });

  it('emits a flick once READ_WINDOW_MS of movement is covered, before pointer-up', () => {
    const { tr, clock, starts, gestures } = setup();
    tr.setEnabled(true);
    tr.pointerDown(1, 'touch', { t: 1000, x: 400, y: 150 });
    for (let t = 4; t <= READ_WINDOW_MS + 8; t += 4) {
      clock.advance(1000 + t);
      tr.pointerMove(1, [{ t: 1000 + t, x: 400 + t * 0.4, y: 150 - t * 1.2 }]);
      if (gestures.length) break;
    }
    expect(starts).toEqual([[1000, 'touch']]);
    expect(gestures).toHaveLength(1);
    expect(clock.now() - 1000).toBeLessThanOrEqual(READ_WINDOW_MS + 4);
    const s = normalizeGesture(gestures[0], { releasePerfMs: 900, calibrationMs: 0, handedness: 'right' })!;
    expect(s.kind).toBe('attack');
    expect(s.startT).toBeCloseTo(0.1, 6);
    expect(s.directionDeg).toBeGreaterThan(10);
  });

  it('a flick that stops early is emitted by the grace timer, not left waiting for pointer-up', () => {
    const { tr, clock, gestures } = setup();
    tr.setEnabled(true);
    tr.pointerDown(1, 'touch', { t: 1000, x: 400, y: 150 });
    for (let t = 4; t <= 20; t += 4) tr.pointerMove(1, [{ t: 1000 + t, x: 400, y: 150 - t * 1.5 }]);
    clock.advance(1000 + READ_WINDOW_MS + READ_GRACE_MS);
    expect(gestures).toHaveLength(1);
  });

  it('a late batch that moves only after the tap decision is still a tap', () => {
    const { tr, gestures } = setup();
    tr.setEnabled(true);
    tr.pointerDown(1, 'touch', { t: 1000, x: 400, y: 150 });
    tr.pointerMove(1, [
      { t: 1000 + TAP_DECIDE_MS - 5, x: 401, y: 150 },
      { t: 1000 + TAP_DECIDE_MS + 6, x: 430, y: 120 },
    ]);
    expect(gestures).toHaveLength(1);
    expect(normalizeGesture(gestures[0], { releasePerfMs: 900, calibrationMs: 0, handedness: 'right' })!.kind).toBe('defend');
  });

  it('a finger resting when armed starts its swing at its first intentional movement and never taps', () => {
    const { tr, clock, starts, gestures } = setup();
    tr.pointerDown(7, 'touch', { t: 900, x: 300, y: 100 });
    clock.advance(1000);
    tr.setEnabled(true);
    clock.advance(1200);
    expect(starts).toHaveLength(0);
    expect(gestures).toHaveLength(0);
    for (let t = 0; t <= 60; t += 4) tr.pointerMove(7, [{ t: 1300 + t, x: 300 + t * 0.2, y: 100 - t * 1.1 }]);
    expect(starts[0][0]).toBe(1300);
    expect(gestures).toHaveLength(1);
    const s = normalizeGesture(gestures[0], { releasePerfMs: 1000, calibrationMs: 0, handedness: 'right' })!;
    expect(s.startT).toBeCloseTo(0.3, 6);
    // A resting finger that just lifts is not a shot.
    const b = setup();
    b.tr.pointerDown(2, 'touch', { t: 900, x: 300, y: 100 });
    b.tr.setEnabled(true);
    b.tr.pointerUp(2, { t: 1100, x: 300, y: 100 });
    expect(b.starts).toHaveLength(0);
    expect(b.gestures).toHaveLength(0);
  });

  it('ignores input while disabled and re-arms per delivery', () => {
    const { tr, clock, gestures } = setup();
    tr.pointerDown(1, 'mouse', { t: 1000, x: 10, y: 10 });
    tr.pointerUp(1, { t: 1010, x: 10, y: 10 });
    expect(gestures).toHaveLength(0);
    tr.setEnabled(true);
    tr.pointerDown(2, 'mouse', { t: 1100, x: 10, y: 10 });
    tr.pointerUp(2, { t: 1110, x: 10, y: 10 });
    tr.pointerDown(3, 'mouse', { t: 1200, x: 10, y: 10 });
    tr.pointerUp(3, { t: 1210, x: 10, y: 10 });
    expect(gestures).toHaveLength(1);
    tr.rearm();
    tr.pointerDown(4, 'mouse', { t: 1300, x: 10, y: 10 });
    clock.advance(1400);
    expect(gestures).toHaveLength(2);
    expect(gestures[1].pointer).toBe('mouse');
  });

  it('only the first pointer counts', () => {
    const { tr, starts } = setup();
    tr.setEnabled(true);
    tr.pointerDown(1, 'touch', { t: 1000, x: 10, y: 10 });
    tr.pointerDown(2, 'touch', { t: 1005, x: 50, y: 10 });
    expect(starts).toHaveLength(1);
  });
});

describe('keyboard', () => {
  it('Space defends at the key timestamp with the same start rule as a tap', () => {
    const { tr, starts, gestures } = setup();
    tr.setEnabled(true);
    expect(tr.key('Space', 1234.5)).toBe('swing');
    expect(starts).toEqual([[1234.5, 'keyboard']]);
    expect(gestures[0].pointer).toBe('keyboard');
    const key = normalizeGesture(gestures[0], { releasePerfMs: 1000, calibrationMs: 30, handedness: 'right' })!;
    const tap = normalizeGesture({ pointer: 'touch', samples: [{ t: 1234.5, x: 3, y: 3 }], surface: { width: 844, height: 180 } }, { releasePerfMs: 1000, calibrationMs: 30, handedness: 'right' })!;
    expect(key).toEqual(tap);
    // Auto-repeat and a second press do nothing more.
    expect(tr.key('Space', 1300, true)).toBe('ignored');
    expect(tr.key('Enter', 1310)).toBe('ignored');
    expect(gestures).toHaveLength(1);
  });

  it('WASD and arrows choose footwork; the across key follows the handedness', () => {
    const { tr, gestures } = setup();
    tr.setEnabled(true);
    tr.key('KeyW', 1000);
    expect(tr.footwork()).toBe('forward');
    tr.key('ArrowUp', 1200);
    expect(tr.footwork()).toBe('down_track');
    tr.key('KeyS', 1300);
    expect(tr.footwork()).toBe('back');
    tr.key('ArrowRight', 1310);
    expect(tr.footwork()).toBe('across');
    tr.key('KeyA', 1320);
    expect(tr.footwork()).toBe('auto');
    tr.key('KeyD', 1330);
    tr.key('Enter', 1400);
    expect(gestures[0].footwork).toBe('across');
    const lh = setup();
    lh.tr.setHandedness('left');
    lh.tr.setEnabled(true);
    lh.tr.key('ArrowLeft', 1000);
    expect(lh.tr.footwork()).toBe('across');
  });

  it('keys do nothing while disabled', () => {
    const { tr, gestures } = setup();
    expect(tr.key('Space', 1000)).toBe('ignored');
    expect(tr.key('KeyW', 1000)).toBe('ignored');
    expect(gestures).toHaveLength(0);
  });
});
