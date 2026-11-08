// @vitest-environment node
/**
 * Fielders who are trying, and no superheroes (wedge anti-fake rule 11), as properties of the physics.
 *
 * Every catch, stop and take must lie inside the stated physical budget (src/physics/fielding.ts ATHLETICS, DIVE,
 * THROW): reaction, acceleration, braking, top speed, dive length and duration, hands' reach, throw accuracy. These
 * tests check it on every path of every fielder, over at least 1,000 struck balls flown by the one integrator (seeded
 * launches from the crease, so the property does not wait on the bat), at least 1,000 deliveries the keeper takes,
 * and the reference over through the whole pipeline. They also check that the variation (fumbles, throws) is seeded
 * and exact on replay, and that the field moves as a team.
 */
import { describe, expect, it } from 'vitest';
import type { BallSample, FieldLayout, FielderPath, SimEvent } from '@/contracts/practice';
import { rngFromKey } from '@/engine/prng';
import { simulate } from '@/physics/ball';
import { PITCHES, PITCH_HALF } from '@/physics/constants';
import { flight } from '@/physics/delivery';
import { autoField } from '@/physics/field';
import {
  ATHLETICS,
  DIVE,
  KEEPER_RANGE_M,
  LOOSE,
  PICKUP_S,
  THROW,
  diveLengths,
  fielderClass,
  keeperTake,
  simulateFielding,
  type Athletics,
  type FieldingResult,
  type PostContactBall,
} from '@/physics/fielding';
import { BOUNDARY_R, CONTACT_Z } from '@/physics/geometry';
import { resolveDelivery } from '@/physics/resolve';
import { overBalls, swingOf, type Intent } from '@/practice/game/evaluate';
import { ballSeed, randomOver } from '@/practice/game/overs';
import { REFERENCE_CONDITIONS, REFERENCE_OVER } from '@/practice/game/reference';

const CONDITIONS = ['balanced', 'green', 'hard', 'turning'] as const;
const hyp = (x: number, z: number) => Math.sqrt(x * x + z * z);
/** Positions are rounded to the millimetre (fielding.ts PathBuilder), so speeds and reaches allow for it. */
const MM = 0.0015;

function posAt(path: FielderPath, t: number): { x: number; z: number } {
  const s = path.samples;
  if (t <= s[0].t) return s[0];
  for (let i = 0; i + 1 < s.length; i++) {
    if (t <= s[i + 1].t) {
      const dt = s[i + 1].t - s[i].t;
      const u = dt > 0 ? (t - s[i].t) / dt : 1;
      return { x: s[i].x + (s[i + 1].x - s[i].x) * u, z: s[i].z + (s[i + 1].z - s[i].z) * u };
    }
  }
  return s[s.length - 1];
}

/**
 * Every budget violation on one path (empty when none): speed, acceleration and braking (from segment speeds at least
 * 0.1 s long, so millimetre rounding cannot fake them), no step before the reaction, and every dive's take-off,
 * duration, hips' travel and speed. `startT` is when he could first see the ball (contact, or the keeper's watch).
 */
