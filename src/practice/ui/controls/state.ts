/**
 * The control in force on this device, kept in the Practice settings (`control`, per device, null until the player
 * chooses). Everything that depends on the choice reads it from here: the first-ball lesson (what it teaches), the
 * haptics (a finger only), the camera (stopped the moment the control moves away from it) and the screens.
 *
 * Switching is allowed only between balls: `setControl` refuses while the flow says a delivery is under way, so no
 * screen has to remember that rule. Switching never touches a delivery, a seed or the physics.
 */
import { setHapticsInputAllowed } from '@/audio/haptics';
import { isNativePlatform } from '@/platform';
import { loadPracticeSettings, localStore, updatePracticeSettings, type KeyStore } from '@/practice/store';
import { setLessonControlProvider } from '../lesson/inputType';
import { lockBrowserGestures } from './browserGestures';
import { cameraBuilt, cameraPortNow } from './cameraPort';
import {
  controlFeelsHaptics,
  defaultControl,
  effectiveControl,
  readControlEnv,
  type ControlEnv,
  type ControlId,
} from './model';

const listeners = new Set<() => void>();
let guard: (() => boolean) | null = null;

/** The device as it is now (read when asked: a keyboard or a mouse can be plugged in while Practice is open). */
export function currentEnv(): ControlEnv {
  return readControlEnv(isNativePlatform());
}

/** What the player chose on this device, or null if they have not (then the device's default is in force). */
export function storedControl(store: KeyStore | null = localStore()): ControlId | null {
  return loadPracticeSettings(store).control;
}

/** The control in force: the stored choice if this device still offers it, else its default. */
export function currentControl(
  store: KeyStore | null = localStore(),
  env: ControlEnv = currentEnv(),
  built: boolean = cameraBuilt(),
): ControlId {
  return effectiveControl(storedControl(store), env, built);
}

/** "How do you want to bat?" has been answered (or accepted, or the player is a returning one): the setup row is not shown. */
export function controlIsChosen(store: KeyStore | null = localStore()): boolean {
  return loadPracticeSettings(store).controlChosen;
}

/** Haptics are for the finger only (the Vibration setting still applies). Read by the Unity stage at its creation. */
export function currentControlFeelsHaptics(store: KeyStore | null = localStore()): boolean {
  return controlFeelsHaptics(currentControl(store));
}

/** Where the flow says whether a delivery is under way (PracticeApp binds `!flow.busy()`); with no flow, switching is free. */
export function setControlGuard(canSwitch: (() => boolean) | null): void {
  guard = canSwitch;
}

export function canSwitchControl(): boolean {
  return guard ? guard() : true;
}

export function subscribeControl(cb: () => void): () => void {
  listeners.add(cb);
  return () => void listeners.delete(cb);
}

/** The effects of the control in force. Cheap and safe to repeat. */
export function applyControl(control: ControlId): void {
  setHapticsInputAllowed(controlFeelsHaptics(control));
  // The camera runs only while it is the control; moving away from it switches it off at once.
  if (control !== 'camera') cameraPortNow()?.stop();
}

/**
 * Stores the player's choice. False, and nothing changes, while a delivery is under way. For the camera, call it only
 * after the camera module said it is ready (see cameraPort.ts): then "remembered" means "it worked on this device".
 */
export function setControl(next: ControlId, store: KeyStore | null = localStore()): boolean {
  if (!canSwitchControl()) return false;
  updatePracticeSettings({ control: next, controlChosen: true }, store);
  applyControl(currentControl(store));
  notify();
  return true;
}

/**
 * The first ball was bowled without the row on the setup screen being touched: the player batted on with what was
 * already selected, so the device's default is kept and remembered (the choice never blocks a ball, and "Start" is an
 * answer). False when the choice had already been made.
 */
export function acceptDefaultControl(store: KeyStore | null = localStore(), env: ControlEnv = currentEnv()): boolean {
  if (controlIsChosen(store)) return false;
  updatePracticeSettings({ control: defaultControl(env), controlChosen: true }, store);
  applyControl(currentControl(store, env));
  notify();
  return true;
}

function notify(): void {
  for (const l of [...listeners]) l();
}

/**
 * Binds the choice to a Practice visit: the lesson teaches the chosen control, the haptics follow it, switching is
 * guarded by the flow, and the page refuses the browser's own sideways swipes. The returned function undoes all of it
 * (haptics and the page's overscroll are restored for the rest of the app).
 */
export function startControls(canSwitch: () => boolean, store: KeyStore | null = localStore()): () => void {
  const unlock = lockBrowserGestures();
  setControlGuard(canSwitch);
  setLessonControlProvider(() => (storedControl(store) === null ? null : currentControl(store)));
  applyControl(currentControl(store));
  return () => {
    unlock();
    setControlGuard(null);
    setLessonControlProvider(null);
    setHapticsInputAllowed(true);
    cameraPortNow()?.stop();
  };
}

/**
 * True only when the browser lists devices and none of them is a camera. An empty or failed list proves nothing (some
 * browsers list nothing until a camera has been allowed), so it is never read as "no camera".
 */
export async function noCameraDevice(
  media: { enumerateDevices?: () => Promise<ReadonlyArray<{ kind: string }>> } | undefined = typeof navigator ===
  'undefined'
    ? undefined
    : navigator.mediaDevices,
): Promise<boolean> {
  try {
    if (typeof media?.enumerateDevices !== 'function') return false;
    const list = await media.enumerateDevices();
    return list.length > 0 && !list.some((d) => d.kind === 'videoinput');
  } catch {
    return false;
  }
}
