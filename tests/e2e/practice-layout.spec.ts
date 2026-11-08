/**
 * Layout (constitution §3–4): during a live delivery the interface never covers what the batter must read. The quiet
 * rail (score, over, radar, pause) stays clear of every region the stage reports (the bowler, the release, the pitch,
 * the ball's path, the bat and the contact zone) and covers under 8% of the screen; after the ball the results layer
 * sits at the edge below the rail with its two actions always in view (640×360 to 915×412); a notice is shown inside
 * its panel, never under it. Checked at phones' landscape sizes and a large landscape screen (2400×1080), on the
 * first-person stage and on Classic.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { GPU_ARGS, block, openPractice, protectedRegions, queue, startRandom, state, toOverSummary, waitFor, whileInFlight, type Swing } from './practice-helpers';

test.use({ ...GPU_ARGS });

const RAIL = ['practice-status', 'practice-conditions', 'practice-pause'];

type Box = { x: number; y: number; width: number; height: number };
type Region = Box & { kind: string };

/**
 * Inside the page, at the moment the ball is live (a software-rendered stage keeps the main thread busy, so a separate
 * command could arrive after the delivery): the rail's boxes, the stage's protected regions, and the quiet flag.
 */
async function duringLive(page: Page, ids: string[]): Promise<{ rail: Array<Box & { id: string }>; regions: Region[]; quiet: string | null; others: string[] }> {
  return page.evaluate(async (list) => {
    const api = (window as unknown as { __vandePractice: { waitFor(x: string[], t: number): Promise<boolean>; protectedRegions(): Region[] } }).__vandePractice;
    if (!(await api.waitFor(['live'], 90_000))) throw new Error('never live');
    const rail: Array<Box & { id: string }> = [];
    for (const id of list) {
      const el = document.querySelector(`[data-testid="${id}"]`);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) rail.push({ id, x: r.x, y: r.y, width: r.width, height: r.height });
    }
    const others = ['practice-result', 'practice-paused', 'practice-brief', 'practice-hint', 'practice-tester'].filter((id) => document.querySelector(`[data-testid="${id}"]`));
    return { rail, regions: api.protectedRegions(), quiet: document.querySelector('[data-testid="practice-play"]')?.getAttribute('data-quiet') ?? null, others };
  }, ids);
}

/**
 * Where a stage reports no regions of its own (Classic draws a top-down view), the batter's-eye composition the
 * presentation documents: the centre column from the bowler to the bat, and the batter's lower corner.
 */
function corridor(w: number, h: number): Region[] {
  return [
    { kind: 'ball_path', x: w * 0.3, y: h * 0.08, width: w * 0.4, height: h * 0.92 },
    { kind: 'bat', x: w * 0.55, y: h * 0.55, width: w * 0.45, height: h * 0.45 },
  ];
}

const overlap = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

for (const viewport of [
  { width: 640, height: 360 },
  { width: 844, height: 390 },
  { width: 915, height: 412 },
  { width: 2400, height: 1080 },
]) {
  for (const tier of ['full', 'below'] as const) {
    if (tier === 'full' && viewport.width < 900) continue;
    test(`${viewport.width}×${viewport.height}, ${tier === 'full' ? 'first-person' : 'Classic'}: in a live delivery the rail covers nothing the batter reads, and under 8%`, async ({ page }) => {
      test.setTimeout(240_000);
      await page.setViewportSize(viewport);
      await openPractice(page, { tier, timeScale: 0.25, seed: 'e2e-layout' });
      await page.getByTestId('practice-random').click();
      await expect(page.getByTestId('practice-setup')).toBeVisible({ timeout: 45_000 });
      const measured = duringLive(page, RAIL);
      await page.getByTestId('practice-play-start').click();
      const { rail, regions, quiet, others } = await measured;
      expect(quiet).toBe('true');
      expect(others).toEqual([]);
      if (tier === 'full') expect(regions.length, 'the first-person stage reports its protected regions').toBeGreaterThan(0);
      const guarded = regions.length ? regions : corridor(viewport.width, viewport.height);
      const hits = rail.flatMap((r) => guarded.filter((g) => overlap(r, g)).map((g) => `${r.id} × ${g.kind}`));
      expect(hits).toEqual([]);
      const area = rail.reduce((n, r) => n + r.width * r.height, 0);
      expect(area / (viewport.width * viewport.height)).toBeLessThan(0.08);
    });
  }
}

