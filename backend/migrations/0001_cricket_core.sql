-- VANDE Cricket core schema (Cloudflare D1 / SQLite). A new database (`vande-cricket`); nothing from the previous
-- civic Worker is migrated. Tables are WITHOUT ROWID and keyed by what they are looked up by, so most writes cost one
-- billed row; every secondary index adds one written row per insert (measured in backend/test/cost.test.ts and
-- docs/COST_MODEL.md). No table stores an address, an email, a phone number, a real name or a plaintext token.

-- Accounts. `uid` is the internal auth subject (never shown to other players); `player_id` is the public id.
CREATE TABLE accounts (
  uid TEXT PRIMARY KEY,
  player_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active',          -- active | deleted
  alias TEXT NOT NULL,
  avatar_seed TEXT NOT NULL,
  kit_json TEXT NOT NULL,
  locale TEXT NOT NULL,
  city TEXT,                                      -- coarse city id from a fixed list, or NULL
  adult_confirmed INTEGER NOT NULL DEFAULT 0,
  unlocks_json TEXT NOT NULL DEFAULT '[]',
  badges_json TEXT NOT NULL DEFAULT '[]',
  rating REAL NOT NULL DEFAULT 1200,             -- Elo-style (src/engine/ranking.ts), moved by rated duels and cup matches
  rated_matches INTEGER NOT NULL DEFAULT 0,       -- selects the K-factor
  effort REAL,                                    -- long-term typical tactical efficiency (EMA over rated matches)
  created_day TEXT NOT NULL,
  updated_ms INTEGER NOT NULL,
  deleted_ms INTEGER
) WITHOUT ROWID;

-- Refresh-token families (one per signed-in device). Only SHA-256 hashes of refresh secrets are stored.
CREATE TABLE sessions (
  family_id TEXT PRIMARY KEY,
  uid TEXT NOT NULL,
  cur_hash TEXT NOT NULL,
  prev_hash TEXT,
  generation INTEGER NOT NULL DEFAULT 0,
  rotated_ms INTEGER NOT NULL,
  expires_ms INTEGER NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0,
  created_hour TEXT NOT NULL
) WITHOUT ROWID;
CREATE INDEX idx_sessions_uid ON sessions (uid);

-- Linked identities for recovery. subject_hash = HMAC(IDENTITY_PEPPER, provider:subject); never an email.
CREATE TABLE identities (
  provider TEXT NOT NULL,                         -- google | passkey
  subject_hash TEXT NOT NULL,
  uid TEXT NOT NULL,
  created_hour TEXT NOT NULL,
  PRIMARY KEY (provider, subject_hash)
) WITHOUT ROWID;
CREATE INDEX idx_identities_uid ON identities (uid);

-- Private college/company groups, joined by invite code; names are shown to members only.
CREATE TABLE groups (
  group_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,                             -- college | company
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,                      -- normalised Crockford base32, 10 characters
  created_by TEXT NOT NULL,
  member_count INTEGER NOT NULL DEFAULT 0,
  created_hour TEXT NOT NULL
) WITHOUT ROWID;

CREATE TABLE group_members (
  uid TEXT NOT NULL,
  group_id TEXT NOT NULL,
  joined_hour TEXT NOT NULL,
  PRIMARY KEY (uid, group_id)
) WITHOUT ROWID;
CREATE INDEX idx_group_members_group ON group_members (group_id);

-- Each player's list of matches: the redacted MatchView of that player, written by the match's Durable Object at
-- phase changes (rev only moves forward, so a delayed write can never overwrite a newer view).
CREATE TABLE match_players (
  uid TEXT NOT NULL,
  match_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  phase TEXT NOT NULL,
  rev INTEGER NOT NULL,
  updated_ms INTEGER NOT NULL,
  view_json TEXT NOT NULL,
  PRIMARY KEY (uid, match_id)
) WITHOUT ROWID;

-- Idempotency-Key records for mutations served by the Worker (match mutations keep theirs inside the match object).
-- Response bodies are stored AES-GCM encrypted (they can hold tokens).
CREATE TABLE idempotency (
  scope TEXT NOT NULL,                            -- u:<uid> | f:<family> | a:<route>
  idem_key TEXT NOT NULL,
  route TEXT NOT NULL,
  req_hash TEXT NOT NULL,
  state TEXT NOT NULL,                            -- pending | done
  status INTEGER,
  body_enc TEXT,
  created_ms INTEGER NOT NULL,
  expires_ms INTEGER NOT NULL,
  PRIMARY KEY (scope, idem_key)
) WITHOUT ROWID;
CREATE INDEX idx_idempotency_expires ON idempotency (expires_ms);

-- Security audit trail (pseudonymous actor reference, closed action list, no personal data).
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY,
  at_ms INTEGER NOT NULL,
  actor_ref TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  detail TEXT
);

-- Rate-limit buckets: only where the Workers Rate Limiting bindings are absent, plus per-day caps. Keys are salted
-- hashes prefixed with the window's minute (so cleanup deletes a key range); never an address.
CREATE TABLE rate_buckets (
  bucket_key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL
) WITHOUT ROWID;

-- Push device tokens (FCM), encrypted at rest; token_hash dedupes.
CREATE TABLE push_tokens (
  uid TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  token_enc TEXT NOT NULL,
  platform TEXT NOT NULL,
  updated_day TEXT NOT NULL,
  PRIMARY KEY (uid, token_hash)
) WITHOUT ROWID;

-- Data exports waiting in R2 (deleted after EXPORT_TTL by the cleanup).
CREATE TABLE exports (
  export_id TEXT PRIMARY KEY,
  uid TEXT NOT NULL,
  object_key TEXT NOT NULL,
  expires_ms INTEGER NOT NULL
) WITHOUT ROWID;

CREATE TABLE blocks (
  uid TEXT NOT NULL,
  blocked_player_id TEXT NOT NULL,
  created_hour TEXT NOT NULL,
  PRIMARY KEY (uid, blocked_player_id)
) WITHOUT ROWID;

CREATE TABLE reports (
  id INTEGER PRIMARY KEY,
  reporter_ref TEXT NOT NULL,
  target_kind TEXT NOT NULL,                      -- post | player
  target_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_hour TEXT NOT NULL
);
