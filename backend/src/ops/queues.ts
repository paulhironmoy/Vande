/**
 * Queue consumers. `vande-notify`: push notifications (retried with backoff by Cloudflare Queues; after max_retries a
 * message moves to `vande-notify-dlq`). `vande-maint`: account-deletion follow-ups that could not run inline.
 * Dead-letter consumers record a metric and a log line, then acknowledge (the messages hold no personal data).
 */
import type { Config } from '../config';
import type { Env, MessageBatchLike } from '../env';
import type { WorkerDeps } from '../http/context';
import { warnOnce } from '../http/log';
import { callMatch } from '../match/client';
import { callCup } from '../cup/client';
import { open } from '../security/crypto';
import { parseKeyring } from '../security/keyring';
import { SQL } from '../storage/sql';
import type { MaintenanceMessage, MediaMessage, NotifyMessage } from './messages';
import { mediaDeadLetter, processMedia } from '../highlights/uploader';
import { fcmSender, type PushSender } from './push';
import { caps, isImportant, minutesOfQuietLeft, quietOf } from './notifyPolicy';
import { checkDailyCap } from '../guards/ratelimit';
import { IST_OFFSET_MS } from '../time';

const KINDS = new Set(['opponent_joined', 'opponent_locked', 'reveal_ready', 'auto_over', 'match_expired', 'rematch', 'deadline_reminder', 'new_fixture', 'final', 'cup_complete', 'cup_cancelled', 'top100', 'highlight_published']);

function backoffSeconds(attempts: number): number {
  return Math.min(600, 10 * 2 ** Math.max(0, attempts - 1));
}

/** Uploads and removals back off longer: 1, 2, 4, 8 … minutes, at most an hour. */
function mediaBackoffSeconds(attempts: number): number {
  return Math.min(3600, 60 * 2 ** Math.max(0, attempts - 1));
}

let isolateSender: PushSender | null | undefined;

function senderFor(env: Env, deps: WorkerDeps): PushSender | null {
  if (deps.push) return deps.push;
  if (isolateSender === undefined) isolateSender = env.FCM_SERVICE_ACCOUNT ? fcmSender({ serviceAccountJson: env.FCM_SERVICE_ACCOUNT, fetch: deps.fetch, now: deps.now }) : null;
  return isolateSender;
}

/**
 * Applies the player's preferences, the room's settings, quiet hours and the daily caps (notifyPolicy.ts).
 * 'send', 'drop', or a delay in seconds (the message is held back once for the end of the quiet hours).
 */
async function decide(env: Env, deps: WorkerDeps, msg: NotifyMessage, firstAttempt: boolean): Promise<'send' | 'drop' | number> {
  const db = env.DB;
  const prefs = await db.prepare(SQL.notifyPrefs).bind(msg.uid).first<{ enabled: number; quiet_start: number | null; quiet_end: number | null }>();
  const drop = (why: string) => {
    deps.metrics.count('notify_dropped', [why]);
    return 'drop' as const;
  };
  if (prefs && prefs.enabled === 0) return drop('opt_out');
  const important = isImportant(msg.kind);
  if (msg.roomId) {
    const room = await db.prepare(SQL.roomSetting).bind(msg.uid, msg.roomId).first<{ muted: number; notify: string }>();
    if (room?.muted === 1 || room?.notify === 'none') return drop('room_muted');
    if (room?.notify === 'important' && !important) return drop('room_important_only');
  }
  const quietLeft = minutesOfQuietLeft(quietOf(env, prefs), deps.now());
  if (quietLeft > 0) {
    if (!important) return drop('quiet_hours');
    if (!msg.deferred) return Math.min(43_200, quietLeft * 60);
  }
  const salt = env.RATE_SALT;
  // Caps count a notification once: a retry after a provider failure does not use up another slot.
  if (salt && firstAttempt) {
    const limits = caps(env);
    if (!important && !(await checkDailyCapFor(db, `notify-routine:${msg.uid}`, salt, limits.routine, deps.now()))) return drop('routine_cap');
    if (!(await checkDailyCapFor(db, `notify:${msg.uid}`, salt, limits.total, deps.now()))) return drop('daily_cap');
  }
  return 'send';
}

async function checkDailyCapFor(db: Env['DB'], key: string, salt: string, limit: number, now: number): Promise<boolean> {
  // IST days: shift the clock so the day bucket turns over at 00:00 IST.
  return checkDailyCap(db, key, salt, limit, now + IST_OFFSET_MS, 'day-notify');
}

/**
 * The FCM collapse key: the message's dedupe key without the recipient's internal account id (collapse keys act per
 * device anyway), so Google never receives the uid.
 */
