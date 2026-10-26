/**
 * Android boot: Capacitor plugin proxies answer every property, `then` included, so a promise resolved with one never
 * settles (logcat: `"VandeSecureStorage.then()" is not implemented on android`). These mocks behave like Capacitor 8's
 * registerPlugin proxy, and createPlatform must resolve with the native plugins usable, and fall back when they fail.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

type Impl = Record<string, (...args: never[]) => unknown>;

const h = vi.hoisted(() => {
  const thenCalls: string[] = [];
  const impls: Record<string, Impl> = {};
  /** Like @capacitor/core 8.5 registerPlugin: every property except $$typeof and toJSON is a native method wrapper. */
  function capacitorProxy(name: string): object {
    return new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === '$$typeof') return undefined;
          if (prop === 'toJSON') return () => ({});
          return (...args: never[]) => {
            if (prop === 'then') thenCalls.push(name);
            // The wrapper returns its own promise and never calls a `then` caller's resolve or reject.
            return Promise.resolve().then(() => {
              const fn = impls[name]?.[String(prop)];
              if (!fn) throw new Error(`"${name}.${String(prop)}()" is not implemented on android`);
              return fn(...args);
            });
          };
        },
      },
    );
  }
  return { thenCalls, impls, capacitorProxy };
});

vi.mock('@capacitor/core', () => ({ registerPlugin: (name: string) => h.capacitorProxy(name) }));
vi.mock('@capacitor/app', () => ({ App: h.capacitorProxy('App') }));
vi.mock('@capacitor/push-notifications', () => ({ PushNotifications: h.capacitorProxy('PushNotifications') }));

const TOKEN = `${'A'.repeat(51)}.${'b'.repeat(22)}`;
const never = () => new Promise<never>(() => undefined);

function android(): void {
  (globalThis as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android', isPluginAvailable: () => true };
}

/** Fails fast instead of hanging the suite when boot never settles. */
function settles<T>(p: Promise<T>, ms = 2_000): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('createPlatform never settled')), ms))]);
}

function keystore(): Map<string, string> {
  const backing = new Map<string, string>();
  h.impls.VandeSecureStorage = {
    get: (async ({ key }: { key: string }) => ({ value: backing.get(key) ?? null })) as never,
    set: (async ({ key, value }: { key: string; value: string }) => void backing.set(key, value)) as never,
    remove: (async ({ key }: { key: string }) => void backing.delete(key)) as never,
  };
  return backing;
}

afterEach(() => {
  delete (globalThis as { Capacitor?: unknown }).Capacitor;
  for (const k of Object.keys(h.impls)) delete h.impls[k];
  h.thenCalls.length = 0;
});

describe('Android boot never waits on a plugin proxy', () => {
  it('resolves with the Keystore store, the install referrer, Google sign-in and push all usable', async () => {
    android();
    const backing = keystore();
    h.impls.VandeInstallReferrer = { getReferrer: (async () => ({ referrer: `vc_invite=${TOKEN}&vc_a=abcd1234` })) as never };
    h.impls.VandeGoogleSignIn = { signIn: (async () => ({ idToken: 'id-token-native' })) as never };
    h.impls.App = { getLaunchUrl: (async () => ({ url: '' })) as never, addListener: (async () => ({ remove: async () => undefined })) as never };
    const listeners = new Map<string, (p: unknown) => void>();
    h.impls.PushNotifications = {
      createChannel: (async () => undefined) as never,
      requestPermissions: (async () => ({ receive: 'granted' })) as never,
      addListener: (async (event: string, cb: (p: unknown) => void) => {
        listeners.set(event, cb);
        return { remove: async () => undefined };
      }) as never,
      register: (async () => void setTimeout(() => listeners.get('registration')?.({ value: 'fcm-native' }), 0)) as never,
    };
    const { createPlatform } = await import('@/platform');
    const platform = await settles(createPlatform({ VITE_PUSH_ENABLED: '1', VITE_GOOGLE_CLIENT_ID: 'cid' }));
    // The native Keystore store, not a fallback.
    await platform.secureStore.set('vc.session.v1', 'session-1');
    expect(backing.get('vc.session.v1')).toBe('session-1');
    expect(await platform.secureStore.get('vc.session.v1')).toBe('session-1');
    // The invite survives the install, and the attributed install is heard once, even by a listener added later.
    expect(await settles(platform.deepLinks.initial())).toBe(`vandecricket://i/${TOKEN}?a=abcd1234`);
    const installs: string[] = [];
    platform.onAttributedInstall((code) => installs.push(code));
    expect(installs).toEqual(['abcd1234']);
    expect(await settles(platform.identity.google.obtainCredential())).toBe('id-token-native');
    expect(await settles(platform.push.register())).toEqual({ token: 'fcm-native', platform: 'android' });
    expect(platform.push.available()).toBe(true);
    // Nothing ever resolved a promise with a proxy.
    expect(h.thenCalls).toEqual([]);
  });

  it('falls back to the encrypted IndexedDB store when the secure-store plugin rejects', async () => {
    android();
    const broken = async () => {
      throw new Error('secure storage unavailable');
    };
    h.impls.VandeSecureStorage = { get: broken as never, set: broken as never, remove: broken as never };
    h.impls.VandeInstallReferrer = { getReferrer: (async () => ({ referrer: null })) as never };
    h.impls.App = { getLaunchUrl: (async () => undefined) as never };
    const { createPlatform } = await import('@/platform');
    const platform = await settles(createPlatform({}));
    await platform.secureStore.set('vc.session.v1', 'session-2');
    expect(await platform.secureStore.get('vc.session.v1')).toBe('session-2');
    expect(await settles(platform.deepLinks.initial())).toBeNull();
    expect(h.thenCalls).toEqual([]);
  });

  it('starts within the timeout when the native side never answers', async () => {
    android();
    h.impls.VandeSecureStorage = { get: never as never, set: never as never, remove: never as never };
    h.impls.VandeInstallReferrer = { getReferrer: never as never };
    h.impls.App = { getLaunchUrl: never as never };
    const { createPlatform } = await import('@/platform');
    const started = Date.now();
    const platform = await settles(createPlatform({}, { nativeTimeoutMs: 50 }));
    expect(Date.now() - started).toBeLessThan(1_000);
    await platform.secureStore.set('vc.session.v1', 'session-3');
    expect(await platform.secureStore.get('vc.session.v1')).toBe('session-3');
    expect(await settles(platform.deepLinks.initial())).toBeNull();
    expect(h.thenCalls).toEqual([]);
  });

  it('a plugin that is not installed natively is simply absent', async () => {
    (globalThis as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android', isPluginAvailable: () => false };
    const { nativePlugin } = await import('@/platform/capacitor');
    expect(await nativePlugin('VandeSecureStorage')).toBeNull();
    const { createPlatform } = await import('@/platform');
    const platform = await settles(createPlatform({ VITE_GOOGLE_CLIENT_ID: 'cid' }));
    await platform.secureStore.set('k', 'v');
    expect(await platform.secureStore.get('k')).toBe('v');
    expect(await platform.identity.google.obtainCredential()).toBeNull();
  });
});
