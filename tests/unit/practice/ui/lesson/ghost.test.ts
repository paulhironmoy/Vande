/**
 * The ghost teaches the move the game really reads: its stroke, played through the real GestureTracker and normalizer, is
 * a firm, grounded drive about 12° to the off side, read as pull-down (loading) and then the flick (committing), on every
 * phone size and for both hands. Its animation is the same numbers, slowed.
 */
import { describe, expect, it } from 'vitest';
import type { Handedness } from '@/contracts';
import { normalizeGesture, traceGesture } from '@/input';
import { shotElevationRead, shotPowerRead } from '@/practice/ui/coaching';
import {
  GHOST,
  GHOST_KEYS,
  arrowHead,
  badgePoints,
  ghostPoints,
  headKeyframes,
  handKeyframes,
  keyKeyframes,
  pointerKeyframes,
  teachingSamples,
  trailKeyframes,
  wordKeyframes,
} from '@/practice/ui/lesson/ghostMove';

/** The batting area is the lower 46% of the viewport (GestureSurface). */
const surfaceOf = (w: number, h: number) => ({ width: w, height: Math.round(h * 0.46) });
const SIZES: Array<[string, { width: number; height: number }]> = [
  ['640x360 phone', surfaceOf(640, 360)],
  ['844x390 phone', surfaceOf(844, 390)],
  ['915x412 phone', surfaceOf(915, 412)],
  ['1280x720 laptop', surfaceOf(1280, 720)],
  ['1920x1080 desktop', surfaceOf(1920, 1080)],
];

describe('the ghost stroke is the stroke the game reads', () => {
  for (const [name, surface] of SIZES)
    for (const handedness of ['right', 'left'] as Handedness[])
      it(`${name}, ${handedness}-handed: a firm grounded drive to the off side, loaded then committed`, () => {
        const samples = teachingSamples({ surface, handedness });
        const traced = traceGesture({ surface, samples, handedness });
        expect(traced.gesture, 'the tracker emits one gesture').not.toBeNull();
        const swing = normalizeGesture(traced.gesture!, { releasePerfMs: 0, calibrationMs: 0, handedness })!;
        expect(swing.kind).toBe('attack');
        // Direction: 12° off straight, to the off side for this hand (a left-hander's off side is on the left).
        expect(swing.directionDeg).toBeGreaterThan(GHOST.flickDeg - 1.5);
        expect(swing.directionDeg).toBeLessThan(GHOST.flickDeg + 1.5);
        expect(shotPowerRead(swing.power)).toBe('firm');
        expect(shotElevationRead(swing.elevation)).toBe('grounded');
        const phases = traced.states.map((s) => s.phase);
        expect(phases.indexOf('loading')).toBeGreaterThan(-1);
        expect(phases.indexOf('committing')).toBeGreaterThan(phases.indexOf('loading'));
        expect(phases).not.toContain('intentional_leave');
      });

  it('stays inside the batting area from press to flick', () => {
    for (const [, surface] of SIZES)
      for (const s of teachingSamples({ surface })) {
        expect(s.x).toBeGreaterThanOrEqual(0);
        expect(s.x).toBeLessThanOrEqual(surface.width);
        expect(s.y).toBeGreaterThanOrEqual(0);
        expect(s.y).toBeLessThanOrEqual(surface.height);
      }
  });

  it('the same hand moves the same way every time (no random, no clock)', () => {
    const a = teachingSamples({ surface: surfaceOf(915, 412) });
    const b = teachingSamples({ surface: surfaceOf(915, 412) });
    expect(b).toEqual(a);
  });
});

