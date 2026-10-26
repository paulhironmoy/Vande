-- Phase 3 social product: results, friends, cups, Daily Six, leaderboards, notification preferences, room settings.
-- Same rules as 0001: keyed by lookup, few indexes, no personal data beyond the internal account ids.

-- One row per revealed duel or cup match: what leaderboards, friends and (wave C) the Top 100 need. Late and auto
-- counts are integrity signals (answers that arrived late; sides played by Auto Over / Auto XI).
CREATE TABLE match_results (
  match_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,                     -- duel | cup
  cup_id TEXT,
  stage TEXT,                             -- group | final | NULL
  day TEXT NOT NULL,                      -- IST day of the reveal
  revealed_ms INTEGER NOT NULL,
  uid0 TEXT NOT NULL,
  uid1 TEXT NOT NULL,
  runs0 INTEGER NOT NULL,
  wickets0 INTEGER NOT NULL,
  runs1 INTEGER NOT NULL,
  wickets1 INTEGER NOT NULL,
  winner INTEGER,                         -- 0 | 1 | NULL (tie)
  late0 INTEGER NOT NULL,
  late1 INTEGER NOT NULL,
  auto0 INTEGER NOT NULL,                 -- 1 when that side's over was an Auto Over or its innings had Auto XI balls
  auto1 INTEGER NOT NULL,
  suspect0 INTEGER NOT NULL DEFAULT 0,    -- 1 when the engine's timing audit flagged machine-perfect tapping
  suspect1 INTEGER NOT NULL DEFAULT 0,
  rated INTEGER NOT NULL DEFAULT 0,       -- 1 when the ratings moved (real duel or cup match, no Auto side)
  r0 REAL,                                -- ratings before the match
  r1 REAL,
  d0 REAL NOT NULL DEFAULT 0,             -- rating changes, applied once by the trigger in 0003
  d1 REAL NOT NULL DEFAULT 0,
  te0 REAL,                               -- engine.matchPerformance per player: tactical efficiency, clutch, execution
  cl0 REAL,
  ex0 REAL,
  te1 REAL,
  cl1 REAL,
  ex1 REAL,
  attribution TEXT                        -- highlight code of a duel started from a highlight landing
) WITHOUT ROWID;
CREATE INDEX idx_match_results_day ON match_results (day);

-- Players who finished a duel or cup match together (both directions), for the friends leaderboard.
CREATE TABLE friends (
  uid TEXT NOT NULL,
  friend_uid TEXT NOT NULL,
  since_day TEXT NOT NULL,
  PRIMARY KEY (uid, friend_uid)
) WITHOUT ROWID;

-- Cups a player joined (account deletion and lists).
CREATE TABLE cup_players (
  uid TEXT NOT NULL,
  cup_id TEXT NOT NULL,
  joined_hour TEXT NOT NULL,
  PRIMARY KEY (uid, cup_id)
) WITHOUT ROWID;

-- Daily Six: attempts used per IST day and the attempt in progress.
CREATE TABLE daily_attempts (
  day TEXT NOT NULL,
  uid TEXT NOT NULL,
  started INTEGER NOT NULL,
  finished INTEGER NOT NULL DEFAULT 0,
  current_id TEXT,                        -- the attempt (match object id) in progress, if any
  PRIMARY KEY (day, uid)
) WITHOUT ROWID;

-- Best score per player per IST day (best of three), with a snapshot of what a leaderboard row shows.
CREATE TABLE daily_scores (
  day TEXT NOT NULL,
  uid TEXT NOT NULL,
  best_score INTEGER NOT NULL,
  city TEXT,
  player_id TEXT NOT NULL,
  alias TEXT NOT NULL,
  avatar_seed TEXT NOT NULL,
  updated_ms INTEGER NOT NULL,
  late INTEGER NOT NULL DEFAULT 0,        -- integrity signals of the best attempt (late answers, timing audit flag)
  suspect INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, uid)
) WITHOUT ROWID;
CREATE INDEX idx_daily_scores_rank ON daily_scores (day, best_score DESC, updated_ms);
CREATE INDEX idx_daily_scores_city ON daily_scores (day, city, best_score DESC, updated_ms);

