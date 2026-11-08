/**
 * Naturalness metrics for the drawn fielders and keeper (WEB-FIELD), measured on real physics deliveries: each ball
 * is bowled by the physics (`flight`), played with a seeded intent and timing (`playBall`), fielded by the physics,
 * and drawn by the Practice script exactly as the stage draws it (StageScene.poseActor: clip, lower layer,
 * crossfade, then the pose hook), at 60 frames per second.
 *
 * Measured on every fielder and the keeper, from 1.5 s before the release to the end of the scene:
 *  - foot sliding: a foot is planted while its ankle is within PLANT_EPS_M of the lowest ankle (either foot) over a
 *    0.4 s window and is the lower foot; a plant's slide is the furthest its ankle drifts (horizontally) from where it
 *    landed, over the contiguous planted frames;
 *  - pose pops: per-frame joint angular speed of each bone's local rotation (legs and trunk; arms separately);
 *  - heading: per-frame turn rate against the locomotion turn cap for the speed (plus a snap count above 10 rad/s);
 *  - root speed: the per-frame step in ground speed (the physics path, linear between its 0.1 s samples);
 *  - stride timing: cadence (steps/s) of the gait cycle drawn against the ground speed;
 *  - life: the longest stretch a fielder's whole body holds still (no bone turning more than 1.5° over 1 s and the
 *    root not moving), and how many fielders are visibly animated in each ball after the release.
 * Test helper only (never imported by production code).
 */
import type { DeliveryResult } from '@/contracts/practice';
import { type ActorTrack, evaluateActor, lookScale } from '@/render3d/core/actors';
import { clipDuration, createPose, type ClipId, type SampledPose } from '@/render3d/core/clips';
import {
  createJoints,
  createPoseScratch,
  forwardKinematics,
  jointWorld,
  localToWorld,
  palmLocal,
  trackPoseAt,
  turnRateCap,
} from '@/render3d/core/locomotion';
import { BONE_INDEX, BONE_NAMES } from '@/render3d/core/skeleton';
import { buildPracticeScript } from '@/render3d/practice/script';
import { ballAt, simToScene, toWorld } from '@/render3d/practice/frame';
import type { PracticeSceneSetup } from '@/render3d/practice/types';
import type { BallScript } from '@/render3d/core/choreo';
import { overBalls, playBall, type Intent } from '@/practice/game/evaluate';
import { randomOver } from '@/practice/game/overs';
import type { PitchCondition } from '@/contracts/practice';

export const FPS = 60;
/** When the live result script replaces the delivery's first script, after the release (ms): around the swing. */
export const RESULT_AT_MS = 450;
export const PLANT_EPS_M = 0.025;
export type PoseHook = (track: ActorTrack, pose: SampledPose, t: number) => void;

export interface CorpusBall {
  key: string;
  setup: PracticeSceneSetup;
  result: DeliveryResult;
}

const INTENTS: Array<{ name: string; intent: Intent; errorMs: number }> = [
  {
    name: 'drive',
    intent: { kind: 'attack', directionDeg: 10, elevation: 0, power: 0.8, footwork: 'forward' },
    errorMs: 0,
  },
  {
    name: 'cover',
    intent: { kind: 'attack', directionDeg: 45, elevation: 0.1, power: 0.9, footwork: 'forward' },
    errorMs: 15,
  },
  {
    name: 'cut',
    intent: { kind: 'attack', directionDeg: 95, elevation: 0, power: 0.9, footwork: 'back' },
    errorMs: -10,
  },
  {
    name: 'pull',
    intent: { kind: 'attack', directionDeg: -80, elevation: 0.2, power: 0.9, footwork: 'back' },
    errorMs: 10,
  },
  {
    name: 'loft',
    intent: { kind: 'attack', directionDeg: -20, elevation: 0.7, power: 1, footwork: 'forward' },
    errorMs: 0,
  },
  {
    name: 'glance',
    intent: { kind: 'attack', directionDeg: -130, elevation: 0, power: 0.5, footwork: 'back' },
    errorMs: 25,
  },
  {
    name: 'defend',
    intent: { kind: 'defend', directionDeg: 0, elevation: 0, power: 0.3, footwork: 'forward' },
    errorMs: 0,
  },
  {
    name: 'late',
    intent: { kind: 'attack', directionDeg: 30, elevation: 0.1, power: 0.9, footwork: 'forward' },
    errorMs: 70,
  },
  { name: 'leave', intent: null, errorMs: 0 },
];

