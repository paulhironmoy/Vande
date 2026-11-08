/**
 * The quality tiers as the player meets them (docs/PERFORMANCE.md, "Tiers"): the device check runs discreetly, a device
 * that genuinely fails hears it in product language with one clear action, and settings name only Automatic, Premium,
 * Balanced and Classic, never offering more than the device earned (src/perf/tiers.ts).
 */
import { expect, test, type Page } from '@playwright/test';
import { GPU_ARGS, configure, seen, state, waitFor } from './practice-helpers';
import { record, toDelivery } from './perf-helpers';

test.use({ viewport: { width: 915, height: 412 }, hasTouch: true, ...GPU_ARGS });

/** Words a player must never meet unless the device genuinely fails (and then only behind a disclosure). */
const TECHNICAL = /\b(fps|frames per second|frame rate|gpu|webgl|opengl|shaders?|benchmark|renderer|swiftshader|rasteri[sz]er|tier)\b|full batter view|assisted performance|below (the )?cutoff/i;

/** The text a player can actually see now (visible elements only, closed disclosures excluded). */
async function visibleText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const out: string[] = [];
    const walk = (el: Element) => {
      if (el instanceof HTMLElement) {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || el.hidden || el.getAttribute('aria-hidden') === 'true') return;
        if (el.tagName === 'DETAILS' && !(el as HTMLDetailsElement).open) {
          const summary = el.querySelector('summary');
          if (summary) out.push(summary.textContent ?? '');
          return;
        }
        if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.getAttribute('data-testid') === 'practice-diagnostics') return;
      }
      for (const n of Array.from(el.childNodes)) {
        if (n.nodeType === Node.TEXT_NODE) out.push(n.textContent ?? '');
        else if (n.nodeType === Node.ELEMENT_NODE) walk(n as Element);
      }
    };
    walk(document.body);
    return out.join(' ').replace(/\s+/g, ' ').trim();
  });
}

test('[TIER U6] the device check is discreet, and a device below the cutoff is told in product language with one action', async ({ page }) => {
  test.setTimeout(300_000);
  await record(page);
  // No tier hook: the real check runs (on SwiftShader, a software renderer: genuinely below the cutoff).
  await configure(page, {}, { guidedDone: true, settings: { demoSeen: true } });
  await page.goto('/practice');
  const texts: string[] = [];
  const sample = async () => texts.push(await visibleText(page));
  await sample();
  await page.getByTestId('practice-quick').or(page.getByTestId('practice-random')).first().click();
  // The check runs while the setup is open; the player only ever sees the setup (and a calm wait, if any).
  const notice = page.getByTestId('practice-panel-notice').or(page.getByTestId('practice-compat')).first();
  for (let i = 0; i < 120 && !(await notice.isVisible().catch(() => false)); i++) {
    await sample();
    await page.waitForTimeout(500);
  }
  for (const t of texts) expect(t, 'what the player saw while the check ran').not.toMatch(TECHNICAL);
  const preparing = await seen(page, 'practice-preparing');
  if (preparing) expect(preparing, 'the preparing state').not.toMatch(TECHNICAL);
  // Below: one calm sentence in product language, and the setup's one primary action still leads to play.
  await expect(notice).toBeVisible({ timeout: 120_000 });
  const words = (await notice.innerText()).trim();
  expect(words.length, 'the fallback says something').toBeGreaterThan(10);
  expect(words, 'the fallback message').not.toMatch(TECHNICAL);
  expect(await visibleText(page), 'the whole screen, details closed').not.toMatch(TECHNICAL);
  await page.getByTestId('practice-play-start').or(page.getByTestId('practice-classic')).first().click();
  await toDelivery(page);
  await waitFor(page, ['dead', 'coaching', 'paused'], 180_000);
  expect((await state(page)).stage, 'a device below the cutoff plays Classic').toBe('2d');
  expect(await visibleText(page), 'the Classic play screen').not.toMatch(TECHNICAL);
});

const assessment = (tier: 'full' | 'assisted', profile: 'high' | 'standard' | 'lite') => ({
  webgl2: true,
  hardware: true,
  renderer: 'test',
  shaderCompileMs: 40,
  avgFps: tier === 'full' ? 60 : 50,
  p95FrameMs: 17,
  spikes: 0,
  contextLosses: 0,
  inputToFrameMs: 20,
  memoryGb: 8,
  tier,
  profile,
  reasons: [tier === 'full' ? (profile === 'high' ? 'high_headroom' : 'ok') : 'fps_assisted'],
  toleranceMs: tier === 'full' ? 0 : 12,
});

for (const [label, a, offered] of [
  ['a device that earned Premium', assessment('full', 'high'), ['auto', 'premium', 'balanced', 'classic']],
  ['a device that earned Balanced', assessment('full', 'standard'), ['auto', 'balanced', 'classic']],
  ['an Assisted device', assessment('assisted', 'lite'), ['auto', 'balanced', 'classic']],
] as const) {
  test(`[TIER] settings offer only the player-facing tiers ${label} earned`, async ({ page }) => {
    await page.addInitScript(
      ([x]) => {
        if (!sessionStorage.getItem('seeded')) {
          sessionStorage.setItem('seeded', '1');
          localStorage.setItem('vc:practice:perf', JSON.stringify({ v: 1, appVersion: '1.0.0', assessment: x }));
        }
      },
      [a],
    );
    await configure(page, {}, { guidedDone: true, settings: { demoSeen: true } });
    await page.goto('/practice');
    await page.getByTestId('practice-settings-open').first().click();
    const group = page.getByTestId('practice-settings-quality');
    await expect(group).toBeVisible();
    for (const choice of ['auto', 'premium', 'balanced', 'classic']) {
      const option = page.getByTestId(`practice-settings-quality-${choice}`);
      const usable = (await option.count()) > 0 && (await option.isEnabled());
      expect(usable, `${choice} offered`).toBe((offered as readonly string[]).includes(choice));
    }
    const words = await group.innerText();
    expect(words, 'no technical profile names').not.toMatch(/\b(lite|standard|high)\b/i);
    expect(words).not.toMatch(TECHNICAL);
  });
}
