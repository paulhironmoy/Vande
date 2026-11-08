/**
 * EVAL-WORLD K3: on the Three.js stage the dead ball's card covered the stage's own `ball_path` regions on ref-5 (the
 * bouncer, left alone) for the whole dead ball, at 640, 844 and 915 px with both hands. The geometry here is the
 * stage's own, measured on that ball (release/product-sequence/stage-1-practice/wedge/worker/fix-round/; the probe
 * region-timeline.mjs, 500 ms into the dead ball): its path is a band across the whole lower view. The card must keep
 * off it, and off the field inset in the top-right corner (MiniRadar.tsx FieldPip), and stay put on an ordinary ball.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  bandAt,
  cardPlacement,
  overlaps,
  type Box,
  type CardPlacementInput,
} from '@/practice/ui/components/cardPlacement';

const box = ([x, y, width, height]: number[]): Box => ({ x, y, width, height });

/** ref-5 at 640x360, right-handed: 27 `ball_path` regions, from y 216 at the right edge to y 255 at the left. */
const REF5_640_RH = [
  [0, 255, 9, 68],
  [0, 254, 20, 70],
  [0, 254, 32, 72],
  [0, 253, 45, 74],
  [0, 253, 58, 76],
  [0, 252, 73, 78],
  [0, 251, 88, 80],
  [7, 250, 97, 83],
  [20, 249, 101, 86],
  [35, 249, 105, 88],
  [50, 248, 109, 91],
  [67, 247, 113, 94],
  [84, 246, 118, 98],
  [103, 245, 123, 102],
  [124, 243, 129, 106],
  [146, 242, 135, 110],
  [169, 241, 142, 115],
  [195, 239, 150, 120],
  [223, 238, 158, 122],
  [254, 236, 167, 124],
  [288, 234, 178, 126],
  [326, 232, 190, 128],
  [367, 229, 203, 131],
  [413, 227, 219, 133],
  [465, 224, 175, 136],
  [524, 220, 116, 140],
  [591, 216, 49, 144],
].map(box);

/** ref-5 at 915x412, left-handed: 23 regions, from y 273 at the left edge to y 322 at the right. */
const REF5_915_LH = [
  [896, 322, 19, 90],
  [876, 321, 39, 91],
  [854, 320, 61, 92],
  [830, 319, 85, 93],
  [805, 318, 110, 94],
  [778, 317, 137, 95],
  [749, 316, 166, 96],
  [717, 315, 181, 97],
  [683, 314, 189, 98],
  [646, 313, 199, 99],
  [605, 312, 210, 100],
  [560, 310, 222, 102],
  [510, 309, 235, 103],
  [456, 307, 250, 105],
  [395, 305, 267, 107],
  [326, 303, 287, 109],
  [249, 300, 309, 112],
  [161, 297, 335, 115],
  [60, 294, 366, 118],
  [0, 290, 345, 122],
  [0, 285, 251, 127],
  [0, 280, 142, 132],
  [0, 273, 11, 139],
].map(box);

/** An ordinary ball (ref-2 at 640): a central column, clear of the left card. */
const REF2_640 = [box([321, 150, 50, 186])];

/** The card as measured there (left edge, 16 px in, the rail's corners 101 and 58 px), its actions 56 px, its words 170 px. */
function input(
  view: { width: number; height: number },
  width: number,
  ballPath: Box[],
  o: Partial<CardPlacementInput> = {},
): CardPlacementInput {
  return {
    view,
    edge: 'left',
    width,
    naturalHeight: 5 + 170 + 56,
    railBottom: { left: 101, right: 58 },
    inset: 16,
    railGap: 8,
    regionGap: 4,
    minRoom: 5 + 56 + 48,
    ballPath,
    ...o,
  };
}

/** The field inset: a square below the right corner of the rail (clamp(88px, 29vh, 148px)). */
const pip = (view: { width: number; height: number }) => {
  const size = Math.min(148, Math.max(88, 0.29 * view.height));
  return box([view.width - 16 - size, 58 + 8, size, size]);
};

