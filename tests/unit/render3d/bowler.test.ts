/**
 * BOWLER-1: the bowler's arm and run-up as DRAWN (StageScene.drawScript posed at 60 Hz, bones read back), not as the
 * clip alone is. The audit (MOTION-LIFE) measured two defects the old tests could not see, because they measured the
 * palm through the hooked pose (poseActor) and not through the picture:
 * - the stage's release block dragged the hand to the physics release point and folded the elbow to 100° in the last
 *   120 ms (Law 21.2 allows 15° of extension; the clip's own bend is 10-13° and legal), and popped the idle bowler's arm
 *   60 cm once per between-balls scene;
 * - the run-up opened at 1.91× the clips' rate (cadence up to +51% over the MOTION-SPEC §9 band, peak acceleration
 *   13 m/s²).
 * A small, deterministic corpus covers both arms, pace and spin, and the deliveries whose release differs most from the
 * stock ball (yorker, bouncer, slower ball, the wrist spinner's googly).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Group, PerspectiveCamera, Scene, Vector3 } from 'three';
import type { BowlerProfile, DeliveryVariation, PracticeDeliveryPlan } from '@/contracts/practice';
import { autoField, flight } from '@/physics';
import { evaluateActor } from '@/render3d/core/actors';
import type { BallScript } from '@/render3d/core/choreo';
import { createPose } from '@/render3d/core/clips';
import { canComposeBouncer, canComposeRunup } from '@/render3d/core/motion/bowlerRunup';
import { PRACTICE_PROFILES } from '@/render3d/core/quality';
import { BONE_NAMES } from '@/render3d/core/skeleton';
import { toWorld } from '@/render3d/practice/frame';
import { buildPracticeScript, practiceReleaseScene } from '@/render3d/practice/script';
import { ThreePracticeStage, measureReleaseBall } from '@/render3d/three/ThreePracticeStage';
import { boneWorld } from '@/render3d/three/players';
import { RELEASE_REACH, StageScene, releaseReachWeight, type ScriptDrawOptions } from '@/render3d/three/stageScene';
import { KITS } from '@/ui/avatar/traits';

const KITS2: [(typeof KITS)[0], (typeof KITS)[0]] = [KITS[0], KITS[1]];
const DT = 1000 / 60;
const DEG = 180 / Math.PI;

const PACE: BowlerProfile = { family: 'pace', paceBand: 'fast', arm: 'right', lookSeed: 'bowler1-pace' };
const LEFT_ARM: BowlerProfile = { family: 'pace', paceBand: 'express', arm: 'left', lookSeed: 'bowler1-left' };
const FINGER: BowlerProfile = { family: 'spin', spinType: 'finger', arm: 'right', lookSeed: 'bowler1-finger' };
const WRIST: BowlerProfile = { family: 'spin', spinType: 'wrist', arm: 'right', lookSeed: 'bowler1-wrist' };

/** Deliveries chosen for how far their release is from the stock ball's: the largest residuals the reach has to take up. */
const CORPUS: Array<[string, BowlerProfile, DeliveryVariation, Partial<PracticeDeliveryPlan>]> = [
  ['pace stock', PACE, 'stock', {}],
  ['pace yorker (released 2.6 cm lower)', PACE, 'yorker', { lengthM: 1 }],
  ['pace bouncer (its own clip)', PACE, 'bouncer', { lengthM: 11 }],
  ['pace slower ball (hand rolled 58 deg)', PACE, 'slower', {}],
  ['left-arm express stock', LEFT_ARM, 'stock', { speedKph: 146 }],
  ['left-arm express yorker', LEFT_ARM, 'yorker', { lengthM: 1, speedKph: 146 }],
  ['finger spin stock', FINGER, 'stock', {}],
  ['finger spin arm ball', FINGER, 'arm_ball', {}],
  ['wrist spin googly (the largest wrist cue)', WRIST, 'wrong_un', {}],
];

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

