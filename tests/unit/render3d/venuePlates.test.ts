/**
 * The hero plates (public/practice/venue/): sizes within their byte ceilings, exactly 3:1 at 2048 x 683 and 1280 x 427, the
 * composition rules of ruling R-10 and the Definition of Done VEN-11 (the left 30% and right 18% of the top half calm for the HUD,
 * the centre 40% calm for the target card, measured as texture energy against the reference thirds), and no text or player drawn
 * (the plates are captures of the stadium alone: the gallery's own text is hidden). Pixel checks on the shipped WebP files.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { ZONES, energy, referenceEnergy } from '../../../scripts/venue/plate.mjs';

const ROOT = join(__dirname, '..', '..', '..');
const PLATES = [
  { file: 'public/practice/venue/hero-evening-1280.webp', width: 1280, height: 427, ceiling: 60_000 },
  { file: 'public/practice/venue/hero-day-1280.webp', width: 1280, height: 427, ceiling: 60_000 },
  { file: 'public/practice/venue/wide/hero-evening-2048.webp', width: 2048, height: 683, ceiling: 130_000 },
  { file: 'public/practice/venue/wide/hero-day-2048.webp', width: 2048, height: 683, ceiling: 130_000 },
] as const;

describe('the hero plates', () => {
  for (const p of PLATES) {
    it(`${p.file}: ${p.width}x${p.height}, within ${p.ceiling} B, with calm zones`, async () => {
      const bytes = readFileSync(join(ROOT, p.file));
      expect(bytes.length).toBeLessThanOrEqual(p.ceiling);
      expect(bytes.length).toBeGreaterThan(10_000);
      const { data, info } = await sharp(bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      expect([info.width, info.height]).toEqual([p.width, p.height]);
      expect(Math.abs(info.width / info.height - 3)).toBeLessThan(0.01);
      const reference = referenceEnergy(data, info.width, info.height);
      for (const [zone, { rect, limit }] of Object.entries(ZONES)) {
        const [a, b, c, d] = rect as number[];
        const e =
          energy(data, info.width, info.height, [a * info.width, b * info.height, c * info.width, d * info.height]) /
          reference;
        expect(e, `${zone} texture energy against the reference thirds`).toBeLessThanOrEqual(limit + 0.02);
      }
    });
  }

  it('the gallery text is not in any plate: its top-left corner is as calm as the sky around it', async () => {
    for (const p of PLATES) {
      const { data, info } = await sharp(join(ROOT, p.file)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      const corner = energy(data, info.width, info.height, [0, 0, info.width * 0.12, info.height * 0.08]);
      expect(corner, p.file).toBeLessThan(6);
    }
  });
});
