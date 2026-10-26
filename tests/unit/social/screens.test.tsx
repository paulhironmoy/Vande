import { cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CupView, HighlightJob, HighlightPreview, HighlightPublic, LeaderboardView, RoomView, Top100Entry } from '@/contracts';
import { useApp } from '@/app/store';
import { useRouter } from '@/app/router';
import { AgeNotConfirmedError, ApiClientError } from '@/net/errors';
import { fakeServices, ME, ref } from './fakeServices';

// Lazy screens and catalogs can take more than the default second on a cold, busy machine.
configure({ asyncUtilTimeout: 5_000 });

let current: ReturnType<typeof fakeServices>['services'] | null = null;
vi.mock('@/app/services', async (orig) => ({ ...(await orig<typeof import('@/app/services')>()), useServices: () => current }));

const { default: Top100Route } = await import('@/social/top100/Top100Route');
const { default: HighlightsRoute } = await import('@/social/highlights/HighlightsRoute');
const { default: HighlightLandingRoute } = await import('@/social/highlights/HighlightLandingRoute');
const { default: CupRoute } = await import('@/social/cups/CupRoute');
const { default: RoomRoute } = await import('@/social/rooms/RoomRoute');
const { default: LeaderboardsRoute } = await import('@/social/leaderboards/LeaderboardsRoute');
const { default: ProfileRoute } = await import('@/social/profile/ProfileRoute');

beforeEach(() => {
  useApp.setState({ player: ME, online: true, toasts: [], settings: { ...useApp.getState().settings, locale: 'en' } });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  current = null;
});

const entry = (rank: number, playerId: string, alias: string): Top100Entry => ({ day: '2026-10-25', rank, playerId, alias, score: 240 - rank, matchIds: ['m1', 'm2'], bestMatchId: 'm1', components: { wins: 2, opponentStrength: 0.4, tacticalEfficiency: 0.6, tournamentImportance: 0.4, clutch: 0.5, execution: 0.6 } });

describe('Top 100', () => {
  it('today is decided at midnight IST: never a provisional list', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: Date.UTC(2026, 9, 26, 9) });
    const f = fakeServices({ 'GET /v1/top100/:day': () => Promise.reject(new ApiClientError('sealed', 'decided at midnight', 409, null, '2026-10-26T18:30:00.000Z')) });
    current = f.services;
    render(<Top100Route route={{ name: 'top100', day: '2026-10-26' }} />);
    expect(await screen.findByText('Decided at midnight')).toBeTruthy();
    expect(screen.getByTestId('top100-today').textContent).toMatch(/decided at midnight IST, in \d+ hours\./);
    // One plain sentence: never nested brackets such as "(Mon, 12:00 am (in 5 hours))".
    expect(screen.getByTestId('top100-screen').textContent).not.toMatch(/\([^)]*\(/);
    expect(screen.queryByTestId('top100-entries')).toBeNull();
    expect(f.calls[0]).toMatchObject({ route: 'GET /v1/top100/:day', args: { params: { day: '2026-10-26' } } });
  });

  it('a past day whose midnight has passed is running late, never "being decided"', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: Date.UTC(2026, 9, 26, 9) });
    const f = fakeServices({ 'GET /v1/top100/:day': () => Promise.reject(new ApiClientError('sealed', 'not frozen yet', 409, null, '2026-10-25T18:30:00.000Z')) });
    current = f.services;
    render(<Top100Route route={{ name: 'top100' }} />);
    expect(await screen.findByText('Running late')).toBeTruthy();
    expect(screen.queryByText('Being decided')).toBeNull();
    // The default day is yesterday (IST).
    expect(f.calls[0]).toMatchObject({ args: { params: { day: '2026-10-25' } } });
  });

  it('a day long past that was never ranked says so plainly', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: Date.UTC(2026, 9, 26, 9) });
    const f = fakeServices({ 'GET /v1/top100/:day': () => Promise.reject(new ApiClientError('sealed', 'not frozen', 409, null, '2026-10-20T18:30:00.000Z')) });
    current = f.services;
    render(<Top100Route route={{ name: 'top100', day: '2026-10-20' }} />);
    expect(await screen.findByText('No Top 100 for this day')).toBeTruthy();
  });

  it('lists a frozen day, marks me, and links every live highlight (mine and others) to its landing', async () => {
    const f = fakeServices({ 'GET /v1/top100/:day': () => [{ ...entry(1, 'pb', 'Calm Cobra'), highlightCode: 'k7q2m9xa' }, { ...entry(2, 'pme', 'Swift Tiger'), highlightCode: 'k7q2m9xa' }, { ...entry(3, 'pc', 'Bold Falcon'), highlightCode: null }] });
    current = f.services;
    render(<Top100Route route={{ name: 'top100', day: '2026-10-25' }} />);
    const list = await screen.findByTestId('top100-entries');
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    expect(within(list).getByText(/Swift Tiger \(you\)/)).toBeTruthy();
    expect(within(list).getByText('Watch your highlight')).toBeTruthy();
    expect(within(list).getAllByText('Watch the highlight')).toHaveLength(1);
    expect(screen.getByText(/permanent YouTube Top 100 badge/)).toBeTruthy();
    // The link comes with the list: no second request for my own highlights.
    expect(f.calls.map((c) => c.route)).toEqual(['GET /v1/top100/:day']);
    fireEvent.click(within(list).getAllByText('Watch the highlight')[0]);
    expect(useRouter.getState().route).toEqual({ name: 'highlight', code: 'k7q2m9xa' });
  });

  it('my entry without a live highlight offers the review instead', async () => {
    const f = fakeServices({ 'GET /v1/top100/:day': () => [entry(1, 'pme', 'Swift Tiger')] });
    current = f.services;
    render(<Top100Route route={{ name: 'top100', day: '2026-10-25' }} />);
    expect(await screen.findByText('Review your highlight')).toBeTruthy();
    expect(screen.queryByText('Watch your highlight')).toBeNull();
  });
});

