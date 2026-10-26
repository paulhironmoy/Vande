/**
 * Quality presets and the match renderer's runtime step-down. Low = 30 fps cap, standard = 60 fps, high = 60 fps with
 * more detail. Device classification is src/perf's alone: 'auto' starts from the assessment it measured (cached per
 * app version), and the controller here only steps down (never up, to avoid oscillation) when measured frames run over
 * src/perf's frame budget. Offline rendering pins a fixed preset.
 */
import type { RenderQuality } from '@/contracts';
import type { DeviceAssessment, QualityProfileId } from '@/contracts/practice';
import { PERF_FULL_SUSTAINED_FPS, isSoftwareRenderer } from '@/perf';

export interface QualityPreset {
  quality: RenderQuality;
  maxFps: 30 | 60;
  /** Device-pixel-ratio cap for the canvas. */
  pixelRatio: number;
  /** Real-time shadow map size for the hero players (0 = projected blob shadows only). */
  shadowMap: 0 | 1024 | 2048;
  /** Number of floodlight blob shadows per player (night cricket throws one per tower). */
  blobShadows: 1 | 2 | 4;
  crowd: number;
  crowdAnimated: boolean;
  particles: number;
  trailPoints: number;
  /** Distance at which players switch to the low-detail mesh. */
  lodDistance: number;
  lightShafts: boolean;
  antialias: boolean;
}

export const PRESETS: Record<RenderQuality, QualityPreset> = {
  low: { quality: 'low', maxFps: 30, pixelRatio: 1, shadowMap: 0, blobShadows: 2, crowd: 1400, crowdAnimated: false, particles: 0.35, trailPoints: 14, lodDistance: 14, lightShafts: false, antialias: false },
  standard: { quality: 'standard', maxFps: 60, pixelRatio: 1.5, shadowMap: 1024, blobShadows: 4, crowd: 3600, crowdAnimated: true, particles: 1, trailPoints: 26, lodDistance: 26, lightShafts: true, antialias: true },
  high: { quality: 'high', maxFps: 60, pixelRatio: 2, shadowMap: 2048, blobShadows: 4, crowd: 6500, crowdAnimated: true, particles: 1.4, trailPoints: 36, lodDistance: 40, lightShafts: true, antialias: true },
};

const ORDER: RenderQuality[] = ['low', 'standard', 'high'];

/** The match preset for a Practice quality profile (src/perf picks profiles). */
export const QUALITY_FOR_PROFILE: Readonly<Record<QualityProfileId, RenderQuality>> = { lite: 'low', standard: 'standard', high: 'high' };

/**
 * The match renderer's starting quality for 'auto': the device assessment src/perf measured, when there is one
 * (Below plays Low), otherwise Standard on a hardware GPU and Low on a software renderer. The runtime controller
 * steps down from there if frames run over budget.
 */
export function autoQuality(assessment: DeviceAssessment | null, gpu: string): RenderQuality {
  if (assessment) return assessment.tier === 'below' ? 'low' : QUALITY_FOR_PROFILE[assessment.profile];
  return isSoftwareRenderer(gpu) ? 'low' : 'standard';
}

/** Frame budget (ms) per frame-rate cap: src/perf's sustained floor (60 fps presets; twice that at the 30 fps cap). */
export const FRAME_BUDGET_MS: Readonly<Record<30 | 60, number>> = { 60: 1000 / PERF_FULL_SUSTAINED_FPS, 30: 2000 / PERF_FULL_SUSTAINED_FPS };

export interface QualityControllerOptions {
  initial: RenderQuality;
  adaptive: boolean;
  onChange?: (q: RenderQuality, reason: 'low_fps' | 'manual') => void;
  /** Frames ignored after start and after each change (shader compiles, asset uploads). */
  graceFrames?: number;
  windowFrames?: number;
}

export class QualityController {
  private q: RenderQuality;
  private samples: number[] = [];
  private grace: number;
  private strikes = 0;
  readonly adaptive: boolean;
  /** Measured frames per second over the recent window. */
  fps = 0;
  frameMs = 0;

  constructor(private opts: QualityControllerOptions) {
    this.q = opts.initial;
    this.adaptive = opts.adaptive;
    this.grace = opts.graceFrames ?? 45;
  }

  get quality(): RenderQuality {
    return this.q;
  }
  get preset(): QualityPreset {
    return PRESETS[this.q];
  }

  set(q: RenderQuality) {
    if (q === this.q) return;
    this.q = q;
    this.reset();
    this.opts.onChange?.(q, 'manual');
  }

  private reset() {
    this.samples = [];
    this.grace = this.opts.graceFrames ?? 45;
    this.strikes = 0;
  }

