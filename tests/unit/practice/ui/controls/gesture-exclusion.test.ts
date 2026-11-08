/**
 * The JavaScript half of "the system back gesture never steals a stroke" (CTR-05): Practice tells the native shell when
 * the batting surface is in use and how much of the screen it covers. The native half (View.setSystemGestureExclusionRects)
 * is specified in S/chase/requests/CONTROLS-3-to-ANDROID.md and is tested on an emulator, not here.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const setBattingExclusion = vi.fn((_options: { active: boolean; heightFraction: number }) => Promise.resolve());
const nativePlugin = vi.fn(() => Promise.resolve({ plugin: { setBattingExclusion } }));
vi.mock('@/platform/capacitor', () => ({
  nativePlugin: (...a: unknown[]) => (nativePlugin as (...x: unknown[]) => unknown)(...a),
}));

import {
  BATTING_HEIGHT_FRACTION,
  resetBattingGestureExclusion,
  setBattingGestureExclusion,
} from '@/practice/ui/controls/gestureExclusion';

beforeEach(() => {
  setBattingExclusion.mockClear();
  nativePlugin.mockClear();
  nativePlugin.mockImplementation(() => Promise.resolve({ plugin: { setBattingExclusion } }));
  resetBattingGestureExclusion();
});

describe('batting gesture exclusion (JavaScript side)', () => {
  it('says the batting surface is in use, with the share of the screen it covers', async () => {
    await setBattingGestureExclusion(true);
    expect(nativePlugin).toHaveBeenCalledWith('VandeSystemGestures');
    expect(setBattingExclusion).toHaveBeenCalledWith({ active: true, heightFraction: BATTING_HEIGHT_FRACTION });
  });

  it('says so again only when it changes', async () => {
    await setBattingGestureExclusion(true);
    await setBattingGestureExclusion(true);
    await setBattingGestureExclusion(false);
    await setBattingGestureExclusion(false);
    expect(setBattingExclusion.mock.calls.map(([o]) => o.active)).toEqual([true, false]);
  });

  it('does nothing where the shell has no such plugin (the web, an older build)', async () => {
    nativePlugin.mockImplementation(() => Promise.resolve(null as never));
    await expect(setBattingGestureExclusion(true)).resolves.toBeUndefined();
    expect(setBattingExclusion).not.toHaveBeenCalled();
  });

  it('never throws when the native call fails', async () => {
    setBattingExclusion.mockImplementationOnce(() => Promise.reject(new Error('not implemented on android')));
    await expect(setBattingGestureExclusion(true)).resolves.toBeUndefined();
  });

  it("the share of the screen is the batting surface's own default, so the two cannot drift apart", () => {
    const src = readFileSync(join(process.cwd(), 'src/input/GestureSurface.tsx'), 'utf8');
    expect(src).toMatch(
      new RegExp(`props\\.heightFraction \\?\\? ${BATTING_HEIGHT_FRACTION.toString().replace('.', '\\.')}`),
    );
  });
});
