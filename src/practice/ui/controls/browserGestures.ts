/**
 * While Practice is open a stroke must never become a browser gesture. The batting surface already refuses scrolling
 * (`touch-action: none`) and the page already refuses a pull-to-refresh (`overscroll-behavior-y`). What was left is the
 * horizontal overscroll: a two-finger sideways swipe on a laptop trackpad (macOS Chrome, Edge, Safari) navigates back,
 * and a sideways drag at the edge of an Android browser can too. Setting `overscroll-behavior: none` on the page keeps both
 * inside the game. The previous values are put back when Practice closes, so no other screen is changed.
 */
export function lockBrowserGestures(
  doc: Pick<Document, 'documentElement' | 'body'> | undefined = typeof document === 'undefined' ? undefined : document,
): () => void {
  const targets = [doc?.documentElement, doc?.body].filter((el): el is HTMLElement => Boolean(el));
  const before = targets.map((el) => el.style.overscrollBehavior);
  for (const el of targets) el.style.overscrollBehavior = 'none';
  return () => targets.forEach((el, i) => void (el.style.overscrollBehavior = before[i]));
}
