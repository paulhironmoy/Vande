import { describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import type { GestureInput } from '@/contracts/practice';
import { GestureSurface } from '@/input';

function pointer(type: string, init: { id?: number; kind?: string; x: number; y: number }) {
  return new PointerEvent(type, { pointerId: init.id ?? 1, pointerType: init.kind ?? 'touch', clientX: init.x, clientY: init.y, bubbles: true, cancelable: true, button: 0 });
}

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

  it('reports the swing start on pointer-down and a tap without waiting for pointer-up', () => {
    vi.useFakeTimers();
    const starts: number[] = [];
    const gestures: GestureInput[] = [];
    const { container } = render(<GestureSurface enabled onSwingStart={(t) => starts.push(t)} onGesture={(g) => gestures.push(g)} />);
    const el = container.firstElementChild as HTMLElement;
    act(() => {
      el.dispatchEvent(pointer('pointerdown', { x: 50, y: 40 }));
    });
    expect(starts).toHaveLength(1);
    expect(Number.isFinite(starts[0])).toBe(true);
    expect(gestures).toHaveLength(0);
    act(() => {
      vi.advanceTimersByTime(80);
    });
    expect(gestures).toHaveLength(1);
    expect(gestures[0].pointer).toBe('touch');
    // The gesture keeps no sample after it is handed over, and the pointer-up adds nothing.
    act(() => {
      el.dispatchEvent(pointer('pointerup', { x: 50, y: 40 }));
    });
    expect(gestures).toHaveLength(1);
    cleanup();
    vi.useRealTimers();
  });

  it('defends on Space while enabled, ignores it while disabled, and re-arms per delivery', () => {
    const gestures: GestureInput[] = [];
    const ui = (enabled: boolean, key: number) => <GestureSurface enabled={enabled} deliveryKey={key} onGesture={(g) => gestures.push(g)} />;
    const { rerender } = render(ui(false, 0));
    const space = () => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true, cancelable: true }));
    act(() => {
      space();
    });
    expect(gestures).toHaveLength(0);
    rerender(ui(true, 0));
    let ev!: KeyboardEvent;
    act(() => {
      ev = new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true, cancelable: true });
      window.dispatchEvent(ev);
    });
    expect(gestures).toHaveLength(1);
    expect(gestures[0].pointer).toBe('keyboard');
    expect(ev.defaultPrevented).toBe(true);
    act(() => {
      space();
    });
    expect(gestures).toHaveLength(1);
    rerender(ui(true, 1));
    act(() => {
      space();
    });
    expect(gestures).toHaveLength(2);
    cleanup();
  });
});
