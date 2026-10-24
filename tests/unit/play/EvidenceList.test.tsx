import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { EvidenceList, sortEvidence } from '@/components/play/EvidenceList';
import { evidenceItem, evidenceState } from './fixtures';

const mk = (id: string, arrivedAt: number, markedUnresolved = false) => ({
  item: { ...evidenceItem, id, title: `Item ${id}` },
  state: { ...evidenceState, id, arrivedAt, markedUnresolved },
});

afterEach(cleanup);

describe('EvidenceList', () => {
  it('pins unresolved items and sorts newest first', () => {
    const sorted = sortEvidence([mk('a', 5), mk('b', 40), mk('c', 20, true)]);
    expect(sorted.map((e) => e.item.id)).toEqual(['c', 'b', 'a']);
  });

  it('renders cards with test ids and an empty state', () => {
    const { rerender } = render(<EvidenceList entries={[]} onOpen={() => {}} />);
    expect(screen.getByText(/No evidence yet/)).toBeTruthy();
    rerender(<EvidenceList entries={[mk('a', 5), mk('b', 9)]} newIds={new Set(['b'])} onOpen={() => {}} />);
    expect(screen.getByTestId('evidence-card-a')).toBeTruthy();
    expect(screen.getByTestId('evidence-card-b').textContent).toMatch(/New/);
    expect(screen.getByTestId('evidence-card-b').getAttribute('aria-label')).toBeNull();
    expect(screen.getByText(/2 items/)).toBeTruthy();
  });
});
