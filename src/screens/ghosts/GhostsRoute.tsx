import { useMemo, useState } from 'react';
import type { Conditions, GhostProfile, MatchEventLog, OverPlan, PitchId, WeatherId } from '@/contracts';
import { useApp } from '@/app/store';
import { localPlayerRef } from '@/app/storeTypes';
import { routeUrl, useRouter, type RouteOf } from '@/app/router';
import { engine } from '@/engine';
import { useT, type MessageKey } from '@/i18n';
import { Avatar, Button, CardButton, Icon, ScreenShell, SegmentedControl, StateView } from '@/ui';
import { BowlingPlannerScreen } from '../planner/BowlingPlannerScreen';
import { BattingScreen } from '../batting/BattingScreen';
import { RevealScreen } from '../reveal/RevealScreen';
import { useInPlay, useNet, usePlayerGate } from '../app/hooks';
import { cardBlob, playerOf, practiceCardModel } from '../share/cards';
import { finishGhostMatch, ghostRef, hourStamp, randomHex, setupGhostMatch, type GhostMatch } from './ghostMatch';
import s from './GhostsRoute.module.css';

const PITCHES: PitchId[] = ['green', 'hard', 'slow'];
const WEATHERS: WeatherId[] = ['clear', 'humid', 'dew'];

type Stage = 'pick' | 'plan' | 'bat' | 'building' | 'reveal' | 'error';

