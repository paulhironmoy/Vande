/// <reference types="node" />
/**
 * TEST HELPERS ONLY: the measurement tools behind the Director's gates. Each takes a baked plan (read at its own frame
 * rate; the gate runs use 240 Hz so that a 20 ms saccade is not under-sampled) and returns plain numbers, the way an
 * independent evaluator's script could. `record` collects the measured numbers so a run can write them down
 * (DIRECTOR_GATES_OUT=<dir> writes one JSON per test file; nothing is written otherwise).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { afterAll } from 'vitest';
import P from '@/render3d/core/motion/director/params.json';
import { CHANNELS, SCALE, type DirectorPlan } from '@/render3d/core/motion/director';

/**
 * Runs `fn` with Director parameters overridden ('gaze.leadX' -> 0, 'head.ffX' -> 0), then restores them. The parameter file
 * is one shared module object (a test file has its own registry), so every bake inside `fn` sees the override. For the
 * tests that are about one mechanism alone (the pure latency of the pursuit, without the P3 extrapolation and feed-forward).
 */
export function withParams<T>(over: Record<string, number>, fn: () => T): T {
  const saved: Array<[Record<string, number>, string, number]> = [];
  for (const [path, value] of Object.entries(over)) {
    const keys = path.split('.');
    let o = P as unknown as Record<string, unknown>;
    for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]] as Record<string, unknown>;
    const k = keys[keys.length - 1];
    saved.push([o as Record<string, number>, k, (o as Record<string, number>)[k]]);
    (o as Record<string, number>)[k] = value;
  }
  try {
    return fn();
  } finally {
    for (const [o, k, v] of saved.reverse()) o[k] = v;
  }
}

/** The value of channel `c` at frame `i`, in its unit. */
export const val = (p: DirectorPlan, i: number, c: number): number => p.trace[i * CHANNELS + c] * SCALE[c];
export const timeOf = (p: DirectorPlan, i: number): number => p.t0 + (i * 1000) / p.hz;
export const frameOf = (p: DirectorPlan, tMs: number): number => Math.round(((tMs - p.t0) * p.hz) / 1000);

export const mean = (a: ArrayLike<number>): number => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i];
  return s / (a.length || 1);
};
export const sd = (a: ArrayLike<number>): number => {
  const m = mean(a);
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - m) ** 2;
  return Math.sqrt(s / (a.length || 1));
};
export function quantile(a: number[], q: number): number {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  const p = (s.length - 1) * q;
  const lo = Math.floor(p);
  return s[lo] + (s[Math.min(s.length - 1, lo + 1)] - s[lo]) * (p - lo);
}
export function stats(a: number[]) {
  const f = a.filter((v) => Number.isFinite(v));
  let min = Infinity;
  let max = -Infinity;
  for (const v of f) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return {
    n: f.length,
    min,
    p5: quantile(f, 0.05),
    p50: quantile(f, 0.5),
    p95: quantile(f, 0.95),
    max,
    mean: mean(f),
    sd: sd(f),
  };
}

/** Spearman rank correlation (ties share their mean rank). */
export function spearman(x: ArrayLike<number>, y: ArrayLike<number>): number {
  const rank = (a: ArrayLike<number>) => {
    const idx = Array.from({ length: a.length }, (_, i) => i).sort((i, j) => a[i] - a[j]);
    const r = new Float64Array(a.length);
    for (let i = 0; i < idx.length;) {
      let j = i;
      while (j + 1 < idx.length && a[idx[j + 1]] === a[idx[i]]) j++;
      const m = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) r[idx[k]] = m;
      i = j + 1;
    }
    return r;
  };
  const rx = rank(x);
  const ry = rank(y);
  const mx = mean(rx);
  const my = mean(ry);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < rx.length; i++) {
    sxy += (rx[i] - mx) * (ry[i] - my);
    sxx += (rx[i] - mx) ** 2;
    syy += (ry[i] - my) ** 2;
  }
  return sxy / Math.sqrt(sxx * syy || 1);
}

export interface BlinkEvent {
  on: number;
  off: number;
  peak: number;
  tPeak: number;
  duration: number;
  closeMs: number;
  openMs: number;
}

/**
 * Blink events of a closure channel (0 open ... 1 closed): one per local peak of at least `minPeak`; its edges are
 * where the closure falls to `lo` (2%) of the peak, or the neighbouring valley (so a double blink is two events).
 */
export function blinkEvents(p: DirectorPlan, chan: number, minPeak = 0.35, lo = 0.02): BlinkEvent[] {
  const v = (i: number) => val(p, i, chan);
  const w = Math.max(1, Math.round((40 * p.hz) / 1000));
  const ev: BlinkEvent[] = [];
  for (let i = w; i < p.n - w; i++) {
    const x = v(i);
    if (x < minPeak) continue;
    let top = true;
    for (let k = i - w; k <= i + w; k++)
      if (v(k) > x || (v(k) === x && k < i)) {
        top = false;
        break;
      }
    if (!top) continue;
    let a = i;
    while (a > 0 && v(a - 1) > lo * x && v(a - 1) <= v(a)) a--;
    let b = i;
    while (b < p.n - 1 && v(b + 1) > lo * x && v(b + 1) <= v(b)) b++;
    const ms = 1000 / p.hz;
    ev.push({
      on: timeOf(p, a),
      off: timeOf(p, b),
      peak: x,
      tPeak: timeOf(p, i),
      duration: (b - a) * ms,
      closeMs: (i - a) * ms,
      openMs: (b - i) * ms,
    });
  }
  return ev;
}
/** Onset-to-onset intervals (s). */
export const intervals = (ev: BlinkEvent[]): number[] => ev.slice(1).map((e, i) => (e.on - ev[i].on) / 1000);
export const cvOf = (a: number[]): number => sd(a) / (mean(a) || 1);

