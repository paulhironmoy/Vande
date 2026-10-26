/**
 * Sharing with the per-match WhatsApp cap: the invitation, one optional deadline reminder and the final reveal, each
 * at most once per match (src/platform/shareMoments.ts keeps the ledger). Messages open only from the player's tap
 * and are never sent by the app. Copying the link or showing the QR code is not a message and is always allowed.
 */
import type { ShareAdapter } from '@/contracts';
import { canShare, localShareLedger, shareMoment, type ShareContext, type ShareLedger, type ShareMoment } from '@/platform/shareMoments';
import type { Translator } from '@/i18n';

let ledger: ShareLedger | null = null;
export function shareLedger(): ShareLedger {
  if (!ledger) ledger = localShareLedger();
  return ledger;
}
/** Test hook. */
export function __setShareLedger(l: ShareLedger | null): void {
  ledger = l;
}

/** The platform's message builder, translated with the app's catalogs (falls back to its built-in copy). */
export function shareTranslate(t: Translator) {
  return (key: string, params: Record<string, string>) => (t.has(key) ? t.tk(key, params) : null);
}

export function shareLocale(locale: string): ShareContext['locale'] {
  return locale === 'hi' || locale === 'hi-Latn' ? locale : 'en';
}

export type ShareChannel = 'whatsapp' | 'sheet';
export type ShareResult = 'shared' | 'copied' | 'opened' | 'cancelled' | 'failed' | 'not_allowed';

/**
 * Shares one match moment through WhatsApp or the system sheet (with the card image when the sheet can take it).
 * `text` replaces the moment's message (the final share says what its card shows: the result).
 */
export async function shareMatchMoment(adapter: ShareAdapter, moment: ShareMoment, ctx: ShareContext, opts: { via: ShareChannel; t: Translator; image?: Blob | null; now?: number; text?: string }): Promise<ShareResult> {
  const base = shareTranslate(opts.t);
  const translate = opts.text ? () => opts.text as string : base;
  // Every path goes through the platform's cap: the server-kept claim (registered by createNet, at most 1.5 s) and the
  // local ledger, which decides alone offline. The card image rides along on the system sheet.
  const image = opts.via !== 'whatsapp' && opts.image ? opts.image : undefined;
  return shareMoment(adapter, shareLedger(), moment, ctx, { via: opts.via === 'whatsapp' ? 'whatsapp' : 'sheet', t: translate, now: opts.now, ...(image ? { image } : {}) });
}

export function momentAvailable(moment: ShareMoment, ctx: ShareContext, now?: number): boolean {
  return canShare(shareLedger(), moment, ctx, now);
}

/** Copies a link; true on success. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

// ---- invites created on this device (MatchView does not carry the invite link) ------------------------------
const INVITES_KEY = 'vc:invites';
export interface SavedInvite {
  matchId: string;
  inviteToken: string;
  inviteUrl: string;
}

export function saveInvite(inv: SavedInvite): void {
  try {
    const list = (JSON.parse(localStorage.getItem(INVITES_KEY) ?? '[]') as SavedInvite[]).filter((x) => x.matchId !== inv.matchId);
    list.push(inv);
    localStorage.setItem(INVITES_KEY, JSON.stringify(list.slice(-50)));
  } catch {
    /* storage unavailable */
  }
}

export function savedInvite(by: { matchId?: string; token?: string }): SavedInvite | null {
  try {
    const list = JSON.parse(localStorage.getItem(INVITES_KEY) ?? '[]') as SavedInvite[];
    return list.find((x) => (by.matchId && x.matchId === by.matchId) || (by.token && x.inviteToken === by.token)) ?? null;
  } catch {
    return null;
  }
}

/** Says how every share ended, so nothing is ever silent (cancelled, failed, already used, copied, offline). */
export function shareToast(t: Translator, toast: (x: { kind: 'info' | 'success' | 'warning'; text: string }) => void, r: ShareResult | 'offline'): void {
  if (r === 'copied') toast({ kind: 'success', text: t.t('invite.copied') });
  else if (r === 'not_allowed') toast({ kind: 'info', text: t.t('match.share_used') });
  else if (r === 'cancelled') toast({ kind: 'info', text: t.t('common.share_cancelled') });
  else if (r === 'failed') toast({ kind: 'warning', text: t.t('common.share_failed') });
  else if (r === 'offline') toast({ kind: 'warning', text: t.t('common.share_offline') });
}
