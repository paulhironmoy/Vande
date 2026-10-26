import { useState } from 'react';
import type { Conditions, CreateDuelResponse, PitchId, WeatherId } from '@/contracts';
import { useApp } from '@/app/store';
import { localPlayerRef } from '@/app/storeTypes';
import { useRouter, type RouteOf } from '@/app/router';
import { useT, type MessageKey } from '@/i18n';
import { Button, CardButton, Icon, ScreenShell, SegmentedControl, StateView } from '@/ui';
import { useAccountSync, useNet, usePlayerGate } from '../app/hooks';
import { failureKind } from '../app/errors';
import { InvitePanel } from '../share/InvitePanel';
import { AliasFix } from '../common/AliasFix';
import { saveInvite } from '../share/share';
import s from './DuelNewRoute.module.css';

const PITCHES: PitchId[] = ['green', 'hard', 'slow'];
const WEATHERS: WeatherId[] = ['clear', 'humid', 'dew'];

/** Create a Friend Duel: pick the conditions (or leave them to chance), then invite one friend. */
export default function DuelNewRoute({ route }: { route: RouteOf<'duel_new'> }) {
  const player = usePlayerGate(route);
  const { t } = useT();
  const navigate = useRouter((st) => st.navigate);
  const back = useRouter((st) => st.back);
  const online = useApp((st) => st.online);
  const { net, services, booting } = useNet();
  const sync = useAccountSync();
  const [pitch, setPitch] = useState<PitchId | null>(null);
  const [weather, setWeather] = useState<WeatherId>('clear');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<(CreateDuelResponse & { conditions: Conditions | null }) | null>(null);
  // A duel started from a highlight's "Can you beat them?" carries its attribution code (/duel?a=<code>).
  const attribution = route.attribution ?? null;

  if (!player) return null;
  const me = localPlayerRef(player);

  const create = async () => {
    if (!net) return;
    setBusy(true);
    setError(null);
    const conditions: Conditions | undefined = pitch ? { pitch, weather } : undefined;
    try {
      const r = await net.api.call('POST /v1/duels', { body: { ...(conditions ? { conditions } : {}), ...(attribution ? { attributionCode: attribution } : {}) } });
      saveInvite({ matchId: r.matchId, inviteToken: r.inviteToken, inviteUrl: r.inviteUrl });
      services?.analytics.track('invite_created', { mode: 'duel', ...(attribution ? { attribution } : {}) });
      setCreated({ ...r, conditions: conditions ?? null });
    } catch (e) {
      const k = failureKind(e);
      setError(k === 'offline' ? t('duel.error_offline') : k === 'rate_limited' ? t('duel.error_rate') : t('duel.error'));
    } finally {
      setBusy(false);
    }
  };

  const body = (() => {
    if (booting) return <StateView kind="loading" />;
    if (!net) return <StateView kind="offline" title={t('duel.needs_online_title')} body={t('duel.needs_online_body')} actionLabel={t('home.ghosts.title')} onAction={() => navigate({ name: 'ghosts' })} />;
    if (!player.id) {
      if (sync === 'alias_rejected') return <AliasFix />;
      if (sync === 'offline' || !online) return <StateView kind="offline" body={t('duel.signup_offline')} />;
      return <StateView kind="loading" title={t('duel.signing_up')} />;
    }
    if (created)
      return (
        <div className={s.stack}>
          <p className={s.success} role="status">
            <Icon name="check" size={18} /> {t('duel.created')}
          </p>
          <InvitePanel matchId={created.matchId} inviteUrl={created.inviteUrl} inviter={me} conditions={created.conditions} onPlan={() => navigate({ name: 'match', matchId: created.matchId }, { replace: true })} />
        </div>
      );
    return (
      <div className={s.stack}>
        <section className={s.section} aria-labelledby="duel-pitch">
          <h2 id="duel-pitch" className={s.h2}>
            {t('duel.pitch_title')}
          </h2>
          <div className={s.pitches} role="radiogroup" aria-labelledby="duel-pitch">
            <CardButton role="radio" aria-checked={pitch === null} className={s.pitch} padding={3} onClick={() => setPitch(null)} data-testid="duel-pitch-any">
              <span className={s.pitchName}>
                <Icon name="shuffle" size={18} /> {t('duel.pitch_any')}
              </span>
              <span className={s.pitchHint}>{t('duel.pitch_any_hint')}</span>
            </CardButton>
            {PITCHES.map((p) => (
              <CardButton key={p} role="radio" aria-checked={pitch === p} className={s.pitch} data-pitch={p} padding={3} onClick={() => setPitch(p)} data-testid={`duel-pitch-${p}`}>
                <span className={s.pitchName}>
                  <span className={s.swatch} data-pitch={p} aria-hidden="true" /> {t(`pitch.${p}` as MessageKey)}
                </span>
                <span className={s.pitchHint}>{t(`pitch_hint.${p}` as MessageKey)}</span>
              </CardButton>
            ))}
          </div>
          {pitch && (
            <SegmentedControl<WeatherId> label={t('duel.weather')} value={weather} onChange={setWeather} options={WEATHERS.map((w) => ({ value: w, label: t(`weather.${w}` as MessageKey) }))} block />
          )}
        </section>
        <section className={s.how} aria-labelledby="duel-how">
          <h2 id="duel-how" className={s.h2}>
            {t('duel.how_title')}
          </h2>
          <ol className={s.steps}>
            <li>
              <Icon name="lock" size={18} /> {t('duel.how_1')}
            </li>
            <li>
              <Icon name="bat" size={18} /> {t('duel.how_2')}
            </li>
            <li>
              <Icon name="sparkle" size={18} /> {t('duel.how_3')}
            </li>
          </ol>
        </section>
        {error && (
          <p className={s.error} role="alert">
            <Icon name="alert" size={16} /> {error}
          </p>
        )}
      </div>
    );
  })();

  const footer =
    net && player.id && !created ? (
      <Button variant="accent" size="xl" block icon="users" onClick={() => void create()} loading={busy} data-testid="duel-create">
        {t('duel.create')}
      </Button>
    ) : undefined;

  return (
    <ScreenShell title={t('duel.title')} eyebrow={t('brand.mode')} onBack={back} narrow footer={footer} testId="duel-new-screen">
      {body}
    </ScreenShell>
  );
}
