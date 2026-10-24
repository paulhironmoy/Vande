import { useEffect, useMemo, useState } from 'react';
import { useApp } from '@/app/store';
import { useSimple } from '@/app/simple';
import { track } from '@/analytics';
import { Button, ScreenShell } from '@/components/ui';
import { CalendarGrid } from '@/components/progression/CalendarGrid';
import { CALENDAR_REASSURANCE, buildMonth, indexRecords, monthLine, type CalendarCell } from '@/progression/calendar';
import { utcDailyId } from '@/progression/dailyTime';
import s from './CalendarScreen.module.css';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Civic calendar: what you did, never what you lost. */
export function CalendarScreen() {
  const dailyV2 = useApp((st) => st.dailyV2);
  const daily = useApp((st) => st.daily);
  const startDailyById = useApp((st) => st.startDailyById);
  const startDailyQuickPlay = useApp((st) => st.startDailyQuickPlay);
  const back = useApp((st) => st.back);
  const simple = useSimple();
  const todayId = utcDailyId();
  const [y0, m0] = todayId.split('-').map(Number);
  const [view, setView] = useState({ year: y0, month: m0 - 1 });

  const index = useMemo(() => indexRecords(dailyV2, daily), [dailyV2, daily]);
  const month = useMemo(() => buildMonth(view.year, view.month, index, todayId), [view, index, todayId]);
  const earliest = index.firstPlayed ?? todayId;
  const canGoBack = `${view.year}-${String(view.month + 1).padStart(2, '0')}` > earliest.slice(0, 7);
  const canGoForward = view.year < y0 || (view.year === y0 && view.month < m0 - 1);

  useEffect(() => {
    track('calendar_viewed', { mode: simple ? 'simple' : 'full' });
  }, [simple]);

  const shift = (d: number) => {
    const m = view.month + d;
    if (m < 0) setView({ year: view.year - 1, month: 11 });
    else if (m > 11) setView({ year: view.year + 1, month: 0 });
    else setView({ year: view.year, month: m });
  };

  const pick = (cell: CalendarCell) => {
    if (cell.isToday) startDailyQuickPlay();
    else startDailyById(cell.dailyId);
  };

  return (
    <ScreenShell title={simple ? 'Your days' : 'Calendar'} onBack={() => back()} narrow testId="calendar-screen">
      <div className={s.stack}>
        <p className={s.summary} data-testid="calendar-summary">
          {monthLine(month, simple)}
        </p>
        <p className={s.reassure}>{simple ? CALENDAR_REASSURANCE.simple : CALENDAR_REASSURANCE.full}</p>
        <div className={s.nav}>
          <Button variant="ghost" size="sm" icon="back" onClick={() => shift(-1)} disabled={!canGoBack} aria-label="Previous month" />
          <h2 className={s.month}>
            {MONTHS[view.month]} {view.year}
          </h2>
          <Button variant="ghost" size="sm" iconEnd="forward" onClick={() => shift(1)} disabled={!canGoForward} aria-label="Next month" />
        </div>
        <CalendarGrid month={month} onPick={pick} simple={simple} />
        <ul className={s.legend} aria-label="Legend">
          <li>
            <span className={s.swatch} data-state="official" /> {simple ? 'Done' : 'Official'}
          </li>
          <li>
            <span className={s.swatch} data-state="practice" /> Practice
          </li>
          <li>
            <span className={s.swatch} data-state="today" /> Today
          </li>
        </ul>
      </div>
    </ScreenShell>
  );
}