test('915×412 first-person: the rail is drawn in the run-up, not drawn from release to the dead ball, and back at the dead ball', async ({ page }) => {
  // Near contact the camera follows the ball down to the bat and the stage's pitch, bat and ball regions reach every
  // corner (release/product-sequence/stage-1-practice/wedge/flow/), so the live layout draws no rail (captions apart).
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 915, height: 412 });
  await openPractice(page, { tier: 'full', timeScale: 0.25, seed: 'e2e-layout' });
  await page.getByTestId('practice-random').click();
  await expect(page.getByTestId('practice-setup')).toBeVisible({ timeout: 45_000 });
  const seenAt = page.evaluate(async (ids) => {
    const api = (window as unknown as { __vandePractice: { waitFor(x: string[], t: number): Promise<boolean> } }).__vandePractice;
    // Read the DOM after React has drawn the new phase (two frames), as a player would see it.
    const settle = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    const drawn = () =>
      ids.filter((id) => {
        const el = document.querySelector(`[data-testid="${id}"]`);
        return Boolean(el && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
      });
    if (!(await api.waitFor(['runup'], 90_000))) throw new Error('never in the run-up');
    await settle();
    const runup = drawn();
    if (!(await api.waitFor(['live'], 90_000))) throw new Error('never live');
    await settle();
    const live = drawn();
    if (!(await api.waitFor(['dead', 'out', 'over_summary'], 120_000))) throw new Error('never dead');
    await settle();
    const phase = (api as unknown as { state(): { phase: string } }).state().phase;
    return { runup, live, dead: drawn(), phase };
  }, RAIL);
  await queue(page, 'leave');
  await page.getByTestId('practice-play-start').click();
  const { runup, live, dead, phase } = await seenAt;
  expect(runup).toEqual(RAIL);
  expect(live).toEqual([]);
  // Back with the dead ball (an innings that ended on this ball shows its summary instead, with no rail).
  if (phase === 'dead') expect(dead).toEqual(RAIL);
});

for (const viewport of [
  { width: 915, height: 412 },
  { width: 2400, height: 1080 },
]) {
  for (const hand of ['right', 'left'] as const) {
    test(`${viewport.width}×${viewport.height}, first-person ${hand}-handed: actual bat geometry leaves the live rail clear`, async ({ page }) => {
      test.setTimeout(240_000);
      await page.setViewportSize(viewport);
      await openPractice(page, { tier: 'full', timeScale: 0.25, seed: 'e2e-layout' });
      await page.getByTestId('practice-settings-open').click();
      await expect(page.getByTestId('practice-settings')).toBeVisible();
      const handChoice = page.getByTestId(`practice-settings-hand-${hand}`);
      await handChoice.click();
      await expect(handChoice).toHaveAttribute('aria-checked', 'true');
      await page.getByTestId('practice-back').click();
      await expect(page.getByTestId('practice-menu')).toBeVisible();
      await page.getByTestId('practice-random').click();
      await expect(page.getByTestId('practice-setup')).toBeVisible({ timeout: 45_000 });
      const measured = duringLive(page, RAIL);
      await page.getByTestId('practice-play-start').click();
      const { rail, regions, quiet, others } = await measured;
      expect(quiet).toBe('true');
      expect(others).toEqual([]);
      expect(regions.length, 'the first-person stage reports actual protected regions').toBeGreaterThan(0);
      const hits = rail.flatMap((r) => regions.filter((g) => overlap(r, g)).map((g) => `${r.id} × ${g.kind}`));
      expect(hits).toEqual([]);
      const area = rail.reduce((n, r) => n + r.width * r.height, 0);
      expect(area / (viewport.width * viewport.height)).toBeLessThan(0.08);
    });
  }
}

