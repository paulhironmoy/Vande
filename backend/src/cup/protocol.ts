/** Internal protocol of a Group Cup's Durable Object. */
import type { CreateCupRequest, PlayerRef } from '@/contracts';
import type { SeatInit } from '../match/protocol';

export type CupPace = CreateCupRequest['pace'];

export type CupOp =
  | { op: 'create'; cupId: string; name: string; pace: CupPace; maxPlayers: number; creator: SeatInit }
  | { op: 'preview'; nonce: string }
  | { op: 'accept'; nonce: string; actor: SeatInit; idem: string }
  | { op: 'view'; uid: string }
  /**
   * A fixture's progress: `locked` / `battingDone` are what other members may see (after the activity jitter); `exact`
   * is each player's own state, used only for that player's own tasks and fixture.
   */
  | {
      op: 'fixture_update';
      fixtureId: string;
      matchId: string;
      locked: [boolean, boolean];
      battingDone: [boolean, boolean];
      /** Per seat: its own state, and what it knows of its opponent (visible, or completed by its own action). */
      exact?: { locked: [boolean, boolean]; battingDone: [boolean, boolean]; oppLocked?: [boolean, boolean]; oppDone?: [boolean, boolean] };
      /** Seats whose over Auto Over sealed at the lock deadline: sealed, but never counted as a player's lock. */
      autoOver?: [boolean, boolean];
      /** Seats whose innings Auto XI batted (any ball) at the batting deadline. */
      autoXi?: [boolean, boolean];
      revealed: boolean;
    }
  | { op: 'forget'; uid: string }
  /** A moderator renamed the player (admin/reports.ts): their place in the table, the fixtures and the cup's room. */
  | { op: 'rename'; uid: string; ref: PlayerRef };
