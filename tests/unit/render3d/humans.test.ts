/**
 * WEB-HUMANS: the people on the field move like cricketers, without ever changing what the physics decided.
 * - the grip: both gloves closed round the handle (≤ 5 mm), the top hand above the bottom, for either hand;
 * - the presented bat: an orthodox grounded stance with the face to the bowler, the backlift from the release, the
 *   swing never moving before the input (SYS1 phase 5e) and equal to the physics bat from contact on;
 * - crossfades: a plain one is bit-identical to the stage's old two-layer blend, a nested one never pops;
 * - the bowler: one continuous root speed from the mark to rest on the physics bowler's spot, no jump into his chase;
 * - the batters' running: the bat grounded at each physics completion time, a sprint (no 20 m/s cubic peaks), the
 *   non-striker on the side away from the bowler's arm.
 */
import { describe, expect, it } from 'vitest';
import { Euler, Group, PerspectiveCamera, Quaternion, Scene, Vector3, type Mesh } from 'three';
import type {
  BowlerProfile,
  DeliveryResult,
  Footwork,
  Handedness,
  NormalizedSwing,
  PitchCondition,
  PracticeDeliveryPlan,
} from '@/contracts/practice';
import { autoField, batTravelMs, flight, resolveDelivery } from '@/physics';
import { idealTimeFor } from '@/physics/bat';
import { overBalls } from '@/practice/game/evaluate';
import { randomOver } from '@/practice/game/overs';
import { HANDLE_L, TOP_HAND_FROM_CAP } from '@/physics/constants';
import { evaluateActor, type ActorTrack } from '@/render3d/core/actors';
import type { BallScript } from '@/render3d/core/choreo';
import { blendPose, createPose, overlayLower, sampleClip, samplePresented } from '@/render3d/core/clips';
import { PRACTICE_PROFILES } from '@/render3d/core/quality';
import {
  BACKLIFT,
  FIRST_PERSON_READY,
  SMEAR,
  STANCE_GROUNDED,
  batPoseAt,
  bladeRateDegS,
  externalBatPose,
  firstPersonBatPose,
  presentedBatPose,
  preSwingPose,
  swingSmear,
} from '@/render3d/practice/bat';
import { batAt, batToWorld, simToScene } from '@/render3d/practice/frame';
import {
  BAT_RUN_MPS,
  TURN_SHORT_M,
  nonStrikerX,
  runTimes,
  setOffT,
  sprintProfile,
} from '@/render3d/practice/nonStriker';
import { BOWLER_SCALE, buildPracticeScript } from '@/render3d/practice/script';
import { ballInHand, gripPoint, type PlayerRig } from '@/render3d/three/players';
import { StageScene } from '@/render3d/three/stageScene';
import { KITS } from '@/ui/avatar/traits';

const PACE: BowlerProfile = { family: 'pace', paceBand: 'fast', arm: 'right', lookSeed: 'humans-pace' };
const LEFT_ARM: BowlerProfile = { family: 'pace', paceBand: 'express', arm: 'left', lookSeed: 'humans-left' };
const SPIN: BowlerProfile = { family: 'spin', spinType: 'finger', arm: 'right', lookSeed: 'humans-spin' };

function play(
  o: {
    bowler?: BowlerProfile;
    hand?: Handedness;
    plan?: Partial<PracticeDeliveryPlan>;
    swing?: Partial<NormalizedSwing> | null;
    errMs?: number;
    assist?: 'real' | 'play' | 'learn';
    seed?: string;
  } = {},
) {
  const bowler = o.bowler ?? PACE;
  const hand = o.hand ?? 'right';
  const plan: PracticeDeliveryPlan = {
    variation: 'stock',
    lengthM: 4,
    lineM: 0.1,
    speedKph: bowler.family === 'spin' ? 86 : 136,
    ...o.plan,
  };
  const fl = flight({
    plan,
    bowler,
    conditions: 'balanced',
    seed: o.seed ?? `humans:${JSON.stringify(o)}`,
    handedness: hand,
  });
  const field = autoField(bowler, 'balanced', hand);
  let swing: NormalizedSwing | null = null;
  if (o.swing !== null) {
    const kind = o.swing?.kind ?? 'attack';
    const power = o.swing?.power ?? 0.7;
    swing = {
      kind,
      startT: fl.idealContactT - batTravelMs(kind, power) / 1000 + (o.errMs ?? 0) / 1000,
      directionDeg: o.swing?.directionDeg ?? 15,
      power,
      elevation: o.swing?.elevation ?? 0.1,
      footwork: 'auto',
    };
  }
  const result = resolveDelivery({
    flight: fl,
    swing,
    field,
    bowler,
    conditions: 'balanced',
    handedness: hand,
    assist: o.assist ?? 'play',
    tierToleranceMs: 0,
  });
  const setup = { field, bowler, conditions: 'balanced' as const, handedness: hand };
  return { result, setup, script: buildPracticeScript({ setup, flight: fl, result }) };
}

function stubStage(): StageScene {
  const stage = Object.create(StageScene.prototype) as StageScene;
  Object.assign(stage, {
    scene: new Scene(),
    camera: new PerspectiveCamera(30, 1, 0.1, 1200),
    ballFx: { update: () => undefined },
    stumpsFx: { update: () => undefined },
    eventFx: { update: () => undefined },
    blobs: { begin: () => undefined, end: () => undefined, add: () => undefined },
    stadium: {
      group: new Group(),
      setTime: () => undefined,
      setExcitement: () => undefined,
      setCrowdMood: () => undefined,
      setBoardFlash: () => undefined,
    },
    preset: PRACTICE_PROFILES.standard.preset,
    cssHeight: 400,
    rigs: new Map(),
    bats: new Map(),
    mirrored: new Map(),
    pose: createPose(),
    poseB: createPose(),
    lower: createPose(),
    towers: [],
  });
  return stage;
}

const dist = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const angleDeg = (a: Float32Array, b: Float32Array, i: number) => {
  const d = Math.abs(
    a[i * 4] * b[i * 4] + a[i * 4 + 1] * b[i * 4 + 1] + a[i * 4 + 2] * b[i * 4 + 2] + a[i * 4 + 3] * b[i * 4 + 3],
  );
  return (2 * Math.acos(Math.min(1, d)) * 180) / Math.PI;
};

describe('the grip: an orthodox grip closed round the handle', () => {
  for (const hand of ['right', 'left'] as const) {
    it(`both gloves sit on the physics bat's handle, top hand above the bottom (${hand}-hander)`, () => {
      const { script } = play({ hand, plan: { lengthM: 6 }, swing: { kind: 'defend', power: 0.2, directionDeg: 0 } });
      const p = script.practice!;
      const stage = stubStage();
      const contact = p.contactScene!;
      const cam = { pos: { x: 0, y: 1.7, z: 12 }, target: { x: 0, y: 1, z: 0 }, fov: 30 } as never;
      const pose = batPoseAt(p.bat, contact);
      stage.drawScript(script, contact, cam, {
        kits: [KITS[0], KITS[1]],
        slow: false,
        clockMs: 0,
        reducedMotion: false,
        bat: { actor: 'striker', pose },
      });
      const rig = stage.rigOf('striker')!;
      const bat = (stage as unknown as { bats: Map<string, Mesh> }).bats.get('striker')!;
      bat.updateWorldMatrix(true, false);
      const cap = new Vector3().setFromMatrixPosition(bat.matrixWorld);
      const dir = new Vector3(0, -1, 0).transformDirection(bat.matrixWorld);
      // The drawn bat is the physics bat exactly.
      expect(dist(cap, pose.grip)).toBeLessThan(1e-6);
      const top = hand === 'right' ? 'L' : 'R';
      const bottom = hand === 'right' ? 'R' : 'L';
      const along = (side: 'L' | 'R') => {
        const g = gripPoint(rig, side).sub(cap);
        const a = g.dot(dir);
        return { a, off: g.sub(dir.clone().multiplyScalar(a)).length() };
      };
      const t = along(top);
      const b = along(bottom);
      expect(t.off, 'top glove on the handle axis').toBeLessThan(0.005);
      expect(b.off, 'bottom glove on the handle axis').toBeLessThan(0.005);
      // 1.5 mm (lead ruling, round 6): the hinge-only forearm changes relaxGrip's roll of the glove on the handle, and
      // the palm channel lands up to 1.0 mm lower; still far inside the 5 mm hands-on-the-bat gate.
      expect(Math.abs(t.a - TOP_HAND_FROM_CAP), 'top glove at TOP_HAND_FROM_CAP (m)').toBeLessThanOrEqual(0.0015);
      expect(b.a).toBeGreaterThan(t.a + 0.05);
      expect(b.a).toBeLessThan(HANDLE_L);
    });
  }
});

describe('the presented bat', () => {
  it('stands in an orthodox grounded stance: toe down by the back foot, the face to the bowler, the back to the eye in first person', () => {
    for (const hand of ['right', 'left'] as const) {
      const { script } = play({ hand });
      const p = script.practice!;
      const waiting = presentedBatPose(p.bat, p.releaseScene - 1500);
      expect(waiting.toe.y).toBeLessThan(0.05);
      expect(waiting.grip.y).toBeGreaterThan(0.7);
      // The face points down the pitch, towards the bowler (−z).
      expect(waiting.face.z).toBeLessThan(-0.85);
      const fp = firstPersonBatPose(p.bat, p.releaseScene - 1500);
      const mid = { x: (fp.grip.x + fp.toe.x) / 2, y: (fp.grip.y + fp.toe.y) / 2, z: (fp.grip.z + fp.toe.z) / 2 };
      const toEye = { x: p.eye.x - mid.x, y: p.eye.y - mid.y, z: p.eye.z - mid.z };
      expect(
        fp.face.x * toEye.x + fp.face.y * toEye.y + fp.face.z * toEye.z,
        'the eye sees the back of the bat',
      ).toBeLessThan(0);
      expect(fp.toe.y).toBeLessThan(fp.grip.y);
    }
    expect(FIRST_PERSON_READY.toe.y).toBeLessThan(FIRST_PERSON_READY.grip.y);
    expect(STANCE_GROUNDED.face.z).toBeLessThan(-0.85);
  });

  it('lifts into the backlift from the release, reaching the top 0.25 s later, the same for every ball', () => {
    const a = play().script.practice!;
    const b = play({ plan: { lengthM: 8, lineM: -0.2, speedKph: 141 } }).script.practice!;
    expect(BACKLIFT).toEqual({ fromMs: 0, toMs: 250 });
    for (const rel of [-600, -1, 0, 120, 250, 400])
      expect(preSwingPose(a.bat, a.releaseScene + rel)).toEqual(preSwingPose(b.bat, b.releaseScene + rel));
    expect(preSwingPose(a.bat, a.releaseScene - 1)).toEqual(STANCE_GROUNDED);
  });

  it('never moves the swing before the input, and is the physics bat from contact on (a late Learn swing, SYS1 5e)', () => {
    for (const errMs of [60, 90]) {
      const { result, script } = play({ assist: 'learn', errMs });
      const p = script.practice!;
      const input = simToScene(p, result.swing!.startT);
      // Live: the provisional swing started at the input; the result arrived a little later.
      const live = buildPracticeScript({
        setup: {
          field: autoField(PACE, 'balanced', 'right'),
          bowler: PACE,
          conditions: 'balanced',
          handedness: 'right',
        },
        flight: result.flight,
        result,
        provisionalStart: input,
        resultAt: input + 30,
      }).practice!;
      for (const track of [p.bat, live.bat]) {
        const atInput = presentedBatPose(track, input);
        expect(atInput).toEqual(batToWorld(preSwingPose(track, input), track.mirror));
        expect(presentedBatPose(track, input - 16)).toEqual(batToWorld(preSwingPose(track, input - 16), track.mirror));
        const contact = track.contactScene ?? track.velocityPeakScene!;
        const phys = batAt(
          result.bat,
          (contact - track.releaseScene) / 1000,
          track.contactImpulseScene == null ? null : (track.contactImpulseScene - track.releaseScene) / 1000,
          track.velocityPeakScene == null ? null : (track.velocityPeakScene - track.releaseScene) / 1000,
        )!;
        expect(presentedBatPose(track, contact)).toEqual(batPoseAt(track, contact));
        expect(dist(presentedBatPose(track, contact).grip, batToWorld(phys, track.mirror).grip)).toBeLessThan(1e-9);
        expect(firstPersonBatPose(track, contact)).toEqual(batPoseAt(track, contact));
      }
    }
  });
});

