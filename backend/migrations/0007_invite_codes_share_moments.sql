-- 0007: short invite links and the server-side share cap.
--
-- invite_codes: https://<web>/i/<code> carries a 10-character random base32 code (50 bits) instead of the 75-character
-- signed token, so invite cards and WhatsApp messages stay short. Each code stands for the invite's signed token
-- (verified again on every use) until the invite's expiry; a code that does not exist answers like an expired one, and
-- every lookup is rate-limited per network (backend/src/match/inviteCodes.ts). The nightly cleanup deletes expired codes.
-- No person is stored here.
CREATE TABLE invite_codes (
  code TEXT PRIMARY KEY,
  token TEXT NOT NULL,
  exp_ms INTEGER NOT NULL,
  created_ms INTEGER NOT NULL
) WITHOUT ROWID;

-- share_moments: the share cap (each player shares each moment of a match or cup at most once: the invitation, one
-- reminder, the final reveal). One row per player, match or cup, and moment, with the time it was first opened
-- (backend/src/match/moments.ts). Deleted with the account, exported with it, and pruned after 90 days.
CREATE TABLE share_moments (
  uid TEXT NOT NULL,
  target_id TEXT NOT NULL,                -- match id, or cup id for a cup's invitation
  moment TEXT NOT NULL,                   -- invite | reminder | final
  first_ms INTEGER NOT NULL,
  PRIMARY KEY (uid, target_id, moment)
) WITHOUT ROWID;
