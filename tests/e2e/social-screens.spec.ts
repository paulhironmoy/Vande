/**
 * The social screens in the real app (production build that talks to http://127.0.0.1:8787) against a mocked API:
 * Group Cup creation and the cup, the Cricket Room, leaderboards, the Daily Top 100, highlight consent, the public
 * highlight landing and the profile. Every screen is checked with axe at 360 px. Nothing leaves the machine: every
 * request that is not the app or the mocked API is aborted and recorded. The `social` Playwright project builds the
 * API-enabled app itself (playwright.config.ts); in isolation:
 *
 *   E2E_API_PORT=4181 E2E_API_DIST=dist-social E2E_OUT=test-results-social npx playwright test --project=social
 */
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CupView, HighlightJob, HighlightPreview, HighlightPublic, LeaderboardView, MatchEventLog, PlayerRef, Profile, RoomPost, RoomView, SessionTokens, Top100Entry } from '../../src/contracts';

test.use({
  viewport: { width: 360, height: 780 },
  deviceScaleFactor: 2,
  hasTouch: true,
  isMobile: true,
  serviceWorkers: 'block',
  launchOptions: { args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] },
});

const API = 'http://127.0.0.1:8787';
/** 2026-10-26 14:30 IST: today is 2026-10-26, yesterday 2026-10-25. */
const NOW = Date.UTC(2026, 9, 26, 9, 0);
const HOUR = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();

// ---- fixtures -------------------------------------------------------------------------------------------------------

const KIT = { id: 'starter', primary: '#1E2A78', secondary: '#00B8D9', pattern: 'chevron' } as const;
const LOCAL_PLAYER = { id: null, alias: 'Swift Tiger', avatar: { seed: 'k3j2h4g5f6' }, kit: KIT };
const ref = (id: string, alias: string, primary = '#222266'): PlayerRef => ({ id, alias, avatar: { seed: `${id}seed01` }, kit: { id: 'starter', primary, secondary: '#FFB83F', pattern: 'plain' }, kind: 'human' });
const ME = ref('pme', 'Swift Tiger', '#1E2A78');
const COBRA = ref('pb', 'Calm Cobra');
const FALCON = ref('pc', 'Bold Falcon');
const PANTHER = ref('pd', 'Lucky Panther');

const TOKENS: SessionTokens = { playerId: 'pme', accessToken: 'test-access', refreshToken: 'test-refresh', expiresAt: '2030-01-01T00:00:00.000Z' };
const PROFILE: Profile = {
  playerId: 'pme',
  alias: 'Swift Tiger',
  avatar: { seed: 'k3j2h4g5f6' },
  kit: KIT,
  locale: 'en',
  city: null,
  groups: [],
  badges: ['youtube_top100', 'first_win'],
  unlocks: [],
  rating: 1234.6,
  createdDay: '2026-10-01',
  adultConfirmed: false,
  linked: { google: false, passkey: false },
};

/** A real engine-v1 replay (frozen golden fixture), so the replays and the highlight composer have true events. */
const GOLDEN = (JSON.parse(readFileSync(join(process.cwd(), 'tests/unit/engine/fixtures/golden-v1.json'), 'utf8')) as { logs: MatchEventLog[] }).logs.find((l) => l.matchId === 'golden-duel') as MatchEventLog;

function cupView(over: Partial<CupView> = {}): CupView {
  const round = (n: number) => ({ round: n, lockBy: iso(NOW + (n - 2) * 24 * HOUR + 3 * HOUR), batBy: iso(NOW + (n - 2) * 24 * HOUR + 6 * HOUR), revealAt: iso(NOW + (n - 2) * 24 * HOUR + 6 * HOUR) });
  return {
    cupId: 'cupoffice01',
    name: 'Office Cup',
    status: 'group_stage',
    size: 4,
    members: [ME, COBRA, FALCON, PANTHER],
    inviteToken: null,
    schedule: { rounds: [round(1), round(2), round(3)], final: { lockBy: iso(NOW + 2 * 24 * HOUR), batBy: iso(NOW + 2 * 24 * HOUR + 3 * HOUR), revealAt: iso(NOW + 2 * 24 * HOUR + 3 * HOUR) } },
    fixtures: [
      { fixtureId: 'f1', round: 1, home: 'pme', away: 'pb', matchId: 'match0001', status: 'revealed', auto: [false, false] },
      { fixtureId: 'f2', round: 1, home: 'pc', away: 'pd', matchId: 'match0002', status: 'revealed', auto: [false, true] },
      { fixtureId: 'f3', round: 2, home: 'pme', away: 'pc', matchId: 'match0003', status: 'planning', auto: [false, false] },
      { fixtureId: 'f4', round: 2, home: 'pb', away: 'pd', matchId: 'match0004', status: 'planning', auto: [false, false] },
      { fixtureId: 'f5', round: 3, home: 'pme', away: 'pd', matchId: 'match0005', status: 'scheduled', auto: [false, false] },
      { fixtureId: 'f6', round: 3, home: 'pb', away: 'pc', matchId: 'match0006', status: 'scheduled', auto: [false, false] },
    ],
    standings: [
      { playerId: 'pb', alias: 'Calm Cobra', played: 1, won: 1, lost: 0, tied: 0, points: 2, netRunRate: 1.5, form: ['W'], movement: 1 },
      { playerId: 'pc', alias: 'Bold Falcon', played: 1, won: 1, lost: 0, tied: 0, points: 2, netRunRate: 0.5, form: ['W'], movement: 0 },
      { playerId: 'pme', alias: 'Swift Tiger', played: 1, won: 0, lost: 1, tied: 0, points: 0, netRunRate: -1.5, form: ['L'], movement: -1 },
      { playerId: 'pd', alias: 'Lucky Panther', played: 1, won: 0, lost: 1, tied: 0, points: 0, netRunRate: -0.5, form: ['L'], movement: 0 },
    ],
    roomId: 'roomoffice01',
    myTasks: [{ kind: 'lock', matchId: 'match0003', by: iso(NOW + 3 * HOUR) }],
    lockedCount: { round: 2, locked: 1, total: 4 },
    winner: null,
    ...over,
  };
}

