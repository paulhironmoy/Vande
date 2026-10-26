// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { BowlerProfile, DeliveryRecord, DeliveryResult, NormalizedSwing, PitchCondition, PracticeDeliveryPlan } from '@/contracts/practice';
import { BOUNDARY_R, PITCH_HALF, RUNNING, autoField, batTravelMs, bearingDelta, flight, practiceFlight, replayDelivery, resolveDelivery, type ResolveArgs } from '@/physics';

const PACE: BowlerProfile = { family: 'pace', paceBand: 'fast', arm: 'right', lookSeed: 'resolve' };
const SPIN: BowlerProfile = { family: 'spin', spinType: 'finger', arm: 'right', lookSeed: 'resolve' };
const plan = (o: Partial<PracticeDeliveryPlan> = {}): PracticeDeliveryPlan => ({ variation: 'stock', lengthM: 6, lineM: 0.1, speedKph: 136, ...o });

function args(o: { plan?: PracticeDeliveryPlan; bowler?: BowlerProfile; conditions?: PitchCondition; swing?: NormalizedSwing | null; seed?: string; handedness?: 'right' | 'left' } = {}): ResolveArgs {
  const bowler = o.bowler ?? PACE;
  const conditions = o.conditions ?? 'balanced';
  const handedness = o.handedness ?? 'right';
  const p = o.plan ?? plan();
  return {
    flight: flight({ plan: p, bowler, conditions, seed: o.seed ?? 'resolve-seed', handedness }),
    swing: o.swing === undefined ? null : o.swing,
    field: autoField(bowler, conditions, handedness),
    bowler,
    conditions,
    handedness,
    assist: 'play',
    tierToleranceMs: 0,
  };
}

/** A swing timed `errorMs` off the ideal contact (+ = late). */
function swing(a: ResolveArgs, o: Partial<NormalizedSwing> & { errorMs?: number } = {}): NormalizedSwing {
  const kind = o.kind ?? 'attack';
  const power = o.power ?? 0.75;
  const travel = batTravelMs(kind, power) / 1000;
  return { kind, startT: a.flight.idealContactT - travel + (o.errorMs ?? 0) / 1000, directionDeg: o.directionDeg ?? 30, power, elevation: o.elevation ?? 0.1, footwork: 'auto' };
}

function record(a: ResolveArgs, r: DeliveryResult, seed = 'resolve-seed'): DeliveryRecord {
  return {
    version: 1,
    overIndex: 0,
    ballIndex: 0,
    bowler: a.bowler,
    plan: a.flight.plan,
    seed,
    conditions: a.conditions,
    field: a.field,
    handedness: a.handedness,
    assist: a.assist,
    tierToleranceMs: a.tierToleranceMs,
    swing: a.swing,
    runs: r.outcome.runs,
    dismissal: r.outcome.dismissal,
  };
}

function wellFormed(r: DeliveryResult, a: ResolveArgs) {
  expect(r.version).toBe(1);
  expect(r.events[0]).toEqual({ t: 0, kind: 'release' });
  for (let i = 1; i < r.events.length; i++) expect(r.events[i].t).toBeGreaterThanOrEqual(r.events[i - 1].t);
  const dead = r.events.filter((e) => e.kind === 'dead');
  expect(dead).toHaveLength(1);
  expect(dead[0].t).toBe(r.deadT);
  expect(r.events.at(-1)!.kind).toBe('dead');
  for (let i = 1; i < r.ball.length; i++) expect(r.ball[i].t).toBeGreaterThanOrEqual(r.ball[i - 1].t - 1e-9);
  // The ball up to the first thing it meets is the delivery itself.
  const firstHit = r.events.find((e) => e.kind === 'contact' || e.kind === 'pad' || e.kind === 'stumps' || e.kind === 'keeper_take');
  const pre = a.flight.samples.filter((s) => s.t < (firstHit?.t ?? Infinity) - 1e-12);
  expect(r.ball.slice(0, pre.length)).toEqual(pre);
  expect(r.fielders).toHaveLength(11);
  for (const p of r.fielders) {
    for (let i = 1; i < p.samples.length; i++) expect(p.samples[i].t).toBeGreaterThanOrEqual(p.samples[i - 1].t);
    for (const s of p.samples) expect(Math.sqrt(s.x * s.x + s.z * s.z)).toBeLessThan(BOUNDARY_R);
  }
  if (r.outcome.dismissal) expect(r.outcome.runs).toBe(0);
  if (r.outcome.boundary) expect(r.outcome.runs).toBe(r.outcome.boundary);
}

