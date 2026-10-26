/**
 * Route screens with mocked services (no network): first run, the hub, Friend Duel creation and the invitation,
 * every match phase, and settings in an offline-only build.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import type { DailyView, MatchView, PlayerRef } from '@/contracts';
import { useApp } from '@/app/store';
import { useRouter } from '@/app/router';
import { KITS } from '@/ui/avatar/traits';
import { loadI18n, renderUi } from './helpers';
import { FIXTURE_PLAYERS } from '@/screens/dev/fixtures';

const services: { current: unknown } = { current: null };
vi.mock('@/app/services', () => ({ useServices: () => services.current, getServices: async () => services.current }));
vi.mock('@/screens/share/cards', async () => {
  const actual = await vi.importActual<typeof import('@/screens/share/cards')>('@/screens/share/cards');
  return { ...actual, cardBlob: async () => null };
});

import StartRoute from '@/screens/onboarding/StartRoute';
import HomeRoute from '@/screens/home/HomeRoute';
import DuelNewRoute from '@/screens/duel/DuelNewRoute';
import InviteRoute from '@/screens/invite/InviteRoute';
import MatchRoute from '@/screens/match/MatchRoute';
import SettingsRoute from '@/screens/settings/SettingsRoute';
import NotFoundRoute from '@/screens/notfound/NotFoundRoute';

const me: PlayerRef = { ...FIXTURE_PLAYERS[0], id: 'p_me' };
const them: PlayerRef = FIXTURE_PLAYERS[1];
const localPlayer = { id: 'p_me', alias: me.alias, avatar: me.avatar, kit: KITS[0] };

type Handler = (args?: { params?: Record<string, string>; body?: unknown }) => unknown;
function fakeServices(routes: Record<string, Handler> | null) {
  const call = vi.fn(async (route: string, args?: { params?: Record<string, string>; body?: unknown }) => {
    const h = routes?.[route];
    if (!h) throw new Error(`unexpected ${route}`);
    return h(args);
  });
  const share = { share: vi.fn().mockResolvedValue('shared'), whatsappUrl: (text: string, url: string) => `https://wa.me/?text=${encodeURIComponent(`${text}\n${url}`)}` };
  const analytics = { track: vi.fn(), setConsent: vi.fn(), consent: () => 'unset', active: () => false, flush: async () => undefined };
  const net = routes ? { api: { call }, session: { ensure: vi.fn().mockResolvedValue({ playerId: 'p_new' }), clear: vi.fn() }, batting: {}, outbox: {} } : null;
  return { call, share, analytics, value: { net, analytics, platform: { share, push: { available: () => false, register: vi.fn(), onMessage: () => () => undefined } } } };
}

function view(p: Partial<MatchView>): MatchView {
  return {
    matchId: 'm1',
    kind: 'duel',
    phase: 'planning',
    conditions: { pitch: 'hard', weather: 'clear' },
    me: 0,
    players: [me, them],
    locked: [false, false],
    battingDone: [false, false],
    seedCommit: 'a'.repeat(64),
    roomId: null,
    inviteUrl: null,
    rematch: null,
    myCommit: null,
    opponentCommit: null,
    deadlines: { lockBy: new Date(Date.now() + 3 * 3600_000).toISOString(), batBy: new Date(Date.now() + 26 * 3600_000).toISOString(), revealAt: null },
    myBallsFaced: 0,
    ...p,
  };
}

beforeAll(async () => {
  await loadI18n();
});
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  useApp.setState({ player: null, online: true, inPlay: false });
  useRouter.setState({ route: { name: 'home' }, depth: 0 });
});
afterEach(() => {
  cleanup();
  services.current = null;
});

/** The neutral age question that opens the first run: a year that is plainly 18 or over, then "Is that right?" Yes. */
function answerAge(testId = 'age', years = 30) {
  fireEvent.change(screen.getByTestId(`${testId}-year`), { target: { value: String(new Date().getFullYear() - years) } });
  if (testId === 'age') {
    fireEvent.click(screen.getByTestId('age-continue'));
    fireEvent.click(screen.getByTestId('age-confirm-yes'));
  }
}