-- Score histogram per day and scope ('national', 'city:<id>'), kept exact by triggers in the same statement as the
-- score change, so a player's rank and the real number of ranked players cost a few hundred rows read, not a scan.
CREATE TABLE daily_score_counts (
  day TEXT NOT NULL,
  scope TEXT NOT NULL,
  score INTEGER NOT NULL,
  n INTEGER NOT NULL,
  PRIMARY KEY (day, scope, score)
) WITHOUT ROWID;

CREATE TRIGGER daily_scores_after_insert AFTER INSERT ON daily_scores BEGIN
  INSERT INTO daily_score_counts (day, scope, score, n) VALUES (NEW.day, 'national', NEW.best_score, 1)
    ON CONFLICT(day, scope, score) DO UPDATE SET n = n + 1;
  INSERT INTO daily_score_counts (day, scope, score, n) SELECT NEW.day, 'city:' || NEW.city, NEW.best_score, 1 WHERE NEW.city IS NOT NULL
    ON CONFLICT(day, scope, score) DO UPDATE SET n = n + 1;
END;

CREATE TRIGGER daily_scores_after_update AFTER UPDATE OF best_score ON daily_scores WHEN NEW.best_score <> OLD.best_score BEGIN
  UPDATE daily_score_counts SET n = n - 1 WHERE day = OLD.day AND scope = 'national' AND score = OLD.best_score;
  INSERT INTO daily_score_counts (day, scope, score, n) VALUES (NEW.day, 'national', NEW.best_score, 1)
    ON CONFLICT(day, scope, score) DO UPDATE SET n = n + 1;
  UPDATE daily_score_counts SET n = n - 1 WHERE OLD.city IS NOT NULL AND day = OLD.day AND scope = 'city:' || OLD.city AND score = OLD.best_score;
  INSERT INTO daily_score_counts (day, scope, score, n) SELECT NEW.day, 'city:' || NEW.city, NEW.best_score, 1 WHERE NEW.city IS NOT NULL
    ON CONFLICT(day, scope, score) DO UPDATE SET n = n + 1;
END;

-- Only recent days keep their histogram in step on delete (account deletion); retention pruning of old days skips it.
CREATE TRIGGER daily_scores_after_delete AFTER DELETE ON daily_scores WHEN OLD.day >= date('now', '-3 days') BEGIN
  UPDATE daily_score_counts SET n = n - 1 WHERE day = OLD.day AND scope = 'national' AND score = OLD.best_score;
  UPDATE daily_score_counts SET n = n - 1 WHERE OLD.city IS NOT NULL AND day = OLD.day AND scope = 'city:' || OLD.city AND score = OLD.best_score;
END;

-- Daily streaks: consecutive IST days with a finished attempt.
CREATE TABLE daily_players (
  uid TEXT PRIMARY KEY,
  streak INTEGER NOT NULL,
  best_streak INTEGER NOT NULL,
  last_day TEXT NOT NULL
) WITHOUT ROWID;

-- Notification preferences (a row only once the player changed something). Quiet hours in minutes after IST midnight.
CREATE TABLE notify_prefs (
  uid TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 1,
  quiet_start INTEGER,
  quiet_end INTEGER,
  updated_ms INTEGER NOT NULL
) WITHOUT ROWID;

-- Per-room mute / notify settings (rows only for non-default settings), read by the notification consumer.
CREATE TABLE room_settings (
  uid TEXT NOT NULL,
  room_id TEXT NOT NULL,
  muted INTEGER NOT NULL DEFAULT 0,
  notify TEXT NOT NULL DEFAULT 'all',
  PRIMARY KEY (uid, room_id)
) WITHOUT ROWID;
