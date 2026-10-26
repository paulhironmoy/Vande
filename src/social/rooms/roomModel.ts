/**
 * Cricket Room cards: one spoiler-safe card per post kind, built from the server's closed payload keys
 * (backend/src/room/protocol.ts). A scorecard stays covered until the reader chooses to see it, so nobody who has not
 * watched the reveal is spoiled; nothing hints at who locked or when.
 */
import type { PlayerRef, ReactionId, RoomPost } from '@/contracts';
import { BANTER_IDS } from '@/contracts';

export const REACTIONS: readonly ReactionId[] = ['clap', 'fire', 'shock', 'laugh', 'cricket_bat', 'trophy'];
export const REACTION_EMOJI: Record<ReactionId, string> = { clap: '👏', fire: '🔥', shock: '😮', laugh: '😂', cricket_bat: '🏏', trophy: '🏆' };
export const BANTER = BANTER_IDS;

type P = RoomPost['payload'];
const DEADLINE_PHASES = ['lock', 'bat', 'auto_over', 'auto_xi'] as const;
const str = (p: P, k: string): string | null => (typeof p[k] === 'string' && (p[k] as string).length > 0 ? (p[k] as string) : null);
const num = (p: P, k: string): number | null => (typeof p[k] === 'number' && Number.isFinite(p[k] as number) ? (p[k] as number) : null);

export type CardModel =
  | { kind: 'invite'; inviterAlias: string; cupName: string | null; cup: boolean }
  | { kind: 'fixture'; round: string | null; final: boolean; fixtures: number | null; home: string | null; away: string | null; lockBy: string | null }
  | { kind: 'lock_status'; round: string | null; locked: number; total: number }
  | { kind: 'deadline'; round: string | null; phase: 'lock' | 'bat' | 'auto_over' | 'auto_xi'; by: string | null; alias: string | null }
  | { kind: 'reveal_ready'; round: string | null; matchId: string | null; final: boolean }
  | { kind: 'scorecard'; matchId: string | null; final: boolean; home: string; away: string; homeRuns: number; homeWickets: number; awayRuns: number; awayWickets: number; winner: string | null; tie: boolean }
  | { kind: 'standings'; round: string | null; leader: string | null; points: number | null; moves: number | null; status: string | null; reason: string | null }
  | { kind: 'achievement'; badge: string; alias: string }
  | { kind: 'highlight'; url: string | null; code: string | null; title: string | null }
  | { kind: 'rematch'; matchId: string | null; fromAlias: string; fromId: string | null; rematchOf: string | null }
  | { kind: 'banter'; phraseId: string; author: PlayerRef | null }
  | { kind: 'text'; text: string; author: PlayerRef | null }
  | { kind: 'unknown' };

export function cardOf(post: RoomPost, members: readonly PlayerRef[]): CardModel {
  const p = post.payload;
  const author = post.authorId ? members.find((m) => m.id === post.authorId) ?? null : null;
  switch (post.kind) {
    case 'invite':
      return { kind: 'invite', inviterAlias: str(p, 'inviterAlias') ?? '', cupName: str(p, 'cupName'), cup: str(p, 'kind') === 'cup' };
    case 'fixture':
      return { kind: 'fixture', round: str(p, 'round'), final: str(p, 'stage') === 'final', fixtures: num(p, 'fixtures'), home: str(p, 'homeAlias'), away: str(p, 'awayAlias'), lockBy: str(p, 'lockBy') };
    case 'lock_status':
      return { kind: 'lock_status', round: str(p, 'round'), locked: num(p, 'locked') ?? 0, total: num(p, 'total') ?? 0 };
    case 'deadline':
      return { kind: 'deadline', round: str(p, 'round'), phase: DEADLINE_PHASES.find((x) => x === str(p, 'phase')) ?? 'lock', by: str(p, 'by'), alias: str(p, 'alias') };
    case 'reveal_ready':
      return { kind: 'reveal_ready', round: str(p, 'round'), matchId: str(p, 'matchId'), final: str(p, 'stage') === 'final' };
    case 'scorecard':
      return {
        kind: 'scorecard',
        matchId: str(p, 'matchId'),
        final: str(p, 'stage') === 'final',
        home: str(p, 'homeAlias') ?? '',
        away: str(p, 'awayAlias') ?? '',
        homeRuns: num(p, 'homeRuns') ?? 0,
        homeWickets: num(p, 'homeWickets') ?? 0,
        awayRuns: num(p, 'awayRuns') ?? 0,
        awayWickets: num(p, 'awayWickets') ?? 0,
        winner: str(p, 'winnerAlias'),
        tie: p.tie === true,
      };
    case 'standings':
      return { kind: 'standings', round: str(p, 'round'), leader: str(p, 'leaderAlias'), points: num(p, 'leaderPoints'), moves: num(p, 'moves'), status: str(p, 'status'), reason: str(p, 'reason') };
    case 'achievement':
      return { kind: 'achievement', badge: str(p, 'badge') ?? '', alias: str(p, 'alias') ?? '' };
    case 'highlight':
      return { kind: 'highlight', url: str(p, 'url'), code: codeFromUrl(str(p, 'url')) ?? str(p, 'code'), title: str(p, 'title') };
    case 'rematch':
      return { kind: 'rematch', matchId: str(p, 'matchId'), fromAlias: str(p, 'fromAlias') ?? '', fromId: str(p, 'fromId'), rematchOf: str(p, 'rematchOf') };
    case 'banter':
      return { kind: 'banter', phraseId: str(p, 'phraseId') ?? '', author };
    case 'text':
      return { kind: 'text', text: str(p, 'text') ?? '', author };
    default:
      return { kind: 'unknown' };
  }
}

/** The highlight code inside a landing URL (…/h/<code>), so the room can open it in the app. */
export function codeFromUrl(url: string | null): string | null {
  if (!url) return null;
  const m = /\/h\/([a-z0-9]{4,16})(?:[/?#]|$)/.exec(url);
  return m ? m[1] : null;
}

/** Reactions after the reader changed theirs (optimistic; the server is the authority on the next load). */
export function withReaction(post: RoomPost, next: ReactionId | null): RoomPost {
  const counts = { ...post.reactions };
  if (post.myReaction) counts[post.myReaction] = Math.max(0, (counts[post.myReaction] ?? 1) - 1);
  if (next) counts[next] = (counts[next] ?? 0) + 1;
  for (const k of Object.keys(counts) as ReactionId[]) if (!counts[k]) delete counts[k];
  return { ...post, reactions: counts, myReaction: next };
}

/** Members a post can be reported or blocked for: the author of member posts only (system cards have none). */
export function reportable(post: RoomPost, myId: string | null): boolean {
  return (post.kind === 'banter' || post.kind === 'text') && Boolean(post.authorId) && post.authorId !== myId;
}

/**
 * Where a rematch card leads: the asker opens the new duel (they created it); the opponent opens the duel this room
 * belongs to, where the offer is answered through its invitation (they have no seat in the new duel until they accept).
 */
export function rematchTarget(c: Extract<CardModel, { kind: 'rematch' }>, myId: string | null): string | null {
  if (c.fromId && myId && c.fromId === myId) return c.matchId;
  return c.rematchOf ?? c.matchId;
}
