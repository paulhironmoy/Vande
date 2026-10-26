/**
 * Byte encodings used by tokens, ids and ciphertexts. No dependencies; works in Workers, browsers and Node.
 * Every function returns `Uint8Array<ArrayBuffer>` so results can go straight into WebCrypto.
 */

export type Bytes = Uint8Array<ArrayBuffer>;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function utf8(text: string): Bytes {
  return encoder.encode(text) as Bytes;
}

export function fromUtf8(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}

export function bytes(n: number): Bytes {
  return new Uint8Array(new ArrayBuffer(n));
}

export function concatBytes(...parts: Uint8Array[]): Bytes {
  const out = bytes(parts.reduce((n, p) => n + p.byteLength, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.byteLength;
  }
  return out;
}

export function toHex(data: Uint8Array | ArrayBuffer): string {
  const view = data instanceof Uint8Array ? data : new Uint8Array(data);
  let out = '';
  for (let i = 0; i < view.length; i++) out += view[i].toString(16).padStart(2, '0');
  return out;
}

/** Lowercase or uppercase hex to bytes; null when malformed. */
export function fromHex(hex: string): Bytes | null {
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) return null;
  const out = bytes(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const B64URL_INDEX = new Map([...B64URL].map((c, i) => [c, i]));

/** RFC 4648 §5 base64url without padding. */
export function toBase64Url(data: Uint8Array | ArrayBuffer): string {
  const view = data instanceof Uint8Array ? data : new Uint8Array(data);
  let out = '';
  let i = 0;
  for (; i + 2 < view.length; i += 3) {
    const n = (view[i] << 16) | (view[i + 1] << 8) | view[i + 2];
    out += B64URL[(n >> 18) & 63] + B64URL[(n >> 12) & 63] + B64URL[(n >> 6) & 63] + B64URL[n & 63];
  }
  if (i < view.length) {
    const rest = view.length - i;
    const n = (view[i] << 16) | (rest === 2 ? view[i + 1] << 8 : 0);
    out += B64URL[(n >> 18) & 63] + B64URL[(n >> 12) & 63];
    if (rest === 2) out += B64URL[(n >> 6) & 63];
  }
  return out;
}

/** base64url (padding and standard base64 characters tolerated) to bytes; null when malformed. */
export function fromBase64Url(text: string): Bytes | null {
  const s = text.replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  if (s.length % 4 === 1) return null;
  const out = bytes(Math.floor((s.length * 3) / 4));
  let bits = 0;
  let value = 0;
  let o = 0;
  for (const ch of s) {
    const v = B64URL_INDEX.get(ch);
    if (v === undefined) return null;
    value = (value << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (value >> bits) & 255;
    }
  }
  return out;
}

const B32 = 'abcdefghijklmnopqrstuvwxyz234567';
const B32_INDEX = new Map([...B32].map((c, i) => [c, i]));

/** RFC 4648 base32, lowercase, no padding (16 bytes → 26 characters). Used for public ids. */
export function toBase32(data: Uint8Array): string {
  let out = '';
  let bits = 0;
  let value = 0;
  for (const b of data) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += B32[(value >> bits) & 31];
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function fromBase32(text: string, expectedBytes: number): Bytes | null {
  const out = bytes(expectedBytes);
  let bits = 0;
  let value = 0;
  let o = 0;
  for (const ch of text) {
    const v = B32_INDEX.get(ch);
    if (v === undefined) return null;
    value = (value << 5) | v;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      if (o >= expectedBytes) return null;
      out[o++] = (value >> bits) & 255;
    }
  }
  return o === expectedBytes ? out : null;
}

/** Crockford base32 alphabet (no I, L, O, U) for human-typed codes such as group invite codes. */
export const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Normalises a typed Crockford code: uppercase, separators removed, I/L→1 and O→0. Null when invalid. */
export function normaliseCrockford(input: string): string | null {
  const s = input.toUpperCase().replace(/[\s\-_.]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0');
  if (!s || [...s].some((c) => !CROCKFORD.includes(c))) return null;
  return s;
}
