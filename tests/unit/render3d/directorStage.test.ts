/**
 * The face-and-life Director (P2) through the real Practice stage: the pose hooks (ThreePracticeStage.poseHooks), the
 * stage's own pose and the players' shader uniforms, on real physics deliveries of both arms, both hands and every kind
 * of result. What the gates need, and why they are here and not in the Director's own tests: the Director's plans are a
 * pure function of its anchors, but whether the head drawn is the head planned, whether the feet, the grips and the
 * bat are untouched, and whether a replay draws what the live frame drew, only the stage can say.
 *
 *   - honesty: the live script has no result; its plans agree with the result's until the first moment the result matters;
 *   - replay identity: two renders of one result, and a live result against its replay, draw the same bones and the same eyes;
 *   - physics: inside the quiet windows every bone but the neck and the head is bit-equal with and without the Director
 *     (so the feet, the grips, the bat and the release cannot have moved), and the other rigs are untouched;
 *   - the head: where the plan wants it, in the role frame, for both hands, both arms and the trunk the humans hook turns;
 *   - Reduced Motion, the off switch, the cost.
 */
import { loadavg } from 'node:os';
import v8 from 'node:v8';
import vm from 'node:vm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Group, PerspectiveCamera, Scene, Vector3 } from 'three';
import type { BowlerProfile, DeliveryResult, DeliveryVariation, Footwork, Handedness, NormalizedSwing, PracticeDeliveryPlan } from '@/contracts/practice';
import { autoField, batTravelMs, flight, resolveDelivery } from '@/physics';
import { idealTimeFor } from '@/physics/bat';
import type { BallScript } from '@/render3d/core/choreo';
import { createPose } from '@/render3d/core/clips';
import { CH, CHANNELS, DirectorRuntime, FACE, FRAME, applyHead, createOut, frameBegin, prepare, sample } from '@/render3d/core/motion/director';
import { DRAWN, SEAM } from '@/render3d/core/motion/director/stage/face';
import { HEAD, noteDrawn } from '@/render3d/core/motion/director/stage/pose';
import { evaluateActor } from '@/render3d/core/actors';
import { PRACTICE_PROFILES } from '@/render3d/core/quality';
import { buildPracticeScript } from '@/render3d/practice/script';
import { ThreePracticeStage } from '@/render3d/three/ThreePracticeStage';
import { StageScene, type ScriptDrawOptions } from '@/render3d/three/stageScene';
import { KITS } from '@/ui/avatar/traits';
import { bestOf, cpuMicros, skipOverBudgetWhenLoaded } from '../support/timing';
import { record, recordFile } from './director/gates';

recordFile('directorStage');

const KITS2: [(typeof KITS)[0], (typeof KITS)[0]] = [KITS[0], KITS[1]];
const DT = 1000 / 60;
const DEG = 180 / Math.PI;

const PACE: BowlerProfile = { family: 'pace', paceBand: 'fast', arm: 'right', lookSeed: 'dir-pace' };
const LEFT_ARM: BowlerProfile = { family: 'pace', paceBand: 'express', arm: 'left', lookSeed: 'dir-left' };
const FINGER: BowlerProfile = { family: 'spin', spinType: 'finger', arm: 'right', lookSeed: 'dir-finger' };

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
/** The stage's own pose hooks for a script: the production composition, with or without the Director. */
const hooksFor = (script: BallScript, director?: DirectorRuntime, reducedMotion = false): Hook =>
  proto.poseHooks.call({ hookCache: new WeakMap(), reducedMotion, cueHook: proto.cueHook, ...(director ? { director } : {}) }, script, script.practice!);

interface Case {
  name: string;
  bowler: BowlerProfile;
  hand: Handedness;
  variation: DeliveryVariation;
  plan?: Partial<PracticeDeliveryPlan>;
  /** null: a leave. */
  swing: { kind: 'attack' | 'defend'; directionDeg: number; power: number; elevation: number; footwork: Footwork } | null;
  errMs?: number;
}
const DRIVE = { kind: 'attack', directionDeg: 12, power: 0.8, elevation: 0.05, footwork: 'forward' } as const;
const PULL = { kind: 'attack', directionDeg: -80, power: 0.9, elevation: 0.2, footwork: 'back' } as const;
const DEFEND = { kind: 'defend', directionDeg: 0, power: 0.3, elevation: 0, footwork: 'forward' } as const;
const CASES: Case[] = [
  { name: 'pace right drive', bowler: PACE, hand: 'right', variation: 'stock', swing: DRIVE },
  { name: 'pace right defend', bowler: PACE, hand: 'right', variation: 'stock', swing: DEFEND },
  { name: 'pace left-hander pull', bowler: PACE, hand: 'left', variation: 'bouncer', plan: { lengthM: 10.5 }, swing: PULL },
  { name: 'left-arm left-hander drive', bowler: LEFT_ARM, hand: 'left', variation: 'stock', plan: { speedKph: 146 }, swing: DRIVE },
  { name: 'left-arm right-hander leave', bowler: LEFT_ARM, hand: 'right', variation: 'yorker', plan: { lengthM: 1, speedKph: 146 }, swing: null },
  { name: 'spin right miss (late)', bowler: FINGER, hand: 'right', variation: 'stock', swing: DRIVE, errMs: 130 },
  { name: 'spin left-hander drive', bowler: FINGER, hand: 'left', variation: 'flighted', plan: { lengthM: 5 }, swing: DRIVE },
  { name: 'pace right early', bowler: PACE, hand: 'right', variation: 'inswing', plan: { lengthM: 3 }, swing: DRIVE, errMs: -110 },
];

interface Built {
  c: Case;
  result: DeliveryResult;
  /** The script before the result (what bowl() draws). */
  live: BallScript;
  /** The result's script as play() builds it from the live one. */
  played: BallScript;
  /** The result's script as replay() builds it: from the result alone. */
  replay: BallScript;
  resultAt: number;
}
function build(c: Case, k = 0): Built {
  const full: PracticeDeliveryPlan = { variation: c.variation, lengthM: 6, lineM: 0.1, speedKph: c.bowler.family === 'spin' ? 86 : 136, ...c.plan };
  const fl = flight({ plan: full, bowler: c.bowler, conditions: 'balanced', seed: `dir:${c.name}:${k}`, handedness: c.hand });
  const field = autoField(c.bowler, 'balanced', c.hand);
  let swing: NormalizedSwing | null = null;
  if (c.swing) swing = { ...c.swing, startT: idealTimeFor(fl, c.swing.footwork) - batTravelMs(c.swing.kind, c.swing.power) / 1000 + (c.errMs ?? 0) / 1000 };
  const result = resolveDelivery({ flight: fl, swing, field, bowler: c.bowler, conditions: 'balanced', handedness: c.hand, assist: 'play', tierToleranceMs: 0 });
  const setup = { field, bowler: c.bowler, conditions: 'balanced' as const, handedness: c.hand };
  const live = buildPracticeScript({ setup, flight: fl });
  const resultAt = live.practice!.releaseScene + 230;
  const played = buildPracticeScript({ setup, flight: fl, result, resultAt, handover: { script: live, atScene: resultAt } });
  const replay = buildPracticeScript({ setup, flight: fl, result });
  return { c, result, live, played, replay, resultAt };
}
const BUILT: Built[] = [];
const cases = () => (BUILT.length ? BUILT : CASES.forEach((c, k) => BUILT.push(build(c, k))), BUILT);

const track = (s: BallScript, id: string) => s.actors.find((a) => a.id === id)!;
const plansOf = (rt: DirectorRuntime, s: BallScript) => rt.plansOf(s)!;
const same = (a: ArrayLike<number>, b: ArrayLike<number>) => a.length === b.length && Array.from(a).every((v, i) => v === b[i]);

