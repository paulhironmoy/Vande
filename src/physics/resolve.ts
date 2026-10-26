/**
 * The authoritative Practice pipeline for one delivery:
 *
 *   flight (fixed before the batter acts) + NormalizedSwing
 *     → bat path, swept bat–ball collision, contact (bat.ts, collision.ts, contact.ts)
 *     → the struck ball's flight and roll to rest or the rope (ball.ts)
 *     → fielding (fielding.ts) → automatic running (running.ts) or the boundary
 *     → outcome and coaching (scoring.ts, the one scoring and dismissal pipeline)
 *
 * Pure and deterministic: the same arguments always give a deep-equal DeliveryResult, so a DeliveryRecord (the one
 * replay representation) re-simulates exactly (`replayDelivery`). Everything is in the physics frame (the striker's
 * own, right-handed frame); presentation mirrors x for a left-handed striker.
 */
import type {
  AssistLevel,
  BallFlight,
  BallSample,
  LbwDecision,
  BowlerProfile,
  DeliveryRecord,
  DeliveryResult,
  FieldLayout,
  FielderPath,
  Handedness,
  NormalizedSwing,
  PitchCondition,
  SimEvent,
  Vec3,
} from '@/contracts/practice';
import { PRACTICE_SIM_VERSION } from '@/contracts/practice';
import { simulate } from './ball';
import { PITCHES, PITCH_HALF } from './constants';
import { strike, type StrikeResult } from './contact';
import { flight as deliveryFlight } from './delivery';
import { physicsBowler } from './field';
import { keeperTake, simulateFielding, standingPaths, type PostContactBall } from './fielding';
import { lbw } from './lbw';
import { autoRuns, runEvents } from './running';
import { judge, type PlayFacts } from './scoring';

/**
 * The struck (or passing) ball carried on by the one integrator (ball.ts `simulate`) until it stops, reaches the
 * rope, hits the striker's stumps (`detectStumps`, swept) or passes z = untilZ. The end state is always the last
 * sample.
 */
function carryBall(
  start: { t: number; p: Vec3; v: Vec3; spin?: Vec3 },
  conditions: PitchCondition,
  opts: { untilZ?: number; untilT?: number; detectStumps?: boolean; sampleEvery?: number } = {},
): { post: PostContactBall; stumps: { t: number; p: Vec3 } | null } {
  const r = simulate(
    { t: start.t, p: start.p, v: start.v, spin: start.spin ?? { x: 0, y: 0, z: 0 } },
    {
      pitch: PITCHES[conditions],
      untilZ: opts.untilZ,
      detectStumps: opts.detectStumps ?? false,
      ...(opts.untilT !== undefined ? { untilT: opts.untilT } : {}),
      ...(opts.sampleEvery ? { sampleEvery: opts.sampleEvery } : {}),
    },
  );
  const samples = r.samples;
  if (samples[samples.length - 1].t < r.end.t - 1e-12) samples.push({ t: r.end.t, p: r.end.p, v: r.end.v });
  return { post: { t0: start.t, samples, bounces: r.bounces.map((b) => ({ t: b.t, p: b.p })), boundary: r.boundary }, stumps: r.stumps };
}

function practiceFlightFor(r: Pick<DeliveryRecord, 'plan' | 'bowler' | 'conditions' | 'seed' | 'handedness'>): BallFlight {
  return deliveryFlight({ plan: r.plan, bowler: r.bowler, conditions: r.conditions, seed: r.seed, handedness: r.handedness });
}

export interface ResolveArgs {
  /** The delivery as bowled (from `flight()`), fixed before the batter acts. */
  flight: BallFlight;
  /** The player's swing; null = the ball was left alone. */
  swing: NormalizedSwing | null;
  field: FieldLayout;
  /** The real bowler (mirrored into the striker's frame here for a left-hander, as `flight()` does). */
  bowler: BowlerProfile;
  conditions: PitchCondition;
  handedness: Handedness;
  assist: AssistLevel;
  /** Extra timing tolerance of the Assisted performance tier (ms). */
  tierToleranceMs: number;
}

/** A ball that struck the pad or body is followed this long (rebound, drop, roll) before it is dead (s). */
const PAD_DEAD_S = 1.0;