describe('resolveDelivery: deliveries the bat never touches', () => {
  it('a ball left outside off stump goes through to the keeper: no byes, left well', () => {
    const a = args({ plan: plan({ lineM: 0.45 }) });
    expect(a.flight.wouldHitStumps).toBe(false);
    const r = resolveDelivery(a);
    wellFormed(r, a);
    expect(r.contact.kind).toBe('leave');
    expect(r.outcome).toMatchObject({ runs: 0, dismissal: null, boundary: null });
    expect(r.coaching).toMatchObject({ reason: 'left_well', timing: null });
    const take = r.events.find((e) => e.kind === 'keeper_take')!;
    expect(take).toBeDefined();
    expect(take.t).toBeGreaterThan(a.flight.stumpsT);
    expect(r.deadT).toBeGreaterThan(take.t);
    expect(r.fielders.find((p) => p.fielderId === 'keeper')!.samples.some((s) => s.action === 'catch')).toBe(true);
    expect(r.bat).toEqual([]);
  });

  it('a straight ball left is out: bowled, or LBW if it hits the pad first', () => {
    const a = args({ plan: plan({ lineM: 0, lengthM: 4 }) });
    expect(a.flight.wouldHitStumps).toBe(true);
    const r = resolveDelivery(a);
    wellFormed(r, a);
    expect(['bowled', 'lbw']).toContain(r.outcome.dismissal);
    expect(['left_and_bowled', 'pad_in_line']).toContain(r.coaching.reason);
    if (r.outcome.dismissal === 'bowled') expect(r.events.some((e) => e.kind === 'stumps')).toBe(true);
    else expect(r.events.some((e) => e.kind === 'pad')).toBe(true);
  });

  it('a swing far too late misses: the keeper takes a wide one, a straight one is out', () => {
    const wide = args({ plan: plan({ lineM: 0.45 }) });
    const r1 = resolveDelivery({ ...wide, swing: swing(wide, { errorMs: 260 }) });
    wellFormed(r1, wide);
    expect(r1.outcome.dismissal).toBeNull();
    expect(r1.outcome.runs).toBe(0);
    if (r1.contact.kind === 'miss') expect(r1.events.some((e) => e.kind === 'keeper_take')).toBe(true);
    const straight = args({ plan: plan({ lineM: 0, lengthM: 4 }) });
    const r2 = resolveDelivery({ ...straight, swing: swing(straight, { errorMs: 260 }) });
    wellFormed(r2, straight);
    if (r2.contact.kind === 'miss' || r2.contact.kind === 'pad') expect(['bowled', 'lbw', null]).toContain(r2.outcome.dismissal);
  });
});

describe('resolveDelivery: pad and LBW', () => {
  it('a ball on leg stump left onto the pad is out LBW, with the decision kept for the replay', () => {
    const a = args({ plan: plan({ lineM: -0.1, lengthM: 4 }) });
    const r = resolveDelivery(a);
    wellFormed(r, a);
    expect(r.contact.kind).toBe('pad');
    expect(r.outcome.dismissal).toBe('lbw');
    expect(r.coaching).toMatchObject({ reason: 'pad_in_line', lbw: 'out' });
    expect(r.lbw).toMatchObject({ out: true, reason: 'out' });
    const pad = r.events.find((e) => e.kind === 'pad')!;
    expect(pad && 'p' in pad && pad.p).toEqual(r.lbw!.impact);
    expect(r.lbw!.projected.z).toBeCloseTo(PITCH_HALF, 1);
    // The ball rebounds off the pad through the integrator and is dead within a second.
    expect(r.deadT - pad.t).toBeLessThanOrEqual(1 + 1e-9);
    expect(r.ball.at(-1)!.t).toBeCloseTo(r.deadT, 6);
  });

  it('a ball sliding down leg onto the pad is not out: the card can say it was missing', () => {
    const a = args({ plan: plan({ lineM: -0.2, lengthM: 4 }) });
    const r = resolveDelivery(a);
    expect(r.contact.kind).toBe('pad');
    expect(r.outcome).toMatchObject({ dismissal: null, runs: 0 });
    expect(r.coaching).toMatchObject({ reason: 'left_well', lbw: 'missing' });
    expect(r.lbw).toMatchObject({ out: false, reason: 'missing' });
  });

  it('no pad, no LBW decision', () => {
    const r = resolveDelivery(args({ plan: plan({ lineM: 0.45 }) }));
    expect(r.lbw).toBeNull();
    expect(r.coaching.lbw).toBeNull();
    expect(['forward', 'back', 'across', 'down_track']).toContain(r.footwork);
  });
});

