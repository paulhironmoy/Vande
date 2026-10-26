import { useState } from 'react';
import { useT, type MessageKey } from '@/i18n';
import { Button, Icon, Sheet } from '@/ui';
import type { RecoveryFailure, RecoveryMethod } from './recover';
import s from './RecoverAccount.module.css';

export interface RecoverAccountProps {
  /** The sign-in methods this build offers (the entry is not rendered without one). */
  methods: RecoveryMethod[];
  /** Runs one method; resolves with the failure, or null once the account is back (the caller moves on). */
  recover: (method: RecoveryMethod) => Promise<RecoveryFailure | null>;
}

/** "Already played? Recover your account": a secondary entry on the start screen, and the sheet that runs it. */
export function RecoverAccount({ methods, recover }: RecoverAccountProps) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<RecoveryMethod | null>(null);
  const [failure, setFailure] = useState<RecoveryFailure | null>(null);
  if (methods.length === 0) return null;

  const run = async (method: RecoveryMethod) => {
    setFailure(null);
    setBusy(method);
    const r = await recover(method);
    setBusy(null);
    setFailure(r);
  };

  return (
    <>
      <Button
        variant="ghost"
        block
        onClick={() => {
          setFailure(null);
          setOpen(true);
        }}
        data-testid="onboarding-recover"
      >
        {t('onboarding.recover')}
      </Button>
      <Sheet open={open} onClose={() => setOpen(false)} title={t('onboarding.recover_title')} testId="recover-sheet">
        <div className={s.body}>
          <p className={s.lead}>{t('onboarding.recover_body')}</p>
          <div className={s.methods}>
            {methods.includes('google') && (
              <Button variant="primary" size="lg" block icon="user" loading={busy === 'google'} disabled={busy !== null && busy !== 'google'} onClick={() => void run('google')} data-testid="recover-google">
                {t('onboarding.recover_google')}
              </Button>
            )}
            {methods.includes('passkey') && (
              <Button variant="secondary" size="lg" block icon="lock" loading={busy === 'passkey'} disabled={busy !== null && busy !== 'passkey'} onClick={() => void run('passkey')} data-testid="recover-passkey">
                {t('onboarding.recover_passkey')}
              </Button>
            )}
          </div>
          {failure && (
            <p className={failure === 'cancelled' ? s.note : s.problem} role={failure === 'cancelled' ? 'status' : 'alert'} data-testid="recover-result" data-reason={failure}>
              <Icon name={failure === 'offline' ? 'offline' : failure === 'cancelled' ? 'info' : 'alert'} size={18} />
              <span>{t(`onboarding.recover_${failure}` as MessageKey)}</span>
            </p>
          )}
          <p className={s.small}>{t('onboarding.recover_guest_note')}</p>
        </div>
      </Sheet>
    </>
  );
}
