/**
 * The dead ball (UNDERSTAND; constitution §14): a compact results layer at the edge of the view, so the field, the
 * ball's path and the score stay visible. It shows only the OUTCOME, then one sentence (the coach's tip) holding the
 * PRIMARY REASON, a measured fact, and exactly one RECOMMENDATION (RK4), and the primary action "Practice this ball"
 * ("Next ball" is the secondary). It expands, when asked, for "Why?", the
 * alternative shots and the demonstration. The score above it has already changed: the stage showed the ball first.
 */
import { useRef, useState } from 'react';
import type { DeliveryRecord } from '@/contracts';
import { Icon } from '@/ui';
import { usePracticeT } from '@/i18n/practice';
import { PButton, sys } from '../design';
import { useKit, useStageRegions } from '../context';
import {
  deliveryLine,
  dismissalWord,
  fielderWord,
  isConfirmation,
  luckyLine,
  outcomeWord,
  primaryReasonLine,
  readLine,
  recommendationLine,
  tipParts,
} from '../coaching';
import type { Insight, LastBall } from '../flow/state';
import { Alternatives } from './Alternatives';
import { BallPath } from './BallPath';
import { useCardPlacement } from './useCardPlacement';
import { WhyDetails } from './WhyDetails';
import s from './ResultLayer.module.css';

export interface ResultLayerProps {
  last: LastBall;
  insight: Insight | null;
  score: string;
  /** "Next ball", or "Over summary" when the over or the innings has ended. */
  nextLabel: string;
  canPractice: boolean;
  onPractice: () => void;
  onNext: () => void;
  onDemo: () => void;
  onCloseUp: () => void;
  onSlowMo: () => void;
  note?: string | null;
  /** The first session: the cricket words in the result are glossed in plain words. */
  gloss?: boolean;
  /** The view edge the card sits at, by renderer (screens/Play.tsx resultEdge; ResultLayer.module.css). */
  edge?: 'left' | 'right';
}

type Open = null | 'why' | 'alternatives';

function fielderOf(record: DeliveryRecord, id: string | null) {
  return id ? (record.field.fielders.find((f) => f.id === id) ?? null) : null;
}

