import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useApp } from '@/app/store';
import { useRouter } from '@/app/router';
import { ApiClientError } from '@/net/errors';
import { ensureAccount, socialFailure, useAccount, useAction, usePlayerGate, useResource } from '@/social/hooks';
import { createSocialT, loadSocialCatalog, useSocialT } from '@/social/i18n';
import { socialEn } from '@/i18n/social/en';

const player = { id: null, alias: 'Swift Tiger', avatar: { seed: 'abc12345' }, kit: { id: 'starter' as const, primary: '#1E2A78', secondary: '#00B8D9', pattern: 'chevron' as const } };

function fakeNet(over: Record<string, unknown> = {}) {
  return {
    session: { ensure: vi.fn(async () => ({ playerId: 'pnew', accessToken: 'a', refreshToken: 'r', expiresAt: '' })) },
    api: { call: vi.fn(async () => ({})) },
    ...over,
  } as never;
}

beforeEach(() => {
  useApp.setState({ player: null, online: true, settings: { ...useApp.getState().settings, locale: 'en' } });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('socialFailure', () => {
  it('maps client errors to honest states', () => {
    expect(socialFailure(new ApiClientError('network', 'x'))).toBe('offline');
    expect(socialFailure(new ApiClientError('not_found', 'x', 404))).toBe('not_found');
    expect(socialFailure(new ApiClientError('sealed', 'x', 409))).toBe('sealed');
    expect(socialFailure(new ApiClientError('deadline_passed', 'x', 410))).toBe('expired');
    expect(socialFailure(new ApiClientError('unauthorized', 'x', 401))).toBe('signed_out');
    expect(socialFailure(new Error('boom'))).toBe('error');
  });
});

describe('useResource', () => {
  it('loads, keeps the last good data on a failed reload, and retries when back online', async () => {
    let n = 0;
    const fn = vi.fn(async () => {
      n++;
      if (n === 2) throw new ApiClientError('network', 'down');
      return n;
    });
    const { result } = renderHook(() => useResource(fn, []));
    await waitFor(() => expect(result.current.data).toBe(1));
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.data).toBe(1);
    act(() => useApp.setState({ online: false }));
    act(() => useApp.setState({ online: true }));
    await waitFor(() => expect(result.current.data).toBe(3));
    expect(result.current.error).toBeNull();
  });

  it('does nothing while it has no function (no account yet)', async () => {
    const { result } = renderHook(() => useResource<number>(null, []));
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBeNull();
  });
});

describe('useAction', () => {
  it('reports failures as states instead of throwing', async () => {
    const { result } = renderHook(() => useAction());
    let r: Awaited<ReturnType<typeof result.current.run>> | undefined;
    await act(async () => {
      r = await result.current.run(async () => {
        throw new ApiClientError('rate_limited', 'slow', 429);
      });
    });
    expect(r).toMatchObject({ ok: false, failure: 'rate_limited' });
    expect(result.current.busy).toBe(false);
  });
});

describe('the account behind the local player', () => {
  it('creates it with the player’s own alias, then fills the profile and stores the id', async () => {
    useApp.getState().setPlayer(player);
    const net = fakeNet();
    const { result } = renderHook(() => useAccount(net, useApp.getState().player));
    await waitFor(() => expect(result.current.state).toBe('ok'));
    expect((net as unknown as { session: { ensure: ReturnType<typeof vi.fn> } }).session.ensure).toHaveBeenCalledWith('Swift Tiger');
    expect((net as unknown as { api: { call: ReturnType<typeof vi.fn> } }).api.call).toHaveBeenCalledWith('PATCH /v1/me', { body: { avatar: player.avatar, kit: player.kit, locale: 'en' } });
    expect(useApp.getState().player?.id).toBe('pnew');
  });

  it('says so when the alias is refused or the network is down', async () => {
    const refused = fakeNet({ session: { ensure: vi.fn(async () => Promise.reject(new ApiClientError('invalid', 'alias', 400))) } });
    expect(await ensureAccount(refused, player, 'en')).toEqual({ error: 'alias_rejected' });
    const down = fakeNet({ session: { ensure: vi.fn(async () => Promise.reject(new ApiClientError('network', 'x'))) } });
    expect(await ensureAccount(down, player, 'en')).toEqual({ error: 'offline' });
  });

  it('sends first-time visitors to onboarding and back afterwards', () => {
    const navigate = vi.fn();
    useRouter.setState({ navigate } as never);
    renderHook(() => usePlayerGate({ name: 'cup', cupId: 'c123' }));
    expect(navigate).toHaveBeenCalledWith({ name: 'onboarding' }, { replace: true });
    expect(JSON.parse(sessionStorage.getItem('vc:after-start') ?? 'null')).toEqual({ name: 'cup', cupId: 'c123' });
  });
});

describe('useSocialT', () => {
  it('formats English plurals, falls back to English and follows the store language', async () => {
    const en = createSocialT('en', null);
    expect(en.t('social.cup.members', { count: 1 })).toBe('1 player');
    expect(en.t('social.cup.members', { count: 4 })).toBe('4 players');
    expect(en.city('bengaluru')).toBe('Bengaluru');
    expect(en.tk('social.badge.unknown_badge', undefined, 'mystery')).toBe('mystery');
    await loadSocialCatalog('hi');
    const { result } = renderHook(() => useSocialT());
    expect(result.current.t('social.board.title')).toBe(socialEn['social.board.title']);
    act(() => useApp.getState().updateSettings({ locale: 'hi' }));
    await waitFor(() => expect(result.current.t('social.board.title')).toBe('लीडरबोर्ड'));
    expect(result.current.city('bengaluru')).toBe('बेंगलुरु');
    // A drafted locale shows English for what it does not cover yet, never a raw key.
    act(() => useApp.getState().updateSettings({ locale: 'ta' }));
    await waitFor(() => expect(result.current.t('social.board.title')).toBe('லீடர்போர்டுகள்'));
    expect(result.current.t('social.cup.rules_auto')).toBe(socialEn['social.cup.rules_auto']);
  });
});