/** A deterministic corpus: `overs` random overs (pace and spin, every pitch), each ball played with every intent. */
export function corpus(overs = 4, perOver = 2): CorpusBall[] {
  const out: CorpusBall[] = [];
  const pitches: PitchCondition[] = ['balanced', 'green', 'hard', 'turning'];
  for (let i = 0; i < overs; i++) {
    const conditions = pitches[i % pitches.length];
    const family = i % 2 === 0 ? 'pace' : 'spin';
    const over = randomOver({ seed: `web-field|${i}`, conditions, assist: 'play', family });
    const balls = overBalls(over, conditions, i).slice(0, perOver);
    for (const b of balls)
      for (const it of INTENTS) {
        const result = playBall(b, it.intent, it.errorMs, 'play');
        out.push({
          key: `${family}/${conditions}/${b.ballIndex}/${it.name}`,
          setup: { field: b.field, bowler: over.bowler, conditions, handedness: 'right' },
          result,
        });
      }
  }
  return out;
}

export function scriptOf(b: CorpusBall): BallScript {
  return buildPracticeScript({ setup: b.setup, flight: b.result.flight, result: b.result });
}

export interface TrackMetrics {
  id: string;
  plants: number;
  /** Per-plant slide (m), and what the body was doing when the foot landed (gait cycle, hold, one-shot). */
  slides: number[];
  slideKinds: Array<'gait' | 'hold' | 'shot'>;
  /** Seconds after the release with the body visibly moving (a bone turning ≥ 20°/s or the root moving). */
  movingS: number;
  afterS: number;
  /** Planted-foot horizontal speed samples (m/s). */
  slideSpeedMax: number;
  /** Max per-frame angular speed (rad/s): legs and trunk, and arms. */
  bodyAngMax: number;
  armAngMax: number;
  /** Frames over the pop caps. */
  bodyPops: number;
  armPops: number;
  /** Max heading rate (rad/s) and frames over the speed's turn cap (+0.5 rad/s), and snaps over 10 rad/s. */
  turnMax: number;
  turnOverCap: number;
  /** Frames whose 0.1 s mean turn rate exceeds the cap for the 0.1 s mean speed (+0.5 rad/s). */
  turnOverCapWin: number;
  snaps: number;
  /** Max per-frame step in ground speed (m/s), and over 1/30 s windows (MOTION-SPEC v1.2). */
  speedStepMax: number;
  speedStep30Max: number;
  /** Longest whole-body still stretch after the release (s). */
  stillMax: number;
  /** Visibly animated (any bone turning ≥ 10° or the root moving ≥ 0.5 m) after the release. */
  animated: boolean;
  /** (speed m/s, cadence steps/s) pairs for gait-cycle frames. */
  cadence: Array<[number, number]>;
  frames: number;
  /** A few of the worst plants and pops (for diagnosis). */
  examples: string[];
  /**
   * Touching-point slides (MOTION-SPEC §9 on screen): for each foot's heel, ball and tip, the drift from where it first
   * touched while it stays within TOUCH_M of the ground (m), one per touch lasting at least 3 frames.
   */
  touchSlides: number[];
}

/** A shoe point touches the ground within this height (m). */
export const TOUCH_M = 0.012;
const SHOE: ReadonlyArray<readonly [number, number, number]> = [
  [0, -0.065, -0.05],
  [0, -0.065, 0.135],
  [0, -0.065, 0.2],
];
function rotQ(q: Float64Array, o: number, v: readonly [number, number, number]): [number, number, number] {
  const [x, y, z, w] = [q[o], q[o + 1], q[o + 2], q[o + 3]];
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
}

/** Diagnostics only (no metric reads them): which slides and stills `examples` lists. */
export const DIAG = { slideM: 0.1, maxSlides: 6, stills: false, touchM: Infinity, maxTouches: 0 };