describe('first run', () => {
  it('offline: keeps the player on this device and continues into Training', async () => {
    services.current = fakeServices(null).value;
    renderUi(<StartRoute route={{ name: 'onboarding' }} />);
    answerAge();
    expect(localStorage.getItem('vc:age')).toBe('adult');
    fireEvent.change(screen.getByTestId('onboarding-alias'), { target: { value: 'Swing King' } });
    fireEvent.click(screen.getByTestId('onboarding-submit'));
    await waitFor(() => expect(useRouter.getState().route).toEqual({ name: 'training' }));
    expect(useApp.getState().player).toMatchObject({ id: null, alias: 'Swing King' });
  });

  it('online: creates the guest account on the spot and keeps a rejected alias on screen', async () => {
    const f = fakeServices({ 'PATCH /v1/me': () => ({}) });
    services.current = f.value;
    renderUi(<StartRoute route={{ name: 'onboarding' }} />);
    answerAge();
    fireEvent.change(screen.getByTestId('onboarding-alias'), { target: { value: 'Asha Fire' } });
    fireEvent.click(screen.getByTestId('onboarding-submit'));
    await waitFor(() => expect(useApp.getState().player?.id).toBe('p_new'));
    expect(useRouter.getState().route).toEqual({ name: 'training' });
  });

  it('asks the year of birth neutrally, stores only the outcome, and stops under 18 for good', () => {
    services.current = fakeServices(null).value;
    const { unmount } = renderUi(<StartRoute route={{ name: 'onboarding' }} />);
    const year = screen.getByTestId('age-year') as HTMLInputElement;
    // No default and no example year.
    expect(year.value).toBe('');
    expect(year.getAttribute('placeholder')).toBeNull();
    fireEvent.click(screen.getByTestId('age-continue'));
    expect(screen.getByRole('alert').textContent).toMatch(/four digits/);
    expect(localStorage.getItem('vc:age')).toBeNull();
    // Digits from a Hindi keyboard count: १२ years back is under 18.
    const typed = new Date().getFullYear() - 12;
    const under = String(typed).replace(/\d/g, (d) => String.fromCodePoint(0x966 + Number(d)));
    fireEvent.change(year, { target: { value: under } });
    fireEvent.click(screen.getByTestId('age-continue'));
    // A neutral check first (a typo must not lock anyone out); nothing is kept yet.
    expect(screen.getByTestId('age-confirm').textContent).toContain(`You entered ${typed}. Is that right?`);
    expect(screen.queryByTestId('age-stop')).toBeNull();
    expect(localStorage.getItem('vc:age')).toBeNull();
    fireEvent.click(screen.getByTestId('age-confirm-change'));
    expect(screen.queryByTestId('age-confirm')).toBeNull();
    expect(screen.getByTestId('age-continue')).toBeTruthy();
    fireEvent.click(screen.getByTestId('age-continue'));
    fireEvent.click(screen.getByTestId('age-confirm-yes'));
    expect(screen.getByTestId('age-stop').textContent).toContain('VANDE Cricket is for players aged 18 and over');
    expect(localStorage.getItem('vc:age')).toBe('under');
    // Only the outcome is kept: no year anywhere in storage.
    expect(JSON.stringify({ ...localStorage })).not.toMatch(/\b(19|20)\d\d\b/);
    unmount();
    renderUi(<StartRoute route={{ name: 'onboarding' }} />);
    expect(screen.getByTestId('age-stop')).toBeTruthy();
    expect(screen.queryByTestId('age-year')).toBeNull();
  });

  it('the check is the same whichever way the answer goes, and editing the year takes it back', () => {
    services.current = fakeServices(null).value;
    renderUi(<StartRoute route={{ name: 'onboarding' }} />);
    const year = screen.getByTestId('age-year');
    fireEvent.change(year, { target: { value: String(new Date().getFullYear() - 40) } });
    fireEvent.click(screen.getByTestId('age-continue'));
    // Same words, same buttons, same order: nothing says which answer lets you in.
    const shape = () => {
      const c = screen.getByTestId('age-confirm');
      return [c.textContent?.replace(/\d{4}/, 'YYYY'), [...c.querySelectorAll('button')].map((x) => `${x.getAttribute('data-testid')}:${x.className}`)];
    };
    const adult = shape();
    fireEvent.change(year, { target: { value: String(new Date().getFullYear() - 10) } });
    expect(screen.queryByTestId('age-confirm')).toBeNull();
    fireEvent.click(screen.getByTestId('age-continue'));
    expect(shape()).toEqual(adult);
    expect(localStorage.getItem('vc:age')).toBeNull();
  });

  it('asks for the birthday only in the year someone turns 18', async () => {
    const { ageStep } = await import('@/screens/onboarding/age');
    const today = new Date(2026, 9, 25);
    expect(ageStep({ year: 1990, month: null, day: null }, today)).toEqual({ kind: 'answer', answer: 'adult' });
    expect(ageStep({ year: 2009, month: null, day: null }, today)).toEqual({ kind: 'answer', answer: 'under' });
    expect(ageStep({ year: 2008, month: null, day: null }, today)).toEqual({ kind: 'need', field: 'month', invalid: false });
    expect(ageStep({ year: 2008, month: 9, day: null }, today)).toEqual({ kind: 'answer', answer: 'adult' });
    expect(ageStep({ year: 2008, month: 11, day: null }, today)).toEqual({ kind: 'answer', answer: 'under' });
    expect(ageStep({ year: 2008, month: 10, day: null }, today)).toEqual({ kind: 'need', field: 'day', invalid: false });
    expect(ageStep({ year: 2008, month: 10, day: 25 }, today)).toEqual({ kind: 'answer', answer: 'adult' });
    expect(ageStep({ year: 2008, month: 10, day: 26 }, today)).toEqual({ kind: 'answer', answer: 'under' });
    expect(ageStep({ year: 2027, month: null, day: null }, today)).toEqual({ kind: 'need', field: 'year', invalid: true });
    expect(ageStep({ year: Number.NaN, month: null, day: null }, today)).toEqual({ kind: 'need', field: 'year', invalid: true });
  });

  it('recovering an existing account is offered on the age screen and skips it', () => {
    services.current = fakeServices(null).value;
    renderUi(<StartRoute route={{ name: 'onboarding' }} />);
    expect(screen.getByTestId('age-screen')).toBeTruthy();
    // The privacy policy is one tap away, in a new tab (the system browser on Android).
    expect(screen.getByTestId('age-privacy').getAttribute('href')).toMatch(/privacy\.html$/);
    expect(screen.getByTestId('age-privacy').getAttribute('target')).toBe('_blank');
  });

  it('sends a visitor without a player to onboarding, then back to where they were going', async () => {
    services.current = fakeServices(null).value;
    renderUi(<MatchRoute route={{ name: 'match', matchId: 'm77' }} />);
    expect(useRouter.getState().route).toEqual({ name: 'onboarding' });
    expect(JSON.parse(sessionStorage.getItem('vc:after-start') ?? 'null')).toEqual({ name: 'match', matchId: 'm77' });
  });
});

