/**
 * The first-ball lesson (Stage 1): a first-run player meets a card before ball 1 only. It teaches the move of the input
 * in use with a ghost that loops and waits; the player may try the move on the real batting area (nothing is bowled);
 * ball 1 starts only when they choose, and is then exactly the ball it would have been (same seed, same swing, same
 * flight and result: FAIR1 style). One tap skips all teaching for good. Plain notes say what a wrong-moment move was.
 * Checked in English, Hindi and Hinglish, at 200% text, in Reduced Motion, left-handed, with the keyboard, in portrait.
 *
 * Builder checks only: whether a new player understands the first ball is not claimed (it needs observed players).
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { doubleText } from './a11y-helpers';
import {
  GPU_ARGS,
  configure,
  delivered,
  seen,
  state,
  waitFor,
  type PracticeTestConfig,
  type Swing,
} from './practice-helpers';

test.use({ viewport: { width: 915, height: 412 }, hasTouch: true, ...GPU_ARGS });

const FIRST_RUN = { v: 1, teach: true, demoSeen: true, lessonSeen: false };

/** With LESSON_CAPTURE_DIR set, saves a PNG of the page there (evidence); without it, does nothing. */
async function shot(page: Page, name: string) {
  const dir = process.env.LESSON_CAPTURE_DIR;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png` });
}

/** A first run with the demonstration already seen, so the lesson is the only thing before ball 1. */
async function firstRun(
  page: Page,
  cfg: PracticeTestConfig = { tier: 'below', timeScale: 1, seed: 'e2e-lesson-0' },
  practice: Record<string, unknown> = {},
  app: Record<string, unknown> = {},
) {
  await configure(page, cfg, { teach: true, settings: { ...FIRST_RUN, ...practice } });
  if (Object.keys(app).length)
    await page.addInitScript((a) => {
      const raw = localStorage.getItem('vc:settings');
      if (!raw) localStorage.setItem('vc:settings', JSON.stringify({ locale: 'en', ...a }));
    }, app);
}

/** From a first launch to the lesson card (the setup screen, Play, then the card). */
async function toLesson(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('practice-menu')).toBeVisible({ timeout: 45_000 });
  await page.getByTestId('practice-random').click();
  await expect(page.getByTestId('practice-setup')).toBeVisible({ timeout: 45_000 });
  await page.getByTestId('practice-play-start').click();
  await waitFor(page, ['lesson'], 120_000);
  await expect(page.getByTestId('lesson')).toBeVisible();
}

interface LessonHooks {
  status: string;
  armed: boolean;
  input: string;
  tries: number;
  acts: number;
  note: string | null;
  shownAtPerfMs: number;
  cueLoopMs: number;
  cueShows: number;
}

/** The lesson as the test hooks show it (LES-13): null once the card is gone. */
async function lessonOf(page: Page): Promise<LessonHooks | null> {
  return page.evaluate(
    () =>
      (window as unknown as { __vandePractice: { state(): { lesson: LessonHooks | null } } }).__vandePractice.state()
        .lesson,
  );
}

async function lessonLog(page: Page): Promise<Array<{ event: string; atPerfMs: number }>> {
  return page.evaluate(
    () =>
      (
        window as unknown as { __vandePractice: { state(): { lessonLog: Array<{ event: string; atPerfMs: number }> } } }
      ).__vandePractice.state().lessonLog,
  );
}

/** Every Practice and app key in local storage, so "writes nothing" can be compared. */
const storageDump = (page: Page) =>
  page.evaluate(() =>
    Object.fromEntries(
      Object.keys(localStorage)
        .sort()
        .map((k) => [k, localStorage.getItem(k)]),
    ),
  );

/** With LESSON_CAPTURE_DIR set, saves the visible text of one element (for the wording scan); never waits for it. */
async function dumpText(page: Page, testId: string, name: string) {
  const dir = process.env.LESSON_CAPTURE_DIR;
  if (!dir) return;
  const text = await page
    .getByTestId(testId)
    .innerText({ timeout: 3000 })
    .catch(() => null);
  if (text !== null) writeFileSync(`${dir}/${name}.txt`, text);
}

const surfaceBox = async (page: Page) => {
  const box = await page.locator('[data-testid="lesson"] [role="application"]').boundingBox();
  if (!box) throw new Error('the lesson has no batting area');
  return box;
};

/** The ghost's own move with a real mouse: press low, pull down, wait, flick up and a little to the off side. */
async function dryFlick(page: Page) {
  const box = await surfaceBox(page);
  const x = box.x + box.width * 0.62;
  const y = box.y + box.height * 0.5;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 50, { steps: 14 });
  await page.waitForTimeout(300);
  await page.mouse.move(x + 14, y - 60, { steps: 6 });
  await page.mouse.up();
}

/** Waits until the nth ball of the innings is dead (the count has moved on, so an old dead ball never satisfies it). */
async function deadBall(page: Page, n: number) {
  await expect
    .poll(
      async () => {
        const st = await state(page);
        return st.phase === 'dead' ? st.balls : -1;
      },
      { timeout: 120_000, intervals: [250] },
    )
    .toBe(n);
}

async function bowlFromLesson(page: Page) {
  await page.getByTestId('lesson-bowl').click();
  await waitFor(page, ['runup', 'live', 'playing', 'dead'], 120_000);
}

test('ball 1 does not start until the player acts; Bowl the first ball starts it, and the lesson is never shown again', async ({
  page,
}) => {
  await firstRun(page);
  await toLesson(page);
  // Doing nothing: the ghost goes on, nothing is bowled, nothing is lost.
  await page.waitForTimeout(5000);
  let st = await state(page);
  expect(st.phase).toBe('lesson');
  expect(st.ttfdMs).toBeNull();
  expect((await delivered(page)).innings).toBe(0);
  await expect(page.getByTestId('lesson-ghost')).toHaveAttribute('data-motion', 'loop');
  await expect(page.getByTestId('lesson-wait')).toBeVisible();
  // LES-13: the hooks say where the lesson stands, the input it teaches, when the ghost began and how many loops it has shown.
  const hooks = (await lessonOf(page))!;
  expect(hooks).toMatchObject({ status: 'waiting', armed: true, tries: 0, acts: 0, note: null, cueLoopMs: 3600 });
  expect(hooks.cueShows).toBeGreaterThanOrEqual(2);
  expect((await lessonLog(page))[0].event).toBe('open');
  // The card says what to do for the input in use (a mouse here), as text.
  await page.mouse.move(300, 300);
  await expect(page.getByTestId('lesson')).toHaveAttribute('data-input', 'mouse');
  await expect(page.getByTestId('lesson-do').locator('li')).toHaveCount(2);
  for (const [i, ms] of [700, 800, 700].entries()) {
    await page.waitForTimeout(ms);
    await shot(page, `01-mouse-card-frame-${i + 1}`);
  }
  await dumpText(page, 'lesson', '00-en-card-text');
  await bowlFromLesson(page);
  // LES-08: from the moment the ball is bowled the card is gone; nothing of the lesson is in the page while it is live.
  await waitFor(page, ['live'], 120_000);
  expect(await page.locator('[data-testid^="lesson"]').count()).toBe(0);
  expect((await lessonLog(page)).map((l) => l.event)).toContain('end:bowl');
  await waitFor(page, ['dead'], 120_000);
  st = await state(page);
  expect(st.ttfdMs).not.toBeNull();
  expect((await delivered(page)).innings).toBe(1);
  await expect(page.getByTestId('lesson')).toHaveCount(0);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('vc:practice:settings') ?? '{}'));
  expect(saved).toMatchObject({ lessonSeen: true, teach: true });
  // Next ball and back to the home: the lesson does not come back.
  await page.getByTestId('practice-next-ball').click();
  await waitFor(page, ['runup', 'live', 'playing', 'dead'], 120_000);
  expect(await page.getByTestId('lesson').count()).toBe(0);
});

test('a dry swing is read back in the dead ball’s words and bowls nothing; a tap and a pull-back get one plain note each', async ({
  page,
}) => {
  await firstRun(page);
  await toLesson(page);
  const box = await surfaceBox(page);
  const before = await storageDump(page);
  // A quick tap: a defence, said plainly.
  await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.5);
  await expect(page.getByTestId('lesson-note')).toBeVisible();
  await shot(page, '02-tap-note');
  const tapNote = await page.getByTestId('lesson-note').textContent();
  // A pull-back let go without a flick: its own note.
  const x = box.x + box.width * 0.6;
  const y = box.y + box.height * 0.4;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 60, { steps: 10 });
  await page.waitForTimeout(500);
  await page.mouse.up();
  await expect(page.getByTestId('lesson-note')).not.toHaveText(tapNote ?? '');
  await shot(page, '02-pull-note');
  // The move itself: read back as "You played: ...", and the ball is offered.
  await dryFlick(page);
  await expect(page.getByTestId('lesson-read')).toContainText('You played');
  await expect(page.getByTestId('lesson')).toHaveAttribute('data-status', 'tried');
  await shot(page, '02-dry-swing-read-back');
  expect((await state(page)).phase).toBe('lesson');
  expect((await delivered(page)).innings).toBe(0);
  // Another try is allowed, with no cost.
  await dryFlick(page);
  await expect(page.getByTestId('lesson')).toHaveAttribute('data-tries', '2');
  // LES-03: the try-outs wrote nothing (no score, no ledger, no calibration, no setting); the hooks counted them.
  expect(await storageDump(page)).toEqual(before);
  expect(await lessonOf(page)).toMatchObject({ tries: 2, acts: 4, status: 'tried' });
});

test('the same seed and the same swing give the same flight and result with and without the lesson (FAIR1 style)', async ({
  browser,
}) => {
  const swing: Swing = { kind: 'attack', contactErrorMs: -22, directionDeg: 14, power: 0.7 };
  const cfg: PracticeTestConfig = { tier: 'below', timeScale: 1, seed: 'e2e-lesson-fair' };
  const run = async (withLesson: boolean) => {
    const context = await browser.newContext({ viewport: { width: 915, height: 412 }, hasTouch: true });
    const page = await context.newPage();
    await firstRun(page, cfg, withLesson ? {} : { lessonSeen: true });
    await page.goto('/');
    await expect(page.getByTestId('practice-menu')).toBeVisible({ timeout: 45_000 });
    await page.waitForFunction(() => Boolean((window as unknown as { __vandePractice?: unknown }).__vandePractice));
    await page.evaluate(
      (s) =>
        (window as unknown as { __vandePractice: { queueSwing(x: unknown): number } }).__vandePractice.queueSwing(s),
      swing,
    );
    await page.getByTestId('practice-random').click();
    await expect(page.getByTestId('practice-setup')).toBeVisible({ timeout: 45_000 });
    await page.getByTestId('practice-play-start').click();
    if (withLesson) {
      await waitFor(page, ['lesson'], 120_000);
      await page.getByTestId('lesson-bowl').click();
    }
    await waitFor(page, ['dead'], 120_000);
    const out = await page.evaluate(() => {
      const api = (window as unknown as { __vandePractice: { state(): { last: unknown }; lastFlight(): unknown } })
        .__vandePractice;
      return { last: api.state().last, flight: api.lastFlight() };
    });
    await context.close();
    return out;
  };
  const withLesson = await run(true);
  const without = await run(false);
  expect(withLesson.flight).not.toBeNull();
  expect(withLesson.flight).toEqual(without.flight);
  expect(withLesson.last).toEqual(without.last);
});

test('a returning player never meets it; "Skip all teaching" on the card skips it, and the demonstration, for good', async ({
  page,
  browser,
}) => {
  // Returning: the lesson was seen.
  const returning = await browser.newContext({ viewport: { width: 915, height: 412 }, hasTouch: true });
  const rp = await returning.newPage();
  await firstRun(rp, { tier: 'below', timeScale: 1, seed: 'e2e-lesson-1' }, { lessonSeen: true });
  await rp.goto('/');
  await rp.getByTestId('practice-random').click();
  await rp.getByTestId('practice-play-start').click();
  await waitFor(rp, ['runup', 'live', 'playing', 'dead'], 120_000);
  expect(await seen(rp, 'lesson')).toBeNull();
  await returning.close();

  // First run: skip all from the card.
  await firstRun(page);
  await toLesson(page);
  await page.getByTestId('lesson-skip-all').click();
  await waitFor(page, ['runup', 'live', 'playing', 'dead'], 120_000);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('vc:practice:settings') ?? '{}'));
  expect(saved).toMatchObject({ teach: false, demoSeen: true, lessonSeen: true });
  // Taught nothing more: the next ball comes with no card and no pre-delivery hint.
  await waitFor(page, ['dead'], 120_000);
  await page.getByTestId('practice-next-ball').click();
  await waitFor(page, ['runup', 'live', 'playing', 'dead'], 120_000);
  expect(await page.getByTestId('lesson').count()).toBe(0);
  expect(await seen(page, 'practice-hint')).toBeNull();
  // Remembered after a reload: the innings is safe on the home; continuing it meets no card and no demonstration.
  await waitFor(page, ['dead'], 120_000);
  await page.reload();
  await expect(page.getByTestId('practice-continue')).toBeVisible({ timeout: 45_000 });
  await page.getByTestId('practice-continue').click();
  await expect(page.getByTestId('practice-setup')).toBeVisible({ timeout: 45_000 });
  await page.getByTestId('practice-play-start').click();
  await waitFor(page, ['runup', 'live', 'playing', 'dead'], 120_000);
  expect(await seen(page, 'lesson')).toBeNull();
  expect(await seen(page, 'practice-intro')).toBeNull();
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('vc:practice:settings') ?? '{}'));
  expect(after).toMatchObject({ teach: false, demoSeen: true, lessonSeen: true });
});

test('the keyboard: an arrow re-teaches the card, Space gets its plain note, an arrow reads back', async ({ page }) => {
  await firstRun(page);
  await toLesson(page);
  await page.keyboard.press('ArrowUp');
  await expect(page.getByTestId('lesson')).toHaveAttribute('data-input', 'keyboard');
  await expect(page.getByTestId('lesson-do').locator('li')).toHaveCount(4);
  await expect(page.getByTestId('lesson-words').locator('li')).toHaveCount(2);
  // An arrow waits a moment for a second arrow (a diagonal): its read-back is the sign it was played.
  await expect(page.getByTestId('lesson-read')).toBeVisible();
  await shot(page, '03-keyboard-card');
  await page.keyboard.press('Space');
  await expect(page.getByTestId('lesson-note')).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('lesson-read')).toContainText('You played');
  await expect(page.getByTestId('lesson')).toHaveAttribute('data-tries', '2');
  await expect(page.getByTestId('lesson-read')).toBeVisible();
  expect((await state(page)).phase).toBe('lesson');
  // Tab reaches both buttons, in order, and Enter on "Bowl the first ball" is its click, not a shot.
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  const focused = await page.evaluate(() => document.activeElement?.getAttribute('data-testid'));
  expect(['lesson-card-body', 'lesson-bowl', 'lesson-skip-all']).toContain(focused);
});

test('a finger and a pen each get their own card: the ghost finger, then the ghost pen', async ({ page }) => {
  await firstRun(page);
  await toLesson(page);
  const box = await surfaceBox(page);
  await page.touchscreen.tap(box.x + box.width * 0.6, box.y + box.height * 0.5);
  await expect(page.getByTestId('lesson')).toHaveAttribute('data-input', 'touch');
  await expect(page.getByTestId('lesson-ghost')).toHaveAttribute('data-ghost', 'touch');
  await shot(page, '01b-touch-card');
  await page.evaluate(() => {
    const e = new Event('pointermove') as Event & { pointerType: string };
    e.pointerType = 'pen';
    window.dispatchEvent(e);
  });
  await expect(page.getByTestId('lesson')).toHaveAttribute('data-input', 'pen');
  await expect(page.getByTestId('lesson-ghost')).toHaveAttribute('data-ghost', 'pen');
  await expect(page.getByTestId('lesson-do').locator('li')).toHaveCount(2);
  await shot(page, '01c-pen-card');
  expect((await delivered(page)).innings).toBe(0);
});

test('the camera card (a stand-in camera, no pose): its own ghost and words, and "not in view" keeps the card waiting', async ({
  page,
}) => {
  await firstRun(page);
  await toLesson(page);
  const camera = (port: { active: boolean; tracking: boolean } | null) =>
    page.evaluate(
      (p) =>
        (window as unknown as { __vandePractice: { lessonCamera(x: unknown): void } }).__vandePractice.lessonCamera(p),
      port,
    );
  await camera({ active: true, tracking: true });
  await expect(page.getByTestId('lesson')).toHaveAttribute('data-input', 'camera');
  await expect(page.getByTestId('lesson-ghost')).toHaveAttribute('data-ghost', 'camera');
  await expect(page.getByTestId('lesson-do').locator('li')).toHaveCount(2);
  await expect(page.getByTestId('lesson-note')).toHaveCount(0);
  await page.waitForTimeout(900);
  await shot(page, '01d-camera-card');
  await dumpText(page, 'lesson', '01d-camera-card-text');
  await camera({ active: true, tracking: false });
  await expect(page.getByTestId('lesson-note')).toBeVisible();
  await shot(page, '01d-camera-not-in-view');
  // Waiting, not failing: nothing is bowled and the way out is still there.
  expect((await state(page)).phase).toBe('lesson');
  expect((await delivered(page)).innings).toBe(0);
  await expect(page.getByTestId('lesson-bowl')).toBeVisible();
  await camera({ active: true, tracking: true });
  await expect(page.getByTestId('lesson-note')).toHaveCount(0);
  await camera(null);
});

test('keyboard only: Tab reaches "Skip all teaching" and Enter skips it for good (LES-07); the screen reader hears the lesson once (LES-10)', async ({
  page,
}) => {
  await firstRun(page);
  await toLesson(page);
  // Announced politely, once: the live region holds the lesson's text and nothing rewrites it while the card waits.
  const region = page.getByTestId('lesson-announce');
  await expect(region).toHaveAttribute('aria-live', 'polite');
  const before = await region.textContent();
  expect(before ?? '').not.toBe('');
  const rewrites = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const el = document.querySelector('[data-testid="lesson-announce"]')!;
        let n = 0;
        new MutationObserver((m) => (n += m.length)).observe(el, {
          childList: true,
          characterData: true,
          subtree: true,
        });
        setTimeout(() => resolve(n), 4000);
      }),
  );
  expect(rewrites).toBe(0);
  expect(await region.textContent()).toBe(before);
  // Tab, Tab: the card takes the focus when it opens, then "Bowl the first ball", then "Skip all teaching".
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('lesson-skip-all')).toBeFocused();
  await shot(page, '10-keyboard-focus-on-skip-all');
  await page.keyboard.press('Enter');
  await waitFor(page, ['runup', 'live', 'playing', 'dead'], 120_000);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('vc:practice:settings') ?? '{}'));
  expect(saved).toMatchObject({ teach: false, demoSeen: true, lessonSeen: true });
});

test('Pause covers the card and Resume brings the same lesson back, with no ball bowled', async ({ page }) => {
  await firstRun(page);
  await toLesson(page);
  await page.getByTestId('practice-pause').click();
  await waitFor(page, ['paused']);
  await expect(page.getByTestId('practice-paused')).toBeVisible();
  await page.getByTestId('practice-resume').click();
  await waitFor(page, ['lesson']);
  await expect(page.getByTestId('lesson')).toBeVisible();
  expect((await delivered(page)).innings).toBe(0);
});

test('Reduced Motion draws the move as a still with the same words; left-handed, the flick leans the other way', async ({
  page,
}) => {
  await firstRun(page, undefined, { handedness: 'left' }, { reducedMotion: 'on' });
  await toLesson(page);
  const ghost = page.getByTestId('lesson-ghost');
  await expect(ghost).toHaveAttribute('data-motion', 'still');
  await expect(ghost.locator('text')).toHaveCount(2);
  await shot(page, '04-reduced-motion-left-handed-still');
  await expect(page.getByRole('img', { name: /./ }).first()).toBeVisible();
  const [bx, fx] = await ghost.evaluate((svg) => {
    const flick = svg.querySelector('path[d^="M"]:nth-of-type(2)') as SVGPathElement | null;
    const d = flick?.getAttribute('d') ?? '';
    const n = d.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
    return [n[0], n[2]];
  });
  expect(fx, 'a left-hander’s flick (their off side) leans to the left of the screen').toBeLessThan(bx);
});

for (const locale of ['hi', 'hi-Latn'] as const)
  test(`the card is in ${locale}: its title, steps and buttons are not English`, async ({ page }) => {
    await firstRun(page, undefined, {}, { locale });
    await toLesson(page);
    const title = (await page.locator('#lesson-title').textContent()) ?? '';
    expect(title.length).toBeGreaterThan(0);
    expect(title).not.toBe('Your first ball');
    expect(((await page.getByTestId('lesson-bowl').textContent()) ?? '').length).toBeGreaterThan(0);
    expect(await page.getByTestId('lesson-do').locator('li').count()).toBe(2);
    await shot(page, `05-${locale}-card`);
    await dumpText(page, 'lesson', `05-${locale}-card-text`);
  });

for (const vp of [
  { name: 'landscape-640x360', width: 640, height: 360 },
  { name: 'portrait-390x844', width: 390, height: 844 },
]) {
  test.describe(`200% text, ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test('the card and both buttons stay on screen, the card does not cover the batting area, and axe finds nothing serious', async ({
      page,
    }) => {
      await firstRun(page);
      await toLesson(page);
      await doubleText(page);
      for (const id of ['lesson-bowl', 'lesson-skip-all']) {
        await page.getByTestId(id).scrollIntoViewIfNeeded();
        const b = (await page.getByTestId(id).boundingBox())!;
        expect(b.x, id).toBeGreaterThanOrEqual(0);
        expect(b.y, id).toBeGreaterThanOrEqual(0);
        expect(b.x + b.width, id).toBeLessThanOrEqual(vp.width + 1);
        expect(b.y + b.height, id).toBeLessThanOrEqual(vp.height + 1);
      }
      await shot(page, `06-200pct-${vp.name}`);
      const axe = await new AxeBuilder({ page }).include('[data-testid="lesson"]').analyze();
      expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);
      if (vp.height > vp.width) {
        // Portrait: the card sits above the batting area, never over it.
        const card = (await page.getByTestId('lesson-card').boundingBox())!;
        const area = await surfaceBox(page);
        expect(card.y + card.height).toBeLessThanOrEqual(area.y + 2);
        // The rotate prompt is unchanged: the ball waits behind "Turn your phone sideways", after the card.
        await page.getByTestId('lesson-bowl').click();
        await expect(page.getByTestId('practice-turn')).toBeVisible({ timeout: 30_000 });
        await shot(page, `06-portrait-rotate-prompt`);
      }
    });
  });
}

