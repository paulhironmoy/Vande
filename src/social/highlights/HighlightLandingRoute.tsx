import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { HighlightPublic, MatchEventLog, PlayerRef } from '@/contracts';
import { useApp } from '@/app/store';
import { localPlayerRef } from '@/app/storeTypes';
import { useRouter, type RouteOf } from '@/app/router';
import { isNativePlatform, localShareLedger, playStoreUrl, shareMoment } from '@/platform';
import { Avatar, Button, Card, Chip, ScreenShell, StateView } from '@/ui';
import { socialFailure, useAction, useResource, useSocialServices } from '../hooks';
import { useSocialT, type SocialT } from '../i18n';
import { FailureState, NeedsOnline } from '../components/States';
import { shareUrl } from '../components/links';
import { CutPlayer } from './CutPlayer';
import { withDisplayNames, youtubeUrl } from './highlightModel';
import s from '../components/social.module.css';

const PracticeAgainst = lazy(() => import('./PracticeAgainst'));

/**
 * The public landing of a published highlight (https://<web>/h/<code>): who played, a link out to YouTube (no embed,
 * no third-party request from this page), the in-app replay, and "Can you beat them?" (practice against their over,
 * locally, or challenge a friend). Installing the app is optional and secondary.
 */
export default function HighlightLandingRoute({ route }: { route: RouteOf<'highlight'> }) {
  const tr = useSocialT();
  const { t } = tr;
  const back = useRouter((st) => st.back);
  const navigate = useRouter((st) => st.navigate);
  const player = useApp((st) => st.player);
  const locale = useApp((st) => st.settings.locale);
  const toast = useApp((st) => st.toast);
  const { net, services, booting } = useSocialServices();
  const hl = useResource<HighlightPublic>(net ? () => net.api.call('GET /v1/h/:code', { params: { code: route.code } }, { anonymous: true }) : null, [net, route.code]);
  const [log, setLog] = useState<MatchEventLog | null>(null);
  const [mode, setMode] = useState<'landing' | 'replay' | { practice: 0 | 1 }>('landing');
  const action = useAction();
  const counted = useRef(false);

  useEffect(() => {
    if (!hl.data || counted.current || !net) return;
    counted.current = true;
    void net.attribution.report(route.code, 'landing_open');
    services?.analytics.track('attributed_view', { attribution: route.code });
  }, [hl.data, net, services, route.code]);

  const shell = (children: React.ReactNode) => (
    <ScreenShell title={hl.data?.title ?? t('social.landing.title')} eyebrow={t('social.landing.eyebrow')} onBack={back} narrow testId="landing-screen">
      {children}
    </ScreenShell>
  );

  if (booting) return shell(<StateView kind="loading" />);
  if (!net) return shell(<NeedsOnline actionLabel={t('social.common.home')} onAction={() => navigate({ name: 'home' })} />);
  const h = hl.data;
  if (!h) return shell(hl.error ? <FailureState failure={socialFailure(hl.error)} onRetry={hl.reload} notFoundTitle={t('social.landing.gone_title')} notFoundBody={t('social.landing.gone_body')} /> : <StateView kind="loading" />);

  const loadLog = async (): Promise<MatchEventLog | null> => {
    if (log) return log;
    const r = await action.run(() => net.api.call('GET /v1/h/:code/replay', { params: { code: route.code } }, { anonymous: true }));
    if (r.ok) {
      // The landing's moderated names, never the match-time aliases inside the replay.
      const shown = withDisplayNames(r.value, h.participants.map((x) => x.alias));
      setLog(shown);
      return shown;
    }
    toast({ kind: 'warning', text: r.failure === 'offline' ? t('social.state.offline_body') : t('social.landing.replay_failed') });
    return null;
  };

  if (mode === 'replay' && log) return <CutPlayer log={log} onClose={() => setMode('landing')} />;
  if (typeof mode === 'object' && log) {
    const me: PlayerRef = player ? localPlayerRef(player) : { id: 'local', alias: t('social.landing.you'), avatar: { seed: 'guest0001' }, kit: { id: 'starter', primary: '#1E2A78', secondary: '#00B8D9', pattern: 'chevron' }, kind: 'human' };
    return (
      <Suspense
        fallback={
          <main>
            <StateView kind="loading" />
          </main>
        }
      >
        <PracticeAgainst log={log} bowler={mode.practice} me={me} onDone={() => setMode('landing')} />
      </Suspense>
    );
  }

  const url = shareUrl(services, { name: 'highlight', code: route.code });
  // The duel screen creates the challenge with this highlight's code (/duel?a=<code>), after onboarding if needed.
  const startChallenge = () => {
    services?.analytics.track('attributed_challenge', { attribution: route.code });
    navigate({ name: 'duel_new', attribution: route.code });
  };

  const shareHighlight = async () => {
    if (!services) return;
    const ctx = { kind: 'duel' as const, id: h.matchId, url, players: [h.participants[0]?.alias ?? '', h.participants[1]?.alias ?? ''] as [string, string], highlight: { code: route.code, url }, locale: locale === 'hi' || locale === 'hi-Latn' ? locale : ('en' as const) };
    const r = await shareMoment(services.platform.share, localShareLedger(), 'final', ctx, { onShared: () => void net.attribution.report(route.code, 'share') });
    if (r === 'copied') toast({ kind: 'success', text: t('social.share.copied') });
    if (r === 'not_allowed') toast({ kind: 'info', text: t('social.landing.shared_already') });
  };

  return shell(
    <div className={s.stack}>
      <Card padding={5} className={[s.hero, s.final].join(' ')} data-testid="landing-hero">
        <p className={[s.eyebrow, s.finalEyebrow].join(' ')}>{t('social.landing.day', { day: tr.date(`${h.day}T12:00:00Z`, { day: 'numeric', month: 'long', year: 'numeric' }) })}</p>
        <div className={s.versus}>
          <Participant p={h.participants[0]} tr={tr} />
          <span className={s.vs} aria-hidden="true">
            {t('social.landing.vs')}
          </span>
          <Participant p={h.participants[1]} tr={tr} />
        </div>
        <div className={s.actions}>
          {h.youtubeVideoId && (
            <a className={s.linkButton} href={youtubeUrl(h.youtubeVideoId)} target="_blank" rel="noopener noreferrer" data-testid="landing-youtube">
              {t('social.landing.youtube')}
            </a>
          )}
          <Button
            variant="primary"
            icon="play"
            loading={action.busy && mode === 'landing'}
            onClick={async () => {
              if (await loadLog()) setMode('replay');
            }}
            data-testid="landing-replay"
          >
            {t('social.landing.replay')}
          </Button>
        </div>
        {!h.youtubeVideoId && <p className={s.small}>{t('social.landing.video_soon')}</p>}
      </Card>
      <section className={s.section} aria-labelledby="beat">
        <h2 className={s.h2} id="beat">
          {t('social.landing.beat_title')}
        </h2>
        <p className={s.body}>{t('social.landing.beat_body')}</p>
        <div className={s.actions}>
          {([0, 1] as const).map((seat) => (
            <Button
              key={seat}
              variant="secondary"
              icon="bat"
              onClick={async () => {
                if (await loadLog()) setMode({ practice: seat });
              }}
              data-testid={`landing-practice-${seat}`}
            >
              {t('social.landing.practice', { name: h.participants[seat]?.alias ?? '' })}
            </Button>
          ))}
        </div>
        <p className={s.small}>{t('social.landing.practice_note')}</p>
        <Button variant="accent" size="lg" block icon="rematch" onClick={startChallenge} data-testid="landing-challenge">
          {t('social.landing.challenge')}
        </Button>
      </section>
      <section className={s.section}>
        <Button variant="ghost" icon="share" onClick={() => void shareHighlight()} data-testid="landing-share">
          {t('social.landing.share')}
        </Button>
        {!isNativePlatform() && (
          <a className={s.small} href={playStoreUrl({ highlight: route.code })} rel="noopener noreferrer" target="_blank">
            {t('social.landing.install')}
          </a>
        )}
      </section>
    </div>,
  );
}

function Participant({ p, tr }: { p: HighlightPublic['participants'][number] | undefined; tr: SocialT }) {
  if (!p) return <span />;
  return (
    <div className={s.playerText}>
      <Avatar avatar={p.avatar} size={64} decorative />
      <span className={s.alias}>{p.alias}</span>
      {p.rank !== null && (
        <Chip tone="amber" icon="crown">
          {tr.t('social.landing.rank', { rank: p.rank })}
        </Chip>
      )}
    </div>
  );
}
