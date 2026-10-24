import { afterEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, cleanup } from '@testing-library/react';
import { RepublicPulse } from '@/components/play/RepublicPulse';
import { pulse, scores } from './fixtures';

afterEach(cleanup);

describe('RepublicPulse', () => {
  it('renders six dimension sectors and a summary image', () => {
    const { container } = render(<RepublicPulse pulse={pulse} scores={scores} reducedMotion />);
    const img = container.querySelector('svg[role="img"]');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('aria-label')).toMatch(/Republic Pulse\. Overall 60/);
    expect(container.querySelectorAll('path[style*="--o-"]').length).toBe(6);
    expect(screen.getByText('60')).toBeTruthy();
  });

  it('reveals the values panel on tap and hides it again', () => {
    render(<RepublicPulse pulse={pulse} scores={scores} reducedMotion />);
    const toggle = screen.getByTestId('pulse');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('pulse-values')).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const panel = screen.getByTestId('pulse-values');
    expect(panel.querySelectorAll('[data-dim]').length).toBe(6);
    expect(panel.textContent).toContain('Constitutional freedom');
    expect(panel.textContent).toContain('72');
    expect(panel.querySelector('[data-dim="grievance"] [data-trend="falling"]')).not.toBeNull();
    fireEvent.click(toggle);
    expect(screen.queryByTestId('pulse-values')).toBeNull();
  });

  it('always shows values when the setting is on', () => {
    render(<RepublicPulse pulse={pulse} scores={scores} reducedMotion alwaysShowValues />);
    expect(screen.getByTestId('pulse-values')).toBeTruthy();
  });

  it('compact variant is a single accessible button', () => {
    const onExpand = () => {
      calls += 1;
    };
    let calls = 0;
    render(<RepublicPulse pulse={pulse} scores={scores} reducedMotion variant="compact" onExpand={onExpand} />);
    const btn = screen.getByTestId('pulse');
    expect(btn.tagName).toBe('BUTTON');
    expect(btn.getAttribute('aria-label')).toMatch(/Show details/);
    fireEvent.click(btn);
    expect(calls).toBe(1);
  });
});
