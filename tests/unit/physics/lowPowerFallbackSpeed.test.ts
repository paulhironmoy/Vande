// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { batSpeed } from '@/physics/bat';
import { fly, play } from './physics-helpers';

const GOOD_OFF = { variation: 'stock', lengthM: 6, lineM: 0.12, speedKph: 136 } as const;
const LOW_POWER_DRIVE = { directionDeg: 0, power: 0.1, elevation: 0.05 } as const;

describe('low-power requested-speed preservation', () => {
  it('retains the authored back-foot punch and forward-drive speeds through the bounded fallback path', () => {
    const ball = fly(GOOD_OFF);
    const back = play(ball, 0, LOW_POWER_DRIVE, 'real', 'back').track!;
    const forward = play(ball, 0, LOW_POWER_DRIVE, 'real', 'forward').track!;

    expect(back.speed).toBe(batSpeed('attack', LOW_POWER_DRIVE.power) * 0.75);
    expect(back.vLine).toBe(back.speed);
    expect(forward.speed).toBe(batSpeed('attack', LOW_POWER_DRIVE.power));
    expect(forward.vLine).toBe(forward.speed);
    expect(back.speed).toBe(forward.speed * 0.75);
  });
});
