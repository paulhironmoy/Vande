/**
 * "How do you want to bat?": the pure rules. Which controls a device offers, which one is its default, which one is in
 * force, and which of them feels haptics. Only `readControlEnv` looks at the browser, so everything else is tested
 * with plain objects.
 *
 * Every control ends as the same NormalizedSwing from the same GestureTracker and normalizeGesture
 * (docs/PRACTICE_INPUT.md). The choice decides what is taught, calibrated and felt, never a delivery or an outcome;
 * nothing in src/physics or src/practice/game reads it (tests/unit/practice/ui/controls/no-coupling.test.ts).
 *
 * Offers (the owner's second brief, section 0):
 * - the web: Mouse (the default) or Camera; a touch screen that also has a mouse or trackpad offers both pointers;
 * - the Android shell and any touch-only device: Touch (the default) or Camera;
 * - the keyboard is always an equivalent and is not a choice.
 * The camera is never the default and never required. It is not offered at all where this build has no camera module
 * (the camera pack is not in every build), and it is shown switched off, with a plain reason, where the browser has no
 * camera API (an insecure page, an old WebView) or the device has no camera.
 */
import type { BatControl } from '@/practice/store';

export type ControlId = BatControl;
export type PointerControl = 'mouse' | 'touch';

/** What the device can do, read once (it never changes the delivery; it only decides what is offered). */
export interface ControlEnv {
  /** The Android shell (Capacitor). */
  native: boolean;
  /** `(pointer: coarse)`: the main pointer is a finger. */
  primaryCoarse: boolean;
  /** `(any-pointer: coarse)`: some pointer is a finger. */
  anyCoarse: boolean;
  /** A mouse, trackpad or pen exists (`(any-pointer: fine)`), or the device says nothing about pointers (a desktop). */
  anyFine: boolean;
  /** The page is a secure context (https or localhost): the camera API only exists there. */
  secure: boolean;
  /** `navigator.mediaDevices.getUserMedia` exists. */
  cameraApi: boolean;
  /** The device list says there is no camera at all (known only after asking the browser; never guessed). */
  noCamera?: boolean;
}

/** Why the camera is switched off here (copy: practice.controls.unavailable.<reason>). */
export type CameraBlock = 'secure' | 'api' | 'device';

export interface ControlOption {
  id: ControlId;
  /** The device's own default (mouse or touch, never the camera). */
  isDefault: boolean;
  available: boolean;
  /** Only ever set for the camera, and only when it is shown switched off. */
  blocked: CameraBlock | null;
}

interface EnvSources {
  matchMedia?: (query: string) => { matches: boolean };
  isSecureContext?: boolean;
  navigator?: { mediaDevices?: { getUserMedia?: unknown } };
}

/** The device as it is now. `native` is `isNativePlatform()` (passed in, so tests need no Capacitor). */
export function readControlEnv(
  native: boolean,
  win: EnvSources | undefined = typeof window === 'undefined' ? undefined : (window as unknown as EnvSources),
): ControlEnv {
  const mm = (q: string): boolean => {
    try {
      return typeof win?.matchMedia === 'function' ? win.matchMedia(q).matches : false;
    } catch {
      return false;
    }
  };
  const anyCoarse = mm('(any-pointer: coarse)');
  const anyFine = mm('(any-pointer: fine)');
  return {
    native,
    primaryCoarse: mm('(pointer: coarse)'),
    anyCoarse,
    // A device that reports no pointer at all (a bare desktop browser) is treated as having a mouse.
    anyFine: anyFine || !anyCoarse,
    secure: win?.isSecureContext !== false,
    cameraApi: typeof win?.navigator?.mediaDevices?.getUserMedia === 'function',
  };
}

/** The pointer controls this device offers, the default first. */
export function pointerControls(env: ControlEnv): readonly PointerControl[] {
  if (env.native) return ['touch'];
  if (env.anyCoarse && env.anyFine) return env.primaryCoarse ? ['touch', 'mouse'] : ['mouse', 'touch'];
  return env.anyCoarse ? ['touch'] : ['mouse'];
}

/** What is in force until the player chooses: a finger on the Android shell and on touch-first devices, else the mouse. */
export function defaultControl(env: ControlEnv): PointerControl {
  return pointerControls(env)[0];
}

/** Why the camera is switched off here, or null when the browser can offer it. */
export function cameraBlock(env: ControlEnv): CameraBlock | null {
  if (!env.cameraApi) return env.secure ? 'api' : 'secure';
  return env.noCamera ? 'device' : null;
}

/**
 * The options in display order: the pointer controls (default first), then the camera. A build without the camera
 * module (`cameraBuilt` false) offers no camera at all.
 */
export function controlOptions(env: ControlEnv, cameraBuilt: boolean): ControlOption[] {
  const pointers = pointerControls(env);
  const options = pointers.map((id, i): ControlOption => ({ id, isDefault: i === 0, available: true, blocked: null }));
  if (!cameraBuilt) return options;
  const blocked = cameraBlock(env);
  return [...options, { id: 'camera', isDefault: false, available: blocked === null, blocked }];
}

/**
 * The control in force: the stored choice when this device still offers it, else the device's default. A stored
 * camera on a device whose browser no longer has the camera API falls back to the default without forgetting the
 * choice, so it returns when the camera does.
 */
export function effectiveControl(stored: ControlId | null, env: ControlEnv, cameraBuilt = true): ControlId {
  if (stored) {
    const offered = controlOptions(env, cameraBuilt).find((o) => o.id === stored);
    if (offered?.available) return stored;
  }
  return defaultControl(env);
}

/** Haptics belong to the finger only: the mouse and the camera get sound and picture (the camera's phone is propped up). */
export function controlFeelsHaptics(control: ControlId): boolean {
  return control === 'touch';
}