describe('highlight consent', () => {
  const jobId = `j${'b'.repeat(26)}`;
  const job: HighlightJob = { jobId, day: '2026-10-25', matchId: 'm1', participants: ['pme', 'pb'], status: 'pending_consent', title: 'Swift Tiger vs Calm Cobra · Daily Top 100 #1 | VANDE Cricket #Shorts', description: 'Friend Duel · 2026-10-25', visibility: 'public', videoKey: null, youtubeVideoId: null, scheduledFor: null, attempts: 0, lastError: null, attributionCode: 'k7q2m9xa' };
  // The log keeps the match-time aliases; the consent screen shows the moderated names in `aliases`.
  const log = { players: [ref('pme', 'Old Name'), ref('pb', 'Calm Cobra')] };
  const preview = (decision: HighlightPreview['myDecision'] = null) => ({ job, input: { jobId, log, aliases: ['Swift Tiger', 'Calm Cobra'] as [string, string], locale: 'en', fixtureLabel: 'Friend Duel', day: '2026-10-25', ranks: [1, null], standings: null, cta: { url: 'https://vande.example/h/k7q2m9xa' } }, myDecision: decision });

  it('needs the 18+ confirmation to grant, and sends the chosen visibility', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: Date.UTC(2026, 9, 26, 9) });
    const f = fakeServices({
      'GET /v1/highlights/mine': () => [job],
      'GET /v1/highlights/:jobId/preview': () => preview(),
      'POST /v1/highlights/:jobId/consent': ({ body }) => ({ jobId, playerId: 'pme', decision: (body as { decision: string }).decision, adultConfirmed: true, approvedTitle: job.title, approvedVisibility: 'unlisted', decidedHour: '' }),
    });
    current = f.services;
    render(<HighlightsRoute route={{ name: 'highlights' }} />);
    fireEvent.click(await screen.findByTestId(`highlight-open-${jobId}`));
    const grant = (await screen.findByTestId('highlight-grant')) as HTMLButtonElement;
    expect(screen.getByText('Swift Tiger')).toBeTruthy();
    expect(screen.getByText('Calm Cobra')).toBeTruthy();
    expect(screen.queryByText('Old Name')).toBeNull();
    expect(grant.disabled).toBe(true);
    fireEvent.click(within(screen.getByTestId('highlight-visibility')).getByText('Unlisted'));
    fireEvent.click(screen.getByTestId('highlight-adult'));
    expect(grant.disabled).toBe(false);
    fireEvent.click(grant);
    await waitFor(() => expect(f.calls.find((c) => c.route === 'POST /v1/highlights/:jobId/consent')).toBeTruthy());
    expect(f.calls.find((c) => c.route === 'POST /v1/highlights/:jobId/consent')?.args.body).toEqual({ decision: 'granted', adultConfirmed: true, visibility: 'unlisted' });
    expect(f.track).toHaveBeenCalledWith('highlight_consent', { decision: 'granted' });
    vi.useRealTimers();
  });

  it('a declined job keeps the badge and offers no withdrawal', async () => {
    const declined = { ...job, status: 'consent_declined' as const };
    const f = fakeServices({ 'GET /v1/highlights/mine': () => [declined], 'GET /v1/highlights/:jobId/preview': () => ({ ...preview('declined'), job: declined }) });
    current = f.services;
    render(<HighlightsRoute route={{ name: 'highlights' }} />);
    fireEvent.click(await screen.findByTestId(`highlight-open-${jobId}`));
    expect(await screen.findByText('No video for this match')).toBeTruthy();
    expect(screen.getByText(/Your Top 100 badge stays/)).toBeTruthy();
    expect(screen.queryByTestId('highlight-withdraw')).toBeNull();
  });

  it('withdrawing a published video states that it is deleted, then calls the API', async () => {
    const live = { ...job, status: 'published' as const, youtubeVideoId: 'dQw4w9WgXcQ' };
    const f = fakeServices({ 'GET /v1/highlights/mine': () => [live], 'GET /v1/highlights/:jobId/preview': () => ({ ...preview('granted'), job: live }), 'POST /v1/highlights/:jobId/withdraw': () => ({ jobId, playerId: 'pme', decision: 'withdrawn', adultConfirmed: false, approvedTitle: live.title, approvedVisibility: 'public', decidedHour: '' }) });
    current = f.services;
    render(<HighlightsRoute route={{ name: 'highlights' }} />);
    fireEvent.click(await screen.findByTestId(`highlight-open-${jobId}`));
    fireEvent.click(await screen.findByTestId('highlight-withdraw'));
    const dialog = await screen.findByTestId('highlight-withdraw-dialog');
    expect(dialog.textContent).toContain('deleted from YouTube');
    fireEvent.click(within(dialog).getByText('Withdraw'));
    await waitFor(() => expect(f.calls.some((c) => c.route === 'POST /v1/highlights/:jobId/withdraw')).toBe(true));
  });
});

