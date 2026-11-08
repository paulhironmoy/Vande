/**
 * The control choice against the accessibility bar (DoD CTR-08, G-10): the Setup row of a device that has not answered, the
 * Practice settings row, and the quiet chip in the over's setup, at 640 x 360 (the smallest supported landscape phone), in
 * English, Hindi and Hinglish, at 200% text, with 1.3x text + high contrast + reduced motion. Each state gets axe (serious and
 * critical fail), 48 px targets, no truncation, safe areas with landscape insets emulated, colour never alone, reduced
 * motion, and a keyboard pass with a visible focus. It reuses the helpers of a11y-practice-screens.spec.ts.
 *
 * Builder checks: automated findings, not a screen-reader session or a human result.
 */
import { expect, test, type Page } from '@playwright/test';
import {
  INSETS,
  axe,
  describeFindings,
  doubleText,
  emulateInsets,
  inspect,
  keyboard,
  settings,
  type Finding,
} from './a11y-helpers';
import { TOUCH_LAPTOP } from './controls-helpers';
import { GPU_ARGS, configure } from './practice-helpers';

test.use({ viewport: { width: 640, height: 360 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, ...GPU_ARGS });

interface Variant {
  name: string;
  textScale: number;
  highContrast: boolean;
  reducedMotion: boolean;
  doubleText: boolean;
  locales: readonly string[];
}
const VARIANTS: readonly Variant[] = [
  {
    name: 'normal',
    textScale: 1,
    highContrast: false,
    reducedMotion: false,
    doubleText: false,
    locales: ['en', 'hi', 'hi-Latn'],
  },
  {
    name: '1.3x text, high contrast, reduced motion',
    textScale: 1.3,
    highContrast: true,
    reducedMotion: true,
    doubleText: false,
    locales: ['en'],
  },
  {
    name: '200% text',
    textScale: 1,
    highContrast: false,
    reducedMotion: false,
    doubleText: true,
    locales: ['en', 'hi'],
  },
];

interface State {
  screen: string;
  /** Practice settings on the device (merged over the a11y helper's returning-player defaults). */
  practice: Record<string, unknown>;
  noCameraApi?: boolean;
  reach: (page: Page) => Promise<void>;
  root: string;
}

const STATES: readonly State[] = [
  {
    screen: 'setup row (a device that has not answered)',
    practice: { demoSeen: false },
    root: 'practice-control-row',
    reach: async (page) => {
      await page.getByTestId('practice-random').click();
    },
  },
  {
    screen: 'setup row with the camera switched off by the browser',
    practice: { demoSeen: false },
    noCameraApi: true,
    root: 'practice-control-row',
    reach: async (page) => {
      await page.getByTestId('practice-random').click();
    },
  },
  {
    screen: 'settings row',
    practice: { control: 'mouse' },
    root: 'practice-settings-control',
    reach: async (page) => {
      await page.getByTestId('practice-settings-open').click();
    },
  },
  {
    screen: 'setup chip opened',
    practice: { control: 'mouse' },
    root: 'practice-control-chip-group',
    reach: async (page) => {
      await page.getByTestId('practice-random').click();
      await page.getByTestId('practice-control-chip-toggle').click();
    },
  },
];

async function audit(page: Page, v: Variant, locale: string, st: State): Promise<Finding[]> {
  const screen = `${locale} ${v.name} · ${st.screen}`;
  const cdp = await page.context().newCDPSession(page);
  const insets = (await emulateInsets(cdp)) ? INSETS : null;
  await page.goto('/');
  await expect(page.getByTestId('practice-menu')).toBeVisible({ timeout: 60_000 });
  await st.reach(page);
  if (v.doubleText) await doubleText(page);
  await expect(page.getByTestId(st.root)).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(400);
  // With CONTROLS_CAPTURE_DIR set, the state is kept as a picture beside the evidence index (before the keyboard pass scrolls it).
  const dir = process.env.CONTROLS_CAPTURE_DIR;
  if (dir) {
    await page.getByTestId(st.root).scrollIntoViewIfNeeded();
    const slug = `${st.screen} ${locale} ${v.name}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    await page.screenshot({ path: `${dir}/${slug}.png` });
  }
  const a = await axe(page, screen);
  return [
    ...a.fail,
    ...(await inspect(page, screen, { insets, reducedMotion: v.reducedMotion, highContrast: v.highContrast })),
    ...(await keyboard(page, screen)),
  ];
}

for (const v of VARIANTS) {
  for (const locale of v.locales) {
    for (const st of STATES) {
      test(`[CTR-08 A11Y1 A11Y2 A11Y6 A11Y7] ${st.screen} at 640x360 in ${locale} (${v.name})`, async ({ page }) => {
        test.setTimeout(120_000);
        if (v.reducedMotion) await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.addInitScript(TOUCH_LAPTOP);
        if (st.noCameraApi)
          await page.addInitScript(() =>
            Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined }),
          );
        await settings(
          page,
          {
            locale,
            textScale: v.textScale,
            highContrast: v.highContrast,
            reducedMotion: v.reducedMotion ? 'on' : 'off',
          },
          st.practice,
        );
        await configure(page, { tier: 'below', timeScale: 2, seed: `controls-a11y-${locale}` });
        const fails = await audit(page, v, locale, st);
        expect(fails, describeFindings(fails)).toEqual([]);
      });
    }
  }
}