const byT = (a: SimEvent, b: SimEvent) => a.t - b.t;

/** Flight samples strictly before time t (the ball up to an impact). */
function samplesBefore(flight: BallFlight, t: number): BallSample[] {
  return flight.samples.filter((s) => s.t < t - 1e-12);
}

/** Ball state on the flight at time t (interpolated). */
function flightAt(flight: BallFlight, t: number): BallSample {
  const s = flight.samples;
  if (t <= s[0].t) return s[0];
  for (let k = 1; k < s.length; k++) {
    if (s[k].t >= t) {
      const a = s[k - 1];
      const b = s[k];
      const u = (t - a.t) / (b.t - a.t || 1);
      const l = (x: number, y: number) => x + (y - x) * u;
      return { t, p: { x: l(a.p.x, b.p.x), y: l(a.p.y, b.p.y), z: l(a.p.z, b.p.z) }, v: { x: l(a.v.x, b.v.x), y: l(a.v.y, b.v.y), z: l(a.v.z, b.v.z) } };
    }
  }
  return s[s.length - 1];
}

function result(
  args: ResolveArgs,
  strike: StrikeResult,
  ball: BallSample[],
  fielders: FielderPath[],
  events: SimEvent[],
  facts: PlayFacts,
  deadT: number,
  lbwDecision: LbwDecision | null = null,
): DeliveryResult {
  const j = judge(facts);
  const evs = [...events, { t: deadT, kind: 'dead' } as SimEvent].sort(byT);
  return {
    version: PRACTICE_SIM_VERSION,
    flight: args.flight,
    swing: args.swing,
    footwork: strike.footwork,
    lbw: lbwDecision,
    contact: strike.contact,
    bat: strike.bat,
    ball,
    fielders,
    events: evs,
    outcome: j.outcome,
    coaching: j.coaching,
    deadT,
  };
}