/** Caps for a pose pop (rad/s): legs and trunk, arms (a throw's arm is quick). */
export const POP_BODY = 25;
export const POP_ARM = 45;

const LEG_TRUNK = [
  'hips',
  'spine',
  'chest',
  'neck',
  'head',
  'thighL',
  'shinL',
  'footL',
  'thighR',
  'shinR',
  'footR',
].map((n) => BONE_INDEX[n as keyof typeof BONE_INDEX]);
const ARMS = ['upperArmL', 'forearmL', 'handL', 'upperArmR', 'forearmR', 'handR'].map(
  (n) => BONE_INDEX[n as keyof typeof BONE_INDEX],
);
const GAIT_CLIPS = new Set<ClipId>(['walk', 'jog', 'run', 'run_drive', 'keep_shuffle']);
const HOLD_CLIPS = new Set<ClipId>(['idle', 'ready', 'keep_crouch', 'hands_on_hips', 'clap']);

function angleBetween(a: Float32Array, b: Float32Array, i: number): number {
  const d = Math.abs(
    a[i * 4] * b[i * 4] + a[i * 4 + 1] * b[i * 4 + 1] + a[i * 4 + 2] * b[i * 4 + 2] + a[i * 4 + 3] * b[i * 4 + 3],
  );
  return 2 * Math.acos(Math.min(1, d));
}

