import { useState } from 'react';
import type { PushAdapter } from '@/contracts';
import type { Net } from '@/net';
import { useT } from '@/i18n';
import { Button, Card, Icon } from '@/ui';
import s from './Prompts.module.css';

const ASKED = 'vc:push-asked';

export function pushAsked(): boolean {
  try {
    return localStorage.getItem(ASKED) === '1';
  } catch {
    return true;
  }
}
function markAsked() {
  try {
    localStorage.setItem(ASKED, '1');
  } catch {
    /* storage unavailable */
  }
}

/**
 * Notifications are offered once, after the first locked duel (the meaningful moment), never on first launch and
 * never mid-play. Two equal choices; "Not now" is final until the player changes it in Settings.
 */
export function PushPrompt({ push, net, opponent }: { push: PushAdapter; net: Net | null; opponent: string | null }) {
  const { t } = useT();
  const [state, setState] = useState<'ask' | 'busy' | 'on' | 'off' | 'hidden'>(() => (push.available() && !pushAsked() ? 'ask' : 'hidden'));
  if (state === 'hidden') return null;
  if (state === 'on' || state === 'off')
    return (
      <p className={s.thanks} role="status">
        <Icon name={state === 'on' ? 'bell' : 'bell-off'} size={16} /> {state === 'on' ? t('push.on') : t('push.off')}
      </p>
    );
  const enable = async () => {
    setState('busy');
    markAsked();
    try {
      const reg = await push.register();
      if (reg && net) await net.api.call('POST /v1/push/register', { body: reg });
      setState(reg ? 'on' : 'off');
    } catch {
      setState('off');
    }
  };
  return (
    <Card className={s.prompt} padding={4} data-testid="push-prompt">
      <h2 className={s.title}>
        <Icon name="bell" size={20} /> {t('push.title')}
      </h2>
      <p className={s.body}>{opponent ? t('push.body', { name: opponent }) : t('push.body_generic')}</p>
      <div className={s.choices}>
        <Button variant="secondary" block loading={state === 'busy'} onClick={() => void enable()} data-testid="push-accept">
          {t('push.yes')}
        </Button>
        <Button
          variant="secondary"
          block
          disabled={state === 'busy'}
          onClick={() => {
            markAsked();
            setState('off');
          }}
          data-testid="push-decline"
        >
          {t('push.no')}
        </Button>
      </div>
    </Card>
  );
}
