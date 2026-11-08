/**
 * WEB-FIX-B: the web bowler after the ball has left his hand, as DRAWN (StageScene.drawScript posed at 60 Hz with the Practice
 * stage's own pose hooks and the Director, the bones read back). The motion reel (2026-11-07) found two defects the older tests
 * could not see because they stop 150 to 800 ms after the release:
 *
 * F2  About 0.8 s after the release, where the follow-through hands over to what the bowler does next, his whole body jumped in one
 *     frame: the forearms 57 to 65 degrees, an upper arm 41, the chest 5, the heading 7 to 26 degrees. The path of a ball that comes
 *     back to him begins with a `ready` move with no blend and a heading of 0; the follow-through is cut off mid-swing. Behind it, the
 *     built-in clips he fields and celebrates with aim an arm by the shortest swing, and that gave 160 to 175 degree flips in a
 *     frame (a cross-fade to a clip that does not aim the arm put it down at the half-way frame; one throw key went the long way
 *     round) and 46 degrees a frame at the top of a celebration (an arm aimed past straight up spins about its own length).
 * F3  The Director's head pass, once the bowler had turned away to walk back, retargeted a plan that is still on the batter (now behind
 *     him) to the chest's front but kept the pitch it had measured behind the chest: with a leaning chest that is a head hanging 85
 *     degrees down, whose yaw flips by 180 degrees, and the neck and head, which share one rotation, jumped 61 and 106 degrees in one frame.
 *
 * The corpus is 44 real deliveries: pace and spin, both arms, both hands, a drive for four, a defence back to the bowler, a leave, a
 * bowled miss, a six and a catch, in all three scripts a ball has (live, as played, as replayed).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Group, PerspectiveCamera, Quaternion, Scene, Vector3 } from 'three';
import type { BowlerProfile, DeliveryResult, DeliveryVariation, Footwork, Handedness, NormalizedSwing, PracticeDeliveryPlan } from '@/contracts/practice';
import { autoField, batTravelMs, flight, resolveDelivery } from '@/physics';
import { idealTimeFor } from '@/physics/bat';
import { evaluateActor, type ActorTrack } from '@/render3d/core/actors';
import type { BallScript } from '@/render3d/core/choreo';
import { aimWeight, blendPose, createPose, sampleClip, setWeightedAims } from '@/render3d/core/clips';
import { canComposeBouncer } from '@/render3d/core/motion/bowlerRunup';
import { CH, CHANNELS, DirectorRuntime } from '@/render3d/core/motion/director';
import { HEAD, turnHead } from '@/render3d/core/motion/director/stage/pose';
import { PRACTICE_PROFILES } from '@/render3d/core/quality';
import { BONE_NAMES } from '@/render3d/core/skeleton';
import { FOLLOW_HANDOVER, buildPracticeScript } from '@/render3d/practice/script';
import { ThreePracticeStage, measureReleaseBall } from '@/render3d/three/ThreePracticeStage';
import { ARM_LIMIT, HEAD_LIMIT } from '@/render3d/three/players';
import { RELEASE_REACH, StageScene, type ScriptDrawOptions } from '@/render3d/three/stageScene';
import { KITS } from '@/ui/avatar/traits';

const KITS2: [(typeof KITS)[0], (typeof KITS)[0]] = [KITS[0], KITS[1]];
const DT = 1000 / 60;
const DEG = 180 / Math.PI;
const RAD = Math.PI / 180;
const BONE = Object.fromEntries(BONE_NAMES.map((n, i) => [n, i])) as Record<(typeof BONE_NAMES)[number], number>;
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

// The repo's no-WebGL stage stub (a StageScene built without its constructor).
function stubStage(): StageScene {
  const stage = Object.create(StageScene.prototype) as StageScene;
  Object.assign(stage, {
    scene: new Scene(), camera: new PerspectiveCamera(30, 1, 0.1, 1200),
    ballFx: { update: () => undefined }, stumpsFx: { update: () => undefined }, eventFx: { update: () => undefined },
    blobs: { begin: () => undefined, end: () => undefined, add: () => undefined },
    stadium: { group: new Group(), setTime: () => undefined, setExcitement: () => undefined, setCrowdMood: () => undefined, setBoardFlash: () => undefined },
    preset: PRACTICE_PROFILES.standard.preset, cssHeight: 400,
    rigs: new Map(), bats: new Map(), mirrored: new Map(),
    pose: createPose(), poseB: createPose(), lower: createPose(), towers: [],
  });
  return stage;
}

type Hook = ScriptDrawOptions['poseHook'];
const proto = ThreePracticeStage.prototype as unknown as { poseHooks(s: unknown, p: unknown): Hook; cueHook: unknown };
/** The stage's own pose hooks for a script: the production composition, with the Director. */
const hooksFor = (script: BallScript, director: DirectorRuntime): Hook =>
  proto.poseHooks.call({ hookCache: new WeakMap(), reducedMotion: false, cueHook: proto.cueHook, director }, script, script.practice!);

