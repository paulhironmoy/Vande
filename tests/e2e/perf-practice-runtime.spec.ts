/**
 * Runtime robustness of live batting (docs/PERFORMANCE.md): no shader is compiled during a delivery, no request leaves
 * the page during play (including legitimate wicket restarts and a step down to Classic), a lost graphics context between balls
 * recovers without losing the innings, and a long Classic session does not grow. Observed with the passive recorder
 * (scripts/perf/observer.js). In headless Chromium WebGL runs on SwiftShader: these checks are about what happens,
 * never how fast; frame rates are measured with scripts/perf/practice-frames.mjs.
 */
import { expect, test } from '@playwright/test';
import { GPU_ARGS, block, configure, perfect, queue, state } from './practice-helpers';
import {
  completedDelivery,
  deliveryCheckpoint,
  deliveryWindows,
  loseContext,
  memory,
  record,
  toDelivery,
} from './perf-helpers';

test.use({ viewport: { width: 915, height: 412 }, hasTouch: true, serviceWorkers: 'block', ...GPU_ARGS });

/** Plays exactly `n` queued deliveries, retaining results before any legitimate innings restart. */
async function playBalls(page: import('@playwright/test').Page, n: number) {
  const stages: string[] = [];
  const deliveries: Awaited<ReturnType<typeof completedDelivery>>[] = [];
  for (let i = 0; i < n; i++) {
    const before = await deliveryCheckpoint(page);
    const pressed = await toDelivery(page, 120_000, before);
    const after = await completedDelivery(page, before, pressed);
    stages.push(after.state!.stage);
    deliveries.push(after);
  }
  expect(new Set(deliveries.map((d) => d.key)).size, 'every requested delivery committed once').toBe(n);
  return { stages, deliveries };
}

test('[PERF4] no shader program is linked during a delivery on the first-person stage', async ({ page }) => {
  test.setTimeout(300_000);
  await record(page);
  await configure(page, { tier: 'full', seed: 'perf-links' }, { guidedDone: true, settings: { demoSeen: true } });
  await page.goto('/practice');
  // Five balls: on SwiftShader the session monitor steps the stage down to Lite after the third, and a step down
  // (shadows off) must not compile anything during the next delivery either.
  await queue(page, perfect(0), block(), perfect(-30, 0.95), 'leave', block());
  await playBalls(page, 5);
  const { windows, linksBefore } = await deliveryWindows(page);
  const firstPerson = windows.filter((w) => w.stage === '3d' && w.dead !== null);
  expect(firstPerson.length, 'deliveries drawn on the first-person stage').toBeGreaterThan(0);
  expect(linksBefore, 'programs are compiled when the stage mounts').toBeGreaterThan(0);
  for (const [k, w] of firstPerson.entries()) {
    expect(w.links, `programs linked during delivery ${k + 1} (run-up to dead ball)`).toBe(0);
    expect(w.compiles, `shaders compiled during delivery ${k + 1}`).toBe(0);
  }
});

test('[PERF4 PERF2] after warm-up, five fully offline deliveries survive wickets, explicit innings restarts and a step down to Classic', async ({
  page,
  context,
}) => {
  test.setTimeout(300_000);
  await record(page);
  // Assisted on SwiftShader: the session monitor moves to Classic after three slow deliveries.
  await configure(page, { tier: 'assisted', seed: 'perf-offline' }, { guidedDone: true, settings: { demoSeen: true } });
  await page.goto('/practice');
  // The first delivery loads and warms the session online. Install interception at
  // its dead-ball boundary, BEFORE advancing any of the five measured deliveries;
  // a loaded CDP driver can otherwise miss all of a short first delivery.
  await queue(page, perfect(0), block(), 'leave', perfect(20), block(), block());
  await playBalls(page, 1);
  const beforeOffline = await deliveryCheckpoint(page);
  const during: string[] = [];
  page.on('request', (r) => during.push(`${r.resourceType()} ${new URL(r.url()).pathname}`));
  await context.route('**', (r) => r.abort());
  await context.setOffline(true);
  const { stages, deliveries } = await playBalls(page, 5);
  expect(stages.length).toBe(5);
  expect(stages.at(-1), 'the monitor stepped a software-rendered stage down to Classic').toBe('2d');
  expect(during, 'requests during play').toEqual([]);
  expect(deliveries).toHaveLength(5);
  expect(new Set(deliveries.map((d) => d.key)).size).toBe(5);
  const after = await deliveryCheckpoint(page);
  expect(after.released - beforeOffline.released, 'five actual offline deliveries across all innings').toBe(5);
  expect(after.pending, 'all five offline inputs consumed, after the warm-up input').toBe(0);
});

