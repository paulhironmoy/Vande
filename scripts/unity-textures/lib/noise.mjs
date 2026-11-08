/**
 * Periodic gradient (Perlin-style) noise, fractal sums and cellular noise. Every function that takes a period wraps
 * exactly at that period (in lattice cells), so textures built from it tile seamlessly.
 */
import { hash3 } from './random.mjs';

const TABLE = 256;

function fade(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function mod(a, n) {
  const r = a % n;
  return r < 0 ? r + n : r;
}

/** Gradient-noise source for one seed. noise(x, y, px, py) is in about [-1, 1] and wraps every (px, py) cells. */
export function gradientNoise(seed) {
  const gx = new Float64Array(TABLE);
  const gy = new Float64Array(TABLE);
  for (let i = 0; i < TABLE; i += 1) {
    // Evenly spaced directions, shuffled by the hash: no transcendental drift between engines matters here because
    // the table is built once from the same angles in the same order.
    const a = (i / TABLE) * Math.PI * 2;
    gx[i] = Math.cos(a);
    gy[i] = Math.sin(a);
  }
  const index = (ix, iy) => Math.floor(hash3(ix, iy, 0, seed) * TABLE);
  return function noise(x, y, px = 1 << 20, py = 1 << 20) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const x0 = mod(xi, px);
    const x1 = mod(xi + 1, px);
    const y0 = mod(yi, py);
    const y1 = mod(yi + 1, py);
    const g00 = index(x0, y0);
    const g10 = index(x1, y0);
    const g01 = index(x0, y1);
    const g11 = index(x1, y1);
    const n00 = gx[g00] * xf + gy[g00] * yf;
    const n10 = gx[g10] * (xf - 1) + gy[g10] * yf;
    const n01 = gx[g01] * xf + gy[g01] * (yf - 1);
    const n11 = gx[g11] * (xf - 1) + gy[g11] * (yf - 1);
    const u = fade(xf);
    const v = fade(yf);
    const a = n00 + (n10 - n00) * u;
    const b = n01 + (n11 - n01) * u;
    return (a + (b - a) * v) * 1.41421356;
  };
}

/**
 * Fractal sum of `octaves` gradient-noise layers. (x, y) are in base cells; the base period is (px, py) cells and
 * doubles with each octave, so the sum still wraps at (px, py) base cells.
 */
export function fbm(noise, x, y, px, py, octaves, gain = 0.5) {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let f = 1;
  for (let o = 0; o < octaves; o += 1) {
    sum += amp * noise(x * f, y * f, px * f, py * f);
    norm += amp;
    amp *= gain;
    f *= 2;
  }
  return sum / norm;
}

/**
 * Periodic cellular (Worley) noise: returns [f1, f2, cellHash] for the nearest and second-nearest jittered feature
 * points, in cell units. Wraps every (px, py) cells.
 */
export function cellular(seed) {
  return function cell(x, y, px, py) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    let f1 = 9;
    let f2 = 9;
    let id = 0;
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const cx = xi + dx;
        const cy = yi + dy;
        const wx = mod(cx, px);
        const wy = mod(cy, py);
        const fx = cx + hash3(wx, wy, 1, seed);
        const fy = cy + hash3(wx, wy, 2, seed);
        const d = Math.hypot(fx - x, fy - y);
        if (d < f1) {
          f2 = f1;
          f1 = d;
          id = hash3(wx, wy, 3, seed);
        } else if (d < f2) {
          f2 = d;
        }
      }
    }
    return [f1, f2, id];
  };
}

export function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export function clamp01(x) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}
