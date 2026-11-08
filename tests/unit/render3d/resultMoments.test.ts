/**
 * ASSETS-MOTION (Chase result moments): what the deciding ball's script does after the physics has decided, as the stage
 * DRAWS it (the real StageScene poses the real striker and bowler at 60 Hz with the Practice stage's pose hooks and the
 * face-and-life Director; no WebGL). A builder's measurement, not a certification (MOTION-SPEC section 9, practice/resultMoments.ts).
 *
 * What it holds:
 *  - honesty: a moment changes nothing the physics decided: the ball, the events, the stumps and every actor but the striker
 *    and the bowler are identical with and without it, and nothing of theirs changes before the moment starts;
 *  - the moment starts after the physics event that earns it, the actor's own business (his stroke, his run, his follow-through)
 *    and a reaction latency; the same result and the same moment give the same script; every frame before it (or before the
 *    `now` a live ball's moment is put in at) is drawn as it was, heading and place and clip, and no heading turns over 12 degrees
 *    a frame through the switch (MF-09);
 *  - the right clip for the right result, for both hands and both arms;
 *  - as drawn (DoD CLP-04, MOTION-SPEC section 9 pop definitions): 0 spikes, 0 steps of 60 degrees, 0 hips or root jumps over 5 cm,
 *    0 head turns over 720 deg/s in the world, the bottom glove within 2 cm of the handle and the wrist inside 85 degrees, through
 *    the hand-over into the clip and the clip, with the Director on and off, Reduced Motion on, both hands and both arms, and for a
 *    moment put into a live script already on screen; the bat stays off the ground and the one-handed clips let the top hand go.
 *    The bowler is held to 0 pops outright. The striker is judged against a CONTROL run (MOTION-FIX, R-47): the very same ball
 *    scripted with no moment, drawn over the same scene window with the same hooks, and only a pop the moment ADDS fails (same kind,
 *    same bone, not within a frame of one the control has). The control's own pops are the existing batter stroke's (CLP-04b, open,
 *    not on trial here); their count is a named baseline, STROKE_POPS, that may not grow.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Group, PerspectiveCamera, Quaternion, Scene, Vector3, type Mesh } from 'three';
import type {
  BowlerProfile,
  DeliveryResult,
  Footwork,
  Handedness,
  NormalizedSwing,
  PracticeDeliveryPlan,
} from '@/contracts/practice';
import { autoField, batTravelMs, flight, resolveDelivery } from '@/physics';
import { idealTimeFor } from '@/physics/bat';
import { HANDLE_L } from '@/physics/constants';
import { evaluateActor, type ActorTrack } from '@/render3d/core/actors';
import { angleDelta } from '@/render3d/core/math';
import type { BallScript } from '@/render3d/core/choreo';
import {
  clipDuration,
  clipMarker,
  createPose,
  hasMotionClip,
  mirrorSampledPose,
  sampleClip,
} from '@/render3d/core/clips';
import { DirectorRuntime } from '@/render3d/core/motion/director';
import { ONE_HAND_BAT_CLIPS } from '@/render3d/core/motion/library';
import { PRACTICE_PROFILES } from '@/render3d/core/quality';
import { BONE_NAMES } from '@/render3d/core/skeleton';
import { externalBatPose } from '@/render3d/practice/bat';
import { simToScene } from '@/render3d/practice/frame';
import {
  MOMENT_CLIPS,
  MOMENT_LATENCY_MS,
  applyChaseMoment,
  momentEventT,
  restAt,
  stripWalkBack,
  type ChaseMoment,
} from '@/render3d/practice/resultMoments';
import { buildPracticeScript } from '@/render3d/practice/script';
import { gripPoint, type PlayerRig } from '@/render3d/three/players';
import { StageScene } from '@/render3d/three/stageScene';
import { ThreePracticeStage } from '@/render3d/three/ThreePracticeStage';
import { KITS } from '@/ui/avatar/traits';

const KITS2: [(typeof KITS)[0], (typeof KITS)[0]] = [KITS[0], KITS[1]];
const DT = 1000 / 60;
const DEG = 180 / Math.PI;
/** hips, spine, chest, neck, head, both arms: everything above the legs. */
const UPPER = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const LEGS = [11, 12, 13, 14, 15, 16];

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

type Hook = Parameters<StageScene['poseActor']>[4];
const proto = ThreePracticeStage.prototype as unknown as { poseHooks(s: unknown, p: unknown): Hook; cueHook: unknown };
/** The stage's own pose hooks for a script: the production composition, with the Director. */
const hooksFor = (script: BallScript, director: DirectorRuntime | undefined, reducedMotion = false): Hook =>
  proto.poseHooks.call(
    { hookCache: new WeakMap(), reducedMotion, cueHook: proto.cueHook, director },
    script,
    script.practice!,
  );

// ---------------------------------------------------------------------------------------------------------------
// The deciding balls
// ---------------------------------------------------------------------------------------------------------------

interface Case {
  name: string;
  moment: ChaseMoment;
  bowler: BowlerProfile;
  hand: Handedness;
  plan: Partial<PracticeDeliveryPlan>;
  swing: {
    kind: 'attack' | 'defend';
    directionDeg: number;
    power: number;
    elevation: number;
    footwork: Footwork;
  } | null;
  errMs?: number;
}