describe('public highlight landing', () => {
  const pub: HighlightPublic = { code: 'k7q2m9xa', day: '2026-10-25', title: 'Swift Tiger vs Calm Cobra', youtubeVideoId: 'dQw4w9WgXcQ', visibility: 'public', matchId: 'm1', participants: [{ alias: 'Swift Tiger', avatar: { seed: 'a1234567' }, rank: 1 }, { alias: 'Calm Cobra', avatar: { seed: 'b1234567' }, rank: null }] };

  it('counts one landing open, links out to YouTube without embedding anything', async () => {
    useApp.setState({ player: null });
    const f = fakeServices({ 'GET /v1/h/:code': () => pub });
    current = f.services;
    const { container, rerender } = render(<HighlightLandingRoute route={{ name: 'highlight', code: 'k7q2m9xa' }} />);
    const link = (await screen.findByTestId('landing-youtube')) as HTMLAnchorElement;
    expect(link.href).toBe('https://www.youtube.com/shorts/dQw4w9WgXcQ');
    expect(link.target).toBe('_blank');
    expect(link.rel).toContain('noopener');
    expect(container.querySelector('iframe, embed, object, video')).toBeNull();
    rerender(<HighlightLandingRoute route={{ name: 'highlight', code: 'k7q2m9xa' }} />);
    await waitFor(() => expect(f.report).toHaveBeenCalledTimes(1));
    expect(f.report).toHaveBeenCalledWith('k7q2m9xa', 'landing_open');
    expect(f.track).toHaveBeenCalledWith('attributed_view', { attribution: 'k7q2m9xa' });
    expect(screen.getByText('Can you beat them?')).toBeTruthy();
  });

  it('a challenge opens the duel screen carrying the attribution code (/duel?a=)', async () => {
    const f = fakeServices({ 'GET /v1/h/:code': () => pub });
    current = f.services;
    render(<HighlightLandingRoute route={{ name: 'highlight', code: 'k7q2m9xa' }} />);
    fireEvent.click(await screen.findByTestId('landing-challenge'));
    expect(useRouter.getState().route).toEqual({ name: 'duel_new', attribution: 'k7q2m9xa' });
    expect(f.track).toHaveBeenCalledWith('attributed_challenge', { attribution: 'k7q2m9xa' });
    // The duel itself is created by the duel screen, not here.
    expect(f.calls.some((c) => c.route === 'POST /v1/duels')).toBe(false);
  });
});

