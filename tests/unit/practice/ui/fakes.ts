/**
 * Fixtures for the flow controller tests: a fake engine with simple, deterministic rules that follow the contract's
 * shapes (it is not the physics: the controller must not care how outcomes are made), and a fake stage that logs every
 * call together with what storage held at that moment, so the tests can check what was saved before what was shown.
 */
import {
  PRACTICE_MAX_OVERS,
  PRACTICE_SIM_VERSION,
  type BallFlight,
  type BowlerProfile,
  type DeliveryRecord,
  type DeliveryResult,
  type DeviceAssessment,
  type FieldLayout,
  type NormalizedSwing,
  type PracticeDeliveryPlan,
  type PracticeInningsState,
  type PracticeOverPlan,
  type QualityProfileId,
} from '@/contracts';
import type { BenchmarkRun } from '@/perf';
import { PRACTICE_KEYS, memoryStore, type KeyStore } from '@/practice/store';
import type { NextDeliveryLike, PracticeEngine, PracticeStageLike, StageEvent, StageEventPayloads, StageFactory } from '@/practice/ui/flow/types';

export const bowler: BowlerProfile = { family: 'pace', paceBand: 'fast', arm: 'right', lookSeed: 'look' };

export const field: FieldLayout = {
  id: 'fake',
  fielders: Array.from({ length: 11 }, (_, i) => ({ id: `f${i}`, role: i === 0 ? 'keeper' : i === 1 ? 'bowler' : 'cover', x: (i % 3) * 5 - 5, z: i * 3 - 15 })),
};

export function plan(variation: PracticeDeliveryPlan['variation'] = 'stock'): PracticeDeliveryPlan {
  return { variation, lengthM: 5.5, lineM: 0.1, speedKph: 135 };
}

export function overPlan(seed: string, source: PracticeOverPlan['source'] = 'random'): PracticeOverPlan {
  return { version: PRACTICE_SIM_VERSION, bowler, balls: [plan(), plan(), plan(), plan(), plan(), plan()], seed, source };
}

/** Swing conventions of the fake physics: attack direction 180 = caught; power ≥ 0.8 six, ≥ 0.5 four, else 1. */
export function fakeResult(flight: BallFlight, swing: NormalizedSwing | null): DeliveryResult {
  let runs: DeliveryResult['outcome']['runs'] = 0;
  let dismissal: DeliveryResult['outcome']['dismissal'] = null;
  let boundary: 4 | 6 | null = null;
  if (!swing) dismissal = flight.plan.variation === 'yorker' ? 'bowled' : null;
  else if (swing.kind === 'attack') {
    if (swing.directionDeg === 180) dismissal = 'caught';
    else if (swing.power >= 0.8) (runs = 6), (boundary = 6);
    else if (swing.power >= 0.5) (runs = 4), (boundary = 4);
    else runs = 1;
  }
  return {
    version: PRACTICE_SIM_VERSION,
    flight,
    swing,
    footwork: 'forward',
    lbw: null,
    contact: {
      kind: swing ? 'middle' : 'leave',
      t: swing ? 0.5 : null,
      timingErrorMs: swing ? 12 : null,
      timing: swing ? 'perfect' : 'none',
      point: null,
      bladeU: swing ? 0.22 : null,
      faceBearingDeg: swing ? 20 : null,
      batSpeedKph: swing ? 80 : null,
      exitSpeedKph: swing ? 110 : null,
      exitBearingDeg: swing ? 40 : null,
      exitElevationDeg: swing ? 5 : null,
      intendedBearingDeg: swing ? swing.directionDeg : null,
    },
    bat: [],
    ball: [],
    fielders: [],
    events: [],
    outcome: { runs, boundary, dismissal, fielderId: null, endBearingDeg: 40, endDistanceM: 60, region: swing ? 'cover' : null },
    coaching: { reason: swing ? 'found_the_gap' : 'left_well', timing: swing ? 'on_time' : null, zone: swing ? 'cover' : null, fielderRole: null, lbw: null },
    deadT: 3,
  };
}

