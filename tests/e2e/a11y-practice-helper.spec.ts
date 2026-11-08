import { expect, test } from '@playwright/test';
import { axe, INSETS, inspect, scrollTargetCensus } from './a11y-helpers';

test('visual text audit keeps clipped screen-reader names and descriptions accessible', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 360 });
  await page.setContent(`
    <!doctype html><html lang="en"><head><title>Accessible field setup</title>
    <style>
      body { margin: 0; padding: 24px 60px; color: #fff; background: #111; font: 16px sans-serif; }
      button { min-width: 48px; min-height: 48px; color: #fff; background: #111; }
      .description { position: absolute; width: 1px; height: 1px; margin: -1px;
        overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; }
    </style></head><body><main><h1>Practice</h1>
      <button aria-labelledby="field-name" aria-describedby="field-description">
        <span aria-hidden="true">◉</span>
        <span id="field-name" class="description">Field setup</span>
        <span id="field-description" class="description"><span>Opens the full setup.</span></span>
      </button>
    </main></body></html>
  `);

  const control = page.getByRole('button', { name: 'Field setup', exact: true });
  await expect(control).toHaveAccessibleName('Field setup');
  await expect(control).toHaveAccessibleDescription('Opens the full setup.');
  expect(await inspect(page, 'semantic descriptions', { insets: INSETS })).toEqual([]);
  expect((await axe(page, 'semantic descriptions')).fail).toEqual([]);
});

test('visual text audit still rejects genuinely clipped copy, including misleading class names', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 360 });
  await page.setContent(`
    <!doctype html><html lang="en"><head><title>Clipping regression</title>
    <style>
      body { margin: 0; padding: 24px 60px; font: 16px sans-serif; }
      p { width: 80px; overflow: hidden; white-space: nowrap; }
      #tiny-visible { position: absolute; width: 1px; height: 1px; }
      #large-clipped { position: absolute; top: 160px; clip: rect(0, 0, 0, 0); }
    </style></head><body><main>
      <p class="srOnly" data-testid="visible-copy">The complete delivery explanation must remain readable.</p>
      <p id="tiny-visible" data-testid="tiny-visible">An accidentally tiny label without explicit hiding.</p>
      <p id="large-clipped" data-testid="large-clipped">A large clipped label is not a semantic 1 px description.</p>
    </main></body></html>
  `);

  const failures = await inspect(page, 'real clipping');
  for (const id of ['visible-copy', 'tiny-visible', 'large-clipped']) {
    expect(failures).toContainEqual(expect.objectContaining({ rule: 'truncation', target: `[data-testid="${id}"]` }));
  }
});

test('48 px target audit rejects 32 and 44 px controls inside inert larger wrappers', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 360 });
  await page.setContent(`
    <style>
      body { margin: 60px; display: flex; gap: 40px; }
      .wrapper { width: 64px; height: 64px; display: grid; place-items: center; }
      button { box-sizing: border-box; padding: 0; }
    </style>
    <div class="wrapper"><button data-testid="inert-32" style="width:32px;height:32px" aria-label="32 px control"></button></div>
    <div class="wrapper"><button data-testid="inert-44" style="width:44px;height:44px" aria-label="44 px control"></button></div>
  `);
  // Both wrappers own the ±23.5 px edge probes; neither forwards activation to the button.
  const failures = await inspect(page, 'inert wrappers');
  expect(failures.filter((f) => f.rule === 'target-size')).toEqual([
    expect.objectContaining({ target: '[data-testid="inert-32"]', detail: '32×32 px' }),
    expect.objectContaining({ target: '[data-testid="inert-44"]', detail: '44×44 px' }),
  ]);
});