// The repo's no-WebGL stage stub (a StageScene built without its constructor: new fields must be created on first use).
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

type Hook = ScriptDrawOptions['poseHook'];
const proto = ThreePracticeStage.prototype as unknown as { poseHooks(s: unknown, p: unknown): Hook; cueHook: unknown };
/** The stage's own pose hooks for a script: the production composition (release cue, field, planted feet). */
const hooksFor = (script: BallScript): Hook =>
  proto.poseHooks.call(
    { hookCache: new WeakMap(), reducedMotion: false, cueHook: proto.cueHook },
    script,
    script.practice!,
  );

function build(bowler: BowlerProfile, variation: DeliveryVariation, plan: Partial<PracticeDeliveryPlan> = {}) {
  const stage = stubStage();
  const stock = measureReleaseBall(stage, bowler, KITS2)!;
  const bouncer =
    bowler.family === 'pace' && canComposeBouncer() ? measureReleaseBall(stage, bowler, KITS2, 'bouncer') : null;
  const releaseHand = (bouncer ? { ...stock, bouncer } : stock) as never;
  const full: PracticeDeliveryPlan = {
    variation,
    lengthM: 6,
    lineM: 0.1,
    speedKph: bowler.family === 'spin' ? 86 : 136,
    ...plan,
  };
  const fl = flight({
    plan: full,
    bowler,
    conditions: 'balanced',
    seed: `bowler1:${bowler.lookSeed}:${variation}`,
    handedness: 'right',
  });
  const setup = {
    field: autoField(bowler, 'balanced', 'right'),
    bowler,
    conditions: 'balanced' as const,
    handedness: 'right' as const,
  };
  const script = buildPracticeScript({ setup, flight: fl, result: null, releaseHand });
  const idle = buildPracticeScript({ setup, flight: null, releaseHand });
  return {
    stage,
    fl,
    script,
    idle,
    hook: hooksFor(script),
    idleHook: hooksFor(idle),
    side: (bowler.arm === 'left' ? 'L' : 'R') as 'L' | 'R',
  };
}

/** The picture of the bowler alone at scene time t (drawScript: pose, hooks and the stage's own release reach). */
function draw(stage: StageScene, script: BallScript, hook: Hook, t: number) {
  const hidden = new Set(script.actors.filter((a) => a.id !== 'bowler').map((a) => a.id));
  stage.drawScript(script, t, { pos: { x: 0, y: 1.7, z: 12 }, target: { x: 0, y: 1, z: 0 }, fov: 30 } as never, {
    kits: KITS2,
    slow: false,
    clockMs: t,
    reducedMotion: false,
    hidden,
    bat: null,
    poseHook: hook,
  });
}

interface Snap {
  t: number;
  sh: Vector3;
  el: Vector3;
  wr: Vector3;
  hips: Vector3;
  footL: Vector3;
  footR: Vector3;
  palm: Vector3;
  q: Float32Array;
}
function snap(stage: StageScene, side: 'L' | 'R', t: number): Snap {
  const rig = stage.rigOf('bowler')!;
  const q = new Float32Array(rig.bones.length * 4);
  rig.bones.forEach((b, i) => q.set([b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w], i * 4));
  return {
    t,
    q,
    sh: boneWorld(rig, `upperArm${side}`),
    el: boneWorld(rig, `forearm${side}`),
    wr: boneWorld(rig, `hand${side}`),
    hips: boneWorld(rig, 'hips'),
    footL: boneWorld(rig, 'footL'),
    footR: boneWorld(rig, 'footR'),
    palm: stage.handOf('bowler')!.clone(),
  };
}
const bendOf = (s: Snap) => s.el.clone().sub(s.sh).angleTo(s.wr.clone().sub(s.el)) * DEG;
const elevOf = (s: Snap) => Math.asin(s.el.clone().sub(s.sh).normalize().y) * DEG;
const boneAngle = (a: Float32Array, b: Float32Array, name: string) => {
  const i = BONE_NAMES.indexOf(name as never);
  const d = Math.abs(
    a[i * 4] * b[i * 4] + a[i * 4 + 1] * b[i * 4 + 1] + a[i * 4 + 2] * b[i * 4 + 2] + a[i * 4 + 3] * b[i * 4 + 3],
  );
  return 2 * Math.acos(Math.min(1, d)) * DEG;
};
/** MOTION-SPEC §9 angular-speed caps (deg/s): the bowling and throwing arm 1800, other limbs 1200, hips/spine/chest 600, neck/head 720. */
const capOf = (name: string) =>
  /^(upperArm|forearm|hand)/.test(name)
    ? 1800
    : /^(thigh|shin|foot)/.test(name)
      ? 1200
      : /^(hips|spine|chest)/.test(name)
        ? 600
        : 720;

