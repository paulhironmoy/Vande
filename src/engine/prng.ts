import type { RngState } from './types';

/** cyrb53-derived string hash folded to a uint32. Deterministic across platforms. */
export function hashString(input: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return ((h1 >>> 0) ^ (h2 >>> 0)) >>> 0;
}

function splitmix(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  };
}

function step(r: RngState): { value: number; next: RngState } {
  let a = r.a >>> 0;
  let b = r.b >>> 0;
  let c = r.c >>> 0;
  let d = r.d >>> 0;
  let t = (a + b) | 0;
  a = b ^ (b >>> 9);
  b = (c + (c << 3)) | 0;
  c = (c << 21) | (c >>> 11);
  d = (d + 1) | 0;
  t = (t + d) | 0;
  c = (c + t) | 0;
  return { value: t >>> 0, next: { a: a >>> 0, b: b >>> 0, c: c >>> 0, d: d >>> 0 } };
}

/** sfc32 generator seeded from a uint32 via splitmix expansion. Serialisable state. */
export function createRng(seed: number): RngState {
  const gen = splitmix(seed >>> 0);
  let state: RngState = { a: gen(), b: gen(), c: gen(), d: gen() };
  for (let i = 0; i < 12; i++) state = step(state).next;
  return state;
}

/** Uniform float in [0, 1). */
export function rngFloat(r: RngState): { value: number; next: RngState } {
  const s = step(r);
  return { value: s.value / 4294967296, next: s.next };
}

/** Uniform integer in [minInclusive, maxInclusive]. */
export function rngInt(r: RngState, minInclusive: number, maxInclusive: number): { value: number; next: RngState } {
  const lo = Math.ceil(Math.min(minInclusive, maxInclusive));
  const hi = Math.floor(Math.max(minInclusive, maxInclusive));
  const f = rngFloat(r);
  return { value: lo + Math.floor(f.value * (hi - lo + 1)), next: f.next };
}

/** Non-deterministic seed for new games. UI only — never used inside the simulation. */
export function newSeed(): number {
  const g = globalThis as { crypto?: { getRandomValues?: (a: Uint32Array) => Uint32Array } };
  if (g.crypto?.getRandomValues) {
    const buf = new Uint32Array(1);
    g.crypto.getRandomValues(buf);
    return buf[0] >>> 0;
  }
  return Math.floor(Math.random() * 4294967296) >>> 0;
}
