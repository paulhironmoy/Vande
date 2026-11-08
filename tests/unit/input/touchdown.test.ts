/**
 * The touch-down cue (owner decision 2026-11-04, CTL1: the bat starts moving at touch-down, the shot commits on lift).
 * Input's side of the contract that presentation builds the touch-down stroke on:
 *   - the cue fires synchronously at the press, with the press's own timestamp, before any state or intent;
 *   - a tap commits at the lift with exactly that timestamp, so its physics swing starts where the stroke started;
 *   - an unmoved press that outlives the tap window publishes `waiting` (atPerfMs = press + TAP_HOLD_MS) once, at every
 *     cadence and even with no samples, so presentation can check the stroke back; its lift is `intentional_leave`;
 *   - a pullback or a flick never publishes `waiting`; a cancellation clears the notice;
 *   - no swing ever starts before its touch-down cue minus calibration.
 */
import { describe, expect, it } from 'vitest';
import type { GestureInput } from '@/contracts/practice';
import { GestureTracker, TAP_HOLD_MS, normalizeGesture, traceGesture, type OneGestureState, type TrackerScheduler } from '@/input';
import { LATE_SAMPLE_WAIT_MS } from '@/input/constants';
import { DELIVERIES, OPTS, RELEASE, SURFACES, play, rng, strokeSamples, tapSamples } from './fixtures';

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
  return { sched, advance, pending: () => timers.length };
}

function setup() {
  const clock = fakeClock();
  const log: string[] = [];
  const states: Array<OneGestureState & { at: number }> = [];
  const gestures: GestureInput[] = [];
  const intents: Array<{ kind: string; atPerfMs: number; pressAtPerfMs: number }> = [];
  const starts: number[] = [];
  const tr = new GestureTracker(
    {
      swingStart: (t) => {
        log.push('start');
        starts.push(t);
      },
      gesture: (g) => {
        log.push('gesture');
        gestures.push(g);
      },
      intent: (i) => {
        log.push(`intent:${i.kind}`);
        intents.push(i);
      },
      state: (s) => {
        log.push(`state:${s.phase}`);
        states.push({ ...s, at: 0 });
      },
    },
    clock.sched,
  );
  tr.setSurface(SURFACES.phone.width, SURFACES.phone.height);
  return { tr, clock, log, states, gestures, intents, starts };
}

/** A canonical contact: press, pull back 90 px over 80 ms, hold, then a 160 px forward stroke over 90 ms, lifted. */
function pullbackThenReverse(press: number, holdMs: number, lateralPx: number) {
  const out: Array<{ t: number; x: number; y: number }> = [{ t: press, x: 450, y: 100 }];
  for (let t = 4; t <= 80; t += 4) out.push({ t: press + t, x: 450, y: 100 + (90 * t) / 80 });
  for (let t = 84; t <= 80 + holdMs; t += 8) out.push({ t: press + t, x: 450, y: 190 });
  const f0 = press + 80 + holdMs;
  for (let t = 4; t <= 90; t += 4) out.push({ t: f0 + t, x: 450 + (lateralPx * t) / 90, y: 190 - (160 * t) / 90 });
  return out;
}

const phases = (states: ReadonlyArray<{ phase: string }>) => states.map((s) => s.phase);

describe('the touch-down cue', () => {
  it('fires first, synchronously, at the press’s own timestamp', () => {
    const { tr, log, starts } = setup();
    tr.setEnabled(true);
    tr.pointerDown(1, 'touch', { t: 1003.25, x: 300, y: 100 });
    expect(starts).toEqual([1003.25]);
    expect(log).toEqual(['start', 'state:ready']);
  });

  it('a tap commits at the lift with the touch-down timestamp: the physics swing starts where the stroke started', () => {
    for (const durationMs of [16, 40, 80, 120, 200, TAP_HOLD_MS])
      for (const delivery of DELIVERIES) {
        const press = RELEASE + 400;
        const { trace, swing } = play(tapSamples(press, durationMs, { driftPx: 2 }), { delivery });
        const label = `${durationMs} ms, ${delivery.name}`;
        expect(trace.starts.map((s) => s.atPerfMs), label).toEqual([press]);
        expect(trace.intents, label).toHaveLength(1);
        expect(trace.intents[0], label).toMatchObject({ kind: 'defend', atPerfMs: press, pressAtPerfMs: press });
        expect(swing, label).toMatchObject({ kind: 'defend', startT: 0.4 });
        // The cue came first, at the press event itself (plus the delivery's dispatch delay), never at the lift.
        expect(trace.starts[0].reportedAtMs, label).toBe(press + (delivery.latencyMs ?? 0));
        expect(phases(trace.states), label).not.toContain('waiting');
      }
  });

  it('with calibration, the tap’s start is exactly the touch-down minus that modality’s offset', () => {
    const press = RELEASE + 500;
    const { swing } = play(tapSamples(press, 70), { opts: { calibrations: { touch: 63, mouse: 0, pen: 63, keyboard: 0 } } });
    expect(swing!.startT).toBeCloseTo((press - 63 - RELEASE) / 1000, 4);
  });
});

