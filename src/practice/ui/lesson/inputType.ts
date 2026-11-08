/**
 * Which batting input the first-ball lesson teaches. Touch, mouse, pen and keyboard are the four kinds of input the
 * GestureSurface reads (docs/PRACTICE_INPUT.md); the camera is the fifth, and it reaches the lesson only through the
 * small port below (it never hands the lesson a frame, a landmark or a swing the physics sees).
 *
 * The card starts with the kind of input the device most likely has, then follows what the player actually uses:
 * a mouse that moves, a pen over the glass, a key, a finger.
 */

import type { ComponentType } from 'react';
import type { Handedness, NormalizedSwing } from '@/contracts';

export type LessonInput = 'touch' | 'mouse' | 'pen' | 'keyboard' | 'camera';

export const LESSON_INPUTS: readonly LessonInput[] = ['touch', 'mouse', 'pen', 'keyboard', 'camera'];

/** The picture the camera lesson shows (CAMERA-UX's silhouette): decoration, with a still form for Reduced Motion. */
export type LessonCue = ComponentType<{ play: boolean; label: string; handedness?: Handedness }>;

/** What the lesson needs to know about the camera (src/practice/ui/camera registers one when the camera is chosen). */
export interface LessonCameraPort {
  /** True when the player chose the camera as the batting input in this visit. */
  active(): boolean;
  /** True while a person is tracked well enough to swing; false is "tracking lost". */
  tracking(): boolean;
  /** Called after either value changes. Returns the unsubscribe. */
  subscribe(cb: () => void): () => void;
  /**
   * Optional. The NormalizedSwing the camera's own tracker made while the lesson is open (a dry swing: nothing is bowled).
   * Never video, never landmarks. Without it the camera lesson works without a try-out.
   */
  onSwing?(cb: (swing: NormalizedSwing) => void): () => void;
  /** Optional. CAMERA-UX's silhouette for the camera lesson; without it the lesson draws its own two dots. */
  Cue?: LessonCue;
}

let cameraPort: LessonCameraPort | null = null;
const portListeners = new Set<() => void>();

/** The camera input registers itself here when it is loaded; null when it goes away. */
export function setLessonCameraPort(port: LessonCameraPort | null): void {
  cameraPort = port;
  for (const l of portListeners) l();
}

export function lessonCameraPort(): LessonCameraPort | null {
  return cameraPort;
}

/** Subscribes to the registered port changing (and to the port's own changes). */
export function subscribeLessonCamera(cb: () => void): () => void {
  portListeners.add(cb);
  const off = cameraPort?.subscribe(cb);
  return () => {
    portListeners.delete(cb);
    off?.();
  };
}

let controlProvider: (() => LessonInput | null) | null = null;

/** The control the player chose on this device ("How do you want to bat?", src/practice/ui/controls), or null. */
export function setLessonControlProvider(provider: (() => LessonInput | null) | null): void {
  controlProvider = provider;
}

/**
 * The input the card starts with: the control the player chose for this device; otherwise what the device most likely
 * has before any is used (a touch screen means touch, a fine pointer mouse, neither known touch). A chosen camera wins.
 */
export function defaultLessonInput(
  env: { coarse?: boolean; fine?: boolean; camera?: boolean; chosen?: LessonInput | null } = browserEnv(),
): LessonInput {
  if (env.chosen) return env.chosen;
  if (env.camera) return 'camera';
  if (env.coarse) return 'touch';
  if (env.fine) return 'mouse';
  return 'touch';
}

function browserEnv(): { coarse: boolean; fine: boolean; camera: boolean; chosen: LessonInput | null } {
  let coarse = false;
  let fine = false;
  try {
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      coarse = window.matchMedia('(any-pointer: coarse)').matches;
      fine = window.matchMedia('(pointer: fine)').matches || window.matchMedia('(any-pointer: fine)').matches;
    }
  } catch {
    /* no media queries: the default below */
  }
  let camera: boolean;
  try {
    camera = cameraPort?.active() === true;
  } catch {
    camera = false;
  }
  let chosen: LessonInput | null;
  try {
    chosen = controlProvider?.() ?? null;
  } catch {
    chosen = null;
  }
  return { coarse, fine, camera, chosen };
}

/** The lesson input for a pointer event's type ('mouse' | 'pen' | 'touch'), or null for anything else. */
export function lessonInputOfPointerType(type: string): LessonInput | null {
  return type === 'mouse' || type === 'pen' || type === 'touch' ? type : null;
}