function flightOf(p: PracticeDeliveryPlan, seed: string): BallFlight {
  return {
    version: PRACTICE_SIM_VERSION,
    plan: p,
    seed,
    release: { p: { x: 0, y: 2, z: -9 }, v: { x: 0, y: 0, z: 37 }, spinRps: 0, seamDeg: 0, speedKph: p.speedKph },
    bounce: null,
    idealContactT: 0.5,
    stumpsT: 0.56,
    wouldHitStumps: true,
    samples: [],
    spin: { release: { x: 0, y: 0, z: 0 }, afterBounce: null },
  };
}

export function fakeEngine(over: Partial<PracticeEngine> = {}): PracticeEngine & { calls: string[] } {
  const calls: string[] = [];
  const nextDelivery = (s: PracticeInningsState): NextDeliveryLike | null => {
    if (s.status !== 'batting' || !s.current || s.current.deliveries.length >= 6) return null;
    const i = s.current.deliveries.length;
    return { overIndex: s.overs.length, ballIndex: i, plan: s.current.plan.balls[i], seed: `${s.current.plan.seed}:${i}`, bowler: s.current.plan.bowler, field: s.current.field, conditions: s.conditions, handedness: s.handedness, assist: s.assist };
  };
  const makeRecord = (next: NextDeliveryLike, swing: NormalizedSwing | null, tierToleranceMs: number, result: Pick<DeliveryResult, 'outcome'>): DeliveryRecord => ({
    version: PRACTICE_SIM_VERSION,
    ...next,
    tierToleranceMs,
    swing,
    runs: result.outcome.runs,
    dismissal: result.outcome.dismissal,
  });
  const reducer: PracticeEngine['inningsReducer'] = (s, a) => {
    switch (a.type) {
      case 'chooseOver':
        return s.status === 'choosing_over' ? { ...s, status: 'batting', current: { plan: a.plan, field: a.field, deliveries: [] } } : s;
      case 'deliveryStarted': {
        const next = nextDelivery(s);
        return next && !s.inFlight ? { ...s, inFlight: { overIndex: next.overIndex, ballIndex: next.ballIndex } } : s;
      }
      case 'deliveryResolved': {
        if (!s.inFlight || !s.current) return s;
        const r = a.record;
        const deliveries = [...s.current.deliveries, r];
        const base = { ...s, runs: s.runs + r.runs, balls: s.balls + 1, inFlight: null };
        const done = deliveries.length === 6;
        const overs = done ? [...s.overs, { plan: s.current.plan, deliveries }] : s.overs;
        const current = done ? null : { ...s.current, deliveries };
        if (r.dismissal) return { ...base, overs, current, status: 'out', dismissal: { record: r } };
        if (!done) return { ...base, current };
        return { ...base, overs, current: null, status: overs.length >= PRACTICE_MAX_OVERS ? 'complete' : 'over_complete' };
      }
      case 'nextOver':
        return s.status === 'over_complete' ? { ...s, status: 'choosing_over' } : s;
      case 'abandon':
        return s.status === 'out' || s.status === 'complete' ? s : { ...s, status: 'complete', inFlight: null };
    }
  };
  const engine: PracticeEngine & { calls: string[] } = {
    calls,
    flight: (a) => {
      calls.push(`flight:${a.seed}`);
      return flightOf(a.plan, a.seed);
    },
    resolveDelivery: (a) => {
      calls.push('resolve');
      return fakeResult(a.flight, a.swing);
    },
    autoField: () => field,
    regionOf: () => 'cover',
    randomOver: (a) => overPlan(a.seed),
    guidedStart: (seed) => ({ warmup: { bowler, plan: plan(), seed: `${seed}:w` }, over: overPlan(seed, 'guided') }),
    ballSeed: (o, i) => `${o.seed}:${i}`,
    newInnings: (a) => ({ version: PRACTICE_SIM_VERSION, id: a.id, status: 'choosing_over', conditions: a.conditions, assist: a.assist, handedness: a.handedness, runs: 0, balls: 0, overs: [], current: null, inFlight: null, dismissal: null }),
    inningsReducer: reducer,
    resumeInnings: (s) => {
      calls.push('resume');
      const next = nextDelivery(s);
      if (!s.inFlight || !next) return { ...s, inFlight: null };
      const result = fakeResult(flightOf(next.plan, next.seed), null);
      return reducer(s, { type: 'deliveryResolved', record: makeRecord(next, null, 0, result) });
    },
    nextDelivery,
    makeRecord,
    replayDelivery: (r) => {
      calls.push('replay');
      return fakeResult(flightOf(r.plan, r.seed), r.swing);
    },
    repeatDelivery: (r, swing) => {
      calls.push('repeat');
      return fakeResult(flightOf(r.plan, r.seed), swing);
    },
    overSummary: (o, results) => {
      const rs = o.deliveries.map((r, i) => results?.[i] ?? fakeResult(flightOf(r.plan, r.seed), r.swing));
      return {
        overIndex: o.deliveries[0]?.overIndex ?? 0,
        runs: rs.reduce((a, r) => a + r.outcome.runs, 0),
        balls: rs.length,
        fours: rs.filter((r) => r.outcome.boundary === 4).length,
        sixes: rs.filter((r) => r.outcome.boundary === 6).length,
        boundaries: rs.filter((r) => r.outcome.boundary).length,
        dots: rs.filter((r) => r.outcome.runs === 0).length,
        timing: { perfect: rs.filter((r) => r.swing).length, solid: 0, mistimed: 0, missed: 0, none: rs.filter((r) => !r.swing).length },
        scoringAreas: [],
        weakest: null,
        dismissal: rs.find((r) => r.outcome.dismissal)?.outcome.dismissal ?? null,
        complete: rs.length === 6,
      };
    },
    inningsSummary: (s) => ({
      status: s.status,
      finished: s.status === 'out' || s.status === 'complete',
      runs: s.runs,
      balls: s.balls,
      overs: `${Math.floor(s.balls / 6)}.${s.balls % 6}`,
      completedOvers: s.overs.length,
      survivedBalls: s.dismissal ? s.balls - 1 : s.balls,
      fours: 0,
      sixes: 0,
      dots: 0,
      strikeRate: 0,
      timing: { perfect: 0, solid: 0, mistimed: 0, missed: 0, none: 0 },
      scoringAreas: [],
      perOver: [],
      dismissal: null,
    }),
    coachingFacts: (r) => ({
      reason: r.coaching.reason,
      timing: r.coaching.timing,
      timingBand: r.contact.timing,
      timingErrorMs: r.contact.timingErrorMs,
      contact: r.contact.kind,
      intendedBearingDeg: r.contact.intendedBearingDeg,
      intendedRegion: r.swing ? 'cover' : null,
      exitBearingDeg: r.contact.exitBearingDeg,
      exitRegion: r.swing ? 'cover' : null,
      bearingErrorDeg: null,
      exitSpeedKph: r.contact.exitSpeedKph,
      exitElevationDeg: r.contact.exitElevationDeg,
      movement: { airM: 0, pitchM: 0, lineAtStumpsM: 0, heightAtBatM: 0.5 },
      delivery: { variation: r.flight.plan.variation, speedKph: r.flight.release.speedKph, lengthM: 5.5, lineM: 0.1, lengthBand: 'good', lineBand: 'outside_off' },
      fielder: null,
      returnS: null,
      runs: r.outcome.runs,
      boundary: r.outcome.boundary,
      dismissal: r.outcome.dismissal,
      endBearingDeg: r.outcome.endBearingDeg,
      endDistanceM: r.outcome.endDistanceM,
      endRegion: r.outcome.region,
    }),
    normalizeGesture: (input, ctx) => {
      const s0 = input.samples[0];
      if (!s0) return null;
      const startT = (s0.t - ctx.calibrationMs - ctx.releasePerfMs) / 1000;
      return input.samples.length === 1 ? { kind: 'defend', startT, directionDeg: 0, power: 0.2, elevation: 0, footwork: 'auto' } : { kind: 'attack', startT, directionDeg: 30, power: 0.6, elevation: 0, footwork: 'auto' };
    },
    ...over,
  };
  return engine;
}

