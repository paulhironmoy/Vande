/**
 * Client platform adapters — ROOT-OWNED interfaces, implemented by the platform workstream in src/platform.
 * Every provider sits behind an adapter with a working mock, so missing credentials never block development.
 * Ads and billing are disabled by default.
 */
export interface SecureStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface ShareAdapter {
  /** Opens the system share sheet (never sends anything by itself). */
  share(input: { title: string; text: string; url: string; image?: Blob }): Promise<'shared' | 'copied' | 'cancelled' | 'failed'>;
  /** WhatsApp-specific deep link (wa.me) opened only on the player's tap. */
  whatsappUrl(text: string, url: string): string;
}

export interface DeepLinkSource {
  /** Resolves pending links: the URL that opened the app, or an Android install-referrer invite. */
  initial(): Promise<string | null>;
  onLink(cb: (url: string) => void): () => void;
}

export interface PushAdapter {
  available(): boolean;
  /** Asks permission (only after a meaningful moment, never on first launch) and returns a device token. */
  register(): Promise<{ token: string; platform: 'android' | 'web' } | null>;
  onMessage(cb: (msg: { kind: string; data: Record<string, string> }) => void): () => void;
}

export interface IdentityProvider {
  id: 'google' | 'passkey';
  available(): boolean;
  /** Returns a credential the server verifies (Google ID token, WebAuthn assertion). */
  obtainCredential(): Promise<string | null>;
}

export interface AdsAdapter {
  enabled(): boolean;
  /** Rewarded only, never during an innings; rewards are cosmetic. */
  showRewarded(placement: 'cosmetic_unlock' | 'replay_theme'): Promise<'rewarded' | 'skipped' | 'unavailable'>;
}

export interface BillingAdapter {
  enabled(): boolean;
  products(): Promise<Array<{ id: string; kind: 'kit' | 'celebration' | 'stadium_theme' | 'replay_theme' | 'season'; price: string }>>;
  purchase(productId: string): Promise<'purchased' | 'cancelled' | 'failed' | 'unavailable'>;
}
