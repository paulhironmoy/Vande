import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { hashString } from '@/engine/prng';
import {
  DARE_HINTS,
  dareReplyText,
  dareReplyUrl,
  dareShareText,
  dareTimeLeft,
  dareUrl,
  decodeDare,
  decodeDareReply,
  encodeDare,
  encodeDareReply,
  isDarePath,
  nextLocalMidnight,
  type Dare,
  type DareReply,
} from '@/share/dare';
import { DARE_CARD_SIZE, dareCardAlt, dareCardFileName, renderDareCard, type DareCardModel } from '@/share/dareCard';
import { Countdown } from '@/components/game/dare/Countdown';
import { DareSheet } from '@/components/game/dare/DareSheet';

const CODE_SHAPE = /^I1_[0-9a-z]{1,7}_(~|[a-z0-9.-]+)_[dr]\d{1,2}_[0-9a-z]{1,7}_[01]_[0-9a-z]{1,7}_[0-9a-z]{1,7}_[0-9a-z]{2}$/;
const DEADLINE = Math.floor(new Date(2026, 9, 25, 0, 0, 0).getTime() / 1000);

const base: Dare = { seed: 123456789, path: 'd0-1.e0.d1-0.r0-2', step: 'd2', points: 196, best: true, deadline: DEADLINE, chain: 3 };

/** Builds a code with a valid checksum for arbitrary parts, to test field validation in isolation. */
function craft(parts: string[]): string {
  const body = ['I1', ...parts].join('_');
  return `${body}_${(hashString(body) % 1296).toString(36).padStart(2, '0')}`;
}

