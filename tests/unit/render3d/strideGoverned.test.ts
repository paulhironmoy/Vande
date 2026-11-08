/**
 * `strideGoverned` is a steppable decision (PERF-2, 2026-11-07): the build pauses after each pose it works out so the
 * stage's warm-up can take it a slice of a frame at a time, and makes its planted-feet hook only when the first pose is
 * asked for. Stepped or driven to its end, it must decide as the loop it was (a frozen copy of which, "reference" below,
 * works out every pose up front) on 900 deliveries: both hands, pace and spin, every footwork, early and late,
 * defended, driven, missed. (A reach prefilter, skipping balls far from the striker's root, was measured and dropped: the
 * largest shin reach of this corpus is 1.7 m and 84% of the low-ball steps are inside a safe 2.2 m, so it saved nothing.)
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BallFlight, DeliveryResult, Footwork, Handedness, NormalizedSwing } from '@/contracts/practice';
import type { BallScript } from '@/render3d/core/choreo';
import { evaluateActor, lookScale, type ActorTrack } from '@/render3d/core/actors';
import { createPose, mirrorSampledPose, samplePresented } from '@/render3d/core/clips';
import { createJoints, forwardKinematics, jointWorld } from '@/render3d/core/locomotion';
import { humansPoseHook } from '@/render3d/core/motion/humansHook';
import { ballAt, simToScene, toWorld } from '@/render3d/practice/frame';
import { STANCE_FIT_AT_MS, STRIDE_BALL_CLEAR_M, STRIDE_PLANT_MS, buildPracticeScript, buildPracticeScriptSteps, strideGoverned, strideGovernedSteps, strideStartScene, strikerMoves, strikerPhysicsBody, strikerPreSwing } from '@/render3d/practice/script';
import type { PracticeSceneSetup } from '@/render3d/practice/types';
import { evalOvers, overBalls, type EvalBall } from '@/practice/game/evaluate';
import { REFERENCE_OVER } from '@/practice/game/reference';
import { batTravelMs, batterBody } from '@/physics/bat';
import { autoField } from '@/physics/field';
import { BALL_R } from '@/physics/geometry';
import { flight as physicsFlight } from '@/physics/delivery';
import { resolveDelivery } from '@/physics/resolve';

// The batter and field packs the browser loads: the pack clips are the planted-feet hook's real input.
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

const STANCE_BODY = batterBody(null);
const PAD_CAPSULE_R = STANCE_BODY.pads[0].r;

const setupOf = (eb: EvalBall, hand: Handedness): PracticeSceneSetup => ({ field: hand === 'right' ? eb.field : autoField(eb.over.bowler, eb.conditions, 'left', eb.over.ball), bowler: eb.over.bowler, conditions: eb.conditions, handedness: hand });

/** The loop as it was: its planted-feet hook and scratch poses made up front, every pose worked out in one go. */
function reference(result: DeliveryResult, releaseScene: number, natural: ActorTrack, mirror: boolean): boolean {
  if (result.events.some((e) => e.kind === 'pad' || (e.kind === 'contact' && e.contact === 'body'))) return true;
  const strideAt = strideStartScene(result, releaseScene);
  if (strideAt === null) return false;
  const hook = humansPoseHook({ actors: [natural] } as unknown as BallScript);
  const a = createPose();
  const b = createPose();
  const lw = createPose();
  const j = createJoints();
  const scale = lookScale(natural.look);
  const shinsAt = (t: number, y: number) => {
    const st = evaluateActor(natural, t);
    const pose = samplePresented(st, a, b, lw);
    hook(natural, pose, t);
    if (natural.mirror) mirrorSampledPose(pose);
    forwardKinematics(pose, j);
    const root = { x: st.pos.x + (st.body?.x ?? 0), y: 0, z: st.pos.z + (st.body?.z ?? 0) };
    return (['L', 'R'] as const).map((side) => {
      const ankle = jointWorld(j, `foot${side}`, root, st.heading, scale);
      const knee = jointWorld(j, `shin${side}`, root, st.heading, scale);
      const u = Math.min(1.4, Math.max(0, (y - ankle.y) / Math.max(1e-3, knee.y - ankle.y)));
      return { x: ankle.x + (knee.x - ankle.x) * u, z: ankle.z + (knee.z - ankle.z) * u };
    });
  };
  const ref = natural.physicsBody?.stroke?.refAt ?? strideAt + STRIDE_PLANT_MS;
  const near = PAD_CAPSULE_R + BALL_R + STRIDE_BALL_CLEAR_M;
  const top = STANCE_BODY.pads[0].b.y + PAD_CAPSULE_R + BALL_R;
  let governed = false;
  for (let t = strideAt; t <= ref + 300 && !governed; t += 1000 / 120) {
    const bp = ballAt(result.ball, (t - releaseScene) / 1000);
    if (!bp || bp.y > top) continue;
    const ball = toWorld(bp, mirror);
    for (const q of shinsAt(t, bp.y)) if (Math.hypot(ball.x - q.x, ball.z - q.z) < near) governed = true;
  }
  return governed;
}

interface Case {
  label: string;
  setup: PracticeSceneSetup;
  flight: BallFlight;
  result: DeliveryResult;
}

