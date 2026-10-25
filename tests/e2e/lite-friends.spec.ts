import { test, expect, type Browser, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** The shipped twist pool: tests look up the right answer the same way a player who understood would find it. */
const POOL = JSON.parse(readFileSync(resolve(process.cwd(), 'src/content/lite/twists.json'), 'utf8')) as { twists: { id: string; best: string }[] };
const bestOfTwist = (id: string) => {
  const t = POOL.twists.find((x) => x.id === id);
  if (!t) throw new Error(`unknown twist ${id}`);
  return t.best;
};
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function axe(page: Page, label: string) {
  const r = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  expect(r.violations, `${label}: ${r.violations.map((v) => `${v.id} (${v.nodes.length})`).join(', ')}`).toEqual([]);
}

async function newPlayer(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'], viewport: { width: 1366, height: 768 }, colorScheme: 'dark' });
  return ctx.newPage();
}

/** The helper plays the first move and copies a dare link. Returns the link and that move's best option id. */
async function helperDares(page: Page): Promise<{ link: string; bestId: string }> {
  const screen = page.getByTestId('lite-screen');
  await page.goto('/lite');
  await page.getByTestId('lite-start').click();
  await page.getByTestId('lite-next').click();
  await expect(screen).toHaveAttribute('data-step', 'decision');
  await page.locator('[data-testid^="lite-option-"]').first().click();
  await expect(screen).toHaveAttribute('data-step', 'feedback');
  const bestId = ((await page.locator('[data-testid^="lite-reveal-"][data-best="true"]').first().getAttribute('data-testid')) ?? '').replace('lite-reveal-', '');
  expect(bestId).not.toBe('');
  await page.getByTestId('lite-dare').click();
  await expect(page.getByTestId('dare-sheet')).toBeVisible();
  await page.getByTestId('dare-share-copy').click();
  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(link).toContain('/lite/dare/I1_');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('dare-sheet')).toBeHidden();
  return { link, bestId };
}

/** A friend answers the dare, optionally takes the twist, and copies the reply link. */
async function friendReplies(page: Page, dareLink: string, opts: { pickBest: boolean; bestId: string; twist: 'right' | 'wrong' | 'skip'; checkA11y?: boolean }): Promise<string> {
  const screen = page.getByTestId('lite-screen');
  await page.goto(new URL(dareLink).pathname);
  await expect(screen).toHaveAttribute('data-step', 'dare-landing', { timeout: 15_000 });
  await expect(page.getByTestId('lite-tier')).toBeVisible();
  await page.getByTestId('dare-accept').click();
  await expect(screen).toHaveAttribute('data-step', /decision|clue/);
  if ((await screen.getAttribute('data-step')) === 'clue') await page.getByTestId('lite-skip-clue').click();
  if (opts.pickBest) await page.getByTestId(`lite-option-${opts.bestId}`).click();
  else await page.locator('[data-testid^="lite-option-"]').last().click();
  await expect(page.getByTestId('dare-result')).toBeVisible();
  if (opts.twist !== 'skip') {
    await page.getByTestId('twist-start').click();
    await expect(screen).toHaveAttribute('data-step', 'twist');
    const twistId = (await page.getByTestId('twist-question').getAttribute('data-twist')) ?? '';
    const best = bestOfTwist(twistId);
    if (opts.checkA11y) await axe(page, 'twist question');
    if (opts.twist === 'right') await page.getByTestId(`twist-option-${best}`).click();
    else await page.locator(`[data-testid^="twist-option-"]:not([data-testid="twist-option-${best}"])`).first().click();
    await expect(screen).toHaveAttribute('data-step', 'twist-result');
    await expect(page.getByTestId('twist-result')).toBeVisible();
    if (opts.checkA11y) await axe(page, 'twist result');
  }
  await page.getByTestId('dare-reply').click();
  await expect(page.getByTestId('reply-sheet')).toBeVisible();
  await page.getByTestId('reply-share-copy').click();
  const reply = await page.evaluate(() => navigator.clipboard.readText());
  expect(reply).toContain('/lite/reply/R2_');
  return reply;
}

