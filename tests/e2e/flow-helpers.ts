/**
 * Helpers for the cross-workstream flow suite (FLOW=1, playwright.config.ts): real app build, real backend in process,
 * real engine. Only stable data-testids from docs/VISUAL_SYSTEM.md §8 are used.
 */
import { devices, expect, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';

export const FLOW_BASE = 'http://localhost:4174';
/** A year of birth comfortably over 18 for the neutral age screen. */
export const ADULT_YEAR = String(new Date().getFullYear() - 30);

export async function newPhone(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ ...devices['Pixel 7'], baseURL: FLOW_BASE, serviceWorkers: 'block', colorScheme: 'dark' });
  const page = await context.newPage();
  return { context, page };
}

/** First run: choose an alias and finish onboarding (online, so the guest account is created on the spot). */
export async function onboard(page: Page, alias: string): Promise<void> {
  await page.goto('/start');
  // The neutral age screen comes first (18+ policy): an adult year of birth.
  await expect(page.getByTestId('age-screen')).toBeVisible();
  await page.getByTestId('age-year').fill(ADULT_YEAR);
  await page.getByTestId('age-continue').click();
  await page.getByTestId('age-confirm-yes').click();
  await expect(page.getByTestId('onboarding-screen')).toBeVisible();
  await page.getByTestId('onboarding-alias').fill(alias);
  await page.getByTestId('onboarding-submit').click();
  // Onboarding hands over to Training once the player exists.
  await expect(page).toHaveURL(/\/train$/, { timeout: 20_000 });
}

/** Press and hold the release meter for about `holdMs`, moving a little like a finger does, then let go. */
export async function release(page: Page, holdMs: number): Promise<void> {
  const meter = page.getByTestId('execution-meter');
  await expect(meter).toBeVisible();
  await expect(meter).not.toHaveAttribute('data-disabled', 'true');
  await meter.scrollIntoViewIfNeeded();
  const box = await meter.boundingBox();
  if (!box) throw new Error('execution meter has no box');
  const x = box.x + box.width * 0.5;
  const y = box.y + box.height * 0.55;
  await page.mouse.move(x, y);
  await page.mouse.down();
  const steps = 7;
  for (let i = 1; i <= steps; i++) {
    await page.waitForTimeout(holdMs / steps);
    await page.mouse.move(x + i * 0.9, y - i * 0.6);
  }
  await page.mouse.up();
}

/** Plans the default over with one human-like release per ball (varied holds), then seals it. */
export async function planAndLock(page: Page): Promise<void> {
  await expect(page.getByTestId('planner-screen')).toBeVisible({ timeout: 20_000 });
  const holds = [760, 835, 905, 700, 870, 790, 945];
  for (let i = 0; i < 7; i++) {
    const tab = page.getByTestId(`plan-ball-${i}`);
    await tab.click();
    await release(page, holds[i]);
    await expect(tab).toHaveAttribute('data-done', 'true');
  }
  await page.getByTestId('plan-lock').click();
  await page.getByTestId('plan-lock-dialog-confirm').click();
  // Sealed; when the opponent had already locked, the innings is ready straight away.
  await expect(page.getByTestId('match-sealed').or(page.getByTestId('match-bat-card'))).toBeVisible({ timeout: 20_000 });
}

/** Bats a whole innings: plays every ball as it comes and taps while it is live. */
export async function batInnings(page: Page): Promise<number> {
  const screen = page.getByTestId('batting-screen');
  await expect(screen).toBeVisible({ timeout: 20_000 });
  let balls = 0;
  for (let guard = 0; guard < 14; guard++) {
    await expect(screen).toHaveAttribute('data-phase', /ready|feedback|live|done|error/, { timeout: 30_000 });
    const phase = await screen.getAttribute('data-phase');
    if (phase === 'done') break;
    if (phase === 'error') {
      await page.getByTestId('bat-retry').click();
      continue;
    }
    if (phase === 'ready' || phase === 'feedback') {
      await page.getByTestId('bat-next').click();
      await expect(screen).toHaveAttribute('data-phase', /live|done|error/, { timeout: 30_000 });
      if ((await screen.getAttribute('data-phase')) !== 'live') continue;
    }
    // A short, human reaction before the tap (the timing grade does not matter here). A fast ball may already be
    // past the bat by then; the screen then plays it as a leave, which is fine for these flows.
    await page.waitForTimeout(120 + ((guard * 37) % 150));
    await page.getByTestId('bat-hit').click({ timeout: 3_000 }).catch(() => undefined);
    balls++;
    await expect(screen).toHaveAttribute('data-phase', /feedback|done|error/, { timeout: 30_000 });
  }
  await expect(page.getByTestId('bat-done')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('bat-done').click();
  return balls;
}

/** The result line of a reveal ("X won by N runs", a tie...), for comparing what two players see. */
export async function resultLine(page: Page): Promise<string> {
  const text = await page.getByTestId('reveal-screen').innerText();
  const line = text.split('\n').find((l) => /won|tie|tied|jeet|draw/i.test(l));
  return (line ?? '').trim();
}

// ---- server clock (cup and deadline flows) ---------------------------------------------------------------------------

export const FLOW_API = 'http://127.0.0.1:8787';

/** The local backend's current time (its clock only moves forward: real time plus every advance). */
export async function serverNow(request: APIRequestContext): Promise<number> {
  const r = await request.post(`${FLOW_API}/__dev/advance?ms=0`);
  expect(r.ok()).toBe(true);
  return Date.parse(((await r.json()) as { now: string }).now);
}

/**
 * Moves the local backend's clock to `target`, firing every alarm on the way in time order; resolves with the server
 * time reached. The phones keep real time (a fake browser clock starves the 3D renderer's frame loop), so they run
 * behind the server: screens must take the round, tasks and phases from the server, with the clock only for countdowns.
 */
export async function advanceServerTo(request: APIRequestContext, target: number): Promise<number> {
  const ms = Math.max(0, Math.ceil(target - (await serverNow(request))));
  const r = await request.post(`${FLOW_API}/__dev/advance?ms=${ms}`);
  expect(r.ok()).toBe(true);
  return Date.parse(((await r.json()) as { now: string }).now);
}
