import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const flagState = vi.hoisted(() => ({ trade: false }));
vi.mock('@/app/flags', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/app/flags')>();
  return { ...mod, flags: new Proxy(mod.flags, { get: (target, key) => (key === 'liteTradeResults' ? flagState.trade : Reflect.get(target, key)) }) };
});

import { useApp } from '@/app/store';
import { LitePlayScreen } from '@/screens/Lite/LitePlayScreen';
import { encodeDare, nextLocalMidnight } from '@/share/dare';
import { __resetLedgerForTests, readLedger } from '@/lite/ledger';
import { __resetTwistStoreForTests } from '@/lite/twists';

function openDare() {
  const code = encodeDare({ seed: 42, path: '', step: 'd0', points: 100, best: false, deadline: nextLocalMidnight(), chain: 1 });
  act(() => useApp.getState().navigate({ name: 'lite', dare: code }));
  render(<LitePlayScreen />);
  fireEvent.click(screen.getByTestId('dare-accept'));
}

async function answerFirstOption() {
  await waitFor(() => expect(screen.getByTestId('lite-screen').getAttribute('data-step')).toBe('decision'));
  const first = document.querySelector<HTMLButtonElement>('[data-testid^="lite-option-"]')!;
  fireEvent.click(first);
  await waitFor(() => expect(screen.getByTestId('dare-result')).toBeTruthy());
}

describe('Lite friends on the screen', () => {
  beforeEach(() => {
    document.documentElement.setAttribute('data-motion', 'reduced');
    localStorage.clear();
    __resetLedgerForTests();
    __resetTwistStoreForTests();
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined), readText: vi.fn() } });
  });
  afterEach(() => {
    cleanup();
    document.documentElement.removeAttribute('data-motion');
    flagState.trade = false;
    act(() => useApp.getState().abandonCampaign());
  });

  it('by default shows who won the dare at once, and a dare earns no Insight and shows the tier without a multiplier', async () => {
    openDare();
    await waitFor(() => expect(screen.getByTestId('lite-screen').getAttribute('data-step')).toBe('decision'));
    expect(screen.getByTestId('lite-tier').textContent).toMatch(/question$/);
    await answerFirstOption();
    expect(screen.queryByTestId('trade-locked')).toBeNull();
    expect(screen.getByTestId('dare-result').textContent).toMatch(/You won the dare|A perfect tie|Your friend won this one/);
    expect(screen.queryByTestId('lite-insight-gain')).toBeNull();
  });

  it('with trade-results on, "who won" waits until the friend sends their result back, and sending awards Challenger points once', async () => {
    flagState.trade = true;
    openDare();
    await answerFirstOption();
    expect(screen.getByTestId('trade-locked')).toBeTruthy();
    expect(screen.getByTestId('dare-result').textContent).not.toMatch(/You won the dare|A perfect tie|Your friend won this one/);

    fireEvent.click(screen.getByTestId('dare-reply'));
    await waitFor(() => expect(screen.getByTestId('reply-sheet')).toBeTruthy());
    fireEvent.click(screen.getByTestId('reply-share-copy'));
    await waitFor(() => expect(screen.queryByTestId('trade-locked')).toBeNull());
    expect(screen.getByTestId('dare-result').textContent).toMatch(/You won the dare|A perfect tie|Your friend won this one/);
    expect(readLedger().challenger.points).toBe(40);

    fireEvent.click(screen.getByTestId('reply-share-copy'));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(2));
    expect(readLedger().challenger.points).toBe(40);
  });
});