function post(postId: string, kind: RoomPost['kind'], payload: RoomPost['payload'], extra: Partial<RoomPost> = {}): RoomPost {
  return { postId, kind, payload, authorId: null, createdHour: '2026-10-26T08:00:00.000Z', reactions: {}, myReaction: null, ...extra };
}

/** One card of every kind the server posts, newest first. */
function roomView(over: Partial<RoomView> = {}): RoomView {
  return {
    roomId: 'roomoffice01',
    kind: 'cup',
    title: 'Office Cup',
    members: [ME, COBRA, FALCON, PANTHER],
    posts: [
      post('p13', 'text', { text: 'Good luck everyone' }, { authorId: 'pc' }),
      post('p12', 'banter', { phraseId: 'banter.bring_it' }, { authorId: 'pb', reactions: { clap: 2, fire: 1 } }),
      post('p11', 'rematch', { matchId: 'match0009', fromAlias: 'Calm Cobra' }),
      post('p10', 'highlight', { jobId: `j${'a'.repeat(26)}`, code: 'k7q2m9xa', matchId: 'match0001', title: 'Swift Tiger vs Calm Cobra', url: 'https://vande.example/h/k7q2m9xa' }),
      post('p9', 'achievement', { badge: 'first_win', alias: 'Calm Cobra' }),
      post('p8', 'standings', { round: '1', leaderAlias: 'Calm Cobra', leaderPoints: 2, moves: 2 }),
      post('p7', 'scorecard', { matchId: 'match0001', round: '1', stage: 'group', homeAlias: 'Swift Tiger', awayAlias: 'Calm Cobra', homeRuns: 14, homeWickets: 1, awayRuns: 17, awayWickets: 0, winnerAlias: 'Calm Cobra', tie: false, decidedBy: 'runs' }, { reactions: { trophy: 1 } }),
      post('p6', 'reveal_ready', { round: '1', matchId: 'match0001', stage: 'group' }),
      post('p5', 'deadline', { round: '2', phase: 'lock', by: iso(NOW + 3 * HOUR) }),
      post('p4', 'lock_status', { round: '2', locked: 1, total: 4 }),
      post('p3', 'fixture', { round: '2', stage: 'group', fixtures: 2, lockBy: iso(NOW + 3 * HOUR), batBy: iso(NOW + 6 * HOUR), revealAt: iso(NOW + 6 * HOUR) }),
      post('p1', 'invite', { kind: 'cup', inviterAlias: 'Swift Tiger', cupName: 'Office Cup' }),
    ],
    cursor: null,
    muted: false,
    notify: 'all',
    freeText: false,
    ...over,
  };
}

const entry = (rank: number, playerId: string, alias: string, score: number): Top100Entry => ({
  day: '2026-10-25',
  rank,
  playerId,
  alias,
  score,
  matchIds: ['match0001', 'match0002', 'match0003'],
  bestMatchId: 'match0001',
  components: { wins: 2, opponentStrength: 0.42, tacticalEfficiency: 0.71, tournamentImportance: 0.55, clutch: 0.6, execution: 0.66 },
});

function job(jobId: string, status: HighlightJob['status'], day = '2026-10-25', over: Partial<HighlightJob> = {}): HighlightJob {
  return {
    jobId,
    day,
    matchId: `match-${jobId.slice(1, 6)}`,
    participants: ['pme', 'pb'],
    status,
    title: 'Swift Tiger vs Calm Cobra · Daily Top 100 #1 | VANDE Cricket #Shorts',
    description: 'Friend Duel · 2026-10-25\nCan you beat them? https://vande.example/h/k7q2m9xa',
    visibility: 'public',
    videoKey: null,
    youtubeVideoId: status === 'published' ? 'dQw4w9WgXcQ' : null,
    scheduledFor: null,
    attempts: status === 'upload_failed' ? 3 : 0,
    lastError: null,
    attributionCode: 'k7q2m9xa',
    ...over,
  };
}

const PENDING = job(`j${'p'.repeat(26)}`, 'pending_consent');