interface Case {
  name: string;
  bowler: BowlerProfile;
  hand: Handedness;
  variation: DeliveryVariation;
  plan: Partial<PracticeDeliveryPlan>;
  swing: { kind: 'attack' | 'defend'; directionDeg: number; power: number; elevation: number; footwork: Footwork } | null;
  errMs?: number;
}

const BOWLERS: Array<[string, BowlerProfile]> = [
  ['pace R', { family: 'pace', paceBand: 'fast', arm: 'right', lookSeed: 'wfb-p1' }],
  ['pace L express', { family: 'pace', paceBand: 'express', arm: 'left', lookSeed: 'wfb-p2' }],
  ['finger R', { family: 'spin', spinType: 'finger', arm: 'right', lookSeed: 'wfb-s1' }],
  ['wrist L', { family: 'spin', spinType: 'wrist', arm: 'left', lookSeed: 'wfb-s4' }],
];
const DRIVE = { kind: 'attack', directionDeg: 12, power: 0.9, elevation: 0.04, footwork: 'forward' } as const;
const DEFEND = { kind: 'defend', directionDeg: 0, power: 0.3, elevation: 0, footwork: 'forward' } as const;
const LATE = { kind: 'attack', directionDeg: 10, power: 0.8, elevation: 0, footwork: 'forward' } as const;
const LOFT = { kind: 'attack', directionDeg: 10, power: 0.95, elevation: 1, footwork: 'forward' } as const;
const EDGE = { kind: 'attack', directionDeg: 0, power: 0.8, elevation: 0, footwork: 'forward' } as const;

function corpus(): Case[] {
  const out: Case[] = [];
  for (const [bn, bowler] of BOWLERS) {
    const spin = bowler.family === 'spin';
    const speedKph = spin ? 86 : bowler.paceBand === 'express' ? 146 : 136;
    for (const hand of ['right', 'left'] as const) {
      const mk = (label: string, variation: DeliveryVariation, plan: Partial<PracticeDeliveryPlan>, swing: Case['swing'], errMs?: number): Case => ({
        name: `${bn} v ${hand[0].toUpperCase()}H ${label}`, bowler, hand, variation, plan: { speedKph, ...plan }, swing, ...(errMs !== undefined ? { errMs } : {}),
      });
      out.push(
        mk('drive', 'stock', { lengthM: 3.5, lineM: 0.1 }, DRIVE),
        mk('defend', spin ? 'flighted' : 'stock', { lengthM: 4.5, lineM: 0.25 }, DEFEND),
        mk('leave', spin ? 'wrong_un' : 'outswing', { lengthM: 5, lineM: 0.4 }, null),
        mk('bowled', 'stock', { lengthM: 4, lineM: 0.1 }, LATE, 90),
        mk('six', spin ? 'topspinner' : 'stock', { lengthM: 4, lineM: 0.1 }, LOFT),
      );
      if (bn === 'pace R' || bn === 'wrist L') out.push(mk('edge', spin ? 'arm_ball' : 'inswing', { lengthM: 3, lineM: 0 }, EDGE, -110));
    }
  }
  return out;
}

