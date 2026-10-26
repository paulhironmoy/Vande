/**
 * A fixed, representative set of multiplayer balls for the match physics benchmark (scripts/match-physics-bench.mjs
 * and tests/unit/physics/matchPerf.test.ts): engine deliveries of every variant with the post-contact flights a ball
 * script asks for (catches, ground strokes, boundaries, a throw).
 */
import type { DeliveryVariant, Intensity, Length, Line, PitchId } from '@/contracts';
import type { Vec3 } from '@/contracts/practice';
import { deliveryPath, deliveryTiming } from '@/engine/v1/delivery';
import { FAMILY } from '@/engine/v1/tables';
import type { AimOptions, AimTarget } from '@/physics/aim';
import { CONTACT_Z } from '@/physics/constants';
import { CONDITIONS_FOR_PITCH, type FromPathOptions } from '@/physics/matchPath';

export interface BenchBall {
  path: ReturnType<typeof deliveryPath>;
  opts: FromPathOptions;
  contact: Vec3;
  aims: Array<{ label: string; target: AimTarget; opts?: AimOptions; from?: { t: number; p: Vec3 } }>;
}

const AIMS: Array<{ label: string; target: AimTarget; opts?: AimOptions; from?: { t: number; p: Vec3 } }> = [
  { label: 'carry ring', target: { p: { x: 16, y: 1.4, z: -4 }, mode: 'carry' } },
  { label: 'carry deep skier', target: { p: { x: -30, y: 2.1, z: -44 }, mode: 'carry' }, opts: { elevationDeg: 56 } },
  { label: 'ground rest', target: { p: { x: 9, y: 0, z: -14 }, mode: 'ground' } },
  { label: 'ground long roll', target: { p: { x: -22, y: 0, z: -48 }, mode: 'ground' } },
  { label: 'ground pickup', target: { p: { x: 20, y: 0, z: 2 }, mode: 'ground' }, opts: { arriveSpeedKph: 35 } },
  { label: 'four', target: { p: { x: 44, y: 0, z: -44 }, mode: 'bounce_then_rope' } },
  { label: 'six', target: { p: { x: -14, y: 9, z: -60 }, mode: 'over_rope' } },
  { label: 'throw 42 m', target: { p: { x: 0.3, y: 0.9, z: 10.2 }, mode: 'carry' }, opts: { elevationDeg: 12, spin: { x: 0, y: 0, z: 0 } }, from: { t: 3, p: { x: 30, y: 1.8, z: -18 } } },
];

export function matchBenchFixture(): BenchBall[] {
  const variants: DeliveryVariant[] = ['yorker', 'good_length', 'bouncer', 'slower', 'inswing', 'outswing', 'offspin', 'legspin'];
  const lines: Line[] = ['off', 'middle', 'leg'];
  const lengths: Length[] = ['full', 'good', 'short'];
  const pitches: PitchId[] = ['green', 'hard', 'slow'];
  const out: BenchBall[] = [];
  let i = 0;
  for (const variant of variants) {
    for (let k = 0; k < 3; k++) {
      const d = { variant, line: lines[(i + k) % 3], length: lengths[(i * 2 + k) % 3], intensity: ((k % 3) + 1) as Intensity, intent: 'attack' as const };
      const c = { pitch: pitches[(i + 2 * k) % 3], weather: 'clear' as const };
      const path = deliveryPath(d, c);
      const timing = deliveryTiming(d, c);
      const aims = [AIMS[i % AIMS.length], AIMS[(i + 3) % AIMS.length], AIMS[(i + 5) % AIMS.length]].slice(0, 2 + (i % 2));
      out.push({
        path,
        opts: { family: FAMILY[variant], releaseToContactMs: timing.releaseToContactMs, conditions: CONDITIONS_FOR_PITCH[c.pitch] },
        contact: { x: path.lineAtBatM, y: Math.max(0.1, Math.min(1.2, path.heightAtBatM)), z: CONTACT_Z },
        aims,
      });
      i++;
    }
  }
  return out;
}