/** The picture of one actor at scene time t: its bones' local rotations and the shader's lids and iris. */
function draw(stage: StageScene, script: BallScript, hook: Hook, id: string, t: number): number[] {
  const tr = track(script, id);
  stage.poseActor(tr, t, KITS2, null, hook);
  const rig = stage.rigOf(id)!;
  const out: number[] = [];
  for (const b of rig.bones) out.push(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
  out.push(rig.uniforms.uLidL.value, rig.uniforms.uLidR.value, rig.uniforms.uGaze.value[0], rig.uniforms.uGaze.value[1]);
  // P3: and the expression the face shader mixes (so every identity check below covers the face too)
  out.push(...rig.uniforms.uExpr.value);
  return out;
}
const BONES = 17;

describe('honesty: the live plans know nothing the live script does not', () => {
  it('the live script has no contact, outcome, dead ball, stroke end or swing; its task ends when the unhit ball passes', () => {
    for (const b of cases()) {
      const l = b.live.practice!.director;
      const r = b.played.practice!.director;
      expect(l.striker.contact, b.c.name).toBeNull();
      expect(l.striker.outcomeAt, b.c.name).toBeNull();
      expect(l.striker.dead, b.c.name).toBeNull();
      expect(l.striker.strokeEnd, b.c.name).toBeNull();
      expect(l.striker.swing, b.c.name).toBeNull();
      expect(l.striker.runs, b.c.name).toBe(0);
      expect(l.seed, b.c.name).toBe(r.seed);
      // the blink-free window of the live plan is never shorter than the result's
      expect(l.striker.taskEnd!, b.c.name).toBeGreaterThanOrEqual(r.striker.taskEnd! - 1e-6);
      // the bowler's anchors do not depend on the result at all (his script is as long, no more)
      for (const k of ['runStart', 'gather', 'release', 'followEnd', 'swing', 'contact', 'taskEnd', 'outcomeAt', 'dead', 'strokeEnd', 'runs'] as const) expect(l.bowler[k], `${b.c.name} bowler ${k}`).toBe(r.bowler[k]);
      // the striker's eye does not depend on the result's planted stance either
      expect(l.strikerEye).toEqual(r.strikerEye);
      expect(l.bowler.release).toBe(b.live.practice!.releaseScene);
    }
  });

  it('a result handed over a live delivery gives exactly the plan a replay of the result gives (the bounds of the reuse are right)', () => {
    let reused = 0;
    for (const b of cases()) {
      const rt = new DirectorRuntime();
      rt.register(b.live, 'live', null);
      // bowl() builds nothing: the plans come in the first spare slices of the run-up
      expect(rt.plansOf(b.live)!.bowler, b.c.name).toBeNull();
      expect(rt.stats.syncBakes, b.c.name).toBe(0);
      rt.finish(b.live);
      const before = plansOf(rt, b.live);
      rt.register(b.played, 'result', b.live);
      // nothing was baked in the frame that built the result: the live plans stand in
      expect(rt.stats.syncBakes, b.c.name).toBe(0);
      expect(plansOf(rt, b.played).striker, b.c.name).toBe(before.striker);
      expect(plansOf(rt, b.played).bowler, b.c.name).toBe(before.bowler);
      rt.finish(b.played);
      const fresh = new DirectorRuntime();
      fresh.register(b.replay, 'replay', null);
      for (const role of ['bowler', 'striker'] as const) {
        const a = plansOf(rt, b.played)[role]!;
        const f = plansOf(fresh, b.replay)[role]!;
        expect(a.n, `${b.c.name} ${role}`).toBe(f.n);
        expect(same(a.trace, f.trace), `${b.c.name} ${role}: trace`).toBe(true);
        expect(same(a.fix, f.fix) && same(a.blink, f.blink) && same(a.draw, f.draw), `${b.c.name} ${role}: events`).toBe(true);
      }
      reused++;
    }
    expect(reused).toBe(CASES.length);
  });

  it('the live and the result plans are bit-equal until the first moment the result matters, and differ after it', () => {
    let differAfter = 0;
    for (const b of cases()) {
      const rt = new DirectorRuntime();
      rt.register(b.live, 'live', null);
      rt.finish(b.live);
      const live = plansOf(rt, b.live).striker!;
      const fresh = new DirectorRuntime();
      fresh.register(b.replay, 'replay', null);
      const res = plansOf(fresh, b.replay).striker!;
      const s = b.replay.practice!.director.striker;
      const bound = Math.min(s.contact === null ? Infinity : s.contact + 125, s.outcomeAt === null ? Infinity : s.outcomeAt + 180, s.dead === null ? Infinity : s.dead + 125, b.live.practice!.director.flightEnd! + 125);
      const i1 = Math.floor(((Math.min(bound, 8000) - live.t0) * live.hz) / 1000);
      for (let i = 0; i < i1; i++) for (let c = 0; c < CHANNELS; c++) if (live.trace[i * CHANNELS + c] !== res.trace[i * CHANNELS + c]) throw new Error(`${b.c.name}: frame ${i} (${((i * 1000) / 60).toFixed(0)} ms, bound ${bound.toFixed(0)}) channel ${c} differs`);
      let differs = false;
      for (let i = i1; i < Math.min(live.n, res.n); i++) for (let c = 0; c < CHANNELS && !differs; c++) differs = live.trace[i * CHANNELS + c] !== res.trace[i * CHANNELS + c];
      if (differs) differAfter++;
    }
    // a result that changes what the batter sees does change what he does afterwards (the test would be vacuous otherwise)
    expect(differAfter).toBeGreaterThan(CASES.length / 2);
  });

  it('a hook that reaches the first moment the live plan stops holding before the spare time came bakes the result plan as far as it needs, serves it, and draws what the replay draws', () => {
    const b = cases()[0];
    const rt = new DirectorRuntime();
    rt.register(b.live, 'live', null);
    rt.finish(b.live);
    rt.register(b.played, 'result', b.live);
    const hook = hooksFor(b.played, rt);
    const stage = stubStage();
    const s = b.played.practice!.director.striker;
    draw(stage, b.played, hook, 'striker', s.contact! - 400);
    expect(rt.stats.forced, 'not yet').toBe(0);
    const frame = draw(stage, b.played, hook, 'striker', s.contact! + 300);
    expect(rt.stats.forced).toBeGreaterThan(0);
    // P3: the plan is served while it is baked (the rest of the script is left to the spare time), and what it drew is the replay's
    const part = plansOf(rt, b.played).striker!;
    const fresh = new DirectorRuntime();
    fresh.register(b.replay, 'replay', null);
    const whole = plansOf(fresh, b.replay).striker!;
    const upto = Math.floor(((s.contact! + 300 - part.t0) * part.hz) / 1000) + 2;
    expect(upto).toBeLessThan(part.n / 2);
    expect(same(part.trace.subarray(0, upto * CHANNELS), whole.trace.subarray(0, upto * CHANNELS))).toBe(true);
    expect(rt.stats.forcedSlices, 'not the whole script').toBeLessThan(Math.ceil(((part.n - 1) * 4) / 64) / 2);
    expect(same(frame, draw(stubStage(), b.replay, hooksFor(b.replay, fresh), 'striker', s.contact! + 300))).toBe(true);
    rt.finish(b.played);
    expect(same(plansOf(rt, b.played).striker!.trace, whole.trace)).toBe(true);
  });

  const look = (stage: StageScene, id: string): number[] => {
    const rig = stage.rigOf(id)!;
    rig.root.updateMatrixWorld(true);
    rig.boneMap.head.updateWorldMatrix(true, false);
    const d = new Vector3(0, 0, 1).transformDirection(rig.boneMap.head.matrixWorld);
    return [d.x, d.y, d.z, rig.uniforms.uLidL.value, rig.uniforms.uLidR.value, rig.uniforms.uGaze.value[0], rig.uniforms.uGaze.value[1]];
  };

  it('with the spare time of a slow phone (a slice every few frames) a deadline forces at most one slice at a time, the plan is the replay\'s, and nothing is baked in the frames before the deadline', () => {
    let worstFrame = 0;
    let forcedFrames = 0;
    for (const b of cases().slice(0, 4)) {
      const rt = new DirectorRuntime();
      rt.register(b.live, 'live', null);
      rt.finish(b.live);
      rt.register(b.played, 'result', b.live);
      const fresh = new DirectorRuntime();
      fresh.register(b.replay, 'replay', null);
      const hook = hooksFor(b.played, rt);
      const hookR = hooksFor(b.replay, fresh);
      const stage = stubStage();
      const stageR = stubStage();
      const s = b.played.practice!.director.striker;
      // the result arrives 230 ms after the release; a frame every 33 ms (a 4x CPU), 0.6 ms of spare time for the Director per frame
      // (a slice costs 0.25 ms in this model: a slice or two a frame, the first two spare slots of the script left alone)
      let clock = 0;
      let forcedBefore = rt.stats.forcedSlices;
      // (frames are drawn from 900 ms before the release like the replay identity test's, so the stage's own easing is in the same state
      // for both; the spare time starts when the result arrives)
      const r = b.played.practice!.releaseScene;
      for (let t = r - 900, k = -Math.round((b.resultAt - (r - 900)) / 33.3); t <= s.contact! + 900; t += 33.3, k++) {
        for (const id of ['bowler', 'striker']) {
          draw(stage, b.played, hook, id, t);
          // The same picture as the replay's, as far as the Director makes it: the lids and the iris, and where the head points in
          // space (the trunk's glove lean remembers the frames before it, so the bones themselves are the stage's to compare, not ours).
          draw(stageR, b.replay, hookR, id, t);
          if (t > (s.contact ?? 0) + 130) expect(look(stage, id), `${b.c.name} ${id} t=${t.toFixed(0)}`).toEqual(look(stageR, id));
        }
        const forced = rt.stats.forcedSlices - forcedBefore;
        forcedBefore = rt.stats.forcedSlices;
        worstFrame = Math.max(worstFrame, forced);
        if (forced > 0) forcedFrames++;
        if (k >= 2) rt.work(0.6, () => (clock += 0.25), b.played);
      }
      // and what the spare time of the frames after left to do, finished, is exactly the replay's plan
      rt.finish(b.played);
      for (const role of ['bowler', 'striker'] as const) expect(same(plansOf(rt, b.played)[role]!.trace, plansOf(fresh, b.replay)[role]!.trace), `${b.c.name} ${role}`).toBe(true);
    }
    record('forcedSlicesPerFrame', { worst: worstFrame, framesWithForcedWork: forcedFrames });
    expect(worstFrame).toBeLessThanOrEqual(1);
  });

  it('the spare time bakes the result plans: work() with a budget finishes them in a few slices and swaps them in', () => {
    const b = cases()[1];
    const rt = new DirectorRuntime();
    rt.register(b.live, 'live', null);
    rt.finish(b.live);
    rt.register(b.played, 'result', b.live);
    expect(rt.busy).toBe(true);
    const swapped = rt.stats.swaps; // the delivery's own two plans, finished above
    let calls = 0;
    let clock = 0;
    while (rt.work(0.5, () => (clock += 0.2))) calls++;
    expect(calls).toBeGreaterThan(0);
    expect(rt.busy).toBe(false);
    expect(rt.stats.swaps - swapped).toBe(2);
    expect(rt.stats.forced).toBe(0);
  });
});

describe('replay identity: the same result draws the same bones and the same eyes, live or replayed', () => {
  const frames = (s: BallScript): number[] => {
    const r = s.practice!.releaseScene;
    const out: number[] = [];
    for (let t = r - 900; t <= r + 2600; t += DT * 3) out.push(t);
    return out;
  };
  it('two renders of one replay are identical, frame for frame (60 Hz, both actors)', () => {
    for (const b of cases().slice(0, 4)) {
      const a = new DirectorRuntime();
      const c = new DirectorRuntime();
      a.register(b.replay, 'replay', null);
      c.register(b.replay, 'replay', null);
      const sa = stubStage();
      const sc = stubStage();
      const ha = hooksFor(b.replay, a);
      const hc = hooksFor(b.replay, c);
      for (const t of frames(b.replay)) for (const id of ['bowler', 'striker']) expect(same(draw(sa, b.replay, ha, id, t), draw(sc, b.replay, hc, id, t)), `${b.c.name} ${id} t=${t.toFixed(0)}`).toBe(true);
    }
  });

  it('a live result (handed over, plans rebaked in the spare time) draws what its replay draws', () => {
    for (const b of cases()) {
      const live = new DirectorRuntime();
      live.register(b.live, 'live', null);
      live.finish(b.live);
      live.register(b.played, 'result', b.live);
      let clock = 0;
      while (live.work(1, () => (clock += 0.5))) {
        /* the spare time of a few frames */
      }
      const rep = new DirectorRuntime();
      rep.register(b.replay, 'replay', null);
      const s1 = stubStage();
      const s2 = stubStage();
      const h1 = hooksFor(b.played, live);
      const h2 = hooksFor(b.replay, rep);
      for (const t of frames(b.replay)) for (const id of ['bowler', 'striker']) {
        const x = draw(s1, b.played, h1, id, t);
        const y = draw(s2, b.replay, h2, id, t);
        // the bones; the shader's eyes
        expect(same(x, y), `${b.c.name} ${id} t=${t.toFixed(0)}`).toBe(true);
      }
    }
  });

  it('scrubbing is playing: a frame drawn out of order has the head pointing where, and the eyes looking as, the frame drawn in order', () => {
    const b = cases()[2];
    const rt = new DirectorRuntime();
    rt.register(b.replay, 'replay', null);
    const hook = hooksFor(b.replay, rt);
    const ts = frames(b.replay);
    // What the Director controls: where the head points in space (yaw, pitch) and the shader's lids and iris. (The neck's
    // own angles differ with the trunk it counter-rotates, and the trunk's glove lean remembers the frame before it,
    // players.easeLean: that is the stage's, not the Director's.)
    const look = (stage: StageScene, id: string): number[] => {
      const rig = stage.rigOf(id)!;
      rig.root.updateMatrixWorld(true);
      rig.boneMap.head.updateWorldMatrix(true, false);
      const d = new Vector3(0, 0, 1).transformDirection(rig.boneMap.head.matrixWorld);
      return [d.x, d.y, d.z, rig.uniforms.uLidL.value, rig.uniforms.uLidR.value, rig.uniforms.uGaze.value[0], rig.uniforms.uGaze.value[1]];
    };
    const near = (x: number[], y: number[]) => x.every((v, i) => Math.abs(v - y[i]) < (i < 3 ? 1e-5 : 1e-9));
    const free = () => !HEAD.clamped && !HEAD.limited;
    const inOrder = new Map<number, { look: number[]; free: boolean }>();
    const s1 = stubStage();
    for (const t of ts) {
      draw(s1, b.replay, hook, 'striker', t);
      inOrder.set(t, { look: look(s1, 'striker'), free: free() });
    }
    const rt2 = new DirectorRuntime();
    rt2.register(b.replay, 'replay', null);
    const hook2 = hooksFor(b.replay, rt2);
    const s2 = stubStage();
    let freeFrames = 0;
    let worstLimited = 0;
    for (const t of [...ts].reverse()) {
      draw(s2, b.replay, hook2, 'striker', t);
      const was = inOrder.get(t)!;
      const now = look(s2, 'striker');
      if (was.free && free()) {
        // the neck has the range: the head is where the plan says, however the frame was reached
        expect(near(now, was.look), `t=${t.toFixed(0)}`).toBe(true);
        freeFrames++;
      } else {
        // at the neck's range the head is what the trunk leaves, and the finished trunk is path dependent by design: the glove
        // solve's lean is eased frame to frame (players.easeLean) and the arms' elbows remember the frame before (reachIK);
        // measured here at most about 10 degrees apart between a forward and a backward pass over the same second
        worstLimited = Math.max(worstLimited, Math.acos(Math.min(1, now[0] * was.look[0] + now[1] * was.look[1] + now[2] * was.look[2])) * DEG);
      }
    }
    expect(freeFrames).toBeGreaterThan(ts.length / 3);
    expect(worstLimited).toBeLessThan(15);
  });
});

describe('physics: the Director cannot move the feet, the grips, the bat or the release', () => {
  /** Indices of the bones that must be bit-equal: every one but the neck and the head. */
  const BODY = Array.from({ length: BONES }, (_, i) => i).filter((i) => i !== 3 && i !== 4);
  const sameBody = (x: number[], y: number[]) => BODY.every((i) => x[i * 4] === y[i * 4] && x[i * 4 + 1] === y[i * 4 + 1] && x[i * 4 + 2] === y[i * 4 + 2] && x[i * 4 + 3] === y[i * 4 + 3]);

  it("the striker's body, from 600 ms before the release to 800 ms after the stroke, is bit-equal with and without the Director (only the neck, the head and the eyes differ)", () => {
    let frames = 0;
    let headMoved = 0;
    for (const b of cases()) {
      const rt = new DirectorRuntime();
      rt.register(b.replay, 'replay', null);
      const on = hooksFor(b.replay, rt);
      const off = hooksFor(b.replay);
      const s1 = stubStage();
      const s2 = stubStage();
      const sp = b.replay.practice!.director.striker;
      // the trace is on a 60 Hz grid and read linearly between its frames: the window is exact from its first whole frame to its last
      for (let k = Math.ceil((sp.release! - 600) / DT) + 1; k * DT <= sp.strokeEnd! + 800; k++) {
        const t = k * DT;
        const x = draw(s1, b.replay, on, 'striker', t);
        const y = draw(s2, b.replay, off, 'striker', t);
        expect(sameBody(x, y), `${b.c.name} t=${t.toFixed(0)}`).toBe(true);
        if (!same(x.slice(12, 20), y.slice(12, 20))) headMoved++;
        frames++;
      }
    }
    expect(frames).toBeGreaterThan(1000);
    expect(headMoved, 'the head does move (the test sees the Director)').toBeGreaterThan(frames / 4);
  });

  it("the bowler's body, from the run's start to 150 ms after the release, is bit-equal with and without the Director", () => {
    let frames = 0;
    for (const b of cases()) {
      const rt = new DirectorRuntime();
      rt.register(b.live, 'live', null);
      rt.finish(b.live);
      const on = hooksFor(b.live, rt);
      const off = hooksFor(b.live);
      const s1 = stubStage();
      const s2 = stubStage();
      const bs = b.live.practice!.director.bowler;
      for (let k = Math.ceil(bs.runStart! / DT) + 1; k * DT <= bs.release! + 150; k++) {
        const t = k * DT;
        expect(sameBody(draw(s1, b.live, on, 'bowler', t), draw(s2, b.live, off, 'bowler', t)), `${b.c.name} t=${t.toFixed(0)}`).toBe(true);
        frames++;
      }
      // the ball leaves the hand from the same point at the same time
      const h1 = s1.handOf('bowler')!;
      const h2 = s2.handOf('bowler')!;
      expect(h1.distanceTo(h2), b.c.name).toBe(0);
    }
    expect(frames).toBeGreaterThan(500);
  });

  it('every other rig is drawn exactly as before: the keeper, the fielders, the umpires and the non-striker keep the periodic blink', () => {
    const b = cases()[0];
    const rt = new DirectorRuntime();
    rt.register(b.replay, 'replay', null);
    const on = hooksFor(b.replay, rt);
    const off = hooksFor(b.replay);
    const s1 = stubStage();
    const s2 = stubStage();
    const r = b.replay.practice!.releaseScene;
    const others = b.replay.actors.map((a) => a.id).filter((id) => id !== 'bowler' && id !== 'striker');
    expect(others.length).toBeGreaterThan(8);
    for (const t of [r - 500, r, r + 400, r + 1500]) {
      for (const id of others) {
        const x = draw(s1, b.replay, on, id, t);
        expect(same(x, draw(s2, b.replay, off, id, t)), `${id} t=${t}`).toBe(true);
        expect(x[BONES * 4], `${id} keeps its own blink`).toBe(-1);
      }
      for (const id of ['bowler', 'striker']) expect(draw(s1, b.replay, on, id, t)[BONES * 4], `${id} is directed`).toBeGreaterThanOrEqual(0);
    }
  });

  it('with the switch off nothing is drawn differently, and a rig the Director let go of goes back to the periodic blink', () => {
    const b = cases()[3];
    const rt = new DirectorRuntime();
    rt.register(b.replay, 'replay', null);
    const hook = hooksFor(b.replay, rt);
    const plain = hooksFor(b.replay);
    const s1 = stubStage();
    const s2 = stubStage();
    const r = b.replay.practice!.releaseScene;
    expect(draw(s1, b.replay, hook, 'striker', r)[BONES * 4]).toBeGreaterThanOrEqual(0);
    rt.enabled = false;
    for (const t of [r - 300, r + 200, r + 900]) for (const id of ['bowler', 'striker']) expect(same(draw(s1, b.replay, hook, id, t), draw(s2, b.replay, plain, id, t)), `${id} t=${t}`).toBe(true);
    expect(draw(s1, b.replay, hook, 'striker', r)[BONES * 4]).toBe(-1);
    // and a stage that was never given a Director draws as it always did
    const rt2 = new DirectorRuntime();
    rt2.enabled = false;
    rt2.register(b.live, 'live', null);
    rt2.finish(b.live);
    expect(rt2.plansOf(b.live)).toBeNull();
  });
});

describe('the head: where the plan wants it', () => {
  /** The drawn head's line of sight in the role frame (yaw + left, pitch + down), from the rig's bones. */
  function drawnHead(stage: StageScene, id: string, bowler: boolean): [number, number] {
    const rig = stage.rigOf(id)!;
    rig.root.updateMatrixWorld(true);
    const head = rig.boneMap.head;
    head.updateWorldMatrix(true, false);
    const d = new Vector3(0, 0, 1).transformDirection(head.matrixWorld);
    return [(bowler ? Math.atan2(d.x, d.z) : Math.atan2(-d.x, -d.z)) * DEG, Math.atan2(-d.y, Math.hypot(d.x, d.z)) * DEG];
  }

  it('for both hands and both arms, the drawn head is the planned one (to 0.05 degrees) whenever the neck has the range and its speed cap does not hold it, and is nearer it than the trunk left it when not', () => {
    const out = createOut();
    let exact = 0;
    let limited = 0;
    let worstExact = 0;
    for (const b of cases()) {
      const rt = new DirectorRuntime();
      rt.register(b.replay, 'replay', null);
      const hook = hooksFor(b.replay, rt);
      const stage = stubStage();
      const plans = plansOf(rt, b.replay);
      const r = b.replay.practice!.releaseScene;
      for (const [id, plan] of [['bowler', plans.bowler!], ['striker', plans.striker!]] as const) {
        for (let t = r - 900; t <= r + 2600; t += DT * 2) {
          draw(stage, b.replay, hook, id, t);
          const [yaw, pitch] = drawnHead(stage, id, id === 'bowler');
          sample(plan, t, out);
          const full = !HEAD.clamped && !HEAD.limited;
          const err = Math.hypot(yaw - out[CH.headYaw], pitch - out[CH.headPitch]);
          if (full) {
            worstExact = Math.max(worstExact, err);
            exact++;
          } else {
            // the neck is at its range, or its speed cap held it back for a few frames of a trunk that turns faster than the neck
            // may (or a clip pop, which the cap smooths): the head is wherever the neck can reach, inside its range relative to
            // the chest, and catches up
            const rig = stage.rigOf(id)!;
            const qn = rig.bones[3].quaternion;
            const qh = rig.bones[4].quaternion;
            const w = qn.clone().multiply(qh);
            const dd = new Vector3(0, 0, 1).applyQuaternion(w);
            expect(Math.abs(Math.atan2(dd.x, dd.z) * DEG), `${b.c.name} ${id} t=${t}: yaw relative to the chest`).toBeLessThanOrEqual(95);
            const pr = Math.atan2(-dd.y, Math.hypot(dd.x, dd.z)) * DEG;
            expect(pr, `${b.c.name} ${id} t=${t}: pitch relative to the chest`).toBeLessThanOrEqual(58);
            expect(pr, `${b.c.name} ${id} t=${t}: pitch relative to the chest`).toBeGreaterThanOrEqual(-63);
            limited++;
          }
        }
      }
    }
    expect(worstExact).toBeLessThan(0.05);
    expect(exact).toBeGreaterThan(limited);
  });

  it("the bowler's head is within 10 degrees of the batter from the gather to the release, through the real clips and the real pose", () => {
    const out = new Float64Array(2);
    for (const b of cases().filter((x) => x.c.bowler !== FINGER || x.c.name.includes('drive'))) {
      const rt = new DirectorRuntime();
      rt.register(b.live, 'live', null);
      rt.finish(b.live);
      const hook = hooksFor(b.live, rt);
      const stage = stubStage();
      const sp = b.live.practice!.director;
      const eye = sp.strikerEye;
      for (let t = sp.bowler.gather!; t <= sp.bowler.release!; t += DT) {
        draw(stage, b.live, hook, 'bowler', t);
        const [yaw, pitch] = drawnHead(stage, 'bowler', true);
        const rig = stage.rigOf('bowler')!;
        const h = new Vector3().setFromMatrixPosition(rig.boneMap.head.matrixWorld);
        h.y += 0.07 * rig.scale;
        const dx = eye.x - h.x;
        const dz = eye.z - h.z;
        out[0] = Math.atan2(dx, dz) * DEG;
        out[1] = Math.atan2(h.y - eye.y, Math.hypot(dx, dz)) * DEG;
        expect(Math.hypot(yaw - out[0], pitch - out[1]), `${b.c.name} t=${(t - sp.bowler.release!).toFixed(0)}`).toBeLessThan(10);
      }
    }
  });
});

describe('the face: lids, iris and blinks reach the shader as the plan has them', () => {
  it('the lids are the plan\'s (plus the upper lid following a downward look, never more than 0.2), the iris is within the eye, and blinks are not tied to a clock', () => {
    let blinkFrames = 0;
    let frames = 0;
    let follow = 0;
    for (const b of cases().slice(0, 4)) {
      const rt = new DirectorRuntime();
      rt.register(b.replay, 'replay', null);
      const hook = hooksFor(b.replay, rt);
      const stage = stubStage();
      const plans = plansOf(rt, b.replay);
      const out = createOut();
      const r = b.replay.practice!.releaseScene;
      for (const [id, plan] of [['bowler', plans.bowler!], ['striker', plans.striker!]] as const) {
        for (let t = r - 1500; t <= r + 3000; t += DT) {
          draw(stage, b.replay, hook, id, t);
          const u = stage.rigOf(id)!.uniforms;
          sample(plan, t, out);
          // left and right lids differ by their own onset skew; each is the plan's lid plus at most the downward-look closure
          for (const [got, want] of [[u.uLidL.value, out[CH.blinkL]], [u.uLidR.value, out[CH.blinkR]]] as const) {
            expect(got, `${id} t=${t}`).toBeGreaterThanOrEqual(want - 1e-6);
            expect(got, `${id} t=${t}`).toBeLessThanOrEqual(want + 0.21);
            if (got > want + 1e-6) follow++;
          }
          if (u.uLidL.value > 0.5) blinkFrames++;
          // the iris stays inside the eye's two ranges (35 and 28 degrees of a 11.5 mm eyeball: 6.6 and 5.4 mm)
          expect(Math.abs(u.uGaze.value[0]), `${id} t=${t}`).toBeLessThanOrEqual(0.0066 + 1e-6);
          expect(Math.abs(u.uGaze.value[1]), `${id} t=${t}`).toBeLessThanOrEqual(0.0054 + 1e-6);
          frames++;
        }
      }
    }
    expect(blinkFrames, 'some blink is on screen').toBeGreaterThan(0);
    expect(follow, 'the lids follow a downward look at times').toBeGreaterThan(0);
    expect(blinkFrames / frames, 'a blink is a small share of the frames').toBeLessThan(0.15);
  });
});

describe('Reduced Motion', () => {
  it('zero life displacement in every frame, the blinks kept, the head at half the turn, the eyes within 10 degrees', () => {
    let eyeMax = 0;
    for (const b of cases().slice(0, 4)) {
      const rm = new DirectorRuntime();
      rm.reducedMotion = true;
      rm.register(b.replay, 'replay', null);
      const nm = new DirectorRuntime();
      nm.register(b.replay, 'replay', null);
      for (const role of ['bowler', 'striker'] as const) {
        const pr = plansOf(rm, b.replay)[role]!;
        const pn = plansOf(nm, b.replay)[role]!;
        expect(pr.reducedMotion).toBe(true);
        for (let i = 0; i < pr.n; i++) {
          for (const c of [CH.breath, CH.swayX, CH.swayZ, CH.swayRoll]) expect(pr.trace[i * CHANNELS + c], `${role} frame ${i} channel ${c}`).toBe(0);
        }
        // blinks: the lids are the same with and without Reduced Motion
        let lids = 0;
        for (let i = 0; i < pr.n; i++) {
          expect(pr.trace[i * CHANNELS + CH.blinkL]).toBe(pn.trace[i * CHANNELS + CH.blinkL]);
          if (pr.trace[i * CHANNELS + CH.blinkL] > 0) lids++;
        }
        expect(lids, `${role} blinks`).toBeGreaterThan(0);
      }
      const hook = hooksFor(b.replay, rm, true);
      const stage = stubStage();
      const r = b.replay.practice!.releaseScene;
      for (let t = r - 700; t <= r + 2500; t += DT * 2) {
        for (const id of ['bowler', 'striker']) {
          draw(stage, b.replay, hook, id, t);
          eyeMax = Math.max(eyeMax, Math.abs(HEAD.eyeYaw), Math.abs(HEAD.eyePitch));
        }
      }
    }
    expect(eyeMax).toBeLessThanOrEqual(10.2);
  });

  it('the stage closes half the distance to the head in space in Reduced Motion, all of it otherwise, and never past what the plan asks', () => {
    // a head turned 20 degrees left of the target and 8 degrees too high, on a trunk facing the target (bones: identity but the head)
    const bones = (yawDeg: number, pitchDeg: number) => {
      const q = new Float64Array(20);
      for (let i = 0; i < 5; i++) q[i * 4 + 3] = 1;
      const hy = (yawDeg * Math.PI) / 360;
      const hp = (pitchDeg * Math.PI) / 360;
      // head = yaw about y then pitch about x: q = qy * qx
      q[16] = Math.sin(hp) * Math.cos(hy);
      q[17] = Math.cos(hp) * Math.sin(hy);
      q[18] = -Math.sin(hp) * Math.sin(hy);
      q[19] = Math.cos(hp) * Math.cos(hy);
      return q;
    };
    const ch = createOut();
    ch[CH.headYaw] = 0;
    ch[CH.headPitch] = 0;
    for (const bowler of [true, false]) {
      const heading = bowler ? 0 : Math.PI; // the actor faces its opponent (role forward is +z for the bowler, -z for the striker)
      for (const [rm, share] of [[false, 1], [true, 0.5]] as const) {
        const q = bones(20, 8);
        applyHead(q, ch, { heading, bowler }, rm, 1);
        expect(HEAD.dYaw, `${bowler} rm=${rm}`).toBeCloseTo(-20 * share, 2);
        expect(HEAD.dPitch, `${bowler} rm=${rm}`).toBeCloseTo(-8 * share, 2);
        // the head is where it was plus that: look again at the bones just written
        applyHead(q, ch, { heading, bowler }, false, 0);
        expect(Math.abs(HEAD.yaw - 20 * (1 - share)), `${bowler} rm=${rm}: the yaw the head ends at`).toBeLessThan(0.05);
        expect(Math.abs(HEAD.pitch - 8 * (1 - share)), `${bowler} rm=${rm}: the pitch the head ends at`).toBeLessThan(0.05);
      }
    }
    // faded out (w = 0) it does nothing at all
    const q = bones(20, 8);
    const copy = Array.from(q);
    applyHead(q, ch, { heading: 0, bowler: true }, false, 0);
    expect(Array.from(q)).toEqual(copy);
  });

  it('a Reduced Motion change rebakes what is on screen: the quiet plans serve at once, the loud ones are dropped, the new ones swap in', () => {
    const b = cases()[0];
    const rt = new DirectorRuntime();
    rt.register(b.live, 'live', null);
    rt.finish(b.live);
    const hook = hooksFor(b.live, rt);
    const stage = stubStage();
    const r = b.live.practice!.releaseScene;
    draw(stage, b.live, hook, 'striker', r + 100);
    expect(draw(stage, b.live, hook, 'striker', r + 100)[BONES * 4]).toBeGreaterThanOrEqual(0);
    rt.setReducedMotion(true);
    // loud plans must not serve under Reduced Motion: the rig is back on its own blink until the quiet ones are in
    expect(draw(stage, b.live, hook, 'striker', r + 100)[BONES * 4]).toBe(-1);
    let clock = 0;
    while (rt.work(1, () => (clock += 0.5))) {
      /* spare time */
    }
    draw(stage, b.live, hook, 'striker', r + 100);
    expect(plansOf(rt, b.live).striker!.reducedMotion).toBe(true);
    expect(draw(stage, b.live, hook, 'striker', r + 100)[BONES * 4]).toBeGreaterThanOrEqual(0);
  });
});

describe('the scene between balls', () => {
  it('plans arrive in the spare time and fade in; the loop wraps without a step; it is a different scene each time', () => {
    const b = cases()[0];
    const idle = buildPracticeScript({ setup: { field: autoField(b.c.bowler, 'balanced', b.c.hand), bowler: b.c.bowler, conditions: 'balanced', handedness: b.c.hand }, flight: null });
    const rt = new DirectorRuntime();
    rt.register(idle, 'idle', null);
    expect(rt.plansOf(idle)!.bowler).toBeNull();
    const hook = hooksFor(idle, rt);
    const stage = stubStage();
    // before the plans are in, the scene draws as it always did
    expect(draw(stage, idle, hook, 'bowler', 1000)[BONES * 4]).toBe(-1);
    // a scene nobody is looking at is not baked: a delivery does not spend its frames on it
    let clock = 0;
    rt.work(1, () => (clock += 0.25));
    expect(rt.plansOf(idle)!.bowler).toBeNull();
    let slices = 0;
    while (rt.work(1, () => (clock += 0.25), idle)) slices++;
    expect(slices).toBeGreaterThan(3);
    const first = draw(stage, idle, hook, 'bowler', 5000);
    expect(first[BONES * 4]).toBeGreaterThanOrEqual(0);
    // another scene has other draws (the count is part of its key)
    const idle2 = buildPracticeScript({ setup: { field: autoField(b.c.bowler, 'balanced', b.c.hand), bowler: b.c.bowler, conditions: 'balanced', handedness: b.c.hand }, flight: null });
    rt.register(idle2, 'idle', null);
    rt.finish(idle2);
    expect(same(plansOf(rt, idle).bowler!.trace, plansOf(rt, idle2).bowler!.trace)).toBe(false);
    // the wrap: the bones at the end of the loop and at its start differ like two neighbouring frames
    const hook2 = hooksFor(idle2, rt);
    const d = idle2.duration;
    const a = draw(stage, idle2, hook2, 'striker', d - DT);
    const w = draw(stage, idle2, hook2, 'striker', 0);
    const z = draw(stage, idle2, hook2, 'striker', DT);
    const gap = (u: number[], v: number[]) => Math.max(...u.slice(0, BONES * 4).map((x, i) => Math.abs(x - v[i])));
    // the clips loop on their own (the idle clip wraps with the script); the Director adds at most a frame's worth
    expect(gap(a, w)).toBeLessThan(Math.max(0.05, gap(w, z) * 6));
  });
});

describe('the seam: a delivery continues from the head of the scene before it (P3)', () => {
  const smoothstep = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
  const HQ = new Float64Array(20);
  /** Where the head on the rig points now (role frame), measured on the bones, whatever the stage did (so a frame with no head pass is measured too). */
  function headNow(stage: StageScene, script: BallScript, id: 'bowler' | 'striker', t: number): number[] {
    const rig = stage.rigOf(id)!;
    for (let i = 0; i < 5; i++) {
      const q = rig.bones[i].quaternion;
      HQ.set([q.x, q.y, q.z, q.w], i * 4);
    }
    noteDrawn(HQ, { heading: evaluateActor(track(script, id), t).heading, bowler: id === 'bowler' });
    return [DRAWN[id].yaw, DRAWN[id].pitch, DRAWN[id].roll];
  }
  const dist = (a: number[], b: number[]) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));

  /** Draws the idle scene up to `idleAt`, then the live delivery from its start; returns the end of the idle, and per frame the head and the bones. */
  function run(b: Built, seamOn: boolean, idleAt: number) {
    const setup = { field: autoField(b.c.bowler, 'balanced', b.c.hand), bowler: b.c.bowler, conditions: 'balanced' as const, handedness: b.c.hand };
    const idle = buildPracticeScript({ setup, flight: null });
    const rt = new DirectorRuntime();
    rt.seamOn = seamOn;
    rt.register(idle, 'idle', null);
    rt.finish(idle);
    const stage = stubStage();
    const idleHook = hooksFor(idle, rt);
    let h0 = { bowler: [0, 0, 0], striker: [0, 0, 0] };
    for (let t = idleAt - 4 * DT; t <= idleAt; t += DT) {
      for (const id of ['bowler', 'striker'] as const) {
        draw(stage, idle, idleHook, id, t);
        h0 = { ...h0, [id]: headNow(stage, idle, id, t) };
      }
    }
    rt.register(b.live, 'live', null);
    const hook = hooksFor(b.live, rt);
    const out: Record<'bowler' | 'striker', Array<{ t: number; head: number[]; bones: number[] }>> = { bowler: [], striker: [] };
    for (let k = 0; k * DT <= 1000; k++) {
      // the plans are baked in the spare time of the run-up: after the third frame here
      if (k === 3) rt.finish(b.live);
      for (const id of ['bowler', 'striker'] as const) {
        const bones = draw(stage, b.live, hook, id, k * DT);
        out[id].push({ t: k * DT, head: headNow(stage, b.live, id, k * DT), bones });
      }
    }
    return { h0, out };
  }

  it('the first frame of a live delivery has the head the scene before ended with, which it gives back over the first 400 ms; nothing differs from 400 ms on; a replay has no seam', () => {
    let worstPlainJump = 0;
    let worstSeamJump = 0;
    let compared = 0;
    for (const b of cases().slice(0, 4)) {
      for (const idleAt of [6000, 21000, 33000, 47000]) {
        const seamed = run(b, true, idleAt);
        const plain = run(b, false, idleAt);
        for (const id of ['bowler', 'striker'] as const) {
          const s = seamed.out[id];
          const p = plain.out[id];
          const o = seamed.h0[id].map((v, i) => v - p[0].head[i]);
          const jumpPlain = dist(p[0].head, seamed.h0[id]);
          const jumpSeam = dist(s[0].head, seamed.h0[id]);
          worstPlainJump = Math.max(worstPlainJump, jumpPlain);
          worstSeamJump = Math.max(worstSeamJump, jumpSeam);
          // the scene before is the same with the seam on or off
          expect(dist(seamed.h0[id], plain.h0[id])).toBe(0);
          for (let k = 0; k < s.length; k++) {
            const t = s[k].t;
            const k400 = 1 - smoothstep(t / SEAM.ms);
            // the difference from the plain delivery is the offset, a smaller share of it every frame (rate limits and the neck's range may take a little of it)
            for (let c = 0; c < 3; c++) expect(Math.abs(s[k].head[c] - p[k].head[c] - o[c] * k400), `${id} ${b.c.name} idle@${idleAt} t=${t.toFixed(0)} c${c}`).toBeLessThan(1.5);
            // from 400 ms on, every bone and the lids and the iris are bit-equal
            if (t >= SEAM.ms + DT) {
              expect(same(s[k].bones, p[k].bones), `${id} ${b.c.name} t=${t.toFixed(0)}`).toBe(true);
              compared++;
            }
          }
        }
      }
    }
    record('seam', { worstPlainJumpDeg: worstPlainJump, worstSeamJumpDeg: worstSeamJump, framesBitEqualAfter400ms: compared });
    expect(worstSeamJump).toBeLessThan(0.5);
    expect(worstPlainJump).toBeGreaterThan(3); // the pop is there to be found without the seam
    expect(compared).toBeGreaterThan(1000);
  });

  it('is for deliveries only: a result, a replay and a demonstration begin as they always did', () => {
    const b = cases()[0];
    const setup = { field: autoField(b.c.bowler, 'balanced', b.c.hand), bowler: b.c.bowler, conditions: 'balanced' as const, handedness: b.c.hand };
    const idle = buildPracticeScript({ setup, flight: null });
    const fresh = new DirectorRuntime();
    fresh.register(b.replay, 'replay', null);
    fresh.finish(b.replay);
    const afterIdle = new DirectorRuntime();
    afterIdle.register(idle, 'idle', null);
    afterIdle.finish(idle);
    const stage = stubStage();
    for (let t = 3000; t < 3100; t += DT) for (const id of ['bowler', 'striker']) draw(stage, idle, hooksFor(idle, afterIdle), id, t);
    afterIdle.register(b.replay, 'replay', null);
    afterIdle.finish(b.replay);
    const h1 = hooksFor(b.replay, fresh);
    const h2 = hooksFor(b.replay, afterIdle);
    for (let k = 0; k * DT < 1200; k++) for (const id of ['bowler', 'striker']) expect(same(draw(stubStage(), b.replay, h1, id, k * DT), draw(stubStage(), b.replay, h2, id, k * DT))).toBe(true);
  });
});

