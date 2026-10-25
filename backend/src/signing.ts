/**
 * ECDSA P-256 / SHA-256 signing for verified dares (WebCrypto, no dependencies).
 *
 * The private key lives only in the Worker secret DARE_SIGNING_KEY as a JWK (JSON). The matching public key is
 * built into the app as VITE_DARE_PUBLIC_KEY (uncompressed point, hex) and checks signatures offline.
 * `scripts/lite-dare-keys.mjs` prints a fresh pair and the commands to install it. Nothing here touches storage.
 */
import { bytesToHex } from '@/community/liteDareProtocol';

const ALGORITHM = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const SIGN = { name: 'ECDSA', hash: 'SHA-256' } as const;

let cached: { source: string; key: Promise<CryptoKey | null> } | null = null;
let warned = false;

/**
 * Imports the private signing key from its JWK text, once per isolate. Null when missing or unusable (the routes
 * then fail closed with 503).
 */
export function signingKey(jwkText: string | undefined): Promise<CryptoKey | null> {
  if (!jwkText) return Promise.resolve(null);
  if (cached && cached.source === jwkText) return cached.key;
  const key = (async () => {
    try {
      const jwk = JSON.parse(jwkText) as JsonWebKey;
      if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !jwk.d) throw new Error('not an EC P-256 private key');
      return await crypto.subtle.importKey('jwk', jwk, ALGORITHM, false, ['sign']);
    } catch (e) {
      if (!warned) {
        warned = true;
        console.warn(`[vande-community] DARE_SIGNING_KEY is not a usable P-256 private JWK (${e instanceof Error ? e.message : 'unknown error'}); verified dares are disabled.`);
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
