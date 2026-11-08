import { describe, expect, it } from 'vitest';
import { parseRotation, parseWmSize } from '../../../scripts/android-device.mjs';

describe('Android harness display parsing', () => {
  it.each([
    ['current named clockwise', 'DisplayRotation{mCurrentRotation=ROTATION_90}', 90],
    ['current named counter-clockwise', 'mCurrentRotation=ROTATION_270', 270],
    ['newer mRotation name', 'DisplayRotation{mRotation=ROTATION_90}', 90],
    ['numeric mCurrentRotation', 'mCurrentRotation=1', 90],
    ['numeric mRotation', 'mRotation=3', 270],
    ['input surface clockwise', 'SurfaceOrientation: 1', 90],
    ['input surface counter-clockwise', 'SurfaceOrientation: 3', 270],
    ['portrait is parsed, not guessed as landscape', 'mRotation=ROTATION_0', 0],
    ['unknown output', 'Display 0 has no rotation field', null],
  ] as const)('parses %s', (_label, output, expected) => {
    expect(parseRotation(output)).toBe(expected);
  });

  it.each([
    ['physical size', 'Physical size: 1080x2400', { width: 1080, height: 2400, source: 'physical' }],
    [
      'override before physical',
      'Override size: 720x1600\nPhysical size: 1080x2400',
      { width: 720, height: 1600, source: 'override' },
    ],
    [
      'override after physical',
      'Physical size: 1080x2400\nOverride size: 720x1600',
      { width: 720, height: 1600, source: 'override' },
    ],
    ['unlabelled legacy size', '1080x2400', { width: 1080, height: 2400, source: 'raw' }],
    ['zero size', 'Physical size: 0x0', null],
    ['unknown output', 'size unavailable', null],
  ] as const)('parses %s', (_label, output, expected) => {
    expect(parseWmSize(output)).toEqual(expected);
  });
});