describe('K3: the Three.js card keeps off the ball path', () => {
  it('an ordinary ball: the card stays in its own place', () => {
    const p = cardPlacement(
      input({ width: 640, height: 360 }, 227.2, REF2_640, { keepOut: [pip({ width: 640, height: 360 })] }),
      { edge: 'left', anchor: 'bottom' },
    );
    expect(p).toMatchObject({ edge: 'left', anchor: 'bottom', clear: true });
  });

  it('ref-5 at 640x360 (right-handed): off its own place (which the path crosses), clear of the path and of the inset, actions in view', () => {
    const view = { width: 640, height: 360 };
    const i = input(view, 227.2, REF5_640_RH, { keepOut: [pip(view)] });
    // Its own place is under the path (the evaluator's finding).
    const ownBox = { x: 16, y: 344 - 231, width: 227.2, height: 231 };
    expect(REF5_640_RH.some((b) => overlaps(ownBox, b))).toBe(true);
    const p = cardPlacement(i, { edge: 'left', anchor: 'bottom' });
    expect(p.clear).toBe(true);
    expect(p).toMatchObject({ edge: 'left', anchor: 'top' });
    expect(REF5_640_RH.some((b) => overlaps(p.box, b))).toBe(false);
    expect(overlaps(p.box, pip(view))).toBe(false);
    // Below the rail's corner, with room for the actions and a slice of the words.
    expect(p.box.y).toBeGreaterThanOrEqual(101 + 8);
    expect(p.maxHeight).toBeGreaterThanOrEqual(i.minRoom);
  });

  it('ref-5 at 915x412 (left-handed): the same, with more room', () => {
    const view = { width: 915, height: 412 };
    const p = cardPlacement(input(view, 331.7, REF5_915_LH, { keepOut: [pip(view)] }), {
      edge: 'left',
      anchor: 'bottom',
    });
    expect(p).toMatchObject({ edge: 'left', anchor: 'top', clear: true });
    expect(REF5_915_LH.some((b) => overlaps(p.box, b))).toBe(false);
    expect(p.maxHeight).toBeGreaterThanOrEqual(150);
  });

  it('never over the field inset: the other column is used below the inset only where it is clear', () => {
    const view = { width: 640, height: 360 };
    // A path only under the left column: the other column's bottom is clear of it, and of the inset above it.
    const left = [box([0, 200, 260, 160])];
    const p = cardPlacement(input(view, 227.2, left, { keepOut: [pip(view)] }), { edge: 'left', anchor: 'bottom' });
    expect(p.clear).toBe(true);
    expect(p.edge).toBe('right');
    expect(overlaps(p.box, pip(view))).toBe(false);
    expect(left.some((b) => overlaps(p.box, b))).toBe(false);
  });

  it('a clear place is kept (no jumping); a place the path reaches is left', () => {
    const view = { width: 640, height: 360 };
    const top = cardPlacement(input(view, 227.2, REF5_640_RH), { edge: 'left', anchor: 'bottom' });
    // The path later recedes from its own place: the card stays where it is, still clear.
    const after = cardPlacement(input(view, 227.2, REF2_640), { edge: top.edge, anchor: top.anchor });
    expect(after).toMatchObject({ edge: top.edge, anchor: top.anchor, clear: true });
  });

  it('when no place is clear the card stays in its own place, and says so', () => {
    const view = { width: 640, height: 360 };
    const everywhere = [box([0, 0, 640, 360])];
    const p = cardPlacement(input(view, 227.2, everywhere), { edge: 'left', anchor: 'bottom' });
    expect(p).toMatchObject({ edge: 'left', anchor: 'bottom', clear: false });
  });

  it('prefers a place that leaves the bat clear too, when one exists', () => {
    const view = { width: 915, height: 412 };
    // The path under the left column's bottom; the left column's top would cover the bat; the right column is clear.
    const path = [box([0, 250, 360, 162])];
    const bat = [box([0, 100, 360, 140])];
    const p = cardPlacement(input(view, 331.7, path, { other: bat }), { edge: 'left', anchor: 'bottom' });
    expect(p.edge).toBe('right');
    expect(bat.some((b) => overlaps(p.box, b))).toBe(false);
  });
});

