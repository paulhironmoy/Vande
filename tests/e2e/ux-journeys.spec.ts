/**
 * Offline journeys in the real app (production build, no API): first run through Training, a complete Practice
 * Ghosts match, settings, and the hub at 360 px in Hindi and Hinglish with high contrast and reduced motion. Every
 * screen is checked with axe. Run against your own build (see playwright.config.ts):
 *
 *   npx vite build --outDir dist-exp && E2E_PORT=4182 E2E_DIST=dist-exp E2E_OUT=test-results-exp \
 *     npx playwright test tests/e2e/ux-journeys.spec.ts --project=chromium
 */
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const SHOTS = process.env.UX_SHOTS_DIR || join(process.cwd(), 'test-results', 'ux-shots');
mkdirSync(SHOTS, { recursive: true });

test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, launchOptions: { args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] } });

const PLAYER = { id: null, alias: 'Swing King', avatar: { seed: 'k3j2h4g5f6' }, kit: { id: 'starter', primary: '#1E2A78', secondary: '#00B8D9', pattern: 'chevron' } };

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text());
  });
  return errors;
}

async function seed(page: Page, opts: { player?: boolean; settings?: Record<string, unknown> } = {}) {
  await page.addInitScript(
    ([player, settings]) => {
      if (player && !localStorage.getItem('vc:player')) {
        localStorage.setItem('vc:player', JSON.stringify(player));
        localStorage.setItem('vc:age', 'adult');
      }
      if (settings) localStorage.setItem('vc:settings', JSON.stringify(settings));
    },
    [opts.player ? PLAYER : null, opts.settings ?? null] as const,
  );
}

