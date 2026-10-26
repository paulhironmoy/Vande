/**
 * Loudness for the highlight soundtrack and the in-app mix, following ITU-R BS.1770-4 / EBU R 128:
 *   - integrated loudness (LUFS): K-weighting (high shelf + high pass), 400 ms blocks with 75 % overlap, the
 *     absolute gate at -70 LUFS and the relative gate 10 LU below;
 *   - true peak (dBTP): the larger of the sample peak and a 4x oversampled reconstruction (windowed sinc);
 *   - normalise(): gain to a target (YouTube plays at about -14 LUFS) and a look-ahead, true-peak-aware limiter so
 *     the result never exceeds the ceiling (about -1 dBTP leaves room for the AAC encode).
 * Pure functions over Float32Array channels: no Web Audio, so it runs in tests, in Node and in a worker.
 */

export const TARGET_LUFS = -14;
export const CEILING_DBTP = -1;

export interface LoudnessReport {
  /** Integrated loudness, LUFS (-Infinity for silence). */
  integrated: number;
  /** True peak, dBTP. */
  truePeak: number;
  /** Sample peak, dBFS. */
  samplePeak: number;
}

interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/** The two K-weighting stages for any sample rate (the BS.1770 analogue prototypes, as in libebur128). */
export function kWeighting(fs: number): [Biquad, Biquad] {
  // Stage 1: the head's high shelf (+4 dB above ~1.7 kHz).
  let f0 = 1681.974450955533;
  const G = 3.999843853973347;
  let Q = 0.7071752369554196;
  let K = Math.tan((Math.PI * f0) / fs);
  const Vh = 10 ** (G / 20);
  const Vb = Vh ** 0.4996667741545416;
  let a0 = 1 + K / Q + K * K;
  const shelf: Biquad = {
    b0: (Vh + (Vb * K) / Q + K * K) / a0,
    b1: (2 * (K * K - Vh)) / a0,
    b2: (Vh - (Vb * K) / Q + K * K) / a0,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / Q + K * K) / a0,
  };
  // Stage 2: the RLB high pass (~38 Hz).
  f0 = 38.13547087602444;
  Q = 0.5003270373238773;
  K = Math.tan((Math.PI * f0) / fs);
  a0 = 1 + K / Q + K * K;
  const highpass: Biquad = { b0: 1, b1: -2, b2: 1, a1: (2 * (K * K - 1)) / a0, a2: (1 - K / Q + K * K) / a0 };
  return [shelf, highpass];
}

function filter(x: Float32Array, f: Biquad): Float64Array {
  const y = new Float64Array(x.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i];
    const out = f.b0 * v + f.b1 * x1 + f.b2 * x2 - f.a1 * y1 - f.a2 * y2;
    x2 = x1;
    x1 = v;
    y2 = y1;
    y1 = out;
    y[i] = out;
  }
  return y;
}

function filter64(x: Float64Array, f: Biquad): Float64Array {
  const y = new Float64Array(x.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i];
    const out = f.b0 * v + f.b1 * x1 + f.b2 * x2 - f.a1 * y1 - f.a2 * y2;
    x2 = x1;
    x1 = v;
    y2 = y1;
    y1 = out;
    y[i] = out;
  }
  return y;
}

const lufs = (meanSquare: number) => (meanSquare > 0 ? -0.691 + 10 * Math.log10(meanSquare) : -Infinity);

/** Integrated loudness in LUFS (stereo or mono; every channel weighted 1, as for left, right and centre). */
export function integratedLoudness(channels: readonly Float32Array[], fs: number): number {
  const [shelf, hp] = kWeighting(fs);
  const weighted = channels.map((c) => filter64(filter(c, shelf), hp));
  const n = channels[0]?.length ?? 0;
  const block = Math.round(0.4 * fs);
  const hop = Math.round(0.1 * fs);
  if (n < block) {
    // Shorter than one block: the whole signal is the block.
    let z = 0;
    for (const w of weighted) {
      let s = 0;
      for (let i = 0; i < n; i++) s += w[i] * w[i];
      z += n ? s / n : 0;
    }
    return lufs(z);
  }
  // Running sums of squares per channel so each block costs O(channels).
  const prefix = weighted.map((w) => {
    const p = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) p[i + 1] = p[i] + w[i] * w[i];
    return p;
  });
  const blocks: number[] = [];
  for (let start = 0; start + block <= n; start += hop) {
    let z = 0;
    for (const p of prefix) z += (p[start + block] - p[start]) / block;
    blocks.push(z);
  }
  const abs = blocks.filter((z) => lufs(z) > -70);
  if (!abs.length) return -Infinity;
  const relGate = lufs(abs.reduce((a, b) => a + b, 0) / abs.length) - 10;
  const rel = abs.filter((z) => lufs(z) > relGate);
  if (!rel.length) return -Infinity;
  return lufs(rel.reduce((a, b) => a + b, 0) / rel.length);
}

// 4x oversampling: a Hann-windowed sinc over +-6 input samples, one 12-tap phase per fractional position.
const OVERSAMPLE = 4;
const HALF = 6;
const PHASES: Float64Array[] = (() => {
  const phases: Float64Array[] = [];
  for (let p = 1; p < OVERSAMPLE; p++) {
    const frac = p / OVERSAMPLE;
    const taps = new Float64Array(2 * HALF);
    let sum = 0;
    for (let j = 0; j < 2 * HALF; j++) {
      // Input sample k - HALF + 1 + j contributes to the output at k + frac.
      const t = frac + HALF - 1 - j;
      const sinc = t === 0 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t);
      const w = 0.5 + 0.5 * Math.cos((Math.PI * t) / HALF);
      taps[j] = sinc * w;
      sum += taps[j];
    }
    for (let j = 0; j < taps.length; j++) taps[j] /= sum;
    phases.push(taps);
  }
  return phases;
})();