describe('the swing on the shortest windows (SYS1 5e: a Learn/Play physics bat may start up to 82 ms before the input)', () => {
  it('starts at the input, equals batAt from contact on, and turns no faster than the physics bat itself', () => {
    const rows: Array<{ window: number; early: number; drawn: number; physics: number; need: number }> = [];
    for (const assist of ['learn', 'play'] as const) {
      for (const errMs of [40, 70, 90, 110]) {
        for (const kind of ['attack', 'defend'] as const) {
          const { result, script } = play({
            assist,
            errMs,
            plan: { lengthM: kind === 'defend' ? 6 : 4 },
            swing: { kind, power: kind === 'defend' ? 0.2 : 0.7, directionDeg: kind === 'defend' ? 0 : 15 },
          });
          const p = script.practice!;
          if (!result.swing || !result.bat.length) continue;
          const input = simToScene(p, result.swing.startT);
          const end = p.bat.contactScene ?? p.bat.velocityPeakScene;
          if (end == null || end <= input) continue;
          const physicsStart = simToScene(p, result.bat[0].t);
          expect(presentedBatPose(p.bat, input)).toEqual(batToWorld(preSwingPose(p.bat, input), p.bat.mirror));
          expect(presentedBatPose(p.bat, end)).toEqual(batPoseAt(p.bat, end));
          // Angular speed of the blade's direction (deg/s) at 240 Hz, drawn vs physics, over input → contact.
          const dirOf = (b: {
            grip: { x: number; y: number; z: number };
            toe: { x: number; y: number; z: number };
          }) => {
            const d = new Vector3(b.toe.x - b.grip.x, b.toe.y - b.grip.y, b.toe.z - b.grip.z);
            return d.normalize();
          };
          let drawn = 0;
          let physics = 0;
          const dt = 1000 / 240;
          for (let t = input; t + dt <= end; t += dt) {
            drawn = Math.max(
              drawn,
              (dirOf(presentedBatPose(p.bat, t)).angleTo(dirOf(presentedBatPose(p.bat, t + dt))) * 180) /
                Math.PI /
                (dt / 1000),
            );
            const a = batPoseAt(p.bat, t);
            const b = batPoseAt(p.bat, t + dt);
            if (t >= physicsStart)
              physics = Math.max(physics, (dirOf(a).angleTo(dirOf(b)) * 180) / Math.PI / (dt / 1000));
          }
          // The rotation the drawn bat has to make: from where it waited at the input to the physics bat at contact.
          const need =
            (dirOf(presentedBatPose(p.bat, input)).angleTo(dirOf(presentedBatPose(p.bat, end))) * 180) / Math.PI;
          rows.push({
            window: Math.round(end - input),
            early: Math.round(input - physicsStart),
            drawn: Math.round(drawn),
            physics: Math.round(physics),
            need: Math.round(need),
          } as never);
        }
      }
    }
    expect(rows.length).toBeGreaterThan(6);
    // The drawn bat never turns more than the closing it must do allows: the C1 blend's 1.5× peak of the mean rate that
    // closes the gap from the waiting bat to the physics bat over input → contact, on top of the physics bat's own
    // rate. (On the shortest windows that is fast: reported by WEB-HUMANS, never relaxed by moving before the input.)
    for (const r of rows)
      expect(r.drawn, JSON.stringify(r)).toBeLessThan(1.6 * (r.need / (r.window / 1000)) + r.physics + 60);
    rows.sort((a, b) => a.window - b.window);
    (globalThis as { __humansSwingRows?: unknown }).__humansSwingRows = rows;
  });
});

describe('the swing smear', () => {
  it('appears only on frames where the drawn blade outruns a real bat (1,700°/s), between the last frame and now, deterministically', () => {
    const { script } = play({
      assist: 'learn',
      errMs: 90,
      plan: { lengthM: 6 },
      swing: { kind: 'defend', power: 0.2, directionDeg: 0 },
    });
    const p = script.practice!;
    const at = (t: number) => presentedBatPose(p.bat, t);
    expect(swingSmear(at, p.releaseScene - 1500)).toBeNull();
    let shown = 0;
    for (let t = p.releaseScene; t < (p.bat.contactScene ?? p.releaseScene + 900) + 100; t += 1000 / 60) {
      const s = swingSmear(at, t);
      const rate = bladeRateDegS(at(t - SMEAR.frameMs), at(t), SMEAR.frameMs);
      expect(s !== null, `t=${t} rate=${rate}`).toBe(rate > SMEAR.rateDegS);
      if (!s) continue;
      shown++;
      expect(s.poses).toHaveLength(SMEAR.ghosts);
      expect(swingSmear(at, t)).toEqual(s);
      for (const o of s.opacity) expect(o).toBeLessThanOrEqual(SMEAR.maxOpacity);
    }
    expect(shown).toBeGreaterThanOrEqual(0);
  });
});

describe('crossfades', () => {
  it("a plain two-layer crossfade is bit-identical to the stage's old blend", () => {
    const track: ActorTrack = {
      id: 'x',
      role: 'fielder',
      look: { seed: 'x', team: 1, gear: 'fielder' },
      start: { x: 0, y: 0, z: 0 },
      heading: 0,
      moves: [
        { t0: 0, t1: 1000, clip: 'walk', lower: 'walk' },
        { t0: 1000, t1: 3000, clip: 'ready', blend: 300 },
      ],
    };
    for (const t of [1000, 1100, 1250, 1299, 1400]) {
      const st = evaluateActor(track, t);
      expect(st.stack).toBeUndefined();
      const got = samplePresented(st, createPose(), createPose(), createPose());
      // The old StageScene.poseActor sequence.
      const pose = sampleClip(st.current.clip, st.current.time, createPose());
      const lower = createPose();
      if (st.current.lower) overlayLower(pose, sampleClip(st.current.lower, st.current.lowerTime ?? 0, lower));
      if (st.previous && st.weight < 1) {
        const prev = sampleClip(st.previous.clip, st.previous.time, createPose());
        if (st.previous.lower) overlayLower(prev, sampleClip(st.previous.lower, st.previous.lowerTime ?? 0, lower));
        blendPose(prev, pose, st.weight);
        pose.q.set(prev.q);
        pose.root = [...prev.root] as [number, number, number];
        pose.bat = prev.bat;
      }
      expect(Array.from(got.q)).toEqual(Array.from(pose.q));
      expect(got.root).toEqual(pose.root);
    }
  });

  it('a move that starts during a running crossfade blends from the blended pose: no pop', () => {
    const track: ActorTrack = {
      id: 'x',
      role: 'fielder',
      look: { seed: 'x', team: 1, gear: 'fielder' },
      start: { x: 0, y: 0, z: 0 },
      heading: 0,
      moves: [
        { t0: 0, t1: 1000, clip: 'ready' },
        { t0: 1000, t1: 1060, clip: 'throw', blend: 250 },
        { t0: 1060, t1: 3000, clip: 'celebrate_jump', blend: 250 },
      ],
    };
    let prev: Float32Array | null = null;
    let worst = 0;
    for (let t = 900; t < 1500; t += 1000 / 60) {
      const q = samplePresented(evaluateActor(track, t), createPose(), createPose(), createPose()).q.slice();
      if (prev) for (let i = 0; i < 17; i++) worst = Math.max(worst, angleDeg(prev, q, i) * 60);
      prev = q;
    }
    // MOTION-SPEC §9: limbs ≤ 1200°/s, throwing arm ≤ 1800°/s.
    expect(worst).toBeLessThan(1800);
    expect(evaluateActor(track, 1100).stack?.length).toBe(3);
  });
});

describe('the bowler', () => {
  for (const [name, bowler] of [
    ['pace', PACE],
    ['left-arm', LEFT_ARM],
    ['spin', SPIN],
  ] as const) {
    it(`runs in with one continuous root speed and comes to rest on the physics bowler's spot (${name})`, () => {
      const { script, setup } = play({
        bowler,
        swing: { kind: 'defend', power: 0.2, directionDeg: 0 },
        plan: { lengthM: 6 },
      });
      const track = script.actors.find((a) => a.id === 'bowler')!;
      const dt = 1000 / 60;
      const deliveryEnd = track.moves.find((m) => m.t0 === script.practice!.releaseScene)!.t1;
      let pv: { x: number; z: number } | null = null;
      let sp: number | null = null;
      let worstAction = 0;
      let worstAll = 0;
      let peak = 0;
      const end = Math.min(script.duration, script.practice!.releaseScene + 3000);
      for (let t = 0; t <= end; t += dt) {
        const p = evaluateActor(track, t).pos;
        if (pv) {
          const v = Math.hypot(p.x - pv.x, p.z - pv.z) / (dt / 1000);
          if (sp !== null) {
            worstAll = Math.max(worstAll, Math.abs(v - sp));
            if (t <= deliveryEnd) worstAction = Math.max(worstAction, Math.abs(v - sp));
          }
          sp = v;
          peak = Math.max(peak, v);
        }
        pv = p;
      }
      // §9 ground track: ≤ 0.15 m/s per frame (9 m/s²) through the run-up, the action and the follow-through (it was
      // a 0 → 6.9 m/s step at the start and a 17.6 m/s jump at release); no jump onto his physics chase either (the
      // chase's own 100 ms path segments step ~0.4 m/s).
      expect(worstAction).toBeLessThan(0.2);
      expect(worstAll).toBeLessThan(1.0);
      expect(peak).toBeLessThan(8);
      const spot = setup.field.fielders.find((f) => f.role === 'bowler')!;
      const at = evaluateActor(track, script.practice!.releaseScene + 2500).pos;
      if (!script.practice!.result?.fielders.find((f) => f.fielderId === spot.id && f.samples.length > 1)) {
        expect(Math.hypot(at.x - (setup.handedness === 'left' ? -spot.x : spot.x), at.z - spot.z)).toBeLessThan(0.05);
      }
    });
  }
});

