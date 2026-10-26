/**
 * Unofficial practice after a deadline: once a match is revealed, the opponent's over is public in the replay, so the
 * app can let the player bat against it locally with the shared engine (offline, no server). It never changes a result
 * or standings: official play is closed by the server after the deadline (410 / 409).
 */
import type { Conditions, MatchEventLog, OverPlan, PlayerRef } from '@/contracts';

export function practiceAgainst(log: MatchEventLog, me: 0 | 1): { conditions: Conditions; plan: OverPlan; opponent: PlayerRef } {
  const other = me === 0 ? 1 : 0;
  return { conditions: log.conditions, plan: log.plans[other], opponent: log.players[other] };
}
