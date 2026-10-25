-- 0004: cheaper writes. D1 bills one row written for the table and one for every index an INSERT, UPDATE or DELETE
-- touches, so the hot tables become WITHOUT ROWID tables keyed by exactly what they are looked up by, with no other
-- index. The daily cleanup still seeks instead of scanning: bucket keys start with their window's minute, so old
-- buckets are a key range, and lite_attempts is walked once per run with a cursor on dare_key (reads cost far less
-- than writes). daily_results / daily_stats are unchanged.

-- rate_buckets: short-lived counters (at most a day old), so it is rebuilt empty. Only used when the Workers Rate
-- Limiting bindings are absent (and for the per-day goal cap).
DROP TABLE IF EXISTS rate_buckets;
CREATE TABLE rate_buckets (
  bucket_key TEXT PRIMARY KEY,             -- window minute (base 36) + ':' + salted hash of (scope, network, window); never an address
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL
) WITHOUT ROWID;

-- lite_attempts: one row per (dare, device key). Times kept to the hour.
CREATE TABLE lite_attempts_v2 (
  dare_key TEXT NOT NULL,                  -- first 32 hex of sha256(dareIdentity)
  device_key TEXT NOT NULL,                -- 64 hex: sha256(installId:dareIdentity), computed on the device
  attempt_id TEXT NOT NULL,                -- 32 random hex chars chosen by the server (checked on grade)
  seed INTEGER NOT NULL,                   -- the dare itself: game moves only
  path TEXT NOT NULL,
  step TEXT NOT NULL,
  deadline INTEGER NOT NULL,
  nonce TEXT NOT NULL,
  answer_path TEXT NOT NULL,
  points INTEGER NOT NULL,
  best INTEGER NOT NULL,
  kind TEXT NOT NULL,
  twist_id TEXT NOT NULL,
  marker TEXT NOT NULL,                    -- v = dare replayed and twist graded | t = twist graded only
  twist_answer TEXT,
  outcome TEXT,                            -- NULL until graded; r | w | s
  sig TEXT,
  created_hour TEXT NOT NULL,              -- ISO hour (UTC), no minutes
  graded_hour TEXT,
  PRIMARY KEY (dare_key, device_key)
) WITHOUT ROWID;
INSERT INTO lite_attempts_v2 (dare_key, device_key, attempt_id, seed, path, step, deadline, nonce, answer_path, points, best, kind, twist_id, marker, twist_answer, outcome, sig, created_hour, graded_hour)
SELECT dare_key, device_key, attempt_id, seed, path, step, deadline, nonce, answer_path, points, best, kind, twist_id, marker, twist_answer, outcome, sig,
       strftime('%Y-%m-%dT%H:00:00.000Z', created_at / 1000, 'unixepoch'),
       CASE WHEN graded_at IS NULL THEN NULL ELSE strftime('%Y-%m-%dT%H:00:00.000Z', graded_at / 1000, 'unixepoch') END
FROM lite_attempts;
DROP TABLE lite_attempts;
ALTER TABLE lite_attempts_v2 RENAME TO lite_attempts;

-- lite_goal: one row of counts per UTC day.
CREATE TABLE lite_goal_v2 (
  day TEXT PRIMARY KEY,
  answers INTEGER NOT NULL DEFAULT 0,
  best INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
) WITHOUT ROWID;
INSERT INTO lite_goal_v2 (day, answers, best, updated_at) SELECT day, answers, best, updated_at FROM lite_goal;
DROP TABLE lite_goal;
ALTER TABLE lite_goal_v2 RENAME TO lite_goal;
