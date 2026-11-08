/**
 * Sound-kit signal processing: pure functions over Float32Array/Float64Array samples (no I/O, no clock, no random
 * source), shared by the placeholder generator and the recording ingest.
 *
 *   findOnset        src/audio/takes.ts's onset, ported exactly: the first |x| at or above 0.1 × peak
 *   trimToOnset      keep PREROLL_MS before the onset (the runtime's contact pre-roll), raised-cosine fade-in over it
 *   integratedLufs   ITU-R BS.1770-4 integrated loudness (400 ms blocks, 75 % overlap, −70 LUFS and −10 LU gates)
 *   hitLoudness      the loudest BS.1770 momentary (400 ms) block of a take, zero-padded: defined for any length
 *   noiseFloor       the 10th percentile of 10 ms RMS windows (a measured floor, not an assumed one)
 *   detectHits       split a recording with several hits (2 s apart) into one region per hit
 *
 * The tests check findOnset against takes.ts itself, and the K-weighting against BS.1770's published 48 kHz values.
 */

/** src/audio/takes.ts ONSET_RATIO. */
export const ONSET_RATIO = 0.1;
/** src/audio/recordedManifest.ts contact prerollMs. */
export const PREROLL_MS = 3;
/** The shipped takes' sample-peak cap (REGISTER.md §6; tests/unit/audio/recorded.test.ts). */
export const PEAK_CAP = 0.95;

/** The index of the first sample whose magnitude reaches `ratio` of the peak (0 for silence). Same as takes.ts. */
export function findOnset(data, ratio = ONSET_RATIO) {
  let peak = 0;
  for (let i = 0; i < data.length; i++) {
    const a = Math.abs(data[i]);
    if (a > peak) peak = a;
  }
  if (peak <= 0) return 0;
  const thr = peak * ratio;
  for (let i = 0; i < data.length; i++) if (Math.abs(data[i]) >= thr) return i;
  return 0;
}

export function samplePeak(x) {
  let p = 0;
  for (let i = 0; i < x.length; i++) {
    const a = Math.abs(x[i]);
    if (a > p) p = a;
  }
  return p;
}

export const db = (lin) => (lin > 0 ? 20 * Math.log10(lin) : -Infinity);
export const undb = (d) => 10 ** (d / 20);
export const round = (v, n = 2) => (v === null || !Number.isFinite(v) ? v : Math.round(v * 10 ** n) / 10 ** n);

// ---- BS.1770 ------------------------------------------------------------------------------------------------------

/**
 * The K-weighting pre-filter (high shelf) and RLB high-pass for any sample rate, from the analogue prototype (the
 * libebur128 derivation). At 48 kHz these are BS.1770-4's published coefficients.
 */