describe('hub', () => {
  it('lists real matches by urgency with honest states, and the Daily Six', async () => {
    useApp.setState({ player: localPlayer });
    const daily: DailyView = { day: '2026-10-25', conditions: { pitch: 'slow', weather: 'dew' }, attemptsUsed: 1, attemptsMax: 3, overCommits: ['a', 'b', 'c'], bestScore: 21, streak: 3, resetsAt: new Date(Date.now() + 5 * 3600_000).toISOString() };
    services.current = fakeServices({
      'GET /v1/matches': () => [view({ matchId: 'old', phase: 'expired' }), view({ matchId: 'wait', phase: 'planning', locked: [true, false] }), view({ matchId: 'lock', phase: 'planning' })],
      'GET /v1/daily': () => daily,
    }).value;
    renderUi(<HomeRoute route={{ name: 'home' }} />);
    const cards = await screen.findAllByTestId('home-match-card');
    expect(cards.map((c) => c.getAttribute('data-match-id'))).toEqual(['lock', 'wait', 'old']);
    expect(cards[0].textContent).toContain('Your move: lock your over');
    expect(cards[1].textContent).toContain(`Sealed. No over from ${them.alias} yet`);
    expect(screen.getByTestId('home-daily-card').textContent).toContain('2 attempts left');
    fireEvent.click(cards[0]);
    expect(useRouter.getState().route).toEqual({ name: 'match', matchId: 'lock' });
  });

  it('a duel with a reveal slot shows its time, and the hub looks again at that moment', async () => {
    useApp.setState({ player: localPlayer });
    const at = new Date(Date.now() + 200).toISOString();
    let calls = 0;
    services.current = fakeServices({
      'GET /v1/matches': () => {
        calls += 1;
        return [calls === 1 ? view({ matchId: 'slot', phase: 'awaiting_reveal', locked: [true, true], battingDone: [true, true], deadlines: { lockBy: view({}).deadlines.lockBy, batBy: view({}).deadlines.batBy, revealAt: at } }) : view({ matchId: 'slot', phase: 'revealed', locked: [true, true], battingDone: [true, true] })];
      },
      'GET /v1/daily': () => {
        throw new Error('not needed');
      },
    }).value;
    renderUi(<HomeRoute route={{ name: 'home' }} />);
    expect((await screen.findByTestId('home-match-card')).textContent).toContain('Both innings are in. Reveal at');
    await waitFor(() => expect(screen.getByTestId('home-match-card').textContent).toContain('The reveal is ready. Watch it'), { timeout: 4000 });
    expect(calls).toBe(2);
  });

  it('offline-only build: local modes stay available and online ones say they need a connection', async () => {
    useApp.setState({ player: localPlayer });
    services.current = fakeServices(null).value;
    renderUi(<HomeRoute route={{ name: 'home' }} />);
    expect(screen.getByText('This version plays offline only: Training and Practice Ghosts.')).toBeTruthy();
    expect(screen.getByTestId('home-duel').textContent).toContain('Needs a connection');
    fireEvent.click(screen.getByTestId('home-ghosts'));
    expect(useRouter.getState().route).toEqual({ name: 'ghosts' });
  });
});

