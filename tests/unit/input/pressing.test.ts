/**
 * The read-only "a pointer is down" signal (src/input/pressing.ts): it follows presses on the page, forgets a press at
 * its release, cancel, a buttonless move or a hidden page, and never touches an event (the gesture surface's own
 * handling is unchanged).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { pointerIsDown } from '@/input';

const fire = (type: string, pointerId: number, init: PointerEventInit = {}, target: EventTarget = document.body) => {
  const e = new PointerEvent(type, { pointerId, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(e);
  return e;
};

afterEach(() => {
  for (const id of [1, 2, 3]) fire('pointercancel', id);
});

describe('pointerIsDown', () => {
  it('is false with no press, true while one is down, false after its release', () => {
    expect(pointerIsDown()).toBe(false);
    fire('pointerdown', 1, { buttons: 1 });
    expect(pointerIsDown()).toBe(true);
    fire('pointerup', 1);
    expect(pointerIsDown()).toBe(false);
  });

  it('counts each pointer: still down until every press is released or cancelled', () => {
    fire('pointerdown', 1, { buttons: 1 });
    fire('pointerdown', 2, { buttons: 1 });
    fire('pointerup', 1);
    expect(pointerIsDown()).toBe(true);
    fire('pointercancel', 2);
    expect(pointerIsDown()).toBe(false);
  });

  it('a move with no button held forgets that press (a release outside the page); a move while held does not', () => {
    fire('pointerdown', 3, { buttons: 1 });
    fire('pointermove', 3, { buttons: 1 });
    expect(pointerIsDown()).toBe(true);
    fire('pointermove', 3, { buttons: 0 });
    expect(pointerIsDown()).toBe(false);
  });

  it('a hidden page forgets every press', () => {
    fire('pointerdown', 1, { buttons: 1 });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    try {
      document.dispatchEvent(new Event('visibilitychange'));
    } finally {
      delete (document as { hidden?: boolean }).hidden;
    }
    expect(pointerIsDown()).toBe(false);
  });

  it('never prevents, stops or otherwise changes the event', () => {
    let seen = 0;
    const el = document.createElement('div');
    document.body.appendChild(el);
    el.addEventListener('pointerdown', () => seen++);
    const e = fire('pointerdown', 1, { buttons: 1 }, el);
    expect(seen).toBe(1);
    expect(e.defaultPrevented).toBe(false);
    el.remove();
  });
});
