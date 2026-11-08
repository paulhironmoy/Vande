/**
 * The over and innings journeys with the real physics, rules, coach and stage: a Random Over on the first-person stage
 * and the next over; the reference over (the benchmark six); your own six (spin, edited, shuffled once); a wicket that
 * ends the innings at once, its summary and Coach Mode on the dismissal ball; Replay this over; ten overs. Swings are
 * injected on the simulation clock (they then go through the same pipeline as a touch) and seeds are fixed, so every
 * run bowls and resolves the same deliveries. Long flows use the Classic (2D) stage, whose rules are identical.
 */
import { expect, test } from '@playwright/test';
import { GPU_ARGS, block, buildBall, openPractice, playFromSetup, queue, startRandom, state, toOverSummary, waitFor } from './practice-helpers';

test.use({ viewport: { width: 1366, height: 768 }, ...GPU_ARGS });

const WIDE = 0.45;

test('a seeded Random Over keeps its six-ball plan and a genuine first-ball dismissal ends the innings', async ({ page }) => {
  test.setTimeout(180_000);
  // Seed: was 'e2e-random'. Now 'e2e-random-v3-72' (lead-approved reseed, 2026-11-03, for the frozen sim v3 5d
  // physics): under 5d 'e2e-random' bowls the first block (a missed wrong'un), not caught behind. 'e2e-random-v3-72' is
  // the first seed of the ordered search 'e2e-random-v3-<k>' (release/.../wedge/worker/seeds/) whose first ball, blocked
  // at the Full tier, takes the outside edge to the keeper. The blocks and every assertion are unchanged.
  await openPractice(page, { tier: 'full', timeScale: 8, seed: 'e2e-random-v3-72', autoNext: true });
  await queue(page, ...Array.from({ length: 6 }, () => block()));
  await page.getByTestId('practice-random').click();
  const planned = (await state(page)).over;
  expect(planned).toMatchObject({ source: 'random' });
  expect(planned?.variations).toHaveLength(6);
  await playFromSetup(page);
  await waitFor(page, ['out']);
  const ended = await state(page);
  expect(ended).toMatchObject({ stage: '3d', status: 'out', balls: 1, last: { dismissal: 'caught_behind', swing: 'defend' } });
  expect(ended.over?.variations).toEqual(planned?.variations);
  await expect(page.getByTestId('practice-out-summary')).toBeVisible();
});

test('a designed wide-stock over on the first-person stage completes six balls, then Another over completes twelve', async ({ page }) => {
  test.setTimeout(300_000);
  // This is a navigation/persistence fixture, not evidence that any random delivery is safely blockable.
  // Retain the original random seed's real dismissal above; do not alter physics to force an uninterrupted innings.
  await openPractice(page, { tier: 'full', timeScale: 8, seed: 'e2e-wide-continuity', autoNext: true });
  await page.getByTestId('practice-predefined').click();
  await page.getByTestId('practice-build-mode-own').click();
  for (let i = 0; i < 6; i++) await buildBall(page, WIDE, 5.5, 'stock');
  await page.getByTestId('practice-build-start').click();
  await queue(page, ...Array.from({ length: 6 }, () => 'leave' as const));
  await playFromSetup(page);
  const first = await state(page);
  expect(first.stage).toBe('3d');
  expect(first.over).toMatchObject({ source: 'built' });
  const fixed = first.over?.variations;
  await toOverSummary(page);
  await expect(page.getByTestId('practice-over-summary')).toHaveAttribute('data-over', '1');
  let st = await state(page);
  expect(st).toMatchObject({ status: 'over_complete', balls: 6, overs: 1 });
  expect(st.over?.variations).toEqual(fixed);
  await expect(page.getByTestId('practice-over-balls')).toBeVisible();
  await queue(page, ...Array.from({ length: 6 }, () => 'leave' as const));
  await page.getByTestId('practice-next-over').click();
  await playFromSetup(page);
  await toOverSummary(page);
  await expect(page.getByTestId('practice-over-summary')).toHaveAttribute('data-over', '2');
  st = await state(page);
  expect(st).toMatchObject({ balls: 12, overs: 2 });
  const savedSeeds = await page.evaluate(() => JSON.parse(localStorage.getItem('vc:practice:innings') ?? 'null').state.overs.map((o: { plan: { seed: string } }) => o.plan.seed));
  expect(savedSeeds, 'both the editor and Another over use the controller seed provider').toEqual(['e2e-wide-continuity-0', 'e2e-wide-continuity-1']);
});

