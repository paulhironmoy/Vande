import { useId, useState } from 'react';
import { useApp } from '@/app/store';
import { useT, type MessageKey } from '@/i18n';
import { Button, Card, Field, Icon } from '@/ui';
import { validateAlias } from '../onboarding/alias';
import s from './Prompts.module.css';

/** Shown when the server turned down the alias chosen offline: pick another, and the sign-up retries by itself. */
export function AliasFix() {
  const { t } = useT();
  const player = useApp((st) => st.player);
  const setPlayer = useApp((st) => st.setPlayer);
  const [alias, setAlias] = useState('');
  const [touched, setTouched] = useState(false);
  const id = useId();
  if (!player) return null;
  const problem = validateAlias(alias);
  const save = () => {
    setTouched(true);
    if (problem) return;
    setPlayer({ ...player, alias: alias.trim() });
  };
  return (
    <Card className={s.prompt} padding={4} data-testid="alias-fix">
      <h2 className={s.title}>
        <Icon name="user" size={20} /> {t('alias_fix.title')}
      </h2>
      <p className={s.body}>{t('alias_fix.body', { name: player.alias })}</p>
      <Field label={t('onboarding.alias_label')} description={touched && problem ? t(`onboarding.alias_error_${problem}` as MessageKey) : t('onboarding.alias_hint')} htmlFor={id}>
        <input id={id} value={alias} maxLength={24} autoComplete="nickname" onChange={(e) => setAlias(e.target.value)} onBlur={() => setTouched(true)} data-testid="alias-fix-input" />
      </Field>
      <Button variant="primary" onClick={save} data-testid="alias-fix-save">
        {t('common.save')}
      </Button>
    </Card>
  );
}
