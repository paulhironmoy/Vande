/**
 * MASTER: exact-ball Coach Mode (constitution §1: learn and retry the delivery). The same release, trajectory,
 * bounce and field every time ("Replay exact ball"), with the assistance stages 1 → 4 (full trajectory and a ghost,
 * pitch and contact markers, a contact cue, nothing). Each attempt is compared with the previous one in plain words,
 * and the coach's mastery rule (never one lucky result) decides when help is removed and when the ball is mastered.
 */
import type { AssistanceStage } from '@/contracts';
import { Icon } from '@/ui';
import { usePracticeT } from '@/i18n/practice';
import { PButton, sys } from '../design';
import { useKit } from '../context';
import { cardTip, comparisonLines, deliveryLine, isConfirmation, outcomeWord, recommendationLine } from '../coaching';
import type { CoachSession } from '../flow/state';
import s from '../components/Live.module.css';
import c from './Coach.module.css';

export interface CoachProps {
  session: CoachSession;
  busy: boolean;
  onReplay: () => void;
  onDemo: () => void;
  onBack: () => void;
}

const STAGES: readonly AssistanceStage[] = [1, 2, 3, 4];

export function Coach({ session: m, busy, onReplay, onDemo, onBack }: CoachProps) {
  const t = usePracticeT();
  const { coach, build } = useKit();
  if (!coach) return null;
  const progress = coach.masteryProgress(m.mastery);
  const latest = m.latest;
  // One sentence, one action (RK4): the newest attempt's tip (its own measured fact, and the one change from it), or
  // the source ball's before the first attempt. Its action is the recommendation the demonstration plays.
  const read = latest ?? (m.base ? { analysis: m.base, tip: m.baseTip } : null);
  const rec = read ? coach.primaryInsight(read.analysis).recommendation : null;
  const cmp = m.comparison;
  // The card agrees with the comparison shown beside it (O-4): no confirmation of an attempt the coach measured as worse.
  const shown = read?.tip ? cardTip(read.tip, read.analysis, latest ? cmp : null) : null;
  const notWorse = !(latest && cmp?.verdict === 'worse');
  // A confirmation is praise, shown only when earned (anti-fake rule 7), by the attempt's measured contact too (its tip).
  const confirm = Boolean(
    read &&
    rec &&
    isConfirmation(rec) &&
    notWorse &&
    !shown?.withheld &&
    coach.praiseEarned(read.analysis, rec, read.tip ?? null),
  );
  const line = shown
    ? coach.tipWords(t, shown.tip).sentence
    : !rec
      ? t.t('practice.result.reading')
      : confirm || !isConfirmation(rec)
        ? recommendationLine(t, rec)
        : '';
  const stageName = (n: AssistanceStage) => t.tk(`practice.coachmode.stage.${n}`);
  const progressLine = progress.mastered
    ? t.t('practice.coachmode.mastered')
    : progress.stage < 4
      ? t.t('practice.coachmode.to_advance', { count: progress.neededToAdvance })
      : t.t('practice.coachmode.to_master', { done: progress.recentSuccesses ?? 0, window: progress.recentWindow });
  return (
    <section
      className={`${s.result} ${c.coach}`}
      data-expanded="true"
      aria-labelledby="practice-coach-title"
      data-testid="practice-coach"
    >
      <h2 id="practice-coach-title" className={sys.section}>
        {t.t('practice.coachmode.title', { over: m.overNumber, ball: m.ballNumber })}
      </h2>
      <p className={sys.caption}>{deliveryLine(t, build, m.sourceResult, m.source.bowler)}</p>
      <p
        className={s.rec}
        data-confirm={confirm ? 'true' : 'false'}
        data-mistake={read?.tip?.mistake ?? 'none'}
        data-testid="practice-coach-recommendation"
      >
        <span className={s.recIcon} aria-hidden="true">
          <Icon name={rec && !confirm ? 'forward' : 'check'} size={16} />
        </span>
        {line}
      </p>
      <div
        className={c.stages}
        data-testid="practice-mastery"
        data-stage={progress.stage}
        data-mastered={progress.mastered ? 'true' : 'false'}
      >
        <ol className={c.dots} aria-label={t.t('practice.coachmode.stage_of', { n: progress.stage })}>
          {STAGES.map((n) => (
            <li
              key={n}
              className={c.dot}
              data-state={progress.mastered || n < progress.stage ? 'done' : n === progress.stage ? 'current' : 'todo'}
            >
              {n < progress.stage || progress.mastered ? <Icon name="check" size={12} /> : n}
            </li>
          ))}
        </ol>
        <p className={sys.body}>
          <strong>{stageName(progress.stage)}</strong>
        </p>
        <p className={sys.caption}>{progressLine}</p>
      </div>
      {latest && (
        <div
          className={c.attempt}
          aria-live="polite"
          data-testid="practice-compare"
          data-verdict={cmp?.verdict ?? 'none'}
        >
          <p className={sys.body}>
            <span className={c.verdict} data-verdict={cmp?.verdict ?? 'same'}>
              {cmp ? t.tk(`practice.compare.verdict.${cmp.verdict}`) : ''}
            </span>{' '}
            {outcomeWord(t, latest.result.outcome).word}
          </p>
          {cmp && (
            <ul className={s.whyList}>
              {comparisonLines(t, cmp).map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          )}
          {m.event && (
            <p className={c.event}>
              {t.tk(`practice.coachmode.event.${m.event}`, { stage: stageName(progress.stage) })}
            </p>
          )}
        </div>
      )}
      {m.attempts.length > 0 && (
        <p className={sys.caption}>
          {t.t('practice.coachmode.attempts', { count: m.attempts.length, clean: m.attempts.filter(Boolean).length })}
        </p>
      )}
      <div className={s.actions}>
        <PButton variant="primary" icon="replay" onClick={onReplay} disabled={busy} data-testid="practice-replay-exact">
          {t.t('practice.coachmode.replay')}
        </PButton>
        <PButton
          variant="secondary"
          icon="play"
          onClick={onDemo}
          disabled={busy || !m.base}
          data-testid="practice-coach-demo"
        >
          {t.t('practice.result.demo')}
        </PButton>
      </div>
      <PButton variant="quiet" onClick={onBack} disabled={busy} data-testid="practice-coach-back">
        {t.t('practice.coachmode.back')}
      </PButton>
    </section>
  );
}
