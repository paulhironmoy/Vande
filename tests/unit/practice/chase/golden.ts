/**
 * The golden tuples (definition of done CHC-02): a (seed, difficulty, input policy, assistance, hand) is played through
 * the physics and reduced to one canonical result. The same tuple must give the same result every time, in Node and in a
 * browser. scripts/chase-golden.mjs makes, repeats and checks them; the unit tests check a few.
 */
import type { AssistLevel, Handedness } from '@/contracts/practice';
import { rngFromKey } from '@/engine/prng';
import { sha256Hex } from '@/engine/sha256';
import { CHASE_DIFFICULTIES, CHASE_SEED_COUNT, chaseSeedAt, makeChase, type ChaseDifficulty } from '@/practice/chase';
import { BATTERS } from './batters';
import { playChase } from './helpers';

export interface GoldenTuple {
  seed: string;
  difficulty: ChaseDifficulty;
  policy: string;
  assist: AssistLevel;
  hand: Handedness;
}

export interface GoldenResult {
  result: string;
  runs: number;
  ballsFaced: number;
  /** SHA-256 of the canonical JSON of the final chase state and every delivery record (plans, swings, runs, wickets). */
  hash: string;
}

const ASSISTS: readonly AssistLevel[] = ['learn', 'play', 'real'];

/** `count` tuples chosen from a key: every pool seed region, every policy, difficulty, assistance and hand. */
export function goldenTuples(count: number, key = 'chase-golden'): GoldenTuple[] {
  return Array.from({ length: count }, (_, i) => {
    const rng = rngFromKey(`${key}|${i}`);
    return {
      // The first 256 tuples walk the whole pool once; the rest are drawn.
      seed: chaseSeedAt(i < CHASE_SEED_COUNT ? i : rng.int(0, CHASE_SEED_COUNT - 1)),
      difficulty: CHASE_DIFFICULTIES[rng.int(0, 2)],
      policy: BATTERS[rng.int(0, BATTERS.length - 1)][0],
      assist: ASSISTS[rng.int(0, 2)],
      hand: rng.float() < 0.25 ? 'left' : 'right',
    };
  });
}

export function runTuple(t: GoldenTuple): GoldenResult {
  const batter = BATTERS.find(([name]) => name === t.policy)?.[1];
  if (!batter) throw new Error(`unknown policy ${t.policy}`);
  const def = makeChase(t.seed, t.difficulty)!;
  const p = playChase(def, batter, { id: `golden:${t.seed}:${t.difficulty}`, assist: t.assist, handedness: t.hand });
  return {
    result: p.state.result,
    runs: p.state.runs,
    ballsFaced: p.state.ballsFaced,
    hash: sha256Hex(JSON.stringify([p.state, p.records])),
  };
}