interface Built {
  c: Case;
  result: DeliveryResult;
  live: BallScript;
  played: BallScript;
  replay: BallScript;
  releaseScene: number;
}
function build(c: Case, k: number): Built {
  const stage = stubStage();
  const stock = measureReleaseBall(stage, c.bowler, KITS2)!;
  const bouncer = c.bowler.family === 'pace' && canComposeBouncer() ? measureReleaseBall(stage, c.bowler, KITS2, 'bouncer') : null;
  const releaseHand = (bouncer ? { ...stock, bouncer } : stock) as never;
  const full: PracticeDeliveryPlan = { variation: c.variation, lengthM: 6, lineM: 0.1, speedKph: 136, ...c.plan };
  const fl = flight({ plan: full, bowler: c.bowler, conditions: 'balanced', seed: `wfb:${c.name}:${k}`, handedness: c.hand });
  const field = autoField(c.bowler, 'balanced', c.hand);
  let swing: NormalizedSwing | null = null;
  if (c.swing) swing = { ...c.swing, startT: idealTimeFor(fl, c.swing.footwork) - batTravelMs(c.swing.kind, c.swing.power) / 1000 + (c.errMs ?? 0) / 1000 };
  const result = resolveDelivery({ flight: fl, swing, field, bowler: c.bowler, conditions: 'balanced', handedness: c.hand, assist: 'play', tierToleranceMs: 0 });
  const setup = { field, bowler: c.bowler, conditions: 'balanced' as const, handedness: c.hand };
  const live = buildPracticeScript({ setup, flight: fl, releaseHand });
  const releaseScene = live.practice!.releaseScene;
  const resultAt = releaseScene + 230;
  const played = buildPracticeScript({ setup, flight: fl, result, resultAt, handover: { script: live, atScene: resultAt }, releaseHand });
  const replay = buildPracticeScript({ setup, flight: fl, result, releaseHand });
  return { c, result, live, played, replay, releaseScene };
}
let BUILT: Built[] | null = null;
const built = (): Built[] => (BUILT ??= corpus().map((c, k) => build(c, k)));

interface Frame {
  t: number;
  rel: number;
  heading: number;
  q: Float64Array;
  /** The head's line of sight against the horizon, degrees, + down. */
  headPitch: number;
}

/** The bowler alone, posed at 60 Hz from t0 to t1 through drawScript with the Director (the stage's own path). */
function pose(script: BallScript, kind: 'live' | 'result' | 'replay', t0: number, t1: number, o: { twice?: boolean } = {}): Frame[] {
  const stage = stubStage();
  const rt = new DirectorRuntime();
  rt.register(script, kind, null);
  rt.finish(script);
  const hook = hooksFor(script, rt);
  const hidden = new Set(script.actors.filter((a) => a.id !== 'bowler').map((a) => a.id));
  const rel = script.practice!.releaseScene;
  const out: Frame[] = [];
  const draw = (t: number) => stage.drawScript(script, t, { pos: { x: 0, y: 1.7, z: 12 }, target: { x: 0, y: 1, z: 0 }, fov: 30 } as never, { kits: KITS2, slow: false, clockMs: t, reducedMotion: false, hidden, bat: null, poseHook: hook });
  const dir = new Vector3();
  for (let t = t0; t <= t1 + 1e-6; t += DT) {
    draw(t);
    if (o.twice) draw(t);
    const rig = stage.rigOf('bowler')!;
    const q = new Float64Array(BONE_NAMES.length * 4);
    rig.bones.forEach((b, i) => q.set([b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w], i * 4));
    rig.root.updateMatrixWorld(true);
    rig.boneMap.head.updateWorldMatrix(true, false);
    dir.set(0, 0, 1).transformDirection(rig.boneMap.head.matrixWorld);
    out.push({ t, rel: t - rel, heading: rig.root.rotation.y, q, headPitch: Math.asin(Math.max(-1, Math.min(1, -dir.y))) * DEG });
  }
  return out;
}

