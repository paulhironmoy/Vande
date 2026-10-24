import { useEffect, useMemo, useState } from 'react';
import { PACE_MS } from '@/engine';
import { SIMPLE_UI, scenarioSubtitle, scenarioTitle, useSimple } from '@/app/simple';
import { Button, CityMap, ScreenShell, useApp } from '@/components/results/deps';
import layout from '@/components/results/layout.module.css';
import { formatMinutes } from '@/components/results/format';
import { ClockIcon, StatusIcon } from '@/components/results/icons';
import { OpponentChip } from '@/components/opponents/OpponentChip';
import styles from './BriefingScreen.module.css';

/** Reveal schedule in ms — the whole briefing lands in ~15 s. */
const STEPS = [0, 1200, 3400, 6400, 9400, 12000, 14400];
const TOTAL = 15500;

export function BriefingScreen() {
  const scenario = useApp((s) => s.scenario);
  const game = useApp((s) => s.game);
  const campaign = useApp((s) => s.campaign);
  const intent = useApp((s) => s.intent);
  const map = useApp((s) => s.map);
  const settings = useApp((s) => s.settings);
  const reducedMotion = useApp((s) => s.reducedMotion);
  const startChapter = useApp((s) => s.startChapter);
  const back = useApp((s) => s.back);
  const navigate = useApp((s) => s.navigate);
  const simple = useSimple();

  const [step, setStep] = useState(reducedMotion ? STEPS.length - 1 : 0);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (reducedMotion) {
      setStep(STEPS.length - 1);
      setElapsed(TOTAL);
      return;
    }
    const timers = STEPS.map((ms, i) => window.setTimeout(() => setStep((s) => Math.max(s, i)), ms));
    const start = performance.now();
    const ticker = window.setInterval(() => {
      const e = performance.now() - start;
      setElapsed(Math.min(TOTAL, e));
      if (e >= TOTAL) window.clearInterval(ticker);
    }, 500);
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      window.clearInterval(ticker);
    };
  }, [reducedMotion]);

  const opponents = game?.config.opponents ?? intent?.opponents ?? campaign?.config.opponents ?? [];
  const mode = game?.config.mode ?? campaign?.config.mode ?? intent?.kind ?? 'campaign';
  const paceMs = PACE_MS[settings.timerPace] ?? 1000;
  const durationMs = (scenario?.duration ?? 180) * paceMs;
  const timerLabel = useMemo(() => formatMinutes(durationMs), [durationMs]);

  if (!scenario) {
    return (
      <ScreenShell title="Briefing" onBack={() => back()} testId="briefing-screen">
        <div className={`${layout.page} ${layout.narrow}`}>
          <div className={`${layout.card} ${layout.emptyState}`}>
            <h1 className={layout.h2}>{simple ? 'Nothing to play yet.' : 'No chapter is ready to brief.'}</h1>
            <p className={layout.body}>{simple ? "Start the story, today's challenge or a friend game from the home screen." : "Start a campaign, today's crisis or a friend challenge from the home screen."}</p>
            <Button variant="primary" onClick={() => navigate({ name: 'home' }, { replace: true })}>
              Go home
            </Button>
          </div>
        </div>
      </ScreenShell>
    );
  }

  const chapterLabel = simple
    ? mode === 'daily'
      ? "Today's challenge"
      : mode === 'challenge'
        ? 'Friend game'
        : `Chapter ${scenario.chapter} of 3`
    : mode === 'daily'
      ? "Today's Republic Crisis"
      : mode === 'challenge'
        ? 'Friend challenge'
        : `Chapter ${scenario.chapter} of 3`;
  const cls = (n: number) => `${styles.step} ${step >= n ? styles.shown : styles.pending}`;
  const complete = step >= STEPS.length - 1;
  const sb = simple ? scenario.simple?.briefing : undefined;
  const brief = {
    grievance: sb?.grievance ?? scenario.briefing.grievance,
    knownFacts: sb?.knownFacts ?? scenario.briefing.knownFacts,
    unverifiedClaims: sb?.unverifiedClaims ?? scenario.briefing.unverifiedClaims,
    responsibility: sb?.responsibility ?? scenario.briefing.responsibility,
    objective: sb?.objective ?? scenario.briefing.objective,
    lines: sb?.lines ?? scenario.briefing.lines,
  };
  const minutes = Math.max(1, Math.round(durationMs / 60000));

  return (
    <ScreenShell title={simple ? 'Get ready' : 'Briefing'} onBack={() => back()} testId="briefing-screen">
      <div className={styles.root}>
        <div className={styles.bg} aria-hidden="true" inert>
          {map && (
            <CityMap
              map={map}
              className={styles.bgMap}
              reducedMotion={reducedMotion}
              highContrast={settings.highContrast}
              colourBlind={settings.colourBlindSafe}
              captions={false}
              onSelectDistrict={() => undefined}
              simple={simple}
            />
          )}
          <div className={styles.bgShade} />
        </div>
        <div className={`${layout.page} ${styles.content}`}>
          <div className={styles.progress} aria-hidden="true">
            <div className={styles.progressFill} style={{ ['--p' as string]: `${Math.round((elapsed / TOTAL) * 100)}%` }} />
          </div>

          <div className={styles.top}>
            <header className={cls(0)}>
              <p className={styles.chapter}>{chapterLabel}</p>
              <h1 className={styles.title}>{scenarioTitle(scenario, simple)}</h1>
              <p className={styles.subtitle}>{scenarioSubtitle(scenario, simple)}</p>
            </header>
            <Button variant="ghost" size="sm" onClick={() => startChapter()} data-testid="briefing-skip">
              {simple ? SIMPLE_UI.skipBriefing : 'Skip briefing'}
            </Button>
          </div>

          <section className={`${layout.card} ${cls(1)}`} aria-labelledby="brief-grievance">
            <h2 className={layout.sectionTitle} id="brief-grievance">
              {simple ? 'The problem' : 'The legitimate grievance'}
            </h2>
            <ul className={styles.lines}>
              {brief.lines.slice(0, 3).map((line, i) => (
                <li key={i} className={styles.line}>
                  {line}
                </li>
              ))}
            </ul>
            <p className={layout.body} style={{ marginTop: 'var(--s-3)' }}>
              {brief.grievance}
            </p>
          </section>

          <div className={styles.columns}>
            <section className={`${layout.card} ${cls(2)}`} aria-labelledby="brief-facts">
              <h2 className={layout.sectionTitle} id="brief-facts">
                {simple ? 'What we know' : 'Known facts'}
              </h2>
              <ul className={styles.list}>
                {brief.knownFacts.map((f, i) => (
                  <li key={i} className={`${styles.item} ${styles.fact}`}>
                    <span className={styles.mark}>
                      <StatusIcon kind="resolved" size={18} title="Known" />
                    </span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </section>

            <section className={`${layout.card} ${cls(3)}`} aria-labelledby="brief-claims">
              <h2 className={layout.sectionTitle} id="brief-claims">
                {simple ? 'What people are saying (not checked)' : 'Unverified claims'}
              </h2>
              <ul className={styles.list}>
                {brief.unverifiedClaims.map((c, i) => (
                  <li key={i} className={`${styles.item} ${styles.claim}`}>
                    <span className={styles.mark}>
                      <StatusIcon kind="unresolved" size={18} title="Unverified" />
                    </span>
                    <span>{c}</span>
                  </li>
                ))}
              </ul>
            </section>
          </div>

          <section className={`${layout.card} ${cls(4)}`} aria-labelledby="brief-role">
            <h2 className={layout.sectionTitle} id="brief-role">
              {simple ? 'Your job' : 'Your responsibility'}
            </h2>
            <p className={layout.lead}>{brief.responsibility}</p>
          </section>

          <section className={`${layout.card} ${cls(5)}`} aria-labelledby="brief-opponents">
            <h2 className={layout.sectionTitle} id="brief-opponents">
              {simple ? 'Trouble makers' : 'Working against you'}
            </h2>
            {opponents.length > 0 ? (
              <div className={layout.chips}>
                {opponents.map((id) => (
                  <OpponentChip key={id} id={id} size="lg" animated={!reducedMotion} />
                ))}
              </div>
            ) : (
              <p className={layout.body}>{simple ? 'No trouble makers this time. Just the problem itself.' : 'No simulated opponents this time — only the situation itself.'}</p>
            )}
          </section>

          <section className={`${layout.card} ${cls(6)}`} aria-labelledby="brief-objective">
            <h2 className={layout.sectionTitle} id="brief-objective">
              {simple ? `You have about ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}` : 'Objective'}
            </h2>
            <div className={styles.objective}>
              <p className={layout.lead}>{brief.objective}</p>
              <span className={styles.timerChip} aria-label={`Time available ${timerLabel}`}>
                <ClockIcon size={20} />
                {timerLabel}
                <small>
                  {simple
                    ? settings.autoPauseOnDecision
                      ? 'the clock waits for you'
                      : 'on the clock'
                    : settings.timerPace === 'standard'
                      ? 'standard pace'
                      : settings.timerPace === 'relaxed'
                        ? 'relaxed pace'
                        : 'extended pace'}
                </small>
              </span>
            </div>
          </section>

          <div className={layout.actionBar}>
            <span className={layout.muted}>{simple ? 'You can pause any time.' : 'You can pause at any time. Nothing is decided until you act.'}</span>
            <Button variant="primary" size="lg" onClick={() => startChapter()} data-testid="briefing-start" className={complete && !reducedMotion ? styles.pulseCta : undefined}>
              {simple ? SIMPLE_UI.takeCommand : 'Take command'}
            </Button>
          </div>
        </div>
      </div>
    </ScreenShell>
  );
}
