/**
 * Profiles, groups, Group Cups, Cricket Rooms, Daily Six and leaderboards — ROOT-OWNED contracts.
 * Privacy rules baked into the types: no real names, no contacts, no public location, college/company groups are
 * private (visible to members only), and nothing here may carry a hidden plan, an exact time or a sealed result.
 */
import type { AvatarSpec, Conditions, KitSpec, PlayerRef } from './cricket';

export type LocaleId = 'en' | 'hi' | 'hi-Latn' | 'bn' | 'te' | 'mr' | 'ta' | 'gu' | 'kn' | 'ml' | 'pa';

export interface Profile {
  playerId: string;
  alias: string;
  avatar: AvatarSpec;
  kit: KitSpec;
  locale: LocaleId;
  /** Optional, coarse (city or region name from a fixed list); never GPS. */
  city: string | null;
  /** Private group memberships (college/company), joined by invite code. */
  groups: GroupMembership[];
  badges: BadgeId[];
  /** Achievement-based unlocks of delivery variants (never purchasable). */
  unlocks: string[];
  rating: number;
  createdDay: string;
  /** True once the player has confirmed they are 18+ (required to appear in published highlights). */
  adultConfirmed: boolean;
  linked: { google: boolean; passkey: boolean };
}

export type GroupKind = 'college' | 'company';
export interface GroupMembership {
  groupId: string;
  kind: GroupKind;
  /** Display name typed by the group's creator; shown only to members. */
  name: string;
}

export type BadgeId = 'youtube_top100' | 'first_win' | 'cup_winner' | 'daily_streak_7' | 'upset' | 'clean_bowled' | 'training_complete' | string;

// ---------------------------------------------------------------------------------------------------------------
// Matches as seen by a participant (never the opponent's plan, never a sealed result)
// ---------------------------------------------------------------------------------------------------------------

export type MatchPhase =
  | 'awaiting_opponent' // invite not yet accepted
  | 'planning' // one or both overs not locked
  | 'batting' // both locked; innings in progress
  | 'awaiting_reveal' // my innings done; waiting for the other or the reveal time
  | 'revealed'
  | 'expired'; // nobody joined before the deadline (no result)

export interface MatchView {
  matchId: string;
  kind: 'duel' | 'cup' | 'daily';
  phase: MatchPhase;
  conditions: Conditions;
  me: 0 | 1;
  players: [PlayerRef, PlayerRef | null];
  /** Lock status only — never what or when. */
  locked: [boolean, boolean];
  /** Innings completion status only. */
  battingDone: [boolean, boolean];
  /** SHA-256 commitment to the match seed, published at creation before any plan is locked. */
  seedCommit: string;
  /** The match's Cricket Room (duels and cup fixtures); null for Daily Six attempts. */
  roomId: string | null;
  /**
   * The invitation link, only for the duel's creator while `awaiting_opponent` (so any of their devices can share it
   * again); null for everyone else and in every other phase.
   */
  inviteUrl: string | null;
  /**
   * A rematch offered after the reveal (duels only): `fromMe` when I asked for it (`inviteUrl` lets me send it again),
   * otherwise my opponent's offer, which I accept through `inviteUrl` (the invite flow). Null when nobody asked yet.
   */
  rematch: { matchId: string; inviteUrl: string; fromMe: boolean } | null;
  /** My commit hash once locked (proof that the over is sealed). */
  myCommit: string | null;
  opponentCommit: string | null;
  /** revealAt is null for duels (they reveal as soon as both innings are done or the batting deadline passes). */
  deadlines: { lockBy: string; batBy: string; revealAt: string | null };
  /** Balls I have faced so far (resume point). */
  myBallsFaced: number;
  cup?: { cupId: string; fixtureId: string; stage: 'group' | 'final' };
}

// ---------------------------------------------------------------------------------------------------------------
// Group Cup
// ---------------------------------------------------------------------------------------------------------------

export type CupStatus = 'gathering' | 'group_stage' | 'final' | 'complete' | 'cancelled';

export interface CupSchedule {
  /** Each round: lock deadline, batting deadline and reveal time (ISO, minute resolution; these are public rules). */
  rounds: Array<{ round: number; lockBy: string; batBy: string; revealAt: string }>;
  final: { lockBy: string; batBy: string; revealAt: string } | null;
}

