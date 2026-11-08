/**
 * Keeps the Three.js dead ball's card off the ball's path and off the field inset (EVAL-WORLD K3; the rules are
 * cardPlacement.ts's), with the coach's tip readable at a glance.
 *
 * The consequence camera is still moving as the ball goes dead, and its first frames project the ball's path across
 * places it soon leaves (measured: on balls 3, 4 and 6 of the reference over a card placed at once moved for a path
 * that was gone within about 100 ms). So the card waits, unseen (`data-placing`, ResultLayer.module.css), until the
 * camera has settled (CARD_SETTLE_MS), is placed then, and only then arrives. The stage's regions and the inset's box
 * (`[data-pip]`) are read again later (CARD_PLACE_CHECKS_MS), whenever the card's size changes (the coach's words
 * arriving, "Why?" opening) and when the view is resized. A card in a clear place stays there.
 *
 * When the card must leave its own place and no column place holds all of its words, it lies across the free width as
 * a band (`data-shape="band"`: the words on the left, the actions in one row on the right), if the tip is then wholly in view
 * without scrolling; otherwise it takes the clear column place (its words scroll). Only in landscape (the portrait
 * bottom sheet is unchanged), and only when the app gives `regions` (the Three.js stage: StageRegionsContext,
 * PracticeApp.tsx). Every measurement and its result happen in one layout pass, so nothing stale is ever painted.
 */
import { useLayoutEffect, useRef, type RefObject } from 'react';
import type { StageRegion } from '../flow/stageTypes';
import { bandAt, cardPlacement, isOwnPlace, type BandPlacement, type Box, type CardEdge, type CardPlacement, type CardPlacementInput, type CardSpot } from './cardPlacement';

/** The camera has settled this long after the ball goes dead (measured: the transient is over within about 100 ms). */
const CARD_SETTLE_MS = 120;
/** Later reads of the stage's regions (ms after the ball goes dead). */
const CARD_PLACE_CHECKS_MS = [350, 1000] as const;
/** The widest the band grows (rem): a line of the tip, not a banner across the batter's view. */
const BAND_MAX_REM = 36;
/** The band keeps a readable words column beside two full-size, wrapping actions. */
const BAND_WORDS_MIN_REM = 13.5;
const BAND_ACTIONS_REM = 16.25;

const px = (value: string, fallback: number) => {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
};

/** The field inset (MiniRadar.tsx FieldPip, `[data-pip]`), read from the DOM: the card never covers it. A 0×0 or absent inset is nothing to avoid. */
function insetOf(root: HTMLElement, view: DOMRect): Box[] {
  const pip = root.querySelector<HTMLElement>('[data-pip]');
  const r = pip?.getBoundingClientRect();
  return r && r.width > 0 && r.height > 0 ? [{ x: r.left - view.left, y: r.top - view.top, width: r.width, height: r.height }] : [];
}

interface Parts {
  body: HTMLElement;
  actions: HTMLElement;
  words: HTMLElement | null;
}

function partsOf(card: HTMLElement): Parts | null {
  const body = card.querySelector<HTMLElement>('[data-testid="practice-result-body"]');
  const actions = card.lastElementChild as HTMLElement | null;
  if (!body || !actions || actions === body) return null;
  return { body, actions, words: card.querySelector<HTMLElement>('[data-testid="practice-result-words"]') };
}

function inputOf(card: HTMLElement, root: HTMLElement, p: Parts, edge: CardEdge, regions: readonly StageRegion[], inset: number, rem: number): CardPlacementInput | null {
  const view = root.getBoundingClientRect();
  if (view.width <= view.height) return null;
  const style = getComputedStyle(card);
  const chrome = Math.max(0, card.offsetHeight - p.body.offsetHeight - p.actions.offsetHeight);
  const words = p.body.scrollHeight;
  const box = (r: StageRegion): Box => ({ x: r.x, y: r.y, width: r.width, height: r.height });
  return {
    view: { width: view.width, height: view.height },
    edge,
    width: card.offsetWidth,
    naturalHeight: chrome + words + p.actions.offsetHeight,
    railBottom: { left: px(style.getPropertyValue('--p-rail-left-bottom'), 6.5 * rem), right: px(style.getPropertyValue('--p-rail-bottom'), 4.75 * rem) },
    inset,
    railGap: 0.5 * rem,
    regionGap: 0.25 * rem,
    // The actions and a 3rem slice of the words (the moved card's body keeps that, ResultLayer.module.css).
    minRoom: chrome + p.actions.offsetHeight + Math.min(words, 3 * rem),
    ballPath: regions.filter((r) => r.kind === 'ball_path').map(box),
    keepOut: insetOf(root, view),
    other: regions.filter((r) => r.kind !== 'ball_path').map(box),
  };
}