test('the reference over: the benchmark six, on a Balanced pitch, every time', async ({ page }) => {
  test.setTimeout(240_000);
  await openPractice(page, { tier: 'below', timeScale: 8, seed: 'e2e-ref', autoNext: true });
  await page.getByTestId('practice-predefined').click();
  await expect(page.getByTestId('practice-reference')).toBeVisible();
  await page.getByTestId('practice-ref-5').click();
  await expect(page.getByTestId('practice-ref-objective')).toContainText('Bouncer');
  await page.getByTestId('practice-build-start').click();
  await expect(page.getByTestId('practice-setup')).toHaveAttribute('data-kind', 'reference');
  await expect(page.getByTestId('practice-unknown-line')).toHaveCount(0);
  await queue(page, ...Array.from({ length: 6 }, () => 'leave' as const));
  await playFromSetup(page);
  const st = await state(page);
  expect(st.over).toMatchObject({ source: 'reference', family: 'pace', variations: ['outswing', 'inswing', 'stock', 'cutter', 'bouncer', 'yorker'] });
  await waitFor(page, ['over_summary', 'out'], 180_000);
});

test('your own six: one bowler, six chosen balls, edited and shuffled once, then batted', async ({ page }) => {
  test.setTimeout(240_000);
  await openPractice(page, { tier: 'below', timeScale: 8, seed: 'e2e-build', autoNext: true });
  await page.getByTestId('practice-predefined').click();
  await page.getByTestId('practice-build-mode-own').click();
  await page.getByTestId('practice-build-family-spin').click();
  const variations = ['stock', 'flighted', 'quicker', 'arm_ball', 'wrong_un', 'stock'];
  for (const [i, v] of variations.entries()) await buildBall(page, WIDE - i * 0.05, 3 + i * 0.4, v);
  for (let n = 1; n <= 6; n++) await expect(page.getByTestId(`practice-slot-${n}`)).toHaveAttribute('data-empty', 'false');
  // Edit ball 2: a stock ball instead of the flighted one.
  await page.getByTestId('practice-slot-2').click();
  await page.getByTestId('practice-build-variation-stock').click();
  await page.getByTestId('practice-build-order-shuffle').click();
  await page.getByTestId('practice-build-start').click();
  await queue(page, ...Array.from({ length: 6 }, () => block()));
  await playFromSetup(page);
  const st = await state(page);
  expect(st.over).toMatchObject({ source: 'built', family: 'spin', shuffled: true });
  expect([...(st.over?.variations ?? [])].sort()).toEqual(['arm_ball', 'quicker', 'stock', 'stock', 'stock', 'wrong_un'].sort());
  // The editor now honors the ORIGINAL configured seed. Previously randomHex bypassed the hook: its arm ball
  // shuffled to sixth/second position in two different failing runs. The fixed seed's independent simulation is
  // pinned in built-seed.test.ts; no seed search or suppressed wicket is used to obtain this six-ball fixture.
  expect(st.over?.variations).toEqual(['arm_ball', 'wrong_un', 'stock', 'stock', 'stock', 'quicker']);
  await toOverSummary(page);
  const ended = await state(page);
  expect(ended).toMatchObject({ status: 'over_complete', balls: 6, runs: 0, last: { dismissal: null, swing: 'defend' } });
  expect(ended.over?.variations).toEqual(st.over?.variations);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('vc:practice:innings') ?? 'null').state);
  expect(saved.overs[0].plan.seed, 'the custom editor must not bypass the configured controller seed').toBe('e2e-build-0');
  expect(saved.overs[0].deliveries.map((d: { plan: { variation: string } }) => d.plan.variation)).toEqual(st.over?.variations);
});

test('your own six, each delivery chosen before its pitch: the over bowled is exactly the one built (F-029)', async ({ page }) => {
  test.setTimeout(240_000);
  await openPractice(page, { tier: 'below', timeScale: 8, seed: 'e2e-build-pace', autoNext: true });
  await page.getByTestId('practice-predefined').click();
  await page.getByTestId('practice-build-mode-own').click();
  // A rookie names the delivery first ("a yorker on the stumps"), then taps where it should pitch.
  const intended = ['outswing', 'inswing', 'stock', 'cutter', 'bouncer', 'yorker'];
  const at: Array<[number, number]> = [[0.25, 6], [0.05, 6], [0.15, 5.5], [0.1, 6.5], [0.05, 9.5], [0, 0.9]];
  for (const [i, v] of intended.entries()) {
    await buildBall(page, at[i][0], at[i][1], v);
    // Choosing the delivery never creates a ball: only the pitch tap does, and it moves on to the next.
    await expect(page.getByTestId(`practice-slot-${i + 1}`)).toHaveAttribute('data-empty', 'false');
    if (i < 5) await expect(page.getByTestId(`practice-slot-${i + 2}`)).toHaveAttribute('data-empty', 'true');
  }
  await page.getByTestId('practice-build-start').click();
  await queue(page, ...Array.from({ length: 6 }, () => block()));
  await playFromSetup(page);
  expect((await state(page)).over).toMatchObject({ source: 'built', family: 'pace', shuffled: false, variations: intended });
});