/** Metrics of one track over [t0, t1] (scene ms), posed as the stage poses it (with `hook` when given). */
export function measureTrack(
  track: ActorTrack,
  t0: number,
  t1: number,
  releaseScene: number,
  hook?: PoseHook,
): TrackMetrics {
  const scratch = createPoseScratch();
  const joints = createJoints();
  const scale = lookScale(track.look);
  const dt = 1000 / FPS;
  const n = Math.floor((t1 - t0) / dt) + 1;
  const ankles: Array<{ L: { x: number; y: number; z: number }; R: { x: number; y: number; z: number } }> = [];
  const kinds: Array<'gait' | 'hold' | 'shot'> = [];
  /** Per shoe point (6): first-touch position and worst drift while touching, and touching frames. */
  const touch = Array.from({ length: 6 }, () => ({ x: 0, z: 0, worst: 0, n: 0 }));
  const labels: string[] = [];
  const prevQ = new Float32Array(BONE_NAMES.length * 4);
  const m: TrackMetrics = {
    id: track.id,
    plants: 0,
    slides: [],
    slideKinds: [],
    movingS: 0,
    afterS: 0,
    slideSpeedMax: 0,
    bodyAngMax: 0,
    armAngMax: 0,
    bodyPops: 0,
    armPops: 0,
    turnMax: 0,
    turnOverCap: 0,
    turnOverCapWin: 0,
    snaps: 0,
    speedStepMax: 0,
    speedStep30Max: 0,
    stillMax: 0,
    animated: false,
    cadence: [],
    frames: n,
    examples: [],
    touchSlides: [],
  };
  let prevHeading = NaN;
  const headHist: Array<{ h: number; x: number; z: number }> = [];
  let prevPos: { x: number; z: number } | null = null;
  let prevSpeed = NaN;
  const pos30: Array<{ x: number; z: number }> = [];
  let prevSpeed30 = NaN;
  // Stillness: a window of poses over 1 s.
  const hist: Float32Array[] = [];
  const posHist: Array<{ x: number; z: number }> = [];
  let still = 0;
  let firstAfter: Float32Array | null = null;
  let firstPos: { x: number; z: number } | null = null;
  const pose0 = createPose();
  for (let k = 0; k < n; k++) {
    const t = t0 + k * dt;
    const st = evaluateActor(track, t);
    const pose = trackPoseAt(track, t, scratch);
    hook?.(track, pose, t);
    const root = { x: st.pos.x + (st.body?.x ?? 0), y: 0, z: st.pos.z + (st.body?.z ?? 0) };
    forwardKinematics(pose, joints);
    ankles.push({
      L: jointWorld(joints, 'footL', root, st.heading, scale),
      R: jointWorld(joints, 'footR', root, st.heading, scale),
    });
    for (let f = 0; f < 2; f++) {
      const bi = BONE_INDEX[f === 0 ? 'footL' : 'footR'];
      for (let q = 0; q < 3; q++) {
        const r = rotQ(joints.q, bi * 4, SHOE[q]);
        const wpt = localToWorld(
          joints.p[bi * 3] + r[0],
          joints.p[bi * 3 + 1] + r[1],
          joints.p[bi * 3 + 2] + r[2],
          root,
          st.heading,
          scale,
        );
        const tc = touch[f * 3 + q];
        if (wpt.y <= TOUCH_M) {
          if (tc.n === 0) {
            tc.x = wpt.x;
            tc.z = wpt.z;
            tc.worst = 0;
          } else tc.worst = Math.max(tc.worst, Math.hypot(wpt.x - tc.x, wpt.z - tc.z));
          tc.n++;
        } else {
          if (tc.n >= 3) {
            m.touchSlides.push(tc.worst);
            if (tc.worst > DIAG.touchM && m.examples.filter((e) => e.startsWith('touch')).length < DIAG.maxTouches)
              m.examples.push(
                `touch ${f ? 'R' : 'L'}${q} ${(tc.worst * 100).toFixed(1)}cm ${tc.n}f ${labels[labels.length - 1 - tc.n] ?? ''} .. ${labels[labels.length - 1] ?? ''}`,
              );
          }
          tc.n = 0;
        }
      }
    }
    labels.push(
      `${st.previous && st.weight < 1 ? st.previous.clip + '>' : ''}${st.current.clip}${st.current.lower ? '/' + st.current.lower : ''}@${(t - releaseScene).toFixed(0)}`,
    );
    kinds.push(
      GAIT_CLIPS.has(st.current.clip) || (st.current.lower && GAIT_CLIPS.has(st.current.lower))
        ? 'gait'
        : HOLD_CLIPS.has(st.current.clip)
          ? 'hold'
          : 'shot',
    );
    if (k > 0) {
      let fastest = 0;
      for (let i = 0; i < BONE_NAMES.length; i++) fastest = Math.max(fastest, angleBetween(prevQ, pose.q, i) * FPS);
      const rootV = Math.hypot(st.pos.x - prevPos!.x, st.pos.z - prevPos!.z) * FPS;
      if (t >= releaseScene) {
        m.afterS += 1 / FPS;
        if (fastest > (20 * Math.PI) / 180 || rootV > 0.2) m.movingS += 1 / FPS;
      }
      for (const i of LEG_TRUNK) {
        const w = angleBetween(prevQ, pose.q, i) * FPS;
        m.bodyAngMax = Math.max(m.bodyAngMax, w);
        if (w > POP_BODY) {
          m.bodyPops++;
          if (m.examples.length < 40)
            m.examples.push(`pop ${BONE_NAMES[i]} ${w.toFixed(0)} ${labels[labels.length - 1]}`);
        }
      }
      for (const i of ARMS) {
        const w = angleBetween(prevQ, pose.q, i) * FPS;
        m.armAngMax = Math.max(m.armAngMax, w);
        if (w > POP_ARM) m.armPops++;
      }
      let dh = st.heading - prevHeading;
      while (dh > Math.PI) dh -= 2 * Math.PI;
      while (dh < -Math.PI) dh += 2 * Math.PI;
      const rate = Math.abs(dh) * FPS;
      const speed = Math.hypot(st.pos.x - prevPos!.x, st.pos.z - prevPos!.z) * FPS;
      m.turnMax = Math.max(m.turnMax, rate);
      if (rate > turnRateCap(speed) + 0.5) m.turnOverCap++;
      if (rate > 10) m.snaps++;
      if (!Number.isNaN(prevSpeed)) m.speedStepMax = Math.max(m.speedStepMax, Math.abs(speed - prevSpeed));
      prevSpeed = speed;
      if (GAIT_CLIPS.has(st.current.clip) && speed > 0.3) {
        const mv = track.moves.find((x) => x.t0 <= t && t < x.t1);
        const rate2 = mv?.rate ?? 1;
        if (st.current.clip !== 'keep_shuffle') m.cadence.push([speed, (2 * rate2) / clipDuration(st.current.clip)]);
      }
    }
    pos30.push({ x: st.pos.x, z: st.pos.z });
    if (k % 2 === 0 && pos30.length >= 3) {
      const a = pos30[pos30.length - 3];
      const b = pos30[pos30.length - 1];
      const v30 = Math.hypot(b.x - a.x, b.z - a.z) * (FPS / 2);
      if (!Number.isNaN(prevSpeed30)) m.speedStep30Max = Math.max(m.speedStep30Max, Math.abs(v30 - prevSpeed30));
      prevSpeed30 = v30;
    }
    headHist.push({ h: st.heading, x: st.pos.x, z: st.pos.z });
    if (headHist.length > 7) headHist.shift();
    if (headHist.length === 7) {
      let dh = headHist[6].h - headHist[0].h;
      while (dh > Math.PI) dh -= 2 * Math.PI;
      while (dh < -Math.PI) dh += 2 * Math.PI;
      const v = Math.hypot(headHist[6].x - headHist[0].x, headHist[6].z - headHist[0].z) * (FPS / 6);
      if (Math.abs(dh) * (FPS / 6) > turnRateCap(v) + 0.5) m.turnOverCapWin++;
    }
    prevQ.set(pose.q);
    prevHeading = st.heading;
    prevPos = { x: st.pos.x, z: st.pos.z };
    if (t >= releaseScene) {
      if (!firstAfter) {
        firstAfter = new Float32Array(pose.q);
        firstPos = { x: st.pos.x, z: st.pos.z };
      } else if (!m.animated) {
        let maxA = 0;
        for (let i = 0; i < BONE_NAMES.length; i++) maxA = Math.max(maxA, angleBetween(firstAfter, pose.q, i));
        if (maxA > (10 * Math.PI) / 180 || Math.hypot(st.pos.x - firstPos!.x, st.pos.z - firstPos!.z) > 0.5)
          m.animated = true;
      }
      hist.push(new Float32Array(pose.q));
      posHist.push({ x: st.pos.x, z: st.pos.z });
      if (hist.length > FPS) {
        hist.shift();
        posHist.shift();
      }
      if (hist.length === FPS) {
        let maxA = 0;
        for (let i = 0; i < BONE_NAMES.length; i++)
          maxA = Math.max(maxA, angleBetween(hist[0], hist[hist.length - 1], i));
        const moved = Math.hypot(
          posHist[0].x - posHist[posHist.length - 1].x,
          posHist[0].z - posHist[posHist.length - 1].z,
        );
        // Also any frame in between: the largest deviation from the window's first pose.
        if (maxA < (1.5 * Math.PI) / 180 && moved < 0.01) {
          let dev = 0;
          for (const h of hist)
            for (let i = 0; i < BONE_NAMES.length; i++) dev = Math.max(dev, angleBetween(hist[0], h, i));
          if (dev < (1.5 * Math.PI) / 180) still = still === 0 ? 1 : still + 1 / FPS;
          else still = 0;
          if (DIAG.stills && still > 1.5 && still - 1 / FPS <= 1.5)
            m.examples.push(`still ${labels[labels.length - 1]}`);
        } else still = 0;
        m.stillMax = Math.max(m.stillMax, still);
      }
    }
  }
  void pose0;
  // Plants: the lower foot within PLANT_EPS_M of the lowest ankle over ±0.2 s.
  const W = Math.round(0.2 * FPS);
  for (const side of ['L', 'R'] as const) {
    const other = side === 'L' ? 'R' : 'L';
    let start = -1;
    let maxDrift = 0;
    for (let k = 0; k <= ankles.length; k++) {
      let planted = false;
      if (k < ankles.length) {
        let lo = Infinity;
        for (let j = Math.max(0, k - W); j <= Math.min(ankles.length - 1, k + W); j++)
          lo = Math.min(lo, ankles[j].L.y, ankles[j].R.y);
        const a = ankles[k][side];
        planted = a.y <= lo + PLANT_EPS_M && a.y <= ankles[k][other].y + 0.005;
      }
      if (planted) {
        if (start < 0) {
          start = k;
          maxDrift = 0;
        } else {
          const a = ankles[k][side];
          const s = ankles[start][side];
          maxDrift = Math.max(maxDrift, Math.hypot(a.x - s.x, a.z - s.z));
          const p = ankles[k - 1][side];
          m.slideSpeedMax = Math.max(m.slideSpeedMax, Math.hypot(a.x - p.x, a.z - p.z) * FPS);
        }
      } else if (start >= 0) {
        if (k - start >= 3) {
          m.plants++;
          m.slides.push(maxDrift);
          m.slideKinds.push(kinds[start]);
          if (maxDrift > DIAG.slideM && m.examples.filter((e) => e.startsWith('slide')).length < DIAG.maxSlides)
            m.examples.push(
              `slide ${side} ${(maxDrift * 100).toFixed(1)}cm ${k - start}f ${labels[start]} .. ${labels[k - 1]}`,
            );
        }
        start = -1;
      }
    }
  }
  return m;
}