describe('the face the stage draws (P3)', () => {
  const uExpr = (stage: StageScene, id: string) => [...stage.rigOf(id)!.uniforms.uExpr.value];
  const mag = (v: number[]) => Math.hypot(...v);

  it('concentration as the ball is coming, the effort from the swing and not a frame before it, the reaction after the result; none for a small head', () => {
    const b = cases()[0];
    const rt = new DirectorRuntime();
    rt.register(b.replay, 'replay', null);
    rt.finish(b.replay);
    const hook = hooksFor(b.replay, rt);
    const stage = stubStage();
    const dir = b.replay.practice!.director;
    const R = dir.striker.release!;
    const swing = dir.striker.swing!;
    expect(swing).not.toBeNull();
    // the waiting batter has a neutral face, the batter watching the ball a concentrating one
    draw(stage, b.replay, hook, 'striker', R - 2500);
    expect(mag(uExpr(stage, 'striker'))).toBe(0);
    draw(stage, b.replay, hook, 'striker', R - 250);
    const watching = uExpr(stage, 'striker');
    expect(mag(watching)).toBeGreaterThan(0.1);
    expect(watching[0]).toBeLessThan(0); // the brows come down
    // the effort: the swing's own input; the channel is zero up to it, rises over 120 ms, and the face goes further the same way
    draw(stage, b.replay, hook, 'striker', swing - 10);
    expect(FRAME.head.ch![CH.xEffort]).toBe(0);
    const before = uExpr(stage, 'striker');
    draw(stage, b.replay, hook, 'striker', swing + 60);
    const mid = FRAME.head.ch![CH.xEffort];
    expect(mid).toBeGreaterThan(0.05);
    expect(mid).toBeLessThan(0.6);
    draw(stage, b.replay, hook, 'striker', swing + 200);
    expect(FRAME.head.ch![CH.xEffort]).toBeCloseTo(0.6, 3);
    const effort = uExpr(stage, 'striker');
    expect(effort[3]).toBeGreaterThan(before[3]); // the eyes squeeze
    expect(effort[0]).toBeLessThan(before[0]); // the brows come down further
    // the bowler has no effort face
    draw(stage, b.replay, hook, 'bowler', swing + 200);
    expect(FRAME.head.ch![CH.xEffort]).toBe(0);
    // after the result: a drive for four or more is a smile, not a frown
    const out = dir.striker.outcomeAt!;
    draw(stage, b.replay, hook, 'striker', out + 1800);
    const after = uExpr(stage, 'striker');
    expect(after[1]).toBeGreaterThan(0); // the mouth curves up
    // a head too small to show a face: every expression is zero (eyes and lids go on)
    rt.setHeadPx('striker', 20);
    draw(stage, b.replay, hook, 'striker', out + 1800);
    expect(mag(uExpr(stage, 'striker'))).toBe(0);
    draw(stage, b.replay, hook, 'striker', swing + 200);
    expect(FRAME.head.ch![CH.xEffort]).toBe(0);
    expect(stage.rigOf('striker')!.uniforms.uLidL.value).toBeGreaterThanOrEqual(0);
    // and back, with hysteresis: in at 43.7 px, out at 32.3 px
    rt.setHeadPx('striker', 40);
    draw(stage, b.replay, hook, 'striker', out + 1800);
    expect(mag(uExpr(stage, 'striker'))).toBe(0);
    rt.setHeadPx('striker', 45);
    draw(stage, b.replay, hook, 'striker', out + 1800);
    expect(mag(uExpr(stage, 'striker'))).toBeGreaterThan(0.1);
    rt.setHeadPx('striker', 34);
    draw(stage, b.replay, hook, 'striker', out + 1800);
    expect(mag(uExpr(stage, 'striker'))).toBeGreaterThan(0.1);
    rt.setHeadPx('striker', 32);
    draw(stage, b.replay, hook, 'striker', out + 1800);
    expect(mag(uExpr(stage, 'striker'))).toBe(0);
  });

  it('the live batter has no effort face until his result script takes over, and the effort is the swing\'s, not the result\'s: two results of one swing give the same effort', () => {
    const b = cases()[0];
    const rt = new DirectorRuntime();
    rt.register(b.live, 'live', null);
    rt.finish(b.live);
    const hook = hooksFor(b.live, rt);
    const stage = stubStage();
    const swing = b.played.practice!.director.striker.swing!;
    draw(stage, b.live, hook, 'striker', swing + 200);
    expect(FRAME.head.ch![CH.xEffort]).toBe(0); // a live script has no swing input in it
    const rt2 = new DirectorRuntime();
    rt2.register(b.played, 'result', null);
    rt2.finish(b.played);
    draw(stubStage(), b.played, hooksFor(b.played, rt2), 'striker', swing + 200);
    expect(FRAME.head.ch![CH.xEffort]).toBeCloseTo(0.6, 3);
  });

  it('a rig the Director does not direct keeps the face it had (fielders, keeper, umpires, the non-striker)', () => {
    const b = cases()[0];
    const rt = new DirectorRuntime();
    rt.register(b.replay, 'replay', null);
    rt.finish(b.replay);
    const hook = hooksFor(b.replay, rt);
    const stage = stubStage();
    const other = b.replay.actors.find((a) => a.id !== 'bowler' && a.id !== 'striker')!;
    const t = b.replay.practice!.director.striker.outcomeAt! + 1800;
    stage.poseActor(other, t, KITS2, null, hook);
    expect(mag(uExpr(stage, other.id))).toBe(0);
    expect(stage.rigOf(other.id)!.uniforms.uLidL.value).toBe(-1);
  });
});