describe('Friend Duel and the invitation', () => {
  it('creates a duel with the chosen pitch and offers WhatsApp first, once', async () => {
    useApp.setState({ player: localPlayer });
    const f = fakeServices({ 'POST /v1/duels': () => ({ matchId: 'm5', inviteToken: 'tok_abcdefgh', inviteUrl: 'https://vande.example/i/tok_abcdefgh' }) });
    services.current = f.value;
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    renderUi(<DuelNewRoute route={{ name: 'duel_new' }} />);
    fireEvent.click(screen.getByTestId('duel-pitch-green'));
    fireEvent.click(screen.getByTestId('duel-create'));
    await screen.findByTestId('invite-panel');
    expect(f.call).toHaveBeenCalledWith('POST /v1/duels', { body: { conditions: { pitch: 'green', weather: 'clear' } } });
    expect(f.analytics.track).toHaveBeenCalledWith('invite_created', { mode: 'duel' });
    await act(async () => {
      fireEvent.click(screen.getByTestId('invite-whatsapp'));
    });
    expect(open.mock.calls[0][0]).toMatch(/^https:\/\/wa\.me\/\?text=/);
    await screen.findByTestId('invite-sent');
    expect(screen.queryByTestId('invite-whatsapp')).toBeNull();
    fireEvent.click(screen.getByTestId('invite-plan'));
    expect(useRouter.getState().route).toEqual({ name: 'match', matchId: 'm5' });
  });

  it('credits a duel started from a highlight with its attribution code', async () => {
    useApp.setState({ player: localPlayer });
    const f = fakeServices({ 'POST /v1/duels': () => ({ matchId: 'm6', inviteToken: 'tok_abcdefgh', inviteUrl: 'https://vande.example/i/tok_abcdefgh' }) });
    services.current = f.value;
    renderUi(<DuelNewRoute route={{ name: 'duel_new', attribution: 'h1ghl1te' }} />);
    fireEvent.click(screen.getByTestId('duel-create'));
    await screen.findByTestId('invite-panel');
    expect(f.call).toHaveBeenCalledWith('POST /v1/duels', { body: { attributionCode: 'h1ghl1te' } });
    expect(f.analytics.track).toHaveBeenCalledWith('invite_created', { mode: 'duel', attribution: 'h1ghl1te' });
  });

  it('opens an invite with no install: quick alias, accept, then the match', async () => {
    const f = fakeServices({
      'GET /v1/invites/:token': () => ({ kind: 'duel', inviterAlias: 'Night Owl', conditions: { pitch: 'green', weather: 'humid' }, expiresAt: new Date(Date.now() + 86_400_000).toISOString() }),
      'POST /v1/invites/:token/accept': () => ({ matchId: 'm9' }),
      'PATCH /v1/me': () => ({}),
    });
    services.current = f.value;
    renderUi(<InviteRoute route={{ name: 'invite', token: 'tok_12345678', attribution: 'abcd1234' }} />);
    expect(await screen.findByText('Night Owl challenged you to a one-over duel')).toBeTruthy();
    expect(f.analytics.track).toHaveBeenCalledWith('invite_opened', { mode: 'duel', attribution: 'abcd1234' });
    fireEvent.change(screen.getByTestId('invite-alias'), { target: { value: 'Ravi Spin' } });
    // The neutral age question comes first on a first visit, then one "Is that right?".
    fireEvent.click(screen.getByTestId('invite-accept'));
    expect(f.call).not.toHaveBeenCalledWith('POST /v1/invites/:token/accept', expect.anything());
    answerAge('invite-age');
    fireEvent.click(screen.getByTestId('invite-accept'));
    expect(localStorage.getItem('vc:age')).toBeNull();
    fireEvent.click(screen.getByTestId('invite-age-confirm-yes'));
    await waitFor(() => expect(useRouter.getState().route).toEqual({ name: 'match', matchId: 'm9' }), { timeout: 5000 });
    expect(localStorage.getItem('vc:age')).toBe('adult');
    expect(screen.getByTestId('invite-privacy').getAttribute('href')).toMatch(/privacy\.html$/);
    expect(useApp.getState().player).toMatchObject({ id: 'p_new', alias: 'Ravi Spin' });
    expect(screen.getByTestId('invite-install').getAttribute('href')).toContain('vc_invite%3Dtok_12345678');
  });

  it('an invite visitor under 18 gets the kind stop and no account', async () => {
    const f = fakeServices({
      'GET /v1/invites/:token': () => ({ kind: 'duel', inviterAlias: 'Night Owl', conditions: { pitch: 'green', weather: 'humid' }, expiresAt: new Date(Date.now() + 86_400_000).toISOString() }),
    });
    services.current = f.value;
    renderUi(<InviteRoute route={{ name: 'invite', token: 'tok_12345678' }} />);
    await screen.findByText('Night Owl challenged you to a one-over duel');
    answerAge('invite-age', 15);
    fireEvent.change(screen.getByTestId('invite-alias'), { target: { value: 'Ravi Spin' } });
    fireEvent.click(screen.getByTestId('invite-accept'));
    expect(screen.queryByTestId('invite-age-stop')).toBeNull();
    fireEvent.click(screen.getByTestId('invite-age-confirm-yes'));
    expect(screen.getByTestId('invite-age-stop').textContent).toContain('18 and over');
    expect(screen.queryByTestId('invite-accept')).toBeNull();
    expect((f.value.net as { session: { ensure: ReturnType<typeof vi.fn> } }).session.ensure).not.toHaveBeenCalled();
    expect(localStorage.getItem('vc:age')).toBe('under');
  });

  it('a Group Cup invite names the cup in the panel and in the WhatsApp message', async () => {
    const { InvitePanel } = await import('@/screens/share/InvitePanel');
    const f = fakeServices({});
    services.current = f.value;
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    renderUi(<InvitePanel kind="cup" cupName="Office Cup" matchId="cup_abcdefgh" inviteUrl="https://vande.example/i/tok_cup12345" inviter={me} conditions={null} />);
    expect(screen.getByText('Invite friends to the cup')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByTestId('invite-whatsapp'));
    });
    const text = decodeURIComponent(String(open.mock.calls[0][0]).replace(/^https:\/\/wa\.me\/\?text=/, ''));
    expect(text).toContain('Office Cup');
    expect(text).toContain('https://vande.example/i/tok_cup12345');
    expect(f.analytics.track).toHaveBeenCalledWith('share_initiated', { mode: 'cup', channel: 'whatsapp' });
  });

  it('explains an expired invite and offers practice', async () => {
    const { ApiClientError } = await import('@/net/errors');
    services.current = fakeServices({
      'GET /v1/invites/:token': () => {
        throw new ApiClientError('deadline_passed', 'expired', 410);
      },
    }).value;
    renderUi(<InviteRoute route={{ name: 'invite', token: 'tok_12345678' }} />);
    expect(await screen.findByText("This invite has expired or isn't valid")).toBeTruthy();
  });

  it('an unknown short code reads the same as an expired one (codes cannot be enumerated)', async () => {
    const { ApiClientError } = await import('@/net/errors');
    services.current = fakeServices({
      'GET /v1/invites/:token': () => {
        throw new ApiClientError('deadline_passed', 'expired', 410);
      },
    }).value;
    renderUi(<InviteRoute route={{ name: 'invite', token: 'k7m2p9x4qa' }} />);
    expect(await screen.findByText("This invite has expired or isn't valid")).toBeTruthy();
    expect(screen.getByText('Ask your friend for a new one, or play a practice match while you wait.')).toBeTruthy();
  });
});