/**
 * The held ball's hand at its two physics moments, drawn as the stage draws it (the hook's pose): the catching hand
 * (the keeper's two gloves' midpoint) at each take and the throwing hand at each release, against the physics ball (m).
 */
export function handBallGaps(
  b: CorpusBall,
  script: BallScript,
  hook?: PoseHook,
): { take: number[]; release: number[] } {
  const out = { take: [] as number[], release: [] as number[] };
  const p = script.practice!;
  const sc = createPoseScratch();
  const j = createJoints();
  for (const e of b.result.events) {
    if (e.kind !== 'field' && e.kind !== 'catch' && e.kind !== 'keeper_take' && e.kind !== 'throw') continue;
    // A keeper miss (keeper_take.shortM): no take, no hold; not a hand-to-ball gap.
    if (e.kind === 'keeper_take' && e.shortM) continue;
    const id = e.kind === 'keeper_take' ? 'keeper' : e.fielderId === 'keeper' ? 'keeper' : `fielder:${e.fielderId}`;
    const tr = script.actors.find((a) => a.id === id);
    if (!tr) continue;
    const t = simToScene(p, e.t);
    const st = evaluateActor(tr, t);
    const pose = trackPoseAt(tr, t, sc);
    hook?.(tr, pose, t);
    forwardKinematics(pose, j);
    const scale = lookScale(tr.look);
    const root = { x: st.pos.x + (st.body?.x ?? 0), y: 0, z: st.pos.z + (st.body?.z ?? 0) };
    // At the palm (players.ts ballInHand, where StageScene.handOf draws the held ball).
    const pr = palmLocal(j, 'R');
    const pl = palmLocal(j, 'L');
    const R = localToWorld(pr.x, pr.y, pr.z, root, st.heading, scale);
    const L = localToWorld(pl.x, pl.y, pl.z, root, st.heading, scale);
    // As the stage draws the held ball: at a release the throwing hand (StageScene.handOf('<actor>:throw')), at the
    // keeper's takes the palms' midpoint, at a fielder's take his right hand.
    const hand =
      e.kind === 'throw' || id !== 'keeper' ? R : { x: (L.x + R.x) / 2, y: (L.y + R.y) / 2, z: (L.z + R.z) / 2 };
    const ball = toWorld(ballAt(b.result.ball, e.t)!, p.mirror);
    (e.kind === 'throw' ? out.release : out.take).push(Math.hypot(hand.x - ball.x, hand.y - ball.y, hand.z - ball.z));
  }
  return out;
}