describe('the tap window closing: `waiting`', () => {
  it('a perfectly still press with no samples is told at press + TAP_HOLD_MS + LATE_SAMPLE_WAIT_MS', () => {
    const { tr, clock, states, gestures } = setup();
    tr.setEnabled(true);
    tr.pointerDown(1, 'touch', { t: 1000, x: 300, y: 100 });
    clock.advance(1000 + TAP_HOLD_MS + LATE_SAMPLE_WAIT_MS - 1);
    expect(phases(states)).toEqual(['ready']);
    clock.advance(1000 + TAP_HOLD_MS + LATE_SAMPLE_WAIT_MS);
    expect(phases(states)).toEqual(['ready', 'waiting']);
    expect(states[1]).toMatchObject({ atPerfMs: 1000 + TAP_HOLD_MS, pressAtPerfMs: 1000, timingAtPerfMs: null, committed: false, pathPower: 0 });
    tr.pointerUp(1, { t: 1400, x: 300, y: 100 });
    expect(phases(states)).toEqual(['ready', 'waiting', 'intentional_leave']);
    expect(gestures).toHaveLength(0);
    expect(tr.isArmed()).toBe(true);
  });

  it('is published once, with the same atPerfMs, at every cadence; the lift is intentional_leave and not a shot', () => {
    const press = RELEASE + 300;
    for (const holdMs of [TAP_HOLD_MS + 1, TAP_HOLD_MS + 60, 600])
      for (const delivery of DELIVERIES) {
        const label = `${holdMs} ms, ${delivery.name}`;
        const { trace, swing } = play(tapSamples(press, holdMs, { driftPx: 2 }), { delivery });
        expect(swing, label).toBeNull();
        const waiting = trace.states.filter((s) => s.phase === 'waiting');
        expect(waiting, label).toHaveLength(1);
        expect(waiting[0].atPerfMs, label).toBe(press + TAP_HOLD_MS);
        expect(waiting[0].reportedAtMs, label).toBeGreaterThan(press + TAP_HOLD_MS);
        expect(waiting[0].reportedAtMs, label).toBeLessThanOrEqual(press + TAP_HOLD_MS + LATE_SAMPLE_WAIT_MS + (delivery.latencyMs ?? 0) + (delivery.frameMs ?? 0));
        expect(phases(trace.states).at(-1), label).toBe('intentional_leave');
      }
  });

  it('a lift stamped inside the window but delivered after the notice is still a tap (decided by event time)', () => {
    const { tr, clock, states, gestures, intents } = setup();
    tr.setEnabled(true);
    tr.pointerDown(1, 'touch', { t: 1000, x: 300, y: 100 });
    clock.advance(1000 + TAP_HOLD_MS + LATE_SAMPLE_WAIT_MS + 5);
    expect(phases(states)).toEqual(['ready', 'waiting']);
    tr.pointerUp(1, { t: 1000 + TAP_HOLD_MS - 2, x: 300, y: 100 });
    expect(gestures).toHaveLength(1);
    expect(intents[0]).toMatchObject({ kind: 'defend', atPerfMs: 1000 });
    expect(phases(states)).toEqual(['ready', 'waiting', 'committing', 'released']);
  });

  it('a waited press can still swipe later: an attack from its own start, with no second touch-down cue', () => {
    const { tr, clock, states, gestures, intents, starts } = setup();
    tr.setEnabled(true);
    tr.pointerDown(1, 'touch', { t: 1000, x: 300, y: 150 });
    for (let t = 1016; t <= 1320; t += 16) {
      clock.advance(t);
      tr.pointerMove(1, [{ t, x: 300, y: 150 }]);
    }
    expect(phases(states)).toEqual(['ready', 'waiting']);
    for (let t = 1328; t <= 1400; t += 8) {
      clock.advance(t);
      tr.pointerMove(1, [{ t, x: 300 + (t - 1320) * 0.4, y: 150 - (t - 1320) * 1.4 }]);
    }
    tr.pointerUp(1, { t: 1404, x: 334, y: 31 });
    expect(starts).toEqual([1000]);
    expect(intents).toHaveLength(1);
    expect(intents[0].kind).toBe('attack');
    expect(intents[0].atPerfMs).toBeGreaterThan(1320);
    expect(gestures).toHaveLength(1);
    expect(normalizeGesture(gestures[0], { ...OPTS, releasePerfMs: 900 })!.kind).toBe('attack');
    expect(phases(states).filter((p) => p === 'waiting')).toHaveLength(1);
  });

  it('never for a pullback, a flick or a cancelled press; a cancellation leaves no notice behind', () => {
    const SURFACE = SURFACES.phone;
    const pullback = traceGesture({
      surface: SURFACE,
      samples: [
        { t: 1000, x: 420, y: 50 },
        { t: 1020, x: 420, y: 90 },
        { t: 1040, x: 420, y: 140 },
        ...Array.from({ length: 30 }, (_, k) => ({ t: 1060 + k * 16, x: 420, y: 140 })),
      ],
      lifted: false,
    });
    expect(phases(pullback.states)).toContain('loading');
    expect(phases(pullback.states)).not.toContain('waiting');

    const flick = play(strokeSamples({ lengthPx: 124, bearingDeg: 14, durationMs: 90 }, RELEASE + 200));
    expect(flick.swing?.kind).toBe('attack');
    expect(phases(flick.trace.states)).not.toContain('waiting');

    const { tr, clock, states } = setup();
    tr.setEnabled(true);
    tr.pointerDown(1, 'touch', { t: 1000, x: 300, y: 100 });
    clock.advance(1100);
    tr.pointerCancel(1);
    clock.advance(1600);
    expect(phases(states)).toEqual(['ready', 'cancelled']);
    expect(clock.pending()).toBe(0);
  });

  it('a key chord started beside a waiting finger keeps its own timer when that finger lifts or is cancelled', () => {
    for (const end of ['lift', 'cancel'] as const) {
      const { tr, clock, gestures } = setup();
      tr.setEnabled(true);
      tr.pointerDown(1, 'touch', { t: 1000, x: 300, y: 100 });
      clock.advance(1300);
      tr.pointerMove(1, [{ t: 1300, x: 300, y: 100 }]);
      expect(tr.key('ArrowUp', 1310)).toBe('swing');
      if (end === 'lift') tr.pointerUp(1, { t: 1315, x: 300, y: 100 });
      else tr.pointerCancel(1);
      clock.advance(1400);
      expect(gestures, end).toHaveLength(1);
      expect(gestures[0].pointer, end).toBe('keyboard');
    }
  });
});

