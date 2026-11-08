/**
 * Seeds and draws for the Director. Pure: no clock, no Math.random.
 *
 * The keys are the ones the sound takes already use, the same in the web and in Unity (src/audio/takes.ts,
 * ProductionRecordedTakes.cs): `deliveryTakeKey` names the delivery and `fnv1a32` hashes strings. The draws are
 * splitmix32 in its stateless form: `mix(seed, k)` is output k (from 0) of the sequential generator `splitmix` in
 * src/engine/prng.ts (same increment 0x9e3779b9 and the same two multipliers), so any draw is reachable without
 * running the ones before it, and a draw never depends on how many other draws a plan took.
 */
import { deliveryTakeKey, fnv1a32 } from '@/audio/takes';

export { deliveryTakeKey, fnv1a32 };

/** Output `k` of splitmix32 seeded with `seed`: a uint32. */
export function mix(seed: number, k: number): number {
  let z = (seed + Math.imul(k + 1, 0x9e3779b9)) >>> 0;
  z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
  z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
  return (z ^ (z >>> 16)) >>> 0;
}

/** Draw `k` of `seed` as a number in [0, 1). */
export const u01 = (seed: number, k: number): number => mix(seed, k) / 4294967296;

/** Draw `k` of `seed` in [lo, hi). */
export const range = (seed: number, k: number, lo: number, hi: number): number => lo + (hi - lo) * u01(seed, k);

/** An approximately normal draw (Irwin-Hall of three, unit variance, bounded to +-3): uses draws 3k .. 3k + 2. */
export const gauss = (seed: number, k: number): number =>
  (u01(seed, 3 * k) + u01(seed, 3 * k + 1) + u01(seed, 3 * k + 2) - 1.5) * 2;

/** A log-normal draw with the given mean and coefficient of variation (z is a unit-normal draw). */
export function lognorm(mean: number, cv: number, z: number): number {
  const s2 = Math.log(1 + cv * cv);
  return Math.exp(Math.log(mean) - s2 / 2 + Math.sqrt(s2) * z);
}

/** The person's key: constant for the over (the actor's look seed) and the role. */
export const personKey = (lookSeed: string, role: string): number => fnv1a32(`life|person|${lookSeed}|${role}`);

/** The key of one person in one delivery: a replay of the same delivery gives the same key. */
export const ballKey = (deliveryKey: string, person: number): number => fnv1a32(`${deliveryKey}|life|${person}`);
