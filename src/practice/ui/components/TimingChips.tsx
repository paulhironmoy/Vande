/** How the balls were timed: Perfect, Solid, Mistimed, Missed, Left, with counts (words and numbers, no colour code). */
import type { SwingTiming } from '@/contracts';
import { usePracticeT } from '@/i18n/practice';
import s from './Hud.module.css';

const ORDER: SwingTiming[] = ['perfect', 'solid', 'mistimed', 'missed', 'none'];

export function TimingChips({ timing, testId }: { timing: Record<SwingTiming, number>; testId?: string }) {
  const t = usePracticeT();
  return (
    <ul className={s.chips} data-testid={testId}>
      {ORDER.filter((k) => timing[k] > 0).map((k) => (
        <li key={k} className={s.chip}>
          {t.tk(`practice.timing.${k}`)} <b>{t.number(timing[k])}</b>
        </li>
      ))}
    </ul>
  );
}
