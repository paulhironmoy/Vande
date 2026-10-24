import type { DailyRecordV2 } from '@/engine/types';
import { formatCountdown, msUntilReset } from './dailyTime';

export type DailyStatus = 'not-started' | 'in-progress' | 'official' | 'practice-only';

export interface DailyStateView {
  status: DailyStatus;
  record?: DailyRecordV2;
  /** One short line for the Home CTA caption. */
  line: string;
  /** Primary button label. */
  cta: string;
}

export function findRecord(records: DailyRecordV2[] | undefined, dailyId: string): DailyRecordV2 | undefined {
  return records?.find((r) => r.dailyId === dailyId);
}

/**
 * Today's state in one glance. `inProgress` is true when a daily attempt for `dailyId` is currently saved
 * (the store's plan points at it and a game exists).
 */
export function dailyStateFor(dailyId: string, records: DailyRecordV2[] | undefined, inProgress: boolean, simple: boolean, now: Date = new Date()): DailyStateView {
  const record = findRecord(records, dailyId);
  const until = formatCountdown(msUntilReset(now));
  if (record?.official) {
    const best = record.practice?.best;
    const practiceNote = best && best.score > record.official.score ? ` · ${simple ? 'best practice' : 'practice best'} ${best.score}` : '';
    return {
      status: 'official',
      record,
      line: `${simple ? 'Done today' : 'Official result'}: ${record.official.score}${practiceNote} · ${simple ? 'new one in' : 'next crisis in'} ${until}`,
      cta: simple ? "Practice today's crisis" : "Practice today's crisis",
    };
  }
  if (inProgress) {
    return { status: 'in-progress', record, line: simple ? 'In progress · pick up where you left off' : 'In progress · your official attempt', cta: simple ? "Keep playing today's crisis" : "Continue today's crisis" };
  }
  return {
    status: 'not-started',
    record,
    line: simple ? 'Not started · about 3 minutes' : 'Not started · about 3 minutes · first finish is official',
    cta: simple ? "Play today's crisis" : "Play Today's Crisis",
  };
}
