/**
 * No save-scumming: a reload (or a kill) with a ball in flight resumes that ball as a leave, never a fresh ball, and
 * the innings carries on from the next ball of the same fixed over ("Your innings is safe"). Going to the background
 * mid-delivery (Android's pause) does the same, then waits for the player.
 */
import { expect, test } from '@playwright/test';
import { GPU_ARGS, block, buildBall, configure, delivered, openPractice, playFromSetup, queue, startRandom, state, waitFor, whileInFlight } from './practice-helpers';

test.use({ viewport: { width: 1366, height: 768 }, ...GPU_ARGS });

test('a reload mid-delivery gives the leave result, never a fresh ball', async ({ page }) => {
  test.setTimeout(240_000);
  // Slow motion: the ball stays in flight long enough to be sure the reload lands inside it.
  // Seed: was 'e2e-resume'. Now 'e2e-resume-v3-1' (lead-approved reseed, 2026-11-03, for the frozen sim v3 5d physics):
  // under 5d the fifth ball of 'e2e-resume' (a wrong'un) beats the block and bowls the batter, so only 4 of the 5 balls
  // after the reload are bowled. 'e2e-resume-v3-1' is the first seed of the ordered search 'e2e-resume-v3-<k>'
  // (release/.../wedge/worker/seeds/) whose first ball, left (the resumed ball), misses the stumps and whose next five
  // blocks all survive, so the over completes. The blocks and every assertion are unchanged.
  await openPractice(page, { tier: 'below', timeScale: 0.25, seed: 'e2e-resume-v3-1' });
  await startRandom(page);
  const plan = (await state(page)).over?.variations;
  // After the reload the rest of the over can run fast (a later init script wins for the next page load).
  await configure(page, { tier: 'below', timeScale: 6, seed: 'e2e-resume-v3-1', autoNext: true });
  await whileInFlight(page, 'reload');
  const after = await state(page);
  expect(after.inFlight).toBeNull();
  expect(after.balls).toBe(1);
  expect(after.over?.variations).toEqual(plan);
  if (after.status === 'out') {
    // The ball would have hit the stumps: leaving it bowled the batter, exactly as a left ball would.
    await expect(page.getByTestId('practice-out-summary')).toBeVisible();
    return;
  }
  await expect(page.getByTestId('practice-resume-card')).toBeVisible();
  await expect(page.getByTestId('practice-resumed-leave')).toHaveText('The ball in play when Practice closed counted as a leave.');
  // Continue: the setup of the same over, then ball 2 of it; the resumed ball is never bowled again.
  await queue(page, ...Array.from({ length: 5 }, () => block()));
  await page.getByTestId('practice-continue').click();
  await playFromSetup(page);
  await waitFor(page, ['over_summary', 'out'], 180_000);
  expect((await delivered(page)).innings).toBe(5);
  const end = await state(page);
  expect(end.over?.variations).toEqual(plan);
  expect(end).toMatchObject({ status: 'over_complete', balls: 6 });
});

for (const exercise of ['original random wicket', 'wide-stock survivor'] as const) {
test(`going to the background mid-delivery resolves it as a leave and pauses (${exercise})`, async ({ page }) => {
  test.setTimeout(180_000);
  // Seed for the random wicket: was 'e2e-replay'. Now 'e2e-replay-v3-1' (lead-approved reseed, 2026-11-03, for the
  // frozen sim v3 5d physics): under 5d the first ball of 'e2e-replay', left, misses the stumps. 'e2e-replay-v3-1' is the
  // first seed of the ordered search 'e2e-replay-v3-<k>' (release/.../wedge/worker/seeds/) whose first ball, left as the
  // interruption leaves it, hits the stumps. The wide-stock survivor keeps 'e2e-replay'. Every assertion is unchanged.
  await openPractice(page, { tier: 'below', timeScale: 0.5, seed: exercise === 'original random wicket' ? 'e2e-replay-v3-1' : 'e2e-replay' });
  if (exercise === 'wide-stock survivor') {
    await page.getByTestId('practice-predefined').click();
    await page.getByTestId('practice-build-mode-own').click();
    for (let i = 0; i < 6; i++) await buildBall(page, 0.45, 5.5, 'stock');
    await page.getByTestId('practice-build-start').click();
    await playFromSetup(page);
  } else await startRandom(page);
  const before = await state(page);
  await whileInFlight(page, 'background');
  await waitFor(page, ['paused'], 60_000);
  await expect(page.getByTestId('practice-paused')).toBeVisible();
  await expect(page.getByTestId('practice-panel-notice')).toHaveText('Practice was interrupted during that ball, so it counted as a leave.');
  const st = await state(page);
  expect(st.last?.swing).toBeNull();
  expect(st).toMatchObject({ balls: 1, status: exercise === 'wide-stock survivor' ? 'batting' : 'out', notice: 'interrupted', inFlight: null });
  expect(st.last?.dismissal).toBe(exercise === 'wide-stock survivor' ? null : 'bowled');
  expect(st.over?.variations).toEqual(before.over?.variations);
  await page.getByTestId('practice-resume').click();
  await waitFor(page, ['dead']);
  await expect(page.getByTestId('practice-result')).toBeVisible();
  expect((await state(page)).balls).toBe(1);
  expect((await delivered(page)).innings).toBe(1);
});
}

test('leaving mid-over asks first, and the unfinished over is kept', async ({ page }) => {
  test.setTimeout(180_000);
  await openPractice(page, { tier: 'below', timeScale: 4, seed: 'e2e-leave' });
  await queue(page, block());
  await startRandom(page);
  await waitFor(page, ['dead']);
  await page.getByTestId('practice-pause').click();
  await page.getByTestId('practice-leave').click();
  await expect(page.getByTestId('practice-leave-dialog')).toBeVisible();
  await page.getByTestId('practice-leave-dialog-confirm').click();
  await expect(page.getByTestId('practice-menu')).toBeVisible();
  await expect(page.getByTestId('practice-resume-card')).toBeVisible();
  expect((await state(page)).balls).toBe(1);
});
