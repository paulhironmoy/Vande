/**
 * Every Practice screen against the accessibility bar (docs/PERFORMANCE.md, "Accessibility verification"): axe, 48 px
 * targets, no truncation, landscape safe areas and colour-safe status, in English, Hindi and Hinglish, at the normal
 * text size and at 1.3× with high contrast and reduced motion, on the smallest supported landscape phone (640×360).
 *
 * The journey: the Practice home (the launch screen since Stage 1) → the over editor → setup (with the field map) → live (status strip, then the
 * expanded setup) → the results layer (compact, then expanded) → Coach Mode → mastery → the over summary → settings.
 * Screens are reached through the real UI; the test API only fixes the tier (Classic, for a steady software-rendered
 * browser), speeds up time and queues the swings.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import { GPU_ARGS, configure, perfect, queue, block, buildBall, delivered, state, waitFor } from './practice-helpers';
import {
  axe,
  describeFindings,
  doubleText,
  emulateInsets,
  inspect,
  INSETS,
  keyboard,
  scrollTargetCensus,
  settings,
  type Finding,
} from './a11y-helpers';
import { record } from './perf-helpers';

test.use({ viewport: { width: 640, height: 360 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, ...GPU_ARGS });

interface Step {
  screen: string;
  /** The screen's root test id (the first of several that is visible counts). */
  root: string | string[];
  /** From the previous screen to this one, through the real UI. */
  reach: (page: Page) => Promise<void>;
}

/** Clicks the first of these controls to become visible (waiting up to 20 s: screens load and animate in). */
const click = async (page: Page, ...ids: string[]) => {
  const until = Date.now() + 20_000;
  while (Date.now() < until) {
    for (const id of ids) {
      const el = page.getByTestId(id).first();
      if ((await el.isVisible().catch(() => false)) && (await el.isEnabled().catch(() => false))) {
        // A control that is visible and enabled but cannot be tapped (covered by another element) is a finding.
        await el.click({ timeout: 10_000 }).catch((e) => {
          throw new Error(
            `${id} could not be tapped: ${
              String(e)
                .split('\n')
                .find((l) => /intercepts|not stable|outside|detached/.test(l)) ?? String(e).split('\n')[0]
            }`,
          );
        });
        return id;
      }
    }
    await page.waitForTimeout(200);
  }
  throw new Error(`none of ${ids.join(', ')} became visible`);
};

/** Real touch input at the native switch's edges, including the transparent space outside the visual track.
 * Native click counts catch duplicate activation; controlled-state assertions catch a hit on an inert wrapper.
 * The disabled property is set only for this browser probe; the component's disabled prop is covered by unit tests. */
async function switchEdges(page: Page, control: Locator) {
  await control.evaluate((el) => el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }));
  const box = await control.boundingBox();
  const track = await control.locator(':scope > span[aria-hidden="true"]').boundingBox();
  expect(box).not.toBeNull();
  expect(track).not.toBeNull();
  expect(box!.width).toBeGreaterThanOrEqual(48);
  expect(box!.height).toBeGreaterThanOrEqual(48);
  expect(track!.height).toBeLessThan(box!.height);
  const cx = box!.x + box!.width / 2;
  const cy = box!.y + box!.height / 2;
  const top = { x: cx, y: box!.y + 1 };
  const bottom = { x: cx, y: box!.y + box!.height - 1 };
  expect(top.y).toBeLessThan(track!.y);
  expect(bottom.y).toBeGreaterThan(track!.y + track!.height);
  await control.evaluate((el) => {
    const target = el as HTMLButtonElement & { __a11yClick?: EventListener };
    target.dataset.a11yActivations = '0';
    target.__a11yClick = () => {
      target.dataset.a11yActivations = String(Number(target.dataset.a11yActivations) + 1);
    };
    target.addEventListener('click', target.__a11yClick);
  });
  let activations = 0;
  const tap = async ({ x, y }: { x: number; y: number }) => {
    const before = await control.getAttribute('aria-checked');
    await page.touchscreen.tap(x, y);
    await expect(control).toHaveAttribute('aria-checked', before === 'true' ? 'false' : 'true');
    await expect(control).toHaveAttribute('data-a11y-activations', String(++activations));
  };
  try {
    await tap(top);
    await tap(bottom);
    await tap({ x: box!.x + 1, y: cy });
    await tap({ x: box!.x + box!.width - 1, y: cy });
    const before = await control.getAttribute('aria-checked');
    await control.evaluate((el) => {
      (el as HTMLButtonElement).disabled = true;
    });
    await page.touchscreen.tap(top.x, top.y);
    await page.touchscreen.tap(bottom.x, bottom.y);
    await expect(control).toHaveAttribute('aria-checked', before!);
    await expect(control).toHaveAttribute('data-a11y-activations', String(activations));
    await control.evaluate((el) => {
      (el as HTMLButtonElement).disabled = false;
    });
    await tap(top);
    await tap(bottom);
    for (const key of ['Enter', 'Space']) {
      const checked = await control.getAttribute('aria-checked');
      await control.focus();
      await page.keyboard.press(key);
      await expect(control).toHaveAttribute('aria-checked', checked === 'true' ? 'false' : 'true');
      await expect(control).toHaveAttribute('data-a11y-activations', String(++activations));
    }
  } finally {
    await control.evaluate((el) => {
      const target = el as HTMLButtonElement & { __a11yClick?: EventListener };
      target.disabled = false;
      if (target.__a11yClick) target.removeEventListener('click', target.__a11yClick);
      delete target.__a11yClick;
      delete target.dataset.a11yActivations;
    });
  }
}