describe('Group Cup', () => {
  const base: CupView = {
    cupId: 'c1',
    name: 'Office Cup',
    status: 'gathering',
    size: 6,
    members: [ref('pme', 'Swift Tiger'), ref('pb', 'Calm Cobra')],
    inviteToken: 'tokentokentoken',
    schedule: { rounds: [{ round: 1, lockBy: '2026-10-26T12:00:00.000Z', batBy: '2026-10-26T13:00:00.000Z', revealAt: '2026-10-26T13:00:00.000Z' }], final: null },
    fixtures: [],
    standings: [],
    roomId: 'r1',
    myTasks: [],
    lockedCount: null,
    winner: null,
  };

  it('a cup short of players says how many are needed and offers the invite', async () => {
    const f = fakeServices({ 'GET /v1/cups/:id': () => base });
    current = f.services;
    render(<CupRoute route={{ name: 'cup', cupId: 'c1' }} />);
    expect(await screen.findByText('2 players so far, 3 needed')).toBeTruthy();
    expect(screen.getByTestId('invite-whatsapp')).toBeTruthy();
    expect(screen.getByText(/never hold anything up/)).toBeTruthy();
  });

  it('complete: the champion stays covered until the player asks', async () => {
    const done: CupView = { ...base, status: 'complete', inviteToken: null, members: [ref('pme', 'Swift Tiger'), ref('pb', 'Calm Cobra'), ref('pc', 'Bold Falcon')], winner: ref('pb', 'Calm Cobra') };
    const f = fakeServices({ 'GET /v1/cups/:id': () => done });
    current = f.services;
    render(<CupRoute route={{ name: 'cup', cupId: 'c1' }} />);
    const card = await screen.findByTestId('cup-complete');
    expect(within(card).queryByText('Calm Cobra')).toBeNull();
    fireEvent.click(within(card).getByTestId('cup-champion-show'));
    expect(within(screen.getByTestId('cup-champion')).getByText('Calm Cobra')).toBeTruthy();
    expect(within(screen.getByTestId('cup-champion')).getByText('Cup winner')).toBeTruthy();
  });

  it('in play: my next task, the honest lock count and the table', async () => {
    const live: CupView = {
      ...base,
      status: 'group_stage',
      members: [ref('pme', 'Swift Tiger'), ref('pb', 'Calm Cobra'), ref('pc', 'Bold Falcon')],
      inviteToken: null,
      schedule: { rounds: [{ round: 1, lockBy: new Date(Date.now() + 3_600_000).toISOString(), batBy: new Date(Date.now() + 7_200_000).toISOString(), revealAt: new Date(Date.now() + 7_200_000).toISOString() }], final: null },
      fixtures: [{ fixtureId: 'f1', round: 1, home: 'pme', away: 'pb', matchId: 'm1', status: 'planning', auto: [false, false] }],
      standings: [{ playerId: 'pb', alias: 'Calm Cobra', played: 1, won: 1, lost: 0, tied: 0, points: 2, netRunRate: 1.5, form: ['W'], movement: 1 }, { playerId: 'pme', alias: 'Swift Tiger', played: 1, won: 0, lost: 1, tied: 0, points: 0, netRunRate: -1.5, form: ['L'], movement: -1 }],
      myTasks: [{ kind: 'lock', matchId: 'm1', by: new Date(Date.now() + 3_600_000).toISOString() }],
      lockedCount: { round: 1, locked: 1, total: 2 },
    };
    const f = fakeServices({ 'GET /v1/cups/:id': () => live });
    current = f.services;
    render(<CupRoute route={{ name: 'cup', cupId: 'c1' }} />);
    expect(await screen.findByTestId('cup-next')).toBeTruthy();
    expect(screen.getByTestId('cup-lock-count').textContent).toBe('1 of 2 overs locked');
    const table = screen.getByTestId('cup-standings');
    expect(within(table).getByText('Up 1 place')).toBeTruthy();
    expect(within(table).getByText('Down 1 place')).toBeTruthy();
  });

  it('the table lets me report another player, never myself', async () => {
    const other = `p${'r'.repeat(26)}`;
    const live: CupView = {
      ...base,
      status: 'group_stage',
      members: [ref('pme', 'Swift Tiger'), ref(other, 'Rude Name')],
      inviteToken: null,
      standings: [{ playerId: other, alias: 'Rude Name', played: 1, won: 1, lost: 0, tied: 0, points: 2, netRunRate: 1.5, form: ['W'], movement: 0 }, { playerId: 'pme', alias: 'Swift Tiger', played: 1, won: 0, lost: 1, tied: 0, points: 0, netRunRate: -1.5, form: ['L'], movement: 0 }],
    };
    const f = fakeServices({ 'GET /v1/cups/:id': () => live, 'POST /v1/report': () => ({ ok: true }) });
    current = f.services;
    render(<CupRoute route={{ name: 'cup', cupId: 'c1' }} />);
    const table = await screen.findByTestId('cup-standings');
    expect(within(table).queryByLabelText('Report Swift Tiger')).toBeNull();
    fireEvent.click(within(table).getByLabelText('Report Rude Name'));
    fireEvent.click(within(await screen.findByTestId('report-player')).getByText('Send report'));
    await waitFor(() => expect(f.calls.find((c) => c.route === 'POST /v1/report')?.args.body).toEqual({ playerId: other, reason: 'abusive' }));
  });
});

