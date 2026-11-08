/**
 * Deterministic DSP for the pre-rendered crowd reactions (src/audio/crowdVoices.ts): seeded noise, RBJ biquads, a
 * band-limited sawtooth, envelopes and three sound layers (a chorus of voices through vowel formants, hand claps and
 * whistles). Plain numbers and no Web Audio, so it renders in idle time on the main thread, in a test or in Node, and
 * the same seed always gives the same samples. Every layer is sequential: call sample() once per output sample.
 */
import { Sfc32, createRng } from '@/engine/prng';

export function rng(seed: number): Sfc32 {
  const s = createRng(seed);
  return new Sfc32(s.a, s.b, s.c, s.d);
}

const between = (r: Sfc32, lo: number, hi: number) => lo + (hi - lo) * r.float();

export class Biquad {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;

  /** 'bp' is a band pass with 0 dB peak gain. */
  set(type: 'bp' | 'lp' | 'hp', freq: number, q: number, sr: number): this {
    const w = (2 * Math.PI * Math.min(freq, sr * 0.45)) / sr;
    const cw = Math.cos(w);
    const alpha = Math.sin(w) / (2 * q);
    const a0 = 1 + alpha;
    if (type === 'bp') {
      this.b0 = alpha / a0;
      this.b1 = 0;
      this.b2 = -alpha / a0;
    } else {
      const k = type === 'lp' ? (1 - cw) / 2 : (1 + cw) / 2;
      this.b0 = k / a0;
      this.b1 = (type === 'lp' ? 2 * k : -2 * k) / a0;
      this.b2 = k / a0;
    }
    this.a1 = (-2 * cw) / a0;
    this.a2 = (1 - alpha) / a0;
    return this;
  }