/** The coach's words (the tip, or the reason and the recommendation) wholly in the body's view, without scrolling. */
function wordsInView(p: Parts): boolean {
  if (!p.words) return true;
  const b = p.body.getBoundingClientRect();
  const w = p.words.getBoundingClientRect();
  if (w.height === 0) return true;
  const top = w.top - b.top + p.body.scrollTop;
  return top >= -0.5 && top + w.height <= p.body.clientHeight + 0.5;
}

/** The proposed band is used only when its words and every action really fit inside the measured card. */
function bandContentFits(card: HTMLElement, p: Parts): boolean {
  if (!wordsInView(p)) return false;
  const outer = card.getBoundingClientRect();
  const inside = (element: HTMLElement) => {
    const box = element.getBoundingClientRect();
    return box.left >= outer.left - 0.5 && box.top >= outer.top - 0.5 && box.right <= outer.right + 0.5 && box.bottom <= outer.bottom + 0.5;
  };
  if (!inside(p.body) || !inside(p.actions)) return false;
  return Array.from(p.actions.children).every((element) => {
    if (!(element instanceof HTMLElement) || !inside(element)) return false;
    const box = element.getBoundingClientRect();
    return box.width >= 48 && box.height >= 48;
  });
}

type Decision = { kind: 'own' } | { kind: 'column'; place: CardPlacement } | { kind: 'band'; band: BandPlacement };

/** Back to the card's own place and shape (the stylesheet's), keeping only what says it is waiting to be placed. */
function reset(card: HTMLElement): void {
  const st = card.style;
  st.left = st.right = st.top = st.bottom = st.maxHeight = st.width = '';
  delete card.dataset.shape;
  delete card.dataset.moved;
}

function apply(card: HTMLElement, d: Decision, clear: boolean): void {
  reset(card);
  const st = card.style;
  if (d.kind === 'column') {
    const p = d.place;
    st.left = p.edge === 'left' ? 'calc(var(--p-safe-l) + var(--p-2))' : 'auto';
    st.right = p.edge === 'right' ? 'calc(var(--p-safe-r) + var(--p-2))' : 'auto';
    st.top = p.anchor === 'top' ? `${Math.round(p.offset)}px` : 'auto';
    st.bottom = p.anchor === 'bottom' ? 'calc(var(--p-safe-b) + var(--p-2))' : 'auto';
    st.maxHeight = `${Math.floor(p.maxHeight)}px`;
    card.dataset.moved = 'true';
  } else if (d.kind === 'band') {
    const b = d.band;
    st.left = 'calc(var(--p-safe-l) + var(--p-2))';
    st.right = 'auto';
    st.top = `${Math.round(b.top)}px`;
    st.bottom = 'auto';
    st.width = `${Math.floor(b.width)}px`;
    st.maxHeight = `${Math.floor(b.maxHeight)}px`;
    card.dataset.moved = 'true';
    card.dataset.shape = 'band';
  }
  // For the evidence probes: the place, and whether it clears the ball's path and the inset.
  card.dataset.place = d.kind === 'band' ? 'band' : d.kind === 'column' ? `${d.place.edge}-${d.place.anchor}` : 'own';
  card.dataset.placeClear = String(clear);
}

/**
 * Places the card (`ref`, the section) off the ball's path. It writes the card's position directly, inside the same
 * layout pass that measured it (a timer, a ResizeObserver callback), so a moved card is never painted in a stale
 * place; React renders none of these properties.
 */
