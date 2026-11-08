/**
 * "Need 14 off 9 balls", with the rate it asks for, in the rail's left cluster beside the ball marks. Honest numbers
 * only: they change when the stage has shown the ball (the caller gives the shown chase state), they are never
 * coloured to hurry the player, and nothing in them moves. In Delivery Quiet Mode only the first line stays, dimmed
 * with the rest of the rail. Screen readers get one full sentence instead of the two short lines.
 */
import type { ChaseState } from '@/practice/chase/types';
import { usePracticeT } from '@/i18n/practice';
import { sys } from '../design';
import s from './chase.module.css';

export type ChaseNeedInput = Pick<ChaseState, 'runsNeeded' | 'ballsLeft' | 'requiredRateX100'>;

/**
 * The required rate as the player reads it: one decimal, in the locale's own digits and separator. It is made from the
 * chase's one integer (hundredths of runs an over, the figure the Unity bridge carries too) rounded half up to a tenth,
 * so the web and Unity can never disagree by a rounding of a float.
 */
export function rateText(format: (n: number, o?: Intl.NumberFormatOptions) => string, rateX100: number): string {
  return format(Math.floor((rateX100 + 5) / 10) / 10, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

export function ChaseNeed({ chase, quiet }: { chase: ChaseNeedInput; quiet: boolean }) {
  const t = usePracticeT();
  const { runsNeeded, ballsLeft, requiredRateX100 } = chase;
  const rate = requiredRateX100 === null ? null : rateText(t.number, requiredRateX100);
  return (
    <div className={s.need} data-quiet={quiet ? 'true' : 'false'} data-testid="practice-chase-need">
      <p className={s.needMain} aria-hidden="true" data-testid="practice-chase-need-main">
        {t.t('practice.chase.need', { runs: runsNeeded, balls: ballsLeft })}
      </p>
      {/* Delivery Quiet Mode: the compact line replaces it (one short line, so the rail stays under its share of the screen). */}
      <p className={s.needCompact} aria-hidden="true" data-testid="practice-chase-need-compact">
        {t.t('practice.chase.need_short', { runs: runsNeeded, balls: ballsLeft })}
      </p>
      {rate !== null && (
        <p className={s.needRate} aria-hidden="true" data-testid="practice-chase-rate">
          {t.t('practice.chase.rate', { rate })}
        </p>
      )}
      <span className={sys.srOnly} data-testid="practice-chase-need-said">
        {t.t('practice.chase.hud_label', { runs: runsNeeded, balls: ballsLeft, rate: rate ?? '' })}
      </span>
    </div>
  );
}
