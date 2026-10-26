/** Group Cup rules that are pure functions: pace presets, round-robin fixtures, standings and net run rate. */
import type { CreateCupRequest, StandingRow } from '@/contracts';
import { HOUR_MS, MINUTE_MS } from '../config';

export type CupPace = CreateCupRequest['pace'];

/** Gathering time, then per round a lock window and a batting window; each round reveals when batting closes. */
export const PACES: Record<CupPace, { gatherMs: number; lockMs: number; batMs: number }> = {
  sprint: { gatherMs: 1 * HOUR_MS, lockMs: 1 * HOUR_MS, batMs: 1 * HOUR_MS },
  daily: { gatherMs: 12 * HOUR_MS, lockMs: 12 * HOUR_MS, batMs: 12 * HOUR_MS },
  weekend: { gatherMs: 24 * HOUR_MS, lockMs: 6 * HOUR_MS, batMs: 6 * HOUR_MS },
};

export const MIN_CUP_PLAYERS = 3;
export const MAX_CUP_PLAYERS = 10;

export function roundUpToMinute(ms: number): number {
  return Math.ceil(ms / MINUTE_MS) * MINUTE_MS;
}

/** Rounds for n players: n − 1 when n is even, n when odd (everyone sits out once). */
export function roundCount(n: number): number {
  return n % 2 === 0 ? n - 1 : n;
}

/**
 * Round-robin by the circle method: player 0 stays, the others rotate; an odd count adds a bye (nobody plays it).
 * Home and away alternate by round so seats are balanced. Returns [home, away] member indexes per round.
 */
export function roundRobin(n: number): Array<Array<[number, number]>> {
  const ids = Array.from({ length: n }, (_, i) => i);
  if (n % 2 === 1) ids.push(-1);
  const m = ids.length;
  const rounds: Array<Array<[number, number]>> = [];
  const home = new Array<number>(n).fill(0);
  for (let r = 0; r < m - 1; r++) {
    const pairs: Array<[number, number]> = [];
    for (let i = 0; i < m / 2; i++) {
      const a = ids[i];
      const b = ids[m - 1 - i];
      if (a === -1 || b === -1) continue;
      // Seat balance: the player with fewer home fixtures so far takes seat 0 (each ends within one of the others).
      const first = home[a] < home[b] || (home[a] === home[b] && (r + i) % 2 === 0) ? a : b;
      const second = first === a ? b : a;
      home[first]++;
      pairs.push([first, second]);
    }
    rounds.push(pairs);
    ids.splice(1, 0, ids.pop() as number);
  }
  return rounds;
}

export interface FixtureResult {
  home: number;
  away: number;
  runs: [number, number];
  winner: 0 | 1 | null;
}

export interface StandingCalc extends Omit<StandingRow, 'playerId' | 'alias' | 'movement'> {
  member: number;
  runsFor: number;
  runsAgainst: number;
}

/**
 * Win 2 points, tie 1, loss 0. Net run rate = runs scored per over − runs conceded per over; every innings is exactly
 * one over (dead balls keep it full length), so NRR = (runs for − runs against) / matches. Order: points, NRR, wins,
 * then the earlier joiner. Super Ball runs decide a match but never count in NRR.
 */
export function computeStandings(members: number, results: readonly FixtureResult[]): StandingCalc[] {
  const rows: StandingCalc[] = Array.from({ length: members }, (_, member) => ({ member, played: 0, won: 0, lost: 0, tied: 0, points: 0, netRunRate: 0, form: [], runsFor: 0, runsAgainst: 0 }));
  for (const r of results) {
    const h = rows[r.home];
    const a = rows[r.away];
    h.played++;
    a.played++;
    h.runsFor += r.runs[0];
    h.runsAgainst += r.runs[1];
    a.runsFor += r.runs[1];
    a.runsAgainst += r.runs[0];
    if (r.winner === null) {
      h.tied++;
      a.tied++;
      h.points += 1;
      a.points += 1;
      h.form.push('T');
      a.form.push('T');
    } else {
      const [w, l] = r.winner === 0 ? [h, a] : [a, h];
      w.won++;
      l.lost++;
      w.points += 2;
      w.form.push('W');
      l.form.push('L');
    }
  }
  for (const row of rows) {
    row.netRunRate = row.played ? Math.round(((row.runsFor - row.runsAgainst) / row.played) * 1000) / 1000 : 0;
    row.form = row.form.slice(-5);
  }
  return rows.sort((x, y) => y.points - x.points || y.netRunRate - x.netRunRate || y.won - x.won || x.member - y.member);
}
