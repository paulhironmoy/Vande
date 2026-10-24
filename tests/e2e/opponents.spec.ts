import { test, expect } from '@playwright/test';
import { gotoApp, installClock, passIntro } from './helpers';

test('opponent selection allows 1–5, defaults to two at standard, and shows behaviour, difficulty and pressure', async ({ page }) => {
  await installClock(page);
  await gotoApp(page);
  await passIntro(page);

  const ids = ['exploiter', 'provocateur', 'disinfo', 'sabotage', 'overreaction'];
  for (const id of ids) {
    await expect(page.getByTestId(`opponent-card-${id}`)).toBeVisible();
  }
  const pressed = async (id: string) => (await page.getByTestId(`opponent-toggle-${id}`).getAttribute('aria-pressed')) === 'true';
  const selected = [] as string[];
  for (const id of ids) if (await pressed(id)) selected.push(id);
  expect(selected.length).toBe(2);
  const std = page.getByTestId('difficulty-standard');
  await expect.poll(async () => (await std.getAttribute('aria-checked')) === 'true' || (await std.getAttribute('aria-pressed')) === 'true').toBe(true);

  // Try to deselect everything: the screen must either keep at least one selected or disable confirm.
  for (const id of selected) await page.getByTestId(`opponent-toggle-${id}`).click();
  let remaining = 0;
  for (const id of ids) if (await pressed(id)) remaining++;
  if (remaining === 0) await expect(page.getByTestId('opponents-confirm')).toBeDisabled();
  else expect(remaining).toBe(1);
  // Select all five.
  for (const id of ids) if (!(await pressed(id))) await page.getByTestId(`opponent-toggle-${id}`).click();
  let all = 0;
  for (const id of ids) if (await pressed(id)) all++;
  expect(all).toBe(5);
  await expect(page.getByTestId('opponents-confirm')).toBeEnabled();
  const card = page.getByTestId('opponent-card-disinfo');
  await expect(card).toContainText(/Disinformation Cell/i);
  await page.getByTestId('difficulty-severe').click();
  await page.getByTestId('opponents-confirm').click();
  await expect(page.getByTestId('briefing-screen')).toBeVisible();
  await expect(page.getByTestId('briefing-screen')).toContainText(/Overreaction Trap/i);
});
