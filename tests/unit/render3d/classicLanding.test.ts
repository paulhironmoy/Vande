/**
 * Classic's Learn landing ring (Fallback2DPracticeStage landingUntil): drawn until just after the pitch, but gone at
 * the contact when the ball is met before it pitches and the presented ball never reaches that bounce (COH4).
 */
import { describe, expect, it } from 'vitest';
import type { BallFlight, DeliveryResult } from '@/contracts/practice';
import { landingUntil } from '@/render3d/fallback2d/Fallback2DPracticeStage';

const bounce = { t: 0.5, p: { x: 0, y: 0.036, z: 4 } };
const flight = { bounce } as unknown as BallFlight;
const result = (contactT: number, ballAtBounce: { x: number; y: number; z: number }): DeliveryResult =>
  ({
    events: [
      { t: 0, kind: 'release' },
      { t: contactT, kind: 'contact', contact: 'middle', p: { x: 0, y: 0.5, z: 8.5 } },
    ],
    ball: [
      { t: 0, p: { x: 0, y: 2, z: -9 } },
      { t: 0.5, p: ballAtBounce },
      { t: 1, p: { x: 3, y: 1, z: -10 } },
    ],
  }) as unknown as DeliveryResult;

describe('Classic landing ring', () => {
  it('stays until just after the pitch while the result is unknown, or when the ball pitches before the bat', () => {
    expect(landingUntil({ flight, result: null, contactScene: null, releaseScene: 1000 })).toBe(1000 + 500 + 260);
    expect(landingUntil({ flight, result: result(0.62, bounce.p), contactScene: 1620, releaseScene: 1000 })).toBe(1760);
  });

  it('goes at the contact when the ball is met on the full and never pitches where the flight would have', () => {
    expect(
      landingUntil({ flight, result: result(0.42, { x: 1, y: 1.2, z: 1 }), contactScene: 1420, releaseScene: 1000 }),
    ).toBe(1420);
  });

  it('is never drawn for a flight that does not pitch', () => {
    expect(
      landingUntil({
        flight: { bounce: null } as unknown as BallFlight,
        result: null,
        contactScene: null,
        releaseScene: 1000,
      }),
    ).toBe(0);
    expect(landingUntil({ flight: null, result: null, contactScene: null, releaseScene: 1000 })).toBe(0);
  });
});
