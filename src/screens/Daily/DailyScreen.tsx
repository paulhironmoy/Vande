import { useMemo } from 'react';
import { OUTCOME_LABELS } from '@/engine/types';
import { DIFFICULTY_META, getDailySpec, getScenario } from '@/engine';
import { SIMPLE_DIFFICULTY, SIMPLE_OUTCOMES, SIMPLE_UI, scenarioSubtitle, scenarioTitle, useSimple } from '@/app/simple';
import { Button, ScreenShell, useApp } from '@/components/results/deps';
import layout from '@/components/results/layout.module.css';
import { SimulatedBand } from '@/components/results/SimulatedBand';
import { ScoreDisplay } from '@/components/results/ScoreDisplay';
import { CalendarIcon, ClockIcon } from '@/components/results/icons';
import { dateFromKey, formatDateLong, formatDateShort } from '@/components/results/format';
import { OpponentChip } from '@/components/opponents/OpponentChip';
import styles from './DailyScreen.module.css';

export function DailyScreen() {
  const daily = useApp((s) => s.daily);
  const bests = useApp((s) => s.bests);
  const reducedMotion = useApp((s) => s.reducedMotion);
  const beginDailySetup = useApp((s) => s.beginDailySetup);
  const back = useApp((s) => s.back);
  const simple = useSimple();
  const outcomeName = (o: keyof typeof OUTCOME_LABELS) => (simple ? SIMPLE_OUTCOMES[o].label : OUTCOME_LABELS[o]);

  const spec = useMemo(() => getDailySpec(new Date()), []);
  const scenario = useMemo(() => {
    try {
      return getScenario(spec.scenarioId);
    } catch {
      return undefined;
    }
  }, [spec.scenarioId]);
  const today = daily.find((d) => d.date === spec.date);
  const recent = [...daily].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 7);

  return (
    <ScreenShell title={simple ? SIMPLE_UI.daily : "Today's Republic Crisis"} onBack={() => back()} testId="daily-screen">
      <div className={`${layout.page} ${layout.narrow}`}>
        <header className={layout.stack}>
          <p className={styles.dateRow}>
            <CalendarIcon size={18} />
            <time dateTime={spec.date} data-testid="daily-date">
              {formatDateLong(dateFromKey(spec.date))}
            </time>
          </p>
          <h1 className={layout.h1}>{simple ? `Today: ${scenarioTitle(scenario, true) || spec.title}` : spec.title || scenario?.title || 'Today’s crisis'}</h1>
          {scenario && <p className={layout.lead}>{scenarioSubtitle(scenario, simple)}</p>}
          <div className={styles.meta}>
            <span>
              <ClockIcon size={18} />
              About 3 minutes
            </span>
            <span>{simple ? `${SIMPLE_DIFFICULTY[spec.difficulty]?.label ?? 'Normal'} level` : `${DIFFICULTY_META[spec.difficulty]?.label ?? 'Standard'} difficulty`}</span>
            <span>{simple ? 'One chapter. Your best try counts.' : 'One scenario, your best attempt counts'}</span>
          </div>
        </header>

        <section className={layout.card} aria-labelledby="daily-opponents">
          <h2 className={layout.sectionTitle} id="daily-opponents">
            {simple ? "Today's trouble makers" : "Today's opponents"}
          </h2>
          <div className={layout.chips}>
            {spec.opponents.map((id) => (
              <OpponentChip key={id} id={id} size="lg" animated={!reducedMotion} />
            ))}
          </div>
          <p className={layout.muted} style={{ marginTop: 'var(--s-3)' }}>
            {simple ? 'Everyone who plays today gets the same game.' : 'Everyone who plays today faces the same seed, the same events and the same opponents.'}
          </p>
        </section>

        <section className={layout.card} aria-labelledby="daily-result">
          <h2 className={layout.sectionTitle} id="daily-result">
            {simple ? 'Your score today' : 'Your result today'}
          </h2>
          {today ? (
            <div className={styles.result}>
              <ScoreDisplay score={today.score} label="Today" size="7rem" animated={!reducedMotion} />
              <div className={styles.resultText}>
                <strong>{outcomeName(today.outcome)}</strong>
                <span className={layout.muted}>{simple ? `Played ${formatDateShort(today.completedAt)}. Play again to beat it.` : `Played ${formatDateShort(today.completedAt)}. You can replay, but today's record stays.`}</span>
                {bests.daily && <span className={layout.muted}>{simple ? 'Best day' : 'Best daily'}: {Math.round(bests.daily.score)} on {formatDateShort(dateFromKey(bests.daily.date))}</span>}
              </div>
            </div>
          ) : (
            <p className={layout.body}>
              Not played yet. {bests.daily ? `${simple ? 'Your best day so far is' : 'Your best daily so far is'} ${Math.round(bests.daily.score)}.` : simple ? 'Your first score becomes your best score.' : 'Your first daily result becomes your personal best.'}
            </p>
          )}
        </section>

        <section className={layout.card} aria-labelledby="daily-band">
          <h2 className={layout.sectionTitle} id="daily-band">
            {simple ? "Today's range" : 'Comparison range'}
          </h2>
          <SimulatedBand band={spec.simulatedBand} mine={today?.score} />
        </section>

        {recent.length > 0 && (
          <section className={layout.card} aria-labelledby="daily-history">
            <h2 className={layout.sectionTitle} id="daily-history">
              {simple ? 'Recent days' : 'Recent dailies'}
            </h2>
            <ul className={styles.history}>
              {recent.map((r) => (
                <li key={r.date} className={styles.historyRow}>
                  <span>{formatDateShort(dateFromKey(r.date))}</span>
                  <span className={styles.historyOutcome}>{outcomeName(r.outcome)}</span>
                  <span className={styles.historyScore}>{Math.round(r.score)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className={layout.actionBar}>
          <Button variant="primary" size="lg" onClick={() => beginDailySetup()} data-testid="daily-play">
            {simple ? (today ? 'Play again' : "Play today's challenge") : today ? "Replay today's crisis" : "Play today's crisis"}
          </Button>
        </div>
      </div>
    </ScreenShell>
  );
}
