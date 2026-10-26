/**
 * ShareAdapter (src/contracts/adapters.ts): the system share sheet first (Capacitor Share natively, with the image as
 * a cached file; Web Share on the web, with the image when the browser can share files), then the clipboard. It never
 * sends anything by itself, never asks for contacts, and wa.me links are built only when the player taps WhatsApp.
 * Salvaged from the previous app's share flow.
 */
import type { ShareAdapter } from '@/contracts';
import { isNativePlatform } from './capacitor';

export type ShareInput = Parameters<ShareAdapter['share']>[0];
export type ShareOutcome = Awaited<ReturnType<ShareAdapter['share']>>;

/** https://wa.me/?text=… — the player picks the chat in WhatsApp; nothing is sent automatically. */
export function whatsappUrl(text: string, url: string): string {
  const message = url ? `${text}\n${url}` : text;
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}

/** Opens WhatsApp with the message ready. Call it only from the player's tap (a user gesture). */
export function openWhatsapp(text: string, url: string, open: (href: string, target: string, features: string) => unknown = (h, t, f) => window.open(h, t, f)): void {
  open(whatsappUrl(text, url), '_blank', 'noopener,noreferrer');
}

function isAbort(e: unknown): boolean {
  const name = (e as { name?: string } | null)?.name;
  const message = String((e as { message?: string } | null)?.message ?? '');
  return name === 'AbortError' || /cancel/i.test(message);
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export interface ShareDeps {
  native?: () => boolean;
  nativeShare?: (input: ShareInput) => Promise<ShareOutcome>;
  nav?: { share?: (data: ShareData) => Promise<void>; canShare?: (data: ShareData) => boolean; clipboard?: { writeText(text: string): Promise<void> } };
}

async function capacitorShare(input: ShareInput): Promise<ShareOutcome> {
  const { Share } = await import('@capacitor/share');
  const files: string[] = [];
  if (input.image) {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    const written = await Filesystem.writeFile({ path: `vande-share-${Date.now()}.png`, data: await blobToBase64(input.image), directory: Directory.Cache });
    files.push(written.uri);
  }
  try {
    await Share.share({ title: input.title, text: input.text, url: input.url, files: files.length ? files : undefined, dialogTitle: input.title });
    return 'shared';
  } catch (e) {
    if (isAbort(e)) return 'cancelled';
    // Some targets refuse files with a URL; try the text and link alone.
    await Share.share({ title: input.title, text: input.text, url: input.url, dialogTitle: input.title });
    return 'shared';
  }
}

export function createShareAdapter(deps: ShareDeps = {}): ShareAdapter {
  const native = deps.native ?? isNativePlatform;
  const nav = deps.nav ?? (typeof navigator !== 'undefined' ? (navigator as ShareDeps['nav']) : undefined);
  return {
    async share(input) {
      try {
        if (native()) return await (deps.nativeShare ?? capacitorShare)(input);
      } catch (e) {
        if (isAbort(e)) return 'cancelled';
      }
      if (nav?.share) {
        try {
          const file = input.image && typeof File !== 'undefined' ? new File([input.image], 'vande-cricket.png', { type: input.image.type || 'image/png' }) : null;
          const withFile: ShareData | null = file ? { files: [file], title: input.title, text: `${input.text}\n${input.url}` } : null;
          if (withFile && nav.canShare?.(withFile)) await nav.share(withFile);
          else await nav.share({ title: input.title, text: input.text, url: input.url });
          return 'shared';
        } catch (e) {
          if (isAbort(e)) return 'cancelled';
        }
      }
      try {
        if (nav?.clipboard?.writeText) {
          await nav.clipboard.writeText(`${input.text}\n${input.url}`);
          return 'copied';
        }
      } catch {
        /* fall through */
      }
      return 'failed';
    },
    whatsappUrl,
  };
}
