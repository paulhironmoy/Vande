/**
 * Where the Three.js dead ball's card goes, from the stage's own protected regions at the dead ball (EVAL-WORLD K3).
 *
 * The card's own place is the bottom of the left column, below the rail (ResultLayer.module.css). On most balls the
 * ball's path is a central column and that place is clear. After a bouncer the view looks up and the incoming path
 * projects as a band across the whole lower part of the view (ref-5: `ball_path` regions from about 60% of the height
 * down, the full width, at 640, 844 and 915 px with both hands; measured in
 * release/product-sequence/stage-1-practice/wedge/worker/fix-round/), under any bottom-anchored card. Then:
 *
 * - Never covered: the ball's path, and `keepOut` (the field inset, MiniRadar.tsx FieldPip, which sits in the top
 *   corner opposite the card). A place is a candidate only when it overlaps neither and has room for the card's
 *   actions and a slice of its words (`minRoom`); the words scroll inside it if they must.
 * - The places, in order: its own column's bottom (its own place), its own column's first free stretch from the top
 *   (below the rail, above the path), the other column's bottom, the other column's first free stretch from the top.
 * - Of the candidates, the first that clears the stage's other protected regions too (the bat, the bowler, the pitch)
 *   and fits the card's whole content wins; then the first that clears them; then the first that fits; then the first.
 * - A card already in a candidate place stays there: it never jumps while its place is clear.
 * - When no place is clear the card stays in its own place, and `clear` says so (reported, never hidden).
 *
 * Pure geometry in CSS px of the view (the play root, which the stage's canvas fills); nothing here reads the DOM.
 */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type CardEdge = 'left' | 'right';
type CardAnchor = 'bottom' | 'top';
export interface CardSpot {
  edge: CardEdge;
  anchor: CardAnchor;
}

export interface CardPlacementInput {
  view: { width: number; height: number };
  /** The card's own edge (its place is that column's bottom), its width, and the height its content wants. */
  edge: CardEdge;
  width: number;
  naturalHeight: number;
  /** The measured bottom of each corner of the rail: a card always starts below its corner. */
  railBottom: { left: number; right: number };
  /** The card's inset from the view's side and bottom edges; its gap below the rail; its gap from a region. */
  inset: number;
  railGap: number;
  regionGap: number;
  /** The least height worth placing the card in (its actions and a slice of its words). */
  minRoom: number;
  /** The stage's `ball_path` regions at the dead ball: never covered. */
  ballPath: readonly Box[];
  /** Other things on screen the card never covers (the field inset). */
  keepOut?: readonly Box[];
  /** The stage's other protected regions (bat, bowler, pitch, release, contact): kept clear when a place allows. */
  other?: readonly Box[];
}

export interface CardPlacement extends CardSpot {
  /** CSS px from the view's top (top anchor) or its bottom (bottom anchor). */
  offset: number;
  /** The most height this place gives the card. */
  maxHeight: number;
  /** The card's box there, at its content's height (or the place's, if less). */
  box: Box;
  /** False only when no place clears the ball's path and the inset (then this is the card's own place). */
  clear: boolean;
}

export const overlaps = (a: Box, b: Box): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

const hardOf = (i: CardPlacementInput): Box[] => [...i.ballPath, ...(i.keepOut ?? [])];
const needOf = (i: CardPlacementInput) => Math.min(i.naturalHeight, i.minRoom);

/** The card at one place, or null when that place has no room for it. */
function placeAt(i: CardPlacementInput, spot: CardSpot): CardPlacement | null {
  const { edge, anchor } = spot;
  const x = edge === 'left' ? i.inset : i.view.width - i.inset - i.width;
  const top = (edge === 'left' ? i.railBottom.left : i.railBottom.right) + i.railGap;
  const bottom = i.view.height - i.inset;
  if (anchor === 'bottom') {
    const room = bottom - top;
    if (room <= 0) return null;
    const h = Math.min(i.naturalHeight, room);
    return {
      edge,
      anchor,
      offset: i.inset,
      maxHeight: room,
      box: { x, y: bottom - h, width: i.width, height: h },
      clear: true,
    };
  }
  // The column's first stretch, from below the rail down, between the things the card never covers.
  const need = needOf(i);
  const inColumn = hardOf(i)
    .filter((b) => b.x < x + i.width && x < b.x + b.width && b.y + b.height > top && b.y < bottom)
    .sort((a, b) => a.y - b.y);
  let y = top;
  let end = bottom;
  for (const b of inColumn) {
    if (b.y - i.regionGap - y >= need) {
      end = b.y - i.regionGap;
      break;
    }
    y = Math.max(y, b.y + b.height + i.regionGap);
  }
  const room = Math.min(end, bottom) - y;
  if (room <= 0) return null;
  const h = Math.min(i.naturalHeight, room);
  return { edge, anchor, offset: y, maxHeight: room, box: { x, y, width: i.width, height: h }, clear: true };
}

