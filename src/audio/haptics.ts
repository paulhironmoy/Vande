/**
 * Optional haptic feedback: Capacitor Haptics on Android, navigator.vibrate on the web.
 */
export type HapticKind = 'light' | 'medium' | 'success' | 'warning' | 'error';

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
  success: [10, 40, 18],
  warning: [20, 60, 20],
  error: [30, 50, 30, 50, 30],
};

export function haptic(kind: HapticKind): void {
  if (!enabled) return;
  if (native) {
    void loadNative().then((mod) => {
      if (!mod) return;
      const { Haptics, ImpactStyle, NotificationType } = mod;
      try {
        if (kind === 'light') void Haptics.impact({ style: ImpactStyle.Light });
        else if (kind === 'medium') void Haptics.impact({ style: ImpactStyle.Medium });
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
