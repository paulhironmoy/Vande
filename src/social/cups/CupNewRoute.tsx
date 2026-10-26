import { useId, useState } from 'react';
import type { CreateCupResponse } from '@/contracts';
import { useRouter, type RouteOf } from '@/app/router';
import { localPlayerRef } from '@/app/storeTypes';
import { checkGroupName } from '@/net/shared/alias';
import { InvitePanel } from '@/screens/share/InvitePanel';
import { Button, Card, Field, IconButton, ScreenShell, SegmentedControl, StateView } from '@/ui';
import { useAccount, useAction, usePlayerGate, useSocialServices } from '../hooks';
import { useSocialT } from '../i18n';
import { NeedsOnline } from '../components/States';
import { MAX_CUP_PLAYERS, MIN_CUP_PLAYERS, PACE_RULES, PACES, type CupPace } from './cupModel';
import s from '../components/social.module.css';

/** Create a Group Cup (name, 3–10 players, a pace), then share the invite: WhatsApp first, nothing sent by itself. */
export default function CupNewRoute({ route }: { route: RouteOf<'cup_new'> }) {
  const player = usePlayerGate(route);
  const tr = useSocialT();
  const { t } = tr;
  const back = useRouter((st) => st.back);
  const navigate = useRouter((st) => st.navigate);
  const { net, services, booting } = useSocialServices();
  const account = useAccount(net, player);
  const [name, setName] = useState('');
  const [size, setSize] = useState(6);
  const [pace, setPace] = useState<CupPace>('daily');
  const [touched, setTouched] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreateCupResponse | null>(null);
  const action = useAction();
  const nameId = useId();
  const errorId = useId();
  if (!player) return null;

  const check = checkGroupName(name);
  const nameError = touched && !check.ok ? t(`social.cup_new.name_${check.reason}` as 'social.cup_new.name_length') : serverError;

  const create = async () => {
    setTouched(true);
    setServerError(null);
    if (!net || !check.ok) return;
    const r = await action.run(() => net.api.call('POST /v1/cups', { body: { name: check.value, maxPlayers: size, pace } }));
    if (r.ok) {
      setCreated(r.value);
      services?.analytics.track('invite_created', { mode: 'cup' });
    } else if (r.failure === 'invalid') setServerError(t('social.cup_new.name_offensive'));
    else if (r.failure === 'offline') setServerError(t('social.state.offline_body'));
    else if (r.failure === 'rate_limited') setServerError(t('social.state.busy_body'));
    else setServerError(t('social.cup_new.failed'));
  };

  const shell = (children: React.ReactNode, footer?: React.ReactNode) => (
    <ScreenShell title={t('social.cup_new.title')} eyebrow={t('social.cup_new.eyebrow')} onBack={back} narrow testId="cup-new-screen" footer={footer}>
      {children}
    </ScreenShell>
  );

  if (booting) return shell(<StateView kind="loading" />);
  if (!net) return shell(<NeedsOnline actionLabel={t('social.common.home')} onAction={() => navigate({ name: 'home' })} />);

  if (created) {
    return shell(
      <div className={s.stack}>
        <Card padding={5} className={s.stackSm} data-testid="cup-created">
          <p className={s.eyebrow}>{t('social.cup_new.created_eyebrow')}</p>
          <h2 className={s.h2}>{t('social.cup_new.created_title', { name: check.ok ? check.value : name })}</h2>
          <p className={s.body}>{t('social.cup_new.created_body', { min: MIN_CUP_PLAYERS })}</p>
        </Card>
        <InvitePanel kind="cup" matchId={created.cupId} inviteUrl={created.inviteUrl} inviter={localPlayerRef(player)} conditions={null} cupName={check.ok ? check.value : name} />
      </div>,
      <Button variant="accent" size="xl" block icon="cup" onClick={() => navigate({ name: 'cup', cupId: created.cupId }, { replace: true })} data-testid="cup-open">
        {t('social.cup_new.open')}
      </Button>,
    );
  }

  const rules = PACE_RULES[pace];
  return shell(
    <form
      className={s.stack}
      onSubmit={(e) => {
        e.preventDefault();
        void create();
      }}
      noValidate
    >
      <p className={s.body}>{t('social.cup_new.intro')}</p>
      <Field label={t('social.cup_new.name_label')} description={t('social.cup_new.name_hint')} htmlFor={nameId}>
        <input
          id={nameId}
          type="text"
          value={name}
          maxLength={40}
          autoComplete="off"
          autoCapitalize="words"
          enterKeyHint="done"
          placeholder={t('social.cup_new.name_placeholder')}
          onChange={(e) => {
            setName(e.target.value);
            setServerError(null);
          }}
          onBlur={() => setTouched(true)}
          aria-invalid={Boolean(nameError)}
          aria-describedby={nameError ? errorId : undefined}
          data-testid="cup-name"
        />
      </Field>
      {nameError && (
        <p id={errorId} className={s.error} role="alert">
          {nameError}
        </p>
      )}
      <div className={s.section} role="group" aria-labelledby={`${nameId}-size`}>
        <h2 className={s.h3} id={`${nameId}-size`}>
          {t('social.cup_new.size_label')}
        </h2>
        <div className={s.row}>
          <IconButton icon="minus" label={t('social.cup_new.size_less')} variant="secondary" disabled={size <= MIN_CUP_PLAYERS} onClick={() => setSize((n) => Math.max(MIN_CUP_PLAYERS, n - 1))} />
          <output className={s.rank} aria-live="polite" data-testid="cup-size">
            {tr.number(size)}
          </output>
          <IconButton icon="plus" label={t('social.cup_new.size_more')} variant="secondary" disabled={size >= MAX_CUP_PLAYERS} onClick={() => setSize((n) => Math.min(MAX_CUP_PLAYERS, n + 1))} />
        </div>
        <p className={s.small}>{t('social.cup_new.size_hint', { min: MIN_CUP_PLAYERS, max: MAX_CUP_PLAYERS })}</p>
      </div>
      <div className={s.section}>
        <SegmentedControl
          label={t('social.cup_new.pace_label')}
          options={PACES.map((p) => ({ value: p, label: t(`social.cup_new.pace_${p}` as 'social.cup_new.pace_daily') }))}
          value={pace}
          onChange={setPace}
          block
          testId="cup-pace"
        />
        <p className={s.small} aria-live="polite">
          {t('social.cup_new.pace_rules', { gather: rules.gatherHours, lock: rules.lockHours, bat: rules.batHours })}
        </p>
      </div>
      <Card variant="sunken" padding={4} className={s.stackSm}>
        <h2 className={s.h3}>{t('social.cup_new.how_title')}</h2>
        <ul className={s.list}>
          <li className={s.body}>{t('social.cup_new.how_start', { min: MIN_CUP_PLAYERS })}</li>
          <li className={s.body}>{t('social.cup_new.how_auto')}</li>
          <li className={s.body}>{t('social.cup_new.how_final')}</li>
        </ul>
      </Card>
      {account.state === 'alias_rejected' && <p className={s.error}>{t('social.state.alias_rejected')}</p>}
      {account.state === 'age_required' && <p className={s.error}>{t('social.state.age_body')}</p>}
      <Button type="submit" variant="accent" size="xl" block icon="cup" loading={action.busy} disabled={account.state === 'syncing' || account.state === 'age_required'} data-testid="cup-create">
        {t('social.cup_new.create')}
      </Button>
    </form>,
  );
}
