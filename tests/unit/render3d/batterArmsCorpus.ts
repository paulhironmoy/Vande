/**
 * The striker's arms, frame to frame, over whole deliveries (WEB-FIX-A, round 9; a helper for `batter-glove-flip.test.ts` and
 * `dead-ball-handover.test.ts`, not a test).
 *
 * The real `StageScene` poses the real striker at 60 Hz of scene time with the batters' hook and the external bat
 * (`externalBatPose`), exactly as `ThreePracticeStage` draws a replay's batter, without WebGL. Each frame keeps what the
 * motion reel's pop detector looked at: every bone's local rotation, the top glove's world rotation, how far each palm is from
 * the handle, the bat, and the two ranges MOTION-SPEC §9 puts on an arm (the upper arm's twist, the wrist's swing).
 */
import { Group, PerspectiveCamera, Quaternion, Scene, Vector3, type Mesh } from 'three';
import type {
  BowlerProfile,
  Footwork,
  Handedness,
  NormalizedSwing,
  PitchCondition,
  PracticeDeliveryPlan,
} from '@/contracts/practice';
import { autoField, batTravelMs, flight, resolveDelivery } from '@/physics';
import { idealTimeFor } from '@/physics/bat';
import { HANDLE_L } from '@/physics/constants';
import { overBalls } from '@/practice/game/evaluate';
import { randomOver } from '@/practice/game/overs';
import type { BallScript } from '@/render3d/core/choreo';
import { createPose } from '@/render3d/core/clips';
import { PRACTICE_PROFILES } from '@/render3d/core/quality';
import { clipBatPose, externalBatPose } from '@/render3d/practice/bat';
import { simToScene } from '@/render3d/practice/frame';
import { buildPracticeScript } from '@/render3d/practice/script';
import { gripPoint, type PlayerRig } from '@/render3d/three/players';
import { StageScene } from '@/render3d/three/stageScene';
import { ThreePracticeStage } from '@/render3d/three/ThreePracticeStage';
import { KITS } from '@/ui/avatar/traits';

export const FRAME_MS = 1000 / 60;
export const KITS_BOTH: [(typeof KITS)[number], (typeof KITS)[number]] = [KITS[0], KITS[1]];
export const FOREARM_HAND = ['forearmL', 'forearmR', 'handL', 'handR'] as const;

