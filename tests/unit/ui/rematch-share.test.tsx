/**
 * Rematch in all three states, the public result link (one spoiler-safe share per match), the shared-match landing
 * for anyone, and the private-match state for someone else's match.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import type { MatchEventLog, MatchView, SharedMatch } from '@/contracts';
import { useApp } from '@/app/store';
import { useRouter } from '@/app/router';
import { ApiClientError } from '@/net/errors';
import { KITS } from '@/ui/avatar/traits';
import { FIXTURE_PLAYERS, fixtureMatchLog } from '@/screens/dev/fixtures';
import { __setShareLedger } from '@/screens/share/share';
import { memoryShareLedger } from '@/platform/shareMoments';
import { createFakeRenderer } from './fakeRenderer';
import { loadI18n, renderUi } from './helpers';

const services: { current: unknown } = { current: null };
vi.mock('@/app/services', () => ({ useServices: () => services.current, getServices: async () => services.current }));
const fake = { current: createFakeRenderer(() => 0) };
vi.mock('@/render3d', async () => {
  const actual = await vi.importActual<typeof import('@/render3d')>('@/render3d');
  return { ...actual, createMatchRenderer: async () => fake.current, webglAvailable: () => true };
});
vi.mock('@/audio', async () => {
  const actual = await vi.importActual<typeof import('@/audio')>('@/audio');
  class Silent {
    cue() {}
    crowd() {}
    dispose() {}
  }
  return { ...actual, MatchAudio: Silent, playSealChime: () => undefined };
});
vi.mock('@/screens/share/cards', async () => {
  const actual = await vi.importActual<typeof import('@/screens/share/cards')>('@/screens/share/cards');
  return { ...actual, cardBlob: async () => null };
});

import MatchRoute from '@/screens/match/MatchRoute';
import SharedRoute from '@/screens/shared/SharedRoute';
import { RevealedView, finalShareText } from '@/screens/match/RevealedView';

const TOKEN = `${'R'.repeat(51)}.${'m'.repeat(22)}`;
const me = { ...FIXTURE_PLAYERS[0], id: 'p_me' };
const them = FIXTURE_PLAYERS[1];
const localPlayer = { id: 'p_me', alias: me.alias, avatar: me.avatar, kit: KITS[0] };

type Handler = (args?: { params?: Record<string, string>; body?: unknown }) => unknown;
function fakeServices(routes: Record<string, Handler>, shareResult: string = 'shared') {
  const call = vi.fn(async (route: string, args?: { params?: Record<string, string>; body?: unknown }) => {
    const h = routes[route];
    if (!h) throw new Error(`unexpected ${route}`);
    return h(args);
  });
  const share = { share: vi.fn().mockResolvedValue(shareResult), whatsappUrl: (text: string, url: string) => `https://wa.me/?text=${encodeURIComponent(`${text}\n${url}`)}` };
  const analytics = { track: vi.fn(), setConsent: vi.fn(), consent: () => 'unset', active: () => false, flush: async () => undefined };
  const net = { api: { call }, session: { ensure: vi.fn() }, batting: {}, outbox: {}, signOut: vi.fn(), revokeOthers: vi.fn() };
  return { call, share, analytics, net, value: { net, analytics, platform: { share, push: { available: () => false, register: vi.fn(), onMessage: () => () => undefined }, identity: { google: { id: 'google', available: () => false, obtainCredential: async () => null }, passkey: { id: 'passkey', available: () => false, obtainCredential: async () => null } } } } };
}

function view(p: Partial<MatchView>): MatchView {
  return {
    matchId: 'm1',
    kind: 'duel',
    phase: 'revealed',
    conditions: { pitch: 'hard', weather: 'clear' },
    me: 0,
    players: [me, them],
    locked: [true, true],
    battingDone: [true, true],
    seedCommit: 'a'.repeat(64),
    roomId: null,
    inviteUrl: null,
    rematch: null,
    myCommit: null,
    opponentCommit: null,
    deadlines: { lockBy: new Date(Date.now() - 3600_000).toISOString(), batBy: new Date(Date.now() - 60_000).toISOString(), revealAt: null },
    myBallsFaced: 6,
    ...p,
  };
}

let log: MatchEventLog;
beforeAll(async () => {
  await loadI18n();
  log = fixtureMatchLog();
});
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  fake.current = createFakeRenderer(() => 0);
  __setShareLedger(memoryShareLedger());
  useApp.setState({ player: localPlayer, online: true, inPlay: false, toasts: [] });
  useRouter.setState({ route: { name: 'home' }, depth: 0 });
});
afterEach(() => {
  cleanup();
  services.current = null;
  __setShareLedger(null);
});

describe('rematch', () => {
  it("the opponent's offer is the reveal's primary action and opens their invitation", async () => {
    const f = fakeServices({
      'GET /v1/matches/:id': () => view({ rematch: { matchId: 'm2', inviteUrl: `https://vande.example/i/${TOKEN}`, fromMe: false } }),
      'GET /v1/matches/:id/reveal': () => log,
    });
    services.current = f.value;
    renderUi(<MatchRoute route={{ name: 'match', matchId: 'm1' }} />);
    const button = await screen.findByTestId('reveal-rematch');
    expect(button.getAttribute('data-state')).toBe('offered');
    expect(button.textContent).toContain(`${them.alias} wants a rematch · Accept`);
    fireEvent.click(button);
    expect(useRouter.getState().route).toEqual({ name: 'invite', token: TOKEN });
    expect(f.call).not.toHaveBeenCalledWith('POST /v1/matches/:id/rematch', expect.anything());
  });

  it('a rematch I asked for says so and opens it to send again', async () => {
    const f = fakeServices({
      'GET /v1/matches/:id': () => view({ rematch: { matchId: 'm2', inviteUrl: `https://vande.example/i/${TOKEN}`, fromMe: true } }),
      'GET /v1/matches/:id/reveal': () => log,
    });
    services.current = f.value;
    renderUi(<MatchRoute route={{ name: 'match', matchId: 'm1' }} />);
    const button = await screen.findByTestId('reveal-rematch');
    expect(button.getAttribute('data-state')).toBe('sent');
    expect(button.textContent).toContain('Rematch sent · send it again');
    fireEvent.click(button);
    expect(useRouter.getState().route).toEqual({ name: 'match', matchId: 'm2' });
  });

  it('no offer yet: Rematch creates one and opens it', async () => {
    const f = fakeServices({
      'GET /v1/matches/:id/reveal': () => log,
      'POST /v1/matches/:id/rematch': () => ({ matchId: 'm3', inviteToken: TOKEN, inviteUrl: `https://vande.example/i/${TOKEN}` }),
    });
    services.current = f.value;
    renderUi(<RevealedView matchId="m1" me={0} net={f.net as never} services={f.value as never} />);
    const button = await screen.findByTestId('reveal-rematch');
    expect(button.getAttribute('data-state')).toBe('idle');
    await act(async () => {
      fireEvent.click(button);
    });
    await waitFor(() => expect(useRouter.getState().route).toEqual({ name: 'match', matchId: 'm3' }));
  });

  it('the hub lists the offer as something to do, and it opens the invitation', async () => {
    const { matchCard } = await import('@/screens/home/homeModel');
    const card = matchCard(view({ rematch: { matchId: 'm2', inviteUrl: `https://vande.example/i/${TOKEN}`, fromMe: false } }), true);
    expect(card).toMatchObject({ status: 'rematch_offer', tone: 'action', rematchUrl: `https://vande.example/i/${TOKEN}` });
    // Not watched yet: the reveal comes first.
    expect(matchCard(view({ rematch: { matchId: 'm2', inviteUrl: `https://vande.example/i/${TOKEN}`, fromMe: false } }), false).status).toBe('reveal_ready');
    expect(matchCard(view({ rematch: { matchId: 'm2', inviteUrl: `https://vande.example/i/${TOKEN}`, fromMe: true } }), true).status).toBe('replay');
  });
});

describe('sharing a result', () => {
  it('shares the public link from the server, with text that says what the card shows', async () => {
    const f = fakeServices({
      'GET /v1/matches/:id/reveal': () => log,
      'POST /v1/matches/:id/share': () => ({ code: 'k7q2m9xa', url: 'https://vande.example/s/k7q2m9xa' }),
    });
    services.current = f.value;
    renderUi(<RevealedView matchId="m1" me={0} net={f.net as never} services={f.value as never} />);
    fireEvent.click(await screen.findByTestId('reveal-share'));
    await waitFor(() => expect(f.share.share).toHaveBeenCalled());
    const msg = f.share.share.mock.calls[0][0] as { text: string; url: string };
    expect(msg.url).toBe('https://vande.example/s/k7q2m9xa');
    expect(msg.text).toBe(finalShareText(createT(), log));
    expect(msg.text).toMatch(/beat .* by \d+ runs?\. Watch the reveal\./);
    expect(msg.url).not.toContain('/m/');
  });

  it('a cancelled or failed share says so (never silent)', async () => {
    for (const [result, text] of [
      ['cancelled', 'Not shared.'],
      ['failed', "Couldn't share. Try again, or copy the link instead."],
    ] as const) {
      useApp.setState({ toasts: [] });
      const f = fakeServices({ 'GET /v1/matches/:id/reveal': () => log, 'POST /v1/matches/:id/share': () => ({ code: 'k7q2m9xa', url: 'https://vande.example/s/k7q2m9xa' }) }, result);
      __setShareLedger(memoryShareLedger());
      services.current = f.value;
      const { unmount } = renderUi(<RevealedView matchId="m1" me={0} net={f.net as never} services={f.value as never} />);
      fireEvent.click(await screen.findByTestId('reveal-share'));
      await waitFor(() => expect(useApp.getState().toasts.map((x) => x.text)).toContain(text));
      unmount();
    }
  });
});

describe('the shared-match landing (/s/:code)', () => {
  const shared = (): SharedMatch => ({ code: 'k7q2m9xa', kind: 'duel', conditions: log.conditions, aliases: ['Moderated One', 'Moderated Two'], log });

  it('works for anyone, says nothing about the result, and shows the moderated names', async () => {
    useApp.setState({ player: null });
    const f = fakeServices({ 'GET /v1/s/:code': () => shared() });
    services.current = f.value;
    renderUi(<SharedRoute route={{ name: 'shared', code: 'k7q2m9xa' }} />);
    const landing = await screen.findByTestId('shared-landing');
    expect(f.call).toHaveBeenCalledWith('GET /v1/s/:code', { params: { code: 'k7q2m9xa' } }, { anonymous: true });
    expect(landing.textContent).toContain('Moderated One vs Moderated Two · Watch the reveal');
    expect(landing.textContent).not.toContain(log.players[0].alias);
    // Spoiler-safe: no score, no winner.
    expect(landing.textContent).not.toMatch(/\d+\/\d+/);
    expect(landing.textContent).not.toMatch(/won by|\bwins\b|\bbeat\b|\btied\b/i);
    expect(screen.getByTestId('shared-practice-0').textContent).toContain("Moderated One's over");
    fireEvent.click(screen.getByTestId('shared-watch'));
    expect(await screen.findByTestId('reveal-screen')).toBeTruthy();
  });

  it('a broken or removed link says so and offers the game', async () => {
    const f = fakeServices({
      'GET /v1/s/:code': () => {
        throw new ApiClientError('not_found', 'gone', 404);
      },
    });
    services.current = f.value;
    renderUi(<SharedRoute route={{ name: 'shared', code: 'zzzz9999' }} />);
    expect(await screen.findByText('This link does not work')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Play VANDE Cricket' }));
    expect(useRouter.getState().route).toEqual({ name: 'home' });
  });
});

describe("someone else's match", () => {
  it('is a private match, not an error (the server answers 404 for it)', async () => {
    const f = fakeServices({
      'GET /v1/matches/:id': () => {
        throw new ApiClientError('not_found', 'match not found', 404);
      },
    });
    services.current = f.value;
    renderUi(<MatchRoute route={{ name: 'match', matchId: 'm9' }} />);
    expect(await screen.findByText('This match is private')).toBeTruthy();
    expect(screen.queryByText(/Something went wrong/)).toBeNull();
  });
});

/** The translator the screens use (English). */
function createT() {
  return translator;
}
let translator: Awaited<ReturnType<typeof makeT>>;
async function makeT() {
  const { createTranslator } = await import('@/i18n/translator');
  const { ensureI18n } = await import('@/i18n/sources');
  const { english } = await ensureI18n('en');
  return createTranslator('en', english, english);
}
beforeAll(async () => {
  translator = await makeT();
});
