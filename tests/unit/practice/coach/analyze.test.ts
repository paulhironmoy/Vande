import { describe, expect, it } from 'vitest';
import { PRACTICE_SIM_VERSION, type CoachAnalysis, type DeliveryRecord } from '@/contracts/practice';
import { canPlay } from '@/input/normalize';
import { PITCH_HALF, fieldIntent, flightMovement, practiceFlight } from '@/physics';
import { PICK, analyzeBall, analyzeBallInSlices, clearCoachCache, optionOf } from '@/practice/coach';
import { coachResultKey } from '@/practice/coach/simulate';
import { bestOf, cpuMicros, skipOverBudgetWhenLoaded } from '../../support/timing';
import { NEW_BALL, OFFSPIN, play, recordFor, referenceRecord, replayOption, swingFor } from './fixtures';

const FULL_OUTSWINGER = recordFor({ variation: 'outswing', lengthM: 3.6, lineM: 0.18, speedKph: 134 });
const GOOD_LENGTH = recordFor({ variation: 'stock', lengthM: 6, lineM: 0.2, speedKph: 136 });
const SPINNER = recordFor(
  { variation: 'stock', lengthM: 4, lineM: 0.1, speedKph: 84 },
  { bowler: OFFSPIN, conditions: 'turning' },
);

const fresh = (r: DeliveryRecord, result: Parameters<typeof analyzeBall>[1] = null): CoachAnalysis => {
  clearCoachCache();
  return analyzeBall(r, result);
};

describe('analyzeBall: what the ball did', () => {
  it('reads the ball off the flight that was bowled', () => {
    const a = analyzeBall(FULL_OUTSWINGER);
    const f = practiceFlight(FULL_OUTSWINGER);
    const m = flightMovement(f);
    expect(a.version).toBe(PRACTICE_SIM_VERSION);
    expect(a.ball.variation).toBe('outswing');
    expect(a.ball.speedKph).toBeCloseTo(f.release.speedKph, 1);
    expect(a.ball.lengthM!).toBeCloseTo(PITCH_HALF - f.bounce!.p.z, 3);
    expect(Math.abs(a.ball.lengthM! - 3.6)).toBeLessThan(0.02);
    expect(a.ball.lineAtStumpsM).toBeCloseTo(m.lineAtStumpsM, 3);
    expect(a.ball.airMovementM).toBeCloseTo(m.airM, 3);
    expect(a.ball.pitchMovementM!).toBeCloseTo(m.pitchM!, 3);
    expect(a.ball.heightAtBatM).toBeCloseTo(m.heightAtBatM, 3);
    expect(a.ball.wouldHitStumps).toBe(f.wouldHitStumps);
  });

  it("reads the record's ball: the same outswinger with a worn ball swings less", () => {
    const worn = analyzeBall({ ...FULL_OUTSWINGER, ball: { colour: 'red', age: 'worn' } });
    const fresh = analyzeBall({ ...FULL_OUTSWINGER, ball: NEW_BALL });
    expect(Math.abs(worn.ball.airMovementM)).toBeLessThan(Math.abs(fresh.ball.airMovementM) - 0.02);
    expect(worn.ball.airMovementM).toBeCloseTo(
      flightMovement(practiceFlight({ ...FULL_OUTSWINGER, ball: { colour: 'red', age: 'worn' } })).airM,
      3,
    );
  });
});

describe('analyzeBall: what the player attempted', () => {
  it('a leave', () => {
    const a = analyzeBall(GOOD_LENGTH);
    expect(a.attempted).toMatchObject({
      decision: 'leave',
      directionDeg: null,
      elevation: null,
      power: null,
      timingErrorMs: null,
      timing: 'none',
      dismissal: null,
    });
    expect(['leave', 'pad', 'body']).toContain(a.attempted.contact);
    expect(a.why.length).toBeGreaterThan(0);
  });

  it('a stroke: its swing, timing error, contact and result', () => {
    const { record, result } = play(GOOD_LENGTH, swingFor(GOOD_LENGTH, { directionDeg: 30, errorMs: 20 }));
    const a = analyzeBall(record, result);
    expect(a.attempted.decision).toBe('attack');
    expect(a.attempted.directionDeg).toBe(30);
    expect(a.attempted.timingErrorMs!).toBeCloseTo(20, 0);
    expect(a.attempted.contact).toBe(result.contact.kind);
    expect(a.attempted.timing).toBe(result.contact.timing);
    expect(a.attempted.runs).toBe(result.outcome.runs);
    expect(a.attempted.dismissal).toBe(result.outcome.dismissal);
    expect(a.attempted.footwork).toBe(result.footwork);
    expect(a.why[0]).toBe(result.coaching.reason);
  });
});

