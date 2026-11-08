import { describe, expect, it } from 'vitest';
import type { GestureInput } from '@/contracts/practice';
import { GestureTracker, normalizeGesture, type SwingIntent, type TrackerScheduler } from '@/input';
import { DEPARTURE, KEYBOARD, LATE_SAMPLE_WAIT_MS, ONSET_GAP, READ_MAX_MS, TAP_HOLD_MS } from '@/input/constants';
import { DELIVERIES, OPTS, RELEASE, SURFACES, play, tapSamples } from './fixtures';

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
  const intents: Array<SwingIntent & { at: number }> = [];
  const cancellations: number[] = [];
  const tr = new GestureTracker(
    {
      swingStart: (t, p) => starts.push([t, p]),
      gesture: (g) => gestures.push(g),
      intent: (i) => intents.push({ ...i, at: clock.now() }),
      cancel: () => cancellations.push(clock.now()),
    },
    clock.sched,
  );
  tr.setSurface(SURFACES.phone.width, SURFACES.phone.height);
  return { tr, clock, starts, gestures, intents, cancellations };
}
const norm = (g: GestureInput, releasePerfMs = 900) => normalizeGesture(g, { ...OPTS, releasePerfMs })!;

describe('an armed press', () => {
  it('starts the swing at the press’s own timestamp, at once, and a quick tap is emitted at the lift', () => {
    const { tr, clock, starts, gestures, intents } = setup();
    tr.setEnabled(true);
    clock.advance(1010);
    tr.pointerDown(1, 'touch', { t: 1002.5, x: 100, y: 90 });
    expect(starts).toEqual([[1002.5, 'touch']]);
    expect(gestures).toHaveLength(0);
    clock.advance(1060);
    tr.pointerUp(1, { t: 1060, x: 102, y: 91 });
    expect(gestures).toHaveLength(1);
    expect(intents.map((i) => i.kind)).toEqual(['defend']);
    const s = norm(gestures[0], 1000);
    expect(s.kind).toBe('defend');
    expect(s.startT).toBeCloseTo(0.0025, 6);
  });

  it('a press held without moving waits, and its later lift is not a shot', () => {
    const { tr, clock, gestures } = setup();
    tr.setEnabled(true);
    tr.pointerDown(1, 'touch', { t: 1000, x: 100, y: 90 });
    clock.advance(1000 + TAP_HOLD_MS + LATE_SAMPLE_WAIT_MS - 1);
    expect(gestures).toHaveLength(0);
    clock.advance(1000 + TAP_HOLD_MS + LATE_SAMPLE_WAIT_MS);
    expect(gestures).toHaveLength(0);
    tr.pointerUp(1, { t: 1400, x: 100, y: 90 });
    expect(gestures).toHaveLength(0);
    expect(tr.isArmed()).toBe(true);
    tr.pointerDown(2, 'touch', { t: 1500, x: 100, y: 90 });
    tr.pointerUp(2, { t: 1550, x: 100, y: 90 });
    expect(gestures).toHaveLength(1);
    expect(norm(gestures[0], 1000).startT).toBe(0.5);
  });

  it('the tap/hold boundary uses event duration, not dispatch delay, at every cadence', () => {
    for (const durationMs of [TAP_HOLD_MS - 1, TAP_HOLD_MS, TAP_HOLD_MS + 1])
      for (const delivery of DELIVERIES) {
        const result = play(tapSamples(RELEASE + 500, durationMs, { driftPx: 2 }), { delivery });
        if (durationMs <= TAP_HOLD_MS)
          expect(result.swing, `${durationMs} ${delivery.name}`).toMatchObject({ kind: 'defend', startT: 0.5 });
        else expect(result.swing, `${durationMs} ${delivery.name}`).toBeNull();
      }
  });

  it('a press that rests and then swipes is timed from departure, with an immediate ready cue', () => {
    const { tr, clock, starts, gestures, intents } = setup();
    tr.setEnabled(true);
    tr.pointerDown(1, 'touch', { t: 1000, x: 400, y: 150 });
    // Rests 100 ms (the old reader called this a tap at 50 ms), then a 100 px swipe up and to the right.
    for (let t = 8; t <= 100; t += 8) {
      clock.advance(1000 + t);
      tr.pointerMove(1, [{ t: 1000 + t, x: 400 + (t % 16 ? 0.5 : 0), y: 150 }]);
    }
    expect(gestures).toHaveLength(0);
    for (let t = 108; t <= 180; t += 8) {
      clock.advance(1000 + t);
      tr.pointerMove(1, [{ t: 1000 + t, x: 400 + (t - 100) * 0.5, y: 150 - (t - 100) * 1.2 }]);
    }
    expect(intents[0]).toMatchObject({ kind: 'attack', pointer: 'touch', pressAtPerfMs: 1000 });
    expect(intents[0].atPerfMs).toBeGreaterThan(1096);
    expect(intents[0].atPerfMs).toBeLessThan(1108);
    expect(intents[0].at).toBeLessThan(1000 + TAP_HOLD_MS);
    expect(gestures).toHaveLength(0);
    tr.pointerUp(1, { t: 1184, x: 442, y: 49.2 });
    expect(gestures).toHaveLength(1);
    expect(starts).toEqual([[1000, 'touch']]);
    const s = norm(gestures[0]);
    expect(s.kind).toBe('attack');
    expect(s.startT).toBeCloseTo((intents[0].atPerfMs - 900) / 1000, 4);
    expect(s.directionDeg).toBeCloseTo((Math.atan2(0.5, 1.2) * 180) / Math.PI, 0);
  });

  it('a swipe is emitted at the lift, without waiting', () => {
    const { tr, clock, gestures } = setup();
    tr.setEnabled(true);
    tr.pointerDown(1, 'touch', { t: 1000, x: 400, y: 150 });
    for (let t = 8; t <= 64; t += 8) {
      clock.advance(1000 + t);
      tr.pointerMove(1, [{ t: 1000 + t, x: 400, y: 150 - t * 1.5 }]);
    }
    expect(gestures).toHaveLength(0);
    clock.advance(1070);
    tr.pointerUp(1, { t: 1070, x: 400, y: 150 - 70 * 1.5 });
    expect(gestures).toHaveLength(1);
    expect(gestures[0].samples.at(-1)!.t).toBe(1070);
  });

  it('a swipe still moving is emitted with the first sample past READ_MAX_MS, or LATE_SAMPLE_WAIT_MS after it', () => {
    const a = setup();
    a.tr.setEnabled(true);
    a.tr.pointerDown(1, 'touch', { t: 1000, x: 400, y: 150 });
    for (let t = 10; t <= READ_MAX_MS + 10; t += 10) {
      a.clock.advance(1000 + t);
      a.tr.pointerMove(1, [{ t: 1000 + t, x: 400, y: 150 - t * 0.8 }]);
      if (a.gestures.length) break;
    }
    expect(a.gestures).toHaveLength(1);
    expect(a.clock.now()).toBe(1000 + READ_MAX_MS + 10);
    // No sample arrives past the read (the finger stopped, or its events are stuck): the timer closes it.
    const b = setup();
    b.tr.setEnabled(true);
    b.tr.pointerDown(1, 'touch', { t: 1000, x: 400, y: 150 });
    b.tr.pointerMove(1, [{ t: 1040, x: 400, y: 110 }]);
    const cap = 1000 + DEPARTURE.radiusPx + READ_MAX_MS + LATE_SAMPLE_WAIT_MS;
    b.clock.advance(cap - 1);
    expect(b.gestures).toHaveLength(0);
    b.clock.advance(cap);
    expect(b.gestures).toHaveLength(1);
    expect(norm(b.gestures[0]).kind).toBe('attack');
  });

  it('a batch of samples that arrives late is judged by its own timestamps', () => {
    const { tr, clock, gestures } = setup();
    tr.setEnabled(true);
    tr.pointerDown(1, 'touch', { t: 1000, x: 400, y: 150 });
    // The movement happened before TAP_HOLD_MS, but its samples only arrive after it (a busy main thread).
    clock.advance(1000 + TAP_HOLD_MS + LATE_SAMPLE_WAIT_MS - 5);
    tr.pointerMove(1, [
      { t: 1090, x: 400, y: 150 },
      { t: 1100, x: 400, y: 120 },
      { t: 1110, x: 400, y: 90 },
    ]);
    tr.pointerUp(1, { t: 1112, x: 400, y: 86 });
    expect(gestures).toHaveLength(1);
    const s = norm(gestures[0]);
    expect(s.kind).toBe('attack');
    expect(s.startT).toBeCloseTo((1090 + DEPARTURE.radiusPx / 3 - 900) / 1000, 4);
  });

  it('cancellation aborts an uncommitted tap, swipe or prearmed finger without consuming the shot', () => {
    for (const mode of ['tap', 'swipe', 'prearmed'] as const) {
      const a = setup();
      if (mode !== 'prearmed') a.tr.setEnabled(true);
      a.tr.pointerDown(1, 'touch', { t: 1000, x: 400, y: 150 });
      if (mode === 'prearmed') a.tr.setEnabled(true);
      if (mode === 'swipe') a.tr.pointerMove(1, [{ t: 1030, x: 400, y: 100 }]);
      a.tr.pointerCancel(1);
      expect(a.cancellations, mode).toHaveLength(mode === 'prearmed' ? 0 : 1);
      a.clock.advance(1400);
      expect(a.gestures, mode).toHaveLength(0);
      expect(a.tr.isArmed(), mode).toBe(true);
      a.tr.pointerDown(2, 'touch', { t: 1400, x: 400, y: 150 });
      a.tr.pointerUp(2, { t: 1440, x: 400, y: 150 });
      expect(a.gestures, mode).toHaveLength(1);
      expect(norm(a.gestures[0], 1000)).toMatchObject({ kind: 'defend', startT: 0.4 });
    }
  });

  it('clears a provisional attack on cancel and accepts a fresh attack in the same delivery', () => {
    const a = setup();
    a.tr.setEnabled(true);
    a.tr.pointerDown(1, 'touch', { t: 1000, x: 400, y: 150 });
    a.tr.pointerMove(1, [{ t: 1020, x: 400, y: 110 }]);
    expect(a.intents).toHaveLength(1);
    expect(a.gestures).toHaveLength(0);
    a.tr.pointerCancel(99);
    expect(a.cancellations).toHaveLength(0);
    a.tr.pointerCancel(1);
    a.tr.pointerCancel(1);
    expect(a.cancellations).toHaveLength(1);
    a.tr.pointerDown(2, 'touch', { t: 1100, x: 400, y: 150 });
    a.tr.pointerMove(2, [{ t: 1120, x: 440, y: 150 }]);
    a.tr.pointerUp(2, { t: 1140, x: 480, y: 150 });
    expect(a.intents).toHaveLength(2);
    expect(a.gestures).toHaveLength(1);
    expect(norm(a.gestures[0], 1000)).toMatchObject({ kind: 'attack', directionDeg: 90 });
    expect(a.tr.isArmed()).toBe(false);
  });

  it('cancellation cannot revert or repeat a committed shot', () => {
    const a = setup();
    a.tr.setEnabled(true);
    a.tr.pointerDown(1, 'touch', { t: 1000, x: 400, y: 150 });
    a.tr.pointerMove(1, [{ t: 1030, x: 400, y: 100 }]);
    a.clock.advance(1400);
    expect(a.gestures).toHaveLength(1);
    a.tr.pointerCancel(1);
    expect(a.cancellations).toHaveLength(0);
    expect(a.tr.isArmed()).toBe(false);
    a.tr.pointerDown(2, 'touch', { t: 1450, x: 400, y: 150 });
    a.tr.pointerUp(2, { t: 1490, x: 400, y: 150 });
    expect(a.gestures).toHaveLength(1);
  });

  it('ignores input while disabled, re-arms per delivery, and only the first pointer counts', () => {
    const { tr, clock, gestures, starts } = setup();
    tr.pointerDown(1, 'mouse', { t: 1000, x: 10, y: 10 });
    tr.pointerUp(1, { t: 1010, x: 10, y: 10 });
    expect(gestures).toHaveLength(0);
    tr.setEnabled(true);
    tr.pointerDown(2, 'mouse', { t: 1100, x: 10, y: 10 });
    tr.pointerDown(3, 'mouse', { t: 1105, x: 50, y: 10 });
    tr.pointerUp(2, { t: 1110, x: 10, y: 10 });
    tr.pointerDown(4, 'mouse', { t: 1200, x: 10, y: 10 });
    tr.pointerUp(4, { t: 1210, x: 10, y: 10 });
    expect(gestures).toHaveLength(1);
    expect(starts).toEqual([[1100, 'mouse']]);
    tr.rearm();
    tr.pointerDown(5, 'mouse', { t: 1300, x: 10, y: 10 });
    clock.advance(1350);
    tr.pointerUp(5, { t: 1350, x: 10, y: 10 });
    expect(gestures).toHaveLength(2);
    expect(gestures[1].pointer).toBe('mouse');
  });
});

