/** Tests of the detection metrics (scripts/camera-fixtures/analyse.mjs) on synthetic data with known answers. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyseClip, bestLag, gaps, isValid, LM_INDEX, makeTrace, percentile, TRACE_INDICES } from './analyse.mjs';

const W = 640;
const H = 480;

function landmarks(joints, v = 0.9) {
  const lm = new Array(33 * 4).fill(0);
  for (const [name, idx] of Object.entries(LM_INDEX)) {
    lm[idx * 4] = joints[name][0] / W;
    lm[idx * 4 + 1] = joints[name][1] / H;
    lm[idx * 4 + 3] = v;
  }
  return lm;
}

function truthFrame(i, wristY = 300) {
  return {
    i,
    joints: {
      shoulderL: [360, 200, 2],
      shoulderR: [280, 200, 2],
      elbowL: [370, 260, 2],
      elbowR: [270, 260, 2],
      wristL: [350, wristY, 2],
      wristR: [290, wristY, 2],
    },
  };
}

test('a valid frame needs both shoulders and one wrist', () => {
  const g = truthFrame(0).joints;
  assert.equal(isValid(landmarks(g)), true);
  assert.equal(isValid(landmarks(g, 0.4)), false);
  assert.equal(isValid(null), false);
  const one = landmarks(g);
  one[LM_INDEX.wristL * 4 + 3] = 0.1;
  assert.equal(isValid(one), true);
  one[LM_INDEX.wristR * 4 + 3] = 0.1;
  assert.equal(isValid(one), false);
});

test('runs of missing frames are found, including one at the end', () => {
  assert.deepEqual(gaps([true, false, false, true, false]), [
    { start: 1, length: 2 },
    { start: 4, length: 1 },
  ]);
});

test('a perfect model has no error; a constant offset is bias, not noise', () => {
  const frames = Array.from({ length: 60 }, (_, i) => truthFrame(i));
  const gt = { frames };
  const exact = { landmarks: frames.map((f) => landmarks(f.joints)), width: W, height: H, fps: 30, ms: Array(60).fill(10) };
  let a = analyseClip(exact, gt, { stanceEnd: 1 });
  assert.equal(a.validRate, 1);
  assert.equal(a.longestGapFrames, 0);
  assert.equal(a.shoulderWidthPx, 80);
  assert.equal(a.landmarks.wristL.rmsU, 0);
  assert.equal(a.inferenceMs.p50, 10);
  const shifted = {
    ...exact,
    landmarks: frames.map((f) => landmarks({ ...f.joints, wristL: [f.joints.wristL[0] + 8, f.joints.wristL[1] - 4, 2] })),
  };
  a = analyseClip(shifted, gt, { stanceEnd: 1 });
  assert.equal(a.landmarks.wristL.rmsU, 0, 'a constant offset is removed');
  assert.ok(Math.abs(a.landmarks.wristL.biasU[0] - 0.1) < 1e-6);
  assert.ok(a.landmarks.wristL.rawRmsU > 0.1);
});

test('landmark jitter is measured on the stance, in shoulder widths', () => {
  const frames = Array.from({ length: 60 }, (_, i) => truthFrame(i));
  const gt = { frames };
  // Alternate +-4 px on x: a frame-to-frame step of 8 px, so sigma = 8 / sqrt(2) px = 5.657 px = 0.0707 u (u = 80 px).
  const noisy = { landmarks: frames.map((f, i) => landmarks({ ...f.joints, wristL: [f.joints.wristL[0] + (i % 2 ? 4 : -4), f.joints.wristL[1], 2] })), width: W, height: H, fps: 30 };
  const a = analyseClip(noisy, gt, { stanceEnd: 1 });
  assert.ok(Math.abs(a.landmarks.wristL.stanceJitterU - 0.0707) < 0.001, String(a.landmarks.wristL.stanceJitterU));
  assert.ok(Math.abs(a.landmarks.wristL.rmsU - 0.05) < 0.001);
});

test('a model that follows one frame late has a lag of one frame', () => {
  const n = 90;
  const wristY = (i) => 300 - 100 * Math.sin(((Math.min(Math.max(i - 20, 0), 40) / 40) * Math.PI) / 2) ** 2;
  const frames = Array.from({ length: n }, (_, i) => truthFrame(i, wristY(i)));
  const lag = Array.from({ length: n }, (_, i) => truthFrame(i, wristY(Math.max(0, i - 1))));
  const run = { landmarks: lag.map((f) => landmarks(f.joints)), width: W, height: H, fps: 30 };
  const a = analyseClip(run, { frames }, { stanceEnd: 0.5, strikeFrom: 20 / 30, strikeTo: 62 / 30 });
  assert.ok(Math.abs(a.lag.yFrames - 1) < 0.15, JSON.stringify(a.lag));
  assert.ok(Math.abs(a.lag.yMs - 33.3) < 5);
  assert.equal(bestLag([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0, 10).shift, 0);
});

test('missing frames lower the valid rate and show as a gap', () => {
  const frames = Array.from({ length: 30 }, (_, i) => truthFrame(i));
  const lms = frames.map((f) => landmarks(f.joints));
  [5, 6, 7, 20].forEach((i) => (lms[i] = null));
  const a = analyseClip({ landmarks: lms, width: W, height: H, fps: 30 }, { frames }, {});
  assert.equal(a.validRate, 0.8667);
  assert.equal(a.longestGapFrames, 3);
  assert.deepEqual(a.gapRuns, [3, 1]);
});

test('a clip with nobody in it has no ground truth and no detections', () => {
  const run = { landmarks: Array(30).fill(null), width: W, height: H, fps: 30 };
  const a = analyseClip(run, null);
  assert.equal(a.detectedRate, 0);
  assert.equal(a.validRate, 0);
});

test('the trace keeps seven landmarks of four numbers and is byte-stable', () => {
  const f = truthFrame(0);
  const run = { landmarks: [landmarks(f.joints), null], width: W, height: H, fps: 30 };
  const t1 = makeTrace('x', run);
  const t2 = makeTrace('x', run);
  assert.equal(JSON.stringify(t1), JSON.stringify(t2));
  assert.deepEqual(t1.indices, TRACE_INDICES);
  assert.equal(t1.frames[0].lm.length, 28);
  assert.equal(t1.frames[1].lm, null);
  assert.equal(t1.frames[0].t, 0);
  assert.equal(t1.frames[1].t, 33.33);
  assert.equal(percentile([1, 2, 3, 4, 5], 0.5), 3);
});
