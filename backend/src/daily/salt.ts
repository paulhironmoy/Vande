/**
 * The secret salt for engine.dailyChallenge(day, serverSalt), computed on the server only:
 * HMAC(DAILY_SALT_KEY, "daily-salt|<generation>"). The engine keys each day's conditions and overs by day + salt, so
 * every day differs and none can be computed from the open engine in the app bundle; one salt across days also keeps
 * the engine's secret three-day pitch rotation (each pitch once per block), which a per-day salt would break. The
 * salt never leaves the Worker: a daily replay carries only its over's commit salt, which the engine derives one-way
 * from it. Changing DAILY_SALT_KEY or the generation changes the current day's overs, so do it only at a reset
 * (00:00 IST), ideally at a three-day block boundary.
 */
import type { Env } from '../env';
import type { Logger } from '../http/log';
import { hmac, hmacKeyFor } from '../security/crypto';
import { toHex, utf8 } from '../security/encoding';
import { dailySaltKey } from '../security/secrets';

export const DAILY_SALT_GENERATION = 1;

export async function dailySalt(env: Env, log: Logger): Promise<string> {
  const key = dailySaltKey(env, log);
  return toHex(await hmac(await hmacKeyFor(utf8(key), 'daily-salt', 'daily'), `daily-salt|${DAILY_SALT_GENERATION}`));
}
