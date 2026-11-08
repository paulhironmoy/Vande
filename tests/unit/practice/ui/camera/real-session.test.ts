/**
 * The screens against the REAL camera session (src/input/camera): the port in ports.ts is exactly what the core's session
 * offers (a compile-time check, so a change on either side is an error here), and a real session in this test tree (no pack,
 * no camera, no worker) is met honestly: "not available here", the way back, and nothing started.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCameraSession, type CameraSession as RealSession } from '@/input/camera';
import type { CameraSession as Port, CameraSessionStatus as PortStatus } from '@/practice/ui/camera/ports';
import { getCameraController, resetCameraController, setCameraSessionFactory } from '@/practice/ui/camera/controller';
import { panelFor } from '@/practice/ui/camera/panels';
import { getCameraUi, resetCameraUi } from '@/practice/ui/camera/store';

// Compile-time: the real session can be used wherever the port is asked for, and its status is the port's status.
const asPort = (s: RealSession): Port => s;
const asStatus = (s: ReturnType<RealSession['status']>): PortStatus => s;

beforeEach(() => resetCameraUi(false));
afterEach(() => {
  resetCameraController();
  setCameraSessionFactory(null);
  resetCameraUi(false);
});

describe('the real session', () => {
  it('fits the port (checked by the compiler)', () => {
    expect(typeof asPort).toBe('function');
    expect(typeof asStatus).toBe('function');
  });

  it('is met honestly where there is no pack: unavailable, the not-available panel, nothing started', async () => {
    const session = createCameraSession({ info: null });
    setCameraSessionFactory(() => Promise.resolve(session));
    resetCameraController();
    expect(session.unavailable()).toBe('unsupported');
    const controller = getCameraController();
    await controller.prepare();
    expect(getCameraUi().problem).toBe('unsupported');
    expect(panelFor(getCameraUi(), 'setup')).toEqual({ kind: 'trouble', case: 'unsupported' });
    await controller.begin();
    expect(getCameraUi()).toMatchObject({ started: true, stage: 'failed', problem: 'unsupported' });
    controller.cancel();
    expect(getCameraUi()).toMatchObject({ started: false, stage: 'idle', problem: null });
  });

  it('answers the questions the consent asks without touching the camera or the network', async () => {
    const info = {
      id: 'abc',
      version: '0.10.35',
      dir: 'models/pose/0.10.35/',
      files: [],
      totalBytes: 9_136_226,
    };
    const session = createCameraSession({ info, store: null });
    expect(session.packBytes()).toBe(9_136_226);
    await expect(session.packCached()).resolves.toBe(false);
    expect(session.status().stage).toBe('idle');
  });
});