export interface Summary {
  balls: number;
  tracks: number;
  plants: number;
  slideMedianCm: number;
  slideP95Cm: number;
  plantsOver2cmPct: number;
  /** Held ball: hand-to-ball gap at the takes and the releases (count, median cm, p95 cm, % over 3 cm). */
  handAtTake: [number, number, number, number];
  handAtRelease: [number, number, number, number];
  /** Touching-point slides (heel, ball, tip): touches, median and p95 (cm), % over 2 cm. */
  touch: [number, number, number, number];
  /** By what the body was doing at the landing: [plants, median cm, p95 cm, % over 2 cm]. */
  byKind: Record<'gait' | 'hold' | 'shot', [number, number, number, number]>;
  /** Share of the time after the release each fielder is visibly moving: mean over tracks and the lowest track. */
  movingShareMean: number;
  movingShareMin: number;
  slideSpeedMaxMps: number;
  bodyAngMax: number;
  armAngMax: number;
  bodyPopFrames: number;
  armPopFrames: number;
  turnMax: number;
  turnOverCapFrames: number;
  turnOverCapWinFrames: number;
  snapFrames: number;
  speedStepMax: number;
  speedStep30Max: number;
  stillMaxS: number;
  tracksStillOver1_5s: number;
  animatedPerBallMean: number;
  animatedPerBallMin: number;
  fieldersPerBall: number;
  cadenceOutOfBandPct: number;
  frames: number;
}

