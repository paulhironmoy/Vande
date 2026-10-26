/**
 * Id, token and link formats shared by the Worker and the app. Pure.
 *
 * Public ids are a one-letter kind and 128 random bits in lowercase base32: m… match, p… player, c… cup, g… group.
 * Invite links: https://<web origin>/i/<code>[?a=<attribution>] open the web app (no install needed) and, once the
 * app is installed, Android App Links open the app instead. Custom scheme: vandecricket://i/<code>. The code is 10
 * random base32 characters that the server stores with the invite's signed token and expiry; links made before codes
 * existed carry the 75-character signed token itself, and both keep working.
 */
import type { LocaleId } from '@/contracts';

export const MATCH_ID_RE = /^m[a-z2-7]{26}$/;
export const PLAYER_ID_RE = /^p[a-z2-7]{26}$/;
export const CUP_ID_RE = /^c[a-z2-7]{26}$/;
export const GROUP_ID_RE = /^g[a-z2-7]{26}$/;
export const ROOM_ID_RE = /^r[a-z2-7]{26}$/;

/** The Cricket Room of a duel (from its match id) or a cup (from its cup id); a cup's fixtures share the cup's room. */
export function roomIdFor(matchOrCupId: string): string {
  return `r${matchOrCupId.slice(1)}`;
}
/** A signed invite token: 38-byte payload + 16-byte MAC, base64url (older links; the server verifies the signature). */
export const SIGNED_INVITE_TOKEN_RE = /^[A-Za-z0-9_-]{51}\.[A-Za-z0-9_-]{22}$/;
/** A short invite code: 10 random base32 characters (50 bits), resolved by the server. */
export const INVITE_CODE_RE = /^[a-z2-7]{10}$/;
/** What an invite link (/i/<token>) carries: a short code, or the signed token of a link made before codes. */
export const INVITE_TOKEN_RE = /^(?:[a-z2-7]{10}|[A-Za-z0-9_-]{51}\.[A-Za-z0-9_-]{22})$/;
/** Short attribution codes carried by invite and highlight links (never a person). */
export const ATTRIBUTION_RE = /^[a-z0-9]{4,16}$/;
/** A highlight's public code is its attribution code (https://<web origin>/h/<code>). */
export const HIGHLIGHT_CODE_RE = ATTRIBUTION_RE;
/** Shared match codes (https://<web>/s/<code>): the same shape as highlight codes. */
export const SHARED_CODE_RE = ATTRIBUTION_RE;
/** Idempotency keys: UUIDs (any version) or other 16–64 character keys of letters, digits and hyphens. */
export const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9-]{16,64}$/;

export const INVITE_PATH = '/i/';
export const HIGHLIGHT_PATH = '/h/';
export const SHARED_PATH = '/s/';
export const CUSTOM_SCHEMES = ['vandecricket', 'in.vande.cricket'] as const;

export function inviteUrl(webOrigin: string, token: string, attribution?: string): string {
  const base = `${webOrigin.replace(/\/+$/, '')}${INVITE_PATH}${token}`;
  return attribution && ATTRIBUTION_RE.test(attribution) ? `${base}?a=${attribution}` : base;
}

/** The public landing of a published highlight ("Can you beat them?"). */
export function highlightUrl(webOrigin: string, code: string): string {
  return `${webOrigin.replace(/\/+$/, '')}${HIGHLIGHT_PATH}${code}`;
}

export function sharedUrl(webOrigin: string, code: string): string {
  return `${webOrigin.replace(/\/+$/, '')}${SHARED_PATH}${code}`;
}

export const LOCALE_IDS = ['en', 'hi', 'hi-Latn', 'bn', 'te', 'mr', 'ta', 'gu', 'kn', 'ml', 'pa'] as const satisfies readonly LocaleId[];

export function isLocaleId(value: unknown): value is LocaleId {
  return typeof value === 'string' && (LOCALE_IDS as readonly string[]).includes(value);
}
