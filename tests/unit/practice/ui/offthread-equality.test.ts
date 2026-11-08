/**
 * Anti-fake rule 3 across threads: a ball resolved on the work thread, or read by its coach, is the main thread's
 * answer to the same input. Over 500+ real deliveries (the reference over under a grid of swings, then random overs on
 * every pitch, assistance and hand), the worker's result, after the structured clone it crosses as, is identical to
 * the main thread's own call: the same JSON bytes and the same values (Object.is, so -0 counts), key for key. The
 * same holds for the coach's readings (analysis, tip, form sample, demonstration), and for every fallback path.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { PRACTICE_SIM_VERSION, type AssistLevel, type BallFlight, type DeliveryRecord, type DeliveryResult, type Handedness, type NormalizedSwing, type PitchCondition, type PracticeOverPlan } from '@/contracts';
import { autoField, batTravelMs, flight, resolveDelivery } from '@/physics';
import { REFERENCE_OVER, ballSeed, randomOver, repeatDelivery } from '@/practice/game';
import { analyzeBallInSlices, clearCoachCache, coachTip, formSample, optionOf } from '@/practice/coach';
import { createOffThread, type OffThreadWork } from '@/practice/ui/flow/offThread';
import type { ResolveArgs } from '@/practice/ui/flow/types';
import { readRecord } from '@/practice/worker/work';
import { BUILD, firstDifference, inProcessWorker, plainDataIssues, type HarnessOptions } from './workerHarness';

interface Case {
  args: ResolveArgs;
  record: DeliveryRecord;
}

const swingOf = (fl: BallFlight, kind: 'attack' | 'defend', power: number, directionDeg: number, elevation: number, footwork: NormalizedSwing['footwork'], errMs: number): NormalizedSwing => ({
  kind,
  startT: fl.idealContactT - batTravelMs(kind, power) / 1000 + errMs / 1000,
  directionDeg,
  power,
  elevation,
  footwork,
});

function caseOf(plan: PracticeOverPlan, i: number, conditions: PitchCondition, assist: AssistLevel, handedness: Handedness, swing: (fl: BallFlight) => NormalizedSwing | null): Case {
  const seed = ballSeed(plan, i);
  const field = autoField(plan.bowler, conditions, handedness, plan.ball);
  const fl = flight({ plan: plan.balls[i], bowler: plan.bowler, conditions, seed, handedness, ball: plan.ball });
  const sw = swing(fl);
  return {
    args: { flight: fl, swing: sw, field, bowler: plan.bowler, conditions, handedness, assist, tierToleranceMs: assist === 'real' ? 0 : 12 },
    record: { version: PRACTICE_SIM_VERSION, overIndex: 0, ballIndex: i, bowler: plan.bowler, plan: plan.balls[i], seed, conditions, ball: plan.ball, field, handedness, assist, tierToleranceMs: assist === 'real' ? 0 : 12, swing: sw, runs: 0, dismissal: null },
  };
}

/** 360 reference-over cases (each ball: a leave, 9 defences, 50 drives) and random overs up to `n`. */
function cases(n: number): { all: Case[]; reads: number[] } {
  const all: Case[] = [];
  const reads: number[] = [];
  for (let i = 0; i < REFERENCE_OVER.balls.length; i++) {
    reads.push(all.length);
    all.push(caseOf(REFERENCE_OVER, i, 'balanced', 'real', 'right', () => null));
    for (const fw of ['auto', 'forward', 'back'] as const) for (const e of [-40, 0, 40]) all.push(caseOf(REFERENCE_OVER, i, 'balanced', 'real', 'right', (fl) => swingOf(fl, 'defend', 0.2, 0, 0, fw, e)));
    for (const dir of [-50, 0, 30, 55, 80])
      for (const e of [-60, -20, 0, 20, 60])
        for (const [pw, el] of [[0.7, 0], [1, 0.8]] as const) {
          if (dir === 55 && e === 0 && el === 0) reads.push(all.length);
          all.push(caseOf(REFERENCE_OVER, i, 'balanced', 'real', 'right', (fl) => swingOf(fl, 'attack', pw, dir, el, 'forward', e)));
        }
  }
  const pitches: PitchCondition[] = ['balanced', 'green', 'hard', 'turning'];
  const assists: AssistLevel[] = ['real', 'play', 'learn'];
  for (let o = 0; all.length < n; o++) {
    const conditions = pitches[o % pitches.length];
    const assist = assists[o % assists.length];
    const handedness: Handedness = o % 2 ? 'left' : 'right';
    const plan = randomOver({ seed: `parity-${o}`, conditions, assist, difficulty: 'club', family: o % 3 === 2 ? 'spin' : 'pace' });
    for (let i = 0; i < plan.balls.length && all.length < n; i++) {
      all.push(caseOf(plan, i, conditions, assist, handedness, (fl) => (i % 5 === 4 ? null : swingOf(fl, i % 2 ? 'defend' : 'attack', i % 2 ? 0.2 : 0.75, ((i * 37 + o * 11) % 120) - 40, o % 4 === 3 ? 0.6 : 0, (['auto', 'forward', 'back'] as const)[o % 3], ((i * 13 + o * 7) % 9) * 15 - 60))));
    }
  }
  return { all, reads };
}

