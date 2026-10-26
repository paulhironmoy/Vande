import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { DeliveryVariant, MatchView, OverPlan, Profile } from '@/contracts';
import { useApp } from '@/app/store';
import { useRouter, type RouteOf } from '@/app/router';
import { engine } from '@/engine';
import { useT } from '@/i18n';
import { ScreenShell, StateView } from '@/ui';
import { BowlingPlannerScreen } from '../planner/BowlingPlannerScreen';
import { useAccountSync, useInPlay, useLoad, useNet, useNow, usePlayerGate } from '../app/hooks';
import { failureKind } from '../app/errors';
import { untilText } from '../app/deadline';
import { AliasFix } from '../common/AliasFix';
import { AwaitingRevealView, BatReadyView, ExpiredView, SealedView } from './views';
import { BatView } from './BatView';
import { PrivateMatch, RevealedView } from './RevealedView';
import { pollFor, refetchIn } from './revealSlot';
import { hasTrained } from '../training/progress';

const CACHE = 'vc:mv:';

function readCache(id: string): MatchView | null {
  try {
    const raw = localStorage.getItem(CACHE + id);
    return raw ? (JSON.parse(raw) as MatchView) : null;
  } catch {
    return null;
  }
}
function writeCache(v: MatchView) {
  try {
    localStorage.setItem(CACHE + v.matchId, JSON.stringify(v));
  } catch {
    /* storage unavailable */
  }
}

/**
 * One route for every phase of a match: the invitation while waiting for a friend, the planner and then the sealed
 * proof, the live innings, honest anticipation while the other side bats, the reveal, and expiry.
 */
