import { useEffect, useMemo, useState } from 'react';
import type { CampaignResult } from '@/engine/types';
import { OUTCOME_LABELS } from '@/engine/types';
import { getDailySpec, getScenario } from '@/engine';
import { SIMPLE_DIMENSIONS, SIMPLE_OUTCOMES, scenarioTitle, simpleModeLabel, simpleValue, starsFor, useSimple } from '@/app/simple';
import { Stars } from '@/components/results/Stars';
import { Button, ScreenShell, useApp } from '@/components/results/deps';
import layout from '@/components/results/layout.module.css';
import { ScoreDisplay } from '@/components/results/ScoreDisplay';
import { DimensionBreakdown } from '@/components/results/DimensionBreakdown';
import { Checklist } from '@/components/results/Checklist';
import { SimulatedBand } from '@/components/results/SimulatedBand';
import { ShareSheet } from '@/components/results/ShareSheet';
import { encodeDailyChallenge } from '@/engine/challenge';
import { HomeIcon, ReplayIcon, ShareIcon } from '@/components/results/icons';
import { OUTCOME_DESCRIPTIONS, OUTCOME_TONE, copyText, dateFromKey, localDateKey } from '@/components/results/format';
import { CityScene, sceneFromScores } from '@/components/republic/CityScene';
import { KeyDecisionCard } from '@/components/results/KeyDecisionCard';
import { DailyResultPanel } from '@/components/daily/DailyResultPanel';
import { CommunitySlot } from '@/components/daily/CommunitySlot';
import { track } from '@/analytics';
import styles from './FinalResultScreen.module.css';

function keyHeading(scenarioId: CampaignResult['chapters'][number]['scenarioId']): string {
  try {
    return `Most consequential decision · Chapter ${getScenario(scenarioId).chapter}`;
  } catch {
    return 'Most consequential decision';
  }
}

function missedTitle(scenarioId: CampaignResult['chapters'][number]['scenarioId'], id: string, title: string): string {
  try {
    return getScenario(scenarioId).evidence.find((e) => e.id === id)?.simple?.title ?? title;
  } catch {
    return title;
  }
}

function modeLabel(result: CampaignResult): string {
  switch (result.mode) {
    case 'daily':
      return "Today's Republic Crisis";
    case 'challenge':
      return 'Friend challenge';
    case 'replay':
      return 'Replay';
    default:
      return result.chapters.length > 1 ? `Complete campaign · ${result.chapters.length} chapters` : 'Campaign';
  }
}

