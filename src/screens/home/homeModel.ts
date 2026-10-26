/**
 * The hub's match list, built only from what the server shows a participant: phases, lock and innings flags and
 * public deadlines. Never an opponent's choices, never when they acted, never a sealed result.
 */
import type { DailyView, MatchView, PlayerRef } from '@/contracts';

export type MatchStatus = 'invite' | 'lock' | 'sealed_waiting' | 'bat' | 'batted_waiting' | 'reveal_at' | 'reveal_ready' | 'rematch_offer' | 'replay' | 'expired';
export type CardTone = 'action' | 'waiting' | 'ready' | 'done' | 'expired';

export interface MatchCardModel {
  matchId: string;
  kind: MatchView['kind'];
  me: PlayerRef;
  opponent: PlayerRef | null;
  status: MatchStatus;
  tone: CardTone;
  /** Public deadline shown on the card (ISO) and what it is for. */
  deadline: { at: string; kind: 'lock' | 'bat' | 'reveal' } | null;
  stage: 'group' | 'final' | null;
  /** The opponent's rematch offer, accepted through the invite flow at this link. */
  rematchUrl?: string;
}

const PRIORITY: Record<MatchStatus, number> = { reveal_ready: 0, rematch_offer: 1, lock: 2, bat: 3, invite: 4, sealed_waiting: 5, batted_waiting: 6, reveal_at: 7, replay: 8, expired: 9 };

export function matchCard(v: MatchView, watched: boolean): MatchCardModel {
  const opp = (1 - v.me) as 0 | 1;
  const base = { matchId: v.matchId, kind: v.kind, me: v.players[v.me] as PlayerRef, opponent: v.players[opp], stage: v.cup?.stage ?? null };
  switch (v.phase) {
    case 'awaiting_opponent':
      return { ...base, status: 'invite', tone: 'waiting', deadline: v.locked[v.me] ? null : { at: v.deadlines.lockBy, kind: 'lock' } };
    case 'planning':
      return v.locked[v.me]
        ? { ...base, status: 'sealed_waiting', tone: 'waiting', deadline: null }
        : { ...base, status: 'lock', tone: 'action', deadline: { at: v.deadlines.lockBy, kind: 'lock' } };
    case 'batting':
      return { ...base, status: 'bat', tone: 'action', deadline: { at: v.deadlines.batBy, kind: 'bat' } };
    case 'awaiting_reveal':
      if (v.battingDone[opp] && v.deadlines.revealAt) return { ...base, status: 'reveal_at', tone: 'waiting', deadline: { at: v.deadlines.revealAt, kind: 'reveal' } };
      return { ...base, status: 'batted_waiting', tone: 'waiting', deadline: { at: v.deadlines.batBy, kind: 'bat' } };
    case 'revealed':
      // Unwatched, the reveal comes first; after that, the opponent's rematch offer is the next thing to do.
      if (watched && v.rematch && !v.rematch.fromMe) return { ...base, status: 'rematch_offer', tone: 'action', deadline: null, rematchUrl: v.rematch.inviteUrl };
      return { ...base, status: watched ? 'replay' : 'reveal_ready', tone: watched ? 'done' : 'ready', deadline: null };
    default:
      return { ...base, status: 'expired', tone: 'expired', deadline: null };
  }
}

/** Actionable first (a reveal to watch, an over to lock, an innings to bat), then waiting, then finished. */
export function sortCards(cards: MatchCardModel[]): MatchCardModel[] {
  return cards
    .map((c, i) => ({ c, i }))
    .sort((a, b) => PRIORITY[a.c.status] - PRIORITY[b.c.status] || a.i - b.i)
    .map((x) => x.c);
}

export interface DailyCardModel {
  attemptsLeft: number;
  attemptsMax: number;
  best: number | null;
  streak: number;
  resetsAt: string;
  canPlay: boolean;
}

export function dailyCard(d: DailyView): DailyCardModel {
  const left = Math.max(0, d.attemptsMax - d.attemptsUsed);
  return { attemptsLeft: left, attemptsMax: d.attemptsMax, best: d.bestScore, streak: d.streak, resetsAt: d.resetsAt, canPlay: left > 0 };
}

// ---- reveals this device has watched (so the hub says "watch it" only until you have) ------------------------
const WATCHED_KEY = 'vc:watched';

export function watchedSet(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(WATCHED_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

export function markWatched(matchId: string): void {
  try {
    const list = [...watchedSet()].filter((x) => x !== matchId);
    list.push(matchId);
    localStorage.setItem(WATCHED_KEY, JSON.stringify(list.slice(-200)));
  } catch {
    /* storage unavailable */
  }
}