export function useCardPlacement(ref: RefObject<HTMLElement | null>, edge: CardEdge, regions: (() => readonly StageRegion[]) | null | undefined): void {
  const read = useRef(regions);
  const enabled = Boolean(regions);
  useLayoutEffect(() => {
    read.current = regions;
  });
  useLayoutEffect(() => {
    const card = ref.current;
    const root = card?.closest<HTMLElement>('[data-play-root]');
    if (!enabled || !card || !root) return;
    // The side inset, measured once in the card's own place (the stylesheet's: the safe area and 1rem).
    const own = card.getBoundingClientRect();
    const view0 = root.getBoundingClientRect();
    const inset = edge === 'left' ? own.left - view0.left : view0.right - own.right;
    let size = `${view0.width}x${view0.height}`;
    let placed = false;
    let spot: CardSpot | 'band' | null = null;
    card.dataset.placing = 'true';

    const measure = (fresh: boolean) => {
      let regionsNow: readonly StageRegion[];
      try {
        regionsNow = read.current?.() ?? [];
      } catch {
        return;
      }
      const parts = partsOf(card);
      if (!parts) return;
      const rem = px(getComputedStyle(document.documentElement).fontSize, 16);
      // Measured in the card's own place and shape; whatever is decided is written before anything is painted.
      reset(card);
      const input = inputOf(card, root, parts, edge, regionsNow, inset, rem);
      if (!input) {
        spot = null;
        apply(card, { kind: 'own' }, true);
        return;
      }
      const ownSpot: CardSpot = { edge, anchor: 'bottom' };
      const keep = fresh || spot === null || spot === 'band' ? ownSpot : spot;
      const p = cardPlacement(input, keep);
      if (p.clear && isOwnPlace(p, edge)) {
        spot = ownSpot;
        apply(card, { kind: 'own' }, true);
        return;
      }
      if (p.clear && p.maxHeight >= input.naturalHeight && spot !== 'band') {
        spot = p;
        apply(card, { kind: 'column', place: p }, true);
        return;
      }
      // No column place holds all the words: try the band, with the two actions in one row. At 640x360 the bouncer
      // leaves enough height for one full-size action row, not two stacked rows. Width is reserved for a readable
      // words column plus the fixed two-action panel; enlarged text that cannot satisfy both simply rejects the band.
      const chrome = Math.max(0, card.offsetHeight - parts.body.offsetHeight - parts.actions.offsetHeight);
      const band = bandAt(input, {
        maxWidth: BAND_MAX_REM * rem,
        minWidth: Math.max(input.width + 3 * rem, (BAND_WORDS_MIN_REM + BAND_ACTIONS_REM) * rem),
        need: chrome + Math.max(parts.actions.offsetHeight, 4 * rem),
      });
      if (band) {
        apply(card, { kind: 'band', band }, true);
        if (bandContentFits(card, parts)) {
          spot = 'band';
          return;
        }
      }
      spot = p.clear ? p : ownSpot;
      apply(card, p.clear && !isOwnPlace(p, edge) ? { kind: 'column', place: p } : { kind: 'own' }, p.clear);
    };

    const settle = setTimeout(() => {
      placed = true;
      measure(true);
      // Placed: now it arrives (its arrival animation starts here).
      delete card.dataset.placing;
    }, CARD_SETTLE_MS);
    const timers = CARD_PLACE_CHECKS_MS.map((ms) => setTimeout(() => measure(false), ms));
    const observers: ResizeObserver[] = [];
    if (typeof ResizeObserver !== 'undefined') {
      // The card's own size: its words arriving, "Why?" opening.
      const onCard = new ResizeObserver(() => {
        if (placed) measure(false);
      });
      onCard.observe(card);
      // The view resized: placed afresh. (Its first notification is not a resize.)
      const onView = new ResizeObserver(() => {
        const r = root.getBoundingClientRect();
        const now = `${r.width}x${r.height}`;
        if (now === size) return;
        size = now;
        if (placed) measure(true);
      });
      onView.observe(root);
      observers.push(onCard, onView);
    }
    return () => {
      clearTimeout(settle);
      for (const t of timers) clearTimeout(t);
      for (const o of observers) o.disconnect();
      reset(card);
      delete card.dataset.placing;
      delete card.dataset.place;
      delete card.dataset.placeClear;
    };
  }, [enabled, edge, ref]);
}
