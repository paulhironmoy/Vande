/**
 * The chase's briefing on the setup screen, in place of the Random Over's choices: the target in plain numbers, the
 * rules in one line, that the target never changes, and why "Practice this ball" is not part of a chase. Nothing here
 * covers the delivery; it is read once, before ball 1, and the same words are what the rail then keeps short.
 */
import { usePracticeT } from '@/i18n/practice';
import { sys } from '../design';
import type { ChaseFlow } from '../flow/state';
import s from './chase.module.css';

export function ChaseBrief({ chase }: { chase: ChaseFlow }) {
  const t = usePracticeT();
  const { definition, runsNeeded, ballsLeft } = chase.state;
  return (
    <section className={s.target} aria-labelledby="practice-chase-brief-need" data-testid="practice-chase-brief">
      <p className={sys.caption} data-testid="practice-chase-brief-target">
        {t.t('practice.chase.setup.target', { target: definition.target })}
      </p>
      <p className={sys.caption} data-testid="practice-chase-brief-level">
        {t.t('practice.chase.setup.level', { level: t.t(`practice.chase.level.${definition.difficulty}`) })}
      </p>
      <p id="practice-chase-brief-need" className={s.targetNeed} data-testid="practice-chase-brief-need">
        {t.t('practice.chase.need', { runs: runsNeeded, balls: ballsLeft })}
      </p>
      <p className={s.targetRules}>{t.t('practice.chase.setup.rules', { overs: definition.overs })}</p>
      <p className={`${sys.caption} ${s.targetNote}`}>{t.t('practice.chase.setup.fixed')}</p>
      <p className={`${sys.caption} ${s.targetNote}`} data-testid="practice-chase-no-retry">
        {t.t('practice.chase.setup.no_practice')}
      </p>
    </section>
  );
}
