/** Every D1 statement the Worker runs, as named constants (the cost test measures each one on real SQLite). */
export const SQL = {
  // ---- accounts
  insertAccount:
    'INSERT INTO accounts (uid, player_id, status, alias, avatar_seed, kit_json, locale, city, adult_confirmed, unlocks_json, badges_json, rating, created_day, updated_ms) ' +
    // adult_confirmed = 1: a guest account exists only after the age screen's confirmation (auth/routes.ts guestSignup).
    "VALUES (?1, ?2, 'active', ?3, ?4, ?5, ?6, NULL, 1, '[]', '[]', 1200, ?7, ?8)",
  accountByUid:
    'SELECT uid, player_id, status, alias, avatar_seed, kit_json, locale, city, adult_confirmed, unlocks_json, badges_json, rating, created_day, social_suspended_until FROM accounts WHERE uid = ?1',
  updateProfile:
    'UPDATE accounts SET alias = ?2, avatar_seed = ?3, kit_json = ?4, locale = ?5, city = ?6, adult_confirmed = ?7, updated_ms = ?8 WHERE uid = ?1 AND status = \'active\'',
  scrubAccount:
    "UPDATE accounts SET status = 'deleted', alias = '', avatar_seed = '', kit_json = '{}', city = NULL, adult_confirmed = 0, unlocks_json = '[]', badges_json = '[]', updated_ms = ?2, deleted_ms = ?2 WHERE uid = ?1",
  pruneDeletedAccounts:
    "DELETE FROM accounts WHERE uid IN (SELECT uid FROM accounts WHERE status = 'deleted' AND deleted_ms < ?1 LIMIT ?2)",

  // ---- sessions (refresh families)
  insertSession:
    'INSERT INTO sessions (family_id, uid, cur_hash, prev_hash, generation, rotated_ms, expires_ms, revoked, created_hour) VALUES (?1, ?2, ?3, NULL, 0, ?4, ?5, 0, ?6)',
  sessionById: 'SELECT family_id, uid, cur_hash, prev_hash, generation, rotated_ms, expires_ms, revoked FROM sessions WHERE family_id = ?1',
  /** Rotation: compare-and-swap on the generation so two concurrent refreshes cannot both win. */
  rotateSession:
    'UPDATE sessions SET prev_hash = cur_hash, cur_hash = ?2, generation = generation + 1, rotated_ms = ?3, expires_ms = ?4 WHERE family_id = ?1 AND generation = ?5 AND revoked = 0',
  revokeSession: 'UPDATE sessions SET revoked = 1 WHERE family_id = ?1',
  revokeSessionsOfUid: 'UPDATE sessions SET revoked = 1 WHERE uid = ?1',
  /** Sign-out on this device: the family of the access token, only if it belongs to the caller. */
  revokeFamilyOfUid: 'UPDATE sessions SET revoked = 1, rotated_ms = ?3 WHERE family_id = ?1 AND uid = ?2 AND revoked = 0',
  /** "Sign out other devices" and recovery on a new device: every other live family of the account. */
  revokeOtherSessions: 'UPDATE sessions SET revoked = 1, rotated_ms = ?3 WHERE uid = ?1 AND family_id != ?2 AND revoked = 0',
  /** Sensitive routes check that the access token's family is still live (others rely on the 15-minute expiry). */
  sessionState: 'SELECT uid, revoked, expires_ms FROM sessions WHERE family_id = ?1',
  deleteSessionsOfUid: 'DELETE FROM sessions WHERE uid = ?1',
  pruneSessions: 'DELETE FROM sessions WHERE family_id IN (SELECT family_id FROM sessions WHERE expires_ms < ?1 LIMIT ?2)',
  /** Revoked families serve no purpose once their access tokens have expired (?1 = now − 1 day). */
  pruneRevokedSessions: 'DELETE FROM sessions WHERE family_id IN (SELECT family_id FROM sessions WHERE revoked = 1 AND rotated_ms < ?1 LIMIT ?2)',

  // ---- identities
  identityBySubject: 'SELECT uid FROM identities WHERE provider = ?1 AND subject_hash = ?2',
  insertIdentity: 'INSERT INTO identities (provider, subject_hash, uid, created_hour) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(provider, subject_hash) DO NOTHING',
  identitiesOfUid: 'SELECT provider FROM identities WHERE uid = ?1',
  deleteIdentitiesOfUid: 'DELETE FROM identities WHERE uid = ?1',

  // ---- groups
  insertGroup: 'INSERT INTO groups (group_id, kind, name, code, created_by, member_count, created_hour) VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6)',
  groupByCode: 'SELECT group_id, kind, name FROM groups WHERE code = ?1',
  insertMember: 'INSERT INTO group_members (uid, group_id, joined_hour) VALUES (?1, ?2, ?3) ON CONFLICT(uid, group_id) DO NOTHING',
  bumpMembers: 'UPDATE groups SET member_count = member_count + ?2 WHERE group_id = ?1',
  membershipsOfUid:
    'SELECT g.group_id AS group_id, g.kind AS kind, g.name AS name FROM group_members m JOIN groups g ON g.group_id = m.group_id WHERE m.uid = ?1 ORDER BY m.joined_hour',
  countMemberships: 'SELECT count(*) AS n FROM group_members WHERE uid = ?1',
  deleteMembershipsOfUid: 'DELETE FROM group_members WHERE uid = ?1',
  decrementGroupsOfUid: 'UPDATE groups SET member_count = member_count - 1 WHERE group_id IN (SELECT group_id FROM group_members WHERE uid = ?1)',

  // ---- match index
  /** Params: 1 uid, 2 match_id, 3 kind, 4 phase, 5 rev, 6 updated_ms, 7 view_json. Only a newer rev overwrites. */
  upsertMatchPlayer:
    'INSERT INTO match_players (uid, match_id, kind, phase, rev, updated_ms, view_json) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) ' +
    'ON CONFLICT(uid, match_id) DO UPDATE SET phase = excluded.phase, rev = excluded.rev, updated_ms = excluded.updated_ms, view_json = excluded.view_json WHERE excluded.rev > match_players.rev',
  matchesOfUid: 'SELECT view_json FROM match_players WHERE uid = ?1 ORDER BY updated_ms DESC LIMIT ?2',
  matchIdsOfUid: 'SELECT match_id FROM match_players WHERE uid = ?1',
  deleteMatchPlayer: 'DELETE FROM match_players WHERE uid = ?1 AND match_id = ?2',
  deleteMatchesOfUid: 'DELETE FROM match_players WHERE uid = ?1',
  pruneMatchPlayers:
    'DELETE FROM match_players WHERE (uid, match_id) IN (SELECT uid, match_id FROM match_players WHERE updated_ms < ?1 LIMIT ?2)',

  // ---- idempotency
  /** Params: 1 scope, 2 key, 3 route, 4 req_hash, 5 created_ms, 6 expires_ms. */
  claimIdempotency:
    "INSERT INTO idempotency (scope, idem_key, route, req_hash, state, status, body_enc, created_ms, expires_ms) VALUES (?1, ?2, ?3, ?4, 'pending', NULL, NULL, ?5, ?6) ON CONFLICT(scope, idem_key) DO NOTHING",
  idempotencyRow: 'SELECT route, req_hash, state, status, body_enc, created_ms FROM idempotency WHERE scope = ?1 AND idem_key = ?2',
  /** Takes over an abandoned pending record (created before ?3). */
  reclaimIdempotency: "UPDATE idempotency SET created_ms = ?4 WHERE scope = ?1 AND idem_key = ?2 AND state = 'pending' AND created_ms < ?3",
  completeIdempotency: "UPDATE idempotency SET state = 'done', status = ?3, body_enc = ?4 WHERE scope = ?1 AND idem_key = ?2",
  releaseIdempotency: "DELETE FROM idempotency WHERE scope = ?1 AND idem_key = ?2 AND state = 'pending'",
  deleteIdempotencyOfScope: 'DELETE FROM idempotency WHERE scope = ?1',
  pruneIdempotency: 'DELETE FROM idempotency WHERE (scope, idem_key) IN (SELECT scope, idem_key FROM idempotency WHERE expires_ms < ?1 LIMIT ?2)',

  // ---- audit
  pruneAudit: 'DELETE FROM audit_log WHERE id IN (SELECT id FROM audit_log WHERE at_ms < ?1 ORDER BY id LIMIT ?2)',

  // ---- rate buckets (salvaged)
  bumpBucket: 'INSERT INTO rate_buckets (bucket_key, window_start, count) VALUES (?1, ?2, 1) ON CONFLICT(bucket_key) DO UPDATE SET count = count + 1 RETURNING count',
  pruneBuckets: 'DELETE FROM rate_buckets WHERE bucket_key IN (SELECT bucket_key FROM rate_buckets WHERE bucket_key < ?1 LIMIT ?2)',

  // ---- push tokens
  upsertPushToken:
    'INSERT INTO push_tokens (uid, token_hash, token_enc, platform, updated_day) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(uid, token_hash) DO UPDATE SET token_enc = excluded.token_enc, platform = excluded.platform, updated_day = excluded.updated_day',
  pushTokensOfUid: 'SELECT token_hash, token_enc, platform, updated_day FROM push_tokens WHERE uid = ?1 ORDER BY updated_day DESC',
  deletePushToken: 'DELETE FROM push_tokens WHERE uid = ?1 AND token_hash = ?2',
  deletePushTokensOfUid: 'DELETE FROM push_tokens WHERE uid = ?1',

  // ---- exports
  insertExport: 'INSERT INTO exports (export_id, uid, object_key, expires_ms) VALUES (?1, ?2, ?3, ?4)',
  exportById: 'SELECT export_id, uid, object_key, expires_ms FROM exports WHERE export_id = ?1',
  exportsOfUid: 'SELECT export_id, object_key FROM exports WHERE uid = ?1',
  deleteExportsOfUid: 'DELETE FROM exports WHERE uid = ?1',
  expiredExports: 'SELECT export_id, object_key FROM exports WHERE expires_ms < ?1 ORDER BY export_id LIMIT ?2',
  deleteExpiredExports: 'DELETE FROM exports WHERE export_id IN (SELECT export_id FROM exports WHERE expires_ms < ?1 ORDER BY export_id LIMIT ?2)',

  // ---- blocks and reports
  insertBlock: 'INSERT INTO blocks (uid, blocked_player_id, created_hour) VALUES (?1, ?2, ?3) ON CONFLICT(uid, blocked_player_id) DO NOTHING',
  deleteBlocksOfUid: 'DELETE FROM blocks WHERE uid = ?1',
  insertReport: 'INSERT INTO reports (reporter_ref, target_kind, target_id, reason, created_hour, player_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6)',
  /** The report queue (0008; admin/reports.ts): newest first, by status and kind. */
  reportsByStatus:
    'SELECT id, target_kind, target_id, player_id, reason, status, created_hour, resolved_hour, resolution FROM reports WHERE status = ?1 AND (?2 IS NULL OR target_kind = ?2) ORDER BY id DESC LIMIT ?3',
  reportsClosed:
    "SELECT id, target_kind, target_id, player_id, reason, status, created_hour, resolved_hour, resolution FROM reports WHERE status != 'open' AND (?1 IS NULL OR target_kind = ?1) ORDER BY id DESC LIMIT ?2",
  reportById: 'SELECT id, target_kind, target_id, player_id, reason, status, created_hour, resolved_hour, resolution FROM reports WHERE id = ?1',
  reportCounts: 'SELECT status, count(*) AS n FROM reports GROUP BY status',
  openReportsOfPlayer: "SELECT count(*) AS n FROM reports WHERE player_id = ?1 AND status = 'open'",
  resolveReport: 'UPDATE reports SET status = ?2, resolution = ?3, resolved_hour = ?4, player_id = COALESCE(player_id, ?5) WHERE id = ?1',
  reportHistory: "SELECT at_ms, detail FROM audit_log WHERE action = 'admin_report' AND target = ?1 ORDER BY id",
  accountByPlayerId: 'SELECT uid, player_id, status, alias, social_suspended_until FROM accounts WHERE player_id = ?1',
  /** Suspension from social features (0008): rooms, cups, groups and name changes; matches keep working. */
  /** Unlocks earned in an official match (src/engine/advice.ts): a set union, so merging twice changes nothing. */
  unlocksOfUid: 'SELECT unlocks_json FROM accounts WHERE uid = ?1',
  mergeUnlocks:
    'UPDATE accounts SET unlocks_json = (SELECT json_group_array(value) FROM (SELECT value FROM json_each(CASE WHEN json_valid(accounts.unlocks_json) THEN accounts.unlocks_json ELSE \'[]\' END) ' +
    "UNION SELECT value FROM json_each(?2) ORDER BY 1)), updated_ms = ?3 WHERE uid = ?1 AND status = 'active'",
  setSocialSuspension: "UPDATE accounts SET social_suspended_until = ?2, updated_ms = ?3 WHERE uid = ?1 AND status = 'active'",
  /** A moderator's rename: the account, its frozen Top 100 rows and its highlight jobs' seats. */
  renameAccount: "UPDATE accounts SET alias = ?2, updated_ms = ?3 WHERE uid = ?1 AND status = 'active'",
  renameTop100Entries: 'UPDATE top100_entries SET alias = ?2 WHERE uid = ?1',
  renameJobSeat0: 'UPDATE highlight_jobs SET alias0 = ?2 WHERE uid0 = ?1',
  renameJobSeat1: 'UPDATE highlight_jobs SET alias1 = ?2 WHERE uid1 = ?1',

  // ---- match results and friends (0002)
  /** A seat whose account is no longer active (deleted meanwhile) is stored as 'x:deleted', never as its old id. */
  insertMatchResult:
    'INSERT INTO match_results (match_id, kind, cup_id, stage, day, revealed_ms, uid0, uid1, runs0, wickets0, runs1, wickets1, winner, late0, late1, auto0, auto1, suspect0, suspect1, ' +
    'rated, r0, r1, d0, d1, te0, cl0, ex0, te1, cl1, ex1, attribution, missed0, missed1) ' +
    "SELECT ?1, ?2, ?3, ?4, ?5, ?6, CASE WHEN EXISTS (SELECT 1 FROM accounts WHERE uid = ?7 AND status = 'active') THEN ?7 ELSE 'x:deleted' END, " +
    "CASE WHEN EXISTS (SELECT 1 FROM accounts WHERE uid = ?8 AND status = 'active') THEN ?8 ELSE 'x:deleted' END, " +
    '?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?27, ?28, ?29, ?30, ?31, ?32, ?33 WHERE true ON CONFLICT(match_id) DO NOTHING',
  /** Both players' current ratings (the MatchDO computes the change; a trigger applies it once). */
  ratingsOf: "SELECT uid, rating, rated_matches FROM accounts WHERE uid IN (?1, ?2) AND status = 'active'",
  /** Only between two active accounts (an account deleted while the match was running gains no friends). */
  insertFriend:
    'INSERT INTO friends (uid, friend_uid, since_day) SELECT ?1, ?2, ?3 ' +
    "WHERE EXISTS (SELECT 1 FROM accounts WHERE uid = ?1 AND status = 'active') AND EXISTS (SELECT 1 FROM accounts WHERE uid = ?2 AND status = 'active') " +
    'ON CONFLICT(uid, friend_uid) DO NOTHING',
  friendsOfUid: 'SELECT friend_uid FROM friends WHERE uid = ?1',
  deleteFriendsOfUid: 'DELETE FROM friends WHERE uid = ?1',
  deleteFriendPair: 'DELETE FROM friends WHERE uid = ?1 AND friend_uid = ?2',
  scrubResultsSeat0: 'UPDATE match_results SET uid0 = ?2 WHERE uid0 = ?1',
  /** Shared match links (0006): the player's revealed match, its seats, and the public row with current aliases. */
  sharedMatchOfUid: 'SELECT phase FROM match_players WHERE uid = ?1 AND match_id = ?2',
  resultSeats: 'SELECT kind, uid0, uid1 FROM match_results WHERE match_id = ?1',
  insertSharedMatch: 'INSERT INTO shared_matches (code, match_id, kind, uid0, uid1, created_ms) VALUES (?1, ?2, ?3, ?4, ?5, ?6) ON CONFLICT DO NOTHING',
  sharedMatchByCode:
    'SELECT s.match_id, s.kind, s.uid0, s.uid1, a0.alias AS alias0, a0.status AS status0, a1.alias AS alias1, a1.status AS status1 ' +
    'FROM shared_matches s LEFT JOIN accounts a0 ON a0.uid = s.uid0 LEFT JOIN accounts a1 ON a1.uid = s.uid1 WHERE s.code = ?1',
  scrubSharedSeat0: 'UPDATE shared_matches SET uid0 = ?2 WHERE uid0 = ?1',
  scrubSharedSeat1: 'UPDATE shared_matches SET uid1 = ?2 WHERE uid1 = ?1',
  /** Short invite codes (0007): the signed token and expiry behind each https://<web>/i/<code>. */
  insertInviteCode: 'INSERT INTO invite_codes (code, token, exp_ms, created_ms) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(code) DO NOTHING',
  inviteCodeToken: 'SELECT token, exp_ms FROM invite_codes WHERE code = ?1',
  pruneInviteCodes: 'DELETE FROM invite_codes WHERE code IN (SELECT code FROM invite_codes WHERE exp_ms < ?1 LIMIT ?2)',
  /** The share cap (0007): the first time each player opened each moment of a match or cup. */
  claimShareMoment: 'INSERT INTO share_moments (uid, target_id, moment, first_ms) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(uid, target_id, moment) DO NOTHING',
  shareMomentFirst: 'SELECT first_ms FROM share_moments WHERE uid = ?1 AND target_id = ?2 AND moment = ?3',
  deleteShareMomentsOfUid: 'DELETE FROM share_moments WHERE uid = ?1',
  exportShareMoments: 'SELECT target_id, moment, first_ms FROM share_moments WHERE uid = ?1 ORDER BY first_ms',
  pruneShareMoments: 'DELETE FROM share_moments WHERE (uid, target_id, moment) IN (SELECT uid, target_id, moment FROM share_moments WHERE first_ms < ?1 LIMIT ?2)',
  scrubResultsSeat1: 'UPDATE match_results SET uid1 = ?2 WHERE uid1 = ?1',
  pruneMatchResults: 'DELETE FROM match_results WHERE match_id IN (SELECT match_id FROM match_results WHERE day < ?1 LIMIT ?2)',

  /** Adds a badge once (badges are a JSON array on the account). */
  addBadge:
    "UPDATE accounts SET badges_json = json_insert(badges_json, '$[#]', ?2) WHERE uid = ?1 AND status = 'active' AND NOT EXISTS (SELECT 1 FROM json_each(accounts.badges_json) WHERE value = ?2)",

  // ---- cups (0002)
  insertCupPlayer: 'INSERT INTO cup_players (uid, cup_id, joined_hour) VALUES (?1, ?2, ?3) ON CONFLICT(uid, cup_id) DO NOTHING',
  cupsOfUid: 'SELECT cup_id FROM cup_players WHERE uid = ?1',
  deleteCupsOfUid: 'DELETE FROM cup_players WHERE uid = ?1',

  // ---- Daily Six (0002)
  dailyAttemptRow: 'SELECT started, finished, current_id FROM daily_attempts WHERE day = ?1 AND uid = ?2',
  /** Claims attempt number `started + 1` when fewer than ?4 were started and none is in progress. Params: 1 day, 2 uid, 3 attempt id, 4 max. */
  claimDailyAttempt:
    'INSERT INTO daily_attempts (day, uid, started, finished, current_id, ids) VALUES (?1, ?2, 1, 0, ?3, json_array(?3)) ' +
    "ON CONFLICT(day, uid) DO UPDATE SET started = started + 1, current_id = ?3, ids = json_insert(daily_attempts.ids, '$[#]', ?3) " +
    'WHERE daily_attempts.started < ?4 AND daily_attempts.current_id IS NULL RETURNING started',
  /** Every Daily Six attempt object of the player (account deletion forgets them all). */
  dailyAttemptIdsOfUid: 'SELECT current_id, ids FROM daily_attempts WHERE uid = ?1',
  finishDailyAttempt: 'UPDATE daily_attempts SET finished = finished + 1, current_id = NULL WHERE day = ?1 AND uid = ?2 AND current_id = ?3',
  /** Best of three: only a higher score replaces the stored one (idempotent). */
  upsertDailyScore:
    'INSERT INTO daily_scores (day, uid, best_score, city, player_id, alias, avatar_seed, updated_ms, late, suspect, missed) ' +
    "SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11 WHERE EXISTS (SELECT 1 FROM accounts WHERE uid = ?2 AND status = 'active') " +
    'ON CONFLICT(day, uid) DO UPDATE SET best_score = excluded.best_score, updated_ms = excluded.updated_ms, late = excluded.late, suspect = excluded.suspect, missed = excluded.missed WHERE excluded.best_score > daily_scores.best_score',
  dailyScoreRow: 'SELECT best_score FROM daily_scores WHERE day = ?1 AND uid = ?2',
  /** Streak: +1 after yesterday, 1 after a gap, unchanged on the same day. Params: 1 uid, 2 day, 3 yesterday. */
  upsertStreak:
    "INSERT INTO daily_players (uid, streak, best_streak, last_day) SELECT ?1, 1, 1, ?2 WHERE EXISTS (SELECT 1 FROM accounts WHERE uid = ?1 AND status = 'active') " +
    'ON CONFLICT(uid) DO UPDATE SET streak = CASE WHEN daily_players.last_day = ?3 THEN daily_players.streak + 1 ELSE 1 END, ' +
    'best_streak = max(daily_players.best_streak, CASE WHEN daily_players.last_day = ?3 THEN daily_players.streak + 1 ELSE 1 END), last_day = ?2 ' +
    'WHERE daily_players.last_day <> ?2',
  streakRow: 'SELECT streak, best_streak, last_day FROM daily_players WHERE uid = ?1',
  topNational:
    'SELECT uid, player_id, alias, avatar_seed, best_score FROM daily_scores WHERE day = ?1 ORDER BY best_score DESC, updated_ms ASC LIMIT ?2',
  topCity:
    'SELECT uid, player_id, alias, avatar_seed, best_score FROM daily_scores WHERE day = ?1 AND city = ?2 ORDER BY best_score DESC, updated_ms ASC LIMIT ?3',
  histogramAbove: 'SELECT COALESCE(SUM(n), 0) AS n FROM daily_score_counts WHERE day = ?1 AND scope = ?2 AND score > ?3',
  histogramTotal: 'SELECT COALESCE(SUM(n), 0) AS n FROM daily_score_counts WHERE day = ?1 AND scope = ?2',
  topGroup:
    'SELECT ds.uid AS uid, ds.player_id AS player_id, ds.alias AS alias, ds.avatar_seed AS avatar_seed, ds.best_score AS best_score FROM group_members gm ' +
    'JOIN daily_scores ds ON ds.day = ?2 AND ds.uid = gm.uid WHERE gm.group_id = ?1 ORDER BY ds.best_score DESC, ds.updated_ms ASC LIMIT ?3',
  countGroup:
    'SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN ds.best_score > ?3 THEN 1 ELSE 0 END), 0) AS above FROM group_members gm ' +
    'JOIN daily_scores ds ON ds.day = ?2 AND ds.uid = gm.uid WHERE gm.group_id = ?1',
  topFriends:
    'SELECT uid, player_id, alias, avatar_seed, best_score FROM daily_scores WHERE day = ?2 AND (uid = ?1 OR uid IN (SELECT friend_uid FROM friends WHERE uid = ?1)) ' +
    'ORDER BY best_score DESC, updated_ms ASC LIMIT ?3',
  countFriends:
    'SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN best_score > ?3 THEN 1 ELSE 0 END), 0) AS above FROM daily_scores WHERE day = ?2 AND (uid = ?1 OR uid IN (SELECT friend_uid FROM friends WHERE uid = ?1))',
  membershipKind: 'SELECT g.kind AS kind FROM group_members m JOIN groups g ON g.group_id = m.group_id WHERE m.uid = ?1 AND m.group_id = ?2',
  deleteDailyScoresOfUid: 'DELETE FROM daily_scores WHERE uid = ?1 AND day IN (SELECT value FROM json_each(?2))',
  deleteDailyAttemptsOfUid: 'DELETE FROM daily_attempts WHERE uid = ?1 AND day IN (SELECT value FROM json_each(?2))',
  deleteStreakOfUid: 'DELETE FROM daily_players WHERE uid = ?1',
  pruneDailyScores: 'DELETE FROM daily_scores WHERE (day, uid) IN (SELECT day, uid FROM daily_scores WHERE day < ?1 LIMIT ?2)',
  pruneDailyCounts: 'DELETE FROM daily_score_counts WHERE (day, scope, score) IN (SELECT day, scope, score FROM daily_score_counts WHERE day < ?1 LIMIT ?2)',
  pruneDailyAttempts: 'DELETE FROM daily_attempts WHERE (day, uid) IN (SELECT day, uid FROM daily_attempts WHERE day < ?1 LIMIT ?2)',

  // ---- notification preferences and room settings (0002)
  notifyPrefs: 'SELECT enabled, quiet_start, quiet_end FROM notify_prefs WHERE uid = ?1',
  upsertNotifyPrefs:
    'INSERT INTO notify_prefs (uid, enabled, quiet_start, quiet_end, updated_ms) VALUES (?1, ?2, ?3, ?4, ?5) ' +
    'ON CONFLICT(uid) DO UPDATE SET enabled = excluded.enabled, quiet_start = excluded.quiet_start, quiet_end = excluded.quiet_end, updated_ms = excluded.updated_ms',
  deleteNotifyPrefsOfUid: 'DELETE FROM notify_prefs WHERE uid = ?1',
  roomSetting: 'SELECT muted, notify FROM room_settings WHERE uid = ?1 AND room_id = ?2',
  upsertRoomSetting:
    'INSERT INTO room_settings (uid, room_id, muted, notify) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(uid, room_id) DO UPDATE SET muted = excluded.muted, notify = excluded.notify',
  deleteRoomSetting: 'DELETE FROM room_settings WHERE uid = ?1 AND room_id = ?2',
  deleteRoomSettingsOfUid: 'DELETE FROM room_settings WHERE uid = ?1',

  // ---- data export (everything stored about the player, by primary-key lookups)
  exportResults:
    'SELECT match_id, kind, cup_id, stage, day, uid0, uid1, runs0, wickets0, runs1, wickets1, winner, late0, late1, missed0, missed1, auto0, auto1, suspect0, suspect1, ' +
    'rated, r0, r1, d0, d1, te0, cl0, ex0, te1, cl1, ex1 FROM match_results WHERE match_id IN (SELECT match_id FROM match_players WHERE uid = ?1) ORDER BY day DESC LIMIT 1000',
  exportDailyScores: 'SELECT day, best_score, city, late, missed, suspect FROM daily_scores WHERE uid = ?1 AND day IN (SELECT value FROM json_each(?2)) ORDER BY day DESC',
  exportDailyAttempts: 'SELECT day, started, finished FROM daily_attempts WHERE uid = ?1 AND day IN (SELECT value FROM json_each(?2)) ORDER BY day DESC',
  exportRoomSettings: 'SELECT room_id, muted, notify FROM room_settings WHERE uid = ?1',
  exportCups: 'SELECT cup_id, joined_hour FROM cup_players WHERE uid = ?1',
  exportFriends:
    "SELECT a.player_id AS player_id, a.alias AS alias, f.since_day AS since_day FROM friends f JOIN accounts a ON a.uid = f.friend_uid AND a.status = 'active' WHERE f.uid = ?1",
  exportBlocks: 'SELECT blocked_player_id, created_hour FROM blocks WHERE uid = ?1',
  exportReports: 'SELECT target_kind, target_id, reason, status, created_hour FROM reports WHERE reporter_ref = ?1 ORDER BY id DESC LIMIT 500',
} as const;
