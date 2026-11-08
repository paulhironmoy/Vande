/**
 * What the chase keeps on the device, as plain data: the last finished result for each (seed, difficulty), and the
 * chase being batted (so a leave or a kill can resume it). Pure functions over JSON-safe shapes; the storage itself
 * (the keys, the writes) belongs to the Practice store. Nothing here ranks results, keeps totals or leaves the device.
 */
import type { AssistLevel } from '@/contracts/practice';
import {
  CHASE_BALLS,
  CHASE_BALLS_PER_OVER,
  CHASE_DIFFICULTIES,
  CHASE_HISTORY_MAX,
  CHASE_MAX_TARGET,
  CHASE_VERSION,
  type ChaseDifficulty,
  type ChaseHistory,
  type ChaseHistoryEntry,
  type ChaseSummary,
  type SavedChase,
} from './types';
import { chaseDefinitionError } from './rules';

const ASSISTS: readonly AssistLevel[] = ['learn', 'play', 'real'];
const DECIDED = ['won', 'lost_wicket', 'lost_balls'] as const;
const DISMISSALS = ['bowled', 'caught', 'caught_behind', 'lbw'];
const RUNS = [0, 1, 2, 3, 4, 6];

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isInt = (x: unknown, lo: number, hi: number): x is number =>
  typeof x === 'number' && Number.isInteger(x) && x >= lo && x <= hi;

/** Whether a value is a well-formed, self-consistent chase summary. */
export function isChaseSummary(x: unknown): x is ChaseSummary {
  if (!isObj(x) || x.v !== CHASE_VERSION) return false;
  if (typeof x.seed !== 'string' || x.seed.length === 0 || x.seed.length > 64) return false;
  if (!CHASE_DIFFICULTIES.includes(x.difficulty as ChaseDifficulty)) return false;
  if (!isInt(x.target, 1, CHASE_MAX_TARGET)) return false;
  if (!DECIDED.includes(x.result as (typeof DECIDED)[number])) return false;
  if (!isInt(x.runs, 0, CHASE_MAX_TARGET + 6) || !isInt(x.ballsFaced, 1, CHASE_BALLS)) return false;
  if (!isInt(x.ballsLeft, 0, CHASE_BALLS - 1) || x.ballsLeft !== CHASE_BALLS - x.ballsFaced) return false;
  if (!ASSISTS.includes(x.assist as AssistLevel)) return false;
  const won = x.result === 'won';
  if (won ? x.runs < x.target : x.runs >= x.target) return false;
  if (x.runsShort !== (won ? 0 : x.target - x.runs)) return false;
  const d = x.decidingBall;
  if (!isObj(d)) return false;
  if (!isInt(d.overIndex, 0, 1) || !isInt(d.ballIndex, 0, CHASE_BALLS_PER_OVER - 1)) return false;
  if (d.ballNumber !== x.ballsFaced || d.ballNumber !== d.overIndex * CHASE_BALLS_PER_OVER + d.ballIndex + 1)
    return false;
  if (d.key !== `${d.overIndex}:${d.ballIndex}` || !RUNS.includes(d.runs as number)) return false;
  if (x.result === 'lost_wicket' ? !DISMISSALS.includes(d.dismissal as string) || d.runs !== 0 : d.dismissal !== null)
    return false;
  if (x.result === 'lost_balls' && x.ballsFaced !== CHASE_BALLS) return false;
  return true;
}

export const emptyChaseHistory = (): ChaseHistory => ({ v: CHASE_VERSION, entries: [] });

/** The history with this result as the newest entry; an older result for the same seed and difficulty is replaced. */
export function recordChaseResult(history: ChaseHistory, summary: ChaseSummary, finishedAtMs: number): ChaseHistory {
  const entry: ChaseHistoryEntry = {
    ...summary,
    finishedAtMs: Number.isFinite(finishedAtMs) ? Math.max(0, finishedAtMs) : 0,
  };
  const rest = history.entries.filter((e) => !(e.seed === summary.seed && e.difficulty === summary.difficulty));
  return { v: CHASE_VERSION, entries: [entry, ...rest].slice(0, CHASE_HISTORY_MAX) };
}

/** The last finished result of this chase, or null. */
export function lastChaseResult(
  history: ChaseHistory,
  seed: string,
  difficulty: ChaseDifficulty,
): ChaseHistoryEntry | null {
  return history.entries.find((e) => e.seed === seed && e.difficulty === difficulty) ?? null;
}

/** Whatever was read back from storage, as a history: damaged entries are dropped, another version starts empty. */
export function parseChaseHistory(raw: unknown): ChaseHistory {
  if (!isObj(raw) || raw.v !== CHASE_VERSION || !Array.isArray(raw.entries)) return emptyChaseHistory();
  let out = emptyChaseHistory();
  // Oldest first, so recording each leaves the stored order (newest first) and keeps one entry per chase.
  for (const e of [...raw.entries].reverse()) {
    if (isChaseSummary(e) && typeof (e as { finishedAtMs?: unknown }).finishedAtMs === 'number') {
      out = recordChaseResult(out, e, (e as ChaseHistoryEntry).finishedAtMs);
    }
  }
  return out;
}

/** Whether a value has the shape of a saved chase (`resumeChase` then checks the innings itself ball by ball). */
export function isSavedChase(x: unknown): x is SavedChase {
  return isObj(x) && x.v === CHASE_VERSION && chaseDefinitionError(x.definition) === null && isObj(x.innings);
}
