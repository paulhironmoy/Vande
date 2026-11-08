/**
 * The work thread's own rules (src/practice/ui/flow/offThread.ts and src/practice/worker/host.ts), on fakes: the live
 * ball outranks the coach on the worker, a reading can always be cancelled, nothing waits for ever, and a result is
 * named instead of sent back only while the worker still keeps it.
 */
import { describe, expect, it } from 'vitest';
import { PRACTICE_SIM_VERSION, type CoachAnalysis, type DeliveryRecord, type DeliveryResult } from '@/contracts';
import { createOffThread } from '@/practice/ui/flow/offThread';
import type { WorkKit } from '@/practice/worker/host';
import { KEPT_RESULTS } from '@/practice/worker/protocol';
import { fakeCoach } from './fakeCoach';
import { fakeEngine, field, bowler, plan } from './fakes';
import { BUILD, inProcessWorker, type HarnessOptions } from './workerHarness';
import { skipOverBudgetWhenLoaded } from '../../support/timing';

const engine = fakeEngine();
const flight = engine.flight({ plan: plan(), bowler, conditions: 'balanced', seed: 's1', handedness: 'right' });
const job = {
  kind: 'resolve' as const,
  args: {
    flight,
    field,
    bowler,
    conditions: 'balanced' as const,
    handedness: 'right' as const,
    assist: 'real' as const,
    tierToleranceMs: 0,
  },
};
const local = (swing: Parameters<typeof engine.resolveDelivery>[0]['swing']) =>
  engine.resolveDelivery({ ...job.args, swing });
const record: DeliveryRecord = {
  version: PRACTICE_SIM_VERSION,
  overIndex: 0,
  ballIndex: 0,
  bowler,
  plan: plan(),
  seed: 's1',
  conditions: 'balanced',
  ball: { colour: 'white', age: 'new' },
  field,
  handedness: 'right',
  assist: 'real',
  tierToleranceMs: 0,
  swing: null,
  runs: 0,
  dismissal: null,
};

/** A coach whose reading is `steps` simulations long, each one a yield; it records each step's start. */
function slowKit(steps: number, log: string[]): WorkKit {
  const coach = fakeCoach();
  return {
    resolveDelivery: (a) => {
      log.push('resolve');
      return engine.resolveDelivery(a);
    },
    repeatDelivery: engine.repeatDelivery,
    analyzeBallInSlices: async (r, res, opts) => {
      for (let i = 0; i < steps; i++) {
        log.push(`sim${i}`);
        await opts?.yieldTo?.();
        if (opts?.signal?.aborted) {
          const e = new Error('aborted');
          e.name = 'AbortError';
          throw e;
        }
      }
      return coach.analyzeBall(r, res) as CoachAnalysis;
    },
    coachTip: coach.coachTip,
    formSample: coach.formSample,
    optionOf: coach.optionOf,
  };
}

function make(o: HarnessOptions, extra: Partial<Parameters<typeof createOffThread>[0]> = {}) {
  const h = inProcessWorker(o);
  return { h, work: createOffThread({ build: BUILD, sim: PRACTICE_SIM_VERSION, spawn: () => h.port, ...extra }) };
}

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));
// The ceiling is patience, not a budget: the wait ends the moment the condition holds, so a loaded machine only needs time.
async function until(pred: () => boolean, ms = 25_000) {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error('condition not reached');
    await tick(2);
  }
}

describe('on the worker the live ball comes first', () => {
  it('a reading in progress starts no simulation from the moment a ball is prepared until it is resolved', async () => {
    const log: string[] = [];
    const { work } = make({ kit: slowKit(40, log) });
    const result = local(null);
    const reading = work.read(record, result, { tip: false, sample: null, guide: false });
    await until(() => log.includes('sim3'));
    const ticket = work.prepare(job, local);
    await until(() => ticket.ready());
    const heldAt = log.length;
    await tick(40);
    // At most the one simulation that was already running when the ball arrived.
    expect(log.length - heldAt).toBeLessThanOrEqual(1);
    const swing = {
      kind: 'attack' as const,
      startT: 0.38,
      directionDeg: 30,
      power: 0.6,
      elevation: 0,
      footwork: 'auto' as const,
    };
    const r = await ticket.resolve(swing);
    expect(JSON.stringify(r)).toBe(JSON.stringify(local(swing)));
    expect(log.slice(heldAt)).toContain('resolve');
    await reading;
    expect(log.filter((x) => x.startsWith('sim'))).toHaveLength(40);
    work.dispose();
  });

  it('a ball abandoned before its swing (release) lets the reading go on', async () => {
    const log: string[] = [];
    const { work } = make({ kit: slowKit(10, log) });
    const reading = work.read(record, local(null), { tip: false, sample: null, guide: false });
    const ticket = work.prepare(job, local);
    await until(() => ticket.ready());
    ticket.release();
    await reading;
    expect(log.filter((x) => x.startsWith('sim'))).toHaveLength(10);
    work.dispose();
  });
});

