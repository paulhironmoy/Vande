/**
 * ECDSA P-256 / SHA-256 server signatures over commit records (`matchId|player|hash|engine`).
 *
 * The private key lives only in the Worker secret SIGNING_KEY (a P-256 private JWK). Each signature names its key by a
 * key id: the first 4 bytes of SHA-256 over the uncompressed public point, as 8 lowercase hex characters, so anyone
 * holding the published public keys (GET /v1/keys) can verify a commit offline, also after a rotation
 * (RETIRED_SIGNING_KEYS keeps old public keys published). Salvaged from the previous Worker's dare signing.
 */
import { fromBase64Url, fromHex, toHex, utf8, type Bytes } from './encoding';
import { sha256 } from './crypto';

const ALGORITHM = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const SIGN = { name: 'ECDSA', hash: 'SHA-256' } as const;

export interface SigningKey {
  key: CryptoKey;
  keyId: string;
  /** Uncompressed public point (04 || x || y), lowercase hex. */
  publicKey: string;
}

export interface PublicKeyRecord {
  keyId: string;
  alg: 'ES256';
  publicKey: string;
  status: 'active' | 'retired';
}

/** Uncompressed public point of a P-256 JWK, as hex. */
export function publicHexOfJwk(jwk: JsonWebKey): string {
  const x = fromBase64Url(jwk.x ?? '');
  const y = fromBase64Url(jwk.y ?? '');
  if (!x || !y || x.length !== 32 || y.length !== 32) throw new Error('bad P-256 coordinates');
  return `04${toHex(x)}${toHex(y)}`;
}

export async function keyIdOf(publicHex: string): Promise<string> {
  const raw = fromHex(publicHex);
  if (!raw) throw new Error('bad public key');
  return toHex((await sha256(raw)).slice(0, 4));
}

let cached: { source: string; key: Promise<SigningKey | null> } | null = null;

/** Imports SIGNING_KEY once per isolate; null when missing or unusable (callers then fail closed). */
export function signingKey(jwkText: string | undefined): Promise<SigningKey | null> {
  if (!jwkText) return Promise.resolve(null);
  if (cached && cached.source === jwkText) return cached.key;
  const key = (async (): Promise<SigningKey | null> => {
    try {
      const jwk = JSON.parse(jwkText) as JsonWebKey;
      if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !jwk.d) return null;
      const publicKey = publicHexOfJwk(jwk);
      const keyId = await keyIdOf(publicKey);
      const imported = await crypto.subtle.importKey('jwk', jwk, ALGORITHM, false, ['sign']);
      return { key: imported, keyId, publicKey };
    } catch {
      // Never surface the parse error: a JSON.parse message can quote part of the secret.
      return null;
    }
  })();
  cached = { source: jwkText, key };
  return key;
}

/** Raw r||s signature as 128 lowercase hex characters. */
export async function signText(key: SigningKey, text: string): Promise<string> {
  return toHex(new Uint8Array(await crypto.subtle.sign(SIGN, key.key, utf8(text))));
}

export async function verifyText(publicHex: string, text: string, sigHex: string): Promise<boolean> {
  const raw = fromHex(publicHex);
  const sig = fromHex(sigHex);
  if (!raw || !sig || sig.length !== 64) return false;
  try {
    const key = await crypto.subtle.importKey('raw', raw as Bytes, ALGORITHM, false, ['verify']);
    return await crypto.subtle.verify(SIGN, key, sig, utf8(text));
  } catch {
    return false;
  }
}

/** The text a commit signature covers. */
export function commitMessage(matchId: string, player: 0 | 1, hash: string, engine: number): string {
  return `${matchId}|${player}|${hash}|${engine}`;
}

/** RETIRED_SIGNING_KEYS: comma-separated uncompressed public points (hex) that stay published after a rotation. */
export async function publishedKeys(active: SigningKey | null, retiredRaw: string | undefined): Promise<PublicKeyRecord[]> {
  const out: PublicKeyRecord[] = [];
  if (active) out.push({ keyId: active.keyId, alg: 'ES256', publicKey: active.publicKey, status: 'active' });
  for (const hex of (retiredRaw ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)) {
    if (!/^04[0-9a-f]{128}$/.test(hex) || out.some((k) => k.publicKey === hex)) continue;
    out.push({ keyId: await keyIdOf(hex), alg: 'ES256', publicKey: hex, status: 'retired' });
  }
  return out;
}

/** Test hook: forget the cached key. */
export function __resetSigningKeyForTests(): void {
  cached = null;
}
