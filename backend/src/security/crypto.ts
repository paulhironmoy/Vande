/**
 * WebCrypto helpers: randomness, hashing, HMAC, HKDF-derived purpose keys, AES-GCM envelopes and gzip.
 * Nothing here logs or stores key material; derived keys are cached per isolate (non-extractable CryptoKeys).
 */
import { bytes, concatBytes, fromBase64Url, fromUtf8, toBase32, toBase64Url, toHex, utf8, type Bytes } from './encoding';

export function randomBytes(n: number): Bytes {
  const out = bytes(n);
  crypto.getRandomValues(out);
  return out;
}

/** 128-bit random hex (32 characters): seeds, salts, nonces, token ids. */
export function randomHex(byteLength = 16): string {
  return toHex(randomBytes(byteLength));
}

/** Public, unguessable id: a one-letter kind prefix and 128 random bits in lowercase base32 (27 characters). */
export function randomId(prefix: string, byteLength = 16): string {
  return `${prefix}${toBase32(randomBytes(byteLength))}`;
}

export async function sha256(data: string | Uint8Array): Promise<Bytes> {
  const input = typeof data === 'string' ? utf8(data) : (data as Bytes);
  return new Uint8Array(await crypto.subtle.digest('SHA-256', input)) as Bytes;
}

export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  return toHex(await sha256(data));
}

/** Constant-time comparison of two byte arrays or strings (length is not hidden). */
export function timingSafeEqual(a: string | Uint8Array, b: string | Uint8Array): boolean {
  const x = typeof a === 'string' ? utf8(a) : a;
  const y = typeof b === 'string' ? utf8(b) : b;
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

// ---------------------------------------------------------------------------------------------------------------
// HKDF purpose keys
// ---------------------------------------------------------------------------------------------------------------

export type KeyPurpose = 'access' | 'ball' | 'invite' | 'export' | 'plan' | 'secret' | 'idempotency' | 'push' | 'identity' | 'daily' | 'highlight' | 'media' | 'upload' | 'render' | 'share';

const HKDF_SALT = utf8('vande-cricket/v1');
const ikmCache = new Map<string, Promise<CryptoKey>>();
const derivedCache = new Map<string, Promise<CryptoKey>>();
const MAX_DERIVED = 512;

function ikm(material: Bytes): Promise<CryptoKey> {
  const id = toBase64Url(material);
  let k = ikmCache.get(id);
  if (!k) {
    k = crypto.subtle.importKey('raw', material, 'HKDF', false, ['deriveKey']);
    ikmCache.set(id, k);
  }
  return k;
}

function remember(cacheKey: string, make: () => Promise<CryptoKey>): Promise<CryptoKey> {
  const hit = derivedCache.get(cacheKey);
  if (hit) return hit;
  if (derivedCache.size >= MAX_DERIVED) derivedCache.delete(derivedCache.keys().next().value as string);
  const p = make();
  derivedCache.set(cacheKey, p);
  p.catch(() => derivedCache.delete(cacheKey));
  return p;
}

/** HMAC-SHA256 key for one purpose, derived from a keyring entry. */
export function hmacKeyFor(material: Bytes, kid: string, purpose: KeyPurpose): Promise<CryptoKey> {
  return remember(`h|${kid}|${purpose}|${toBase64Url(material).slice(0, 12)}`, async () =>
    crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: HKDF_SALT, info: utf8(`hmac|${purpose}`) },
      await ikm(material),
      { name: 'HMAC', hash: 'SHA-256', length: 256 },
      false,
      ['sign', 'verify'],
    ),
  );
}

/** AES-256-GCM key for one purpose and context (for example one match), derived from a keyring entry. */
export function aesKeyFor(material: Bytes, kid: string, purpose: KeyPurpose, context: string): Promise<CryptoKey> {
  return remember(`a|${kid}|${purpose}|${context}|${toBase64Url(material).slice(0, 12)}`, async () =>
    crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: HKDF_SALT, info: utf8(`aes|${purpose}|${context}`) },
      await ikm(material),
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    ),
  );
}

export async function hmac(key: CryptoKey, data: string | Uint8Array): Promise<Bytes> {
  const input = typeof data === 'string' ? utf8(data) : (data as Bytes);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, input)) as Bytes;
}

// ---------------------------------------------------------------------------------------------------------------
// AES-GCM envelopes: "e1.<kid>.<iv>.<ciphertext>" (base64url). The AAD binds a ciphertext to where it belongs.
// ---------------------------------------------------------------------------------------------------------------

export interface DataKey {
  kid: string;
  material: Bytes;
}

export async function seal(key: DataKey, purpose: KeyPurpose, context: string, plaintext: string, aad: string): Promise<string> {
  const iv = randomBytes(12);
  const k = await aesKeyFor(key.material, key.kid, purpose, context);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: utf8(aad) }, k, utf8(plaintext));
  return `e1.${key.kid}.${toBase64Url(iv)}.${toBase64Url(ct)}`;
}

/** Decrypts an envelope with the keyring entry named in it; null when the key is gone or the data/AAD do not match. */
export async function open(keys: ReadonlyMap<string, Bytes>, purpose: KeyPurpose, context: string, envelope: string, aad: string): Promise<string | null> {
  const parts = envelope.split('.');
  if (parts.length !== 4 || parts[0] !== 'e1') return null;
  const material = keys.get(parts[1]);
  const iv = fromBase64Url(parts[2]);
  const ct = fromBase64Url(parts[3]);
  if (!material || !iv || iv.length !== 12 || !ct) return null;
  try {
    const k = await aesKeyFor(material, parts[1], purpose, context);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: utf8(aad) }, k, ct);
    return fromUtf8(new Uint8Array(pt));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// gzip (CompressionStream exists in Workers, browsers and Node 18+)
// ---------------------------------------------------------------------------------------------------------------

async function pipe(data: Uint8Array, transform: { readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array> }): Promise<Bytes> {
  const writer = transform.writable.getWriter();
  void writer.write(data as Bytes).then(() => writer.close()).catch(() => undefined);
  const reader = transform.readable.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return concatBytes(...chunks);
}

export function gzip(text: string): Promise<Bytes> {
  return pipe(utf8(text), new CompressionStream('gzip') as unknown as { readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array> });
}

export async function gunzip(data: Uint8Array): Promise<string> {
  return fromUtf8(await pipe(data, new DecompressionStream('gzip') as unknown as { readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array> }));
}