describe('dare codes', () => {
  it('round-trips empty and long paths, chain 1 and 99, best on and off, points 0 and 9999', () => {
    const longPath = Array.from({ length: 30 }, (_, i) => (i % 3 === 0 ? `d${i}-${i % 4}` : i % 3 === 1 ? `e${i}` : `r${i % 7}-${i % 3}`)).join('.');
    expect(longPath.length).toBeLessThanOrEqual(400);
    const cases: Dare[] = [
      { ...base, path: '', step: 'd0', chain: 1, best: false, points: 0 },
      { ...base, path: longPath, step: 'r12', chain: 99, best: true, points: 9999 },
      { ...base, seed: 0, chain: 1 },
      { ...base, seed: 2 ** 32 - 1, chain: 99, best: false },
      base,
    ];
    for (const d of cases) {
      const code = encodeDare(d);
      expect(code).toMatch(CODE_SHAPE);
      expect(decodeDare(code)).toEqual(d);
    }
    expect(encodeDare({ ...base, path: '' })).toContain('_~_');
  });

  it('normalises numbers when encoding and refuses malformed paths or steps', () => {
    const d = decodeDare(encodeDare({ ...base, points: 25000, chain: 500, seed: -1 }))!;
    expect(d.points).toBe(9999);
    expect(d.chain).toBe(99);
    expect(d.seed).toBe(2 ** 32 - 1);
    expect(decodeDare(encodeDare({ ...base, chain: 0 }))!.chain).toBe(1);
    expect(() => encodeDare({ ...base, path: 'd1-2.x9' })).toThrow(RangeError);
    expect(() => encodeDare({ ...base, path: 'd01-2' })).toThrow(RangeError);
    expect(() => encodeDare({ ...base, step: 'e2' })).toThrow(RangeError);
    expect(() => encodeDare({ ...base, path: 'e1.'.repeat(140).slice(0, -1) })).toThrow(RangeError);
    expect(isDarePath('')).toBe(true);
    expect(isDarePath('d0-1.e3.r2-0')).toBe(true);
    expect(isDarePath('d0-1..e3')).toBe(false);
  });

  it('tolerates case, whitespace and full links', () => {
    const code = encodeDare(base);
    expect(decodeDare(code.toLowerCase())).toEqual(base);
    expect(decodeDare(code.toUpperCase())).toEqual(base);
    expect(decodeDare(`  ${code}\n`)).toEqual(base);
    expect(decodeDare(`https://paulhironmoy.github.io/Vande/lite/dare/${code}`)).toEqual(base);
    expect(decodeDare(`https://vande.example/lite/dare/${code}?utm=x#top`)).toEqual(base);
    expect(decodeDare(`https://vande.example/lite/dare/${encodeURIComponent(code)}/`)).toEqual(base);
  });

  it('rejects every single-character tamper', () => {
    const code = encodeDare(base);
    for (let i = 0; i < code.length; i++) {
      const ch = code[i];
      if (ch === '_') continue;
      const replacement = ch === '.' ? '-' : ch === '-' ? '.' : ch === '9' ? '8' : ch === 'z' ? 'y' : /[0-8]/.test(ch) ? String(Number(ch) + 1) : String.fromCharCode(ch.charCodeAt(0) + 1);
      const tampered = code.slice(0, i) + replacement + code.slice(i + 1);
      expect(decodeDare(tampered), `position ${i}: ${tampered}`).toBeNull();
    }
  });

  it('rejects malformed and out-of-range fields even with a valid checksum', () => {
    const seed = (123456789).toString(36);
    const dl = DEADLINE.toString(36);
    expect(decodeDare(craft([seed, '~', 'd2', '5g', '1', dl, '3']))).toEqual({ ...base, path: '' });
    expect(decodeDare('')).toBeNull();
    expect(decodeDare('nonsense')).toBeNull();
    expect(decodeDare('L1-abc-10-2-x')).toBeNull();
    expect(decodeDare(craft([seed, 'd1-2', 'e2', '5g', '1', dl, '3']))).toBeNull(); // step must be d or r
    expect(decodeDare(craft([seed, 'd1-2', 'd2', '7pt', '1', dl, '3']))).toBeNull(); // points 10,000
    expect(decodeDare(craft([seed, 'd1-2', 'd2', '5g', '2', dl, '3']))).toBeNull(); // best must be 0/1
    expect(decodeDare(craft([seed, 'd1-2', 'd2', '5g', '1', dl, '0']))).toBeNull(); // chain 0
    expect(decodeDare(craft([seed, 'd1-2', 'd2', '5g', '1', dl, '2s']))).toBeNull(); // chain 100
    expect(decodeDare(craft([seed, 'd1-2', 'd2', '5g', '1', '1', '3']))).toBeNull(); // deadline far in the past
    expect(decodeDare(craft([`0${seed}`, 'd1-2', 'd2', '5g', '1', dl, '3']))).toBeNull(); // padded seed
    expect(decodeDare(craft([seed, 'd1-2', 'd2', '05g', '1', dl, '3']))).toBeNull(); // padded points
    expect(decodeDare(craft([seed, 'd1-2..e3', 'd2', '5g', '1', dl, '3']))).toBeNull(); // empty path token
    expect(decodeDare(craft([seed, 'd1-2', 'd2', '5g', '1', dl, '3', 'x']))).toBeNull(); // extra field
  });

  it('builds links from the base path', () => {
    const code = encodeDare(base);
    expect(dareUrl(code, 'https://vande.example')).toBe(`https://vande.example/lite/dare/${code}`);
    expect(dareUrl(code, 'https://vande.example/')).toBe(`https://vande.example/lite/dare/${code}`);
    vi.stubEnv('BASE_URL', '/Vande');
    expect(dareUrl(code, 'https://paulhironmoy.github.io')).toBe(`https://paulhironmoy.github.io/Vande/lite/dare/${code}`);
    vi.unstubAllEnvs();
    expect(decodeDare(dareUrl(code, 'https://vande.example'))).toEqual(base);
  });
});

describe('midnight deadlines and time left', () => {
  it('returns the coming local midnight, within 24 hours, at 00:00', () => {
    for (const now of [new Date(2026, 9, 24, 15, 30, 12), new Date(2026, 9, 24, 23, 59, 59), new Date(2026, 9, 24, 0, 0, 1), new Date(2026, 11, 31, 18, 0, 0)]) {
      const t = nextLocalMidnight(now);
      expect(t * 1000).toBeGreaterThan(now.getTime());
      expect(t * 1000 - now.getTime()).toBeLessThanOrEqual(24 * 3600 * 1000);
      const at = new Date(t * 1000);
      expect([at.getHours(), at.getMinutes(), at.getSeconds()]).toEqual([0, 0, 0]);
    }
    const exactly = new Date(2026, 9, 24, 0, 0, 0, 0);
    expect(nextLocalMidnight(exactly)).toBe(Math.floor(new Date(2026, 9, 25).getTime() / 1000));
    expect(new Date(nextLocalMidnight(new Date(2026, 11, 31, 18)) * 1000).getFullYear()).toBe(2027);
  });

  it('labels the time left and expiry', () => {
    const deadline = 2_000_000_000;
    const at = (secondsLeft: number) => dareTimeLeft(deadline, (deadline - secondsLeft) * 1000);
    expect(at(5 * 3600 + 12 * 60 + 8).label).toBe('5h 12m');
    expect(at(12 * 60 + 30).label).toBe('12m 30s');
    expect(at(45).label).toBe('45s');
    expect(dareTimeLeft(deadline, deadline * 1000 - 400).label).toBe('1s');
    expect(at(0)).toEqual({ ms: 0, expired: true, label: 'Ended' });
    expect(at(-60).expired).toBe(true);
    expect(at(90).expired).toBe(false);
  });
});

