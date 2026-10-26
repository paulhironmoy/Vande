/** Persisted state of one match (Durable Object storage) and the per-player view built from it. */
import type { BattingInput, Conditions, InningsState, MatchPhase, MatchView, PlayerRef, RevealedDelivery, ShotResponse } from '@/contracts';
import { inviteUrl } from '@/net/shared/ids';
import { minuteIso } from '../http/http';

/** The match as a whole; the per-viewer phase is derived (batting vs awaiting_reveal). */
export type GlobalPhase = 'open' | 'planning' | 'batting' | 'revealed' | 'expired';

export interface MatchMeta {
  v: 1;
  matchId: string;
  /** duel: invite between friends; cup: a fixture created by its cup; daily: one Daily Six attempt (solo innings). */
  kind: 'duel' | 'cup' | 'daily';
  /** Engine version the match is played and revealed with. */
  engine: number;
  createdMs: number;
  conditions: Conditions;
  lockByMs: number;
  batByMs: number;
  revealAtMs: number | null;
  inviteNonce: string;
  inviteExpMs: number;
  /** The signed invite token (what an older /i/ link carries; the code below stands for it). */
  inviteToken: string;
  /** The short code of the invite link (https://<web>/i/<code>, match/inviteCodes.ts); absent on older records. */
  inviteCode?: string | null;
  reservedFor: string | null;
  rematchOf: string | null;
  /**
   * The rematch offered after this duel: who asked (`by`, the seat) and until when it can be accepted (`expMs`, its
   * lock deadline). Older records lack both: treated as asked by nobody in particular and never expiring.
   * `inviteToken` is what the new match's link carries: its short code (or the signed token of an older record).
   */
  rematch: { matchId: string; inviteToken: string; by?: 0 | 1; expMs?: number } | null;
  phase: GlobalPhase;
  /** Moves forward on every change other players can see; guards the D1 match list against stale writes. */
  rev: number;
  /** SHA-256 of the seed, fixed at creation, before any plan exists (published in the replay with the seed). */
  seedCommit: string;
  revealedMs: number | null;
  syncPending: boolean;
  cup?: { cupId: string; fixtureId: string; stage: 'group' | 'final' };
  /** The Cricket Room this match posts to (its own for duels, the cup's for fixtures, none for Daily Six). */
  roomId: string | null;
  /** A deadline reminder went to this seat (at most one per player per match). */
  reminded: [boolean, boolean];
  /** Result, friends and Daily Six rows were written to D1 after the reveal. */
  recorded: boolean;
  /** The revealed log was copied to R2 (logs/<matchId>.json.gz). */
  archived?: boolean;
  /** Highlight attribution code of a duel started from a highlight landing (credited when it completes). */
  attribution?: string;
  /** `counted` false: the attempt broke the integrity limit (MAX_IRREGULAR_BALLS) and never reaches the boards. */
  daily?: { day: string; attempt: 1 | 2 | 3; city: string | null; score: number | null; counted?: boolean };
  /**
   * Activity jitter: when each seat's lock and innings completion become visible to the other player, the cup and the
   * room (the moment it happened plus the same random 1–10 minutes as the "opponent locked" push; deadline events are
   * public at once). Missing entries are visible.
   */
  visibleAt?: { lock: [number | null, number | null]; done: [number | null, number | null] };
  /** The public flags last applied to the D1 match list, the cup and the room. */
  applied?: { lock: [boolean, boolean]; done: [boolean, boolean] };
  /** Short hash of the view last written to D1 for each seat: a player's row changes only when their view does. */
  synced?: [string | null, string | null];
  /** Room deadline posts already decided for this match (one per phase). */
  deadlinePosts?: { lock: boolean; bat: boolean };
  /**
   * Exact server times of each seat's lock and finished innings. Internal only: never in a view, a log, D1 or a push.
   * They decide what a player's own action completes (the second locker may bat at once; the second finisher sees the
   * reveal countdown at once), never what anyone else learns.
   */
  lockedAt?: [number | null, number | null];
  doneAt?: [number | null, number | null];
}

/**
 * The reveal slot of a duel whose innings are both done: the next whole `slotMs` boundary (5 minutes by default) at
 * least 60 s away, so the moment the second innings ended is never the moment anyone learns the result. 0: at once.
 */
export function revealSlotAt(nowMs: number, slotMs: number): number {
  if (slotMs <= 0) return nowMs;
  return Math.ceil((nowMs + 60_000) / slotMs) * slotMs;
}

export interface Seat {
  /** Internal account id, or "x:…" once the player deleted their account. */
  uid: string;
  ref: PlayerRef;
}

export interface CommitState {
  hash: string;
  sig: string;
  keyId: string;
  lockedHour: string;
  auto: boolean;
}

