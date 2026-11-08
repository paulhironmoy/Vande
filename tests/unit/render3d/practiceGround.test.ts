/**
 * ART1 evidence for the Practice ground, in the Laws' own numbers: stumps and bails (Law 8), the pitch and its creases
 * (Laws 6 and 7) and the bat (Law 5), measured on what the 3D stage draws; and the Practice boundary boards, which
 * carry no wording, brand, team or logo.
 */
import { describe, expect, it } from 'vitest';
import { Box3 } from 'three';
import { BALL_R, PITCH_HALF, PITCH_WIDTH, POPPING, STUMP_H, STUMP_R, STUMPS_W, BAIL_RISE } from '@/physics/geometry';
import { BLADE_L, BLADE_W, EDGE_T, HANDLE_L } from '@/physics/constants';
import { BAIL, BAT_SPINE_DEPTH, batGeometry, stumpGeometry, wicketLayout } from '@/render3d/three/props';
import { creaseMarkings, paintPracticeBoards } from '@/render3d/three/stadium';

/** The Laws of Cricket (MCC, 2017 Code, 3rd edition 2022), metric figures. */
export const LAWS = {
  stumpHeight: 0.7112,
  wicketWidth: 0.2286,
  stumpDiameterMin: 0.0349,
  stumpDiameterMax: 0.0381,
  bailLength: 0.1095,
  bailRiseMax: 0.0127,
  pitchLength: 20.12,
  pitchWidth: 3.05,
  poppingFromBowling: 1.22,
  poppingHalfMin: 1.83,
  bowlingCreaseLength: 2.64,
  returnFromMiddle: 1.32,
  returnBehindPoppingMin: 2.44,
  batLengthMax: 0.9652,
  batWidthMax: 0.108,
  batDepthMax: 0.067,
  batEdgeMax: 0.04,
  batHandleShareMax: 0.52,
  ballCircumference: [0.224, 0.229],
} as const;

describe('Law 8: the wickets', () => {
  it('stumps 71.12 cm tall (to 0.5 mm) and 22.86 cm wide, stump diameter in the Law band, bails 10.95 cm rising at most 1.27 cm', () => {
    const b = new Box3().setFromBufferAttribute(stumpGeometry().attributes.position as never);
    expect(Math.abs(b.max.y - LAWS.stumpHeight)).toBeLessThanOrEqual(0.0005);
    expect(Math.abs(STUMP_H - LAWS.stumpHeight)).toBeLessThanOrEqual(0.0005);
    const { stumps } = wicketLayout();
    expect(stumps[2] + STUMP_R - (stumps[0] - STUMP_R)).toBeCloseTo(LAWS.wicketWidth, 9);
    expect(STUMPS_W).toBeCloseTo(LAWS.wicketWidth, 9);
    expect(2 * STUMP_R).toBeGreaterThanOrEqual(LAWS.stumpDiameterMin);
    expect(2 * STUMP_R).toBeLessThanOrEqual(LAWS.stumpDiameterMax);
    expect(BAIL.length).toBeCloseTo(LAWS.bailLength, 6);
    expect(BAIL_RISE).toBeLessThanOrEqual(LAWS.bailRiseMax);
  });
});