const ALL = cases(540);

function client(o: HarnessOptions = {}, extra: Partial<Parameters<typeof createOffThread>[0]> = {}): { work: OffThreadWork; h: ReturnType<typeof inProcessWorker> } {
  const h = inProcessWorker(o);
  const work = createOffThread({ build: BUILD, sim: PRACTICE_SIM_VERSION, spawn: () => h.port, ...extra });
  return { work, h };
}

async function untilReady(t: { ready(): boolean }): Promise<void> {
  for (let i = 0; i < 2000 && !t.ready(); i++) await new Promise((r) => setTimeout(r, 1));
}

const sha = (parts: string[]) => createHash('sha256').update(parts.join('\n')).digest('hex');
const local = (c: Case, swing: NormalizedSwing | null = c.args.swing) => resolveDelivery({ ...c.args, swing });

describe('the work thread resolves a ball exactly as the main thread does', () => {
  it(`has ${ALL.all.length} cases, the reference over's 360 among them`, () => {
    expect(ALL.all.length).toBeGreaterThanOrEqual(500);
    expect(ALL.all.slice(0, 360).every((c) => c.record.seed.length > 0 && c.args.conditions === 'balanced')).toBe(true);
    // Leaves, defences and attacks on both hands, every pitch and assistance.
    expect(new Set(ALL.all.map((c) => c.args.swing?.kind ?? 'leave'))).toEqual(new Set(['leave', 'defend', 'attack']));
    expect(new Set(ALL.all.map((c) => c.args.handedness))).toEqual(new Set(['right', 'left']));
    expect(new Set(ALL.all.map((c) => c.args.conditions)).size).toBe(4);
    expect(new Set(ALL.all.map((c) => c.args.assist)).size).toBe(3);
  });

  const chunks = 6;
  const size = Math.ceil(ALL.all.length / chunks);
  const mainParts: string[] = [];
  const workerParts: string[] = [];
  for (let k = 0; k < chunks; k++) {
    it(`cases ${k * size}–${Math.min(ALL.all.length, (k + 1) * size) - 1}: identical JSON bytes and values, via the worker`, async () => {
      const { work } = client();
      let viaWorker = 0;
      for (const c of ALL.all.slice(k * size, (k + 1) * size)) {
        const mine = local(c);
        const { swing: _s, ...rest } = c.args;
        const ticket = work.prepare({ kind: 'resolve', args: rest }, (sw) => local(c, sw));
        await untilReady(ticket);
        const theirs = await ticket.resolve(c.args.swing);
        if (work.stats().balls.at(-1)?.path === 'worker') viaWorker++;
        expect(plainDataIssues(theirs).filter((x) => !x.endsWith(':undefined'))).toEqual([]);
        const a = JSON.stringify(mine);
        const b = JSON.stringify(theirs);
        expect(b).toBe(a);
        expect(firstDifference(mine, theirs)).toBeNull();
        mainParts.push(a);
        workerParts.push(b);
      }
      expect(viaWorker).toBe(Math.min(ALL.all.length, (k + 1) * size) - k * size);
      work.dispose();
    }, 180_000);
  }

  it('the whole set hashes the same on both threads', () => {
    expect(mainParts.length).toBe(ALL.all.length);
    expect(sha(workerParts)).toBe(sha(mainParts));
  });

  it('an exact-ball attempt (repeatDelivery of a record) is identical too', async () => {
    const { work } = client();
    for (const idx of ALL.reads) {
      const c = ALL.all[idx];
      const source = { ...c.record, swing: null };
      for (const swing of [c.args.swing, swingOf(c.args.flight, 'defend', 0.2, 0, 0, 'forward', 10)]) {
        const mine = repeatDelivery(source, swing);
        const ticket = work.prepare({ kind: 'repeat', source }, (sw) => repeatDelivery(source, sw));
        await untilReady(ticket);
        const theirs = await ticket.resolve(swing);
        expect(work.stats().balls.at(-1)?.path).toBe('worker');
        expect(JSON.stringify(theirs)).toBe(JSON.stringify(mine));
        expect(firstDifference(mine, theirs)).toBeNull();
      }
    }
    work.dispose();
  }, 120_000);
});