describe('the release reach (stageScene.ts)', () => {
  it('is a C1 ramp that is 1 exactly at the release and 0 before and after it', () => {
    const R = 2300;
    expect(releaseReachWeight(R - RELEASE_REACH.leadMs - 1, R)).toBe(0);
    expect(releaseReachWeight(R, R)).toBe(1);
    expect(releaseReachWeight(R + RELEASE_REACH.tailMs + 1, R)).toBe(0);
    let prev = 0;
    for (let t = R - RELEASE_REACH.leadMs; t <= R; t += 1) {
      const w = releaseReachWeight(t, R);
      expect(w).toBeGreaterThanOrEqual(prev - 1e-12);
      expect(Math.abs(w - prev), 'no step').toBeLessThan(0.02);
      prev = w;
    }
    for (let t = R; t <= R + RELEASE_REACH.tailMs; t += 1) {
      const w = releaseReachWeight(t, R);
      expect(w).toBeLessThanOrEqual(prev + 1e-12);
      prev = w;
    }
  });
});

describe('the bowling arm as drawn', () => {
  for (const [name, bowler, variation, plan] of CORPUS) {
    it(`stays the authored, legal arm and puts the ball on the physics release point: ${name}`, () => {
      const { stage, script, hook, side, fl } = build(bowler, variation, plan);
      const p = script.practice!;
      const R = p.releaseScene;
      const track = script.actors.find((a) => a.id === 'bowler')!;
      const phys = new Vector3(p.releaseWorld.x, p.releaseWorld.y, p.releaseWorld.z);
      // The physics release point is the first flight sample, and the release is at the physics release time.
      const first = toWorld(fl.samples[0].p, false);
      expect(
        phys.distanceTo(new Vector3(first.x, first.y, first.z)),
        'release point is the first flight sample',
      ).toBeLessThan(1e-9);
      expect(R, 'the composed release marker lands on the physics release time').toBe(practiceReleaseScene(bowler));

      const drawn: Snap[] = [];
      const clip: Snap[] = [];
      for (let j = -36; j <= 18; j++) {
        draw(stage, script, hook, R + j * DT);
        drawn.push(snap(stage, side, R + j * DT));
        stage.poseActor(track, R + j * DT, KITS2, null, hook);
        clip.push(snap(stage, side, R + j * DT));
      }
      const at = (j: number) => j + 36;
      const bend = drawn.map(bendOf);
      const elev = drawn.map(elevOf);
      // From the arm reaching the horizontal to the release the elbow may not straighten more than 15° (ICC / Law 21.2): the builder's gate is 10°.
      let horizontal = -1;
      for (let j = -24; j <= 0; j++)
        if (elev[at(j) - 1] < 0 && elev[at(j)] >= 0) {
          horizontal = j;
          break;
        }
      expect(horizontal, 'the arm reaches the horizontal before the release').toBeGreaterThan(-24);
      const window = bend.slice(at(horizontal), at(0) + 1);
      const peak = Math.max(...window);
      expect(peak - bend[at(0)], 'elbow bend, peak to release (deg)').toBeLessThanOrEqual(10);
      expect(
        peak - Math.min(...window.slice(window.indexOf(peak))),
        'elbow extension after the peak (deg)',
      ).toBeLessThanOrEqual(10);
      // The elbow is the clip's own (hooks and cues never bend it; the reach never touches it): within 3° at every frame around the release.
      for (let j = -12; j <= 6; j++)
        expect(Math.abs(bend[at(j)] - bendOf(clip[at(j)])), `elbow against the clip at ${j} frames`).toBeLessThan(3);
      // Elbow rate in the last 150 ms.
      let rate = 0;
      for (let j = -9; j <= 0; j++) rate = Math.max(rate, Math.abs(bend[at(j)] - bend[at(j) - 1]) * 60);
      expect(rate, 'elbow rate (deg/s)').toBeLessThanOrEqual(1200);
      // MOTION-SPEC §9: the bowling arm's bones turn at most 1800°/s through the delivery.
      for (const bone of ['upperArm', 'forearm', 'hand']) {
        let w = 0;
        for (let j = -35; j <= 18; j++)
          w = Math.max(w, boneAngle(drawn[at(j)].q, drawn[at(j) - 1].q, `${bone}${side}`) * 60);
        expect(w, `${bone}${side} angular speed (deg/s)`).toBeLessThanOrEqual(1800);
      }
      // The palm keeps its speed into the release (the old block slowed it from 22 to 3.5 m/s over the last frame pair).
      const speed = (s: Snap[], j: number) => s[at(j)].palm.distanceTo(s[at(j) - 1].palm) * 60;
      for (const j of [-2, -1, 0])
        expect(speed(drawn, j), `palm speed ${j} frames from the release against the clip's`).toBeGreaterThanOrEqual(
          0.8 * speed(clip, j),
        );
      // The ball in the palm is on the physics release point at the release instant (aim 1 cm; the ruled limit is 3 cm).
      expect(drawn[at(0)].palm.distanceTo(phys), 'palm to the physics release point at the release (m)').toBeLessThan(
        0.01,
      );
      // Nothing below the waist is moved by the reach: no root rise, the feet are the planted-feet plan's.
      expect(drawn[at(0)].hips.distanceTo(clip[at(0)].hips), 'hips').toBeLessThan(1e-6);
      expect(drawn[at(0)].footL.distanceTo(clip[at(0)].footL), 'left foot').toBeLessThan(1e-6);
      expect(drawn[at(0)].footR.distanceTo(clip[at(0)].footR), 'right foot').toBeLessThan(1e-6);
    });
  }
});

