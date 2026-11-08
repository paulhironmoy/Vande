/**
 * The camera module's one door for the control choice (found by name by src/practice/ui/controls/cameraPort.ts): the
 * setup screens and the way to stop the camera at once. The camera is its own chunk, so the first bundle never has it.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cameraBuilt, cameraInfo, cameraPortNow, loadCameraPort } from '@/practice/ui/controls/cameraPort';
import { Setup } from '@/practice/ui/camera/Setup';
import { controlsPort } from '@/practice/ui/camera/controlsPort';
import {
  cameraCoreBuilt,
  getCameraController,
  resetCameraController,
  setCameraSessionFactory,
} from '@/practice/ui/camera/controller';
import { getCameraUi, resetCameraUi } from '@/practice/ui/camera/store';
import { createFakeSession } from './fakeSession';

afterEach(() => {
  resetCameraController();
  setCameraSessionFactory(null);
  resetCameraUi(false);
});

describe('controlsPort', () => {
  it('is the setup component and a stop', () => {
    expect(controlsPort.Setup).toBe(Setup);
    expect(typeof controlsPort.stop).toBe('function');
  });

  it('is found by the control choice by name, as a module of its own', async () => {
    const loaded = await loadCameraPort();
    expect(loaded?.Setup).toBe(Setup);
    expect(cameraPortNow()).toBe(loaded);
  });

  it('stops the camera at once, whenever it is called', async () => {
    const session = createFakeSession();
    setCameraSessionFactory(() => Promise.resolve(session));
    resetCameraController();
    const started = getCameraController().begin();
    await Promise.resolve();
    await Promise.resolve();
    session.finish();
    await started;
    expect(getCameraUi().started).toBe(true);
    controlsPort.stop();
    expect(session.calls.stop).toBeGreaterThanOrEqual(1);
    expect(getCameraUi().started).toBe(false);
    // Safe when nothing is running.
    controlsPort.stop();
  });
});

describe('the camera core', () => {
  it('is not in this tree yet unless a factory is given (the screens say so honestly)', () => {
    setCameraSessionFactory(null);
    // The build either has the core (glob finds src/input/camera/index.ts) or not; both are legitimate answers.
    expect(typeof cameraCoreBuilt()).toBe('boolean');
    setCameraSessionFactory(() => Promise.resolve(null));
    expect(cameraCoreBuilt()).toBe(true);
  });
});

describe('controlsInfo: what the choice may say before Camera is tapped', () => {
  it('is found by name and tiny: the build offers the camera only where the pose pack was built in', async () => {
    const { cameraInfoOf } = await import('@/practice/ui/camera/controlsInfo');
    expect(cameraInfoOf(null)).toEqual({ offered: false, packMb: null });
    const pack = { id: 'x', version: '0.10.35', dir: 'models/pose/0.10.35/', files: [], totalBytes: 9_136_226 };
    expect(cameraInfoOf(pack)).toEqual({ offered: true, packMb: 9.1 });
    expect(cameraInfoOf({ ...pack, totalBytes: 9_150_000 })).toEqual({ offered: true, packMb: 9.2 });
    // In this test tree no pack is baked in, so the choice shows no Camera option and says so.
    expect(cameraInfo()).toEqual({ offered: false, packMb: null });
    expect(cameraBuilt()).toBe(false);
  });
});