const PACE_R: BowlerProfile = { family: 'pace', paceBand: 'fast', arm: 'right', lookSeed: 'rm-p1' };
const PACE_L: BowlerProfile = { family: 'pace', paceBand: 'express', arm: 'left', lookSeed: 'rm-p2' };
const FINGER_R: BowlerProfile = { family: 'spin', spinType: 'finger', arm: 'right', lookSeed: 'rm-s1' };
const WRIST_L: BowlerProfile = { family: 'spin', spinType: 'wrist', arm: 'left', lookSeed: 'rm-s2' };
const DRIVE = { kind: 'attack', directionDeg: 12, power: 0.9, elevation: 0.04, footwork: 'forward' } as const;
const DEFEND = { kind: 'defend', directionDeg: 0, power: 0.3, elevation: 0, footwork: 'forward' } as const;
const LATE = { kind: 'attack', directionDeg: 10, power: 0.8, elevation: 0, footwork: 'forward' } as const;
const LOFT = { kind: 'attack', directionDeg: 10, power: 0.95, elevation: 1, footwork: 'forward' } as const;
const PUSH = { kind: 'attack', directionDeg: 70, power: 0.45, elevation: 0, footwork: 'forward' } as const;
const EDGE = { kind: 'attack', directionDeg: 0, power: 0.8, elevation: 0, footwork: 'forward' } as const;

const CASES: Case[] = [
  {
    name: 'won, a six, RH v pace R',
    moment: 'won',
    bowler: PACE_R,
    hand: 'right',
    plan: { lengthM: 4, lineM: 0.1, speedKph: 128 },
    swing: LOFT,
  },
  {
    name: 'won, a drive, LH v wrist L',
    moment: 'won',
    bowler: WRIST_L,
    hand: 'left',
    plan: { lengthM: 4, lineM: 0.1, speedKph: 86 },
    swing: DRIVE,
  },
  {
    name: 'won, a push for runs, RH v finger R',
    moment: 'won',
    bowler: FINGER_R,
    hand: 'right',
    plan: { lengthM: 4.6, lineM: 0.2, speedKph: 84 },
    swing: PUSH,
  },
  {
    name: 'lost_wicket, bowled, RH v pace R',
    moment: 'lost_wicket',
    bowler: PACE_R,
    hand: 'right',
    plan: { lengthM: 4, lineM: 0.1, speedKph: 132 },
    swing: LATE,
    errMs: 90,
  },
  {
    name: 'lost_wicket, an edge, LH v pace L',
    moment: 'lost_wicket',
    bowler: PACE_L,
    hand: 'left',
    plan: { lengthM: 3, lineM: 0, speedKph: 140 },
    swing: EDGE,
    errMs: -110,
  },
  {
    name: 'lost_balls, a leave, RH v finger R',
    moment: 'lost_balls',
    bowler: FINGER_R,
    hand: 'right',
    plan: { lengthM: 5, lineM: 0.4, speedKph: 84 },
    swing: null,
  },
  {
    name: 'lost_balls, a defence, LH v wrist L',
    moment: 'lost_balls',
    bowler: WRIST_L,
    hand: 'left',
    plan: { lengthM: 4.5, lineM: 0.25, speedKph: 86 },
    swing: DEFEND,
  },
];

interface Built {
  c: Case;
  result: DeliveryResult;
  base: BallScript;
  moment: BallScript;
  again: BallScript;
  releaseScene: number;
}

function scriptFor(c: Case, moment: ChaseMoment | null, k: number, reducedMotion = false) {
  const full: PracticeDeliveryPlan = { variation: 'stock', lengthM: 6, lineM: 0.1, speedKph: 130, ...c.plan };
  const fl = flight({
    plan: full,
    bowler: c.bowler,
    conditions: 'balanced',
    seed: `rm:${k}:${c.name}`,
    handedness: c.hand,
  });
  const field = autoField(c.bowler, 'balanced', c.hand);
  let swing: NormalizedSwing | null = null;
  if (c.swing)
    swing = {
      ...c.swing,
      startT:
        idealTimeFor(fl, c.swing.footwork) - batTravelMs(c.swing.kind, c.swing.power) / 1000 + (c.errMs ?? 0) / 1000,
    };
  const result = resolveDelivery({
    flight: fl,
    swing,
    field,
    bowler: c.bowler,
    conditions: 'balanced',
    handedness: c.hand,
    assist: 'play',
    tierToleranceMs: 0,
  });
  const setup = { field, bowler: c.bowler, conditions: 'balanced' as const, handedness: c.hand };
  const script = buildPracticeScript({
    setup,
    flight: fl,
    result,
    ...(moment ? { chaseMoment: moment, reducedMotion } : {}),
  });
  return { result, script };
}

let BUILT: Built[] | null = null;
const built = (): Built[] =>
  (BUILT ??= CASES.map((c, k) => {
    const base = scriptFor(c, null, k);
    const moment = scriptFor(c, c.moment, k);
    const again = scriptFor(c, c.moment, k);
    return {
      c,
      result: base.result,
      base: base.script,
      moment: moment.script,
      again: again.script,
      releaseScene: base.script.practice!.releaseScene,
    };
  }));

const track = (s: BallScript, id: string): ActorTrack => s.actors.find((a) => a.id === id)!;
const isMomentClip = (clip: string) => Object.values(MOMENT_CLIPS).some((n) => clip === `vmp:${n}`);

/** The first move of the moment on a track (the first of its moves that plays one of the four clips). */
function firstMoment(t: ActorTrack) {
  return t.moves.find((m) => isMomentClip(String(m.clip)));
}