function pathViolations(path: FielderPath, a: Athletics, startT: number): string[] {
  const out: string[] = [];
  const s = path.samples;
  const hipMax = Math.max(...Object.values(diveLengths(a)));
  for (const x of s) if (![x.t, x.x, x.z].every(Number.isFinite)) out.push(`non-finite path sample at ${x.t}`);
  for (let i = 0; i + 1 < s.length; i++) {
    const dt = s[i + 1].t - s[i].t;
    if (dt < -1e-12) out.push(`time runs back at ${s[i].t}`);
    if (dt <= 1e-9) continue;
    const d = hyp(s[i + 1].x - s[i].x, s[i + 1].z - s[i].z);
    if (d > 0.002 && s[i].t < startT + a.reactionS - 1e-6)
      out.push(`moves before his reaction at ${s[i].t.toFixed(3)}`);
    if (s[i].action === 'dive') {
      const T = dt;
      // His speed at the take-off: at most the previous segment's average plus what he can gain over half of it.
      const pdt = i > 0 ? s[i].t - s[i - 1].t : 0;
      const prev = pdt > 1e-9 ? hyp(s[i].x - s[i - 1].x, s[i].z - s[i - 1].z) / pdt + (a.accel * pdt) / 2 : 0;
      if (s[i].t < startT + a.reactionS - 1e-6) out.push(`dives before his reaction at ${s[i].t.toFixed(3)}`);
      if (T > DIVE.fullS + 1e-6) out.push(`dive of ${T.toFixed(3)} s`);
      // A dive drawn from back on his run (a near-instant lunge) may still gain what his run gains over it.
      const cap = Math.max(
        Math.min(hipMax, (hipMax / DIVE.fullS) * T),
        Math.min(prev + a.accel * T + 0.01, a.topSpeed) * T,
      );
      if (d > cap + 0.003) out.push(`dive hips ${d.toFixed(3)} m in ${T.toFixed(3)} s (cap ${cap.toFixed(3)})`);
    } else if ((d - MM) / dt > a.topSpeed + 1e-6)
      out.push(`${((d - MM) / dt).toFixed(2)} m/s ${s[i].action} at ${s[i].t.toFixed(3)} (top ${a.topSpeed})`);
    if (hyp(s[i].x, s[i].z) > BOUNDARY_R) out.push(`over the rope at ${s[i].t}`);
  }
  // Acceleration and braking, piece by piece between dives (a dive's take-off and landing are its own).
  const pieces: Array<typeof s> = [[]];
  for (let i = 0; i < s.length; i++) {
    pieces[pieces.length - 1].push(s[i]);
    if (s[i].action === 'dive') pieces.push([]);
  }
  const lim = Math.max(a.accel, a.decel) + 0.6;
  for (const pc of pieces) {
    const picked: typeof s = [];
    for (const x of pc) if (!picked.length || x.t - picked[picked.length - 1].t >= 0.1 - 1e-9) picked.push(x);
    for (let k = 0; k + 2 < picked.length; k++) {
      const [p0, p1, p2] = [picked[k], picked[k + 1], picked[k + 2]];
      const v1x = (p1.x - p0.x) / (p1.t - p0.t);
      const v1z = (p1.z - p0.z) / (p1.t - p0.t);
      const v2x = (p2.x - p1.x) / (p2.t - p1.t);
      const v2z = (p2.z - p1.z) / (p2.t - p1.t);
      const acc = hyp(v2x - v1x, v2z - v1z) / ((p2.t - p0.t) / 2);
      if (acc > lim)
        out.push(`${acc.toFixed(1)} m/s² at ${p1.t.toFixed(3)} (${p0.action}→${p2.action}, limit ${lim.toFixed(1)})`);
    }
  }
  return out;
}

/** The ball never jumps: consecutive samples are no further apart than its speed (or a fielder's hands) allows. */
function ballViolations(ball: BallSample[]): string[] {
  const out: string[] = [];
  for (let i = 1; i < ball.length; i++) {
    const a = ball[i - 1];
    const b = ball[i];
    const dt = b.t - a.t;
    if (dt <= 0) {
      out.push(`ball time not increasing at ${b.t}`);
      continue;
    }
    if (![b.t, b.p.x, b.p.y, b.p.z, b.v.x, b.v.y, b.v.z].every(Number.isFinite)) {
      out.push(`non-finite ball sample at ${b.t}`);
      continue;
    }
    const d = Math.sqrt((b.p.x - a.p.x) ** 2 + (b.p.y - a.p.y) ** 2 + (b.p.z - a.p.z) ** 2);
    const v = Math.max(Math.hypot(a.v.x, a.v.y, a.v.z), Math.hypot(b.v.x, b.v.y, b.v.z), 10);
    if (d > v * dt + 0.02)
      out.push(`ball jumps ${d.toFixed(3)} m in ${(dt * 1000).toFixed(1)} ms at ${b.t.toFixed(3)}`);
  }
  return out;
}

interface Tally {
  plays: Record<string, number>;
  violations: string[];
  movers: number[];
  throwErrors: number[];
  oneBounce: number;
  /** Returns run in by the keeper or bowler himself (no throw). */
  carried: number;
  diveTakes: number;
}

const note = (t: Tally, id: string, list: string[]) => {
  for (const v of list) if (t.violations.length < 40) t.violations.push(`${id}: ${v}`);
};