/** Per input sample, the largest reconstructed magnitude in [k, k+1) across channels (linked). */
export function truePeakEnvelope(channels: readonly Float32Array[]): Float32Array {
  const n = channels[0]?.length ?? 0;
  const env = new Float32Array(n);
  for (const x of channels) {
    for (let k = 0; k < n; k++) {
      let m = Math.abs(x[k]);
      if (k >= HALF - 1 && k + HALF < n) {
        const base = k - HALF + 1;
        for (const taps of PHASES) {
          let y = 0;
          for (let j = 0; j < taps.length; j++) y += taps[j] * x[base + j];
          const a = Math.abs(y);
          if (a > m) m = a;
        }
      }
      if (m > env[k]) env[k] = m;
    }
  }
  return env;
}

const db = (v: number) => (v > 0 ? 20 * Math.log10(v) : -Infinity);

export function measure(channels: readonly Float32Array[], fs: number): LoudnessReport {
  let sp = 0;
  for (const c of channels) for (let i = 0; i < c.length; i++) sp = Math.max(sp, Math.abs(c[i]));
  const env = truePeakEnvelope(channels);
  let tp = 0;
  for (let i = 0; i < env.length; i++) if (env[i] > tp) tp = env[i];
  return { integrated: integratedLoudness(channels, fs), truePeak: db(tp), samplePeak: db(sp) };
}

/** Sliding minimum over [i - r, i + r] (monotonic deque, O(n)). */
function slidingMin(v: Float32Array, r: number): Float32Array {
  const n = v.length;
  const out = new Float32Array(n);
  const dq = new Int32Array(n);
  let head = 0;
  let tail = 0;
  let next = 0;
  for (let i = 0; i < n; i++) {
    const hi = Math.min(n - 1, i + r);
    while (next <= hi) {
      while (tail > head && v[dq[tail - 1]] >= v[next]) tail--;
      dq[tail++] = next++;
    }
    while (dq[head] < i - r) head++;
    out[i] = v[dq[head]];
  }
  return out;
}

/** Box average over [i - r, i + r] (edges average what exists). */
function boxAverage(v: Float32Array, r: number): Float32Array {
  const n = v.length;
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + v[i];
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - r);
    const b = Math.min(n, i + r + 1);
    out[i] = (prefix[b] - prefix[a]) / (b - a);
  }
  return out;
}

export interface NormaliseResult {
  channels: Float32Array[];
  /** Gain applied before the limiter, dB. */
  gainDb: number;
  /** The most the limiter took off, dB. */
  limitedDb: number;
  before: LoudnessReport;
  after: LoudnessReport;
}

/**
 * Brings the signal to `target` LUFS with its true peak at or below `ceiling` dBTP. The limiter's gain is the
 * sliding minimum of the gain each sample needs (1.5 ms either side) smoothed by a box of the same width, so it
 * reaches its depth exactly at the peak without clicks, then recovers over ~80 ms. Limiting costs a little
 * loudness, so the gain is re-aimed until the result lands within 0.3 LU of the target (at most a few passes).
 */
export function normalise(channels: readonly Float32Array[], fs: number, opts: { target?: number; ceiling?: number } = {}): NormaliseResult {
  const target = opts.target ?? TARGET_LUFS;
  const ceiling = opts.ceiling ?? CEILING_DBTP;
  const before = measure(channels, fs);
  const n = channels[0]?.length ?? 0;
  if (!Number.isFinite(before.integrated) || n === 0) return { channels: channels.map((c) => c.slice()), gainDb: 0, limitedDb: 0, before, after: before };
  const env = truePeakEnvelope(channels);
  // A little headroom under the ceiling for the gain moving between samples.
  const ceil = 10 ** ((ceiling - 0.1) / 20);
  const r = Math.max(1, Math.round(0.0015 * fs));
  const release = 1 - Math.exp(-1 / (0.08 * fs));
  let gainDb = target - before.integrated;
  let out: Float32Array[] = [];
  let limitedDb = 0;
  let after = before;
  for (let pass = 0; pass < 4; pass++) {
    const g = 10 ** (gainDb / 20);
    const need = new Float32Array(n);
    for (let i = 0; i < n; i++) need[i] = env[i] * g > ceil ? ceil / (env[i] * g) : 1;
    const smooth = boxAverage(slidingMin(need, r), r);
    const curve = new Float32Array(n);
    let level = 1;
    let deepest = 1;
    for (let i = 0; i < n; i++) {
      const s = smooth[i];
      level = s < level ? s : level + (s - level) * release;
      if (level > s) level = s;
      curve[i] = level;
      if (level < deepest) deepest = level;
    }
    out = channels.map((c) => {
      const y = new Float32Array(n);
      for (let i = 0; i < n; i++) y[i] = c[i] * g * curve[i];
      return y;
    });
    limitedDb = -db(deepest);
    after = measure(out, fs);
    const short = target - after.integrated;
    if (Math.abs(short) <= 0.3) break;
    gainDb += short;
  }
  // Belt and braces: the reconstruction can still poke over by a hair where the gain moves fastest.
  if (after.truePeak > ceiling) {
    const trim = 10 ** ((ceiling - after.truePeak - 0.05) / 20);
    for (const c of out) for (let i = 0; i < c.length; i++) c[i] *= trim;
    after = measure(out, fs);
  }
  return { channels: out, gainDb, limitedDb, before, after };
}
