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
  countForDay: "SELECT COUNT(*) AS n FROM daily_results WHERE daily_id = ?1 AND (?2 = '' OR content_version = ?2)",
  bandsForDay: "SELECT band AS key, COUNT(*) AS n FROM daily_results WHERE daily_id = ?1 AND (?2 = '' OR content_version = ?2) GROUP BY band",
  outcomesForDay: "SELECT outcome AS key, COUNT(*) AS n FROM daily_results WHERE daily_id = ?1 AND (?2 = '' OR content_version = ?2) GROUP BY outcome",
  strategiesForDay: "SELECT strategy AS key, COUNT(*) AS n FROM daily_results WHERE daily_id = ?1 AND (?2 = '' OR content_version = ?2) GROUP BY strategy",
  scoresForDay: "SELECT score AS key, COUNT(*) AS n FROM daily_results WHERE daily_id = ?1 AND (?2 = '' OR content_version = ?2) GROUP BY score",
  bumpBucket: 'INSERT INTO rate_buckets (bucket_key, window_start, count) VALUES (?1, ?2, 1) ON CONFLICT(bucket_key) DO UPDATE SET count = count + 1 RETURNING count',
  // Cleanup deletes in batches (?1 cutoff, ?2 batch size) so one run never holds a long write; see pruneInBatches.
  // Every batch seeks by key or index instead of scanning the table: bucket keys start with their window's minute
  // (?1 is the cutoff minute), daily_results has idx_daily_results_received, and lite_attempts continues from a cursor.
  pruneBuckets: 'DELETE FROM rate_buckets WHERE bucket_key IN (SELECT bucket_key FROM rate_buckets WHERE bucket_key < ?1 LIMIT ?2)',
  pruneResults: 'DELETE FROM daily_results WHERE rowid IN (SELECT rowid FROM daily_results WHERE received_hour < ?1 LIMIT ?2)',
  pruneStats: 'DELETE FROM daily_stats WHERE rowid IN (SELECT rowid FROM daily_stats WHERE updated_at < ?1 LIMIT ?2)',

  // Verified dares (migrations 0003 and 0004). lite_attempts is a WITHOUT ROWID table keyed by (dare_key, device_key)
  // with no other index, so an insert, the grade update and the final delete each write exactly one row.
  liteInsertAttempt:
    'INSERT INTO lite_attempts (dare_key, device_key, attempt_id, seed, path, step, deadline, nonce, answer_path, points, best, kind, twist_id, marker, created_hour) ' +
    'VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15) ON CONFLICT(dare_key, device_key) DO NOTHING',
  liteAttemptByPair:
    'SELECT dare_key, device_key, attempt_id, seed, path, step, deadline, nonce, answer_path, points, best, kind, twist_id, marker, twist_answer, outcome, sig, created_hour, graded_hour FROM lite_attempts WHERE dare_key = ?1 AND device_key = ?2',
  /** Params: 1 dare_key, 2 device_key, 3 attempt_id, 4 twist_answer ('' when skipped), 5 outcome r|w|s, 6 sig, 7 graded_hour. Grades once. */
  liteGradeAttempt:
    'UPDATE lite_attempts SET twist_answer = ?4, outcome = ?5, sig = ?6, graded_hour = ?7 WHERE dare_key = ?1 AND device_key = ?2 AND attempt_id = ?3 AND outcome IS NULL',
  /** Params: 1 day (UTC), 2 best (0|1), 3 updated_at (ISO hour). */
  liteBumpGoal:
    'INSERT INTO lite_goal (day, answers, best, updated_at) VALUES (?1, 1, ?2, ?3) ' +
    'ON CONFLICT(day) DO UPDATE SET answers = answers + 1, best = best + ?2, updated_at = ?3',
  liteGoalRow: 'SELECT day, answers, best, updated_at FROM lite_goal WHERE day = ?1',
  /** ?3 is the cursor (the largest dare_key of the previous batch, '' first); returns each deleted row's dare_key as k. */
  pruneLiteAttempts:
    'DELETE FROM lite_attempts WHERE (dare_key, device_key) IN (SELECT dare_key, device_key FROM lite_attempts WHERE dare_key >= ?3 AND created_hour < ?1 ORDER BY dare_key LIMIT ?2) RETURNING dare_key AS k',
  pruneLiteGoal: 'DELETE FROM lite_goal WHERE day IN (SELECT day FROM lite_goal WHERE day < ?1 LIMIT ?2)',
} as const;

export type SqlKey = keyof typeof SQL;

/** JSON1 path for a map key, e.g. `$."40-54"`. Keys are validated enums or integers, never free text. */
export function jsonPath(key: string | number): string {
  return `$."${String(key).replace(/"/g, '')}"`;
}
