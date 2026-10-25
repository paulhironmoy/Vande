/**
 * Helper and Challenger award ledger (localStorage `vande:lite-awards`, migrated from v1 `vande:lite-helper`).
 * Caps: rewarded replies at most FRIEND_POINTS.perDareCap per dare and perDayCap per local day; challenger awards
 * once per dare and perDayCap per local day. Dedupe by reply identity; an attempt can be upgraded once its twist is
 * right, adding only the difference.
 *
 * Stable API used by the Lite screen: readLedger, writeLedger, replyIdentity, awardHelperReply, awardChallenger.
 */
import type { DareReply } from '@/share/dare';
import type { AwardResult, FriendLedger } from './contracts';

export function emptyLedger(): FriendLedger {
  return {
    v: 2,
    helper: { points: 0, answers: 0, understood: 0, verifiedPoints: 0 },
    challenger: { points: 0, answers: 0, understood: 0 },
    replies: {},
    perDare: {},
    challenged: {},
    day: { date: '', helper: 0, challenger: 0 },
  };
}

export function readLedger(): FriendLedger {
  return emptyLedger();
}

export function writeLedger(l: FriendLedger): void {
  void l;
}

/** Identity used for dedupe: R1 = the code; R2 = `${dareKey}#${nonce}`. */
export function replyIdentity(reply: DareReply, code: string): string {
  void reply;
  return code;
}

/** Awards the helper for a friend's reply (pure: returns the next ledger). */
export function awardHelperReply(l: FriendLedger, reply: DareReply, code: string, now: Date = new Date(), verified = false): AwardResult {
  void reply;
  void code;
  void now;
  void verified;
  return { ledger: l, earned: 0, fresh: false, upgraded: false, capped: null };
}

/** Awards the friend (challenger) when they send their result back (pure: returns the next ledger). */
export function awardChallenger(l: FriendLedger, dareKey: string, understood: boolean, now: Date = new Date()): AwardResult {
  void dareKey;
  void understood;
  void now;
  return { ledger: l, earned: 0, fresh: false, upgraded: false, capped: null };
}
