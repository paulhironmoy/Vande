#!/usr/bin/env node
/**
 * Hero plates (ASSETS-VENUE): turns a capture of the venue's hero frame (scripts/venue/capture.mjs, view `venue-hero`) into
 * the two WebP plates the first screens use, 3:1 at 2048 x 683 and 1280 x 427, and checks the composition rules of the
 * Definition of Done VEN-11 and ruling R-10: the left 30% and the right 18% of the top half stay calm for the HUD, and the
 * centre 40% stays calm for the target card. "Calm" is measured as texture energy (the mean standard deviation of luminance
 * in 8 x 8 pixel blocks) against the plate's lower outer thirds (REFERENCE, never darkened), on the pixels that ship; where a zone is busier than its limit it is darkened
 * towards a dark navy scrim with a wide soft edge (a vignette), no more than needed. No players are drawn (the hero view has none), and the picture is a deterministic
 * render of the repository's own stadium code, so a rerun on the same capture gives the same bytes.
 *
 *   node scripts/venue/plate.mjs --in capture.png --name evening --out DIR
 *
 * Writes DIR/hero-<name>-2048.webp, DIR/hero-<name>-1280.webp and DIR/hero-<name>.json (sizes, quality, zone numbers before and
 * after, sha256). Byte ceilings: 130,000 B and 60,000 B (VENUE-PLAN.md section 4).
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import sharp from 'sharp';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? dflt : process.argv[i + 1];
};

export const SIZES = [
  { width: 2048, ceiling: 130_000 },
  { width: 1280, ceiling: 60_000 },
];
/** Zones as fractions of the plate: [x0, y0, x1, y1], the energy limit relative to the reference thirds and the soft edge (a fraction of the width). */
export const ZONES = {
  hudLeft: { rect: [0, 0, 0.3, 0.5], limit: 0.6, feather: 0.12 },
  hudRight: { rect: [0.82, 0, 1, 0.5], limit: 0.6, feather: 0.12 },
  card: { rect: [0.3, 0.25, 0.7, 0.75], limit: 1.0, feather: 0.1 },
};

const luma = (rgb, i) => 0.2126 * rgb[i] + 0.7152 * rgb[i + 1] + 0.0722 * rgb[i + 2];

/** Mean standard deviation of luminance over 8 x 8 blocks inside a pixel rectangle. */
export function energy(rgb, w, h, [x0, y0, x1, y1]) {
  let sum = 0;
  let n = 0;
  for (let by = Math.floor(y0); by + 8 <= Math.ceil(y1); by += 8) {
    for (let bx = Math.floor(x0); bx + 8 <= Math.ceil(x1); bx += 8) {
      let s = 0;
      let s2 = 0;
      for (let y = by; y < by + 8; y++)
        for (let x = bx; x < bx + 8; x++) {
          const l = luma(rgb, (y * w + x) * 3);
          s += l;
          s2 += l * l;
        }
      sum += Math.sqrt(Math.max(0, s2 / 64 - (s / 64) ** 2));
      n++;
    }
  }
  return n ? sum / n : 0;
}

const px = (w, h, [a, b, c, d]) => [a * w, b * h, c * w, d * h];

/**
 * The yardstick for "calm": the texture energy of the plate's lower outer thirds (the field, the rope and the lower tier either
 * side of the card, which nothing in this file ever darkens). Measuring zones against the whole plate would not work: darkening the busy
 * upper zones lowers the whole plate's energy too and the ratio would never settle.
 */
export const REFERENCE = [
  [0, 0.5, 0.3, 1],
  [0.7, 0.5, 1, 1],
];
export function referenceEnergy(rgb, w, h) {
  return REFERENCE.reduce((sum, rect) => sum + energy(rgb, w, h, px(w, h, rect)), 0) / REFERENCE.length;
}
const smooth = (t) => t * t * (3 - 2 * t);

/** Feathered mask of a zone: 1 inside, falling to 0 over `feather` of the plate's width outside. */
function maskAt(x, y, w, h, [a, b, c, d], feather) {
  const f = feather * w;
  const dx = Math.max(a * w - x, 0, x - c * w);
  const dy = Math.max(b * h - y, 0, y - d * h);
  return 1 - smooth(Math.min(1, Math.hypot(dx, dy) / f));
}

/** The scrim colour: a very dark navy, the colour the shell's own overlay darkens to. */
const SCRIM = [8, 12, 28];

/**
 * The raw plate with each calm zone darkened towards the scrim by its weight, with a wide soft edge: a vignette, which lowers
 * the zone's contrast in proportion without a visible window (a blur left a hard-looking box around the zone).
 */
