import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FormEvent } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PSwitch } from '@/practice/ui/design/Controls';

afterEach(cleanup);

// DOM semantics only. Real hit geometry and edge activation are browser assertions in a11y-practice-screens.
describe('Practice native switch', () => {
  it('puts the visual track inside the sole native activation target, without an inert hit wrapper', () => {
    const { container } = render(<PSwitch label="Sound" checked={false} onChange={vi.fn()} />);
    const control = screen.getByRole('switch', { name: 'Sound' });
    expect(container.firstElementChild).toBe(control);
    expect(control.tagName).toBe('BUTTON');
    expect(control.getAttribute('type')).toBe('button');
    expect(control.getAttribute('aria-checked')).toBe('false');
    expect(control.children).toHaveLength(1);
    expect(control.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
    expect(control.querySelector('button, [tabindex], [role=switch]')).toBeNull();
  });

  it('requests exactly one controlled-state change for each native click', () => {
    const onChange = vi.fn();
    const { rerender } = render(<PSwitch label="Sound" checked={false} onChange={onChange} />);
    const control = screen.getByRole('switch', { name: 'Sound' });
    fireEvent.click(control);
    expect(onChange.mock.calls).toEqual([[true]]);
    // The control reports the supplied value until its owner accepts the update.
    expect(control.getAttribute('aria-checked')).toBe('false');
    rerender(<PSwitch label="Sound" checked onChange={onChange} />);
    fireEvent.click(control);
    expect(onChange.mock.calls).toEqual([[true], [false]]);
  });

  it('a bubbled track click is handled once, not once per visual/wrapper layer', () => {
    const onChange = vi.fn();
    render(<PSwitch label="Sound" checked={false} onChange={onChange} />);
    fireEvent.click(screen.getByRole('switch').firstElementChild!);
    expect(onChange.mock.calls).toEqual([[true]]);
  });

  it('uses native disabled behavior and accepts the next click after re-enabling', () => {
    const onChange = vi.fn();
    const { rerender } = render(<PSwitch label="Sound" checked disabled onChange={onChange} />);
    const control = screen.getByRole('switch', { name: 'Sound' });
    expect(control).toHaveProperty('disabled', true);
    fireEvent.click(control);
    fireEvent.click(control.firstElementChild!);
    expect(onChange).not.toHaveBeenCalled();
    expect(control.getAttribute('aria-checked')).toBe('true');
    rerender(<PSwitch label="Sound" checked onChange={onChange} />);
    fireEvent.click(control);
    expect(onChange.mock.calls).toEqual([[false]]);
  });

  it('prefers the visible setting label over an alternative aria-label', () => {
    render(
      <>
        <span id="sound-label">Match sound</span>
        <PSwitch
          labelledBy="sound-label"
          label="Ignored fallback"
          checked={false}
          onChange={vi.fn()}
          testId="sound-switch"
        />
      </>,
    );
    const control = screen.getByRole('switch', { name: 'Match sound' });
    expect(control.getAttribute('aria-labelledby')).toBe('sound-label');
    expect(control.hasAttribute('aria-label')).toBe(false);
    expect(control.getAttribute('data-testid')).toBe('sound-switch');
  });

  it('does not submit a surrounding form', () => {
    const onSubmit = vi.fn((event: FormEvent) => event.preventDefault());
    const onChange = vi.fn();
    render(
      <form onSubmit={onSubmit}>
        <PSwitch label="Sound" checked={false} onChange={onChange} />
      </form>,
    );
    (screen.getByRole('switch') as HTMLButtonElement).click();
    expect(onChange.mock.calls).toEqual([[true]]);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
