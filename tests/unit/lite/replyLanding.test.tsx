import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ReplyLanding, __resetReplyAwardMemo } from '@/screens/Lite/ReplyLanding';
import { __resetLedgerForTests, readLedger } from '@/lite/ledger';
import { TWIST_POOL, __resetTwistStoreForTests } from '@/lite/twists';
import { encodeDareReply, nextLocalMidnight, type DareReply } from '@/share/dare';

const twist = TWIST_POOL.twists[0];
const dare = { seed: 42, path: '', step: 'd0', points: 196, best: true, deadline: nextLocalMidnight(), chain: 1 };

function replyOf(over: Partial<DareReply> = {}): { reply: DareReply; code: string } {
  const reply: DareReply = { dare, points: 196, best: true, version: 2, twistId: twist.id, twist: 'right', nonce: 'abc123', rematchDeadline: nextLocalMidnight(), ...over };
  return { reply, code: encodeDareReply(reply) };
}

function mount(reply: DareReply, code: string, verify?: (r: DareReply) => Promise<boolean>) {
  render(<ReplyLanding reply={reply} replyCode={code} onPlay={() => {}} onDareMore={() => {}} onHowPoints={() => {}} onStep={() => {}} verify={verify} />);
}

describe('ReplyLanding', () => {
  beforeEach(() => {
    localStorage.clear();
    __resetLedgerForTests();
    __resetTwistStoreForTests();
    __resetReplyAwardMemo();
    document.documentElement.setAttribute('data-motion', 'reduced');
  });
  afterEach(() => {
    cleanup();
    document.documentElement.removeAttribute('data-motion');
  });

  it('keeps the twist result hidden until the rematch is answered, then reveals the +100', async () => {
    const { reply, code } = replyOf();
    mount(reply, code);
    await waitFor(() => expect(screen.getByTestId('reply-award').textContent).toBe('+40'));
    expect(document.body.textContent).not.toMatch(/cracked/i);
    expect(screen.getByTestId('helper-stats').textContent).toContain('understood 0');
    expect(readLedger().helper.points).toBe(140);
    fireEvent.click(screen.getByTestId('rematch-accept'));
    fireEvent.click(await screen.findByTestId(`rematch-option-${twist.best}`));
    await waitFor(() => expect(screen.getByTestId('rematch-verdict').textContent).toMatch(/draw/i));
    expect(screen.getByTestId('rematch-bonus').textContent).toBe('+100');
  });

  it('reads the same for a right or a wrong twist before the rematch', async () => {
    const right = replyOf({ nonce: 'aaa111' });
    mount(right.reply, right.code);
    await waitFor(() => expect(screen.getByTestId('reply-award')).toBeTruthy());
    const a = document.body.textContent;
    cleanup();
    const wrong = replyOf({ nonce: 'bbb222', twist: 'wrong' });
    mount(wrong.reply, wrong.code);
    await waitFor(() => expect(screen.getByTestId('reply-award')).toBeTruthy());
    const b = document.body.textContent ?? '';
    // Only the running tally differs between the two pages (it already includes the first friend).
    expect(b.replace(/Friends helped \d+ · understood \d+ · [\d,]+/, '')).toBe((a ?? '').replace(/Friends helped \d+ · understood \d+ · [\d,]+/, ''));
  });

  it('counts a signature as verified only when it checks out', async () => {
    const signed = replyOf({ sig: `t${'f'.repeat(128)}` });
    mount(signed.reply, signed.code);
    await waitFor(() => expect(screen.getByTestId('reply-award')).toBeTruthy());
    expect(readLedger().helper.verifiedPoints).toBe(0);
    cleanup();
    const ok = replyOf({ nonce: 'ccc333', sig: `t${'f'.repeat(128)}` });
    mount(ok.reply, ok.code, async () => true);
    await waitFor(() => expect(screen.getByTestId('reply-award')).toBeTruthy());
    expect(readLedger().helper.verifiedPoints).toBe(140);
    cleanup();
    const bad = replyOf({ nonce: 'ddd444', sig: `t${'0'.repeat(128)}` });
    mount(bad.reply, bad.code, async () => false);
    await waitFor(() => expect(screen.getByTestId('reply-award')).toBeTruthy());
    expect(readLedger().helper.verifiedPoints).toBe(140);
  });
});
