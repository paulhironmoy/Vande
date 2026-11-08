import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { REPO_ROOT, TEXTURES, TILE_TARGETS, UNITY_TEXTURES, render } from './generate.mjs';
import { decodePng, encodePng } from './lib/png.mjs';
import { PLATE, SIGHT_SCREEN, screenUvBounds } from './textures/stadium.mjs';

const ENVIRONMENT_CS = join(
  REPO_ROOT,
  'unity/VandePractice/Assets/VandePractice/Runtime/Presentation/Production/Environment/ProductionCricketEnvironment.cs',
);

const cache = new Map();
function rendered(entry) {
  if (!cache.has(entry.file)) cache.set(entry.file, render(entry));
  return cache.get(entry.file);
}

function pngSize(png) {
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20), colourType: png[25], bitDepth: png[24] };
}

/** Mean absolute difference across the wrap edge, relative to the mean difference between interior neighbours. */
function seamRatio(rgb, width, height, axis) {
  let edge = 0;
  let inner = 0;
  let n = 0;
  let m = 0;
  if (axis === 'x') {
    for (let y = 0; y < height; y += 1) {
      for (let c = 0; c < 3; c += 1) {
        edge += Math.abs(rgb[(y * width) * 3 + c] - rgb[(y * width + width - 1) * 3 + c]);
        n += 1;
        for (let x = 1; x < width; x += 1) {
          inner += Math.abs(rgb[(y * width + x) * 3 + c] - rgb[(y * width + x - 1) * 3 + c]);
          m += 1;
        }
      }
    }
  } else {
    for (let x = 0; x < width; x += 1) {
      for (let c = 0; c < 3; c += 1) {
        edge += Math.abs(rgb[x * 3 + c] - rgb[((height - 1) * width + x) * 3 + c]);
        n += 1;
        for (let y = 1; y < height; y += 1) {
          inner += Math.abs(rgb[(y * width + x) * 3 + c] - rgb[((y - 1) * width + x) * 3 + c]);
          m += 1;
        }
      }
    }
  }
  return edge / n / (inner / m);
}

