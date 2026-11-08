/**
 * "How do you want to bat?": which controls a device offers, which is its default, which is in force. Plain objects
 * stand for the device, so every case is exact (CTR-01, CTR-03, CTR-09).
 */
import { describe, expect, it } from 'vitest';
import {
  cameraBlock,
  controlFeelsHaptics,
  controlOptions,
  defaultControl,
  effectiveControl,
  pointerControls,
  readControlEnv,
  type ControlEnv,
} from '@/practice/ui/controls/model';

const env = (over: Partial<ControlEnv> = {}): ControlEnv => ({
  native: false,
  primaryCoarse: false,
  anyCoarse: false,
  anyFine: true,
  secure: true,
  cameraApi: true,
  ...over,
});

const DESKTOP = env();
const PHONE = env({ primaryCoarse: true, anyCoarse: true, anyFine: false });
const ANDROID_SHELL = env({ native: true, primaryCoarse: true, anyCoarse: true, anyFine: false });
const TOUCH_LAPTOP = env({ anyCoarse: true, anyFine: true });
const IPAD_WITH_TRACKPAD = env({ primaryCoarse: true, anyCoarse: true, anyFine: true });

describe('the controls a device offers', () => {
  it('the web offers Mouse, then Camera; Mouse is the default and the keyboard is not a choice', () => {
    expect(pointerControls(DESKTOP)).toEqual(['mouse']);
    expect(defaultControl(DESKTOP)).toBe('mouse');
    expect(controlOptions(DESKTOP, true).map((o) => [o.id, o.isDefault, o.available])).toEqual([
      ['mouse', true, true],
      ['camera', false, true],
    ]);
  });

  it('the Android shell and a touch-only device offer Touch, then Camera; Touch is the default', () => {
    for (const e of [ANDROID_SHELL, PHONE]) {
      expect(pointerControls(e)).toEqual(['touch']);
      expect(defaultControl(e)).toBe('touch');
      expect(controlOptions(e, true).map((o) => o.id)).toEqual(['touch', 'camera']);
    }
  });

  it('the Android shell offers no mouse even when a pointer that looks fine is attached', () => {
    expect(pointerControls({ ...ANDROID_SHELL, anyFine: true })).toEqual(['touch']);
  });

  it('a device with both a finger and a mouse offers both, its main pointer first', () => {
    expect(pointerControls(TOUCH_LAPTOP)).toEqual(['mouse', 'touch']);
    expect(defaultControl(TOUCH_LAPTOP)).toBe('mouse');
    expect(pointerControls(IPAD_WITH_TRACKPAD)).toEqual(['touch', 'mouse']);
    expect(defaultControl(IPAD_WITH_TRACKPAD)).toBe('touch');
  });

  it('the camera is never the default, whatever the device', () => {
    for (const e of [DESKTOP, PHONE, ANDROID_SHELL, TOUCH_LAPTOP, IPAD_WITH_TRACKPAD, env({ cameraApi: false })]) {
      expect(defaultControl(e)).not.toBe('camera');
      expect(controlOptions(e, true).find((o) => o.id === 'camera')?.isDefault).toBe(false);
    }
  });

  it('a build without the camera module offers no camera at all', () => {
    expect(controlOptions(DESKTOP, false).map((o) => o.id)).toEqual(['mouse']);
    expect(controlOptions(PHONE, false).map((o) => o.id)).toEqual(['touch']);
  });
});

describe('why the camera is switched off (CTR-03)', () => {
  it('an insecure page has no camera API: the reason is the secure page', () => {
    const e = env({ secure: false, cameraApi: false });
    expect(cameraBlock(e)).toBe('secure');
    const camera = controlOptions(e, true).find((o) => o.id === 'camera')!;
    expect([camera.available, camera.blocked]).toEqual([false, 'secure']);
  });

  it('a secure page without the API says the browser has no camera support', () => {
    expect(cameraBlock(env({ cameraApi: false }))).toBe('api');
  });

  it('a device list that proves there is no camera says so; an unknown list never does', () => {
    expect(cameraBlock(env({ noCamera: true }))).toBe('device');
    expect(cameraBlock(env({ noCamera: false }))).toBeNull();
    expect(cameraBlock(env())).toBeNull();
  });

  it('the pointer controls stay available whatever the camera does', () => {
    const options = controlOptions(env({ secure: false, cameraApi: false }), true);
    expect(options.filter((o) => o.id !== 'camera').every((o) => o.available)).toBe(true);
  });
});

