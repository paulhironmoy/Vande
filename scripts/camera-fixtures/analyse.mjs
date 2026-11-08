/**
 * Detection metrics for one clip: the pose model's landmarks against the ground truth the renderer wrote (the picture position of
 * every shoulder, elbow and wrist of the posed body). Pure functions, no browser, so they are unit-tested on synthetic data.
 *
 * A landmark list is the flat [x, y, z, visibility] x 33 of src/input/camera/types.ts (x and y 0..1, y down), or null when no
 * person was found. Ground truth is { i, joints: { shoulderL: [px, py, depth], ... } } per frame (picture pixels, y down).
 * "u" is the player's shoulder width in the picture, CAMERA's unit, taken from the ground truth.
 */
export const LM_INDEX = { shoulderL: 11, shoulderR: 12, elbowL: 13, elbowR: 14, wristL: 15, wristR: 16 };
export const VISIBLE = 0.5; // CAMERA's POSE.minVisibility
export const TRACE_INDICES = [0, 11, 12, 13, 14, 15, 16];

export const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
export const std = (a) => {
  const m = mean(a);
  return a.length ? Math.sqrt(mean(a.map((v) => (v - m) ** 2))) : NaN;
};
export function percentile(a, p) {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  const k = (s.length - 1) * p;
  const lo = Math.floor(k);
  return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (k - lo);
}
const r = (x, n = 4) => (Number.isFinite(x) ? Math.round(x * 10 ** n) / 10 ** n : null);

const vis = (lm, name) => (lm ? lm[LM_INDEX[name] * 4 + 3] : 0);

/** CAMERA's valid frame: both shoulders and at least one wrist seen. */
export function isValid(lm) {
  if (!lm) return false;
  return vis(lm, 'shoulderL') >= VISIBLE && vis(lm, 'shoulderR') >= VISIBLE && (vis(lm, 'wristL') >= VISIBLE || vis(lm, 'wristR') >= VISIBLE);
}

/** Runs of invalid frames: [{ start, length }]. */
export function gaps(valid) {
  const out = [];
  let start = -1;
  valid.forEach((v, i) => {
    if (!v && start < 0) start = i;
    if (v && start >= 0) {
      out.push({ start, length: i - start });
      start = -1;
    }
  });
  if (start >= 0) out.push({ start, length: valid.length - start });
  return out;
}

/** The ground-truth shoulder width in pixels (median over the clip), the unit u. */
export function shoulderWidthPx(gt) {
  const w = gt.frames.map((f) => Math.hypot(f.joints.shoulderL[0] - f.joints.shoulderR[0], f.joints.shoulderL[1] - f.joints.shoulderR[1]));
  return percentile(w, 0.5);
}

function interp(series, x) {
  const i0 = Math.max(0, Math.min(series.length - 1, Math.floor(x)));
  const i1 = Math.min(series.length - 1, i0 + 1);
  return series[i0] + (series[i1] - series[i0]) * Math.min(1, Math.max(0, x - i0));
}

/**
 * Best shift (frames, fractional) of the ground-truth series that matches the model's, over the frames in [from, to): a positive
 * shift means the model's value at frame i is the ground truth of an EARLIER frame, i.e. the model lags.
 */
export function bestLag(model, truth, from, to, range = 3, step = 0.1) {
  let best = { shift: 0, cost: Infinity };
  const steps = Math.round(range / step);
  for (let k = -steps; k <= steps; k++) {
    const s = Math.round(k * step * 1e6) / 1e6;
    let cost = 0;
    let n = 0;
    for (let i = from; i < to; i++) {
      if (model[i] == null || !Number.isFinite(model[i])) continue;
      cost += (model[i] - interp(truth, i - s)) ** 2;
      n++;
    }
    if (n > 3 && cost / n < best.cost) best = { shift: s, cost: cost / n };
  }
  return best;
}

/**
 * @param {{ landmarks: (number[]|null)[], ms?: number[], width: number, height: number, fps: number }} run the model's output
 * @param {{ frames: {i:number, joints:Record<string, number[]>}[] }|null} gt ground truth (null for clips with nobody in them)
 * @param {{ stanceEnd?: number, strikeFrom?: number, strikeTo?: number }} marks seconds
 */
