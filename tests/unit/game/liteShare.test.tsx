import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { hashString } from '@/engine/prng';
import { LITE_INVITE, decodeLiteChallenge, encodeLiteChallenge, liteChallengeUrl, liteShareText, type LiteChallenge } from '@/share/liteChallenge';
import { LITE_CARD_DIMENSIONS, liteCardAlt, liteCardFileName, medalTier, renderLiteCard, type LiteCardModel } from '@/share/liteCard';
import { ChallengeSheet } from '@/components/game/share/ChallengeSheet';

const CODE_SHAPE = /^L1-[0-9a-z]{1,7}-[0-9a-z]{1,4}-[0-3]-[0-9a-z]$/;

/** Builds a code with a valid checksum for arbitrary (possibly out-of-range) parts, to test range checks in isolation. */
function craft(seed36: string, points36: string, stars: string): string {
  const body = `L1-${seed36}-${points36}-${stars}`;
  return `${body}-${(hashString(body) % 36).toString(36)}`;
}

const model: LiteCardModel = {
  points: 2266,
  stars: 2,
  outcomeLabel: 'Free but Shaky',
  missionsDone: 2,
  missionsTotal: 3,
  bugs: 1,
  code: encodeLiteChallenge({ seed: 123456789, points: 2266, stars: 2 }),
  url: 'https://vande.example/lite/x',
  chapterTitle: 'The Exam Leak',
};

describe('lite challenge codes', () => {
  it('round-trips edge values for seed, points and stars', () => {
    const seeds = [0, 1, 123456789, 2 ** 32 - 1];
    const points = [0, 1, 2266, 99999];
    const stars: LiteChallenge['stars'][] = [0, 1, 2, 3];
    for (const seed of seeds)
      for (const p of points)
        for (const st of stars) {
          const code = encodeLiteChallenge({ seed, points: p, stars: st });
          expect(code).toMatch(CODE_SHAPE);
          expect(decodeLiteChallenge(code)).toEqual({ seed, points: p, stars: st });
        }
  });

  it('normalises out-of-range input when encoding', () => {
    expect(decodeLiteChallenge(encodeLiteChallenge({ seed: -1, points: 150000, stars: 3 }))).toEqual({ seed: 2 ** 32 - 1, points: 99999, stars: 3 });
    expect(decodeLiteChallenge(encodeLiteChallenge({ seed: 7, points: -5, stars: 0 }))?.points).toBe(0);
  });

  it('tolerates case, whitespace and full links', () => {
    const code = encodeLiteChallenge({ seed: 987654321, points: 2266, stars: 2 });
    const expected = { seed: 987654321, points: 2266, stars: 2 };
    expect(decodeLiteChallenge(code.toUpperCase())).toEqual(expected);
    expect(decodeLiteChallenge(`  ${code}\n`)).toEqual(expected);
    expect(decodeLiteChallenge(`https://paulhironmoy.github.io/Vande/lite/${code}`)).toEqual(expected);
    expect(decodeLiteChallenge(`https://vande.example/lite/${code}?utm=x#top`)).toEqual(expected);
    expect(decodeLiteChallenge(`https://vande.example/lite/${encodeURIComponent(code)}/`)).toEqual(expected);
  });

  it('rejects every single-character tamper', () => {
    const code = encodeLiteChallenge({ seed: 123456789, points: 2266, stars: 2 });
    for (let i = 0; i < code.length; i++) {
      const ch = code[i];
      if (ch === '-') continue;
      const replacement = ch === '0' ? '1' : ch === 'l' || ch === 'L' ? 'X' : /[0-9]/.test(ch) ? String((Number(ch) + 1) % 10) : ch === 'z' ? 'y' : String.fromCharCode(ch.charCodeAt(0) + 1);
      const tampered = code.slice(0, i) + replacement + code.slice(i + 1);
      expect(decodeLiteChallenge(tampered), `position ${i}: ${tampered}`).toBeNull();
    }
  });

  it('rejects malformed, out-of-range and non-canonical codes even with a valid checksum', () => {
    expect(decodeLiteChallenge('')).toBeNull();
    expect(decodeLiteChallenge('nonsense')).toBeNull();
    expect(decodeLiteChallenge('V1-EX-abc-S-5-c')).toBeNull();
    expect(decodeLiteChallenge(craft('abc', 'zzzz', '2'))).toBeNull(); // points 1,679,615 > 99,999
    expect(decodeLiteChallenge(craft('abc', '255s', '2'))).toBeNull(); // 100,000
    expect(decodeLiteChallenge(craft('abc', '255r', '2'))).toEqual({ seed: parseInt('abc', 36), points: 99999, stars: 2 });
    expect(decodeLiteChallenge(craft('1z141z4', '10', '2'))).toBeNull(); // seed 2^32 overflows
    expect(decodeLiteChallenge(craft('abc', '10', '4'))).toBeNull(); // stars 4
    expect(decodeLiteChallenge(craft('0abc', '10', '2'))).toBeNull(); // padded seed
    expect(decodeLiteChallenge(craft('abc', '010', '2'))).toBeNull(); // padded points
    expect(decodeLiteChallenge(`${craft('abc', '10', '2')}-x`)).toBeNull(); // extra segment
    expect(decodeLiteChallenge('L1-abc-10-2')).toBeNull(); // missing checksum
  });

  it('builds links from the base path', () => {
    const code = encodeLiteChallenge({ seed: 42, points: 100, stars: 1 });
    expect(liteChallengeUrl(code, 'https://vande.example')).toBe(`https://vande.example/lite/${code}`);
    expect(liteChallengeUrl(code, 'https://vande.example/')).toBe(`https://vande.example/lite/${code}`);
    vi.stubEnv('BASE_URL', '/Vande');
    expect(liteChallengeUrl(code, 'https://paulhironmoy.github.io')).toBe(`https://paulhironmoy.github.io/Vande/lite/${code}`);
    vi.stubEnv('BASE_URL', '/Vande/');
    expect(liteChallengeUrl(code, 'https://paulhironmoy.github.io')).toBe(`https://paulhironmoy.github.io/Vande/lite/${code}`);
    vi.unstubAllEnvs();
    expect(decodeLiteChallenge(liteChallengeUrl(code, 'https://vande.example'))).toEqual({ seed: 42, points: 100, stars: 1 });
  });

  it('writes two short lines with points, stars and the invitation', () => {
    const text = liteShareText({ points: 2266, stars: 2, outcomeLabel: 'Free but Shaky' });
    const lines = text.split('\n');
    expect(lines).toHaveLength(2);
    expect(text).toContain('2,266 points');
    expect(text).toContain('★★☆');
    expect(text).toContain('Free but Shaky');
    expect(text.endsWith(LITE_INVITE)).toBe(true);
    expect(text).not.toMatch(/https?:/);
    expect(liteShareText({ points: 10, stars: 3, outcomeLabel: 'Strong and Fair City', beatFriend: true })).toMatch(/^Challenge beaten! 10 points ★★★/);
    expect(liteShareText({ points: 0, stars: 0, outcomeLabel: 'In trouble' })).toContain('☆☆☆');
  });
});

