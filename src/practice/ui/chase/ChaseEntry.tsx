/**
 * The Chase entry on the Practice home, beside Random Over and Predefined Over: its name and the one-line promise.
 * It is a quiet choice (Random Over stays the one dominant action); it carries no badge, no counter and no reward.
 */
import { CHASE_BALLS } from '@/practice/chase/types';
import { usePracticeT } from '@/i18n/practice';
import { PChoice } from '../design';
import s from './chase.module.css';

export function ChaseEntry({ onClick }: { onClick: () => void }) {
  const t = usePracticeT();
  return (
    <PChoice
      className={s.entry}
      title={t.t('practice.chase.home.title')}
      description={t.t('practice.chase.home.sub', { balls: CHASE_BALLS })}
      onClick={onClick}
      data-testid="practice-chase"
    />
  );
}
