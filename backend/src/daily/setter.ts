/** The Daily Six setter: players[1] of every daily replay (engine.buildDailyLog). */
import type { PlayerRef } from '@/contracts';

/** The Daily Six "bowler": a fixed, original stand-in (kind 'daily'), never a real player. */
export const DAILY_SETTER: PlayerRef = {
  id: 'p-daily-six',
  alias: 'Daily Six',
  avatar: { seed: 'dailysix' },
  kit: { id: 'starter', primary: '#1E2A78', secondary: '#FFB020', pattern: 'chevron' },
  kind: 'daily',
};