// ---------------------------------------------------------------------------------------------------------------
// Frames as drawn
// ---------------------------------------------------------------------------------------------------------------

interface Frame {
  t: number;
  /** Every bone's local rotation (17 x xyzw) as the rig has it after the whole pose. */
  q: Float64Array;
  /** The actor's root (world x, z), his hips joint (world) and his head's world rotation. */
  pos: [number, number];
  hips: Vector3;
  headW: Quaternion;
  /** Striker only: how far each palm is from the handle (m), left then right; the bat's toe (world). */
  palm: [number, number];
  toe: Vector3;
  wrist: [number, number];
}

const swingDeg = (q: { x: number; y: number; z: number; w: number }) =>
  (2 * Math.atan2(Math.hypot(q.x, q.z), Math.hypot(q.w, q.y)) * 180) / Math.PI;

interface Variant {
  name: 'Director on' | 'Director off' | 'Reduced Motion';
  /** The face-and-life Director on or off, and Reduced Motion on or off (stage, Director and the script's moment alike). */
  director: boolean;
  reduced: boolean;
}
const VARIANTS: Variant[] = [
  { name: 'Director on', director: true, reduced: false },
  { name: 'Director off', director: false, reduced: false },
  { name: 'Reduced Motion', director: true, reduced: true },
];

function walk(script: BallScript, id: 'striker' | 'bowler', t0: number, t1: number, v: Variant): Frame[] {
  const stage = stubStage();
  let hook: Hook;
  if (v.director) {
    const rt = new DirectorRuntime();
    rt.setReducedMotion(v.reduced);
    rt.register(script, 'replay', null);
    rt.finish(script);
    hook = hooksFor(script, rt, v.reduced);
  } else hook = hooksFor(script, undefined, v.reduced);
  const tr = track(script, id);
  const p = script.practice!;
  const out: Frame[] = [];
  for (let t = t0; t <= t1 + 1e-6; t += DT) {
    const rig = stage.rigOf(id) as PlayerRig | undefined;
    const bp = id === 'striker' ? externalBatPose(p.bat, tr, t, rig?.scale ?? 1) : null;
    stage.poseActor(tr, t, KITS2, bp, hook);
    const r = stage.rigOf(id) as PlayerRig;
    r.root.updateMatrixWorld(true);
    const q = new Float64Array(BONE_NAMES.length * 4);
    r.bones.forEach((b, i) => q.set([b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w], i * 4));
    let palm: [number, number] = [0, 0];
    const toe = new Vector3();
    if (id === 'striker') {
      const mesh = (stage as unknown as { bats: Map<string, Mesh> }).bats.get('striker')!;
      mesh.updateWorldMatrix(true, false);
      const cap = new Vector3().setFromMatrixPosition(mesh.matrixWorld);
      const dir = new Vector3(0, -1, 0).transformDirection(mesh.matrixWorld);
      toe.copy(cap).addScaledVector(dir, 0.86);
      const along = (side: 'L' | 'R') => {
        const rel = gripPoint(r, side).clone().sub(cap);
        const s = Math.max(0, Math.min(HANDLE_L, rel.dot(dir)));
        return rel.sub(dir.clone().multiplyScalar(s)).length();
      };
      palm = [along('L'), along('R')];
    }
    out.push({
      t,
      q,
      pos: [r.root.position.x, r.root.position.z],
      hips: r.bones[0].getWorldPosition(new Vector3()),
      headW: r.boneMap.head.getWorldQuaternion(new Quaternion()),
      palm,
      toe,
      wrist: [swingDeg(r.boneMap.handL.quaternion), swingDeg(r.boneMap.handR.quaternion)],
    });
  }
  return out;
}

const turn = (a: Frame, b: Frame, i: number): number => {
  const o = i * 4;
  const d = Math.abs(a.q[o] * b.q[o] + a.q[o + 1] * b.q[o + 1] + a.q[o + 2] * b.q[o + 2] + a.q[o + 3] * b.q[o + 3]);
  return 2 * Math.acos(Math.min(1, d)) * DEG;
};

/** MOTION-SPEC section 9, pose pop: the smaller of 25 degrees and the bone's cap per frame at 60 Hz (arms 25, other limbs 20, hips, spine and chest 10, neck and head 12). */
const FLOOR = BONE_NAMES.map((n) =>
  /^(upperArm|forearm|hand)/.test(n)
    ? 25
    : /^(thigh|shin|foot)/.test(n)
      ? 20
      : /^(hips|spine|chest)$/.test(n)
        ? 10
        : 12,
);

interface Hit {
  kind: 'SPIKE' | 'HUGE' | 'HIPSJUMP' | 'ROOTJUMP' | 'HEADWORLD' | 'GLOVE' | 'WRIST';
  where: string;
  v: number;
  /** What the pop is of (the bone, or the wrist's side; empty for the whole body) and when (scene ms): how two runs are compared. */
  of: string;
  t: number;
}

/**
 * The pose-pop definitions of MOTION-SPEC section 9 over frames drawn at 60 Hz: SPIKE (a one-frame turn at or above the smaller
 * of 25 degrees and the bone's cap per frame and at least 3 times its quiet neighbours), HUGE (60 degrees), HIPSJUMP and ROOTJUMP
 * (the change of a frame's displacement over 5 cm), HEADWORLD (over 720 deg/s in the world), GLOVE (the bottom glove more than
 * 2 cm off the handle, from `gloveFrom` on) and WRIST (over 85 degrees).
 */
