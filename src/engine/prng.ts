/**
 * Deterministic pseudo-random numbers for the Sealed Six engine. FROZEN PRIMITIVE: replays of every engine version
 * depend on these exact sequences. `Sfc32` is the hot-path generator (one per ball, seeded by SHA-256 of a key such
 * as `seed|innings|ball`); the functional `createRng`/`rngFloat` API is kept for UI code that wants immutable state.
 */
import { sha256Words, utf8 } from './sha256';

/** sfc32 generator state (four uint32 words). */
export interface RngState {
  a: number;
  b: number;
  c: number;
  d: number;
}

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

/** Mutable sfc32 generator (Chris Doty-Humphrey's Small Fast Counting generator, 32-bit). */
export class Sfc32 {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(a: number, b: number, c: number, d: number) {
    this.a = a >>> 0;
    this.b = b >>> 0;
    this.c = c >>> 0;
    this.d = d >>> 0;
    for (let i = 0; i < 12; i++) this.nextU32();
  }

  /** Next uint32. */
  nextU32(): number {
    const t0 = (this.a + this.b) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.d = (this.d + 1) | 0;
    const t = (t0 + this.d) | 0;
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }

  /** Uniform float in [0, 1). */
  float(): number {
    return this.nextU32() / 4294967296;
  }

  /** Uniform integer in [lo, hi] (inclusive). */
  int(lo: number, hi: number): number {
    return lo + Math.floor(this.float() * (hi - lo + 1));
  }

  /** Uniform element of a non-empty array. */
  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.float() * items.length)];
  }

  /**
   * Approximately standard-normal draw (Irwin–Hall sum of four uniforms, rescaled). Uses only basic arithmetic so the
   * result is bit-identical on every JavaScript engine (Math.log/Math.cos are implementation-approximated).
   */
  normal(): number {
    const s = this.float() + this.float() + this.float() + this.float();
    return (s - 2) * 1.7320508075688772;
  }
}

/** A generator seeded from SHA-256 of `key` (the first four digest words). */
export function rngFromKey(key: string): Sfc32 {
  const w = sha256Words(utf8(key));
  return new Sfc32(w[0], w[1], w[2], w[3]);
}
