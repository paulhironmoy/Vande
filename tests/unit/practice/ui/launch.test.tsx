import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { parseRoute } from '@/app/router';
import { LaunchChoice } from '@/practice/ui/LaunchChoice';
import { shouldOfferLaunchChoice, takePracticeSelectedAt } from '@/practice/ui/launch';

afterEach(() => cleanup());

describe('when the launch choice is offered', () => {
  it('on a normal start only, never on a deep link', () => {
    expect(shouldOfferLaunchChoice(parseRoute('/'))).toBe(true);
    for (const path of ['/practice', '/settings', '/i/abcdefgh12', '/m/match123', '/c/cup1234', '/h/abcd1234', '/s/abcd1234', '/daily', '/start', '/nope']) {
      expect(shouldOfferLaunchChoice(parseRoute(path)), path).toBe(false);
    }
  });
});

describe('LaunchChoice', () => {
  it('offers Practice ("Experience batting") and Skip ("Continue to VANDE")', () => {
    render(<LaunchChoice onPractice={() => {}} onSkip={() => {}} />);
    expect(screen.getByTestId('launch-practice').textContent).toContain('Experience batting');
    expect(screen.getByTestId('launch-skip').textContent).toContain('Continue to VANDE');
    expect(screen.getByRole('heading', { level: 1 })).toBeTruthy();
    // The primary choice has focus, so a keyboard or switch user lands on it.
    expect(document.activeElement).toBe(screen.getByTestId('launch-practice'));
  });

  it('Practice records when it was chosen (time to first delivery) and calls onPractice', () => {
    const onPractice = vi.fn();
    const onSkip = vi.fn();
    render(<LaunchChoice onPractice={onPractice} onSkip={onSkip} />);
    fireEvent.click(screen.getByTestId('launch-practice'));
    expect(onPractice).toHaveBeenCalledOnce();
    expect(onSkip).not.toHaveBeenCalled();
    expect(takePracticeSelectedAt()).toEqual(expect.any(Number));
    // Read once: a later direct visit measures from its own opening.
    expect(takePracticeSelectedAt()).toBeNull();
  });

  it('Skip calls onSkip and records nothing', () => {
    const onPractice = vi.fn();
    const onSkip = vi.fn();
    render(<LaunchChoice onPractice={onPractice} onSkip={onSkip} />);
    fireEvent.click(screen.getByTestId('launch-skip'));
    expect(onSkip).toHaveBeenCalledOnce();
    expect(onPractice).not.toHaveBeenCalled();
    expect(takePracticeSelectedAt()).toBeNull();
  });
});