describe('Cricket Room', () => {
  const view: RoomView = {
    roomId: 'r1',
    kind: 'cup',
    title: 'Office Cup',
    members: [ref('pme', 'Swift Tiger'), ref('pb', 'Calm Cobra')],
    posts: [
      { postId: 'p2', kind: 'scorecard', payload: { matchId: 'm1', homeAlias: 'Swift Tiger', awayAlias: 'Calm Cobra', homeRuns: 21, homeWickets: 1, awayRuns: 19, awayWickets: 2, winnerAlias: 'Swift Tiger', tie: false }, authorId: null, createdHour: '2026-10-26T10:00:00.000Z', reactions: {}, myReaction: null },
      { postId: 'p1', kind: 'banter', payload: { phraseId: 'banter.bring_it' }, authorId: 'pb', createdHour: '2026-10-26T09:00:00.000Z', reactions: { clap: 2 }, myReaction: null },
    ],
    cursor: null,
    muted: true,
    notify: 'all',
    freeText: false,
  };

  it('covers scorecards until tapped, shows the muted state and no free text box when off', async () => {
    const f = fakeServices({ 'GET /v1/rooms/:id': () => view, 'POST /v1/rooms/:id/react': () => ({ ok: true }) });
    current = f.services;
    render(<RoomRoute route={{ name: 'room', roomId: 'r1' }} />);
    const spoiler = await screen.findByTestId('room-spoiler');
    expect(screen.queryByText('Swift Tiger won')).toBeNull();
    fireEvent.click(spoiler);
    expect(screen.getByText('Swift Tiger won')).toBeTruthy();
    expect(screen.getByText('This room is muted')).toBeTruthy();
    expect(screen.queryByTestId('room-text')).toBeNull();
    expect(screen.getByText('Bring it on!')).toBeTruthy();
    // Report and block only on other members' posts.
    expect(screen.getAllByLabelText('Report this post')).toHaveLength(1);
    fireEvent.click(screen.getAllByLabelText(/^Clap, 2 reactions$/)[0]);
    await waitFor(() => expect(f.calls.find((c) => c.route === 'POST /v1/rooms/:id/react')?.args.body).toEqual({ postId: 'p1', reaction: 'clap' }));
  });

  it('celebrates a delivery earned in an official match', async () => {
    const unlock = { postId: 'p3', kind: 'achievement' as const, payload: { badge: 'unlock_inswing', alias: 'Calm Cobra' }, authorId: null, createdHour: '2026-10-26T11:00:00.000Z', reactions: {}, myReaction: null };
    current = fakeServices({ 'GET /v1/rooms/:id': () => ({ ...view, posts: [unlock, ...view.posts] }) }).services;
    render(<RoomRoute route={{ name: 'room', roomId: 'r1' }} />);
    expect(await screen.findByText('Calm Cobra unlocked In-swing. It is in their planner from the next over.')).toBeTruthy();
  });
});

