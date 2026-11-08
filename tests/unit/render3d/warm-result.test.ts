/**
 * The dry run of the result path (PERF-2, 2026-11-07; ThreePracticeStage.warmResult): before the first ball, in spare
 * slices of frames, the stage builds a throwaway result's scripts, gaze, camera, bat and poses on a scratch skeleton, so
 * the first real result does not pay for compiling them (133-250 ms in `play()` on a 4x throttled phone). It must
 * finish, run in slices (never a frame's worth at once), touch nothing a delivery uses (not the live delivery, the
 * Director, the sounds, the pose-hook cache of a real script), run once, and stop for a real result.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BallFlight, DeliveryResult, NormalizedSwing } from '@/contracts/practice';
import { ThreePracticeStage } from '@/render3d/three/ThreePracticeStage';
import type { StageFrame } from '@/render3d/practice/session';
import { buildPracticeScript } from '@/render3d/practice/script';
import type { PracticeSceneSetup } from '@/render3d/practice/types';
import { overBalls } from '@/practice/game/evaluate';
import { REFERENCE_OVER } from '@/practice/game/reference';
import { resolveDelivery } from '@/physics/resolve';

let lib: typeof import('@/render3d/core/motion/library');
beforeAll(async () => {
  lib = await import('@/render3d/core/motion/library');
  const { readFile } = await import('node:fs/promises');
  lib.resetMotionLibrary();
  await lib.loadMotionPacks('/practice/motion/', async (url) => {
    try {
      const b = await readFile(`public/practice/motion/${url.split('/').pop()}`);
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
    } catch {
      return null;
    }
  });
  lib.commitMotion();
});
afterAll(() => lib.resetMotionLibrary());

type Inner = {
  stage: unknown;
  warmJob: Generator<void, void, void> | null;
  live: unknown;
  hookCache: WeakMap<object, unknown>;
  hands: Map<string, unknown>;
  idleWork(frame: StageFrame, budgetMs: number): void;
  releaseHand(setup: PracticeSceneSetup): undefined;
  onScript(script: StageFrame['script'], kind: string, prev: StageFrame['script'] | null): void;
};

function ball() {
  const eb = overBalls(REFERENCE_OVER, 'balanced')[1];
  const setup: PracticeSceneSetup = { field: eb.field, bowler: eb.over.bowler, conditions: eb.conditions, handedness: 'right' };
  const swing: NormalizedSwing = { kind: 'attack', startT: Math.max(0, eb.flight.idealContactT - 0.14), directionDeg: 20, power: 0.6, elevation: 0, footwork: 'auto' };
  const result: DeliveryResult = resolveDelivery({ flight: eb.flight, swing, field: eb.field, bowler: eb.over.bowler, conditions: eb.conditions, handedness: 'right', assist: 'play', tierToleranceMs: 0 });
  return { setup, flight: eb.flight as BallFlight, result };
}

/** A stage with no WebGL: the dry run touches none, and the release hand is not measured on a rig. */
function stageWithoutGl() {
  const s = new ThreePracticeStage();
  const inner = s as unknown as Inner;
  inner.stage = {};
  inner.releaseHand = () => undefined;
  return { s, inner };
}

const idleFrame = (setup: PracticeSceneSetup): StageFrame => ({ mode: 'idle', script: buildPracticeScript({ setup, flight: null }), scene: 0, plan: [], clockMs: 0, slow: false, diagnostics: null, bands: null, coachOption: null, closeUpFlight: null });

describe('the dry run of the result path', () => {
  it('finishes in slices on spare time, once, and leaves the stage as it was', () => {
    const { setup, flight, result } = ball();
    const { s, inner } = stageWithoutGl();
    const frame = idleFrame(setup);
    const director = s.director;
    s.warmResult(result, flight, setup);
    expect(inner.warmJob).not.toBeNull();
    // A second ask while it runs, or after, changes nothing.
    const job = inner.warmJob!;
    s.warmResult(result, flight, setup);
    expect(inner.warmJob).toBe(job);
    let steps = 0;
    const next = job.next.bind(job);
    job.next = ((...a: []) => (steps++, next(...a))) as typeof job.next;
    let slices = 0;
    while (inner.warmJob && slices < 5000) {
      inner.idleWork(frame, 0.6);
      slices++;
    }
    expect(inner.warmJob).toBeNull();
    // It is many small steps (the build pauses after each fielder, each pose of the stride decision, each camera frame...),
    // taken as many as a frame's spare time holds: never one frame's worth at once.
    expect(steps).toBeGreaterThan(100);
    expect(slices).toBeGreaterThan(1);
    s.warmResult(result, flight, setup);
    expect(inner.warmJob).toBeNull();
    // Nothing of a delivery was touched: no live delivery, nothing registered with the Director, no hook built for the frame's script.
    expect(inner.live).toBeNull();
    expect(director.busy).toBe(false);
    expect(inner.hookCache.has(frame.script)).toBe(false);
    expect(inner.hands.size).toBe(0);
  }, 120_000);

  it('is not run in a frame that has no spare time, and stops for a real result', () => {
    const { setup, flight, result } = ball();
    const { s, inner } = stageWithoutGl();
    const frame = idleFrame(setup);
    s.warmResult(result, flight, setup);
    // No spare time (the session does not even call idleWork under 1 ms; and under 0.5 ms the dry run takes none).
    for (let k = 0; k < 20; k++) inner.idleWork(frame, 0.4);
    expect(inner.warmJob).not.toBeNull();
    inner.idleWork(frame, 4);
    expect(inner.warmJob).not.toBeNull();
    // A real delivery's result ends it.
    const real = buildPracticeScript({ setup, flight, result });
    inner.onScript(real, 'result', null);
    expect(inner.warmJob).toBeNull();
  });

  it('never throws out of a frame, whatever the result is', () => {
    const { setup, flight, result } = ball();
    const { s, inner } = stageWithoutGl();
    const frame = idleFrame(setup);
    // A result that is not one: the build fails inside the dry run; the frame carries on and the dry run is dropped.
    s.warmResult({ ...result, ball: undefined as never, bat: undefined as never, events: undefined as never }, flight, setup);
    for (let k = 0; k < 400 && inner.warmJob; k++) expect(() => inner.idleWork(frame, 4)).not.toThrow();
    expect(inner.warmJob).toBeNull();
  });
});
