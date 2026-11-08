import { describe, expect, it } from 'vitest';
import type { GestureInput, GestureSample } from '@/contracts/practice';
import {
  GestureTracker,
  normalizeGesture,
  readOneContact,
  traceGesture,
  type OneGestureState,
  type TrackerScheduler,
} from '@/input';

const SURFACE = { width: 915, height: 190 };
const RELEASE = 900;
const OPTIONS = { releasePerfMs: RELEASE, calibrationMs: 0, handedness: 'right' as const };

function contact(
  args: {
    holdMs?: number;
    pullbackPx?: number;
    lateralPx?: number;
    forwardPx?: number;
    forwardMs?: number;
    upAtMs?: number;
  } = {},
): GestureSample[] {
  const hold = args.holdMs ?? 80;
  const pullback = args.pullbackPx ?? 90;
  const lateral = args.lateralPx ?? 0;
  const forward = args.forwardPx ?? 105;
  const forwardMs = args.forwardMs ?? 56;
  const t0 = 1000;
  const loadEnd = t0 + 48;
  const commitBase = loadEnd + hold;
  const x0 = 420;
  const y0 = 55;
  const loadedY = y0 + pullback;
  const loadedX = x0 + lateral;
  const out: GestureSample[] = [
    { t: t0, x: x0, y: y0 },
    { t: t0 + 16, x: x0, y: y0 + pullback / 3 },
    { t: t0 + 32, x: x0, y: y0 + (2 * pullback) / 3 },
    { t: loadEnd, x: x0, y: loadedY },
  ];
  if (hold > 0) {
    out.push({ t: loadEnd + hold / 2, x: x0 + lateral / 2, y: loadedY });
    out.push({ t: commitBase, x: loadedX, y: loadedY });
  }
  for (const u of [0.25, 0.5, 0.75, 1])
    out.push({ t: commitBase + forwardMs * u, x: loadedX + 36 * u, y: loadedY - forward * u });
  out.push({ t: args.upAtMs ?? commitBase + Math.max(90, forwardMs + 30), x: loadedX + 36, y: loadedY - forward });
  return out;
}

function normal(input: GestureInput) {
  return normalizeGesture(input, OPTIONS)!;
}

