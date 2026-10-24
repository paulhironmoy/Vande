-- Incremental per-day aggregates (one row per day and content version), maintained by the worker on every accepted
-- result so that stats reads cost a single-row lookup instead of a scan. Nothing here identifies a person.
CREATE TABLE IF NOT EXISTS daily_stats (
  daily_id TEXT NOT NULL,                  -- YYYY-MM-DD (UTC)
  content_version TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  score_sum INTEGER NOT NULL DEFAULT 0,
  bands_json TEXT NOT NULL DEFAULT '{}',   -- {"0-39": n, ...}
  outcomes_json TEXT NOT NULL DEFAULT '{}',
  strategies_json TEXT NOT NULL DEFAULT '{}',
  scores_json TEXT NOT NULL DEFAULT '{}',  -- score histogram {"63": n, ...} for the exact median
  updated_at TEXT NOT NULL,                -- ISO hour (UTC)
  PRIMARY KEY (daily_id, content_version)
);

-- Backfill from rows that already exist, so the worker never needs the slow fallback for old days.
INSERT OR IGNORE INTO daily_stats (daily_id, content_version, count, score_sum, bands_json, outcomes_json, strategies_json, scores_json, updated_at)
SELECT d.daily_id,
       d.content_version,
       COUNT(*),
       SUM(d.score),
       (SELECT json_group_object(band, n) FROM (SELECT band, COUNT(*) AS n FROM daily_results r WHERE r.daily_id = d.daily_id AND r.content_version = d.content_version GROUP BY band)),
       (SELECT json_group_object(outcome, n) FROM (SELECT outcome, COUNT(*) AS n FROM daily_results r WHERE r.daily_id = d.daily_id AND r.content_version = d.content_version GROUP BY outcome)),
       (SELECT json_group_object(strategy, n) FROM (SELECT strategy, COUNT(*) AS n FROM daily_results r WHERE r.daily_id = d.daily_id AND r.content_version = d.content_version GROUP BY strategy)),
       (SELECT json_group_object(CAST(score AS TEXT), n) FROM (SELECT score, COUNT(*) AS n FROM daily_results r WHERE r.daily_id = d.daily_id AND r.content_version = d.content_version GROUP BY score)),
       MAX(d.received_hour)
FROM daily_results d
GROUP BY d.daily_id, d.content_version;