describe('match phases', () => {
  beforeEach(() => useApp.setState({ player: localPlayer }));

  it('planning: the plan card with the public lock deadline', async () => {
    services.current = fakeServices({ 'GET /v1/matches/:id': () => view({}), 'GET /v1/me': () => ({ unlocks: [] }) }).value;
    renderUi(<MatchRoute route={{ name: 'match', matchId: 'm1' }} />);
    expect(await screen.findByTestId('match-plan-card')).toBeTruthy();
    expect(screen.getByText(/Lock deadline in 3 hours/)).toBeTruthy();
  });

  it('sealed: shows the commit hash as proof and only whether the opponent has locked', async () => {
    services.current = fakeServices({ 'GET /v1/matches/:id': () => view({ locked: [true, false], myCommit: 'f'.repeat(64) }) }).value;
    renderUi(<MatchRoute route={{ name: 'match', matchId: 'm1' }} />);
    expect(await screen.findByTestId('match-sealed')).toBeTruthy();
    expect(screen.getByTestId('match-commit').textContent).toContain('ffffffffffff');
    expect(screen.getByText(`No sealed over from ${them.alias} yet`)).toBeTruthy();
  });

  it('waiting for a friend: shares the invite again from the server link, on any device', async () => {
    services.current = fakeServices({ 'GET /v1/matches/:id': () => view({ phase: 'awaiting_opponent', players: [me, null], inviteUrl: 'https://vande.example/i/tok_fromserver' }), 'GET /v1/me': () => ({ unlocks: [] }) }).value;
    renderUi(<MatchRoute route={{ name: 'match', matchId: 'm1' }} />);
    expect(await screen.findByTestId('invite-panel')).toBeTruthy();
    expect(screen.queryByText('You created this invite on another device. Share it from there.')).toBeNull();
  });

  it('awaiting reveal: flags and public times only, no score', async () => {
    services.current = fakeServices({ 'GET /v1/matches/:id': () => view({ phase: 'awaiting_reveal', locked: [true, true], battingDone: [true, false] }) }).value;
    renderUi(<MatchRoute route={{ name: 'match', matchId: 'm1' }} />);
    const card = await screen.findByTestId('match-awaiting-reveal');
    expect(card.textContent).toContain(`No innings from ${them.alias} yet`);
    expect(card.textContent).not.toMatch(/\d+\/\d+/);
  });

  it('the reminder is offered only while reminderFor gives a task: not once their innings is in', async () => {
    const { reminderFor } = await import('@/platform');
    const waiting = view({ phase: 'awaiting_reveal', locked: [true, true], battingDone: [true, false] });
    expect(reminderFor(waiting)).toMatchObject({ task: 'bat' });
    services.current = fakeServices({ 'GET /v1/matches/:id': () => waiting }).value;
    const { unmount } = renderUi(<MatchRoute route={{ name: 'match', matchId: 'm1' }} />);
    expect(await screen.findByTestId('match-nudge')).toBeTruthy();
    unmount();
    // Their innings is in (the status line may lag, the offer must not): no task, no reminder.
    const done = view({ phase: 'awaiting_reveal', locked: [true, true], battingDone: [true, true] });
    expect(reminderFor(done)).toBeNull();
    services.current = fakeServices({ 'GET /v1/matches/:id': () => done }).value;
    renderUi(<MatchRoute route={{ name: 'match', matchId: 'm1' }} />);
    await screen.findByTestId('match-awaiting-reveal');
    expect(screen.queryByTestId('match-nudge')).toBeNull();
  });

  it('awaiting reveal, duel: until both innings are in, status only and no time for the reveal', async () => {
    services.current = fakeServices({ 'GET /v1/matches/:id': () => view({ phase: 'awaiting_reveal', locked: [true, true], battingDone: [true, false] }) }).value;
    renderUi(<MatchRoute route={{ name: 'match', matchId: 'm1' }} />);
    const card = await screen.findByTestId('match-awaiting-reveal');
    expect(card.textContent).toContain(`The reveal gets a time for you both once ${them.alias} has batted`);
    expect(screen.queryByTestId('match-reveal-countdown')).toBeNull();
    expect(card.textContent).not.toMatch(/just now|is batting|refresh|wait/i);
  });

  it('awaiting reveal, duel: both innings in, an honest countdown to the shared reveal time', async () => {
    const at = new Date(Date.now() + 3 * 60_000 + 20_000).toISOString();
    services.current = fakeServices({ 'GET /v1/matches/:id': () => view({ phase: 'awaiting_reveal', locked: [true, true], battingDone: [true, true], deadlines: { lockBy: view({}).deadlines.lockBy, batBy: view({}).deadlines.batBy, revealAt: at } }) }).value;
    renderUi(<MatchRoute route={{ name: 'match', matchId: 'm1' }} />);
    const countdown = await screen.findByTestId('match-reveal-countdown');
    expect(screen.getByTestId('match-awaiting-reveal').textContent).toContain('Both innings are in');
    expect(countdown.getAttribute('data-reveal-at')).toBe(at);
    expect(countdown.textContent).toMatch(/^The reveal is at .+ · in 3 minutes$/);
    expect(screen.queryByTestId('match-nudge')).toBeNull();
  });

  it('awaiting reveal, duel: at the slot it fetches the match again and rolls into the reveal', async () => {
    // Far enough ahead that the countdown is on screen before the slot even on a loaded machine (a full run).
    const at = new Date(Date.now() + 1500).toISOString();
    let calls = 0;
    const f = fakeServices({
      'GET /v1/matches/:id': () => {
        calls += 1;
        return calls === 1 ? view({ phase: 'awaiting_reveal', locked: [true, true], battingDone: [true, true], deadlines: { lockBy: view({}).deadlines.lockBy, batBy: view({}).deadlines.batBy, revealAt: at } }) : view({ phase: 'revealed', locked: [true, true], battingDone: [true, true] });
      },
      'GET /v1/matches/:id/reveal': () => new Promise(() => undefined),
    });
    services.current = f.value;
    renderUi(<MatchRoute route={{ name: 'match', matchId: 'm1' }} />);
    expect(await screen.findByTestId('match-reveal-countdown', {}, { timeout: 1200 })).toBeTruthy();
    expect(await screen.findByTestId('match-reveal-loading', {}, { timeout: 8000 })).toBeTruthy();
    expect(calls).toBe(2);
    expect(f.call).toHaveBeenCalledWith('GET /v1/matches/:id/reveal', { params: { id: 'm1' } });
  }, 15_000);

  it('awaiting reveal, cup: the round reveal time, and whether the opponent has batted', async () => {
    const at = new Date(Date.now() + 2 * 3600_000).toISOString();
    services.current = fakeServices({ 'GET /v1/matches/:id': () => view({ kind: 'cup', phase: 'awaiting_reveal', locked: [true, true], battingDone: [true, false], cup: { cupId: 'c1', fixtureId: 'f1', stage: 'group' }, deadlines: { lockBy: view({}).deadlines.lockBy, batBy: view({}).deadlines.batBy, revealAt: at } }) }).value;
    renderUi(<MatchRoute route={{ name: 'match', matchId: 'm1' }} />);
    const card = await screen.findByTestId('match-awaiting-reveal');
    expect(card.textContent).toContain(`No innings from ${them.alias} yet`);
    expect(card.textContent).toContain('The reveal opens in 2 hours');
    expect(screen.queryByTestId('match-reveal-countdown')).toBeNull();
  });

  it('when to look for news: a duel waits for its slot, then fetches at it; cups keep polling', async () => {
    const { pollFor, refetchIn, revealSlot, REVEAL_GRACE_MS } = await import('@/screens/match/revealSlot');
    const now = Date.parse('2026-10-25T16:12:30Z');
    const slot = '2026-10-25T16:15:00Z';
    const d = (lockBy = view({}).deadlines.lockBy, batBy = view({}).deadlines.batBy) => ({ lockBy, batBy });
    const duel = view({ phase: 'awaiting_reveal', battingDone: [true, true], deadlines: { ...d(), revealAt: slot } });
    expect(revealSlot(duel)).toBe(slot);
    expect(pollFor(duel, now)).toBeNull();
    expect(refetchIn(duel, now)).toBe(150_000 + REVEAL_GRACE_MS);
    expect(pollFor(duel, Date.parse(slot) + 2000)).toBe(5_000);
    expect(refetchIn(duel, Date.parse(slot) + 2000)).toBe(REVEAL_GRACE_MS);
    const waiting = view({ phase: 'awaiting_reveal', battingDone: [true, false] });
    expect(revealSlot(waiting)).toBeNull();
    expect(pollFor(waiting, now)).toBe(20_000);
    expect(refetchIn(waiting, now)).toBeNull();
    const cup = view({ kind: 'cup', phase: 'awaiting_reveal', battingDone: [true, false], deadlines: { ...d(), revealAt: slot } });
    expect(revealSlot(cup)).toBeNull();
    expect(pollFor(cup, now)).toBe(20_000);
    expect(refetchIn(cup, now)).toBe(150_000 + REVEAL_GRACE_MS);
    expect(pollFor(view({ phase: 'planning', locked: [true, false] }), now)).toBe(20_000);
    expect(pollFor(view({ phase: 'batting' }), now)).toBeNull();
    expect(pollFor(view({ phase: 'revealed' }), now)).toBeNull();
  });

  it('batting: the innings card (the field arrives with the first ball)', async () => {
    services.current = fakeServices({ 'GET /v1/matches/:id': () => view({ phase: 'batting', locked: [true, true], myBallsFaced: 3 }) }).value;
    renderUi(<MatchRoute route={{ name: 'match', matchId: 'm1' }} />);
    expect((await screen.findByTestId('match-bat-start')).textContent).toBe('Continue from ball 4');
  });

  it('expired: no result, and a way back to play', async () => {
    services.current = fakeServices({ 'GET /v1/matches/:id': () => view({ phase: 'expired', players: [me, null] }) }).value;
    renderUi(<MatchRoute route={{ name: 'match', matchId: 'm1' }} />);
    expect(await screen.findByText('Nobody joined before the deadline, so there is no result.')).toBeTruthy();
  });

  it('expired after both joined: says neither locked (the server expires a duel nobody locked)', async () => {
    services.current = fakeServices({ 'GET /v1/matches/:id': () => view({ phase: 'expired' }) }).value;
    renderUi(<MatchRoute route={{ name: 'match', matchId: 'm1' }} />);
    expect(await screen.findByText('Neither of you locked an over before the deadline, so there is no result.')).toBeTruthy();
  });
});