const pct = (xs: number[], p: number) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))];
};

/** Human cadence band (steps/s) at ground speed v, generous: walking 1.4–2.3, jogging and running 2.3–3.7. */
export function cadenceBand(v: number): [number, number] {
  if (v < 2) return [1.3, 2.3];
  if (v < 4) return [1.9, 3.0];
  return [2.5, 3.7];
}

/** Two measurements of one track joined (the live delivery: the first script before the release, the result's after). */
function join(a: TrackMetrics, b: TrackMetrics): TrackMetrics {
  return {
    ...b,
    plants: a.plants + b.plants,
    slides: [...a.slides, ...b.slides],
    slideKinds: [...a.slideKinds, ...b.slideKinds],
    slideSpeedMax: Math.max(a.slideSpeedMax, b.slideSpeedMax),
    bodyAngMax: Math.max(a.bodyAngMax, b.bodyAngMax),
    armAngMax: Math.max(a.armAngMax, b.armAngMax),
    bodyPops: a.bodyPops + b.bodyPops,
    armPops: a.armPops + b.armPops,
    turnMax: Math.max(a.turnMax, b.turnMax),
    turnOverCap: a.turnOverCap + b.turnOverCap,
    turnOverCapWin: a.turnOverCapWin + b.turnOverCapWin,
    snaps: a.snaps + b.snaps,
    speedStepMax: Math.max(a.speedStepMax, b.speedStepMax),
    speedStep30Max: Math.max(a.speedStep30Max, b.speedStep30Max),
    cadence: [...a.cadence, ...b.cadence],
    frames: a.frames + b.frames,
    examples: [...a.examples, ...b.examples],
    touchSlides: [...a.touchSlides, ...b.touchSlides],
  };
}

/**
 * The corpus summary. `live`: each delivery as the live stage shows it, the delivery's first script (built before the
 * result) up to the release and the result script from it; otherwise the result script alone throughout.
 */
