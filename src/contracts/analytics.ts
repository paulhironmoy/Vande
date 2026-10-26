/**
 * Analytics event dictionary — ROOT-OWNED. Closed set of events and properties. Never log hidden strategies before a
 * reveal, message text, contacts, exact timestamps, or anything that identifies a person. Off unless configured.
 */
export type AnalyticsEventName =
  | 'tutorial_started'
  | 'tutorial_completed'
  | 'first_delivery'
  | 'invite_created'
  | 'invite_opened'
  | 'invite_accepted'
  | 'over_locked'
  | 'innings_completed'
  | 'reveal_watched'
  | 'replay_completed'
  | 'tournament_joined'
  | 'tournament_completed'
  | 'reminder_sent'
  | 'reminder_opened'
  | 'share_initiated'
  | 'share_completed'
  | 'highlight_consent'
  | 'attributed_view'
  | 'attributed_install'
  | 'attributed_challenge'
  | 'rematch'
  | 'retention_d1'
  | 'retention_d7'
  | 'retention_d30'
  | 'notification_opt_out'
  | 'group_mute'
  | 'crash'
  | 'renderer_fallback'
  // Practice (offline batting; local, consent-gated like every event; no raw gestures, no device identifiers)
  | 'practice_opened'
  | 'practice_first_delivery'
  | 'practice_delivery'
  | 'practice_over_completed'
  | 'practice_next_over'
  | 'practice_replay'
  | 'practice_wicket'
  | 'practice_innings_completed'
  | 'practice_tier';

export interface AnalyticsProps {
  mode?: 'training' | 'daily' | 'duel' | 'cup' | 'ghost' | 'practice';
  platform?: 'web' | 'pwa' | 'android';
  appVersion?: string;
  locale?: string;
  quality?: 'low' | 'standard' | 'high' | '2d' | 'lite';
  channel?: 'share_sheet' | 'whatsapp' | 'copy' | 'qr';
  decision?: 'granted' | 'declined' | 'withdrawn';
  stage?: 'group' | 'final';
  /** Coarse buckets only. */
  durationBucket?: '<30s' | '30-60s' | '1-2m' | '2-5m' | '>5m';
  fpsBucket?: '<20' | '20-29' | '30-44' | '45-59' | '60+';
  /** Renderer fallback reasons, and for `crash` only 'error' (window error) or 'rejection' (unhandled promise). */
  reason?: 'no_webgl' | 'context_lost' | 'low_fps' | 'error' | 'rejection';
  /** Attribution code from a highlight or invite link (not a person). */
  attribution?: string;
  // Practice
  tier?: 'full' | 'assisted' | 'below';
  assist?: 'learn' | 'play' | 'real';
  timing?: 'early' | 'on_time' | 'late' | 'none';
  /** Intended scoring direction versus where the ball actually went. */
  intentMatch?: 'on_target' | 'near' | 'off_target' | 'none';
  /** Pointer event to the first frame showing the bat moving. */
  latencyBucket?: '<50ms' | '50-70ms' | '70-100ms' | '>100ms';
  /** Practice selected to the first delivery released. */
  ttfdBucket?: '<5s' | '5-10s' | '10-20s' | '>20s';
  outcome?: 'dot' | 'runs' | 'four' | 'six' | 'out';
  overNumber?: '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10';
}

export const ANALYTICS_PROP_KEYS: readonly (keyof AnalyticsProps)[] = [
  'mode',
  'platform',
  'appVersion',
  'locale',
  'quality',
  'channel',
  'decision',
  'stage',
  'durationBucket',
  'fpsBucket',
  'reason',
  'attribution',
  'tier',
  'assist',
  'timing',
  'intentMatch',
  'latencyBucket',
  'ttfdBucket',
  'outcome',
  'overNumber',
] as const;
