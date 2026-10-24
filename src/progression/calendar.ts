import type { DailyRecord, DailyRecordV2 } from '@/engine/types';
import { shiftDailyId, utcDailyId } from './dailyTime';

export type CalendarCellState = 'official' | 'practice' | 'missed' | 'today' | 'future' | 'before';

export interface CalendarCell {
  dailyId: string;
  day: number;
  state: CalendarCellState;
  score?: number;
  /** True when the day is the current day (may also be official). */
  isToday: boolean;
}

export interface CalendarMonth {
  year: number;
  /** 0-based */
  month: number;
  /** Leading blanks so the first cell lands on the right weekday (Monday-first). */
  leading: number;
  cells: CalendarCell[];
  /** Days with an official result this month. */
  officialCount: number;
  /** Days with any completion this month. */
  playedCount: number;
}

export interface CalendarRecordIndex {
  official: Map<string, number>;
  practice: Map<string, number>;
  /** Earliest day with any record; days before it are never "missed". */
  firstPlayed?: string;
}

/** Merge v2 records and legacy v1 records (local-date keyed; shown as official completions) into one index. */
export function indexRecords(v2: DailyRecordV2[] | undefined, legacy: DailyRecord[] | undefined): CalendarRecordIndex {
  const official = new Map<string, number>();
  const practice = new Map<string, number>();
  for (const r of v2 ?? []) {
    if (r.official) official.set(r.dailyId, r.official.score);
    else if (r.practice) practice.set(r.dailyId, r.practice.best.score);
  }
  for (const r of legacy ?? []) {
    if (!official.has(r.date) && !practice.has(r.date)) official.set(r.date, r.score);
  }
  const all = [...official.keys(), ...practice.keys()].sort();
  return { official, practice, firstPlayed: all[0] };
}

export function buildMonth(year: number, month: number, index: CalendarRecordIndex, todayId: string = utcDailyId()): CalendarMonth {
  const first = new Date(Date.UTC(year, month, 1));
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const leading = (first.getUTCDay() + 6) % 7; // Monday-first
  const cells: CalendarCell[] = [];
  let officialCount = 0;
  let playedCount = 0;
  for (let day = 1; day <= daysInMonth; day++) {
    const dailyId = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const isToday = dailyId === todayId;
    let state: CalendarCellState;
    let score: number | undefined;
    if (dailyId > todayId) state = 'future';
    else if (index.official.has(dailyId)) {
      state = 'official';
      score = index.official.get(dailyId);
      officialCount++;
      playedCount++;
    } else if (index.practice.has(dailyId)) {
      state = 'practice';
      score = index.practice.get(dailyId);
      playedCount++;
    } else if (isToday) state = 'today';
    else if (dailyId > todayId) state = 'future';
    else if (!index.firstPlayed || dailyId < index.firstPlayed) state = 'before';
    else state = 'missed';
    cells.push({ dailyId, day, state, score, isToday });
  }
  return { year, month, leading, cells, officialCount, playedCount };
}

/** Last `n` days ending today, oldest first, for the mini mosaic. */
export function recentDays(index: CalendarRecordIndex, n: number, todayId: string = utcDailyId()): CalendarCell[] {
  const out: CalendarCell[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const dailyId = shiftDailyId(todayId, -i);
    const [, , d] = dailyId.split('-');
    const isToday = i === 0;
    let state: CalendarCellState = 'missed';
    let score: number | undefined;
    if (index.official.has(dailyId)) {
      state = 'official';
      score = index.official.get(dailyId);
    } else if (index.practice.has(dailyId)) {
      state = 'practice';
      score = index.practice.get(dailyId);
    } else if (isToday) state = 'today';
    else if (!index.firstPlayed || dailyId < index.firstPlayed) state = 'before';
    out.push({ dailyId, day: Number(d), state, score, isToday });
  }
  return out;
}

/** Humane summary line: counts what was done, never what was lost. */
export function monthLine(month: CalendarMonth, simple: boolean): string {
  const n = month.officialCount;
  if (n === 0) return simple ? 'No days yet this month. Today is a good start.' : 'No official results yet this month. Today still counts.';
  return `${n} ${n === 1 ? 'day' : 'days'} this month${simple ? '. Nice.' : ''}`;
}

export const CALENDAR_REASSURANCE = {
  full: 'Missed days are fine. Today still counts.',
  simple: 'Missed a day? No problem. Play today.',
} as const;