export interface Saccade {
  t: number;
  /** When the speed peaks (distinct per saccade even when the edges of two merge through a pursuit). */
  tPeak: number;
  A: number;
  D: number;
  vp: number;
  ttp: number;
  /** Eye speed (deg/s) in the 40 ms before the saccade: a scheduled shift starts from rest, a catch-up from pursuit. */
  v0: number;
}

/** The achieved gaze speed (deg/s) at frames 1 .. n - 1 (index 0 is 0). */
export function gazeSpeed(p: DirectorPlan, cy: number, cp: number): Float64Array {
  const s = new Float64Array(p.n);
  for (let i = 1; i < p.n; i++)
    s[i] = Math.hypot(val(p, i, cy) - val(p, i - 1, cy), val(p, i, cp) - val(p, i - 1, cp)) * p.hz;
  return s;
}

/**
 * Saccades of the achieved gaze: runs of speed above `onDegS` (130 deg/s: above the 110 deg/s pursuit cap), extended
 * to where the speed falls to 10% of the peak (but not below 25 deg/s). Amplitude and duration come from the edges.
 */
export function saccades(p: DirectorPlan, cy: number, cp: number, onDegS = 130, minDeg = 3): Saccade[] {
  const sp = gazeSpeed(p, cy, cp);
  const out: Saccade[] = [];
  const ms = 1000 / p.hz;
  for (let i = 1; i < p.n;) {
    if (sp[i] < onDegS) {
      i++;
      continue;
    }
    let j = i;
    let pk = i;
    while (j + 1 < p.n && sp[j + 1] >= onDegS) {
      j++;
      if (sp[j] > sp[pk]) pk = j;
    }
    let a = i;
    let b = j;
    const edge = Math.max(25, 0.1 * sp[pk]);
    while (a > 1 && sp[a - 1] > edge) a--;
    while (b < p.n - 1 && sp[b + 1] > edge) b++;
    const A = Math.hypot(val(p, b, cy) - val(p, a - 1, cy), val(p, b, cp) - val(p, a - 1, cp));
    const D = (b - a + 1) * ms;
    const back = Math.max(1, Math.round(40 / ms));
    let v0 = 0;
    for (let k = Math.max(1, a - back); k < a; k++) v0 = Math.max(v0, sp[k]);
    if (A >= minDeg)
      out.push({ t: timeOf(p, a - 1), tPeak: timeOf(p, pk), A, D, vp: sp[pk], ttp: ((pk - a + 1) * ms) / D, v0 });
    i = b + 1;
  }
  return out;
}

/** Longest stretch (s) in which neither eyes nor head change by more than `rangeDeg` over a one-second window. */
export function longestFrozenS(
  p: DirectorPlan,
  chans: number[],
  rangeDeg: number,
  fromMs = -Infinity,
  toMs = Infinity,
): number {
  const w = Math.round(p.hz);
  const stepF = Math.max(1, w >> 3);
  const i0 = Math.max(0, frameOf(p, Math.max(fromMs, p.t0)));
  const i1 = Math.min(p.n - 1, frameOf(p, Math.min(toMs, timeOf(p, p.n - 1))));
  let best = 0;
  let run = 0;
  for (let s = i0; s + w <= i1; s += stepF) {
    let frozen = true;
    for (const c of chans) {
      let lo = Infinity;
      let hi = -Infinity;
      for (let k = s; k <= s + w; k++) {
        const v = val(p, k, c);
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      if (hi - lo > rangeDeg) {
        frozen = false;
        break;
      }
    }
    if (frozen) {
      run += stepF / p.hz;
      best = Math.max(best, run + 1);
    } else run = 0;
  }
  return best;
}

/** FNV-1a over the trace bytes: two equal traces have equal hashes. */
export function traceHash(p: DirectorPlan): string {
  let h = 0x811c9dc5;
  const u = new Uint8Array(p.trace.buffer, p.trace.byteOffset, p.trace.byteLength);
  for (let i = 0; i < u.length; i++) {
    h ^= u[i];
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

/** Largest absolute difference between two traces over frames [i0, i1], in channel units, over the given channels. */
export function maxDiff(a: DirectorPlan, b: DirectorPlan, i0: number, i1: number, chans?: number[]): number {
  let m = 0;
  for (let i = Math.max(0, i0); i <= Math.min(a.n, b.n) - 1 && i <= i1; i++) {
    for (let c = 0; c < CHANNELS; c++) {
      if (chans && !chans.includes(c)) continue;
      m = Math.max(m, Math.abs(a.trace[i * CHANNELS + c] - b.trace[i * CHANNELS + c]) * SCALE[c]);
    }
  }
  return m;
}

// ---------------------------------------------------------------------------------------------------------------
// Recording

const rec: Record<string, unknown> = {};
/** Keeps a measured number (or object) under a name; written at the end of the file when DIRECTOR_GATES_OUT is set. */
export function record(name: string, value: unknown): void {
  rec[name] = value;
}
export function recordFile(file: string): void {
  afterAll(() => {
    const dir = process.env.DIRECTOR_GATES_OUT;
    if (!dir) return;
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${dir}/${file}.json`, JSON.stringify(rec, null, 1));
  });
}
