/**
 * F6 (the motion reel, 2026-11-07): the game's own `side` replay camera cut the top of the batter's helmet off.
 *
 * Why: `practiceFixedPose` aimed the replay at the CONTACT's height, clamped to 0.2–1.4 m. Every full ball, every miss and
 * every bowled ball is a low contact (or, with no contact, the ball's height at the ideal contact), so the camera pitched
 * down by 10–16° and stood the batter in the top half of the picture: the head point was −4 to 55 px from the top edge of
 * a 412 px picture (checkpoint: 6 to 31 px) and the helmet, 0.24 m above it, was above the edge for much of the replay.
 *
 * The fix looks at a fixed height (`REPLAY_SIDE_AIM_Y`) in landscape, from the same place with the same field of view, so
 * the pitch no longer follows the contact. Portrait (56° vertical) was never cut and keeps its aim.
 *
 * These tests walk whole replays (the window the stage plays, at 60 Hz of scene time) of the striker's real poses and
 * project his head point, the helmet's crown, his soles and the bat's toe through the real camera at the rubric's phone
 * viewports and at portrait ones. They fail if a head point comes within 12% of the picture's height of the top edge, a
 * helmet is cut, his feet or the bat fall off the bottom while he plays from his stance, or the contact and the ball
 * arriving at it leave the picture.
 *
 * Builder measurement on a corpus of this shape (352 deliveries at 120 Hz, 915×412), before → after: the head point's
 * least distance from the top edge −31 px (−7.6%) → 96 px (23.2%); 71,276 of 148,571 in-view frames under 12% → 0; the
 * helmet's crown −89 px → +37 px (9.0%); the feet and the bat's toe above the bottom edge while he plays from his stance
 * 18.8% → 10.2% of the height. Portrait 412×915: 16.6% → 16.6% (untouched, byte-identical frames).
 */
import { describe, expect, it } from 'vitest';
import { Group, PerspectiveCamera, Scene, Vector3, type Mesh } from 'three';
import type { BowlerProfile, Footwork, Handedness, NormalizedSwing, PracticeDeliveryPlan } from '@/contracts/practice';
import { autoField, batTravelMs, flight, resolveDelivery } from '@/physics';
import { idealTimeFor } from '@/physics/bat';
import { BLADE_L, HANDLE_L } from '@/physics/constants';
import { cameraAt, REPLAY_SIDE_AIM_Y, replayShot, type CameraPose } from '@/render3d/core/camera';
import { sampleBall, type BallScript } from '@/render3d/core/choreo';
import { createPose } from '@/render3d/core/clips';
import { PITCH_HALF, POPPING } from '@/render3d/core/ground';
import { PRACTICE_PROFILES } from '@/render3d/core/quality';
import { SKELETON } from '@/render3d/core/skeleton';
import { externalBatPose } from '@/render3d/practice/bat';
import { ballAt, simToScene } from '@/render3d/practice/frame';
import { buildPracticeScript } from '@/render3d/practice/script';
import { replayWarp } from '@/render3d/practice/session';
import { HEAD } from '@/render3d/three/players';
import { StageScene } from '@/render3d/three/stageScene';
import { ThreePracticeStage } from '@/render3d/three/ThreePracticeStage';
import { KITS } from '@/ui/avatar/traits';
import { VIEWPORTS } from './readabilityHarness';

// ---------------------------------------------------------------------------------------------------------------
// The corpus: both hands, pace and spin, right- and left-arm bowlers, a full, a good-length and a short ball, and the
// replays every one of them can become (drives, defences, a pull, a cut, a leave, misses, bowled, lbw, pad and body).
// ---------------------------------------------------------------------------------------------------------------

