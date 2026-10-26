/**
 * When a match screen looks for news. The server never says when the opponent acted: their lock and finished-innings
 * flags can appear minutes after the fact, so the screen polls gently and never asks the player to wait or refresh.
 * A duel whose innings are both in reveals at a shared slot (`deadlines.revealAt`, a public time for both players);
 * the screen fetches again at that moment and rolls into the reveal.
 */
import type { MatchView } from '@/contracts';

/** Fetch this long after the slot: device clocks drift a little from the server's. */
export const REVEAL_GRACE_MS = 1000;
const POLL_MS = 20_000;
/** After the slot, until the server has the reveal (an alarm can be a little late). */
const AFTER_SLOT_POLL_MS = 5_000;

/** A duel's shared reveal moment, known once this player may know both innings are in (cups reveal at fixed times). */
export function revealSlot(v: MatchView | null): string | null {
  return v && v.phase === 'awaiting_reveal' && v.kind === 'duel' ? v.deadlines.revealAt : null;
}

/** How often to look for news (ms), or null when nothing can change without the player. */
export function pollFor(v: MatchView | null, now: number): number | null {
  if (!v) return null;
  if (v.phase === 'awaiting_reveal' && v.deadlines.revealAt) {
    const at = Date.parse(v.deadlines.revealAt);
    if (Number.isFinite(at) && now >= at) return AFTER_SLOT_POLL_MS;
    // A duel's slot is fixed: nothing changes before it. A cup still shows whether the opponent has batted.
    return v.kind === 'duel' ? null : POLL_MS;
  }
  if (v.phase === 'awaiting_opponent' || v.phase === 'awaiting_reveal') return POLL_MS;
  if (v.phase === 'planning' && v.locked[v.me]) return POLL_MS;
  return null;
}

/** Milliseconds until the screen should fetch again so the reveal rolls in at its moment, or null. */
export function refetchIn(v: MatchView | null, now: number): number | null {
  if (!v || v.phase !== 'awaiting_reveal' || !v.deadlines.revealAt) return null;
  const at = Date.parse(v.deadlines.revealAt);
  if (!Number.isFinite(at)) return null;
  return Math.max(0, at - now) + REVEAL_GRACE_MS;
}
