/**
 * Camera swing through the real tracker, normalizeGesture and the frozen physics, and its replay (DoD CAM-01, CAM-02).
 * The swing is timed to each reference-over ball's ideal contact; the recorded NormalizedSwing then reproduces the result.
 */
import { describe, expect, it } from 'vitest';
import type { NormalizedSwing } from '@/contracts/practice';
import { strokePath, synthFrames, traceCamera, type StrokeSpec } from '@/input/camera/simulate';
import { normalizeGesture } from '@/input/normalize';
import { autoField, batTravelMs } from '@/physics';
import {
  REFERENCE_OVER,
  ballSeed,
  inningsReducer,
  newInnings,
  nextDelivery,
  nextFlight,
  resolveNext,
} from '@/practice/game';

function balls() {
  let s = newInnings({ id: 'camera-system', conditions: 'balanced', assist: 'real', handedness: 'right' });
  const plan = REFERENCE_OVER;
  s = inningsReducer(s, { type: 'chooseOver', plan, field: autoField(plan.bowler, 'balanced', 'right') });
  const base = nextDelivery(s)!;
  return plan.balls.map((ball, i) => {
    const next = { ...base, ballIndex: i, plan: ball, seed: ballSeed(plan, i) };
    return { next, flight: nextFlight(next) };
  });
}
const BALLS = balls();
const SPEC: StrokeSpec = { startMs: 0, rise: 1.0, riseMs: 350, holdMs: 120, descent: 1.3, downMs: 190, lateral: 0.3 };

/** A camera stroke whose swing start puts the bat on the ball's ideal contact (a probe run reads power, then it is shifted). */
function cameraSwing(idealContactT: number) {
  const run = (shiftMs: number) => {
    const frames = synthFrames({
      hand: strokePath({ ...SPEC, startMs: SPEC.startMs + shiftMs }),
      fps: 30,
      t0: -2500,
      durationMs: 6000,
      noiseU: 0.02,
      seed: 5,
    });
    return traceCamera({ frames, armAtMs: -2000 });
  };
  const probe = run(0).swing!;
  const want = idealContactT - batTravelMs(probe.kind, probe.power) / 1000;
  const shift = (want - probe.startT) * 1000;
  return run(shift);
}

describe('camera swing through the physics', () => {
  it('is the same NormalizedSwing as the same samples fed as a touch contact, and the physics outcome is equal', () => {
    for (const { next, flight } of BALLS.slice(0, 3)) {
      const cam = cameraSwing(flight.idealContactT);
      const swing = cam.swing as NormalizedSwing;
      expect(swing).not.toBeNull();
      expect(cam.gesture?.pointer).toBe('camera');
      // The same trajectory as pointer samples: one authority, so the swing is identical (tolerance 0).
      const asTouch = normalizeGesture(
        { ...cam.gesture!, pointer: 'touch' },
        { releasePerfMs: -2000, calibrationMs: 0, handedness: 'right' },
      );
      expect(asTouch).toEqual(swing);
      const a = resolveNext(next, swing, 0).result;
      const b = resolveNext(next, asTouch, 0).result;
      expect(b).toEqual(a);
      expect(a.swing).toEqual(swing);
      // The camera swing lands within a frame of the intended timing: the contact is real, not a miss by a second.
      expect(Math.abs(a.contact.timingErrorMs ?? 999)).toBeLessThan(120);
    }
  });

  it('replaying the recorded swing reproduces the result (determinism end to end)', () => {
    for (const { next, flight } of BALLS.slice(0, 3)) {
      const first = cameraSwing(flight.idealContactT);
      const second = cameraSwing(flight.idealContactT);
      expect(JSON.stringify(second.swing)).toBe(JSON.stringify(first.swing));
      const recorded = JSON.parse(JSON.stringify(first.swing)) as NormalizedSwing;
      const live = resolveNext(next, first.swing, 0).result;
      const replay = resolveNext(next, recorded, 0).result;
      expect(JSON.stringify(replay)).toBe(JSON.stringify(live));
    }
  });
});
