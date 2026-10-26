/**
 * Internal protocol between the Worker and a match's Durable Object. The object is reachable only through the
 * MATCH namespace binding (never from the internet), so the Worker's assertion of who is calling (`uid`) is trusted
 * there; the object then checks that this uid holds a seat.
 */
import type { Conditions, PlayerRef } from '@/contracts';

export interface SeatInit {
  uid: string;
  ref: PlayerRef;
}

export interface CreateMatchOp {
  op: 'create';
  matchId: string;
  kind: 'duel';
  conditions: Conditions;
  creator: SeatInit;
  lockByMs: number;
  batByMs: number;
  /** Fixed reveal time (cups), or null: reveal as soon as both innings are done (duels). */
  revealAtMs: number | null;
  inviteExpMs: number;
  /** Only this account may accept (rematch invitations). */
  reservedFor: string | null;
  rematchOf: string | null;
  /** Highlight attribution code of a duel started from a highlight landing. */
  attribution?: string;
}

/** A Group Cup fixture: both seats known, created by the cup when its round opens. */
export interface CreateFixtureOp {
  op: 'create_fixture';
  matchId: string;
  cup: { cupId: string; fixtureId: string; stage: 'group' | 'final' };
  seats: [SeatInit, SeatInit];
  conditions: Conditions;
  lockByMs: number;
  batByMs: number;
  revealAtMs: number;
  roomId: string;
}

/** One Daily Six attempt: the player bats against the day's sealed over `attempt` (A, B or C). */
export interface CreateDailyOp {
  op: 'create_daily';
  matchId: string;
  day: string;
  attempt: 1 | 2 | 3;
  player: SeatInit;
  city: string | null;
  /** The next 00:00 IST: an attempt still open then is finished with leaves. */
  batByMs: number;
}

/** What a cup needs from a revealed fixture. */
export interface FixtureSummary {
  revealed: boolean;
  locked: [boolean, boolean];
  battingDone: [boolean, boolean];
  runs?: [number, number];
  wickets?: [number, number];
  winner?: 0 | 1 | null;
  decidedBy?: string;
  auto?: [boolean, boolean];
  late?: [number, number];
}

export type MatchOp =
  | CreateMatchOp
  | CreateFixtureOp
  | CreateDailyOp
  | { op: 'summary' }
  | { op: 'daily_result'; uid: string }
  | { op: 'preview'; nonce: string }
  | { op: 'accept'; nonce: string; actor: SeatInit; idem: string }
  | { op: 'view'; uid: string }
  | { op: 'lock'; uid: string; plan: unknown; unlocked: string[]; idem: string }
  | { op: 'next'; uid: string; idem: string }
  | { op: 'shot'; uid: string; input: unknown; ballToken: unknown; idem: string }
  | { op: 'reveal'; uid: string }
  | { op: 'rematch'; uid: string; ref: PlayerRef; idem: string }
  | { op: 'forget'; uid: string }
  /** A moderator renamed the player (admin/reports.ts): their seat in this match's views and its room. */
  | { op: 'rename'; uid: string; ref: PlayerRef };