describe('leaderboards', () => {
  it('pins my row when I am outside the list and shows the real count', async () => {
    const board: LeaderboardView = { scope: 'national', day: '2026-10-26', entries: [{ rank: 1, playerId: 'pb', alias: 'Calm Cobra', avatar: { seed: 'b1234567' }, score: 300, isMe: false }], me: { rank: 57, playerId: 'pme', alias: 'Swift Tiger', avatar: { seed: 'a1234567' }, score: 120, isMe: true }, total: 1234 };
    const f = fakeServices({ 'GET /v1/me': () => ({ playerId: 'pme', groups: [], city: 'pune' }), 'GET /v1/leaderboards/:scope': () => board });
    current = f.services;
    render(<LeaderboardsRoute route={{ name: 'leaderboards', scope: 'national' }} />);
    expect(await screen.findByTestId('board-me')).toBeTruthy();
    expect(screen.getByText('1,234 players ranked')).toBeTruthy();
    expect(screen.getByLabelText('You, rank 57')).toBeTruthy();
  });

  it('asks for a city from the fixed list (never location) before the city board', async () => {
    const f = fakeServices({ 'GET /v1/me': () => ({ playerId: 'pme', groups: [], city: null }) });
    current = f.services;
    render(<LeaderboardsRoute route={{ name: 'leaderboards', scope: 'city' }} />);
    const select = (await screen.findByTestId('board-city-select')) as HTMLSelectElement;
    expect(select.options.length).toBeGreaterThan(70);
    expect(screen.getByText(/never use your location/)).toBeTruthy();
  });
});

describe('private groups', () => {
  it('a new group shows its code to share even after the screen switches to its board', async () => {
    let profile = { playerId: 'pme', groups: [] as Array<{ groupId: string; kind: string; name: string }>, city: null };
    const empty: LeaderboardView = { scope: 'college', day: '2026-10-26', entries: [], me: null, total: 0 };
    const f = fakeServices({
      'GET /v1/me': () => profile,
      'POST /v1/groups': ({ body }) => {
        profile = { ...profile, groups: [{ groupId: 'grp000001', kind: 'college', name: (body as { name: string }).name }] };
        return { groupId: 'grp000001', code: 'ABCD-EFGH-JK' };
      },
      'GET /v1/leaderboards/:scope': () => empty,
    });
    current = f.services;
    render(<LeaderboardsRoute route={{ name: 'leaderboards', scope: 'college' }} />);
    fireEvent.change(await screen.findByLabelText('Or create a college group'), { target: { value: 'Anna University' } });
    fireEvent.click(screen.getByText('Create the group'));
    // The board of the new group loads, and the code is still there to share.
    await waitFor(() => expect(f.calls.some((c) => c.route === 'GET /v1/leaderboards/:scope')).toBe(true));
    expect((await screen.findByTestId('board-new-code')).textContent).toContain('ABCD-EFGH-JK');
  });
});

describe('profile', () => {
  it('saves alias, avatar and kit and updates the player on this device', async () => {
    const profile = { playerId: 'pme', alias: 'Swift Tiger', avatar: { seed: 'abc12345' }, kit: ME.kit, locale: 'en', city: null, groups: [], badges: ['youtube_top100'], unlocks: [], rating: 1234.6, createdDay: '2026-10-01', adultConfirmed: false, linked: { google: false, passkey: false } };
    const f = fakeServices({ 'GET /v1/me': () => profile, 'PATCH /v1/me': ({ body }) => ({ ...profile, ...(body as object) }) });
    current = f.services;
    render(<ProfileRoute route={{ name: 'profile' }} />);
    const alias = (await screen.findByTestId('profile-alias')) as HTMLInputElement;
    expect(screen.getByText('YouTube Top 100')).toBeTruthy();
    expect(screen.getByText('Rating 1,235')).toBeTruthy();
    fireEvent.change(alias, { target: { value: 'Calm Lion' } });
    // A later copy of the profile (here the answer to a city change) never overwrites the unsaved edit.
    fireEvent.change(screen.getByTestId('profile-city'), { target: { value: 'pune' } });
    await waitFor(() => expect(f.calls.some((c) => c.route === 'PATCH /v1/me' && (c.args.body as { city?: string }).city === 'pune')).toBe(true));
    expect((screen.getByTestId('profile-alias') as HTMLInputElement).value).toBe('Calm Lion');
    const save = screen.getByTestId('profile-save') as HTMLButtonElement;
    await waitFor(() => expect(save.disabled).toBe(false));
    fireEvent.click(save);
    await waitFor(() => expect(useApp.getState().player?.alias).toBe('Calm Lion'));
    expect(f.calls.filter((c) => c.route === 'PATCH /v1/me').at(-1)?.args.body).toMatchObject({ alias: 'Calm Lion', avatar: { seed: 'abc12345' }, kit: ME.kit });
  });
});