/** Practice Ghosts: a complete match against a local, deterministic opponent. Works offline; nothing is sent. */
export default function GhostsRoute({ route }: { route: RouteOf<'ghosts'> }) {
  const player = usePlayerGate(route);
  const tr = useT();
  const { t } = tr;
  const back = useRouter((st) => st.back);
  const toast = useApp((st) => st.toast);
  const { services } = useNet();
  const [ghost, setGhost] = useState<GhostProfile>(engine.GHOSTS[0]);
  const [pitch, setPitch] = useState<PitchId>('hard');
  const [weather, setWeather] = useState<WeatherId>('clear');
  const [stage, setStage] = useState<Stage>('pick');
  const [match, setMatch] = useState<GhostMatch | null>(null);
  const [myPlan, setMyPlan] = useState<{ plan: OverPlan; salt: string } | null>(null);
  const [log, setLog] = useState<MatchEventLog | null>(null);
  const [verified, setVerified] = useState<boolean | null>(null);
  const [shared, setShared] = useState(false);
  useInPlay(stage === 'plan' || stage === 'bat');
  const me = useMemo(() => (player ? localPlayerRef(player) : null), [player]);
  if (!player || !me) return null;

  const ghostName = (g: GhostProfile) => t(g.nameKey as MessageKey);
  const begin = (g: GhostProfile = ghost) => {
    const conditions: Conditions = { pitch, weather };
    setMatch(setupGhostMatch(engine, g, ghostName(g), conditions, randomHex()));
    setMyPlan(null);
    setLog(null);
    setVerified(null);
    setShared(false);
    setStage('plan');
  };
  const finish = async () => {
    if (!match || !myPlan) return;
    setStage('building');
    try {
      const built = await finishGhostMatch(engine, match, me, myPlan.plan, hourStamp(), myPlan.salt);
      setLog(built);
      setStage('reveal');
      services?.analytics.track('reveal_watched', { mode: 'ghost' });
      void engine.verifyMatchLog(built).then((r) => setVerified(r.ok));
    } catch {
      setStage('error');
    }
  };

  if (stage === 'plan' && match)
    return (
      <BowlingPlannerScreen
        conditions={match.conditions}
        unlocked={engine.STARTER_VARIANTS}
        title={t('ghosts.plan_title', { ghost: match.ref.alias })}
        onBack={() => setStage('pick')}
        draftKey={`ghost-${match.seed}`}
        onLock={async (plan) => {
          // The salt is fixed here, so the hash on the lock screen is the commit in the replay.
          const salt = randomHex(8);
          setMyPlan({ plan, salt });
          const hash = await engine.commitHash(plan, salt);
          setTimeout(() => setStage('bat'), 900);
          return { commitHash: hash };
        }}
      />
    );

  if (stage === 'bat' && match)
    return (
      <BattingScreen
        setup={{ conditions: match.conditions, field: match.plan.field, batter: me, bowler: match.ref }}
        nextBall={match.innings.nextBall}
        submitShot={match.innings.submitShot}
        onComplete={() => void finish()}
        onExit={() => setStage('pick')}
        includeSuperBall
        totalBalls={6}
        title={t('ghosts.bat_title', { ghost: match.ref.alias })}
      />
    );

  if (stage === 'reveal' && log && match) {
    const mine = log.innings[0];
    const theirs = log.innings[1];
    const result = log.result.tie || log.result.winner === null ? 'tie' : log.result.winner === 0 ? 'won' : 'lost';
    const share = async () => {
      if (!services) return;
      const url = routeUrl({ name: 'ghosts' });
      services.analytics.track('share_initiated', { mode: 'ghost', channel: 'share_sheet' });
      const image = await cardBlob(practiceCardModel(tr, { me: playerOf(me), ghost: playerOf(match.ref), myScore: [mine.runs, mine.wickets], ghostScore: [theirs.runs, theirs.wickets], result, url }), tr.locale);
      const r = await services.platform.share.share({ title: t('brand.name'), text: t('ghosts.share_text', { ghost: match.ref.alias, runs: mine.runs }), url, image: image ?? undefined });
      if (r === 'shared' || r === 'copied') {
        setShared(true);
        services.analytics.track('share_completed', { mode: 'ghost', channel: 'share_sheet' });
        if (r === 'copied') toast({ kind: 'success', text: t('invite.copied') });
      }
    };
    return (
      <RevealScreen
        log={log}
        me={0}
        verified={verified}
        onClose={() => setStage('pick')}
        onRematch={() => begin(match.ghost)}
        onShare={shared ? undefined : () => void share()}
        onEnded={() => services?.analytics.track('replay_completed', { mode: 'ghost' })}
        onFallback={(reason) => services?.analytics.track('renderer_fallback', { reason, quality: '2d' })}
      />
    );
  }

  return (
    <ScreenShell
      title={t('ghosts.title')}
      eyebrow={t('ghosts.eyebrow')}
      onBack={back}
      narrow
      testId="ghosts-screen"
      footer={
        stage === 'pick' ? (
          <Button variant="accent" size="xl" block icon="ghost" onClick={() => begin()} data-testid="ghost-start">
            {t('ghosts.start', { ghost: ghostName(ghost) })}
          </Button>
        ) : undefined
      }
    >
      {stage === 'building' ? (
        <StateView kind="reveal_ready" title={t('ghosts.building')} />
      ) : stage === 'error' ? (
        <StateView kind="error" onAction={() => setStage('pick')} />
      ) : (
        <div className={s.stack}>
          <p className={s.lede}>{t('ghosts.body')}</p>
          <div className={s.list} role="radiogroup" aria-label={t('ghosts.pick')}>
            {engine.GHOSTS.map((g) => {
              const ref = ghostRef(g, ghostName(g));
              return (
                <CardButton key={g.id} role="radio" aria-checked={ghost.id === g.id} className={s.ghost} padding={3} onClick={() => setGhost(g)} data-testid={`ghost-${g.id}`}>
                  <Avatar avatar={ref.avatar} kit={ref.kit} size={56} decorative />
                  <span className={s.text}>
                    <span className={s.name}>{ghostName(g)}</span>
                    <span className={s.style}>{t(g.styleKey as MessageKey)}</span>
                  </span>
                  <span className={s.level} aria-label={t('ghosts.difficulty', { n: g.difficulty })}>
                    {[1, 2, 3].map((i) => (
                      <Icon key={i} name="sparkle" size={14} className={i <= g.difficulty ? s.on : s.off} />
                    ))}
                  </span>
                </CardButton>
              );
            })}
          </div>
          <section className={s.section} aria-labelledby="ghost-cond">
            <h2 id="ghost-cond" className={s.h2}>
              {t('ghosts.conditions')}
            </h2>
            <SegmentedControl<PitchId> label={t('duel.pitch_title')} value={pitch} onChange={setPitch} options={PITCHES.map((p) => ({ value: p, label: t(`pitch.${p}` as MessageKey) }))} block />
            <p className={s.hint}>{t(`pitch_hint.${pitch}` as MessageKey)}</p>
            <SegmentedControl<WeatherId> label={t('duel.weather')} value={weather} onChange={setWeather} options={WEATHERS.map((w) => ({ value: w, label: t(`weather.${w}` as MessageKey) }))} block />
          </section>
          <p className={s.note}>
            <Icon name="offline" size={16} /> {t('ghosts.offline_note')}
          </p>
        </div>
      )}
    </ScreenShell>
  );
}
