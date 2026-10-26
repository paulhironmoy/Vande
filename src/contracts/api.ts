/**
 * HTTP API contract (v1) — ROOT-OWNED. JSON over HTTPS; bearer access tokens; every mutating call carries an
 * `Idempotency-Key` header (UUID). Errors are `{ error: { code, message } }` with stable codes. The server never
 * returns an opponent's plan, an exact timestamp or a sealed result before the reveal.
 */
import type { BattingInput, MatchEventLog, OverPlan, RevealedDelivery, ShotFeedback, Conditions } from './cricket';
import type { CupView, DailyView, LeaderboardScope, LeaderboardView, MatchView, Profile, RoomView, BanterId, ReactionId, LocaleId } from './social';
import type { AttributionEvent, ConsentRecord, HighlightJob, HighlightPreview, HighlightPublic, Top100Entry, Visibility } from './highlights';

/** The share moments a player may claim once per match or cup (server-checked: one invite, reminder and final share). */
export const SHARE_MOMENTS = ['invite', 'reminder', 'final'] as const;
export type ShareMoment = (typeof SHARE_MOMENTS)[number];

export type ApiErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'invalid'
  | 'conflict'
  | 'rate_limited'
  | 'deadline_passed'
  | 'already_locked'
  | 'not_your_turn'
  | 'sealed'
  | 'version_mismatch'
  | 'unavailable';

// ---- auth -------------------------------------------------------------------------------------------------------
export interface SessionTokens {
  playerId: string;
  accessToken: string;
  /** Opaque, rotated on every refresh; stored only in secure storage. */
  refreshToken: string;
  /** ISO time the access token expires. */
  expiresAt: string;
}
/**
 * VANDE Cricket is for players aged 18 and over (docs/PRIVACY_AND_CONSENT.md, age policy): the neutral age screen at
 * first run must have confirmed it, and the server refuses a sign-up without it.
 */
export type GuestSignupRequest = { locale: LocaleId; alias?: string; avatarSeed?: string; adultConfirmed: boolean };
export type RefreshRequest = { refreshToken: string };
export type LinkGoogleRequest = { idToken: string };

// ---- profile ----------------------------------------------------------------------------------------------------
export type ProfilePatch = Partial<Pick<Profile, 'alias' | 'avatar' | 'kit' | 'locale' | 'city'>> & { adultConfirmed?: boolean };
export type JoinGroupRequest = { code: string };
export type CreateGroupRequest = { kind: 'college' | 'company'; name: string };

// ---- duels and matches ------------------------------------------------------------------------------------------
export interface CreateDuelResponse {
  matchId: string;
  inviteToken: string;
  /** https URL that opens the web app (no install needed) and deep-links into Android when installed. */
  inviteUrl: string;
}
/** Public, spoiler-free preview of an invitation (works for non-players). */
export interface InvitePreview {
  kind: 'duel' | 'cup';
  inviterAlias: string;
  conditions: Conditions | null;
  cupName?: string;
  members?: number;
  expiresAt: string;
}
export type LockRequest = { plan: OverPlan };
export interface LockResponse {
  commitHash: string;
  sig: string;
  keyId: string;
}
/** Requests the next delivery; the server starts the ball's clock only when it is revealed to the batter. */
export interface NextBallResponse {
  delivery: RevealedDelivery;
  /** Signed, single-use token binding this reveal to the answer. */
  ballToken: string;
  /** Field the batter faces (visible from the first ball, like real cricket). */
  field: OverPlan['field'];
  /**
   * Deliveries still to come after this one. Duels and cups include the Super Ball (6 down to 0); a Daily Six attempt
   * has none (5 down to 0). Dead balls count too.
   */
  ballsLeft: number;
}
export type ShotRequest = { input: BattingInput; ballToken: string };
export interface ShotResponse {
  feedback: ShotFeedback;
  inningsComplete: boolean;
}
export type RevealResponse = MatchEventLog;

