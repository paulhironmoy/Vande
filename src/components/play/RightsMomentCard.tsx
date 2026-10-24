import type { RightsMoment } from '@/engine/types';
import { PlayButton } from './PlayButton';
import { PlayIcon } from './icons';
import styles from './RightsMomentCard.module.css';

export interface RightsMomentCardProps {
  moment: RightsMoment;
  /** Option chosen by the player; when set the explanation is shown. */
  answeredOptionId?: string;
  onChoose: (optionId: string) => void;
  onContinue: () => void;
  disabled?: boolean;
}

function formatContentDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function RightsMomentCard({ moment, answeredOptionId, onChoose, onContinue, disabled }: RightsMomentCardProps) {
  const chosen = answeredOptionId ? moment.options.find((o) => o.id === answeredOptionId) : undefined;
  return (
    <article className={styles.card} data-testid="rights-moment" aria-labelledby={`rights-${moment.id}`}>
      <header className={styles.header}>
        <span className={styles.kicker}>
          <PlayIcon name="scale" size={14} />
          Rights moment
        </span>
      </header>
      <h3 id={`rights-${moment.id}`} className={styles.question} tabIndex={-1}>
        {moment.question}
      </h3>
      {!chosen ? (
        <ul className={styles.options} aria-label="Answers">
          {moment.options.map((o) => (
            <li key={o.id}>
              <button type="button" className={styles.option} data-testid={`rights-option-${o.id}`} onClick={() => onChoose(o.id)} disabled={disabled}>
                {o.text}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className={styles.reveal} role="status">
          <p className={styles.verdict} data-correct={chosen.correct ? 'true' : 'false'}>
            <PlayIcon name={chosen.correct ? 'check' : 'info'} size={16} />
            <span>{chosen.correct ? 'That holds up.' : 'Not quite.'}</span>
          </p>
          <p className={styles.feedback}>{chosen.feedback}</p>
          <dl className={styles.explain}>
            <div>
              <dt>The principle</dt>
              <dd>{moment.principle}</dd>
            </div>
            <div>
              <dt>Why it mattered here</dt>
              <dd>{moment.why}</dd>
            </div>
          </dl>
          <p className={styles.footer}>
            {moment.source ? (
              <a className={styles.source} href={moment.source.url} target="_blank" rel="noopener noreferrer">
                {moment.source.label}
                <PlayIcon name="external" size={13} />
                <span className={styles.srOnly}> (opens in a new tab)</span>
              </a>
            ) : null}
            <span className={styles.date}>Content reviewed {formatContentDate(moment.contentDate)}</span>
          </p>
          <p className={styles.disclaimer}>Educational content—not legal advice</p>
          <PlayButton variant="primary" block data-testid="rights-continue" onClick={onContinue} iconRight="arrowRight">
            Continue
          </PlayButton>
        </div>
      )}
    </article>
  );
}