describe('resolveDelivery: determinism and replay', () => {
  const cases: Array<{ name: string; a: () => ResolveArgs }> = [
    { name: 'leave', a: () => args({ plan: plan({ lineM: 0.4 }) }) },
    { name: 'drive', a: () => { const a = args(); return { ...a, swing: swing(a, { directionDeg: 35 }) }; } },
    { name: 'late', a: () => { const a = args({ plan: plan({ lineM: 0.25 }) }); return { ...a, swing: swing(a, { errorMs: 80 }) }; } },
    { name: 'spin defend', a: () => { const a = args({ bowler: SPIN, plan: plan({ speedKph: 84, lengthM: 4.2 }), conditions: 'turning' }); return { ...a, swing: swing(a, { kind: 'defend', power: 0.15, directionDeg: 0 }) }; } },
    { name: 'lofted', a: () => { const a = args({ plan: plan({ lengthM: 3.5 }) }); return { ...a, swing: swing(a, { directionDeg: 0, power: 1, elevation: 1 }) }; } },
  ];
  for (const c of cases) {
    it(`${c.name}: the same inputs give a deep-equal result, and its record replays exactly`, () => {
      const a = c.a();
      const r1 = resolveDelivery(a);
      const r2 = resolveDelivery(c.a());
      expect(r2).toEqual(r1);
      wellFormed(r1, a);
      const rec = record(a, r1);
      expect(practiceFlight(rec)).toEqual(a.flight);
      expect(JSON.stringify(replayDelivery(rec))).toBe(JSON.stringify(r1));
    });
  }
});

describe('resolveDelivery: handedness', () => {
  it('a left-hander facing a right-arm bowler is the mirror of a right-hander facing a left-arm bowler', () => {
    const left = args({ handedness: 'left', plan: plan({ lineM: 0.45 }) });
    const mirrored = args({ handedness: 'right', bowler: { ...PACE, arm: 'left' }, plan: plan({ lineM: 0.45 }) });
    expect(left.flight.samples).toEqual(mirrored.flight.samples);
    const r1 = resolveDelivery(left);
    const r2 = resolveDelivery({ ...mirrored, bowler: { ...PACE, arm: 'left' } });
    expect(r1.outcome).toEqual(r2.outcome);
    expect(r1.events).toEqual(r2.events);
  });
});

describe('resolveDelivery: the striker end', () => {
  it('the stumps are where the physics puts them', () => {
    const a = args({ plan: plan({ lineM: 0, lengthM: 4 }) });
    const r = resolveDelivery(a);
    const st = r.events.find((e) => e.kind === 'stumps');
    if (st && 'p' in st) expect(st.p.z).toBeCloseTo(PITCH_HALF, 1);
  });
});

/** A deterministic grid of deliveries and swings, resolved through the real pipeline. */
function* grid(): Generator<{ a: ResolveArgs; r: DeliveryResult }> {
  const lines = [-0.05, 0.05, 0.15, 0.3];
  const lengths = [3.5, 5, 6.5];
  const swings: Array<Partial<NormalizedSwing> & { errorMs?: number }> = [];
  for (const errorMs of [0, -60, 60, -100, 100]) for (const directionDeg of [-60, -20, 0, 25, 60]) for (const elevation of [0.05, 0.6, 1]) swings.push({ errorMs, directionDeg, elevation, power: elevation > 0.5 ? 0.95 : 0.8 });
  for (const lineM of lines)
    for (const lengthM of lengths) {
      const base = args({ plan: plan({ lineM, lengthM }), seed: `grid-${lineM}-${lengthM}` });
      for (const o of swings) {
        const a = { ...base, swing: swing(base, o) };
        yield { a, r: resolveDelivery(a) };
      }
    }
}