/** All the budget properties of one fielded struck ball. */
function checkPlay(t: Tally, id: string, field: FieldLayout, post: PostContactBall, r: FieldingResult): void {
  const p = r.play;
  const key =
    p.kind === 'fielded'
      ? `${p.how}${p.dive ? '+dive' : ''}`
      : `${p.kind}${p.kind === 'caught' && p.dive ? '+dive' : ''}`;
  t.plays[key] = (t.plays[key] ?? 0) + 1;
  const athOf = (fid: string) => ATHLETICS[fielderClass(field.fielders.find((f) => f.id === fid)!)];
  let movers = 0;
  for (const path of r.paths) {
    note(t, `${id} ${path.fielderId}`, pathViolations(path, athOf(path.fielderId), post.t0));
    const s0 = path.samples[0];
    if (path.samples.some((x) => hyp(x.x - s0.x, x.z - s0.z) > 0.5)) movers++;
    if (path.samples[path.samples.length - 1].t < r.deadT - 1e-9)
      note(t, `${id} ${path.fielderId}`, ['path ends before the ball is dead']);
  }
  t.movers.push(movers);
  note(t, id, ballViolations(r.ball));
  const ev = (k: SimEvent['kind']) => r.events.filter((e) => e.kind === k);
  // Reach at the take: on his feet, or the hands DIVE.handM beyond the hips.
  for (const e of [...ev('catch'), ...ev('field')] as Array<Extract<SimEvent, { kind: 'catch' | 'field' }>>) {
    const a = athOf(e.fielderId);
    const at = posAt(
      r.paths.find((x) => x.fielderId === e.fielderId)!,
      e.t,
    );
    const gap = hyp(at.x - e.p.x, at.z - e.p.z);
    const dive = p.kind !== 'boundary' && p.dive;
    const lim = dive
      ? DIVE.handM
      : e.kind === 'catch' || (p.kind === 'fielded' && p.how === 'dropped')
        ? a.catchReachM
        : a.stopReachM;
    if (gap > lim + 0.003) note(t, id, [`${e.kind} ${e.fielderId} reaches ${gap.toFixed(3)} m (limit ${lim})`]);
  }
  // Every dive take shows its dive: a dive sample at least 0.02 s before the take (never a take that replaces it), or,
  // for a take that comes sooner than that after his reaction, from the moment he can move (a dive never starts before).
  if (p.kind !== 'boundary' && p.dive) {
    const path = r.paths.find((x) => x.fielderId === p.fielderId)!;
    const canMove = post.t0 + athOf(p.fielderId).reactionS;
    const lead = Math.min(0.02, p.t - canMove);
    const dive = [...path.samples].reverse().find((x) => x.action === 'dive' && x.t <= p.t + 1e-9);
    if (!dive || dive.t > p.t - lead + 1e-9 || dive.t >= p.t - 1e-9)
      note(t, id, [`${p.fielderId}'s dive take at ${p.t.toFixed(3)} has no dive drawn before it`]);
    t.diveTakes++;
  }
  if (p.kind === 'caught') {
    const path = r.paths.find((x) => x.fielderId === p.fielderId)!;
    const cel = path.samples.find((x) => x.action === 'celebrate');
    if (cel && cel.t < p.t + (p.dive ? DIVE.recoverS : 0.3) - 1e-9)
      note(t, id, [`celebrates ${(cel.t - p.t).toFixed(2)} s after the catch`]);
  }
  if (p.kind !== 'fielded') return;
  const fielder = field.fielders.find((f) => f.id === p.fielderId)!;
  if (
    fielder.role === 'keeper' &&
    p.how !== 'dropped' &&
    hyp(p.p.x - fielder.x, p.p.z - fielder.z) > KEEPER_RANGE_M + 1e-6
  )
    note(t, id, ['the keeper fields a ground ball out of his range']);
  const th = ev('throw')[0] as Extract<SimEvent, { kind: 'throw' }> | undefined;
  const thrower = th ? th.fielderId : p.fielderId;
  const tp = r.paths.find((x) => x.fielderId === thrower)!;
  // The gather: the start of the pickup that leads to the throw (or the run in), and the ball within his reach then.
  let pick: number | null = null;
  for (let i = tp.samples.length - 1; i >= 0; i--) {
    const x = tp.samples[i];
    if (x.t > p.releaseT + 1e-9) continue;
    if (x.action === 'pickup') pick = x.t;
    else if (pick !== null) break;
  }
  if (p.how === 'dropped' || p.how === 'misfield' || p.how === 'parried') {
    if (pick === null) note(t, id, ['a loose ball is never picked up']);
    else {
      if (p.releaseT < pick + PICKUP_S.stop - 1e-9)
        note(t, id, [`released ${(p.releaseT - pick).toFixed(2)} s after the pickup`]);
      const b = r.ball.find((x) => x.t >= pick! - 1e-9)!;
      const at = posAt(tp, pick);
      if (hyp(b.p.x - at.x, b.p.z - at.z) > athOf(thrower).stopReachM + 0.003)
        note(t, id, ['picks up a loose ball out of reach']);
      // Never stands over the ball: the toucher is never still near it for long between the touch and the gather.
      const path = r.paths.find((x) => x.fielderId === p.fielderId)!;
      let still = 0;
      let worst = 0;
      let prev = posAt(path, p.t + (p.dive ? DIVE.recoverS : 0));
      for (let tt = p.t + (p.dive ? DIVE.recoverS : 0) + 0.05; tt <= pick + 1e-9; tt += 0.05) {
        const q = posAt(path, tt);
        const ball = r.ball.find((x) => x.t >= tt - 1e-9) ?? r.ball[r.ball.length - 1];
        still = hyp(q.x - prev.x, q.z - prev.z) < 0.05 && hyp(ball.p.x - q.x, ball.p.z - q.z) < 1.5 ? still + 0.05 : 0;
        worst = Math.max(worst, still);
        prev = q;
      }
      if (worst > LOOSE.reactS + 0.25)
        note(t, id, [`the ${p.how} fielder stands over the ball for ${worst.toFixed(2)} s`]);
    }
  }
  if (th) {
    // The throw arrives off line within its bounded error, the receiver there to take it.
    const arrival = r.ball.find((b) => b.t > th.t + 1e-6 && b.v.x === 0 && b.v.y === 0 && b.v.z === 0)!;
    const stumps = { x: 0, z: p.end === 'striker' ? PITCH_HALF : -PITCH_HALF };
    const d = hyp(stumps.x - th.p.x, stumps.z - th.p.z);
    const err = hyp(arrival.p.x - stumps.x, arrival.p.z - stumps.z);
    t.throwErrors.push(err);
    if (err > 3.47 * (THROW.baseM + THROW.perM * d) + 0.01)
      note(t, id, [`throw ${err.toFixed(2)} m off line over ${d.toFixed(1)} m`]);
    const receiver = field.fielders.find((f) => f.role === (p.end === 'striker' ? 'keeper' : 'bowler'))!;
    const rp = posAt(
      r.paths.find((x) => x.fielderId === receiver.id)!,
      arrival.t,
    );
    const reach = hyp(rp.x - arrival.p.x, rp.z - arrival.p.z);
    if (reach > ATHLETICS[fielderClass(receiver)].catchReachM + 0.003)
      note(t, id, [`the ${receiver.role} is ${reach.toFixed(2)} m from the throw when it arrives`]);
    if (r.events.some((e) => e.kind === 'ball_bounce' && e.t > th.t)) t.oneBounce++;
  } else t.carried++;
}