describe('rolling laps of the scene between balls (P3)', () => {
  it('the minute never repeats itself: the next lap is baked ahead from another key, the end of one fades into the pre-roll of the next, and a scene that has not baked it wraps as it always did', () => {
    const b = cases()[0];
    const setup = { field: autoField(b.c.bowler, 'balanced', b.c.hand), bowler: b.c.bowler, conditions: 'balanced' as const, handedness: b.c.hand };
    const idle = buildPracticeScript({ setup, flight: null });
    const d = idle.duration;
    const rt = new DirectorRuntime();
    rt.register(idle, 'idle', null);
    rt.finish(idle);
    const hook = hooksFor(idle, rt);
    const stage = stubStage();
    const lap0 = { ...plansOf(rt, idle) };
    // drawing the scene queues the next lap's plans; the spare time bakes them
    draw(stage, idle, hook, 'bowler', 1000);
    draw(stage, idle, hook, 'striker', 1000);
    expect(rt.busy).toBe(true);
    let clock = 0;
    let slices = 0;
    while (rt.work(1, () => (clock += 0.5), idle)) slices++;
    expect(slices).toBeGreaterThan(5);
    // a frame in lap 0, then the wrap, then the same time in lap 1
    const tau = 20_000;
    const in0 = { bowler: draw(stage, idle, hook, 'bowler', tau), striker: draw(stage, idle, hook, 'striker', tau) };
    const gap = (u: number[], v: number[]) => Math.max(...u.slice(0, BONES * 4).map((x, i) => Math.abs(x - v[i])));
    draw(stage, idle, hook, 'bowler', d - DT);
    const before = draw(stage, idle, hook, 'striker', d - DT);
    draw(stage, idle, hook, 'bowler', 0);
    const at0 = draw(stage, idle, hook, 'striker', 0);
    draw(stage, idle, hook, 'bowler', DT);
    const after = draw(stage, idle, hook, 'striker', DT);
    // no step at the wrap beyond what two neighbouring frames do (the clips loop on their own)
    expect(gap(before, at0)).toBeLessThan(Math.max(0.05, gap(at0, after) * 6));
    const lap1 = { ...plansOf(rt, idle) };
    expect(lap1.bowler).not.toBe(lap0.bowler);
    expect(same(lap1.bowler!.trace, lap0.bowler!.trace)).toBe(false);
    const in1 = { bowler: draw(stage, idle, hook, 'bowler', tau), striker: draw(stage, idle, hook, 'striker', tau) };
    // lap 1 is not lap 0 again: the breath and the sway (and the glances) differ at the same scene time
    expect(same(in1.bowler, in0.bowler)).toBe(false);
    expect(same(in1.striker, in0.striker)).toBe(false);
    // and the lap after is another one (the queue goes on)
    draw(stage, idle, hook, 'bowler', 1000);
    expect(rt.busy).toBe(true);
    // a scene whose next lap is not baked in time wraps as before: the same plan again, still without a step
    const rt2 = new DirectorRuntime();
    const idle2 = buildPracticeScript({ setup, flight: null });
    rt2.register(idle2, 'idle', null);
    rt2.finish(idle2);
    const hook2 = hooksFor(idle2, rt2);
    const s2 = stubStage();
    const p2 = plansOf(rt2, idle2).striker;
    const x = draw(s2, idle2, hook2, 'striker', d - DT);
    const y = draw(s2, idle2, hook2, 'striker', 0);
    const z = draw(s2, idle2, hook2, 'striker', DT);
    expect(plansOf(rt2, idle2).striker).toBe(p2);
    expect(gap(x, y)).toBeLessThan(Math.max(0.05, gap(y, z) * 6));
  });
});

