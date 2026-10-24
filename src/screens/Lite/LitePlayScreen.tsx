import { useEffect, useState } from 'react';
import { useApp } from '@/app/store';
import { Button } from '@/components/ui';
import { SIMPLE_OUTCOMES, SIMPLE_STATES, cityMood, starsFor } from '@/app/simple';
import { classifyOutcome, computeChapterResult, evidenceActions } from '@/engine';
import type { ActionFeedback, DecisionOption, ScenarioDecision, ScenarioEvidence } from '@/engine/types';
import { strategicFeedback } from '@/progression/feedback';
import s from './LitePlayScreen.module.css';

/**
 * Lite: the simplest possible way to play Chapter 1. One card at a time, self-paced.
 * No map, no pulse, no timer, no tray. The real simulation runs underneath; "Next" advances
 * game time until something needs an answer.
 */

type Step =
  | { kind: 'begin' }
  | { kind: 'clue'; evidence: ScenarioEvidence; decision: ScenarioDecision }
  | { kind: 'clue-result'; evidence: ScenarioEvidence }
  | { kind: 'decision'; decision: ScenarioDecision }
  | { kind: 'feedback'; option: DecisionOption; decision: ScenarioDecision; feedback?: ActionFeedback }
  | { kind: 'rights'; id: string }
  | { kind: 'rights-result'; id: string; optionId: string }
  | { kind: 'ended' };

const MAX_TICKS = 400;

