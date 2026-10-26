/** Shared helpers for the engine tests: seeded generators of legal plans, valid inputs and complete revealed logs. */
import type {
  BattingInput,
  CommitRecord,
  Conditions,
  DeliveryPlan,
  DeliveryVariant,
  InningsState,
  InputTrace,
  MatchEventLog,
  OverPlan,
  PlayerRef,
  RevealedDelivery,
} from '@/contracts';
import { SUPER_BALL_INDEX } from '@/contracts/cricket';
import { engine } from '@/engine';
import { rngFromKey, type Sfc32 } from '@/engine/prng';
import { battingInputFor, fitBudget, fitSuperBall, type DeliverySpec } from '@/engine/v1/policies';
import { ALLOWED_LENGTHS, FIELD_SETTINGS, INTENSITIES, INTENTS, LEGAL_ZONES, LINES, PITCHES, SHOTS, VARIANTS, WEATHERS } from '@/engine/v1/tables';
import { synthExecutionTrace } from '@/engine/v1/traces';

export const ALL_VARIANTS: readonly DeliveryVariant[] = VARIANTS;
export const CONDITIONS: readonly Conditions[] = PITCHES.flatMap((pitch) => WEATHERS.map((weather) => ({ pitch, weather })));

export function hexSeed(rng: Sfc32): string {
  let s = '';
  for (let i = 0; i < 4; i++) s += rng.nextU32().toString(16).padStart(8, '0');
  return s;
}

/** A legal plan drawn at random (all variants, any lines/lengths/intensities/intents, release spread `sigma`). */
export function randomPlan(rng: Sfc32, sigma = 40, variants: readonly DeliveryVariant[] = ALL_VARIANTS): OverPlan {
  const spec = (): DeliverySpec => {
    const variant = rng.pick(variants);
    return { variant, line: rng.pick(LINES), length: rng.pick(ALLOWED_LENGTHS[variant]), intensity: rng.pick(INTENSITIES), intent: rng.pick(INTENTS) };
  };
  const gesture = (): InputTrace => synthExecutionTrace(rng, 800 + rng.normal() * sigma);
  const balls = fitBudget([0, 1, 2, 3, 4, 5].map(spec)).map((d): DeliveryPlan => ({ ...d, gesture: gesture() }));
  return { v: 1, field: rng.pick(FIELD_SETTINGS), balls: balls as OverPlan['balls'], superBall: { ...fitSuperBall(spec()), gesture: gesture() } };
}

/** A valid batting input: random legal shot and zone, tap error N(0, sigma) (or no tap with probability pNoTap). */
export function randomInput(rng: Sfc32, delivery: RevealedDelivery, sigma = 60, pNoTap = 0.05): BattingInput {
  const shot = rng.pick(SHOTS);
  const zones = LEGAL_ZONES[shot];
  const zone = zones.length ? rng.pick(zones) : null;
  const tap = shot === 'leave' || rng.float() < pNoTap ? null : delivery.timing.releaseToContactMs + rng.normal() * sigma;
  return battingInputFor(rng, delivery, shot, zone, tap);
}

export const PLAYERS: [PlayerRef, PlayerRef] = [
  { id: 'p-alpha', alias: 'Alpha', avatar: { seed: 'alpha' }, kit: { id: 'kit-a', primary: '#1b1f5e', secondary: '#21d4fd', pattern: 'stripes' }, kind: 'human' },
  { id: 'p-bravo', alias: 'Bravo', avatar: { seed: 'bravo' }, kit: { id: 'kit-b', primary: '#5e1b3a', secondary: '#ffb347', pattern: 'hoops' }, kind: 'human' },
];

export interface PlayedMatch {
  seed: string;
  conditions: Conditions;
  plans: [OverPlan, OverPlan];
  inputs: [Array<BattingInput | null>, Array<BattingInput | null>];
  states: [InningsState, InningsState];
}

/** Plays both innings: `answer` returns the input for each delivery (null = never answered). */
export function playBoth(
  seed: string,
  conditions: Conditions,
  plans: [OverPlan, OverPlan],
  answer: (innings: 0 | 1, delivery: RevealedDelivery) => BattingInput | null,
): PlayedMatch {
  const states: [InningsState, InningsState] = [engine.startInnings(0), engine.startInnings(1)];
  const inputs: [Array<BattingInput | null>, Array<BattingInput | null>] = [[], []];
  for (const i of [0, 1] as const) {
    const plan = plans[i === 0 ? 1 : 0];
    let state = states[i];
    while (!state.done) {
      const ball = state.mainDone ? SUPER_BALL_INDEX : state.nextBall;
      const delivery = engine.revealDelivery(plan, ball, conditions);
      const input = answer(i, delivery);
      inputs[i].push(input);
      state = engine.resolveNextBall(state, { seed, conditions, plan, input }).state;
    }
    states[i] = state;
  }
  return { seed, conditions, plans, inputs, states };
}

export async function commitsFor(plans: [OverPlan, OverPlan], salts: [string, string] = ['salt-zero', 'salt-one']): Promise<[CommitRecord, CommitRecord]> {
  return Promise.all(
    [0, 1].map(async (p) => ({ player: p as 0 | 1, hash: await engine.commitHash(plans[p], salts[p]), sig: 'ab'.repeat(32), keyId: 'test-key', lockedHour: '2026-10-25T09', salt: salts[p] })),
  ) as Promise<[CommitRecord, CommitRecord]>;
}

export async function logFor(m: PlayedMatch, matchId = 'match-test'): Promise<MatchEventLog> {
  return engine.buildMatchLog({
    matchId,
    kind: 'duel',
    seed: m.seed,
    conditions: m.conditions,
    players: PLAYERS,
    commits: await commitsFor(m.plans),
    plans: m.plans,
    inputs: m.inputs,
    innings: m.states,
    meta: { createdHour: '2026-10-25T08', revealedHour: '2026-10-25T20' },
  });
}

/** A complete random match (random legal plans, random valid inputs) for a key. */
export function randomMatch(key: string, opts: { sigma?: number; pUnanswered?: number } = {}): PlayedMatch {
  const rng = rngFromKey(`test/match|${key}`);
  const conditions = rng.pick(CONDITIONS);
  const plans: [OverPlan, OverPlan] = [randomPlan(rng), randomPlan(rng)];
  return playBoth(hexSeed(rng), conditions, plans, (_i, d) => (rng.float() < (opts.pUnanswered ?? 0.03) ? null : randomInput(rng, d, opts.sigma ?? 60)));
}

/** Deep copy through JSON (what a stored log looks like after a round trip). */
export const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