const BOWLERS: Array<[string, BowlerProfile]> = [
  ['pace-right', { family: 'pace', paceBand: 'fast', arm: 'right', lookSeed: 'f6-pace' }],
  ['pace-left', { family: 'pace', paceBand: 'express', arm: 'left', lookSeed: 'f6-left' }],
  ['spin-right', { family: 'spin', spinType: 'finger', arm: 'right', lookSeed: 'f6-spin' }],
  ['spin-left', { family: 'spin', spinType: 'finger', arm: 'left', lookSeed: 'f6-spinl' }],
];
/** [length m, line m, pace km/h]: a full ball at the stumps, a good-length ball outside off, a short ball on the leg side. */
const BALLS: Array<[number, number, number]> = [[2.6, 0.05, 138], [4.5, 0.45, 132], [6.4, -0.3, 140]];
type Intent = { kind: 'attack' | 'defend'; directionDeg: number; elevation: number; power: number; footwork: Footwork } | null;
const INTENTS: Array<[string, Intent, number]> = [
  ['drive', { kind: 'attack', directionDeg: 10, elevation: 0, power: 0.8, footwork: 'forward' }, 0],
  ['lofted', { kind: 'attack', directionDeg: 12, elevation: 1, power: 0.95, footwork: 'forward' }, 0],
  ['forward defence', { kind: 'defend', directionDeg: 0, elevation: 0, power: 0.3, footwork: 'forward' }, 0],
  ['pull', { kind: 'attack', directionDeg: -80, elevation: 0.2, power: 0.9, footwork: 'back' }, 0],
  ['back defence', { kind: 'defend', directionDeg: 0, elevation: 0, power: 0.3, footwork: 'back' }, 0],
  ['cut', { kind: 'attack', directionDeg: 100, elevation: 0, power: 0.9, footwork: 'back' }, -20],
  ['swung late', { kind: 'attack', directionDeg: 10, elevation: 0, power: 0.8, footwork: 'forward' }, 140],
  ['leave', null, 0],
];

interface Delivery {
  id: string;
  hand: Handedness;
  intent: string;
  /** What the replay shows: the dismissal, else the contact kind (bat, pad, body, miss, leave). */
  kind: string;
  script: BallScript;
}

const built = new Map<Handedness, Delivery[]>();
/** The corpus of one hand (built once: the scripts are read-only, `walk` copies one to give its striker another height). */
function corpus(hands: readonly Handedness[] = ['right', 'left']): Delivery[] {
  return hands.flatMap((hand) => {
    let list = built.get(hand);
    if (!list) built.set(hand, (list = buildCorpus(hand)));
    return list;
  });
}

