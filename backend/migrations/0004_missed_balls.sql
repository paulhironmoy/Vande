-- Integrity count, part two: balls the batter was shown but that were settled as leaves without a valid answer in time
-- (the answer window expired, too many invalid answers, or the ball was still waiting at the batting deadline). An
-- unanswered ball is a safe dot, so closing the app on a dangerous delivery must not be free: together with the late
-- answers these make the per-innings count behind the Top 100 rule and the Daily Six boards (at most one per innings).
-- Daily Six attempts over that limit are never written to daily_scores, so the column there records the best counted
-- attempt.
ALTER TABLE match_results ADD COLUMN missed0 INTEGER NOT NULL DEFAULT 0;
ALTER TABLE match_results ADD COLUMN missed1 INTEGER NOT NULL DEFAULT 0;
ALTER TABLE daily_scores ADD COLUMN missed INTEGER NOT NULL DEFAULT 0;