describe('dare share text', () => {
  it('names the move and points, sets the midnight deadline and adds the chain line only past the first link', () => {
    const first = dareShareText({ moveNumber: 3, points: 196, best: false, chain: 1, chapterTitle: 'The Exam Leak' });
    expect(first).toContain('move 3');
    expect(first).toContain('The Exam Leak');
    expect(first).toContain('+196');
    expect(first).toMatch(/before midnight/i);
    expect(first).toContain('dare 3 friends');
    expect(first).not.toMatch(/chain/);
    expect(first.split('\n')).toHaveLength(2);
    expect(first).not.toMatch(/https?:/);

    const fourth = dareShareText({ moveNumber: 5, points: 1240, best: true, chain: 4, chapterTitle: 'The Exam Leak' });
    expect(fourth).toContain('best move');
    expect(fourth).toContain('+1,240');
    expect(fourth).toContain("You're #4 in this dare chain.");
    expect(fourth.split('\n')).toHaveLength(3);

    const zero = dareShareText({ moveNumber: 2, points: 0, best: false, chain: 1, chapterTitle: 'The Exam Leak' });
    expect(zero).not.toContain('+0');
  });
});

describe('dare card', () => {
  const card: DareCardModel = { moveNumber: 3, moveTitle: 'Students are gathering', points: 196, best: true, chain: 4, deadlineLabel: 'Ends at midnight', code: encodeDare(base), chapterTitle: 'The Exam Leak' };
  afterEach(() => vi.restoreAllMocks());

  it('describes itself without revealing the answer', () => {
    expect(DARE_CARD_SIZE).toEqual({ width: 1080, height: 1080 });
    const alt = dareCardAlt(card);
    expect(alt).toContain('move 3 of The Exam Leak');
    expect(alt).toContain('Students are gathering');
    expect(alt).toContain('Beat +196');
    expect(alt).toContain('Ends at midnight');
    expect(alt).toContain('chain number 4');
    expect(alt).toContain(card.code);
    expect(dareCardAlt({ ...card, points: 0, chain: 1, best: false })).toContain('Can you find the best move?');
    expect(dareCardFileName(card)).toBe('vande-dare-move-3.png');
  });

  it('rejects with a clear error when Canvas 2D is unavailable', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null);
    await expect(renderDareCard(card)).rejects.toThrow(/Canvas 2D is not available/);
  });
});

describe('Countdown', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 24, 23, 58, 30));
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('ticks every second, flags urgency and ends exactly once', () => {
    const deadline = Math.floor(new Date(2026, 9, 25, 0, 0, 0).getTime() / 1000);
    const onExpire = vi.fn();
    render(<Countdown deadline={deadline} onExpire={onExpire} data-testid="cd" />);
    const el = screen.getByTestId('cd');
    expect(el.getAttribute('role')).toBe('timer');
    expect(el.getAttribute('aria-live')).toBe('off');
    expect(el.textContent).toBe('Ends in 1m 30s');
    expect(el.getAttribute('data-urgency')).toBe('critical');
    expect(el.getAttribute('aria-label')).toBe('Dare ends in 1 minute 30 seconds');
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(screen.getByTestId('cd').textContent).toBe('Ends in 1m 00s');
    act(() => {
      vi.advanceTimersByTime(61_000);
    });
    expect(screen.getByTestId('cd').textContent).toBe('Dare ended');
    expect(screen.getByTestId('cd').getAttribute('data-urgency')).toBe('ended');
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('uses the compact label and the calmer states for longer deadlines', () => {
    const deadline = Math.floor(new Date(2026, 9, 24, 23, 58, 30).getTime() / 1000) + 5 * 3600 + 12 * 60;
    render(<Countdown deadline={deadline} compact data-testid="cd" />);
    expect(screen.getByTestId('cd').textContent).toBe('5h 12m');
    expect(screen.getByTestId('cd').getAttribute('data-urgency')).toBe('normal');
    cleanup();
    render(<Countdown deadline={Math.floor(Date.now() / 1000) + 40 * 60} data-testid="cd" />);
    expect(screen.getByTestId('cd').getAttribute('data-urgency')).toBe('soon');
    expect(screen.getByTestId('cd').textContent).toBe('Ends in 40m 00s');
  });
});

