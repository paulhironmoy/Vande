/**
 * The end of a survived over, the dismissal and the finished innings. Numbers come from the game's summaries
 * (src/practice/game overSummary / inningsSummary) over the physics' results; nothing is re-scored here.
 */
import { useState } from 'react';
import { Button, Dialog } from '@/ui';
import { PRACTICE_MAX_OVERS } from '@/contracts';
import { usePracticeT } from '@/i18n/practice';
import { useKit } from '../context';
import type { FlowState, PracticeFlow } from '../flow/controller';
import { TimingChips } from '../components/TimingChips';
import { WagonWheel } from '../components/WagonWheel';
import { Why } from '../components/Why';
import s from './Summaries.module.css';

interface Props {
  flow: PracticeFlow;
  state: FlowState;
  onMenu: () => void;
}

export function OverSummary({ flow, state, onBuildNext, onMenu }: Props & { onBuildNext: () => void }) {
  const t = usePracticeT();
  const { engine } = useKit();
  const [confirmEnd, setConfirmEnd] = useState(false);
  const inn = state.innings;
  if (!inn || !inn.overs.length) return null;
  const overIndex = inn.overs.length - 1;
  const over = inn.overs[overIndex];
  const sum = engine.overSummary(over, flow.overResults(overIndex));
  const total = engine.inningsSummary(inn, flow.resultsMap());
  const weak = sum.weakest;
  const left = PRACTICE_MAX_OVERS - inn.overs.length;
  return (
    <div className={s.overlay} data-testid="practice-over-summary" data-over={overIndex + 1}>
      <main className={s.sheet}>
        <header className={s.header}>
          <h1 className={s.title}>{t.t('practice.over.title', { n: overIndex + 1 })}</h1>
          <div className={s.total}>
            <span className={s.score} data-testid="practice-total">
              {t.t('practice.common.score', { runs: total.runs, wickets: 0 })}
            </span>
            <span className={s.muted}>{t.t('practice.over.overs_left', { count: left })}</span>
          </div>
        </header>
        <div className={s.grid}>
          <section className={s.block}>
            <h3>{t.t('practice.over.total')}</h3>
            <dl className={s.stats}>
              <div>
                <dt>{t.t('practice.over.this_over', { runs: '' }).replace(/[:\s]+$/, '')}</dt>
                <dd>{t.number(sum.runs)}</dd>
              </div>
              <div>
                <dt>{t.t('practice.over.balls_faced')}</dt>
                <dd data-testid="practice-balls-faced">{t.number(total.balls)}</dd>
              </div>
              <div>
                <dt>{t.t('practice.over.boundaries')}</dt>
                <dd>{total.fours + total.sixes > 0 ? `${t.t('practice.common.fours', { count: total.fours })} · ${t.t('practice.common.sixes', { count: total.sixes })}` : t.t('practice.over.none')}</dd>
              </div>
            </dl>
            <h3>{t.t('practice.over.timing')}</h3>
            <TimingChips timing={sum.timing} testId="practice-timing-summary" />
          </section>
          <section className={s.block}>
            <h3>{t.t('practice.over.areas')}</h3>
            <WagonWheel areas={total.scoringAreas} handedness={inn.handedness} testId="practice-areas" />
          </section>
          {weak && (
            <section className={s.block} data-testid="practice-weakest">
              <h3>{t.t('practice.over.weakest')}</h3>
              <p className={s.weak}>{t.t('practice.over.weakest_ball', { n: weak.ballIndex + 1, variation: t.tk(`practice.var.${variationKey(weak.variation, over.plan.bowler.spinType)}`) })}</p>
              <p className={s.muted} style={{ margin: 0 }}>
                {t.tk(`practice.coach.${weak.reason}`, {}, '')}
              </p>
              <div className={s.actions}>
                <Button variant="secondary" icon="refresh" onClick={() => void flow.repeatBall(over.deliveries[weak.ballIndex])} data-testid="practice-repeat-weakest">
                  {t.t('practice.over.repeat')}
                </Button>
              </div>
            </section>
          )}
        </div>
        <section className={s.block}>
          <h3>{t.t('practice.over.repeat')}</h3>
          <p className={s.muted} style={{ margin: 0 }}>
            {t.t('practice.over.repeat_hint')}
          </p>
          <div className={s.balls} role="group" aria-label={t.t('practice.over.repeat')}>
            {over.deliveries.map((d) => (
              <Button key={d.ballIndex} variant="secondary" onClick={() => void flow.repeatBall(d)} data-testid={`practice-repeat-${d.ballIndex + 1}`}>
                {t.t('practice.common.ball_n', { n: d.ballIndex + 1 })}
              </Button>
            ))}
          </div>
        </section>
        <div className={s.actions}>
          <Button variant="accent" size="lg" iconEnd="forward" onClick={() => void flow.nextOver()} data-testid="practice-next-over" autoFocus>
            {t.t('practice.over.next')}
          </Button>
          <Button variant="secondary" size="lg" onClick={() => flow.prepareBuiltNextOver() && onBuildNext()} data-testid="practice-build-next">
            {t.t('practice.over.next_build')}
          </Button>
          <Button variant="secondary" icon="replay" onClick={() => flow.replayOver(overIndex)} data-testid="practice-replay-over">
            {t.t('practice.over.replay')}
          </Button>
          <Button variant="link" onClick={() => setConfirmEnd(true)} data-testid="practice-end-innings">
            {t.t('practice.over.end')}
          </Button>
        </div>
      </main>
      <Dialog
        open={confirmEnd}
        title={t.t('practice.over.end_title')}
        description={t.t('practice.over.end_body', { runs: total.runs })}
        confirmLabel={t.t('practice.over.end')}
        cancelLabel={t.t('practice.common.cancel')}
        confirmVariant="danger"
        onCancel={() => setConfirmEnd(false)}
        onConfirm={() => {
          setConfirmEnd(false);
          flow.endInnings();
          onMenu();
        }}
        testId="practice-end-dialog"
      />
    </div>
  );
}

