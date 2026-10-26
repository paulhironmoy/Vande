/**
 * Cricket Room: what may be posted, and the internal protocol between the Worker / match and cup objects and a room.
 * Payloads are spoiler-safe by construction: each kind has a closed set of keys with primitive values, and results
 * (scorecards, standings) are only ever posted by the match or cup object after the reveal.
 */
import type { BanterId, PlayerRef, ReactionId, RoomPostKind } from '@/contracts';
import { BANTER_IDS } from '@/contracts';

export const REACTIONS: readonly ReactionId[] = ['clap', 'fire', 'shock', 'laugh', 'cricket_bat', 'trophy'];

/** Keys allowed per post kind (anything else is dropped). */
export const PAYLOAD_KEYS: Record<RoomPostKind, readonly string[]> = {
  invite: ['kind', 'inviterAlias', 'cupName'],
  fixture: ['round', 'stage', 'fixtures', 'homeAlias', 'awayAlias', 'lockBy', 'batBy', 'revealAt'],
  lock_status: ['round', 'locked', 'total'],
  // phase 'lock' | 'bat' (a reminder), or 'auto_over' | 'auto_xi' with `alias`: Auto stepped in for that player.
  deadline: ['round', 'phase', 'by', 'alias'],
  reveal_ready: ['round', 'matchId', 'stage'],
  scorecard: ['matchId', 'round', 'stage', 'homeAlias', 'awayAlias', 'homeRuns', 'homeWickets', 'awayRuns', 'awayWickets', 'winnerAlias', 'tie', 'decidedBy'],
  standings: ['round', 'leaderAlias', 'leaderPoints', 'moves', 'status', 'reason'],
  achievement: ['badge', 'alias'],
  highlight: ['jobId', 'code', 'matchId', 'title', 'url'],
  // matchId: the new duel; rematchOf: the duel this room belongs to (where the opponent finds the offer); fromId: who asked.
  rematch: ['matchId', 'fromAlias', 'fromId', 'rematchOf'],
  banter: ['phraseId'],
  text: ['text'],
};

/** Kinds only the match / cup objects may post (members post banter, text when enabled, and reactions). */
export const SYSTEM_KINDS: ReadonlySet<RoomPostKind> = new Set(['invite', 'fixture', 'lock_status', 'deadline', 'reveal_ready', 'scorecard', 'standings', 'achievement', 'highlight', 'rematch']);

export function isBanterId(x: unknown): x is BanterId {
  return typeof x === 'string' && (BANTER_IDS as readonly string[]).includes(x);
}

export type Payload = Record<string, string | number | boolean | null>;

export function cleanPayload(kind: RoomPostKind, payload: Record<string, unknown>): Payload {
  const out: Payload = {};
  for (const k of Object.hasOwn(PAYLOAD_KEYS, kind) ? PAYLOAD_KEYS[kind] : []) {
    const v = payload[k];
    if (v === null || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) out[k] = v;
    else if (typeof v === 'string') out[k] = v.slice(0, 160);
  }
  return out;
}

export interface RoomSeat {
  uid: string;
  ref: PlayerRef;
}

/**
 * Which player a payload field names, as [payload key, public player id] pairs (never shown to clients): when that
 * player deletes their account, the room replaces the alias in that field with "Deleted player" (a highlight card,
 * whose title names both players, is taken down instead).
 */
export type PostRefs = Array<[string, string]>;

export type RoomOp =
  /** titleOwner: the player whose alias opens the title (duel rooms: "<alias> · Friend Duel"). */
  | { op: 'create'; roomId: string; kind: 'cup' | 'duel' | 'group'; title: string; members: RoomSeat[]; titleOwner?: string }
  | { op: 'add_member'; member: RoomSeat }
  | { op: 'post'; kind: RoomPostKind; payload: Record<string, unknown>; upsertKey?: string; refs?: PostRefs }
  /** Takes a system post down (a highlight whose video is gone). */
  | { op: 'unpost'; upsertKey: string }
  | { op: 'view'; uid: string; cursor: string | null; hidden: string[] }
  | { op: 'react'; uid: string; postId: string; reaction: ReactionId | null }
  | { op: 'banter'; uid: string; phraseId: BanterId }
  | { op: 'text'; uid: string; text: string }
  | { op: 'settings'; uid: string; muted?: boolean; notify?: 'all' | 'important' | 'none' }
  | { op: 'forget'; uid: string }
  /** A moderator renamed the player (admin/reports.ts): their member card and every post that names them. */
  | { op: 'rename'; uid: string; ref: PlayerRef }
  /** The admin console: one post as it stands (null once gone). */
  | { op: 'post_of'; seq: number }
  /** A moderator took a reported post down. */
  | { op: 'remove_post'; seq: number };
