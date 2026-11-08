/**
 * The camera arms like a second batting surface: the same cues as a finger's, only while a ball is live (and, for the
 * first-ball lesson, while its card is open, with no cues plugged in), one gesture per arm, and never where Unity owns the
 * batting. Mouse, touch and keyboard are untouched.
 */
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PracticeFlow } from '@/practice/ui/flow/controller';
import type { FlowState, LivePhase } from '@/practice/ui/flow/state';
import { CameraBatLink } from '@/practice/ui/camera/Bat';
import { getCameraController, resetCameraController, setCameraSessionFactory } from '@/practice/ui/camera/controller';
import { resetCameraUi } from '@/practice/ui/camera/store';
import { createFakeSession, type FakeSession } from './fakeSession';

function flowStub(unity = false) {
  return {
    onSwingStart: vi.fn(),
    onSwingIntent: vi.fn(),
    onGestureCancel: vi.fn(),
    onContactState: vi.fn(),
    onGesture: vi.fn(),
    stageOwnsInput: () => unity,
  } as unknown as PracticeFlow &
    Record<
      'onSwingStart' | 'onSwingIntent' | 'onGestureCancel' | 'onContactState' | 'onGesture',
      ReturnType<typeof vi.fn>
    >;
}
const stateOf = (phase: LivePhase, enabled = false, key = '1', handedness: 'right' | 'left' = 'right') =>
  ({ phase, screen: 'live', gesture: { enabled, key }, handedness }) as unknown as FlowState;

async function running(): Promise<FakeSession> {
  const session = createFakeSession({ cached: true });
  setCameraSessionFactory(() => Promise.resolve(session));
  resetCameraController();
  const started = getCameraController().begin();
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  await act(async () => {
    session.finish();
    await started;
  });
  return session;
}

beforeEach(() => {
  localStorage.clear();
  resetCameraUi(false);
});
afterEach(() => {
  cleanup();
  resetCameraController();
  setCameraSessionFactory(null);
  resetCameraUi(false);
});

describe('arming for a live ball', () => {
  it("plugs in the flow's cues and arms only while the ball is live", async () => {
    const session = await running();
    const flow = flowStub();
    const view = render(<CameraBatLink flow={flow} state={stateOf('dead')} />);
    expect(session.bat.enabled).toBe(false);
    expect(session.bat.handlers).toMatchObject({
      onSwingStart: flow.onSwingStart,
      onIntent: flow.onSwingIntent,
      onCancel: flow.onGestureCancel,
      onContactState: flow.onContactState,
      onGesture: flow.onGesture,
    });
    expect(session.bat.hand).toBe('right');
    view.rerender(<CameraBatLink flow={flow} state={stateOf('runup', false)} />);
    expect(session.bat.enabled).toBe(false);
    view.rerender(<CameraBatLink flow={flow} state={stateOf('live', true)} />);
    expect(session.bat.enabled).toBe(true);
    view.rerender(<CameraBatLink flow={flow} state={stateOf('live', false)} />);
    expect(session.bat.enabled).toBe(false);
  });

  it('arms nothing until the camera is running, and lets go when it stops', async () => {
    const session = createFakeSession();
    setCameraSessionFactory(() => Promise.resolve(session));
    resetCameraController();
    const view = render(<CameraBatLink flow={flowStub()} state={stateOf('live', true)} />);
    expect(session.bat.calls).toEqual([]);
    view.unmount();
    expect(session.bat.calls).toEqual([]);

    const live = await running();
    const second = render(<CameraBatLink flow={flowStub()} state={stateOf('live', true)} />);
    expect(live.bat.enabled).toBe(true);
    second.unmount();
    expect(live.bat.enabled).toBe(false);
    expect(live.bat.handlers).toBeNull();
  });

  it('re-arms for a new delivery (a changed key), not for the first key', async () => {
    const session = await running();
    const flow = flowStub();
    const view = render(<CameraBatLink flow={flow} state={stateOf('live', true, '1')} />);
    expect(session.bat.calls.filter((c) => c === 'rearm')).toHaveLength(0);
    view.rerender(<CameraBatLink flow={flow} state={stateOf('live', true, '1+')} />);
    expect(session.bat.calls.filter((c) => c === 'rearm')).toHaveLength(1);
    view.rerender(<CameraBatLink flow={flow} state={stateOf('dead', false, '2')} />);
    expect(session.bat.calls.filter((c) => c === 'rearm')).toHaveLength(1);
  });

  it("passes a left-hander's hand to the batter", async () => {
    const session = await running();
    render(<CameraBatLink flow={flowStub()} state={stateOf('live', true, '1', 'left')} />);
    expect(session.bat.hand).toBe('left');
  });

  it('does nothing where Unity owns the batting', async () => {
    const session = await running();
    render(<CameraBatLink flow={flowStub(true)} state={stateOf('live', true)} />);
    expect(session.bat.enabled).toBe(false);
  });
});

describe("the first-ball lesson's try-out", () => {
  it('arms with no cues plugged in, and arms again after each swing it reads', async () => {
    const session = await running();
    render(<CameraBatLink flow={flowStub()} state={stateOf('lesson')} />);
    expect(session.bat.enabled).toBe(true);
    expect(session.bat.handlers).toBeNull();
    await act(async () => {
      await getCameraController().prepare();
    });
    const swing = { kind: 'attack', startT: 0.4, directionDeg: 5, power: 0.5, elevation: 0, footwork: 'auto' } as const;
    act(() => session.emitSwing(swing));
    expect(session.bat.calls.filter((c) => c === 'rearm')).toHaveLength(1);
    act(() => session.emitSwing(swing));
    expect(session.bat.calls.filter((c) => c === 'rearm')).toHaveLength(2);
  });
});