describe('Laws 6 and 7: the pitch and the creases', () => {
  it('a 20.12 × 3.05 m pitch; popping creases 1.22 m in front of the bowling creases and at least 1.83 m either side; bowling creases 2.64 m; return creases 1.32 m from middle and at least 2.44 m behind the popping crease', () => {
    expect(2 * PITCH_HALF).toBeCloseTo(LAWS.pitchLength, 9);
    expect(PITCH_WIDTH).toBeCloseTo(LAWS.pitchWidth, 9);
    const marks = creaseMarkings();
    for (const end of [1, -1] as const) {
      const of = (kind: string) => marks.filter((m) => m.kind === kind && m.end === end);
      const popping = of('popping')[0];
      const bowling = of('bowling')[0];
      // The Law edges: the back edge of the popping crease's marking, the line of the stumps for the bowling crease.
      const poppingEdge = end > 0 ? popping.z1 : popping.z0;
      const bowlingEdge = end > 0 ? bowling.z1 : bowling.z0;
      expect(Math.abs(bowlingEdge - poppingEdge)).toBeCloseTo(LAWS.poppingFromBowling, 6);
      expect(Math.abs(bowlingEdge)).toBeCloseTo(PITCH_HALF, 6);
      expect(Math.min(-popping.x0, popping.x1)).toBeGreaterThanOrEqual(LAWS.poppingHalfMin - 1e-9);
      expect(bowling.x1 - bowling.x0).toBeCloseTo(LAWS.bowlingCreaseLength, 6);
      const returns = marks.filter((m) => m.end === end && m.kind.startsWith('return'));
      expect(returns.length).toBe(2);
      for (const r of returns) {
        const inside = Math.min(Math.abs(r.x0), Math.abs(r.x1));
        expect(inside).toBeCloseTo(LAWS.returnFromMiddle, 6);
        const behind = Math.max(Math.abs(r.z0), Math.abs(r.z1)) - (PITCH_HALF - POPPING);
        expect(behind).toBeGreaterThanOrEqual(LAWS.returnBehindPoppingMin - 1e-9);
      }
    }
  });

  it('the ball is the Law 4 size (22.4–22.9 cm round)', () => {
    const c = 2 * Math.PI * BALL_R;
    expect(c).toBeGreaterThanOrEqual(LAWS.ballCircumference[0]);
    expect(c).toBeLessThanOrEqual(LAWS.ballCircumference[1]);
  });
});

describe('Law 5: the bat', () => {
  it('at most 96.52 cm long, 10.8 cm wide (the drawn edges included), 6.7 cm deep, 4.0 cm edges, a handle at most 52% of the length', () => {
    const b = new Box3().setFromBufferAttribute(batGeometry().attributes.position as never);
    const length = b.max.y - b.min.y;
    expect(length).toBeLessThanOrEqual(LAWS.batLengthMax);
    expect(HANDLE_L + BLADE_L).toBeLessThanOrEqual(LAWS.batLengthMax);
    expect(BLADE_W).toBeLessThanOrEqual(LAWS.batWidthMax);
    expect(b.max.x - b.min.x).toBeLessThanOrEqual(LAWS.batWidthMax + 1e-6);
    expect(BAT_SPINE_DEPTH).toBeLessThanOrEqual(LAWS.batDepthMax);
    expect(EDGE_T).toBeLessThanOrEqual(LAWS.batEdgeMax);
    expect(HANDLE_L / (HANDLE_L + BLADE_L)).toBeLessThanOrEqual(LAWS.batHandleShareMax);
  });
});

describe('Practice boundary boards', () => {
  it('carry no wording, brand, team or logo: shapes only, in dark, low-saturation panels', () => {
    const calls: string[] = [];
    const fills: string[] = [];
    const ctx = new Proxy(
      {},
      {
        get: (_t, key: string) =>
          key === 'fillStyle' || key === 'strokeStyle'
            ? '#000'
            : (...args: unknown[]) => calls.push(`${key}:${args.length}`),
        set: (_t, key: string, value: unknown) => {
          if (key === 'fillStyle' && typeof value === 'string') fills.push(value);
          return true;
        },
      },
    ) as unknown as CanvasRenderingContext2D;
    paintPracticeBoards(ctx);
    expect(calls.some((c) => /^(fillText|strokeText|drawImage)/.test(c))).toBe(false);
    const hexes = fills.filter((f) => /^#[0-9a-f]{6}$/i.test(f));
    expect(hexes.length).toBeGreaterThanOrEqual(8);
    for (const h of hexes) {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      // Panel colours: dark (HSL lightness below 0.2) and muted (saturation below 0.45).
      const l = (max + min) / 2;
      const s = max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
      expect(l, h).toBeLessThan(0.2);
      expect(s, h).toBeLessThan(0.45);
    }
  });
});
