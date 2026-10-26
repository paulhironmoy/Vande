/**
 * Admin console API (/v1/admin/*): typed here, shared by the Worker (backend/src/admin/routes.ts) and the console
 * (admin.html, src/admin). Not part of the public contract; every route needs Cloudflare Access (or the local
 * ADMIN_TOKEN) and is unreachable otherwise.
 */
import type { ConsentRecord, HighlightJob, HighlightStatus, ModerationResult } from '@/contracts';

export interface AdminJob extends HighlightJob {
  kind: 'duel' | 'cup';
  fixtureLabel: string;
  aliases: [string, string];
  ranks: [number | null, number | null];
  consentBy: string;
  videoBytes: number | null;
  videoMs: number | null;
  publishedAt: string | null;
  views: number;
  quotaDay: string | null;
  withdrawPending: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AdminModeration extends Omit<ModerationResult, 'jobId'> {
  decision: 'pass' | 'fail' | 'approve' | 'reject';
  admin: string | null;
  decidedAt: string;
}

export interface AdminJobDetail {
  job: AdminJob;
  consents: Array<ConsentRecord & { reason: string | null }>;
  moderation: AdminModeration[];
  attribution: Array<{ day: string; event: string; n: number }>;
}

export interface AdminQuota {
  quotaDay: string;
  nextResetAt: string;
  daily: number;
  usable: number;
  /** Units used today by every call, and the part uploads used (uploads may not exceed `usable`). */
  used: number;
  uploads: number;
  perUpload: number;
  uploadsPerDay: number;
  headroom: number;
  scheduled: Array<{ quotaDay: string; jobs: number }>;
}

export type AdminReportStatus = 'open' | 'dismissed' | 'actioned';

/** One report in the moderation queue (the reporter is never included: reports carry an opaque reference only). */
export interface AdminReport {
  id: number;
  kind: 'player' | 'post';
  reason: 'abusive' | 'spam' | 'cheating' | 'other';
  status: AdminReportStatus;
  createdHour: string;
  resolvedHour: string | null;
  /** How it was closed: dismissed, renamed, suspended, unsuspended or post_removed. */
  resolution: string | null;
  /** The reported player (for a post: its author) as they are now; alias null once the account is deleted. */
  player: { playerId: string; alias: string | null; status: 'active' | 'deleted' | 'unknown'; suspendedUntil: string | null; openReports: number } | null;
  /** A reported post as it stands in its room (`present` false once removed). */
  post: { postId: string; present: boolean; kind: string | null; text: string | null; phraseId: string | null; createdHour: string | null } | null;
  /** Every moderator action on this report (audit_log). */
  history: Array<{ at: string; action: string; admin: string; notes: string }>;
}

export interface AdminRoutes {
  'GET /v1/admin/whoami': [void, { id: string; via: 'access' | 'token' }];
  'GET /v1/admin/jobs': [{ day?: string; status?: HighlightStatus }, { jobs: AdminJob[]; counts: Partial<Record<HighlightStatus, number>> }];
  'GET /v1/admin/jobs/:jobId': [void, AdminJobDetail];
  'POST /v1/admin/jobs/:jobId/approve': [{ notes?: string }, { status: HighlightStatus }];
  'POST /v1/admin/jobs/:jobId/reject': [{ notes?: string }, { status: HighlightStatus }];
  'POST /v1/admin/jobs/:jobId/schedule': [{ at: string }, { status: HighlightStatus }];
  'POST /v1/admin/jobs/:jobId/retry-render': [void, { status: HighlightStatus }];
  'POST /v1/admin/jobs/:jobId/retry-upload': [void, { status: HighlightStatus }];
  'POST /v1/admin/jobs/:jobId/unlist': [void, { status: HighlightStatus }];
  'POST /v1/admin/jobs/:jobId/remove': [void, { status: HighlightStatus }];
  /** A signed, 10-minute link to the temporary MP4 (for the <video> element). */
  'POST /v1/admin/jobs/:jobId/preview-url': [void, { url: string; expiresAt: string }];
  'GET /v1/admin/quota': [void, AdminQuota];
  'GET /v1/admin/dlq': [void, { jobs: AdminJob[] }];
  /** The report queue: open (default) or closed reports, newest first, optionally one kind. */
  'GET /v1/admin/reports': [{ status?: 'open' | 'closed'; kind?: 'player' | 'post' }, { reports: AdminReport[]; counts: { open: number; closed: number } }];
  'POST /v1/admin/reports/:reportId/dismiss': [{ notes?: string }, { status: AdminReportStatus }];
  /** A generated, safe name for the reported player, everywhere their name shows. */
  'POST /v1/admin/reports/:reportId/rename': [{ notes?: string }, { status: AdminReportStatus; alias: string }];
  /** Pauses the reported account's social features (rooms, cups, groups, name changes) for 1–365 days (default 30). */
  'POST /v1/admin/reports/:reportId/suspend': [{ notes?: string; days?: number }, { status: AdminReportStatus; until: string }];
  'POST /v1/admin/reports/:reportId/unsuspend': [{ notes?: string }, { status: AdminReportStatus }];
  'POST /v1/admin/reports/:reportId/remove-post': [{ notes?: string }, { status: AdminReportStatus; removed: boolean }];
}

export type AdminRouteKey = keyof AdminRoutes & string;