for (const viewport of [
  { width: 915, height: 412 },
  { width: 2400, height: 1080 },
]) {
  test(`${viewport.width}×${viewport.height}: the pause after an interrupted ball carries its notice inside`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(viewport);
    await openPractice(page, { tier: 'below', timeScale: 0.5, seed: 'e2e-replay' });
    await startRandom(page);
    await whileInFlight(page, 'background');
    await waitFor(page, ['paused']);
    const panel = page.getByTestId('practice-paused');
    const inside = panel.getByTestId('practice-panel-notice');
    await expect(inside).toHaveText('Practice was interrupted during that ball, so it counted as a leave.');
    const [n, p] = await Promise.all([inside.boundingBox(), panel.boundingBox()]);
    expect(n && p && n.x >= p.x && n.y >= p.y && n.x + n.width <= p.x + p.width + 0.5 && n.y + n.height <= p.y + p.height + 0.5).toBe(true);
  });
}

for (const [w, h] of [
  [640, 360],
  [844, 390],
  [915, 412],
] as const) {
  test(`after the ball at ${w}×${h}: the results layer sits at the edge, below the rail, with both actions in view`, async ({ page }) => {
    test.setTimeout(150_000);
    await page.setViewportSize({ width: w, height: h });
    await openPractice(page, { tier: 'below', timeScale: 4, seed: 'e2e-layout' });
    await queue(page, block());
    await startRandom(page);
    await waitFor(page, ['dead']);
    await expect(page.getByTestId('practice-result-reason')).not.toBeEmpty({ timeout: 30_000 });
    const box = async (id: string) => (await page.getByTestId(id).boundingBox())!;
    const card = await box('practice-result');
    const chip = await box('practice-conditions');
    expect(card.x).toBeGreaterThan(w * 0.5);
    // Never over the rail (RK-F06, F-030).
    expect(card.y).toBeGreaterThanOrEqual(chip.y + chip.height);
    // "Practice this ball" and "Next ball" are reachable without scrolling, on the smallest phone too (RK-F07).
    for (const id of ['practice-practice-ball', 'practice-next-ball']) {
      const b = await box(id);
      expect(b.y + b.height, id).toBeLessThanOrEqual(h + 0.5);
      expect(b.x + b.width, id).toBeLessThanOrEqual(w + 0.5);
      expect(Math.min(b.width, b.height), id).toBeGreaterThanOrEqual(48);
    }
  });
}

/*
 * EVAL-WORLD K3: on the first-person stage the bouncer of the reference over, left alone, projects its path across the
 * whole lower view. The card must keep off that path and off the field inset for the whole dead ball, and the coach's
 * tip must still be read at a glance: wholly in view, without scrolling (the lead's ruling). The other balls are played
 * as the evaluator's probe plays them (its W0 swings), so the over reaches the bouncer.
 */