describe('the bowler between balls', () => {
  for (const [name, bowler] of [
    ['pace', PACE],
    ['left-arm', LEFT_ARM],
    ['finger spin', FINGER],
  ] as const) {
    it(`has no release and so no arm pop: ${name} (it was a 60 cm pop of the right arm 2.2 s into every scene)`, () => {
      const { stage, idle, idleHook, side } = build(bowler, 'stock');
      expect(idle.practice!.flight, 'a scene between balls has no flight').toBeNull();
      const R = idle.practice!.releaseScene;
      let prev: Snap | null = null;
      let lo = Infinity;
      let hi = -Infinity;
      let fastest = 0;
      let turning = 0;
      for (let t = R - 600; t <= R + 600; t += DT) {
        draw(stage, idle, idleHook, t);
        const s = snap(stage, side, t);
        lo = Math.min(lo, s.palm.y);
        hi = Math.max(hi, s.palm.y);
        if (prev) {
          fastest = Math.max(fastest, (s.palm.distanceTo(prev.palm) * 1000) / DT);
          for (const bone of ['upperArm', 'forearm', 'hand'])
            turning = Math.max(turning, boneAngle(s.q, prev.q, `${bone}${side}`) * 60);
        }
        prev = s;
      }
      expect(hi - lo, 'palm height range around the old pop (m)').toBeLessThan(0.05);
      expect(fastest, 'palm speed (m/s)').toBeLessThan(0.1);
      expect(turning, 'arm angular speed (deg/s)').toBeLessThan(30);
    });
  }
});

