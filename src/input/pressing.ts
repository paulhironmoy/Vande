/**
 * Whether a pointer (a finger, a pen, a mouse button) is down anywhere on the page right now: a read-only signal for a
 * caller that must not settle a moment while a press could still become a gesture (the Practice flow's leave,
 * src/practice/ui/flow/delivery.ts: a finger resting on the batting surface can still start a swing).
 *
 * It listens on the window in the capture phase, passively: it never handles, prevents or changes an event, and the
 * gesture surface sees every event exactly as before. A press is forgotten at its pointerup or pointercancel, at a move
 * with no button held (a release outside the page), and when the page is hidden (a press interrupted by the system may
 * never report its release). Listening starts when this module loads in a browser.
 */
const down = new Set<number>();
let listening = false;

function listen(target: Window & typeof globalThis): void {
  if (listening) return;
  listening = true;
  const opts: AddEventListenerOptions = { capture: true, passive: true };
  const id = (e: Event) => (e as PointerEvent).pointerId;
  target.addEventListener('pointerdown', (e) => down.add(id(e)), opts);
  target.addEventListener('pointerup', (e) => down.delete(id(e)), opts);
  target.addEventListener('pointercancel', (e) => down.delete(id(e)), opts);
  target.addEventListener(
    'pointermove',
    (e) => {
      if ((e as PointerEvent).buttons === 0) down.delete(id(e));
    },
    opts,
  );
  target.document?.addEventListener('visibilitychange', () => {
    if (target.document.hidden) down.clear();
  });
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') listen(window);

/** True while any pointer is down on the page. */
export function pointerIsDown(): boolean {
  return down.size > 0;
}