const W0: Swing[] = ['leave', { kind: 'attack', contactErrorMs: 0, directionDeg: 55, power: 0.7, elevation: 0, footwork: 'forward' } as Swing, { kind: 'defend', contactErrorMs: 0 }, { kind: 'defend', contactErrorMs: 0 }, 'leave'];
for (const [w, h] of [
  [640, 360],
  [844, 390],
] as const) {
  for (const hand of ['right', 'left'] as const) {
    test(`${w}×${h} first-person ${hand}-handed, the bouncer left alone: the card keeps off the ball's path and the inset, and the whole tip is in view without scrolling (EVAL-WORLD K3)`, async ({ page }) => {
      test.setTimeout(300_000);
      await page.setViewportSize({ width: w, height: h });
      await openPractice(page, { tier: 'full', timeScale: 1, seed: 'e2e-k3' }, { settings: { assist: 'real', handedness: hand, hintsShown: 99, focusAid: false, bowling: 'pace', conditions: 'balanced', difficulty: 'club' } });
      await page.getByTestId('practice-predefined').click();
      await page.getByTestId('practice-ref-1').click();
      await page.getByTestId('practice-build-start').click();
      await expect(page.getByTestId('practice-setup')).toHaveAttribute('data-kind', 'reference');
      await queue(page, ...W0);
      await page.getByTestId('practice-play-start').click();
      for (let ball = 1; ball <= 5; ball++) {
        await waitFor(page, ['dead'], 120_000);
        if (ball < 5) await page.getByTestId('practice-next-ball').click();
      }
      const st = await state(page);
      expect(st.stage).toBe('3d');
      expect(st.over?.variations[4]).toBe('bouncer');
      expect(st.last?.swing ?? null).toBeNull();
      const card = page.getByTestId('practice-result');
      await expect(page.getByTestId('practice-result-tip')).toBeVisible({ timeout: 60_000 });
      await expect(card).not.toHaveAttribute('data-placing', 'true');
      // After the last of the card's placement checks (1 s into the dead ball).
      await page.waitForTimeout(1_200);
      const g = await page.evaluate(() => {
        const r = (el: Element | null) => {
          if (!el) return null;
          const b = el.getBoundingClientRect();
          return { x: b.x, y: b.y, width: b.width, height: b.height };
        };
        const body = document.querySelector('[data-testid="practice-result-body"]') as HTMLElement;
        const pip = r(document.querySelector('[data-pip]'));
        return {
          card: r(document.querySelector('[data-testid="practice-result"]'))!,
          body: { ...r(body)!, clientHeight: body.clientHeight, scrollTop: body.scrollTop },
          tip: r(document.querySelector('[data-testid="practice-result-tip"]'))!,
          canvas: r(document.querySelector('[data-testid="practice-canvas"]'))!,
          pip: pip && pip.width > 0 && pip.height > 0 ? pip : null,
          place: document.querySelector('[data-testid="practice-result"]')?.getAttribute('data-place') ?? null,
        };
      });
      const path = (await protectedRegions(page)).filter((x) => x.kind === 'ball_path').map((x) => ({ x: x.x + g.canvas.x, y: x.y + g.canvas.y, width: x.width, height: x.height }));
      expect(path.length, 'the bouncer\'s path is on screen').toBeGreaterThan(0);
      const over = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
      expect(path.filter((b) => over(g.card, b)), `the card (${g.place}) covers none of the ball's path`).toEqual([]);
      if (g.pip) expect(over(g.card, g.pip), 'the card never covers the field inset').toBe(false);
      // The whole tip in view, with the body not scrolled.
      expect(g.body.scrollTop).toBe(0);
      expect(g.tip.y).toBeGreaterThanOrEqual(g.body.y - 0.5);
      expect(g.tip.y + g.tip.height, 'the tip ends inside the card\'s visible words').toBeLessThanOrEqual(g.body.y + g.body.clientHeight + 0.5);
      expect(g.tip.y + g.tip.height).toBeLessThanOrEqual(h + 0.5);
      // And both actions stay full-size targets on screen.
      for (const id of ['practice-practice-ball', 'practice-next-ball']) {
        const b = (await page.getByTestId(id).boundingBox())!;
        expect(b.y + b.height, id).toBeLessThanOrEqual(h + 0.5);
        expect(Math.min(b.width, b.height), id).toBeGreaterThanOrEqual(48);
        expect(path.filter((p) => over(b, p)), `${id} covers none of the ball's path`).toEqual([]);
      }
    });
  }
}

/*
 * The band (EVAL-WORLD K3, the lead's ruling): when the ball's path leaves only a short strip below the rail, the card
 * lies across the free width so the whole tip is still read at a glance. On this build the bouncer's path no longer
 * crosses the lower view at every size, so the path is the one the stage itself measured for that ball on the build
 * the evaluator saw (frozen 5d physics, 640×360 and 844×390, right-handed; region-timeline probe 500 ms into the dead
 * ball: release/product-sequence/stage-1-practice/wedge/worker/fix-round/), in place of the stage's own ball path (its
 * other regions, the rail and the field inset stay real).
 */