function swingCases(): Case[] {
  const out: Case[] = [];
  let k = 0;
  const footworks: Footwork[] = ['auto', 'forward', 'back', 'across', 'down_track'];
  const add = (label: string, eb: EvalBall, hand: Handedness, fl: BallFlight, swing: NormalizedSwing | null) => {
    const setup = setupOf(eb, hand);
    const result = resolveDelivery({ flight: fl, swing, field: setup.field, bowler: eb.over.bowler, conditions: eb.conditions, handedness: hand, assist: 'play', tierToleranceMs: 0 });
    out.push({ label, setup, flight: fl, result });
  };
  const swingOf = (fl: BallFlight, n: number): NormalizedSwing => {
    const kind = n % 3 === 0 ? 'attack' : 'defend';
    const power = kind === 'attack' ? 0.35 + ((n * 17) % 60) / 100 : 0.2;
    return { kind, startT: fl.idealContactT - batTravelMs(kind, power) / 1000 + (((n * 37) % 161) - 80) / 1000, directionDeg: ((n * 53) % 140) - 70, power, elevation: (n % 5) / 8, footwork: footworks[n % footworks.length] };
  };
  for (const eb of overBalls(REFERENCE_OVER, 'balanced')) for (let v = 0; v < 8; v++) add(`ref-${eb.ballIndex + 1} #${v}`, eb, 'right', eb.flight, swingOf(eb.flight, k++));
  for (const difficulty of ['beginner', 'club', 'expert'] as const) {
    for (const family of ['pace', 'spin'] as const) {
      evalOvers({ difficulty, overs: 6, key: `stride-reach|${difficulty}|${family}`, family }).forEach((over, oi) =>
        over.forEach((eb) => {
          const hand: Handedness = oi % 2 === 1 ? 'left' : 'right';
          const fl = hand === 'right' ? eb.flight : physicsFlight({ plan: eb.over.balls[eb.ballIndex], bowler: eb.over.bowler, conditions: eb.conditions, seed: eb.seed, ball: eb.over.ball, handedness: 'left' });
          for (let v = 0; v < 4; v++) add(`${difficulty} ${family} over ${oi + 1} ball ${eb.ballIndex + 1} ${hand} #${v}`, eb, hand, fl, swingOf(fl, k++));
        }),
      );
    }
  }
  return out;
}

describe('strideGoverned, steppable', () => {
  const cases = swingCases();

  it('decides as the loop that works out every pose up front did, whether driven at once or a step at a time: 900 deliveries', () => {
    expect(cases.length).toBeGreaterThanOrEqual(900);
    let governedCount = 0;
    let steps = 0;
    for (const c of cases) {
      const script = buildPracticeScript({ setup: c.setup, flight: c.flight, result: c.result });
      const striker = script.actors.find((a) => a.id === 'striker')!;
      const rs = script.practice!.releaseScene;
      const mirror = c.setup.handedness === 'left';
      const natural = strikerMoves(c.result, rs, script.duration, false);
      const natRest = natural.find((m) => m.clip === 'bat_rest')?.t0 ?? script.duration;
      const waiting = strikerPreSwing(rs, script.duration, true);
      const arrival = simToScene({ releaseScene: rs }, c.flight.idealContactT);
      const body = strikerPhysicsBody(c.result, rs, mirror, STANCE_FIT_AT_MS, c.result.swing ? natRest : Number.POSITIVE_INFINITY, waiting, arrival, false);
      const track: ActorTrack = { ...striker, moves: natural, physicsBody: body };
      const want = reference(c.result, rs, track, mirror);
      expect(strideGoverned(c.result, rs, track, mirror), c.label).toBe(want);
      // A step at a time (as the warm-up takes it): the same decision, and a step is one pose.
      const g = strideGovernedSteps(c.result, rs, track, mirror);
      let r = g.next();
      while (!r.done) {
        steps++;
        r = g.next();
      }
      expect(r.value, `${c.label} stepped`).toBe(want);
      // The decision the build made is the same one (it is recorded in the striker's physics body).
      expect(Boolean(striker.physicsBody?.stroke?.governed), c.label).toBe(c.result.swing ? want : false);
      if (want) governedCount++;
    }
    // The corpus holds both outcomes, and the decision needs its steps (about 75 poses a delivery, none for a pad contact).
    expect(governedCount).toBeGreaterThan(20);
    expect(governedCount).toBeLessThan(cases.length - 20);
    expect(steps).toBeGreaterThan(cases.length * 20);
  }, 240_000);

  it('builds the same script a step at a time (and sliced, with more pauses) as in one go, and pauses more than a dozen times on a result', () => {
    const json = (x: unknown) => JSON.stringify(x, (k, v) => (k === 'result' || k === 'flight' || k === 'samples' ? undefined : v));
    for (const c of cases.slice(0, 40)) {
      const whole = json(buildPracticeScript({ setup: c.setup, flight: c.flight, result: c.result }));
      const pauses: number[] = [];
      for (const sliced of [false, true]) {
        const g = buildPracticeScriptSteps({ setup: c.setup, flight: c.flight, result: c.result, sliced });
        let n = 0;
        let r = g.next();
        while (!r.done) {
          n++;
          r = g.next();
        }
        pauses.push(n);
        expect(json(r.value), `${c.label}${sliced ? ' sliced' : ''}`).toBe(whole);
      }
      expect(pauses[0], c.label).toBeGreaterThan(12);
      expect(pauses[1], c.label).toBeGreaterThanOrEqual(pauses[0]);
    }
  }, 120_000);
});
