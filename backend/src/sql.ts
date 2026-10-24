/** Every statement the worker runs, as named constants so the in-memory test stub can match them exactly. */
export const SQL = {
  insertResult:
    'INSERT OR IGNORE INTO daily_results (submission_id, daily_id, content_version, app_version, mode, score, band, outcome, fingerprint, strategy, received_hour) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)',
  /**
   * Incremental per-day aggregates, maintained in the same request as a successful insert. Every counter moves
   * inside one statement (json_set on the stored maps), so concurrent inserts never lose an update.
   * Params: 1 daily_id, 2 content_version, 3 score, 4 band key, 5 outcome key, 6 strategy key, 7 score key,
   *         8 updated_at, 9 band path, 10 outcome path, 11 strategy path, 12 score path.
   */
  upsertStats:
    'INSERT INTO daily_stats (daily_id, content_version, count, score_sum, bands_json, outcomes_json, strategies_json, scores_json, updated_at) ' +
    'VALUES (?1, ?2, 1, ?3, json_object(?4, 1), json_object(?5, 1), json_object(?6, 1), json_object(?7, 1), ?8) ' +
    'ON CONFLICT(daily_id, content_version) DO UPDATE SET count = count + 1, score_sum = score_sum + ?3, ' +
    'bands_json = json_set(bands_json, ?9, coalesce(json_extract(bands_json, ?9), 0) + 1), ' +
    'outcomes_json = json_set(outcomes_json, ?10, coalesce(json_extract(outcomes_json, ?10), 0) + 1), ' +
    'strategies_json = json_set(strategies_json, ?11, coalesce(json_extract(strategies_json, ?11), 0) + 1), ' +
    'scores_json = json_set(scores_json, ?12, coalesce(json_extract(scores_json, ?12), 0) + 1), updated_at = ?8',
  statsRow:
    'SELECT count, score_sum, bands_json, outcomes_json, strategies_json, scores_json, updated_at FROM daily_stats WHERE daily_id = ?1 AND content_version = ?2',
  /** Full aggregation: only the fallback when no incremental row exists (e.g. a day written before migration 0002). */
  countForDay: 'SELECT COUNT(*) AS n FROM daily_results WHERE daily_id = ?1 AND (?2 = "" OR content_version = ?2)',
  bandsForDay: 'SELECT band AS key, COUNT(*) AS n FROM daily_results WHERE daily_id = ?1 AND (?2 = "" OR content_version = ?2) GROUP BY band',
  outcomesForDay: 'SELECT outcome AS key, COUNT(*) AS n FROM daily_results WHERE daily_id = ?1 AND (?2 = "" OR content_version = ?2) GROUP BY outcome',
  strategiesForDay: 'SELECT strategy AS key, COUNT(*) AS n FROM daily_results WHERE daily_id = ?1 AND (?2 = "" OR content_version = ?2) GROUP BY strategy',
  scoresForDay: 'SELECT score AS key, COUNT(*) AS n FROM daily_results WHERE daily_id = ?1 AND (?2 = "" OR content_version = ?2) GROUP BY score',
  bumpBucket: 'INSERT INTO rate_buckets (bucket_key, window_start, count) VALUES (?1, ?2, 1) ON CONFLICT(bucket_key) DO UPDATE SET count = count + 1 RETURNING count',
  pruneBuckets: 'DELETE FROM rate_buckets WHERE window_start < ?1',
  pruneResults: 'DELETE FROM daily_results WHERE received_hour < ?1',
  pruneStats: 'DELETE FROM daily_stats WHERE updated_at < ?1',
} as const;

export type SqlKey = keyof typeof SQL;

/** JSON1 path for a map key, e.g. `$."40-54"`. Keys are validated enums or integers, never free text. */
export function jsonPath(key: string | number): string {
  return `$."${String(key).replace(/"/g, '')}"`;
}
