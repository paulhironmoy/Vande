import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';
import type { CupView } from '../../src/contracts';
import { ADULT_YEAR, advanceServerTo, batInnings, newPhone, onboard, planAndLock, serverNow } from './flow-helpers';

/**
 * A Group Cup across every workstream, three phones against the real backend and engine: creation and invites in the
 * browser, the start on the clock, honest lock counts, spoiler-safe room cards, the round reveal and the table, Auto
 * Over and Auto XI for players who miss their deadlines, and the final through to the complete cup. The backend clock
 * jumps through the cup's windows with the local server's /__dev/advance; the phones keep real time, so everything the
 * test checks comes from the server's state, as it must on a phone whose clock is wrong.
 */

// A step that cannot happen fails within seconds instead of using up the whole test.
test.use({ actionTimeout: 30_000, navigationTimeout: 30_000 });

const HOUR = 3_600_000;
const MINUTE = 60_000;
/** Past any activity jitter the server keeps on lock and innings flags, so the next step never depends on luck. */
const SETTLE_MS = 11 * MINUTE;

interface Phone {
  context: BrowserContext;
  page: Page;
  alias: string;
}

async function phone(browser: Browser, alias: string): Promise<Phone> {
  return { ...(await newPhone(browser)), alias };
}

/** Opens the cup screen; resolves with the CupView it loaded. */
async function openCup(p: Phone, cupId: string): Promise<CupView> {
  const loaded = p.page.waitForResponse((r) => new URL(r.url()).pathname === `/v1/cups/${cupId}` && r.request().method() === 'GET' && r.ok());
  await p.page.goto(`/c/${cupId}`);
  const view = (await (await loaded).json()) as CupView;
  await expect(p.page.getByTestId('cup-screen')).toBeVisible();
  return view;
}

/** "My next fixture" → the match route → plan and seal the over. */
async function lockFromCup(p: Phone, cupId: string): Promise<void> {
  await openCup(p, cupId);
  await expect(p.page.getByTestId('cup-next')).toContainText('Lock your over');
  await p.page.getByTestId('cup-next-open').click();
  await expect(p.page).toHaveURL(/\/m\/[^/]+$/);
  await expect(p.page.getByTestId('match-plan')).toBeVisible({ timeout: 20_000 });
  await p.page.getByTestId('match-plan').click();
  await planAndLock(p.page);
}

/** "My next fixture" → the match route → bat the innings; the cup's reveal time is still ahead. */
async function batFromCup(p: Phone, cupId: string): Promise<void> {
  await openCup(p, cupId);
  await expect(p.page.getByTestId('cup-next')).toContainText('Your innings is open');
  await p.page.getByTestId('cup-next-open').click();
  // The cup said "bat now", so the match must agree: the opponent's lock is visible to this player.
  await expect(p.page.getByTestId('match-bat-start')).toBeVisible({ timeout: 20_000 });
  await p.page.getByTestId('match-bat-start').click();
  expect(await batInnings(p.page)).toBeGreaterThanOrEqual(1);
  await expect(p.page.getByTestId('match-awaiting-reveal')).toBeVisible({ timeout: 20_000 });
  await expect(p.page.getByTestId('reveal-screen')).toHaveCount(0);
}

const fixtureOf = (v: CupView, round: number | 'final') => {
  const f = v.fixtures.find((x) => x.round === round);
  if (!f) throw new Error(`no fixture in round ${round}`);
  return f;
};

async function settle(request: APIRequestContext): Promise<void> {
  await advanceServerTo(request, (await serverNow(request)) + SETTLE_MS);
}

