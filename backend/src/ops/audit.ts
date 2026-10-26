/**
 * Security audit log (D1 table audit_log, kept AUDIT_RETENTION_DAYS). Rows name the actor by a pseudonymous
 * reference (a truncated SHA-256 of the internal account id), the action from a closed list, an optional target
 * (match or group id) and a small detail object without personal data. Writing an audit row never fails a request.
 */
import type { D1Like } from '../env';
import { sha256Hex } from '../security/crypto';
import type { Logger } from '../http/log';

export type AuditAction =
  | 'account_created'
  | 'account_linked'
  | 'account_recovered'
  | 'account_deleted'
  | 'export_requested'
  | 'session_revoked_reuse'
  | 'session_signed_out'
  | 'sessions_revoked'
  | 'alias_rejected'
  | 'group_created'
  | 'group_joined'
  | 'duel_created'
  | 'invite_accepted'
  | 'over_locked'
  | 'auto_over'
  | 'auto_xi'
  | 'match_revealed'
  | 'match_expired'
  | 'report_filed'
  | 'player_blocked'
  | 'admin_action'
  | 'admin_report';

export const SQL_INSERT_AUDIT = 'INSERT INTO audit_log (at_ms, actor_ref, action, target, detail) VALUES (?1, ?2, ?3, ?4, ?5)';

export async function actorRef(uid: string): Promise<string> {
  return (await sha256Hex(`audit:${uid}`)).slice(0, 16);
}

export async function audit(
  db: D1Like,
  log: Logger,
  entry: { at: number; uid: string | null; action: AuditAction; target?: string | null; detail?: Record<string, string | number | boolean> },
): Promise<void> {
  try {
    const ref = entry.uid ? await actorRef(entry.uid) : 'system';
    await db
      .prepare(SQL_INSERT_AUDIT)
      .bind(entry.at, ref, entry.action, entry.target ?? null, entry.detail ? JSON.stringify(entry.detail) : null)
      .run();
  } catch {
    log.log('warn', { evt: 'audit_failed', action: entry.action });
  }
}
