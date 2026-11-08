/**
 * The camera store: listeners hear only real changes (so a screen does not re-render for nothing), and the three
 * questions the rest of Practice asks - is a person steady, is one tracked, is the camera on - are answered from it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NO_PACK } from '@/practice/ui/camera/ports';
import {
  INITIAL_UI,
  getCameraUi,
  isOn,
  isSteady,
  isTracking,
  publishCameraUi,
  resetCameraUi,
  subscribeCameraUi,
} from '@/practice/ui/camera/store';
import { SEEN } from './fakeSession';

afterEach(() => resetCameraUi(false));

describe('publishCameraUi', () => {
  it('tells listeners about a change and keeps the same snapshot when nothing differs', () => {
    const cb = vi.fn();
    const off = subscribeCameraUi(cb);
    const before = getCameraUi();
    publishCameraUi({ started: false, stage: 'idle', pack: NO_PACK });
    expect(cb).not.toHaveBeenCalled();
    expect(getCameraUi()).toBe(before);
    publishCameraUi({ started: true });
    expect(cb).toHaveBeenCalledTimes(1);
    expect(getCameraUi()).not.toBe(before);
    expect(getCameraUi().started).toBe(true);
    off();
    publishCameraUi({ started: false });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('compares objects by reference, as the session promises a new one only when something changed', () => {
    const cb = vi.fn();
    subscribeCameraUi(cb);
    publishCameraUi({ readiness: SEEN });
    publishCameraUi({ readiness: SEEN });
    expect(cb).toHaveBeenCalledTimes(1);
    publishCameraUi({ readiness: { ...SEEN } });
    expect(cb).toHaveBeenCalledTimes(2);
  });
});

describe('resetCameraUi', () => {
  it('goes back to not started, and keeps the consent flag unless told not to', () => {
    publishCameraUi({ started: true, stage: 'running', consentSeen: true, readiness: SEEN });
    resetCameraUi();
    expect(getCameraUi()).toEqual({ ...INITIAL_UI, consentSeen: true });
    resetCameraUi(false);
    expect(getCameraUi()).toEqual(INITIAL_UI);
  });
});

describe('what the flow and the lesson ask', () => {
  it('is steady only when running, with no problem, not lost, and the core says ready', () => {
    const run = { started: true, stage: 'running' as const, readiness: SEEN };
    publishCameraUi(run);
    expect(isSteady(getCameraUi())).toBe(true);
    publishCameraUi({ lost: true });
    expect(isSteady(getCameraUi())).toBe(false);
    publishCameraUi({ lost: false, problem: 'black' });
    expect(isSteady(getCameraUi())).toBe(false);
    publishCameraUi({ problem: null, stage: 'starting' });
    expect(isSteady(getCameraUi())).toBe(false);
    publishCameraUi({ stage: 'running', readiness: { ...SEEN, ready: false } });
    expect(isSteady(getCameraUi())).toBe(false);
  });

  it('tracks a person who is in frame even before the steady time has passed', () => {
    publishCameraUi({ started: true, stage: 'running', readiness: { ...SEEN, ready: false } });
    expect(isTracking(getCameraUi())).toBe(true);
    publishCameraUi({ readiness: { ...SEEN, inFrame: false } });
    expect(isTracking(getCameraUi())).toBe(false);
  });

  it('says the camera is on from the tap until it fails or stops', () => {
    expect(isOn(getCameraUi())).toBe(false);
    publishCameraUi({ started: true, stage: 'opening' });
    expect(isOn(getCameraUi())).toBe(true);
    publishCameraUi({ stage: 'failed' });
    expect(isOn(getCameraUi())).toBe(false);
    publishCameraUi({ stage: 'idle' });
    expect(isOn(getCameraUi())).toBe(false);
  });
});
