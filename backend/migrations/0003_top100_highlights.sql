-- VANDE Cricket, wave C: ratings after every reveal, the Daily Top 100, official highlight jobs (consent, moderation,
-- rendering, YouTube), attribution counters and YouTube quota. Nothing here stores a real name, an address or a
-- device id; aliases are player-chosen nicknames. Row counts and costs: docs/COST_MODEL.md.

-- Frozen Daily Top 100 days (written once by the 00:00 IST cutoff; a row means the day is final).
CREATE TABLE top100_days (
  day TEXT PRIMARY KEY,
  frozen_ms INTEGER NOT NULL,
  ranked INTEGER NOT NULL,                -- entries written (≤ 100; never padded)
  players INTEGER NOT NULL,               -- players with at least one finished duel or cup match that day
  notified INTEGER NOT NULL DEFAULT 0     -- the ranked players were told (retried by the sweeper until done)
) WITHOUT ROWID;

CREATE TABLE top100_entries (
  day TEXT NOT NULL,
  rank INTEGER NOT NULL,
  uid TEXT NOT NULL,                      -- internal account id ("x:…" after deletion)
  player_id TEXT NOT NULL,
  alias TEXT NOT NULL,
  score REAL NOT NULL,
  match_ids TEXT NOT NULL,                -- JSON array: the counted matches, best first
  best_match_id TEXT NOT NULL,
  components TEXT NOT NULL,               -- JSON Top100Components
  PRIMARY KEY (day, rank)
) WITHOUT ROWID;
CREATE INDEX idx_top100_uid ON top100_entries (uid, day);

-- One official highlight per match (deduplicated when both players qualify). Statuses: HighlightStatus.
CREATE TABLE highlight_jobs (
  job_id TEXT PRIMARY KEY,
  day TEXT NOT NULL,
  match_id TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,                     -- duel | cup
  cup_id TEXT,
  room_id TEXT,
  uid0 TEXT NOT NULL,                     -- participants in replay order (players[0], players[1])
  uid1 TEXT NOT NULL,
  pid0 TEXT NOT NULL,
  pid1 TEXT NOT NULL,
  alias0 TEXT NOT NULL,                   -- aliases and avatar seeds as shown in the cut (what participants approve)
  alias1 TEXT NOT NULL,
  avatar0 TEXT NOT NULL,
  avatar1 TEXT NOT NULL,
  pair TEXT NOT NULL,                     -- sorted "uidA|uidB": the same-pair duplicate check
  rank0 INTEGER,                          -- Top 100 rank of each participant that day (NULL: did not qualify)
  rank1 INTEGER,
  status TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  fixture_label TEXT NOT NULL,
  locale TEXT NOT NULL,
  visibility TEXT NOT NULL,               -- the strictest choice of the participants (unlisted beats public)
  code TEXT NOT NULL UNIQUE,              -- attribution code: https://<web>/h/<code>
  consent_by_ms INTEGER NOT NULL,         -- no answer by then counts as declined
  video_key TEXT,                         -- temporary MP4 in R2
  video_sha256 TEXT,
  video_bytes INTEGER,
  video_ms INTEGER,
  youtube_video_id TEXT,
  upload_session TEXT,                    -- encrypted resumable-upload session URI
  quota_day TEXT,                         -- Pacific day whose YouTube quota this upload reserved
  scheduled_ms INTEGER,                   -- upload not before (overflow to the next quota day)
  retry_ms INTEGER,                       -- render retry not before
  lease_ms INTEGER,                       -- render lease expiry
  attempts INTEGER NOT NULL DEFAULT 0,    -- render attempts
  upload_attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  withdraw_pending INTEGER NOT NULL DEFAULT 0,
  published_ms INTEGER,
  views INTEGER NOT NULL DEFAULT 0,
  views_ms INTEGER,
  created_ms INTEGER NOT NULL,
  updated_ms INTEGER NOT NULL
) WITHOUT ROWID;
CREATE INDEX idx_jobs_status ON highlight_jobs (status, updated_ms);
CREATE INDEX idx_jobs_day ON highlight_jobs (day, status);
CREATE INDEX idx_jobs_uid0 ON highlight_jobs (uid0, day);
CREATE INDEX idx_jobs_uid1 ON highlight_jobs (uid1, day);
CREATE INDEX idx_jobs_pair ON highlight_jobs (pair, day);