/** A revealed match someone shared: what a visitor needs for a spoiler-safe landing and the replay. */
export interface SharedMatch {
  code: string;
  kind: 'duel' | 'cup';
  conditions: Conditions;
  /** Moderated display names, in log.players order (never the match-time aliases inside the log). */
  aliases: [string, string];
  log: RevealResponse;
}

// ---- cups -------------------------------------------------------------------------------------------------------
export interface CreateCupRequest {
  name: string;
  /** Planned size 3–10; the cup starts with whoever has joined by the start time (minimum 3). */
  maxPlayers: number;
  /** Round length preset. */
  pace: 'sprint' | 'daily' | 'weekend';
}
export type CreateCupResponse = { cupId: string; inviteToken: string; inviteUrl: string };

// ---- rooms ------------------------------------------------------------------------------------------------------
export type ReactRequest = { postId: string; reaction: ReactionId | null };
export type BanterRequest = { phraseId: BanterId };
export type RoomSettingsRequest = { muted?: boolean; notify?: RoomView['notify'] };
export type ReportRequest = { postId?: string; playerId?: string; reason: 'abusive' | 'spam' | 'cheating' | 'other' };

// ---- daily ------------------------------------------------------------------------------------------------------
export type DailyAttemptResponse = { attemptId: string; attempt: 1 | 2 | 3 };
export interface DailyResultResponse {
  score: number;
  /**
   * False when the attempt had more than one irregular ball (late, expired or invalid answers): it still uses the
   * attempt and keeps the streak, but its score appears on no board and never becomes the best score.
   */
  counted: boolean;
  /** Best counted score today (null when no attempt has counted yet). */
  bestScore: number | null;
  log: MatchEventLog;
}

// ---- highlights and consent -------------------------------------------------------------------------------------
export interface ConsentRequest {
  decision: 'granted' | 'declined';
  adultConfirmed: boolean;
  visibility: Visibility;
}
export type WithdrawConsentRequest = { reason?: string };

// ---- push -------------------------------------------------------------------------------------------------------
export type RegisterPushRequest = { token: string; platform: 'android' | 'web' };
export interface PushSettings {
  enabled: boolean;
  /** Local quiet hours (HH:MM, IST); routine pushes are dropped and important ones held until they end. */
  quietHours: { start: string; end: string } | null;
}

