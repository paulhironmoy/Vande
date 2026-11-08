/**
 * Target Chase on the hooks build (the `practice` project): the whole of a chase, from the Practice home to the result.
 * A chase is chosen with the mouse, bowled ball by ball (the swings are the hooks' simulated input: the same
 * NormalizedSwing pipeline as a real gesture, with exact timing, so the outcome is the physics' and is repeatable), and
 * ended by a win, a wicket or the twelfth ball. It checks: the briefing, the HUD ("Need X off Y") against the balls
 * played, that the second over follows the first with no summary between, the replay of the deciding ball, the win and
 * loss screens and their one sentence, that "Practice this ball" and "Restart over" are not part of a chase, that "Try
 * this chase again" is the same seed, target and balls, that a chase left half way comes back, that a real mouse flick
 * works in a chase, and the layout of the rail at phone sizes and at 200% text.
 *
 * The paths: seeds are pool seeds ("c000" to "c255", src/practice/chase) and the swings are fixed lists found with the
 * same physics (scripts and method in release/product-sequence/stage-3-chase/CHASE-UI/PATHS.md). Targets are never
 * pinned here: they are read from the page (the target table is still being replaced by CHASE-CORE's sweep). If that
 * sweep changes a target, a win path may stop being a win; `PATHS.md` says how to find the list again.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { GPU_ARGS, block, openPractice, queue, seen, state, waitFor, type HookState } from './practice-helpers';
import { LOSS_BALLS, LOSS_WICKET, WIN } from './chase-paths';

test.use({ viewport: { width: 915, height: 412 }, ...GPU_ARGS });

const chase = async (page: Page) => (await state(page)).chase!;

/** Evidence captures for the design review: written only when CHASE_CAPTURE_DIR is set, otherwise nothing happens. */
async function shot(page: Page, name: string) {
  const dir = process.env.CHASE_CAPTURE_DIR;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png` });
}
const text = async (page: Page, id: string) => (await page.getByTestId(id).textContent())?.trim() ?? '';

/** The pool seed the page opens its Chase with, and a fast clock (the swings do not depend on it). */
async function openChase(page: Page, seed: string, extra: Record<string, unknown> = {}) {
  await openPractice(page, { tier: 'below', timeScale: 8, seed: 'e2e-chase', chaseSeed: seed, ...extra });
  await page.getByTestId('practice-chase').click();
  await expect(page.getByTestId('practice-setup')).toBeVisible();
}

/** Press Play on the briefing: the first ball is under way. */
async function play(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as {
      __vandePractice: { waitFor(s: string[], ms: number): Promise<boolean> };
      __w?: Promise<boolean>;
    };
    w.__w = w.__vandePractice.waitFor(['runup', 'live', 'playing', 'dead'], 90_000);
  });
  await page.getByTestId('practice-play-start').click();
  expect(await page.evaluate(() => (window as unknown as { __w: Promise<boolean> }).__w), 'the chase started').toBe(
    true,
  );
}

/** Wait for the dead ball of ball n (1-based): the board shows n balls. */
async function deadBall(page: Page, n: number) {
  await page.waitForFunction(
    (k) => {
      const st = (window as unknown as { __vandePractice: { state(): HookState } }).__vandePractice.state();
      return st.phase === 'dead' && st.chase !== null && st.chase.ballsFaced === k;
    },
    n,
    { timeout: 120_000 },
  );
}

/** Bats the chase ball by ball, checking the rail against the balls played, until it is decided; returns the balls bowled. */
async function batOut(page: Page, limit = 12, from = 1, english = true, tag = '') {
  for (let n = from; n <= limit; n++) {
    await deadBall(page, n);
    if (tag && (n === 1 || n === 6)) {
      await page.waitForTimeout(700);
      await shot(page, `${tag}-dead-ball-${n}`);
    }
    const c = await chase(page);
    // The rail says what the chase says, in the words COPY wrote, and nothing else (English only: the words are asserted
    // in English; the Hindi and Hinglish runs check the layout, not the wording).
    if (c.result === 'in_progress') {
      if (english) {
        await expect(page.getByTestId('practice-chase-need-main')).toHaveText(
          `Need ${c.runsNeeded} off ${c.ballsLeft} ball${c.ballsLeft === 1 ? '' : 's'}`,
        );
        await expect(page.getByTestId('practice-status-mode')).toHaveCount(0);
        // Screen readers: the outcome, then what is needed now (politely, after the ball has been shown).
        await expect(page.getByTestId('practice-announce')).toContainText(
          c.ballsLeft === 1 ? `Need ${c.runsNeeded} run` : `Need ${c.runsNeeded} off ${c.ballsLeft} ball`,
        );
      } else await expect(page.getByTestId('practice-chase-need-main')).toBeVisible();
    } else {
      await expect(page.getByTestId('practice-chase-need')).toHaveCount(0);
      if (english)
        await expect(page.getByTestId('practice-announce')).toContainText(
          c.result === 'won' ? 'Target reached' : 'Chase lost',
        );
      return n;
    }
    // Inside a chase the dead-ball card has no "Practice this ball" and says why.
    await expect(page.getByTestId('practice-practice-ball')).toHaveCount(0);
    await expect(page.getByTestId('practice-chase-no-practice')).toBeVisible();
    if (english)
      await expect(page.getByTestId('practice-next-ball')).toContainText(n === 6 ? 'Next over' : 'Next ball');
    await page.getByTestId('practice-next-ball').click();
  }
  return limit;
}

/** "See result": the deciding ball is replayed by itself, then the win or loss screen. */
async function seeResult(page: Page, english = true) {
  if (english) await expect(page.getByTestId('practice-next-ball')).toContainText('See result');
  // Subscribe before the tap: a fast clock can finish the replay before a second command arrives.
  await page.evaluate(() => {
    const w = window as unknown as {
      __vandePractice: { waitFor(s: string[], ms: number): Promise<boolean> };
      __replay?: Promise<boolean>;
    };
    w.__replay = w.__vandePractice.waitFor(['replay'], 120_000);
  });
  await page.getByTestId('practice-next-ball').click();
  expect(
    await page.evaluate(() => (window as unknown as { __replay: Promise<boolean> }).__replay),
    'the deciding ball was replayed',
  ).toBe(true);
  await waitFor(page, ['chase_result'], 120_000);
  await expect(page.getByTestId('practice-chase-result')).toBeVisible();
}

test('the Practice home offers Chase; choosing it opens a briefing with the target, the rules and why there is no retry', async ({
  page,
}) => {
  await openPractice(page, { tier: 'below', timeScale: 8, seed: 'e2e-chase', chaseSeed: WIN.seed });
  await shot(page, 'home-915x412');
  await page.getByTestId('practice-chase').click();
  await expect(page.getByTestId('practice-setup')).toBeVisible();
  await page.waitForTimeout(700);
  await shot(page, 'briefing-915x412');
  const c = await chase(page);
  expect(c).toMatchObject({
    seed: WIN.seed,
    difficulty: 'standard',
    result: 'in_progress',
    ballsFaced: 0,
    ballsLeft: 12,
  });
  await expect(page.getByTestId('practice-chase-brief-target')).toHaveText(`Target ${c.target}`);
  await expect(page.getByTestId('practice-chase-brief-need')).toHaveText(`Need ${c.target} off 12 balls`);
  await expect(page.getByTestId('practice-chase-brief')).toContainText('never changes');
  await expect(page.getByTestId('practice-chase-no-retry')).toContainText('Practice this ball is off');
  // No choices of a Random Over: the seed, not the player, sets the balls.
  await expect(page.getByTestId('practice-random-choices-toggle')).toHaveCount(0);
  // Back from the briefing leaves nothing behind.
  await page.getByTestId('practice-back').click();
  await expect(page.getByTestId('practice-menu')).toBeVisible();
  await expect(page.getByTestId('practice-resume-card')).toHaveCount(0);
  expect((await state(page)).chase).toBeNull();
});

test('a win: sixes and fours by the book reach the target; the rail follows each ball; the deciding ball is replayed; the win screen', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await openChase(page, WIN.seed);
  const target = (await chase(page)).target;
  await queue(page, ...WIN.swings);
  await play(page);
  // Ball 1: before it is shown the rail still reads the whole target.
  await expect(page.getByTestId('practice-chase-need-main')).toHaveText(`Need ${target} off 12 balls`);
  const balls = await batOut(page, 12, 1, true, 'win');
  // The target is announced once, with the first ball's run-up (polite): the first thing the live region ever said.
  expect(await seen(page, 'practice-announce')).toContain(`Chase. Need ${target} off 12 balls`);
  const c = await chase(page);
  expect(c.result).toBe('won');
  expect(balls).toBeGreaterThan(0);
  expect(balls).toBeLessThanOrEqual(12);
  expect(c.deciding).toBe(`${Math.floor((balls - 1) / 6)}:${(balls - 1) % 6}`);
  await seeResult(page);
  await page.waitForTimeout(700);
  await shot(page, 'result-win-915x412');
  const root = page.getByTestId('practice-chase-result');
  await expect(root).toHaveAttribute('data-result', 'won');
  await expect(root.locator('h1')).toHaveText('Target reached');
  await expect(page.getByTestId('practice-chase-line')).toContainText(`The target was ${target}`);
  await expect(page.getByTestId('practice-chase-why')).toHaveCount(0);
  await expect(page.getByTestId('practice-chase-balls').locator('li')).toHaveCount(balls);
  // One primary, one secondary, one quiet disclosure; no confetti, no reward, nothing counted.
  await expect(root.getByRole('button', { name: 'Try this chase again' })).toHaveCount(1);
  await expect(root.getByRole('button', { name: 'Back to Practice' })).toHaveCount(1);
  expect(await seen(page, 'practice-chase-reward')).toBeNull();
  // The result is kept on this device, for this seed, and only that.
  const history = await page.evaluate(() => JSON.parse(localStorage.getItem('vc:practice:chase-history') ?? '{}'));
  expect(history.entries).toHaveLength(1);
  expect(history.entries[0]).toMatchObject({ seed: WIN.seed, result: 'won', target });
  // The chase's innings is closed: nothing can be bowled any more.
  expect((await state(page)).status).toBe('complete');
});

test('a wicket ends the chase on that ball; the screen says what happened in one sentence from the record', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await openChase(page, LOSS_WICKET.seed);
  await queue(page, ...LOSS_WICKET.swings);
  await play(page);
  const balls = await batOut(page, 12, 1, true, 'wicket');
  expect(balls).toBe(LOSS_WICKET.swings.length);
  const c = await chase(page);
  expect(c.result).toBe('lost_wicket');
  expect((await state(page)).status).toBe('out');
  await seeResult(page);
  await page.waitForTimeout(700);
  await shot(page, 'result-loss-wicket-915x412');
  const root = page.getByTestId('practice-chase-result');
  await expect(root).toHaveAttribute('data-result', 'lost_wicket');
  await expect(root.locator('h1')).toHaveText(/runs? short$/);
  const why = await text(page, 'practice-chase-why');
  expect(why).toMatch(/^Out: (Bowled|Caught|Caught behind|LBW)\. .+\.$/);
  await expect(page.getByTestId('practice-chase-line')).toContainText(`You scored ${c.runs} off ${balls} ball`);
});

test('twelve balls without the target: the second over follows the first with no summary; the result says what the dot balls were', async ({
  page,
}) => {
  test.setTimeout(300_000);
  await openChase(page, LOSS_BALLS.seed);
  await queue(page, ...LOSS_BALLS.swings);
  await play(page);
  const balls = await batOut(page, 12, 1, true, 'balls');
  expect(balls).toBe(12);
  expect(await seen(page, 'practice-over-summary')).toBeNull();
  const end = await state(page);
  expect(end.overs).toBe(2);
  expect((await chase(page)).result).toBe('lost_balls');
  await seeResult(page);
  await page.waitForTimeout(700);
  await shot(page, 'result-loss-balls-915x412');
  const root = page.getByTestId('practice-chase-result');
  await expect(root).toHaveAttribute('data-result', 'lost_balls');
  await expect(page.getByTestId('practice-chase-balls').locator('li')).toHaveCount(12);
  if (await page.getByTestId('practice-chase-why').count()) {
    expect(await text(page, 'practice-chase-why')).toMatch(
      /balls? (that )?scored nothing|beat the bat|early or late|across the line|fielder|defended or left/,
    );
  }
});

test('inside a chase "Practice this ball" and "Restart over" are not offered; afterwards the deciding ball can be practised, for practice only', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await openChase(page, LOSS_WICKET.seed);
  await queue(page, ...LOSS_WICKET.swings);
  await play(page);
  await deadBall(page, 1);
  // Paused: Resume and Leave; no "Restart over".
  await page.getByTestId('practice-pause').click();
  await expect(page.getByTestId('practice-paused')).toBeVisible();
  await expect(page.getByTestId('practice-restart-over')).toHaveCount(0);
  await expect(page.getByTestId('practice-leave')).toBeVisible();
  await page.getByTestId('practice-resume').click();
  await expect(page.getByTestId('practice-practice-ball')).toHaveCount(0);
  const before = await state(page);
  expect(before.coach).toBeNull();
  await page.getByTestId('practice-next-ball').click();
  await batOut(page, 12, 2);
  await seeResult(page);
  const result = await chase(page);
  // After the result: practise the deciding ball (Coach Mode), then back to the same result.
  await page.getByTestId('practice-chase-deciding-toggle').click();
  await expect(page.getByTestId('practice-chase-practise-note')).toContainText('Practice only');
  await page.getByTestId('practice-chase-practise').click();
  await waitFor(page, ['coach'], 60_000);
  await expect(page.getByTestId('practice-coach')).toBeVisible();
  await page.getByTestId('practice-coach-back').click();
  await expect(page.getByTestId('practice-chase-result')).toBeVisible();
  expect(await chase(page)).toEqual(result);
});

test('"Try this chase again" is the same seed, target and balls, a fresh attempt straight to ball 1', async ({
  page,
}) => {
  test.setTimeout(300_000);
  await openChase(page, LOSS_WICKET.seed);
  await queue(page, ...LOSS_WICKET.swings);
  await play(page);
  const first = await state(page);
  await batOut(page);
  await seeResult(page);
  const lost = await chase(page);
  await queue(page, block());
  await page.getByTestId('practice-chase-again').click();
  await waitFor(page, ['runup', 'live', 'playing', 'dead'], 90_000);
  const again = await state(page);
  expect(again.chase).toMatchObject({
    seed: LOSS_WICKET.seed,
    target: lost.target,
    ballsFaced: 0,
    difficulty: 'standard',
  });
  expect(again.chase?.previous).toMatchObject({ result: 'lost_wicket' });
  // The same balls: the first over has the same deliveries, in the same order, at the same lengths.
  expect(again.over?.variations).toEqual(first.over?.variations);
  expect(again.over?.lengths).toEqual(first.over?.lengths);
  await expect(page.getByTestId('practice-chase-need-main')).toHaveText(`Need ${lost.target} off 12 balls`);
});

test('a new Chase from the home is a different chase from the one just played, and Back to Practice leaves no chase behind', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await openPractice(page, { tier: 'below', timeScale: 8, seed: 'e2e-chase-new' });
  const seeds = new Set<string>();
  for (let i = 0; i < 3; i++) {
    await page.getByTestId('practice-chase').click();
    await expect(page.getByTestId('practice-setup')).toBeVisible();
    seeds.add((await chase(page)).seed);
    await page.getByTestId('practice-back').click();
    await expect(page.getByTestId('practice-menu')).toBeVisible();
  }
  expect(seeds.size).toBeGreaterThan(1);
});

test('a chase left half way comes back as the same chase: the home offers it, Continue keeps the seed and the balls played', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await openChase(page, WIN.seed);
  await queue(page, block(), block(), block());
  await play(page);
  await deadBall(page, 1);
  await page.getByTestId('practice-next-ball').click();
  await deadBall(page, 2);
  const mid = await chase(page);
  // Leave from the pause (confirmed): the chase stays saved on this device.
  await page.getByTestId('practice-pause').click();
  await page.getByTestId('practice-leave').click();
  await page.getByTestId('practice-leave-dialog').getByRole('button', { name: 'Leave' }).click();
  await expect(page.getByTestId('practice-resume-card')).toBeVisible();
  await expect(page.getByTestId('practice-chase-resume-need')).toHaveText(
    `Need ${mid.runsNeeded} off ${mid.ballsLeft} balls`,
  );
  // A reload (a kill) brings the same back.
  await page.reload();
  await expect(page.getByTestId('practice-menu')).toBeVisible({ timeout: 45_000 });
  await expect(page.getByTestId('practice-chase-resume-need')).toHaveText(
    `Need ${mid.runsNeeded} off ${mid.ballsLeft} balls`,
  );
  await queue(page, block());
  await page.getByTestId('practice-continue').click();
  await expect(page.getByTestId('practice-chase-brief-need')).toHaveText(
    `Need ${mid.runsNeeded} off ${mid.ballsLeft} balls`,
  );
  await play(page);
  await deadBall(page, 3);
  expect(await chase(page)).toMatchObject({ seed: WIN.seed, target: mid.target, ballsFaced: 3 });
});

test('a real mouse flick bats a chase ball (the same one gesture authority as Practice)', async ({ page }) => {
  test.setTimeout(240_000);
  await openPractice(page, { tier: 'below', timeScale: 0.5, seed: 'e2e-chase-mouse', chaseSeed: WIN.seed });
  await page.getByTestId('practice-chase').click();
  await play(page);
  await waitFor(page, ['live'], 90_000);
  const surface = page.locator('[role="application"][data-armed="true"]');
  await expect(surface).toBeVisible();
  await page.waitForTimeout(100);
  const box = (await surface.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height * 0.7;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 60, y - 110, { steps: 6 });
  await page.mouse.up();
  await deadBall(page, 1);
  const st = await state(page);
  expect(st.last?.swing).toBe('attack');
  expect(st.chase?.ballsFaced).toBe(1);
});

test('the chase screens pass axe (home, briefing, rail, dead ball, result)', async ({ page }) => {
  test.setTimeout(300_000);
  await openPractice(page, { tier: 'below', timeScale: 8, seed: 'e2e-chase-axe', chaseSeed: LOSS_WICKET.seed });
  const serious = async (include?: string) => {
    const b = new AxeBuilder({ page });
    const r = await (include ? b.include(include) : b).analyze();
    return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  };
  expect(await serious('[data-testid="practice-menu"]')).toEqual([]);
  await page.getByTestId('practice-chase').click();
  await expect(page.getByTestId('practice-setup')).toBeVisible();
  expect(await serious('[data-testid="practice-setup"]')).toEqual([]);
  await queue(page, ...LOSS_WICKET.swings);
  await play(page);
  await deadBall(page, 1);
  // The dead-ball card fades in: axe reads the colours once it has settled (not a frame of the fade).
  await page.waitForFunction(() => {
    const card = document.querySelector('[data-testid="practice-result"]');
    return card !== null && getComputedStyle(card).opacity === '1';
  });
  await page.waitForTimeout(600);
  expect(await serious('[data-testid="practice-play"]')).toEqual([]);
  await page.getByTestId('practice-next-ball').click();
  await batOut(page, 12, 2);
  await seeResult(page);
  expect(await serious('[data-testid="practice-chase-result"]')).toEqual([]);
});

/** The rail covers little during the run-up and the dead ball's card keeps clear of it, at phone sizes and at 200% text. */
for (const [w, h, tier] of [
  [640, 360, 'below'],
  [844, 390, 'below'],
  [915, 412, 'below'],
  [915, 412, 'full'],
] as const) {
  test(`${w}x${h} (${tier === 'full' ? 'Premium 3D' : 'Classic'}): the chase rail stays small in the run-up and the card keeps below it, with both actions in view`, async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: w, height: h });
    // The Premium stage is slow in software graphics: a slower clock keeps its run-up long enough to look at.
    await openPractice(page, {
      tier,
      timeScale: tier === 'full' ? 0.25 : 4,
      seed: 'e2e-chase-layout',
      chaseSeed: LOSS_BALLS.seed,
    });
    await page.getByTestId('practice-chase').click();
    await queue(page, block(), block());
    // Read inside the page, two frames after the run-up begins, as a player would see it (a separate command can reach a
    // software-rendered stage after the whole delivery, and then finds the dead ball).
    const seenAt = page.evaluate(async () => {
      const api = (window as unknown as { __vandePractice: { waitFor(s: string[], ms: number): Promise<boolean> } })
        .__vandePractice;
      if (!(await api.waitFor(['runup'], 90_000))) throw new Error('never in the run-up');
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
      const drawn = (id: string) => {
        const el = document.querySelector(`[data-testid="${id}"]`);
        return Boolean(el && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
      };
      // The rail in Quiet Mode: the score cluster (with the chase line), the radar and pause.
      let area = 0;
      for (const id of ['practice-status', 'practice-conditions', 'practice-pause']) {
        const r = document.querySelector(`[data-testid="${id}"]`)?.getBoundingClientRect();
        if (r && r.width > 0 && r.height > 0) area += r.width * r.height;
      }
      return {
        compact: drawn('practice-chase-need-compact'),
        main: drawn('practice-chase-need-main'),
        rate: drawn('practice-chase-rate'),
        share: area / (window.innerWidth * window.innerHeight),
      };
    });
    await page.getByTestId('practice-play-start').click();
    const quiet = await seenAt;
    // Quiet Mode keeps one short chase line ("15 off 12"), not the full line and the rate, and the rail covers under 8%.
    expect(quiet).toMatchObject({ compact: true, main: false, rate: false });
    expect(quiet.share).toBeLessThan(0.08);
    await shot(page, `run-up-${w}x${h}-${tier}`);
    await deadBall(page, 1);
    await page.waitForTimeout(700);
    await shot(page, `dead-ball-${w}x${h}-${tier}`);
    const card = await page.evaluate(() => {
      const rail = document.querySelector('[data-testid="practice-status"]')!.getBoundingClientRect();
      const c = document.querySelector('[data-testid="practice-result"]')!.getBoundingClientRect();
      const next = document.querySelector('[data-testid="practice-next-ball"]')!.getBoundingClientRect();
      return {
        railBottom: rail.bottom,
        cardTop: c.top,
        cardLeft: c.left,
        railRight: rail.right,
        nextBottom: next.bottom,
        height: window.innerHeight,
      };
    });
    // The card never sits over the rail's left cluster, and its action is on the screen.
    expect(card.nextBottom).toBeLessThanOrEqual(card.height + 1);
    expect(card.cardLeft >= card.railRight || card.cardTop >= card.railBottom - 1).toBe(true);
  });
}

for (const locale of ['en', 'hi', 'hi-Latn'] as const) {
  test(`200% text (640x360, ${locale}): the rail line and the result screen lose nothing and the actions can be reached`, async ({
    page,
  }) => {
    test.setTimeout(300_000);
    await page.setViewportSize({ width: 640, height: 360 });
    // The required large-text setting: the app's 200% text (as the layout spec sets it).
    await page.addInitScript((lang) => {
      try {
        localStorage.setItem(
          'vc:settings',
          JSON.stringify({
            locale: lang,
            reducedMotion: 'off',
            sound: true,
            haptics: true,
            quality: 'auto',
            textScale: 2,
            highContrast: false,
          }),
        );
      } catch {
        /* storage blocked */
      }
    }, locale);
    await openPractice(page, { tier: 'below', timeScale: 8, seed: 'e2e-chase-200', chaseSeed: LOSS_WICKET.seed });
    await page.getByTestId('practice-chase').click();
    await queue(page, ...LOSS_WICKET.swings);
    await play(page);
    await deadBall(page, 1);
    await page.waitForTimeout(700);
    await shot(page, `dead-ball-200pct-${locale}`);
    const need = page.getByTestId('practice-chase-need-main');
    await expect(need).toBeVisible();
    const box = (await need.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(640);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    expect(overflow).toBe(false);
    await page.getByTestId('practice-next-ball').scrollIntoViewIfNeeded();
    await page.getByTestId('practice-next-ball').click();
    await batOut(page, 12, 2, locale === 'en');
    await seeResult(page, locale === 'en');
    await page.waitForTimeout(700);
    await shot(page, `result-200pct-${locale}`);
    await page.getByTestId('practice-chase-again').scrollIntoViewIfNeeded();
    await expect(page.getByTestId('practice-chase-again')).toBeVisible();
    const again = (await page.getByTestId('practice-chase-again').boundingBox())!;
    expect(again.height).toBeGreaterThanOrEqual(44);
  });
}
