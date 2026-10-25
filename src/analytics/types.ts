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
  | 'subsequent_day_return'
  | 'lite_completed'
  | 'lite_shared'
  | 'lite_challenge_opened'
  | 'lite_twist_answered'
  | 'lite_reply_sent'
  | 'lite_reply_opened';

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
  /** lite_twist_answered: the twist was answered right. */
  right?: boolean;
  /** lite_reply_sent: the trade-results experiment was on. */
  tradeResults?: boolean;
  /** lite_reply_opened: the reply earned Helper points now. */
  awarded?: boolean;
  /** lite_reply_opened: a cap stopped the award. */
  capped?: boolean;
  /** lite_completed: questions shown with pictures, and best picks on them (bias check for pictures). */
  visualQuestions?: number;
  visualBest?: number;
  /** lite_completed: questions shown as text, and best picks on them. */
  textQuestions?: number;
  textBest?: number;
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
  'right',
  'tradeResults',
  'awarded',
  'capped',
  'visualQuestions',
  'visualBest',
  'textQuestions',
  'textBest',
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