/** The places in their order: the card's own column's bottom first. */
function spotsOf(edge: CardEdge): CardSpot[] {
  const other: CardEdge = edge === 'left' ? 'right' : 'left';
  return [
    { edge, anchor: 'bottom' },
    { edge, anchor: 'top' },
    { edge: other, anchor: 'bottom' },
    { edge: other, anchor: 'top' },
  ];
}

const same = (a: CardSpot, b: CardSpot) => a.edge === b.edge && a.anchor === b.anchor;

/** The card's place: `current` (the place it is in now) is kept while it is a candidate. */
export function cardPlacement(i: CardPlacementInput, current?: CardSpot | null): CardPlacement {
  const need = needOf(i);
  const hard = hardOf(i);
  const candidate = (c: CardPlacement | null): c is CardPlacement =>
    c !== null && c.box.height >= need && !hard.some((b) => overlaps(c.box, b));
  const places = spotsOf(i.edge).map((spot) => placeAt(i, spot));
  const kept = current ? places.find((c) => c && same(c, current)) : null;
  if (kept && candidate(kept)) return kept;
  const ok = places.filter(candidate);
  const free = (c: CardPlacement) => !(i.other ?? []).some((b) => overlaps(c.box, b));
  const fits = (c: CardPlacement) => c.maxHeight >= i.naturalHeight;
  const best = ok.find((c) => free(c) && fits(c)) ?? ok.find(free) ?? ok.find(fits) ?? ok[0];
  if (best) return best;
  const own = places[0] ?? {
    edge: i.edge,
    anchor: 'bottom' as const,
    offset: i.inset,
    maxHeight: 0,
    box: { x: i.inset, y: i.view.height - i.inset, width: i.width, height: 0 },
  };
  return { ...own, clear: false };
}

/** True when the placement is the card's own place (its stylesheet already puts it there). */
export function isOwnPlace(p: CardSpot, edge: CardEdge): boolean {
  return p.edge === edge && p.anchor === 'bottom';
}

export interface BandPlacement {
  /** From the view's left and top (CSS px). */
  x: number;
  top: number;
  width: number;
  maxHeight: number;
  box: Box;
}

/**
 * The wide band (EVAL-WORLD K3, the lead's ruling): when the card must leave its own place and no column place holds
 * its words, it can lie across the free width instead, its words on the left and its actions on the right, so the
 * coach's tip is read at a glance. The band starts below both corners of the rail at the card's own edge (the left),
 * and is as wide as the view allows up to `maxWidth`, narrowed to end before anything it must never cover that reaches
 * into its first `need` px (the field inset in the top-right corner, a ball path rising at one side); its height runs
 * down to the first such thing below it. Null when it would be no wider than `minWidth` or shorter than `need`.
 */
export function bandAt(
  i: CardPlacementInput,
  o: { maxWidth: number; minWidth: number; need: number },
): BandPlacement | null {
  if (i.edge !== 'left') return null;
  const hard = hardOf(i);
  const x = i.inset;
  const top = Math.max(i.railBottom.left, i.railBottom.right) + i.railGap;
  const bottom = i.view.height - i.inset;
  let right = Math.min(x + o.maxWidth, i.view.width - i.inset);
  for (let guard = 0; guard <= hard.length; guard++) {
    if (right - x <= o.minWidth || bottom - top < o.need) return null;
    const over = hard.filter((b) => b.x < right && b.x + b.width > x && b.y + b.height > top && b.y < bottom);
    // Anything reaching into the band's first `need` px ends the band before it.
    const blockers = over.filter((b) => b.y - i.regionGap < top + o.need);
    if (blockers.length) {
      right = Math.min(...blockers.map((b) => b.x - i.regionGap));
      continue;
    }
    const limit = over.reduce((m, b) => Math.min(m, b.y - i.regionGap), bottom);
    const room = limit - top;
    if (room < o.need) return null;
    return { x, top, width: right - x, maxHeight: room, box: { x, y: top, width: right - x, height: room } };
  }
  return null;
}
