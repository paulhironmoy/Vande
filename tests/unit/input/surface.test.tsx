import { describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import type { GestureInput } from '@/contracts/practice';
import { GestureSurface, normalizeGesture, type SwingIntent } from '@/input';
import { KEYBOARD, LATE_SAMPLE_WAIT_MS, TAP_HOLD_MS } from '@/input/constants';

function pointer(type: string, init: { id?: number; kind?: string; x: number; y: number }) {
  return new PointerEvent(type, {
    pointerId: init.id ?? 1,
    pointerType: init.kind ?? 'touch',
    clientX: init.x,
    clientY: init.y,
    bubbles: true,
    cancelable: true,
    button: 0,
  });
}
const key = (code: string, shiftKey = false) =>
  new KeyboardEvent('keydown', { code, shiftKey, bubbles: true, cancelable: true });

describe('GestureSurface', () => {
  it('sits across the lower part of the screen and blocks browser gestures', () => {
    const { container } = render(<GestureSurface enabled onGesture={() => undefined} label="Batting area" />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.style.bottom).toBe('0px');
    expect(el.style.height).toBe('46%');
    expect(el.style.touchAction).toBe('none');
    expect(el.getAttribute('aria-label')).toBe('Batting area');
    cleanup();
  });

  it('reports the ready cue synchronously but a held finger never plays an automatic shot', () => {
    vi.useFakeTimers();
    const starts: Array<[number, string]> = [];
    const intents: SwingIntent[] = [];
    const gestures: GestureInput[] = [];
    const { container } = render(
      <GestureSurface
        enabled
        onSwingStart={(t, p) => starts.push([t, p])}
        onIntent={(i) => intents.push(i)}
        onGesture={(g) => gestures.push(g)}
      />,
    );
    const el = container.firstElementChild as HTMLElement;
    let down!: PointerEvent;
    act(() => {
      down = pointer('pointerdown', { x: 50, y: 40 });
      el.dispatchEvent(down);
      // Synchronous: the stage hears of the press before the handler has returned.
      expect(starts).toHaveLength(1);
    });
    expect(down.defaultPrevented).toBe(true);
    expect(Number.isFinite(starts[0][0])).toBe(true);
    expect(starts[0][1]).toBe('touch');
    // A press held still is not yet a tap: it may still swipe.
    act(() => {
      vi.advanceTimersByTime(TAP_HOLD_MS - 30);
    });
    expect(gestures).toHaveLength(0);
    act(() => {
      vi.advanceTimersByTime(30 + LATE_SAMPLE_WAIT_MS + 5);
    });
    expect(gestures).toHaveLength(0);
    expect(intents).toHaveLength(0);
    // jsdom's event timestamp is independent of fake timers: provide the actual
    // elapsed event time so this exercises holding, not a newly created quick tap.
    act(() => {
      const up = pointer('pointerup', { x: 50, y: 40 });
      Object.defineProperty(up, 'timeStamp', { value: down.timeStamp + TAP_HOLD_MS + 45 });
      el.dispatchEvent(up);
    });
    expect(gestures).toHaveLength(0);
    cleanup();
    vi.useRealTimers();
  });

  it('a tap lifted quickly is handed over at the lift', () => {
    const gestures: GestureInput[] = [];
    const { container } = render(<GestureSurface enabled onGesture={(g) => gestures.push(g)} />);
    const el = container.firstElementChild as HTMLElement;
    act(() => {
      el.dispatchEvent(pointer('pointerdown', { x: 50, y: 40 }));
      el.dispatchEvent(pointer('pointerup', { x: 51, y: 40 }));
    });
    expect(gestures).toHaveLength(1);
    cleanup();
  });

  it('forwards cancellation of a provisional intent and accepts the next stroke without rearming', () => {
    const gestures: GestureInput[] = [];
    const intents: SwingIntent[] = [];
    const cancel = vi.fn();
    const { container } = render(
      <GestureSurface
        enabled
        onGesture={(g) => gestures.push(g)}
        onIntent={(i) => intents.push(i)}
        onCancel={cancel}
      />,
    );
    const el = container.firstElementChild as HTMLElement;
    act(() => {
      const down = pointer('pointerdown', { x: 50, y: 80 });
      el.dispatchEvent(down);
      const move = pointer('pointermove', { x: 50, y: 40 });
      Object.defineProperty(move, 'timeStamp', { value: down.timeStamp + 20 });
      el.dispatchEvent(move);
      expect(intents).toHaveLength(1);
      el.dispatchEvent(pointer('pointercancel', { x: 50, y: 40 }));
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(gestures).toHaveLength(0);
      el.dispatchEvent(pointer('pointerdown', { id: 2, x: 50, y: 40 }));
      el.dispatchEvent(pointer('pointerup', { id: 2, x: 51, y: 40 }));
    });
    expect(gestures).toHaveLength(1);
    expect(intents.map((i) => i.kind)).toEqual(['attack', 'defend']);
    cleanup();
  });

  it('defends on Space while enabled, ignores it while disabled, and re-arms per delivery', () => {
    const gestures: GestureInput[] = [];
    const ui = (enabled: boolean, k: number) => (
      <GestureSurface enabled={enabled} deliveryKey={k} onGesture={(g) => gestures.push(g)} />
    );
    const { rerender } = render(ui(false, 0));
    act(() => {
      window.dispatchEvent(key('Space'));
    });
    expect(gestures).toHaveLength(0);
    rerender(ui(true, 0));
    let ev!: KeyboardEvent;
    act(() => {
      ev = key('Space');
      window.dispatchEvent(ev);
    });
    expect(gestures).toHaveLength(1);
    expect(gestures[0].pointer).toBe('keyboard');
    expect(ev.defaultPrevented).toBe(true);
    act(() => {
      window.dispatchEvent(key('Space'));
    });
    expect(gestures).toHaveLength(1);
    rerender(ui(true, 1));
    act(() => {
      window.dispatchEvent(key('Space'));
    });
    expect(gestures).toHaveLength(2);
    cleanup();
  });

  it('attacks with the arrows and lofts with Shift, from the key’s own timestamp', () => {
    vi.useFakeTimers();
    const gestures: GestureInput[] = [];
    const starts: number[] = [];
    render(<GestureSurface enabled onSwingStart={(t) => starts.push(t)} onGesture={(g) => gestures.push(g)} />);
    let ev!: KeyboardEvent;
    act(() => {
      ev = key('ArrowUp', true);
      window.dispatchEvent(ev);
    });
    expect(ev.defaultPrevented).toBe(true);
    expect(starts).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(KEYBOARD.chordMs + 5);
    });
    expect(gestures).toHaveLength(1);
    const s = normalizeGesture(gestures[0], { releasePerfMs: starts[0] - 400, calibrationMs: 0, handedness: 'right' })!;
    expect(s).toMatchObject({ kind: 'attack', startT: 0.4, directionDeg: 0, elevation: KEYBOARD.loftElevation });
    cleanup();
    vi.useRealTimers();
  });

  it('leaves keys typed into a text field alone', () => {
    const gestures: GestureInput[] = [];
    render(<GestureSurface enabled onGesture={(g) => gestures.push(g)} />);
    const field = document.createElement('input');
    document.body.appendChild(field);
    act(() => {
      field.dispatchEvent(key('Space'));
    });
    expect(gestures).toHaveLength(0);
    field.remove();
    cleanup();
  });
});