describe('analyzeBall: the options are real simulations', () => {
  const cases: Array<[string, DeliveryRecord]> = [
    ['full outswinger', FULL_OUTSWINGER],
    ['good length outside off', GOOD_LENGTH],
    ['off-spinner on a turner', SPINNER],
    ['reference bouncer, Real', referenceRecord('ref-5', 'real')],
  ];
  for (const [name, record] of cases) {
    it(`${name}: every option re-simulates to exactly what it shows`, () => {
      const a = analyzeBall(record);
      for (const o of a.options) {
        const r = replayOption(record, o.swing);
        expect(r.outcome).toEqual(o.outcome);
        expect(r.contact.kind).toBe(o.contact);
        expect(r.footwork).toBe(o.footwork);
        if (o.contactPoint) expect(r.contact.point).toEqual(o.contactPoint);
        if (o.swing) expect(Math.abs(r.contact.timingErrorMs!)).toBeLessThan(0.1);
      }
    });

    it(`${name}: recommended first, alternatives different, numbers in range`, () => {
      const a = analyzeBall(record);
      expect(a.options[0].kind).toBe('recommended');
      const kinds = a.options.map((o) => o.kind);
      expect(new Set(kinds).size).toBe(kinds.length);
      const keys = a.options.map((o) => JSON.stringify([o.decision, o.swing]));
      expect(new Set(keys).size).toBe(keys.length);
      for (const o of a.options) {
        if (o.swing) expect(canPlay(o.swing), o.kind).toBe(true);
        expect(o.dismissalRisk).toBeGreaterThanOrEqual(0);
        expect(o.dismissalRisk).toBeLessThanOrEqual(1);
        expect(o.expectedRuns).toBeGreaterThanOrEqual(0);
        expect(o.expectedRuns).toBeLessThanOrEqual(6);
        expect(o.decision === 'leave').toBe(o.swing === null);
      }
      const rec = a.options[0];
      const hs = a.options.find((o) => o.kind === 'higher_scoring');
      if (hs) {
        expect(hs.expectedRuns).toBeGreaterThan(rec.expectedRuns);
        expect(hs.dismissalRisk).toBeLessThanOrEqual(PICK.higherScoringMaxRisk);
      }
      expect(optionOf(a, 'recommended')).toBe(rec);
      expect(optionOf(a, 'safest')).toBe(a.options.find((o) => o.kind === 'safest') ?? rec);
    });

    it(`${name}: the recommended response survives its ideal point with clean contact, clear of protected arcs`, () => {
      const a = analyzeBall(record);
      const rec = a.options[0];
      expect(rec.outcome.dismissal).toBeNull();
      if (rec.decision === 'leave') {
        expect(rec.contact).toBe('leave');
        expect(a.ball.wouldHitStumps).toBe(false);
      } else expect(rec.contact).toBe('middle');
      expect(rec.dismissalRisk).toBeLessThanOrEqual(PICK.recommendMaxRisk);
      if (rec.decision === 'attack' && !rec.risks.includes('into_protected_region')) {
        const intent = fieldIntent(record.field, record.bowler, record.conditions, record.handedness);
        const lofted = rec.swing!.elevation >= 0.45;
        const inside = intent.protected.some(
          (p) =>
            p.depth === (lofted ? 'deep' : 'ring') &&
            rec.swing!.directionDeg >= p.fromDeg &&
            rec.swing!.directionDeg <= p.toDeg,
        );
        expect(inside).toBe(false);
      }
    });
  }

  it('the alternatives depend on the delivery, never on the swing', () => {
    const left = fresh(FULL_OUTSWINGER);
    const swung = analyzeBall(
      play(FULL_OUTSWINGER, swingFor(FULL_OUTSWINGER, { directionDeg: -60, errorMs: -40 })).record,
    );
    expect(swung.options).toEqual(left.options);
    expect(swung.attempted).not.toEqual(left.attempted);
  });

  it('a spinner is also tried down the track', () => {
    const a = analyzeBall(SPINNER);
    expect(a.options.length).toBeGreaterThan(0);
    expect(a.ball.variation).toBe('stock');
  });

  it('a left-hander is analysed in his own (physics) frame', () => {
    const lefty = recordFor(
      { variation: 'outswing', lengthM: 3.6, lineM: 0.18, speedKph: 134 },
      { handedness: 'left' },
    );
    const a = analyzeBall(lefty);
    expect(a.ball.lineAtStumpsM).toBeGreaterThan(0.1);
    expect(a.options[0].outcome.dismissal).toBeNull();
  });
});

