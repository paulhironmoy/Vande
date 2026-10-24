import type { CampaignResult } from '@/engine/types';
import { isSimple } from '@/app/simple';
import { buildCardModel, renderCard, shareText, type CardModel, type CardSize } from './resultCard';

export type ShareOutcome = 'shared' | 'copied' | 'downloaded' | 'cancelled' | 'failed';

export interface ShareOptions {
  size?: CardSize;
  /** Pre-rendered card (avoids drawing twice). */
  blob?: Blob;
  model?: CardModel;
  base?: string;
  /** Simple play style vocabulary on the card; defaults to the current setting. */
  simple?: boolean;
}

export function basePath(): string {
  try {
    return import.meta.env.BASE_URL || '/';
  } catch {
    return '/';
  }
}

export function fileNameFor(model: CardModel, size: CardSize): string {
  return `vande-${model.outcome}-${model.score}${size === 'portrait' ? '-story' : ''}.png`;
}

export async function isNativePlatform(): Promise<boolean> {
  try {
    const { Capacitor } = await import('@capacitor/core');
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the image.'));
    reader.onload = () => {
      const dataUrl = String(reader.result ?? '');
      resolve(dataUrl.slice(dataUrl.indexOf(',') + 1));
    };
    reader.readAsDataURL(blob);
  });
}

function isAbort(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'name' in err && (err as { name?: string }).name === 'AbortError';
}

async function nativeShare(model: CardModel, blob: Blob, size: CardSize): Promise<ShareOutcome> {
  const [{ Filesystem, Directory }, { Share }] = await Promise.all([import('@capacitor/filesystem'), import('@capacitor/share')]);
  const data = await blobToBase64(blob);
  const written = await Filesystem.writeFile({ path: fileNameFor(model, size), data, directory: Directory.Cache });
  try {
    await Share.share({
      title: model.appName,
      text: shareText(model),
      url: model.url,
      files: [written.uri],
      dialogTitle: 'Challenge a friend',
    });
    return 'shared';
  } catch (err) {
    if (isAbort(err) || /cancel/i.test(String((err as { message?: string })?.message ?? ''))) return 'cancelled';
    // Some targets reject files + url together; retry text only.
    await Share.share({ title: model.appName, text: shareText(model), dialogTitle: 'Challenge a friend' });
    return 'shared';
  }
}

async function webShare(model: CardModel, blob: Blob, size: CardSize): Promise<ShareOutcome | null> {
  const nav = navigator as Navigator & { canShare?: (data?: ShareData) => boolean };
  if (typeof nav.share !== 'function') return null;
  const file = typeof File !== 'undefined' ? new File([blob], fileNameFor(model, size), { type: 'image/png' }) : undefined;
  const withFile: ShareData = file ? { files: [file], title: model.appName, text: shareText(model) } : {};
  try {
    if (file && typeof nav.canShare === 'function' && nav.canShare(withFile)) {
      await nav.share(withFile);
      return 'shared';
    }
    await nav.share({ title: model.appName, text: `${model.tagline}\n${model.outcomeLabel} · ${model.score}/100`, url: model.url });
    return 'shared';
  } catch (err) {
    if (isAbort(err)) return 'cancelled';
    return null;
  }
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * Shares a result through the native share sheet (Android/Capacitor or Web Share API).
 * Falls back to copying the challenge link and downloading the image.
 */
export async function shareResult(result: CampaignResult, origin: string, opts: ShareOptions = {}): Promise<ShareOutcome> {
  const size = opts.size ?? 'landscape';
  const model = opts.model ?? buildCardModel(result, { origin, base: opts.base ?? basePath(), simple: opts.simple ?? isSimple() });
  let blob = opts.blob;
  try {
    blob = blob ?? (await renderCard(model, size));
  } catch {
    blob = undefined;
  }

  try {
    if (blob && (await isNativePlatform())) {
      return await nativeShare(model, blob, size);
    }
  } catch (err) {
    if (isAbort(err)) return 'cancelled';
  }

  if (blob) {
    const web = await webShare(model, blob, size);
    if (web) return web;
  } else {
    const nav = navigator as Navigator;
    if (typeof nav.share === 'function') {
      try {
        await nav.share({ title: model.appName, text: `${model.tagline}\n${model.outcomeLabel} · ${model.score}/100`, url: model.url });
        return 'shared';
      } catch (err) {
        if (isAbort(err)) return 'cancelled';
      }
    }
  }

  const copied = await copyToClipboard(`${model.tagline} ${model.url}`);
  if (blob) {
    try {
      triggerDownload(blob, fileNameFor(model, size));
      return copied ? 'copied' : 'downloaded';
    } catch {
      /* ignore */
    }
  }
  return copied ? 'copied' : 'failed';
}
