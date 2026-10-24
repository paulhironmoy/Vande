import { useEffect, useState } from 'react';
import { useApp } from '@/app/store';
import { useSimple, scenarioTitle } from '@/app/simple';
import { Button, Icon, ScreenShell, Sheet } from '@/components/ui';
import { RulesCard } from '@/components/daily/RulesCard';
import { coldOpenLines } from '@/progression/coldOpen';
import { dailyIdWords } from '@/progression/dailyTime';
import s from './DailyOpenScreen.module.css';

const LINE_GAP_MS = 1600;

/**
 * Skippable cold open for a daily attempt: three lines, the date, official/practice, one button.
 * Never auto-advances (WCAG 2.2.1): Start and Skip both begin play immediately. Window timers only (page.clock).
 */
export function DailyOpenScreen() {
  const intent = useApp((st) => st.intent);
  const scenario = useApp((st) => st.scenario);
  const reducedMotion = useApp((st) => st.reducedMotion);
  const beginDailyPlay = useApp((st) => st.beginDailyPlay);
  const back = useApp((st) => st.back);
  const simple = useSimple();
  const [shown, setShown] = useState(reducedMotion ? 3 : 1);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [started, setStarted] = useState(false);

  const dailyId = intent?.dailyId ?? intent?.dailyResolution?.dailyId;
  const official = intent?.official ?? true;
  const lines = coldOpenLines(scenario, simple);
  const title = scenarioTitle(scenario, simple) || (simple ? "Today's crisis" : "Today's Republic Crisis");

  const start = () => {
    if (started) return;
    setStarted(true);
    beginDailyPlay();
  };

  useEffect(() => {
    if (reducedMotion || rulesOpen) return undefined;
    const timers: number[] = [];
    for (let i = 2; i <= lines.length; i++) timers.push(window.setTimeout(() => setShown(i), (i - 1) * LINE_GAP_MS));
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [lines.length, reducedMotion, rulesOpen]);

  return (
    <ScreenShell
      testId="daily-open-screen"
      onBack={() => back()}
      footer={
        <div className={s.footer}>
          <Button variant="primary" size="lg" block icon="play" onClick={start} data-testid="daily-open-start">
            {simple ? "Let's go" : 'Start'}
          </Button>
          <div className={s.footerRow}>
            <Button variant="ghost" size="sm" onClick={start} data-testid="daily-open-skip">
              Skip
            </Button>
            <Button variant="ghost" size="sm" icon="question" onClick={() => setRulesOpen(true)} data-testid="daily-open-rules">
              Rules
            </Button>
          </div>
        </div>
      }
    >
      <div className={s.wrap}>
        <p className={s.kicker}>
          <Icon name="clock" size={16} />
          {dailyId ? dailyIdWords(dailyId) : 'Today'} · {official ? (simple ? 'This try is official' : 'Official attempt') : 'Practice'}
        </p>
        <h1 className={s.title}>{title}</h1>
        <ol className={s.lines} aria-live="polite">
          {lines.slice(0, shown).map((line, i) => (
            <li key={i} className={s.line}>
              {line}
            </li>
          ))}
        </ol>
      </div>
      <Sheet open={rulesOpen} onClose={() => setRulesOpen(false)} title={simple ? 'Rules' : 'Rules at a glance'} testId="daily-open-rules-sheet">
        <RulesCard compact hideHeading />
      </Sheet>
    </ScreenShell>
  );
}