export function kWeighting(sr) {
  let f0 = 1681.974450955533;
  const G = 3.999843853973347;
  let Q = 0.7071752369554196;
  let K = Math.tan((Math.PI * f0) / sr);
  const Vh = 10 ** (G / 20);
  const Vb = Vh ** 0.4996667741545416;
  let a0 = 1 + K / Q + K * K;
  const shelf = {
    b: [(Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0],
    a: [1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0],
  };
  f0 = 38.13547087602444;
  Q = 0.5003270373238773;
  K = Math.tan((Math.PI * f0) / sr);
  a0 = 1 + K / Q + K * K;
  const hp = { b: [1, -2, 1], a: [1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0] };
  return [shelf, hp];
}

export function biquad(x, { b, a }) {
  const y = new Float64Array(x.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b[0] * x[i] + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2;
    x2 = x1;
    x1 = x[i];
    y2 = y1;
    y1 = v;
    y[i] = v;
  }
  return y;
}

function kWeighted(x, sr, padS = 0) {
  const n = x.length + Math.ceil(padS * sr);
  const p = new Float64Array(n);
  p.set(x);
  const [shelf, hp] = kWeighting(sr);
  return biquad(biquad(p, shelf), hp);
}

function blockPowers(y, sr, len = y.length) {
  const block = Math.round(0.4 * sr);
  const step = Math.round(0.1 * sr);
  const z = [];
  for (let i = 0; i + block <= len; i += step) {
    let s = 0;
    for (let j = i; j < i + block; j++) s += y[j] * y[j];
    z.push(s / block);
  }
  return z;
}

const lk = (ms) => -0.691 + 10 * Math.log10(ms + 1e-20);

/** BS.1770-4 integrated loudness (mono); null when the signal is shorter than one 400 ms block. */
export function integratedLufs(x, sr) {
  if (x.length < Math.round(0.4 * sr)) return null;
  const y = kWeighted(x, sr);
  let z = blockPowers(y, sr);
  z = z.filter((p) => lk(p) > -70);
  if (!z.length) return -Infinity;
  const rel = lk(z.reduce((s, p) => s + p, 0) / z.length) - 10;
  z = z.filter((p) => lk(p) > rel);
  return lk(z.reduce((s, p) => s + p, 0) / z.length);
}

/**
 * The loudest BS.1770 momentary block (400 ms, 100 ms hop) of a take padded with 400 ms of silence, so the filters'
 * tails count and a take shorter than a block still has one. Used to level short contact takes, which integrated
 * loudness cannot measure.
 */
export function hitLoudness(x, sr) {
  const y = kWeighted(x, sr, 0.4);
  const block = Math.round(0.4 * sr);
  const len = Math.max(block, x.length + block);
  const z = blockPowers(y, sr, Math.min(len, y.length));
  return z.length ? lk(Math.max(...z)) : -Infinity;
}

// ---- shaping ------------------------------------------------------------------------------------------------------

/** Keep `prerollMs` before the onset, fading in over it (a raised cosine), as tools/process_takes.py's transient shape. */
export function trimToOnset(x, sr, prerollMs = PREROLL_MS) {
  const on = findOnset(x);
  const pre = Math.round((prerollMs * sr) / 1000);
  const k = Math.min(pre, on);
  const seg = Float64Array.from(x.subarray(on - k));
  for (let i = 0; i < k; i++) seg[i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / k);
  return { seg, onset: on, pre: k };
}

/** A raised-cosine fade over the last `ms` (in place). */
export function fadeOut(seg, sr, ms) {
  const n = Math.min(seg.length, Math.round((ms * sr) / 1000));
  for (let i = 0; i < n; i++) seg[seg.length - n + i] *= 0.5 + 0.5 * Math.cos((Math.PI * i) / n);
  return seg;
}

/** Cut a take where its tail stays below `belowDb` of its peak (plus `tailMs`), with a fade-out; never under `minMs`. */
export function endOnDecay(seg, sr, { belowDb = -50, tailMs = 5, fadeMs = 15, minMs = 30 } = {}) {
  const thr = samplePeak(seg) * undb(belowDb);
  let last = 0;
  for (let i = seg.length - 1; i >= 0; i--) {
    if (Math.abs(seg[i]) > thr) {
      last = i;
      break;
    }
  }
  const end = Math.min(seg.length, Math.max(Math.round((minMs * sr) / 1000), last + Math.round((tailMs * sr) / 1000)));
  const out = Float64Array.from(seg.subarray(0, end));
  return fadeOut(out, sr, Math.min(fadeMs, (end / sr) * 250));
}

// ---- recordings: noise floor, hits, clipping ----------------------------------------------------------------------

/** RMS of 10 ms windows with a 5 ms hop. */
export function rmsWindows(x, sr, winMs = 10, hopMs = 5) {
  const w = Math.max(1, Math.round((winMs * sr) / 1000));
  const h = Math.max(1, Math.round((hopMs * sr) / 1000));
  const out = [];
  for (let i = 0; i + w <= x.length; i += h) {
    let s = 0;
    for (let j = i; j < i + w; j++) s += x[j] * x[j];
    out.push(Math.sqrt(s / w));
  }
  return { values: out, hop: h, win: w };
}

/** The measured noise floor: the 10th percentile of the 10 ms RMS windows (linear; at least 1e-7, −140 dBFS). */
export function noiseFloor(x, sr) {
  const { values } = rmsWindows(x, sr);
  if (!values.length) return 1e-7;
  const s = [...values].sort((a, b) => a - b);
  return Math.max(1e-7, s[Math.floor(s.length * 0.1)]);
}

/**
 * Splits a recording into hit regions. A region starts where a 1 ms frame's peak rises `detectDb` above the measured
 * floor (and above −60 dBFS) and ends after `gapMs` below that threshold. Returns sample ranges and each region's peak.
 */
export function detectHits(x, sr, { detectDb = 24, gapMs = 150, floor = noiseFloor(x, sr) } = {}) {
  const frame = Math.max(1, Math.round(sr / 1000));
  const thr = Math.max(floor * undb(detectDb), undb(-60));
  const gap = Math.round(gapMs);
  const hits = [];
  let start = -1;
  let lastAbove = -1;
  const frames = Math.ceil(x.length / frame);
  for (let f = 0; f < frames; f++) {
    let p = 0;
    for (let i = f * frame; i < Math.min(x.length, (f + 1) * frame); i++) p = Math.max(p, Math.abs(x[i]));
    if (p >= thr) {
      if (start < 0) start = f;
      lastAbove = f;
    } else if (start >= 0 && f - lastAbove > gap) {
      hits.push([start * frame, Math.min(x.length, (lastAbove + 1) * frame)]);
      start = -1;
    }
  }
  if (start >= 0) hits.push([start * frame, Math.min(x.length, (lastAbove + 1) * frame)]);
  return { floor, threshold: thr, hits: hits.map(([a, b]) => ({ start: a, end: b, peak: samplePeak(x.subarray(a, b)) })) };
}

/**
 * Clipping in [from, to) of any channel: a sample at or above 0.999 of full scale, or a flat top (4 or more equal
 * consecutive samples at 0.5 or more). Returns null when clean, else a reason.
 */
export function clipCheck(channels, from, to) {
  for (let c = 0; c < channels.length; c++) {
    const x = channels[c];
    const a = Math.max(0, from);
    const b = Math.min(x.length, to);
    let run = 1;
    for (let i = a; i < b; i++) {
      const v = Math.abs(x[i]);
      if (v >= 0.999) return `clipped (channel ${c + 1} reaches full scale at ${i})`;
      if (i > a && x[i] === x[i - 1] && v >= 0.5) {
        run++;
        if (run >= 4) return `clipped (channel ${c + 1} has a flat top at ${i})`;
      } else run = 1;
    }
  }
  return null;
}

// ---- deterministic randomness -------------------------------------------------------------------------------------

/** FNV-1a 32 (same as src/audio/takes.ts), for seeds. */
export function fnv1a32(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: a small seeded PRNG, uniform in [0, 1). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
