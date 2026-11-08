#!/usr/bin/env node
/**
 * VANDE procedural Unity textures: deterministic, original replacements for the generated-bitmap candidates that the
 * owner ruled out on 2026-11-03 (free-only: no AI-generated sources). Every texture is drawn from code with a fixed
 * seed; nothing is downloaded, traced or copied.
 *
 *   node scripts/unity-textures/generate.mjs                 write all textures into the Unity Resources folder
 *   node scripts/unity-textures/generate.mjs --out DIR       write them into DIR instead
 *   node scripts/unity-textures/generate.mjs --only sky      one texture (repeatable)
 *   node scripts/unity-textures/generate.mjs --check         regenerate in memory and compare with the files in place
 *
 * File names and dimensions are those the Unity code loads (Resources.Load("Textures/<name>")), so no C# or import
 * setting changes. The stadium plate's world shape comes from CricketEnvironmentDimensions.StadiumBackdropAspect
 * (2172f / 724f) and its UVs run 0..1, so the texture's own pixel size does not set its shape: it is rendered at a
 * power-of-two 2048 x 1024 (lead-approved T2, 2026-11-03) so Unity's 1024 cap imports it at 1024 x 512 and compresses
 * it (DXT1 / ETC) instead of falling back to uncompressed RGB24 at the non-multiple-of-4 1024 x 341.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { quantise } from './lib/image.mjs';
import { decodePng, encodePng } from './lib/png.mjs';
import { hashString } from './lib/random.mjs';
import { sky } from './textures/sky.mjs';
import { stadium } from './textures/stadium.mjs';
import { grass, pitch, willow } from './textures/tiles.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(here, '..', '..');
export const UNITY_TEXTURES = join(
  REPO_ROOT,
  'unity/VandePractice/Assets/VandePractice/Runtime/Presentation/Resources/Textures',
);

/**
 * The replaced bitmaps' per-channel means (0..255), measured from the files with SHA-256 b57528ee… (pitch),
 * bb353adc… (grass) and b6f8bee1… (willow). The Unity materials' tints and gains were tuned against these averages,
 * so the procedural tiles reproduce them (the pitch deliberately 3.5% darker, below). lumaStd sets the luminance spread (originals: 17.8, 29.0, 6.3); the
 * pitch and grass are slightly calmer than the bitmaps they replace.
 */
export const TILE_TARGETS = {
  // The pitch is 3.5% darker than the bitmap it replaces: per-ball ring luminance on the pitch varies by up to +6%
  // (linear) with any new surface pattern, and this margin keeps the white ball's contrast from dropping on any of the
  // six reference balls (builder evidence in release/product-sequence/stage-1-practice/wedge/textures/).
  pitch: { mean: [183.7 * 0.965, 149.1 * 0.965, 97.6 * 0.965], lumaStd: 13.5 },
  grass: { mean: [59.7, 113.9, 26.5], lumaStd: 26 },
  willow: { mean: [240.0, 205.7, 157.6], lumaStd: 6.3 },
};

export const TEXTURES = [
  {
    id: 'UNITY-TEX-PITCH-002',
    replaces: 'UNITY-TEX-PITCH-001',
    file: 'pitch-balanced-albedo.png',
    width: 512,
    height: 512,
    seed: 'vande-pitch-balanced-v1',
    tileable: [true, true],
    build: (seed) => pitch({ size: 512, seed, target: TILE_TARGETS.pitch }),
  },
  {
    id: 'UNITY-TEX-GRASS-002',
    replaces: 'UNITY-TEX-GRASS-001',
    file: 'outfield-grass-albedo.png',
    width: 512,
    height: 512,
    seed: 'vande-outfield-grass-v1',
    tileable: [true, true],
    build: (seed) => grass({ size: 512, seed, target: TILE_TARGETS.grass }),
  },
  {
    id: 'UNITY-TEX-WILLOW-002',
    replaces: 'UNITY-TEX-WILLOW-001',
    file: 'bat-willow-albedo.png',
    width: 512,
    height: 512,
    seed: 'vande-willow-v1',
    tileable: [true, true],
    build: (seed) => willow({ size: 512, seed, target: TILE_TARGETS.willow }),
  },
  {
    id: 'UNITY-TEX-SKY-002',
    replaces: 'UNITY-TEX-SKY-001',
    file: 'sky-late-afternoon-panorama.png',
    width: 1024,
    height: 512,
    seed: 'vande-sky-late-afternoon-v1',
    tileable: [true, false],
    build: (seed) => sky({ width: 1024, height: 512, seed }),
  },
  {
    id: 'UNITY-TEX-STADIUM-DAY-003',
    replaces: 'UNITY-TEX-STADIUM-DAY-002',
    file: 'stadium-day-background-v2.png',
    width: 2048,
    height: 1024,
    seed: 'vande-stadium-day-v3',
    tileable: [false, false],
    build: (seed) => stadium({ width: 2048, height: 1024, seed }),
  },
];

/** Render one texture to { rgb, png, pixelSha256, pngSha256 }. */
export function render(entry, seed = entry.seed) {
  const image = entry.build(seed);
  if (image.width !== entry.width || image.height !== entry.height) {
    throw new Error(`${entry.file}: built ${image.width}x${image.height}, expected ${entry.width}x${entry.height}`);
  }
  const rgb = quantise(image, hashString(`${seed}/dither`));
  const png = encodePng(entry.width, entry.height, rgb);
  return {
    rgb,
    png,
    pixelSha256: createHash('sha256').update(rgb).digest('hex'),
    pngSha256: createHash('sha256').update(png).digest('hex'),
  };
}

function parseArgs(argv) {
  const args = { out: UNITY_TEXTURES, only: [], check: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--out') args.out = resolve(argv[(i += 1)]);
    else if (a === '--only') args.only.push(argv[(i += 1)]);
    else if (a === '--check') args.check = true;
    else throw new Error(`unknown argument ${a}`);
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const selected = TEXTURES.filter(
    (t) => args.only.length === 0 || args.only.some((o) => t.file.startsWith(o) || t.id.includes(o.toUpperCase())),
  );
  let failed = false;
  for (const entry of selected) {
    const started = Date.now();
    const result = render(entry);
    const ms = Date.now() - started;
    const path = join(args.out, entry.file);
    if (args.check) {
      if (!existsSync(path)) {
        console.log(`MISSING ${path}`);
        failed = true;
        continue;
      }
      const onDisk = decodePng(readFileSync(path));
      const same =
        onDisk.width === entry.width &&
        onDisk.height === entry.height &&
        Buffer.from(onDisk.rgb).equals(Buffer.from(result.rgb));
      console.log(`${same ? 'MATCH' : 'DIFFERS'} ${entry.file} pixels ${result.pixelSha256}`);
      if (!same) failed = true;
      continue;
    }
    mkdirSync(args.out, { recursive: true });
    writeFileSync(path, result.png);
    console.log(
      JSON.stringify({
        id: entry.id,
        file: entry.file,
        width: entry.width,
        height: entry.height,
        seed: entry.seed,
        bytes: result.png.length,
        pngSha256: result.pngSha256,
        pixelSha256: result.pixelSha256,
        ms,
      }),
    );
  }
  if (failed) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
