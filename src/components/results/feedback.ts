import { useApp } from './deps';

/** Short haptic tap for direct manipulation. Guarded: never throws, never required. */
export function pulseHaptic(): void {
  try {
    const enabled = useApp.getState().settings?.haptics ?? true;
    if (!enabled) return;
  } catch {
    /* store not ready — still try a light tap */
  }
  void import('@/audio/haptics')
    .then((m: Record<string, unknown>) => {
      const tap = m.tap ?? m.light ?? m.haptic;
      if (typeof tap === 'function') (tap as () => void)();
      else if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate?.(8);
    })
    .catch(() => {
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate?.(8);
    });
}
