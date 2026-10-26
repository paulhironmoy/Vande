/**
 * Daily Top 100 and YouTube highlights — ROOT-OWNED contracts. Official videos are rendered only from validated
 * event logs on trusted infrastructure; no user-supplied media is ever published.
 */
import type { AvatarSpec, MatchEventLog } from './cricket';
import type { LocaleId } from './social';

export interface Top100Components {
  wins: number;
  opponentStrength: number;
  tacticalEfficiency: number;
  tournamentImportance: number;
  clutch: number;
  execution: number;
}

export interface Top100Entry {
  day: string;
  rank: number;
  playerId: string;
  alias: string;
  score: number;
  /** Only the player's best three eligible matches of the day count. */
  matchIds: string[];
  bestMatchId: string;
  components: Top100Components;
  /**
   * The public highlight landing code, set by the API only once every participant consented and the highlight is
   * published or unlisted (absent in the engine's ranking output).
   */
  highlightCode?: string | null;
}

/** Every highlight job status, in pipeline order (the admin console lists them in this order; the API validates against it). */
export const HIGHLIGHT_STATUSES = [
  'pending_consent',
  'consent_declined',
  'queued_render',
  'rendering',
  'render_failed',
  'pending_moderation',
  'rejected',
  'approved',
  'scheduled',
  /** Production without YouTube channel credentials: held, never announced. */
  'awaiting_channel',
  'uploading',
  'upload_failed',
  'published',
  'unlisted',
  /** A removal after a withdrawal or an admin removal keeps failing: alerted, listed with the dead letters, retried. */
  'removal_failed',
  'removed',
  'dead_letter',
] as const;
export type HighlightStatus = (typeof HIGHLIGHT_STATUSES)[number];

export type Visibility = 'public' | 'unlisted';

export interface HighlightJob {
  jobId: string;
  day: string;
  matchId: string;
  /** Both participants of the match (deduplicated when both qualify). */
  participants: string[];
  status: HighlightStatus;
  title: string;
  description: string;
  visibility: Visibility;
  /** R2 key of the temporary MP4 (deleted after a confirmed upload plus the recovery window). */
  videoKey: string | null;
  youtubeVideoId: string | null;
  scheduledFor: string | null;
  attempts: number;
  lastError: string | null;
  /** Short attribution code used in links (views, installs, invite opens, completed matches). */
  attributionCode: string;
}

export interface ConsentRecord {
  jobId: string;
  playerId: string;
  decision: 'granted' | 'declined' | 'withdrawn';
  /** Required for granted: the player confirmed they are 18 or older. */
  adultConfirmed: boolean;
  /** What the player saw and approved. */
  approvedTitle: string;
  approvedVisibility: Visibility;
  decidedHour: string;
}

export interface ModerationResult {
  jobId: string;
  aliasCheck: 'pass' | 'fail';
  antiCheat: 'pass' | 'fail';
  duplicate: 'pass' | 'fail';
  reviewer: 'auto' | 'admin';
  notes: string;
}

/**
 * Everything the trusted renderer needs to compose one official Short (1080×1920, 30–60 s, 30 fps). The same input
 * drives the in-app consent preview, so participants approve exactly what will be rendered.
 */
export interface HighlightRenderInput {
  jobId: string;
  /** A revealed log that passed verifyMatchLog: the only source of what happens on screen. */
  log: MatchEventLog;
  /**
   * The moderated display names, in log.players order: what the title shows and what the video must draw (never
   * log.players[].alias, which is the match-time alias and may since have changed or failed moderation).
   */
  aliases: [string, string];
  locale: LocaleId;
  /** e.g. "Friend Duel" or "Office Cup · Final" (filtered like aliases). */
  fixtureLabel: string;
  day: string;
  /** Top 100 rank of each player, in log.players order (null when that player did not qualify). */
  ranks: [number | null, number | null];
  /** Standings movement shown near the end (cup table or Top 100), computed by the platform. */
  standings: Array<{ alias: string; from: number | null; to: number }> | null;
  /** Attributed https link behind "Can you beat them?", shown on screen and in the description. */
  cta: { url: string };
}

/** Exposed by the render page as `window.__vcHighlight`; the render service drives it frame by frame. */
export interface HighlightRenderHost {
  /** Prepares the cut; resolves with its length (30–60 s) and frame rate. */
  load(input: HighlightRenderInput): Promise<{ durationMs: number; fps: 30 }>;
  /** Draws the frame at `tMs` deterministically (same input and time, same picture); resolves once it is drawn. */
  frame(tMs: number): Promise<void>;
  /**
   * Optional soundtrack for the loaded cut: base64 WAV of the composer's own generated audio (original sounds only),
   * exactly `durationMs` long, or null for a silent video.
   */
  audio?(): Promise<string | null>;
}

/** What a participant reviews before deciding on consent. */
export interface HighlightPreview {
  job: HighlightJob;
  input: HighlightRenderInput;
  /** Whether this player has decided yet, and how. */
  myDecision: ConsentRecord['decision'] | null;
}

/** Public landing data for a highlight's attribution code (only consented, published or unlisted videos). */
export interface HighlightPublic {
  code: string;
  day: string;
  title: string;
  youtubeVideoId: string | null;
  visibility: Visibility;
  matchId: string;
  participants: Array<{ alias: string; avatar: AvatarSpec; rank: number | null }>;
}

/** Client-reported attribution events; invite opens and completed matches are counted by the server itself. */
export type AttributionEvent = 'landing_open' | 'share' | 'install';