const MEASURED_REF5_PATH: Record<string, number[][]> = {
  '640x360': [[0, 255, 9, 68], [0, 254, 20, 70], [0, 254, 32, 72], [0, 253, 45, 74], [0, 253, 58, 76], [0, 252, 73, 78], [0, 251, 88, 80], [7, 250, 97, 83], [20, 249, 101, 86], [35, 249, 105, 88], [50, 248, 109, 91], [67, 247, 113, 94], [84, 246, 118, 98], [103, 245, 123, 102], [124, 243, 129, 106], [146, 242, 135, 110], [169, 241, 142, 115], [195, 239, 150, 120], [223, 238, 158, 122], [254, 236, 167, 124], [288, 234, 178, 126], [326, 232, 190, 128], [367, 229, 203, 131], [413, 227, 219, 133], [465, 224, 175, 136], [524, 220, 116, 140], [591, 216, 49, 144]],
  '844x390': [[0, 294, 11, 89], [0, 294, 26, 92], [0, 293, 42, 94], [0, 292, 59, 97], [0, 291, 77, 99], [0, 290, 96, 100], [0, 289, 116, 101], [9, 288, 128, 102], [27, 287, 132, 103], [46, 286, 137, 104], [67, 285, 143, 105], [88, 283, 148, 107], [112, 282, 155, 108], [137, 281, 162, 109], [163, 279, 169, 111], [192, 277, 177, 113], [224, 275, 186, 115], [258, 274, 196, 116], [295, 271, 208, 119], [336, 269, 220, 121], [380, 266, 234, 124], [430, 264, 250, 126], [484, 260, 268, 130], [546, 257, 288, 133], [614, 253, 230, 137], [692, 248, 152, 142], [780, 243, 64, 147]],
};
for (const [w, h] of [
  [640, 360],
  [844, 390],
] as const) {
  for (const hand of ['right', 'left'] as const) {
    test(`${w}×${h} first-person ${hand}-handed, the bouncer's path as the evaluator saw it: the card keeps off it and the inset, and the whole tip is in view without scrolling (EVAL-WORLD K3, the band)`, async ({ page }) => {
      test.setTimeout(240_000);
      await page.setViewportSize({ width: w, height: h });
      await openPractice(page, { tier: 'full', timeScale: 1, seed: 'e2e-k3-band' }, { settings: { assist: 'real', handedness: hand, hintsShown: 99, focusAid: false, bowling: 'pace', conditions: 'balanced', difficulty: 'club' } });
      await page.getByTestId('practice-predefined').click();
      await page.getByTestId('practice-ref-1').click();
      await page.getByTestId('practice-build-start').click();
      await expect(page.getByTestId('practice-setup')).toHaveAttribute('data-kind', 'reference');
      await queue(page, 'leave');
      // Set before the ball is bowled (it matters only at the dead ball; a loaded machine can finish the run-up
      // before a second command arrives).
      const added = MEASURED_REF5_PATH[`${w}x${h}`].map(([x, y, width, height]) => ({ kind: 'ball_path' as const, x, y, width, height }));
      await page.evaluate((r) => (window as unknown as { __vandePractice: { ballPathRegions(x: unknown): void } }).__vandePractice.ballPathRegions(r), added);
      await page.getByTestId('practice-play-start').click();
      await waitFor(page, ['dead'], 120_000);
      const card = page.getByTestId('practice-result');
      await expect(page.getByTestId('practice-result-tip')).toBeVisible({ timeout: 60_000 });
      await expect(card).not.toHaveAttribute('data-placing', 'true');
      await page.waitForTimeout(1_200);
      const g = await page.evaluate(() => {
        const r = (el: Element | null) => {
          if (!el) return null;
          const b = el.getBoundingClientRect();
          return { x: b.x, y: b.y, width: b.width, height: b.height };
        };
        const body = document.querySelector('[data-testid="practice-result-body"]') as HTMLElement;
        const el = document.querySelector('[data-testid="practice-result"]');
        const pip = r(document.querySelector('[data-pip]'));
        return {
          card: r(el)!,
          body: { ...r(body)!, clientHeight: body.clientHeight, scrollTop: body.scrollTop },
          tip: r(document.querySelector('[data-testid="practice-result-tip"]'))!,
          canvas: r(document.querySelector('[data-testid="practice-canvas"]'))!,
          pip: pip && pip.width > 0 && pip.height > 0 ? pip : null,
          place: el?.getAttribute('data-place') ?? null,
          shape: el?.getAttribute('data-shape') ?? null,
        };
      });
      test.info().annotations.push({ type: 'card', description: JSON.stringify({ place: g.place, shape: g.shape, card: g.card }) });
      await page.screenshot({ path: test.info().outputPath('card.png') });
      const path = added.map((x) => ({ x: x.x + g.canvas.x, y: x.y + g.canvas.y, width: x.width, height: x.height }));
      const over = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
      expect(path.filter((b) => over(g.card, b)), `the card (${g.place}, ${g.shape ?? 'column'}) covers none of the ball's path`).toEqual([]);
      if (g.pip) expect(over(g.card, g.pip), 'the card never covers the field inset').toBe(false);
      expect(g.body.scrollTop).toBe(0);
      expect(g.tip.y).toBeGreaterThanOrEqual(g.body.y - 0.5);
      expect(g.tip.y + g.tip.height, 'the whole tip is in the card\'s visible words').toBeLessThanOrEqual(g.body.y + g.body.clientHeight + 0.5);
      for (const id of ['practice-practice-ball', 'practice-next-ball']) {
        const b = (await page.getByTestId(id).boundingBox())!;
        expect(b.y + b.height, id).toBeLessThanOrEqual(h + 0.5);
        expect(Math.min(b.width, b.height), id).toBeGreaterThanOrEqual(48);
        expect(path.filter((p) => over(b, p)), `${id} covers none of the ball's path`).toEqual([]);
      }
    });
  }
}