describe('canonical one-continuous-contact batting control', () => {
  it('moves ready -> loading/tracking -> committing, emits from the stable forward read, and release only closes it', () => {
    const samples = contact({ holdMs: 96 });
    const result = traceGesture({ surface: SURFACE, samples });
    const phases = result.states.map((s) => s.phase);
    expect(phases[0]).toBe('ready');
    expect(phases).toContain('loading');
    expect(phases).toContain('tracking');
    expect(phases).toContain('committing');
    expect(phases.at(-1)).toBe('released');
    expect(
      result.states.filter((s) => s.phase === 'loading' || s.phase === 'tracking').every((s) => s.pathPower === 0),
    ).toBe(true);
    expect(result.gesture).not.toBeNull();
    expect(result.emittedAtMs).not.toBeNull();
    expect(result.emittedAtMs!).toBeLessThan(samples.at(-1)!.t);

    const commit = result.states.find((s) => s.phase === 'committing')!;
    const swing = normal(result.gesture!);
    expect(commit.committed).toBe(true);
    expect(commit.pathPower).toBeGreaterThan(0);
    expect(commit.timingAtPerfMs).not.toBeNull();
    expect(result.emittedAtMs! - commit.timingAtPerfMs!).toBeGreaterThanOrEqual(30);
    expect(result.emittedAtMs! - commit.timingAtPerfMs!).toBeLessThanOrEqual(50);
    expect(swing.startT).toBeCloseTo((commit.timingAtPerfMs! - RELEASE) / 1000, 4);
    expect(swing.kind).toBe('attack');
    expect(swing.directionDeg).toBeGreaterThan(0);
    expect(swing.power).toBeGreaterThan(0);
  });

  it('excludes optional hold time from direction, power and elevation while retaining its real timing', () => {
    const immediate = traceGesture({ surface: SURFACE, samples: contact({ holdMs: 0 }) });
    const patient = traceGesture({ surface: SURFACE, samples: contact({ holdMs: 240 }) });
    const a = normal(immediate.gesture!);
    const b = normal(patient.gesture!);
    expect(b.startT - a.startT).toBeCloseTo(0.24, 3);
    expect(b.directionDeg).toBe(a.directionDeg);
    expect(b.power).toBe(a.power);
    expect(b.elevation).toBe(a.elevation);
  });

  it('normalizes identically with coalesced 30, 60 and 120 Hz dispatch', () => {
    const samples = contact({ holdMs: 88, lateralPx: 18 });
    const swings = [120, 60, 30].map((hz) => {
      const result = traceGesture({ surface: SURFACE, samples, frameMs: 1000 / hz, coalesced: true });
      expect(result.gesture, `${hz} Hz`).not.toBeNull();
      expect(
        result.states.filter((s) => s.phase === 'released'),
        `${hz} Hz release`,
      ).toHaveLength(1);
      return normal(result.gesture!);
    });
    expect(swings[1]).toEqual(swings[0]);
    expect(swings[2]).toEqual(swings[0]);
  });

  it('keeps held lateral travel as visible expert stance intent without turning it into aim correction', () => {
    const samples = contact({ holdMs: 120, lateralPx: 24 });
    const result = traceGesture({ surface: SURFACE, samples, pressFootwork: true });
    const tracking = result.states.findLast((s) => s.phase === 'tracking')!;
    expect(tracking.lateralAdjustment).toBeGreaterThan(0);
    expect(result.gesture!.footwork).toBe('across');
    // Direction remains the forward stroke's own bearing, independent of where the held stance moved.
    expect(normal(result.gesture!).directionDeg).toBeCloseTo((Math.atan2(36, 105) * 180) / Math.PI, 0);
  });

  it('maps forward path velocity to power and pullback depth plus forward travel to elevation intent', () => {
    const fast = traceGesture({ surface: SURFACE, samples: contact({ pullbackPx: 120, forwardMs: 48 }) });
    const slow = traceGesture({ surface: SURFACE, samples: contact({ pullbackPx: 120, forwardMs: 120 }) });
    const shallow = traceGesture({ surface: SURFACE, samples: contact({ pullbackPx: 24, forwardMs: 48 }) });
    const fastRead = readOneContact(fast.gesture!)!;
    const slowRead = readOneContact(slow.gesture!)!;
    expect(fastRead.forwardVelocity).toBeGreaterThan(slowRead.forwardVelocity);
    expect(normal(fast.gesture!).power).toBeGreaterThan(normal(slow.gesture!).power);
    expect(fastRead.pullbackDepth).toBeGreaterThan(readOneContact(shallow.gesture!)!.pullbackDepth);
    expect(normal(fast.gesture!).elevation).toBeGreaterThan(normal(shallow.gesture!).elevation);
  });

  it('treats a loaded contact released without reversal as an intentional leave, never as a weak shot', () => {
    const samples = contact({ forwardPx: 0 }).slice(0, 6);
    const last = samples.at(-1)!;
    samples.push({ ...last, t: last.t + 50 });
    const result = traceGesture({ surface: SURFACE, samples });
    expect(result.gesture).toBeNull();
    expect(result.states.at(-1)?.phase).toBe('intentional_leave');
    expect(result.states.at(-1)?.committed).toBe(false);
  });

  it('cancels before reversal but cannot undo a forward stroke after its commitment boundary', () => {
    let now = 1000;
    const sched: TrackerScheduler = { now: () => now, setTimer: () => 1, clearTimer: () => undefined };
    const run = (afterCommit: boolean) => {
      const gestures: GestureInput[] = [];
      const states: OneGestureState[] = [];
      let cancellations = 0;
      const tracker = new GestureTracker(
        {
          swingStart: () => undefined,
          gesture: (g) => gestures.push(g),
          cancel: () => cancellations++,
          state: (s) => states.push(s),
        },
        sched,
      );
      tracker.setSurface(SURFACE.width, SURFACE.height);
      tracker.setEnabled(true);
      tracker.pointerDown(1, 'touch', { t: 1000, x: 420, y: 50 });
      tracker.pointerMove(1, [
        { t: 1020, x: 420, y: 90 },
        { t: 1040, x: 420, y: 140 },
      ]);
      if (afterCommit) {
        now = 1070;
        tracker.pointerMove(1, [
          { t: 1060, x: 425, y: 115 },
          { t: 1070, x: 430, y: 90 },
        ]);
      }
      tracker.pointerCancel(1);
      return { tracker, gestures, states, cancellations };
    };

    const before = run(false);
    expect(before.gestures).toHaveLength(0);
    expect(before.cancellations).toBe(1);
    expect(before.tracker.isArmed()).toBe(true);
    expect(before.states.at(-1)).toMatchObject({ phase: 'cancelled', committed: false });

    const after = run(true);
    expect(after.gestures).toHaveLength(1);
    expect(after.cancellations).toBe(0);
    expect(after.tracker.isArmed()).toBe(false);
    expect(after.states.at(-1)).toMatchObject({ phase: 'cancelled', committed: true });
    expect(normal(after.gestures[0]).kind).toBe('attack');
  });

  it('does not leak a cancelled contact’s lateral footwork into the retry, while retaining keyboard footwork', () => {
    const gestures: GestureInput[] = [];
    const tracker = new GestureTracker({ swingStart: () => undefined, gesture: (g) => gestures.push(g) });
    tracker.setSurface(SURFACE.width, SURFACE.height);
    tracker.setPressFootwork(true);
    tracker.setEnabled(true);

    // Load and refine laterally far enough to select across, then lose the contact before forward commitment.
    tracker.pointerDown(1, 'touch', { t: 1000, x: 420, y: 55 });
    tracker.pointerMove(1, [
      { t: 1020, x: 420, y: 95 },
      { t: 1040, x: 420, y: 145 },
      { t: 1080, x: 444, y: 145 },
    ]);
    expect(tracker.footwork()).toBe('across');
    tracker.pointerCancel(1);

    // A fresh middle-band tap asks for automatic footwork and must not inherit the cancelled contact's choice.
    tracker.pointerDown(2, 'touch', { t: 1120, x: 420, y: 95 });
    tracker.pointerUp(2, { t: 1160, x: 420, y: 95 });
    expect(gestures).toHaveLength(1);
    expect(gestures[0].footwork).toBe('auto');

    // Keyboard footwork is explicitly delivery-scoped, so it survives the same cancellation boundary.
    tracker.rearm();
    expect(tracker.key('KeyW', 1200)).toBe('footwork');
    tracker.pointerDown(3, 'touch', { t: 1220, x: 420, y: 55 });
    tracker.pointerMove(3, [
      { t: 1240, x: 420, y: 100 },
      { t: 1260, x: 420, y: 145 },
      { t: 1300, x: 444, y: 145 },
    ]);
    tracker.pointerCancel(3);
    tracker.pointerDown(4, 'touch', { t: 1320, x: 420, y: 95 });
    tracker.pointerUp(4, { t: 1360, x: 420, y: 95 });
    expect(gestures).toHaveLength(2);
    expect(gestures[1].footwork).toBe('forward');
  });

  it('emits exactly one authoritative swing for a contact even when moves, release and cancellation follow', () => {
    const gestures: GestureInput[] = [];
    const tracker = new GestureTracker({ swingStart: () => undefined, gesture: (g) => gestures.push(g) });
    tracker.setSurface(SURFACE.width, SURFACE.height);
    tracker.setEnabled(true);
    const samples = contact({ holdMs: 80 });
    tracker.pointerDown(9, 'touch', samples[0]);
    for (const sample of samples.slice(1, -1)) tracker.pointerMove(9, [sample]);
    expect(gestures).toHaveLength(1);
    tracker.pointerMove(9, [{ t: samples.at(-1)!.t - 5, x: 500, y: 20 }]);
    tracker.pointerUp(9, samples.at(-1)!);
    tracker.pointerCancel(9);
    expect(gestures).toHaveLength(1);
  });

  it('preserves quick-release defence, keyboard equivalence and established one-way flick compatibility', () => {
    const tap = traceGesture({
      surface: SURFACE,
      samples: [
        { t: 1000, x: 400, y: 80 },
        { t: 1060, x: 401, y: 80 },
      ],
    });
    expect(normal(tap.gesture!)).toMatchObject({ kind: 'defend', startT: 0.1 });
    expect(tap.states.map((s) => s.phase)).toEqual(['ready', 'committing', 'released']);

    const gestures: GestureInput[] = [];
    const tracker = new GestureTracker({ swingStart: () => undefined, gesture: (g) => gestures.push(g) });
    tracker.setSurface(SURFACE.width, SURFACE.height);
    tracker.setEnabled(true);
    tracker.key('Space', 1000);
    expect(normal(gestures[0])).toEqual(normal(tap.gesture!));

    const legacy: GestureInput = {
      pointer: 'touch',
      surface: SURFACE,
      samples: [
        { t: 1000, x: 400, y: 140 },
        { t: 1040, x: 420, y: 90 },
        { t: 1080, x: 440, y: 40 },
      ],
    };
    expect(readOneContact(legacy)).toBeNull();
    expect(normal(legacy)).toMatchObject({ kind: 'attack' });
  });
});
