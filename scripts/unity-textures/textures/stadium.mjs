/**
 * Daylight stadium plate behind the bowler, rendered from original geometry (no photograph, no generated bitmap).
 *
 * How the plate is used (ProductionCricketEnvironment.BuildStadiumBackdrop, VandeStadiumBackdrop.shader): an
 * inward-facing arc of radius 64.8 m round the pitch centre, 112 m / (2172 / 724) = 37.33 m tall, centred 9.2 m up,
 * spanning +-atan(56 / 64.8) of azimuth, unlit, depth-tested, with a red-ball cutout over the physical sight screen
 * and a 14% see-through band for the causal 3D crowd. Texel (i, j) is therefore a known world point on that arc.
 *
 * This renderer casts a ray from the live rear-shoulder eye (centred, 1.68 m up, 13.35 m behind the pitch centre:
 * ProceduralPracticeWorld.BatterCameraPosition with the lateral offset removed so both handednesses share it) through
 * that point, and shades what lies beyond it in the game's own stadium layout (the same radii and heights the 3D
 * world builds): the 69.4 m fascia, the lower tier (70-89 m, 1.2-10.5 m), a concourse, the upper tier (92-109 m,
 * 13.5-27 m), the pavilion block behind the bowler's end (x +-28 m, front at z = -81 m, 15 m with a 22 m media box),
 * the floodlight towers at 145 and 215 degrees (114 m), and the day sky dome's own colours. Seated spectators are
 * drawn per seat with a depth test. Light is the Day sun of the web stage and UNITY's SunKey(58, 54) (azimuth 58 deg
 * from +z towards +x, elevation 54 deg: high, off side, behind the batter), the roof's sun shadow on the upper tier,
 * and the Day tri-colour ambient.
 *
 * Practice boards are neutral: there is no text, logo, flag, banner or advertising anywhere in the plate. The sight
 * screen is a plain matte near-black panel painted exactly over the cutout rectangle the C# derives
 * (StadiumBackdropScreenUvBounds), matching the physical white-ball screen colour (0.035, 0.043, 0.072).
 */
import { clamp01, fbm, gradientNoise, lerp, smoothstep } from '../lib/noise.mjs';
import { createImage, downsample } from '../lib/image.mjs';
import { hash3, hashString, weighted } from '../lib/random.mjs';

// ---- Geometry shared with the Unity C# (CricketEnvironmentDimensions) ----
export const PLATE = {
  radius: 62 + 2.8,
  widthM: 112,
  aspect: 2172 / 724,
  centreY: 9.2,
};
PLATE.heightM = PLATE.widthM / PLATE.aspect;
PLATE.halfAngle = Math.atan((PLATE.widthM * 0.5) / PLATE.radius);

export const SIGHT_SCREEN = { width: 18, height: 7.5, colour: [0.035, 0.043, 0.072] };

/** The red-ball cutout rectangle, computed exactly as StadiumBackdropScreenUvBounds() does: [u0, u1, v0, v1]. */
export function screenUvBounds() {
  const bottom = PLATE.centreY - PLATE.heightM * 0.5;
  const halfScreenAngle = Math.atan((SIGHT_SCREEN.width * 0.5) / PLATE.radius);
  const halfScreenUv = (0.5 * halfScreenAngle) / PLATE.halfAngle;
  return [0.5 - halfScreenUv, 0.5 + halfScreenUv, -bottom / PLATE.heightM, (SIGHT_SCREEN.height - bottom) / PLATE.heightM];
}

const EYE = [0, 1.68, 13.35];
const DEG = Math.PI / 180;

const LOWER = { r0: 70, r1: 89, y0: 1.2, y1: 10.5, rows: 24 };
const UPPER = { r0: 92, r1: 109, y0: 13.5, y1: 27, rows: 21 };
const FASCIA_R = 62 + 7.4;
const LOWER_GAP = Math.atan2(18 * 0.5 + 1.5, 62 + 6.5); // the 3D tiers' end gap round the sight screens
// The upper tier starts at the same end gap as the 3D world builds it (it rises behind the pavilion), so the
// shader's 14% crowd-band reveal shows matching 3D structure rather than sky.
const UPPER_GAP = LOWER_GAP;
const ROOF = { r0: 95, r1: 111, yFront: 30.5, yBack: 33.0, fasciaTop: 31.6, end: 36 * DEG };
const PAVILION = { x: 28, zFront: -81, zBack: -95, top: 15, boxX: 7.5, boxFront: -82.5, boxBack: -94.5, boxTop: 22 };
const TOWERS = [145, 215].map((a) => [Math.sin(a * DEG) * 114, Math.cos(a * DEG) * 114]);
const TOWER_R = 0.72;

// ---- Day light: towardSun for SunKey(58, 54), the web convention (sin az cos el, sin el, cos az cos el) ----
const SUN_AZ_DEG = 58;
const SUN_EL_DEG = 54;
const SUN = [
  Math.sin(SUN_AZ_DEG * DEG) * Math.cos(SUN_EL_DEG * DEG),
  Math.sin(SUN_EL_DEG * DEG),
  Math.cos(SUN_AZ_DEG * DEG) * Math.cos(SUN_EL_DEG * DEG),
];
const SUN_COL = [1.0, 0.94, 0.84];
// Plate ambient: the Day look's sky term, a more neutral horizon term and a warm bounce from the sunlit outfield
// (the far stands face the field and have the sun behind them).
const AMB_SKY = [0.74, 0.82, 0.93];
const AMB_EQ = [0.56, 0.6, 0.63];
const AMB_GROUND = [0.44, 0.43, 0.34];
const DOME = { zenith: [0.18, 0.43, 0.78], middle: [0.43, 0.65, 0.86], horizon: [0.76, 0.86, 0.94] };
const DOME_RINGS = [-8, 10, 30, 52, 72, 86];
const BACKDROP_TINT = [0.94, 0.95, 0.96];

