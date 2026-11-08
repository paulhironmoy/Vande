/**
 * The real GestureSurface under the two pointer controls (CTR-04, CTR-05): a mouse and a finger press, capture the pointer
 * so a stroke that leaves the surface still arrives, a right or middle button never starts a stroke, and a context menu
 * never opens over a delivery. Touch footwork (F-027): where the press lands picks the foot, for a finger and a mouse alike.
 * DOM semantics in jsdom; real hit-testing, capture across the window edge and cursors are the browser specs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import type { Footwork, GestureInput } from '@/contracts/practice';
import { GestureSurface } from '@/input';
import { PRESS_FOOTWORK } from '@/input/constants';

const SURFACE = { width: 915, height: 190 };

function pointer(
  type: string,
  o: { kind: 'mouse' | 'touch' | 'pen'; x: number; y: number; button?: number; id?: number },
) {
  return new PointerEvent(type, {
    pointerId: o.id ?? 1,
    pointerType: o.kind,
    clientX: o.x,
    clientY: o.y,
    button: o.button ?? 0,
    bubbles: true,
    cancelable: true,
  });
}

function mount(props: { pressFootwork?: boolean; enabled?: boolean } = {}) {
  const starts: Array<{ pointer: string; footwork: Footwork }> = [];
  const gestures: GestureInput[] = [];
  const { container } = render(
    <GestureSurface
      enabled={props.enabled ?? true}
      pressFootwork={props.pressFootwork}
      onSwingStart={(_t, p, f) => starts.push({ pointer: p, footwork: f })}
      onGesture={(g) => gestures.push(g)}
    />,
  );
  const el = container.firstElementChild as HTMLElement;
  const capture = vi.fn();
  const release = vi.fn();
  el.setPointerCapture = capture;
  el.releasePointerCapture = release;
  el.hasPointerCapture = () => true;
  return { el, starts, gestures, capture, release };
}

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    right: SURFACE.width,
    bottom: SURFACE.height,
    width: SURFACE.width,
    height: SURFACE.height,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
});
afterEach(cleanup);

describe('capture: a stroke that leaves the surface still arrives', () => {
  for (const kind of ['mouse', 'touch'] as const) {
    it(`a ${kind} press captures its pointer, and the lift releases it`, () => {
      const t = mount();
      act(() => void t.el.dispatchEvent(pointer('pointerdown', { kind, x: 400, y: 100 })));
      expect(t.capture).toHaveBeenCalledWith(1);
      act(() => void t.el.dispatchEvent(pointer('pointerup', { kind, x: 400, y: 100 })));
      expect(t.release).toHaveBeenCalledWith(1);
    });
  }

  it('a failing capture (an old engine) does not stop the stroke from starting', () => {
    const t = mount();
    t.el.setPointerCapture = () => {
      throw new Error('InvalidStateError');
    };
    act(() => void t.el.dispatchEvent(pointer('pointerdown', { kind: 'mouse', x: 400, y: 100 })));
    expect(t.starts).toHaveLength(1);
  });
});

describe('the mouse buttons', () => {
  it('only the main button starts a stroke; the right and middle buttons are ignored', () => {
    const t = mount();
    act(() => void t.el.dispatchEvent(pointer('pointerdown', { kind: 'mouse', x: 400, y: 100, button: 2 })));
    act(() => void t.el.dispatchEvent(pointer('pointerdown', { kind: 'mouse', x: 400, y: 100, button: 1 })));
    expect(t.starts).toHaveLength(0);
    act(() => void t.el.dispatchEvent(pointer('pointerdown', { kind: 'mouse', x: 400, y: 100, button: 0 })));
    expect(t.starts).toEqual([{ pointer: 'mouse', footwork: 'auto' }]);
  });

  it('a context menu never opens over the batting surface while a delivery is armed', () => {
    const t = mount();
    const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 });
    act(() => void t.el.dispatchEvent(menu));
    expect(menu.defaultPrevented).toBe(true);
  });

  it('and between balls the surface leaves the browser alone (nothing is prevented when it is not armed)', () => {
    const t = mount({ enabled: false });
    const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 });
    act(() => void t.el.dispatchEvent(menu));
    expect(menu.defaultPrevented).toBe(false);
  });
});

describe('touch footwork follows where the press lands (F-027)', () => {
  const at = (frac: number) => Math.round(SURFACE.height * frac);

  it('a press high in the batting area steps forward, low goes back, the middle keeps the footwork', () => {
    const results: Footwork[] = [];
    for (const frac of [0.1, PRESS_FOOTWORK.forwardAbove - 0.02, 0.5, PRESS_FOOTWORK.backBelow + 0.02, 0.95]) {
      const t = mount({ pressFootwork: true });
      act(() => void t.el.dispatchEvent(pointer('pointerdown', { kind: 'touch', x: 400, y: at(frac) })));
      results.push(t.starts[0].footwork);
      cleanup();
    }
    expect(results).toEqual(['forward', 'forward', 'auto', 'back', 'back']);
  });

  it("is off until it is introduced: a rookie's press position never chooses a foot", () => {
    for (const frac of [0.1, 0.95]) {
      const t = mount();
      act(() => void t.el.dispatchEvent(pointer('pointerdown', { kind: 'touch', x: 400, y: at(frac) })));
      expect(t.starts[0].footwork).toBe('auto');
      cleanup();
    }
  });

  it('a mouse press picks the foot the same way', () => {
    const t = mount({ pressFootwork: true });
    act(() => void t.el.dispatchEvent(pointer('pointerdown', { kind: 'mouse', x: 400, y: at(0.1) })));
    expect(t.starts[0]).toEqual({ pointer: 'mouse', footwork: 'forward' });
  });
});

describe('browser gestures', () => {
  it('the surface and its press leave no room for a scroll or a long-press menu', () => {
    const t = mount();
    expect(t.el.style.touchAction).toBe('none');
    expect(t.el.style.userSelect).toBe('none');
    expect(t.el.style.cursor).toBe('crosshair');
    const down = pointer('pointerdown', { kind: 'touch', x: 400, y: 100 });
    act(() => void t.el.dispatchEvent(down));
    expect(down.defaultPrevented).toBe(true);
  });

  it('the cursor is visible when armed and plain when not (never hidden)', () => {
    const armed = mount();
    expect(armed.el.style.cursor).toBe('crosshair');
    cleanup();
    const idle = mount({ enabled: false });
    expect(idle.el.style.cursor).toBe('default');
  });
});
