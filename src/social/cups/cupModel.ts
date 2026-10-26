/**
 * Pure helpers over a CupView: rounds with their public deadlines, the current phase, the honest lock count, my next
 * task and fixtures, and the cup's state for the screen. Never anything about who locked or when.
 */
import type { CupView, Fixture, PlayerRef, StandingRow } from '@/contracts';

export const MIN_CUP_PLAYERS = 3;
export const MAX_CUP_PLAYERS = 10;
export type CupPace = 'sprint' | 'daily' | 'weekend';
export const PACES: readonly CupPace[] = ['sprint', 'daily', 'weekend'];

/** Public pace rules (backend/src/cup/schedule.ts): gathering, lock and bat windows in hours. */
export const PACE_RULES: Record<CupPace, { gatherHours: number; lockHours: number; batHours: number }> = {
  sprint: { gatherHours: 1, lockHours: 1, batHours: 1 },
  daily: { gatherHours: 12, lockHours: 12, batHours: 12 },
  weekend: { gatherHours: 24, lockHours: 6, batHours: 6 },
};

export type Phase = 'locking' | 'batting' | 'revealing' | 'revealed';

export interface RoundModel {
  round: number | 'final';
  lockBy: string;
  batBy: string;
  revealAt: string;
  fixtures: Fixture[];
  phase: Phase;
}

export function phaseAt(times: { lockBy: string; batBy: string; revealAt: string }, now: number): Phase {
  if (now < Date.parse(times.lockBy)) return 'locking';
  if (now < Date.parse(times.batBy)) return 'batting';
  if (now < Date.parse(times.revealAt)) return 'revealing';
  return 'revealed';
}

export function roundsOf(cup: CupView, now: number): RoundModel[] {
  const rounds: RoundModel[] = cup.schedule.rounds.map((r) => ({ ...r, fixtures: cup.fixtures.filter((f) => f.round === r.round), phase: phaseAt(r, now) }));
  if (cup.schedule.final) rounds.push({ round: 'final', ...cup.schedule.final, fixtures: cup.fixtures.filter((f) => f.round === 'final'), phase: phaseAt(cup.schedule.final, now) });
  return rounds;
}

const OPEN: ReadonlySet<Fixture['status']> = new Set(['planning', 'batting', 'awaiting_reveal']);

/**
 * The round being played now. The server decides: the round whose fixtures it has opened and not yet revealed. Only
 * when no round is open does the device clock pick the next one, so a phone whose clock is off by hours still shows
 * the round the cup is really in (the clock only drives the countdowns).
 */
export function currentRound(rounds: RoundModel[]): RoundModel | null {
  return rounds.find((r) => r.fixtures.some((f) => OPEN.has(f.status))) ?? rounds.find((r) => r.phase !== 'revealed' && r.fixtures.some((f) => f.status !== 'revealed' && f.status !== 'void')) ?? null;
}

export function membersById(cup: CupView): Map<string, PlayerRef> {
  return new Map(cup.members.map((m) => [m.id, m]));
}

export function myFixtures(cup: CupView, myId: string | null): Fixture[] {
  if (!myId) return [];
  return cup.fixtures.filter((f) => f.home === myId || f.away === myId);
}

/** My side of a fixture (0 home, 1 away) or null when I do not play it. */
export function mySeat(f: Fixture, myId: string | null): 0 | 1 | null {
  if (!myId) return null;
  if (f.home === myId) return 0;
  if (f.away === myId) return 1;
  return null;
}

/** A fixture I did not play myself: my side was an Auto Over or Auto XI (missed deadline). */
export function playedByAuto(f: Fixture, myId: string | null): boolean {
  const seat = mySeat(f, myId);
  return seat !== null && f.status === 'revealed' && f.auto[seat];
}

export type CupState = 'gathering' | 'gathering_short' | 'group_stage' | 'final' | 'complete' | 'cancelled';

export function cupState(cup: CupView): CupState {
  if (cup.status === 'gathering') return cup.members.length < MIN_CUP_PLAYERS ? 'gathering_short' : 'gathering';
  return cup.status;
}

/** When a gathering cup starts: the first round's lock window opens then (the invite expires at the same time). */
export function startsAt(cup: CupView): string | null {
  const first = cup.schedule.rounds[0];
  if (!first) return null;
  return first.lockBy;
}

export type Movement = 'up' | 'down' | 'same';
export function movementOf(row: StandingRow): Movement {
  return row.movement > 0 ? 'up' : row.movement < 0 ? 'down' : 'same';
}

/** Net run rate with an explicit sign (colour never carries meaning alone). */
export function nrrText(nrr: number, format: (n: number) => string): string {
  const v = Math.round(nrr * 1000) / 1000;
  return v > 0 ? `+${format(v)}` : v < 0 ? `−${format(Math.abs(v))}` : format(0);
}

export function finalFixture(cup: CupView): Fixture | null {
  return cup.fixtures.find((f) => f.round === 'final') ?? null;
}

const TASK_ORDER: Record<CupView['myTasks'][number]['kind'], number> = { lock: 0, bat: 1, watch: 2 };

/**
 * The task "my next fixture" shows: something with a deadline (lock, then bat) before watching a reveal, whatever order
 * the server lists them in (it lists the last round's reveal before the open round's lock).
 */
export function nextTask(tasks: CupView['myTasks']): CupView['myTasks'][number] | null {
  return tasks.slice().sort((x, y) => TASK_ORDER[x.kind] - TASK_ORDER[y.kind])[0] ?? null;
}
