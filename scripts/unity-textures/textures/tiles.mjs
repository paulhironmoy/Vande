/**
 * Tileable ground and bat albedos: balanced pitch, outfield grass and English willow. Each is drawn at twice the
 * output size, box-filtered down in linear light, then remapped to the per-channel mean and spread of the bitmap it
 * replaces (the Unity materials' tints were calibrated against those averages; see ProductionCricketEnvironment.cs).
 */
import { fbm, gradientNoise, lerp, smoothstep } from '../lib/noise.mjs';
import { createImage, downsample, matchMeanAndLumaStd } from '../lib/image.mjs';
import { hash3, hashString, stream } from '../lib/random.mjs';

/**
 * Balanced pitch. Unity maps one tile over the whole strip: u = x / 3.05 m (width), v = z / 20.12 m (length), so a
 * texel is 6.0 mm across and 39.3 mm along. Features here are isotropic in metres (they are drawn 6.6x shorter along
 * the image's vertical axis) so the pitch does not look stretched along its length in the game.
 */
export function pitch({ size = 512, seed = 'vande-pitch-balanced-v1', target }) {
  const s = hashString(seed);
  const n1 = gradientNoise(s);
  const n2 = gradientNoise(s + 1);
  const n3 = gradientNoise(s + 2);
  const ss = 2;
  const W = size * ss;
  const img = createImage(W, W);
  const widthM = 3.05;
  const lengthM = 20.12;
  // Integer periods per tile for cell sizes in metres (isotropic on the ground, so the tile tiles exactly).
  const per = (cell) => [Math.round(widthM / cell), Math.round(lengthM / cell)];
  const [mx, my] = per(0.6);
  const [sx, sy] = per(0.07);
  const [gx, gy] = per(0.25);
  const [fx, fy] = per(0.03);
  for (let y = 0; y < W; y += 1) {
    const ty = (y + 0.5) / W;
    for (let x = 0; x < W; x += 1) {
      const tx = (x + 0.5) / W;
      const mottle = fbm(n1, tx * mx, ty * my, mx, my, 4, 0.55);
      const soil = fbm(n2, tx * sx, ty * sy, sx, sy, 2, 0.5);
      const sprig = n3(tx * fx + 3.7, ty * fy + 1.9, fx, fy);
      const grassField = fbm(n3, tx * gx + 17.3, ty * gy + 5.1, gx, gy, 3, 0.55);
      const grain = hash3(x, y, 13, s) - 0.5;
      // Compacted clay: luminance-led variation; slightly redder where the mottling is darker (moisture).
      const L = 1 + 0.06 * mottle + 0.07 * soil + 0.05 * grain;
      const warm = 0.03 * Math.max(0, -mottle);
      let r = 0.72 * L * (1 + warm * 0.4);
      let g = 0.585 * L * (1 - warm * 0.2);
      let b = 0.385 * L * (1 - warm * 0.6);
      // Sparse dry grass sprigs: straw-olive, desaturated, in small clumps inside thin patches.
      const cover = smoothstep(0.05, 0.3, grassField) * smoothstep(0.15, 0.55, sprig);
      const straw = [0.62, 0.59, 0.4];
      r = lerp(r, straw[0] * L, cover * 0.6);
      g = lerp(g, straw[1] * L, cover * 0.6);
      b = lerp(b, straw[2] * L, cover * 0.6);
      const p = (y * W + x) * 3;
      img.data[p] = r;
      img.data[p + 1] = g;
      img.data[p + 2] = b;
    }
  }
  const out = downsample(img, ss);
  if (target) matchMeanAndLumaStd(out, target.mean, target.lumaStd);
  return out;
}

/**
 * Outfield grass. Unity tiles it every 2.38 m (0.42 per metre), so a texel is 4.6 mm: blades are about one texel
 * wide. Thousands of short blade strokes with a gentle mowing lay over a dark thatch; only weak low-frequency
 * variation, so the 2.38 m repeat does not form a visible grid (the mowing stripes come from the field geometry).
 */
