/**
 * src/platform: device integrations behind the root's adapter interfaces (src/contracts/adapters.ts), each with a
 * working mock and a disabled default, so missing credentials never block development.
 *
 *   VITE_PUBLIC_WEB_ORIGIN   origin of invite links (https://…), besides the page's own origin
 *   VITE_PUSH_ENABLED=1      FCM push through the native plugin
 *   VITE_GOOGLE_CLIENT_ID    Google linking and recovery (web client id)
 *   VITE_PASSKEYS=1          passkeys (also needs the server verifier)
 */
import type { AdsAdapter, BillingAdapter, DeepLinkSource, IdentityProvider, PushAdapter, SecureStore, ShareAdapter } from '@/contracts';
import { createDeepLinkSource } from './deepLinks';
import { createGoogleIdentityProvider, createPasskeyIdentityProvider } from './identity';
import { createInstallReferrerSource, nativeInstallReferrer } from './installReferrer';
import { useApp } from '@/app/store';
import { createDisabledAds, createDisabledBilling, guardAds } from './monetization';
import { createFcmPushAdapter, nativePushPlugin } from './push';
import { browserSecureStore, defaultSecureStore } from './secureStore';
import { NATIVE_TIMEOUT_MS, settleWithin } from './capacitor';
import { createShareAdapter } from './share';

export interface Platform {
  secureStore: SecureStore;
  share: ShareAdapter;
  deepLinks: DeepLinkSource;
  push: PushAdapter;
  identity: { google: IdentityProvider; passkey: IdentityProvider };
  ads: AdsAdapter;
  billing: BillingAdapter;
  /** Origins whose /i/ and /m/ links are the app's own. */
  webOrigins: string[];
  /**
   * The attribution code of an install that came through a highlight or invite link (the Play install referrer, read
   * once at the first launch); a listener added later still hears it once. Codes only, never a person.
   */
  onAttributedInstall(cb: (code: string) => void): () => void;
}

/** One value, heard by every listener once, also by listeners that subscribe after it happened. */
function lateEvent<T>(): { emit(value: T): void; on(cb: (value: T) => void): () => void } {
  let last: { value: T } | null = null;
  const listeners = new Set<(value: T) => void>();
  return {
    emit(value) {
      last = { value };
      for (const l of listeners) l(value);
    },
    on(cb) {
      listeners.add(cb);
      if (last) cb(last.value);
      return () => listeners.delete(cb);
    },
  };
}

export interface PlatformOptions {
  /** The ads provider (disabled by default); whatever it is, it is wrapped so it never shows during an innings. */
  ads?: AdsAdapter;
  /** Whether an innings or a plan is in play right now (default: the app store's `inPlay`). */
  inningsActive?: () => boolean;
  /** How long boot waits for each native answer before falling back (default 3 s). */
  nativeTimeoutMs?: number;
}

/**
 * Always resolves, whatever the native side does: a plugin that rejects or never answers falls back (encrypted
 * IndexedDB or memory for the secure store, no install referrer, no launch link) instead of leaving the app on
 * "Setting up the ground". Plugins are only ever passed around boxed (PluginBox in ./capacitor).
 */
export async function createPlatform(env: Record<string, unknown> = import.meta.env as Record<string, unknown>, opts: PlatformOptions = {}): Promise<Platform> {
  const ms = opts.nativeTimeoutMs ?? NATIVE_TIMEOUT_MS;
  const [secureStore, referrerPlugin] = await Promise.all([
    // defaultSecureStore settles by itself; the outer bound is a second line of defence.
    settleWithin(defaultSecureStore(ms), 3 * ms, null).then((s) => s ?? browserSecureStore(ms)),
    settleWithin(nativeInstallReferrer(), ms, null),
  ]);
  const webOrigins = [String(env.VITE_PUBLIC_WEB_ORIGIN ?? '').replace(/\/+$/, ''), typeof location !== 'undefined' ? location.origin : ''].filter((o) => /^https?:\/\//.test(o));
  const installs = lateEvent<string>();
  const referrer = createInstallReferrerSource({ plugin: referrerPlugin?.plugin ?? null, store: secureStore, timeoutMs: ms, onInstall: (code) => installs.emit(code) });
  return {
    secureStore,
    share: createShareAdapter(),
    deepLinks: createDeepLinkSource({ referrer: () => referrer.pendingInviteUrl(), timeoutMs: ms }),
    push: createFcmPushAdapter({ enabled: String(env.VITE_PUSH_ENABLED ?? '') === '1', plugin: nativePushPlugin }),
    identity: {
      google: createGoogleIdentityProvider({ clientId: String(env.VITE_GOOGLE_CLIENT_ID ?? '') || null }),
      passkey: createPasskeyIdentityProvider({ enabled: String(env.VITE_PASSKEYS ?? '') === '1' }),
    },
    // Any provider, now or later, is guarded: never an ad while a ball or a plan is in play.
    ads: guardAds(opts.ads ?? createDisabledAds(), opts.inningsActive ?? (() => useApp.getState().inPlay)),
    billing: createDisabledBilling(),
    webOrigins,
    onAttributedInstall: installs.on,
  };
}

export { parseAppLink, createDeepLinkSource } from './deepLinks';
export type { AppLink } from './deepLinks';
export { createShareAdapter, whatsappUrl, openWhatsapp } from './share';
export { createIdbSecureStore, createMemorySecureStore, createNativeSecureStore, defaultSecureStore } from './secureStore';
export { playStoreUrl, parseInstallReferrer, createInstallReferrerSource } from './installReferrer';
export { createFcmPushAdapter, createMockPushAdapter, createDisabledPushAdapter } from './push';
export { createGoogleIdentityProvider, createPasskeyIdentityProvider, createMockIdentityProvider } from './identity';
export { createDisabledAds, createDisabledBilling, createMockAds, createMockBilling, guardAds } from './monetization';
export { buildShareMessage, canShare, claimMoment, istWhen, localShareLedger, memoryShareLedger, reminderFor, setMomentClaimer, shareMoment } from './shareMoments';
export type { MomentClaimer, ShareContext, ShareLedger, ShareMoment } from './shareMoments';
export { isNativePlatform } from './capacitor';