const STEPS: Step[] = [
  {
    // The Stage 1 launch: the root opens the Practice home (Random Over, Predefined Over, settings).
    screen: 'Practice home (launch)',
    root: 'practice-menu',
    reach: async (page) => {
      await page.goto('/');
      await page
        .getByTestId('launch-practice')
        .click({ timeout: 3_000 })
        .catch(() => undefined);
      // The swings for the deliveries ahead (the test API exists once Practice has loaded).
      await queue(
        page,
        perfect(0),
        block(),
        block(),
        perfect(-25),
        block(),
        perfect(30),
        block(),
        block(),
        block(),
        block(),
      );
    },
  },
  {
    screen: 'over editor',
    root: 'practice-build-screen',
    reach: async (page) => void (await click(page, 'practice-predefined', 'practice-build')),
  },
  {
    screen: 'setup and field map',
    root: 'practice-setup',
    reach: async (page) => {
      await page.goto('/practice');
      await click(page, 'practice-quick', 'practice-random');
    },
  },
  {
    screen: 'live status strip',
    root: 'practice-status',
    reach: async (page) => {
      await click(page, 'practice-play-start', 'practice-radar-go');
      await waitFor(page, ['runup', 'live']);
    },
  },
  {
    screen: 'results layer',
    root: 'practice-result',
    reach: async (page) => void (await waitFor(page, ['dead', 'coaching'], 120_000)),
  },
  {
    screen: 'results layer expanded',
    root: 'practice-result',
    reach: async (page) => {
      await click(page, 'practice-why-toggle', 'practice-alternatives-toggle');
      await expect(page.getByTestId('practice-result')).toHaveAttribute('data-expanded', 'true');
    },
  },
  {
    screen: 'expanded setup (between balls)',
    root: 'practice-brief',
    reach: async (page) => void (await click(page, 'practice-status')),
  },
  {
    screen: 'Coach Mode',
    root: 'practice-coach',
    reach: async (page) => {
      if (
        await page
          .getByTestId('practice-brief')
          .isVisible()
          .catch(() => false)
      )
        await click(page, 'practice-brief-close');
      // From a results layer: the one just shown, or the next ball's if it has moved on.
      if (
        !(await page
          .getByTestId('practice-practice-ball')
          .isVisible()
          .catch(() => false))
      ) {
        await click(page, 'practice-next-ball', 'practice-play-start').catch(() => undefined);
        await waitFor(page, ['dead'], 120_000);
      }
      await click(page, 'practice-practice-ball', 'practice-practice-delivery');
    },
  },
  {
    screen: 'mastery after an exact-ball attempt',
    root: 'practice-mastery',
    reach: async (page) => {
      await click(page, 'practice-replay-exact', 'practice-repeat-again');
      await expect(page.getByTestId('practice-mastery')).toBeVisible({ timeout: 120_000 });
    },
  },
  {
    screen: 'over or innings summary',
    root: ['practice-over-summary', 'practice-out-summary', 'practice-innings-summary'],
    reach: async (page) => {
      await click(page, 'practice-coach-back', 'practice-repeat-back').catch(() => undefined);
      for (let i = 0; i < 8; i++) {
        for (const id of ['practice-over-summary', 'practice-out-summary', 'practice-innings-summary'])
          if (
            await page
              .getByTestId(id)
              .isVisible()
              .catch(() => false)
          )
            return;
        await click(page, 'practice-next-ball', 'practice-play-start').catch(() => undefined);
        await waitFor(page, ['dead', 'coaching', 'over_summary', 'out'], 120_000);
      }
    },
  },
  {
    screen: 'settings',
    root: 'practice-settings',
    reach: async (page) => {
      // From the home: the finished innings is set aside first (as a new session would start).
      await page.evaluate(() => localStorage.removeItem('vc:practice:innings'));
      await page.goto('/');
      await click(page, 'practice-settings-open');
    },
  },
];