/** Variation copy keys: the wrong'un is a googly for a wrist spinner and a carrom ball for a finger spinner. */
export function variationKey(v: string, spinType?: string): string {
  return v === 'wrong_un' ? `wrong_un_${spinType === 'wrist' ? 'wrist' : 'finger'}` : v;
}

export function OutSummary({ flow, state, onNewInnings, onMenu }: Props & { onNewInnings: () => void }) {
  const t = usePracticeT();
  const { engine } = useKit();
  const inn = state.innings;
  if (!inn || !inn.dismissal) return null;
  const sum = engine.inningsSummary(inn, flow.resultsMap());
  const rec = inn.dismissal.record;
  const result = flow.resultOf(rec);
  const overs = Math.floor(sum.survivedBalls / 6);
  const balls = sum.survivedBalls % 6;
  return (
    <div className={s.overlay} data-testid="practice-out-summary" data-how={rec.dismissal ?? ''}>
      <main className={s.sheet}>
        <header className={s.header}>
          <h1 className={s.title}>{t.t('practice.out.title', { how: t.tk(`practice.result.${rec.dismissal ?? 'bowled'}`) })}</h1>
          <div className={s.total}>
            <span className={s.score} data-testid="practice-final-score">
              {t.number(sum.runs)}
            </span>
            <span className={s.muted}>{t.t('practice.out.final')}</span>
          </div>
        </header>
        <p className={s.muted} style={{ margin: 0 }} data-testid="practice-survived">
          {overs > 0 ? t.t('practice.out.survived', { overs, balls }) : t.t('practice.out.survived_balls', { balls })}
        </p>
        <div className={s.grid}>
          <section className={s.block}>
            <h3>{t.t('practice.out.why')}</h3>
            <Why result={result} record={rec} />
          </section>
          <section className={s.block}>
            <h3>{t.t('practice.over.areas')}</h3>
            <WagonWheel areas={sum.scoringAreas} handedness={inn.handedness} />
            <TimingChips timing={sum.timing} />
          </section>
        </div>
        <div className={s.actions}>
          <Button variant="secondary" icon="slowmo" onClick={() => flow.replayDismissal()} data-testid="practice-replay-dismissal">
            {t.t('practice.out.replay')}
          </Button>
          <Button variant="secondary" icon="refresh" onClick={() => void flow.repeatBall(rec)} data-testid="practice-practice-delivery">
            {t.t('practice.out.practice')}
          </Button>
          <Button
            variant="accent"
            size="lg"
            onClick={() => {
              flow.closeFinished();
              onNewInnings();
            }}
            data-testid="practice-new-innings"
            autoFocus
          >
            {t.t('practice.out.new')}
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              flow.closeFinished();
              onMenu();
            }}
          >
            {t.t('practice.menu.title')}
          </Button>
        </div>
      </main>
    </div>
  );
}