export function summarize(
  balls: CorpusBall[],
  hook?: (script: BallScript) => PoseHook | undefined,
  live = false,
): Summary {
  const all: TrackMetrics[] = [];
  const perBall: number[] = [];
  const takes: number[] = [];
  const releases: number[] = [];
  let fielders = 0;
  for (const b of balls) {
    const script = scriptOf(b);
    const rel = script.practice!.releaseScene;
    const h = hook?.(script);
    const gaps = handBallGaps(b, script, h);
    takes.push(...gaps.take);
    releases.push(...gaps.release);
    const first = live ? buildPracticeScript({ setup: b.setup, flight: b.result.flight }) : null;
    const hf = first ? hook?.(first) : undefined;
    let animated = 0;
    const tracks = script.actors.filter((a) => a.id === 'keeper' || a.id.startsWith('fielder:'));
    fielders = tracks.length;
    for (const tr of tracks) {
      let m: TrackMetrics;
      const ft = first?.actors.find((a) => a.id === tr.id);
      // The result reaches the stage around the swing, about RESULT_AT_MS after the release.
      if (ft)
        m = join(
          measureTrack(ft, Math.max(0, rel - 1500), rel + RESULT_AT_MS - 1, rel, hf),
          measureTrack(tr, rel + RESULT_AT_MS, script.duration - 1, rel, h),
        );
      else m = measureTrack(tr, Math.max(0, rel - 1500), script.duration - 1, rel, h);
      all.push(m);
      if (m.animated) animated++;
    }
    perBall.push(animated);
  }
  const slides = all.flatMap((m) => m.slides);
  const cad = all.flatMap((m) => m.cadence);
  const out = cad.filter(([v, c]) => {
    const [lo, hi] = cadenceBand(v);
    return c < lo || c > hi;
  }).length;
  return {
    balls: balls.length,
    tracks: all.length,
    plants: slides.length,
    slideMedianCm: +(pct(slides, 0.5) * 100).toFixed(2),
    slideP95Cm: +(pct(slides, 0.95) * 100).toFixed(2),
    plantsOver2cmPct: +((100 * slides.filter((s) => s > 0.02).length) / Math.max(1, slides.length)).toFixed(1),
    handAtTake: [
      takes.length,
      +(pct(takes, 0.5) * 100).toFixed(1),
      +(pct(takes, 0.95) * 100).toFixed(1),
      +((100 * takes.filter((x) => x > 0.03).length) / Math.max(1, takes.length)).toFixed(1),
    ],
    handAtRelease: [
      releases.length,
      +(pct(releases, 0.5) * 100).toFixed(1),
      +(pct(releases, 0.95) * 100).toFixed(1),
      +((100 * releases.filter((x) => x > 0.03).length) / Math.max(1, releases.length)).toFixed(1),
    ],
    touch: (() => {
      const xs = all.flatMap((m) => m.touchSlides);
      return [
        xs.length,
        +(pct(xs, 0.5) * 100).toFixed(2),
        +(pct(xs, 0.95) * 100).toFixed(2),
        +((100 * xs.filter((x) => x > 0.02).length) / Math.max(1, xs.length)).toFixed(1),
      ] as [number, number, number, number];
    })(),
    byKind: Object.fromEntries(
      (['gait', 'hold', 'shot'] as const).map((k) => {
        const xs = all.flatMap((m) => m.slides.filter((_, i) => m.slideKinds[i] === k));
        return [
          k,
          [
            xs.length,
            +(pct(xs, 0.5) * 100).toFixed(2),
            +(pct(xs, 0.95) * 100).toFixed(2),
            +((100 * xs.filter((x) => x > 0.02).length) / Math.max(1, xs.length)).toFixed(1),
          ],
        ];
      }),
    ) as Summary['byKind'],
    movingShareMean: +(
      all.reduce((s, m) => s + m.movingS / Math.max(1e-9, m.afterS), 0) / Math.max(1, all.length)
    ).toFixed(3),
    movingShareMin: +Math.min(...all.map((m) => m.movingS / Math.max(1e-9, m.afterS))).toFixed(3),
    slideSpeedMaxMps: +Math.max(0, ...all.map((m) => m.slideSpeedMax)).toFixed(2),
    bodyAngMax: +Math.max(...all.map((m) => m.bodyAngMax)).toFixed(1),
    armAngMax: +Math.max(...all.map((m) => m.armAngMax)).toFixed(1),
    bodyPopFrames: all.reduce((s, m) => s + m.bodyPops, 0),
    armPopFrames: all.reduce((s, m) => s + m.armPops, 0),
    turnMax: +Math.max(...all.map((m) => m.turnMax)).toFixed(2),
    turnOverCapFrames: all.reduce((s, m) => s + m.turnOverCap, 0),
    turnOverCapWinFrames: all.reduce((s, m) => s + m.turnOverCapWin, 0),
    snapFrames: all.reduce((s, m) => s + m.snaps, 0),
    speedStepMax: +Math.max(...all.map((m) => m.speedStepMax)).toFixed(3),
    speedStep30Max: +Math.max(...all.map((m) => m.speedStep30Max)).toFixed(3),
    stillMaxS: +Math.max(...all.map((m) => m.stillMax)).toFixed(2),
    tracksStillOver1_5s: all.filter((m) => m.stillMax > 1.5).length,
    animatedPerBallMean: +(perBall.reduce((a, b) => a + b, 0) / Math.max(1, perBall.length)).toFixed(2),
    animatedPerBallMin: Math.min(...perBall),
    fieldersPerBall: fielders,
    cadenceOutOfBandPct: +((100 * out) / Math.max(1, cad.length)).toFixed(1),
    frames: all.reduce((s, m) => s + m.frames, 0),
  };
}