describe('DareSheet', () => {
  let open: ReturnType<typeof vi.fn>;
  let writeText: ReturnType<typeof vi.fn>;
  const dare: Dare = { ...base, deadline: Math.floor(Date.now() / 1000) + 3 * 3600 };

  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null);
    open = vi.fn();
    vi.stubGlobal('open', open);
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('offers every channel, counts the player’s own sends in three slots and never opens anything untapped', async () => {
    render(<DareSheet open onClose={() => {}} dare={dare} moveNumber={3} moveTitle="Students are gathering" chapterTitle="The Exam Leak" />);
    expect(screen.getByTestId('dare-sheet')).toBeTruthy();
    expect(screen.getByText('Dare 3 friends')).toBeTruthy();
    expect(screen.getByText(/Pass it on before midnight/)).toBeTruthy();
    expect(screen.getByTestId('dare-countdown').textContent).toMatch(/^Ends in 3h 00m 00s$/);
    for (const id of ['dare-share', 'dare-share-whatsapp', 'dare-share-telegram', 'dare-share-x', 'dare-share-sms', 'dare-share-email', 'dare-share-copy']) {
      expect(screen.getByTestId(id)).toBeTruthy();
    }
    for (const n of [1, 2, 3]) {
      expect(screen.getByTestId(`dare-slot-${n}`).textContent).toContain(`Friend ${n}`);
      expect(screen.getByTestId(`dare-slot-${n}`).getAttribute('data-lit')).toBeNull();
    }
    expect(open).not.toHaveBeenCalled();

    // Canvas is unavailable in jsdom: the preview hides itself.
    await waitFor(() => expect(screen.queryByTestId('dare-preview')).toBeNull());

    fireEvent.click(screen.getByTestId('dare-share-whatsapp'));
    expect(open).toHaveBeenCalledTimes(1);
    const [waUrl, target, features] = open.mock.calls[0];
    expect(String(waUrl)).toMatch(/^https:\/\/wa\.me\/\?text=/);
    const decoded = decodeURIComponent(String(waUrl));
    expect(decoded).toContain('move 3');
    expect(decoded).toContain('/lite/dare/');
    expect(decodeDare(decoded.slice(decoded.indexOf('http')))).toEqual(dare);
    expect(target).toBe('_blank');
    expect(features).toBe('noopener,noreferrer');
    expect(screen.getByTestId('dare-slot-1').getAttribute('data-lit')).toBe('true');
    expect(screen.getByText('1 of 3 shared.')).toBeTruthy();

    fireEvent.click(screen.getByTestId('dare-share-copy'));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(String(writeText.mock.calls[0][0])).toMatch(/\/lite\/dare\/I1_/);
    await waitFor(() => expect(screen.getByTestId('dare-slot-2').getAttribute('data-lit')).toBe('true'));

    fireEvent.click(screen.getByTestId('dare-share-telegram'));
    fireEvent.click(screen.getByTestId('dare-share-x'));
    expect(screen.getByTestId('dare-slot-3').getAttribute('data-lit')).toBe('true');
    expect(screen.getByText(/All three shared/)).toBeTruthy();
  });

  it('falls back to copying the dare text and link when no share sheet exists', async () => {
    render(<DareSheet open onClose={() => {}} dare={dare} moveNumber={5} moveTitle="A fake circular spreads" chapterTitle="The Exam Leak" />);
    fireEvent.click(screen.getByTestId('dare-share'));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const copied = String(writeText.mock.calls[0][0]);
    expect(copied).toContain('move 5');
    expect(copied).toContain('/lite/dare/');
    await waitFor(() => expect(screen.getByTestId('dare-slot-1').getAttribute('data-lit')).toBe('true'));
  });
});