function domeColourAt(elevDeg) {
  // ProductionEnvironmentAtmosphere.SkyColour at each ring, interpolated linearly between rings like vertex colours.
  const ring = (e) => {
    const e01 = Math.min(1, Math.max(0, (e + 8) / 98));
    const ss = (t) => t * t * (3 - 2 * t);
    if (e01 < 0.48) return mixc(DOME.horizon, DOME.middle, ss(e01 / 0.48));
    return mixc(DOME.middle, DOME.zenith, ss((e01 - 0.48) / 0.52));
  };
  const e = Math.min(90, Math.max(-8, elevDeg));
  for (let i = 0; i < DOME_RINGS.length - 1; i += 1) {
    if (e <= DOME_RINGS[i + 1]) {
      const t = (e - DOME_RINGS[i]) / (DOME_RINGS[i + 1] - DOME_RINGS[i]);
      return mixc(ring(DOME_RINGS[i]), ring(DOME_RINGS[i + 1]), t);
    }
  }
  return mixc(ring(86), DOME.zenith, (e - 86) / 4);
}

function mixc(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Lambert with the Day key light plus the tri-colour ambient; returns the light colour for normal n. */
function lightFor(n, shadow = 1, ambientScale = 1) {
  const ny = n[1];
  const amb = ny >= 0 ? mixc(AMB_EQ, AMB_SKY, ny) : mixc(AMB_EQ, AMB_GROUND, -ny);
  const ndl = Math.max(0, n[0] * SUN[0] + n[1] * SUN[1] + n[2] * SUN[2]) * shadow;
  const a = 1.08 * ambientScale;
  const s = 0.9;
  return [amb[0] * a + SUN_COL[0] * ndl * s, amb[1] * a + SUN_COL[1] * ndl * s, amb[2] * a + SUN_COL[2] * ndl * s];
}

/** 1 if the sun reaches p, 0 if the upper-tier roof (95-111 m, about 31.75 m up) is in the way. */
function roofSun(p) {
  const t = (31.75 - p[1]) / SUN[1];
  if (t <= 0) return 1;
  const x = p[0] + SUN[0] * t;
  const z = p[2] + SUN[2] * t;
  const r = Math.hypot(x, z);
  const a = Math.abs(Math.atan2(x, -z));
  return r >= ROOF.r0 && r <= ROOF.r1 && a >= UPPER_GAP && a <= ROOF.end ? 0 : 1;
}

function shade(albedo, n, shadow, ambientScale) {
  const l = lightFor(n, shadow, ambientScale);
  return [albedo[0] * l[0], albedo[1] * l[1], albedo[2] * l[2]];
}

/** Plate texel centre (u, v) -> world point on the arc. */
export function platePoint(u, v) {
  const theta = (u - 0.5) * 2 * PLATE.halfAngle;
  return [PLATE.radius * Math.sin(theta), PLATE.centreY + (v - 0.5) * PLATE.heightM, -PLATE.radius * Math.cos(theta)];
}

/** World point -> plate (u, v) along the ray from the eye, and the distance from the eye. */
export function projectToPlate(q) {
  const dx = q[0] - EYE[0];
  const dy = q[1] - EYE[1];
  const dz = q[2] - EYE[2];
  const a = dx * dx + dz * dz;
  const b = 2 * (EYE[0] * dx + EYE[2] * dz);
  const c = EYE[0] * EYE[0] + EYE[2] * EYE[2] - PLATE.radius * PLATE.radius;
  const s = (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
  const hx = EYE[0] + dx * s;
  const hy = EYE[1] + dy * s;
  const hz = EYE[2] + dz * s;
  const theta = Math.atan2(hx, -hz);
  return {
    u: theta / (2 * PLATE.halfAngle) + 0.5,
    v: (hy - PLATE.centreY) / PLATE.heightM + 0.5,
    depth: Math.sqrt(dx * dx + dy * dy + dz * dz),
  };
}

// ---- Crowd palettes ----
const SHIRTS = [
  [18, [0.1, 0.27, 0.68]],
  [7, [0.33, 0.55, 0.86]],
  [16, [0.86, 0.86, 0.84]],
  [9, [0.93, 0.48, 0.12]],
  [6, [0.93, 0.78, 0.16]],
  [6, [0.72, 0.13, 0.13]],
  [5, [0.14, 0.48, 0.24]],
  [9, [0.07, 0.07, 0.08]],
  [8, [0.44, 0.45, 0.47]],
  [4, [0.44, 0.1, 0.15]],
  [4, [0.88, 0.45, 0.6]],
  [6, [0.1, 0.13, 0.28]],
  [3, [0.62, 0.52, 0.38]],
];
const SKIN = [
  [0.53, 0.36, 0.25],
  [0.44, 0.29, 0.2],
  [0.61, 0.44, 0.32],
  [0.35, 0.23, 0.16],
  [0.68, 0.5, 0.38],
  [0.49, 0.33, 0.24],
];
const HAIR = [
  [0.045, 0.04, 0.035],
  [0.06, 0.05, 0.045],
  [0.1, 0.08, 0.06],
  [0.38, 0.37, 0.36],
];
const CAPS = [
  [0.1, 0.27, 0.68],
  [0.86, 0.86, 0.84],
  [0.93, 0.48, 0.12],
  [0.07, 0.07, 0.08],
  [0.93, 0.78, 0.16],
];

function aisleAt(alpha, r, gap, start, step, halfWidthM) {
  const a = Math.abs(alpha) - gap - start;
  if (a < -step * 0.5) return { inAisle: false, index: -1, offset: 0 };
  const idx = Math.round(a / step);
  const off = (a - idx * step) * r; // metres from the aisle centre along the row
  return { inAisle: idx >= 0 && Math.abs(off) < halfWidthM, index: idx, offset: off };
}

const LOWER_AISLE = { start: 2.6 * DEG, step: 5.4 * DEG, half: 0.65 };
const UPPER_AISLE = { start: 2.2 * DEG, step: 5.4 * DEG, half: 0.6 };

function rowOf(tier, r) {
  return Math.floor(((r - tier.r0) / (tier.r1 - tier.r0)) * tier.rows);
}

function tierRowR(tier, k) {
  return tier.r0 + (k * (tier.r1 - tier.r0)) / tier.rows;
}

function tierRowY(tier, k) {
  return tier.y0 + (k * (tier.y1 - tier.y0)) / tier.rows;
}

function isVomitory(alpha, r, k) {
  const a = aisleAt(alpha, r, LOWER_GAP, LOWER_AISLE.start, LOWER_AISLE.step, 1.5);
  return a.inAisle && a.index % 2 === 1 && k >= 9 && k <= 12;
}

/**
 * Cast one ray. Returns { t, colour } (colour already lit) or { t: Infinity } for sky. Only geometry beyond the
 * plate (t greater than the plate distance) is visible, so the near field is ignored.
 */
function castFactory(seed) {
  const nTex = gradientNoise(seed + 41);

  function tAtRadius(o, d, r) {
    const a = d[0] * d[0] + d[2] * d[2];
    const b = 2 * (o[0] * d[0] + o[2] * d[2]);
    const c = o[0] * o[0] + o[2] * o[2] - r * r;
    return (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
  }

  function tierHit(o, d, tier) {
    for (let k = 0; k < tier.rows; k += 1) {
      const rk = tierRowR(tier, k);
      const tk = tAtRadius(o, d, rk);
      const yk = o[1] + d[1] * tk;
      const top = tierRowY(tier, k + 1);
      if (yk < top) {
        const bottom = tierRowY(tier, k);
        if (yk >= bottom) return { t: tk, k, face: 'riser', y: yk, frac: (yk - bottom) / (top - bottom) };
        if (d[1] < 0 && k > 0) {
          const tt = (bottom - o[1]) / d[1];
          return { t: tt, k: k - 1, face: 'tread', y: bottom, frac: 1 };
        }
        return null;
      }
    }
    return null;
  }

  return function cast(o, d, tMin) {
    let best = { t: Infinity, colour: null };
    const consider = (t, colourFn) => {
      if (t > tMin && t < best.t) best = { t, colourFn };
    };
    const alphaAt = (t) => {
      const x = o[0] + d[0] * t;
      const z = o[2] + d[2] * t;
      return Math.atan2(x, -z);
    };

    // Ground between the plate and the fascia (and the forecourt in front of the pavilion).
    if (d[1] < 0) {
      const tg = -o[1] / d[1];
      const x = o[0] + d[0] * tg;
      const z = o[2] + d[2] * tg;
      const r = Math.hypot(x, z);
      const alpha = Math.atan2(x, -z);
      if (r <= FASCIA_R || (Math.abs(alpha) < LOWER_GAP && -z <= -PAVILION.zFront)) {
        consider(tg, () => {
          const v = 0.03 * nTex(x * 0.7, z * 0.7);
          return shade([0.205 + v, 0.255 + v, 0.15 + v * 0.5], [0, 1, 0], 1, 0.85);
        });
      }
    }

    // Fascia wall all round: 0.36-1.22 m navy band over a concrete kick strip.
    {
      const tf = tAtRadius(o, d, FASCIA_R);
      const y = o[1] + d[1] * tf;
      if (y >= 0 && y <= 1.22) {
        const alpha = alphaAt(tf);
        const n = [-Math.sin(alpha), 0, Math.cos(alpha)];
        consider(tf, () => (y > 0.36 ? shade([0.07, 0.2, 0.31], n, 1, 1) : shade([0.5, 0.5, 0.48], n, 1, 0.8)));
      }
    }

    // Lower tier (outside the end gap) with its front rail.
    {
      const t70 = tAtRadius(o, d, LOWER.r0);
      const alpha0 = alphaAt(t70);
      if (Math.abs(alpha0) >= LOWER_GAP) {
        const hit = tierHit(o, d, LOWER);
        if (hit) {
          consider(hit.t, () => {
            const alpha = alphaAt(hit.t);
            const n = hit.face === 'riser' ? [-Math.sin(alpha), 0, Math.cos(alpha)] : [0, 1, 0];
            const r = tierRowR(LOWER, hit.k);
            const aisle = aisleAt(alpha, r, LOWER_GAP, LOWER_AISLE.start, LOWER_AISLE.step, LOWER_AISLE.half);
            if (isVomitory(alpha, r, hit.k)) return [0.035, 0.035, 0.04];
            const grime = 0.03 * nTex(alpha * 300, hit.k * 1.7);
            if (aisle.inAisle) {
              // Stair: two steps per row, a nosing line at each half.
              const step = hit.frac < 0.5 ? 0.9 : 1.0;
              return shade([0.6 * step + grime, 0.6 * step + grime, 0.58 * step + grime], n, 1, 0.92);
            }
            // Riser concrete between seat rows, with a dark seat-shadow band below the seat line.
            const shadowBand = hit.face === 'riser' ? 0.55 + 0.45 * smoothstep(0.15, 0.7, hit.frac) : 1;
            return shade([(0.56 + grime) * shadowBand, (0.56 + grime) * shadowBand, (0.55 + grime) * shadowBand], n, 1, 0.9);
          });
        }
        // Front rail (3D LowerTierRail: r 70.1 m, 1.44 m) and posts every 2 m.
        const tr = tAtRadius(o, d, 70.1);
        const yr = o[1] + d[1] * tr;
        const alphaR = alphaAt(tr);
        const post = Math.abs(((alphaR * 70.1) % 2 + 2) % 2 - 1) < 0.03;
        if (Math.abs(alphaR) >= LOWER_GAP && ((yr > 1.395 && yr < 1.485) || (post && yr > 1.2 && yr < 1.44))) {
          consider(tr - 0.01, () => shade([0.36, 0.38, 0.39], [0, 0.6, 0.8], 1, 1.05));
        }
        // Lower tier back parapet (89 m, to 11.4 m).
        const tb = tAtRadius(o, d, LOWER.r1);
        const yb = o[1] + d[1] * tb;
        if (yb >= LOWER.y1 && yb <= 11.4 && Math.abs(alphaAt(tb)) >= LOWER_GAP) {
          const a = alphaAt(tb);
          consider(tb, () => shade(yb > 11.32 ? [0.66, 0.66, 0.64] : [0.5, 0.5, 0.49], [-Math.sin(a), yb > 11.32 ? 0.8 : 0, Math.cos(a)], 1, 0.95));
        }
      }
      // Tier end walls facing the gap (radial planes at +-LOWER_GAP).
      for (const sign of [-1, 1]) {
        const ap = sign * LOWER_GAP;
        const nx = Math.cos(ap);
        const nz = Math.sin(ap);
        const denom = d[0] * nx + d[2] * nz;
        if (Math.abs(denom) > 1e-9) {
          const tw = -(o[0] * nx + o[2] * nz) / denom;
          const x = o[0] + d[0] * tw;
          const z = o[2] + d[2] * tw;
          const y = o[1] + d[1] * tw;
          const r = Math.hypot(x, z);
          if (r > LOWER.r0 && r < LOWER.r1 && x * Math.sin(ap) - z * Math.cos(ap) > 0) {
            const k = Math.min(LOWER.rows - 1, rowOf(LOWER, r));
            if (y >= 0 && y <= tierRowY(LOWER, k + 1)) {
              consider(tw, () => shade([0.6, 0.59, 0.56], [sign > 0 ? -nx : nx, 0, sign > 0 ? -nz : nz], 1, 0.85));
            }
          }
        }
      }
    }

    // Concourse, upper tier, roof (beyond the pavilion).
    {
      const t92 = tAtRadius(o, d, UPPER.r0);
      const alphaU = alphaAt(t92);
      if (Math.abs(alphaU) >= UPPER_GAP) {
        // Upper tier front parapet: navy fascia 12.9-14.6 m at 91.8 m.
        const tp = tAtRadius(o, d, 91.8);
        const yp = o[1] + d[1] * tp;
        const ap = alphaAt(tp);
        if (yp >= 12.9 && yp <= 14.6) {
          consider(tp, () =>
            yp > 14.45
              ? shade([0.7, 0.7, 0.68], [0, 1, 0], 1, 1)
              : shade([0.07, 0.2, 0.31], [-Math.sin(ap), 0, Math.cos(ap)], 1, 1),
          );
        } else if (yp >= LOWER.y1 && yp < 12.9) {
          // Concourse back wall at 95 m, deep in the upper tier's shade.
          const tc = tAtRadius(o, d, 95);
          const yc = o[1] + d[1] * tc;
          const ac = alphaAt(tc);
          const door = Math.abs(((ac * 95) % 7 + 7) % 7 - 3.5) < 1.1 && yc < 12.6;
          consider(tc, () => (door ? [0.03, 0.03, 0.035] : shade([0.42, 0.42, 0.41], [-Math.sin(ac), 0, Math.cos(ac)], 1, 0.38)));
        }
        const hit = tierHit(o, d, UPPER);
        if (hit) {
          consider(hit.t, () => {
            const alpha = alphaAt(hit.t);
            const n = hit.face === 'riser' ? [-Math.sin(alpha), 0, Math.cos(alpha)] : [0, 1, 0];
            const r = tierRowR(UPPER, hit.k);
            const aisle = aisleAt(alpha, r, UPPER_GAP, UPPER_AISLE.start, UPPER_AISLE.step, UPPER_AISLE.half);
            const roofed = Math.abs(alpha) <= ROOF.end ? 0.72 : 1;
            const sun = roofSun([o[0] + d[0] * hit.t, o[1] + d[1] * hit.t, o[2] + d[2] * hit.t]);
            const grime = 0.03 * nTex(alpha * 280 + 50, hit.k * 1.9);
            if (aisle.inAisle) {
              const step = hit.frac < 0.5 ? 0.9 : 1.0;
              return shade([0.62 * step + grime, 0.62 * step + grime, 0.6 * step + grime], n, sun, 0.92 * roofed);
            }
            const shadowBand = hit.face === 'riser' ? 0.55 + 0.45 * smoothstep(0.12, 0.7, hit.frac) : 1;
            return shade([(0.58 + grime) * shadowBand, (0.58 + grime) * shadowBand, (0.57 + grime) * shadowBand], n, sun, 0.9 * roofed);
          });
        }
        // Back parapet (109 m, 27-28.2 m).
        const tb = tAtRadius(o, d, UPPER.r1);
        const yb = o[1] + d[1] * tb;
        if (yb >= UPPER.y1 && yb <= 28.2) {
          const a = alphaAt(tb);
          consider(tb, () => shade(yb > 28.1 ? [0.7, 0.7, 0.68] : [0.55, 0.55, 0.54], [-Math.sin(a), yb > 28.1 ? 0.8 : 0, Math.cos(a)], 1, 0.95));
        }
        // Upper tier end walls facing the pavilion.
        for (const sign of [-1, 1]) {
          const apl = sign * UPPER_GAP;
          const nx = Math.cos(apl);
          const nz = Math.sin(apl);
          const denom = d[0] * nx + d[2] * nz;
          if (Math.abs(denom) > 1e-9) {
            const tw = -(o[0] * nx + o[2] * nz) / denom;
            const x = o[0] + d[0] * tw;
            const z = o[2] + d[2] * tw;
            const y = o[1] + d[1] * tw;
            const r = Math.hypot(x, z);
            if (r > 89 && r < UPPER.r1 && x * Math.sin(apl) - z * Math.cos(apl) > 0) {
              const k = Math.max(0, Math.min(UPPER.rows - 1, rowOf(UPPER, r)));
              const topY = r < UPPER.r0 ? 14.6 : tierRowY(UPPER, k + 1);
              if (y >= LOWER.y1 && y <= topY) {
                consider(tw, () => shade([0.58, 0.57, 0.55], [sign > 0 ? -nx : nx, 0, sign > 0 ? -nz : nz], 1, 0.8));
              }
            }
          }
        }
      }
      // Roof over the upper tiers: white front fascia at 95 m, shaded underside with lighter cantilever ribs, and
      // light metal cladding closing the slot between the upper tier's back (28.2 m at 109 m) and the roof.
      {
        const tr = tAtRadius(o, d, ROOF.r0);
        const yr = o[1] + d[1] * tr;
        const ar = alphaAt(tr);
        if (Math.abs(ar) >= UPPER_GAP && Math.abs(ar) <= ROOF.end) {
          if (yr >= ROOF.yFront && yr <= ROOF.fasciaTop) {
            const lip = yr < ROOF.yFront + 0.12 ? 0.8 : 1;
            consider(tr, () => shade([0.9 * lip, 0.9 * lip, 0.89 * lip], [-Math.sin(ar), 0.2, Math.cos(ar)], 1, 1.1));
          } else if (yr < ROOF.yFront) {
            const under = (r) => ROOF.yFront + ((r - ROOF.r0) / (ROOF.r1 - ROOF.r0)) * (ROOF.yBack - ROOF.yFront);
            let lo = ROOF.r0;
            let hi = ROOF.r1;
            const f = (r) => o[1] + d[1] * tAtRadius(o, d, r) - under(r);
            if (f(hi) > 0) {
              for (let i = 0; i < 24; i += 1) {
                const mid = (lo + hi) * 0.5;
                if (f(mid) > 0) hi = mid;
                else lo = mid;
              }
              const th = tAtRadius(o, d, hi);
              const ah = alphaAt(th);
              const trussPitch = 3.0 * DEG;
              const ph = ((Math.abs(ah) % trussPitch) + trussPitch) % trussPitch;
              const rib = Math.min(ph, trussPitch - ph) * hi < 0.3;
              const purlin = Math.abs((((hi - ROOF.r0) % 3.2) + 3.2) % 3.2 - 1.6) < 0.1;
              const endTruss = Math.abs(Math.abs(ah) - ROOF.end) * hi < 0.6 || Math.abs(Math.abs(ah) - UPPER_GAP) * hi < 0.6;
              const depthShade = 0.85 + 0.15 * smoothstep(ROOF.r1, ROOF.r0, hi);
              consider(th, () => {
                if (rib || endTruss) return [0.62 * depthShade, 0.63 * depthShade, 0.64 * depthShade];
                if (purlin) return [0.5 * depthShade, 0.51 * depthShade, 0.53 * depthShade];
                return [0.43 * depthShade, 0.445 * depthShade, 0.47 * depthShade];
              });
            }
          }
          // Back cladding at 110 m between the upper tier's back parapet and the roof.
          const tc = tAtRadius(o, d, 110);
          const yc = o[1] + d[1] * tc;
          if (yc > 28.0 && yc < ROOF.yBack) {
            const ac = alphaAt(tc);
            const louvre = Math.abs((((yc % 0.45) + 0.45) % 0.45) - 0.225) > 0.17;
            const post = Math.abs((((ac * 110) % 6) + 6) % 6 - 3) > 2.85;
            const k = post ? 0.75 : louvre ? 0.62 : 0.8;
            consider(tc, () => shade([0.5 * k, 0.52 * k, 0.53 * k], [-Math.sin(ac), louvre ? -0.4 : 0, Math.cos(ac)], 1, 0.7));
          }
        }
      }
    }

    // Pavilion: main block and media box (axis-aligned boxes).
    const boxes = [
      { min: [-PAVILION.x, 0, PAVILION.zBack], max: [PAVILION.x, PAVILION.top, PAVILION.zFront], kind: 'main' },
      { min: [-PAVILION.boxX, PAVILION.top, PAVILION.boxBack], max: [PAVILION.boxX, PAVILION.boxTop, PAVILION.boxFront], kind: 'box' },
    ];
    for (const box of boxes) {
      let t0 = -Infinity;
      let t1 = Infinity;
      let axis = -1;
      let ok = true;
      for (let i = 0; i < 3; i += 1) {
        if (Math.abs(d[i]) < 1e-12) {
          if (o[i] < box.min[i] || o[i] > box.max[i]) ok = false;
          continue;
        }
        let ta = (box.min[i] - o[i]) / d[i];
        let tb = (box.max[i] - o[i]) / d[i];
        if (ta > tb) [ta, tb] = [tb, ta];
        if (ta > t0) {
          t0 = ta;
          axis = i;
        }
        if (tb < t1) t1 = tb;
      }
      if (!ok || t0 > t1 || t1 < 0) continue;
      const th = t0;
      const p = [o[0] + d[0] * th, o[1] + d[1] * th, o[2] + d[2] * th];
      consider(th, () => pavilionColour(box.kind, axis, p, d, nTex));
    }

    // Floodlight towers (3D FloodlightTowers: 145 and 215 degrees, 114 m, radius 0.72 m, 58 m).
    for (const [cx, cz] of TOWERS) {
      const ox = o[0] - cx;
      const oz = o[2] - cz;
      const a = d[0] * d[0] + d[2] * d[2];
      const b = 2 * (ox * d[0] + oz * d[2]);
      const c = ox * ox + oz * oz - TOWER_R * TOWER_R;
      const disc = b * b - 4 * a * c;
      if (disc > 0) {
        const tt = (-b - Math.sqrt(disc)) / (2 * a);
        const y = o[1] + d[1] * tt;
        if (y > 0 && y < 58) {
          const nx = (ox + d[0] * tt) / TOWER_R;
          const nz = (oz + d[2] * tt) / TOWER_R;
          const band = Math.abs(((y % 6) + 6) % 6 - 3) < 0.08 ? 0.82 : 1;
          consider(tt, () => shade([0.44 * band, 0.46 * band, 0.47 * band], [nx, 0, nz], 1, 1));
        }
      }
    }

    if (best.colourFn) return { t: best.t, colour: best.colourFn() };
    return { t: Infinity, colour: null };
  };
}

function pavilionColour(kind, axis, p, d, nTex) {
  const stone = [0.68, 0.64, 0.55];
  if (axis !== 2) {
    // Sides (and the hidden top): plain stone.
    const n = axis === 0 ? [Math.sign(-d[0]), 0, 0] : [0, 1, 0];
    return shade(stone, n, 1, 0.9);
  }
  const n = [0, 0, 1];
  const x = p[0];
  const y = p[1];
  const grain = 0.02 * nTex(x * 2.1, y * 2.1);
  if (kind === 'box') {
    // Media box: stone plinth, tinted glazing band with mullions, white roof slab.
    if (y < 16) return shade([0.8, 0.79, 0.76], n, 1, 0.95);
    if (y > 21.3) return shade([0.88, 0.88, 0.86], [0, 0.3, 0.95], 1, 1.1);
    const mull = Math.abs((((x + 0.75) % 1.5) + 1.5) % 1.5 - 0.75) > 0.7 || Math.abs(y - 18.6) < 0.06;
    if (mull || y > 20.9) return shade([0.36, 0.37, 0.38], n, 1, 1);
    const refl = 0.24 + 0.16 * smoothstep(16, 20.9, y);
    return [refl * 0.92, refl * 1.04, refl * 1.16];
  }
  // Main pavilion face (front at z = -81): players' level, members' balcony, glazed hospitality, roof terrace.
  const slab = (y >= 3.6 && y <= 4.0) || (y >= 7.6 && y <= 8.0) || (y >= 11.6 && y <= 12.0);
  if (slab) return shade([0.72, 0.72, 0.7], [0, 0.35, 0.94], 1, 1.0);
  if (y < 3.6) {
    // Ground floor: stone piers every 4 m with dark players' area openings.
    const pier = Math.abs((((x + 2) % 4) + 4) % 4 - 2) > 1.55;
    if (pier || y > 3.1) return shade([stone[0] + grain, stone[1] + grain, stone[2] + grain], n, 1, 0.85);
    return [0.05, 0.05, 0.055];
  }
  const column = Math.abs((((x + 4) % 8) + 8) % 8 - 4) > 3.75;
  if (column && y < 14.4) return shade([0.7, 0.69, 0.66], n, 1, 0.92);
  if (y < 7.6) {
    // Members' balcony: deep, shaded seating bay (the seated members are sprites in front of this).
    const back = 0.09 + 0.05 * smoothstep(4.0, 7.6, y);
    return [back, back * 1.02, back * 1.06];
  }
  if (y < 11.6) {
    // Glazed hospitality level with mullions; a few panels with pale blinds.
    const local = y - 8.0;
    const mull = Math.abs((((x + 0.8) % 1.6) + 1.6) % 1.6 - 0.8) > 0.75 || Math.abs(local - 2.4) < 0.05;
    if (mull) return shade([0.34, 0.35, 0.36], n, 1, 1);
    const panel = Math.floor((x + 40) / 1.6);
    const blind = hash3(panel, 8, 5, 77) < 0.2;
    const overhang = 0.75 + 0.25 * smoothstep(3.6, 0.8, local);
    if (blind) return shade([0.7, 0.68, 0.64], n, 1, 0.75 * overhang);
    const refl = (0.2 + 0.12 * smoothstep(0.2, 3.6, local)) * overhang;
    return [refl * 0.94, refl * 1.06, refl * 1.18];
  }
  // Roof terrace (12-15 m): shaded seating under a light canopy with a white fascia.
  if (y > 14.35) return shade([0.88, 0.88, 0.86], [0, 0.3, 0.95], 1, 1.1);
  if (y > 14.1) return [0.3, 0.31, 0.33];
  const back = 0.11 + 0.05 * smoothstep(12.0, 14.1, y);
  return [back, back * 1.02, back * 1.06];
}

// ---- Sprites: seated spectators drawn per seat with a depth test ----

function personShape(lx, ly, person) {
  // Returns { part, n: [nx, ny, nz] in the person's frame (x right, y up, z towards the field) } or null.
  const h = person.standing ? 0.42 : 0;
  // Head.
  const hx = lx / 0.085;
  const hy = (ly - (1.17 + h)) / 0.108;
  const hr = hx * hx + hy * hy;
  if (hr <= 1) {
    const nz = Math.sqrt(Math.max(0, 1 - hr));
    let part = 'skin';
    if (person.cap) {
      if (hy > 0.05) part = 'cap';
    } else if (hy > 0.35 - 0.25 * hx * hx) {
      part = 'hair';
    }
    return { part, n: [hx * 0.9, hy * 0.9, nz] };
  }
  // Neck.
  if (Math.abs(lx) < 0.045 && ly > 0.98 + h && ly < 1.08 + h) return { part: 'skin', n: [lx / 0.06, 0, 0.8] };
  // Torso with rounded shoulders.
  const top = 1.03 + h;
  const bottom = person.standing ? 0.45 : 0.45;
  if (ly >= bottom && ly <= top) {
    const t = (ly - bottom) / (top - bottom);
    let half = lerp(0.165, 0.215, t);
    const shoulder = (ly - (top - 0.09)) / 0.09;
    if (shoulder > 0) half *= Math.sqrt(Math.max(0, 1 - shoulder * shoulder * 0.85));
    if (Math.abs(lx) <= half) {
      const nx = lx / (half + 0.05);
      const ny = shoulder > 0 ? shoulder * 0.9 : 0;
      const arm = Math.abs(lx) > half - 0.05 && ly < top - 0.08;
      const part = arm && person.shortSleeve && ly < 0.78 + h ? 'skin' : 'shirt';
      return { part, n: [nx * 0.7, ny, Math.sqrt(Math.max(0.05, 1 - nx * nx * 0.49 - ny * ny))], arm };
    }
  }
  // Legs and knees (mostly hidden by the row in front).
  if (ly >= 0.12 && ly < bottom + 0.02 && Math.abs(lx) < 0.18) return { part: 'legs', n: [lx / 0.25, 0.2, 0.9] };
  return null;
}

function drawSprite(buf, W, H, depthBuf, sprite, hazeColour) {
  const { cx, cy, ax, ay, depth, draw, extent } = sprite;
  const haze = 0.1 * smoothstep(70, 150, depth);
  const det = ax[0] * ay[1] - ax[1] * ay[0];
  if (Math.abs(det) < 1e-9) return;
  const inv = [ay[1] / det, -ay[0] / det, -ax[1] / det, ax[0] / det];
  const corners = [];
  for (const lx of [extent[0], extent[1]]) {
    for (const ly of [extent[2], extent[3]]) corners.push([cx + ax[0] * lx + ay[0] * ly, cy + ax[1] * lx + ay[1] * ly]);
  }
  const x0 = Math.max(0, Math.floor(Math.min(...corners.map((c) => c[0]))));
  const x1 = Math.min(W - 1, Math.ceil(Math.max(...corners.map((c) => c[0]))));
  const y0 = Math.max(0, Math.floor(Math.min(...corners.map((c) => c[1]))));
  const y1 = Math.min(H - 1, Math.ceil(Math.max(...corners.map((c) => c[1]))));
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const idx = y * W + x;
      if (depth >= depthBuf[idx]) continue;
      const qx = x + 0.5 - cx;
      const qy = y + 0.5 - cy;
      const lx = inv[0] * qx + inv[1] * qy;
      const ly = inv[2] * qx + inv[3] * qy;
      const c = draw(lx, ly);
      if (!c) continue;
      buf[idx * 3] = c[0] + (hazeColour[0] - c[0]) * haze;
      buf[idx * 3 + 1] = c[1] + (hazeColour[1] - c[1]) * haze;
      buf[idx * 3 + 2] = c[2] + (hazeColour[2] - c[2]) * haze;
      depthBuf[idx] = depth;
    }
  }
}

function makeSprites(seed, W, H) {
  const sprites = [];
  const nOcc = gradientNoise(seed + 61);
  const nBias = gradientNoise(seed + 62);
  const toPixel = (q) => {
    const p = projectToPlate(q);
    return [p.u * W, (1 - p.v) * H, p.depth];
  };
  const addPerson = (base, inward, kind, occupancy, key, ambientScale) => {
    const sun = roofSun([base[0], base[1] + 1.0, base[2]]);
    // base: world point at the seat (tread level), inward: unit horizontal normal towards the field.
    const right = [inward[2], 0, -inward[0]]; // horizontal, perpendicular to inward
    const c = toPixel(base);
    if (c[0] < -40 || c[0] > W + 40) return;
    const px = toPixel([base[0] + right[0] * 0.5, base[1], base[2] + right[2] * 0.5]);
    const mx = toPixel([base[0] - right[0] * 0.5, base[1], base[2] - right[2] * 0.5]);
    const py = toPixel([base[0], base[1] + 0.5, base[2]]);
    const my = toPixel([base[0], base[1] - 0.5, base[2]]);
    const ax = [px[0] - mx[0], px[1] - mx[1]];
    const ay = [py[0] - my[0], py[1] - my[1]];
    const r = (i) => hash3(key[0], key[1], key[2] * 16 + i, seed);
    const seatCol = kind.seat;
    const occupied = r(0) < occupancy;
    // Seat back behind the person (deeper by 0.3 m).
    sprites.push({
      cx: c[0], cy: c[1], ax, ay, depth: c[2] + 0.3, extent: [-0.25, 0.25, 0.3, 0.9],
      draw: (lx, ly) => {
        if (Math.abs(lx) > 0.215 || ly < 0.4 || ly > 0.84) return null;
        const edge = ly > 0.8 ? 1.25 : 1;
        return shade([seatCol[0] * edge, seatCol[1] * edge, seatCol[2] * edge], [inward[0], ly > 0.8 ? 0.7 : 0.1, inward[2]], sun, 0.9 * ambientScale);
      },
    });
    if (!occupied) {
      // Empty seat pan.
      sprites.push({
        cx: c[0], cy: c[1], ax, ay, depth: c[2] + 0.05, extent: [-0.25, 0.25, 0.3, 0.6],
        draw: (lx, ly) => (Math.abs(lx) < 0.215 && ly > 0.4 && ly < 0.47 ? shade(seatCol, [0, 0.8, 0.6], sun, 0.9 * ambientScale) : null),
      });
      return;
    }
    const bias = nBias(base[0] * 0.05, base[2] * 0.05 + base[1] * 0.2);
    const shirtPalette = bias > 0.25 ? SHIRTS.map(([w, col], i) => [i === 0 ? w * 2.6 : w, col]) : SHIRTS;
    const shirt = weighted(shirtPalette, r(1));
    const tone = 0.85 + 0.25 * r(2);
    const person = {
      standing: r(3) < kind.standing,
      cap: r(4) < 0.14,
      shortSleeve: r(5) < 0.45,
      skin: SKIN[Math.floor(r(6) * SKIN.length)],
      hair: HAIR[Math.floor(r(7) * HAIR.length * 0.86 + (r(8) < 0.08 ? HAIR.length * 0.14 : 0)) % HAIR.length],
      capCol: CAPS[Math.floor(r(9) * CAPS.length)],
      // Muted by distance and shade: 30% towards grey, slightly darker.
      shirt: [0, 1, 2].map((c) => (shirt[c] * 0.7 + (0.2126 * shirt[0] + 0.7152 * shirt[1] + 0.0722 * shirt[2]) * 0.3) * tone * 0.92),
      legs: r(10) < 0.7 ? [0.1, 0.11, 0.16] : [0.3, 0.27, 0.22],
    };
    const lean = (r(11) - 0.5) * 0.06;
    sprites.push({
      cx: c[0], cy: c[1], ax, ay, depth: c[2], extent: [-0.3, 0.3, 0.1, 1.35 + (person.standing ? 0.45 : 0)],
      draw: (lx, ly) => {
        const s = personShape(lx - lean * ly, ly, person);
        if (!s) return null;
        let albedo;
        if (s.part === 'skin') albedo = person.skin;
        else if (s.part === 'hair') albedo = person.hair;
        else if (s.part === 'cap') albedo = person.capCol;
        else if (s.part === 'legs') albedo = person.legs;
        else albedo = s.arm ? [person.shirt[0] * 0.85, person.shirt[1] * 0.85, person.shirt[2] * 0.85] : person.shirt;
        // Person frame -> world normal.
        const n = [
          right[0] * s.n[0] + inward[0] * s.n[2],
          s.n[1],
          right[2] * s.n[0] + inward[2] * s.n[2],
        ];
        const len = Math.hypot(n[0], n[1], n[2]) || 1;
        const ao = 0.72 + 0.28 * smoothstep(0.4, 1.0, ly);
        return shade(albedo, [n[0] / len, n[1] / len, n[2] / len], sun, ao * ambientScale);
      },
    });
  };

  const tiers = [
    { tier: LOWER, gap: LOWER_GAP, aisle: LOWER_AISLE, seat: [0.13, 0.25, 0.46], standing: 0.035, base: 0.88, id: 1 },
    { tier: UPPER, gap: UPPER_GAP, aisle: UPPER_AISLE, seat: [0.5, 0.52, 0.55], standing: 0.02, base: 0.8, id: 2 },
  ];
  for (const t of tiers) {
    for (let k = t.tier.rows - 1; k >= 0; k -= 1) {
      const rSeat = tierRowR(t.tier, k) + 0.42;
      const yTread = tierRowY(t.tier, k + 1);
      const pitchM = 0.5;
      const dA = pitchM / rSeat;
      const maxA = 44 * DEG;
      let i = 0;
      for (let a = t.gap + dA * 0.5; a < maxA; a += dA, i += 1) {
        for (const sign of [-1, 1]) {
          const alpha = sign * a;
          const aisle = aisleAt(alpha, rSeat, t.gap, t.aisle.start, t.aisle.step, t.aisle.half + 0.25);
          if (aisle.inAisle) continue;
          if (t.id === 1 && isVomitory(alpha, rSeat, k)) continue;
          const base = [Math.sin(alpha) * rSeat, yTread, -Math.cos(alpha) * rSeat];
          const inward = [-Math.sin(alpha), 0, Math.cos(alpha)];
          const occNoise = fbm(nOcc, alpha * 18, k * 0.22 + t.id * 7, 1 << 20, 1 << 20, 3, 0.5);
          const occupancy = clamp01(t.base + 0.22 * occNoise - (t.id === 2 ? 0.1 * smoothstep(12, 20, k) : 0));
          const roofed = t.id === 2 && a <= ROOF.end ? 0.72 : 1;
          addPerson(base, inward, t, occupancy, [t.id * 1000 + k, i, sign + 2], roofed);
        }
      }
    }
  }
  // Members on the pavilion's balcony and roof terrace: two stepped rows each.
  const pavilionRows = [
    [4.0, PAVILION.zFront + 2.2, 0.72],
    [4.45, PAVILION.zFront + 1.3, 0.62],
    [12.0, PAVILION.zFront + 1.9, 0.66],
    [12.45, PAVILION.zFront + 1.0, 0.55],
  ];
  for (const [floorY, z, occupancy] of pavilionRows) {
    let i = 0;
    for (let x = -27.2; x <= 27.2; x += 0.6, i += 1) {
      if (Math.abs((((x + 4) % 8) + 8) % 8 - 4) > 3.6) continue; // structural columns
      const base = [x, floorY, z];
      addPerson(base, [0, 0, 1], { seat: [0.22, 0.22, 0.24], standing: 0.05 }, occupancy, [3000 + Math.round(floorY * 10), i, Math.round(-z)], 0.62);
    }
  }
  sprites.sort((p, q) => q.depth - p.depth);
  return sprites;
}

/** Cloud cover for the plate's sky band, faded out towards the plate edges so the feather meets the plain dome. */
function skyColour(d, u, v, nCloud, nWarp) {
  const elev = Math.asin(d[1]) / DEG;
  // Elevation of the dome point hit by the ray (dome radius 168 m, centred at the pitch).
  const ox = EYE[0];
  const oy = EYE[1];
  const oz = EYE[2];
  const b = ox * d[0] + oy * d[1] + oz * d[2];
  const c = ox * ox + oy * oy + oz * oz - 168 * 168;
  const t = -b + Math.sqrt(b * b - c);
  const hy = oy + d[1] * t;
  const domeElev = Math.asin(Math.min(1, hy / 168)) / DEG;
  let col = domeColourAt(domeElev);
  if (elev > 1) {
    const dist = 1 / Math.tan(Math.max(elev, 3) * DEG);
    const px = d[0] / Math.cos(elev * DEG) * dist * 2.2;
    const pz = d[2] / Math.cos(elev * DEG) * dist * 2.2;
    const w = 0.5 * fbm(nWarp, px * 0.7, pz * 0.7, 1 << 20, 1 << 20, 3, 0.5);
    const dens = fbm(nCloud, (px + w) * 1.6 + 5, (pz + w) * 1.6 - 3, 1 << 20, 1 << 20, 6, 0.55);
    const edgeFade = smoothstep(0.02, 0.16, Math.min(u, 1 - u)) * smoothstep(0.0, 0.1, 1 - v);
    const cloud = smoothstep(0.12, 0.42, dens) * edgeFade * smoothstep(2, 8, elev);
    if (cloud > 0) {
      const lit = clamp01(0.6 + 1.6 * (dens - fbm(nCloud, (px + w + 0.08) * 1.6 + 5, (pz + w - 0.05) * 1.6 - 3, 1 << 20, 1 << 20, 6, 0.55)));
      const cc = mixc([0.72, 0.76, 0.82], [0.97, 0.97, 0.95], lit);
      col = mixc(col, cc, cloud * 0.85);
    }
  }
  // Pre-divide by the backdrop tint so the shader's multiply lands on the dome colour at the feathered top edge.
  return [col[0] / BACKDROP_TINT[0], col[1] / BACKDROP_TINT[1], col[2] / BACKDROP_TINT[2]];
}

/**
 * Render the plate. Any width x height samples the same arc (u, v in 0..1); the shipped size is a power of two
 * (2048 x 1024) so the Unity import compresses, while the world shape stays the C# 2172:724.
 */
export function stadium({ width = 2048, height = 1024, seed = 'vande-stadium-day-v3', supersample = 2 }) {
  const s = hashString(seed);
  const W = width * supersample;
  const H = height * supersample;
  const img = createImage(W, H);
  const buf = img.data;
  const depthBuf = new Float32Array(W * H).fill(Infinity);
  const cast = castFactory(s);
  const nCloud = gradientNoise(s + 71);
  const nWarp = gradientNoise(s + 72);
  const ground = [0.2, 0.24, 0.16];
  const horizonHaze = domeColourAt(2);

  for (let j = 0; j < H; j += 1) {
    const v = 1 - (j + 0.5) / H;
    for (let i = 0; i < W; i += 1) {
      const u = (i + 0.5) / W;
      const idx = j * W + i;
      const p = platePoint(u, v);
      if (p[1] <= 0) {
        // Below ground on the arc: the 3D outfield always hides it; keep it field-coloured for clean filtering.
        buf[idx * 3] = ground[0];
        buf[idx * 3 + 1] = ground[1];
        buf[idx * 3 + 2] = ground[2];
        continue;
      }
      const dx = p[0] - EYE[0];
      const dy = p[1] - EYE[1];
      const dz = p[2] - EYE[2];
      const len = Math.hypot(dx, dy, dz);
      const d = [dx / len, dy / len, dz / len];
      const hit = cast(EYE, d, len);
      let col;
      if (hit.colour) {
        col = hit.colour;
        // Light aerial perspective towards the horizon colour (the 3D fog starts beyond these distances).
        const haze = 0.1 * smoothstep(70, 150, hit.t);
        col = mixc(col, horizonHaze, haze);
        depthBuf[idx] = hit.t;
      } else {
        col = skyColour(d, u, v, nCloud, nWarp);
      }
      buf[idx * 3] = col[0];
      buf[idx * 3 + 1] = col[1];
      buf[idx * 3 + 2] = col[2];
    }
  }

  const sprites = makeSprites(s, W, H);
  for (const sprite of sprites) drawSprite(buf, W, H, depthBuf, sprite, horizonHaze);

  const out = supersample > 1 ? downsample(img, supersample) : img;

  // Sight screen: plain matte near-black panel exactly over the C# cutout rectangle, with faint panel seams.
  const [u0, u1, v0, v1] = screenUvBounds();
  for (let j = 0; j < height; j += 1) {
    const v = 1 - (j + 0.5) / height;
    if (v < v0 || v > v1) continue;
    for (let i = 0; i < width; i += 1) {
      const u = (i + 0.5) / width;
      if (u < u0 || u > u1) continue;
      const seamU = ((u - u0) / (u1 - u0)) * 6;
      const seam = Math.abs(seamU - Math.round(seamU)) * ((u1 - u0) * width) / 6 < 0.6 ? 0.008 : 0;
      const idx = (j * width + i) * 3;
      out.data[idx] = SIGHT_SCREEN.colour[0] + seam;
      out.data[idx + 1] = SIGHT_SCREEN.colour[1] + seam;
      out.data[idx + 2] = SIGHT_SCREEN.colour[2] + seam;
    }
  }
  return out;
}
