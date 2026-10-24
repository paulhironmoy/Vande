import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, cleanup } from '@testing-library/react';
import { RightsMomentCard } from '@/components/play/RightsMomentCard';
import { rightsMoment } from './fixtures';

afterEach(cleanup);

describe('RightsMomentCard', () => {
  it('asks the situational question and reports the chosen option', () => {
    const onChoose = vi.fn();
    render(<RightsMomentCard moment={rightsMoment} onChoose={onChoose} onContinue={() => {}} />);
    expect(screen.getByTestId('rights-moment')).toBeTruthy();
    expect(screen.getByText(rightsMoment.question)).toBeTruthy();
    fireEvent.click(screen.getByTestId('rights-option-rm-b'));
    expect(onChoose).toHaveBeenCalledWith('rm-b');
  });

  it('explains the principle, source, date and disclaimer after answering', () => {
    const onContinue = vi.fn();
    render(<RightsMomentCard moment={rightsMoment} answeredOptionId="rm-b" onChoose={() => {}} onContinue={onContinue} />);
    expect(screen.getByText('That holds up.')).toBeTruthy();
    expect(screen.getByText(rightsMoment.principle)).toBeTruthy();
    expect(screen.getByText(rightsMoment.why)).toBeTruthy();
    const link = screen.getByRole('link', { name: /Constitution of India, Article 19/ }) as HTMLAnchorElement;
    expect(link.target).toBe('_blank');
    expect(link.rel).toContain('noopener');
    expect(screen.getByText(/Content reviewed/).textContent).toMatch(/2026/);
    expect(screen.getByText('Educational content—not legal advice')).toBeTruthy();
    fireEvent.click(screen.getByTestId('rights-continue'));
    expect(onContinue).toHaveBeenCalled();
  });
});
