/** Optional sound/haptic cues. Both modules are provided by the app shell; failures are ignored. */
export type CueName = 'confirm' | 'verify' | 'warning' | 'danger' | 'tick' | 'open' | 'close' | 'undo';
export type BuzzKind = 'light' | 'medium' | 'heavy' | 'warning';

export function cue(sound: CueName, haptic?: BuzzKind): void {
  try {
    void import('@/audio/sounds')
      .then((m) => {
        const play = (m as { play?: (name: string) => void }).play;
        if (typeof play === 'function') play(sound);
      })
      .catch(() => {});
  } catch {
    /* ignore */
  }
  if (haptic) {
    try {
      void import('@/audio/haptics')
        .then((m) => {
          const buzz = (m as { buzz?: (kind: string) => void }).buzz;
          if (typeof buzz === 'function') buzz(haptic);
        })
        .catch(() => {});
    } catch {
      /* ignore */
    }
  }
}
