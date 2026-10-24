/**
 * Analytics event dictionary. Deliberately closed: only these events and property keys may be sent.
 * Nothing here identifies a person: no names, no free text, no precise timestamps, no device fingerprints.
 */
export type AnalyticsEvent =
  | 'app_opened'
  | 'daily_entry_viewed'
  | 'daily_started'
  | 'first_choice_reached'
  | 'daily_completed'
  | 'official_result_viewed'
  | 'daily_shared'
  | 'challenge_opened'
  | 'challenge_started'
  | 'challenge_completed'
  | 'calendar_viewed'
  | 'passport_viewed'
  | 'reminder_enabled'
  | 'reminder_disabled'
  | 'subsequent_day_return';

export type ElapsedBucket = '<10s' | '10-30s' | '30-60s' | '1-2m' | '2-3m' | '3-5m' | '>5m';

export interface AnalyticsProps {
  appVersion?: string;
  platform?: 'web' | 'pwa' | 'android';
  mode?: 'simple' | 'full';
  dailyId?: string;
  contentVersion?: string;
  elapsedBucket?: ElapsedBucket;
  official?: boolean;
  state?: 'completed' | 'abandoned';
  /** Days since the previous session, bucketed (1, 2, 3-6, 7+). */
  returnGap?: '1' | '2' | '3-6' | '7+';
  shareMethod?: 'native' | 'clipboard' | 'download';
}

export const ANALYTICS_PROP_KEYS: readonly (keyof AnalyticsProps)[] = [
  'appVersion',
  'platform',
  'mode',
  'dailyId',
  'contentVersion',
  'elapsedBucket',
  'official',
  'state',
  'returnGap',
  'shareMethod',
] as const;

export interface AnalyticsAdapter {
  /** Never throws. */
  track(event: AnalyticsEvent, props?: AnalyticsProps): void;
  flush?(): Promise<void>;
}

export function elapsedBucket(ms: number): ElapsedBucket {
  const s = ms / 1000;
  if (s < 10) return '<10s';
  if (s < 30) return '10-30s';
  if (s < 60) return '30-60s';
  if (s < 120) return '1-2m';
  if (s < 180) return '2-3m';
  if (s < 300) return '3-5m';
  return '>5m';
}
