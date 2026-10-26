/**
 * Signed requests to the Worker's render API (backend/src/highlights/render.ts verifies them):
 *
 *   x-vc-key, x-vc-ts (unix ms), x-vc-nonce, x-vc-body-sha256 (hex), x-vc-sig = base64url(HMAC-SHA256(K, canonical))
 *   canonical = METHOD \n path \n ts \n nonce \n body-sha256
 *   K = HKDF-SHA256(the RENDER_KEYS entry's bytes, salt "vande-cricket/v1", info "hmac|render")
 *
 * The key arrives as RENDER_KEY="<kid>:<base64url ≥ 32 bytes>" (a Cloud Run secret, the same entry as the Worker's
 * RENDER_KEYS). WebCrypto only (Node 22+), no dependencies.
 */

export interface RenderKey {
  kid: string;
  material: Uint8Array;
}

const enc = new TextEncoder();

export function parseRenderKey(raw: string | undefined): RenderKey {
  const m = /^([a-z0-9]{1,16}):([A-Za-z0-9_-]{43,})$/.exec((raw ?? '').trim());
  if (!m) throw new Error('RENDER_KEY must be "<kid>:<base64url of at least 32 bytes>"');
  const material = fromBase64Url(m[2]);
  if (material.length < 32) throw new Error('RENDER_KEY must hold at least 32 bytes');
  return { kid: m[1], material };
}

export function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

export function toBase64Url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === 'string' ? enc.encode(data) : data;
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>));
  return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('');
}

const keyCache = new Map<string, Promise<CryptoKey>>();

function hmacKey(key: RenderKey): Promise<CryptoKey> {
  const id = `${key.kid}|${toBase64Url(key.material)}`;
  let k = keyCache.get(id);
  if (!k) {
    k = crypto.subtle
      .importKey('raw', key.material as Uint8Array<ArrayBuffer>, 'HKDF', false, ['deriveKey'])
      .then((ikm) =>
        crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: enc.encode('vande-cricket/v1'), info: enc.encode('hmac|render') }, ikm, { name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign']),
      );
    keyCache.set(id, k);
  }
  return k;
}

export function canonical(method: string, path: string, ts: string, nonce: string, bodySha256: string): string {
  return `${method.toUpperCase()}\n${path}\n${ts}\n${nonce}\n${bodySha256}`;
}

/** The headers of one signed request (a fresh nonce every time). */
export async function signRequest(key: RenderKey, method: string, path: string, bodySha256: string, nowMs = Date.now(), nonce: string = crypto.randomUUID()): Promise<Record<string, string>> {
  const ts = String(Math.floor(nowMs));
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(key), enc.encode(canonical(method, path, ts, nonce, bodySha256))));
  return { 'x-vc-key': key.kid, 'x-vc-ts': ts, 'x-vc-nonce': nonce, 'x-vc-body-sha256': bodySha256, 'x-vc-sig': toBase64Url(sig) };
}
