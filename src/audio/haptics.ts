/**
 * Optional haptic feedback: Capacitor Haptics on Android, navigator.vibrate on the web. Respects the Vibration
 * setting (setHapticsEnabled), never fires while the app is in the background, and is never the only signal for
 * anything. On Android the system's own "Vibration and haptics" switch also applies (the Vibrator honours it).
 */
import { FEEL_PATTERNS, type FeelPattern } from './feel';

export type HapticKind = 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error';

let enabled = true;
let native = false;
let hapticsModule: Promise<typeof import('@capacitor/haptics') | null> | null = null;

export function setHapticsEnabled(v: boolean): void {
  enabled = v;
}

export function setHapticsNative(v: boolean): void {
  native = v;
}

function loadNative() {
  if (!hapticsModule) {
    hapticsModule = import('@capacitor/haptics').catch(() => null);
  }
  return hapticsModule;
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
  if (!enabled || (typeof document !== 'undefined' && document.visibilityState === 'hidden')) return;
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
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(WEB_PATTERNS[kind]);
  } catch {
    /* ignore */
  }
}

/** One of the batter's patterns (src/audio/feel.ts), as written: the web's vibrate pattern, or timed native impacts. */
export function hapticPattern(pattern: FeelPattern): void {
  if (!enabled || (typeof document !== 'undefined' && document.visibilityState === 'hidden')) return;
  const spec = FEEL_PATTERNS[pattern];
  if (native) {
    void loadNative().then((mod) => {
      if (!mod) return;
      const { Haptics, ImpactStyle } = mod;
      const style = { light: ImpactStyle.Light, medium: ImpactStyle.Medium, heavy: ImpactStyle.Heavy } as const;
      for (const [at, s] of spec.native) {
        const go = () => {
          try {
            void Haptics.impact({ style: style[s] });
          } catch {
            /* ignore */
          }
        };
        if (at <= 0) go();
        else setTimeout(go, at);
      }
    });
    return;
  }
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(spec.web);
  } catch {
    /* ignore */
  }
}
