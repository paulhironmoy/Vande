/**
 * "Clear Practice data" forgets the camera: it is switched off, what this visit knew is reset, the consent and the chosen
 * control go with Practice's own keys, and the downloaded pack is deleted from the device.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearPracticeData, memoryStore, updatePracticeSettings } from '@/practice/store';
import { consentSeen, rememberConsent } from '@/practice/ui/camera/consent';
import { getCameraController, resetCameraController, setCameraSessionFactory } from '@/practice/ui/camera/controller';
import { forgetCamera } from '@/practice/ui/camera/forget';
import { getCameraUi, publishCameraUi, resetCameraUi } from '@/practice/ui/camera/store';
import { createFakeSession } from './fakeSession';

const forgetPack = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock('@/input/camera/store', () => ({ forgetCameraPack: forgetPack }));

beforeEach(() => {
  forgetPack.mockClear();
  resetCameraUi(false);
});
afterEach(() => {
  resetCameraController();
  setCameraSessionFactory(null);
  resetCameraUi(false);
});

describe('forgetCamera', () => {
  it('deletes the downloaded pack and resets what this visit knew, without loading the camera when it never ran', async () => {
    publishCameraUi({ consentSeen: true });
    await forgetCamera();
    expect(forgetPack).toHaveBeenCalledTimes(1);
    expect(getCameraUi().consentSeen).toBe(false);
  });

  it('switches a running camera off first', async () => {
    const session = createFakeSession({ cached: true });
    setCameraSessionFactory(() => Promise.resolve(session));
    resetCameraController();
    const started = getCameraController().begin();
    await Promise.resolve();
    await Promise.resolve();
    session.finish();
    await started;
    expect(getCameraUi().started).toBe(true);
    await forgetCamera();
    expect(session.calls.stop).toBeGreaterThanOrEqual(1);
    expect(getCameraUi()).toMatchObject({ started: false, stage: 'idle' });
    expect(forgetPack).toHaveBeenCalledTimes(1);
  });

  it('never throws, even when the pack cannot be deleted', async () => {
    forgetPack.mockRejectedValueOnce(new Error('storage blocked'));
    await expect(forgetCamera()).resolves.toBeUndefined();
  });
});

describe("Practice's own keys", () => {
  it('"Clear Practice data" removes the consent and the chosen control', () => {
    const store = memoryStore();
    rememberConsent(store);
    updatePracticeSettings({ control: 'camera' }, store);
    expect(consentSeen(store)).toBe(true);
    clearPracticeData(store);
    expect(consentSeen(store)).toBe(false);
    expect(store.getItem('vc:practice:settings')).toBeNull();
  });
});
