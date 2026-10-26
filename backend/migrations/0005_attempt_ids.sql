-- Account deletion reaches every Daily Six attempt object (docs/SECURITY.md, docs/PRIVACY_AND_CONSENT.md): the ids of
-- all attempts a player started on an IST day, not only the one in progress (current_id). A finished attempt's object
-- keeps its replay for 30 days, so daily_attempts rows are now kept 32 days (backend/src/ops/cron.ts) and deleting the
-- account forgets each of these objects.
ALTER TABLE daily_attempts ADD COLUMN ids TEXT NOT NULL DEFAULT '[]';
