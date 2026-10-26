/**
 * Golden replay logs for engine v1 (tests/unit/engine/fixtures/golden-v1.json). Generated once by
 * `node scripts/simulate-golden.mjs --write` and then frozen: the test suite verifies the committed file with the
 * current engine, so any change to v1 that alters an outcome fails until it becomes engine version 2.
 */
import type { BattingInput, CommitRecord, Conditions, InningsState, MatchEventLog, OverPlan, PlayerRef, RevealedDelivery } from '@/contracts';
import { SUPER_BALL_INDEX } from '@/contracts/cricket';
import { commitHash } from '../canonical';
import { rngFromKey } from '../prng';
import { engineV1 as engine } from '../v1';
import { battingInputFor } from '../v1/policies';
import { hexSeed } from './harness';

const PLAYERS: [PlayerRef, PlayerRef] = [
  { id: 'golden-a', alias: 'Golden A', avatar: { seed: 'golden-a' }, kit: { id: 'kit-golden-a', primary: '#1d1f6b', secondary: '#20e3f5', pattern: 'chevron' }, kind: 'human' },
  { id: 'golden-b', alias: 'Golden B', avatar: { seed: 'golden-b' }, kit: { id: 'kit-golden-b', primary: '#6b1d3c', secondary: '#ffb83f', pattern: 'sash' }, kind: 'human' },
];

type Answer = (innings: 0 | 1, d: RevealedDelivery) => BattingInput | null;

async function build(name: string, seed: string, conditions: Conditions, plans: [OverPlan, OverPlan], answer: Answer): Promise<MatchEventLog> {
  const states: [InningsState, InningsState] = [engine.startInnings(0), engine.startInnings(1)];
  const inputs: [Array<BattingInput | null>, Array<BattingInput | null>] = [[], []];
  for (const i of [0, 1] as const) {
    const plan = plans[i === 0 ? 1 : 0];
    let state = states[i];
    while (!state.done) {
      const d = engine.revealDelivery(plan, state.mainDone ? SUPER_BALL_INDEX : state.nextBall, conditions);
      const input = answer(i, d);
      inputs[i].push(input);
      state = engine.resolveNextBall(state, { seed, conditions, plan, input }).state;
    }
    states[i] = state;
  }
  const salts = [`${name}-salt-0`, `${name}-salt-1`];
  const commits = (await Promise.all(
    [0, 1].map(async (p) => ({ player: p as 0 | 1, hash: await commitHash(plans[p], salts[p]), sig: 'a1'.repeat(32), keyId: 'golden-key-1', lockedHour: '2026-10-25T10', salt: salts[p] })),
  )) as [CommitRecord, CommitRecord];
  return engine.buildMatchLog({
    matchId: `golden-${name}`,
    kind: 'duel',
    seed,
    conditions,
    players: PLAYERS,
    commits,
    plans,
    inputs,
    innings: states,
    meta: { createdHour: '2026-10-25T09', revealedHour: '2026-10-25T21' },
  });
}

/** Searches seeds deterministically until `accept` holds. */
async function search(name: string, accept: (log: MatchEventLog) => boolean, make: (k: number) => { seed: string; conditions: Conditions; plans: [OverPlan, OverPlan]; answer: Answer }): Promise<MatchEventLog> {
  for (let k = 0; k < 5000; k++) {
    const m = make(k);
    const log = await build(name, m.seed, m.conditions, m.plans, m.answer);
    if (accept(log)) return log;
  }
  throw new Error(`golden: no ${name} match found`);
}

export async function goldenLogs(): Promise<MatchEventLog[]> {
  const human = (key: string, sigma: number): Answer => {
    const rng = rngFromKey(`golden/answer|${key}`);
    return (_i, d) => {
      const shot = rng.pick(['drive', 'loft', 'cut_pull', 'rotate', 'sweep', 'defend'] as const);
      const zones = { drive: ['cover', 'mid_off', 'mid_on'], loft: ['mid_on', 'midwicket', 'cover'], cut_pull: ['point', 'square_leg'], rotate: ['mid_on', 'point'], sweep: ['square_leg', 'fine_leg'], defend: [null] } as const;
      return battingInputFor(rng, d, shot, rng.pick(zones[shot] as readonly (BattingInput['zone'])[]), d.timing.releaseToContactMs + rng.normal() * sigma);
    };
  };
  const duel = await search(
    'duel',
    (log) => !log.superBall.used && log.innings.every((i) => i.ballsFaced === 6) && log.result.marginRuns > 0,
    (k) => {
      const rng = rngFromKey(`golden/duel|${k}`);
      const conditions: Conditions = { pitch: 'hard', weather: 'clear' };
      return { seed: hexSeed(rng), conditions, plans: [engine.ghostPlan('maestro', `g${k}`, conditions), engine.autoOver(`a${k}`, conditions)], answer: (i, d) => engine.ghostBat(i === 0 ? 'enforcer' : 'trickster', `b${k}`, d) };
    },
  );
  const tie = await search(
    'tie',
    (log) => log.superBall.used,
    (k) => {
      const rng = rngFromKey(`golden/tie|${k}`);
      const conditions: Conditions = { pitch: 'slow', weather: 'dew' };
      return { seed: hexSeed(rng), conditions, plans: [engine.ghostPlan('trickster', `t${k}`, conditions), engine.ghostPlan('swinger', `s${k}`, conditions)], answer: human(`tie${k}`, 55) };
    },
  );
  const allOut = await search(
    'all_out',
    (log) => log.innings.some((i) => i.wickets === 2 && i.ballsFaced <= 4),
    (k) => {
      const rng = rngFromKey(`golden/allout|${k}`);
      const conditions: Conditions = { pitch: 'green', weather: 'humid' };
      return { seed: hexSeed(rng), conditions, plans: [engine.ghostPlan('swinger', `w${k}`, conditions), engine.ghostPlan('maestro', `m${k}`, conditions)], answer: human(`allout${k}`, 140) };
    },
  );
  const unanswered = await search(
    'unanswered',
    (log) => log.inputs.some((i) => i.length < 7),
    (k) => {
      const rng = rngFromKey(`golden/unanswered|${k}`);
      const conditions: Conditions = { pitch: 'green', weather: 'clear' };
      const base = human(`un${k}`, 70);
      return { seed: hexSeed(rng), conditions, plans: [engine.autoOver(`u${k}`, conditions), engine.ghostPlan('anchor', `n${k}`, conditions)], answer: (i, d) => (d.ball === 2 || d.ball === SUPER_BALL_INDEX ? null : base(i, d)) };
    },
  );
  return [duel, tie, allOut, unanswered];
}
