/**
 * The rivalry record between two players: finished duels against the same opponent, from this player's own match list
 * and the revealed replays (public after the reveal). Results are remembered on the device, so each replay is fetched
 * at most once; a handful of the latest are looked up when missing. Never a sealed result: only revealed matches count.
 */
import { useEffect, useState } from 'react';
import type { MatchEventLog, MatchView } from '@/contracts';
import type { Net } from '@/net';

const RESULTS_KEY = 'vc:results';
const MAX_LOOKUPS = 5;

export type Outcome = 'won' | 'lost' | 'tied';
export interface Rivalry {
  played: number;
  won: number;
  lost: number;
  tied: number;
}

function read(): Record<string, Outcome> {
  try {
    return JSON.parse(localStorage.getItem(RESULTS_KEY) ?? '{}') as Record<string, Outcome>;
  } catch {
    return {};
  }
}

export function outcomeFor(log: MatchEventLog, me: 0 | 1): Outcome {
  const r = log.result;
  return r.tie || r.winner === null ? 'tied' : r.winner === me ? 'won' : 'lost';
}

/** Remembers a revealed result for this player (the reveal screen calls it once the replay has loaded). */
export function rememberResult(matchId: string, log: MatchEventLog, me: 0 | 1): void {
  try {
    const all = read();
    if (all[matchId]) return;
    all[matchId] = outcomeFor(log, me);
    const ids = Object.keys(all);
    // Keep the newest 300 results.
    for (const id of ids.slice(0, Math.max(0, ids.length - 300))) delete all[id];
    localStorage.setItem(RESULTS_KEY, JSON.stringify(all));
  } catch {
    /* storage unavailable */
  }
}

export function tally(matches: readonly MatchView[], results: Record<string, Outcome>, opponentId: string, exclude: string): Rivalry {
  const r: Rivalry = { played: 0, won: 0, lost: 0, tied: 0 };
  for (const v of matches) {
    if (v.matchId === exclude || v.phase !== 'revealed' || v.players[v.me === 0 ? 1 : 0]?.id !== opponentId) continue;
    const o = results[v.matchId];
    if (!o) continue;
    r.played += 1;
    r[o] += 1;
  }
  return r;
}

/** The record against `opponentId` (excluding the match on screen), or null until it is known. */
export function useRivalry(net: Net | null, opponentId: string | null, exclude: string): Rivalry | null {
  const [rivalry, setRivalry] = useState<Rivalry | null>(null);
  useEffect(() => {
    if (!net || !opponentId) return;
    let alive = true;
    void (async () => {
      try {
        const matches = await net.api.call('GET /v1/matches');
        const results = read();
        const missing = matches.filter((v) => v.matchId !== exclude && v.phase === 'revealed' && v.players[v.me === 0 ? 1 : 0]?.id === opponentId && !results[v.matchId]).slice(0, MAX_LOOKUPS);
        for (const v of missing) {
          try {
            const log = await net.api.call('GET /v1/matches/:id/reveal', { params: { id: v.matchId } });
            rememberResult(v.matchId, log, v.me);
          } catch {
            /* one replay that will not load does not hide the rest of the record */
          }
        }
        if (alive) setRivalry(tally(matches, read(), opponentId, exclude));
      } catch {
        /* offline: no record shown */
      }
    })();
    return () => {
      alive = false;
    };
  }, [net, opponentId, exclude]);
  return rivalry;
}
