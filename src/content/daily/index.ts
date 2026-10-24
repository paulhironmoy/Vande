/**
 * Daily crisis pool. Generated structure: one JSON file per authored day plus the schedule.
 * To add days 31–90: author dNNN.json, import it here, append its id to schedule.order — never reorder or
 * remove published entries, and pin dates in schedule.pinned once they have been played (docs/CONTENT-DAILY.md).
 */
import type { DailyCrisis, DailySchedule } from '../../engine/types';
import schedule from './schedule.json';
import d001 from './days/d001.json';
import d002 from './days/d002.json';
import d003 from './days/d003.json';
import d004 from './days/d004.json';
import d005 from './days/d005.json';
import d006 from './days/d006.json';
import d007 from './days/d007.json';
import d008 from './days/d008.json';
import d009 from './days/d009.json';
import d010 from './days/d010.json';
import d011 from './days/d011.json';
import d012 from './days/d012.json';
import d013 from './days/d013.json';
import d014 from './days/d014.json';
import d015 from './days/d015.json';
import d016 from './days/d016.json';
import d017 from './days/d017.json';
import d018 from './days/d018.json';
import d019 from './days/d019.json';
import d020 from './days/d020.json';
import d021 from './days/d021.json';
import d022 from './days/d022.json';

export const SCHEDULE = schedule as DailySchedule;
export const DAILY_CONTENT_VERSION: string = SCHEDULE.contentVersion;

export const DAYS: Record<string, DailyCrisis> = {
  d001: d001 as unknown as DailyCrisis,
  d002: d002 as unknown as DailyCrisis,
  d003: d003 as unknown as DailyCrisis,
  d004: d004 as unknown as DailyCrisis,
  d005: d005 as unknown as DailyCrisis,
  d006: d006 as unknown as DailyCrisis,
  d007: d007 as unknown as DailyCrisis,
  d008: d008 as unknown as DailyCrisis,
  d009: d009 as unknown as DailyCrisis,
  d010: d010 as unknown as DailyCrisis,
  d011: d011 as unknown as DailyCrisis,
  d012: d012 as unknown as DailyCrisis,
  d013: d013 as unknown as DailyCrisis,
  d014: d014 as unknown as DailyCrisis,
  d015: d015 as unknown as DailyCrisis,
  d016: d016 as unknown as DailyCrisis,
  d017: d017 as unknown as DailyCrisis,
  d018: d018 as unknown as DailyCrisis,
  d019: d019 as unknown as DailyCrisis,
  d020: d020 as unknown as DailyCrisis,
  d021: d021 as unknown as DailyCrisis,
  d022: d022 as unknown as DailyCrisis,
};