/** Resolve one delivery: the whole authoritative pipeline. */
export function resolveDelivery(args: ResolveArgs): DeliveryResult {
  const { flight, swing, field } = args;
  const bowler = physicsBowler(args.bowler, args.handedness);
  const strike = strikeOf(flight, swing, args);
  const events: SimEvent[] = [{ t: 0, kind: 'release' }];
  if (flight.bounce) events.push({ t: flight.bounce.t, kind: 'bounce', p: flight.bounce.p });
  const base: PlayFacts = { flight, bowler, swing, contact: strike.contact, field, impact: null, bowled: null, playedOn: null, miss: strike.miss ? { delta: strike.miss.delta } : null, fielding: null, running: null };

  // The bat met the ball: it goes into the field (or onto the stumps).
  if (strike.exit) {
    const ex = strike.exit;
    events.push({ t: ex.t, kind: 'contact', contact: strike.contact.kind, p: ex.p });
    const { post, stumps } = carryBall(ex, args.conditions, { detectStumps: true });
    const pre = samplesBefore(flight, ex.t);
    if (stumps) {
      events.push({ t: stumps.t, kind: 'stumps', p: stumps.p });
      for (const b of post.bounces) if (b.t < stumps.t) events.push({ t: b.t, kind: 'ball_bounce', p: b.p });
      const ball = [...pre, ...post.samples.filter((x) => x.t <= stumps.t + 1e-9)];
      return result(args, strike, ball, standingPaths(field, stumps.t + 1, new Set(), true), events, { ...base, playedOn: stumps }, stumps.t);
    }
    const fielding = simulateFielding(field, post);
    events.push(...fielding.events);
    const running = fielding.play.kind === 'fielded' ? autoRuns(ex.t, fielding.play.returnT) : null;
    if (running) events.push(...runEvents(running));
    return result(args, strike, [...pre, ...fielding.ball], fielding.paths, events, { ...base, fielding, running }, fielding.deadT);
  }

  // Pad or body first: off the pad onto the stumps (bowled), LBW, or a dead ball. The rebound is the integrator's.
  if (strike.impact) {
    const im = strike.impact;
    events.push(im.part === 'pad' ? { t: im.t, kind: 'pad', p: im.p } : { t: im.t, kind: 'contact', contact: 'body', p: im.p });
    const verdict = lbw(flight, { t: im.t, p: im.p }, { shotOffered: swing !== null });
    const decision: LbwDecision = { out: verdict.out, reason: verdict.reason, impact: im.p, projected: verdict.projected };
    const { post, stumps } = carryBall({ t: im.t, p: im.p, v: im.vOut, spin: im.spinOut }, args.conditions, { detectStumps: true, untilT: im.t + PAD_DEAD_S });
    const pre = samplesBefore(flight, im.t);
    const impact = { t: im.t, p: im.p, part: im.part, lbw: verdict };
    for (const b of post.bounces) if (b.t < (stumps?.t ?? Infinity)) events.push({ t: b.t, kind: 'ball_bounce', p: b.p });
    if (stumps) {
      events.push({ t: stumps.t, kind: 'stumps', p: stumps.p });
      const ball = [...pre, ...post.samples.filter((x) => x.t <= stumps.t + 1e-9)];
      return result(args, strike, ball, standingPaths(field, stumps.t + 1, new Set(), true), events, { ...base, impact, offThePad: stumps }, stumps.t, decision);
    }
    const deadT = post.samples[post.samples.length - 1].t;
    return result(args, strike, [...pre, ...post.samples], standingPaths(field, deadT + 1, new Set(), verdict.out), events, { ...base, impact }, deadT, decision);
  }

  // Missed (or left) and on target: bowled.
  if (flight.wouldHitStumps) {
    const at = flightAt(flight, flight.stumpsT);
    events.push({ t: flight.stumpsT, kind: 'stumps', p: at.p });
    const ball = [...samplesBefore(flight, flight.stumpsT), at];
    const facts: PlayFacts = { ...base, bowled: { t: flight.stumpsT, p: at.p } };
    return result(args, strike, ball, standingPaths(field, flight.stumpsT + 1, new Set(), true), events, facts, flight.stumpsT);
  }

  // Missed (or left) and off target: the keeper takes it. No byes.
  const last = flight.samples[flight.samples.length - 1];
  const keeper = field.fielders.find((f) => f.role === 'keeper');
  // Carry the delivery on to the keeper with the spin it has after pitching, sampled every step like the flight.
  const carrySpin = flight.spin.afterBounce ?? flight.spin.release;
  const beyond = keeper && last.p.z < keeper.z ? carryBall({ t: last.t, p: last.p, v: last.v, spin: carrySpin }, args.conditions, { untilZ: keeper.z + 1, sampleEvery: 1 }).post.samples.slice(1) : [];
  const path = [...flight.samples, ...beyond];
  const take = keeperTake(field, path.filter((s) => s.p.z >= PITCH_HALF), 0);
  const takeT = take ? take.t : last.t;
  if (take) events.push({ t: take.t, kind: 'keeper_take', p: take.p });
  const deadT = takeT + 0.2;
  const ball = path.filter((s) => s.t <= takeT + 1e-9);
  const fielders = take ? [take.path, ...standingPaths(field, deadT + 1, new Set(['keeper']))] : standingPaths(field, deadT + 1);
  return result(args, strike, ball, fielders, events, base, deadT);
}

/** The flight of a recorded delivery (the same call the live delivery used). */
export function practiceFlight(record: Pick<DeliveryRecord, 'plan' | 'bowler' | 'conditions' | 'seed' | 'handedness'>): BallFlight {
  return practiceFlightFor(record);
}

/** What the bat (or the batter) did to the delivery (contact.ts `strike`, with the swept collision inside it). */
function strikeOf(flight: BallFlight, swing: NormalizedSwing | null, args: ResolveArgs): StrikeResult {
  return strike(flight, swing, { assist: args.assist, tierToleranceMs: args.tierToleranceMs });
}

/** Re-simulate a recorded delivery: reproduces the original DeliveryResult exactly. */
export function replayDelivery(record: DeliveryRecord): DeliveryResult {
  return resolveDelivery({
    flight: practiceFlight(record),
    swing: record.swing,
    field: record.field,
    bowler: record.bowler,
    conditions: record.conditions,
    handedness: record.handedness,
    assist: record.assist,
    tierToleranceMs: record.tierToleranceMs,
  });
}