/** A seeded launch from the crease, flown by the integrator: a struck ball independent of the bat. */
function launch(i: number): { id: string; field: FieldLayout; post: PostContactBall; seed: string } | null {
  const r = rngFromKey(`fielding-budget|launch|${i}`);
  const conditions = CONDITIONS[i % 4];
  const over = randomOver({ seed: `fielding-budget|over|${i}`, conditions, assist: 'play', beginner: false });
  const field = autoField(over.bowler, conditions, 'right', over.ball);
  const speed = 4 + 42 * r.float();
  const bearing = (-180 + 360 * r.float()) * (Math.PI / 180);
  const elev = (r.float() < 0.55 ? -4 + 14 * r.float() : 10 + 55 * r.float()) * (Math.PI / 180);
  const v = {
    x: Math.sin(bearing) * Math.cos(elev) * speed,
    y: Math.sin(elev) * speed,
    z: -Math.cos(bearing) * Math.cos(elev) * speed,
  };
  const t0 = 0.45 + 0.4 * r.float();
  const sim = simulate(
    {
      t: t0,
      p: { x: 0.25 * (r.float() - 0.5), y: 0.25 + 0.7 * r.float(), z: CONTACT_Z },
      v,
      spin: { x: 0, y: 0, z: 0 },
    },
    { pitch: PITCHES[conditions], detectStumps: true },
  );
  if (sim.stumps) return null;
  const samples = sim.samples;
  if (samples[samples.length - 1].t < sim.end.t - 1e-12) samples.push({ t: sim.end.t, p: sim.end.p, v: sim.end.v });
  return {
    id: `launch#${i}`,
    field,
    post: { t0, samples, bounces: sim.bounces.map((b) => ({ t: b.t, p: b.p })), boundary: sim.boundary },
    seed: `fielding-budget|seed|${i}`,
  };
}