async function journey(
  page: Page,
  label: string,
  opts: { reducedMotion?: boolean; highContrast?: boolean; doubleText?: boolean },
) {
  const cdp = await page.context().newCDPSession(page);
  const insets = (await emulateInsets(cdp)) ? INSETS : null;
  const fails: Finding[] = [];
  const notes: Finding[] = [];
  for (const step of STEPS) {
    const screen = `${label} · ${step.screen}`;
    try {
      await step.reach(page);
      if (opts.doubleText) await doubleText(page);
      const roots = Array.isArray(step.root) ? step.root : [step.root];
      await expect(page.locator(roots.map((r) => `[data-testid="${r}"]`).join(', ')).first()).toBeVisible({
        timeout: 60_000,
      });
      await page.waitForTimeout(400);
    } catch (e) {
      fails.push({
        screen,
        rule: 'reachable',
        target: `[data-testid="${[step.root].flat().join('|')}"]`,
        detail: String(e).split('\n')[0].slice(0, 200),
      });
      continue;
    }
    const a = await axe(page, screen);
    fails.push(...a.fail, ...(await inspect(page, screen, { insets, ...opts })));
    notes.push(...a.note);
    // Keyboard reach and focus (A11Y2), except mid-delivery, where nothing but pause is meant to be operable.
    if (!/live status strip/.test(step.screen)) fails.push(...(await keyboard(page, screen)));
    if (step.screen === 'settings') {
      const census = await scrollTargetCensus(page, screen, page.getByTestId('practice-settings'));
      fails.push(...census.fail);
      // Explicit endpoints and intervening sections prove this is a full census, not just a first-fold sample.
      expect(census.targets).toEqual(
        expect.arrayContaining([
          'practice-back',
          'practice-settings-assist-learn',
          'practice-settings-focus',
          'practice-settings-sound',
          'practice-settings-haptics',
          'practice-settings-language-en',
          'practice-settings-text-1.3',
          'practice-settings-contrast',
          'practice-settings-motion-system',
          'practice-settings-quality-classic',
          'practice-settings-clear',
        ]),
      );
      test.info().annotations.push({ type: 'target-census', description: `${screen}: ${census.targets.join(', ')}` });
      await switchEdges(page, page.getByTestId('practice-settings-focus'));
      await page.getByTestId('practice-settings-clear').click();
      await expect(page.getByTestId('practice-clear-dialog')).toBeVisible();
      const confirmation = await scrollTargetCensus(
        page,
        `${screen} · clear confirmation`,
        page.getByTestId('practice-clear-dialog'),
      );
      expect(confirmation.targets).toEqual(['practice-clear-dialog-cancel', 'practice-clear-dialog-confirm']);
      fails.push(...confirmation.fail);
      // Do not clear the data: exercise the real cancellation target and preserve this journey's evidence.
      await page.getByTestId('practice-clear-dialog-cancel').click();
      await expect(page.getByTestId('practice-clear-dialog')).toHaveCount(0);
    }
    // Outcomes are announced only once the ball is dead (after the physical outcome), never before (A11Y3). Checked
    // before the next step reloads the page.
    if (step.screen === 'over or innings summary') {
      const early = await page.evaluate(() => {
        const w = window as unknown as {
          __said?: Array<[number, string]>;
          __perf?: { phases: Array<[number, string, string]> };
        };
        const phases = w.__perf?.phases ?? [];
        return (w.__said ?? []).filter(([t]) => {
          const p = [...phases].reverse().find((x) => x[0] <= t);
          return p && (p[2] === 'live' || p[2] === 'playing');
        });
      });
      for (const [, text] of early)
        fails.push({
          screen,
          rule: 'announce-early',
          target: '[data-testid="practice-announce"]',
          detail: `"${text.slice(0, 80)}" announced while the ball was live`,
        });
      const said = await page.evaluate(() => ((window as unknown as { __said?: unknown[] }).__said ?? []).length);
      if (!said)
        fails.push({
          screen,
          rule: 'announce',
          target: '[data-testid="practice-announce"]',
          detail: 'no outcome was announced during the over',
        });
    }
  }
  test.info().annotations.push({ type: 'notes', description: describeFindings(notes).slice(0, 4000) || 'none' });
  return fails;
}

