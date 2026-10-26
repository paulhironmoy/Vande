/**
 * The over and innings journeys with the real physics, rules and stage: Quick Random Over, Build an Over, a full
 * six-ball over, surviving into the next over, a dismissal (the innings ends at once), ten overs, Replay This Over and
 * repeating a ball. Swings are injected on the simulation clock through the test hooks (they then go through the same
 * pipeline as a touch); seeds are fixed, so every run bowls and resolves the same deliveries. The longer flows use the
 * Classic (2D) stage, whose rules are identical, to stay quick in a software-rendered browser.
 */
import { expect, test, type Page } from '@playwright/test';
import { GPU_ARGS, block, buildBall, configure, queue, startRandom, state, toOverSummary, waitFor } from './practice-helpers';

test.use({ viewport: { width: 1366, height: 768 }, ...GPU_ARGS });

const WIDE = 0.45;
const BOWLING = ['runup', 'live', 'playing', 'coaching'];

async function openPractice(page: Page, cfg: Parameters<typeof configure>[1]) {
  await configure(page, cfg, { guidedDone: true });
  await page.goto('/practice');
  await expect(page.getByTestId('practice-menu')).toBeVisible();
}

async function startBuilt(page: Page) {
  await page.getByTestId('practice-build-start').click();
  await waitFor(page, BOWLING);
}

test('Quick Random Over (first-person stage): six fixed balls, the full over, then the next over', async ({ page }) => {
  test.setTimeout(300_000);
  await openPractice(page, { tier: 'full', timeScale: 8, seed: 'e2e-random' });
  await queue(page, ...Array.from({ length: 6 }, () => block()));
  await startRandom(page);
  const first = await state(page);
  expect(first.stage).toBe('3d');
  expect(first.over).toMatchObject({ source: 'random' });
  const fixed = first.over?.variations;
  await toOverSummary(page);
  await expect(page.getByTestId('practice-over-summary')).toHaveAttribute('data-over', '1');
  await expect(page.getByTestId('practice-balls-faced')).toHaveText('6');
  let st = await state(page);
  expect(st).toMatchObject({ status: 'over_complete', balls: 6, overs: 1 });
  // The over bowled is the over that was locked before its first ball.
  expect(st.over?.variations).toEqual(fixed);
  await expect(page.getByTestId('practice-timing-summary')).toBeVisible();

  await queue(page, ...Array.from({ length: 6 }, () => block()));
  await page.getByTestId('practice-next-over').click();
  await waitFor(page, BOWLING);
  await toOverSummary(page);
  await expect(page.getByTestId('practice-over-summary')).toHaveAttribute('data-over', '2');
  st = await state(page);
  expect(st).toMatchObject({ balls: 12, overs: 2 });
});

test('Build an Over: one bowler, six chosen balls, edited, shuffled once, then batted', async ({ page }) => {
  test.setTimeout(240_000);
  await openPractice(page, { tier: 'below', timeScale: 8, seed: 'e2e-build' });
  await page.getByTestId('practice-build').click();
  await expect(page.getByTestId('practice-build-screen')).toBeVisible();
  await page.getByTestId('practice-build-family-spin').click();
  // A finger spinner (the default): stock, flighted, quicker, arm ball and the carrom ball (wrong_un).
  const variations = ['stock', 'flighted', 'quicker', 'arm_ball', 'wrong_un', 'stock'];
  for (const [i, v] of variations.entries()) await buildBall(page, WIDE - i * 0.05, 3 + i * 0.4, v);
  for (let n = 1; n <= 6; n++) await expect(page.getByTestId(`practice-slot-${n}`)).toHaveAttribute('data-empty', 'false');
  // Edit ball 2 before starting: replace it.
  await page.getByTestId('practice-slot-2').click();
  await buildBall(page, WIDE, 4, 'stock');
  await page.getByTestId('practice-build-order-shuffle').click();
  await queue(page, ...Array.from({ length: 6 }, () => block()));
  await startBuilt(page);
  const st = await state(page);
  expect(st.over).toMatchObject({ source: 'built', family: 'spin', shuffled: true });
  expect([...(st.over?.variations ?? [])].sort()).toEqual(['arm_ball', 'quicker', 'stock', 'stock', 'stock', 'wrong_un'].sort());
  await toOverSummary(page);
  expect((await state(page)).balls).toBe(6);
});