describe('every fallback gives the same result', () => {
  const sample = [0, 17, 44, 61, 104, 200, 359, 400, 480, 530].map((i) => ALL.all[i]);

  /**
   * `handedOver`: the worker does take the ball (and fails later). Otherwise it never becomes ready: for a 'failed' or
   * 'no_worker' reason the swing comes once the client knows (polled, so a loaded machine cannot turn the reason into
   * 'not_ready'); for 'not_ready' it comes 5 ms after the ball, while the slow worker is still starting.
   */
  async function viaFallback(make: () => OffThreadWork, expectPath: 'local' | 'worker', reason: string, handedOver = false) {
    for (const c of sample) {
      const work = make();
      const mine = local(c);
      const { swing: _s, ...rest } = c.args;
      const ticket = work.prepare({ kind: 'resolve', args: rest }, (sw) => local(c, sw));
      if (handedOver) {
        await untilReady(ticket);
        expect(ticket.ready()).toBe(true);
      } else if (reason === 'not_ready') await new Promise((r) => setTimeout(r, 5));
      else for (let i = 0; i < 2000 && work.canWork(); i++) await new Promise((r) => setTimeout(r, 1));
      const theirs = await ticket.resolve(c.args.swing);
      const stat = work.stats().balls.at(-1)!;
      expect(stat.path).toBe(expectPath);
      if (reason) expect(stat.reason).toBe(reason);
      expect(JSON.stringify(theirs)).toBe(JSON.stringify(mine));
      expect(firstDifference(mine, theirs)).toBeNull();
      work.dispose();
    }
  }

  it('no Worker at all', () => viaFallback(() => createOffThread({ build: BUILD, sim: PRACTICE_SIM_VERSION, spawn: () => null }), 'local', 'no_worker'), 60_000);
  it('a worker that cannot be constructed', () =>
    viaFallback(
      () =>
        createOffThread({
          build: BUILD,
          sim: PRACTICE_SIM_VERSION,
          spawn: () => {
            throw new Error('SecurityError');
          },
        }),
      'local',
      'failed',
    ), 60_000);
  it('a worker of another build', () => viaFallback(() => client({ build: 'other-build' }).work, 'local', 'failed'), 60_000);
  it('a worker that errors before answering (an old engine that cannot parse it)', () => viaFallback(() => client({ errorOn: 'hello' }).work, 'local', 'failed'), 60_000);
  it('a worker still starting when the swing comes', () => viaFallback(() => client({ later: (f) => setTimeout(f, 200) }).work, 'local', 'not_ready'), 60_000);
  it('a worker that goes silent after the ball is handed over', () => viaFallback(() => client({ drop: ['resolved'] }, { resolveTimeoutMs: 50 }).work, 'local', 'timeout', true), 60_000);
  it('a worker that errors while resolving', () => viaFallback(() => client({ errorOn: 'resolve' }).work, 'local', 'worker_error', true), 60_000);
  it('an answer that cannot be received (messageerror)', () => viaFallback(() => client({ messageErrorOn: 'resolved' }).work, 'local', 'worker_error', true), 60_000);
  it('a physics exception in the worker: the main thread computes it (and would report the same exception)', async () => {
    const throwing = { resolveDelivery: () => { throw new Error('boom'); } };
    await viaFallback(() => client({ kit: { ...inProcessWorkerKit(), ...throwing } }).work, 'local', 'worker_error', true);
  }, 60_000);
});