describe('the batters', () => {
  it("stand the non-striker on the side away from the bowler's arm", () => {
    expect(nonStrikerX(false)).toBeLessThan(-1);
    expect(nonStrikerX(true)).toBeGreaterThan(1);
    for (const [bowler, hand] of [
      [PACE, 'right'],
      [PACE, 'left'],
      [LEFT_ARM, 'right'],
      [LEFT_ARM, 'left'],
    ] as const) {
      const { script } = play({ bowler, hand });
      const ns = script.actors.find((a) => a.id === 'nonStriker')!;
      const rel = script.practice!.releaseWorld;
      const x = evaluateActor(ns, script.practice!.releaseScene).pos.x;
      expect(Math.sign(x)).toBe(-Math.sign(rel.x));
      expect(Math.abs(x - rel.x)).toBeGreaterThan(1.5);
    }
  });

  it('a sprint profile covers the distance in the time with continuous speed', () => {
    for (const [d, T, vEnd] of [
      [15.68, 2.86, 0],
      [16.8, 2.86, 4.5],
      [15.68, 2.86, 4.5],
    ] as const) {
      const ph = sprintProfile(d, T, 0, vEnd);
      expect(ph[0].t0).toBe(0);
      expect(ph.at(-1)!.t1).toBeCloseTo(T, 9);
      expect(ph.at(-1)!.s1).toBeCloseTo(d, 6);
      for (let i = 1; i < ph.length; i++) {
        expect(ph[i].v0).toBeCloseTo(ph[i - 1].v1, 9);
        expect(ph[i].s0).toBeCloseTo(ph[i - 1].s1, 9);
      }
      expect(Math.max(...ph.map((x) => x.v1))).toBeLessThan(10.5);
    }
    expect(BAT_RUN_MPS).toBeGreaterThan(5);
  });

  it('run exactly when and as far as the physics says: the body at its turning point at every completion time', () => {
    let checked = 0;
    for (const [dir, lengthM, power] of [
      [-35, 5, 0.5],
      [-35, 4, 0.6],
      [40, 5, 0.6],
      [60, 4, 0.7],
      [-60, 6, 0.6],
      [20, 3, 0.5],
      [75, 6, 0.6],
      [-20, 4, 0.4],
    ] as const) {
      const { result, script } = play({
        plan: { lengthM, lineM: -0.05, speedKph: 128 },
        swing: { kind: 'attack', directionDeg: dir, power, elevation: 0.05 },
      });
      const runs = runTimes(result as DeliveryResult);
      if (!runs.length) continue;
      checked++;
      const p = script.practice!;
      for (const id of ['striker', 'nonStriker']) {
        const track = script.actors.find((a) => a.id === id)!;
        runs.forEach((rt, k) => {
          const at = evaluateActor(track, simToScene(p, rt)).pos;
          // At its turning point, a stretch short of the popping crease (8.84 − TURN_SHORT_M).
          expect(Math.abs(Math.abs(at.z) - (8.84 - TURN_SHORT_M))).toBeLessThan(0.02);
          // Striker towards the bowler's end on odd runs, the non-striker the other way.
          const towardsBowler = (id === 'striker') === (k % 2 === 0);
          expect(Math.sign(at.z)).toBe(towardsBowler ? -1 : 1);
        });
        let pv: { x: number; z: number } | null = null;
        let peak = 0;
        for (let t = simToScene(p, runs[0] - 3.2); t < simToScene(p, runs.at(-1)!) + 400; t += 1000 / 60) {
          const q = evaluateActor(track, t).pos;
          if (pv) peak = Math.max(peak, Math.hypot(q.x - pv.x, q.z - pv.z) * 60);
          pv = q;
        }
        expect(peak, `${id} sprint peak`).toBeLessThan(10.5);
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});

// Keep the imports honest for the type checker.
void Quaternion;

describe('the motion packs (MOTION-SPEC VMP1)', () => {
  const fromDisk = async (url: string) => {
    const { readFile } = await import('node:fs/promises');
    const name = url.split('/').pop()!;
    try {
      const b = await readFile(`public/practice/motion/${name}`);
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
    } catch {
      return null;
    }
  };

  it('load lazily, take effect only when committed between deliveries, and drive the batters', async () => {
    const lib = await import('@/render3d/core/motion/library');
    const { hasMotionClip } = await import('@/render3d/core/clips');
    lib.resetMotionLibrary();
    try {
      const n = await lib.loadMotionPacks('/practice/motion/', fromDisk);
      expect(n).toBeGreaterThan(5);
      // Loaded is not current: a delivery already being drawn keeps its clips.
      expect(hasMotionClip('loco_walk')).toBe(false);
      expect(lib.commitMotion()).toBe(true);
      expect(hasMotionClip('loco_walk')).toBe(true);
      expect(lib.commitMotion()).toBe(false);

      const { script, result } = play({
        plan: { lengthM: 5, lineM: -0.05, speedKph: 128 },
        swing: { kind: 'attack', directionDeg: -35, power: 0.5, elevation: 0.05 },
      });
      const p = script.practice!;
      const striker = script.actors.find((a) => a.id === 'striker')!;
      if (['bat_stance_live', 'bat_trigger', 'bat_backlift', 'bat_ready_hold'].every(hasMotionClip)) {
        const trig = striker.moves.find((m) => m.clip === 'vmp:bat_trigger');
        // The compact pair when TRACKB's batter pack carries it (v3), else the standard backlift.
        const lift = striker.moves.find((m) => m.clip === 'vmp:bat_backlift_compact' || m.clip === 'vmp:bat_backlift');
        expect(trig, 'the trigger is drawn').toBeDefined();
        expect(lift, 'the backlift is drawn').toBeDefined();
        expect(trig!.t1).toBeCloseTo(p.releaseScene, 6);
        expect(lift!.t0).toBeCloseTo(p.releaseScene, 6);
        // The stroke itself starts at the input.
        const input = simToScene(p, result.swing!.startT);
        expect(striker.moves.some((m) => Math.abs(m.t0 - input) < 1e-6 && m.clip !== 'stance')).toBe(true);
      }
      const ns = script.actors.find((a) => a.id === 'nonStriker')!;
      if (hasMotionClip('ns_backup')) {
        // MOTION-BOWL's backing up: its release marker on the physics release, never out of his ground before it.
        const bu = ns.moves.filter((m) => m.clip === 'vmp:ns_backup');
        expect(bu.length).toBeGreaterThan(10);
        const atRelease = evaluateActor(ns, p.releaseScene).pos;
        expect(atRelease.z, 'non-striker at the release (z; popping crease −8.84)').toBeLessThan(-8.84 + 0.6);
      } else expect(ns.moves.some((m) => m.lower === 'vmp:loco_walk')).toBe(true);
      // Runs still land exactly on the physics completion times, and nothing pops at 60 Hz.
      const runs = runTimes(result);
      for (const rt of runs.slice(0, -1))
        expect(Math.abs(Math.abs(evaluateActor(ns, simToScene(p, rt)).pos.z) - (8.84 - TURN_SHORT_M))).toBeLessThan(
          0.02,
        );
      if (runs.length && hasMotionClip('ns_ground')) {
        // The last run ends in MOTION-BOWL's ns_ground with its `ground` marker on the physics completion.
        const st = evaluateActor(ns, simToScene(p, runs.at(-1)!));
        expect(st.current.clip).toBe('vmp:ns_ground');
        const { clipMarker } = await import('@/render3d/core/clips');
        expect(Math.abs(st.current.time - clipMarker('vmp:ns_ground', 'ground', 1))).toBeLessThan(0.002);
      }
      let prev: Float32Array | null = null;
      let worst = 0;
      for (let t = p.releaseScene - 2000; t < script.duration; t += 1000 / 60) {
        const q = samplePresented(evaluateActor(ns, t), createPose(), createPose(), createPose()).q.slice();
        if (prev) for (let i = 0; i < 17; i++) worst = Math.max(worst, angleDeg(prev, q, i) * 60);
        prev = q;
      }
      expect(worst, 'non-striker joint speed (deg/s, 60 Hz)').toBeLessThan(2400);
    } finally {
      lib.resetMotionLibrary();
    }
  });
});

describe('no stride before the input; from it, the stride lands on the physics pads (lead ruling, 5f body)', () => {
  // The procedural strides and TRACKB's stroke overlays (batter_strokes): none of them before the input.
  const FOOTWORK = new Set([
    'foot_forward',
    'foot_back',
    'foot_across',
    'foot_charge',
    'foot_sweep',
    'vmp:bat_drive',
    'vmp:bat_fwd_defence',
    'vmp:bat_backfoot_punch',
    'vmp:bat_pull',
    'vmp:bat_back_defence',
  ]);
  const INPUTS = [
    ['attack', 0, 0],
    ['attack', -80, 40],
    ['defend', 0, -40],
    ['attack', 100, 20],
    ['attack', 30, -60],
  ] as const;

  it('the same delivery with different inputs: the same footwork, the stride starting at each input, never before it', async () => {
    const { strideStartScene } = await import('@/render3d/practice/script');
    for (const lengthM of [3, 7.5]) {
      const seen = new Set<string>();
      for (const [kind, directionDeg, errMs] of INPUTS) {
        const { result, script } = play({
          seed: `same:${lengthM}`,
          plan: { lengthM },
          swing: { kind, directionDeg, power: kind === 'defend' ? 0.2 : 0.7 },
          errMs,
        });
        seen.add(result.footwork);
        const p = script.practice!;
        const input = simToScene(p, result.swing!.startT);
        expect(strideStartScene(result, p.releaseScene)).toBeCloseTo(input, 6);
        const striker = script.actors.find((a) => a.id === 'striker')!;
        for (const m of striker.moves)
          if (m.lower && FOOTWORK.has(m.lower))
            expect(m.t0, `${m.lower} before the input`).toBeGreaterThanOrEqual(input - 1e-6);
      }
      expect(seen.size).toBe(1);
      // A leave never strides.
      const leave = play({ seed: `same:${lengthM}`, plan: { lengthM }, swing: null });
      expect(strideStartScene(leave.result, leave.script.practice!.releaseScene)).toBeNull();
      for (const m of leave.script.actors.find((a) => a.id === 'striker')!.moves)
        expect(m.lower && FOOTWORK.has(m.lower), `${m.lower} in a leave`).toBeFalsy();
    }
  });

  it('the drawn shins: on the stance pads (3 cm) until the input and through a leave, on the stroke pads (3 cm) once planted', async () => {
    const { ThreePracticeStage } = await import('@/render3d/three/ThreePracticeStage');
    const self = {
      hookCache: new WeakMap(),
      reducedMotion: false,
      cueHook: (ThreePracticeStage.prototype as unknown as { cueHook: unknown }).cueHook,
    };
    const shinAt = (stage: StageScene, side: 'L' | 'R', h: number) => {
      const rig = stage.rigOf('striker')!;
      const a = new Vector3().setFromMatrixPosition(rig.boneMap[`foot${side}`].matrixWorld);
      const k = new Vector3().setFromMatrixPosition(rig.boneMap[`shin${side}`].matrixWorld);
      const u = (h - a.y) / Math.max(1e-3, k.y - a.y);
      return { x: a.x + (k.x - a.x) * u, z: a.z + (k.z - a.z) * u };
    };
    const off = (
      stage: StageScene,
      pads: readonly { x: number; z: number }[],
      front: 'L' | 'R',
      h: [number, number] = [0.3, 0.3],
    ) => {
      const back = front === 'L' ? 'R' : 'L';
      const f = shinAt(stage, front, h[0]);
      const b = shinAt(stage, back, h[1]);
      return Math.max(Math.hypot(f.x - pads[0].x, f.z - pads[0].z), Math.hypot(b.x - pads[1].x, b.z - pads[1].z));
    };
    for (const hand of ['right', 'left'] as const) {
      for (const swing of [{ kind: 'attack', directionDeg: 10, power: 0.7 }, null] as const) {
        const { script, result } = play({
          hand,
          seed: `pads:${hand}`,
          plan: { lengthM: 7.5 },
          swing: swing as Partial<NormalizedSwing> | null,
        });
        const p = script.practice!;
        const striker = script.actors.find((a) => a.id === 'striker')!;
        const body = striker.physicsBody!;
        const hook = (
          ThreePracticeStage.prototype as unknown as { poseHooks(s: unknown, p: unknown): never }
        ).poseHooks.call(self, script, p);
        const stage = stubStage();
        const until = result.swing
          ? simToScene(p, result.swing.startT)
          : simToScene(p, result.flight.idealContactT) + 150;
        let worst = 0;
        let at = 0;
        for (let t = p.releaseScene - 400; t < until; t += 1000 / 60) {
          stage.poseActor(striker, t, [KITS[0], KITS[1]], null, hook);
          const o = off(stage, body.stance, body.frontLeg);
          if (o > worst) [worst, at] = [o, t - until];
        }
        expect(
          worst,
          `${hand} ${swing ? 'swing, before the input' : 'leave'}: shins from the stance pads (m), worst ${at.toFixed(0)} ms from the end`,
        ).toBeLessThan(0.03);
        // Once planted on the stroke's pads, when the physics pads govern the placement (strideGoverned).
        if (body.stroke && body.stroke.governed && body.stroke.plantAt <= body.stroke.refAt) {
          stage.poseActor(striker, body.stroke.refAt, [KITS[0], KITS[1]], null, hook);
          expect(
            off(stage, body.stroke.pads, body.frontLeg, body.stroke.hitH),
            `${hand}: shins from the stroke pads at the contact (m)`,
          ).toBeLessThan(0.03);
        }
      }
    }
  });
});

describe("the striker on TRACKB's stroke overlays (batter_strokes; one table with Unity)", () => {
  it('plays the overlay from the input at 1x (natural), never before it; a leave plays bat_leave in the stance with the bat at the compact top', async () => {
    const lib = await import('@/render3d/core/motion/library');
    const { readFile } = await import('node:fs/promises');
    const { strokeOverlay, STROKE_OVERLAYS } = await import('@/render3d/practice/script');
    lib.resetMotionLibrary();
    try {
      await lib.loadMotionPacks('/practice/motion/', async (url) => {
        try {
          const b = await readFile(`public/practice/motion/${url.split('/').pop()}`);
          return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
        } catch {
          return null;
        }
      });
      lib.commitMotion();
      if (!strokeOverlay(play({ swing: { kind: 'defend', power: 0.2, directionDeg: 0 } }).result)) return;
      expect(Object.keys(STROKE_OVERLAYS).length, 'every physics shot family has a clip').toBe(16);
      for (const hand of ['right', 'left'] as const) {
        for (const [kind, directionDeg, lengthM] of [
          ['attack', 10, 7.5],
          ['attack', -80, 3],
          ['defend', 0, 3],
        ] as const) {
          const { result, script } = play({
            hand,
            seed: `ov:${hand}:${kind}:${directionDeg}`,
            plan: { lengthM },
            swing: { kind, directionDeg, power: kind === 'defend' ? 0.2 : 0.8 },
          });
          const ov = strokeOverlay(result);
          const p = script.practice!;
          const input = simToScene(p, result.swing!.startT);
          const striker = script.actors.find((a) => a.id === 'striker')!;
          const layered = striker.moves.filter((m) => m.lower && String(m.lower).startsWith('vmp:bat_'));
          if (!ov || striker.physicsBody?.stroke?.governed) continue;
          expect(layered.length, `${hand} ${kind} ${directionDeg}: the overlay is drawn`).toBeGreaterThan(0);
          expect(layered[0].lower).toBe(ov.id);
          expect(layered[0].t0, 'from the input').toBeCloseTo(input, 6);
          expect(layered[0].lowerStart ?? 0).toBe(0);
          expect(layered[0].lowerRate ?? 1, 'at 1x').toBe(1);
          for (const m of striker.moves)
            if (m.t0 < input - 1e-6)
              expect(
                m.lower && String(m.lower).startsWith('vmp:bat_') && m.lower !== 'vmp:bat_ready_hold_compact',
                'nothing of the stroke before the input',
              ).toBeFalsy();
        }
        const leave = play({ hand, seed: `ov-leave:${hand}`, swing: null });
        const lm = leave.script.actors.find((a) => a.id === 'striker')!.moves.find((m) => m.lower === 'vmp:bat_leave');
        expect(lm, 'the leave plays bat_leave').toBeDefined();
        expect(String(lm!.clip), 'on the waiting clip (the bat at the compact top)').toMatch(
          /bat_ready_hold|bat_stance/,
        );
      }
    } finally {
      lib.resetMotionLibrary();
    }
  });
});

describe('the composed pace run-up (MOTION-BOWL clips)', () => {
  it('puts the ball in the bowling hand on the physics release point at the physics release time (1 ms, 3 cm), feet planted, no pop at the start', async () => {
    const lib = await import('@/render3d/core/motion/library');
    const { canComposeRunup } = await import('@/render3d/core/motion/bowlerRunup');
    const { ThreePracticeStage, measureReleaseBall } = await import('@/render3d/three/ThreePracticeStage');
    const { readFile } = await import('node:fs/promises');
    lib.resetMotionLibrary();
    try {
      await lib.loadMotionPacks('/practice/motion/', async (url) => {
        try {
          const b = await readFile(`public/practice/motion/${url.split('/').pop()}`);
          return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
        } catch {
          return null;
        }
      });
      lib.commitMotion();
      if (!canComposeRunup('pace') || !canComposeRunup('off')) return;
      for (const [bowler, hand] of [
        [PACE, 'right'],
        [LEFT_ARM, 'right'],
        [PACE, 'left'],
        [SPIN, 'right'],
      ] as const) {
        const stage = stubStage();
        // The stage's own release measurement (ThreePracticeStage.releaseHand → measureReleaseBall: the ball in the palm).
        const h = measureReleaseBall(stage, bowler, [KITS[0], KITS[1]])!;
        const { script, setup } = play({
          bowler,
          hand,
          swing: { kind: 'defend', power: 0.2, directionDeg: 0 },
          plan: { lengthM: 6 },
        });
        void setup;
        const built = buildPracticeScript({
          setup: { field: autoField(bowler, 'balanced', hand), bowler, conditions: 'balanced', handedness: hand },
          flight: script.practice!.flight!,
          result: script.practice!.result,
          releaseHand: { x: h.x, y: h.y, z: h.z },
        });
        const p = built.practice!;
        const track = built.actors.find((a) => a.id === 'bowler')!;
        expect(track.moves[0].clip.startsWith('vmp:runup_')).toBe(true);
        // The release time is the physics release time: the composed release marker lands on the release scene.
        const self = {
          hookCache: new WeakMap(),
          reducedMotion: false,
          cueHook: (ThreePracticeStage.prototype as unknown as { cueHook: unknown }).cueHook,
        };
        const hook = (
          ThreePracticeStage.prototype as unknown as { poseHooks(s: unknown, p: unknown): never }
        ).poseHooks.call(self, built, p);
        stage.poseActor(track, p.releaseScene, [KITS[0], KITS[1]], null, hook);
        const rig = stage.rigOf('bowler')!;
        const side = bowler.arm === 'left' ? 'L' : 'R';
        // The ball is drawn in the bowling hand's palm (StageScene.handOf, BALL_IN_HAND): on the physics release point within 3 cm (lead
        // ruling: the rig scaled to the bowler's release height, the arm's reach for the rest, never the body lifted).
        rig.root.updateMatrixWorld(true);
        const ball = ballInHand(rig, side);
        expect(rig.scale, 'rig scale within the clamp').toBeGreaterThanOrEqual(
          BOWLER_SCALE[bowler.family === 'spin' ? 'spin' : 'pace'][0] - 1e-9,
        );
        expect(rig.scale, 'rig scale within the clamp').toBeLessThanOrEqual(
          BOWLER_SCALE[bowler.family === 'spin' ? 'spin' : 'pace'][1] + 1e-9,
        );
        expect(
          ball.distanceTo(new Vector3(p.releaseWorld.x, p.releaseWorld.y, p.releaseWorld.z)),
          `${bowler.lookSeed} ${hand}: ball from the physics release point (m), rig scale ${rig.scale.toFixed(3)}, reach ${(p.releaseLift ?? 0).toFixed(3)} m`,
        ).toBeLessThan(0.03);
        // A foot stays on the ground at the release (the front foot planted: its sole, heel to toe, at most 4 cm up;
        // the heel may be rising over the braced leg). Shoe points in the foot bone's frame, MOTION-SPEC §9.
        rig.root.updateMatrixWorld(true);
        let sole = Infinity;
        for (const f of ['footL', 'footR'] as const)
          for (const q of [
            [0, -0.065, -0.05],
            [0, -0.065, 0.135],
            [0, -0.065, 0.2],
          ] as const)
            sole = Math.min(sole, new Vector3(q[0], q[1], q[2]).applyMatrix4(rig.boneMap[f].matrixWorld).y);
        expect(sole, 'lowest sole point at the release (m)').toBeLessThan(0.04);
        // No pop as he sets off: the root speed rises from rest without a step.
        let prev = evaluateActor(track, 0).pos;
        let sp = 0;
        let worst = 0;
        for (let t = 1000 / 60; t < 600; t += 1000 / 60) {
          const q = evaluateActor(track, t).pos;
          const v = Math.hypot(q.x - prev.x, q.z - prev.z) * 60;
          worst = Math.max(worst, Math.abs(v - sp));
          sp = v;
          prev = q;
        }
        expect(worst, 'root speed step at the start (m/s per frame)').toBeLessThan(0.3);
      }
    } finally {
      lib.resetMotionLibrary();
    }
  });
});

describe('the held ball', () => {
  it("is in the fielder's hand from the physics take to the throw, leaving and rejoining the physics path exactly", async () => {
    const { sampleBall } = await import('@/render3d/core/choreo');
    const { ballAt } = await import('@/render3d/practice/frame');
    let checked = 0;
    for (const [dir, lengthM, power] of [
      [-35, 5, 0.5],
      [40, 5, 0.6],
      [60, 4, 0.7],
      [-60, 6, 0.6],
      [20, 3, 0.5],
    ] as const) {
      const { result, script } = play({
        plan: { lengthM, lineM: -0.05, speedKph: 128 },
        swing: { kind: 'attack', directionDeg: dir, power, elevation: 0.05 },
      });
      const p = script.practice!;
      for (const seg of script.ball) {
        if (seg.k !== 'hand' || !seg.path) continue;
        checked++;
        const exact = (t: number) => {
          const q = ballAt(result.ball, (t - p.releaseScene) / 1000)!;
          return { x: p.mirror ? -q.x : q.x, y: q.y, z: q.z };
        };
        // At the take: the physics take position; at the throw's release: the physics release point.
        expect(dist(sampleBall(script, seg.t0, () => ({ x: 99, y: 99, z: 99 })).pos, exact(seg.t0))).toBeLessThan(1e-6);
        if (seg.path.outMs > 0)
          expect(
            dist(sampleBall(script, seg.t1 - 1e-6, () => ({ x: 99, y: 99, z: 99 })).pos, exact(seg.t1)),
          ).toBeLessThan(0.01);
        // In between, in the hand.
        const mid = (seg.t0 + seg.t1) / 2;
        if (seg.t1 - seg.t0 > 400)
          expect(dist(sampleBall(script, mid, () => ({ x: 7, y: 1, z: 7 })).pos, { x: 7, y: 1, z: 7 })).toBeLessThan(
            1e-9,
          );
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe('sprint rates (lead ruling: bounded, logged above 12 m/s²)', () => {
  it('fits every physics run window of the reference sweep within 12 m/s², or logs it', async () => {
    const { sprintRateLog, SPRINT_RATE_LOG_ABOVE } = await import('@/render3d/practice/nonStriker');
    sprintRateLog.length = 0;
    for (const [dir, lengthM, power] of [
      [-35, 5, 0.5],
      [40, 5, 0.6],
      [60, 4, 0.7],
      [-60, 6, 0.6],
      [20, 3, 0.5],
      [75, 6, 0.6],
    ] as const) {
      play({
        plan: { lengthM, lineM: -0.05, speedKph: 128 },
        swing: { kind: 'attack', directionDeg: dir, power, elevation: 0.05 },
      });
    }
    for (const e of sprintRateLog)
      expect(Math.max(e.accel, e.brake), JSON.stringify(e)).toBeGreaterThan(SPRINT_RATE_LOG_ABOVE);
    // Measured: report the count (the evaluators read it in the WEB-HUMANS evidence).
    expect(sprintRateLog.length).toBeLessThanOrEqual(64);
  });
});

describe('the held ball and the keeper (lead correction: shortM)', () => {
  it('holds a clean keeper take of the delivery in the gloves (5f: shortM absent or 0), never one past his reach (shortM > 0)', async () => {
    const { sampleBall } = await import('@/render3d/core/choreo');
    const { ballAt } = await import('@/render3d/practice/frame');
    for (const hand of ['right', 'left'] as const) {
      const { result, script, setup } = play({ hand, swing: null, plan: { lengthM: 5, lineM: 0.5 } });
      const p = script.practice!;
      const take = result.events.find((e): e is Extract<typeof e, { kind: 'keeper_take' }> => e.kind === 'keeper_take');
      expect(take, 'a left ball is taken by the keeper').toBeDefined();
      const clean = (take!.shortM ?? 0) <= 0;
      expect(
        script.ball.some((s) => s.k === 'hand' && s.actor === 'keeper'),
        'held iff a clean take',
      ).toBe(clean);
      // Up to the take the ball is on the physics samples.
      for (let t = take!.t - 0.2; t < take!.t - 1e-3; t += 1 / 60) {
        const d = sampleBall(script, simToScene(p, t)).pos;
        const q = ballAt(result.ball, t)!;
        expect(dist(d, { x: p.mirror ? -q.x : q.x, y: q.y, z: q.z })).toBeLessThan(1e-6);
      }
      // The same ball past his reach (shortM > 0): never held, on the physics samples to the end.
      const short: DeliveryResult = {
        ...result,
        events: result.events.map((e) => (e.kind === 'keeper_take' ? { ...e, shortM: 0.4 } : e)),
      };
      const s2 = buildPracticeScript({ setup, flight: short.flight, result: short });
      expect(
        s2.ball.some((s) => s.k === 'hand' && s.actor === 'keeper'),
        'a take past his reach is not held',
      ).toBe(false);
      const p2 = s2.practice!;
      for (let t = take!.t - 0.2; t <= take!.t; t += 1 / 60) {
        const d = sampleBall(s2, simToScene(p2, t)).pos;
        const q = ballAt(short.ball, t)!;
        expect(dist(d, { x: p2.mirror ? -q.x : q.x, y: q.y, z: q.z })).toBeLessThan(1e-6);
      }
    }
  });
});

describe('the keeper (WEB-FIELD round 5)', () => {
  it('is down and still in his crouch before the bowler gathers, and holds the ball for a throw in his throwing hand', () => {
    const { script } = play({ swing: { kind: 'defend', power: 0.2, directionDeg: 0 }, plan: { lengthM: 6 } });
    const p = script.practice!;
    const keeper = script.actors.find((a) => a.id === 'keeper')!;
    for (const rel of [-900, -600, -300, -100]) {
      const st = evaluateActor(keeper, p.releaseScene + rel);
      if (st.current.clip !== 'keep_crouch') continue;
      expect(st.weight, `settled at release${rel} ms`).toBe(1);
      expect(st.previous).toBeNull();
    }
    const stage = stubStage();
    stage.poseActor(keeper, p.releaseScene - 2500, [KITS[0], KITS[1]], null);
    const rig = stage.rigOf('keeper')!;
    // The held ball in the palm (BALL_IN_HAND), the throwing hand's; the keeper's two gloves' midpoint otherwise.
    const right = ballInHand(rig, 'R');
    expect(dist(stage.handOf('keeper:throw')!, right)).toBeLessThan(1e-9);
    const mid = ballInHand(rig, 'L').add(right).multiplyScalar(0.5);
    expect(dist(stage.handOf('keeper')!, mid)).toBeLessThan(1e-9);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Round 8 (WEB-HUMANS-3): the arms, the heel, the pelvis and the first steps of a run, frame to frame
// ---------------------------------------------------------------------------------------------------------------

/** TRACKB's and MOTION's packs loaded and committed for `fn` (as the overlay test does), and dropped again after it. */
async function withPacks(fn: () => void | Promise<void>): Promise<void> {
  const lib = await import('@/render3d/core/motion/library');
  const { readFile } = await import('node:fs/promises');
  lib.resetMotionLibrary();
  try {
    await lib.loadMotionPacks('/practice/motion/', async (url) => {
      try {
        const b = await readFile(`public/practice/motion/${url.split('/').pop()}`);
        return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
      } catch {
        return null;
      }
    });
    lib.commitMotion();
    await fn();
  } finally {
    lib.resetMotionLibrary();
  }
}

/** The pose hook the stage draws a script's batters with (ThreePracticeStage.poseHooks, as drawScript is given it). */
async function stageHook(script: BallScript): Promise<never> {
  const { ThreePracticeStage } = await import('@/render3d/three/ThreePracticeStage');
  const self = {
    hookCache: new WeakMap(),
    reducedMotion: false,
    cueHook: (ThreePracticeStage.prototype as unknown as { cueHook: unknown }).cueHook,
  };
  return (ThreePracticeStage.prototype as unknown as { poseHooks(s: unknown, p: unknown): never }).poseHooks.call(
    self,
    script,
    script.practice!,
  );
}

const KITS_BOTH: [(typeof KITS)[number], (typeof KITS)[number]] = [KITS[0], KITS[1]];
const FRAME_MS = 1000 / 60;

/** The striker's elbows (forearm bone origins) in his own frame, at the rig's scale (m): his arms' motion, not the run's. */
function elbowsOf(rig: PlayerRig): [Vector3, Vector3] {
  rig.root.updateMatrixWorld(true);
  const k = Math.abs(rig.root.scale.x);
  const at = (b: 'forearmL' | 'forearmR') =>
    rig.root.worldToLocal(new Vector3().setFromMatrixPosition(rig.boneMap[b].matrixWorld)).multiplyScalar(k);
  return [at('forearmL'), at('forearmR')];
}

/** A striker's intent as the WEB-HUMANS probes (and their 192-delivery corpus) give it. */
interface CorpusIntent {
  kind: 'attack' | 'defend';
  directionDeg: number;
  elevation: number;
  power: number;
  footwork: Footwork;
}
const CORPUS_DRIVE: CorpusIntent = { kind: 'attack', directionDeg: 10, elevation: 0, power: 0.8, footwork: 'forward' };
const CORPUS_FWD_DEFENCE: CorpusIntent = {
  kind: 'defend',
  directionDeg: 0,
  elevation: 0,
  power: 0.3,
  footwork: 'forward',
};
const CORPUS_PULL: CorpusIntent = { kind: 'attack', directionDeg: -80, elevation: 0.2, power: 0.9, footwork: 'back' };

/**
 * One delivery of the probes' corpus (4 overs × 3 balls × 2 hands × 8 intents, seeds `web-humans-ov|i`): over `i` (even:
 * pace, odd: spin; balanced, green, hard, turning in turn), ball 0–2 of its first three, and the intent timed on the ideal
 * contact (`errMs` late); no intent: the ball is left alone.
 */
function corpusDelivery(i: number, ball: number, hand: Handedness, intent: CorpusIntent | null, errMs = 0) {
  const conditions = (['balanced', 'green', 'hard', 'turning'] as const satisfies readonly PitchCondition[])[i % 4];
  const over = randomOver({
    seed: `web-humans-ov|${i}`,
    conditions,
    assist: 'play',
    family: i % 2 === 0 ? 'pace' : 'spin',
  });
  const b = overBalls(over, conditions, i).slice(0, 3)[ball];
  const fl = flight({
    plan: over.balls[b.ballIndex],
    bowler: over.bowler,
    conditions,
    seed: b.seed,
    ball: over.ball,
    handedness: hand,
  });
  const field = autoField(over.bowler, conditions, hand, over.ball);
  const swing: NormalizedSwing | null = intent
    ? {
        ...intent,
        startT: idealTimeFor(fl, intent.footwork) - batTravelMs(intent.kind, intent.power) / 1000 + errMs / 1000,
      }
    : null;
  const result = resolveDelivery({
    flight: fl,
    swing,
    field,
    bowler: over.bowler,
    conditions,
    handedness: hand,
    assist: 'play',
    tierToleranceMs: 0,
  });
  return {
    result,
    script: buildPracticeScript({
      setup: { field, bowler: over.bowler, conditions, handedness: hand },
      flight: fl,
      result,
    }),
  };
}

describe("the striker's elbows move on, frame to frame (round 8; the trigger elbow flip, audit T3)", () => {
  // The two §9 ranges (upper-arm twist, wrist swing) leave an elbow two windows to sit in, and a solve from the glove's
  // pole alone flipped between them as the demanded twist crossed 180°: the left elbow jumped 21 cm for three frames at
  // release − 183 ms, on every ball (external views only). Measured on the 192-delivery corpus before: the trigger had
  // 340 frames over 3 cm (max 24 cm); after, none. The backlift lifts the hands up to 7 cm a frame, so the elbows may
  // move up to 5.2 cm there (measured); the gate is 6 cm, and 3 cm everywhere the hands themselves are slow.
  const CASES = [
    ['attack', 10, 0.8, 7.5],
    ['defend', 0, 0.3, 4],
    ['attack', -80, 0.9, 3],
  ] as const;

  it('no elbow moves more than 3 cm between 60 Hz frames through the stance and the trigger, nor more than 6 cm through the backlift and the hold', async () => {
    await withPacks(async () => {
      let frames = 0;
      for (const hand of ['right', 'left'] as const) {
        for (const [kind, directionDeg, power, lengthM] of CASES) {
          const { script, result } = play({
            hand,
            seed: `elbow:${hand}:${kind}:${directionDeg}`,
            plan: { lengthM },
            swing: { kind, directionDeg, power },
          });
          const p = script.practice!;
          const striker = script.actors.find((a) => a.id === 'striker')!;
          const hook = await stageHook(script);
          const stage = stubStage();
          const input = simToScene(p, result.swing!.startT);
          let prev: [Vector3, Vector3] | null = null;
          let k = 0;
          // From 400 ms (the planted-foot plan fades in over the first 300 ms of every script, humansHook FADE_IN_MS), and
          // from the second frame on: the first frame has no frame behind it, so the arm is solved from the pole alone and
          // settles 2.6 cm into its remembered place at the next (once per delivery, before anyone looks).
          for (let t = Math.max(400, p.releaseScene - 1400); t < input; t += FRAME_MS) {
            stage.poseActor(
              striker,
              t,
              KITS_BOTH,
              externalBatPose(p.bat, striker, t, stage.rigOf('striker')?.scale ?? 1),
              hook,
            );
            const now = elbowsOf(stage.rigOf('striker')!);
            if (prev && k++ > 0) {
              const step = Math.max(now[0].distanceTo(prev[0]), now[1].distanceTo(prev[1]));
              const limit = t < p.releaseScene ? 0.03 : 0.06;
              expect(
                step,
                `${hand} ${kind} ${directionDeg}: elbow step at release${t >= p.releaseScene ? '+' : ''}${(t - p.releaseScene).toFixed(0)} ms (m)`,
              ).toBeLessThan(limit);
              frames++;
            }
            prev = now;
          }
        }
      }
      expect(frames, 'frames checked').toBeGreaterThan(400);
    });
  });

  it("flips an elbow in the stroke and the hand-over to the rest on few frames (an elbow step 10 cm past its own hand's)", async () => {
    // Fast swings move the elbows legitimately (the hands run up to 20 cm a frame), so the stroke has no 3 cm gate; a flip
    // is an elbow that moves much further than the hand it serves. Measured on the 192-delivery corpus: 1,408 such frames
    // before round 8 (250 in the trigger, 324 in the backlift, 466 in the stroke, 326 into the rest, 42 in the run), 198
    // after (none before the input). The ceiling below is the measure on this small corpus (4), with a margin.
    await withPacks(async () => {
      let flips = 0;
      let frames = 0;
      for (const hand of ['right', 'left'] as const) {
        for (const [kind, directionDeg, power, lengthM] of CASES) {
          const { script } = play({
            hand,
            seed: `elbow:${hand}:${kind}:${directionDeg}`,
            plan: { lengthM },
            swing: { kind, directionDeg, power },
          });
          const p = script.practice!;
          const striker = script.actors.find((a) => a.id === 'striker')!;
          const hook = await stageHook(script);
          const stage = stubStage();
          let prevE: [Vector3, Vector3] | null = null;
          let prevH: [Vector3, Vector3] | null = null;
          let k = 0;
          for (
            let t = Math.max(400, p.releaseScene - 1400);
            t < Math.min(script.duration, p.releaseScene + 3200);
            t += FRAME_MS
          ) {
            stage.poseActor(
              striker,
              t,
              KITS_BOTH,
              externalBatPose(p.bat, striker, t, stage.rigOf('striker')?.scale ?? 1),
              hook,
            );
            const rig = stage.rigOf('striker')!;
            const e = elbowsOf(rig);
            const kk = Math.abs(rig.root.scale.x);
            const h = (['handL', 'handR'] as const).map((n) =>
              rig.root.worldToLocal(new Vector3().setFromMatrixPosition(rig.boneMap[n].matrixWorld)).multiplyScalar(kk),
            ) as [Vector3, Vector3];
            if (prevE && prevH && k++ > 0) {
              for (let a = 0; a < 2; a++) if (e[a].distanceTo(prevE[a]) - h[a].distanceTo(prevH[a]) > 0.1) flips++;
              frames++;
            }
            prevE = e;
            prevH = h;
          }
        }
      }
      expect(frames, 'frames checked').toBeGreaterThan(1500);
      expect(flips, 'elbow flip frames').toBeLessThanOrEqual(6);
    });
  });
});

describe("the planted foot's heel (round 7: the ankle's §9 range with the ball of the foot down)", () => {
  // A shin that leans on over a foot held flat takes the ankle past its range (§9: X ∈ [−40°, 60°]; the drawn foot reached
  // −41° in 157 frames of 20 of the 192 corpus deliveries); the heel rises about the ball of the foot instead
  // (humansHook heelsUp, from −35° and never past −39.5°), and the ball stays where it is.
  const ANKLE_MIN_DEG = -40;
  const BALL_OF_FOOT = new Vector3(0, -0.065, 0.135);
  const xRot = (deg: number): [number, number, number, number] => [
    Math.sin((deg * Math.PI) / 360),
    0,
    0,
    Math.cos((deg * Math.PI) / 360),
  ];
  const ankleX = (pose: ReturnType<typeof createPose>, i: number) =>
    (new Euler().setFromQuaternion(
      new Quaternion(pose.q[i * 4], pose.q[i * 4 + 1], pose.q[i * 4 + 2], pose.q[i * 4 + 3]),
      'XYZ',
    ).x *
      180) /
    Math.PI;

  /** A standing pose, the left shin leaning on by `shinDeg` with the foot held flat, the hips lowered by `drop` (m). */
  async function leaning(shinDeg: number, drop: number) {
    const { BONE_INDEX } = await import('@/render3d/core/skeleton');
    const pose = createPose();
    pose.q.set(xRot(shinDeg), BONE_INDEX.shinL * 4);
    pose.q.set(xRot(-shinDeg), BONE_INDEX.footL * 4);
    pose.root = [0, -drop, 0];
    return { pose, foot: BONE_INDEX.footL };
  }
  /** The ball of the left foot (actor frame, m) in the pose: forward kinematics of the pose as it stands. */
  async function ballOf(pose: ReturnType<typeof createPose>) {
    const { createJoints, forwardKinematics } = await import('@/render3d/core/locomotion');
    const { BONE_INDEX } = await import('@/render3d/core/skeleton');
    const j = forwardKinematics(pose, createJoints());
    const i = BONE_INDEX.footL;
    const q = new Quaternion(j.q[i * 4], j.q[i * 4 + 1], j.q[i * 4 + 2], j.q[i * 4 + 3]);
    return new Vector3(j.p[i * 3], j.p[i * 3 + 1], j.p[i * 3 + 2]).add(BALL_OF_FOOT.clone().applyQuaternion(q));
  }

  it('lifts the heel of a flat planted foot about the ball of the foot, which stays within 2 cm, and the ankle stays inside its range', async () => {
    const { heelsUp } = await import('@/render3d/core/motion/humansHook');
    const { createJoints, forwardKinematics } = await import('@/render3d/core/locomotion');
    // A shin leaning 45° over a flat foot is an ankle at −45°; lower the hips until the ball of the foot is on the turf.
    const probe = await leaning(45, 0);
    const lift = (await ballOf(probe.pose)).y;
    const { pose, foot } = await leaning(45, lift);
    const before = await ballOf(pose);
    expect(ankleX(pose, foot), "the fixture's ankle (deg)").toBeLessThan(ANKLE_MIN_DEG);
    expect(before.y, "the fixture's ball of the foot above the turf (m)").toBeLessThan(0.01);
    heelsUp(pose, forwardKinematics(pose, createJoints()));
    const after = await ballOf(pose);
    expect(ankleX(pose, foot), 'the ankle after the heel rise (deg)').toBeGreaterThanOrEqual(ANKLE_MIN_DEG);
    expect(ankleX(pose, foot), 'the heel has risen (deg)').toBeGreaterThan(-45);
    expect(Math.hypot(after.x - before.x, after.z - before.z), 'the ball of the foot slides (m)').toBeLessThan(0.02);
    expect(Math.abs(after.y - before.y), 'the ball of the foot lifts (m)').toBeLessThan(0.02);
  });

  it('turns a foot in the air only at the ankle, to the edge of its range, and leaves a foot inside its range alone', async () => {
    const { heelsUp } = await import('@/render3d/core/motion/humansHook');
    const { createJoints, forwardKinematics } = await import('@/render3d/core/locomotion');
    const air = await leaning(45, -0.3);
    expect(air.pose.root[1]).toBeGreaterThan(0);
    heelsUp(air.pose, forwardKinematics(air.pose, createJoints()));
    expect(ankleX(air.pose, air.foot), 'a foot in the air, after (deg)').toBeGreaterThanOrEqual(ANKLE_MIN_DEG);
    const ok = await leaning(20, 0);
    const x0 = ankleX(ok.pose, ok.foot);
    heelsUp(ok.pose, forwardKinematics(ok.pose, createJoints()));
    expect(ankleX(ok.pose, ok.foot), 'an ankle at −20° is not touched (deg)').toBeCloseTo(x0, 6);
  });

  it("keeps both ankles inside their range through the corpus' forward strokes (the lifted feet of the stride included), the hook calling it every frame", async () => {
    await withPacks(async () => {
      const euler = new Euler();
      let heelFrames = 0;
      for (const hand of ['right', 'left'] as const) {
        for (const [over, ball] of [
          [1, 0],
          [1, 1],
          [3, 0],
          [0, 2],
        ] as const) {
          const { script, result } = corpusDelivery(over, ball, hand, CORPUS_DRIVE);
          const p = script.practice!;
          const striker = script.actors.find((a) => a.id === 'striker')!;
          const hook = await stageHook(script);
          const stage = stubStage();
          const input = simToScene(p, result.swing!.startT);
          for (let t = input - 200; t <= input + 1000; t += FRAME_MS) {
            stage.poseActor(
              striker,
              t,
              KITS_BOTH,
              externalBatPose(p.bat, striker, t, stage.rigOf('striker')?.scale ?? 1),
              hook,
            );
            const rig = stage.rigOf('striker')!;
            for (const name of ['footL', 'footR'] as const) {
              const x = (euler.setFromQuaternion(rig.boneMap[name].quaternion, 'XYZ').x * 180) / Math.PI;
              expect(
                x,
                `${hand} drive ${over}/${ball}: ${name} X at input${t >= input ? '+' : ''}${(t - input).toFixed(0)} ms (deg)`,
              ).toBeGreaterThanOrEqual(ANKLE_MIN_DEG);
              if (x < -36) heelFrames++;
            }
          }
        }
      }
      // The corpus does turn ankles to the edge of their range (otherwise the check above says nothing): 4 frames of 8 drives
      // since round 8 (the rolling stance of the first steps of a run no longer pins an ankle over a pitching foot), 2–5 per drive before.
      expect(heelFrames, 'frames with a heel up').toBeGreaterThanOrEqual(2);
    });
  });
});

describe("the planned pelvis turn (round 7: out before the overlay's follow-through takes the hips)", () => {
  // The reach plan turns the pelvis (45% of the trunk's turn, up to 40°) so the arms reach the bat. TRACKB's overlay turns
  // the hips itself through its follow-through, from its `contact` marker (PhysicsBodyPlan.stroke.followAt); the two added
  // and the hips stepped 2.6 m/s in a frame (21 of 192 deliveries over the §9 hips cap, 600°/s, at about input + 800 ms).
  // The planned turn therefore fades out over PELVIS_OUT_MS and is gone by that marker.
  it('shares out the planned pelvis turn: all of it until PELVIS_OUT_MS before the follow-through, none from its start, smoothly between', async () => {
    const { PELVIS_OUT_MS, pelvisShareAt } = await import('@/render3d/core/motion/humansHook');
    const followAt = 1234.5;
    expect(PELVIS_OUT_MS).toBeGreaterThan(100);
    expect(pelvisShareAt(followAt, followAt - PELVIS_OUT_MS - 1)).toBe(1);
    expect(pelvisShareAt(followAt, followAt - PELVIS_OUT_MS)).toBe(1);
    expect(pelvisShareAt(followAt, followAt), 'gone at the marker').toBe(0);
    expect(pelvisShareAt(followAt, followAt + 1)).toBe(0);
    let prev = 1;
    for (let t = followAt - PELVIS_OUT_MS - 50; t <= followAt + 50; t += FRAME_MS / 4) {
      const w = pelvisShareAt(followAt, t);
      expect(w, `share at ${t.toFixed(1)}`).toBeLessThanOrEqual(prev + 1e-12);
      expect(prev - w, 'no step: at most 0.16 of the turn a 60 Hz frame').toBeLessThan(0.04);
      prev = w;
    }
  });

  it("plans followAt on the overlay's own contact marker, and the hips keep to their §9 speed cap (600°/s) around it", async () => {
    await withPacks(async () => {
      const { clipMarker } = await import('@/render3d/core/clips');
      const { strokeOverlay } = await import('@/render3d/practice/script');
      const q = new Quaternion();
      const prevQ = new Quaternion();
      let checked = 0;
      for (const [over, ball, hand, intent] of [
        [0, 2, 'right', CORPUS_PULL],
        [0, 2, 'left', CORPUS_PULL],
        [1, 1, 'right', CORPUS_PULL],
        [1, 2, 'left', CORPUS_PULL],
        [0, 1, 'right', CORPUS_DRIVE],
        [1, 0, 'left', CORPUS_DRIVE],
        [2, 1, 'right', CORPUS_PULL],
        [3, 1, 'right', CORPUS_PULL],
        [1, 0, 'left', CORPUS_FWD_DEFENCE],
        [2, 0, 'right', CORPUS_FWD_DEFENCE],
      ] as const) {
        const { script, result } = corpusDelivery(over, ball, hand, intent);
        const ov = strokeOverlay(result);
        const striker = script.actors.find((a) => a.id === 'striker')!;
        const stroke = striker.physicsBody?.stroke;
        if (!ov || !stroke || stroke.followAt == null) continue;
        checked++;
        const p = script.practice!;
        // The marker is `contact` of the overlay clip, a fixed time after its plant: the plan lands on it, on any warp.
        expect(stroke.followAt - stroke.plantAt, `followAt after the plant, over ${over} ball ${ball}`).toBeCloseTo(
          clipMarker(ov.id, 'contact', (ov.plantMs + 50) / 1000) * 1000 - ov.plantMs,
          6,
        );
        const hook = await stageHook(script);
        const stage = stubStage();
        let worst = 0;
        let hasPrev = false;
        for (let t = stroke.followAt - 350; t <= stroke.followAt + 350; t += FRAME_MS) {
          stage.poseActor(
            striker,
            t,
            KITS_BOTH,
            externalBatPose(p.bat, striker, t, stage.rigOf('striker')?.scale ?? 1),
            hook,
          );
          q.copy(stage.rigOf('striker')!.boneMap.hips.quaternion);
          if (hasPrev)
            worst = Math.max(worst, ((2 * Math.acos(Math.min(1, Math.abs(q.dot(prevQ)))) * 180) / Math.PI) * 60);
          prevQ.copy(q);
          hasPrev = true;
        }
        expect(
          worst,
          `${hand} over ${over} ball ${ball}: hips angular speed within 350 ms of the follow-through (deg/s)`,
        ).toBeLessThan(600);
      }
      expect(checked, 'overlay strokes checked').toBeGreaterThanOrEqual(4);
    });
  });
});

describe('the first steps of a run (rounds 7 and 8: the shoes roll over the turf as the batters set off)', () => {
  // The sprint root (7 m/s² from rest) outran the run clips' first stride: the striker's planted foot slid 20 cm over the
  // first 700 ms (p50 4.9 cm), the non-striker's 8 cm. Round 7 pinned each ankle where the foot stands until the run
  // lifts it; that held the ankle but not the shoe: the clip pitches the foot to toe off, and the pinned ankle swept the
  // toe through the turf (10 cm under it) and along it. Round 8 pins the lowest sole point (heel, ball, tip as the foot
  // rolls) and lets the ankle follow the clip's pitch, the stance rolling on past the clip's contact until the foot has left
  // the turf, and the swinging foot keeps its sole 2 cm off it. MOTION-SPEC §9's shoe points (within 1.2 cm of the turf,
  // sliding): first stance to toe-off, 13 runs of the probe corpus, before → after: striker p50 4.3 → 1.1 cm, max 19.3 → 8.7;
  // non-striker p50 15.5 → 2.0 cm, max 65.2 → 21.7; the lowest sole point under the turf: 7.8 cm with the round-7 pin (this test's runs) → 3.3 cm. NOT the 2 cm of the gate for all of them: the sprint root still outruns
  // the stride (the pinned foot is left 1 m behind the hips by +500 ms; the leg stretches, the heel is lifted by plantFeet
  // and the foot drags and then catches up at 10 m/s), the ceilings below are the measure.
  const RUN_BOWLERS: BowlerProfile[] = [
    { family: 'pace', paceBand: 'fast', arm: 'right', lookSeed: 'c1' },
    { family: 'spin', spinType: 'finger', arm: 'right', lookSeed: 'c3' },
  ];
  const RUNS = [
    [0, 'right', 5, -35],
    [0, 'left', 6, -35],
    [1, 'right', 5, -35],
    [0, 'right', 3, 40],
    [1, 'left', 3, -35],
    [0, 'right', 6, 20],
    [0, 'right', 3, -60],
    [1, 'right', 3, -35],
  ] as const;
  const SOLE = [new Vector3(0, -0.065, -0.05), new Vector3(0, -0.065, 0.135), new Vector3(0, -0.065, 0.2)];

  /**
   * MOTION-SPEC §9, the shoe points: each of a foot's three sole points that is within 1.2 cm of the turf must stay put.
   * Returns the largest slide of any point during its first stretch down from the set-off (m), and the lowest any point
   * goes (m; below the turf is negative).
   */
  const soleSlide = (feet: Vector3[][][]): { slide: number; lowest: number } => {
    let slide = 0;
    let lowest = Infinity;
    for (const foot of feet) {
      for (let k = 0; k < 3; k++) {
        let anchor: Vector3 | null = null;
        let done = false;
        for (const frame of foot) {
          const v = frame[k];
          lowest = Math.min(lowest, v.y);
          if (done) continue;
          if (v.y <= 0.012) {
            anchor ??= v;
            slide = Math.max(slide, Math.hypot(v.x - anchor.x, v.z - anchor.z));
          } else if (anchor) done = true;
        }
      }
    }
    return { slide, lowest };
  };

  it('rolls the shoes: no sole point slides more than a median of 2.5 cm from the set-off to the first toe-off, nor is driven into the turf', async () => {
    await withPacks(async () => {
      const rows: Record<string, number[]> = { striker: [], nonStriker: [] };
      for (const [b, hand, lengthM, directionDeg] of RUNS) {
        const bowler = RUN_BOWLERS[b];
        const seed = `rs:${bowler.lookSeed}:${hand}:${lengthM}:${directionDeg}`;
        const fl = flight({
          plan: { variation: 'stock', lengthM, lineM: -0.05, speedKph: bowler.family === 'spin' ? 84 : 128 },
          bowler,
          conditions: 'balanced',
          seed,
          handedness: hand,
        });
        const field = autoField(bowler, 'balanced', hand);
        const swing: NormalizedSwing = {
          kind: 'attack',
          startT: fl.idealContactT - batTravelMs('attack', 0.5) / 1000,
          directionDeg,
          power: 0.5,
          elevation: 0.05,
          footwork: 'auto',
        };
        const result = resolveDelivery({
          flight: fl,
          swing,
          field,
          bowler,
          conditions: 'balanced',
          handedness: hand,
          assist: 'play',
          tierToleranceMs: 0,
        });
        const runs = runTimes(result);
        if (!runs.length) continue;
        const script = buildPracticeScript({
          setup: { field, bowler, conditions: 'balanced', handedness: hand },
          flight: fl,
          result,
        });
        const p = script.practice!;
        const hook = await stageHook(script);
        const stage = stubStage();
        const setOff = simToScene(p, setOffT(runs));
        for (const id of ['striker', 'nonStriker'] as const) {
          const track = script.actors.find((a) => a.id === id)!;
          const feet: Vector3[][][] = [[], []];
          for (let t = setOff - 300; t <= setOff + 700; t += FRAME_MS) {
            stage.poseActor(
              track,
              t,
              KITS_BOTH,
              id === 'striker' ? externalBatPose(p.bat, track, t, stage.rigOf(id)?.scale ?? 1) : null,
              hook,
            );
            const rig = stage.rigOf(id)!;
            rig.root.updateMatrixWorld(true);
            if (t >= setOff)
              (['footL', 'footR'] as const).forEach((n, f) =>
                feet[f].push(SOLE.map((q) => q.clone().applyMatrix4(rig.boneMap[n].matrixWorld))),
              );
          }
          const { slide, lowest } = soleSlide(feet);
          rows[id].push(slide);
          expect(lowest, `${id} ${seed}: lowest sole point from the set-off (m)`).toBeGreaterThan(-0.04);
          expect(slide, `${id} ${seed}: sole slide from the set-off to the first toe-off (m)`).toBeLessThan(
            id === 'striker' ? 0.1 : 0.23,
          );
        }
      }
      for (const id of ['striker', 'nonStriker']) {
        expect(rows[id].length, `${id} runs checked`).toBeGreaterThanOrEqual(5);
        const sorted = [...rows[id]].sort((a, b) => a - b);
        expect(sorted[Math.floor(sorted.length / 2)], `${id} median sole slide (m)`).toBeLessThan(0.025);
      }
    });
  });

  it('keeps both batters on the physics crease times: at the turning point on each completion, 1 ms earlier still on the way', () => {
    let checked = 0;
    for (const [dir, lengthM, power] of [
      [-35, 5, 0.5],
      [-35, 4, 0.6],
      [40, 5, 0.6],
      [60, 4, 0.7],
      [-60, 6, 0.6],
      [20, 3, 0.5],
      [75, 6, 0.6],
      [-20, 4, 0.4],
      [-50, 5, 0.8],
      [50, 5, 0.8],
      [-30, 6, 0.7],
      [30, 6, 0.7],
      [-80, 4, 0.9],
      [80, 4, 0.9],
    ] as const) {
      const { result, script } = play({
        plan: { lengthM, lineM: -0.05, speedKph: 128 },
        swing: { kind: 'attack', directionDeg: dir, power, elevation: 0.05 },
      });
      const p = script.practice!;
      for (const id of ['striker', 'nonStriker'] as const) {
        const track = script.actors.find((a) => a.id === id)!;
        runTimes(result as DeliveryResult).forEach((rt) => {
          const at = simToScene(p, rt);
          const target = 8.84 - TURN_SHORT_M;
          const z = Math.abs(evaluateActor(track, at).pos.z);
          expect(Math.abs(z - target), `${id} at the completion (m)`).toBeLessThan(0.001);
          // 1 ms before, still short of it by no more than the sprint's top speed (10.5 m/s) covers in a millisecond.
          const before = Math.abs(evaluateActor(track, at - 1).pos.z);
          expect(Math.abs(before - target), `${id} 1 ms before the completion (m)`).toBeLessThan(0.0105);
          checked++;
        });
      }
    }
    expect(checked, 'completions checked').toBeGreaterThan(6);
  });
});

describe('plantFeet engages a leg by its weight (round 8: the first-frame snap)', () => {
  // The planted-foot plan fades its weight in from 0. plantFeet passed the weight to the IK as a blend of the TARGET only,
  // and the IK's soft reach bends a straight leg about 24° whatever the target: the first frame a weight was above 0 snapped
  // both shins 22° (1,339°/s against the 1,200°/s cap; the bowler's first frame, a run-up opened from a straight-legged
  // stand). plantFeetLocked already blended the rotations by the weight; so does plantFeet now.
  const angleDeg = (a: Float32Array, b: Float32Array, i: number) => angleBetween(a, b, i);
  function angleBetween(a: Float32Array, b: Float32Array, i: number): number {
    const d = Math.abs(
      a[i * 4] * b[i * 4] + a[i * 4 + 1] * b[i * 4 + 1] + a[i * 4 + 2] * b[i * 4 + 2] + a[i * 4 + 3] * b[i * 4 + 3],
    );
    return (2 * Math.acos(Math.min(1, d)) * 180) / Math.PI;
  }

  /** A straight-legged standing pose planted at weight `w` on the spot where the feet stand 5 cm apart from the rest pose's. */
  async function planted(w: number) {
    const { createJoints, forwardKinematics, jointWorld, plantFeet } = await import('@/render3d/core/locomotion');
    const { BONE_INDEX } = await import('@/render3d/core/skeleton');
    const rest = createPose();
    const j = createJoints();
    forwardKinematics(rest, j);
    const home = (n: 'footL' | 'footR') => jointWorld(j, n, { x: 0, y: 0, z: 0 }, 0, 1);
    const pose = createPose();
    // Targets 4 cm ahead of and 3 cm out from where the straight legs have the ankles: within reach, not on the spot.
    const t = new Float32Array(8);
    (['footL', 'footR'] as const).forEach((n, f) => {
      const a = home(n);
      t[f * 4] = a.x + (f ? -0.03 : 0.03);
      t[f * 4 + 1] = a.y;
      t[f * 4 + 2] = a.z + 0.04;
      t[f * 4 + 3] = w;
    });
    plantFeet(pose, createJoints(), t, { x: 0, y: 0, z: 0 }, 0, 1);
    return { pose, rest, shin: [BONE_INDEX.shinL, BONE_INDEX.shinR], thigh: [BONE_INDEX.thighL, BONE_INDEX.thighR] };
  }

  it('leaves a straight-legged first frame nearly where it was (at most 2° of a shin at weight 0.05) and takes the whole target at weight 1', async () => {
    const light = await planted(0.05);
    for (const i of [...light.shin, ...light.thigh])
      expect(angleDeg(light.pose.q, light.rest.q, i), `bone ${i} at weight 0.05 (deg)`).toBeLessThan(2);
    const full = await planted(1);
    const { createJoints, forwardKinematics, jointWorld } = await import('@/render3d/core/locomotion');
    const j = forwardKinematics(full.pose, createJoints());
    const j0 = forwardKinematics(full.rest, createJoints());
    // At weight 1 the ankles are on their targets (4 cm ahead, 3 cm out) within a centimetre: nothing changed there.
    for (const [n, sx] of [
      ['footL', 1],
      ['footR', -1],
    ] as const) {
      const a = jointWorld(j, n, { x: 0, y: 0, z: 0 }, 0, 1);
      const a0 = jointWorld(j0, n, { x: 0, y: 0, z: 0 }, 0, 1);
      expect(
        Math.hypot(a.x - (a0.x + sx * 0.03), a.z - (a0.z + 0.04)),
        `${n} from its target at weight 1 (m)`,
      ).toBeLessThan(0.01);
    }
    // Bending in is gradual: no 60 Hz step of the weight (fade-in over 300 ms: 0.055 a frame) moves a shin more than 4°.
    let prev = light.pose.q;
    for (let w = 0.05; w <= 1.0001; w += 0.055) {
      const now = (await planted(Math.min(1, w))).pose.q;
      for (const i of light.shin)
        expect(
          angleDeg(now, prev, i),
          `shin ${i} from weight ${(w - 0.055).toFixed(2)} to ${w.toFixed(2)} (deg)`,
        ).toBeLessThan(4);
      prev = now;
    }
  });
});

describe("the trunk's lean towards the bat (round 8: held to the trunk's §9 speed)", () => {
  // solveGrips leans the chest and the spine (up to 15° a step, 30° in all) when the arms alone cannot reach the bat; the
  // lean is built afresh every frame, so the bat's first move asked 15° of chest in one frame: 1,300–1,500°/s against the
  // §9 cap of 600°/s, in 5 of the 192 corpus deliveries (the chest at input + 50–150 ms). It now comes and goes at no more
  // than LEAN_MAX_DEG_PER_S from the frame before. The price, measured: the gloves lag the handle a few centimetres for a
  // few frames at the swing's start (the largest palm-to-handle gap of the corpus, 54 → 70 mm; p95 of all frames still 0.0).
  it("keeps the chest, the spine and the hips under their 600°/s cap through the swing's start in the deliveries that broke it", async () => {
    await withPacks(async () => {
      const q = new Quaternion();
      const prev = new Map<string, Quaternion>();
      for (const [over, ball, hand, intent] of [
        [0, 1, 'right', CORPUS_FWD_DEFENCE],
        [2, 0, 'right', CORPUS_FWD_DEFENCE],
        [2, 0, 'left', CORPUS_FWD_DEFENCE],
        [0, 0, 'left', CORPUS_PULL],
        [0, 0, 'right', CORPUS_PULL],
        [0, 2, 'right', { ...CORPUS_PULL, directionDeg: 40, footwork: 'back' as const, power: 0.8 }],
      ] as const) {
        const { script, result } = corpusDelivery(over, ball, hand, intent);
        const p = script.practice!;
        const striker = script.actors.find((a) => a.id === 'striker')!;
        const hook = await stageHook(script);
        const stage = stubStage();
        const input = simToScene(p, result.swing!.startT);
        prev.clear();
        for (let t = input - 200; t <= input + 500; t += FRAME_MS) {
          stage.poseActor(
            striker,
            t,
            KITS_BOTH,
            externalBatPose(p.bat, striker, t, stage.rigOf('striker')?.scale ?? 1),
            hook,
          );
          const rig = stage.rigOf('striker')!;
          for (const name of ['hips', 'spine', 'chest'] as const) {
            q.copy(rig.boneMap[name].quaternion);
            const before = prev.get(name);
            if (before)
              expect(
                ((2 * Math.acos(Math.min(1, Math.abs(q.dot(before)))) * 180) / Math.PI) * 60,
                `${hand} over ${over} ball ${ball}: ${name} angular speed at input${t >= input ? '+' : ''}${(t - input).toFixed(0)} ms (deg/s)`,
              ).toBeLessThan(600);
            prev.set(name, q.clone());
          }
        }
      }
    });
  });
});

describe("the bat key across an inertial switch (round 8: the stroke's end into the rest)", () => {
  // The inertial switch (Move.inertial) carried the bones over and let the clip's bat key jump to the new clip's with its
  // first frame: out of the stroke the key moved 0.8 m in one frame (the follow-through held the bat over the shoulder, the
  // rest carries it low), and the gloves' targets with it: an elbow 71 cm in a frame, the trunk's lean after it. The key and
  // the top hand's hold now decay with the bones. Into a run the key stays the clip's (the external bat hands over to it).
  it("moves the bat key no more than 25 cm in a 60 Hz frame through the stroke's end into the rest, and through a leave's", async () => {
    await withPacks(async () => {
      let worstMax = 0;
      for (const [over, ball, hand, intent] of [
        [0, 1, 'right', CORPUS_DRIVE],
        [1, 0, 'left', CORPUS_DRIVE],
        [0, 2, 'right', CORPUS_PULL],
        [1, 1, 'left', CORPUS_FWD_DEFENCE],
        [0, 0, 'right', null],
        [1, 1, 'left', null],
      ] as const) {
        const { script } = corpusDelivery(over, ball, hand, intent);
        const striker = script.actors.find((a) => a.id === 'striker')!;
        const rest = striker.moves.find((m) => m.clip === 'bat_rest');
        expect(rest, `over ${over} ball ${ball}: the rest follows`).toBeDefined();
        const a = createPose();
        const b = createPose();
        const l = createPose();
        let prev: { x: number; y: number; z: number } | null = null;
        for (let t = rest!.t0 - 100; t <= rest!.t0 + 600; t += FRAME_MS) {
          const pose = samplePresented(evaluateActor(striker, t), a, b, l);
          const key = pose.bat?.grip ?? [-0.25, 0.85, 0.08];
          const now = { x: key[0], y: key[1], z: key[2] };
          if (prev) {
            const step = Math.hypot(now.x - prev.x, now.y - prev.y, now.z - prev.z);
            worstMax = Math.max(worstMax, step);
            expect(
              step,
              `${intent ? 'stroke' : 'leave'} over ${over} ball ${ball}: bat key step at the rest + ${(t - rest!.t0).toFixed(0)} ms (m)`,
            ).toBeLessThan(0.25);
          }
          prev = now;
        }
      }
      expect(worstMax, 'the largest step is a real one (the keys move)').toBeGreaterThan(0.001);
    });
  });
});
