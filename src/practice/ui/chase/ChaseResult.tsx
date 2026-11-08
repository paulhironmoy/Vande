/**
 * The win and loss screen of a Target Chase. The deciding ball has just been replayed (the flow does that before this
 * opens); this screen says what happened in plain numbers, why a loss was a loss in ONE sentence made only from what
 * the simulation recorded, and offers one primary action: "Try this chase again" (same seed, same target, same balls).
 * "Back to Practice" is the one secondary; a new chase, watching the deciding ball again and practising it (practice
 * only: it cannot change the result) are quiet. No confetti, no streak, no score to beat: the result stays on this
 * device and is never ranked.
 */
import { inningsDeliveries } from '@/practice/chase';
import { usePracticeT } from '@/i18n/practice';
import { PButton, PDisclosure, Screen, sys } from '../design';
import { markText } from '../coaching';
import type { FlowState, PracticeFlow } from '../flow/controller';
import sum from '../components/Summary.module.css';
import s from './chase.module.css';
import { ballFacts } from './attribution';
import { chaseResultLines } from './words';

export interface ChaseResultProps {
  /** Only its results are read (each ball of the chase, re-simulated from its record when not at hand). */
  flow: Pick<PracticeFlow, 'resultOf'>;
  state: FlowState;
  onAgain: () => void;
  onBack: () => void;
  onWatch: () => void;
  /** Practise the deciding ball (practice only); null when there is no coach to practise with. */
  onPractise: (() => void) | null;
}

export function ChaseResult({ flow, state, onAgain, onBack, onWatch, onPractise }: ChaseResultProps) {
  const t = usePracticeT();
  const chase = state.chase;
  const innings = state.innings;
  if (!chase?.summary || !innings) return null;
  const summary = chase.summary;
  const records = inningsDeliveries(innings);
  const results = records.map((r) => flow.resultOf(r));
  const lines = chaseResultLines(t, summary, results.map(ballFacts), results[results.length - 1] ?? null);
  return (
    <div className={sum.overlay} data-testid="practice-chase-result" data-result={summary.result}>
      <Screen
        title={lines.title}
        wide
        flush
        footer={
          <PButton
            variant="primary"
            size="lg"
            block
            icon="replay"
            onClick={onAgain}
            autoFocus
            data-testid="practice-chase-again"
          >
            {t.t('practice.chase.again')}
          </PButton>
        }
      >
        <div className={sum.head}>
          <span className={sum.score} data-testid="practice-chase-score">
            {t.number(summary.runs)}
          </span>
          <span className={sys.caption} data-testid="practice-chase-target">
            {t.t('practice.chase.setup.target', { target: summary.target })}
            {' · '}
            {t.t('practice.chase.setup.level', { level: t.t(`practice.chase.level.${summary.difficulty}`) })}
          </span>
        </div>
        <p className={s.line} data-testid="practice-chase-line">
          {lines.score}
        </p>
        {lines.detail && (
          <p className={s.tone} data-result={lines.tone} data-testid="practice-chase-detail">
            {lines.detail}
          </p>
        )}
        {lines.why && (
          <p className={s.why} data-testid="practice-chase-why">
            {lines.why}
          </p>
        )}
        {chase.previous && (
          <p className={sys.caption} data-testid="practice-chase-last">
            {t.t('practice.chase.result.last', { runs: chase.previous.runs, balls: chase.previous.ballsFaced })}
          </p>
        )}
        <ol className={s.marks} aria-label={t.t('practice.summary.balls')} data-testid="practice-chase-balls">
          {records.map((d) => (
            <li key={`${d.overIndex}:${d.ballIndex}`} className={sum.markItem}>
              <span
                className={sum.ballMark}
                data-state={d.dismissal ? 'out' : d.runs >= 4 ? 'boundary' : 'done'}
                aria-hidden="true"
              >
                {markText(d)}
              </span>
              <span className={sys.srOnly}>
                {t.t('practice.summary.ball_result', {
                  n: d.overIndex * 6 + d.ballIndex + 1,
                  result: d.dismissal
                    ? t.tk(`practice.result.${d.dismissal}`)
                    : t.t('practice.result.runs', { runs: d.runs }),
                })}
              </span>
            </li>
          ))}
        </ol>
        <div className={s.secondaryRow}>
          <PButton variant="secondary" icon="home" onClick={onBack} data-testid="practice-chase-back">
            {t.t('practice.chase.back')}
          </PButton>
        </div>
        {/* One primary, one secondary; the deciding ball (watch it again, practise it) is one quiet disclosure. */}
        <PDisclosure label={t.t('practice.chase.replay_title')} testId="practice-chase-deciding">
          <div className={sum.links}>
            <PButton variant="quiet" icon="slowmo" onClick={onWatch} data-testid="practice-chase-watch">
              {t.t('practice.chase.watch')}
            </PButton>
            {onPractise && (
              <PButton variant="quiet" icon="replay" onClick={onPractise} data-testid="practice-chase-practise">
                {t.t('practice.chase.practise')}
              </PButton>
            )}
          </div>
          {onPractise && (
            <p className={`${sys.caption} ${s.practiceNote}`} data-testid="practice-chase-practise-note">
              {t.t('practice.chase.practise_note')}
            </p>
          )}
        </PDisclosure>
      </Screen>
    </div>
  );
}
