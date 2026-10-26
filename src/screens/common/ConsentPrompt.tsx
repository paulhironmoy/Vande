import { useState } from 'react';
import type { Analytics } from '@/analytics';
import { useT } from '@/i18n';
import { Button, Card, Icon } from '@/ui';
import s from './Prompts.module.css';

/**
 * Asked once, after the tutorial, never blocking: two equal choices, and declining changes nothing in the game.
 * Shown only when this build has an analytics provider configured.
 */
export function ConsentPrompt({ analytics, configured }: { analytics: Pick<Analytics, 'consent' | 'setConsent'>; configured: boolean }) {
  const { t } = useT();
  const [answered, setAnswered] = useState<'granted' | 'denied' | null>(null);
  if (!configured || (analytics.consent() !== 'unset' && answered === null)) return null;
  if (answered)
    return (
      <p className={s.thanks} role="status">
        <Icon name="check" size={16} /> {answered === 'granted' ? t('consent.thanks_yes') : t('consent.thanks_no')}
      </p>
    );
  const choose = (c: 'granted' | 'denied') => {
    analytics.setConsent(c);
    setAnswered(c);
  };
  return (
    <Card className={s.prompt} padding={4} data-testid="consent-prompt">
      <h2 className={s.title}>
        <Icon name="shield" size={20} /> {t('consent.title')}
      </h2>
      <p className={s.body}>{t('consent.body')}</p>
      <div className={s.choices}>
        <Button variant="secondary" block onClick={() => choose('granted')} data-testid="consent-accept">
          {t('consent.yes')}
        </Button>
        <Button variant="secondary" block onClick={() => choose('denied')} data-testid="consent-decline">
          {t('consent.no')}
        </Button>
      </div>
      <p className={s.small}>{t('consent.later')}</p>
    </Card>
  );
}
