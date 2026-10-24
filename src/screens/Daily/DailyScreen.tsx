import { useEffect, useMemo } from 'react';
import { useApp } from '@/app/store';
import { useSimple } from '@/app/simple';
import { track } from '@/analytics';
import { Button, ScreenShell } from '@/components/ui';
import layout from '@/components/results/layout.module.css';
import { CommunitySlot } from '@/components/daily/CommunitySlot';
import { DailyMosaic } from '@/components/daily/DailyMosaic';
import { indexRecords, recentDays } from '@/progression/calendar';
import { dailyStateFor } from '@/progression/dailyState';
import { dailyIdWords, resetLocalTime, utcDailyId } from '@/progression/dailyTime';
import styles from './DailyScreen.module.css';

/** Compact launcher: what today is, where you stand, one button. */
export function DailyScreen() {
  const dailyV2 = useApp((st) => st.dailyV2);
  const daily = useApp((st) => st.daily);
  const plan = useApp((st) => st.plan);
  const game = useApp((st) => st.game);
  const startDailyQuickPlay = useApp((st) => st.startDailyQuickPlay);
  const continueCampaign = useApp((st) => st.continueCampaign);
  const navigate = useApp((st) => st.navigate);
  const back = useApp((st) => st.back);
  const simple = useSimple();

  const todayId = utcDailyId();
  const inProgress = Boolean(plan?.dailyDate === todayId && game);
  const state = dailyStateFor(todayId, dailyV2, inProgress, simple);
  const index = useMemo(() => indexRecords(dailyV2, daily), [dailyV2, daily]);
  const mosaic = useMemo(() => recentDays(index, 7, todayId), [index, todayId]);

  useEffect(() => {
    track('daily_entry_viewed', { mode: simple ? 'simple' : 'full', dailyId: todayId });
  }, [simple, todayId]);

  const play = () => (state.status === 'in-progress' ? continueCampaign() : startDailyQuickPlay());

  return (
    <ScreenShell title={simple ? "Today's crisis" : "Today's Crisis"} onBack={() => back()} narrow testId="daily-screen">
      <div className={styles.stack}>
        <p className={styles.dateRow}>
          <time dateTime={todayId} data-testid="daily-date">
            {dailyIdWords(todayId)}
          </time>
          <span className={styles.reset}>{simple ? 'New one at' : 'New crisis at'} {resetLocalTime()}</span>
        </p>
        <p className={styles.state} data-testid="daily-state" data-status={state.status}>
          {state.line}
        </p>
        <Button variant="primary" size="lg" block icon="play" onClick={play} data-testid="daily-play">
          {state.cta}
        </Button>

        <CommunitySlot dailyId={todayId} mine={state.record?.official?.score} />

        <section className={`${layout.card} ${layout.cardTight}`} aria-label={simple ? 'Last seven days' : 'Last seven days'}>
          <DailyMosaic cells={mosaic} />
          <Button variant="ghost" size="sm" icon="history" onClick={() => navigate({ name: 'calendar' })} data-testid="daily-open-calendar">
            {simple ? 'See all days' : 'Calendar'}
          </Button>
        </section>
      </div>
    </ScreenShell>
  );
}
