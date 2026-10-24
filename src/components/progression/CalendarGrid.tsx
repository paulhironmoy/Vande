import type { CalendarCell, CalendarMonth } from '@/progression/calendar';
import { dailyIdWords } from '@/progression/dailyTime';
import s from './CalendarGrid.module.css';

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

const STATE_WORD: Record<CalendarCell['state'], string> = {
  official: 'done',
  practice: 'practice only',
  missed: 'not played',
  today: 'today',
  future: 'not yet',
  before: 'before you started',
};

export interface CalendarGridProps {
  month: CalendarMonth;
  onPick?: (cell: CalendarCell) => void;
  simple?: boolean;
}

/** Month grid. Filled = official, outline = practice, dot = not played (neutral), ring = today. */
export function CalendarGrid({ month, onPick, simple }: CalendarGridProps) {
  return (
    <div className={s.grid} aria-label="Calendar">
      <div className={s.head} aria-hidden="true">
        {WEEKDAYS.map((d) => (
          <span key={d} className={s.weekday}>
            {d}
          </span>
        ))}
      </div>
      <ul className={s.body} role="list">
        {Array.from({ length: month.leading }).map((_, i) => (
          <li key={`lead-${i}`} className={s.blank} aria-hidden="true" />
        ))}
        {month.cells.map((cell) => {
          const playable = cell.state !== 'future' && cell.state !== 'before';
          const label = `${dailyIdWords(cell.dailyId)}: ${STATE_WORD[cell.state]}${cell.score !== undefined ? `, ${cell.score}` : ''}${playable && cell.state !== 'today' ? (simple ? '. Play again as practice' : '. Replay as practice') : ''}`;
          return (
            <li key={cell.dailyId} className={s.item}>
            <button
              type="button"
              className={s.cell}
              data-state={cell.state}
              data-today={cell.isToday ? 'true' : undefined}
              data-testid={`calendar-day-${cell.dailyId}`}
              aria-label={label}
              disabled={!playable || !onPick}
              onClick={() => onPick?.(cell)}
            >
              <span className={s.mark} aria-hidden="true">
                {cell.state === 'official' && (
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12l4.5 4.5L19 7" />
                  </svg>
                )}
              </span>
              <span className={s.day} aria-hidden="true">
                {cell.day}
              </span>
            </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