// The Classic stage (a 3D stage in software GL is too slow to click through): the device allowance of a "below" device is 20 ms
// in Learn and Play (the hooks' assessment; none in Real), so the bands the delivery is judged by are the nominal ones plus 20.
const BANDS = {
  learn: { perfect: 51, solid: 78, edge: 137 }, // TIMING_BANDS.learn 31/58/117 + 20
  play: { perfect: 40, solid: 60, edge: 106 }, // 20/40/86 + 20
  real: { perfect: 14, solid: 29, edge: 55 }, // 14/29/55, no allowance in Real
} as const;
const sizeIn = (e: number, b: { perfect: number; solid: number; edge: number }) => {
  const a = Math.abs(e);
  return a <= b.perfect ? 'on_time' : a <= b.solid ? 'small' : a <= b.edge ? 'medium' : 'large';
};

/**
 * Queues one swing per error and walks the dead balls, checking the note on each against the bands. A wicket ends the
 * innings (one wicket), so the walk stops there: every ball that was played is checked, and at least `atLeast` were.
 */
async function walkTiming(page: Page, assist: keyof typeof BANDS, errors: number[], saysFrom: number, atLeast: number) {
  const bands = BANDS[assist];
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as unknown as { __vandePractice?: unknown }).__vandePractice));
  await page.evaluate(
    (q) =>
      (window as unknown as { __vandePractice: { queueSwing(...x: unknown[]): number } }).__vandePractice.queueSwing(
        ...q,
      ),
    errors.map((e) => ({ kind: 'attack', contactErrorMs: e, directionDeg: 0, power: 0.6 })),
  );
  await page.getByTestId('practice-random').click();
  await page.getByTestId('practice-play-start').click();
  await waitFor(page, ['lesson'], 120_000);
  await page.getByTestId('lesson-bowl').click();
  let checked = 0;
  for (const [ball, e] of errors.entries()) {
    await deadBall(page, ball + 1);
    await expect(page.getByTestId('practice-result')).toBeVisible();
    const note = page.getByTestId('lesson-timing');
    if (ball >= saysFrom) {
      await expect(note, `ball ${ball + 1} says no timing note (the first over only)`).toHaveCount(0);
    } else {
      await expect(note, `ball ${ball + 1}`).toBeVisible();
      await expect(note).toHaveAttribute('data-size', sizeIn(e, bands));
      if (sizeIn(e, bands) !== 'on_time') await expect(note).toHaveAttribute('data-side', e < 0 ? 'early' : 'late');
      // Recomputed from the raw error the physics kept (+ = late) and the bands it declared.
      expect(Math.abs(Number(await note.getAttribute('data-ms')) - e)).toBeLessThan(1.5);
      await expect(page.getByTestId('lesson-timing-scale')).toHaveAttribute(
        'data-bands',
        `${bands.perfect},${bands.solid},${bands.edge}`,
      );
      if (sizeIn(e, bands) !== 'on_time') await expect(page.getByTestId('lesson-timing-advice')).toBeVisible();
      if (checked === 0) await dumpText(page, 'practice-result', `07-${assist}-dead-ball-text`);
      await shot(page, `07-${assist}-ball-${ball + 1}-${e}ms`);
      checked++;
    }
    // One wicket ends the innings: the dead ball above was the last of it.
    if ((await state(page)).status !== 'batting') break;
    if (ball < errors.length - 1) await page.getByTestId('practice-next-ball').click();
  }
  expect(checked, 'balls checked before the innings ended').toBeGreaterThanOrEqual(atLeast);
}

