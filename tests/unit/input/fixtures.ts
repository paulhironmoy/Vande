/**
 * Shared fixtures for the input tests (docs/PRACTICE_INPUT.md, "Tests"): a seeded PRNG, stroke shapes, the supported
 * surfaces, digitizer streams with jitter, and one call that plays a stream through the real GestureTracker
 * (src/input/simulate.ts) and normalizes what it emits. Everything is deterministic for a given seed.
 */
import type { Footwork, GestureInput, GestureSample, Handedness, NormalizedSwing } from '@/contracts/practice';
import { normalizeGesture, type NormalizeOptions } from '@/input/normalize';
import { traceGesture, type TraceOptions, type TraceResult } from '@/input/simulate';

/**
 * Gesture surfaces: the lower 46% (GestureSurface's default heightFraction) of the rubric's landscape viewports
 * (ceiling rubric §3), plus the 1280×720 desktop window the examiners' E-PX-001 used.
 */
export const SURFACES = {
  small: { width: 640, height: 360 * 0.46 },
  common: { width: 844, height: 390 * 0.46 },
  phone: { width: 915, height: 412 * 0.46 },
  tablet: { width: 1280, height: 800 * 0.46 },
  desktop: { width: 1280, height: 720 * 0.46 },
  wide: { width: 1920, height: 1080 * 0.46 },
} as const;
export type SurfaceName = keyof typeof SURFACES;

export const RELEASE = 10_000;
export const OPTS: NormalizeOptions = { releasePerfMs: RELEASE, calibrationMs: 0, handedness: 'right' };

/** mulberry32: a small, fast, seeded PRNG (uniform in [0, 1)). */
export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const r = {
    next,
    range: (lo: number, hi: number) => lo + (hi - lo) * next(),
    /** Log-uniform in [lo, hi]. */
    logRange: (lo: number, hi: number) => Math.exp(Math.log(lo) + (Math.log(hi) - Math.log(lo)) * next()),
    int: (lo: number, hi: number) => Math.floor(lo + (hi - lo + 1) * next()),
    pick: <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length) % xs.length],
    gauss: () => {
      let u = 0;
      while (u === 0) u = next();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next());
    },
    chance: (p: number) => next() < p,
  };
  return r;
}
export type Rng = ReturnType<typeof rng>;

/** Progress along the path (0 → 1) at time fraction u: the speed profile of the stroke. */
export const PROFILES = {
  easeOut: (u: number) => 1 - (1 - u) * (1 - u),
  minJerk: (u: number) => u * u * u * (10 - 15 * u + 6 * u * u),
  linear: (u: number) => u,
  easeIn: (u: number) => u * u,
} as const;
export type ProfileName = keyof typeof PROFILES;

export interface Stroke {
  /** Path length (CSS px). */
  lengthPx: number;
  /** Screen bearing of the chord: 0 = up, + = right. */
  bearingDeg: number;
  durationMs: number;
  profile?: ProfileName;
  /** Total turning of the path (deg): a thumb's arc. The chord keeps `bearingDeg`. */
  curveDeg?: number;
  /** The finger rests this long after the press before moving. */
  restMs?: number;
  /** The finger stops and stays this long before lifting (or before the samples end). */
  holdMs?: number;
  /** Digitizer interval (ms). */
  rateMs?: number;
  /** Positional noise per sample (px, σ) and a roll of the contact point at the lift (px). */
  jitterPx?: number;
  liftRollPx?: number;
  x0?: number;
  y0?: number;
}

/** Displacement after a fraction s of the path for a stroke (a circular arc whose chord points along the bearing). */
function along(st: Stroke, s: number): { dx: number; dy: number } {
  const L = st.lengthPx;
  const theta = ((st.curveDeg ?? 0) * Math.PI) / 180;
  const b = (st.bearingDeg * Math.PI) / 180;
  if (Math.abs(theta) < 1e-6) return { dx: Math.sin(b) * L * s, dy: -Math.cos(b) * L * s };
  const a0 = b - theta / 2;
  const a = a0 + theta * s;
  // ∫ L (sin α, −cos α) dσ for α from a0 to a (a circular arc of length L·s).
  return { dx: (L / theta) * (Math.cos(a0) - Math.cos(a)), dy: (L / theta) * (Math.sin(a0) - Math.sin(a)) };
}

/** A digitizer stream for a stroke, from a press at `t0`; the last sample is where the finger lifts. */
export function strokeSamples(st: Stroke, t0: number, r: Rng | null = null): GestureSample[] {
  const rate = st.rateMs ?? 4;
  const x0 = st.x0 ?? 450;
  const y0 = st.y0 ?? 150;
  const rest = st.restMs ?? 0;
  const hold = st.holdMs ?? 0;
  const shape = PROFILES[st.profile ?? 'easeOut'];
  const jit = st.jitterPx ?? 0;
  const noise = () => (r && jit > 0 ? r.gauss() * jit : 0);
  const at = (t: number): GestureSample => {
    const u = t <= t0 + rest ? 0 : Math.min(1, (t - t0 - rest) / st.durationMs);
    const d = along(st, shape(u));
    return { t, x: x0 + d.dx + noise(), y: y0 + d.dy + noise() };
  };
  const out: GestureSample[] = [{ t: t0, x: x0, y: y0 }];
  const end = t0 + rest + st.durationMs + hold;
  for (let k = 1; t0 + k * rate < end - 1e-9; k++) out.push(at(t0 + k * rate));
  const last = at(end);
  if (r && st.liftRollPx) {
    const a = r.range(0, 2 * Math.PI);
    last.x += Math.cos(a) * st.liftRollPx;
    last.y += Math.sin(a) * st.liftRollPx;
  }
  out.push(last);
  return out;
}