export default function MatchRoute({ route }: { route: RouteOf<'match'> }) {
  const player = usePlayerGate(route);
  const { t } = useT();
  const tr = useT();
  const navigate = useRouter((st) => st.navigate);
  const back = useRouter((st) => st.back);
  const online = useApp((st) => st.online);
  const sync = useAccountSync();
  const { net, services, booting } = useNet();
  const now = useNow(30_000);
  const [mode, setMode] = useState<'view' | 'plan' | 'bat'>('view');
  const [justLocked, setJustLocked] = useState(false);
  const cached = useMemo(() => readCache(route.matchId), [route.matchId]);
  const signedIn = Boolean(player?.id);
  const [poll, setPoll] = useState<number | null>(null);
  const load = useLoad<MatchView>(net && signedIn ? () => net.api.call('GET /v1/matches/:id', { params: { id: route.matchId } }) : null, [net, signedIn, route.matchId], { pollMs: poll });
  const view = load.data ?? cached;
  useEffect(() => {
    if (load.data) writeCache(load.data);
    setPoll(pollFor(load.data ?? null, Date.now()));
  }, [load.data]);
  // A reveal with a time (a duel's shared slot, a cup round): fetch again at that moment and roll into the reveal.
  const reload = load.reload;
  const slotIn = refetchIn(load.data ?? null, Date.now());
  const revealAt = load.data?.phase === 'awaiting_reveal' ? load.data.deadlines.revealAt : null;
  useEffect(() => {
    if (slotIn === null) return;
    const id = setTimeout(() => {
      reload();
      setPoll(pollFor(load.data ?? null, Date.now()));
    }, slotIn);
    return () => clearTimeout(id);
    // Scheduled once per reveal time; a new view with the same time keeps the timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealAt, reload]);

  const profile = useLoad<Profile>(net && signedIn && view && !view.locked[view.me] ? () => net.api.call('GET /v1/me') : null, [net, signedIn, Boolean(view && !view.locked[view.me])]);
  const unlocked: readonly DeliveryVariant[] = useMemo(() => {
    const extra = (profile.data?.unlocks ?? []).filter((v): v is DeliveryVariant => ['yorker', 'good_length', 'bouncer', 'slower', 'inswing', 'outswing', 'offspin', 'legspin'].includes(v));
    return [...new Set([...engine.STARTER_VARIANTS, ...extra])];
  }, [profile.data]);

  useInPlay(mode === 'plan' || mode === 'bat');

  const lock = useCallback(
    async (plan: OverPlan) => {
      if (!net || !view) throw new Error('offline');
      const r = await net.api.call('POST /v1/matches/:id/lock', { params: { id: view.matchId }, body: { plan } });
      services?.analytics.track('over_locked', { mode: view.kind === 'cup' ? 'cup' : view.kind === 'daily' ? 'daily' : 'duel', ...(view.cup ? { stage: view.cup.stage } : {}) });
      setJustLocked(true);
      setMode('view');
      load.reload();
      return { commitHash: r.commitHash };
    },
    [net, view, services, load],
  );

  if (!player) return null;

  const shell = (body: ReactNode) => (
    <ScreenShell title={t('match.title')} eyebrow={t('brand.mode')} onBack={back} narrow testId="match-screen">
      {body}
    </ScreenShell>
  );

  if (booting) return shell(<StateView kind="loading" />);
  if (!net) return shell(<StateView kind="offline" title={t('match.needs_online_title')} body={t('match.needs_online_body')} actionLabel={t('home.ghosts.title')} onAction={() => navigate({ name: 'ghosts' })} />);
  if (!signedIn) {
    if (sync === 'alias_rejected') return shell(<AliasFix />);
    return shell(sync === 'offline' || !online ? <StateView kind="offline" body={t('match.signup_offline')} /> : <StateView kind="loading" title={t('duel.signing_up')} />);
  }
  if (!view) {
    if (load.error) {
      const k = failureKind(load.error);
      if (k === 'offline') return shell(<StateView kind="offline" body={t('match.offline_body')} onAction={load.reload} />);
      // Someone else's match (a forwarded link) is private, not an error (the server answers 404 for it).
      if (k === 'forbidden' || k === 'not_found') return shell(<PrivateMatch />);
      return shell(<StateView kind="error" onAction={load.reload} />);
    }
    return shell(<StateView kind="loading" title={t('match.loading')} />);
  }

  const me = view.players[view.me]!;
  const opp = view.players[(1 - view.me) as 0 | 1];
  const canLock = (view.phase === 'awaiting_opponent' || view.phase === 'planning') && !view.locked[view.me];

  if (mode === 'plan' && canLock) {
    const when = untilText(tr, view.deadlines.lockBy, now);
    return (
      <BowlingPlannerScreen
        conditions={view.conditions}
        unlocked={unlocked}
        draftKey={view.matchId}
        onLock={lock}
        onBack={() => setMode('view')}
        deadline={when ? t('match.locks_in', { when }) : null}
        title={opp ? t('match.plan_vs', { name: opp.alias }) : t('plan.title')}
        coach={!hasTrained()}
      />
    );
  }

  if (mode === 'bat' && view.phase === 'batting' && opp) {
    return (
      <BatView
        net={net}
        view={view}
        me={me}
        opponent={opp}
        onDone={() => {
          services?.analytics.track('innings_completed', { mode: view.kind === 'cup' ? 'cup' : 'duel' });
          setMode('view');
          load.reload();
        }}
        onExit={() => setMode('view')}
      />
    );
  }

  switch (view.phase) {
    case 'awaiting_opponent':
    case 'planning':
      return shell(<SealedView view={view} me={me} opponent={opp} now={now} justLocked={justLocked} onPlan={() => setMode('plan')} net={net} services={services} />);
    case 'batting':
      return shell(<BatReadyView view={view} opponent={opp} now={now} onBat={() => setMode('bat')} />);
    case 'awaiting_reveal':
      return shell(<AwaitingRevealView view={view} me={me} opponent={opp} now={now} services={services} />);
    case 'revealed':
      return <RevealedView matchId={view.matchId} me={view.me} net={net} services={services} rematch={view.rematch ?? null} opponentName={opp?.alias ?? null} />;
    default:
      return shell(<ExpiredView view={view} />);
  }
}
