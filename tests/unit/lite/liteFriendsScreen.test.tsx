import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const flagState = vi.hoisted(() => ({ trade: false }));
vi.mock('@/app/flags', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/app/flags')>();
  return { ...mod, flags: new Proxy(mod.flags, { get: (target, key) => (key === 'liteTradeResults' ? flagState.trade : Reflect.get(target, key)) }) };
});

const verifiedMock = vi.hoisted(() => ({ on: false, start: vi.fn(), grade: vi.fn() }));
vi.mock('@/community/liteDares', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/community/liteDares')>();
  return {
    ...mod,
    verifiedDaresEnabled: () => verifiedMock.on,
    startVerifiedAttempt: (...args: unknown[]) => verifiedMock.start(...args),
    gradeVerifiedAttempt: (...args: unknown[]) => verifiedMock.grade(...args),
  };
});

import { useApp } from '@/app/store';
import { decodeDareReply } from '@/share/dare';
import { TWIST_POOL } from '@/lite/twists';
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
    verifiedMock.on = false;
    verifiedMock.start.mockReset();
    verifiedMock.grade.mockReset();
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

  it('with verified dares on, the server picks the twist and signs the reply once the twist is answered', async () => {
    const twist = TWIST_POOL.twists.find((x) => x.kind === 'protect')!;
    verifiedMock.on = true;
    verifiedMock.start.mockResolvedValue({ attemptId: 'a'.repeat(32), twistId: twist.id, kind: 'protect', nonce: 'srv123', points: 196, best: true, verified: 'twist', created: true });
    verifiedMock.grade.mockResolvedValue({ attemptId: 'a'.repeat(32), points: 196, best: true, twistId: twist.id, twist: 'right', nonce: 'srv123', verified: 'twist', sig: `t${'f'.repeat(128)}`, graded: true });
    act(() => useApp.getState().updateSettings({ communitySharing: 'on' }));
    openDare();
    await answerFirstOption();
    await waitFor(() => expect(verifiedMock.start).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByTestId('twist-start'));
    await waitFor(() => expect(screen.getByTestId('twist-question').getAttribute('data-twist')).toBe(twist.id));
    fireEvent.click(screen.getByTestId(`twist-option-${twist.best}`));
    await waitFor(() => expect(screen.getByTestId('lite-screen').getAttribute('data-step')).toBe('twist-result'));
    fireEvent.click(screen.getByTestId('dare-reply'));
    await waitFor(() => expect(screen.getByTestId('reply-sheet')).toBeTruthy());
    expect(verifiedMock.grade).toHaveBeenCalledWith(expect.objectContaining({ attemptId: 'a'.repeat(32), twistAnswer: twist.best }));
    fireEvent.click(screen.getByTestId('reply-share-copy'));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalled());
    const link = vi.mocked(navigator.clipboard.writeText).mock.calls[0][0] as string;
    const reply = decodeDareReply(link)!;
    expect(reply.version).toBe(2);
    expect(reply.nonce).toBe('srv123');
    expect(reply.twistId).toBe(twist.id);
    expect(reply.twist).toBe('right');
    expect(reply.sig).toBe(`t${'f'.repeat(128)}`);
  });

  it('with verified dares on but the server unreachable, the friend still gets a local twist and an unsigned reply', async () => {
    verifiedMock.on = true;
    verifiedMock.start.mockResolvedValue(null);
    act(() => useApp.getState().updateSettings({ communitySharing: 'on' }));
    openDare();
    await answerFirstOption();
    fireEvent.click(screen.getByTestId('twist-start'));
    await waitFor(() => expect(screen.getByTestId('lite-screen').getAttribute('data-step')).toBe('twist'));
    const first = document.querySelector<HTMLButtonElement>('[data-testid^="twist-option-"]')!;
    fireEvent.click(first);
    fireEvent.click(await screen.findByTestId('dare-reply'));
    await waitFor(() => expect(screen.getByTestId('reply-sheet')).toBeTruthy());
    expect(verifiedMock.grade).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('reply-share-copy'));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalled());
    const reply = decodeDareReply(vi.mocked(navigator.clipboard.writeText).mock.calls[0][0] as string)!;
    expect(reply.version).toBe(2);
    expect(reply.sig).toBeUndefined();
  });
});
