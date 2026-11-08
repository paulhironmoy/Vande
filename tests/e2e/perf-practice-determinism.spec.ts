/**
 * PERF3 (release/player-experience/ceiling-rubric.md): identical input timestamps give identical results whatever the
 * frame rate. The same seeded sequence is batted with the same six queued inputs (exact simulation times from the test API) at the
 * browser's own frame rate and with every other animation frame withheld (half the rate: 30 fps where the stage runs
 * at 60), on the Classic stage and on the first-person stage. Every stored delivery record, including wickets before
 * explicit innings restarts, must match exactly; no outcome is changed to keep a six-ball innings alive.
 */
import { expect, test, type Browser } from '@playwright/test';
import { GPU_ARGS, configure, queue } from './practice-helpers';
import { completedDelivery, deliveryCheckpoint, record, toDelivery } from './perf-helpers';

test.use({ ...GPU_ARGS });

const SWINGS = [
  { kind: 'attack' as const, contactErrorMs: -30, directionDeg: 10, power: 0.7 },
  { kind: 'defend' as const, contactErrorMs: 0 },
  { kind: 'attack' as const, contactErrorMs: 25, directionDeg: -35, power: 0.9, elevation: 0.6 },
  'leave' as const,
  { kind: 'attack' as const, contactErrorMs: 10, directionDeg: 40, power: 0.5 },
  { kind: 'defend' as const, contactErrorMs: -12 },
];

/** Six queued inputs, retaining every delivery across legitimate one-wicket innings restarts. */
async function over(browser: Browser, tier: 'full' | 'below', half: boolean, baseURL: string) {
  const context = await browser.newContext({ viewport: { width: 915, height: 412 }, hasTouch: true, baseURL });
  const page = await context.newPage();
  if (half)
    await page.addInitScript(() => {
      // Every other animation frame is withheld from the page: a callback due in an odd frame runs in the next one,
      // so everything draws at half the display rate.
      const raf = window.requestAnimationFrame.bind(window);
      let lastT = -1;
      let n = 0;
      window.requestAnimationFrame = (cb) =>
        raf((t) => {
          if (t !== lastT) {
            lastT = t;
            n++;
          }
          if (n % 2 === 1) raf((t2) => cb(t2));
          else cb(t);
        });
    });
  await record(page);
  await configure(page, { tier, seed: 'perf3-over' }, { guidedDone: true, settings: { demoSeen: true } });
  await page.goto('/practice');
  await queue(page, ...SWINGS);
  const fps: number[] = [];
  const records: string[] = [];
  const keys: string[] = [];
  for (let i = 0; i < SWINGS.length; i++) {
    const before = await deliveryCheckpoint(page);
    expect(before.released).toBe(i);
    expect(before.pending).toBe(SWINGS.length - i);
    const pressed = await toDelivery(page, 120_000, before);
    const after = await completedDelivery(page, before, pressed, 180_000);
    const expected = SWINGS[i];
    if (expected === 'leave') expect(after.delivery.swing, `queued leave ${i + 1}`).toBeNull();
    else expect(after.delivery.swing, `queued swing ${i + 1}`).toMatchObject({
      kind: expected.kind,
      directionDeg: 'directionDeg' in expected ? expected.directionDeg : 0,
      power: 'power' in expected ? expected.power : 0.2,
      elevation: 'elevation' in expected ? expected.elevation : 0,
    });
    records.push(JSON.stringify(after.delivery));
    keys.push(after.key);
    fps.push(await page.evaluate(({ atMs, phaseCount }) => {
      const p = (window as unknown as { __perf: { frames: number[]; phases: Array<[number, string, string, string, string]> } }).__perf;
      const events = p.phases.slice(phaseCount);
      const from = events.find((x) => x[2] === 'runup')?.[0] ?? atMs;
      const to = events.find((x) => x[0] >= from && x[2] === 'dead')?.[0] ?? performance.now();
      const f = p.frames.filter((t) => t >= from && t <= to);
      return f.length > 1 ? Math.round(((f.length - 1) / (f.at(-1)! - f[0])) * 1000) : 0;
    }, before));
  }
  const final = await deliveryCheckpoint(page);
  expect(final.released, 'no unrequested seventh delivery').toBe(SWINGS.length);
  expect(final.pending, 'every queued input consumed once').toBe(0);
  expect(new Set(keys).size, 'six distinct committed delivery identities').toBe(SWINGS.length);
  await context.close();
  return { records, fps };
}

for (const tier of ['below', 'full'] as const) {
  test(`[PERF3] the same swings give the same results at full and half frame rate (${tier === 'below' ? 'Classic' : 'first-person'} stage)`, async ({ browser, baseURL }) => {
    test.setTimeout(600_000);
    const full = await over(browser, tier, false, baseURL!);
    const half = await over(browser, tier, true, baseURL!);
    test.info().annotations.push({ type: 'frame rates', description: `full ${full.fps.join(',')} fps; half ${half.fps.join(',')} fps` });
    expect(full.records.length).toBe(SWINGS.length);
    expect(half.records).toEqual(full.records);
  });
}
