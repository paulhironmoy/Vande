import { describe, expect, it } from 'vitest';
import { createIdbSecureStore, createMemorySecureStore, createNativeSecureStore } from '@/platform/secureStore';
import { createDisabledPushAdapter, createFcmPushAdapter, createMockPushAdapter, type PushNotificationsPlugin } from '@/platform/push';
import { createGoogleIdentityProvider, createMockIdentityProvider, createPasskeyIdentityProvider } from '@/platform/identity';
import { createDisabledAds, createDisabledBilling, createMockAds, createMockBilling, guardAds } from '@/platform/monetization';

describe('secure storage', () => {
  it('encrypts values at rest in IndexedDB with a non-extractable key', async () => {
    const name = `vande-secure-test-${crypto.randomUUID()}`;
    const store = createIdbSecureStore(name);
    await store.set('vc.session.v1', '{"refreshToken":"rt1.secret-value"}');
    expect(await store.get('vc.session.v1')).toBe('{"refreshToken":"rt1.secret-value"}');
    const { openDB } = await import('idb');
    const db = await openDB(name, 1);
    const raw = await db.get('items', 'vc.session.v1');
    const key = (await db.get('keys', 'main')) as CryptoKey;
    db.close();
    expect(new TextDecoder().decode(raw.ct)).not.toContain('secret-value');
    expect(key.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('raw', key)).rejects.toThrow();
    await store.remove('vc.session.v1');
    expect(await store.get('vc.session.v1')).toBeNull();
  });

  it('wraps a native Keystore plugin and keeps a memory store for tests', async () => {
    const backing = new Map<string, string>();
    const native = createNativeSecureStore({
      get: async ({ key }) => ({ value: backing.get(key) ?? null }),
      set: async ({ key, value }) => void backing.set(key, value),
      remove: async ({ key }) => void backing.delete(key),
    });
    await native.set('a', '1');
    expect(await native.get('a')).toBe('1');
    const mem = createMemorySecureStore();
    await mem.set('b', '2');
    expect(mem.dump()).toEqual({ b: '2' });
  });
});

describe('push', () => {
  function fakePlugin(perm: 'granted' | 'denied', token = 'fcm-token-xyz'): PushNotificationsPlugin & { emit(event: string, payload: unknown): void } {
    const listeners = new Map<string, Array<(p: unknown) => void>>();
    return {
      requestPermissions: async () => ({ receive: perm }),
      register: async () => {
        setTimeout(() => listeners.get('registration')?.forEach((l) => l({ value: token })), 0);
      },
      addListener: (async (event: string, cb: (p: unknown) => void) => {
        listeners.set(event, [...(listeners.get(event) ?? []), cb]);
        return {
          remove: async () => {
            listeners.set(event, (listeners.get(event) ?? []).filter((x) => x !== cb));
          },
        };
      }) as unknown as PushNotificationsPlugin['addListener'],
      emit: (event, payload) => listeners.get(event)?.forEach((l) => l(payload)),
    };
  }

  it('is off unless enabled, and registers through FCM after permission', async () => {
    expect(createDisabledPushAdapter().available()).toBe(false);
    const off = createFcmPushAdapter({ enabled: false, plugin: async () => ({ plugin: fakePlugin('granted') }) });
    expect(await off.register()).toBeNull();
    const plugin = fakePlugin('granted');
    const on = createFcmPushAdapter({ enabled: true, plugin: async () => ({ plugin }) });
    expect(await on.register()).toEqual({ token: 'fcm-token-xyz', platform: 'android' });
    expect(await createFcmPushAdapter({ enabled: true, plugin: async () => ({ plugin: fakePlugin('denied') }) }).register()).toBeNull();
    const got: Array<{ kind: string }> = [];
    on.onMessage((m) => got.push(m));
    await new Promise((r) => setTimeout(r, 0));
    plugin.emit('pushNotificationReceived', { data: { kind: 'reveal_ready', matchId: 'm1' } });
    plugin.emit('pushNotificationActionPerformed', { notification: { data: { kind: 'opponent_locked', matchId: 'm1' } } });
    plugin.emit('pushNotificationReceived', { data: { kind: 'unknown_kind' } });
    expect(got.map((m) => m.kind)).toEqual(['reveal_ready', 'opponent_locked']);
  });

  it('has a mock for development', async () => {
    const mock = createMockPushAdapter();
    expect((await mock.register())?.token).toMatch(/^mock-fcm-token/);
    const seen: string[] = [];
    mock.onMessage((m) => seen.push(m.kind));
    mock.emit({ kind: 'reveal_ready', data: {} });
    expect(seen).toEqual(['reveal_ready']);
  });
});