test('[A11Y7] pause and in-session settings include all scrolled audio and timing controls', async ({ page }) => {
  test.setTimeout(180_000);
  await settings(page, { locale: 'en', sound: true }, { assist: 'learn' });
  // A genuine caught dismissal on the first ball. Restart is intentionally unavailable once out; the separate
  // lawful batting fixture below covers that control.
  // Seed: was 'a11y-en'. Now 'a11y-en-v3-3' (lead-approved reseed, 2026-11-03, for the frozen sim v3 5d physics):
  // 'a11y-en' caught this perfect(0) under v2, but under 5d it is a 0-run middle and the innings bats on. 'a11y-en-v3-3'
  // is the first seed of the ordered search 'a11y-en-v3-<k>' (release/.../wedge/worker/seeds/) whose first ball, the same
  // perfect(0) with Learn at the Classic tier, is genuinely caught. The swing and every assertion are unchanged.
  await configure(page, { tier: 'below', timeScale: 2, seed: 'a11y-en-v3-3' });
  await page.goto('/practice');
  await queue(page, perfect(0));
  await click(page, 'practice-random');
  await click(page, 'practice-play-start');
  await waitFor(page, ['dead'], 120_000);
  expect(await state(page)).toMatchObject({ status: 'out', balls: 1, last: { dismissal: 'caught', swing: 'attack' } });
  expect(await delivered(page)).toEqual({ innings: 1, repeat: 0 });
  await click(page, 'practice-pause');
  const paused = page.getByTestId('practice-paused');
  await expect(paused).toBeVisible();
  const pause = await scrollTargetCensus(page, 'pause panel', paused);
  expect(pause.targets).toEqual(
    expect.arrayContaining(['practice-resume', 'practice-leave', 'practice-sound-toggle', 'practice-pause-settings']),
  );
  expect(pause.targets).not.toContain('practice-restart-over');
  await expect(page.getByTestId('practice-restart-over')).toHaveCount(0);
  expect(pause.fail, describeFindings(pause.fail)).toEqual([]);
  await page.getByTestId('practice-pause-settings').click();
  const panel = page.getByTestId('practice-settings');
  await expect(panel).toBeVisible();
  const census = await scrollTargetCensus(page, 'in-session settings', panel);
  expect(census.targets).toEqual(
    expect.arrayContaining([
      'practice-settings-cue',
      'practice-settings-focus',
      'practice-settings-captions',
      'practice-settings-effects-0',
      'practice-settings-crowd-0.5',
      'practice-settings-music-1',
      'practice-settings-calibrate',
      'practice-settings-clear',
    ]),
  );
  expect(census.fail, describeFindings(census.fail)).toEqual([]);
  await switchEdges(page, page.getByTestId('practice-settings-captions'));
  test.info().annotations.push({
    type: 'target-census',
    description: `pause: ${pause.targets.join(', ')}; in-session settings: ${census.targets.join(', ')}`,
  });
});