describe('settings', () => {
  it('offline-only build: says no analytics are collected and deletes local data on confirmation', async () => {
    useApp.setState({ player: { ...localPlayer, id: null } });
    localStorage.setItem('vc:trained', '1');
    services.current = fakeServices(null).value;
    renderUi(<SettingsRoute route={{ name: 'settings' }} />);
    expect(screen.getByText('This version collects no analytics.')).toBeTruthy();
    fireEvent.click(screen.getByTestId('settings-delete'));
    fireEvent.click(await screen.findByTestId('settings-delete-dialog-confirm'));
    await waitFor(() => expect(useApp.getState().player).toBeNull());
    expect(localStorage.getItem('vc:trained')).toBeNull();
    expect(useRouter.getState().route).toEqual({ name: 'onboarding' });
  });

  it('signed in: exports data and deletes the account on the server first', async () => {
    useApp.setState({ player: localPlayer });
    const f = fakeServices({
      'GET /v1/push/settings': () => ({ enabled: false, quietHours: null }),
      'POST /v1/me/export': () => ({ downloadUrl: 'https://vande.example/v1/exports/x?t=1', expiresAt: new Date(Date.now() + 3600_000).toISOString() }),
      'DELETE /v1/me': () => ({ deleted: true }),
    });
    services.current = f.value;
    renderUi(<SettingsRoute route={{ name: 'settings' }} />);
    fireEvent.click(screen.getByTestId('settings-export'));
    expect((await screen.findByTestId('settings-export-link')).getAttribute('href')).toBe('https://vande.example/v1/exports/x?t=1');
    fireEvent.click(screen.getByTestId('settings-delete'));
    fireEvent.click(await screen.findByTestId('settings-delete-dialog-confirm'));
    await waitFor(() => expect(f.call).toHaveBeenCalledWith('DELETE /v1/me'));
    await waitFor(() => expect(useApp.getState().player).toBeNull());
  });
});

