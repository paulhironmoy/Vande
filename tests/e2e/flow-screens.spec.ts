import { mkdirSync } from 'node:fs';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { ADULT_YEAR, batInnings, FLOW_BASE, release } from './flow-helpers';

/**
 * Store and handoff screenshots of the real product (SCREENSHOTS=1 npm run test:flow): 1080×1920 portrait phones
 * (Play's 16:9 limit), real backend, real engine, two players. Skipped in normal runs.
 */
const OUT = 'release/store-screenshots';
test.skip(!process.env.SCREENSHOTS, 'set SCREENSHOTS=1 to capture store screenshots');

async function phone(browser: Browser) {
  const context = await browser.newContext({
    viewport: { width: 360, height: 640 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    baseURL: FLOW_BASE,
    serviceWorkers: 'block',
    colorScheme: 'dark',
  });
  // The store shows the 3D stage, even from a browser that draws WebGL in software ('auto' uses the 2D view there).
  await context.addInitScript(() => {
    try {
      if (!localStorage.getItem('vc:settings')) localStorage.setItem('vc:settings', JSON.stringify({ quality: 'standard' }));
    } catch {
      /* storage unavailable */
    }
  });
  return { context, page: await context.newPage() };
}

const shot = (page: Page, name: string) => page.screenshot({ path: `${OUT}/${name}.png` });

test('store screenshots: first run, training, invite, planner, batting, reveal, hub, Daily Six, room', async ({ browser }) => {
  test.setTimeout(10 * 60_000);
  mkdirSync(OUT, { recursive: true });
  const a = await phone(browser);
  const b = await phone(browser);

  // First run.
  await a.page.goto('/start');
  await a.page.getByTestId('age-year').fill(ADULT_YEAR);
  await a.page.getByTestId('age-continue').click();
  await a.page.getByTestId('age-confirm-yes').click();
  await a.page.getByTestId('onboarding-alias').fill('Swing King');
  await shot(a.page, '01-first-run');
  await a.page.getByTestId('onboarding-submit').click();
  await expect(a.page).toHaveURL(/\/train$/, { timeout: 20_000 });
  await a.page.waitForTimeout(2500);
  await shot(a.page, '02-training');

  // Friend Duel: invite, plan with the pitch tip and the over summary.
  await a.page.goto('/duel');
  await a.page.getByTestId('duel-pitch-hard').click();
  const created = a.page.waitForResponse((r) => r.url().endsWith('/v1/duels') && r.request().method() === 'POST');
  await a.page.getByTestId('duel-create').click();
  const duel = (await (await created).json()) as { matchId: string; inviteUrl: string };
  await expect(a.page.getByTestId('invite-panel')).toBeVisible();
  await shot(a.page, '03-invite');
  await a.page.getByTestId('invite-plan').click();
  await a.page.getByTestId('match-plan').click();
  await expect(a.page.getByTestId('planner-screen')).toBeVisible({ timeout: 20_000 });
  await shot(a.page, '04-planner');
  const holds = [760, 835, 905, 700, 870, 790, 945];
  for (let i = 0; i < 7; i++) {
    await a.page.getByTestId(`plan-ball-${i}`).click();
    await release(a.page, holds[i]);
  }
  await a.page.getByTestId('plan-lock').click();
  await expect(a.page.getByTestId('plan-lock-dialog')).toBeVisible();
  await shot(a.page, '05-lock-summary');
  await a.page.getByTestId('plan-lock-dialog-confirm').click();
  await expect(a.page.getByTestId('match-sealed')).toBeVisible({ timeout: 20_000 });
  await shot(a.page, '06-sealed');

  // The friend joins from the link in the browser and seals an over too.
  await b.page.goto(new URL(duel.inviteUrl).pathname);
  await b.page.getByTestId('invite-alias').fill('Night Owl');
  await b.page.getByTestId('invite-age-year').fill(ADULT_YEAR);
  await shot(b.page, '07-invite-landing');
  await b.page.getByTestId('invite-accept').click();
  await b.page.getByTestId('invite-age-confirm-yes').click();
  await b.page.getByTestId('match-plan').click({ timeout: 20_000 });
  await expect(b.page.getByTestId('planner-screen')).toBeVisible({ timeout: 20_000 });
  for (let i = 0; i < 7; i++) {
    await b.page.getByTestId(`plan-ball-${i}`).click();
    await release(b.page, holds[6 - i]);
  }
  await b.page.getByTestId('plan-lock').click();
  await b.page.getByTestId('plan-lock-dialog-confirm').click();

  // Batting: capture a live ball, then play the innings out.
  await a.page.goto(`/m/${duel.matchId}`);
  await a.page.getByTestId('match-bat-start').click({ timeout: 20_000 });
  const screen = a.page.getByTestId('batting-screen');
  await expect(screen).toHaveAttribute('data-phase', /ready|live/, { timeout: 30_000 });
  if ((await screen.getAttribute('data-phase')) === 'ready') await a.page.getByTestId('bat-next').click();
  await expect(screen).toHaveAttribute('data-phase', /runup|live/, { timeout: 30_000 });
  await a.page.waitForTimeout(600);
  await shot(a.page, '08-batting');
  await batInnings(a.page);
  await expect(a.page.getByTestId('match-awaiting-reveal')).toBeVisible({ timeout: 20_000 });
  await shot(a.page, '09-anticipation');

  await b.page.goto(`/m/${duel.matchId}`);
  await b.page.getByTestId('match-bat-start').click({ timeout: 20_000 });
  await batInnings(b.page);

  // The reveal, mid-replay and at the result.
  await a.page.goto(`/m/${duel.matchId}`);
  await expect(a.page.getByTestId('reveal-screen')).toBeVisible({ timeout: 30_000 });
  await a.page.waitForTimeout(7000);
  await shot(a.page, '10-reveal');
  await a.page.getByTestId('reveal-skip').click();
  await a.page.waitForTimeout(2500);
  await shot(a.page, '11-result');

  // The hub, Daily Six and the Cricket Room.
  await a.page.goto('/');
  await a.page.getByTestId('launch-skip').click({ timeout: 20_000 });
  await expect(a.page.getByTestId('home-screen')).toBeVisible({ timeout: 20_000 });
  await a.page.waitForTimeout(1500);
  await shot(a.page, '12-home');
  await a.page.goto('/daily');
  await a.page.getByTestId('daily-start').click({ timeout: 20_000 });
  await batInnings(a.page);
  await expect(a.page.getByTestId('daily-result-screen')).toBeVisible({ timeout: 30_000 });
  await a.page.waitForTimeout(1500);
  await shot(a.page, '13-daily-result');

  await a.context.close();
  await b.context.close();
});
