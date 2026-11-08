/**
 * Seeded, reproducible gesture corpora (a unit fixture; docs/PRACTICE_INPUT.md, "Corpora"):
 *
 *   noviceCorpus   RK3: taps, swipes and leaves as a first-time player makes them on a phone: sloppy taps that roll and
 *                  drift, swipes of every length, speed, curve and direction, often after a rest on the glass or held
 *                  at the end, and leaves (no touch, or a finger resting on the glass that never swings)
 *   expertCorpus   EX1: eight intended classes (leave, forward and back defence, drive, cut, pull, flick, lofted) with
 *                  an expert's small execution noise, on every surface, with touch, mouse and pen
 *
 * Every gesture carries its own digitizer rate and delivery (per sample, or frame-aligned at 120/60/30 Hz with or
 * without coalesced samples, sometimes late), so the corpora also exercise cadence. Same seed → same corpus.
 */
import type { Footwork, GestureSample } from '@/contracts/practice';
import { referenceLength } from '@/input/normalize';
import {
  DELIVERIES,
  PROFILES,
  SURFACES,
  rng,
  strokeSamples,
  tapSamples,
  type Delivery,
  type ProfileName,
  type Rng,
  type SurfaceName,
} from './fixtures';

export type NoviceClass = 'tap' | 'flick' | 'leave';
export type ExpertClass = 'leave' | 'forward_defence' | 'back_defence' | 'drive' | 'cut' | 'pull' | 'flick' | 'lofted';

export interface CorpusGesture<C extends string> {
  id: string;
  cls: C;
  /** Null: no touch at all. */
  samples: GestureSample[] | null;
  surface: { width: number; height: number };
  surfaceName: SurfaceName;
  pointer: 'touch' | 'mouse' | 'pen';
  delivery: Delivery & { name: string };
  /** The finger was already down when the delivery was armed (a resting finger). */
  armAtMs?: number;
  lifted: boolean;
  footwork: Footwork;
  /** What the gesture means to do (for reports). */
  note: string;
  /** Expert swipes: the bearing on screen the player aimed at. */
  aimDeg?: number;
}

const T0 = 20_000;
const PROFILE_NAMES = Object.keys(PROFILES) as ProfileName[];
const RATES = [4, 8, 1000 / 120, 1000 / 60];

function deliveryOf(r: Rng): Delivery & { name: string } {
  return r.pick(DELIVERIES);
}

/** The press position somewhere in the lower part of the surface, leaving room for the stroke. */
function pressAt(r: Rng, surface: { width: number; height: number }): { x0: number; y0: number } {
  return { x0: r.range(0.15, 0.85) * surface.width, y0: r.range(0.45, 0.9) * surface.height };
}

/** RK3: ≥ 300 novice gestures (default 450: 150 taps, 200 swipes, 100 leaves). */
export function noviceCorpus(
  seed = 0x5eed_0003,
  counts = { tap: 150, flick: 200, leave: 100 },
): CorpusGesture<NoviceClass>[] {
  const r = rng(seed);
  const out: CorpusGesture<NoviceClass>[] = [];
  const phoneLike: SurfaceName[] = ['phone', 'phone', 'phone', 'common', 'small'];
  for (let i = 0; i < counts.tap; i++) {
    const surfaceName = r.pick(phoneLike);
    const surface = SURFACES[surfaceName];
    // Mostly quick taps; some held well past the hold limit (a press that blocks).
    const durationMs = r.chance(0.15) ? r.range(150, 280) : r.logRange(30, 160);
    const opts = {
      rateMs: r.pick(RATES),
      jitterPx: r.range(0.2, 1.2),
      driftPx: r.range(0, 7),
      liftRollPx: r.range(0, 3),
      ...pressAt(r, surface),
    };
    out.push({
      id: `novice-tap-${i}`,
      cls: 'tap',
      samples: tapSamples(T0, durationMs, opts, r),
      surface,
      surfaceName,
      pointer: 'touch',
      delivery: deliveryOf(r),
      lifted: !(durationMs > 200 && r.chance(0.3)),
      footwork: 'auto',
      note: `tap ${durationMs.toFixed(0)} ms, drift ${opts.driftPx.toFixed(1)} px`,
    });
  }
  for (let i = 0; i < counts.flick; i++) {
    const surfaceName = r.pick(phoneLike);
    const surface = SURFACES[surfaceName];
    const k = referenceLength(surface) / referenceLength(SURFACES.phone);
    const lengthPx = r.logRange(30, 220) * k;
    const durationMs = r.logRange(35, 220);
    // Novices swipe mostly up the screen and across, sometimes anywhere.
    const bearingDeg = r.chance(0.75) ? r.range(-100, 100) : r.range(-180, 180);
    const restMs = r.chance(0.3) ? r.range(20, 100) : 0;
    const holdMs = r.chance(0.2) ? r.range(40, 200) : 0;
    const st = {
      lengthPx,
      bearingDeg,
      durationMs,
      profile: r.pick(PROFILE_NAMES),
      curveDeg: r.range(-25, 25),
      restMs,
      holdMs,
      rateMs: r.pick(RATES),
      jitterPx: r.range(0.2, 1),
      liftRollPx: r.range(0, 3),
      ...pressAt(r, surface),
    };
    out.push({
      id: `novice-flick-${i}`,
      cls: 'flick',
      samples: strokeSamples(st, T0, r),
      surface,
      surfaceName,
      pointer: 'touch',
      delivery: deliveryOf(r),
      lifted: holdMs === 0 || r.chance(0.7),
      footwork: 'auto',
      note: `swipe ${lengthPx.toFixed(0)} px / ${durationMs.toFixed(0)} ms @${bearingDeg.toFixed(0)}°, rest ${restMs.toFixed(0)}, hold ${holdMs.toFixed(0)}, ${st.profile}`,
    });
  }
  for (let i = 0; i < counts.leave; i++) {
    const surfaceName = r.pick(phoneLike);
    const surface = SURFACES[surfaceName];
    const kind = i % 3;
    if (kind === 0) {
      out.push({
        id: `novice-leave-${i}`,
        cls: 'leave',
        samples: null,
        surface,
        surfaceName,
        pointer: 'touch',
        delivery: deliveryOf(r),
        lifted: true,
        footwork: 'auto',
        note: 'no touch',
      });
      continue;
    }
    // A finger already on the glass before the ball is bowled: it rests (jitter, slow drift), then lifts or stays.
    const durationMs = r.range(600, 1500);
    const samples = tapSamples(
      T0,
      durationMs,
      {
        rateMs: r.pick(RATES),
        jitterPx: r.range(0.2, 0.8),
        driftPx: r.range(0, 6),
        liftRollPx: r.range(0, 3),
        ...pressAt(r, surface),
      },
      r,
    );
    out.push({
      id: `novice-leave-${i}`,
      cls: 'leave',
      samples,
      surface,
      surfaceName,
      pointer: 'touch',
      delivery: deliveryOf(r),
      armAtMs: T0 + r.range(100, 400),
      lifted: kind === 1,
      footwork: 'auto',
      note: kind === 1 ? 'resting finger, lifted' : 'resting finger, stays',
    });
  }
  return out;
}

