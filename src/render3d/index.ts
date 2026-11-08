/**
 * Renderer entry point. Importing this module is cheap: the Three.js renderer and the 2D fallback are
 * code-split and loaded on demand, so the app shell never ships 3D code.
 */
import type { StageRenderer } from './types';
import type { PracticeStage } from './practice/types';

export type { StageRenderer, PresentationSink, FallbackReason } from './types';
export type { Timeline, Segment } from './core/timeline';
export type {
  PracticeStage,
  PracticeMountOptions,
  PracticeSceneSetup,
  ReplayOptions,
  ReplayCamera,
  PracticeBenchmarkRun,
  PracticeStageStats,
  PracticeStageEvent,
  PracticeEventPayloads,
  PracticeFallbackPayload,
  PracticeSink,
  ContactFeel,
} from './practice/types';

let probe: boolean | null = null;

/** True when a WebGL 2 context can be created (cached). Three.js r163+ requires WebGL 2. */
export function webglAvailable(): boolean {
  if (probe !== null) return probe;
  try {
    if (typeof document === 'undefined') return (probe = false);
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    probe = Boolean(gl);
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    probe = false;
  }
  return probe;
}

export interface CreateRendererOptions {
  /** Force the lightweight 2D presentation. */
  fallback?: boolean;
}

/** Creates the best available renderer: 3D when WebGL works, otherwise the 2D presentation. */
export async function createMatchRenderer(opts: CreateRendererOptions = {}): Promise<StageRenderer> {
  if (!opts.fallback && webglAvailable()) {
    const { ThreeMatchRenderer } = await import('./three/ThreeMatchRenderer');
    return new ThreeMatchRenderer();
  }
  const { Fallback2DRenderer } = await import('./fallback2d/Fallback2DRenderer');
  return new Fallback2DRenderer();
}

let practiceChunk: Promise<unknown> | null = null;
let classicChunk: Promise<typeof import('./fallback2d/Fallback2DPracticeStage')> | null = null;

/** Classic Practice's code, fetched once and kept (a failed fetch is forgotten, so a later call tries again). */
function loadClassicStage(): Promise<typeof import('./fallback2d/Fallback2DPracticeStage')> {
  classicChunk ??= import('./fallback2d/Fallback2DPracticeStage').catch((err: unknown) => {
    classicChunk = null;
    throw err;
  });
  return classicChunk;
}

/**
 * Fetches Classic Practice's code now, while the network is there, so a later hand-over to Classic (a step down, a lost
 * graphics context, a new innings on a device placed in Classic) never needs a request: F-025, where a session that
 * went offline mid-over could not load it and stayed on "Getting the ground ready…". The first-person stage calls it
 * as soon as it is created. Never throws.
 */
export function preloadClassicStage(): void {
  loadClassicStage().catch(() => undefined);
}

/**
 * Starts fetching the Practice stage's code (the 3D stage, or Classic Practice without WebGL 2) so the first delivery
 * does not wait for it. Call it when the player reaches the Practice menu; it does nothing else and never throws.
 */
export function preloadPracticeStage(): void {
  if (practiceChunk) return;
  practiceChunk = (webglAvailable() ? import('./three/ThreePracticeStage') : loadClassicStage()).catch(() => {
    practiceChunk = null;
  });
}

/**
 * Creates the Practice stage: first-person 3D when WebGL 2 works, otherwise (or with `force2d`) Classic Practice on
 * Canvas 2D. Both implement PracticeStage and are code-split, so three.js loads only when the 3D stage is made. If the
 * 3D stage's mount throws or it emits 'fallback', dispose it and create one with { force2d: true }. Making the 3D stage
 * also fetches Classic's code (preloadClassicStage), so falling back later works offline.
 */
export async function createPracticeStage(opts: { force2d?: boolean } = {}): Promise<PracticeStage> {
  if (!opts.force2d && webglAvailable()) {
    const { ThreePracticeStage } = await import('./three/ThreePracticeStage');
    preloadClassicStage();
    return new ThreePracticeStage();
  }
  const { Fallback2DPracticeStage } = await loadClassicStage();
  return new Fallback2DPracticeStage();
}
