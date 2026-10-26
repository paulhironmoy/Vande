import { describe, expect, it, vi } from 'vitest';
import { createShareAdapter, openWhatsapp, whatsappUrl } from '@/platform/share';

const input = { title: 'VANDE Cricket', text: 'Lock your over. Beat mine?', url: 'https://vande.example/i/abc' };

describe('share adapter', () => {
  it('uses the native share sheet in the app', async () => {
    const nativeShare = vi.fn(async () => 'shared' as const);
    const share = createShareAdapter({ native: () => true, nativeShare });
    expect(await share.share(input)).toBe('shared');
    expect(nativeShare).toHaveBeenCalledWith(input);
  });

  it('uses Web Share on the web, with the image when files can be shared', async () => {
    const calls: ShareData[] = [];
    const nav = { share: async (d: ShareData) => void calls.push(d), canShare: (d: ShareData) => Boolean(d.files) };
    const share = createShareAdapter({ native: () => false, nav });
    expect(await share.share({ ...input, image: new Blob(['png'], { type: 'image/png' }) })).toBe('shared');
    expect(calls[0].files?.[0].name).toBe('vande-cricket.png');
    expect(await share.share(input)).toBe('shared');
    expect(calls[1]).toEqual(input);
  });

  it('reports a cancelled sheet, falls back to the clipboard, and reports failure last', async () => {
    const cancel = createShareAdapter({ native: () => false, nav: { share: async () => Promise.reject(Object.assign(new Error('x'), { name: 'AbortError' })) } });
    expect(await cancel.share(input)).toBe('cancelled');
    const writeText = vi.fn(async () => undefined);
    const copy = createShareAdapter({ native: () => false, nav: { clipboard: { writeText } } });
    expect(await copy.share(input)).toBe('copied');
    expect(writeText).toHaveBeenCalledWith(`${input.text}\n${input.url}`);
    expect(await createShareAdapter({ native: () => false, nav: {} }).share(input)).toBe('failed');
  });

  it('builds wa.me links only on demand and never opens anything by itself', () => {
    const open = vi.fn();
    const share = createShareAdapter({ native: () => false, nav: {} });
    expect(open).not.toHaveBeenCalled();
    expect(share.whatsappUrl('Hi & bye', 'https://x.example/i/t?a=b')).toBe(`https://wa.me/?text=${encodeURIComponent('Hi & bye\nhttps://x.example/i/t?a=b')}`);
    expect(whatsappUrl('only text', '')).toBe('https://wa.me/?text=only%20text');
    openWhatsapp('Beat me', 'https://x.example/i/t', open);
    expect(open).toHaveBeenCalledWith(expect.stringMatching(/^https:\/\/wa\.me\/\?text=/), '_blank', 'noopener,noreferrer');
  });
});
