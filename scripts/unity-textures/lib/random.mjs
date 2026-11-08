/**
 * Deterministic randomness for the VANDE procedural Unity textures. Integer-only hashing (Math.imul), so a seed gives
 * the same stream on every JavaScript engine. No Math.random anywhere in scripts/unity-textures.
 */

/** FNV-1a 32-bit hash of a string; used to turn a texture seed name into an integer seed. */
export function hashString(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Mulberry32 stream: returns a function giving uniform numbers in [0, 1). */
export function stream(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stateless hash of up to three integers and a seed, uniform in [0, 1). */
export function hash3(x, y, z, seed) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(z | 0, 0x1b873593) ^
    Math.imul(seed | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Pick an entry from [[weight, value], ...] with a uniform number r in [0, 1). */
export function weighted(entries, r) {
  let total = 0;
  for (const [w] of entries) total += w;
  let x = r * total;
  for (const [w, value] of entries) {
    if (x < w) return value;
    x -= w;
  }
  return entries[entries.length - 1][1];
}
