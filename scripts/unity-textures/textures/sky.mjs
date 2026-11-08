/**
 * Late-afternoon sky panorama for the inward sky dome (ProductionEnvironmentAtmosphere.BuildSkyDome). The dome maps
 * u to azimuth (x = sin(2 pi u), z = cos(2 pi u)) and v linearly to elevation: v = 0.02 at -8 deg, 0.92 at the
 * zenith; the apex samples v = 0.99. Only the LateAfternoon clear look uses it, unlit and untinted.
 *
 * Model: an elevation gradient from the LateAfternoon look's own zenith/middle/horizon colours, warmed by forward
 * scattering round the sun of the web stage's LOOKS.late_afternoon (src/render3d/three/stadium.ts: azimuth 104 deg from
 * +z towards +x, elevation 15 deg; the same convention as ProductionEnvironmentAtmosphere.SunKey and the dome's
 * u = azimuth / 360, so the glow sits at u = 0.289; a broad glow, no sun
 * disc), and two cloud layers projected from a horizontal plane so they foreshorten towards the horizon. Plane
 * coordinates are continuous round the azimuth, so the panorama has no seam at u = 0/1 and no pinch at the zenith.
 * Cloud detail is band-limited to the texel footprint (fewer octaves towards the horizon) and the image is drawn at
 * twice the size and box-filtered, so the foreshortened band does not alias into speckle.
 */
import { clamp01, gradientNoise, lerp, smoothstep } from '../lib/noise.mjs';
import { createImage, downsample } from '../lib/image.mjs';
import { hashString } from '../lib/random.mjs';

const ZENITH = [0.16, 0.39, 0.69];
const MIDDLE = [0.49, 0.63, 0.78];
const HORIZON = [0.9, 0.67, 0.4];

const SUN_AZ = (104 * Math.PI) / 180;
const SUN_EL = (15 * Math.PI) / 180;
const SUN = [Math.sin(SUN_AZ) * Math.cos(SUN_EL), Math.sin(SUN_EL), Math.cos(SUN_AZ) * Math.cos(SUN_EL)];
const BIG = 1 << 20;