/** A tap: a press held `durationMs` with contact jitter and a slow drift, then a lift (with a little roll). */
export function tapSamples(
  t0: number,
  durationMs: number,
  opts: { rateMs?: number; jitterPx?: number; driftPx?: number; liftRollPx?: number; x0?: number; y0?: number } = {},
  r: Rng | null = null,
): GestureSample[] {
  const rate = opts.rateMs ?? 4;
  const x0 = opts.x0 ?? 450;
  const y0 = opts.y0 ?? 150;
  const jit = opts.jitterPx ?? 0;
  const drift = opts.driftPx ?? 0;
  const da = r ? r.range(0, 2 * Math.PI) : 0;
  const n = () => (r && jit > 0 ? r.gauss() * jit : 0);
  const at = (t: number) => {
    const u = durationMs > 0 ? (t - t0) / durationMs : 1;
    return { t, x: x0 + Math.cos(da) * drift * u + n(), y: y0 + Math.sin(da) * drift * u + n() };
  };
  const out: GestureSample[] = [{ t: t0, x: x0, y: y0 }];
  for (let k = 1; t0 + k * rate < t0 + durationMs - 1e-9; k++) out.push(at(t0 + k * rate));
  const last = at(t0 + durationMs);
  if (r && opts.liftRollPx) {
    const a = r.range(0, 2 * Math.PI);
    last.x += Math.cos(a) * opts.liftRollPx;
    last.y += Math.sin(a) * opts.liftRollPx;
  }
  out.push(last);
  return out;
}

export interface Delivery {
  frameMs?: number;
  coalesced?: boolean;
  latencyMs?: number;
}

/** The deliveries the cadence tests and corpora use: per-sample, and frame-aligned at 120, 60, 30 and 20 Hz. */
export const DELIVERIES: ReadonlyArray<{ name: string } & Delivery> = [
  { name: 'each sample' },
  { name: '120 Hz coalesced', frameMs: 1000 / 120, coalesced: true },
  { name: '60 Hz coalesced', frameMs: 1000 / 60, coalesced: true },
  { name: '30 Hz coalesced', frameMs: 1000 / 30, coalesced: true },
  { name: '120 Hz newest only', frameMs: 1000 / 120, coalesced: false },
  { name: '60 Hz newest only', frameMs: 1000 / 60, coalesced: false },
  { name: '30 Hz newest only', frameMs: 1000 / 30, coalesced: false },
  { name: '30 Hz coalesced, 20 ms late', frameMs: 1000 / 30, coalesced: true, latencyMs: 20 },
];

export interface Played {
  trace: TraceResult;
  gesture: GestureInput | null;
  swing: NormalizedSwing | null;
}

/** Plays samples through the real tracker (with a delivery) and normalizes the gesture it emits. */
export function play(
  samples: readonly GestureSample[],
  args: {
    surface?: { width: number; height: number };
    pointer?: TraceOptions['pointer'];
    delivery?: Delivery;
    lifted?: boolean;
    armAtMs?: number;
    footwork?: Footwork;
    pressFootwork?: boolean;
    handedness?: Handedness;
    opts?: Partial<NormalizeOptions>;
  } = {},
): Played {
  const trace = traceGesture({
    surface: args.surface ?? SURFACES.phone,
    pointer: args.pointer,
    samples,
    lifted: args.lifted,
    armAtMs: args.armAtMs,
    footwork: args.footwork,
    pressFootwork: args.pressFootwork,
    handedness: args.handedness,
    frameMs: args.delivery?.frameMs,
    coalesced: args.delivery?.coalesced,
    latencyMs: args.delivery?.latencyMs,
  });
  const o = { ...OPTS, ...(args.handedness ? { handedness: args.handedness } : {}), ...args.opts };
  const swing = trace.gesture ? normalizeGesture(trace.gesture, o) : null;
  return { trace, gesture: trace.gesture, swing };
}

/** Spearman's rank correlation (average ranks for ties). */
export function spearman(xs: readonly number[], ys: readonly number[]): number {
  const rank = (v: readonly number[]) => {
    const idx = v.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
    const r = new Array<number>(v.length);
    for (let i = 0; i < idx.length;) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
      i = j + 1;
    }
    return r;
  };
  const rx = rank(xs);
  const ry = rank(ys);
  const n = xs.length;
  const mx = rx.reduce((a, b) => a + b, 0) / n;
  const my = ry.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    num += (rx[i] - mx) * (ry[i] - my);
    dx += (rx[i] - mx) ** 2;
    dy += (ry[i] - my) ** 2;
  }
  return dx > 0 && dy > 0 ? num / Math.sqrt(dx * dy) : 0;
}

/** Smallest signed difference between two bearings (deg). */
export function bearingDiff(a: number, b: number): number {
  let d = ((((a - b) % 360) + 540) % 360) - 180;
  if (d === -180) d = 180;
  return d;
}