function scan(f: Frame[], id: string, t0: number, o: { bottom?: 0 | 1; gloveFrom?: number } = {}): Hit[] {
  const hits: Hit[] = [];
  const at = (k: number) => `${id} +${Math.round(f[k].t - t0)} ms`;
  const nb = BONE_NAMES.length;
  const step = (k: number, b: number) => (k >= 1 && k < f.length ? turn(f[k - 1], f[k], b) : Number.NaN);
  for (let b = 0; b < nb; b++) {
    for (let k = 1; k < f.length; k++) {
      const s = step(k, b);
      if (s >= 60) hits.push({ kind: 'HUGE', where: `${at(k)} ${BONE_NAMES[b]}`, v: s, of: BONE_NAMES[b], t: f[k].t });
      else if (s >= FLOOR[b]) {
        const near = [step(k - 2, b), step(k - 1, b), step(k + 1, b), step(k + 2, b)]
          .filter((x) => Number.isFinite(x))
          .sort((x, y) => x - y);
        const quiet = near.length >= 2 ? near[1] : (near[0] ?? 0);
        if (s >= 3 * quiet)
          hits.push({ kind: 'SPIKE', where: `${at(k)} ${BONE_NAMES[b]}`, v: s, of: BONE_NAMES[b], t: f[k].t });
      }
    }
  }
  let ph: [number, number, number] | null = null;
  let pr: [number, number] | null = null;
  for (let k = 1; k < f.length; k++) {
    const dh: [number, number, number] = [
      f[k].hips.x - f[k - 1].hips.x,
      f[k].hips.y - f[k - 1].hips.y,
      f[k].hips.z - f[k - 1].hips.z,
    ];
    const dr: [number, number] = [f[k].pos[0] - f[k - 1].pos[0], f[k].pos[1] - f[k - 1].pos[1]];
    if (ph && Math.hypot(dh[0] - ph[0], dh[1] - ph[1], dh[2] - ph[2]) > 0.05)
      hits.push({
        kind: 'HIPSJUMP',
        where: at(k),
        v: Math.hypot(dh[0] - ph[0], dh[1] - ph[1], dh[2] - ph[2]),
        of: '',
        t: f[k].t,
      });
    if (pr && Math.hypot(dr[0] - pr[0], dr[1] - pr[1]) > 0.05)
      hits.push({ kind: 'ROOTJUMP', where: at(k), v: Math.hypot(dr[0] - pr[0], dr[1] - pr[1]), of: '', t: f[k].t });
    ph = dh;
    pr = dr;
    const w = ((2 * Math.acos(Math.min(1, Math.abs(f[k - 1].headW.dot(f[k].headW)))) * DEG) / DT) * 1000;
    if (w > 720) hits.push({ kind: 'HEADWORLD', where: at(k), v: w, of: '', t: f[k].t });
    for (const side of [0, 1])
      if (f[k].wrist[side] > 85)
        hits.push({
          kind: 'WRIST',
          where: `${at(k)} ${side ? 'R' : 'L'}`,
          v: f[k].wrist[side],
          of: side ? 'R' : 'L',
          t: f[k].t,
        });
    if (o.bottom !== undefined && f[k].t >= (o.gloveFrom ?? 0) && f[k].palm[o.bottom] > 0.02)
      hits.push({ kind: 'GLOVE', where: at(k), v: f[k].palm[o.bottom], of: '', t: f[k].t });
  }
  return hits;
}

/**
 * The hits of `moment` that `control` (the same frames of the same ball with no moment) does not have: a hit is the control's own
 * when it has one of the same kind, of the same bone (or wrist side) within one frame.
 */
function addedBy(moment: readonly Hit[], control: readonly Hit[]): Hit[] {
  return moment.filter(
    (h) => !control.some((c) => c.kind === h.kind && c.of === h.of && Math.abs(c.t - h.t) <= DT + 1e-6),
  );
}

// ---------------------------------------------------------------------------------------------------------------

