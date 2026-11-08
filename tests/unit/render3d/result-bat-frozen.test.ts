/**
 * A result that comes from the physics worker has crossed postMessage: its bat trace is a thawed, structured-clone copy.
 * `batAt` (frame.ts, frozen with the physics) keeps one prepared track per trace only for a deeply frozen one, so on the
 * web every call re-derived the whole track, and a striker's reach plan makes about 200 calls in one frame (PERF1, I1
 * 2026-11-05: `polynomialDerivatives` 276 ms in the long frames). The stage freezes the trace it is given, in place, and
 * changes no value: what is drawn is bit for bit what it was (bat-exact.test.ts has the corpus).
 */
import { describe, expect, it } from 'vitest';
import type { BatSample, BowlerProfile, CoachOption, DeliveryResult, NormalizedSwing, QualityProfileId } from '@/contracts/practice';
import { autoField, batTravelMs, flight, resolveDelivery } from '@/physics';
import { freezeBatTrace } from '@/render3d/practice/bat';
import { batAt } from '@/render3d/practice/frame';
import { PracticeSessionBase, type StageClock, type StageFrame } from '@/render3d/practice/session';
import type { PracticeMountOptions, PracticeSceneSetup, PracticeSink } from '@/render3d/practice/types';

const PACE: BowlerProfile = { family: 'pace', paceBand: 'fast', arm: 'right', lookSeed: 'frozen-pace' };
const setupOf = (): PracticeSceneSetup => ({ field: autoField(PACE, 'balanced', 'right'), bowler: PACE, conditions: 'balanced', handedness: 'right' });

function resultOf(seed: string, errMs = 0): DeliveryResult {
  const fl = flight({ plan: { variation: 'stock', lengthM: 5, lineM: 0.1, speedKph: 136 }, bowler: PACE, conditions: 'balanced', seed, handedness: 'right' });
  const swing: NormalizedSwing = { kind: 'defend', startT: fl.idealContactT - batTravelMs('defend', 0.2) / 1000 + errMs / 1000, directionDeg: 0, power: 0.2, elevation: 0, footwork: 'auto' };
  return resolveDelivery({ flight: fl, swing, field: setupOf().field, bowler: PACE, conditions: 'balanced', handedness: 'right', assist: 'real', tierToleranceMs: 0 });
}

/** The result as the worker delivers it: a structured-clone copy, nothing frozen. */
function thawed(result: DeliveryResult): DeliveryResult {
  return { ...result, bat: structuredClone(result.bat) as BatSample[] };
}

const deeplyFrozen = (samples: readonly BatSample[]) =>
  Object.isFrozen(samples) && samples.every((s) => Object.isFrozen(s) && Object.isFrozen(s.grip) && Object.isFrozen(s.toe) && Object.isFrozen(s.face));

describe('freezeBatTrace', () => {
  it('freezes a thawed trace in place without changing a value, and does it once', () => {
    const fresh = thawed(resultOf('frozen:a')).bat;
    expect(deeplyFrozen(fresh)).toBe(false);
    const before = JSON.stringify(fresh);
    freezeBatTrace(fresh);
    expect(deeplyFrozen(fresh)).toBe(true);
    expect(JSON.stringify(fresh)).toBe(before);
    freezeBatTrace(fresh);
    expect(deeplyFrozen(fresh)).toBe(true);
    freezeBatTrace(null);
    freezeBatTrace(undefined);
    freezeBatTrace([]);
  });

  it('leaves batAt bit for bit as it was, on a thawed trace and on its frozen copy', () => {
    for (const [seed, err] of [['frozen:b', 0], ['frozen:c', -30], ['frozen:d', 25]] as const) {
      const result = resultOf(seed, err);
      const loose = thawed(result).bat;
      const kept = thawed(result).bat;
      freezeBatTrace(kept);
      const impulse = result.contact.t;
      const first = loose[0].t;
      const last = loose[loose.length - 1].t;
      for (let t = first - 0.01; t <= last + 0.02; t += 0.0007) {
        expect(batAt(kept, t, impulse, null)).toEqual(batAt(loose, t, impulse, null));
        expect(batAt(kept, t)).toEqual(batAt(loose, t));
      }
    }
  });
});

describe('the stage', () => {
  class TestStage extends PracticeSessionBase {
    readonly kind = '3d' as const;
    protected drawFrame(_frame: StageFrame): void {}
    protected applyProfile(_id: QualityProfileId): void {}
    protected rendererName() {
      return 'test';
    }
    protected drawCalls() {
      return 0;
    }
    async mount(_c: HTMLCanvasElement, o: PracticeMountOptions) {
      this.startSession(o);
    }
    async benchmark(): Promise<never> {
      throw new Error('not used');
    }
  }
  const clock: StageClock = { now: () => 1000, raf: () => 1, caf: () => undefined, setTimer: () => 1, clearTimer: () => undefined };
  const sink: PracticeSink = { cue: () => undefined, crowd: () => undefined, feel: () => undefined };

  async function mounted() {
    const stage = new TestStage(clock);
    stage.setSink(sink);
    await stage.mount({} as HTMLCanvasElement, { profile: 'standard', handedness: 'right', reducedMotion: false, learnCue: false });
    stage.setScene(setupOf());
    return stage;
  }

  it('freezes the bat trace of a result it plays, replays or demonstrates, and draws the same values', async () => {
    for (const [name, show] of [
      ['play', (s: TestStage, r: DeliveryResult) => void s.play(r)],
      ['replay', (s: TestStage, r: DeliveryResult) => void s.replay(r)],
      ['demonstrate', (s: TestStage, r: DeliveryResult) => void s.demonstrate(r, {} as CoachOption)],
    ] as const) {
      const stage = await mounted();
      const result = thawed(resultOf(`frozen:stage:${name}`));
      const values = JSON.stringify(result.bat);
      expect(deeplyFrozen(result.bat), name).toBe(false);
      show(stage, result);
      expect(deeplyFrozen(result.bat), name).toBe(true);
      expect(JSON.stringify(result.bat), name).toBe(values);
    }
  });
});
