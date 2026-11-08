/**
 * The two small things in the first bundle: the flow's gate (may the next ball start?) and the mount that loads the camera
 * layer only when the camera is the control. A mouse or touch player never fetches the camera's screens.
 */
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setCameraForTests } from '@/practice/ui/controls/cameraPort';
import { setControl } from '@/practice/ui/controls/state';
import type { PracticeFlow } from '@/practice/ui/flow/controller';
import type { FlowState } from '@/practice/ui/flow/state';
import { cameraGate } from '@/practice/ui/camera/gate';
import { CameraMount } from '@/practice/ui/camera/mount';
import { resetCameraController, setCameraSessionFactory } from '@/practice/ui/camera/controller';
import { publishCameraUi, resetCameraUi } from '@/practice/ui/camera/store';
import { createFakeSession, SEEN } from './fakeSession';

// A build that offers the camera: Camera can be the control.
const OFFERED = { info: { offered: true, packMb: 9.1 }, port: null };

beforeEach(() => {
  localStorage.clear();
  // The camera can only be the control where the browser has a camera API (the choice checks it); jsdom has none.
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia: () => Promise.reject(new Error('no camera in tests')) },
    configurable: true,
  });
  setCameraForTests(OFFERED);
  resetCameraUi(false);
});
afterEach(() => {
  Reflect.deleteProperty(navigator, 'mediaDevices');
  cleanup();
  setCameraForTests(undefined);
  resetCameraController();
  setCameraSessionFactory(null);
  resetCameraUi(false);
});

describe('cameraGate', () => {
  it('has no opinion about a mouse or touch player: always ready, never wanted', () => {
    setControl('mouse');
    expect(cameraGate.wanted()).toBe(false);
    expect(cameraGate.ready()).toBe(true);
    publishCameraUi({ started: false, stage: 'idle' });
    expect(cameraGate.ready()).toBe(true);
  });

  it('holds a camera player until a steady person is seen, and lets go of nobody else', () => {
    setControl('camera');
    expect(cameraGate.wanted()).toBe(true);
    expect(cameraGate.ready()).toBe(false);
    publishCameraUi({ started: true, stage: 'running', readiness: { ...SEEN, ready: false } });
    expect(cameraGate.ready()).toBe(false);
    publishCameraUi({ readiness: SEEN });
    expect(cameraGate.ready()).toBe(true);
    publishCameraUi({ lost: true });
    expect(cameraGate.ready()).toBe(false);
  });

  it('tells a listener about a change of control or of what the camera sees, until it lets go', () => {
    const cb = vi.fn();
    const off = cameraGate.subscribe(cb);
    setControl('camera');
    expect(cb).toHaveBeenCalledTimes(1);
    publishCameraUi({ started: true, stage: 'running', readiness: SEEN });
    expect(cb).toHaveBeenCalledTimes(2);
    off();
    setControl('mouse');
    publishCameraUi({ lost: true });
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('a camera that this build does not offer is not the control, so nothing waits for it', () => {
    setControl('camera');
    expect(cameraGate.wanted()).toBe(true);
    setCameraForTests({ info: { offered: false, packMb: null }, port: null });
    // The stored choice is kept, but the device falls back to its default: no wait.
    expect(cameraGate.wanted()).toBe(false);
    expect(cameraGate.ready()).toBe(true);
  });
});

describe('CameraMount', () => {
  const flow = {
    onSwingStart: vi.fn(),
    onSwingIntent: vi.fn(),
    onGestureCancel: vi.fn(),
    onContactState: vi.fn(),
    onGesture: vi.fn(),
    stageOwnsInput: () => false,
  } as unknown as PracticeFlow;
  const waiting = {
    phase: 'camera',
    screen: 'live',
    gesture: { enabled: false, key: '0' },
    handedness: 'right',
    last: null,
  } as unknown as FlowState;

  it('draws nothing, and loads nothing, for a mouse player', async () => {
    setControl('mouse');
    const view = render(<CameraMount flow={flow} state={waiting} />);
    await act(async () => void (await Promise.resolve()));
    expect(view.container.innerHTML).toBe('');
  });

  it('loads the camera layer for a camera player and shows the card while the ball waits', async () => {
    setCameraSessionFactory(() => Promise.resolve(createFakeSession({ cached: true })));
    resetCameraController();
    setControl('camera');
    render(<CameraMount flow={flow} state={waiting} />);
    expect(await screen.findByTestId('camera-ready')).toBeTruthy();
  });

  it('follows the control: the card goes when the player switches to the mouse', async () => {
    setCameraSessionFactory(() => Promise.resolve(createFakeSession({ cached: true })));
    resetCameraController();
    setControl('camera');
    render(<CameraMount flow={flow} state={waiting} />);
    await screen.findByTestId('camera-ready');
    act(() => void setControl('mouse'));
    expect(screen.queryByTestId('camera-ready')).toBeNull();
  });
});