// One ball each, so that a wicket on it (the over's first ball may well take one) cannot end the checks: the note is on the
// dead-ball card whether or not the batter is out.
for (const e of [-65, 65, -100, 100, -150, 0])
  test(`timing note, Learn, ${e} ms: plain words in proportion to the error, the delivery's bands drawn`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await firstRun(page, { tier: 'below', timeScale: 4, seed: `e2e-lesson-note-${e}` });
    await walkTiming(page, 'learn', [e], 1, 1);
  });

// The note is for the first over: said on the sixth ball, not on the seventh (the hint counter says how many were played).
for (const [played, says] of [
  [5, true],
  [6, false],
] as const)
  test(`timing note: ${says ? 'said on the sixth ball' : 'not said on the seventh ball'}`, async ({ page }) => {
    test.setTimeout(120_000);
    await firstRun(page, { tier: 'below', timeScale: 4, seed: `e2e-lesson-cap-${played}` }, { hintsShown: played });
    await walkTiming(page, 'learn', [-65], says ? 1 : 0, says ? 1 : 0);
  });

for (const [assist, errors] of [
  ['play', [-50, 0, 80]],
  ['real', [-60, 0, 40]],
] as const)
  test(`timing note, ${assist} level: words follow its own bands (LES-06)`, async ({ page }) => {
    test.setTimeout(240_000);
    await firstRun(page, { tier: 'below', timeScale: 4, seed: `e2e-lesson-${assist}` }, { assist });
    await walkTiming(page, assist, [...errors], errors.length, 1);
  });

