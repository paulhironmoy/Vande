/** Queue message shapes. Spoiler-free by construction: ids and kinds only, never a plan, a result or an exact time. */
import type { PlayerRef } from '@/contracts';

export type NotifyKind =
  | 'opponent_joined'
  | 'opponent_locked'
  | 'reveal_ready'
  | 'auto_over'
  | 'match_expired'
  | 'rematch'
  | 'deadline_reminder'
  | 'new_fixture'
  | 'final'
  | 'cup_complete'
  | 'cup_cancelled'
  /** Made the Daily Top 100: review the highlight and decide on consent (48 h). */
  | 'top100'
  /** A highlight the player consented to is live on the official channel. */
  | 'highlight_published';

/** Important notifications survive quiet hours (they wait) and a room set to "important"; routine ones do not. */
export const IMPORTANT_KINDS: ReadonlySet<NotifyKind> = new Set(['reveal_ready', 'deadline_reminder', 'final', 'cup_complete', 'cup_cancelled', 'top100']);

export interface NotifyMessage {
  v: 1;
  kind: NotifyKind;
  /** Internal account id of the recipient (resolved to device tokens by the consumer). */
  uid: string;
  /** The match the notification opens ('' for cup-wide events). */
  matchId?: string;
  cupId?: string;
  /** The highlight job it opens (top100, highlight_published). */
  jobId?: string;
  /** Room whose mute / notify settings apply. */
  roomId?: string;
  /** Collapse key: the same event is never delivered twice to one device. */
  dedupe: string;
  /** Set once a notification was held back for quiet hours (it is not held twice). */
  deferred?: boolean;
}

/** Highlight video work (vande-media): uploads, removals and privacy changes on the official channel. */
export interface MediaMessage {
  v: 1;
  kind: 'upload' | 'remove' | 'unlist';
  jobId: string;
}

export type MaintenanceMessage =
  | { v: 1; kind: 'forget_player'; uid: string; matchId: string }
  | { v: 1; kind: 'forget_cup_player'; uid: string; cupId: string }
  | { v: 1; kind: 'purge_export'; objectKey: string }
  /** A moderator's rename (admin/reports.ts), carried to each match and cup of the player (aliases only, no person). */
  | { v: 1; kind: 'rename_player'; uid: string; ref: PlayerRef; matchId: string }
  | { v: 1; kind: 'rename_cup_player'; uid: string; ref: PlayerRef; cupId: string };