describe('the run-up as drawn', () => {
  /** MOTION-SPEC §9 gait bands (m/s, steps/min): walk 1.3-1.7 at 100-125, jog 2.8-3.8 at 150-175, run 5.0-6.5 at 165-190; linear between. */
  const bandTop = (v: number) => {
    const bands = [
      [1.3, 1.7, 125],
      [2.8, 3.8, 175],
      [5.0, 6.5, 190],
    ];
    if (v <= bands[0][1]) return bands[0][2];
    for (let i = 0; i < bands.length; i++) {
      if (v <= bands[i][1]) return bands[i][2];
      const n = bands[i + 1];
      if (n && v < n[0]) return bands[i][2] + ((v - bands[i][1]) / (n[0] - bands[i][1])) * (n[2] - bands[i][2]);
    }
    return bands[2][2];
  };

  for (const [name, bowler] of [
    ['pace', PACE],
    ['left-arm', LEFT_ARM],
    ['finger spin', FINGER],
    ['wrist spin', WRIST],
  ] as const) {
    it(`opens mid-walk at the clips' own rate, with a cadence inside the band and a root that leaves rest smoothly: ${name}`, () => {
      expect(canComposeRunup(bowler.family === 'pace' ? 'pace' : 'off')).toBe(true);
      const { stage, script, hook, side } = build(bowler, 'stock');
      const R = script.practice!.releaseScene;
      const track = script.actors.find((a) => a.id === 'bowler')!;

      // No fast-forward: every run-up segment plays its clip at rate 1 (it was 1.91 easing to 1.0), from the rolling start's phase.
      const run = track.moves.filter(
        (m) => m.clip.startsWith('vmp:runup_') && !m.clip.endsWith('_stand') && m.t1 < R + 400,
      );
      expect(run.length).toBeGreaterThan(30);
      for (const m of run) expect(m.rate ?? 1, `clip rate at ${Math.round(m.t0)} ms`).toBeCloseTo(1, 9);
      expect(track.moves[0].clip, 'he stands at the mark first').toMatch(/^vmp:runup_.*_stand$/);
      expect(track.moves[1].inertial, 'and hands over to the run by an inertialized blend').toBe(300);

      // The actor root leaves rest without a step (humans.test.ts: < 0.3 m/s per frame) and never slows while it gathers speed.
      const speeds: number[] = [];
      const pos = (t: number) => evaluateActor(track, t).pos;
      for (let k = 1; k * DT <= 1500; k++) {
        const a = pos((k - 1) * DT);
        const b = pos(k * DT);
        speeds.push(Math.hypot(b.x - a.x, b.z - a.z) / (DT / 1000));
      }
      expect(speeds[0], 'first-frame speed (m/s)').toBeLessThan(0.3);
      let worstStep = 0;
      let drop = 0;
      let top = 0;
      for (let k = 1; k < speeds.length; k++) {
        if ((k + 1) * DT <= 600) worstStep = Math.max(worstStep, Math.abs(speeds[k] - speeds[k - 1]));
        // Over the first second, while he gathers speed (a spin run-up is short: the delivery stride brakes him after that).
        if ((k + 1) * DT <= 1000) {
          top = Math.max(top, speeds[k]);
          drop = Math.max(drop, top - speeds[k]);
        }
      }
      expect(worstStep, 'root speed step per frame, first 0.6 s (m/s)').toBeLessThan(0.3);
      expect(drop, 'root speed never falls while it gathers, first second (m/s)').toBeLessThan(0.3);
      // Peak acceleration over a 0.2 s window (the old fast-forward: 9.4 to 14.1 m/s²).
      const sp = (k: number) => (speeds[Math.min(speeds.length - 1, k + 2)] + speeds[Math.max(0, k - 2)]) / 2;
      let peak = -Infinity;
      for (let k = 6; k < Math.floor((R - 450) / DT) && k + 6 < speeds.length; k++)
        peak = Math.max(peak, (sp(k + 6) - sp(k - 6)) / ((12 * DT) / 1000));
      expect(peak, 'peak 0.2 s acceleration of the root (m/s²)').toBeLessThanOrEqual(6);

      // Cadence: the strikes of the DRAWN feet (ankle below 10.5 cm) in the approach, against the §9 band at the hips' speed.
      const F: Snap[] = [];
      for (let k = 0; k * DT <= R - 300; k++) {
        draw(stage, script, hook, k * DT);
        F.push(snap(stage, side, k * DT));
      }
      const strikes: Array<{ k: number; t: number }> = [];
      for (const foot of ['footL', 'footR'] as const) {
        let down = false;
        F.forEach((f, k) => {
          const low = f[foot].y < 0.105;
          if (low && !down) strikes.push({ k, t: k * DT });
          down = low;
        });
      }
      strikes.sort((a, b) => a.t - b.t);
      const approach = strikes.filter((s) => s.t > 150 && s.t < R - 400);
      expect(approach.length, 'approach strikes').toBeGreaterThanOrEqual(3);
      const hipsSpeed = (k: number) =>
        Math.hypot(
          F[Math.min(F.length - 1, k + 2)].hips.x - F[Math.max(0, k - 2)].hips.x,
          F[Math.min(F.length - 1, k + 2)].hips.z - F[Math.max(0, k - 2)].hips.z,
        ) /
        ((4 * DT) / 1000);
      const intervals: number[] = [];
      for (let i = 1; i < approach.length && i <= 3; i++) {
        const iv = approach[i].t - approach[i - 1].t;
        intervals.push(iv);
        expect(
          60000 / iv,
          `cadence of approach step ${i} (steps/min) against 1.10 x the band at ${hipsSpeed(approach[i].k).toFixed(2)} m/s`,
        ).toBeLessThanOrEqual(1.1 * bandTop(hipsSpeed(approach[i].k)));
      }
      // The steps shorten as the speed rises (no rise by more than a frame), never the other way round.
      for (let i = 1; i < intervals.length; i++)
        expect(intervals[i], `step interval ${i}`).toBeLessThanOrEqual(intervals[i - 1] + DT + 1e-6);
    });
  }

  it('hands the idle pose over to the run without a pop: no bone over its MOTION-SPEC §9 cap, and none of the scene it replaces is far off', () => {
    const { stage, script, hook, idle, idleHook, side } = build(PACE, 'stock');
    // The script's first frame against the scene between balls it replaces (any phase of the idle): the whole body is the idle's
    // (the arms were 63-98° off, bowl_start's ball-held pose; the knees 24°, the planted-feet plan's knee bend that the first frame lacked).
    draw(stage, script, hook, 0);
    const first = snap(stage, side, 0);
    for (const t of [900, 1800, 2700, 3600]) {
      draw(stage, idle, idleHook, t);
      const s = snap(stage, side, t);
      for (const bone of BONE_NAMES)
        expect(boneAngle(s.q, first.q, bone), `${bone} against the idle at ${t} ms (deg)`).toBeLessThan(6);
    }
    // Then through the 0.6 s of the hand-over no bone exceeds its cap (the legs were 1339°/s on frame 1: the planted-feet hook,
    // locomotion.ts plantFeet, bends both knees at once the first frame its weight is above 0, and nothing smooths it).
    let prev = first;
    const worst: Record<string, number> = {};
    for (let k = 1; k * DT <= 600; k++) {
      draw(stage, script, hook, k * DT);
      const s = snap(stage, side, k * DT);
      for (const bone of BONE_NAMES) worst[bone] = Math.max(worst[bone] ?? 0, boneAngle(s.q, prev.q, bone) * 60);
      prev = s;
    }
    for (const bone of BONE_NAMES)
      expect(worst[bone], `${bone} angular speed in the hand-over (deg/s)`).toBeLessThanOrEqual(capOf(bone));
  });
});
