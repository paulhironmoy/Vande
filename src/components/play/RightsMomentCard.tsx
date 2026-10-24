import type { RightsMoment } from '@/engine/types';
import { PlayButton } from './PlayButton';
import { PlayIcon } from './icons';
import { SIMPLE_UI } from '@/app/simple';
import { SIMPLE_TEXT } from './simpleCopy';
import styles from './RightsMomentCard.module.css';

export interface RightsMomentCardProps {
  moment: RightsMoment;
  /** Option chosen by the player; when set the explanation is shown. */
  answeredOptionId?: string;
  onChoose: (optionId: string) => void;
  onContinue: () => void;
  disabled?: boolean;
  /** Simple play style: "Fair play moment" with plain words. */
  simple?: boolean;
}

function formatContentDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function RightsMomentCard({ moment, answeredOptionId, onChoose, onContinue, disabled, simple }: RightsMomentCardProps) {
  const chosen = answeredOptionId ? moment.options.find((o) => o.id === answeredOptionId) : undefined;
  const sm = simple ? moment.simple : undefined;
  return (
    <article className={[styles.card, simple ? styles.simple : ''].filter(Boolean).join(' ')} data-testid="rights-moment" data-simple={simple ? 'true' : undefined} aria-labelledby={`rights-${moment.id}`}>
      <header className={styles.header}>
        <span className={styles.kicker}>
          <PlayIcon name="scale" size={14} />
          {simple ? SIMPLE_UI.fairPlay : 'Rights moment'}
        </span>
      </header>
      <h3 id={`rights-${moment.id}`} className={styles.question} tabIndex={-1}>
        {sm?.question ?? moment.question}
      </h3>
      {!chosen ? (
        <ul className={styles.options} aria-label="Answers">
          {moment.options.map((o) => (
            <li key={o.id}>
              <button type="button" className={styles.option} data-testid={`rights-option-${o.id}`} onClick={() => onChoose(o.id)} disabled={disabled}>
                {sm?.options[o.id] ?? o.text}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className={styles.reveal} role="status">
          <p className={styles.verdict} data-correct={chosen.correct ? 'true' : 'false'}>
            <PlayIcon name={chosen.correct ? 'check' : 'info'} size={16} />
            <span>{chosen.correct ? (simple ? SIMPLE_TEXT.verdictRight : 'That holds up.') : SIMPLE_TEXT.verdictWrong}</span>
          </p>
          <p className={styles.feedback}>{(simple && sm?.feedback?.[chosen.id]) || chosen.feedback}</p>
          <dl className={styles.explain}>
            <div>
              <dt>{simple ? SIMPLE_TEXT.principleHeading : 'The principle'}</dt>
              <dd>{sm?.principle ?? moment.principle}</dd>
            </div>
            <div>
              <dt>{simple ? SIMPLE_TEXT.whyHeading : 'Why it mattered here'}</dt>
              <dd>{sm?.why ?? moment.why}</dd>
            </div>
          </dl>
          <p className={styles.footer}>
            {moment.source ? (
              <a className={styles.source} href={moment.source.url} target="_blank" rel="noopener noreferrer">
                {simple ? SIMPLE_TEXT.readRule : moment.source.label}
                <PlayIcon name="external" size={13} />
                <span className={styles.srOnly}> (opens in a new tab)</span>
              </a>
            ) : null}
            <span className={styles.date}>
              {simple ? SIMPLE_TEXT.reviewed : 'Content reviewed'} {formatContentDate(moment.contentDate)}
            </span>
          </p>
          <p className={styles.disclaimer}>{SIMPLE_UI.notLegalAdvice}</p>
          <PlayButton variant="primary" block data-testid="rights-continue" onClick={onContinue} iconRight="arrowRight">
            {simple ? SIMPLE_TEXT.next : 'Continue'}
          </PlayButton>
        </div>
      )}
    </article>
  );
}