export interface Fixture {
  fixtureId: string;
  round: number | 'final';
  home: string;
  away: string;
  matchId: string;
  status: 'scheduled' | 'planning' | 'batting' | 'awaiting_reveal' | 'revealed' | 'void';
  /** True when a side was played by Auto Over/Auto XI. */
  auto: [boolean, boolean];
}

export interface StandingRow {
  playerId: string;
  alias: string;
  played: number;
  won: number;
  lost: number;
  tied: number;
  points: number;
  netRunRate: number;
  form: Array<'W' | 'L' | 'T'>;
  /** Movement since the previous reveal, for table-movement FOMO. */
  movement: number;
}

export interface CupView {
  cupId: string;
  name: string;
  status: CupStatus;
  size: number;
  /** 3–10 joined players; invited-but-not-joined players never block anything. */
  members: PlayerRef[];
  inviteToken: string | null;
  schedule: CupSchedule;
  fixtures: Fixture[];
  standings: StandingRow[];
  roomId: string;
  /** What I need to do next, with honest deadlines. */
  myTasks: Array<{ kind: 'lock' | 'bat' | 'watch'; matchId: string; by: string | null }>;
  /** Counts only ("4 of 6 locked"), never who or when. */
  lockedCount: { round: number; locked: number; total: number } | null;
  /** The champion once the final is revealed (status 'complete'); null before that and for cancelled cups. */
  winner: PlayerRef | null;
}

// ---------------------------------------------------------------------------------------------------------------
// Cricket Room
// ---------------------------------------------------------------------------------------------------------------

export type RoomPostKind =
  | 'invite'
  | 'fixture'
  | 'lock_status'
  | 'deadline'
  | 'reveal_ready'
  | 'scorecard'
  | 'standings'
  | 'achievement'
  | 'highlight'
  | 'rematch'
  | 'banter'
  | 'text';

export interface RoomPost {
  postId: string;
  kind: RoomPostKind;
  /** Spoiler-safe payload: a reveal_ready post never contains the result; scorecards appear only after reveal. */
  payload: Record<string, string | number | boolean | null>;
  authorId: string | null;
  /** Hour resolution. */
  createdHour: string;
  reactions: Partial<Record<ReactionId, number>>;
  myReaction: ReactionId | null;
}

export type ReactionId = 'clap' | 'fire' | 'shock' | 'laugh' | 'cricket_bat' | 'trophy';

export interface RoomView {
  roomId: string;
  kind: 'cup' | 'duel' | 'group';
  title: string;
  members: PlayerRef[];
  posts: RoomPost[];
  cursor: string | null;
  muted: boolean;
  /** 'all' | 'important' (deadlines, reveals, results) | 'none'. */
  notify: 'all' | 'important' | 'none';
  /** Free text is disabled by default; only predefined banter phrases. */
  freeText: boolean;
}

// ---------------------------------------------------------------------------------------------------------------
// Daily Six and leaderboards
// ---------------------------------------------------------------------------------------------------------------

export interface DailyView {
  /** IST calendar day, YYYY-MM-DD; resets at 00:00 IST. */
  day: string;
  conditions: Conditions;
  /** Three attempts a day, each against a different sealed daily over (A, B, C — the same for everyone). */
  attemptsUsed: number;
  attemptsMax: 3;
  /**
   * SHA-256 commits of the day's three sealed overs, published when the day opens; each attempt's replay reveals its
   * over and salt, so anyone can check the over was fixed before they batted.
   */
  overCommits: [string, string, string];
  bestScore: number | null;
  streak: number;
  resetsAt: string;
}

export type LeaderboardScope = 'national' | 'city' | 'college' | 'company' | 'friends';

export interface LeaderboardEntry {
  rank: number;
  playerId: string;
  alias: string;
  avatar: AvatarSpec;
  score: number;
  isMe: boolean;
}

export interface LeaderboardView {
  scope: LeaderboardScope;
  day: string;
  /** For college/company: the group, visible to members only. */
  groupId?: string;
  entries: LeaderboardEntry[];
  me: LeaderboardEntry | null;
  /** Real count of ranked players (never padded). */
  total: number;
}

/** Predefined banter phrases; ids are stable, text comes from i18n. */
export const BANTER_IDS = [
  'banter.locked_and_loaded',
  'banter.bring_it',
  'banter.yorker_incoming',
  'banter.watch_the_reveal',
  'banter.what_a_shot',
  'banter.unlucky',
  'banter.rematch',
  'banter.good_game',
  'banter.saved_by_super_ball',
  'banter.table_topper',
] as const;
export type BanterId = (typeof BANTER_IDS)[number];
