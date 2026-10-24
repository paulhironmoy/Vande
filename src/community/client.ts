/**
 * Anonymous community client. Submits official daily results (opt-in) and reads aggregate stats.
 * Every call is best-effort: timeouts, offline queueing, silent failure. Nothing here can block play.
 */
import type { DailyId, DailyRecordV2, DailyStats } from '@/engine/types';
import { flags } from '@/app/flags';
import { isValidFingerprint } from '@/share/fingerprint';
import { submissionIdFor } from './hash';
import { communityStorage } from './storage';
import type { DailyResultSubmission, OutboxItem, SubmitContext, SubmitStatus } from './types';

export const SUBMIT_TIMEOUT_MS = 5000;
export const STATS_TTL_MS = 10 * 60 * 1000;
export const OUTBOX_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
export const OUTBOX_MAX_ITEMS = 30;
/** Items that failed this many times are dropped: the backend was unreachable for far too long. */
export const OUTBOX_MAX_ATTEMPTS = 10;

export function isCommunityActive(): boolean {
  return flags.communityEnabled && Boolean(flags.communityApiUrl);
}

function isOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

async function withTimeout(input: string, init: RequestInit, ms = SUBMIT_TIMEOUT_MS): Promise<Response> {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : undefined;
  const timer = setTimeout(() => controller?.abort(), ms);
  try {
    return await fetch(input, { ...init, signal: controller?.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Builds the exact payload. Pure apart from the hash. */
export async function buildSubmission(record: DailyRecordV2, ctx: SubmitContext): Promise<DailyResultSubmission | null> {
  const official = record.official;
  if (!official) return null;
  if (!isValidFingerprint(official.fingerprint)) return null;
  return {
    v: 1,
    dailyId: record.dailyId,
    contentVersion: official.contentVersion,
    submissionId: await submissionIdFor(ctx.installId, record.dailyId),
    score: Math.max(0, Math.min(100, Math.round(official.score))),
    outcome: official.outcome,
    fingerprint: official.fingerprint,
    mode: official.mode,
    appVersion: ctx.appVersion.slice(0, 32),
    platform: ctx.platform,
  };
}

async function post(submission: DailyResultSubmission): Promise<'accepted' | 'duplicate' | 'rejected' | 'retry'> {
  const res = await withTimeout(`${flags.communityApiUrl}/v1/daily/${encodeURIComponent(submission.dailyId)}/results`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(submission),
    keepalive: true,
  });
  if (res.status === 201) return 'accepted';
  if (res.status === 200) return 'duplicate';
  if (res.status === 429 || res.status >= 500) return 'retry';
  return 'rejected';
}

/**
 * Submits an official result when the player has opted in. Offline or failed requests are queued and retried.
 * Never throws.
 */
export async function submitOfficialResult(record: DailyRecordV2, ctx: SubmitContext): Promise<SubmitStatus> {
  try {
    if (!isCommunityActive() || ctx.communitySharing !== 'on' || !record.official) return 'skipped';
    const submission = await buildSubmission(record, ctx);
    if (!submission) return 'skipped';
    if (!isOnline()) {
      await enqueue(submission);
      return 'queued';
    }
    try {
      const result = await post(submission);
      if (result === 'retry') {
        await enqueue(submission);
        return 'queued';
      }
      return result;
    } catch {
      await enqueue(submission);
      return 'queued';
    }
  } catch {
    return 'skipped';
  }
}

async function enqueue(submission: DailyResultSubmission): Promise<void> {
  const storage = communityStorage();
  const items = (await storage.getOutbox()).filter((i) => i.submission.submissionId !== submission.submissionId);
  items.push({ submission, queuedAt: new Date().toISOString(), attempts: 0 });
  await storage.setOutbox(items.slice(-OUTBOX_MAX_ITEMS));
}

/** Retries queued submissions. Drops items older than 14 days or rejected by the server. Never throws. */
export async function flushOutbox(now = Date.now()): Promise<{ sent: number; remaining: number }> {
  try {
    if (!isCommunityActive() || !isOnline()) {
      const items = await communityStorage().getOutbox();
      return { sent: 0, remaining: items.length };
    }
    const storage = communityStorage();
    const items = await storage.getOutbox();
    const keep: OutboxItem[] = [];
    let sent = 0;
    for (const item of items) {
      if (now - Date.parse(item.queuedAt) > OUTBOX_MAX_AGE_MS) continue;
      try {
        const result = await post(item.submission);
        if (result === 'accepted' || result === 'duplicate') sent += 1;
        else if (result === 'retry' && item.attempts + 1 < OUTBOX_MAX_ATTEMPTS) keep.push({ ...item, attempts: item.attempts + 1 });
        // 'rejected' → dropped on purpose
      } catch {
        if (item.attempts + 1 < OUTBOX_MAX_ATTEMPTS) keep.push({ ...item, attempts: item.attempts + 1 });
      }
    }
    await storage.setOutbox(keep);
    return { sent, remaining: keep.length };
  } catch {
    return { sent: 0, remaining: 0 };
  }
}

export interface StatsResult {
  stats?: DailyStats;
  fromCache: boolean;
  error?: 'disabled' | 'offline' | 'failed';
}

function isStats(v: unknown): v is DailyStats {
  if (!v || typeof v !== 'object') return false;
  const s = v as Partial<DailyStats>;
  return typeof s.dailyId === 'string' && typeof s.count === 'number' && typeof s.ready === 'boolean' && typeof s.minCohort === 'number';
}

/** Aggregate stats for a day with a 10-minute cache; cached data is returned with `fromCache: true` and its own `asOf`. */
export async function fetchDailyStats(dailyId: DailyId, opts: { force?: boolean; contentVersion?: string; now?: number } = {}): Promise<StatsResult> {
  if (!isCommunityActive()) return { fromCache: false, error: 'disabled' };
  const storage = communityStorage();
  const now = opts.now ?? Date.now();
  let cached: Awaited<ReturnType<typeof storage.getStats>>;
  try {
    cached = await storage.getStats(dailyId);
  } catch {
    cached = undefined;
  }
  if (cached && !opts.force && now - Date.parse(cached.fetchedAt) < STATS_TTL_MS) return { stats: cached.stats, fromCache: true };
  if (!isOnline()) return cached ? { stats: cached.stats, fromCache: true, error: 'offline' } : { fromCache: false, error: 'offline' };
  try {
    const q = opts.contentVersion ? `?cv=${encodeURIComponent(opts.contentVersion)}` : '';
    const res = await withTimeout(`${flags.communityApiUrl}/v1/daily/${encodeURIComponent(dailyId)}/stats${q}`, { method: 'GET', headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(String(res.status));
    const json: unknown = await res.json();
    if (!isStats(json)) throw new Error('bad stats');
    const stats: DailyStats = { ...json, ready: json.ready && json.count >= Math.max(json.minCohort, flags.communityMinCohort) };
    try {
      await storage.setStats(dailyId, { stats, fetchedAt: new Date(now).toISOString() });
    } catch {
      /* cache is optional */
    }
    return { stats, fromCache: false };
  } catch {
    return cached ? { stats: cached.stats, fromCache: true, error: 'failed' } : { fromCache: false, error: 'failed' };
  }
}

let syncStarted = false;

/** Flushes the outbox when the app comes back online or becomes visible. Idempotent. */
export function startCommunitySync(): void {
  if (syncStarted || typeof window === 'undefined' || !isCommunityActive()) return;
  syncStarted = true;
  const run = () => {
    void flushOutbox();
  };
  window.addEventListener('online', run);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') run();
  });
  setTimeout(run, 1500);
}
