/**
 * The crowd's reactions, synthesised (original; no recordings or samples): choruses of voices on a vowel, hand claps,
 * whistles and an exhale, from src/audio/dsp.ts. Each reaction is rendered once, in idle time,
 * into a buffer at CROWD_RATE (the bank: src/audio/bank.ts), then plays from it with one source node. Every render is
 * deterministic (fixed seeds) and normalised to its own integrated loudness (ITU-R BS.1770, src/audio/loudness.ts), so
 * the reactions keep their order however the synthesis is tuned: eruption > cheer > ovation > ooh > lift, groan,
 * applause > dismay > relief.
 *
 *   lift      the crowd lifting as a hit goes somewhere: "eh-ah", rising, a few claps
 *   ooh       a close call or an edge: "oo-oh", a quick swell and fall
 *   groan     a missed opportunity: "aw", falling
 *   relief    survival: an exhale and scattered claps
 *   applause  runs: claps
 *   cheer     a four: "ah" and "eh" voices, claps, two whistles (a strong release)
 *   eruption  a six: more voices, brighter, claps, whistles and the stand's rumble (peak celebration)
 *   ovation   a milestone: sustained applause, cheering and whistles
 *   dismay    after a wicket's silence, the shift: a low, falling "oh-aw" as the ground takes it in
 */
import { hashString } from '@/engine/prng';
import type { CrowdReaction } from './emotionCore';
import { Biquad, Chorus, Claps, VOWELS, Whistles, ahr, rng, type ChorusSpec } from './dsp';
import { integratedLoudness } from './loudness';

/** 16 kHz: the content tops out near 3.4 kHz (formants, claps, whistles), so this is ample and cheap. */
export const CROWD_RATE = 16000;

interface Recipe {
  seconds: number;
  /** Integrated loudness at unit gain (LUFS). */
  lufs: number;
  /** The overall envelope: attack, hold, release (s). */
  env: readonly [number, number, number];
  chorus?: Array<{ spec: ChorusSpec; gain: number }>;
  claps?: { clappers: number; rate: readonly [number, number]; onset: readonly [number, number]; gain: number };
  whistles?: { count: number; onset: readonly [number, number]; gain: number };
  rumble?: number;
  exhale?: number;
}

const voice = (s: Partial<ChorusSpec> & Pick<ChorusSpec, 'voices' | 'f0' | 'contour' | 'vowel'>): ChorusSpec => ({
  onset: [0, 0.1],
  attack: [0.05, 0.15],
  hold: [0.2, 0.4],
  release: [0.4, 0.7],
  breath: 0.25,
  vibrato: 0.012,
  ...s,
});