test('Group Cup end to end: invites in the browser, honest lock counts, reveals, Auto for missed deadlines, the final', async ({ browser, request }) => {
  test.setTimeout(12 * 60_000);
  const a = await phone(browser, 'Swift Tiger');
  const b = await phone(browser, 'Calm Cobra');
  const c = await phone(browser, 'Bold Falcon');
  const all = [a, b, c];

  // 1. A creates a sprint cup for three; B and C join from the link in the browser and choose their names there.
  await onboard(a.page, a.alias);
  await a.page.goto('/cup/new');
  await expect(a.page.getByTestId('cup-new-screen')).toBeVisible();
  await a.page.getByTestId('cup-name').fill('Flow Cup');
  const size = a.page.getByTestId('cup-size');
  while (Number(await size.textContent()) > 3) await a.page.getByRole('button', { name: 'One player fewer' }).click();
  await expect(size).toHaveText('3');
  await a.page.getByTestId('cup-pace').getByText('Sprint').click();
  const created = a.page.waitForResponse((r) => new URL(r.url()).pathname === '/v1/cups' && r.request().method() === 'POST');
  await a.page.getByTestId('cup-create').click();
  const cup = (await (await created).json()) as { cupId: string; inviteUrl: string };
  expect(cup.inviteUrl).toMatch(/^http:\/\/localhost:4174\/i\//);
  await expect(a.page.getByTestId('cup-created')).toBeVisible();
  await expect(a.page.getByTestId('invite-whatsapp')).toBeVisible();

  for (const p of [b, c]) {
    await p.page.goto(new URL(cup.inviteUrl).pathname);
    await expect(p.page.getByTestId('invite-preview')).toContainText('Flow Cup');
    await p.page.getByTestId('invite-alias').fill(p.alias);
    // 18+ only: the invite's quick path asks the neutral age question first.
    await p.page.getByTestId('invite-age-year').fill(ADULT_YEAR);
    await p.page.getByTestId('invite-accept').click();
    await p.page.getByTestId('invite-age-confirm-yes').click();
    await expect(p.page).toHaveURL(new RegExp(`/c/${cup.cupId}$`), { timeout: 20_000 });
  }
  let view = await openCup(a, cup.cupId);
  expect(view.status).toBe('gathering');
  expect(view.members.map((m) => m.alias)).toEqual([a.alias, b.alias, c.alias]);
  await expect(a.page.getByTestId('cup-gathering')).toContainText('3 of 3 players have joined');

  // 2. The gather window ends: the cup starts by itself and round 1 opens.
  const startAt = Date.parse(view.schedule.rounds[0].lockBy) - HOUR;
  await advanceServerTo(request, startAt + 30_000);
  view = await openCup(a, cup.cupId);
  expect(view.status).toBe('group_stage');
  expect(view.schedule.rounds).toHaveLength(3);
  const aliasOf = new Map(view.members.map((m) => [m.id, m.alias]));
  const phoneOf = (playerId: string) => all.find((p) => p.alias === aliasOf.get(playerId)) as Phone;
  const rounds = view.schedule.rounds;

  // 3. Round 1: the two players lock from "my next fixture"; the third player's cup screen counts the locks and
  // never says who locked or when.
  const r1 = fixtureOf(view, 1);
  const [home1, away1] = [phoneOf(r1.home), phoneOf(r1.away)];
  const observer = all.find((p) => p !== home1 && p !== away1) as Phone;
  const lockCountIs = async (expected: string) => {
    await openCup(observer, cup.cupId);
    await expect(observer.page.getByTestId('cup-lock-count')).toHaveText(expected);
    const round = await observer.page.getByTestId('cup-current').innerText();
    for (const p of [home1, away1]) expect(round).not.toContain(p.alias);
    expect(round).not.toMatch(/locked (at|\d)|\bago\b/i);
  };
  await lockCountIs('0 of 2 overs locked');
  await lockFromCup(home1, cup.cupId);
  await settle(request);
  await lockCountIs('1 of 2 overs locked');
  await lockFromCup(away1, cup.cupId);
  await settle(request);
  await lockCountIs('2 of 2 overs locked');
  for (const p of [home1, away1]) await batFromCup(p, cup.cupId);
  // Both innings are in, but nothing about the result shows before the round's reveal time, and a fixture the observer
  // is not in never shows its progress (only scheduled, planning or revealed).
  view = await openCup(observer, cup.cupId);
  expect(view.standings.every((r) => r.played === 0)).toBe(true);
  expect(fixtureOf(view, 1).status).toBe('planning');
  // The players themselves see their own fixture waiting for the reveal.
  expect(fixtureOf(await openCup(home1, cup.cupId), 1).status).toBe('awaiting_reveal');

  // 4. The round reveals at its reveal time: the table moves and the room has spoiler-safe cards.
  await advanceServerTo(request, Date.parse(rounds[0].revealAt) + 30_000);
  view = await openCup(observer, cup.cupId);
  expect(fixtureOf(view, 1).status).toBe('revealed');
  expect(view.standings.filter((r) => r.played === 1).map((r) => r.alias).sort()).toEqual([home1.alias, away1.alias].sort());
  await expect(observer.page.getByTestId('cup-standings').locator('tbody tr')).toHaveCount(3);
  await observer.page.getByTestId('cup-room-link').click();
  await expect(observer.page.getByTestId('room-feed')).toBeVisible();
  for (const kind of ['fixture', 'lock_status', 'reveal_ready', 'scorecard', 'standings']) await expect(observer.page.locator(`[data-kind="${kind}"]`).first()).toBeVisible();
  await expect(observer.page.locator('[data-kind="lock_status"]').first()).toContainText('2 of 2 overs locked');
  const scorecard = observer.page.locator('[data-kind="scorecard"]').first();
  await expect(scorecard.getByTestId('room-spoiler')).toBeVisible();
  await expect(scorecard).not.toContainText(/ won|A tie/);
  await scorecard.getByTestId('room-spoiler').click();
  await expect(scorecard).toContainText(/ won|A tie/);

  // 5. Round 2: one player locks and bats; the other misses both deadlines. Auto Over seals for them at the lock
  // deadline, Auto XI bats for them at the batting deadline, and the round reveals on time all the same.
  view = await openCup(a, cup.cupId);
  const r2 = fixtureOf(view, 2);
  const [play2, miss2] = [phoneOf(r2.home), phoneOf(r2.away)];
  await lockFromCup(play2, cup.cupId);
  await advanceServerTo(request, Date.parse(rounds[1].lockBy) + 30_000 + SETTLE_MS);
  await batFromCup(play2, cup.cupId);
  await advanceServerTo(request, Date.parse(rounds[1].revealAt) + 30_000);
  view = await openCup(miss2, cup.cupId);
  expect(fixtureOf(view, 2).status).toBe('revealed');
  expect(fixtureOf(view, 2).auto).toEqual([false, true]);
  await expect(miss2.page.getByText(`Auto played for ${miss2.alias}`)).toBeVisible();
  const missId = r2.away;
  const playedBy = (id: string) => view.fixtures.filter((f) => f.status === 'revealed' && (f.home === id || f.away === id)).length;
  // The missed match counts in the table like any other: the cup never waits for anyone.
  expect(view.standings.find((r) => r.playerId === missId)?.played).toBe(playedBy(missId));

  // Round 3: nobody turns up at all; the cup still finishes its group stage on time and sets up the final.
  await advanceServerTo(request, Date.parse(rounds[2].revealAt) + 30_000);
  view = await openCup(a, cup.cupId);
  expect(fixtureOf(view, 3).status).toBe('revealed');
  expect(fixtureOf(view, 3).auto).toEqual([true, true]);
  expect(view.status).toBe('final');
  expect(view.standings.every((r) => r.played === 2)).toBe(true);

  // 6. The final: the top two of the table, both playing it for real, then the complete cup for everyone.
  const fin = fixtureOf(view, 'final');
  expect([fin.home, fin.away]).toEqual(view.standings.slice(0, 2).map((r) => r.playerId));
  const finalists = [phoneOf(fin.home), phoneOf(fin.away)];
  const finalAt = view.schedule.final;
  expect(finalAt).not.toBeNull();
  for (const p of finalists) {
    await openCup(p, cup.cupId);
    await expect(p.page.getByTestId('cup-next')).toContainText('You are in the final');
  }
  for (const p of finalists) await lockFromCup(p, cup.cupId);
  await settle(request);
  for (const p of finalists) await batFromCup(p, cup.cupId);
  await advanceServerTo(request, Date.parse((finalAt as NonNullable<CupView['schedule']['final']>).revealAt) + 30_000);
  for (const p of all) {
    view = await openCup(p, cup.cupId);
    expect(view.status).toBe('complete');
    await expect(p.page.getByTestId('cup-complete')).toContainText('Flow Cup is complete');
  }
  // The champion is a finalist, covered on the cup screen until asked for, and named in the room.
  const champion = view.winner;
  expect(champion).not.toBeNull();
  expect([fin.home, fin.away]).toContain(champion?.id);
  await openCup(a, cup.cupId);
  await expect(a.page.getByTestId('cup-complete')).not.toContainText(champion?.alias ?? '-');
  await a.page.getByTestId('cup-champion-show').click();
  await expect(a.page.getByTestId('cup-champion')).toContainText(champion?.alias ?? '-');
  await a.page.getByTestId('cup-room-link').click();
  await expect(a.page.locator('[data-kind="achievement"]').first()).toContainText(`${champion?.alias} earned Cup winner`);
  // The final's replay, from the complete cup.
  await openCup(finalists[0], cup.cupId);
  await finalists[0].page.getByTestId('cup-complete').getByRole('button', { name: 'Watch the final' }).click();
  await expect(finalists[0].page.getByTestId('reveal-screen')).toBeVisible({ timeout: 30_000 });

  for (const p of all) await p.context.close();
});