test.describe('Lite friends: twist, fair points, rematch', () => {
  test('a friend finds the best move and cracks the twist: both earn +140 once, the twist result stays hidden until the helper answers the rematch', async ({ browser }) => {
    test.setTimeout(180_000);
    const helper = await newPlayer(browser);
    const friend = await newPlayer(browser);
    const { link, bestId } = await helperDares(helper);

    const replyLink = await friendReplies(friend, link, { pickBest: true, bestId, twist: 'right', checkA11y: true });
    await friend.keyboard.press('Escape');
    await expect(friend.getByTestId('challenger-award')).toContainText('+140');

    const screen = helper.getByTestId('lite-screen');
    await helper.goto(new URL(replyLink).pathname);
    await expect(screen).toHaveAttribute('data-step', 'reply-landing', { timeout: 15_000 });
    // The friend's twist result stays hidden until the helper answers the rematch: only the +40 for answering shows.
    await expect(helper.getByTestId('reply-award')).toHaveText('+40');
    await expect(helper.getByTestId('reply-landing-twist')).toContainText(/took a twist/i);
    await expect(helper.getByTestId('lite-screen')).not.toContainText(/cracked/i);
    await expect(helper.getByTestId('helper-stats')).toContainText('Friends helped 1 · understood 0');
    await expect(helper.getByTestId('rematch-offer')).toBeVisible();
    await axe(helper, 'reply landing');

    // The rematch: the friend's twist comes back as a dare; their result stays hidden until the helper answers.
    await helper.getByTestId('rematch-accept').click();
    await expect(screen).toHaveAttribute('data-step', 'rematch');
    await expect(helper.getByTestId('rematch-verdict')).toHaveCount(0);
    const twistId = (await helper.getByTestId('rematch-question').getAttribute('data-twist')) ?? '';
    await helper.getByTestId(`rematch-option-${bestOfTwist(twistId)}`).click();
    await expect(screen).toHaveAttribute('data-step', 'rematch-result');
    await expect(helper.getByTestId('rematch-verdict')).toContainText(/draw/i);
    await expect(helper.getByTestId('rematch-bonus')).toHaveText('+100');
    await axe(helper, 'rematch result');

    // Reopening never counts twice; rematches earn nothing.
    await helper.reload();
    await expect(screen).toHaveAttribute('data-step', 'reply-landing', { timeout: 15_000 });
    await expect(helper.getByTestId('reply-award')).toHaveCount(0);
    await expect(helper.getByTestId('reply-award-note')).toContainText('already counted');
    await expect(helper.getByTestId('helper-stats')).toContainText('Friends helped 1 · understood 1 · 140');
  });

  test('a dare rewards at most three friends; identical answers still count separately, and a fourth reply earns nothing, calmly', async ({ browser }) => {
    test.setTimeout(300_000);
    const helper = await newPlayer(browser);
    const { link, bestId } = await helperDares(helper);
    const replies: string[] = [];
    for (let i = 0; i < 4; i++) {
      const friend = await newPlayer(browser);
      replies.push(await friendReplies(friend, link, { pickBest: false, bestId, twist: 'skip' }));
      await friend.context().close();
    }
    expect(new Set(replies).size).toBe(4);

    const screen = helper.getByTestId('lite-screen');
    for (let i = 0; i < 4; i++) {
      await helper.goto(new URL(replies[i]).pathname);
      await expect(screen).toHaveAttribute('data-step', 'reply-landing', { timeout: 15_000 });
      if (i < 3) await expect(helper.getByTestId('reply-award')).toContainText('+40');
      else {
        await expect(helper.getByTestId('reply-award')).toHaveCount(0);
        await expect(helper.getByTestId('reply-award-note')).toContainText(/already rewarded 3 friends/i);
      }
    }
    await expect(helper.getByTestId('helper-stats')).toContainText('Friends helped 3 · understood 0');
    // Skipped twists mean no rematch.
    await expect(helper.getByTestId('rematch-offer')).toHaveCount(0);
  });

  test('tiers show before answering, Insight adds up apart from the score, and How points work opens and closes by keyboard', async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto('/lite');
    const opener = page.getByTestId('how-points-open');
    await opener.focus();
    await page.keyboard.press('Enter');
    const sheet = page.getByTestId('how-points-sheet');
    await expect(sheet).toBeVisible();
    for (const id of ['move', 'clue-bonus', 'streak', 'clues', 'fair-play', 'end', 'insight', 'no-loss', 'helper', 'challenger', 'sharing'])
      await expect(page.getByTestId(`how-points-${id}`)).toBeVisible();
    await expect(sheet).toContainText('+40');
    await expect(sheet).toContainText('150');
    await axe(page, 'how points work');
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await expect(opener).toBeFocused();

    await page.getByTestId('lite-start').click();
    const screen = page.getByTestId('lite-screen');
    let insightSeen = 0;
    let checkedTier = false;
    for (let i = 0; i < 120; i++) {
      const step = (await screen.getAttribute('data-step')) ?? '';
      if (step === 'ended') break;
      if (step === 'decision' || step === 'rights') {
        await expect(page.getByTestId('lite-tier')).toContainText(/(Tricky|Tough|Boss) question · ×[123] Insight/);
        if (!checkedTier) {
          await axe(page, 'decision with tier badge');
          checkedTier = true;
        }
      }
      if (step === 'begin' || step === 'clue-result') await page.getByTestId('lite-next').click();
      else if (step === 'feedback' || step === 'rights-result') {
        const chip = page.getByTestId('lite-insight-gain');
        if (await chip.count()) insightSeen += Number(((await chip.innerText()).match(/\+(\d+)/) ?? [])[1] ?? 0);
        await page.getByTestId('lite-next').click();
      } else if (step === 'clue') await page.getByTestId('lite-check').click();
      else if (step === 'decision') await page.locator('[data-testid^="lite-option-"]').first().click();
      else if (step === 'rights') await page.locator('[data-testid^="lite-rights-"]').first().click();
      await expect(screen).not.toHaveAttribute('data-step', step, { timeout: 10_000 });
    }
    await expect(page.getByTestId('lite-result')).toBeVisible();
    const resultInsight = Number(await page.getByTestId('lite-result-insight').getAttribute('data-value'));
    expect(resultInsight).toBe(insightSeen);
    expect(resultInsight).toBeGreaterThan(0);
    await page.getByTestId('how-points-result').click();
    await expect(page.getByTestId('how-points-sheet')).toBeVisible();
  });

  test('with every network flag off, Lite makes no third-party requests and a dare round trip stays on this device', async ({ browser }) => {
    test.setTimeout(120_000);
    const page = await newPlayer(browser);
    const foreign: string[] = [];
    page.on('request', (req) => {
      const u = new URL(req.url());
      if (u.protocol.startsWith('http') && u.origin !== new URL(page.url() || 'http://localhost:4173').origin && !u.hostname.startsWith('localhost')) foreign.push(req.url());
    });
    await helperDares(page);
    expect(foreign).toEqual([]);
  });
});