describe('a ball left alone is answered at once (bowled-leave step 1)', () => {
  it('the leave is resolved while the run-up plays; the leave then needs no simulation, and equals the one resolved here', async () => {
    const log: string[] = [];
    const { work } = make({ kit: slowKit(1, log) });
    const ticket = work.prepare(job, local);
    await until(() => ticket.ready());
    await until(() => log.filter((x) => x === 'resolve').length >= 2);
    // The warm-up (first ball) and the leave, ahead of the swing window.
    const before = log.filter((x) => x === 'resolve').length;
    const r = await ticket.resolve(null);
    expect(log.filter((x) => x === 'resolve').length).toBe(before);
    expect(JSON.stringify(r)).toBe(JSON.stringify(local(null)));
    expect(work.stats().balls.at(-1)?.path).toBe('worker');
    work.dispose();
  });

  it('a swing is still resolved for itself (the leave ahead is dropped)', async () => {
    const log: string[] = [];
    const { work } = make({ kit: slowKit(1, log) });
    const ticket = work.prepare(job, local);
    await until(() => ticket.ready());
    await until(() => log.filter((x) => x === 'resolve').length >= 2);
    const before = log.filter((x) => x === 'resolve').length;
    const swing = {
      kind: 'defend' as const,
      startT: 0.38,
      directionDeg: 0,
      power: 0.2,
      elevation: 0,
      footwork: 'auto' as const,
    };
    const r = await ticket.resolve(swing);
    expect(log.filter((x) => x === 'resolve').length).toBe(before + 1);
    expect(JSON.stringify(r)).toBe(JSON.stringify(local(swing)));
    work.dispose();
  });
});

describe('nothing waits for ever', () => {
  it('a cancelled reading rejects at once with an AbortError, and the worker stops it', async () => {
    const log: string[] = [];
    const { work, h } = make({ kit: slowKit(1000, log) });
    const ctl = new AbortController();
    const reading = work.read(record, local(null), { tip: false, sample: null, guide: false }, ctl.signal);
    await until(() => log.length > 3);
    ctl.abort();
    await expect(reading).rejects.toMatchObject({ name: 'AbortError' });
    await until(() => h.received.some((m) => m.t === 'aborted'));
    const n = log.length;
    await tick(30);
    expect(log.length).toBe(n);
    work.dispose();
  });

  it('a reading the worker never answers fails within its bound (the flow then reads it itself)', async (ctx) => {
    const { work } = make({ kit: slowKit(1, []), drop: ['analyzed'] }, { readTimeoutMs: 100 });
    const t0 = Date.now();
    await expect(work.read(record, local(null), { tip: false, sample: null, guide: false })).rejects.toThrow(
      /timed out/,
    );
    // The bound is exact. Only an overrun on a machine above load 20 is skipped, by name; a quiet machine fails it.
    const elapsed = Date.now() - t0;
    skipOverBudgetWhenLoaded(ctx, 'a reading the worker never answers (readTimeoutMs 100)', elapsed, 2_000, 'ms');
    expect(elapsed).toBeLessThan(2_000);
    expect(work.stats().reads.at(-1)?.path).toBe('failed');
    work.dispose();
  });

  it('a worker that never says hello is given up on, and everything in flight is answered here', async () => {
    const { work } = make({ kit: slowKit(1, []), drop: ['hello'] }, { helloTimeoutMs: 100 });
    const ticket = work.prepare(job, local);
    const reading = work.read(record, local(null), { tip: false, sample: null, guide: false });
    await expect(reading).rejects.toThrow(/hello_timeout/);
    expect(work.canWork()).toBe(false);
    const r = await ticket.resolve(null);
    expect(JSON.stringify(r)).toBe(JSON.stringify(local(null)));
    expect(work.stats().balls.at(-1)).toMatchObject({ path: 'local', reason: 'failed' });
  });

  it('disposing cancels readings and stops the worker', async () => {
    const { work, h } = make({ kit: slowKit(1000, []) });
    const reading = work.read(record, local(null), { tip: false, sample: null, guide: false });
    await tick(10);
    work.dispose();
    await expect(reading).rejects.toMatchObject({ name: 'AbortError' });
    expect(h.terminated()).toBe(true);
  });
});

describe('a result is named, not sent back, only while the worker keeps it', () => {
  it(`the last ${KEPT_RESULTS} resolved balls are named; an older one is sent in full`, async () => {
    const { work, h } = make({ kit: slowKit(0, []) });
    const results: DeliveryResult[] = [];
    for (let i = 0; i < KEPT_RESULTS + 1; i++) {
      const t = work.prepare(job, local);
      await until(() => t.ready());
      results.push(
        await t.resolve({
          kind: 'defend',
          startT: 0.38 + i / 1000,
          directionDeg: 0,
          power: 0.2,
          elevation: 0,
          footwork: 'auto',
        }),
      );
    }
    await work.read(record, results[0], { tip: false, sample: null, guide: false });
    await work.read(record, results[KEPT_RESULTS], { tip: false, sample: null, guide: false });
    const asks = h.sent.filter((m) => m.t === 'analyze');
    expect(asks.map((m) => (m.t === 'analyze' ? [m.result === null, m.ball] : null))).toEqual([
      [false, null],
      [true, KEPT_RESULTS + 1],
    ]);
    // A result the main thread computed itself is always sent.
    await work.read(record, local(null), { tip: false, sample: null, guide: false });
    const last = h.sent.filter((m) => m.t === 'analyze').at(-1);
    expect(last?.t === 'analyze' && last.result !== null).toBe(true);
    work.dispose();
  });
});
