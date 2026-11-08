/**
 * The striker's reach plan (core/motion/humansHook.ts) can be built ahead of the frame that first poses him, a few
 * samples per call (`warmHumans`), because a camera cut to him otherwise builds all of it in one frame (PERF1: 150 to
 * 280 ms at 4x CPU). Each sample is a pure function of (track, t), so the plan, and every pose it makes, must be the
 * same bit for bit however it is sliced: here, one sample per call against one call.
 */
import { describe, expect, it } from 'vitest';
import type { BowlerProfile, NormalizedSwing } from '@/contracts/practice';
import { autoField, batTravelMs, flight, resolveDelivery } from '@/physics';
import { externalBatPose } from '@/render3d/practice/bat';
import { simToScene } from '@/render3d/practice/frame';
import { buildPracticeScript } from '@/render3d/practice/script';
import { humansPoseHookFor, warmHumans } from '@/render3d/core/motion/humansHook';
import { createPose } from '@/render3d/core/clips';
import { lookScale, type ActorTrack } from '@/render3d/core/actors';
import type { BallScript } from '@/render3d/core/choreo';

const PACE: BowlerProfile = { family: 'pace', paceBand: 'fast', arm: 'right', lookSeed: 'warm-pace' };
const SPIN: BowlerProfile = { family: 'spin', spinType: 'finger', arm: 'right', lookSeed: 'warm-spin' };

function scriptFor(hand: 'right' | 'left', bowler: BowlerProfile, lengthM: number, errMs: number): BallScript {
  const setup = {
    field: autoField(bowler, 'balanced', hand),
    bowler,
    conditions: 'balanced' as const,
    handedness: hand,
  };
  const fl = flight({
    plan: { variation: 'stock', lengthM, lineM: 0.1, speedKph: bowler.family === 'spin' ? 86 : 138 },
    bowler,
    conditions: 'balanced',
    seed: `warm:${hand}:${lengthM}:${errMs}`,
    handedness: hand,
  });
  const startT = fl.idealContactT - batTravelMs('defend', 0.2) / 1000 + errMs / 1000;
  const swing: NormalizedSwing = {
    kind: 'defend',
    startT,
    directionDeg: 0,
    power: 0.2,
    elevation: 0,
    footwork: 'auto',
  };
  const result = resolveDelivery({
    flight: fl,
    swing,
    field: setup.field,
    bowler,
    conditions: 'balanced',
    handedness: hand,
    assist: 'real',
    tierToleranceMs: 0,
  });
  const pre = buildPracticeScript({ setup, flight: fl });
  const press = simToScene(pre.practice!.bat, startT);
  const script = buildPracticeScript({ setup, flight: fl, result, provisionalStart: press, resultAt: press + 70 });
  script.practice!.bat = {
    ...script.practice!.bat,
    touch: { start: press, end: press + 250, commitAt: press + 62, state: null, ball: fl.samples },
  };
  return script;
}
function hookOf(script: BallScript) {
  const p = script.practice!;
  const batOf = (track: ActorTrack, t: number) => {
    if (track.id !== 'striker') return null;
    const b = externalBatPose(p.bat, track, t, lookScale(track.look));
    return b ? { grip: b.grip, toe: b.toe } : null;
  };
  return humansPoseHookFor(script, { batOf });
}

describe('sliced reach plan', () => {
  it('is bit-identical to the one-shot plan, and slices really are small', () => {
    let slices = 0;
    for (const hand of ['right', 'left'] as const)
      for (const [bowler, lengthM, errMs] of [
        [PACE, 4, -20],
        [PACE, 7, 25],
        [SPIN, 5, 0],
        [PACE, 2, -60],
      ] as const) {
        const a = scriptFor(hand, bowler, lengthM, errMs);
        const b = scriptFor(hand, bowler, lengthM, errMs);
        const ha = hookOf(a);
        const hb = hookOf(b);
        const sa = a.actors.find((x) => x.id === 'striker')!;
        const sb = b.actors.find((x) => x.id === 'striker')!;
        let done = false;
        while (!done) {
          done = warmHumans(b, sb, 0);
          slices++;
          expect(slices).toBeLessThan(100_000);
        }
        const t0 = (a.practice!.releaseScene as number) - 300;
        for (let t = t0; t < t0 + 3500; t += 17) {
          const pa = createPose();
          const pb = createPose();
          ha(sa, pa, t);
          hb(sb, pb, t);
          expect(Array.from(pb.q)).toEqual(Array.from(pa.q));
          expect(pb.root).toEqual(pa.root);
        }
      }
    expect(slices).toBeGreaterThan(8 * 100);
  });
});