// ---- mocked API -----------------------------------------------------------------------------------------------------

type Req = { method: string; path: string; params: Record<string, string>; query: URLSearchParams; body: any };
type Reply = { status: number; json?: unknown; headers?: Record<string, string> };
type Handler = (req: Req) => unknown;
const reply = (status: number, json?: unknown, headers?: Record<string, string>): Reply & { __reply: true } => ({ __reply: true, status, json, headers });

const DEFAULTS: Record<string, Handler> = {
  'GET /v1/health': () => ({ ok: true }),
  'POST /v1/auth/guest': () => TOKENS,
  'POST /v1/auth/refresh': () => TOKENS,
  'GET /v1/me': () => PROFILE,
  'PATCH /v1/me': ({ body }) => ({ ...PROFILE, ...body }),
  'POST /v1/attribution': () => ({ ok: true }),
};

interface Mock {
  calls: Array<{ key: string; path: string; body: any }>;
  unmocked: string[];
  thirdParty: string[];
  count(key: string): number;
  last(key: string): { key: string; path: string; body: any } | undefined;
}

async function mockApi(page: Page, handlers: Record<string, Handler> = {}): Promise<Mock> {
  const calls: Mock['calls'] = [];
  const unmocked: string[] = [];
  const thirdParty: string[] = [];
  const table = Object.entries({ ...DEFAULTS, ...handlers }).map(([key, h]) => {
    const [method, pattern] = key.split(' ');
    const names: string[] = [];
    const re = new RegExp(`^${pattern.replace(/:([A-Za-z]+)/g, (_m, n: string) => (names.push(n), '([^/]+)'))}$`);
    return { key, method, re, names, h };
  });
  // Nothing but the app and the mocked API: any other request (fonts, embeds, analytics, wa.me) is refused.
  await page.context().route(
    (url) => !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(url.href),
    (route) => {
      thirdParty.push(route.request().url());
      return route.abort();
    },
  );
  await page.route(`${API}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const cors = {
      'access-control-allow-origin': req.headers()['origin'] ?? '*',
      'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      'access-control-allow-headers': 'accept, authorization, content-type, idempotency-key, x-vande-client',
      'access-control-expose-headers': 'x-request-id, retry-after, x-decided-at',
      'access-control-max-age': '600',
      vary: 'origin',
    };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const hit = table.find((r) => r.method === req.method() && r.re.test(url.pathname));
    if (!hit) {
      unmocked.push(`${req.method()} ${url.pathname}`);
      return route.fulfill({ status: 404, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ error: { code: 'not_found', message: 'not mocked' } }) });
    }
    const m = hit.re.exec(url.pathname) as RegExpExecArray;
    const params = Object.fromEntries(hit.names.map((n, i) => [n, decodeURIComponent(m[i + 1])]));
    let body: unknown = null;
    try {
      body = req.postDataJSON();
    } catch {
      /* no body */
    }
    calls.push({ key: hit.key, path: `${url.pathname}${url.search}`, body });
    const out = (await hit.h({ method: req.method(), path: url.pathname, params, query: url.searchParams, body })) as (Reply & { __reply?: true }) | unknown;
    const r: Reply = out && typeof out === 'object' && (out as { __reply?: true }).__reply ? (out as Reply) : { status: 200, json: out };
    return route.fulfill({ status: r.status, headers: { ...cors, 'content-type': 'application/json', ...(r.headers ?? {}) }, body: r.json === undefined ? '' : JSON.stringify(r.json) });
  });
  return {
    calls,
    unmocked,
    thirdParty,
    count: (key) => calls.filter((c) => c.key === key).length,
    last: (key) => calls.filter((c) => c.key === key).at(-1),
  };
}

// ---- helpers --------------------------------------------------------------------------------------------------------

/** A player who finished onboarding on this device (no server account yet), the fixed clock and a quiet window.open. */
async function setup(page: Page, opts: { player?: boolean; settings?: Record<string, unknown> } = {}) {
  await page.clock.setFixedTime(new Date(NOW));
  await page.addInitScript(
    ([player, settings]) => {
      if (player && !localStorage.getItem('vc:player')) localStorage.setItem('vc:player', JSON.stringify(player));
      // 18+ only: this player answered the neutral age screen (only the outcome is kept).
      if (player) localStorage.setItem('vc:age', 'adult');
      if (settings) localStorage.setItem('vc:settings', JSON.stringify(settings));
      const opened: string[] = [];
      (window as unknown as { __opened: string[] }).__opened = opened;
      window.open = ((href?: string | URL) => {
        opened.push(String(href ?? ''));
        return null;
      }) as typeof window.open;
    },
    [opts.player === false ? null : LOCAL_PLAYER, opts.settings ?? null] as const,
  );
}

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource|net::ERR_FAILED|status of 40\d/.test(m.text())) errors.push(m.text());
  });
  return errors;
}

async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).exclude('canvas').analyze();
  return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`);
}

async function noSideScroll(page: Page) {
  return page.evaluate(() => (document.scrollingElement as Element).scrollWidth <= window.innerWidth + 1);
}