for (const restored of [true, false]) {
  test(`[PERF5] a lost graphics context between balls ${restored ? 'is restored and play continues' : 'falls back to Classic'}, the innings intact`, async ({
    page,
  }) => {
    test.setTimeout(300_000);
    await record(page);
    await configure(page, { tier: 'full', seed: 'perf-context' }, { guidedDone: true, settings: { demoSeen: true } });
    await page.goto('/practice');
    await queue(page, block(), block(), block());
    await playBalls(page, 1);
    const before = await state(page);
    const savedBefore = await deliveryCheckpoint(page);
    expect(before.stage).toBe('3d');
    expect(before.status, 'the continuity fixture survives its first ball').toBe('batting');
    expect(await loseContext(page, restored ? 1500 : null)).toBe(true);
    await page.waitForTimeout(restored ? 2500 : 4500);
    const recovered = await deliveryCheckpoint(page);
    expect(recovered.inningsId, 'context recovery keeps the same innings').toBe(savedBefore.inningsId);
    expect(recovered.records, 'context recovery cannot discard or change a committed result').toEqual(
      savedBefore.records,
    );
    expect(recovered.state?.balls).toBe(before.balls);
    expect(recovered.state?.runs).toBe(before.runs);
    const { stages } = await playBalls(page, 1);
    const after = await state(page);
    expect(after.balls, 'the next ball was bowled and counted').toBe(before.balls + 1);
    expect((await deliveryCheckpoint(page)).inningsId, 'the next ball belongs to the same innings').toBe(
      savedBefore.inningsId,
    );
    expect(after.runs).toBeGreaterThanOrEqual(before.runs);
    expect(after.screen).not.toBe('error');
    expect(
      stages[0],
      restored
        ? 'a restored context must draw the next delivery in 3D, not silently pass through Classic fallback'
        : 'a context that never comes back hands over to Classic before the next ball',
    ).toBe(restored ? '3d' : '2d');
  });
}

test('[MEM] twelve Classic deliveries, including legitimate wicket restarts, keep heap, DOM and listeners flat', async ({
  page,
}) => {
  test.setTimeout(400_000);
  await record(page);
  await configure(
    page,
    { tier: 'below', timeScale: 3, seed: 'perf-leak' },
    { guidedDone: true, settings: { demoSeen: true } },
  );
  await page.goto('/practice');
  await queue(
    page,
    ...Array.from({ length: 12 }, (_, i) =>
      i % 3 === 0 ? perfect(i * 7 - 30) : i % 3 === 1 ? block() : ('leave' as const),
    ),
  );
  const batchOne = await playBalls(page, 6);
  const first = await memory(page);
  const batchTwo = await playBalls(page, 6);
  const second = await memory(page);
  test.info().annotations.push({ type: 'memory', description: JSON.stringify({ first, second }) });
  expect(new Set([...batchOne.deliveries, ...batchTwo.deliveries].map((d) => d.key)).size).toBe(12);
  const final = await deliveryCheckpoint(page);
  expect(final.released).toBe(12);
  expect(final.pending).toBe(0);
  expect(second.heapMb - first.heapMb, 'JS heap growth over the second six deliveries (MB, after GC)').toBeLessThan(3);
  expect(second.nodes - first.nodes, 'DOM nodes').toBeLessThan(300);
  expect(second.listeners - first.listeners, 'event listeners').toBeLessThan(60);
});