describe('nobody freezes after a result (P3)', () => {
  it('in every second of the result script after the stroke and the walk back, the batter\'s and the bowler\'s trunk and head move: the chest, spine, hips and head bones change by at least 0.3 degrees, and the root by 0.5 mm', () => {
    const quietest = { striker: Infinity, bowler: Infinity };
    let windows = 0;
    for (const b of cases()) {
      const rt = new DirectorRuntime();
      rt.register(b.replay, 'replay', null);
      rt.finish(b.replay);
      const hook = hooksFor(b.replay, rt);
      const stage = stubStage();
      const pr = b.replay.practice!;
      const dir = pr.director;
      for (const id of ['striker', 'bowler'] as const) {
        const from = id === 'striker' ? (dir.striker.strokeEnd ?? dir.striker.contact ?? pr.releaseScene) + 1400 : (dir.bowler.followEnd ?? pr.releaseScene + 2500) + 1500;
        const to = b.replay.duration - 100;
        if (to - from < 1500) continue;
        const rows: Array<{ t: number; q: Float64Array; root: number[] }> = [];
        for (let t = from; t <= to; t += DT) {
          draw(stage, b.replay, hook, id, t);
          const rig = stage.rigOf(id)!;
          const q = new Float64Array(5 * 4);
          for (let i = 0; i < 5; i++) q.set([rig.bones[i].quaternion.x, rig.bones[i].quaternion.y, rig.bones[i].quaternion.z, rig.bones[i].quaternion.w], i * 4);
          rows.push({ t, q, root: [rig.root.position.x, rig.bones[0].position.y, rig.root.position.z] });
        }
        const W = Math.round(1000 / DT);
        for (let i0 = 0; i0 + W < rows.length; i0 += 15) {
          let rangeDeg = 0;
          let rangeMm = 0;
          for (let j = i0; j <= i0 + W; j += 3) {
            const a = rows[i0].q;
            const c = rows[j].q;
            for (let bone = 0; bone < 5; bone++) {
              const d = Math.abs(a[bone * 4] * c[bone * 4] + a[bone * 4 + 1] * c[bone * 4 + 1] + a[bone * 4 + 2] * c[bone * 4 + 2] + a[bone * 4 + 3] * c[bone * 4 + 3]);
              rangeDeg = Math.max(rangeDeg, 2 * Math.acos(Math.min(1, d)) * DEG);
            }
            rangeMm = Math.max(rangeMm, 1000 * Math.hypot(rows[j].root[0] - rows[i0].root[0], rows[j].root[1] - rows[i0].root[1], rows[j].root[2] - rows[i0].root[2]));
          }
          windows++;
          quietest[id] = Math.min(quietest[id], Math.max(rangeDeg / 0.3, rangeMm / 0.5));
        }
      }
    }
    record('afterResultQuietestWindowShareOfFloor', { ...quietest, windows });
    expect(windows).toBeGreaterThan(40);
    expect(quietest.striker).toBeGreaterThanOrEqual(1);
    expect(quietest.bowler).toBeGreaterThanOrEqual(1);
  });
});