async function check(page: Page) {
  expect(await axe(page)).toEqual([]);
  expect(await noSideScroll(page)).toBe(true);
}

// ---- Group Cup -------------------------------------------------------------------------------------------------------

test('a new Group Cup: name, size and pace, then a share that is never sent by itself', async ({ page }) => {
  const errors = watchErrors(page);
  await setup(page);
  const mock = await mockApi(page, {
    'POST /v1/cups': () => reply(201, { cupId: 'cupoffice01', inviteToken: 'invitetoken01', inviteUrl: 'https://vande.example/i/invitetoken01' }),
    'GET /v1/cups/:id': () => cupView({ status: 'gathering', members: [ME], fixtures: [], standings: [], inviteToken: 'invitetoken01', myTasks: [], lockedCount: null }),
    // The share cap is the server's: asked once, just before WhatsApp opens.
    'POST /v1/matches/:id/moments': () => ({ allowed: true }),
  });
  await page.goto('/cup/new');
  await expect(page.getByTestId('cup-new-screen')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('New Group Cup');
  // The account is created with the player's own name, look and language before anything else.
  await expect.poll(() => mock.count('POST /v1/auth/guest')).toBe(1);
  await expect.poll(() => mock.last('PATCH /v1/me')?.body).toMatchObject({ avatar: { seed: 'k3j2h4g5f6' }, kit: KIT, locale: 'en' });
  await check(page);

  await page.getByTestId('cup-name').fill('Office Cup');
  const size = page.getByTestId('cup-size');
  const before = Number(await size.textContent());
  await page.getByRole('button', { name: 'One player more' }).click();
  await expect(size).toHaveText(String(before + 1));
  await page.getByTestId('cup-pace').getByText('Weekend').click();
  await page.getByTestId('cup-create').click();
  await expect(page.getByTestId('cup-created')).toBeVisible();
  expect(mock.last('POST /v1/cups')?.body).toEqual({ name: 'Office Cup', maxPlayers: before + 1, pace: 'weekend' });
  // Nothing opened or sent until the player taps a channel; WhatsApp comes first.
  expect(await page.evaluate(() => (window as unknown as { __opened: string[] }).__opened)).toEqual([]);
  await check(page);
  await expect(page.getByTestId('invite-panel')).toBeVisible();
  await page.getByTestId('invite-whatsapp').click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __opened: string[] }).__opened.length)).toBe(1);
  const opened = await page.evaluate(() => (window as unknown as { __opened: string[] }).__opened);
  expect(opened[0]).toContain('wa.me');
  expect(decodeURIComponent(opened[0])).toContain('https://vande.example/i/invitetoken01');
  expect(decodeURIComponent(opened[0])).toContain('Swift Tiger invited you to Office Cup, a Group Cup');
  expect(mock.calls.filter((c) => c.key === 'POST /v1/matches/:id/moments').map((c) => c.body)).toEqual([{ moment: 'invite' }]);

  await page.getByTestId('cup-open').click();
  await expect(page).toHaveURL(/\/c\/cupoffice01$/);
  await expect(page.getByText('1 player so far, 3 needed')).toBeVisible();
  await check(page);
  expect(mock.unmocked).toEqual([]);
  expect(mock.thirdParty).toEqual([]);
  expect(errors).toEqual([]);
});

