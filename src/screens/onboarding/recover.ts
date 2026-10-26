/**
 * Account recovery on a new device: the player signs in with the Google account or passkey they linked before, the
 * server answers with that account's session, and the device adopts it and loads the profile. A guest account that
 * was never linked cannot be recovered (the server knows no sign-in for it).
 */
import type { IdentityProvider, Profile, SessionTokens } from '@/contracts';
import type { LocalPlayer } from '@/app/storeTypes';
import type { Platform } from '@/platform';
import type { Net } from '@/net';
import { isApiClientError } from '@/net/errors';

export type RecoveryMethod = IdentityProvider['id'];
export type RecoveryFailure = 'cancelled' | 'failed' | 'offline' | 'no_account';
export type RecoveryResult = { ok: true; player: LocalPlayer; profile: Profile } | { ok: false; reason: RecoveryFailure };

/** The sign-in methods this build can recover with (none when neither Google nor passkeys are configured). */
export function recoveryMethods(platform: Pick<Platform, 'identity'> | null | undefined): RecoveryMethod[] {
  if (!platform) return [];
  return (['google', 'passkey'] as const).filter((id) => {
    try {
      return platform.identity[id].available();
    } catch {
      return false;
    }
  });
}

function failureOf(e: unknown): RecoveryFailure {
  if (!isApiClientError(e)) return 'failed';
  if (e.code === 'not_found') return 'no_account';
  if (e.code === 'network' || e.code === 'timeout' || e.code === 'offline') return 'offline';
  return 'failed';
}

/**
 * Runs the provider's sign-in, exchanges the credential for the account's session and loads its profile. When the
 * profile cannot be loaded, the adopted session is dropped again, so a new player made on this screen can never be
 * saved onto the recovered account.
 */
export async function recoverAccount(net: Pick<Net, 'api' | 'session' | 'signOut'>, provider: IdentityProvider): Promise<RecoveryResult> {
  let credential: string | null;
  try {
    credential = await provider.obtainCredential();
  } catch {
    return { ok: false, reason: 'failed' };
  }
  if (!credential) return { ok: false, reason: 'cancelled' };
  let tokens: SessionTokens;
  try {
    tokens = provider.id === 'google' ? await net.api.call('POST /v1/auth/google', { body: { idToken: credential } }) : await net.api.call('POST /v1/auth/passkey', { body: { credential } });
  } catch (e) {
    return { ok: false, reason: failureOf(e) };
  }
  await net.session.adopt(tokens);
  try {
    const profile = await net.api.call('GET /v1/me');
    return { ok: true, profile, player: { id: profile.playerId, alias: profile.alias, avatar: profile.avatar, kit: profile.kit } };
  } catch (e) {
    // Ends the new session on the server when it can; offline, the device forgets it anyway.
    await net.signOut().catch(() => net.session.clear('signed_out'));
    return { ok: false, reason: failureOf(e) === 'offline' ? 'offline' : 'failed' };
  }
}
