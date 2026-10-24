import { useEffect, useMemo, useState } from 'react';
import { useApp } from '@/app/store';
import { confidenceWarning } from '@/engine';
import type { DecisionOption, GameState, Scenario } from '@/engine/types';
import { DecisionCard, FeedbackStrip, PlayButton, PlayIcon, RightsMomentCard, cue, type OptionWarning } from '@/components/play';
import { SIMPLE_UI, useSimple } from '@/app/simple';
import { SIMPLE_TEXT, simpleChoiceOf, simpleReview } from '@/components/play/simpleCopy';
import styles from './DecisionArea.module.css';

export interface DecisionAreaProps {
  game: GameState;
  scenario: Scenario;
  /** Mobile shows one card at a time with a pager; desktop stacks them. */
  layout: 'pager' | 'stack';
  /** Decision to bring into view (from the district card). */
  requestedDecisionId?: string;
  onRequestHandled?: () => void;
  unexaminedEvidence: number;
  onOpenEvidence: () => void;
  /** True when a sheet is open: new decisions should not steal focus. */
  sheetOpen: boolean;
}

export function DecisionArea({ game, scenario, layout, requestedDecisionId, onRequestHandled, unexaminedEvidence, onOpenEvidence, sheetOpen }: DecisionAreaProps) {
  const dispatch = useApp((s) => s.dispatch);
  const autoPaused = useApp((s) => s.autoPaused);
  const simple = useSimple();
  const [activeIdx, setActiveIdx] = useState(0);
  const [answered, setAnswered] = useState<{ id: string; optionId: string } | null>(null);
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const [seenDecisionIds, setSeenDecisionIds] = useState<string[]>([]);

  const pending = useMemo(
    () =>
      game.pendingDecisionIds
        .map((id) => ({ decision: scenario.decisions.find((d) => d.id === id), state: game.decisions[id] }))
        .filter((p): p is { decision: NonNullable<typeof p.decision>; state: NonNullable<typeof p.state> } => Boolean(p.decision && p.state && p.state.status === 'pending')),
    [game.pendingDecisionIds, game.decisions, scenario.decisions],
  );

  const pendingRights = useMemo(() => game.pendingRightsIds.filter((id) => game.rights[id]?.status !== 'answered' && scenario.rightsMoments.some((m) => m.id === id)), [game.pendingRightsIds, game.rights, scenario.rightsMoments]);

  const warningsFor = (options: DecisionOption[]): Record<string, OptionWarning> => {
    const out: Record<string, OptionWarning> = {};
    for (const o of options) {
      try {
        out[o.id] = confidenceWarning(game, scenario, o);
      } catch {
        out[o.id] = { level: 'none', text: '' };
      }
    }
    return out;
  };

  // Keep the pager index valid and jump to a requested decision.
  useEffect(() => {
    if (activeIdx > Math.max(0, pending.length - 1)) setActiveIdx(Math.max(0, pending.length - 1));
  }, [pending.length, activeIdx]);
  useEffect(() => {
    if (!requestedDecisionId) return;
    const idx = pending.findIndex((p) => p.decision.id === requestedDecisionId);
    if (idx >= 0) {
      setActiveIdx(idx);
      if (layout === 'stack') {
        const el = document.querySelector<HTMLElement>(`[data-testid="decision-card-${requestedDecisionId}"]`);
        el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        el?.querySelector<HTMLElement>('h3')?.focus({ preventScroll: true });
      }
    }
    onRequestHandled?.();
  }, [requestedDecisionId, pending, layout, onRequestHandled]);

  // Track which decisions are new (for focus management) — only focus when the player is idle.
  const newIds = useMemo(() => pending.filter((p) => !seenDecisionIds.includes(p.decision.id)).map((p) => p.decision.id), [pending, seenDecisionIds]);
  useEffect(() => {
    if (newIds.length === 0) return;
    const t = window.setTimeout(() => setSeenDecisionIds((prev) => [...prev, ...newIds]), 50);
    return () => window.clearTimeout(t);
  }, [newIds]);

  const choose = (decisionId: string, optionId: string) => {
    dispatch({ type: 'decide', tick: game.tick, decisionId, optionId });
    const fb = useApp.getState().game?.lastFeedback;
    cue(fb?.warning ? 'danger' : 'confirm', fb?.warning ? 'warning' : 'medium');
    setDismissedKey(null);
  };

  const chooseRights = (momentId: string, optionId: string) => {
    dispatch({ type: 'rights', tick: game.tick, momentId, optionId });
    setAnswered({ id: momentId, optionId });
    cue('confirm', 'light');
  };

  const feedback = game.lastFeedback;
  const feedbackKey = feedback ? `${feedback.tick}:${feedback.title}` : null;
  const showFeedback = Boolean(feedback && feedbackKey !== dismissedKey && game.tick - feedback.tick <= 15);
  const undoInfo = game.undo && game.undo.expiresAt > game.tick ? { left: game.undo.expiresAt - game.tick, total: Math.max(1, game.undo.expiresAt - (game.decisions[game.undo.decisionId]?.decidedAt ?? game.tick)) } : undefined;

  // While the clock waits for the player (automatic pause) choices stay enabled; the store resumes after the answer.
  const waiting = autoPaused && game.status === 'paused';
  const disabled = game.status !== 'running' && !waiting;
  const activeRights = answered ? scenario.rightsMoments.find((m) => m.id === answered.id) : pendingRights[0] ? scenario.rightsMoments.find((m) => m.id === pendingRights[0]) : undefined;

  // Plain-language consequence for the feedback strip (matched by the option that produced it).
  const feedbackSimple = (() => {
    if (!simple || !feedback) return undefined;
    for (const d of scenario.decisions) {
      const opt = d.options.find((o) => o.title === feedback.title || o.consequence === feedback.text);
      if (opt) {
        const so = d.simple?.options[opt.id];
        return so ? { title: so.title, text: so.consequence ?? so.preview } : undefined;
      }
    }
    return undefined;
  })();

  const visible = layout === 'pager' ? pending.slice(Math.min(activeIdx, Math.max(0, pending.length - 1)), Math.min(activeIdx, Math.max(0, pending.length - 1)) + 1) : pending;

  return (
    <div className={styles.root} data-layout={layout} data-simple={simple ? 'true' : undefined}>
      {waiting ? (
        <p className={styles.waiting} data-testid="clock-waiting" role="status">
          <PlayIcon name="pause" size={16} />
          <span>{SIMPLE_UI.clockWaiting}</span>
        </p>
      ) : null}
      {showFeedback && feedback ? (
        <FeedbackStrip
          feedback={feedback}
          simple={simple}
          simpleOverride={feedbackSimple}
          undo={undoInfo}
          onUndo={() => {
            dispatch({ type: 'undo', tick: game.tick });
            cue('undo', 'light');
          }}
          onDismiss={() => setDismissedKey(feedbackKey)}
        />
      ) : null}

      {activeRights ? (
        <RightsMomentCard
          moment={activeRights}
          answeredOptionId={answered?.id === activeRights.id ? answered.optionId : undefined}
          onChoose={(optionId) => chooseRights(activeRights.id, optionId)}
          onContinue={() => setAnswered(null)}
          disabled={disabled && !answered}
          simple={simple}
        />
      ) : null}

      {pending.length > 0 ? (
        <div className={styles.decisions}>
          {layout === 'pager' && pending.length > 1 ? (
            <nav className={styles.pager} aria-label={simple ? 'Your choices' : 'Pending decisions'}>
              <span className={styles.pagerText}>
                {simple ? simpleChoiceOf(Math.min(activeIdx, pending.length - 1) + 1, pending.length) : `Decision ${Math.min(activeIdx, pending.length - 1) + 1} of ${pending.length}`}
              </span>
              <div className={styles.dots}>
                {pending.map((p, i) => (
                  <button
                    key={p.decision.id}
                    type="button"
                    className={styles.dot}
                    aria-label={`${simple ? 'Show choice' : 'Show decision'} ${i + 1}: ${(simple && p.decision.simple?.title) || p.decision.title}`}
                    aria-current={i === Math.min(activeIdx, pending.length - 1) ? 'true' : undefined}
                    onClick={() => setActiveIdx(i)}
                  />
                ))}
              </div>
              <div className={styles.pagerBtns}>
                <button type="button" className={styles.pagerBtn} aria-label={simple ? 'Previous choice' : 'Previous decision'} disabled={activeIdx <= 0} onClick={() => setActiveIdx((i) => Math.max(0, i - 1))}>
                  <PlayIcon name="chevronLeft" size={18} />
                </button>
                <button type="button" className={styles.pagerBtn} aria-label={simple ? 'Next choice' : 'Next decision'} disabled={activeIdx >= pending.length - 1} onClick={() => setActiveIdx((i) => Math.min(pending.length - 1, i + 1))}>
                  <PlayIcon name="chevronRight" size={18} />
                </button>
              </div>
            </nav>
          ) : null}
          {visible.map((p) => (
            <DecisionCard
              key={p.decision.id}
              decision={p.decision}
              state={p.state}
              tick={game.tick}
              districtName={p.decision.district ? scenario.districts.find((d) => d.id === p.decision.district)?.name : undefined}
              warnings={warningsFor(p.decision.options)}
              onChoose={(optionId) => choose(p.decision.id, optionId)}
              autoFocus={!sheetOpen && !activeRights && newIds.includes(p.decision.id)}
              disabled={disabled}
              simple={simple}
            />
          ))}
        </div>
      ) : !activeRights ? (
        <div className={styles.empty} data-testid="decisions-empty">
          <span className={styles.emptyIcon} aria-hidden="true">
            <PlayIcon name="eye" size={20} />
          </span>
          <div className={styles.emptyText}>
            <p className={styles.emptyTitle}>{game.status === 'ended' ? (simple ? SIMPLE_UI.chapterDone : 'Chapter complete') : simple ? SIMPLE_TEXT.monitoringTitle : 'Monitoring the city'}</p>
            <p className={styles.emptyBody}>
              {game.status === 'ended' ? (simple ? SIMPLE_TEXT.chapterDoneBody : 'Compiling what was resolved and what remains.') : simple ? SIMPLE_TEXT.monitoringBody : 'Decisions appear here as the situation develops. Use the time to examine evidence.'}
            </p>
          </div>
          {unexaminedEvidence > 0 && game.status !== 'ended' ? (
            <PlayButton variant="secondary" icon="evidence" onClick={onOpenEvidence}>
              {simple ? simpleReview(unexaminedEvidence) : `Review ${unexaminedEvidence} item${unexaminedEvidence === 1 ? '' : 's'}`}
            </PlayButton>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