export function analyseClip(run, gt, marks = {}) {
  const n = run.landmarks.length;
  const fps = run.fps;
  const present = run.landmarks.map((l) => l !== null);
  const valid = run.landmarks.map(isValid);
  const out = {
    frames: n,
    detectedRate: r(present.filter(Boolean).length / n),
    validRate: r(valid.filter(Boolean).length / n),
    longestGapFrames: gaps(valid).reduce((m, g) => Math.max(m, g.length), 0),
    gapRuns: gaps(valid).map((g) => g.length),
  };
  if (run.ms?.length) {
    const ms = run.ms.slice(2); // the first two calls include warm-up
    out.inferenceMs = { p50: r(percentile(ms, 0.5), 2), p95: r(percentile(ms, 0.95), 2), p99: r(percentile(ms, 0.99), 2), max: r(Math.max(...ms), 2), warmupFirstTwo: run.ms.slice(0, 2).map((v) => r(v, 1)) };
  }
  const meanVis = [];
  run.landmarks.forEach((l) => {
    if (l) meanVis.push(mean(['shoulderL', 'shoulderR', 'wristL', 'wristR'].map((k) => vis(l, k))));
  });
  out.meanVisibility = r(mean(meanVis));
  if (!gt) return out;

  const u = shoulderWidthPx(gt);
  out.shoulderWidthPx = r(u, 1);
  out.shoulderWidthFrac = r(u / run.width, 4);
  const stanceFrames = Math.max(8, Math.round((marks.stanceEnd ?? 1.0) * fps));
  const per = {};
  for (const [name, idx] of Object.entries(LM_INDEX)) {
    const err = []; // { i, dx, dy } in px, model minus truth
    for (let i = 0; i < n; i++) {
      const l = run.landmarks[i];
      if (!l || l[idx * 4 + 3] < VISIBLE) continue;
      const g = gt.frames[i].joints[name];
      err.push({ i, dx: l[idx * 4] * run.width - g[0], dy: l[idx * 4 + 1] * run.height - g[1] });
    }
    if (err.length < 5) {
      per[name] = { samples: err.length };
      continue;
    }
    const bx = mean(err.map((e) => e.dx));
    const by = mean(err.map((e) => e.dy));
    const res = err.map((e) => Math.hypot(e.dx - bx, e.dy - by));
    const stance = err.filter((e) => e.i < stanceFrames);
    // Frame-to-frame noise: the difference of the error between neighbouring frames, over the stance, /sqrt(2).
    const steps = [];
    for (let k = 1; k < stance.length; k++) if (stance[k].i === stance[k - 1].i + 1) steps.push(Math.hypot(stance[k].dx - stance[k - 1].dx, stance[k].dy - stance[k - 1].dy) / Math.SQRT2);
    per[name] = {
      samples: err.length,
      biasPx: [r(bx, 2), r(by, 2)],
      biasU: [r(bx / u, 4), r(by / u, 4)],
      rawRmsU: r(Math.sqrt(mean(err.map((e) => (e.dx ** 2 + e.dy ** 2)))) / u, 4),
      rmsU: r(Math.sqrt(mean(res.map((v) => v * v))) / u, 4),
      p95U: r(percentile(res, 0.95) / u, 4),
      stanceJitterU: r(Math.sqrt(mean(steps.map((v) => v * v))) / u, 4),
    };
  }
  out.landmarks = per;
  // Lag over the stroke: the mean wrist position of the model against the ground truth.
  const from = Math.round((marks.strikeFrom ?? 0) * fps);
  const to = Math.min(n, Math.round((marks.strikeTo ?? 0) * fps));
  if (to - from > 6) {
    const axis = (k) => {
      const model = run.landmarks.map((l) => {
        if (!l) return null;
        const vals = ['wristL', 'wristR'].filter((w) => vis(l, w) >= VISIBLE).map((w) => l[LM_INDEX[w] * 4 + k] * (k === 0 ? run.width : run.height));
        return vals.length ? mean(vals) : null;
      });
      const truth = gt.frames.map((f) => (f.joints.wristL[k] + f.joints.wristR[k]) / 2);
      // Remove the constant offset first (measured on the still frames before the stroke, so a lag is not mistaken for it).
      const still = model.map((m, i) => (m == null || i >= from ? null : m - truth[i])).filter((v) => v != null);
      const off = still.length ? mean(still) : 0;
      const win = truth.slice(from, to);
      if (std(win) < 1) return null; // the ground truth hardly moves on this axis: a lag cannot be read
      return bestLag(model.map((m) => (m == null ? null : m - off)), truth, from, to);
    };
    const ly = axis(1);
    const lx = axis(0);
    out.lag = {
      strikeWindowS: [r(from / fps, 3), r(to / fps, 3)],
      yFrames: ly ? r(ly.shift, 2) : null,
      yMs: ly ? r((ly.shift * 1000) / fps, 1) : null,
      xFrames: lx ? r(lx.shift, 2) : null,
      xMs: lx ? r((lx.shift * 1000) / fps, 1) : null,
    };
  }
  return out;
}

/** The small trace CAMERA's tests read: 7 landmarks x [x, y, z, visibility] per frame, 4 decimals, null when nobody was found. */
export function makeTrace(clipId, run) {
  return {
    format: 'VANDE-LMTRACE1',
    clip: clipId,
    width: run.width,
    height: run.height,
    fps: run.fps,
    indices: TRACE_INDICES,
    note: 'x and y are fractions of the picture (0..1, y down); z is the model\'s relative depth; v is the visibility. Flat [x, y, z, v] per index. null = no person found.',
    frames: run.landmarks.map((l, i) => ({
      t: Math.round(((i * 1000) / run.fps) * 100) / 100,
      lm: l ? TRACE_INDICES.flatMap((k) => [0, 1, 2, 3].map((c) => Math.round(l[k * 4 + c] * 1e4) / 1e4)) : null,
    })),
  };
}
