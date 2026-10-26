/** Highlight job statuses, as the player sees them, and the public consent rules. */
import type { HighlightJob, HighlightStatus, MatchEventLog } from '@/contracts';

export type StatusGroup = 'decide' | 'queued' | 'failed' | 'live' | 'declined' | 'rejected' | 'removing' | 'removed';

const GROUP: Record<HighlightStatus, StatusGroup> = {
  pending_consent: 'decide',
  queued_render: 'queued',
  rendering: 'queued',
  pending_moderation: 'queued',
  approved: 'queued',
  scheduled: 'queued',
  uploading: 'queued',
  // Production without the channel's credentials: held, never claimed as published.
  awaiting_channel: 'queued',
  render_failed: 'failed',
  upload_failed: 'failed',
  dead_letter: 'failed',
  published: 'live',
  unlisted: 'live',
  consent_declined: 'declined',
  rejected: 'rejected',
  // A withdrawal or removal that YouTube refused for now: retried until the video is gone.
  removal_failed: 'removing',
  removed: 'removed',
};

export function statusGroup(status: HighlightStatus): StatusGroup {
  return GROUP[status] ?? 'queued';
}

/** Consent closes 48 hours after the 00:00 IST cutoff that ended the job's day. */
export const CONSENT_HOURS = 48;
export function consentDeadline(job: Pick<HighlightJob, 'day'>): string {
  return new Date(Date.parse(`${job.day}T18:30:00Z`) + CONSENT_HOURS * 3_600_000).toISOString();
}

/** Withdrawing before the upload cancels; afterwards the video is deleted (at most 24 hours). */
export function withdrawEffect(status: HighlightStatus): 'cancel' | 'remove' | 'nothing' {
  const g = statusGroup(status);
  if (g === 'live' || status === 'uploading') return 'remove';
  if (g === 'decide' || g === 'queued' || g === 'failed') return 'cancel';
  return 'nothing';
}

/** A link to the official video on YouTube (opened outside the app; never embedded). */
export function youtubeUrl(videoId: string): string {
  return `https://www.youtube.com/shorts/${encodeURIComponent(videoId)}`;
}

/**
 * The replay as a highlight shows it: the moderated display names (in log.players order) in place of the match-time
 * aliases, which may since have changed or failed moderation.
 */
export function withDisplayNames(log: MatchEventLog, names: ReadonlyArray<string | null | undefined>): MatchEventLog {
  const players = log.players.map((p, i) => (names[i] ? { ...p, alias: names[i] as string } : p)) as MatchEventLog['players'];
  return { ...log, players };
}
