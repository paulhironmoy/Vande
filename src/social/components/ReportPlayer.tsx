import { useState, type ReactNode } from 'react';
import type { ReportRequest } from '@/contracts';
import { useApp } from '@/app/store';
import { PLAYER_ID_RE } from '@/net/shared/ids';
import { Dialog, IconButton } from '@/ui';
import { useAction, useSocialServices } from '../hooks';
import { useSocialT } from '../i18n';
import s from './social.module.css';

const REASONS: ReportRequest['reason'][] = ['abusive', 'spam', 'cheating', 'other'];

export interface ReportTarget {
  playerId: string;
  alias: string;
}

/** Who may be reported from a list: another real player (never yourself, a deleted player or a computer side). */
export function reportablePlayer(playerId: string | null | undefined, myId: string | null | undefined): boolean {
  return Boolean(playerId && PLAYER_ID_RE.test(playerId) && playerId !== myId);
}

/**
 * Report a player wherever their name shows (leaderboards, the Daily Top 100, cup tables), not only in rooms: one
 * dialog per screen and a small button per row. Reports reach the moderation queue (the admin console); the player is
 * never told who reported them.
 */
export function useReportPlayer(): { button: (target: ReportTarget, testId?: string) => ReactNode; dialog: ReactNode } {
  const { t } = useSocialT();
  const { net } = useSocialServices();
  const toast = useApp((st) => st.toast);
  const action = useAction();
  const [target, setTarget] = useState<ReportTarget | null>(null);
  const [reason, setReason] = useState<ReportRequest['reason']>('abusive');

  const send = async () => {
    if (!target || !net) return;
    const playerId = target.playerId;
    const r = await action.run(() => net.api.call('POST /v1/report', { body: { playerId, reason } }));
    setTarget(null);
    toast(r.ok ? { kind: 'success', text: t('social.room.reported') } : { kind: 'warning', text: t('social.room.send_failed') });
  };

  const button = (tg: ReportTarget, testId?: string) => (
    <IconButton
      icon="alert"
      label={t('social.report.player', { name: tg.alias })}
      onClick={() => {
        setReason('abusive');
        setTarget(tg);
      }}
      data-testid={testId}
    />
  );

  const name = target?.alias ?? '';
  const dialog = (
    <Dialog
      open={target !== null}
      title={t('social.report.title', { name })}
      description={t('social.report.body', { name })}
      confirmLabel={t('social.room.report_send')}
      cancelLabel={t('social.common.cancel')}
      onConfirm={() => void send()}
      onCancel={() => setTarget(null)}
      testId="report-player"
    >
      <fieldset className={s.stackSm}>
        <legend className={s.h3}>{t('social.report.reason')}</legend>
        {REASONS.map((r) => (
          <label key={r} className={s.check}>
            <input type="radio" name="report-player-reason" value={r} checked={reason === r} onChange={() => setReason(r)} />
            <span>{t(`social.room.reason_${r}` as 'social.room.reason_abusive')}</span>
          </label>
        ))}
      </fieldset>
    </Dialog>
  );
  return { button, dialog };
}