describe('the neck and the head keep the §9 caps', () => {
  it('they never pass 720 deg/s or change their speed by more than 300 deg/s from one 60 Hz frame to the next, for the striker and the bowler, through the real clips and the real pose', () => {
    // The brake the stage puts on the neck and the head (players.ts HEAD_LIMIT.brake: the striker's always, the bowler's once the ball
    // has left his hand): without it a head swing that ends stops dead from its speed (probe p4-headcaps over the 192-delivery corpus:
    // 22 frames of the striker's neck and head and 93 of the bowler's over the cap, all the bowler's in the follow-through).
    const angle = (a: number[], b: number[], o: number) => 2 * Math.acos(Math.min(1, Math.abs(a[o] * b[o] + a[o + 1] * b[o + 1] + a[o + 2] * b[o + 2] + a[o + 3] * b[o + 3]))) * DEG;
    const worst: Record<string, { speed: number; step: number; at: string }> = { striker: { speed: 0, step: 0, at: '' }, bowler: { speed: 0, step: 0, at: '' } };
    let frames = 0;
    for (const b of cases()) {
      const rt = new DirectorRuntime();
      rt.register(b.replay, 'replay', null);
      const hook = hooksFor(b.replay, rt);
      const r = b.replay.practice!.releaseScene;
      for (const id of ['striker', 'bowler'] as const) {
        const stage = stubStage();
        let prev: number[] | null = null;
        const sp = [Number.NaN, Number.NaN];
        for (let t = r - 600; t <= r + 2600; t += DT) {
          const q = draw(stage, b.replay, hook, id, t);
          if (prev) {
            [12, 16].forEach((o, k) => {
              const now = (angle(q, prev!, o) * 1000) / DT;
              worst[id].speed = Math.max(worst[id].speed, now);
              if (!Number.isNaN(sp[k]) && Math.abs(now - sp[k]) > worst[id].step) {
                worst[id].step = Math.abs(now - sp[k]);
                worst[id].at = `${b.c.name} ${k ? 'head' : 'neck'} at release ${(t - r).toFixed(0)} ms`;
              }
              sp[k] = now;
            });
            frames++;
          }
          prev = q;
        }
      }
    }
    expect(frames).toBeGreaterThan(2000);
    for (const id of ['striker', 'bowler'] as const) {
      expect(worst[id].speed, `${id} speed`).toBeLessThanOrEqual(720);
      expect(worst[id].step, `${id} change of speed (${worst[id].at})`).toBeLessThanOrEqual(300);
    }
  });

  it('and so do they with the fidgets, the glances to the side, the reaction and the shake on: three scenes between balls (60 s each) and the 8 result scripts, to the end of the script', () => {
    const angle = (a: number[], b: number[], o: number) => 2 * Math.acos(Math.min(1, Math.abs(a[o] * b[o] + a[o + 1] * b[o + 1] + a[o + 2] * b[o + 2] + a[o + 3] * b[o + 3]))) * DEG;
    const worst = { speed: 0, step: 0 };
    let frames = 0;
    const measure = (script: BallScript, rt: DirectorRuntime, from: number, to: number) => {
      const hook = hooksFor(script, rt);
      for (const id of ['striker', 'bowler'] as const) {
        const stage = stubStage();
        let prev: number[] | null = null;
        const sp = [Number.NaN, Number.NaN];
        for (let t = from; t <= to; t += DT) {
          const q = draw(stage, script, hook, id, t);
          if (prev) {
            [12, 16].forEach((o, k) => {
              const now = (angle(q, prev!, o) * 1000) / DT;
              worst.speed = Math.max(worst.speed, now);
              if (!Number.isNaN(sp[k])) worst.step = Math.max(worst.step, Math.abs(now - sp[k]));
              sp[k] = now;
            });
            frames++;
          }
          prev = q;
        }
      }
    };
    for (const b of cases().slice(0, 3)) {
      const setup = { field: autoField(b.c.bowler, 'balanced', b.c.hand), bowler: b.c.bowler, conditions: 'balanced' as const, handedness: b.c.hand };
      const idle = buildPracticeScript({ setup, flight: null });
      const rt = new DirectorRuntime();
      rt.register(idle, 'idle', null);
      rt.finish(idle);
      measure(idle, rt, 1000, idle.duration - 100);
    }
    for (const b of cases()) {
      const rt = new DirectorRuntime();
      rt.register(b.replay, 'replay', null);
      rt.finish(b.replay);
      measure(b.replay, rt, b.replay.practice!.releaseScene - 600, b.replay.duration - 100);
    }
    record('capsWithFidgetsAndReactions', { frames, worstSpeedDegS: worst.speed, worstStepDegS: worst.step });
    expect(frames).toBeGreaterThan(30_000);
    expect(worst.speed).toBeLessThanOrEqual(720);
    expect(worst.step).toBeLessThanOrEqual(300);
  });
});