describe('the control in force', () => {
  it('is the stored choice while the device offers it', () => {
    expect(effectiveControl('mouse', DESKTOP)).toBe('mouse');
    expect(effectiveControl('camera', DESKTOP)).toBe('camera');
    expect(effectiveControl('mouse', TOUCH_LAPTOP)).toBe('mouse');
    expect(effectiveControl('touch', TOUCH_LAPTOP)).toBe('touch');
  });

  it('is the device default before any choice', () => {
    expect(effectiveControl(null, DESKTOP)).toBe('mouse');
    expect(effectiveControl(null, ANDROID_SHELL)).toBe('touch');
  });

  it('falls back to the default when the stored control is not offered here (a phone has no mouse, the shell none)', () => {
    expect(effectiveControl('mouse', PHONE)).toBe('touch');
    expect(effectiveControl('mouse', ANDROID_SHELL)).toBe('touch');
    expect(effectiveControl('touch', DESKTOP)).toBe('mouse');
  });

  it('a stored camera falls back while the camera is off here or not in the build, and returns with it', () => {
    expect(effectiveControl('camera', env({ cameraApi: false }))).toBe('mouse');
    expect(effectiveControl('camera', DESKTOP, false)).toBe('mouse');
    expect(effectiveControl('camera', DESKTOP, true)).toBe('camera');
  });
});

describe('what each control feels (CTR-06)', () => {
  it('only the finger feels haptics; the mouse and the camera get sound and picture', () => {
    expect(controlFeelsHaptics('touch')).toBe(true);
    expect(controlFeelsHaptics('mouse')).toBe(false);
    expect(controlFeelsHaptics('camera')).toBe(false);
  });
});

describe('reading the device (platform detection)', () => {
  const win = (matches: Record<string, boolean>, rest: Record<string, unknown> = {}) => ({
    matchMedia: (q: string) => ({ matches: matches[q] ?? false }),
    ...rest,
  });

  it('reads the pointers, the secure page and the camera API', () => {
    const e = readControlEnv(
      false,
      win(
        { '(any-pointer: fine)': true },
        {
          isSecureContext: true,
          navigator: { mediaDevices: { getUserMedia: () => undefined } },
        },
      ),
    );
    expect(e).toMatchObject({
      native: false,
      primaryCoarse: false,
      anyCoarse: false,
      anyFine: true,
      secure: true,
      cameraApi: true,
    });
  });

  it('a phone: the main pointer is a finger and there is no fine pointer', () => {
    const e = readControlEnv(false, win({ '(pointer: coarse)': true, '(any-pointer: coarse)': true }));
    expect(e).toMatchObject({ primaryCoarse: true, anyCoarse: true, anyFine: false });
    expect(defaultControl(e)).toBe('touch');
  });

  it('a device that reports no pointer at all is treated as a desktop with a mouse', () => {
    expect(defaultControl(readControlEnv(false, win({})))).toBe('mouse');
    expect(defaultControl(readControlEnv(false, undefined))).toBe('mouse');
  });

  it('a throwing matchMedia is read as no match, never as a crash', () => {
    const e = readControlEnv(false, {
      matchMedia: () => {
        throw new Error('blocked');
      },
    });
    expect(e.anyCoarse).toBe(false);
    expect(defaultControl(e)).toBe('mouse');
  });

  it('the API is missing on an insecure origin and on a browser without mediaDevices', () => {
    expect(readControlEnv(false, win({}, { isSecureContext: false, navigator: {} })).cameraApi).toBe(false);
    expect(readControlEnv(false, win({}, { isSecureContext: false, navigator: {} })).secure).toBe(false);
    expect(readControlEnv(false, win({}, { navigator: { mediaDevices: {} } })).cameraApi).toBe(false);
  });

  it('the Android shell is the native flag, whatever the pointers say', () => {
    const e = readControlEnv(true, win({ '(any-pointer: fine)': true }));
    expect(e.native).toBe(true);
    expect(defaultControl(e)).toBe('touch');
  });
});