describe('dare hints', () => {
  it('round-trips every hint and keeps hint-less codes decoding as before', () => {
    expect(DARE_HINTS).toEqual(['Think about who gets hurt.', 'Check the clue before you act.', 'Fair beats fast.']);
    for (const hint of [0, 1, 2] as const) {
      const code = encodeDare({ ...base, hint });
      expect(code).toMatch(new RegExp(`_h${hint}_[0-9a-z]{2}$`));
      expect(decodeDare(code)).toEqual({ ...base, hint });
    }
    const plain = encodeDare(base);
    expect(plain).not.toMatch(/_h\d_/);
    const decoded = decodeDare(plain)!;
    expect(decoded).toEqual(base);
    expect('hint' in decoded).toBe(false);
    // A hand-built original-form code (no hint field) still decodes.
    const seed = (123456789).toString(36);
    expect(decodeDare(craft([seed, 'd0-1.e0.d1-0.r0-2', 'd2', '5g', '1', DEADLINE.toString(36), '3']))).toEqual(base);
  });

  it('rejects invalid hints when encoding and decoding, and hint tampering', () => {
    expect(() => encodeDare({ ...base, hint: 3 as unknown as 0 })).toThrow(RangeError);
    const seed = (123456789).toString(36);
    expect(decodeDare(craft([seed, 'd1-2', 'd2', '5g', '1', DEADLINE.toString(36), '3', 'h3']))).toBeNull();
    const withHint = encodeDare({ ...base, hint: 1 });
    expect(decodeDare(withHint.replace('_h1_', '_h2_'))).toBeNull();
    expect(decodeDare(withHint.replace(/_h1_/, '_'))).toBeNull();
  });
});

describe('dare replies', () => {
  const reply: DareReply = { dare: base, points: 392, best: true };

  it('round-trips with and without a hint, for edge scores', () => {
    const cases: DareReply[] = [
      reply,
      { dare: { ...base, hint: 2 }, points: 0, best: false },
      { dare: { ...base, path: '', step: 'r0', chain: 99 }, points: 9999, best: true },
    ];
    for (const r of cases) {
      const code = encodeDareReply(r);
      expect(code).toMatch(/^R1_[0-9a-z_.~-]+_[0-9a-z]{2}$/);
      expect(decodeDareReply(code)).toEqual({ ...r, version: 1 });
    }
    expect(decodeDareReply(encodeDareReply({ ...reply, points: 50000 }))!.points).toBe(9999);
  });

  it('rejects every single-character tamper and never cross-decodes with dare codes', () => {
    const code = encodeDareReply(reply);
    for (let i = 0; i < code.length; i++) {
      const ch = code[i];
      if (ch === '_') continue;
      const replacement = ch === '.' ? '-' : ch === '-' ? '.' : ch === '9' ? '8' : ch === 'z' ? 'y' : /[0-8]/.test(ch) ? String(Number(ch) + 1) : String.fromCharCode(ch.charCodeAt(0) + 1);
      const tampered = code.slice(0, i) + replacement + code.slice(i + 1);
      expect(decodeDareReply(tampered), `position ${i}: ${tampered}`).toBeNull();
    }
    expect(decodeDareReply(encodeDare(base))).toBeNull();
    expect(decodeDare(code)).toBeNull();
    expect(decodeDareReply('')).toBeNull();
    expect(decodeDareReply('R1_nonsense')).toBeNull();
  });

  it('builds and parses reply links', () => {
    const code = encodeDareReply(reply);
    expect(dareReplyUrl(code, 'https://vande.example')).toBe(`https://vande.example/lite/reply/${code}`);
    vi.stubEnv('BASE_URL', '/Vande/');
    expect(dareReplyUrl(code, 'https://paulhironmoy.github.io')).toBe(`https://paulhironmoy.github.io/Vande/lite/reply/${code}`);
    vi.unstubAllEnvs();
    expect(decodeDareReply(`https://paulhironmoy.github.io/Vande/lite/reply/${code}?x=1#y`)).toEqual({ ...reply, version: 1 });
    expect(decodeDareReply(` ${code.toLowerCase()} `)).toEqual({ ...reply, version: 1 });
    // A dare link is not a reply link.
    expect(decodeDareReply(`https://vande.example/lite/dare/${encodeDare(base)}`)).toBeNull();
  });

  it('writes a short reply without a link', () => {
    const text = dareReplyText({ points: 392, best: true, senderPoints: 196, moveNumber: 3 });
    expect(text).toBe('I took your dare on move 3: +392 vs your +196. I found the best move.');
    expect(dareReplyText({ points: 40, best: false, senderPoints: 0, moveNumber: 2 })).toBe('I took your dare on move 2: +40.');
    expect(text).not.toMatch(/https?:/);
  });
});

