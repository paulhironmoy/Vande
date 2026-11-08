/**
 * Summary (constitution §1: understand progress and choose what to do next): the end of a survived over, the
 * dismissal and the finished innings. The score, the six balls (each a way into Coach Mode for that exact ball) and
 * the Form report (demonstrated skill only), with one primary next action. Numbers come from the game's summaries
 * over the physics' results; nothing is re-scored here.
 */
import { useState } from 'react';
import type { DeliveryRecord } from '@/contracts';
import { PRACTICE_MAX_OVERS } from '@/contracts';
import { usePracticeT } from '@/i18n/practice';
import { PButton, PConfirm, PDisclosure, Screen, sys } from '../design';
import { useKit } from '../context';
import { dismissalWord, markText, variationName } from '../coaching';
import { FormReport, useFormReport } from '../components/FormReport';
import { OverBalls } from '../components/OverBalls';
import type { FlowState, PracticeFlow } from '../flow/controller';
import s from '../components/Summary.module.css';

interface Props {
  flow: PracticeFlow;
  state: FlowState;
  onHome: () => void;
}

export function OverSummary({
  flow,
  state,
  onHome,
  onNextOver,
  onChooseOver,
  onHarder,
}: Props & { onNextOver: () => void; onChooseOver: () => void; onHarder: (() => void) | null }) {
  const t = usePracticeT();
  const { engine, coach } = useKit();
  const form = useFormReport();
  const [confirmEnd, setConfirmEnd] = useState(false);
  const inn = state.innings;
  if (!inn || !inn.overs.length) return null;
  const i = inn.overs.length - 1;
  const over = inn.overs[i];
  const sum = engine.overSummary(over, flow.overResults(i));
  const left = PRACTICE_MAX_OVERS - inn.overs.length;
  const practice = coach ? (r: DeliveryRecord) => flow.coachLoop.practiceBall(r) : null;
  return (
    <div className={s.overlay} data-testid="practice-over-summary" data-over={i + 1}>
      {/* One primary (another over), at most two secondary (a harder over; a ball from this over to practise), and
          quiet navigation: back to the Practice home, and More for the rest. */}
      <Screen
        title={t.t('practice.summary.over_title', { n: i + 1 })}
        onBack={onHome}
        backLabel={t.t('practice.summary.to_home')}
        wide
        footer={
          <PButton
            variant="primary"
            size="lg"
            block
            iconEnd="forward"
            onClick={onNextOver}
            data-testid="practice-next-over"
            autoFocus
          >
            {t.t('practice.summary.another_over')}
          </PButton>
        }
      >
        <div className={s.head}>
          <span className={s.score} data-testid="practice-total">
            {t.t('practice.common.score', { runs: inn.runs, wickets: 0 })}
          </span>
          <span className={sys.caption}>
            {t.t('practice.summary.this_over', { runs: sum.runs })} ·{' '}
            {t.t('practice.summary.overs_left', { count: left })} ·{' '}
            <span data-testid="practice-balls-faced">{t.t('practice.summary.balls_faced', { count: inn.balls })}</span>
          </span>
        </div>
        <OverMarks deliveries={over.deliveries} />
        {onHarder && (
          <div>
            <PButton variant="secondary" onClick={onHarder} data-testid="practice-harder-over">
              {t.t('practice.summary.harder_over')}
            </PButton>
          </div>
        )}
        {practice && (
          <PDisclosure label={t.t('practice.summary.practise_ball')} testId="practice-practise-from-over">
            <OverBalls deliveries={over.deliveries} onPractice={practice} testId="practice-practise-balls" />
          </PDisclosure>
        )}
        <PDisclosure label={t.t('practice.summary.more')} testId="practice-summary-more">
          <div className={s.links}>
            <PButton variant="quiet" onClick={onChooseOver} data-testid="practice-choose-over">
              {t.t('practice.summary.choose_over')}
            </PButton>
            <PButton
              variant="quiet"
              icon="replay"
              onClick={() => flow.coachLoop.replayOver(i)}
              data-testid="practice-replay-over"
            >
              {t.t('practice.summary.replay_over')}
            </PButton>
            <PButton variant="quiet" onClick={() => setConfirmEnd(true)} data-testid="practice-end-innings">
              {t.t('practice.summary.end')}
            </PButton>
          </div>
          {form && (
            <section className={sys.stackTight} data-testid="practice-form-panel">
              <h2 className={sys.section}>{t.t('practice.form.title')}</h2>
              <FormReport report={form} />
            </section>
          )}
        </PDisclosure>
      </Screen>
      <PConfirm
        open={confirmEnd}
        title={t.t('practice.summary.end_title')}
        body={t.t('practice.summary.end_body', { runs: inn.runs })}
        confirmLabel={t.t('practice.summary.end')}
        cancelLabel={t.t('practice.common.cancel')}
        danger
        onCancel={() => setConfirmEnd(false)}
        onConfirm={() => {
          setConfirmEnd(false);
          flow.endInnings();
          onHome();
        }}
        testId="practice-end-dialog"
      />
    </div>
  );
}