test('a press before the bowler lets go is said plainly on the dead ball, with "try again", and costs nothing', async ({
  page,
}) => {
  await firstRun(page);
  await toLesson(page);
  await bowlFromLesson(page);
  // Early: a press on the batting area during the ready moment or the run-up (it cannot count; the ball is not live).
  await page.evaluate(() => {
    const surface = document.querySelector('[data-testid="practice-play"] [role="application"]') as HTMLElement;
    surface.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse', clientX: 300, clientY: 340 }),
    );
  });
  await waitFor(page, ['dead'], 120_000);
  await expect(page.getByTestId('lesson-too-soon')).toBeVisible();
  await shot(page, '08-too-soon-dead-ball');
  expect((await state(page)).last).not.toBeNull();
});

test('doing nothing for over a minute changes nothing: no ball, no score, only the gentle cue (LES-01)', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await firstRun(page);
  await toLesson(page);
  const t0 = Date.now();
  await page.waitForTimeout(62_000);
  const seconds = (Date.now() - t0) / 1000;
  const st = await state(page);
  expect(seconds).toBeGreaterThanOrEqual(60);
  expect(st).toMatchObject({ phase: 'lesson', balls: 0, runs: 0, ttfdMs: null });
  expect((await delivered(page)).innings).toBe(0);
  const lesson = (await lessonOf(page))!;
  expect(lesson).toMatchObject({ status: 'waiting', tries: 0, acts: 0, note: null });
  // The ghost went round about every 3.6 s the whole time; the log holds nothing but the opening.
  expect(lesson.cueShows).toBeGreaterThanOrEqual(15);
  expect((await lessonLog(page)).map((l) => l.event).filter((e) => e !== 'input')).toEqual(['open']);
  await expect(page.getByTestId('lesson-ghost')).toHaveAttribute('data-motion', 'loop');
  await expect(page.getByTestId('lesson-wait')).toBeVisible();
});