function mix(a, b, t) {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

/** Elevation in degrees for a dome v coordinate (inverse of BuildSkyDome's Lerp(0.02, 0.92, (e + 8) / 98)). */
export function skyElevationForV(v) {
  return ((v - 0.02) / 0.9) * 98 - 8;
}

/** Fractal noise with a fractional octave count (the last octave fades in), for footprint-limited detail. */
function fbmLod(noise, x, y, octaves, gain) {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let f = 1;
  const whole = Math.floor(octaves);
  for (let o = 0; o <= whole; o += 1) {
    const w = o < whole ? 1 : octaves - whole;
    if (w <= 0) break;
    sum += amp * w * noise(x * f, y * f, BIG, BIG);
    norm += amp * w;
    amp *= gain;
    f *= 2;
  }
  return norm > 0 ? sum / norm : 0;
}

export function sky({ width = 1024, height = 512, seed = 'vande-sky-late-afternoon-v1', supersample = 2 }) {
  const s = hashString(seed);
  const n1 = gradientNoise(s);
  const n2 = gradientNoise(s + 1);
  const n3 = gradientNoise(s + 2);
  const W = width * supersample;
  const H = height * supersample;
  const img = createImage(W, H);
  const d = img.data;
  const dElevPerPixel = ((98 / 0.9) * Math.PI) / 180 / H;
  const cloudScale = 0.9;
  for (let y = 0; y < H; y += 1) {
    const v = 1 - (y + 0.5) / H;
    const elevDeg = Math.min(90, Math.max(-8, skyElevationForV(v)));
    const e = (elevDeg * Math.PI) / 180;
    // Plane footprint of one texel in v (the larger of the two directions near the horizon).
    const eC = Math.max(e, (2.5 * Math.PI) / 180);
    const footprint = Math.max(dElevPerPixel / (Math.sin(eC) * Math.sin(eC)), (2 * Math.PI) / W / Math.tan(eC));
    const octaves = Math.max(1, Math.min(6, Math.log2(1 / (3 * footprint * cloudScale))));
    for (let x = 0; x < W; x += 1) {
      const u = (x + 0.5) / W;
      const az = u * Math.PI * 2;
      const dir = [Math.sin(az) * Math.cos(e), Math.sin(e), Math.cos(az) * Math.cos(e)];
      const cosSun = dir[0] * SUN[0] + dir[1] * SUN[1] + dir[2] * SUN[2];
      const sunAngle = Math.acos(Math.max(-1, Math.min(1, cosSun)));
      const azDiff = Math.cos(az - SUN_AZ);
      const toward = 0.5 + 0.5 * azDiff; // 1 at the sun's azimuth, 0 opposite

      // Base gradient (as SkyColour), horizon warmer towards the sun and cooler, greyer away from it.
      const e01 = Math.max(0, elevDeg) / 90;
      const horizonHere = mix([0.66, 0.64, 0.66], HORIZON, 0.3 + 0.7 * toward ** 1.5);
      let c =
        e01 < 0.42
          ? mix(horizonHere, MIDDLE, smoothstep(0, 1, e01 / 0.42))
          : mix(MIDDLE, ZENITH, smoothstep(0, 1, (e01 - 0.42) / 0.58));
      const band = Math.exp(-Math.max(0, elevDeg) / 3.5);
      c = mix(c, mix([0.8, 0.7, 0.62], [1.0, 0.8, 0.55], toward), 0.4 * band);
      // Forward-scattered glow round the sun: broad and soft, no disc.
      const glow = 0.24 * Math.exp(-sunAngle / 0.55) + 0.12 * Math.exp(-sunAngle / 0.18);
      c = [c[0] + glow * 1.0, c[1] + glow * 0.82, c[2] + glow * 0.58];

      if (elevDeg > 0.5) {
        const dist = 1 / Math.tan(eC);
        const px = Math.sin(az) * dist * cloudScale;
        const pz = Math.cos(az) * dist * cloudScale;
        const fade = smoothstep(2.5, 14, elevDeg) * (1 - 0.4 * smoothstep(50, 85, elevDeg));
        // Altocumulus field: gently warped, soft-edged, about 15-25% cover, patchy at large scale.
        const wx = 0.25 * fbmLod(n2, px * 0.6 + 7.1, pz * 0.6 - 2.3, Math.min(3, octaves), 0.5);
        const wz = 0.25 * fbmLod(n2, px * 0.6 - 4.7, pz * 0.6 + 8.9, Math.min(3, octaves), 0.5);
        const patch = fbmLod(n1, (px + wx) * 1.3, (pz + wz) * 1.3, octaves, 0.52);
        const coverage = 0.1 + 0.12 * fbmLod(n3, px * 0.22 + 3, pz * 0.22 - 9, 2, 0.5);
        const cumulus = smoothstep(coverage, coverage + 0.32, patch);
        // High cirrus streaks along one wind direction, faint.
        const ax = px * 0.94 + pz * 0.34;
        const aw = -px * 0.34 + pz * 0.94;
        const streak = fbmLod(n3, ax * 0.35 + 11.3, aw * 2.4, Math.min(5, octaves), 0.55);
        const cirrus =
          smoothstep(0.12, 0.5, streak) * 0.45 * smoothstep(0.0, 0.35, fbmLod(n1, ax * 0.2, aw * 0.2, 2, 0.5));
        const density = clamp01(Math.max(cumulus, cirrus) * fade);
        if (density > 0) {
          const sx = Math.sin(SUN_AZ);
          const sz = Math.cos(SUN_AZ);
          const ahead = fbmLod(n1, (px + wx + sx * 0.1) * 1.3, (pz + wz + sz * 0.1) * 1.3, octaves, 0.52);
          const lit = clamp01(0.55 + 2.0 * (patch - ahead));
          const sunSide = toward ** 2;
          const shadowCol = mix([0.6, 0.6, 0.67], [0.66, 0.6, 0.62], sunSide);
          const litCol = mix([0.94, 0.88, 0.84], [1.0, 0.84, 0.62], sunSide);
          let cc = mix(shadowCol, litCol, lit * (0.6 + 0.4 * sunSide));
          cc = mix(cc, [0.95, 0.76, 0.55], 0.35 * band + 0.2 * (1 - smoothstep(4, 18, elevDeg)) * toward);
          c = mix(c, cc, density * 0.85);
        }
      } else {
        // Below the horizon: humid haze darkening towards -8 deg (normally hidden by the stadium).
        const t = smoothstep(0.5, -8, elevDeg);
        c = mix(c, [0.5, 0.47, 0.46], 0.55 * t);
      }
      const p = (y * W + x) * 3;
      d[p] = c[0];
      d[p + 1] = c[1];
      d[p + 2] = c[2];
    }
  }
  return supersample > 1 ? downsample(img, supersample) : img;
}
