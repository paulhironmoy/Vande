/**
 * The device's say over sound. Where the browser has the Audio Session API, web audio joins the 'ambient' session:
 * the ringer (silent) switch mutes it and music the player is listening to keeps playing. Android's WebView plays
 * through the media stream, so the media volume (and muting it) applies as for any game. Nothing plays or vibrates
 * while the app is hidden.
 */
export function pageHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

const listeners = new Set<(hidden: boolean) => void>();
let listening = false;

/** Called with true when the app goes to the background and false when it returns. */
export function onVisibility(fn: (hidden: boolean) => void): () => void {
  listeners.add(fn);
  if (!listening && typeof document !== 'undefined') {
    listening = true;
    document.addEventListener('visibilitychange', () => {
      const hidden = pageHidden();
      for (const l of listeners) l(hidden);
    });
  }
  return () => listeners.delete(fn);
}

let joined = false;

export function joinAmbientSession(): void {
  if (joined) return;
  joined = true;
  try {
    const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
    if (session) session.type = 'ambient';
  } catch {
    /* no audio session API */
  }
}
