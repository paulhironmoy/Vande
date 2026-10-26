/**
 * Account safety on this device: signing other devices out, signing this device out (plainly only when the account
 * can be recovered), and recovering an account on a new device from the start screen with every way it can go wrong.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import type { IdentityProvider, Profile, SessionTokens } from '@/contracts';
import { useApp } from '@/app/store';
import { useRouter } from '@/app/router';
import { ApiClientError } from '@/net/errors';
import { KITS } from '@/ui/avatar/traits';
import { recoverAccount, recoveryMethods } from '@/screens/onboarding/recover';
import { loadI18n, renderUi } from './helpers';

const services: { current: unknown } = { current: null };
vi.mock('@/app/services', () => ({ useServices: () => services.current, getServices: async () => services.current }));

import StartRoute from '@/screens/onboarding/StartRoute';
import SettingsRoute from '@/screens/settings/SettingsRoute';

const TOKENS: SessionTokens = { playerId: 'p_back', accessToken: 'at', refreshToken: 'rt', expiresAt: new Date(Date.now() + 3600_000).toISOString() };
const profile = (linked: Profile['linked']): Profile => ({
  playerId: 'p_back',
  alias: 'Swing King',
  avatar: { seed: 'swing-king-7' },
  kit: KITS[2],
  locale: 'en',
  city: null,
  groups: [],
  badges: [],
  unlocks: [],
  rating: 1200,
  createdDay: '2026-09-01',
  adultConfirmed: false,
  linked,
});
const localPlayer = { id: 'p_me', alias: 'Night Owl', avatar: { seed: 'night-owl-3' }, kit: KITS[1] };

type Handler = (args?: { body?: unknown }) => unknown;
function fakeNet(routes: Record<string, Handler>) {
  const call = vi.fn(async (route: string, args?: { body?: unknown }) => {
    const h = routes[route];
    if (!h) throw new Error(`unexpected ${route}`);
    return h(args);
  });
  return {
    api: { call },
    session: { ensure: vi.fn().mockResolvedValue(TOKENS), adopt: vi.fn().mockResolvedValue(undefined), clear: vi.fn().mockResolvedValue(undefined) },
    signOut: vi.fn().mockResolvedValue(undefined),
    revokeOthers: vi.fn().mockResolvedValue(2),
    batting: {},
    outbox: {},
  };
}
const provider = (id: 'google' | 'passkey', obtain: () => Promise<string | null>, available = true): IdentityProvider => ({ id, available: () => available, obtainCredential: vi.fn(obtain) });
function fakeServices(net: ReturnType<typeof fakeNet> | null, identity?: { google: IdentityProvider; passkey: IdentityProvider }) {
  const analytics = { track: vi.fn(), setConsent: vi.fn(), consent: () => 'unset', active: () => false, flush: async () => undefined };
  return { net, analytics, platform: { identity: identity ?? { google: provider('google', async () => null, false), passkey: provider('passkey', async () => null, false) }, push: { available: () => false, register: vi.fn(), onMessage: () => () => undefined } } };
}
const offline = () => new ApiClientError('network', 'offline');

beforeAll(async () => {
  await loadI18n();
});
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  useApp.setState({ player: null, online: true, inPlay: false, toasts: [] });
  useRouter.setState({ route: { name: 'home' }, depth: 0 });
});
afterEach(() => {
  cleanup();
  services.current = null;
});

describe('recovering an account', () => {
  it('offers only the sign-in methods this build has', () => {
    const off = provider('google', async () => null, false);
    expect(recoveryMethods(null)).toEqual([]);
    expect(recoveryMethods({ identity: { google: off, passkey: provider('passkey', async () => null, false) } })).toEqual([]);
    expect(recoveryMethods({ identity: { google: provider('google', async () => 'id'), passkey: provider('passkey', async () => null, false) } })).toEqual(['google']);
    expect(recoveryMethods({ identity: { google: provider('google', async () => 'id'), passkey: provider('passkey', async () => 'cred') } })).toEqual(['google', 'passkey']);
  });

  it('adopts the recovered session and loads the player from the profile', async () => {
    const net = fakeNet({ 'POST /v1/auth/google': () => TOKENS, 'GET /v1/me': () => profile({ google: true, passkey: false }) });
    const r = await recoverAccount(net as never, provider('google', async () => 'google-id-token'));
    expect(net.api.call).toHaveBeenCalledWith('POST /v1/auth/google', { body: { idToken: 'google-id-token' } });
    expect(net.session.adopt).toHaveBeenCalledWith(TOKENS);
    expect(r).toMatchObject({ ok: true, player: { id: 'p_back', alias: 'Swing King', avatar: { seed: 'swing-king-7' }, kit: KITS[2] } });
  });

  it('passkeys send their assertion to the passkey route', async () => {
    const net = fakeNet({ 'POST /v1/auth/passkey': () => TOKENS, 'GET /v1/me': () => profile({ google: false, passkey: true }) });
    const r = await recoverAccount(net as never, provider('passkey', async () => '{"id":"cred"}'));
    expect(net.api.call).toHaveBeenCalledWith('POST /v1/auth/passkey', { body: { credential: '{"id":"cred"}' } });
    expect(r.ok).toBe(true);
  });

  it('cancelled, failed, offline and no account: nothing is adopted', async () => {
    const cases: Array<[IdentityProvider, Handler | null, string]> = [
      [provider('google', async () => null), null, 'cancelled'],
      [
        provider('google', async () => {
          throw new Error('Google Identity Services unavailable');
        }),
        null,
        'failed',
      ],
      [
        provider('google', async () => 'bad-token'),
        () => {
          throw new ApiClientError('unauthorized', 'not verified', 401);
        },
        'failed',
      ],
      [
        provider('google', async () => 'id'),
        () => {
          throw offline();
        },
        'offline',
      ],
      [
        provider('google', async () => 'id'),
        () => {
          throw new ApiClientError('not_found', 'no player is linked to this sign-in', 404);
        },
        'no_account',
      ],
    ];
    for (const [p, handler, reason] of cases) {
      const net = fakeNet(handler ? { 'POST /v1/auth/google': handler } : {});
      expect(await recoverAccount(net as never, p)).toEqual({ ok: false, reason });
      expect(net.session.adopt).not.toHaveBeenCalled();
      if (!handler) expect(net.api.call).not.toHaveBeenCalled();
    }
  });

  it('drops the adopted session again when the profile cannot be loaded', async () => {
    const net = fakeNet({
      'POST /v1/auth/google': () => TOKENS,
      'GET /v1/me': () => {
        throw offline();
      },
    });
    net.signOut.mockRejectedValueOnce(offline());
    expect(await recoverAccount(net as never, provider('google', async () => 'id'))).toEqual({ ok: false, reason: 'offline' });
    expect(net.signOut).toHaveBeenCalled();
    expect(net.session.clear).toHaveBeenCalledWith('signed_out');
  });
});

describe('start screen: "Already played? Recover your account"', () => {
  it('is hidden when neither Google nor passkeys are configured, and in offline-only builds', () => {
    services.current = fakeServices(fakeNet({}));
    const { unmount } = renderUi(<StartRoute route={{ name: 'onboarding' }} />);
    expect(screen.queryByTestId('onboarding-recover')).toBeNull();
    unmount();
    services.current = fakeServices(null, { google: provider('google', async () => 'id'), passkey: provider('passkey', async () => null, false) });
    renderUi(<StartRoute route={{ name: 'onboarding' }} />);
    expect(screen.queryByTestId('onboarding-recover')).toBeNull();
  });

  it('recovers with Google, then goes home with the account player', async () => {
    const net = fakeNet({ 'POST /v1/auth/google': () => TOKENS, 'GET /v1/me': () => profile({ google: true, passkey: false }) });
    const google = provider('google', async () => 'google-id-token');
    services.current = fakeServices(net, { google, passkey: provider('passkey', async () => null, false) });
    renderUi(<StartRoute route={{ name: 'onboarding' }} />);
    fireEvent.click(screen.getByTestId('onboarding-recover'));
    expect(screen.queryByTestId('recover-passkey')).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByTestId('recover-google'));
    });
    await waitFor(() => expect(useRouter.getState().route).toEqual({ name: 'home' }));
    expect(useApp.getState().player).toEqual({ id: 'p_back', alias: 'Swing King', avatar: { seed: 'swing-king-7' }, kit: KITS[2] });
    expect(net.session.adopt).toHaveBeenCalledWith(TOKENS);
    expect(net.session.ensure).not.toHaveBeenCalled();
    expect(useApp.getState().toasts.map((x) => x.text)).toContain('Welcome back, Swing King.');
  });

  it('offline: says a connection is needed without opening any sign-in', async () => {
    const google = provider('google', async () => 'id');
    services.current = fakeServices(fakeNet({}), { google, passkey: provider('passkey', async () => null, false) });
    useApp.setState({ online: false });
    renderUi(<StartRoute route={{ name: 'onboarding' }} />);
    fireEvent.click(screen.getByTestId('onboarding-recover'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('recover-google'));
    });
    const result = await screen.findByTestId('recover-result');
    expect(result.getAttribute('data-reason')).toBe('offline');
    expect(result.textContent).toContain('You are offline. Recovering an account needs a connection.');
    expect(google.obtainCredential).not.toHaveBeenCalled();
    expect(useApp.getState().player).toBeNull();
  });

  it('no linked player and a cancelled sign-in keep the start screen as it was', async () => {
    const net = fakeNet({
      'POST /v1/auth/google': () => {
        throw new ApiClientError('not_found', 'no player is linked to this sign-in', 404);
      },
    });
    let credential: string | null = 'id';
    services.current = fakeServices(net, { google: provider('google', async () => credential), passkey: provider('passkey', async () => null, false) });
    renderUi(<StartRoute route={{ name: 'onboarding' }} />);
    fireEvent.click(screen.getByTestId('onboarding-recover'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('recover-google'));
    });
    let result = await screen.findByTestId('recover-result');
    expect(result.getAttribute('data-reason')).toBe('no_account');
    expect(result.getAttribute('role')).toBe('alert');
    credential = null;
    await act(async () => {
      fireEvent.click(screen.getByTestId('recover-google'));
    });
    result = await screen.findByTestId('recover-result');
    await waitFor(() => expect(result.getAttribute('data-reason')).toBe('cancelled'));
    expect(result.getAttribute('role')).toBe('status');
    expect(useApp.getState().player).toBeNull();
    expect(useRouter.getState().route).toEqual({ name: 'home' });
    expect(net.session.adopt).not.toHaveBeenCalled();
  });
});

describe('settings: sign-in and devices', () => {
  it('signs every other device out and says how many', async () => {
    useApp.setState({ player: localPlayer });
    const net = fakeNet({ 'GET /v1/push/settings': () => ({ enabled: false, quietHours: null }), 'GET /v1/me': () => profile({ google: true, passkey: false }) });
    services.current = fakeServices(net);
    renderUi(<SettingsRoute route={{ name: 'settings' }} />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('settings-revoke-others'));
    });
    expect((await screen.findByTestId('settings-revoked')).textContent).toContain('Signed out 2 other devices.');
    net.revokeOthers.mockResolvedValueOnce(0);
    await act(async () => {
      fireEvent.click(screen.getByTestId('settings-revoke-others'));
    });
    await waitFor(() => expect(screen.getByTestId('settings-revoked').textContent).toContain('No other devices were signed in.'));
    expect(useApp.getState().player).toEqual(localPlayer);
  });

  it('a linked account signs this device out plainly: server first, then this device forgets the player', async () => {
    useApp.setState({ player: localPlayer });
    localStorage.setItem('vc:invites', '[]');
    const net = fakeNet({ 'GET /v1/push/settings': () => ({ enabled: false, quietHours: null }), 'GET /v1/me': () => profile({ google: true, passkey: false }) });
    services.current = fakeServices(net);
    renderUi(<SettingsRoute route={{ name: 'settings' }} />);
    fireEvent.click(await screen.findByTestId('settings-logout'));
    const dialog = await screen.findByTestId('settings-logout-dialog');
    expect(dialog.textContent).toContain('Sign back in here any time with Google.');
    await act(async () => {
      fireEvent.click(screen.getByTestId('settings-logout-dialog-confirm'));
    });
    await waitFor(() => expect(useRouter.getState().route).toEqual({ name: 'onboarding' }));
    expect(net.signOut).toHaveBeenCalledTimes(1);
    expect(useApp.getState().player).toBeNull();
    expect(localStorage.getItem('vc:invites')).toBeNull();
    expect(useApp.getState().toasts.map((x) => x.text)).toContain('You are signed out of this device.');
  });

  it('offline: signing out keeps everything and says why', async () => {
    useApp.setState({ player: localPlayer });
    const net = fakeNet({ 'GET /v1/push/settings': () => ({ enabled: false, quietHours: null }), 'GET /v1/me': () => profile({ google: false, passkey: true }) });
    net.signOut.mockRejectedValueOnce(offline());
    services.current = fakeServices(net);
    renderUi(<SettingsRoute route={{ name: 'settings' }} />);
    fireEvent.click(await screen.findByTestId('settings-logout'));
    expect((await screen.findByTestId('settings-logout-dialog')).textContent).toContain('your passkey');
    await act(async () => {
      fireEvent.click(screen.getByTestId('settings-logout-dialog-confirm'));
    });
    await waitFor(() => expect(useApp.getState().toasts.map((x) => x.text)).toContain('You are offline. Try again when you reconnect.'));
    expect(useApp.getState().player).toEqual(localPlayer);
    expect(useRouter.getState().route).toEqual({ name: 'home' });
  });

  it('a guest account is not offered a plain sign-out: it explains the loss and points to linking or deleting', async () => {
    useApp.setState({ player: localPlayer });
    const net = fakeNet({ 'GET /v1/push/settings': () => ({ enabled: false, quietHours: null }), 'GET /v1/me': () => profile({ google: false, passkey: false }) });
    services.current = fakeServices(net);
    renderUi(<SettingsRoute route={{ name: 'settings' }} />);
    const guest = await screen.findByTestId('settings-logout-guest');
    expect(screen.queryByTestId('settings-logout')).toBeNull();
    expect(guest.textContent).toContain('cannot be recovered after signing out');
    expect(guest.textContent).toContain('Delete my account');
    fireEvent.click(screen.getByTestId('settings-link-profile'));
    expect(useRouter.getState().route).toEqual({ name: 'profile' });
    expect(net.signOut).not.toHaveBeenCalled();
  });

  it('is not shown before the account exists', () => {
    useApp.setState({ player: { ...localPlayer, id: null } });
    services.current = fakeServices(fakeNet({}));
    renderUi(<SettingsRoute route={{ name: 'settings' }} />);
    expect(screen.queryByTestId('settings-revoke-others')).toBeNull();
    expect(screen.queryByTestId('settings-logout')).toBeNull();
  });
});
