/**
 * Stand-ins, recognised from a revealed log alone. When a player misses the batting deadline, the platform asks Auto XI
 * (`autoBat`) for each remaining ball with the key `autoXiSeed(log.seed, seat, ball)`. Auto XI is deterministic, so an
 * input identical to its proposal for that key was Auto XI's (a person cannot produce the identical trace). No log
 * field is needed. Engine v1 policies; imports nothing heavy (no ranking, simulation or verifier).
 */
import type { MatchEventLog } from '@/contracts';
import { canonicalJson } from './canonical';
import { validateBattingInput } from './v1/batting';
import { revealDelivery } from './v1/delivery';
import { autoBat } from './v1/policies';

/** The autoBat key for Auto XI batting for `seat` on `ball` at the batting deadline (platform: backend/src/match). */
export function autoXiSeed(seed: string, seat: 0 | 1, ball: number): string {
  return `${seed}:auto-xi:${seat}:${ball}`;
}

/**
 * Ball numbers (0–5, 6 = Super Ball) of each innings that Auto XI batted at a batting deadline, [innings 0, innings 1].
 * Daily Six never bats for the player (its missed balls are leaves), so a daily log gives empty lists.
 */
export function autoXiBalls(log: MatchEventLog): [number[], number[]] {
  const out: [number[], number[]] = [[], []];
  if (!log || log.kind === 'daily' || !Array.isArray(log.plans) || !Array.isArray(log.inputs)) return out;
  for (const i of [0, 1] as const) {
    const seat = log.innings?.[i]?.batter ?? i;
    const over = log.plans[seat === 0 ? 1 : 0];
    if (!over) continue;
    for (const input of log.inputs[i] ?? []) {
      if (!input || typeof input.ball !== 'number') continue;
      const d = revealDelivery(over, input.ball, log.conditions);
      const auto = validateBattingInput(autoBat(autoXiSeed(log.seed, seat, input.ball), d, over.field), d);
      if (auto.ok && canonicalJson(auto.input) === canonicalJson(input)) out[i].push(input.ball);
    }
  }
  return out;
}