export function InningsSummary({ flow, state, onNewInnings, onMenu }: Props & { onNewInnings: () => void }) {
  const t = usePracticeT();
  const { engine } = useKit();
  const inn = state.innings;
  if (!inn) return null;
  const sum = engine.inningsSummary(inn, flow.resultsMap());
  const best = sum.perOver.reduce<{ i: number; runs: number } | null>((b, o, i) => (!b || o.runs > b.runs ? { i, runs: o.runs } : b), null);
  const full = sum.completedOvers >= PRACTICE_MAX_OVERS;
  return (
    <div className={s.overlay} data-testid="practice-innings-summary" data-overs={sum.completedOvers}>
      <main className={s.sheet}>
        <header className={s.header}>
          <h1 className={s.title}>{full ? t.t('practice.done.title') : t.t('practice.done.ended')}</h1>
          <div className={s.total}>
            <span className={s.score} data-testid="practice-final-score">
              {t.number(sum.runs)}
            </span>
            <span className={s.muted}>{t.t('practice.common.balls', { count: sum.balls })}</span>
          </div>
        </header>
        {full && <p className={s.muted} style={{ margin: 0 }}>{t.t('practice.done.body')}</p>}
        <div className={s.grid}>
          <section className={s.block}>
            <dl className={s.stats}>
              <div>
                <dt>{t.t('practice.done.strike_rate')}</dt>
                <dd>{t.number(sum.strikeRate, { maximumFractionDigits: 1 })}</dd>
              </div>
              <div>
                <dt>{t.t('practice.over.boundaries')}</dt>
                <dd>
                  {t.t('practice.common.fours', { count: sum.fours })} · {t.t('practice.common.sixes', { count: sum.sixes })}
                </dd>
              </div>
              {best && (
                <div>
                  <dt>{t.t('practice.done.best_over')}</dt>
                  <dd>{t.t('practice.done.best_over_value', { n: best.i + 1, runs: best.runs })}</dd>
                </div>
              )}
            </dl>
            <h3>{t.t('practice.over.timing')}</h3>
            <TimingChips timing={sum.timing} testId="practice-timing-summary" />
          </section>
          <section className={s.block}>
            <h3>{t.t('practice.over.areas')}</h3>
            <WagonWheel areas={sum.scoringAreas} handedness={inn.handedness} />
          </section>
        </div>
        <section className={s.block}>
          <h3>{t.t('practice.done.per_over')}</h3>
          <ol className={s.perOver}>
            {sum.perOver.map((o, i) => (
              <li key={i}>
                <span className={s.muted}>{i + 1}</span>
                <b>{t.number(o.runs)}</b>
              </li>
            ))}
          </ol>
        </section>
        <div className={s.actions}>
          <Button
            variant="accent"
            size="lg"
            onClick={() => {
              flow.closeFinished();
              onNewInnings();
            }}
            data-testid="practice-new-innings"
            autoFocus
          >
            {t.t('practice.done.new')}
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              flow.closeFinished();
              onMenu();
            }}
          >
            {t.t('practice.menu.title')}
          </Button>
        </div>
      </main>
    </div>
  );
}
