/**
 * ECDSA P-256 / SHA-256 signing for verified dares (WebCrypto, no dependencies).
 *
 * The private key lives only in the Worker secret DARE_SIGNING_KEY as a JWK (JSON). The matching public key is
 * built into the app (VITE_DARE_PUBLIC_KEYS / VITE_DARE_PUBLIC_KEY, uncompressed point as hex) and checks signatures
 * offline. Each signature names its key by a short key id, so the app can hold several public keys during a rotation
 * (docs/ROLLBACK.md). `scripts/lite-dare-keys.mjs` prints a fresh pair. Nothing here touches storage.
 */
import { bytesToHex, darePublicKeyId } from '@/community/liteDareProtocol';

const ALGORITHM = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const SIGN = { name: 'ECDSA', hash: 'SHA-256' } as const;

export interface SigningKey {
  key: CryptoKey;
  /** 8 lowercase hex: the first 4 bytes of sha256 of the uncompressed public key (the app derives the same id). */
  keyId: string;
}

let cached: { source: string; key: Promise<SigningKey | null> } | null = null;
let warned = false;

function base64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Uncompressed public point (04 || x || y) of a P-256 JWK, as hex. */
export function publicHexOfJwk(jwk: JsonWebKey): string {
  const x = base64urlToBytes(jwk.x ?? '');
  const y = base64urlToBytes(jwk.y ?? '');
  if (x.length !== 32 || y.length !== 32) throw new Error('bad P-256 coordinates');
  return `04${bytesToHex(x)}${bytesToHex(y)}`;
}

/**
 * Imports the private signing key from its JWK text, once per isolate, with its key id. Null when missing or
 * unusable (the routes then fail closed with 503).
 */
export function signingKey(jwkText: string | undefined): Promise<SigningKey | null> {
  if (!jwkText) return Promise.resolve(null);
  if (cached && cached.source === jwkText) return cached.key;
  const key = (async (): Promise<SigningKey | null> => {
    // A fixed reason per stage, never the error text: a JSON.parse message quotes part of its input (the secret).
    let reason = 'not valid JSON';
    try {
      const jwk = JSON.parse(jwkText) as JsonWebKey;
      reason = 'not an EC P-256 private key';
      if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !jwk.d) throw new Error(reason);
      const keyId = await darePublicKeyId(publicHexOfJwk(jwk));
      reason = 'the key did not import';
      const imported = await crypto.subtle.importKey('jwk', jwk, ALGORITHM, false, ['sign']);
      return { key: imported, keyId };
    } catch {
      if (!warned) {
        warned = true;
        console.warn(`[vande-community] DARE_SIGNING_KEY is not a usable P-256 private JWK (${reason}); verified dares are disabled.`);
      }
      return null;
    }
  })();
  cached = { source: jwkText, key };
  return key;
}

/** Signs UTF-8 text; returns the raw r||s signature as 128 lowercase hex characters. */
export async function signHex(key: CryptoKey, text: string): Promise<string> {
  const sig = await crypto.subtle.sign(SIGN, key, new TextEncoder().encode(text));
  return bytesToHex(new Uint8Array(sig));
}

/** Test hook: forget the cached key. */
export function __resetSigningKeyForTests(): void {
  cached = null;
  warned = false;
}
