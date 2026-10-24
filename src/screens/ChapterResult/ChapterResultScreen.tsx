import { useMemo } from 'react';
import { OPPONENTS, getScenario } from '@/engine';
import { Button, CityMap, ScreenShell, useApp } from '@/components/results/deps';
import layout from '@/components/results/layout.module.css';
import { ScoreDisplay } from '@/components/results/ScoreDisplay';
import { DimensionBreakdown } from '@/components/results/DimensionBreakdown';
import { Checklist } from '@/components/results/Checklist';
import { StatusIcon } from '@/components/results/icons';
import { KeyDecisionCard } from '@/components/results/KeyDecisionCard';
import { CityScene, sceneFromScores } from '@/components/republic/CityScene';
import styles from './ChapterResultScreen.module.css';

export function ChapterResultScreen() {
  const result = useApp((s) => s.lastChapter);
  const map = useApp((s) => s.map);
  const intentChallenge = useApp((s) => s.intent?.challenge);
  const settings = useApp((s) => s.settings);
  const reducedMotion = useApp((s) => s.reducedMotion);
  const nextChapter = useApp((s) => s.nextChapter);
  const navigate = useApp((s) => s.navigate);

  const scenario = useMemo(() => {
    if (!result) return undefined;
    try {
      return getScenario(result.scenarioId);
    } catch {
      return undefined;
    }
  }, [result]);

  if (!result) {
    return (
      <ScreenShell title="Chapter result" onBack={() => navigate({ name: 'home' }, { replace: true })} testId="chapter-result-screen">
        <div className={`${layout.page} ${layout.narrow}`}>
          <div className={`${layout.card} ${layout.emptyState}`}>
            <h1 className={layout.h2}>No chapter result to show.</h1>
            <p className={layout.body}>Finish a chapter and its outcome will appear here.</p>
            <Button variant="primary" onClick={() => navigate({ name: 'home' }, { replace: true })}>
              Go home
            </Button>
          </div>
        </div>
      </ScreenShell>
    );
  }

  const mode = result.config.mode;
  const singleChapter = mode === 'daily' || (mode === 'challenge' && intentChallenge !== undefined && intentChallenge.scenario !== 'campaign');
  const more = !singleChapter && result.chapter < 3;
  const ctaLabel = more ? (mode === 'campaign' || mode === 'challenge' ? `Continue to chapter ${result.chapter + 1}` : 'Continue') : 'See your Republic result';
  const scene = sceneFromScores(result.scores);

  return (
    <ScreenShell title={`Chapter ${result.chapter} complete`} onBack={() => navigate({ name: 'home' })} testId="chapter-result-screen">
      <div className={layout.page}>
        <section className={styles.hero} aria-label="The city after this chapter">
          {map ? (
            <div className={styles.heroMap} aria-hidden="true" inert>
              <CityMap
                map={map}
                reducedMotion={reducedMotion}
                highContrast={settings.highContrast}
                colourBlind={settings.colourBlindSafe}
                captions={false}
                onSelectDistrict={() => undefined}
              />
            </div>
          ) : (
            <CityScene {...scene} animated={!reducedMotion} title="" className={styles.heroScene} />
          )}
          <div className={styles.heroShade} aria-hidden="true" />
          <div className={styles.heroContent}>
            <div className={styles.heroText}>
              <p className={layout.kicker}>Chapter {result.chapter} complete</p>
              <h1 className={layout.h1}>{scenario?.title ?? 'Chapter complete'}</h1>
              <p className={styles.closing}>{result.closing}</p>
            </div>
            <div className={!reducedMotion ? styles.glow : undefined}>
              <ScoreDisplay score={result.score} label="Chapter score" size="10rem" testId="chapter-score" animated={!reducedMotion} />
            </div>
          </div>
        </section>

        <div className={layout.grid2}>
          <section className={layout.card} aria-labelledby="res-resolved">
            <h2 className={layout.sectionTitle} id="res-resolved">
              Resolved
            </h2>
            <Checklist items={result.resolved.map((t, i) => ({ id: `r${i}`, kind: 'resolved', text: t }))} emptyText="Nothing was fully resolved in the time available." />
          </section>
          <section className={layout.card} aria-labelledby="res-unresolved">
            <h2 className={layout.sectionTitle} id="res-unresolved">
              Still unresolved
            </h2>
            <Checklist items={result.unresolved.map((t, i) => ({ id: `u${i}`, kind: 'unresolved', text: t }))} emptyText="Nothing significant was left open." />
          </section>
        </div>

        <section className={layout.card} aria-labelledby="res-manip">
          <h2 className={layout.sectionTitle} id="res-manip">
            Manipulation attempts
          </h2>
          <Checklist
            items={result.manipulations.map((m) => ({
              id: m.evidenceId,
              kind: m.succeeded ? 'succeeded' : 'exposed',
              text: (
                <>
                  <strong>{m.title}</strong> — {OPPONENTS[m.opponent]?.name ?? 'Opponent'} {m.succeeded ? 'got through' : 'was exposed'}
                </>
              ),
              meta: m.note,
            }))}
            emptyText="No manipulated evidence reached you in this chapter."
          />
        </section>

        <div className={layout.grid2}>
          <section className={layout.card} aria-labelledby="res-protected">
            <h2 className={layout.sectionTitle} id="res-protected">
              Rights protected
            </h2>
            <Checklist items={result.rightsProtected.map((t, i) => ({ id: `p${i}`, kind: 'protected', text: t }))} emptyText="No right was clearly protected by your choices." />
          </section>
          <section className={layout.card} aria-labelledby="res-harmed">
            <h2 className={layout.sectionTitle} id="res-harmed">
              Rights harmed
            </h2>
            <Checklist items={result.rightsHarmed.map((t, i) => ({ id: `h${i}`, kind: 'harmed', text: t }))} emptyText="No right was harmed. That is the hard part — and you did it." />
          </section>
        </div>

        <section className={layout.card} aria-labelledby="res-improve">
          <h2 className={layout.sectionTitle} id="res-improve">
            One thing to try next time
          </h2>
          <div className={styles.improvement}>
            <span className={styles.improvementIcon} aria-hidden="true">
              <StatusIcon kind="info" size={20} />
            </span>
            <p className={layout.lead}>{result.improvement}</p>
          </div>
        </section>

        {result.keyDecision && <KeyDecisionCard decision={result.keyDecision} heading="Most consequential decision" />}

        <section className={layout.card} aria-labelledby="res-dims">
          <h2 className={layout.sectionTitle} id="res-dims">
            Six dimensions
          </h2>
          <DimensionBreakdown scores={result.scores} startScores={result.startScores} columns={2} animated={!reducedMotion} />
        </section>

        {result.missedEvidence.length > 0 && (
          <section className={layout.card} aria-labelledby="res-missed">
            <h2 className={layout.sectionTitle} id="res-missed">
              Evidence you never resolved
            </h2>
            <Checklist items={result.missedEvidence.map((m) => ({ id: m.id, kind: 'missed', text: <strong>{m.title}</strong>, meta: m.note }))} emptyText="" />
          </section>
        )}

        <div className={layout.actionBar}>
          <Button variant="primary" size="lg" onClick={() => nextChapter()} data-testid="chapter-continue">
            {ctaLabel}
          </Button>
        </div>
      </div>
    </ScreenShell>
  );
}
