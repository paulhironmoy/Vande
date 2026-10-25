import { test, expect, type Page } from '@playwright/test';

const fmt = (n: number) => n.toLocaleString('en-IN');

/** Plays a Lite run with a fixed policy (scan every clue, first card every time). Returns the final total. */
async function playLite(page: Page): Promise<number> {
  const screen = page.getByTestId('lite-screen');
  for (let i = 0; i < 120; i++) {
    const step = (await screen.getAttribute('data-step')) ?? '';
    if (step === 'ended') break;
    if (step === 'begin' || step === 'feedback' || step === 'clue-result' || step === 'rights-result') await page.getByTestId('lite-next').click();
    else if (step === 'clue') await page.getByTestId('lite-check').click();
    else if (step === 'decision') await page.locator('[data-testid^="lite-option-"]').first().click();
    else if (step === 'rights') await page.locator('[data-testid^="lite-rights-"]').first().click();
    await expect(screen).not.toHaveAttribute('data-step', step, { timeout: 10_000 });
  }
  await expect(page.getByTestId('lite-result')).toBeVisible();
  return Number(await page.getByTestId('lite-score').getAttribute('data-value'));
}

test.describe('Lite: Chapter 1 as a game', () => {
  test('plays to a medal result with points, then a replay starts from zero with a best to beat', async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto('/lite');
    await expect(page.getByTestId('lite-screen')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('lite-start').click();
    const total = await playLite(page);
    expect(total).toBeGreaterThan(0);
    await expect(page.getByTestId('lite-result')).toContainText(/Missions \d\/3/);
    await expect(page.getByTestId('lite-challenge')).toBeVisible();

    await page.getByTestId('lite-again').click();
    const screen = page.getByTestId('lite-screen');
    await expect(screen).toHaveAttribute('data-step', 'begin');
    await expect(page.getByTestId('lite-points')).toContainText('0');
    await expect(screen).toContainText(`Beat your best: ${fmt(total)}`);
  });

  test('a friend challenge link replays the identical game: same choices give the same score', async ({ page, context }) => {
    test.setTimeout(240_000);
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/lite');
    await page.getByTestId('lite-start').click();
    const total = await playLite(page);

    await page.getByTestId('lite-challenge').click();
    await expect(page.getByTestId('lite-share-sheet')).toBeVisible();
    for (const id of ['lite-share', 'lite-share-whatsapp', 'lite-share-telegram', 'lite-share-x', 'lite-share-sms', 'lite-share-email', 'lite-share-copy', 'lite-share-save']) {
      await expect(page.getByTestId(id)).toBeVisible();
    }
    await page.getByTestId('lite-share-copy').click();
    const link = await page.evaluate(() => navigator.clipboard.readText());
    expect(link).toMatch(/\/lite\/L1-[0-9a-z]+-[0-9a-z]+-[0-3]-[0-9a-z]$/i);

    const friend = await context.newPage();
    await friend.goto(new URL(link).pathname);
    await expect(friend.getByTestId('lite-screen')).toContainText(`Beat ${fmt(total)} points`, { timeout: 15_000 });
    await friend.getByTestId('lite-start').click();
    const theirs = await playLite(friend);
    expect(theirs).toBe(total);
    await expect(friend.getByTestId('lite-result')).toContainText(/perfect tie/i);
  });

  test('a tampered challenge link falls back to a fresh game', async ({ page }) => {
    await page.goto('/lite/L1-zzzz-zz-9-q');
    await expect(page.getByTestId('lite-screen')).toContainText(/did not work/i, { timeout: 15_000 });
    await expect(page.getByTestId('lite-start')).toBeVisible();
  });
});

test.describe('Lite dares: one question, before midnight, passed between friends', () => {
  test('dare a friend on a move; they get the same question, see every move revealed, and send their result back for Helper points', async ({ page, context }) => {
    test.setTimeout(180_000);
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const screen = page.getByTestId('lite-screen');
    await page.goto('/lite');
    await page.getByTestId('lite-start').click();
    await page.getByTestId('lite-next').click(); // Begin
    await expect(screen).toHaveAttribute('data-step', 'decision');
    const question = await page.locator('h1').first().innerText();
    await page.locator('[data-testid^="lite-option-"]').first().click();
    await expect(screen).toHaveAttribute('data-step', 'feedback');

    // Every move is revealed, ranked, with the best one marked.
    const reveal = page.getByTestId('lite-reveal');
    await expect(reveal).toBeVisible();
    const rows = reveal.locator('[data-testid^="lite-reveal-"]');
    expect(await rows.count()).toBeGreaterThanOrEqual(3);
    await expect(reveal).toContainText('Best');
    await expect(reveal).toContainText('Your move');

    // Dare a friend on this move.
    await page.getByTestId('lite-dare').click();
    await expect(page.getByTestId('dare-sheet')).toBeVisible();
    await page.getByTestId('dare-hint-1').click();
    await page.getByTestId('dare-share-copy').click();
    const dareLink = await page.evaluate(() => navigator.clipboard.readText());
    expect(dareLink).toContain('/lite/dare/I1_');

    // The friend: countdown, locked answer, optional hint, same question.
    const friend = await context.newPage();
    await friend.goto(new URL(dareLink).pathname);
    const fscreen = friend.getByTestId('lite-screen');
    await expect(fscreen).toHaveAttribute('data-step', 'dare-landing', { timeout: 15_000 });
    await expect(friend.getByTestId('dare-countdown')).toBeVisible();
    await expect(fscreen).toContainText('hidden until you answer');
    await friend.getByTestId('dare-hint-reveal').click();
    await expect(friend.getByTestId('dare-hint')).toContainText('Check the clue');
    await friend.getByTestId('dare-accept').click();
    await expect(fscreen).toHaveAttribute('data-step', /decision|clue/);
    if ((await fscreen.getAttribute('data-step')) === 'clue') await friend.getByTestId('lite-skip-clue').click();
    await expect(friend.locator('h1').first()).toHaveText(question);
    await friend.locator('[data-testid^="lite-option-"]').last().click();
    await expect(fscreen).toHaveAttribute('data-step', 'feedback');
    await expect(friend.getByTestId('dare-result')).toBeVisible();
    await expect(friend.getByTestId('lite-reveal')).toBeVisible();

    // Send the result back; the original player earns Helper points once.
    await friend.getByTestId('dare-reply').click();
    await expect(friend.getByTestId('reply-sheet')).toBeVisible();
    await friend.getByTestId('reply-share-copy').click();
    const replyLink = await friend.evaluate(() => navigator.clipboard.readText());
    expect(replyLink).toContain('/lite/reply/R2_');

    await page.goto(new URL(replyLink).pathname);
    await expect(screen).toHaveAttribute('data-step', 'reply-landing', { timeout: 15_000 });
    await expect(page.getByTestId('reply-award')).toBeVisible();
    await expect(page.getByTestId('helper-stats')).toContainText('Friends helped 1');
    await page.reload();
    await expect(screen).toContainText('already counted');
  });
});
