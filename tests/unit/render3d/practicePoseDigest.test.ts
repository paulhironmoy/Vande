/**
 * ASSETS-MOTION (DoD CLP-05): a non-chase Practice result plays none of the Chase moments and its pose traces are as they were.
 *
 * This file imports nothing of the Chase moments, so the same file runs unchanged on the base tree and on the working tree: it
 * poses the striker and the bowler of six ordinary deliveries (both hands, pace and spin, both arms; a drive, a six, a bowled ball, a
 * leave, a defence, an edge) at 60 Hz through the real StageScene with the Practice stage's pose hooks and the Director, and
 * prints one SHA-256 per delivery over every bone's quaternion and the root, rounded to 1e-5. Run it on both trees and compare the
 * `POSE-DIGEST` lines; the test itself only checks that a script built with no moment holds no Chase clip and is deterministic.
 */
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Group, PerspectiveCamera, Scene } from 'three';
import type { BowlerProfile, Handedness, NormalizedSwing, PracticeDeliveryPlan } from '@/contracts/practice';
import { autoField, batTravelMs, flight, resolveDelivery } from '@/physics';
import { idealTimeFor } from '@/physics/bat';
import type { BallScript } from '@/render3d/core/choreo';
import { createPose } from '@/render3d/core/clips';
import { DirectorRuntime } from '@/render3d/core/motion/director';
import { PRACTICE_PROFILES } from '@/render3d/core/quality';
import { externalBatPose } from '@/render3d/practice/bat';
import { buildPracticeScript } from '@/render3d/practice/script';
import { StageScene } from '@/render3d/three/stageScene';
import { ThreePracticeStage } from '@/render3d/three/ThreePracticeStage';
import { KITS } from '@/ui/avatar/traits';

const KITS2: [(typeof KITS)[0], (typeof KITS)[0]] = [KITS[0], KITS[1]];
const DT = 1000 / 60;

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

const proto = ThreePracticeStage.prototype as unknown as {
  poseHooks(s: unknown, p: unknown): Parameters<StageScene['poseActor']>[4];
  cueHook: unknown;
};

const PACE_R: BowlerProfile = { family: 'pace', paceBand: 'fast', arm: 'right', lookSeed: 'pd-p1' };
const PACE_L: BowlerProfile = { family: 'pace', paceBand: 'express', arm: 'left', lookSeed: 'pd-p2' };
const FINGER_R: BowlerProfile = { family: 'spin', spinType: 'finger', arm: 'right', lookSeed: 'pd-s1' };
const WRIST_L: BowlerProfile = { family: 'spin', spinType: 'wrist', arm: 'left', lookSeed: 'pd-s2' };

interface Ball {
  name: string;
  bowler: BowlerProfile;
  hand: Handedness;
  plan: Partial<PracticeDeliveryPlan>;
  swing: { kind: 'attack' | 'defend'; directionDeg: number; power: number; elevation: number } | null;
  errMs?: number;
}
const BALLS: Ball[] = [
  {
    name: 'drive RH v pace R',
    bowler: PACE_R,
    hand: 'right',
    plan: { lengthM: 4, lineM: 0.1, speedKph: 130 },
    swing: { kind: 'attack', directionDeg: 12, power: 0.9, elevation: 0.04 },
  },
  {
    name: 'six LH v wrist L',
    bowler: WRIST_L,
    hand: 'left',
    plan: { lengthM: 4, lineM: 0.1, speedKph: 86 },
    swing: { kind: 'attack', directionDeg: 10, power: 0.95, elevation: 1 },
  },
  {
    name: 'bowled RH v pace R',
    bowler: PACE_R,
    hand: 'right',
    plan: { lengthM: 4, lineM: 0.1, speedKph: 132 },
    swing: { kind: 'attack', directionDeg: 10, power: 0.8, elevation: 0 },
    errMs: 90,
  },
  {
    name: 'leave LH v pace L',
    bowler: PACE_L,
    hand: 'left',
    plan: { lengthM: 5, lineM: 0.4, speedKph: 140 },
    swing: null,
  },
  {
    name: 'defence RH v finger R',
    bowler: FINGER_R,
    hand: 'right',
    plan: { lengthM: 4.5, lineM: 0.25, speedKph: 84 },
    swing: { kind: 'defend', directionDeg: 0, power: 0.3, elevation: 0 },
  },
  {
    name: 'edge LH v pace L',
    bowler: PACE_L,
    hand: 'left',
    plan: { lengthM: 3, lineM: 0, speedKph: 140 },
    swing: { kind: 'attack', directionDeg: 0, power: 0.8, elevation: 0 },
    errMs: -110,
  },
];

