import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useApp } from '@/app/store';
import { IntroScreen } from '@/screens/Intro/IntroScreen';

describe('intro play-style chooser', () => {
  it('defaults to Simple, switches to Full (standard pace, no auto-pause) and back', () => {
    render(<IntroScreen />);
    const simple = screen.getByTestId('style-simple');
    const full = screen.getByTestId('style-full');
    expect(simple.getAttribute('aria-checked')).toBe('true');
    expect(full.getAttribute('aria-checked')).toBe('false');
    expect(screen.getByTestId('intro-begin').textContent).toMatch(/Start playing/);

    fireEvent.click(full);
    let settings = useApp.getState().settings;
    expect(settings.playStyle).toBe('full');
    expect(settings.timerPace).toBe('standard');
    expect(settings.autoPauseOnDecision).toBe(false);
    expect(screen.getByTestId('style-full').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByTestId('intro-begin').textContent).toMatch(/Begin your first crisis/);

    fireEvent.click(screen.getByTestId('style-simple'));
    settings = useApp.getState().settings;
    expect(settings.playStyle).toBe('simple');
    expect(settings.timerPace).toBe('relaxed');
    expect(settings.autoPauseOnDecision).toBe(true);
  });
});