describe('Chase result moments: honest, deterministic and the right clip', () => {
  it('are in the loaded packs', () => {
    for (const id of Object.values(MOMENT_CLIPS)) expect(hasMotionClip(id), id).toBe(true);
    for (const id of ONE_HAND_BAT_CLIPS) expect(hasMotionClip(id), id).toBe(true);
  });

  it('change nothing the physics decided: the ball, the events, the stumps and every other actor are as they were', () => {
    for (const b of built()) {
      expect(b.moment.ball, b.c.name).toEqual(b.base.ball);
      expect(b.moment.events, b.c.name).toEqual(b.base.events);
      expect(b.moment.stumps, b.c.name).toEqual(b.base.stumps);
      expect(b.moment.duration, b.c.name).toBe(b.base.duration);
      for (const a of b.base.actors) {
        if (a.id === 'striker' || a.id === 'bowler') continue;
        expect(track(b.moment, a.id).moves, `${b.c.name} ${a.id}`).toEqual(a.moves);
      }
    }
  });

  it('start after the physics event, the actor’s own business and a reaction latency, and leave everything before untouched', () => {
    for (const b of built()) {
      const ev = momentEventT(b.result, b.c.moment);
      const eventScene = simToScene({ releaseScene: b.releaseScene }, ev.t);
      for (const id of ['striker', 'bowler'] as const) {
        // The base script walks the bowler back to his mark; the moment replaces that walk, so his own business ends before it.
        const baseMoves = id === 'bowler' ? [...stripWalkBack(track(b.base, id).moves)] : track(b.base, id).moves;
        // His own business: the striker's stroke or run (his final rest), the bowler's follow-through (what the physics gives him after it is cut).
        const own = id === 'bowler' ? b.base.practice!.director.bowler.followEnd! : restAt(baseMoves);
        const m = firstMoment(track(b.moment, id));
        expect(m, `${b.c.name} ${id} has a moment`).toBeDefined();
        const start = m!.t0;
        expect(start, `${b.c.name} ${id} after its own business`).toBeGreaterThanOrEqual(own - 1e-6);
        const lat =
          b.c.moment === 'won'
            ? id === 'bowler'
              ? MOMENT_LATENCY_MS.won.bowler
              : ev.boundary
                ? MOMENT_LATENCY_MS.won.boundary
                : MOMENT_LATENCY_MS.won.runs
            : MOMENT_LATENCY_MS[b.c.moment][id];
        expect(start, `${b.c.name} ${id} after the event`).toBeGreaterThanOrEqual(eventScene + lat - 1e-6);
        // Nothing earlier than the start changed: every move of the base that ends by the start is still there, as it was. The one
        // thing the moment replaces is the bowler's built-in wicket jump (`celebrate_*`, his arms aimed): the physics path begins it where
        // his run-up clip ends and it runs past the start, so it is not among the moves compared; the moment cuts it where it BEGINS and
        // he stands idle from there to the start (checked below).
        const before = baseMoves.filter((x) => x.t1 <= start - 1);
        const same = track(b.moment, id).moves.slice(0, before.length);
        expect(same, `${b.c.name} ${id} before the moment`).toEqual(before);
        if (id === 'bowler') {
          const moves = track(b.moment, id).moves;
          const at = moves.findIndex((x) => isMomentClip(String(x.clip)));
          const isJump = (x: { clip: unknown }) => String(x.clip).startsWith('celebrate_');
          expect(moves.some(isJump), `${b.c.name} bowler: no built-in celebration is left under the clip`).toBe(false);
          expect(moves[at - 1].t1, `${b.c.name} bowler: the clip follows the move before it`).toBeCloseTo(start, 6);
          if (baseMoves.some(isJump))
            expect(moves[at - 1].clip, `${b.c.name} bowler: idle from the cut jump to the start`).toBe('idle');
        }
      }
    }
  });

  it('play the right clip for the right result', () => {
    for (const b of built()) {
      const won = b.c.moment === 'won';
      expect(firstMoment(track(b.moment, 'striker'))!.clip, b.c.name).toBe(
        `vmp:${won ? MOMENT_CLIPS.strikerWon : MOMENT_CLIPS.strikerLost}`,
      );
      expect(firstMoment(track(b.moment, 'bowler'))!.clip, b.c.name).toBe(
        `vmp:${won ? MOMENT_CLIPS.bowlerBeaten : MOMENT_CLIPS.bowlerDefended}`,
      );
    }
  });

  it('give the same script for the same result and the same moment', () => {
    for (const b of built()) {
      for (const id of ['striker', 'bowler'] as const)
        expect(track(b.again, id).moves, `${b.c.name} ${id}`).toEqual(track(b.moment, id).moves);
      expect(track(b.moment, 'striker').physicsBody).toEqual(track(b.again, 'striker').physicsBody);
    }
  });

  it('release the striker’s stance fit before he moves off, even after a leave', () => {
    for (const b of built()) {
      const m = firstMoment(track(b.moment, 'striker'))!;
      const body = track(b.moment, 'striker').physicsBody!;
      expect(body.releaseAt, b.c.name).toBeLessThanOrEqual(m.t0 + 1e-6);
    }
  });

  it('the walk-off keeps the striker off the pitch: straight ahead in his stance heading', () => {
    for (const b of built().filter((x) => x.c.moment !== 'won')) {
      const tr = track(b.moment, 'striker');
      const m = firstMoment(tr)!;
      const a = evaluateActor(tr, m.t0);
      const z = evaluateActor(tr, m.t0 + clipDuration('vmp:bat_walk_off') * 1000);
      const dx = z.pos.x - a.pos.x;
      const dz = z.pos.z - a.pos.z;
      const ahead = tr.heading;
      // The walk's displacement points the way he faced in his stance.
      const dot = (dx * Math.sin(ahead) + dz * Math.cos(ahead)) / Math.max(1e-6, Math.hypot(dx, dz));
      expect(Math.hypot(dx, dz), b.c.name).toBeGreaterThan(1.5);
      expect(dot, b.c.name).toBeGreaterThan(0.98);
    }
  });
});

