import { useEffect, useState } from 'react';
import { Icon } from '@/components/ui';
import { fetchLiteGoal, utcDay, verifiedDaresEnabled, type LiteGoalResponse } from '@/community/liteDares';
import s from './LiteGoal.module.css';

export interface LiteGoalProps {
  /** The player opted in to community sharing (`settings.communitySharing === 'on'`). */
  optedIn: boolean;
  /** UTC day `YYYY-MM-DD`; defaults to today. */
  day?: string;
  className?: string;
}

/**
 * The shared goal for everyone: "Today X% of dare answers found the best move". Real numbers only: it renders
 * nothing unless verified dares are on, the player opted in, and the server reports at least the minimum cohort.
 * It fetches in the background and never blocks or delays play.
 */
export function LiteGoal({ optedIn, day, className }: LiteGoalProps) {
  const enabled = verifiedDaresEnabled(optedIn);
  const [goal, setGoal] = useState<LiteGoalResponse | null>(null);
  const target = day ?? utcDay();

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    void fetchLiteGoal(target, optedIn).then((g) => {
      if (!cancelled) setGoal(g);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, optedIn, target]);

  if (!enabled || !goal || !goal.ready || goal.share === undefined || goal.day !== target) return null;
  const pct = Math.round(goal.share);
  return (
    <p className={[s.goal, className].filter(Boolean).join(' ')} data-testid="lite-goal">
      <Icon name="users" size={16} />
      <span>
        Today <strong>{pct}%</strong> of dare answers found the best move
      </span>
    </p>
  );
}