/** Endpoint map: method + path → request/response types (the platform client and Worker both follow it). */
export interface ApiRoutes {
  'GET /v1/health': [void, { ok: true; version: string }];
  /** Public commit-signing keys (key id → P-256 public key) so anyone can verify commit signatures. */
  'GET /v1/keys': [void, { keys: Array<{ keyId: string; publicKey: string }> }];
  'POST /v1/auth/guest': [GuestSignupRequest, SessionTokens];
  /** Recover an account on a new device with a linked Google identity. */
  'POST /v1/auth/google': [LinkGoogleRequest, SessionTokens];
  'POST /v1/auth/link/passkey': [{ credential: string }, { linked: true }];
  'POST /v1/auth/passkey': [{ credential: string }, SessionTokens];
  'POST /v1/auth/refresh': [RefreshRequest, SessionTokens];
  'POST /v1/auth/link/google': [LinkGoogleRequest, { linked: true }];
  /** Signs this device out (revokes the current session family). A guest account without a linked identity is lost. */
  'POST /v1/auth/logout': [void, { ok: true }];
  /** Signs out every other device of this account (revokes all other session families); this device stays signed in. */
  'POST /v1/auth/revoke-others': [void, { revoked: number }];
  'GET /v1/me': [void, Profile];
  'PATCH /v1/me': [ProfilePatch, Profile];
  'POST /v1/me/export': [void, { downloadUrl: string; expiresAt: string }];
  /** Signed, expiring download of a data export (`t` is the signed token from me/export). */
  'GET /v1/exports/:id': [{ t: string }, unknown];
  'DELETE /v1/me': [void, { deleted: true }];
  'POST /v1/groups': [CreateGroupRequest, { groupId: string; code: string }];
  'POST /v1/groups/join': [JoinGroupRequest, { groupId: string }];
  /** `attributionCode` credits a duel started from a highlight landing (counted when the match completes). */
  'POST /v1/duels': [{ conditions?: Conditions; attributionCode?: string }, CreateDuelResponse];
  'GET /v1/invites/:token': [void, InvitePreview];
  'POST /v1/invites/:token/accept': [void, { matchId?: string; cupId?: string }];
  'GET /v1/matches': [void, MatchView[]];
  'GET /v1/matches/:id': [void, MatchView];
  'POST /v1/matches/:id/lock': [LockRequest, LockResponse];
  'POST /v1/matches/:id/bat/next': [void, NextBallResponse];
  'POST /v1/matches/:id/bat/shot': [ShotRequest, ShotResponse];
  'GET /v1/matches/:id/reveal': [void, RevealResponse];
  'POST /v1/matches/:id/rematch': [void, CreateDuelResponse];
  /**
   * The WhatsApp courtesy cap, kept by the server per player and match (invitation, one reminder, the final reveal or
   * highlight): asks before the share sheet opens; `allowed` false means this moment was already used.
   */
  'POST /v1/matches/:id/moments': [{ moment: ShareMoment }, { allowed: boolean }];
  /** A participant shares a revealed match: one public, spoiler-safe link per match (idempotent). */
  'POST /v1/matches/:id/share': [void, { code: string; url: string }];
  /** Public view of a shared, revealed match (moderated names; "Deleted player" after an account is deleted). */
  'GET /v1/s/:code': [void, SharedMatch];
  'POST /v1/cups': [CreateCupRequest, CreateCupResponse];
  'GET /v1/cups/:id': [void, CupView];
  'GET /v1/rooms/:id': [void, RoomView];
  'POST /v1/rooms/:id/react': [ReactRequest, { ok: true }];
  'POST /v1/rooms/:id/banter': [BanterRequest, { ok: true }];
  'POST /v1/rooms/:id/settings': [RoomSettingsRequest, { ok: true }];
  'POST /v1/report': [ReportRequest, { ok: true }];
  'POST /v1/blocks/:playerId': [void, { ok: true }];
  'GET /v1/daily': [void, DailyView];
  'POST /v1/daily/attempts': [void, DailyAttemptResponse];
  'POST /v1/daily/attempts/:id/next': [void, NextBallResponse];
  'POST /v1/daily/attempts/:id/shot': [ShotRequest, ShotResponse];
  'GET /v1/daily/attempts/:id/result': [void, DailyResultResponse];
  'GET /v1/leaderboards/:scope': [{ scope: LeaderboardScope; day?: string; groupId?: string }, LeaderboardView];
  'GET /v1/top100/:day': [void, Top100Entry[]];
  'GET /v1/highlights/mine': [void, HighlightJob[]];
  'POST /v1/highlights/:jobId/consent': [ConsentRequest, ConsentRecord];
  'POST /v1/highlights/:jobId/withdraw': [WithdrawConsentRequest, ConsentRecord];
  /** Participants only: the exact cut, title, description and visibility they are asked to approve. */
  'GET /v1/highlights/:jobId/preview': [void, HighlightPreview];
  /** Public landing for an attribution code: consented, published or unlisted highlights only. */
  'GET /v1/h/:code': [void, HighlightPublic];
  /** The highlight's revealed replay log (same availability as the landing). */
  'GET /v1/h/:code/replay': [void, MatchEventLog];
  'POST /v1/attribution': [{ code: string; event: AttributionEvent }, { ok: true }];
  'POST /v1/push/register': [RegisterPushRequest, { ok: true }];
  'GET /v1/push/settings': [void, PushSettings];
  'POST /v1/push/settings': [PushSettings, PushSettings];
  /** Free text in a Cricket Room: off unless the server enables it (ROOM_FREE_TEXT=1); filtered like aliases. */
  'POST /v1/rooms/:id/text': [{ text: string }, { ok: true }];
}
