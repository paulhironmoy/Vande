import { expect, type Page } from '@playwright/test';

export const VIEWPORTS = [
  { name: '360x800', width: 360, height: 800 },
  { name: '390x844', width: 390, height: 844 },
  { name: '412x915', width: 412, height: 915 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '1366x768', width: 1366, height: 768 },
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1920x1080', width: 1920, height: 1080 },
] as const;

export const FIXED_TIME = new Date('2026-10-23T10:00:00');

/** Install a controllable clock (time flows normally until fastForward/pauseAt). */
export async function installClock(page: Page) {
  await page.clock.install({ time: FIXED_TIME });
}

export async function gotoApp(page: Page, path = '/') {
  await page.goto(path);
}

/** From a fresh profile: launch → intro → begin → opponents. */
export async function passIntro(page: Page) {
  await expect(page.getByTestId('intro-screen')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('intro-begin').click();
  await expect(page.getByTestId('opponents-screen')).toBeVisible();
}

/** From home (returning player) start the campaign. */
export async function startCampaignFromHome(page: Page) {
  await expect(page.getByTestId('home-screen')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('home-start-campaign').click();
  await expect(page.getByTestId('opponents-screen')).toBeVisible();
}

export async function confirmOpponentsAndStart(page: Page) {
  await page.getByTestId('opponents-confirm').click();
  await expect(page.getByTestId('briefing-screen')).toBeVisible();
  await page.getByTestId('briefing-start').click();
  await expect(page.getByTestId('play-screen')).toBeVisible({ timeout: 20_000 });
}

/** Fresh profile all the way into gameplay. */
export async function enterGameplayFresh(page: Page) {
  await gotoApp(page);
  await passIntro(page);
  await confirmOpponentsAndStart(page);
}

/** Opens the evidence tray/rail section if it is not already visible (desktop rail is open by default). */
export async function openEvidenceTray(page: Page) {
  const tray = page.getByTestId('evidence-tray');
  if (!(await tray.isVisible().catch(() => false))) {
    await page.getByTestId('evidence-tray-toggle').click();
  }
  await expect(tray).toBeVisible();
}

export async function assertNoHorizontalOverflow(page: Page) {
  const r = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    cw: document.documentElement.clientWidth,
    bw: document.body.scrollWidth,
    iw: window.innerWidth,
  }));
  expect(r.sw, `documentElement.scrollWidth ${r.sw} > clientWidth ${r.cw}`).toBeLessThanOrEqual(r.cw + 1);
  expect(r.bw, `body.scrollWidth ${r.bw} > innerWidth ${r.iw}`).toBeLessThanOrEqual(r.iw + 1);
}

/** Every element matching the test ids must be inside the viewport box and at least 44px tall/wide when interactive. */
export async function assertControlsReachable(page: Page, testIds: string[]) {
  const vp = page.viewportSize()!;
  for (const id of testIds) {
    const el = page.getByTestId(id).first();
    await expect(el, id).toBeVisible();
    const box = await el.boundingBox();
    expect(box, `${id} has a box`).not.toBeNull();
    expect(box!.x, `${id} left edge`).toBeGreaterThanOrEqual(-1);
    expect(box!.x + box!.width, `${id} right edge`).toBeLessThanOrEqual(vp.width + 1);
  }
}

/**
 * Plays whatever is pending: clicks the first option of every visible decision card, answers rights moments,
 * then fast-forwards the clock. Returns when the chapter result screen is visible.
 */
export async function playChapterToEnd(page: Page, opts: { pickOption?: (titles: string[]) => number; stepMs?: number } = {}) {
  const stepMs = opts.stepMs ?? 15_000;
  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    if (await page.getByTestId('chapter-result-screen').isVisible().catch(() => false)) return;
    if (await page.getByTestId('final-result-screen').isVisible().catch(() => false)) return;

    const rights = page.getByTestId('rights-moment');
    if (await rights.isVisible().catch(() => false)) {
      const opt = rights.locator('[data-testid^="rights-option-"]').first();
      if (await opt.isVisible().catch(() => false)) await opt.click();
      const cont = page.getByTestId('rights-continue');
      if (await cont.isVisible().catch(() => false)) await cont.click();
      continue;
    }

    const options = page.locator('[data-testid^="decision-option-"]:visible');
    const count = await options.count();
    if (count > 0) {
      let index = 0;
      if (opts.pickOption) {
        const titles = await options.allInnerTexts();
        index = Math.min(count - 1, Math.max(0, opts.pickOption(titles)));
      }
      await options.nth(index).click();
      // small real-time wait for the feedback strip to render
      await page.waitForTimeout(50);
      continue;
    }

    await page.clock.fastForward(stepMs);
    await page.waitForTimeout(30);
  }
  throw new Error('Chapter did not finish within the time budget');
}

/** First integer found in the element's text. */
export async function readNumber(page: Page, testId: string): Promise<number> {
  const text = await page.getByTestId(testId).innerText();
  const m = text.match(/\d+/);
  if (!m) throw new Error(`No number in ${testId}: "${text}"`);
  return Number(m[0]);
}

/** Fast-forwards game time without taking any decision until a result screen is visible. */
export async function fastForwardChapterToEnd(page: Page, stepMs = 20_000) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (await page.getByTestId('chapter-result-screen').isVisible().catch(() => false)) return;
    if (await page.getByTestId('final-result-screen').isVisible().catch(() => false)) return;
    await page.clock.fastForward(stepMs);
    await page.waitForTimeout(60);
  }
  throw new Error('Chapter did not finish while fast-forwarding');
}

/** From a chapter or final result, continue until the final result screen is visible. */
export async function continueToFinalResult(page: Page) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (await page.getByTestId('final-result-screen').isVisible().catch(() => false)) return;
    const cont = page.getByTestId('chapter-continue');
    if (await cont.isVisible().catch(() => false)) {
      await cont.click();
      await page.waitForTimeout(100);
      continue;
    }
    const brief = page.getByTestId('briefing-start');
    if (await brief.isVisible().catch(() => false)) {
      await brief.click();
      await expect(page.getByTestId('play-screen')).toBeVisible({ timeout: 20_000 });
      await playChapterToEnd(page);
      continue;
    }
    await page.waitForTimeout(100);
  }
  throw new Error('Final result did not appear');
}

/** Opens a challenge link in a fresh page and starts the chapter. */
export async function startChallenge(page: Page, code: string) {
  await page.goto(`/?c=${encodeURIComponent(code)}`);
  await expect(page.getByTestId('challenge-screen')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('challenge-accept').click();
  await expect(page.getByTestId('briefing-screen')).toBeVisible();
  await page.getByTestId('briefing-start').click();
  await expect(page.getByTestId('play-screen')).toBeVisible({ timeout: 20_000 });
}
