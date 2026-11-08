/**
 * The dead ball (UNDERSTAND; constitution §14): a compact results layer at the edge of the view, so the field, the
 * ball's path and the score stay visible. It shows only the OUTCOME, then one sentence (the coach's tip) holding the
 * PRIMARY REASON, a measured fact, and exactly one RECOMMENDATION (RK4), and the primary action "Practice this ball"
 * ("Next ball" is the secondary). It expands, when asked, for "Why?", the
 * alternative shots and the demonstration. The score above it has already changed: the stage showed the ball first.
 */
import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { DeliveryRecord } from '@/contracts';
import { Icon } from '@/ui';
import { usePracticeT } from '@/i18n/practice';
import { PButton, sys, useLargeShort } from '../design';
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
import { confirmedForThisBall, confirmedLine } from '../chase/scope';
import chaseCss from '../chase/chase.module.css';
import s from './ResultLayer.module.css';

export interface ResultLayerProps {
  last: LastBall;
  insight: Insight | null;
  score: string;
  /** "Next ball", or "Over summary" when the over or the innings has ended. */
  nextLabel: string;
  canPractice: boolean;
  /** In a chase "Practice this ball" is not offered; this says so, in the button's place. */
  practiceOff?: string | null;
  onPractice: () => void;
  onNext: () => void;
  onDemo: () => void;
  onCloseUp: () => void;
  onSlowMo: () => void;
  note?: string | null;
  /** The first session: the cricket words in the result are glossed in plain words. */
  gloss?: boolean;
  /** The first balls' teaching lines (src/practice/ui/lesson): the timing in plain words, a press that came too soon. */
  teaching?: ReactNode;
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
  // Large text on a short screen: the card is one sheet over most of the screen (the ball is dead), so it is not moved
  // off the ball's path (ResultLayer.module.css, "data-large-short"; design/useLargeShort.ts).
  const largeShort = useLargeShort();
  const stageRegions = useStageRegions();
  useCardPlacement(cardRef, p.edge ?? 'left', largeShort ? null : stageRegions);
  useSheetTop(cardRef, largeShort);
  const { result, record } = p.last;
  const o = outcomeWord(t, result.outcome);
  const analysis = p.insight?.status === 'ready' ? p.insight.analysis : null;
  const primary = p.insight?.status === 'ready' ? p.insight.primary : null;
  // A confirmation (the tick, the green) is praise: only when earned (anti-fake rule 7: no risk the recommendation avoids,
  // and the contact's own measurement, from the tip: bat speed and the sweet zone, never the contact label).
  const earned =
    primary && analysis && coach ? coach.praiseEarned(analysis, primary.recommendation, p.insight?.tip ?? null) : true;
  const confirm = primary ? isConfirmation(primary.recommendation) && earned : false;
  // In a chase the coach speaks about THIS ball only: "play it the same way again" would read as a plan for the chase
  // (R-44 item 5), so the confirmation of a repeated response says what it is, and the alternatives tag likewise.
  const inChase = Boolean(p.practiceOff);
  const forThisBall = inChase && confirm && primary?.recommendation.kind === 'repeat_it';
  // The card's one sentence: the measured fact (PRIMARY REASON) and exactly one action (RECOMMENDATION), RK4.
  const tipWords = primary && coach && p.insight?.tip ? coach.tipWords(t, p.insight.tip) : null;
  const tip = tipWords ? tipParts(t, forThisBall ? confirmedForThisBall(t, tipWords) : tipWords) : null;
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
      data-large-short={largeShort ? 'true' : 'false'}
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
        {/* The first balls' teaching (the timing in plain words) sits right under the outcome, where it is seen first. */}
        {p.teaching}
        {/* One live region for the coach's words, there from the start, so "Reading the ball…" and then the tip are
            both announced (a region added with its text already in it is not read out by every screen reader). */}
        <div
          className={s.words}
          aria-live="polite"
          data-reading={p.insight?.status === 'working' ? 'true' : 'false'}
          data-testid="practice-result-words"
        >
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
                  {forThisBall ? confirmedLine(t) : recommendationLine(t, primary.recommendation)}
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
        {largeShort && !p.canPractice && p.practiceOff && (
          <p className={`${sys.caption} ${chaseCss.practiceOff}`} data-testid="practice-chase-no-practice">
            {p.practiceOff}
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
            <Alternatives analysis={analysis} chase={inChase} />
          </div>
        )}
      </div>
      <div className={s.resultActions}>
        {!largeShort && !p.canPractice && p.practiceOff && (
          <p className={`${sys.caption} ${chaseCss.practiceOff}`} data-testid="practice-chase-no-practice">
            {p.practiceOff}
          </p>
        )}
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

/** The sheet's own re-reads of the rail's corner (ms after it opens): the corner gains a line at the dead ball. */
const SHEET_TOP_CHECKS_MS = [150, 400, 1000] as const;

/**
 * Large text on a short screen: the dead-ball card is one sheet that starts 2 px under the rail's right corner (the
 * conditions and the pause control stay clear; EVAL-WORLD K5). The corner's published bottom (--p-rail-bottom) can be
 * 5 to 11 px short of its real edge once the dead ball adds a line to it, so the sheet reads the edge itself, now, a
 * little later (the same moments useCardPlacement re-reads the stage) and when the window changes. Until then, and
 * wherever the corner cannot be found, the stylesheet's place (the published bottom and 1 rem) holds.
 */
function useSheetTop(ref: RefObject<HTMLElement | null>, on: boolean): void {
  useLayoutEffect(() => {
    const card = ref.current;
    const root = card?.closest<HTMLElement>('[data-play-root]');
    const corner = root?.querySelector('[data-testid="practice-conditions"]')?.parentElement;
    if (!on || !card || !root || !corner) return;
    const place = () => {
      const top = Math.ceil(corner.getBoundingClientRect().bottom - root.getBoundingClientRect().top) + 2;
      card.style.top = `${top}px`;
    };
    place();
    const timers = SHEET_TOP_CHECKS_MS.map((ms) => setTimeout(place, ms));
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place);
    ro?.observe(corner);
    ro?.observe(root);
    return () => {
      for (const t of timers) clearTimeout(t);
      ro?.disconnect();
      card.style.top = '';
    };
  }, [ref, on]);
}

function BallPathFloat({ last }: { last: LastBall }) {
  return (
    <span className={s.pathMap} aria-hidden="true">
      <BallPath result={last.result} record={last.record} />
    </span>
  );
}
