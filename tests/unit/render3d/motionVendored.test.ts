// @vitest-environment node
/**
 * The runtime's motion decoder is MOTION's, vendored unchanged: src/render3d/core/motion/vmp.ts must stay
 * byte-identical to scripts/motion/vmp.ts (MOTION-SPEC §4), so the web and the tools never decode differently.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('vendored VMP1 decoder', () => {
  it('src/render3d/core/motion/vmp.ts is byte-identical to scripts/motion/vmp.ts', () => {
    const vendored = readFileSync('src/render3d/core/motion/vmp.ts');
    const source = readFileSync('scripts/motion/vmp.ts');
    expect(vendored.equals(source), 're-copy scripts/motion/vmp.ts into src/render3d/core/motion/').toBe(true);
  });
});
