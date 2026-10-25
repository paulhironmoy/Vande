import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TwistQuestion, orderedOptions } from '@/components/game/twist';
import type { Twist } from '@/lite/contracts';

const twist: Twist = {
  id: 't9',
  kind: 'check',
  title: 'Stones at the market',
  situation: 'A video says bus drivers threw stones at a shop. The drivers say it was someone else.',
  options: [
    { id: 'a', title: 'Check the video first', tags: ['investigative'] },
    { id: 'b', title: 'Close the whole market', tags: ['suppressive'] },
    { id: 'c', title: 'Wait and see', tags: ['wait'] },
    { id: 'd', title: 'Talk to the shop owners', tags: ['dialogue'] },
  ],
  best: 'a',
  why: 'Find out what is true before anyone is blamed.',
};

const rule: Twist = {
  id: 't10',
  kind: 'rule',
  title: 'Who may speak?',
  situation: 'A town meeting gets loud. Some people want only their friends to speak.',
  options: [
    { id: 'a', title: 'Everyone may speak calmly' },
    { id: 'b', title: 'Only people who agree' },
    { id: 'c', title: 'Nobody until it ends' },
  ],
  best: 'a',
  why: 'Speaking peacefully is everyone’s right.',
};

afterEach(() => cleanup());

describe('TwistQuestion', () => {
  it('shows the kicker, the heading, the situation and the cards in the stored order', () => {
    render(<TwistQuestion twist={twist} order={['d', 'b', 'a', 'c']} onAnswer={() => {}} testIdPrefix="twist" kicker="The twist · same idea, new place" />);
    const section = screen.getByTestId('twist-question');
    expect(section.getAttribute('data-twist')).toBe('t9');
    expect(section.getAttribute('data-answered')).toBe('false');
    expect(screen.getByText('The twist · same idea, new place')).toBeTruthy();
    const h = screen.getByRole('heading', { level: 1 });
    expect(h.textContent).toBe('Stones at the market');
    expect(section.getAttribute('aria-labelledby')).toBe(h.id);
    expect(screen.getByText(twist.situation)).toBeTruthy();
    const ids = Array.from(section.querySelectorAll('[data-testid^="twist-option-"]')).map((el) => el.getAttribute('data-testid'));
    expect(ids).toEqual(['twist-option-d', 'twist-option-b', 'twist-option-a', 'twist-option-c']);
    // Accessible names come from the visible text: kind, title, gain and cost.
    expect(screen.getByRole('button', { name: /Investigate.*Check the video first.*Gain.*Finds out what is true.*Cost.*Slower to act/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Restrict.*Close the whole market/ })).toBeTruthy();
    expect(screen.queryByTestId('twist-result')).toBeNull();
  });

  it('answers once with the tapped option', () => {
    const onAnswer = vi.fn();
    render(<TwistQuestion twist={twist} order={['a', 'b', 'c', 'd']} onAnswer={onAnswer} testIdPrefix="twist" kicker="The twist" />);
    fireEvent.click(screen.getByTestId('twist-option-c'));
    expect(onAnswer).toHaveBeenCalledWith('c');
    cleanup();
    const blocked = vi.fn();
    render(<TwistQuestion twist={twist} order={['a', 'b', 'c', 'd']} onAnswer={blocked} testIdPrefix="twist" kicker="The twist" disabled />);
    fireEvent.click(screen.getByTestId('twist-option-a'));
    expect(blocked).not.toHaveBeenCalled();
  });

  it('after a right answer: disabled cards, the best marked in words, Right! and the why line', () => {
    const onAnswer = vi.fn();
    render(<TwistQuestion twist={twist} order={['a', 'b', 'c', 'd']} answer="a" onAnswer={onAnswer} testIdPrefix="twist" kicker="The twist" />);
    expect(screen.getByTestId('twist-question').getAttribute('data-answered')).toBe('true');
    for (const id of ['a', 'b', 'c', 'd']) expect((screen.getByTestId(`twist-option-${id}`) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('twist-option-a').getAttribute('data-verdict')).toBe('right');
    expect(screen.getByTestId('twist-option-a').textContent).toContain('Best move · your pick');
    const result = screen.getByTestId('twist-result');
    expect(result.getAttribute('data-right')).toBe('true');
    expect(result.textContent).toContain('Right!');
    expect(result.textContent).toContain(twist.why);
    expect(result.parentElement!.getAttribute('aria-live')).toBe('polite');
    fireEvent.click(screen.getByTestId('twist-option-b'));
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it('after a wrong answer: Not quite, the pick and the best move both named', () => {
    render(<TwistQuestion twist={twist} order={['a', 'b', 'c', 'd']} answer="b" onAnswer={() => {}} testIdPrefix="rematch" kicker="Your friend's twist" />);
    expect(screen.getByTestId('rematch-question')).toBeTruthy();
    expect(screen.getByTestId('rematch-option-b').getAttribute('data-verdict')).toBe('wrong');
    expect(screen.getByTestId('rematch-option-b').textContent).toContain('Your pick');
    expect(screen.getByTestId('rematch-option-a').getAttribute('data-verdict')).toBe('right');
    expect(screen.getByTestId('rematch-option-a').textContent).toContain('Best move');
    expect(screen.getByTestId('rematch-option-c').getAttribute('data-verdict')).toBeNull();
    const result = screen.getByTestId('rematch-result');
    expect(result.getAttribute('data-right')).toBe('false');
    expect(result.textContent).toContain('Not quite');
    expect(result.textContent).not.toMatch(/wrong|fail|bad/i);
  });

  it('shows fair-play twists as wide rule cards without move labels', () => {
    render(<TwistQuestion twist={rule} order={['c', 'a', 'b']} answer="c" onAnswer={() => {}} testIdPrefix="twist" kicker="The twist" />);
    const card = screen.getByTestId('twist-option-a');
    expect(card.textContent).not.toMatch(/Investigate|Restrict|Talk|Protect|Enforce|Wait|Gain|Cost/);
    expect(card.textContent).toContain('Fair answer');
    expect(screen.getByTestId('twist-option-c').textContent).toContain('Your pick');
  });

  it('orders options robustly', () => {
    expect(orderedOptions(twist, ['c', 'x', 'c', 'a']).map((o) => o.id)).toEqual(['c', 'a', 'b', 'd']);
    expect(orderedOptions(twist, []).map((o) => o.id)).toEqual(['a', 'b', 'c', 'd']);
  });
});