-- Consent audit trail (append-only; the latest record per participant is their decision).
CREATE TABLE highlight_consents (
  job_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  uid TEXT NOT NULL,
  player_id TEXT NOT NULL,
  decision TEXT NOT NULL,                 -- granted | declined | withdrawn
  adult INTEGER NOT NULL,
  approved_title TEXT NOT NULL,
  approved_visibility TEXT NOT NULL,
  reason TEXT,                            -- e.g. "timeout", "account_deleted"
  decided_ms INTEGER NOT NULL,
  PRIMARY KEY (job_id, seq)
) WITHOUT ROWID;

-- Moderation results (automatic checks, then the admin decision).
CREATE TABLE highlight_moderation (
  job_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  alias_check TEXT NOT NULL,
  anti_cheat TEXT NOT NULL,
  duplicate TEXT NOT NULL,
  reviewer TEXT NOT NULL,                 -- auto | admin
  admin TEXT,                             -- the reviewing admin's Access identity (staff), NULL for auto
  decision TEXT NOT NULL,                 -- pass | fail | approve | reject
  notes TEXT NOT NULL,
  decided_ms INTEGER NOT NULL,
  PRIMARY KEY (job_id, seq)
) WITHOUT ROWID;

-- Attribution counters per highlight code per IST day (no person, device or address).
CREATE TABLE attribution_daily (
  code TEXT NOT NULL,
  day TEXT NOT NULL,
  event TEXT NOT NULL,                    -- landing_open | share | install | invite_open | match_completed | views
  n INTEGER NOT NULL,
  PRIMARY KEY (code, day, event)
) WITHOUT ROWID;

-- YouTube Data API units reserved per quota day (the quota resets at midnight Pacific time).
CREATE TABLE yt_quota (
  qday TEXT PRIMARY KEY,
  used INTEGER NOT NULL,                  -- every call (uploads, removals, privacy changes, statistics)
  uploads INTEGER NOT NULL DEFAULT 0      -- the part uploads used (limited to the quota minus the headroom)
) WITHOUT ROWID;

-- Nonces of signed internal requests (render service), refused when seen again; pruned after a day.
CREATE TABLE internal_nonces (
  nonce TEXT PRIMARY KEY,
  ms INTEGER NOT NULL
) WITHOUT ROWID;

-- Ratings move exactly once per revealed match: the MatchDO inserts the result row (ON CONFLICT DO NOTHING) with the
-- rating changes it computed from src/engine/ranking.ts, and this trigger applies them only when the row is new.
CREATE TRIGGER match_results_ratings AFTER INSERT ON match_results WHEN NEW.rated = 1
BEGIN
  UPDATE accounts SET
    rating = ROUND(MAX(100, rating + NEW.d0), 1),
    rated_matches = rated_matches + 1,
    effort = CASE WHEN NEW.te0 IS NULL THEN effort WHEN effort IS NULL THEN NEW.te0 ELSE ROUND(effort * 0.9 + NEW.te0 * 0.1, 4) END
  WHERE uid = NEW.uid0 AND status = 'active';
  UPDATE accounts SET
    rating = ROUND(MAX(100, rating + NEW.d1), 1),
    rated_matches = rated_matches + 1,
    effort = CASE WHEN NEW.te1 IS NULL THEN effort WHEN effort IS NULL THEN NEW.te1 ELSE ROUND(effort * 0.9 + NEW.te1 * 0.1, 4) END
  WHERE uid = NEW.uid1 AND status = 'active';
END;

-- A duel started from a highlight landing credits that highlight once, when it completes.
CREATE TRIGGER match_results_attribution AFTER INSERT ON match_results WHEN NEW.attribution IS NOT NULL
BEGIN
  INSERT INTO attribution_daily (code, day, event, n) VALUES (NEW.attribution, NEW.day, 'match_completed', 1)
    ON CONFLICT (code, day, event) DO UPDATE SET n = n + 1;
END;
