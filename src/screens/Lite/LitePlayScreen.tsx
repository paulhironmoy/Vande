import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '@/app/store';
import { Button } from '@/components/ui';
import { SIMPLE_DIMENSIONS, SIMPLE_OUTCOMES, SIMPLE_STATES, cityMood, starsFor } from '@/app/simple';
import { checkCondition, classifyOutcome, computeChapterResult, evidenceActions } from '@/engine';
import { DIMENSIONS, type ActionFeedback, type Condition, type DecisionOption, type Dimension, type ScenarioDecision, type ScenarioEvidence, type Scores } from '@/engine/types';
import { strategicFeedback } from '@/progression/feedback';
import { playCue } from '@/audio/sounds';
import s from './LitePlayScreen.module.css';

/**
 * Lite: the simplest way to play Chapter 1, built as a game to win.
 * One card at a time, self-paced. Six city bars react to every choice, points pop, a calm streak multiplies,
 * missions tick off, and opponents appear as bugs you squash by checking clues. The real simulation runs underneath.
 */

type Step =
  | { kind: 'begin' }
  | { kind: 'clue'; evidence: ScenarioEvidence; decision: ScenarioDecision }
  | { kind: 'clue-result'; evidence: ScenarioEvidence; gained: number; label: string }
  | { kind: 'decision'; decision: ScenarioDecision }
  | { kind: 'feedback'; option: DecisionOption; decision: ScenarioDecision; feedback?: ActionFeedback; gained: number; parts: string[]; delta: Partial<Scores>; harsh: boolean }
  | { kind: 'rights'; id: string }
  | { kind: 'rights-result'; id: string; optionId: string; gained: number }
  | { kind: 'ended' };

const MAX_TICKS = 400;
const BEST_KEY = 'vande:lite-best';
const HARSH = new Set(['disproportionate', 'suppressive', 'censorship']);

/** Three short missions for Chapter 1 (same conditions as the chapter's resolution rules). */
const MISSIONS: { label: string; condition: Condition }[] = [
  { label: 'Start a proper check', condition: { flag: 'investigation-opened' } },
  { label: 'Prove the leak', condition: { anyFlag: ['leak-verified', 'strongroom-breach-confirmed'] } },
  { label: 'Catch the paper sellers', condition: { anyFlag: ['racket-arrest', 'racket-traced'] } },
];

function readBest(): number {
  try {
    return Number(localStorage.getItem(BEST_KEY) ?? 0) || 0;
  } catch {
    return 0;
  }
}
function writeBest(v: number) {
  try {
    localStorage.setItem(BEST_KEY, String(v));
  } catch {
    /* ignore */
  }
}