export const CROWD_RECIPES: Readonly<Record<CrowdReaction, Recipe>> = {
  lift: {
    seconds: 1.1,
    lufs: -21,
    env: [0.06, 0.25, 0.75],
    chorus: [
      {
        gain: 1,
        spec: voice({
          voices: 24,
          f0: [140, 320],
          contour: [
            [0, 0.95],
            [0.35, 1.12],
            [1.1, 1.05],
          ],
          vowel: VOWELS.eh,
          vowelTo: VOWELS.ah,
          glide: 0.4,
          hold: [0.1, 0.3],
          release: [0.35, 0.6],
          vibrato: 0.015,
        }),
      },
    ],
    claps: { clappers: 10, rate: [3.5, 5], onset: [0.15, 0.4], gain: 0.5 },
  },
  ooh: {
    seconds: 1.35,
    lufs: -20,
    env: [0.05, 0.35, 0.95],
    chorus: [
      {
        gain: 1,
        spec: voice({
          voices: 26,
          f0: [115, 270],
          contour: [
            [0, 0.97],
            [0.25, 1.06],
            [1.3, 0.9],
          ],
          vowel: VOWELS.oo,
          vowelTo: VOWELS.oh,
          glide: 0.8,
          onset: [0, 0.09],
          attack: [0.06, 0.14],
          hold: [0.15, 0.35],
          release: [0.45, 0.75],
        }),
      },
    ],
  },
  groan: {
    seconds: 1.8,
    lufs: -21,
    env: [0.12, 0.45, 1.2],
    chorus: [
      {
        gain: 1,
        spec: voice({
          voices: 24,
          f0: [110, 250],
          contour: [
            [0, 1.04],
            [0.3, 1],
            [1.5, 0.74],
          ],
          vowel: VOWELS.aw,
          onset: [0, 0.15],
          attack: [0.1, 0.22],
          hold: [0.25, 0.5],
          release: [0.6, 1],
          breath: 0.2,
          vibrato: 0.01,
        }),
      },
    ],
  },
  relief: {
    seconds: 1.6,
    lufs: -23,
    env: [0.06, 0.3, 1.2],
    exhale: 1,
    claps: { clappers: 14, rate: [3.5, 5], onset: [0.35, 0.7], gain: 0.5 },
    chorus: [
      {
        gain: 0.3,
        spec: voice({
          voices: 10,
          f0: [120, 240],
          contour: [
            [0, 1],
            [1.2, 0.92],
          ],
          vowel: VOWELS.ah,
          hold: [0.1, 0.2],
        }),
      },
    ],
  },
  applause: {
    seconds: 2.5,
    lufs: -21,
    env: [0.15, 0.6, 1.7],
    claps: { clappers: 34, rate: [3.5, 5], onset: [0, 0.35], gain: 1 },
  },
  cheer: {
    seconds: 2.9,
    lufs: -17.5,
    env: [0.1, 0.9, 1.8],
    chorus: [
      {
        gain: 1,
        spec: voice({
          voices: 24,
          f0: [150, 360],
          contour: [
            [0, 0.96],
            [0.3, 1.1],
            [2.9, 0.98],
          ],
          vowel: VOWELS.ah,
          onset: [0, 0.15],
          attack: [0.06, 0.18],
          hold: [0.6, 1.2],
          release: [0.7, 1.3],
          vibrato: 0.02,
        }),
      },
      {
        gain: 0.6,
        spec: voice({
          voices: 16,
          f0: [180, 420],
          contour: [
            [0, 1],
            [0.4, 1.12],
            [2.9, 1],
          ],
          vowel: VOWELS.eh,
          vowelTo: VOWELS.ah,
          glide: 0.6,
          onset: [0.05, 0.3],
          hold: [0.4, 0.9],
          release: [0.6, 1.1],
          vibrato: 0.02,
        }),
      },
    ],
    claps: { clappers: 40, rate: [3.5, 5.5], onset: [0.25, 0.7], gain: 0.6 },
    whistles: { count: 2, onset: [0.3, 1.2], gain: 0.5 },
  },
  eruption: {
    seconds: 3.9,
    lufs: -16,
    env: [0.14, 1.3, 2.3],
    chorus: [
      {
        gain: 1,
        spec: voice({
          voices: 24,
          f0: [160, 420],
          contour: [
            [0, 0.95],
            [0.35, 1.14],
            [3.9, 1],
          ],
          vowel: VOWELS.ah,
          onset: [0, 0.18],
          attack: [0.06, 0.2],
          hold: [1, 1.8],
          release: [0.9, 1.6],
          breath: 0.3,
          vibrato: 0.025,
        }),
      },
      {
        gain: 0.7,
        spec: voice({
          voices: 16,
          f0: [200, 460],
          contour: [
            [0, 1],
            [0.4, 1.15],
            [3.9, 1.02],
          ],
          vowel: VOWELS.eh,
          vowelTo: VOWELS.ah,
          glide: 0.8,
          onset: [0.05, 0.3],
          hold: [0.8, 1.5],
          release: [0.8, 1.4],
          vibrato: 0.025,
        }),
      },
    ],
    claps: { clappers: 60, rate: [4, 6], onset: [0.25, 0.8], gain: 0.6 },
    whistles: { count: 4, onset: [0.25, 1.6], gain: 0.6 },
    rumble: 0.5,
  },
  ovation: {
    seconds: 5.6,
    lufs: -18,
    env: [0.3, 3.4, 1.9],
    claps: { clappers: 64, rate: [3.2, 4.8], onset: [0, 0.6], gain: 1 },
    chorus: [
      {
        gain: 0.45,
        spec: voice({
          voices: 18,
          f0: [150, 340],
          contour: [
            [0, 0.98],
            [0.5, 1.08],
            [5.6, 1],
          ],
          vowel: VOWELS.ah,
          onset: [0, 0.5],
          hold: [1, 2.5],
          release: [0.8, 1.4],
          vibrato: 0.02,
        }),
      },
    ],
    whistles: { count: 3, onset: [0.4, 3], gain: 0.5 },
  },
  dismay: {
    seconds: 1.9,
    lufs: -22,
    env: [0.2, 0.45, 1.2],
    chorus: [
      {
        gain: 1,
        spec: voice({
          voices: 26,
          f0: [105, 240],
          contour: [
            [0, 1.02],
            [0.3, 1],
            [1.6, 0.8],
          ],
          vowel: VOWELS.oh,
          vowelTo: VOWELS.aw,
          glide: 1.2,
          onset: [0, 0.25],
          attack: [0.12, 0.3],
          hold: [0.2, 0.5],
          release: [0.6, 1.1],
          breath: 0.3,
          vibrato: 0.008,
        }),
      },
    ],
  },
};