export function collapseKeyOf(msg: Pick<NotifyMessage, 'dedupe' | 'uid'>): string {
  return msg.dedupe
    .split(':')
    .filter((part) => part !== msg.uid)
    .join(':');
}

/** Delivers one notification to every registered device of the recipient. Throws to ask for a retry. */
export async function deliverNotification(env: Env, deps: WorkerDeps, msg: NotifyMessage, attempts = 1): Promise<'sent' | 'skipped' | 'deferred'> {
  if (msg?.v !== 1 || !KINDS.has(msg.kind) || typeof msg.uid !== 'string' || (msg.matchId !== undefined && typeof msg.matchId !== 'string')) return 'skipped';
  const decision = await decide(env, deps, msg, attempts <= 1);
  if (decision === 'drop') return 'skipped';
  if (typeof decision === 'number') {
    await env.NOTIFY_QUEUE?.send({ ...msg, deferred: true }, { delaySeconds: decision });
    deps.metrics.count('notify_deferred', [msg.kind]);
    return 'deferred';
  }
  const sender = senderFor(env, deps);
  if (!sender) {
    warnOnce(deps.logger, 'FCM_SERVICE_ACCOUNT', 'FCM_SERVICE_ACCOUNT is not set; push notifications are dropped');
    return 'skipped';
  }
  const ring = parseKeyring(env.DATA_KEYS);
  if (!ring) throw new Error('DATA_KEYS missing');
  const rows = await env.DB.prepare(SQL.pushTokensOfUid).bind(msg.uid).all<{ token_hash: string; token_enc: string; platform: string }>();
  let retry = false;
  for (const row of rows.results) {
    const token = await open(ring.all, 'push', msg.uid, row.token_enc, `${msg.uid}|${row.token_hash}`);
    if (!token) continue;
    const result = await sender.send(token, row.platform, { kind: msg.kind, matchId: msg.matchId ?? '', ...(msg.cupId ? { cupId: msg.cupId } : {}), ...(msg.jobId ? { jobId: msg.jobId } : {}), collapseKey: collapseKeyOf(msg) });
    if (result === 'invalid_token') await env.DB.prepare(SQL.deletePushToken).bind(msg.uid, row.token_hash).run();
    else if (result === 'retry') retry = true;
    else deps.metrics.count('notify_sent', [msg.kind]);
  }
  if (retry) throw new Error('push provider asked for a retry');
  return rows.results.length > 0 ? 'sent' : 'skipped';
}

async function runMaintenance(env: Env, cfg: Config, msg: MaintenanceMessage): Promise<void> {
  if (msg?.v !== 1) return;
  if (msg.kind === 'forget_player') await callMatch(env, cfg, msg.matchId, { op: 'forget', uid: msg.uid });
  else if (msg.kind === 'forget_cup_player') await callCup(env, cfg, msg.cupId, { op: 'forget', uid: msg.uid });
  else if (msg.kind === 'purge_export') await env.FILES?.delete(msg.objectKey);
  else if (msg.kind === 'rename_player') await callMatch(env, cfg, msg.matchId, { op: 'rename', uid: msg.uid, ref: msg.ref });
  else if (msg.kind === 'rename_cup_player') await callCup(env, cfg, msg.cupId, { op: 'rename', uid: msg.uid, ref: msg.ref });
}

export async function handleQueue(batch: MessageBatchLike<unknown>, env: Env, deps: WorkerDeps, cfg: Config): Promise<void> {
  const dead = batch.queue.endsWith('-dlq');
  const media = batch.queue.includes('media');
  for (const message of batch.messages) {
    if (dead && media) {
      try {
        await mediaDeadLetter(env, deps, cfg, message as typeof message & { body: MediaMessage });
      } catch {
        deps.logger.log('error', { evt: 'media_dead_letter_failed' });
      }
      message.ack();
      continue;
    }
    if (dead) {
      deps.metrics.count('notify_dead_letter', [batch.queue]);
      deps.logger.log('warn', { evt: 'dead_letter', queue: batch.queue, attempts: message.attempts });
      message.ack();
      continue;
    }
    try {
      if (batch.queue.includes('notify')) await deliverNotification(env, deps, message.body as NotifyMessage, message.attempts);
      else if (batch.queue.includes('maint')) await runMaintenance(env, cfg, message.body as MaintenanceMessage);
      else if (media) await processMedia(env, deps, cfg, message.body as MediaMessage);
      message.ack();
    } catch {
      message.retry({ delaySeconds: media ? mediaBackoffSeconds(message.attempts) : backoffSeconds(message.attempts) });
    }
  }
}
