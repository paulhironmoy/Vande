import { test, expect } from '@playwright/test';
import { decodeChallenge, encodeChallenge } from '../../src/engine/challenge';
import { chooseStyle, continueToFinalResult, fastForwardChapterToEnd, installClock, readNumber } from './helpers';

const CODE = encodeChallenge({
  v: 1,
  scenario: 'examination-crisis',
  seed: 12345,
  difficulty: 'standard',
  opponents: ['exploiter', 'disinfo'],
  score: 70,
});

// Runs in the Full style: the outcome must depend only on the seed, so the clock has to run without waiting for answers.
test('a challenge link shows the terms and reproduces the identical game twice', async ({ browser }) => {
  test.setTimeout(240_000);
  const finals: number[] = [];
  const chapters: number[] = [];
  for (let run = 0; run < 2; run++) {
    const context = await browser.newContext({ colorScheme: 'dark' });
    const page = await context.newPage();
    await installClock(page);
    await chooseStyle(page, 'full');
    await page.goto(`/?c=${encodeURIComponent(CODE)}`);
    const screen = page.getByTestId('challenge-screen');
    await expect(screen).toBeVisible({ timeout: 15_000 });
    await expect(screen).toContainText('Examination Crisis');
    await expect(screen).toContainText(/Score to beat:\s*70/);
    await expect(screen).toContainText(/Standard/);
    await expect(screen).toContainText('Grievance Exploiter');
    await expect(screen).toContainText('Disinformation Cell');
    await expect(screen).toContainText(CODE);

    await page.getByTestId('challenge-accept').click();
    const briefing = page.getByTestId('briefing-screen');
    await expect(briefing).toBeVisible();
    await expect(briefing).toContainText('Examination Crisis');
    await expect(briefing).toContainText('Grievance Exploiter');
    await expect(briefing).toContainText('Disinformation Cell');
    await page.getByTestId('briefing-start').click();
    await expect(page.getByTestId('play-screen')).toBeVisible({ timeout: 20_000 });

    // No decisions at all: the outcome depends only on the seed.
    await fastForwardChapterToEnd(page);
    if (await page.getByTestId('chapter-result-screen').isVisible().catch(() => false)) {
      chapters.push(await readNumber(page, 'chapter-score'));
    }
    await continueToFinalResult(page);
    finals.push(await readNumber(page, 'final-score'));
    await context.close();
  }
  expect(finals[0]).toBe(finals[1]);
  if (chapters.length === 2) expect(chapters[0]).toBe(chapters[1]);
});

// Default (Simple) style: plain-words copy on the challenge screen.
test('an invalid code shows a clear error and a valid code can be entered manually', async ({ page }) => {
  await installClock(page);
  await page.goto('/c/NOT-A-REAL-CODE');
  const screen = page.getByTestId('challenge-screen');
  await expect(screen).toBeVisible({ timeout: 15_000 });
  await expect(screen.getByRole('alert')).toContainText('That code does not work');
  await expect(screen.getByRole('alert')).toContainText('could not be read');
  await expect(page.getByTestId('challenge-accept')).toHaveCount(0);

  await page.getByTestId('challenge-input').fill(CODE);
  await page.getByTestId('challenge-open').click();
  await expect(page.getByTestId('challenge-accept')).toBeVisible();
  await expect(screen).toContainText(/Beat your friend's score:\s*70/);
  await expect(screen).toContainText('The Exam Leak');
  await expect(screen).toContainText('The Rumour Bug');
  await expect(screen).toContainText('Disinformation Cell');
  const spec = decodeChallenge(CODE);
  expect(spec?.scenario).toBe('examination-crisis');
  expect(spec?.seed).toBe(12345);
});

test('a full URL pasted as a code is accepted', async ({ page }) => {
  await installClock(page);
  await page.goto('/c/x');
  await expect(page.getByTestId('challenge-screen')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('challenge-input').fill(`https://example.test/Vande/?c=${CODE}`);
  await page.getByTestId('challenge-open').click();
  await expect(page.getByTestId('challenge-accept')).toBeVisible();
});