describe('DareSheet modes', () => {
  let open: ReturnType<typeof vi.fn>;
  let writeText: ReturnType<typeof vi.fn>;
  const dare: Dare = { ...base, deadline: Math.floor(Date.now() / 1000) + 3 * 3600 };

  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null);
    open = vi.fn();
    vi.stubGlobal('open', open);
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('dare mode: hint picker defaults to no hint, encodes the chosen hint and shows the Helper incentive', () => {
    render(<DareSheet open onClose={() => {}} dare={dare} moveNumber={3} moveTitle="Students are gathering" chapterTitle="The Exam Leak" />);
    expect(screen.getByTestId('dare-incentive').textContent).toContain('+40 when a friend answers. +100 more when they find the best move and crack the twist. Up to 3 friends per dare and 10 a day.');
    expect(screen.getByTestId('dare-hint-none').getAttribute('aria-checked')).toBe('true');
    for (const i of [0, 1, 2]) expect(screen.getByTestId(`dare-hint-${i}`).textContent).toBe(DARE_HINTS[i]);

    fireEvent.click(screen.getByTestId('dare-share-whatsapp'));
    let link = decodeURIComponent(String(open.mock.calls[0][0]));
    expect(decodeDare(link.slice(link.indexOf('http')))!.hint).toBeUndefined();

    fireEvent.click(screen.getByTestId('dare-hint-1'));
    expect(screen.getByTestId('dare-hint-1').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByTestId('dare-hint-none').getAttribute('aria-checked')).toBe('false');
    fireEvent.click(screen.getByTestId('dare-share-telegram'));
    link = decodeURIComponent(String(open.mock.calls[1][0]));
    const url = link.slice(link.indexOf('http'), link.indexOf('&text='));
    expect(decodeDare(url)).toEqual({ ...dare, hint: 1 });
  });

  it('reply mode: reply-prefixed controls, no slots or hints, and a reply link', async () => {
    const r: DareReply = { dare, points: 392, best: true };
    render(<DareSheet open onClose={() => {}} dare={dare} moveNumber={3} moveTitle="Students are gathering" chapterTitle="The Exam Leak" mode="reply" reply={r} />);
    expect(screen.getByTestId('reply-sheet')).toBeTruthy();
    expect(screen.getByText('Send your result back')).toBeTruthy();
    expect(screen.getByTestId('reply-lead').textContent).toBe('You can both earn points when you send it back.');
    expect(screen.queryByTestId('reply-twist')).toBeNull();
    for (const id of ['reply-share', 'reply-share-whatsapp', 'reply-share-telegram', 'reply-share-x', 'reply-share-sms', 'reply-share-email', 'reply-share-copy']) {
      expect(screen.getByTestId(id)).toBeTruthy();
    }
    expect(screen.queryByTestId('dare-sheet')).toBeNull();
    expect(screen.queryByTestId('dare-slot-1')).toBeNull();
    expect(screen.queryByTestId('dare-hint-none')).toBeNull();
    expect(screen.queryByTestId('dare-incentive')).toBeNull();
    expect(screen.queryByTestId('dare-share')).toBeNull();

    fireEvent.click(screen.getByTestId('reply-share-whatsapp'));
    const wa = decodeURIComponent(String(open.mock.calls[0][0]));
    expect(wa).toContain('I took your dare on move 3: +392 vs your +196. I found the best move.');
    expect(decodeDareReply(wa.slice(wa.indexOf('http')))).toEqual({ ...r, version: 1 });

    fireEvent.click(screen.getByTestId('reply-share-copy'));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(String(writeText.mock.calls[0][0])).toMatch(/\/lite\/reply\/R1_/);
  });
});