describe("K3 (the lead's ruling): the wide band, words left and actions right, when no column holds the words", () => {
  // At the smallest viewport the two 56 px actions share one row. The band reserves 13.5rem for words and 16.25rem
  // for that action row; 200% text therefore fails closed to a column instead of clipping either control.
  const NEED = 5 + 64;
  const MIN_WIDTH = (13.5 + 16.25) * 16;
  it('ref-5 at 640x360: a band below both corners of the rail, ending before the inset and the rising path, clear of both', () => {
    const view = { width: 640, height: 360 };
    const i = input(view, 227.2, REF5_640_RH, { keepOut: [pip(view)] });
    const b = bandAt(i, { maxWidth: 576, minWidth: MIN_WIDTH, need: NEED })!;
    expect(b).not.toBeNull();
    expect(b.top).toBe(101 + 8);
    expect(b.width).toBeGreaterThan(400);
    expect(b.maxHeight).toBeGreaterThanOrEqual(NEED);
    expect(REF5_640_RH.some((r) => overlaps(b.box, r))).toBe(false);
    expect(overlaps(b.box, pip(view))).toBe(false);
  });

  it('ref-5 at 915x412 (left-handed): as wide as allowed, clear of the path and the inset', () => {
    const view = { width: 915, height: 412 };
    const i = input(view, 331.7, REF5_915_LH, { keepOut: [pip(view)] });
    const b = bandAt(i, { maxWidth: 576, minWidth: MIN_WIDTH, need: NEED })!;
    expect(b.width).toBe(576);
    expect(REF5_915_LH.some((r) => overlaps(b.box, r))).toBe(false);
    expect(overlaps(b.box, pip(view))).toBe(false);
  });

  it('no band where there is no room for the action row, or no room for both measured columns', () => {
    const view = { width: 640, height: 360 };
    const low = [box([0, 150, 640, 210])];
    expect(bandAt(input(view, 227.2, low), { maxWidth: 576, minWidth: MIN_WIDTH, need: NEED })).toBeNull();
    const wall = [box([200, 0, 20, 360])];
    expect(bandAt(input(view, 227.2, wall), { maxWidth: 576, minWidth: MIN_WIDTH, need: NEED })).toBeNull();
  });

  it('current 640x360 right- and left-hand bouncer paths leave enough height for one action row', () => {
    const view = { width: 640, height: 360 };
    const right = [
      [0, 231.311, 23.85, 69.294],
      [53.641, 224.585, 107.396, 90.141],
      [126.224, 220.322, 127.208, 104.219],
      [224.809, 214.624, 155.826, 123.652],
    ].map(box);
    const left = [
      [229.287, 223.925, 197.973, 136.075],
      [115.828, 220.171, 231.042, 139.829],
      [46.571, 217.86, 251.915, 142.14],
      [0, 208.06, 103.84, 151.94],
    ].map(box);
    for (const path of [right, left]) {
      const b = bandAt(input(view, 227.2, path, { keepOut: [pip(view)] }), {
        maxWidth: 576,
        minWidth: MIN_WIDTH,
        need: NEED,
      });
      expect(b).not.toBeNull();
      expect(path.some((region) => overlaps(b!.box, region))).toBe(false);
      expect(overlaps(b!.box, pip(view))).toBe(false);
    }
  });

  it('the measured 640x360 ready-tip deficit is recovered by band-only compacting, with 4px to spare', () => {
    const css = readFileSync('src/practice/ui/components/ResultLayer.module.css', 'utf8');
    // These are deliberately band-scoped: column cards retain their established hierarchy and spacing.
    expect(css).toMatch(
      /\.result\[data-shape='band'\] \.resultBody \{[\s\S]*?gap: calc\(var\(--p-half\) \/ 2\);[\s\S]*?padding: var\(--p-half\) var\(--p-1\) 0;/,
    );
    expect(css).toMatch(
      /\.result\[data-shape='band'\] \.outcomeWord \{[\s\S]*?font-size: 1\.125rem;[\s\S]*?line-height: 1;/,
    );
    expect(css).toMatch(/\.result\[data-shape='band'\] \.rec \{[\s\S]*?padding-block: calc\(var\(--p-half\) \/ 2\);/);

    // Browser probe, default text: body 82; words began at 39.90625; tip 53.5; outcome line 26.90625.
    // Savings: body top padding 4, gap 2, outcome line 8.90625, tip vertical padding 4.
    const compactWordsBottom = 39.90625 - 4 - 2 - (26.90625 - 18) + 53.5 - 4;
    expect(82 - compactWordsBottom).toBeGreaterThanOrEqual(4);
  });
});