export function FinalResultScreen() {
  const screen = useApp((s) => s.screen);
  const lastCampaign = useApp((s) => s.lastCampaign);
  const history = useApp((s) => s.history);
  const bests = useApp((s) => s.bests);
  const intent = useApp((s) => s.intent);
  const reducedMotion = useApp((s) => s.reducedMotion);
  const navigate = useApp((s) => s.navigate);
  const replayLast = useApp((s) => s.replayLast);
  const toast = useApp((s) => s.toast);
  const simple = useSimple();
  const lastDaily = useApp((s) => s.lastDaily);
  const newAccomplishments = useApp((s) => s.newAccomplishments);
  const [shareOpen, setShareOpen] = useState(false);
  useEffect(() => {
    if (lastDaily?.official) track('official_result_viewed', { mode: simple ? 'simple' : 'full', dailyId: lastDaily.dailyId, official: true });
  }, [lastDaily, simple]);

  const resultId = screen.name === 'final-result' ? screen.resultId : undefined;
  const result = useMemo(() => {
    if (resultId) {
      const entry = history.find((h) => h.id === resultId || h.campaign?.id === resultId);
      if (entry?.campaign) return entry.campaign;
    }
    return lastCampaign;
  }, [resultId, history, lastCampaign]);

  if (!result) {
    return (
      <ScreenShell title={simple ? 'How your city did' : 'Republic result'} onBack={() => navigate({ name: 'home' }, { replace: true })} testId="final-result-screen">
        <div className={`${layout.page} ${layout.narrow}`}>
          <div className={`${layout.card} ${layout.emptyState}`}>
            <h1 className={layout.h2}>{simple ? 'No result yet.' : 'No Republic result yet.'}</h1>
            <p className={layout.body}>{simple ? "Finish the story, today's challenge or a friend game to see how your city did." : 'Complete a campaign, a daily crisis or a friend challenge to see how your Republic held up.'}</p>
            <Button variant="primary" onClick={() => navigate({ name: 'home' }, { replace: true })} data-testid="final-home">
              Go home
            </Button>
          </div>
        </div>
      </ScreenShell>
    );
  }

  const tone = OUTCOME_TONE[result.outcome];
  const scene = sceneFromScores(result.finalScores);
  const isDaily = result.mode === 'daily';
  const bestEntry = isDaily ? bests.daily : bests.campaign;
  const isNewBest =
    !bestEntry ||
    result.score > bestEntry.score ||
    (isDaily
      ? (bestEntry as { date?: string }).date === localDateKey(result.completedAt) && bestEntry.score === result.score
      : (bestEntry as { at?: string }).at === result.completedAt && bestEntry.score === result.score);
  const bestLine = !bestEntry || isNewBest
    ? bestEntry && bestEntry.score === result.score && !isNewBest
      ? simple ? 'Same as your best score' : 'Matches your personal best'
      : simple ? 'New best score!' : 'New personal best'
    : simple ? `Best score: ${Math.round(bestEntry.score)}` : `Personal best: ${Math.round(bestEntry.score)}`;
  const outcomeLabel = simple ? SIMPLE_OUTCOMES[result.outcome].label : OUTCOME_LABELS[result.outcome];
  const outcomeText = simple ? SIMPLE_OUTCOMES[result.outcome].summary : OUTCOME_DESCRIPTIONS[result.outcome];
  const simpleLabels = Object.fromEntries(Object.entries(SIMPLE_DIMENSIONS).map(([k, v]) => [k, v.label])) as Record<keyof typeof SIMPLE_DIMENSIONS, string>;

  const challengerScore = result.mode === 'challenge' ? intent?.challenge?.score : undefined;
  const dailySpec = isDaily ? intent?.daily ?? getDailySpec(dateFromKey(localDateKey(result.completedAt))) : undefined;

  const copyCode = async () => {
    const ok = await copyText(result.challengeCode);
    toast({ text: ok ? 'Challenge code copied.' : 'Could not copy the code.', kind: ok ? 'success' : 'warning', duration: 2400 });
  };

  if (isDaily && lastDaily && lastDaily.result && (!resultId || lastDaily.result.completedAt === result.completedAt)) {
    const stats = result.chapters[0]?.stats;
    const republicDelta = (lastDaily as { republicDelta?: Partial<import('@/engine/types').RepublicCondition> }).republicDelta;
    return (
      <ScreenShell title={simple ? "Today's result" : 'Daily result'} onBack={() => navigate({ name: 'home' })} narrow testId="final-result-screen">
        <div className={layout.page}>
          <span className="sr-only" data-testid="final-score">
            {result.score}
          </span>
          <DailyResultPanel
            dailyId={lastDaily.dailyId}
            official={lastDaily.official}
            result={lastDaily.result}
            record={lastDaily.record}
            stats={stats}
            republicDelta={republicDelta}
            friend={lastDaily.friend}
            newAccomplishments={newAccomplishments}
            reducedMotion={reducedMotion}
            onShare={() => setShareOpen(true)}
            onCalendar={() => navigate({ name: 'calendar' })}
            onHome={() => navigate({ name: 'home' })}
            community={<CommunitySlot dailyId={lastDaily.dailyId} mine={lastDaily.record.official?.score} />}
          />
          <Button variant="ghost" size="sm" onClick={() => replayLast()} data-testid="final-replay">
            {simple ? 'Play it again (practice)' : 'Replay as practice'}
          </Button>
        </div>
        <ShareSheet
          open={shareOpen}
          onClose={() => setShareOpen(false)}
          result={result}
          daily={{
            dailyId: lastDaily.dailyId,
            result: lastDaily.result,
            official: lastDaily.official,
            code: encodeDailyChallenge({ dailyId: lastDaily.dailyId, score: lastDaily.result.score, fingerprint: lastDaily.result.fingerprint, outcome: lastDaily.result.outcome }),
          }}
        />
      </ScreenShell>
    );
  }

  return (
    <ScreenShell title={simple ? 'How your city did' : 'Republic result'} onBack={() => navigate({ name: 'home' })} testId="final-result-screen">
      <div className={layout.page}>
        <section className={styles.hero} aria-labelledby="final-outcome-heading">
          <CityScene {...scene} animated={!reducedMotion} title={`Your Republic after the crisis: ${outcomeLabel}`} className={styles.scene} />
          <div className={[styles.shade, tone === 'poor' ? styles.shadePoor : ''].join(' ')} aria-hidden="true" />
          <div className={styles.heroContent}>
            <ScoreDisplay score={result.score} label={simple ? 'Your score' : 'Republic score'} size="11rem" testId="final-score" animated={!reducedMotion} />
            <div className={styles.heroText}>
              <p className={layout.kicker}>{simple ? simpleModeLabel(result.mode, result.chapters.length) : modeLabel(result)}</p>
              <h1 className={styles.outcome} id="final-outcome-heading" data-testid="final-outcome" data-outcome={result.outcome}>
                {outcomeLabel}
              </h1>
              {simple && <Stars count={starsFor(result.score)} size={34} />}
              <p className={layout.lead}>{outcomeText}</p>
              <span className={[styles.best, isNewBest ? styles.bestNew : ''].join(' ')} data-testid="final-best">
                {bestLine}
              </span>
            </div>
          </div>
        </section>

        <div className={`${layout.actionBar} ${layout.actionsStatic}`}>
          <Button variant="primary" size="lg" onClick={() => setShareOpen(true)} data-testid="final-challenge">
            <span className={styles.btnInner}>
              <ShareIcon size={18} />
              {simple ? 'Challenge a friend' : 'Challenge friends'}
            </span>
          </Button>
          <Button variant="secondary" size="lg" onClick={() => replayLast()} data-testid="final-replay">
            <span className={styles.btnInner}>
              <ReplayIcon size={18} />
              {simple ? 'Play it again' : 'Replay same challenge'}
            </span>
          </Button>
          <Button variant="ghost" size="lg" onClick={() => navigate({ name: 'home' })} data-testid="final-home">
            <span className={styles.btnInner}>
              <HomeIcon size={18} />
              Home
            </span>
          </Button>
        </div>

        {challengerScore !== undefined && (
          <section className={layout.card} aria-labelledby="final-compare">
            <h2 className={layout.sectionTitle} id="final-compare">
              {simple ? 'You vs your friend' : 'Against the challenger'}
            </h2>
            <div className={styles.compare}>
              <p className={styles.compareLine}>
                You {Math.round(result.score)} · {simple ? 'Friend' : 'Challenger'} {Math.round(challengerScore)}
              </p>
              <p className={layout.body}>
                {simple
                  ? result.score > challengerScore
                    ? 'You did better! Send it back and see if they can catch up.'
                    : result.score < challengerScore
                      ? 'Your friend did better this time. Same game — try again!'
                      : 'A tie! Exactly the same score.'
                  : result.score > challengerScore
                    ? 'You held the Republic together better. Send it back and see if they can answer.'
                    : result.score < challengerScore
                      ? 'The challenger held firmer this time. Same seed, same events — try again.'
                      : 'An exact tie. The same seed, the same events, the same balance.'}
              </p>
            </div>
          </section>
        )}

        <section className={layout.card} aria-labelledby="final-dims">
          <h2 className={layout.sectionTitle} id="final-dims">
            {simple ? 'How your city did' : 'Six dimensions'}
          </h2>
          <DimensionBreakdown scores={result.finalScores} columns={2} animated={!reducedMotion} labels={simple ? simpleLabels : undefined} />
        </section>

        <div className={layout.grid2}>
          {result.mostConsequential ? (
            <KeyDecisionCard decision={result.mostConsequential} heading={simple ? 'Your biggest choice' : keyHeading(result.mostConsequential.scenarioId)} simple={simple} />
          ) : (
            <section className={layout.card}>
              <h2 className={layout.sectionTitle}>{simple ? 'Your biggest choice' : 'Most consequential decision'}</h2>
              <p className={layout.body}>{simple ? 'No single choice stood out this time.' : 'No single decision dominated this result.'}</p>
            </section>
          )}
          <section className={layout.card} aria-labelledby="final-missed">
            <h2 className={layout.sectionTitle} id="final-missed">
              {simple ? 'Clues you missed' : 'Missed evidence'}
            </h2>
            <Checklist
              items={result.missedEvidence.map((m) => ({ id: `${m.scenarioId}-${m.id}`, kind: 'missed', text: <strong>{simple ? missedTitle(m.scenarioId, m.id, m.title) : m.title}</strong>, meta: simple ? undefined : m.note }))}
              emptyText={simple ? 'You checked every clue that mattered. Great job!' : 'You resolved every piece of evidence that mattered.'}
            />
          </section>
        </div>

        {result.chapters.length > 0 && (
          <section className={layout.card} aria-labelledby="final-chapters">
            <h2 className={layout.sectionTitle} id="final-chapters">
              Chapters
            </h2>
            <ul className={styles.chapters}>
              {result.chapters.map((c) => {
                let title = `Chapter ${c.chapter}`;
                try {
                  title = scenarioTitle(getScenario(c.scenarioId), simple);
                } catch {
                  /* keep fallback */
                }
                return (
                  <li key={c.scenarioId} className={styles.chapterRow}>
                    <span className={styles.chapterName}>
                      <strong>{title}</strong>
                      <span>Chapter {c.chapter}</span>
                    </span>
                    <span className={styles.chapterScore} aria-label={`Chapter score ${Math.round(c.score)}`}>
                      {Math.round(c.score)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <section className={layout.card} aria-labelledby="final-values">
          <h2 className={layout.sectionTitle} id="final-values">
            {simple ? 'What you protected' : 'Values protected'}
          </h2>
          {result.valuesProtected.length > 0 ? (
            <div className={layout.chips}>
              {result.valuesProtected.map((v) => (
                <span key={v} className={`${layout.chip} ${layout.chipGood}`}>
                  {simpleValue(v, simple)}
                </span>
              ))}
            </div>
          ) : (
            <p className={layout.body}>{simple ? 'Nothing was clearly protected this time. Next time, start by listening and checking the clues.' : 'No value was clearly protected this time. Next time, start with the grievance and the evidence.'}</p>
          )}
        </section>

        {dailySpec && (
          <section className={layout.card} aria-labelledby="final-band">
            <h2 className={layout.sectionTitle} id="final-band">
              {simple ? "Today's range" : "Today's comparison"}
            </h2>
            <SimulatedBand band={dailySpec.simulatedBand} mine={result.score} />
          </section>
        )}

        <section className={`${layout.card} ${layout.cardTight}`} aria-labelledby="final-code">
          <div className={`${layout.row} ${layout.spread}`}>
            <div>
              <h2 className={layout.sectionTitle} id="final-code" style={{ marginBottom: '0.2rem' }}>
                {simple ? 'Code for friends' : 'Challenge code'}
              </h2>
              <span className={styles.codeInline}>{result.challengeCode}</span>
            </div>
            <Button variant="secondary" size="sm" onClick={copyCode}>
              Copy code
            </Button>
          </div>
        </section>
      </div>
      <ShareSheet open={shareOpen} onClose={() => setShareOpen(false)} result={result} />
    </ScreenShell>
  );
}
