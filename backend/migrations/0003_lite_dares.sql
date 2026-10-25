-- Verified dares (Lite). Nothing here identifies a person.
-- One attempt per device per dare: device_key is computed on the device as sha256(installId:dareIdentity), so the
-- same device produces unrelated keys for different dares and attempts cannot be linked across dares.
-- Attempts are deleted after 7 days by the scheduled cleanup (backend/src/index.ts `scheduled`).
CREATE TABLE IF NOT EXISTS lite_attempts (
  attempt_id TEXT PRIMARY KEY,             -- 32 random hex chars chosen by the server
  dare_key TEXT NOT NULL,                  -- first 32 hex of sha256(dareIdentity)
  device_key TEXT NOT NULL,                -- 64 hex: sha256(installId:dareIdentity), computed on the device
  seed INTEGER NOT NULL,                   -- the dare itself (seed, replay path, dared step, deadline): game moves only
  path TEXT NOT NULL,
  step TEXT NOT NULL,
  deadline INTEGER NOT NULL,
  nonce TEXT NOT NULL,                     -- the friend's R2 reply nonce (6 base36)
  answer_path TEXT NOT NULL,               -- clue scans + the answer token from the dared moment
  points INTEGER NOT NULL,                 -- verified by replay
  best INTEGER NOT NULL,                   -- 0 | 1, verified by replay
  kind TEXT NOT NULL,                      -- twist kind derived from the replayed best move
  twist_id TEXT NOT NULL,
  marker TEXT NOT NULL,                    -- v = dare replayed and twist graded | t = twist graded only
  twist_answer TEXT,                       -- NULL until graded; '' when the twist was skipped
  outcome TEXT,                            -- NULL until graded; r | w | s
  sig TEXT,                                -- marker + 128 hex, stored so a repeated grade returns the same signature
  created_at INTEGER NOT NULL,             -- unix ms
  graded_at INTEGER,
  UNIQUE (dare_key, device_key)
);
CREATE INDEX IF NOT EXISTS idx_lite_attempts_created ON lite_attempts (created_at);

-- Today's shared goal: counts only, one row per UTC day.
CREATE TABLE IF NOT EXISTS lite_goal (
  day TEXT PRIMARY KEY,                    -- YYYY-MM-DD (UTC)
  answers INTEGER NOT NULL DEFAULT 0,      -- graded dare answers
  best INTEGER NOT NULL DEFAULT 0,         -- of which found the best move
  updated_at TEXT NOT NULL                 -- ISO hour (UTC)
);