/** The angle (degrees) bone `i` turns between two frames. */
function step(a: Frame, b: Frame, i: number): number {
  const o = i * 4;
  const d = Math.abs(a.q[o] * b.q[o] + a.q[o + 1] * b.q[o + 1] + a.q[o + 2] * b.q[o + 2] + a.q[o + 3] * b.q[o + 3]);
  return 2 * Math.acos(Math.min(1, d)) * DEG;
}
const wrap = (d: number): number => ((((d + 180) % 360) + 360) % 360) - 180;

const SCRIPTS = [['replay', 'replay'], ['played', 'result'], ['live', 'live']] as const;
const scriptOf = (b: Built, name: (typeof SCRIPTS)[number][0]): BallScript => (name === 'replay' ? b.replay : name === 'played' ? b.played : b.live);

describe('F2: the follow-through hands over to what the bowler does next', () => {
  it('has no pop in the arms, the trunk or the head: from 300 ms after the release none of those bones turns more than 25 degrees in a frame, in any script of 44 deliveries (it was 57 to 175 degrees in 93 of 118 replays)', () => {
    const worst: Array<[string, number]> = [];
    let frames = 0;
    for (const b of built()) {
      for (const [name, kind] of SCRIPTS) {
        const script = scriptOf(b, name);
        const f = pose(script, kind, b.releaseScene + 300, script.duration);
        for (let k = 1; k < f.length; k++) {
          frames++;
          for (const i of UPPER) {
            const d = step(f[k - 1], f[k], i);
            if (d > 25) worst.push([`${b.c.name} [${name}] ${BONE_NAMES[i]} at release +${Math.round(f[k].rel)} ms`, d]);
          }
        }
      }
    }
    expect(frames).toBeGreaterThan(30000);
    expect(worst.slice(0, 6), 'the first bone steps over 25 degrees').toEqual([]);
  }, 120_000);

  it('keeps the legs inside the planted-feet plan\'s own steps: no leg bone turns more than 60 degrees in a frame (27 to 58 degrees remain, the foot-plant releases in locomotion.ts, not the hand-over)', () => {
    let worst = 0;
    for (const b of built()) {
      const f = pose(b.replay, 'replay', b.releaseScene + 300, b.replay.duration);
      for (let k = 1; k < f.length; k++) for (const i of LEGS) worst = Math.max(worst, step(f[k - 1], f[k], i));
    }
    expect(worst).toBeLessThan(60);
  }, 120_000);

  it('does not snap the heading at the hand-over: the frame the follow-through ends in and the ones round it turn the bowler at most 3 degrees (it snapped 7 to 26 degrees)', () => {
    let seen = 0;
    for (const b of built()) {
      const track = b.replay.actors.find((a) => a.id === 'bowler')!;
      // the end of the composed run-up is where the next move (his chase, his celebration, his stroll) takes over
      const last = track.moves.filter((m) => String(m.clip).startsWith('vmp:runup_')).pop()!;
      const tc = last.t1;
      const f = pose(b.replay, 'replay', tc - 100, tc + 100);
      for (let k = 1; k < f.length; k++) {
        expect(Math.abs(wrap((f[k].heading - f[k - 1].heading) * DEG)), `${b.c.name} at the hand-over ${Math.round(f[k].t - tc)} ms`).toBeLessThanOrEqual(3);
        seen++;
      }
    }
    expect(seen).toBeGreaterThan(44 * 8);
  });

  it('is continuous in the heading and blends the pose: the move the chase (or the celebration, or the stroll) starts with blends for at least FOLLOW_HANDOVER.blendMs, and the heading fade starts exactly there and has gone when it is over', () => {
    let faded = 0;
    for (const b of built()) {
      const track: ActorTrack = b.replay.actors.find((a) => a.id === 'bowler')!;
      const fade = track.headingFade;
      if (!fade) continue;
      faded++;
      const m = track.moves.find((x) => x.t0 === fade.t0);
      expect(m, `${b.c.name}: a move starts where the fade does`).toBeDefined();
      expect(m!.blend ?? 140, b.c.name).toBeGreaterThanOrEqual(FOLLOW_HANDOVER.blendMs);
      expect(fade.ms).toBeGreaterThanOrEqual(FOLLOW_HANDOVER.minFadeMs);
      expect(fade.ms).toBeLessThanOrEqual(FOLLOW_HANDOVER.maxFadeMs);
      // continuous across the hand-over: a frame before it and at it differ by a frame's turn, not by the fade's delta
      const before = evaluateActor(track, fade.t0 - DT).heading;
      const at = evaluateActor(track, fade.t0).heading;
      expect(Math.abs(wrap((at - before) * DEG)), b.c.name).toBeLessThan(3);
      // and the fade has gone by the end of its time: the heading is the new move's own
      const plain: ActorTrack = { ...track, headingFade: undefined };
      expect(Math.abs(wrap((evaluateActor(track, fade.t0 + fade.ms + 1).heading - evaluateActor(plain, fade.t0 + fade.ms + 1).heading) * DEG)), b.c.name).toBeLessThan(1e-6);
      expect(Math.abs(wrap((evaluateActor(track, fade.t0).heading - evaluateActor(plain, fade.t0).heading - fade.delta) * DEG)), b.c.name).toBeLessThan(1e-6);
    }
    expect(faded, 'hand-overs with a turn in them').toBeGreaterThan(20);
  });
});