describe("the frames the player's input shows in", () => {
  it("the Director's spare-time bakes leave the first spare slots of a new script to the picture and the reach plan, then work", () => {
    const proto = ThreePracticeStage.prototype as unknown as { idleWork(this: unknown, frame: unknown, budgetMs: number): void; directorWork: unknown; otherWork: unknown };
    const idleWork = proto.idleWork;
    // P3: the Director's work is two calls, the plans with a deadline coming (ahead of the gaze and the reach plan) and the rest (after them)
    let worked = 0;
    let rest = 0;
    const self = { director: { busy: true, urgent: true, workUrgent: () => { worked++; return true; }, workRest: () => { rest++; return true; } }, warmed: new WeakSet(), directorWork: proto.directorWork, otherWork: proto.otherWork };
    const frameOf = (script: object) => ({ script, mode: 'live' });
    const a = { practice: null };
    const b = { practice: null };
    idleWork.call(self, frameOf(a), 3);
    idleWork.call(self, frameOf(a), 3);
    expect(worked).toBe(0);
    idleWork.call(self, frameOf(a), 3);
    expect(worked).toBe(1);
    idleWork.call(self, frameOf(a), 3);
    expect(worked).toBe(2);
    // the result's script (the next one) holds them off again
    idleWork.call(self, frameOf(b), 3);
    idleWork.call(self, frameOf(b), 3);
    expect(worked).toBe(2);
    idleWork.call(self, frameOf(b), 3);
    expect(worked).toBe(3);
    // the rest of the plans takes the spare time the others leave, and never in the held slots
    expect(rest).toBe(3);
    // nothing to bake: nothing is held or spent
    self.director.busy = false;
    idleWork.call(self, frameOf({ practice: null }), 3);
    expect(worked).toBe(3);
    expect(rest).toBe(3);
  });
});

