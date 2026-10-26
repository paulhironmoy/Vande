import { useEffect, useId, useRef, useState } from 'react';
import type { KitSpec, Profile } from '@/contracts';
import { useApp } from '@/app/store';
import { useRouter, type RouteOf } from '@/app/router';
import { checkAlias } from '@/net/shared/alias';
import { CITY_IDS } from '@/net/shared/cities';
import { Avatar, Button, Card, Chip, Field, KITS, ScreenShell, StateView, Switch, newAvatarSeed } from '@/ui';
import { socialFailure, useAccount, useAction, usePlayerGate, useResource, useSocialServices } from '../hooks';
import { useSocialT } from '../i18n';
import { FailureState, NeedsOnline } from '../components/States';
import s from '../components/social.module.css';

const ALIAS_MAX = 16;
const sameKit = (a: KitSpec, b: KitSpec) => a.primary === b.primary && a.secondary === b.secondary && a.pattern === b.pattern;

/** My profile: alias, generated avatar and kit, badges (YouTube Top 100 included), rating, groups, city, 18+ and Google. */
export default function ProfileRoute({ route }: { route: RouteOf<'profile'> }) {
  const player = usePlayerGate(route);
  const tr = useSocialT();
  const { t } = tr;
  const back = useRouter((st) => st.back);
  const navigate = useRouter((st) => st.navigate);
  const setPlayer = useApp((st) => st.setPlayer);
  const toast = useApp((st) => st.toast);
  const { net, services, booting } = useSocialServices();
  const account = useAccount(net, player);
  const ready = Boolean(net && account.state === 'ok');
  const me = useResource<Profile>(ready && net ? () => net.api.call('GET /v1/me') : null, [ready]);
  const [alias, setAlias] = useState(player?.alias ?? '');
  const [seed, setSeed] = useState(player?.avatar.seed ?? newAvatarSeed());
  const [kit, setKit] = useState<KitSpec>(player?.kit ?? KITS[0]);
  const [aliasError, setAliasError] = useState<string | null>(null);
  const [googleReady, setGoogleReady] = useState(false);
  // Once the player edits the form, a later copy of the profile (a reload, a city change) never overwrites the edit.
  const edited = useRef(false);
  const action = useAction();
  const aliasId = useId();
  const cityId = useId();

  useEffect(() => {
    if (!me.data || edited.current) return;
    setAlias(me.data.alias);
    setSeed(me.data.avatar.seed);
    setKit(me.data.kit);
  }, [me.data]);
  useEffect(() => {
    setGoogleReady(Boolean(services?.platform.identity.google.available()));
  }, [services]);
  if (!player) return null;

  const shell = (children: React.ReactNode) => (
    <ScreenShell title={t('social.profile.title')} onBack={back} narrow testId="profile-screen">
      {children}
    </ScreenShell>
  );

  if (booting || (net && (account.state === 'idle' || account.state === 'syncing') && !me.data)) return shell(<StateView kind="loading" />);
  if (!net) return shell(<NeedsOnline actionLabel={t('social.common.home')} onAction={() => navigate({ name: 'home' })} />);
  if (account.state === 'offline' || account.state === 'error' || account.state === 'age_required') return shell(<FailureState failure={account.state} onRetry={account.retry} />);
  const p = me.data;
  if (!p) return shell(me.error ? <FailureState failure={socialFailure(me.error)} onRetry={me.reload} /> : <StateView kind="loading" />);

  const dirty = alias.trim() !== p.alias || seed !== p.avatar.seed || !sameKit(kit, p.kit);
  const save = async () => {
    const check = checkAlias(alias);
    if (!check.ok || [...check.value].length > ALIAS_MAX) {
      setAliasError(t(`social.profile.alias_${check.ok ? 'length' : check.reason}` as 'social.profile.alias_length', { max: ALIAS_MAX }));
      return;
    }
    setAliasError(null);
    const r = await action.run(() =>
      net.api.call('PATCH /v1/me', {
        body: { alias: check.value, avatar: { seed }, kit },
      })
    );
    if (r.ok) {
      // Saved: the form shows the server's canonical values again.
      edited.current = false;
      me.set(r.value);
      setPlayer({
        ...player,
        id: r.value.playerId,
        alias: r.value.alias,
        avatar: r.value.avatar,
        kit: r.value.kit,
      });
      toast({ kind: 'success', text: t('social.profile.saved') });
    } else if (r.failure === 'invalid') setAliasError(t('social.profile.alias_offensive', { max: ALIAS_MAX }));
    else
      toast({
        kind: 'warning',
        text: r.failure === 'offline' ? t('social.state.offline_body') : t('social.profile.save_failed'),
      });
  };
  const patch = async (body: { city?: string | null; adultConfirmed?: boolean }) => {
    const r = await action.run(() => net.api.call('PATCH /v1/me', { body: body as never }));
    if (r.ok) me.set(r.value);
    else
      toast({
        kind: 'warning',
        text: r.failure === 'offline' ? t('social.state.offline_body') : t('social.profile.save_failed'),
      });
  };
  const linkGoogle = async () => {
    const idToken = await services?.platform.identity.google.obtainCredential().catch(() => null);
    if (!idToken) return;
    const r = await action.run(() => net.api.call('POST /v1/auth/link/google', { body: { idToken } }));
    if (r.ok) {
      toast({ kind: 'success', text: t('social.profile.google_linked') });
      me.reload();
    } else
      toast({
        kind: 'warning',
        text: r.failure === 'conflict' ? t('social.profile.google_taken') : t('social.profile.google_failed'),
      });
  };

  return shell(
    <div className={s.stack}>
      <Card padding={5} className={s.stackSm}>
        <div className={s.player}>
          <Avatar avatar={{ seed }} kit={kit} size={88} label={t('social.profile.avatar_label', { name: alias || p.alias })} />
          <div className={s.playerText}>
            <span className={s.alias}>{p.alias}</span>
            <span className={s.meta}>
              {t('social.profile.rating', {
                rating: tr.number(Math.round(p.rating)),
              })}
            </span>
          </div>
        </div>
        <Button
          variant="secondary"
          icon="shuffle"
          onClick={() => {
            edited.current = true;
            setSeed(newAvatarSeed());
          }}
          data-testid="profile-new-look"
        >
          {t('social.profile.new_look')}
        </Button>
      </Card>
      <section className={s.section} aria-labelledby="profile-edit">
        <h2 className={s.h2} id="profile-edit">
          {t('social.profile.edit')}
        </h2>
        <Field label={t('social.profile.alias')} description={t('social.profile.alias_hint', { max: ALIAS_MAX })} htmlFor={aliasId}>
          <input
            id={aliasId}
            type="text"
            value={alias}
            maxLength={ALIAS_MAX + 4}
            autoComplete="nickname"
            onChange={(e) => {
              edited.current = true;
              setAlias(e.target.value);
              setAliasError(null);
            }}
            aria-invalid={Boolean(aliasError)}
            data-testid="profile-alias"
          />
        </Field>
        {aliasError && (
          <p className={s.error} role="alert">
            {aliasError}
          </p>
        )}
        <div role="radiogroup" aria-label={t('social.profile.kit')} className={s.kitRow}>
          {KITS.map((k, i) => (
            <button
              key={`${k.primary}-${k.pattern}`}
              type="button"
              role="radio"
              aria-checked={sameKit(k, kit)}
              aria-label={t('social.profile.kit_option', {
                n: i + 1,
                pattern: t(`social.profile.pattern_${k.pattern}` as 'social.profile.pattern_plain'),
              })}
              className={s.kit}
              style={{
                background: `linear-gradient(135deg, ${k.primary} 0 55%, ${k.secondary} 55% 100%)`,
              }}
              onClick={() => {
                edited.current = true;
                setKit(k);
              }}
            />
          ))}
        </div>
        <Button variant="primary" size="lg" block disabled={!dirty} loading={action.busy} onClick={() => void save()} data-testid="profile-save">
          {t('social.profile.save')}
        </Button>
      </section>
      <section className={s.section} aria-labelledby="profile-badges">
        <h2 className={s.h2} id="profile-badges">
          {t('social.profile.badges')}
        </h2>
        {p.badges.length === 0 ? (
          <p className={s.small}>{t('social.profile.no_badges')}</p>
        ) : (
          <ul className={s.list} data-testid="profile-badges">
            {p.badges.map((b) => (
              <Card as="li" key={b} padding={3} className={s.stackSm}>
                <div className={s.row}>
                  <Chip tone="amber" icon={b === 'youtube_top100' ? 'crown' : 'trophy'} solid>
                    {tr.tk(`social.badge.${b}`, undefined, b)}
                  </Chip>
                </div>
                <p className={s.small}>{tr.tk(`social.badge.${b}_about`, undefined, '')}</p>
              </Card>
            ))}
          </ul>
        )}
        <Button variant="ghost" iconEnd="forward" onClick={() => navigate({ name: 'highlights' })}>
          {t('social.profile.highlights')}
        </Button>
      </section>
      <section className={s.section} aria-labelledby="profile-groups">
        <h2 className={s.h2} id="profile-groups">
          {t('social.profile.groups')}
        </h2>
        {p.groups.length === 0 ? (
          <p className={s.small}>{t('social.profile.no_groups')}</p>
        ) : (
          <ul className={s.list}>
            {p.groups.map((g) => (
              <li key={g.groupId} className={s.spread}>
                <span className={s.alias}>{g.name}</span>
                <Chip>{t(g.kind === 'college' ? 'social.board.scope_college' : 'social.board.scope_company')}</Chip>
              </li>
            ))}
          </ul>
        )}
        <Button variant="ghost" iconEnd="forward" onClick={() => navigate({ name: 'leaderboards', scope: 'college' })}>
          {t('social.profile.join_group')}
        </Button>
      </section>
      <section className={s.section} aria-labelledby="profile-privacy">
        <h2 className={s.h2} id="profile-privacy">
          {t('social.profile.about_you')}
        </h2>
        <Field label={t('social.profile.city')} description={t('social.profile.city_hint')} htmlFor={cityId}>
          <select id={cityId} className={s.select} value={p.city ?? ''} onChange={(e) => void patch({ city: e.target.value || null })} data-testid="profile-city">
            <option value="">{t('social.profile.city_none')}</option>
            {CITY_IDS.map((c) => (
              <option key={c} value={c}>
                {tr.city(c)}
              </option>
            ))}
          </select>
        </Field>
        {p.adultConfirmed ? (
          // 18+ only: confirmed at sign-up and never switched off here (leaving means deleting the account).
          <p className={s.body} data-testid="profile-adult-confirmed">
            {t('social.profile.adult_confirmed')}
          </p>
        ) : (
          <Field label={t('social.profile.adult')} description={t('social.profile.adult_hint')} inline>
            <Switch checked={false} onChange={(v) => v && void patch({ adultConfirmed: true })} label={t('social.profile.adult')} data-testid="profile-adult" />
          </Field>
        )}
        {googleReady &&
          (p.linked.google ? (
            <p className={s.body}>{t('social.profile.google_on')}</p>
          ) : (
            <Button variant="secondary" icon="shield" loading={action.busy} onClick={() => void linkGoogle()} data-testid="profile-google">
              {t('social.profile.google_link')}
            </Button>
          ))}
        <p className={s.small}>{t('social.profile.google_hint')}</p>
        <Button variant="ghost" icon="settings" onClick={() => navigate({ name: 'settings' })}>
          {t('social.profile.settings')}
        </Button>
      </section>
    </div>
  );
}