test('a wicket ends the innings at once, with the dismissal replay, why it happened and Practice This Delivery', async ({ page }) => {
  test.setTimeout(240_000);
  await openPractice(page, { tier: 'below', timeScale: 8, seed: 'e2e-out' });
  await page.getByTestId('practice-build').click();
  // Two wide balls, then a straight yorker on ball 3 that is left alone, then three more.
  await buildBall(page, WIDE, 5.5, 'stock');
  await buildBall(page, WIDE, 5.5, 'stock');
  await buildBall(page, 0, 0.8, 'yorker');
  await buildBall(page, WIDE, 5.5, 'stock');
  await buildBall(page, WIDE, 5.5, 'stock');
  await buildBall(page, WIDE, 5.5, 'stock');
  await queue(page, 'leave', 'leave', 'leave');
  await startBuilt(page);
  await waitFor(page, ['out'], 120_000);
  await expect(page.getByTestId('practice-out-summary')).toBeVisible();
  const st = await state(page);
  expect(st.status).toBe('out');
  expect(st.balls).toBe(3);
  expect(['bowled', 'lbw']).toContain(await page.getByTestId('practice-out-summary').getAttribute('data-how'));
  await expect(page.getByTestId('practice-survived')).toHaveText('Survived 2 balls');
  await expect(page.getByTestId('practice-why')).toContainText('You played no shot.');

  await page.getByTestId('practice-replay-dismissal').click();
  await waitFor(page, ['replay']);
  await expect(page.getByTestId('practice-replay')).toBeVisible();
  await expect(page.getByTestId('practice-diagnostics-panel')).toBeVisible();
  await page.getByTestId('practice-replay-close').click();
  await expect(page.getByTestId('practice-out-summary')).toBeVisible();

  await queue(page, block());
  await page.getByTestId('practice-practice-delivery').click();
  await waitFor(page, ['coaching'], 60_000);
  await expect(page.getByTestId('practice-coaching')).toContainText('Practice ball · does not count');
  expect((await state(page)).balls).toBe(3);
  await page.getByTestId('practice-repeat-back').click();
  await expect(page.getByTestId('practice-out-summary')).toBeVisible();
});

test('Replay This Over (first-person stage) plays the six balls; a ball can be repeated without counting', async ({ page }) => {
  test.setTimeout(300_000);
  await openPractice(page, { tier: 'full', timeScale: 8, seed: 'e2e-replay' });
  await queue(page, ...Array.from({ length: 6 }, () => block()));
  await startRandom(page);
  await toOverSummary(page);
  await page.getByTestId('practice-replay-over').click();
  const bar = page.getByTestId('practice-replay');
  await expect(bar).toBeVisible({ timeout: 30_000 });
  await expect(bar).toHaveAttribute('data-index', '5', { timeout: 150_000 });
  await expect(bar).toHaveAttribute('data-playing', 'false', { timeout: 60_000 });
  await page.getByTestId('practice-replay-close').click();
  await toOverSummary(page);

  const before = await state(page);
  await queue(page, block());
  await page.getByTestId('practice-repeat-2').click();
  await waitFor(page, ['coaching'], 90_000);
  await expect(page.getByTestId('practice-coaching')).toContainText('does not count');
  const after = await state(page);
  expect(after.balls).toBe(before.balls);
  expect(after.runs).toBe(before.runs);
  await page.getByTestId('practice-repeat-back').click();
  await toOverSummary(page);
});

test('ten overs complete the innings and show the full summary', async ({ page }) => {
  test.setTimeout(480_000);
  await openPractice(page, { tier: 'below', timeScale: 12, seed: 'e2e-ten' });
  await page.getByTestId('practice-build').click();
  for (let i = 0; i < 6; i++) await buildBall(page, WIDE, 5.5, 'stock');
  await startBuilt(page);
  for (let over = 1; over < 10; over++) {
    await toOverSummary(page);
    await expect(page.getByTestId('practice-over-summary')).toHaveAttribute('data-over', String(over));
    await page.getByTestId('practice-build-next').click();
    await expect(page.getByTestId('practice-build-screen')).toBeVisible();
    await startBuilt(page);
  }
  await waitFor(page, ['complete'], 180_000);
  await expect(page.getByTestId('practice-innings-summary')).toHaveAttribute('data-overs', '10');
  await expect(page.getByRole('heading', { name: 'Ten overs complete' })).toBeVisible();
  const st = await state(page);
  expect(st).toMatchObject({ status: 'complete', balls: 60, overs: 10 });
});