describe('the fielding budget on 1,200 struck balls', () => {
  const tally: Tally = {
    plays: {},
    violations: [],
    movers: [],
    throwErrors: [],
    oneBounce: 0,
    carried: 0,
    diveTakes: 0,
  };
  const cases: Array<NonNullable<ReturnType<typeof launch>>> = [];
  for (let i = 0; i < 1200; i++) {
    const c = launch(i);
    if (c) cases.push(c);
  }
  // The fast keeper (FIELD 5b, rand#912 on the frozen bat): a ball at 0.097 m, too low to catch on his feet, taken by
  // the keeper running at 6.5 m/s with a near-instant lunge. Its dive must be drawn, and he must not stop dead.
  const FAST_KEEPER = (() => {
    const conditions = 'balanced' as const;
    const field = autoField(
      { family: 'pace', paceBand: 'fast', arm: 'left', lookSeed: '729131f10567dcea' },
      conditions,
      'right',
      { colour: 'white' },
    );
    const t0 = 0.45215938513772436;
    const sim = simulate(
      {
        t: t0,
        p: { x: -0.07842370549669511, y: 0.2755461326335333, z: 7.807132395943313 },
        v: { x: 3.518604403483889, y: 9.010505189378751, z: 4.4666704057616595 },
        spin: { x: 164.01034086814806, y: -197.6848496489194, z: -71.71438955667175 },
      },
      { pitch: PITCHES[conditions], detectStumps: true },
    );
    const samples = sim.samples;
    if (samples[samples.length - 1].t < sim.end.t - 1e-12) samples.push({ t: sim.end.t, p: sim.end.p, v: sim.end.v });
    return {
      id: 'fast-keeper',
      field,
      post: {
        t0,
        samples,
        bounces: sim.bounces.map((b) => ({ t: b.t, p: b.p })),
        boundary: sim.boundary,
      } as PostContactBall,
      seed: 'ae0af72a3d21fc438822abb7da635f98',
    };
  })();
  cases.push(FAST_KEEPER);

  it('no fielder exceeds his speed, acceleration, braking, reaction, dive or reach, and the ball never jumps', () => {
    for (const c of cases) checkPlay(tally, c.id, c.field, c.post, simulateFielding(c.field, c.post, { seed: c.seed }));
    expect(cases.length).toBeGreaterThanOrEqual(1000);
    expect(tally.violations).toEqual([]);
    // The fast keeper is in the set and is the lunge it was: a diving catch by the keeper.
    expect(simulateFielding(FAST_KEEPER.field, FAST_KEEPER.post, { seed: FAST_KEEPER.seed }).play).toMatchObject({
      kind: 'caught',
      fielderId: 'keeper',
      dive: true,
    });
    expect(tally.diveTakes).toBeGreaterThan(20);
    // The properties are not vacuous: every way of fielding a ball occurs.
    for (const k of [
      'stop',
      'dive_stop+dive',
      'collect',
      'caught',
      'caught+dive',
      'dropped',
      'misfield',
      'parried+dive',
      'boundary',
    ])
      expect(tally.plays[k] ?? 0, k).toBeGreaterThan(0);
    expect(tally.oneBounce).toBeGreaterThan(10);
    // Returns he runs in himself occur too, and their ball (in his hand, no wind-up) is finite like every other.
    expect(tally.carried).toBeGreaterThan(0);
  }, 120_000);

  it('the whole field moves with the ball: at least eight of the eleven on every ball that goes into the field', () => {
    expect(tally.movers.length).toBe(cases.length);
    expect(Math.min(...tally.movers)).toBeGreaterThanOrEqual(8);
  });

  it('throws are off line by a seeded, bounded error that grows with their length', () => {
    expect(tally.throwErrors.length).toBeGreaterThan(300);
    expect(tally.throwErrors.filter((e) => e > 0.05).length).toBeGreaterThan(tally.throwErrors.length / 2);
    const mean = tally.throwErrors.reduce((s, e) => s + e, 0) / tally.throwErrors.length;
    expect(mean).toBeGreaterThan(0.3);
    expect(mean).toBeLessThan(1.5);
  });

  it('is deterministic: the same ball, field and seed give the same play, paths and ball (byte for byte after a JSON round trip)', () => {
    for (const c of cases.slice(0, 60)) {
      const a = simulateFielding(c.field, c.post, { seed: c.seed });
      expect(simulateFielding(c.field, c.post, { seed: c.seed })).toEqual(a);
      const b = simulateFielding(
        JSON.parse(JSON.stringify(c.field)) as FieldLayout,
        JSON.parse(JSON.stringify(c.post)) as PostContactBall,
        { seed: c.seed },
      );
      expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    }
  });

  it('without a seed nothing varies: no misfields and every throw lands on the stumps', () => {
    let throws = 0;
    for (const c of cases.slice(0, 300)) {
      const r = simulateFielding(c.field, c.post);
      expect(r.play.kind === 'fielded' && r.play.how === 'misfield').toBe(false);
      const th = r.events.find((e) => e.kind === 'throw');
      if (!th || r.play.kind !== 'fielded') continue;
      const arrival = r.ball.find((b) => b.t > th.t + 1e-6 && b.v.x === 0 && b.v.y === 0 && b.v.z === 0)!;
      expect(Math.abs(arrival.p.x)).toBeLessThan(1e-9);
      expect(Math.abs(Math.abs(arrival.p.z) - PITCH_HALF)).toBeLessThan(1e-9);
      throws++;
    }
    expect(throws).toBeGreaterThan(50);
  });
});