test('48 px target audit accepts an actual button-owned extension, not just a small visible track', async ({
  page,
}) => {
  await page.setViewportSize({ width: 640, height: 360 });
  await page.setContent(`
    <style>
      body { margin: 60px; display: flex; gap: 60px; }
      button { position: relative; width: 32px; height: 32px; padding: 0; border: 0; box-sizing: border-box; }
      #pseudo::before { content: ''; position: absolute; inset: -8px; }
      #descendant span { position: absolute; inset: -8px; }
    </style>
    <button id="pseudo" aria-label="Expanded pseudo target"></button>
    <button id="descendant" aria-label="Expanded child target"><span aria-hidden="true"></span></button>
  `);
  expect((await inspect(page, 'owned extensions')).filter((f) => f.rule === 'target-size')).toEqual([]);
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('button')) {
      el.addEventListener('click', () =>
        el.setAttribute('data-activations', String(Number(el.getAttribute('data-activations') ?? 0) + 1)),
      );
    }
  });
  for (const id of ['pseudo', 'descendant']) {
    const control = page.locator(`#${id}`);
    const r = await control.boundingBox();
    expect(r).not.toBeNull();
    await page.mouse.click(r!.x + r!.width / 2, r!.y + r!.height / 2 - 23.5);
    await expect(control).toHaveAttribute('data-activations', '1');
  }
});

test('scroll census checks below-fold and disabled controls instead of sampling only the first viewport', async ({
  page,
}) => {
  await page.setViewportSize({ width: 640, height: 360 });
  await page.setContent(`
    <style>
      body { margin: 20px; }
      main { height: 180px; width: 300px; overflow-y: auto; }
      button { box-sizing: border-box; width: 48px; height: 48px; padding: 0; }
      .spacer { height: 400px; }
      .wrapper { width: 64px; height: 64px; display: grid; place-items: center; }
    </style>
    <main data-testid="panel">
      <button data-testid="first" aria-label="First"></button><div class="spacer"></div>
      <div class="wrapper"><button disabled data-testid="below-fold" aria-label="Last" style="width:44px;height:44px"></button></div>
    </main>
  `);
  expect((await inspect(page, 'first viewport')).filter((f) => f.rule === 'target-size')).toEqual([]);
  const census = await scrollTargetCensus(page, 'full panel', page.getByTestId('panel'));
  expect(census.targets).toEqual(['first', 'below-fold']);
  expect(census.fail).toContainEqual(
    expect.objectContaining({ rule: 'target-size', target: '[data-testid="below-fold"]' }),
  );
  expect(await page.getByTestId('panel').evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
});

test('scroll census rejects large but clipped, covered or partly off-viewport targets and excludes hidden controls', async ({
  page,
}) => {
  await page.setViewportSize({ width: 640, height: 360 });
  await page.setContent(`
    <style>
      body { margin: 32px; }
      button { box-sizing: border-box; width: 96px; height: 96px; padding: 0; }
      .clip { width: 96px; height: 20px; overflow: hidden; margin-bottom: 16px; }
      .covered { position: relative; width: 96px; height: 96px; margin-bottom: 16px; }
      .overlay { position: absolute; inset: 0; background: #222; }
      #partial { position: fixed; top: -16px; right: 24px; width: 48px; height: 48px; }
      #disabled { width: 48px; height: 48px; }
    </style>
    <main data-testid="panel">
      <div class="clip"><button data-testid="clipped" aria-label="Clipped"></button></div>
      <div class="covered"><button data-testid="covered" aria-label="Covered"></button><div class="overlay" aria-hidden="true"></div></div>
      <button id="partial" data-testid="partial" aria-label="Partial"></button>
      <button id="disabled" data-testid="disabled" disabled aria-label="Disabled but reachable"></button>
      <button data-testid="display-none" style="display:none" aria-label="Not rendered"></button>
      <button data-testid="transparent" style="opacity:0" aria-label="Transparent"></button>
      <div inert><button data-testid="inert" aria-label="Inert"></button></div>
      <div aria-hidden="true"><button data-testid="semantic-hidden" aria-label="Hidden"></button></div>
    </main>
  `);
  // All visible boxes meet 48px; reachability must be a separate check, not a larger-box shortcut.
  expect((await inspect(page, 'nominal boxes')).filter((f) => f.rule === 'target-size')).toEqual([]);
  const census = await scrollTargetCensus(page, 'actual reach', page.getByTestId('panel'));
  expect(census.targets).toEqual(['clipped', 'covered', 'partial', 'disabled']);
  expect(census.fail.filter((f) => f.rule === 'target-reach').map((f) => f.target)).toEqual([
    'clipped',
    'covered',
    'partial',
  ]);
  expect(census.fail.filter((f) => f.target === 'disabled')).toEqual([]);
});