export interface StageLogEntry {
  call: string;
  /** What storage held for the innings when the call was made. */
  saved: PracticeInningsState | null;
}

export class FakeStage implements PracticeStageLike {
  readonly log: StageLogEntry[] = [];
  release = 0;
  scale = 1;
  disposed = false;
  private handlers = new Map<string, Array<(p: unknown) => void>>();
  constructor(
    readonly kind: '3d' | '2d',
    private store: KeyStore,
    private opts: { failMount?: boolean; lateReleaseMs?: number } = {},
  ) {}
  private note(call: string) {
    const raw = this.store.getItem(PRACTICE_KEYS.innings);
    this.log.push({ call, saved: raw ? (JSON.parse(raw).state as PracticeInningsState) : null });
  }
  async mount() {
    this.note('mount');
    if (this.opts.failMount) throw new Error('no webgl2');
  }
  setScene() {
    this.note('setScene');
  }
  async benchmark(): Promise<BenchmarkRun> {
    this.note('benchmark');
    return { frameMs: Array.from({ length: 90 }, () => 16.7), shaderCompileMs: 100, contextLosses: 0, renderer: 'Fake GPU', webgl2: true, hardware: true };
  }
  async bowl() {
    this.note('bowl');
    await new Promise((r) => setTimeout(r, 1500 / this.scale + (this.opts.lateReleaseMs ?? 0)));
    // A busy main thread runs the release callback late: the release time itself is the scheduled one.
    this.release = performance.now() - (this.opts.lateReleaseMs ?? 0);
    return { releasePerfMs: this.release };
  }
  beginSwing() {
    this.note('beginSwing');
  }
  async play() {
    this.note('play');
    await new Promise((r) => setTimeout(r, 2000 / this.scale));
  }
  async replay() {
    this.note('replay');
    await new Promise((r) => setTimeout(r, 1000));
  }
  setProfile(p: QualityProfileId) {
    this.note(`setProfile:${p}`);
  }
  stats() {
    return { fps: 60, avgFrameMs: 16.7, p95FrameMs: 17, spikes: 0, lastInputToBatMs: 42, renderer: 'Fake GPU' };
  }
  on<E extends StageEvent>(event: E, cb: (payload: StageEventPayloads[E]) => void) {
    const fn = cb as (p: unknown) => void;
    const list = this.handlers.get(event) ?? [];
    list.push(fn);
    this.handlers.set(event, list);
    return () => this.handlers.set(event, (this.handlers.get(event) ?? []).filter((x) => x !== fn));
  }
  emit<E extends StageEvent>(event: E, payload: StageEventPayloads[E]) {
    for (const cb of this.handlers.get(event) ?? []) cb(payload);
  }
  setLearnCue() {}
  setReducedMotion() {}
  setTimeScale(k: number) {
    this.scale = k;
  }
  simToPerf(t: number) {
    return this.release + (t * 1000) / this.scale;
  }
  dispose() {
    this.disposed = true;
    this.note('dispose');
  }
  calls(): string[] {
    return this.log.map((e) => e.call);
  }
}