export function ResultLayer(p: ResultLayerProps) {
  const t = usePracticeT();
  const { build, engine, coach } = useKit();
  const [open, setOpen] = useState<Open>(null);
  const cardRef = useRef<HTMLElement>(null);
  useCardPlacement(cardRef, p.edge ?? 'left', useStageRegions());
  const { result, record } = p.last;
  const o = outcomeWord(t, result.outcome);
  const analysis = p.insight?.status === 'ready' ? p.insight.analysis : null;
  const primary = p.insight?.status === 'ready' ? p.insight.primary : null;
  // The card's one sentence: the measured fact (PRIMARY REASON) and exactly one action (RECOMMENDATION), RK4.
  const tip = primary && coach && p.insight?.tip ? tipParts(t, coach.tipWords(t, p.insight.tip)) : null;
  // A confirmation (the tick, the green) is praise: only when earned (anti-fake rule 7: no risk the recommendation avoids,
  // and the contact's own measurement, from the tip: bat speed and the sweet zone, never the contact label).
  const earned =
    primary && analysis && coach ? coach.praiseEarned(analysis, primary.recommendation, p.insight?.tip ?? null) : true;
  const confirm = primary ? isConfirmation(primary.recommendation) && earned : false;
  const fielder = fielderOf(record, result.outcome.fielderId);
  const by = fielder
    ? t.t(
        result.outcome.dismissal === 'caught' || result.outcome.dismissal === 'caught_behind'
          ? 'practice.result.caught_by'
          : 'practice.result.fielded_by',
        { fielder: fielderWord(t, fielder.role) ?? '' },
      )
    : null;
  const toggle = (k: Exclude<Open, null>) => setOpen((cur) => (cur === k ? null : k));
  const whyId = 'practice-result-why';
  const alternativesId = 'practice-result-alternatives';
  return (
    <section
      ref={cardRef}
      className={s.result}
      data-expanded={open ? 'true' : 'false'}
      data-edge={p.edge ?? 'left'}
      role="region"
      aria-labelledby="practice-result-outcome"
      aria-describedby={primary ? 'practice-result-reason practice-result-recommendation' : 'practice-result-reason'}
      data-testid="practice-result"
      data-outcome={result.outcome.dismissal ? 'out' : String(result.outcome.runs)}
      data-swing={result.swing?.kind ?? 'leave'}
    >
      {/* The words scroll if they must; the two actions below them are always in view (the smallest phone included).
          The body takes focus, so its scrolled words are reachable from the keyboard too (axe scrollable-region-focusable,
          seen at 1.3x and 200% text on 640x360). */}
      <div className={s.resultBody} tabIndex={0} data-testid="practice-result-body">
        <div className={s.outcomeRow}>
          <div className={s.outcome}>
            <span
              id="practice-result-outcome"
              className={`${s.outcomeWord} ${o.caps ? sys.outcome : ''}`}
              data-tone={o.tone}
            >
              {o.word}
            </span>
            {result.outcome.dismissal && (
              <span className={sys.section}>{dismissalWord(t, result.outcome.dismissal)}</span>
            )}
            <span className={`${sys.caption} ${sys.num}`}>{p.score}</span>
          </div>
          <BallPathFloat last={p.last} />
        </div>
        {p.note && (
          <p className={sys.caption} role="status" data-testid="practice-result-notice">
            {p.note}
          </p>
        )}
        {/* One live region for the coach's words, there from the start, so "Reading the ball…" and then the tip are
            both announced (a region added with its text already in it is not read out by every screen reader). */}
        <div className={s.words} aria-live="polite" data-testid="practice-result-words">
          {tip ? (
            <p
              className={`${s.rec} ${s.tip}`}
              data-confirm={confirm ? 'true' : 'false'}
              data-mistake={p.insight?.tip?.mistake ?? 'none'}
              data-testid="practice-result-tip"
            >
              <span className={s.recIcon} aria-hidden="true">
                <Icon name={confirm ? 'check' : 'forward'} size={16} />
              </span>
              <span>
                {tip.map((part, i) =>
                  part.role === 'fact' ? (
                    <span key={i} id="practice-result-reason" data-testid="practice-result-reason">
                      {part.text}
                    </span>
                  ) : part.role === 'action' ? (
                    <span
                      key={i}
                      id="practice-result-recommendation"
                      className={s.tipAction}
                      data-testid="practice-result-recommendation"
                    >
                      {part.text}
                    </span>
                  ) : (
                    <span key={i}>{part.text}</span>
                  ),
                )}
              </span>
            </p>
          ) : (
            <>
              <p id="practice-result-reason" className={s.reason} data-testid="practice-result-reason">
                {primary
                  ? primaryReasonLine(t, primary, result)
                  : p.insight?.status === 'working'
                    ? t.t('practice.result.reading')
                    : ''}
              </p>
              {primary && (earned || !isConfirmation(primary.recommendation)) && (
                <p
                  id="practice-result-recommendation"
                  className={s.rec}
                  data-confirm={confirm ? 'true' : 'false'}
                  data-testid="practice-result-recommendation"
                >
                  <span className={s.recIcon} aria-hidden="true">
                    <Icon name={confirm ? 'check' : 'forward'} size={16} />
                  </span>
                  {recommendationLine(t, primary.recommendation)}
                </p>
              )}
            </>
          )}
        </div>
        {primary && analysis && luckyLine(t, analysis, primary.recommendation) && (
          <p className={sys.caption} data-testid="practice-result-lucky">
            {luckyLine(t, analysis, primary.recommendation)}
          </p>
        )}
        <div className={s.facts}>
          <p className={sys.caption} data-testid="practice-result-read">
            {t.t('practice.read_as.you_played', { read: readLine(t, result.swing, engine.regionOf) })}
          </p>
          <p className={sys.caption}>
            {deliveryLine(t, build, result, record.bowler)}
            {by ? ` · ${by}` : ''}
          </p>
        </div>
        {p.gloss && (
          <p className={sys.caption} data-testid="practice-result-gloss">
            {t.t('practice.gloss.result')}
          </p>
        )}
        {analysis && (
          <div className={s.disclosures}>
            <PButton
              variant="quiet"
              aria-expanded={open === 'why'}
              aria-controls={whyId}
              onClick={() => toggle('why')}
              data-testid="practice-why-toggle"
            >
              {t.t('practice.result.why')}
            </PButton>
            <PButton
              variant="quiet"
              aria-expanded={open === 'alternatives'}
              aria-controls={alternativesId}
              onClick={() => toggle('alternatives')}
              data-testid="practice-alternatives-toggle"
            >
              {t.t('practice.result.alternatives')}
            </PButton>
            <PButton variant="quiet" icon="play" onClick={p.onDemo} data-testid="practice-demo">
              {t.t('practice.result.demo')}
            </PButton>
          </div>
        )}
        {open === 'why' && analysis && (
          <div id={whyId} className={s.more}>
            <WhyDetails analysis={analysis} result={result} record={record} />
            <div className={s.disclosures}>
              <PButton variant="quiet" icon="eye" onClick={p.onCloseUp} data-testid="practice-closeup">
                {t.t('practice.result.closeup')}
              </PButton>
              <PButton variant="quiet" icon="slowmo" onClick={p.onSlowMo} data-testid="practice-slowmo">
                {t.t('practice.result.slowmo')}
              </PButton>
            </div>
          </div>
        )}
        {open === 'alternatives' && analysis && (
          <div id={alternativesId} className={s.more}>
            <Alternatives analysis={analysis} />
          </div>
        )}
      </div>
      <div className={s.resultActions}>
        {p.canPractice && (
          <PButton variant="primary" size="lg" onClick={p.onPractice} autoFocus data-testid="practice-practice-ball">
            {t.t('practice.result.practice')}
          </PButton>
        )}
        <PButton
          variant={p.canPractice ? 'secondary' : 'primary'}
          size="lg"
          iconEnd="forward"
          onClick={p.onNext}
          autoFocus={!p.canPractice}
          data-testid="practice-next-ball"
        >
          {p.nextLabel}
        </PButton>
      </div>
    </section>
  );
}

function BallPathFloat({ last }: { last: LastBall }) {
  return (
    <span className={s.pathMap} aria-hidden="true">
      <BallPath result={last.result} record={last.record} />
    </span>
  );
}