describe('VANDE procedural Unity textures', () => {
  it('encodes and decodes PNG pixels losslessly', () => {
    const w = 7;
    const h = 5;
    const rgb = new Uint8Array(w * h * 3).map((_, i) => (i * 37 + (i >> 3) * 11) & 0xff);
    const back = decodePng(encodePng(w, h, rgb));
    assert.equal(back.width, w);
    assert.equal(back.height, h);
    assert.deepEqual(Buffer.from(back.rgb), Buffer.from(rgb));
  });

  for (const entry of TEXTURES) {
    describe(entry.file, () => {
      it('is deterministic: the same seed gives the same PNG bytes', () => {
        const a = rendered(entry);
        const b = render(entry);
        assert.ok(a.png.equals(b.png), `${entry.file}: two renders with seed ${entry.seed} differ`);
      });

      it('has the dimensions and format the Unity code expects (8-bit RGB)', () => {
        const size = pngSize(rendered(entry).png);
        assert.equal(size.width, entry.width);
        assert.equal(size.height, entry.height);
        assert.equal(size.bitDepth, 8);
        assert.equal(size.colourType, 2);
      });

      for (const [axis, wraps] of [['x', entry.tileable[0]], ['y', entry.tileable[1]]]) {
        if (!wraps) continue;
        it(`wraps seamlessly along ${axis}`, () => {
          const { rgb } = rendered(entry);
          const ratio = seamRatio(rgb, entry.width, entry.height, axis);
          assert.ok(ratio < 1.6, `${entry.file}: seam ${axis} is ${ratio.toFixed(2)}x the interior neighbour difference`);
        });
      }

      it('matches the file in the Unity Resources folder pixel for pixel', () => {
        const onDisk = decodePng(readFileSync(join(UNITY_TEXTURES, entry.file)));
        assert.equal(onDisk.width, entry.width);
        assert.equal(onDisk.height, entry.height);
        assert.ok(
          Buffer.from(onDisk.rgb).equals(Buffer.from(rendered(entry).rgb)),
          `${entry.file} in Unity differs from the generator output; run node scripts/unity-textures/generate.mjs`,
        );
      });
    });
  }

  it('a different seed gives a different texture', () => {
    const entry = TEXTURES.find((t) => t.file === 'bat-willow-albedo.png');
    assert.ok(!render(entry, 'another-seed').png.equals(rendered(entry).png));
  });

  it('keeps each tile at the replaced bitmap mean so the Unity tints stay calibrated', () => {
    for (const [key, file] of [
      ['pitch', 'pitch-balanced-albedo.png'],
      ['grass', 'outfield-grass-albedo.png'],
      ['willow', 'bat-willow-albedo.png'],
    ]) {
      const { rgb } = rendered(TEXTURES.find((t) => t.file === file));
      const mean = [0, 0, 0];
      for (let i = 0; i < rgb.length; i += 3) for (let c = 0; c < 3; c += 1) mean[c] += rgb[i + c];
      for (let c = 0; c < 3; c += 1) {
        mean[c] /= rgb.length / 3;
        assert.ok(Math.abs(mean[c] - TILE_TARGETS[key].mean[c]) < 1.0, `${key} channel ${c}: ${mean[c]}`);
      }
    }
  });

  it('uses the plate geometry and sight screen the C# environment declares', () => {
    const cs = readFileSync(ENVIRONMENT_CS, 'utf8');
    const constant = (name) => {
      const m = cs.match(new RegExp(`const float ${name} = ([^;]+);`));
      assert.ok(m, `${name} not found in ProductionCricketEnvironment.cs`);
      return m[1].trim();
    };
    assert.equal(constant('BoundaryRadius'), '62f');
    assert.equal(constant('StadiumBackdropDistance'), 'BoundaryRadius + 2.8f');
    assert.equal(constant('StadiumBackdropWidth'), '112f');
    assert.equal(constant('StadiumBackdropAspect'), '2172f / 724f');
    assert.equal(constant('StadiumBackdropCenterY'), '9.2f');
    assert.equal(constant('SightScreenWidth'), '18f');
    assert.equal(constant('SightScreenHeight'), '7.5f');
    assert.ok(cs.includes('Resources.Load<Texture2D>("Textures/stadium-day-background-v2")'));
    assert.ok(Math.abs(PLATE.radius - 64.8) < 1e-9);
    assert.ok(Math.abs(PLATE.aspect - 2172 / 724) < 1e-12);
  });

  it('paints a plain matte near-black sight screen over the whole red-ball cutout rectangle', () => {
    const entry = TEXTURES.find((t) => t.file === 'stadium-day-background-v2.png');
    const { rgb } = rendered(entry);
    const [u0, u1, v0, v1] = screenUvBounds();
    // The EditMode test's own ranges for the same bounds.
    assert.ok(u0 >= 0.4 && u0 <= 0.41 && u1 >= 0.59 && u1 <= 0.6 && v0 >= 0.24 && v0 <= 0.27 && v1 >= 0.44 && v1 <= 0.47);
    let n = 0;
    let max = 0;
    const sum = [0, 0, 0];
    for (let j = 0; j < entry.height; j += 1) {
      const v = 1 - (j + 0.5) / entry.height;
      if (v < v0 || v > v1) continue;
      for (let i = 0; i < entry.width; i += 1) {
        const u = (i + 0.5) / entry.width;
        if (u < u0 || u > u1) continue;
        for (let c = 0; c < 3; c += 1) {
          const value = rgb[(j * entry.width + i) * 3 + c] / 255;
          sum[c] += value;
          max = Math.max(max, value);
        }
        n += 1;
      }
    }
    assert.ok(n > 30000, `screen region too small: ${n} texels`);
    for (let c = 0; c < 3; c += 1) assert.ok(Math.abs(sum[c] / n - SIGHT_SCREEN.colour[c]) < 0.01, `channel ${c}`);
    assert.ok(max < 0.1, `brightest screen texel ${max}`);
  });
});
