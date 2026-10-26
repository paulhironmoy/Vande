/**
 * Short invite codes: https://<web>/i/<code>, with 10 random base32 characters (50 bits) instead of the 75-character
 * signed token, so invite cards and WhatsApp messages stay short.
 *
 *   - Issued with every duel, rematch and cup invite (the match or cup object calls issueInviteCode) and stored with
 *     the signed token it stands for and the invite's expiry (D1 invite_codes, migration 0007).
 *   - A lookup costs one indexed read and is charged to the per-network invite budget on every route (match/routes.ts
 *     inviteClaims), and a code that never existed answers exactly like an expired one (same status, code, message and
 *     work), so codes cannot be enumerated. With 50 random bits and a few thousand live invites, a guess hits about
 *     once in 2^38 tries.
 *   - The token behind a code is verified again on every use, exactly like a long-token link, which keeps working.
 *   - When D1 cannot take the code the invite still works: its link carries the signed token instead.
 */
import type { D1Like } from '../env';
import { randomBytes } from '../security/crypto';
import { toBase32 } from '../security/encoding';
import { SQL } from '../storage/sql';

/** One answer for a code that does not exist and for an expired one. */
export const INVITE_CODE_GONE = 'this invite link has expired or is not valid';

/** 10 base32 characters from 56 random bits (the first 50 are kept). */
export function newInviteCode(): string {
  return toBase32(randomBytes(7)).slice(0, 10);
}

/** Stores a fresh code for this signed invite token; null when D1 is unavailable (the link then carries the token). */
export async function issueInviteCode(db: D1Like, token: string, expMs: number, now: number): Promise<string | null> {
  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      const code = newInviteCode();
      const r = await db.prepare(SQL.insertInviteCode).bind(code, token, expMs, now).run();
      // A clash with an existing code (about once in 2^50 per pair) simply draws again.
      if ((r.meta?.changes ?? 1) > 0) return code;
    }
    return null;
  } catch {
    return null;
  }
}

/** The signed token behind a live code, or null for a code that does not exist or has expired (indistinguishable). */
export async function tokenForInviteCode(db: D1Like, code: string, now: number): Promise<string | null> {
  const row = await db.prepare(SQL.inviteCodeToken).bind(code).first<{ token: string; exp_ms: number }>();
  return row && row.exp_ms >= now ? row.token : null;
}
