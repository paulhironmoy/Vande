/**
 * IdentityProviders (src/contracts/adapters.ts) for account linking and recovery. The credential goes to the server
 * (POST /v1/auth/link/google, /v1/auth/google), which verifies it; the app never reads an email or a name.
 *
 *   Google, web: Google Identity Services, loaded only when the player taps the button (one script from
 *   accounts.google.com; the CSP must allow it). Google, Android: a native Credential Manager plugin
 *   (`VandeGoogleSignIn`, plan in docs/INFRASTRUCTURE.md). Unavailable until VITE_GOOGLE_CLIENT_ID is set.
 *   Passkeys: WebAuthn; unavailable until VITE_PASSKEYS=1 and the server verifier is configured.
 */
import type { IdentityProvider } from '@/contracts';
import { isNativePlatform, nativePlugin, type PluginBox } from './capacitor';

interface GisId {
  initialize(config: { client_id: string; callback: (r: { credential?: string }) => void; use_fedcm_for_prompt?: boolean; auto_select?: boolean }): void;
  prompt(listener?: (n: { isNotDisplayed?: () => boolean; isSkippedMoment?: () => boolean; isDismissedMoment?: () => boolean }) => void): void;
}

export interface GoogleSignInPlugin {
  signIn(options: { clientId: string }): Promise<{ idToken: string | null }>;
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('script failed to load'));
    document.head.appendChild(s);
  });
}

async function loadGis(): Promise<GisId> {
  const w = window as unknown as { google?: { accounts?: { id?: GisId } } };
  if (!w.google?.accounts?.id) await loadScript('https://accounts.google.com/gsi/client');
  const id = w.google?.accounts?.id;
  if (!id) throw new Error('Google Identity Services unavailable');
  return id;
}

export function createGoogleIdentityProvider(o: { clientId: string | null; native?: () => boolean; nativePlugin?: () => Promise<PluginBox<GoogleSignInPlugin> | null>; gis?: () => Promise<GisId> }): IdentityProvider {
  const native = o.native ?? isNativePlatform;
  return {
    id: 'google',
    available: () => Boolean(o.clientId),
    async obtainCredential() {
      if (!o.clientId) return null;
      if (native()) {
        // Boxed: awaiting a Capacitor plugin proxy itself never settles (see PluginBox).
        const boxed = await (o.nativePlugin ?? (() => nativePlugin<GoogleSignInPlugin>('VandeGoogleSignIn')))().catch(() => null);
        if (!boxed) return null;
        return (await boxed.plugin.signIn({ clientId: o.clientId }).catch(() => ({ idToken: null }))).idToken;
      }
      const id = await (o.gis ?? loadGis)();
      return new Promise((resolve) => {
        id.initialize({ client_id: o.clientId as string, callback: (r) => resolve(r.credential ?? null), use_fedcm_for_prompt: true, auto_select: false });
        id.prompt((n) => {
          if (n.isNotDisplayed?.() || n.isSkippedMoment?.() || n.isDismissedMoment?.()) resolve(null);
        });
      });
    },
  };
}

export function createPasskeyIdentityProvider(o: { enabled: boolean; challenge?: () => Promise<PublicKeyCredentialRequestOptions> }): IdentityProvider {
  return {
    id: 'passkey',
    available: () => o.enabled && typeof window !== 'undefined' && typeof window.PublicKeyCredential === 'function' && Boolean(o.challenge),
    async obtainCredential() {
      if (!o.enabled || !o.challenge) return null;
      const cred = (await navigator.credentials.get({ publicKey: await o.challenge() }).catch(() => null)) as PublicKeyCredential | null;
      if (!cred) return null;
      const r = cred.response as AuthenticatorAssertionResponse;
      const b64 = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      return JSON.stringify({ id: cred.id, clientDataJSON: b64(r.clientDataJSON), authenticatorData: b64(r.authenticatorData), signature: b64(r.signature), userHandle: r.userHandle ? b64(r.userHandle) : null });
    },
  };
}

export function createMockIdentityProvider(id: 'google' | 'passkey', credential: string | null): IdentityProvider {
  return { id, available: () => true, obtainCredential: async () => credential };
}
