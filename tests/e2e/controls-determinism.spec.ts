/**
 * "Switching never changes the delivery or the physics" (owner's second brief, section 0 and 4; DoD CTR-02, FAIR1, SYS1).
 * One seeded over is batted three times with the same six swings: with the mouse, with touch, and with the mouse then
 * switched to touch between the third and fourth ball. Every ball's flight (speed, ideal contact time, time to the
 * stumps) and result must be identical across the three. The swings are queued on the simulation clock, so any
 * difference could only come from the choice itself leaking into a delivery, a seed or an outcome.
 */
import { expect, test, type Page } from '@playwright/test';
import { TOUCH_LAPTOP, stored, switchBetweenBalls } from './controls-helpers';
import { block, openPractice, queue, state, waitFor, type Swing } from './practice-helpers';

test.use({ viewport: { width: 1366, height: 768 } });
test.describe.configure({ mode: 'serial' });

const CFG = { tier: 'below' as const, timeScale: 3, seed: 'e2e-controls-determinism' };
/** A well-timed straight bat for every ball, so the innings survives the whole over (a wicket would end it early). */
const SWINGS: Swing[] = Array.from({ length: 6 }, () => block());

interface Ball {
  last: unknown;
  flight: unknown;
}

async function bat(page: Page, control: 'mouse' | 'touch', switchAfter?: number): Promise<Ball[]> {
  await page.addInitScript(TOUCH_LAPTOP);
  await openPractice(page, CFG, { settings: { control } });
  await page.getByTestId('practice-random').click();
  await queue(page, ...SWINGS);
  await page.getByTestId('practice-play-start').click();
  const balls: Ball[] = [];
  for (let i = 0; i < SWINGS.length; i++) {
    await waitFor(page, ['dead', 'out'], 120_000);
    const st = await state(page);
    balls.push({
      last: st.last,
      flight: await page.evaluate(() =>
        (window as unknown as { __vandePractice: { lastFlight(): unknown } }).__vandePractice.lastFlight(),
      ),
    });
    if (st.screen === 'out' || i === SWINGS.length - 1) break;
    if (switchAfter === i + 1) await switchBetweenBalls(page, 'touch');
    await page.getByTestId('practice-next-ball').click();
  }
  return balls;
}

test('the same seed and swings give the same six balls with the mouse, with touch, and across a switch', async ({
  browser,
}) => {
  test.setTimeout(420_000);
  const runs: Array<{ balls: Ball[]; control: string | null }> = [];
  for (const [control, switchAfter] of [['mouse'], ['touch'], ['mouse', 3]] as const) {
    const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    const page = await context.newPage();
    const balls = await bat(page, control, switchAfter);
    runs.push({ balls, control: (await stored(page)).control });
    await context.close();
  }
  const [mouse, touch, switched] = runs;
  test.info().annotations.push({ type: 'digest', description: JSON.stringify(mouse.balls) });
  expect(mouse.control).toBe('mouse');
  expect(touch.control).toBe('touch');
  expect(switched.control, 'the switch really happened').toBe('touch');
  // Every ball after the switch is the same ball, and so is every ball before it.
  expect(touch.balls).toEqual(mouse.balls);
  expect(switched.balls).toEqual(mouse.balls);
  expect(mouse.balls.length, 'balls were bowled after the switch point (the third)').toBeGreaterThanOrEqual(4);
});
