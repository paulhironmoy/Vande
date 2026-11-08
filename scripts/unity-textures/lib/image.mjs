/**
 * Float RGB images (values in display sRGB, 0..1, as Unity's Gamma colour space uses them) and the helpers the
 * texture generators share: statistics matching, box downsampling in linear light and dithered quantisation.
 */
import { hash3 } from './random.mjs';

export function createImage(width, height) {
  return { width, height, data: new Float32Array(width * height * 3) };
}

export function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function linearToSrgb(c) {
  const x = c < 0 ? 0 : c;
  return x <= 0.0031308 ? x * 12.92 : 1.055 * x ** (1 / 2.4) - 0.055;
}

/** Per-channel mean and standard deviation, in 0..255 units. */
export function channelStats(image) {
  const n = image.width * image.height;
  const mean = [0, 0, 0];
  const sq = [0, 0, 0];
  const d = image.data;
  for (let i = 0; i < n; i += 1) {
    for (let c = 0; c < 3; c += 1) {
      const v = d[i * 3 + c] * 255;
      mean[c] += v;
      sq[c] += v * v;
    }
  }
  const std = [0, 0, 0];
  for (let c = 0; c < 3; c += 1) {
    mean[c] /= n;
    std[c] = Math.sqrt(Math.max(0, sq[c] / n - mean[c] * mean[c]));
  }
  return { mean, std };
}

/**
 * Affine per-channel remap so the image has exactly the target mean and standard deviation (0..255 units). The
 * Unity materials' tints were calibrated against the replaced bitmaps' averages, so matching them keeps the rendered
 * colour without a C# change.
 */
export function matchStats(image, targetMean, targetStd) {
  const { mean, std } = channelStats(image);
  const d = image.data;
  const n = image.width * image.height;
  for (let c = 0; c < 3; c += 1) {
    const k = std[c] > 1e-6 ? targetStd[c] / std[c] : 1;
    for (let i = 0; i < n; i += 1) {
      d[i * 3 + c] = ((d[i * 3 + c] * 255 - mean[c]) * k + targetMean[c]) / 255;
    }
  }
}

/** Box-filter downsample by an integer factor, averaging in linear light. */
export function downsample(image, factor) {
  const w = Math.floor(image.width / factor);
  const h = Math.floor(image.height / factor);
  const out = createImage(w, h);
  const lut = new Float32Array(4097);
  for (let i = 0; i <= 4096; i += 1) lut[i] = srgbToLinear(i / 4096);
  const toLin = (v) => lut[Math.max(0, Math.min(4096, Math.round(v * 4096)))];
  const inv = 1 / (factor * factor);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < factor; sy += 1) {
        let p = ((y * factor + sy) * image.width + x * factor) * 3;
        for (let sx = 0; sx < factor; sx += 1) {
          r += toLin(image.data[p]);
          g += toLin(image.data[p + 1]);
          b += toLin(image.data[p + 2]);
          p += 3;
        }
      }
      const q = (y * w + x) * 3;
      out.data[q] = linearToSrgb(r * inv);
      out.data[q + 1] = linearToSrgb(g * inv);
      out.data[q + 2] = linearToSrgb(b * inv);
    }
  }
  return out;
}

/** Quantise to RGB8 with a deterministic +-0.5 LSB hash dither (removes banding in smooth gradients). */
export function quantise(image, seed, dither = true) {
  const n = image.width * image.height;
  const out = new Uint8Array(n * 3);
  for (let i = 0; i < n; i += 1) {
    const x = i % image.width;
    const y = (i - x) / image.width;
    const t = dither ? hash3(x, y, 7, seed) - 0.5 : 0;
    for (let c = 0; c < 3; c += 1) {
      const v = Math.round(image.data[i * 3 + c] * 255 + t);
      out[i * 3 + c] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
  }
  return out;
}

/**
 * Shift each channel to the target mean (0..255) and scale every channel's deviation by one common factor so the
 * luminance spread equals targetLumaStd. Unlike matchStats this keeps the texture's own hue structure.
 */
export function matchMeanAndLumaStd(image, targetMean, targetLumaStd) {
  const { mean } = channelStats(image);
  const d = image.data;
  const n = image.width * image.height;
  let lm = 0;
  let lsq = 0;
  for (let i = 0; i < n; i += 1) {
    const l = (0.2126 * d[i * 3] + 0.7152 * d[i * 3 + 1] + 0.0722 * d[i * 3 + 2]) * 255;
    lm += l;
    lsq += l * l;
  }
  lm /= n;
  const lstd = Math.sqrt(Math.max(1e-12, lsq / n - lm * lm));
  const k = targetLumaStd / lstd;
  for (let i = 0; i < n; i += 1) {
    for (let c = 0; c < 3; c += 1) d[i * 3 + c] = ((d[i * 3 + c] * 255 - mean[c]) * k + targetMean[c]) / 255;
  }
}