function compose(raw, width, height, weights) {
  const out = Buffer.from(raw);
  for (const [zone, { rect, feather }] of Object.entries(ZONES)) {
    const weight = weights[zone];
    if (weight <= 0) continue;
    const reach = Math.ceil(feather * width);
    const bx0 = Math.max(0, Math.floor(rect[0] * width - reach));
    const bx1 = Math.min(width, Math.ceil(rect[2] * width + reach));
    const by0 = Math.max(0, Math.floor(rect[1] * height - reach));
    const by1 = Math.min(height, Math.ceil(rect[3] * height + reach));
    for (let y = by0; y < by1; y++)
      for (let x = bx0; x < bx1; x++) {
        const m = maskAt(x, y, width, height, rect, feather) * weight;
        if (m <= 0) continue;
        const i = (y * width + x) * 3;
        for (let c = 0; c < 3; c++) out[i + c] = Math.round(out[i + c] * (1 - m) + SCRIM[c] * m);
      }
  }
  return out;
}

/** Highest WebP quality that fits the ceiling (deterministic bisection). */
async function encodeWithin(rgb, width, height, ceiling) {
  let lo = 40;
  let hi = 92;
  let best = null;
  while (lo <= hi) {
    const q = (lo + hi) >> 1;
    const buf = await sharp(rgb, { raw: { width, height, channels: 3 } }).webp({ quality: q, effort: 6, smartSubsample: false }).toBuffer();
    if (buf.length <= ceiling) {
      best = { q, buf };
      lo = q + 1;
    } else hi = q - 1;
  }
  if (!best) throw new Error(`no WebP quality fits ${ceiling} B at ${width} px`);
  return best;
}

export async function makePlate(inputPath, outDir, name) {
  const meta = await sharp(inputPath).metadata();
  // Centre-crop to exactly 3:1, then to the largest size.
  const w3 = Math.min(meta.width, meta.height * 3);
  const h3 = Math.round(w3 / 3);
  const left = Math.floor((meta.width - w3) / 2);
  const top = Math.floor((meta.height - h3) / 2);
  const base = sharp(inputPath).extract({ left, top, width: w3, height: h3 }).removeAlpha();
  mkdirSync(outDir, { recursive: true });
  const report = { name, source: { width: meta.width, height: meta.height }, plates: [] };
  const measure = (rgb, width, height) => {
    const ref = referenceEnergy(rgb, width, height);
    return Object.fromEntries(Object.entries(ZONES).map(([zone, { rect }]) => [zone, energy(rgb, width, height, px(width, height, rect)) / ref]));
  };
  for (const { width, ceiling } of SIZES) {
    const height = Math.round(width / 3);
    const raw = await base.clone().resize(width, height, { kernel: 'lanczos3' }).raw().toBuffer();
    const before = measure(raw, width, height);
    // The zones are judged on the pixels that ship (the decoded WebP): lossy coding smooths the busy parts of the plate, so a
    // zone's energy rises after encoding. The weights are searched on the raw composition with a safety
    // margin below each limit (darken a zone in steps of 0.05, at most 0.8); the encoded file is then decoded and judged, and the
    // margin is tightened until it passes.
    let weights = null;
    let best = null;
    let after = null;
    let margin = 0.9;
    for (let attempt = 0; attempt < 10 && !after; attempt++) {
      weights = Object.fromEntries(Object.keys(ZONES).map((z) => [z, 0]));
      let composed = raw;
      for (let round = 0; round < 17; round++) {
        composed = compose(raw, width, height, weights);
        const m = measure(composed, width, height);
        const over = Object.entries(ZONES).filter(([zone, { limit }]) => m[zone] > limit * margin);
        if (!over.length) break;
        for (const [zone] of over) weights[zone] = Math.min(0.8, weights[zone] + 0.05);
      }
      best = await encodeWithin(composed, width, height, ceiling);
      const judged = measure(await sharp(best.buf).removeAlpha().raw().toBuffer(), width, height);
      if (Object.entries(ZONES).every(([zone, { limit }]) => judged[zone] <= limit)) after = judged;
      else margin *= 0.85;
    }
    if (!after) throw new Error(`the calm zones cannot be met at ${width} px`);
    const file = `hero-${name}-${width}.webp`;
    writeFileSync(join(outDir, file), best.buf);
    report.plates.push({
      file,
      width,
      height,
      aspect: width / height,
      bytes: best.buf.length,
      ceiling,
      quality: best.q,
      sha256: createHash('sha256').update(best.buf).digest('hex'),
      zoneEnergyVsPlateBeforeCalming: before,
      calmWeights: weights,
      zoneEnergyVsPlateInShippedFile: after,
      limits: Object.fromEntries(Object.entries(ZONES).map(([k, v]) => [k, v.limit])),
    });
  }
  writeFileSync(join(outDir, `hero-${name}.json`), JSON.stringify(report, null, 2));
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const report = await makePlate(resolve(arg('in')), resolve(arg('out', '.')), arg('name', 'plate'));
  for (const p of report.plates) console.log(`${p.file}: ${p.bytes} B (ceiling ${p.ceiling}), q${p.quality}, aspect ${p.aspect.toFixed(3)}, zones in the shipped file ${JSON.stringify(Object.fromEntries(Object.entries(p.zoneEnergyVsPlateInShippedFile).map(([k, v]) => [k, +v.toFixed(2)])))}`);
}
