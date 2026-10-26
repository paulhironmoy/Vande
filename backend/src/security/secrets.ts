/**
 * Fail-closed secrets. Each route asks only for what it needs; a missing or malformed secret answers 503
 * `unavailable` ("service not configured") and logs one warning per isolate naming the secret (never its value).
 */
import type { Env } from '../env';
import { fail } from '../http/errors';
import { warnOnce, type Logger } from '../http/log';
import { parseKeyring, type Keyring } from './keyring';
import { signingKey, type SigningKey } from './signing';

export function tokenKeys(env: Env, log: Logger): Keyring {
  const ring = parseKeyring(env.TOKEN_KEYS);
  if (!ring) {
    warnOnce(log, 'TOKEN_KEYS', 'TOKEN_KEYS is missing or malformed ("kid:base64url32+[,…]"); auth, ball and invite tokens are disabled');
    fail('unavailable', 'service not configured');
  }
  return ring;
}

export function dataKeys(env: Env, log: Logger): Keyring {
  const ring = parseKeyring(env.DATA_KEYS);
  if (!ring) {
    warnOnce(log, 'DATA_KEYS', 'DATA_KEYS is missing or malformed ("kid:base64url32+[,…]"); sealing and encrypted storage are disabled');
    fail('unavailable', 'service not configured');
  }
  return ring;
}

export async function commitSigner(env: Env, log: Logger): Promise<SigningKey> {
  const key = await signingKey(env.SIGNING_KEY);
  if (!key) {
    warnOnce(log, 'SIGNING_KEY', 'SIGNING_KEY is missing or not a P-256 private JWK; locking overs is disabled');
    fail('unavailable', 'service not configured');
  }
  return key;
}

export function identityPepper(env: Env, log: Logger): string {
  const pepper = env.IDENTITY_PEPPER ?? '';
  if (pepper.length < 32) {
    warnOnce(log, 'IDENTITY_PEPPER', 'IDENTITY_PEPPER is missing or shorter than 32 characters; account linking is disabled');
    fail('unavailable', 'service not configured');
  }
  return pepper;
}

/** The rate-limit salt, or null when limits are explicitly off for local development. */
export function rateSalt(env: Env, log: Logger, production: boolean): string | null {
  if (env.RATE_SALT && env.RATE_SALT.length >= 16) return env.RATE_SALT;
  if (env.ALLOW_UNLIMITED_WRITES === '1' && !production) {
    warnOnce(log, 'ALLOW_UNLIMITED_WRITES', 'RATE_SALT is not set and ALLOW_UNLIMITED_WRITES=1: rate limiting is OFF (local development only)');
    return null;
  }
  warnOnce(log, 'RATE_SALT', 'RATE_SALT is missing or shorter than 16 characters; the API refuses requests');
  return fail('unavailable', 'service not configured', { headers: { 'retry-after': '3600' } });
}

/** Daily Six salt key (≥ 32 characters; rotate only at a reset: it decides the day's overs). */
export function dailySaltKey(env: Env, log: Logger): string {
  const key = env.DAILY_SALT_KEY ?? '';
  if (key.length < 32) {
    warnOnce(log, 'DAILY_SALT_KEY', 'DAILY_SALT_KEY is missing or shorter than 32 characters; Daily Six is disabled');
    fail('unavailable', 'service not configured');
  }
  return key;
}