describe('the keeper on 1,000 deliveries passed or left', () => {
  it('moves across within the budget and gets his gloves to every one of them', () => {
    const violations: string[] = [];
    let takes = 0;
    let short = 0;
    for (let i = 0; takes < 1000 && i < 3000; i++) {
      const conditions = CONDITIONS[i % 4];
      const over = randomOver({
        seed: `fielding-budget|keeper-over|${i}`,
        conditions,
        assist: 'play',
        beginner: false,
      });
      const k = i % 6;
      const fl = flight({
        plan: over.balls[k],
        bowler: over.bowler,
        conditions,
        seed: ballSeed(over, k),
        handedness: 'right',
        ball: over.ball,
      });
      if (fl.wouldHitStumps) continue;
      const field = autoField(over.bowler, conditions, 'right', over.ball);
      const keeper = field.fielders.find((f) => f.role === 'keeper')!;
      const last = fl.samples[fl.samples.length - 1];
      const on =
        last.p.z < keeper.z
          ? simulate(
              { t: last.t, p: last.p, v: last.v, spin: fl.spin.afterBounce ?? fl.spin.release },
              { pitch: PITCHES[conditions], untilZ: keeper.z + 1, sampleEvery: 1 },
            ).samples.slice(1)
          : [];
      const take = keeperTake(
        field,
        [...fl.samples, ...on].filter((s) => s.p.z >= PITCH_HALF),
        0,
      )!;
      takes++;
      for (const v of pathViolations(take.path, ATHLETICS.keeper, 0))
        if (violations.length < 20) violations.push(`keeper#${i}: ${v}`);
      const at = posAt(take.path, take.t);
      const gap = Math.abs(take.p.x - at.x);
      if (take.shortM > 0 || gap > (take.dive ? DIVE.handM : ATHLETICS.keeper.catchReachM) + 0.003) short++;
    }
    expect(takes).toBe(1000);
    expect(violations).toEqual([]);
    // A ball past his reach would need a rule Practice does not have (no byes, no wides): none occurs.
    expect(short).toBe(0);
  }, 120_000);

  it('dives only within his dive budget when he reads it late, with his body travelling towards the ball', () => {
    const field = autoField({ family: 'pace', paceBand: 'fast', arm: 'right', lookSeed: 'k' }, 'balanced');
    const keeper = field.fielders.find((f) => f.role === 'keeper')!;
    let dives = 0;
    for (const lateral of [-3.2, -2.6, -2, -1.4, 1.4, 2, 2.6, 3.2])
      for (const watch of [0.45, 0.55, 0.65]) {
        const samples: BallSample[] = Array.from({ length: 120 }, (_, j) => ({
          t: 0.45 + j * 0.005,
          p: { x: keeper.x + lateral, y: 0.7, z: PITCH_HALF + j * 0.2 },
          v: { x: 0, y: 0, z: 40 },
        }));
        const take = keeperTake(field, samples, watch)!;
        expect(pathViolations(take.path, ATHLETICS.keeper, watch)).toEqual([]);
        const at = posAt(take.path, take.t);
        if (take.dive) {
          dives++;
          const d = take.path.samples.find((s) => s.action === 'dive');
          expect(d, `${lateral}/${watch}`).toBeDefined();
          if (!d) continue;
          // The hips travel towards the ball, and the gloves reach it (or the shortfall is recorded).
          expect(Math.sign(at.x - d.x) === Math.sign(lateral) || Math.abs(at.x - d.x) < 1e-9).toBe(true);
          expect(Math.abs(take.p.x - at.x)).toBeLessThanOrEqual(DIVE.handM + take.shortM + 0.003);
        }
      }
    expect(dives).toBeGreaterThan(5);
  });
});