  /** Feed one measured frame interval (ms between presented frames). Returns true if quality dropped. */
  sample(intervalMs: number): boolean {
    if (!(intervalMs > 0) || intervalMs > 1000) return false;
    if (this.grace > 0) {
      this.grace--;
      return false;
    }
    const win = this.opts.windowFrames ?? 60;
    this.samples.push(intervalMs);
    if (this.samples.length > win) this.samples.shift();
    const mean = this.samples.reduce((s, v) => s + v, 0) / this.samples.length;
    this.frameMs = mean;
    this.fps = 1000 / mean;
    if (!this.adaptive || this.samples.length < win) return false;
    const sorted = [...this.samples].sort((a, b) => a - b);
    const p75 = sorted[Math.floor(sorted.length * 0.75)];
    const budget = FRAME_BUDGET_MS[this.preset.maxFps];
    if (p75 > budget) this.strikes++;
    else this.strikes = Math.max(0, this.strikes - 1);
    // Two consecutive over-budget windows (about two seconds) trigger one step down.
    if (this.strikes >= Math.ceil(win * 0.5)) {
      const i = ORDER.indexOf(this.q);
      if (i > 0) {
        this.q = ORDER[i - 1];
        this.reset();
        this.opts.onChange?.(this.q, 'low_fps');
        return true;
      }
      this.strikes = 0;
    }
    return false;
  }
}

/** Frame pacing for the 30 fps cap: should this rAF tick render? */
export function shouldRender(nowMs: number, lastRenderMs: number, maxFps: 30 | 60): boolean {
  if (maxFps >= 60) return true;
  return nowMs - lastRenderMs >= 1000 / maxFps - 4;
}

// ---------------------------------------------------------------------------------------------------------------
// Practice profiles (src/perf chooses one; the stage applies it between deliveries)
// ---------------------------------------------------------------------------------------------------------------


export interface PracticeProfile {
  id: QualityProfileId;
  /** The renderer preset it builds on: stadium, players, crowd, shadows, effects. Always 60 fps. */
  preset: QualityPreset;
  /** Internal rendering height the profile aims for (drawing-buffer pixels), and the device-pixel-ratio cap. */
  internal: { min: number; max: number };
  maxDpr: number;
  /**
   * Ball readability: drawn this much larger than its collision radius, with an outline and a ground shadow in
   * every profile; only the trace's length varies. Readability is never traded for detail.
   */
  ball: { visualScale: number; trailAlpha: number };
}

export const PRACTICE_PROFILES: Readonly<Record<QualityProfileId, PracticeProfile>> = {
  // ≈540–720p, static crowd, no dynamic shadows (blob shadows only), low-detail fielders, minimal particles.
  lite: {
    id: 'lite',
    preset: { ...PRESETS.low, maxFps: 60, shadowMap: 0, blobShadows: 1, crowd: 1400, crowdAnimated: false, particles: 0.25, trailPoints: 5, lodDistance: 9, lightShafts: false, antialias: false },
    internal: { min: 540, max: 720 },
    maxDpr: 2,
    ball: { visualScale: 1.22, trailAlpha: 0.3 },
  },
  // ≈720–900p, limited shadows (the key light only), moderate crowd and effects, standard players.
  standard: {
    id: 'standard',
    preset: { ...PRESETS.standard, shadowMap: 1024, blobShadows: 2, crowd: 3600, crowdAnimated: true, particles: 0.8, trailPoints: 5, lodDistance: 22, lightShafts: false, antialias: true },
    internal: { min: 720, max: 900 },
    maxDpr: 2,
    ball: { visualScale: 1.22, trailAlpha: 0.3 },
  },
  // Capped high resolution, better shadows and effects, high-detail players.
  high: {
    id: 'high',
    preset: { ...PRESETS.high, shadowMap: 2048, blobShadows: 4, crowd: 6500, crowdAnimated: true, particles: 1.2, trailPoints: 6, lodDistance: 40, lightShafts: true, antialias: true },
    internal: { min: 900, max: 1440 },
    maxDpr: 2.5,
    ball: { visualScale: 1.22, trailAlpha: 0.32 },
  },
};

/**
 * Device-pixel ratio for a canvas of `cssHeight` CSS pixels: the device's own resolution, held inside the profile's
 * internal-height band and its DPR cap, so a high-DPR phone is never rendered at a resolution nobody can see.
 */
export function practicePixelRatio(profile: PracticeProfile, cssHeight: number, devicePixelRatio: number): number {
  const h = Math.max(1, cssHeight);
  const native = h * Math.max(0.5, devicePixelRatio || 1);
  const target = Math.min(profile.internal.max, Math.max(profile.internal.min, native));
  return Math.round(Math.min(profile.maxDpr, target / h) * 1000) / 1000;
}
