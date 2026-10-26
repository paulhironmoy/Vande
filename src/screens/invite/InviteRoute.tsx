import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { InvitePreview } from '@/contracts';
import { useApp } from '@/app/store';
import type { LocalPlayer } from '@/app/storeTypes';
import { useRouter, type RouteOf } from '@/app/router';
import { isNativePlatform, playStoreUrl } from '@/platform';
import { useT, type MessageKey } from '@/i18n';
import { Avatar, Button, Card, Chip, Field, Icon, KITS, Logo, StateView, newAvatarSeed } from '@/ui';
import { syncAccount, useLoad, useNet, useNow } from '../app/hooks';
import { failureKind, type FailureKind } from '../app/errors';
import { untilText } from '../app/deadline';
import { savedInvite } from '../share/share';
import { validateAlias } from '../onboarding/alias';
import { LanguagePicker } from '../common/LanguagePicker';
import { LegalLink } from '../common/LegalLink';
import { AgeConfirm, AgeFields, useAgeQuestion } from '../onboarding/AgeQuestion';
import { ageAnswer, recordAge, type AgeAnswer } from '../onboarding/age';
import s from './InviteRoute.module.css';

/**
 * An invitation, playable in the browser with no install: a spoiler-free preview (who invited you, the conditions,
 * when the invite expires), on a first visit the neutral age question and a quick alias, then accept and play. Installing the app is
 * optional and secondary; the Play link carries the invite so the pending match survives the install.
 */
