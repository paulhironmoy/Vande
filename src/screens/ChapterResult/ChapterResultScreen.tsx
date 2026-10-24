import { useMemo } from 'react';
import type { ResolutionRule } from '@/engine/types';
import { OPPONENTS, getScenario } from '@/engine';
import { SIMPLE_DIMENSIONS, SIMPLE_OPPONENTS, scenarioTitle, simpleClosing, simpleRuleText, starsFor, useSimple } from '@/app/simple';
import { Stars } from '@/components/results/Stars';
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
  const simple = useSimple();

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
      <ScreenShell title={simple ? 'Chapter done!' : 'Chapter result'} onBack={() => navigate({ name: 'home' }, { replace: true })} testId="chapter-result-screen">
        <div className={`${layout.page} ${layout.narrow}`}>
          <div className={`${layout.card} ${layout.emptyState}`}>
            <h1 className={layout.h2}>{simple ? 'Nothing to show yet.' : 'No chapter result to show.'}</h1>
            <p className={layout.body}>{simple ? 'Finish a chapter and it will show up here.' : 'Finish a chapter and its outcome will appear here.'}</p>
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
  const ctaLabel = simple
    ? more
      ? 'Next chapter'
      : 'See how your city did'
    : more
      ? mode === 'campaign' || mode === 'challenge'
        ? `Continue to chapter ${result.chapter + 1}`
        : 'Continue'
      : 'See your Republic result';
  const scene = sceneFromScores(result.scores);
  const res = scenario?.resolution;
  const t = (rules: ResolutionRule[] | undefined, text: string) => simpleRuleText(rules, text, simple);
  const evidenceTitle = (id: string, title: string) => (simple ? (scenario?.evidence.find((e) => e.id === id)?.simple?.title ?? title) : title);

  return (
    <ScreenShell title={simple ? 'Chapter done!' : `Chapter ${result.chapter} complete`} onBack={() => navigate({ name: 'home' })} testId="chapter-result-screen">
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
                simple={simple}
              />
            </div>
          ) : (
            <CityScene {...scene} animated={!reducedMotion} title="" className={styles.heroScene} />
          )}
          <div className={styles.heroShade} aria-hidden="true" />
          <div className={styles.heroContent}>
            <div className={styles.heroText}>
              <p className={layout.kicker}>{simple ? `Chapter ${result.chapter} done` : `Chapter ${result.chapter} complete`}</p>
              <h1 className={layout.h1}>{scenario ? scenarioTitle(scenario, simple) : simple ? 'Chapter done!' : 'Chapter complete'}</h1>
              <p className={styles.closing}>{simpleClosing(scenario, result.closing, simple)}</p>
              {simple && <Stars count={starsFor(result.score)} size={30} caption={starsFor(result.score) === 3 ? 'Brilliant!' : starsFor(result.score) === 2 ? 'Well done!' : starsFor(result.score) === 1 ? 'Good try!' : 'Keep going!'} />}
            </div>
            <div className={!reducedMotion ? styles.glow : undefined}>
              <ScoreDisplay score={result.score} label={simple ? 'Your score' : 'Chapter score'} size="10rem" testId="chapter-score" animated={!reducedMotion} />
            </div>
          </div>
        </section>

        <div className={layout.grid2}>
          <section className={layout.card} aria-labelledby="res-resolved">
            <h2 className={layout.sectionTitle} id="res-resolved">
              {simple ? 'You fixed' : 'Resolved'}
            </h2>
            <Checklist items={result.resolved.map((x, i) => ({ id: `r${i}`, kind: 'resolved', text: t(res?.resolved, x) }))} emptyText={simple ? 'Nothing got fully fixed this time.' : 'Nothing was fully resolved in the time available.'} />
          </section>
          <section className={layout.card} aria-labelledby="res-unresolved">
            <h2 className={layout.sectionTitle} id="res-unresolved">
              {simple ? 'Still to fix' : 'Still unresolved'}
            </h2>
            <Checklist items={result.unresolved.map((x, i) => ({ id: `u${i}`, kind: 'unresolved', text: t(res?.unresolved, x) }))} emptyText={simple ? 'Nothing big was left.' : 'Nothing significant was left open.'} />
          </section>
        </div>

        <section className={layout.card} aria-labelledby="res-manip">
          <h2 className={layout.sectionTitle} id="res-manip">
            {simple ? 'Tricks' : 'Manipulation attempts'}
          </h2>
          <Checklist
            items={result.manipulations.map((m) => ({
              id: m.evidenceId,
              kind: m.succeeded ? 'succeeded' : 'exposed',
              text: simple ? (
                <>
                  <strong>{evidenceTitle(m.evidenceId, m.title)}</strong> — {SIMPLE_OPPONENTS[m.opponent]?.nickname ?? 'A trouble maker'} {m.succeeded ? 'tricked you' : 'was caught'}
                </>
              ) : (
                <>
                  <strong>{m.title}</strong> — {OPPONENTS[m.opponent]?.name ?? 'Opponent'} {m.succeeded ? 'got through' : 'was exposed'}
                </>
              ),
              meta: simple ? undefined : m.note,
            }))}
            emptyText={simple ? 'No fake clues reached you this chapter.' : 'No manipulated evidence reached you in this chapter.'}
          />
        </section>

        <div className={layout.grid2}>
          <section className={layout.card} aria-labelledby="res-protected">
            <h2 className={layout.sectionTitle} id="res-protected">
              {simple ? 'Fair play: you protected' : 'Rights protected'}
            </h2>
            <Checklist items={result.rightsProtected.map((x, i) => ({ id: `p${i}`, kind: 'protected', text: t(res?.rightsProtected, x) }))} emptyText={simple ? 'No right was clearly protected this time.' : 'No right was clearly protected by your choices.'} />
          </section>
          <section className={layout.card} aria-labelledby="res-harmed">
            <h2 className={layout.sectionTitle} id="res-harmed">
              {simple ? 'Fair play: you hurt' : 'Rights harmed'}
            </h2>
            <Checklist items={result.rightsHarmed.map((x, i) => ({ id: `h${i}`, kind: 'harmed', text: t(res?.rightsHarmed, x) }))} emptyText={simple ? 'You did not hurt anyone\u2019s rights. That is the hard part!' : 'No right was harmed. That is the hard part — and you did it.'} />
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

        {result.keyDecision && <KeyDecisionCard decision={result.keyDecision} heading={simple ? 'Your biggest choice' : 'Most consequential decision'} simple={simple} />}

        <section className={layout.card} aria-labelledby="res-dims">
          <h2 className={layout.sectionTitle} id="res-dims">
            {simple ? 'How your city did' : 'Six dimensions'}
          </h2>
          <DimensionBreakdown
            scores={result.scores}
            startScores={result.startScores}
            columns={2}
            animated={!reducedMotion}
            labels={simple ? (Object.fromEntries(Object.entries(SIMPLE_DIMENSIONS).map(([k, v]) => [k, v.label])) as Record<keyof typeof SIMPLE_DIMENSIONS, string>) : undefined}
          />
        </section>

        {result.missedEvidence.length > 0 && (
          <section className={layout.card} aria-labelledby="res-missed">
            <h2 className={layout.sectionTitle} id="res-missed">
              {simple ? 'Clues you missed' : 'Evidence you never resolved'}
            </h2>
            <Checklist items={result.missedEvidence.map((m) => ({ id: m.id, kind: 'missed', text: <strong>{evidenceTitle(m.id, m.title)}</strong>, meta: simple ? undefined : m.note }))} emptyText="" />
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
