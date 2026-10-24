import type { CampaignResult } from '@/engine/types';
import { isSimple } from '@/app/simple';
import { buildCardModel, renderCard, shareText, type CardModel, type CardSize } from './resultCard';
import { dailyFileName, dailyShareText, renderDailyCard, type DailyCardModel, type DailyCardSize } from './dailyCard';

export type ShareOutcome = 'shared' | 'copied' | 'downloaded' | 'cancelled' | 'failed';
export type ShareMethod = 'native' | 'clipboard' | 'download';

/** Maps an outcome to the analytics `shareMethod` property (undefined when nothing was shared). */
export function shareMethodOf(outcome: ShareOutcome): ShareMethod | undefined {
  if (outcome === 'shared') return 'native';
  if (outcome === 'copied') return 'clipboard';
  if (outcome === 'downloaded') return 'download';
  return undefined;
}

/** Everything the share paths need, independent of which card produced it. */
export interface SharePayload {
  blob?: Blob;
  fileName: string;
  title: string;
  text: string;
  url: string;
  /** Accessible description of the image (sent as text where files are supported). */
  alt?: string;
  dialogTitle?: string;
}

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

async function nativeSharePayload(p: SharePayload): Promise<ShareOutcome> {
  const [{ Filesystem, Directory }, { Share }] = await Promise.all([import('@capacitor/filesystem'), import('@capacitor/share')]);
  const files: string[] = [];
  if (p.blob) {
    const data = await blobToBase64(p.blob);
    const written = await Filesystem.writeFile({ path: p.fileName, data, directory: Directory.Cache });
    files.push(written.uri);
  }
  try {
    await Share.share({ title: p.title, text: p.text, url: p.url, files, dialogTitle: p.dialogTitle ?? 'Challenge a friend' });
    return 'shared';
  } catch (err) {
    if (isAbort(err) || /cancel/i.test(String((err as { message?: string })?.message ?? ''))) return 'cancelled';
    // Some targets reject files + url together; retry text only.
    await Share.share({ title: p.title, text: p.text, dialogTitle: p.dialogTitle ?? 'Challenge a friend' });
    return 'shared';
  }
}

async function webSharePayload(p: SharePayload): Promise<ShareOutcome | null> {
  const nav = navigator as Navigator & { canShare?: (data?: ShareData) => boolean };
  if (typeof nav.share !== 'function') return null;
  const file = p.blob && typeof File !== 'undefined' ? new File([p.blob], p.fileName, { type: 'image/png' }) : undefined;
  const withFile: ShareData = file ? { files: [file], title: p.title, text: p.alt ? `${p.text}\n${p.alt}` : p.text } : {};
  try {
    if (file && typeof nav.canShare === 'function' && nav.canShare(withFile)) {
      await nav.share(withFile);
      return 'shared';
    }
    await nav.share({ title: p.title, text: p.text, url: p.url });
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

/** Shared tail of every share flow: native sheet → Web Share → clipboard + download. Never throws. */
export async function shareCard(p: SharePayload): Promise<ShareOutcome> {
  try {
    if (p.blob && (await isNativePlatform())) {
      return await nativeSharePayload(p);
    }
  } catch (err) {
    if (isAbort(err)) return 'cancelled';
  }

  try {
    const web = await webSharePayload(p);
    if (web) return web;
  } catch {
    /* fall through to clipboard */
  }

  const copied = await copyToClipboard(`${p.text}`.includes(p.url) ? p.text : `${p.text} ${p.url}`);
  if (p.blob) {
    try {
      triggerDownload(p.blob, p.fileName);
      return copied ? 'copied' : 'downloaded';
    } catch {
      /* ignore */
    }
  }
  return copied ? 'copied' : 'failed';
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
  return shareCard({
    blob,
    fileName: fileNameFor(model, size),
    title: model.appName,
    text: blob ? shareText(model) : `${model.tagline}\n${model.outcomeLabel} · ${model.score}/100\n${model.url}`,
    url: model.url,
  });
}

export interface DailyShareOptions {
  size?: DailyCardSize;
  blob?: Blob;
}

/** Shares a spoiler-free daily card. Same fallbacks as `shareResult`; returns the outcome so callers can record the method. */
export async function shareDaily(model: DailyCardModel, opts: DailyShareOptions = {}): Promise<ShareOutcome> {
  const size = opts.size ?? 'landscape';
  let blob = opts.blob;
  try {
    blob = blob ?? (await renderDailyCard(model, size));
  } catch {
    blob = undefined;
  }
  return shareCard({
    blob,
    fileName: dailyFileName(model, size),
    title: model.appName,
    text: dailyShareText(model),
    url: model.url,
    alt: model.alt,
    dialogTitle: model.simple ? 'Challenge a friend' : 'Challenge friends',
  });
}