describe('the drawing', () => {
  it('pulls down 30 and flicks up 70 at 12°, mirrored for a left-hander', () => {
    const r = ghostPoints('right');
    expect(r.b.y - r.s.y).toBe(GHOST.pullUnits);
    expect(r.b.x).toBe(r.s.x);
    const dx = r.f.x - r.b.x;
    const dy = r.b.y - r.f.y;
    expect(Math.hypot(dx, dy)).toBeCloseTo(GHOST.flickUnits, 6);
    expect((Math.atan2(dx, dy) * 180) / Math.PI).toBeCloseTo(GHOST.flickDeg, 6);
    const l = ghostPoints('left');
    expect(l.f.x - l.b.x).toBeCloseTo(-dx, 6);
    expect(l.f.y).toBeCloseTo(r.f.y, 6);
  });

  it('the animation pulls slowly, waits, then flicks fast, then rests before it repeats', () => {
    const z = GHOST.show;
    expect(z.downEnd).toBeLessThan(z.pullEnd);
    expect(z.pullEnd).toBeLessThan(z.holdEnd);
    expect(z.holdEnd).toBeLessThan(z.flickEnd);
    expect(z.flickEnd).toBeLessThan(z.fadeStart);
    expect(z.fadeEnd).toBeLessThan(z.periodMs);
    const pull = z.pullEnd - z.downEnd;
    const flick = z.flickEnd - z.holdEnd;
    expect(flick * 3).toBeLessThan(pull);
    // The real hand does the same in the same order.
    expect(GHOST.real.flickMs * 3).toBeLessThan(GHOST.real.pullMs);
  });

  it('every keyframe list is a valid Web Animations list: offsets from 0 to 1, in order', () => {
    const lists = [
      pointerKeyframes('right'),
      pointerKeyframes('left'),
      headKeyframes('pull'),
      headKeyframes('flick'),
      trailKeyframes('pull'),
      trailKeyframes('flick'),
      wordKeyframes('lift'),
      wordKeyframes('power'),
      wordKeyframes('aim'),
      handKeyframes('near'),
      handKeyframes('far'),
      ...GHOST_KEYS.map((k) => keyKeyframes(k)),
    ];
    for (const frames of lists) {
      expect(frames[0].offset).toBe(0);
      expect(frames[frames.length - 1].offset).toBe(1);
      for (let i = 1; i < frames.length; i++) expect(frames[i].offset).toBeGreaterThanOrEqual(frames[i - 1].offset);
    }
  });

  it('the sprite is invisible while it rests, and visible for the whole move', () => {
    const frames = pointerKeyframes('right');
    expect(frames[0].opacity).toBe(0);
    const z = GHOST.show;
    const mid = frames.filter((f) => f.offset >= z.downEnd / z.periodMs && f.offset <= z.fadeStart / z.periodMs);
    for (const f of mid) expect(f.opacity).toBe(1);
  });
});

describe('the arrowheads and the step badges', () => {
  it('an arrowhead has its tip on the end of its line and points along it', () => {
    const { b, f } = ghostPoints('right');
    const pts = arrowHead(b, f)
      .split(' ')
      .map((p) => p.split(',').map(Number));
    expect(pts[0]).toEqual([Math.round(f.x * 100) / 100, Math.round(f.y * 100) / 100]);
    // The other two points sit behind the tip, level with each other across the line.
    const back = [(pts[1][0] + pts[2][0]) / 2, (pts[1][1] + pts[2][1]) / 2];
    expect(Math.hypot(pts[0][0] - back[0], pts[0][1] - back[1])).toBeCloseTo(7.5, 1);
    expect(Math.hypot(pts[1][0] - pts[2][0], pts[1][1] - pts[2][1])).toBeCloseTo(7.6, 1);
  });

  it('the badges sit beside the lines, on the other side for a left-hander, and never on the lines', () => {
    for (const hand of ['right', 'left'] as Handedness[]) {
      const { s, b, f } = ghostPoints(hand);
      const badges = badgePoints(hand);
      expect(Math.abs(badges.pull.x - s.x)).toBeCloseTo(9, 6);
      expect(badges.pull.y).toBeCloseTo((s.y + b.y) / 2, 6);
      expect(Math.abs(badges.flick.x - (b.x + f.x) / 2)).toBeCloseTo(9, 6);
    }
    expect(badgePoints('right').pull.x).toBeLessThan(ghostPoints('right').s.x);
    expect(badgePoints('left').pull.x).toBeGreaterThan(ghostPoints('left').s.x);
  });

  it('a head appears only once its line has been drawn', () => {
    const z = GHOST.show;
    const pull = headKeyframes('pull');
    const before = pull.filter((k) => k.offset < (z.pullEnd - 40) / z.periodMs);
    for (const k of before) expect(k.opacity).toBe(0);
    expect(pull.some((k) => k.opacity === 1 && Math.abs(k.offset - z.pullEnd / z.periodMs) < 1e-9)).toBe(true);
  });
});