export interface Outstanding {
  ball: number;
  /** Token id inside the signed ball token. */
  tid: string;
  /** Server time the delivery was revealed: the ball's clock starts here. */
  revealedMs: number;
  delivery: RevealedDelivery;
  token: string;
  ballsLeft: number;
}

/** How a ball was settled: answered in time, a queued answer that arrived late, or never answered. */
export type AnswerHow = 'live' | 'late' | 'expired' | 'invalid' | 'auto' | 'deadline';

export interface AnsweredBall {
  tid: string | null;
  how: AnswerHow;
  response: ShotResponse;
}

export interface InningsRecord {
  state: InningsState | null;
  /** Validated inputs in play order, one per resolved ball (the Super Ball last); null = never answered (a leave). */
  inputs: Array<BattingInput | null>;
  /** By ball index: what happened to it, for idempotent duplicate shots. */
  answered: Record<string, AnsweredBall>;
  outstanding: Outstanding | null;
  /** Invalid answers on the outstanding ball. */
  invalid: number;
  /** Answers accepted inside the late window (queued offline); an integrity signal for the Top 100. */
  late?: number;
  /**
   * Balls the batter was shown that settled as leaves without a valid answer in time (expired, invalid, or waiting at
   * the batting deadline). A safe dot, so not free: with `late` it makes the per-innings integrity count.
   */
  missed?: number;
  /** The engine's timing audit flagged machine-perfect tapping in this innings (flag only, never a block). */
  suspicious?: boolean;
  bullseyes?: number;
  /**
   * Idempotency records of this innings' batting requests, kept inside the record that is written anyway (one storage
   * row per ball instead of three): the latest `next` call's key and answer, and the keys of recent shots.
   */
  idem?: { next: { k: string; h: string; body: unknown } | null; shots: Array<{ k: string; h: string; ball: number }> };
}

export function emptyInnings(): InningsRecord {
  return { state: null, inputs: [], answered: {}, outstanding: null, invalid: 0, late: 0, missed: 0, idem: { next: null, shots: [] } };
}

/** The innings is over: all seven balls, or the six main balls of a Daily Six attempt (it has no Super Ball). */
export function inningsOver(kind: MatchMeta['kind'], state: InningsState | null | undefined): boolean {
  return state?.done === true || (kind === 'daily' && state?.mainDone === true);
}

/** Late answers plus missed balls: the per-innings integrity count (Top 100 `lateAnswers`, Daily Six boards). */
export function irregularBalls(rec: Pick<InningsRecord, 'late' | 'missed'>): number {
  return (rec.late ?? 0) + (rec.missed ?? 0);
}

export interface LoadedMatch {
  meta: MatchMeta;
  seats: [Seat, Seat | null];
  commits: [CommitState | null, CommitState | null];
  inn: [InningsRecord, InningsRecord];
}

/** Whether a seat's lock is visible to the other player and to third parties at `now` (always once the match is over). */
export function lockVisible(m: LoadedMatch, seat: 0 | 1, now: number): boolean {
  if (m.commits[seat] === null) return false;
  if (m.meta.phase === 'revealed' || m.meta.phase === 'expired') return true;
  return (m.meta.visibleAt?.lock[seat] ?? 0) <= now;
}

/** Whether a seat's finished innings is visible to the other player and to third parties at `now`. */
export function doneVisible(m: LoadedMatch, seat: 0 | 1, now: number): boolean {
  if (!inningsOver(m.meta.kind, m.inn[seat].state)) return false;
  if (m.meta.phase === 'revealed' || m.meta.phase === 'expired') return true;
  return (m.meta.visibleAt?.done[seat] ?? 0) <= now;
}

/** The lock and completion flags anyone but the seat itself may see (the opponent, the cup, the room). */
export function publicFlags(m: LoadedMatch, now: number): { lock: [boolean, boolean]; done: [boolean, boolean] } {
  return { lock: [lockVisible(m, 0, now), lockVisible(m, 1, now)], done: [doneVisible(m, 0, now), doneVisible(m, 1, now)] };
}

/**
 * What a player knows of the opponent's lock and finished innings: what is visible to them (after the activity
 * jitter), or what their own action completed. The second locker learns both overs are sealed the moment they lock,
 * and the second finisher that both innings are done the moment they finish; the first never learns earlier than
 * the jitter allows. Exact times stay inside the match object.
 */
export function opponentKnown(m: LoadedMatch, viewer: 0 | 1, now: number): { locked: boolean; done: boolean } {
  const other = (1 - viewer) as 0 | 1;
  const after = (t: [number | null, number | null] | undefined) => {
    const mine = t?.[viewer] ?? null;
    const theirs = t?.[other] ?? null;
    return mine !== null && theirs !== null && mine > theirs;
  };
  const locked = lockVisible(m, other, now) || (m.commits[viewer] !== null && m.commits[other] !== null && after(m.meta.lockedAt));
  const done = doneVisible(m, other, now) || (inningsOver(m.meta.kind, m.inn[viewer].state) && inningsOver(m.meta.kind, m.inn[other].state) && after(m.meta.doneAt));
  return { locked, done };
}

