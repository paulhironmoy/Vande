/**
 * Frame scheduling: a highlight is 30–60 s at 30 fps (HighlightRenderHost.load reports both). Frame i is drawn at
 * t = i × 1000 / fps ms exactly (no accumulated drift), and the last frame is the one before `durationMs`.
 */
export const FPS = 30;
export const MIN_MS = 30_000;
export const MAX_MS = 60_000;
export const WIDTH = 1080;
export const HEIGHT = 1920;

export interface Timeline {
  fps: number;
  durationMs: number;
  frames: number;
}

export function timeline(loaded: { durationMs: number; fps: number }): Timeline {
  if (loaded.fps !== FPS) throw new Error(`the render page must run at ${FPS} fps, not ${loaded.fps}`);
  if (!Number.isFinite(loaded.durationMs) || loaded.durationMs < MIN_MS || loaded.durationMs > MAX_MS) throw new Error(`a highlight is 30–60 s, not ${loaded.durationMs} ms`);
  return { fps: FPS, durationMs: loaded.durationMs, frames: Math.round((loaded.durationMs * FPS) / 1000) };
}

/** Time of frame `i` in ms. */
export function frameTime(i: number, fps = FPS): number {
  return (i * 1000) / fps;
}

export function* frameTimes(t: Timeline): Generator<{ index: number; tMs: number }> {
  for (let index = 0; index < t.frames; index++) yield { index, tMs: frameTime(index, t.fps) };
}
