/** Smooth noise and the breath wave. Pure functions of (seed, time): the same input always gives the same number. */
import { u01 } from './seeds';

const TAU = Math.PI * 2;

/** Quintic ease: zero first and second derivative at both ends (C2 noise). */
export const quint = (f: number): number => f * f * f * (f * (f * 6 - 15) + 10);

/** C2 value noise in [-1, 1] on an integer lattice hashed from (seed, i). */
export function vnoise(seed: number, x: number): number {
  const i = Math.floor(x);
  const a = u01(seed, i) * 2 - 1;
  const b = u01(seed, i + 1) * 2 - 1;
  return a + (b - a) * quint(x - i);
}

/**
 * Fractal noise: octaves with lattice spacings `spacing` (s) and amplitudes `amp`, so the strength falls with
 * frequency (about 1/f). `x0` offsets the lattice so two balls never share it. Not periodic.
 */
export function fractal(seed: number, tS: number, x0: number, spacing: readonly number[], amp: readonly number[]): number {
  let s = 0;
  for (let k = 0; k < spacing.length; k++) s += amp[k] * vnoise(seed + 977 * k, tS / spacing[k] + x0);
  return s;
}

/** One breath, unit amplitude, for a phase in cycles: the inhale (rising) is faster than the exhale when skew > 0. */
export function skewSin(cycles: number, skew: number): number {
  const a = TAU * cycles;
  return Math.sin(a + skew * Math.sin(a));
}
