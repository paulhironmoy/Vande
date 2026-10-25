import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ActionCard } from '@/components/game/cards';
import type { VisualPlanEntry } from '@/lite/contracts';

afterEach(cleanup);

const visual: VisualPlanEntry = { label: 'Meet student leaders', visual: { actor: 'official', action: 'meet', object: 'students' } };
/** Visible text runs in reading order, joined by single spaces; aria-hidden parts are skipped. */
function textRuns(el: Element): string {
  const out: string[] = [];
  const walk = (n: Node) => {
    if (n.nodeType === Node.TEXT_NODE) {
      const text = n.textContent?.trim();
      if (text) out.push(text);
      return;
    }
    if (n instanceof Element && n.getAttribute('aria-hidden') === 'true') return;
    n.childNodes.forEach(walk);
  };
  walk(el);
  return out.join(' ');
}
/** The accessible name must be exactly the visible text (jsdom has no CSS, so compare against textContent). */
function expectNameIsVisibleText(button: HTMLElement) {
  expect(screen.getByRole('button', { name: button.textContent ?? '' })).toBe(button);
}

describe('ActionCard picture mode', () => {
  it('shows the picture, then the label in place of the title, then the kind and the Gain/Cost lines', () => {
    const onSelect = vi.fn();
    render(<ActionCard kind="talk" title="Meet the student leaders today" visual={visual} onSelect={onSelect} testId="lite-option-o-acknowledge" />);
    const button = screen.getByTestId('lite-option-o-acknowledge');
    expect(button.getAttribute('data-visual')).toBe('true');
    expect(button.textContent).not.toContain('Meet the student leaders today');
    const picture = button.querySelector('[data-pictogram]')!;
    expect(picture.getAttribute('aria-hidden')).toBe('true');
    const text = textRuns(button);
    expect(text).toBe('Meet student leaders Talk Gain People feel heard Cost Takes time');
    expectNameIsVisibleText(button);
    const order = ['Meet student leaders', 'Talk', 'Gain', 'Cost'].map((t) => text.indexOf(t));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(button.firstElementChild?.nextElementSibling?.contains(picture)).toBe(true);
    fireEvent.click(button);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('keeps the accessible name equal to the visible text', () => {
    render(<ActionCard kind="restrict" title="Lock the university gates" visual={{ label: 'Lock university gates', visual: { actor: 'police', action: 'lock', object: 'gate' } }} onSelect={() => {}} badge={{ text: '×2 clue scanned', tone: 'bonus' }} testId="lite-option-o-cordon-campus" />);
    const button = screen.getByTestId('lite-option-o-cordon-campus');
    expect(textRuns(button)).toBe('Lock university gates Restrict Gain Fast control Cost Stops innocent people too ×2 clue scanned');
    expectNameIsVisibleText(button);
  });

  it('respects hideLabel, verdicts, picked and disabled states in picture mode', () => {
    render(<ActionCard kind="wait" title="Wait" visual={{ label: 'Wait for the office', visual: { actor: 'official', action: 'wait', object: 'office' } }} hideLabel verdict="wrong" picked disabled onSelect={() => {}} testId="c" />);
    const button = screen.getByTestId('c') as HTMLButtonElement;
    expect(textRuns(button)).toBe('Wait for the office Gain Costs nothing now Cost Problems can grow');
    expectNameIsVisibleText(button);
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('data-verdict')).toBe('wrong');
  });

  it('leaves text cards exactly as they were without the prop', () => {
    render(<ActionCard kind="check" title="Pick an independent check team" onSelect={() => {}} testId="t" />);
    const button = screen.getByTestId('t');
    expect(button.hasAttribute('data-visual')).toBe(false);
    expect(button.querySelector('[data-pictogram]')).toBeNull();
    expect(textRuns(button)).toBe('Investigate Pick an independent check team Gain Finds out what is true Cost Slower to act');
    // sheen, then the icon badge, then the body (kind, title, logic): the original structure.
    const kids = [...button.children];
    expect(kids).toHaveLength(3);
    expect(kids[0].getAttribute('aria-hidden')).toBe('true');
    expect(kids[1].getAttribute('aria-hidden')).toBe('true');
    expect(kids[1].querySelector('svg')).not.toBeNull();
    expectNameIsVisibleText(button);
  });
});
