import { MAX_BODY_BYTES, OUTCOMES, type DailyResultSubmission } from './contract';

export interface Validation {
  ok: boolean;
  errors: string[];
  value?: DailyResultSubmission;
}

const DAILY_ID = /^\d{4}-\d{2}-\d{2}$/;
const HEX32 = /^[0-9a-f]{32}$/;
const FP = /^[DESPXW]{1,12}$/;
const VERSION = /^[0-9A-Za-z._+-]{1,32}$/;

export function isRealUtcDate(id: string): boolean {
  if (!DAILY_ID.test(id)) return false;
  const [y, m, d] = id.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** Accepted window: [today − 2, today + 1] in UTC (time zones and queued offline submissions). */
export function dailyIdInWindow(id: string, now: Date): boolean {
  const [y, m, d] = id.split('-').map(Number);
  const day = Date.UTC(y, m - 1, d);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const diff = Math.round((day - today) / 86400000);
  return diff >= -2 && diff <= 1;
}

export function validateSubmission(raw: unknown, now: Date, allowedVersions: string[] = [], bodyBytes = 0): Validation {
  const errors: string[] = [];
  if (bodyBytes > MAX_BODY_BYTES) return { ok: false, errors: ['body too large'] };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, errors: ['body must be a JSON object'] };
  const o = raw as Record<string, unknown>;
  if (o.v !== 1) errors.push('v must be 1');
  if (typeof o.dailyId !== 'string' || !isRealUtcDate(o.dailyId)) errors.push('dailyId must be YYYY-MM-DD');
  else if (!dailyIdInWindow(o.dailyId, now)) errors.push('dailyId outside the accepted window');
  if (typeof o.contentVersion !== 'string' || !VERSION.test(o.contentVersion)) errors.push('contentVersion invalid');
  else if (allowedVersions.length > 0 && !allowedVersions.includes(o.contentVersion)) errors.push('contentVersion not accepted');
  if (typeof o.submissionId !== 'string' || !HEX32.test(o.submissionId)) errors.push('submissionId must be 32 hex chars');
  if (typeof o.score !== 'number' || !Number.isInteger(o.score) || o.score < 0 || o.score > 100) errors.push('score must be an integer 0..100');
  if (typeof o.outcome !== 'string' || !(OUTCOMES as readonly string[]).includes(o.outcome)) errors.push('outcome invalid');
  if (typeof o.fingerprint !== 'string' || !FP.test(o.fingerprint)) errors.push('fingerprint invalid');
  if (o.mode !== 'simple' && o.mode !== 'full') errors.push('mode invalid');
  if (typeof o.appVersion !== 'string' || !VERSION.test(o.appVersion)) errors.push('appVersion invalid');
  if (o.platform !== 'web' && o.platform !== 'android') errors.push('platform invalid');
  const known = new Set(['v', 'dailyId', 'contentVersion', 'submissionId', 'score', 'outcome', 'fingerprint', 'mode', 'appVersion', 'platform']);
  for (const key of Object.keys(o)) if (!known.has(key)) errors.push(`unexpected field ${key}`);
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    errors: [],
    value: {
      v: 1,
      dailyId: o.dailyId as string,
      contentVersion: o.contentVersion as string,
      submissionId: o.submissionId as string,
      score: o.score as number,
      outcome: o.outcome as DailyResultSubmission['outcome'],
      fingerprint: o.fingerprint as string,
      mode: o.mode as 'simple' | 'full',
      appVersion: o.appVersion as string,
      platform: o.platform as 'web' | 'android',
    },
  };
}
