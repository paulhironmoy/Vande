/**
 * Classic's painted venue (fallback2d/venuePaint.ts) and the shared venue geometry (core/venueGeometry.ts): the numbers
 * the 3D stadium and the 2D painter agree on, a deterministic strip, a bounded paint cost, and a picture that stays
 * where the stands are when the camera turns. No pixels are judged here (no real canvas in jsdom): the checks are on the
 * canvas calls the painter makes. A real-canvas look and frame time are measured in the browser harness.
 */
import { describe, expect, it } from 'vitest';
import { BATTER_EYE, type CameraPose } from '@/render3d/core/camera';
import { BOUNDARY_R } from '@/render3d/core/ground';
import { SIGHT_SCREEN } from '@/render3d/three/stadium';
import {
  EYE,
  ROOF,
  SIGHT_SCREEN_GAP_HALF,
  STAND_ROWS,
  STAND_TIERS,
  azimuthOf,
  ringPoint,
  wallHeight,
} from '@/render3d/core/venueGeometry';
import { BatterViewPainter } from '@/render3d/fallback2d/batterView';
import {
  ClassicVenue,
  H_BOT,
  H_TOP,
  SLICES,
  STRIP_H,
  STRIP_SPAN,
  STRIP_W,
  WALL_R,
  paintVenueStrip,
} from '@/render3d/fallback2d/venuePaint';

type Call = { name: string; args: unknown[] };

/** A 2D context that records every call and the fill styles set, and that has a (fake) real canvas. */
function recorder(width = 844) {
  const calls: Call[] = [];
  const fills: string[] = [];
  const noop = () => undefined;
  const ctx = new Proxy(
    {},
    {
      get(_t, key) {
        if (key === 'calls') return calls;
        if (key === 'fills') return fills;
        if (key === 'canvas') return { width };
        if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => ({ addColorStop: noop });
        return (...args: unknown[]) => calls.push({ name: String(key), args });
      },
      set(_t, key, value) {
        if (key === 'fillStyle') fills.push(String(value));
        return true;
      },
    },
  ) as unknown as CanvasRenderingContext2D & { calls: Call[]; fills: string[] };
  return ctx;
}

const eyeCam = (yawDeg = 0, fov = 38): CameraPose => {
  const yaw = (yawDeg * Math.PI) / 180;
  const pitch = (-12.6 * Math.PI) / 180;
  const pos = { x: -BATTER_EYE.lateral, y: BATTER_EYE.height, z: BATTER_EYE.z };
  // Facing the bowler's end (-z), turned to the right by `yawDeg` and down 12.6 degrees, like the batter's eye before release.
  return {
    pos,
    target: {
      x: pos.x + Math.sin(yaw) * Math.cos(pitch) * 100,
      y: pos.y + Math.sin(pitch) * 100,
      z: pos.z - Math.cos(yaw) * Math.cos(pitch) * 100,
    },
    fov,
  };
};

describe('venue geometry', () => {
  it('agrees with the 3D stadium: the sight-screen gap, the eye and the tier radii', () => {
    expect(SIGHT_SCREEN_GAP_HALF).toBeCloseTo(Math.atan2(SIGHT_SCREEN.width / 2 + 1.5, SIGHT_SCREEN.distance), 12);
    expect(EYE.height).toBe(BATTER_EYE.height);
    expect(EYE.z).toBeCloseTo(BATTER_EYE.z, 12);
    expect(STAND_TIERS.lower).toEqual({ r0: BOUNDARY_R + 8, r1: BOUNDARY_R + 27, y0: 1.2, y1: 10.5 });
    expect(STAND_TIERS.upper).toEqual({ r0: BOUNDARY_R + 30, r1: BOUNDARY_R + 47, y0: 13.5, y1: 27 });
    expect(STAND_ROWS).toEqual({ lower: 14, upper: 13 });
  });

  it('maps a bowl point to the wall at the same elevation from the eye', () => {
    for (const r of [70, 90, 109]) expect(wallHeight(r, EYE.height, 95)).toBeCloseTo(EYE.height, 12);
    const elevation = (d: number, y: number) => Math.atan2(y - EYE.height, d);
    const on = wallHeight(89, 10.5, 95);
    expect(elevation(95 + EYE.z, on)).toBeCloseTo(elevation(89 + EYE.z, 10.5), 12);
    expect(azimuthOf(0, -1)).toBeCloseTo(Math.PI, 12);
    expect(ringPoint(Math.PI, 10, 2).z).toBeCloseTo(-10, 12);
  });

  it('puts the strip range from the boards to the roof lip', () => {
    expect(H_BOT).toBeLessThan(0);
    expect(H_TOP).toBeCloseTo(wallHeight(ROOF.rInner, ROOF.y + ROOF.h / 2, WALL_R), 12);
    expect(H_TOP).toBeGreaterThan(30);
  });
});