describe('lite result card', () => {
  afterEach(() => vi.restoreAllMocks());

  it('exposes the two sizes, medal tiers, alt text and file names', () => {
    expect(LITE_CARD_DIMENSIONS.landscape).toEqual({ width: 1200, height: 630 });
    expect(LITE_CARD_DIMENSIONS.square).toEqual({ width: 1080, height: 1080 });
    expect([0, 1, 2, 3].map(medalTier)).toEqual(['steel', 'bronze', 'silver', 'gold']);
    const alt = liteCardAlt(model);
    expect(alt).toContain('2,266 points');
    expect(alt).toContain('2 of 3 stars');
    expect(alt).toContain('Free but Shaky');
    expect(alt).toContain('Missions 2 of 3');
    expect(alt).toContain('1 bug squashed');
    expect(alt).toContain(model.code);
    expect(liteCardFileName(model)).toBe('vande-lite-2266.png');
    expect(liteCardFileName(model, 'square')).toBe('vande-lite-2266-square.png');
  });

  it('rejects with a clear error when Canvas 2D is unavailable', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null);
    await expect(renderLiteCard(model)).rejects.toThrow(/Canvas 2D is not available/);
    await expect(renderLiteCard(model, 'square')).rejects.toThrow(/Canvas 2D is not available/);
  });
});

describe('ChallengeSheet', () => {
  let open: ReturnType<typeof vi.fn>;
  let writeText: ReturnType<typeof vi.fn>;

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

  it('offers every channel, opens targets only on tap and copies the link and the code', async () => {
    render(<ChallengeSheet open onClose={() => {}} model={model} />);
    expect(screen.getByTestId('lite-share-sheet')).toBeTruthy();
    for (const id of ['lite-share', 'lite-share-whatsapp', 'lite-share-telegram', 'lite-share-x', 'lite-share-sms', 'lite-share-email', 'lite-share-copy', 'lite-share-save']) {
      expect(screen.getByTestId(id)).toBeTruthy();
    }
    expect(screen.getByTestId('lite-share-code').textContent).toBe(model.code);
    expect(open).not.toHaveBeenCalled();

    // Canvas is unavailable in jsdom: the preview hides itself and saving is disabled.
    await waitFor(() => expect(screen.queryByTestId('lite-share-preview')).toBeNull());
    expect((screen.getByTestId('lite-share-save') as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByTestId('lite-share-whatsapp'));
    expect(open).toHaveBeenCalledTimes(1);
    const [waUrl, target, features] = open.mock.calls[0];
    expect(waUrl).toMatch(/^https:\/\/wa\.me\/\?text=/);
    expect(decodeURIComponent(String(waUrl))).toContain('2,266 points');
    expect(decodeURIComponent(String(waUrl))).toContain(model.url);
    expect(target).toBe('_blank');
    expect(features).toBe('noopener,noreferrer');

    fireEvent.click(screen.getByTestId('lite-share-telegram'));
    expect(String(open.mock.calls[1][0])).toMatch(/^https:\/\/t\.me\/share\/url\?url=/);
    fireEvent.click(screen.getByTestId('lite-share-x'));
    expect(String(open.mock.calls[2][0])).toMatch(/^https:\/\/x\.com\/intent\/post\?text=/);

    fireEvent.click(screen.getByTestId('lite-share-copy'));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(model.url));
    fireEvent.click(screen.getByTestId('lite-share-copy-code'));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(model.code));
  });

  it('falls back to copying the challenge text and link when no share sheet exists', async () => {
    render(<ChallengeSheet open onClose={() => {}} model={model} beatFriend />);
    expect(screen.getByText(/You beat the challenge/)).toBeTruthy();
    fireEvent.click(screen.getByTestId('lite-share'));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const copied = String(writeText.mock.calls[0][0]);
    expect(copied).toContain('Challenge beaten!');
    expect(copied).toContain(model.url);
  });
});