export interface CrowdRender {
  readonly kind: CrowdReaction;
  readonly length: number;
  /** Renders samples [from, to) into out; calls must follow each other in order. */
  render(out: Float32Array, from: number, to: number): void;
  /** After the last sample: normalise to the recipe's loudness, the peak kept under 0.95. */
  finish(out: Float32Array): void;
}

export function crowdRender(kind: CrowdReaction, sr: number = CROWD_RATE): CrowdRender {
  const r = CROWD_RECIPES[kind];
  const seed = hashString(`crowd:${kind}`);
  const choruses = (r.chorus ?? []).map((c, i) => ({ layer: new Chorus(c.spec, sr, seed + i * 7919), gain: c.gain }));
  const claps = r.claps ? new Claps(r.claps.clappers, r.claps.rate, r.claps.onset, sr, seed ^ 0x2c1b3c6d) : null;
  const whistles = r.whistles ? new Whistles(r.whistles.count, r.whistles.onset, sr, seed ^ 0x297a2d39) : null;
  const noise = rng(seed ^ 0x1b873593);
  const rumble = new Biquad().set('lp', 220, 0.7, sr);
  const exhale = new Biquad().set('lp', 2500, 0.7, sr);
  const [ea, eh, er] = r.env;
  return {
    kind,
    length: Math.ceil(r.seconds * sr),
    render(out, from, to) {
      for (let i = from; i < to; i++) {
        const t = i / sr;
        let x = 0;
        for (let c = 0; c < choruses.length; c++) x += choruses[c].layer.sample(t) * choruses[c].gain;
        if (claps) x += claps.sample(t) * r.claps!.gain;
        if (whistles) x += whistles.sample(t) * r.whistles!.gain;
        if (r.rumble || r.exhale) {
          const n = noise.float() * 2 - 1;
          if (r.rumble) x += rumble.run(n) * r.rumble;
          if (r.exhale) {
            if ((i & 63) === 0) exhale.set('lp', 2500 - 1900 * Math.min(1, t / 0.9), 0.7, sr);
            x += exhale.run(n) * ahr(t, 0.06, 0.1, 1) * r.exhale;
          }
        }
        out[i] = x * ahr(t, ea, eh, er);
      }
    },
    finish(out) {
      const loud = integratedLoudness([out], sr);
      let g = Number.isFinite(loud) ? 10 ** ((r.lufs - loud) / 20) : 1;
      let peak = 0;
      for (let i = 0; i < out.length; i++) {
        const a = Math.abs(out[i]);
        if (a > peak) peak = a;
      }
      if (peak * g > 0.95) g = 0.95 / peak;
      for (let i = 0; i < out.length; i++) out[i] *= g;
    },
  };
}

/** The whole reaction at once (tests, offline tools). */
export function renderCrowd(kind: CrowdReaction, sr: number = CROWD_RATE): Float32Array {
  const job = crowdRender(kind, sr);
  const out = new Float32Array(job.length);
  job.render(out, 0, job.length);
  job.finish(out);
  return out;
}
