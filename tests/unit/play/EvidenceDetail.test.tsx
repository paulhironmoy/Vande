import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, cleanup } from '@testing-library/react';
import { EvidenceDetail, type EvidenceActionInfo } from '@/components/play/EvidenceDetail';
import { evidenceItem, evidenceState } from './fixtures';

const actions: EvidenceActionInfo[] = [
  { verb: 'inspect', label: 'Inspect metadata', enabled: true },
  { verb: 'compare', label: 'Compare with Registrar statement', enabled: false, hint: 'The Registrar has not issued a statement yet.', compareWith: 'ev-registrar' },
  { verb: 'preserve', label: 'Preserve as a record', enabled: true },
  { verb: 'unresolved', label: 'Mark unresolved', enabled: true },
];

afterEach(cleanup);

describe('EvidenceDetail', () => {
  it('shows source, claim, status and verification actions', () => {
    const onAction = vi.fn();
    render(<EvidenceDetail item={evidenceItem} state={evidenceState} actions={actions} onAction={onAction} onBack={() => {}} />);
    expect(screen.getByTestId('evidence-detail')).toBeTruthy();
    expect(screen.getByText('Anonymous forward')).toBeTruthy();
    expect(screen.getByText(evidenceItem.claim)).toBeTruthy();
    expect(screen.getByText('Unverified')).toBeTruthy();
    expect(screen.getByText(/Inspect the metadata to see/)).toBeTruthy();
    const inspect = screen.getByTestId('evidence-action-inspect');
    fireEvent.click(inspect);
    expect(onAction).toHaveBeenCalledWith('inspect', undefined);
    const compare = screen.getByTestId('evidence-action-compare') as HTMLButtonElement;
    expect(compare.disabled).toBe(true);
    expect(screen.getByText(/has not issued a statement yet/)).toBeTruthy();
  });

  it('reveals metadata with inconsistency markers once inspected and shows the resolution note when resolved', () => {
    const inspected = { ...evidenceState, inspected: true, state: 'manipulated' as const };
    render(<EvidenceDetail item={evidenceItem} state={inspected} actions={[]} onAction={() => {}} onBack={() => {}} />);
    expect(screen.getByText('Photo editing app export')).toBeTruthy();
    expect(screen.getAllByText('Inconsistent').length).toBe(2);
    expect(screen.getByText('Manipulated')).toBeTruthy();
    expect(screen.getByText(/It was fabricated/)).toBeTruthy();
    expect(screen.getByText(/Nothing more can be done/)).toBeTruthy();
  });

  it('passes the compare target and returns to the list', () => {
    const onAction = vi.fn();
    const onBack = vi.fn();
    const enabled = actions.map((a) => ({ ...a, enabled: true }));
    render(<EvidenceDetail item={evidenceItem} state={evidenceState} actions={enabled} onAction={onAction} onBack={onBack} />);
    fireEvent.click(screen.getByTestId('evidence-action-compare'));
    expect(onAction).toHaveBeenCalledWith('compare', 'ev-registrar');
    fireEvent.click(screen.getByTestId('evidence-back'));
    expect(onBack).toHaveBeenCalled();
  });
});
