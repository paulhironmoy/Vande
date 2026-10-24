-- VANDE community API — initial schema. Nothing here identifies a person.
CREATE TABLE IF NOT EXISTS daily_results (
  submission_id TEXT PRIMARY KEY,          -- first 32 hex of sha256(installId:dailyId), computed on the device
  daily_id TEXT NOT NULL,                  -- YYYY-MM-DD (UTC)
  content_version TEXT NOT NULL,
  app_version TEXT NOT NULL,
  mode TEXT NOT NULL,                      -- simple | full
  score INTEGER NOT NULL,                  -- 0..100
  band TEXT NOT NULL,                      -- 0-39 | 40-54 | 55-69 | 70-84 | 85-100
  outcome TEXT NOT NULL,
  fingerprint TEXT NOT NULL,               -- [DESPXW]{1,12}
  strategy TEXT NOT NULL,                  -- restraint | mixed | force | passive
  received_hour TEXT NOT NULL              -- ISO hour (UTC), no minutes
);
CREATE INDEX IF NOT EXISTS idx_daily_results_day ON daily_results (daily_id, content_version);
CREATE INDEX IF NOT EXISTS idx_daily_results_received ON daily_results (received_hour);

CREATE TABLE IF NOT EXISTS rate_buckets (
  bucket_key TEXT PRIMARY KEY,             -- salted hash of (address, minute window); never the address itself
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rate_buckets_window ON rate_buckets (window_start);