describe('the arms of the built-in clips the bowler fields and celebrates with', () => {
  /** The weighted, short-way aims are the bowler's (the stage turns them on for his pose only): these tests turn them on as it does. */
  const withAims = <T,>(on: boolean, f: () => T): T => {
    const was = setWeightedAims(on);
    try {
      return f();
    } finally {
      setWeightedAims(was);
    }
  };

  it('the throw\'s front arm goes the short way round: its aim between the keys at 330 and 20 degrees passes 360, never 180 (it swung through straight up, a 168 degree flip)', () => {
    withAims(true, () => {
      const pose0 = createPose();
      let prev: number | null = null;
      for (let t = 0.4; t <= 0.7; t += 0.01) {
        sampleClip('field_throw', t, pose0);
        const phi = pose0.aimL![0];
        if (prev !== null) expect(Math.abs(wrap(phi - prev)), `at ${t.toFixed(2)} s`).toBeLessThan(8);
        prev = phi;
      }
      sampleClip('field_throw', 0.52, pose0);
      expect(((pose0.aimL![0] % 360) + 360) % 360, 'half-way between the keys').toBeGreaterThan(340);
    });
  });

  it('a cross-fade between a clip that aims an arm and one that does not carries the aim at its share of the fade, a frame at a time (the aim switched whole at the half-way frame)', () => {
    withAims(true, () => {
      const aimed = createPose();
      sampleClip('celebrate_jump', 0.55, aimed);
      const plain = createPose();
      sampleClip('idle', 0, plain);
      expect(aimed.aimR).not.toBeNull();
      expect(plain.aimR).toBeNull();
      const weights: number[] = [];
      for (let w = 0.05; w < 1; w += 0.05) {
        const a = createPose();
        sampleClip('celebrate_jump', 0.55, a);
        blendPose(a, plain, w);
        expect(a.aimR, `w ${w.toFixed(2)}`).not.toBeNull();
        weights.push(aimWeight(a.aimR!));
      }
      // 1 - w, step by step: no jump from whole to nothing
      for (let i = 1; i < weights.length; i++) expect(Math.abs(weights[i] - weights[i - 1])).toBeLessThan(0.06);
      expect(weights[0]).toBeGreaterThan(0.9);
      expect(weights[weights.length - 1]).toBeLessThan(0.1);
      // the other way round
      const b = createPose();
      blendPose(b, aimed, 0.25);
      expect(b.aimR).not.toBeNull();
      expect(aimWeight(b.aimR!)).toBeCloseTo(0.25, 10);
      // a whole aim is the plain pair of every clip (nothing else in the pose changed shape)
      expect(aimWeight(aimed.aimR!)).toBe(1);
      expect(Object.getOwnPropertySymbols(aimed.aimR!)).toHaveLength(0);
    });
  });

  it('everyone else is drawn as before: with the weighted aims off (the keeper, the fielders, the batters) a cross-fade still switches the aim whole at the half-way frame and the throw\'s aim keys are interpolated as written', () => {
    withAims(false, () => {
      const plain = createPose();
      sampleClip('idle', 0, plain);
      const a = createPose();
      sampleClip('celebrate_jump', 0.55, a);
      blendPose(a, plain, 0.25);
      expect(a.aimR, 'before the half-way frame the aim is the aimed clip\'s, whole').not.toBeNull();
      expect(aimWeight(a.aimR!)).toBe(1);
      const c = createPose();
      sampleClip('celebrate_jump', 0.55, c);
      blendPose(c, plain, 0.75);
      expect(c.aimR, 'after it the aim is gone').toBeNull();
      const t = createPose();
      sampleClip('field_throw', 0.52, t);
      expect(t.aimL![0], 'the key at 330 to the key at 20, numerically').toBeLessThan(200);
    });
  });

  it('the bowler\'s arms are held to ARM_LIMIT once the release reach has let go of them, and are not touched before (bit-equal with the limit off)', () => {
    const b = built().find((x) => x.c.name === 'pace R v RH drive')!;
    const dt = (ARM_LIMIT.speed * DT) / 1000;
    const on = pose(b.replay, 'replay', b.releaseScene - 400, b.releaseScene + 2500);
    for (let k = 1; k < on.length; k++) {
      if (on[k].rel < RELEASE_REACH.tailMs + DT) continue;
      for (const i of [BONE.upperArmL, BONE.forearmL, BONE.handL, BONE.upperArmR, BONE.forearmR, BONE.handR]) expect(step(on[k - 1], on[k], i), `${BONE_NAMES[i]} at ${Math.round(on[k].rel)}`).toBeLessThanOrEqual(dt + 1e-6);
    }
    const was = ARM_LIMIT.speed;
    try {
      ARM_LIMIT.speed = 1e9;
      const off = pose(b.replay, 'replay', b.releaseScene - 400, b.releaseScene + 2500);
      for (let k = 0; k < on.length; k++) if (on[k].rel <= RELEASE_REACH.tailMs) expect(Array.from(on[k].q), `at ${Math.round(on[k].rel)}`).toEqual(Array.from(off[k].q));
    } finally {
      ARM_LIMIT.speed = was;
    }
  });
});