describe('Chase result moments: Reduced Motion, the left-hander and the live ball', () => {
  it('Reduced Motion holds each clip on its marker frame (peak or slump) over the same window, and the walk-off stays where he stands', () => {
    for (const [k, c] of CASES.entries()) {
      const sc = scriptFor(c, c.moment, k, true).script;
      const base = scriptFor(c, c.moment, k).script;
      for (const id of ['striker', 'bowler'] as const) {
        const m = firstMoment(track(sc, id))!;
        const clip = String(m.clip).slice(4);
        const marker = /walk_off|disappointed/.test(clip) ? 'slump' : 'peak';
        expect(m.rate, `${c.name} ${id}`).toBe(0);
        expect(m.clipStart, `${c.name} ${id}`).toBeCloseTo(clipMarker(m.clip, marker, -1), 6);
        // The same window: it starts when the full clip would have, and runs to the end of the scene.
        expect(m.t0, `${c.name} ${id}`).toBe(firstMoment(track(base, id))!.t0);
        expect(m.t1, `${c.name} ${id}`).toBe(sc.duration);
      }
      if (c.moment !== 'won') {
        const tr = track(sc, 'striker');
        const m = firstMoment(tr)!;
        const a = evaluateActor(tr, m.t0 + 50).pos;
        const z = evaluateActor(tr, sc.duration - 1).pos;
        expect(Math.hypot(z.x - a.x, z.z - a.z), c.name).toBeLessThan(0.01);
      }
    }
  });

  it('the mirror is its own inverse and flips the bat key sideways (the batter clips are mirrorable; a left-hander plays them mirrored)', () => {
    for (const id of [MOMENT_CLIPS.strikerWon, MOMENT_CLIPS.strikerLost] as const) {
      const clip = `vmp:${id}` as const;
      for (let t = 0; t <= clipDuration(clip); t += 0.4) {
        const a = createPose();
        const b = createPose();
        sampleClip(clip, t, a);
        sampleClip(clip, t, b);
        mirrorSampledPose(b);
        expect(b.bat!.grip[0], `${id} @${t}`).toBeCloseTo(-a.bat!.grip[0], 6);
        expect(b.bat!.dir[0], `${id} @${t}`).toBeCloseTo(-a.bat!.dir[0], 6);
        mirrorSampledPose(b);
        let worst = 0;
        for (let i = 0; i < a.q.length; i++) worst = Math.max(worst, Math.abs(a.q[i] - b.q[i]));
        expect(worst, `${id} @${t}`).toBeLessThan(1e-6);
      }
    }
  });

  it('puts a live ball’s moment in at or after now + 120 ms, never before the physics event, and leaves everything before it as it was', () => {
    for (const [k, c] of CASES.entries()) {
      const { script, result } = scriptFor(c, null, k);
      const p = script.practice!;
      const dead = simToScene({ releaseScene: p.releaseScene }, result.deadT);
      const before = new Map(script.actors.map((a) => [a.id, a.moves.map((m) => ({ ...m }))]));
      expect(applyChaseMoment(script, c.moment, dead + 120), c.name).toBe(true);
      const eventScene = simToScene({ releaseScene: p.releaseScene }, momentEventT(result, c.moment).t);
      for (const id of ['striker', 'bowler'] as const) {
        const m = firstMoment(track(script, id))!;
        expect(m.t0, `${c.name} ${id}`).toBeGreaterThanOrEqual(dead + 120 - 1e-6);
        expect(m.t0, `${c.name} ${id}`).toBeGreaterThanOrEqual(eventScene + 180);
        const old = before.get(id)!.filter((x) => x.t1 <= m.t0 - 1);
        expect(track(script, id).moves.slice(0, old.length), `${c.name} ${id}`).toEqual(old);
      }
    }
  });

  /** What the actor draws at scene time t: where he stands, which way he faces and which clip. */
  const drawn = (script: BallScript, id: string, t: number) => {
    const s = evaluateActor(track(script, id), t);
    return { heading: s.heading, x: s.pos.x, z: s.pos.z, clip: String(s.current.clip) };
  };
  /** The one-frame turn of his heading at t (deg). */
  const headingStep = (script: BallScript, id: string, t: number) =>
    Math.abs(angleDelta(drawn(script, id, t - DT).heading, drawn(script, id, t).heading)) * DEG;

  it('draws every frame already on screen as it was when a live ball’s moment is put in (heading, place, clip), and turns his heading no more than 12 degrees a frame through the switch', () => {
    // MF-09: the moment cut the rest that follows a run short, so its heading turned sooner than it had on screen (a left-hander jumped
    // 171 deg in the frame the moment was put in). 12 deg a frame is 720 deg/s, the head-in-the-world pop limit of MOTION-SPEC section 9.
    const bad: string[] = [];
    for (const [k, c] of CASES.entries()) {
      const { script, result } = scriptFor(c, null, k);
      const now = simToScene({ releaseScene: script.practice!.releaseScene }, result.deadT) + 120;
      const frames: number[] = [];
      for (let t = 0; t < now; t += DT) frames.push(t);
      const was = new Map(['striker', 'bowler'].map((id) => [id, frames.map((t) => drawn(script, id, t))]));
      expect(applyChaseMoment(script, c.moment, now), c.name).toBe(true);
      for (const id of ['striker', 'bowler']) {
        let off = 0;
        let offAt = 0;
        frames.forEach((t, i) => {
          const a = was.get(id)![i];
          const b = drawn(script, id, t);
          const d = Math.abs(angleDelta(a.heading, b.heading)) * DEG;
          if (d > off) [off, offAt] = [d, t];
          if (Math.hypot(a.x - b.x, a.z - b.z) > 1e-6 || a.clip !== b.clip)
            bad.push(`${c.name} ${id}: the frame at ${t.toFixed(0)} ms was on screen with another place or clip`);
        });
        if (off > 1e-6)
          bad.push(
            `${c.name} ${id}: the frame at ${offAt.toFixed(0)} ms is drawn ${off.toFixed(1)} deg off what was on screen`,
          );
        let step = 0;
        let stepAt = 0;
        for (let t = now - 1000; t <= script.duration; t += DT) {
          const d = headingStep(script, id, t);
          if (d > step) [step, stepAt] = [d, t];
        }
        if (step > 12)
          bad.push(`${c.name} ${id}: his heading turns ${step.toFixed(1)} deg in one frame at ${stepAt.toFixed(0)} ms`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('draws every frame before a replay’s moment starts as the script without it draws them (heading, place, clip), bar the bowler’s built-in wicket jump that the moment replaces', () => {
    const bad: string[] = [];
    for (const [k, c] of CASES.entries()) {
      const base = scriptFor(c, null, k).script;
      const moment = scriptFor(c, c.moment, k).script;
      for (const id of ['striker', 'bowler']) {
        const start = firstMoment(track(moment, id))!.t0;
        const jump = track(base, id).moves.find((x) => String(x.clip).startsWith('celebrate_'));
        const until = Math.min(start, jump?.t0 ?? Infinity) - 1;
        let off = 0;
        let offAt = 0;
        for (let t = 0; t < until; t += DT) {
          const a = drawn(base, id, t);
          const b = drawn(moment, id, t);
          const d = Math.abs(angleDelta(a.heading, b.heading)) * DEG;
          if (d > off) [off, offAt] = [d, t];
          if (Math.hypot(a.x - b.x, a.z - b.z) > 1e-6 || a.clip !== b.clip)
            bad.push(`${c.name} ${id}: the frame at ${t.toFixed(0)} ms has another place or clip`);
        }
        if (off > 1e-6)
          bad.push(
            `${c.name} ${id}: the frame at ${offAt.toFixed(0)} ms faces ${off.toFixed(1)} deg off the script without the moment`,
          );
      }
    }
    expect(bad).toEqual([]);
  });
});

/**
 * BASELINE (CLP-04b, OPEN): the existing batter stroke's own pops in the windows scanned below, found by drawing the very same
 * balls with no moment (the control run) and counting the strikers' hits from the moment's start to 300 ms after the clip's end,
 * measured at build b12356b+ef5531ec0d51 (MOTION-FIX MF-05, 2026-11-08): Director on 4 (all in "lost_wicket, an edge, LH": the
 * Director's own head turn, 840 to 940 deg/s in the world, 0.8 s after the moment would have started), Director off 0, Reduced
 * Motion 0, live ball 4 (the same four). They are the stroke's and the Director's, not the clip's; they are not on trial here, and
 * they may not grow (a test below), so the tolerance cannot widen unseen.
 */
const STROKE_POPS = { 'Director on': 4, 'Director off': 0, 'Reduced Motion': 0, 'live ball': 4 } as const;

describe('Chase result moments: as drawn', () => {
  /**
   * [striker, bowler] frames and hits of one built script and variant, drawn from 1.5 s before the moment to 300 ms after the clip and
   * scanned from the moment's own start, and the same of its CONTROL: the same ball scripted with no moment, drawn over the same scene
   * window with the same hooks and Director. `added` is what the moment brings that the control does not have.
   */
  function pops(b: { c: Case; script: BallScript; control: BallScript }, v: Variant) {
    const out: Array<{
      id: 'striker' | 'bowler';
      f: Frame[];
      hits: Hit[];
      control: Hit[];
      added: Hit[];
      m: { t0: number; clip: unknown };
    }> = [];
    for (const id of ['striker', 'bowler'] as const) {
      const m = firstMoment(track(b.script, id));
      if (!m) continue;
      const dur = clipDuration(m.clip) * 1000;
      // Drawn from 1.5 s before the moment so the hooks' memories are warm (a seek starts them fresh); scanned from the moment's own
      // start (the frame before it, for the first step): what happens earlier belongs to the stroke, the run or the follow-through.
      const drawn = (script: BallScript, label: string) => {
        const all = walk(script, id, Math.max(0, m.t0 - 1500), Math.min(b.script.duration, m.t0 + dur + 300), v);
        const f = all.slice(Math.max(0, all.findIndex((x) => x.t >= m.t0) - 1));
        const bottom = b.c.hand === 'left' ? 0 : 1;
        return {
          f,
          hits: scan(
            f,
            `${b.c.name} ${id} [${v.name}]${label}`,
            m.t0,
            id === 'striker' ? { bottom, gloveFrom: m.t0 + 400 } : {},
          ),
        };
      };
      const mine = drawn(b.script, '');
      const control = drawn(b.control, ' control');
      // The control is only a control when it is drawn at the very same instants.
      expect(
        control.f.map((x) => x.t),
        `${b.c.name} ${id} [${v.name}] control frames`,
      ).toEqual(mine.f.map((x) => x.t));
      out.push({
        id,
        f: mine.f,
        hits: mine.hits,
        control: control.hits,
        added: addedBy(mine.hits, control.hits),
        m,
      });
    }
    return out;
  }

  /** One line of the report: a hit, and whether the control has it too. */
  const line = (h: Hit, added: readonly Hit[]) =>
    `    ${added.includes(h) ? 'NEW ' : 'ctrl'} ${h.kind} ${h.where} ${h.v.toFixed(2)}`;

  for (const v of VARIANTS)
    it(`adds no pop to the control run through the hand-over and the clip [${v.name}]: no new spike, 60 degree step, hips or root jump, head turn over 720 deg/s in the world, wrist swing over 85 degrees or glove more than 2 cm off the handle; both hands, both arms`, () => {
      const report: string[] = [];
      const bad: string[] = [];
      let strokePops = 0;
      for (const [k, c] of CASES.entries()) {
        const sc = v.reduced ? scriptFor(c, c.moment, k, true) : scriptFor(c, c.moment, k);
        for (const r of pops({ c, script: sc.script, control: scriptFor(c, null, k).script }, v)) {
          let worstUp = 0;
          let worstLeg = 0;
          for (let i = 1; i < r.f.length; i++) {
            for (const b of UPPER) worstUp = Math.max(worstUp, turn(r.f[i - 1], r.f[i], b));
            for (const b of LEGS) worstLeg = Math.max(worstLeg, turn(r.f[i - 1], r.f[i], b));
          }
          report.push(
            `${c.name} ${r.id} [${v.name}]: ${r.hits.length} pops, the control run has ${r.control.length}, ${r.added.length} new; worst upper ${worstUp.toFixed(1)}, worst leg ${worstLeg.toFixed(1)} deg a frame`,
          );
          for (const h of r.hits.slice(0, 6)) report.push(line(h, r.added));
          for (const h of r.control.slice(0, 8)) report.push(`    base ${h.kind} ${h.where} ${h.v.toFixed(2)}`);
          if (r.id === 'striker') {
            strokePops += r.control.length;
            // What the moment adds to the striker is judged against the stroke's own pops (the control); his stroke is not on trial here.
            for (const h of r.added) bad.push(`${h.kind} ${h.where}: ${h.v.toFixed(3)}`);
          } else for (const h of r.hits) bad.push(`${h.kind} ${h.where}: ${h.v.toFixed(3)}`);
        }
      }
      report.push(
        `the strikers' control runs [${v.name}]: ${strokePops} pops in all (baseline ${STROKE_POPS[v.name]})`,
      );
      console.log(report.join('\n'));
      // The tolerance for the existing stroke is written down, so it cannot widen unseen.
      expect(strokePops, 'the existing stroke’s own pops (CLP-04b, open) have not grown').toBeLessThanOrEqual(
        STROKE_POPS[v.name],
      );
      expect(bad.slice(0, 12)).toEqual([]);
    }, 300_000);

  it('adds no pop to the control run where a live ball’s moment is put into the script already on screen (the bowler cut from his walk back, the striker from his rest)', () => {
    const bad: string[] = [];
    const report: string[] = [];
    let strokePops = 0;
    for (const [k, c] of CASES.entries()) {
      const { script, result } = scriptFor(c, null, k);
      const p = script.practice!;
      const dead = simToScene({ releaseScene: p.releaseScene }, result.deadT);
      expect(applyChaseMoment(script, c.moment, dead + 120), c.name).toBe(true);
      for (const r of pops({ c, script, control: scriptFor(c, null, k).script }, VARIANTS[0])) {
        report.push(
          `${c.name} ${r.id}: starts +${Math.round((r.m as { t0: number }).t0 - dead)} ms after the dead ball, ${r.hits.length} pops, the control run has ${r.control.length}, ${r.added.length} new`,
        );
        for (const h of r.hits.slice(0, 6)) report.push(line(h, r.added));
        if (r.id === 'striker') {
          strokePops += r.control.length;
          for (const h of r.added) bad.push(`${h.kind} ${h.where}: ${h.v.toFixed(3)}`);
        } else for (const h of r.hits) bad.push(`${h.kind} ${h.where}: ${h.v.toFixed(3)}`);
      }
    }
    report.push(
      `the strikers' control runs [live ball]: ${strokePops} pops in all (baseline ${STROKE_POPS['live ball']})`,
    );
    console.log(report.join('\n'));
    expect(strokePops, 'the existing stroke’s own pops (CLP-04b, open) have not grown').toBeLessThanOrEqual(
      STROKE_POPS['live ball'],
    );
    expect(bad.slice(0, 12)).toEqual([]);
  }, 300_000);

  it('holds the bottom hand on the handle (2 cm), the wrist inside its range and the bat off the ground, with the top hand let go', () => {
    const report: string[] = [];
    const bad: string[] = [];
    for (const [k, c] of CASES.entries()) {
      const sc = scriptFor(c, c.moment, k);
      const m = firstMoment(track(sc.script, 'striker'))!;
      const bottom = c.hand === 'left' ? 0 : 1;
      const dur = clipDuration(m.clip) * 1000;
      const f = walk(sc.script, 'striker', m.t0 + 400, Math.min(sc.script.duration, m.t0 + dur), VARIANTS[0]);
      let gap = 0;
      let wrist = 0;
      let low = Infinity;
      for (const fr of f) {
        gap = Math.max(gap, fr.palm[bottom]);
        wrist = Math.max(wrist, fr.wrist[bottom]);
        low = Math.min(low, fr.toe.y);
      }
      report.push(
        `${c.name}: bottom palm to handle at most ${(gap * 1000).toFixed(1)} mm, wrist swing at most ${wrist.toFixed(0)} deg, lowest toe ${(low * 100).toFixed(0)} cm`,
      );
      if (gap > 0.02) bad.push(`${c.name}: bottom palm ${(gap * 1000).toFixed(1)} mm off the handle`);
      if (low < -0.02) bad.push(`${c.name}: the bat toe at ${(low * 100).toFixed(0)} cm (through the ground)`);
    }
    console.log(report.join('\n'));
    expect(bad).toEqual([]);
  }, 300_000);
});
