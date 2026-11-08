/**
 * Large text on a short screen. A screen is "short for its text" when its height is under 20 rem: 480 px at the
 * default size, 640 px at 200% text (the root font size is `16px * --text-scale`, base.css). At the default size no
 * phone in landscape (360 px and up) is short; at 200% every phone is, and a 1280x800 window is not.
 *
 * The Practice screens use it to stop spending the page on fixed bars: the title bar scrolls with the content, the
 * bottom bar becomes one slim primary-action bar, the setup's two columns become one, and the dead-ball card becomes a
 * single scrolling sheet (Screen.module.css, Setup.module.css, ResultLayer.module.css). Everything stays reachable.
 *
 * A media query cannot see the text scale (its rem is the browser's), so this reads the root font size and the
 * viewport height and follows both: a resize, a turn of the phone, the player changing the text size, or a stylesheet that
 * changes the root size.
 */
import { useSyncExternalStore } from 'react';

/** The height, in root rem, under which a screen counts as short for its text. */
export const SHORT_REM = 20;

/** True when the viewport is under SHORT_REM root-rem tall (pure; the hook below reads the DOM). */
export function isLargeShort(viewportHeightPx: number, rootFontPx: number): boolean {
  const rem = Number.isFinite(rootFontPx) && rootFontPx > 0 ? rootFontPx : 16;
  return viewportHeightPx > 0 && viewportHeightPx < SHORT_REM * rem;
}

function read(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  try {
    return isLargeShort(window.innerHeight, parseFloat(getComputedStyle(document.documentElement).fontSize));
  } catch {
    return false;
  }
}

function subscribe(notify: () => void): () => void {
  window.addEventListener('resize', notify);
  window.addEventListener('orientationchange', notify);
  // The text size is the root's `--text-scale` (UiProvider): it arrives as a change of the root's style attribute.
  let observer: MutationObserver | null = null;
  if (typeof MutationObserver !== 'undefined') {
    observer = new MutationObserver(notify);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class'] });
    // A stylesheet added or removed at run time can change the root size too (the accessibility specs set 200% so).
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
  }
  return () => {
    window.removeEventListener('resize', notify);
    window.removeEventListener('orientationchange', notify);
    observer?.disconnect();
  };
}

/** Whether the screen is short for its text right now (see the file's comment). */
export function useLargeShort(): boolean {
  return useSyncExternalStore(subscribe, read, () => false);
}
