import { useEffect, useState } from 'react';
import type { Conditions, PlayerRef } from '@/contracts';
import { useApp } from '@/app/store';
import { useT } from '@/i18n';
import { Button, Card, Icon } from '@/ui';
import { useNet } from '../app/hooks';
import { cardBlob, inviteCardModel, playerOf } from './cards';
import { QrCode } from './QrCode';
import { copyText, momentAvailable, shareLocale, shareMatchMoment, type ShareChannel } from './share';
import s from './InvitePanel.module.css';

export interface InvitePanelProps {
  matchId: string;
  inviteUrl: string;
  inviter: PlayerRef;
  conditions: Conditions | null;
  kind?: 'duel' | 'cup';
  /** The Group Cup's name (cup invites): named on the card and in the share text. */
  cupName?: string;
  /** Continue to planning (shown as the secondary path). */
  onPlan?: () => void;
  planLabel?: string;
}

/**
 * The invitation: WhatsApp first (opens WhatsApp with the message ready; the player picks the chat), the system share
 * sheet with the card image, copy link and a QR code. One invitation message per match; the link and QR stay
 * available. Nothing is ever sent by the app and no contacts are read.
 */
export function InvitePanel({ matchId, inviteUrl, inviter, conditions, kind = 'duel', cupName, onPlan, planLabel }: InvitePanelProps) {
  const tr = useT();
  const { t } = tr;
  const toast = useApp((st) => st.toast);
  const { services } = useNet();
  const [image, setImage] = useState<{ blob: Blob; url: string } | null>(null);
  const [showQr, setShowQr] = useState(false);
  const [busy, setBusy] = useState<ShareChannel | null>(null);
  const cup = kind === 'cup' ? cupName?.trim() || undefined : undefined;
  const ctx = { kind, id: matchId, url: inviteUrl, inviterAlias: inviter.alias, cupName: cup, pitch: conditions?.pitch, locale: shareLocale(tr.locale) } as const;
  const [available, setAvailable] = useState(() => momentAvailable('invite', ctx));

  useEffect(() => {
    let alive = true;
    let url: string | null = null;
    void cardBlob(inviteCardModel(tr, { inviter: playerOf(inviter), conditions, url: inviteUrl, cup: kind === 'cup' ? { name: cup ?? null } : undefined }), tr.locale).then((blob) => {
      if (!alive || !blob) return;
      url = URL.createObjectURL(blob);
      setImage({ blob, url });
    });
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inviteUrl, inviter.alias, tr.locale, kind, cup]);

  const share = async (via: ShareChannel) => {
    if (!services) return;
    setBusy(via);
    const channel = via === 'whatsapp' ? 'whatsapp' : 'share_sheet';
    services.analytics.track('share_initiated', { mode: kind === 'cup' ? 'cup' : 'duel', channel });
    const r = await shareMatchMoment(services.platform.share, 'invite', ctx, { via, t: tr, image: image?.blob ?? null });
    setBusy(null);
    if (r === 'shared' || r === 'opened' || r === 'copied') {
      services.analytics.track('share_completed', { mode: kind === 'cup' ? 'cup' : 'duel', channel });
      if (r === 'copied') toast({ kind: 'success', text: t('invite.copied') });
    } else if (r === 'failed') toast({ kind: 'warning', text: t('invite.share_failed') });
    setAvailable(momentAvailable('invite', ctx));
  };

  const copy = async () => {
    const ok = await copyText(inviteUrl);
    toast({ kind: ok ? 'success' : 'warning', text: ok ? t('invite.copied') : t('invite.copy_failed') });
    if (ok) services?.analytics.track('share_completed', { mode: kind === 'cup' ? 'cup' : 'duel', channel: 'copy' });
  };

  return (
    <Card className={s.panel} padding={4} data-testid="invite-panel">
      <div className={s.head}>
        {image ? <img className={s.preview} src={image.url} alt={t('invite.card_alt', { name: inviter.alias })} width={108} height={135} /> : <span className={s.previewBlank} aria-hidden="true" />}
        <div className={s.headText}>
          <h2 className={s.title}>{kind === 'cup' ? t('invite.panel_title_cup') : t('invite.panel_title')}</h2>
          <p className={s.body}>{kind === 'cup' ? t('invite.panel_body_cup') : t('invite.panel_body')}</p>
        </div>
      </div>
      {available ? (
        <div className={s.actions}>
          <Button variant="accent" size="lg" block icon="message" onClick={() => void share('whatsapp')} loading={busy === 'whatsapp'} data-testid="invite-whatsapp">
            {t('invite.whatsapp')}
          </Button>
          <Button variant="secondary" block icon="share" onClick={() => void share('sheet')} loading={busy === 'sheet'} data-testid="invite-share">
            {t('invite.more')}
          </Button>
        </div>
      ) : (
        <p className={s.sent} role="status" data-testid="invite-sent">
          <Icon name="check" size={18} /> {t('invite.sent')}
        </p>
      )}
      <div className={s.row}>
        <Button variant="ghost" icon="copy" onClick={() => void copy()} data-testid="invite-copy">
          {t('invite.copy')}
        </Button>
        <Button variant="ghost" icon="qr" aria-expanded={showQr} onClick={() => setShowQr((v) => !v)} data-testid="invite-qr">
          {showQr ? t('invite.qr_hide') : t('invite.qr')}
        </Button>
      </div>
      {showQr && (
        <div className={s.qr}>
          <QrCode value={inviteUrl} size={220} />
          <p className={s.small}>{t('invite.qr_hint')}</p>
        </div>
      )}
      <p className={s.small}>{t('invite.never_auto')}</p>
      {onPlan && (
        <Button variant="primary" size="lg" block iconEnd="forward" onClick={onPlan} data-testid="invite-plan">
          {planLabel ?? t('invite.plan_now')}
        </Button>
      )}
    </Card>
  );
}