describe('the reference over through the whole pipeline', () => {
  const STROKES: Intent[] = [
    { kind: 'attack', directionDeg: 55, elevation: 0.05, power: 0.7, footwork: 'forward' },
    { kind: 'attack', directionDeg: 0, elevation: 0.05, power: 0.6, footwork: 'forward' },
    { kind: 'defend', directionDeg: 0, elevation: 0, power: 0.2, footwork: 'back' },
    { kind: 'attack', directionDeg: -135, elevation: 0, power: 0.55, footwork: 'back' },
    { kind: 'attack', directionDeg: 0, elevation: 0.9, power: 0.8, footwork: 'auto' },
  ];

  it('every fielder of every result stays inside the budget, and the field moves on every ball in play', () => {
    const balls = overBalls(REFERENCE_OVER, REFERENCE_CONDITIONS);
    const violations: string[] = [];
    for (const b of balls)
      for (const intent of STROKES) {
        for (const errorMs of [0, 40]) {
          const r = resolveDelivery({
            flight: b.flight,
            swing: swingOf(b, intent, errorMs),
            field: b.field,
            bowler: b.over.bowler,
            conditions: b.conditions,
            handedness: 'right',
            assist: 'real',
            tierToleranceMs: 0,
          });
          const contact = r.events.find((e) => e.kind === 'contact');
          const startT = contact ? contact.t : 0;
          for (const path of r.fielders) {
            const f = b.field.fielders.find((x) => x.id === path.fielderId)!;
            for (const v of pathViolations(
              path,
              ATHLETICS[fielderClass(f)],
              f.role === 'keeper' && !contact ? 0 : startT,
            ))
              if (violations.length < 20)
                violations.push(`${b.ballIndex}/${intent!.directionDeg}/${errorMs}: ${path.fielderId} ${v}`);
          }
          for (const v of ballViolations(r.ball)) if (violations.length < 20) violations.push(`${b.ballIndex}: ${v}`);
          if (r.events.some((e) => e.kind === 'field' || e.kind === 'catch' || e.kind === 'boundary')) {
            const moved = r.fielders.filter((p) =>
              p.samples.some((x) => hyp(x.x - p.samples[0].x, x.z - p.samples[0].z) > 0.5),
            ).length;
            expect(moved, `ref ball ${b.ballIndex + 1}`).toBeGreaterThanOrEqual(8);
          }
        }
      }
    expect(violations).toEqual([]);
  }, 120_000);
});
