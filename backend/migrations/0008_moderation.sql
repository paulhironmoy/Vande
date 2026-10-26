-- 0008: the report queue (admin console, backend/src/admin/reports.ts) and suspensions from social features.
--
-- reports.player_id: the reported player (for a reported post: its author), when the app knew it; resolved_hour and
-- resolution record how a moderator closed the report (dismissed, renamed, suspended, post_removed, unsuspended).
-- Every moderator action is also written to audit_log with the moderator's Access identity. The reporter stays an
-- opaque reference (reporter_ref) that nobody, moderators included, can turn back into a player.
ALTER TABLE reports ADD COLUMN player_id TEXT;
ALTER TABLE reports ADD COLUMN resolved_hour TEXT;
ALTER TABLE reports ADD COLUMN resolution TEXT;
CREATE INDEX idx_reports_status ON reports (status, id);
CREATE INDEX idx_reports_player ON reports (player_id);

-- accounts.social_suspended_until (ms): until then the account cannot post in Cricket Rooms, create or join cups and
-- groups, or change its name. Matches and Daily Six still work. NULL when not suspended.
ALTER TABLE accounts ADD COLUMN social_suspended_until INTEGER;