describe('analyzeBall: determinism', () => {
  it('the same record gives a byte-identical analysis across invalidation and a cache hit', () => {
    const r = play(GOOD_LENGTH, swingFor(GOOD_LENGTH, { directionDeg: 45, errorMs: 12 })).record;
    const a = JSON.stringify(fresh(r));
    const b = JSON.stringify(fresh(r));
    const c = JSON.stringify(analyzeBall(r));
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it('the exact-result memo key includes every normalized swing field', () => {
    const base = swingFor(GOOD_LENGTH, { directionDeg: 25, errorMs: 12 });
    const values = [
      null,
      base,
      { ...base, kind: base.kind === 'attack' ? ('defend' as const) : ('attack' as const) },
      { ...base, startT: base.startT + 0.0001 },
      { ...base, directionDeg: base.directionDeg + 0.1 },
      { ...base, power: base.power + 0.001 },
      { ...base, elevation: base.elevation + 0.001 },
      { ...base, footwork: base.footwork === 'auto' ? ('forward' as const) : ('auto' as const) },
    ];
    expect(new Set(values.map(coachResultKey)).size).toBe(values.length);
    const reordered = {
      footwork: base.footwork,
      elevation: base.elevation,
      power: base.power,
      directionDeg: base.directionDeg,
      startT: base.startT,
      kind: base.kind,
    };
    expect(coachResultKey(reordered)).toBe(coachResultKey(base));
  });

  it('never trusts a given result: the record alone decides the analysis', () => {
    const { record, result } = play(GOOD_LENGTH, swingFor(GOOD_LENGTH, { errorMs: -30 }));
    const other = play(FULL_OUTSWINGER, swingFor(FULL_OUTSWINGER, { errorMs: 60 })).result;
    const base = JSON.stringify(analyzeBall(record, null));
    expect(JSON.stringify(analyzeBall(record, result))).toBe(base);
    expect(JSON.stringify(analyzeBall(record, other))).toBe(base);
  });

  it('every analysis owns its options (cached alternatives cannot be changed through one)', () => {
    const a = analyzeBall(GOOD_LENGTH);
    a.options[0].expectedRuns = 99;
    expect(analyzeBall(GOOD_LENGTH).options[0].expectedRuns).not.toBe(99);
  });

  it('the sliced analysis is identical and really yields', async () => {
    const r = referenceRecord('ref-2');
    const sync = JSON.stringify(fresh(r));
    clearCoachCache();
    let yields = 0;
    const sliced = await analyzeBallInSlices(r, null, { sliceMs: 0, yieldTo: async () => void yields++ });
    expect(JSON.stringify(sliced)).toBe(sync);
    expect(yields).toBeGreaterThan(20);
  });

  it('a sliced analysis can be abandoned', async () => {
    clearCoachCache();
    const ac = new AbortController();
    const p = analyzeBallInSlices(referenceRecord('ref-3'), null, {
      sliceMs: 0,
      signal: ac.signal,
      yieldTo: async () => ac.abort(),
    });
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('analyzeBall: cost', () => {
  it('analyses a new ball within budget, and a repeat of it almost free', (ctx) => {
    const MEAN_BUDGET_MS = 3000;
    const REPEAT_BUDGET_MS = 250;
    // CPU milliseconds of the thread (tests/unit/support/timing.ts): a busy machine delays the analysis, it does not make it dearer.
    const cpuMs = (f: () => void) => {
      const t0 = cpuMicros();
      f();
      return (cpuMicros() - t0) / 1000;
    };
    analyzeBall(referenceRecord('ref-1'));
    // A sweep analyses the six reference balls, each with a cleared cache. Each ball counts as the least of up to three sweeps
    // (later sweeps are within 1% of the first on a quiet machine, so the least is the cost, not a warm-up); a mean already inside
    // the budget settles it (the minima can only fall), so a quiet machine runs one sweep.
    const ids = ['ref-1', 'ref-2', 'ref-3', 'ref-4', 'ref-5', 'ref-6'] as const;
    const meanOf = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const times = ids.map(() => Number.POSITIVE_INFINITY);
    for (let round = 0; round < 3 && !(meanOf(times) < MEAN_BUDGET_MS); round++) {
      ids.forEach((id, i) => {
        clearCoachCache();
        times[i] = Math.min(
          times[i],
          cpuMs(() => analyzeBall(referenceRecord(id))),
        );
      });
    }
    const repeat = bestOf(
      3,
      () =>
        cpuMs(() =>
          analyzeBall(play(referenceRecord('ref-6'), swingFor(referenceRecord('ref-6'), { kind: 'defend' })).record),
        ),
      REPEAT_BUDGET_MS,
    );
    const mean = meanOf(times);
    console.info(
      `coach analysis: ${times.map((t) => t.toFixed(0)).join(' ')} ms CPU (mean ${mean.toFixed(0)} ms); repeat ${repeat.toFixed(1)} ms`,
    );
    // The budget is ~150 ms per new ball in plain Node on an M1 Pro (docs/PRACTICE_COACH.md, "Cost"). Vitest's module
    // runner is ~3.5× slower and shared CI runners slower again, so this only guards against blow-ups.
    // The budgets are exact. Only an overrun on a machine above load 20 is skipped, by name; a quiet machine fails it.
    skipOverBudgetWhenLoaded(ctx, 'coach analysis, mean of six new balls', mean, MEAN_BUDGET_MS, 'ms');
    skipOverBudgetWhenLoaded(ctx, 'coach analysis, a repeat of a ball', repeat, REPEAT_BUDGET_MS, 'ms');
    expect(mean).toBeLessThan(MEAN_BUDGET_MS);
    expect(repeat).toBeLessThan(REPEAT_BUDGET_MS);
  }, 120_000);
});
