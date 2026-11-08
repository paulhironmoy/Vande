/**
 * What the camera input makes of each fixture clip: plays the clip's landmarks through the REAL camera pipeline pieces
 * (CameraBatter -> PoseMapper -> GestureTracker -> normalizeGesture, on a simulated clock, src/input/camera/simulate.ts) and writes
 * the swing it produced. Two sources of landmarks, so the effect of the pose model can be read off:
 *   ideal  the clip's own joints projected through the render camera (swing_clips.py `ideal`, no model, no noise);
 *   model  what the pose engine returned on the rendered pictures (measure-detection.mjs `raw/<clip>.landmarks.json`).
 * For each clip and source it reports the swing with the delivery armed at the start of the stance, and a PHASE SWEEP: the clip
 * loops, so a delivery can go live at any point of the loop; for armed windows of 1.5 s, 2.5 s and 4 s it gives the share of
 * start phases (every 0.1 s) in which the first swing is the clip's class. That share is how many deliveries a camera e2e needs.
 *
 *   CLASSIFY_POSES=<dir with <clip>.pose.json> CLASSIFY_RAW=<dir with <clip>.landmarks.json> CLASSIFY_OUT=<file.json>
 *   [CLASSIFY_CLIPS=a,b] npx vitest run --config scripts/camera-fixtures/classify-traces.vitest.config.mjs
 *
 * A measurement on synthetic data. It does not say that anyone can bat with a camera.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'vitest';
import { traceCamera } from '@/input/camera/simulate';
import { LANDMARK_COUNT, LANDMARK_STRIDE, LM, type PoseFrame } from '@/input/camera/types';

const POSES = process.env.CLASSIFY_POSES ?? '';
const RAW = process.env.CLASSIFY_RAW ?? '';
const OUT = process.env.CLASSIFY_OUT ?? '';
const DEFAULT =
  'rh_drive,rh_pull,rh_loft,rh_defence,rh_defence_035,rh_leave,lh_drive,lh_pull,lh_loft,lh_defence,lh_defence_035,lh_leave,rh_drive_near,rh_drive_far,rh_drive_portrait,still';
const CLIPS = (process.env.CLASSIFY_CLIPS ?? DEFAULT).split(',');

interface PoseDoc {
  seconds: number;
  frameCount: number;
  mirrored: boolean;
  stroke: string | null;
  view: string;
  frames: Array<{ ideal: Record<string, [number, number]> }>;
}

const INDEX: Record<string, number> = {
  nose: LM.nose,
  shoulderL: LM.leftShoulder,
  shoulderR: LM.rightShoulder,
  elbowL: LM.leftElbow,
  elbowR: LM.rightElbow,
  wristL: LM.leftWrist,
  wristR: LM.rightWrist,
};
const VIEWS: Record<string, { w: number; h: number }> = { mid: { w: 640, h: 480 }, near: { w: 640, h: 480 }, far: { w: 640, h: 480 }, portrait: { w: 480, h: 640 } };

function idealFrames(doc: PoseDoc, loops: number): PoseFrame[] {
  const { w, h } = VIEWS[doc.view];
  const out: PoseFrame[] = [];
  for (let l = 0; l < loops; l++) {
    doc.frames.forEach((f, i) => {
      const lm = new Float32Array(LANDMARK_COUNT * LANDMARK_STRIDE);
      for (const [name, idx] of Object.entries(INDEX)) {
        const p = f.ideal[name];
        lm[idx * 4] = p[0];
        lm[idx * 4 + 1] = p[1];
        lm[idx * 4 + 3] = 0.99;
      }
      out.push({ t: ((l * doc.frameCount + i) * 1000) / 30, width: w, height: h, landmarks: lm });
    });
  }
  return out;
}

function modelFrames(raw: { landmarks: Array<number[] | null>; width: number; height: number }, loops: number): PoseFrame[] {
  const out: PoseFrame[] = [];
  const n = raw.landmarks.length;
  for (let l = 0; l < loops; l++) {
    raw.landmarks.forEach((lm, i) => {
      out.push({ t: ((l * n + i) * 1000) / 30, width: raw.width, height: raw.height, landmarks: lm ? Float32Array.from(lm) : null });
    });
  }
  return out;
}

const round = (v: number | undefined, n = 3) => (v === undefined ? null : Math.round(v * 10 ** n) / 10 ** n);

function classOf(swing: { kind: string; directionDeg: number; elevation: number } | null): string {
  if (!swing) return 'none';
  if (swing.kind === 'defend') return 'defend';
  return swing.directionDeg > 20 ? 'attack-off' : swing.directionDeg < -20 ? 'attack-leg' : 'attack-straight';
}

const WANT: Record<string, string> = { drive: 'attack-off', pull: 'attack-leg', loft: 'attack-straight', defence: 'defend', defence_035: 'defend', leave: 'none' };

test('what the camera input makes of each clip', () => {
  if (!POSES || !OUT) throw new Error('set CLASSIFY_POSES and CLASSIFY_OUT');
  const results: Record<string, unknown> = {};
  for (const id of CLIPS) {
    const poseFile = path.join(POSES, id + '.pose.json');
    if (!existsSync(poseFile)) continue;
    const doc = JSON.parse(readFileSync(poseFile, 'utf8')) as PoseDoc;
    const hand = id.startsWith('lh_') ? 'left' : 'right';
    const want = doc.stroke ? (id.startsWith('lh_') && doc.stroke === 'pull' ? 'attack-leg' : WANT[doc.stroke]) : 'none';
    const sources: Record<string, (loops: number) => PoseFrame[]> = { ideal: (loops) => idealFrames(doc, loops) };
    const rawFile = RAW ? path.join(RAW, id + '.landmarks.json') : '';
    if (rawFile && existsSync(rawFile)) {
      const raw = JSON.parse(readFileSync(rawFile, 'utf8'));
      sources.model = (loops) => modelFrames(raw, loops);
    }
    const perSource: Record<string, unknown> = {};
    for (const [name, make] of Object.entries(sources)) {
      // One delivery armed after a second of stance, over the whole first loop.
      const one = traceCamera({ frames: make(1), armAtMs: 900, disarmAtMs: 3900, handedness: hand });
      // Three loops; a delivery armed at each start phase of the middle loop for a window of 1.5 s, 2.5 s and 4 s.
      const frames = make(3);
      const loopMs = (doc.frameCount * 1000) / 30;
      const share: Record<string, number> = {};
      const firstClasses: Record<string, Record<string, number>> = {};
      for (const windowS of [1.5, 2.5, 4]) {
        let hit = 0;
        let total = 0;
        const classes: Record<string, number> = {};
        for (let ph = 0; ph < loopMs - 1; ph += 100) {
          const arm = loopMs + ph;
          const r = traceCamera({ frames, armAtMs: arm, disarmAtMs: arm + windowS * 1000, handedness: hand });
          const c = classOf(r.swing);
          classes[c] = (classes[c] ?? 0) + 1;
          if (c === want) hit++;
          total++;
        }
        share[String(windowS)] = round(hit / total, 3) as number;
        firstClasses[String(windowS)] = classes;
      }
      perSource[name] = {
        armedAtStance: one.swing
          ? { kind: one.swing.kind, directionDeg: round(one.swing.directionDeg, 1), power: round(one.swing.power, 3), elevation: round(one.swing.elevation, 3), startT: round(one.swing.startT, 3), class: classOf(one.swing) }
          : null,
        gestures: one.gestureCount,
        wantClass: want,
        shareOfPhasesWithTheRightClassByWindowS: share,
        classesByWindowS: firstClasses,
      };
    }
    results[id] = perSource;
    console.log(id, JSON.stringify(perSource));
  }
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify({ utc: new Date().toISOString(), note: 'synthetic landmarks only (ideal) and the pose engine on rendered pictures (model); not player results', results }, null, 1));
});
