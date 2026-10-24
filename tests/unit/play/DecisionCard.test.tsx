import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, cleanup } from '@testing-library/react';
import { DecisionCard } from '@/components/play/DecisionCard';
import { decision, decisionState } from './fixtures';

const warnings = {
  'opt-investigate': { level: 'none' as const, text: '' },
  'opt-arrest': { level: 'warning' as const, text: 'Relies on evidence that has not been verified.' },
  wait: { level: 'none' as const, text: '' },
};

afterEach(cleanup);

describe('DecisionCard', () => {
  it('shows title, situation, options with authority and a confidence warning', () => {
    render(<DecisionCard decision={decision} state={decisionState} tick={20} warnings={warnings} onChoose={() => {}} districtName="University Quarter" />);
    expect(screen.getByTestId('decision-card-d-leak')).toBeTruthy();
    expect(screen.getByText(decision.title)).toBeTruthy();
    expect(screen.getByText('University Quarter')).toBeTruthy();
    expect(screen.getAllByRole('button').length).toBe(3);
    const warn = screen.getByTestId('confidence-warning');
    expect(warn.textContent).toContain('not been verified');
    const arrest = screen.getByTestId('decision-option-opt-arrest');
    expect(arrest.getAttribute('aria-describedby')).toBe(warn.id);
    expect(screen.getByText('Article 21 — liberty and due process')).toBeTruthy();
  });

  it('never prints numeric score changes before a choice', () => {
    const { container } = render(<DecisionCard decision={decision} state={decisionState} tick={20} warnings={warnings} onChoose={() => {}} />);
    expect(container.textContent).not.toMatch(/[+-]\s?\d+/);
  });

  it('dispatches the chosen option id', () => {
    const onChoose = vi.fn();
    render(<DecisionCard decision={decision} state={decisionState} tick={20} warnings={warnings} onChoose={onChoose} />);
    fireEvent.click(screen.getByTestId('decision-option-opt-investigate'));
    expect(onChoose).toHaveBeenCalledWith('opt-investigate');
  });

  it('exposes the remaining time accessibly and disables while paused', () => {
    const onChoose = vi.fn();
    render(<DecisionCard decision={decision} state={decisionState} tick={30} warnings={warnings} onChoose={onChoose} disabled />);
    expect(screen.getByRole('img', { name: /Time to decide: 7 seconds/ })).toBeTruthy();
    fireEvent.click(screen.getByTestId('decision-option-wait'));
    expect(onChoose).not.toHaveBeenCalled();
  });
});
