/**
 * Optional haptic feedback: Capacitor Haptics on Android, navigator.vibrate on the web. Respects the Vibration
 * setting (setHapticsEnabled), never fires while the app is in the background, and is never the only signal for
 * anything. On Android the system's own "Vibration and haptics" switch also applies (the Vibrator honours it).
 */
import { FEEL_PATTERNS, createFeelScheduler, type FeelPattern, type NativeStep } from './feel';
import { logAudio } from './timingLog';

export type HapticKind = 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error';

let enabled = true;
/**
 * Whether the way the player bats feels haptics (src/practice/ui/controls): a finger does; the mouse and the camera get
 * sound and picture instead (a phone propped up for the camera must not shake). The Vibration setting still applies.
 */
let inputAllows = true;
let native = false;
let hapticsModule: Promise<typeof import('@capacitor/haptics') | null> | null = null;

export function setHapticsEnabled(v: boolean): void {
  enabled = v;
}

export function setHapticsNative(v: boolean): void {
  native = v;
}

export function setHapticsInputAllowed(v: boolean): void {
  inputAllows = v;
}

/** Vibration is on in Settings and the player's chosen way of batting feels it. */
const allowed = () => enabled && inputAllows;

let nativeMod: typeof import('@capacitor/haptics') | null = null;

function loadNative() {
  if (!hapticsModule) {
    hapticsModule = import('@capacitor/haptics').then((mod) => (nativeMod = mod)).catch(() => null);
  }
  return hapticsModule;
}

const hidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';

/** One native step of a pattern (setTimeout passes the step: no closure per step). */
function nativeStep(step: NativeStep): void {
  const mod = nativeMod;
  if (!mod || !allowed() || hidden()) return;
  try {
    if (step[1] === 'vibrate') void mod.Haptics.vibrate({ duration: step[2] });
    else
      void mod.Haptics.impact({
        style:
          step[1] === 'light'
            ? mod.ImpactStyle.Light
            : step[1] === 'medium'
              ? mod.ImpactStyle.Medium
              : mod.ImpactStyle.Heavy,
      });
  } catch {
    /* ignore */
  }
}

function playNative(steps: readonly NativeStep[]): void {
  for (const step of steps) {
    if (step[0] <= 0) nativeStep(step);
    else setTimeout(nativeStep, step[0], step);
  }
}

const WEB_PATTERNS: Record<HapticKind, number | number[]> = {
  light: 8,
  medium: 16,
  heavy: [28, 40, 18],
  success: [10, 40, 18],
  warning: [20, 60, 20],
  error: [30, 50, 30, 50, 30],
};

export function haptic(kind: HapticKind): void {
  // Off in Settings, or the app is in the background: no vibration.
  if (!allowed() || (typeof document !== 'undefined' && document.visibilityState === 'hidden')) return;
  if (native) {
    void loadNative().then((mod) => {
      if (!mod) return;
      const { Haptics, ImpactStyle, NotificationType } = mod;
      try {
        if (kind === 'light') void Haptics.impact({ style: ImpactStyle.Light });
        else if (kind === 'medium') void Haptics.impact({ style: ImpactStyle.Medium });
        else if (kind === 'heavy') void Haptics.impact({ style: ImpactStyle.Heavy });
        else if (kind === 'success') void Haptics.notification({ type: NotificationType.Success });
        else if (kind === 'warning') void Haptics.notification({ type: NotificationType.Warning });
        else void Haptics.notification({ type: NotificationType.Error });
      } catch {
        /* ignore */
      }
    });
    return;
  }
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function')
      navigator.vibrate(WEB_PATTERNS[kind]);
  } catch {
    /* ignore */
  }
}

/** One of the batter's patterns (src/audio/feel.ts), as written: the web's vibrate pattern, or timed native impacts. */
export function hapticPattern(pattern: FeelPattern): void {
  if (!allowed() || hidden()) return;
  logAudio('haptic', pattern, typeof performance !== 'undefined' ? performance.now() : Date.now());
  const spec = FEEL_PATTERNS[pattern];
  if (native) {
    if (nativeMod) playNative(spec.native);
    else void loadNative().then((mod) => mod && playNative(spec.native));
    return;
  }
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(spec.web);
  } catch {
    /* ignore */
  }
}

/** Every pattern goes through one scheduler, so no two ever start within 60 ms of each other (src/audio/feel.ts). */
const scheduler = createFeelScheduler({
  now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
  emit: (pattern) => hapticPattern(pattern),
});

/** Plays a pattern through the shared scheduler (nothing while Vibration is off). */
export function playFeel(pattern: FeelPattern): void {
  if (allowed()) scheduler.play(pattern);
}

export const hapticsEnabled = () => allowed();