test('a wicket ends the innings at once; its summary offers Coach Mode on the dismissal ball', async ({ page }) => {
  test.setTimeout(240_000);
  await openPractice(page, { tier: 'below', timeScale: 8, seed: 'e2e-out', autoNext: true });
  await page.getByTestId('practice-predefined').click();
  await page.getByTestId('practice-build-mode-own').click();
  // Two wide balls, then a straight yorker on ball 3 that is left alone, then three more.
  await buildBall(page, WIDE, 5.5, 'stock');
  await buildBall(page, WIDE, 5.5, 'stock');
  await buildBall(page, 0, 0.8, 'yorker');
  await buildBall(page, WIDE, 5.5, 'stock');
  await buildBall(page, WIDE, 5.5, 'stock');
  await buildBall(page, WIDE, 5.5, 'stock');
  await page.getByTestId('practice-build-start').click();
  await queue(page, 'leave', 'leave', 'leave');
  await playFromSetup(page);
  await waitFor(page, ['out'], 120_000);
  await expect(page.getByTestId('practice-out-summary')).toBeVisible();
  const st = await state(page);
  expect(st).toMatchObject({ status: 'out', balls: 3 });
  expect(['bowled', 'lbw']).toContain(await page.getByTestId('practice-out-summary').getAttribute('data-how'));
  await expect(page.getByTestId('practice-survived')).toHaveText('Survived 2 balls');
  await queue(page, block());
  await page.getByTestId('practice-practice-delivery').click();
  await expect(page.getByTestId('practice-coach')).toBeVisible();
  await page.getByTestId('practice-replay-exact').click();
  await waitFor(page, ['runup', 'live', 'playing'], 30_000);
  await page.waitForFunction(() => ((window as unknown as { __vandePractice: { state(): { coach: { attempts: number } | null } } }).__vandePractice.state().coach?.attempts ?? 0) >= 1, undefined, { timeout: 60_000 });
  await expect(page.getByTestId('practice-compare')).toBeVisible();
  expect((await state(page)).balls).toBe(3);
  await page.getByTestId('practice-coach-back').click();
  await expect(page.getByTestId('practice-out-summary')).toBeVisible();
});

test('Replay this over plays the six balls on the first-person stage', async ({ page }) => {
  test.setTimeout(300_000);
  await openPractice(page, { tier: 'full', timeScale: 8, seed: 'e2e-replay', autoNext: true });
  await queue(page, ...Array.from({ length: 6 }, () => block()));
  await startRandom(page);
  await toOverSummary(page);
  // Replay is one of the quiet options under More (the summary's actions: one primary, two secondary).
  await page.getByTestId('practice-summary-more-toggle').click();
  await page.getByTestId('practice-replay-over').click();
  const bar = page.getByTestId('practice-replay');
  await expect(bar).toBeVisible({ timeout: 30_000 });
  await expect(bar).toHaveAttribute('data-index', '5', { timeout: 150_000 });
  await expect(bar).toHaveAttribute('data-playing', 'false', { timeout: 60_000 });
  await page.getByTestId('practice-replay-close').click();
  await toOverSummary(page);
});

test('ten overs complete the innings and show the full summary', async ({ page }) => {
  test.setTimeout(480_000);
  await openPractice(page, { tier: 'below', timeScale: 12, seed: 'e2e-ten', autoNext: true });
  await page.getByTestId('practice-predefined').click();
  await page.getByTestId('practice-build-mode-own').click();
  for (let i = 0; i < 6; i++) await buildBall(page, WIDE, 5.5, 'stock');
  await page.getByTestId('practice-build-start').click();
  await playFromSetup(page);
  for (let over = 1; over < 10; over++) {
    await toOverSummary(page);
    await expect(page.getByTestId('practice-over-summary')).toHaveAttribute('data-over', String(over));
    // Another over: the same six again, one tap to its setup.
    await page.getByTestId('practice-next-over').click();
    await playFromSetup(page);
  }
  await waitFor(page, ['complete'], 180_000);
  await expect(page.getByTestId('practice-innings-summary')).toHaveAttribute('data-overs', '10');
  await expect(page.getByRole('heading', { name: 'Ten overs complete' })).toBeVisible();
  expect(await state(page)).toMatchObject({ status: 'complete', balls: 60, overs: 10 });
});