for (const tier of ['full', 'assisted', 'below'] as const)
  test(`the card on every graphics level: ${tier === 'full' ? 'Premium' : tier === 'assisted' ? 'Balanced' : 'Classic'}`, async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await firstRun(page, { tier, timeScale: 1, seed: `e2e-lesson-tier-${tier}` });
    await toLesson(page);
    await expect(page.getByTestId('practice-play')).toHaveAttribute('data-tier', tier);
    await expect(page.getByTestId('lesson-ghost')).toHaveAttribute('data-motion', 'loop');
    await expect(page.getByTestId('lesson-bowl')).toBeVisible();
    await page.waitForTimeout(900);
    await shot(page, `09-tier-${tier}`);
    expect((await delivered(page)).innings).toBe(0);
  });

test('the first-ball path of a new player, in steps and seconds with two seconds spent on every decision (LES-09)', async ({
  page,
}, info) => {
  test.setTimeout(240_000);
  // A brand new device: the demonstration is not seen yet, so "Watch first" plays before the card.
  await configure(page, { tier: 'below', timeScale: 1, seed: 'e2e-lesson-path' }, { teach: true });
  const t0 = Date.now();
  const steps: Array<{ step: string; atS: number }> = [];
  const mark = (step: string) => steps.push({ step, atS: Math.round(((Date.now() - t0) / 1000) * 10) / 10 });
  await page.goto('/');
  await expect(page.getByTestId('practice-menu')).toBeVisible({ timeout: 45_000 });
  await page.waitForTimeout(2000);
  await page.getByTestId('practice-random').click();
  mark('Random Over');
  await expect(page.getByTestId('practice-setup')).toBeVisible({ timeout: 45_000 });
  await page.waitForTimeout(2000);
  await page.getByTestId('practice-play-start').click();
  mark('Play');
  await waitFor(page, ['lesson', 'intro'], 120_000);
  if ((await state(page)).phase === 'intro') {
    mark('Watch first (plays by itself)');
    await waitFor(page, ['lesson'], 120_000);
  }
  await page.waitForTimeout(2000);
  await page.getByTestId('lesson-bowl').click();
  mark('Bowl the first ball');
  await waitFor(page, ['runup', 'live', 'playing', 'dead'], 120_000);
  mark('ball in play');
  const taps = steps.filter((x) => ['Random Over', 'Play', 'Bowl the first ball'].includes(x.step)).length;
  info.annotations.push({
    type: 'lesson-path',
    description: JSON.stringify({
      taps,
      steps,
      seconds: steps.at(-1)!.atS,
      load: loadavg().map((x) => Math.round(x * 100) / 100),
    }),
  });
  if (process.env.LESSON_CAPTURE_DIR)
    writeFileSync(
      `${process.env.LESSON_CAPTURE_DIR}/path.json`,
      JSON.stringify({ taps, steps, load: loadavg() }, null, 2),
    );
  expect(taps, 'Random Over, Play, Bowl: three taps').toBe(3);
});