export function stageFactory(store: KeyStore, opts: { fail3d?: boolean; lateReleaseMs?: number } = {}): StageFactory & { stages: FakeStage[] } {
  const stages: FakeStage[] = [];
  const make: StageFactory = async ({ force2d }) => {
    const s = new FakeStage(force2d ? '2d' : '3d', store, { failMount: !force2d && opts.fail3d, lateReleaseMs: opts.lateReleaseMs });
    stages.push(s);
    return s;
  };
  return Object.assign(make, { stages });
}

export function assessment(tier: DeviceAssessment['tier'] = 'full'): DeviceAssessment {
  return {
    webgl2: tier !== 'below',
    hardware: tier !== 'below',
    renderer: 'Fake GPU',
    shaderCompileMs: 100,
    avgFps: tier === 'full' ? 60 : tier === 'assisted' ? 50 : 20,
    p95FrameMs: 17,
    spikes: 0,
    contextLosses: 0,
    inputToFrameMs: 20,
    memoryGb: 4,
    tier,
    profile: tier === 'full' ? 'standard' : 'lite',
    reasons: tier === 'below' ? ['no_webgl2'] : ['ok'],
    toleranceMs: tier === 'full' ? 0 : tier === 'assisted' ? 12 : 20,
  };
}

export { memoryStore };