describe('identity providers', () => {
  it('Google is unavailable without a client id; passkeys are off by default', async () => {
    expect(createGoogleIdentityProvider({ clientId: null }).available()).toBe(false);
    expect(await createGoogleIdentityProvider({ clientId: null }).obtainCredential()).toBeNull();
    expect(createPasskeyIdentityProvider({ enabled: false }).available()).toBe(false);
  });

  it('Google on the web uses Identity Services; natively the Credential Manager plugin', async () => {
    const web = createGoogleIdentityProvider({
      clientId: 'cid',
      native: () => false,
      gis: async () => ({ initialize: (c) => setTimeout(() => c.callback({ credential: 'id-token-web' }), 0), prompt: () => undefined }),
    });
    expect(await web.obtainCredential()).toBe('id-token-web');
    const app = createGoogleIdentityProvider({ clientId: 'cid', native: () => true, nativePlugin: async () => ({ plugin: { signIn: async () => ({ idToken: 'id-token-app' }) } }) });
    expect(await app.obtainCredential()).toBe('id-token-app');
    expect(await createMockIdentityProvider('passkey', 'mock-passkey:abc12345').obtainCredential()).toBe('mock-passkey:abc12345');
  });
});

describe('ads and billing', () => {
  it('are disabled by default', async () => {
    expect(createDisabledAds().enabled()).toBe(false);
    expect(await createDisabledAds().showRewarded('cosmetic_unlock')).toBe('unavailable');
    expect(createDisabledBilling().enabled()).toBe(false);
    expect(await createDisabledBilling().products()).toEqual([]);
    expect(await createDisabledBilling().purchase('kit-1')).toBe('unavailable');
  });

  it('never show an ad during an innings, and only sell cosmetics', async () => {
    let batting = true;
    const ads = guardAds(createMockAds(), () => batting);
    expect(ads.enabled()).toBe(false);
    expect(await ads.showRewarded('replay_theme')).toBe('unavailable');
    batting = false;
    expect(await ads.showRewarded('replay_theme')).toBe('rewarded');
    const billing = createMockBilling([
      { id: 'kit-gold', kind: 'kit', price: '₹49' },
      { id: 'power-bat', kind: 'stronger_batsman' as never, price: '₹99' },
    ]);
    expect((await billing.products()).map((p) => p.id)).toEqual(['kit-gold']);
    expect(await billing.purchase('power-bat')).toBe('unavailable');
    expect(await billing.purchase('kit-gold')).toBe('purchased');
  });

  it('the platform always wraps its ads provider: never an ad while a ball or a plan is in play', async () => {
    const { createPlatform } = await import('@/platform');
    const { useApp } = await import('@/app/store');
    const provider = createMockAds();
    const platform = await createPlatform({}, { ads: provider });
    // The default guard reads the app's in-play flag.
    useApp.getState().setInPlay(true);
    expect(platform.ads.enabled()).toBe(false);
    expect(await platform.ads.showRewarded('cosmetic_unlock')).toBe('unavailable');
    expect(provider.shown).toEqual([]);
    useApp.getState().setInPlay(false);
    expect(platform.ads.enabled()).toBe(true);
    expect(await platform.ads.showRewarded('cosmetic_unlock')).toBe('rewarded');
    expect(provider.shown).toEqual(['cosmetic_unlock']);
    // The shipped default stays off, guarded or not.
    expect((await createPlatform({})).ads.enabled()).toBe(false);
  });
});