describe('F3: the head after the bowler has turned away', () => {
  /** The head's line of sight in the role frame after `turnHead` on a chain of rest bones with the chest leaned: [yaw, pitch] degrees. */
  function look(q: Float64Array, heading: number): [number, number] {
    const rot = new Quaternion();
    for (let i = 0; i < 5; i++) rot.multiply(new Quaternion(q[i * 4], q[i * 4 + 1], q[i * 4 + 2], q[i * 4 + 3]));
    const d = new Vector3(0, 0, 1).applyQuaternion(rot).applyAxisAngle(new Vector3(0, 1, 0), heading);
    return [Math.atan2(d.x, d.z) * DEG, Math.asin(Math.max(-1, Math.min(1, -d.y))) * DEG];
  }
  /** The chain hips, spine, chest, neck, head: identity, the spine and the chest leaned about x by `lean` degrees between them. */
  function chain(lean: number): Float64Array {
    const q = new Float64Array(20);
    for (let i = 0; i < 5; i++) q[i * 4 + 3] = 1;
    const half = (lean / 2) * RAD;
    for (const i of [1, 2]) {
      q[i * 4] = Math.sin(half / 2);
      q[i * 4 + 3] = Math.cos(half / 2);
    }
    return q;
  }
  const channels = (yaw: number, pitch: number): Float32Array => {
    const ch = new Float32Array(CHANNELS);
    ch[CH.headYaw] = yaw;
    ch[CH.headPitch] = pitch;
    return ch;
  };

  for (const lean of [0, 35, 55]) {
    it(`a heading sweep through +-180 degrees (the bowler turns away with a chest leaned ${lean} degrees, the plan on the batter at 24 degrees down): no frame turns the neck or the head more than 8 degrees for a half degree of heading (126 on the way it was with 55), and the head never hangs down`, () => {
      let worstStep = 0;
      let lowest = -90;
      let pulled = 0;
      // heading -150 -> -210 -> -150 degrees in half degrees: the body passes -180, the plan stays on the batter
      const sweep = [...Array.from({ length: 121 }, (_, k) => -150 - k * 0.5), ...Array.from({ length: 120 }, (_, k) => -210 + (k + 1) * 0.5)];
      let prev: Float64Array | null = null;
      for (const h of sweep) {
        const heading = h * RAD;
        const q = chain(lean);
        turnHead(q, channels(-1.3, 24), { heading, bowler: true }, false, 1);
        if (HEAD.clamped) pulled++;
        if (prev) {
          for (const i of [3, 4]) {
            const o = i * 4;
            const d = Math.abs(prev[o] * q[o] + prev[o + 1] * q[o + 1] + prev[o + 2] * q[o + 2] + prev[o + 3] * q[o + 3]);
            worstStep = Math.max(worstStep, 2 * Math.acos(Math.min(1, d)) * DEG);
          }
        }
        lowest = Math.max(lowest, look(q, heading)[1]);
        prev = q;
      }
      expect(pulled, 'the sweep reaches the pulled range').toBeGreaterThan(50);
      expect(worstStep).toBeLessThan(8);
      expect(lowest).toBeLessThan(55);
    });
  }

  it('the whole corpus, with the rate limiter off (the head pass alone): no neck or head step over 40 degrees from 2.5 s before the release to 4 s after, in any script', () => {
    const was = { ...HEAD_LIMIT };
    try {
      Object.assign(HEAD_LIMIT, { speed: 1e9, accel: 1e9, brake: 1e9 });
      let worst = 0;
      for (const b of built()) {
        for (const [name, kind] of SCRIPTS) {
          const f = pose(scriptOf(b, name), kind, b.releaseScene - 2500, b.releaseScene + 4000);
          for (let k = 1; k < f.length; k++) worst = Math.max(worst, step(f[k - 1], f[k], BONE.neck), step(f[k - 1], f[k], BONE.head));
        }
      }
      expect(worst).toBeLessThan(40);
    } finally {
      Object.assign(HEAD_LIMIT, was);
    }
  }, 120_000);

  it('the whole corpus as the stage draws it: the neck and head keep to the 720 degrees a second cap (12 degrees a frame), and from 1.5 s after the release the head looks no more than 60 degrees below the horizon (it hung 85 to 89 degrees down in 65 of 118 replays)', () => {
    let worst = 0;
    let lowest = -90;
    for (const b of built()) {
      for (const [name, kind] of SCRIPTS) {
        const f = pose(scriptOf(b, name), kind, b.releaseScene - 2500, b.releaseScene + 4000);
        for (let k = 1; k < f.length; k++) {
          worst = Math.max(worst, step(f[k - 1], f[k], BONE.neck), step(f[k - 1], f[k], BONE.head));
          if (f[k].rel >= 1500) lowest = Math.max(lowest, f[k].headPitch);
        }
      }
    }
    expect(worst).toBeLessThanOrEqual(12);
    expect(lowest).toBeLessThan(60);
  }, 120_000);

  it('a frame posed twice (a camera that reads the posed bones and draws, a probe) is the frame posed once: the rate limiter starts the second pass from where the first began (its dt was 0 and it held nothing back)', () => {
    const b = built().find((x) => x.c.name === 'pace R v RH six')!;
    const once = pose(b.replay, 'replay', b.releaseScene + 2000, b.releaseScene + 4000);
    const twice = pose(b.replay, 'replay', b.releaseScene + 2000, b.releaseScene + 4000, { twice: true });
    for (let k = 0; k < once.length; k++) expect(Array.from(twice[k].q), `at ${Math.round(once[k].rel)}`).toEqual(Array.from(once[k].q));
  });
});