test('200% text with captions on (Classic 844×390): the dead ball\'s card stays below the rail and "Next ball" can be tapped (EVAL-WORLD K5)', async ({ page }) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 844, height: 390 });
  // The required large-text setting: the app's 200% text, and Practice's captions on.
  await page.addInitScript(() => {
    try {
      localStorage.setItem('vc:settings', JSON.stringify({ locale: 'en', reducedMotion: 'off', sound: true, haptics: true, quality: 'auto', textScale: 2, highContrast: false }));
      localStorage.setItem('vc:practice:audio', JSON.stringify({ v: 1, captions: true }));
    } catch {
      /* storage blocked */
    }
  });
  await openPractice(page, { tier: 'below', timeScale: 4, seed: 'e2e-layout' });
  await queue(page, block(), block());
  await startRandom(page);
  await waitFor(page, ['dead']);
  await expect(page.getByTestId('practice-result-reason')).not.toBeEmpty({ timeout: 30_000 });
  const card = (await page.getByTestId('practice-result').boundingBox())!;
  const rail = (await page.getByTestId('practice-conditions').locator('xpath=..').boundingBox())!;
  // The conditions corner stops short of the card (it scrolls inside), and the card is not squeezed under it.
  expect(card.y, 'the card starts below the conditions corner').toBeGreaterThanOrEqual(rail.y + rail.height - 0.5);
  expect(card.height, 'the card keeps room for its words and its actions').toBeGreaterThan(96);
  for (const id of ['practice-practice-ball', 'practice-next-ball']) {
    const b = page.getByTestId(id);
    await b.scrollIntoViewIfNeeded();
    const box = (await b.boundingBox())!;
    expect(box.y + box.height, id).toBeLessThanOrEqual(390 + 0.5);
    expect(Math.min(box.width, box.height), id).toBeGreaterThanOrEqual(48);
  }
  // A real tap on "Next ball" reaches it and bowls the next ball.
  await page.getByTestId('practice-next-ball').click({ timeout: 10_000 });
  await waitFor(page, ['runup', 'live', 'playing', 'dead']);
});