describe('18+ only', () => {
  it('without the age confirmation there is no account: the screens say so plainly, never "Members only"', async () => {
    useApp.setState({ player: { ...ME, id: undefined as never } });
    const f = fakeServices({ 'GET /v1/me': () => ({}), 'GET /v1/leaderboards': () => ({}) });
    f.services.net.session.ensure = vi.fn(async () => {
      throw new AgeNotConfirmedError();
    });
    current = f.services;
    render(<LeaderboardsRoute route={{ name: 'leaderboards', scope: 'friends' }} />);
    expect(await screen.findByText('For players aged 18 and over')).toBeTruthy();
    expect(screen.queryByText('Members only')).toBeNull();
    expect(f.calls).toEqual([]);
  });

  it('the profile shows the confirmation as a fact, with no switch to turn it off', async () => {
    const profile = { playerId: 'pme', alias: 'Swift Tiger', avatar: { seed: 'abc12345' }, kit: ME.kit, locale: 'en', city: null, groups: [], badges: [], unlocks: [], rating: 1200, createdDay: '2026-10-01', adultConfirmed: true, linked: { google: false, passkey: false } };
    current = fakeServices({ 'GET /v1/me': () => profile }).services;
    render(<ProfileRoute route={{ name: 'profile' }} />);
    expect((await screen.findByTestId('profile-adult-confirmed')).textContent).toBe('Confirmed 18 or over');
    expect(screen.queryByTestId('profile-adult')).toBeNull();
  });
});

describe('report a player wherever their name shows', () => {
  const OTHER = `p${'q'.repeat(26)}`;

  it('from a leaderboard row: a reason, then the report (never for my own row)', async () => {
    const board: LeaderboardView = {
      scope: 'national',
      day: '2026-10-26',
      entries: [
        { rank: 1, playerId: OTHER, alias: 'Calm Cobra', avatar: { seed: 'b1234567' }, score: 300, isMe: false },
        { rank: 2, playerId: 'pme', alias: 'Swift Tiger', avatar: { seed: 'a1234567' }, score: 120, isMe: true },
      ],
      me: { rank: 2, playerId: 'pme', alias: 'Swift Tiger', avatar: { seed: 'a1234567' }, score: 120, isMe: true },
      total: 2,
    };
    const f = fakeServices({ 'GET /v1/me': () => ({ playerId: 'pme', groups: [], city: 'pune' }), 'GET /v1/leaderboards/:scope': () => board, 'POST /v1/report': () => ({ ok: true }) });
    current = f.services;
    render(<LeaderboardsRoute route={{ name: 'leaderboards', scope: 'national' }} />);
    fireEvent.click(await screen.findByLabelText('Report Calm Cobra'));
    expect(screen.queryByLabelText('Report Swift Tiger')).toBeNull();
    const dialog = await screen.findByTestId('report-player');
    expect(within(dialog).getByText(/Calm Cobra is not told who reported them/)).toBeTruthy();
    fireEvent.click(within(dialog).getByLabelText('Spam'));
    fireEvent.click(within(dialog).getByText('Send report'));
    await waitFor(() => expect(f.calls.find((c) => c.route === 'POST /v1/report')?.args.body).toEqual({ playerId: OTHER, reason: 'spam' }));
  });

  it('from the Daily Top 100 (signed in), never for my own entry', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: Date.UTC(2026, 9, 26, 9) });
    const f = fakeServices({ 'GET /v1/top100/:day': () => [{ ...entry(1, OTHER, 'Calm Cobra') }, { ...entry(2, 'pme', 'Swift Tiger') }], 'POST /v1/report': () => ({ ok: true }) });
    current = f.services;
    render(<Top100Route route={{ name: 'top100', day: '2026-10-25' }} />);
    fireEvent.click(await screen.findByLabelText('Report Calm Cobra'));
    fireEvent.click(within(await screen.findByTestId('report-player')).getByText('Send report'));
    await waitFor(() => expect(f.calls.find((c) => c.route === 'POST /v1/report')?.args.body).toEqual({ playerId: OTHER, reason: 'abusive' }));
    expect(screen.queryByLabelText('Report Swift Tiger')).toBeNull();
    vi.useRealTimers();
  });
});