export function grass({ size = 512, seed = 'vande-outfield-grass-v1', target }) {
  const s = hashString(seed);
  const rand = stream(s);
  const n1 = gradientNoise(s + 5);
  const ss = 2;
  const W = size * ss;
  const img = createImage(W, W);
  const d = img.data;
  // Thatch and soil between blades.
  for (let y = 0; y < W; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const v = fbm(n1, (x / W) * 8, (y / W) * 8, 8, 8, 4, 0.55);
      const p = (y * W + x) * 3;
      d[p] = 0.13 + 0.03 * v;
      d[p + 1] = 0.2 + 0.04 * v;
      d[p + 2] = 0.06 + 0.015 * v;
    }
  }
  const lay = 1.05; // radians: the mowing lay direction
  const blades = Math.round(W * W * 0.21);
  for (let i = 0; i < blades; i += 1) {
    const x0 = rand() * W;
    const y0 = rand() * W;
    const spread = (rand() + rand() + rand() - 1.5) * 1.3;
    const angle = (rand() < 0.75 ? lay : lay + Math.PI * 0.5) + spread;
    const len = (4 + rand() * 9) * ss * 0.5 * 2;
    const width = (0.55 + rand() * 0.45) * ss;
    // Blade colour: a spread of greens; some yellowed tips, a few dark under-blades.
    const kind = rand();
    let r;
    let g;
    let b;
    if (kind < 0.12) {
      r = 0.12; g = 0.26; b = 0.05;
    } else if (kind < 0.86) {
      const t = rand();
      r = lerp(0.2, 0.36, t); g = lerp(0.42, 0.62, t); b = lerp(0.08, 0.14, t);
    } else {
      const t = rand();
      r = lerp(0.42, 0.56, t); g = lerp(0.58, 0.66, t); b = lerp(0.16, 0.24, t);
    }
    const shade = 0.82 + 0.3 * rand();
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const steps = Math.ceil(len * 1.5);
    for (let k = 0; k <= steps; k += 1) {
      const t = k / steps;
      const taper = 1 - 0.6 * t;
      const cxp = x0 + dx * len * t;
      const cyp = y0 + dy * len * t;
      const rad = (width * taper) / 2;
      const tipLight = 1 + 0.25 * t;
      for (let oy = Math.floor(cyp - rad - 1); oy <= Math.ceil(cyp + rad + 1); oy += 1) {
        for (let ox = Math.floor(cxp - rad - 1); ox <= Math.ceil(cxp + rad + 1); ox += 1) {
          const dist = Math.hypot(ox + 0.5 - cxp, oy + 0.5 - cyp);
          const cover = Math.min(1, Math.max(0, rad + 0.5 - dist));
          if (cover <= 0) continue;
          const wx = ((ox % W) + W) % W;
          const wy = ((oy % W) + W) % W;
          const p = (wy * W + wx) * 3;
          d[p] = lerp(d[p], r * shade * tipLight, cover);
          d[p + 1] = lerp(d[p + 1], g * shade * tipLight, cover);
          d[p + 2] = lerp(d[p + 2], b * shade * tipLight, cover);
        }
      }
    }
  }
  // Weak patchiness, one or two cycles per tile only.
  for (let y = 0; y < W; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const v = fbm(n1, (x / W) * 2 + 31.7, (y / W) * 2 + 3.3, 2, 2, 2, 0.5);
      const p = (y * W + x) * 3;
      const k = 1 + 0.035 * v;
      d[p] *= k;
      d[p + 1] *= k;
      d[p + 2] *= k;
    }
  }
  const out = downsample(img, ss);
  if (target) matchMeanAndLumaStd(out, target.mean, target.lumaStd);
  return out;
}

