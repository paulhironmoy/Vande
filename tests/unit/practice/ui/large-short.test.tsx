/**
 * Large text on a short screen (TEXT200-A, src/practice/ui/design/useLargeShort.ts): the rule, the flag every Practice screen
 * carries, and the title bar's two shapes. The layout itself is measured in a browser (tests/e2e/large-text-a.spec.ts).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { Screen, SHORT_REM, isLargeShort } from '@/practice/ui/design';

const realHeight = window.innerHeight;
const setHeight = (px: number) => Object.defineProperty(window, 'innerHeight', { configurable: true, value: px });

beforeEach(() => {
  document.documentElement.style.fontSize = '';
});
afterEach(() => {
  cleanup();
  setHeight(realHeight);
  document.documentElement.style.fontSize = '';
});

describe('isLargeShort: under 20 rem tall', () => {
  it('is false for every landscape phone at the default text size and true for each of them at 200%', () => {
    for (const h of [360, 390, 412]) {
      expect(isLargeShort(h, 16), `${h} px at 100%`).toBe(false);
      expect(isLargeShort(h, 32), `${h} px at 200%`).toBe(true);
    }
  });

  it('is false for a 1280x800 window even at 200% text, and switches exactly at 20 rem', () => {
    expect(isLargeShort(800, 32)).toBe(false);
    expect(isLargeShort(SHORT_REM * 32 - 1, 32)).toBe(true);
    expect(isLargeShort(SHORT_REM * 32, 32)).toBe(false);
  });

  it('reads a root size it cannot parse as 16 px, and an empty window as not short', () => {
    expect(isLargeShort(300, Number.NaN)).toBe(true);
    expect(isLargeShort(400, Number.NaN)).toBe(false);
    expect(isLargeShort(0, 32)).toBe(false);
  });
});

describe('Screen: the flag and the title bar', () => {
  it('carries data-large-short from the window height and the root text size, and follows both', async () => {
    document.documentElement.style.fontSize = '32px';
    setHeight(360);
    const { container } = render(<Screen title="Chase">words</Screen>);
    const root = container.firstElementChild as HTMLElement;
    expect(root.getAttribute('data-large-short')).toBe('true');
    // The window grows (a turn of the phone, a resize): not short any more.
    await act(async () => {
      setHeight(800);
      window.dispatchEvent(new Event('resize'));
    });
    expect(root.getAttribute('data-large-short')).toBe('false');
    // The player picks 100% text (the root's --text-scale changes the root font size): short again only at 200%.
    await act(async () => {
      setHeight(360);
      document.documentElement.style.fontSize = '16px';
      window.dispatchEvent(new Event('resize'));
    });
    expect(root.getAttribute('data-large-short')).toBe('false');
    await act(async () => {
      document.documentElement.style.fontSize = '32px';
      await Promise.resolve();
      window.dispatchEvent(new Event('resize'));
    });
    expect(root.getAttribute('data-large-short')).toBe('true');
  });

  it('keeps its two empty slots when there is no back control, unless the screen is flush (the result screens)', () => {
    const plain = render(<Screen title="Practice">words</Screen>);
    expect(plain.container.querySelector('header')?.children).toHaveLength(3);
    plain.unmount();
    const flush = render(
      <Screen title="Result" flush>
        words
      </Screen>,
    );
    const header = flush.container.querySelector('header');
    expect(header?.children).toHaveLength(1);
    expect(header?.firstElementChild?.tagName).toBe('H1');
    flush.unmount();
    // A back control is a back control: the flush title keeps it, and a trailing control keeps its place.
    const back = render(
      <Screen title="Setup" onBack={() => undefined} flush>
        words
      </Screen>,
    );
    expect(back.container.querySelector('header')?.children).toHaveLength(2);
    expect(back.container.querySelector('[data-testid="practice-back"]')).not.toBeNull();
  });
});