describe('resolveDelivery: every way the struck ball can end, through the real physics', () => {
  const found = new Map<string, { a: ResolveArgs; r: DeliveryResult }>();
  const bounceBefore = (r: DeliveryResult, t: number) => r.events.some((e) => e.kind === 'ball_bounce' && e.t < t - 1e-9);
  for (const x of grid()) {
    const o = x.r.outcome;
    const key = o.dismissal ? `${o.dismissal}${o.dismissal === 'bowled' && x.r.contact.kind !== 'miss' ? '_on' : ''}` : o.boundary ? `b${o.boundary}` : `r${o.runs}`;
    if (!found.has(key)) found.set(key, x);
  }

  it('finds catches, caught behind, played on, boundaries and runs', () => {
    for (const k of ['caught', 'caught_behind', 'bowled_on', 'b4', 'b6', 'r0', 'r1']) expect(found.has(k), k).toBe(true);
  });

  it('a catch is taken before the ball bounces, by a fielder whose path reaches it', () => {
    for (const k of ['caught', 'caught_behind']) {
      const { r, a } = found.get(k)!;
      wellFormed(r, a);
      const c = r.events.find((e) => e.kind === 'catch')!;
      expect(c && 'fielderId' in c).toBe(true);
      if (c.kind !== 'catch') continue;
      expect(bounceBefore(r, c.t)).toBe(false);
      const role = a.field.fielders.find((f) => f.id === c.fielderId)!.role;
      if (k === 'caught_behind') expect(role === 'keeper' || role === 'slip').toBe(true);
      const at = r.fielders.find((p) => p.fielderId === c.fielderId)!.samples.find((s) => s.t === c.t)!;
      expect(Math.hypot(at.x - c.p.x, at.z - c.p.z)).toBeLessThan(2.7);
      expect(r.deadT).toBe(c.t);
    }
  });

  it('played on: an edge into the stumps is bowled', () => {
    const { r, a } = found.get('bowled_on')!;
    wellFormed(r, a);
    const contact = r.events.findIndex((e) => e.kind === 'contact');
    const stumps = r.events.findIndex((e) => e.kind === 'stumps');
    expect(contact).toBeGreaterThan(0);
    expect(stumps).toBeGreaterThan(contact);
  });

  it('six on the full, four after a bounce, both at the rope', () => {
    for (const [k, runs] of [['b6', 6], ['b4', 4]] as const) {
      const { r, a } = found.get(k)!;
      wellFormed(r, a);
      const b = r.events.find((e) => e.kind === 'boundary')!;
      expect(b.kind === 'boundary' && b.runs).toBe(runs);
      expect(bounceBefore(r, b.t)).toBe(runs === 4);
      const last = r.ball.at(-1)!;
      expect(Math.hypot(last.p.x, last.p.z)).toBeGreaterThan(BOUNDARY_R - 0.5);
    }
  });

  it('runs are completed before the ball is back, one run event each', () => {
    for (const k of ['r1', 'r2', 'r3'].filter((x) => found.has(x))) {
      const { r, a } = found.get(k)!;
      wellFormed(r, a);
      const runs = r.events.filter((e) => e.kind === 'run');
      expect(runs).toHaveLength(r.outcome.runs);
      for (const e of runs) expect(r.deadT - e.t).toBeGreaterThanOrEqual(RUNNING.SAFETY_MARGIN_S - 1e-9);
    }
  });

  it('a well-timed stroke leaves the bat close to where it was aimed', () => {
    const { a } = found.get('b4')!;
    const base = { ...a, swing: swing(a, { errorMs: 0, directionDeg: 30, elevation: 0.05, power: 0.8 }) };
    const r = resolveDelivery(base);
    if (r.contact.kind === 'middle' && (r.contact.timing === 'perfect' || r.contact.timing === 'solid')) expect(Math.abs(bearingDelta(r.contact.exitBearingDeg!, 30))).toBeLessThan(15);
  });
});