/**
 * English willow face. The bat mesh's UVs are its local (x, z) in metres at tiling 1, so the blade face samples a
 * row of this image and the grain runs along the bat: the grain is drawn as near-vertical lines in the image, as in
 * the bitmap it replaces. Growth lines are 3-9 mm apart (1.5-4.5 texels at 2 mm per texel), with slight waviness,
 * faint fibre streaks and rare pin knots.
 */
export function willow({ size = 512, seed = 'vande-willow-v1', target }) {
  const s = hashString(seed);
  const rand = stream(s);
  const n1 = gradientNoise(s + 9);
  const n2 = gradientNoise(s + 10);
  const ss = 2;
  const W = size * ss;
  // Line positions across one tile, normalised so the spacing wraps exactly.
  const gaps = [];
  let total = 0;
  while (total < size) {
    const g = 1.6 + rand() * 3.4 + (rand() < 0.08 ? rand() * 4 : 0);
    gaps.push(g);
    total += g;
  }
  const scale = size / total;
  const lines = [];
  let pos = 0;
  for (const g of gaps) {
    pos += g * scale;
    lines.push({
      x: (pos / size) * W,
      dark: 0.05 + rand() * 0.11,
      width: (0.45 + rand() * 0.9) * ss,
      phase: rand() * 8,
    });
  }
  const img = createImage(W, W);
  const d = img.data;
  const lineRow = new Float32Array(W);
  for (let y = 0; y < W; y += 1) {
    const ty = y / W;
    // Gentle waviness of the whole grain plus a small per-line wander, both periodic in y.
    const warp = 3.2 * ss * fbm(n1, 0.5, ty * 3, 4, 3, 3, 0.5);
    lineRow.fill(0);
    for (const l of lines) {
      const centre = l.x - warp + 1.2 * ss * n2(l.phase, ty * 6, 64, 6);
      const reach = Math.ceil(l.width) + 1;
      for (let ox = Math.floor(centre) - reach; ox <= Math.ceil(centre) + reach; ox += 1) {
        const a = Math.abs(ox + 0.5 - centre);
        const v = l.dark * Math.max(0, 1 - a / l.width);
        if (v <= 0) continue;
        const wx = ((ox % W) + W) % W;
        if (v > lineRow[wx]) lineRow[wx] = v;
      }
    }
    for (let x = 0; x < W; x += 1) {
      const tx = x / W;
      const line = lineRow[x];
      // Long fibre streaks: fine across, long along the grain.
      const fibre = fbm(n2, tx * 256 + 3.1, ty * 4, 256, 4, 2, 0.5);
      const fleck = fbm(n1, tx * 96 + 9.7, ty * 24, 96, 24, 2, 0.5);
      // Broad tonal bands across the face (about 4-8 cm), slightly warmer where darker.
      const band = fbm(n1, ((x + warp) / W) * 14 + 0.37, 0.5, 14, 1 << 20, 3, 0.55);
      const bandL = 0.045 * band;
      let r = 0.955 - line * 0.55 + 0.006 * fibre + bandL * 0.6;
      let g = 0.83 - line * 0.95 + 0.012 * fibre + 0.006 * fleck + bandL * 1.0;
      let b = 0.64 - line * 1.35 + 0.02 * fibre + 0.01 * fleck + bandL * 1.5;
      // Rare pin knots: tiny dark oval specks.
      const kh = hash3(x >> 4, y >> 5, 21, s);
      if (kh > 0.9975) {
        const kx = ((x >> 4) << 4) + 8;
        const ky = ((y >> 5) << 5) + 16;
        const e = ((x - kx) / 2.2) ** 2 + ((y - ky) / 5) ** 2;
        if (e < 1) {
          r -= 0.05 * (1 - e);
          g -= 0.11 * (1 - e);
          b -= 0.16 * (1 - e);
        }
      }
      const p = (y * W + x) * 3;
      d[p] = r;
      d[p + 1] = g;
      d[p + 2] = b;
    }
  }
  const out = downsample(img, ss);
  if (target) matchMeanAndLumaStd(out, target.mean, target.lumaStd);
  return out;
}