export function LitePlayScreen() {
  const game = useApp((st) => st.game);
  const scenario = useApp((st) => st.scenario);
  const dispatch = useApp((st) => st.dispatch);
  const startLite = useApp((st) => st.startLite);
  const abandonCampaign = useApp((st) => st.abandonCampaign);
  const navigate = useApp((st) => st.navigate);
  const reducedMotion = useApp((st) => st.reducedMotion);

  const [overlay, setOverlay] = useState<Step | null>(null);
  const [choices, setChoices] = useState(0);
  const [points, setPoints] = useState(0);
  const [streak, setStreak] = useState(0);
  const [bugs, setBugs] = useState(0);
  const [alert, setAlert] = useState<string | null>(null);
  const [best, setBest] = useState(readBest);
  const feedSeen = useRef(0);
  const finishedRef = useRef<string | undefined>(undefined);
  const campaignId = useApp((st) => st.campaign?.id);

  useEffect(() => {
    setOverlay(null);
    setChoices(0);
    setPoints(0);
    setStreak(0);
    setBugs(0);
    setAlert(null);
    setBest(readBest());
    feedSeen.current = useApp.getState().game?.feed.length ?? 0;
  }, [campaignId]);

  const ready = Boolean(game && scenario && scenario.id === 'examination-crisis');
  const ended = Boolean(ready && game?.status === 'ended');

  const summary = useMemo(() => {
    if (!ended || !game || !scenario) return undefined;
    const result = computeChapterResult(game, scenario, new Date(0).toISOString());
    const stars = starsFor(result.score);
    const done = MISSIONS.filter((m) => checkCondition(m.condition, game)).length;
    const missionBonus = done * 50;
    return { result, stars, done, missionBonus, total: points + missionBonus + stars * 100 };
  }, [ended, game, scenario, points]);

  useEffect(() => {
    if (!summary || !campaignId || finishedRef.current === campaignId) return;
    finishedRef.current = campaignId;
    if (summary.total > readBest()) writeBest(summary.total);
    playCue('chapterEnd');
  }, [summary, campaignId]);

  /** Advance game time until a decision or rights moment appears, or the chapter ends. Surfaces opponent moves as bug alerts. */
  const advance = () => {
    let guard = 0;
    while (guard++ < MAX_TICKS) {
      const g = useApp.getState().game;
      if (!g || g.status === 'ended') break;
      if (g.pendingDecisionIds.length || g.pendingRightsIds.length) break;
      if (g.status === 'paused') useApp.getState().resumeGame();
      const before = useApp.getState().game?.tick;
      useApp.getState().tickGame(1);
      if (useApp.getState().game?.tick === before) break;
    }
    const g = useApp.getState().game;
    if (g && scenario) {
      const fresh = g.feed.slice(feedSeen.current);
      feedSeen.current = g.feed.length;
      const opp = [...fresh].reverse().find((f) => f.kind === 'opponent');
      if (opp) {
        const ev = scenario.events.find((e) => e.message === opp.text);
        setAlert(ev?.simple ?? opp.text);
      } else setAlert(null);
    }
  };

  useEffect(() => {
    if (!ready) return;
    const g = useApp.getState().game;
    if (g && g.tick === 0 && g.status === 'running' && !g.pendingDecisionIds.length && !overlay) setOverlay({ kind: 'begin' });
  }, [ready, overlay]);

  const missions = MISSIONS;

  if (!ready || !game || !scenario) {
    return (
      <main className={s.screen} data-testid="lite-screen">
        <div className={s.card}>
          <p className={s.kicker}>Chapter 1</p>
          <h1 className={s.title}>The Exam Leak</h1>
          <p className={s.text}>Students think the exam leaked. Keep the city calm, fair and free. Earn three stars.</p>
          {best > 0 ? <p className={s.best}>Your best: {best} points</p> : null}
          <Button variant="primary" size="lg" block onClick={startLite} data-testid="lite-start">
            Play
          </Button>
        </div>
      </main>
    );
  }

  const decisionOf = (id: string) => scenario.decisions.find((d) => d.id === id)!;
  const evidenceOf = (id: string) => scenario.evidence.find((e) => e.id === id)!;
  const simpleOption = (d: ScenarioDecision, o: DecisionOption) => d.simple?.options[o.id];
  const clueChecked = (id: string) => {
    const es = game.evidence[id];
    return Boolean(es && (es.state === 'verified' || es.state === 'corroborated' || es.state === 'manipulated'));
  };
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
    const state = useApp.getState().game!.evidence[ev.id].state;
    let gained = 0;
    let label = 'Checked';
    if (state === 'manipulated') {
      gained = 200;
      label = 'Bug squashed!';
      setBugs((b) => b + 1);
      playCue('success');
    } else if (state === 'verified' || state === 'corroborated') {
      gained = 50;
      label = 'Good check';
      playCue('verify');
    }
    setPoints((p) => p + gained);
    setOverlay({ kind: 'clue-result', evidence: ev, gained, label });
  };

  const choose = (d: ScenarioDecision, o: DecisionOption) => {
    const before = game.scores;
    dispatch({ type: 'decide', tick: game.tick, decisionId: d.id, optionId: o.id });
    const after = useApp.getState().game!;
    const feedback = after.lastFeedback;
    const delta: Partial<Scores> = {};
    let pos = 0;
    let neg = 0;
    for (const k of DIMENSIONS) {
      const dv = Math.round(after.scores[k] - before[k]);
      if (dv !== 0) delta[k] = dv;
      if (dv > 0) pos += dv;
      else neg -= dv;
    }
    const harsh = o.tags.some((t) => HARSH.has(t)) || feedback?.warning === 'disproportionate' || feedback?.warning === 'false-accusation';
    const parts: string[] = [];
    let gained = Math.max(10, 100 + pos * 8 - neg * 8);
    parts.push(`${gained} for the choice`);
    const relied = (o.requiresEvidence ?? []).filter((id) => game.evidence[id]?.visible);
    if (relied.length && relied.every(clueChecked)) {
      gained *= 2;
      parts.push('×2 clue checked first');
    }
    const nextStreak = harsh ? 0 : streak + 1;
    if (nextStreak >= 2) {
      const mult = 1 + 0.25 * Math.min(nextStreak - 1, 4);
      gained = Math.round(gained * mult);
      parts.push(`×${mult.toFixed(2).replace(/\.?0+$/, '')} calm streak`);
    }
    setStreak(nextStreak);
    setPoints((p) => p + gained);
    setChoices((n) => n + 1);
    playCue(harsh ? 'danger' : 'confirm');
    setOverlay({ kind: 'feedback', option: o, decision: d, feedback, gained, parts, delta, harsh });
  };

  const answerRights = (id: string, optionId: string) => {
    dispatch({ type: 'rights', tick: game.tick, momentId: id, optionId });
    const rm = scenario.rightsMoments.find((r) => r.id === id)!;
    const correct = rm.options.find((o) => o.id === optionId)?.correct ?? false;
    const gained = correct ? 100 : 0;
    setPoints((p) => p + gained);
    playCue(correct ? 'success' : 'tap');
    setOverlay({ kind: 'rights-result', id, optionId, gained });
  };

  const mood = cityMood(game.scores);
  const progress = Math.min(100, Math.round((game.tick / game.duration) * 100));
  const achieved = missions.map((m) => checkCondition(m.condition, game));

  const finish = () => {
    abandonCampaign();
    navigate({ name: 'home' });
  };

  const bars = (delta?: Partial<Scores>) => (
    <ul className={s.bars} aria-label="City bars">
      {DIMENSIONS.map((d: Dimension) => {
        const v = Math.round(game.scores[d]);
        const dv = delta?.[d];
        return (
          <li key={d} className={s.bar} data-low={v < 40 ? 'true' : undefined}>
            <span className={s.barLabel}>{SIMPLE_DIMENSIONS[d].short}</span>
            <span className={s.barTrack}>
              <span className={s.barFill} style={{ width: `${v}%`, background: `var(--o-${d})` }} />
            </span>
            <span className={s.barValue}>
              {v}
              {dv ? <em className={dv > 0 ? s.up : s.down}>{dv > 0 ? `+${dv}` : dv}</em> : null}
            </span>
          </li>
        );
      })}
    </ul>
  );

  return (
    <main className={s.screen} data-testid="lite-screen" data-step={current.kind} data-reduced={reducedMotion ? 'true' : undefined}>
      <header className={s.top}>
        <button type="button" className={s.back} onClick={finish} aria-label="Leave">
          ‹
        </button>
        <div className={s.progress} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} aria-label="Chapter progress">
          <span style={{ width: `${progress}%` }} />
        </div>
        <span className={s.points} data-testid="lite-points" aria-label={`${points} points`}>
          {points}
          <small>pts</small>
        </span>
      </header>

      {current.kind !== 'begin' && current.kind !== 'ended' ? (
        <section className={s.hud} aria-label="How the city is doing">
          {bars(current.kind === 'feedback' ? current.delta : undefined)}
          <div className={s.hudRow}>
            <span className={s.mood} data-tone={mood.tone}>
              {mood.label}
            </span>
            {streak >= 2 ? <span className={s.streak}>Calm ×{streak}</span> : null}
            <span className={s.missions} aria-label={`${achieved.filter(Boolean).length} of ${missions.length} missions done`}>
              {missions.map((m, i) => (
                <span key={i} className={s.missionDot} data-done={achieved[i] ? 'true' : undefined} title={m.label} />
              ))}
              <small>missions</small>
            </span>
          </div>
        </section>
      ) : null}

      {current.kind === 'begin' && (
        <section className={s.card} aria-live="polite">
          <p className={s.kicker}>Chapter 1 · Your goal</p>
          <h1 className={s.title}>{scenario.simple?.title ?? scenario.title}</h1>
          <p className={s.text}>{scenario.simple?.subtitle ?? scenario.subtitle}</p>
          <ul className={s.goals}>
            <li>Keep all six bars above 40</li>
            <li>Squash fake clues: +200</li>
            <li>Fair choices in a row multiply points</li>
          </ul>
          <p className={s.kicker}>Missions</p>
          <ol className={s.missionList} aria-label="Missions">
            {missions.map((m, i) => (
              <li key={i}>{m.label}</li>
            ))}
          </ol>
          {best > 0 ? <p className={s.best}>Beat your best: {best} points</p> : null}
          <Button variant="primary" size="lg" block onClick={next} data-testid="lite-next">
            Begin
          </Button>
        </section>
      )}

      {current.kind === 'clue' && (
        <section className={s.card} aria-live="polite">
          {alert ? <p className={s.alert}>Bug alert: {alert}</p> : null}
          <p className={s.kicker}>A clue arrived</p>
          <h1 className={s.title}>{current.evidence.simple?.title ?? current.evidence.title}</h1>
          <p className={s.text}>{current.evidence.simple?.claim ?? current.evidence.claim}</p>
          <p className={s.hint}>Checking first doubles your next points. Fake clue? +200.</p>
          <Button variant="primary" size="lg" block onClick={() => checkClue(current.evidence)} data-testid="lite-check">
            Check it
          </Button>
          <Button variant="ghost" size="md" block onClick={() => setOverlay({ kind: 'decision', decision: current.decision })} data-testid="lite-skip-clue">
            Skip
          </Button>
        </section>
      )}

      {current.kind === 'clue-result' && (() => {
        const es = game.evidence[current.evidence.id];
        const st = SIMPLE_STATES[es.state];
        return (
          <section className={s.card} aria-live="polite">
            <p className={s.kicker}>{current.label}</p>
            <h1 className={s.title} data-state={es.state}>
              {st.label}
              {current.gained ? <span className={s.pop}>+{current.gained}</span> : null}
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
          {alert ? <p className={s.alert}>Bug alert: {alert}</p> : null}
          <p className={s.kicker}>Choice {choices + 1}</p>
          <h1 className={s.title}>{current.decision.simple?.title ?? current.decision.title}</h1>
          <p className={s.text}>{current.decision.simple?.situation ?? current.decision.situation}</p>
          <div className={s.options}>
            {current.decision.options.map((o) => {
              const needsClue = (o.requiresEvidence ?? []).some((id) => {
                const es = game.evidence[id];
                return es && es.visible && !es.destroyed && (es.state === 'unverified' || es.state === 'unknown');
              });
              const checked = (o.requiresEvidence ?? []).length > 0 && (o.requiresEvidence ?? []).every(clueChecked);
              return (
                <button key={o.id} type="button" className={s.option} onClick={() => choose(current.decision, o)} data-testid={`lite-option-${o.id}`}>
                  <span>{simpleOption(current.decision, o)?.title ?? o.title}</span>
                  {needsClue ? <small>Clue not checked</small> : checked ? <small className={s.bonus}>×2 clue checked</small> : null}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {current.kind === 'feedback' && (
        <section className={s.card} aria-live="polite" data-harsh={current.harsh ? 'true' : undefined}>
          <p className={s.kicker}>{current.harsh ? 'Hmm' : 'Nice'}</p>
          <h1 className={s.title}>
            +{current.gained}
            <small className={s.titleSub}>{simpleOption(current.decision, current.option)?.title ?? current.option.title}</small>
          </h1>
          <p className={s.text}>{simpleOption(current.decision, current.option)?.consequence ?? current.feedback?.text ?? current.option.consequence}</p>
          <ul className={s.parts}>
            {current.parts.map((p) => (
              <li key={p}>{p}</li>
            ))}
            {current.harsh ? <li className={s.partWarn}>Calm streak reset. People feel less free.</li> : null}
          </ul>
          <Button variant="primary" size="lg" block onClick={next} data-testid="lite-next">
            Next
          </Button>
        </section>
      )}

      {current.kind === 'rights' && (() => {
        const rm = scenario.rightsMoments.find((r) => r.id === current.id)!;
        return (
          <section className={s.card} aria-live="polite">
            <p className={s.kicker}>Fair play · +100 if you get it right</p>
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
            <h1 className={s.title}>
              {opt.correct ? '+100' : 'No points'}
              <small className={s.titleSub}>{rm.simple?.principle ?? rm.principle}</small>
            </h1>
            <p className={s.text}>{rm.simple?.feedback?.[opt.id] ?? opt.feedback}</p>
            <p className={s.fine}>Educational content—not legal advice</p>
            <Button variant="primary" size="lg" block onClick={next} data-testid="lite-next">
              Next
            </Button>
          </section>
        );
      })()}

      {current.kind === 'ended' && summary && (() => {
        const { result, stars, done, missionBonus, total } = summary;
        const outcome = SIMPLE_OUTCOMES[classifyOutcome(result.scores)];
        const newBest = total > best;
        return (
          <section className={s.card} aria-live="polite" data-testid="lite-result">
            <p className={s.kicker}>{newBest ? 'New best!' : 'Chapter done'}</p>
            <p className={s.stars} aria-label={`${stars} of 3 stars`}>
              {[0, 1, 2].map((i) => (
                <span key={i} className={i < stars ? s.starOn : s.starOff} style={{ animationDelay: `${i * 120}ms` }}>
                  ★
                </span>
              ))}
            </p>
            <p className={s.score} data-testid="lite-score">
              {total}
              <small>points</small>
            </p>
            <ul className={s.parts}>
              <li>{points} from choices and clues</li>
              <li>
                {done} of {missions.length} missions · +{missionBonus}
              </li>
              <li>
                {stars} {stars === 1 ? 'star' : 'stars'} · +{stars * 100}
              </li>
              {bugs ? <li>{bugs === 1 ? '1 bug squashed' : `${bugs} bugs squashed`}</li> : null}
              {!newBest && best ? <li>Best: {best}</li> : null}
            </ul>
            <h2 className={s.outcome}>
              {outcome.label} · city score {result.score}
            </h2>
            <p className={s.text}>{strategicFeedback(result.fingerprint, result, true)}</p>
            {bars()}
            <Button variant="primary" size="lg" block onClick={startLite} data-testid="lite-again">
              {newBest ? 'Play again' : 'Try to beat it'}
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