/**
 * The phase as one player sees it. Batting starts for a player once they know both overs are sealed: the opponent's
 * lock became visible to them, or their own lock completed the pair. The first locker waits for the jitter, so the
 * moment their phase changes never tells when the opponent locked.
 */
export function viewerPhase(m: LoadedMatch, seat: 0 | 1, now: number): MatchPhase {
  switch (m.meta.phase) {
    case 'open':
      return 'awaiting_opponent';
    case 'planning':
      return 'planning';
    case 'batting':
      if (!opponentKnown(m, seat, now).locked) return 'planning';
      return inningsOver(m.meta.kind, m.inn[seat].state) ? 'awaiting_reveal' : 'batting';
    case 'revealed':
      return 'revealed';
    default:
      return 'expired';
  }
}

/**
 * What one participant may see: lock and completion flags and commit hashes, never a plan, a time or a result. The
 * invitation link is an access link: only the duel's creator gets it, and only while nobody has joined (so any of
 * their devices can share it again); the opponent, a cup fixture or a Daily Six attempt never carries one.
 */
export function viewFor(m: LoadedMatch, seat: 0 | 1, webOrigin: string, now: number): MatchView {
  const other = (1 - seat) as 0 | 1;
  // The player's own flags are exact; the opponent's appear once visible (activity jitter, MatchMeta.visibleAt) or
  // once the player's own action completed them (opponentKnown).
  const known = opponentKnown(m, seat, now);
  const locked = (s: 0 | 1) => (s === seat ? m.commits[s] !== null : known.locked);
  const done = (s: 0 | 1) => (s === seat ? inningsOver(m.meta.kind, m.inn[s].state) : known.done);
  // A duel's reveal slot is set when both innings end: shown to a player who knows that (fixed cup times always are).
  const slotKnown = m.meta.kind !== 'duel' || m.meta.phase === 'revealed' || (inningsOver(m.meta.kind, m.inn[seat].state) && known.done);
  const view: MatchView = {
    matchId: m.meta.matchId,
    kind: m.meta.kind,
    phase: viewerPhase(m, seat, now),
    conditions: { pitch: m.meta.conditions.pitch, weather: m.meta.conditions.weather },
    me: seat,
    players: [m.seats[0].ref, m.seats[1]?.ref ?? null],
    locked: [locked(0), locked(1)],
    battingDone: [done(0), done(1)],
    seedCommit: m.meta.seedCommit,
    roomId: m.meta.roomId ?? null,
    inviteUrl: m.meta.kind === 'duel' && seat === 0 && m.meta.phase === 'open' && m.seats[1] === null ? inviteUrl(webOrigin, inviteLinkToken(m.meta), m.meta.attribution) : null,
    myCommit: m.commits[seat]?.hash ?? null,
    opponentCommit: known.locked ? (m.commits[other]?.hash ?? null) : null,
    deadlines: {
      lockBy: minuteIso(m.meta.lockByMs),
      batBy: minuteIso(m.meta.batByMs),
      revealAt: m.meta.revealAtMs === null || !slotKnown ? null : minuteIso(m.meta.revealAtMs),
    },
    myBallsFaced: Object.keys(m.inn[seat].answered).length,
    rematch: rematchOffer(m, seat, webOrigin, now),
  };
  if (m.meta.cup) view.cup = { ...m.meta.cup };
  return view;
}

/** What this match's invite link carries: the short code, or the signed token of a record made before codes. */
export function inviteLinkToken(meta: Pick<MatchMeta, 'inviteCode' | 'inviteToken'>): string {
  return meta.inviteCode || meta.inviteToken;
}

/**
 * The rematch offer as one participant sees it: the asker gets `fromMe` and their own invitation link to send again;
 * the opponent gets the same link, to accept through the invite flow (they have no seat in the new match until then).
 * Null for cup fixtures, before anyone asked and once the offer expired.
 */
export function rematchOffer(m: LoadedMatch, seat: 0 | 1, webOrigin: string, now: number): MatchView['rematch'] {
  const r = m.meta.rematch;
  if (m.meta.kind !== 'duel' || !r || (r.expMs !== undefined && now >= r.expMs)) return null;
  return { matchId: r.matchId, inviteUrl: inviteUrl(webOrigin, r.inviteToken), fromMe: r.by === seat };
}

export function seatOf(m: LoadedMatch, uid: string): 0 | 1 | null {
  if (m.seats[0].uid === uid) return 0;
  if (m.seats[1]?.uid === uid) return 1;
  return null;
}
