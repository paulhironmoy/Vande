/**
 * The bowler's legitimate advance information: small wrist and back differences around the release that a batter
 * can learn to read, the way real bowlers give them away. The action, run-up and arm speed stay the same all over,
 * so nothing announces the delivery; the cue lives in the hand for a fraction of a second either side of release.
 * Euler degrees (skeleton.ts conventions) added to a right-arm bowler's bones; a left-arm bowler is mirrored after.
 */
import type { BowlerAction } from '@/contracts';
import type { DeliveryVariation } from '@/contracts/practice';
import { smoothstep } from '../core/math';

export interface ReleaseCue {
  hand: readonly [number, number, number];
  chest?: readonly [number, number, number];
}

const PACE: Partial<Record<DeliveryVariation, ReleaseCue>> = {
  outswing: { hand: [0, -16, 0] },
  inswing: { hand: [0, 16, 0] },
  seam: { hand: [-4, 0, 0] },
  cutter: { hand: [0, 8, 24] },
  slower: { hand: [6, 58, 0] },
  bouncer: { hand: [-10, 0, 0], chest: [-6, 0, 0] },
  yorker: { hand: [14, 0, 0] },
};

const FINGER: Partial<Record<DeliveryVariation, ReleaseCue>> = {
  stock: { hand: [0, -26, 0] },
  flighted: { hand: [-18, -24, 0] },
  quicker: { hand: [10, -12, 0] },
  topspinner: { hand: [0, 45, 0] },
  arm_ball: { hand: [8, 0, 0] },
  wrong_un: { hand: [0, -10, -30] },
};

const WRIST: Partial<Record<DeliveryVariation, ReleaseCue>> = {
  stock: { hand: [0, 0, 34] },
  flighted: { hand: [-18, 0, 30] },
  quicker: { hand: [10, 0, 18] },
  topspinner: { hand: [0, 45, 10] },
  arm_ball: { hand: [8, 0, 4] },
  wrong_un: { hand: [0, 120, 20] },
};

export function releaseCue(action: BowlerAction, variation: DeliveryVariation | null): ReleaseCue | null {
  if (!variation) return null;
  const table = action === 'spin_off' ? FINGER : action === 'spin_leg' ? WRIST : PACE;
  return table[variation] ?? null;
}

/** How strongly the cue shows at scene time t (rises before release, gone soon after). */
export function releaseCueWeight(t: number, releaseScene: number): number {
  return smoothstep(releaseScene - 260, releaseScene - 60, t) * (1 - smoothstep(releaseScene + 60, releaseScene + 220, t));
}