describe('the painted strip', () => {
  it('is deterministic and bounded', () => {
    const a = recorder();
    const b = recorder();
    paintVenueStrip(a);
    paintVenueStrip(b);
    expect(JSON.stringify(a.calls)).toBe(JSON.stringify(b.calls));
    expect(a.fills).toEqual(b.fills);
    // One-off cost: a few hundred fills and a few thousand rects at most (paths batch the people by shirt colour).
    expect(a.calls.filter((c) => c.name === 'fill').length).toBeLessThan(1200);
    expect(a.calls.length).toBeLessThan(40000);
  });

  it('draws only inside the strip, skips the sight-screen gap and keeps its people to the rows', () => {
    const g = recorder();
    paintVenueStrip(g);
    const rects = g.calls.filter((c) => c.name === 'rect' || c.name === 'fillRect');
    expect(rects.length).toBeGreaterThan(2000);
    for (const c of rects) {
      const [x, y, w, h] = c.args as number[];
      // A person at the very edge may stick out by a few pixels; the canvas clips it.
      expect(x).toBeGreaterThanOrEqual(-12);
      expect(y).toBeGreaterThanOrEqual(-2);
      expect(x + w).toBeLessThanOrEqual(STRIP_W + 12);
      expect(y + h).toBeLessThanOrEqual(STRIP_H + 2);
    }
    // People are `rect` calls (one path per shirt colour); none starts inside the gap behind the sight screen.
    const gapLeft = ((Math.PI + STRIP_SPAN - (Math.PI + SIGHT_SCREEN_GAP_HALF)) / (2 * STRIP_SPAN)) * STRIP_W;
    const gapRight = ((Math.PI + STRIP_SPAN - (Math.PI - SIGHT_SCREEN_GAP_HALF)) / (2 * STRIP_SPAN)) * STRIP_W;
    const inGap = g.calls.filter((c) => {
      if (c.name !== 'rect') return false;
      const [x, , w] = c.args as number[];
      return x > gapLeft + 2 && x + w < gapRight - 2;
    });
    expect(inGap.length).toBe(0);
  });
});