test('a cup in play: my next fixture, the honest lock count, the table with movement, and the room', async ({ page }) => {
  const errors = watchErrors(page);
  await setup(page);
  const mock = await mockApi(page, { 'GET /v1/cups/:id': () => cupView() });
  await page.goto('/c/cupoffice01');
  await expect(page.getByTestId('cup-screen')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Office Cup');
  await expect(page.getByTestId('cup-next')).toBeVisible();
  await expect(page.getByTestId('cup-lock-count')).toHaveText('1 of 4 overs locked');
  const table = page.getByTestId('cup-standings');
  await expect(table.getByText('Up 1 place')).toBeVisible();
  await expect(table.getByText('Down 1 place')).toBeVisible();
  // Results are only the revealed ones; nothing about who locked or when.
  await expect(page.getByText(/locked at|locked \d+ min/i)).toHaveCount(0);
  await check(page);
  await page.getByTestId('cup-room-link').click();
  await expect(page).toHaveURL(/\/r\/roomoffice01$/);
  expect(mock.thirdParty).toEqual([]);
  expect(errors).toEqual([]);
});

test('a cancelled cup and a cup still gathering say so plainly', async ({ page }) => {
  await setup(page);
  let view = cupView({ status: 'cancelled', fixtures: [], standings: [], myTasks: [], lockedCount: null, members: [ME, COBRA] });
  await mockApi(page, { 'GET /v1/cups/:id': () => view });
  await page.goto('/c/cupoffice01');
  await expect(page.getByText('This cup was cancelled')).toBeVisible();
  await check(page);
  view = cupView({ status: 'gathering', fixtures: [], standings: [], myTasks: [], lockedCount: null, members: [ME, COBRA, FALCON], inviteToken: 'invitetoken01' });
  await page.reload();
  await expect(page.getByTestId('cup-gathering')).toBeVisible();
  await expect(page.getByText('3 of 4 players have joined')).toBeVisible();
  await expect(page.getByTestId('invite-whatsapp')).toBeVisible();
  await check(page);
});

// ---- Cricket Room ----------------------------------------------------------------------------------------------------

test('the Cricket Room: a spoiler-safe card for every post, reactions, banter and settings', async ({ page }) => {
  const errors = watchErrors(page);
  await setup(page);
  let muted = false;
  const mock = await mockApi(page, {
    'GET /v1/rooms/:id': () => roomView({ muted }),
    'POST /v1/rooms/:id/react': () => ({ ok: true }),
    'POST /v1/rooms/:id/banter': () => ({ ok: true }),
    'POST /v1/rooms/:id/settings': ({ body }) => ((muted = Boolean(body.muted)), { ok: true }),
  });
  await page.goto('/r/roomoffice01');
  const feed = page.getByTestId('room-feed');
  await expect(feed).toBeVisible();
  await expect(feed.locator(':scope > li')).toHaveCount(12);
  // The scorecard stays covered until the reader asks for it.
  await expect(page.getByText('Calm Cobra won')).toHaveCount(0);
  await check(page);
  // A full touch target (axe target-size): the covered result is at least 44 px tall.
  const cover = await page.getByTestId('room-spoiler').boundingBox();
  expect(cover?.height ?? 0).toBeGreaterThanOrEqual(44);
  await page.getByTestId('room-spoiler').click();
  await expect(page.getByText('Calm Cobra won')).toBeVisible();
  // Free text is off on this server: no text box, only the predefined banter.
  await expect(page.getByTestId('room-text')).toHaveCount(0);
  await page.getByTestId('room-banter-open').click();
  await expect(page.getByTestId('room-banter')).toBeVisible();
  await check(page);
  await page.getByTestId('banter-banter.what_a_shot').click();
  await expect.poll(() => mock.last('POST /v1/rooms/:id/banter')?.body).toEqual({ phraseId: 'banter.what_a_shot' });
  await page.getByRole('button', { name: /^Clap, 2 reactions$/ }).click();
  await expect.poll(() => mock.last('POST /v1/rooms/:id/react')?.body).toEqual({ postId: 'p12', reaction: 'clap' });
  await page.getByTestId('room-settings-open').click();
  await expect(page.getByTestId('room-settings')).toBeVisible();
  await check(page);
  await page.getByTestId('room-mute').click();
  await expect.poll(() => mock.last('POST /v1/rooms/:id/settings')?.body).toEqual({ muted: true });
  await page.keyboard.press('Escape');
  await expect(page.getByText('This room is muted')).toBeVisible();
  // Report and block are offered for members' own words only, never on system cards.
  await expect(page.getByRole('button', { name: 'Report this post' })).toHaveCount(2);
  expect(mock.thirdParty).toEqual([]);
  expect(errors).toEqual([]);
});

test('free text appears only when the server enables it', async ({ page }) => {
  await setup(page);
  const mock = await mockApi(page, { 'GET /v1/rooms/:id': () => roomView({ freeText: true }), 'POST /v1/rooms/:id/text': () => ({ ok: true }) });
  await page.goto('/r/roomoffice01');
  const box = page.getByTestId('room-text');
  await expect(box).toBeVisible();
  await check(page);
  await box.fill('Well played everyone');
  await box.press('Enter');
  await expect.poll(() => mock.last('POST /v1/rooms/:id/text')?.body).toEqual({ text: 'Well played everyone' });
});

// ---- leaderboards ----------------------------------------------------------------------------------------------------

function board(scope: LeaderboardView['scope'], over: Partial<LeaderboardView> = {}): LeaderboardView {
  const names = ['Calm Cobra', 'Bold Falcon', 'Lucky Panther', 'Golden Eagle', 'Silent Leopard', 'Rapid Rhino', 'Brave Lion', 'Swift Hawk'];
  return {
    scope,
    day: '2026-10-26',
    // Real player id shapes, so each row offers "Report <name>".
    entries: names.map((alias, i) => ({ rank: i + 1, playerId: `p${String.fromCharCode(97 + i).repeat(26)}`, alias, avatar: { seed: `seed${i}abcd` }, score: 320 - i * 15, isMe: false })),
    me: { rank: 57, playerId: 'pme', alias: 'Swift Tiger', avatar: { seed: 'k3j2h4g5f6' }, score: 140, isMe: true },
    total: 1234,
    ...over,
  };
}

test('leaderboards: five boards, my pinned row, a city from the fixed list and private groups by code', async ({ page }) => {
  const errors = watchErrors(page);
  await setup(page);
  let profile: Profile = { ...PROFILE };
  const mock = await mockApi(page, {
    'GET /v1/me': () => profile,
    'PATCH /v1/me': ({ body }) => (profile = { ...profile, ...body }),
    'GET /v1/leaderboards/:scope': ({ params }) => (params.scope === 'friends' ? board('friends', { entries: [], me: null, total: 0 }) : board(params.scope as LeaderboardView['scope'])),
    'POST /v1/groups': ({ body }) => ((profile = { ...profile, groups: [{ groupId: 'grp000001', kind: body.kind, name: body.name }] }), { groupId: 'grp000001', code: 'ABCD-EFGH-JK' }),
    'POST /v1/report': () => ({ ok: true }),
  });
  await page.goto('/leaderboards/national');
  await expect(page.getByTestId('leaderboards-screen')).toBeVisible();
  for (const scope of ['national', 'city', 'college', 'company', 'friends']) await expect(page.getByTestId(`board-tab-${scope}`)).toBeVisible();
  await expect(page.getByTestId('board-entries').getByRole('listitem')).toHaveCount(8);
  await expect(page.getByTestId('board-me')).toBeVisible();
  await expect(page.getByLabel('You, rank 57')).toBeVisible();
  await expect(page.getByText('1,234 players ranked')).toBeVisible();
  await check(page);
  // Any other player can be reported from their row (never my own); the dialog passes axe too.
  await expect(page.getByTestId('board-me').getByRole('button', { name: /^Report/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Report Calm Cobra' }).click();
  const report = page.getByTestId('report-player');
  await expect(report).toBeVisible();
  await expect(report).toContainText('Calm Cobra is not told who reported them');
  await check(page);
  await report.getByLabel('Spam').check();
  await report.getByRole('button', { name: 'Send report' }).click();
  await expect.poll(() => mock.last('POST /v1/report')?.body).toEqual({ playerId: `p${'a'.repeat(26)}`, reason: 'spam' });
  await expect(page.getByText('Thanks. We will review it.')).toBeVisible();

  await page.getByTestId('board-tab-city').click();
  await expect(page.getByTestId('board-city')).toBeVisible();
  await expect(page.getByText('Pick it from the list. We never use your location.')).toBeVisible();
  await check(page);
  await page.getByTestId('board-city-select').selectOption('pune');
  await page.getByTestId('board-city-save').click();
  await expect.poll(() => mock.last('PATCH /v1/me')?.body).toEqual({ city: 'pune' });
  await expect(page.getByTestId('board-entries')).toBeVisible();

  await page.getByTestId('board-tab-college').click();
  await expect(page.getByTestId('board-group-college')).toBeVisible();
  await check(page);
  await page.getByLabel('Or create a college group').fill('Anna University');
  await page.getByRole('button', { name: 'Create the group' }).click();
  await expect(page.getByTestId('board-new-code')).toHaveText(/ABCD-EFGH-JK/);
  expect(mock.last('POST /v1/groups')?.body).toEqual({ kind: 'college', name: 'Anna University' });

  await page.getByTestId('board-tab-friends').click();
  await expect(page.getByText('No friends here yet')).toBeVisible();
  await check(page);
  expect(mock.thirdParty).toEqual([]);
  expect(errors).toEqual([]);
});

test('without a connection the boards say so honestly and offer a retry', async ({ page }) => {
  await setup(page);
  await page.route(`${API}/**`, (route) => route.abort('internetdisconnected'));
  await page.goto('/leaderboards/national');
  await expect(page.getByText('You are offline. This will refresh when you are back online.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  await check(page);
});

// ---- Daily Top 100 ---------------------------------------------------------------------------------------------------

test('the Top 100: frozen days only, today decided at midnight IST, the badge explained', async ({ page }) => {
  const errors = watchErrors(page);
  await setup(page);
  const mock = await mockApi(page, {
    'GET /v1/top100/:day': ({ params }) =>
      params.day === '2026-10-25'
        ? [{ ...entry(1, 'pb', 'Calm Cobra', 241.5), highlightCode: 'k7q2m9xa' }, entry(2, 'pc', 'Bold Falcon', 236), entry(3, 'pd', 'Lucky Panther', 220.25)]
        : reply(409, { error: { code: 'sealed', message: 'decided at 00:00 IST' } }, { 'x-decided-at': '2026-10-26T18:30:00.000Z' }),
  });
  await page.goto('/top100');
  await expect(page.getByTestId('top100-screen')).toBeVisible();
  await expect(page.getByTestId('top100-entries').getByRole('listitem')).toHaveCount(3);
  expect(mock.last('GET /v1/top100/:day')?.path).toBe('/v1/top100/2026-10-25');
  await expect(page.getByTestId('top100-today')).toContainText('decided at midnight IST, in ');
  // A live, consented highlight links its landing straight from the list.
  await expect(page.getByTestId('top100-entries').getByRole('button', { name: 'Watch the highlight' })).toHaveCount(1);
  await expect(page.getByText(/permanent YouTube Top 100 badge/).first()).toBeVisible();
  await check(page);
  await page.goto('/top100/2026-10-26');
  await expect(page.getByRole('heading', { name: 'Decided at midnight' })).toBeVisible();
  await expect(page.getByTestId('top100-entries')).toHaveCount(0);
  await check(page);
  expect(mock.thirdParty).toEqual([]);
  expect(errors).toEqual([]);
});

// ---- highlight consent -----------------------------------------------------------------------------------------------

function preview(j: HighlightJob, myDecision: HighlightPreview['myDecision'] = null): HighlightPreview {
  return { job: j, input: { jobId: j.jobId, log: GOLDEN, aliases: ['Swift Tiger', 'Calm Cobra'], locale: 'en', fixtureLabel: 'Friend Duel', day: j.day, ranks: [1, null], standings: null, cta: { url: 'https://vande.example/h/k7q2m9xa' } }, myDecision };
}

test('highlight consent: every status, the exact cut, 18+ and a visibility to grant, withdraw any time', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = watchErrors(page);
  await setup(page);
  let decided: HighlightPreview['myDecision'] = null;
  const jobs = [PENDING, job(`j${'q'.repeat(26)}`, 'scheduled', '2026-10-24'), job(`j${'r'.repeat(26)}`, 'upload_failed', '2026-10-23'), job(`j${'s'.repeat(26)}`, 'published', '2026-10-22'), job(`j${'t'.repeat(26)}`, 'consent_declined', '2026-10-21')];
  const mock = await mockApi(page, {
    'GET /v1/highlights/mine': () => jobs,
    'GET /v1/highlights/:jobId/preview': ({ params }) => {
      const j = jobs.find((x) => x.jobId === params.jobId) as HighlightJob;
      return preview(j, j.jobId === PENDING.jobId ? decided : j.status === 'consent_declined' ? 'declined' : 'granted');
    },
    'POST /v1/highlights/:jobId/consent': ({ body, params }) => {
      decided = body.decision;
      return { jobId: params.jobId, playerId: 'pme', decision: body.decision, adultConfirmed: body.adultConfirmed, approvedTitle: PENDING.title, approvedVisibility: body.visibility, decidedHour: '2026-10-26T09' };
    },
    'POST /v1/highlights/:jobId/withdraw': ({ params }) => {
      decided = 'withdrawn';
      return { jobId: params.jobId, playerId: 'pme', decision: 'withdrawn', adultConfirmed: false, approvedTitle: PENDING.title, approvedVisibility: 'unlisted', decidedHour: '2026-10-26T09' };
    },
  });
  await page.goto('/highlights');
  const list = page.getByTestId('highlight-jobs');
  await expect(list.getByRole('listitem')).toHaveCount(5);
  await check(page);

  // The failed upload and the declined one say what happens (the badge stays).
  await page.getByTestId(`highlight-open-${jobs[2].jobId}`).click();
  await expect(page.getByTestId('highlight-review')).toBeVisible();
  await check(page);
  await page.getByRole('button', { name: 'Back' }).first().click();
  await page.getByTestId(`highlight-open-${jobs[4].jobId}`).click();
  await expect(page.getByText(/Your Top 100 badge stays/)).toBeVisible();
  await expect(page.getByTestId('highlight-withdraw')).toHaveCount(0);
  await page.getByRole('button', { name: 'Back' }).first().click();

  await page.getByTestId(`highlight-open-${PENDING.jobId}`).click();
  await expect(page.getByTestId('highlight-review')).toBeVisible();
  // The moderated display names, never the match-time aliases inside the replay log.
  await expect(page.getByTestId('highlight-review').getByText('Swift Tiger', { exact: true })).toBeVisible();
  await expect(page.getByTestId('highlight-review').getByText('Golden A', { exact: true })).toHaveCount(0);
  await expect(page.getByText(PENDING.title)).toBeVisible();
  await check(page);
  // The exact cut from the official composer, inline.
  await page.getByTestId('highlight-watch').click();
  await expect(page.getByTestId('highlight-preview')).toBeVisible();
  await expect(page.getByTestId('highlight-play')).toBeVisible({ timeout: 60_000 });
  await check(page);

  const grant = page.getByTestId('highlight-grant');
  await expect(grant).toBeDisabled();
  await page.getByTestId('highlight-visibility').getByText('Unlisted').click();
  await page.getByTestId('highlight-adult').check();
  await expect(grant).toBeEnabled();
  await grant.click();
  await expect.poll(() => mock.last('POST /v1/highlights/:jobId/consent')?.body).toEqual({ decision: 'granted', adultConfirmed: true, visibility: 'unlisted' });
  await page.getByTestId('highlight-withdraw').click();
  const dialog = page.getByTestId('highlight-withdraw-dialog');
  await expect(dialog).toBeVisible();
  await check(page);
  await dialog.getByRole('button', { name: 'Withdraw' }).click();
  await expect.poll(() => mock.count('POST /v1/highlights/:jobId/withdraw')).toBe(1);
  expect(mock.thirdParty).toEqual([]);
  expect(errors).toEqual([]);
});

// ---- public highlight landing ----------------------------------------------------------------------------------------

const PUBLIC: HighlightPublic = {
  code: 'k7q2m9xa',
  day: '2026-10-25',
  title: 'Swift Tiger vs Calm Cobra · Daily Top 100 #1',
  youtubeVideoId: 'dQw4w9WgXcQ',
  visibility: 'public',
  matchId: 'golden-duel',
  participants: [
    { alias: 'Swift Tiger', avatar: { seed: 'golden-a' }, rank: 1 },
    { alias: 'Calm Cobra', avatar: { seed: 'golden-b' }, rank: null },
  ],
};

test('the highlight landing: one counted open, a link out to YouTube and no embed, the replay and a challenge', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = watchErrors(page);
  await setup(page);
  const mock = await mockApi(page, {
    'GET /v1/h/:code': () => PUBLIC,
    'GET /v1/h/:code/replay': () => GOLDEN,
  });
  await page.goto('/h/k7q2m9xa');
  await expect(page.getByTestId('landing-hero')).toBeVisible();
  const yt = page.getByTestId('landing-youtube');
  await expect(yt).toHaveAttribute('href', 'https://www.youtube.com/shorts/dQw4w9WgXcQ');
  await expect(yt).toHaveAttribute('target', '_blank');
  await expect(yt).toHaveAttribute('rel', /noopener/);
  await expect(page.locator('iframe, embed, object, video')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Can you beat them?' })).toBeVisible();
  await expect.poll(() => mock.calls.filter((c) => c.key === 'POST /v1/attribution' && c.body?.event === 'landing_open').length).toBe(1);
  expect(mock.last('POST /v1/attribution')?.body).toEqual({ code: 'k7q2m9xa', event: 'landing_open' });
  await check(page);

  await page.getByTestId('landing-replay').click();
  const reveal = page.getByTestId('reveal-screen');
  await expect(reveal).toBeVisible({ timeout: 60_000 });
  expect(mock.count('GET /v1/h/:code/replay')).toBe(1);
  // The replay shows the landing's moderated names, never the match-time aliases inside the log.
  await expect(reveal).toContainText('Swift Tiger');
  await expect(reveal).not.toContainText('Golden A');
  await reveal.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByTestId('landing-hero')).toBeVisible();
  // Still exactly one counted open, and nothing ever went to YouTube or anyone else.
  expect(mock.calls.filter((c) => c.key === 'POST /v1/attribution' && c.body?.event === 'landing_open')).toHaveLength(1);
  expect(mock.thirdParty).toEqual([]);
  expect(errors).toEqual([]);

  // "Challenge a friend" opens the duel screen with this highlight's code (it creates the duel there).
  await page.getByTestId('landing-challenge').click();
  await expect(page).toHaveURL(/\/duel\?a=k7q2m9xa$/);
});

test('a highlight that is gone says so', async ({ page }) => {
  await setup(page, { player: false });
  await mockApi(page, { 'GET /v1/h/:code': () => reply(404, { error: { code: 'not_found', message: 'no such highlight' } }) });
  await page.goto('/h/zzzz9999');
  await expect(page.getByTestId('landing-screen')).toBeVisible();
  await expect(page.getByTestId('landing-hero')).toHaveCount(0);
  await check(page);
});

// ---- profile ---------------------------------------------------------------------------------------------------------

test('the profile: alias, look and kit saved to the account and this device, badges, rating, city, 18+', async ({ page }) => {
  const errors = watchErrors(page);
  await setup(page);
  let profile: Profile = { ...PROFILE };
  const mock = await mockApi(page, { 'GET /v1/me': () => profile, 'PATCH /v1/me': ({ body }) => (profile = { ...profile, ...body }) });
  await page.goto('/me');
  await expect(page.getByTestId('profile-screen')).toBeVisible();
  const badges = page.getByTestId('profile-badges');
  await expect(badges.getByText('YouTube Top 100')).toBeVisible();
  await expect(page.getByText('Rating 1,235')).toBeVisible();
  // Google linking is not configured in this build: no button that cannot work.
  await expect(page.getByTestId('profile-google')).toHaveCount(0);
  await check(page);
  await page.getByTestId('profile-alias').fill('Calm Lion');
  await page.getByTestId('profile-save').click();
  await expect.poll(() => mock.calls.filter((c) => c.key === 'PATCH /v1/me' && c.body?.alias).at(-1)?.body).toMatchObject({ alias: 'Calm Lion' });
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('vc:player') ?? '{}').alias)).toBe('Calm Lion');
  await page.getByTestId('profile-city').selectOption('pune');
  await expect.poll(() => mock.last('PATCH /v1/me')?.body).toEqual({ city: 'pune' });
  await page.getByTestId('profile-adult').click();
  await expect.poll(() => mock.last('PATCH /v1/me')?.body).toEqual({ adultConfirmed: true });
  await check(page);
  expect(mock.thirdParty).toEqual([]);
  expect(errors).toEqual([]);
});

test('Hindi, high contrast and reduced motion at 360 px: the cup and the profile pass axe', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await setup(page, { settings: { locale: 'hi', highContrast: true } });
  await mockApi(page, { 'GET /v1/cups/:id': () => cupView() });
  await page.goto('/c/cupoffice01');
  await expect(page.getByTestId('cup-lock-count')).toHaveText('4 में से 1 ओवर लॉक');
  await check(page);
  await page.goto('/me');
  await expect(page.getByTestId('profile-screen')).toBeVisible();
  await check(page);
});