/** The motion packs (TRACKB's and MOTION's) loaded and committed for `fn`, and dropped again after it. */
export async function withPacks(fn: () => void | Promise<void>): Promise<void> {
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
export function stageHook(script: BallScript): never {
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

export function stubStage(): StageScene {
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

// ---------------------------------------------------------------------------------------------------------------
// Deliveries
// ---------------------------------------------------------------------------------------------------------------

export interface Intent {
  kind: 'attack' | 'defend';
  directionDeg: number;
  elevation: number;
  power: number;
  footwork: Footwork;
}

export interface Job {
  key: string;
  hand: Handedness;
  intent: string;
  script: BallScript;
  result: ReturnType<typeof resolveDelivery>;
  swing: NormalizedSwing | null;
  idealContactT: number;
}

const INTENTS: Array<[string, Intent | null, number]> = [
  ['drive', { kind: 'attack', directionDeg: 10, elevation: 0, power: 0.8, footwork: 'forward' }, 0],
  ['fwd-defence', { kind: 'defend', directionDeg: 0, elevation: 0, power: 0.3, footwork: 'forward' }, 0],
  ['pull', { kind: 'attack', directionDeg: -80, elevation: 0.2, power: 0.9, footwork: 'back' }, 0],
  ['back-defence', { kind: 'defend', directionDeg: 0, elevation: 0, power: 0.3, footwork: 'back' }, 0],
  ['punch', { kind: 'attack', directionDeg: 40, elevation: 0, power: 0.8, footwork: 'back' }, 20],
  ['cut', { kind: 'attack', directionDeg: 100, elevation: 0, power: 0.9, footwork: 'back' }, -20],
  ['drive-late', { kind: 'attack', directionDeg: 10, elevation: 0, power: 0.8, footwork: 'auto' }, 90],
  ['leave', null, 0],
];

function make(
  key: string,
  hand: Handedness,
  intent: string,
  fl: ReturnType<typeof flight>,
  bowler: BowlerProfile,
  conditions: PitchCondition,
  ball: Parameters<typeof autoField>[3],
  swing: NormalizedSwing | null,
): Job {
  const field = autoField(bowler, conditions, hand, ball);
  const result = resolveDelivery({
    flight: fl,
    swing,
    field,
    bowler,
    conditions,
    handedness: hand,
    assist: 'play',
    tierToleranceMs: 0,
  });
  return {
    key,
    hand,
    intent,
    script: buildPracticeScript({ setup: { field, bowler, conditions, handedness: hand }, flight: fl, result }),
    result,
    swing,
    idealContactT: fl.idealContactT,
  };
}

/**
 * The motion reel's four balls (clip 02c: a drive for four, a forward defence, a leave, a ball bowled by a swing 60 ms late),
 * from a fast right-arm bowler on a balanced pitch, for either hand. The reel's own plans, seeds and swings.
 */
export function reelJobs(hands: Handedness[] = ['right', 'left']): Job[] {
  const bowler: BowlerProfile = { family: 'pace', paceBand: 'fast', arm: 'right', lookSeed: 'harness-pace' };
  const balls: Array<[string, number, number, number, Intent | null, number]> = [
    [
      'D1-drive-for-four',
      3.5,
      0.1,
      124,
      { kind: 'attack', directionDeg: 12, elevation: 0.04, power: 0.9, footwork: 'forward' },
      0,
    ],
    [
      'D2-forward-defence',
      4.5,
      0.25,
      132,
      { kind: 'defend', directionDeg: 0, elevation: 0, power: 0.3, footwork: 'forward' },
      0,
    ],
    ['D3-leave', 5, 0.4, 132, null, 0],
    [
      'D4-bowled-late',
      4,
      0.1,
      132,
      { kind: 'attack', directionDeg: 10, elevation: 0, power: 0.8, footwork: 'forward' },
      60,
    ],
  ];
  const jobs: Job[] = [];
  for (const hand of hands) {
    for (const [id, lengthM, lineM, speedKph, intent, errMs] of balls) {
      const plan: PracticeDeliveryPlan = { variation: 'stock', lengthM, lineM, speedKph };
      const fl = flight({
        plan,
        bowler,
        conditions: 'balanced',
        seed: `harness:${JSON.stringify(plan)}`,
        handedness: hand,
      });
      const swing: NormalizedSwing | null = intent
        ? { ...intent, startT: fl.idealContactT - batTravelMs(intent.kind, intent.power) / 1000 + errMs / 1000 }
        : null;
      jobs.push(make(`${id}/${hand}`, hand, id, fl, bowler, 'balanced', undefined, swing));
    }
  }
  return jobs;
}

/**
 * WEB-HUMANS' corpus (overs `web-humans-ov|i`: pace on even overs, spin on odd; balanced, green, hard, turning pitches), three
 * balls of each of `overs` overs, both hands, the eight intents: drives, defences, a pull, a punch, a cut, a late swing and a leave.
 */
export function overJobs(overs: number): Job[] {
  const jobs: Job[] = [];
  const pitches: PitchCondition[] = ['balanced', 'green', 'hard', 'turning'];
  for (let i = 0; i < overs; i++) {
    const conditions = pitches[i % 4];
    const family = i % 2 === 0 ? 'pace' : 'spin';
    const over = randomOver({ seed: `web-humans-ov|${i}`, conditions, assist: 'play', family });
    for (const b of overBalls(over, conditions, i).slice(0, 3)) {
      for (const hand of ['right', 'left'] as const) {
        const fl = flight({
          plan: over.balls[b.ballIndex],
          bowler: over.bowler,
          conditions,
          seed: b.seed,
          ball: over.ball,
          handedness: hand,
        });
        for (const [name, intent, err] of INTENTS) {
          const swing: NormalizedSwing | null = intent
            ? {
                ...intent,
                startT: idealTimeFor(fl, intent.footwork) - batTravelMs(intent.kind, intent.power) / 1000 + err / 1000,
              }
            : null;
          jobs.push(
            make(
              `${family}/${conditions}/${b.ballIndex}/${hand}/${name}`,
              hand,
              name,
              fl,
              over.bowler,
              conditions,
              over.ball,
              swing,
            ),
          );
        }
      }
    }
  }
  return jobs;
}

/**
 * Balls that end the innings or the shot early (bowled, lbw, pad, body): pace and spin, right- and left-arm bowlers, full,
 * yorker and short balls, both hands, a swing that misses early or late, a defence, and a leave.
 */
export function deadBallJobs(): Job[] {
  const bowlers: Array<[string, BowlerProfile]> = [
    ['pace-R', { family: 'pace', paceBand: 'fast', arm: 'right', lookSeed: 'fixa-pace-r' }],
    ['pace-L', { family: 'pace', paceBand: 'express', arm: 'left', lookSeed: 'fixa-pace-l' }],
    ['spin-R', { family: 'spin', spinType: 'finger', arm: 'right', lookSeed: 'fixa-spin-r' }],
    ['spin-L', { family: 'spin', spinType: 'wrist', arm: 'left', lookSeed: 'fixa-spin-l' }],
  ];
  const plans: Array<[string, number, number]> = [
    ['full-straight', 2.6, 0.0],
    ['yorker', 1.4, 0.05],
    ['short-leg', 7.5, -0.35],
    ['half-volley', 3.5, 0.1],
  ];
  const kinds: Array<[string, Intent | null, number]> = [
    ['late-miss', { kind: 'attack', directionDeg: 10, elevation: 0, power: 0.8, footwork: 'forward' }, 70],
    ['early-miss', { kind: 'attack', directionDeg: 10, elevation: 0, power: 0.8, footwork: 'forward' }, -90],
    ['defence', { kind: 'defend', directionDeg: 0, elevation: 0, power: 0.3, footwork: 'forward' }, 0],
    ['leave', null, 0],
  ];
  const jobs: Job[] = [];
  for (const [bn, bowler] of bowlers) {
    for (const [pn, lengthM, lineM] of plans) {
      for (const hand of ['right', 'left'] as const) {
        const plan: PracticeDeliveryPlan = {
          variation: 'stock',
          lengthM,
          lineM,
          speedKph: bowler.family === 'spin' ? 86 : bowler.paceBand === 'express' ? 144 : 130,
        };
        const fl = flight({ plan, bowler, conditions: 'balanced', seed: `fixa:${bn}:${pn}:${hand}`, handedness: hand });
        for (const [kn, intent, err] of kinds) {
          const swing: NormalizedSwing | null = intent
            ? {
                ...intent,
                startT: idealTimeFor(fl, intent.footwork) - batTravelMs(intent.kind, intent.power) / 1000 + err / 1000,
              }
            : null;
          jobs.push(make(`${bn}/${pn}/${hand}/${kn}`, hand, kn, fl, bowler, 'balanced', undefined, swing));
        }
      }
    }
  }
  return jobs;
}

// ---------------------------------------------------------------------------------------------------------------
// Walking the striker
// ---------------------------------------------------------------------------------------------------------------

export interface Frame {
  /** Scene ms from the release. */
  rel: number;
  /** Every bone's local rotation (17 × xyzw), as the rig has it after the whole pose. */
  q: Float32Array;
  /** The top hand's world rotation (the left hand of a right-hander, the right hand of a left-hander). */
  topWorld: Quaternion;
  /** Palm to handle (m), left and right. */
  palm: [number, number];
  /** The bat as drawn: the cap and the toe (world). */
  cap: Vector3;
  toe: Vector3;
  /** The bat's face (world, unit; the mesh's, square to the blade). */
  face: Vector3;
  /** The upper arms' twist and the wrists' swing (deg), left and right. */
  twist: [number, number];
  wrist: [number, number];
  /** The face of the bat the body's own clips hold (world, unit): its authored face (MOTION-SPEC v1.2) or the one towards the bowler. */
  keyFace: Vector3 | null;
  /** The external bat was given (a stance, a swing, a hold, a hand-over), not the clip's own key. */
  external: boolean;
}

export interface Walk {
  job: Job;
  release: number;
  input: number;
  lastBat: number | null;
  dead: number;
  frames: Frame[];
  /** The bone names in `q` order. */
  bones: readonly string[];
}

const BONES = [
  'hips',
  'spine',
  'chest',
  'neck',
  'head',
  'upperArmL',
  'forearmL',
  'handL',
  'upperArmR',
  'forearmR',
  'handR',
  'thighL',
  'shinL',
  'footL',
  'thighR',
  'shinR',
  'footR',
] as const;
const swingDeg = (q: Quaternion) => (2 * Math.atan2(Math.hypot(q.x, q.z), Math.hypot(q.w, q.y)) * 180) / Math.PI;
const twistDeg = (q: Quaternion) => {
  const t = Math.abs((2 * Math.atan2(q.y, q.w) * 180) / Math.PI + 360) % 360;
  return t > 180 ? 360 - t : t;
};

const clipFace = (striker: Parameters<typeof clipBatPose>[0], t: number, scale: number): Vector3 | null => {
  const b = clipBatPose(striker, t, scale);
  return b ? new Vector3(b.face.x, b.face.y, b.face.z) : null;
};

/** Poses the striker of `job` every 60 Hz frame from `fromMs` before the release to `toMs` after it. */
export function walkStriker(job: Job, fromMs: number, toMs: number): Walk {
  const { script } = job;
  const p = script.practice!;
  const striker = script.actors.find((a) => a.id === 'striker')!;
  const hook = stageHook(script);
  const stage = stubStage();
  const frames: Frame[] = [];
  const tmp = new Quaternion();
  const topSide = p.mirror ? 'handR' : 'handL';
  const t0 = Math.max(0, p.releaseScene - fromMs);
  const t1 = Math.min(script.duration, p.releaseScene + toMs);
  for (let t = t0; t <= t1; t += FRAME_MS) {
    const bp = externalBatPose(p.bat, striker, t, stage.rigOf('striker')?.scale ?? 1);
    stage.poseActor(striker, t, KITS_BOTH, bp, hook);
    const rig = stage.rigOf('striker') as PlayerRig;
    rig.root.updateMatrixWorld(true);
    const q = new Float32Array(BONES.length * 4);
    rig.bones.forEach((b, i) => q.set([b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w], i * 4));
    const mesh = (stage as unknown as { bats: Map<string, Mesh> }).bats.get('striker')!;
    mesh.updateWorldMatrix(true, false);
    const cap = new Vector3().setFromMatrixPosition(mesh.matrixWorld);
    const dir = new Vector3(0, -1, 0).transformDirection(mesh.matrixWorld);
    const face = new Vector3(0, 0, 1).transformDirection(mesh.matrixWorld);
    face.addScaledVector(dir, -face.dot(dir)).normalize();
    const along = (nm: 'handL' | 'handR') => {
      const palm = gripPoint(rig, nm === 'handL' ? 'L' : 'R');
      const rel = palm.clone().sub(cap);
      const s = Math.max(0, Math.min(HANDLE_L, rel.dot(dir)));
      return rel.sub(dir.clone().multiplyScalar(s)).length();
    };
    frames.push({
      rel: t - p.releaseScene,
      q,
      topWorld: rig.boneMap[topSide].getWorldQuaternion(tmp).clone(),
      palm: [along('handL'), along('handR')],
      cap,
      toe: cap.clone().addScaledVector(dir, 0.86),
      face,
      twist: [twistDeg(rig.boneMap.upperArmL.quaternion), twistDeg(rig.boneMap.upperArmR.quaternion)],
      wrist: [swingDeg(rig.boneMap.handL.quaternion), swingDeg(rig.boneMap.handR.quaternion)],
      keyFace: clipFace(striker, t, stage.rigOf('striker')?.scale ?? 1),
      external: bp !== null,
    });
  }
  const lastSample =
    p.bat.samples && p.bat.samples.length
      ? p.bat.releaseScene + p.bat.samples[p.bat.samples.length - 1].t * 1000
      : null;
  return {
    job,
    release: p.releaseScene,
    input: job.swing ? simToScene(p, job.swing.startT) : simToScene(p, job.idealContactT) - 130,
    lastBat: lastSample === null ? null : lastSample - p.releaseScene,
    dead: simToScene(p, job.result.deadT) - p.releaseScene,
    frames,
    bones: BONES,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Measures
// ---------------------------------------------------------------------------------------------------------------

/** The angle (deg) one bone of two frames turns by. */
export function boneTurn(a: Frame, b: Frame, bone: number): number {
  const o = bone * 4;
  const d = Math.abs(a.q[o] * b.q[o] + a.q[o + 1] * b.q[o + 1] + a.q[o + 2] * b.q[o + 2] + a.q[o + 3] * b.q[o + 3]);
  return (2 * Math.acos(Math.min(1, d)) * 180) / Math.PI;
}

/** Every one-frame turn of a forearm or hand over `deg`: [rel ms, bone, turn]. */
export function armPops(w: Walk, deg: number, fromRel = -Infinity): Array<[number, string, number]> {
  const out: Array<[number, string, number]> = [];
  for (let k = 1; k < w.frames.length; k++) {
    if (w.frames[k].rel < fromRel) continue;
    for (const nm of FOREARM_HAND) {
      const i = w.bones.indexOf(nm);
      const t = boneTurn(w.frames[k - 1], w.frames[k], i);
      if (t > deg) out.push([w.frames[k].rel, nm, t]);
    }
  }
  return out;
}

export const turnBetween = (a: Quaternion, b: Quaternion) =>
  (2 * Math.acos(Math.min(1, Math.abs(a.dot(b)))) * 180) / Math.PI;
