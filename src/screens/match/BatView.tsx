import { useEffect, useMemo, useState } from 'react';
import type { FieldSetting, MatchView, PlayerRef } from '@/contracts';
import type { Net } from '@/net';
import { useApp } from '@/app/store';
import { useT } from '@/i18n';
import { Icon, ScreenShell, StateView } from '@/ui';
import { BattingScreen } from '../batting/BattingScreen';
import { failureKind } from '../app/errors';
import { netInnings } from './netInnings';
import { hasTrained } from '../training/progress';
import s from './BatView.module.css';

/**
 * The live innings against the opponent's sealed over. The first ball is fetched now (it brings the field the batter
 * faces); a ball revealed before the app was closed is resumed; a shot made offline is queued and sent later.
 */
export function BatView({ net, view, me, opponent, onDone, onExit }: { net: Net; view: MatchView; me: PlayerRef; opponent: PlayerRef; onDone: () => void; onExit: () => void }) {
  const { t } = useT();
  const online = useApp((st) => st.online);
  const [queued, setQueued] = useState(false);
  const innings = useMemo(() => netInnings(net.batting, view.matchId, { onQueued: setQueued }), [net, view.matchId]);
  const [field, setField] = useState<FieldSetting | null>(null);
  const [error, setError] = useState<'offline' | 'error' | null>(null);
  const [tries, setTries] = useState(0);
  useEffect(() => {
    // Safe to run twice (StrictMode): the client reuses the revealed ball and the same Idempotency-Key.
    let alive = true;
    setError(null);
    innings.start().then(
      (first) => {
        if (!alive) return;
        if (!first) onDone();
        else setField(first.field);
      },
      (e) => {
        if (alive) setError(failureKind(e) === 'offline' ? 'offline' : 'error');
      },
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [innings, tries]);

  if (!field)
    return (
      <ScreenShell title={t('match.title')} onBack={onExit} narrow testId="match-bat-loading">
        {error ? (
          <StateView kind={error === 'offline' ? 'offline' : 'error'} body={error === 'offline' ? t('match.bat_offline') : undefined} onAction={() => setTries((n) => n + 1)} />
        ) : (
          <StateView kind="loading" title={t('match.bat_loading')} />
        )}
      </ScreenShell>
    );

  return (
    <BattingScreen
      setup={{ conditions: view.conditions, field, batter: me, bowler: opponent }}
      nextBall={innings.nextBall}
      submitShot={innings.submitShot}
      onComplete={onDone}
      onExit={onExit}
      quickStart
      includeSuperBall
      ballsFaced={view.myBallsFaced}
      totalBalls={6}
      connectivity={online ? (queued ? 'reconnecting' : 'online') : 'offline'}
      title={t('match.bat_vs', { name: opponent.alias })}
      // First real innings on a device that skipped Training: one line on how to bat.
      banner={
        !hasTrained() && view.myBallsFaced === 0 ? (
          <p className={s.coach} data-testid="bat-coach">
            <Icon name="info" size={16} />
            {t('bat.coach')}
          </p>
        ) : undefined
      }
    />
  );
}
