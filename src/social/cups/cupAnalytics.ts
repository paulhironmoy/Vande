/**
 * Cup milestones for analytics, once per cup on this device: `tournament_joined` the first time the player sees a cup
 * they are a member of (the creator included), `tournament_completed` when that cup is complete (`stage` final when
 * they played in the final, else group). Only the mode and the stage are sent; nothing about the cup or the players.
 * Without consent nothing is sent or marked, so a milestone is sent later if the player opts in.
 */
import { useEffect } from 'react';
import type { AnalyticsEventName, AnalyticsProps, CupView } from '@/contracts';

const KEY = 'vc:cup-events';
const KEEP = 100;

interface Seen {
  joined: string[];
  completed: string[];
}

function read(storage: Pick<Storage, 'getItem'> | null): Seen {
  try {
    const v = JSON.parse(storage?.getItem(KEY) ?? 'null') as Partial<Seen> | null;
    return { joined: Array.isArray(v?.joined) ? v.joined : [], completed: Array.isArray(v?.completed) ? v.completed : [] };
  } catch {
    return { joined: [], completed: [] };
  }
}

function write(storage: Pick<Storage, 'setItem'> | null, seen: Seen): void {
  try {
    storage?.setItem(KEY, JSON.stringify({ joined: seen.joined.slice(-KEEP), completed: seen.completed.slice(-KEEP) }));
  } catch {
    /* storage unavailable: a milestone may be sent again on another visit */
  }
}

function defaultStorage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

/** The milestones of this view not yet sent from this device (and marks them as sent). */
export function cupMilestones(view: CupView | null, myId: string | null, storage: (Pick<Storage, 'getItem' | 'setItem'>) | null = defaultStorage()): Array<{ event: AnalyticsEventName; props: AnalyticsProps }> {
  if (!view || !myId || !view.members.some((m) => m.id === myId)) return [];
  const seen = read(storage);
  const out: Array<{ event: AnalyticsEventName; props: AnalyticsProps }> = [];
  if (!seen.joined.includes(view.cupId)) {
    out.push({ event: 'tournament_joined', props: { mode: 'cup' } });
    seen.joined.push(view.cupId);
  }
  if (view.status === 'complete' && !seen.completed.includes(view.cupId)) {
    const inFinal = view.fixtures.some((f) => f.round === 'final' && (f.home === myId || f.away === myId));
    out.push({ event: 'tournament_completed', props: { mode: 'cup', stage: inFinal ? 'final' : 'group' } });
    seen.completed.push(view.cupId);
  }
  if (out.length > 0) write(storage, seen);
  return out;
}

export function useCupMilestones(view: CupView | null, myId: string | null, analytics: { track(event: AnalyticsEventName, props?: AnalyticsProps): void; active?: () => boolean } | null): void {
  const cupId = view?.cupId;
  const status = view?.status;
  useEffect(() => {
    // Not sending now (no consent, Do Not Track, not configured): nothing is marked, so it can be sent later.
    if (!analytics || (typeof analytics.active === 'function' && !analytics.active())) return;
    for (const m of cupMilestones(view, myId)) analytics.track(m.event, m.props);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cupId, status, myId, analytics]);
}
