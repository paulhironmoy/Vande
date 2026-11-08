/** The six balls of an over after it is played, each one a way into Coach Mode for that exact ball. */
import type { DeliveryRecord } from '@/contracts';
import { usePracticeT } from '@/i18n/practice';
import { markText, variationName } from '../coaching';
import { sys } from '../design';
import s from './Summary.module.css';

export function OverBalls({ deliveries, onPractice, testId = 'practice-over-balls' }: { deliveries: readonly DeliveryRecord[]; onPractice: ((r: DeliveryRecord) => void) | null; testId?: string }) {
  const t = usePracticeT();
  return (
    <ol className={s.balls} aria-label={t.t('practice.summary.balls')} data-testid={testId}>
      {deliveries.map((d) => (
        <li key={d.ballIndex}>
          <button type="button" className={s.ball} onClick={onPractice ? () => onPractice(d) : undefined} disabled={!onPractice} data-testid={`practice-repeat-${d.ballIndex + 1}`}>
            <span className={s.ballMark} data-state={d.dismissal ? 'out' : d.runs >= 4 ? 'boundary' : 'done'} aria-hidden="true">
              {markText(d)}
            </span>
            {/* The visible words lead the accessible name; the rest is said, not shown. */}
            <span className={s.ballName}>{variationName(t, d.plan.variation, d.bowler.spinType)}</span>
            <span className={sys.srOnly}>{t.t('practice.summary.ball_said', { n: d.ballIndex + 1, result: d.dismissal ? t.tk(`practice.result.${d.dismissal}`) : t.t('practice.result.runs', { runs: d.runs }) })}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}
