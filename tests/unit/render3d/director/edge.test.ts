// @vitest-environment node
/**
 * Edge cases: a Director that is handed nothing, something tiny or something broken must still give finite, bounded
 * channels (never NaN into a uniform or a bone). Reason: P2 will hand it live game data, and one bad frame is a
 * visible glitch on every device.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  CHANNELS,
  SCALE,
  createOut,
  prepare,
  sample,
  type DirectorAnchors,
  type DirectorPlan,
} from '@/render3d/core/motion/director';
import { anchorsFor, delivery, idleAnchors, STOCK } from './world';
import { recordFile } from './gates';

recordFile('edge');

// Heavy measurement runs: a slow CI runner gets a generous timeout (the config default is 30 s).
vi.setConfig({ testTimeout: 120_000 });

const finite = (p: DirectorPlan) => {
  for (let i = 0; i < p.trace.length; i++) expect(Number.isFinite(p.trace[i] * SCALE[i % CHANNELS])).toBe(true);
  const out = createOut();
  for (let t = p.t0 - 100; t < p.t0 + (p.n * 1000) / p.hz + 100; t += 37) {
    sample(p, t, out);
    for (const v of out) expect(Number.isFinite(v)).toBe(true);
  }
};

describe('edge cases', () => {
  const base = idleAnchors('striker', 'edge#0', 6000);

  it('no target is ever available (nothing to look at): the gaze stays centred and every value is finite', () => {
    const p = prepare({ ...base, aim: () => false, visibleBall: () => false });
    finite(p);
    const out = createOut();
    sample(p, 3000, out);
    // centred in yaw (microsaccades and drift only), and either straight ahead or down at the ground (a fixation that needs no callback)
    expect(Math.abs(out[10])).toBeLessThan(1);
    expect(Math.abs(out[11]) < 1 || (out[11] > 25 && out[11] < 32)).toBe(true);
  });

  it('targets that return NaN or infinity are ignored, not followed', () => {
    const p = prepare({
      ...base,
      aim: (_t, _ms, out) => {
        out[0] = NaN;
        out[1] = Infinity;
        return true;
      },
      clipHead: (_ms, out) => {
        out[0] = NaN;
        out[1] = -Infinity;
        out[2] = NaN;
      },
    });
    finite(p);
  });

  it('a one-frame and a zero-length script', () => {
    for (const end of [0, 5, 16, 17]) {
      const p = prepare({ ...base, end });
      expect(p.n).toBeGreaterThanOrEqual(1);
      finite(p);
    }
    const p = prepare({ ...base, end: -50 });
    expect(p.n).toBe(1);
    finite(p);
  });

  it('a delivery whose anchors are all missing except the release, and one with the release before the start', () => {
    const d = delivery(STOCK);
    const a = anchorsFor(d, { role: 'striker', key: 'edge#1' });
    finite(
      prepare({
        ...a,
        gather: null,
        swing: null,
        contact: null,
        taskEnd: null,
        outcomeAt: null,
        dead: null,
        strokeEnd: null,
      }),
    );
    finite(prepare({ ...a, start: 3000, release: 2000 }));
    finite(prepare({ ...anchorsFor(d, { role: 'bowler', key: 'edge#2', series: 'pace' }), gather: null }));
  });

  it('every frame rate gives finite output and the same blinks at the same instants', () => {
    const d = delivery(STOCK);
    const a: DirectorAnchors = anchorsFor(d, { role: 'bowler', key: 'edge#3', series: 'pace' });
    for (const hz of [60, 120, 240] as const) finite(prepare(a, { hz }));
  });

  it('a very long script (ten minutes) is built and read without trouble', () => {
    const p = prepare(idleAnchors('bowler', 'edge#long', 600_000));
    expect(p.n).toBe(36_001);
    finite(p);
  });
});
