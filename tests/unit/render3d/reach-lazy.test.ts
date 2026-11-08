/**
 * The striker's reach plan is worked out on demand (PERF-3, 2026-11-07; humansHook.ts ReachPlan): a frame makes the samples
 * of the bat's need about its time, a correction is smoothed from the samples around it, and `warmHumans(.., from)` makes
 * them ahead of the frame that needs them, from the camera cut on. A sample is a pure function of (track, index), so
 * whatever order the frames ask in, and whether or not the plan was warmed (from the start, from the cut, in slices of one
 * sample), every pose is the same bit for bit.
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

const PACE: BowlerProfile = { family: 'pace', paceBand: 'fast', arm: 'right', lookSeed: 'lazy-pace' };
const SPIN: BowlerProfile = { family: 'spin', spinType: 'finger', arm: 'right', lookSeed: 'lazy-spin' };

function scriptFor(hand: 'right' | 'left', bowler: BowlerProfile, lengthM: number, errMs: number, kind: 'attack' | 'defend'): BallScript {
  const setup = { field: autoField(bowler, 'balanced', hand), bowler, conditions: 'balanced' as const, handedness: hand };
  const fl = flight({ plan: { variation: 'stock', lengthM, lineM: 0.1, speedKph: bowler.family === 'spin' ? 86 : 138 }, bowler, conditions: 'balanced', seed: `lazy:${hand}:${lengthM}:${errMs}`, handedness: hand });
  const startT = fl.idealContactT - batTravelMs(kind, kind === 'attack' ? 0.6 : 0.2) / 1000 + errMs / 1000;
  const swing: NormalizedSwing = { kind, startT, directionDeg: kind === 'attack' ? 35 : 0, power: kind === 'attack' ? 0.6 : 0.2, elevation: 0, footwork: 'auto' };
  const result = resolveDelivery({ flight: fl, swing, field: setup.field, bowler, conditions: 'balanced', handedness: hand, assist: 'real', tierToleranceMs: 0 });
  const pre = buildPracticeScript({ setup, flight: fl });
  const press = simToScene(pre.practice!.bat, startT);
  const script = buildPracticeScript({ setup, flight: fl, result, provisionalStart: press, resultAt: press + 70 });
  script.practice!.bat = { ...script.practice!.bat, touch: { start: press, end: press + 250, commitAt: press + 62, state: null, ball: fl.samples } };
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

const bits = (a: ArrayLike<number>, b: ArrayLike<number>) => a.length === b.length && Array.from({ length: a.length }).every((_, i) => Object.is(a[i], b[i]));

describe('the reach plan on demand', () => {
  it('is the same in any order of asking, warmed or not, from the start or from the cut', () => {
    let checked = 0;
    let slices = 0;
    for (const hand of ['right', 'left'] as const)
      for (const [bowler, lengthM, errMs, kind] of [[PACE, 4, -20, 'defend'], [PACE, 7, 25, 'attack'], [SPIN, 5, 0, 'defend'], [PACE, 2, -60, 'attack']] as const) {
        const forward = scriptFor(hand, bowler, lengthM, errMs, kind);
        const reverse = scriptFor(hand, bowler, lengthM, errMs, kind);
        const warmedCut = scriptFor(hand, bowler, lengthM, errMs, kind);
        const warmedAll = scriptFor(hand, bowler, lengthM, errMs, kind);
        const track = (s: BallScript) => s.actors.find((a) => a.id === 'striker')!;
        const [hf, hr, hc, ha] = [forward, reverse, warmedCut, warmedAll].map(hookOf);
        const cut = (warmedCut.practice!.firstPersonUntil as number);
        // The plan of one script made ahead of the frames in slices of a sample, from the cut; another from the start.
        let done = false;
        while (!done) {
          done = warmHumans(warmedCut, track(warmedCut), 0, Number.isFinite(cut) ? cut : undefined);
          slices++;
          expect(slices).toBeLessThan(200_000);
        }
        done = false;
        while (!done) done = warmHumans(warmedAll, track(warmedAll), 0);
        const t0 = (forward.practice!.releaseScene as number) - 300;
        const times: number[] = [];
        for (let t = t0; t < t0 + 3600; t += 23) times.push(t);
        const pose = (h: typeof hf, s: BallScript, t: number) => {
          const p = createPose();
          h(track(s), p, t);
          return p;
        };
        // The forward script is asked in order; the reverse one backwards; the warmed ones in a scrambled order.
        const want = times.map((t) => pose(hf, forward, t));
        const scrambled = times.map((_, i) => i).sort((a, b) => ((a * 2654435761) >>> 0) % 997 - ((b * 2654435761) >>> 0) % 997 || a - b);
        const got: Array<ReturnType<typeof pose>> = [];
        for (let i = times.length - 1; i >= 0; i--) got[i] = pose(hr, reverse, times[i]);
        const gotCut: Array<ReturnType<typeof pose>> = [];
        const gotAll: Array<ReturnType<typeof pose>> = [];
        for (const i of scrambled) {
          gotCut[i] = pose(hc, warmedCut, times[i]);
          gotAll[i] = pose(ha, warmedAll, times[i]);
        }
        times.forEach((t, i) => {
          for (const [name, g] of [['reverse', got], ['warmed from the cut', gotCut], ['warmed from the start', gotAll]] as const) {
            expect(bits(g[i].q, want[i].q), `${hand} ${bowler.lookSeed} ${lengthM} ${kind} ${name} bones t=${Math.round(t)}`).toBe(true);
            expect(bits(g[i].root, want[i].root), `${hand} ${bowler.lookSeed} ${lengthM} ${kind} ${name} root t=${Math.round(t)}`).toBe(true);
          }
          checked++;
        });
      }
    expect(checked).toBeGreaterThan(8 * 140);
    // Warming goes a sample at a time, not the whole plan in one call.
    expect(slices).toBeGreaterThan(8 * 40);
  }, 120_000);
});
