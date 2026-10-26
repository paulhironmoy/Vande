/** D1 statements of the Top 100 and the highlight pipeline (named constants, like storage/sql.ts). */
const JOB_COLUMNS =
  'job_id, day, match_id, kind, cup_id, room_id, uid0, uid1, pid0, pid1, alias0, alias1, avatar0, avatar1, pair, rank0, rank1, status, title, description, ' +
  'fixture_label, locale, visibility, code, consent_by_ms, video_key, video_sha256, video_bytes, video_ms, youtube_video_id, upload_session, quota_day, ' +
  'scheduled_ms, retry_ms, lease_ms, attempts, upload_attempts, last_error, withdraw_pending, published_ms, views, views_ms, created_ms, updated_ms';

export const HSQL = {
  // ---- Top 100
  dayFrozen: 'SELECT day, frozen_ms, ranked, players, notified FROM top100_days WHERE day = ?1',
  /** One page of a day's finished duel and cup matches with both players' accounts (paged by match id). */
  dayResults:
    'SELECT mr.match_id, mr.kind, mr.cup_id, mr.stage, mr.revealed_ms, mr.uid0, mr.uid1, mr.winner, mr.runs0, mr.wickets0, mr.runs1, mr.wickets1, ' +
    'mr.late0, mr.late1, mr.missed0, mr.missed1, mr.auto0, mr.auto1, mr.suspect0, mr.suspect1, mr.r0, mr.r1, mr.te0, mr.cl0, mr.ex0, mr.te1, mr.cl1, mr.ex1, ' +
    'a0.player_id AS pid0, a0.alias AS alias0, a0.avatar_seed AS avatar0, a0.status AS st0, a0.effort AS ef0, a0.rated_matches AS rm0, a0.locale AS loc0, ' +
    'a1.player_id AS pid1, a1.alias AS alias1, a1.avatar_seed AS avatar1, a1.status AS st1, a1.effort AS ef1, a1.rated_matches AS rm1, a1.locale AS loc1 ' +
    'FROM match_results mr LEFT JOIN accounts a0 ON a0.uid = mr.uid0 LEFT JOIN accounts a1 ON a1.uid = mr.uid1 ' +
    "WHERE mr.day = ?1 AND mr.kind IN ('duel', 'cup') AND mr.match_id > ?2 ORDER BY mr.match_id LIMIT ?3",
  insertEntry:
    'INSERT INTO top100_entries (day, rank, uid, player_id, alias, score, match_ids, best_match_id, components) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9) ' +
    'ON CONFLICT (day, rank) DO NOTHING',
  /** Deliberately without ON CONFLICT: it aborts a second cutoff's transaction. */
  insertDay: 'INSERT INTO top100_days (day, frozen_ms, ranked, players, notified) VALUES (?1, ?2, ?3, ?4, 0)',
  markNotified: 'UPDATE top100_days SET notified = 1 WHERE day = ?1',
  unnotifiedDays: 'SELECT day FROM top100_days WHERE notified = 0 AND day >= ?1 LIMIT 3',
  entriesOfDay: 'SELECT rank, uid, player_id, alias, score, match_ids, best_match_id, components FROM top100_entries WHERE day = ?1 ORDER BY rank',
  /** Live highlights of a Top 100 day (every participant consented; none being withdrawn): best match → landing code. */
  liveCodesOfDay: "SELECT match_id, code FROM highlight_jobs WHERE status IN ('published', 'unlisted') AND day = ?1 AND withdraw_pending = 0",
  rankOf: 'SELECT rank FROM top100_entries WHERE uid = ?1 AND day = ?2',
  scrubEntries: "UPDATE top100_entries SET uid = ?2, player_id = 'p-deleted', alias = 'Deleted player' WHERE uid = ?1",

  // ---- jobs
  insertJob: `INSERT INTO highlight_jobs (${JOB_COLUMNS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, 'pending_consent', ?18, ?19, ?20, ?21, 'public', ?22, ?23, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, 0, NULL, 0, NULL, 0, NULL, ?24, ?24) ON CONFLICT DO NOTHING`,
  jobById: `SELECT ${JOB_COLUMNS} FROM highlight_jobs WHERE job_id = ?1`,
  jobByCode: `SELECT ${JOB_COLUMNS} FROM highlight_jobs WHERE code = ?1`,
  jobsOfUid: `SELECT ${JOB_COLUMNS} FROM highlight_jobs WHERE uid0 = ?1 AND day >= ?2 UNION ALL SELECT ${JOB_COLUMNS} FROM highlight_jobs WHERE uid1 = ?1 AND day >= ?2 ORDER BY created_ms DESC LIMIT 50`,
  jobsOfDay: `SELECT ${JOB_COLUMNS} FROM highlight_jobs WHERE day = ?1 ORDER BY created_ms, job_id LIMIT 200`,
  jobsOfDayStatus: `SELECT ${JOB_COLUMNS} FROM highlight_jobs WHERE day = ?1 AND status = ?2 ORDER BY created_ms, job_id LIMIT 200`,
  jobsWithStatus: `SELECT ${JOB_COLUMNS} FROM highlight_jobs WHERE status = ?1 ORDER BY updated_ms LIMIT ?2`,
  liveJobsOfUid: `SELECT ${JOB_COLUMNS} FROM highlight_jobs WHERE (uid0 = ?1 OR uid1 = ?1) AND status NOT IN ('consent_declined', 'rejected', 'removed')`,
  /** Every job of a player, any day and status (account deletion rewrites their titles). */
  allJobsOfUid: `SELECT ${JOB_COLUMNS} FROM highlight_jobs WHERE uid0 = ?1 UNION ALL SELECT ${JOB_COLUMNS} FROM highlight_jobs WHERE uid1 = ?1 AND uid0 != ?1`,
  retitleJob: 'UPDATE highlight_jobs SET title = ?2, description = ?3 WHERE job_id = ?1',
  retitleConsents: 'UPDATE highlight_consents SET approved_title = ?2 WHERE job_id = ?1',
  resultScore: 'SELECT runs0, wickets0, runs1, wickets1, winner FROM match_results WHERE match_id = ?1',
  /**
   * Live or uploading jobs that must come down: a removal is pending, or either participant's latest consent decision
   * is not "granted" (a withdrawal that raced the pipeline, or a deleted account). The sweeper removes them.
   */
  unconsented:
    `SELECT ${JOB_COLUMNS} FROM highlight_jobs j WHERE j.status IN ('uploading', 'published', 'unlisted') AND (j.withdraw_pending != 0 ` +
    "OR COALESCE((SELECT c.decision FROM highlight_consents c WHERE c.job_id = j.job_id AND c.uid = j.uid0 ORDER BY c.seq DESC LIMIT 1), '') != 'granted' " +
    "OR COALESCE((SELECT c.decision FROM highlight_consents c WHERE c.job_id = j.job_id AND c.uid = j.uid1 ORDER BY c.seq DESC LIMIT 1), '') != 'granted') LIMIT 50",
  /** Compare-and-swap status change (?4: the status it must still have). */
  setStatus: 'UPDATE highlight_jobs SET status = ?2, last_error = ?3, updated_ms = ?5 WHERE job_id = ?1 AND status = ?4',
  setVisibility: 'UPDATE highlight_jobs SET visibility = ?2, updated_ms = ?3 WHERE job_id = ?1',
  claimRender:
    "UPDATE highlight_jobs SET status = 'rendering', lease_ms = ?2, attempts = attempts + 1, updated_ms = ?1 WHERE job_id = (" +
    "SELECT job_id FROM highlight_jobs WHERE status = 'queued_render' OR (status = 'render_failed' AND retry_ms <= ?1) ORDER BY updated_ms, job_id LIMIT 1" +
    ") AND status IN ('queued_render', 'render_failed') RETURNING job_id",
  renderStored: "UPDATE highlight_jobs SET video_key = ?2, video_sha256 = ?3, video_bytes = ?4, video_ms = ?5, status = ?6, last_error = NULL, lease_ms = NULL, updated_ms = ?7 WHERE job_id = ?1 AND status = 'rendering'",
  renderFailed: "UPDATE highlight_jobs SET status = ?2, last_error = ?3, retry_ms = ?4, lease_ms = NULL, updated_ms = ?5 WHERE job_id = ?1 AND status = 'rendering'",
  expiredLeases: "SELECT job_id, attempts FROM highlight_jobs WHERE status = 'rendering' AND lease_ms < ?1 LIMIT 50",
  expiredConsents: "SELECT job_id FROM highlight_jobs WHERE status = 'pending_consent' AND consent_by_ms < ?1 LIMIT 50",
  /** Never for a job whose withdrawal or removal is pending. */
  schedule:
    "UPDATE highlight_jobs SET status = 'scheduled', scheduled_ms = ?2, last_error = ?3, updated_ms = ?4 WHERE job_id = ?1 AND status IN ('approved', 'scheduled', 'awaiting_channel', 'upload_failed', 'dead_letter', 'uploading') AND withdraw_pending = 0",
  dueUploads: "SELECT job_id FROM highlight_jobs WHERE status = 'scheduled' AND scheduled_ms <= ?1 ORDER BY scheduled_ms LIMIT 25",
  staleUploads: "SELECT job_id FROM highlight_jobs WHERE status = 'uploading' AND updated_ms < ?1 LIMIT 25",
  setQuotaDay: 'UPDATE highlight_jobs SET quota_day = ?2, updated_ms = ?3 WHERE job_id = ?1',
  /** Compare-and-swap: only a job still due for upload, with no withdrawal or removal pending, starts uploading. */
  setSession:
    "UPDATE highlight_jobs SET upload_session = ?2, status = 'uploading', upload_attempts = upload_attempts + 1, last_error = NULL, updated_ms = ?3 " +
    "WHERE job_id = ?1 AND status IN ('scheduled', 'uploading', 'upload_failed') AND withdraw_pending = 0",
  /** One consumer per upload at a time (duplicate messages, admin retries, the stall sweeper). */
  leaseUpload: "UPDATE highlight_jobs SET lease_ms = ?2 WHERE job_id = ?1 AND (lease_ms IS NULL OR lease_ms < ?3) AND status IN ('scheduled', 'uploading', 'upload_failed')",
  releaseUpload: 'UPDATE highlight_jobs SET lease_ms = NULL WHERE job_id = ?1',
  touchUpload: 'UPDATE highlight_jobs SET updated_ms = ?2, lease_ms = ?3 WHERE job_id = ?1',
  clearSession: 'UPDATE highlight_jobs SET upload_session = NULL, quota_day = NULL, updated_ms = ?2 WHERE job_id = ?1',
  /** Records the finished video once (a second completion never overwrites it); the status is decided separately. */
  recordVideo: 'UPDATE highlight_jobs SET youtube_video_id = ?2, upload_session = NULL, updated_ms = ?3 WHERE job_id = ?1 AND youtube_video_id IS NULL',
  /** Published only while uploading with nothing pending: a withdrawal or removal that arrived first wins. */
  markPublished:
    "UPDATE highlight_jobs SET status = 'published', published_ms = ?3, last_error = NULL, updated_ms = ?3 " +
    "WHERE job_id = ?1 AND youtube_video_id = ?2 AND status = 'uploading' AND withdraw_pending = 0",
  /** withdraw_pending: 0 nothing, 1 a participant withdrew (or deleted the account), 2 an admin removed the video. */
  markWithdraw: 'UPDATE highlight_jobs SET withdraw_pending = 1, updated_ms = ?2 WHERE job_id = ?1',
  markRemoval: 'UPDATE highlight_jobs SET withdraw_pending = CASE WHEN withdraw_pending = 0 THEN 2 ELSE withdraw_pending END, updated_ms = ?2 WHERE job_id = ?1',
  setError: 'UPDATE highlight_jobs SET last_error = ?2, updated_ms = ?3 WHERE job_id = ?1',
  /** Failed removals due for another try (hourly); a job without a video goes back to stopping its upload. */
  removalRetriesDue: "SELECT job_id FROM highlight_jobs WHERE status = 'removal_failed' AND updated_ms < ?1 ORDER BY updated_ms LIMIT 25",
  retryRemoval: "UPDATE highlight_jobs SET status = CASE WHEN youtube_video_id IS NULL THEN 'uploading' ELSE status END, updated_ms = ?2 WHERE job_id = ?1 AND status = 'removal_failed'",
  forceStatus: 'UPDATE highlight_jobs SET status = ?2, last_error = ?3, updated_ms = ?4 WHERE job_id = ?1',
  resetRender: "UPDATE highlight_jobs SET status = 'queued_render', attempts = 0, retry_ms = NULL, lease_ms = NULL, last_error = NULL, updated_ms = ?2 WHERE job_id = ?1",
  /** A participant's current or earlier highlight with the same pair or match (moderation duplicate check). */
  duplicates:
    "SELECT job_id, status, day FROM highlight_jobs WHERE job_id != ?1 AND (match_id = ?2 OR (pair = ?3 AND day > ?4 AND day <= ?5)) AND status NOT IN ('consent_declined', 'rejected', 'removed')",
  oldVideos:
    "SELECT job_id, video_key FROM highlight_jobs WHERE video_key IS NOT NULL AND ((status IN ('published', 'unlisted', 'removed') AND COALESCE(published_ms, updated_ms) < ?1) OR (status IN ('consent_declined', 'rejected') AND updated_ms < ?1)) LIMIT 50",
  dropVideo: 'UPDATE highlight_jobs SET video_key = NULL, updated_ms = ?2 WHERE job_id = ?1',
  statsDue: "SELECT job_id, code, youtube_video_id, views FROM highlight_jobs WHERE status IN ('published', 'unlisted') AND youtube_video_id IS NOT NULL AND COALESCE(views_ms, 0) < ?1 AND published_ms > ?2 LIMIT 50",
  setViews: 'UPDATE highlight_jobs SET views = ?2, views_ms = ?3 WHERE job_id = ?1',
  scrubJobUid0: "UPDATE highlight_jobs SET uid0 = ?2, pid0 = 'p-deleted', alias0 = 'Deleted player', avatar0 = 'deleted0', pair = ?2 WHERE uid0 = ?1",
  scrubJobUid1: "UPDATE highlight_jobs SET uid1 = ?2, pid1 = 'p-deleted', alias1 = 'Deleted player', avatar1 = 'deleted0', pair = ?2 WHERE uid1 = ?1",
  statusCounts: 'SELECT status, COUNT(*) AS n FROM highlight_jobs WHERE day >= ?1 GROUP BY status',

  // ---- consent and moderation records
  insertConsent:
    'INSERT INTO highlight_consents (job_id, seq, uid, player_id, decision, adult, approved_title, approved_visibility, reason, decided_ms) ' +
    'SELECT ?1, COALESCE(MAX(seq), 0) + 1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9 FROM highlight_consents WHERE job_id = ?1',
  consentsOf: 'SELECT seq, uid, player_id, decision, adult, approved_title, approved_visibility, reason, decided_ms FROM highlight_consents WHERE job_id = ?1 ORDER BY seq',
  scrubConsents: "UPDATE highlight_consents SET uid = ?2, player_id = 'p-deleted' WHERE uid = ?1",
  insertModeration:
    'INSERT INTO highlight_moderation (job_id, seq, alias_check, anti_cheat, duplicate, reviewer, admin, decision, notes, decided_ms) ' +
    'SELECT ?1, COALESCE(MAX(seq), 0) + 1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9 FROM highlight_moderation WHERE job_id = ?1',
  moderationOf: 'SELECT seq, alias_check, anti_cheat, duplicate, reviewer, admin, decision, notes, decided_ms FROM highlight_moderation WHERE job_id = ?1 ORDER BY seq',

  // ---- attribution and quota
  countAttribution: 'INSERT INTO attribution_daily (code, day, event, n) VALUES (?1, ?2, ?3, ?4) ON CONFLICT (code, day, event) DO UPDATE SET n = n + excluded.n',
  attributionOf: 'SELECT day, event, n FROM attribution_daily WHERE code = ?1 ORDER BY day DESC, event LIMIT 200',
  liveCode: "SELECT job_id FROM highlight_jobs WHERE code = ?1 AND status IN ('published', 'unlisted')",
  scheduledByDay: "SELECT scheduled_ms FROM highlight_jobs WHERE status = 'scheduled' ORDER BY scheduled_ms LIMIT 500",

  // ---- signed internal requests
  useNonce: 'INSERT INTO internal_nonces (nonce, ms) VALUES (?1, ?2) ON CONFLICT (nonce) DO NOTHING',
  pruneNonces: 'DELETE FROM internal_nonces WHERE nonce IN (SELECT nonce FROM internal_nonces WHERE ms < ?1 LIMIT ?2)',
  pruneQuota: 'DELETE FROM yt_quota WHERE qday IN (SELECT qday FROM yt_quota WHERE qday < ?1 LIMIT ?2)',
  /** Closed jobs (no video exists) are kept 400 days, then their records go: consents and moderation first. */
  pruneClosedConsents:
    "DELETE FROM highlight_consents WHERE job_id IN (SELECT job_id FROM highlight_jobs WHERE status IN ('consent_declined', 'rejected', 'removed') AND updated_ms < ?1 LIMIT ?2)",
  pruneClosedModeration:
    "DELETE FROM highlight_moderation WHERE job_id IN (SELECT job_id FROM highlight_jobs WHERE status IN ('consent_declined', 'rejected', 'removed') AND updated_ms < ?1 LIMIT ?2)",
  pruneClosedJobs:
    "DELETE FROM highlight_jobs WHERE job_id IN (SELECT job_id FROM highlight_jobs WHERE status IN ('consent_declined', 'rejected', 'removed') AND updated_ms < ?1 LIMIT ?2)",
  pruneAttribution: 'DELETE FROM attribution_daily WHERE (code, day, event) IN (SELECT code, day, event FROM attribution_daily WHERE day < ?1 LIMIT ?2)',
} as const;