function inProcessWorkerKit() {
  return {
    resolveDelivery,
    repeatDelivery: (record: DeliveryRecord, swing: NormalizedSwing | null) => repeatDelivery(record, swing),
    analyzeBallInSlices: (record: DeliveryRecord, result: DeliveryResult, opts?: Parameters<typeof analyzeBallInSlices>[2]) => analyzeBallInSlices(record, result, opts),
    coachTip: (record: DeliveryRecord, analysis: Parameters<typeof coachTip>[1]) => coachTip(record, analysis!),
    formSample,
    optionOf,
  };
}

describe("the coach's reading is the same on the work thread", () => {
  const mainKit = inProcessWorkerKit();
  // The reference over's six balls, left and driven on time: twelve full readings.
  for (const idx of ALL.reads) {
    const c = ALL.all[idx];
    it(`${c.record.seed} ${c.args.swing ? 'driven' : 'left'}: analysis, tip, form sample and demonstration`, async () => {
      const result = local(c);
      const record = { ...c.record, runs: result.outcome.runs, dismissal: result.outcome.dismissal };
      const want = { tip: true, sample: { source: 'innings' as const }, guide: true };
      clearCoachCache();
      const mine = await readRecord(mainKit, record, result, want, { sliceMs: 1_000 });
      // The worker's coach starts cold, as a fresh worker does; the main thread's cache must not matter either.
      clearCoachCache();
      const { work } = client();
      const theirs = await work.read(record, result, want);
      expect(work.stats().reads.at(-1)?.path).toBe('worker');
      expect(mine.tip).not.toBeNull();
      expect(mine.sample).not.toBeNull();
      expect(mine.guide).not.toBeNull();
      expect(JSON.stringify(theirs)).toBe(JSON.stringify(mine));
      expect(firstDifference(mine, theirs)).toBeNull();
      work.dispose();
    }, 120_000);
  }

  it('a result the worker resolved itself is not sent back for its reading, and reads the same', async () => {
    const c = ALL.all[ALL.reads[3]];
    const { work, h } = client();
    const { swing: _s, ...rest } = c.args;
    const ticket = work.prepare({ kind: 'resolve', args: rest }, (sw) => local(c, sw));
    await untilReady(ticket);
    const result = await ticket.resolve(c.args.swing);
    const record = { ...c.record, runs: result.outcome.runs, dismissal: result.outcome.dismissal };
    const want = { tip: true, sample: { source: 'innings' as const }, guide: false };
    const theirs = await work.read(record, result, want);
    const msg = h.sent.find((m) => m.t === 'analyze');
    expect(msg && msg.t === 'analyze' && msg.result === null && msg.ball === ticket.id).toBe(true);
    expect(work.stats().reads.at(-1)?.reused).toBe(true);
    clearCoachCache();
    const mine = await readRecord(mainKit, record, local(c), want, { sliceMs: 1_000 });
    expect(JSON.stringify(theirs)).toBe(JSON.stringify(mine));
    work.dispose();
  }, 120_000);
});