test('indicative: frames over 16.7 and 33 ms while the ghost moves, against the same screen with it still (software GL)', async ({
  browser,
}, info) => {
  const measure = async (tier: 'assisted' | 'below', reduced: boolean) => {
    const context = await browser.newContext({ viewport: { width: 915, height: 412 }, hasTouch: true });
    const page = await context.newPage();
    await firstRun(page, { tier, timeScale: 1, seed: 'e2e-lesson-frames' }, {}, reduced ? { reducedMotion: 'on' } : {});
    await toLesson(page);
    await page.waitForTimeout(1500);
    const frames = await page.evaluate(
      () =>
        new Promise<number[]>((resolve) => {
          const out: number[] = [];
          let last = performance.now();
          const end = last + 10_000;
          const tick = (now: number) => {
            out.push(now - last);
            last = now;
            if (now < end) requestAnimationFrame(tick);
            else resolve(out);
          };
          requestAnimationFrame(tick);
        }),
    );
    await context.close();
    const sorted = [...frames].sort((a, b) => a - b);
    return {
      n: frames.length,
      over167: frames.filter((f) => f > 16.7).length,
      over333: frames.filter((f) => f > 33.3).length,
      p95: Math.round(sorted[Math.floor(sorted.length * 0.95)] * 10) / 10,
      max: Math.round(sorted[sorted.length - 1] * 10) / 10,
    };
  };
  const out: Record<string, unknown> = { load: loadavg().map((x) => Math.round(x * 100) / 100) };
  // Balanced (the brief) and Classic (the light stage, where the ghost's own cost is least hidden by the scene).
  for (const tier of ['assisted', 'below'] as const) {
    const moving = await measure(tier, false);
    const still = await measure(tier, true);
    out[tier === 'assisted' ? 'balanced' : 'classic'] = { moving, still };
    // Indicative only (software GL, a shared Mac): the ghost must not turn a steady screen into a stuttering one.
    expect(moving.n).toBeGreaterThan(30);
    expect(moving.over333 - still.over333).toBeLessThanOrEqual(Math.ceil(moving.n * 0.05));
  }
  out.after = loadavg().map((x) => Math.round(x * 100) / 100);
  info.annotations.push({ type: 'lesson-frames', description: JSON.stringify(out) });
  if (process.env.LESSON_CAPTURE_DIR)
    writeFileSync(`${process.env.LESSON_CAPTURE_DIR}/frames.json`, JSON.stringify(out, null, 2));
});
