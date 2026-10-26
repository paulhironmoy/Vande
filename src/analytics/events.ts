/**
 * The closed event dictionary at runtime. `satisfies` makes the compiler check it against the root contract
 * (src/contracts/analytics.ts): an event missing here or not in the contract is a type error.
 */
import type { AnalyticsEventName, AnalyticsProps } from '@/contracts';

const EVENTS = {
  tutorial_started: true,
  tutorial_completed: true,
  first_delivery: true,
  invite_created: true,
  invite_opened: true,
  invite_accepted: true,
  over_locked: true,
  innings_completed: true,
  reveal_watched: true,
  replay_completed: true,
  tournament_joined: true,
  tournament_completed: true,
  reminder_sent: true,
  reminder_opened: true,
  share_initiated: true,
  share_completed: true,
  highlight_consent: true,
  attributed_view: true,
  attributed_install: true,
  attributed_challenge: true,
  rematch: true,
  retention_d1: true,
  retention_d7: true,
  retention_d30: true,
  notification_opt_out: true,
  group_mute: true,
  crash: true,
  renderer_fallback: true,
  practice_opened: true,
  practice_first_delivery: true,
  practice_delivery: true,
  practice_over_completed: true,
  practice_next_over: true,
  practice_replay: true,
  practice_wicket: true,
  practice_innings_completed: true,
  practice_tier: true,
} as const satisfies Record<AnalyticsEventName, true>;

export const ANALYTICS_EVENTS = Object.keys(EVENTS) as AnalyticsEventName[];

export function isAnalyticsEvent(name: unknown): name is AnalyticsEventName {
  return typeof name === 'string' && Object.prototype.hasOwnProperty.call(EVENTS, name);
}

/** Allowed values per property: closed vocabularies, a semantic version, a locale id, an attribution code. */
export const PROP_RULES: { [K in keyof Required<AnalyticsProps>]: readonly string[] | RegExp } = {
  mode: ['training', 'daily', 'duel', 'cup', 'ghost', 'practice'],
  platform: ['web', 'pwa', 'android'],
  appVersion: /^\d{1,3}\.\d{1,3}\.\d{1,4}(-[0-9a-z.]{1,16})?$/,
  locale: ['en', 'hi', 'hi-Latn', 'bn', 'te', 'mr', 'ta', 'gu', 'kn', 'ml', 'pa'],
  quality: ['low', 'standard', 'high', '2d', 'lite'],
  channel: ['share_sheet', 'whatsapp', 'copy', 'qr'],
  decision: ['granted', 'declined', 'withdrawn'],
  stage: ['group', 'final'],
  durationBucket: ['<30s', '30-60s', '1-2m', '2-5m', '>5m'],
  fpsBucket: ['<20', '20-29', '30-44', '45-59', '60+'],
  reason: ['no_webgl', 'context_lost', 'low_fps', 'error', 'rejection'],
  attribution: /^[a-z0-9]{4,16}$/,
  tier: ['full', 'assisted', 'below'],
  assist: ['learn', 'play', 'real'],
  timing: ['early', 'on_time', 'late', 'none'],
  intentMatch: ['on_target', 'near', 'off_target', 'none'],
  latencyBucket: ['<50ms', '50-70ms', '70-100ms', '>100ms'],
  ttfdBucket: ['<5s', '5-10s', '10-20s', '>20s'],
  outcome: ['dot', 'runs', 'four', 'six', 'out'],
  overNumber: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'],
};
