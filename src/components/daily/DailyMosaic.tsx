import type { CalendarCell } from '@/progression/calendar';
import { dailyIdWords } from '@/progression/dailyTime';
import s from './DailyMosaic.module.css';

const STATE_WORD: Record<CalendarCell['state'], string> = {
  official: 'done',
  practice: 'practice only',
  missed: 'not played',
  today: 'today, not played yet',
  future: 'coming',
  before: 'before you started',
};

/** Seven small tiles, oldest first. Neutral everywhere; nothing is red, nothing is lost. */
export function DailyMosaic({ cells, className }: { cells: CalendarCell[]; className?: string }) {
  return (
    <ul className={[s.row, className ?? ''].filter(Boolean).join(' ')} aria-label="Last seven days" data-testid="daily-mosaic">
      {cells.map((c) => (
        <li key={c.dailyId} className={s.cell} data-state={c.state} data-testid={`mosaic-${c.dailyId}`} aria-label={`${dailyIdWords(c.dailyId)}: ${STATE_WORD[c.state]}${c.score !== undefined ? `, ${c.score}` : ''}`}>
          <span className={s.dot} aria-hidden="true" />
          <span className={s.day} aria-hidden="true">
            {c.day}
          </span>
        </li>
      ))}
    </ul>
  );
}