describe('DareSheet: R2 replies and the onShared hook', () => {
  let open: ReturnType<typeof vi.fn>;
  let writeText: ReturnType<typeof vi.fn>;
  const dare: Dare = { ...base, deadline: Math.floor(Date.now() / 1000) + 3 * 3600 };
  const rematchDeadline = Math.floor(Date.now() / 1000) + 20 * 3600;

  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null);
    open = vi.fn();
    vi.stubGlobal('open', open);
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('reply mode with a twist: shows the twist outcome, sends an R2 link with the rematch line', async () => {
    const r: DareReply = { dare, points: 392, best: true, version: 2, twistId: 't4', twist: 'right', nonce: 'q1w2e3', rematchDeadline };
    const onShared = vi.fn();
    render(<DareSheet open onClose={() => {}} dare={dare} moveNumber={3} moveTitle="Students are gathering" chapterTitle="The Exam Leak" mode="reply" reply={r} onShared={onShared} />);
    expect(screen.getByTestId('reply-twist').textContent).toBe('Twist cracked');
    expect(screen.getByTestId('reply-twist').getAttribute('data-tone')).toBe('right');

    fireEvent.click(screen.getByTestId('reply-share-whatsapp'));
    const wa = decodeURIComponent(String(open.mock.calls[0][0]));
    expect(wa).toContain('I found the best move. I took a twist too. Your turn: try my twist before midnight.');
    expect(wa).not.toMatch(/cracked/i);
    expect(wa).toContain('/lite/reply/R2_');
    expect(decodeDareReply(wa.slice(wa.indexOf('http')))).toEqual(r);
    expect(onShared).toHaveBeenLastCalledWith('native');

    fireEvent.click(screen.getByTestId('reply-share-copy'));
    await waitFor(() => expect(onShared).toHaveBeenLastCalledWith('clipboard'));
    expect(String(writeText.mock.calls[0][0])).toMatch(/\/lite\/reply\/R2_/);

    fireEvent.click(screen.getByTestId('reply-share'));
    await waitFor(() => expect(onShared).toHaveBeenCalledTimes(3));
    expect(onShared).toHaveBeenLastCalledWith('clipboard');
  });

  it('reply mode with a tried twist says so kindly; a skipped twist shows nothing', () => {
    const tried: DareReply = { dare, points: 40, best: false, version: 2, twistId: 't4', twist: 'wrong', nonce: 'q1w2e3', rematchDeadline };
    render(<DareSheet open onClose={() => {}} dare={dare} moveNumber={3} moveTitle="" chapterTitle="The Exam Leak" mode="reply" reply={tried} />);
    expect(screen.getByTestId('reply-twist').textContent).toBe('Twist tried');
    cleanup();
    const skipped: DareReply = { dare, points: 40, best: false, version: 2, twist: 'skipped', nonce: 'q1w2e3', rematchDeadline };
    render(<DareSheet open onClose={() => {}} dare={dare} moveNumber={3} moveTitle="" chapterTitle="The Exam Leak" mode="reply" reply={skipped} />);
    expect(screen.queryByTestId('reply-twist')).toBeNull();
    fireEvent.click(screen.getByTestId('reply-share-whatsapp'));
    const wa = decodeURIComponent(String(open.mock.calls[0][0]));
    expect(wa).not.toContain('twist');
    expect(decodeDareReply(wa.slice(wa.indexOf('http')))).toEqual(skipped);
  });

  it('dare mode calls onShared after channel taps and copies, never before', async () => {
    const onShared = vi.fn();
    render(<DareSheet open onClose={() => {}} dare={dare} moveNumber={3} moveTitle="Students are gathering" chapterTitle="The Exam Leak" onShared={onShared} />);
    expect(onShared).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('dare-share-telegram'));
    expect(onShared).toHaveBeenCalledWith('native');
    fireEvent.click(screen.getByTestId('dare-share-copy'));
    await waitFor(() => expect(onShared).toHaveBeenLastCalledWith('clipboard'));
  });

  it('does not call onShared when copying fails', async () => {
    writeText.mockRejectedValue(new Error('denied'));
    Object.defineProperty(document, 'execCommand', { value: () => false, configurable: true });
    const onShared = vi.fn();
    render(<DareSheet open onClose={() => {}} dare={dare} moveNumber={3} moveTitle="Students are gathering" chapterTitle="The Exam Leak" onShared={onShared} />);
    fireEvent.click(screen.getByTestId('dare-share-copy'));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(onShared).not.toHaveBeenCalled();
  });
});