describe('a finger resting on the glass when the delivery is armed', () => {
  it('starts its swing where its first intentional movement began, and never taps', () => {
    const { tr, clock, starts, gestures } = setup();
    tr.pointerDown(7, 'touch', { t: 900, x: 300, y: 100 });
    clock.advance(1000);
    tr.setEnabled(true);
    // Small jitter is not a swing.
    for (let t = 1008; t < 1300; t += 8) tr.pointerMove(7, [{ t, x: 300 + ((t / 8) % 2) * 0.6, y: 100 }]);
    clock.advance(1300);
    expect(starts).toHaveLength(0);
    for (let t = 1300; t <= 1400; t += 8)
      tr.pointerMove(7, [{ t, x: 300 + (t - 1300) * 0.2, y: 100 - (t - 1300) * 1.1 }]);
    tr.pointerUp(7, { t: 1404, x: 300 + 104 * 0.2, y: 100 - 104 * 1.1 });
    expect(starts).toHaveLength(1);
    expect(Math.abs(starts[0][0] - 1300)).toBeLessThanOrEqual(8);
    expect(gestures).toHaveLength(1);
    const s = norm(gestures[0], 1000);
    expect(s.kind).toBe('attack');
    expect(s.startT).toBeCloseTo(0.3, 2);
    // A resting finger that just lifts is not a shot.
    const b = setup();
    b.tr.pointerDown(2, 'touch', { t: 900, x: 300, y: 100 });
    b.tr.setEnabled(true);
    b.tr.pointerUp(2, { t: 1100, x: 300, y: 100 });
    expect(b.starts).toHaveLength(0);
    expect(b.gestures).toHaveLength(0);
  });

  it('with sparse samples (no events while still), estimates the onset inside the silence', () => {
    const { tr, starts, gestures } = setup();
    tr.pointerDown(7, 'touch', { t: 900, x: 300, y: 100 });
    tr.setEnabled(true);
    // Nothing for 400 ms (a still finger sends no events), then movement seen every 33 ms.
    tr.pointerMove(7, [{ t: 1333, x: 300, y: 70 }]);
    tr.pointerMove(7, [{ t: 1366, x: 300, y: 35 }]);
    tr.pointerUp(7, { t: 1380, x: 300, y: 25 });
    expect(starts).toHaveLength(1);
    // One moving sample cannot reveal its prior speed. The immediate cue uses the
    // documented conservative floor; the finished gesture uses the next segment.
    expect(starts[0][0]).toBeCloseTo(1333 - (30 - DEPARTURE.radiusPx) / ONSET_GAP.minPxPerMs, 6);
    expect(starts[0][0]).toBeLessThan(1333);
    expect(norm(gestures[0], 1000).kind).toBe('attack');
    expect(norm(gestures[0], 1000).startT).toBeCloseTo((1333 - (30 - DEPARTURE.radiusPx) / (35 / 33) - 1000) / 1000, 4);
  });
});