describe('no swing starts before its touch-down cue minus calibration', () => {
  it('holds over a seeded corpus of taps, holds, flicks, rests and pullbacks at every cadence', () => {
    const r = rng(20261104);
    const cal = 47;
    let swings = 0;
    for (let i = 0; i < 160; i++) {
      const press = RELEASE + 200 + r.range(0, 400);
      const pick = i % 4;
      const samples =
        pick === 0
          ? tapSamples(press, r.range(10, 400), { driftPx: r.range(0, 4), jitterPx: 0.4 }, r)
          : pick === 1
            ? strokeSamples({ lengthPx: r.range(40, 220), bearingDeg: r.range(-170, 170), durationMs: r.range(40, 160), restMs: r.range(0, 300), jitterPx: 0.4 }, press, r)
            : pick === 2
              ? strokeSamples({ lengthPx: r.range(30, 120), bearingDeg: 180 + r.range(-25, 25), durationMs: r.range(40, 120), holdMs: r.range(0, 200), jitterPx: 0.3 }, press, r)
              : pullbackThenReverse(press, r.range(0, 300), r.range(-40, 40));
      for (const delivery of DELIVERIES) {
        const { trace, swing } = play(samples, { delivery, opts: { calibrationMs: cal } });
        if (!swing) continue;
        swings++;
        expect(trace.starts.length, `${i} ${delivery.name}`).toBeGreaterThan(0);
        const cue = trace.starts[0].atPerfMs;
        expect(swing.startT * 1000 + RELEASE, `${i} ${delivery.name}`).toBeGreaterThanOrEqual(cue - cal - 0.05);
        // The committed intent never names a time before the touch-down either.
        for (const intent of trace.intents) expect(intent.atPerfMs, `${i} ${delivery.name}`).toBeGreaterThanOrEqual(cue);
      }
    }
    expect(swings).toBeGreaterThan(400);
  });
});
