/**
 * Highlight jobs: rows ↔ the HighlightJob contract, the status machine and small shared helpers.
 *
 *   pending_consent ─(everyone granted, automatic checks pass)→ queued_render → rendering → pending_moderation
 *        │                  └─(a check fails)→ rejected                  └→ render_failed (retried) → dead_letter
 *        ├─(any decline, or no answer in 48 h)→ consent_declined
 *   pending_moderation ─(admin approves, or HIGHLIGHT_AUTO_APPROVE=1)→ approved → scheduled → uploading → published
 *        └─(admin rejects)→ rejected                                   (quota full: scheduled for the next quota day)
 *   uploading → upload_failed (retried) → dead_letter;  published → unlisted | removed (withdrawal, admin, deletion)
 *   scheduled → awaiting_channel (production without the channel's secrets: held, never announced) → scheduled
 *   a removal whose retries are exhausted → removal_failed (an alert; retried hourly) → removed
 *
 * A withdrawal before the upload cancels (consent_declined); during or after it, the video is removed.
 */
import type { ConsentRecord, HighlightJob, HighlightStatus, Visibility } from '@/contracts';
import { hourIso, minuteIso } from '../http/http';

export interface JobRow {
  job_id: string;
  day: string;
  match_id: string;
  kind: 'duel' | 'cup';
  cup_id: string | null;
  room_id: string | null;
  uid0: string;
  uid1: string;
  pid0: string;
  pid1: string;
  alias0: string;
  alias1: string;
  avatar0: string;
  avatar1: string;
  pair: string;
  rank0: number | null;
  rank1: number | null;
  status: HighlightStatus;
  title: string;
  description: string;
  fixture_label: string;
  locale: string;
  visibility: Visibility;
  code: string;
  consent_by_ms: number;
  video_key: string | null;
  video_sha256: string | null;
  video_bytes: number | null;
  video_ms: number | null;
  youtube_video_id: string | null;
  upload_session: string | null;
  quota_day: string | null;
  scheduled_ms: number | null;
  retry_ms: number | null;
  lease_ms: number | null;
  attempts: number;
  upload_attempts: number;
  last_error: string | null;
  withdraw_pending: number;
  published_ms: number | null;
  views: number;
  views_ms: number | null;
  created_ms: number;
  updated_ms: number;
}

export interface ConsentRow {
  seq: number;
  uid: string;
  player_id: string;
  decision: ConsentRecord['decision'];
  adult: number;
  approved_title: string;
  approved_visibility: Visibility;
  reason: string | null;
  decided_ms: number;
}

/** A video exists on the channel. */
export const LIVE_STATUSES: ReadonlySet<HighlightStatus> = new Set(['published', 'unlisted']);
/** Before the upload starts: a withdrawal simply cancels. */
export const BEFORE_UPLOAD: ReadonlySet<HighlightStatus> = new Set(['pending_consent', 'queued_render', 'rendering', 'render_failed', 'pending_moderation', 'approved', 'scheduled', 'awaiting_channel', 'upload_failed', 'dead_letter']);

/** Temporary MP4s in R2 (deleted 72 h after a confirmed upload or once the job closes). */
export function videoKeyFor(jobId: string): string {
  return `tmp/highlights/${jobId}.mp4`;
}

export const JOB_ID_RE = /^j[a-z2-7]{26}$/;

/** Mock uploads get ids that can never be a real YouTube id (11 characters); the public API never shows them. */
export function isMockVideoId(id: string | null): boolean {
  return !!id && id.startsWith('mock-');
}

export function participantIndex(row: JobRow, uid: string): 0 | 1 | null {
  if (row.uid0 === uid) return 0;
  if (row.uid1 === uid) return 1;
  return null;
}

export function jobOf(row: JobRow): HighlightJob {
  return {
    jobId: row.job_id,
    day: row.day,
    matchId: row.match_id,
    participants: [row.pid0, row.pid1],
    status: row.status,
    title: row.title,
    description: row.description,
    visibility: row.visibility,
    videoKey: row.video_key,
    youtubeVideoId: row.youtube_video_id,
    scheduledFor: row.scheduled_ms === null ? null : minuteIso(row.scheduled_ms),
    attempts: row.attempts + row.upload_attempts,
    lastError: row.last_error,
    attributionCode: row.code,
  };
}

export function consentOf(jobId: string, row: ConsentRow): ConsentRecord {
  return {
    jobId,
    playerId: row.player_id,
    decision: row.decision,
    adultConfirmed: row.adult === 1,
    approvedTitle: row.approved_title,
    approvedVisibility: row.approved_visibility,
    decidedHour: hourIso(row.decided_ms),
  };
}

/** Each participant's latest decision (the audit trail is append-only). */
export function latestDecisions(rows: readonly ConsentRow[]): Map<string, ConsentRow> {
  const out = new Map<string, ConsentRow>();
  for (const r of rows) out.set(r.uid, r);
  return out;
}

/** The stricter of the participants' choices wins: unlisted over public. */
export function strictestVisibility(choices: readonly Visibility[]): Visibility {
  return choices.includes('unlisted') ? 'unlisted' : 'public';
}