describe('cost', () => {
  it('the two passes cost under 5 microseconds an actor a frame, and nothing is allocated', (ctx) => {
    const b = cases()[0];
    const rt = new DirectorRuntime();
    rt.register(b.live, 'live', null);
    rt.finish(b.live);
    const { life } = rt.hooksFor(b.live);
    const bowler = track(b.live, 'bowler');
    const pose = createPose();
    const q = new Float64Array(20);
    for (let i = 0; i < 5; i++) q[i * 4 + 3] = 1;
    const ch = createOut();
    const r = b.live.practice!.releaseScene;
    // CPU nanoseconds an actor-frame over n calls (tests/unit/support/timing.ts): a busy machine delays the thread, it does not slow it.
    const run = (n: number) => {
      const t0 = cpuMicros();
      for (let i = 0; i < n; i++) {
        const t = r - 2000 + (i % 3000);
        frameBegin('bowler', t, 0.3, false, 1);
        life(bowler, pose, t);
        applyHead(q, FRAME.head.ch ?? ch, { heading: 0.3, bowler: true }, false, 1);
      }
      return ((cpuMicros() - t0) * 1e3) / n;
    };
    const BUDGET_NS = 5_000;
    run(100_000);
    const ns = bestOf(5, () => run(600_000), BUDGET_NS); // the least of up to five rounds
    // The budget is exact. Only an overrun on a machine above load 20 is skipped, by name; a quiet machine fails it.
    skipOverBudgetWhenLoaded(ctx, 'Director stage, life + applyHead nanoseconds an actor-frame', ns, BUDGET_NS, 'ns', loadavg()[0]);
    expect(ns).toBeLessThan(BUDGET_NS);
    // 0 bytes a frame: the heap does not grow over a million and a half calls of both passes
    v8.setFlagsFromString('--expose-gc');
    const gc = vm.runInNewContext('gc') as () => void;
    gc();
    gc();
    const before = process.memoryUsage().heapUsed;
    run(1_500_000);
    gc();
    gc();
    expect(process.memoryUsage().heapUsed - before).toBeLessThan(64 * 1024);
    void FACE;
    void prepare;
  }, 60_000);
});