test('[A11Y7] an ongoing innings exposes Restart and its reachable confirmation; cancelling preserves the exact ball', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await settings(page, { locale: 'en', sound: true }, { assist: 'learn' });
  // Reuse the already-declared wide-stock continuity fixture from practice-overs.spec.ts. The visible editor
  // supplies a legal plan and the real physics resolves one leave; no forced outcome, seed search or auto-next.
  await configure(page, { tier: 'below', timeScale: 8, seed: 'e2e-wide-continuity' });
  await page.goto('/practice');
  await click(page, 'practice-predefined');
  await click(page, 'practice-build-mode-own');
  for (let i = 0; i < 6; i++) await buildBall(page, 0.45, 5.5, 'stock');
  await click(page, 'practice-build-start');
  await queue(page, 'leave');
  expect(await delivered(page)).toEqual({ innings: 0, repeat: 0 });
  await click(page, 'practice-play-start');
  await waitFor(page, ['dead'], 120_000);
  expect(await state(page)).toMatchObject({
    status: 'batting',
    balls: 1,
    inFlight: null,
    over: { source: 'built' },
    last: { dismissal: null, swing: null },
  });
  expect(await delivered(page)).toEqual({ innings: 1, repeat: 0 });
  const pending = () =>
    page.evaluate(() => (window as unknown as { __vandePractice: { pending(): number } }).__vandePractice.pending());
  expect(await pending()).toBe(0);
  const saved = await page.evaluate(() => localStorage.getItem('vc:practice:innings'));
  expect(saved).not.toBeNull();
  const innings = JSON.parse(saved!).state;
  expect(innings).toMatchObject({
    status: 'batting',
    balls: 1,
    inFlight: null,
    current: { plan: { seed: 'e2e-wide-continuity-0' } },
  });
  expect(innings.current.deliveries).toHaveLength(1);

  await click(page, 'practice-pause');
  const paused = page.getByTestId('practice-paused');
  await expect(paused).toBeVisible();
  const pause = await scrollTargetCensus(page, 'ongoing innings pause', paused);
  expect(pause.targets).toEqual(
    expect.arrayContaining([
      'practice-resume',
      'practice-restart-over',
      'practice-leave',
      'practice-sound-toggle',
      'practice-pause-settings',
    ]),
  );
  expect(pause.fail, describeFindings(pause.fail)).toEqual([]);
  await click(page, 'practice-restart-over');
  const dialog = page.getByTestId('practice-restart-dialog');
  await expect(dialog).toBeVisible();
  const confirmation = await scrollTargetCensus(page, 'restart confirmation', dialog);
  expect(confirmation.targets).toEqual(['practice-restart-dialog-cancel', 'practice-restart-dialog-confirm']);
  expect(confirmation.fail, describeFindings(confirmation.fail)).toEqual([]);
  await click(page, 'practice-restart-dialog-cancel');
  await expect(dialog).toHaveCount(0);
  await expect(paused).toBeVisible();
  expect(await state(page)).toMatchObject({ status: 'batting', phase: 'paused', balls: 1, inFlight: null });
  expect(await delivered(page)).toEqual({ innings: 1, repeat: 0 });
  expect(await pending()).toBe(0);
  // Full saved bytes include id, complete immutable delivery prefix and plan: cancel cannot restart or advance.
  expect(await page.evaluate(() => localStorage.getItem('vc:practice:innings'))).toBe(saved);
  test.info().annotations.push({
    type: 'target-census',
    description: `ongoing pause: ${pause.targets.join(', ')}; restart confirmation: ${confirmation.targets.join(', ')}`,
  });
});

const VARIANTS = [
  {
    name: 'normal',
    textScale: 1,
    highContrast: false,
    reducedMotion: false,
    doubleText: false,
    locales: ['en', 'hi', 'hi-Latn'],
  },
  {
    name: '1.3× text, high contrast, reduced motion',
    textScale: 1.3,
    highContrast: true,
    reducedMotion: true,
    doubleText: false,
    locales: ['en', 'hi', 'hi-Latn'],
  },
  {
    name: '200% text',
    textScale: 1,
    highContrast: false,
    reducedMotion: false,
    doubleText: true,
    locales: ['en', 'hi'],
  },
] as const;

for (const v of VARIANTS) {
  for (const locale of v.locales) {
    test(`[A11Y1 A11Y2 A11Y3 A11Y4 A11Y6 A11Y7] every Practice screen at 640×360 in ${locale} (${v.name})`, async ({
      page,
    }) => {
      test.setTimeout(600_000);
      if (v.reducedMotion) await page.emulateMedia({ reducedMotion: 'reduce' });
      await settings(page, {
        locale,
        textScale: v.textScale,
        highContrast: v.highContrast,
        reducedMotion: v.reducedMotion ? 'on' : 'off',
      });
      await configure(page, { tier: 'below', timeScale: 2, seed: `a11y-${locale}` });
      await record(page);
      // Each change of the polite live region, with its time (compared with the phase log after the over).
      await page.addInitScript(() => {
        const w = window as unknown as { __said?: Array<[number, string]> };
        w.__said = [];
        new MutationObserver(() => {
          const t = (document.querySelector('[data-testid="practice-announce"]')?.textContent ?? '').trim();
          if (t && w.__said!.at(-1)?.[1] !== t) w.__said!.push([performance.now(), t]);
        }).observe(document, { subtree: true, childList: true, characterData: true });
      });
      const fails = await journey(page, `${locale} ${v.name}`, {
        reducedMotion: v.reducedMotion,
        highContrast: v.highContrast,
        doubleText: v.doubleText,
      });
      expect(fails, describeFindings(fails)).toEqual([]);
    });
  }
}
