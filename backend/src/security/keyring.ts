/**
 * Symmetric keyrings from Worker secrets: "kid:base64url[,kid:base64url…]". The first entry signs or encrypts; every
 * entry verifies or decrypts, so a key can be rotated by prepending a new one and removing the old one later
 * (docs/SECURITY.md, "Key rotation"). Each entry must hold at least 32 random bytes. Malformed rings are refused
 * (null), which makes the routes that need them fail closed with 503.
 */
import { fromBase64Url, type Bytes } from './encoding';

export interface Keyring {
  active: { kid: string; material: Bytes };
  all: ReadonlyMap<string, Bytes>;
}

const cache = new Map<string, Keyring | null>();

export function parseKeyring(raw: string | undefined): Keyring | null {
  if (!raw) return null;
  if (cache.has(raw)) return cache.get(raw) ?? null;
  let ring: Keyring | null = null;
  const all = new Map<string, Bytes>();
  const entries = raw.split(',').map((s) => s.trim()).filter(Boolean);
  let ok = entries.length > 0 && entries.length <= 8;
  for (const entry of entries) {
    const m = /^([a-z0-9]{1,16}):([A-Za-z0-9_-]{43,})$/.exec(entry);
    const material = m ? fromBase64Url(m[2]) : null;
    if (!m || !material || material.length < 32 || all.has(m[1])) {
      ok = false;
      break;
    }
    all.set(m[1], material);
  }
  if (ok) {
    const [kid, material] = [...all.entries()][0];
    ring = { active: { kid, material }, all };
  }
  if (cache.size > 32) cache.clear();
  cache.set(raw, ring);
  return ring;
}
