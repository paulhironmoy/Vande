/**
 * The real device-check path (no fixed tier: a short real benchmark), as a first-time player meets it: Play tapped the
 * moment the setup screen appears, while the stage is still being built and measured, the first-run teaching on, then
 * two complete overs. Nothing may strand (no endless wait, no calm error on a working device), no ball may be released
 * before the stage is ready, and the timing help is one value per over whatever the device does mid-over (F-026,
 * RK-F04, F-006). The fixed-tier journeys cannot see this path; this one runs it with the software and the hardware
 * renderer alike.
 */
import { expect, test, type Page } from '@playwright/test';
import {
  GPU_ARGS,
  block,
  openPractice,
  perfect,
  queue,
  seen,
  state,
  toOverSummary,
  waitFor,
  type HookState,
} from './practice-helpers';

test.use({ ...GPU_ARGS, viewport: { width: 915, height: 412 }, hasTouch: true });

/** Bats an over (six swings queued, autoNext on) to its summary; returns the state at its first dead ball. */
async function batOver(page: Page): Promise<HookState> {
  await queue(page, perfect(10), block(), perfect(-25), block(), perfect(35), block());
  // Read inside the page the moment the first ball is dead (it continues by itself soon after).
  const first = await page.evaluate(async () => {
    const api = (
      window as unknown as { __vandePractice: { waitFor(x: string[], t: number): Promise<boolean>; state(): unknown } }
    ).__vandePractice;
    await api.waitFor(['dead'], 240_000);
    return api.state() as HookState;
  });
  await toOverSummary(page, 300_000);
  return first;
}

test('a first session on the real device check: Play at once, the demonstration, two complete overs', async ({
  page,
}) => {
  test.setTimeout(600_000);
  await openPractice(
    page,
    { benchmarkMs: 1400, timeScale: 2, autoNext: true, seed: 'e2e-device-check' },
    { teach: true },
  );
  await page.getByTestId('practice-random').click();
  await expect(page.getByTestId('practice-setup')).toBeVisible({ timeout: 45_000 });
  // At once: the device check has not finished.
  expect((await state(page)).stageReady).toBe(false);
  await page.getByTestId('practice-play-start').click();
  // The first-run demonstration comes first, on a stage that is ready; then the first ball.
  await waitFor(page, ['intro'], 120_000);
  expect((await state(page)).stageReady).toBe(true);
  // Then the first-ball lesson waits for the player (src/practice/ui/lesson): ball 1 starts when they choose to bowl.
  await waitFor(page, ['lesson'], 120_000);
  await page.getByTestId('lesson-bowl').click();
  await batOver(page);

  let st = await state(page);
  expect(st).toMatchObject({ screen: 'over_summary', overs: 1, balls: 6, error: null, unreadyBowls: 0 });
  await page.getByTestId('practice-next-over').click();
  await expect(page.getByTestId('practice-setup')).toBeVisible({ timeout: 45_000 });
  await page.getByTestId('practice-play-start').click();
  const secondOver = await batOver(page);

  st = await state(page);
  expect(st).toMatchObject({ screen: 'over_summary', overs: 2, balls: 12, error: null, unreadyBowls: 0 });
  expect(st.tolerances.map((o) => o.length)).toEqual([6, 6]);
  for (const over of st.tolerances) expect(new Set(over).size, `one timing help per over: ${over.join(', ')}`).toBe(1);
  // Never the calm error, never a pause the player did not ask for.
  expect(await seen(page, 'practice-error')).toBeNull();
  expect(await seen(page, 'practice-paused')).toBeNull();
  // A change of help between the overs is said (never silently).
  if (st.tolerances[1][0] !== st.tolerances[0][0]) expect(secondOver.notice).toMatch(/^help_/);
});