export default function InviteRoute({ route }: { route: RouteOf<'invite'> }) {
  const tr = useT();
  const { t } = tr;
  const navigate = useRouter((st) => st.navigate);
  const player = useApp((st) => st.player);
  const setPlayer = useApp((st) => st.setPlayer);
  const locale = useApp((st) => st.settings.locale);
  const online = useApp((st) => st.online);
  const { net, services, booting } = useNet();
  const now = useNow(60_000);
  const [alias, setAlias] = useState('');
  const [touched, setTouched] = useState(false);
  const [seed, setSeed] = useState(() => newAvatarSeed());
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<FailureKind | 'alias' | null>(null);
  const aliasId = useId();
  const opened = useRef(false);
  // First visit: the same neutral age question as onboarding (only its outcome is stored, before the account sync).
  const [age, setAge] = useState<AgeAnswer | null>(() => ageAnswer());
  const ageQ = useAgeQuestion();
  // The answer waits for one neutral "Is that right?", whichever way it goes (a mistyped year must not lock anyone out).
  const [agePending, setAgePending] = useState<AgeAnswer | null>(null);
  const ageEdit = (set: (v: string) => void) => (v: string) => {
    setAgePending(null);
    set(v);
  };
  const ageEditing = { ...ageQ, setYear: ageEdit(ageQ.setYear), setMonth: ageEdit(ageQ.setMonth), setDay: ageEdit(ageQ.setDay) };

  const preview = useLoad<InvitePreview>(net ? () => net.api.call('GET /v1/invites/:token', { params: { token: route.token } }) : null, [net, route.token]);
  const mine = useMemo(() => savedInvite({ token: route.token }), [route.token]);

  useEffect(() => {
    if (!preview.data || opened.current) return;
    opened.current = true;
    services?.analytics.track('invite_opened', { mode: preview.data.kind === 'cup' ? 'cup' : 'duel', ...(route.attribution ? { attribution: route.attribution } : {}) });
  }, [preview.data, services, route.attribution]);

  const problem = player ? null : validateAlias(alias);

  const accept = async () => {
    if (!net) return;
    if (!player && age === null) {
      const answer = ageQ.check();
      if (answer) setAgePending(answer);
      return;
    }
    await join();
  };

  /** Only "Yes" keeps the answer; an adult goes straight on to join. */
  const confirmAge = () => {
    if (!agePending) return;
    recordAge(agePending);
    setAge(agePending);
    setAgePending(null);
    if (agePending === 'adult') void join();
  };

  const join = async () => {
    if (!net) return;
    setTouched(true);
    if (problem) return;
    setBusy(true);
    setFailure(null);
    let me: LocalPlayer | null = player;
    if (!me) me = { id: null, alias: alias.trim(), avatar: { seed }, kit: KITS[0] };
    if (!me.id) {
      const r = await syncAccount(net, me, locale);
      if ('error' in r) {
        setBusy(false);
        setFailure(r.error === 'alias_rejected' ? 'alias' : r.error === 'offline' ? 'offline' : 'error');
        if (!player) setPlayer(me);
        return;
      }
      me = { ...me, id: r.id };
    }
    setPlayer(me);
    try {
      const r = await net.api.call('POST /v1/invites/:token/accept', { params: { token: route.token } });
      services?.analytics.track('invite_accepted', { mode: r.cupId ? 'cup' : 'duel', ...(route.attribution ? { attribution: route.attribution } : {}) });
      if (r.matchId) navigate({ name: 'match', matchId: r.matchId }, { replace: true });
      else if (r.cupId) navigate({ name: 'cup', cupId: r.cupId }, { replace: true });
      else navigate({ name: 'home' }, { replace: true });
    } catch (e) {
      setFailure(failureKind(e));
    } finally {
      setBusy(false);
    }
  };

  const main = (() => {
    if (booting) return <StateView kind="loading" />;
    if (!net) return <StateView kind="offline" title={t('invite.needs_online_title')} body={t('invite.needs_online_body')} actionLabel={t('home.ghosts.title')} onAction={() => navigate({ name: 'ghosts' })} />;
    if (preview.loading && !preview.data) return <StateView kind="loading" title={t('invite.loading')} />;
    if (preview.error && !preview.data) {
      const k = failureKind(preview.error);
      if (k === 'offline') return <StateView kind="offline" body={t('invite.offline_body')} onAction={preview.reload} />;
      if (k === 'not_found' || k === 'expired')
        return (
          // An unknown code and an expired one answer alike (410), so codes cannot be enumerated: one honest message.
          <StateView kind="deadline_expired" title={t('invite.gone_title')} body={t('invite.expired_body')} actionLabel={t('invite.practice')} onAction={() => navigate(player ? { name: 'ghosts' } : { name: 'onboarding' })} />
        );
      return <StateView kind="error" onAction={preview.reload} />;
    }
    // Not loaded yet (the services can arrive a render before the request starts): still loading, never a crash.
    const p = preview.data;
    if (!p) return <StateView kind="loading" title={t('invite.loading')} />;
    const expires = untilText(tr, p.expiresAt, now);
    return (
      <>
        <Card className={s.card} padding={5} data-testid="invite-preview">
          <span className={s.glow} aria-hidden="true" />
          <p className={s.eyebrow}>{p.kind === 'cup' ? t('invite.cup_eyebrow') : t('invite.duel_eyebrow')}</p>
          <h1 className={s.h1}>{p.kind === 'cup' ? t('invite.cup_title', { name: p.inviterAlias, cup: p.cupName ?? '' }) : t('invite.duel_title', { name: p.inviterAlias })}</h1>
          <div className={s.chips}>
            {p.conditions && (
              <>
                <Chip tone="clay" icon="field">
                  {t(`pitch.${p.conditions.pitch}` as MessageKey)}
                </Chip>
                <Chip tone="cyan" icon="sparkle">
                  {t(`weather.${p.conditions.weather}` as MessageKey)}
                </Chip>
              </>
            )}
            {p.members !== undefined && <Chip icon="users">{t('invite.members', { count: p.members })}</Chip>}
            {expires && (
              <Chip tone="amber" icon="clock">
                {t('invite.expires', { when: expires })}
              </Chip>
            )}
          </div>
          <ol className={s.steps}>
            <li>
              <span className={s.n}>1</span>
              <span>
                <strong>{t('invite.step1_title')}</strong> {t('invite.step1_body')}
              </span>
            </li>
            <li>
              <span className={s.n}>2</span>
              <span>
                <strong>{t('invite.step2_title')}</strong> {t('invite.step2_body')}
              </span>
            </li>
            <li>
              <span className={s.n}>3</span>
              <span>
                <strong>{t('invite.step3_title')}</strong> {p.kind === 'cup' ? t('invite.step3_body_cup') : t('invite.step3_body')}
              </span>
            </li>
          </ol>
        </Card>

        {!player && age === 'under' ? (
          <section className={s.join} aria-labelledby="invite-age-stop" data-testid="invite-age-stop">
            <h2 id="invite-age-stop" className={s.h2}>
              {t('age.stop_title')}
            </h2>
            <p className={s.small}>{t('age.stop_body')}</p>
          </section>
        ) : mine && failure === 'forbidden' ? (
          <StateView kind="pending_opponent" title={t('invite.own_title')} body={t('invite.own_body')} actionLabel={t('invite.open_match')} onAction={() => navigate({ name: 'match', matchId: mine.matchId })} />
        ) : (
          <section className={s.join} aria-labelledby="invite-join">
            <h2 id="invite-join" className={s.h2}>
              {player ? t('invite.join_as', { name: player.alias }) : t('invite.quick_title')}
            </h2>
            {player ? (
              <div className={s.me}>
                <Avatar avatar={player.avatar} kit={player.kit} size={56} decorative />
                <span className={s.meName}>{player.alias}</span>
              </div>
            ) : (
              <div className={s.quick}>
                {age === null && <AgeFields q={ageEditing} testId="invite-age" />}
                {age === null && agePending && <AgeConfirm q={ageQ} onYes={confirmAge} onChange={() => setAgePending(null)} testId="invite-age" />}
                <div className={s.quickRow}>
                  <Avatar avatar={{ seed }} kit={KITS[0]} size={72} label={t('onboarding.avatar_label')} />
                  <Button variant="secondary" icon="shuffle" onClick={() => setSeed(newAvatarSeed())}>
                    {t('onboarding.avatar_shuffle')}
                  </Button>
                </div>
                <Field label={t('onboarding.alias_label')} description={touched && problem ? t(`onboarding.alias_error_${problem}` as MessageKey) : t('onboarding.alias_hint')} htmlFor={aliasId}>
                  <input id={aliasId} value={alias} maxLength={24} autoComplete="nickname" autoCapitalize="words" onChange={(e) => setAlias(e.target.value)} onBlur={() => setTouched(true)} placeholder={t('onboarding.alias_placeholder')} data-testid="invite-alias" aria-invalid={Boolean(touched && problem)} />
                </Field>
                <p className={s.small}>{t('onboarding.privacy')}</p>
              </div>
            )}
            {failure && (
              <p className={s.error} role="alert">
                <Icon name="alert" size={16} />
                {failure === 'alias'
                  ? t('onboarding.alias_taken')
                  : failure === 'offline'
                    ? t('invite.accept_offline')
                    : failure === 'expired'
                      ? t('invite.expired_title')
                      : failure === 'conflict'
                        ? t('invite.taken')
                        : failure === 'forbidden'
                          ? t('invite.forbidden')
                          : t('state.error.body')}
              </p>
            )}
            {!agePending && <Button variant="accent" size="xl" block iconEnd="forward" loading={busy} disabled={!online} onClick={() => void accept()} data-testid="invite-accept">
              {t('invite.accept')}
            </Button>}
            {!isNativePlatform() && (
              <a className={s.install} href={playStoreUrl({ token: route.token, attribution: route.attribution ?? null })} target="_blank" rel="noopener noreferrer" data-testid="invite-install">
                {t('invite.install')} <Icon name="external" size={14} />
              </a>
            )}
          </section>
        )}
      </>
    );
  })();

  return (
    <main className={s.screen} data-testid="invite-screen">
      <header className={s.top}>
        <Logo size={30} wordmark title={t('brand.name')} />
        <LanguagePicker compact testId="invite-language" />
      </header>
      {main}
      <footer className={s.footer}>
        <LegalLink page="privacy" className={s.legal} testId="invite-privacy">
          {t('legal.privacy_policy')}
        </LegalLink>
      </footer>
    </main>
  );
}