describe('Classic venue through the camera', () => {
  const makeFactory = () => () => ({ canvas: {} as CanvasImageSource, ctx: recorder() });
  const host = (width = 844, height = 390) => {
    const ctx = recorder(width);
    const painter = new BatterViewPainter(ctx, new ClassicVenue(makeFactory()));
    painter.resize(width, height, 1);
    return { ctx, painter };
  };

  it('gives the plain band back when the canvas is not a real one or no strip can be made', () => {
    const noCanvas = new Proxy({}, { get: () => () => undefined }) as unknown as CanvasRenderingContext2D;
    const venue = new ClassicVenue(makeFactory());
    expect(venue.paint({ ctx: noCanvas, w: 844, h: 390, project: () => null }, eyeCam())).toBe(-1);
    const failing = new ClassicVenue(() => null);
    expect(failing.prepare(recorder())).toBe(false);
    expect(failing.paint({ ctx: recorder(), w: 844, h: 390, project: () => null }, eyeCam())).toBe(-1);
  });

  it('draws SLICES abutting slices that cross the horizon, in screen order', () => {
    const { ctx, painter } = host();
    const venue = new ClassicVenue(makeFactory());
    painter.useCamera(eyeCam());
    const n = venue.paint(painter, eyeCam());
    expect(n).toBe(SLICES);
    const draws = ctx.calls.filter((c) => c.name === 'drawImage');
    expect(draws.length).toBe(SLICES);
    const horizon = painter.project(ringPoint(Math.PI, WALL_R, EYE.height))!.y;
    let previousRight = -Infinity;
    for (const c of draws) {
      const [, sx, sy, sw, sh, dx, dy, dw, dh] = c.args as number[];
      expect([sx, sy, sw, sh].every((v) => Number.isFinite(v))).toBe(true);
      expect(sx).toBeGreaterThanOrEqual(-1);
      expect(sx + sw).toBeLessThanOrEqual(STRIP_W + 1);
      expect(dy).toBeLessThan(horizon);
      expect(dy + dh).toBeGreaterThan(horizon);
      // Each slice starts where the last one ended (within the 0.6 px overlap).
      if (Number.isFinite(previousRight)) expect(Math.abs(dx - (previousRight - 0.6))).toBeLessThan(0.75);
      previousRight = dx + dw;
    }
    // The strip is covered across the screen it can be seen in.
    expect((draws[0].args as number[])[5]).toBeLessThan(0);
    expect(previousRight).toBeGreaterThan(844);
  });

  it('stays where the stands are when the gaze turns', () => {
    const centreSource = ((Math.PI + STRIP_SPAN - Math.PI) / (2 * STRIP_SPAN)) * STRIP_W;
    const where: Record<number, number> = {};
    const exact: Record<number, number> = {};
    for (const yaw of [-6, 0, 6, 12]) {
      const { ctx, painter } = host();
      const venue = new ClassicVenue(makeFactory());
      painter.useCamera(eyeCam(yaw));
      venue.paint(painter, eyeCam(yaw));
      const draws = ctx.calls.filter((c) => c.name === 'drawImage');
      const slice = draws.find((c) => {
        const [, sx, , sw] = c.args as number[];
        return sx <= centreSource && centreSource <= sx + sw;
      })!;
      const [, sx, , sw, , dx, , dw] = slice.args as number[];
      where[yaw] = dx + ((centreSource - sx) / sw) * dw;
      // Truth: the camera's own projection of the wall point straight down the bowler's axis (the picture's centre).
      exact[yaw] = painter.project(ringPoint(Math.PI, WALL_R, (H_TOP + H_BOT) / 2))!.x;
      // The slice is projected at its own mid-azimuth, so it can differ from the exact point by up to a slice.
      expect(Math.abs(where[yaw] - exact[yaw])).toBeLessThan(844 / SLICES);
    }
    // Turning the gaze 6 degrees right moves the picture left by about focal * tan(6 degrees) = 59 px, then 12 degrees by about 120.
    const focal = 390 / 2 / Math.tan((38 * Math.PI) / 360);
    expect(where[0] - where[6]).toBeGreaterThan(focal * Math.tan((6 * Math.PI) / 180) - 20);
    expect(where[0] - where[6]).toBeLessThan(focal * Math.tan((6 * Math.PI) / 180) + 20);
    expect(where[0] - where[12]).toBeGreaterThan(focal * Math.tan((12 * Math.PI) / 180) - 25);
    expect(where[-6] - where[0]).toBeGreaterThan(focal * Math.tan((6 * Math.PI) / 180) - 20);
  });

  it('paints nothing when the camera faces away from the bowler end', () => {
    const { painter } = host();
    const venue = new ClassicVenue(makeFactory());
    const cam = eyeCam();
    const away: CameraPose = { ...cam, target: { x: cam.pos.x, y: cam.pos.y, z: cam.pos.z + 100 } };
    painter.useCamera(away);
    expect(venue.paint(painter, away)).toBe(-1);
  });

  it('draws the same slices every frame of a given pose (no state, no wall clock)', () => {
    const one = host();
    const two = host();
    const v1 = new ClassicVenue(makeFactory());
    const v2 = new ClassicVenue(makeFactory());
    one.painter.useCamera(eyeCam(3));
    two.painter.useCamera(eyeCam(3));
    v1.paint(one.painter, eyeCam(3));
    v1.paint(one.painter, eyeCam(3));
    v2.paint(two.painter, eyeCam(3));
    const first = one.ctx.calls.slice(0, one.ctx.calls.length / 2);
    const again = one.ctx.calls.slice(one.ctx.calls.length / 2);
    expect(JSON.stringify(again)).toBe(JSON.stringify(first));
    expect(JSON.stringify(two.ctx.calls)).toBe(JSON.stringify(first));
  });
});