/** The expert's eight classes: what each one aims at on screen (bearing range, deg) and with which foot. */
export const EXPERT_AIMS: Record<
  Exclude<ExpertClass, 'leave' | 'forward_defence' | 'back_defence'>,
  { aim: [number, number]; footwork: Footwork }
> = {
  drive: { aim: [-25, 55], footwork: 'forward' },
  cut: { aim: [82, 112], footwork: 'back' },
  pull: { aim: [-98, -62], footwork: 'back' },
  flick: { aim: [-95, -50], footwork: 'forward' },
  lofted: { aim: [-30, 30], footwork: 'forward' },
};

/** EX1: an expert corpus, `perClass` gestures of each of the eight classes (default 45: 360 gestures). */
export function expertCorpus(seed = 0x5eed_00e1, perClass = 45): CorpusGesture<ExpertClass>[] {
  const r = rng(seed);
  const out: CorpusGesture<ExpertClass>[] = [];
  const places: Array<{ surfaceName: SurfaceName; pointer: 'touch' | 'mouse' | 'pen' }> = [
    { surfaceName: 'phone', pointer: 'touch' },
    { surfaceName: 'phone', pointer: 'touch' },
    { surfaceName: 'common', pointer: 'touch' },
    { surfaceName: 'small', pointer: 'touch' },
    { surfaceName: 'tablet', pointer: 'pen' },
    { surfaceName: 'desktop', pointer: 'mouse' },
    { surfaceName: 'wide', pointer: 'mouse' },
  ];
  const classes: ExpertClass[] = [
    'leave',
    'forward_defence',
    'back_defence',
    'drive',
    'cut',
    'pull',
    'flick',
    'lofted',
  ];
  for (const cls of classes) {
    for (let i = 0; i < perClass; i++) {
      const { surfaceName, pointer } = r.pick(places);
      const surface = SURFACES[surfaceName];
      const ref = referenceLength(surface);
      const k = ref / referenceLength(SURFACES.phone);
      const base = {
        id: `expert-${cls}-${i}`,
        cls,
        surface,
        surfaceName,
        pointer,
        delivery: deliveryOf(r),
        lifted: true,
      };
      if (cls === 'leave') {
        out.push({ ...base, samples: null, footwork: 'auto', note: 'no touch' });
        continue;
      }
      if (cls === 'forward_defence' || cls === 'back_defence') {
        const samples = tapSamples(
          T0,
          r.range(40, 120),
          {
            rateMs: r.pick(RATES),
            jitterPx: r.range(0.1, 0.6),
            driftPx: r.range(0, 3),
            liftRollPx: r.range(0, 2),
            ...pressAt(r, surface),
          },
          r,
        );
        out.push({ ...base, samples, footwork: cls === 'forward_defence' ? 'forward' : 'back', note: `tap, ${cls}` });
        continue;
      }
      const spec = EXPERT_AIMS[cls];
      const aimDeg = r.range(spec.aim[0], spec.aim[1]);
      // Execution noise: the direction (σ 4°), a little curve, length and speed.
      const bearingDeg = aimDeg + r.gauss() * 4;
      const loft = cls === 'lofted';
      const lengthPx = loft ? ref * 1.8 * (1 + r.gauss() * 0.06) : r.range(70, 170) * k;
      const durationMs = loft ? r.range(95, 130) : r.range(55, 140);
      const st = {
        lengthPx,
        bearingDeg,
        durationMs,
        profile: r.pick(PROFILE_NAMES),
        curveDeg: r.range(-12, 12),
        restMs: r.chance(0.2) ? r.range(10, 40) : 0,
        rateMs: r.pick(RATES),
        jitterPx: r.range(0.1, 0.6),
        liftRollPx: r.range(0, 2),
        ...pressAt(r, surface),
      };
      out.push({
        ...base,
        samples: strokeSamples(st, T0, r),
        footwork: spec.footwork,
        aimDeg,
        note: `${cls}: ${lengthPx.toFixed(0)} px / ${durationMs.toFixed(0)} ms aimed ${aimDeg.toFixed(0)}°`,
      });
    }
  }
  return out;
}