export function LitePlayScreen() {
  const game = useApp((st) => st.game);
  const scenario = useApp((st) => st.scenario);
  const dispatch = useApp((st) => st.dispatch);
  const startLite = useApp((st) => st.startLite);
  const abandonCampaign = useApp((st) => st.abandonCampaign);
  const navigate = useApp((st) => st.navigate);
  const [overlay, setOverlay] = useState<Step | null>(null);
  const [choices, setChoices] = useState(0);

  const ready = Boolean(game && scenario && scenario.id === 'examination-crisis');

  /** Advance game time until a decision or rights moment appears, or the chapter ends. */
  const advance = () => {
    let guard = 0;
    while (guard++ < MAX_TICKS) {
      const g = useApp.getState().game;
      if (!g || g.status === 'ended') return;
      if (g.pendingDecisionIds.length || g.pendingRightsIds.length) return;
      if (g.status === 'paused') useApp.getState().resumeGame();
      const before = useApp.getState().game?.tick;
      useApp.getState().tickGame(1);
      if (useApp.getState().game?.tick === before) return; // nothing moves (paused for another reason)
    }
  };

  useEffect(() => {
    if (!ready) return;
    const g = useApp.getState().game;
    if (g && g.tick === 0 && g.status === 'running' && !g.pendingDecisionIds.length && !overlay) setOverlay({ kind: 'begin' });
  }, [ready, overlay]);

  if (!ready || !game || !scenario) {
    return (
      <main className={s.screen} data-testid="lite-screen">
        <div className={s.card}>
          <p className={s.kicker}>Chapter 1</p>
          <h1 className={s.title}>The Exam Leak</h1>
          <p className={s.text}>Students think the exam leaked. Help the city stay calm and fair.</p>
          <Button variant="primary" size="lg" block onClick={startLite} data-testid="lite-start">
            Start
          </Button>
        </div>
      </main>
    );
  }

  const decisionOf = (id: string) => scenario.decisions.find((d) => d.id === id)!;
  const evidenceOf = (id: string) => scenario.evidence.find((e) => e.id === id)!;
  const simpleOption = (d: ScenarioDecision, o: DecisionOption) => d.simple?.options[o.id];

  // Which clue (if any) should be checked before the current decision.
  const clueFor = (d: ScenarioDecision): ScenarioEvidence | undefined => {
    for (const o of d.options) {
      for (const evId of o.requiresEvidence ?? []) {
        const es = game.evidence[evId];
        if (!es || !es.visible || es.destroyed) continue;
        if (es.state === 'unverified' || es.state === 'unknown') return evidenceOf(evId);
      }
    }
    return undefined;
  };

  const current: Step = (() => {
    if (overlay) return overlay;
    if (game.status === 'ended') return { kind: 'ended' };
    const rightsId = game.pendingRightsIds[0];
    if (rightsId) return { kind: 'rights', id: rightsId };
    const decisionId = game.pendingDecisionIds[0];
    if (decisionId) {
      const decision = decisionOf(decisionId);
      const clue = clueFor(decision);
      if (clue && !game.evidence[clue.id].inspected) return { kind: 'clue', evidence: clue, decision };
      return { kind: 'decision', decision };
    }
    return { kind: 'begin' };
  })();

  const next = () => {
    setOverlay(null);
    advance();
  };

  const checkClue = (ev: ScenarioEvidence) => {
    const tick = () => useApp.getState().game!.tick;
    for (const verb of ['inspect', 'compare', 'preserve'] as const) {
      const acts = evidenceActions(useApp.getState().game!, scenario, ev.id).filter((a) => a.enabled && a.verb === verb);
      for (const a of acts) dispatch({ type: 'evidence', tick: tick(), evidenceId: ev.id, verb, compareWith: a.compareWith });
    }
    setOverlay({ kind: 'clue-result', evidence: ev });
  };

  const choose = (d: ScenarioDecision, o: DecisionOption) => {
    dispatch({ type: 'decide', tick: game.tick, decisionId: d.id, optionId: o.id });
    setChoices((n) => n + 1);
    setOverlay({ kind: 'feedback', option: o, decision: d, feedback: useApp.getState().game?.lastFeedback });
  };

  const answerRights = (id: string, optionId: string) => {
    dispatch({ type: 'rights', tick: game.tick, momentId: id, optionId });
    setOverlay({ kind: 'rights-result', id, optionId });
  };

  const mood = cityMood(game.scores);
  const progress = Math.min(100, Math.round((game.tick / game.duration) * 100));

  const finish = () => {
    abandonCampaign();
    navigate({ name: 'home' });
  };

  return (
    <main className={s.screen} data-testid="lite-screen" data-step={current.kind}>
      <header className={s.top}>
        <button type="button" className={s.back} onClick={finish} aria-label="Leave">
          ‹
        </button>
        <div className={s.progress} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} aria-label="Chapter progress">
          <span style={{ width: `${progress}%` }} />
        </div>
        <span className={s.mood} data-tone={mood.tone}>
          {mood.label}
        </span>
      </header>

      {current.kind === 'begin' && (
        <section className={s.card} aria-live="polite">
          <p className={s.kicker}>Chapter 1</p>
          <h1 className={s.title}>{scenario.simple?.title ?? scenario.title}</h1>
          <p className={s.text}>{scenario.simple?.briefing?.grievance ?? scenario.briefing.grievance}</p>
          <Button variant="primary" size="lg" block onClick={next} data-testid="lite-next">
            Begin
          </Button>
        </section>
      )}

      {current.kind === 'clue' && (
        <section className={s.card} aria-live="polite">
          <p className={s.kicker}>A clue arrived</p>
          <h1 className={s.title}>{current.evidence.simple?.title ?? current.evidence.title}</h1>
          <p className={s.text}>{current.evidence.simple?.claim ?? current.evidence.claim}</p>
          <Button variant="primary" size="lg" block onClick={() => checkClue(current.evidence)} data-testid="lite-check">
            Check it
          </Button>
          <Button variant="ghost" size="md" block onClick={() => setOverlay({ kind: 'decision', decision: current.decision })} data-testid="lite-skip-clue">
            Skip
          </Button>
        </section>
      )}

      {current.kind === 'clue-result' && (() => {
        const es = useApp.getState().game!.evidence[current.evidence.id];
        const st = SIMPLE_STATES[es.state];
        return (
          <section className={s.card} aria-live="polite">
            <p className={s.kicker}>You checked it</p>
            <h1 className={s.title} data-state={es.state}>
              {st.label}
            </h1>
            <p className={s.text}>{es.state === 'unverified' || es.state === 'unknown' ? st.help : current.evidence.simple?.resolutionNote ?? current.evidence.resolutionNote}</p>
            <Button variant="primary" size="lg" block onClick={() => setOverlay(null)} data-testid="lite-next">
              Next
            </Button>
          </section>
        );
      })()}

      {current.kind === 'decision' && (
        <section className={s.card} aria-live="polite">
          <p className={s.kicker}>Choice {choices + 1}</p>
          <h1 className={s.title}>{current.decision.simple?.title ?? current.decision.title}</h1>
          <p className={s.text}>{current.decision.simple?.situation ?? current.decision.situation}</p>
          <div className={s.options}>
            {current.decision.options.map((o) => {
              const needsClue = (o.requiresEvidence ?? []).some((id) => {
                const es = game.evidence[id];
                return es && es.visible && !es.destroyed && (es.state === 'unverified' || es.state === 'unknown');
              });
              return (
                <button key={o.id} type="button" className={s.option} onClick={() => choose(current.decision, o)} data-testid={`lite-option-${o.id}`}>
                  <span>{simpleOption(current.decision, o)?.title ?? o.title}</span>
                  {needsClue ? <small>Clue not checked</small> : null}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {current.kind === 'feedback' && (
        <section className={s.card} aria-live="polite">
          <p className={s.kicker}>What happened</p>
          <h1 className={s.title}>{simpleOption(current.decision, current.option)?.title ?? current.option.title}</h1>
          <p className={s.text}>{simpleOption(current.decision, current.option)?.consequence ?? current.feedback?.text ?? current.option.consequence}</p>
          {current.feedback?.warning === 'false-accusation' && <p className={s.warn}>That clue was fake. People feel less free and trust you less.</p>}
          {current.feedback?.warning === 'disproportionate' && <p className={s.warn}>That was too harsh. People feel less free.</p>}
          <p className={s.moodLine} data-tone={mood.tone}>
            City: {mood.label}
          </p>
          <Button variant="primary" size="lg" block onClick={next} data-testid="lite-next">
            Next
          </Button>
        </section>
      )}

      {current.kind === 'rights' && (() => {
        const rm = scenario.rightsMoments.find((r) => r.id === current.id)!;
        return (
          <section className={s.card} aria-live="polite">
            <p className={s.kicker}>Fair play</p>
            <h1 className={s.title}>{rm.simple?.question ?? rm.question}</h1>
            <div className={s.options}>
              {rm.options.map((o) => (
                <button key={o.id} type="button" className={s.option} onClick={() => answerRights(rm.id, o.id)} data-testid={`lite-rights-${o.id}`}>
                  <span>{rm.simple?.options[o.id] ?? o.text}</span>
                </button>
              ))}
            </div>
          </section>
        );
      })()}

      {current.kind === 'rights-result' && (() => {
        const rm = scenario.rightsMoments.find((r) => r.id === current.id)!;
        const opt = rm.options.find((o) => o.id === current.optionId)!;
        return (
          <section className={s.card} aria-live="polite">
            <p className={s.kicker}>{opt.correct ? 'Yes, that is fair' : 'Not quite'}</p>
            <h1 className={s.title}>{rm.simple?.principle ?? rm.principle}</h1>
            <p className={s.text}>{rm.simple?.feedback?.[opt.id] ?? opt.feedback}</p>
            <p className={s.fine}>Educational content—not legal advice</p>
            <Button variant="primary" size="lg" block onClick={next} data-testid="lite-next">
              Next
            </Button>
          </section>
        );
      })()}

      {current.kind === 'ended' && (() => {
        const result = computeChapterResult(game, scenario, new Date(0).toISOString());
        const outcome = SIMPLE_OUTCOMES[classifyOutcome(result.scores)];
        const stars = starsFor(result.score);
        return (
          <section className={s.card} aria-live="polite" data-testid="lite-result">
            <p className={s.kicker}>Chapter done</p>
            <p className={s.score} data-testid="lite-score">
              {result.score}
            </p>
            <p className={s.stars} aria-label={`${stars} of 3 stars`}>
              {'★'.repeat(stars)}
              <span>{'★'.repeat(3 - stars)}</span>
            </p>
            <h1 className={s.title}>{outcome.label}</h1>
            <p className={s.text}>{strategicFeedback(result.fingerprint, result, true)}</p>
            <p className={s.text}>{outcome.summary}</p>
            <Button variant="primary" size="lg" block onClick={startLite} data-testid="lite-again">
              Play again
            </Button>
            <Button variant="ghost" size="md" block onClick={finish} data-testid="lite-home">
              Home
            </Button>
          </section>
        );
      })()}
    </main>
  );
}