describe('keyboard', () => {
  it('Space defends at the key timestamp with the same start rule as a tap; repeats and second presses do nothing', () => {
    const { tr, starts, gestures, intents } = setup();
    tr.setEnabled(true);
    expect(tr.key('Space', 1234.5)).toBe('swing');
    expect(starts).toEqual([[1234.5, 'keyboard']]);
    expect(intents.map((i) => i.kind)).toEqual(['defend']);
    expect(gestures[0].pointer).toBe('keyboard');
    const key = normalizeGesture(gestures[0], { ...OPTS, releasePerfMs: 1000, calibrationMs: 30 })!;
    const tap = normalizeGesture(
      { pointer: 'touch', samples: [{ t: 1234.5, x: 3, y: 3 }], surface: SURFACES.phone },
      { ...OPTS, releasePerfMs: 1000, calibrationMs: 30 },
    )!;
    expect(key).toEqual(tap);
    expect(tr.key('Space', 1300, true)).toBe('ignored');
    expect(tr.key('Enter', 1310)).toBe('ignored');
    expect(tr.key('ArrowUp', 1320)).toBe('ignored');
    expect(gestures).toHaveLength(1);
  });

  it('an arrow attacks in its direction on screen, timed from the key, after a short chord window', () => {
    const { tr, clock, starts, gestures, intents } = setup();
    tr.setEnabled(true);
    clock.advance(1500);
    expect(tr.key('ArrowRight', 1500)).toBe('swing');
    expect(starts).toEqual([[1500, 'keyboard']]);
    expect(intents[0]).toMatchObject({ kind: 'attack', screenBearingDeg: 90, loft: false });
    expect(gestures).toHaveLength(0);
    clock.advance(1500 + KEYBOARD.chordMs);
    expect(gestures).toHaveLength(1);
    expect(norm(gestures[0], 1000)).toEqual({
      kind: 'attack',
      startT: 0.5,
      directionDeg: 90,
      power: KEYBOARD.power,
      elevation: 0,
      footwork: 'auto',
    });
  });

  it('two arrows within the chord window make the diagonal, emitted at once', () => {
    const { tr, clock, gestures } = setup();
    tr.setEnabled(true);
    clock.advance(1500);
    tr.key('ArrowUp', 1500);
    clock.advance(1520);
    tr.key('ArrowLeft', 1520);
    expect(gestures).toHaveLength(1);
    const s = norm(gestures[0], 1000);
    expect(s.directionDeg).toBe(-45);
    expect(s.startT).toBe(0.5);
    // Opposite arrows cancel: the first one counts.
    const o = setup();
    o.tr.setEnabled(true);
    o.tr.key('ArrowLeft', 1500);
    o.tr.key('ArrowRight', 1510);
    expect(norm(o.gestures[0], 1000).directionDeg).toBe(-90);
  });

  it('Shift lofts it, held before or pressed during the chord', () => {
    const a = setup();
    a.tr.setEnabled(true);
    a.tr.key('ArrowUp', 1500, false, { shift: true });
    a.clock.advance(1500 + KEYBOARD.chordMs);
    expect(norm(a.gestures[0], 1000)).toMatchObject({
      kind: 'attack',
      directionDeg: 0,
      power: KEYBOARD.loftPower,
      elevation: KEYBOARD.loftElevation,
    });
    const b = setup();
    b.tr.setEnabled(true);
    b.tr.key('ArrowDown', 1500);
    b.tr.key('ShiftLeft', 1510);
    b.clock.advance(1500 + KEYBOARD.chordMs);
    expect(norm(b.gestures[0], 1000)).toMatchObject({ directionDeg: 180, elevation: KEYBOARD.loftElevation });
  });

  it('keypad 1–9 give the eight directions at once, and 5 defends', () => {
    const want: Record<string, number> = {
      Numpad8: 0,
      Numpad9: 45,
      Numpad6: 90,
      Numpad3: 135,
      Numpad2: 180,
      Numpad1: -135,
      Numpad4: -90,
      Numpad7: -45,
    };
    for (const [code, deg] of Object.entries(want)) {
      const { tr, gestures } = setup();
      tr.setEnabled(true);
      expect(tr.key(code, 1500)).toBe('swing');
      expect(gestures).toHaveLength(1);
      expect(norm(gestures[0], 1000).directionDeg).toBe(deg);
    }
    const d = setup();
    d.tr.setEnabled(true);
    d.tr.key('Numpad5', 1500);
    expect(norm(d.gestures[0], 1000).kind).toBe('defend');
  });

  it('W, S and the side letters choose footwork; the across letter follows the handedness', () => {
    const { tr, clock, gestures } = setup();
    tr.setEnabled(true);
    expect(tr.key('KeyW', 1000)).toBe('footwork');
    expect(tr.footwork()).toBe('forward');
    tr.key('KeyW', 1200);
    expect(tr.footwork()).toBe('down_track');
    tr.key('KeyS', 1300);
    expect(tr.footwork()).toBe('back');
    tr.key('KeyD', 1310);
    expect(tr.footwork()).toBe('across');
    tr.key('KeyA', 1320);
    expect(tr.footwork()).toBe('auto');
    tr.key('KeyD', 1330);
    tr.key('ArrowLeft', 1400);
    clock.advance(1400 + KEYBOARD.chordMs);
    expect(gestures[0].footwork).toBe('across');
    const lh = setup();
    lh.tr.setHandedness('left');
    lh.tr.setEnabled(true);
    lh.tr.key('KeyA', 1000);
    expect(lh.tr.footwork()).toBe('across');
  });

  it('a resting finger cannot start a second swing while a key shot is under way', () => {
    const { tr, clock, starts, gestures } = setup();
    tr.pointerDown(3, 'touch', { t: 900, x: 300, y: 100 });
    tr.setEnabled(true);
    clock.advance(1100);
    tr.key('ArrowUp', 1100);
    for (let t = 1104; t <= 1130; t += 4) tr.pointerMove(3, [{ t, x: 300, y: 100 - (t - 1100) * 2 }]);
    clock.advance(1100 + KEYBOARD.chordMs);
    expect(starts).toEqual([[1100, 'keyboard']]);
    expect(gestures).toHaveLength(1);
    expect(gestures[0].pointer).toBe('keyboard');
  });

  it('cancelling a resting pointer does not cancel the keyboard chord timer', () => {
    const { tr, clock, gestures, cancellations } = setup();
    tr.pointerDown(3, 'touch', { t: 900, x: 300, y: 100 });
    tr.setEnabled(true);
    clock.advance(1100);
    tr.key('ArrowUp', 1100);
    tr.pointerCancel(3);
    expect(cancellations).toHaveLength(0);
    clock.advance(1100 + KEYBOARD.chordMs);
    expect(gestures).toHaveLength(1);
    expect(norm(gestures[0], 1000)).toMatchObject({ kind: 'attack', startT: 0.1 });
  });

  it('keys do nothing while disabled, and a press during a key shot only rests', () => {
    const { tr, gestures, starts } = setup();
    expect(tr.key('Space', 1000)).toBe('ignored');
    expect(tr.key('ArrowUp', 1000)).toBe('ignored');
    expect(tr.key('KeyW', 1000)).toBe('ignored');
    expect(gestures).toHaveLength(0);
    tr.setEnabled(true);
    tr.key('ArrowUp', 1100);
    tr.pointerDown(1, 'touch', { t: 1105, x: 10, y: 10 });
    tr.pointerUp(1, { t: 1130, x: 10, y: 10 });
    expect(starts).toEqual([[1100, 'keyboard']]);
  });
});
