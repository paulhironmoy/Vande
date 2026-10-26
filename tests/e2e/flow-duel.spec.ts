import { expect, test } from '@playwright/test';
import { ADULT_YEAR, batInnings, newPhone, onboard, planAndLock, resultLine } from './flow-helpers';

/**
 * The core loop across every workstream: invite → lock → bat asynchronously → anticipation → reveal → rematch, with
 * two players on two phones against the real backend and engine. Nothing about the result may show before the reveal.
 */
test('Friend Duel end to end: invite in the browser, both overs sealed, both innings, the same verified reveal', async ({ browser }) => {
  test.setTimeout(8 * 60_000);
  const a = await newPhone(browser);
  const b = await newPhone(browser);

  // A: first run, then a new duel on a hard pitch.
  await onboard(a.page, 'Swift Tiger');
  await a.page.goto('/duel');
  await expect(a.page.getByTestId('duel-new-screen')).toBeVisible();
  await a.page.getByTestId('duel-pitch-hard').click();
  const created = a.page.waitForResponse((r) => r.url().endsWith('/v1/duels') && r.request().method() === 'POST');
  await a.page.getByTestId('duel-create').click();
  const duel = (await (await created).json()) as { matchId: string; inviteUrl: string };
  expect(duel.inviteUrl).toMatch(/^http:\/\/localhost:4174\/i\//);
  await expect(a.page.getByTestId('invite-panel')).toBeVisible();
  await expect(a.page.getByTestId('invite-whatsapp')).toBeVisible();

  // A seals an over before the friend has even joined.
  await a.page.getByTestId('invite-plan').click();
  await expect(a.page.getByTestId('match-phase')).toHaveAttribute('data-phase', 'awaiting_opponent');
  await a.page.getByTestId('match-plan').click();
  await planAndLock(a.page);

  // B: opens the link in the browser (no install, no account yet), picks an alias and accepts.
  await b.page.goto(new URL(duel.inviteUrl).pathname);
  // The real invite link format is routed directly, with no Not found flash or stray history entry.
  await expect(b.page.getByTestId('not-found-screen')).toHaveCount(0);
  await expect(b.page.getByTestId('invite-preview')).toBeVisible();
  await expect(b.page.getByTestId('invite-preview')).toContainText('Swift Tiger');
  await b.page.getByTestId('invite-alias').fill('Calm Cobra');
  await b.page.getByTestId('invite-age-year').fill(ADULT_YEAR);
  await b.page.getByTestId('invite-accept').click();
  await b.page.getByTestId('invite-age-confirm-yes').click();
  await expect(b.page).toHaveURL(new RegExp(`/m/${duel.matchId}$`), { timeout: 20_000 });
  await expect(b.page.getByTestId('match-phase')).toHaveAttribute('data-phase', 'planning');
  await b.page.getByTestId('match-plan').click();
  await planAndLock(b.page);

  // Both sealed: A bats first, then waits honestly with nothing about the result on screen.
  await a.page.goto(`/m/${duel.matchId}`);
  await expect(a.page.getByTestId('match-bat-card')).toBeVisible({ timeout: 20_000 });
  await a.page.getByTestId('match-bat-start').click();
  expect(await batInnings(a.page)).toBeGreaterThanOrEqual(6);
  await expect(a.page.getByTestId('match-awaiting-reveal')).toBeVisible({ timeout: 20_000 });
  await expect(a.page.getByTestId('reveal-screen')).toHaveCount(0);

  // B bats; the reveal follows for both.
  await b.page.goto(`/m/${duel.matchId}`);
  await b.page.getByTestId('match-bat-start').click();
  expect(await batInnings(b.page)).toBeGreaterThanOrEqual(6);
  await expect(b.page.getByTestId('reveal-screen')).toBeVisible({ timeout: 30_000 });
  await a.page.goto(`/m/${duel.matchId}`);
  await expect(a.page.getByTestId('reveal-screen')).toBeVisible({ timeout: 30_000 });

  // Same result on both phones, and a rematch on offer.
  for (const p of [a.page, b.page]) {
    await p.getByTestId('reveal-skip').click();
    await expect(p.getByTestId('reveal-rematch')).toBeVisible();
  }
  const [ra, rb] = [await resultLine(a.page), await resultLine(b.page)];
  expect(ra.length).toBeGreaterThan(0);
  expect(ra).toBe(rb);

  await a.context.close();
  await b.context.close();
});