async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).exclude('canvas').analyze();
  return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`);
}

async function noSideScroll(page: Page) {
  return page.evaluate(() => document.scrollingElement!.scrollWidth <= window.innerWidth + 1);
}

/** Holds the release meter for `ms` with the keyboard (a perfect release is near 800 ms). */
async function release(page: Page, ms = 790) {
  await page.getByTestId('execution-meter').focus();
  await page.keyboard.down('Space');
  await page.waitForTimeout(ms);
  await page.keyboard.up('Space');
}

/** Plays one ball: waits for it to be live, then swings with the keyboard. */
async function swing(page: Page) {
  await page.locator('[data-testid=bat-hit][data-live]').waitFor({ timeout: 30_000 });
  await page.waitForTimeout(300);
  await page.getByTestId('bat-hit').focus();
  await page.keyboard.press('Space');
  await page.locator('[data-testid=batting-screen][data-phase=feedback], [data-testid=batting-screen][data-phase=done]').first().waitFor({ timeout: 20_000 });
}

test('first run: the age question, alias, Training (bat, bowl, reveal) in under a minute, then home', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = watchErrors(page);
  await page.goto('/');
  // A normal start offers Practice or Skip; Skip continues to the existing first run.
  await page.getByTestId('launch-skip').click();
  await expect(page).toHaveURL(/\/start$/);
  // The neutral age question comes first: empty, no example year.
  await expect(page.getByTestId('age-screen')).toBeVisible();
  await expect(page.getByTestId('age-year')).toHaveValue('');
  expect(await axe(page)).toEqual([]);
  await page.screenshot({ path: join(SHOTS, 'journey-age.png') });
  await page.getByTestId('age-year').fill('1994');
  await page.getByTestId('age-continue').click();
  // One neutral check before anything is kept.
  await expect(page.getByTestId('age-confirm')).toContainText('You entered 1994. Is that right?');
  await page.getByTestId('age-confirm-yes').click();
  await expect(page.getByTestId('onboarding-screen')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('vc:age'))).toBe('adult');
  expect(await axe(page)).toEqual([]);
  const started = Date.now();
  await page.getByTestId('onboarding-alias').fill('Swing King');
  await page.getByTestId('onboarding-submit').click();
  await expect(page).toHaveURL(/\/train$/);
  await page.getByTestId('bat-next').click();
  // Training shows the batting feedback for 1.5 s and moves on to bowling, which can be quicker than a slow runner
  // (software GL) can poll for it. So the page itself watches for it, armed before the swing.
  const feedback = page.evaluate(
    () =>
      new Promise<{ detail: string; meter: boolean }>((resolve, reject) => {
        const shown = (el: Element | null) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
        const check = () => {
          const detail = document.querySelector('[data-testid=bat-feedback-detail]');
          const meter = document.querySelector('[data-testid=bat-timing-meter]');
          if (shown(detail) && shown(meter)) {
            observer.disconnect();
            clearTimeout(timer);
            resolve({ detail: detail!.textContent ?? '', meter: true });
          }
        };
        const observer = new MutationObserver(check);
        const timer = setTimeout(() => {
          observer.disconnect();
          reject(new Error('the batting feedback with its timing meter never appeared'));
        }, 45_000);
        observer.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
        check();
      }),
  );
  await page.locator('[data-testid=bat-hit][data-live]').waitFor({ timeout: 30_000 });
  await page.waitForTimeout(300);
  await page.getByTestId('bat-hit').focus();
  await page.keyboard.press('Space');
  // Timing, contact and aim with the meter: never runs or wickets.
  const seen = await feedback;
  expect(seen.meter).toBe(true);
  expect(seen.detail).not.toMatch(/\d+\s*runs?|wicket|four|six/i);
  expect(seen.detail.trim().length).toBeGreaterThan(0);
  await expect(page.getByTestId('execution-meter')).toBeVisible({ timeout: 10_000 });
  await release(page);
  await page.getByTestId('training-to-reveal').click();
  await expect(page.getByTestId('reveal-screen')).toBeVisible();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(SHOTS, 'journey-training-reveal.png') });
  await page.getByTestId('training-continue').click();
  await expect(page.getByTestId('training-done')).toBeVisible();
  // The tutorial itself (excluding the reveal watched at the player's pace) fits well under a minute.
  expect(Date.now() - started).toBeLessThan(60_000);
  expect(await axe(page)).toEqual([]);
  await page.getByTestId('training-home').click();
  await expect(page.getByTestId('home-screen')).toBeVisible();
  await page.screenshot({ path: join(SHOTS, 'journey-home.png') });
  expect(await axe(page)).toEqual([]);
  expect(errors).toEqual([]);
});

test('Practice Ghosts: plan, lock, bat six balls and the Super Ball, reveal, share card', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = watchErrors(page);
  await seed(page, { player: true });
  await page.goto('/ghosts');
  await expect(page.getByTestId('ghosts-screen')).toBeVisible();
  expect(await axe(page)).toEqual([]);
  await page.getByTestId('ghost-trickster').click();
  await page.getByTestId('ghost-start').click();
  await expect(page.getByTestId('planner-screen')).toBeVisible();
  for (let i = 0; i < 7; i++) {
    await page.getByTestId(`plan-ball-${i}`).click();
    await release(page);
    await page.waitForTimeout(200);
  }
  await expect(page.getByTestId('plan-lock')).toBeEnabled();
  await page.getByTestId('plan-lock').click();
  await page.getByTestId('plan-lock-dialog-confirm').click();
  await expect(page.getByTestId('batting-screen')).toBeVisible({ timeout: 15_000 });
  for (let b = 0; b < 7; b++) {
    if (b === 0) await page.getByTestId('bat-next').click();
    await swing(page);
    const phase = await page.getByTestId('batting-screen').getAttribute('data-phase');
    if (phase === 'done') break;
    await page.getByTestId('bat-next').click();
  }
  await page.getByTestId('bat-done').click();
  await expect(page.getByTestId('reveal-screen')).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: join(SHOTS, 'journey-ghosts-reveal.png') });
  await expect(page.getByTestId('reveal-share')).toBeVisible();
  await expect(page.getByTestId('reveal-rematch')).toBeVisible();
  expect(await axe(page)).toEqual([]);
  expect(errors).toEqual([]);
});

test('settings: accessibility switches apply at once, language changes the whole UI', async ({ page }) => {
  const errors = watchErrors(page);
  await seed(page, { player: true });
  await page.goto('/settings');
  await expect(page.getByTestId('settings-screen')).toBeVisible();
  expect(await axe(page)).toEqual([]);
  await page.getByTestId('settings-high-contrast').click();
  await expect(page.locator('html')).toHaveAttribute('data-contrast', 'high');
  await page.getByTestId('settings-reduced-motion').click();
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');
  await page.getByTestId('settings-text-size-1.3').click();
  await page.getByTestId('settings-language').selectOption('hi');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('सेटिंग्स');
  await expect(page.locator('html')).toHaveAttribute('lang', 'hi');
  expect(await noSideScroll(page)).toBe(true);
  await page.screenshot({ path: join(SHOTS, 'journey-settings-hi-hc.png'), fullPage: true });
  expect(await axe(page)).toEqual([]);
  await page.getByTestId('settings-licences').click();
  // The full notices, searchable.
  await expect(page.getByTestId('licences-full')).toContainText('Permission is hereby granted');
  await page.getByTestId('licences-search').fill('manrope');
  await expect(page.getByTestId('licences-full')).toContainText('SIL OPEN FONT LICENSE');
  await page.screenshot({ path: join(SHOTS, 'journey-licences.png') });
  await page.keyboard.press('Escape');
  expect(errors).toEqual([]);
});

const layouts: Array<[string, Record<string, unknown>]> = [
  ['hi', { locale: 'hi' }],
  ['hi-Latn-high-contrast', { locale: 'hi-Latn', highContrast: true }],
  ['en-reduced-motion-large-text', { locale: 'en', reducedMotion: 'on', textScale: 1.3 }],
];
for (const [name, settings] of layouts) {
  test(`hub and ghosts at 360 px: ${name}`, async ({ page }) => {
    const errors = watchErrors(page);
    await page.setViewportSize({ width: 360, height: 780 });
    await seed(page, { player: true, settings: { reducedMotion: 'system', sound: true, haptics: true, quality: 'auto', textScale: 1, highContrast: false, ...settings } });
    for (const path of ['/', '/ghosts', '/duel', '/nope']) {
      await page.goto(path);
      await page.locator('main').first().waitFor();
      await page.waitForTimeout(600);
      expect(await noSideScroll(page), `${path} scrolls sideways`).toBe(true);
      expect(await axe(page), path).toEqual([]);
      await page.screenshot({ path: join(SHOTS, `journey-360-${name}-${path.replace(/\W+/g, '') || 'home'}.png`), fullPage: true });
    }
    expect(errors).toEqual([]);
  });
}

/** True when the element is fully inside the viewport (no scrolling needed to reach it). */
async function onScreen(page: Page, testId: string) {
  const box = await page.getByTestId(testId).boundingBox();
  const vp = page.viewportSize()!;
  return Boolean(box && box.y >= 0 && box.y + box.height <= vp.height + 1 && box.x >= 0 && box.x + box.width <= vp.width + 1);
}

for (const scale of [1.3, 1.5]) {
  test(`large text ${Math.round(scale * 100)}% at 360×780: BAT, Play and Next ball on screen; no overlap; steps in full`, async ({ page }) => {
    test.setTimeout(240_000);
    const errors = watchErrors(page);
    await page.setViewportSize({ width: 360, height: 780 });
    await seed(page, { player: true, settings: { locale: 'en', reducedMotion: 'system', sound: false, haptics: false, quality: 'auto', textScale: scale, highContrast: false } });
    // Training: the shot, BAT and Play fit without scrolling, and the current step reads in full.
    await page.goto('/train');
    await expect(page.getByTestId('bat-next')).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(500);
    expect(await onScreen(page, 'bat-hit'), 'BAT below the fold').toBe(true);
    expect(await onScreen(page, 'bat-next'), 'Play below the fold').toBe(true);
    const clipped = await page.evaluate(() => [...document.querySelectorAll('ol li[data-state="current"] span')].some((el) => el.scrollWidth > el.clientWidth + 1));
    expect(clipped, 'the current Training step is cut off').toBe(false);
    await page.screenshot({ path: join(SHOTS, `large-${scale}-train-bat.png`) });
    // The bowl step: the meter, then "Watch the reveal", without scrolling.
    await page.getByTestId('bat-next').click();
    await swing(page);
    await expect(page.getByTestId('execution-meter')).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(400);
    expect(await onScreen(page, 'execution-meter'), 'the release meter is below the fold').toBe(true);
    await release(page);
    await expect(page.getByTestId('training-to-reveal')).toBeVisible();
    expect(await onScreen(page, 'training-to-reveal'), '"Watch the reveal" is below the fold').toBe(true);
    await page.screenshot({ path: join(SHOTS, `large-${scale}-train-bowl.png`) });
    // A whole Practice Ghosts innings: Next ball is on screen after every ball.
    await page.goto('/ghosts');
    await page.getByTestId('ghost-anchor').click();
    await page.getByTestId('ghost-start').click();
    await expect(page.getByTestId('planner-screen')).toBeVisible();
    // The field choice: its options never overlap each other.
    const overlap = await page.evaluate(() => {
      const group = document.querySelector('[data-testid=planner-screen] [role=radiogroup]');
      const boxes = [...(group?.querySelectorAll('[role=radio]') ?? [])].map((b) => b.getBoundingClientRect());
      return boxes.some((a, i) => boxes.some((b, j) => i < j && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1));
    });
    expect(overlap, 'field options overlap').toBe(false);
    await page.screenshot({ path: join(SHOTS, `large-${scale}-planner.png`) });
    for (let i = 0; i < 7; i++) {
      await page.getByTestId(`plan-ball-${i}`).click();
      await release(page);
      await page.waitForTimeout(150);
    }
    await page.getByTestId('plan-lock').click();
    await page.getByTestId('plan-lock-dialog-confirm').click();
    await expect(page.getByTestId('batting-screen')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('bat-next').click();
    for (let b = 0; b < 3; b++) {
      await swing(page);
      if ((await page.getByTestId('batting-screen').getAttribute('data-phase')) === 'done') break;
      expect(await onScreen(page, 'bat-next'), `Next ball below the fold after ball ${b + 1}`).toBe(true);
      await page.getByTestId('bat-next').click();
    }
    await page.screenshot({ path: join(SHOTS, `large-${scale}-ghost-innings.png`) });
    expect(errors).toEqual([]);
  });
}

test('under 18: a kind stop that stays, and only the outcome is kept', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  await page.getByTestId('launch-skip').click();
  await expect(page.getByTestId('age-screen')).toBeVisible();
  const year = String(new Date().getFullYear() - 14);
  await page.getByTestId('age-year').fill(year);
  await page.getByTestId('age-continue').click();
  // A typo is one tap from being fixed: nothing is kept until Yes.
  await expect(page.getByTestId('age-confirm')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('vc:age'))).toBeNull();
  await page.screenshot({ path: join(SHOTS, 'journey-age-confirm.png') });
  await page.getByTestId('age-confirm-yes').click();
  await expect(page.getByTestId('age-stop')).toContainText('VANDE Cricket is for players aged 18 and over');
  expect(await page.evaluate(() => localStorage.getItem('vc:age'))).toBe('under');
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain(year);
  await page.reload();
  await expect(page.getByTestId('age-stop')).toBeVisible();
  expect(await axe(page)).toEqual([]);
  await page.screenshot({ path: join(SHOTS, 'journey-age-stop.png') });
  expect(errors).toEqual([]);
});

test('keyboard focus is visible on ghost, link and icon buttons', async ({ page }) => {
  const errors = watchErrors(page);
  await seed(page, { player: true });
  await page.goto('/');
  await page.getByTestId('launch-skip').click();
  await expect(page.getByTestId('home-screen')).toBeVisible();
  // Focus the settings icon button (ghost) the way a keyboard user does.
  const ring = async () =>
    page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      // Controls only (the route focuses its content container for screen readers; that is not a control).
      if (!el || !el.matches('button, a[href], input, select, textarea, [role=button]')) return null;
      const cs = getComputedStyle(el);
      return { id: el.getAttribute('data-testid') ?? el.textContent?.trim().slice(0, 20), shadow: cs.boxShadow, outline: cs.outlineStyle !== 'none' && cs.outlineWidth !== '0px' };
    });
  const seen: Array<{ id: string | null | undefined; shadow: string; outline: boolean }> = [];
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    // Let the ring's transition finish before reading it.
    await page.waitForTimeout(300);
    const r = await ring();
    if (r) seen.push(r);
  }
  const ghost = seen.find((r) => r.id === 'home-settings');
  expect(ghost, 'settings button never focused').toBeTruthy();
  for (const r of seen) expect(r.outline || (r.shadow !== 'none' && /\d+px \d+px \d+px [1-9]/.test(r.shadow)), `no visible focus on ${r.id}: ${r.shadow}`).toBe(true);
  await page.getByTestId('home-settings').focus();
  await page.screenshot({ path: join(SHOTS, 'focus-ghost-button.png') });
  expect(errors).toEqual([]);
});
