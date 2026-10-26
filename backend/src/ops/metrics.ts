/**
 * Counters. Production writes Workers Analytics Engine data points (binding METRICS; one blob for the metric name, up
 * to three label blobs, one double). Labels are closed vocabularies (route patterns, error codes, scopes), never ids.
 * Without the binding the counters only exist in memory for the isolate (tests read them).
 */
import type { AnalyticsEngineLike } from '../env';

export type MetricName =
  | 'request'
  | 'error'
  | 'rate_limited'
  | 'idempotent_replay'
  | 'guest_created'
  | 'guest_refused_age'
  | 'refresh_rotated'
  | 'refresh_reuse_revoked'
  | 'refresh_grace_reissue'
  | 'session_signed_out'
  | 'sessions_revoked'
  | 'account_linked'
  | 'account_deleted'
  | 'duel_created'
  | 'invite_accepted'
  | 'over_locked'
  | 'ball_revealed'
  | 'ball_resolved'
  | 'match_revealed'
  | 'match_expired'
  | 'auto_over'
  | 'auto_xi'
  | 'index_sync_failed'
  | 'notify_sent'
  | 'notify_dead_letter'
  | 'engine_error'
  | 'room_post'
  | 'room_muted'
  | 'cup_created'
  | 'cup_joined'
  | 'cup_started'
  | 'cup_cancelled'
  | 'cup_round_revealed'
  | 'cup_completed'
  | 'daily_attempt'
  | 'daily_finished'
  | 'daily_uncounted'
  | 'leaderboard_read'
  | 'notify_dropped'
  | 'notify_deferred'
  | 'timing_suspicious'
  | 'top100_frozen'
  | 'top100_missing_performance'
  | 'highlight_status'
  | 'render_claimed'
  | 'upload_resumed'
  | 'quota_overflow'
  | 'youtube_error'
  | 'attribution'
  | 'match_shared'
  | 'share_moment'
  | 'share_moment_refused'
  | 'admin_action'
  | 'media_dead_letter'
  | 'highlight_removal_failed'
  | 'delivery_unlocked';

export interface Metrics {
  count(name: MetricName, labels?: string[], value?: number): void;
}

export class MemoryMetrics implements Metrics {
  counts = new Map<string, number>();
  count(name: MetricName, labels: string[] = [], value = 1): void {
    const key = [name, ...labels].join('|');
    this.counts.set(key, (this.counts.get(key) ?? 0) + value);
  }
  get(name: MetricName, ...labels: string[]): number {
    return this.counts.get([name, ...labels].join('|')) ?? 0;
  }
  /** Sum over every label combination of a metric. */
  total(name: MetricName): number {
    let n = 0;
    for (const [k, v] of this.counts) if (k === name || k.startsWith(`${name}|`)) n += v;
    return n;
  }
}

/**
 * High-volume counters are written to Analytics Engine for 1 in SAMPLE_EVERY events with the weight SAMPLE_EVERY (an
 * unbiased estimate at a tenth of the data points); everything else is written every time.
 */
export const SAMPLED: ReadonlySet<MetricName> = new Set(['request', 'ball_revealed', 'ball_resolved', 'idempotent_replay', 'refresh_rotated']);
export const SAMPLE_EVERY = 10;

export function analyticsEngineMetrics(dataset: AnalyticsEngineLike | undefined, fallback: Metrics, random: () => number = Math.random): Metrics {
  if (!dataset) return fallback;
  return {
    count(name, labels = [], value = 1) {
      fallback.count(name, labels, value);
      const sampled = SAMPLED.has(name);
      if (sampled && random() >= 1 / SAMPLE_EVERY) return;
      try {
        dataset.writeDataPoint({ indexes: [name], blobs: [name, ...labels.slice(0, 3)], doubles: [sampled ? value * SAMPLE_EVERY : value] });
      } catch {
        /* metrics must never fail a request */
      }
    },
  };
}
