import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/** Moves past begin, clue and fair-play steps (first card) until a move question is on screen. */
async function toNextDecision(page: Page) {
  const screen = page.getByTestId('lite-screen');
  for (let i = 0; i < 40; i++) {
    const step = (await screen.getAttribute('data-step')) ?? '';
    if (step === 'decision') return;
    if (step === 'begin' || step === 'feedback' || step === 'clue-result' || step === 'rights-result') await page.getByTestId('lite-next').click();
    else if (step === 'clue') await page.getByTestId('lite-skip-clue').click();
    else if (step === 'rights') await page.locator('[data-testid^="lite-rights-"]').first().click();
    await expect(screen).not.toHaveAttribute('data-step', step, { timeout: 10_000 });
  }
  throw new Error('no decision reached');
}

test.describe('Lite pictures only where they cannot confuse', () => {
  for (const width of [360, 390, 412]) {
    test(`at ${width} px a picture question shows a picture and a label on every answer, fits, and the next text question shows none`, async ({ browser }) => {
      test.setTimeout(120_000);
      const ctx = await browser.newContext({ viewport: { width, height: 844 }, colorScheme: 'dark' });
      const page = await ctx.newPage();
      await page.goto('/lite');
      await page.getByTestId('lite-start').click();
      await toNextDecision(page);

      // "Students are gathering" passes the gate: all four answers get a picture, never just one.
      const cards = page.locator('[data-testid^="lite-option-"]');
      const n = await cards.count();
      expect(n).toBeGreaterThanOrEqual(3);
      for (let i = 0; i < n; i++) {
        const card = cards.nth(i);
        await expect(card.locator('[data-pictogram]')).toHaveCount(1);
        const box = await card.boundingBox();
        expect(box!.height).toBeGreaterThanOrEqual(44);
        expect(box!.width).toBeGreaterThanOrEqual(44);
        // The label is real text and part of the accessible name; the picture is hidden from assistive tech.
        await expect(card.locator('[data-pictogram]')).toHaveAttribute('aria-hidden', 'true');
      }
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      await page.screenshot({ path: `release/lite-review/visuals/app-question-${width}.png`, fullPage: true });
      if (width === 390) {
        const r = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
        expect(r.violations, r.violations.map((v) => v.id).join(', ')).toEqual([]);
        await page.emulateMedia({ forcedColors: 'active' });
        await page.screenshot({ path: 'release/lite-review/visuals/app-question-390-forced-colors.png', fullPage: true });
        await page.emulateMedia({ forcedColors: 'none' });
      }

      // The reveal shows the same small pictures beside each answer of a picture question.
      await cards.first().click();
      await expect(page.getByTestId('lite-screen')).toHaveAttribute('data-step', 'feedback');
      await expect(page.getByTestId('lite-reveal').locator('[data-pictogram]')).toHaveCount(n);
      if (width === 390) await page.screenshot({ path: 'release/lite-review/visuals/app-reveal-390.png', fullPage: true });

      // The next question is procedural, so the whole question stays text.
      await toNextDecision(page);
      await expect(page.locator('[data-testid^="lite-option-"] [data-pictogram]')).toHaveCount(0);
      await expect(page.locator('[data-testid^="lite-option-"]').first()).toBeVisible();
      await ctx.close();
    });
  }
});
