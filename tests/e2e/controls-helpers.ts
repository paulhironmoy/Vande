/** Shared by the controls-*.spec.ts files (DoD CTR-01 to CTR-09). Not a spec: its name does not match the Playwright project. */
import type { Page } from '@playwright/test';
import { practiceEn } from '../../src/i18n/practice/en';

/** The English the screens show, read from the catalog (COPY owns the wording; the specs follow it). */
export const words = (key: keyof typeof practiceEn, params: Record<string, string | number> = {}): string =>
  (practiceEn[key] as string).replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`));

/** A laptop with a touch screen: a finger and a mouse (the matchMedia answers a browser would give). Run in the page. */
export const TOUCH_LAPTOP = () => {
  const real = window.matchMedia.bind(window);
  window.matchMedia = (q: string) => {
    if (q !== '(any-pointer: coarse)' && q !== '(any-pointer: fine)') return real(q);
    return {
      matches: true,
      media: q,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    } as MediaQueryList;
  };
};

/** What the Practice settings hold about the choice: null where the key is absent. */
export const stored = (page: Page) =>
  page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('vc:practice:settings') ?? 'null') as Record<string, unknown> | null;
    return {
      control: (raw?.control as string | undefined) ?? null,
      controlChosen: (raw?.controlChosen as boolean | undefined) ?? null,
    };
  });

/** Moves focus with the Tab key alone until the element with this test id has it. */
export async function tabTo(page: Page, testId: string, max = 80) {
  for (let i = 0; i < max; i++) {
    const at = await page.evaluate(
      () => (document.activeElement as HTMLElement | null)?.getAttribute('data-testid') ?? '',
    );
    if (at === testId) return;
    await page.keyboard.press('Tab');
  }
  throw new Error(`Tab never reached ${testId}`);
}

/** Between balls: the complete setup from the conditions button, the quiet chip, a pick, and the sheet closed again. */
export async function switchBetweenBalls(page: Page, to: 'mouse' | 'touch') {
  await page.getByTestId('practice-conditions').click();
  await page.getByTestId('practice-control-chip-toggle').click();
  await page.getByTestId(`practice-control-chip-group-${to}`).click();
  await page.getByTestId('practice-brief-close').click();
}
