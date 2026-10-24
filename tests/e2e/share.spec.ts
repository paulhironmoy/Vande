import { test, expect } from '@playwright/test';
import { decodeChallenge, encodeChallenge } from '../../src/engine/challenge';
import { continueToFinalResult, installClock, playChapterToEnd, startChallenge } from './helpers';

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

const CODE = encodeChallenge({ v: 1, scenario: 'examination-crisis', seed: 777, difficulty: 'standard', opponents: ['exploiter', 'disinfo'] });

test('result card is generated locally, the challenge link copies and decodes, and replay restores the same conditions', async ({ page }) => {
  test.setTimeout(240_000);
  await installClock(page);
  await startChallenge(page, CODE);
  await playChapterToEnd(page);
  await continueToFinalResult(page);

  await page.getByTestId('final-challenge').click();
  const preview = page.getByTestId('share-card-preview');
  await expect(preview).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => preview.evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBe(1200);
  await expect(page.getByTestId('share-sheet').or(page.locator('[role="dialog"]')).first()).toContainText('I held the Republic together. Can you?');
  const shownCode = (await page.getByTestId('challenge-code').innerText()).trim();
  expect(shownCode).toMatch(/^V1-/);

  await page.getByTestId('copy-link').click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('?c=');
  const url = await page.evaluate(() => navigator.clipboard.readText());
  const param = new URL(url).searchParams.get('c');
  expect(param).toBe(shownCode);
  const decoded = decodeChallenge(url);
  expect(decoded?.scenario).toBe('examination-crisis');
  expect(decoded?.seed).toBe(777);
  expect(decoded?.opponents).toEqual(['exploiter', 'disinfo']);
  expect(typeof decoded?.score).toBe('number');

  await page.keyboard.press('Escape');
  await page.getByTestId('final-replay').click();
  const briefing = page.getByTestId('briefing-screen');
  await expect(briefing).toBeVisible({ timeout: 15_000 });
  await expect(briefing).toContainText('Examination Crisis');
  await expect(briefing).toContainText('Grievance Exploiter');
  await expect(briefing).toContainText('Disinformation Cell');
});