function script(b: Ball, k: number): BallScript {
  const full: PracticeDeliveryPlan = { variation: 'stock', lengthM: 6, lineM: 0.1, speedKph: 130, ...b.plan };
  const fl = flight({
    plan: full,
    bowler: b.bowler,
    conditions: 'balanced',
    seed: `pd:${k}:${b.name}`,
    handedness: b.hand,
  });
  const field = autoField(b.bowler, 'balanced', b.hand);
  let swing: NormalizedSwing | null = null;
  if (b.swing)
    swing = {
      ...b.swing,
      footwork: 'forward',
      startT: idealTimeFor(fl, 'forward') - batTravelMs(b.swing.kind, b.swing.power) / 1000 + (b.errMs ?? 0) / 1000,
    };
  const result = resolveDelivery({
    flight: fl,
    swing,
    field,
    bowler: b.bowler,
    conditions: 'balanced',
    handedness: b.hand,
    assist: 'play',
    tierToleranceMs: 0,
  });
  return buildPracticeScript({
    setup: { field, bowler: b.bowler, conditions: 'balanced', handedness: b.hand },
    flight: fl,
    result,
  });
}

/** One SHA-256 over the striker's and the bowler's bones and roots, every 60 Hz frame from 500 ms before the release to 3 s after the dead ball. */
function digest(s: BallScript): string {
  const stage = stubStage();
  const rt = new DirectorRuntime();
  rt.register(s, 'replay', null);
  rt.finish(s);
  const hook = proto.poseHooks.call(
    { hookCache: new WeakMap(), reducedMotion: false, cueHook: proto.cueHook, director: rt },
    s,
    s.practice!,
  );
  const h = createHash('sha256');
  const p = s.practice!;
  const end = Math.min(s.duration, (p.deadScene ?? s.duration) + 3000);
  for (const id of ['striker', 'bowler'] as const) {
    const tr = s.actors.find((a) => a.id === id)!;
    for (let t = p.releaseScene - 500; t <= end; t += DT) {
      const rig = stage.rigOf(id);
      const bp = id === 'striker' ? externalBatPose(p.bat, tr, t, rig?.scale ?? 1) : null;
      stage.poseActor(tr, t, KITS2, bp, hook);
      const r = stage.rigOf(id)!;
      const a: number[] = [r.root.position.x, r.root.position.z, r.root.rotation.y];
      for (const b of r.bones) a.push(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
      h.update(a.map((v) => Math.round(v * 1e5)).join(','));
    }
  }
  return h.digest('hex');
}

describe('a Practice result with no Chase moment', () => {
  it('plays none of the Chase clips, is deterministic, and prints its pose digest (compare with the base tree)', () => {
    const lines: string[] = [];
    for (const [k, b] of BALLS.entries()) {
      const s = script(b, k);
      for (const a of s.actors)
        for (const m of a.moves)
          expect(String(m.clip), `${b.name} ${a.id}`).not.toMatch(
            /bat_celebrate_win|bat_walk_off|bowl_celebrate_defend|bowl_disappointed/,
          );
      const d = digest(s);
      expect(digest(script(b, k)), b.name).toBe(d);
      lines.push(`POSE-DIGEST ${b.name} ${d.slice(0, 16)}`);
    }
    console.log(lines.join('\n'));
  }, 300_000);
});
