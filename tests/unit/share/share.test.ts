import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fileNameFor, shareResult } from '@/share/share';
import { buildCardModel } from '@/share/resultCard';
import { campaignResult } from './fixtures';

describe('shareResult fallbacks (no native share available)', () => {
  const nav = navigator as Navigator & { share?: unknown; clipboard?: unknown };
  let originalShare: unknown;
  let originalClipboard: unknown;

  beforeEach(() => {
    originalShare = nav.share;
    originalClipboard = nav.clipboard;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(navigator, 'share', { value: originalShare, configurable: true, writable: true });
    Object.defineProperty(navigator, 'clipboard', { value: originalClipboard, configurable: true, writable: true });
  });

  it('copies the challenge link when nothing else is available', async () => {
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true, writable: true });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true, writable: true });
    const outcome = await shareResult(campaignResult(), 'https://vande.example', { base: '/' });
    expect(outcome).toBe('copied');
    expect(writeText).toHaveBeenCalledTimes(1);
    const text = writeText.mock.calls[0][0] as string;
    expect(text).toContain('I held the Republic together. Can you?');
    expect(text).toContain('https://vande.example/?c=');
  });

  it('uses the Web Share API with the URL when it exists', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', { value: share, configurable: true, writable: true });
    const outcome = await shareResult(campaignResult(), 'https://vande.example', { base: '/' });
    expect(outcome).toBe('shared');
    expect(share).toHaveBeenCalledTimes(1);
    expect((share.mock.calls[0][0] as ShareData).url).toContain('https://vande.example/?c=');
  });

  it('reports cancellation when the user dismisses the share sheet', async () => {
    const abort = Object.assign(new Error('cancelled'), { name: 'AbortError' });
    Object.defineProperty(navigator, 'share', { value: vi.fn().mockRejectedValue(abort), configurable: true, writable: true });
    const outcome = await shareResult(campaignResult(), 'https://vande.example', { base: '/' });
    expect(outcome).toBe('cancelled');
  });

  it('reports failure when neither sharing nor the clipboard is available', async () => {
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true, writable: true });
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true, writable: true });
    const outcome = await shareResult(campaignResult(), 'https://vande.example', { base: '/' });
    expect(outcome).toBe('failed');
  });
});

describe('fileNameFor', () => {
  it('names files by outcome and score', () => {
    const model = buildCardModel(campaignResult(), { origin: 'https://vande.example' });
    expect(fileNameFor(model, 'landscape')).toBe('vande-resilient-68.png');
    expect(fileNameFor(model, 'portrait')).toBe('vande-resilient-68-story.png');
  });
});