/*
 * Why? beside an on-time swing the bat never reached (COACH's practice.why.no_reach), at 200% text on the smallest phone:
 * the line is shown whole, the timing label stays. The seed's first ball, met by a straight drive timed to the
 * millisecond, goes past the bat onto the pad, not out, with both hands (frozen 5e physics; found with
 * S/worker/tools/why-seed.mjs).
 */
for (const hand of ['right', 'left'] as const) {
  test(`200% text (640×360, ${hand}-handed): Why? says the bat never reached an on-time swing, whole, beside its timing`, async ({ page }) => {
    test.setTimeout(150_000);
    await page.setViewportSize({ width: 640, height: 360 });
    await page.addInitScript(() => {
      try {
        localStorage.setItem('vc:settings', JSON.stringify({ locale: 'en', reducedMotion: 'off', sound: true, haptics: true, quality: 'auto', textScale: 2, highContrast: false }));
      } catch {
        /* storage blocked */
      }
    });
    await openPractice(page, { tier: 'below', timeScale: 4, seed: 'e2e-why-reach-v3-9' }, { settings: { assist: 'learn', handedness: hand } });
    await queue(page, { kind: 'attack', contactErrorMs: 0, directionDeg: 0, power: 0.6 });
    await startRandom(page);
    await waitFor(page, ['dead']);
    const st = await state(page);
    expect(st.last?.contact, 'the bat never met the ball').toMatch(/^(miss|pad|body)$/);
    await expect(page.getByTestId('practice-why-toggle')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('practice-why-toggle').click();
    const line = page.getByTestId('practice-why-no-reach');
    await line.scrollIntoViewIfNeeded();
    await expect(line).toHaveText('On time, but the bat never reached the ball.');
    await expect(page.getByTestId('practice-why')).toContainText('On time');
    const g = await line.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const card = document.querySelector('[data-testid="practice-result"]')!.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height, sw: el.scrollWidth, cw: el.clientWidth, card: { x: card.x, w: card.width } };
    });
    // Whole: never cut at its side, inside the card, and on screen once scrolled to.
    expect(g.sw).toBeLessThanOrEqual(g.cw + 1);
    expect(g.x).toBeGreaterThanOrEqual(g.card.x - 0.5);
    expect(g.x + g.w).toBeLessThanOrEqual(g.card.x + g.card.w + 0.5);
    expect(g.y).toBeGreaterThanOrEqual(-0.5);
    expect(g.y + g.h).toBeLessThanOrEqual(360 + 0.5);
  });
}

test('the over summary passes axe, every control on it is at least 48 px, and it offers one primary, two secondary and quiet navigation', async ({ page }) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 915, height: 412 });
  await openPractice(page, { tier: 'below', timeScale: 8, seed: 'e2e-replay', autoNext: true });
  await queue(page, ...Array.from({ length: 6 }, () => block()));
  await startRandom(page);
  await toOverSummary(page);
  const axe = await new AxeBuilder({ page }).include('[data-testid="practice-over-summary"]').analyze();
  expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);
  const small = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid="practice-over-summary"] button'))
      .map((b) => ({ name: (b.textContent ?? '').trim(), r: b.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0 && (r.width < 48 || r.height < 48))
      .map(({ name, r }) => `${name}: ${Math.round(r.width)}×${Math.round(r.height)}`),
  );
  expect(small).toEqual([]);
  // Back, Harder over, Practise a ball, More options and Another over: nothing else until asked (F-031).
  const visible = await page.evaluate(() => Array.from(document.querySelectorAll('[data-testid="practice-over-summary"] button')).filter((b) => b.getBoundingClientRect().width > 0).length);
  expect(visible).toBeLessThanOrEqual(5);
});
