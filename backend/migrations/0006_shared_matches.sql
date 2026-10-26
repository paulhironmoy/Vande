-- 0006: shared match links (https://<web>/s/<code>): one public code per revealed duel or cup match, asked for by a
-- participant (backend/src/match/share.ts). The code is a keyed HMAC of the match id, so it cannot be guessed. Seats are
-- account ids in replay order; deleting an account scrubs them to a tombstone and the public page then names that
-- player "Deleted player". Nothing else about a person is stored here.
CREATE TABLE shared_matches (
  code TEXT PRIMARY KEY,
  match_id TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,                     -- duel | cup
  uid0 TEXT NOT NULL,
  uid1 TEXT NOT NULL,
  created_ms INTEGER NOT NULL
) WITHOUT ROWID;
CREATE INDEX idx_shared_uid0 ON shared_matches (uid0);
CREATE INDEX idx_shared_uid1 ON shared_matches (uid1);
