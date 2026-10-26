/**
 * No save-scumming: a reload (or a kill) with a ball in flight resumes that ball as a leave, never a fresh ball, and
 * the innings carries on from the next ball of the same fixed over. Going to the background mid-delivery (Android's
 * pause) does the same, then waits for the player.
 */
import { expect, test } from '@playwright/test';
import { GPU_ARGS, block, configure, delivered, queue, startRandom, state, waitFor, whileInFlight } from './practice-helpers';

test.use({ viewport: { width: 1366, height: 768 }, ...GPU_ARGS });

test('a reload mid-delivery gives the leave result, never a fresh ball', async ({ page }) => {
  test.setTimeout(240_000);
  // Seed chosen so the first ball, left alone, misses the stumps (both outcomes are handled below either way).
  // Slow motion: the ball stays in flight long enough to be sure the reload lands inside it.
  await configure(page, { tier: 'below', timeScale: 0.25, seed: 'e2e-resume' }, { guidedDone: true });
  await page.goto('/practice');
  await expect(page.getByTestId('practice-menu')).toBeVisible();
  await startRandom(page);
  const plan = (await state(page)).over?.variations;
  // After the reload the rest of the over can run fast (a later init script wins for the next page load).
  await configure(page, { tier: 'below', timeScale: 6, seed: 'e2e-resume' });
  // The first ball has left the bowler's hand (saved as in flight) when the app is reloaded.
  await whileInFlight(page, 'reload');
  const after = await state(page);
  expect(after.inFlight).toBeNull();
  expect(after.balls).toBe(1);
  expect(after.over?.variations).toEqual(plan);
  if (after.status === 'out') {
    // The ball would have hit the stumps: leaving it bowled the batter, exactly as a left ball would.
    await expect(page.getByTestId('practice-out-summary')).toBeVisible();
    await expect(page.getByTestId('practice-why')).toContainText('You played no shot.');
    return;
  }
  await expect(page.getByTestId('practice-menu')).toBeVisible();
  await expect(page.getByTestId('practice-resume-card')).toBeVisible();
  await expect(page.getByTestId('practice-resumed-leave')).toHaveText('The ball in play when the app closed counted as a leave.');

  // Continuing bowls ball 2 of the same over; the resumed ball is never bowled again.
  await queue(page, ...Array.from({ length: 5 }, () => block()));
  await page.getByTestId('practice-continue').click();
  await waitFor(page, ['over_summary', 'out'], 180_000);
  expect((await delivered(page)).innings).toBe(5);
  const end = await state(page);
  expect(end.over?.variations).toEqual(plan);
  expect(end).toMatchObject({ status: 'over_complete', balls: 6 });
});

test('going to the background mid-delivery resolves it as a leave and pauses', async ({ page }) => {
  test.setTimeout(180_000);
  await configure(page, { tier: 'below', timeScale: 0.5, seed: 'e2e-replay' }, { guidedDone: true });
  await page.goto('/practice');
  await startRandom(page);
  await whileInFlight(page, 'background');
  await waitFor(page, ['paused'], 60_000);
  await expect(page.getByTestId('practice-paused')).toBeVisible();
  const st = await state(page);
  expect(st.last?.swing).toBeNull();
  expect(st.notice).toBe('interrupted');
  expect(st).toMatchObject({ balls: 1, status: 'batting' });
  await page.getByTestId('practice-resume').click();
  await waitFor(page, ['runup', 'live', 'playing', 'coaching'], 30_000);
});
