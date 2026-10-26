/**
 * Landscape for live batting (menus stay free to rotate). Android: the Capacitor Screen Orientation plugin locks the
 * activity. Web: the Screen Orientation API, which browsers only honour in fullscreen, so `lockLandscape` asks for
 * fullscreen first; call it straight from a tap, because fullscreen needs the tap's user activation. When nothing
 * can lock (desktop browsers, iOS Safari, a refused request), the caller shows a "turn your phone" overlay while the
 * viewport is portrait, before the delivery starts.
 */
import type { ScreenOrientationPlugin } from '@capacitor/screen-orientation';
import { isNativePlatform, nativePlugin } from './capacitor';

/** How landscape was obtained: the native lock, the web lock in fullscreen, or none (rely on the overlay). */
export type LandscapeLock = 'native' | 'web' | 'none';

let enteredFullscreen = false;
let locked: LandscapeLock = 'none';

type LockableOrientation = ScreenOrientation & { lock?: (o: string) => Promise<void>; unlock?: () => void };

function webOrientation(): LockableOrientation | null {
  try {
    return typeof screen !== 'undefined' && screen.orientation ? (screen.orientation as LockableOrientation) : null;
  } catch {
    return null;
  }
}

/** A fine pointer and no touch: a desktop browser, where rotating is not a thing to ask for. */
export function prefersPointerFine(): boolean {
  try {
    return typeof window !== 'undefined' && window.matchMedia?.('(pointer: fine)').matches === true && window.matchMedia?.('(any-pointer: coarse)').matches !== true;
  } catch {
    return false;
  }
}

/** Whether the viewport is landscape now (width at least its height). */
export function isLandscapeViewport(): boolean {
  if (typeof window === 'undefined') return true;
  return window.innerWidth >= window.innerHeight;
}

/** Calls `cb` with isLandscapeViewport() whenever the viewport rotates or resizes. */
export function onViewportOrientation(cb: (landscape: boolean) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  let last = isLandscapeViewport();
  const check = () => {
    const now = isLandscapeViewport();
    if (now !== last) {
      last = now;
      cb(now);
    }
  };
  window.addEventListener('resize', check);
  window.addEventListener('orientationchange', check);
  const o = webOrientation();
  o?.addEventListener?.('change', check);
  return () => {
    window.removeEventListener('resize', check);
    window.removeEventListener('orientationchange', check);
    o?.removeEventListener?.('change', check);
  };
}

/**
 * Locks landscape. Must be called synchronously inside a tap handler on the web: the fullscreen request is made
 * before the first await. Resolves with how it locked; never rejects.
 */
export function lockLandscape(): Promise<LandscapeLock> {
  if (isNativePlatform()) {
    return nativePlugin<ScreenOrientationPlugin>('ScreenOrientation')
      .then(async (box): Promise<LandscapeLock> => {
        if (!box) return 'none';
        await box.plugin.lock({ orientation: 'landscape' });
        return (locked = 'native');
      })
      .catch((): LandscapeLock => 'none');
  }
  const o = webOrientation();
  if (!o?.lock || typeof document === 'undefined' || prefersPointerFine()) return Promise.resolve('none');
  const root = document.documentElement as HTMLElement & { requestFullscreen?: (opts?: FullscreenOptions) => Promise<void> };
  let fullscreen: Promise<void> = Promise.resolve();
  if (!document.fullscreenElement && typeof root.requestFullscreen === 'function') {
    try {
      // Synchronous call while the tap's activation is live.
      fullscreen = root.requestFullscreen({ navigationUI: 'hide' }).then(() => {
        enteredFullscreen = true;
      });
    } catch {
      fullscreen = Promise.reject(new Error('fullscreen refused'));
    }
  }
  return fullscreen
    .then(() => o.lock!('landscape'))
    .then((): LandscapeLock => (locked = 'web'))
    .catch((): LandscapeLock => 'none');
}

/** Releases the lock (and the fullscreen it needed); safe to call when nothing was locked. */
export async function unlockOrientation(): Promise<void> {
  const was = locked;
  locked = 'none';
  try {
    if (was === 'native') {
      const box = await nativePlugin<ScreenOrientationPlugin>('ScreenOrientation');
      await box?.plugin.unlock();
      return;
    }
    webOrientation()?.unlock?.();
  } catch {
    /* nothing to release */
  }
  if (enteredFullscreen && typeof document !== 'undefined' && document.fullscreenElement) {
    enteredFullscreen = false;
    try {
      await document.exitFullscreen();
    } catch {
      /* already left */
    }
  }
}

/** The current lock (diagnostics). */
export function currentLandscapeLock(): LandscapeLock {
  return locked;
}