/** The over at a glance: its six balls as marks (not controls; practising one is behind its own disclosure). */
function OverMarks({ deliveries }: { deliveries: readonly DeliveryRecord[] }) {
  const t = usePracticeT();
  return (
    <ol className={s.marks} aria-label={t.t('practice.summary.balls')} data-testid="practice-over-balls">
      {deliveries.map((d) => (
        <li key={d.ballIndex} className={s.markItem}>
          <span
            className={s.ballMark}
            data-state={d.dismissal ? 'out' : d.runs >= 4 ? 'boundary' : 'done'}
            aria-hidden="true"
          >
            {markText(d)}
          </span>
          <span className={s.markName}>{variationName(t, d.plan.variation, d.bowler.spinType)}</span>
          <span className={sys.srOnly}>
            {t.t('practice.summary.ball_result', {
              n: d.ballIndex + 1,
              result: d.dismissal
                ? t.tk(`practice.result.${d.dismissal}`)
                : t.t('practice.result.runs', { runs: d.runs }),
            })}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function OutSummary({ flow, state, onHome }: Props) {
  const t = usePracticeT();
  const { engine, coach } = useKit();
  const form = useFormReport();
  const inn = state.innings;
  if (!inn || !inn.dismissal) return null;
  const sum = engine.inningsSummary(inn, flow.resultsMap());
  const rec = inn.dismissal.record;
  const overs = Math.floor(sum.survivedBalls / 6);
  const balls = sum.survivedBalls % 6;
  return (
    <div className={s.overlay} data-testid="practice-out-summary" data-how={rec.dismissal ?? ''}>
      <Screen
        title={t.t('practice.summary.out_title', { how: dismissalWord(t, rec.dismissal ?? 'bowled') })}
        wide
        flush
        footer={
          <PButton
            variant="primary"
            size="lg"
            block
            onClick={() => {
              flow.closeFinished();
              onHome();
            }}
            data-testid="practice-new-innings"
            autoFocus
          >
            {t.t('practice.summary.new_innings')}
          </PButton>
        }
      >
        <div className={s.head}>
          <span className={s.score} data-testid="practice-final-score">
            {t.number(sum.runs)}
          </span>
          <span className={sys.caption} data-testid="practice-survived">
            {overs > 0
              ? t.t('practice.summary.survived', { overs, balls })
              : t.t('practice.summary.survived_balls', { balls })}
          </span>
        </div>
        {coach && (
          <div>
            <PButton
              variant="secondary"
              icon="replay"
              onClick={() => flow.coachLoop.practiceBall(rec)}
              data-testid="practice-practice-delivery"
            >
              {t.t('practice.summary.practise_dismissal')}
            </PButton>
          </div>
        )}
        {form && <FormReport report={form} />}
        <div className={s.links}>
          <PButton
            variant="quiet"
            icon="slowmo"
            onClick={() => flow.coachLoop.replayDismissal()}
            data-testid="practice-replay-dismissal"
          >
            {t.t('practice.summary.watch_dismissal')}
          </PButton>
        </div>
      </Screen>
    </div>
  );
}

export function InningsSummary({ flow, state, onHome }: Props) {
  const t = usePracticeT();
  const { engine } = useKit();
  const form = useFormReport();
  const inn = state.innings;
  if (!inn) return null;
  const sum = engine.inningsSummary(inn, flow.resultsMap());
  const full = sum.completedOvers >= PRACTICE_MAX_OVERS;
  return (
    <div className={s.overlay} data-testid="practice-innings-summary" data-overs={sum.completedOvers}>
      <Screen
        title={full ? t.t('practice.summary.done_title') : t.t('practice.summary.ended_title')}
        wide
        flush
        footer={
          <PButton
            variant="primary"
            size="lg"
            block
            onClick={() => {
              flow.closeFinished();
              onHome();
            }}
            data-testid="practice-new-innings"
            autoFocus
          >
            {t.t('practice.summary.new_innings')}
          </PButton>
        }
      >
        <div className={s.head}>
          <span className={s.score} data-testid="practice-final-score">
            {t.number(sum.runs)}
          </span>
          <span className={sys.caption}>{t.t('practice.summary.balls_faced', { count: sum.balls })}</span>
        </div>
        <section className={sys.stackTight}>
          <h2 className={sys.section}>{t.t('practice.summary.per_over')}</h2>
          <ol className={s.perOver}>
            {sum.perOver.map((o, i) => (
              <li key={i}>
                <span className={sys.caption}>{i + 1}</span>
                <strong>{t.number(o.runs)}</strong>
              </li>
            ))}
          </ol>
        </section>
        {form && <FormReport report={form} />}
      </Screen>
    </div>
  );
}
