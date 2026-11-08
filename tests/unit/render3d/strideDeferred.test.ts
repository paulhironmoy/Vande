/**
 * The striker's stride decision waits for the frame that needs it (PERF-3, 2026-11-07; script.ts deferStride). It is
 * more than half of the work of building a result's script, and the first-person camera does not draw the striker until it cuts
 * away, so the build leaves it: his moves and physics body wait on it, the stage works it out in the spare time of the
 * frames (`PracticeInfo.stride.advance`), and a read of either makes it, whole. Whenever and however it is made, the script
 * and every pose of the striker must be what the build that made it at once gave (`sliced`: the eager build): 600
 * deliveries, both hands, every footwork, with and without runs, governed and natural.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BallFlight, DeliveryResult, Footwork, Handedness, NormalizedSwing } from '@/contracts/practice';
import { evaluateActor, lookScale, type ActorTrack } from '@/render3d/core/actors';
import { createPose, mirrorSampledPose, samplePresented } from '@/render3d/core/clips';
import { humansPoseHookFor } from '@/render3d/core/motion/humansHook';
import { externalBatPose } from '@/render3d/practice/bat';
import { buildPracticeScript } from '@/render3d/practice/script';
import type { PracticeSceneSetup } from '@/render3d/practice/types';
import { evalOvers, overBalls, type EvalBall } from '@/practice/game/evaluate';
import { REFERENCE_OVER } from '@/practice/game/reference';
import { batTravelMs } from '@/physics/bat';
import { autoField } from '@/physics/field';
import { flight as physicsFlight } from '@/physics/delivery';
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

interface Case {
  label: string;
  setup: PracticeSceneSetup;
  flight: BallFlight;
  result: DeliveryResult;
  afterRelease: number;
}

const setupOf = (eb: EvalBall, hand: Handedness): PracticeSceneSetup => ({
  field: hand === 'right' ? eb.field : autoField(eb.over.bowler, eb.conditions, 'left', eb.over.ball),
  bowler: eb.over.bowler,
  conditions: eb.conditions,
  handedness: hand,
});

function corpus(): Case[] {
  const out: Case[] = [];
  let k = 0;
  const footworks: Footwork[] = ['auto', 'forward', 'back', 'across', 'down_track'];
  const add = (label: string, eb: EvalBall, hand: Handedness, fl: BallFlight, swing: NormalizedSwing | null) => {
    const setup = setupOf(eb, hand);
    const result = resolveDelivery({
      flight: fl,
      swing,
      field: setup.field,
      bowler: eb.over.bowler,
      conditions: eb.conditions,
      handedness: hand,
      assist: 'play',
      tierToleranceMs: 0,
    });
    out.push({
      label,
      setup,
      flight: fl,
      result,
      afterRelease: swing ? swing.startT * 1000 + 40 : fl.stumpsT * 1000 + 300,
    });
  };
  const swingOf = (fl: BallFlight, n: number): NormalizedSwing => {
    const kind = n % 3 === 0 ? 'attack' : 'defend';
    const power = kind === 'attack' ? 0.35 + ((n * 17) % 60) / 100 : 0.2;
    return {
      kind,
      startT: fl.idealContactT - batTravelMs(kind, power) / 1000 + (((n * 37) % 161) - 80) / 1000,
      directionDeg: ((n * 53) % 140) - 70,
      power,
      elevation: (n % 5) / 8,
      footwork: footworks[n % footworks.length],
    };
  };
  for (const eb of overBalls(REFERENCE_OVER, 'balanced'))
    for (let v = 0; v < 6; v++)
      add(`ref-${eb.ballIndex + 1} #${v}`, eb, 'right', eb.flight, v === 5 ? null : swingOf(eb.flight, k++));
  for (const difficulty of ['beginner', 'club', 'expert'] as const) {
    for (const family of ['pace', 'spin'] as const) {
      evalOvers({ difficulty, overs: 4, key: `stride-deferred|${difficulty}|${family}`, family }).forEach((over, oi) =>
        over.forEach((eb) => {
          const hand: Handedness = oi % 2 === 1 ? 'left' : 'right';
          const fl =
            hand === 'right'
              ? eb.flight
              : physicsFlight({
                  plan: eb.over.balls[eb.ballIndex],
                  bowler: eb.over.bowler,
                  conditions: eb.conditions,
                  seed: eb.seed,
                  ball: eb.over.ball,
                  handedness: 'left',
                });
          for (let v = 0; v < 4; v++)
            add(
              `${difficulty} ${family} over ${oi + 1} ball ${eb.ballIndex + 1} ${hand} #${v}`,
              eb,
              hand,
              fl,
              v === 3 ? null : swingOf(fl, k++),
            );
        }),
      );
    }
  }
  return out;
}

const json = (x: unknown) =>
  JSON.stringify(x, (k, v) => (k === 'result' || k === 'flight' || k === 'samples' ? undefined : v));
const bitsEqual = (a: ArrayLike<number>, b: ArrayLike<number>) =>
  a.length === b.length && Array.from({ length: a.length }).every((_, i) => Object.is(a[i], b[i]));

describe('the deferred stride decision', () => {
  const cases = corpus();

  it('is the eager build, whenever it is made: the script and the striker, 600 deliveries', () => {
    expect(cases.length).toBeGreaterThanOrEqual(600);
    let waiting = 0;
    let governed = 0;
    let withRuns = 0;
    for (const c of cases) {
      const lazy = buildPracticeScript({ setup: c.setup, flight: c.flight, result: c.result });
      const eager = buildPracticeScript({ setup: c.setup, flight: c.flight, result: c.result, sliced: true });
      const stride = lazy.practice!.stride;
      // Only a swing has a decision; the eager build never defers.
      expect(Boolean(eager.practice!.stride), c.label).toBe(false);
      if (stride) {
        waiting++;
        expect(stride.done, c.label).toBe(false);
      } else {
        // Without a swing there is none; with one it was not deferred only when the build's other steps depended on it.
        expect(c.result.swing === null || lazy.actors.length > 0, c.label).toBe(true);
      }
      // A read makes it (here the whole script's, which reads the striker); nothing differs from the eager build.
      expect(json(lazy), c.label).toBe(json(eager));
      if (stride) expect(stride.done, c.label).toBe(true);
      const sg = eager.actors.find((a) => a.id === 'striker')!.physicsBody?.stroke?.governed;
      if (sg) governed++;
      if ((c.result.events as Array<{ kind: string }>).some((e) => e.kind === 'run')) withRuns++;
    }
    // The corpus holds deferred and not deferred, governed and natural.
    expect(waiting).toBeGreaterThan(cases.length / 4);
    expect(governed).toBeGreaterThan(10);
    expect(waiting).toBeLessThan(cases.length);
    void withRuns;
  }, 240_000);

  it('made a slice at a time on the script’s hook, every pose of every actor is the eager build’s', () => {
    const times = (rel: number, end: number) =>
      Array.from({ length: 36 }, (_, i) => rel - 300 + (i * (end - rel + 300)) / 35);
    let sliced = 0;
    let governed = 0;
    let checked = 0;
    for (const c of cases.filter((x) => x.result.swing).filter((_, i) => i % 3 === 0)) {
      const eager = buildPracticeScript({ setup: c.setup, flight: c.flight, result: c.result, sliced: true });
      const lazy = buildPracticeScript({ setup: c.setup, flight: c.flight, result: c.result });
      const batOf = (script: typeof lazy) => (track: ActorTrack, t: number) => {
        if (track.id !== 'striker') return null;
        const b = externalBatPose(script.practice!.bat, track, t, lookScale(track.look));
        return b ? { grip: b.grip, toe: b.toe } : null;
      };
      const hl = humansPoseHookFor(lazy, { batOf: batOf(lazy) });
      const he = humansPoseHookFor(eager, { batOf: batOf(eager) });
      const stride = lazy.practice!.stride;
      if (stride) {
        // One pose a slice: many slices, and nothing is read in between.
        let n = 0;
        while (!stride.advance(0, hl)) {
          n++;
          expect(n, c.label).toBeLessThan(100_000);
        }
        sliced += n;
        if (eager.actors.find((a) => a.id === 'striker')!.physicsBody?.stroke?.governed) governed++;
      }
      const rel = lazy.practice!.releaseScene;
      const end = Math.min(lazy.duration, (lazy.practice!.deadScene ?? rel + 2000) + 1500);
      const [a, b, l] = [createPose(), createPose(), createPose()];
      const [a2, b2, l2] = [createPose(), createPose(), createPose()];
      for (const id of ['striker', 'bowler', 'nonStriker']) {
        const tl = lazy.actors.find((x) => x.id === id)!;
        const te = eager.actors.find((x) => x.id === id)!;
        for (const t of times(rel, end)) {
          const pl = samplePresented(evaluateActor(tl, t), a, b, l);
          hl(tl, pl, t);
          if (tl.mirror) mirrorSampledPose(pl);
          const pe = samplePresented(evaluateActor(te, t), a2, b2, l2);
          he(te, pe, t);
          if (te.mirror) mirrorSampledPose(pe);
          expect(bitsEqual(pl.q, pe.q), `${c.label} ${id} t=${Math.round(t)} bones`).toBe(true);
          expect(bitsEqual(pl.root, pe.root), `${c.label} ${id} t=${Math.round(t)} root`).toBe(true);
          checked++;
        }
      }
    }
    expect(sliced).toBeGreaterThan(2000);
    expect(governed).toBeGreaterThan(5);
    expect(checked).toBeGreaterThan(5000);
  }, 600_000);

  it('a read in the middle of the decision finishes it as one made at once', () => {
    let reads = 0;
    for (const c of cases.filter((x) => x.result.swing).filter((_, i) => i % 11 === 0)) {
      const eager = buildPracticeScript({ setup: c.setup, flight: c.flight, result: c.result, sliced: true });
      const lazy = buildPracticeScript({ setup: c.setup, flight: c.flight, result: c.result });
      const stride = lazy.practice!.stride;
      if (!stride) continue;
      const hook = humansPoseHookFor(lazy, {});
      for (let i = 0; i < 3; i++) stride.advance(0, hook);
      const striker = lazy.actors.find((a) => a.id === 'striker')!;
      expect(json(striker.moves), c.label).toBe(json(eager.actors.find((a) => a.id === 'striker')!.moves));
      expect(stride.done, c.label).toBe(true);
      expect(json(striker.physicsBody), c.label).toBe(json(eager.actors.find((a) => a.id === 'striker')!.physicsBody));
      // Done is done: nothing more to advance, and a late hook changes nothing.
      expect(stride.advance(1, hook)).toBe(true);
      reads++;
    }
    expect(reads).toBeGreaterThan(10);
  }, 240_000);
});