function buildCorpus(hand: Handedness): Delivery[] {
  const out: Delivery[] = [];
  for (const [bname, bowler] of BOWLERS) {
    for (const [bi, [lengthM, lineM, kph]] of BALLS.entries()) {
      const plan: PracticeDeliveryPlan = { variation: 'stock', lengthM, lineM, speedKph: bowler.family === 'spin' ? Math.round(kph * 0.62) : kph };
      const fl = flight({ plan, bowler, conditions: 'balanced', seed: `f6:${hand}:${bname}:${bi}`, handedness: hand });
      const field = autoField(bowler, 'balanced', hand);
      for (const [iname, intent, errMs] of INTENTS) {
        const swing: NormalizedSwing | null = intent ? { ...intent, startT: idealTimeFor(fl, intent.footwork) - batTravelMs(intent.kind, intent.power) / 1000 + errMs / 1000 } : null;
        const result = resolveDelivery({ flight: fl, swing, field, bowler, conditions: 'balanced', handedness: hand, assist: 'play', tierToleranceMs: 0 });
        const script = buildPracticeScript({ setup: { field, bowler, conditions: 'balanced', handedness: hand }, flight: fl, result });
        const kind = result.outcome.dismissal === 'bowled' || result.outcome.dismissal === 'lbw' ? result.outcome.dismissal : result.contact.kind;
        out.push({ id: `${hand}/${bname}/${lengthM}m/${iname}`, hand, intent: iname, kind, script });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Posing and projecting (no WebGL: the same stub the repo's other stage tests use)
// ---------------------------------------------------------------------------------------------------------------

function stubStage(): StageScene {
  const stage = Object.create(StageScene.prototype) as StageScene;
  Object.assign(stage, {
    scene: new Scene(),
    camera: new PerspectiveCamera(30, 1, 0.1, 1200),
    ballFx: { update: () => undefined },
    stumpsFx: { update: () => undefined },
    eventFx: { update: () => undefined },
    blobs: { begin: () => undefined, end: () => undefined, add: () => undefined },
    stadium: { group: new Group(), setTime: () => undefined, setExcitement: () => undefined, setCrowdMood: () => undefined, setBoardFlash: () => undefined },
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

/** TRACKB's and MOTION's packs loaded and committed for `fn` (the striker is drawn from them), dropped again after it. */
async function withPacks<T>(fn: () => Promise<T>): Promise<T> {
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
    return await fn();
  } finally {
    lib.resetMotionLibrary();
  }
}

/** The pose hook the stage draws a script's batters with (ThreePracticeStage.poseHooks, as drawScript is given it). */
function stageHook(script: BallScript): never {
  const self = { hookCache: new WeakMap(), reducedMotion: false, cueHook: (ThreePracticeStage.prototype as unknown as { cueHook: unknown }).cueHook };
  return (ThreePracticeStage.prototype as unknown as { poseHooks(s: unknown, p: unknown): never }).poseHooks.call(self, script, script.practice!);
}

const KITS_BOTH: [(typeof KITS)[number], (typeof KITS)[number]] = [KITS[0], KITS[1]];
const FRAME_MS = 1000 / 60;

/** The head bone's bind-pose position, and the helmet shell's crown over it (players.ts helmetParts: centre HEAD.c + (0, 0.012, −0.004), half-height 0.134). */
const HEAD_REST = (() => {
  const p = new Vector3();
  for (let name: string | null = 'head'; name; ) {
    const b = SKELETON.find((s) => s.name === name)!;
    p.add(new Vector3(...(b.offset as [number, number, number])));
    name = b.parent;
  }
  return p;
})();
const HELMET_CROWN_REST = new Vector3(0, HEAD.c.y + 0.012 + 0.134, HEAD.c.z - 0.004);
/** The shoe's heel, ball and toe at the sole, in the foot's frame (MOTION-SPEC §9 foot plant). */
const SOLE_POINTS = [new Vector3(0, -0.065, -0.05), new Vector3(0, -0.065, 0.135), new Vector3(0, -0.065, 0.2)];
const BAT_LENGTH = HANDLE_L + BLADE_L;

/** What a replay frame puts on the picture: the striker's points and the ball, in world space. */
interface Frame {
  t: number;
  head: Vector3;
  crown: Vector3;
  soles: Vector3[];
  batToe: Vector3;
  /** How far the striker has moved from where he took his stance (m). */
  moved: number;
  ball: Vector3 | null;
}

/** The striker through the window the stage plays a replay of this script (replayWarp), every 60 Hz frame of scene time. */
function walk(original: BallScript, scale?: number): Frame[] {
  // Another height is another look on a copy of the striker's track (the corpus is shared).
  const script: BallScript = scale === undefined ? original : { ...original, actors: original.actors.map((a) => (a.id === 'striker' ? { ...a, look: { ...a.look, scale } } : a)) };
  const p = script.practice!;
  const striker = script.actors.find((a) => a.id === 'striker')!;
  const hook = stageHook(script);
  const stage = stubStage();
  const w = replayWarp(script, 0.3);
  const start = w.anchors[0][1];
  const end = w.anchors[w.anchors.length - 1][1];
  const frames: Frame[] = [];
  let at: [number, number] | null = null;
  for (let t = start; t <= end + 1e-6; t += FRAME_MS) {
    stage.poseActor(striker, t, KITS_BOTH, externalBatPose(p.bat, striker, t, stage.rigOf('striker')?.scale ?? 1), hook);
    const rig = stage.rigOf('striker')!;
    rig.root.updateMatrixWorld(true);
    const headBone = rig.boneMap.head;
    headBone.updateWorldMatrix(true, false);
    const soles: Vector3[] = [];
    for (const name of ['footL', 'footR'] as const) {
      const foot = rig.boneMap[name];
      foot.updateWorldMatrix(true, false);
      for (const q of SOLE_POINTS) soles.push(q.clone().applyMatrix4(foot.matrixWorld));
    }
    const bat = (stage as unknown as { bats: Map<string, Mesh> }).bats.get('striker')!;
    bat.updateWorldMatrix(true, false);
    const ball = sampleBall(script, t);
    if (!at) at = [rig.root.position.x, rig.root.position.z];
    frames.push({
      t,
      head: new Vector3().setFromMatrixPosition(headBone.matrixWorld),
      crown: HELMET_CROWN_REST.clone().sub(HEAD_REST).applyMatrix4(headBone.matrixWorld),
      soles,
      batToe: new Vector3(0, -BAT_LENGTH, 0).applyMatrix4(bat.matrixWorld),
      moved: Math.hypot(rig.root.position.x - at[0], rig.root.position.z - at[1]),
      ball: ball.visible ? new Vector3(ball.pos.x, ball.pos.y, ball.pos.z) : null,
    });
  }
  return frames;
}

/** The replay's camera as the stage points it (StageScene.drawScript): position, lookAt, vertical field of view, aspect. */
function lens(script: BallScript, w: number, h: number, t = 0): { cam: PerspectiveCamera; pose: CameraPose } {
  const plan = [{ shot: replayShot('side'), atMs: 0, durationMs: script.duration }];
  const pose = cameraAt(script, t, plan, { aspect: w / h, reducedMotion: false });
  const cam = new PerspectiveCamera(pose.fov, w / h, 0.1, 1200);
  cam.position.set(pose.pos.x, pose.pos.y, pose.pos.z);
  cam.lookAt(pose.target.x, pose.target.y, pose.target.z);
  cam.updateMatrixWorld(true);
  return { cam, pose };
}

const tmp = new Vector3();
/** A world point on the picture: fractions of its width and height from the left and the top edge; `front` = ahead of the lens. */
function onPicture(cam: PerspectiveCamera, p: Vector3): { x: number; y: number; front: boolean } {
  tmp.copy(p).applyMatrix4(cam.matrixWorldInverse);
  const front = tmp.z < -0.3;
  tmp.copy(p).project(cam);
  return { x: (tmp.x + 1) / 2, y: (1 - tmp.y) / 2, front };
}

const PORTRAITS = [{ name: '412x915', w: 412, h: 915 }, { name: '390x844', w: 390, h: 844 }, { name: '360x640', w: 360, h: 640 }] as const;
const PICTURES = [...VIEWPORTS, { name: '1024x768', w: 1024, h: 768 }, { name: '800x800', w: 800, h: 800 }, ...PORTRAITS];

interface Worst {
  value: number;
  where: string;
}
const worstOf = (): Worst => ({ value: Infinity, where: '' });
const note = (w: Worst, value: number, where: string) => {
  if (value < w.value) {
    w.value = value;
    w.where = where;
  }
};

interface Measured {
  deliveries: number;
  frames: number;
  /** In-view frames: the head is ahead of the lens and between the picture's left and right edge. */
  inView: number;
  /** Fractions of the picture's height. */
  head: Worst;
  crown: Worst;
  /** The sole points and the bat's toe above the bottom edge while the striker stands where he took his stance (moved < 0.8 m). */
  bottom: Worst;
  kinds: Map<string, number>;
}

function measure(deliveries: Delivery[], pictures: ReadonlyArray<{ name: string; w: number; h: number }>, scale?: number): Measured {
  const m: Measured = { deliveries: deliveries.length, frames: 0, inView: 0, head: worstOf(), crown: worstOf(), bottom: worstOf(), kinds: new Map() };
  for (const d of deliveries) {
    m.kinds.set(`${d.hand} ${d.kind}`, (m.kinds.get(`${d.hand} ${d.kind}`) ?? 0) + 1);
    const frames = walk(d.script, scale);
    for (const pic of pictures) {
      const { cam } = lens(d.script, pic.w, pic.h);
      for (const f of frames) {
        m.frames++;
        const head = onPicture(cam, f.head);
        if (!head.front || head.x < 0 || head.x > 1) continue;
        m.inView++;
        const where = `${d.id} at ${pic.name}, scene ${f.t.toFixed(0)} ms`;
        note(m.head, head.y, where);
        note(m.crown, onPicture(cam, f.crown).y, where);
        if (f.moved < 0.8) {
          let low = -Infinity;
          for (const q of [...f.soles, f.batToe]) {
            const s = onPicture(cam, q);
            if (s.front) low = Math.max(low, s.y);
          }
          note(m.bottom, 1 - low, where);
        }
      }
    }
  }
  return m;
}

/** The corpus is walked once for the headroom tests (a full replay of every delivery, projected at every viewport). */
let walked: Promise<Measured> | null = null;
const nominal = () => (walked ??= withPacks(async () => measure(corpus(), PICTURES)));

describe('the side replay keeps the whole batter in the picture (F6: the aim followed the contact\'s height and cut the helmet off)', () => {
  it('covers every kind of replay, for both hands: bat contacts, edges, misses, a leave, pad and body, lbw and bowled', async () => {
    const m = await nominal();
    for (const hand of ['right', 'left']) {
      for (const kind of ['middle', 'miss', 'leave', 'pad', 'body', 'bowled', 'lbw']) {
        expect(m.kinds.get(`${hand} ${kind}`) ?? 0, `${hand}-handed ${kind} replays in the corpus (the physics changed? choose balls that still make them)`).toBeGreaterThan(0);
      }
    }
    expect(m.deliveries).toBeGreaterThanOrEqual(190);
    // The head leaves the picture sideways only when the batter runs past the camera: most frames count.
    expect(m.inView / m.frames, 'share of frames with the head in the picture').toBeGreaterThan(0.7);
  }, 180_000);

  it('puts the head point at least 12% of the picture\'s height below its top edge in every frame, in landscape and in portrait (F6 gate: 50 px of 412)', async () => {
    const m = await nominal();
    expect(m.head.value, `least head-point distance from the top edge (fraction of the height), worst: ${m.head.where}`).toBeGreaterThanOrEqual(0.12);
  }, 180_000);

  it('keeps the helmet\'s crown inside the picture, with headroom, in every frame (the top of the helmet used to be cut off)', async () => {
    const m = await nominal();
    expect(m.crown.value, `least crown distance from the top edge (fraction of the height), worst: ${m.crown.where}`).toBeGreaterThanOrEqual(0.05);
  }, 180_000);

  it('keeps his feet and the bat\'s toe above the bottom edge while he plays from his stance (the fix must not trade the helmet for his boots)', async () => {
    const m = await nominal();
    expect(m.bottom.value, `least distance of a sole point or the bat's toe from the bottom edge, worst: ${m.bottom.where}`).toBeGreaterThanOrEqual(0.05);
  }, 180_000);

  it('holds for taller and shorter strikers too (the avatar height scale runs 0.95 to 1.05)', async () => {
    await withPacks(async () => {
      for (const scale of [0.95, 1.05]) {
        const some = corpus().filter((_, i) => i % 9 === 0);
        const m = measure(some, PICTURES.filter((p) => ['915x412', '844x390', '412x915'].includes(p.name)), scale);
        expect(m.head.value, `scale ${scale}: head point from the top edge, worst: ${m.head.where}`).toBeGreaterThanOrEqual(0.12);
        expect(m.crown.value, `scale ${scale}: crown from the top edge, worst: ${m.crown.where}`).toBeGreaterThanOrEqual(0.02);
        expect(m.bottom.value, `scale ${scale}: soles and bat toe from the bottom edge, worst: ${m.bottom.where}`).toBeGreaterThanOrEqual(0.05);
      }
    });
  }, 180_000);

  it('still faces the contact and keeps it, and the ball arriving at it, in the picture (the camera\'s job: the incoming path, the bat path and the contact)', async () => {
    await withPacks(async () => {
      let withContact = 0;
      let ideal = 0;
      // Every leave (no contact point: the camera faces where the ball was at the ideal contact) and every third replay besides.
      for (const d of corpus().filter((x, i) => x.intent === 'leave' || i % 3 === 0)) {
        const p = d.script.practice!;
        // The camera faces the contact; with none (a miss, a leave) it faces where the ball was at the ideal contact.
        const point = p.result?.contact.point ?? ballAt(p.flight!.samples, p.flight!.idealContactT);
        if (!point) continue;
        const sceneT = p.contactScene ?? simToScene(p, p.flight!.idealContactT);
        if (p.result?.contact.point) withContact++;
        else ideal++;
        const m = p.mirror ? -1 : 1;
        for (const pic of PICTURES) {
          const { cam } = lens(d.script, pic.w, pic.h);
          const c = onPicture(cam, new Vector3(point.x * m, point.y, point.z));
          const at = `${d.id} at ${pic.name}`;
          expect(c.front, `${at}: the contact is ahead of the lens`).toBe(true);
          expect(Math.abs(c.x - 0.5), `${at}: the camera still faces the contact's side and depth`).toBeLessThan(0.005);
          expect(c.y, `${at}: the contact is 5% or more below the top edge`).toBeGreaterThan(0.05);
          expect(c.y, `${at}: the contact is 5% or more above the bottom edge`).toBeLessThan(0.95);
          // The ball at the contact, and on a phone held sideways (2:1 or wider) 40 ms before it (a ball arrives at 30 to
          // 40 m/s: 1.2 to 1.6 m; narrower pictures see it later, as they always did).
          for (const [ms, phoneLandscapeOnly] of [[0, false], [-40, true]] as const) {
            if (phoneLandscapeOnly && pic.w / pic.h < 2) continue;
            const b = sampleBall(d.script, sceneT + ms);
            const s = onPicture(cam, new Vector3(b.pos.x, b.pos.y, b.pos.z));
            expect(b.visible && s.front && s.x > 0 && s.x < 1 && s.y > 0 && s.y < 1, `${at}: the ball ${ms} ms from the contact is in the picture`).toBe(true);
          }
        }
      }
      expect(withContact, 'deliveries with a contact point').toBeGreaterThan(20);
      expect(ideal, 'deliveries with none (a leave): the ideal contact').toBeGreaterThan(10);
    });
  }, 180_000);
});

describe('the side replay\'s aim (F6 root cause: it was the contact\'s height; and nothing else moved)', () => {
  it('looks at the same height from the same place whatever the contact\'s height, the stroke or the hand in landscape (36°); portrait (56°) keeps looking at the contact', async () => {
    await withPacks(async () => {
      const low = corpus(['right']).find((d) => d.intent === 'drive' && d.id.includes('/2.6m/'))!;
      const high = corpus(['right']).find((d) => d.intent === 'pull' && d.id.includes('/6.4m/'))!;
      const left = corpus(['left']).find((d) => d.intent === 'drive' && d.id.includes('/2.6m/'))!;
      const contactHeight = (d: Delivery) => d.script.practice!.result!.contact.point!.y;
      // A contact well over 40 cm higher than the other: the old aim moved by exactly that much (clamped to 0.2–1.4 m).
      expect(contactHeight(high) - contactHeight(low), 'contact height spread of the two replays').toBeGreaterThan(0.4);
      const crease = PITCH_HALF - POPPING;
      for (const d of [low, high, left]) {
        const m = d.script.practice!.mirror ? -1 : 1;
        const contact = d.script.practice!.result!.contact.point!;
        for (const [w, h, fov] of [[915, 412, 36], [412, 915, 56]] as const) {
          const a = lens(d.script, w, h, 0).pose;
          const b = lens(d.script, w, h, 2500).pose;
          expect(b, `${d.id}: a fixed camera is the same at every scene time`).toEqual(a);
          expect(a.pos, `${d.id}: the camera stays where it was, off side and in front of the batter`).toEqual({ x: 3.4 * m, y: 1.3, z: crease - 2.7 });
          // Landscape: a fixed height. Portrait: the contact's own, 0.2 to 1.4 m, as it always was.
          expect(a.target.y, `${d.id} at ${w}x${h}: the aim`).toBe(w > h ? REPLAY_SIDE_AIM_Y : Math.min(1.4, Math.max(0.2, contact.y)));
          expect(a.fov).toBe(fov);
        }
      }
      // Facing the contact's side and depth is unchanged.
      const p = low.script.practice!;
      const pose = lens(low.script, 915, 412).pose;
      expect(pose.target.x).toBeCloseTo(p.result!.contact.point!.x, 9);
      expect(pose.target.z).toBeCloseTo(p.result!.contact.point!.z, 9);
    });
  }, 180_000);

  it('leaves the other external cameras where they were (they take only the contact\'s side from the shared focus)', async () => {
    await withPacks(async () => {
      for (const d of corpus(['right', 'left']).filter((x) => x.intent === 'drive' && x.id.includes('/4.5m/')).slice(0, 4)) {
        const p = d.script.practice!;
        const m = p.mirror ? -1 : 1;
        const contact = p.result!.contact.point ?? { x: 0, y: 0.5, z: PITCH_HALF - POPPING - 0.6 };
        const fx = contact.x * m;
        const crease = PITCH_HALF - POPPING;
        const at = (shot: 'replay_behind' | 'replay_top' | 'demo_side' | 'practice_stumps') =>
          cameraAt(d.script, 0, [{ shot, atMs: 0, durationMs: d.script.duration }], { aspect: 915 / 412, reducedMotion: false });
        const behind = at('replay_behind');
        expect(behind.pos).toEqual({ x: 0.5 * m, y: 2.5, z: -17.5 });
        expect(behind.target).toEqual({ x: fx * 0.6, y: 0.75, z: crease - 0.6 });
        const top = at('replay_top');
        expect(top.pos).toEqual({ x: 1.0 * m, y: 8.5, z: crease - 4.2 });
        expect(top.target).toEqual({ x: fx * 0.5, y: 0, z: crease - 1.8 });
        const demo = at('demo_side');
        expect(demo.pos).toEqual({ x: 3.6 * m, y: 1.35, z: crease - 2.4 });
        expect(demo.target).toEqual({ x: fx * 0.4 - 0.15 * m, y: 0.8, z: crease - 0.25 });
        const stumps = at('practice_stumps');
        expect(stumps.pos).toEqual({ x: 3.3 * m, y: 1.0, z: PITCH_HALF - 1.5 });
        expect(stumps.target).toEqual({ x: 0, y: 0.38, z: PITCH_HALF + 0.1 });
      }
    });
  }, 180_000);
});