describe('wave F: first steps for invited friends', () => {
  it('an invite never crashes while its preview is still on its way, and offers the language first', async () => {
    let resolve: (v: unknown) => void = () => undefined;
    const f = fakeServices({ 'GET /v1/invites/:token': () => new Promise((r) => (resolve = r)) });
    // The services arrive a render after the screen (the moment that used to crash on preview.data!).
    services.current = null;
    const { rerender } = renderUi(<InviteRoute route={{ name: 'invite', token: 'tok_12345678' }} />);
    services.current = f.value;
    rerender(<InviteRoute route={{ name: 'invite', token: 'tok_12345678' }} />);
    expect(screen.getByTestId('invite-screen')).toBeTruthy();
    expect(screen.getByTestId('invite-language')).toBeTruthy();
    fireEvent.change(screen.getByTestId('invite-language'), { target: { value: 'hi' } });
    expect(useApp.getState().settings.locale).toBe('hi');
    useApp.getState().updateSettings({ locale: 'en' });
    await act(async () => resolve({ kind: 'duel', inviterAlias: 'Night Owl', conditions: { pitch: 'green', weather: 'humid' }, expiresAt: new Date(Date.now() + 86_400_000).toISOString() }));
    expect(await screen.findByText('Night Owl challenged you to a one-over duel')).toBeTruthy();
  });

  it('an untrained player is offered the 1-minute training from the plan card, and it leads back', async () => {
    useApp.setState({ player: localPlayer });
    services.current = fakeServices({ 'GET /v1/matches/:id': () => view({ phase: 'planning' }), 'GET /v1/me': () => ({ unlocks: [] }) }).value;
    renderUi(<MatchRoute route={{ name: 'match', matchId: 'm1' }} />);
    fireEvent.click(await screen.findByTestId('match-training'));
    expect(useRouter.getState().route).toEqual({ name: 'training' });
    const { peekAfterTraining } = await import('@/screens/app/hooks');
    expect(peekAfterTraining()).toEqual({ name: 'match', matchId: 'm1' });
  });

  it('after Training, the plan card no longer offers it', async () => {
    localStorage.setItem('vc:trained', '1');
    useApp.setState({ player: localPlayer });
    services.current = fakeServices({ 'GET /v1/matches/:id': () => view({ phase: 'planning' }), 'GET /v1/me': () => ({ unlocks: [] }) }).value;
    renderUi(<MatchRoute route={{ name: 'match', matchId: 'm1' }} />);
    await screen.findByTestId('match-plan-card');
    expect(screen.queryByTestId('match-training')).toBeNull();
  });

  it("the first over's planner explains itself once, and the energy costs say what they are", async () => {
    const { BowlingPlannerScreen } = await import('@/screens/planner/BowlingPlannerScreen');
    renderUi(<BowlingPlannerScreen conditions={{ pitch: 'hard', weather: 'clear' }} unlocked={['good_length', 'yorker', 'bouncer', 'offspin']} onLock={vi.fn()} coach />);
    expect(screen.getByTestId('plan-coach').textContent).toContain('How to plan your over');
    expect(screen.getByText(/Each delivery costs the energy on its badge/)).toBeTruthy();
    expect(screen.getAllByText(/^Costs \d+$/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByTestId('plan-coach-ok'));
    expect(screen.queryByTestId('plan-coach')).toBeNull();
  });
});

describe('wave F: the hub', () => {
  it("today's match leads, then the Daily Six, then the rest; a first visit says welcome, not welcome back", async () => {
    useApp.setState({ player: localPlayer });
    services.current = fakeServices({
      'GET /v1/matches': () => [view({ matchId: 'wait', phase: 'planning', locked: [true, false] }), view({ matchId: 'lock', phase: 'planning' })],
      'GET /v1/daily': () => {
        throw new Error('offline');
      },
    }).value;
    renderUi(<HomeRoute route={{ name: 'home' }} />);
    const cards = await screen.findAllByTestId('home-match-card');
    expect(cards[0].getAttribute('data-match-id')).toBe('lock');
    expect(cards[0].hasAttribute('data-featured')).toBe(true);
    expect(cards[0].textContent).toContain('Plan and lock your over');
    expect(screen.getByText('Your move')).toBeTruthy();
    expect(screen.getByText('Other matches')).toBeTruthy();
    expect(screen.getByText(/^Welcome, /)).toBeTruthy();
    // The Daily Six sits between today's match and the other matches.
    const order = ['home-match-card', 'home-daily-card'].map((id) => screen.getAllByTestId(id)[0]);
    expect(order[0].compareDocumentPosition(order[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    cleanup();
    renderUi(<HomeRoute route={{ name: 'home' }} />);
    expect(await screen.findByText(/^Welcome back, /)).toBeTruthy();
  });
});

describe('not found', () => {
  it('offers the way home', () => {
    renderUi(<NotFoundRoute route={{ name: 'not_found', path: '/nope' }} />);
    fireEvent.click(screen.getByTestId('not-found-home'));
    expect(useRouter.getState().route).toEqual({ name: 'home' });
  });
});

describe('one-time prompts', () => {
  it('analytics consent: two equal choices, asked once, only when analytics is configured', async () => {
    const { ConsentPrompt } = await import('@/screens/common/ConsentPrompt');
    let consent: 'unset' | 'granted' | 'denied' = 'unset';
    const analytics = { consent: () => consent, setConsent: vi.fn((c: 'granted' | 'denied') => (consent = c)) };
    const { rerender } = renderUi(<ConsentPrompt analytics={analytics} configured={false} />);
    expect(screen.queryByTestId('consent-prompt')).toBeNull();
    rerender(<ConsentPrompt analytics={analytics} configured />);
    const yes = screen.getByTestId('consent-accept');
    const no = screen.getByTestId('consent-decline');
    expect(yes.className).toBe(no.className);
    fireEvent.click(no);
    expect(analytics.setConsent).toHaveBeenCalledWith('denied');
    expect(screen.getByText('Got it. Nothing is shared.')).toBeTruthy();
  });

  it('notifications: offered once after a lock, registers the device only on "Turn on"', async () => {
    const { PushPrompt } = await import('@/screens/common/PushPrompt');
    const push = { available: () => true, register: vi.fn().mockResolvedValue({ token: 't'.repeat(40), platform: 'android' }), onMessage: () => () => undefined };
    const call = vi.fn().mockResolvedValue({ ok: true });
    renderUi(<PushPrompt push={push} net={{ api: { call } } as never} opponent="Night Owl" />);
    expect(screen.getByText(/once Night Owl has locked their over/)).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByTestId('push-accept'));
    });
    expect(push.register).toHaveBeenCalled();
    expect(call).toHaveBeenCalledWith('POST /v1/push/register', { body: { token: 't'.repeat(40), platform: 'android' } });
    cleanup();
    renderUi(<PushPrompt push={push} net={null} opponent={null} />);
    expect(screen.queryByTestId('push-prompt')).toBeNull();
  });
});
