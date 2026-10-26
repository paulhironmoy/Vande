/**
 * Training's short reveal: the two balls the player played themselves (the one they batted and the one they bowled),
 * then the result, instead of every Auto ball's highlight (Key Moments of a whole training match ran 43–61 s; this
 * runs about half a minute). The rest of the match is still on the scorecard and in Full replay.
 */
import type { MatchEventLog } from '@/contracts';
import { cutReplay, type ReplayBall } from '@/render3d/core/timeline';
import { autoBalls } from '../reveal/disclosure';

export function trainingCutBalls(log: MatchEventLog): Set<number> {
  const auto = autoBalls(log);
  const keep = new Set<number>();
  log.events.forEach((ev, e) => {
    if (ev.t === 'ball' && ev.innings !== 'super' && !auto.main[ev.innings][ev.ball]) keep.add(e);
  });
  return keep;
}

/** Applies the cut to every replay of this log (the reveal screen and the renderer play the same timeline). */
export function cutTrainingReplay(log: MatchEventLog): void {
  const keep = trainingCutBalls(log);
  // A log the player had no ball in (should not happen) keeps its normal Key Moments.
  if (keep.size > 0) cutReplay(log, (b: ReplayBall) => keep.has(b.eventIndex));
}
