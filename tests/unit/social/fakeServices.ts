/** Fake services for social screen tests: an API that answers by route key, a share adapter and an analytics spy. */
import { vi } from 'vitest';
import { ApiClientError } from '@/net/errors';

export type Handler = (args: { params?: Record<string, string>; body?: unknown; query?: Record<string, string | undefined> }) => unknown;

export function fakeServices(routes: Record<string, Handler>) {
  const calls: Array<{ route: string; args: Parameters<Handler>[0] }> = [];
  const call = vi.fn(async (route: string, args: Parameters<Handler>[0] = {}) => {
    calls.push({ route, args });
    const h = routes[route];
    if (!h) throw new ApiClientError('not_found', `no fake for ${route}`, 404);
    return h(args);
  });
  const report = vi.fn(async () => true);
  const track = vi.fn();
  const share = vi.fn(async () => 'shared' as const);
  const services = {
    platform: {
      share: { share, whatsappUrl: (t: string, u: string) => `https://wa.me/?text=${encodeURIComponent(`${t} ${u}`)}` },
      webOrigins: ['https://vande.example'],
      identity: { google: { id: 'google', available: () => false, obtainCredential: async () => null }, passkey: { id: 'passkey', available: () => false, obtainCredential: async () => null } },
    },
    net: {
      api: { call, baseUrl: 'http://127.0.0.1:8787' },
      session: { ensure: vi.fn(async () => ({ playerId: 'pme', accessToken: 'a', refreshToken: 'r', expiresAt: '' })) },
      attribution: { report, flushInstall: vi.fn(async () => false) },
    },
    analytics: { track },
  };
  return { services, calls, call, report, track, share };
}

export const ME = { id: 'pme', alias: 'Swift Tiger', avatar: { seed: 'abc12345' }, kit: { id: 'starter' as const, primary: '#1E2A78', secondary: '#00B8D9', pattern: 'chevron' as const } };

export function ref(id: string, alias: string) {
  return { id, alias, avatar: { seed: `${id}seed1` }, kit: { id: 'starter' as const, primary: '#111111', secondary: '#222222', pattern: 'plain' as const }, kind: 'human' as const };
}
