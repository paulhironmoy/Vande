/**
 * The stage works the striker's stride decision out in the spare time of the frames after a result (PERF-3, 2026-11-07),
 * ahead of his reach plan, on the planted-feet hook the frames use; the reach plan only for a script whose camera cuts to him (a
 * miss, a leave or a pad stays in the batter's eye to the end and never poses him). A read before it is made makes it whole.
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
  warmed: WeakSet<object>;
  idleWork(frame: StageFrame, budgetMs: number): void;
};

function ball(startBefore: number, kind: 'attack' | 'defend' = 'attack') {
  // `startBefore` seconds before the ideal contact (negative: after it).
  const eb = overBalls(REFERENCE_OVER, 'balanced')[1];
  const setup: PracticeSceneSetup = { field: eb.field, bowler: eb.over.bowler, conditions: eb.conditions, handedness: 'right' };
  const swing: NormalizedSwing = { kind, startT: Math.max(0, eb.flight.idealContactT - startBefore), directionDeg: 20, power: kind === 'attack' ? 0.6 : 0.2, elevation: 0, footwork: 'auto' };
  const result: DeliveryResult = resolveDelivery({ flight: eb.flight, swing, field: eb.field, bowler: eb.over.bowler, conditions: eb.conditions, handedness: 'right', assist: 'play', tierToleranceMs: 0 });
  return { setup, flight: eb.flight as BallFlight, result };
}

function stage() {
  const s = new ThreePracticeStage();
  const inner = s as unknown as Inner;
  inner.stage = {};
  return inner;
}

const liveFrame = (script: StageFrame['script']): StageFrame => ({ mode: 'live', script, scene: script.practice!.releaseScene + 900, plan: [], clockMs: 0, slow: false, diagnostics: null, bands: null, coachOption: null, closeUpFlight: null });

describe('the stride decision in a result’s spare time', () => {
  it('is made in slices before the reach plan starts, and is the build’s', () => {
    const { setup, flight, result } = ball(0.14);
    const script = buildPracticeScript({ setup, flight, result });
    const p = script.practice!;
    expect(Number.isFinite(p.firstPersonUntil)).toBe(true);
    expect(p.stride).toBeDefined();
    expect(p.stride!.done).toBe(false);
    const eager = buildPracticeScript({ setup, flight, result, sliced: true });
    const inner = stage();
    const frame = liveFrame(script);
    let calls = 0;
    let doneAt = -1;
    while (!inner.warmed.has(script) && calls < 20_000) {
      inner.idleWork(frame, 0.4);
      calls++;
      if (doneAt < 0 && p.stride!.done) doneAt = calls;
      // The reach plan has not started while the decision is not made: nothing marks the script warmed before then.
      if (!p.stride!.done) expect(inner.warmed.has(script)).toBe(false);
    }
    expect(inner.warmed.has(script)).toBe(true);
    // Many slices (a pose a slice at this budget in node), not one.
    expect(doneAt).toBeGreaterThan(5);
    expect(p.stride!.done).toBe(true);
    const json = (x: unknown) => JSON.stringify(x);
    const sk = script.actors.find((a) => a.id === 'striker')!;
    const ek = eager.actors.find((a) => a.id === 'striker')!;
    expect(json(sk.moves)).toBe(json(ek.moves));
    expect(json(sk.physicsBody)).toBe(json(ek.physicsBody));
  });

  it('is made for a script that stays in the batter’s eye (a pad), but builds no reach plan for it: the field inset draws him at the dead ball', () => {
    const { setup, flight, result } = ball(0.7, 'defend');
    const script = buildPracticeScript({ setup, flight, result });
    const p = script.practice!;
    expect(Number.isFinite(p.firstPersonUntil) && p.external !== 'none').toBe(false);
    expect(p.stride).toBeDefined();
    const inner = stage();
    const frame = liveFrame(script);
    let calls = 0;
    while (!inner.warmed.has(script) && calls < 20_000) {
      inner.idleWork(frame, 0.4);
      calls++;
    }
    expect(inner.warmed.has(script)).toBe(true);
    expect(p.stride!.done).toBe(true);
    // Done with the decision, nothing more: the reach plan of a script that cuts takes many slices after it.
    const cut = buildPracticeScript({ setup, flight, result: ball(0.14).result });
    const cutFrame = liveFrame(cut);
    let cutCalls = 0;
    let decided = -1;
    while (!inner.warmed.has(cut) && cutCalls < 20_000) {
      inner.idleWork(cutFrame, 0.4);
      cutCalls++;
      if (decided < 0 && cut.practice!.stride!.done) decided = cutCalls;
    }
    expect(decided).toBeGreaterThan(0);
    expect(cutCalls).toBeGreaterThan(decided + 5);
    expect(calls).toBeLessThanOrEqual(decided + 2);
    const eager = buildPracticeScript({ setup, flight, result, sliced: true });
    expect(JSON.stringify(script.actors.find((a) => a.id === 'striker')!.moves)).toBe(JSON.stringify(eager.actors.find((a) => a.id === 'striker')!.moves));
  });
});