  run(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

/** Attack, hold, release with raised-cosine edges (0 outside). Seconds. */
export function ahr(t: number, attack: number, hold: number, release: number): number {
  if (t <= 0) return 0;
  if (t < attack) return 0.5 - 0.5 * Math.cos((Math.PI * t) / attack);
  if (t < attack + hold) return 1;
  const u = t - attack - hold;
  return u < release ? 0.5 + 0.5 * Math.cos((Math.PI * u) / release) : 0;
}

/** Piecewise-linear value of [x, y] points at x (clamped at both ends). */
export function curve(points: ReadonlyArray<readonly [number, number]>, x: number): number {
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    if (x <= points[i][0]) {
      const [x0, y0] = points[i - 1];
      const [x1, y1] = points[i];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return points[points.length - 1][1];
}

/** Three formants: [frequency Hz, gain, Q]. */
export type Vowel = ReadonlyArray<readonly [number, number, number]>;
export const VOWELS = {
  oo: [[320, 1, 4], [800, 0.45, 5], [2300, 0.12, 6]],
  oh: [[450, 1, 4], [850, 0.5, 5], [2500, 0.12, 6]],
  aw: [[570, 1, 4], [840, 0.55, 5], [2410, 0.14, 6]],
  ah: [[730, 1, 3.5], [1100, 0.6, 4.5], [2450, 0.2, 6]],
  eh: [[600, 1, 3.5], [1900, 0.5, 5], [2600, 0.18, 6]],
} as const satisfies Record<string, Vowel>;

export interface ChorusSpec {
  voices: number;
  /** Fundamental range (Hz): a crowd of men and women. */
  f0: readonly [number, number];
  /** Pitch ratio over the layer's time (seconds), e.g. [[0, 1], [0.25, 1.08], [1.2, 0.9]]. */
  contour: ReadonlyArray<readonly [number, number]>;
  onset: readonly [number, number];
  attack: readonly [number, number];
  hold: readonly [number, number];
  release: readonly [number, number];
  vowel: Vowel;
  /** Glide to this vowel over `glide` seconds. */
  vowelTo?: Vowel;
  glide?: number;
  /** Breath noise through the same formants, 0..1. */
  breath: number;
  vibrato: number;
}

/** Many voices on one vowel: band-limited saws with their own pitch, timing and vibrato, through shared formants. */
export class Chorus {
  private saw: Float64Array;
  private freq: Float64Array;
  private dt: Float64Array;
  private on: Float64Array;
  private att: Float64Array;
  private hold: Float64Array;
  private rel: Float64Array;
  private vib: Float64Array;
  private vibPh: Float64Array;
  private gain: Float64Array;
  /** Each voice's envelope, interpolated between control ticks. */
  private env: Float64Array;
  private envStep: Float64Array;
  private formants = [new Biquad(), new Biquad(), new Biquad()];
  private i = 0;
  private noise: Sfc32;

  constructor(
    private spec: ChorusSpec,
    private sr: number,
    seed: number,
  ) {
    const r = rng(seed);
    this.noise = rng(seed ^ 0x5bd1e995);
    const n = spec.voices;
    this.saw = new Float64Array(n);
    this.freq = new Float64Array(n);
    this.dt = new Float64Array(n);
    this.on = new Float64Array(n);
    this.att = new Float64Array(n);
    this.hold = new Float64Array(n);
    this.rel = new Float64Array(n);
    this.vib = new Float64Array(n);
    this.vibPh = new Float64Array(n);
    this.gain = new Float64Array(n);
    this.env = new Float64Array(n);
    this.envStep = new Float64Array(n);
    for (let v = 0; v < n; v++) {
      this.saw[v] = r.float();
      this.freq[v] = between(r, spec.f0[0], spec.f0[1]);
      this.on[v] = between(r, spec.onset[0], spec.onset[1]);
      this.att[v] = between(r, spec.attack[0], spec.attack[1]);
      this.hold[v] = between(r, spec.hold[0], spec.hold[1]);
      this.rel[v] = between(r, spec.release[0], spec.release[1]);
      this.vib[v] = between(r, 4.5, 6.5);
      this.vibPh[v] = r.float() * Math.PI * 2;
      this.gain[v] = between(r, 0.6, 1) / Math.sqrt(n);
    }
    this.tune(0);
  }

  /** Control rate (every 32 samples): each voice's pitch and envelope, and the formants. */
  private tune(t: number) {
    const s = this.spec;
    const ratio = curve(s.contour, t);
    const next = t + 32 / this.sr;
    for (let v = 0; v < this.freq.length; v++) {
      const vib = 1 + s.vibrato * Math.sin(2 * Math.PI * this.vib[v] * t + this.vibPh[v]);
      this.dt[v] = (this.freq[v] * ratio * vib) / this.sr;
      const e0 = ahr(t - this.on[v], this.att[v], this.hold[v], this.rel[v]);
      this.env[v] = e0;
      this.envStep[v] = (ahr(next - this.on[v], this.att[v], this.hold[v], this.rel[v]) - e0) / 32;
    }
    const u = s.vowelTo && s.glide ? Math.min(1, t / s.glide) : 0;
    for (let k = 0; k < 3; k++) {
      const a = s.vowel[k];
      const b = s.vowelTo ? s.vowelTo[k] : a;
      this.formants[k].set('bp', a[0] + (b[0] - a[0]) * u, a[2], this.sr);
    }
  }

  sample(t: number): number {
    if ((this.i++ & 31) === 0) this.tune(t);
    let x = 0;
    for (let v = 0; v < this.saw.length; v++) {
      const e = this.env[v];
      this.env[v] = e + this.envStep[v];
      if (e <= 0 && this.envStep[v] <= 0) continue;
      const dt = this.dt[v];
      let p = this.saw[v] + dt;
      if (p >= 1) p -= 1;
      this.saw[v] = p;
      let y = 2 * p - 1;
      if (p < dt) {
        const q = p / dt;
        y -= q + q - q * q - 1;
      } else if (p > 1 - dt) {
        const q = (p - 1) / dt;
        y -= q * q + q + q + 1;
      }
      x += y * e * this.gain[v];
    }
    x += (this.noise.float() * 2 - 1) * this.spec.breath * 0.5;
    const f = this.formants;
    const w = this.spec.vowel;
    return f[0].run(x) * w[0][1] + f[1].run(x) * w[1][1] + f[2].run(x) * w[2][1];
  }
}

/** Hand claps: each clapper claps at its own rate from its own onset; a clap is a short band-passed noise burst. */
export class Claps {
  private next: Float64Array;
  private period: Float64Array;
  private left: Float64Array;
  private amp: Float64Array;
  private decay: Float64Array;
  private filters: Biquad[] = [];
  private r: Sfc32;

  constructor(
    clappers: number,
    rate: readonly [number, number],
    onset: readonly [number, number],
    private sr: number,
    seed: number,
  ) {
    this.r = rng(seed);
    this.next = new Float64Array(clappers);
    this.period = new Float64Array(clappers);
    this.left = new Float64Array(clappers);
    this.amp = new Float64Array(clappers);
    this.decay = new Float64Array(clappers);
    for (let c = 0; c < clappers; c++) {
      this.period[c] = 1 / between(this.r, rate[0], rate[1]);
      this.next[c] = between(this.r, onset[0], onset[1]);
      this.filters.push(new Biquad().set('bp', between(this.r, 900, 2600), between(this.r, 1.1, 1.9), sr));
    }
  }

  sample(t: number): number {
    let x = 0;
    for (let c = 0; c < this.next.length; c++) {
      if (t >= this.next[c]) {
        this.next[c] += this.period[c] * between(this.r, 0.85, 1.15);
        this.left[c] = Math.round(this.sr * 0.012);
        this.amp[c] = between(this.r, 0.5, 1);
        this.decay[c] = Math.exp(-1 / (this.sr * between(this.r, 0.0018, 0.0035)));
      }
      if (this.left[c] > 0) {
        this.left[c]--;
        this.amp[c] *= this.decay[c];
        x += this.filters[c].run((this.r.float() * 2 - 1) * this.amp[c]);
      }
    }
    return x;
  }
}

/** A few whistles: sine glides between 1.6 and 3.2 kHz with vibrato. */
export class Whistles {
  private ph: Float64Array;
  private f: Float64Array;
  private to: Float64Array;
  private on: Float64Array;
  private len: Float64Array;

  constructor(
    count: number,
    onset: readonly [number, number],
    private sr: number,
    seed: number,
  ) {
    const r = rng(seed);
    this.ph = new Float64Array(count);
    this.f = new Float64Array(count);
    this.to = new Float64Array(count);
    this.on = new Float64Array(count);
    this.len = new Float64Array(count);
    for (let w = 0; w < count; w++) {
      this.f[w] = between(r, 1600, 2600);
      this.to[w] = this.f[w] * between(r, 1.05, 1.3);
      this.on[w] = between(r, onset[0], onset[1]);
      this.len[w] = between(r, 0.35, 0.8);
    }
  }

  sample(t: number): number {
    let x = 0;
    for (let w = 0; w < this.ph.length; w++) {
      const u = (t - this.on[w]) / this.len[w];
      if (u <= 0 || u >= 1) continue;
      const f = this.f[w] + (this.to[w] - this.f[w]) * Math.sin(Math.PI * u) + 40 * Math.sin(2 * Math.PI * 6 * t);
      let ph = this.ph[w] + f / this.sr;
      if (ph >= 1) ph -= 1;
      this.ph[w] = ph;
      x += Math.sin(2 * Math.PI * ph) * Math.sin(Math.PI * u) * 0.25;
    }
    return x;
  }
}
